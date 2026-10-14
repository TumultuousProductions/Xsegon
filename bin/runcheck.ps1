<#
    Xsegon - the runs check.

    Starts each game on a list in turn, asks RetroArch whether it got going,
    takes a screenshot, quits it, and records boots, crashed, did not start
    (with RetroArch's reason), no answer, or look at it. Other emulators are
    judged by their log and window title (Test-EmuGame). api\runcheck.php
    makes the list and starts this detached; the page reads status.json and
    results.json.

    The contract:
      - It never records play: no session line, running.json or
        last-error.json, and sessions.jsonl is compared with a copy taken
        before the run and put back if it changed.
      - It never touches your saves: RetroArch's --appendconfig (written by
        the API) sends saves, states and screenshots to data\runcheck and
        turns auto save/load, play logs and config_save_on_exit off. Dolphin,
        Xenia and RPCS3 are told the same; PCSX2, Cemu and xemu cannot be.
      - A game that got going on another emulator is never closed by force:
        one that will not close is left open and the check stops. (RetroArch's
        saves are the check's own, so one that ignores QUIT is still ended.)

    One at a time, stoppable (data\runcheck\stop) and resumable: results.json
    is written after every game.

    Run by hand to see a game's check in a terminal:
        .\bin\runcheck.ps1 -Plan data\runcheck\plan.json -DataDir data
#>

param(
    [Parameter(Mandatory = $true)][string] $Plan,
    [string] $DataDir = '',
    # Seconds of play before the screenshot.
    [int]    $Wait = 10,
    # Seconds RetroArch has to say a game is playing before it is given up on.
    [int]    $StartWithin = 45,
    [switch] $Log
)

$ErrorActionPreference = 'Stop'

if (-not $DataDir) { $DataDir = Join-Path $PSScriptRoot '..\data' }
$DataDir = (Resolve-Path -LiteralPath $DataDir).Path
$dir      = Join-Path $DataDir 'runcheck'
$shots    = Join-Path $dir 'shots'
$raw      = Join-Path $dir 'raw'
$raLogDir = Join-Path $dir 'ralog'
$statusF  = Join-Path $dir 'status.json'
$resultsF = Join-Path $dir 'results.json'
$stopF    = Join-Path $dir 'stop'
$batF     = Join-Path $dir 'run.bat'
$sessions = Join-Path $DataDir 'sessions.jsonl'
$before   = Join-Path $dir 'sessions.before.jsonl'
$noneF    = Join-Path $dir 'sessions.none'
foreach ($d in @($dir, $shots, $raw, $raLogDir, (Join-Path $dir 'saves'))) {
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-Log([string] $msg) {
    if (-not $Log) { return }
    try {
        $ld = Join-Path $DataDir 'log'
        if (-not (Test-Path -LiteralPath $ld)) { New-Item -ItemType Directory -Path $ld -Force | Out-Null }
        $file = Join-Path $ld ((Get-Date).ToString('yyyy-MM-dd') + '.log')
        $line = (Get-Date).ToString('HH:mm:ss.fff') + ' S RCHK ' + $msg + "`n"
        [System.IO.File]::AppendAllText($file, $line, $utf8)
    } catch { }
}

function Write-JsonFile([string] $path, $value) {
    $tmp = $path + '.tmp'
    [System.IO.File]::WriteAllText($tmp, ($value | ConvertTo-Json -Depth 6 -Compress), $utf8)
    Move-Item -LiteralPath $tmp -Destination $path -Force
}

function Read-JsonFile([string] $path) {
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    try { return ([System.IO.File]::ReadAllText($path, $utf8).TrimStart([char]0xFEFF) | ConvertFrom-Json) } catch { return $null }
}

# RetroArch's network commands, over UDP from here (the same as bin\launch.ps1).
function Send-RetroArch([int] $port, [string] $command, [int] $waitMs) {
    $udp = New-Object System.Net.Sockets.UdpClient
    try {
        $udp.Client.ReceiveTimeout = [Math]::Max(1, $waitMs)
        $bytes = [System.Text.Encoding]::ASCII.GetBytes($command)
        [void] $udp.Send($bytes, $bytes.Length, '127.0.0.1', $port)
        if ($waitMs -le 0) { return '' }
        $from = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
        return [System.Text.Encoding]::ASCII.GetString($udp.Receive([ref] $from))
    } catch { return '' } finally { $udp.Close() }
}

# Wait up to $ms, a little at a time, returning early when the game has gone
# or a stop was asked for. True when the whole wait passed.
function Wait-While($proc, [int] $ms) {
    $until = (Get-Date).AddMilliseconds($ms)
    while ((Get-Date) -lt $until) {
        if ($proc.HasExited -or (Test-Path -LiteralPath $stopF)) { return $false }
        Send-Pulse
        Start-Sleep -Milliseconds 250
    }
    return $true
}

<#  The status rewritten every five seconds while a game is being waited on:
    its age tells the API this is still alive when tasklist blips.        #>
$script:lastPulse = Get-Date
function Send-Pulse {
    if (((Get-Date) - $script:lastPulse).TotalSeconds -lt 5) { return }
    $script:lastPulse = Get-Date
    try { Write-JsonFile $statusF $status } catch { }
}

# The game and everything it started (cmd, a wrapper .bat, retroarch.exe).
function Stop-Tree($proc) {
    if ($proc.HasExited) { return }
    try { & taskkill.exe /T /F /PID $proc.Id 2>&1 | Out-Null } catch { }
}

# RetroArch's own words for why, from its log for this run: the last few
# [ERROR] lines, which is where "Failed to load content" and a missing BIOS
# are said. '' when there is no log or nothing in it.
function Get-RaReason {
    $f = Join-Path $raLogDir 'retroarch.log'
    if (-not (Test-Path -LiteralPath $f)) { return '' }
    try {
        # RetroArch writes UTF-8; read as anything else, a name with an
        # accent in it comes out as two wrong letters.
        $lines = @(Get-Content -LiteralPath $f -Encoding UTF8 -ErrorAction Stop | Where-Object { $_ -match '\[ERROR\]' } |
                   ForEach-Object { ($_ -replace '^.*?\[ERROR\]\s*', '').Trim() } | Where-Object { $_ })
        if (-not $lines.Count) { return '' }
        $why = (@($lines | Select-Object -Last 3) -join ' / ')
        if ($why.Length -gt 300) { $why = $why.Substring(0, 300) }
        return $why
    } catch { return '' }
}

<#  Is the picture a blank screen? RetroArch saying PLAYING can still be a
    black screen (a missing BIOS on some cores, a game stuck loading), which
    is what the screenshots are for; this marks the obvious ones so they can
    be looked at first. A 16 x 16 sample of the picture: nearly all dark, or
    all one colour.                                                         #>
function Test-Blank([string] $png) {
    try {
        Add-Type -AssemblyName System.Drawing
        $bmp = New-Object System.Drawing.Bitmap $png
        try {
            $lo = 999; $hi = -1
            for ($i = 0; $i -lt 16; $i++) {
                for ($j = 0; $j -lt 16; $j++) {
                    $c = $bmp.GetPixel([int](($bmp.Width - 1) * ($i + 0.5) / 16), [int](($bmp.Height - 1) * ($j + 0.5) / 16))
                    $v = [int](($c.R + $c.G + $c.B) / 3)
                    if ($v -lt $lo) { $lo = $v }
                    if ($v -gt $hi) { $hi = $v }
                }
            }
            return ($hi -lt 24) -or (($hi - $lo) -lt 6)
        } finally { $bmp.Dispose() }
    } catch { return $false }
}

function Get-SafeName([string] $id) { return ($id -replace '[^A-Za-z0-9_\-]', '_') }

<#  The PlayStation's own menu (Memory Card, CD Player): what its BIOS shows
    when the disc does not start a game, while RetroArch still says PLAYING.
    Its blue fills over half the picture; a PS1 game's start screens have
    almost none.                                                           #>
function Test-Ps1Menu([string] $png) {
    try {
        Add-Type -AssemblyName System.Drawing
        $bmp = New-Object System.Drawing.Bitmap $png
        try {
            $blue = 0
            for ($i = 0; $i -lt 24; $i++) {
                for ($j = 0; $j -lt 24; $j++) {
                    $c = $bmp.GetPixel([int](($bmp.Width - 1) * ($i + 0.5) / 24), [int](($bmp.Height - 1) * ($j + 0.5) / 24))
                    if ($c.B -gt 60 -and $c.B -gt $c.R + 35 -and $c.B -gt $c.G + 25) { $blue++ }
                }
            }
            return ($blue / 576) -ge 0.4
        } finally { $bmp.Dispose() }
    } catch { return $false }
}

# ---- the other emulators ------------------------------------------------------
<#  None of them answers GET_STATUS, so a game on one is judged by what the
    emulator shows: a line in its log, or its window title, named in the plan
    by includes\runcheck.php (xs_runcheck_emu). Its windows are found by its
    process, pictured with Windows' PrintWindow, and closed with the message
    the X button sends. A game that got going is never closed by force.    #>
$script:winReady = $false
function Use-Win {
    if ($script:winReady) { return }
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
namespace Xsegon {
public static class RcWin {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    public class Win { public IntPtr Handle; public string Title; public string Class; public int Width; public int Height; public bool Enabled; }
    // The visible top-level windows of these processes.
    public static List<Win> Of(int[] pids) {
        HashSet<uint> want = new HashSet<uint>();
        foreach (int p in pids) { want.Add((uint) p); }
        List<Win> list = new List<Win>();
        EnumWindows(delegate (IntPtr h, IntPtr l) {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (!want.Contains(pid) || !IsWindowVisible(h)) { return true; }
            StringBuilder t = new StringBuilder(512);
            GetWindowText(h, t, 512);
            StringBuilder c = new StringBuilder(256);
            GetClassName(h, c, 256);
            RECT r;
            GetClientRect(h, out r);
            Win w = new Win();
            w.Handle = h; w.Title = t.ToString(); w.Class = c.ToString();
            w.Width = r.Right - r.Left; w.Height = r.Bottom - r.Top; w.Enabled = IsWindowEnabled(h);
            list.Add(w);
            return true;
        }, IntPtr.Zero);
        return list;
    }
    // The window's inside as a PNG, drawn by the window itself. flags 3: the client
    // area with its full content (what a graphics card drew); 1: the client area as
    // the window paints it, for a window of the plain kind.
    public static bool Shot(IntPtr h, string file, uint flags) {
        RECT r;
        if (!GetClientRect(h, out r)) { return false; }
        int w = r.Right - r.Left, ht = r.Bottom - r.Top;
        if (w < 8 || ht < 8) { return false; }
        using (Bitmap bmp = new Bitmap(w, ht)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                IntPtr dc = g.GetHdc();
                bool ok;
                try { ok = PrintWindow(h, dc, flags); } finally { g.ReleaseHdc(dc); }
                if (!ok) { return false; }
            }
            bmp.Save(file, ImageFormat.Png);
        }
        return true;
    }
    // What the X button sends (WM_CLOSE).
    public static void Close(IntPtr h) { PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); }
}
}
'@
    $script:winReady = $true
}

