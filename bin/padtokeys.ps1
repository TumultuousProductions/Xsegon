<#
    Xsegon - a controller as keys, for a game that reads only the keyboard: a
    Flashpoint game's Flash Player reads no controller (roadmap AU13).

    Started by api\launch.php beside the launcher. It reads the pad through
    XInput (an Xbox pad, and any pad Windows or Steam shows as one) and
    presses the game's keys, only while a window of the game's program is in
    front: anywhere else every held key is let go. The d-pad and the left
    stick both move. It ends when the game does (data\running.json says
    another game, or nothing, or its launcher has gone). The loop is compiled
    code: read in PowerShell 125 times a second it took a tenth of a core.

    To see whether it finds a pad, with nothing sent:
        .\bin\padtokeys.ps1 -Probe 5
#>

param(
    # Pad button to key: "move=arrows,a=Z,x=X,start=Enter" (no quotes to lose on a command line).
    # Buttons: a b x y lb rb lt rt start back; "move" puts the d-pad and the left stick on the arrows.
    [string] $Map = 'move=arrows',
    # The game's program names, comma separated, a * at the end allowed: only their windows get the keys.
    [string] $Windows = 'flashplayer*',
    # Keys pressed once when the game's window first comes to the front, as "Ctrl+F"; empty for none.
    [string] $FullScreen = '',
    # The programs, named as for -Windows, whose own full screen key that is; empty for any of the game's.
    [string] $FullScreenIn = '',
    [string] $GameId = '',
    [string] $DataDir = '',
    # Seconds of only saying which pads XInput sees and what is held; nothing is pressed.
    [int]    $Probe = 0,
    [switch] $Log
)

$ErrorActionPreference = 'Stop'

