CREATE TABLE `contest_finalizations` (
	`contest_id` text PRIMARY KEY NOT NULL,
	`completed_at` integer NOT NULL,
	`snapshot` text NOT NULL,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
ALTER TABLE `users` ADD `public_name` text;