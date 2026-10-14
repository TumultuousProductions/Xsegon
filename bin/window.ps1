<#
    Xsegon - minimise or close the app window.

    Usage:  bin\window.ps1 -Op minimize|close

    The kiosk window (bin\open.ps1) has no title bar, and a web page cannot
    minimise its own window or close one it did not open, so the masthead's
    two buttons ask the server, which does it from here. Only the browser
    holding Xsegon's own profile is ever touched.
#>

param(
    [Parameter(Mandatory = $true)][ValidateSet('minimize', 'close')][string]$Op,
    # One window rather than the whole browser: a web game of your own opens
    # in its own window beside the wall (play.php), and its X and minimise
    # must act on THAT window, not on Xsegon. Matched on the window's title.
    [string]$Title = ''
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'xsbrowser.ps1')

# The process holding Xsegon's own profile. One process can own several
# windows: the wall and a game beside it.
# -Search: a press on Minimise or Close came from the window, so "not open"
# is only believed after its real owner has been looked for (xsbrowser.ps1).
$proc = Get-XsegonBrowser $root -Search
if (-not $proc) { Write-XsegonLine $root 'WIN' "$Op asked, but no browser process holding Xsegon's own profile could be found, so the app window is taken as not open"; 'no-window'; exit 2 }

# The app window's close needs nothing compiled below, so it goes first:
# it is the one a person waits on.
if (-not $Title -and $Op -eq 'close') {
    if ($proc.MainWindowHandle -eq 0) { Write-XsegonLine $root 'WIN' "$Op asked, but the app window has no window yet"; 'no-window'; exit 2 }
    # The polite close (WM_CLOSE), so the profile is saved cleanly and the next
    # start does not open on a "restore pages?" bubble. Force only if ignored.
    [void]$proc.CloseMainWindow()
    if (-not $proc.WaitForExit(3000)) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    'closed'
    exit 0
}

Add-Type -Namespace Xs -Name WinCtl -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
public delegate bool EnumProc(IntPtr h, IntPtr p);
'@

# Every visible top-level window belonging to Xsegon's own browser.
function Get-XsegonWindows {
    $ids = @($proc.Id)
    $out = New-Object System.Collections.ArrayList
    $cb = [Xs.WinCtl+EnumProc] {
        param($h, $p)
        if ([Xs.WinCtl]::IsWindowVisible($h)) {
            $owner = 0
            [void][Xs.WinCtl]::GetWindowThreadProcessId($h, [ref]$owner)
            if ($ids -contains [int]$owner) {
                $sb = New-Object System.Text.StringBuilder 512
                [void][Xs.WinCtl]::GetWindowTextW($h, $sb, 512)
                $t = $sb.ToString()
                if ($t) { [void]$out.Add([pscustomobject]@{ Handle = $h; Title = $t; Pid = [int]$owner }) }
            }
        }
        return $true
    }
    [void][Xs.WinCtl]::EnumWindows($cb, [IntPtr]::Zero)
    $out
}

$windows = @(Get-XsegonWindows)

if ($Title) {
    # Chrome appends its own suffix to a window title, so match on a prefix.
    $target = $windows | Where-Object { $_.Title -eq $Title -or $_.Title -like "$Title*" } | Select-Object -First 1
    if (-not $target) { Write-XsegonLine $root 'WIN' "$Op asked for `"$Title`", but no window wears that title"; 'no-window'; exit 2 }

    if ($Op -eq 'close') {
        [void][Xs.WinCtl]::PostMessageW($target.Handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)   # WM_CLOSE
        'closed'
    } else {
        [void][Xs.WinCtl]::ShowWindow($target.Handle, 6)                                          # SW_MINIMIZE
        'minimized'
    }
    exit 0
}

# No title: minimise the app window itself, as the masthead's button has
# always meant. (Closing it was handled above.)
if ($proc.MainWindowHandle -eq 0) { Write-XsegonLine $root 'WIN' "$Op asked, but the app window has no window yet"; 'no-window'; exit 2 }

[void][Xs.WinCtl]::ShowWindow($proc.MainWindowHandle, 6)     # SW_MINIMIZE
'minimized'
