import crypto from "node:crypto";
import { logger } from "../logger";
import { DisplayNameForUserId, FindUsernameForUserId, IsAccountIdShape } from "./login";
import { IsBlockedEitherWay, SetBlockHook } from "./friends";

// Parties and party invites (roadmap 1.9; C:\dr\data\plans\parties-friends.md phases 1-2).
//
// In memory, like matchmaking: a party only lives as long as the game sessions around it,
// and the client drops its party itself at login and at character select
// (DELETE /party/member). Every member's client polls POST /party and GET /party/invites
// about every 10 s, so a restart of the metagame just leaves everyone in a party of one.
//
// Reply shapes are the 1.4.4 client's own (read from the exe, see the plan). A party of one
// answers exactly what the old stub answered (the fake candidate included), so a player
// on their own sees no change; only the party id is now a random UUID. PARTY_SOLO_STUB=0
// answers a party of one without the fake candidate instead (see PartyReply).
//
// Invites: a sender may send at most MAX_INVITES_PER_SENDER per INVITE_WINDOW_MS, and cannot
// invite a player again for DECLINE_COOLDOWN_MS after that player declined them. A block drops
// the invites between the two, and invites between blocked players are never listed.
//
// Members that stop polling and stop sending heartbeats for MEMBER_TIMEOUT_MS are dropped,
// and the next member (join order) becomes leader if the leader drops.

export const MAX_PARTY_SIZE = 4;
export const INVITE_TTL_MS = 5 * 60 * 1000;
export const MEMBER_TIMEOUT_MS = 120 * 1000;
// A party candidate (the whole party matchmade onto one server, see controllers/matchmaking.ts)
// stays visible in the party poll until every member was sent to the server and this long
// has passed, or until CANDIDATE_MAX_AGE_MS in any case.
export const CANDIDATE_LINGER_MS = 60 * 1000;
export const CANDIDATE_MAX_AGE_MS = 5 * 60 * 1000;
// A member's own join for the hunt the party is already on is answered from the party's
// last candidate for this long (no second server is started for it)
export const LAST_CANDIDATE_REJOIN_MS = 15 * 60 * 1000;
// A party of one nobody has heard from in this long is forgotten (memory only)
export const IDLE_PARTY_MS = 30 * 60 * 1000;
export const MAX_INVITES_PER_PARTY = 8;
export const MAX_INVITES_PER_RECIPIENT = 10;
export const MAX_STATUS_PLAYER_IDS = 16;
export const MAX_INVITES_PER_SENDER = 20;
export const INVITE_WINDOW_MS = 10 * 60 * 1000;
export const DECLINE_COOLDOWN_MS = 2 * 60 * 1000;

export type CandidateState = "MATCHING" | "IN_PROGRESS";

export type PartyCandidate = {
    Region?: 'main' | 'aus' | 'ger' | 'us',
    CandidateId: string,
    State: CandidateState,
    GameMode: string,
    HuntId: string,
    MemberIds: string[],       // who was taken along, in party order
    Served: Set<string>,       // members already told to travel
    ServedAt?: Map<string, number>, // immutable first travel time for restored entries
    Host?: string,
    Port?: number,
    SessionId?: string,
    AllocatedAt?: number,
    LaunchDeadline?: number,
    CreatedAt: number,
    LastServedAt?: number
};

export type Party = {
    PartyId: string,
    LeaderId: string,
    Members: string[],         // join order, at most MAX_PARTY_SIZE
    CreatedAt: number,
    Candidate: PartyCandidate | null,
    LastCandidate: PartyCandidate | null // the most recent candidate that got a server
};

export type Invite = {
    PartyId: string,
    SendingPlayerId: string,
    RecipientPlayerId: string,
    SendingDisplayName: string,
    CreatedAt: number
};

export type PartyActionResult = { Status: number, Body: unknown, Reason?: string };

const PartiesById = new Map<string, Party>();
const PartyIdByUser = new Map<string, string>();
const InvitesByRecipient = new Map<string, Invite[]>();
// Last time each player was heard from: party polls, invite polls, party actions, heartbeats
const LastSeen = new Map<string, number>();
// What was last logged at info level per player, so the 10 s polls only log changes
const LastPollLogged = new Map<string, string>();
const LastInviteCountLogged = new Map<string, number>();
// Times of each sender's recent invites (sliding window)
const InvitesSentBy = new Map<string, number[]>();
// "<sender>|<recipient>" -> when the recipient declined that sender's invite
const DeclinedBy = new Map<string, number>();

