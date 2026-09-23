---
title: HTTP API
parent: Reference
nav_order: 3
description: "Every HTTP route of the Dauntless Revived metagame, deploy server, content server and gateway, with who may call it and what the internet can reach."
lang: en
ref: reference/api
---

{% assign config_page = site.pages | where: "path", "reference/configuration.md" | first %}
{% assign ports_page = site.pages | where: "path", "reference/ports.md" | first %}
{% assign files_page = site.pages | where: "path", "reference/files.md" | first %}
{% assign game_page = site.pages | where: "path", "reference/game-settings.md" | first %}
{% assign scripts_page = site.pages | where: "path", "reference/scripts.md" | first %}
{% assign dev_page = site.pages | where: "path", "reference/development.md" | first %}
{% assign host_page = site.pages | where: "path", "setup/host.md" | first %}
{% assign admin_page = site.pages | where: "path", "setup/admin.md" | first %}
{% assign winserver_page = site.pages | where: "path", "setup/windows-server.md" | first %}
{% assign upgrade_page = site.pages | where: "path", "setup/upgrading.md" | first %}
{% assign trouble_page = site.pages | where: "path", "setup/troubleshooting.md" | first %}
{% assign contract_page = site.pages | where: "path", "findings/backend-contract.md" | first %}
{% assign social_page = site.pages | where: "path", "findings/social.md" | first %}
{% assign chat_page = site.pages | where: "path", "findings/chat.md" | first %}

# HTTP API
{: .no_toc }

Dauntless Revived is a handful of small HTTP services. The game client and the game servers talk to
the **metagame**. The metagame asks the **deploy server** to start game servers. The friend launcher
downloads the game from the **content server**. In public mode a TLS **gateway** is the only part
the internet can reach. This page lists every route of each service: its method and path, who may
call it, what it does, and whether it can be reached through the gateway.

The game routes follow the contract of the 1.4.4 client: the paths and reply shapes of the original
backend (see [Backend contract]({{ contract_page.url | relative_url }})). They are not an API of their
own. The management routes under `/undaunted/api` come from Undaunted and from this fork.

<details open markdown="block">
  <summary>Contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

## Services at a glance {#services}

| Service | Folder | Listens on (default) | From the internet in public mode | Authentication |
|:--------|:-------|:---------------------|:---------------------------------|:---------------|
| Metagame | `UndauntedMetagame/` | `BIND_HOST` (`127.0.0.1`) and `PORT` (no default in code; the guides and the kit use 61000) | Only through the gateway, filtered | Player token, account key, admin key or game-server key, depending on the route |
| Chat (inside the metagame, `CHAT=1`) | `UndauntedMetagame/src/realtime/` | `127.0.0.1:61099` (`CHAT_BIND_HOST`, `CHAT_PORT`) | Only through the gateway (a WebSocket upgrade) | Player token (SASL PLAIN) |
| Deploy server | `UndauntedDeployServer/` | `BIND_HOST` (`127.0.0.1`) and `PORT` (no default in code; 61001 in the guides and the kit) | Never | None. It answers only direct callers on loopback. |
| Content server | `UndauntedContent/` | `127.0.0.1:61002` | Through the gateway (`/content`) | Account key for game files; the rest is public |
| Gateway | `UndauntedGateway/` | HTTPS on `0.0.0.0:443` | Yes: the only public TCP port | Its own refusals; passes credentials through |
| Allowlist helper | `UndauntedGateway/` (the `allowlist` part) | `127.0.0.1:61005` | Never | Allowlist secret |
| Launcher relay | `UndauntedLauncher/` | `127.0.0.1:61000` on each player's own PC | Not a service on the server | Refuses anything that is not the local game |

[Ports and network]({{ ports_page.url | relative_url }}) lists every port and how to change it.
[Configuration]({{ config_page.url | relative_url }}) describes each setting named on this page.

**Private mode** (friends over Tailscale, see
[Run it for a group]({{ admin_page.url | relative_url }})) has no gateway. The metagame listens on the
host's Tailscale address, so anyone who can reach that address can call every metagame route,
including the admin routes (which still need an admin key). Keep admin keys on the host. The deploy
server stays on loopback in both modes.

### Who calls what

| Caller | Calls | With |
|:-------|:------|:-----|
| Game client (1.4.4) | The metagame's game routes. In public mode it calls the launcher relay, which forwards over TLS to the gateway. | The account key once (login), then a player token |
| Game client (1.4.4), chat | [Chat](#chat) over XMPP on a WebSocket, the same way through the relay and the gateway | The player token |
| Game servers (Ramsgate, the Training Dojo, hunts) | The metagame, directly on the host | The game-server key, plus the player's token when acting for a player |
| Metagame | The deploy server: matchmaking and the game-server list | Nothing (loopback only) |
| Content server | The metagame's `GET /undaunted/api/GetUserInfo`, to check a downloader's key | The downloader's account key |
| Friend launcher | `Register`, `GetUserInfo`, `ServerStatus` (falls back to `/dauntless-status` on an older metagame), and the content routes | The player's account key |
| Friend kit (private mode) | `Register` and `GetUserInfo` | The player's account key |
| Host scripts (`New-Invite.ps1`, `Get-ServerStatus.ps1`, `Stack.ps1`, `Update-DauntlessServer.ps1`) | `ServerStatus`, `/dauntless-status`, `RegistrationStatus`, `GetUserInfo` and the invite routes; `Stack.ps1 status` also reads the allowlist helper's `GET /status` | The owner's admin key where a route takes a key, and the allowlist secret for `/status`, on the server itself |
| Gateway | The allowlist helper's `POST /allow` | The allowlist secret |

The scripts are described on [Scripts and parameters]({{ scripts_page.url | relative_url }}).

## Authentication {#authentication}

### Credentials

| Credential | Sent as | Format | Held by | What it allows |
|:-----------|:--------|:-------|:--------|:---------------|
| Account key | Header `x-undaunted-user-api-key`; also the login's `exchange_code` | `UUK_` followed by 48 lowercase hex characters | Each player (launcher key store, friend kit's `account.key`); the host for the owner account | Logging in as that player, the account's `/undaunted/api` routes, game-file downloads |
| Player token | Header `Authorization: Bearer <token>` | JWT signed with RS256, valid 24 hours | The game client after login; game servers forward it | Every game route, for that player's own account |
| Admin key | Header `x-undaunted-user-api-key` | An account key whose account has `isAdmin` = 1 | The server owner, on the host | The admin routes, including a token for any account |
| Game-server key | Header `x-undaunted-gameserver-apikey` | Any string; the kit and the guide make 48 hex characters | The deploy server, which hands it to every game server | Reading and writing any player's data, and the game-server-only writes |
| Gateway secret | Header `X-Dauntless-Gateway` | 32-256 printable characters without spaces; the kit makes 64 hex characters | The gateway and the metagame (`GATEWAY_SECRET` in both) | Makes the metagame trust the gateway's `X-Forwarded-For` |
| Allowlist secret | Header `x-allowlist-secret` | 32-256 printable characters without spaces; the kit makes 64 hex characters | The gateway and the allowlist helper (`ALLOWLIST_SECRET`) | Opening the UDP game ports for an address |

**Every one of these is a secret: never share it, never commit it, and never paste it into chat,
an issue or a screenshot.** Invite codes and the token-signing private key
(`AUTH_SIGNING_PRIVKEY_B64`) are secrets too. The services keep keys and tokens out of their logs.
The game-server key is visible on every game server's command line, so never print those command
lines. Where the kit and the guides keep each key is on
[Files and data]({{ files_page.url | relative_url }}).

### Account keys

- `POST /undaunted/api/Register` creates the account and returns its key once. The metagame stores
  only the key's SHA-256 (table `userapikeys`) and compares hashes in constant time, so a lost key
  cannot be recovered.
