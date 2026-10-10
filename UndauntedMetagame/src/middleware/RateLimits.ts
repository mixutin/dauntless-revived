import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import { ClientAddressOf } from "./RequestOrigin";

// Only the authenticated loopback gateway may supply a forwarded client IP.
// Keep Express trust proxy disabled; direct callers cannot choose their own bucket.
export const ClientRateLimitKey = (req: Request) => ipKeyGenerator(ClientAddressOf(req));

const Reply = { error: "rate_limited", message: "Too many requests; try again later." };

// Authenticated players have separate buckets. Native reward batches are not
// pooled behind one gateway-address quota.
export const PlayerMutationRateLimit = rateLimit({
    keyGenerator: req => `account:${(req as any).AuthData.userId}`,
    skip: req => (req as any).AuthData?.IsGameserver === true,
    windowMs: 60000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, message: Reply
});

// Independent from mutations so dashboard polling cannot consume the admin write allowance.
export const HealthReadRateLimit = rateLimit({keyGenerator: ClientRateLimitKey, windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false, message: Reply});

// Failed login exchanges are the useful signal here. Successful game logins do not consume the
// allowance, so reconnecting clients cannot lock one another out behind the same public address.
export const LoginRateLimit = rateLimit({
    keyGenerator: ClientRateLimitKey,
    windowMs: 10 * 60 * 1000,
    limit: 30,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: Reply
});

// The 1.4.4 client verifies its token about once every 30 seconds. Keep ample room for reconnects
// and multiple local clients while still bounding unauthenticated polling of the authorization route.
export const TokenVerifyRateLimit = rateLimit({
    keyGenerator: ClientRateLimitKey,
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: Reply
});

// Direct host/admin mutations get a deliberately generous ceiling. This prevents an accidentally
// looping or brute-force caller without changing normal administration and migration workflows.
export const AdminMutationRateLimit = rateLimit({
    keyGenerator: ClientRateLimitKey,
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: Reply
});
