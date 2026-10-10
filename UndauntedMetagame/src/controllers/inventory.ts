import { and, eq, lt } from "drizzle-orm";
import crypto from "node:crypto";
import { GetDb } from "../db";
import { characters, inventory, inventorylog, inventorytransactions, onetimejobs } from "../db/schema";
import { logger } from "../logger";
import { DoesCharacterBelongToUserId } from "./character";
import type { Tx } from "./savehistory";
import { FindFusionItemIndex, IsValidFusionRemoval, IsValidFusionSave, MiddlemanConflictError, MiddlemanValidationError, NormaliseFusionItem, ValidateFusionCompletions } from "./middleman";
import { MiddlemanFusionGuards } from "../features";

export type InventoryError = "forbidden" | "not_found" | "conflict" | "insufficient_quantity" | "invalid_inventory_item" | "invalid_inventory_data" | "db_error";
export type InventoryResult<T = void> = { success: true, data?: T } | { success: false, error: InventoryError };

// "store": grants of the storefront (roadmap 3.7), made inside its own purchase transaction
export type InventoryCaller = "client" | "gameserver" | "admin" | "store" | "trials";
export type InventoryContext = { Caller: InventoryCaller, Source?: unknown };
export type TransactionResponse = { createdInstancedItems: any, updatedInstancedItems: any[], updatedStackedItems: any[], removedInstancedItems: any };

// One POST /inventory body, the lists exactly as they arrived (undefined when missing)
export type InventoryTransactionRequest = {
    UserId: string,
    CharacterId: string,
    TransactionId: unknown,
    InstancedItemsToAdd?: any,
    StackedItemsToAdd?: any,
    InstancedItemsToRemove?: any,
    StackedItemsToRemove?: any,
    InstancedItemsToSave?: any
};

// What the core did: the reply, whether it was the stored reply of an earlier identical request, and
// the overspends it clamped (the caller logs those once its transaction has committed)
export type AppliedInventoryTransaction = { response: TransactionResponse, replayed: boolean, overspent: string[] };

// Stored results older than this are dropped; a retry arrives within seconds
const TRANSACTION_RECORD_DAYS = 30;

export class InventoryConflictError extends Error {
    constructor(message: string){
        super(message);
        this.name = "InventoryConflictError";
    }
}

export class InventoryValidationError extends Error {
    constructor(message: string){
        super(message);
        this.name = "InventoryValidationError";
    }
}

// The character is not (or no longer) the account's
export class InventoryForbiddenError extends Error {
    constructor(message: string){
        super(message);
        this.name = "InventoryForbiddenError";
    }
}

export class InventoryInsufficientError extends Error {
    constructor(message: string){
        super(message);
        this.name = "InventoryInsufficientError";
    }
}

type LogEntry = Omit<typeof inventorylog.$inferInsert, "time" | "userId" | "characterId" | "transactionId" | "source" | "caller">;

function MakeEmptyInventoryRow(CharacterId: string): typeof inventory.$inferInsert {
    return {
        characterId: CharacterId,
        instancedItems: "[]",
        stackedItems: "[]",
    };
}

function FindInstancedItemIndex(InstancedItems: any[], IncomingItem: any){
    const Exact = InstancedItems.findIndex((Item) => Item.instanceId === IncomingItem?.instanceId);
    return Exact >= 0 ? Exact : FindFusionItemIndex(InstancedItems, IncomingItem);
}

function HasStatelessItemData(Item: any){
    return !Object.prototype.hasOwnProperty.call(Item, "itemData") || Item.itemData == null;
}

function IsAllowedStaleStatelessReplacement(CurrentItem: any, IncomingItem: any, Operation: string){
    return Operation !== "remove"
        && HasStatelessItemData(CurrentItem)
        && HasStatelessItemData(IncomingItem)
        && CurrentItem.updateVersion === 0;
}

function AssertValidIncomingInstancedItem(IncomingItem: any, Operation: string){
    if(HasStatelessItemData(IncomingItem) && IncomingItem.updateVersion !== 0){
        throw new InventoryValidationError(`Refusing stateless instanced item ${Operation} ${IncomingItem.catalogId}/${IncomingItem.instanceId}: expected updateVersion 0, got ${IncomingItem.updateVersion}`);
    }
}

function AssertExistingInstancedItemWrite(CurrentItem: any, IncomingItem: any, Operation: string): "write" | "skip"{
    if(CurrentItem.catalogId !== IncomingItem.catalogId){
        throw new InventoryValidationError("An existing instance cannot change catalog identity");
    }
    if(Operation !== "remove"){
        AssertValidIncomingInstancedItem(IncomingItem, Operation);
    }

    if(typeof CurrentItem.updateVersion !== "number"){
        return "write";
    }

    if(IsAllowedStaleStatelessReplacement(CurrentItem, IncomingItem, Operation)){
        return "skip";
    }

    if(IsValidFusionSave(CurrentItem, IncomingItem, Operation) || IsValidFusionRemoval(CurrentItem, IncomingItem, Operation)){
        return "write";
    }

    const IsStaleInstancedItem = typeof IncomingItem.updateVersion !== "number" || IncomingItem.updateVersion <= CurrentItem.updateVersion;
    if(IsStaleInstancedItem){
        throw new InventoryConflictError(`Refusing stale instanced item ${Operation} ${IncomingItem.catalogId}/${IncomingItem.instanceId}: current updateVersion ${CurrentItem.updateVersion}, incoming updateVersion ${IncomingItem.updateVersion}`);
    }

    return "write";
}

