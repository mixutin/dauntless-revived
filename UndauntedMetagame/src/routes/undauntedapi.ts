import {RecoverAccountKey} from "../controllers/accountrecovery";
import {RegionProbes} from '../controllers/regionprobes';
import { DiscordKeyStats } from '../controllers/discordstats';
import { GetHuntRegion, SaveHuntRegion } from '../controllers/regionpreferences';

import { DiscordAccount, LinkDiscordAccount } from '../controllers/discordlinks';

import { Router } from "express";
import { DeleteInviteCode, GetAllUserIds, GetInviteCodes, GetRecentPlayerData, IsRegistrationMode, RegisterInviteCode, REGISTRATION_MODE, SetRegistrationMode } from "../controllers/undauntedapi";
import { HasUndauntedUserApiKey } from "../middleware/HasUndauntedUserApiKey";
import { HasUndauntedAdminApiKey } from "../middleware/HasUndauntedAdminApiKey";
import { SignMetagameJWTForUid } from "../controllers/auth";
import {ModerationInfo,SetAccountBan,EndPlayingAddress} from '../controllers/moderation';
import { GetCharacterIdsForUserId, GetSaveHistory, RollbackCharacter, RollbackError, RollbackLoadout } from "../controllers/savehistory";
import { GetObjectiveRecords, GetSelectedHuntPass, GetTrackRecords, SeedProgression } from "../controllers/realprogression";
import { IsRealProgressionAccount } from "../controllers/progressionmode";
import { ComputeEarnedRanks, GetProgressionPath, PremiumGatingEntitlement } from "../controllers/progressionrank";
import { GrantEntitlementInTx, ListEntitlements, RevokeEntitlementInTx } from "../controllers/entitlements";
import { DoesAccountExist, RecordProgressionEvent } from "../controllers/progressionevents";
import { GetDb } from "../db";
import { CleanInviteNote, ErrorBody, GenerateInviteCode, IsUsernameTaken, IsValidUsername, LogInviteCreated, MAX_INVITE_USES, RegisterAccount, RenameAccount, TrimUsername } from "../controllers/accounts";
import { GetServerStatus } from "../controllers/serverstatus";
import { logger } from "../logger";
import { FindAccount } from "../controllers/login";
import { InviteToParty } from "../controllers/party";
import { SendOrAcceptFriendRequest } from "../controllers/friends";
import { DisbandGuildAsAdmin, GuildNameOf, InviteToGuild, ListGuilds } from "../controllers/guild";
import { RefuseAdminKeyThroughProxy } from "../middleware/RequestOrigin";
import { IsSoftRegisteredCaller, SoftAccountAuth } from "../middleware/SoftAccountAuth";
import { AdminMutationRateLimit, HealthReadRateLimit } from "../middleware/RateLimits";
import { BackendHealthEnabled, BackendRuntimeHealth } from '../middleware/BackendHealth';
import { userapikeys, users } from '../db/schema';
import { eq, sql } from 'drizzle-orm';

export const undauntedApiRouter = Router();

undauntedApiRouter.get('/HuntRegion', HasUndauntedUserApiKey, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({region:GetHuntRegion((req as any).UndauntedUserInfo.UserId), enabled:process.env.AUS_REGION === '1', probes:RegionProbes()});
});
undauntedApiRouter.post('/HuntRegion', HasUndauntedUserApiKey, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const region = req.body?.region;
    if (region !== 'main' && region !== 'aus' && region !== 'ger' && region !== 'us') { res.status(400).json({error:'invalid_region'}); return; }
    if (region === 'aus' && process.env.AUS_REGION !== '1') { res.status(503).json({error:'region_unavailable'}); return; }
    if (region === 'ger' && process.env.GERMANY_REGION !== '1') { res.status(503).json({error:'region_unavailable'}); return; }
    if (region === 'us' && process.env.US_REGION !== '1') { res.status(503).json({error:'region_unavailable'}); return; }
    SaveHuntRegion((req as any).UndauntedUserInfo.UserId, region);
    res.json({region});
});

