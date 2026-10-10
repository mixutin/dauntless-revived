---
title: Join as a friend
parent: Setup
nav_order: 2
description: "How an invited friend joins a Dauntless Revived server: Tailscale, a hash-checked Dauntless 1.4.4 install, the two DLLs, an invite code and the friend kit."
lang: en
ref: setup/friends
---

{% assign admin_page = site.pages | where: "path", "setup/admin.md" | first %}
{% assign linux_page = site.pages | where: "path", "setup/linux.md" | first %}
{% assign legal_page = site.pages | where: "path", "legal.md" | first %}
{% assign trouble_page = site.pages | where: "path", "setup/troubleshooting.md" | first %}

# Join as a friend
{: .no_toc }

This page is for someone the host has invited. You play with **your own copy of the Dauntless 1.4.4
client** (October 2020, UE4) against the host's server. You do not need an Epic account, hosts-file
edits or certificates. All traffic goes over a private Tailscale connection to the host's PC.

**Public-mode servers use the launcher, not this page.** If the host sent you a
`dauntless-revived://join?...` line (a public server on a rented machine), you do not need Tailscale or
the manual steps below. On Windows install `DauntlessRevivedLauncher-Setup.exe`; on Linux follow the
[Linux launcher]({{ linux_page.url | relative_url }}) guide for your distro. Then paste the invite
line and the launcher does the rest. If you already have an account key, choose **"I already have an
account key"** and import/paste it instead of registering. Keep the launcher open while you play. The
rest of this page is the manual Windows/Tailscale path.

