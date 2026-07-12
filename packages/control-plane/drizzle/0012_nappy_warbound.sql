CREATE TABLE `validation_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`validation_run_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`case_id` text NOT NULL,
	`name` text NOT NULL,
	`outcome` text NOT NULL,
	`assertion_summaries` text NOT NULL,
	`failure_summary` text,
	`artifact_reference` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`duration_ms` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`validation_run_id`) REFERENCES `validation_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `validation_cases_identity_idx` ON `validation_cases` (`validation_run_id`,`case_id`);--> statement-breakpoint
CREATE INDEX `validation_cases_outcome_idx` ON `validation_cases` (`validation_run_id`,`outcome`);--> statement-breakpoint
CREATE TABLE `validation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`suite` text NOT NULL,
	`target` text NOT NULL,
	`model` text,
	`revision` text,
	`deployment` text,
	`outcome` text NOT NULL,
	`redaction_version` integer NOT NULL,
	`artifact_references` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`duration_ms` integer,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `validation_runs_kind_started_idx` ON `validation_runs` (`workspace_id`,`kind`,`started_at`);--> statement-breakpoint
CREATE INDEX `validation_runs_expiry_idx` ON `validation_runs` (`workspace_id`,`expires_at`);