import type { CahciuaTool } from './types';
import { createTool } from './types';

export const createPokeUserTool = (
  poke: (userId: string) => Promise<void>,
): CahciuaTool => createTool({
  name: 'poke_user',
  execution: { lane: 'message' },
  description: 'Poke a user in the current QQ group, for example to return a poke. Use sparingly, only when appropriate to the conversation; do not repeatedly poke people.',
  parameters: {
    type: 'object',
    properties: {
      user_id: { type: 'string', pattern: '^[1-9][0-9]*$', description: 'The QQ user ID from the current chat context, not a display name or message ID.' },
    },
    required: ['user_id'],
    additionalProperties: false,
  },
  execute: async input => {
    const { user_id } = input as { user_id: string };
    if (typeof user_id !== 'string' || !/^[1-9]\d*$/.test(user_id) || !Number.isSafeInteger(Number(user_id))) {
      return { content: JSON.stringify({ ok: false, error: 'Invalid QQ user ID' }), requiresFollowUp: true };
    }
    await poke(user_id);
    return { content: JSON.stringify({ ok: true, user_id }), requiresFollowUp: false };
  },
});
