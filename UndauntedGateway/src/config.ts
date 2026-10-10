import net from "node:net";
import path from "node:path";
import { BucketSpec, ParseBucketSpec } from "./ratelimit";

export type Endpoint = { host: string; port: number };

export type GatewayLimits = {
    maxBodyBytes: number;
    maxConnections: number;
    maxConnectionsPerIp: number;
    maxHeadersCount: number;
    rate: {
        general: BucketSpec;
        content: BucketSpec;
        register: BucketSpec;
        token: BucketSpec;
        // WebSocket upgrades: the game's chat connection.
        ws: BucketSpec;
        // New TCP connections (each costs a TLS handshake).
        connect: BucketSpec;
    };
};

export type GatewayTimeouts = {
    handshakeMs: number;
    headersMs: number;
    requestMs: number;
    keepAliveMs: number;
    idleMs: number;
    upstreamIdleMs: number;
    wsIdleMs: number;
    shutdownGraceMs: number;
    checkIntervalMs: number;
};

export type GatewayConfig = {
    bindHost: string;
    port: number;
    certFile: string;
    keyFile: string;
    secret: string;
    metagame: Endpoint;
    content: Endpoint;
    ws: Endpoint;
    allowlist: { url: string; secret: string; refreshMs: number; timeoutMs: number; additionalUrls?: string[] } | undefined;
    limits: GatewayLimits;
    timeouts: GatewayTimeouts;
};

// Sized from the metagame logs and bodies.log of real 1.4.4 sessions; README.md has the numbers.
export const DEFAULT_LIMITS: GatewayLimits = {
    maxBodyBytes: 128 * 1024,
    maxConnections: 2048,
    maxConnectionsPerIp: 128,
    maxHeadersCount: 100,
    rate: {
        general: { burst: 300, perMinute: 180 },
        content: { burst: 600, perMinute: 600 },
        register: { burst: 5, perMinute: 0.2 },
        token: { burst: 10, perMinute: 1 },
        // The game reconnects its chat at most every 15-45 s after a failure; a few players behind one
        // address fit many times over.
        ws: { burst: 20, perMinute: 12 },
        connect: { burst: 200, perMinute: 300 },
    },
};

export const DEFAULT_TIMEOUTS: GatewayTimeouts = {
    handshakeMs: 10_000,
    headersMs: 10_000,
    requestMs: 30_000,
    keepAliveMs: 65_000,
    idleMs: 120_000,
    upstreamIdleMs: 120_000,
    wsIdleMs: 300_000,
    shutdownGraceMs: 10_000,
    checkIntervalMs: 1_000,
};

function Int(Env: NodeJS.ProcessEnv, Name: string, Default: number, Min: number, Max: number): number {
    const Raw = Env[Name];
    if(Raw === undefined || Raw.trim() === ""){
        return Default;
    }
    const Value = Number(Raw);
    if(!Number.isInteger(Value) || Value < Min || Value > Max){
        throw new Error(`${Name} must be a whole number from ${Min} to ${Max}`);
    }
    return Value;
}

function Optional(Env: NodeJS.ProcessEnv, Name: string): string | undefined {
    const Raw = Env[Name];
    return Raw === undefined || Raw.trim() === "" ? undefined : Raw.trim();
}

export function IsLoopbackHost(Host: string): boolean {
    if(Host === "localhost"){
        return true;
    }
    if(net.isIPv4(Host)){
        return Host.startsWith("127.");
    }
    return Host === "::1" || Host === "[::1]";
}

// Upstreams are plain http:// on this machine only: the gateway secret header must never leave it.
export function ParseLoopbackUrl(Text: string, Name: string): Endpoint {
    let Parsed: URL;
    try{
        Parsed = new URL(Text);
    }
    catch{
        throw new Error(`${Name} is not a URL`);
    }
    if(Parsed.protocol !== "http:"){
        throw new Error(`${Name} must be an http:// URL on this machine`);
    }
    const Host = Parsed.hostname.replace(/^\[|\]$/g, "");
    if(!IsLoopbackHost(Host)){
        throw new Error(`${Name} must point at 127.0.0.1 or ::1 (got ${Parsed.hostname})`);
    }
    if(Parsed.pathname !== "/" || Parsed.search !== "" || Parsed.username !== "" || Parsed.password !== ""){
        throw new Error(`${Name} must be just http://host:port`);
    }
    return { host: Host, port: Parsed.port === "" ? 80 : Number(Parsed.port) };
}

// Shared secrets travel in headers: printable ASCII without spaces, long enough not to guess.
export function CheckSecret(Value: string | undefined, Name: string): string {
    if(Value === undefined){
        throw new Error(`${Name} is not set`);
    }
    if(!/^[\x21-\x7e]{32,256}$/.test(Value)){
        throw new Error(`${Name} must be 32 to 256 printable characters without spaces (for example 64 hex characters)`);
    }
    return Value;
}

