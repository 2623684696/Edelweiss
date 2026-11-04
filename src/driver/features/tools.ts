import type { DriverFeature } from '../turn-features';
import type { MainTurnFeatureDeps } from './types';

const IMAGE2_COMMAND_RE = /(?:^|[\s>])\/image2(?=$|[\s<])/u;
const REPLY_QUOTE_RE = /<in-reply-to\b[^>]*>[\s\S]*?<\/in-reply-to>/gu;

export const createToolFeature = (deps: MainTurnFeatureDeps): DriverFeature => ({
  name: 'tools',
  prepareTools: ctx => {
    const { turn } = ctx;
    const sharedTools = deps.createCapabilityTools(
      turn.capabilities,
      turn.reactionEmojis,
      deps.createSendMessageTurnFlags(turn),
    );
    const subagentTools = turn.capabilities.canStartSubagent ? deps.subagentManager.mainTools() : [];
    ctx.scratch.oneBotImage2Requested = deps.chatConfig.platform === 'onebot'
      && turn.rcAtStart.some(segment => segment.receivedAtMs > deps.lastProcessedMs()
        && segment.mentionsMe
        && segment.content.some(piece => piece.type === 'text'
          && IMAGE2_COMMAND_RE.test(piece.text.replace(REPLY_QUOTE_RE, ''))));

    const tools = [...sharedTools, ...subagentTools];
    turn.tools = deps.chatConfig.platform === 'onebot' && !ctx.scratch.oneBotImage2Requested
      ? tools.filter(tool => tool.function.name !== 'image2')
      : tools;
  },
});
