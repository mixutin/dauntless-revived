# Dauntless Revived - one-time setup for a friend's PC.
#
# Checks the game files, installs the two server DLLs, registers your account on the
# host's server and saves your personal key. Safe to run again: it never registers twice
# and only copies a DLL when it is missing or wrong.
#
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1 -Server 100.x.y.z
#
# -Server    the host's Tailscale address (the host tells you), optionally with :port
# -Game      the folder that contains Archon\ (default C:\D144\Dauntless)
# -Zip       optional: the downloaded game zip, to check it before you extract it
# -Username  3-16 letters, digits or _   (asked for if missing)
# -Invite    the invite code from the host (asked for if missing)
# -NoMods    skip installing UE4SS and the client mods (client-mods\, see its README.md)
param(
  [string]$Server,
  [string]$Game = "C:\D144\Dauntless",
  [string]$Zip,
  [string]$Username,
  [string]$Invite,
  [switch]$NoMods
)
$ErrorActionPreference = "Stop"

$Pinned = @{
  "zip"                          = "556B9A648A5E5E7E11B6F8DD3D80FF8E88FCEB0D3448297AAF47CE7BF756BC6D"
  "Dauntless-Win64-Shipping.exe" = "D3D41E614908D2BEFD518B27046D9822D6130EF12BA3504BABBDB786BEF9CFF4"
  "dxgi.dll"                     = "9A431D7B6FD20C43FA92BEBD91C3BC023EC7A3FCBC52871C41F4DF293D4B0D1F"
  "UndauntedInternalServer.dll"  = "A090E8B25044647CE409B313525501DA578D632D3FCB9EB351F020CA94FA64FB"
}
$Dir = Join-Path $env:APPDATA "DauntlessRevived"
$KeyFile = Join-Path $Dir "account.key"
$SettingsFile = Join-Path $Dir "settings.json"

function Step($text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "   OK  $text" -ForegroundColor Green }
function Fail($text) { Write-Host "   !!  $text" -ForegroundColor Red; exit 1 }
function Hash($path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }

if (-not $Server) { $Server = (Read-Host "Host address (from the host, e.g. 100.x.y.z)").Trim() }
if (-not $Server) { Fail "No host address given." }
$ServerHost = ($Server -split ":")[0]
$Backend = if ($Server -match ":\d+$") { $Server } else { "${Server}:61000" }

# 1. The game zip (optional) and the game executable.
if ($Zip) {
  Step "Checking the game zip (this reads 11 GB and takes a minute or two)"
  if (-not (Test-Path -LiteralPath $Zip)) { Fail "Zip not found: $Zip" }
  if ((Hash $Zip) -ne $Pinned["zip"]) { Fail "The zip does not match the verified 1.4.4 build. Download it again." }
  Ok "zip matches the verified 1.4.4 build. Extract it so that $Game\Archon exists, then run this again without -Zip."
  exit 0
}

Step "Checking the game in $Game"
$Win64 = Join-Path $Game "Archon\Binaries\Win64"
$Exe = Join-Path $Win64 "Dauntless-Win64-Shipping.exe"
if (-not (Test-Path -LiteralPath $Exe)) { Fail "Not found: $Exe  (use -Game to point at the folder that contains Archon\)" }
if ((Hash $Exe) -ne $Pinned["Dauntless-Win64-Shipping.exe"]) { Fail "Dauntless-Win64-Shipping.exe is not the 1.4.4 build this server needs." }
Ok "Dauntless-Win64-Shipping.exe is the verified 1.4.4 build"

# 2. The two DLLs: taken from this kit, checked before and after copying.
Step "Installing the two server DLLs"
foreach ($name in "dxgi.dll", "UndauntedInternalServer.dll") {
  $target = Join-Path $Win64 $name
  if ((Test-Path -LiteralPath $target) -and ((Hash $target) -eq $Pinned[$name])) { Ok "$name already installed"; continue }
  $source = @((Join-Path $PSScriptRoot "dll\$name"), (Join-Path $PSScriptRoot "..\UndauntedLauncher\assets\$name")) |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $source) { Fail "$name is missing from this kit (expected in $PSScriptRoot\dll\)." }
  if ((Hash $source) -ne $Pinned[$name]) { Fail "The kit's $name does not match the pinned hash. Do not use this kit." }
  Copy-Item -LiteralPath $source -Destination $target -Force
  Unblock-File -LiteralPath $target
  if ((Hash $target) -ne $Pinned[$name]) { Fail "$name changed while copying. Is antivirus interfering?" }
  Ok "$name installed and checked"
}