function AssertItemList(Items: unknown, Name: string){
    if(!Array.isArray(Items) || Items.some((Item) => Item == null || typeof Item !== "object")){
        throw new InventoryValidationError(`Refusing transaction: ${Name} is not a list of items`);
    }
}

// Stack quantities are JSON numbers; a numeric string used to be coerced by the
// arithmetic, so it is still accepted. Anything negative, fractional or non-numeric
// would let a removal add items (or an add remove them), so it is refused.
export function ParseStackQuantity(Item: any, Operation: string){
    const Quantity = typeof Item.quantity === "string" && /^\d+$/.test(Item.quantity) ? Number(Item.quantity) : Item.quantity;

    if(!Number.isSafeInteger(Quantity) || Quantity < 0){
        throw new InventoryValidationError(`Refusing stacked item ${Operation} ${Item.catalogId}: quantity ${JSON.stringify(Item.quantity)} is not a whole number of at least 0`);
    }

    if(typeof Item.catalogId !== "string" || Item.catalogId.length === 0){
        throw new InventoryValidationError(`Refusing stacked item ${Operation}: missing catalogId`);
    }

    return Quantity as number;
}

// Off unless INVENTORY_REFUSE_OVERSPEND=1. No hunt-end /inventory body has been
// captured yet, and a refusal drops the whole transaction, rewards included; until
// the captures show what the game server removes, an overspend is clamped as it
// always was and logged ("Allowing overspend") so it can be judged.
export function IsOverspendRefused(){
    return process.env.INVENTORY_REFUSE_OVERSPEND === "1";
}

// Daily token stacks the game server grants, raised to our own daily amount: the grant is
// rewritten so the stack lands on the amount (nothing when it already holds that many).
// TOKEN_DAILY_PATROL_BONUS: the PERIODIC_REWARD top-up (the game's own cap is 6), to 10.
// TOKEN_BOUNTY_DRAFT: the UBountyComponent grants (the first one and the daily one of
// /bounty/game-data num_tokens_per_day), to 6.
function DailyAmount(Value: string | undefined, Default: number){
    const Amount = Number(Value);
    return Number.isInteger(Amount) && Amount >= 1 ? Amount : Default;
}

const PATROL_BONUS_DAILY = DailyAmount(process.env.PATROL_BONUS_DAILY, 10);
export const BOUNTY_TOKENS_DAILY = DailyAmount(process.env.BOUNTY_TOKENS_DAILY, 6);

const DAILY_TOKENS = [
    {CatalogId: "TOKEN_DAILY_PATROL_BONUS", Amount: PATROL_BONUS_DAILY, IsGrant: (Source: unknown) => Source === "PERIODIC_REWARD"},
    {CatalogId: "TOKEN_BOUNTY_DRAFT", Amount: BOUNTY_TOKENS_DAILY, IsGrant: (Source: unknown) => typeof Source === "string" && Source.startsWith("UBountyComponent::")}
];

function TopUpDailyTokens(StackedItems: any[], StackedItemsToAdd: any[], Source: unknown){
    for(const Token of DAILY_TOKENS){
        if(!Token.IsGrant(Source)){
            continue;
        }

        const Held = StackedItems.find((Item) => Item.catalogId === Token.CatalogId)?.quantity ?? 0;

        for(const Item of StackedItemsToAdd){
            if(Item?.catalogId === Token.CatalogId){
                Item.quantity = Math.max(Token.Amount - Held, 0);
            }
        }
    }
}

// Once, on the first start with the daily tokens: every character's stacks are set to the daily
// amounts (added where missing), so a deploy is all it takes. Returns the characters changed, or
// undefined when the job had already run.
const DAILY_TOKENS_JOB = "daily_tokens_10_6";

