import { RemoveTestDb } from "./setup";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { GetDb } from "../src/db";
import { ApplyStackedChanges, GetTransactionDedupeKey, HashTransactionRequest, InventoryInsufficientError, IsOverspendRefused, ParseStackQuantity, RunInventoryTransaction, SetDailyTokensOnce } from "../src/controllers/inventory";
import { Count, MakePlayer, ReadStacks, StackQuantity } from "./helpers";

after(() => RemoveTestDb(() => GetDb().$client.close()));

const Guid = () => crypto.randomUUID().replace(/-/g, "").toUpperCase();
const Stack = (catalogId: string, quantity: any) => ({catalogId, quantity});
const Gs = {Caller: "gameserver" as const, Source: "UnitTest"};

function Grant(UserId: string, CharacterId: string, TransactionId: string, StackedToAdd: any[] = [], StackedToRemove: any[] = [], InstancedToAdd?: any[]){
    return RunInventoryTransaction(UserId, CharacterId, TransactionId, InstancedToAdd, StackedToAdd, undefined, StackedToRemove, undefined, Gs);
}

describe("ParseStackQuantity", () => {
    it("accepts whole numbers and numeric strings", () => {
        assert.equal(ParseStackQuantity(Stack("A", 5), "add"), 5);
        assert.equal(ParseStackQuantity(Stack("A", 0), "add"), 0);
        assert.equal(ParseStackQuantity(Stack("A", "12"), "add"), 12);
    });

    it("refuses negative, fractional, non-numeric quantities and a missing catalogId", () => {
        for(const Bad of [-1, 1.5, "abc", "-3", null, undefined, NaN, Infinity]){
            assert.throws(() => ParseStackQuantity(Stack("A", Bad), "remove"), /quantity/);
        }

        assert.throws(() => ParseStackQuantity({quantity: 1}, "add"), /catalogId/);
    });
});