# The emulator's processes started for this game, not one that was open before.
function Get-EmuProcs([string] $name, [datetime] $since) {
    return @(Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { try { $_.StartTime -ge $since } catch { $false } })
}

function Get-EmuWindows([string] $name, [datetime] $since) {
    $procs = Get-EmuProcs $name $since
    if (-not $procs.Count) { return @() }
    return @([Xsegon.RcWin]::Of([int[]] @($procs | ForEach-Object { $_.Id })))
}

function Get-Biggest($wins) { return $wins | Sort-Object { $_.Width * $_.Height } -Descending | Select-Object -First 1 }

<#  A log read as it grows, whole lines at a time. fresh: a file of the
    check's own, removed before each game. append: the emulator adds to it,
    so reading starts where it ends now. rewrite: the emulator starts it
    again at each launch, so nothing counts until its first bytes change. #>
function Get-Head([string] $path) {
    try {
        $fs = [System.IO.File]::Open($path, 'Open', 'Read', 'ReadWrite, Delete')
        try { $b = New-Object byte[] 512; $n = $fs.Read($b, 0, 512); return [Convert]::ToBase64String($b, 0, $n) } finally { $fs.Close() }
    } catch { return $null }
}

function New-LogWatch([string] $path, [string] $mode) {
    $w = @{ path = $path; offset = [long] 0; head = $null; carry = ''; live = $true }
    if ($path -and (Test-Path -LiteralPath $path)) {
        if ($mode -eq 'append') { $w.offset = [long] (Get-Item -LiteralPath $path).Length }
        elseif ($mode -eq 'rewrite') { $w.head = Get-Head $path; $w.live = ($null -eq $w.head) }
    }
    return $w
}