let Clock: () => number = () => Date.now();
let LastGlobalSweep = 0;

export function PartyNow(){
    return Clock();
}

// Tests only: a controllable clock and an empty store
export function SetPartyClockForTests(NewClock?: () => number){
    Clock = NewClock ?? (() => Date.now());
}

export function ResetPartiesForTests(){
    PartiesById.clear();
    PartyIdByUser.clear();
    InvitesByRecipient.clear();
    LastSeen.clear();
    LastPollLogged.clear();
    LastInviteCountLogged.clear();
    InvitesSentBy.clear();
    DeclinedBy.clear();
    LastGlobalSweep = 0;
}

// A new block: the party invites either player sent the other go (friends.ts calls this)
export function DropPartyInvitesBetween(A: string, B: string){
    let Removed = 0;

    for(const [Recipient, Sender] of [[A, B], [B, A]]){
        const List = InvitesByRecipient.get(Recipient) ?? [];
        const Keep = List.filter((TheInvite) => TheInvite.SendingPlayerId !== Sender);

        Removed += List.length - Keep.length;

        if(Keep.length > 0) InvitesByRecipient.set(Recipient, Keep); else InvitesByRecipient.delete(Recipient);
    }

    if(Removed > 0){
        logger.info(`party: ${Removed} invite(s) between ${A} and ${B} removed by a block`);
    }
}

SetBlockHook(DropPartyInvitesBetween);

// Called when a member leaves a party (or the candidate) while the party's candidate still
// counts them in: matchmaking forgets their entry unless they were already sent to the server
let CandidateLeaveHook: (UserId: string, CandidateId: string) => void = () => {};

export function SetCandidateLeaveHook(Hook: (UserId: string, CandidateId: string) => void){
    CandidateLeaveHook = Hook;
}

export function TouchPlayer(UserId: unknown){
    if(IsAccountIdShape(UserId)){
        LastSeen.set(UserId, Clock());
    }
}

function SeenAgo(UserId: string){
    const Seen = LastSeen.get(UserId);

    return Seen === undefined ? Infinity : Clock() - Seen;
}

// Heard from within Ms (party and invite polls, party actions, heartbeats). The game server's guild
// create (controllers/guild.ts) uses it to check that the leader it names is really playing.
export function SeenWithinMs(UserId: string, Ms: number){
    return SeenAgo(UserId) <= Ms;
}

function Seconds(Ms: number){
    return Ms === Infinity ? "ever" : `${Math.round(Ms / 1000)} s`;
}

export function GetPartyOf(UserId: string): Party | undefined {
    const PartyId = PartyIdByUser.get(UserId);

    return PartyId === undefined ? undefined : PartiesById.get(PartyId);
}

export function GetPartyById(PartyId: string): Party | undefined {
    return PartiesById.get(PartyId);
}

function CreateSoloParty(UserId: string): Party {
    const NewParty: Party = {
        PartyId: crypto.randomUUID(),
        LeaderId: UserId,
        Members: [UserId],
        CreatedAt: Clock(),
        Candidate: null,
        LastCandidate: null
    };

    PartiesById.set(NewParty.PartyId, NewParty);
    PartyIdByUser.set(UserId, NewParty.PartyId);

    return NewParty;
}

function RemoveMember(TheParty: Party, UserId: string, Why: string){
    if(!TheParty.Members.includes(UserId)){
        return;
    }

    TheParty.Members = TheParty.Members.filter((Member) => Member !== UserId);

    if(PartyIdByUser.get(UserId) === TheParty.PartyId){
        PartyIdByUser.delete(UserId);
    }

    for(const Candidate of [TheParty.Candidate, TheParty.LastCandidate]){
        if(Candidate != null && Candidate.MemberIds.includes(UserId)){
            Candidate.MemberIds = Candidate.MemberIds.filter((Member) => Member !== UserId);

            if(Candidate === TheParty.Candidate){
                CandidateLeaveHook(UserId, Candidate.CandidateId);
            }
        }
    }

    if(TheParty.Members.length === 0){
        PartiesById.delete(TheParty.PartyId);
        return;
    }

    if(TheParty.LeaderId === UserId){
        TheParty.LeaderId = TheParty.Members[0];
        logger.info(`party: ${TheParty.LeaderId} is now leader of P=${TheParty.PartyId} (${Why})`);
    }

    if(TheParty.Members.length < 2){
        TheParty.Candidate = null;
    }
}