export function LoadGatewayConfig(Env: NodeJS.ProcessEnv = process.env): GatewayConfig {
    const BindHost = Optional(Env, "GATEWAY_BIND") ?? "0.0.0.0";
    if(net.isIP(BindHost) === 0){
        throw new Error(`GATEWAY_BIND must be an IP address (got ${JSON.stringify(BindHost)})`);
    }

    const CertFile = Optional(Env, "GATEWAY_CERT");
    const KeyFile = Optional(Env, "GATEWAY_KEY");
    if(CertFile === undefined || KeyFile === undefined){
        throw new Error("GATEWAY_CERT and GATEWAY_KEY must name the PEM certificate and key (make them with tools/make-cert.js)");
    }

    const AllowlistSecret = Optional(Env, "ALLOWLIST_SECRET");
    const FeedOff = Env.GATEWAY_ALLOWLIST === "0";

    const Rate = (Name: string, Default: BucketSpec): BucketSpec => {
        const Raw = Optional(Env, Name);
        return Raw === undefined ? Default : ParseBucketSpec(Raw, Name);
    };

    return {
        bindHost: BindHost,
        port: Int(Env, "GATEWAY_PORT", 443, 1, 65535),
        certFile: path.resolve(CertFile),
        keyFile: path.resolve(KeyFile),
        secret: CheckSecret(Optional(Env, "GATEWAY_SECRET"), "GATEWAY_SECRET"),
        metagame: ParseLoopbackUrl(Optional(Env, "GATEWAY_METAGAME_URL") ?? "http://127.0.0.1:61000", "GATEWAY_METAGAME_URL"),
        content: ParseLoopbackUrl(Optional(Env, "GATEWAY_CONTENT_URL") ?? "http://127.0.0.1:61002", "GATEWAY_CONTENT_URL"),
        ws: ParseLoopbackUrl(Optional(Env, "GATEWAY_WS_URL") ?? "http://127.0.0.1:61099", "GATEWAY_WS_URL"),
        // Without the feed nobody's game ports open, so a missing secret is an error, not a silent off.
        allowlist: FeedOff ? undefined : {
            url: (() => {
                const Url = Optional(Env, "ALLOWLIST_URL") ?? "http://127.0.0.1:61005";
                const Point = ParseLoopbackUrl(Url, "ALLOWLIST_URL");
                return `http://${Point.host.includes(":") ? `[${Point.host}]` : Point.host}:${Point.port}`;
            })(),
            secret: (() => {
                if(AllowlistSecret === undefined){
                    throw new Error("ALLOWLIST_SECRET is not set (the allowlist helper's secret; GATEWAY_ALLOWLIST=0 runs without the feed, and then no game ports open for anyone)");
                }
                return CheckSecret(AllowlistSecret, "ALLOWLIST_SECRET");
            })(),
            refreshMs: Int(Env, "GATEWAY_ALLOWLIST_REFRESH_SECONDS", 60, 5, 540) * 1000,
            timeoutMs: 3_000,
            additionalUrls: (() => {
                const Urls = (Optional(Env, "ALLOWLIST_ADDITIONAL_URLS") ?? "").split(",").map(Value => Value.trim()).filter(Boolean);
                if (Urls.length > 4) throw new Error("At most four additional allowlist helpers are supported");
                return Urls.map(Url => {
                    const Point = ParseLoopbackUrl(Url, "ALLOWLIST_ADDITIONAL_URLS");
                    return `http://${Point.host.includes(":") ? `[${Point.host}]` : Point.host}:${Point.port}`;
                });
            })(),
        },
        limits: {
            maxBodyBytes: Int(Env, "GATEWAY_MAX_BODY_BYTES", DEFAULT_LIMITS.maxBodyBytes, 1024, 64 * 1024 * 1024),
            maxConnections: Int(Env, "GATEWAY_MAX_CONNECTIONS", DEFAULT_LIMITS.maxConnections, 1, 100_000),
            maxConnectionsPerIp: Int(Env, "GATEWAY_MAX_CONNECTIONS_PER_IP", DEFAULT_LIMITS.maxConnectionsPerIp, 1, 100_000),
            maxHeadersCount: DEFAULT_LIMITS.maxHeadersCount,
            rate: {
                general: Rate("GATEWAY_RATE_GENERAL", DEFAULT_LIMITS.rate.general),
                content: Rate("GATEWAY_RATE_CONTENT", DEFAULT_LIMITS.rate.content),
                register: Rate("GATEWAY_RATE_REGISTER", DEFAULT_LIMITS.rate.register),
                token: Rate("GATEWAY_RATE_TOKEN", DEFAULT_LIMITS.rate.token),
                ws: Rate("GATEWAY_RATE_WS", DEFAULT_LIMITS.rate.ws),
                connect: Rate("GATEWAY_RATE_CONNECT", DEFAULT_LIMITS.rate.connect),
            },
        },
        timeouts: {
            handshakeMs: Int(Env, "GATEWAY_HANDSHAKE_TIMEOUT_MS", DEFAULT_TIMEOUTS.handshakeMs, 1000, 120_000),
            headersMs: Int(Env, "GATEWAY_HEADERS_TIMEOUT_MS", DEFAULT_TIMEOUTS.headersMs, 1000, 120_000),
            requestMs: Int(Env, "GATEWAY_REQUEST_TIMEOUT_MS", DEFAULT_TIMEOUTS.requestMs, 1000, 600_000),
            keepAliveMs: Int(Env, "GATEWAY_KEEPALIVE_TIMEOUT_MS", DEFAULT_TIMEOUTS.keepAliveMs, 1000, 600_000),
            idleMs: Int(Env, "GATEWAY_IDLE_TIMEOUT_MS", DEFAULT_TIMEOUTS.idleMs, 1000, 3_600_000),
            upstreamIdleMs: Int(Env, "GATEWAY_UPSTREAM_IDLE_TIMEOUT_MS", DEFAULT_TIMEOUTS.upstreamIdleMs, 1000, 3_600_000),
            wsIdleMs: Int(Env, "GATEWAY_WS_IDLE_TIMEOUT_MS", DEFAULT_TIMEOUTS.wsIdleMs, 1000, 86_400_000),
            shutdownGraceMs: Int(Env, "GATEWAY_SHUTDOWN_GRACE_MS", DEFAULT_TIMEOUTS.shutdownGraceMs, 0, 300_000),
            checkIntervalMs: DEFAULT_TIMEOUTS.checkIntervalMs,
        },
    };
}