undauntedApiRouter.get('/DiscordKeyStats', HealthReadRateLimit, HasUndauntedAdminApiKey, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await DiscordKeyStats());
});


undauntedApiRouter.post('/DiscordLink', AdminMutationRateLimit, HasUndauntedAdminApiKey, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(LinkDiscordAccount(req.body?.DiscordId, req.body?.UserId));
});
undauntedApiRouter.get('/DiscordLink/:discordId', HealthReadRateLimit, HasUndauntedAdminApiKey, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!/^\d{17,20}$/.test(String(req.params.discordId))) { res.status(400).json({error:'invalid_discord_id'}); return; }
    res.json({account: DiscordAccount(String(req.params.discordId)) ?? null});
});


undauntedApiRouter.get('/BackendHealth', HealthReadRateLimit, HasUndauntedAdminApiKey, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!BackendHealthEnabled()) { res.status(404).json({error: 'health_disabled'}); return; }
    res.json(BackendRuntimeHealth());
});

// Operator-only directory. Keys are irreversible hashes in storage: expose only a short
// fingerprint for matching a launcher's backup key, never a key or the full stored hash.
undauntedApiRouter.get('/DashboardAccounts', HealthReadRateLimit, HasUndauntedAdminApiKey, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000000) { res.status(400).json({error: 'invalid_offset'}); return; }
    const query=typeof req.query.q==='string'?req.query.q.trim():'';
    if(query.length>100){res.status(400).json({error:'invalid_query'});return;}
    const rows = GetDb().select({id: users.userId, name: users.name, admin: users.isAdmin, hash: userapikeys.keyHash})
        .from(users).leftJoin(userapikeys, eq(users.userId, userapikeys.userId))
        .where(query ? sql`instr(lower(${users.name}), lower(${query})) > 0 OR instr(lower(${users.userId}), lower(${query})) > 0 OR instr(lower(substr(${userapikeys.keyHash},1,16)), lower(${query})) > 0` : undefined)
        .orderBy(users.userId).limit(101).offset(offset).all();
    res.json({accounts: rows.slice(0, 100).map(row => ({id: row.id, name: row.name, admin: row.admin, developer:(process.env.DEVELOPER_ACCOUNT_IDS || '').split(',').map(x=>x.trim()).includes(row.id),
        keyFingerprint: row.hash && /^[a-f0-9]{64}$/i.test(row.hash) ? row.hash.slice(0, 16).toLowerCase() : null})),
        nextOffset: rows.length > 100 ? offset + 100 : null});
});

undauntedApiRouter.post('/PlayingEnded', HasUndauntedUserApiKey, (req:any,res)=>{
    EndPlayingAddress(req.UndauntedUserInfo.UserId);
    res.status(204).end();
});

undauntedApiRouter.get('/Moderation/:accountId', HasUndauntedAdminApiKey, (req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.json(ModerationInfo(String(req.params.accountId)));
});
undauntedApiRouter.post('/Moderation', HasUndauntedAdminApiKey, (req:any,res)=>{
    try {res.json(SetAccountBan(req.body.accountId,req.body.reason,req.body.active,req.body.address,req.UndauntedUserInfo.UserId));}
    catch(e){const message=e instanceof Error?e.message:'';res.status(400).json({error:['invalid_ban','invalid_address','account_not_found','admin_account_protected','address_not_observed'].includes(message)?message:'moderation_failed'});}
});

function StatusForRollbackError(Error: RollbackError){
    switch(Error){
        case "not_found":
        case "version_not_found":
            return 404;
        case "conflict":
            return 409;
        case "db_error":
            return 500;
    }
}

undauntedApiRouter.get("/RegistrationStatus", (req, res) => {
    res.status(200);
    res.json({
        RegistrationMode: REGISTRATION_MODE
    });
});

undauntedApiRouter.post("/RegistrationStatus", HasUndauntedAdminApiKey, (req, res) => {
    const NewRegistrationStatus = req.body.RegistrationStatus;

    if(!SetRegistrationMode(NewRegistrationStatus)){
        res.status(400);
        res.send();
        return;
    }

    res.status(200);
    res.send();
});

