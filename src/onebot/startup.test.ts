import { useLogger } from '@guiiai/logg';
import { describe, expect, it, vi } from 'vitest';

import { createOneBotServer } from './index';
import { startOneBot } from './startup';
import type { OneBotStartupDeps } from './startup';
import type { OneBotMessageEvent } from './types';

vi.mock('./index', () => ({
  createOneBotServer: vi.fn(),
  createOneBotPlatformAdapter: vi.fn(() => ({})),
}));

vi.mock('./ingress', () => ({
  createOneBotIngress: vi.fn(() => ({ enqueue: vi.fn() })),
}));

vi.mock('./image-to-text', () => ({
  resolveOneBotImageAltText: vi.fn(),
}));

vi.mock('./post-startup', () => ({
  createOneBotPostStartupTasks: vi.fn(() => ({ run: vi.fn() })),
}));

describe('startOneBot history replay', () => {
  it('survives member lookup failures in historical mentions and persists the remaining batch', async () => {
    const message = (messageId: number): OneBotMessageEvent => ({
      post_type: 'message',
      message_type: 'group',
      time: messageId,
      self_id: 999,
      user_id: 42,
      group_id: 100,
      message_id: messageId,
      message: [{ type: 'text', data: { text: 'hello' } }],
      raw_message: 'hello',
      sender: { user_id: 42, nickname: 'sender' },
    });
    const mention = message(2);
    mention.message = [{ type: 'at', data: { qq: '123' } }];
    const getGroupMemberInfo = vi.fn().mockRejectedValue(new Error('OneBot API error: retcode=1200'));
    const api = {
      fetchMessages: vi.fn().mockResolvedValueOnce([message(1), mention, message(3)]).mockResolvedValue([]),
      getFriendRemark: vi.fn().mockResolvedValue(undefined),
      getGroupMemberInfo,
    };
    const server = { api, start: vi.fn(), stop: vi.fn() };
    vi.mocked(createOneBotServer).mockReturnValue(server as unknown as ReturnType<typeof createOneBotServer>);
    const persistEvent = vi.fn();
    const replayChat = vi.fn();
    const deps = {
      config: { enabled: true },
      chatIds: ['100'],
      runtimeConfig: {},
      logger: useLogger('onebot-startup-test'),
      resolveChatPlatform: () => 'onebot',
      imageToTextChatIds: new Set<string>(),
      getLastMessageId: () => '1',
      registerAdapter: vi.fn(),
      redactBlockedMessage: (event: unknown) => event,
      persistEvent,
      hydrateAltTextFromCache: vi.fn(),
      loadCompaction: vi.fn(),
      loadEvents: vi.fn(() => []),
      replayChat,
      getRenderedContext: vi.fn(),
    } as unknown as OneBotStartupDeps;

    await expect(startOneBot(deps)).resolves.toBeDefined();
    expect(getGroupMemberInfo).toHaveBeenCalledWith('100', '123');
    expect(persistEvent).toHaveBeenCalledTimes(2);
    expect(persistEvent.mock.calls[0]?.[0]).toMatchObject({
      messageId: '2',
      content: [{ type: 'mention', userId: '123', children: [{ type: 'text', text: '@123' }] }],
    });
    expect(persistEvent.mock.calls[1]?.[0]).toMatchObject({ messageId: '3' });
    expect(replayChat).toHaveBeenCalledWith('100', []);
  });
});
