---
title: Files and data
parent: Reference
nav_order: 4
description: "Where Dauntless Revived keeps its files: the repository, a host's folders, the server kit's install root, the SQLite database, logs, backups and the launcher."
lang: en
ref: reference/files
---

{% assign config_page = site.pages | where: "path", "reference/configuration.md" | first %}
{% assign ports_page = site.pages | where: "path", "reference/ports.md" | first %}
{% assign api_page = site.pages | where: "path", "reference/api.md" | first %}
{% assign gamesettings_page = site.pages | where: "path", "reference/game-settings.md" | first %}
{% assign scripts_page = site.pages | where: "path", "reference/scripts.md" | first %}
{% assign dev_page = site.pages | where: "path", "reference/development.md" | first %}
{% assign host_page = site.pages | where: "path", "setup/host.md" | first %}
{% assign admin_page = site.pages | where: "path", "setup/admin.md" | first %}
{% assign winserver_page = site.pages | where: "path", "setup/windows-server.md" | first %}
{% assign friends_page = site.pages | where: "path", "setup/friends.md" | first %}
{% assign upgrade_page = site.pages | where: "path", "setup/upgrading.md" | first %}
{% assign trouble_page = site.pages | where: "path", "setup/troubleshooting.md" | first %}

# Files and data
{: .no_toc }

Where every file of Dauntless Revived lives: the repository and what builds where, a developer's or
hand-built host's folders, the Windows server kit's install root with who may read and write each
folder, the SQLite database table by table, the log files and their formats, backups, and what the
launcher keeps on a friend's PC.

What goes *into* the settings files is on [Configuration]({{ config_page.url | relative_url }}); the
scripts that create and use these files are on [Scripts and parameters]({{ scripts_page.url | relative_url }}).

<details open markdown="block">
  <summary>Contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

## Files that hold secrets

Every file in this table is **secret: never share it, never commit it, and never paste its contents
into an issue, a chat or a screenshot.** Keep copies only in encrypted backups (or, for a player's
own key, a password manager). The repository's `.gitignore` already keeps `.env` files, `*.key`,
`*.db` (with `-wal` and `-shm`) and the root `data/` folder out of git.

