import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderMarkdownString } from '@velin-dev/core';

import { memoryIndex, memoryUsage, type ChatMemory } from '../db/chat-memory';
import { cleanVelinOutput, renderPromptTemplate } from '../prompt-template';

const __dirname = dirname(fileURLToPath(import.meta.url));
const basePath = resolve(__dirname, '../../package.json');

const systemPromptTemplate = readFileSync(resolve(__dirname, '../../prompts/primary-system.velin.md'), 'utf-8');
const subagentSystemTemplate = readFileSync(resolve(__dirname, '../../prompts/subagent-system.velin.md'), 'utf-8');
const lateBindingTemplate = readFileSync(resolve(__dirname, '../../prompts/primary-late-binding.velin.md'), 'utf-8');
const compactionUserTemplate = readFileSync(resolve(__dirname, '../../prompts/compaction-late-binding.velin.md'), 'utf-8');

export interface AvailableSkillPromptInfo {
  id: string;
  title?: string;
  description?: string;
  usage?: string;
}

export interface SystemPromptParams {
  chatId: string;
  chatName: string;
  identityName: string;
  language?: string;
  modelName: string;
  currentChannel?: string;
  systemFiles?: { filename: string; content: string }[];
  hasLoadSkillTool?: boolean;
  hasSubagentTools?: boolean;
  hasReactTool?: boolean;
  hasAskForImageTool?: boolean;
  hasMemoryTools?: boolean;
  availableReactionEmojis?: string[];
  availableSkills?: AvailableSkillPromptInfo[];
  forceToolCall?: boolean | 'api' | 'local';
}

export const renderSystemPrompt = async (params: SystemPromptParams) => {
  return await renderPromptTemplate(systemPromptTemplate, {
    chatId: params.chatId.replace(/\s+/g, ' ').trim(),
    chatName: params.chatName.replace(/\s+/g, ' ').trim(),
    identityName: params.identityName.replace(/\s+/g, ' ').trim(),
    language: params.language,
    modelName: params.modelName,
    currentChannel: params.currentChannel,
    hasLoadSkillTool: params.hasLoadSkillTool,
    hasSubagentTools: params.hasSubagentTools,
    hasReactTool: params.hasReactTool,
    hasAskForImageTool: params.hasAskForImageTool,
    hasMemoryTools: params.hasMemoryTools,
    availableReactionEmojis: params.availableReactionEmojis,
    availableSkills: params.availableSkills,
    forceToolCall: params.forceToolCall !== false && params.forceToolCall !== undefined,
    systemFiles: params.systemFiles,
  }, basePath);
};

export const renderSubagentSystemPrompt = async (params: {
  language?: string;
  modelName: string;
  task: string;
  context?: string;
  expectedOutput?: string;
}) => {
  const { rendered } = await renderMarkdownString(subagentSystemTemplate, params, basePath);
  return cleanVelinOutput(rendered);
};

const renderMemorySnapshot = (memories: ChatMemory[]): string => {
  const usage = memoryUsage(memories);
  const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  return [
    '<chat-memories>',
    `<usage entries="${usage.entries}" characters="${usage.characters}" entry-limit="${usage.limits.entries}" character-limit="${usage.limits.totalCharacters}"/>`,
    ...memoryIndex(memories).map(memory => `<memory key="${escapeXml(memory.key)}" updated-at-ms="${memory.updatedAtMs}" expired="${memory.expired}" retention="${memory.retention.toFixed(3)}">${escapeXml(memory.summary)}</memory>`),
    '</chat-memories>',
  ].join('\n');
};

export const renderLateBindingPrompt = async (params: {
  timeNow: string;
  memories?: ChatMemory[];
  hasMemoryTools?: boolean;
  isMentioned?: boolean;
  isReplied?: boolean;
  isAssociatedChannelPost?: boolean;
  recentSendMessageHumanLikenessXml?: string;
  activeBackgroundTasks?: { id: number; typeName: string; intention?: string; liveSummary: string; startedMs: number; timeoutMs: number }[];
  isInterrupted?: boolean;
  forceToolCall?: boolean | 'api' | 'local';
}) => {
  const { memories, ...templateParams } = params;
  const { rendered } = await renderMarkdownString(lateBindingTemplate, {
    ...templateParams,
    forceToolCall: params.forceToolCall !== false && params.forceToolCall !== undefined,
  }, basePath);
  // Insert serialized data after Velin rendering, like system-file placeholders,
  // so Markdown escaping cannot corrupt XML entities or collapse memory lines.
  const cleaned = cleanVelinOutput(rendered);
  return params.hasMemoryTools
    ? cleaned.replace('CHAT_MEMORIES_SNAPSHOT', () => renderMemorySnapshot(memories ?? []))
    : cleaned;
};

export const renderCompactionUserInstruction = async () => {
  const { rendered } = await renderMarkdownString(compactionUserTemplate, {}, basePath);
  return cleanVelinOutput(rendered);
};
