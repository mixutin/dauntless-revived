---
title: Text chat
parent: Findings
nav_order: 10
description: "How the Dauntless 1.4.4 client does text chat against our server, read from the executable: why the first chat server showed UID-... instead of names, the room nickname and how we check it, which rooms exist and who may join them, and what is still unconfirmed."
lang: en
ref: findings/chat
---

{% assign api_page = site.pages | where: "path", "reference/api.md" | first %}
{% assign config_page = site.pages | where: "path", "reference/configuration.md" | first %}
{% assign ports_page = site.pages | where: "path", "reference/ports.md" | first %}
{% assign social_page = site.pages | where: "path", "findings/social.md" | first %}
{% assign trouble_page = site.pages | where: "path", "setup/troubleshooting.md" | first %}
{% assign winserver_page = site.pages | where: "path", "setup/windows-server.md" | first %}
{% assign harmonic_page = site.pages | where: "path", "findings/harmonic-fork.md" | first %}

# Text chat in 1.4.4
{: .no_toc }

This page describes how the **1.4.4** client's text chat works against our server: Ramsgate and hunt
chat, party chat, guild chat and whispers. It explains why the first chat server showed every sender
as `UID-...`, what the client needs to show usernames, how the server keeps anyone from posing as
another player, and what is still unconfirmed.

