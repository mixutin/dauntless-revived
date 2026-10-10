import { RemoveTestDb } from "./setup";
import "./authenv";
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { GetDb } from "../src/db";
import { inventory } from "../src/db/schema";
import { RunInventoryTransaction } from "../src/controllers/inventory";
import { MakePlayer, StackQuantity } from "./helpers";

after(() => {
    RemoveTestDb(() => GetDb().$client.close());
});

beforeEach(() => {
    process.env.MIDDLEMAN_FUSION_GUARDS = "0";
});

function Fusion(SlotID: number, ExchangeID: string, EndTime: string, ResultCell: string){
    return {
        catalogId: "TOKEN_CELL_EXCHANGE",
        instanceId: "TOKEN_CELL_EXCHANGE",
        updateVersion: 0,
        itemData: JSON.stringify({SlotID, ExchangeID, EndTime, ResultCell})
    };
}

function ReadInventory(CharacterId: string){
    const Row = GetDb().select().from(inventory).where(eq(inventory.characterId, CharacterId)).get();

    return {
        instanced: JSON.parse(Row?.instancedItems ?? "[]") as any[],
        stacked: JSON.parse(Row?.stackedItems ?? "[]") as any[]
    };
}

async function Run(UserId: string, CharacterId: string, Id: string, Options: {
    addInstanced?: any[], addStacked?: any[], removeInstanced?: any[], removeStacked?: any[], saveInstanced?: any[]
} = {}){
    return RunInventoryTransaction(
        UserId,
        CharacterId,
        Id,
        Options.addInstanced ?? [],
        Options.addStacked ?? [],
        Options.removeInstanced ?? [],
        Options.removeStacked ?? [],
        Options.saveInstanced ?? [],
        {Caller: "gameserver"} // Native-authorized fusion result, not a player grant.
    );
}

