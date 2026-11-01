CREATE TABLE `contest_transition_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contest_id` text NOT NULL,
	`action` text NOT NULL,
	`source` text NOT NULL,
	`actor_id` text,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	`outcome` text NOT NULL,
	`message` text NOT NULL,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "transition_source" CHECK("contest_transition_runs"."source" in ('scheduled','manual')),
	CONSTRAINT "transition_outcome" CHECK("contest_transition_runs"."outcome" in ('success','blocked','error'))
);
--> statement-breakpoint
CREATE INDEX `transition_runs_contest` ON `contest_transition_runs` (`contest_id`,`finished_at`);