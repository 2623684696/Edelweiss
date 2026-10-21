import { and, asc, eq } from 'drizzle-orm';

import type { DB } from './client';
import { chatMemories } from './schema';

export const MEMORY_LIMITS = { entries: 150, keyLength: 64, contentLength: 2000, totalCharacters: 60000 } as const;
export const MEMORY_DECAY = { initialDays: 7, maximumDays: 180, cooldownMs: 86400000 } as const;

export interface MemoryOptions {
  reason?: string;
  source?: string;
  summary?: string;
  ttlDays?: number | null;
}

export interface ChatMemory {
  key: string;
  content: string;
  updatedAtMs: number;
  reason?: string | null;
  source?: string | null;
  summary?: string | null;
  ttlDays?: number | null;
  expiresAtMs?: number | null;
  lastRecalledAtMs?: number | null;
  stabilityDays?: number;
  reinforcementCount?: number;
  lastReinforcedAtMs?: number | null;
}

export interface ChatMemoryStore {
  list(): ChatMemory[];
  remember(key: string, content: string, options?: MemoryOptions): ChatMemory;
  recall(keys: string[]): ChatMemory[];
  forget(key: string): boolean;
}

const normalize = (value: string, label: string, limit: number): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > limit)
    throw new Error(`${label} must contain 1-${limit} characters after trimming`);
  return normalized;
};

export const memoryUsage = (memories: ChatMemory[]) => ({
  entries: memories.length,
  characters: memories.reduce((sum, m) => sum + m.key.length + m.content.length
    + (m.reason?.length ?? 0) + (m.source?.length ?? 0) + (m.summary?.length ?? 0), 0),
  limits: MEMORY_LIMITS,
});

// A ranking heuristic inspired by forgetting curves, not a probability of factual correctness.
export const memoryRetention = (memory: ChatMemory, now = Date.now()): number => {
  const anchor = Math.max(memory.updatedAtMs, memory.lastReinforcedAtMs ?? memory.updatedAtMs);
  const ageDays = Math.max(0, now - anchor) / 86400000;
  return Math.exp(-ageDays / Math.max(1, memory.stabilityDays ?? MEMORY_DECAY.initialDays));
};

export const memoryIndex = (memories: ChatMemory[], now = Date.now()) => memories.map(m => ({
  key: m.key, summary: m.summary ?? m.content.slice(0, 100), updatedAtMs: m.updatedAtMs,
  lastRecalledAtMs: m.lastRecalledAtMs ?? null,
  expiresAtMs: m.expiresAtMs ?? null, expired: m.expiresAtMs != null && m.expiresAtMs <= now,
  retention: memoryRetention(m, now),
})).sort((a, b) => Number(a.expired) - Number(b.expired) || b.retention - a.retention || a.key.localeCompare(b.key));

export class MemoryCapacityError extends Error {
  constructor(message: string, readonly memories: ChatMemory[]) { super(message); }
}

