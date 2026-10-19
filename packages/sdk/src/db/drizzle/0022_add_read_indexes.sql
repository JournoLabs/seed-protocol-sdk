CREATE INDEX `metadata_seed_local_id_property_name_idx` ON `metadata` (`seed_local_id`,`property_name`);--> statement-breakpoint
CREATE INDEX `metadata_seed_uid_idx` ON `metadata` (`seed_uid`);--> statement-breakpoint
CREATE INDEX `seeds_uid_idx` ON `seeds` (`uid`);--> statement-breakpoint
CREATE INDEX `seeds_type_idx` ON `seeds` (`type`);--> statement-breakpoint
CREATE INDEX `versions_seed_local_id_idx` ON `versions` (`seed_local_id`);