# 2b. UE4SS and the client mods (health bars, tracker, mod menu), from client-mods\.
# Every file is checked against client-mods\manifest.json before and after copying. mods.txt and
# UE4SS-settings.ini are only written when missing, so a player's own choices are kept. Files an
# earlier kit installed that the bundle dropped since (manifest "remove") are deleted.
# Problems here only warn: the game still works without the mods.
if (-not $NoMods) {
  Step "Installing UE4SS and the client mods"
  $modsSrc = @((Join-Path $PSScriptRoot "client-mods"), (Join-Path $PSScriptRoot "..\client-mods")) |
    Where-Object { Test-Path -LiteralPath (Join-Path $_ "manifest.json") } | Select-Object -First 1
  if (-not $modsSrc) {
    Write-Host "   --  client-mods\ not found next to this kit: skipped (the game works without it)" -ForegroundColor Yellow
  } else {
    $manifest = Get-Content -LiteralPath (Join-Path $modsSrc "manifest.json") -Raw | ConvertFrom-Json
    $shipped = @($manifest.files | ForEach-Object { $_.path })
    $winRoot = [IO.Path]::GetFullPath($Win64).TrimEnd('\') + '\'
    foreach ($r in @($manifest.remove)) {
      # Plain relative paths with "/" only; anything else (backslashes, "..", drives, absolute) is skipped.
      if (-not $r -or $shipped -contains $r -or $r -match '\\|(^|/)\.\.?(/|$)|^/|:') { continue }
      $old = [IO.Path]::GetFullPath((Join-Path $Win64 ($r -replace '/', '\')))
      if (-not $old.StartsWith($winRoot, [StringComparison]::OrdinalIgnoreCase)) { continue }
      if (-not (Test-Path -LiteralPath $old)) { continue }
      Remove-Item -LiteralPath $old -Force
      $dir = Split-Path $old
      while ($dir.Length -gt $Win64.Length -and -not (Get-ChildItem -LiteralPath $dir -Force)) {
        Remove-Item -LiteralPath $dir -Force; $dir = Split-Path $dir
      }
      Write-Host "   --  removed $r (no longer part of the mods)"
    }
    $copied = 0; $kept = 0; $bad = 0
    foreach ($f in $manifest.files) {
      if ($f.path -match '\\|(^|/)\.\.?(/|$)|^/|:') { Write-Host "   !!  $($f.path): unsafe path in manifest.json - skipped" -ForegroundColor Yellow; $bad++; continue }
      $rel = $f.path -replace '/', '\'
      $src = Join-Path $modsSrc $rel
      $dst = [IO.Path]::GetFullPath((Join-Path $Win64 $rel))
      if (-not $dst.StartsWith($winRoot, [StringComparison]::OrdinalIgnoreCase)) { $bad++; continue }
      $want = $f.sha256.ToUpper()
      if (Test-Path -LiteralPath $dst) {
        if ($f.keep) {
          if ($f.path -eq 'ue4ss/Mods/mods.txt') {
            if ((Hash $src) -ne $want) { $bad++; continue }
            $text = [IO.File]::ReadAllText($dst)
            $defaults = [IO.File]::ReadAllText($src)
            $names = @([regex]::Matches($text, '(?m)^[ \t]*([A-Za-z0-9_]+)[ \t]*:') | ForEach-Object { $_.Groups[1].Value })
            $missing = @([regex]::Matches($defaults, '(?m)^[ \t]*([A-Za-z0-9_]+)[ \t]*:[ \t]*([01])[ \t]*\r?$') | Where-Object { $names -notcontains $_.Groups[1].Value } | ForEach-Object { $_.Groups[1].Value + ' : ' + $_.Groups[2].Value })
            if ($missing.Count) {
              $eol = "`n"; if ($text.Contains("`r`n")) { $eol = "`r`n" }
              [IO.File]::WriteAllText($dst, ($missing -join $eol) + $eol + $text, (New-Object Text.UTF8Encoding $false))
            }
          }
          $kept++; continue
        }
        if ((Hash $dst) -eq $want) { continue }
      }
      if (-not (Test-Path -LiteralPath $src) -or (Hash $src) -ne $want) {
        Write-Host "   !!  $($f.path) in the kit does not match manifest.json - not installed" -ForegroundColor Yellow
        $bad++; continue
      }
      New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
      Copy-Item -LiteralPath $src -Destination $dst -Force
      Unblock-File -LiteralPath $dst
      if ((Hash $dst) -ne $want) { Write-Host "   !!  $($f.path) changed while copying. Is antivirus interfering?" -ForegroundColor Yellow; $bad++; continue }
      $copied++
    }
    # Mods named in "disable": "Name : 1" -> "Name : 0" in the kept mods.txt, nothing else changed.
    $modsTxt = Join-Path $Win64 'ue4ss\Mods\mods.txt'
    $off = @($manifest.disable) | Where-Object { $_ -match '^[A-Za-z0-9_]+$' }
    if ($off -and (Test-Path -LiteralPath $modsTxt)) {
      $text = [IO.File]::ReadAllText($modsTxt)
      $new = $text
      foreach ($n in $off) { $new = [regex]::Replace($new, "(?m)^([ \t]*$n[ \t]*:[ \t]*)1([ \t]*\r?)$", '${1}0${2}') }
      if ($new -ne $text) { [IO.File]::WriteAllText($modsTxt, $new, (New-Object Text.UTF8Encoding $false)); Write-Host "   --  switched off in mods.txt: $($off -join ', ')" }
    }
    if ($bad -eq 0) { Ok "UE4SS + mods ready ($copied file(s) installed or updated, $kept setting file(s) kept)" }
    else { Write-Host "   !!  $bad mod file(s) could not be installed; the game still works without them" -ForegroundColor Yellow }
  }
}

$missing = @("MSVCP140.dll", "VCRUNTIME140_1.dll") | Where-Object { -not (Test-Path (Join-Path $env:WINDIR "System32\$_")) }
if ($missing) {
  Write-Host "   !!  Missing $($missing -join ', '): install the Microsoft Visual C++ 2015-2022 Redistributable (x64)" -ForegroundColor Yellow
  Write-Host "       from https://aka.ms/vs/17/release/vc_redist.x64.exe  - the game's server DLL needs it." -ForegroundColor Yellow
} else { Ok "Visual C++ runtime present" }

# 3. Can we reach the host?
Step "Contacting the host at $Backend"
$port = [int]($Backend -split ":")[-1]
$tcp = New-Object System.Net.Sockets.TcpClient
try {
  $wait = $tcp.BeginConnect($ServerHost, $port, $null, $null)
  if (-not $wait.AsyncWaitHandle.WaitOne(4000) -or -not $tcp.Connected) { throw "timeout" }
  $tcp.EndConnect($wait)
} catch {
  Fail "No answer from $Backend. Is Tailscale on, have you accepted the host's share, and is the host's server running?"
} finally { $tcp.Close() }
Ok "the host's server answers"

# 4. Register once, and keep the key private.
New-Item -ItemType Directory -Force $Dir | Out-Null
if (Test-Path -LiteralPath $KeyFile) {
  Step "Account"
  Ok "you already have a key in $Dir (not registering again)"
} else {
  Step "Registering your account"
  if (-not $Username) { $Username = (Read-Host "Choose a username (3-16 letters, digits or _)").Trim() }
  if ($Username -notmatch '^[A-Za-z0-9_]{3,16}$') { Fail "Usernames are 3-16 characters: letters, digits or _." }
  if (-not $Invite) { $Invite = (Read-Host "Invite code from the host").Trim() }
  $body = @{ Username = $Username; InviteCode = $Invite } | ConvertTo-Json
  try {
    $r = Invoke-RestMethod -Method Post -Uri "http://$Backend/undaunted/api/Register" -ContentType "application/json" -Body $body -TimeoutSec 20
  } catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    switch ($code) {
      401 { Fail "The invite code is wrong or used up. Ask the host for a new one." }
      409 { Fail "That username is taken. Pick another." }
      400 { Fail "The host's server refused the registration (registration closed, or the username is not allowed)." }
      default { Fail "Registration failed: $($_.Exception.Message)" }
    }
  }
  if (-not $r.UUK) { Fail "The server did not return a key." }
  Set-Content -LiteralPath $KeyFile -Value $r.UUK -NoNewline -Encoding ASCII
  Ok "registered; your personal key is saved in $KeyFile"
  Write-Host "      Keep a copy somewhere safe (a password manager). Nobody can recover it for you." -ForegroundColor Yellow
}

# 5. Check that the key works, without ever printing it.
$key = (Get-Content -LiteralPath $KeyFile -Raw).Trim()
try {
  $me = Invoke-RestMethod -Uri "http://$Backend/undaunted/api/GetUserInfo" -Headers @{ "x-undaunted-user-api-key" = $key } -TimeoutSec 20
} catch { Fail "The server did not accept your key. Ask the host." }
Ok "logged in as '$($me.name)'"

@{ Server = $Server; Game = $Game } | ConvertTo-Json | Set-Content -LiteralPath $SettingsFile -Encoding ASCII
Step "Done"
Write-Host "   Start the game with 'Play Dauntless.cmd' (or: powershell -ExecutionPolicy Bypass -File .\play.ps1)."
