CREATE TABLE `contest_admin_events` (
	`id` text PRIMARY KEY NOT NULL,
	`contest_id` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`details` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `admin_events_contest` ON `contest_admin_events` (`contest_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `contest_theme_invites` (
	`contest_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contest_theme_invites_token_hash_unique` ON `contest_theme_invites` (`token_hash`);--> statement-breakpoint
ALTER TABLE `contests` ADD `coordinator_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `contests` ADD `is_draft` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `contests` ADD `public_updated_at` integer;--> statement-breakpoint
ALTER TABLE `contests` ADD `settings_revision` integer DEFAULT 1 NOT NULL;