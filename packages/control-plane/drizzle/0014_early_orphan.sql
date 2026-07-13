CREATE TABLE `policy_bound_watches` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`lifecycle_state` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `policy_bound_watches_workspace_state_idx` ON `policy_bound_watches` (`workspace_id`,`lifecycle_state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `watch_policy_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`watch_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`revision` integer NOT NULL,
	`contract_version` integer NOT NULL,
	`policy` text NOT NULL,
	`created_by_id` text NOT NULL,
	`created_by_login` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`watch_id`) REFERENCES `policy_bound_watches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_policy_revisions_watch_revision_idx` ON `watch_policy_revisions` (`workspace_id`,`watch_id`,`revision`);--> statement-breakpoint
CREATE INDEX `watch_policy_revisions_watch_created_idx` ON `watch_policy_revisions` (`workspace_id`,`watch_id`,`created_at`);