export function SetDailyTokensOnce(){
    return GetDb().transaction((tx) => {
        if(tx.select().from(onetimejobs).where(eq(onetimejobs.jobId, DAILY_TOKENS_JOB)).get() !== undefined){
            return undefined;
        }

        let Changed = 0;

        for(const Row of tx.select({characterId: inventory.characterId, stackedItems: inventory.stackedItems}).from(inventory).all()){
            let StackedItems: any[];

            try {
                StackedItems = JSON.parse(Row.stackedItems);
            } catch {
                continue;
            }

            if(!Array.isArray(StackedItems)){
                continue;
            }

            let Touched = false;

            for(const Token of DAILY_TOKENS){
                const Stack = StackedItems.find((Item) => Item?.catalogId === Token.CatalogId);

                if(Stack?.quantity === Token.Amount){
                    continue;
                }

                if(Stack){
                    Stack.quantity = Token.Amount;
                }
                else{
                    StackedItems.push({catalogId: Token.CatalogId, quantity: Token.Amount});
                }

                Touched = true;
            }

            if(Touched){
                tx.update(inventory).set({stackedItems: JSON.stringify(StackedItems)}).where(eq(inventory.characterId, Row.characterId)).run();
                Changed++;
            }
        }

        tx.insert(onetimejobs).values({jobId: DAILY_TOKENS_JOB, doneDate: new Date().toISOString()}).run();
        return Changed;
    });
}

// Applies removals then additions to StackedItems in place, in the order the
// transaction lists them (the order the old code used). A removal may spend what
// the same transaction adds: the part the stack can't cover is taken after the
// additions. Returns the stacks the client should be told about (every touched stack
// with its final count; see the end of the function), the log entries and the overspends. An overspend is a removal of
// more than held plus added; with RefuseOverspend it throws InventoryInsufficientError
// before anything is changed, otherwise it is clamped at 0 as before.
export function ApplyStackedChanges(StackedItems: any[], StackedItemsToRemove: any[], StackedItemsToAdd: any[], RefuseOverspend: boolean){
    const Touched: any[] = [];
    const Log: LogEntry[] = [];
    const Overspent: string[] = [];

    const RemoveQuantities = StackedItemsToRemove.map((Item) => ParseStackQuantity(Item, "remove"));
    const AddQuantities = StackedItemsToAdd.map((Item) => ParseStackQuantity(Item, "add"));

    const Wanted = new Map<string, number>();
    StackedItemsToRemove.forEach((Item, Index) => Wanted.set(Item.catalogId, (Wanted.get(Item.catalogId) ?? 0) + RemoveQuantities[Index]));

    const Added = new Map<string, number>();
    StackedItemsToAdd.forEach((Item, Index) => Added.set(Item.catalogId, (Added.get(Item.catalogId) ?? 0) + AddQuantities[Index]));

    for(const [CatalogId, Quantity] of Wanted){
        const Held = StackedItems.find((Item) => Item.catalogId === CatalogId)?.quantity ?? 0;
        const AddedHere = Added.get(CatalogId) ?? 0;

        if(Quantity > Held + AddedHere){
            const Message = `removes ${Quantity} of ${CatalogId} but only ${Held} held${AddedHere > 0 ? ` and ${AddedHere} added` : ""}`;

            if(RefuseOverspend){
                throw new InventoryInsufficientError(Message);
            }

            Overspent.push(Message);
        }
    }

    const Deferred = new Map<string, number>();

    StackedItemsToRemove.forEach((ItemToRemove, Index) => {
        const ItemIndex = StackedItems.findIndex((Item) => Item.catalogId === ItemToRemove.catalogId);
        const Short = RemoveQuantities[Index] - (ItemIndex < 0 ? 0 : Math.max(Math.min(RemoveQuantities[Index], StackedItems[ItemIndex].quantity), 0));

        if(Short > 0 && Added.has(ItemToRemove.catalogId)){
            Deferred.set(ItemToRemove.catalogId, (Deferred.get(ItemToRemove.catalogId) ?? 0) + Short);
        }

        if(ItemIndex < 0){
            return;
        }

        const Before = StackedItems[ItemIndex].quantity;
        StackedItems[ItemIndex].quantity -= RemoveQuantities[Index];
        const After = StackedItems[ItemIndex].quantity;

        if(StackedItems[ItemIndex].quantity <= 0){
            StackedItems.splice(ItemIndex, 1);
        }

        Log.push({operation: "remove", catalogId: ItemToRemove.catalogId, quantityChange: -Math.min(RemoveQuantities[Index], Before), quantityAfter: Math.max(After, 0)});
    });

    StackedItemsToAdd.forEach((ItemToAdd, Index) => {
        const ItemIndex = StackedItems.findIndex((Item) => Item.catalogId === ItemToAdd.catalogId);

        if(ItemIndex >= 0){
            StackedItems[ItemIndex].quantity += AddQuantities[Index];
            Touched.push(StackedItems[ItemIndex]);
            Log.push({operation: "add", catalogId: ItemToAdd.catalogId, quantityChange: AddQuantities[Index], quantityAfter: StackedItems[ItemIndex].quantity});
        }
        else{
            ItemToAdd.quantity = AddQuantities[Index];
            Touched.push(ItemToAdd);
            StackedItems.push(ItemToAdd);
            Log.push({operation: "add", catalogId: ItemToAdd.catalogId, quantityChange: AddQuantities[Index], quantityAfter: AddQuantities[Index]});
        }
    });

    for(const [CatalogId, Short] of Deferred){
        const ItemIndex = StackedItems.findIndex((Item) => Item.catalogId === CatalogId);

        if(ItemIndex < 0){
            continue;
        }

        const Taken = Math.min(Short, StackedItems[ItemIndex].quantity);
        StackedItems[ItemIndex].quantity -= Taken;
        const After = StackedItems[ItemIndex].quantity;

        if(After <= 0){
            StackedItems.splice(ItemIndex, 1);
        }

        Log.push({operation: "remove", catalogId: CatalogId, quantityChange: -Taken, quantityAfter: Math.max(After, 0)});
    }

    // Upstream only reported added stacks, so the game server never learned that a
    // removal had happened: its cached count stayed at the old value (Rams shown
    // unchanged after an upgrade) and it allowed further upgrades with materials the
    // player no longer had. Report every touched stack with its final count instead,
    // quantity 0 for a stack that was used up. INVENTORY_REPORT_REMOVALS=0 restores
    // the old additions-only reply.
    if(process.env.INVENTORY_REPORT_REMOVALS !== "0"){
        const Final: any[] = [];
        for(const CatalogId of new Set([...Added.keys(), ...Wanted.keys()])){
            Final.push(StackedItems.find((Item) => Item.catalogId === CatalogId) ?? {catalogId: CatalogId, quantity: 0});
        }
        return {Touched: Final, Log, Overspent};
    }

    return {Touched, Log, Overspent};
}

