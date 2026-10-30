import {RecordPlayingAddress} from '../controllers/moderation';
import { Router } from "express";
import { logger } from "../logger";
import { HasUndauntedMetagameAuth } from "../middleware/HasUndauntedMetagameAuth";
import { GetActiveHuntPass, GetProgressionConfigPayload } from "../controllers/progressionconfig";
import { UpdatePlayerActivity } from "../controllers/undauntedapi";
import { GetServerIdentity, GetServerName, StatusWelcome } from "../controllers/serverstatus";
import { IsRealProgressionAccount } from "../controllers/progressionmode";
import { GrantEntitlementInTx, ListEntitlements, RevokeEntitlementInTx } from "../controllers/entitlements";
import { GetSelectedHuntPass, SetSelectedHuntPass } from "../controllers/realprogression";
import { GetCooldownReply, SetCooldownBatch, StartCooldown } from "../controllers/cooldowns";
import { DeleteBounties, GetBountyReply, SetBounties } from "../controllers/bounties";
import { CallerOf, DoesAccountExist, ReadField, ReadInteger, RecordProgressionEvent } from "../controllers/progressionevents";
import { RealProgressionOnly, RefuseForeignPlayer, SendRealReply } from "../middleware/RealProgressionOnly";
import { GetDb } from "../db";
import { TouchPlayer } from "../controllers/party";
import { RefuseUnlessGameserver } from "../middleware/GameServerOnly";
import { TrialsError, UpdateLeaderboardProfile } from "../controllers/trials";
import { BOUNTY_TOKENS_DAILY } from "../controllers/inventory";
import { RecordPlaytimeBeat } from "../controllers/playtime";

export const systemRouter = Router();

// Replies for routes that 404'd since upstream, where the client binary shows an
// empty answer is harmless. MISC_ROUTES=0 puts the 404s back.
function MiscRoutesOn(req: any, res: any, next: any){
	next(process.env.MISC_ROUTES === "0" ? "route" : undefined);
}

// The client reads exactly the first nine fields by name (docs/findings/backend-contract.md),
// so the fields after them are for people and scripts: the server's name and the source it
// runs (roadmap 1.13, the AGPL source link). Nothing about players: this route answers anyone
// (also through the gateway), and who is online, even just how many, is for registered players
// only (GET /undaunted/api/ServerStatus with an account key).
// STATUS_EXTRA=0 answers the nine fields alone, as before. The eight texts are the in-game
// banner: a welcome to the server by its name (SERVER_NAME), one translation per language.
systemRouter.get("/dauntless-status", (req, res) => {
    logger.info("Status");

    const Extra = process.env.STATUS_EXTRA === "0" ? {} : GetServerIdentity();

    res.json({
	    "show-status": true,
	    ...StatusWelcome(GetServerName()),
	    ...Extra
    });
});

systemRouter.post("/heartbeat", HasUndauntedMetagameAuth, async (req: any, res) => {
	const UserId = req.AuthData.userId;

	const UserMap = req.body?.map;

	// A game server's own heartbeat carries no player token: there is no player to record
	// (upstream stored it under the key undefined). A player's heartbeat also keeps them in
	// their party (controllers/party.ts drops members nobody has heard from).
	if(typeof UserId === "string"){
		if(!req.AuthData.IsGameserver){
			RecordPlayingAddress(req,UserId);
			RecordPlaytimeBeat(UserId);
		}
		await UpdatePlayerActivity(UserId, UserMap, req.body?.state);
		TouchPlayer(UserId);
	}

    res.status(200).type("text/plain").send("20000");
});

systemRouter.post("/event", (req, res) => {
    res.status(200);
    res.json({});
});

systemRouter.post("/account/migrate", HasUndauntedMetagameAuth, (req, res) => {
	logger.info("Account migration (stubbed)");

	res.status(200);
	res.json({
		migration_failed: false,
		migration_finished: true
	});
});

systemRouter.post("/profile/update", HasUndauntedMetagameAuth, (req: any, res) => {
    try{
        UpdateLeaderboardProfile(req.AuthData.userId, req.body);
        logger.info(`Updated leaderboard profile for ${req.AuthData.userId}`);
        res.status(200);
        res.send();
    }
    catch(error){
        if(error instanceof TrialsError){
            res.status(error.Status);
            res.json({code: String(error.Status), message: error.message});
            return;
        }

        logger.error(error, "Leaderboard profile update failed");
        res.status(500);
        res.json({code: "500", message: "Leaderboard profile update failed"});
    }
});

