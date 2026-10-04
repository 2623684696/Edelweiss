import type { Logger } from '@guiiai/logg';

import { callLlm, type LlmCallConfig, type ToolSchema } from './call-llm';
import { composeContext } from './context';
import { renderCompactionUserInstruction } from './prompt';
import type { CompactionSessionMeta, TurnResponseV2 } from './types';
import type { RenderedContext } from '../rendering/types';
import type {
  ConversationEntry,
  InputMessage,
  OutputMessage,
} from '../unified-api/types';

export interface CompactionParams extends LlmCallConfig {
  chatId: string;
  /** Main-turn system prompt reused for prompt-cache prefix continuity. */
  system: string;
  /** Main-turn tool schema, sent so the cached prefix matches (calls forbidden via tool_choice: none). */
  tools?: ToolSchema[];
  rcWindow: RenderedContext;
  trsWindow: TurnResponseV2[];
  existingSummary?: string;
  oldCursorMs: number;
  newCursorMs: number;
  maxImagesAllowed?: number;
  log: Logger;
}

const COMPACT_MAX_TOKENS = 200000;
const MAX_RETRIES = 3;

const extractAssistantText = (entries: ConversationEntry[]): string => {
  const parts: string[] = [];
  for (const e of entries) {
    if (e.kind !== 'message' || e.role !== 'assistant') continue;
    for (const p of (e as OutputMessage).parts) {
      if (p.kind === 'text') parts.push(p.text);
      else if (p.kind === 'textGroup') for (const t of p.content) parts.push(t.text);
    }
  }
  return parts.join('');
};

export const runCompaction = async (params: CompactionParams): Promise<CompactionSessionMeta> => {
  const compactUserInstruction = await renderCompactionUserInstruction();

  const ctx = composeContext(
    params.rcWindow, params.trsWindow, COMPACT_MAX_TOKENS,
    params.model, params.existingSummary,
  );

  const entries: ConversationEntry[] = [
    ...(ctx?.entries ?? []),
    { kind: 'message', role: 'user', parts: [{ kind: 'text', text: compactUserInstruction }] } satisfies InputMessage,
  ];

  let summary = '';
  let inputTokens = 0;
  let outputTokens = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await callLlm(params, entries, params.system, params.tools, {
      log: params.log,
      label: `compact:${params.chatId}`,
      dumpId: `${params.chatId}.compact`,
      maxImagesAllowed: params.maxImagesAllowed,
      toolChoice: 'none',
    });
    summary = extractAssistantText(result.entries);
    inputTokens = result.usage.inputTokens;
    outputTokens = result.usage.outputTokens;
    if (summary) break;
    params.log.withFields({ chatId: params.chatId, attempt, maxRetries: MAX_RETRIES })
      .warn('Compaction LLM returned empty content, retrying');
  }

  if (!summary)
    throw new Error('compaction produced empty summary');

  return { oldCursorMs: params.oldCursorMs, newCursorMs: params.newCursorMs, summary, inputTokens, outputTokens };
};
