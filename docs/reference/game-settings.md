---
title: Game settings
parent: Reference
nav_order: 5
description: "What Dauntless Revived changes in the 1.4.4 client and its game servers: the user ini files and who writes them, command lines, the two DLLs, the pinned build, and the game data the metagame serves."
lang: en
ref: reference/game-settings
---

{% assign host_page = site.pages | where: "path", "setup/host.md" | first %}
{% assign friends_page = site.pages | where: "path", "setup/friends.md" | first %}
{% assign admin_page = site.pages | where: "path", "setup/admin.md" | first %}
{% assign winserver_page = site.pages | where: "path", "setup/windows-server.md" | first %}
{% assign trouble_page = site.pages | where: "path", "setup/troubleshooting.md" | first %}
{% assign verification_page = site.pages | where: "path", "findings/verification.md" | first %}
{% assign ci_page = site.pages | where: "path", "findings/client-internals.md" | first %}
{% assign mp_page = site.pages | where: "path", "findings/multiplayer.md" | first %}
{% assign assets_page = site.pages | where: "path", "findings/assets.md" | first %}
{% assign roadmap_page = site.pages | where: "path", "roadmap.md" | first %}
{% assign config_page = site.pages | where: "path", "reference/configuration.md" | first %}
{% assign ports_page = site.pages | where: "path", "reference/ports.md" | first %}
{% assign api_page = site.pages | where: "path", "reference/api.md" | first %}
{% assign scripts_page = site.pages | where: "path", "reference/scripts.md" | first %}
{% assign dev_page = site.pages | where: "path", "reference/development.md" | first %}

# Game settings
{: .no_toc }

Dauntless Revived never modifies the game's own files. `Dauntless-Win64-Shipping.exe` stays
byte-identical to the verified 1.4.4 build. Everything the project changes on the game side is in
three places:

1. **Two DLLs** next to the exe. Windows loads them into every Dauntless process.
2. **User ini files** in the Windows account's config folder. Unreal lays them over the cooked
   config inside the paks.
3. **The command line** the game is started with.

The same exe is both the player's client and every game server. One of the two DLLs decides at
startup which of the two roles a process plays.

This page is the reference: what each writer puts in each file, the exact command lines, what the
DLLs do, and the pinned build facts. The step-by-step guides are
[Host a server]({{ host_page.url | relative_url }}),
[Join as a friend]({{ friends_page.url | relative_url }}) and the
[Windows server kit]({{ winserver_page.url | relative_url }}). Environment variables are on
[Configuration]({{ config_page.url | relative_url }}), ports on
[Ports and network]({{ ports_page.url | relative_url }}), and the scripts that write these files on
[Scripts and parameters]({{ scripts_page.url | relative_url }}).

<details open markdown="block">
  <summary>Contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

## At a glance {#at-a-glance}

| | Player's client | Game server |
|:--|:--|:--|
| Exe | `Archon\Binaries\Win64\Dauntless-Win64-Shipping.exe` from the pinned build | The same exe |
| DLLs | `dxgi.dll` and `UndauntedInternalServer.dll` next to the exe | The same two files |
| Started by | The launcher (`UndauntedLauncher/`), the friend kit's `play.ps1`, or the host's own `play.ps1` | The deploy server (`UndauntedDeployServer/`) |
| First argument | The metagame address, `host:port` | The game-server key (secret) |
| Server DLL mode | Client mode: answers the backend endpoints in memory | Server mode: the command line contains `-server` |
| `Engine.ini` | Memory lines, an optional forced graphics level, the chat redirect | Memory lines and the chat redirect |
| `Game.ini` | Not needed | **Required**: 167 quoted endpoint overrides |
| `GameUserSettings.ini` | `sg.*Quality` lines set to the forced level, if one is forced | Not touched |
| Whose config folder | The player's Windows account | The account that runs the deploy server: the owner's account on a hand-set-up host, the `dauntless` service account on a server installed with the kit |

---

## The user config folder {#config-folder}

```text
%LOCALAPPDATA%\Archon\Saved\Config\WindowsClient\
```

