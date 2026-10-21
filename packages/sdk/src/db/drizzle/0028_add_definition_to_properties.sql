ALTER TABLE `properties` ADD `definition` text;
--> statement-breakpoint
-- Backfill from the stored schema files: a property row takes the property object whose `id` is
-- its schema_file_id, from the newest schema version that has one. Rows no stored file names by id
-- keep NULL and read their definition from the columns alone.
UPDATE `properties` SET `definition` = (
	SELECT `p`.`value`
	FROM `schemas` `s`,
		json_each(CASE WHEN json_valid(`s`.`schema_data`) THEN `s`.`schema_data` ELSE '{}' END, '$.models') `m`,
		json_each(`m`.`value`, '$.properties') `p`
	WHERE `m`.`type` = 'object'
		AND json_type(`m`.`value`, '$.properties') = 'object'
		AND `p`.`type` = 'object'
		AND json_extract(`p`.`value`, '$.id') = `properties`.`schema_file_id`
	ORDER BY `s`.`version` DESC, `s`.`id` DESC
	LIMIT 1
) WHERE `definition` IS NULL AND `schema_file_id` IS NOT NULL;
