ALTER TABLE `chat_memories` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `chat_memories` ADD `source` text;--> statement-breakpoint
ALTER TABLE `chat_memories` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `chat_memories` ADD `ttl_days` integer;--> statement-breakpoint
ALTER TABLE `chat_memories` ADD `expires_at_ms` integer;--> statement-breakpoint
ALTER TABLE `chat_memories` ADD `last_recalled_at_ms` integer;