import type { Logger } from '@guiiai/logg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { callLlm } from './call-llm';

const makeLog = (): Logger => {
  const log = {
    withFields: () => log,
    withError: () => log,
    log: () => {},
    error: () => {},
  };
  return log as unknown as Logger;
};

const sseStream = (...events: unknown[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callLlm', () => {
  it('maps OpenAI-compatible prompt cache hit and miss tokens into usage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseStream(
      {
        choices: [{
          finish_reason: 'stop',
          delta: { content: 'ok' },
        }],
      },
      {
        usage: {
          prompt_tokens: 45439,
          completion_tokens: 301,
          prompt_tokens_details: { cached_tokens: 44032 },
          prompt_cache_hit_tokens: 44032,
          prompt_cache_miss_tokens: 1407,
        },
      },
    ))));

    const result = await callLlm(
      {
        apiBaseUrl: 'https://llm.example.test',
        apiKey: 'test-key',
        model: 'deepseek-v4-flash',
        apiFormat: 'openai-chat',
      },
      [],
      'system',
      undefined,
      { log: makeLog(), label: 'test' },
    );

    expect(result.usage).toEqual({
      inputTokens: 45439,
      outputTokens: 301,
      cacheCreationTokens: 1407,
      cacheReadTokens: 44032,
    });
  });

  const requestBody = (fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> =>
    JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as Record<string, unknown>;

  type ToolChoiceCase = {
    name: string;
    apiFormat: 'openai-chat' | 'responses' | 'anthropic-messages';
    expected: unknown;
  };

  const toolChoiceCases: ToolChoiceCase[] = [
    { name: 'openai-chat', apiFormat: 'openai-chat', expected: 'none' },
    { name: 'responses', apiFormat: 'responses', expected: 'none' },
    { name: 'anthropic-messages', apiFormat: 'anthropic-messages', expected: { type: 'none' } },
  ];

  for (const { name, apiFormat, expected } of toolChoiceCases) {
    it(`sends tool_choice for ${name} and overrides the endpoint policy`, async () => {
      const fetchMock = vi.fn(async () => new Response(sseStream(
        { choices: [{ finish_reason: 'stop', delta: { content: 'ok' } }] },
        { usage: { prompt_tokens: 1, completion_tokens: 1 } },
      )));
      vi.stubGlobal('fetch', fetchMock);

      await callLlm(
        {
          apiBaseUrl: 'https://llm.example.test',
          apiKey: 'test-key',
          model: 'test-model',
          apiFormat,
          // The endpoint policy would otherwise require a tool call.
          toolChoice: 'force',
        },
        [],
        'system',
        [{ name: 'send_message', parameters: { type: 'object', properties: {} } }],
        { log: makeLog(), label: 'test', toolChoice: 'none' },
      );

      expect(requestBody(fetchMock).tool_choice).toEqual(expected);
    });
  }
});

const config = { apiBaseUrl: 'https://llm.example.test', apiKey: 'test', model: 'test' };
const opts = () => ({ log: makeLog(), label: 'policy' });
const formats = ['openai-chat', 'responses', 'anthropic-messages'] as const;
const startEvent = (format: typeof formats[number]) => format === 'openai-chat'
  ? { choices: [{ delta: { tool_calls: [{ index: 0, id: 't' }] } }] }
  : format === 'responses'
    ? { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 't', call_id: 't', name: 'f', arguments: '' } }
    : { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'f', input: {} } };

