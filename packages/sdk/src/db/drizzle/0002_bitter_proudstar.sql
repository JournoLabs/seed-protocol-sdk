CREATE UNIQUE INDEX `unique_schema_file_id` ON `models` (`schema_file_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `unique_property_schema_file_id` ON `properties` (`schema_file_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `unique_schema_schema_file_id` ON `schemas` (`schema_file_id`);