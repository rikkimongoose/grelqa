CREATE TABLE `first_round_closures` (
	`contest_id` text PRIMARY KEY NOT NULL,
	`closed_at` integer NOT NULL,
	`snapshot` text NOT NULL,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE restrict
);
