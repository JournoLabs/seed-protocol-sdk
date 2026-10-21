-- Unique keys the writers already assume (SDK audit T9): one model_schemas link per model and
-- schema, and one seeds / versions row per attested uid (placeholder uids are left out, see
-- seedSchema/attestedUid.ts). Duplicates are merged first. The survivor is the row with local
-- children (versions for a seed, metadata for a version), then the oldest; the duplicate's
-- references move to it, columns it lacks are copied from the duplicate, and the duplicate is
-- deleted.
CREATE TABLE `__t9_seed_merge` (`dup_rowid` integer PRIMARY KEY, `dup` text, `keep` text);
--> statement-breakpoint
INSERT INTO `__t9_seed_merge` (`dup_rowid`, `dup`, `keep`)
SELECT `rid`, `local_id`, `keep` FROM (
  SELECT `s`.`rowid` AS `rid`, `s`.`local_id`,
    first_value(`s`.`local_id`) OVER `w` AS `keep`,
    row_number() OVER `w` AS `rank`
  FROM `seeds` `s`
  WHERE `s`.`uid` IS NOT NULL AND trim(`s`.`uid`) NOT IN ('', 'NULL') AND lower(trim(`s`.`uid`)) != '0x0000000000000000000000000000000000000000000000000000000000000000'
  WINDOW `w` AS (
    PARTITION BY `s`.`uid`
    ORDER BY (`s`.`local_id` IS NULL),
      EXISTS (SELECT 1 FROM `versions` `v` WHERE `v`.`seed_local_id` = `s`.`local_id`) DESC,
      COALESCE(`s`.`created_at`, 9223372036854775807), `s`.`rowid`
  )
)
WHERE `rank` > 1;
--> statement-breakpoint
UPDATE `seeds` SET
  `schema_uid` = COALESCE(`schema_uid`, (SELECT `d`.`schema_uid` FROM `__t9_seed_merge` `m` JOIN `seeds` `d` ON `d`.`rowid` = `m`.`dup_rowid` WHERE `m`.`keep` = `seeds`.`local_id` AND `d`.`schema_uid` IS NOT NULL LIMIT 1)),
  `type` = COALESCE(`type`, (SELECT `d`.`type` FROM `__t9_seed_merge` `m` JOIN `seeds` `d` ON `d`.`rowid` = `m`.`dup_rowid` WHERE `m`.`keep` = `seeds`.`local_id` AND `d`.`type` IS NOT NULL LIMIT 1)),
  `model_file_id` = COALESCE(`model_file_id`, (SELECT `d`.`model_file_id` FROM `__t9_seed_merge` `m` JOIN `seeds` `d` ON `d`.`rowid` = `m`.`dup_rowid` WHERE `m`.`keep` = `seeds`.`local_id` AND `d`.`model_file_id` IS NOT NULL LIMIT 1)),
  `publisher` = COALESCE(`publisher`, (SELECT `d`.`publisher` FROM `__t9_seed_merge` `m` JOIN `seeds` `d` ON `d`.`rowid` = `m`.`dup_rowid` WHERE `m`.`keep` = `seeds`.`local_id` AND `d`.`publisher` IS NOT NULL LIMIT 1)),
  `attestation_raw` = COALESCE(`attestation_raw`, (SELECT `d`.`attestation_raw` FROM `__t9_seed_merge` `m` JOIN `seeds` `d` ON `d`.`rowid` = `m`.`dup_rowid` WHERE `m`.`keep` = `seeds`.`local_id` AND `d`.`attestation_raw` IS NOT NULL LIMIT 1)),
  `attestation_created_at` = COALESCE(`attestation_created_at`, (SELECT `d`.`attestation_created_at` FROM `__t9_seed_merge` `m` JOIN `seeds` `d` ON `d`.`rowid` = `m`.`dup_rowid` WHERE `m`.`keep` = `seeds`.`local_id` AND `d`.`attestation_created_at` IS NOT NULL LIMIT 1))
WHERE `local_id` IN (SELECT `keep` FROM `__t9_seed_merge`);
--> statement-breakpoint
-- A property row the survivor already has (same attestation uid) is not moved.
DELETE FROM `metadata`
WHERE `seed_local_id` IN (SELECT `dup` FROM `__t9_seed_merge` WHERE `keep` IS NOT NULL)
  AND `metadata`.`uid` IS NOT NULL AND trim(`metadata`.`uid`) NOT IN ('', 'NULL') AND lower(trim(`metadata`.`uid`)) != '0x0000000000000000000000000000000000000000000000000000000000000000'
  AND EXISTS (
    SELECT 1 FROM `metadata` `k` JOIN `__t9_seed_merge` `m` ON `k`.`seed_local_id` = `m`.`keep`
    WHERE `m`.`dup` = `metadata`.`seed_local_id` AND `k`.`uid` = `metadata`.`uid`
  );
