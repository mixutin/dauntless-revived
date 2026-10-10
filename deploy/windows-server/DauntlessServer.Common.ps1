# Dauntless Revived - shared helpers for the Windows Server deployment kit.
# Dot-sourced by every script in this folder:  . "$PSScriptRoot\DauntlessServer.Common.ps1"
#
# Windows PowerShell 5.1. ASCII only (5.1 reads BOM-less scripts as ANSI).
# Nothing in here prints a key, a token or a .env value.

# ---------------------------------------------------------------------------------------------
# Pinned facts. Change them only together with the matching files.
# ---------------------------------------------------------------------------------------------
$script:DRPinned = @{
    # The verified Dauntless 1.4.4 build (roadmap decision 9) and its main executable.
    GameZipSha256   = '556B9A648A5E5E7E11B6F8DD3D80FF8E88FCEB0D3448297AAF47CE7BF756BC6D'
    GameZipBytes    = 10479214119
    ExeSha256       = 'D3D41E614908D2BEFD518B27046D9822D6130EF12BA3504BABBDB786BEF9CFF4'
    ExeRelative     = 'Archon\Binaries\Win64\Dauntless-Win64-Shipping.exe'
    Build           = 'dauntless_rel-1.4.4_Shipping_2020-10-28_20-11-15_239827'
    Changelist      = '239827'
    # Undaunted's prebuilt DLLs, kept in UndauntedLauncher/assets/ (same pins as friend-kit/).
    Dlls            = [ordered]@{
        'dxgi.dll'                    = '9A431D7B6FD20C43FA92BEBD91C3BC023EC7A3FCBC52871C41F4DF293D4B0D1F'
        'UndauntedInternalServer.dll' = 'A090E8B25044647CE409B313525501DA578D632D3FCB9EB351F020CA94FA64FB'
    }
    # Node.js LTS: the version the fork is developed and tested on. better-sqlite3 is a native
    # module built for this Node major version. SHA-256 from nodejs.org/dist/v24.19.0/SHASUMS256.txt;
    # the installer also re-reads that file and requires both to agree.
    NodeVersion     = '24.19.0'
    NodeMsiSha256   = 'F0F66C2A80C08A30A5AB5179EE9EA9E45F9B46289436A8CC87FF833B852DB351'
    # Tailscale (private mode only): official MSI from pkgs.tailscale.com; SHA-256 from the .sha256
    # file next to it.
    TailscaleVersion   = '1.102.4'
    TailscaleMsiSha256 = '80EB007E39DFEBE17299FA1A09C79A8E1D934F76E0246C0817EBE3AF675B7EF6'
    # Microsoft redistributables change without notice, so they are checked by their Authenticode
    # signature (must be valid and issued to Microsoft Corporation). Known DirectX package hashes are
    # reported for information.
    VcRedistUrl     = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
    DirectXUrl      = 'https://download.microsoft.com/download/8/4/A/84A35BF1-DAFE-4AE8-82AF-AD2AE20B6B14/directx_Jun2010_redist.exe'
    DirectXKnownSha256 = @('053F76DCBB28802E23341B6A787E3B0791C0FA5C8D4D011B1044172DBF89C73B',
                           '8746EE1A84A083A90E37899D71D50D5C7C015E69688A466AA80447F011780C0D')
}

$script:DRRepo = @{
    Owner     = 'mixutin'
    Name      = 'dauntless-revived'
    Url       = 'https://github.com/mixutin/dauntless-revived'
    # Default code version for installs that do not run from a checkout and get no source zip. Tag
    # the version you run (roadmap 1.13) and put the tag here; -Ref overrides it.
    PinnedRef = 'friends-v1'
}

$script:DRNames = @{
    ServiceUser    = 'dauntless'
    StackTask      = 'Dauntless Revived stack'
    AllowlistTask  = 'Dauntless Revived allowlist'
    BackupTask     = 'Dauntless Revived backup'
    FirewallGroup  = 'Dauntless Revived'
    # The one rule the allowlist helper keeps up to date (shared contract C3). The helper finds it by
    # its Name (UndauntedGateway/src/allowlist/firewall.ts) and disables any other rule that uses the
    # same display name, so the installer creates it under exactly this Name.
    AllowlistRule     = 'Dauntless Revived game ports (allowlist)'
    AllowlistRuleName = 'DauntlessRevived-GamePorts-Allowlist'
}

# Ports. Public mode: only the gateway port is reachable from outside; everything else listens on
# 127.0.0.1. The relay port is where each friend's launcher listens (fixed by contract C4), so the
# QoS URL the metagame hands out is the same for everyone.
$script:DRDefaultPorts = [ordered]@{ metagame = 61000; deploy = 61001; content = 61002; gateway = 443; allowlist = 61005 }
$script:DRSandboxPorts = [ordered]@{ metagame = 62000; deploy = 62001; content = 62002; gateway = 62443; allowlist = 62005 }
$script:DRRelayPort = 61000
$script:DRChatPort = 61099

# The header of the .env files that hold secrets. Every script that writes one uses this, so a file
# never looks changed only because another script wrote it (the text is the installer's since the start,
# so files on existing installs match it).
$script:DRSecretEnvHeader = @('Dauntless Revived - written by Install-DauntlessServer.ps1. Holds secrets: never share, commit or paste it.')
$script:DRUdpBegin = 8770
$script:DRUdpEnd = 8777

# Well-known SIDs (names differ between Windows languages, SIDs do not).
$script:SidAdministrators = 'S-1-5-32-544'
$script:SidSystem         = 'S-1-5-18'
$script:SidUsers          = 'S-1-5-32-545'

# The modules the kit uses, loaded up front: auto-loading them later under -WhatIf would print a
# "What if: Set Alias" line for every alias they define. ($WhatIfPreference here is function-local.)
function Import-DRModules {
    $WhatIfPreference = $false
    foreach ($m in 'CimCmdlets', 'NetTCPIP', 'NetSecurity', 'ScheduledTasks', 'Microsoft.PowerShell.LocalAccounts') {
        Import-Module $m -ErrorAction SilentlyContinue 3>$null
    }
}
Import-DRModules

# ---------------------------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------------------------
function Write-DRStep([string]$Text) { Write-Host ''; Write-Host "== $Text" -ForegroundColor Cyan }
function Write-DROk([string]$Text)   { Write-Host "   OK    $Text" -ForegroundColor Green }
function Write-DRInfo([string]$Text) { Write-Host "         $Text" }
function Write-DRWarn([string]$Text) { Write-Host "   WARN  $Text" -ForegroundColor Yellow }
function Write-DRSkip([string]$Text) { Write-Host "   SKIP  $Text" -ForegroundColor DarkGray }
function Stop-DR([string]$Text) {
    Write-Host "   FAIL  $Text" -ForegroundColor Red
    throw "DRFAIL: $Text"
}

# ---------------------------------------------------------------------------------------------
# Paths and configuration
# ---------------------------------------------------------------------------------------------
function Get-DRPaths([string]$Root) {
    $Root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $data = Join-Path $Root 'data'
    [pscustomobject]@{
        Root         = $Root
        App          = Join-Path $Root 'app'
        Bin          = Join-Path $Root 'bin'
        Game         = Join-Path $Root 'game'
        Data         = $data
        Config       = Join-Path $data 'config'
        Keys         = Join-Path $data 'keys'
        Tls          = Join-Path $data 'tls'
        Logs         = Join-Path $data 'logs'
        Run          = Join-Path $data 'run'
        Branding     = Join-Path $data 'branding'
        Backups      = Join-Path $Root 'backups'
        Downloads    = Join-Path $Root 'downloads'
        Staging      = Join-Path $Root 'staging'
        ServerJson   = Join-Path $data 'config\server.json'
        MetaEnv      = Join-Path $data 'config\metagame.env'
        DeployEnv    = Join-Path $data 'config\deployserver.env'
        ContentEnv   = Join-Path $data 'config\content.env'
        GatewayEnv   = Join-Path $data 'config\gateway.env'
        AllowlistEnv = Join-Path $data 'config\allowlist.env'
        News         = Join-Path $data 'config\news.json'
        OwnerKey     = Join-Path $data 'keys\owner.key'
        GsKey        = Join-Path $data 'keys\gameserver.key'
        GatewayCert  = Join-Path $data 'tls\gateway-cert.pem'
        GatewayKey   = Join-Path $data 'tls\gateway-key.pem'
        Db           = Join-Path $data 'undaunted.db'
        StopFlag     = Join-Path $data 'run\stopped.flag'
    }
}