function Read-LogWatch($w) {
    if (-not $w.path -or -not (Test-Path -LiteralPath $w.path)) { return @() }
    $chunk = ''
    try {
        $fs = [System.IO.File]::Open($w.path, 'Open', 'Read', 'ReadWrite, Delete')
        try {
            if (-not $w.live) {
                $b = New-Object byte[] 512; $n = $fs.Read($b, 0, 512)
                if ([Convert]::ToBase64String($b, 0, $n) -eq $w.head) { return @() }    # still the old log
                $w.live = $true; $w.offset = [long] 0
            }
            if ($fs.Length -lt $w.offset) { $w.offset = [long] 0 }
            $len = [int] [Math]::Min($fs.Length - $w.offset, 8MB)
            if ($len -le 0) { return @() }
            [void] $fs.Seek($w.offset, 'Begin')
            $buf = New-Object byte[] $len
            $got = $fs.Read($buf, 0, $len)
            $w.offset = $w.offset + $got
            $chunk = $w.carry + $utf8.GetString($buf, 0, $got)
        } finally { $fs.Close() }
    } catch { return @() }
    $lines = $chunk -split "`r?`n"
    $w.carry = $lines[-1]
    if ($lines.Count -le 1) { return @() }
    return @($lines[0..($lines.Count - 2)])
}

<#  The emulator's biggest window, pictured into shots\. Blank as Test-Blank
    says. A black one is taken again a second later, then the other way: a
    picture can be caught before the window has drawn.                    #>
function Save-EmuShot([string] $name, [datetime] $since, [string] $safe) {
    $main = Get-Biggest (Get-EmuWindows $name $since)
    if (-not $main) { return @{ shot = $false; blank = $false } }
    $dest = Join-Path $shots ($safe + '.png')
    $got = $null
    foreach ($try in @(@{ flags = 3; after = 0 }, @{ flags = 3; after = 1000 }, @{ flags = 1; after = 0 })) {
        if ($try.after) { Start-Sleep -Milliseconds $try.after }
        $ok = $false
        try { $ok = [Xsegon.RcWin]::Shot($main.Handle, $dest, [uint32] $try.flags) } catch { }
        if (-not $ok) { continue }
        $got = @{ shot = $true; blank = (Test-Blank $dest) }
        if (-not $got.blank) { return $got }
    }
    if ($got) { return $got }
    return @{ shot = $false; blank = $false }
}

