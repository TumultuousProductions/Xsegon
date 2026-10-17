<#
    Xsegon - the launcher.

    A script rather than PHP: when a game will not start, run this line in a
    terminal and read the real error:

        .\bin\launch.ps1 -Exe "...\retroarch_wrapper.bat" -Arguments '-L "cores\x.dll" -f "E:\rom.zip"' -Title "Test"

    Started detached by api\launch.php, it waits for the game, so the web
    server goes back to serving while this knows when play ended. LaunchBox's
    retroarch_wrapper.bat runs RetroArch synchronously, so waiting on it waits
    on the game.
#>

param(
    [Parameter(Mandatory = $true)][string] $Exe,
    [string] $Arguments = '',
    [string] $GameId    = '',
    [string] $Title     = '(unknown)',
    [string] $Platform  = '',
    # 'retroarch' or 'other': written into running.json, so the page offers
    # Stop game only where it can work.
    [string] $Kind      = '',
    [string] $DataDir   = '',
    [string] $RomPath   = '',
    [string] $FocusTitle = 'Xsegon',
    [switch] $RestoreFocus,
    # Once the game's window is up, minimise Xsegon and hand the game the
    # keyboard (see STEPPING ASIDE below).
    [switch] $StepAside,
    # A save state slot the picker chose (api\launch.php put state_slot in the
    # arguments already); with a port, RetroArch's network commands are on and
    # the load is sent from here instead of waiting for a hotkey press. A port
    # with no slot: RetroArch is only asked whether the game got going.
    [int]    $StateSlot = -1,
    [int]    $NetPort   = 0,
    # A Steam game (api\steam.php) is followed by the folder it is installed
    # in, and by its program's name, rather than by the program started.
    # -ViaSteam: Steam was asked to start it, so steam.exe is started and left.
    [string] $WatchDir   = '',
    [string] $WatchNames = '',
    [switch] $ViaSteam,
    # Only when RetroArch could not be asked (no port, or no answer): a game
    # that ends with an error code after this many seconds was played, and is
    # taken as closed, not failed. Tests pass a small one.
    [int]    $PlayedFor  = 10,
    # What api\launch.php knew before the start that would explain a game not
    # starting (a BIOS file not in place). Said only if the start fails.
    [string] $FailHint   = '',
    # 'on': note the display's mode before the game and put it back after
    # (Invoke-DisplayGuard below). 'dry': only say what would be done; tests
    # pass this. Nothing: the display is not looked at.
    [ValidateSet('', 'on', 'dry')][string] $DisplayGuard = '',
    [switch] $Log
)

$ErrorActionPreference = 'Stop'

# One line in data\log\<day>.log, the same shape as includes\boot.php writes,
# so a launch reads as one story: the request (PHP), the run and the exit
# (here). Best effort and silent: the log never breaks a launch.
function Write-Log([string] $code, [string] $msg) {
    if (-not $Log) { return }
    try {
        $dir = Join-Path $DataDir 'log'
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $file = Join-Path $dir ((Get-Date).ToString('yyyy-MM-dd') + '.log')
        $line = (Get-Date).ToString('HH:mm:ss.fff') + ' S ' + $code.PadRight(4) + ' ' + $msg + "`n"
        [System.IO.File]::AppendAllText($file, $line, (New-Object System.Text.UTF8Encoding($false)))
    } catch { }
}