describe("ApplyStackedChanges", () => {
    it("refuses removing 5 of an item held 3 times and changes nothing", () => {
        const Stacks = [Stack("ORB", 3)];

        assert.throws(() => ApplyStackedChanges(Stacks, [Stack("ORB", 5)], [Stack("NOTES", 10)], true), InventoryInsufficientError);
        assert.deepEqual(Stacks, [Stack("ORB", 3)]);
    });

    it("reports a pure spend (an upgrade) so the game server's cached counts go down", () => {
        const Stacks = [Stack("NOTES", 1060), Stack("ORB", 7)];
        const Result = ApplyStackedChanges(Stacks, [Stack("NOTES", 40), Stack("ORB", 7)], [], false);

        assert.deepEqual(Stacks, [Stack("NOTES", 1020)]);
        assert.deepEqual(Result.Touched, [Stack("NOTES", 1020), Stack("ORB", 0)]);
    });

    it("with INVENTORY_REPORT_REMOVALS=0 reports only additions, as upstream did", () => {
        process.env.INVENTORY_REPORT_REMOVALS = "0";
        try{
            const Result = ApplyStackedChanges([Stack("NOTES", 1060), Stack("ORB", 7)], [Stack("NOTES", 40), Stack("ORB", 7)], [Stack("NEW", 1)], false);
            assert.deepEqual(Result.Touched, [Stack("NEW", 1)]);
        }
        finally{
            delete process.env.INVENTORY_REPORT_REMOVALS;
        }
    });

    it("lets a transaction spend what it grants: 0 held, add 5, remove 2 leaves 3", () => {
        const Stacks: any[] = [];
        const Result = ApplyStackedChanges(Stacks, [Stack("ORB", 2)], [Stack("ORB", 5)], true);

        assert.deepEqual(Stacks, [Stack("ORB", 3)]);
        assert.deepEqual(Result.Touched, [Stack("ORB", 3)]);
        assert.deepEqual(Result.Overspent, []);
        assert.deepEqual(Result.Log.map((Entry) => [Entry.operation, Entry.catalogId, Entry.quantityChange, Entry.quantityAfter]), [
            ["add", "ORB", 5, 5],
            ["remove", "ORB", -2, 3]
        ]);
    });

    it("takes what the stack holds first and the rest from the same transaction's grant", () => {
        const Stacks = [Stack("ORB", 1)];
        ApplyStackedChanges(Stacks, [Stack("ORB", 2)], [Stack("ORB", 3)], true);

        assert.deepEqual(Stacks, [Stack("ORB", 2)]);
        assert.throws(() => ApplyStackedChanges([Stack("ORB", 1)], [Stack("ORB", 5)], [Stack("ORB", 3)], true), /removes 5 of ORB but only 1 held and 3 added/);
    });

    it("counts a grant only for its own item", () => {
        assert.throws(() => ApplyStackedChanges([Stack("ORB", 1)], [Stack("ORB", 2)], [Stack("NOTES", 3)], true), /removes 2 of ORB but only 1 held$/);
    });

    it("without the refusal, clamps an overspend as before, applies the rest and reports it", () => {
        const Stacks = [Stack("ORB", 1)];
        const Result = ApplyStackedChanges(Stacks, [Stack("ORB", 2)], [Stack("NOTES", 3)], false);

        assert.deepEqual(Stacks, [Stack("NOTES", 3)]);
        assert.deepEqual(Result.Overspent, ["removes 2 of ORB but only 1 held"]);
    });

    it("adds up several removals of the same item before comparing", () => {
        const Stacks = [Stack("ORB", 5)];

        assert.throws(() => ApplyStackedChanges(Stacks, [Stack("ORB", 3), Stack("ORB", 3)], [], true), /removes 6 of ORB but only 5 held/);
    });

    it("refuses removing an item that is not held at all", () => {
        assert.throws(() => ApplyStackedChanges([], [Stack("ORB", 1)], [], true), /only 0 held/);
    });

    it("removes the stack at exactly 0, merges additions, reports every touched stack with its final count", () => {
        const Stacks = [Stack("ORB", 3), Stack("NOTES", 10)];
        const Result = ApplyStackedChanges(Stacks, [Stack("ORB", 3), Stack("NOTES", 4)], [Stack("NOTES", 1), Stack("NEW", 2)], true);

        assert.deepEqual(Stacks, [Stack("NOTES", 7), Stack("NEW", 2)]);
        assert.deepEqual(Result.Touched, [Stack("NOTES", 7), Stack("NEW", 2), Stack("ORB", 0)]);
        assert.deepEqual(Result.Log.map((Entry) => [Entry.operation, Entry.catalogId, Entry.quantityChange, Entry.quantityAfter]), [
            ["remove", "ORB", -3, 0],
            ["remove", "NOTES", -4, 6],
            ["add", "NOTES", 1, 7],
            ["add", "NEW", 2, 2]
        ]);
    });

    it("with the refusal switched off, keeps the old clamp-and-delete behaviour", () => {
        const Stacks = [Stack("ORB", 3)];
        const Result = ApplyStackedChanges(Stacks, [Stack("ORB", 5), Stack("MISSING", 1)], [], false);

        assert.deepEqual(Stacks, []);
        assert.equal(Result.Overspent.length, 2);
    });

    it("refuses only with INVENTORY_REFUSE_OVERSPEND=1", () => {
        const Old = process.env.INVENTORY_REFUSE_OVERSPEND;

        try{
            delete process.env.INVENTORY_REFUSE_OVERSPEND;
            assert.equal(IsOverspendRefused(), false);
            process.env.INVENTORY_REFUSE_OVERSPEND = "0";
            assert.equal(IsOverspendRefused(), false);
            process.env.INVENTORY_REFUSE_OVERSPEND = "1";
            assert.equal(IsOverspendRefused(), true);
        }
        finally{
            if(Old === undefined){
                delete process.env.INVENTORY_REFUSE_OVERSPEND;
            }
            else{
                process.env.INVENTORY_REFUSE_OVERSPEND = Old;
            }
        }
    });

    it("stores a numeric string quantity as a number instead of concatenating", () => {
        const Stacks = [Stack("ORB", 3)];
        ApplyStackedChanges(Stacks, [], [Stack("ORB", "2"), Stack("NEW", "4")], true);

        assert.deepEqual(Stacks, [Stack("ORB", 5), Stack("NEW", 4)]);
    });
});

