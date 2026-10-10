import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LoadAllowlistConfig } from "../src/allowlist/config";
import { DEFAULT_LIMITS, LoadGatewayConfig } from "../src/config";
import { ParseBucketSpec, RateLimiter } from "../src/ratelimit";
import { RedactTarget, RedactUserAgent } from "../src/redact";

// Made-up, token-shaped values (never real credentials).
const FAKE_JWT = "eyJhbGciOiJSUzI1NiJ9.eyJ1c2VySWQiOiJVSUQtdGVzdCJ9.c2lnbmF0dXJlLW5vdC1yZWFsLXNpZ25hdHVyZS1ub3QtcmVhbA";
const FAKE_KEY = "UUK_" + "0123456789abcdef".repeat(3);

describe("RedactTarget", () => {
    it("removes a JWT from the path (the session-kill route carries one)", () => {
        const Out = RedactTarget(`/account/api/oauth/sessions/kill/${FAKE_JWT}`);
        assert.equal(Out, "/account/api/oauth/sessions/kill/<token>");
    });

    it("removes account keys, long hex and long token-like strings anywhere", () => {
        assert.equal(RedactTarget(`/x/${FAKE_KEY}/y`), "/x/<key>/y");
        assert.equal(RedactTarget(`/x/${"ab".repeat(24)}`), "/x/<redacted>");
        assert.equal(RedactTarget(`/x/${"Az_-".repeat(20)}`), "/x/<redacted>");
        assert.equal(RedactTarget("/progression/UID-00000000-0000-4000-8000-00000000f609"), "/progression/UID-00000000-0000-4000-8000-00000000f609");
    });

    it("redacts sensitive query parameters by name and token-shaped values by shape", () => {
        assert.equal(RedactTarget("/a?accountId=UID-1&key=abc&access_token=zzz&Code=1234"), "/a?accountId=UID-1&key=<redacted>&access_token=<redacted>&Code=<redacted>");
        assert.equal(RedactTarget(`/a?x=${FAKE_JWT}&Username=Slayer`), "/a?x=<token>&Username=Slayer");
    });

    it("catches a percent-encoded token and never lets control characters through", () => {
        const Encoded = FAKE_JWT.replace(/\./g, "%2E");
        assert.ok(!RedactTarget(`/k/${Encoded}`).includes("eyJ"));
        assert.ok(!RedactTarget(`/q?x=${Encoded}`).includes("eyJ"));
        assert.equal(RedactTarget("/a\r\nforged"), "/a??forged");
        assert.ok(RedactTarget("/" + "a".repeat(1000)).length <= 403);
        assert.equal(RedactUserAgent(`UE4 ${FAKE_JWT}`), "UE4 <token>");
    });
});

describe("RateLimiter", () => {
    it("allows the burst, then refills at the rate", () => {
        const Limiter = new RateLimiter({ burst: 3, perMinute: 60 });
        const T0 = 1_000_000;
        assert.equal(Limiter.Take("a", T0).ok, true);
        assert.equal(Limiter.Take("a", T0).ok, true);
        assert.equal(Limiter.Take("a", T0).ok, true);
        const Refused = Limiter.Take("a", T0);
        assert.equal(Refused.ok, false);
        assert.equal(!Refused.ok && Refused.retryAfterSeconds, 1);
        // Another key has its own bucket.
        assert.equal(Limiter.Take("b", T0).ok, true);
        // One per second comes back.
        assert.equal(Limiter.Take("a", T0 + 1000).ok, true);
        assert.equal(Limiter.Take("a", T0 + 1000).ok, false);
        assert.equal(Limiter.Take("a", T0 + 2500).ok, true);
    });

    it("gives slow buckets a long Retry-After and forgets full buckets", () => {
        const Limiter = new RateLimiter({ burst: 1, perMinute: 0.2 });
        assert.equal(Limiter.Take("x", 0).ok, true);
        const Refused = Limiter.Take("x", 0);
        assert.equal(!Refused.ok && Refused.retryAfterSeconds, 300);
        Limiter.Sweep(299_000);
        assert.equal(Limiter.Size, 1);
        Limiter.Sweep(300_100);
        assert.equal(Limiter.Size, 0);
    });

    it("never holds more than MaxKeys peers", () => {
        const Limiter = new RateLimiter({ burst: 5, perMinute: 1 }, 100);
        for(let Index = 0; Index < 1000; Index++){
            Limiter.Take(`k${Index}`, 0);
        }
        assert.ok(Limiter.Size <= 100);
    });

    it("parses <burst>,<per minute>", () => {
        assert.deepEqual(ParseBucketSpec("300,180", "X"), { burst: 300, perMinute: 180 });
        assert.deepEqual(ParseBucketSpec(" 5 , 0.2 ", "X"), { burst: 5, perMinute: 0.2 });
        for(const Bad of ["", "5", "0,1", "-1,2", "a,b", "5,1,2"]){
            assert.throws(() => ParseBucketSpec(Bad, "X"), Bad);
        }
    });
});