# Scripts live in <root>\bin on an installed server and in deploy\windows-server in the repository.
function Resolve-DRRoot([string]$Root, [string]$ScriptDir) {
    if ($Root) { return [IO.Path]::GetFullPath($Root).TrimEnd('\') }
    $parent = Split-Path $ScriptDir -Parent
    if (Test-Path -LiteralPath (Join-Path $parent 'data\config\server.json')) { return $parent }
    return 'C:\DauntlessRevived'
}

function Get-DRConfig([string]$Root) {
    $p = Get-DRPaths $Root
    if (-not (Test-Path -LiteralPath $p.ServerJson)) {
        Stop-DR "No server configuration at $($p.ServerJson). Run Install-DauntlessServer.ps1 first, or pass -Root."
    }
    return (Get-Content -LiteralPath $p.ServerJson -Raw | ConvertFrom-Json)
}

function Save-DRConfig([string]$Root, $Config) {
    $p = Get-DRPaths $Root
    $json = $Config | ConvertTo-Json -Depth 6
    Write-DRText -Path $p.ServerJson -Text $json
}

function Get-DRConfigValue($Config, [string]$Name, $Default) {
    if ($null -eq $Config) { return $Default }
    $prop = $Config.PSObject.Properties[$Name]
    if ($null -eq $prop -or $null -eq $prop.Value -or "$($prop.Value)" -eq '') { return $Default }
    return $prop.Value
}

function Set-DRConfigValue($Config, [string]$Name, $Value) {
    if ($Config.PSObject.Properties[$Name]) { $Config.$Name = $Value }
    else { $Config | Add-Member -NotePropertyName $Name -NotePropertyValue $Value }
}

# Mode of an install: 'Public' (gateway on a public IP) or 'Private' (Tailscale). Installs made
# before public mode existed have no Mode and are private.
function Get-DRMode($Config) { return [string](Get-DRConfigValue $Config 'Mode' 'Private') }

function Get-DRPort($Config, [string]$Name) {
    $ports = Get-DRConfigValue $Config 'Ports' $null
    return [int](Get-DRConfigValue $ports $Name $script:DRDefaultPorts[$Name])
}

# Text chat (roadmap 3.10, docs/findings/chat.md): the metagame's own chat listener on loopback, which
# the gateway forwards the game's WebSocket upgrades to. One port for both, so they can never disagree.
# A sandbox uses 62099, never a development PC's own 61099.
function Get-DRChatPort([bool]$Sandbox) {
    if ($Sandbox) { return 62099 }
    return $script:DRChatPort
}

function Get-DRGatewayWsUrl([bool]$Sandbox) { return "http://127.0.0.1:$(Get-DRChatPort $Sandbox)" }

# The chat setting of an install: -Chat when given, else "Chat" in server.json, else On.
function Resolve-DRChat([string]$Requested, $Config) {
    if ($Requested -eq 'On' -or $Requested -eq 'Off') { return $Requested }
    if ([string](Get-DRConfigValue $Config 'Chat' '') -eq 'Off') { return 'Off' }
    return 'On'
}

# The chat keys of metagame.env (public mode): CHAT=1|0, always on 127.0.0.1, on the gateway's port.
function Set-DRChatEnv($EnvMap, [string]$Chat, [bool]$Sandbox) {
    $EnvMap['CHAT'] = $(if ($Chat -eq 'On') { '1' } else { '0' })
    $EnvMap['CHAT_BIND_HOST'] = '127.0.0.1'
    $EnvMap['CHAT_PORT'] = "$(Get-DRChatPort $Sandbox)"
}

# One status line: "listening 127.0.0.1:61099", "off", or on but not listening. metagame.env is readable
# by administrators, SYSTEM and the service account only.
function Get-DRChatState($Paths, $Config) {
    $envMap = $null
    try { $envMap = Read-DREnv $Paths.MetaEnv } catch { return 'unknown (run this elevated to read metagame.env)' }
    $port = Get-DRChatPort ([bool](Get-DRConfigValue $Config 'Sandbox' $false))
    if ($envMap['CHAT_PORT'] -match '^\d{1,5}$') { $port = [int]$envMap['CHAT_PORT'] }
    if (-not (Test-Path -LiteralPath $Paths.MetaEnv)) { return 'unknown (metagame.env missing)' }
    $chatValue = ([string]$envMap['CHAT']).Trim()
    if ($chatValue -ne '' -and $chatValue -ne '1') { return 'off (CHAT setting; use Set-Chat.ps1 -On)' }
    $listening = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' }).Count -gt 0
    if ($listening) { return "listening 127.0.0.1:$port" }
    return 'on in metagame.env but not listening (see the metagame log)'
}

# UTF-8 without BOM (Node reads .env and JSON as UTF-8; a BOM would end up in the first key).
function Write-DRText([string]$Path, [string]$Text) {
    $dir = Split-Path $Path -Parent
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

# ---------------------------------------------------------------------------------------------
# .env files: read into an ordered map, write back with our keys first. Values are never printed.
# ---------------------------------------------------------------------------------------------
function Read-DREnv([string]$Path) {
    $map = [ordered]@{}
    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return $map }
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        $t = $line.Trim()
        if ($t -eq '' -or $t.StartsWith('#')) { continue }
        $i = $t.IndexOf('=')
        if ($i -lt 1) { continue }
        $k = $t.Substring(0, $i).Trim()
        if ($k -match '^export\s+') { $k = ($k -replace '^export\s+', '') }
        if ($k -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { continue }
        $v = $t.Substring($i + 1).Trim()
        if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) {
            $v = $v.Substring(1, $v.Length - 2)
        }
        $map[$k] = $v
    }
    return $map
}

# Values with spaces are double-quoted. Values that could not survive Node's .env parser
# (quotes, backslashes, line breaks) are refused instead of written wrongly.
function Format-DREnvValue([string]$Value) {
    if ($Value -match '["\\\r\n]') { throw "Refusing to write a .env value containing a quote, backslash or line break." }
    if ($Value -match '[\s#''`]') { return '"' + $Value + '"' }
    return $Value
}

# Returns $true if the file changed.
function Write-DREnv([string]$Path, $Map, [string[]]$Header) {
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($h in $Header) { $lines.Add("# $h") }
    foreach ($k in $Map.Keys) { $lines.Add("$k=" + (Format-DREnvValue ([string]$Map[$k]))) }
    $text = ($lines -join "`r`n") + "`r`n"
    if ((Test-Path -LiteralPath $Path) -and ([IO.File]::ReadAllText($Path) -ceq $text)) { return $false }
    Write-DRText -Path $Path -Text $text
    return $true
}

# ---------------------------------------------------------------------------------------------
# Hashes, randomness, identities
# ---------------------------------------------------------------------------------------------
# .NET directly: Get-FileHash honours -WhatIf and would return nothing in a what-if run.
function Get-DRSha256([string]$Path) {
    $sha = [Security.Cryptography.SHA256]::Create()
    $fs = New-Object IO.FileStream($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read, 4MB)
    try { return ([BitConverter]::ToString($sha.ComputeHash($fs)) -replace '-', '') } finally { $fs.Dispose(); $sha.Dispose() }
}

function ConvertTo-DRHex([byte[]]$Bytes) { return (-join ($Bytes | ForEach-Object { $_.ToString('x2') })) }

function Get-DRRandomBytes([int]$Count) {
    $b = New-Object byte[] $Count
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($b) } finally { $rng.Dispose() }
    return ,$b
}

