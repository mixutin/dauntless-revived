import { RemoveTestDb } from "./setup";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { GetDb } from "../src/db";
import { characters, inventory, users } from "../src/db/schema";
import { CheckGrantItems, GrantError, GrantItemsInTx } from "../src/controllers/admingrant";
import { GrantableCatalogEntries } from "../src/controllers/freestore";
import { CreateCharacterForUid } from "../src/controllers/character";
import { MakePlayer, ReadStacks, StackQuantity } from "./helpers";

after(() => RemoveTestDb(() => GetDb().$client.close()));

const Grant = (UserId: string, Items: {catalogId: string, quantity: number}[], Reference: string, Actor = "UID-owner") =>
    GetDb().transaction((tx) => GrantItemsInTx(tx as never, UserId, CheckGrantItems(Items), Actor, Reference), {behavior: "immediate"});

const Instances = (CharacterId: string): any[] => {
    const Row = GetDb().select().from(inventory).where(eq(inventory.characterId, CharacterId)).get();

    return Row == undefined ? [] : JSON.parse(Row.instancedItems);
};

const Ledger = (UserId: string) =>
    GetDb().$client.prepare("select catalogId, quantityChange, caller, source from inventorylog where userId=? order by catalogId").all(UserId);

describe("admin item grants", () => {
    it("rejects anything that is not a list of catalog ids and whole quantities", () => {
        const Bad: unknown[] = [
            undefined, null, "ORB_FLAME", {}, [],
            [{catalogId: "ORB_FLAME"}],
            [{catalogId: "ORB_FLAME", quantity: 0}],
            [{catalogId: "ORB_FLAME", quantity: -5}],
            [{catalogId: "ORB_FLAME", quantity: 1.5}],
            [{catalogId: "ORB_FLAME", quantity: "50"}],
            [{catalogId: "ORB_FLAME", quantity: 1_000_001}],
            [{catalogId: "ORB FLAME", quantity: 1}],
            [{catalogId: "ORB-FLAME", quantity: 1}],
            [{catalogId: "", quantity: 1}],
            [{catalogId: "O".repeat(129), quantity: 1}],
            [{catalogId: 7, quantity: 1}],
            Array.from({length: 65}, () => ({catalogId: "ORB_FLAME", quantity: 1}))
        ];

        for(const Items of Bad){
            assert.throws(() => CheckGrantItems(Items), (Error: unknown) => Error instanceof GrantError && Error.Status === 400, JSON.stringify(Items));
        }

        assert.deepEqual(CheckGrantItems([{catalogId: "ORB_FLAME", quantity: 50, extra: "ignored"}]), [{catalogId: "ORB_FLAME", quantity: 50}]);
    });

    it("grants stacked items to the active character and records every one as an admin action", async () => {
        const A = await MakePlayer();
        const Result = Grant(A.UserId, [{catalogId: "ORB_FLAME", quantity: 50}, {catalogId: "CURRENCY_NOTES", quantity: 1000}], "ticket-1", "UID-owner");

        assert.equal(Result.characterId, A.CharacterId);
        assert.equal(Result.replayed, false);
        assert.deepEqual([Result.stacked, Result.instanced], [2, 0]);
        assert.equal(StackQuantity(A.CharacterId, "ORB_FLAME"), 50);
        assert.equal(StackQuantity(A.CharacterId, "CURRENCY_NOTES"), 1000);
        assert.deepEqual(Ledger(A.UserId), [
            {catalogId: "CURRENCY_NOTES", quantityChange: 1000, caller: "admin", source: "admin:UID-owner"},
            {catalogId: "ORB_FLAME", quantityChange: 50, caller: "admin", source: "admin:UID-owner"}
        ]);
    });

    it("the same reference cannot grant twice, and a new one grants again", async () => {
        const A = await MakePlayer();
        const Items = [{catalogId: "ORB_FROST", quantity: 10}];

        assert.equal(Grant(A.UserId, Items, "ticket-2").replayed, false);
        assert.equal(Grant(A.UserId, Items, "ticket-2").replayed, true, "a retried request is answered, not re-granted");
        assert.equal(StackQuantity(A.CharacterId, "ORB_FROST"), 10);

        Grant(A.UserId, Items, "ticket-3");
        assert.equal(StackQuantity(A.CharacterId, "ORB_FROST"), 20);
    });

    it("the same reference on a different account is a different grant", async () => {
        const A = await MakePlayer(), B = await MakePlayer();

        Grant(A.UserId, [{catalogId: "ORB_SHOCK", quantity: 3}], "same-ref");
        Grant(B.UserId, [{catalogId: "ORB_SHOCK", quantity: 3}], "same-ref");

        assert.equal(StackQuantity(A.CharacterId, "ORB_SHOCK"), 3);
        assert.equal(StackQuantity(B.CharacterId, "ORB_SHOCK"), 3);
    });

    it("delivers a cosmetic the way its catalogue entry says, one instance per unit", async () => {
        const A = await MakePlayer();
        const Result = Grant(A.UserId, [{catalogId: "BNC_FABRIC_000", quantity: 2}], "cosmetic-1");

        assert.deepEqual([Result.stacked, Result.instanced], [0, 2]);
        const Held = Instances(A.CharacterId).filter((Item) => Item.catalogId === "BNC_FABRIC_000");
        assert.equal(Held.length, 2);
        assert.equal(new Set(Held.map((Item) => Item.instanceId)).size, 2, "each unit is its own instance");
        assert.equal(StackQuantity(A.CharacterId, "BNC_FABRIC_000"), 0, "an instanced cosmetic is never written as a stack");

        // A stacked cosmetic still goes in as a stack.
        Grant(A.UserId, [{catalogId: "AR_HP07A_MONK_HELM", quantity: 1}], "cosmetic-2");
        assert.equal(StackQuantity(A.CharacterId, "AR_HP07A_MONK_HELM"), 1);
    });

    it("a retried cosmetic grant does not duplicate the instances", async () => {
        const A = await MakePlayer();

        Grant(A.UserId, [{catalogId: "BNC_FABRIC_002", quantity: 3}], "cosmetic-retry");
        Grant(A.UserId, [{catalogId: "BNC_FABRIC_002", quantity: 3}], "cosmetic-retry");

        assert.equal(Instances(A.CharacterId).filter((Item) => Item.catalogId === "BNC_FABRIC_002").length, 3);
    });

    it("refuses an id this build does not have, rather than writing an unusable row", async () => {
        const A = await MakePlayer();

        // Valid shape, real prefixes, not in this build: a misspelling, a later-version item, an
        // invention, and an arcstone (which is from a later version of Dauntless entirely).
        for(const CatalogId of ["AR_NOT_A_REAL_SET_CHEST", "WP_FROM_A_LATER_PATCH", "EM_INVENTED", "ORB_UMBRAL", "ARCSTONE_DULL", "COMPLETELY_MADE_UP"]){
            assert.throws(() => Grant(A.UserId, [{catalogId: CatalogId, quantity: 1}], `bad-${CatalogId}`),
                (Error: unknown) => Error instanceof GrantError && Error.Status === 400, CatalogId);
        }

        assert.deepEqual(ReadStacks(A.CharacterId), []);
        assert.deepEqual(Instances(A.CharacterId), []);
    });

    it("grants to the account's active character, not the first one it made", async () => {
        const A = await MakePlayer();
        const Second = await CreateCharacterForUid(A.UserId, "Active");
        GetDb().update(characters).set({updateVersion: 500}).where(eq(characters.characterId, Second.id)).run();

        Grant(A.UserId, [{catalogId: "ORB_TERRA", quantity: 7}], "active-only");

        assert.equal(StackQuantity(Second.id, "ORB_TERRA"), 7);
        assert.equal(StackQuantity(A.CharacterId, "ORB_TERRA"), 0);
    });

    it("an account with no character is refused and nothing is written", () => {
        const UserId = `UID-grant-no-character-${process.pid}`;
        GetDb().insert(users).values({userId: UserId, name: "GrantNoCharacter", notes: 0}).run();

        assert.throws(() => Grant(UserId, [{catalogId: "ORB_FLAME", quantity: 1}], "no-character"),
            (Error: unknown) => Error instanceof GrantError && Error.Status === 409);
        assert.deepEqual(Ledger(UserId), []);
    });

    it("will not push a stack past what the client can hold", async () => {
        const A = await MakePlayer();
        GetDb().insert(inventory).values({characterId: A.CharacterId, stackedItems: JSON.stringify([{catalogId: "CURRENCY_NOTES", quantity: 2147483000}]), instancedItems: "[]"}).run();

        assert.throws(() => Grant(A.UserId, [{catalogId: "CURRENCY_NOTES", quantity: 1000}], "overflow"),
            (Error: unknown) => Error instanceof GrantError && Error.Status === 409);
        assert.equal(StackQuantity(A.CharacterId, "CURRENCY_NOTES"), 2147483000, "the balance is untouched");

        // Up to the ceiling is still allowed.
        Grant(A.UserId, [{catalogId: "CURRENCY_NOTES", quantity: 647}], "to-the-ceiling");
        assert.equal(StackQuantity(A.CharacterId, "CURRENCY_NOTES"), 2147483647);
    });

    it("refuses an inventory it cannot read instead of overwriting it", async () => {
        const A = await MakePlayer();
        GetDb().insert(inventory).values({characterId: A.CharacterId, stackedItems: "{", instancedItems: "[]"}).run();

        assert.throws(() => Grant(A.UserId, [{catalogId: "ORB_FLAME", quantity: 1}], "unreadable"),
            (Error: unknown) => Error instanceof GrantError && Error.Status === 409);
    });
});

