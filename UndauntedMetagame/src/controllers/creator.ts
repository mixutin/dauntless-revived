import { eq } from "drizzle-orm";
import { GetDb } from "../db";
import { inventory, onetimejobs } from "../db/schema";
import { GetActiveCharacter } from "./activecharacter";
import { StoreError } from "./freestore";
import { ApplyInventoryTransactionInTx } from "./inventory";

const CODE = "TheFool";
const SLUG = CODE.toLowerCase();

// What the code hands out, once per account. Every id here is one this server's players already
// hold - they were read out of inventorylog rather than guessed, because the inventory core
// accepts any string and a wrong id would add a stack the client cannot render.
//
// 1.4.4 has five orbs. There is no umbral or radiant orb, and no arcstone of any kind: those
// arrived in later versions of the game. GEM_ALPHA and GEM_HEROIC are this build's upgrade
// stones and are the nearest thing to them.
export const CREATOR_REWARD: readonly {catalogId: string, quantity: number}[] = [
    {catalogId: "ORB_FLAME",    quantity: 50},
    {catalogId: "ORB_FROST",    quantity: 50},
    {catalogId: "ORB_SHOCK",    quantity: 50},
    {catalogId: "ORB_TERRA",    quantity: 50},
    {catalogId: "ORB_PHYSICAL", quantity: 50},
    {catalogId: "GEM_ALPHA",    quantity: 50},
    {catalogId: "GEM_HEROIC",   quantity: 50},
    {catalogId: "CURRENCY_NOTES", quantity: 10000},
];

// Kept for the store's own reporting, which quotes the Rams figure.
export const CREATOR_REWARD_RAMS = CREATOR_REWARD.find((Item) => Item.catalogId === "CURRENCY_NOTES")?.quantity ?? 0;

// The receipt is per code: an account that redeemed the old Void code can still redeem this one.
const ReceiptId = (AccountId: string) => `creator:${SLUG}:${AccountId}`;

const Reply = (Supported: boolean) => ({
    success: Supported,
    slug: Supported ? CODE : "",
    expirationDate: "2099-01-01T00:00:00.000Z"
});

// Permanent account receipt: inventory transaction receipts expire and are character-scoped.
export function GetCreatorSupport(AccountId: string){
    return Reply(GetDb().select().from(onetimejobs).where(eq(onetimejobs.jobId, ReceiptId(AccountId))).get() !== undefined);
}

// Native inventory quantities are signed 32-bit integers, so a stack that is already near the
// ceiling must not be pushed past it.
function CheckRoom(tx: ReturnType<typeof GetDb>, CharacterId: string){
    const Saved = tx.select({stackedItems: inventory.stackedItems}).from(inventory).where(eq(inventory.characterId, CharacterId)).get();

    let Held: any[] = [];

    if(Saved != undefined){
        try{
            const Parsed = JSON.parse(Saved.stackedItems);
            if(Array.isArray(Parsed)) Held = Parsed;
        }
        catch{
            throw new StoreError(409, "The character's inventory could not be read");
        }
    }

    for(const Item of CREATOR_REWARD){
        const Balance = Held.find((Stack: any) => Stack?.catalogId === Item.catalogId)?.quantity ?? 0;

        if(!Number.isSafeInteger(Balance) || Balance < 0 || Balance > 2147483647 - Item.quantity){
            throw new StoreError(409, `${Item.catalogId} cannot receive this reward`);
        }
    }
}

export function RedeemCreatorCode(AccountId: string, Slug: unknown){
    if(typeof Slug !== "string" || Slug.length > 64 || Slug.trim().toLowerCase() !== SLUG){
        throw new StoreError(404, "Creator code not found");
    }

    return GetDb().transaction((tx) => {
        if(tx.select().from(onetimejobs).where(eq(onetimejobs.jobId, ReceiptId(AccountId))).get()){
            throw new StoreError(409, `${CODE} has already been redeemed on this account`);
        }

        const Character = GetActiveCharacter(tx, AccountId);
        if(!Character) throw new StoreError(409, `Create a character before redeeming ${CODE}`);

        CheckRoom(tx as never, Character.characterId);

        tx.insert(onetimejobs).values({jobId: ReceiptId(AccountId), doneDate: new Date().toISOString()}).run();
        ApplyInventoryTransactionInTx(tx, {
            UserId: AccountId,
            CharacterId: Character.characterId,
            TransactionId: ReceiptId(AccountId),
            StackedItemsToAdd: CREATOR_REWARD.map((Item) => ({...Item}))
        }, {Caller: "store", Source: `creator:${CODE}`});

        return {
            ...Reply(true),
            granted: CREATOR_REWARD.map((Item) => ({...Item})),
            grantedRams: CREATOR_REWARD_RAMS,
            refreshInventory: true
        };
    }, {behavior: "immediate"});
}