if (-not $DataDir) { $DataDir = Join-Path $PSScriptRoot '..\data' }
$DataDir = (Resolve-Path -LiteralPath $DataDir -ErrorAction SilentlyContinue).Path
if (-not $DataDir) {
    $DataDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'data'
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

# A death outside the try below would leave the game marked as running and
# Xsegon minimised: the trap logs it, removes the marker and shows the window.
trap {
    Write-Log 'LNCH' ("the launcher died: " + $_.Exception.Message + ' at line ' + $_.InvocationInfo.ScriptLineNumber)
    try { if ($runningFile) { Remove-Item -LiteralPath $runningFile -Force -ErrorAction SilentlyContinue } } catch { }
    try {
        if ($script:steppedAside) {
            [Xsegon.Fg]::ShowWindow($script:steppedAside, 9) | Out-Null       # SW_RESTORE
            Write-Log 'LNCH' 'Xsegon shown again after the launcher died'
        }
    } catch { }
    break
}

$runningFile = Join-Path $DataDir 'running.json'
$errorFile   = Join-Path $DataDir 'last-error.json'
$sessionFile = Join-Path $DataDir 'sessions.jsonl'
$cmdFile     = Join-Path $DataDir 'last-launch.bat'

<#  Every game's last launch, ok or not, in data\launch-results.json: a game
    whose last launch failed is greyed out under NEEDS FIX wherever it shows
    (includes\needsfix.php), until a launch of it goes well. Written whole
    beside itself and moved into place, so a reader never sees half of it. #>
function Set-LaunchResult([bool] $ok, [string] $why) {
    if (-not $GameId) { return }
    $file = Join-Path $DataDir 'launch-results.json'
    try {
        $all = @{}
        # A file that is there and will not read is left alone: starting it
        # again would lose every other game's result. Asked three times first,
        # since a scanner's hold is short; an empty file is started again.
        if (Test-Path -LiteralPath $file) {
            $read = $false; $err = ''
            for ($try = 1; $try -le 3 -and -not $read; $try++) {
                try {
                    $raw = [System.IO.File]::ReadAllText($file)
                    if ($raw.Trim()) {
                        $old = $raw | ConvertFrom-Json
                        if ($old) { $old.PSObject.Properties | ForEach-Object { $all[$_.Name] = $_.Value } }
                    }
                    $read = $true
                } catch {
                    $err = $_.Exception.Message
                    if ($try -lt 3) { Start-Sleep -Milliseconds 200 }
                }
            }
            if (-not $read) {
                Write-Log 'LNCH' "launch-results.json did not read ($err): left as it is, so how $Title went is not recorded this time. If this repeats, the file is damaged: delete it"
                return
            }
        }
        $all[$GameId] = @{ ok = $ok; at = (Get-Date).ToString('o'); title = $Title; why = $why }
        $tmp = "$file.$PID.part"
        [System.IO.File]::WriteAllText($tmp, ($all | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $tmp -Destination $file -Force
    } catch {
        Write-Log 'LNCH' "could not record how $Title went: $($_.Exception.Message)"
    }
}

function Write-Failure([string] $why) {
    Set-LaunchResult $false $why
    @{
        at       = (Get-Date).ToString('o')
        gameId   = $GameId
        title    = $Title
        platform = $Platform
        exe      = $Exe
        rom      = $RomPath
        error    = $why
    } | ConvertTo-Json | Set-Content -LiteralPath $errorFile -Encoding UTF8
    Remove-Item -LiteralPath $runningFile -ErrorAction SilentlyContinue
    Write-Host "launch failed: $why" -ForegroundColor Red
    Write-Log 'LNCH' "fail $Title : $why"
}

<#  A game's processes, found by where they live: any program inside its
    folder, or one wearing the game's own program name (a process protected
    by anti-cheat will not say where it lives).                             #>
function Get-GameProcess([string] $dir, [string[]] $names) {
    $prefix = $dir.TrimEnd('\') + '\'
    @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $path = $null
        try { $path = $_.Path } catch { }
        ($path -and $path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) -or
        ($names.Count -gt 0 -and $names -contains $_.ProcessName)
    })
}

<#  Wait up to $firstWait seconds for the game to appear, then until it has
    gone. Gone means none of it running for 15 seconds together: a launcher
    handing over to the game, or a game restarting itself through Steam,
    leaves a gap, and the session must not end inside it. Returns the first
    and last moments it was seen, or $null if it never came.                #>
function Watch-Game([string] $dir, [string[]] $names, [int] $firstWait) {
    $deadline = (Get-Date).AddSeconds($firstWait)
    $procs = @()
    while ((Get-Date) -lt $deadline) {
        $procs = Get-GameProcess $dir $names
        if ($procs.Count) { break }
        Start-Sleep -Seconds 1
    }
    if (-not $procs.Count) { return $null }
    $from = Get-Date
    Write-Log 'LNCH' ("follow $Title" + ': ' + ((@($procs | ForEach-Object { $_.ProcessName + '.exe' }) | Select-Object -Unique) -join ', '))
    while ($true) {
        foreach ($p in $procs) {
            try { $p.WaitForExit(); continue } catch { }
            # no right to wait on it (a protected process): look every two seconds instead
            while (Get-Process -Id $p.Id -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 2 }
        }
        $to = Get-Date
        $graceEnd = (Get-Date).AddSeconds(15)
        $procs = @()
        while ((Get-Date) -lt $graceEnd) {
            $procs = Get-GameProcess $dir $names
            if ($procs.Count) { break }
            Start-Sleep -Seconds 1
        }
        if (-not $procs.Count) { return @{ From = $from; To = $to } }
    }
}

# --- checks worth making before anything is spawned ----------------------
# Checked here, at the moment it matters, where the answer can be shown.

if (-not (Test-Path -LiteralPath $Exe)) {
    Write-Failure "emulator not found: $Exe"
    exit 1
}
if ($RomPath -and -not (Test-Path -LiteralPath $RomPath)) {
    Write-Failure "ROM not found: $RomPath"
    exit 1
}

# --- the command, written down where you can read it ---------------------
# A .bat instead of PowerShell's argument quoting through cmd.exe: when a
# launch goes wrong, last-launch.bat is exactly what ran, to double-click.

<#  THE WORKING DIRECTORY IS NOT OPTIONAL.
    LaunchBox writes core paths relative to the emulator (-L "cores\x.dll"),
    and RetroArch resolves them against its working directory: started from
    anywhere else, it exits 1 at once. A `cd` line in the .bat, not
    Start-Process -WorkingDirectory, so last-launch.bat reproduces it whole. #>

# A batch file reads % as the start of a variable and drops a lone one, so
# "100% Orange Juice" would reach the game as "100 Orange Juice". Doubled,
# it reaches it as written. Nothing Xsegon launches uses a %variable%.
$workDir = (Split-Path $Exe -Parent).Replace('%', '%%')

$line = '"' + $Exe.Replace('%', '%%') + '" ' + ([string]$Arguments).Replace('%', '%%')

<#  THE .bat IS UTF-8, AND SAYS SO TO cmd.
    cmd.exe reads a batch file in the OEM code page, so a name with an accent
    reaches the game wrong. "chcp 65001" switches cmd to UTF-8 for the lines
    after it. No BOM: cmd would read one as part of the first command.     #>
[System.IO.File]::WriteAllText($cmdFile,
    "@echo off`r`nchcp 65001 >nul`r`ncd /d `"$workDir`"`r`n$line`r`n",
    (New-Object System.Text.UTF8Encoding($false)))

@{
    gameId    = $GameId
    title     = $Title
    platform  = $Platform
    kind      = $Kind
    startedAt = (Get-Date).ToString('o')
    # this launcher, alive until the game has ended: api\launch.php asks
    # whether it still is before starting another game
    launcherPid = $PID
} | ConvertTo-Json | Set-Content -LiteralPath $runningFile -Encoding UTF8

Remove-Item -LiteralPath $errorFile -ErrorAction SilentlyContinue

# LaunchBox's wrapper keeps its own log beside itself. Its length now, so only
# what this launch appends is read (THE WRAPPER SWALLOWS FAILURES, below):
# length, not timestamps, as those are in the machine's locale format.
$wrapperLog = Join-Path (Split-Path $Exe -Parent) 'launch_log.txt'
$logWasAt = 0
if (Test-Path -LiteralPath $wrapperLog) {
    $logWasAt = (Get-Item -LiteralPath $wrapperLog).Length
}

<#  The window calls, compiled once, for stepping aside at the start and
    coming home at the end (WHY THIS IS NOT AppActivate, further down).    #>
function Initialize-Fg {
    if ('Xsegon.Fg' -as [type]) { return }
    Add-Type -Namespace Xsegon -Name Fg -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
'@
}

<#  Put a window in front and give it the keyboard: attach to the input of
    the window in front now, then ask. Only if Windows still refuses is the
    documented ALT tap used, and then once, so a lone ALT never reaches a
    window that was going to come forward anyway. True when it is in front. #>
function Set-Front([IntPtr] $hwnd) {
    Initialize-Fg
    for ($try = 0; $try -lt 2; $try++) {
        if ($try -eq 1) {
            [Xsegon.Fg]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)      # ALT down
            [Xsegon.Fg]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)      # ALT up
        }
        $fgThread  = [Xsegon.Fg]::GetWindowThreadProcessId([Xsegon.Fg]::GetForegroundWindow(), [IntPtr]::Zero)
        $ourThread = [Xsegon.Fg]::GetCurrentThreadId()
        $attached = $false
        if ($fgThread -ne 0 -and $fgThread -ne $ourThread) {
            $attached = [Xsegon.Fg]::AttachThreadInput($ourThread, $fgThread, $true)
        }
        try {
            [Xsegon.Fg]::BringWindowToTop($hwnd) | Out-Null
            [void][Xsegon.Fg]::SetForegroundWindow($hwnd)
        } finally {
            if ($attached) { [Xsegon.Fg]::AttachThreadInput($ourThread, $fgThread, $false) | Out-Null }
        }
        Start-Sleep -Milliseconds 100
        if ([Xsegon.Fg]::GetForegroundWindow() -eq $hwnd) { return $true }
    }
    return $false
}

<#  Xsegon's own window: the browser bin\open.ps1 started with Xsegon's
    profile (bin\xsbrowser.ps1), never a window that merely has "Xsegon" in
    its title, as an editor with this folder open does. By title only when
    the app was opened some other way (a plain browser tab, a test).       #>
function Get-XsegonWindow {
    try {
        . (Join-Path $PSScriptRoot 'xsbrowser.ps1')
        $b = Get-XsegonBrowser (Split-Path $PSScriptRoot -Parent)
        if ($b -and $b.MainWindowHandle -ne 0) { return $b }
    } catch { }
    $all = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$FocusTitle*" })
    $exact = @($all | Where-Object { $_.MainWindowTitle -eq $FocusTitle })
    if ($exact.Count) { return $exact[0] }
    return @($all | Where-Object { $_.ProcessName -in @('chrome', 'msedge', 'firefox', 'brave') })[0]
}

<#  STEPPING ASIDE.
    Windows lets only the process in front hand over the front, so a game
    started by this hidden script could open behind Xsegon, or with Xsegon
    keeping the keyboard. Once the game has a window, Xsegon is minimised
    (always allowed) and the game put in front (Set-Front); coming home shows
    Xsegon again even with "come back after a game" off. The game's window is
    RetroArch's, else the newest since the launch; none in 40 s changes nothing. #>
$script:steppedAside = $null
function Step-Aside($proc) {
    if (-not $StepAside -or -not $proc) { return }
    try {
        Initialize-Fg
        $skip = @('powershell', 'pwsh', 'cmd', 'conhost', 'WindowsTerminal', 'OpenConsole', 'chrome', 'msedge', 'explorer')
        $since = $started.AddSeconds(-1)
        $game = $null
        $until = (Get-Date).AddSeconds(40)
        while ((Get-Date) -lt $until -and -not $proc.HasExited) {
            $wins = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
                if ($_.MainWindowHandle -eq 0 -or $skip -contains $_.ProcessName) { return $false }
                try { return $_.StartTime -ge $since } catch { return $false }
            } | Sort-Object StartTime -Descending)
            $game = @($wins | Where-Object { $_.ProcessName -eq 'retroarch' })[0]
            if (-not $game) { $game = $wins[0] }
            if ($game) { break }
            Start-Sleep -Milliseconds 250
        }
        if (-not $game) {
            $why = if ($proc.HasExited) { 'the game closed first' } else { 'no game window within 40s' }
            Write-Log 'LNCH' "did not step aside: $why"
            return
        }
        $xs = Get-XsegonWindow
        $minimised = $false
        if ($xs -and $xs.MainWindowHandle -ne $game.MainWindowHandle) {
            $minimised = -not [Xsegon.Fg]::IsIconic($xs.MainWindowHandle)
            [void][Xsegon.Fg]::ShowWindow($xs.MainWindowHandle, 6)             # SW_MINIMIZE
            $script:steppedAside = $xs.MainWindowHandle
        }
        $front = Set-Front $game.MainWindowHandle
        Write-Log 'LNCH' ("stepped aside for " + $game.ProcessName + ".exe: Xsegon " +
            $(if (-not $xs) { 'not found' } elseif ($minimised) { 'minimised' } else { 'already minimised' }) +
            ", the game " + $(if ($front) { 'has the keyboard' } else { 'was refused the front by Windows' }))
    } catch {
        Write-Log 'LNCH' "could not step aside: $($_.Exception.Message)"
    }
}

<#  One line to RetroArch's network commands over UDP, and its answer when
    $WaitMs is more than 0 ('' when it gives none). From here, so no second
    RetroArch process is started to say it.                                #>
function Send-RetroArch([string] $Command, [int] $WaitMs) {
    $udp = New-Object System.Net.Sockets.UdpClient
    try {
        $udp.Client.ReceiveTimeout = [Math]::Max(1, $WaitMs)
        $bytes = [System.Text.Encoding]::ASCII.GetBytes($Command)
        [void] $udp.Send($bytes, $bytes.Length, '127.0.0.1', $NetPort)
        if ($WaitMs -le 0) { return '' }
        $from = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
        return [System.Text.Encoding]::ASCII.GetString($udp.Receive([ref] $from))
    } catch { return '' } finally { $udp.Close() }
}
$answered   = $false    # RetroArch answered GET_STATUS at least once
$sawPlaying = $false    # and said a game was going

<#  An optional display guard (private\bin\display-guard.ps1, not shipped)
    notes each screen's mode before the game and puts it back after. It runs
    only with -DisplayGuard and the file there; otherwise this does nothing. #>
$displayGuardFile = Join-Path (Split-Path -Parent $PSScriptRoot) 'private\bin\display-guard.ps1'
function Invoke-DisplayGuard([string] $do) {
    if (-not $DisplayGuard -or -not (Test-Path -LiteralPath $displayGuardFile)) { return }
    try {
        $json = & $displayGuardFile -Do $do -NoteFile (Join-Path $DataDir 'display-note.json') -Dry:($DisplayGuard -eq 'dry')
        $o = ($json -join "`n") | ConvertFrom-Json
        if ($do -eq 'note') {
            if ($o.leftover -and $o.leftover.said) { Write-Log 'DISP' ('left by the launch before: ' + $o.leftover.said) }
            Write-Log 'DISP' ('noted ' + ((@($o.screens | ForEach-Object {
                "$($_.name) $($_.now)" + $(if ($_.now -ne $_.saved) { " (saved: $($_.saved))" } else { '' })
            })) -join '; '))
        } else {
            Write-Log 'DISP' "$($o.said)"
        }
    } catch {
        Write-Log 'DISP' "the display was left alone ($do): $($_.Exception.Message)"
    }
}
Invoke-DisplayGuard 'note'

