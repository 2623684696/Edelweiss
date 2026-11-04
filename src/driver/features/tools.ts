import { hasExplicitImage2Request } from '../image2-command';
import type { DriverFeature } from '../turn-features';
import type { MainTurnFeatureDeps } from './types';

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
    ctx.scratch.image2CommandGated = deps.chatConfig.platform === 'onebot'
      && Boolean(deps.chatConfig.tools.image2);
    ctx.scratch.image2Requested = hasExplicitImage2Request(
      turn.rcAtStart,
      deps.lastProcessedMs(),
    );

    const tools = [...sharedTools, ...subagentTools];
    turn.tools = deps.chatConfig.platform === 'onebot' && !ctx.scratch.image2Requested
      ? tools.filter(tool => tool.function.name !== 'image2')
      : tools;
    ctx.scratch.image2Available = turn.tools.some(tool => tool.function.name === 'image2');
  },
});