for (const apiFormat of formats) {
  for (const toolChoice of ['force', 'local-force', 'none', 'local-none'] as const) {
    it(`${apiFormat}: maps ${toolChoice}`, async () => {
      const bodies: Record<string, unknown>[] = [];
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return new Response(sseStream());
      }));
      await callLlm({ ...config, apiFormat, toolChoice }, [], '', undefined, opts());
      const expected = toolChoice === 'force' ? (apiFormat === 'anthropic-messages' ? { type: 'any' } : 'required')
        : toolChoice === 'none' ? (apiFormat === 'anthropic-messages' ? { type: 'none' } : 'none') : undefined;
      expect(bodies[0]!.tool_choice).toEqual(expected);
      expect(bodies).toHaveLength(toolChoice === 'local-force' ? 4 : 1);
    });
  }

  it(`${apiFormat}: local-none cancels on start without awaiting arguments, appends cumulative private reminders`, async () => {
    const bodies: string[] = [];
    const signals: AbortSignal[] = [];
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(init.body as string);
      signals.push(init.signal!);
      if (bodies.length > 2) return new Response(sseStream());
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(startEvent(apiFormat))}\n\n`));
          // Intentionally never send arguments or close.
        },
        cancel,
      }));
    }));
    const entries: Parameters<typeof callLlm>[1] = [];
    await callLlm({ ...config, apiFormat, toolChoice: 'local-none' }, entries, '', undefined, opts());
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(signals.slice(0, 2).every(s => s.aborted)).toBe(true);
    expect(signals[2]!.aborted).toBe(false);
    expect(bodies.map(body => body.split('DO NOT CALL ANY TOOLS.').length - 1)).toEqual([0, 1, 2]);
    expect(entries).toEqual([]);
  });

  it(`${apiFormat}: external abort stops unbounded retries`, async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => new Response(sseStream(startEvent(apiFormat))));
    vi.stubGlobal('fetch', fetchMock);
    const pending = callLlm({ ...config, apiFormat, toolChoice: 'local-none', signal: controller.signal }, [], '', undefined, opts());
    setImmediate(() => controller.abort(new Error('external abort')));
    await expect(pending).rejects.toThrow('external abort');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it(`${apiFormat}: ordinary network errors are not policy retries`, async () => {
    const failure = new Error('network failure');
    const fetchMock = vi.fn(async () => { throw failure; });
    vi.stubGlobal('fetch', fetchMock);
    await expect(callLlm({ ...config, apiFormat, toolChoice: 'local-none' }, [], '', undefined, opts())).rejects.toBe(failure);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
}

it('local-force accumulates usage across four attempts and returns the exhausted last result', async () => {
  const fetchMock = vi.fn(async () => new Response(sseStream(
    { choices: [{ delta: { content: 'last text' } }] },
    { usage: { prompt_tokens: 2, completion_tokens: 3, prompt_cache_hit_tokens: 1, prompt_cache_miss_tokens: 1 } },
  )));
  vi.stubGlobal('fetch', fetchMock);
  const result = await callLlm({ ...config, toolChoice: 'local-force' }, [], '', undefined, opts());
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(result.usage).toEqual({ inputTokens: 8, outputTokens: 12, cacheCreationTokens: 4, cacheReadTokens: 4 });
  expect(JSON.stringify(result.entries)).toContain('last text');
});

it('external abort interrupts an in-flight reader without retrying', async () => {
  const controller = new AbortController();
  const cancel = vi.fn();
  const fetchMock = vi.fn(async () => new Response(new ReadableStream({ cancel })));
  vi.stubGlobal('fetch', fetchMock);
  const pending = callLlm({ ...config, toolChoice: 'local-none', signal: controller.signal }, [], '', undefined, opts());
  setImmediate(() => controller.abort(new Error('in-flight abort')));
  await expect(pending).rejects.toThrow('in-flight abort');
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('local-force stops at the first tool result and adds prior usage', async () => {
  let attempt = 0;
  const fetchMock = vi.fn(async () => {
    attempt++;
    return new Response(sseStream(
      { choices: [{ delta: attempt === 1 ? { content: 'no tool' } : { tool_calls: [{ index: 0, id: 't', function: { name: 'f', arguments: '{}' } }] } }] },
      { usage: { prompt_tokens: 2, completion_tokens: 3 } },
    ));
  });
  vi.stubGlobal('fetch', fetchMock);
  const result = await callLlm({ ...config, toolChoice: 'local-force' }, [], '', undefined, opts());
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.usage.inputTokens).toBe(4);
  expect(result.usage.outputTokens).toBe(6);
  expect(JSON.stringify(result.entries)).toContain('toolCall');
});

it.each([0, 2, 5])('local-force respects %s configured retries', async localForceMaxRetries => {
  const fetchMock = vi.fn(async () => new Response(sseStream()));
  vi.stubGlobal('fetch', fetchMock);
  await callLlm({ ...config, toolChoice: 'local-force', localForceMaxRetries }, [], '', undefined, opts());
  expect(fetchMock).toHaveBeenCalledTimes(localForceMaxRetries + 1);
});
