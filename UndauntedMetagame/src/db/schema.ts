import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const recoveryproofs = sqliteTable('recoveryproofs', {
    discordId: text('discordId').primaryKey().notNull(),
    userId: text('userId').unique().notNull(),
    keyHash: text('keyHash').notNull()
});
export const recoverychallenges = sqliteTable('recoverychallenges', {
    tokenHash: text('tokenHash').primaryKey().notNull(), discordId: text('discordId').notNull(),
    userId: text('userId'), keyHash: text('keyHash'), expiresAt: integer('expiresAt').notNull(),
    used: integer('used').notNull().default(0)
});
export const authepochs = sqliteTable('authepochs', {
    userId: text('userId').primaryKey().notNull(), epoch: integer('epoch').notNull().default(0)
});
export const recoveryevents = sqliteTable('recoveryevents', {
    id: integer('id').primaryKey({autoIncrement:true}), discordId: text('discordId').notNull(),
    action: text('action').notNull(), createdAt: integer('createdAt').notNull()
}, table=>[index('recoveryevents_actor_time').on(table.discordId,table.createdAt)]);

export const users = sqliteTable("users", {
    userId: text("userId").notNull().primaryKey(),
    name: text("name").notNull(),
    notes: integer("notes").notNull(),
    isAdmin: integer("isAdmin", {mode: "boolean"}).notNull().default(false)
})

export const playeraddresses = sqliteTable('player_addresses', {
    accountId:text('account_id').notNull(), address:text('address').notNull(), lastSeen:integer('last_seen').notNull()
},t=>[primaryKey({columns:[t.accountId,t.address]})]);
export const accountbans = sqliteTable('account_bans', {
    accountId:text('account_id').notNull().primaryKey(),reason:text('reason').notNull(),address:text('address'),
    active:integer('active').notNull(),updatedAt:integer('updated_at').notNull(),actor:text('actor').notNull()
},t=>[index('active_ban_address').on(t.address,t.active)]);
export const moderationevents = sqliteTable('moderation_events', {
    id:integer('id').primaryKey({autoIncrement:true}),accountId:text('account_id').notNull(),reason:text('reason').notNull(),
    address:text('address'),active:integer('active').notNull(),createdAt:integer('created_at').notNull(),actor:text('actor').notNull()
});

export const discordlinks = sqliteTable('discordlinks', {
    discordId: text('discordId').notNull().primaryKey(),
    userId: text('userId').notNull().unique().references(() => users.userId),
    linkedAt: text('linkedAt').notNull()
});

export const huntregions = sqliteTable('huntregions', {
    userId: text('userId').notNull().primaryKey().references(() => users.userId),
    region: text('region', {enum:['main','aus','ger','us']}).notNull()
}, table => [check('huntregions_region', sql`${table.region} IN ('main', 'aus', 'ger', 'us')`)]);


export const characters = sqliteTable("characters", {
    characterId: text("characterId").notNull().primaryKey(),
    userId: text("userId").notNull(),
    createdDate: text("createdDate").notNull(),
    lastModifiedDate: text("lastModifiedDate").notNull(),
    name: text("name").notNull(),
    updateVersion: integer("updateVersion").notNull(),
    data: text("data").notNull()
});

export const inventory = sqliteTable("inventories", {
    characterId: text("characterId").notNull().primaryKey(),
    instancedItems: text("instancedItems").notNull(),
    stackedItems: text("stackedItems").notNull()
});

export const loadouts = sqliteTable("loadouts", {
    characterId: text("characterId").notNull().primaryKey(),
    userId: text("userId").notNull(),
    loadouts: text("loadouts").notNull(),
    persistent: text("persistent").notNull()
});

export const gameserverapikeys = sqliteTable("gameserverapikeys", {
    id: integer("id").notNull().primaryKey({autoIncrement: true}),
    keyHash: text("keyHash")
});

export const userapikeys = sqliteTable("userapikeys", {
    userId: text("userId").notNull().primaryKey(),
    keyHash: text("keyHash").notNull()
});

export const userapikeystoregister = sqliteTable("userapikeystoregister", {
    userId: text("userId").notNull().primaryKey(),
    key: text("key").notNull()
});

export const gameserverapikeystoregister = sqliteTable("gameserverapikeystoregister", {
    key: text("key").primaryKey()
});

export const breadcrumbs = sqliteTable("breadcrumbs", {
    characterId: text("characterId").notNull().primaryKey(),
    userId: text("userId").notNull(),
    breadcrumbs: text("breadcrumbs").notNull(),
    updateVersion: integer("updateVersion").notNull()
});

