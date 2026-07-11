CREATE TABLE `workspace_setup_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_login` text NOT NULL,
	`action` text NOT NULL,
	`setup_snapshot` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspace_setup_events_workspace_created_idx` ON `workspace_setup_events` (`workspace_id`,`created_at`);