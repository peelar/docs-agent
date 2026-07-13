PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_watch_dispatch_reservations` (
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
	FOREIGN KEY (`watch_id`) REFERENCES `policy_bound_watches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_watch_dispatch_reservations`("id", "workspace_id", "watch_id", "effective_revision_id", "provider", "resource_type", "resource_id", "handoff_kind", "claim_ids", "observation_count", "character_count", "hour_bucket", "status", "reserved_at", "updated_at") SELECT "id", "workspace_id", "watch_id", "effective_revision_id", "provider", "resource_type", "resource_id", "handoff_kind", "claim_ids", "observation_count", "character_count", "hour_bucket", "status", "reserved_at", "updated_at" FROM `watch_dispatch_reservations`;--> statement-breakpoint
DROP TABLE `watch_dispatch_reservations`;--> statement-breakpoint
ALTER TABLE `__new_watch_dispatch_reservations` RENAME TO `watch_dispatch_reservations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `watch_dispatch_reservations_budget_idx` ON `watch_dispatch_reservations` (`workspace_id`,`effective_revision_id`,`hour_bucket`);--> statement-breakpoint
CREATE TABLE `__new_watch_observation_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`watch_id` text NOT NULL,
	`effective_revision_id` text NOT NULL,
	`provider` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`status` text NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`failure_code` text,
	`claimed_at` text NOT NULL,
	`failed_at` text,
	`completed_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`watch_id`) REFERENCES `policy_bound_watches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_watch_observation_claims`("id", "workspace_id", "watch_id", "effective_revision_id", "provider", "resource_type", "resource_id", "provider_event_id", "status", "attempt", "failure_code", "claimed_at", "failed_at", "completed_at", "updated_at") SELECT "id", "workspace_id", "watch_id", "effective_revision_id", "provider", "resource_type", "resource_id", "provider_event_id", "status", "attempt", "failure_code", "claimed_at", "failed_at", "completed_at", "updated_at" FROM `watch_observation_claims`;--> statement-breakpoint
DROP TABLE `watch_observation_claims`;--> statement-breakpoint
ALTER TABLE `__new_watch_observation_claims` RENAME TO `watch_observation_claims`;--> statement-breakpoint
CREATE UNIQUE INDEX `watch_observation_claims_occurrence_idx` ON `watch_observation_claims` (`workspace_id`,`effective_revision_id`,`provider`,`resource_type`,`resource_id`,`provider_event_id`);--> statement-breakpoint
CREATE INDEX `watch_observation_claims_status_idx` ON `watch_observation_claims` (`workspace_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `__new_watch_observation_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`watch_id` text NOT NULL,
	`effective_revision_id` text NOT NULL,
	`provider` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`claim_ids` text NOT NULL,
	`raw_observations` text,
	`observation_count` integer NOT NULL,
	`character_count` integer NOT NULL,
	`opened_at` text NOT NULL,
	`closes_at` text NOT NULL,
	`raw_expires_at` text NOT NULL,
	`handed_off_at` text,
	`expired_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`watch_id`) REFERENCES `policy_bound_watches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_watch_observation_windows`("id", "workspace_id", "watch_id", "effective_revision_id", "provider", "resource_type", "resource_id", "status", "revision", "claim_ids", "raw_observations", "observation_count", "character_count", "opened_at", "closes_at", "raw_expires_at", "handed_off_at", "expired_at", "updated_at") SELECT "id", "workspace_id", "watch_id", "effective_revision_id", "provider", "resource_type", "resource_id", "status", "revision", "claim_ids", "raw_observations", "observation_count", "character_count", "opened_at", "closes_at", "raw_expires_at", "handed_off_at", "expired_at", "updated_at" FROM `watch_observation_windows`;--> statement-breakpoint
DROP TABLE `watch_observation_windows`;--> statement-breakpoint
ALTER TABLE `__new_watch_observation_windows` RENAME TO `watch_observation_windows`;--> statement-breakpoint
CREATE UNIQUE INDEX `watch_observation_windows_collecting_idx` ON `watch_observation_windows` (`workspace_id`,`effective_revision_id`) WHERE "watch_observation_windows"."status" = 'collecting';--> statement-breakpoint
CREATE INDEX `watch_observation_windows_due_idx` ON `watch_observation_windows` (`workspace_id`,`status`,`closes_at`,`raw_expires_at`);--> statement-breakpoint
CREATE TABLE `__new_watch_processing_budget_buckets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`watch_id` text NOT NULL,
	`effective_revision_id` text NOT NULL,
	`hour_bucket` text NOT NULL,
	`reserved_runs` integer DEFAULT 0 NOT NULL,
	`limit_snapshot` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`watch_id`) REFERENCES `policy_bound_watches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_watch_processing_budget_buckets`("id", "workspace_id", "watch_id", "effective_revision_id", "hour_bucket", "reserved_runs", "limit_snapshot", "updated_at") SELECT "id", "workspace_id", "watch_id", "effective_revision_id", "hour_bucket", "reserved_runs", "limit_snapshot", "updated_at" FROM `watch_processing_budget_buckets`;--> statement-breakpoint
DROP TABLE `watch_processing_budget_buckets`;--> statement-breakpoint
ALTER TABLE `__new_watch_processing_budget_buckets` RENAME TO `watch_processing_budget_buckets`;--> statement-breakpoint
CREATE UNIQUE INDEX `watch_processing_budget_bucket_idx` ON `watch_processing_budget_buckets` (`workspace_id`,`effective_revision_id`,`hour_bucket`);