function New-DRHexSecret([int]$Bytes = 24) { return (ConvertTo-DRHex (Get-DRRandomBytes $Bytes)) }

# Unambiguous alphabet (no 0/O, 1/I/L), rejection sampling so every symbol is equally likely.
function New-DRInviteCode([int]$Groups = 3, [int]$GroupLength = 4) {
    $alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
    $limit = 256 - (256 % $alphabet.Length)
    $parts = @()
    for ($g = 0; $g -lt $Groups; $g++) {
        $s = ''
        while ($s.Length -lt $GroupLength) {
            foreach ($b in (Get-DRRandomBytes 16)) {
                if ($b -lt $limit -and $s.Length -lt $GroupLength) { $s += $alphabet[$b % $alphabet.Length] }
            }
        }
        $parts += $s
    }
    return ($parts -join '-')
}

function Test-DRAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-DRCurrentSid { [Security.Principal.WindowsIdentity]::GetCurrent().User.Value }

function Test-DRRunningAsSystem { return ((Get-DRCurrentSid) -eq $script:SidSystem) }

function Get-DRLocalUserSid([string]$Name) {
    try {
        return (New-Object Security.Principal.NTAccount("$env:COMPUTERNAME\$Name")).Translate([Security.Principal.SecurityIdentifier]).Value
    } catch { return $null }
}

