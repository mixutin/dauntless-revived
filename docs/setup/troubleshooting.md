---
title: Troubleshooting
parent: Setup
nav_order: 5
description: "Problems we hit running the Dauntless 1.4.4 client against a Dauntless Revived server, with causes and fixes: port clashes, login, blurry graphics, Defender and git."
lang: en
ref: setup/troubleshooting
---

{% assign host_page = site.pages | where: "path", "setup/host.md" | first %}
{% assign roadmap_page = site.pages | where: "path", "roadmap.md" | first %}
{% assign crashes_page = site.pages | where: "path", "findings/crashes.md" | first %}
{% assign awakening_page = site.pages | where: "path", "findings/awakening-2-1-1.md" | first %}
{% assign files_page = site.pages | where: "path", "reference/files.md" | first %}
{% assign chat_page = site.pages | where: "path", "findings/chat.md" | first %}
{% assign config_page = site.pages | where: "path", "reference/configuration.md" | first %}
{% assign ports_page = site.pages | where: "path", "reference/ports.md" | first %}

# Troubleshooting
{: .no_toc }

These are the problems we actually hit while setting up Dauntless Revived, with their causes and fixes.
A few entries at the end come from reading the code and haven't bitten us yet; those are marked. The
setup itself is in [Host a server]({{ host_page.url | relative_url }}). Unless an entry says otherwise, it is about client build
**1.4.4**. Entries about **2.1.1** are kept because the same machine often has both builds.

<details open markdown="block">
  <summary>Contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

## Where to look first

| Source | What it tells you |
|---|---|
| `C:\dr\data\metagame.log` | One JSON line per event. The fork logs every request as `METHOD /path gs=0` (client) or `gs=1` (game server). This is the main instrument: how far did the client get, and what did it ask for last? |
| `C:\dr\data\deploy.log` | Matchmaking requests, `Running Gameserver Watchdog!` every 60 s, `Cleaning up Gameserver on port N` when a server exits. |
| Game-server console windows | Opened by the server DLL; they show the server's own output. Ramsgate's and the Dojo's are visible. Hunt servers are started with their window hidden. |
| Client console window | Opened by the DLL in client mode and kept hidden. To see it, turn on Settings > Troubleshooting > "Show the log window" in the launcher (it sets `DR_SHOW_CONSOLE=1` for the game). **With it on, if no console window appears when the client starts, the DLLs are not loaded.** |
| `%LOCALAPPDATA%\Archon\Saved\Crashes\` | Crash reports. See [Crash forensics]({{ crashes_page.url | relative_url }}) for reading them. |
| `C:\DauntlessRevived\data\logs\` (Windows server kit) | The same logs as `metagame.out.log` and `deploy.out.log`, plus the gateway's access log (`gateway.out.log`) and the supervisor's `supervisor.log`. |
| `%APPDATA%\Dauntless Revived Launcher\logs\launcher.log` | The friend launcher: joins, connection problems, downloads and the game's command line (with the key hidden). |

Every log file, its format and how it is rotated: [Files and data]({{ files_page.url | relative_url }}#logs).

The 1.4.4 shipping client writes no game log file of its own. `Saved\Logs` only holds the embedded
browser's logs. To read the metagame log as plain text:

```powershell
Get-Content C:\dr\data\metagame.log -Tail 40 | ForEach-Object { try { ($_ | ConvertFrom-Json).msg } catch { $_ } }
```

---

## Port 60000 is taken, and the metagame says "Clear Skies" anyway {#port-60000-is-taken-and-the-metagame-says-clear-skies-anyway}

**Symptom.** The metagame printed that it was listening on port 60000, and `Clear Skies, Slayer.`,
but nothing worked. The client and our own HTTP calls to `127.0.0.1:60000` connected and then waited
forever. The request log stayed empty.

**Cause.** Two problems together:

1. `127.0.0.1:60000` belonged to **`ShadowUSB`**, a service installed with the Shadow client app (the
   cloud-gaming client, installed on our own PC). It accepts TCP connections on that port and never
   answers HTTP.
2. Upstream's `app.listen(PORT, () => { ... })` ignores the error that Express 5 passes to the listen
   callback. The failed bind still printed the success lines, and then the process exited.

**Fix.**

- Find out who owns a port before you use it:

  ```powershell
  Get-NetTCPConnection -LocalPort 60000,61000,61001 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { "{0}:{1} {2}" -f $_.LocalAddress, $_.LocalPort, (Get-Process -Id $_.OwningProcess).ProcessName }
  ```

- We moved to **61000** (metagame) and **61001** (deploy server). Change `PORT`, `QOS_TARGET_URL` and
  `DEPLOYSERVER_URL` in the metagame `.env` and `PORT` in the deploy server's `.env`. Then
  **regenerate** `Game.ini` with `make-gameini.ps1 -Metagame 127.0.0.1:61000`
  ([Host a server, step 8]({{ host_page.url | relative_url }}#game-ini)).
- Our fork's metagame and deploy server now treat a failed bind as fatal and exit with code 1:

  ```
  Could not listen on 127.0.0.1:60000: listen EADDRINUSE: address already in use 127.0.0.1:60000
  ```

**Follow-up we also hit.** After the move, two entries in `Game.ini` were still on port 60000. Our
search-and-replace matched `:60000/`, and `MatchmakingEndpoint` and `TrackingEndpoint` are bare
`http://host:port` values with no path, so matchmaking and telemetry would have stayed on the old
port. A search for leftover `60000` strings caught them. Regenerating the file instead of editing it
avoids this.

