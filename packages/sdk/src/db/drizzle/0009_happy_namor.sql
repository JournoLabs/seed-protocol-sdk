PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_property_uids` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uid` text NOT NULL,
	`property_id` integer NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_property_uids`("id", "uid", "property_id") SELECT "id", "uid", "property_id" FROM `property_uids`;--> statement-breakpoint
DROP TABLE `property_uids`;--> statement-breakpoint
ALTER TABLE `__new_property_uids` RENAME TO `property_uids`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `property_uids_property_id_unique` ON `property_uids` (`property_id`);--> statement-breakpoint
ALTER TABLE `metadata` ADD `property_id` integer REFERENCES properties(id);