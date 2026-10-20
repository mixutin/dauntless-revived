<#
.SYNOPSIS
    Updates the server code of an installed Dauntless Revived server, with an automatic rollback.

.DESCRIPTION
    1. Builds the new code into <root>\app.new while the server keeps running (below normal priority):
       from an uploaded source zip (-SourceZip, what Deploy-Remote.ps1 -Update sends), a folder
       (-SourceDir), or GitHub (-Ref <tag, branch or commit>).
    2. Takes a backup (the metagame may migrate the database when it starts), stops the stack, puts the
       new build in place (the old one stays as app.prev) and refreshes the kit scripts in <root>\bin
       from the new code.
    3. Starts the stack and checks it: the metagame answers, and in public mode the gateway answers over
       TLS with the certificate in the invites. If the check fails within 3 minutes, it switches back to
       the previous build and starts that again.

    Settings (.env files), keys, the certificate, the game files and the firewall are not touched; run
    Install-DauntlessServer.ps1 again for those. -Rollback switches to the previous build by hand.

.EXAMPLE
    C:\DauntlessRevived\bin\Update-DauntlessServer.ps1 -Ref friends-v2
.EXAMPLE
    C:\DauntlessRevived\bin\Update-DauntlessServer.ps1 -Rollback
#>
[CmdletBinding(SupportsShouldProcess = $true, DefaultParameterSetName = 'Ref')]
param(
    [string]$Root,
    [Parameter(ParameterSetName = 'Ref')][string]$Ref,
    [Parameter(ParameterSetName = 'Zip', Mandatory = $true)][string]$SourceZip,
    [Parameter(ParameterSetName = 'Zip')][string]$SourceCommit,
    [Parameter(ParameterSetName = 'Dir', Mandatory = $true)][string]$SourceDir,
    [Parameter(ParameterSetName = 'Rollback', Mandatory = $true)][switch]$Rollback,
    [switch]$Force,
    [int]$HealthTimeoutSec = 180
)
$ErrorActionPreference = 'Stop'
# Run over SSH there is no console buffer for a progress bar, and every Invoke-WebRequest here
# dies with 'Access is denied ... console output buffer' - which this script then reports as
# GitHub not knowing the ref. Updating a server remotely is the normal case, so turn it off.
$ProgressPreference = 'SilentlyContinue'
. "$PSScriptRoot\DauntlessServer.Common.ps1"

function Invoke-Kit([string]$Name, [string[]]$Arguments) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $out = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $P.Bin $Name) @Arguments 2>&1 | Out-String
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $old }
    foreach ($l in ($out -split "`r?`n")) { if ($l.Trim()) { Write-DRInfo $l } }
    return $code
}

# Healthy = the metagame answers /dauntless-status, and (public mode) the gateway answers ServerStatus
# over TLS pinned to the invite fingerprint.
function Test-Healthy {
    $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
    $metaUrl = 'http://{0}:{1}/dauntless-status' -f (Get-DRConfigValue $Cfg 'BindAddress' '127.0.0.1'), (Get-DRPort $Cfg 'metagame')
    $public = (Get-DRMode $Cfg) -eq 'Public'
    $fp = [string](Get-DRConfigValue $Cfg 'CertFingerprint' '')
    $gwUrl = 'https://127.0.0.1:{0}/undaunted/api/ServerStatus' -f (Get-DRPort $Cfg 'gateway')
    $why = ''
    while ((Get-Date) -lt $deadline) {
        $m = Invoke-DRHttp -Url $metaUrl -TimeoutSec 5
        if ($m.Status -eq 200) {
            if (-not $public) { return '' }
            $g = Invoke-DRHttp -Url $gwUrl -Fingerprint $fp -TimeoutSec 5
            if ($g.Status -eq 200) { return '' }
            $why = "gateway: $(if ($g.Status) { "HTTP $($g.Status)" } else { $g.Error })"
        } else { $why = "metagame: $(if ($m.Status) { "HTTP $($m.Status)" } else { $m.Error })" }
        Start-Sleep -Seconds 5
    }
    return $why
}

function Update-Kit([string]$From) {
    $kit = Join-Path $From 'deploy\windows-server'
    if (-not (Test-Path -LiteralPath (Join-Path $kit 'DauntlessServer.Common.ps1'))) { Write-DRWarn 'the new code has no deploy\windows-server; kit scripts left as they are'; return }
    foreach ($f in Get-ChildItem -LiteralPath $kit -File | Where-Object { $_.Extension -in '.ps1', '.vbs', '.md' }) { Copy-Item -LiteralPath $f.FullName -Destination $P.Bin -Force }
    New-Item -ItemType Directory -Force -Path (Join-Path $P.Bin 'lib') | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $kit 'lib') -File | Where-Object { $_.Extension -in '.js', '.cjs' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $P.Bin 'lib') -Force }
    Write-DROk "kit scripts in $($P.Bin) refreshed from the new code"
}

