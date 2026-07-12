CREATE TABLE `workspace_behavior_settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`settings` text NOT NULL,
	`updated_by_id` text NOT NULL,
	`updated_by_login` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_behavior_settings_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_login` text NOT NULL,
	`previous_settings` text NOT NULL,
	`next_settings` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspace_behavior_settings_events_workspace_created_idx` ON `workspace_behavior_settings_events` (`workspace_id`,`created_at`);