--> statement-breakpoint
UPDATE `metadata` SET `seed_local_id` = (SELECT `keep` FROM `__t9_seed_merge` WHERE `dup` = `metadata`.`seed_local_id`)
WHERE `seed_local_id` IN (SELECT `dup` FROM `__t9_seed_merge` WHERE `keep` IS NOT NULL);
--> statement-breakpoint
UPDATE `versions` SET `seed_local_id` = (SELECT `keep` FROM `__t9_seed_merge` WHERE `dup` = `versions`.`seed_local_id`)
WHERE `seed_local_id` IN (SELECT `dup` FROM `__t9_seed_merge` WHERE `keep` IS NOT NULL);
--> statement-breakpoint
UPDATE `pending_writes` SET `seed_local_id` = (SELECT `keep` FROM `__t9_seed_merge` WHERE `dup` = `pending_writes`.`seed_local_id`)
WHERE `seed_local_id` IN (SELECT `dup` FROM `__t9_seed_merge` WHERE `keep` IS NOT NULL);
--> statement-breakpoint
UPDATE `publish_processes` SET `seed_local_id` = (SELECT `keep` FROM `__t9_seed_merge` WHERE `dup` = `publish_processes`.`seed_local_id`)
WHERE `seed_local_id` IN (SELECT `dup` FROM `__t9_seed_merge` WHERE `keep` IS NOT NULL);
--> statement-breakpoint
UPDATE `arweave_l1_finalize_jobs` SET `seed_local_id` = (SELECT `keep` FROM `__t9_seed_merge` WHERE `dup` = `arweave_l1_finalize_jobs`.`seed_local_id`)
WHERE `seed_local_id` IN (SELECT `dup` FROM `__t9_seed_merge` WHERE `keep` IS NOT NULL);
--> statement-breakpoint
UPDATE `html_embedded_image_co_publish` SET `image_seed_local_id` = (SELECT `keep` FROM `__t9_seed_merge` WHERE `dup` = `html_embedded_image_co_publish`.`image_seed_local_id`)
WHERE `image_seed_local_id` IN (SELECT `dup` FROM `__t9_seed_merge` WHERE `keep` IS NOT NULL);
--> statement-breakpoint
UPDATE OR IGNORE `html_embedded_image_co_publish` SET `parent_seed_local_id` = (SELECT `keep` FROM `__t9_seed_merge` WHERE `dup` = `html_embedded_image_co_publish`.`parent_seed_local_id`)
WHERE `parent_seed_local_id` IN (SELECT `dup` FROM `__t9_seed_merge` WHERE `keep` IS NOT NULL);
--> statement-breakpoint
DELETE FROM `html_embedded_image_co_publish` WHERE `parent_seed_local_id` IN (SELECT `dup` FROM `__t9_seed_merge` WHERE `keep` IS NOT NULL);
--> statement-breakpoint
UPDATE OR IGNORE `html_embedded_image_co_publish` SET `html_seed_local_id` = (SELECT `keep` FROM `__t9_seed_merge` WHERE `dup` = `html_embedded_image_co_publish`.`html_seed_local_id`)
WHERE `html_seed_local_id` IN (SELECT `dup` FROM `__t9_seed_merge` WHERE `keep` IS NOT NULL);
--> statement-breakpoint
DELETE FROM `html_embedded_image_co_publish` WHERE `html_seed_local_id` IN (SELECT `dup` FROM `__t9_seed_merge` WHERE `keep` IS NOT NULL);
--> statement-breakpoint
DELETE FROM `seeds` WHERE `rowid` IN (SELECT `dup_rowid` FROM `__t9_seed_merge`);
--> statement-breakpoint
DROP TABLE `__t9_seed_merge`;
--> statement-breakpoint
CREATE TABLE `__t9_version_merge` (`dup_rowid` integer PRIMARY KEY, `dup` text, `keep` text);
--> statement-breakpoint
INSERT INTO `__t9_version_merge` (`dup_rowid`, `dup`, `keep`)
SELECT `rid`, `local_id`, `keep` FROM (
  SELECT `v`.`rowid` AS `rid`, `v`.`local_id`,
    first_value(`v`.`local_id`) OVER `w` AS `keep`,
    row_number() OVER `w` AS `rank`
  FROM `versions` `v`
  WHERE `v`.`uid` IS NOT NULL AND trim(`v`.`uid`) NOT IN ('', 'NULL') AND lower(trim(`v`.`uid`)) != '0x0000000000000000000000000000000000000000000000000000000000000000'
  WINDOW `w` AS (
    PARTITION BY `v`.`uid`
    ORDER BY (`v`.`local_id` IS NULL),
      EXISTS (SELECT 1 FROM `metadata` `md` WHERE `md`.`version_local_id` = `v`.`local_id`) DESC,
      COALESCE(`v`.`created_at`, 9223372036854775807), `v`.`rowid`
  )
)
WHERE `rank` > 1;
--> statement-breakpoint
UPDATE `versions` SET
  `seed_uid` = COALESCE(`seed_uid`, (SELECT `d`.`seed_uid` FROM `__t9_version_merge` `m` JOIN `versions` `d` ON `d`.`rowid` = `m`.`dup_rowid` WHERE `m`.`keep` = `versions`.`local_id` AND `d`.`seed_uid` IS NOT NULL LIMIT 1)),
  `seed_type` = COALESCE(`seed_type`, (SELECT `d`.`seed_type` FROM `__t9_version_merge` `m` JOIN `versions` `d` ON `d`.`rowid` = `m`.`dup_rowid` WHERE `m`.`keep` = `versions`.`local_id` AND `d`.`seed_type` IS NOT NULL LIMIT 1)),
  `attestation_raw` = COALESCE(`attestation_raw`, (SELECT `d`.`attestation_raw` FROM `__t9_version_merge` `m` JOIN `versions` `d` ON `d`.`rowid` = `m`.`dup_rowid` WHERE `m`.`keep` = `versions`.`local_id` AND `d`.`attestation_raw` IS NOT NULL LIMIT 1)),
  `attestation_created_at` = COALESCE(`attestation_created_at`, (SELECT `d`.`attestation_created_at` FROM `__t9_version_merge` `m` JOIN `versions` `d` ON `d`.`rowid` = `m`.`dup_rowid` WHERE `m`.`keep` = `versions`.`local_id` AND `d`.`attestation_created_at` IS NOT NULL LIMIT 1)),
  `publisher` = COALESCE(`publisher`, (SELECT `d`.`publisher` FROM `__t9_version_merge` `m` JOIN `versions` `d` ON `d`.`rowid` = `m`.`dup_rowid` WHERE `m`.`keep` = `versions`.`local_id` AND `d`.`publisher` IS NOT NULL LIMIT 1)),
  `revoked_at` = COALESCE(`revoked_at`, (SELECT `d`.`revoked_at` FROM `__t9_version_merge` `m` JOIN `versions` `d` ON `d`.`rowid` = `m`.`dup_rowid` WHERE `m`.`keep` = `versions`.`local_id` AND `d`.`revoked_at` IS NOT NULL LIMIT 1))