**Status (22 September 2026): built and tested without the game, off by default, not yet tried by two
players.** The chat listener runs inside the metagame when `CHAT=1`
([Configuration]({{ config_page.url | relative_url }}#metagame-chat)). Every rule below is covered by
tests that feed the server's replies to a model of the client, read from the executable. The live
two-player test on the rented server confirms or corrects them.

The first chat server was written and tested with a real 1.4.4 client by **Vvoidddd**
([pull request #9](https://github.com/mixutin/dauntless-revived/pull/9)). His observations are what
this page explains, and his code is what the server grew from.

**Update (23 September 2026): friends' online status is built into the chat server, off by default**
(`CHAT_PRESENCE=1`, together with `CHAT=1`): [Friends' online status](#presence). The idea of a
presence service comes from **Harmonic's** 1.4.4 fork; the code is our own and shares nothing with the fork's
(see [The Harmonic port]({{ harmonic_page.url | relative_url }}#social)).

<details open markdown="block">
  <summary>Contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

## Evidence and confidence {#evidence-and-confidence}

| Label | Source |
|:------|:-------|
| **B** | The 1.4.4 executable (`Dauntless-Win64-Shipping.exe`): strings and disassembly. Addresses are virtual addresses with image base `0x140000000`. |
| **S** | Strong inference: one link in the chain was not traced. |
| **G** | A guess, or a design decision of ours where nothing in the client decides it. |
| **O** | Observed by Vvoidddd with a real 1.4.4 client on 22 September 2026 (one client). |
| **C** | Our own code and tests. |

## How chat reaches the server {#transport}

The game's chat is XMPP over WebSocket. Its connection is set in `Engine.ini`
(`[OnlineSubsystemMcp.XMPP]`), which the launcher and the server kit point away from Epic
([Ports and network]({{ ports_page.url | relative_url }}#chat-port)).

- **Public mode** (our rented server): the game connects to the launcher's local relay
  (`ws://127.0.0.1:61000`), which carries the connection over TLS to the gateway, which forwards it to
  the metagame's chat listener on `127.0.0.1:61099`. The request target is `//`, not `/`
  (B `0x1441f761f`), and every hop accepts that (C). No firewall rule is needed: 61099 stays on
  loopback, and launchers from v0.1.0 on already relay it.
- **One PC**: the game connects to `ws://127.0.0.1:61099` straight.
- **Private mode** (Tailscale): not supported yet. The listener refuses any address other than
  loopback.

The client logs in with SASL PLAIN, sending its account id and the same signed token it uses for the
metagame (B `0x144218640`). The server checks the token, and that it belongs to that account, before
anything else. Then the client binds a resource of the form `V2:<AppId>:WIN::<32 hex>`, new at every
login (B `0x143a3ca5a`), which the server echoes unchanged.

## Why the first server showed UID-... {#why-uid}

The client joins every room with a **nickname** it builds itself (B `0x1408b5aeb`):

```
Printf("%s:%s:%s", UrlEncode(DisplayName), AccountId, OwnResource)
  -> Alpha:UID-aaaa...:V2:MissingGameServiceForAppId:WIN::A1B2...
```

The username is already there, in the first part. The client reads names back out of the nickname of
whoever sent a line: it splits the nickname at `:`, takes the first part (URL-decoded) as the name and
the second as the account id, and takes the member id from the presence's `<item jid>` when there is
one (B `0x1408fe300`, `0x1408c3500`).

The first server threw the nickname away. It answered every join and sent every message from
`<room>/UID-...`, with no `<item jid>`. That resource has no `:`, so the client took the whole
resource, `UID-...`, as the name, and the room JID's full path as the member id (B `0x1408c3686`,
`0x1408aea40`). That id is nobody's account, so even the player's own lines went down the "other
member" path: the account lookup found nobody, and the client fell back to the name it had,
`UID-...` (B `0x1408fe9c0` -> `0x140987d90`, `0x14097fc20`). An XEP-0172 `<nick>` element does not help:
its namespace is not in the executable (B).

### What each attempt did, and why {#attempts}

| What was tried (O) | What the game did (O) | Why (B) |
|:-------------------|:----------------------|:--------|
| Answer from `<room>/UID-...` | The join completed; lines showed `UID-...` as the sender. | The client's "is this me?" test is a case-sensitive search for its own account id in the nickname (`0x143a34acd`-`0x143a34aec`), so the join completed. The name: see above. |
| Answer from `<room>/<username>` (also with status 210) | Room joins stayed pending; the next join said "Another operation already pending". | The username does not contain the account id, so the client never recognised its own presence and the room stayed in JoinPublicPending (state 4). A new join to a room in state 4 is refused (`0x143a32938`-`0x143a32990`). Status 110 and 210 are not read. |
| Presence from `UID-...`, messages from `<username>` | `[unknown]` | A line is matched to its sender through an earlier occupant presence from the same room JID (`0x1408a83c0`). None matched, so the sender kept the default nickname "unknown" (`0x14087ed65`). |
| `JoinPublicRoom failed. Not currently connected` for City and Party rooms | (in the client log) | The XMPP connection was not logged in at the moment of those joins (`0x143a327fe`); the client retries them (S). It has nothing to do with names. |

His conclusion, "keep the UID in the room address", fits these results, but the reason is a
different one: the account id does belong in the room address, inside the nickname and together with
the username, exactly as the client sent it.

A second player would have seen his lines as `[unknown]`: the first server never told other occupants
that someone had joined (our client model predicts this; it was never run with two clients).

## What makes names show {#names}

Three server rules, all in `src/realtime/muc.ts` (C):

1. **Keep every nickname byte for byte** and use it in every `from` for that occupant, presence and
   messages alike. Never swap in the account id or a display name, never assign a nickname, never
   rename on a clash.
2. **Put `<item jid="<account>@<domain>/<resource>">` in every occupant presence**, the player's own
   included. The member id comes from it.
3. **Tell occupants about each other both ways**, and send every room message back to its sender too,
   from the same room JID. Without an occupant presence first, a line shows as `[unknown]`.

The join order matters (B `0x143a34c19`, `0x143a34c0f`): the joiner first hears of everyone already in
the room, then they hear of the joiner, and the joiner's own presence (status 110) comes last. Its own
presence is what completes the join on its screen.

A leave is answered with the player's own unavailable presence (status 110) as well as the notice to
the others. Without it the room stays in ExitPending (state 5) and the next join to it is refused.

The metagame needed no change for names. Both account lookups the client uses already answer
`displayName` to a caller with a valid token. The token answer's `displayName` is never read by the
client (B `0x1408e8303`, `0x1408a8a10`), so adding one would change nothing.

## What each player sees {#what-each-player-sees}

| Line | Where the name comes from |
|:-----|:--------------------------|
| Another player's room line | `GET /account/api/public/account?accountId=<id>`, that player's `displayName`. The id comes from `<item jid>` (B `0x1408fe9c0` -> `0x140987d90`). |
| Your own room line | The client recognises the member id as its own (B `0x1408febd5`) and shows its own social name (S: the name the Social panel shows for you). |
| A whisper | The same account lookup. If the sender is not found, the whisper waits (S). |
| When a lookup finds nobody | The nickname's first part, URL-decoded (B `0x14097fc20`; the shipped config trusts it). |
| "Entered room" and "left room" notices | Probably the nickname's first part (G). |

The client's own name comes from `GET /account/api/public/account/<own id>` at login, read by
`GetPlayerNickname` (B `0x14092bad0`). When that read fails, the name is the literal
`InvalidMCPUser`, never empty (B `0x14092bc0b`). After an admin rename the client keeps the old name
until its next login (S).

## The nickname check (anti-spoofing) {#nickname-check}

The nickname is the only text a client controls that other clients read. The server knows each
connection's account from its token, so a join is **refused** unless the nickname is exactly:

```
<name>:<own account id>:<own bound resource>
```

- The part after the first `:` must be the connection's own account id and resource, case included
  (`nick-account` or `nick-resource` in the log).
- No other account id may appear anywhere in the nickname. The client's "is this me?" test is a
  substring search, so a stranger's nickname carrying your id would read as your own presence on your
  screen, and their leave would end your membership (`nick-account`).
- `<name>` may only hold the characters the client's URL encoder writes: `A-Z a-z 0-9 - _ . ~` and
  `%XX` (B `0x1428aebb0`). It must decode to valid UTF-8 (`nick-format`).
- Decoded, `<name>` must be the account's username (now, or as it was at chat login), or the client's
  fallback `InvalidMCPUser` (`nick-name`).

A real client is never refused: its encoder only writes that alphabet, the comparison is on the
decoded text (so upper- or lower-case hex does not matter), and its name is the username our own
account route served. The one exception: after an admin renames a player, that player restarts the
game before chat works again.

The server **never rewrites** a nickname: a rewritten one breaks the joiner's own "is this me?" test
and the join hangs, as the username attempt above showed. A refused join is an error presence, and
the client drops the pending room cleanly and reports a failed join (B `0x143a34d80`; the same
callback as a successful join, `0x143a298a8`). So a refusal never leaves "Another operation already
pending" behind.

`CHAT_NICK_CHECK=log` admits a nickname that fails the resource, format or name rule, with a warning
line. It is a rollback switch in case the live test shows a real client being refused, not a normal
setting. The account id rule (`nick-account`) holds in both modes: a real client always builds its
nickname from its own account id (B `0x1408b5aeb`), so only a forged nickname fails it.

## Rooms, and who may join them {#rooms}

The client names its rooms itself (B builders in parentheses). They live on `muc.<domain>` or the
legacy `conference.<domain>` alias, where the suffix is the value the client sent in `<open to>`.
That value may include a port: a launcher-directed client was captured sending `127.0.0.1:61000`,
then joining `muc.127.0.0.1:61000`. The server preserves that endpoint, accepts either alias only for
the authenticated domain and echoes the exact room JID.

| Room | Chat channel | Who may join |
|:-----|:-------------|:-------------|
| `City-<session id>` | Normal, in Ramsgate (`0x141568c20`) | Any signed-in player |
| `Hunt-<session id>` | Normal, on a hunt | Any signed-in player |
| `Party-<party id>` | Party Chat (`0x1415ad14f`) | Members of that party only |
| `Guild-<guild id>` | Guild Chat (`0x1415bb270`) | Members of that guild only |
| `General<id>` | "General Chat" (`0x1415669e0`, no caller in 1.4.4) | Any signed-in player |
| anything else (`Lobby...`, other spellings or case) | none | Refused |

- Membership is checked at the join, at every message (for the sender and each recipient) and every
  60 s. A player who left the party or guild (a kick, a stale client) is removed from the room with
  status 307, which the client handles as "server initiated room exit".
- A room line is not delivered to a player who blocked its sender. A whisper is not delivered when
  either player blocked the other (the same rule as party invites).
- Two connections of one account never see each other in a room: the client's "is this me?" test
  would take the other one's presence for its own.
- Only one connection of an account is in a room at a time. When a player reconnects while the old
  connection still lingers (a dropped Wi-Fi, say), the new one takes over each room it joins: the
  others get the old connection's leave first, then the new one's join. The old connection is not
  told, and it is pinged out 10 s later. The reason is in the client: it keeps one room member per
  account id. A presence of that account updates the member, and a leave removes the member by the
  account id in the leaving nickname (B `0x1408fe300`; `0x1408c0680` -> `0x1408e1ce0`). A line's
  sender is then looked up among the members by room address (B `0x1408a83c0`). If the old connection
  left later, at its ping timeout, it would remove the member the new one had just updated, and the
  others would see that player's lines as `[unknown]` until the player left and joined the room again.
- The server keeps no history and sends no room subject.

**Ramsgate chat is per session today.** Each player gets a session id of their own for Ramsgate, so two
players share a `City-` room only when they travelled there together as a party. A shared Ramsgate
channel for everyone on the same server is a later step (roadmap 3.10).

## Party safety {#party-safety}

The client has an automatic kick for party members who look offline (B `0x1415f6f60`). It runs only
while the local player's own Phoenix presence is online (B `0x1415f7562`), and it reads only that
presence. Room presence comes from `muc.<domain>` (or its `conference.<domain>` alias), which the presence module leaves to the room code
(B `0x143a381d0`). So the server keeps one rule, whatever the settings:

- **By default** (`CHAT_PRESENCE` off) it sends **no presence outside chat rooms** at all: it records
  the client's own broadcast presence and drops it, never echoing or relaying it.
- **With friends' online status on** (`CHAT_PRESENCE=1`) it relays presence between friends, but
  **never sends a player a stanza outside a room whose sender is the player's own account**, not even
  from that account's second session (two are allowed at once). That is what could set the local
  player's own presence and wake the kick.

So the automatic kick stays dormant. The live test checks that a party of two with chat on, and then
with friends' online status on, keeps both members for a minute
([Friends, parties and guilds]({{ social_page.url | relative_url }}#parties)).

## Friends' online status {#presence}

**Built and tested without the game, off by default** (`CHAT_PRESENCE=1`, which needs `CHAT=1`; read
when the chat server starts). With it off, not one presence stanza is sent outside rooms, exactly as
before. The 1.4.4 client never asks for a roster, never subscribes and never probes: it only knows the
presence the server pushes (B), so the server does all of the following by itself (C,
`src/realtime/presence.ts`).

**Who hears whom.** A player's presence goes to every session of each **accepted** friend who has not
blocked the player and whom the player has not blocked, once that session has sent a presence of its
own. The player's own sessions are never in that list.

| When | What the server sends |
|:-----|:----------------------|
| A session sends its first broadcast presence (no `to`) | That session gets the current presence of each friend who is online; each such friend gets the player's presence. |
| The presence changes (`<show>` or the `<status>` text) | The new presence, to the same friends. More than 5 changes at once are held back to one every 2 seconds; only the latest state goes out, at the next second's tick. The limit counts every change a connected session makes, its first presence, an unavailable broadcast and coming back after one included, so going offline and online in a loop is held back too. |
| The session ends (`<close/>`, a dropped socket, a ping timeout, replacement, an abuse, size or backlog end) or broadcasts `type="unavailable"` | `type="unavailable"` from its full address (at once when the session ends; an unavailable broadcast counts as a change under the limit above, and the session hears of its friends again when it comes back). If the account still has another session with a presence, that presence follows at once, so the friend does not show as offline. Nothing is sent at a server shutdown. |
| Two players become friends over HTTP (an accept of a request) | Each player's sessions get the client's friends-list message, from `xmpp-admin@<domain>`: `{"type": "com.epicgames.friends.core.apiobjects.Friend", "payload": {"accountId", "status": "ACCEPTED", "direction": "INBOUND" or "OUTBOUND", "created"}, "timestamp"}`, then the two exchange presences. A new request (still pending) pushes nothing. |
| An accepted friendship ends (unfriend, or a block that removes it) | Each side gets the other's `type="unavailable"` once; after that neither hears of the other. |

- **Exactly as sent.** The presence is relayed from the sender's **full** address
  (`<account>@<domain>/<resource>`; the client drops a presence without a resource, B `0x143a382b0`),
  to the receiver's full address, with `<show>` (only `away`, `chat`, `dnd` or `xa`) and the `<status>`
  JSON unchanged. A `<status>` over 4096 characters is left out; the presence itself still goes.
- **The friends-list message.** The client accepts that message only from the local part `xmpp-admin`
  at the receiver's own domain (B `0x1408ba550`, `FOnlineFriendsMcp::OnXmppMessageReceived`).
- **The rule, enforced three times:** the friend lookup leaves the account itself out; the one function
  that sends every presence stanza refuses one whose sender is the receiver's own account (compared
  without case) and logs `chat: presence: refused to send c=<id> a stanza from its own account`, which
  must never appear; and the tests check every stanza the server sends in every chat test file (below).
- Room code, the room nicknames and the usernames fix are untouched.

**Log lines** (metagame log): at every start `chat: friends' online status on (CHAT_PRESENCE=1): ...` or
`chat: friends' online status off: no presence is sent outside rooms`, and a warning when
`CHAT_PRESENCE` is on without `CHAT=1`; per session `chat: presence c=<id> uid=<account> online: told N
friend session(s), heard of M` and `... offline (<reason>): told N friend session(s)`; and
`chat: presence: <A> and <B> are friends now: told N and M session(s)`. The full list is on
[Troubleshooting]({{ trouble_page.url | relative_url }}#chat-presence).

## Connections and limits {#limits}

- **Crash guard.** Every socket has an error listener, and every stanza handler is guarded. An
  oversized frame, invalid UTF-8 or a bad WebSocket opcode ends that one connection, never the
  metagame.
- **No reconnect loops.** The client reconnects on its next tick when an established connection drops
  (B `0x140939988`). So the server never closes a logged-in connection over bad input: it drops the
  stanza and counts it. Only the client's `<close/>`, a ping timeout, replacement, shutdown, an
  oversized frame, output the client does not read, or sustained abuse end one. Replacement, abuse,
  an oversized frame and unread output hold that account's next login back for 60 s, which makes the
  client wait 15-45 s instead (B `0x14093a3ee`). A ping timeout does not: one reconnect after it is not
  a loop.
- **Pings and map loads.** After 50 s with nothing from the client, the server pings it, and it ends
  the connection when another 100 s pass without an answer. The client answers a ping only from its
  game-thread tick: the handler only queues it (B `0x143a2a690`), and `FXmppPingStrophe::Tick` builds
  the answer while the connection is logged in (B `0x143a3eb90`, the check at `0x143a3ed99`). A long
  map load very likely holds that tick up (S: how Unreal ticks, not traced here). The client's own
  ping settings (60 s, 30 s, one retry: B `0x143a1f367`-`0x143a1f37b`) let about 150 s of silence pass
  (S), and so does the server. With 30 s, a hunt travel could have cut a player's chat for a minute or
  two.
- **Sessions.** At most two bound connections per account; a third replaces the one silent longest.
  A new connection pings the older one, which is ended as a ghost if it does not answer in 10 s.
  Counting the ones still logging in, an account has at most three connections: a new login closes
  the oldest one that has not bound. A connection must bind within 10 s of its login.
- **Before login** a connection gets four frames and one login attempt; the game needs `<open>`,
  `<auth>` and, after a refusal, its legacy login. The limit of 8 per address counts every connection
  that has not bound yet.
- **Unread output.** When 256 KiB of output wait unsent for one connection (its client stopped
  reading), the server sends it nothing more and ends it (`reason=backlog`).
- **Refused joins** each count toward the abuse limit and are logged once per connection, room kind
  and reason every 10 minutes, with the room name cut to 80 characters.
- The limits (message size, rates, rooms per player) are listed on
  [Configuration]({{ config_page.url | relative_url }}#metagame-chat). Message text, tokens and request
  headers are never logged.

## Testing without the game {#testing-without-the-game}

`UndauntedMetagame/test/chatclient.ts` is a model of how the client reads chat, with the addresses
above. Fed the first server's replies, it reproduces what Vvoidddd saw: `UID-...` as the sender, the
join stuck with "Another operation already pending", and `[unknown]`. Fed ours, captured from the real
server in the test, both players see usernames. Like the client, the model keeps one room member per
account, so it also shows what a reconnect would do to the others' view. The WebSocket tests run two
and three players through joins, messages, leaves, a reconnect while the old connection lingers, the
nickname rules, party and guild rooms, blocks, whispers, sessions, pings, limits and the crash guard,
and one test takes the names through the real account routes.

`test/presence.test.ts` covers friends' online status: the exchange with `<show>` and `<status>`
unchanged from the full address; two sessions of one account (nothing passes between them, the friend
hears both, the remaining session's presence follows when one leaves); unavailable on `<close/>`, a
dropped socket, an unavailable broadcast and a ping timeout; strangers, blocks and an unfriend; the
friends-list message on an accept (and none for a request); a change, a repeat and a flood held back;
going offline and online in a loop held back the same way, with the friends lookups counted; and zero
stanzas outside rooms with `CHAT_PRESENCE` off. `test/chatinvariant.ts` watches **every
stanza the server sends** in the chat, chat-over-HTTP, chat-model and presence test files, and fails
the file if a stanza outside a room ever reached a session from its own account.

## How to verify {#how-to-verify}

The live test with two players on the rented server.

**Before the test**, when nobody is playing (each step restarts the stack, which drops the parties and
matchmaking queues held in memory):

1. **Update the server to this version.** From your PC: `Deploy-Remote.ps1 -Server <address> -Update`
   (or `Update-DauntlessServer.ps1` on the server). `Set-Chat.ps1` arrives with the update: a server
   on an older version (the rented one runs 9f3f78b) does not have it yet. `-Chat` cannot go with
   `-Update`, so switching chat on is a second run.
2. **For the first run, add `CHAT_TRACE=1`** to `C:\DauntlessRevived\data\config\metagame.env` now,
   before switching chat on: the restart in the next step picks it up.
3. **Switch chat on:** `Deploy-Remote.ps1 -Server <address> -Chat On` (or `Set-Chat.ps1 -On` on the
   server; see [Windows server kit]({{ winserver_page.url | relative_url }}#chat)).
4. **Check** that `Stack.ps1 status` has the line `chat             : listening 127.0.0.1:61099`, and
   that the metagame log has `chat: listening on 127.0.0.1:61099 (nick check enforce)`.
5. Both players use their own account and any launcher from v0.1.0 on (every one relays chat; 0.1.6
   has the newest credits). They start the game after chat is on; a game that was already running
   connects within about 45 s.

The lines below are from the metagame log.

1. **A starts the game.** `EOS Account Info for <A> by <A>: found`, then `chat: connect ... via=gateway`,
   `chat: login ok ... uid=<A>` and `chat: bound ... uid=<A> resource=V2:... sessions=1`. No second
   `bound` for A over the next minutes.
2. **A stands in Ramsgate.** `chat: join room=City-<id> uid=<A> name=<A's username>` and the same for
   `Party-<P>`. No `join refused` line, and no `rejoin` line every few seconds.
3. **A types in Normal.** `chat: message room=City-<id> uid=<A> len=<n> to=1`. A sees the line once,
   under A's own name.
4. **B starts the game and joins A's party.** B gets the lines of step 1, then
   `party: accept by <B> ...`, `chat: leave room=Party-<B's old party> uid=<B> reason=left` and
   `chat: join room=Party-<P> uid=<B> name=<B's username> occupants=1`.
5. **Party chat both ways.** Each line gives `chat: message room=Party-<P> ... to=2`, and the first line
   from the other player a `Account info for 1 account(s) by userId ...: 1 found`. **Each player sees
   the other's username**, not `UID-...` and not `[unknown]`.
6. **Ramsgate together, and a hunt.** The leader takes the party to Ramsgate; both then join the same
   `City-<id>` room, and Normal chat works both ways. (Two players who are not in a party are in
   different `City-` rooms: expected for now.) Then the party goes on a hunt and back: the map loads
   must not cost chat, so there is no `chat: closed ... reason=ping-timeout` line for A or B, and party
   chat works right after each load.
7. **Whispers.** A whispers B by name, and B replies. `chat: whisper from=<A> to=<B> len=<n> delivered=1`
   and the other way round; B sees A's username.
8. **Blocks.** B blocks A: A's next Normal line logs `blocked=1` and B sees nothing; a whisper from A
   logs `reason=blocked`. B unblocks A, and lines arrive again.
9. **Party safety.** A and B stay in the party for a minute with chat on. There must be **no**
   `DELETE /party/member/...` and no `DELETE /party/leader/...` in the log, and the party poll still
   shows two members.
10. **A dropped connection (if one happens, or to try it: B turns the network off for a minute and on
    again).** When the game reconnected while its old connection still lingered, the log shows
    `chat: bound ... uid=<B> ... sessions=2`, then for each room
    `chat: leave room=<room> uid=<B> reason=replaced` and `chat: join room=<room> uid=<B> ...`, and about
    10 s later `chat: closed ... uid=<B> reason=ping-timeout`. A still sees B's lines under B's
    username, not `[unknown]`.
11. **Leave and quit.** B leaves the party (`chat: leave room=Party-<P> uid=<B> reason=left`, and A sees
    B go), then quits the game (`chat: closed ... uid=<B> reason=close` or `socket`).
12. **Log hygiene.** Search the metagame log for a word you typed in steps 3-7, and for `eyJ`: neither
    may be found. Then take `CHAT_TRACE=1` out again (restart when nobody is playing).

The test passes when steps 1-11 go as described and step 12 finds nothing.

**The way back**, from the lightest:

- Real players refused with `reason=nick-resource`, `nick-format` or `nick-name`: set
  `CHAT_NICK_CHECK=log` in `metagame.env`, restart when nobody is playing, and report the line.
- Anything serious: `Deploy-Remote.ps1 -Server <address> -Chat Off` (or `Set-Chat.ps1 -Off` on the
  server) puts things back as before chat.
- The chat code itself at fault: `Update-DauntlessServer.ps1 -Rollback` (the build before the update)
  or `Update-DauntlessServer.ps1 -Ref 9f3f78b`. The older code ignores `CHAT`, so nothing else needs
  changing.

### Friends' online status (after the chat test passes) {#how-to-verify-presence}

Only once steps 1-12 above have passed. The server kit's `Set-Chat.ps1` has no switch for it yet, so
add `CHAT_PRESENCE=1` to `C:\DauntlessRevived\data\config\metagame.env` by hand and restart the
metagame when nobody is playing. The start line reads `chat: friends' online status on
(CHAT_PRESENCE=1)`. A and B must be accepted friends.

1. **Both start the game.** Each gets `chat: presence c=<id> uid=<X> online: told N friend session(s),
   heard of M` (the second one to arrive: `told 1 ..., heard of 1`). In the Social panel each sees the
   other online, and then "In Ramsgate".
2. **Party safety.** A and B stay in a party for 60 seconds in Ramsgate, then go on one hunt and back.
   There must be **no** `DELETE /party/member/...` and no `DELETE /party/leader/...` in the log, and
   **never** a line `chat: presence: refused to send ... a stanza from its own account`.
3. **B quits.** `chat: presence c=<id> uid=<B> offline (close): told 1 friend session(s)`; A sees B go
   offline.
4. **A new friend.** With a third account C online: A sends C a friend request (nothing is pushed), C
   accepts; `chat: presence: <A> and <C> are friends now: told N and M session(s)`, and both see the
   other at once, without a new login.

The test passes when all four go as described. **The way back:** remove `CHAT_PRESENCE=1` (or set it to
0) and restart the metagame; chat itself keeps working. Only after this test does
`CHAT_PRESENCE` go on by default, and only once chat itself is on by default.

## Still unconfirmed {#unconfirmed}

| Open point | Label | How the live test checks it |
|:-----------|:------|:----------------------------|
| The account read sets the name to `displayName` | S | The `chat: join ... name=` line shows the username. |
| Your own lines use the Social panel's name for you | S | Your own line in Normal chat. |
| The nickname's resource is the bound resource | S | No `reason=nick-resource` refusal. |
| How often the client retries a refused join | unknown | With `CHAT_TRACE=1`, count the repeated join presences in the trace (a refusal is logged only once per connection, room kind and reason). |
| Whether game servers open a chat connection | G | `chat: connect ... via=direct` lines after a hunt starts. |
| What a whisper to an offline player shows | unknown | Whisper a player who quit. |
| The client's typing limit against our 2048 characters | G | Paste a long line; watch `len=`. |
| "Entered room" notices use the nickname's first part | G | The notice shows the username (right either way). |
| The automatic party kick stays dormant with room presence | B for its conditions | A party of two with chat on for 60 s: no `DELETE /party/member/...`. |
| Chat after the 24-hour token expiry | B (the retry), C (the expiry) | A `reason=expired` line at most every 10 minutes. |
| A map load holds up the client's answer to a server ping | S | No `reason=ping-timeout` around a hunt travel (step 6). |
| A reconnect keeps the player's name for the others | B for the client's member list, C for ours | Step 10, when it happens. |
| Friends' presence shows them online, then "In Ramsgate", then offline | B for what the client accepts, not seen in game | [Friends' online status](#how-to-verify-presence), steps 1 and 3. |
| The automatic party kick stays dormant with friends' presence on | B for its conditions, C for the rule | A party of two with `CHAT_PRESENCE=1` for 60 s and a hunt trip: no `DELETE /party/member/...`. |
| An accept pushed over chat shows the new friend without a new login | B for the handler, not seen in game | Step 4 of the presence test. |

What to do when chat misbehaves is on [Troubleshooting]({{ trouble_page.url | relative_url }}#chat-not-connected);
turning it on and off on a server is on [Windows server kit]({{ winserver_page.url | relative_url }}#chat).
