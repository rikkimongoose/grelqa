CREATE TABLE `ballot_drafts` (
	`participation_id` text NOT NULL,
	`contest_id` text NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`group_id` text NOT NULL,
	`selections` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`participation_id`, `round`),
	FOREIGN KEY (`participation_id`,`contest_id`) REFERENCES `participations`(`id`,`contest_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`group_id`,`contest_id`,`round`) REFERENCES `contest_groups`(`id`,`contest_id`,`round`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "draft_first_round" CHECK("ballot_drafts"."round" = 1),
	CONSTRAINT "draft_revision" CHECK("ballot_drafts"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE `ballot_requests` (
	`participation_id` text NOT NULL,
	`request_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`response` text NOT NULL,
	`received_at` integer NOT NULL,
	PRIMARY KEY(`participation_id`, `request_id`),
	FOREIGN KEY (`participation_id`) REFERENCES `participations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
ALTER TABLE `participations` ADD `round_one_exempt_at` integer;--> statement-breakpoint
ALTER TABLE `participations` ADD `round_one_exempt_reason` text;