systemRouter.get("/vivox/login", HasUndauntedMetagameAuth, (req, res) => {
	logger.info("Vivox login (stubbed)");

	res.status(404);
	res.send();
});

systemRouter.post("/motd/", HasUndauntedMetagameAuth, (req, res) => {
	logger.info("MOTD (stubbed)");

	res.status(204);
	res.send();
});

systemRouter.get("/entitlementsv2", HasUndauntedMetagameAuth, (req: any, res) => {
	// Real mode: the token's account (the game server forwards the player's bearer).
	// A FLAT list, the only unwrapped reply in this area; expired entitlements left out.
	if(IsRealProgressionAccount(req.AuthData.userId)){
		const Entitlements = ListEntitlements(req.AuthData.userId);

		logger.info(`Entitlements of ${req.AuthData.userId}: ${Entitlements.map((Entitlement) => Entitlement.name).join(", ") || "none"}`);

		res.status(200);
		res.json({
			entitlements: Entitlements
		});
		return;
	}

	if(req.AuthData.IsGameserver && req.AuthData.userId === undefined){
		logger.warn("GET /entitlementsv2 from a game server without the player's bearer: no account to look up, answering the stub's empty list");
	}

	logger.info("Entitlements (stubbed)");

	res.status(200);
	res.json({
		code: null,
		message: "OK",
		payload: []
	});
});

systemRouter.post("/entitlementv2/:userId", HasUndauntedMetagameAuth, (req: any, res) => {
	// Real mode: {"entitlement": name, "duration": hours}. The reply REPLACES the game
	// server's cached list for the player, so it is the full list after the grant.
	if(IsRealProgressionAccount(req.params.userId)){
		if(RefuseUnlessGameserver(req, res, "entitlement grant")){
			return;
		}

		const AccountId = req.params.userId;
		const Notes: string[] = [];
		const Name = ReadField(req.body, ["entitlement", "name"], "entitlement name", Notes);
		const DurationRaw = ReadField(req.body, ["duration"], "entitlement duration", Notes);
		let Duration = ReadInteger(DurationRaw, "duration", Notes);

		if(DurationRaw === undefined){
			Notes.push("no duration, taken as permanent");
			Duration = 0;
		}

		const Reply = GetDb().transaction((tx) => {
			const Route = "POST /entitlementv2/:uid";

			if(!DoesAccountExist(tx, AccountId)){
				RecordProgressionEvent(tx, {AccountId, Caller: CallerOf(req), Route, Body: req.body, Status: 404, Notes: [...Notes, "unknown account"]});
				return {Status: 404};
			}

			if(typeof Name !== "string" || Name.length === 0 || Duration === undefined || Duration < 0){
				RecordProgressionEvent(tx, {AccountId, Caller: CallerOf(req), Route, Body: req.body, Status: 400, Notes: [...Notes, "needs an entitlement name and a duration >= 0"]});
				return {Status: 400};
			}

			const Body = {entitlements: GrantEntitlementInTx(tx, AccountId, Name, Duration, "gameserver")};

			RecordProgressionEvent(tx, {AccountId, Caller: CallerOf(req), Route, Body: req.body, Status: 200, Reply: Body, Notes});

			return {Status: 200, Body: Body};
		});

		if(Notes.length > 0 || Reply.Status !== 200){
			logger.warn(`Entitlement grant for ${AccountId} answered ${Reply.Status}: ${Notes.join("; ") || "needs an entitlement name and a duration >= 0"}`);
		}

		SendRealReply(res, Reply);
		return;
	}

	logger.info("Entitlements (stubbed)");

	res.status(200);
	res.json({
		code: null,
		message: "OK",
		payload: []
	});
});

