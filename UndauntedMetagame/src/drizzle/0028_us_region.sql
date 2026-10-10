CREATE TABLE `huntregions_new` (
    `userId` text PRIMARY KEY NOT NULL REFERENCES `users`(`userId`),
    `region` text NOT NULL CHECK (`region` IN ('main', 'aus', 'ger', 'us'))
);
--> statement-breakpoint
INSERT INTO `huntregions_new` SELECT `userId`, `region` FROM `huntregions`;
--> statement-breakpoint
DROP TABLE `huntregions`;
--> statement-breakpoint
ALTER TABLE `huntregions_new` RENAME TO `huntregions`;
