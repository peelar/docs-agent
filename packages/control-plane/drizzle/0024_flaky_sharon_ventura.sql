CREATE TABLE `watch_action_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`watch_id` text NOT NULL,
	`effective_revision_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`session_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`action_key` text NOT NULL,
	`action` text NOT NULL,
	`capability_family` text,
	`status` text NOT NULL,
	`result_code` text,
	`occurred_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`watch_id`) REFERENCES `policy_bound_watches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_action_outcomes_action_idx` ON `watch_action_outcomes` (`workspace_id`,`reservation_id`,`action_key`);--> statement-breakpoint
CREATE INDEX `watch_action_outcomes_watch_idx` ON `watch_action_outcomes` (`workspace_id`,`watch_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `watch_action_outcomes_expiry_idx` ON `watch_action_outcomes` (`workspace_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `watch_delivery_budget_buckets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`watch_id` text NOT NULL,
	`effective_revision_id` text NOT NULL,
	`day_bucket` text NOT NULL,
	`reserved_deliveries` integer DEFAULT 0 NOT NULL,
	`limit_snapshot` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`watch_id`) REFERENCES `policy_bound_watches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_delivery_budget_buckets_revision_idx` ON `watch_delivery_budget_buckets` (`workspace_id`,`effective_revision_id`,`day_bucket`);--> statement-breakpoint
CREATE TABLE `watch_provider_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`watch_id` text NOT NULL,
	`effective_revision_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`dispatch_claim_token` text NOT NULL,
	`provider` text NOT NULL,
	`provider_workspace_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`mode` text NOT NULL,
	`digest_batch_id` text,
	`status` text NOT NULL,
	`content` text,
	`content_hash` text NOT NULL,
	`client_message_id` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease_expires_at` text,
	`lease_token` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`delivered_at` text,
	FOREIGN KEY (`watch_id`) REFERENCES `policy_bound_watches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_provider_deliveries_call_idx` ON `watch_provider_deliveries` (`workspace_id`,`reservation_id`,`id`);--> statement-breakpoint
CREATE INDEX `watch_provider_deliveries_due_idx` ON `watch_provider_deliveries` (`workspace_id`,`status`,`mode`,`created_at`);--> statement-breakpoint
CREATE INDEX `watch_provider_deliveries_digest_batch_idx` ON `watch_provider_deliveries` (`workspace_id`,`digest_batch_id`);--> statement-breakpoint
CREATE INDEX `watch_provider_deliveries_expiry_idx` ON `watch_provider_deliveries` (`workspace_id`,`expires_at`);--> statement-breakpoint
ALTER TABLE `watch_dispatch_reservations` ADD `provider_workspace_id` text;--> statement-breakpoint
ALTER TABLE `watch_dispatch_reservations` ADD `handoff_payload` text;--> statement-breakpoint
ALTER TABLE `watch_dispatch_reservations` ADD `payload_expires_at` text;--> statement-breakpoint
ALTER TABLE `watch_dispatch_reservations` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `watch_dispatch_reservations` ADD `lease_expires_at` text;--> statement-breakpoint
ALTER TABLE `watch_dispatch_reservations` ADD `lease_token` text;--> statement-breakpoint
ALTER TABLE `watch_dispatch_reservations` ADD `session_id` text;