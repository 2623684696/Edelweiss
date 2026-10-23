export const isReactionDisabled = (emoji: string, disabledReactions: string[]): boolean =>
  disabledReactions.includes(emoji);

export const filterDisabledReactions = (emojis: string[], disabledReactions: string[]): string[] =>
  emojis.filter(emoji => !isReactionDisabled(emoji, disabledReactions));