- There is no route to reissue, revoke or delete a key.
  [Run it for a group]({{ admin_page.url | relative_url }}#missing-admin-functions-and-workarounds)
  has the manual workaround.
- The same key logs the game in and authenticates the launcher's calls and downloads.
- Register also creates the account id: `UID-` followed by a random UUID. An account id is not a
  secret (the game passes ids around for parties and friends), but `ServerStatus` shows usernames
  only.

### Login: from account key to player token {#login}

The 1.4.4 client logs in the way it once logged in to Epic's account service, and the metagame
answers in that service's place:

1. The launcher or the friend kit starts the game with `-AUTH_TYPE=exchangecode` and
   `-AUTH_PASSWORD=<account key>` (see [Game settings]({{ game_page.url | relative_url }})).
2. The client posts the key as `exchange_code` to `POST /account/api/oauth/token`, as JSON or
   form-encoded.
3. With `AUTH_MODE=APIKEY` the metagame looks up the key's hash. It answers an EOS-style body whose
   `access_token` is a JWT with the payload `{userId}`, issuer and audience `undaunted-metagame`, valid
   for 24 hours (`expires_in` 86400). It signs with `AUTH_SIGNING_PRIVKEY_B64` and checks with
   `AUTH_SIGNING_PUBKEY_B64`. An unknown key gets 400.
4. From then on the client sends `Authorization: Bearer <token>` on every game route.
   `PUT /gamesession/epic` echoes the same token back as the session token, so one token serves every
   stage of the original Epic-to-Phoenix login.

What follows from this:

- **Tokens are stateless.** Deleting or replacing an account key does not end a token that was
  already issued: it stays valid until it expires, up to 24 hours. The session-kill routes revoke
  nothing. A new signing key pair invalidates every token at once, and players simply log in again.
- **Anyone with the private signing key can mint a token for any account.**
- Admins can mint a token for any account with `POST /undaunted/api/GenerateJWTForUserId`.
- `AUTH_MODE=NONE` is for development only and is honoured only when `NODE_ENV` is not `production`.
  The `exchange_code` and the `x-undaunted-user-api-key` value are then taken as the account id
  itself, so anyone can act as anyone. In this mode the metagame answers 403 to every request that
  came through a proxy.
- With `AUTH_MODE` unset or set to anything else (or `NONE` together with `NODE_ENV=production`),
  `POST /account/api/oauth/token` logs `No login method configured!` and **never answers**: the client
  waits forever. The routes that need an account key answer 500 in that case.

### Admin accounts

- An admin is an ordinary account whose `users.isAdmin` is 1, and the admin key is that account's
  own account key. No route makes an account an admin. The kit's installer does it for the owner
  account; on a hand-built host, [Host a server]({{ host_page.url | relative_url }}#admin-account) shows
  the one-liner.
- The admin check answers **403 to any request that carries a proxy header**, before the key is even
  looked up (the headers are listed [below](#public-mode)). Admin calls therefore work only directly:
  on the host itself, or in private mode from any machine that can reach the metagame. The gateway
  also blocks the admin routes on its own.
- A missing or unknown key gets 401; a valid key of an account that is not an admin gets 403.
- An admin key is as good as every account's key, because it can mint a token for any of them.

### The game-server key

- Game servers are further copies of the 1.4.4 client in server mode. The deploy server starts each
  one with the key (`METAGAME_API_KEY`) as its first command-line argument, and the server DLL adds
  `x-undaunted-gameserver-apikey: <key>` to every HTTP request the process makes. When a game server
  acts for a player, it also forwards that player's bearer token, so the metagame knows both.
- The metagame stores only the key's SHA-256 (table `gameserverapikeys`). A key put into the queue
  table `gameserverapikeystoregister` is hashed and moved at the next start.
  [Host a server]({{ host_page.url | relative_url }}) shows the manual way; the kit's installer
  registers the key itself.
- The key is accepted only from a direct caller on the same machine: loopback, a connection to one
  of the machine's own addresses (in private mode the game servers call the Tailscale address), or an
  address listed in `GAMESERVER_ALLOW_FROM`. It is never accepted with a proxy header. Anyone else
  gets 403 before the key is checked; a wrong key gets 401.
- The gateway answers 403 to any request that carries the header at all, whatever its value.
- When a game server's write names one account in the URL but forwards the token of another, the
  metagame keeps the write for the URL's account and logs it (`Game server <what> for <account> carries
  the token of <other account>: accepted for <account>, the account the request names`, at most once a
  minute per pair). It never refuses such a write: a refusal could lose a save in a hunt with several
  players.
- A game-server request whose forwarded player token has expired or is malformed gets 500, not 401:
  on this path the token is checked without error handling. This is why game-server saves fail once
  a player's token is older than 24 hours (see
  [Troubleshooting]({{ trouble_page.url | relative_url }}#not-hit-yet-but-known-from-the-code)).

### Public mode: the gateway secret and forwarded headers {#public-mode}

- Setting `GATEWAY_SECRET` on the metagame turns public mode on. The metagame then refuses to start
  unless `AUTH_MODE=APIKEY`, and warns when the secret is shorter than 16 characters, `BIND_HOST` is
  not loopback, `NODE_ENV` is not `production`, or `QOS_TARGET_URL` is not
  `http://127.0.0.1:<port>/QoS`. The gateway refuses to start unless the secret is 32 to 256 printable
  characters without spaces, so that is the rule to follow. The kit writes the same 64-hex-character
  value into both components' settings.
- The gateway removes any forwarding headers the client sent (`X-Forwarded-For`, `-Proto`, `-Host`,
  `-Port` and `-Prefix`, `Forwarded`, `X-Real-IP`, `X-Client-IP`, `True-Client-IP`,
  `CF-Connecting-IP`, `X-Dauntless-Gateway`) and sets its own: `X-Forwarded-For: <the peer's address>`, `X-Forwarded-Proto: https` and
  `X-Dauntless-Gateway: <secret>`.
- The metagame takes the player's address from `X-Forwarded-For` (the right-most entry) only when
  the connection comes from loopback and the secret matches (compared in constant time). Otherwise it
  uses the connection's own address. Its request log line then ends in `via=gateway ip=<address>`.
- Any of `X-Dauntless-Gateway`, `X-Forwarded-For`, `Forwarded`, `X-Real-IP`, `X-Forwarded-Host`,
  `X-Forwarded-Proto` or `Via` marks a request as **proxied**, whatever its value and whether or not
  public mode is on. A proxied request can never use the admin key or the game-server key, and the
  deploy server refuses proxied requests completely.

### Access labels used in the route tables {#access-labels}

| Label | Accepts | Refuses |
|:------|:--------|:--------|
| none | Anyone | Nothing |
| token | A player token (prefix `Bearer `, `bearer ` or `BEARER `), or the game-server key from a local caller, optionally with a player's token | 401 without a valid credential; 403 for the game-server key from elsewhere |
| player | A player token. A game server must forward one; its key alone names no player. | As *token*, plus 403 without a player token |
| optional token | Anyone. A valid player token unlocks the real answer. | Nothing: without a token the route gives a fixed empty reply |
| account key | Any valid account key, admin or not | 401 |
| admin key | An admin's account key, from a direct caller | 403 through any proxy, 401 missing or unknown key, 403 not an admin |
| registered | Anyone. A valid account key, or a valid token of an existing account, gets the full answer. | Nothing |

Three more marks apply to the progression routes. **Real progression is the default for every
account.** With `PROGRESSION_MODE=stub`, only the accounts listed in `PROGRESSION_REAL_ACCOUNTS` keep
it, and everyone else gets upstream's fixed max ranks
([Upgrade notes]({{ upgrade_page.url | relative_url }}) explains the choice).

| Mark | Meaning |
|:-----|:--------|
| real only | The route exists only for accounts with real progression. For any other account it falls through to the empty 404, before any credential is checked. |
| own | With real progression, a player token may read only its own account (the `:userId` in the path); anyone else's gets 403. A game server may read any account. |
| game server | With real progression, only a game server may write; a player token gets 403. This is what stops players from writing their own progression, entitlements, cooldowns, bounties and loadout slots. |

## Metagame conventions {#metagame-conventions}

- Paths are matched regardless of letter case, and a trailing slash is ignored, so
  `/undaunted/api/register` reaches `Register`. `HEAD` works on every `GET` route.
- A method and path that match no route get an empty 404 and the log line `Unstubbed route <METHOD> <path>`.
- Request bodies may be JSON (up to 50 MB) or form-encoded (up to Express's default of 100 kB).
  Through the gateway the limit is 128 KiB.
- Unparseable JSON sent to `Register`, `CreateInvite`, `RenameUser`, `PartyInvite`, `Friends`,
  `GuildInvite` or `DisbandGuild` gets 400 `{"error": "bad_request", ...}`. On any other route it
  gets Express's HTML 400 page, and any other unexpected error gets Express's HTML 500 page. Both
  include a stack trace unless `NODE_ENV=production`.
- Each request is logged as `<METHOD> <path> gs=0|1` (`gs=1` when it carries the game-server key),
  with tokens in the path replaced; `LOG_REQUESTS=0` turns this off. `LOG_BODIES=1` also writes the
  bodies of some game routes (among them the party, friends, guild, store, Escalation, Slayer Link,
  `/account/mapping` and `/accountinfo/public` routes) to `BODY_LOG_FILE` (default `bodies.log`), one
  line per request once it is answered, with the reply's status and duration, and with tokens and
  account keys removed. `BODY_LOG_PER_PATH` caps the lines per path. That file still holds player data:
  keep it private.
- A request under `/progression` that no route answers is logged as a warning
  (`Unhandled progression request <METHOD> <path> from a game server` or `from a player`) before the
  usual 404.
- Many game routes answer `{"code": null, "message": "OK", "payload": ...}`, as the original backend
  did. [Backend contract]({{ contract_page.url | relative_url }}) has the shapes the client expects.
- These settings change which routes answer. Each needs a restart;
  [Configuration]({{ config_page.url | relative_url }}) has the details.

| Setting | Default | Effect on routes |
|:--------|:--------|:-----------------|
| `MISC_ROUTES` | unset: on | `0` puts back upstream's 404 on `GET /motd/trigger`, the four friends-service reads (friends list, block list, recent players, settings) and `POST /candidate/player/alive`. |
| `MATCHMAKING_CANCEL` | unset: off | `1` answers `DELETE /candidate` and `DELETE /candidate/leave`; otherwise they get 404. |
| `PROGRESSION_MODE` | unset: real | `stub` gives every account not listed in `PROGRESSION_REAL_ACCOUNTS` upstream's fixed replies, and the *real only* routes answer 404 for them. Any value other than `stub` or `real` is logged and treated as real. |
| `PROGRESSION_CONFIRM` | unset: on | `off` makes rank confirmation answer 404. |
| `PROGRESSION_ALLOW_DELETE` | unset: off | `1` lets game servers reset a track. |
| `STATUS_EXTRA` | unset: on | `0` trims `/dauntless-status` to the nine fields the client reads. |
| `ACCOUNT_DISPLAY_NAME` | unset: on | `0` puts upstream's `{}` back as `displayName` in the account record and the party replies. |
| `ACCOUNT_MAPPING` | unset: on | `0` makes `POST /account/mapping` map nothing (`accountMappings: {}`), the old effective behaviour. |
| `ACCOUNTINFO_PUBLIC_LEGACY` | unset: off | `1` puts back upstream's `POST /accountinfo/public` reply: the caller's own id, and 200 with an empty name for an unknown id. |
| `GUILDS` | unset: on | `0` puts back the old guild stubs (`GET /guild` 204, `GET /guild/invite/player` an empty list); every other guild route, and the three guild routes of the management API, answer 404. |
| `ESCALATION_MODE` | unset: `stub` | `real` stores Escalation for real-progression accounts: `GET /escalation/...` reads the stored season and `POST /escalation/...` exists (404 otherwise). |
| `STORE` | unset: `off` | `free` turns on the four store routes; with `off` the storefront answers the old 400 and the three purchase routes 404. |
| `STORE_REPEATABLE_TOKENS` | unset: off | `1` lists and sells the bounty-token bundle (only with `STORE=free`). |
| `SLAYER_LINKS` | unset: on | `0` makes every `/slayerlink` route answer 404, as before. |
| `VERIFY_STUB_ACCOUNT` | unset: off | `1` puts back the fixed placeholder `account_id` in `GET /account/api/oauth/verify`. |
| `BALANCE_FROM_INVENTORY` | unset: on | `0` puts back the fixed currency sheet in `GET /balance` and `POST /reconcile`. |
| `PROGRESSION_REPLAY_WINDOW_S` | unset: `5` | The retry guard of `POST /progression/:userId`; `0` turns it off. |
| `PROGRESSION_CONFIRM_ENTITLEMENTS` | unset: off | `1` makes a rank confirm also grant that rank's permanent config entitlements. |

## Metagame: game routes {#game-routes}

**Through the gateway:** every route in this section is forwarded. The login counts against the
gateway's *token* rate limit and everything else against *general* (see [Gateway](#gateway)). A
request that carries the game-server key is refused by the gateway, so the *game server* writes only
work on the host.

### Login and accounts

| Method | Path | Access | What it does |
|:-------|:-----|:-------|:-------------|
| POST | `/account/api/oauth/token` | none (the key is in the body) | The login: `exchange_code` = account key, answered with a 24-hour `access_token` (see [Login](#login)). 400 for an unknown key. |
| GET | `/account/api/oauth/verify` | optional token | The client's regular session check. With a valid player token: `{"active": true, ...}` whose `account_id` is that player's own account. Without a token, or with a malformed, expired or foreign one: the old fixed reply with a placeholder `account_id`, still 200 (never 401; a bad or expired token is logged at most once a minute). `expires_at` stays far in the future. `VERIFY_STUB_ACCOUNT=1` answers the placeholder to everyone. |
| DELETE | `/account/api/oauth/sessions/kill` | none | Answers `{}`. Revokes nothing. |
| DELETE | `/account/api/oauth/sessions/kill/:token` | none | The same. The token in the path is replaced by `<token>` in the metagame's and the gateway's logs. |
| GET | `/account/api/public/account` | token | Without a query: the caller's own Epic-style account record, `displayName` = username. With `?accountId=A&accountId=B` (at most 100): an array of `{id, displayName, externalAuths}` for the accounts that exist. |
| GET | `/account/api/public/account/:accountId` | optional token | With a token: `{id, displayName, externalAuths}` of that account, or `{}` if it does not exist. Without a token: `{}`. |
| GET | `/account/api/public/account/displayName/:name` | optional token | Finds an account by username, regardless of case. Needs a token to find anything; otherwise, or when nothing matches, 404. |
| GET | `/account/api/public/account/:accountId/externalAuths` | none | Answers `{}`. |
| POST | `/account/mapping` | optional token | The client's account-mapping lookup (`QueryAccountMappingsEndpoint`): Epic account ids to Phoenix account ids. It runs for Add Friends (after the name lookup), the chat's `/invite <name>`, the guild add-member box, every id on the friends list and block list, and at login for the player's own id (the executable's log string and the 2.1.1 capture; the 1.4.4 census shows 6 calls in 8 logins, 2 of them Add Friends, so not at every login). Body `{"srcAccountType": "epic", "ids": ["<id>", ...]}` (at most 100 ids, each once; the older guesses still work: a bare array, `externalIds`, `accountIds` or `externalAuthIds`, and `type`/`externalAuthType`). Reply `{"accountMappings": {"<asked id>": {"accountId": "<id>", "accountType": "phoenix"}}, "code": "OK", "message": "", "payload": {"accountMappings": {...}}}`: an object keyed by each asked id, the shape the client parses, with a wrapped copy it ignores. Every id is its own mapping here (a player's Epic id and account id are the same). For `srcAccountType` `phoenix` the entries say `epic`. Ids that are not this server's accounts are left out, and without a valid token the map is empty. `ACCOUNT_MAPPING=0` maps nothing. The log records the body's shape and `-> N of M mapped`. Earlier replies (an object keyed by id without `accountMappings`, then `accountMappings` as an array) mapped nothing in the client; see [Friends, parties and guilds]({{ social_page.url | relative_url }}). |
| GET | `/features/platform/win` | none | Platform flags: `crossplay` and `crossprogression` true. |
| GET | `/account/link/epic/:accountId` | none | Answers `isLinked: true`. |
| POST | `/login` | token | The login queue. The body's `email` must equal the token's account id and the account must exist (otherwise 400). Answers `{"error_code": "TicketRateOk", "state": "OPEN", ...}`. |
| GET | `/accountinfo` | token | The caller's `accountId` and `username`, with fixed values for the other fields. |
| GET | `/tags` | token | `{accountId, tags: []}`. |
| PUT | `/gamesession/epic` | token | Echoes the caller's own bearer token back as `payload.sessionToken`. The reply contains the token. |
| POST | `/accountinfo/public` | token | Another player's user info, which the client needs before it shows that player anywhere (a party invite's sender, party and Hunt Members, friends, blocked players, guild members). Body `{"accountId": "<id>"}` or `{"displayname": "<name>"}` (any case; `accountId` wins when both are given). Reply `{accountId, username, linkedAccounts: [{accountId, accountType: "epic"}], isSubscribed: true, language: null}` for the **asked** account: the client files the reply under its `accountId`. 404 `{}` for an unknown id or name. Any logged-in player may look up any account. Upstream answered with the caller's own id, which is why other players never showed; `ACCOUNTINFO_PUBLIC_LEGACY=1` puts that back. Each lookup is logged as `accountinfo/public by <caller> for <id> -> found` (or `-> 404`). |

### Status, heartbeat and small fixed replies

| Method | Path | Access | What it does |
|:-------|:-----|:-------|:-------------|
| GET | `/dauntless-status` | none | The status banner the client shows (`show-status` and a welcome to the server by its name, `Welcome to <SERVER_NAME>!`, translated into eight languages), plus `name`, `version`, `commit` and `sourceUrl` (the AGPL source link) unless `STATUS_EXTRA=0`. No player data. Host scripts use it as a health check. |
| POST | `/heartbeat` | token | Body `{map, state?}`, every 20 seconds. Marks the player online for 90 seconds and keeps them in their party. Answers the text `20000`. A game server's heartbeat without a player token records nothing. Through the gateway, a 2xx answer to a request with a bearer token opens the game ports for the player's address, so a missing or bogus token must get 401 (a test guards this). |
| POST | `/event` | none | Telemetry sink. Answers `{}`. |
| POST | `/account/migrate` | token | Answers `{migration_failed: false, migration_finished: true}`. |
| POST | `/profile/update` | token | Empty 200 (leaderboard profile). |
| GET | `/vivox/login` | token | 404 on purpose: the voice chat service is gone. |
| POST | `/motd/` | token | 204: no message of the day. |
| GET | `/motd/trigger` | none | 204: no after-hunt news. 404 with `MISC_ROUTES=0`. |
| GET | `/playertreatments/:userId` | token | A fixed cohort list. |
| GET | `/eventstats/` | token | Answers `{stats: []}`. |
| GET | `/all/` | token | An empty mailbox. |
| GET | `/game_tuning/seasonal_event_schedule` | none | No scheduled events. |
| GET | `/game_tuning/huntpass_xp_config` | none | The Hunt Pass XP configuration (`MaxXPAwarded` 200). |

### Characters, inventory and currency

| Method | Path | Access | What it does |
|:-------|:-----|:-------|:-------------|
| GET | `/character` | token | The caller's characters (a bare array). An account with none gets one, named after the username. |
| PUT | `/character` | token | Creates a character `{name}` for the caller. |
| POST | `/character` | token | Saves `{characterId, data, updateVersion}` for the caller's own character, with optimistic versioning: 400 for a bad version or data, 404 for someone else's character, 409 for a version conflict. Every save goes into the save history. |
| GET | `/inventory/:userId/:characterId` | token | The character's inventory. A player always gets their own account's, whatever the URL says; a game server gets the URL's account. |
| POST | `/inventory` | token | One inventory transaction: `{characterId, transactionId, addInstancedItems, addStackedItems, removeInstancedItems, removeStackedItems, saveInstancedItems, source}`, plus `accountId` from a game server (ignored for a player). A repeated `transactionId` gets the stored answer and changes nothing. `INVENTORY_REFUSE_OVERSPEND` and `INVENTORY_REPORT_REMOVALS` tune it. |
| POST | `/inventory/instanceditem` | token | Updates one item: `{characterId, instanceId, catalogId, itemData, updateVersion}`, plus `accountId` from a game server. |
| POST | `/inventory/:characterId/:changeList` | token | Inventory migration stub. Answers `{code: null, message: ""}`. |
| POST | `/reconcile` | token | `{balances: {id_currency_notes, CURRENCY_NOTES}, refreshInventory: true}`. With `BALANCE_FROM_INVENTORY` (on by default) each key is the quantity of that currency's stack (`CURRENCY_NOTES`, the Rams) in the inventory of the account's active character, the one saved last; a currency the character does not hold keeps the old value (the notes column of `users`). `0`: the old values only. |
| GET | `/balance` | token | The currency sheet: the same 52 keys as before (both spellings, `CURRENCY_X` and `id_currency_x`). With `BALANCE_FROM_INVENTORY` (on) every key whose `CURRENCY_*` stack the active character holds reports that quantity; the others keep the old values (notes from the database, 25 weapon tokens, the rest 0). No key is added, removed or reordered. `CURRENCY_PLATINUM_UNIV` is not mapped. `0`: the old fixed sheet. |
| GET | `/creator` | token | A fixed support-a-creator reply. |

### Store {#store}

The in-game store ([The in-game store]({{ '/findings/store.html' | relative_url }})). **Only with
`STORE=free`**; with `STORE=off` (the default) the storefront answers the old 400
(`{"code": "400", "message": "The store is not available on Dauntless Revived yet."}`) and the other
three routes the empty 404. Every route acts for the player of the bearer token: no token 401, the
game-server key alone 403. Refusals are `{"code": "<status>", "message": ...}`.

| Method | Path | Access | What it does |
|:-------|:-----|:-------|:-------------|
| GET | `/product/skus/public?requiredTags=<tag>` | player | The offers of one tag, as a bare array, each with `remaining` (0 when every item it grants is held by the active character and every entitlement it grants is active). The store screen asks for `webstore` (200 offers; the Elite pass is under `season09b_pass`). An unknown tag is `[]` and a warning; no tag is 400. |
| GET | `/product/sku/:skuId` | player | One offer, from any tag; 404 for an unknown one (or the bounty-token bundle while `STORE_REPEATABLE_TOKENS` is off). |
| GET | `/token/:currency/:skuId` | player | `{purchaseToken}`: 64 hex characters, valid 10 minutes, bound to the account's active character and to the offer as it is now (a row in `storepurchases`, which stores only the token's SHA-256). `currency` must be `platinum` (400); only free offers of allowed items are sold (409); 404 for an unknown offer; 409 when the account has no character, already owns everything the offer grants, or has had 60 tokens in the last 10 minutes. |
| POST | `/notification/:currency?token=<token>` | player | Redeems the token and answers 204 with no body. In one transaction: the items through the inventory core (caller `store`, source `store:<sku>`, transaction id `store:<token hash>`; items the character already holds are skipped), the entitlements through the entitlement grant (source `store:<sku>`), then the token is marked redeemed. 403 for another account's or an unknown token, or one whose character is no longer the account's; 410 when it expired; 409 when the offer changed or is no longer sold; 400 for a malformed token or another currency. A token redeemed before answers 204 again and grants nothing. |

The purchase token is removed from every log line (the request log never logs the query string, the
gateway blanks `token=`, and the body log blanks it too).

### Progression, Hunt Pass, entitlements, cooldowns and bounties

With real progression (the default) these routes store and read each account's own data. In stub
mode the routes with a *Stub:* note answer upstream's fixed replies instead, and the *real only*
routes answer 404. The marks are explained under [Access labels](#access-labels).

| Method | Path | Access | What it does |
|:-------|:-----|:-------|:-------------|
| GET | `/progression/config` | token | The progression configuration (tracks and ranks), from the metagame's own copy of the game's config, or with `PROGRESSION_CONFIG_DIR` from that folder's season files (checked at startup; see [Game settings]({{ game_page.url | relative_url }}#hunt-pass-seasons)). Unchanged bytes without the folder. |
| GET | `/progression/:userId` | token, own | Every track, stored or at 0. Stub: fixed max ranks for the caller. |
| POST | `/progression/:userId` | token, game server | Stores a progression grant `{progress_tracks, objectives}` and answers the new totals. `PROGRESSION_GRANT_CAP` (5000) limits what one request adds to a track; more is cut and logged. **Retry guard:** a body byte for byte equal to the account's last grant, less than `PROGRESSION_REPLAY_WINDOW_S` seconds after it (default 5) and with no other track write in between, gets that grant's stored reply and adds nothing (an audit row notes it). An objective lower than the stored one is logged and stored as sent. A relayed player token of another account is logged, never refused. Stub: always 400 on purpose (anything else makes the client repeat its mastery pop-up forever). |
| GET | `/progression/:userId/:progressionId` | real only, token, own | One track; 404 if none is stored. |
| POST | `/progression/:userId/:progressionId/:amount` | real only, token, game server | Adds `amount` to one track, up to `PROGRESSION_GRANT_CAP`. |
| POST | `/progression/:userId/:progressionId/:rank/confirm/:kind` | real only, token, game server | Confirms a free (`public`) or premium rank. It grants nothing: the game server pays rank rewards through `/inventory` itself. With `PROGRESSION_CONFIRM_ENTITLEMENTS=1`, a confirm that raises the rank also grants the newly confirmed ranks' permanent config entitlements (never items, currencies or timed ones); the reply is the same. 404 with `PROGRESSION_CONFIRM=off`. |
| DELETE | `/progression/:userId/:progressionId` | real only; admin key, or the game-server key with `PROGRESSION_ALLOW_DELETE=1` | Resets one track. If `x-undaunted-user-api-key` is present, the admin-key check applies. Otherwise it needs the game-server key and `PROGRESSION_ALLOW_DELETE=1` (403 without). The game only sends it from a debug command. |
| GET | `/progression/objectives/:userId` | token, own | The stored objectives. Stub: mastery tracks at max and no objectives. |
| GET | `/progression/objectives/:userId/:objectiveId` | token, own | One objective, zeros if none is stored. Stub: fixed values. |
| GET | `/huntpass/:userId` | token, own | The selected Hunt Pass: the stored one, else `ACTIVE_HUNT_PASS` (default `season09b`). |
| POST | `/huntpass/:userId` | real only, token, game server | Stores the Hunt Pass selection. |
| GET | `/escalation/:season/:userId` | token; own with `ESCALATION_MODE=real` | `ESCALATION_MODE=stub` (default), and accounts in stub progression mode: the fixed reply `{code: null, message: "OK", payload: {escalation_level: 99999, next_level_xp: 99999, talents_progress: [], unlock_progress: [], update_version: 1}}` to anyone, nothing stored. `real`: the stored season in the same envelope, or level 0 with version 0 when nothing is stored (a read creates no row); 404 `{code: "404", ...}` for a season not in the registry ([Escalation]({{ '/findings/escalation.html' | relative_url }})). |
| POST | `/escalation/:season/:userId` | only with `ESCALATION_MODE=real`; real only, token, game server | Saves the whole season `{escalation_level, next_level_xp, talents_progress: [{rank, talent_id}], unlock_progress: [{collected, reward_id}], update_version}` and answers the stored state. 400 for a malformed save, 404 for an unknown account or season, 409 for a disabled season (Frost), an older version, the same version with other content, lower progress, an un-collected reward or a save carrying the old stub values (level 25 with 99,999 XP or more, unless the stored season is already at 25); the same version with the same content is answered with the stored state (a retry). `ESCALATION_STRICT=1` also refuses (409) what breaks a soft rule. Every save, answered or refused, is a `progression_events` row. With `stub` the route falls through to the empty 404. |
| GET | `/entitlementsv2` | token | The entitlements of the token's account (a game server must forward the player's token). Real: a flat `{entitlements: [...]}` without expired ones. Stub: an empty list. |
| POST | `/entitlementv2/:userId` | token, game server | Grants `{entitlement, duration}` (hours; 0 or none = permanent) and answers the account's full list. 404 for an unknown account. Stub: an empty reply. |
| DELETE | `/entitlement/:userId/:entitlement` | real only, token, game server | Revokes an entitlement. |
| GET | `/cooldown/:userId` | token, own | Each cooldown's start time. Stub: empty. |
| PUT | `/cooldown/batch/:userId` | token, game server | Stores `{cooldowns: [{cooldown_id, cooldown_started_date}]}`. Stub: an empty reply. |
| PUT | `/cooldown/:userId/:cooldownId` | real only, token, game server | Starts one cooldown now (no body). |
| GET | `/bounty/game-data` | token | The fixed bounty configuration (4 slots, token ids). It is registered before `/bounty/:userId`, so it wins. |
| GET | `/bounty/:userId` | token, own | The stored bounty board. Stub: an empty board. |
| POST | `/bounty/:userId` | token, game server | Updates bounties by `bounty_id` (a partial update). Stub: an empty board. |
| POST | `/bounty/delete/:userId` | real only, token, game server | Deletes the bounties in `{bounty_ids}`. |
| GET | `/encountered-content/:characterId/:contentType` | token | The content of one type the caller's character has encountered. 403 for someone else's character. |
| POST | `/encountered-content/query/:characterId` | token | The same for a list `{content_types}`. |
| POST | `/encountered-content/:characterId` | token | Adds `{content_type, content_id}`. |
| GET | `/breadcrumbs/:characterId` | token | The character's interface breadcrumbs. |
| POST | `/breadcrumbs/:characterId` | token | Saves `{breadcrumbs, updateVersion}`; 409 on a version conflict. |

### Loadouts

A player is always scoped to their own account, whatever the URL says; a game server acts for the
account in the URL. The character must belong to that account (404 otherwise).

| Method | Path | Access | What it does |
|:-------|:-----|:-------|:-------------|
| GET | `/loadout/:userId/:characterId/all` | token | Every loadout, the persistent data and the slot counts. |
| POST | `/loadout/:userId/:characterId/:index` | token | Saves one loadout slot `{data}`. Real: any unlocked slot. Stub: only slot 0 and `persistent`. Every save goes into the save history. |
| POST | `/loadout/:userId/:characterId/unlock/:numSlots` | real only, token, game server | Unlocks `numSlots` more slots. |
| GET | `/loadout/:userId/:characterId/slotcount` | real only, token | The slot counts. |
| POST | `/loadout/:userId/:characterId/active/:index` | real only, token, game server | Sets the active slot. |

### Matchmaking

| Method | Path | Access | What it does |
|:-------|:-----|:-------|:-------------|
| POST | `/candidate/join` | token | Body `{gameMode, gameArgs, playerHuntId}`. After checking the input, it either asks the deploy server for a server right away (Ramsgate, the Dojo, the tutorial) or queues the player for a hunt. A hunt group closes at 4 players, or once 20 seconds pass without anyone new. A player is queued once: a new join replaces the player's older join that is still waiting, and the deploy server is never told to expect an account twice. Answers `{candidateId, gameMode, huntId, status: "MATCHING"}`. 400 for bad input, or when `MATCHMAKING_MODE` is `DISABLED` or not set. A party leader's join can take the party along. |
| POST | `/candidate/join/:candidateId` | token | A party member follows the leader's candidate; 404 if it is not their party's. |
| GET | `/candidate/status` | token | The client's poll. `MATCHING`; `IN_PROGRESS` with `serverInfo {buildId, gameSessionId, host, port}` (the game server's address, from `MY_IP`); or `FAILED` when no server could be started. 404 when the caller is not queued. |
| DELETE | `/candidate` | token | Cancel. Off by default (404), because the client sends it right after every join; `MATCHMAKING_CANCEL=1` turns it on. A party leader's cancel also calls off the party's candidate. |
| DELETE | `/candidate/leave` | token | Only the caller leaves the candidate. Same switch as `DELETE /candidate`. |
| POST | `/candidate/player/alive` | token | A hunt server asks which players it should still expect; the route echoes its `playerIds` back as `expectedPlayerIds`. 404 with `MISC_ROUTES=0`. |
| POST | `/candidate/player/register` | token | Answers `{}`. |
| GET | `/candidate/regions` | token | The region list for the ping test: the one URL in `QOS_TARGET_URL`, pinged 5 times. |
| GET | `/QoS` | none | The ping target, an HTML "pong". In public mode `QOS_TARGET_URL` is the player's own launcher relay, `http://127.0.0.1:61000/QoS`, which forwards the ping through the gateway. |
| POST | `/key/generate` | token | Always 400. |

### Parties

Parties live in the metagame's memory: a restart leaves everyone in a party of one. Every action
acts as the token's own account; ids in the URL or body only name the other player or the party.
Limits: 4 players per party, 8 pending invites per party, 10 per recipient, invites expire after 5
minutes. A player sends at most 20 invites in 10 minutes, and after someone declines their invite
they cannot invite that player again for 2 minutes (both 409 `{}`, which the client shows as a
failure). A block removes the pending invites between the two, and an invite between players who
blocked each other is never listed and cannot be accepted (404). A player alone in their party gets
upstream's placeholder candidate (`candidateState: "QUEUED_FOR_START"`); `PARTY_SOLO_STUB=0` answers
a party of one with no candidate instead (see [Configuration]({{ config_page.url | relative_url }}#metagame-social)).

| Method | Path | Access | What it does |
|:-------|:-----|:-------|:-------------|
| POST | `/party` | player | The party poll, about every 10 seconds: the caller's party, or a party of one. |
| GET | `/party/invites` | optional token | The caller's pending invites. Without a valid token: `{invitations: []}`. |
| PUT | `/party/invite` | player | Invites `{recipientPlayerId}` to the caller's party. Leader only. |
| PUT | `/party/invite/accept/:inviteId` | player | Accepts one of the caller's own invites (the id the client sends is the party's). With no live invite, a repeated accept is answered 200 with the caller's party when the caller is already in a party of two or more and the id is that party's or another member's; otherwise 404. |
| DELETE | `/party/invite` | player | Declines an invite, or withdraws one the caller sent. |
| DELETE | `/party/member` | player | The caller leaves their party. |
| DELETE | `/party/member/:memberId` | player | Removes a member. Leader only. |
| PUT | `/party/member/promote/:memberId` | player | Makes another member the leader. Leader only. |
| DELETE | `/party/leader/:leaderId` | player | Removes a leader nobody has heard from for 2 minutes; otherwise ignored. Always 200. |
| POST | `/party/status` | player | `{playerIds}` (at most 16): those players' parties and the caller's own invitations. |

### Friends

The Epic-style friends service. Friendships and blocks are stored in the database (at most 200 of
each per account). Everyone shows as offline unless friends' online status is on in the
[chat server](#chat) (`CHAT=1` and `CHAT_PRESENCE=1`, off by default): online status comes only from
presence over the chat connection. An unfriend or a block also cancels the waiting
[Slayer Link](#slayer-links) invites between the two.

| Method | Path | Access | What it does |
|:-------|:-----|:-------|:-------------|
| GET | `/friends/api/public/friends/:userId` | optional token | The caller's own friends, a bare array of `{accountId, status, direction, created}`; `?includePending=true` adds pending requests. Without a token, or for another account's list: `[]`. 404 with `MISC_ROUTES=0`. |
| GET | `/friends/api/public/blocklist/:userId` | optional token | The caller's own block list `{blockedUsers}`; otherwise an empty list. 404 with `MISC_ROUTES=0`. |
| POST | `/friends/api/public/friends/:userId/:friendId` | player | Sends a friend request, or accepts the one `friendId` sent. |
| DELETE | `/friends/api/public/friends/:userId/:friendId` | player | Unfriends, withdraws a request or declines one. |
| POST | `/friends/api/public/blocklist/:userId/:friendId` | player | Blocks `friendId` and removes any friendship between the two, and the party and guild invites either one sent the other. |
| PUT | `/friends/api/public/blocklist/:userId/:friendId` | player | The same as the POST. The client's verb for Block is inferred from the executable, not traced, so both are accepted. |
| DELETE | `/friends/api/public/blocklist/:userId/:friendId` | player | Unblocks `friendId`. |
| GET | `/friends/api/public/list/:namespace/:userId/recentPlayers` | none | Answers `[]`. 404 with `MISC_ROUTES=0`. |
| GET | `/friends/api/v1/:userId/settings` | none | Answers `{acceptInvites: "public"}`. 404 with `MISC_ROUTES=0`. |

The changes answer 204 with no body. `:userId` must be the caller (403 otherwise). A `friendId`
that is not shaped like an account id gets 404. A request or a block also refuses an unknown account
(404), yourself (400) and the 200 limit (409), and a request refuses a pair where one has blocked
the other (403). A new request is also refused (409) when the caller already has 50 unanswered
requests out, or has sent 20 new requests in the last 10 minutes; accepting a request the other
player sent is never limited. Removing a friend or a block that does not exist still answers 204.

The client reads both lists only at login, so a new request or an accepted one shows for the other
player at their next login. [Friends, parties and guilds]({{ social_page.url | relative_url }})
describes what the player sees at each step.

### Guilds

The v2 guild API of the 1.4.4 client, stored in the database (tables `guilds`, `guildmembers` and
`guildinvites`, see [Files and data]({{ files_page.url | relative_url }})), so guilds and invites
survive restarts.

- **Replies** are the Phoenix envelope `{"code", "message", "payload"}`. A reply that carries a guild
  or the invite list also copies the payload's fields to the root. A success always has a JSON body:
  the client treats a success without one as a failure. The one empty reply is `GET /guild`'s 204
  for "no guild".
- **Refusals** are a 4xx with `{"code": "<code>", "message": "<text>", "payload": {}}`. The client maps
  the code to its own error and shows its own text; an empty code shows as "Unable to create guild."
- **The guild object** is `{id, name, nameplate, leader_account_id, members: [{phx_account_id, rank}],
  maximum_guild_members}`. Ranks are `Leader`, `Officer` and `Member`, listed in that order and then
  by join time. `maximum_guild_members` is `GUILD_MAX_MEMBERS` (default 100), a number.
- **Nothing is pushed.** Other members and invitees see a change at their next login or world load
  (the client reads `GET /guild` and `GET /guild/invite/player` then, and after each of its own guild
  actions).
- `GUILDS=0` brings back the old stubs for the two reads, and every other guild route answers 404.

| Method | Path | Access | What it does |
|:-------|:-----|:-------|:-------------|
| GET | `/guild` | token | The caller's guild: 200 with the guild object, wrapped and flat. 204 with no body when the caller is in no guild (also for the game-server key without a player token). |
| GET | `/guild/invite/player` | token | The caller's open invites, newest first: `{code: "OK", message: "", payload: {invites}, invites}`, each `{id, guild_id, guild_name, inviter_account_id}`. |
| POST | `/guild/validate` | player | `{leader_account_id, name, nameplate}`, sent while the player types in CREATE A GUILD. Checks the rules below for the token's account (a different `leader_account_id` is only logged) and answers `{code: "OK", message: "", payload: {}}` or the refusal. Creates nothing. |
| POST | `/guild` | game-server key | The create. The Create button is an RPC to the Ramsgate game server, which sends the same body here with its key. Answers the new guild object. See below. |
| DELETE | `/guild/player` | player | Leave Guild. A Member or Officer leaves; the leader cannot (409 `ChiefAdorableQuillshot`). |
| DELETE | `/guild/player/:accountId` | player | Kick From Guild. Leader only. Naming yourself is a leave. |
| PUT | `/guild/invite/:accountId` | player | Invite to Guild, no body. Leader or Officer. |
| POST | `/guild/invite/accept/:inviteId` | player | Accepts one of the caller's own invites: the caller joins as a Member, and every other invite they had is removed. |
| DELETE | `/guild/invite/:inviteId` | player | Declines one of the caller's own invites. |
| PUT | `/guild/rank/:accountId/:rank` | player | `member`, `officer` or `leader`, in any case. Leader only. `leader` hands the guild over, and the old leader becomes an Officer. Setting the rank a member already has changes nothing. |
| DELETE | `/guild/:guildId` | player | DISBAND GUILD: the caller's own guild, its members and its invites. Leader only. |

`DELETE /guild/player` and `DELETE /guild/player/:accountId` are registered before
`DELETE /guild/:guildId`, which would otherwise take them.

**Names and nameplates**, checked in this order (the first failure decides):

| Rule | Code | Status |
|:-----|:-----|:-------|
| The caller (or, for the create, the leader) is not in a guild | `OccupiedAdorableQuillshot` | 409 |
| Name: 4 to 15 English letters and digits, nothing else | `ObedientAdorableQuillshot` | 400 |
| Name: at most 6 digits | `NumberedAdorableQuillshot` | 400 |
| Name: at most 6 of the same letter in a row, regardless of case | `LetteredAdorableQuillshot` | 400 |
| Name: no word from the deny list, and not a short offensive word | `NastyAdorableQuillshot` | 400 |
| Name: no reserved staff or project word | `SeizedAdorableQuillshot` | 409 |
| Name: not taken, regardless of case | `SeizedAdorableQuillshot` | 409 |
| Nameplate: empty, or 2 to 6 English letters and digits | `DutifulAdorableQuillshot` | 400 |
| Nameplate: no word from the deny list, and not a short offensive tag | `DirtyAdorableQuillshot` | 400 |
| Nameplate: no reserved staff or project word | `CapturedAdorableQuillshot` | 409 |
| Nameplate: not taken, regardless of case (an empty one never is) | `CapturedAdorableQuillshot` | 409 |

The deny list is short and built in; `GUILD_NAME_DENYLIST` adds words. It is compared after lower-casing
and undoing common digit swaps (`0` for `o`, `3` for `e` and so on), anywhere in the text. A few
short offensive words (such as `KKK`, `SS` and `1488`) are refused as the whole name or nameplate
(`KKK` anywhere).

**Reserved words** keep a guild from posing as the server's staff or the project. They answer "already
in use" (`SeizedAdorableQuillshot` or `CapturedAdorableQuillshot`), compared after lower-casing and
undoing digit swaps:

| Where | Words |
|:------|:------|
| Anywhere in a name or nameplate | `admin`, `moderator`, `official`, `gamemaster`, `staff`, `dauntlessrevived`, `phoenixlabs` |
| The whole name | `dauntless`, `phoenix`, `revived`, `support`, `system`, `server`, `servers`, `mods`, `developer`, `developers`, `devteam` |
| The whole nameplate | `gm`, `gms`, `dev`, `devs`, `mod`, `mods`, `sys`, `phx`, `dr`, `drev`, `undt` |

So `DauntlessCrew` and `PhoenixRising` are fine, but `Dauntless`, `ServerAdmins` and the tag `GM` are
not (`Badminton` is caught too). `GUILD_RESERVED_NAMES=0` turns the reserved words off, for example to
create an official guild; the offensive words stay.

**The create** (`POST /guild`) takes only the game-server key from this machine: a player's token alone
gets 403 `{"code": ""}`, the key through the gateway or any proxy 403, and an unregistered key 401. The
game server passes on the leader id the client put in its RPC, and no token of that player: a bearer
token, if one comes along, is the game server's own login's (the executable takes the token of the
server's local user), so it is only logged, and a bad one is ignored (never a 500). Then, in order:

1. `leader_account_id` must be an account (400, empty code).
2. **The leader must have validated this very name and nameplate** (`POST /guild/validate` with their
   own token; the widget does it while they type) in the last 15 minutes. The last five validated
   pairs per player count, compared regardless of case. Otherwise 403 with an empty code ("Unable to
   create guild." in the client), logged as "no validate of this name and nameplate by the leader in
   the last 15 minutes"; a name the rules refuse anyway gets that rule's code instead. So nobody can
   make another player the leader of a guild that player did not name.
   `GUILD_CREATE_ACTIVITY_FALLBACK=1` also accepts a leader who validated another name or was heard
   from in the last minute (party poll, heartbeat), with a warning in the log; it is off because a
   modified client could then name any online player.
3. The leader is not in a guild (409 `OccupiedAdorableQuillshot`), and the name rules above.
4. At most one new guild per leader per 10 minutes (429, empty code).

A successful create uses up the leader's validated names.

**Other refusals:** not in a guild, or a target not in the caller's guild: 404
`ExcludedAdorableQuillshot`. Not allowed (a Member inviting, anyone but the leader kicking, changing
ranks or disbanding, the leader's own rank): 403 `SlyAdorableQuillshot`. Inviting yourself or a
member: 409 `ClonedAdorableQuillshot`. A live invite from the same guild: 409
`RedundantAdorableQuillshot`. The guild is full (invite and accept): 409 `StuffedAdorableQuillshot`.
An invite that is missing, expired or someone else's: 404 `UninvitedAdorableQuillshot`. An unknown
rank: 400 `DocileAdorableQuillshot`. An unknown account (404), a block either way (403, with a message that
does not say why) and the limits (429) answer an empty code.

**Limits:** `GUILD_MAX_MEMBERS` members per guild; invites stay open `GUILD_INVITE_TTL_DAYS` days (7);
50 open invites per guild and 30 invites sent per inviter per hour (429); after a player declines a
guild's invite, that guild cannot invite them again for 24 hours (429); a player keeps at most 20
open invites (the oldest is dropped; one guild holds at most one of them). Pending invites do not
reserve a place. A player in another guild can be invited but must leave it before accepting (409
`OccupiedAdorableQuillshot`).

**Invites that lapse:** a block removes the guild invites between the two players. An Officer's
invites are removed when the Officer is demoted to Member, kicked or leaves; a leader's stay when they
hand the guild over (they become an Officer). The invite list leaves out, and accepting answers 404
`UninvitedAdorableQuillshot` for, any invite between blocked players or whose inviter is no longer a
Leader or Officer of that guild.

### Slayer Links {#slayer-links}

Two friends link up for a week (the My Links tab; how the client reads each reply is on
[Friends, parties and guilds]({{ social_page.url | relative_url }}#slayer-links)). Stored in the
database (tables `slayerlinkinvites` and `slayerlinks`). On by default; with `SLAYER_LINKS=0` every
route below falls through to the empty 404 and the stored rows stay. Every route acts as the player of
the bearer token (no token 401, the game-server key alone 403); ids in a body or path only name the
other player. Replies use the envelope `{code: null, message: "OK", payload}`; refusals are
`{code: "<status>", message, payload: null}`.

| Method | Path | Access | What it does |
|:-------|:-----|:-------|:-------------|
| GET | `/slayerlink/status_good` | player | `{invites, links, config: {link_duration_hours: 168, invite_expiry_hours: 24}}`: the two lists below together, the client's poll for news. |
| GET | `/slayerlink/invites` | player | `{invites: [{account_id, slot, direction, status, expires, link_id}]}`: the caller's pending, unexpired invites; `account_id` is the other player, `direction` `Sent` or `Received`, `status` `Pending`, `slot` the sender's slot. |
| GET | `/slayerlink/links` | player | `{links: [{account_id, linked_account_id, slot, ends, link_id, prize_pool: []}]}`: running links, by the caller's slot; both id keys name the other player. |
| PUT | `/slayerlink/invite` | player | `{account_id, slot, action_source}`: invites a friend into one of the caller's slots (1-3, the client's numbers). Answers `{link_id}`, the invite's id; inviting the same player again answers the same id. |
| POST | `/slayerlink/invite` | player | `{account_id, action, slot, action_source}` with `action` `accept` or `reject` (the invited player; `account_id` is the sender) or `cancel` (the sender; `account_id` is the invited player). A `link_id` or `invite_id` in the body is tried first. An accept takes the body's `slot` when it is free, else the first free one. Answers `{link_id}`; repeating the same answer is 200 again. |
| DELETE | `/slayerlink/invites/:accountId` | player | With the caller's own id: withdraws every invite the caller sent and declines every one received. With another player's id: only the invites between the two. Answers `{}`. |
| DELETE | `/slayerlink/links` | player | `{account_id, slot, delete_pair}` (or the same as a query): ends the caller's link in that slot or with that player, for both players. Answers `{}`, also when there was nothing to remove. |
| POST | `/slayerlink/availability` | player | `{account_ids: [...]}` (at most 50) → `{availability: [{account_id, available}]}`: which of them the caller could invite now. |

Rules: both players must be accepted friends and neither may have blocked the other (403); 3 slots
per player and one waiting invite per slot; at most 20 new invites per player in 10 minutes; an invite lasts 24 hours and a link 168 hours; unfriending
or a block cancels the waiting invites between the two (a running link stays until it ends). Other
refusals: 400 (no account id, a slot outside 1-3, an unknown action), 404 (no such account or
invite), 409 (yourself, the slot is taken or has a waiting invite, already linked, the other player
already invited you, no free slot, the invite limit, the invite ran out or was answered). **Not answered** (404): the
reward routes `PUT /slayerlink/links/rewards` and `GET /slayerlink/links/rewards/:accountId/:slot`.

## Metagame: the management API {#undaunted-api}

All of these live under `/undaunted/api/` on the metagame; the paths below are relative to it.
**Through the gateway only four answer:**
`POST Register` and `GET`/`HEAD` of `GetUserInfo`, `ServerStatus` and `RegistrationStatus`. Every other
path under `/undaunted`, including `UsernameAvailable`, `PublicOnlineStats`, `PartyInvite`,
`Friends` and the guild routes, gets 403 from the gateway. Run the rest on the server itself (in public mode at
`http://127.0.0.1:61000`), or in private mode from a machine that can reach the metagame.

| Method | Path | Access | Gateway | What it does |
|:-------|:-----|:-------|:--------|:-------------|
| GET | `RegistrationStatus` | none | yes | `{RegistrationMode}`: `NONE`, `INVITECODE` or `OPEN`, the value in memory. With `REGISTRATION_MODE` unset the reply is `{}`. |
| POST | `RegistrationStatus` | admin key | no | Body `{RegistrationStatus: <mode>}`. Changes the mode in memory only; a restart goes back to `REGISTRATION_MODE`. 400 for an unknown mode. |
| POST | `Register` | none (gated by the registration mode) | yes, POST only | Creates an account; see [Register](#register). Returns `{UUK}`, the new account key, once. |
| GET | `UsernameAvailable` | none | no | `?Username=`: `{available}`, plus `error` and `message` when it is not. Checks the rules and the existing accounts only; registering can still lose a race. Nothing in the repository calls it. |
| GET | `GetUserInfo` | account key | yes | `{UserId, Username, IsAdmin}` for the key's account. The launcher, the friend kit and the content server use it to check a key. |
| GET | `ServerStatus` | registered | yes | The server's name, version, source and player list for the launcher; see [ServerStatus](#serverstatus). Never 401. |
| GET | `PublicOnlineStats` | account key | no | `{NumActivePlayers}`: players with a heartbeat in the last 90 seconds. |
| POST | `PartyInvite` | account key (admin key for `From`) | no | `{Username, From?}`: the key's owner invites that player to their party; the friend still accepts in the game. Answers `{From, To}`. |
| POST | `Friends` | account key (admin key for `From`) | no | `{Username, From?}`: sends a friend request, or accepts the one that player sent. Answers `{From, To, Result}`, `Result` = `requested`, `accepted`, `already_friends` or `already_requested`. |
| POST | `GuildInvite` | account key (admin key for `From`) | no | `{Username, From?}`: the key's owner (or `From`) invites that player to their guild, with the same checks as the game's own invite; the player still accepts in the game. Answers `{From, To, Guild}`. |
| GET | `Guilds` | admin key | no | Every guild: `[{guildId, name, nameplate, leader, members}]`, `members` being a count. |
| POST | `DisbandGuild` | admin key | no | `{Guild}` (the id, or the name in any case): removes the guild, its members and its invites. Answers `{Guild, Members}`; 404 `not_found` for an unknown guild. |
| GET | `InviteCodes` | admin key | no | `{InviteCodes: [{inviteCode, usesRemaining, infiniteUses}]}`. **The reply contains live invite codes.** |
| POST | `CreateInvite` | admin key | no | `{uses?, name?}` → `{code}`. A random `XXXX-XXXX-XXXX` code from Crockford's base32 alphabet (60 random bits). `uses` is 1 to 1000 (default 1). `name` is a note for the log and is not stored; the log shows only the code's first group. |
| POST | `RegisterInviteCode` | admin key | no | `{NewInviteCode, Uses, InfiniteUses}`: stores a code you chose (`Uses` a whole number of at least 1 unless `InfiniteUses`). The older way; `New-Invite.ps1` uses it only against a metagame without `CreateInvite`. |
| DELETE | `InviteCode/:code` | admin key | no | Revokes a code. Always 200. |
| GET | `GetAllUsers` | admin key | no | `{Users: [{Username, UserId}]}`. |
| POST | `RenameUser` | admin key | no | `{UserId}` or `{Username}` (the current name, any case) plus `{NewUsername}` → `{UserId, OldUsername, Username}`. Renames the account and its characters together; the player sees it after logging in again. |
| POST | `GenerateJWTForUserId` | admin key | no | `{UserId}` → `{JWT}`: a 24-hour player token for any account, which amounts to playing as them. The id is not checked. |
| GET | `PrivateOnlineStats` | admin key | no | A list of `{UserId, Map, HuntId, EnteredHuntAt}` for players with a heartbeat in the last 90 seconds. |
| GET | `SaveHistory` | admin key | no | `?UserId=` or `?CharacterId=` → `{Characters: [...]}`: the saved versions of character data and loadouts, without the data itself. 400 without either, 404 when nothing is found. |
| POST | `RollbackCharacter` | admin key | no | `{CharacterId, Version}`: puts a character's data back to a version from `SaveHistory`. 404 for an unknown character or version, 409 on a conflict. The player should be offline. |
| POST | `RollbackLoadout` | admin key | no | The same for the character's loadouts, with a loadout version. |
| GET | `Progression` | admin key | no | `?UserId=` → `{UserId, RealMode, HuntPass, Tracks, Objectives, Entitlements}`. Each track also shows `earned_free_rank` and `earned_premium_rank`, the ranks the game will show. 404 for an unknown account. |
| POST | `SeedProgression` | admin key | no | `{UserId, Mode}`. `grandfather` puts every track at its max rank, fully confirmed (nothing is granted); `fresh` puts every track at 0 and clears the objectives. Answers `{UserId, Mode, RealMode, Tracks}`; 400 for any other `Mode`, 404 for an unknown account. The account reads these rows whenever it has real progression. Run it while the player is offline; [Upgrade notes]({{ upgrade_page.url | relative_url }}) has a script. |
| POST | `GrantEntitlement` | admin key | no | `{UserId, Entitlement, Duration?}` (hours; 0, the default, is permanent) → `{UserId, Entitlements}`. |
| POST | `RevokeEntitlement` | admin key | no | `{UserId, Entitlement}` → `{UserId, Revoked, Entitlements}`. A revoked default entitlement stays revoked until it is granted again. |

Admin grants and revokes are recorded in the progression event log like the game server's own.

### Register {#register}

`POST /undaunted/api/Register` with the body `{"Username": "...", "InviteCode": "..."}`:

- **Usernames** are trimmed, then must be 3 to 16 letters, digits or underscores
  (`^[A-Za-z0-9_]{3,16}$`) and unique regardless of case. Accounts made before these rules keep their
  names; the rules apply to new names and renames.
- `NONE` refuses everyone. `INVITECODE` needs a valid code. `OPEN` ignores the code.
- The name's format is checked first. Then everything happens in one database transaction, in this
  order: the invite is checked, then whether the name is taken, and only then is one use of the code
  spent and the account written. A taken name never costs the player their code, and a use is never
  spent twice.
- If `REGISTRATION_MODE` is unset or not one of the three modes, Register answers an empty 500.
- The reply `{UUK}` is the account's only copy of its key. **It is a secret**: whoever runs the call
  must save it straight to a private file.
- Through the gateway, Register has its own rate limit: 5 at once, then one every 5 minutes per
  address.

### Error codes of the account routes

`Register`, `RenameUser`, `CreateInvite`, `UsernameAvailable`, `PartyInvite`, `Friends`,
`GuildInvite`, `DisbandGuild` and `Guilds` explain a refusal as `{"error": <code>, "message": <text>}`:

| Code | Status | Where | Meaning |
|:-----|:-------|:------|:--------|
| `registration_closed` | 400 | Register | The registration mode is `NONE`. |
| `bad_request` | 400 | Register, RenameUser, CreateInvite, and bad JSON on all seven POST routes | The body is not JSON, or a field is missing or of the wrong type. |
| `username_invalid` | 400 | Register, RenameUser, UsernameAvailable | The name breaks the rules above. |
| `invite_invalid` | 401 | Register | The code is missing, wrong or used up. |
| `username_taken` | 409 | Register, RenameUser, UsernameAvailable | Another account has that name, in any case. |
| `not_found` | 404 | RenameUser, PartyInvite, Friends, GuildInvite, DisbandGuild | No such account. A name that matches two older accounts in different case matches neither. |
| `forbidden` | 403 | PartyInvite, Friends, GuildInvite | `From` was given by a key that is not an admin's. |
| `party_invite_refused` | the party's status | PartyInvite | The party refused the invite (full, not the leader, blocked and so on). |
| `self`, `blocked`, `limit` | 400, 403, 409 | Friends | Yourself; one of the two has blocked the other; 200 friends or requests. |
| `pending_limit`, `rate` | 409 | Friends | 50 requests sent are still unanswered; 20 new requests in the last 10 minutes. |
| `guild_refused` | the guild's status | GuildInvite | The guild refused the invite; `message` starts with the guild code (for example `RedundantAdorableQuillshot: ...`) when there is one. |
| `guilds_off` | 404 | GuildInvite, DisbandGuild, Guilds | `GUILDS=0`. |

`UsernameAvailable` always answers 200, with `available: false` and the code. The other routes of this
API refuse with a bare status code and no body.

### ServerStatus {#serverstatus}

`GET /undaunted/api/ServerStatus` answers everyone, so a launcher that has not registered yet can still
read the server's name and registration mode:

```json
{
  "name": "Dauntless Revived", "online": true, "version": "...", "commit": "...",
  "sourceUrl": "https://github.com/...", "registration": "INVITECODE",
  "playersOnline": 1,
  "players": [{ "name": "Slayer_one", "where": "city", "instance": "..." }],
  "instances": [{ "id": "...", "kind": "city", "title": "Ramsgate", "map": "...", "behemoth": null,
                  "players": 1, "maxPlayers": 32, "startedAt": "..." }],
  "contentPort": 61002, "uptimeSeconds": 3600, "limited": false
}
```

- A caller with a valid account key, or a valid token of an existing account, gets the full answer.
  Everyone else gets the same shape with `playersOnline` 0, empty `players` and `instances`, and
  `limited: true`.
- It never contains account ids, keys or addresses: only usernames. `where` is `menu`, `city`, `hunt`,
  `dojo`, `tutorial` or `unknown`, worked out from the heartbeat's map. A player counts as online for
  90 seconds after their last heartbeat.
- The game servers come from the deploy server's `GET /gameservers` (2-second timeout); without an
  answer the list is empty.
- `name`, `version`, `commit` and `sourceUrl` come from `SERVER_NAME`, `SERVER_VERSION`, `GIT_COMMIT` and
  `SOURCE_URL`, else from the build and the defaults. `contentPort` is `CONTENT_PORT`, or `null`.
  `registration` is `NONE` when `REGISTRATION_MODE` is unset or not one of the three modes.
- Each variant is cached for 5 seconds. The reply carries `Cache-Control: no-store` and varies on the
  key header and `Authorization`.

## Chat (XMPP on 61099) {#chat}

The game's text chat (Ramsgate and hunt chat, party chat, guild chat and whispers) is XMPP over
WebSocket, served by the metagame itself when `CHAT=1`, on `127.0.0.1:61099`. It is not HTTP: the
client opens a WebSocket (request target `//`, protocol `xmpp`) and exchanges one stanza per message.
In public mode the gateway forwards that upgrade from the launcher relay. Why each answer has its shape,
with the addresses in the executable, is on [Text chat]({{ chat_page.url | relative_url }}); the
settings and limits are on [Configuration]({{ config_page.url | relative_url }}#metagame-chat).

**Login.** `<open>` (the domain comes from its `to`, default `prod.ol.epicgames.com`), SASL `PLAIN`
with the account id and the player token (the token must be valid and belong to that account), a
second `<open>`, then a bind: the resource is echoed as sent. A refused login answers `<failure>` with
`<not-authorized/>` (or `<temporary-auth-failure/>` while that account or address is held back); the
client's legacy `jabber:iq:auth` try after it gets an error and the connection is closed. A connection
gets one login attempt and at most four frames before it is logged in, and must bind within 10 s of
its login.

The `<open to>` domain may be a hostname or the launcher's `host:port` endpoint. The latter is kept
verbatim because 1.4.4 also uses it as the suffix in its room JIDs.

**What the server answers:**

| The client sends | The server |
|:-----------------|:-----------|
| `<presence to="Room@(muc|conference).<domain>/<nickname>">` (join) | Checks the room and the nickname. If an older connection of the same account is in the room (a reconnect while the old one lingers), it leaves first: the others get its unavailable presence, and the old connection is told nothing. Then sends the joiner every other occupant's presence, tells every other occupant about the joiner, and sends the joiner's own presence (status 110) last. Every occupant presence carries `<item jid="<account>@<domain>/<resource>">`, and every `from` is the room JID with the occupant's nickname exactly as sent. |
| `<presence type="unavailable" to="Room@...">` (leave) | The others get the leaver's unavailable presence; the leaver gets its own with status 110. |
| `<message type="groupchat" to="Room@muc.<domain>">` | Delivered to every occupant, the sender included, from `Room@muc.<domain>/<sender's nickname>`, with the same `id`. Not to occupants who blocked the sender. |
| `<message type="chat" to="<account>@<domain>[/<resource>]">` (whisper) | Delivered from the sender's full JID to that session, or to every session of the account. Not delivered, with no error, when the player is offline or either player blocked the other. |
| A broadcast `<presence>` (no `to`) | With `CHAT_PRESENCE` off (the default): recorded and dropped, never echoed or relayed. With `CHAT_PRESENCE=1`: relayed from the sender's full JID, `<show>` and `<status>` unchanged, to the sessions of each accepted, unblocked friend that have sent a presence of their own; at a session's first presence it also gets theirs. Never to a session of the sender's own account. |
| `<presence type="unavailable">` (no `to`), or the connection ends | With `CHAT_PRESENCE=1`: `type="unavailable"` from the full JID to the same friends, then the presence of the account's other session if it has one. |
| `<iq>` ping, session or anything else | An empty `result` with the same `id`. |
| `<close/>` | `<close/>`, then the connection closes. |

After 50 s of silence the server pings the client, and ends the connection when another 100 s pass
without an answer (the client answers from its game-thread tick, which a map load holds up). A client
that stops reading is sent nothing more once 256 KiB wait unsent, and its connection ends.

**Pushed by the server, only with `CHAT_PRESENCE=1`:** when a friend request is accepted over HTTP,
every session of both players gets `<message from="xmpp-admin@<domain>">` whose body is the client's
friends-list update `{"type": "com.epicgames.friends.core.apiobjects.Friend", "payload": {"accountId",
"status": "ACCEPTED", "direction", "created"}, "timestamp"}`, and the two exchange presences; an
unfriend or a block sends each the other's unavailable. Details: [Text chat]({{ chat_page.url | relative_url }}#presence).

**Rooms.** `City-<id>`, `Hunt-<id>` and `General<id>` are open to every signed-in player,
`Party-<partyId>` only to that party's members and `Guild-<guildId>` only to that guild's. All live on
`muc.<domain>` or its live-client `conference.<domain>` alias. A player who left the party or guild is removed with status 307.

**Refused joins** are an error presence from the room JID, which the client handles as a failed join:

| Why (`chat: join refused ... reason=`) | `<error>` |
|:----------------------------------------|:----------|
| The nickname is not `<name>:<own account id>:<own resource>`, holds another account id, or its name is not the account's username (`nick-account`, `nick-resource`, `nick-format`, `nick-name`); not a member of the party or guild (`not-member`) | `type="auth"`, `<forbidden/>` |
| A room name the client never builds, or another domain (`not-allowed`) | `type="cancel"`, `<not-allowed/>` |
| The nickname is held by another connection (`conflict`) | `type="cancel"`, `<conflict/>` |
| Too many rooms, occupants or joins (`limit`) | `type="wait"`, `<service-unavailable/>` |

A room message that cannot be delivered (not in the room, an empty or over-long body, too many
messages) gets `<message type="error">` with `<not-acceptable/>`; the connection stays open.

**Names** come from two account routes the client calls with its own token:
`GET /account/api/public/account/<own id>` for its own name at login, and
`GET /account/api/public/account?accountId=<id>` for the sender of another player's line (see
[Login and accounts](#login-and-accounts)).

## Deploy server {#deploy-server}

The deploy server starts and watches the game-server processes. It has two routes and **no
authentication**. Both answer 403 to any caller that is not on loopback or that carries a proxy
header, and the service binds `127.0.0.1` by default. The gateway has no route to it. **Never open
its port.**

| Method | Path | Access | What it does |
|:-------|:-----|:-------|:-------------|
| POST | `/api/matchmaker/handle-matchmaking-for-player` | none; loopback only | Body `{GameMode, GameArgs, HuntId, ExpectedPlayers}` (at most 16 account ids). Starts or picks a game server and answers `{host, port}`, where `host` is `MY_IP`. `CITY`: Ramsgate. `SHARED` with the hunt id `ShatteredIsles_TrainingDojo`: the Dojo, started on first use (or at boot with `ENABLE_DOJO=1`). `ISLAND` with game args: the map in the args (the tutorial). `ISLAND` with a hunt id and expected players: a new hunt server. Anything else: Ramsgate. Before handing out Ramsgate or the Dojo it checks that the process is alive and starts a dead one first (`PERSISTENT_WORLD_LIVENESS`, on), through the same single launch the boot and the watchdog use. 400 `{error: "bad_request", message}` for input that fails the checks; 500 `{error: "no_game_server"}` when no game server could be started (no free hunt port, a spawn that failed). |
| GET | `/gameservers` | none; loopback only | The running game servers: `{servers: [{id, port, kind, map, gameMode, behemoth, huntId, matchmakerHuntId, expectedPlayers, maxPlayers, startedAt}]}`, with `kind` = `city`, `hunt`, `dojo` or `tutorial`. It lists account ids, so it is for the metagame only. |

- The metagame calls it over plain HTTP, without credentials, at `DEPLOYSERVER_URL` (`host:port`, no
  scheme). Because of the loopback rule that must be `127.0.0.1:<port>` in both modes: a Tailscale or
  LAN address gets 403 on every call.
- The matchmaking input is checked twice, by the metagame and again here, because it ends up on a
  game server's command line.
- It answers as soon as the process is spawned, not when the server is ready. Launches are queued
  `SECONDS_TO_WAIT_BETWEEN_GAMESERVER_STARTUP` apart.
- When no hunt port is free, or the game server could not be spawned, the request fails with 500
  `{error: "no_game_server"}` (the deploy server logs `Matchmaking for <mode> <hunt> failed: No free
  ports left!` or the spawn error), and the metagame answers the players' status polls with `FAILED`.
  So does any other failure of this call: another status, a reply without a host, a quoted port, a
  body that is not JSON or a dropped connection.
- There is no catch-all: an unknown path gets Express's default HTML 404. JSON bodies are limited to
  Express's default of 100 kB. Errors include stack traces unless `NODE_ENV=production`.

## Content server {#content-server}

The content server hands the verified 1.4.4 game files to registered players' launchers, and serves
the host's art pack and news. It only answers `GET` and `HEAD`, and there is no directory listing.

| Method | Path | Access | What it does |
|:-------|:-----|:-------|:-------------|
| GET, HEAD | `/content/v1/manifest` | none | The file list of the build: `{build, totalBytes, files: [{path, size, sha256}]}`. With an `ETag`; `If-None-Match` gets 304. |
| GET, HEAD | `/content/v1/files/<path>` | account key | One game file; `<path>` must match a manifest path exactly. One byte range per request (`Range`, `If-Range`); the `ETag` is the file's SHA-256. |
| GET, HEAD | `/content/v1/branding` | none | The host's art pack: `{backgrounds: [{url, credit}], accent}`. |
| GET, HEAD | `/content/v1/branding/<file>` | none | One art image: jpg, png or webp, at most 25 MB. |
| GET, HEAD | `/content/v1/news` | none | The host's news: `{items: [{date, title, body}]}`. |

- The public routes send `Access-Control-Allow-Origin: *`. Branding and news are empty unless the
  host sets `CONTENT_BRANDING_DIR` and `CONTENT_NEWS_FILE`.
- **The key check.** The content server asks the metagame's `GET /undaunted/api/GetUserInfo` (at
  `METAGAME_URL`, default `http://127.0.0.1:61000`) who the key belongs to. It caches the answer by the
  key's SHA-256: accepted keys for `CONTENT_AUTH_CACHE_SECONDS` (300), refused keys for 30 seconds. It
  never stores or logs the key itself. A value that is not 1 to 256 printable characters without
  spaces is refused without asking.
- The checks run in this order: the path, the manifest, then the key. A path that is not in the
  manifest gets 404 even without a key.

| Status | `error` | When |
|:-------|:--------|:-----|
| 400 | `bad_path` | The file path is not clean: encoded separators, `..`, double encoding and similar. |
| 401 | `unauthorized` | No key, or the metagame does not know it. |
| 404 | `not_found` | Not one of the five routes (whatever the method), not in the manifest, or no such image. |
| 405 | `method_not_allowed` | Anything but `GET` and `HEAD` on one of the five routes (`Allow: GET, HEAD`). |
| 416 | `range_not_satisfiable` | The range lies outside the file. |
| 429 | `too_many_streams` | The account already has `CONTENT_MAX_STREAMS_PER_ACCOUNT` (6) downloads running. `Retry-After: 2`. |
| 503 | `auth_unavailable` | The metagame could not be asked. `Retry-After: 5`. |
| 503 | `file_unavailable` | The file is missing, or changed on disk since the server started. |
| 503 | `server_busy` | `CONTENT_MAX_STREAMS_TOTAL` (48) downloads are running. `Retry-After: 10`. |

## Gateway {#gateway}

The gateway exists only in public mode. It is HTTPS (TLS 1.2 or newer) with a self-signed
certificate that the launcher pins by fingerprint, on `GATEWAY_BIND` (`0.0.0.0`) and `GATEWAY_PORT`
(443).
[UndauntedGateway/README.md]({{ site.github.repository_url }}/blob/dauntless-revived/UndauntedGateway/README.md)
covers its limits, timeouts and access log in more depth.

| Request | Goes to | Default |
|:--------|:--------|:--------|
| `/content` and `/content/...` | The content server | `GATEWAY_CONTENT_URL`, `http://127.0.0.1:61002` |
| `GET` with `Upgrade: websocket` | The WebSocket upstream: the metagame's [chat](#chat) | `GATEWAY_WS_URL`, `http://127.0.0.1:61099`. With chat off nothing listens there, and upgrades get 502. |
| Everything else | The metagame | `GATEWAY_METAGAME_URL`, `http://127.0.0.1:61000` |

The upstream addresses must be plain `http://` on this machine, so the secret header never leaves it.
There is no route to the deploy server or the allowlist helper.

**What it refuses.** Refusals are JSON `{"error": <code>}`:

| Status | `error` | When |
|:-------|:--------|:-----|
| 400 | `bad_request` | The request target is not a plain path (`/...`), an unsupported upgrade, or a malformed request. |
| 400 | `bad_path` | A backslash, whitespace or a control character in the path, a `.` or `..` segment, `%2f`, `%5c`, `%00` or `%2e`, or broken percent-encoding. |
| 403 | `forbidden` | Any `x-undaunted-gameserver-apikey` header. Any path under `/undaunted` except the four public ones (also for upgrades). |
| 405 | `method_not_allowed` | Anything but `GET`, `HEAD`, `POST`, `PUT`, `DELETE`, `PATCH` and `OPTIONS`. |
| 408, 431 | `request_timeout`, `headers_too_large` | Headers too slow or too large. |
| 413 | `body_too_large` | A body over `GATEWAY_MAX_BODY_BYTES` (128 KiB). |
| 429 | `rate_limited` | The address's rate bucket is empty; with `Retry-After`. |
| 502, 504 | `bad_gateway`, `upstream_timeout` | The upstream is down or does not answer. |

The `/undaunted` check runs on the path in lower case, percent-decoded, with repeated slashes folded
and trailing slashes dropped, so letter case or encoding cannot slip an admin route past it.

**Rate limits.** Token buckets per IPv4 address, or per IPv6 /64. Refused requests count too.

| Bucket | Counts | Burst | Refill per minute | Setting |
|:-------|:-------|------:|------------------:|:--------|
| general | Everything not below | 300 | 180 | `GATEWAY_RATE_GENERAL` |
| content | `/content` | 600 | 600 | `GATEWAY_RATE_CONTENT` |
| register | `/undaunted/api/Register` | 5 | 0.2 | `GATEWAY_RATE_REGISTER` |
| token | `/account/api/oauth/token` | 10 | 1 | `GATEWAY_RATE_TOKEN` |
| connect | New TCP connections | 200 | 300 | `GATEWAY_RATE_CONNECT` |

An address may also hold at most 128 open connections (`GATEWAY_MAX_CONNECTIONS_PER_IP`), and the
gateway at most 2048 in total (`GATEWAY_MAX_CONNECTIONS`).

**Headers.** The gateway sets `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Dauntless-Gateway` as
described under [Public mode](#public-mode), and drops hop-by-hop headers in both directions. It
removes `X-Powered-By` and `X-Dauntless-Gateway` from answers. Its access log never contains headers or
bodies, and tokens and keys in a request path are replaced.

**Opening the game ports.** When `POST /heartbeat` with a bearer token, or
`POST /account/api/oauth/token`, gets a 2xx answer, the gateway reports the player's address to the
allowlist helper, at most once per `GATEWAY_ALLOWLIST_REFRESH_SECONDS` (60) per address. The helper
then opens the UDP game ports to that address for 10 minutes. The player's request never waits for
the helper. `GATEWAY_ALLOWLIST=0` turns this off, and then no game ports open for anyone.

## Allowlist helper {#allowlist-helper}

A small HTTP service on `127.0.0.1:61005` (`ALLOWLIST_BIND`, `ALLOWLIST_PORT`) that keeps one Windows
Firewall rule. It runs with administrator rights, because it edits the firewall. Only the gateway
calls `/allow`; the kit's `Stack.ps1 status` reads `/status`.

| Method | Path | Access | What it does |
|:-------|:-----|:-------|:-------------|
| POST | `/allow` | allowlist secret | Body `{ip}` (at most 1 KB). Adds the address to the rule, or refreshes it, for `ALLOWLIST_TTL_SECONDS` (600). Answers `{ip, added, ttlSeconds}`. 400 `invalid_ip` for a private address (unless `ALLOWLIST_ALLOW_PRIVATE=1`) or a malformed one; 503 `allowlist_full` beyond `ALLOWLIST_MAX_ENTRIES` (256). |
| GET | `/status` | allowlist secret | `{dryRun, allowPrivate, ttlSeconds, ports, entries: [{ip, expiresAt}], pending, lastApply}`. The ports are `ALLOWLIST_PORTS`, 8770-8777 by default. |

Other answers: 400 `bad_request` for a body that is not JSON, 401 for a missing or wrong secret, 403
for a caller that is not on loopback, 404 for any other path, 405 for the wrong method, 413 for a
larger body. The `entries` are players' addresses:
keep `/status` output private.

## Launcher relay {#launcher-relay}

In public mode the friend launcher runs a relay on the player's own PC, on `127.0.0.1:61000`, while
the game runs. `DAUNTLESS_REVIVED_RELAY_PORT` changes the port, for tests and rehearsals only: the
server side (for example the ping target in `QOS_TARGET_URL`) expects 61000. The game talks plain HTTP to it,
and the relay forwards every request, including WebSocket upgrades, unchanged over TLS to the
gateway. The connection is pinned to the certificate fingerprint from the invite.

- 403 `forbidden` for a caller that is not local, a `Host` or `Origin` that is not loopback, or any
  `Sec-Fetch-*` header on a plain request. This keeps web pages (and DNS rebinding) from using the
  relay.
- 501 `unsupported_transfer_encoding` for a `Transfer-Encoding` other than chunked.
- 502 `certificate_mismatch` when the server's certificate is not the pinned one, and 502
  `upstream_unreachable` when the gateway cannot be reached.

[Windows server kit]({{ winserver_page.url | relative_url }}#how-public-mode-works) explains the whole
public-mode path, from the game to the relay, the gateway and the game ports.

## Examples {#examples}

Put a time limit on every call, so a wrong listener fails fast (see
[Troubleshooting]({{ trouble_page.url | relative_url }}#invoke-restmethod-hangs)).

Anyone, on the server (or over Tailscale with its address):

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:61000/undaunted/api/RegistrationStatus -TimeoutSec 10
Invoke-RestMethod -Uri http://127.0.0.1:61000/undaunted/api/ServerStatus -TimeoutSec 10
```

Admin calls, on the server itself. The key is read from its file and never printed. The owner key is
`C:\dr\data\owner.key` on a host set up with [Host a server]({{ host_page.url | relative_url }}), and
`C:\DauntlessRevived\data\keys\owner.key` on a kit server:

```powershell
$api = "http://127.0.0.1:61000/undaunted/api"
$h = @{ "x-undaunted-user-api-key" = (Get-Content C:\dr\data\owner.key -Raw).Trim() }

(Invoke-RestMethod -Uri "$api/GetAllUsers" -Headers $h -TimeoutSec 10).Users

$body = @{ Username = "OldName"; NewUsername = "New_Name" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$api/RenameUser" -Headers $h -ContentType "application/json" -Body $body -TimeoutSec 10

$h = $null
```

To make an invite, use `New-Invite.ps1` on a kit server; it calls `CreateInvite` and prints the full
invite. On a hand-built host, `POST $api/CreateInvite` with the body `{"uses": 1}` answers
`{"code": "XXXX-XXXX-XXXX"}`. **The code is a credential**: send it to one friend, privately.

## Changing the routes {#changing-the-routes}

- `UndauntedMetagame/test/permissions.test.ts` pins the list of every metagame route with its access
  checks, in registration order. Adding a route or changing its checks fails that test until the list
  is updated, which forces a decision about who may call it.
- The gateway's tests read `UndauntedMetagame/src/routes/undauntedapi.ts`, so every new
  `/undaunted/api` route is automatically tested as blocked by the gateway. Only a route added to
  `PUBLIC_UNDAUNTED_API` in `UndauntedGateway/src/policy.ts` becomes reachable from the internet.
- A new game route is reachable through the gateway as soon as it exists. Give it an access check.

[Developer guide]({{ dev_page.url | relative_url }}) covers building and running the tests.
