<#
    Xsegon - which browser process is the app window. Dot-sourced by
    bin\open.ps1 and bin\window.ps1.

    open.ps1 writes data\browser.json when it starts the window: the process
    id and its start time, so a process that reuses the id is never taken for
    it. Reading that back is fast; reading every process's command line is
    far slower, and is the fallback when the record does not hold.
#>

. (Join-Path $PSScriptRoot 'xslog.ps1')          # Test-XsegonLogging

function Get-XsegonBrowserFile([string]$root) { Join-Path $root 'data\browser.json' }

# One line in data\log\<day>.log, the shape includes\boot.php writes. These
# scripts run detached with their answers thrown away, so an unhappy answer is
# written here too. Best effort: the log never breaks a window.
function Write-XsegonLine([string]$root, [string]$code, [string]$msg) {
    try {
        if (-not (Test-XsegonLogging (Join-Path $root 'data'))) { return }
        $dir = Join-Path $root 'data\log'
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $file = Join-Path $dir ((Get-Date).ToString('yyyy-MM-dd') + '.log')
        $line = (Get-Date).ToString('HH:mm:ss.fff') + ' S ' + $code.PadRight(4) + ' ' + $msg + "`n"
        [System.IO.File]::AppendAllText($file, $line, (New-Object System.Text.UTF8Encoding($false)))
    } catch { }
}

# $scale: how the window was started (Get-XsegonScale). Left out for a window found again, which keeps what
# was written down for it.
function Save-XsegonBrowser([string]$root, $proc, $scale = $null) {
    try {
        if (-not $scale) { $scale = Get-XsegonWindowScale $root }
        $rec = @{ pid = $proc.Id; started = $proc.StartTime.ToUniversalTime().Ticks.ToString()
                  scale = ([double]$scale.by).ToString('0.##', [Globalization.CultureInfo]::InvariantCulture)
                  hand = [bool]$scale.hand; refit = [int]$scale.refit } | ConvertTo-Json -Compress
        [IO.File]::WriteAllText((Get-XsegonBrowserFile $root), $rec)
    } catch { }
}

# How the open window was started: by = its scale (0 is Windows' own size), hand = asked for with -Scale,
# refit = how many times running it was opened again for its screen. A record without them is a window
# started before they were written down: Windows' own size.
function Get-XsegonWindowScale([string]$root) {
    $has = @{ by = 0.0; hand = $false; refit = 0 }
    try {
        $rec = Get-Content -LiteralPath (Get-XsegonBrowserFile $root) -Raw | ConvertFrom-Json
        if ($rec.PSObject.Properties['scale']) { $has.by = [double]::Parse([string]$rec.scale, [Globalization.CultureInfo]::InvariantCulture) }
        if ($rec.PSObject.Properties['hand'])  { $has.hand = [bool]$rec.hand }
        if ($rec.PSObject.Properties['refit']) { $has.refit = [int]$rec.refit }
    } catch { }
    return $has
}

# The slow way: every Chrome and Edge process asked for its command line, and
# the one holding Xsegon's own profile kept (its helpers carry --type=). With
# more than one, the one that has a window.
function Find-XsegonBrowser([string]$root) {
    $profileDir = Join-Path $root 'data\browser-profile'
    $found = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" |
               Where-Object { $_.CommandLine -like ("*" + [WildcardPattern]::Escape($profileDir) + "*") -and $_.CommandLine -notlike '*--type=*' })
    $procs = @($found | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | Where-Object { $_ })
    $withWindow = @($procs | Where-Object { $_.MainWindowHandle -ne 0 })
    if ($withWindow.Count) { return $withWindow[0] }
    if ($procs.Count) { return $procs[0] }
    return $null
}

<#  The app window's browser process, or $null when it is not open.

    -Search: when the process written down is gone, look for the window's
    real owner the slow way before answering "not open": a browser can hand
    its window to a copy of itself and end. Used by window.ps1 and the
    watchdog; a plain start does not pay for the search.                    #>
