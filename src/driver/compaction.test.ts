import { useLogger } from '@guiiai/logg';
import { describe, expect, it, vi } from 'vitest';

import { callLlm } from './call-llm';
import { runCompaction } from './compaction';
import { renderCompactionUserInstruction } from './prompt';

vi.mock('./call-llm', () => ({ callLlm: vi.fn() }));

describe('compaction cached prefix', () => {
  it('keeps compressor rules in the final instruction while reusing system and tools', async () => {
    vi.mocked(callLlm).mockResolvedValue({
      entries: [{ kind: 'message', role: 'assistant', parts: [{ kind: 'text', text: 'summary' }] }],
      usage: { inputTokens: 10, outputTokens: 2 },
    } as Awaited<ReturnType<typeof callLlm>>);
    const tools = [{ name: 'send_message', parameters: { type: 'object' } }];
    const log = useLogger('compaction-test');
    const result = await runCompaction({
      chatId: '100', model: 'test', apiBaseUrl: 'https://example.com', apiKey: 'test',
      system: 'main system', tools, rcWindow: [], trsWindow: [],
      oldCursorMs: 0, newCursorMs: 100, log,
    });
    const instruction = await renderCompactionUserInstruction();
    expect(instruction).toContain('ROLE OVERRIDE');
    expect(instruction).toContain('conversation context compressor');
    expect(result.summary).toBe('summary');
    expect(callLlm).toHaveBeenCalledWith(expect.anything(), [
      { kind: 'message', role: 'user', parts: [{ kind: 'text', text: instruction }] },
    ], 'main system', tools, expect.objectContaining({ toolChoice: 'none' }));
  });
});