WHERE `local_id` IN (SELECT `keep` FROM `__t9_version_merge`);
--> statement-breakpoint
UPDATE `metadata` SET `version_local_id` = (SELECT `keep` FROM `__t9_version_merge` WHERE `dup` = `metadata`.`version_local_id`)
WHERE `version_local_id` IN (SELECT `dup` FROM `__t9_version_merge` WHERE `keep` IS NOT NULL);
--> statement-breakpoint
UPDATE `arweave_l1_finalize_jobs` SET `version_local_id` = (SELECT `keep` FROM `__t9_version_merge` WHERE `dup` = `arweave_l1_finalize_jobs`.`version_local_id`)
WHERE `version_local_id` IN (SELECT `dup` FROM `__t9_version_merge` WHERE `keep` IS NOT NULL);
--> statement-breakpoint
DELETE FROM `versions` WHERE `rowid` IN (SELECT `dup_rowid` FROM `__t9_version_merge`);
--> statement-breakpoint
DROP TABLE `__t9_version_merge`;
--> statement-breakpoint
DELETE FROM `model_schemas`
WHERE `model_id` IS NOT NULL AND `schema_id` IS NOT NULL
  AND `id` NOT IN (SELECT MIN(`id`) FROM `model_schemas` GROUP BY `model_id`, `schema_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_schemas_model_id_schema_id_unique` ON `model_schemas` (`model_id`,`schema_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `seeds_attested_uid_unique` ON `seeds` (`uid`) WHERE "seeds"."uid" IS NOT NULL AND trim("seeds"."uid") NOT IN ('', 'NULL') AND lower(trim("seeds"."uid")) != '0x0000000000000000000000000000000000000000000000000000000000000000';
--> statement-breakpoint
CREATE UNIQUE INDEX `versions_attested_uid_unique` ON `versions` (`uid`) WHERE "versions"."uid" IS NOT NULL AND trim("versions"."uid") NOT IN ('', 'NULL') AND lower(trim("versions"."uid")) != '0x0000000000000000000000000000000000000000000000000000000000000000';
