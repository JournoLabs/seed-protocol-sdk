CREATE TABLE `publish_processes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`seed_local_id` text NOT NULL,
	`model_name` text NOT NULL,
	`schema_id` text,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`error_message` text,
	`error_step` text,
	`error_details` text,
	`persisted_snapshot` text NOT NULL,
	`seed_id` text,
	`existing_seed_uid` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `upload_processes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reimbursement_confirmed` integer NOT NULL,
	`reimbursement_transaction_id` text,
	`transaction_keys` text,
	`persisted_snapshot` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