$started = Get-Date
Write-Host "launching: $Title"
Write-Host "  $line" -ForegroundColor DarkGray
Write-Log 'LNCH' ("run $Title" + $(if ($StateSlot -ge 0) { " slot $StateSlot" } else { '' }))

try {
    if ($StateSlot -ge 0 -and $NetPort -gt 0) {
        <#  Load the chosen state over RetroArch's network commands, the way
            api\quit.php quits. If it is never sent, the state is still the
            current slot, and F4 loads it by hand.                             #>
        $proc = Start-Process -FilePath $cmdFile -PassThru -WindowStyle Hidden
        Step-Aside $proc
        $raExe = Join-Path (Split-Path $Exe -Parent) 'retroarch.exe'
        $deadline = (Get-Date).AddSeconds(25)
        $window = $null
        while ((Get-Date) -lt $deadline -and -not $proc.HasExited) {
            $window = Get-Process -Name retroarch -ErrorAction SilentlyContinue |
                      Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
            if ($window) { break }
            Start-Sleep -Milliseconds 250
        }
        <#  A window is not a game: RetroArch shows it before the core runs,
            and a load sent then is dropped. So GET_STATUS is asked until it
            answers PLAYING, and the load goes a moment after. If RetroArch
            never answers, --command sends the load once anyway.
            A core at work before its first frame (the N64 core reading its
            texture packs, minutes for a big one) holds RetroArch's window
            still: while Windows says it is not answering, the wait goes on,
            up to 15 minutes in all. RetroArch can say PLAYING just before
            that work starts, and a load it reads after it is refused, so
            the load waits for PLAYING said without a break for 2 seconds:
            only frames running answer that steadily.                      #>
        if ($window) {
            $playing = $false
            $until = (Get-Date).AddSeconds(40)
            $most  = (Get-Date).AddMinutes(15)
            $still = $null                          # when the window was first and last seen not answering
            $stillTo = $null
            $steady = $null                         # since when PLAYING has been said without a break
            $breaks = 0
            while ((Get-Date) -lt $until -and -not $proc.HasExited) {
                $status = Send-RetroArch 'GET_STATUS' 700
                if ($status) { $answered = $true }
                if ($status -match 'PLAYING') {
                    $sawPlaying = $true
                    if (-not $steady) {
                        $steady = Get-Date
                        $until = @(@($until, (Get-Date).AddSeconds(10)) | Sort-Object -Descending)[0]     # room to see it steady
                        $until = @($until, $most) | Sort-Object | Select-Object -First 1
                    }
                    if (((Get-Date) - $steady).TotalSeconds -ge 2) { $playing = $true; break }
                    Start-Sleep -Milliseconds 400
                    continue
                }
                if ($steady) { $steady = $null; $breaks++ }
                if (-not $status) {
                    try {
                        $window.Refresh()
                        if (-not $window.Responding) {
                            if (-not $still) { $still = Get-Date; Write-Log 'LNCH' "RetroArch's window is not answering (a core at work, such as reading texture packs): the load waits for it" }
                            $stillTo = Get-Date
                            $until = @((Get-Date).AddSeconds(40), $most) | Sort-Object | Select-Object -First 1
                        }
                    } catch { }
                }
                Start-Sleep -Milliseconds 400
            }
            if ($still) { Write-Log 'LNCH' ("RetroArch's window did not answer for about " + [int] ($stillTo - $still).TotalSeconds + 's; it was waited for') }
            if ($breaks) { Write-Log 'LNCH' "RetroArch said PLAYING, then stopped answering $breaks time(s) before its frames ran steadily: the load waited" }
            if ($playing) {
                Start-Sleep -Milliseconds 1500      # a few frames run first: Mupen64Plus-Next refuses a state before them
                [void] (Send-RetroArch 'LOAD_STATE' 0)
                Write-Log 'LNCH' "sent LOAD_STATE for slot $StateSlot to port $NetPort, once RetroArch said it was playing"
            } elseif (-not $proc.HasExited -and (Test-Path -LiteralPath $raExe)) {
                try {
                    Start-Process -FilePath $raExe -ArgumentList @('--command', "LOAD_STATE;localhost;$NetPort") -WindowStyle Hidden -Wait
                    Write-Log 'LNCH' "RetroArch never said it was playing; sent LOAD_STATE for slot $StateSlot anyway"
                } catch {
                    Write-Log 'LNCH' "LOAD_STATE not sent: $($_.Exception.Message)"
                }
            } else {
                Write-Log 'LNCH' "RetroArch closed before it was playing, LOAD_STATE not sent"
            }
        } else {
            Write-Log 'LNCH' "no RetroArch window within 25s, LOAD_STATE not sent (the hotkey still loads slot $StateSlot)"
        }
        $proc.WaitForExit()
        $code = $proc.ExitCode
    } elseif ($ViaSteam) {
        <#  steam.exe is not the game. With Steam open it hands the request
            over and exits at once; with Steam closed it BECOMES Steam and
            stays open long after the game has gone. So it is started and
            left, and the game is found by its folder below.               #>
        Start-Process -FilePath $cmdFile -WindowStyle Hidden | Out-Null
        $code = 0
    } elseif ($NetPort -gt 0) {
        <#  A RetroArch game with its network commands on: while it runs,
            RetroArch is asked every second or so whether a game is going
            (GET_STATUS answers PLAYING, or PAUSED from its menu). Once it
            has said so, nothing more is asked, and how it ends later is a
            close (see A CLOSE IS NOT A CRASH below).                      #>
        $proc = Start-Process -FilePath $cmdFile -PassThru -WindowStyle Hidden
        Step-Aside $proc
        while (-not $proc.HasExited) {
            $status = Send-RetroArch 'GET_STATUS' 700
            if ($status) { $answered = $true }
            if ($status -match 'PLAYING|PAUSED') { $sawPlaying = $true; break }
            Start-Sleep -Milliseconds 500
        }
        $proc.WaitForExit()
        $code = $proc.ExitCode
    } else {
        $proc = Start-Process -FilePath $cmdFile -PassThru -WindowStyle Hidden
        $null = $proc.Handle          # without it a finished process can forget its exit code
        Step-Aside $proc
        $proc.WaitForExit()
        $code = $proc.ExitCode
    }
} catch {
    Write-Failure "could not start: $($_.Exception.Message)"
    exit 1
}