undauntedApiRouter.get("/InviteCodes", HasUndauntedAdminApiKey, async (req, res) => {
    const InviteCodes = await GetInviteCodes();

    res.status(200);
    res.json({
        InviteCodes: InviteCodes
    });
});

undauntedApiRouter.post("/GenerateJWTForUserId", HasUndauntedAdminApiKey, async (req, res) => {
    const UserId = req.body.UserId;

    const JWT = await SignMetagameJWTForUid(UserId);

    res.status(200);
    res.send({
        JWT: JWT
    });
});

undauntedApiRouter.get("/GetAllUsers", HasUndauntedAdminApiKey, async (req, res) => {
    const AllUsers = await GetAllUserIds();

    res.status(200);
    res.send({
        Users: AllUsers
    });
})

undauntedApiRouter.post("/RegisterInviteCode", HasUndauntedAdminApiKey, async (req, res) => {    
    const NewInviteCode = req.body.NewInviteCode;
    const Uses = req.body.Uses;
    const InfiniteUses = !!req.body.InfiniteUses;

    if(!await RegisterInviteCode(NewInviteCode, Uses, InfiniteUses)){
        res.status(400);
        res.send();
        return;
    }

    res.status(200);
    res.send();
});

undauntedApiRouter.delete("/InviteCode/:inviteCodeToDelete", HasUndauntedAdminApiKey, async (req, res) => {
    const InviteCodeToDelete = req.params.inviteCodeToDelete as string;

    await DeleteInviteCode(InviteCodeToDelete);

    res.status(200);
    res.send();
});

// {Username, InviteCode} -> 200 {UUK}. Refusals are JSON: {"error": code, "message": text}
// with 400 username_invalid | registration_closed | bad_request, 401 invite_invalid or
// 409 username_taken. Usernames: 3-16 of [A-Za-z0-9_], unique regardless of case.
undauntedApiRouter.post("/Register", async (req, res) => {
    if(!IsRegistrationMode(REGISTRATION_MODE)){
        res.status(500);
        res.send();
        return;
    }

    const Body = req.body != null && typeof req.body === "object" ? req.body : {};

    const Result = RegisterAccount(REGISTRATION_MODE, Body.Username, Body.InviteCode);

    if(!Result.ok){
        logger.info(`Registration refused: ${Result.Error}`);

        res.status(Result.Status);
        res.json(ErrorBody(Result.Error));
        return;
    }

    logger.info(`Registered ${Result.UserId} as ${Result.Username}`);

    res.status(200);
    res.json({
        UUK: Result.UUK
    });
});

// "Is this name free?" for the launcher's register screen: {available, error?}. It
// answers for the rules and existing accounts only; registering can still lose a race.
undauntedApiRouter.get("/UsernameAvailable", (req, res) => {
    const Username = TrimUsername(req.query.Username);

    if(!IsValidUsername(Username)){
        res.status(200);
        res.json({ available: false, ...ErrorBody("username_invalid") });
        return;
    }

    if(IsUsernameTaken(Username)){
        res.status(200);
        res.json({ available: false, ...ErrorBody("username_taken") });
        return;
    }

    res.status(200);
    res.json({ available: true });
});

// Admin: {uses?: int (default 1), name?: string} -> {"code": "XXXX-XXXX-XXXX"}. The name is
// a note for the host's log ("for Alex") and is not stored.
undauntedApiRouter.post("/CreateInvite", AdminMutationRateLimit, HasUndauntedAdminApiKey, async (req: any, res) => {
    const Body = req.body != null && typeof req.body === "object" ? req.body : {};
    const Uses = Body.uses ?? 1;

    if(!Number.isSafeInteger(Uses) || Uses < 1 || Uses > MAX_INVITE_USES || (Body.name != undefined && typeof Body.name !== "string")){
        res.status(400);
        res.json({ error: "bad_request", message: `uses must be a whole number from 1 to ${MAX_INVITE_USES}, and name a string` });
        return;
    }

    // A clash with an existing code is next to impossible (60 random bits); try again if it happens
    for(let Attempt = 0; Attempt < 5; Attempt++){
        const Code = GenerateInviteCode();

        try{
            if(await RegisterInviteCode(Code, Uses, false)){
                LogInviteCreated(Code, Uses, CleanInviteNote(Body.name), req.UndauntedUserInfo.UserId);

                res.status(200);
                res.json({ code: Code });
                return;
            }
        }
        catch(error){
            logger.warn(`CreateInvite attempt ${Attempt + 1} failed: ${(error as Error).message}`);
        }
    }

    res.status(500);
    res.send();
});

