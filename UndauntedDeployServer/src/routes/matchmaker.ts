import { Router } from "express";
import { logger } from "../logger";
import { HandleMatchmakingRequest } from "../controllers/matchmaker";
import { CheckMatchmakingRequest } from "../controllers/matchmakinginput";
import { IsDirectLoopbackRequest } from "./gameservers";
import express from "express";
import { CapacityUnavailable } from '../controllers/capacity';

export const matchmakingRouter = Router();

matchmakingRouter.post("/handle-matchmaking-for-player", express.json(), async (req, res) => {
    // Starts game server processes, with no authentication: the metagame on this machine only
    if(!IsDirectLoopbackRequest(req)){
        logger.warn(`Refusing a matchmaking call from ${req.socket.remoteAddress}: only the metagame on this machine may call it`);

        res.status(403);
        res.send();
        return;
    }

    const Body = req.body != null && typeof req.body === "object" ? req.body : {};
    const GameMode = Body.GameMode;
    const GameArgs = Body.GameArgs;
    const HuntId = Body.HuntId;
    const ExpectedPlayers = Body.ExpectedPlayers;
    const Region = Body.Region ?? 'main';
    if (!['main', 'aus', 'ger', 'us', 'mixed'].includes(Region)) { res.status(400).json({error:'invalid_region'}); return; }

    const BadRequest = CheckMatchmakingRequest(GameMode, GameArgs, HuntId, ExpectedPlayers);

    if(BadRequest != undefined){
        logger.warn(`Refusing a matchmaking call: ${BadRequest}`);

        res.status(400);
        res.json({ error: "bad_request", message: BadRequest });
        return;
    }

    let MatchmakingResult;

    try{
        MatchmakingResult = await HandleMatchmakingRequest(GameMode, GameArgs, HuntId, ExpectedPlayers, Region, Body.Overflow === true);
    }
    catch(error){
        if (error instanceof CapacityUnavailable) {
            res.setHeader('Retry-After', '10');
            res.status(503).json({error: 'capacity_unavailable', reason: error.reason});
            return;
        }
        // No free port, or a game server that could not be started: the metagame answers the player FAILED
        logger.error(`Matchmaking for ${GameMode} ${HuntId ?? ""} failed: ${error instanceof Error ? error.message : String(error)}`);

        res.status(500);
        res.json({ error: "no_game_server" });
        return;
    }

    res.status(200);
    res.json(MatchmakingResult);
});