function ExpireCandidate(TheParty: Party){
    const Candidate = TheParty.Candidate;

    if(Candidate == null){
        return;
    }

    const Now = Clock();
    const Remaining = Candidate.MemberIds.filter((Member) => TheParty.Members.includes(Member));
    const AllServed = Remaining.every((Member) => Candidate.Served.has(Member));
    let Why: string | undefined;

    if(Remaining.length === 0){
        Why = "no member left in it";
    }
    else if(AllServed && Candidate.LastServedAt !== undefined && Now - Candidate.LastServedAt > CANDIDATE_LINGER_MS){
        Why = "every member was sent to the server";
    }
    else if(Candidate.State === 'MATCHING' && Candidate.LaunchDeadline !== undefined
        ? Now > Candidate.LaunchDeadline
        : Now - (Candidate.AllocatedAt ?? Candidate.CreatedAt) > CANDIDATE_MAX_AGE_MS){
        Why = "too old";
    }

    if(Why !== undefined){
        TheParty.Candidate = null;
        logger.info(`party: candidate ${Candidate.CandidateId} of P=${TheParty.PartyId} cleared: ${Why}`);
    }
}

// Drops members of a party of 2+ that nobody has heard from (never the caller, and never
// the last one: a party of one is only forgotten after IDLE_PARTY_MS), then expires the
// candidate
function IsLoadingHunt(TheParty: Party, Member: string){
    const Candidate = TheParty.Candidate ?? TheParty.LastCandidate;
    return Candidate?.Served.has(Member) && Candidate.LastServedAt !== undefined && Clock() - Candidate.LastServedAt < 5 * 60 * 1000;
}

function Refresh(TheParty: Party, Caller?: string){
    if(TheParty.Members.length >= 2){
        for(const Member of [...TheParty.Members]){
            if(TheParty.Members.length < 2){
                break;
            }

            if(Member === Caller){
                continue;
            }

            const Ago = SeenAgo(Member);

            if(Ago > MEMBER_TIMEOUT_MS && !IsLoadingHunt(TheParty, Member)){
                logger.info(`party: swept ${Member} from P=${TheParty.PartyId}: not seen for ${Seconds(Ago)} (by=${Caller ?? "sweep"})`);
                RemoveMember(TheParty, Member, "the leader was not seen");
            }
        }
    }

    ExpireCandidate(TheParty);
}

function IsInviteLive(TheInvite: Invite){
    const TheParty = PartiesById.get(TheInvite.PartyId);

    return Clock() - TheInvite.CreatedAt <= INVITE_TTL_MS
        && TheParty !== undefined
        && TheParty.Members.includes(TheInvite.SendingPlayerId)
        && !TheParty.Members.includes(TheInvite.RecipientPlayerId);
}

// The recipient's live invites; an invite between players who blocked each other is dropped here
// too (a block removes them already; this is the safety net, and it makes accepting one a 404)
function LiveInvitesFor(UserId: string){
    const Live = (InvitesByRecipient.get(UserId) ?? []).filter((TheInvite) => IsInviteLive(TheInvite) && !IsBlockedEitherWay(TheInvite.SendingPlayerId, UserId));

    if(Live.length > 0){
        InvitesByRecipient.set(UserId, Live);
    }
    else{
        InvitesByRecipient.delete(UserId);
    }

    return Live;
}

// At most once a minute, from any party call: expire invites, sweep parties, forget idle players
function GlobalSweep(){
    const Now = Clock();

    if(Now - LastGlobalSweep < 60 * 1000){
        return;
    }

    LastGlobalSweep = Now;

    for(const TheParty of [...PartiesById.values()]){
        if(TheParty.Members.length === 1){
            if(SeenAgo(TheParty.Members[0]) > IDLE_PARTY_MS){
                PartiesById.delete(TheParty.PartyId);
                PartyIdByUser.delete(TheParty.Members[0]);
            }
        }
        else{
            Refresh(TheParty);
        }
    }

    for(const Recipient of [...InvitesByRecipient.keys()]){
        LiveInvitesFor(Recipient);
    }

    for(const [UserId, Seen] of [...LastSeen.entries()]){
        if(Now - Seen > IDLE_PARTY_MS && !PartyIdByUser.has(UserId) && !InvitesByRecipient.has(UserId)){
            LastSeen.delete(UserId);
            LastPollLogged.delete(UserId);
            LastInviteCountLogged.delete(UserId);
        }
    }

    for(const Sender of [...InvitesSentBy.keys()]){
        RecentInvitesBy(Sender, Now);
    }

    for(const [Pair, At] of [...DeclinedBy.entries()]){
        if(Now - At >= DECLINE_COOLDOWN_MS) DeclinedBy.delete(Pair);
    }
}

