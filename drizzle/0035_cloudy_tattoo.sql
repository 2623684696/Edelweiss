ALTER TABLE `chat_memories` ADD `stability_days` integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_memories` ADD `reinforcement_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_memories` ADD `last_reinforced_at_ms` integer;