CREATE TABLE `final_rounds` (
	`contest_id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`prepared_at` integer NOT NULL,
	`snapshot` text NOT NULL,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`group_id`) REFERENCES `contest_groups`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `final_rounds_group_id_unique` ON `final_rounds` (`group_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ballot_drafts` (
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
	CONSTRAINT "draft_round" CHECK("__new_ballot_drafts"."round" in (1, 2)),
	CONSTRAINT "draft_revision" CHECK("__new_ballot_drafts"."revision" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_ballot_drafts`("participation_id", "contest_id", "round", "group_id", "selections", "revision", "updated_at") SELECT "participation_id", "contest_id", "round", "group_id", "selections", "revision", "updated_at" FROM `ballot_drafts`;--> statement-breakpoint
DROP TABLE `ballot_drafts`;--> statement-breakpoint
ALTER TABLE `__new_ballot_drafts` RENAME TO `ballot_drafts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_ballot_requests` (
	`participation_id` text NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`request_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`response` text NOT NULL,
	`received_at` integer NOT NULL,
	PRIMARY KEY(`participation_id`, `round`, `request_id`),
	FOREIGN KEY (`participation_id`) REFERENCES `participations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "request_round" CHECK("__new_ballot_requests"."round" in (1, 2))
);
--> statement-breakpoint
-- All historical requests are round 1; the old table has no round column.
INSERT INTO `__new_ballot_requests`("participation_id", "round", "request_id", "payload_hash", "response", "received_at") SELECT "participation_id", 1, "request_id", "payload_hash", "response", "received_at" FROM `ballot_requests`;--> statement-breakpoint
DROP TABLE `ballot_requests`;--> statement-breakpoint
ALTER TABLE `__new_ballot_requests` RENAME TO `ballot_requests`;--> statement-breakpoint
ALTER TABLE `participations` ADD `round_two_exempt_at` integer;--> statement-breakpoint
ALTER TABLE `participations` ADD `round_two_exempt_reason` text;