// Admin: {UserId or Username (the current name), NewUsername} -> {UserId, OldUsername, Username}.
// Renames the account and its characters together. The player sees it after logging in again.
undauntedApiRouter.post("/RenameUser", HasUndauntedAdminApiKey, async (req: any, res) => {
    const Body = req.body != null && typeof req.body === "object" ? req.body : {};

    const Result = RenameAccount({ UserId: Body.UserId, Username: Body.Username }, Body.NewUsername);

    if(!Result.ok){
        res.status(Result.Status);
        res.json(ErrorBody(Result.Error));
        return;
    }

    logger.info(`Admin ${req.UndauntedUserInfo.UserId} renamed ${Result.UserId} from ${Result.OldUsername} to ${Result.Username} (${Result.Characters} character(s))`);

    res.status(200);
    res.json({
        UserId: Result.UserId,
        OldUsername: Result.OldUsername,
        Username: Result.Username
    });
});

// Server name, source, registration mode and (for registered players only) who is online
// and which game servers run. Usernames only, never account ids, keys or addresses.
// Without a valid account key or player token (or with a wrong one) the answer has the
// same shape with no players and no servers, and "limited": true; never a 401, so the
// launcher can read it before registering. Each variant is cached 5 s.
undauntedApiRouter.get("/ServerStatus", SoftAccountAuth, async (req, res) => {
    const Status = await GetServerStatus(IsSoftRegisteredCaller(req) ? "full" : "limited");

    res.status(200);
    res.set("Cache-Control", "no-store");
    res.vary("x-undaunted-user-api-key");
    res.vary("authorization");
    res.json(Status);
});

undauntedApiRouter.get("/GetUserInfo", HasUndauntedUserApiKey, async (req: any, res) => {
    res.status(200);
    res.json(req.UndauntedUserInfo);
});


undauntedApiRouter.get("/PrivateOnlineStats", HasUndauntedAdminApiKey, async (req, res) => {
    const PlayerData = await GetRecentPlayerData();

    res.status(200);
    res.json(PlayerData);
});

undauntedApiRouter.get("/PublicOnlineStats", HasUndauntedUserApiKey, async (req, res) => {
    const PlayerData = await GetRecentPlayerData();

    res.status(200);
    res.json({
        NumActivePlayers: PlayerData.length
    });
});

// Saved versions of a player's character data and loadouts (no blobs). ?UserId= or ?CharacterId=
// Kept: the newest SAVE_HISTORY_KEEP (100, ~50 min of play), then the last of each hour
// for SAVE_HISTORY_HOURLY hours (48) and of each day for SAVE_HISTORY_DAILY days (30).
undauntedApiRouter.get("/SaveHistory", HasUndauntedAdminApiKey, async (req, res) => {
    const UserId = req.query.UserId;
    const CharacterId = req.query.CharacterId;

    let CharacterIds: string[];
    if(typeof CharacterId === "string" && CharacterId.length > 0){
        CharacterIds = [CharacterId];
    }
    else if(typeof UserId === "string" && UserId.length > 0){
        CharacterIds = await GetCharacterIdsForUserId(UserId);
    }
    else{
        res.status(400);
        res.send();
        return;
    }

    const Characters = await GetSaveHistory(CharacterIds);

    if(Characters.length === 0){
        res.status(404);
        res.send();
        return;
    }

    res.status(200);
    res.json({
        Characters: Characters
    });
});

