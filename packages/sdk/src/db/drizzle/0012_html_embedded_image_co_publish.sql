CREATE TABLE `html_embedded_image_co_publish` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_seed_local_id` text NOT NULL,
	`html_seed_local_id` text NOT NULL,
	`image_seed_local_id` text NOT NULL,
	`stable_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `html_embed_co_pub_parent_html_stable` ON `html_embedded_image_co_publish` (`parent_seed_local_id`,`html_seed_local_id`,`stable_key`);