// A sender's invites in the last INVITE_WINDOW_MS (forgets older ones)
function RecentInvitesBy(Sender: string, Now: number){
    const Recent = (InvitesSentBy.get(Sender) ?? []).filter((At) => Now - At < INVITE_WINDOW_MS);

    if(Recent.length > 0) InvitesSentBy.set(Sender, Recent); else InvitesSentBy.delete(Sender);

    return Recent;
}

// ---- Replies ----

// PARTY_SOLO_STUB=0: a party of one answers like a real party that is not queued (no candidate)
function SoloStubOn(){
    return process.env.PARTY_SOLO_STUB !== "0";
}

// POST /party (and the accept and status replies). A party of one keeps the old stub's
// candidate values; a real party sends its real candidate or nulls, otherwise the other
// members would follow the fake candidate.
//
// The client refuses to send a party invite while its party state is not Idle ("Player %s tried
// to send an invite to player %s, but party %s was matchmaking", exe 0x1415b27aa calling
// 0x1415a98c0), and that state is read from the party's candidate. Solo players queue hunts fine
// with the stub (live), but whether the stub's QUEUED_FOR_START also greys out Invite to Party is
// not known yet: PARTY_SOLO_STUB=0 is the switch if it does.
export async function PartyReply(TheParty: Party){
    const Names = await Promise.all(TheParty.Members.map((Member) => DisplayNameForUserId(Member)));

    if(TheParty.Members.length === 1 && SoloStubOn()){
        return {
            candidateId: "CANDIDATE_ID_LOL",
            candidateState: "QUEUED_FOR_START",
            gauntletLevel: null,
            leaderPlayerId: TheParty.LeaderId,
            partyId: TheParty.PartyId,
            playerHuntId: null,
            playerStates: [
                {
                    consoleSessionId: null,
                    displayName: Names[0],
                    isMemberOfCandidate: true,
                    platform: "win",
                    playerId: TheParty.Members[0]
                }
            ]
        };
    }

    const Candidate = TheParty.Candidate;

    return {
        partyId: TheParty.PartyId,
        leaderPlayerId: TheParty.LeaderId,
        playerIds: [...TheParty.Members],
        playerStates: TheParty.Members.map((Member, Index) => ({
            playerId: Member,
            isMemberOfCandidate: Candidate != null && Candidate.MemberIds.includes(Member),
            platform: "win",
            displayName: Names[Index],
            consoleSessionId: null
        })),
        candidateState: Candidate?.State ?? null,
        candidateId: Candidate?.CandidateId ?? null,
        playerHuntId: Candidate?.HuntId ?? null,
        gauntletLevel: null
    };
}

function InviteReply(TheInvite: Invite){
    return {
        recipientPlayerId: TheInvite.RecipientPlayerId,
        sendingPlayerId: TheInvite.SendingPlayerId,
        partyId: TheInvite.PartyId,
        sendingPlatform: "win",
        sendingDisplayName: TheInvite.SendingDisplayName
    };
}

function Describe(TheParty: Party){
    const Candidate = TheParty.Candidate;

    return `P=${TheParty.PartyId} size=${TheParty.Members.length} leader=${TheParty.LeaderId}`
        + (TheParty.Members.length > 1 ? ` members=${TheParty.Members.join(",")}` : "")
        + (Candidate != null ? ` candidate=${Candidate.CandidateId} ${Candidate.State} hunt=${Candidate.HuntId}` : "");
}

function LogPoll(UserId: string, TheParty: Party){
    const Line = `party: poll by=${UserId} ${Describe(TheParty)}`;

    if(LastPollLogged.get(UserId) !== Line){
        LastPollLogged.set(UserId, Line);
        logger.info(Line);
    }
    else{
        logger.debug(Line);
    }
}

// ---- The client's party routes ----

// POST /party: the caller's party, a new party of one if they have none
export async function PollParty(UserId: string){
    GlobalSweep();
    TouchPlayer(UserId);

    const TheParty = GetPartyOf(UserId) ?? CreateSoloParty(UserId);

    Refresh(TheParty, UserId);
    LogPoll(UserId, TheParty);

    return await PartyReply(TheParty);
}

