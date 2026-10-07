ALTER TABLE `seeds` ADD `model_file_id` text;
--> statement-breakpoint
UPDATE `seeds` SET `model_file_id` = (
	SELECT `models`.`schema_file_id`
	FROM `metadata`
	INNER JOIN `properties` ON `properties`.`id` = `metadata`.`property_id`
	INNER JOIN `models` ON `models`.`id` = `properties`.`model_id`
	WHERE `metadata`.`seed_local_id` = `seeds`.`local_id`
		AND `models`.`schema_file_id` IS NOT NULL
	LIMIT 1
) WHERE `model_file_id` IS NULL;