// Only an identical request is a retry. The game builds each transactionId as a
// fresh GUID; an empty or all-zero id is treated as "no id".
export function GetTransactionDedupeKey(TransactionId: unknown){
    if(typeof TransactionId !== "string" || TransactionId.length === 0 || /^[0-]+$/.test(TransactionId)){
        return undefined;
    }

    return TransactionId;
}

export function HashTransactionRequest(CharacterId: unknown, InstancedItemsToAdd: unknown, StackedItemsToAdd: unknown, InstancedItemsToRemove: unknown, StackedItemsToRemove: unknown, InstancedItemsToSave: unknown){
    return crypto.createHash("sha256")
        .update(JSON.stringify([CharacterId, InstancedItemsToAdd ?? null, StackedItemsToAdd ?? null, InstancedItemsToRemove ?? null, StackedItemsToRemove ?? null, InstancedItemsToSave ?? null]))
        .digest("hex");
}

function WriteLog(tx: Tx, UserId: string, CharacterId: string, TransactionId: string | undefined, Context: InventoryContext, Entries: LogEntry[]){
    if(Entries.length === 0){
        return;
    }

    const Time = new Date().toISOString();
    const Source = typeof Context.Source === "string" ? Context.Source : null;

    tx.insert(inventorylog).values(Entries.map((Entry) => ({
        time: Time,
        userId: UserId,
        characterId: CharacterId,
        transactionId: TransactionId ?? null,
        source: Source,
        caller: Context.Caller,
        ...Entry
    }))).run();
}

function LogInstancedItem(Operation: string, Item: any): LogEntry{
    return {
        operation: Operation,
        catalogId: typeof Item?.catalogId === "string" ? Item.catalogId : null,
        instanceId: typeof Item?.instanceId === "string" ? Item.instanceId : null,
        updateVersion: Number.isSafeInteger(Item?.updateVersion) ? Item.updateVersion : null,
        quantityChange: Operation === "remove" ? -1 : Operation === "update" ? 0 : 1
    };
}

export async function UpdateInstancedItem(CharacterId: string, UserId: string, InstanceId: string, CatalogId: string, ItemData: string | null | undefined, UpdateVersion: number, Context: InventoryContext = {Caller: "client"}): Promise<InventoryResult<any>>{
    if(Context.Caller === "client"){
        logger.warn({event: "inventory_authority_denied", userId: UserId, operation: "instance_update"});
        return {success: false, error: "forbidden"};
    }
    if(!await DoesCharacterBelongToUserId(UserId, CharacterId)){
        logger.error(`Specified characterId ${CharacterId} does not belong to user ${UserId}`);
        return {success: false, error: "forbidden"};
    }

    try{
        return GetDb().transaction((tx) => {
            let CurrentInventory = tx.query.inventory.findFirst({where: eq(inventory.characterId, CharacterId)}).sync();

            if(CurrentInventory == undefined){
                logger.info(`Creating inventory for characterId ${CharacterId} and userId ${UserId}`);

                CurrentInventory = MakeEmptyInventoryRow(CharacterId);

                tx.insert(inventory).values(CurrentInventory).run();
            }

            const InstancedItems: any[] = JSON.parse(CurrentInventory.instancedItems);
            const IncomingItem = NormaliseFusionItem({catalogId: CatalogId, instanceId: InstanceId, itemData: ItemData, updateVersion: UpdateVersion});
            const ItemIndex = FindInstancedItemIndex(InstancedItems, IncomingItem);

            if(ItemIndex < 0){
                return {success: false, error: "not_found"} as InventoryResult<any>;
            }

            const Item = InstancedItems[ItemIndex];

            if(AssertExistingInstancedItemWrite(Item, IncomingItem, "update") === "skip"){
                logger.info(`Skipping stale stateless Instanced Item ${CatalogId} for CharacterId ${CharacterId} and UserId ${UserId}`);
                return {success: true, data: Item} as InventoryResult<any>;
            }

            Item.instanceId = IncomingItem.instanceId;
            Item.itemData = ItemData;
            Item.updateVersion = UpdateVersion;

            logger.info(`Updating Instanced Item ${CatalogId} for CharacterId ${CharacterId} and UserId ${UserId}`);

            tx.update(inventory).set({
                instancedItems: JSON.stringify(InstancedItems)
            }).where(eq(inventory.characterId, CharacterId)).run();

            WriteLog(tx, UserId, CharacterId, undefined, Context, [LogInstancedItem("update", Item)]);

            return {success: true, data: Item} as InventoryResult<any>;
        });
    }
    catch(error){
        if(error instanceof InventoryConflictError || error instanceof MiddlemanConflictError){
            logger.warn(error.message);
            return {success: false, error: "conflict"};
        }

        if(error instanceof InventoryValidationError || error instanceof MiddlemanValidationError){
            logger.warn(error.message);
            return {success: false, error: "invalid_inventory_item"};
        }

        if(error instanceof SyntaxError){
            logger.error(error, `Invalid inventory data while updating instanced item ${CatalogId} for characterId ${CharacterId} and userId ${UserId}`);
            return {success: false, error: "invalid_inventory_data"};
        }

        logger.error(error, `Failed to update instanced item ${CatalogId} for characterId ${CharacterId} and userId ${UserId}`);
        return {success: false, error: "db_error"};
    }
}