// Roll a character's data back to a version listed by /SaveHistory. The player should be offline.
undauntedApiRouter.post("/RollbackCharacter", HasUndauntedAdminApiKey, async (req: any, res) => {
    const CharacterId = req.body.CharacterId;
    const Version = req.body.Version;

    if(typeof CharacterId !== "string" || !Number.isSafeInteger(Version)){
        res.status(400);
        res.send();
        return;
    }

    const Result = RollbackCharacter(CharacterId, Version, req.UndauntedUserInfo.UserId);

    if(!Result.success){
        res.status(StatusForRollbackError(Result.error));
        res.send();
        return;
    }

    res.status(200);
    res.json(Result.data);
});

// Same for loadouts; Version is a loadout version from /SaveHistory
undauntedApiRouter.post("/RollbackLoadout", HasUndauntedAdminApiKey, async (req: any, res) => {
    const CharacterId = req.body.CharacterId;
    const Version = req.body.Version;

    if(typeof CharacterId !== "string" || !Number.isSafeInteger(Version)){
        res.status(400);
        res.send();
        return;
    }

    const Result = RollbackLoadout(CharacterId, Version, req.UndauntedUserInfo.UserId);

    if(!Result.success){
        res.status(StatusForRollbackError(Result.error));
        res.send();
        return;
    }

    res.status(200);
    res.json(Result.data);
});


// Real progression of one account: tracks with the ranks the client will compute,
// objectives, Hunt Pass and entitlements. ?UserId=
undauntedApiRouter.get("/Progression", HasUndauntedAdminApiKey, async (req, res) => {
    const UserId = req.query.UserId;

    if(typeof UserId !== "string" || UserId.length === 0){
        res.status(400);
        res.send();
        return;
    }

    if(!GetDb().transaction((tx) => DoesAccountExist(tx, UserId))){
        res.status(404);
        res.send();
        return;
    }

    const Entitlements = ListEntitlements(UserId);

    res.status(200);
    res.json({
        UserId: UserId,
        RealMode: IsRealProgressionAccount(UserId),
        HuntPass: GetSelectedHuntPass(UserId),
        Tracks: GetTrackRecords(UserId).map((Track) => {
            const Path = GetProgressionPath(Track.progression_id);
            const Gate = PremiumGatingEntitlement(Path);
            const HasPremium = Gate !== "" && Entitlements.some((Entitlement) => Entitlement.name === Gate);

            return {
                ...Track,
                earned_free_rank: Path == undefined ? null : ComputeEarnedRanks(Path, Track.progress, false).EarnedFreeRank,
                earned_premium_rank: Path == undefined ? null : ComputeEarnedRanks(Path, Track.progress, HasPremium).EarnedPremiumRank
            };
        }),
        Objectives: GetObjectiveRecords(UserId),
        Entitlements: Entitlements
    });
});

// Roadmap 2.13, per account: {UserId, Mode: "grandfather" | "fresh"}. grandfather puts
// every track at its max rank, fully confirmed (looks like the stub, grants nothing);
// fresh puts every track at 0 and clears the objectives. The account reads these rows
// in real mode, which is the default (with PROGRESSION_MODE=stub, only the accounts in
// PROGRESSION_REAL_ACCOUNTS do). Do it while the player is offline.
undauntedApiRouter.post("/SeedProgression", HasUndauntedAdminApiKey, async (req: any, res) => {
    const UserId = req.body?.UserId;
    const Mode = req.body?.Mode;

    if(typeof UserId !== "string" || (Mode !== "grandfather" && Mode !== "fresh")){
        res.status(400);
        res.send();
        return;
    }

    const Result = SeedProgression(UserId, Mode, req.UndauntedUserInfo.UserId);

    res.status(Result.Status);

    if(Result.Body === undefined){
        res.send();
        return;
    }

    res.json({
        UserId: UserId,
        Mode: Mode,
        RealMode: IsRealProgressionAccount(UserId),
        Tracks: Result.Body
    });
});