| File | Where | What makes it secret |
|:-----|:------|:---------------------|
| Metagame settings | `UndauntedMetagame\.env` (developer or hand-built host); `C:\DauntlessRevived\data\config\metagame.env` (server kit) | The token-signing private key: whoever has it can sign in as any account. In public mode also the gateway secret. |
| Deploy server settings | `UndauntedDeployServer\.env`; kit: `data\config\deployserver.env` | The game-server key. |
| Gateway and allowlist settings | `UndauntedGateway\.env` (developer); kit: `data\config\gateway.env`, `data\config\allowlist.env` | The gateway secret and the allowlist secret. |
| `owner.key` | `C:\dr\data\owner.key` (hand-built host); kit: `data\keys\owner.key` | The admin account's key. It is the password of an account that can create invites and use every admin route. |
| `gameserver.key` | `C:\dr\data\gameserver.key`; kit: `data\keys\gameserver.key` | The key game servers use to write saves, progression and rewards. |
| `gateway-key.pem` | kit: `data\tls\gateway-key.pem` (public mode) | The private key of the gateway certificate that every invite pins. |
| Deploy SSH key | `C:\dr\data\ssh\dauntless_deploy` (the default of `Deploy-Remote.ps1`) | Administrator access over SSH to your rented server. |
| Re-key output | `C:\dr\data\rekey-<UserId>.txt` | A player's new account key in plain text. Delete it once you have handed it over. |
| Backups | kit: `C:\DauntlessRevived\backups\`; hand-built host: wherever you keep them | They contain all of the above plus the database. |
| Launcher key files | friend's PC: `%APPDATA%\Dauntless Revived Launcher\keys\*.key` | A player's account key, encrypted for that Windows user. |
| Key backup and friend-kit key | friend's PC: the saved `Dauntless Revived key - <username>.txt`; the friend kit's `%APPDATA%\DauntlessRevived\account.key` | A player's account key in plain text. |

Private, but not secret in the same way: the database (usernames, saves, SHA-256 hashes of keys, and
for a short time plain keys, see [Accounts and keys](#accounts-and-keys)), `bodies.log`, and every log
file (account ids, usernames and, in public mode, players' IP addresses). The kit's `server.json`
holds no secrets, but it records the addresses you allowed for Remote Desktop, so do not post it
either.

## The repository

The repository is a fork of [Undaunted](https://github.com/SyST3MDeV/Undaunted); the working branch is
`dauntless-revived`. The component folders keep upstream's `Undaunted...` names; the npm packages in
them are named `dauntless-revived-*` (for example `dauntless-revived-metagame`).

| Folder | What it holds | Build output (git-ignored) |
|:-------|:--------------|:---------------------------|
| `UndauntedMetagame/` | The backend the game talks to (TypeScript, Express): accounts, saves, progression, matchmaking, parties, friends, guilds, the `/undaunted/api` admin API and the game's text chat (`src/realtime/`, an XMPP listener in the same process, on when `CHAT=1`). `src/db/schema.ts` defines the database, `src/drizzle/` holds its migrations, `src/vendor/` the game's `progression_config.json`, the generated `hunt_titles.json`, and the data from Harmonic's 1.4.4 fork: `escalation/seasons.json` (the Escalation season registry), `store_catalog.json` (the free store's offers) and `store_item_kinds.json` (how each store item is granted). `test/data/store_art_skus.json` lists the store SKU ids with a 2:1 tile image, for a test. The build copies `src/vendor/` to `dist/vendor/`. `scripts/` has `write-build-info.js` and `make-hunt-titles.js`. | `dist/` (with `dist/build-info.json`), `build/` (tests), `node_modules/` |
| `UndauntedDeployServer/` | Starts and supervises the game-server processes (Ramsgate, the Training Dojo, hunts). `src/vendor/` holds the hunt tables. | `dist/`, `build/` |
| `UndauntedGateway/` | Public mode only: the TLS gateway (`dist/server.js`) and the allowlist helper (`dist/allowlist/server.js`). `tools/make-cert.js` makes the gateway certificate. | `dist/`, `build/` |
| `UndauntedContent/` | The content server: game files, news and the art pack for registered launchers. `data/dauntless-1.4.4.json` is the game manifest (410 files) that the launcher also compiles in. | `dist/`, `build/` |
| `UndauntedLauncher/` | This fork's friend launcher (Electron). `assets/` holds the two pinned prebuilt DLLs, `dxgi.dll` and `UndauntedInternalServer.dll`, which every setup installs (host, server kit, friend kit and launcher), and the icons (copies from `brand/launcher/`). `src/renderer/brand/` holds copies of the logo and emblem images the window shows. `scripts/` holds the test runner, the brand image copier (`make-icon.mjs`) and `collect-release.ps1`. | `.vite/` (`npm start`), `out/` (`npm run package` and `npm run make`), `.test-build/` (tests), `release/` (the release files that `scripts/collect-release.ps1` collects after `npm run make`: the installer, the Squirrel update files, the zip and `SHA256SUMS.txt`). |
| `UndauntedInternalServer/` | The C++ source of the server DLL: a Visual Studio solution, `dllmain.cpp` (with the endpoint table that `Game.ini` is generated from), the `SDK/` engine headers and `MinHook/`. No script or workflow in this repository builds it; everyone runs the prebuilt DLLs from `UndauntedLauncher/assets/`. Since the MinHook include fix (September 2026) it compiles with the Visual Studio 2022 Build Tools (Release, x64), but no DLL built here is shipped. | Visual Studio output (`x64/`, `*.dll` and the like) |
| `deploy/windows-server/` | The Windows server kit: the scripts, `lib/` (Node helpers `dr-db.js`, `dr-keys.js`, `verify-game.js`) and `tests/`. | none |
| `friend-kit/` | The Tailscale-only setup and play scripts for invited friends. | `tools/make-friend-kit.ps1` builds the zip outside the repository |
| `tools/` | `build-llms.js`, `sync-roadmap.js`, `make-friend-kit.ps1`, `make-game-manifest.js`, and in `ci/` what CI uses: `check-repo.js` (the repository check) and `launcher-version.js` (the launcher version rules). | none |
| `docs/` | This site (GitHub Pages, Jekyll). `docs/fi/` holds the Finnish pages, `docs/_data/faq_en.yml` and `faq_fi.yml` the FAQ entries. | none |
| `.github/` | Issue and pull request templates, the social images, `dependabot.yml`, and the workflows `workflows/ci.yml` and `workflows/launcher-release.yml`. | none |

At the root: `README.md` and `README.fi.md`, `ROADMAP.md` (the live checklist), `CONTRIBUTING.md`,
`SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE.txt` (AGPL-3.0), `.gitignore` and `.gitattributes`. The
kit's `*.ps1`, `*.vbs` and `*.md` files and the friend kit's `*.ps1` and `*.cmd` files always get CRLF
line endings, in every checkout and in a `git archive` (which is what `Deploy-Remote.ps1` uploads).

`git pull` does not rebuild anything: after pulling, run `npm run build` in each package you run. How
to build and test each package is on [Developer guide]({{ dev_page.url | relative_url }}).

### Generated files

These files are committed, but made by a tool. Do not edit them by hand; change the source and run
the tool again.

| File | Made by | From | Run it again when |
|:-----|:--------|:-----|:------------------|
| `docs/roadmap.md` | `node tools/sync-roadmap.js` | `ROADMAP.md` | you change `ROADMAP.md`. The Finnish `docs/fi/roadmap.md` is a hand-written summary, not generated. |
| `docs/llms.txt`, `docs/llms-full.txt` | `node tools/build-llms.js` (after `sync-roadmap.js`) | The front matter and text of the docs pages, and `docs/_data/faq_*.yml` | you add a page, change a title or description, or change the text of an English page (`llms-full.txt` holds every English page in full). |
| `UndauntedMetagame/src/vendor/hunt_titles.json` | `node scripts/make-hunt-titles.js`, in `UndauntedMetagame` | The deploy server's `player_hunts_table.json` and `matchmaker_hunts_table.json` | the deploy server's hunt tables change. |
| `UndauntedContent/data/dauntless-1.4.4.json` | `node tools/make-game-manifest.js --zip <BaseGame144.zip>` | The verified game zip | practically never: the build is pinned. If it changes, rebuild the launcher, which compiles the same file in. |
| `UndauntedMetagame/src/drizzle/*.sql` and `meta/` | `npm run db:generate`, in `UndauntedMetagame` | `src/db/schema.ts` | you change the schema. Commit the new migration with the schema change. |

`UndauntedMetagame/dist/build-info.json` is also generated (by `npm run build`: the commit, with
`-dirty` if `UndauntedMetagame` has uncommitted changes, the version and the build time), but it is
not committed.

## A developer or hand-built host

The setup guides use short paths under `C:\dr`, and this layout. Nothing forces these paths: they are
what the guides and a few script defaults use.

| Path | What it is |
|:-----|:-----------|
| `C:\dr\undaunted\` | The repository checkout ([Host a server, step 4]({{ host_page.url | relative_url }}#fork)). The settings are in `UndauntedMetagame\.env` and `UndauntedDeployServer\.env`, both git-ignored. **Secret: never share, never commit.** Start each server from its own package folder: the metagame finds its migrations through the relative path `./src/drizzle`. |
| `C:\dr\data\` | Runtime data, outside the repository: `undaunted.db` (`DB_FILENAME=C:/dr/data/undaunted.db`), `owner.key` and `gameserver.key` (**secret: never share, never commit**), the logs `metagame.log`, `metagame.err`, `deploy.log` and `deploy.err`, and the pid files `metagame.pid`, `deploy.pid` and `client.pid`. The logs are replaced at every start, because the guide starts the servers with `Start-Process -RedirectStandardOutput`. |
| `C:\dr\data\rekey-<UserId>.txt` | A new account key made by the re-key script in [Run it for a group]({{ admin_page.url | relative_url }}). **Secret**: hand it over privately, then delete it. |
| `C:\dr\data\ssh\` | `dauntless_deploy` (the SSH key for a rented server) and `known_hosts`, the defaults of `Deploy-Remote.ps1`. **The key is secret: never share, never commit.** |
| `C:\dr\backups\` | Database copies from the live backup script in [Run it for a group]({{ admin_page.url | relative_url }}#back-up-the-database) (`undaunted-YYYYMMDDHHMM.db`). |
| `C:\dr\tools\` | The host's own helper scripts that the guides show in full but that are not in the repository: `make-gameini.ps1`, `play.ps1`, and on our host `stack.ps1`. |
| `C:\D144\Dauntless\` | The verified 1.4.4 game, with the two DLLs in `Archon\Binaries\Win64\` ([Host a server, step 3]({{ host_page.url | relative_url }}#short-install-path)). |
| `C:\dr\dist\` | Default output folder of `tools\make-friend-kit.ps1`. |
| `C:\dr\sandbox-ws2019\` | Default folder of the kit's `Test-Sandbox.ps1`. |
| `%LOCALAPPDATA%\Archon\Saved\Config\WindowsClient\` | The game's user config for this Windows user: `Engine.ini`, `Game.ini` and `GameUserSettings.ini`. See [Game settings]({{ gamesettings_page.url | relative_url }}). |

With `LOG_BODIES=1` and no `BODY_LOG_FILE`, the metagame writes `bodies.log` into its working
directory, which is `C:\dr\undaunted\UndauntedMetagame`. **No `.gitignore` rule covers that file.** Set
`BODY_LOG_FILE=C:/dr/data/bodies.log`, or delete the file before you commit. The metagame's unit tests
use a fresh database in a temporary `undaunted-test-*` folder per test file and delete it afterwards.

The gateway and the allowlist helper, run from a checkout (`npm start`, `npm run start:allowlist`),
both read `UndauntedGateway\.env`, which holds the gateway and allowlist secrets (**secret: never share,
never commit**; it is git-ignored). Without `ALLOWLIST_AUDIT_LOG` and `ALLOWLIST_STATE_FILE` the helper
writes `allowlist-audit.log` and `allowlist-state.json` into its working directory; the gateway's
`.gitignore` covers both. The content server's `UndauntedContent\.env` holds no secrets.

## Windows server kit: `C:\DauntlessRevived` {#kit-install-root}

The kit installs everything under one root, `C:\DauntlessRevived` unless `-InstallRoot` says
otherwise. The installed scripts in `<root>\bin` find the root by themselves (the folder above `bin`
when it holds `data\config\server.json`); from anywhere else they use `C:\DauntlessRevived` or `-Root`.
How to install, update and uninstall is on [Windows server kit]({{ winserver_page.url | relative_url }}).

### Who may read and write what

The installer replaces the permissions of the whole tree: **Administrators and SYSTEM have full
control, the low-privilege service account `dauntless` gets what the table says, and no other account
(not even the local Users group) has any access.** The service account runs the stack and the hourly
backup; the allowlist helper runs as SYSTEM. The service account can read the code and scripts it runs
but cannot change them, so a compromised game server cannot change what an administrator runs next.

| Path | What it holds | `dauntless` may | Written by |
|:-----|:--------------|:----------------|:-----------|
| `C:\DauntlessRevived\` | The root. Everything below inherits its permissions unless listed. | read | the installer |
| `bin\` | A copy of the kit: `*.ps1`, `*.vbs`, `*.md` and `lib\*.js`. The scheduled tasks run `Stack.ps1` and `backup-hidden.vbs` from here. | read | the installer; `Update-DauntlessServer.ps1` refreshes it from the new code |
| `app\` | The built server code: the repository without `.git`, `node_modules`, build output, `.env` files, keys, certificates, databases, logs and the DLL's engine headers and MinHook, then `npm ci` and `npm run build` in UndauntedMetagame, UndauntedDeployServer, UndauntedContent and UndauntedGateway. `app\VERSION.json` records the commit, ref, source, source URL and install time. Each component runs with its package folder as working directory. | read | the installer and the updater |
| `app.new\` | A build in progress. After a failed update step it keeps the new build. | read | the installer and the updater |
| `app.prev\` | The previous build, for `Update-DauntlessServer.ps1 -Rollback`. | read | the installer and the updater |
| `app.failed\` | A build that failed the updater's health check and was rolled back automatically. | read | the updater |
| `app.rolledback\` | The build you left with a manual `-Rollback`. | read | the updater |
| `game\Dauntless\` | The verified 1.4.4 game, with the two pinned DLLs in `Archon\Binaries\Win64\`. The deploy server starts the game servers from it; the content server serves it to launchers. While the zip is unpacked, the files go to `<root>\game.partial\`, which is renamed to `game\` when it is done. With `-GameDir` the game stays in your folder, which keeps its own permissions plus read access for `dauntless`. | read | the installer |
| `data\` | Everything that changes while the server runs (below). | modify | |
| `data\config\` | [`server.json`](#server-json) (the kit's own state; no secrets), the `.env` files `metagame.env`, `deployserver.env` and `content.env`, in public mode also `gateway.env` and `allowlist.env`, and `news.json`, the launcher news, created as an empty list if missing and never overwritten. **The `.env` files except `content.env` hold secrets: never share, never commit.** | read (each file too) | the installer; the updater changes only the commit fields and `GIT_COMMIT`; `New-Invite.ps1 -SaveShareUrl` stores a Tailscale share link |
| `data\config\allowlist.env` | The allowlist helper's settings, with the allowlist secret. | no access | the installer |
| `data\keys\` | `owner.key` (the admin account's key) and `gameserver.key`, plus any other `*.key` restored from a backup. `signing.tmp` and `tailscale-authkey.tmp` exist only while an install step runs; if an install is killed there, delete them. **Secret: never share, never commit.** | read | the installer |
| `data\tls\` | Public mode: `gateway-cert.pem` and `gateway-key.pem` (the key is **secret: never share, never commit**). `*.new` files exist only while a new certificate is made. | read | the installer |
| `data\undaunted.db` | [The database](#the-database). | modify | the metagame |
| `data\logs\` | The component logs, `supervisor.log`, `bodies.log`, the backup's database log, `install\` (see [Logs](#logs)) and `performance\`, the [performance log](#performance-log). | modify | `Stack.ps1` (the performance log too), the backup, the installer |
| `data\run\` | `<component>.pid` for the metagame, content server, deploy server and gateway, and `stopped.flag`. While `stopped.flag` exists (set by `Stack.ps1 stop`, removed by `start` and `restart`), the stack supervisor restarts nothing. | modify | `Stack.ps1` |
| `data\branding\` | The art pack the content server hands to launchers: images and an optional `branding.json` (see [News and art pack](#news-and-art-pack)). Empty after an install. | modify | you |
| `data\allowlist\` | Public mode: the allowlist helper's `audit.log`, `state.json` (the addresses currently let in), `allowlist.pid`, its logs and its supervisor's `supervisor.log`. | read | the allowlist helper (SYSTEM) |
| `data\sandbox-profile\` | Only with `-Sandbox`: stands in for the service account's profile. | | the installer |
| `backups\` | One folder per backup and `backup.log` (see [Backups](#backups)). **Secret: never share, never commit.** | modify | the backup script |
| `downloads\` | What the installer downloaded: the Node.js MSI, the VC++ and DirectX runtimes (with `dxredist\`), the Tailscale MSI in private mode, source zips from GitHub (`source-<commit>.zip`, unpacked into `source-<12 hex>\`), an uploaded source zip unpacked into `source-upload\`, and, with `-GameZipUrl`, `BaseGame144.zip` (`.partial` while downloading). | read | the installer and the updater |
| `staging\` | What `Deploy-Remote.ps1` uploads: `kit\` (the kit it runs from), `source\source-<12 hex>.zip` (the server code), `upload\` (the resumable game-zip upload: `upload.json`, `partNNNNN` files with their `.ok` marks, removed as they are joined, and the finished `BaseGame144.zip` with its `.ok`, which stays for repairs). | read | `Deploy-Remote.ps1`, over SSH as an administrator |
| `staging\restore\` | A backup uploaded for `-RestoreFrom`. The uploaded copy is deleted after a successful install. **Holds keys while it is there.** | no access | `Deploy-Remote.ps1` |

A `-Sandbox` install gives the sandbox user full control everywhere, so the test can delete it all.

### `server.json` {#server-json}

`data\config\server.json` is the kit's own state: JSON, UTF-8 without a byte order mark. The installer
writes it in full on every run, carrying over `InstalledAt`, `FirewallChanges`, `ServiceUser`,
`PerformanceLog` and the Tailscale share link; the updater changes only `Commit`, `Ref`, `Source` and `UpdatedAt`, and
`New-Invite.ps1 -SaveShareUrl` only `TailscaleShareUrl`. The other scripts read it, and a missing or
empty value means "use the coded default". It holds no secrets, but
`AdminIp` holds your own address. The settings of the components themselves are in the `.env` files; see
[Configuration]({{ config_page.url | relative_url }}).

| Key | What it holds | Read by |
|:----|:--------------|:--------|
| `Version` | `2`. | nothing yet |
| `Mode` | `Public` or `Private`. An install from before public mode, with no `Mode`, counts as `Private`. | `Stack.ps1`, `New-Invite.ps1`, the updater, `Get-ServerStatus.ps1`, `Deploy-Remote.ps1`, installer re-runs |
| `ServerName` | The name in invites and in the status output. | `New-Invite.ps1`, `Stack.ps1`, `Deploy-Remote.ps1` |
| `Sandbox` | `true` for a `-Sandbox` test install. | `Stack.ps1`, `Update-DauntlessServer.ps1`, `New-Invite.ps1` |
| `BindAddress` | Where the metagame and content server listen: `127.0.0.1` in public mode, the Tailscale IPv4 address in private mode. | `Stack.ps1`, `New-Invite.ps1`, the updater, `Get-ServerStatus.ps1` |
| `PublicHost` | Public mode: the address in invites. Empty in private mode. | `New-Invite.ps1`, `Stack.ps1` (status), `Deploy-Remote.ps1`, installer re-runs |
| `PublicIp` | Public mode: the IPv4 address of `PublicHost`. Empty in private mode. | nothing (for your information) |
| `GatewayBind` | The gateway's listen address: `0.0.0.0` (`127.0.0.1` in a sandbox). Empty in private mode. | `Stack.ps1` |
| `CertFingerprint` | The SHA-256 of the gateway certificate, 64 hex characters. It is in every invite, so it is public. | `New-Invite.ps1`, `Stack.ps1`, the updater, `Get-ServerStatus.ps1` |
| `AdminIp` | The addresses allowed to use Remote Desktop. | installer re-runs |
| `AdvertiseHost`, `TailscaleShareUrl` | Private mode: the host name in invites, and the share link that v1 invites carry. | `New-Invite.ps1`; `AdvertiseHost` also installer re-runs |
| `MagicDnsName` | Private mode: the server's Tailscale DNS name. Invites use it only if you put it in `AdvertiseHost` (or pass `-AdvertiseHost`). | nothing (for your information) |
| `Ports` | The TCP ports of the metagame, deploy server, content server, gateway and allowlist helper. After the first install this is where the ports come from; see [Ports and network]({{ ports_page.url | relative_url }}). | `Stack.ps1`, `New-Invite.ps1`, the updater, `Get-ServerStatus.ps1`, `Deploy-Remote.ps1`, installer re-runs |
| `UdpPortBegin`, `UdpPortEnd` | The game servers' UDP range, always 8770-8777. `Stack.ps1` expects Ramsgate on `UdpPortEnd` and the Dojo one port below. | `Stack.ps1` (`UdpPortEnd` only; nothing reads `UdpPortBegin`) |
| `Components` | The components this install runs: `allowlist` and `gateway` in public mode, `metagame`, `content` if it was built, `deploy` except in a sandbox. Missing: metagame, content and deploy. | `Stack.ps1`, the updater |
| `AllowlistDryRun` | `true`: the allowlist helper only logs the firewall changes it would make. | `Stack.ps1` |
| `GameDir` | The game folder, the one that holds `Archon\`. | `Stack.ps1`, the updater, installer re-runs |
| `NodePath` | The `node.exe` that runs everything. | `Stack.ps1`, the updater, the backup |
| `ServiceUser` | The service account (`dauntless`; empty in a sandbox). | `Stack.ps1`, the installer |
| `ServiceProfile` | The service account's profile folder, under which its `Game.ini` and `Engine.ini` are. | nothing (for your information) |
| `InteractiveSession` | Whether `-InteractiveSession` was used. | `Stack.ps1`, for a hint |
| `PerformanceLog` | `true` (the default, also when missing): the stack supervisor writes the [performance log](#performance-log) every minute. `false` turns it off after the next `Stack.ps1 restart`. Installer re-runs keep your value. | `Stack.ps1` |
| `StackTask`, `AllowlistTask`, `BackupTask` | The names of the scheduled tasks (`AllowlistTask` is empty in private mode). | `Stack.ps1` |
| `Source`, `Ref`, `Commit`, `SourceUrl` | Where the running code came from. | the updater, `Stack.ps1`, `Deploy-Remote.ps1` |
| `FirewallChanges` | Each system firewall change the installer made, with the old value, so you can undo it by hand when you uninstall. | the installer |
| `Root`, `InstalledAt`, `UpdatedAt` | The install root and two timestamps, for your information. | nothing |

### News and art pack

The content server hands both to the launcher and rereads them while it runs, so no restart is
needed. It serves them without an account key (only the game files need one), so treat both as
public: in public mode anyone on the internet can read them through the gateway. On a kit server they
live in `data\config\news.json` and `data\branding\`; elsewhere, wherever `CONTENT_NEWS_FILE` and
`CONTENT_BRANDING_DIR` point ([Configuration]({{ config_page.url | relative_url }}#content-server)).

- **News** (`news.json`, checked for changes at most every 5 seconds): `{ "items": [ { "date":
  "2026-09-21", "title": "...", "body": "..." } ] }`, or just the list. Every item needs a date and a
  title; the body is plain text and keeps its line breaks. Items are served newest first, only the
  newest 50; titles are cut at 200 characters and bodies at 10,000, and a file over 1 MB is not read.
  If an edit breaks the file, the last good version is served and a warning is logged.
- **Art pack** (the folder, rescanned at most every 10 seconds): `.jpg`, `.jpeg`, `.png` or `.webp`
  images whose first bytes match the extension (a name starts with a letter or digit, then letters,
  digits, `_`, `-` and dots, at most 100 characters; at most 25 MB each), and optionally
  `branding.json`: `{ "accent": "#c8a24a", "backgrounds": [ { "file": "harbour-dusk.jpg", "credit":
  "..." }, "second-image.webp" ] }`. Without `backgrounds`, every image in the folder is used in name
  order. The server offers at most 50 images; the launcher shows the first 8, of up to 15 MiB each,
  and uses the accent colour only in the six-digit `#rrggbb` form. The repository ships no art pack:
  without one, the launcher shows its own background, a night scene drawn in the style of the logo.

Outside the root, the kit also writes:

- the service account's game config, `Game.ini` and `Engine.ini` in
  `<profile of dauntless>\AppData\Local\Archon\Saved\Config\WindowsClient\` (the profile path is
  `ServiceProfile` in `server.json`); see [Game settings]({{ gamesettings_page.url | relative_url }});
- Node.js (pinned MSI) in its default folder, recorded as `NodePath` in `server.json`;
- the scheduled tasks, firewall rules and a few system settings, listed on
  [Scripts and parameters]({{ scripts_page.url | relative_url }}) and
  [Ports and network]({{ ports_page.url | relative_url }}).

## The database

Everything durable is in one SQLite file, the metagame's `DB_FILENAME`:

| Setup | File |
|:------|:-----|
| Hand-built host (the guides) | `C:\dr\data\undaunted.db`, set as `DB_FILENAME=C:/dr/data/undaunted.db` |
| Windows server kit | `C:\DauntlessRevived\data\undaunted.db` |
| `DB_FILENAME` unset or empty | A temporary database that is **deleted when the metagame exits**: every account and save is lost. |
| A relative path | Resolved against the metagame's working directory. The folder must exist. |

The file uses SQLite's default rollback journal, so a stopped metagame leaves one self-contained
`undaunted.db` (an `undaunted.db-journal` appears only during a write). With `DB_WAL=1` it uses WAL
mode instead, and recent writes can sit in `undaunted.db-wal` next to it; a copy of the stopped file
alone then misses them. A file left in WAL mode is switched back at the next start without
`DB_WAL=1`. [Configuration]({{ config_page.url | relative_url }}) explains both settings.

### Migrations

The metagame applies every pending migration from `src/drizzle/` at each start, before it answers
anything. The path is relative to its working directory, so start it from the `UndauntedMetagame`
folder (the kit does). All pending migrations run in one transaction: if one fails, none is applied
and the metagame does not start. drizzle records what it applied in its own table,
`__drizzle_migrations`; never edit it, because drizzle decides from it which migrations still have to
run. **The metagame takes no backup before migrating.** The kit backs up before every start and every
update; on a hand-built host, back up before you pull new code.

| Migration | What it does |
|:----------|:-------------|
| `0000_natural_korg` | Creates `users`, `characters` and `inventories`. |
| `0001_slow_storm` | Creates `loadouts`. |
| `0002_gorgeous_saracen` | Creates `gameserverapikeys` and `gameserverapikeystoregister`. |
| `0003_slippery_blackheart` | Creates `breadcrumbs`. |
| `0004_silky_lady_mastermind` | Adds `loadouts.persistent`. |
| `0005_mighty_zeigeist` | Creates `encounteredcontent`. |
| `0006_woozy_slipstream` | Creates `userapikeys` and `userapikeystoregister`. |
| `0007_last_maximus` | Creates `invitecodes`. |
| `0008_vengeful_spirit` | Adds `users.isAdmin`. |
| `0009_nice_dazzler` | Rebuilds `users` with the same columns. |
| `0010_save_history_and_item_log` | Creates `characterhistory`, `loadouthistory`, `inventorytransactions`, and `inventorylog` with its append-only triggers. |
| `0011_real_progression` | Creates `progress_tracks`, `objectives`, `huntpassselection`, `entitlements`, `cooldowns`, `bounties`, `bountydraft`, `loadoutslots`, and `progression_events` with its append-only triggers. |
| `0012_friends_and_blocks` | Creates `friendships` and `blocks`. |
| `0013_guilds` | Creates `guilds`, `guildmembers` and `guildinvites`. Adds tables only. |
| `0014_escalation` | Creates `escalationprogression`, `escalationtalents` and `escalationunlocks`. Adds tables only. |
| `0015_store_purchases` | Creates `storepurchases` and its index on `accountId`. Adds tables only. |
| `0016_slayer_links` | Creates `slayerlinkinvites` and `slayerlinks` with their indexes. Adds tables only. |

Migrations 0014 to 0016 came with the port of Harmonic's fork. None of them changes, copies or converts
an existing table; the build before them still starts on a migrated database and ignores the new
tables ([Upgrading]({{ upgrade_page.url | relative_url }}#harmonic-port)).

To add a migration, change `src/db/schema.ts` and run `npm run db:generate`; see
[Developer guide]({{ dev_page.url | relative_url }}).

### Accounts and keys

| Table | What it stores |
|:------|:---------------|
| `users` | One row per account: `userId` (`UID-` and a UUID), `name` (the username), `notes` (the account's Notes currency balance, 0 at registration, what `/balance` reports) and `isAdmin`. New usernames are 3-16 letters, digits or `_`, and unique regardless of case; the metagame checks that, there is no unique index. Only `lib/dr-db.js make-admin` or a manual SQL update sets `isAdmin`. |
| `userapikeys` | One account key per user, stored as its SHA-256 hash. The key itself (`UUK_` and 48 hex characters) is shown once, at registration, and never stored. |
| `userapikeystoregister` | A queue of **plain** account keys: at the next start the metagame hashes them into `userapikeys` and deletes the queue. Use it only for an account that has no key yet; to replace a lost key, follow [Run it for a group]({{ admin_page.url | relative_url }}). |
| `gameserverapikeys` | SHA-256 hashes of game-server keys. |
| `gameserverapikeystoregister` | A queue of **plain** game-server keys, hashed into `gameserverapikeys` at the next start and then deleted. The manual setup in [Host a server]({{ host_page.url | relative_url }}#metagame) uses it; the kit writes the hash directly with `lib/dr-db.js gs-key`. |
| `invitecodes` | Invite codes: the code, uses remaining, and whether it has unlimited uses. A use is spent only after the username has been accepted. |

Until the next start, the two queue tables hold keys in plain text: restart the metagame right after
you add one.

### Saves

Each account has one character, created at its first login and named after the username. All save
data is stored as JSON text, exactly as the game sends it.

| Table | What it stores |
|:------|:---------------|
| `characters` | Per character: owner, created and modified dates, name, `updateVersion` (a save that is not newer than the stored version is refused) and `data`, the game's save blob. |
| `inventories` | Per character: the instanced items and the stacked items, as two JSON arrays. |
| `loadouts` | Per character: the loadouts and the `persistent` block, as the game sends them. |
| `breadcrumbs` | Per character: the "new" markers, with their own `updateVersion`. |
| `encounteredcontent` | Per character: what the character has already seen, by content type (the "seen" markers). |

### Save protection and history

| Table | What it stores | Kept |
|:------|:---------------|:-----|
| `inventorytransactions` | The stored answer to every applied inventory transaction, keyed by character, transaction id and a hash of the request, so a retried request gets the same answer instead of running twice. | 30 days; older rows are deleted whenever a new transaction is stored. |
| `inventorylog` | **Append-only**: every item change, with time, account, character, transaction, who called, operation, item, change and quantity after. Triggers refuse `UPDATE` and `DELETE`. | Forever. |
| `characterhistory` | Earlier versions of each character's save blob, with the reason they were saved. The admin routes `SaveHistory` and `RollbackCharacter` use them ([HTTP API]({{ api_page.url | relative_url }})). | Pruned at every save: the newest `SAVE_HISTORY_KEEP` versions (100), then the last version of each hour for `SAVE_HISTORY_HOURLY` hours (48) and of each day for `SAVE_HISTORY_DAILY` days (30). The code estimates this at about 3.5 MB per character at the defaults. |
| `loadouthistory` | The same for loadouts (`RollbackLoadout`), with a version counter per character. | As `characterhistory`. |

### Progression

Real progression is the default: every account reads and writes these tables. With
`PROGRESSION_MODE=stub`, only the accounts in `PROGRESSION_REAL_ACCOUNTS` do; everyone else gets
upstream's fixed answers (level 50 and maximum ranks) and nothing is stored for them. Nothing is
migrated between the two: an account that played in stub mode has no rows here and starts at Slayer
level 1. When real progression is on for every account and such accounts exist (players who have a
character but no stored track and no progression event), the metagame logs a warning with their
number at startup. The [Upgrade notes]({{ upgrade_page.url | relative_url }}) explain the choices.

| Table | What it stores |
|:------|:---------------|
| `progress_tracks` | Per account and track (Slayer level, behemoth and weapon mastery, the Hunt Pass): the total XP and the free and premium (Elite) ranks already confirmed. The earned ranks are worked out from `progression_config.json`, as the game does. No row means 0. |
| `objectives` | Per account: each mastery objective's progress and completed count, as the game server last sent them. |
| `huntpassselection` | Per account: the selected Hunt Pass. No row means `ACTIVE_HUNT_PASS` (default `season09b`). |
| `entitlements` | Per account: entitlements such as the Elite Hunt Pass, with activation date, duration in hours (0 = permanent), source (`default`, `gameserver`, `admin:<id>`, `store:<sku>` for a store purchase or `confirm:<track>:<rank>` with `PROGRESSION_CONFIRM_ENTITLEMENTS=1`) and revoked date. The defaults (`ENTITLEMENTS_DEFAULT`) are added once per account; a revoked row is kept, so a revoked default is not handed out again. |
| `cooldowns` | Per account: the start time of each daily or weekly limit, as the game server sent it. Harvest cooldowns older than 24 hours are removed the next time the game server starts a single cooldown for that account. |
| `bounties`, `bountydraft` | Per account: each bounty's JSON with its slot, and the current bounty draft. |
| `loadoutslots` | Per character: unlocked character loadout slots (at most 5) and the active combined slot. Together with the one account slot, the client sees at most 6 slots. No row means one character slot and active slot 0. |
| `progression_events` | **Append-only** audit of every write the game server, a player's game or an admin makes to the tables above and to the Escalation tables, refused ones included (the default entitlements are added without an entry): time, account, caller (`gameserver`, `client` or `admin`), route, the raw request body, status, reply and a note (for example `retry of event <id> within 10 s: its reply, nothing added`, or an Escalation save's `season <id>`). Triggers refuse `UPDATE` and `DELETE`. Kept forever. |

The admin routes `Progression`, `SeedProgression`, `GrantEntitlement` and `RevokeEntitlement` read
and change these tables; see [HTTP API]({{ api_page.url | relative_url }}).

### Escalation and store tables {#escalation-and-store-tables}

Added with migrations `0014_escalation` and `0015_store_purchases`. Dates are ISO text.

| Table | What it stores |
|:------|:---------------|
| `escalationprogression` | Only with `ESCALATION_MODE=real`: per account and season, the Escalation level, the XP towards the next level, the last saved `updateVersion`, a hash of the saved content (to recognise a retry) and when it was saved. No row means level 0, version 0. [Escalation]({{ '/findings/escalation.html' | relative_url }}). |
| `escalationtalents` | Per account, season and talent: the rank. Replaced as a whole by each save (a talent reset lowers ranks). |
| `escalationunlocks` | Per account, season and reward: when it was collected. A collected reward is never removed. |
| `storepurchases` | Only with `STORE=free`: one row per purchase token. The SHA-256 of the token (the token itself is never stored), the account, the character the purchase goes to, the SKU, a hash of the offer when the token was issued, the created and expiry dates (10 minutes) and the redeemed date. Unredeemed rows past their expiry are deleted at every start, at most once an hour after that, and for the account whenever it gets a token; redeemed rows are kept as receipts for 30 days. The limit of 60 tokens per account in 10 minutes is counted from this table. The items and entitlements a purchase grants are in `inventories` and `entitlements`, logged in `inventorylog` (caller `store`) and `inventorytransactions`. [The in-game store]({{ '/findings/store.html' | relative_url }}). |

### Friends

| Table | What it stores |
|:------|:---------------|
| `friendships` | One row per pair of accounts (the two ids sorted), who sent the request, `PENDING` or `ACCEPTED`, and the times in milliseconds. At most 200 per account. |
| `blocks` | Who blocked whom, and when. A block removes the friendship and the pending party and guild invites between the two, and stops friend requests, party invites and guild invites both ways. At most 200 per account. |

### Guilds

| Table | What it stores |
|:------|:---------------|
| `guilds` | One row per guild: `guildId` (a random UUID), `name`, `nameplate` (the tag, may be empty), lower-case copies `nameKey` and `nameplateKey` with unique indexes (so names and tags are unique regardless of case; an empty tag is stored as NULL there), `leaderId`, and the times in milliseconds. |
| `guildmembers` | One row per member, keyed by account (one guild per account): `guildId`, `rank` (`Leader`, `Officer` or `Member`) and the times. The leader's row always matches `guilds.leaderId`. |
| `guildinvites` | Open invites: `inviteId` (a random UUID, the id the client accepts or declines), `guildId`, the invited and the inviting account, and when it was made and expires. One per guild and invited player. Expired rows are ignored and deleted at most once a minute. A block deletes the rows between the two players, and an Officer's rows go when the Officer is demoted to Member, kicked or leaves; rows between blocked players or from someone who may no longer invite are ignored and deleted when accepted. |

A disband deletes the guild's rows in all three tables. The admin routes `Guilds` and `DisbandGuild`
list and remove guilds; see [HTTP API]({{ api_page.url | relative_url }}#guilds).

### Slayer Links {#slayer-links}

Added with migration `0016_slayer_links`. Times are in milliseconds, as in the friends tables.

| Table | What it stores |
|:------|:---------------|
| `slayerlinkinvites` | One row per invite: `inviteId` (the `link_id` the client sees), sender, invited player, the sender's slot (1 to 3, the client's numbers), created and expiry times, and `status` (`PENDING`, `ACCEPTED`, `DECLINED`, `CANCELED` or `EXPIRED`). At most one pending invite per pair (a partial unique index). An unfriend or a block sets the pending ones between the two to `CANCELED`. |
| `slayerlinks` | One row per running link (both players share it): `linkId` (the accepted invite's id), the two players, each one's slot (1 to 3), and when it began and ends (168 hours later). A removal deletes the row for both. |

Declined, cancelled and expired invites are deleted once their 24 hours are over, accepted invites and
ended links 30 days later, when the next new invite is made. The invite limit (20 new invites per
player in 10 minutes) is counted from this table.
[Friends, parties and guilds]({{ '/findings/social.html' | relative_url }}#slayer-links) explains
the rules.

### Kept only in memory

These are **lost when the metagame restarts**:

- matchmaking queues and results (who waits for which hunt, and where to connect);
- parties, party invites and party searches;
- the friend-request rate window, guild name validations (15 minutes, the last five per player), the
  guild creation and invite rate windows, the 24-hour pause on re-inviting a player who declined a
  guild's invite, and the party invite limits (20 per sender in 10 minutes, the 2-minute pause after a
  decline);
- who is online and where (a player counts as online for 90 seconds after their game's last heartbeat);
- a registration mode changed through `POST /undaunted/api/RegistrationStatus`: after a restart the
  `REGISTRATION_MODE` from the settings file applies again;
- short caches (the server status, the build info).

Logins survive a restart: session tokens are signed and valid for 24 hours, and the server keeps no
list of them. They stop working only if the signing keys change.

### Growth

The database is small at first, but the save history grows with every character up to its retention
limit, and `inventorylog` and `progression_events` only grow. Nothing prunes the append-only tables;
keep an eye on the file size on a long-running server.

## Logs

No component deletes logs by age, except the kit's performance log (30 days). Keys and session tokens are kept out of every log: the metagame
logs only the path of each request (tokens in paths become `<token>` or `<redacted>`), never headers
or query strings (`bodies.log`, when it is on, also records the query string and body, with tokens
removed), and the launcher replaces keys with `<hidden>`. Logs do contain account ids,
usernames and, in public mode, players' IP addresses, so read a log before you share it.

### Formats

| Written by | Format |
|:-----------|:-------|
| Metagame, deploy server | pino. With `NODE_ENV=production` (always on the kit), one JSON object per line: `level` (30 info, 40 warn, 50 error, 60 fatal), `time` (milliseconds since 1970), `pid`, `hostname`, `msg`. Every level goes to standard output. Without `production`, readable coloured lines. The metagame's request lines read `METHOD /path gs=0` (a player) or `gs=1` (a game server), plus ` via=gateway ip=<player address>` behind the gateway. `LOG_LEVEL` and `LOG_REQUESTS` are on [Configuration]({{ config_page.url | relative_url }}). |
| Gateway, allowlist helper, content server | One JSON object per line: `t` (ISO time), `level` (`debug`, `info`, `warn` or `error`), `msg` and extra fields. Warnings and errors go to standard error, the rest to standard output. The gateway's `request` lines are its access log; the fields are in the [gateway README]({{ site.github.repository_url }}/blob/dauntless-revived/UndauntedGateway/README.md#access-log). |
| Game servers, game client | No log file. A game server prints only to its own console window (Ramsgate and the Training Dojo keep theirs visible; the deploy server starts hunt servers with the window hidden). The client writes crash reports only, to `%LOCALAPPDATA%\Archon\Saved\Crashes\` (see [Troubleshooting]({{ trouble_page.url | relative_url }})). |
| Launcher | Text lines: ISO time, `INFO`, `WARN` or `ERROR`, message. |

### Windows server kit

| File | What it is | Rotation |
|:-----|:-----------|:---------|
| `data\logs\metagame.out.log`, `metagame.err.log` | The metagame's standard output and error. The `.err.log` gets only what Node prints itself, such as a crash's stack trace. | At every start of the component, `Stack.ps1` moves the non-empty files to `data\logs\old\metagame.<yyyyMMdd-HHmmss>.out.log` (or `.err.log`) and keeps the newest 40 of those files (both kinds together). |
| `data\logs\deploy.*.log`, `content.*.log`, `gateway.*.log` | The same for the deploy server, the content server and the gateway. `gateway.out.log` is the access log. | As the metagame's. |
| `data\allowlist\allowlist.out.log`, `allowlist.err.log` | The allowlist helper's output. | As the metagame's, into `data\allowlist\old\`. |
| `data\allowlist\audit.log` | The allowlist helper's audit, one JSON object per line (`t`, `event` and fields): addresses let in and expired, refusals, firewall rule changes, the exact script in dry-run mode, failed secrets. Never the secret itself. | Never rotated. |
| `data\logs\supervisor.log` | A PowerShell transcript of the stack supervisor: starts, crashes, restarts, give-ups. | Moved to `supervisor.log.1` when a supervisor starts and the file is over 5 MB. |
| `data\allowlist\supervisor.log` | The same for the allowlist helper's supervisor (SYSTEM). | As above. |
| `data\logs\bodies.log` | Only with `LOG_BODIES=1`: one JSON object per line, `t` (arrival), `method`, `url`, `gs`, `body`, `status` and `ms` (plus `"aborted": true` when the connection closed first), written once the answer is done, for a fixed list of routes (progression, Hunt Pass, bounties, cooldowns, Escalation, entitlements, loadout unlocks, the store (`/product`, `/token`, `/notification`), balance and `/reconcile`, Slayer Links, inventory, matchmaking candidates, parties, friends and account lookups), bodies cut at 8 KB (64 KB for inventory), tokens and account keys removed, at most `BODY_LOG_PER_PATH` lines per path when that is set. The kit forces `LOG_BODIES=0` in public mode. Private: it records what players' games send. | Never rotated. |
| `data\logs\backup-db.out.log`, `backup-db.err.log` | The database copy of the latest backup (`db ok, <n> users`). | Overwritten by each backup. |
| `data\logs\install\<step>.out.log`, `.err.log` | The output of each installer and updater step: source copy, `npm ci` and `npm run build` per package, the Node.js, runtime and Tailscale installs, game extraction and check, certificate, keys, owner account. | Overwritten when the step runs again. |
| `backups\backup.log` | One line per backup: time, folder, size, the database check and how many backups are kept. | Moved to `backup.log.1` when over 5 MB. |
| `data\logs\performance\performance-<yyyy-MM-dd>.csv` | The [performance log](#performance-log): one sample a minute from the stack supervisor, and any `Write-PerformanceLog.ps1` run. Counts only. | A new file every UTC day; files older than 30 days are deleted. |

### Performance log

Roadmap 4.12, started from Vvoidddd's first sampler
([#6](https://github.com/mixutin/dauntless-revived/pull/6)). CSV with a header line, ASCII, CRLF
line ends, a decimal point in every number (whatever the Windows language), times in UTC as
`yyyy-MM-ddTHH:mm:ssZ`. A sample is one `host` row and one row per process, all with the same
`timestamp_utc`. A cell that does not apply to the row, or could not be read, is empty. **Counts
only:** no player names, account ids, keys or command lines. It still shows when the server is
busy, so keep it private. How the numbers are taken:
[Write-PerformanceLog.ps1]({{ scripts_page.url | relative_url }}#write-performancelogps1).

| Column | Rows | What it holds |
|:-------|:-----|:--------------|
| `timestamp_utc` | all | When the sample was taken. |
| `role` | all | `host`; a component: `metagame`, `content`, `gateway`, `deploy`, `allowlist` (the supervisor, which runs as the service account, cannot see the allowlist helper, which runs as SYSTEM); or a game server: `ramsgate`, `dojo`, `hunt`, `tutorial`, or `unknown` while it has no UDP port yet. |
| `pid` | processes | The process id. |
| `udp_port` | game servers | Its UDP port. |
| `started_utc` | processes | When the process started. |
| `players` | game servers | The players the metagame places on it (heartbeats of the last 90 seconds). Empty when the metagame did not answer with the owner key. |
| `cpu_core_percent` | processes | CPU time since the previous sample, as a percentage of one core: 100 is one busy core. Empty in the first sample of a run and for a new process. |
| `working_set_mb`, `private_mb` | processes | Working set and private (committed) memory, in MB. |
| `host_cpu_percent` | host | The whole machine's CPU since the previous sample, 0-100. |
| `logical_cpus` | host | Logical processors; `host_cpu_percent` times this, divided by 100, is the busy cores. |
| `ram_total_mb`, `ram_free_mb` | host | Physical memory, in MB. |
| `disk_free_gb` | host | Free space on the drive of the install root, in GB. |
| `net_in_kbit_s`, `net_out_kbit_s` | host | Traffic on the network adapters since the previous sample, in kilobits per second (loopback, VPN tunnels and virtual switches left out). |
| `game_servers` | host | How many game servers of this install run. |
| `players_online` | host | The metagame's count of players online. Empty without the owner key, never a false 0. |

### Hand-built host and launcher

- `C:\dr\data\metagame.log` and `metagame.err`, `deploy.log` and `deploy.err`: the guide's
  `Start-Process` redirection, a new file at every start. [Troubleshooting]({{ trouble_page.url | relative_url }})
  shows how to read them as plain text.
- `npm start` or `npm run dev` in a terminal: the output stays in the terminal.
- The launcher: `%APPDATA%\Dauntless Revived Launcher\logs\launcher.log`, renamed to
  `launcher.old.log` when it passes 2 MiB (one old file is kept).

## Backups

### Windows server kit

`Backup-DauntlessServer.ps1` makes one folder per backup, `backups\yyyy-MM-dd_HHmmss\`. The folder
names sort in time order. **A backup contains every secret of the server: never share it, never commit
it, and copy it off the server only encrypted.**

| In the backup folder | What it is |
|:---------------------|:-----------|
| `undaunted.db` | The database, copied with SQLite's online backup (safe while the metagame runs) and then checked with `integrity_check`. If the check fails, the folder is deleted and the backup fails. |
| `server.json` | The kit's state. |
| `news.json` | The launcher news. |
| `secrets\metagame.env`, `deployserver.env`, `content.env`, `gateway.env` | The settings, with the token-signing keys, the game-server key and the gateway's secrets. |
| `secrets\*.key` | Every key file in `data\keys` (`owner.key`, `gameserver.key`). |
| `secrets\tls\gateway-cert.pem`, `gateway-key.pem` | The gateway certificate and key. Restoring them keeps the fingerprint, so invites already handed out keep working. |

Not in a backup: `allowlist.env` (only Administrators and SYSTEM can read it, and an install makes a
new one), `data\allowlist\`, the logs, **the art pack in `data\branding\`** (keep your own copy), the
game files, the built code, and the service account's `Game.ini` and `Engine.ini` (the installer
writes them again).

**When.** Every hour (the "Dauntless Revived backup" task, as the service account, from 00:05); before
the metagame starts (`Stack.ps1` refuses to start it without a backup unless you pass `-NoBackup`; a
supervised restart skips it if the newest backup is less than 10 minutes old); after a stop; before an
update switches builds; and once at the end of an install.

**Retention.** Each run keeps the newest 48 backups (hourly ones and the ones around starts and stops
together) plus the newest backup of each of the 30 most recent days that have one, and deletes the
rest. `Backup-DauntlessServer.ps1 -Hourly <n> -Daily <n>` uses other numbers for that one run; the
scheduled task always uses the defaults.

**Restore.** `Install-DauntlessServer.ps1 -RestoreFrom <backup folder>` (or `Deploy-Remote.ps1
-RestoreFrom` from your PC). The folder must hold `undaunted.db`, `secrets\metagame.env` and
`secrets\deployserver.env`. An existing `data\undaunted.db` is not overwritten (delete it first), and
key files that already exist are kept. The same command accepts the backups of our original host's
`backup.ps1`, which use the same layout. See [Windows server kit]({{ winserver_page.url | relative_url }}#backups).

### Hand-built host

[Run it for a group]({{ admin_page.url | relative_url }}#back-up-the-database) has two ways to back up
the database: a copy of the stopped file, or a live backup script. Also back up, encrypted and never
in git, the two `.env` files, `owner.key` and `gameserver.key`: losing the signing keys logs everyone
out, and losing an account key locks that player out.

## On a friend's PC

### The launcher

The launcher keeps its data in Electron's per-user folder, which is named after the product:
`%APPDATA%\Dauntless Revived Launcher\`. Nothing there is meant to be edited by hand.

| Path | What it is |
|:-----|:-----------|
| `settings.json` | The joined server (mode, host, port, name, and the Tailscale share link or the certificate fingerprint; the invite code until it has been used), the install folder, the last fully checked game folder, the graphics preset, the auto exposure choice (`exposure`: `game` or `basic`), windowed mode, the language, the game language (`gameLanguage`: `auto` or a culture such as `es-ES`), whether to show the game's log window (`showConsole`), streamer mode (`streamerMode`), and per server the username and whether the key backup was offered. Written atomically through `settings.json.tmp`; invalid fields fall back to defaults when it is read. No account key. |
| `keys\<server id>.key` | The account key for one server. **Secret: never share, never copy it anywhere.** It is encrypted with Windows DPAPI, so only the same Windows user on the same PC can read it. Inside: the format tag `DRK2`, the certificate fingerprint the key belongs to (public servers) and the key. The server id is the first 24 hex characters of the SHA-256 of `host:port` (private mode) or `public:host:port` (public mode). "Log out" deletes the file. |
| `logs\launcher.log`, `launcher.old.log` | The launcher log (see [Logs](#logs)): startup, joins, connection problems, downloads, the game's command line with the key hidden. It holds server addresses and your username. |
| `verified-files.json` | Size and modification time of the game files already hashed, so an interrupted install does not hash them again. Repair ignores it. Safe to delete. |
| `art-cache\<sha256>` | Background images from the server's art pack, named by their hash and downloaded again each session. Safe to delete. |

Elsewhere on the PC:

| Path | What it is |
|:-----|:-----------|
| `%LOCALAPPDATA%\DauntlessRevived\Game\` | The default game folder: 410 files, about 10.9 GB, plus the two DLLs in `Archon\Binaries\Win64\`. "Change folder…" picks another one (an absolute path of at most 150 characters). A folder that already holds the game (the game root with `Archon\`, its parent `BaseGame144` with a `Dauntless` folder, or `Archon` or `Archon\Binaries\Win64` inside the game) is used as that game, and refused when that game's root is longer than 150 characters; any other folder that is not empty gets a `DauntlessRevived` subfolder. "I already have the game files" takes a pasted drive-letter path or a browsed folder, recognises the same layouts, refuses network (`\\host\share`), device and relative paths before looking at them, allows a game root of at most 150 characters, and then checks every file (Repair). While downloading, a file is `<name>.part`; a DLL being copied is `<name>.new`. |
| `Dauntless Revived key - <username>.txt` | The key backup you save from Settings, in the folder you pick (Documents by default). Without a known username the name is `Dauntless Revived key.txt`. **Plain-text secret: anyone who has it can play as you. Never share it; keep it in a password manager or on a USB stick.** |
| `%LOCALAPPDATA%\Archon\Saved\Config\WindowsClient\` | `Engine.ini`, whose two managed sections the launcher rewrites before every PLAY, and `GameUserSettings.ini`, whose `sg.*Quality` lines it sets only when you force a graphics level. Both are written through a temporary `.dr-tmp` file. See [Game settings]({{ gamesettings_page.url | relative_url }}). |
| `%LOCALAPPDATA%\DauntlessRevivedLauncher\` | The launcher program, where the Squirrel installer normally puts it (the portable zip runs from wherever you unpack it). The two pinned DLLs ship in its `resources` folder. |

### The friend kit

The older, Tailscale-only friend kit ([Join as a friend]({{ friends_page.url | relative_url }})) uses
a different folder from the launcher:

| Path | What it is |
|:-----|:-----------|
| `%APPDATA%\DauntlessRevived\account.key` | The account key in plain text, written by `setup.ps1` and passed to the game by `play.ps1`. **Secret: never share it; back it up yourself.** |
| `%APPDATA%\DauntlessRevived\settings.json` | The host address and the game folder, so `play.ps1` needs no arguments. No secrets. |
| The game folder (`-Game`, default `C:\D144\Dauntless`) | `setup.ps1` copies the two checked DLLs into `Archon\Binaries\Win64\`. |
| `%LOCALAPPDATA%\Archon\Saved\Config\WindowsClient\` | `play.ps1` rewrites the same `Engine.ini` sections as the launcher and, with `-Graphics`, the graphics lines of `GameUserSettings.ini`. |

Saved servers: `savedServers` remembers up to 20 joined servers in launcher settings; removing a saved server does not delete its account key.