type PreparedInventoryTransaction = {
    Request: InventoryTransactionRequest,
    InstancedItemsToAdd: any[],
    StackedItemsToAdd: any[],
    InstancedItemsToRemove: any[],
    StackedItemsToRemove: any[],
    InstancedItemsToSave: any[],
    ShouldTouchInstancedItems: boolean,
    ShouldTouchStackedItems: boolean,
    DedupeKey: string | undefined,
    RequestHash: string
};

// The checks that need no database: every list is a list of items. Throws InventoryValidationError.
function PrepareInventoryTransaction(Request: InventoryTransactionRequest): PreparedInventoryTransaction {
    const InstancedItemsToAdd = Request.InstancedItemsToAdd ?? [];
    const StackedItemsToAdd = Request.StackedItemsToAdd ?? [];
    const InstancedItemsToRemove = Request.InstancedItemsToRemove ?? [];
    const StackedItemsToRemove = Request.StackedItemsToRemove ?? [];
    const InstancedItemsToSave = Request.InstancedItemsToSave ?? [];

    AssertItemList(InstancedItemsToAdd, "addInstancedItems");
    AssertItemList(StackedItemsToAdd, "addStackedItems");
    AssertItemList(InstancedItemsToRemove, "removeInstancedItems");
    AssertItemList(StackedItemsToRemove, "removeStackedItems");
    AssertItemList(InstancedItemsToSave, "saveInstancedItems");

    // Pending Middleman exchanges are inventory items. Give each slot a stable identity before
    // dedupe/hash checks so three simultaneous slots do not overwrite one another.
    for(const Item of [...InstancedItemsToAdd, ...InstancedItemsToSave]){
        NormaliseFusionItem(Item);
    }

    for(const Item of InstancedItemsToRemove){
        NormaliseFusionItem(Item, true);
    }

    return {
        Request,
        InstancedItemsToAdd,
        StackedItemsToAdd,
        InstancedItemsToRemove,
        StackedItemsToRemove,
        InstancedItemsToSave,
        ShouldTouchInstancedItems: InstancedItemsToAdd.length > 0 || InstancedItemsToRemove.length > 0 || InstancedItemsToSave.length > 0,
        ShouldTouchStackedItems: StackedItemsToAdd.length > 0 || StackedItemsToRemove.length > 0,
        DedupeKey: GetTransactionDedupeKey(Request.TransactionId),
        RequestHash: HashTransactionRequest(Request.CharacterId, Request.InstancedItemsToAdd, Request.StackedItemsToAdd, Request.InstancedItemsToRemove, Request.StackedItemsToRemove, Request.InstancedItemsToSave)
    };
}

// The reply echoes two of the lists the way the route always has
function MakeTransactionResponse(Request: InventoryTransactionRequest, TouchedStackedItems: any[]): TransactionResponse {
    return {
        createdInstancedItems: Request.InstancedItemsToAdd,
        updatedInstancedItems: [], // TODO: Actually properly diff & merge the JSON blobs
        updatedStackedItems: TouchedStackedItems,
        removedInstancedItems: Request.InstancedItemsToRemove
    };
}

