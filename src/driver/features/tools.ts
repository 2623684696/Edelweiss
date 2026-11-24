import { hasAuthorizedImage2Request } from '../image2-command';
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
    ctx.scratch.image2CommandGated = Boolean(deps.chatConfig.tools.image2);
    ctx.scratch.image2Requested = hasAuthorizedImage2Request(
      turn.rcAtStart,
      deps.lastProcessedMs(),
    );

    const tools = [...sharedTools, ...subagentTools];
    const image2Allowed = ctx.scratch.image2Requested;
    turn.tools = tools.map(tool => tool.function.name === 'image2'
      ? {
          ...tool,
          execute: (input, options) => image2Allowed
            ? tool.execute(input, options)
            : {
                content: JSON.stringify({ ok: false, error: 'image2 requires an explicit /image2 command or an explicit retry of an earlier /image2 request in a new user message for this turn. No image request was sent.' }),
                requiresFollowUp: true,
              },
        }
      : tool);
    ctx.scratch.image2Available = turn.tools.some(tool => tool.function.name === 'image2');
  },
});
