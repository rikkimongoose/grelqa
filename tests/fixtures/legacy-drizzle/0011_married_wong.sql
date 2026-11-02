ALTER TABLE `contest_groups` ADD `criticat_discussion_url` text;
--> statement-breakpoint
ALTER TABLE `contests` ADD `criticat_discussion_url` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD `ai_generation_basis_points` integer
  CONSTRAINT `story_ai_percentage` CHECK (
    `ai_generation_basis_points` IS NULL OR
    (typeof(`ai_generation_basis_points`) = 'integer' AND `ai_generation_basis_points` BETWEEN 0 AND 10000)
  );
