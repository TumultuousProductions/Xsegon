<#
    Xsegon - the phone page's server: start it, and stop it when it should end.

    Started, hidden, by includes\phone.php when Connect a phone... is switched on
    (router-phone.php says what the server is). It starts a third `php -S` on
    -Address, the home network's only, with its own code-cache id. It ends it
    when the main server ends, when data\phone-stop appears, or after -IdleMin
    with no phone, leaving data\phone-closed so the switch goes off too.

    The environment is the main server's, so a test server's phone page
    serves the test copy.
#>

param(
    [Parameter(Mandatory = $true)][string]$Php,
    [Parameter(Mandatory = $true)][string]$Address,
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][int]$MainPid,
    [Parameter(Mandatory = $true)][int]$MainPort,
    [string]$Mark = '',
    [string]$CacheId = '',
    [int]$IdleMin = 0
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dataDir = if ($env:XSEGON_DATA) { $env:XSEGON_DATA } else { Join-Path $root 'data' }
. (Join-Path $PSScriptRoot 'xslog.ps1')          # Test-XsegonLogging

function Say([string]$msg) {
    try {
        if (-not (Test-XsegonLogging $dataDir)) { return }
        $dir = Join-Path $dataDir 'log'
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $file = Join-Path $dir ((Get-Date).ToString('yyyy-MM-dd') + '.log')
        $line = (Get-Date).ToString('HH:mm:ss.fff') + ' S PHONE ' + $msg + "`n"
        [System.IO.File]::AppendAllText($file, $line, (New-Object System.Text.UTF8Encoding($false)))
    } catch { }
}

trap {
    Say ("the phone page's starter died: " + $_.Exception.Message + ' at line ' + $_.InvocationInfo.ScriptLineNumber)
    break
}

if (-not (Get-Process -Id $MainPid -ErrorAction SilentlyContinue)) { Say "the main server (process $MainPid) is gone; the phone page was not started"; exit 0 }

$stopFile = Join-Path $dataDir 'phone-stop'
$seenFile = Join-Path $dataDir 'phone-seen'
# The main server takes the stop mark away as it asks for a start, so one here now was a switch off pressed since.
if (Test-Path -LiteralPath $stopFile) { Say 'the phone page was switched off before it had started: not started'; exit 0 }

$env:XS_MAIN_PORT = "$MainPort"
$env:XS_PHONE_MARK = $Mark                 # how the main server knows this phone server for its own
$args2 = @()
if ($CacheId) { $args2 += @('-d', "opcache.cache_id=$CacheId") }
$args2 += @('-S', "$($Address):$Port", '-t', "`"$root`"", "`"$(Join-Path $root 'router-phone.php')`"")

try {
    $lane = Start-Process -FilePath $Php -ArgumentList $args2 -WindowStyle Hidden -PassThru
} catch {
    Say "the phone page did not start: $($_.Exception.Message)"
    exit 1
}
Start-Sleep -Milliseconds 400
if ($lane.HasExited) {
    Say "the phone page stopped straight away (exit $($lane.ExitCode)); is $($Address):$Port taken, or the address no longer this PC's?"
    exit 1
}
Say "the phone page is up at $($Address):$Port (process $($lane.Id)), beside the main server (process $MainPid)"

$since = Get-Date
while ($true) {
    Start-Sleep -Seconds 2
    if ($lane.HasExited) {
        Say "the phone page stopped by itself (exit $($lane.ExitCode)); the next look at Connect a phone... starts it again"
        exit 0
    }
    if (-not (Get-Process -Id $MainPid -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $lane.Id -Force -ErrorAction SilentlyContinue
        Say 'the main server ended, so the phone page was closed with it'
        exit 0
    }
    # The mark is left where it is: every phone server of this folder ends on it, and the next start takes it away.
    if (Test-Path -LiteralPath $stopFile) {
        Stop-Process -Id $lane.Id -Force -ErrorAction SilentlyContinue
        Say 'the phone page is closed: switched off'
        exit 0
    }
    if ($IdleMin -gt 0) {
        $last = $since
        try { if (Test-Path -LiteralPath $seenFile) { $t = (Get-Item -LiteralPath $seenFile).LastWriteTime; if ($t -gt $last) { $last = $t } } } catch { }
        if (((Get-Date) - $last).TotalMinutes -ge $IdleMin) {
            Stop-Process -Id $lane.Id -Force -ErrorAction SilentlyContinue
            try { [System.IO.File]::WriteAllText((Join-Path $dataDir 'phone-closed'), 'idle') } catch { }
            Say "the phone page is closed: no phone asked for $IdleMin minutes"
            exit 0
        }
    }
}