<#  THE WRAPPER SWALLOWS FAILURES, so its exit code is a lie.
    On a non-zero code, retroarch_wrapper.bat runs core_selector.ps1 and ends
    with an echo, so it returns 0. It writes the real code to its own log
    first, so that is read from the bytes this launch appended; with no log,
    the wrapper's answer stands.                                            #>

# $logWasAt is 0 when the log did not exist yet, a normal first launch, and
# reading from 0 is then right: do not guard on "-gt 0".
$realCode = $code
if (Test-Path -LiteralPath $wrapperLog) {
    try {
        $stream = [System.IO.File]::Open($wrapperLog, 'Open', 'Read', 'ReadWrite')
        try {
            $stream.Seek($logWasAt, 'Begin') | Out-Null
            $reader = New-Object System.IO.StreamReader($stream)
            $tail = $reader.ReadToEnd()
        } finally { $stream.Dispose() }

        $m = [regex]::Matches($tail, 'Exit Code:\s*(-?\d+)')
        if ($m.Count -gt 0) {
            $realCode = [int]$m[$m.Count - 1].Groups[1].Value
            if ($realCode -ne $code) {
                Write-Host "  wrapper reported $code, RetroArch actually exited $realCode" -ForegroundColor DarkYellow
            }
        }
    } catch {
        Write-Host "  could not read the wrapper log: $($_.Exception.Message)" -ForegroundColor DarkGray
    }
}
$code = $realCode