describe("retry detection keys", () => {
    it("uses a GUID transactionId and ignores empty or all-zero ids", () => {
        assert.equal(GetTransactionDedupeKey("BC9A30844B16C925F10C588601BBDC67"), "BC9A30844B16C925F10C588601BBDC67");

        for(const Bad of ["", "00000000000000000000000000000000", "00000000-0000-0000-0000-000000000000", undefined, null, 5]){
            assert.equal(GetTransactionDedupeKey(Bad), undefined);
        }
    });

    it("hashes the same request the same way and a different one differently", () => {
        const A = HashTransactionRequest("c", [], [Stack("A", 1)], [], [], []);

        assert.equal(A, HashTransactionRequest("c", [], [Stack("A", 1)], [], [], []));
        assert.notEqual(A, HashTransactionRequest("c", [], [Stack("A", 2)], [], [], []));
        assert.notEqual(A, HashTransactionRequest("d", [], [Stack("A", 1)], [], [], []));
    });
});

describe("RunInventoryTransaction", () => {
    it("runs the same transaction twice but changes the inventory once, answering the same both times", async () => {
        const {UserId, CharacterId} = await MakePlayer();
        const Id = Guid();

        const First = await Grant(UserId, CharacterId, Id, [Stack("BREAK_HIDE", 3)]);
        const Second = await Grant(UserId, CharacterId, Id, [Stack("BREAK_HIDE", 3)]);

        assert.ok(First.success && Second.success);
        assert.equal(First.data!.replayed, false);
        assert.equal(Second.data!.replayed, true);
        assert.equal(JSON.stringify(Second.data!.response), JSON.stringify(First.data!.response));
        assert.equal(StackQuantity(CharacterId, "BREAK_HIDE"), 3);
        assert.equal(Count("inventorytransactions", "characterId = ?", CharacterId), 1);
        assert.equal(Count("inventorylog", "characterId = ?", CharacterId), 1);
    });

    it("applies concurrent copies of one transaction once", async () => {
        const {UserId, CharacterId} = await MakePlayer();
        const Id = Guid();

        const Results = await Promise.all(Array.from({length: 5}, () => Grant(UserId, CharacterId, Id, [Stack("ORB", 2)])));

        assert.ok(Results.every((Result) => Result.success));
        assert.equal(Results.filter((Result) => Result.success && !Result.data!.replayed).length, 1);
        assert.equal(StackQuantity(CharacterId, "ORB"), 2);
    });

    it("runs a reused id with a different body as a new transaction", async () => {
        const {UserId, CharacterId} = await MakePlayer();
        const Id = Guid();

        await Grant(UserId, CharacterId, Id, [Stack("ORB", 2)]);
        const Other = await Grant(UserId, CharacterId, Id, [Stack("ORB", 5)]);

        assert.ok(Other.success && !Other.data!.replayed);
        assert.equal(StackQuantity(CharacterId, "ORB"), 7);
    });

    it("does not deduplicate transactions without a usable id", async () => {
        const {UserId, CharacterId} = await MakePlayer();

        await Grant(UserId, CharacterId, "00000000000000000000000000000000", [Stack("ORB", 1)]);
        await Grant(UserId, CharacterId, "00000000000000000000000000000000", [Stack("ORB", 1)]);

        assert.equal(StackQuantity(CharacterId, "ORB"), 2);
        assert.equal(Count("inventorytransactions", "characterId = ?", CharacterId), 0);
    });

    it("with INVENTORY_REFUSE_OVERSPEND=1, refuses an overspend as a whole: the grant in the same transaction is not applied either", async () => {
        const {UserId, CharacterId} = await MakePlayer();
        await Grant(UserId, CharacterId, Guid(), [Stack("ORB", 3)]);
        const LogBefore = Count("inventorylog", "characterId = ?", CharacterId);
        const Id = Guid();

        const Craft = () => RunInventoryTransaction(UserId, CharacterId, Id,
            [{catalogId: "WP_AXE", instanceId: "i-1", updateVersion: 0}], [Stack("NOTES", 100)], undefined, [Stack("ORB", 5)], undefined, Gs);

        process.env.INVENTORY_REFUSE_OVERSPEND = "1";

        try{
            const Result = await Craft();

            assert.deepEqual(Result, {success: false, error: "insufficient_quantity"});
            assert.deepEqual(ReadStacks(CharacterId), [Stack("ORB", 3)]);
            assert.equal(Count("inventorylog", "characterId = ?", CharacterId), LogBefore);
            assert.equal(Count("inventorytransactions", "transactionId = ?", Id), 0);

            // A grant spent in the same transaction is not an overspend
            const Spend = await Grant(UserId, CharacterId, Guid(), [Stack("TOKEN", 5)], [Stack("TOKEN", 2)]);
            assert.ok(Spend.success);
            assert.equal(StackQuantity(CharacterId, "TOKEN"), 3);

            // Refusals are not stored, so the same request succeeds once the player holds enough
            await Grant(UserId, CharacterId, Guid(), [Stack("ORB", 2)]);
            const Retry = await Craft();
            assert.ok(Retry.success && !Retry.data!.replayed);
            assert.deepEqual(ReadStacks(CharacterId), [Stack("TOKEN", 3), Stack("NOTES", 100)]);
        }
        finally{
            delete process.env.INVENTORY_REFUSE_OVERSPEND;
        }
    });

    it("by default runs an overspending transaction the old way: the removal is clamped, the rest applied", async () => {
        const {UserId, CharacterId} = await MakePlayer();
        await Grant(UserId, CharacterId, Guid(), [Stack("ORB", 1)]);

        const Result = await Grant(UserId, CharacterId, Guid(), [Stack("REWARD", 3)], [Stack("ORB", 2), Stack("NEVER_HELD", 1)]);

        assert.ok(Result.success);
        assert.deepEqual(ReadStacks(CharacterId), [Stack("REWARD", 3)]);
        assert.deepEqual(JSON.parse(JSON.stringify(Result.data!.response.updatedStackedItems)), [Stack("REWARD", 3), Stack("ORB", 0), Stack("NEVER_HELD", 0)]);
    });

    it("keeps the reply shape: echoed lists stay as sent, missing ones stay missing", async () => {
        const {UserId, CharacterId} = await MakePlayer();
        const Item = {catalogId: "WP_AXE", instanceId: "i-2", updateVersion: 0};

        const Result = await RunInventoryTransaction(UserId, CharacterId, Guid(), [Item], [Stack("ORB", 1)], undefined, undefined, undefined, Gs);

        assert.ok(Result.success);
        assert.deepEqual(JSON.parse(JSON.stringify(Result.data!.response)), {
            createdInstancedItems: [Item],
            updatedInstancedItems: [],
            updatedStackedItems: [Stack("ORB", 1)]
        });
    });

    it("refuses another player's character", async () => {
        const A = await MakePlayer();
        const B = await MakePlayer();

        const Result = await Grant(A.UserId, B.CharacterId, Guid(), [Stack("ORB", 1)]);

        assert.deepEqual(Result, {success: false, error: "forbidden"});
    });

    it("logs every item change, and the log refuses UPDATE and DELETE", async () => {
        const {UserId, CharacterId} = await MakePlayer();
        const Id = Guid();

        assert.ok((await RunInventoryTransaction(UserId, CharacterId, Id, [{catalogId: "WP_AXE", instanceId: "i-3", updateVersion: 0}], [Stack("ORB", 4)], undefined, undefined, undefined, Gs)).success);
        // Upstream rule, unchanged: removing an instanced item needs a newer updateVersion than the stored one
        assert.deepEqual(await RunInventoryTransaction(UserId, CharacterId, Guid(), undefined, undefined, [{catalogId: "WP_AXE", instanceId: "i-3", updateVersion: 0}], [Stack("ORB", 1)], undefined, Gs), {success: false, error: "conflict"});
        assert.ok((await RunInventoryTransaction(UserId, CharacterId, Guid(), undefined, undefined, [{catalogId: "WP_AXE", instanceId: "i-3", updateVersion: 1}], [Stack("ORB", 1)], undefined, Gs)).success);

        const Rows = GetDb().$client.prepare("select transactionId, caller, source, operation, catalogId, instanceId, quantityChange, quantityAfter from inventorylog where characterId = ? order by id").all(CharacterId) as any[];

        assert.deepEqual(Rows.map((Row) => [Row.operation, Row.catalogId, Row.quantityChange, Row.quantityAfter]), [
            ["add", "WP_AXE", 1, null],
            ["add", "ORB", 4, 4],
            ["remove", "WP_AXE", -1, null],
            ["remove", "ORB", -1, 3]
        ]);
        assert.equal(Rows[0].transactionId, Id);
        assert.equal(Rows[0].caller, "gameserver");
        assert.equal(Rows[0].source, "UnitTest");

        assert.throws(() => GetDb().$client.prepare("update inventorylog set quantityChange = 99").run(), /append-only/);
        assert.throws(() => GetDb().$client.prepare("delete from inventorylog").run(), /append-only/);
    });
});

