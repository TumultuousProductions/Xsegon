<#
    Xsegon - a held Xbox button leaves a game, in an emulator with no pad
    press of its own for that: PCSX2, Dolphin, Cemu and Xenia (roadmap CA14;
    each one's file in includes\emus\ says so). RPCS3, xemu and Eden keep
    their own.

    Started by api\launch.php beside the launcher. It reads the Xbox button
    through XInput's hidden state call (the plain one leaves that button out)
    and, held for HoldSeconds and let go before MaxHoldSeconds with the
    emulator's window in front when the hold began, asks the emulator to
    close as its X button would. A longer hold, or a pad gone while held, is
    a pad being switched off: nothing is done. The same hold again 8 to 60
    seconds after asking, with it still open, ends it; later than that, it is
    asked again. Only processes of the emulator's own folder, started for
    this launch, are asked or ended. It ends when the game does
    (data\running.json says another game, or its launcher has gone).

    To see whether it hears the button, with nothing closed:
        .\bin\padleave.ps1 -Probe 5
#>

param(
    # The emulator's program, a full path: only its processes are asked to close.
    [string] $Exe = '',
    [string] $GameId = '',
    [string] $DataDir = '',
    [double] $HoldSeconds = 2,
    # Held this long or more is a pad being switched off (an Xbox pad's own 6 second hold).
    [double] $MaxHoldSeconds = 5,
    # Seconds of only saying which pads answer and whether the Xbox button is held; nothing is closed.
    [int]    $Probe = 0,
    # Tests only: the button counts as held from the start for these seconds, then let go, the window in front or not.
    [double] $Pretend = 0,
    [switch] $Log
)

$ErrorActionPreference = 'Stop'

function Write-Log([string] $msg) {
    if (-not $Log) { return }
    try {
        $dir = Join-Path $DataDir 'log'
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $file = Join-Path $dir ((Get-Date).ToString('yyyy-MM-dd') + '.log')
        $line = (Get-Date).ToString('HH:mm:ss.fff') + ' S PADL ' + $msg + "`n"
        [System.IO.File]::AppendAllText($file, $line, (New-Object System.Text.UTF8Encoding($false)))
    } catch { }
}

if (-not $DataDir) { $DataDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'data' }

try {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace Xsegon {
public static class PadLeave {
    // XINPUT_STATE, with room for the extra word the hidden call may write after it.
    [StructLayout(LayoutKind.Sequential)] public struct State {
        public uint Packet; public ushort Buttons; public byte LT; public byte RT;
        public short LX; public short LY; public short RX; public short RY;
        public uint Reserved;
    }
    // Ordinal 100 is XInputGetStateEx: the state with the Xbox button (0x0400) in it.
    [DllImport("xinput1_4.dll", EntryPoint = "#100")] static extern uint GetEx(uint i, out State s);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", SetLastError = true)] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder name, ref uint size);
    [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr h, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    const ushort Guide = 0x0400;
    static readonly bool[] live = { true, true, true, true };
    static DateTime emptyAsked = DateTime.MinValue;

    // Whether the Xbox button is held on any pad; pads answers how many answered. Throws when the call is not there.
    public static bool Held(out int pads) {
        pads = 0;
        bool held = false;
        // An empty slot is asked about once a second: Windows is slow to say a slot is empty.
        bool askEmpty = (DateTime.UtcNow - emptyAsked).TotalMilliseconds >= 1000;
        if (askEmpty) { emptyAsked = DateTime.UtcNow; }
        for (uint i = 0; i < 4; i++) {
            if (!live[i] && !askEmpty) { continue; }
            State s;
            live[i] = GetEx(i, out s) == 0;
            if (!live[i]) { continue; }
            pads++;
            if ((s.Buttons & Guide) != 0) { held = true; }
        }
        return held;
    }

    /* The emulator's processes for this launch: its program's name, run from its folder by the
       path Windows gives (one it will not give is not taken for it), started since $since (one
       the person had open before is theirs). */
    public static List<Process> Mine(string exe, DateTime since) {
        var found = new List<Process>();
        string name = Path.GetFileNameWithoutExtension(exe);
        string dir = Path.GetDirectoryName(Path.GetFullPath(exe)) ?? "";
        foreach (var p in Process.GetProcessesByName(name)) {
            IntPtr h = OpenProcess(0x1000, false, p.Id);      // PROCESS_QUERY_LIMITED_INFORMATION
            if (h == IntPtr.Zero) { continue; }
            try {
                var sb = new StringBuilder(1024);
                uint n = (uint)sb.Capacity;
                if (!QueryFullProcessImageName(h, 0, sb, ref n)) { continue; }
                if (!string.Equals(Path.GetDirectoryName(sb.ToString()), dir, StringComparison.OrdinalIgnoreCase)) { continue; }
                long made, gone, k, u;
                if (GetProcessTimes(h, out made, out gone, out k, out u) && DateTime.FromFileTimeUtc(made) < since) { continue; }
                found.Add(p);
            } finally { CloseHandle(h); }
        }
        return found;
    }

    // What the X button sends (WM_CLOSE), to each visible top-level window of these processes, as the Runs check closes one.
    static int AskClose(List<Process> mine, out int visible, out int refused) {
        var want = new HashSet<uint>();
        foreach (var p in mine) { want.Add((uint)p.Id); }
        int asks = 0, seen = 0, err = 0;
        EnumWindows(delegate (IntPtr h, IntPtr l) {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (!want.Contains(pid) || !IsWindowVisible(h)) { return true; }
            seen++;
            if (PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero)) { asks++; } else { err = Marshal.GetLastWin32Error(); }
            return true;
        }, IntPtr.Zero);
        visible = seen;
        refused = err;
        return asks;
    }

    static bool AnyVisible(List<Process> mine) {
        var want = new HashSet<uint>();
        foreach (var p in mine) { want.Add((uint)p.Id); }
        bool any = false;
        EnumWindows(delegate (IntPtr h, IntPtr l) {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (want.Contains(pid) && IsWindowVisible(h)) { any = true; return false; }
            return true;
        }, IntPtr.Zero);
        return any;
    }

    static bool InFront(List<Process> mine) {
        uint pid;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        foreach (var p in mine) { if (p.Id == pid) { return true; } }
        return false;
    }

    static int launcherPid = 0;
    static int misses = 0;
    static bool Alive(int pid) {
        try { return !Process.GetProcessById(pid).HasExited; } catch { return false; }
    }

    // The game still running: true, false once it has ended, null while no launcher is written down yet.
    static bool? Running(string file, string gameId, ref bool seen) {
        string text = null;
        // Shared for delete as well, so the launcher can take the file away at the game's end while this reads it.
        try {
            using (var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var r = new StreamReader(fs)) { text = r.ReadToEnd(); }
        } catch { }
        if (text != null) {
            var g = Regex.Match(text, "\"gameId\"\\s*:\\s*\"([^\"]*)\"");
            if (gameId.Length > 0 && g.Success && g.Groups[1].Value != gameId) { return false; }
            var p = Regex.Match(text, "\"launcherPid\"\\s*:\\s*(\\d+)");
            if (p.Success) {
                seen = true;
                misses = 0;
                launcherPid = int.Parse(p.Groups[1].Value);
                return Alive(launcherPid);
            }
        }
        // Not read this time (a scan holding it, the file being replaced, or gone at the game's end):
        // the launcher it named still answers for the game; with none known, twice in a row ends it.
        if (launcherPid > 0) { return Alive(launcherPid); }
        if (!seen) { return null; }
        return ++misses >= 2 ? (bool?)false : true;
    }

    static string logFile = "";
    // A line in the day log as it happens, in the launcher's form; nothing when logging is off.
    static void Say(string msg) {
        if (logFile.Length == 0) { return; }
        try { File.AppendAllText(logFile, DateTime.Now.ToString("HH:mm:ss.fff") + " S PADL " + msg + "\n"); } catch { }
    }

    static string Why(int err) {
        if (err == 5) { return "Windows refused (access denied: it may run as administrator, which Xsegon's helper cannot reach)"; }
        return err == 0 ? "" : "Windows refused (error " + err + ")";
    }

    // The loop, until the game ends.
    public static string Run(string exe, string runningFile, string gameId, double hold, double maxHold, double pretend, string log) {
        logFile = log;
        var started = DateTime.UtcNow;
        var since = started.AddSeconds(-120);   // the emulator starts beside this helper, a moment before or after it
        var lastCheck = DateTime.MinValue;
        DateTime? pressAt = null;        // when the button went down
        bool front = false;              // the emulator in front (or windowless after an ask) when it went down
        bool dropped = false;            // a pad went off while it was held: a pad being switched off
        bool longSaid = false;
        int padsAtPress = 0;
        DateTime? asked = null;          // when the emulator was last asked to close
        bool seen = false;
        string name = Path.GetFileName(exe);
        while (true) {
            if ((DateTime.UtcNow - lastCheck).TotalMilliseconds >= 1000) {
                lastCheck = DateTime.UtcNow;
                var run = Running(runningFile, gameId, ref seen);
                if (run == false) { return "the game ended"; }
                if (run == null && (DateTime.UtcNow - started).TotalSeconds > 60) { return "no game was seen running"; }
            }
            int pads;
            bool fake = pretend > 0 && (DateTime.UtcNow - started).TotalSeconds < pretend;
            bool down = Held(out pads) || fake;
            double sinceAsk = asked == null ? -1 : (DateTime.UtcNow - asked.Value).TotalSeconds;
            if (down) {
                if (pressAt == null) {
                    pressAt = DateTime.UtcNow;
                    padsAtPress = pads;
                    dropped = false;
                    longSaid = false;
                    var at = Mine(exe, since);
                    // In front when it went down: an overlay the press itself opens (Game Bar) does not count against it.
                    front = at.Count > 0 && (fake || InFront(at) || (sinceAsk >= 0 && sinceAsk <= 60 && !AnyVisible(at)));
                } else if (!fake && !dropped && pads < padsAtPress) {
                    dropped = true;
                    Say("a pad went off while the Xbox button was held: taken as a pad being switched off, nothing done");
                } else if (!longSaid && (DateTime.UtcNow - pressAt.Value).TotalSeconds >= maxHold) {
                    longSaid = true;
                    Say("the Xbox button held " + maxHold + " s or more: taken as a pad being switched off, nothing done");
                }
                Thread.Sleep(20);
                continue;
            }
            if (pressAt == null) { Thread.Sleep(50); continue; }
            // Let go: a hold between HoldSeconds and MaxHoldSeconds is acted on.
            double held = (DateTime.UtcNow - pressAt.Value).TotalSeconds;
            pressAt = null;
            if (dropped || held < hold || held >= maxHold) { continue; }
            var mine = Mine(exe, since);
            if (mine.Count == 0) { Say("held " + Math.Round(held, 1) + " s: no " + name + " of this launch is running"); continue; }
            if (!front) { Say("held " + Math.Round(held, 1) + " s with another window in front: nothing done"); continue; }
            if (sinceAsk >= 8 && sinceAsk <= 60) {
                // Asked 8 to 60 seconds ago and still open: this hold ends it.
                int ended = 0;
                string fail = "";
                foreach (var p in mine) {
                    try { p.Kill(); if (p.WaitForExit(3000)) { ended++; } else { fail = "it had not ended 3 s later"; } }
                    catch (Exception e) { fail = e.Message.IndexOf("denied", StringComparison.OrdinalIgnoreCase) >= 0 ? Why(5) : e.Message; }
                }
                Say("held again " + Math.Round(sinceAsk) + " s after asking, still open: ended " + ended + " of " + mine.Count + " process(es)" + (fail.Length > 0 ? "; not ended: " + fail : ""));
                asked = null;
                continue;
            }
            if (sinceAsk >= 0 && sinceAsk < 8) { Say("held again " + Math.Round(sinceAsk, 1) + " s after asking: given its time to close"); continue; }
            int visible, refused;
            int asks = AskClose(mine, out visible, out refused);
            asked = DateTime.UtcNow;
            Say("held " + Math.Round(held, 1) + " s" + (fake ? " (pretended)" : "") + ": asked " + asks + " window(s) of " + name + " to close"
                + (asks == 0 ? (visible == 0 ? "; it has no window showing" : "; " + Why(refused)) : ""));
        }
    }
}
}
'@
} catch {
    Write-Log ('could not start for ' + $GameId + ': its code would not build (' + $_.Exception.Message + ')')
    Write-Output ('padleave could not start: ' + $_.Exception.Message)
    return
}

if ($Probe -gt 0) {
    $until = (Get-Date).AddSeconds($Probe)
    $last = ''
    while ((Get-Date) -lt $until) {
        $pads = 0
        try { $held = [Xsegon.PadLeave]::Held([ref]$pads) } catch { Write-Output ('XInput would not answer: ' + $_.Exception.Message); return }
        $now = "$pads pad(s); Xbox button " + $(if ($held) { 'held' } else { 'up' })
        if ($now -ne $last) { Write-Output ((Get-Date).ToString('HH:mm:ss.fff') + ' ' + $now); $last = $now }
        Start-Sleep -Milliseconds 20
    }
    return
}

$why = 'it stopped on a fault'
Write-Log ('for ' + $GameId + ': holding the Xbox button ' + $HoldSeconds + ' to ' + $MaxHoldSeconds + ' s and letting go closes ' + [System.IO.Path]::GetFileName($Exe))
$logFile = if ($Log) { Join-Path (Join-Path $DataDir 'log') ((Get-Date).ToString('yyyy-MM-dd') + '.log') } else { '' }
try {
    $why = [Xsegon.PadLeave]::Run($Exe, (Join-Path $DataDir 'running.json'), $GameId, $HoldSeconds, $MaxHoldSeconds, $Pretend, $logFile)
} catch {
    $why = 'it stopped on a fault: ' + $_.Exception.Message
} finally {
    Write-Log ('stopped for ' + $GameId + ': ' + $why)
}
