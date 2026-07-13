CREATE TABLE `watch_dispatch_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`watch_id` text NOT NULL,
	`effective_revision_id` text NOT NULL,
	`provider` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`handoff_kind` text NOT NULL,
	`claim_ids` text NOT NULL,
	`observation_count` integer NOT NULL,
	`character_count` integer NOT NULL,
	`hour_bucket` text NOT NULL,
	`status` text NOT NULL,
	`reserved_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`watch_id`) REFERENCES `policy_bound_watches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`effective_revision_id`) REFERENCES `watch_effective_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `watch_dispatch_reservations_budget_idx` ON `watch_dispatch_reservations` (`workspace_id`,`effective_revision_id`,`hour_bucket`);--> statement-breakpoint
CREATE TABLE `watch_processing_budget_buckets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`watch_id` text NOT NULL,
	`effective_revision_id` text NOT NULL,
	`hour_bucket` text NOT NULL,
	`reserved_runs` integer DEFAULT 0 NOT NULL,
	`limit_snapshot` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`watch_id`) REFERENCES `policy_bound_watches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`effective_revision_id`) REFERENCES `watch_effective_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_processing_budget_bucket_idx` ON `watch_processing_budget_buckets` (`workspace_id`,`effective_revision_id`,`hour_bucket`);