// GET /party/invites
export function ListPartyInvites(UserId: string){
    GlobalSweep();
    TouchPlayer(UserId);

    const Live = LiveInvitesFor(UserId);
    const Line = `party: invites for ${UserId} -> ${Live.length}`;

    if(LastInviteCountLogged.get(UserId) !== Live.length){
        LastInviteCountLogged.set(UserId, Live.length);
        logger.info(Line + (Live.length > 0 ? ` (${Live.map((TheInvite) => `P=${TheInvite.PartyId} from=${TheInvite.SendingPlayerId}`).join("; ")})` : ""));
    }
    else{
        logger.debug(Line);
    }

    return { invitations: Live.map(InviteReply) };
}

// PUT /party/invite {recipientPlayerId, partyId, buildId, featureOverrides}. The client only
// reads the status: 200 {}, or 403/404/409 {}.
export function InviteToParty(CallerId: string, RecipientId: unknown, RequestedPartyId: unknown): PartyActionResult {
    GlobalSweep();
    TouchPlayer(CallerId);

    const Refuse = (Status: number, Why: string): PartyActionResult => {
        logger.info(`party: invite by=${CallerId} to=${IsAccountIdShape(RecipientId) ? RecipientId : "<not an account id>"} refused ${Status}: ${Why}`);
        return { Status: Status, Body: {}, Reason: Why };
    };

    if(!IsAccountIdShape(RecipientId)){
        return Refuse(404, "no recipient");
    }

    if(RecipientId === CallerId){
        return Refuse(409, "cannot invite yourself");
    }

    if(FindUsernameForUserId(RecipientId) === undefined){
        return Refuse(404, "no such account");
    }

    const TheParty = GetPartyOf(CallerId) ?? CreateSoloParty(CallerId);

    Refresh(TheParty, CallerId);

    if(typeof RequestedPartyId === "string" && RequestedPartyId.length > 0 && RequestedPartyId !== TheParty.PartyId){
        logger.info(`party: invite by=${CallerId} names P=${RequestedPartyId.slice(0, 64)} but the caller's party is P=${TheParty.PartyId}; using the caller's own`);
    }

    if(TheParty.LeaderId !== CallerId){
        return Refuse(403, `not the leader of P=${TheParty.PartyId}`);
    }

    if(TheParty.Members.length >= MAX_PARTY_SIZE){
        return Refuse(409, `P=${TheParty.PartyId} is full`);
    }

    if(TheParty.Members.includes(RecipientId)){
        return Refuse(409, "already a member");
    }

    if(IsBlockedEitherWay(CallerId, RecipientId)){
        return Refuse(403, "blocked");
    }

    const Now = Clock();
    const DeclinedAt = DeclinedBy.get(`${CallerId}|${RecipientId}`);

    if(DeclinedAt !== undefined && Now - DeclinedAt < DECLINE_COOLDOWN_MS){
        return Refuse(409, `${RecipientId} declined an invite from ${CallerId} ${Seconds(Now - DeclinedAt)} ago`);
    }

    const Pending = LiveInvitesFor(RecipientId);

    if(Pending.some((TheInvite) => TheInvite.PartyId === TheParty.PartyId)){
        return Refuse(409, "already invited");
    }

    let Outstanding = 0;

    for(const Recipient of InvitesByRecipient.keys()){
        Outstanding += (InvitesByRecipient.get(Recipient) ?? []).filter((TheInvite) => TheInvite.PartyId === TheParty.PartyId && IsInviteLive(TheInvite)).length;
    }

    if(Outstanding >= MAX_INVITES_PER_PARTY){
        return Refuse(409, "too many open invites");
    }

    const Recent = RecentInvitesBy(CallerId, Now);

    if(Recent.length >= MAX_INVITES_PER_SENDER){
        return Refuse(409, `${Recent.length} invites sent in the last ${Seconds(INVITE_WINDOW_MS)}`);
    }

    InvitesSentBy.set(CallerId, [...Recent, Now]);

    Pending.push({
        PartyId: TheParty.PartyId,
        SendingPlayerId: CallerId,
        RecipientPlayerId: RecipientId,
        SendingDisplayName: FindUsernameForUserId(CallerId) ?? "",
        CreatedAt: Clock()
    });

    InvitesByRecipient.set(RecipientId, Pending.slice(-MAX_INVITES_PER_RECIPIENT));

    logger.info(`party: invite P=${TheParty.PartyId} from=${CallerId} to=${RecipientId}`);

    return { Status: 200, Body: {} };
}

