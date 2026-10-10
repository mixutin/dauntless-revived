import {cpuAdmission} from '../controllers/cpuadmission';
import { Router } from "express";
import { DescribeGameservers, huntAdmission, Gameservers } from "../controllers/gameservers";
import { NativeOccupancy, NativeCityOccupancy } from '../controllers/nativeoccupancy';
import { DescribeOverflowSnapshot } from '../controllers/overflow';
import { DescribeAusSnapshot } from '../controllers/regions';

export const gameserversRouter = Router();

// 127.0.0.0/8 and ::1, also as IPv4-mapped IPv6
export function IsLoopbackAddress(Address: string | undefined){
    return Address != undefined && (/^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i.test(Address) || Address === "::1");
}

// Headers any proxy (the public-mode gateway included) adds. The metagame never sends them.
const PROXY_HEADERS = ["x-dauntless-gateway", "x-forwarded-for", "forwarded", "x-real-ip", "x-forwarded-host", "x-forwarded-proto", "via"];

// The deploy server has no authentication: only the metagame on this machine may talk to
// it, straight over loopback. A caller elsewhere, or anything relayed by a proxy, gets 403.
export function IsDirectLoopbackRequest(req: { socket?: { remoteAddress?: string }, headers: Record<string, unknown> }){
    return IsLoopbackAddress(req.socket?.remoteAddress) && !PROXY_HEADERS.some((Header) => req.headers[Header] !== undefined);
}

// The running game servers, read-only, for the metagame's /undaunted/api/ServerStatus:
// {servers: [{id, port, kind, map, gameMode, behemoth, huntId, matchmakerHuntId,
// expectedPlayers, maxPlayers, startedAt}]}. The list holds account ids, so it is for
// the metagame on this machine only: the deploy server binds loopback, and this route
// also refuses any caller that is not on loopback.
gameserversRouter.get("/gameservers", async (req, res) => {
    if(!IsDirectLoopbackRequest(req)){
        res.status(403);
        res.send();
        return;
    }

    const [overflow, aus, germany, us] = await Promise.all([DescribeOverflowSnapshot(), DescribeAusSnapshot(), DescribeAusSnapshot('ger'), DescribeAusSnapshot('us')]);
    res.status(200);
    res.json({
        servers: [...DescribeGameservers().map(server => {
            const process=Gameservers.find(s=>s.id===server.id);
            return {...server, connectedPlayers: process ? (process.isRamsgate ? NativeCityOccupancy(process.processId,process.startTime) : NativeOccupancy(process.processId,process.startTime)) : undefined};
        }), ...overflow.servers, ...aus.servers, ...germany.servers, ...us.servers],
        complete: overflow.complete && aus.complete && germany.complete && us.complete,
        capacity: {...huntAdmission.status(), cpu:cpuAdmission.status()}
    });
});
