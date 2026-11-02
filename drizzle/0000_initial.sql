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
	CONSTRAINT "draft_round" CHECK("ballot_drafts"."round" in (1, 2)),
	CONSTRAINT "draft_revision" CHECK("ballot_drafts"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE `ballot_entries` (
	`ballot_id` text NOT NULL,
	`story_id` text NOT NULL,
	`contest_id` text NOT NULL,
	`round` integer NOT NULL,
	`group_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`ballot_id`, `story_id`),
	FOREIGN KEY (`ballot_id`,`contest_id`,`round`,`group_id`) REFERENCES `ballots`(`id`,`contest_id`,`round`,`group_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`story_id`,`contest_id`,`round`,`group_id`) REFERENCES `story_rounds`(`story_id`,`contest_id`,`round`,`group_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ballot_position_range" CHECK("ballot_entries"."position" between 1 and 6)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ballot_position` ON `ballot_entries` (`ballot_id`,`position`);--> statement-breakpoint
CREATE TABLE `ballot_requests` (
	`participation_id` text NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`request_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`response` text NOT NULL,
	`received_at` integer NOT NULL,
	PRIMARY KEY(`participation_id`, `round`, `request_id`),
	FOREIGN KEY (`participation_id`) REFERENCES `participations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "request_round" CHECK("ballot_requests"."round" in (1, 2))
);
--> statement-breakpoint
CREATE TABLE `ballots` (
	`id` text PRIMARY KEY NOT NULL,
	`participation_id` text NOT NULL,
	`contest_id` text NOT NULL,
	`round` integer NOT NULL,
	`group_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`submitted_at` integer,
	FOREIGN KEY (`participation_id`,`contest_id`) REFERENCES `participations`(`id`,`contest_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`group_id`,`contest_id`,`round`) REFERENCES `contest_groups`(`id`,`contest_id`,`round`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ballot_round" CHECK("ballots"."round" in (1, 2))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ballot_participant_round` ON `ballots` (`participation_id`,`round`);--> statement-breakpoint
CREATE UNIQUE INDEX `ballot_scope` ON `ballots` (`id`,`contest_id`,`round`,`group_id`);--> statement-breakpoint
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
CREATE TABLE `contest_finalizations` (
	`contest_id` text PRIMARY KEY NOT NULL,
	`completed_at` integer NOT NULL,
	`snapshot` text NOT NULL,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `contest_groups` (
	`criticat_discussion_url` text,
	`id` text PRIMARY KEY NOT NULL,
	`contest_id` text NOT NULL,
	`round` integer NOT NULL,
	`number` integer NOT NULL,
	`capacity` integer NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "group_round" CHECK("contest_groups"."round" in (1, 2)),
	CONSTRAINT "group_positive" CHECK("contest_groups"."number" > 0 and "contest_groups"."capacity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_number` ON `contest_groups` (`contest_id`,`round`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `group_scope` ON `contest_groups` (`id`,`contest_id`,`round`);--> statement-breakpoint
CREATE TABLE `contest_theme_invites` (
	`contest_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contest_theme_invites_token_hash_unique` ON `contest_theme_invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `contest_themes` (
	`contest_id` text PRIMARY KEY NOT NULL,
	`theme` text NOT NULL,
	`conditions` text NOT NULL,
	`entered_at` integer NOT NULL,
	`published_at` integer,
	`access_token_hash` text,
	`access_used_at` integer,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contest_themes_access_token_hash_unique` ON `contest_themes` (`access_token_hash`);--> statement-breakpoint
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
CREATE INDEX `transition_runs_contest` ON `contest_transition_runs` (`contest_id`,`finished_at`);--> statement-breakpoint
CREATE TABLE `contests` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`organizer_id` text NOT NULL,
	`coordinator_id` text,
	`is_draft` integer DEFAULT false NOT NULL,
	`public_updated_at` integer,
	`settings_revision` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`discussion_url` text,
	`criticat_discussion_url` text,
	`stage` text DEFAULT 'preparation' NOT NULL,
	`failure_reason` text,
	`preparation_at` integer,
	`submissions_start_at` integer NOT NULL,
	`start_day_moscow` text NOT NULL,
	`submissions_end_at` integer NOT NULL,
	`round_one_start_at` integer NOT NULL,
	`round_two_start_at` integer,
	`ends_at` integer NOT NULL,
	`voting_ended_at` integer,
	`group_capacity` integer NOT NULL,
	`final_capacity` integer NOT NULL,
	`min_length` integer DEFAULT 0 NOT NULL,
	`max_length` integer DEFAULT 0 NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organizer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`coordinator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "contest_stage" CHECK("contests"."stage" in ('preparation','submissions','moderation','round-one','round-two','completed','failed')),
	CONSTRAINT "contest_failure_reason" CHECK("contests"."stage" != 'failed' or length(trim("contests"."failure_reason")) > 0 and "contests"."failure_reason" is not null),
	CONSTRAINT "contest_capacity" CHECK("contests"."group_capacity" > 0 and "contests"."final_capacity" > 0),
	CONSTRAINT "contest_lengths" CHECK("contests"."min_length" >= 0 and "contests"."max_length" >= 0 and ("contests"."max_length" = 0 or "contests"."min_length" <= "contests"."max_length")),
	CONSTRAINT "contest_start_moscow" CHECK(strftime('%H:%M:%f', "contests"."submissions_start_at" / 1000.0, 'unixepoch', '+3 hours') = '15:00:00.000' and "contests"."start_day_moscow" = strftime('%Y-%m-%d', "contests"."submissions_start_at" / 1000.0, 'unixepoch', '+3 hours')),
	CONSTRAINT "contest_schedule" CHECK(("contests"."preparation_at" is null or "contests"."preparation_at" <= "contests"."submissions_start_at") and "contests"."submissions_start_at" < "contests"."submissions_end_at" and "contests"."submissions_end_at" <= "contests"."round_one_start_at" and "contests"."round_one_start_at" < "contests"."ends_at" and ("contests"."round_two_start_at" is null or ("contests"."round_one_start_at" < "contests"."round_two_start_at" and "contests"."round_two_start_at" < "contests"."ends_at")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contests_slug_unique` ON `contests` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `contests_start_day_moscow_unique` ON `contests` (`start_day_moscow`);--> statement-breakpoint
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
CREATE TABLE `first_round_closures` (
	`contest_id` text PRIMARY KEY NOT NULL,
	`closed_at` integer NOT NULL,
	`snapshot` text NOT NULL,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `first_round_formations` (
	`contest_id` text PRIMARY KEY NOT NULL,
	`formed_at` integer NOT NULL,
	`snapshot` text NOT NULL,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `participations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`contest_id` text NOT NULL,
	`assigned_group_id` text,
	`assigned_round` integer DEFAULT 1 NOT NULL,
	`finalist` integer DEFAULT false NOT NULL,
	`must_vote_round_one` integer DEFAULT false NOT NULL,
	`must_vote_round_two` integer DEFAULT false NOT NULL,
	`round_two_rights_ended_at` integer,
	`round_two_exempt_at` integer,
	`round_two_exempt_reason` text,
	`round_one_exempt_at` integer,
	`round_one_exempt_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assigned_group_id`,`contest_id`,`assigned_round`) REFERENCES `contest_groups`(`id`,`contest_id`,`round`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "assigned_first_round" CHECK("participations"."assigned_round" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participation_user_contest` ON `participations` (`user_id`,`contest_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `participation_scope` ON `participations` (`id`,`contest_id`);--> statement-breakpoint
CREATE TABLE `stories` (
	`ai_generation_basis_points` integer,
	`id` text PRIMARY KEY NOT NULL,
	`contest_id` text NOT NULL,
	`participation_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`length` integer,
	`length_algorithm` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`published_at` integer,
	`withdrawn_at` integer,
	`withdrawal_reason` text,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`participation_id`,`contest_id`) REFERENCES `participations`(`id`,`contest_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "story_ai_percentage" CHECK("stories"."ai_generation_basis_points" is null or (typeof("stories"."ai_generation_basis_points") = 'integer' and "stories"."ai_generation_basis_points" between 0 and 10000)),
	CONSTRAINT "story_status" CHECK("stories"."status" in ('draft','submitted','admitted','rejected','withdrawn')),
	CONSTRAINT "story_length" CHECK(("stories"."length" is null and "stories"."length_algorithm" is null) or ("stories"."length" is not null and "stories"."length" >= 0 and "stories"."length_algorithm" is not null)),
	CONSTRAINT "story_withdrawal" CHECK("stories"."status" != 'withdrawn' or ("stories"."withdrawn_at" is not null and "stories"."withdrawal_reason" is not null))
);
--> statement-breakpoint
CREATE INDEX `story_author` ON `stories` (`participation_id`,`contest_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `story_scope` ON `stories` (`id`,`contest_id`);--> statement-breakpoint
CREATE TABLE `story_rounds` (
	`story_id` text NOT NULL,
	`contest_id` text NOT NULL,
	`round` integer NOT NULL,
	`group_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`withdrawn_at` integer,
	`withdrawal_reason` text,
	`points` integer,
	`place` integer,
	PRIMARY KEY(`story_id`, `round`),
	FOREIGN KEY (`story_id`,`contest_id`) REFERENCES `stories`(`id`,`contest_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`group_id`,`contest_id`,`round`) REFERENCES `contest_groups`(`id`,`contest_id`,`round`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "story_round_number" CHECK("story_rounds"."round" in (1, 2)),
	CONSTRAINT "story_round_status" CHECK("story_rounds"."status" in ('active','withdrawn')),
	CONSTRAINT "story_round_withdrawal" CHECK("story_rounds"."status" != 'withdrawn' or ("story_rounds"."withdrawn_at" is not null and "story_rounds"."withdrawal_reason" is not null)),
	CONSTRAINT "story_round_results" CHECK(("story_rounds"."points" is null or "story_rounds"."points" >= 0) and ("story_rounds"."place" is null or "story_rounds"."place" > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `story_round_scope` ON `story_rounds` (`story_id`,`contest_id`,`round`,`group_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`public_name` text,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`email_verified_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_normalized_email` ON `users` (lower(trim("email")));