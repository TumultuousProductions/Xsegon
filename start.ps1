<#
    Xsegon - start the local server.

    Usage: right-click -> Run with PowerShell, or:  .\start.ps1

    Binds 127.0.0.1, never 0.0.0.0: the server launches processes on your
    desktop, so nothing else should be able to reach it.
#>

param(
    [switch]$Windowed,     # open the app window, but not fullscreen
    [switch]$NoBrowser,    # server only
    [switch]$Restart,      # stop a server that has stopped answering, and start fresh
    [switch]$Hidden,       # the server out of sight, ended when the app window closes (Start Xsegon.bat)
    [switch]$GoBack,       # take the last update out again, for when its page will not work
    [int]$Port = 8099      # somewhere else, if 8099 belongs to something of yours
)

$ErrorActionPreference = 'Stop'

$port = $Port
$root = $PSScriptRoot

# --- out of sight (-Hidden) ---------------------------------------------------
# Start Xsegon.bat starts this with its window hidden. A start that fails brings
# the window back (Show-Self) so its reason can be read, and the server ends a
# few seconds after the app's window has gone (the wait at the end). Not with
# -NoBrowser: a tab in your own browser is not a window this can wait on.
$hiding = $Hidden -and -not $NoBrowser
function Show-Self {
    if (-not $hiding) { return }
    try {
        if (-not ('Xs.Con' -as [type])) {
            Add-Type -Namespace Xs -Name Con -ErrorAction Stop -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
'@
        }
        $h = [Xs.Con]::GetConsoleWindow()
        if ($h -ne [IntPtr]::Zero) {
            [void][Xs.Con]::ShowWindow($h, 9)      # restore: it began minimised as well as hidden
            [void][Xs.Con]::SetForegroundWindow($h)
            if ([Xs.Con]::IsWindowVisible($h)) { return }
        }
    } catch { }
    # The window would not come back: said in one of Windows' own instead.
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show("Xsegon could not start, and the window that says why would not show.`n`nTo read the reason: right-click start.ps1 in the Xsegon folder and choose Run with PowerShell.", 'Xsegon')
    } catch { }
}

# One line in data\log, for what happens with no window to say it in.
function Write-Line([string]$msg) {
    try { . (Join-Path $root 'bin\xsbrowser.ps1'); Write-XsegonLine $root 'WIN' $msg } catch { }
}

# Windows PowerShell cannot start a program from a folder with [ or ] in its
# path (it reads the name as a pattern), and Xsegon starts several from here.
if ($root -match '[\[\]]') {
    Write-Line "not started: the folder's path has square brackets ($root)"
    Write-Host 'Xsegon cannot run from a folder with [ or ] in its path:' -ForegroundColor Red
    Write-Host "  $root" -ForegroundColor DarkYellow
    Write-Host ''
    Write-Host 'Fix: rename the folder so that no part of that path has square brackets, then start Xsegon again.' -ForegroundColor Yellow
    Show-Self
    pause
    exit 1
}
if ((Get-Location).ProviderPath -match '[\[\]]') { Set-Location -LiteralPath $root }

# This folder's own mark, on the server's command line: the code cache's id
# below, and how a second start tells this copy's server from another's.
$cacheId = 'xsegon-' + [BitConverter]::ToString(
    [Security.Cryptography.MD5]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant()))).Replace('-', '').Substring(0, 12)

# --- locate php.exe -------------------------------------------------------
# PHP's install can move, so look in several places and say exactly where we looked.

# The folder Xsegon sits in, never one person's path written in here.
$myApps   = Split-Path $root -Parent
# The PHP a download carries (runtime\php, put there by tools\make-test-copy.js).
# A checkout has no runtime folder.
$ownPhp   = "$root\runtime\php\php.exe"
$knownPhp = "$myApps\php-8.5.12-nts-Win32-vs17-x64\php.exe"
# Searched only when it is in neither place.
$foundPhp = if (-not (Test-Path -LiteralPath $ownPhp) -and -not (Test-Path -LiteralPath $knownPhp)) {
    Get-ChildItem -LiteralPath $myApps -Filter 'php.exe' -Recurse -Depth 2 -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}
