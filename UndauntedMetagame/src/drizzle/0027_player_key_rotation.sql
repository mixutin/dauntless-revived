CREATE TABLE recoveryproofs (discordId TEXT PRIMARY KEY NOT NULL, userId TEXT NOT NULL UNIQUE, keyHash TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE recoverychallenges (tokenHash TEXT PRIMARY KEY NOT NULL, discordId TEXT NOT NULL, userId TEXT, keyHash TEXT, expiresAt INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE TABLE authepochs (userId TEXT PRIMARY KEY NOT NULL, epoch INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE TABLE recoveryevents (id INTEGER PRIMARY KEY AUTOINCREMENT, discordId TEXT NOT NULL, action TEXT NOT NULL, createdAt INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX recoveryevents_actor_time ON recoveryevents(discordId,createdAt);