<#  Every window of the emulator asked to close, boxes first, twice over
    fifteen seconds each. True when it is gone. A game that got going is
    never ended by force (that could cut off a save): $mayForce only for one
    that never started, which has nothing to lose.                         #>
function Close-Emu($proc, [string] $name, [datetime] $since, [bool] $mayForce) {
    for ($round = 0; $round -lt 2 -and -not $proc.HasExited; $round++) {
        $wins = Get-EmuWindows $name $since
        if (-not $wins.Count) { break }
        foreach ($w in ($wins | Sort-Object { $_.Width * $_.Height })) { [Xsegon.RcWin]::Close($w.Handle) }
        $gone = (Get-Date).AddSeconds(15)
        while ((Get-Date) -lt $gone -and -not $proc.HasExited) { Send-Pulse; Start-Sleep -Milliseconds 250 }
    }
    <#  Its windows gone and the program still finishing: that is closing,
        not refusing, and it gets a minute more.                            #>
    if (-not $proc.HasExited -and -not (Get-EmuWindows $name $since).Count) {
        $gone = (Get-Date).AddSeconds(60)
        while ((Get-Date) -lt $gone -and -not $proc.HasExited -and (Get-EmuProcs $name $since).Count) { Send-Pulse; Start-Sleep -Milliseconds 250 }
    }
    # The emulator gone and only the batch file's cmd left over: nothing of the game is in it.
    if (-not $proc.HasExited -and -not (Get-EmuProcs $name $since).Count) { Stop-Tree $proc }
    if ($proc.HasExited) { return $true }
    if (-not $mayForce) { return $false }
    Stop-Tree $proc
    Get-EmuProcs $name $since | ForEach-Object { try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch { } }
    return $true
}

# A port nothing listens on now, for xemu's monitor: a taken one would stop QEMU starting.
function Get-FreePort {
    $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $l.Start()
    try { return $l.LocalEndpoint.Port } finally { $l.Stop() }
}

# The monitor's next answer, past any event it sends unasked.
function Read-Qmp($reader) {
    for ($i = 0; $i -lt 20; $i++) {
        $line = $reader.ReadLine()
        if ($null -eq $line) { return $null }
        try { $j = $line | ConvertFrom-Json } catch { continue }
        if ($j.PSObject.Properties['return'] -or $j.PSObject.Properties['error']) { return $j }
    }
    return $null
}

<#  Which program the Xbox in xemu is running, asked of its QEMU monitor
    (QMP): the header at 0x10000 saved to a file (memsave), "XBEH", then
    the certificate it points to, with the title ID and name. The same
    place xemu reads for its own snapshots (xemu-xbe.c). A game or a
    dashboard: Test-GameTitle. Null while there is nothing to read yet,
    or no monitor.                                                       #>
function Get-XboxTitle([int] $port, [string] $dump) {
    $c = New-Object System.Net.Sockets.TcpClient
    try {
        $wait = $c.BeginConnect('127.0.0.1', $port, $null, $null)
        if (-not $wait.AsyncWaitHandle.WaitOne(500)) { return $null }
        $c.EndConnect($wait)
        $s = $c.GetStream()
        $s.ReadTimeout = 2000
        $r = New-Object System.IO.StreamReader($s, [System.Text.Encoding]::UTF8)
        $w = New-Object System.IO.StreamWriter($s, $utf8)
        $w.AutoFlush = $true
        [void] $r.ReadLine()                                             # its greeting
        $w.WriteLine('{"execute":"qmp_capabilities"}')
        if (-not (Read-Qmp $r)) { return $null }
        Remove-Item -LiteralPath $dump -ErrorAction SilentlyContinue
        $w.WriteLine((@{ execute = 'memsave'; arguments = @{ val = 65536; size = 8192; filename = $dump } } | ConvertTo-Json -Compress))
        $ans = Read-Qmp $r
        if (-not $ans -or $ans.PSObject.Properties['error'] -or -not (Test-Path -LiteralPath $dump)) { return $null }
        $b = [System.IO.File]::ReadAllBytes($dump)
        if ($b.Length -lt 0x120 -or [BitConverter]::ToUInt32($b, 0) -ne 0x48454258) { return $null }   # "XBEH"
        $cert = [long] [BitConverter]::ToUInt32($b, 0x118) - 0x10000
        if ($cert -lt 0 -or $cert + 0x5C -gt $b.Length) { return $null }
        $id = '{0:X8}' -f [BitConverter]::ToUInt32($b, [int] $cert + 8)
        $title = [System.Text.Encoding]::Unicode.GetString($b, [int] $cert + 0xC, 0x50).Split([char] 0)[0].Trim()
        return @{ id = $id; title = $title }
    } catch { return $null } finally { $c.Close() }
}