$pathPhp  = if (Get-Command php -ErrorAction SilentlyContinue) { (Get-Command php).Source }

$searched = @(
    @{ where = 'comes with this copy'; path = $ownPhp },
    @{ where = 'known install'; path = $knownPhp },
    @{ where = "search $myApps"; path = $foundPhp },
    @{ where = 'PATH';          path = $pathPhp }
)
$phpPath = ($searched | Where-Object { $_.path -and (Test-Path -LiteralPath $_.path) } | Select-Object -First 1).path

if (-not $phpPath) {
    Write-Host 'PHP could not be located. Looked in:' -ForegroundColor Red
    foreach ($c in $searched) {
        $status = if ($c.path) { "not found: $($c.path)" } else { 'not set' }
        Write-Host "  - $($c.where) -> $status" -ForegroundColor DarkYellow
    }
    Write-Host ''
    Write-Host 'Fix: install PHP, put it on PATH, or edit $myApps near the top of this script.' -ForegroundColor Yellow
    Show-Self
    pause
    exit 1
}

# --- the things that must exist before anything is worth starting ---------

$settings = Join-Path $root 'data\settings.json'
$lbRoot = ''     # only where a LaunchBox library was brought in
if (Test-Path -LiteralPath $settings) {
    try {
        $s = Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json
        if ($s.paths.launchbox) { $lbRoot = $s.paths.launchbox }
    } catch { }
}

Write-Host ''
Write-Host '  XSEGON' -ForegroundColor Cyan
Write-Host "  PHP       : $phpPath" -ForegroundColor DarkGray
# Said only when there is one. Without it Help > Getting started sets up
# RetroArch and finds the games, and nothing on screen mentions LaunchBox.
if ($lbRoot -and (Test-Path -LiteralPath $lbRoot)) {
    Write-Host "  LaunchBox : $lbRoot" -ForegroundColor DarkGray
}

# Extensions this build is missing, said once rather than discovered later.
$mods = & $phpPath -m
if ($mods -notcontains 'gd') {
    Write-Host '  note: gd is off, so there is no thumbnail cache yet (one line in php.ini).' -ForegroundColor DarkYellow
}

# --- is one already running? ------------------------------------------------
# A second `php -S` on a port already taken does NOT fail: it says "started"
# and takes the listening socket, so two servers write the same data files.
# The port is checked here, before anything is started.

# Is anything listening, asked without connecting: a connect to a port nobody
# holds is refused only after 2 seconds, and Get-NetTCPConnection costs over a
# second, so this is asked first and they only when they must.
function Test-PortListening([int]$p) {
    [bool]([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
        Where-Object { $_.Port -eq $p } | Select-Object -First 1)
}

# Who holds the port, for the messages when it is not Xsegon. Slow; see above.
function Get-PortHolder([int]$p) {
    $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $c) { return $null }
    $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    return [pscustomobject]@{ Pid = [int]$c.OwningProcess; Name = if ($proc) { $proc.ProcessName } else { 'unknown' } }
}

# -Light: is the port's holder Xsegon at all (api/running.php, cheap). Without
# it, the full status, which runs the whole app: the check after starting.
function Test-XsegonAlive([int]$p, [switch]$Light) {
    try {
        $what = if ($Light) { 'running' } else { 'status' }
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$p/api/$what.php" -UseBasicParsing -TimeoutSec 4
        $j = $r.Content | ConvertFrom-Json
        if ($Light) { return ($j.ok -eq $true -and $j.app -eq 'xsegon') }
        return ($j.ok -eq $true -and $null -ne $j.build)
    } catch { return $false }
}

