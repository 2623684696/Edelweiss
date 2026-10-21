import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useLogger } from '@guiiai/logg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createChatMemoryStore, MEMORY_LIMITS, memoryIndex, memoryRetention } from './chat-memory';
import { createDatabase, runMigrations, type DB } from './client';

describe('chat memory persistence', () => {
  let db: DB;
  let directory: string;
  const log = useLogger('memory-test');

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'edelweiss-memory-test-'));
    db = createDatabase(join(directory, 'test.db'), log);
    runMigrations(db, log);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    db.$client.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('isolates reads, updates and deletion by both platform and chat ID', () => {
    const a = createChatMemoryStore(db, 'telegram', '100');
    const b = createChatMemoryStore(db, 'telegram', '200');
    const qq = createChatMemoryStore(db, 'onebot', '100');
    a.remember('topic', 'a');
    b.remember('topic', 'b');
    qq.remember('topic', 'qq');
    a.remember('topic', 'updated a');
    expect(a.list()).toMatchObject([{ key: 'topic', content: 'updated a' }]);
    expect(b.list()).toMatchObject([{ key: 'topic', content: 'b' }]);
    expect(qq.list()).toMatchObject([{ key: 'topic', content: 'qq' }]);
    expect(a.forget('topic')).toBe(true);
    expect(a.forget('topic')).toBe(false);
    expect(a.list()).toEqual([]);
    expect(b.list()).toHaveLength(1);
    expect(qq.list()).toHaveLength(1);
  });

  it('survives a database close and reopen, including forgotten entries', () => {
    const store = createChatMemoryStore(db, 'onebot', '100');
    store.remember('preference', 'durable fact', { source: 'message:123', reason: 'stable preference', summary: 'preference' });
    store.recall(['preference']);
    store.remember('obsolete', 'old fact');
    store.forget('obsolete');
    db.$client.close();
    db = createDatabase(join(directory, 'test.db'), log);
    runMigrations(db, log);
    expect(createChatMemoryStore(db, 'onebot', '100').list())
      .toMatchObject([{ key: 'preference', content: 'durable fact', source: 'message:123', reason: 'stable preference', lastRecalledAtMs: expect.any(Number) }]);
  });

  it('upgrades pre-metadata rows without deleting or expiring them', () => {
    db.$client.exec('DROP TABLE chat_memories');
    db.$client.exec(readFileSync('drizzle/0033_chat_memories.sql', 'utf8'));
    db.$client.prepare('INSERT INTO chat_memories (platform, chat_id, key, content, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)')
      .run('telegram', '100', 'legacy', 'original fact', 1, 2);
    db.$client.exec(readFileSync('drizzle/0034_flashy_absorbing_man.sql', 'utf8'));
    db.$client.exec(readFileSync('drizzle/0035_cloudy_tattoo.sql', 'utf8'));
    expect(createChatMemoryStore(db, 'telegram', '100').list()).toMatchObject([{
      key: 'legacy', content: 'original fact', updatedAtMs: 2, expiresAtMs: null, source: null, lastRecalledAtMs: null,
    }]);
  });

  it('trims input and treats an explicit same-key write as confirmation', () => {
    const store = createChatMemoryStore(db, 'telegram', '100');
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const first = store.remember(' key ', ' fact ');
    vi.mocked(Date.now).mockReturnValue(2000);
    expect(store.remember('key', 'fact').updatedAtMs).toBeGreaterThan(first.updatedAtMs);
    store.remember('key', 'correction');
    expect(store.list()).toMatchObject([{ key: 'key', content: 'correction' }]);
  });

  it('rejects empty or oversized values without losing existing memories', () => {
    const store = createChatMemoryStore(db, 'telegram', '100');
    store.remember('key', 'fact');
    expect(() => store.remember(' ', 'fact')).toThrow();
    expect(() => store.remember('key', ' ')).toThrow();
    expect(() => store.remember('x'.repeat(65), 'fact')).toThrow();
    expect(() => store.remember('key', 'x'.repeat(MEMORY_LIMITS.contentLength + 1))).toThrow();
    expect(store.list()[0]?.content).toBe('fact');
  });

  it('enforces entry limits per chat while allowing updates and explicit deletion', () => {
    const store = createChatMemoryStore(db, 'telegram', '100');
    for (let i = 0; i < MEMORY_LIMITS.entries; i++) store.remember(`key${i}`, 'fact');
    expect(() => store.remember('overflow', 'fact')).toThrow('full');
    store.remember('key0', 'updated');
    store.forget('key1');
    store.remember('new', 'fact');
    expect(store.list()).toHaveLength(MEMORY_LIMITS.entries);
    expect(() => createChatMemoryStore(db, 'telegram', '200').remember('new', 'fact')).not.toThrow();
  });

  it('enforces total character budget atomically', () => {
    const store = createChatMemoryStore(db, 'telegram', '100');
    for (let i = 0; i < 28; i++) store.remember(`key${i}`, 'x'.repeat(2000));
    const before = store.list();
    expect(() => store.remember('overflow', 'x'.repeat(2000))).toThrow('budget');
    expect(store.list()).toEqual(before);
    store.remember('key0', 'short');
    expect(() => store.remember('overflow', 'x'.repeat(2000))).not.toThrow();
  });

  it('persists provenance, tracks scoped recall and renews TTL only on writes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const store = createChatMemoryStore(db, 'telegram', '100');
    const other = createChatMemoryStore(db, 'telegram', '200');
    const first = store.remember('link', 'temporary detail', { ttlDays: 7, summary: 'shared link', reason: 'follow up', source: 'message:42' });
    other.remember('link', 'other');
    vi.mocked(Date.now).mockReturnValue(2000);
    expect(store.recall(['link', 'missing'])).toMatchObject([{ lastRecalledAtMs: 2000, expiresAtMs: first.expiresAtMs, source: 'message:42' }]);
    expect(other.list()[0]?.lastRecalledAtMs).toBeNull();
    expect(store.remember('link', 'temporary detail').expiresAtMs).toBe(2000 + 7 * 86400000);
    expect(store.remember('link', 'temporary detail', { ttlDays: null }).expiresAtMs).toBeNull();
    expect(() => store.remember('bad', 'content', { ttlDays: 0 })).toThrow('TTL');
    expect(() => store.recall([])).toThrow();
  });

  it('decays priority without modifying data and ranks expired memories last', () => {
    const old = { key: 'old', content: 'fact', updatedAtMs: 0 };
    expect(memoryRetention(old, 7 * 86400000)).toBeCloseTo(Math.exp(-1));
    expect(memoryRetention(old, -100)).toBe(1);
    expect(memoryIndex([old, { ...old, key: 'new', updatedAtMs: 86400000 },
      { ...old, key: 'expired', updatedAtMs: 86400000, expiresAtMs: 1 }], 86400000).map(m => m.key))
      .toEqual(['new', 'old', 'expired']);
  });

  it('reinforces only spaced nonexpired recalls, persists strength and resets corrected content', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    const store = createChatMemoryStore(db, 'telegram', '100');
    store.remember('profile', 'original');
    store.remember('temporary', 'expired soon', { ttlDays: 1 });
    clock.mockReturnValue(86400000);
    expect(store.list()[0]?.reinforcementCount).toBe(0);
    const reinforced = store.recall(['profile', 'profile'])[0]!;
    expect(reinforced).toMatchObject({ stabilityDays: 11, reinforcementCount: 1, lastReinforcedAtMs: 86400000 });
    expect(store.recall(['profile'])[0]?.reinforcementCount).toBe(1);
    expect(store.recall(['temporary'])[0]?.reinforcementCount).toBe(0);
    expect(store.list().find(m => m.key === 'temporary')?.expiresAtMs).toBe(86400000);
    for (let day = 2; day <= 30; day++) {
      clock.mockReturnValue(day * 86400000);
      store.recall(['profile']);
    }
    expect(store.list().find(m => m.key === 'profile')?.stabilityDays).toBe(180);
    db.$client.close();
    db = createDatabase(join(directory, 'test.db'), log);
    const reopened = createChatMemoryStore(db, 'telegram', '100');
    expect(reopened.list().find(m => m.key === 'profile')?.stabilityDays).toBe(180);
    expect(reopened.remember('profile', 'corrected')).toMatchObject({ stabilityDays: 7, reinforcementCount: 0, lastReinforcedAtMs: null });
  });
});
