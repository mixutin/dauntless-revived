import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { inventory } from "../db/schema";
import { GetActiveCharacter } from "./activecharacter";
import { COSMETIC_PREFIXES, GrantKind } from "./freestore";
import { ApplyInventoryTransactionInTx } from "./inventory";
import type { Tx } from "./savehistory";

// Granting items to a player by hand: cosmetics, materials, currencies, anything the catalogue
// holds. The store and the creator code each grant their own fixed list; this is the general
// case, for returning what a bug took or handing out what a player is owed.
//
// Everything goes through the same inventory core as every other grant, so it lands in
// inventorylog with caller "admin" and the acting administrator in the source. There is no
// separate path that writes items without a record.

export class GrantError extends Error {
    constructor(public Status: number, message: string){
        super(message);
        this.name = "GrantError";
    }
}

// Native inventory quantities are signed 32-bit. Staying well inside it means a grant can never
// push a stack past what the client can represent.
const MAX_QUANTITY = 1_000_000;
const MAX_ITEMS = 64;
const CATALOG_ID = /^[A-Za-z0-9_]{1,128}$/;

export type GrantItem = { catalogId: string, quantity: number };

export function CheckGrantItems(Items: unknown): GrantItem[] {
    if(!Array.isArray(Items) || Items.length === 0){
        throw new GrantError(400, "Items must be a non-empty list");
    }

    if(Items.length > MAX_ITEMS){
        throw new GrantError(400, `At most ${MAX_ITEMS} items in one grant`);
    }

    const Checked: GrantItem[] = [];

    for(const Item of Items){
        const CatalogId = (Item as GrantItem)?.catalogId;
        const Quantity = (Item as GrantItem)?.quantity;

        if(typeof CatalogId !== "string" || !CATALOG_ID.test(CatalogId)){
            throw new GrantError(400, `Not a catalog id: ${JSON.stringify(CatalogId)}`);
        }

        if(!Number.isSafeInteger(Quantity) || Quantity < 1 || Quantity > MAX_QUANTITY){
            throw new GrantError(400, `${CatalogId}: quantity must be a whole number from 1 to ${MAX_QUANTITY}`);
        }

        Checked.push({catalogId: CatalogId, quantity: Quantity});
    }

    return Checked;
}

// Stacked unless the item catalogue says this one is instanced. GrantKind knows about cosmetics
// and the repeatable consumables; materials, currencies and parts are all stacked, which is what
// an unknown id falls back to.
//
// A cosmetic is the one case where falling back is wrong: most are instanced, so delivering one as
// a stack writes a row the client cannot render. If an id looks like a cosmetic and the catalogue
// does not say how it is granted, the id is misspelled or not in this build - refuse it rather
// than write something unusable into the player's inventory.
function IsInstanced(CatalogId: string){
    const Kind = GrantKind(CatalogId);

    if(Kind === undefined && COSMETIC_PREFIXES.some((Prefix) => CatalogId.startsWith(Prefix))){
        throw new GrantError(400, `${CatalogId} is not in this build's cosmetic catalogue`);
    }

    return Kind === "instanced";
}

function CurrentStack(tx: Tx, CharacterId: string, CatalogId: string){
    const Row = tx.select({stackedItems: inventory.stackedItems}).from(inventory).where(eq(inventory.characterId, CharacterId)).get();

    if(Row == undefined){
        return 0;
    }

    let Items: unknown;

    try{
        Items = JSON.parse(Row.stackedItems);
    }
    catch{
        throw new GrantError(409, "The character's inventory could not be read");
    }

    if(!Array.isArray(Items)){
        throw new GrantError(409, "The character's inventory could not be read");
    }

    for(const Stack of Items){
        if(Stack?.catalogId === CatalogId && Number.isSafeInteger(Number(Stack.quantity))){
            return Number(Stack.quantity);
        }
    }

    return 0;
}

// The same grant sent twice with the same Reference changes nothing the second time: the
// inventory ledger answers the stored reply. Without one, every send grants again.
export function GrantItemsInTx(tx: Tx, AccountId: string, Items: GrantItem[], Actor: string, Reference: string){
    const Character = GetActiveCharacter(tx, AccountId);

    if(Character == undefined){
        throw new GrantError(409, "The account has no character to grant to");
    }

    const TransactionId = `admin:${createHash("sha256").update(`${AccountId}:${Reference}`).digest("hex").slice(0, 32)}`;
    const Stacked: GrantItem[] = [];
    const Instanced: {catalogId: string, instanceId: string, updateVersion: number}[] = [];

    for(const Item of Items){
        if(IsInstanced(Item.catalogId)){
            // One instance per unit, with an id derived from the grant so a repeat names the same
            // instances rather than creating duplicates.
            for(let Index = 0; Index < Item.quantity; Index++){
                Instanced.push({
                    catalogId: Item.catalogId,
                    instanceId: createHash("sha256").update(`${TransactionId}:${Item.catalogId}:${Index}`).digest("hex").slice(0, 32),
                    updateVersion: 0
                });
            }

            continue;
        }

        const Held = CurrentStack(tx, Character.characterId, Item.catalogId);

        if(Held + Item.quantity > 2147483647){
            throw new GrantError(409, `${Item.catalogId}: the stack cannot hold ${Item.quantity} more`);
        }

        Stacked.push(Item);
    }

    const Applied = ApplyInventoryTransactionInTx(tx, {
        UserId: AccountId,
        CharacterId: Character.characterId,
        TransactionId,
        StackedItemsToAdd: Stacked.length > 0 ? Stacked : undefined,
        InstancedItemsToAdd: Instanced.length > 0 ? Instanced : undefined
    }, {Caller: "admin", Source: `admin:${Actor}`});

    return {
        characterId: Character.characterId,
        transactionId: TransactionId,
        replayed: Applied.replayed,
        stacked: Stacked.length,
        instanced: Instanced.length,
        refreshInventory: true
    };
}
