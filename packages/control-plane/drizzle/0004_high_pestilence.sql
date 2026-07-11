CREATE TABLE `docs_signal_owned_work` (
	`id` text PRIMARY KEY NOT NULL,
	`signal_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`status` text NOT NULL,
	`session_id` text NOT NULL,
	`started_run_id` text NOT NULL,
	`last_run_id` text NOT NULL,
	`conversation` text NOT NULL,
	`intended_outcome` text NOT NULL,
	`references` text NOT NULL,
	`outcome` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`last_operation_key` text NOT NULL,
	`last_milestone` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`signal_id`) REFERENCES `docs_signals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `docs_signal_owned_work_signal_idx` ON `docs_signal_owned_work` (`workspace_id`,`signal_id`);--> statement-breakpoint
CREATE INDEX `docs_signal_owned_work_status_idx` ON `docs_signal_owned_work` (`workspace_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `docs_signal_owned_work_session_idx` ON `docs_signal_owned_work` (`workspace_id`,`session_id`);