# ---------------------------------------------------------------------------------------------
# ACLs: replace the whole DACL with exactly the given grants (inheritance from the parent off).
# $Grants: SID -> FullControl | Modify | ReadAndExecute | Read
# ---------------------------------------------------------------------------------------------
# Only the access list is read and written (Get-Acl/Set-Acl would also write the owner and audit
# sections, which needs privileges beyond changing permissions).
function Set-DRAcl([string]$Path, [hashtable]$Grants) {
    $item = Get-Item -LiteralPath $Path -Force
    $isDir = $item.PSIsContainer
    $acl = $item.GetAccessControl([Security.AccessControl.AccessControlSections]::Access)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($r in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) { [void]$acl.RemoveAccessRuleSpecific($r) }
    foreach ($sid in $Grants.Keys) {
        $id = New-Object Security.Principal.SecurityIdentifier($sid)
        if ($isDir) { $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' }
        else { $inherit = [Security.AccessControl.InheritanceFlags]::None }
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($id, [Security.AccessControl.FileSystemRights]$Grants[$sid], $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($rule)
    }
    $item.SetAccessControl($acl)
}

# ---------------------------------------------------------------------------------------------
# Reparse points (junctions and symbolic links). Service-writable folders (data\run, backups,
# data\logs) can be turned into junctions, or seeded with object-manager symlinks, by a compromised
# game server running as the service account. A privileged reader (SYSTEM or an administrator) that
# then deletes or overwrites through such a path acts on whatever it points at: a local
# privilege-escalation primitive. These helpers let privileged code refuse to follow reparse points.
# ---------------------------------------------------------------------------------------------
function Test-DRReparsePoint([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    try { $it = Get-Item -LiteralPath $Path -Force -ErrorAction Stop } catch { return $false }
    return [bool]($it.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

# Deletes a file or a whole directory tree without ever descending into a reparse point: a junction or
# symlink met on the way is removed as a link (its target is left untouched), never followed. Windows
# PowerShell 5.1's Remove-Item -Recurse follows junctions, so privileged deletes use this instead.
function Remove-DRItemNoFollow([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        if ($item.PSIsContainer) { [IO.Directory]::Delete($item.FullName, $false) } else { [IO.File]::Delete($item.FullName) }
        return
    }
    if ($item.PSIsContainer) {
        foreach ($child in @(Get-ChildItem -LiteralPath $item.FullName -Force -ErrorAction SilentlyContinue)) {
            Remove-DRItemNoFollow $child.FullName
        }
        [IO.Directory]::Delete($item.FullName, $false)
    } else {
        [IO.File]::Delete($item.FullName)
    }
}

# Short human-readable description of a DACL, for status output and tests.
function Get-DRAclSummary([string]$Path) {
    $acl = Get-Acl -LiteralPath $Path
    $rules = foreach ($r in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        $name = $r.IdentityReference.Value
        try { $name = $r.IdentityReference.Translate([Security.Principal.NTAccount]).Value } catch {}
        '{0}:{1}{2}' -f $name, $r.FileSystemRights, $(if ($r.IsInherited) { '(inherited)' } else { '' })
    }
    return ('protected=' + $acl.AreAccessRulesProtected + ' ' + ($rules -join '; '))
}

# ---------------------------------------------------------------------------------------------
# Native commands: quoted argument strings, output to log files, exit code back.
# ---------------------------------------------------------------------------------------------
function ConvertTo-DRArg([string]$Arg) {
    if ($Arg -eq '') { return '""' }
    if ($Arg -notmatch '[\s"]') { return $Arg }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    $bs = 0
    foreach ($ch in $Arg.ToCharArray()) {
        if ($ch -eq '\') { $bs++; continue }
        if ($ch -eq '"') { [void]$sb.Append('\' * (2 * $bs + 1)); [void]$sb.Append('"'); $bs = 0; continue }
        if ($bs) { [void]$sb.Append('\' * $bs); $bs = 0 }
        [void]$sb.Append($ch)
    }
    if ($bs) { [void]$sb.Append('\' * (2 * $bs)) }
    [void]$sb.Append('"')
    return $sb.ToString()
}

function ConvertTo-DRArgString([string[]]$Arguments) { return (($Arguments | ForEach-Object { ConvertTo-DRArg $_ }) -join ' ') }

# A PowerShell single-quoted literal (for commands built as text, e.g. -EncodedCommand).
function ConvertTo-DRPsLiteral([string]$Text) { return "'" + $Text.Replace("'", "''") + "'" }

# Runs a program to completion with stdout/stderr in <LogBase>.out.log / .err.log. Returns the exit code.
# -LowPriority runs it below normal priority (builds while friends are playing).
function Invoke-DRNative {
    param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory, [string]$LogBase, [hashtable]$Environment, [switch]$LowPriority)
    if (-not $WorkingDirectory) { $WorkingDirectory = (Get-Location).Path }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = ConvertTo-DRArgString $Arguments
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    if ($Environment) { foreach ($k in $Environment.Keys) { $psi.EnvironmentVariables[$k] = [string]$Environment[$k] } }
    $p = [System.Diagnostics.Process]::Start($psi)
    if ($LowPriority) { try { $p.PriorityClass = 'BelowNormal' } catch {} }
    # Both pipes are drained on thread-pool tasks, so a chatty program can never block on a full pipe.
    $outTask = $p.StandardOutput.ReadToEndAsync()
    $errTask = $p.StandardError.ReadToEndAsync()
    $p.WaitForExit()
    $out = $outTask.Result
    $err = $errTask.Result
    if ($LogBase) {
        $dir = Split-Path $LogBase -Parent
        if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        Write-DRText -Path "$LogBase.out.log" -Text $out
        Write-DRText -Path "$LogBase.err.log" -Text $err
    }
    $code = $p.ExitCode
    $p.Dispose()
    return $code
}

function Show-DRLogTail([string]$LogBase, [int]$Lines = 15) {
    foreach ($f in @("$LogBase.err.log", "$LogBase.out.log")) {
        if (Test-Path -LiteralPath $f) {
            $tail = @(Get-Content -LiteralPath $f -Tail $Lines | Where-Object { $_.Trim() })
            if ($tail.Count) { Write-DRInfo "--- last lines of $f"; $tail | ForEach-Object { Write-DRInfo $_ } }
        }
    }
}

# ---------------------------------------------------------------------------------------------
# TLS and certificate pinning.
# The gateway's certificate is self-signed; clients trust exactly one certificate, identified by the
# SHA-256 of its DER encoding (the "fp" of a v2 invite). No CA or host name check is involved.
# ---------------------------------------------------------------------------------------------
function Enable-DRTls12 {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}

function Initialize-DRPin {
    if ('DRKit.Pin' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
namespace DRKit {
    // One instance per request. The callback runs on whatever thread does the handshake, so it is
    // plain C# (a PowerShell script block there has no runspace).
    public sealed class Pin {
        private readonly string expected;
        public string Seen = "";
        public Pin(string fingerprint) { expected = (fingerprint ?? "").ToLowerInvariant(); }
        public bool Check(object sender, X509Certificate certificate, X509Chain chain, SslPolicyErrors errors) {
            if (certificate == null) { Seen = ""; return false; }
            using (SHA256 sha = SHA256.Create()) {
                byte[] digest = sha.ComputeHash(certificate.GetRawCertData());
                Seen = BitConverter.ToString(digest).Replace("-", "").ToLowerInvariant();
            }
            return expected.Length == 64 && String.Equals(Seen, expected, StringComparison.Ordinal);
        }
        public RemoteCertificateValidationCallback Callback { get { return new RemoteCertificateValidationCallback(Check); } }
    }
}
'@
}

function Test-DRFingerprint([string]$Fingerprint) { return ($Fingerprint -cmatch '^[0-9a-f]{64}$') }

# SHA-256 of the first certificate in a PEM file, as 64 lowercase hex characters.
function Get-DRCertFingerprint([string]$PemPath) {
    $text = [IO.File]::ReadAllText($PemPath)
    $m = [regex]::Match($text, '-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----')
    if (-not $m.Success) { throw "No certificate in $PemPath" }
    $der = [Convert]::FromBase64String(($m.Groups[1].Value -replace '\s', ''))
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return (ConvertTo-DRHex $sha.ComputeHash($der)) } finally { $sha.Dispose() }
}

# Subject alternative names and expiry of a PEM certificate (for status output).
function Get-DRCertInfo([string]$PemPath) {
    $text = [IO.File]::ReadAllText($PemPath)
    $m = [regex]::Match($text, '-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----')
    if (-not $m.Success) { return $null }
    $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2 (, [Convert]::FromBase64String(($m.Groups[1].Value -replace '\s', '')))
    $san = ''
    foreach ($ext in $cert.Extensions) { if ($ext.Oid.Value -eq '2.5.29.17') { $san = $ext.Format($false) } }
    return [pscustomobject]@{ NotAfter = $cert.NotAfter; NotBefore = $cert.NotBefore; San = $san; Algorithm = $cert.SignatureAlgorithm.FriendlyName }
}

# ---------------------------------------------------------------------------------------------
# HTTP with a hard time limit (a wrong listener must fail fast), no proxy (addresses must never go
# through a system proxy), and status codes back instead of exceptions. https:// URLs need
# -Fingerprint: the connection is refused unless the server's certificate has exactly that SHA-256.
# ---------------------------------------------------------------------------------------------
function Invoke-DRHttp {
    param([string]$Method = 'GET', [string]$Url, [hashtable]$Headers, $Body, [int]$TimeoutSec = 10, [string]$Fingerprint)
    $pin = $null
    $req = [Net.HttpWebRequest]::Create($Url)
    if ($Url -match '^https://') {
        if (-not (Test-DRFingerprint $Fingerprint)) { return [pscustomobject]@{ Status = 0; Text = ''; Json = $null; Error = 'https needs a certificate fingerprint (64 lowercase hex characters)'; SeenFingerprint = '' } }
        Enable-DRTls12
        Initialize-DRPin
        $pin = New-Object DRKit.Pin($Fingerprint)
        $req.ServerCertificateValidationCallback = $pin.Callback
    }
    $req.Method = $Method
    $req.Timeout = $TimeoutSec * 1000
    $req.ReadWriteTimeout = $TimeoutSec * 1000
    $req.Proxy = $null
    $req.KeepAlive = $false
    $req.AllowAutoRedirect = $false
    $req.Accept = 'application/json'
    $req.UserAgent = 'DauntlessRevived-ServerKit'
    if ($Headers) { foreach ($k in $Headers.Keys) { $req.Headers[$k] = [string]$Headers[$k] } }
    $seen = { if ($pin) { $pin.Seen } else { '' } }
    try {
        if ($null -ne $Body) {
            $json = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Compress -Depth 6 }
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            $req.ContentType = 'application/json'
            $req.ContentLength = $bytes.Length
            $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
        } elseif ($Method -ne 'GET' -and $Method -ne 'HEAD') {
            $req.ContentLength = 0
        }
        $resp = $req.GetResponse()
    } catch {
        $ex = $_.Exception
        while ($ex -and -not ($ex -is [Net.WebException])) { $ex = $ex.InnerException }
        if ($ex -and $ex.Response) { $resp = $ex.Response }
        else {
            $msg = if ($ex) { $ex.Message } else { $_.Exception.Message }
            if ($pin -and $pin.Seen -and $pin.Seen -ne $Fingerprint) { $msg = "certificate fingerprint mismatch: the server presented $($pin.Seen), expected $Fingerprint" }
            return [pscustomobject]@{ Status = 0; Text = ''; Json = $null; Error = $msg; SeenFingerprint = (& $seen) }
        }
    }
    $status = [int]$resp.StatusCode
    $text = ''
    try {
        $rs = $resp.GetResponseStream()
        $sr = New-Object IO.StreamReader($rs, [Text.Encoding]::UTF8)
        $text = $sr.ReadToEnd()
        $sr.Close()
    } catch {} finally { $resp.Close() }
    $parsed = $null
    if ($text) { try { $parsed = $text | ConvertFrom-Json } catch {} }
    return [pscustomobject]@{ Status = $status; Text = $text; Json = $parsed; Error = $null; SeenFingerprint = (& $seen) }
}

function Get-DRErrorCode($Response) {
    if ($Response.Json -and $Response.Json.PSObject.Properties['error']) { return [string]$Response.Json.error }
    return ''
}

# ---------------------------------------------------------------------------------------------
# Addresses
# ---------------------------------------------------------------------------------------------
function Test-DRIPv4([string]$Text) {
    $parts = "$Text".Split('.')
    if ($parts.Count -ne 4) { return $false }
    foreach ($p in $parts) { if ($p -notmatch '^(0|[1-9][0-9]{0,2})$' -or [int]$p -gt 255) { return $false } }
    return $true
}

# Addresses that are never a server's public address: 0/8, 10/8, 100.64/10 (CGNAT, Tailscale),
# 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24,
# 203.0.113/24, 224/4 and 240/4.
function Test-DRPublicIPv4([string]$Text) {
    if (-not (Test-DRIPv4 $Text)) { return $false }
    $o = $Text.Split('.') | ForEach-Object { [int]$_ }
    $a = $o[0]; $b = $o[1]; $c = $o[2]
    if ($a -eq 0 -or $a -eq 10 -or $a -eq 127 -or $a -ge 224) { return $false }
    if ($a -eq 100 -and $b -ge 64 -and $b -le 127) { return $false }
    if ($a -eq 169 -and $b -eq 254) { return $false }
    if ($a -eq 172 -and $b -ge 16 -and $b -le 31) { return $false }
    if ($a -eq 192 -and $b -eq 168) { return $false }
    if ($a -eq 192 -and $b -eq 0 -and ($c -eq 0 -or $c -eq 2)) { return $false }
    if ($a -eq 198 -and ($b -eq 18 -or $b -eq 19)) { return $false }
    if ($a -eq 198 -and $b -eq 51 -and $c -eq 100) { return $false }
    if ($a -eq 203 -and $b -eq 0 -and $c -eq 113) { return $false }
    return $true
}

# An IPv4 address or IPv4 CIDR block (prefix 8-32) for firewall remote-address lists.
function Test-DRIPv4Cidr([string]$Text) {
    if (Test-DRIPv4 $Text) { return $true }
    $m = [regex]::Match("$Text", '^([0-9.]+)/([0-9]{1,2})$')
    if (-not $m.Success) { return $false }
    return ((Test-DRIPv4 $m.Groups[1].Value) -and [int]$m.Groups[2].Value -ge 8 -and [int]$m.Groups[2].Value -le 32)
}

function Test-DRHost([string]$HostName) {
    if (-not $HostName -or $HostName.Length -gt 253) { return $false }
    if ($HostName -match '^[0-9.]+$') { return (Test-DRIPv4 $HostName) }
    if ($HostName -cnotmatch '^[a-z0-9.-]+$') { return $false }
    $labels = $HostName.Split('.')
    foreach ($l in $labels) { if ($l.Length -eq 0 -or $l.Length -gt 63 -or $l.StartsWith('-') -or $l.EndsWith('-')) { return $false } }
    $last = $labels[$labels.Count - 1]
    if ($last -match '^[0-9]+$' -or $last -match '^0x') { return $false }
    return $true
}

# IPv4 addresses bound on this machine's adapters that are public (a VPS usually has its public
# address on the NIC; one behind 1:1 NAT does not, and then -PublicHost is required).
function Get-DRLocalPublicIPv4 {
    @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { Test-DRPublicIPv4 $_.IPAddress } | ForEach-Object { $_.IPAddress })
}

function Resolve-DRIPv4([string]$HostName) {
    if (Test-DRIPv4 $HostName) { return $HostName }
    try {
        $a = [Net.Dns]::GetHostAddresses($HostName) | Where-Object { $_.AddressFamily -eq 'InterNetwork' } | Select-Object -First 1
        if ($a) { return $a.IPAddressToString }
    } catch {}
    return $null
}

# ---------------------------------------------------------------------------------------------
# Invite strings (shared contract C1)
#   v1 (private, Tailscale):
#     dauntless-revived://join?v=1&host=<tailnet IPv4 or MagicDNS name>&port=61000&code=<invite code>
#       &name=<url-encoded server name>[&share=<url-encoded Tailscale machine-share URL>]
#   v2 (public, gateway):
#     dauntless-revived://join?v=2&mode=public&host=<public IPv4 or DNS name>&port=<gateway TCP port>
#       &fp=<SHA-256 of the gateway certificate DER, 64 lowercase hex>&code=<invite code>&name=<url-encoded name>
# ---------------------------------------------------------------------------------------------
function Test-DRInviteCode([string]$Code) { return ($Code -cmatch '^[A-Za-z0-9-]{4,64}$') }

function Test-DRShareUrl([string]$Url) {
    if (-not $Url -or $Url.Length -gt 512) { return $false }
    if (-not $Url.ToLowerInvariant().StartsWith('https://login.tailscale.com/')) { return $false }
    try { $u = [Uri]$Url } catch { return $false }
    return ($u.Scheme -eq 'https' -and $u.Host -eq 'login.tailscale.com' -and $u.IsDefaultPort -and -not $u.UserInfo)
}

# Server names: 1-64 characters, no control characters, and nothing that would break a .env line.
function Test-DRServerName([string]$Name) {
    if (-not $Name) { return $false }
    $t = $Name.Trim()
    if ($t.Length -lt 1 -or $t.Length -gt 64 -or $t -ne $Name) { return $false }
    if ($t -match '[\x00-\x1f\x7f"\\]') { return $false }
    if ($t -match '[\u200e\u200f\u202a-\u202e\u2066-\u2069]') { return $false }
    return $true
}

# The launcher's display rule for a received name (cleanServerName in UndauntedLauncher/src/shared/invite.ts).
function ConvertTo-DRCleanServerName([string]$Raw) {
    if ($Raw -match '[\x00-\x1f\x7f\u200e\u200f\u202a-\u202e\u2066-\u2069]') { return $null }
    $n = ($Raw.Trim() -replace '\s+', ' ')
    if ($n.Length -lt 1 -or $n.Length -gt 64) { return $null }
    return $n
}

function Test-DRUsername([string]$Name) { return ($Name -cmatch '^[A-Za-z0-9_]{3,16}$') }

# ---------------------------------------------------------------------------------------------
# Account keys (never printed)
# ---------------------------------------------------------------------------------------------
# The key in a file: owner.key (the key alone) or a launcher key backup (a "Key: ..." line), with the
# launcher's rule (extractAccountKey in UndauntedLauncher/src/shared/username.ts). $null when the file
# holds no key; throws when it cannot be read.
function Read-DRAccountKey([string]$Path) {
    $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    if ($item.PSIsContainer -or $item.Length -gt 8192) { return $null }
    $text = [IO.File]::ReadAllText($item.FullName)
    $m = [regex]::Match($text, '(?m)^\s*Key:\s*([A-Za-z0-9_-]{8,128})\s*$')
    if ($m.Success) { return $m.Groups[1].Value }
    $t = $text.Trim()
    if ($t -cmatch '^[A-Za-z0-9_-]{8,128}$') { return $t }
    return $null
}

# Where an account key may go over plain HTTP (the launcher's isPrivateModeHost): this machine, a
# Tailscale address (100.64.0.0/10) or a MagicDNS name. Anything else only over TLS pinned to the
# invite's certificate.
function Test-DRPlainKeyHost([string]$HostName) {
    $h = "$HostName".ToLowerInvariant()
    if ($h -eq 'localhost') { return $true }
    if (Test-DRIPv4 $h) {
        $o = $h.Split('.') | ForEach-Object { [int]$_ }
        return ($o[0] -eq 127 -or ($o[0] -eq 100 -and $o[1] -ge 64 -and $o[1] -le 127))
    }
    return ((Test-DRHost $h) -and $h.EndsWith('.ts.net') -and $h.Split('.').Count -ge 3)
}

function New-DRInviteString {
    param([string]$ServerHost, [int]$Port, [string]$Code, [string]$Name, [string]$ShareUrl, [string]$Fingerprint, [ValidateSet('Private', 'Public')][string]$Mode = 'Private')
    $h = "$ServerHost".ToLowerInvariant()
    if (-not (Test-DRHost $h)) { throw "Invite host '$ServerHost' is not an IPv4 address or a DNS name." }
    if ($Port -lt 1 -or $Port -gt 65535) { throw "Invite port $Port is out of range." }
    if (-not (Test-DRInviteCode $Code)) { throw 'Invite code must be 4-64 characters of A-Z, a-z, 0-9 and -.' }
    if (-not (Test-DRServerName $Name)) { throw 'Server name must be 1-64 characters without control characters, quotes or backslashes.' }
    if ($Mode -eq 'Public') {
        if (-not (Test-DRFingerprint $Fingerprint)) { throw 'A public invite needs the gateway certificate fingerprint (64 lowercase hex characters).' }
        if ($ShareUrl) { throw 'A public invite has no Tailscale share link.' }
        return ('dauntless-revived://join?v=2&mode=public&host=' + $h + '&port=' + $Port + '&fp=' + $Fingerprint + '&code=' + $Code + '&name=' + [Uri]::EscapeDataString($Name))
    }
    $s = 'dauntless-revived://join?v=1&host=' + $h + '&port=' + $Port + '&code=' + $Code + '&name=' + [Uri]::EscapeDataString($Name)
    if ($ShareUrl) {
        if (-not (Test-DRShareUrl $ShareUrl)) { throw 'The Tailscale share URL must start with https://login.tailscale.com/' }
        $s += '&share=' + [Uri]::EscapeDataString($ShareUrl)
    }
    return $s
}

# Strict parser, the same rules as the launcher. Throws a short error code on anything else.
function ConvertFrom-DRInviteString([string]$Text) {
    $t = "$Text".Trim()
    if (-not $t) { throw 'empty' }
    if ($t.Length -gt 2048) { throw 'too_long' }
    $m = [regex]::Match($t, '^dauntless-revived://join/?\?', 'IgnoreCase')
    if (-not $m.Success) { throw 'not_invite' }
    $query = $t.Substring($m.Length)
    if ($query.Contains('#')) { throw 'params' }
    $values = @{}
    foreach ($pair in $query.Split('&')) {
        $eq = $pair.IndexOf('=')
        if ($eq -le 0) { throw 'params' }
        $k = $pair.Substring(0, $eq)
        if (@('v', 'mode', 'host', 'port', 'fp', 'code', 'name', 'share') -cnotcontains $k -or $values.ContainsKey($k)) { throw 'params' }
        $raw = $pair.Substring($eq + 1)
        # Like the launcher's decodeURIComponent: a '%' must start a valid escape, otherwise the invite is refused.
        if ($raw -match '%(?![0-9A-Fa-f]{2})') { throw 'params' }
        try { $values[$k] = [Uri]::UnescapeDataString($raw.Replace('+', ' ')) } catch { throw 'params' }
    }
    if (-not $values.ContainsKey('v')) { throw 'version' }
    $v = $values['v']
    if ($v -ceq '1') { $allowed = @('v', 'host', 'port', 'code', 'name', 'share'); $required = @('host', 'port', 'code', 'name') }
    elseif ($v -ceq '2') { $allowed = @('v', 'mode', 'host', 'port', 'fp', 'code', 'name'); $required = @('mode', 'host', 'fp', 'code', 'name') }
    else { throw 'version' }
    foreach ($k in $values.Keys) { if ($allowed -cnotcontains $k) { throw 'params' } }
    foreach ($k in $required) { if (-not $values.ContainsKey($k)) { throw $k } }
    if ($v -ceq '2' -and -not $values.ContainsKey('port')) { $values['port'] = '443' }   # v2 port defaults to 443, as in the launcher
    $mode = 'private'
    if ($v -eq '2') { if ($values['mode'] -cne 'public') { throw 'mode' }; $mode = 'public' }
    $h = $values['host'].ToLowerInvariant()
    if (-not (Test-DRHost $h)) { throw 'host' }
    if ($values['port'] -notmatch '^[1-9][0-9]{0,4}$' -or [int]$values['port'] -gt 65535) { throw 'port' }
    if (-not (Test-DRInviteCode $values['code'])) { throw 'code' }
    $name = ConvertTo-DRCleanServerName $values['name']
    if ($null -eq $name) { throw 'name' }
    $fp = $null
    if ($v -eq '2') { if (-not (Test-DRFingerprint $values['fp'])) { throw 'fp' }; $fp = $values['fp'] }
    $share = $null
    if ($values.ContainsKey('share')) { if (-not (Test-DRShareUrl $values['share'])) { throw 'share' }; $share = $values['share'] }
    return [pscustomobject]@{ Version = [int]$v; Mode = $mode; Host = $h; Port = [int]$values['port']; Fingerprint = $fp; Code = $values['code']; Name = $name; Share = $share }
}

# ---------------------------------------------------------------------------------------------
# Tailscale (private mode)
# ---------------------------------------------------------------------------------------------
function Get-DRTailscaleExe {
    $p = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
    if (Test-Path -LiteralPath $p) { return $p }
    return $null
}

function Get-DRTailscaleIPv4 {
    $exe = Get-DRTailscaleExe
    if (-not $exe) { return $null }
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = & $exe ip -4 2>$null } finally { $ErrorActionPreference = $old }
    foreach ($l in @($out)) { $l = "$l".Trim(); if ((Test-DRIPv4 $l) -and $l.StartsWith('100.')) { return $l } }
    return $null
}

function Get-DRTailscaleSelf {
    $exe = Get-DRTailscaleExe
    if (-not $exe) { return $null }
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $json = (& $exe status --json 2>$null) -join "`n" } finally { $ErrorActionPreference = $old }
    try { return ($json | ConvertFrom-Json).Self } catch { return $null }
}

function Get-DRTailscaleAdapter {
    $a = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceDescription -like 'Tailscale*' -or $_.Name -eq 'Tailscale' } | Select-Object -First 1
    return $a
}

function Test-DRLocalAddress([string]$Address) {
    if ($Address -eq '127.0.0.1' -or $Address -eq '0.0.0.0') { return $true }
    return [bool](Get-NetIPAddress -IPAddress $Address -ErrorAction SilentlyContinue)
}

# ---------------------------------------------------------------------------------------------
# Components. Processes are identified by their command line (the absolute path of the component's
# entry script under our root), never by name alone: the host may run other Node programs, and its
# owner's own game client is the same exe as the game servers.
#   Script   entry point, relative to the component folder
#   Env      the Get-DRPaths property of its .env file
#   PortKey  its key in server.json "Ports"
#   Bind     'local' (always 127.0.0.1), 'bind' (the configured bind address), 'gateway'
# The gateway and the allowlist helper exist only in public mode. The allowlist helper runs in its own
# elevated task (it changes one firewall rule); everything else runs as the service account.
# ---------------------------------------------------------------------------------------------
$script:DRComponents = [ordered]@{
    metagame  = @{ Dir = 'UndauntedMetagame';     Script = 'dist\server.js';           Env = 'MetaEnv';      PortKey = 'metagame';  Bind = 'bind';    Label = 'metagame' }
    content   = @{ Dir = 'UndauntedContent';      Script = 'dist\server.js';           Env = 'ContentEnv';   PortKey = 'content';   Bind = 'bind';    Label = 'content server' }
    deploy    = @{ Dir = 'UndauntedDeployServer'; Script = 'dist\server.js';           Env = 'DeployEnv';    PortKey = 'deploy';    Bind = 'local';   Label = 'deploy server' }
    gateway   = @{ Dir = 'UndauntedGateway';      Script = 'dist\server.js';           Env = 'GatewayEnv';   PortKey = 'gateway';   Bind = 'gateway'; Label = 'gateway' }
    allowlist = @{ Dir = 'UndauntedGateway';      Script = 'dist\allowlist\server.js'; Env = 'AllowlistEnv'; PortKey = 'allowlist'; Bind = 'local';   Label = 'allowlist helper' }
}
# Start order; stop runs in reverse. The allowlist helper comes first so the gateway can report to it.
$script:DRComponentOrder = @('allowlist', 'metagame', 'content', 'gateway', 'deploy')
# Packages to build (a folder may hold more than one component).
$script:DRPackages = @('UndauntedMetagame', 'UndauntedDeployServer', 'UndauntedContent', 'UndauntedGateway')

function Get-DRComponentScript($Paths, [string]$Component) {
    $c = $script:DRComponents[$Component]
    return (Join-Path (Join-Path $Paths.App $c.Dir) $c.Script)
}

function Get-DRComponentProcesses($Paths, [string]$Component) {
    $script = Get-DRComponentScript $Paths $Component
    @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($script, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
                       $_.CommandLine.Substring($_.CommandLine.IndexOf($script, [StringComparison]::OrdinalIgnoreCase) + $script.Length) -match '^("|\s|$)' })
}

function Get-DRGameServers([string]$GameDir) {
    if (-not $GameDir) { return @() }
    $exe = Join-Path $GameDir $script:DRPinned.ExeRelative
    @(Get-CimInstance Win32_Process -Filter "Name='Dauntless-Win64-Shipping.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $exe) -and ($_.CommandLine -match '\s-server(\s|$)') })
}

function Get-DRListeners([int]$ProcessId) {
    @(Get-NetTCPConnection -OwningProcess $ProcessId -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { '{0}:{1}' -f $_.LocalAddress, $_.LocalPort } | Sort-Object -Unique)
}

function Get-DRPortOwner([int]$Port) {
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $c) { return $null }
    $name = (Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    return [pscustomobject]@{ Pid = $c.OwningProcess; Name = $name; Address = $c.LocalAddress }
}

# ---------------------------------------------------------------------------------------------
# Game user config for the account that runs the game servers.
# Game servers read their backend endpoints from the user Game.ini (the DLL rewrites them only in
# client mode), generated here from the DLL's own endpoint table. Engine.ini gets the memory caps and
# the chat (XMPP) override so a server never contacts Epic's old chat service.
# ---------------------------------------------------------------------------------------------
function Get-DREndpointOverrides([string]$DllMainCpp, [string]$Metagame) {
    $re = '^\s*\{L"([A-Za-z0-9_]+)", L"http://" \+ Globals::MetagameAddress(?: \+ L"([^"]*)")?\},?'
    $lines = foreach ($l in [IO.File]::ReadAllLines($DllMainCpp)) {
        if ($l -match $re) { '{0}="http://{1}{2}"' -f $Matches[1], $Metagame, $Matches[2] }
    }
    return @($lines)
}

function Write-DRGameUserConfig {
    param([string]$ConfigDir, [string]$DllMainCpp, [string]$Metagame)
    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
    $entries = Get-DREndpointOverrides $DllMainCpp $Metagame
    $game = Join-Path $ConfigDir 'Game.ini'
    [IO.File]::WriteAllLines($game, [string[]](@('[OnlineSubsystemPhoenix]') + $entries), (New-Object System.Text.ASCIIEncoding))

    $sys = @('[SystemSettings]', 'r.Streaming.PoolSize=3000', 'r.Streaming.LimitPoolSizeToVRAM=1',
             'gc.TimeBetweenPurgingPendingKillObjects=10', 's.ForceGCAfterLevelStreamedOut=1')
    $xmpp = @('[OnlineSubsystemMcp.XMPP]', 'ServerAddr="ws://127.0.0.1"', "ServerPort=$script:DRChatPort", 'bUseSSL=false')
    $eng = Join-Path $ConfigDir 'Engine.ini'
    $keep = New-Object System.Collections.Generic.List[string]
    if (Test-Path -LiteralPath $eng) {
        $skip = $false
        foreach ($l in [IO.File]::ReadAllLines($eng)) {
            if ($l -match '^\[(SystemSettings|OnlineSubsystemMcp\.XMPP)\]') { $skip = $true; continue }
            if ($skip -and $l -match '^\[') { $skip = $false }
            if (-not $skip) { $keep.Add($l) }
        }
    }
    [IO.File]::WriteAllLines($eng, [string[]]($sys + '' + $xmpp + '' + $keep), (New-Object System.Text.ASCIIEncoding))
    return $entries.Count
}

# ---------------------------------------------------------------------------------------------
# Downloads (TLS 1.2 on Windows Server 2019, where PowerShell 5.1 defaults to TLS 1.0).
# ---------------------------------------------------------------------------------------------
function Save-DRDownload([string]$Url, [string]$OutFile) {
    Enable-DRTls12
    $old = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
    try { Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -TimeoutSec 900 }
    finally { $ProgressPreference = $old }
}

function Get-DRDownloadText([string]$Url) {
    Enable-DRTls12
    $old = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
    try { return (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 60).Content }
    finally { $ProgressPreference = $old }
}

# Large downloads (the 10.5 GB game zip): resumes <OutFile>.partial with HTTP Range after a dropped
# connection (up to -Retries times, and across runs), then checks the SHA-256 before renaming it into
# place. A file that is already complete and correct is not downloaded again. Prints progress every 5%.
function Save-DRLargeDownload {
    param([string]$Url, [string]$OutFile, [string]$Sha256, [int]$Retries = 20)
    Enable-DRTls12
    if ((Test-Path -LiteralPath $OutFile) -and ((Get-DRSha256 $OutFile) -eq $Sha256.ToUpperInvariant())) { return }
    $partial = "$OutFile.partial"
    $attempt = 0
    while ($true) {
        $have = 0L
        if (Test-Path -LiteralPath $partial) { $have = (Get-Item -LiteralPath $partial).Length }
        $req = [Net.HttpWebRequest]::Create($Url)
        $req.Proxy = [Net.WebRequest]::DefaultWebProxy
        $req.Timeout = 60000
        $req.ReadWriteTimeout = 120000
        $req.UserAgent = 'DauntlessRevived-ServerKit'
        if ($have -gt 0) { $req.AddRange([long]$have) }
        $resp = $null
        try {
            $resp = $req.GetResponse()
            $status = [int]$resp.StatusCode
            $mode = [IO.FileMode]::Append
            if ($have -gt 0 -and $status -eq 200) { $have = 0; $mode = [IO.FileMode]::Create }   # no Range support: start over
            elseif ($have -eq 0) { $mode = [IO.FileMode]::Create }
            $total = if ($resp.ContentLength -ge 0) { $have + $resp.ContentLength } else { -1 }
            $in = $resp.GetResponseStream()
            $out = New-Object IO.FileStream($partial, $mode, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try {
                $buf = New-Object byte[] (1MB)
                $done = $have; $nextReport = 0
                if ($total -gt 0) { $nextReport = [long]([math]::Floor(($done / $total) * 20) + 1) }
                while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
                    $out.Write($buf, 0, $n)
                    $done += $n
                    if ($total -gt 0 -and ($done / $total) * 20 -ge $nextReport) {
                        Write-DRInfo ('  download {0}% ({1:N1} of {2:N1} GB)' -f [int](100 * $done / $total), ($done / 1GB), ($total / 1GB))
                        $nextReport++
                    }
                }
            } finally { $out.Dispose(); $in.Dispose() }
            break
        } catch {
            if ($resp) { $resp.Close(); $resp = $null }
            $ex = $_.Exception
            while ($ex -and -not ($ex -is [Net.WebException])) { $ex = $ex.InnerException }
            if ($ex -and $ex.Response -and [int]$ex.Response.StatusCode -eq 416 -and $have -gt 0) { break }   # already complete
            $attempt++
            if ($attempt -gt $Retries) { throw "Download failed after $Retries retries: $($_.Exception.Message)" }
            Write-DRWarn "download interrupted ($($_.Exception.Message)); resuming in 10 s (attempt $attempt of $Retries)"
            Start-Sleep -Seconds 10
        } finally { if ($resp) { $resp.Close() } }
    }
    $h = Get-DRSha256 $partial
    if ($h -ne $Sha256.ToUpperInvariant()) {
        Remove-Item -LiteralPath $partial -Force
        throw "The downloaded file has SHA-256 $h, not the expected $($Sha256.ToUpperInvariant()). Deleted it."
    }
    if (Test-Path -LiteralPath $OutFile) { Remove-Item -LiteralPath $OutFile -Force }
    Move-Item -LiteralPath $partial -Destination $OutFile
}

# Authenticode: valid, and issued to the expected publisher.
function Test-DRSignature([string]$Path, [string]$Publisher) {
    $sig = Get-AuthenticodeSignature -LiteralPath $Path
    $subject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '' }
    return [pscustomobject]@{ Ok = ($sig.Status -eq 'Valid' -and $subject -like "*O=$Publisher*"); Status = "$($sig.Status)"; Subject = $subject }
}

# ---------------------------------------------------------------------------------------------
# Server code: copied from a folder (a checkout, or an extracted source zip) into <root>\app.new, then
# npm ci + npm run build for every package, then swapped in (the previous build stays as app.prev).
# Returns the list of packages that were built.
# ---------------------------------------------------------------------------------------------
function Get-DRBuildEnvironment([string]$NodeExe) {
    # SSH services can retain the PATH from before Node's MSI installation. npm itself is
    # invoked by absolute path, but dependency install scripts still execute "node".
    return @{ NODE_ENV = 'development'; npm_config_update_notifier = 'false'; npm_config_fund = 'false'; npm_config_audit = 'false'; Path = "$(Split-Path $NodeExe -Parent);$env:Path" }
}

function Build-DRApp {
    param($Paths, [string]$From, [string]$NodeExe, [hashtable]$Version)
    $appNew = "$($Paths.App).new"
    if (Test-Path -LiteralPath $appNew) { Remove-Item -LiteralPath $appNew -Recurse -Force }
    Write-DRInfo 'copying the source (without node_modules, build output, .git and .env files) ...'
    # The server uses the pinned prebuilt DLLs; of UndauntedInternalServer it needs only dllmain.cpp (the
    # endpoint table for Game.ini), not the ~100 MB of engine SDK headers the DLL is built from.
    $dllSrc = Join-Path $From 'UndauntedInternalServer'
    $code = Invoke-DRNative -FilePath 'robocopy.exe' -Arguments @($From, $appNew, '/E', '/XD', 'node_modules', 'dist', 'build', 'out', '.git', '.vite', 'staging',
        (Join-Path $dllSrc 'SDK'), (Join-Path $dllSrc 'MinHook'),
        '/XF', '.env', '*.db', '*.db-journal', '*.db-wal', '*.db-shm', '*.log', '*.key', '*.pem', (Join-Path $dllSrc 'Assertions.inl'),
        '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1') -LogBase (Join-Path $Paths.Logs 'install\source-copy')
    if ($code -ge 8) { Stop-DR "Copying the source failed (robocopy exit code $code)" }
    # .env files of the source must never come along, whatever their name
    Get-ChildItem -LiteralPath $appNew -Recurse -Force -Filter '.env*' -File | Where-Object { $_.Name -ne '.env.example' } | Remove-Item -Force
    $npmCli = Join-Path (Split-Path $NodeExe -Parent) 'node_modules\npm\bin\npm-cli.js'
    if (-not (Test-Path -LiteralPath $npmCli)) { Stop-DR "npm not found next to $NodeExe" }
    $built = @()
    foreach ($pkg in $script:DRPackages) {
        $dir = Join-Path $appNew $pkg
        if (-not (Test-Path -LiteralPath (Join-Path $dir 'package.json'))) {
            if ($pkg -in 'UndauntedMetagame', 'UndauntedDeployServer') { Stop-DR "$pkg is missing from the source" }
            Write-DRWarn "this code version has no $pkg; skipping it"
            continue
        }
        # NODE_ENV=production would make npm ci skip the TypeScript compiler.
        $envs = Get-DRBuildEnvironment $NodeExe
        Write-DRInfo "npm ci + build: $pkg (a few minutes) ..."
        $code = Invoke-DRNative -FilePath $NodeExe -Arguments @($npmCli, 'ci', '--no-audit', '--no-fund') -WorkingDirectory $dir -LogBase (Join-Path $Paths.Logs "install\npm-ci-$pkg") -Environment $envs -LowPriority
        if ($code -ne 0) { Show-DRLogTail (Join-Path $Paths.Logs "install\npm-ci-$pkg"); Stop-DR "npm ci failed in $pkg" }
        $code = Invoke-DRNative -FilePath $NodeExe -Arguments @($npmCli, 'run', 'build') -WorkingDirectory $dir -LogBase (Join-Path $Paths.Logs "install\npm-build-$pkg") -Environment $envs -LowPriority
        if ($code -ne 0) { Show-DRLogTail (Join-Path $Paths.Logs "install\npm-build-$pkg"); Stop-DR "the build failed in $pkg" }
        foreach ($c in $script:DRComponents.Keys) {
            $cd = $script:DRComponents[$c]
            if ($cd.Dir -eq $pkg -and -not (Test-Path -LiteralPath (Join-Path $dir $cd.Script))) { Stop-DR "the build of $pkg has no $($cd.Script) ($($cd.Label))" }
        }
        if ($pkg -in 'UndauntedMetagame', 'UndauntedDeployServer' -and -not (Test-Path -LiteralPath (Join-Path $dir 'node_modules\better-sqlite3\build\Release\better_sqlite3.node'))) {
            Stop-DR "better-sqlite3 has no native module in $pkg (see $($Paths.Logs)\install\npm-ci-$pkg.err.log)"
        }
        Write-DROk "$pkg built"
        $built += $pkg
    }
    Write-DRText -Path (Join-Path $appNew 'VERSION.json') -Text ($Version | ConvertTo-Json)
    return ,$built
}

# app.new -> app, the old app -> app.prev. Nothing of the app may be running.
function Switch-DRApp($Paths) {
    $appNew = "$($Paths.App).new"
    $appPrev = "$($Paths.App).prev"
    if (-not (Test-Path -LiteralPath $appNew)) { Stop-DR "$appNew does not exist" }
    if (Test-Path -LiteralPath $Paths.App) {
        if (Test-Path -LiteralPath $appPrev) { Remove-Item -LiteralPath $appPrev -Recurse -Force }
        Rename-Item -LiteralPath $Paths.App -NewName (Split-Path $appPrev -Leaf)
    }
    Rename-Item -LiteralPath $appNew -NewName (Split-Path $Paths.App -Leaf)
}

# Windows' own bsdtar (System32): a tar from Git for Windows earlier on PATH cannot read zips the same way.
function Get-DRTar {
    $t = Join-Path $env:WINDIR 'System32\tar.exe'
    if (Test-Path -LiteralPath $t) { return $t }
    return 'tar.exe'
}

# A source zip made by Deploy-Remote.ps1 (git archive) or downloaded from GitHub: extracted with
# tar.exe; returns the folder that holds UndauntedMetagame\.
function Expand-DRSourceZip($Paths, [string]$Zip, [string]$Tag) {
    $unz = Join-Path $Paths.Downloads "source-$Tag"
    if (Test-Path -LiteralPath $unz) { Remove-Item -LiteralPath $unz -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $unz | Out-Null
    $code = Invoke-DRNative -FilePath (Get-DRTar) -Arguments @('-xf', $Zip, '-C', $unz) -LogBase (Join-Path $Paths.Logs 'install\source-unzip')
    if ($code -ne 0) { Stop-DR "Extracting the source zip failed (exit code $code)" }
    if (Test-Path -LiteralPath (Join-Path $unz 'UndauntedMetagame\package.json')) { return $unz }
    $sub = Get-ChildItem -LiteralPath $unz -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'UndauntedMetagame\package.json') } | Select-Object -First 1
    if (-not $sub) { Stop-DR "$Zip does not contain the server source (no UndauntedMetagame\package.json)" }
    return $sub.FullName
}

# ---------------------------------------------------------------------------------------------
# Backups: folders named yyyy-MM-dd_HHmmss (name order is time order).
# ---------------------------------------------------------------------------------------------
function Get-DRBackupFolders([string]$BackupRoot) {
    if (-not (Test-Path -LiteralPath $BackupRoot)) { return @() }
    @(Get-ChildItem -LiteralPath $BackupRoot -Directory | Where-Object Name -match '^\d{4}-\d\d-\d\d_\d{6}$' | Sort-Object Name -Descending)
}

function Get-DRLatestBackupAge([string]$BackupRoot) {
    $b = Get-DRBackupFolders $BackupRoot | Select-Object -First 1
    if (-not $b) { return $null }
    $t = [datetime]::ParseExact($b.Name, 'yyyy-MM-dd_HHmmss', [Globalization.CultureInfo]::InvariantCulture)
    return ((Get-Date) - $t)
}
