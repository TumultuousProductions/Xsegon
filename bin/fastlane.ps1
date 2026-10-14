<#
    Xsegon - the fast lane: start it, and stop it when the main server ends.

    Started, hidden, by includes\fastlane.php when the page loads and the
    fast lane is not running (router-fast.php says what it is). It starts a
    second `php -S` on -Port with the main server's settings and its own
    code-cache id (two PHPs sharing one crash at start), and stops it when
    the main server ends, so it never holds the port alone.

    The environment is the main server's, so a test server's fast lane
    serves the test copy (XSEGON_DATA) and never the real data.
#>

param(
    [Parameter(Mandatory = $true)][string]$Php,
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][int]$MainPid,
    [string]$CacheId = '',
    [string]$CaFile = '',
    [switch]$Ffi,
    [int]$HungSec = 900
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'xsbrowser.ps1')      # Write-XsegonLine
$dataDir = if ($env:XSEGON_DATA) { $env:XSEGON_DATA } else { Join-Path $root 'data' }

function Say([string]$msg) {
    try {
        if (-not (Test-XsegonLogging $dataDir)) { return }
        $dir = Join-Path $dataDir 'log'
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $file = Join-Path $dir ((Get-Date).ToString('yyyy-MM-dd') + '.log')
        $line = (Get-Date).ToString('HH:mm:ss.fff') + ' S LANE ' + $msg + "`n"
        [System.IO.File]::AppendAllText($file, $line, (New-Object System.Text.UTF8Encoding($false)))
    } catch { }
}

trap {
    Say ("the fast lane's starter died: " + $_.Exception.Message + ' at line ' + $_.InvocationInfo.ScriptLineNumber)
    break
}

$main = Get-Process -Id $MainPid -ErrorAction SilentlyContinue
if (-not $main) { Say "the main server (process $MainPid) is gone; the fast lane was not started"; exit 0 }

$args2 = @()
if ($CaFile) { $args2 += @('-d', "openssl.cafile=`"$CaFile`"", '-d', "curl.cainfo=`"$CaFile`"") }
if ($CacheId) { $args2 += @('-d', "opcache.cache_id=$CacheId") }
if ($Ffi -and (Test-Path -LiteralPath (Join-Path (Split-Path $Php -Parent) 'ext\php_ffi.dll'))) {
    # Loaded on the command line only when php.ini does not load it already:
    # loading it twice is a startup warning on every request.
    $loaded = (& $Php -m 2>$null) -contains 'FFI'
    if (-not $loaded) { $args2 += @('-d', 'extension=ffi') }
    $args2 += @('-d', 'ffi.enable=1')
}
$args2 += @('-S', "127.0.0.1:$Port", '-t', "`"$root`"", "`"$(Join-Path $root 'router-fast.php')`"")

try {
    $lane = Start-Process -FilePath $Php -ArgumentList $args2 -WindowStyle Hidden -PassThru
} catch {
    Say "the fast lane did not start: $($_.Exception.Message)"
    exit 1
}
Start-Sleep -Milliseconds 400
if ($lane.HasExited) {
    Say "the fast lane stopped straight away (exit $($lane.ExitCode)); is port $Port taken? The page uses the main server"
    exit 1
}
Say "the fast lane is up on port $Port (process $($lane.Id)), beside the main server (process $MainPid)"

# Polled, not Wait-Process on both: whichever ends first decides what happens.
# The main server answers one request at a time, so one that never ends
# freezes Xsegon. data\main-busy holds "time|pid|path" while a request runs;
# the same request seen for -HungSec ends the server and the lane. Counted
# in two-second looks, not by the clock, so a PC that slept is not stuck.
$busyFile = Join-Path $dataDir 'main-busy'
$lastMark = ''
$stuck = 0
while ($true) {
    Start-Sleep -Seconds 2
    $mark = ''
    try { if (Test-Path -LiteralPath $busyFile) { $mark = [System.IO.File]::ReadAllText($busyFile) } } catch { }
    if ($mark -and $mark -eq $lastMark -and ($mark -split '\|')[1] -eq "$MainPid") {
        $stuck += 2
        $on = ($mark -split '\|', 3)[2]
        if ($stuck -eq 120) { Say "the main server has been on $on for 2 minutes; everything else waits behind it" }
        if ($stuck -ge $HungSec) {
            Say "the main server has been on $on for $([int]($stuck / 60)) minutes and is not coming back: ending it (process $MainPid) and the fast lane. Start Xsegon again"
            Stop-Process -Id $MainPid -Force -ErrorAction SilentlyContinue
            Stop-Process -Id $lane.Id -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $busyFile -Force -ErrorAction SilentlyContinue
            exit 0
        }
    } else {
        $stuck = 0
        $lastMark = $mark
    }
    if ($lane.HasExited) {
        Say "the fast lane stopped by itself (exit $($lane.ExitCode)); the page uses the main server until the next page load starts it again"
        exit 0
    }
    if (-not (Get-Process -Id $MainPid -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $lane.Id -Force -ErrorAction SilentlyContinue
        Say "the main server ended, so the fast lane was stopped with it"
        exit 0
    }
}
