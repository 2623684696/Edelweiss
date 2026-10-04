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
    it(`sends tool_choice for ${name} and overrides forceToolCall`, async () => {
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
          // forceToolCall would otherwise emit `required` / `{ type: 'any' }`.
          forceToolCall: true,
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
