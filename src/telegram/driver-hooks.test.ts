import { describe, expect, it, vi } from 'vitest';

import { createTelegramDriverHooks } from './driver-hooks';
import type { TelegramDriverHooksDeps } from './driver-hooks';
import { filterDisabledReactions, isReactionDisabled } from './reaction-policy';
import { createReactMessageTool } from '../driver/tools/react-message';

const defaults = ['😁', '🖕', '😇'];
const available = ['👍', '😁', '🖕', '😇', '❤️'];

const createFixture = () => {
  const sendReaction = vi.fn(async () => {});
  const policies: Record<string, string[]> = { unblocked: [], custom: ['👍'] };
  const deps = {
    manager: {
      userbot: {},
      refreshAllowedReactionEmojis: vi.fn(async () => [...available]),
      getAllowedReactionEmojis: vi.fn(() => [...available]),
      sendReaction,
    },
    getDisabledReactions: (id: string) => policies[id] ?? defaults,
  } as unknown as TelegramDriverHooksDeps;
  return { hooks: createTelegramDriverHooks(deps), sendReaction, policies };
};

describe('Telegram outgoing reaction policy', () => {
  it('matches exact Telegram reaction emoji strings', () => {
    expect(isReactionDisabled('🖕', defaults)).toBe(true);
    expect(isReactionDisabled('👍', defaults)).toBe(false);
    expect(filterDisabledReactions(available, defaults)).toEqual(['👍', '❤️']);
  });

  it('filters fresh and cached lists per-chat without mutating Telegram capability lists', async () => {
    const { hooks } = createFixture();
    expect(await hooks.refreshAllowedReactionEmojis!('default')).toEqual(['👍', '❤️']);
    expect(hooks.getAllowedReactionEmojis!('default')).toEqual(['👍', '❤️']);
    expect(hooks.getAllowedReactionEmojis!('unblocked')).toEqual(available);
    expect(hooks.getAllowedReactionEmojis!('custom')).toEqual(available.slice(1));
    expect(available).toEqual(['👍', '😁', '🖕', '😇', '❤️']);
  });

  it('returns no capability when every available reaction is disabled', async () => {
    const { hooks, policies } = createFixture();
    policies.all = available;
    expect(await hooks.refreshAllowedReactionEmojis!('all')).toEqual([]);
    expect(hooks.getAllowedReactionEmojis!('all')).toEqual([]);
  });

  it('rejects disabled calls at the send boundary, including stale tools', async () => {
    const { hooks, sendReaction, policies } = createFixture();
    for (const emoji of ['😁', '😇', '🖕'])
      await expect(hooks.sendReaction('default', 1, emoji)).rejects.toThrow('disabled');
    expect(sendReaction).not.toHaveBeenCalled();
    const staleTool = createReactMessageTool(hooks.getAllowedReactionEmojis!('unblocked'),
      async (id, emoji) => await hooks.sendReaction('unblocked', Number(id), emoji));
    policies.unblocked = defaults;
    await expect(staleTool.execute({ message_id: '1', emoji: '😁' }, { toolCallId: 'stale' })).rejects.toThrow('disabled');
    await hooks.sendReaction('default', 1, '👍');
    expect(sendReaction).toHaveBeenCalledExactlyOnceWith('default', 1, '👍');
  });

  it('omits disabled emojis from the tool enum and rejects direct execution', async () => {
    const { hooks, sendReaction } = createFixture();
    const tool = createReactMessageTool(hooks.getAllowedReactionEmojis!('default'),
      async (id, emoji) => await hooks.sendReaction('default', Number(id), emoji));
    expect(JSON.stringify(tool.function.parameters)).not.toMatch(/😁|🖕|😇/u);
    const result = await tool.execute({ message_id: '1', emoji: '😁' }, { toolCallId: 'test' });
    expect(JSON.parse(result.content as string).ok).toBe(false);
    expect(sendReaction).not.toHaveBeenCalled();
  });
});