export const encounteredcontent = sqliteTable("encounteredcontent", {
    characterId: text("characterId").notNull().primaryKey(),
    userId: text("userId").notNull(),
    encounteredcontent: text("encounteredcontent").notNull()
});

export const invitecodes = sqliteTable("invitecodes", {
    inviteCode: text("invitecode").notNull().primaryKey(),
    usesRemaining: integer("usesRemaining").notNull(),
    infiniteUses: integer("infiniteUses", {mode: "boolean"}).notNull()
});

// Result of every applied inventory transaction, so a retried request gets the
// stored answer instead of running twice. Keyed by the request body as well as
// the id: only an identical request is a retry.
export const inventorytransactions = sqliteTable("inventorytransactions", {
    id: integer("id").notNull().primaryKey({autoIncrement: true}),
    transactionId: text("transactionId").notNull(),
    characterId: text("characterId").notNull(),
    userId: text("userId").notNull(),
    requestHash: text("requestHash").notNull(),
    status: integer("status").notNull(),
    response: text("response").notNull(),
    createdDate: text("createdDate").notNull()
}, (table) => [
    uniqueIndex("inventorytransactions_character_transaction_request").on(table.characterId, table.transactionId, table.requestHash),
    index("inventorytransactions_created_date").on(table.createdDate)
]);

// Append-only log of every item change (triggers in the migration refuse UPDATE and DELETE)
export const inventorylog = sqliteTable("inventorylog", {
    id: integer("id").notNull().primaryKey({autoIncrement: true}),
    time: text("time").notNull(),
    userId: text("userId").notNull(),
    characterId: text("characterId").notNull(),
    transactionId: text("transactionId"),
    source: text("source"),
    caller: text("caller").notNull(),
    operation: text("operation").notNull(),
    catalogId: text("catalogId"),
    instanceId: text("instanceId"),
    quantityChange: integer("quantityChange"),
    quantityAfter: integer("quantityAfter"),
    updateVersion: integer("updateVersion")
}, (table) => [
    index("inventorylog_character").on(table.characterId, table.id)
]);

// Saved versions of each character's data blob (what is kept: controllers/savehistory.ts)
export const characterhistory = sqliteTable("characterhistory", {
    id: integer("id").notNull().primaryKey({autoIncrement: true}),
    characterId: text("characterId").notNull(),
    userId: text("userId").notNull(),
    updateVersion: integer("updateVersion").notNull(),
    name: text("name").notNull(),
    data: text("data").notNull(),
    savedDate: text("savedDate").notNull(),
    reason: text("reason").notNull()
}, (table) => [
    index("characterhistory_character").on(table.characterId, table.id)
]);

// Saved versions of each character's loadouts, kept like characterhistory. Loadouts carry no
// row version of their own, so version is a per-character counter.
export const loadouthistory = sqliteTable("loadouthistory", {
    id: integer("id").notNull().primaryKey({autoIncrement: true}),
    characterId: text("characterId").notNull(),
    userId: text("userId").notNull(),
    version: integer("version").notNull(),
    loadouts: text("loadouts").notNull(),
    persistent: text("persistent").notNull(),
    savedDate: text("savedDate").notNull(),
    reason: text("reason").notNull()
}, (table) => [
    index("loadouthistory_character").on(table.characterId, table.id)
]);

// Real progression. Only accounts in real mode read or write the tables below:
// every account by default, or with PROGRESSION_MODE=stub only the accounts in
// PROGRESSION_REAL_ACCOUNTS (everyone else keeps the upstream stubs).

// One row per account and track. progress is the total XP; the earned ranks are
// worked out from vendor/progression_config.json exactly like the client does.
export const progresstracks = sqliteTable("progress_tracks", {
    accountId: text("accountId").notNull(),
    progressionId: text("progressionId").notNull(),
    progress: integer("progress").notNull(),
    confirmedFreeRank: integer("confirmedFreeRank").notNull(),
    confirmedPremiumRank: integer("confirmedPremiumRank").notNull(),
    confirmedDate: text("confirmedDate").notNull(),
    updatedDate: text("updatedDate").notNull()
}, (table) => [
    primaryKey({columns: [table.accountId, table.progressionId]})
]);

// Objective state exactly as the game server last sent it
export const objectives = sqliteTable("objectives", {
    accountId: text("accountId").notNull(),
    objectiveId: text("objectiveId").notNull(),
    progress: integer("progress").notNull(),
    completedCount: integer("completedCount").notNull(),
    createdDate: text("createdDate").notNull(),
    lastModifiedDate: text("lastModifiedDate").notNull()
}, (table) => [
    primaryKey({columns: [table.accountId, table.objectiveId]})
]);

