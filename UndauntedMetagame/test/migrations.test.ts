import { RemoveTestDb } from "./setup";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

// The migrations that came with the Harmonic port (0014 on) on a database that a server of the last
// release (migrations up to 0013_guilds) filled with players: every row of every table that existed is
// kept byte for byte, the new tables start empty, a second run changes nothing, and the previous build's
// migrator (the journal up to 0013) runs on the migrated database without an error or a change, so the
// previous build still starts after an update. The new migration files only add: no DROP, ALTER, or
// INSERT ... SELECT. Scratch databases in a temporary folder only.

const MIGRATIONS = path.resolve("src/drizzle");
const LAST_RELEASED = "0013_guilds";
const Dir = fs.mkdtempSync(path.join(os.tmpdir(), "dr-migrations-test-"));

after(() => {
    RemoveTestDb(() => undefined);

    try{
        fs.rmSync(Dir, { recursive: true, force: true });
    }
    catch{
        // a file still held open by a failed case; the temporary folder is left behind
    }
});

type Journal = { entries: { idx: number, when: number, tag: string }[] };
const Journal: Journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8"));
const ReleasedIndex = Journal.entries.findIndex((Entry) => Entry.tag === LAST_RELEASED);
const NewEntries = Journal.entries.slice(ReleasedIndex + 1);

// The migrations folder as the previous build shipped it: the journal up to 0013
function PreviousBuildMigrations(){
    const Folder = path.join(Dir, "previous-drizzle");

    fs.mkdirSync(path.join(Folder, "meta"), { recursive: true });
    for(const Entry of Journal.entries.slice(0, ReleasedIndex + 1)){
        fs.copyFileSync(path.join(MIGRATIONS, `${Entry.tag}.sql`), path.join(Folder, `${Entry.tag}.sql`));
    }
    fs.writeFileSync(path.join(Folder, "meta", "_journal.json"), JSON.stringify({ ...Journal, entries: Journal.entries.slice(0, ReleasedIndex + 1) }));

    return Folder;
}

function Open(File: string){
    return drizzle(File);
}

function Tables(Db: ReturnType<typeof Open>): string[] {
    return (Db.$client.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all() as any[]).map((Row) => Row.name);
}

function SchemaOf(Db: ReturnType<typeof Open>, Names: string[]){
    return Db.$client.prepare(`select type, name, tbl_name, sql from sqlite_master where tbl_name in (${Names.map(() => "?").join(", ")}) order by type, name`).all(...Names);
}

function Rows(Db: ReturnType<typeof Open>, Table: string){
    return Db.$client.prepare(`select * from "${Table}" order by rowid`).all();
}

function Snapshot(Db: ReturnType<typeof Open>, Names: string[]){
    return Object.fromEntries(Names.map((Name) => [Name, crypto.createHash("sha256").update(JSON.stringify(Rows(Db, Name))).digest("hex") + ` (${Rows(Db, Name).length} rows)`]));
}