---

## Invoke-RestMethod hangs {#invoke-restmethod-hangs}

**Symptom.** In Windows PowerShell 5.1,
`Invoke-RestMethod -Method Post -Uri http://127.0.0.1:60000/undaunted/api/Register ...` never
returned, and the metagame logged nothing.

**What it actually was.** At first we put it down to a PowerShell 5.1 quirk and switched to Node.
The real cause was the previous entry: the port belonged to `ShadowUSB`, which accepted the connection
and never replied. `curl.exe -m 5` made that obvious: it connected immediately, got no HTTP response
in 5 seconds (`http=000`), and a check of the listening process showed `ShadowUSB`.

**Fix and habit.**

- Check who owns the port (previous entry) before blaming the client.
- Put a time limit on every scripted HTTP call so a wrong listener fails fast:

  ```powershell
  curl.exe -s -m 5 http://127.0.0.1:61000/dauntless-status
  Invoke-RestMethod -Uri http://127.0.0.1:61000/dauntless-status -TimeoutSec 10
  node -e "fetch('http://127.0.0.1:61000/dauntless-status', { signal: AbortSignal.timeout(5000) }).then(r => r.text()).then(console.log)"
  ```

We still make admin calls with Node `fetch` and `AbortSignal.timeout`, because the same one-liner can
also update the database through `better-sqlite3` (see
[Host a server, step 10]({{ host_page.url | relative_url }}#admin-account)).

---

## git: "Filename too long" and "'$GIT_DIR' too big" {#git-filename-too-long}

**Symptom.** Cloning Undaunted into a deeply nested working folder printed
`error: unable to create file ...: Filename too long`, even for files like
`.git/hooks/fsmonitor-watchman.sample`. It then ended with:

```
fatal: '$GIT_DIR' too big
fatal: remote helper 'https' aborted session
```

**Cause.** The Windows 260-character path limit. The working folder's path was already long, and the
repository adds up to 94 more characters. The deepest names are in
`UndauntedInternalServer/SDK/`, a generated SDK of 4,000+ files. Git's own files under `.git` add more
still. Adding `-c core.longpaths=true` did **not** fix it: the `$GIT_DIR` error comes from the
repository location itself being too long.

**Fix.** Clone to a short path and keep `core.longpaths` set for the files inside:

```powershell
git -c core.longpaths=true clone <URL of this repository> C:\dr\undaunted
git -C C:\dr\undaunted config core.longpaths true
```

We didn't enable Windows' system-wide long-path setting. The short path made it unnecessary. The
same reasoning applies to the game install (`C:\D144`) and to building the server DLL with MSVC later.

---

## Blurry graphics {#blurry-graphics}

**Symptom.** 1.4.4 looked soft and low-detail whatever we chose in the options menu, and ran in a
small window.

**Cause.** Our own memory caps. After the 2.1.1 memory scare (next entry), we had written these into
the shared user `Engine.ini`, and we launched with `-windowed -ResX=1280 -ResY=720`:

```ini
[SystemSettings]
r.Streaming.PoolSize=400
r.Streaming.LimitPoolSizeToVRAM=1
r.Streaming.FullyLoadUsedTextures=0
r.MipMapLODBias=2
r.ScreenPercentage=70
sg.ViewDistanceQuality=0
sg.ShadowQuality=0
sg.PostProcessQuality=0
sg.TextureQuality=0
sg.EffectsQuality=0
sg.FoliageQuality=0
t.MaxFPS=60
gc.TimeBetweenPurgingPendingKillObjects=10
s.ForceGCAfterLevelStreamedOut=1
```

`[SystemSettings]` in the user `Engine.ini` overrides the menu. So the options screen showed one
thing while the engine rendered at 70 % resolution with blurred texture mips. On top of that, UE4's
temporal anti-aliasing softens the image a little at any setting.

**Fix.** `play.ps1` now rewrites `[SystemSettings]` on every launch
([Host a server, steps 13-14]({{ host_page.url | relative_url }}#graphics)):

- `-Graphics 4` (Cinematic) by default.
- `r.ScreenPercentage=100`, `r.MipMapLODBias=0`, `r.MaxAnisotropy=16`, `r.Tonemapper.Sharpen=0.6`.
- A texture pool of 3000 MB, limited to the GPU's memory.
- The same level mirrored into `GameUserSettings.ini`.
- No FPS cap and no forced window.

`-Graphics -1` keeps only the memory lines and lets the menu decide. At Cinematic and 1920x1080, the
client uses 1.9-2.3 GB of RAM, so the low caps were never needed for 1.4.4.

### Airship is extremely dark with blown-out windows {#airship-dark-windows-blown-out}

**Symptom.** The hunt UI looks normal, but the pre-hunt airship cabin is nearly black while its
windows are solid white. It can vary between hunts because the lobby previews the hunt atmosphere.

**Cause.** Dauntless 1.4.4's histogram eye adaptation can react badly to the airship's unusually
large brightness range on current graphics drivers. This is a post-processing problem, not missing
textures or an incorrect hunt definition.

**Status: not fixed by default.** Vvoidddd found that `r.EyeAdaptationQuality=0` in `Engine.ini`
(automatic exposure off) fixes the airship, and launcher 0.1.0 and the friend kit set it. In the first
real test (22 September 2026) it made Ramsgate and every night scene far too dark, because those scenes
rely on automatic exposure to brighten them. So since launcher 0.1.1 nothing turns automatic exposure
off, and the launcher removes the line 0.1.0 wrote on the next launch. The airship cabin is a short
scene.

**An experiment you can try.** Vvoidddd added an opt-in setting to the launcher
([#7](https://github.com/mixutin/dauntless-revived/pull/7)): in Settings > Graphics, **Auto
exposure** has a **Basic adaptive (experimental)** choice. It writes
`r.EyeAdaptation.MethodOverride=2` to `Engine.ini`, which the 1.4.4 game executable (the
hash-pinned `Dauntless-Win64-Shipping.exe`) describes as "Auto Basic": a simpler way of measuring
the scene, with automatic exposure still on. The default stays **Game default** for everyone. Try
Basic on your own PC and compare the same airship, Ramsgate and a night hunt; if anything looks
worse, choose Game default again and relaunch. The line stays in `Engine.ini` until the next launch
through the launcher, or through the friend kit, which also rewrites that section. Nobody has checked
the result in game yet, so a fix that does not darken the rest of the game is still item 4.17 on the
[roadmap]({{ roadmap_page.url | relative_url }}).

To see what is really being forced:

```powershell
Get-Content "$env:LOCALAPPDATA\Archon\Saved\Config\WindowsClient\Engine.ini" -TotalCount 20
```

---

## Memory spikes and caps {#memory-spikes-and-caps}

**What happened (2.1.1).** A standalone 2.1.1 client booting straight into Ramsgate, with no limits,
climbed to **9 GB**. Together with everything else running, that took our 32 GB PC to 98 %
(31.3 of 31.9 GB). With a 400 MB texture pool, low scalability groups and the two garbage-collection
lines, the same boot peaked at about **2.8 GB**. We also added a watchdog that killed the process
above 6.5 GB. Details: [The 2.1.1 standalone attempt]({{ awakening_page.url | relative_url }}).

**1.4.4 is much lighter** (our measurements, one player):

- Ramsgate server: about 1.1 GB.
- Hunt server: about 0.9 GB.
- Client at Cinematic: 1.9-2.3 GB.

So the setup keeps only the caps that don't cost image quality: a 3000 MB pool limited to VRAM, plus
`gc.TimeBetweenPurgingPendingKillObjects=10` and `s.ForceGCAfterLevelStreamedOut=1`.

**What we use now.**

- `play.ps1 -Seconds 180 -CapMB 12000` watches the client for 3 minutes. It prints its RAM every 30 s
  and kills it if it goes over the cap.
- Our manual server test script does the same for a game server (default cap 5000 MB).
- Before a session, close heavy programs. If you use WSL, `wsl --shutdown` frees what its VM holds
  (about 3 GB on our PC). You can also cap it permanently in `%UserProfile%\.wslconfig`:

  ```ini
  [wsl2]
  memory=4GB
  ```

**Known gap.** Upstream's deploy server starts game processes with no memory limit, and six
simultaneous hunts are possible with the default port range. A per-server memory guard is on the
[roadmap]({{ roadmap_page.url | relative_url }}). Until then, watch the servers with:

```powershell
Get-CimInstance Win32_Process -Filter "Name='Dauntless-Win64-Shipping.exe'" | ForEach-Object { "{0,6}  server={1}  {2} MB" -f $_.ProcessId, ($_.CommandLine -match ' -server'), [int]($_.WorkingSetSize/1MB) }
```

---

## Stale EOS overlay processes (2.1.1 only) {#stale-eos-overlay-processes}

**Symptom (2.1.1).** After a crashed run, the Epic sign-in overlay didn't come up on the next launch.

**Cause.** `EOSOverlayRenderer-Win64-Shipping` processes left over from the crashed run.

**Fix.** Kill only those processes before relaunching. Leave the Epic Games Launcher alone.

```powershell
Get-Process EOSOverlayRenderer-Win64-Shipping -ErrorAction SilentlyContinue | Stop-Process
```

This doesn't apply to the 1.4.4 setup on this site. 1.4.4 predates Epic Online Services, has no EOS
overlay, and logs in with a key issued by our own metagame.

---

## Windows Defender and the unsigned DLLs {#windows-defender-and-the-unsigned-dlls}

**Background.** `dxgi.dll` and `UndauntedInternalServer.dll` are unsigned. A proxy DLL that hooks a
game is the kind of thing heuristic antivirus flags. On our PC, Defender reported **no detections**
after we copied them in. We checked with:

```powershell
Get-MpThreatDetection -ErrorAction SilentlyContinue | Where-Object { $_.InitialDetectionTime -gt (Get-Date).AddHours(-1) } |
  Select-Object InitialDetectionTime, @{n='Resources';e={$_.Resources -join ';'}}
```

**If Defender flags or removes one of them:**

- Don't turn Defender off, and don't exclude whole folders.
- Compare the file you have with the pinned hashes in
  [Host a server, step 5]({{ host_page.url | relative_url }}#dlls). If it doesn't
  match, delete it and copy it again from a fresh clone.
- If the hash matches, the detection is heuristic, on bytes we have analysed. Our static analysis of
  both files is summarised in step 5. Whether to restore that one file from **Windows Security →
  Protection history** is your decision.
- We cloned with git, so we never hit this, but downloading the repository as a zip marks the files
  as coming from the internet. After checking the hashes, `Unblock-File` on the two DLLs clears that
  mark.

The lasting fix is to build `UndauntedInternalServer.dll` from source and replace `dxgi.dll` with our
own small proxy. The source of `dxgi.dll` is not in the Undaunted repository and, as far as we know,
has not been published. Both are on the [roadmap]({{ roadmap_page.url | relative_url }}).

---

## npm allow-scripts warnings {#npm-allow-scripts-warnings}

**Symptom.** `npm ci` (npm 11.17 on Node 24.19) in both server folders ended with:

```
npm warn allow-scripts   esbuild@0.18.20 (postinstall: node install.js)
npm warn allow-scripts   better-sqlite3@12.11.1 (install: prebuild-install || node-gyp rebuild --release)
npm warn allow-scripts   esbuild@0.25.12 (postinstall: node install.js)
npm warn allow-scripts   esbuild@0.28.1 (postinstall: node install.js)
npm warn allow-scripts
npm warn allow-scripts Run `npm approve-scripts --allow-scripts-pending` to review, or `npm approve-scripts <pkg>` to allow.
```

**What it meant for us.** Nothing broke:

- `npm run build` (plain `tsc`) succeeded.
- The one native module the servers need was present.
- `esbuild` is only used by development tools (`tsx`, `drizzle-kit`), and `npm start` doesn't run
  those.

Check the native module:

```powershell
Test-Path C:\dr\undaunted\UndauntedMetagame\node_modules\better-sqlite3\build\Release\better_sqlite3.node
```

**If that prints `False`,** the metagame can't open its database. Review and approve only that
package, as npm suggests, then reinstall:

```powershell
npm approve-scripts better-sqlite3
npm ci --no-audit --no-fund
```

Its install script downloads a prebuilt binary (`prebuild-install`) or, failing that, compiles one
(`node-gyp`, which needs the Visual Studio C++ build tools). We haven't needed this step ourselves.
The native module is tied to the Node version, so run `npm ci` again after any Node upgrade.

---

## Endpoint values cut to "https:" (the ini `//` truncation) {#ini-truncation}

**Symptom (seen on 2.1.1).** All 163 values in an `[OnlineSubsystemPhoenix]` block in the user
`Engine.ini` read just `https:`, for example `AccountInfoEndpoint=https:`. Everything from the `//` on
was gone.

**Cause.** The engine's ini parser treats `//` inside an **unquoted** value as the start of a comment
and cuts the value there. The game writes its config back to disk, so the cut values replaced the
originals. That block happened to be harmless: `[OnlineSubsystemPhoenix]` belongs to the `Game.ini`
hierarchy, so in `Engine.ini` it was never read, and the live 2.1.1 traffic still reached the full
URLs. As an override in `Game.ini`, it would have broken every endpoint.

**Fix.**

- **Quote every URL** you put in a user ini, the way Phoenix's cooked config does:
  `AuthEndpoint="http://127.0.0.1:61000/game/login"`.
- Put endpoint overrides in `Game.ini`, never `Engine.ini`. Delete any `[OnlineSubsystemPhoenix]`
  block you find in `Engine.ini`.
- Generate `Game.ini` with `make-gameini.ps1`
  ([Host a server, step 8]({{ host_page.url | relative_url }}#game-ini)) and
  run its health check. It should report `entries: 167  not fully quoted: 0`.

On 1.4.4, our quoted `Game.ini` has been rewritten by the game after many sessions and every value is
intact. We have not tested unquoted values on 1.4.4.

---

## A game server vanished when a window was closed {#server-console-windows}

Every game server opens a console, because the server DLL's console logging is on by default. The
deploy server shows the windows of Ramsgate and the Dojo and starts hunt servers with their window
hidden. **Closing a console window ends that server** for everyone on it. The deploy server starts
Ramsgate (and the Dojo) again as soon as a player travels there, or its watchdog does within about a
minute. A hunt server is not restarted.
Leave the windows open (minimise them). Writing server output to log files instead is on the
[roadmap]({{ roadmap_page.url | relative_url }}).

A message box reading **"INVALID GAMESERVER ARGS"** means a game server was started with fewer than
eight arguments after the exe name. Compare your command with the manual server command in
[Host a server, step 11]({{ host_page.url | relative_url }}#deploy-server).

---

## Log lines that look alarming but are known {#log-lines-that-look-alarming-but-are-known}

From our own metagame log (1.4.4, one player, one evening of tutorial, Ramsgate and the Dojo):

| Line | Seen | What it is |
|---|---|---|
| `Unstubbed route POST /loadout/<account>/<character>/unlock/3` | 40+ | Upstream has no handler for unlocking a loadout slot. The game server (`gs=1`) sends it in bursts of retries, several within a few seconds, then again minutes later. Harmless. Handled since real progression became the default (roadmap 2.4); a low-level account sends none, so you only see this line with `PROGRESSION_MODE=stub`. |
| `Failed to update characterId ... due to conflict` | 14x | The client and the game server both save the character, with version numbers, and reject each other's writes. Each time, the side whose write was rejected (sometimes the client, sometimes the game server) re-read the character and wrote again within about a second, so the last write reached the database. Not yet proven lossless when both change the same value at once; on the roadmap. |
| `Unstubbed route GET /friends/api/public/friends/<account>` and `.../blocklist/<account>` | 2x each | There was no friends list then; the game showed "0 ONLINE FRIENDS". The fork now answers both routes (everyone still shows as offline). `MISC_ROUTES=0` puts the 404 back. |
| `Unstubbed route GET /account127.0.0.1:61000` | 2x | One URL that the client assembles from the DLL's address override is missing a `/`: the metagame's address is pasted straight after `/account` (Harmonic's fork found the same and answers it with account data). The request carries no credentials. The metagame answers 404; nothing visible breaks. The real fix belongs in the server DLL (roadmap 4.6). |
| `Game server on port 877x (pid ...) exited with code 0` (deploy log) | after every hunt | A game server ended normally. Any other code, or `on <signal>`, is a warning worth a look. |
| `Unhandled progression request <METHOD> <path> from a game server` | rare | The game sent a progression request no route answers (it still gets 404). Note the path: it may be a route we have not built yet. |
| `Unstubbed route POST /candidate/player/alive`, `DELETE /candidate` | a few | Matchmaking-queue housekeeping. The fork now answers `POST /candidate/player/alive` (`MISC_ROUTES=0` puts the 404 back). `DELETE /candidate` still gets a 404 on purpose: the client sends it right after every queued join, and hunts start only because it fails. `MATCHMAKING_CANCEL=1` turns a handler on, as an experiment. |
| `Unauthenticated POST to /heartbeat which needs metagame auth!` | once | An early telemetry heartbeat sent during login, before the session is set up. Later heartbeats are authenticated. |
| `Running Gameserver Watchdog!` (deploy log) | every 60 s | Normal. |
| `Cleaning up Gameserver on port 8775` (deploy log) | when a hunt ends | The hunt server exited and its port went back to the pool. |

---

## Log lines of Escalation, the store, Slayer Links and the deploy server {#log-lines-of-the-port}

These came with the port of Harmonic's fork ([The Harmonic port]({{ '/findings/harmonic-fork.html' | relative_url }})).
Metagame lines unless marked.

**At every start**

| Line | Meaning |
|:-----|:--------|
| `features: bodyLogPerPath=no-cap escalation=stub ...` | The value of every new switch. Check it after changing a setting. |
| `Progression config: bundled, 10 tracks; active Hunt Pass season09b` | The progression tracks in use; with `PROGRESSION_CONFIG_DIR`, which were replaced or added. |
| `The progression config could not be loaded: <reason>` (fatal) | A season file or `ACTIVE_HUNT_PASS` is wrong; the metagame stops before it opens the database. Fix the file named in the reason, or remove the setting. |
| `<NAME>="<value>" is not a valid value; using the default (<default>)` | A switch has a value it does not understand; the default is used. |
| `Removed N expired store purchase token(s) that were never redeemed` | Housekeeping of the store's tokens. |
| `Removed N store purchase receipt(s) redeemed more than 30 days ago` | Housekeeping of the store's receipts; the grants stay in the item log and the entitlements. |
| `Ramsgate and Dojo liveness check before handing them out: on` (deploy log) | `PERSISTENT_WORLD_LIVENESS` is on. |
| `Starting the game servers failed: <message>` (deploy log, fatal) | Ramsgate could not be started at boot (often a wrong `GAMESERVER_BINARY_PATH`). The deploy server keeps running and tries again at the next trip to Ramsgate; its exit code is 1 when it ends. |

**The deploy server** (deploy log)

| Line | Meaning |
|:-----|:--------|
| `Ramsgate is not running any more: starting it again before sending anyone there` | A player travelled to a dead Ramsgate; it is started first (the same for the Dojo). The player waits a few seconds longer. If it keeps happening, find out why Ramsgate dies (a closed console window, memory). |
| `RAMSGATE HAS FALLEN! Restarting!` | The watchdog found Ramsgate dead and started it (only when no restart is already running). |
| `Game server on port N failed: <error> (GAMESERVER_BINARY_PATH is <path>)` | The game could not be started, usually a wrong path in `GAMESERVER_BINARY_PATH`. |
| `Matchmaking for <mode> <hunt> failed: <message>` | No game server could be started (for example `No free ports left!`); the players' search fails. |
| `Could not restart the game server on port N: <message>` | The watchdog could not restart Ramsgate or the Dojo; the next trip there tries again. |

**Progression**

| Line | Meaning |
|:-----|:--------|
| `Progression grant for <account> repeats the grant of N s ago: answered its stored reply, nothing added` | The game server sent the same grant again less than `PROGRESSION_REPLAY_WINDOW_S` seconds later (a retry). Normal right after a network hiccup. If it shows up often in normal play, set `PROGRESSION_REPLAY_WINDOW_S=0` and report it. |
| `progression: objective went backwards: ...; stored as sent` | An objective arrived lower than stored. Stored anyway; worth a note if it repeats. |
| `Game server <what> for <account> carries the token of <other account>: accepted for <account>, ...` | A game server wrote for one player with another player's token. The write is kept for the account in the URL. Expected now and then in hunts with several players; report it if it repeats for the same pair. |
| `Balances of <account> from the inventory of character <id>: ...` | `/balance` or `/reconcile` reported held currencies. |

**Escalation** (only with `ESCALATION_MODE=real`)

| Line | Meaning |
|:-----|:--------|
| `Escalation <season> for <account>: vN level L xp X, ...` | A save was stored. |
| `Escalation <season> vN for <account> replayed` | The same save arrived again; nothing changed. |
| `Refusing escalation save of <season> for <account> (<status>): <reason>` | A save broke a hard rule. `first save carries the old stub values` or `save over level N carries the old stub values` means a game server still held the old fake maximum: restart the game servers. A `stale snapshot` now and then is harmless. |
| `Escalation save of <season> for <account> breaks a soft rule, stored anyway (ESCALATION_STRICT=0): ...` | Stored, but our model of the rules may be wrong. Keep `ESCALATION_STRICT` off and report the line. |

**The store** (only with `STORE=free`)

| Line | Meaning |
|:-----|:--------|
| `Store purchase token for <sku> issued to <account> (character <id>)` | Buy was pressed. |
| `Store purchase <sku> for <account> (character <id>): N item(s), M entitlement(s)` | The purchase went through. |
| `Store purchase <sku> of <account> was already redeemed; nothing granted again` | A retried confirm. Harmless. |
| `Store <what> refused (<status>): <message>` | A refused request, with the reason (an expired token, an offer that changed, an account without a character, `You already own everything this offer grants`, `Too many purchases`: 60 tokens in 10 minutes). |
| `Store SKUs requested for unknown tag <tag>: an empty list` | The game asked for a store page we have no offers for. |

**Slayer Links**

| Line | Meaning |
|:-----|:--------|
| `slayerlink: invite by=<A> to=<B> slot=<n> -> sent id=<id>` | An invite was sent. |
| `slayerlink: accept by=<B> other=<A> id=<id> -> accepted (slots X and Y)` | A link began (`reject` and `cancel` log the same way). |
| `slayerlink: ... refused <status>: <reason>` | A refused action with the reason (not friends, the slot is taken, the invite ran out). `the slot must be 1 to 3` means a client sent a slot the 1.4.4 client does not have; `too many invites` means more than 20 new invites in 10 minutes from one player. |
| `slayerlink: delete link by=<A> ... -> removed <id> (with <B>)` | A link was ended for both players. |
| `friends: ... (N Slayer Link invite(s) between them cancelled)` | An unfriend or a block also cancelled waiting invites. |

**Parties and the session check**

| Line | Meaning |
|:-----|:--------|
| `party: accept by <A> id=<id>: already in P=<party> size=<n>; answering that party (a repeated accept)` | The game sent the same accept twice; it got the party again. |
| `GET /account/api/oauth/verify with a bad or expired token: answering the static reply` | A game's regular session check with an expired token, at most once a minute. Expected for sessions older than 24 hours. If players get logged out or loop on reconnect, set `VERIFY_STUB_ACCOUNT=1`. |

---

## Login doesn't get past the title screen

Read the metagame log from the moment you launched:

- **No `POST /account/api/oauth/token` at all.** The client isn't reaching the metagame. Check that:
  - with "Show the log window" on, a client console window appeared (if not, the DLLs are missing from `Win64` or aren't loading);
  - the first launch argument is `127.0.0.1:61000`;
  - the metagame is listening (`curl.exe -s -m 5 http://127.0.0.1:61000/dauntless-status`).
- **`Invalid API key auth!`** The key passed as `-AUTH_PASSWORD` doesn't match any account. Check
  `C:\dr\data\owner.key` and make sure you are using the right database file (`DB_FILENAME`). The
  server stores only a hash of each key, so a lost key can't be recovered; a key re-issue tool is on
  the roadmap.
- **Login works, but nothing loads after matchmaking.** Look for `gs=1` lines. If there are none, the
  game server isn't reaching the metagame:
  - `Game.ini` is missing or wrong (run the step 8 health check), or
  - the game-server key wasn't registered (the metagame must have logged
    `Registered 1 new Gameserver API Key(s) on boot!` once), or
  - `METAGAME_API_KEY` in the deploy server's `.env` differs from `gameserver.key`.

---

## Chat says "Unable to send message", or nothing arrives {#chat-not-connected}

Chat is the metagame's own listener, off unless `CHAT=1`
([Text chat]({{ chat_page.url | relative_url }}), [Configuration]({{ config_page.url | relative_url }}#metagame-chat)).
In the metagame log, one connection looks like this:

```text
chat: listening on 127.0.0.1:61099 (nick check enforce)        at startup
chat: connect c=3 from=203.0.113.7 via=gateway
chat: login ok c=3 uid=UID-...
chat: bound c=3 uid=UID-... resource=V2:...:WIN::... domain=prod.ol.epicgames.com sessions=1
chat: join room=City-... uid=UID-... name=<username> occupants=0
chat: message room=City-... uid=UID-... len=5 to=1
```

- **No `chat: listening` line:** chat is off (`CHAT` is not `1`) or did not start; see
  [The chat listener does not start](#chat-not-started). On a kit server `Stack.ps1 status` shows a
  `chat` line.
- **No `chat: connect` line:** the game never reached the listener. In public mode the gateway log has
  a `ws` route for it; a 502 there means the metagame is not listening. On one PC, check that
  `Engine.ini` points the chat at `ws://127.0.0.1:61099` ([Ports and network]({{ ports_page.url | relative_url }}#chat-port)).
- **`chat: login refused ... reason=...`:** `expired` means the player's 24-hour session ran out
  (restart the game); `uid-mismatch`, `bad-token` and `no-account` mean the login does not belong to a
  live account; `throttled` means the account or address is held back for a while after repeated
  failures, a replaced or abusive connection, or logins that never bound (it clears by itself in 60 s,
  or 10 minutes for an address). The game retries every 15-45 s. Why a connection ended is in
  [its `closed` line](#chat-closed).
- `MUC: JoinPublicRoom failed. Not currently connected` in the game's console only means the chat
  connection was not logged in at that moment; the game joins again once it is. It has nothing to do
  with names.

Changing matchmaking settings does not fix a chat problem, and 61099 must stay on loopback: never open
it in the firewall.

### Names show as `UID-...` or "[unknown]" {#chat-uid-names}

The server runs a chat version from before usernames were fixed (the first prototype of pull request
#9). Update the server. With the current version the game shows usernames: it reads them from the
room nickname it joined with, and the server keeps that nickname unchanged. Why the old one showed
`UID-...`: [Text chat]({{ chat_page.url | relative_url }}#why-uid).

If one player's lines turned to `[unknown]` for the others right after that player's game reconnected,
the server predates the reconnect fix: the old connection stayed in the room and its later leave
removed the player from the others' member list. Update the server; until then the player leaves the
room and joins it again (for party chat: leave and rejoin the party). With the current version the
log shows `chat: leave room=... reason=replaced` just before the new connection's join
([why]({{ chat_page.url | relative_url }}#rooms)).

### "Another operation already pending" {#chat-operation-pending}

The game waits for its own room presence to finish a join or a leave, and refuses a new join to that
room until then. The current server always sends it, or refuses the join outright, which the game
handles cleanly. If you see this with the current version, turn on `CHAT_TRACE=1`, restart when
nobody plays, reproduce it once, and keep the `chat: trace` lines for the room (they hold no message
text or tokens). Then turn the trace off again.

### `chat: join refused ... reason=...` {#chat-join-refused}

| Reason | Meaning | What to do |
|:-------|:--------|:-----------|
| `not-member` | A `Party-` or `Guild-` room of a party or guild the player is not in. After a metagame restart parties are gone, so the game's first rejoin of its old party room is refused; it moves to its new party at the next party poll. | Nothing, unless it repeats for a player who is really in that party. |
| `not-allowed` | A room name the game never builds, or another domain. | Nothing: not a real client. |
| `nick-name` | The name part of the nickname is not the account's username. Right after an admin renamed a player, the game still uses the old name. | The player restarts the game. |
| `nick-resource`, `nick-format` | The nickname does not carry the player's own resource, or holds characters the game never writes. | A real client should never get these. If one does, set `CHAT_NICK_CHECK=log` in `metagame.env`, restart when nobody plays, and report the line. |
| `nick-account` | The nickname does not carry the player's own account id, or carries another account's. | A real client never gets this: it builds the nickname from its own id. It is refused with `CHAT_NICK_CHECK=log` too. |
| `conflict` | A connection of another account holds that nickname. | Should never happen: a nickname carries its own account id, and a new connection of the same account takes the room over from the old one. |
| `limit` | Too many rooms, players in a room or joins in a short time. | Nothing, unless it repeats. |

A refusal is logged at most once per connection, room kind (`City-` and `Hunt-`, `General`, `Party-`,
`Guild-`, anything else) and reason every 10 minutes, with the room name cut to 80 characters. Every
refusal counts toward the drop limit, so a client that keeps sending refused joins is disconnected.

### `chat: closed ... reason=...` {#chat-closed}

| Reason | Meaning | Next login waits 60 s |
|:-------|:--------|:----------------------|
| `close` | The game logged out (quit, or its own reconnect). | no |
| `socket` | The connection dropped. | no |
| `ping-timeout` | No answer to a ping for 100 s (or 10 s for an older connection after the same account connected again: a leftover). | no |
| `replaced` | A newer connection of the same account took its place. | yes, when it had bound |
| `timeout` | No login within 15 s, or no bind within 10 s of the login. | after three missed binds in 10 minutes |
| `refused` | A refused login, or too many frames before login. | no (failed logins count toward the address limit) |
| `size` | A frame over 32 KiB. | yes |
| `backlog` | The game stopped reading: 256 KiB waited unsent. | yes |
| `abuse` | More than 100 dropped stanzas or refused joins in a minute. | yes |
| `shutdown` | The metagame stopped. | no |

### `name=InvalidMCPUser` in the join line {#chat-invalid-mcp-user}

The game's own account read at login failed, so its name is the fallback `InvalidMCPUser`. Other
players still see the real username (they look it up), but the "entered room" notice may show the
fallback. Look for `EOS Account Info for <id> by <id>: found` at that player's login; if it is missing
or says `unknown`, the game did not get its own account data. Restarting the game usually fixes it.

### Whispers never show {#chat-whispers}

A whisper is shown once the game has looked up the sender's name with
`GET /account/api/public/account?accountId=...`; the metagame logs
`Account info for 1 account(s) by userId ...`. The chat line
`chat: whisper from=... to=... ... reason=offline` means the other player was not connected to chat,
and `reason=blocked` that one of the two blocked the other. Nothing is sent back to the sender in
either case.

### Ramsgate chat only reaches your party {#chat-ramsgate-party-only}

Expected for now. Each player gets a Ramsgate session of their own, and the Normal channel is per
session, so two players share it only when they travelled to Ramsgate together as a party. Use party
chat meanwhile. A shared Ramsgate channel is on the roadmap (3.10).

### Friends' online status (`chat: presence`) {#chat-presence}

Only with `CHAT=1` and `CHAT_PRESENCE=1` ([how it works]({{ chat_page.url | relative_url }}#presence)).

| Line | Meaning |
|:-----|:--------|
| `chat: friends' online status off: no presence is sent outside rooms` | Explicitly disabled: remove `CHAT_PRESENCE=0` or set it to `1`, then restart the metagame. |
| `chat: friends' online status on (CHAT_PRESENCE=1): ...` | On. |
| `chat: CHAT_PRESENCE is on but chat is off (CHAT=1 is needed); nobody shows as online` | Set `CHAT=1` too, or remove `CHAT_PRESENCE`. |
| `chat: presence c=<id> uid=<account> online: told N friend session(s), heard of M` | A player's game sent its first presence; N friends were told, and the player heard of M. |
| `chat: presence c=<id> uid=<account> offline (<reason>): told N friend session(s)` | The player went offline (`close`, `socket`, `ping-timeout`, `replaced`, `unavailable`, ...). `; c=<id> is still online` means another session of the same account is still there. |
| `chat: presence: <A> and <B> are friends now: told N and M session(s)` | An accepted friend request was pushed over chat. |
| `chat: presence: could not read the friends of <account>; nothing relayed` | A database read failed; that player's presence was not relayed this time. |
| `chat: presence: refused to send c=<id> a stanza from its own account` (error) | **Must never appear.** The server stopped a stanza that could wake the party's automatic kick. Turn `CHAT_PRESENCE` off, restart the metagame, and report the line with the time. |

If a player is kicked from a party while presence is on (a `DELETE /party/member/...` right after the
player went offline for the others), turn `CHAT_PRESENCE` off and report it.

### The chat listener does not start {#chat-not-started}

The metagame logs one error line and keeps running without chat:

- `chat: not started: could not listen on 127.0.0.1:61099 (EADDRINUSE)`: another program holds the
  port. Find it with `Get-NetTCPConnection -LocalPort 61099 -State Listen` and stop it.
- `chat: not started: CHAT_BIND_HOST must be 127.0.0.1 in public mode`: fix `CHAT_BIND_HOST` (the kit
  always writes `127.0.0.1`).
- `chat: EXPERIMENTAL_CHAT is no longer read; the switch is now CHAT=1` (a warning): rename the line.

---

## Switching between 2.1.1 and 1.4.4

Both builds use `%LOCALAPPDATA%\Archon\Saved\Config\WindowsClient`. Settings left over from one build
apply to the other. Examples are a `GameDefaultMap` override from 2.1.1 experiments, or 1.4.4's
endpoint overrides in `Game.ini`. We keep the inactive build's folder renamed (`WindowsClient.211`)
and swap before switching; see [Host a server, step 6]({{ host_page.url | relative_url }}#config-folder).
Never copy the 1.4.4 DLLs into a 2.1.1 install: their addresses are for the 1.4.4 exe only.

---

## Not hit yet, but known from the code

These come from reading the code (plus, for the first one, a small test), not from something that
went wrong for us.

- **A leftover hand-started game server.** Servers the deploy server starts end together with it:
  it uses Node's default (not detached) `spawn`, and on Windows Node puts such children in a job
  object that closes when Node exits. We confirmed that with a test process, not with a game server.
  A server started by hand (the manual command in step 11, or our test script) is outside that job
  and keeps running. A deploy server started afterwards immediately launches a new Ramsgate on UDP
  8777, which the old one still holds. Before starting the deploy server, stop any process whose
  command line contains `-server` (checklist step 2 in
  [Host a server]({{ host_page.url | relative_url }}#checklist)).
- **A hunt server that quits before a slow player arrives.** Below port 8776, the server DLL exits
  once the server has had nobody connected for a total of 50 seconds. A player whose map load takes
  longer could arrive to find it gone. A configurable idle timeout is on the
  [roadmap]({{ roadmap_page.url | relative_url }}).
- **Saves failing in very long sessions.** Login tokens expire after 24 hours. Game-server saves
  carry the player's token, and the metagame's check has no error handling for an expired one, so
  after 24 hours those saves fail with a server error. Until this is fixed, quit the game at least
  once a day. Whether the client ever refreshes its token is still untested.
- **Running out of hunt ports.** With the default range, six hunts can run at once. A seventh
  request fails inside the deploy server (`Matchmaking for ... failed: No free ports left!`, an HTTP
  500 `{"error": "no_game_server"}` to the metagame). The metagame logs `DeployServer returned status
  500` and marks that group's search as failed: the game's status poll answers `FAILED`. (Upstream's metagame handed the group an empty host and port 0
  instead.) Keeping the group waiting until a port is free is on the roadmap together with the memory
  guard.
