import { describe, expect, it, vi } from 'vitest';

import { createMemoryTools } from './memory';
import type { ChatMemoryStore } from '../../db/chat-memory';
import { MEMORY_LIMITS, MemoryCapacityError } from '../../db/chat-memory';

const makeStore = (): ChatMemoryStore => ({ list: vi.fn(() => []), recall: vi.fn(() => []), remember: vi.fn(), forget: vi.fn(() => true) });
const options = { toolCallId: 'test' };

describe('memory tools', () => {
  it('validates inputs and does not accept an arbitrary chat or platform', () => {
    const tools = createMemoryTools(makeStore());
    const remember = tools[0]!;
    expect(remember.validate({ key: 'user:123:preference', content: 'Prefers tea' }).valid).toBe(true);
    expect(remember.validate({ key: 'key', content: 'fact', chat_id: 'other' }).valid).toBe(false);
    expect(remember.validate({ key: 'key', content: 'fact', platform: 'other' }).valid).toBe(false);
    expect(remember.validate({ key: '', content: 'fact' }).valid).toBe(false);
    expect(remember.validate({ key: 'key', content: 'x'.repeat(MEMORY_LIMITS.contentLength + 1) }).valid).toBe(false);
    expect(remember.validate({ key: 'key', content: 'fact', ttlDays: null }).valid).toBe(true);
    expect(remember.validate({ key: 'key', content: 'fact', ttlDays: 0 }).valid).toBe(false);
    expect(tools[1]!.validate({ key: 'key' }).valid).toBe(true);
    expect(tools[2]!.validate({ chat_id: 'other' }).valid).toBe(false);
  });

  it('writes only on an explicit tool call and returns errors without claiming success', async () => {
    const store = makeStore();
    const [remember, forget, recall] = createMemoryTools(store);
    expect(store.remember).not.toHaveBeenCalled();
    await remember!.execute({ key: 'key', content: 'fact' }, options);
    expect(store.remember).toHaveBeenCalledWith('key', 'fact', {});
    await forget!.execute({ key: 'key' }, options);
    expect(store.forget).toHaveBeenCalledWith('key');
    await recall!.execute({}, options);
    expect(store.list).toHaveBeenCalledTimes(2);
    vi.mocked(store.remember).mockImplementation(() => { throw new Error('Memory is full'); });
    const result = await remember!.execute({ key: 'key', content: 'fact' }, options);
    expect(JSON.parse(result.content as string)).toEqual({ ok: false, error: 'Memory is full' });
    expect(result.requiresFollowUp).toBe(true);
    expect(remember!.execution?.lane).toBe('writer');
    expect(forget!.execution?.lane).toBe('writer');
    expect(recall!.execution?.lane).toBe('serial');
  });

  it('returns summary-only expired recalls and actionable capacity errors', async () => {
    const store = makeStore();
    const memory = { key: 'link', content: 'full original detail', summary: 'old sharing', updatedAtMs: 1, expiresAtMs: 2 };
    vi.mocked(store.list).mockReturnValue([memory]);
    vi.mocked(store.recall).mockReturnValue([memory]);
    const [remember, , recall] = createMemoryTools(store);
    const index = JSON.parse((await recall!.execute({}, options)).content as string);
    expect(JSON.stringify(index)).not.toContain('full original detail');
    expect(store.recall).not.toHaveBeenCalled();
    const recalled = JSON.parse((await recall!.execute({ keys: ['link', 'missing'] }, options)).content as string);
    expect(recalled.result.memories[0]).toMatchObject({ content: 'old sharing', expired: true });
    expect(recalled.result.missingKeys).toEqual(['missing']);
    vi.mocked(store.remember).mockImplementation(() => { throw new MemoryCapacityError('full', [memory]); });
    const failed = JSON.parse((await remember!.execute({ key: 'new', content: 'fact' }, options)).content as string);
    expect(failed).toMatchObject({ ok: false, usage: { entries: 1 }, consolidationCandidates: [{ key: 'link', expired: true }] });
  });
});