# Xsegon answers on the port: is it this folder's? A server this script started
# carries its folder's mark on its command line. Answers the other copy's server
# (process and folder), or nothing when it is this one or cannot be told. One
# question to Windows: asking who holds the port first is far slower.
function Get-OtherCopy([int]$p) {
    try {
        $srv = Get-CimInstance Win32_Process -Filter "Name='php.exe'" -ErrorAction Stop |
            Where-Object { $_.CommandLine -match "-S\s+127\.0\.0\.1:$p(\s|`$)" } | Select-Object -First 1
        if (-not $srv -or $srv.CommandLine -notmatch 'opcache\.cache_id=(xsegon-[0-9A-Fa-f]+)' -or $Matches[1] -eq $cacheId) { return $null }
        $its = if ($srv.CommandLine -match '-t\s+"([^"]+)"') { $Matches[1] } else { '' }
        return [pscustomobject]@{ Pid = [int]$srv.ProcessId; Root = $its }
    } catch { return $null }
}

$holder = $null
if (Test-PortListening $port) {
    $alive = Test-XsegonAlive $port -Light
    $other = if ($alive) { Get-OtherCopy $port } else { $null }
    if ($other) {
        # Another copy of Xsegon has the port. Opening a window onto it would
        # show its games and its version under this copy's name.
        $its = $other.Root
        $where = if ($its) { $its } else { 'its folder could not be read' }
        $inUse = $true
        if ($its) {
            try { . (Join-Path $root 'bin\xsbrowser.ps1'); $inUse = [bool](Find-XsegonBrowser $its) } catch { $inUse = $true }
        }
        # Left running with its window closed, started from the double-click:
        # nobody is using it, and nothing on screen could stop it. It goes.
        if ($Restart -or ($Hidden -and -not $inUse)) {
            Write-Line "another copy of Xsegon held port $port ($where)$(if ($inUse) { '' } else { ', its window closed' }): its server (process $($other.Pid)) is stopped and this copy starts"
            Write-Host "  Another copy of Xsegon was left running on port $port ($where). Stopping it." -ForegroundColor Yellow
            Stop-Process -Id $other.Pid -Force -ErrorAction SilentlyContinue
            for ($i = 0; $i -lt 20 -and (Test-PortListening $port); $i++) { Start-Sleep -Milliseconds 150 }
            $holder = $null
            $alive = $false
        } else {
            Write-Line "not started: another copy of Xsegon holds port $port ($where)"
            Write-Host ''
            Write-Host "  ANOTHER COPY of Xsegon is running on port $port." -ForegroundColor Yellow
            if ($its) { Write-Host "  It is the one in: $its" -ForegroundColor Yellow }
            Write-Host '  This copy was not started, and no window was opened onto that one.' -ForegroundColor Yellow
            $also = if ($port -ne 8099) { " -Port $port" } else { '' }
            Write-Host '  Close that copy first, or stop it and start this one:' -ForegroundColor Cyan
            Write-Host "      .\start.ps1 -Restart$also" -ForegroundColor Cyan
            Write-Host ''
            Show-Self
            pause
            exit 1
        }
    }
    if ($alive) {
        Write-Host ''
        Write-Host "  Xsegon is ALREADY RUNNING on port $port." -ForegroundColor Green
        Write-Host '  Not starting a second one: two servers on one data folder is how saves fight.' -ForegroundColor DarkGray
        if (-not $NoBrowser) {
            Write-Host '  Opening a window onto the one that is running.' -ForegroundColor DarkGray
            $said = & (Join-Path $root 'bin\open.ps1') -Port $port -Windowed:$Windowed
            if ($said -eq 'no-browser') {
                Write-Host "  No Chrome or Edge found - open http://127.0.0.1:$port yourself." -ForegroundColor DarkYellow
            }
        }
        Write-Host '  To stop it: close the window it is running in, or run this again with -Restart.' -ForegroundColor DarkGray
        Write-Host ''
        exit 0
    }
    $holder = Get-PortHolder $port
}
if ($holder) {
    # Something is on the port and it is not a live Xsegon.
    Write-Host ''
    Write-Host "  Port $port is taken by $($holder.Name) (pid $($holder.Pid)), and it is not answering as Xsegon." -ForegroundColor Yellow
    if ($holder.Name -ne 'php') {
        Write-Host '  That is not a php.exe, so it is another program and Xsegon will not touch it.' -ForegroundColor Yellow
        Write-Host "  Fix: stop that program, or start Xsegon somewhere else:  .\start.ps1 -Port 8100" -ForegroundColor Cyan
        Write-Host ''
        Show-Self
        pause
        exit 1
    }
    if (-not $Restart) {
        Write-Host '  That looks like an Xsegon server that has wedged or is still starting up.' -ForegroundColor Yellow
        Write-Host '  Nothing has been started, because a second server would take the port from it.' -ForegroundColor Yellow
        $also = if ($port -ne 8099) { " -Port $port" } else { '' }
        Write-Host "  To stop it and start fresh:  .\start.ps1 -Restart$also" -ForegroundColor Cyan
        Write-Host ''
        Show-Self
        pause
        exit 1
    }
    Write-Host "  -Restart given: stopping php.exe pid $($holder.Pid)." -ForegroundColor Yellow
    Stop-Process -Id $holder.Pid -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 20 -and (Test-PortListening $port); $i++) { Start-Sleep -Milliseconds 150 }
    if (Test-PortListening $port) {
        Write-Host '  It is still holding the port. Stop it by hand and try again.' -ForegroundColor Red
        Write-Host ''
        Show-Self
        pause
        exit 1
    }
    Write-Host '  Stopped. Starting fresh.' -ForegroundColor DarkGray
}