// Two rows in every table of the released schema, with every column set (text, numbers and JSON where a
// column holds JSON), and one realistic player on top
function Seed(Db: ReturnType<typeof Open>){
    for(const Table of Tables(Db).filter((Name) => !Name.startsWith("__drizzle"))){
        const Columns = Db.$client.prepare(`pragma table_info("${Table}")`).all() as any[];

        for(let N = 1; N <= 2; N++){
            const Values = Columns.map((Column, Index) => {
                const Type = String(Column.type).toUpperCase();
                if(Type.includes("INT")) return N * 1000 + Index;
                if(/data|items|loadouts|persistent|body|reply/i.test(Column.name)) return JSON.stringify({ seeded: `${Table}.${Column.name}.${N}` });
                return `seed-${Table}-${Column.name}-${N}`;
            });

            Db.$client.prepare(`insert into "${Table}" (${Columns.map((Column) => `"${Column.name}"`).join(", ")}) values (${Columns.map(() => "?").join(", ")})`).run(...Values);
        }
    }

    const Now = "2026-09-22T10:00:00.000Z";
    const Player = "UID-migration-player";
    const Run = (Sql: string, ...Values: unknown[]) => Db.$client.prepare(Sql).run(...Values);

    Run("insert into users (userId, name, notes, isAdmin) values (?, 'Slayer', 0, 0)", Player);
    Run("insert into characters (characterId, userId, createdDate, lastModifiedDate, name, updateVersion, data) values ('char-mig', ?, 'Sep 20, 2026', 'Sep 22, 2026', 'Slayer', 42, '{\"SERIE_x\":\"1\"}')", Player);
    Run("insert into inventories (characterId, instancedItems, stackedItems) values ('char-mig', ?, ?)", JSON.stringify([{ catalogId: "WP_AXE", instanceId: "i-1", updateVersion: 3 }]), JSON.stringify([{ catalogId: "CURRENCY_NOTES", quantity: 1260 }]));
    Run("insert into entitlements (accountId, name, activatedDate, duration, source, grantedDate, revokedDate) values (?, 'season09b_premium', ?, 0, 'default', ?, null)", Player, Now, Now);
    Run("insert into entitlements (accountId, name, activatedDate, duration, source, grantedDate, revokedDate) values (?, 'ent_revoked', ?, 0, 'gameserver', ?, ?)", Player, Now, Now, Now);
    Run("insert into progress_tracks (accountId, progressionId, progress, confirmedFreeRank, confirmedPremiumRank, confirmedDate, updatedDate) values (?, 'season09b', 5300, 53, 53, ?, ?)", Player, Now, Now);
    Run("insert into objectives (accountId, objectiveId, progress, completedCount, createdDate, lastModifiedDate) values (?, 'OBJ', 3, 1, ?, ?)", Player, Now, Now);
    Run("insert into bounties (accountId, bountyId, slotIndex, updateVersion, data, updatedDate) values (?, 'Bounty_Gold_X', 0, 2, '{}', ?)", Player, Now);
    Run("insert into cooldowns (accountId, cooldownId, startedDate, updatedDate) values (?, 'bounty_tokens_season09b', ?, ?)", Player, Now, Now);
    Run("insert into friendships (userLow, userHigh, requesterId, status, createdAt, updatedAt) values ('UID-a-friend', ?, ?, 'ACCEPTED', 1, 2)", Player, Player);
    Run("insert into blocks (blockerId, blockedId, createdAt) values (?, 'UID-blocked', 3)", Player);
    Run("insert into guilds (guildId, name, nameKey, nameplate, nameplateKey, leaderId, createdAt, updatedAt) values ('g-mig', 'Guild', 'guild', 'GLD', 'gld', ?, 1, 2)", Player);
    Run("insert into guildmembers (accountId, guildId, rank, joinedAt, updatedAt) values (?, 'g-mig', 'Leader', 1, 2)", Player);
}

