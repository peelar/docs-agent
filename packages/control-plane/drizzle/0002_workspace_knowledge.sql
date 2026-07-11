CREATE TABLE `workspace_knowledge_events` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`event_type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`reason` text NOT NULL,
	`actor` text NOT NULL,
	`metadata` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `workspace_knowledge_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_knowledge_events_record_idx` ON `workspace_knowledge_events` (`record_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workspace_knowledge_events_workspace_idx` ON `workspace_knowledge_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `workspace_knowledge_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`statement` text NOT NULL,
	`scope` text,
	`summary` text,
	`tags` text NOT NULL,
	`confidence` text NOT NULL,
	`fresh_until` text,
	`last_validated_at` text,
	`stale_reason` text,
	`proposed_by` text NOT NULL,
	`promoted_at` text,
	`retired_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspace_knowledge_status_idx` ON `workspace_knowledge_records` (`workspace_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `workspace_knowledge_kind_idx` ON `workspace_knowledge_records` (`workspace_id`,`kind`,`updated_at`);--> statement-breakpoint
CREATE INDEX `workspace_knowledge_fresh_until_idx` ON `workspace_knowledge_records` (`workspace_id`,`fresh_until`);--> statement-breakpoint
CREATE TABLE `workspace_knowledge_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text,
	`url` text,
	`external_id` text,
	`source_text` text,
	`metadata` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `workspace_knowledge_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_knowledge_sources_record_idx` ON `workspace_knowledge_sources` (`record_id`);--> statement-breakpoint
CREATE INDEX `workspace_knowledge_sources_kind_idx` ON `workspace_knowledge_sources` (`workspace_id`,`kind`);--> statement-breakpoint
CREATE INDEX `workspace_knowledge_sources_external_idx` ON `workspace_knowledge_sources` (`workspace_id`,`kind`,`external_id`);