function Get-XsegonBrowser([string]$root, [switch]$Search) {
    $file = Get-XsegonBrowserFile $root
    if (Test-Path -LiteralPath $file) {
        try {
            $rec = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
            $p = Get-Process -Id ([int]$rec.pid) -ErrorAction SilentlyContinue
            if ($p -and $p.ProcessName -in @('chrome', 'msedge') -and
                $p.StartTime.ToUniversalTime().Ticks.ToString() -eq [string]$rec.started) { return $p }
            if (-not $Search) { return $null }       # the window it names has closed
            $real = Find-XsegonBrowser $root
            if ($real) {
                $was = try { ([datetime]::new([long]$rec.started, 'Utc')).ToLocalTime().ToString('HH:mm:ss') } catch { '?' }
                Write-XsegonLine $root 'WIN' ("the browser process written down (" + $rec.pid + ", started " + $was +
                    ") is gone, but the app window is open in process " + $real.Id + " (" + $real.ProcessName + ".exe, started " +
                    $real.StartTime.ToString('HH:mm:ss') + "): following that one from now on")
                Save-XsegonBrowser $root $real
            }
            return $real
        } catch { }                        # unreadable: ask the slow way
    }
    $p = Find-XsegonBrowser $root
    if ($p) { Save-XsegonBrowser $root $p }
    return $p
}

<#  How large everything is drawn in Xsegon's window.

    The page is laid out for a 1920 x 1200 screen and does not grow: on a 4K
    screen at 100% it stands small in the middle third. The browser can be
    told a scale when it starts (--force-device-scale-factor), which is to the
    page what Windows' own scaling is: a smaller screen, drawn sharper. So a
    screen bigger than 1920 x 1200 gets the scale at which it reads as one,
    and never a smaller one than Windows has set.

    Only for a browser of Xsegon's own profile, so no other window changes.
    It holds for the whole browser process: the wall and a web game's window
    share one, so both scripts that start it ask here.                      #>

