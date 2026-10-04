import type { DriverFeature } from '../turn-features';
import { buildMainCapabilities } from '../turn-prefix';
import type { MainTurnFeatureDeps } from './types';

export const createCapabilityFeature = (deps: MainTurnFeatureDeps): DriverFeature => ({
  name: 'capability',
  prepareCapabilities: ctx => {
    const { turn } = ctx;
    Object.assign(turn.capabilities, buildMainCapabilities(deps.chatConfig, turn.reactionEmojis));
  },
});