describe("Daily token top-ups", () => {
    const Run = (UserId: string, CharacterId: string, Source: string, StackedToAdd: any[] = [], StackedToRemove: any[] = []) =>
        RunInventoryTransaction(UserId, CharacterId, Guid(), undefined, StackedToAdd, undefined, StackedToRemove, undefined, {Caller: "gameserver", Source});

    it("lands the daily patrol bonus refill on 10, whatever the game server asks for", async () => {
        const {UserId, CharacterId} = await MakePlayer();

        await Run(UserId, CharacterId, "PERIODIC_REWARD", [Stack("TOKEN_DAILY_PATROL_BONUS", 6)]);
        assert.equal(StackQuantity(CharacterId, "TOKEN_DAILY_PATROL_BONUS"), 10);

        await Run(UserId, CharacterId, "UnitTest", [], [Stack("TOKEN_DAILY_PATROL_BONUS", 7)]);
        await Run(UserId, CharacterId, "PERIODIC_REWARD", [Stack("TOKEN_DAILY_PATROL_BONUS", 3)]);
        assert.equal(StackQuantity(CharacterId, "TOKEN_DAILY_PATROL_BONUS"), 10);
    });

    it("lands bounty token grants on 6 and never above it", async () => {
        const {UserId, CharacterId} = await MakePlayer();

        await Run(UserId, CharacterId, "UBountyComponent::ServerInitializeBounties", [Stack("TOKEN_BOUNTY_DRAFT", 4)]);
        assert.equal(StackQuantity(CharacterId, "TOKEN_BOUNTY_DRAFT"), 6);

        await Run(UserId, CharacterId, "UBountyComponent::DailyGrant", [Stack("TOKEN_BOUNTY_DRAFT", 6)]);
        assert.equal(StackQuantity(CharacterId, "TOKEN_BOUNTY_DRAFT"), 6);
    });

    it("does not top up other sources and refuses forged player token grants", async () => {
        const {UserId, CharacterId} = await MakePlayer();

        await Run(UserId, CharacterId, "HuntReward", [Stack("TOKEN_BOUNTY_DRAFT", 2), Stack("TOKEN_DAILY_PATROL_BONUS", 1)]);
        await RunInventoryTransaction(UserId, CharacterId, Guid(), undefined, [Stack("TOKEN_BOUNTY_DRAFT", 3)], undefined, undefined, undefined, {Caller: "client", Source: "UBountyComponent::ServerInitializeBounties"});

        assert.equal(StackQuantity(CharacterId, "TOKEN_BOUNTY_DRAFT"), 2);
        assert.equal(StackQuantity(CharacterId, "TOKEN_DAILY_PATROL_BONUS"), 1);
    });
});

describe("SetDailyTokensOnce", () => {
    it("sets every character to the daily amounts once, adding missing stacks and keeping the rest", async () => {
        const {UserId, CharacterId} = await MakePlayer();
        await Grant(UserId, CharacterId, Guid(), [Stack("TOKEN_DAILY_PATROL_BONUS", 3), Stack("BREAK_HIDE", 7)]);

        assert.ok((SetDailyTokensOnce() ?? 0) >= 1);
        assert.equal(StackQuantity(CharacterId, "TOKEN_DAILY_PATROL_BONUS"), 10);
        assert.equal(StackQuantity(CharacterId, "TOKEN_BOUNTY_DRAFT"), 6);
        assert.equal(StackQuantity(CharacterId, "BREAK_HIDE"), 7);

        await Grant(UserId, CharacterId, Guid(), [], [Stack("TOKEN_BOUNTY_DRAFT", 4)]);
        assert.equal(SetDailyTokensOnce(), undefined);
        assert.equal(StackQuantity(CharacterId, "TOKEN_BOUNTY_DRAFT"), 2);
    });
});