// {UserId, Entitlement, Duration (hours, 0 = permanent)}; answers the account's list
undauntedApiRouter.post("/GrantEntitlement", HasUndauntedAdminApiKey, async (req: any, res) => {
    const UserId = req.body?.UserId;
    const Name = req.body?.Entitlement;
    const Duration = req.body?.Duration ?? 0;

    if(typeof UserId !== "string" || typeof Name !== "string" || Name.length === 0 || !Number.isSafeInteger(Duration) || Duration < 0){
        res.status(400);
        res.send();
        return;
    }

    const Result = GetDb().transaction((tx) => {
        if(!DoesAccountExist(tx, UserId)){
            return undefined;
        }

        const List = GrantEntitlementInTx(tx, UserId, Name, Duration, `admin:${req.UndauntedUserInfo.UserId}`);

        RecordProgressionEvent(tx, {AccountId: UserId, Caller: "admin", Route: "admin GrantEntitlement", Body: req.body, Status: 200, Reply: List});

        return List;
    });

    if(Result == undefined){
        res.status(404);
        res.send();
        return;
    }

    res.status(200);
    res.json({
        UserId: UserId,
        Entitlements: Result
    });
});

// {UserId, Entitlement}. A revoked default entitlement stays revoked until granted again.
undauntedApiRouter.post("/RevokeEntitlement", HasUndauntedAdminApiKey, async (req: any, res) => {
    const UserId = req.body?.UserId;
    const Name = req.body?.Entitlement;

    if(typeof UserId !== "string" || typeof Name !== "string" || Name.length === 0){
        res.status(400);
        res.send();
        return;
    }

    const Result = GetDb().transaction((tx) => {
        if(!DoesAccountExist(tx, UserId)){
            return undefined;
        }

        const Revoked = RevokeEntitlementInTx(tx, UserId, Name);

        RecordProgressionEvent(tx, {AccountId: UserId, Caller: "admin", Route: "admin RevokeEntitlement", Body: req.body, Status: 200, Notes: [Revoked ? "revoked" : "not owned"]});

        return Revoked;
    });

    if(Result == undefined){
        res.status(404);
        res.send();
        return;
    }

    res.status(200);
    res.json({
        UserId: UserId,
        Revoked: Result,
        Entitlements: ListEntitlements(UserId)
    });
});

// ---- Parties and friends by name (roadmap 1.9) ----
// Fallbacks for when the game's own buttons are missing or fail: the key's owner invites a
// player to their party (the friend still accepts in-game through the invite poll), or sends
// them a friend request (accepting one they sent). An admin may act for another player with
// "From" (a name or account id), only directly on the host, never through a proxy. The public
// gateway does not pass these routes (it only lets Register, GetUserInfo, ServerStatus and
// RegistrationStatus through), so in public mode they are used on the server itself.

function ActingAccount(req: any, res: any): { UserId: string, Username: string } | undefined {
    const Caller = req.UndauntedUserInfo as { UserId: string, Username: string, IsAdmin: boolean };
    const From = req.body?.From;

    if(From === undefined){
        return { UserId: Caller.UserId, Username: Caller.Username };
    }

    if(!Caller.IsAdmin){
        res.status(403);
        res.json({ error: "forbidden", message: "Only an admin may act for another player." });
        return undefined;
    }

    if(RefuseAdminKeyThroughProxy(req, res)){
        return undefined;
    }

    const Account = FindAccount(From);

    if(Account === undefined){
        res.status(404);
        res.json(ErrorBody("not_found"));
        return undefined;
    }

    return Account;
}

// {Username, From?} -> 200 {From, To}
undauntedApiRouter.post("/PartyInvite", HasUndauntedUserApiKey, (req: any, res) => {
    const From = ActingAccount(req, res);

    if(From === undefined){
        return;
    }

    const To = FindAccount(req.body?.Username);

    if(To === undefined){
        res.status(404);
        res.json(ErrorBody("not_found"));
        return;
    }

    const Result = InviteToParty(From.UserId, To.UserId, undefined);

    logger.info(`party: /undaunted/api/PartyInvite by key of ${req.UndauntedUserInfo.UserId}: from=${From.UserId} to=${To.UserId} -> ${Result.Status}`);

    if(Result.Status !== 200){
        res.status(Result.Status);
        res.json({ error: "party_invite_refused", message: Result.Reason ?? "The invite was refused." });
        return;
    }

    res.status(200);
    res.json({ From: From.Username, To: To.Username });
});

