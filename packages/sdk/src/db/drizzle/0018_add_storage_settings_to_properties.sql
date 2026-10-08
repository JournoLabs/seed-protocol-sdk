ALTER TABLE `properties` ADD `storage_type` text;
--> statement-breakpoint
ALTER TABLE `properties` ADD `local_storage_dir` text;
--> statement-breakpoint
ALTER TABLE `properties` ADD `filename_suffix` text;
--> statement-breakpoint
UPDATE `properties` SET (`storage_type`, `local_storage_dir`, `filename_suffix`) = (
	SELECT
		CASE
			WHEN json_type(`p`.`def`, '$.storage') = 'object' THEN
				CASE WHEN json_extract(`p`.`def`, '$.storage.type') = 'ItemStorage' THEN 'ItemStorage' ELSE 'PropertyStorage' END
			ELSE json_extract(`p`.`def`, '$.storageType')
		END,
		CASE
			WHEN json_type(`p`.`def`, '$.storage') = 'object' THEN json_extract(`p`.`def`, '$.storage.path')
			ELSE json_extract(`p`.`def`, '$.localStorageDir')
		END,
		CASE
			WHEN json_type(`p`.`def`, '$.storage') = 'object' THEN json_extract(`p`.`def`, '$.storage.extension')
			ELSE json_extract(`p`.`def`, '$.filenameSuffix')
		END
	FROM (
		SELECT json_extract(
			`schemas`.`schema_data`,
			'$.models."' || `models`.`name` || '".properties."' || `properties`.`name` || '"'
		) AS `def`
		FROM `models`
		INNER JOIN `model_schemas` ON `model_schemas`.`model_id` = `models`.`id`
		INNER JOIN `schemas` ON `schemas`.`id` = `model_schemas`.`schema_id`
		WHERE `models`.`id` = `properties`.`model_id`
			AND `models`.`name` NOT LIKE '%"%'
			AND json_valid(`schemas`.`schema_data`)
			AND json_type(
				`schemas`.`schema_data`,
				'$.models."' || `models`.`name` || '".properties."' || `properties`.`name` || '"'
			) = 'object'
		ORDER BY `schemas`.`id` DESC
		LIMIT 1
	) AS `p`
) WHERE `storage_type` IS NULL
	AND `name` NOT LIKE '%"%'
	AND EXISTS (
		SELECT 1 FROM `models`
		INNER JOIN `model_schemas` ON `model_schemas`.`model_id` = `models`.`id`
		INNER JOIN `schemas` ON `schemas`.`id` = `model_schemas`.`schema_id`
		WHERE `models`.`id` = `properties`.`model_id`
			AND `models`.`name` NOT LIKE '%"%'
			AND json_valid(`schemas`.`schema_data`)
			AND json_type(
				`schemas`.`schema_data`,
				'$.models."' || `models`.`name` || '".properties."' || `properties`.`name` || '"'
			) = 'object'
	);
