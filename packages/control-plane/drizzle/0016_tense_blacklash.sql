CREATE TABLE `watch_lifecycle_events` (
	`id` text PRIMARY KEY NOT NULL,
	`watch_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`operation_key` text NOT NULL,
	`action` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_login` text NOT NULL,
	`previous_state` text,
	`next_state` text NOT NULL,
	`reason` text NOT NULL,
	`state_revision` integer NOT NULL,
	`effective_revision_id` text,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_lifecycle_events_operation_idx` ON `watch_lifecycle_events` (`workspace_id`,`watch_id`,`operation_key`);--> statement-breakpoint
CREATE INDEX `watch_lifecycle_events_watch_time_idx` ON `watch_lifecycle_events` (`workspace_id`,`watch_id`,`occurred_at`);--> statement-breakpoint
ALTER TABLE `policy_bound_watches` ADD `state_revision` integer DEFAULT 1 NOT NULL;