// PUT /party/invite/accept/:inviteId. The client puts the invite's partyId in the URL (and in
// body.partyId); in case it is really the sender's id, that is tried second. The answer is
// the joined party, also for an accept repeated after it succeeded.
export async function AcceptPartyInvite(CallerId: string, InviteId: unknown): Promise<PartyActionResult> {
    GlobalSweep();
    TouchPlayer(CallerId);

    const Live = LiveInvitesFor(CallerId);
    let Matched = "partyId";
    let TheInvite = Live.find((Candidate) => Candidate.PartyId === InviteId);

    if(TheInvite === undefined){
        Matched = "sendingPlayerId";
        TheInvite = Live.find((Candidate) => Candidate.SendingPlayerId === InviteId);
    }

    const ShownId = typeof InviteId === "string" ? InviteId.slice(0, 64) : "<none>";

    if(TheInvite === undefined){
        // A repeated accept: the client can send the accept again while it applies the party the first one
        // joined (seen in game by Harmonic, github.com/Harmonicrain/Undaunted 895f7c7). The accepted invite is
        // gone by then, so when the caller already sits in a party of two or more that the id names (its
        // party id, or another member such as the sender), the answer is that party instead of a 404.
        const Current = GetPartyOf(CallerId);

        if(Current !== undefined && typeof InviteId === "string" && InviteId.length > 0){
            Refresh(Current, CallerId);

            if(Current.Members.length > 1 && (Current.PartyId === InviteId || Current.Members.some((Member) => Member !== CallerId && Member === InviteId))){
                logger.info(`party: accept by ${CallerId} id=${ShownId}: already in P=${Current.PartyId} size=${Current.Members.length}; answering that party (a repeated accept)`);
                return { Status: 200, Body: await PartyReply(Current) };
            }
        }

        logger.info(`party: accept by ${CallerId} id=${ShownId}: no such invite (${Live.length} pending)`);
        return { Status: 404, Body: {} };
    }

    const Target = PartiesById.get(TheInvite.PartyId);

    if(Target === undefined){
        logger.info(`party: accept by ${CallerId} matched=${Matched} P=${TheInvite.PartyId}: the party is gone`);
        return { Status: 404, Body: {} };
    }

    Refresh(Target);

    const DropInvitesFromTarget = () => {
        const Remaining = (InvitesByRecipient.get(CallerId) ?? []).filter((Other) => Other.PartyId !== Target.PartyId);

        if(Remaining.length > 0){
            InvitesByRecipient.set(CallerId, Remaining);
        }
        else{
            InvitesByRecipient.delete(CallerId);
        }
    };

    if(Target.Members.includes(CallerId)){
        DropInvitesFromTarget();
        return { Status: 200, Body: await PartyReply(Target) };
    }

    if(!PartiesById.has(Target.PartyId) || Target.Members.length === 0){
        logger.info(`party: accept by ${CallerId} matched=${Matched} P=${TheInvite.PartyId}: the party is gone`);
        return { Status: 404, Body: {} };
    }

    if(Target.Members.length >= MAX_PARTY_SIZE){
        logger.info(`party: accept by ${CallerId} matched=${Matched} P=${Target.PartyId} refused 409: full`);
        return { Status: 409, Body: {} };
    }

    const OldParty = GetPartyOf(CallerId);

    if(OldParty !== undefined){
        RemoveMember(OldParty, CallerId, "the leader joined another party");
    }

    Target.Members.push(CallerId);
    PartyIdByUser.set(CallerId, Target.PartyId);
    DropInvitesFromTarget();

    logger.info(`party: accept by ${CallerId} matched=${Matched} P=${Target.PartyId} size=${Target.Members.length}${OldParty !== undefined && OldParty.PartyId !== Target.PartyId ? ` (left P=${OldParty.PartyId})` : ""}`);

    return { Status: 200, Body: await PartyReply(Target) };
}