# The main screen: its real size in pixels and Windows' scaling of it, or $null when Windows will not say.
function Get-XsegonScreen {
    try {
        if (-not ('Xs.Gdi' -as [type])) {
            Add-Type -Namespace Xs -Name Gdi -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
[DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
[DllImport("gdi32.dll")] public static extern int GetDeviceCaps(IntPtr dc, int i);
'@
        }
        $dc = [Xs.Gdi]::GetDC([IntPtr]::Zero)
        if ($dc -eq [IntPtr]::Zero) { return $null }
        try {
            $w    = [Xs.Gdi]::GetDeviceCaps($dc, 118)      # DESKTOPHORZRES: real pixels
            $h    = [Xs.Gdi]::GetDeviceCaps($dc, 117)      # DESKTOPVERTRES
            $seen = [Xs.Gdi]::GetDeviceCaps($dc, 8)        # HORZRES: what a program not told of the scaling sees
            $dpi  = [Xs.Gdi]::GetDeviceCaps($dc, 88)       # LOGPIXELSX: 96 is 100%, for a program that is told
        } finally { [void][Xs.Gdi]::ReleaseDC([IntPtr]::Zero, $dc) }
        if ($w -le 0 -or $h -le 0 -or $seen -le 0) { return $null }
        # Windows answers one way or the other, by how this PowerShell was started: the larger is the scaling.
        $scale = [math]::Max($w / [double]$seen, $dpi / 96.0)
        return @{ w = $w; h = $h; scale = [math]::Round($scale, 2) }
    } catch { return $null }
}

# The scale at which a screen reads as 1920 x 1200, in steps of 5%, rounded down so the page is never laid
# out smaller than that. 0: the screen is no bigger, or Windows' own scale is as large already (within 7.5%).
function Get-XsegonFit([int]$w, [int]$h, [double]$winScale) {
    if ($w -le 0 -or $h -le 0) { return 0 }
    $fit = [math]::Floor([math]::Min($w / 1920.0, $h / 1200.0) * 20 + 0.0001) / 20
    if ($fit -le [math]::Max(1.0, $winScale) + 0.075) { return 0 }
    return $fit
}

function Format-XsegonPercent([double]$f) { ([math]::Round($f * 100)).ToString([Globalization.CultureInfo]::InvariantCulture) + '%' }

<#  The scale Xsegon's window should have now. by: the number, 0 for Windows'
    own size (the screen is no bigger than 1920 x 1200, Settings > Window >
    Fill a big screen is off, or Windows would not say). hand: asked for with
    -Scale, whatever the screen. scr: the screen it was worked out from, $null
    when Windows would not say. say: the line for the log, or $null.
    -Screen is a made-up screen, for the tests.                              #>
function Get-XsegonScale([string]$root, [double]$Scale = 0, $Screen = $null) {
    $none = @{ by = 0.0; hand = $false; scr = $null; say = $null }
    try {
        if ($Scale -gt 0) {
            $by = [math]::Min(4.0, [math]::Max(0.25, $Scale))
            return @{ by = $by; hand = $true; scr = $null
                      say = "everything is drawn at " + (Format-XsegonPercent $by) + ", asked for by hand (bin\open.ps1 -Scale)" }
        }
        $scr = if ($Screen) { $Screen } else { Get-XsegonScreen }
        if (-not $scr) {
            $none.say = "Windows would not say how big the screen is: everything stays at Windows' own size"
            return $none
        }
        $none.scr = $scr
        $fit = Get-XsegonFit ([int]$scr.w) ([int]$scr.h) ([double]$scr.scale)
        if ($fit -le 0) { return $none }
        $what = "a " + $scr.w + " x " + $scr.h + " screen, which Windows has at " + (Format-XsegonPercent $scr.scale)
        $on = $true
        $file = Join-Path $root 'data\settings.json'
        if (Test-Path -LiteralPath $file) {
            $s = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
            if ($s.window -and $s.window.PSObject.Properties['fillBigScreen'] -and $s.window.fillBigScreen -eq $false) { $on = $false }
        }
        if (-not $on) {
            $none.say = $what + ": Fill a big screen is off (Settings > Window), so everything stays at that size"
            return $none
        }
        return @{ by = $fit; hand = $false; scr = $scr
                  say = $what + ": everything is drawn at " + (Format-XsegonPercent $fit) + ", so the page is laid out as on a " +
                        [math]::Round($scr.w / $fit) + " x " + [math]::Round($scr.h / $fit) + " screen (Settings > Window > Fill a big screen)" }
    } catch { return @{ by = 0.0; hand = $false; scr = $null; say = $null } }
}

# The browser flag for that scale, or $null for Windows' own size. Says what it did in the log unless -Quiet.
function Get-XsegonScaleFlag([string]$root, [double]$Scale = 0, $Screen = $null, [switch]$Quiet) {
    $s = Get-XsegonScale $root $Scale $Screen
    if ($s.say -and -not $Quiet) { Write-XsegonLine $root 'WIN' $s.say }
    return (Format-XsegonScaleFlag $s.by)
}
function Format-XsegonScaleFlag([double]$by) {
    if ($by -le 0) { return $null }
    return '--force-device-scale-factor=' + $by.ToString('0.##', [Globalization.CultureInfo]::InvariantCulture)
}

<#  Does the open window still fit its screen? The scale is given to the
    browser when it starts, so a window that was open when a TV was plugged in,
    or taken away, has the other screen's. again: open it again. say: the line
    for the log. refit: how many times running that makes.

    Left as it is when its size was asked for by hand, when Windows will not
    say how big the screen is, and after two openings in a minute for the same
    reason: a window that keeps reappearing is worse than one of the wrong size.
    -Age is how long the window has been open, in seconds.                   #>
function Get-XsegonMisfit([string]$root, $Screen = $null, [double]$Age = 3600) {
    $stay = @{ again = $false; say = $null; refit = 0 }
    try {
        $has = Get-XsegonWindowScale $root
        $at = { param($by) if ($by -gt 0) { "at " + (Format-XsegonPercent $by) } else { "at Windows' own size" } }
        if ($has.hand) {
            $stay.say = "the window's size was asked for by hand (" + (Format-XsegonPercent $has.by) + "): left as it is"
            return $stay
        }
        $want = Get-XsegonScale $root 0 $Screen
        if (-not $want.scr) {
            $stay.say = "Windows would not say how big the screen is: the window is left as it is"
            return $stay
        }
        $what = "a " + $want.scr.w + " x " + $want.scr.h + " screen, which Windows has at " + (Format-XsegonPercent $want.scr.scale)
        if ([math]::Abs($want.by - $has.by) -lt 0.01) {
            $stay.say = "the window fits its screen (" + $what + ", drawn " + (& $at $has.by) + "): left as it is"
            return $stay
        }
        $why = "the screen is now " + $what + ": the window was opened " + (& $at $has.by) + ", and this screen is drawn " + (& $at $want.by)
        $n = if ($Age -lt 60) { $has.refit + 1 } else { 1 }
        if ($n -gt 2) {
            $stay.say = $why + ". It was opened again for its screen twice in the last minute: not a third time"
            return $stay
        }
        return @{ again = $true; say = $why; refit = $n }
    } catch { return $stay }
}
