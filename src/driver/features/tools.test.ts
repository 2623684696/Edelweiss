import { describe, expect, it, vi } from 'vitest';

import { createToolFeature } from './tools';
import { hasAuthorizedImage2Request, hasExplicitImage2Request } from '../image2-command';
import type { MainTurnFeatureDeps } from './types';
import type { RenderedContext } from '../../rendering/types';
import { createTool } from '../tools/types';
import { createTurnScratch, type TurnContext } from '../turn-features';

const command = (text = '@liz /image2 draw a flower', receivedAtMs = 200): RenderedContext => [{
  receivedAtMs,
  content: [{ type: 'text', text: `<message id="1">${text}</message>` }],
}];

describe('image2 command authorization', () => {
  it('accepts plain-text @liz and commands without mentions', () => {
    expect(hasExplicitImage2Request(command(), 100)).toBe(true);
    expect(hasExplicitImage2Request(command('/image2 draw a flower'), 100)).toBe(true);
  });

  it('ignores old commands, quotes, ordinary requests, and other command names', () => {
    expect(hasExplicitImage2Request(command(), 200)).toBe(false);
    expect(hasExplicitImage2Request(command('<in-reply-to id="2">/image2 draw</in-reply-to>hello'), 100)).toBe(false);
    expect(hasExplicitImage2Request(command('draw a flower'), 100)).toBe(false);
    expect(hasExplicitImage2Request(command('/image22 draw'), 100)).toBe(false);
    expect(hasExplicitImage2Request(command('请问 /image2 怎么用'), 100)).toBe(false);
    expect(hasExplicitImage2Request(command('`/image2`'), 100)).toBe(false);
    expect(hasExplicitImage2Request(command('> /image2 draw'), 100)).toBe(false);
    expect(hasExplicitImage2Request(command('<in-reply-to id="2">hello</in-reply-to>\n/image2 draw'), 100)).toBe(true);
  });

  it.each(['isMyself', 'isSelfSent', 'isRuntimeEvent'] as const)('ignores %s commands', flag => {
    const rc = command();
    rc[0]![flag] = true;
    expect(hasExplicitImage2Request(rc, 100)).toBe(false);
  });

  it.each(['再生成一次', '重试一下', '重新生成一次', '再生成一张图片', '再来一张吧', '再画一次，光环保留', '@liz 再来一次', 'try again'])('allows a new explicit retry after /image2: %s', text => {
    expect(hasAuthorizedImage2Request([...command('/image2 draw', 50), ...command(text)], 100)).toBe(true);
    expect(hasAuthorizedImage2Request(command(text), 100)).toBe(false);
    expect(hasAuthorizedImage2Request([...command('/image2 draw', 50), ...command(text, 90)], 100)).toBe(false);
  });

  it.each(['draw a new picture', '画一张新图', '再来开个会', '重试次数是多少', '<in-reply-to id="2">再生成一次</in-reply-to>hello'])('does not authorize unrelated requests after an old command: %s', text => {
    expect(hasAuthorizedImage2Request([...command('/image2 draw', 50), ...command(text)], 100)).toBe(false);
  });

  it.each(['onebot', 'telegram'])('keeps tools visible and enforces execution authorization on %s', async platform => {
    const execute = vi.fn(async () => ({ content: '{"ok":true}', requiresFollowUp: true }));
    const image2 = createTool({ name: 'image2', parameters: { type: 'object' }, execute });
    const deps = {
      chatConfig: { platform, tools: { image2: { model: 'test' } } },
      createCapabilityTools: () => [image2],
      createSendMessageTurnFlags: () => ({}),
      lastProcessedMs: () => 100,
    } as unknown as MainTurnFeatureDeps;
    const ctx = {
      turn: { capabilities: { canStartSubagent: false }, reactionEmojis: [], rcAtStart: command('draw a flower') },
      scratch: createTurnScratch(),
    } as unknown as TurnContext;
    const feature = createToolFeature(deps);
    await feature.prepareTools!(ctx);
    expect(ctx.turn.tools.map(tool => tool.function.name)).toEqual(['image2']);
    expect(ctx.scratch.image2Available).toBe(true);
    const denied = ctx.turn.tools[0]!;
    expect(await denied.execute({}, { toolCallId: 'denied' })).toMatchObject({
      content: expect.stringContaining('requires an explicit /image2 command'),
    });
    expect(execute).not.toHaveBeenCalled();

    ctx.turn.rcAtStart = command();
    await feature.prepareTools!(ctx);
    expect(ctx.scratch.image2Requested).toBe(true);
    const allowed = ctx.turn.tools[0]!;
    await allowed.execute({}, { toolCallId: 'first' });
    await allowed.execute({}, { toolCallId: 'follow-up' });
    expect(execute).toHaveBeenCalledTimes(2);
    // A later preparation must not change authorization on an existing tool instance.
    await denied.execute({}, { toolCallId: 'still-denied' });
    expect(execute).toHaveBeenCalledTimes(2);

    ctx.turn.rcAtStart = [...command('/image2 draw', 50), ...command('再生成一次')];
    await feature.prepareTools!(ctx);
    await ctx.turn.tools[0]!.execute({}, { toolCallId: 'retry' });
    expect(execute).toHaveBeenCalledTimes(3);
  });
});
