<#
.SYNOPSIS
    Backs up everything needed to restore a Dauntless Revived server.

.DESCRIPTION
    Takes the save database with SQLite's online backup API (safe while the metagame runs), checks the
    copy, and copies the files that are not in git: the .env files (token-signing keys, game-server key,
    gateway settings), the account and game-server key files, the gateway's TLS certificate and key
    (public mode: restoring them keeps the fingerprint, so invites already handed out keep working) and
    server.json. The allowlist helper's settings are not copied: only SYSTEM and administrators can read
    them, and an install makes new ones.

    Layout (the same as the original host's backups, so -RestoreFrom accepts either):
        <root>\backups\yyyy-MM-dd_HHmmss\undaunted.db
        <root>\backups\yyyy-MM-dd_HHmmss\server.json
        <root>\backups\yyyy-MM-dd_HHmmss\secrets\metagame.env, deployserver.env, content.env, gateway.env, *.key
        <root>\backups\yyyy-MM-dd_HHmmss\secrets\tls\gateway-cert.pem, gateway-key.pem

    Retention: one verified backup by default, replaced only after the next backup succeeds.
    Runs hourly from the "Dauntless Revived backup" scheduled task (through backup-hidden.vbs, so no
    window appears), and from Stack.ps1 around every start and stop.

    The backups contain keys. Copy them off the server only encrypted.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File C:\DauntlessRevived\bin\Backup-DauntlessServer.ps1
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Root,
    [ValidateRange(1, 10000)][int]$Hourly = 1,
    [ValidateRange(0, 10000)][int]$Daily = 0
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\DauntlessServer.Common.ps1"
try { (Get-Process -Id $PID).PriorityClass = 'BelowNormal' } catch {}

$Root = Resolve-DRRoot $Root $PSScriptRoot
$P = Get-DRPaths $Root
$cfg = $null
if (Test-Path -LiteralPath $P.ServerJson) { $cfg = Get-DRConfig $Root }
$node = Get-DRConfigValue $cfg 'NodePath' 'node'
$metaDir = Join-Path $P.App 'UndauntedMetagame'

if (-not $PSCmdlet.ShouldProcess($P.Backups, 'Back up the database and secrets')) { return }

New-Item -ItemType Directory -Force -Path $P.Backups | Out-Null
# An OS-held lock covers scheduled and manual/Stack invocations, across accounts.
# A crashed process releases it automatically; the file itself may remain.
$lockPath = Join-Path $P.Backups 'backup.lock'
if (Test-DRReparsePoint $lockPath) { throw 'Backup lock must not be a reparse point' }
try {
    $backupLock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch [IO.IOException] {
    Write-Output 'backup skipped: another backup is still running'
    exit 0
}
try {
$log = Join-Path $P.Backups 'backup.log'
# backups is service-writable; this may run as an administrator. Never rotate through a planted
# reparse point (remove the link instead), and refuse to follow a junctioned backups folder.
if (Test-DRReparsePoint $log) { Remove-DRItemNoFollow $log }
elseif ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 5MB) {
    if (Test-DRReparsePoint "$log.1") { Remove-DRItemNoFollow "$log.1" }
    Move-Item -LiteralPath $log -Destination "$log.1" -Force
}
function Log([string]$Text) {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text
    Add-Content -LiteralPath $log -Value $line -Encoding UTF8
    Write-Output $Text
}

$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$dest = Join-Path $P.Backups $stamp
if (Test-Path -LiteralPath $dest) { Start-Sleep -Seconds 1; $stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'; $dest = Join-Path $P.Backups $stamp }
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# 1. The database. No database yet (fresh install before the first start) is not an error.
$dbNote = 'no database yet'
if (Test-Path -LiteralPath $P.Db) {
    $code = Invoke-DRNative -FilePath $node -Arguments @((Join-Path $PSScriptRoot 'lib\dr-db.js'), 'backup', $metaDir, $P.Db, (Join-Path $dest 'undaunted.db'), '--online', $P.DeployEnv) `
        -WorkingDirectory $P.Root -LogBase (Join-Path $P.Logs 'backup-db')
    if ($code -ne 0) {
        # Any non-zero exit used to be reported as a failed integrity check, which sends you
        # looking at the database when the usual cause is that the helper could not reach the
        # metagame at all. Quote what it actually said.
        $why = (Get-Content -LiteralPath (Join-Path $P.Logs 'backup-db.err.log') -ErrorAction SilentlyContinue | Where-Object { $_.Trim() } | Select-Object -Last 1)
        if (-not $why) { $why = "exit $code, no error output" }
        Log "backup FAILED: $why (see $($P.Logs)\backup-db.err.log)"
        Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue
        exit 1
    }
    $dbNote = (Get-Content -LiteralPath (Join-Path $P.Logs 'backup-db.out.log') | Where-Object { $_ -match '^db ' } | Select-Object -Last 1)
}

# 2. Secrets and configuration. Losing the signing keys logs everyone out; losing an account key
#    locks that player out.
$sec = Join-Path $dest 'secrets'
New-Item -ItemType Directory -Force -Path $sec | Out-Null
$copies = @(
    @($P.MetaEnv, 'metagame.env'), @($P.DeployEnv, 'deployserver.env'), @($P.ContentEnv, 'content.env'), @($P.GatewayEnv, 'gateway.env')
)
$skipped = @()
foreach ($c in $copies) {
    if (Test-Path -LiteralPath $c[0]) {
        try { Copy-Item -LiteralPath $c[0] -Destination (Join-Path $sec $c[1]) -ErrorAction Stop } catch { $skipped += $c[1] }
    }
}
if ((Test-Path -LiteralPath $P.GatewayCert) -and (Test-Path -LiteralPath $P.GatewayKey)) {
    $tls = Join-Path $sec 'tls'
    New-Item -ItemType Directory -Force -Path $tls | Out-Null
    try {
        Copy-Item -LiteralPath $P.GatewayCert -Destination (Join-Path $tls 'gateway-cert.pem') -ErrorAction Stop
        Copy-Item -LiteralPath $P.GatewayKey -Destination (Join-Path $tls 'gateway-key.pem') -ErrorAction Stop
    } catch { $skipped += 'tls' }
}
if (Test-Path -LiteralPath $P.Keys) {
    foreach ($k in Get-ChildItem -LiteralPath $P.Keys -Filter *.key -File) {
        try { Copy-Item -LiteralPath $k.FullName -Destination $sec -ErrorAction Stop }
        catch { $skipped += $k.Name }
    }
}
if (Test-Path -LiteralPath $P.ServerJson) { Copy-Item -LiteralPath $P.ServerJson -Destination $dest }
if (Test-Path -LiteralPath $P.News) { Copy-Item -LiteralPath $P.News -Destination $dest }

# 3. Retention.
# Do not discard the last complete recovery point after an incomplete backup.
if ($skipped.Count) {
    Log 'backup incomplete: previous backups retained'
    exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $dest 'undaunted.db'))) {
    Log 'no database yet: previous backups retained'
    exit 0
}
$all = Get-DRBackupFolders $P.Backups
$keep = @{}
$all | Select-Object -First $Hourly | ForEach-Object { $keep[$_.Name] = $true }
$all | Group-Object { $_.Name.Substring(0, 10) } | Sort-Object Name -Descending | Select-Object -First $Daily |
    ForEach-Object { $keep[$_.Group[0].Name] = $true }
$removeFailed = 0
foreach ($old in ($all | Where-Object { -not $keep[$_.Name] })) {
    # Windows PowerShell 5.1's Remove-Item -Recurse descends into junctions, so a compromised service
    # account could point a backup folder at anything and have this (possibly administrator-run)
    # retention delete it. Remove-DRItemNoFollow deletes a junction as a link and never follows it.
    try { Remove-DRItemNoFollow $old.FullName } catch { $removeFailed++ }
}

$bytes = (Get-ChildItem -LiteralPath $dest -Recurse -File | Measure-Object Length -Sum).Sum
$extra = ''
if ($skipped.Count) { $extra += "; not readable by this account: $($skipped -join ', ')" }
if ($removeFailed) { $extra += "; $removeFailed old backup(s) could not be removed" }
Log "backup: $dest  ($bytes bytes, $dbNote, $($keep.Count) kept$extra)"
} finally {
    $backupLock.Dispose()
}
exit 0
