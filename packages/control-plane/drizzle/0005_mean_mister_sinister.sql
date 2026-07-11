CREATE TABLE `docs_follow_up_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`schedule_id` text NOT NULL,
	`occurrence_key` text NOT NULL,
	`time_zone` text NOT NULL,
	`status` text NOT NULL,
	`due_count` integer DEFAULT 0 NOT NULL,
	`processed_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `docs_follow_up_runs_occurrence_idx` ON `docs_follow_up_runs` (`workspace_id`,`schedule_id`,`occurrence_key`);--> statement-breakpoint
CREATE INDEX `docs_follow_up_runs_started_idx` ON `docs_follow_up_runs` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `docs_follow_ups` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`signal_id` text NOT NULL,
	`reason` text NOT NULL,
	`due_at` text NOT NULL,
	`status` text NOT NULL,
	`processed_occurrence` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`signal_id`) REFERENCES `docs_signals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `docs_follow_ups_due_idx` ON `docs_follow_ups` (`workspace_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `docs_follow_ups_signal_idx` ON `docs_follow_ups` (`workspace_id`,`signal_id`);