// Status only: the game server never reads the body or touches its cache
systemRouter.delete("/entitlement/:userId/:entitlement", RealProgressionOnly, HasUndauntedMetagameAuth, (req: any, res) => {
	if(RefuseUnlessGameserver(req, res, "entitlement revoke")){
		return;
	}

	const AccountId = req.params.userId;
	const Name = req.params.entitlement;

	GetDb().transaction((tx) => {
		const Revoked = RevokeEntitlementInTx(tx, AccountId, Name);

		RecordProgressionEvent(tx, {AccountId, Caller: CallerOf(req), Route: "DELETE /entitlement/:uid/:name", Status: 200, Notes: [`${Name}${Revoked ? "" : " (not owned)"}`]});
	});

	res.status(200);
	res.json({});
});

systemRouter.get("/playertreatments/:userId", HasUndauntedMetagameAuth, (req, res) => {
	logger.info("Cohorts (stubbed)");

	res.status(200);
	res.json({
		treatments: [
			"CohortTreatment.Dojo.B"
		]
	});
});

// GET and POST /escalation/:escalationSeason/:userId: routes/escalation.ts

systemRouter.get("/eventstats/", HasUndauntedMetagameAuth, (req, res) => {
	logger.info("Event stats (stubbed)");

	res.status(200);
	res.json({
		stats: []
	});
});

systemRouter.get("/progression/config", HasUndauntedMetagameAuth, (req, res) => {
	logger.info("Progression Config (stubbed)");

	res.status(200);
	res.json(GetProgressionConfigPayload());
});

systemRouter.get("/huntpass/:userId", HasUndauntedMetagameAuth, (req: any, res) => {
	// Real mode: the stored selection (payload is a STRING), season09b by default
	if(IsRealProgressionAccount(req.params.userId)){
		if(RefuseForeignPlayer(req, res)){
			return;
		}

		const HuntPass = GetSelectedHuntPass(req.params.userId);

		logger.info(`Huntpass of ${req.params.userId}: ${HuntPass}`);

		res.status(200);
		res.json({
			code: "OK",
			message: "OK",
			payload: HuntPass
		});
		return;
	}

	logger.info("Huntpass (stubbed)");

	res.status(200);
	res.json({
        code: null,
        message: "OK",
        payload: GetActiveHuntPass()
    });
});

systemRouter.post("/huntpass/:userId", RealProgressionOnly, HasUndauntedMetagameAuth, (req: any, res) => {
	if(RefuseUnlessGameserver(req, res, "hunt pass selection")){
		return;
	}

	SendRealReply(res, SetSelectedHuntPass(req.params.userId, req.body, CallerOf(req)));
});

// TODO: Cooldowns might be gameplay-important, impl if so

systemRouter.get("/cooldown/:userId", HasUndauntedMetagameAuth, (req: any, res) => {
	// Real mode: payload is an OBJECT of cooldown id -> ISO start string, int code
	if(IsRealProgressionAccount(req.params.userId)){
		if(RefuseForeignPlayer(req, res)){
			return;
		}

		const Reply = GetCooldownReply(req.params.userId);

		logger.info(`Cooldowns of ${req.params.userId}: ${Object.keys(Reply.payload).length}`);

		res.status(200);
		res.json(Reply);
		return;
	}

	logger.info("Cooldowns (stubbed)");

	res.status(200);
	res.json({
		code: null,
		message: "OK",
		payload: {

		}
	});
});

systemRouter.put("/cooldown/batch/:userId", HasUndauntedMetagameAuth, (req: any, res) => {
	if(IsRealProgressionAccount(req.params.userId)){
		if(RefuseUnlessGameserver(req, res, "cooldown batch")){
			return;
		}

		SendRealReply(res, SetCooldownBatch(req.params.userId, req.body, CallerOf(req)));
		return;
	}

	logger.info("Add Cooldowns (stubbed)");

	res.status(200);
	res.json({
		code: null,
		message: "OK",
		payload: {

		}
	});
});

// After /cooldown/batch/:userId, which it would otherwise swallow. No body: starts now.
systemRouter.put("/cooldown/:userId/:cooldownId", RealProgressionOnly, HasUndauntedMetagameAuth, (req: any, res) => {
	if(RefuseUnlessGameserver(req, res, "cooldown start")){
		return;
	}

	SendRealReply(res, StartCooldown(req.params.userId, req.params.cooldownId, CallerOf(req)));
});

