import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig, resolveChatConfig } from './config';

vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));

const loadFixture = (chats: Record<string, unknown> = {}) => {
  vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
    models: { primary: { apiBaseUrl: '', apiKey: '', model: 'test' } },
    runtime: { writeFile: ['tee'], readFile: ['cat'] },
    chats: { default: { tools: { webSearch: { tavilyKey: 'test' } } }, ...chats },
  }));
  return loadConfig();
};

beforeEach(() => vi.clearAllMocks());

describe('disabledReactions config', () => {
  it('defaults to the disabled list without a config entry', () => {
    expect(resolveChatConfig(loadFixture(), 'chat').disabledReactions).toEqual(['😁', '🖕', '😇']);
  });

  it('replaces rather than index-merges per-chat lists, including empty lists', () => {
    const config = loadFixture({ a: { disabledReactions: ['👍'] }, b: { disabledReactions: [] } });
    expect(resolveChatConfig(config, 'a').disabledReactions).toEqual(['👍']);
    expect(resolveChatConfig(config, 'b').disabledReactions).toEqual([]);
    expect(resolveChatConfig(config, 'other').disabledReactions).toEqual(['😁', '🖕', '😇']);
    expect(config.chats.default.disabledReactions).toEqual(['😁', '🖕', '😇']);
  });

  it('inherits a configured default and validates overrides', () => {
    const config = loadFixture({ default: { disabledReactions: ['❤️'], tools: { webSearch: { tavilyKey: 'test' } } } });
    expect(resolveChatConfig(config, 'chat').disabledReactions).toEqual(['❤️']);
    expect(() => loadFixture({ a: { disabledReactions: [42] } })).toThrow();
  });
});