describe("migrations after the last release (0013_guilds)", () => {
    it("the journal lists the new migrations after 0013, each later than the one before", () => {
        assert.ok(ReleasedIndex > 0, "0013_guilds is in the journal");
        assert.ok(NewEntries.length >= 3, "0014_escalation, 0015_store_purchases and 0016_slayer_links");
        assert.deepEqual(NewEntries.slice(0, 3).map((Entry) => Entry.tag), ["0014_escalation", "0015_store_purchases", "0016_slayer_links"]);

        // The migrator skips a migration older than the last applied one without a word
        for(let Index = 1; Index < Journal.entries.length; Index++){
            assert.ok(Journal.entries[Index].when > Journal.entries[Index - 1].when, `${Journal.entries[Index].tag} is later than ${Journal.entries[Index - 1].tag}`);
        }
    });

    it("the new migration files only create tables and indexes", () => {
        for(const Entry of NewEntries){
            // SQLite CHECK constraints require a table rebuild; covered with seeded rows below.
            if (['0022_germany_region','0028_us_region'].includes(Entry.tag)) continue;
            const Sql = fs.readFileSync(path.join(MIGRATIONS, `${Entry.tag}.sql`), "utf8");

            // Explicit retention change: only legacy address observations may be deleted.
            if(Entry.tag === '0024_ephemeral_addresses'){
                assert.equal(Sql.trim(), 'DELETE FROM player_addresses;');
                continue;
            }
            assert.doesNotMatch(Sql, /\b(DROP|ALTER|RENAME|DELETE|UPDATE)\b/i, Entry.tag);
            assert.doesNotMatch(Sql, /INSERT\s+INTO[\s\S]*?SELECT/i, Entry.tag);
            for(const Statement of Sql.split("--> statement-breakpoint").map((Part) => Part.trim()).filter((Part) => Part.length > 0)){
                assert.match(Statement, /^CREATE (TABLE|INDEX|UNIQUE INDEX) /, `${Entry.tag}: ${Statement.slice(0, 60)}`);
            }
        }
    });

    it('US migration preserves EU, OCE and Germany preferences and enforces ownership', () => {
        const db = Open(path.join(Dir, 'us-regions.db'));
        try {
            db.$client.exec("CREATE TABLE users (userId text PRIMARY KEY); INSERT INTO users VALUES ('eu'), ('au'), ('de'), ('us'); PRAGMA foreign_keys=ON;");
            db.$client.exec(fs.readFileSync(path.join(MIGRATIONS,'0020_hunt_regions.sql'),'utf8'));
            db.$client.transaction(() => db.$client.exec(fs.readFileSync(path.join(MIGRATIONS,'0022_germany_region.sql'),'utf8')))();
            db.$client.exec("INSERT INTO huntregions VALUES ('eu','main'),('au','aus'),('de','ger');");
            const before = Rows(db,'huntregions');
            db.$client.transaction(() => db.$client.exec(fs.readFileSync(path.join(MIGRATIONS,'0028_us_region.sql'),'utf8')))();
            assert.deepEqual(Rows(db,'huntregions'), before);
            db.$client.prepare('INSERT INTO huntregions VALUES (?,?)').run('us','us');
            assert.throws(()=>db.$client.prepare('INSERT INTO huntregions VALUES (?,?)').run('missing','us'), /FOREIGN KEY/);
            assert.throws(()=>db.$client.prepare('UPDATE huntregions SET region=? WHERE userId=?').run('unknown','us'), /CHECK/);
            assert.deepEqual(db.$client.pragma('foreign_key_check'), []);
        } finally {db.$client.close();}
    });

    it('Germany migration preserves existing preferences and enforces supported regions', () => {
        const db = Open(path.join(Dir, 'regions.db'));
        try {
            db.$client.exec("CREATE TABLE users (userId text PRIMARY KEY); INSERT INTO users VALUES ('eu'), ('au'), ('de');");
            db.$client.exec(fs.readFileSync(path.join(MIGRATIONS,'0020_hunt_regions.sql'),'utf8'));
            db.$client.exec("INSERT INTO huntregions VALUES ('eu','main'),('au','aus'); PRAGMA foreign_keys=ON;");
            const before = Rows(db,'huntregions');
            db.$client.transaction(() => db.$client.exec(fs.readFileSync(path.join(MIGRATIONS,'0022_germany_region.sql'),'utf8')))();
            assert.deepEqual(Rows(db,'huntregions'), before);
            db.$client.prepare('INSERT INTO huntregions VALUES (?,?)').run('de','ger');
            assert.throws(()=>db.$client.prepare('UPDATE huntregions SET region=? WHERE userId=?').run('unknown','de'), /CHECK/);
            assert.deepEqual(db.$client.pragma('foreign_key_check'), []);
        } finally {db.$client.close();}
    });

    it("keeps every row of a released database, adds empty tables, and the previous build's migrator still runs", () => {
        const File = path.join(Dir, "released.db");
        const PreviousMigrations = PreviousBuildMigrations();

        // A database as the last release left it, full of players
        const Old = Open(File);
        migrate(Old, { migrationsFolder: PreviousMigrations });
        assert.equal((Old.$client.prepare("select count(*) n from __drizzle_migrations").get() as any).n, ReleasedIndex + 1, "at 0013");
        const OldTables = Tables(Old).filter((Name) => !Name.startsWith("__drizzle"));
        Seed(Old);
        for(const Name of OldTables){
            assert.ok(Rows(Old, Name).length >= 2, `${Name} holds rows before the update`);
        }
        const OldSchema = SchemaOf(Old, OldTables);
        const Before = Snapshot(Old, OldTables);
        Old.$client.close();

        // This build
        const Updated = Open(File);
        migrate(Updated, { migrationsFolder: MIGRATIONS });

        const NewTables = Tables(Updated).filter((Name) => !OldTables.includes(Name) && !Name.startsWith("__drizzle"));
        assert.ok(["escalationprogression", "escalationtalents", "escalationunlocks", "storepurchases", "slayerlinkinvites", "slayerlinks", "trialruns", "leaderboardprofiles"].every((Name) => NewTables.includes(Name)), NewTables.join(", "));
        assert.deepEqual(Snapshot(Updated, OldTables), Before, "every row of every released table is kept");
        // The social tables the Slayer Links read (0016) are among them; named here so a change to them stands out
        for(const Name of ["friendships", "blocks", "guilds", "guildmembers", "guildinvites"]){
            assert.ok(OldTables.includes(Name), Name);
            assert.equal(Snapshot(Updated, [Name])[Name], Before[Name], `${Name} is byte for byte the same`);
        }
        assert.deepEqual(SchemaOf(Updated, OldTables).filter((row:any)=>row.name !== "inventorytransactions_created_date"), OldSchema, "no released table, index or trigger changed");
        for(const Name of NewTables){
            assert.equal(Rows(Updated, Name).length, 0, `${Name} starts empty`);
        }
        assert.equal((Updated.$client.prepare("select count(*) n from __drizzle_migrations").get() as any).n, Journal.entries.length);

        const AfterFirst = Snapshot(Updated, Tables(Updated));

        // This build again: nothing to do
        migrate(Updated, { migrationsFolder: MIGRATIONS });
        assert.deepEqual(Snapshot(Updated, Tables(Updated)), AfterFirst);
        Updated.$client.close();

        // The previous build on the migrated database: no error, nothing applied, nothing changed
        const Previous = Open(File);
        migrate(Previous, { migrationsFolder: PreviousMigrations });
        assert.deepEqual(Snapshot(Previous, Tables(Previous)), AfterFirst);
        Previous.$client.close();
    });
});