// DELETE /party/invite {sendingPlayerId, recipientPlayerId, partyId}. Declining: the recipient
// is the caller, and both ids carry the invite id; the sender then cannot invite the caller again
// for DECLINE_COOLDOWN_MS. A sender naming someone else as the recipient withdraws the invites it
// sent them. Always 200 {}.
export function DeclinePartyInvites(CallerId: string, Body: any): PartyActionResult {
    TouchPlayer(CallerId);

    const Ids = [Body?.partyId, Body?.sendingPlayerId].filter((Id): Id is string => typeof Id === "string" && Id.length > 0);
    const Recipient = Body?.recipientPlayerId;

    if(Recipient === undefined || Recipient === CallerId){
        const List = InvitesByRecipient.get(CallerId) ?? [];
        const Keep = List.filter((TheInvite) => !(Ids.includes(TheInvite.PartyId) || Ids.includes(TheInvite.SendingPlayerId)));

        if(Keep.length > 0) InvitesByRecipient.set(CallerId, Keep); else InvitesByRecipient.delete(CallerId);

        // The sender of a declined invite waits DECLINE_COOLDOWN_MS before inviting this player again
        for(const TheInvite of List.filter((Entry) => !Keep.includes(Entry))){
            DeclinedBy.set(`${TheInvite.SendingPlayerId}|${CallerId}`, Clock());
        }

        logger.info(`party: decline by=${CallerId} ids=${Ids.map((Id) => Id.slice(0, 64)).join("|") || "<none>"} removed=${List.length - Keep.length}`);
    }
    else if(IsAccountIdShape(Recipient)){
        const List = InvitesByRecipient.get(Recipient) ?? [];
        const Keep = List.filter((TheInvite) => !(TheInvite.SendingPlayerId === CallerId && (Ids.length === 0 || Ids.includes(TheInvite.PartyId) || Ids.includes(TheInvite.SendingPlayerId))));

        if(Keep.length > 0) InvitesByRecipient.set(Recipient, Keep); else InvitesByRecipient.delete(Recipient);

        logger.info(`party: withdraw by=${CallerId} to=${Recipient} removed=${List.length - Keep.length}`);
    }

    return { Status: 200, Body: {} };
}

// DELETE /party/member: the caller leaves (the client also sends it at login and at
// character select). The next member in join order leads if the leader left.
export function LeaveParty(CallerId: string): PartyActionResult {
    TouchPlayer(CallerId);

    const TheParty = GetPartyOf(CallerId);

    if(TheParty === undefined){
        logger.debug(`party: leave by=${CallerId}: in no party`);
        return { Status: 200, Body: {} };
    }

    const Size = TheParty.Members.length;

    RemoveMember(TheParty, CallerId, "the leader left");

    const Line = `party: leave by=${CallerId} P=${TheParty.PartyId} size=${Size}->${TheParty.Members.length}${TheParty.Members.length > 0 ? ` leader=${TheParty.LeaderId}` : ""}`;

    if(Size > 1) logger.info(Line); else logger.debug(Line);

    return { Status: 200, Body: {} };
}

// DELETE /party/member/:memberId: the leader removes a member (anyone may name themself)
export function KickPartyMember(CallerId: string, MemberId: string): PartyActionResult {
    if(MemberId === CallerId){
        return LeaveParty(CallerId);
    }

    TouchPlayer(CallerId);

    const TheParty = GetPartyOf(CallerId);

    if(TheParty === undefined || !TheParty.Members.includes(MemberId)){
        logger.info(`party: kick by=${CallerId} member=${MemberId.slice(0, 64)} refused 404: not in the caller's party`);
        return { Status: 404, Body: {} };
    }

    if(TheParty.LeaderId !== CallerId){
        logger.info(`party: kick by=${CallerId} member=${MemberId} refused 403: not the leader of P=${TheParty.PartyId}`);
        return { Status: 403, Body: {} };
    }

    RemoveMember(TheParty, MemberId, "kicked");

    logger.info(`party: kick by=${CallerId} member=${MemberId} ${Describe(TheParty)}`);

    return { Status: 200, Body: {} };
}

// PUT /party/member/promote/:memberId: the leader hands over the lead
export function PromotePartyMember(CallerId: string, MemberId: string): PartyActionResult {
    TouchPlayer(CallerId);

    const TheParty = GetPartyOf(CallerId);

    if(TheParty === undefined || !TheParty.Members.includes(MemberId)){
        logger.info(`party: promote by=${CallerId} member=${MemberId.slice(0, 64)} refused 404: not in the caller's party`);
        return { Status: 404, Body: {} };
    }

    if(TheParty.LeaderId !== CallerId){
        logger.info(`party: promote by=${CallerId} member=${MemberId} refused 403: not the leader of P=${TheParty.PartyId}`);
        return { Status: 403, Body: {} };
    }

    TheParty.LeaderId = MemberId;

    logger.info(`party: promote by=${CallerId} member=${MemberId} ${Describe(TheParty)}`);

    return { Status: 200, Body: {} };
}

