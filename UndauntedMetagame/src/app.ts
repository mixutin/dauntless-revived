import express from "express";
import {keyRotationRouter} from './routes/keyrotation';
import {CheckPlayerAccess} from './controllers/moderation';
import { TrackBackendHealth } from './middleware/BackendHealth';
import { loginRouter } from "./routes/login.js";
import { logger } from "./logger.js";
import { eosRouter } from "./routes/eos.js";
import { systemRouter } from "./routes/system.js";
import { escalationRouter } from "./routes/escalation.js";
import { friendsRouter } from "./routes/friends.js";
import { characterRouter } from "./routes/character.js";
import { inventoryRouter } from "./routes/inventory.js";
import { storeRouter } from "./routes/store.js";
import { guildRouter } from "./routes/guild.js";
import { tuningRouter } from "./routes/tuning.js";
import { trialsRouter } from "./routes/trials.js";
import { matchmakingRouter } from "./routes/matchmaking.js";
import { partyRouter } from "./routes/party.js";
import { slayerLinksRouter } from "./routes/slayerlinks.js";
import { progressionRouter } from "./routes/progression.js";
import { loadoutRouter } from "./routes/loadout.js";
import { undauntedApiRouter } from "./routes/undauntedapi.js";
import { DescribeOrigin, RefuseProxiedInDevAuthMode } from "./middleware/RequestOrigin.js";
import { BodyLog, Redact } from "./middleware/BodyLog.js";
import { backupRouter } from './routes/backup';

export const app = express();
app.use(TrackBackendHealth);
// Keep discovery reachable so a banned launcher can display the actual reason.
app.use((req,res,next)=>{if(/^\/undaunted\/api\/ServerStatus\/?$/i.test(req.path) || CheckPlayerAccess(req,res))next();});

// Development logins (AUTH_MODE=NONE) never answer anything relayed by the gateway or
// another proxy; a no-op with AUTH_MODE=APIKEY. See middleware/RequestOrigin.ts.
app.use(RefuseProxiedInDevAuthMode);

app.use(express.json({ limit: "50mb" }));

app.use(express.urlencoded({ extended: true }));

// Request trace. Upstream only logged unstubbed routes, which left no way to
// see how far a client got before it stalled. `gs=1` marks calls made by a
// game-server process (they carry the gameserver API key) rather than a player.
// Never write credentials to the log: some routes carry a JWT in the path
// (e.g. DELETE /account/api/oauth/sessions/kill/<token>); see Redact.
// Record the proxy category only; player addresses must not persist in request logs.
if (process.env.LOG_REQUESTS !== "0") {
    app.use((req, _res, next) => {
        logger.info(`${req.method} ${Redact(req.path)} gs=${req.headers["x-undaunted-gameserver-apikey"] ? 1 : 0}${DescribeOrigin(req)}`);
        next();
    });
}

// Body capture for the save routes that are still stubbed or missing, so we record what the game
// actually sends before building on it. Off unless LOG_BODIES=1; one JSON object per line in
// BODY_LOG_FILE (default ./bodies.log) with the answer's status and duration, credentials removed.
// See middleware/BodyLog.ts. The guild, account mapping and account info bodies hold account ids and
// guild names only.
if (process.env.LOG_BODIES === "1") {
    app.use(BodyLog(process.env.BODY_LOG_FILE || "bodies.log"));
}

app.use("/", loginRouter);
app.use("/", keyRotationRouter);
app.use("/", backupRouter);
app.use("/", eosRouter);
app.use("/", systemRouter);
app.use("/", escalationRouter);
app.use("/", friendsRouter);
app.use("/", characterRouter);
app.use("/", inventoryRouter);
app.use("/", storeRouter);
app.use("/", guildRouter);
app.use("/", tuningRouter);
app.use("/", trialsRouter);
app.use("/", matchmakingRouter);
app.use("/", partyRouter);
app.use("/", slayerLinksRouter);
app.use("/", progressionRouter);
app.use("/", loadoutRouter);
app.use("/undaunted/api", undauntedApiRouter); // Everything that I/we add to help manage undaunted that doesn't belong to the game proper belongs here

app.use((req, res) => {
    logger.warn(`Unstubbed route ${req.method} ${req.path}`)

    res.status(404);
    res.send();
});

// Unparseable JSON on the account routes the launcher and host scripts call gets the
// same {"error": "bad_request"} as any other bad body there. Every other route keeps
// Express's default error handling.
const JSON_ERROR_ROUTES = new Set(["/undaunted/api/register", "/undaunted/api/createinvite", "/undaunted/api/renameuser", "/undaunted/api/partyinvite", "/undaunted/api/friends", "/undaunted/api/guildinvite", "/undaunted/api/disbandguild"]);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if(err?.type === "entity.parse.failed" && JSON_ERROR_ROUTES.has(req.path.toLowerCase().replace(/\/+$/, ""))){
        res.status(400);
        res.json({ error: "bad_request", message: "The request body is not valid JSON." });
        return;
    }

    next(err);
});