describe("the grantable catalogue", () => {
    it("covers the whole build, not just what the shop sells, sorted and without notes", () => {
        const Entries = GrantableCatalogEntries();
        const Ids = Entries.map((Entry) => Entry.catalogId);

        // The store catalogues know about 250 ids. Everything else a player holds - break parts,
        // potions, titles, cells, most cosmetics - never passes through the shop.
        assert.ok(Entries.length > 3000, `only ${Entries.length} entries; the shop alone is about 250`);
        assert.deepEqual(Ids, [...Ids].sort((Left, Right) => Left < Right ? -1 : 1), "sorted");
        assert.equal(new Set(Ids).size, Ids.length, "no duplicates");
        assert.ok(!Ids.some((Id) => Id.startsWith("_")), "the json notes are not items");

        for(const Entry of Entries){
            assert.ok(Entry.kind === "stacked" || Entry.kind === "instanced", `${Entry.catalogId}: ${Entry.kind}`);
            assert.ok(["currency", "material", "cell", "cosmetic", "consumable", "title", "other"].includes(Entry.group), `${Entry.catalogId}: ${Entry.group}`);
        }

        // Every group an owner picks from has real contents.
        for(const Group of ["currency", "material", "cell", "cosmetic", "consumable", "title"]){
            assert.ok(Entries.filter((Entry) => Entry.group === Group).length > 0, Group);
        }

        // One of each kind of thing, including the categories the shop never sells.
        for(const Id of [
            "CURRENCY_NOTES", "CURRENCY_PLATINUM_UNIV", "CURRENCY_TOKEN_TRANSMOG",
            "ORB_FLAME", "ORB_TERRA", "GEM_ALPHA", "GEM_HEROICPLUS",
            "BREAK_ARMSTRONG_EPIC", "PART_AC_LEGENDARY_BLAZE", "GATHER_COMMON_01",
            "CELL_AETHERVENT_E", "TITLE_1P_ARCSLAYER", "QI_ATTACK_SPEED_POTION",
            "TOKEN_BOUNTY_DRAFT", "BNC_FABRIC_000", "CC_FACEHAIR_BRAIDEDBEARD"
        ]){
            assert.ok(Ids.includes(Id), Id);
        }

        // A prefix rule would get these wrong: both kinds live under the same prefix.
        const Kind = (Id: string) => Entries.find((Entry) => Entry.catalogId === Id)?.kind;
        assert.equal(Kind("BREAK_ARMSTRONG_EPIC"), "stacked");
        assert.equal(Kind("PART_AC_LEGENDARY_BLAZE"), "instanced");

        // 1.4.4 has no arcstones and no umbral or radiant orb: later versions added them. Five
        // orbs is the whole set, not a shortlist.
        assert.equal(Ids.filter((Id) => Id.startsWith("ORB_")).length, 5, "1.4.4 has exactly five orbs");
        for(const Id of Ids){
            assert.ok(!/ARCSTONE|ORB_UMBRAL|ORB_RADIANT/.test(Id), `${Id} is not in this build`);
        }
    });

    it("every id it offers is one a grant will accept", async () => {
        const A = await MakePlayer();
        const Entries = GrantableCatalogEntries();

        // In batches of the grant's own limit: 3,000 separate transactions would dominate the run.
        for(let Start = 0; Start < Entries.length; Start += 64){
            const Batch = Entries.slice(Start, Start + 64);
            const Result = Grant(A.UserId, Batch.map((Entry) => ({catalogId: Entry.catalogId, quantity: 1})), `catalogue-${Start}`);

            assert.equal(Result.stacked, Batch.filter((Entry) => Entry.kind === "stacked").length, `batch at ${Start}: stacked`);
            assert.equal(Result.instanced, Batch.filter((Entry) => Entry.kind === "instanced").length, `batch at ${Start}: instanced`);
        }

        // Spot-check that the items really landed, each in the right form.
        assert.equal(StackQuantity(A.CharacterId, "BREAK_ARMSTRONG_EPIC"), 1);
        assert.equal(Instances(A.CharacterId).filter((Item) => Item.catalogId === "PART_AC_LEGENDARY_BLAZE").length, 1);
    });
});
