/*  A stand-in for a program Play starts (tests\t-steam.js), compiled there
    into xsfake-launcher.exe by PowerShell's Add-Type.

        xsfake-launcher.exe <mode> <seconds> [<another program>]

    Each window is small, off the screen, and never takes the focus.

      window  a window for <seconds>, then it ends
      behind  a window for 2 seconds, then none, idle for <seconds>, as
              StarCraft Launcher.exe stays once Battle.net has closed
      opens   the same, with <another program> showing a window of its own
              for <seconds> meanwhile, as Battle.net does
      loads   a window for 2 seconds, none and busy for <seconds>, a window
              for 2 seconds, then it ends: a splash, then a long load
      child   a window for 2 seconds, then none, and a copy of itself with no
              window for <seconds>; it ends with it
      never   no window at all, idle for <seconds>, then it ends            */
using System;
using System.Diagnostics;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;

public class FakeLauncher : Form {
    public FakeLauncher() {
        Text = "Fake launcher";
        StartPosition = FormStartPosition.Manual;
        Location = new Point(-3000, -3000);
        ClientSize = new Size(200, 100);
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    // Off the taskbar by a style: ShowInTaskbar = false gives a window an
    // owner, and a window with an owner is no program's main one.
    protected override CreateParams CreateParams {
        get { CreateParams p = base.CreateParams; p.ExStyle |= 0x80; return p; }
    }
    static void Show(int seconds) {
        FakeLauncher f = new FakeLauncher();
        System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
        t.Interval = seconds * 1000;
        t.Tick += delegate { t.Stop(); f.Close(); };
        t.Start();
        Application.Run(f);
    }
    [STAThread]
    public static void Main(string[] args) {
        string mode = args[0];
        int seconds = int.Parse(args[1]);
        if (mode == "window") { Show(seconds); return; }
        if (mode == "never") { Thread.Sleep(seconds * 1000); return; }
        Show(2);
        if (mode == "behind") { Thread.Sleep(seconds * 1000); }
        if (mode == "opens") {
            Process.Start(args[2], "window " + seconds);
            Thread.Sleep(45000);
        }
        if (mode == "loads") {
            DateTime end = DateTime.Now.AddSeconds(seconds);
            while (DateTime.Now < end) { }
            Show(2);
        }
        if (mode == "child") {
            ProcessStartInfo s = new ProcessStartInfo(Application.ExecutablePath, "never " + seconds);
            s.UseShellExecute = false;
            s.CreateNoWindow = true;
            Process.Start(s).WaitForExit();
        }
    }
}
