CREATE TABLE `publish_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`publish_run_id` text,
	`seed_local_id` text NOT NULL,
	`seed_local_ids` text NOT NULL,
	`step` text NOT NULL,
	`requests` text NOT NULL,
	`sender` text NOT NULL,
	`attester` text NOT NULL,
	`chain_id` integer NOT NULL,
	`nonce_key` text,
	`from_block` text,
	`tx_hash` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `publish_attempts_status_idx` ON `publish_attempts` (`status`);