# --- a Steam game: followed by its folder -----------------------------------
# Through Steam, give Steam time to start, update and sync first. Started by
# its own program, only one that stopped straight away can have handed over
# (a publisher's launcher, or a game restarting itself through Steam).
$ended = Get-Date
if ($WatchDir) {
    $names = @($WatchNames -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $firstWait = 0
    if ($ViaSteam) { $firstWait = 180 }
    elseif (((Get-Date) - $started).TotalSeconds -lt 20) { $firstWait = 20 }
    if ($firstWait -gt 0) {
        $seen = Watch-Game $WatchDir $names $firstWait
        if ($seen) {
            if ($ViaSteam) { $started = $seen.From }    # the game's own time, not Steam's start-up
            $ended = $seen.To
        } elseif ($ViaSteam) {
            Write-Failure "Steam did not start it within 3 minutes. If Steam is updating it, play once the update is done"
            exit 1
        }
    }
}

$seconds = [int]($ended - $started).TotalSeconds

# --- the session record --------------------------------------------------
# Recently Played and playtime come from here: only a launcher that waited knows.

@{
    at       = $started.ToString('o')
    endedAt  = $ended.ToString('o')
    gameId   = $GameId
    title    = $Title
    platform = $Platform
    seconds  = $seconds
    exitCode = $code
    source   = 'xsegon'
} | ConvertTo-Json -Compress | Set-Variable -Name sessionLine

# Tried three times, and a failure cannot end the launcher with the game still
# marked as running. The marker goes after this and the launch result, so the
# page finds both when the marker is gone.
$wrote = $false
for ($try = 1; $try -le 3 -and -not $wrote; $try++) {
    try {
        Add-Content -LiteralPath $sessionFile -Value $sessionLine -Encoding UTF8 -ErrorAction Stop
        $wrote = $true
    } catch {
        if ($try -lt 3) { Start-Sleep -Milliseconds 300 }
        else { Write-Log 'LNCH' "could not record this play of $Title in sessions.jsonl ($($_.Exception.Message)); its $seconds seconds are not counted" }
    }
}

<#  A CLOSE IS NOT A CRASH.
    RetroArch's cores often crash on the way out (0xC0000005 after quitting
    from its menu), so what counts is whether the game ran:
      - it said PLAYING, then exited with an error: a close, however soon.
      - it answered but never said PLAYING: the game never loaded.
      - it could not be asked: an error in the first $PlayedFor seconds is a
        failure, one after that a close.                                   #>
