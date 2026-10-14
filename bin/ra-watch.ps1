<#  bin\ra-watch.ps1 - says in the day log when a RetroArch opened by itself
    is closed, and how long it was open.

    Started by api\retroarch.php beside the RetroArch it opens. Finds that
    RetroArch by its program file and its start time, waits for it to end and
    writes one RA line. It only watches: nothing of RetroArch's is touched.

    -Exe      the program that was started
    -Since    when it was asked for, in seconds since 1970
    -DataDir  data\, for the log
    -Log      write the line down (without it the line is only printed)
    -FindSec  how long to look for it before giving up                       #>
param(
    [Parameter(Mandatory)] [string] $Exe,
    [long] $Since = 0,
    [string] $DataDir = '',
    [switch] $Log,
    [int] $FindSec = 40
)

$ErrorActionPreference = 'Stop'
if (-not $DataDir) { $DataDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'data' }

# One line in data\log\<day>.log, the shape bin\ra-jump.ps1 writes. Best effort and silent.
function Write-Log([string] $msg) {
    $msg
    if (-not $Log) { return }
    try {
        $dir = Join-Path $DataDir 'log'
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $file = Join-Path $dir ((Get-Date).ToString('yyyy-MM-dd') + '.log')
        $line = (Get-Date).ToString('HH:mm:ss.fff') + ' S RA   ' + $msg + "`n"
        [System.IO.File]::AppendAllText($file, $line, (New-Object System.Text.UTF8Encoding($false)))
    } catch { }
}

$name = [IO.Path]::GetFileNameWithoutExtension($Exe)
# A few seconds of room: the two clocks are read a moment apart.
$from = if ($Since -gt 0) { [DateTimeOffset]::FromUnixTimeSeconds($Since).LocalDateTime.AddSeconds(-5) } else { (Get-Date).AddSeconds(-30) }

# The newest one of that program started since it was asked for: one open from before is not ours.
$proc = $null
$until = (Get-Date).AddSeconds($FindSec)
while (-not $proc -and (Get-Date) -lt $until) {
    $proc = @(Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object {
        try { $_.StartTime -ge $from -and (-not $_.Path -or $_.Path -ieq $Exe) } catch { $false }
    } | Sort-Object StartTime -Descending) | Select-Object -First 1
    if (-not $proc) { Start-Sleep -Milliseconds 500 }
}
if (-not $proc) {
    Write-Log "opened with no game, but no $name process came up in ${FindSec}s to watch"
    exit 0
}

$began = $proc.StartTime
try { $proc.WaitForExit() } catch { }
$secs = [int][Math]::Round(((Get-Date) - $began).TotalSeconds)
$span = if ($secs -lt 120) { "$secs s" } else { '' + [int][Math]::Floor($secs / 60) + ' min ' + ($secs % 60) + ' s' }
Write-Log "closed after $span (opened with no game)"