// DoesCharacterBelongToUserId inside a transaction
function AssertCharacterOwnedInTx(tx: Tx, UserId: unknown, CharacterId: unknown){
    const Owned = typeof UserId === "string" && typeof CharacterId === "string" && tx.select({characterId: characters.characterId}).from(characters)
        .where(and(eq(characters.characterId, CharacterId), eq(characters.userId, UserId))).get() !== undefined;

    if(!Owned){
        throw new InventoryForbiddenError(`Specified characterId ${CharacterId} does not belong to user ${UserId}`);
    }
}

// Everything that touches the database, inside the caller's transaction: the stored-result lookup,
// the checks, the inventory write, the item log and the stored result. Throws on a refusal, so the
// caller's transaction rolls back and nothing is changed.
function ApplyPreparedInventoryTransaction(tx: Tx, Prepared: PreparedInventoryTransaction, Context: InventoryContext): AppliedInventoryTransaction {
    // Raw deltas are results, not player intentions. Only the authenticated native
    // server or an internal purchase/reward controller may authorize them.
    // Source is untrusted audit metadata and never upgrades this authority.
    if(Context.Caller === "client"){
        logger.warn({event: "inventory_authority_denied", userId: Prepared.Request.UserId, operation: "transaction"});
        throw new InventoryForbiddenError("Player cannot authorize raw inventory deltas");
    }
    const { Request, InstancedItemsToAdd, StackedItemsToAdd, InstancedItemsToRemove, StackedItemsToRemove, InstancedItemsToSave, DedupeKey, RequestHash } = Prepared;
    const { UserId, CharacterId, TransactionId } = Request;

    if(DedupeKey != undefined){
        const Stored = tx.select().from(inventorytransactions).where(and(
            eq(inventorytransactions.characterId, CharacterId),
            eq(inventorytransactions.transactionId, DedupeKey),
            eq(inventorytransactions.requestHash, RequestHash)
        )).get();

        if(Stored != undefined){
            return {response: JSON.parse(Stored.response), replayed: true, overspent: []};
        }

        const SameIdOtherBody = tx.select({id: inventorytransactions.id}).from(inventorytransactions).where(and(
            eq(inventorytransactions.characterId, CharacterId),
            eq(inventorytransactions.transactionId, DedupeKey)
        )).get();

        if(SameIdOtherBody != undefined){
            logger.warn(`transactionId ${DedupeKey} for userId ${UserId} and characterId ${CharacterId} was seen before with a different body; running it as a new transaction`);
        }
    }

    let CurrentInventory = tx.query.inventory.findFirst({where: eq(inventory.characterId, CharacterId)}).sync();

    if(CurrentInventory == undefined){
        logger.info(`Creating inventory for characterId ${CharacterId}`)

        CurrentInventory = MakeEmptyInventoryRow(CharacterId);

        tx.insert(inventory).values(CurrentInventory).run();
    }

    const Update: Partial<typeof inventory.$inferInsert> = {};
    const Log: LogEntry[] = [];
    let TouchedStackedItems: any[] = [];
    let Overspent: string[] = [];

    if(Prepared.ShouldTouchInstancedItems){
        const InstancedItems: any[] = JSON.parse(CurrentInventory.instancedItems);
        let DidUpdateInstancedItems = false;

        if(MiddlemanFusionGuards()){
            ValidateFusionCompletions(InstancedItems, InstancedItemsToRemove, StackedItemsToAdd);
        }

        for(const ItemToRemove of InstancedItemsToRemove){
            const ItemIndex = FindInstancedItemIndex(InstancedItems, ItemToRemove);

            if(ItemIndex >= 0){
                AssertExistingInstancedItemWrite(InstancedItems[ItemIndex], ItemToRemove, "remove");
                Log.push(LogInstancedItem("remove", InstancedItems[ItemIndex]));
                InstancedItems.splice(ItemIndex, 1);
                DidUpdateInstancedItems = true;
            }
            else{
                logger.warn(`transactionId ${TransactionId} removes instanced item ${ItemToRemove.catalogId}/${ItemToRemove.instanceId}, which characterId ${CharacterId} does not hold; ignored`);
            }
        }

        for(const ItemToSave of InstancedItemsToSave){
            const ItemIndex = FindInstancedItemIndex(InstancedItems, ItemToSave);

            if(ItemIndex >= 0){
                if(AssertExistingInstancedItemWrite(InstancedItems[ItemIndex], ItemToSave, "save") === "skip"){
                    continue;
                }

                InstancedItems[ItemIndex] = ItemToSave;
                DidUpdateInstancedItems = true;
            }
            else{
                AssertValidIncomingInstancedItem(ItemToSave, "save");
                InstancedItems.push(ItemToSave);
                DidUpdateInstancedItems = true;
            }

            Log.push(LogInstancedItem("save", ItemToSave));
        }

        for(const ItemToAdd of InstancedItemsToAdd){
            const ItemIndex = FindInstancedItemIndex(InstancedItems, ItemToAdd);

            if(ItemIndex >= 0){
                if(AssertExistingInstancedItemWrite(InstancedItems[ItemIndex], ItemToAdd, "add") === "skip"){
                    continue;
                }

                InstancedItems[ItemIndex] = ItemToAdd;
                DidUpdateInstancedItems = true;
            }
            else{
                AssertValidIncomingInstancedItem(ItemToAdd, "add");
                InstancedItems.push(ItemToAdd);
                DidUpdateInstancedItems = true;
            }

            Log.push(LogInstancedItem("add", ItemToAdd));
        }

        if(DidUpdateInstancedItems){
            Update.instancedItems = JSON.stringify(InstancedItems);
        }
    }

    if(Prepared.ShouldTouchStackedItems){
        const StackedItems: any[] = JSON.parse(CurrentInventory.stackedItems);

        if(Context.Caller === "gameserver"){
            TopUpDailyTokens(StackedItems, StackedItemsToAdd, Context.Source);
        }

        const Applied = ApplyStackedChanges(StackedItems, StackedItemsToRemove, StackedItemsToAdd, IsOverspendRefused());
        TouchedStackedItems = Applied.Touched;
        Overspent = Applied.Overspent;
        Log.push(...Applied.Log);

        Update.stackedItems = JSON.stringify(StackedItems);
    }

    if(Object.keys(Update).length > 0){
        tx.update(inventory).set(Update).where(eq(inventory.characterId, CharacterId)).run();
    }

    WriteLog(tx, UserId, CharacterId, DedupeKey ?? (typeof TransactionId === "string" ? TransactionId : undefined), Context, Log);

    const Response = MakeTransactionResponse(Request, TouchedStackedItems);

    if(DedupeKey != undefined){
        const Now = new Date();

        tx.insert(inventorytransactions).values({
            transactionId: DedupeKey,
            characterId: CharacterId,
            userId: UserId,
            requestHash: RequestHash,
            status: 200,
            response: JSON.stringify(Response),
            createdDate: Now.toISOString()
        }).run();

        tx.delete(inventorytransactions).where(lt(inventorytransactions.createdDate, new Date(Now.getTime() - TRANSACTION_RECORD_DAYS * 24 * 60 * 60 * 1000).toISOString())).run();
    }

    return {response: Response, replayed: false, overspent: Overspent};
}