function Set-Commit([string]$Commit, [string]$RefName, [string]$Kind) {
    Set-DRConfigValue $Cfg 'Commit' $Commit
    Set-DRConfigValue $Cfg 'Ref' $RefName
    Set-DRConfigValue $Cfg 'Source' $Kind
    Set-DRConfigValue $Cfg 'UpdatedAt' (Get-Date).ToString('o')
    Save-DRConfig $Root $Cfg
    $meta = Read-DREnv $P.MetaEnv
    if ($meta.Count) {
        $meta['GIT_COMMIT'] = $Commit
        [void](Write-DREnv $P.MetaEnv $meta $script:DRSecretEnvHeader)
    }
}

# Real progression became the default in September 2026. Unless metagame.env says real or stub,
# players who played under the old stub start at Slayer level 1, and the metagame logs
# how many at startup. Repeat that line here, so a host who updates without reading the upgrade notes
# still sees it. Never fails the update.
function Read-SharedText([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $fs = New-Object IO.FileStream($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try { return (New-Object IO.StreamReader($fs)).ReadToEnd() } finally { $fs.Dispose() }
}

function Show-ProgressionUpgradeNotice([string]$MetaEnv, [string]$Log, [int]$WaitSec = 20) {
    try {
        # An empty or unknown value means real too, so only real and stub skip the check.
        $mode = ([string](Read-DREnv $MetaEnv)['PROGRESSION_MODE']).Trim().ToLowerInvariant()
        if ($mode -eq 'real' -or $mode -eq 'stub') { return }
        # The metagame logs the mode line and the notice together once it listens: wait for the mode
        # line, then a moment for the notice behind it.
        $text = Read-SharedText $Log
        for ($i = 0; $i -lt $WaitSec -and -not $text.Contains('Progression mode:'); $i++) { Start-Sleep -Seconds 1; $text = Read-SharedText $Log }
        if (-not $text.Contains('Progression mode:')) { return }
        Start-Sleep -Seconds 1
        $line = @((Read-SharedText $Log) -split "`r?`n" | Where-Object { $_.Contains('have no stored progression yet') }) | Select-Object -Last 1
        if (-not $line) { return }
        $msg = $line
        try { $m = ($line | ConvertFrom-Json).msg; if ($m) { $msg = [string]$m } } catch { }
        Write-DRWarn "metagame: $msg"
        Write-DRWarn 'Upgrade notes: https://mixutin.github.io/dauntless-revived/setup/upgrading.html (PROGRESSION_MODE=real or stub in metagame.env fixes the mode and skips this check)'
    } catch { Write-DRWarn "could not read the metagame log for the progression notice ($($_.Exception.Message))" }
}

$exitCode = 0
try {
    $Root = Resolve-DRRoot $Root $PSScriptRoot
    $P = Get-DRPaths $Root
    $Cfg = Get-DRConfig $Root
    $Sandbox = [bool](Get-DRConfigValue $Cfg 'Sandbox' $false)
    if (-not $Sandbox -and -not (Test-DRAdmin)) { Stop-DR 'Run this in an elevated PowerShell (Run as administrator).' }
    $NodeExe = Get-DRConfigValue $Cfg 'NodePath' 'node'
    $installed = Get-DRConfigValue $Cfg 'Commit' 'unknown'
    Write-DRStep "Updating $Root ($(Get-DRMode $Cfg) mode, installed code $installed)"

    if ($Rollback) {
        $prev = "$($P.App).prev"
        if (-not (Test-Path -LiteralPath (Join-Path $prev 'VERSION.json'))) { Stop-DR "There is no previous build ($prev)." }
        $pv = Get-Content -LiteralPath (Join-Path $prev 'VERSION.json') -Raw | ConvertFrom-Json
        if (-not $PSCmdlet.ShouldProcess("$($P.App)", "Switch back to the previous build ($($pv.commit))")) { exit 0 }
        [void](Invoke-Kit 'Stack.ps1' @('stop', '-Root', $Root))
        $failed = "$($P.App).rolledback"
        if (Test-Path -LiteralPath $failed) { Remove-Item -LiteralPath $failed -Recurse -Force }
        Rename-Item -LiteralPath $P.App -NewName (Split-Path $failed -Leaf)
        Rename-Item -LiteralPath $prev -NewName (Split-Path $P.App -Leaf)
        Set-Commit $pv.commit $pv.ref $pv.source
        Update-Kit $P.App
        [void](Invoke-Kit 'Stack.ps1' @('start', '-Root', $Root, '-NoBackup'))
        $why = Test-Healthy
        if ($why) { Stop-DR "The previous build does not come up either ($why). See $($P.Logs)." }
        Write-DROk "back on $($pv.commit); the build you left is in $failed"
        exit 0
    }

    # 1. Source
    $commit = 'unknown'; $refUsed = ''; $kind = ''; $from = $null
    if ($SourceZip) {
        if (-not (Test-Path -LiteralPath $SourceZip)) { Stop-DR "Source zip not found: $SourceZip" }
        if ($SourceCommit -and $SourceCommit -notmatch '^[0-9a-f]{7,40}(-dirty|-worktree)?$') { Stop-DR '-SourceCommit must be a git commit id.' }
        $kind = 'zip'
        $commit = if ($SourceCommit) { $SourceCommit } else { 'zip-' + (Get-DRSha256 $SourceZip).Substring(0, 12).ToLowerInvariant() }
    } elseif ($SourceDir) {
        $kind = 'folder'
        $from = [IO.Path]::GetFullPath($SourceDir)
        if (-not (Test-Path -LiteralPath (Join-Path $from 'UndauntedMetagame\package.json'))) { Stop-DR "$from is not a Dauntless Revived source folder." }
        $git = Get-Command git.exe -ErrorAction SilentlyContinue
        if ($git -and (Test-Path -LiteralPath (Join-Path $from '.git'))) {
            $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            try {
                $commit = (& git.exe -C $from rev-parse HEAD 2>$null | Out-String).Trim()
                if ((& git.exe -C $from status --porcelain 2>$null | Out-String).Trim()) { $commit = "$commit-dirty" }
            } finally { $ErrorActionPreference = $old }
        }
    } else {
        $refUsed = if ($Ref) { $Ref } else { $DRRepo.PinnedRef }
        if ($refUsed -notmatch '^[A-Za-z0-9._/-]{1,100}$') { Stop-DR "-Ref '$refUsed' does not look like a branch, tag or commit." }
        $kind = 'github'
        try {
            Enable-DRTls12
            $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 -Uri ("https://api.github.com/repos/{0}/{1}/commits/{2}" -f $DRRepo.Owner, $DRRepo.Name, $refUsed) -Headers @{ Accept = 'application/vnd.github.sha' }
            # Windows PowerShell 5.1 hands back .Content as a byte[] unless it decides the
            # response is text, and "$([byte[]])" stringifies to "57 57 51 ..." - which fails the
            # SHA check below and looks like an unknown ref. Decode it before reading it.
            $body = $r.Content
            if ($body -is [byte[]]) { $body = [Text.Encoding]::UTF8.GetString($body) }
            $commit = "$body".Trim()
        } catch { Stop-DR "GitHub does not know the ref '$refUsed' ($($_.Exception.Message))." }
        if ($commit -notmatch '^[0-9a-f]{40}$') { Stop-DR "Could not resolve '$refUsed' to a commit." }
    }
    Write-DROk "new code: $kind $commit"
    if ($commit -eq $installed -and $commit -notmatch '-(dirty|worktree)$' -and -not $Force) { Write-DROk 'that code is already installed; nothing to do (-Force rebuilds anyway)'; exit 0 }

    # 2. Build next to the running server
    Write-DRStep 'Building (the server keeps running)'
    if (-not $PSCmdlet.ShouldProcess("$($P.App).new", "Build $commit with npm ci + npm run build")) { exit 0 }
    if ($kind -eq 'github') {
        $zip = Join-Path $P.Downloads "source-$commit.zip"
        if (-not (Test-Path -LiteralPath $zip)) { Save-DRDownload ("https://codeload.github.com/{0}/{1}/zip/{2}" -f $DRRepo.Owner, $DRRepo.Name, $commit) $zip }
        $from = Expand-DRSourceZip $P $zip $commit.Substring(0, 12)
    } elseif ($kind -eq 'zip') {
        $from = Expand-DRSourceZip $P ([IO.Path]::GetFullPath($SourceZip)) 'upload'
    }
    $ver = [ordered]@{ commit = $commit; ref = $refUsed; source = $kind; sourceUrl = $DRRepo.Url; installedAt = (Get-Date).ToString('o') }
    $built = Build-DRApp -Paths $P -From $from -NodeExe $NodeExe -Version $ver
    foreach ($c in @(Get-DRConfigValue $Cfg 'Components' @())) {
        if ($built -notcontains $DRComponents[$c].Dir) { Stop-DR "The new code has no $($DRComponents[$c].Dir), which this server runs ($c). Not switching." }
    }
    foreach ($dll in $DRPinned.Dlls.Keys) {
        $inGame = Join-Path (Split-Path (Join-Path (Get-DRConfigValue $Cfg 'GameDir' '') $DRPinned.ExeRelative) -Parent) $dll
        if (-not $Sandbox -and (-not (Test-Path -LiteralPath $inGame) -or (Get-DRSha256 $inGame) -ne $DRPinned.Dlls[$dll])) { Write-DRWarn "$dll in the game folder is missing or changed; run Install-DauntlessServer.ps1 to repair it" }
    }

    # 3. Switch
    Write-DRStep 'Switching'
    if ((Invoke-Kit 'Backup-DauntlessServer.ps1' @('-Root', $Root)) -ne 0) { Stop-DR 'The backup failed; the running server was not touched. The new build stays in app.new.' }
    [void](Invoke-Kit 'Stack.ps1' @('stop', '-Root', $Root, '-NoBackup'))
    $prevCommit = $installed; $prevRef = Get-DRConfigValue $Cfg 'Ref' ''; $prevKind = Get-DRConfigValue $Cfg 'Source' ''
    try { Switch-DRApp $P }
    catch {
        # Nothing was switched (a file in use?): bring the old build back up before giving up.
        if (-not (Test-Path -LiteralPath $P.App) -and (Test-Path -LiteralPath "$($P.App).prev")) { Rename-Item -LiteralPath "$($P.App).prev" -NewName (Split-Path $P.App -Leaf) }
        [void](Invoke-Kit 'Stack.ps1' @('start', '-Root', $Root, '-NoBackup'))
        Stop-DR "Could not put the new build in place ($($_.Exception.Message)); the server runs $prevCommit again. The new build stays in app.new."
    }
    Set-Commit $commit $refUsed $kind
    Update-Kit $from
    Write-DROk "code $commit in place (the previous build is in app.prev)"
    [void](Invoke-Kit 'Stack.ps1' @('start', '-Root', $Root, '-NoBackup'))

    # 4. Check, or roll back
    Write-DRStep 'Checking'
    $why = Test-Healthy
    if (-not $why) {
        Write-DROk "the server is up on $commit"
        # Code updates preserve explicit opt-outs, including CHAT=0 written by older installers.
        # A working HTTP backend is not proof that in-game chat started.
        $chatState = Get-DRChatState $P $Cfg
        if ($chatState -like 'listening *') { Write-DROk "chat: $chatState (listener only; test an in-game message)" }
        else { Write-DRWarn "chat: $chatState. When nobody is playing, run $($P.Bin)\Set-Chat.ps1 -On; if settings already say on, restart the metagame and check its chat: log lines." }
        Show-ProgressionUpgradeNotice $P.MetaEnv (Join-Path $P.Logs 'metagame.out.log')
    } else {
        Write-DRWarn "the new code did not come up ($why); switching back to $prevCommit"
        [void](Invoke-Kit 'Stack.ps1' @('stop', '-Root', $Root, '-NoBackup'))
        $failed = "$($P.App).failed"
        if (Test-Path -LiteralPath $failed) { Remove-Item -LiteralPath $failed -Recurse -Force }
        Rename-Item -LiteralPath $P.App -NewName (Split-Path $failed -Leaf)
        Rename-Item -LiteralPath "$($P.App).prev" -NewName (Split-Path $P.App -Leaf)
        Set-Commit $prevCommit $prevRef $prevKind
        Update-Kit $P.App
        [void](Invoke-Kit 'Stack.ps1' @('start', '-Root', $Root, '-NoBackup'))
        $why2 = Test-Healthy
        if ($why2) { Stop-DR "Rolled back, but the previous build does not come up either ($why2). The database backup from before the update is the newest folder in $($P.Backups)." }
        Stop-DR "Update failed and was rolled back; the server runs $prevCommit again. The failed build is in $failed (logs in $($P.Logs))."
    }
} catch {
    if ("$_" -notmatch '^DRFAIL:') { Write-Host "   FAIL  $_" -ForegroundColor Red; Write-Host "         at $($_.InvocationInfo.PositionMessage)" }
    $exitCode = 1
}
exit $exitCode
