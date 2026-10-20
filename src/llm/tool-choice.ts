/** Omitted means automatic tool selection. Local policies never set tool_choice. */
export type ToolChoice = 'force' | 'local-force' | 'none' | 'local-none';

/** Retries after the initial local-force attempt when not configured. */
export const DEFAULT_LOCAL_FORCE_MAX_RETRIES = 3;