// DELETE /party/leader/:leaderId: only the client's auto-eviction of an offline leader sends
// this. Presence never reports anyone offline here, so it is honoured only when the metagame
// has not heard from the leader for MEMBER_TIMEOUT_MS either. Always 200 {}.
export function EvictPartyLeader(CallerId: string, LeaderId: string): PartyActionResult {
    TouchPlayer(CallerId);

    const TheParty = GetPartyOf(CallerId);

    if(TheParty === undefined || TheParty.LeaderId !== LeaderId || LeaderId === CallerId){
        logger.info(`party: leader eviction of ${LeaderId.slice(0, 64)} by=${CallerId} ignored: not the caller's party leader`);
        return { Status: 200, Body: {} };
    }

    const Ago = SeenAgo(LeaderId);

    if(Ago > MEMBER_TIMEOUT_MS && !IsLoadingHunt(TheParty, LeaderId)){
        RemoveMember(TheParty, LeaderId, "the leader was not seen");
        logger.info(`party: leader ${LeaderId} removed by=${CallerId}: not seen for ${Seconds(Ago)}; ${Describe(TheParty)}`);
    }
    else{
        logger.info(`party: leader eviction of ${LeaderId} by=${CallerId} ignored: seen ${Seconds(Ago)} ago`);
    }

    return { Status: 200, Body: {} };
}

// POST /party/status {playerIds}: the parties those players are in, and the caller's own
// invitations (never anyone else's)
export async function PartiesOfPlayers(CallerId: string, PlayerIds: unknown): Promise<PartyActionResult> {
    GlobalSweep();
    TouchPlayer(CallerId);

    const Ids = Array.isArray(PlayerIds) ? [...new Set(PlayerIds.filter(IsAccountIdShape))].slice(0, MAX_STATUS_PLAYER_IDS) : [];
    const Found = new Map<string, Party>();

    for(const Id of Ids){
        const TheParty = GetPartyOf(Id);

        if(TheParty !== undefined){
            Refresh(TheParty, Id === CallerId ? CallerId : undefined);

            if(PartiesById.has(TheParty.PartyId) && TheParty.Members.length > 0){
                Found.set(TheParty.PartyId, TheParty);
            }
        }
    }

    const Parties = await Promise.all([...Found.values()].map(PartyReply));

    logger.info(`party: status by=${CallerId} asked=${Ids.length} parties=${Parties.length}`);

    return { Status: 200, Body: { parties: Parties, invitations: LiveInvitesFor(CallerId).map(InviteReply) } };
}

// ---- For matchmaking (controllers/matchmaking.ts) ----

// The caller's party, refreshed, before a join is matched
export function PartyForMatchmaking(UserId: string){
    GlobalSweep();
    TouchPlayer(UserId);

    const TheParty = GetPartyOf(UserId);

    if(TheParty !== undefined){
        Refresh(TheParty, UserId);
    }

    return TheParty;
}

export function SetPartyCandidate(TheParty: Party, Candidate: PartyCandidate){
    TheParty.Candidate = Candidate;
}

// The deploy server answered for a candidate: members' polls now show IN_PROGRESS
export function MarkPartyCandidateReady(TheParty: Party, CandidateId: string, Host: string, Port: number){
    const Candidate = TheParty.Candidate;

    if(Candidate != null && Candidate.CandidateId === CandidateId){
        Candidate.State = "IN_PROGRESS";
        Candidate.Host = Host;
        Candidate.Port = Port;
        TheParty.LastCandidate = Candidate;
    }
}

export function ClearPartyCandidate(TheParty: Party, CandidateId: string, Why: string){
    if(TheParty.Candidate?.CandidateId === CandidateId){
        TheParty.Candidate = null;
        logger.info(`party: candidate ${CandidateId} of P=${TheParty.PartyId} cleared: ${Why}`);
    }
}

// A member was told to travel to the candidate's server
export function MarkPartyCandidateServed(UserId: string, CandidateId: string, FirstSentAt = Clock()){
    const Candidate = GetPartyOf(UserId)?.Candidate;

    if(Candidate != null && Candidate.CandidateId === CandidateId){
        if(!Candidate.Served.has(UserId)){
            Candidate.Served.add(UserId);
            Candidate.ServedAt ??= new Map<string, number>();
            Candidate.ServedAt.set(UserId, FirstSentAt);
            Candidate.LastServedAt = Clock();
        }
    }
}

// A member leaves the candidate but stays in the party (DELETE /candidate or /candidate/leave)
export function RemoveFromPartyCandidate(UserId: string, CandidateId: string){
    const TheParty = GetPartyOf(UserId);
    const Candidate = TheParty?.Candidate;

    if(TheParty !== undefined && Candidate != null && Candidate.CandidateId === CandidateId){
        Candidate.MemberIds = Candidate.MemberIds.filter((Member) => Member !== UserId);
        ExpireCandidate(TheParty);
    }
}