// The inventory core for a caller that already holds a transaction (the store grants items inside its
// purchase transaction). Synchronous, as better-sqlite3 transactions are: nothing may be awaited in
// between. Same rules as POST /inventory: the same ledger (a repeated request answers the stored reply
// and changes nothing), the same inventorylog rows (with Context.Caller) and the same checks. A refusal
// throws (InventoryForbiddenError, InventoryValidationError, InventoryConflictError,
// InventoryInsufficientError; a SyntaxError for a stored inventory that is not JSON), which rolls back
// the caller's whole transaction; InventoryErrorOf maps it to an InventoryError. The overspends it
// clamped come back in `overspent` for the caller to log after its commit. The pattern, a core that
// runs inside the caller's transaction, is Harmonic's (github.com/Harmonicrain/Undaunted 895f7c7); the
// rules are ours.
export function ApplyInventoryTransactionInTx(tx: Tx, Request: InventoryTransactionRequest, Context: InventoryContext): AppliedInventoryTransaction {
    AssertCharacterOwnedInTx(tx, Request.UserId, Request.CharacterId);

    const Prepared = PrepareInventoryTransaction(Request);

    if(!Prepared.ShouldTouchInstancedItems && !Prepared.ShouldTouchStackedItems){
        return {response: MakeTransactionResponse(Request, []), replayed: false, overspent: []};
    }

    return ApplyPreparedInventoryTransaction(tx, Prepared, Context);
}

// The InventoryError for an error the core threw; undefined for anything else (a database error)
export function InventoryErrorOf(error: unknown): InventoryError | undefined {
    if(error instanceof InventoryForbiddenError) return "forbidden";
    if(error instanceof InventoryInsufficientError) return "insufficient_quantity";
    if(error instanceof InventoryConflictError || error instanceof MiddlemanConflictError) return "conflict";
    if(error instanceof InventoryValidationError || error instanceof MiddlemanValidationError) return "invalid_inventory_item";
    if(error instanceof SyntaxError) return "invalid_inventory_data";
    return undefined;
}

function LogOverspend(Request: InventoryTransactionRequest, Context: InventoryContext, Overspent: string[]){
    if(Overspent.length === 0){
        return;
    }

    const Source = typeof Context.Source === "string" ? `, source ${Context.Source}` : "";

    logger.warn(`Allowing overspend in transactionId ${Request.TransactionId} for userId ${Request.UserId} and characterId ${Request.CharacterId} (${Context.Caller}${Source}): ${Overspent.join("; ")}; clamped at 0 as before (INVENTORY_REFUSE_OVERSPEND=1 refuses these)`);
}