systemRouter.get("/bounty/game-data", HasUndauntedMetagameAuth, (req: any, res) => {
	logger.info("Bounty game data (stubbed)");

	res.status(200);
	res.json({
    code: null,
    message: "OK",
    payload: {
      max_slots: 4,
      num_draft_options: 3,
      num_spicy_options: 1,
      bounty_token_id: "TOKEN_BOUNTY_DRAFT",
      premium_bounty_token_id: "TOKEN_BOUNTY_DRAFT_PREMIUM",
      num_tokens_hp_start: BOUNTY_TOKENS_DAILY,
      num_tokens_per_day: BOUNTY_TOKENS_DAILY,
      bounty_token_grant_hour: 0,
      history_length: 10,
      bronze_count: 9,
      silver_count: 3,
      gold_count: 1,
      new_season_reset_bounties: false,
      bounty_data: [],
      item_grant_data: [],
      token_rollover_warning_days: 1000,
      automatic_draft: false,
      automatic_claim: false,
      delete_claimed_bounties: false,
    },
  });
});

systemRouter.get("/bounty/:userId", HasUndauntedMetagameAuth, (req: any, res) => { // TODO: This masks /bounty/game-data Right now they seem to have compatible schema, but I could be wrong about that.
	// Real mode: the stored board; every bounty carries drafted_timestamp (not zeroed by the client)
	if(IsRealProgressionAccount(req.params.userId)){
		if(RefuseForeignPlayer(req, res)){
			return;
		}

		const Reply = GetBountyReply(req.params.userId);

		logger.info(`Bounties of ${req.params.userId}: ${Reply.payload.bounties.length}`);

		res.status(200);
		res.json(Reply);
		return;
	}

	logger.info("Bounties (stubbed)");

	res.status(200);
	res.json({
		code: null,
		message: "OK",
		payload: {
			bounties: [],
			draft_data: {
				current_draft_choices: [],
    			previous_draft_selections: [],
    			bronze_count: 0,
    			silver_count: 0,
    			gold_count: 0,
			},
			draft_data_daily: {
				current_draft_choices: [],
    			previous_draft_selections: [],
    			bronze_count: 0,
    			silver_count: 0,
    			gold_count: 0,
			},
			draft_data_weekly: {
				current_draft_choices: [],
    			previous_draft_selections: [],
    			bronze_count: 0,
    			silver_count: 0,
    			gold_count: 0,
			}
		}
	})
});

systemRouter.post("/bounty/delete/:userId", RealProgressionOnly, HasUndauntedMetagameAuth, (req: any, res) => {
	if(RefuseUnlessGameserver(req, res, "bounty delete")){
		return;
	}

	SendRealReply(res, DeleteBounties(req.params.userId, req.body, CallerOf(req)));
});

systemRouter.post("/bounty/:userId", HasUndauntedMetagameAuth, (req: any, res) => { // TODO: This masks /bounty/game-data Right now they seem to have compatible schema, but I could be wrong about that.
	// Real mode: a partial upsert by bounty_id; only the status is read by the game server
	if(IsRealProgressionAccount(req.params.userId)){
		if(RefuseUnlessGameserver(req, res, "bounty update")){
			return;
		}

		SendRealReply(res, SetBounties(req.params.userId, req.body, CallerOf(req)));
		return;
	}

	logger.info("Set Bounties (stubbed)");

	res.status(200);
	res.json({
		code: null,
		message: "OK",
		payload: {
			bounties: [],
			draft_data: {
				current_draft_choices: [],
    			previous_draft_selections: [],
    			bronze_count: 0,
    			silver_count: 0,
    			gold_count: 0,
			},
			draft_data_daily: {
				current_draft_choices: [],
    			previous_draft_selections: [],
    			bronze_count: 0,
    			silver_count: 0,
    			gold_count: 0,
			},
			draft_data_weekly: {
				current_draft_choices: [],
    			previous_draft_selections: [],
    			bronze_count: 0,
    			silver_count: 0,
    			gold_count: 0,
			}
		}
	})
});

systemRouter.get("/all/", HasUndauntedMetagameAuth, (req: any, res) => {
	logger.info("Mailbox (stubbed)");

	res.json({
		code: null,
		message: "OK",
		payload: {
			messages: []
		}
	});
});

// After-hunt news. The client always asks for event_name=test; a 204 takes the same
// "no news" path as the old 404 (the empty body fails its parse).
systemRouter.get("/motd/trigger", MiscRoutesOn, (req, res) => {
	res.status(204);
	res.send();
});