**If you already have the game.** On the install screen, choose **"I already have the game files"**
and paste the path of your 1.4.4 folder (for example `C:\Games\BaseGame144`, or the `Dauntless`
folder inside it), or browse to it. The launcher finds the game there and uses it in place: it checks
every file against its pinned manifest, replaces any file that differs from 1.4.4, and puts its own
`dxgi.dll` and `UndauntedInternalServer.dll` in `Archon\Binaries\Win64`. Missing or different files
are downloaded from your host, so that works only if your host has switched on game downloads. If
another setup (for example the friend kit below) still uses that folder, copy it first. Vvoidddd
added the pasted path ([#8](https://github.com/mixutin/dauntless-revived/pull/8)).

**If Windows blocks the installer.** The launcher is not code-signed yet, so Windows SmartScreen warns
the first time: **More info > Run anyway**. On a PC set to block unrecognised apps, SmartScreen blocks
it outright and there is no Run anyway. Then:

1. Download `SHA256SUMS.txt` from the same release and check the installer against it. In PowerShell,
   in the folder you downloaded to, `Get-FileHash .\DauntlessRevivedLauncher-Setup.exe` must print
   the same SHA-256 as the file's line in `SHA256SUMS.txt` (PowerShell prints it in capital letters
   and the file has small ones; that difference does not matter). If it does not, delete the file and
   do not run it.
2. Unblock the file: right-click it > **Properties** > tick **Unblock** > **OK**, or run
   `Unblock-File .\DauntlessRevivedLauncher-Setup.exe` in PowerShell.
3. Run it again.

Everything on this page is about **build 1.4.4**. The final client, 2.1.1 ("Awakening", UE5), does not
work here: `UndauntedInternalServer.dll` hooks fixed addresses inside the 1.4.4 executable, so it only
works with that exact build. That is also why every step below checks a hash.

**Status (22 September 2026).** Our server for friends runs in public mode on a rented machine. On 22
September 2026 the owner played there over the internet with the launcher, from the invite and the
game download to the first hunt. Later that night a second player joined: the two saw each other in
Ramsgate and hunted together. The manual Tailscale path on this page has not been used by a friend
yet (see [Run it for a group]({{ admin_page.url | relative_url }})).

**The short way: the friend kit.** The host can give you a small zip, built from the repository's
[`friend-kit/`]({{ site.github.repository_url }}/tree/dauntless-revived/friend-kit) folder. After step 1,
double-click `Setup.cmd`: it does steps 2 to 4 for you, checking every hash. After that,
`Play Dauntless.cmd` does step 5 on every launch. The manual steps below show exactly what the kit does.

<details open markdown="block">
  <summary>Contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

## What you need

| Item | Details |
|:-----|:--------|
| A Windows PC | 64-bit Windows 10 or 11. The game takes about 10.9 GB (10.1 GiB) on disk. |
| Your own Dauntless 1.4.4 install | The Shipping build `dauntless_rel-1.4.4_Shipping_2020-10-28_20-11-15_239827`, checked by hash in step 2. |
| Tailscale | A free account of your own, plus the host's shared PC accepted. |
| The two DLLs | `dxgi.dll` and `UndauntedInternalServer.dll`, checked by hash in step 3. |
| Microsoft Visual C++ 2015-2022 Redistributable (x64) | `UndauntedInternalServer.dll` needs `MSVCP140.dll` and `VCRUNTIME140_1.dll`. Many PCs already have it. |
| An invite code | From the host. Codes are usually single use. |
| A launch script | Given in step 5. |

**This site and the repository do not distribute the game or link to downloads of it.** Whatever
copy you use, step 2 checks it. If yours came as the `BaseGame144.zip` archive that the upstream
Undaunted launcher installs from, step 2 also lists the archive's hash. See
[Credits and license]({{ legal_page.url | relative_url }}) for why we handle it this way.

## Step 1: Install Tailscale and accept the host's share

The host's server has no public address. It is reachable only through Tailscale, and only by people the
host has shared that one PC with. [Run it for a group]({{ admin_page.url | relative_url }}) explains why.

1. Install Tailscale for Windows from [tailscale.com/download](https://tailscale.com/download) and sign
   in with your own account.
2. Open the share invite from the host (a link or an email) and accept it. The host's PC then appears
   in your Tailscale machine list. You do not join the host's network. You only see that one machine.
3. Note the host's address. `tailscale status` lists it with an address of the form `100.x.y.z`. It
   should match the address the host gave you.
4. Test the connection in PowerShell:

```powershell
$Server = "100.x.y.z"   # the host's Tailscale address
tailscale ping $Server
Invoke-RestMethod "http://${Server}:61000/undaunted/api/RegistrationStatus"
```

`tailscale ping` should answer with a `pong`. If the reply says `via DERP(...)`, your traffic is going
through a Tailscale relay. That works, with extra latency. The second command should print
`RegistrationMode : INVITECODE`. If it times out, Tailscale is off, the share is not accepted yet, or
the host's server is not running.

## Step 2: Verify your game files

Point `$Game` at your install folder, the one that contains `Archon`, `Engine` and `EasyAntiCheat`:

```powershell
$Game = "C:\D144\Dauntless"
Get-Content "$Game\Version.txt"
(Get-FileHash "$Game\Archon\Binaries\Win64\Dauntless-Win64-Shipping.exe" -Algorithm SHA256).Hash
```

| What | Expected |
|:-----|:---------|
| `Version.txt` | `dauntless_rel-1.4.4_Shipping_2020-10-28_20-11-15_239827` |
| `Dauntless-Win64-Shipping.exe` SHA-256 | `D3D41E614908D2BEFD518B27046D9822D6130EF12BA3504BABBDB786BEF9CFF4` |
| `Dauntless-Win64-Shipping.exe` size | 103,673,520 bytes |
| `BaseGame144.zip` SHA-256, if you have the archive | `556B9A648A5E5E7E11B6F8DD3D80FF8E88FCEB0D3448297AAF47CE7BF756BC6D` (10.48 GB) |

The executable hash is the same value the upstream Undaunted launcher checks. If it does not match,
stop here: the DLLs will not work with a different build.

On the host we checked our reference copy more thoroughly. All 406 files match the `Manifest.bin.json`
that Phoenix Labs shipped inside the install, all 39 signed binaries still have intact Authenticode
digests, and a malware scan came back clean. The Findings section has the details. The executable
hash is enough for you.

## Step 3: Copy the two DLLs

Both files go into `<game folder>\Archon\Binaries\Win64\`, next to `Dauntless-Win64-Shipping.exe`.

| File | Size | SHA-256 |
|:-----|-----:|:--------|
| `dxgi.dll` | 11,264 bytes | `9A431D7B6FD20C43FA92BEBD91C3BC023EC7A3FCBC52871C41F4DF293D4B0D1F` |
| `UndauntedInternalServer.dll` | 123,392 bytes | `520EC588A0554E374B2B0D084CD7F7F08D59A9CB80362679845719D64A0D0933` |

You get them from the host, most easily in the friend kit (see above), or from the upstream
repository under
[`UndauntedLauncher/assets/`](https://github.com/SyST3MDeV/Undaunted/tree/main/UndauntedLauncher/assets).
They are the same files. After copying, check them and clear the "downloaded from the internet" flag:

```powershell
$W = "$Game\Archon\Binaries\Win64"
Get-FileHash "$W\dxgi.dll", "$W\UndauntedInternalServer.dll" -Algorithm SHA256 | Format-Table Hash, Path
Unblock-File "$W\dxgi.dll", "$W\UndauntedInternalServer.dll"
```

**What they do.** When the game starts, Windows loads `dxgi.dll` from the game folder before the
system copy. This proxy loads the real system `dxgi.dll`, forwards its three exports, and loads
`UndauntedInternalServer.dll`. In a normal (client) launch, that DLL reads the first command-line
argument as the server address. It then rewrites the backend endpoints the game reads from its
config (a table of 167 keys, plus the account-service settings), from the dead `steelyard.ca` hosts
to `http://<that address>/...`. When the same DLL is loaded into a process started with `-server`,
it turns that instance of the client into a game server instead. That is how the host
runs Ramsgate and hunts.

**What we can and cannot vouch for:**

- These are upstream's prebuilt binaries. We pin their hashes. We have not yet rebuilt
  `UndauntedInternalServer.dll` from source to prove it matches the published code. The version strings
  match (0.0.3), but that is not proof.
- The source of `dxgi.dll` was never published. We disassembled it: it does only the three things
  described above and imports nothing beyond `KERNEL32` and the C runtime. We plan to replace it with
  our own small proxy, built from source in our fork.
- Antivirus software may flag a DLL proxy, because the technique is common in malware too. Check the
  hashes and decide for yourself.

To uninstall, delete the two DLLs. Nothing else in the game folder is changed.

If the game fails to start with a message about `MSVCP140.dll` or `VCRUNTIME140_1.dll`, install the
Microsoft Visual C++ 2015-2022 Redistributable (x64) from Microsoft.

## Step 4: Register and get your personal key

You register once with a username and the invite code. The server answers with a **personal account
key**, a string starting with `UUK_`. The key is your password. The game uses it to log you in.

- **Nobody can recover it, not even the host.** The server stores only a SHA-256 hash of it. If you
  lose it, the host has to issue you a new one by hand.
- **Keep it private.** Anyone with your key can play as you.

**Choosing a username.** 3-16 characters, only letters, digits and underscore, and unique regardless
of upper and lower case. The server refuses any other name (see the table below). Your character is
also named after it on first login. Only the host can rename you later.

This script registers you and saves the key to your profile folder without printing it. It refuses to
run twice, because registering again would create a second, empty account.

```powershell
$Server   = "100.x.y.z"             # the host's Tailscale address
$Username = "YourName"              # 3-16 letters, digits or _
$Invite   = "code-from-the-host"

$dir = "$env:APPDATA\DauntlessRevived"
if (Test-Path "$dir\account.key") { throw "You already have a key in $dir. Registering again would create a second account." }
$body = @{ Username = $Username; InviteCode = $Invite } | ConvertTo-Json
$r = Invoke-RestMethod -Method Post -Uri "http://${Server}:61000/undaunted/api/Register" -ContentType "application/json" -Body $body
New-Item -ItemType Directory -Force $dir | Out-Null
Set-Content -Path "$dir\account.key" -Value $r.UUK -NoNewline -Encoding ASCII
"Registered. Key saved to $dir\account.key"
```

| Server answer | Meaning |
|:--------------|:--------|
| 200 | Registered. The key is in `account.key`. |
| 401 | The invite code is wrong or already used up (`invite_invalid`). |
| 400 | Registration is closed (`registration_closed`), or the username breaks the rules (`username_invalid`). |
| 409 | Someone already has that username, in any case (`username_taken`). Pick another one: your invite code was not used up. |
| No answer | Tailscale is off, or the host's server is not running. |

A refusal comes with a short JSON reason, `{"error": "<code>", "message": "..."}`, which PowerShell
shows with the error.

Check that the key works. This prints your user id, your username and whether you are an admin:

```powershell
$key = (Get-Content "$env:APPDATA\DauntlessRevived\account.key" -Raw).Trim()
Invoke-RestMethod "http://${Server}:61000/undaunted/api/GetUserInfo" -Headers @{ "x-undaunted-user-api-key" = $key }
```

Keep a copy of `account.key` somewhere safe, such as a password manager.

The server speaks plain HTTP, so the key crosses the network unencrypted inside the Tailscale tunnel.
Tailscale encrypts that tunnel end to end. Never send the key to this server over the open internet.

## Step 5: Launch

**First, keep the game away from Epic's old chat server.** Dauntless 1.4.4 ships with its chat and
presence connection (XMPP) pointed at Epic's live server, and keeps reconnecting to it, sending your
account id and your login token. Add this block to
`%LOCALAPPDATA%\Archon\Saved\Config\WindowsClient\Engine.ini` (create the file if it does not exist;
the quotes are required), with the host's address in place of `100.x.y.z`:

```ini
[OnlineSubsystemMcp.XMPP]
ServerAddr="ws://100.x.y.z"
ServerPort=61099
bUseSSL=false
```

The connection now goes to the host through Tailscale. Chat does not work in private mode yet, so it
simply fails, exactly as it does against Epic today, and the game carries on. The friend kit's `play.ps1` writes this
block on every launch.

Save this as `play.ps1` anywhere. It checks the three pinned hashes and then starts the game against
the host's server.

```powershell
param(
  [Parameter(Mandatory = $true)] [string]$Server,    # the host's Tailscale address
  [string]$Game = "C:\D144\Dauntless",
  [switch]$Windowed
)
$W   = Join-Path $Game "Archon\Binaries\Win64"
$exe = Join-Path $W "Dauntless-Win64-Shipping.exe"
$pinned = @{
  "Dauntless-Win64-Shipping.exe" = "D3D41E614908D2BEFD518B27046D9822D6130EF12BA3504BABBDB786BEF9CFF4"
  "dxgi.dll"                     = "9A431D7B6FD20C43FA92BEBD91C3BC023EC7A3FCBC52871C41F4DF293D4B0D1F"
  "UndauntedInternalServer.dll"  = "520EC588A0554E374B2B0D084CD7F7F08D59A9CB80362679845719D64A0D0933"
}
foreach ($f in $pinned.Keys) {
  $p = Join-Path $W $f
  if (-not (Test-Path $p)) { throw "Missing: $p" }
  if ((Get-FileHash $p -Algorithm SHA256).Hash -ne $pinned[$f]) { throw "Hash mismatch: $p" }
}
$key = (Get-Content "$env:APPDATA\DauntlessRevived\account.key" -Raw).Trim()
$a = @("${Server}:61000", "-AUTH_PASSWORD=$key", "-AUTH_LOGIN=unused", "-AUTH_TYPE=exchangecode",
       "-epicapp=appidlol", "-epicenv=Prod", "-EpicPortal", "-epicusername=usernamelol",
       "-epicuserid=useridlol", "-epiclocale=en-US", "-epicsandboxid=sandboxidlol",
       "-epicdeploymentid=deploymentidlol")
if ($Windowed) { $a += @("-windowed", "-ResX=1280", "-ResY=720") }
Start-Process $exe -WorkingDirectory $W -ArgumentList $a | Out-Null
"Launched against ${Server}:61000"
```

Run it:

```powershell
powershell -ExecutionPolicy Bypass -File .\play.ps1 -Server 100.x.y.z
```

What the arguments do:

- The **first argument** is the server address. The DLL takes it from there.
- `-AUTH_TYPE=exchangecode` with `-AUTH_PASSWORD=<key>` makes the game send your key as an "exchange
  code" to the server's `/account/api/oauth/token` route. The server swaps it for a login token that
  lasts 24 hours.
- The `-epic...` values are placeholders. The upstream launcher passes exactly these, and so do we. We
  have not tested which of them the 1.4.4 client actually needs.
- Your key sits on the game's command line, so other programs running on your own PC can read it. The
  upstream launcher works the same way.

The script starts `Dauntless-Win64-Shipping.exe` directly. Do not start `Dauntless.exe` or the
EasyAntiCheat bootstrapper. With a direct start, EasyAntiCheat never runs.

**What to expect on screen:**

- The DLL's log window stays hidden while you play. To see it when something goes wrong, turn on
  Settings > Troubleshooting > "Show the log window" in the launcher before pressing PLAY. If you
  show it, **leave it open**: closing a console window ends the process it belongs to, which here
  means the game.
- On your first login the server creates your character, named after your username, and the game
  sends you into the tutorial on one of the host's hunt servers. After that you arrive in Ramsgate. We
  have tested this path on the host's own account.
- F2 opens the Unreal console. The DLL turns it on.

## Step 6: Graphics options

The in-game options menu works as usual. It saves to
`%LOCALAPPDATA%\Archon\Saved\Config\WindowsClient\GameUserSettings.ini`.

You can also force settings. In 1.4.4, a `[SystemSettings]` section in your user `Engine.ini`
(`%LOCALAPPDATA%\Archon\Saved\Config\WindowsClient\Engine.ini`) overrides the menu. The host's own
launcher writes this block at the top of that file on every start to force the highest level:

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

- The `sg.*` levels are 0 = Low, 1 = Medium, 2 = High, 3 = Epic, 4 = Cinematic. Use 2 or 3 on a weaker
  PC.
- `r.Streaming.PoolSize=3000` sets a 3000 MB texture streaming pool, and `LimitPoolSizeToVRAM=1` lowers
  that limit further if your graphics card has less memory. The two `gc`/`s.` lines only affect memory
  cleanup, not image quality.
- `r.Tonemapper.Sharpen` counters the softness of temporal anti-aliasing. Remove it if you prefer the
  original look.
- Back up `Engine.ini` before editing it. Keep the rest of the file, because the game stores its own
  settings there too. Delete the block to hand control back to the menu.
- At Cinematic the client used about 1.8 to 2.3 GB of RAM on the host's PC.
- `play.ps1 -Windowed` starts in a 1280x720 window instead of your saved display mode.

## What to expect right now

This is a small private revival and a work in progress. As of this writing:

- On our own servers, one player has played the tutorial, Ramsgate, the Training Dojo, a normal hunt
  and a pursuit on the host PC, and on 22 September 2026 the same path up to the first hunt over the
  internet on the rented server. Later that night two players hunted together there, after queueing
  the same hunt within a few seconds of each other. Upstream Undaunted reports hunts in groups of up
  to 4 working; we have tried two.
- Slayer level, weapon and behemoth mastery and the Hunt Pass start from the beginning (Slayer level
  1) and are saved, on a server that runs the current code with its default settings. Every account
  owns the Elite Hunt Pass. Slayer level, weapon mastery and behemoth mastery have all been seen going
  up in the game. On a server that ran an older version, your level may start over at 1 after the
  update: ask your host.
- The pre-hunt airship is very dark for now. It is a short scene; see
  [Troubleshooting]({{ trouble_page.url | relative_url }}#airship-dark-windows-blown-out).
- Parties, friends and guilds are built on the server and pass our tests, but have not been tried
  by two players in the game yet; see [Friends, parties and guilds](#friends-parties-and-guilds)
  below. Until parties are proven, you can also queue for the same hunt at about the same time: the
  matchmaker collects players who queue for the same hunt and starts one server for them once 4 have
  joined, or once 20 seconds pass with nobody new joining.
- Text chat is built but not switched on yet (see below). Use the [Dauntless Revived Discord](https://discord.gg/ZJRprHzsgu).
- Bounties and cooldowns are stored, but drafting and claiming a bounty and the daily reset have not
  been tried in the game yet. Escalations are stubbed and do not carry over between sessions, unless
  your host has switched real Escalation on (then everyone starts again from level 0).
- The in-game store is built but off unless your host switches it on. When it is on, everything in it
  is free.
- Voice chat ran on Vivox, a paid third-party service, and cannot come back. Use the [Dauntless Revived Discord](https://discord.gg/ZJRprHzsgu).
- A server hosted on someone's PC is off when that PC is off. A server on a rented machine does not
  depend on anyone's PC.

## Friends, parties and guilds {#friends-parties-and-guilds}

**Status (22 September 2026): built on the server, not yet tried by two players.** In the first test
with two players, a party invite never showed and Add Friends did nothing. Both causes are found and
fixed on the server, and guilds are new. Nobody has tried the fixed version in the game yet, so tell
the host what you see.

**After the host updates the server, restart your game once.** The game remembers what it learned
about other players until it restarts, including the wrong answers from before.

Everything below is in the **Social** panel, which has the tabs My Friends, Add Friends, My Links and
Guilds. **Everyone shows as Offline, you included.** That is expected for now (see the end of this
section); it does not mean the other player is not there.

### Add a friend

1. Open **Add Friends**, type the other player's username and press **Add**. It is not a search: the
   name must be exact, but upper and lower case do not matter. You get a "friend invite sent"
   message, and nothing else changes on your screen.
2. The other player sees your request **the next time they log in**, not straight away, with
   **Accept** and **Decline**.
3. Once they accept, you appear under each other's **OFFLINE** list after your next login.

From a friend's menu you can **Remove** them, or **Block** a player (they move to **BLOCKED**, any
open party or guild invites between you are removed, and neither of you can send the other friend
requests, party invites or guild invites). **Unblock** undoes it. A server allows 200 friends, 50 unanswered requests sent, and 20 new requests in 10 minutes.

### Invite someone to your party

You don't have to be friends. Parties have up to 4 players, and only the party leader invites.

1. Open **Social**, find the player under **Hunt Members** (players on your server) or among your
   friends, and choose **Invite to Party**.
2. The other player sees the invite under **PARTY INVITES** within about 10 seconds, and chooses
   **Accept**.
3. Both party panels show both names. When the leader picks a hunt, the whole party goes to the same
   hunt server, and comes back to Ramsgate with the leader.

If someone declines your invite, you can invite them again after 2 minutes, and you can send 20
invites in 10 minutes. If **Invite to Party** does nothing at all while you are on your own, tell the
host: there is a server setting for exactly that case.

If the in-game invite does not work, the host can send one by name from the server (the
`PartyInvite` route of the [management API]({{ '/reference/api.html' | relative_url }}#undaunted-api));
you still accept it in the game. The same goes for guild invites (`GuildInvite`).

### Slayer Links {#slayer-links}

**New, not yet tried in the game.** In the **My Links** tab two friends can link up for a week: invite
a friend into one of your three link slots, and they accept into one of theirs. You must be friends,
and neither of you may have blocked the other. An invite waits 24 hours for an answer. You can remove a
link at any time; it ends for both of you. Removing a friend or blocking them cancels the invites
between you that are still waiting. The game may keep the tab hidden; if it does, nothing changes.

### Guilds

- **Create one** in the **Guilds** tab while you are in Ramsgate: **CREATE GUILD**, then a name of
  4-15 English letters and digits (at most 6 digits, and at most 6 of the same letter in a row) and,
  if you like, a nameplate of 2-6 letters and digits, which shows as `[TAG]` over your head. The
  window checks the name as you type and tells you when it is taken or not allowed. **Wait a moment
  after typing, then press Create:** the server only creates a name and nameplate the window has
  checked for you. Words that look like staff (admin, moderator, official, GM, DEV and similar) count
  as taken. Creating a guild is free.
- **Invite** (leader and officers): type the player's username in the add-member box (it says "Enter
  an Epic Games display name"; on this server that is the username), or choose **Invite to Guild** in
  any player's menu.
- **The invited player** sees the invite under **GUILD INVITES** at their next login, or after
  travelling (to a hunt and back to Ramsgate), with **Accept** and **Decline**. An invite stays open
  for 7 days. To accept, leave your current guild first. If you decline, the same guild can invite you
  again after 24 hours.
- **The leader** can make members officers and back, hand the guild over (**Promote To Guild
  Leader**; the old leader becomes an officer), kick members and disband the guild. The leader cannot
  leave: hand the guild over or disband it. Officers can invite; members can leave.
- A guild has up to 100 members (the host can change that). Other members see changes at their next
  login or world load.

### What does not work yet

- **Online status.** Everyone shows as Offline, and EPIC FRIENDS stays empty. Showing friends as
  online is built into the chat server, but the host switches it on only after chat itself works and
  two players have tried it.
- **Chat**: whispers, party, guild and Ramsgate chat, with usernames, is built, but the host turns it
  on only after two players have tried it; until then, use the [Dauntless Revived Discord](https://discord.gg/ZJRprHzsgu). At first Ramsgate chat reaches
  only the players who travelled there with you as a party.
- **Changes show late.** Friend requests, accepted requests and guild changes reach the other player
  at their next login (for guilds, also after travelling), not at once.
- Voice chat, and the friends service's recent players.

If something does not show, tell the host what you did and roughly when; the server logs every step.

## Troubleshooting

| Symptom | Likely cause |
|:--------|:-------------|
| `Invoke-RestMethod` times out | Tailscale is off, the share is not accepted, or the host's PC or server is down. |
| Register answers 401 | Wrong or used-up invite code. Ask the host for a new one. |
| Register answers 400 | Registration is closed, or the username is not 3-16 letters, digits or underscores. |
| Register answers 409 | The username is taken (in any case). Pick another; the invite code still works. |
| `Hash mismatch` from `play.ps1` | A different game build or different DLLs. They will not work together. |
| Game starts with no console window and cannot log in | `dxgi.dll` is not in the `Win64` folder, or antivirus removed or quarantined it. Check that both DLLs are there and match the hashes. |
| Error about `MSVCP140.dll` or `VCRUNTIME140_1.dll` | Install the Visual C++ 2015-2022 Redistributable (x64). |
| Matchmaking or the trip to a hunt hangs | All of the host's hunt slots may be busy (six at a time). The server then cannot start a hunt for you, and your search ends as failed. Tell the host. |
| Hunt never loads, or you are sent back | A hunt server shuts itself down after 50 seconds in total with nobody connected, and a slow map load can take longer than that. Tell the host. |

## Your right to the source

The server you play on is a modified version of [Undaunted](https://github.com/SyST3MDeV/Undaunted),
which is licensed under the GNU AGPL-3.0. Because you use the modified server over a network, you are
entitled to its complete source code (section 13). Because the host gives you DLL binaries, you are
also entitled to their source (section 6).

- Our fork's source is in [this site's repository]({{ site.github.repository_url }}), branch
  `dauntless-revived`. Ask the host which commit their server runs.
- Upstream's source is at [github.com/SyST3MDeV/Undaunted](https://github.com/SyST3MDeV/Undaunted).
- Known gap: upstream never published the source of the prebuilt `dxgi.dll`. We plan to close this by
  shipping our own proxy, built from source (see step 3).
- The DLL includes MinHook, which is under the BSD 2-Clause licence.

[Credits and license]({{ legal_page.url | relative_url }}) has the full picture. It is not legal
advice.
