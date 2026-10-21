import { createTool, type CahciuaTool, type ToolResult } from './types';
import { MEMORY_LIMITS, MemoryCapacityError, memoryIndex, memoryUsage, type MemoryOptions, type ChatMemoryStore } from '../../db/chat-memory';

const result = (action: () => unknown): ToolResult => {
  try {
    return { content: JSON.stringify({ ok: true, result: action() }), requiresFollowUp: true };
  } catch (error) {
    const details = error instanceof MemoryCapacityError ? {
      usage: memoryUsage(error.memories),
      consolidationCandidates: memoryIndex(error.memories).sort((a, b) => Number(b.expired) - Number(a.expired)
        || a.retention - b.retention
        || (a.lastRecalledAtMs ?? a.updatedAtMs) - (b.lastRecalledAtMs ?? b.updatedAtMs)).slice(0, 5),
    } : {};
    return { content: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), ...details }), requiresFollowUp: true };
  }
};

export const createMemoryTools = (store: ChatMemoryStore): CahciuaTool[] => {
  const key = { type: 'string', minLength: 1, maxLength: MEMORY_LIMITS.keyLength, description: 'Stable key, preferably user:<numeric-id>:profile for a person. Reuse existing keys; consolidate related facts.' };
  return [
    createTool({
      name: 'remember',
      description: 'Save or update one durable fact in this chat only. Decide whether it is worth remembering. Survives restarts and context compaction.',
      execution: { lane: 'writer' },
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          key, content: { type: 'string', minLength: 1, maxLength: MEMORY_LIMITS.contentLength },
          summary: { type: 'string', minLength: 1, maxLength: 100, description: 'Compact index description; also shown instead of expired content.' },
          reason: { type: 'string', minLength: 1, maxLength: 300, description: 'Why this helps future conversations.' },
          source: { type: 'string', minLength: 1, maxLength: 500, description: 'Observed message IDs, user IDs, dates or URLs. Preserve provenance when merging; never invent it.' },
          ttlDays: { type: ['integer', 'null'], minimum: 1, maximum: 365, description: 'Temporary facts: typically 7-14 days. Null means durable; omitted preserves existing TTL. Updating renews it.' },
        },
        required: ['key', 'content'],
      },
      execute: input => {
        const { key, content, ...options } = input as { key: string; content: string } & MemoryOptions;
        return result(() => ({ memory: store.remember(key, content, options), usage: memoryUsage(store.list()) }));
      },
    }),
    createTool({
      name: 'forget_memory',
      description: 'Delete one outdated, incorrect, or unwanted long-term memory from this chat only.',
      execution: { lane: 'writer' },
      parameters: { type: 'object', additionalProperties: false, properties: { key }, required: ['key'] },
      execute: input => result(() => ({ deleted: store.forget((input as { key: string }).key) })),
    }),
    createTool({
      name: 'recall_memories',
      description: 'Without keys, list the memory index and usage without reinforcement. Supply 1-10 relevant exact keys to retrieve details and record use; eligible recalls reinforce retention at most once per 24 hours. Expired entries return summaries only and are not reinforced. Reading never renews validity.',
      execution: { lane: 'serial' },
      parameters: { type: 'object', additionalProperties: false, properties: { keys: { type: 'array', items: key, minItems: 1, maxItems: 10, uniqueItems: true } } },
      execute: input => result(() => {
        const { keys } = input as { keys?: string[] };
        const memories = keys ? store.recall(keys) : store.list();
        return {
          usage: memoryUsage(keys ? store.list() : memories),
          memories: keys ? memories.map(m => {
            const expired = m.expiresAtMs != null && m.expiresAtMs <= Date.now();
            return { ...m, expired, content: expired ? m.summary ?? m.content.slice(0, 100) : m.content };
          }) : memoryIndex(memories),
          ...(keys ? { missingKeys: keys.filter(key => !memories.some(m => m.key === key.trim())) } : {}),
        };
      }),
    }),
  ];
};