// Append-only audit of every real-mode write: the raw request body and our reply
// (triggers in the migration refuse UPDATE and DELETE)
export const progressionevents = sqliteTable("progression_events", {
    id: integer("id").notNull().primaryKey({autoIncrement: true}),
    time: text("time").notNull(),
    accountId: text("accountId").notNull(),
    caller: text("caller").notNull(),
    route: text("route").notNull(),
    body: text("body"),
    status: integer("status").notNull(),
    reply: text("reply"),
    note: text("note")
}, (table) => [
    index("progression_events_account").on(table.accountId, table.id)
]);

export const huntpassselection = sqliteTable("huntpassselection", {
    accountId: text("accountId").notNull().primaryKey(),
    progressionId: text("progressionId").notNull(),
    updatedDate: text("updatedDate").notNull()
});

// duration is in hours, 0 = permanent. A revoked row is kept (revokedDate set) so
// a revoked default entitlement is not handed out again.
export const entitlements = sqliteTable("entitlements", {
    accountId: text("accountId").notNull(),
    name: text("name").notNull(),
    activatedDate: text("activatedDate").notNull(),
    duration: integer("duration").notNull(),
    source: text("source").notNull(),
    grantedDate: text("grantedDate").notNull(),
    revokedDate: text("revokedDate")
}, (table) => [
    primaryKey({columns: [table.accountId, table.name]})
]);

// startedDate is the ISO-8601 string exactly as the game server sent it
export const cooldowns = sqliteTable("cooldowns", {
    accountId: text("accountId").notNull(),
    cooldownId: text("cooldownId").notNull(),
    startedDate: text("startedDate").notNull(),
    updatedDate: text("updatedDate").notNull()
}, (table) => [
    primaryKey({columns: [table.accountId, table.cooldownId]})
]);

// data is the bounty element JSON as the game server sent it
export const bounties = sqliteTable("bounties", {
    accountId: text("accountId").notNull(),
    bountyId: text("bountyId").notNull(),
    slotIndex: integer("slotIndex"),
    updateVersion: integer("updateVersion").notNull(),
    data: text("data").notNull(),
    updatedDate: text("updatedDate").notNull()
}, (table) => [
    primaryKey({columns: [table.accountId, table.bountyId]})
]);

export const bountydraft = sqliteTable("bountydraft", {
    accountId: text("accountId").notNull().primaryKey(),
    data: text("data").notNull(),
    updatedDate: text("updatedDate").notNull()
});

// Unlocked character loadout slots and the active slot. No row = 1 slot, slot 0.
export const loadoutslots = sqliteTable("loadoutslots", {
    characterId: text("characterId").notNull().primaryKey(),
    userId: text("userId").notNull(),
    numCharacterSlots: integer("numCharacterSlots").notNull(),
    activeIndex: integer("activeIndex").notNull(),
    updatedDate: text("updatedDate").notNull()
});

// Friends list (roadmap 1.9, parties plan phase 3). One row per pair of accounts, the two ids
// sorted (userLow < userHigh) so a pair can only exist once. requesterId sent the request;
// status is PENDING until the other side accepts, then ACCEPTED. Times are epoch ms.
export const friendships = sqliteTable("friendships", {
    userLow: text("userLow").notNull(),
    userHigh: text("userHigh").notNull(),
    requesterId: text("requesterId").notNull(),
    status: text("status").notNull(),
    createdAt: integer("createdAt").notNull(),
    updatedAt: integer("updatedAt").notNull()
}, (table) => [
    primaryKey({columns: [table.userLow, table.userHigh]}),
    index("friendships_high").on(table.userHigh)
]);

// blockerId does not want to hear from blockedId: no friend requests, no party invites
export const blocks = sqliteTable("blocks", {
    blockerId: text("blockerId").notNull(),
    blockedId: text("blockedId").notNull(),
    createdAt: integer("createdAt").notNull()
}, (table) => [
    primaryKey({columns: [table.blockerId, table.blockedId]}),
    index("blocks_blocked").on(table.blockedId)
]);

