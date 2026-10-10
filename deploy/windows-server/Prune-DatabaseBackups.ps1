[CmdletBinding(SupportsShouldProcess=$true)]
param([Parameter(Mandatory=$true)][string]$BackupRoot)
$ErrorActionPreference='Stop'
$root=Get-Item -LiteralPath $BackupRoot
if(!$root.PSIsContainer -or ($root.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Backup root must be a real directory'}
$prefix=$root.FullName.TrimEnd('\')+'\'
$cutoff=[DateTime]::UtcNow.AddDays(-2)
$pending=New-Object 'System.Collections.Generic.Stack[string]'
$pending.Push($root.FullName)
$count=0;$bytes=0L
while($pending.Count){
    foreach($item in Get-ChildItem -LiteralPath $pending.Pop() -Force){
        if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){continue}
        if(!$item.FullName.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Path outside backup root'}
        if($item.PSIsContainer){$pending.Push($item.FullName);continue}
        if($item.Name -notmatch '\.db($|-wal$|-shm$|-journal$)' -or $item.LastWriteTimeUtc -ge $cutoff){continue}
        if($PSCmdlet.ShouldProcess($item.FullName,'Delete database backup older than 48 hours')){
            # Refuse files currently opened by a writer; never follow directory links.
            $handle=[IO.File]::Open($item.FullName,'Open','Read','None')
            $handle.Dispose()
            Remove-Item -LiteralPath $item.FullName -Force
            $count++;$bytes+=$item.Length
        }
    }
}
[pscustomobject]@{Deleted=$count;Bytes=$bytes;CutoffUtc=$cutoff.ToString('o')}
