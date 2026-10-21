-- A sync after an unpublish and republish inserted the old seed uid as a second seed row with no
-- versions, while the item's old version rows still record that uid in versions.seed_uid. Property
-- rows sync attached to that row move to the item, then the row is deleted.
UPDATE `metadata` SET `seed_local_id` = (
  SELECT `v`.`seed_local_id` FROM `versions` `v`
  JOIN `seeds` `owner` ON `owner`.`local_id` = `v`.`seed_local_id`
  JOIN `seeds` `ghost` ON `ghost`.`uid` = `v`.`seed_uid`
  WHERE `ghost`.`local_id` = `metadata`.`seed_local_id` AND `owner`.`local_id` != `ghost`.`local_id`
  LIMIT 1
)
WHERE `seed_local_id` IN (
  SELECT `ghost`.`local_id` FROM `seeds` `ghost`
  WHERE `ghost`.`uid` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `versions` WHERE `versions`.`seed_local_id` = `ghost`.`local_id`)
    AND EXISTS (
      SELECT 1 FROM `versions` `v` JOIN `seeds` `owner` ON `owner`.`local_id` = `v`.`seed_local_id`
      WHERE `v`.`seed_uid` = `ghost`.`uid` AND `owner`.`local_id` != `ghost`.`local_id`
    )
);
--> statement-breakpoint
DELETE FROM `seeds` WHERE `local_id` IN (
  SELECT `ghost`.`local_id` FROM `seeds` `ghost`
  WHERE `ghost`.`uid` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `versions` WHERE `versions`.`seed_local_id` = `ghost`.`local_id`)
    AND EXISTS (
      SELECT 1 FROM `versions` `v` JOIN `seeds` `owner` ON `owner`.`local_id` = `v`.`seed_local_id`
      WHERE `v`.`seed_uid` = `ghost`.`uid` AND `owner`.`local_id` != `ghost`.`local_id`
    )
);
