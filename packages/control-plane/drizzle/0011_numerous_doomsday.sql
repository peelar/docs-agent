CREATE TABLE `approval_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`approval_request_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`decision` text NOT NULL,
	`reason` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_login` text NOT NULL,
	`status` text NOT NULL,
	`failure_summary` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`approval_request_id`) REFERENCES `approval_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_decisions_idempotency_idx` ON `approval_decisions` (`workspace_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `approval_decisions_request_idx` ON `approval_decisions` (`approval_request_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`product_run_id` text NOT NULL,
	`signal_id` text,
	`session_id` text NOT NULL,
	`run_id` text NOT NULL,
	`request_id` text NOT NULL,
	`call_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`status` text NOT NULL,
	`action` text NOT NULL,
	`destination` text,
	`requester` text NOT NULL,
	`safe_input` text NOT NULL,
	`resume_handle` text,
	`requested_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`decided_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_run_id`) REFERENCES `product_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`signal_id`) REFERENCES `docs_signals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_requests_identity_idx` ON `approval_requests` (`workspace_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `approval_requests_status_idx` ON `approval_requests` (`workspace_id`,`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `approval_requests_session_idx` ON `approval_requests` (`workspace_id`,`session_id`,`run_id`);