// Scope is bound by the application, never supplied by a model tool call.
export const createChatMemoryStore = (db: DB, platform: string, chatId: string): ChatMemoryStore => {
  if (!platform || !chatId) throw new Error('A platform and chat ID are required for memory storage');
  const scope = and(eq(chatMemories.platform, platform), eq(chatMemories.chatId, chatId));
  const fields = {
    key: chatMemories.key, content: chatMemories.content, updatedAtMs: chatMemories.updatedAtMs,
    reason: chatMemories.reason, source: chatMemories.source, summary: chatMemories.summary,
    ttlDays: chatMemories.ttlDays, expiresAtMs: chatMemories.expiresAtMs, lastRecalledAtMs: chatMemories.lastRecalledAtMs,
    stabilityDays: chatMemories.stabilityDays, reinforcementCount: chatMemories.reinforcementCount,
    lastReinforcedAtMs: chatMemories.lastReinforcedAtMs,
  };

  return {
    list: () => db.select(fields).from(chatMemories).where(scope).orderBy(asc(chatMemories.key)).all(),
    recall(keys) {
      if (!Array.isArray(keys) || keys.length < 1 || keys.length > 10) throw new Error('Recall requires 1-10 keys');
      const normalized = [...new Set(keys.map(key => normalize(key, 'Memory key', MEMORY_LIMITS.keyLength)))];
      return db.transaction(tx => {
        const now = Date.now();
        return normalized.flatMap(key => {
          const condition = and(scope, eq(chatMemories.key, key));
          const previous = tx.select(fields).from(chatMemories).where(condition).get();
          if (!previous) return [];
          const eligible = (previous.expiresAtMs == null || previous.expiresAtMs > now)
            && now - Math.max(previous.updatedAtMs, previous.lastReinforcedAtMs ?? previous.updatedAtMs) >= MEMORY_DECAY.cooldownMs;
          const row = tx.update(chatMemories).set({
            lastRecalledAtMs: now,
            ...(eligible ? {
              stabilityDays: Math.min(MEMORY_DECAY.maximumDays, Math.ceil(previous.stabilityDays * 1.5)),
              reinforcementCount: previous.reinforcementCount + 1,
              lastReinforcedAtMs: now,
            } : {}),
          }).where(condition).returning(fields).get();
          return row ? [row] : [];
        });
      }, { behavior: 'immediate' });
    },
    remember(rawKey, rawContent, options = {}) {
      const key = normalize(rawKey, 'Memory key', MEMORY_LIMITS.keyLength);
      const content = normalize(rawContent, 'Memory content', MEMORY_LIMITS.contentLength);
      const metadata = {
        ...(options.reason !== undefined ? { reason: normalize(options.reason, 'Memory reason', 300) } : {}),
        ...(options.source !== undefined ? { source: normalize(options.source, 'Memory source', 500) } : {}),
        ...(options.summary !== undefined ? { summary: normalize(options.summary, 'Memory summary', 100) } : {}),
      };
      if (options.ttlDays != null && (!Number.isInteger(options.ttlDays) || options.ttlDays < 1 || options.ttlDays > 365))
        throw new Error('Memory TTL must be null or 1-365 days');
      return db.transaction(tx => {
        const memories = tx.select(fields).from(chatMemories).where(scope).all();
        const previous = memories.find(memory => memory.key === key);
        const now = Date.now();
        const ttlDays = options.ttlDays === undefined ? previous?.ttlDays ?? null : options.ttlDays;
        const next = {
          ...previous, key, content, ...metadata,
          summary: metadata.summary ?? (previous?.content === content ? previous.summary : content.slice(0, 100)),
          ttlDays, expiresAtMs: ttlDays === null ? null : now + ttlDays * 86400000, updatedAtMs: now,
          ...(previous && previous.content !== content ? {
            stabilityDays: MEMORY_DECAY.initialDays, reinforcementCount: 0, lastReinforcedAtMs: null,
          } : {}),
        };
        if (!previous && memories.length >= MEMORY_LIMITS.entries)
          throw new MemoryCapacityError('Memory is full; update or forget an existing entry first', memories);
        const size = memoryUsage([...memories.filter(memory => memory.key !== key), next]).characters;
        if (size > MEMORY_LIMITS.totalCharacters)
          throw new MemoryCapacityError('Memory character budget exceeded; shorten or forget existing entries first', memories);
        return tx.insert(chatMemories).values({ platform, chatId, ...next, createdAtMs: now })
          .onConflictDoUpdate({
            target: [chatMemories.platform, chatMemories.chatId, chatMemories.key],
            set: next,
          })
          .returning(fields).get();
      }, { behavior: 'immediate' });
    },
    forget(rawKey) {
      const key = normalize(rawKey, 'Memory key', MEMORY_LIMITS.keyLength);
      return db.delete(chatMemories).where(and(scope, eq(chatMemories.key, key))).run().changes > 0;
    },
  };
};
