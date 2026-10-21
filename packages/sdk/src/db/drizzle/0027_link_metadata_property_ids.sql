-- Links metadata rows written without property_id to their property (decision D4: readers match
-- rows by property_id). Only rows whose seed records its model (seeds.model_file_id) are linked,
-- and only to one of that model's properties. Rows that match no property, or several, keep NULL
-- and are read by name.
--
-- First the rows whose stored name is a property's key (unique per model).
UPDATE `metadata` SET `property_id` = (
  SELECT `p`.`id` FROM `seeds` `s`
  JOIN `models` `m` ON `m`.`schema_file_id` = `s`.`model_file_id`
  JOIN `properties` `p` ON `p`.`model_id` = `m`.`id`
  WHERE `s`.`local_id` = `metadata`.`seed_local_id` AND `p`.`name` = `metadata`.`property_name`
)
WHERE `property_id` IS NULL AND EXISTS (
  SELECT 1 FROM `seeds` `s`
  JOIN `models` `m` ON `m`.`schema_file_id` = `s`.`model_file_id`
  JOIN `properties` `p` ON `p`.`model_id` = `m`.`id`
  WHERE `s`.`local_id` = `metadata`.`seed_local_id` AND `p`.`name` = `metadata`.`property_name`
);
--> statement-breakpoint
-- Then the other stored forms, when exactly one property matches: `<key>Id` for an Image, File,
-- Html or Relation, and a List of Relation's `<singular key><Ref>Ids` (singular as `key` minus a
-- trailing `s` or `es`, or `ies` → `y`; other plurals stay NULL).
UPDATE `metadata` SET `property_id` = (
  SELECT `p`.`id` FROM `seeds` `s`
  JOIN `models` `m` ON `m`.`schema_file_id` = `s`.`model_file_id`
  JOIN `properties` `p` ON `p`.`model_id` = `m`.`id`
  LEFT JOIN `models` `r` ON `r`.`id` = `p`.`ref_model_id`
  WHERE `s`.`local_id` = `metadata`.`seed_local_id` AND (
    (
      (`p`.`data_type` IN ('Image', 'File', 'Html', 'Relation') OR `p`.`ref_value_type` IN ('Image', 'File', 'Html', 'Relation'))
      AND `p`.`name` || 'Id' = `metadata`.`property_name`
    ) OR (
      `p`.`data_type` = 'List' AND `r`.`name` IS NOT NULL
      AND length(`metadata`.`property_name`) > length(`r`.`name`) + 3
      AND substr(`metadata`.`property_name`, -(length(`r`.`name`) + 3)) = `r`.`name` || 'Ids'
      AND (
        `p`.`name` IN (
          substr(`metadata`.`property_name`, 1, length(`metadata`.`property_name`) - length(`r`.`name`) - 3),
          substr(`metadata`.`property_name`, 1, length(`metadata`.`property_name`) - length(`r`.`name`) - 3) || 's',
          substr(`metadata`.`property_name`, 1, length(`metadata`.`property_name`) - length(`r`.`name`) - 3) || 'es'
        ) OR (
          substr(`metadata`.`property_name`, length(`metadata`.`property_name`) - length(`r`.`name`) - 3, 1) = 'y'
          AND `p`.`name` = substr(`metadata`.`property_name`, 1, length(`metadata`.`property_name`) - length(`r`.`name`) - 4) || 'ies'
        )
      )
    )
  )
)
WHERE `property_id` IS NULL AND (
  SELECT COUNT(*) FROM `seeds` `s`
  JOIN `models` `m` ON `m`.`schema_file_id` = `s`.`model_file_id`
  JOIN `properties` `p` ON `p`.`model_id` = `m`.`id`
  LEFT JOIN `models` `r` ON `r`.`id` = `p`.`ref_model_id`
  WHERE `s`.`local_id` = `metadata`.`seed_local_id` AND (
    (
      (`p`.`data_type` IN ('Image', 'File', 'Html', 'Relation') OR `p`.`ref_value_type` IN ('Image', 'File', 'Html', 'Relation'))
      AND `p`.`name` || 'Id' = `metadata`.`property_name`
    ) OR (
      `p`.`data_type` = 'List' AND `r`.`name` IS NOT NULL
      AND length(`metadata`.`property_name`) > length(`r`.`name`) + 3
      AND substr(`metadata`.`property_name`, -(length(`r`.`name`) + 3)) = `r`.`name` || 'Ids'
      AND (
        `p`.`name` IN (
          substr(`metadata`.`property_name`, 1, length(`metadata`.`property_name`) - length(`r`.`name`) - 3),
          substr(`metadata`.`property_name`, 1, length(`metadata`.`property_name`) - length(`r`.`name`) - 3) || 's',
          substr(`metadata`.`property_name`, 1, length(`metadata`.`property_name`) - length(`r`.`name`) - 3) || 'es'
        ) OR (
          substr(`metadata`.`property_name`, length(`metadata`.`property_name`) - length(`r`.`name`) - 3, 1) = 'y'
          AND `p`.`name` = substr(`metadata`.`property_name`, 1, length(`metadata`.`property_name`) - length(`r`.`name`) - 4) || 'ies'
        )
      )
    )
  )
) = 1;
