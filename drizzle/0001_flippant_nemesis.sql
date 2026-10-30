CREATE TABLE `auth_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`resets_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_session_user` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_token_purpose" CHECK("auth_tokens"."purpose" in ('verify','reset'))
);
--> statement-breakpoint
CREATE INDEX `auth_token_user` ON `auth_tokens` (`user_id`,`purpose`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_normalized_email` ON `users` (lower(trim("email")));