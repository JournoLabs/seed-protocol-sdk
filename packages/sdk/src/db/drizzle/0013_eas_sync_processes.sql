CREATE TABLE `eas_sync_processes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`request_payload` text NOT NULL,
	`error_message` text,
	`error_details` text,
	`persisted_snapshot` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