function FriendErrorMessage(Error: string){
    switch(Error){
        case "blocked": return "One of the two has blocked the other.";
        case "self": return "That is the same account.";
        case "limit": return "Too many friends or requests.";
        case "pending_limit": return "Too many friend requests are still unanswered.";
        case "rate": return "Too many friend requests in the last 10 minutes; try again later.";
        default: return "No such account.";
    }
}

// {Username, From?} -> 200 {From, To, Result: requested | accepted | already_friends | already_requested}
undauntedApiRouter.post("/Friends", HasUndauntedUserApiKey, (req: any, res) => {
    const From = ActingAccount(req, res);

    if(From === undefined){
        return;
    }

    const To = FindAccount(req.body?.Username);

    if(To === undefined){
        res.status(404);
        res.json(ErrorBody("not_found"));
        return;
    }

    const Result = SendOrAcceptFriendRequest(From.UserId, To.UserId);

    if(!Result.ok){
        res.status(Result.Status);
        res.json({ error: Result.Error, message: FriendErrorMessage(Result.Error) });
        return;
    }

    res.status(200);
    res.json({ From: From.Username, To: To.Username, Result: Result.Result });
});

// ---- Guilds by name (roadmap 3.11) ----
// The same kind of fallback for guilds: the key's owner (or, for an admin, "From") invites a player to
// their guild; the invitee still accepts in game (GUILD INVITES). An admin can list every guild and
// disband one by id or name. Host only, like the two above. GUILDS=0 turns them off too.

function GuildsOffReply(res: any){
    if(process.env.GUILDS !== "0"){
        return false;
    }

    res.status(404);
    res.json({ error: "guilds_off", message: "Guilds are turned off on this server (GUILDS=0)." });
    return true;
}

// {Username, From?} -> 200 {From, To, Guild}
undauntedApiRouter.post("/GuildInvite", HasUndauntedUserApiKey, (req: any, res) => {
    if(GuildsOffReply(res)){
        return;
    }

    const From = ActingAccount(req, res);

    if(From === undefined){
        return;
    }

    const To = FindAccount(req.body?.Username);

    if(To === undefined){
        res.status(404);
        res.json(ErrorBody("not_found"));
        return;
    }

    const Result = InviteToGuild(From.UserId, To.UserId);

    logger.info(`guild: /undaunted/api/GuildInvite by key of ${req.UndauntedUserInfo.UserId}: from=${From.UserId} to=${To.UserId} -> ${Result.Status}`);

    if(Result.Status !== 200){
        const Body = Result.Body as { code?: string, message?: string };
        res.status(Result.Status);
        res.json({ error: "guild_refused", message: Body.code ? `${Body.code}: ${Body.message ?? ""}` : Body.message ?? "The invite was refused." });
        return;
    }

    res.status(200);
    res.json({ From: From.Username, To: To.Username, Guild: GuildNameOf(From.UserId) ?? "" });
});

// {Guild: <id or name>} -> 200 {Guild, Members}
undauntedApiRouter.post("/DisbandGuild", HasUndauntedAdminApiKey, (req: any, res) => {
    if(GuildsOffReply(res)){
        return;
    }

    const Result = DisbandGuildAsAdmin(req.body?.Guild);

    if(Result === undefined){
        res.status(404);
        res.json({ error: "not_found", message: "No such guild." });
        return;
    }

    res.status(200);
    res.json({ Guild: Result.Name, Members: Result.Members });
});

// -> [{guildId, name, nameplate, leader, members}]
undauntedApiRouter.get("/Guilds", HasUndauntedAdminApiKey, (req: any, res) => {
    if(GuildsOffReply(res)){
        return;
    }

    res.status(200);
    res.json(ListGuilds());
});

undauntedApiRouter.get('/AccountRecovery/:userId', HealthReadRateLimit, HasUndauntedAdminApiKey, (req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const id=String(req.params.userId);
    if(!/^UID-[A-Za-z0-9-]{1,100}$/.test(id)){res.status(400).end();return;}
    try {res.json({accountId:id,key:RecoverAccountKey(id)});}
    catch {res.status(503).json({error:'recovery_unavailable'});}
});