$hint = if ($FailHint) { ". $FailHint" } else { '' }
if ($code -eq 0) {
    Write-Log 'LNCH' "end $Title ${seconds}s exit 0"
    Set-LaunchResult $true ''
} elseif ($sawPlaying) {
    Write-Log 'LNCH' "end $Title ${seconds}s exit $code (RetroArch said it was playing: taken as closed, not a failure)"
    Set-LaunchResult $true ''
} elseif ($answered) {
    Write-Failure "the game never started in RetroArch (exited with code $code after ${seconds}s)$hint"
} elseif ($seconds -ge $PlayedFor) {
    Write-Log 'LNCH' "end $Title ${seconds}s exit $code (after ${seconds}s of play: taken as closed, not a failure)"
    Set-LaunchResult $true ''
} else {
    Write-Failure "exited with code $code after ${seconds}s$hint"
}
Remove-Item -LiteralPath $runningFile -ErrorAction SilentlyContinue

Write-Host "finished after ${seconds}s (exit $code)"

# --- coming home ---------------------------------------------------------
# Best effort, on by default (Settings > Launching > Come back after a game).

<#  WHY THIS IS NOT AppActivate.
    SetForegroundWindow is restricted, and a background script that waited
    out a game may not take the foreground. Microsoft's documented way is to
    attach to the foreground thread's input and ask, with an ALT tap first
    when that alone is refused (Set-Front).                               #>