describe("Middleman fusion persistence", () => {
    it("keeps three pending slots independent even when the client sends one generic instance id", async () => {
        const A = await MakePlayer();
        const Tokens = [
            Fusion(1, "fusion-1", "2099-01-01T00:00:00.000Z", "CELL_TEST_A_UC"),
            Fusion(2, "fusion-2", "2099-01-01T00:00:00.000Z", "CELL_TEST_B_UC"),
            Fusion(3, "fusion-3", "2099-01-01T00:00:00.000Z", "CELL_TEST_C_R")
        ];

        assert.equal((await Run(A.UserId, A.CharacterId, "middleman-three", {addInstanced: Tokens})).success, true);

        const Held = ReadInventory(A.CharacterId).instanced;
        assert.deepEqual(Held.map((Item) => Item.instanceId).sort(), [
            "TOKEN_CELL_EXCHANGE:1",
            "TOKEN_CELL_EXCHANGE:2",
            "TOKEN_CELL_EXCHANGE:3"
        ]);
        assert.deepEqual(Held.map((Item) => JSON.parse(Item.itemData).ExchangeID).sort(), ["fusion-1", "fusion-2", "fusion-3"]);
    });

    it("accepts a same-version speed-up only when it keeps the slot, exchange and result", async () => {
        const A = await MakePlayer();
        const Original = Fusion(1, "fusion-speed", "2099-01-01T00:00:00.000Z", "CELL_TEST_A_R");

        assert.equal((await Run(A.UserId, A.CharacterId, "middleman-start", {addInstanced: [Original]})).success, true);

        const SpedUp = Fusion(1, "fusion-speed", "2020-01-01T00:00:00.000Z", "CELL_TEST_A_R");
        const Speed = await Run(A.UserId, A.CharacterId, "middleman-speed", {saveInstanced: [SpedUp]});
        assert.equal(Speed.success, true);
        assert.equal(JSON.parse(ReadInventory(A.CharacterId).instanced[0].itemData).EndTime, "2020-01-01T00:00:00.000Z");

        const ChangedReward = Fusion(1, "fusion-speed", "2019-01-01T00:00:00.000Z", "CELL_TEST_WRONG_R");
        const Changed = await Run(A.UserId, A.CharacterId, "middleman-change-result", {saveInstanced: [ChangedReward]});
        assert.deepEqual(Changed, {success: false, error: "conflict"});
        assert.equal(JSON.parse(ReadInventory(A.CharacterId).instanced[0].itemData).ResultCell, "CELL_TEST_A_R");
    });

    it("persists cell dusting as one inventory transaction", async () => {
        const A = await MakePlayer();

        await Run(A.UserId, A.CharacterId, "middleman-dust-seed", {
            addStacked: [{catalogId: "CELL_TEST_DUST_R", quantity: 2}]
        });

        const Dusted = await Run(A.UserId, A.CharacterId, "middleman-dust", {
            removeStacked: [{catalogId: "CELL_TEST_DUST_R", quantity: 1}],
            addStacked: [{catalogId: "CURRENCY_CELLDUST", quantity: 80}]
        });

        assert.equal(Dusted.success, true);
        assert.equal(StackQuantity(A.CharacterId, "CELL_TEST_DUST_R"), 1);
        assert.equal(StackQuantity(A.CharacterId, "CURRENCY_CELLDUST"), 80);

        const Retry = await Run(A.UserId, A.CharacterId, "middleman-dust", {
            removeStacked: [{catalogId: "CELL_TEST_DUST_R", quantity: 1}],
            addStacked: [{catalogId: "CURRENCY_CELLDUST", quantity: 80}]
        });

        assert.ok(Retry.success && Retry.data!.replayed);
        assert.equal(StackQuantity(A.CharacterId, "CELL_TEST_DUST_R"), 1);
        assert.equal(StackQuantity(A.CharacterId, "CURRENCY_CELLDUST"), 80);
    });

    it("persists an Ace Chip speed-up with the fusion timer change atomically", async () => {
        const A = await MakePlayer();
        const Original = Fusion(2, "fusion-chip", "2099-01-01T00:00:00.000Z", "CELL_TEST_SPEED_R");

        await Run(A.UserId, A.CharacterId, "middleman-chip-seed", {
            addInstanced: [Original],
            addStacked: [{catalogId: "CURRENCY_TOKEN_EXCHANGE_SPEED_UP", quantity: 5}]
        });

        const SpedUp = Fusion(2, "fusion-chip", "2020-01-01T00:00:00.000Z", "CELL_TEST_SPEED_R");
        const Speed = await Run(A.UserId, A.CharacterId, "middleman-chip-speed", {
            saveInstanced: [SpedUp],
            removeStacked: [{catalogId: "CURRENCY_TOKEN_EXCHANGE_SPEED_UP", quantity: 2}]
        });

        assert.equal(Speed.success, true);
        assert.equal(StackQuantity(A.CharacterId, "CURRENCY_TOKEN_EXCHANGE_SPEED_UP"), 3);
        assert.equal(JSON.parse(ReadInventory(A.CharacterId).instanced[0].itemData).EndTime, "2020-01-01T00:00:00.000Z");
    });

    it("allows the completed version-zero fusion token to be removed", async () => {
        const A = await MakePlayer();
        const Token = Fusion(1, "fusion-remove", "2020-01-01T00:00:00.000Z", "CELL_TEST_A_UC");

        await Run(A.UserId, A.CharacterId, "middleman-remove-start", {addInstanced: [Token]});
        const Removed = await Run(A.UserId, A.CharacterId, "middleman-remove", {removeInstanced: [Token]});

        assert.equal(Removed.success, true);
        assert.deepEqual(ReadInventory(A.CharacterId).instanced, []);
    });

    it("lets a finished fusion be claimed after a speed-up even if the client sends its older token", async () => {
        const A = await MakePlayer();
        const Token = Fusion(1, "fusion-claim", "2099-01-01T00:00:00.000Z", "CELL_TEST_CLAIM_R");

        await Run(A.UserId, A.CharacterId, "middleman-claim-start", {addInstanced: [Token]});
        const SpedUp = {...Fusion(1, "fusion-claim", "2020-01-01T00:00:00.000Z", "CELL_TEST_CLAIM_R"), updateVersion: 1};
        assert.equal((await Run(A.UserId, A.CharacterId, "middleman-claim-speed", {saveInstanced: [SpedUp]})).success, true);

        const Claimed = await Run(A.UserId, A.CharacterId, "middleman-claim", {
            removeInstanced: [Fusion(1, "fusion-claim", "2099-01-01T00:00:00.000Z", "CELL_TEST_CLAIM_R")],
            addStacked: [{catalogId: "CELL_TEST_CLAIM_R", quantity: 1}]
        });

        assert.equal(Claimed.success, true);
        assert.deepEqual(ReadInventory(A.CharacterId).instanced, []);
        assert.equal(StackQuantity(A.CharacterId, "CELL_TEST_CLAIM_R"), 1);
    });

    it("lets a fusion be claimed when the removal's itemData is not the shape we expect", async () => {
        const A = await MakePlayer();
        const Token = Fusion(2, "fusion-odd", "2020-01-01T00:00:00.000Z", "CELL_TEST_ODD_R");

        await Run(A.UserId, A.CharacterId, "middleman-odd-start", {addInstanced: [Token]});
        const Claimed = await Run(A.UserId, A.CharacterId, "middleman-odd-claim", {
            removeInstanced: [{catalogId: "TOKEN_CELL_EXCHANGE", instanceId: "TOKEN_CELL_EXCHANGE:2", updateVersion: 0, itemData: "{\"Slot\":2}"}],
            addStacked: [{catalogId: "CELL_TEST_ODD_R", quantity: 1}]
        });

        assert.equal(Claimed.success, true);
        assert.deepEqual(ReadInventory(A.CharacterId).instanced, []);
        assert.equal(StackQuantity(A.CharacterId, "CELL_TEST_ODD_R"), 1);
    });

    it("with strict guards, refuses early or wrong reveals and makes a completed reveal idempotent", async () => {
        const A = await MakePlayer();
        process.env.MIDDLEMAN_FUSION_GUARDS = "1";

        const Future = Fusion(1, "fusion-guard", "2099-01-01T00:00:00.000Z", "CELL_TEST_RESULT_R");
        await Run(A.UserId, A.CharacterId, "middleman-guard-start", {addInstanced: [Future]});

        const Early = await Run(A.UserId, A.CharacterId, "middleman-guard-early", {
            removeInstanced: [Future],
            addStacked: [{catalogId: "CELL_TEST_RESULT_R", quantity: 1}]
        });
        assert.deepEqual(Early, {success: false, error: "conflict"});
        assert.equal(ReadInventory(A.CharacterId).instanced.length, 1);
        assert.equal(StackQuantity(A.CharacterId, "CELL_TEST_RESULT_R"), 0);

        const Ready = Fusion(1, "fusion-guard", "2020-01-01T00:00:00.000Z", "CELL_TEST_RESULT_R");
        assert.equal((await Run(A.UserId, A.CharacterId, "middleman-guard-speed", {saveInstanced: [Ready]})).success, true);

        const Wrong = await Run(A.UserId, A.CharacterId, "middleman-guard-wrong", {
            removeInstanced: [Ready],
            addStacked: [{catalogId: "CELL_TEST_WRONG_R", quantity: 1}]
        });
        assert.deepEqual(Wrong, {success: false, error: "conflict"});
        assert.equal(ReadInventory(A.CharacterId).instanced.length, 1);
        assert.equal(StackQuantity(A.CharacterId, "CELL_TEST_WRONG_R"), 0);

        const First = await Run(A.UserId, A.CharacterId, "middleman-guard-reveal", {
            removeInstanced: [Ready],
            addStacked: [{catalogId: "CELL_TEST_RESULT_R", quantity: 1}]
        });
        const Retry = await Run(A.UserId, A.CharacterId, "middleman-guard-reveal", {
            removeInstanced: [Ready],
            addStacked: [{catalogId: "CELL_TEST_RESULT_R", quantity: 1}]
        });
        const NewIdRetry = await Run(A.UserId, A.CharacterId, "middleman-guard-reveal-again", {
            removeInstanced: [Ready],
            addStacked: [{catalogId: "CELL_TEST_RESULT_R", quantity: 1}]
        });

        assert.ok(First.success && !First.data!.replayed);
        assert.ok(Retry.success && Retry.data!.replayed);
        assert.deepEqual(NewIdRetry, {success: false, error: "conflict"});
        assert.equal(StackQuantity(A.CharacterId, "CELL_TEST_RESULT_R"), 1);
        assert.deepEqual(ReadInventory(A.CharacterId).instanced, []);
    });

    it("rejects malformed fusion metadata without corrupting the inventory", async () => {
        const A = await MakePlayer();
        const Bad = {
            catalogId: "TOKEN_CELL_EXCHANGE",
            instanceId: "TOKEN_CELL_EXCHANGE",
            updateVersion: 0,
            itemData: JSON.stringify({SlotID: 99, EndTime: "never", ResultCell: "NOT_A_CELL", ExchangeID: ""})
        };

        assert.deepEqual(await Run(A.UserId, A.CharacterId, "middleman-bad", {addInstanced: [Bad]}), {success: false, error: "invalid_inventory_item"});
        assert.deepEqual(ReadInventory(A.CharacterId).instanced, []);
    });
});
