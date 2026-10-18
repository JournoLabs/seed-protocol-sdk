CREATE TABLE `pending_writes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`op_id` text NOT NULL,
	`group_id` text,
	`seed_local_id` text NOT NULL,
	`property_name` text,
	`kind` text NOT NULL,
	`value` text,
	`value_ref` text,
	`base_row_id` text,
	`base_uid` text,
	`created_at` integer NOT NULL,
	`tab_id` text,
	`status` text NOT NULL,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`applied_at` integer,
	`result` text,
	`conflict` text,
	`conflict_resolved_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_writes_op_id_unique` ON `pending_writes` (`op_id`);--> statement-breakpoint
CREATE INDEX `pending_writes_drain_order` ON `pending_writes` (`status`,`seed_local_id`,`property_name`,`created_at`);