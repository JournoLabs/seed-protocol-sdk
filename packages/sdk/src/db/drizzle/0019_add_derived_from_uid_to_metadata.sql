ALTER TABLE `metadata` ADD `derived_from_uid` text;
--> statement-breakpoint
UPDATE `metadata` SET
	`derived_from_uid` = (
		SELECT `source`.`uid`
		FROM `metadata` AS `source`
		WHERE `source`.`version_uid` = `metadata`.`version_uid`
			AND `source`.`property_name` = 'storageTransactionId'
			AND `source`.`uid` IS NOT NULL
			AND `source`.`property_value` = `metadata`.`property_value`
		ORDER BY COALESCE(`source`.`attestation_created_at`, `source`.`created_at`) DESC
		LIMIT 1
	),
	`attestation_created_at` = COALESCE(`attestation_created_at`, (
		SELECT `source`.`attestation_created_at`
		FROM `metadata` AS `source`
		WHERE `source`.`version_uid` = `metadata`.`version_uid`
			AND `source`.`property_name` = 'storageTransactionId'
			AND `source`.`uid` IS NOT NULL
			AND `source`.`property_value` = `metadata`.`property_value`
		ORDER BY COALESCE(`source`.`attestation_created_at`, `source`.`created_at`) DESC
		LIMIT 1
	))
WHERE `uid` IS NULL
	AND `ref_value_type` = 'file'
	AND `version_uid` IS NOT NULL
	AND `derived_from_uid` IS NULL
	AND EXISTS (
		SELECT 1
		FROM `metadata` AS `source`
		WHERE `source`.`version_uid` = `metadata`.`version_uid`
			AND `source`.`property_name` = 'storageTransactionId'
			AND `source`.`uid` IS NOT NULL
			AND `source`.`property_value` = `metadata`.`property_value`
	);