if ($RestoreFocus) {
    try {
        $target = Get-XsegonWindow
        if (-not $target) {
            Write-Log 'LNCH' "nothing titled '$FocusTitle' to come back to"
        } else {
            Initialize-Fg
            [Xsegon.Fg]::ShowWindow($target.MainWindowHandle, 9) | Out-Null     # SW_RESTORE
            $ok = Set-Front $target.MainWindowHandle
            # A refusal names what stayed in front: the game, another program
            # or Xsegon itself.
            $front = ''
            if (-not $ok) {
                try {
                    $h = [Xsegon.Fg]::GetForegroundWindow()
                    $p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -eq $h } | Select-Object -First 1
                    $front = if ($p) { ': "' + ([string]$p.MainWindowTitle).Substring(0, [Math]::Min(60, ([string]$p.MainWindowTitle).Length)) + '" (' + $p.ProcessName + '.exe) stayed in front' }
                             elseif ($h -eq [IntPtr]::Zero) { ': no window was in front' } else { ': a window that is no program''s main one stayed in front' }
                } catch { }
            }
            Write-Log 'LNCH' ("came back to Xsegon: " + $(if ($ok) { 'yes' } else { 'refused by Windows' + $front }))
        }
    } catch {
        Write-Log 'LNCH' "could not come back to Xsegon: $($_.Exception.Message)"
    }
} elseif ($script:steppedAside) {
    # Put away by Step-Aside, so brought back up, but without taking the
    # front: coming back to the front is what the setting turned off.
    try {
        [Xsegon.Fg]::ShowWindow($script:steppedAside, 4) | Out-Null            # SW_SHOWNOACTIVATE
        Write-Log 'LNCH' "Xsegon shown again (not brought to the front: come back after a game is off)"
    } catch {
        Write-Log 'LNCH' "could not show Xsegon again: $($_.Exception.Message)"
    }
}

# Last, so coming home is never kept waiting by it; without the guard file it does nothing.
Invoke-DisplayGuard 'restore'
