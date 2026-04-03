CREATE TABLE `arweave_l1_finalize_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`seed_local_id` text NOT NULL,
	`data_item_id` text NOT NULL,
	`l1_transaction_id` text,
	`bundle_id` text,
	`version_local_id` text,
	`item_property_name` text,
	`phase` text NOT NULL,
	`status_json` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `arweave_l1_finalize_jobs_data_item_id_unique` ON `arweave_l1_finalize_jobs` (`data_item_id`);
