CREATE TABLE `entity_changes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tbl` text NOT NULL,
	`seed_local_id` text,
	`seed_uid` text,
	`property_name` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entity_changes_at` ON `entity_changes` (`at`);--> statement-breakpoint
CREATE TRIGGER `entity_changes_seeds_insert` AFTER INSERT ON `seeds` BEGIN
	INSERT INTO `entity_changes` (`tbl`, `seed_local_id`, `seed_uid`, `at`) VALUES ('seeds', NEW.`local_id`, NEW.`uid`, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER `entity_changes_seeds_update` AFTER UPDATE ON `seeds` BEGIN
	INSERT INTO `entity_changes` (`tbl`, `seed_local_id`, `seed_uid`, `at`) VALUES ('seeds', NEW.`local_id`, NEW.`uid`, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
	INSERT INTO `entity_changes` (`tbl`, `seed_local_id`, `seed_uid`, `at`) SELECT 'seeds', OLD.`local_id`, OLD.`uid`, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE OLD.`local_id` IS NOT NEW.`local_id` OR OLD.`uid` IS NOT NEW.`uid`;
END;
--> statement-breakpoint
CREATE TRIGGER `entity_changes_seeds_delete` AFTER DELETE ON `seeds` BEGIN
	INSERT INTO `entity_changes` (`tbl`, `seed_local_id`, `seed_uid`, `at`) VALUES ('seeds', OLD.`local_id`, OLD.`uid`, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER `entity_changes_versions_insert` AFTER INSERT ON `versions` BEGIN
	INSERT INTO `entity_changes` (`tbl`, `seed_local_id`, `seed_uid`, `at`) VALUES ('versions', NEW.`seed_local_id`, NEW.`seed_uid`, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER `entity_changes_versions_update` AFTER UPDATE ON `versions` BEGIN
	INSERT INTO `entity_changes` (`tbl`, `seed_local_id`, `seed_uid`, `at`) VALUES ('versions', NEW.`seed_local_id`, NEW.`seed_uid`, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
	INSERT INTO `entity_changes` (`tbl`, `seed_local_id`, `seed_uid`, `at`) SELECT 'versions', OLD.`seed_local_id`, OLD.`seed_uid`, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE OLD.`seed_local_id` IS NOT NEW.`seed_local_id` OR OLD.`seed_uid` IS NOT NEW.`seed_uid`;
END;
--> statement-breakpoint
CREATE TRIGGER `entity_changes_versions_delete` AFTER DELETE ON `versions` BEGIN
	INSERT INTO `entity_changes` (`tbl`, `seed_local_id`, `seed_uid`, `at`) VALUES ('versions', OLD.`seed_local_id`, OLD.`seed_uid`, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER `entity_changes_metadata_insert` AFTER INSERT ON `metadata` BEGIN
	INSERT INTO `entity_changes` (`tbl`, `seed_local_id`, `seed_uid`, `property_name`, `at`) VALUES ('metadata', NEW.`seed_local_id`, NEW.`seed_uid`, NEW.`property_name`, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
END;
--> statement-breakpoint
CREATE TRIGGER `entity_changes_metadata_update` AFTER UPDATE ON `metadata` BEGIN
	INSERT INTO `entity_changes` (`tbl`, `seed_local_id`, `seed_uid`, `property_name`, `at`) VALUES ('metadata', NEW.`seed_local_id`, NEW.`seed_uid`, NEW.`property_name`, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
	INSERT INTO `entity_changes` (`tbl`, `seed_local_id`, `seed_uid`, `property_name`, `at`) SELECT 'metadata', OLD.`seed_local_id`, OLD.`seed_uid`, OLD.`property_name`, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE OLD.`seed_local_id` IS NOT NEW.`seed_local_id` OR OLD.`seed_uid` IS NOT NEW.`seed_uid` OR OLD.`property_name` IS NOT NEW.`property_name`;
END;
--> statement-breakpoint
CREATE TRIGGER `entity_changes_metadata_delete` AFTER DELETE ON `metadata` BEGIN
	INSERT INTO `entity_changes` (`tbl`, `seed_local_id`, `seed_uid`, `property_name`, `at`) VALUES ('metadata', OLD.`seed_local_id`, OLD.`seed_uid`, OLD.`property_name`, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
END;