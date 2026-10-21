CREATE TABLE `chat_memories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform` text NOT NULL,
	`chat_id` text NOT NULL,
	`key` text NOT NULL,
	`content` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_memories_scope_key` ON `chat_memories` (`platform`,`chat_id`,`key`);