CREATE TABLE `watch_observation_windows` (
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
	FOREIGN KEY (`watch_id`) REFERENCES `policy_bound_watches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`effective_revision_id`) REFERENCES `watch_effective_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_observation_windows_collecting_idx` ON `watch_observation_windows` (`workspace_id`,`effective_revision_id`) WHERE "watch_observation_windows"."status" = 'collecting';--> statement-breakpoint
CREATE INDEX `watch_observation_windows_due_idx` ON `watch_observation_windows` (`workspace_id`,`status`,`closes_at`,`raw_expires_at`);