// Escalation (roadmap 2.16; from Harmonic's fork, github.com/Harmonicrain/Undaunted 895f7c7). The last
// season snapshot a game server saved, per account and season, in canonical form: level, the XP towards
// the next level, the talent ranks held and the rewards collected. updateVersion and contentHash (the
// snapshot without its version) of the last accepted save tell a retry from a stale or reordered save.
// Only read and written with ESCALATION_MODE=real; every save is also in progression_events.
export const escalationprogression = sqliteTable("escalationprogression", {
    accountId: text("accountId").notNull(),
    seasonId: text("seasonId").notNull(),
    level: integer("level").notNull(),
    xp: integer("xp").notNull(),
    updateVersion: integer("updateVersion").notNull(),
    contentHash: text("contentHash").notNull(),
    updatedDate: text("updatedDate").notNull()
}, (table) => [
    primaryKey({columns: [table.accountId, table.seasonId]})
]);

// Talent ranks above 0 of the last accepted snapshot (a talent reset removes rows)
export const escalationtalents = sqliteTable("escalationtalents", {
    accountId: text("accountId").notNull(),
    seasonId: text("seasonId").notNull(),
    talentId: text("talentId").notNull(),
    rank: integer("rank").notNull()
}, (table) => [
    primaryKey({columns: [table.accountId, table.seasonId, table.talentId]})
]);

// Collected rewards; a collection is never undone, and collectedDate is the first save that had it
export const escalationunlocks = sqliteTable("escalationunlocks", {
    accountId: text("accountId").notNull(),
    seasonId: text("seasonId").notNull(),
    unlockId: text("unlockId").notNull(),
    collectedDate: text("collectedDate").notNull()
}, (table) => [
    primaryKey({columns: [table.accountId, table.seasonId, table.unlockId]})
]);

// Free store purchases (roadmap 3.7; from Harmonic's fork, github.com/Harmonicrain/Undaunted 895f7c7).
// One row per purchase token the client asked for (GET /token/:currency/:sku); only STORE=free issues
// them. tokenHash is the SHA-256 of the token (the token itself is not stored). characterId is the
// character that gets the items, fixed when the token is issued; offerHash is the offer as it was then,
// so a changed offer needs a new token. redeemedDate is set by POST /notification; a redeemed token
// answers again without granting anything. Expired tokens that were never redeemed are removed.
export const storepurchases = sqliteTable("storepurchases", {
    tokenHash: text("tokenHash").notNull().primaryKey(),
    accountId: text("accountId").notNull(),
    characterId: text("characterId").notNull(),
    skuId: text("skuId").notNull(),
    offerHash: text("offerHash").notNull(),
    createdDate: text("createdDate").notNull(),
    expiresDate: text("expiresDate").notNull(),
    redeemedDate: text("redeemedDate")
}, (table) => [
    index("storepurchases_account").on(table.accountId)
]);

// Trials leaderboard runs (roadmap 3.8). One row is one completed run; entries is the
// one-to-four player records the leaderboard needs. runKey makes a retried game-server
// submission idempotent, while groupKey lets reads keep only each solo player or party's best run.
// Current public identity used by the Trials leaderboard. The real service receives this
// from POST /profile/update; it is deliberately separate from the account's canonical name.
export const leaderboardprofiles = sqliteTable("leaderboardprofiles", {
    accountId: text("accountId").notNull().primaryKey(),
    epicId: text("epicId").notNull(),
    platformId: text("platformId").notNull(),
    platform: text("platform").notNull(),
    displayName: text("displayName").notNull(),
    updatedDate: text("updatedDate").notNull()
});

export const trialruns = sqliteTable("trialruns", {
    id: integer("id").notNull().primaryKey({autoIncrement: true}),
    trialId: text("trialId").notNull(),
    trialWeek: integer("trialWeek").notNull(),
    difficulty: integer("difficulty").notNull(),
    mode: text("mode").notNull(),
    runKey: text("runKey").notNull(),
    groupKey: text("groupKey").notNull(),
    completionTime: integer("completionTime").notNull(),
    objectivesCompleted: integer("objectivesCompleted").notNull(),
    sessionId: text("sessionId").notNull(),
    entries: text("entries").notNull(),
    submittedDate: text("submittedDate").notNull()
}, (table) => [
    uniqueIndex("trialruns_week_trial_difficulty_run").on(table.trialWeek, table.trialId, table.difficulty, table.runKey),
    index("trialruns_board").on(table.trialWeek, table.trialId, table.difficulty, table.mode, table.completionTime),
    index("trialruns_group").on(table.trialWeek, table.trialId, table.difficulty, table.mode, table.groupKey)
]);

// A completed week is finalized once. The count is diagnostic; Champion access itself is
// the permanent trials_leaderboard_placement entitlement granted to every Top-100 player.
export const trialweeks = sqliteTable("trialweeks", {
    week: integer("week").notNull().primaryKey(),
    finalizedDate: text("finalizedDate").notNull(),
    awardedAccounts: integer("awardedAccounts").notNull()
});

