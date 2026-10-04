import { injectLateBindingPrompt, wasToolLoopInterrupted } from '../context';
import { renderLateBindingPrompt, renderSystemPrompt } from '../prompt';
import type { DriverFeature } from '../turn-features';
import { buildMainSystemPromptParams } from '../turn-prefix';
import type { MainTurnFeatureDeps } from './types';

export const createPromptFeature = (deps: MainTurnFeatureDeps): DriverFeature => ({
  name: 'prompt',
  preparePrompt: async ctx => {
    const { turn } = ctx;
    turn.system = await renderSystemPrompt(buildMainSystemPromptParams({
      chatId: deps.chatId,
      chatName: await deps.getChatName(),
      chatConfig: deps.chatConfig,
      allSkills: deps.allSkills,
      reactionEmojis: turn.reactionEmojis,
      capabilities: turn.capabilities,
    }));

    const isInterrupted = wasToolLoopInterrupted(turn.trs);
    const isMentioned = turn.rcAtStart.some(seg =>
      seg.mentionsMe && seg.receivedAtMs > deps.lastProcessedMs());
    const isReplied = turn.rcAtStart.some(seg =>
      seg.repliesToMe && seg.receivedAtMs > deps.lastProcessedMs());
    const isAssociatedChannelPost = turn.rcAtStart.some(seg =>
      seg.isAssociatedChannelPost && seg.receivedAtMs > deps.lastProcessedMs());

    injectLateBindingPrompt(turn.entries, await renderLateBindingPrompt({
      timeNow: deps.nowString(),
      forceToolCall: deps.chatConfig.primaryModel.forceToolCall,
      isMentioned,
      isReplied,
      isAssociatedChannelPost,
      recentSendMessageHumanLikenessXml: ctx.scratch.recentSendMessageHumanLikenessXml,
      isInterrupted,
      activeBackgroundTasks: deps.getActiveBackgroundTasks(deps.chatId),
    }));
  },
});