// POST /inventory. The lists are passed exactly as they arrived; the reply echoes two of them the
// way the route always has. Everything (the stored-result lookup, the checks, the inventory write,
// the item log and the stored result) is one SQLite transaction, opened here around the core above:
// a refused transaction changes nothing.
export async function RunInventoryTransaction(UserId: string, CharacterId: string, TransactionId: string, RawInstancedItemsToAdd: any, RawStackedItemsToAdd: any, RawInstancedItemsToRemove: any, RawStackedItemsToRemove: any, RawInstancedItemsToSave: any, Context: InventoryContext = {Caller: "client"}): Promise<InventoryResult<{response: TransactionResponse, replayed: boolean}>>{
    const Request: InventoryTransactionRequest = {
        UserId,
        CharacterId,
        TransactionId,
        InstancedItemsToAdd: RawInstancedItemsToAdd,
        StackedItemsToAdd: RawStackedItemsToAdd,
        InstancedItemsToRemove: RawInstancedItemsToRemove,
        StackedItemsToRemove: RawStackedItemsToRemove,
        InstancedItemsToSave: RawInstancedItemsToSave
    };

    if(!await DoesCharacterBelongToUserId(UserId, CharacterId)){
        logger.error(`Specified characterId ${CharacterId} does not belong to user ${UserId}`);
        return {success: false, error: "forbidden"};
    }

    let Prepared: PreparedInventoryTransaction;

    try{
        Prepared = PrepareInventoryTransaction(Request);
    }
    catch(error){
        logger.warn(`transactionId ${TransactionId} for userId ${UserId} and characterId ${CharacterId}: ${(error as Error).message}`);
        return {success: false, error: "invalid_inventory_item"};
    }

    if(!Prepared.ShouldTouchInstancedItems && !Prepared.ShouldTouchStackedItems){
        return {success: true, data: {response: MakeTransactionResponse(Request, []), replayed: false}};
    }

    if(Prepared.DedupeKey == undefined){
        logger.warn(`transactionId ${JSON.stringify(TransactionId)} for userId ${UserId} and characterId ${CharacterId} is not usable for retry detection; running it without`);
    }

    try{
        const Applied = GetDb().transaction((tx) => {
            // Checked again inside the transaction, like every caller of the core
            AssertCharacterOwnedInTx(tx, UserId, CharacterId);

            return ApplyPreparedInventoryTransaction(tx, Prepared, Context);
        });

        LogOverspend(Request, Context, Applied.overspent);

        return {success: true, data: {response: Applied.response, replayed: Applied.replayed}};
    }
    catch(error){
        if(error instanceof InventoryForbiddenError){
            logger.error(error.message);
            return {success: false, error: "forbidden"};
        }

        if(error instanceof InventoryInsufficientError){
            logger.warn(`Refusing transactionId ${TransactionId} for userId ${UserId} and characterId ${CharacterId}: ${error.message}; nothing was changed`);
            return {success: false, error: "insufficient_quantity"};
        }

        if(error instanceof InventoryConflictError || error instanceof MiddlemanConflictError){
            logger.warn(error.message);
            return {success: false, error: "conflict"};
        }

        if(error instanceof InventoryValidationError || error instanceof MiddlemanValidationError){
            logger.warn(error.message);
            return {success: false, error: "invalid_inventory_item"};
        }

        if(error instanceof SyntaxError){
            logger.error(error, `Invalid inventory data while running transaction ${TransactionId} for characterId ${CharacterId} and userId ${UserId}`);
            return {success: false, error: "invalid_inventory_data"};
        }

        logger.error(error, `Failed to run inventory transaction ${TransactionId} for characterId ${CharacterId} and userId ${UserId}`);
        return {success: false, error: "db_error"};
    }
}

export async function GetInventoryForUserIdAndCharacterId(UserId: string, CharacterId: string): Promise<InventoryResult<{characterId: string, instancedItems: any[], stackedItems: any[]}>>{
    if(!await DoesCharacterBelongToUserId(UserId, CharacterId)){ // TODO: HACK: Get rid of this ugly thing, this is a workaround as we don't have a userId on our inventories table
        return {success: false, error: "forbidden"};
    }

    try{
        let InventoryFromDb = await GetDb().query.inventory.findFirst({where: eq(inventory.characterId, CharacterId)});

        if(InventoryFromDb == undefined){
            logger.info(`Creating inventory for characterId ${CharacterId} and userId ${UserId}`);

            InventoryFromDb = MakeEmptyInventoryRow(CharacterId);

            await GetDb().insert(inventory).values(InventoryFromDb);
        }

        return {
            success: true,
            data: {
                characterId: CharacterId,
                instancedItems: JSON.parse(InventoryFromDb!.instancedItems),
                stackedItems: JSON.parse(InventoryFromDb!.stackedItems)
            }
        };
    }
    catch(error){
        if(error instanceof SyntaxError){
            logger.error(error, `Invalid inventory data while fetching inventory for characterId ${CharacterId} and userId ${UserId}`);
            return {success: false, error: "invalid_inventory_data"};
        }

        logger.error(error, `Failed to fetch inventory for characterId ${CharacterId} and userId ${UserId}`);
        return {success: false, error: "db_error"};
    }
}