# --- a new version, put in place while no server runs (bin\update-start.ps1) ---
# Update now or Go back was pressed (or -GoBack given): the switch is made now,
# and the start goes on in the start.ps1 of the version that is now in place.
$updateStart = Join-Path $root 'bin\update-start.ps1'
if (Test-Path -LiteralPath $updateStart) {
    if ($GoBack -and (Test-Path -LiteralPath (Join-Path $root 'data\update\switch.json'))) {
        Set-Content -LiteralPath (Join-Path $root 'data\update\back.json') -Value '{}' -Encoding ascii
    }
    . $updateStart
    $updated = Invoke-XsegonUpdate $root $phpPath
    if ($updated) {
        Write-Host "  Xsegon $(if ($updated -eq 'back') { 'went back to the version before' } else { 'was updated' }): starting it." -ForegroundColor Cyan
        $again = @{} + $PSBoundParameters
        [void]$again.Remove('GoBack')
        try { & (Join-Path $root 'start.ps1') @again; exit $LASTEXITCODE }
        catch {
            # The new start.ps1 would not run at all: the version before is put back, and starts.
            if ($updated -eq 'switched' -and (Undo-XsegonUpdate $root $phpPath)) { & (Join-Path $root 'start.ps1') @again; exit $LASTEXITCODE }
            throw
        }
    }
}

Write-Host ''
Write-Host "  http://127.0.0.1:$port" -ForegroundColor Cyan
Write-Host '  Ctrl+C to stop.' -ForegroundColor DarkGray
Write-Host ''

# --- the server, then its own fullscreen window -----------------------------
# How the window opens is in bin\open.ps1, which api\open.php also runs.
# -Windowed or -NoBrowser skips either half.