function Write-Log([string] $msg) {
    if (-not $Log) { return }
    try {
        $dir = Join-Path $DataDir 'log'
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $file = Join-Path $dir ((Get-Date).ToString('yyyy-MM-dd') + '.log')
        $line = (Get-Date).ToString('HH:mm:ss.fff') + ' S PADK ' + $msg + "`n"
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
public static class PadKeys {
    [StructLayout(LayoutKind.Sequential)] public struct State {
        public uint Packet; public ushort Buttons; public byte LT; public byte RT;
        public short LX; public short LY; public short RX; public short RY;
    }
    [DllImport("xinput1_4.dll", EntryPoint = "XInputGetState")] static extern uint Get14(uint i, out State s);
    [DllImport("xinput9_1_0.dll", EntryPoint = "XInputGetState")] static extern uint Get910(uint i, out State s);
    static bool old;
    static bool Read(uint i, out State s) {
        if (!old) { try { return Get14(i, out s) == 0; } catch (DllNotFoundException) { old = true; } }
        return Get910(i, out s) == 0;
    }
    [StructLayout(LayoutKind.Sequential)] struct KeyIn { public ushort Vk; public ushort Scan; public uint Flags; public uint Time; public IntPtr Extra; public uint Pad1; public uint Pad2; }
    [StructLayout(LayoutKind.Sequential)] struct Input { public uint Type; public KeyIn Key; }
    [DllImport("user32.dll")] static extern uint SendInput(uint n, Input[] inputs, int size);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    static void Key(ushort vk, bool down) {
        var k = new KeyIn { Vk = vk, Scan = (ushort)MapVirtualKey(vk, 0), Flags = down ? 0u : 2u };
        if (vk >= 0x21 && vk <= 0x2E) { k.Flags |= 1u; }      // the arrows and their block are extended keys
        SendInput(1, new[] { new Input { Type = 1, Key = k } }, Marshal.SizeOf(typeof(Input)));
    }

    // The buttons by name, the four directions first; lt and rt are read from the triggers.
    public static readonly string[] Names = { "up", "down", "left", "right", "start", "back", "lb", "rb", "a", "b", "x", "y", "lt", "rt" };
    static readonly ushort[] Bits = { 0x0001, 0x0002, 0x0004, 0x0008, 0x0010, 0x0020, 0x0100, 0x0200, 0x1000, 0x2000, 0x4000, 0x8000, 0, 0 };
    static readonly bool[] stick = new bool[4];
    static readonly bool[] live = { true, true, true, true };
    static DateTime emptyAsked = DateTime.MinValue;

    // What is held on any connected pad, by Names' order; the left stick counts as the d-pad. Answers how many pads answered.
    // An empty slot is asked about once a second: Windows is slow to say a slot is empty.
    public static int Held(bool[] held) {
        Array.Clear(held, 0, held.Length);
        int pads = 0;
        bool askEmpty = (DateTime.UtcNow - emptyAsked).TotalMilliseconds >= 1000;
        if (askEmpty) { emptyAsked = DateTime.UtcNow; }
        for (uint i = 0; i < 4; i++) {
            if (!live[i] && !askEmpty) { continue; }
            State s;
            live[i] = Read(i, out s);
            if (!live[i]) { continue; }
            pads++;
            for (int b = 0; b < 12; b++) { if ((s.Buttons & Bits[b]) != 0) { held[b] = true; } }
            if (s.LT > 128) { held[12] = true; }
            if (s.RT > 128) { held[13] = true; }
            // Pushed past half to count, back under a third to let go: a stick resting near the line does not flicker.
            int[] push = { s.LY, -s.LY, -s.LX, s.LX };
            for (int d = 0; d < 4; d++) {
                stick[d] = stick[d] ? push[d] > 11000 : push[d] > 16000;
                if (stick[d]) { held[d] = true; }
            }
        }
        return pads;
    }

    static readonly Dictionary<uint, string> procNames = new Dictionary<uint, string>();
    // The program name of the window in front, "" when there is none.
    static string FrontName() {
        uint pid;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        if (pid == 0) { return ""; }
        string n;
        if (!procNames.TryGetValue(pid, out n)) {
            try { n = Process.GetProcessById((int)pid).ProcessName; } catch { n = ""; }
            procNames[pid] = n;
        }
        return n;
    }

    public static bool Fits(string n, string[] names) {
        if (n.Length == 0) { return false; }
        foreach (var w in names) {
            if (w.EndsWith("*") ? n.StartsWith(w.TrimEnd('*'), StringComparison.OrdinalIgnoreCase) : string.Equals(n, w, StringComparison.OrdinalIgnoreCase)) { return true; }
        }
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

    // The loop, until the game ends: keys pressed and let go as the pad's buttons are, only into the game's window.
    // Full screen goes only into a program fullIn names (none named: any of the game's); fullSaid says what came of it.
    public static string Run(ushort[] vks, string[] windows, ushort[] full, string[] fullIn, string runningFile, string gameId, out int presses, out string fullSaid) {
        presses = 0;
        bool fullDone = full.Length == 0;
        fullSaid = fullDone ? "" : "full screen never asked: the game's window never came to the front";
        var held = new bool[Names.Length];
        var down = new bool[Names.Length];
        var started = DateTime.UtcNow;
        var lastCheck = DateTime.MinValue;
        DateTime? frontSince = null;
        bool seen = false;
        try {
            while (true) {
                if ((DateTime.UtcNow - lastCheck).TotalMilliseconds >= 1000) {
                    lastCheck = DateTime.UtcNow;
                    var run = Running(runningFile, gameId, ref seen);
                    if (run == false) { return "the game ended"; }
                    // No launcher in sight within a minute: nothing to follow, so nothing is pressed.
                    if (run == null && (DateTime.UtcNow - started).TotalSeconds > 60) { return "no game was seen running"; }
                }
                string front = FrontName();
                if (!Fits(front, windows)) {
                    LetGo(vks, down);
                    frontSince = null;
                    Thread.Sleep(30);
                    continue;
                }
                if (frontSince == null) { frontSince = DateTime.UtcNow; }
                // Full screen once, when the game's window has been in front a moment; another player's keys mean something else.
                if (!fullDone && (DateTime.UtcNow - frontSince.Value).TotalMilliseconds >= 1500) {
                    if (fullIn.Length == 0 || Fits(front, fullIn)) {
                        foreach (var k in full) { Key(k, true); }
                        for (int i = full.Length - 1; i >= 0; i--) { Key(full[i], false); }
                        fullSaid = "full screen asked";
                    } else {
                        fullSaid = "full screen not asked: the game plays in " + front + ", not " + string.Join(",", fullIn);
                    }
                    fullDone = true;
                }
                Held(held);
                for (int b = 0; b < Names.Length; b++) {
                    if (vks[b] == 0) { continue; }
                    if (held[b] && !down[b]) { Key(vks[b], true); down[b] = true; presses++; }
                    else if (!held[b] && down[b]) { Key(vks[b], false); down[b] = false; }
                }
                Thread.Sleep(8);
            }
        } finally {
            LetGo(vks, down);
        }
    }

    static void LetGo(ushort[] vks, bool[] down) {
        for (int b = 0; b < down.Length; b++) { if (down[b]) { Key(vks[b], false); down[b] = false; } }
    }
}
}
'@

# Key names as the games' own option screens write them, to Windows' key codes.
$named = @{ up = 0x26; down = 0x28; left = 0x25; right = 0x27; space = 0x20; enter = 0x0D; return = 0x0D; escape = 0x1B; esc = 0x1B
            tab = 0x09; shift = 0x10; ctrl = 0x11; control = 0x11; alt = 0x12; backspace = 0x08 }
function Get-Vk([string] $name) {
    $n = $name.Trim().ToLower()
    if ($named.ContainsKey($n)) { return [uint16]$named[$n] }
    if ($n -match '^[a-z0-9]$') { return [uint16][int][char]$n.ToUpper() }
    if ($n -match '^f([1-9]|1[0-2])$') { return [uint16](0x6F + [int]$Matches[1]) }
    return $null
}

$names = [Xsegon.PadKeys]::Names

if ($Probe -gt 0) {
    $held = New-Object bool[] $names.Count
    $until = (Get-Date).AddSeconds($Probe)
    $last = ''
    while ((Get-Date) -lt $until) {
        $pads = [Xsegon.PadKeys]::Held($held)
        $now = "$pads pad(s); held: " + ((0..($names.Count - 1) | Where-Object { $held[$_] } | ForEach-Object { $names[$_] }) -join ' ')
        if ($now -ne $last) { Write-Output ((Get-Date).ToString('HH:mm:ss.fff') + ' ' + $now); $last = $now }
        Start-Sleep -Milliseconds 20
    }
    return
}

# The pad's buttons to the keys they press, in the compiled loop's order: 0 presses nothing.
$vks = New-Object uint16[] $names.Count
foreach ($pair in ($Map -split ',')) {
    $b, $key = ($pair -split '=', 2) | ForEach-Object { $_.Trim().ToLower() }
    if (-not $b -or -not $key) { continue }
    if ($b -eq 'move') {
        if ($key -eq 'arrows') { foreach ($d in 'up', 'down', 'left', 'right') { $vks[[array]::IndexOf($names, $d)] = Get-Vk $d } }
        continue
    }
    $at = [array]::IndexOf($names, $b)
    $vk = Get-Vk $key
    if ($at -ge 0 -and $null -ne $vk) { $vks[$at] = $vk }
}
$wins = [string[]]@($Windows -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$full = [uint16[]]@($FullScreen -split '\+' | ForEach-Object { Get-Vk $_ } | Where-Object { $null -ne $_ })
$fullIn = [string[]]@($FullScreenIn -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })

Write-Log ("for " + $GameId + ": " + $Map + " into " + ($wins -join ',') + ($(if ($full.Count) { ', full screen by ' + $FullScreen + $(if ($fullIn.Count) { ' in ' + ($fullIn -join ',') } else { '' }) } else { '' })))
$presses = 0
$fullSaid = ''
$why = 'it stopped on a fault'
try {
    $why = [Xsegon.PadKeys]::Run($vks, $wins, $full, $fullIn, (Join-Path $DataDir 'running.json'), $GameId, [ref]$presses, [ref]$fullSaid)
} catch {
    $why = 'it stopped on a fault: ' + $_.Exception.Message
} finally {
    Write-Log ('stopped for ' + $GameId + ': ' + $why + '; ' + $presses + ' presses sent' + $(if ($fullSaid) { ', ' + $fullSaid } else { '' }))
}
