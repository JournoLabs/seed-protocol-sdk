CREATE TABLE `appState` (
	`key` text,
	`value` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appState_key_unique` ON `appState` (`key`);--> statement-breakpoint
CREATE TABLE `config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`text` text,
	`json` text,
	`blob` blob
);
--> statement-breakpoint
CREATE TABLE `metadata` (
	`local_id` text,
	`uid` text,
	`property_name` text,
	`property_value` text,
	`schema_uid` text,
	`model_type` text,
	`seed_local_id` text,
	`seed_uid` text,
	`version_local_id` text,
	`version_uid` text,
	`eas_data_type` text,
	`ref_value_type` text,
	`ref_schema_uid` text,
	`ref_seed_type` text,
	`ref_resolved_value` text,
	`ref_resolved_display_value` text,
	`local_storage_dir` text,
	`attestation_raw` text,
	`attestation_created_at` integer,
	`content_hash` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metadata_local_id_unique` ON `metadata` (`local_id`);--> statement-breakpoint
CREATE TABLE `models` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`schema_file_id` text
);
--> statement-breakpoint
CREATE TABLE `properties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`data_type` text NOT NULL,
	`model_id` integer NOT NULL,
	`ref_model_id` integer,
	`ref_value_type` text,
	`schema_file_id` text,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ref_model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_name_model_id` ON `properties` (`name`,`model_id`);--> statement-breakpoint
CREATE TABLE `model_schemas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`model_id` integer,
	`schema_id` integer,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`schema_id`) REFERENCES `schemas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `model_uids` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uid` text NOT NULL,
	`model_id` integer NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_uids_model_id_unique` ON `model_uids` (`model_id`);--> statement-breakpoint
CREATE TABLE `property_uids` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uid` text NOT NULL,
	`property_id` integer NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `property_uids_property_id_unique` ON `property_uids` (`property_id`);--> statement-breakpoint
CREATE TABLE `schemas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`version` integer NOT NULL,
	`schema_file_id` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `seeds` (
	`local_id` text,
	`uid` text,
	`schema_uid` text,
	`type` text,
	`attestation_raw` text,
	`attestation_created_at` integer,
	`created_at` integer,
	`updated_at` integer,
	`_marked_for_deletion` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seeds_local_id_unique` ON `seeds` (`local_id`);--> statement-breakpoint
CREATE TABLE `versions` (
	`local_id` text,
	`uid` text,
	`seed_local_id` text,
	`seed_uid` text,
	`seed_type` text,
	`note` text,
	`created_at` integer,
	`updated_at` integer,
	`attestation_created_at` integer,
	`attestation_raw` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `versions_local_id_unique` ON `versions` (`local_id`);