# The certificates for HTTPS (picture downloads) beside whichever php.exe was
# found, rather than a path in php.ini that is only right on one PC.
$phpArgs = @()
$caFile = Join-Path (Split-Path $phpPath -Parent) 'cacert.pem'
if (Test-Path -LiteralPath $caFile) {
    $phpArgs += @('-d', "openssl.cafile=`"$caFile`"", '-d', "curl.cainfo=`"$caFile`"")
}
# On Windows every PHP with the same opcache id shares one cache, and a second
# PHP on it stops at once ("Opcode handlers are unusable due to ASLR"), so each
# Xsegon folder gets its own id ($cacheId, above). A file cache in data\ does
# not work: it nests whole folder paths deeper than Explorer can delete.
$phpArgs += @('-d', "opcache.cache_id=$cacheId")
# FFI, so the masthead's minimise and close call Windows directly
# (includes\wincontrol.php) rather than starting a PowerShell. Without it they
# take the slower road and still work.
if (Test-Path -LiteralPath (Join-Path (Split-Path $phpPath -Parent) 'ext\php_ffi.dll')) {
    $phpArgs += @('-d', 'extension=ffi', '-d', 'ffi.enable=1')
}
# Update now says whether Xsegon opens again by itself (includes\update.php): only a start that waits on the window does.
if ($hiding) { $env:XSEGON_RESTARTS = '1' } else { Remove-Item Env:XSEGON_RESTARTS -ErrorAction SilentlyContinue }
$server = Start-Process -FilePath $phpPath -NoNewWindow -PassThru -ArgumentList ($phpArgs + @(
    '-S', "127.0.0.1:$port", '-t', "`"$root`"", "`"$(Join-Path $root 'router.php')`""))

# Wait for the port rather than a fixed sleep, watched in the listener table:
# a connect made a moment before PHP listens is refused only after 2 seconds.
$up = $false
for ($i = 0; $i -lt 120 -and -not $up -and -not $server.HasExited; $i++) {
    $up = Test-PortListening $port
    if (-not $up) { Start-Sleep -Milliseconds 50 }
}

# The port being open is not the same as the app working: a PHP that dies on
# a parse error can still have been listening for a moment. Ask it something.
$alive = $up -and (Test-XsegonAlive $port)

# The first start of a version just put in place: one that does not answer is taken out again.
$firstStart = Join-Path $root 'data\update\first-start.json'
if (Test-Path -LiteralPath $firstStart) {
    Remove-Item -LiteralPath $firstStart -Force -ErrorAction SilentlyContinue
    if (-not $alive) {
        if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
        for ($i = 0; $i -lt 20 -and (Test-PortListening $port); $i++) { Start-Sleep -Milliseconds 150 }
        . (Join-Path $root 'bin\update-start.ps1')
        if (Undo-XsegonUpdate $root $phpPath) {
            Write-Line 'the new version did not answer at its first start: the version before is back'
            Write-Host '  The new version did not start on this PC. The version before is back: starting it.' -ForegroundColor Yellow
            & (Join-Path $root 'start.ps1') @PSBoundParameters
            exit $LASTEXITCODE
        }
    }
}

if (-not $alive) {
    Write-Host ''
    if ($server.HasExited) {
        Write-Host "  php.exe stopped straight away (exit code $($server.ExitCode))." -ForegroundColor Red
        Write-Host '  The lines above are its reason.' -ForegroundColor Yellow
    } elseif (-not $up) {
        Write-Host "  php.exe started but nothing is listening on $port after 6 seconds." -ForegroundColor Red
    } else {
        Write-Host "  Something is listening on $port but it is not answering as Xsegon." -ForegroundColor Red
        Write-Host '  Look for a PHP error above, or in data\log\.' -ForegroundColor Yellow
    }
    Write-Host ''
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
    Show-Self
    pause
    exit 1
}

# --- a Games folder, for a copy that has none --------------------------------
# Asked on every start, made once (includes\scan.php says where and when): a
# new person gets a Games folder with a folder per console before the guide
# asks where the games are. Nothing here can stop the start.
try {
    $first = (Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/scan.php" -Method Post -ContentType 'application/json' `
        -Body '{"action":"firstFolder"}' -UseBasicParsing -TimeoutSec 10).Content | ConvertFrom-Json
    if ($first.made) {
        Write-Host "  Games     : $($first.path)" -ForegroundColor Cyan
        Write-Host "              made just now, with a folder for each console: put your games in it." -ForegroundColor DarkGray
        Write-Host ''
    }
} catch { }

if (-not $NoBrowser) {
    $said = & (Join-Path $root 'bin\open.ps1') -Port $port -Windowed:$Windowed
    if ($said -eq 'no-browser') {
        Write-Host '  No Chrome or Edge found - open the address above yourself.' -ForegroundColor DarkYellow
        Write-Host '  Closing this window stops Xsegon.' -ForegroundColor DarkGray
        Show-Self                         # no app window will come: this one is the way to stop it
        $hiding = $false
    }
}

if (-not $hiding) {
    try { Wait-Process -Id $server.Id } finally {
        if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
    }
    exit 0
}

# --- out of sight: the server ends with the app window ----------------------
# Looked at every two seconds. The window gone for $GoneSec in a row ends the
# server: longer than a restart of the window takes. A game still running
# keeps the server until it ends.
$GoneSec = 12
Write-Line "the server (process $($server.Id)) runs out of sight on port ${port}: it ends when the app window has been closed for ${GoneSec}s"
. (Join-Path $root 'bin\xsbrowser.ps1')
function Test-GameOn {
    try {
        $j = (Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/running.php" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
        return [bool]$j.running
    } catch { return $false }
}
try {
    $began = Get-Date
    $seen = $false
    $goneAt = $null
    $heldFor = ''
    while (-not $server.HasExited) {
        Start-Sleep -Seconds 2
        # Quick first; the slow look only once the process written down has gone
        # (a browser can hand its window to another copy of itself).
        $win = $null
        try {
            $win = Get-XsegonBrowser $root
            if (-not $win) { $win = Get-XsegonBrowser $root -Search }
        } catch { $win = $true }          # Windows would not say: taken as open, and the server stays
        if ($win) { $seen = $true; $goneAt = $null; $heldFor = ''; continue }
        if (-not $seen) {
            # It never came: say so where it can be read, and wait as a plain start does.
            if (((Get-Date) - $began).TotalSeconds -lt 30) { continue }
            Write-Line 'the app window never opened: the server stays, and its window is shown'
            Write-Host '  The app window did not open. Open the address above in Chrome or Edge.' -ForegroundColor Yellow
            Write-Host '  Closing this window stops Xsegon.' -ForegroundColor DarkGray
            Show-Self
            Wait-Process -Id $server.Id
            break
        }
        if (-not $goneAt) { $goneAt = Get-Date }
        # Update now or Go back closed the window: no waiting for it to come back.
        if ((Test-Path -LiteralPath (Join-Path $root 'data\update\go.json')) -or (Test-Path -LiteralPath (Join-Path $root 'data\update\back.json'))) {
            Write-Line "the app window was closed to update: ending the server (process $($server.Id))"
            break
        }
        if (((Get-Date) - $goneAt).TotalSeconds -lt $GoneSec) { continue }
        if (Test-GameOn) {
            if (-not $heldFor) { $heldFor = 'game'; Write-Line 'the app window is closed but a game is still running: the server stays until it ends' }
            continue
        }
        Write-Line "the app window has been closed for ${GoneSec}s: ending the server (process $($server.Id))"
        break
    }
    if ($server.HasExited) { Write-Line "the server ended by itself (exit code $($server.ExitCode))" }
} finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}

# Update now or Go back closed the window: with the server ended, the switch is made and Xsegon opens again.
if ((Test-Path -LiteralPath (Join-Path $root 'data\update\go.json')) -or (Test-Path -LiteralPath (Join-Path $root 'data\update\back.json'))) {
    for ($i = 0; $i -lt 20 -and (Test-PortListening $port); $i++) { Start-Sleep -Milliseconds 150 }
    Write-Line 'starting again to put the new version in place'
    & (Join-Path $root 'start.ps1') @PSBoundParameters
    exit $LASTEXITCODE
}
