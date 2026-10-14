<#
    Xsegon - open the app window: its own, fullscreen, nothing else affected.

    Usage:  bin\open.ps1 [-Port 8099] [-Windowed] [-Restart [-Scale 1.5]] [-Fit]

    A web page cannot make itself fullscreen; that belongs to how the window
    is started, so start.ps1 and api\open.php both come through here.

    --user-data-dir is the trick: with its own profile the browser starts a
    separate process that honours the flags. Without it, Chrome hands the URL
    to the window already open and drops them. The normal browser is never
    touched. An open window is brought to the front instead of a second one.
#>

param(
    [int]$Port = 8099,
    [switch]$Windowed,
    # Close the window that is open and start a fresh one: asked by the
    # page when its code would not start, or by bin\watchdog.ps1 when the
    # window stopped beating. $Why is for the log.
    [switch]$Restart,
    [string]$Why = '',
    # Everything drawn at this scale, whatever the screen: 1.5 on a 1920 x 1200
    # screen is the page as a 1280 x 800 one sees it. By hand, with -Restart;
    # without it the scale is worked out from the screen (bin\xsbrowser.ps1).
    [double]$Scale = 0,
    # Asked by the page when its screen changed (a TV plugged in, or taken
    # away): the open window is opened again if its scale is not this
    # screen's, and nothing else happens. Never opens a window by itself.
    [switch]$Fit
)

$ErrorActionPreference = 'Stop'

$root       = Split-Path -Parent $PSScriptRoot
$profileDir = Join-Path $root 'data\browser-profile'
. (Join-Path $PSScriptRoot 'xsbrowser.ps1')

# --- already open? bring it forward ----------------------------------------
$proc = Get-XsegonBrowser $root
if ($Fit -and -not $proc) { 'not-open'; exit 0 }

# The scale is the browser's from its start, so an open window keeps the one of
# the screen it was started on. On another screen now, it is opened again in
# place of being brought forward. Not while a game is on: the window is put
# away then, and would come up over the game.
$refit = 0
if ($proc -and -not $Restart) {
    $fits = @{ again = $false; say = $null; refit = 0 }
    if (-not (Test-Path -LiteralPath (Join-Path $root 'data\running.json'))) {
        $age = try { ((Get-Date) - $proc.StartTime).TotalSeconds } catch { 3600 }
        $fits = Get-XsegonMisfit $root -Age $age
    }
    if ($fits.again) { $Restart = $true; $Why = $fits.say; $refit = $fits.refit }
    elseif ($Fit) {
        if ($fits.say) { Write-XsegonLine $root 'WIN' $fits.say }
        'fits'
        exit 0
    }
}

if ($proc -and $Restart) {
    Write-XsegonLine $root 'WDOG' ("restarting the app window" + $(if ($Why) { ": $Why" } else { '' }))
    try {
        # The polite close first, so the profile is saved cleanly and the
        # next start does not open on a "restore pages?" bubble.
        [void]$proc.CloseMainWindow()
        if (-not $proc.WaitForExit(5000)) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            [void]$proc.WaitForExit(5000)
            Write-XsegonLine $root 'WDOG' 'the window did not close when asked; it was ended'
        }
    } catch {
        Write-XsegonLine $root 'WDOG' "closing the window failed: $($_.Exception.Message)"
    }
    Start-Sleep -Milliseconds 500      # the profile's lock lets go
    $proc = $null
}

if ($proc) {
    if ($proc.MainWindowHandle -ne 0) {
        Add-Type -Namespace Xs -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
'@
        if ([Xs.Win]::IsIconic($proc.MainWindowHandle)) { [void][Xs.Win]::ShowWindow($proc.MainWindowHandle, 9) }
        # Windows only lets a process take the foreground if it recently had
        # input; a tap of ALT is the documented way to qualify.
        (New-Object -ComObject WScript.Shell).SendKeys('%')
        [void][Xs.Win]::SetForegroundWindow($proc.MainWindowHandle)
        'focused'
        exit 0
    }
}

# --- otherwise start it ------------------------------------------------------
$browser = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $browser) {
    Write-XsegonLine $root 'WIN' 'open asked, but no Chrome or Edge was found to open the window with'
    'no-browser'
    exit 2
}

# ?app=1 tells the page it is in this window, so it shows its own minimise
# and close buttons (the kiosk window has none of its own).
$flags = @("--app=http://127.0.0.1:$Port/?app=1", "--user-data-dir=`"$profileDir`"",
           '--no-first-run', '--no-default-browser-check',
           # Sounds and videos play without a first click.
           '--autoplay-policy=no-user-gesture-required')
# --kiosk, not --start-fullscreen: after the first start Chrome restores its
# remembered window size and --start-fullscreen loses. F11 does not leave
# kiosk; Alt+F4 closes, and -Windowed gives a normal window.
if (-not $Windowed) { $flags += '--kiosk' }
# A screen bigger than 1920 x 1200: everything larger, not small in the middle.
$drawn = Get-XsegonScale $root $Scale
$drawn.refit = $refit
if ($drawn.say) { Write-XsegonLine $root 'WIN' $drawn.say }
$scaleFlag = Format-XsegonScaleFlag $drawn.by
if ($scaleFlag) { $flags += $scaleFlag }

$started = Start-Process -FilePath $browser -ArgumentList $flags -PassThru
# Written down for window.ps1 and the next open. On some PCs this process ends
# at once and the window lives in another, so the watchdog and window.ps1 look
# for the real one, and the log names the browser and version.
if ($started) {
    Save-XsegonBrowser $root $started $drawn
    $version = try { (Get-Item -LiteralPath $browser).VersionInfo.ProductVersion } catch { 'unknown version' }
    Write-XsegonLine $root 'WIN' ("opened the app window with " + (Split-Path $browser -Leaf) + " " + $version +
        " (process " + $started.Id + ")" + $(if ($Windowed) { ', windowed' } else { ', full screen' }))
}

# The window's watchdog (bin\watchdog.ps1): restarts it if its heartbeat
# stops while it is still open. One per window: it ends with the window.
if ($started) {
    try {
        $wd = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File',
                "`"$(Join-Path $PSScriptRoot 'watchdog.ps1')`"", '-Port', $Port, '-BrowserPid', $started.Id)
        if ($Windowed) { $wd += '-Windowed' }
        Start-Process -FilePath 'powershell.exe' -ArgumentList $wd -WindowStyle Hidden | Out-Null
    } catch {
        Write-XsegonLine $root 'WDOG' "the watchdog did not start: $($_.Exception.Message)"
    }
} else {
    Write-XsegonLine $root 'WIN' 'the app window did not start'
}
'opened'