describe("gateway configuration", () => {
    const Base = {
        GATEWAY_CERT: "c.pem",
        GATEWAY_KEY: "k.pem",
        GATEWAY_SECRET: "s".repeat(40),
        ALLOWLIST_SECRET: "a".repeat(40),
    };

    it("accepts all four worker tunnels while refusing external helpers", () => {
        const urls = [61015,61025,61035,61045].map(port => `http://127.0.0.1:${port}`);
        assert.deepEqual(LoadGatewayConfig({...Base, ALLOWLIST_ADDITIONAL_URLS:urls.join(',')}).allowlist?.additionalUrls, urls);
        assert.throws(() => LoadGatewayConfig({...Base, ALLOWLIST_ADDITIONAL_URLS:[...urls, 'http://127.0.0.1:61055'].join(',')}), /four/);
        assert.throws(() => LoadGatewayConfig({...Base, ALLOWLIST_ADDITIONAL_URLS:'http://203.0.113.5:61005'}), /127\.0\.0\.1/);
    });

    it("has the documented defaults", () => {
        const Config = LoadGatewayConfig(Base);
        assert.equal(Config.bindHost, "0.0.0.0");
        assert.equal(Config.port, 443);
        assert.deepEqual(Config.metagame, { host: "127.0.0.1", port: 61000 });
        assert.deepEqual(Config.content, { host: "127.0.0.1", port: 61002 });
        assert.deepEqual(Config.ws, { host: "127.0.0.1", port: 61099 });
        assert.equal(Config.allowlist?.url, "http://127.0.0.1:61005");
        assert.equal(Config.allowlist?.refreshMs, 60_000);
        assert.deepEqual(Config.limits, DEFAULT_LIMITS);
        assert.equal(Config.limits.maxBodyBytes, 131072);
    });

    it("refuses missing secrets, weak secrets and upstreams off this machine", () => {
        assert.throws(() => LoadGatewayConfig({ ...Base, GATEWAY_SECRET: undefined }), /GATEWAY_SECRET/);
        assert.throws(() => LoadGatewayConfig({ ...Base, GATEWAY_SECRET: "short" }), /GATEWAY_SECRET/);
        assert.throws(() => LoadGatewayConfig({ ...Base, GATEWAY_SECRET: "has spaces ".repeat(4) }), /GATEWAY_SECRET/);
        assert.throws(() => LoadGatewayConfig({ ...Base, GATEWAY_CERT: undefined }), /GATEWAY_CERT/);
        assert.throws(() => LoadGatewayConfig({ ...Base, ALLOWLIST_SECRET: undefined }), /ALLOWLIST_SECRET/);
        assert.equal(LoadGatewayConfig({ ...Base, ALLOWLIST_SECRET: undefined, GATEWAY_ALLOWLIST: "0" }).allowlist, undefined);
        assert.throws(() => LoadGatewayConfig({ ...Base, GATEWAY_METAGAME_URL: "http://10.0.0.5:61000" }), /127\.0\.0\.1/);
        assert.throws(() => LoadGatewayConfig({ ...Base, GATEWAY_CONTENT_URL: "https://127.0.0.1:61002" }), /http:\/\//);
        assert.throws(() => LoadGatewayConfig({ ...Base, ALLOWLIST_URL: "http://203.0.113.5:61005" }), /127\.0\.0\.1/);
        assert.throws(() => LoadGatewayConfig({ ...Base, GATEWAY_BIND: "example.org" }), /GATEWAY_BIND/);
        assert.throws(() => LoadGatewayConfig({ ...Base, GATEWAY_RATE_REGISTER: "lots" }), /GATEWAY_RATE_REGISTER/);
        assert.deepEqual(LoadGatewayConfig({ ...Base, GATEWAY_RATE_REGISTER: "2,0.5" }).limits.rate.register, { burst: 2, perMinute: 0.5 });
        assert.deepEqual(LoadGatewayConfig(Base).limits.rate.ws, { burst: 20, perMinute: 12 });
        assert.deepEqual(LoadGatewayConfig({ ...Base, GATEWAY_RATE_WS: "5,2" }).limits.rate.ws, { burst: 5, perMinute: 2 });
        assert.throws(() => LoadGatewayConfig({ ...Base, GATEWAY_RATE_WS: "many" }), /GATEWAY_RATE_WS/);
    });
});

describe("allowlist helper configuration", () => {
    const Base = { ALLOWLIST_SECRET: "a".repeat(40), ALLOWLIST_DRY_RUN: "1" };

    it("demands an explicit ALLOWLIST_DRY_RUN", () => {
        assert.throws(() => LoadAllowlistConfig({ ALLOWLIST_SECRET: "a".repeat(40) }), /ALLOWLIST_DRY_RUN/);
        assert.throws(() => LoadAllowlistConfig({ ...Base, ALLOWLIST_DRY_RUN: "yes" }), /ALLOWLIST_DRY_RUN/);
        assert.equal(LoadAllowlistConfig(Base).dryRun, true);
        assert.equal(LoadAllowlistConfig({ ...Base, ALLOWLIST_DRY_RUN: "0" }).dryRun, false);
    });

    it("listens on loopback only and has the documented defaults", () => {
        const Config = LoadAllowlistConfig(Base);
        assert.equal(Config.bindHost, "127.0.0.1");
        assert.equal(Config.port, 61005);
        assert.equal(Config.ttlMs, 600_000);
        assert.equal(Config.minIntervalMs, 3000);
        assert.equal(Config.ports, "8770-8777");
        assert.equal(Config.allowPrivate, false);
        assert.match(Config.powershell, /System32[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i);
        for(const Bind of ["0.0.0.0", "::", "192.168.1.5", "localhost"]){
            assert.throws(() => LoadAllowlistConfig({ ...Base, ALLOWLIST_BIND: Bind }), /ALLOWLIST_BIND/);
        }
        assert.throws(() => LoadAllowlistConfig({ ...Base, ALLOWLIST_SECRET: undefined }), /ALLOWLIST_SECRET/);
        for(const Ports of ["8777-8770", "0-5", "8770-70000", "8770,8771", "any"]){
            assert.throws(() => LoadAllowlistConfig({ ...Base, ALLOWLIST_PORTS: Ports }), /ALLOWLIST_PORTS/, Ports);
        }
    });
});