<#  A game's title ID begins with its publisher's two letters (4D53 "MS",
    4541 "EA"); a dashboard's or a menu's does not (FFFE0000, FFFF0002).  #>
function Test-GameTitle([string] $id) {
    if ($id.Length -ne 8) { return $false }
    $a = [Convert]::ToInt32($id.Substring(0, 2), 16); $b = [Convert]::ToInt32($id.Substring(2, 2), 16)
    return $a -ge 0x41 -and $a -le 0x5A -and $b -ge 0x41 -and $b -le 0x5A
}

<#  One game on one of the other emulators, start to close. Returns what
    the RetroArch half of the loop works out for itself: result, reason,
    exit code, picture, blank, plus closed (false: it would not close and
    was left open) and skip (stopped before anything could be told).     #>
function Test-EmuGame($g, [string] $safe) {
    Use-Win
    $o = @{ result = 'look'; reason = ''; code = $null; shot = $false; blank = $false; closed = $true; skip = $false }
    $name = [string] $g.proc
    if (@(Get-Process -Name $name -ErrorAction SilentlyContinue).Count) {
        $o.result = 'noanswer'
        $o.reason = "$($g.emu) was already open, so this game was not started: close it and check the game again"
        return $o
    }
    foreach ($f in @([string] $g.out, $(if ($g.logMode -eq 'fresh') { [string] $g.log } else { '' }))) {
        if ($f) { Remove-Item -LiteralPath $f -ErrorAction SilentlyContinue }
    }
    $logW = New-LogWatch ([string] $g.log) ([string] $g.logMode)
    $outW = New-LogWatch ([string] $g.out) 'fresh'

    # xemu's monitor on a port free now; the header it reads goes beside the output.
    $cmdArgs = [string] $g.args
    $qmpPort = 0
    if ($g.qmp) { $qmpPort = Get-FreePort; $cmdArgs = $cmdArgs.Replace('{QMP}', [string] $qmpPort) }
    $dump = Join-Path (Split-Path ([string] $g.out) -Parent) 'xbe.bin'

    # As for RetroArch below, and its output kept: xemu's only words go there.
    $workDir = (Split-Path $g.exe -Parent).Replace('%', '%%')
    $batExe = ([string]$g.exe).Replace('%', '%%'); $batArgs = $cmdArgs.Replace('%', '%%'); $batOut = ([string]$g.out).Replace('%', '%%')
    [System.IO.File]::WriteAllText($batF, "@echo off`r`nchcp 65001 >nul`r`ncd /d `"$workDir`"`r`n`"$batExe`" $batArgs > `"$batOut`" 2>&1`r`n", $utf8)

    $t0 = Get-Date
    $since = $t0.AddSeconds(-2)
    $started = $false; $fails = New-Object System.Collections.Generic.List[string]; $failAt = $null; $box = ''; $boxAt = $null
    $xbox = $null; $dash = $null; $dashAt = $null
    try {
        $proc = Start-Process -FilePath $batF -PassThru -WindowStyle Hidden
    } catch {
        $o.result = 'nostart'; $o.reason = 'could not start it: ' + $_.Exception.Message
        return $o
    }
    # What its log and output said since the last look (dot-run, so it sets these here).
    $hear = {
        foreach ($line in (@(Read-LogWatch $logW) + @(Read-LogWatch $outW))) {
            if ($g.boot -and $line -match $g.boot) { $started = $true }
            if ($g.fail -and $line -match $g.fail) { $fails.Add($line.Trim()); if (-not $failAt) { $failAt = Get-Date } }
        }
    }
    $until = $t0.AddSeconds([int] $g.start)
    while ((Get-Date) -lt $until -and -not $proc.HasExited -and -not (Test-Path -LiteralPath $stopF)) {
        . $hear
        $wins = Get-EmuWindows $name $since
        $main = Get-Biggest $wins
        if ($g.title -and $main -and $main.Title -match $g.title) { $started = $true }
        if ($started) { break }
        # xemu: the game's own program running is the proof; a dashboard or menu for six seconds is not going to change.
        if ($qmpPort -and $main) {
            $x = Get-XboxTitle $qmpPort $dump
            if ($x -and (Test-GameTitle $x.id)) { $xbox = $x; $started = $true; break }
            if ($x) { $dash = $x; if (-not $dashAt) { $dashAt = Get-Date } }
            if ($dashAt -and ((Get-Date) - $dashAt).TotalSeconds -gt 6) { break }
        }
        if ($g.look -and -not $qmpPort -and $main -and $main.Width -ge 320 -and $main.Height -ge 200) { $started = $true; break }
        # A box waiting for a press: one of Windows' own, or the main window no longer taking input.
        $b = $wins | Where-Object { $_.Class -eq '#32770' -or ($main -and $_.Handle -ne $main.Handle -and -not $main.Enabled) } | Select-Object -First 1
        if ($b) { $box = [string] $b.Title; if (-not $boxAt) { $boxAt = Get-Date } }
        # It said why, or put a box up, and nothing has started in the five seconds since.
        $first = @($failAt, $boxAt) | Where-Object { $_ } | Sort-Object | Select-Object -First 1
        if ($first -and ((Get-Date) - $first).TotalSeconds -gt 5) { break }
        Send-Pulse
        Start-Sleep -Milliseconds 500
    }
    # Its last words, when it closed between two looks.
    if (-not $started) { . $hear }
    # Proved: the log, the title, or xemu naming the game's own program. Not proved: a window, for "look".
    $proved = $started -and (-not $g.look -or $null -ne $xbox)
    if ($started) {
        if (Wait-While $proc (([int] $Wait + [int] $g.extra) * 1000)) {
            $pic = Save-EmuShot $name $since $safe
            $o.shot = $pic.shot; $o.blank = $pic.blank
            $o.result = if ($proved) { 'boots' } else { 'look' }
            if (-not $proved) { $o.reason = "$($g.emu) cannot say whether a game started" }
        } elseif ($proc.HasExited) {
            $o.result = 'crashed'
            $o.reason = 'it started, then closed by itself after ' + [int]((Get-Date) - $t0).TotalSeconds + 's'
        } else {
            $o.result = if ($proved) { 'boots' } else { 'look' }     # stopped by you during the wait
        }
        if ($xbox) {
            $ran = "xemu ran `"$($xbox.title)`" (title $($xbox.id))"
            $o.reason = if ($o.reason) { $ran + '; ' + $o.reason } else { $ran }
        }
    } elseif ($proc.HasExited) {
        $o.result = 'nostart'; $o.reason = 'it closed before the game started'
    } elseif ($dashAt) {
        $o.result = 'nostart'
        $o.reason = "xemu went to `"$($dash.title)`" (title $($dash.id)), a dashboard or menu, instead of the game: the disc image may not be readable"
    } elseif ($fails.Count -or $box) {
        $o.result = 'nostart'
        $o.reason = if ($box) { "it put up a box, `"$box`", and the game never started" } else { 'it said the game could not start' }
    } elseif (Test-Path -LiteralPath $stopF) {
        $o.skip = $true                                                  # stopped before anything could be told
    } else {
        # Open and quiet, and nothing it showed said the game started: no proof either way.
        $pic = Save-EmuShot $name $since $safe
        $o.shot = $pic.shot; $o.blank = $pic.blank
        $o.result = 'look'
        $o.reason = "$($g.emu) stayed open $($g.start)s without showing that the game started"
        if ($qmpPort) { $o.reason = "xemu did not say which program the Xbox ran" }
    }
    if ($o.result -eq 'crashed' -or $o.result -eq 'nostart') {
        $mayForce = $o.result -eq 'nostart'
    } else { $mayForce = $false }
    $o.closed = Close-Emu $proc $name $since $mayForce
    if ($proc.HasExited) { try { $o.code = $proc.ExitCode } catch { } }
    if ($o.result -eq 'crashed' -or $o.result -eq 'nostart') {
        if ($null -ne $o.code -and $o.code -ne 0) { $o.reason = $o.reason + " (exit code $($o.code))" }
        if ($fails.Count) {
            $why = (@($fails | Select-Object -Last 3) -join ' / ')
            if ($why.Length -gt 300) { $why = $why.Substring(0, 300) }
            $o.reason = $o.reason + ': ' + $why
        }
    }
    return $o
}

# ---- the list ----------------------------------------------------------------

$planData = Read-JsonFile $Plan
if (-not $planData -or -not $planData.games) {
    Write-Log 'no list to check'
    exit 1
}
$list = @($planData.games)
$results = @{}
$old = Read-JsonFile $resultsF
if ($old) { foreach ($p in $old.PSObject.Properties) { $results[$p.Name] = $p.Value } }

$runStarted = Get-Date
$status = [ordered]@{
    running = $true; pid = $PID; startedAt = $runStarted.ToString('o'); total = $list.Count; index = 0
    current = $null; counts = [ordered]@{ boots = 0; crashed = 0; nostart = 0; noanswer = 0; look = 0 }
    stopped = $false; why = $null; restored = $false; endedAt = $null; label = [string] $planData.label
}
Write-JsonFile $statusF $status
Remove-Item -LiteralPath $stopF -ErrorAction SilentlyContinue
Write-Log ("start: {0} game(s), {1}, {2}s before the screenshot" -f $list.Count, $planData.label, $Wait)

# ---- one game at a time --------------------------------------------------------

$heard = $false                # RetroArch has answered for a game in this check
$again = $false                # the one second go at a first no answer is used
for ($n = 0; $n -lt $list.Count; $n++) {
    if (Test-Path -LiteralPath $stopF) { $status.stopped = $true; break }
    $g = $list[$n]
    # The games folder gone part way: every game left would be recorded as
    # "did not start", so the check stops. One file gone with its folder
    # still there is this game's own trouble, and runs as usual.
    if ($g.rom -and $g.home -and -not (Test-Path -LiteralPath $g.rom) -and -not (Test-Path -LiteralPath $g.home)) {
        $status.stopped = $true
        $status.why = "$($g.home) is not there any more, so the check stopped at game $($n + 1) of $($list.Count). Nothing was recorded for the games it did not reach."
        Write-Log $status.why
        break
    }
    $status.index = $n + 1
    $status.current = [ordered]@{ id = $g.id; title = $g.title; platform = $g.platform; since = (Get-Date).ToString('o') }
    Write-JsonFile $statusF $status

    $port = [int] $g.port
    $safe = Get-SafeName $g.id
    Get-ChildItem -LiteralPath $raw -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $raLogDir 'retroarch.log') -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $shots ($safe + '.png')) -ErrorAction SilentlyContinue

    $t0 = Get-Date
    $emuClosed = $true
    if ($g.mode -eq 'emu') {
        $o = Test-EmuGame $g $safe
        if ($o.skip) { $status.stopped = $true; break }
        $result = $o.result; $reason = $o.reason; $code = $o.code; $shot = $o.shot; $blank = $o.blank
        $emuClosed = $o.closed
    } else {
        # The same .bat as bin\launch.ps1: cd to the emulator's folder first (core
        # paths are relative to it), percent signs doubled, and UTF-8 with
        # "chcp 65001" so an accented name is not mangled into a failed start.
        $workDir = (Split-Path $g.exe -Parent).Replace('%', '%%')
        $batExe = ([string]$g.exe).Replace('%', '%%'); $batArgs = ([string]$g.args).Replace('%', '%%')
        [System.IO.File]::WriteAllText($batF, "@echo off`r`nchcp 65001 >nul`r`ncd /d `"$workDir`"`r`n`"$batExe`" $batArgs`r`n", $utf8)

        $t0 = Get-Date
        $result = 'noanswer'; $reason = ''; $code = $null; $shot = $false; $blank = $false
        $answered = $false; $playing = $false
        try {
            $proc = Start-Process -FilePath $batF -PassThru -WindowStyle Hidden
            $until = $t0.AddSeconds($StartWithin)
            while ((Get-Date) -lt $until -and -not $proc.HasExited -and -not (Test-Path -LiteralPath $stopF)) {
                $st = Send-RetroArch $port 'GET_STATUS' 700
                if ($st) { $answered = $true }
                if ($st -match 'PLAYING|PAUSED') { $playing = $true; break }
                Send-Pulse
                Start-Sleep -Milliseconds 400
            }
            if ($playing) {
                if (Wait-While $proc ($Wait * 1000)) {
                    [void] (Send-RetroArch $port 'SCREENSHOT' 0)
                    $waitShot = (Get-Date).AddSeconds(6)
                    $png = $null
                    while ((Get-Date) -lt $waitShot -and -not $png) {
                        Start-Sleep -Milliseconds 300
                        $png = Get-ChildItem -LiteralPath $raw -Filter '*.png' -File -ErrorAction SilentlyContinue |
                               Where-Object { $_.Length -gt 0 } | Select-Object -First 1
                    }
                    if ($png) {
                        Start-Sleep -Milliseconds 300              # written in full
                        $dest = Join-Path $shots ($safe + '.png')
                        Move-Item -LiteralPath $png.FullName -Destination $dest -Force
                        $shot = $true
                        $blank = Test-Blank $dest
                    }
                    if ($proc.HasExited) {
                        <#  It played the whole wait; what died was the picture.
                            A raw screenshot of a hardware-rendered core (Flycast,
                            PPSSPP) crashes RetroArch 1.22.2 (0xC0000005). The
                            game boots; say so, and say why no picture.      #>
                        $result = 'boots'
                        if (-not $shot) { $reason = 'no picture: taking one crashes RetroArch with this core' }
                    } else {
                        $result = 'boots'
                    }
                } elseif ($proc.HasExited) {
                    $result = 'crashed'
                    $reason = 'it started, then closed by itself after ' + [int]((Get-Date) - $t0).TotalSeconds + 's'
                } else {
                    $result = 'boots'                              # stopped by you during the wait: it was playing
                }
                # Quit the way you would: RetroArch's own QUIT, twice (a first one
                # can be the "press again to quit" warning), then force if it stays.
                if (-not $proc.HasExited) {
                    [void] (Send-RetroArch $port 'QUIT' 0)
                    Start-Sleep -Milliseconds 400
                    [void] (Send-RetroArch $port 'QUIT' 0)
                    $gone = (Get-Date).AddSeconds(10)
                    while ((Get-Date) -lt $gone -and -not $proc.HasExited) { Send-Pulse; Start-Sleep -Milliseconds 250 }
                    Stop-Tree $proc
                }
            } else {
                $stillUp = -not $proc.HasExited
                Stop-Tree $proc
                if ($stillUp -and $answered) {
                    $result = 'nostart'; $reason = "RetroArch was up for ${StartWithin}s but the game never started"
                } elseif ($stillUp) {
                    $result = 'noanswer'; $reason = "RetroArch did not answer on port ${port}, so whether it played cannot be told"
                } else {
                    $result = 'nostart'; $reason = 'it closed before the game started'
                }
            }
            if ($proc.HasExited) { try { $code = $proc.ExitCode } catch { } }
        } catch {
            $result = 'nostart'; $reason = 'could not start it: ' + $_.Exception.Message
        }
        # Playing, as far as RetroArch knows, but on the console's own menu: yours to judge.
        if ($result -eq 'boots' -and $shot -and $g.menu -eq 'ps1' -and (Test-Ps1Menu (Join-Path $shots ($safe + '.png')))) {
            $result = 'look'
            $reason = "on the PlayStation's own menu (Memory Card, CD Player): the disc did not start (a data-only .iso, or another console's disc)"
        }
        if ($result -ne 'boots') {
            # RetroArch's exit code, when it gave one: -1073741819 is a crash
            # (0xC0000005), and the first thing to look up.
            if ($null -ne $code -and $code -ne 0 -and $result -ne 'noanswer') { $reason = $reason + " (exit code $code)" }
            $ra = Get-RaReason
            if ($ra) { $reason = $reason + ': ' + $ra }
        }
        # RetroArch's first start on a PC can outlast the wait (a fresh unpack
        # read off a slow disk): until it has answered once, a no answer gets
        # one more go.
        if ($answered) { $heard = $true }
        if ($result -eq 'noanswer' -and -not $heard -and -not $again -and -not (Test-Path -LiteralPath $stopF)) {
            $again = $true
            Write-Log ("{0} [{1}]: no answer, and RetroArch has not answered yet in this check: tried once more" -f $g.title, $g.platform)
            Start-Sleep -Milliseconds 800
            $n--
            continue
        }
    }
    if (Test-Path -LiteralPath $stopF) { $status.stopped = $true }

    $results[[string] $g.id] = [ordered]@{
        id = $g.id; title = $g.title; platform = $g.platform; result = $result; reason = $reason
        seconds = [int]((Get-Date) - $t0).TotalSeconds; code = $code; shot = $shot; blank = $blank
        at = (Get-Date).ToString('o'); emu = $(if ($g.mode -eq 'emu') { [string] $g.emu } else { $null })
    }
    Write-JsonFile $resultsF $results
    $status.counts[$result] = [int] $status.counts[$result] + 1
    Write-Log ("{0} [{1}]: {2}{3}" -f $g.title, $g.platform, $result, $(if ($reason) { ' (' + $reason + ')' } else { '' }))
    # Left open rather than forced shut: nothing more starts until it is closed.
    if (-not $emuClosed) {
        $status.stopped = $true
        $status.why = "$($g.emu) did not close when asked, so the check stopped at game $($n + 1) of $($list.Count) rather than force it shut (that could cut off a save). Close it yourself, then Start carries on from the next game."
        Write-Log $status.why
    }
    if ($status.stopped) { break }
    Start-Sleep -Milliseconds 800                              # RetroArch's port and files let go
}

# ---- the play history, exactly as it was ------------------------------------
# Nothing above writes it, so a difference means something else did during the
# run: the copy is put back.
try {
    if (Test-Path -LiteralPath $before) {
        $a = [System.IO.File]::ReadAllBytes($before)
        $b = if (Test-Path -LiteralPath $sessions) { [System.IO.File]::ReadAllBytes($sessions) } else { [byte[]] @() }
        # Lines only added after what was there are real play (a web game the
        # page timed, as Play is refused during the check), so they are kept.
        # Anything else (shorter, or the old part changed) is put back.
        $added = $b.Length -gt $a.Length -and
                 [Convert]::ToBase64String($b, 0, $a.Length) -eq [Convert]::ToBase64String($a)
        if ($added) {
            Write-Log ("the play history grew by {0} bytes during the check: play from outside it, kept" -f ($b.Length - $a.Length))
        } elseif ($a.Length -ne $b.Length -or [Convert]::ToBase64String($a) -ne [Convert]::ToBase64String($b)) {
            Copy-Item -LiteralPath $before -Destination $sessions -Force
            $status.restored = $true
            Write-Log 'the play history had changed during the check: put back as it was before'
        }
    } elseif ((Test-Path -LiteralPath $noneF) -and (Test-Path -LiteralPath $sessions)) {
        Remove-Item -LiteralPath $sessions -Force
        $status.restored = $true
        Write-Log 'a play history appeared during the check where there was none: removed'
    }
} catch {
    Write-Log ('could not compare the play history: ' + $_.Exception.Message)
}

$status.running = $false
$status.current = $null
$status.endedAt = (Get-Date).ToString('o')
Write-JsonFile $statusF $status
Remove-Item -LiteralPath $stopF -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $batF -ErrorAction SilentlyContinue
Write-Log ("{0}: boots {1}, crashed {2}, did not start {3}, no answer {4}, look at it {5}" -f $(if ($status.stopped) { 'stopped' } else { 'done' }),
           $status.counts.boots, $status.counts.crashed, $status.counts.nostart, $status.counts.noanswer, $status.counts.look)
