import { app } from "./app";
import { DrainAndRegisterAPIKeys } from "./controllers/apikeys";
import { DrainAndRegisterUserAPIKeys } from "./controllers/auth";
import { GetDb } from "./db";
import { logger } from "./logger";
import { DescribeProgressionMode } from "./controllers/progressionmode";
import { ProgressionUpgradeNotice } from "./controllers/realprogression";
import { CheckGatewayConfig } from "./middleware/RequestOrigin";
import { StartChat } from "./realtime/chat";
import { DescribeFeatures } from "./features";
import { PruneExpiredStorePurchases } from "./controllers/freestore";
import { CheckProgressionConfig } from "./controllers/progressionconfig";
import { FlushPlaytime } from "./controllers/playtime";
import { SetDailyTokensOnce } from "./controllers/inventory";

const PORT = Number(process.env.PORT);
// Bind to loopback unless told otherwise. Upstream listened on every
// interface, which with REGISTRATION_MODE=OPEN let anyone who could reach the
// machine create an account. Set BIND_HOST to the VPN address (or 0.0.0.0)
// only once invite codes are on.
const BIND_HOST = process.env.BIND_HOST || "127.0.0.1";

// Public mode (GATEWAY_SECRET set): the metagame sits behind UndauntedGateway on loopback.
// Nothing is checked or logged here when GATEWAY_SECRET is unset.
const Gateway = CheckGatewayConfig();

for(const Warning of Gateway.Warnings){
  logger.warn(Warning);
}

if(Gateway.Errors.length > 0){
  for(const Error of Gateway.Errors){
    logger.fatal(Error);
  }

  process.exit(1);
}

// The progression config (the Hunt Pass seasons and mastery tracks; PROGRESSION_CONFIG_DIR, ACTIVE_HUNT_PASS):
// a bad folder, file or season stops the start here, not at a player's first request
let ProgressionConfig: string;

try {
  ProgressionConfig = CheckProgressionConfig();
} catch (error) {
  logger.fatal(`The progression config could not be loaded: ${(error as Error).message}`);
  process.exit(1);
}

GetDb(); // This runs migrations TODO make this more explicit

// Daily token stacks set to the daily amounts once (controllers/inventory.ts)
try {
  const Changed = SetDailyTokensOnce();

  if (Changed !== undefined) {
    logger.info(`Daily tokens: set ${Changed} character(s) to the daily amounts (one time)`);
  }
} catch (error) {
  logger.warn(error, "Could not set the daily token stacks");
}

// Store purchase tokens that expired without being redeemed, and old receipts (also at most once an hour
// when a token is issued; the lines are logged there)
try {
  PruneExpiredStorePurchases();
} catch (error) {
  logger.warn(error, "Could not remove the expired store purchase tokens");
}

let Stopping = false;
let Shutdown: Promise<void> | undefined;
let Chat: Awaited<ReturnType<typeof StartChat>>;
let Server: ReturnType<typeof app.listen> | undefined;

const Startup = DrainAndRegisterAPIKeys().then(async () => {
  await DrainAndRegisterUserAPIKeys();
  if (Stopping) return;

  // Text chat (roadmap 3.10, docs/findings/chat.md): on by default, CHAT=0 opts out. A bad setting or a
  // port in use is one error line; the metagame always starts, with or without chat.
  Chat = await StartChat();
  if (Stopping) return;

  if (Chat !== undefined) {
    // Ctrl+C or a stop signal: tell the chat sessions first (at most 1 s), then stop as before
    for (const Signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(Signal, () => {
        void shutdown().catch(() => undefined).finally(() => process.kill(process.pid, Signal));
      });
    }
  }

  // Express 5 hands bind failures to this callback. Upstream ignored the
  // argument and announced success anyway, so a port already taken by another
  // program (ShadowUSB, part of the Shadow client app on the host PC, listens
  // on 127.0.0.1:60000) printed "Clear Skies" and then the process quietly
  // exited, leaving clients connected to the wrong program and hanging forever.
  await new Promise<void>((Resolve) => {
    Server = app.listen(PORT, BIND_HOST, (err?: Error) => {
      if (err) {
        logger.fatal(`Could not listen on ${BIND_HOST}:${PORT}: ${err.message}`);
        process.exit(1);
      }
      logger.info(`Dauntless Revived metagame on ${BIND_HOST}:${PORT}`);
      logger.info(`Progression mode: ${DescribeProgressionMode()}`);
      logger.info(`Progression config: ${ProgressionConfig}`);
      logger.info(DescribeFeatures());
      try {
        const UpgradeNotice = ProgressionUpgradeNotice();
        if (UpgradeNotice !== undefined) {
          logger.warn(UpgradeNotice);
        }
      } catch (error) {
        logger.warn(error, "Could not count the accounts without stored progression");
      }
      if (Gateway.Enabled) {
        logger.info(`Public mode: behind the gateway (player addresses from loopback callers that carry the gateway secret)`);
      }
      logger.info(`Clear Skies, Slayer.`);
      Resolve();
    });
  });
});

// Wait for startup to settle before closing: a late chat/listen completion must not
// reopen a port after the Launcher has already finished stopping this service.
export function shutdown(): Promise<void> {
  Stopping = true;
  return Shutdown ??= (async () => {
    await Startup;
    const Closing = Server === undefined ? Promise.resolve() : new Promise<void>((Resolve, Reject) => {
      const Http = Server!;
      // Give in-flight requests a chance to finish, but stay within the runner's stop deadline.
      const Deadline = setTimeout(() => Http.closeAllConnections(), 2000);
      Deadline.unref();
      Http.close((Error) => {
        clearTimeout(Deadline);
        if (Error) Reject(Error);
        else Resolve();
      });
    });
    await Promise.all([Closing, Chat?.close()]);
    FlushPlaytime();
    GetDb().$client.close();
  })();
}
