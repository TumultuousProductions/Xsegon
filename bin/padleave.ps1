<#
    Xsegon - a held Xbox button leaves a game, in an emulator with no pad
    press of its own for that: PCSX2, Dolphin, Cemu and Xenia (roadmap CA14;
    each one's file in includes\emus\ says so). RPCS3, xemu and Eden keep
    their own.

    Started by api\launch.php beside the launcher. It reads the Xbox button
    through XInput's hidden state call (the plain one leaves that button out)
    and, held for HoldSeconds while the emulator's window is in front, asks
    the emulator to close as its X button would. Held again once that has
    not worked, it ends the emulator. It ends when the game does
    (data\running.json says another game, or nothing, or its launcher has
    gone).

    To see whether it hears the button, with nothing closed:
        .\bin\padleave.ps1 -Probe 5
#>

param(
    # The emulator's program, a full path: only its processes are asked to close.
    [string] $Exe = '',
    [string] $GameId = '',
    [string] $DataDir = '',
    [double] $HoldSeconds = 2,
    # Seconds of only saying which pads answer and whether the Xbox button is held; nothing is closed.
    [int]    $Probe = 0,
    # Tests only: the button counts as held from the start for these seconds, the window in front or not.
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

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;

namespace Xsegon {
public static class PadLeave {
    [StructLayout(LayoutKind.Sequential)] public struct State {
        public uint Packet; public ushort Buttons; public byte LT; public byte RT;
        public short LX; public short LY; public short RX; public short RY;
    }
    // Ordinal 100 is XInputGetStateEx: the state with the Xbox button (0x0400) in it.
    [DllImport("xinput1_4.dll", EntryPoint = "#100")] static extern uint GetEx(uint i, out State s);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
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

    // The emulator's processes: its program's name, from its folder where Windows says.
    public static List<Process> Mine(string exe) {
        var found = new List<Process>();
        string name = Path.GetFileNameWithoutExtension(exe);
        string dir = Path.GetDirectoryName(exe) ?? "";
        foreach (var p in Process.GetProcessesByName(name)) {
            string at = null;
            try { at = p.MainModule.FileName; } catch { }
            if (at == null || string.Equals(Path.GetDirectoryName(at), dir, StringComparison.OrdinalIgnoreCase)) { found.Add(p); }
        }
        return found;
    }

    // What the X button sends (WM_CLOSE), to each visible top-level window of these processes, as the Runs check closes one.
    static int AskClose(List<Process> mine) {
        var want = new HashSet<uint>();
        foreach (var p in mine) { want.Add((uint)p.Id); }
        int asks = 0;
        EnumWindows(delegate (IntPtr h, IntPtr l) {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (want.Contains(pid) && IsWindowVisible(h) && PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero)) { asks++; }
            return true;
        }, IntPtr.Zero);
        return asks;
    }

    static bool InFront(List<Process> mine) {
        uint pid;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        foreach (var p in mine) { if (p.Id == pid) { return true; } }
        return false;
    }

    // The game still running: true, false once it has ended, null while no launcher is written down yet.
    static bool? Running(string file, string gameId, ref bool seen) {
        string text;
        try { text = File.ReadAllText(file); } catch { return seen ? (bool?)false : null; }
        var g = Regex.Match(text, "\"gameId\"\\s*:\\s*\"([^\"]*)\"");
        if (gameId.Length > 0 && g.Success && g.Groups[1].Value != gameId) { return false; }
        var p = Regex.Match(text, "\"launcherPid\"\\s*:\\s*(\\d+)");
        if (!p.Success) { return seen ? (bool?)false : null; }
        seen = true;
        try { return !Process.GetProcessById(int.Parse(p.Groups[1].Value)).HasExited; } catch { return false; }
    }

    static string logFile = "";
    // A line in the day log as it happens, in the launcher's form; nothing when logging is off.
    static void Say(string msg) {
        if (logFile.Length == 0) { return; }
        try { File.AppendAllText(logFile, DateTime.Now.ToString("HH:mm:ss.fff") + " S PADL " + msg + "\n"); } catch { }
    }

    // The loop, until the game ends.
    public static string Run(string exe, string runningFile, string gameId, double hold, double pretend, string log) {
        logFile = log;
        var started = DateTime.UtcNow;
        var lastCheck = DateTime.MinValue;
        DateTime? since = null;
        DateTime? asked = null;          // when the emulator was asked to close
        bool waitLetGo = false;          // a hold acted on counts again only after the button is let go
        bool seen = false;
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
            if (!down) { since = null; waitLetGo = false; Thread.Sleep(50); continue; }
            if (waitLetGo) { Thread.Sleep(50); continue; }
            var mine = Mine(exe);
            if (mine.Count == 0 || (!fake && !InFront(mine))) { since = null; Thread.Sleep(50); continue; }
            if (since == null) { since = DateTime.UtcNow; }
            if ((DateTime.UtcNow - since.Value).TotalSeconds < hold) { Thread.Sleep(20); continue; }
            waitLetGo = true;
            since = null;
            // Asked once already, 8 seconds gone and still open: this hold ends it.
            if (asked != null && (DateTime.UtcNow - asked.Value).TotalSeconds >= 8) {
                foreach (var p in mine) { try { p.Kill(); } catch { } }
                Say("held again " + Math.Round((DateTime.UtcNow - asked.Value).TotalSeconds) + " s after asking, still open: ended " + mine.Count + " process(es)");
                continue;
            }
            if (asked != null) { continue; }    // asked a moment ago: given its time to close
            int asks = AskClose(mine);
            asked = DateTime.UtcNow;
            Say("held " + hold + " s" + (fake ? " (pretended)" : "") + ": asked " + asks + " window(s) of " + Path.GetFileName(exe) + " to close");
        }
    }
}
}
'@

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
Write-Log ('for ' + $GameId + ': holding the Xbox button ' + $HoldSeconds + ' s closes ' + [System.IO.Path]::GetFileName($Exe))
$logFile = if ($Log) { Join-Path (Join-Path $DataDir 'log') ((Get-Date).ToString('yyyy-MM-dd') + '.log') } else { '' }
try {
    $why = [Xsegon.PadLeave]::Run($Exe, (Join-Path $DataDir 'running.json'), $GameId, $HoldSeconds, $Pretend, $logFile)
} catch {
    $why = 'it stopped on a fault: ' + $_.Exception.Message
} finally {
    Write-Log ('stopped for ' + $GameId + ': ' + $why)
}