Unreal reads the cooked defaults from the paks first, then this folder. A key set here wins. The
folder belongs to the Windows account that runs the process: a game server started under another
account reads that account's folder, not yours. 1.4.4 and 2.1.1 share the folder, because both are
called `Archon` internally. Park the other build's folder before you switch builds, as described in
[Host a server, step 6]({{ host_page.url | relative_url }}#config-folder).

| File | Does the game write it? | What this project puts in it |
|:-----|:------------------------|:-----------------------------|
| `Engine.ini` | Yes. It keeps our two sections when it does. | `[SystemSettings]` and `[OnlineSubsystemMcp.XMPP]` |
| `Game.ini` | Yes. Quoted values survive the rewrite. | `[OnlineSubsystemPhoenix]` with 167 endpoint overrides, for game servers only |
| `GameUserSettings.ini` | Yes, from the options menu | Its existing `sg.<Group>Quality` lines, only when a graphics level is forced |
| `Input.ini`, `RuntimeOptions.ini` and the rest | Yes | Nothing |

Which folder is used where:

| Setup | Folder |
|:------|:-------|
| Player's PC (launcher or friend kit) | The player's own `%LOCALAPPDATA%\Archon\Saved\Config\WindowsClient\`. If `LOCALAPPDATA` is not set, the launcher uses `%USERPROFILE%\AppData\Local\Archon\...` instead. |
| Host PC set up by hand ([Host a server]({{ host_page.url | relative_url }})) | The owner's own folder. The client and the game servers run as the same user and read the same files. |
| Server installed with the kit | The folder of the local account `dauntless`, which runs the whole stack: `<profile of dauntless>\AppData\Local\Archon\Saved\Config\WindowsClient\`. The installer creates that profile if it is missing. |
| Kit `-Sandbox` install | `<InstallRoot>\data\sandbox-profile\AppData\Local\Archon\Saved\Config\WindowsClient\`. The current user's own folder is never touched. |

More about the user config layer, and why keys must go into the file that matches their section,
is in [Game assets and config]({{ assets_page.url | relative_url }}).

### Who writes what {#writers}

| Writer | When | `Engine.ini` | `Game.ini` | `GameUserSettings.ini` |
|:-------|:-----|:-------------|:-----------|:-----------------------|
| Launcher (`UndauntedLauncher/`) | Every PLAY, before the game starts | Replaces `[SystemSettings]` and `[OnlineSubsystemMcp.XMPP]` | Never | `sg.<Group>Quality` lines, when a level is chosen and the file exists |
| Friend kit, `friend-kit/play.ps1` | Every launch, also with `-DryRun` | The same lines as the launcher, except the launcher's opt-in [auto exposure](#auto-exposure) line | Never | Same as the launcher |
| Host's `C:\dr\tools\play.ps1` (not in the repository; listed in full in [Host a server, step 13]({{ host_page.url | relative_url }}#launch-the-client)) | Every launch | The same lines | Never | Same, plus `sg.ResolutionQuality=100.000000` |
| Host's `make-gameini.ps1` (a script to save from [Host a server, step 8]({{ host_page.url | relative_url }}#game-ini); not in the repository) | When you run it | Not touched | Overwrites the whole file | Not touched |
| Windows server kit, `Install-DauntlessServer.ps1` | Every run of the installer. `Update-DauntlessServer.ps1` does **not** rewrite these files. | Memory lines and the chat redirect only: no graphics lines | Overwrites the whole file | Not touched |
| The game itself | While it runs | Rewrites the file and keeps our sections | Rewrites the file; quoted values survive | From its options menu |

For a new file, the launcher writes exactly the bytes the friend kit's `play.ps1` writes, as long as
Auto exposure is on "Game default" (the default). A launcher test checks that byte for byte.

### How the `Engine.ini` rewrite works {#engine-ini-rewrite}

All four writers apply the same rule:

1. Remove every `[SystemSettings]` and `[OnlineSubsystemMcp.XMPP]` section, from its header line up
   to the next line that starts with `[`. A header is recognised only at the very start of a line,
   in any letter case.
2. Write the new `[SystemSettings]` section, a blank line, the new `[OnlineSubsystemMcp.XMPP]`
   section and another blank line at the top of the file.
3. Keep every other line, unchanged, below them.

What that means in practice:

- **Lines you add yourself inside these two sections are gone after the next launch.** Use the
  options menu, or another section, for personal tweaks.
- Everything else in `Engine.ini` stays, including the sections the game writes itself, such as
  `[Core.System]`.
- The file is created if it is missing. The launcher, the friend kit and the server kit also create
  the folder; the host's script expects it to exist already (the game creates it on its first start).

Encoding:

- The launcher writes ASCII with CRLF line breaks. If a kept line holds a non-ASCII character, it
  writes UTF-16 LE with a byte order mark instead, which Unreal reads correctly. It reads files with
  or without a UTF-8 or UTF-16 LE byte order mark. It writes to `Engine.ini.dr-tmp` first and then
  renames that file, so a crash never leaves half a file behind.
- The PowerShell writers (the friend kit, the host script and the server kit) always write ASCII.
  A non-ASCII character in a kept line becomes `?`.

The launcher refuses a chat host that is not a valid IPv4 address or DNS name, so nothing else can
end up in the file. The friend kit writes the host part of its `-Server` value without checking it.

---

## `Engine.ini`: `[SystemSettings]` {#systemsettings}

`[SystemSettings]` in the user `Engine.ini` overrides the in-game options menu. That is why a forced
graphics level lives here. The "Value" column is what our writers put in the file; without the line,
the cooked default applies.

| Name | Value | Values | What it does | Set by |
|:-----|:------|:-------|:-------------|:-------|
| `r.Streaming.PoolSize` | `3000` | MB | Texture streaming pool. Bounds the biggest memory consumer without lowering quality. | All four writers, always |
| `r.Streaming.LimitPoolSizeToVRAM` | `1` | `0` or `1` | Never lets that pool grow past the graphics card's memory. | All four writers, always |
| `gc.TimeBetweenPurgingPendingKillObjects` | `10` | seconds | Collects garbage more often. Affects memory, not image quality. | All four writers, always |
| `s.ForceGCAfterLevelStreamedOut` | `1` | `0` or `1` | Collects garbage after each streamed-out level. Affects memory only. | All four writers, always |
| `sg.ViewDistanceQuality`, `sg.AntiAliasingQuality`, `sg.ShadowQuality`, `sg.PostProcessQuality`, `sg.TextureQuality`, `sg.EffectsQuality`, `sg.FoliageQuality`, `sg.ShadingQuality` | the chosen level | `0` to `4` | Forces one scalability level on all eight groups. See [Graphics levels](#graphics-levels). | Client writers, only when a level of 0 or higher is chosen |
| `sg.ResolutionQuality` | `100` | percent | Full resolution scale. | Client writers, with a forced level |
| `r.ScreenPercentage` | `100` | percent | Renders at full native resolution. | Client writers, with a forced level |
| `r.MipMapLODBias` | `0` | integer | Full-resolution texture mips. | Client writers, with a forced level |
| `r.MaxAnisotropy` | `16` | integer | 16x anisotropic filtering: sharp textures at glancing angles. | Client writers, with a forced level |
| `r.Tonemapper.Sharpen` | `0.6` | float | A light sharpen against the softness of UE4's temporal anti-aliasing. | Client writers, with a forced level |
| `r.EyeAdaptation.MethodOverride` | `2` | `-2` custom settings (for testing), `-1` no override, `1` automatic, histogram based, `2` automatic, basic, `3` manual (the 1.4.4 executable's own help text) | Switches automatic exposure from the histogram to UE4's basic metering; exposure stays automatic. An experiment against the [dark airship]({{ trouble_page.url | relative_url }}#airship-dark-windows-blown-out), not yet compared in game. Always the last line of the section. | The launcher only, and only when Settings > Graphics > Auto exposure is "Basic adaptive (experimental)". See [Auto exposure](#auto-exposure). |

The memory lines come from our 2.1.1 work, where a client with no limits reached 9 GB. On 1.4.4 they
are a precaution; we have not measured 1.4.4 without them. The low caps we used before these were
the cause of [blurry graphics]({{ trouble_page.url | relative_url }}#blurry-graphics).

**No writer turns automatic exposure off.** Launcher 0.1.0, and the friend kit and host script of
that time, also wrote `r.EyeAdaptationQuality=0`. It fixed the dark pre-hunt airship but made
Ramsgate and night scenes far too dark, so since launcher 0.1.1 no writer sets it, and the next
launch's rewrite removes the old line. The only exposure line any writer puts in the file now is the
launcher's opt-in `r.EyeAdaptation.MethodOverride=2` above, which keeps automatic exposure on. See
[Airship is extremely dark with blown-out windows]({{ trouble_page.url | relative_url }}#airship-dark-windows-blown-out).

A client launched with the launcher's default level (4) gets this section:

```ini
[SystemSettings]
r.Streaming.PoolSize=3000
r.Streaming.LimitPoolSizeToVRAM=1
gc.TimeBetweenPurgingPendingKillObjects=10
s.ForceGCAfterLevelStreamedOut=1
sg.ViewDistanceQuality=4
sg.AntiAliasingQuality=4
sg.ShadowQuality=4
sg.PostProcessQuality=4
sg.TextureQuality=4
sg.EffectsQuality=4
sg.FoliageQuality=4
sg.ShadingQuality=4
sg.ResolutionQuality=100
r.ScreenPercentage=100
r.MipMapLODBias=0
r.MaxAnisotropy=16
r.Tonemapper.Sharpen=0.6
```

With level `-1` it ends after `s.ForceGCAfterLevelStreamedOut=1`: only the four memory lines, the
same four the server kit writes. With Auto exposure on "Basic adaptive (experimental)",
`r.EyeAdaptation.MethodOverride=2` follows as the last line, at every level.

### Graphics levels {#graphics-levels}

| Level | Name | Launcher: Settings > Graphics > Quality | `play.ps1 -Graphics` |
|:------|:-----|:----------------------------------------|:---------------------|
| `-1` | Force nothing: the options menu decides | "In-game menu" | `-1` |
| `0` | Low | "Low" | `0` |
| `1` | Medium | "Medium" | `1` |
| `2` | High | "High" | `2` |
| `3` | Epic | "Epic" | `3` |
| `4` | Cinematic, the highest level in this UE4 build | "Cinematic" | `4` |

| Writer | Default | How to change it |
|:-------|:--------|:-----------------|
| Launcher | `4` (Cinematic) | Settings > Graphics > Quality. Stored as `graphics` in the launcher's `settings.json`; any value other than -1 to 4 falls back to 4. |
| Friend kit `play.ps1` | `-1` (the options menu decides) | Add `-Graphics <n>` after `Play Dauntless.cmd` in a terminal. A value above 4 is refused. |
| Host's `play.ps1` | `4` | `-Graphics <n>`. It does not check the range. |
| Server kit | none | Not applicable: game servers render nothing. |

With level 0 to 4, the writer also sets the menu's own lines in
[`GameUserSettings.ini`](#gameusersettings), so the options screen shows the forced level. While a
level is forced, it wins over whatever the options menu says, and the next launch writes it again.

### Auto exposure {#auto-exposure}

An opt-in experiment against the dark pre-hunt airship (roadmap 4.17), added by Vvoidddd
([#7](https://github.com/mixutin/dauntless-revived/pull/7)). It is off by default.

| Writer | Default | How to change it |
|:-------|:--------|:-----------------|
| Launcher | `game` ("Game default"): no exposure line | Settings > Graphics > Auto exposure: "Game default" or "Basic adaptive (experimental)", which writes `r.EyeAdaptation.MethodOverride=2`. Stored as `exposure` in the launcher's `settings.json` (`game` or `basic`); any other value falls back to `game`. Takes effect at the next PLAY. |
| Friend kit `play.ps1`, host's `play.ps1` | none | Not offered. Their rewrite of `[SystemSettings]` removes a line the launcher wrote. |
| Server kit | none | Not applicable: game servers render nothing. |

Switching back to "Game default" removes the line at the next PLAY, because the launcher rewrites
the whole section. Until then (for example after uninstalling the launcher) the line stays in
`Engine.ini`; it is harmless, since exposure stays automatic.

---

## `Engine.ini`: `[OnlineSubsystemMcp.XMPP]` (chat) {#xmpp}

As shipped, 1.4.4's chat and presence connection (XMPP over a WebSocket) goes to Epic's live server,
`wss://xmpp-service-prod.ol.epicgames.com:443`, and keeps reconnecting to it, sending the account id
and the login token. Every writer points it somewhere else. The server DLL's config hook does not
cover these keys: in `Mcp` sections it rewrites only keys whose names contain `Protocol`, `Domain`
or `RedirectUrl`. The ini override is the only thing that redirects chat.

| Name | Default (cooked) | Values | What it does | Set by |
|:-----|:-----------------|:-------|:-------------|:-------|
| `ServerAddr` | Epic's live server | `"ws://<host>"`, quoted | Host of the chat WebSocket. The quotes are required in a user ini (see [quoting](#game-ini-quoting)). | All four writers |
| `ServerPort` | Epic's port | 1 to 65535 | Port of the chat WebSocket. | All four writers |
| `bUseSSL` | Epic's setting | `false` | Plain `ws://`. In public mode the launcher's relay adds the TLS. | All four writers |

What each writer puts there:

| Writer and mode | `ServerAddr` | `ServerPort` |
|:----------------|:-------------|:-------------|
| Launcher, private mode (Tailscale invite) | `"ws://<invite host>"` | `61099` |
| Launcher, public mode | `"ws://127.0.0.1"` (the launcher's local relay) | The relay port: `61000`, unless `DAUNTLESS_REVIVED_RELAY_PORT` moves it |
| Friend kit `play.ps1` | `"ws://<host part of -Server>"` | `61099` |
| Host's `play.ps1` | `"ws://127.0.0.1"` | `61099` |
| Server kit, for the service account (also under `-Sandbox`) | `"ws://127.0.0.1"` | `61099` |

Where the connection ends up:

- **The metagame's chat listens on port 61099 when `CHAT=1`**, on `127.0.0.1` of the server (or of the
  host PC). It is off by default for now; when nothing listens, the connection fails the same way it
  already fails against Epic's server, and the game carries on. Private mode has no chat yet. See
  [Text chat]({{ '/findings/chat.html' | relative_url }}).
- In public mode the launcher's relay forwards the WebSocket upgrade over its pinned TLS connection
  to the server's gateway, which passes it on to its `GATEWAY_WS_URL` (default
  `http://127.0.0.1:61099`; a `-Sandbox` install uses `http://127.0.0.1:62099`). See
  [Configuration]({{ config_page.url | relative_url }}).
- Verified on 2026-09-21: in the first 90 seconds after launch, the client made no connections
  outside the PC. It tried the local port 61099 instead.
- We do not know whether a game server started with `-nullrhi` opens a chat connection at all. The
  server kit writes the override anyway. In a `-Sandbox` install it still names 61099; that is
  harmless, because a sandbox never starts game servers.

---

## `Game.ini`: endpoint overrides for game servers {#game-ini}

**Why game servers need it.** In client mode the server DLL answers the backend endpoint keys in
memory. In server mode it does not touch the config at all. A game server therefore reads its
backend URLs from the cooked `DefaultGame.ini`, which points at Phoenix's `*.steelyard.ca` hosts
(gone since 2025-05-30), and then from the user `Game.ini` of its Windows account. Without the
overrides, a game server can't load or save anyone's character.

A client ignores these keys, because its DLL hook answers them first. Players need no `Game.ini`.

**Format.**

```ini
[OnlineSubsystemPhoenix]
AuthEndpoint="http://127.0.0.1:61000/game/login"
AuthAvailableEndpoint="http://127.0.0.1:61000/checkavailable"
AuthTagsEndpoint="http://127.0.0.1:61000/tags"
...
MatchmakingEndpoint="http://127.0.0.1:61000"
TrackingEndpoint="http://127.0.0.1:61000"
...
```

- 167 lines, one for each entry in the DLL's endpoint table in `UndauntedInternalServer/dllmain.cpp`.
  Both generators (the kit's installer and the host's `make-gameini.ps1`) read that file with the
  same regular expression and write `Key="http://<metagame address><path>"`.
- `MatchmakingEndpoint` and `TrackingEndpoint` are the bare address, with no path.
- Both generators overwrite the whole file, as ASCII.

{: #game-ini-quoting}
**Quote every value.** In an unquoted value the engine's ini parser treats `//` as the start of a
comment and cuts the value there, and the game then writes the damaged file back. See
[Endpoint values cut to "https:"]({{ trouble_page.url | relative_url }}#ini-truncation).

**Where it points.** The address must be one the metagame listens on (its `BIND_HOST` and `PORT`,
see [Configuration]({{ config_page.url | relative_url }})).

| Setup | Written by | Metagame address in `Game.ini` |
|:------|:-----------|:-------------------------------|
| Host PC, loopback only | `make-gameini.ps1` (default `-Metagame 127.0.0.1:61000`) | `127.0.0.1:61000` |
| Host PC in private mode | Rewritten by hand, as in [Run it for a group]({{ admin_page.url | relative_url }}) | `<the host's Tailscale address>:61000` |
| Kit, public mode | The installer | `127.0.0.1:<metagame port>`; the port is 61000 unless `-MetagamePort` or an earlier install set another |
| Kit, private mode | The installer | `<the server's Tailscale IPv4 address>:<metagame port>` |
| Kit, `-Sandbox` | The installer | `127.0.0.1:62000` |

**When to regenerate it.** Whenever the metagame's port or listening address changes, when a
private-mode server's Tailscale address changes, and when a new code version changes the endpoint
table in `dllmain.cpp`.

- On a server installed with the kit, run `Install-DauntlessServer.ps1` again (it is safe to
  repeat). `Update-DauntlessServer.ps1` does not rewrite `Game.ini` or `Engine.ini`. The installer
  reads `dllmain.cpp` from the built code in `<InstallRoot>\app\UndauntedInternalServer\` and warns
  if it finds a number of entries other than 167.
- On a host set up by hand, run `make-gameini.ps1` again with the new `-Metagame` value. Do not
  search and replace: a replace on `:61000/` misses the two bare-address keys.

{: #game-ini-private}
**`Game.ini` is private: never share it, never commit it.** The DLL's table keeps the path of
Phoenix's old `PhoenixEventsMessageEndpoint`, which was a Slack webhook, and that path contains the
webhook's secret part. Every generated `Game.ini` carries it. The URL points at your own metagame,
so nothing is sent to Slack, but don't paste the file into issues, chats or screenshots.

---

## `GameUserSettings.ini` {#gameusersettings}

The game writes this file itself, from its options menu. When a graphics level from 0 to 4 is
forced, the client writers also set the menu's own lines, so the options screen shows the forced
level:

- Every existing `sg.<Group>Quality=` line of the eight groups (ViewDistance, AntiAliasing, Shadow,
  PostProcess, Texture, Effects, Foliage, Shading) is replaced with the chosen level. Letter case is
  ignored.
- No lines are added, and the file is not created if it doesn't exist yet. The game creates it on
  its first start.
- With level `-1`, and on game servers, the file is not touched.
- The host's `play.ps1` also sets `sg.ResolutionQuality=100.000000`. The launcher and the friend kit
  leave that line alone.

The launcher writes this file with the same encoding rule and the same temporary-file rename as
`Engine.ini`.

---

## Client command line {#client-command-line}

The three client launchers start the exe directly, with `Archon\Binaries\Win64` as the working
directory. None of them starts `Dauntless.exe` or the EasyAntiCheat bootstrapper.
Starting the shipping exe directly can still make its EAC client plugin try to
initialize and display "Failed to create IGameClient instance". Launcher 0.1.11
and the friend-kit script pass the executable's supported `-NoEAC` option to skip
that initialization for the private server. This is a client launch change: the
player must relaunch their game, but the VPS does not need a restart. Static
verification found both `NoEAC` and `-NoEAC in the command line, EAC client will not load`
in the pinned 1.4.4 executable; in-game confirmation remains pending.

```text
Dauntless-Win64-Shipping.exe <host>:<port> -AUTH_PASSWORD=<account key> -AUTH_LOGIN=unused
  -AUTH_TYPE=exchangecode -epicapp=appidlol -epicenv=Prod -EpicPortal -epicusername=usernamelol
  -epicuserid=useridlol -epiclocale=en-US -epicsandboxid=sandboxidlol
  -epicdeploymentid=deploymentidlol -NoEAC [-windowed -ResX=1280 -ResY=720]
```

The backend address remains the first argument. A launcher test pins its exact list.
Older standalone host scripts may not include `-NoEAC` yet.

| Name | Default | Values | What it does | Set by |
|:-----|:--------|:-------|:-------------|:-------|
| First argument, `<host>:<port>` | none | `host:port`, no scheme | The metagame address. The server DLL reads it in client mode and builds every backend URL as `http://<host>:<port>/...`. | See the next table |
| `-AUTH_PASSWORD=` | none (required) | The account key. Keys the server makes are `UUK_` plus 48 hex characters; the launcher accepts 8 to 128 of `A-Z a-z 0-9 _ -`. | The game sends it as the "exchange code" to `POST /account/api/oauth/token`. With `AUTH_MODE=APIKEY` the metagame finds the account and returns a token that is valid for 24 hours. **Secret: it is the account's password. Never share it, never commit it.** | Launcher: its encrypted key store. Friend kit: `%APPDATA%\DauntlessRevived\account.key`. Host script: `-KeyFile`, default `C:\dr\data\owner.key`. |
| `-AUTH_TYPE=exchangecode` | always | fixed | Selects the exchange-code login. 1.4.4 also knows `password` and `developer`; we use only this one. | All three launchers |
| `-AUTH_LOGIN=unused` | always | fixed | A non-empty placeholder. | All three launchers |
| `-EpicPortal` | always | fixed | Passed as upstream Undaunted's launcher passes it. 2.1.1 exits without it; 1.4.4 has not been tested without it. | All three launchers |
| `-epicapp=appidlol`, `-epicenv=Prod`, `-epicusername=usernamelol`, `-epicuserid=useridlol`, `-epicsandboxid=sandboxidlol`, `-epicdeploymentid=deploymentidlol` | always | fixed placeholders | Copied from upstream Undaunted's launcher. No Epic account is involved, because 1.4.4 predates Epic Online Services. Nobody has tested which of them 1.4.4 needs. | All three launchers |
| `-epiclocale=en-US` | `en-US` | `en-US`, `de-DE`, `es-ES`, `fr-FR`, `it-IT`, `ja-JP`, `pt-BR`, `ru-RU` | The game's text language. 1.4.4 ships text for exactly these cultures (`Archon/Content/Localization/Game/<culture>`); `es-ES` has been confirmed in game. | Launcher: Settings > Launcher > Language > Game language. "Automatic (Windows language)", the default, uses the Windows language when the game has text for it (`es-419` gives `es-ES`, `pt-PT` gives `pt-BR`) and `en-US` otherwise. Stored as `gameLanguage` in the launcher's `settings.json` (`auto` or one of the cultures); any other value falls back to `auto`. Takes effect at the next PLAY. Friend kit and host script: always `en-US`. |
| `-windowed -ResX=1280 -ResY=720` | off | all three together | A 1280x720 window instead of the saved display mode. | Launcher: Settings > "Start in a window (1280×720)" (`windowed` in its `settings.json`). Friend kit and host script: `-Windowed`. |

The first argument, per launcher:

| Launcher | First argument |
|:---------|:---------------|
| Launcher, private mode | The invite's `host:port`: normally the server's Tailscale address and 61000 |
| Launcher, public mode | `127.0.0.1:61000`: the launcher's local relay, which forwards everything over pinned TLS to the server's gateway. `DAUNTLESS_REVIVED_RELAY_PORT` moves the relay for tests and rehearsals; see [Configuration]({{ config_page.url | relative_url }}). |
| Friend kit `play.ps1` | `-Server`, or `Server` from `%APPDATA%\DauntlessRevived\settings.json`. `:61000` is added when no port is given. |
| Host's `play.ps1` | `-Backend`, default `127.0.0.1:61000` |

**The account key on the command line.**

- Other programs running as the same Windows user, and administrators, can read a process's command
  line, so they can read the key. Upstream's launcher works the same way.
- The launcher writes `-AUTH_PASSWORD=<hidden>` in its log and never reads other processes' command
  lines back. `play.ps1 -DryRun` prints the launch line with the key replaced.
- Never post a screenshot or a process listing that shows the game's command line.

**Other launch rules.**

- The launcher refuses PLAY while another Dauntless client is running on the PC. It counts every
  `Dauntless-Win64-Shipping.exe` whose command line has no separate `-server` switch, so game servers
  on the host's own PC don't count. The friend kit does not check.
- Before each launch, the launcher and the friend kit check the exe and both DLLs against their pins,
  and the launcher repairs the DLLs if needed. See [who checks the pins](#pin-checks).
- The server DLL opens a console window next to the game. **Leave it open**: closing it ends the
  game. F2 opens the Unreal console.
- The exe contains Unreal's command-line allow list. Whether 1.4.4 applies it at run time is not
  confirmed; the switches above work, including the windowed ones. See
  [Client internals]({{ ci_page.url | relative_url }}).

---

## Game-server command line {#game-server-command-line}

The deploy server starts every game server:

```text
Dauntless-Win64-Shipping.exe <game-server key> <UDP port> <map> <behemoth or NO_BEHEMOTH>
  <matchmaker hunt id or NO_MM_HUNTID> <uid:huntid,uid:huntid,... or NO_EXPECTED_PLAYERS>
  <MY_IP>:<UDP port> -EpicPortal -server -nullrhi
```

| # | Argument | Values | What it does | Set by |
|:--|:---------|:-------|:-------------|:-------|
| 1 | Game-server key | The key; the kit generates 48 hex characters | Sent as the `x-undaunted-gameserver-apikey` header on every HTTP request the server makes. The metagame stores only its SHA-256, and accepts the key only from its own machine (or an address in `GAMESERVER_ALLOW_FROM`), never through the gateway or any other proxy. **Secret: never share it, never commit it, never print a `-server` command line.** | `METAGAME_API_KEY` in the deploy server's settings |
| 2 | UDP port | Integer | The port the server listens on. Ports 8776 and above also turn off the idle exit (below). | Ramsgate: `PORT_RANGE_END` (8777). Dojo: `PORT_RANGE_END` minus 1 (8776). Hunts: a free port from `PORT_RANGE_BEGIN` to `PORT_RANGE_END` minus 2 (8770 to 8775). |
| 3 | Map | A `/Game/...` map path, optionally followed by `?game=<game mode class>` | The startup map. | Ramsgate: `/Game/Maps/ramsgate/ramsgate_01_persistent`. Dojo: `/Game/Maps/islands/dojo/training_dojo_persistent`. Trials: `/Game/Maps/islands/arenas/arena_ramsgate_00`. A hunt: a random map from the hunt's map list, plus `?game=` when the hunt overrides the game mode. The tutorial: the map from the client's own request. |
| 4 | Behemoth | An asset path ending in `_C`, or `NO_BEHEMOTH` | Added to the map URL as `?MonsterClass=`. | The hunt tables, or the client's request for the tutorial. Ramsgate and the Dojo pass `NO_BEHEMOTH`. |
| 5 | Matchmaker hunt id | A row name from the deploy server's own hunt tables (for example `CR19_MatchmakerHunt_...`), or `NO_MM_HUNTID` | Added as `?HuntId=`. | A random matchmaker row for the player's hunt. Trials: `Arena_MatchmakerHunt_Hard_NNN` or `Arena_MatchmakerHunt_Elite_NNN`, with NNN from 001 to 088. Ramsgate, the Dojo and the tutorial pass `NO_MM_HUNTID`. |
| 6 | Expected players | `uid:huntid,uid:huntid,...`, or `NO_EXPECTED_PLAYERS`. At most 16 players; each uid is up to 64 letters, digits, `_` and `-`, the hunt id up to 128 letters, digits, `_` and `+`. | Added as `?PlayerHuntIds=`: who may join, and with which player hunt. | The matchmaking request: the players' account ids and the player hunt they asked for. Ramsgate, the Dojo and the tutorial pass `NO_EXPECTED_PLAYERS`. |
| 7 | Advertised address | `MY_IP:port` | Parsed by the DLL and never used. The address players travel to comes from the deploy server's answer to the metagame. | `MY_IP` |
| | `-EpicPortal -server -nullrhi` | fixed | `-server` puts the DLL in server mode. `-nullrhi` means no rendering and no GPU. | Always |

The arguments are set through the deploy server's `PORT_RANGE_BEGIN`, `PORT_RANGE_END`, `MY_IP` and
`METAGAME_API_KEY`. `GAMESERVER_BINARY_PATH` names the exe it starts; it has no default, and the kit
sets it to the pinned exe in its game folder. See [Configuration]({{ config_page.url | relative_url }})
and [Ports and network]({{ ports_page.url | relative_url }}). Arguments 3 to 6 come partly from the game client's
own matchmaking request. The metagame and the deploy server both check them before they reach a
command line; see [HTTP API]({{ api_page.url | relative_url }}).

**Rules that come from the DLL.**

- **At least eight arguments after the exe name.** With fewer, the DLL shows a message box reading
  `INVALID GAMESERVER ARGS` and exits.
- **The engine never sees these arguments.** A hook hands it a fixed command line instead:
  `Dauntless-Win64-Shipping.exe -server -unattended -nullrhi -nosound -EpicPortal -RepDriverDisable`.
  Engine switches cannot be added through the deploy server.
- **The startup map URL** is built from arguments 3 to 6, leaving out each `NO_*` part:
  `<map>?MonsterClass=<behemoth>?HuntId=<id>?PlayerHuntIds=<list>`.
- **Idle exit.** A server on a port below 8776 exits after spending 50 seconds in total, from the
  moment it starts listening, without a connected player. The counter is never reset, and a player
  who is still joining does not count as connected. Ports 8776 and above are exempt: with
  `PORT_RANGE_END=8777` those are the Dojo and Ramsgate. **To allow more hunts, lower
  `PORT_RANGE_BEGIN`. Keep `PORT_RANGE_END` at 8777.** Raised, it lets a hunt land on an exempt port
  and never shut down. Lowered, it puts the Dojo (and below 8776 Ramsgate too) under the idle exit.

**The process.**

- The deploy server uses Node's default spawn, with no working directory of its own, so a server
  inherits the deploy server's. The servers end together with the deploy server; see
  [Host a server, step 15]({{ host_page.url | relative_url }}#stopping).
- Ramsgate starts together with the deploy server. The Dojo starts the first time someone is sent
  there, unless `ENABLE_DOJO=1` starts it at boot too (the kit writes `ENABLE_DOJO=0`). A hunt server
  starts for each matchmaking request.
- Starts are queued, `SECONDS_TO_WAIT_BETWEEN_GAMESERVER_STARTUP` apart (the kit writes 10).
- The DLL opens a console window for every server. Ramsgate and the Dojo are started with their
  window visible ("Running as a server!"). Hunt servers are started with their window hidden, so a
  new window does not flash up for every hunt. **Closing a visible console window ends that server**
  for everyone on it. The deploy server starts Ramsgate and the Dojo again when a player travels
  there, or its watchdog does within a minute, whichever comes first.
- On a server installed with the kit, the stack runs as `dauntless` without a desktop (Windows
  "session 0") unless the installer ran with `-InteractiveSession`. The console windows should work
  there too, but that has not been tested yet; see
  [Windows server kit]({{ winserver_page.url | relative_url }}#session-0-and--interactivesession).
- A server reads the user config folder of the account that runs the deploy server. That is why the
  kit writes `Game.ini` and `Engine.ini` for the `dauntless` account.
- Scripts tell servers from clients by a separate `-server` on the command line. Don't print those
  command lines: the first argument is the game-server key.

---

## The two DLLs {#dlls}

| File | Size | SHA-256 | What it does |
|:-----|-----:|:--------|:-------------|
| `dxgi.dll` | 11,264 bytes | `9A431D7B6FD20C43FA92BEBD91C3BC023EC7A3FCBC52871C41F4DF293D4B0D1F` | A proxy. Windows loads it from the game folder instead of the system copy. It loads the real `System32\dxgi.dll`, forwards `CreateDXGIFactory`, `CreateDXGIFactory1` and `CreateDXGIFactory2`, and loads `UndauntedInternalServer.dll`. Its source has not been published. |
| `UndauntedInternalServer.dll` | 123,392 bytes | `520EC588A0554E374B2B0D084CD7F7F08D59A9CB80362679845719D64A0D0933` | Undaunted's server DLL, version 0.0.3. Source in `UndauntedInternalServer/`. It hooks the game in memory, in client mode or in server mode (below). It needs the Visual C++ 2015-2022 x64 runtime (`MSVCP140.dll` and `VCRUNTIME140_1.dll` in `System32`). |

Both are upstream Undaunted's prebuilt, unsigned binaries, kept in `UndauntedLauncher/assets/`.
Every hook address in the server DLL is fixed to the pinned exe, so **never copy them into another
build**; in 2.1.1 they would crash the game. Antivirus may flag the proxy; see
[Windows Defender and the unsigned DLLs]({{ trouble_page.url | relative_url }}#windows-defender-and-the-unsigned-dlls).

**Where they go.** Next to the exe, in `<game folder>\Archon\Binaries\Win64\`. The game folder is
the one that contains `Archon\`.

| Installed by | Game folder (default) | Copied from | Checks |
|:-------------|:----------------------|:------------|:-------|
| Launcher | `%LOCALAPPDATA%\DauntlessRevived\Game`; Settings > Game > Game files can move it | The launcher's own resources folder | Hashes the launcher's copy, a temporary copy (`<name>.new`) and the final file, and clears the "downloaded from the internet" mark. Checks again before every PLAY and repairs them if needed. |
| Friend kit, `setup.ps1` | `-Game`, default `C:\D144\Dauntless` | The kit's `dll\` folder (in a repository checkout, `UndauntedLauncher\assets\`) | Hash before copying, `Unblock-File`, hash again after. A DLL that already matches is left alone. `play.ps1` checks both on every launch. |
| Server kit, `Install-DauntlessServer.ps1` | `<InstallRoot>\game\Dauntless` (default `C:\DauntlessRevived\game\Dauntless`), or `-GameDir` | `<InstallRoot>\app\UndauntedLauncher\assets` | Hash before copying, `Unblock-File`, hash again after. A DLL that already matches is left alone. |
| By hand | [Host a server, step 5]({{ host_page.url | relative_url }}#dlls); [Join as a friend]({{ friends_page.url | relative_url }}), step 3 | `UndauntedLauncher/assets/` | As written there |
| `tools/make-friend-kit.ps1` | Not applicable: it packs them into the kit's `dll\` folder | `UndauntedLauncher/assets/` | Hash before packing |

To uninstall, delete the two files. Nothing else in the game folder changes. The content manifest
does not list them, and the launcher refuses a manifest that does.

### How the server DLL picks its mode {#dll-mode}

The DLL decides once, at startup. If the raw process command line contains `-server`, it runs in
server mode; otherwise in client mode. The test is a case-sensitive substring match on the whole
command line, and that includes the exe's own path and the first argument.

**Keep `-server` out of client install paths and server host names.** This comes from reading the
code; we have not tested it. A client whose install folder (for example `D:\my-server\Dauntless`)
or first argument contains `-server` would start in server mode, try to read its login switches as
game-server arguments, and fail. One way this can happen: a private-mode invite that names the
server by its MagicDNS name, made with `-AdvertiseHost`, while the installer's default Tailscale
host name `dauntless-server` is in use. Invites with the default Tailscale IP address, and every
public-mode client (its first argument is `127.0.0.1:61000`), are not affected. Neither the launcher
nor the friend kit checks for this.

### Client mode {#dll-client-mode}

- Reads the first argument as the metagame address. It does so only when at least two arguments
  follow the exe name, which is always the case with our launchers.
- Hooks the engine's config lookup (`FConfigCacheIni::GetString`). It answers the 167 endpoint keys,
  in whatever section they are asked for, with `http://<address>/...`. In every section whose name
  contains `Mcp`, keys containing `Protocol` or `protocol` get `http`, and keys containing `Domain`
  or `RedirectUrl` get the address. That sends Epic account and OAuth traffic to the metagame too.
  The chat keys are not covered, hence the [`Engine.ini` override](#xmpp).
- Also: a `UConsole` on F2, `HasFinishedLoading` forced to true, Arena and Escalation hunts
  unlocked (Escalations whose id contains `Mint` excepted), and a console window ("Running as a
  debug-enabled client!").

### Server mode {#dll-server-mode}

- Reads the positional arguments above.
- Adds the `x-undaunted-gameserver-apikey` header with the game-server key to every HTTP request.
- Does **not** hook the config lookup. That is why game servers need [`Game.ini`](#game-ini).
- Gives the engine the fixed command line, boots straight into the map URL, starts listening three
  seconds after a world exists, runs actor replication itself, and applies the idle exit.

How server mode works inside the engine is described in
[How multiplayer works]({{ mp_page.url | relative_url }}).

### Built-in constants {#dll-constants}

None of these can be configured. Changing one means rebuilding the DLL, which changes its pinned
hash. Building it from source is on the [roadmap]({{ roadmap_page.url | relative_url }}).

| Constant | Value | Mode |
|:---------|:------|:-----|
| DLL version | `0.0.3` (`UndauntedInternalServer/constants.h`), printed in the console window | Both |
| Mode switch | `-server` anywhere in the raw command line, case-sensitive | Both |
| Console window | Always opened | Both |
| Metagame address | First argument, read when at least two arguments follow the exe | Client |
| Endpoint table | 167 keys, also the source of `Game.ini` | Client |
| Console key | F2 | Client |
| Minimum argument count | 8 after the exe name | Server |
| Engine command line | `Dauntless-Win64-Shipping.exe -server -unattended -nullrhi -nosound -EpicPortal -RepDriverDisable` | Server |
| Key header | `x-undaunted-gameserver-apikey` | Server |
| Start listening | 3 seconds after a world exists | Server |
| Idle exit | 50 seconds in total without a connected player | Server |
| No idle exit | Ports 8776 and above | Server |

---

## Pinned build facts {#pinned-build}

Everything on this page depends on one exact build. Every hook address and byte patch in the server
DLL is an offset into the pinned exe, so the exe hash is what keeps the DLL safe to load.

| Fact | Value |
|:-----|:------|
| Build string (`Version.txt` in the game folder) | `dauntless_rel-1.4.4_Shipping_2020-10-28_20-11-15_239827`. The file ends with a space and a line break (58 bytes), so compare trimmed text. |
| Changelist | `239827`. The server kit writes it into the metagame's settings as `TARGET_CHANGELIST`, and the metagame reports the build id `239827_1.4.4_shipping` when it sends a player to a game server. `TARGET_CHANGELIST` has no default: unset, the build id becomes `undefined_1.4.4_shipping`. |
| Engine | Unreal Engine `4.25.3-239827+++dauntless+rel-1.4.4`, the version the DLL's SDK headers were generated from |
| Exe | `Archon\Binaries\Win64\Dauntless-Win64-Shipping.exe`, SHA-256 `D3D41E614908D2BEFD518B27046D9822D6130EF12BA3504BABBDB786BEF9CFF4`, 103,673,520 bytes |
| Game zip | `BaseGame144.zip`, SHA-256 `556B9A648A5E5E7E11B6F8DD3D80FF8E88FCEB0D3448297AAF47CE7BF756BC6D`, 10,479,214,119 bytes. Its top folder is `Dauntless\`, which contains `Archon\`. |
| Content manifest | `UndauntedContent/data/dauntless-1.4.4.json`: 410 files, 10,893,512,875 bytes, with a `build` field equal to the build string. It lists no ini files (the cooked config is inside the paks, and the user config lives outside the game folder) and not the two DLLs. Generated with `tools/make-game-manifest.js`. |
| Phoenix's own manifest | `Manifest.bin.json` in the game folder: 406 entries. Our 410 are those plus `Manifest.bin.json` itself, `Manifest.bin` and two empty `debug.log` files. How we checked it is in [Host a server, step 2]({{ host_page.url | relative_url }}#verify-the-build) and [Verifying game files]({{ verification_page.url | relative_url }}). |

### Who checks the pins {#pin-checks}

| Check | Launcher | Friend kit | Server kit installer | Elsewhere |
|:------|:---------|:-----------|:---------------------|:----------|
| Game zip SHA-256 | Not applicable: it downloads single files, not the zip | `setup.ps1 -Zip` | A resumable download is verified against it; the zip is hashed again before extraction | `tools/make-game-manifest.js` refuses any other zip unless it is run with `--zip-sha256` or `--skip-zip-hash`; even then it refuses a zip whose `Version.txt` or exe differs from the pins |
| Exe SHA-256 | Before every PLAY | `setup.ps1`, and `play.ps1` on every launch | Before anything runs from the game folder; stops if it is wrong (not enforced under `-Sandbox`) | `tools/make-game-manifest.js` |
| DLL SHA-256s | On install, and before every PLAY (repairs them) | `setup.ps1` before and after copying; `play.ps1` on every launch | Before and after copying | `tools/make-friend-kit.ps1` before packing |
| Build string | The compiled-in manifest must carry it, or the launcher refuses the manifest | Not checked | Warns if `Version.txt` names another build | `tools/make-game-manifest.js` checks `Version.txt` inside the zip; the content server only logs a warning for a manifest with another build |
| Every game file | Each download is checked against the compiled-in manifest; Repair re-hashes every file | Not checked | `lib/verify-game.js` hashes every file against the manifest | The content server checks sizes at startup and serves only listed files |

### Where the pins live {#pin-locations}

There is no single source of truth: the same values are written into several files. Change them
together, and only together with the files they describe.

| Value | Files |
|:------|:------|
| Exe SHA-256 | `UndauntedLauncher/src/main/constants.ts`, `deploy/windows-server/DauntlessServer.Common.ps1`, `friend-kit/play.ps1`, `friend-kit/setup.ps1`, `tools/make-game-manifest.js`, `UndauntedContent/data/dauntless-1.4.4.json` (and its test) |
| Exe size | `UndauntedLauncher/src/main/constants.ts` and `UndauntedContent/data/dauntless-1.4.4.json` (and its test). The other files check the hash only. |
| DLL SHA-256s | `UndauntedLauncher/src/main/constants.ts`, `deploy/windows-server/DauntlessServer.Common.ps1`, `friend-kit/play.ps1`, `friend-kit/setup.ps1`, `tools/make-friend-kit.ps1` |
| Zip SHA-256 | `deploy/windows-server/DauntlessServer.Common.ps1` (with the byte count), `friend-kit/setup.ps1`, `tools/make-game-manifest.js` |
| Build string | `UndauntedLauncher/src/main/manifest.ts`, `UndauntedContent/src/manifest.ts`, `deploy/windows-server/DauntlessServer.Common.ps1`, `tools/make-game-manifest.js`, the manifest JSON |
| Changelist | `deploy/windows-server/DauntlessServer.Common.ps1`, which writes the metagame's `TARGET_CHANGELIST` |

---

## Game data the metagame serves {#server-data}

Some of what the game shows comes from the metagame's own data files, not from the game's paks: the
progression tracks (Hunt Pass seasons and mastery), the store's offers and the Escalation seasons. They
live in `UndauntedMetagame/src/vendor/` and are copied to `dist/vendor/` by the build. They hold
identifiers and tuning values read from the 1.4.4 client, and no game assets.

### Hunt Pass seasons and mastery tracks {#hunt-pass-seasons}

`vendor/progression_config.json` (from upstream) holds 10 tracks: the Hunt Pass `season09b`,
`MasteryTrack_PlayerLevel` (Slayer level), `MasteryTrack_Behemoth` and seven
`MasteryTrack_Weapon_*` tracks. The metagame
serves it at `GET /progression/config`, and the same data drives its rank math, so the game and the
server always agree.

**`PROGRESSION_CONFIG_DIR`** (unset by default) points at a folder of your own `.json` files that
replace or add tracks, without editing the bundled file:

- Each file holds one path object (the shape of an entry in `payload.paths` of the bundled file), a
  list of them, or a whole config `{"payload": {"paths": [...]}}`. Files are read in name order.
- A path whose `progression_id` exists in the bundled file replaces it in place (the client sees the
  same order); a new id is added at the end.
- Each path needs a `progression_id` and a non-empty `requirements` list of
  `{"rank_id", "xp_required"}` pairs of whole numbers, in rising `rank_id` order. `free_rewards` and
  `premium_rewards`, when present, are lists; `premium_gating_entitlement` is a string (the Elite
  pass's entitlement); `prestige`, when present, has a whole `xp_per_level` above 0. Every `rank_id`
  used in a reward list needs its requirement, or the client complains
  ([Backend contract]({{ '/findings/backend-contract.html' | relative_url }}#progression-progression-prod)).
- The same id twice in the folder, invalid JSON, a missing folder or a folder without `.json` files
  stops the metagame at startup with a line naming the file (`The progression config could not be
  loaded: ...`). The boot line then reads, for example, `Progression config: 10 tracks, from
  C:/dr/seasons: season09b replaced; active Hunt Pass season09b`.
- The folder is read once; restart the metagame after a change.

**`ACTIVE_HUNT_PASS`** (default `season09b`) is the Hunt Pass an account has until one is stored for
it. It must be a loaded track, or the metagame stops at startup.

**Never change a season's ranks in place while players have progress in it.** Players' stored XP is
turned into ranks with the new requirements at the next read, so they could jump or fall. The rank
rewards themselves are paid by the game server, from the client's own reward tables
([why]({{ '/findings/backend-contract.html' | relative_url }}#progression-on-our-server)).

### The store catalogue {#store-catalogue}

Only used with `STORE=free` ([The in-game store]({{ '/findings/store.html' | relative_url }})):

| File | What it holds |
|:-----|:--------------|
| `vendor/store_catalog.json` | The offers, keyed by the tag the client asks for: 200 under `webstore`, the Elite pass under `season09b_pass`, and the empty `season09b_rank`, `loadout_slots` and `fountain_daily_free_bundle`. Each offer has the client's flat price fields (all 0), `items` (catalogue id and quantity) and `entitlements` (name and duration), and category tags that decide its store tab. The metagame only sells offers whose `platinumPrice` is 0. |
| `vendor/store_item_kinds.json` | For each of the 211 items the store sells: `stacked` or `instanced`, the stackable flag of the client's item catalogue. An item without an entry is never granted. |
| `test/data/store_art_skus.json` | The 994 SKU ids whose store tile image is 2:1. Only a test reads it: every offer in the storefront must be one of them, or its tile shows the fallback art or a stretched image. |

Change the catalogue only together with the test (`npm test` in `UndauntedMetagame`) and an in-game
check of the store tabs: an empty tab placed before a filled one shifts every later tab's contents.
The repeatable bounty-token bundle (`bundle_currency_bounty_small`) is listed only with
`STORE_REPEATABLE_TOKENS=1`.

### Escalation seasons {#escalation-seasons}

Only used with `ESCALATION_MODE=real` ([Escalation]({{ '/findings/escalation.html' | relative_url }})):
`vendor/escalation/seasons.json` lists the five seasons of the 1.4.4 client (`ESC_SEASON_1` to
`ESC_SEASON_5`; the fifth, Frost, is disabled), each with its 25 level costs, 18 talents (tier gate
and rank costs) and 6 rewards (level and contents). It was exported read-only from the client's own
tables, and its `source` block names the game files it was read from by their SHA-256. The metagame
checks it at startup and uses it only to check saves; the game server does the arithmetic. Do not edit
it: a wrong value refuses (or, in the soft rules, warns about) real saves.

---

## Changing game settings {#changing}

For contributors. The `Engine.ini` lines exist in four copies that must stay identical:

- `UndauntedLauncher/src/main/engineini.ts`
- `friend-kit/play.ps1`
- the host's `play.ps1`, and its listing in [Host a server, step 13]({{ host_page.url | relative_url }}#launch-the-client)
- `Write-DRGameUserConfig` in `deploy/windows-server/DauntlessServer.Common.ps1` (memory lines and
  chat only)

The launch arguments are in `UndauntedLauncher/src/main/launch.ts`, `friend-kit/play.ps1` and the
host's `play.ps1`.

Tests that cover them: `UndauntedLauncher/test/engineini-launch.test.ts` checks the launcher's
`Engine.ini` byte for byte and pins the exact argument list, and
`deploy/windows-server/tests/Test-Sandbox.ps1` checks that a sandbox install writes 167 `Game.ini`
lines pointing at `127.0.0.1:62000`. Nothing tests the kit's `Engine.ini`. The kit's `Game.ini`
generator depends on each entry of the endpoint table in `dllmain.cpp` staying on one line in its
current shape. After a change to that table, run the installer again on every server. How to run
the tests is on [Developer guide]({{ dev_page.url | relative_url }}).
