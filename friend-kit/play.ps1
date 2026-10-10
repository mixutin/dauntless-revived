# Dauntless Revived - start the game against the host's server.
# Run setup.ps1 once first. Then double-click "Play Dauntless.cmd", or:
#
#   powershell -ExecutionPolicy Bypass -File .\play.ps1 [-Graphics 4] [-Windowed]
#
# -Graphics 0..4  force a quality level on every launch (4 = Cinematic). Default: use the in-game menu.
# -Windowed       start in a 1280x720 window.
# -DryRun         check everything and show the launch line (key hidden) without starting the game.
param(
  [string]$Server,
  [string]$Game,
  [int]$Graphics = -1,
  [switch]$Windowed,
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"

$Dir = Join-Path $env:APPDATA "DauntlessRevived"
$KeyFile = Join-Path $Dir "account.key"
$SettingsFile = Join-Path $Dir "settings.json"
function Fail($text) { Write-Host "!! $text" -ForegroundColor Red; exit 1 }

if (Test-Path -LiteralPath $SettingsFile) {
  $s = Get-Content -LiteralPath $SettingsFile -Raw | ConvertFrom-Json
  if (-not $Server) { $Server = $s.Server }
  if (-not $Game) { $Game = $s.Game }
}
if (-not $Server -or -not $Game) { Fail "Run setup.ps1 first." }
if (-not (Test-Path -LiteralPath $KeyFile)) { Fail "No account key in $Dir. Run setup.ps1 first." }
$ServerHost = ($Server -split ":")[0]
$Backend = if ($Server -match ":\d+$") { $Server } else { "${Server}:61000" }

# The exact files this server works with. Anything else is refused.
$Win64 = Join-Path $Game "Archon\Binaries\Win64"
$Pinned = @{
  "Dauntless-Win64-Shipping.exe" = "D3D41E614908D2BEFD518B27046D9822D6130EF12BA3504BABBDB786BEF9CFF4"
  "dxgi.dll"                     = "9A431D7B6FD20C43FA92BEBD91C3BC023EC7A3FCBC52871C41F4DF293D4B0D1F"
  "UndauntedInternalServer.dll"  = "A090E8B25044647CE409B313525501DA578D632D3FCB9EB351F020CA94FA64FB"
}
foreach ($f in $Pinned.Keys) {
  $p = Join-Path $Win64 $f
  if (-not (Test-Path -LiteralPath $p)) { Fail "Missing: $p (run setup.ps1)" }
  if ((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash -ne $Pinned[$f]) { Fail "Hash mismatch: $p (run setup.ps1)" }
}

# User Engine.ini: [SystemSettings] and [OnlineSubsystemMcp.XMPP] are rewritten on every launch;
# everything else in the file is kept.
#  - Chat/presence (XMPP): 1.4.4 ships pointed at Epic's live chat server and would send it your
#    account id and login token. Point it at the host instead. URLs must be quoted in a user ini.
#  - The texture pool is bounded by your GPU's memory; the gc lines only affect memory cleanup.
$Cfg = Join-Path $env:LOCALAPPDATA "Archon\Saved\Config\WindowsClient"
New-Item -ItemType Directory -Force $Cfg | Out-Null
#  - No r.EyeAdaptationQuality=0: turning 1.4.4's automatic exposure off fixed the dark pre-hunt airship
#    but made Ramsgate and every night scene far too dark, so the game's own exposure stays on.
$sys = @("[SystemSettings]", "r.Streaming.PoolSize=3000", "r.Streaming.LimitPoolSizeToVRAM=1",
         "gc.TimeBetweenPurgingPendingKillObjects=10", "s.ForceGCAfterLevelStreamedOut=1")
$groups = "ViewDistance", "AntiAliasing", "Shadow", "PostProcess", "Texture", "Effects", "Foliage", "Shading"
if ($Graphics -ge 0) {
  if ($Graphics -gt 4) { Fail "-Graphics is 0 to 4." }
  $sys += ($groups | ForEach-Object { "sg.${_}Quality=$Graphics" })
  $sys += @("sg.ResolutionQuality=100", "r.ScreenPercentage=100", "r.MipMapLODBias=0", "r.MaxAnisotropy=16", "r.Tonemapper.Sharpen=0.6")
}
$xmpp = @("[OnlineSubsystemMcp.XMPP]", "ServerAddr=`"ws://$ServerHost`"", "ServerPort=61099", "bUseSSL=false")
$eng = Join-Path $Cfg "Engine.ini"
$lines = if (Test-Path -LiteralPath $eng) { Get-Content -LiteralPath $eng } else { @() }
$keep = New-Object System.Collections.Generic.List[string]; $skip = $false
foreach ($l in $lines) {
  if ($l -match '^\[(SystemSettings|OnlineSubsystemMcp\.XMPP)\]') { $skip = $true; continue }
  if ($skip -and $l -match '^\[') { $skip = $false }
  if (-not $skip) { $keep.Add($l) }
}
Set-Content -LiteralPath $eng -Encoding ASCII -Value ($sys + "" + $xmpp + "" + $keep)
$gus = Join-Path $Cfg "GameUserSettings.ini"
if ($Graphics -ge 0 -and (Test-Path -LiteralPath $gus)) {
  $g = Get-Content -LiteralPath $gus
  foreach ($k in $groups) { $g = $g -replace "^sg\.${k}Quality=.*", "sg.${k}Quality=$Graphics" }
  Set-Content -LiteralPath $gus -Encoding ASCII -Value $g
}

# The first argument is the server address (the DLL reads it). The key is sent to the server as an
# "exchange code"; the -epic... values are placeholders the upstream launcher also passes.
$key = (Get-Content -LiteralPath $KeyFile -Raw).Trim()
$a = @($Backend, "-AUTH_PASSWORD=$key", "-AUTH_LOGIN=unused", "-AUTH_TYPE=exchangecode",
  "-epicapp=appidlol", "-epicenv=Prod", "-EpicPortal", "-epicusername=usernamelol",
  "-epicuserid=useridlol", "-epiclocale=en-US", "-epicsandboxid=sandboxidlol",
  "-epicdeploymentid=deploymentidlol", "-NoEAC")
if ($Windowed) { $a += @("-windowed", "-ResX=1280", "-ResY=720") }

if ($DryRun) {
  "Engine.ini: $eng"
  "Would start: $(Join-Path $Win64 'Dauntless-Win64-Shipping.exe') $(($a -replace '^-AUTH_PASSWORD=.*', '-AUTH_PASSWORD=<your key>') -join ' ')"
  exit 0
}
Start-Process (Join-Path $Win64 "Dauntless-Win64-Shipping.exe") -WorkingDirectory $Win64 -ArgumentList $a | Out-Null
"Starting Dauntless against $Backend. A console window opens next to the game: leave it open."
