UPDATE `versions` SET `uid` = NULL WHERE `uid` = 'NULL';
--> statement-breakpoint
UPDATE `versions` SET `seed_uid` = NULL WHERE `seed_uid` = 'NULL';
--> statement-breakpoint
UPDATE `metadata` SET `uid` = NULL WHERE `uid` = 'NULL';
--> statement-breakpoint
UPDATE `metadata` SET `version_uid` = NULL WHERE `version_uid` = 'NULL';
--> statement-breakpoint
UPDATE `seeds` SET `uid` = NULL WHERE `uid` = 'NULL';
