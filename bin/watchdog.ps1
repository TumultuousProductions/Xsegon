<#
    Xsegon - the app window's watchdog.

    Started beside the window by bin\open.ps1, one per window, and gone when
    the window is. The page's status poll touches data\heartbeat (at least
    once a minute even when Chrome throttles a hidden window). No beat for
    -StaleSec while the window is open means the page has stopped (its code
    never started, the tab crashed, it froze), and the window is reopened.

    It holds back when restarting would be wrong or useless:
      - a game is running (data\running.json): the window is put away then
      - the PC has just woken: the beat stopped because everything did
      - the server is not answering: that is the server's trouble, and the
        page's own offline screen covers it
      - three restarts inside an hour: something deeper is wrong, and a
        window that keeps reappearing is worse than one that stays stuck;
        it says so in the log and stops

    Every decision is a WDOG line in data\log. -DryRun says what it would
    do without doing it (the tests).
#>

param(
    [int]$Port = 8099,
    [Parameter(Mandatory = $true)][int]$BrowserPid,
    [switch]$Windowed,
    [int]$StaleSec = 180,
    [int]$EverySec = 20,
    [string]$DataDir = '',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'xsbrowser.ps1')
if (-not $DataDir) { $DataDir = Join-Path $root 'data' }

function Say([string]$msg) {
    try {
        if (-not (Test-XsegonLogging $DataDir)) { return }
        $dir = Join-Path $DataDir 'log'
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $file = Join-Path $dir ((Get-Date).ToString('yyyy-MM-dd') + '.log')
        $line = (Get-Date).ToString('HH:mm:ss.fff') + ' S WDOG ' + $msg + "`n"
        [System.IO.File]::AppendAllText($file, $line, (New-Object System.Text.UTF8Encoding($false)))
    } catch { }
}

trap {
    Say ("the watchdog died: " + $_.Exception.Message + ' at line ' + $_.InvocationInfo.ScriptLineNumber)
    break
}

$beatFile    = Join-Path $DataDir 'heartbeat'
$runningFile = Join-Path $DataDir 'running.json'
$restartsFile = Join-Path $DataDir 'watchdog.json'

function Test-Alive { [bool](Get-Process -Id $BrowserPid -ErrorAction SilentlyContinue) }

function Test-Server {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/running.php" -UseBasicParsing -TimeoutSec 10
        return $r.StatusCode -eq 200
    } catch { return $false }
}

# Restarts in the last hour, from data\watchdog.json.
function Get-RecentRestarts {
    try {
        if (Test-Path -LiteralPath $restartsFile) {
            $cut = (Get-Date).AddHours(-1)
            return @((Get-Content -LiteralPath $restartsFile -Raw | ConvertFrom-Json).restarts |
                     Where-Object { $_ -and ([datetime]$_) -gt $cut })
        }
    } catch { Say "watchdog.json did not read ($($_.Exception.Message)); counting from nothing" }
    return @()
}

<#  Gone, but is the window? A browser can hand its window to another copy
    of itself and end, so before believing the window closed, its real owner
    is looked for (bin\xsbrowser.ps1) and followed. Never with -DataDir (a
    dry run, a test): that watchdog must not take up the real window.     #>
$watchFrom = Get-Date
$ownData = $PSBoundParameters.ContainsKey('DataDir')
function Find-Other {
    if ($ownData) { return $null }
    try {
        $other = Get-XsegonBrowser $root -Search
        if ($other -and $other.Id -ne $BrowserPid) { return $other }
    } catch { Say "looking for the window's real process failed: $($_.Exception.Message)" }
    return $null
}

if (-not (Test-Alive)) {
    $other = Find-Other
    if (-not $other) { Say "no window with process $BrowserPid to watch; stopping"; exit 0 }
    Say "the browser process started for the window ($BrowserPid) had already ended, but the window is open in process $($other.Id): watching that one"
    $BrowserPid = $other.Id
}
Say "watching the app window (process $BrowserPid): a restart after ${StaleSec}s without a heartbeat"

$since = Get-Date          # a fresh window gets the whole allowance to start beating
$lastTick = Get-Date
$firstLook = $true
while ($true) {
    # The first look comes after three seconds, not twenty: a browser that
    # hands its window over does it at once, and until the real process is
    # written down Minimise and Close take the slow road.
    Start-Sleep -Seconds $(if ($firstLook) { [Math]::Min(3, $EverySec) } else { $EverySec })
    $firstLook = $false
    $now = Get-Date
    if (-not (Test-Alive)) {
        $other = Find-Other
        if ($other) {
            Say ("the browser process started for the window ($BrowserPid) ended after about " + [int]($now - $watchFrom).TotalSeconds +
                 "s, but the window is open in process $($other.Id): watching that one instead")
            $BrowserPid = $other.Id
            $watchFrom = $now
            $lastTick = $now
            continue
        }
        Say "the app window closed; the watchdog stops with it"; exit 0
    }

    # A gap far longer than the tick: the PC slept. Start the count again.
    if (($now - $lastTick).TotalSeconds -gt [Math]::Max(90, $EverySec * 4)) {
        Say ("the PC was away for " + [int]($now - $lastTick).TotalSeconds + "s; the heartbeat count starts again")
        $since = $now
    }
    $lastTick = $now

    if (Test-Path -LiteralPath $runningFile) { $since = $now; continue }   # a game is on

    $beat = if (Test-Path -LiteralPath $beatFile) { (Get-Item -LiteralPath $beatFile).LastWriteTime } else { [datetime]::MinValue }
    $from = if ($beat -gt $since) { $beat } else { $since }
    $quiet = ($now - $from).TotalSeconds
    if ($quiet -lt $StaleSec) { continue }

    $what = if ($beat -eq [datetime]::MinValue -or $beat -lt $since) { "no heartbeat since the window opened" } else { "no heartbeat for $([int]$quiet)s" }
    if (-not (Test-Server)) {
        Say "$what, but the server is not answering either: left to the page's offline screen"
        $since = $now
        continue
    }
    $recent = @(Get-RecentRestarts)
    if ($recent.Count -ge 3) {
        Say "$what, and it has been restarted $($recent.Count) times in the last hour: not again. Something deeper is wrong; the log above says what"
        exit 1
    }
    if ($DryRun) { Say "${what}: would restart the app window (dry run)"; exit 0 }

    try {
        $all = @($recent) + @($now.ToString('o'))
        [System.IO.File]::WriteAllText($restartsFile, (@{ restarts = $all } | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
    } catch { Say "could not note the restart in watchdog.json: $($_.Exception.Message)" }

    Say "$what while the window is still open: restarting it"
    $open = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File',
              "`"$(Join-Path $PSScriptRoot 'open.ps1')`"", '-Port', $Port, '-Restart', '-Why', "`"$what`"")
    if ($Windowed) { $open += '-Windowed' }
    Start-Process -FilePath 'powershell.exe' -ArgumentList $open -WindowStyle Hidden | Out-Null
    exit 0                                  # the new window brings its own watchdog
}