// Guilds (roadmap 3.11, the 1.4.4 client's v2 guild API; docs/findings/social.md). guildId is a
// random UUID (it also names the chat room Guild-<guildId>). nameKey and nameplateKey are lowercase
// copies for case-insensitive uniqueness; nameplateKey is NULL for a guild without a nameplate
// (a unique index allows many NULLs). leaderId always equals the one member row with rank Leader.
export const guilds = sqliteTable("guilds", {
    guildId: text("guildId").notNull().primaryKey(),
    name: text("name").notNull(),
    nameKey: text("nameKey").notNull(),
    nameplate: text("nameplate").notNull().default(""),
    nameplateKey: text("nameplateKey"),
    leaderId: text("leaderId").notNull(),
    createdAt: integer("createdAt").notNull(),
    updatedAt: integer("updatedAt").notNull()
}, (table) => [
    uniqueIndex("guilds_name_key").on(table.nameKey),
    uniqueIndex("guilds_nameplate_key").on(table.nameplateKey)
]);

// One guild per account, so the account is the key. rank: Member, Officer or Leader.
export const guildmembers = sqliteTable("guildmembers", {
    accountId: text("accountId").notNull().primaryKey(),
    guildId: text("guildId").notNull(),
    rank: text("rank").notNull(),
    joinedAt: integer("joinedAt").notNull(),
    updatedAt: integer("updatedAt").notNull()
}, (table) => [
    index("guildmembers_guild").on(table.guildId)
]);

// Invites that are still open: one per guild and invitee. Expired rows are ignored and swept.
export const guildinvites = sqliteTable("guildinvites", {
    inviteId: text("inviteId").notNull().primaryKey(),
    guildId: text("guildId").notNull(),
    inviteeId: text("inviteeId").notNull(),
    inviterId: text("inviterId").notNull(),
    createdAt: integer("createdAt").notNull(),
    expiresAt: integer("expiresAt").notNull()
}, (table) => [
    uniqueIndex("guildinvites_pair").on(table.guildId, table.inviteeId),
    index("guildinvites_invitee").on(table.inviteeId)
]);

// Slayer Links (controllers/slayerlinks.ts; contract from Harmonic's fork, github.com/Harmonicrain/Undaunted
// 895f7c7, corrected against the 1.4.4 exe). An invite from senderId to targetId for the sender's slot
// (0-2). status: PENDING until the target accepts (ACCEPTED), declines (DECLINED), the sender withdraws it
// or the two stop being friends (CANCELED), or it runs out (EXPIRED; set when next looked at). One pending
// invite per sender and target. Times are epoch ms, as in the other social tables.
export const slayerlinkinvites = sqliteTable("slayerlinkinvites", {
    inviteId: text("inviteId").notNull().primaryKey(),
    senderId: text("senderId").notNull(),
    targetId: text("targetId").notNull(),
    senderSlot: integer("senderSlot").notNull(),
    createdAt: integer("createdAt").notNull(),
    expiresAt: integer("expiresAt").notNull(),
    status: text("status").notNull()
}, (table) => [
    index("slayerlinkinvites_sender").on(table.senderId),
    index("slayerlinkinvites_target").on(table.targetId),
    uniqueIndex("slayerlinkinvites_pending_pair").on(table.senderId, table.targetId).where(sql`"status" = 'PENDING'`)
]);

// A link between two accounts, each in a slot of its own, until endsAt (a week after the accept). linkId
// is the accepted invite's id. A removed link is deleted; one that ran out stays until it is swept.
export const slayerlinks = sqliteTable("slayerlinks", {
    linkId: text("linkId").notNull().primaryKey(),
    senderId: text("senderId").notNull(),
    targetId: text("targetId").notNull(),
    senderSlot: integer("senderSlot").notNull(),
    targetSlot: integer("targetSlot").notNull(),
    createdAt: integer("createdAt").notNull(),
    endsAt: integer("endsAt").notNull()
}, (table) => [
    index("slayerlinks_sender").on(table.senderId),
    index("slayerlinks_target").on(table.targetId)
]);

// One-time data jobs the metagame ran at startup (migrations may only add tables, so a build can be
// rolled back); a job whose id is here is never run again
export const onetimejobs = sqliteTable("onetimejobs", {
    jobId: text("jobId").notNull().primaryKey(),
    doneDate: text("doneDate").notNull()
});

export const accountkeyrecovery = sqliteTable("accountkeyrecovery", {
    userId: text("userId").notNull().primaryKey(),
    keyHash: text("keyHash").notNull(),
    ciphertext: text("ciphertext").notNull()
});
