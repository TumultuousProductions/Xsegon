/*  A stand-in emulator for the runs check's tests (tests\t-runcheck.js),
    compiled there into xsfake-emu.exe by PowerShell's Add-Type.

        xsfake-emu.exe <mode> <log file> [<monitor port>]

    It opens a small window off the screen, never taking the focus, and
    behaves as <mode> says:

      play      writes "FAKE BOOTED" to its log, keeps a picture in its window
      title     says nothing in its log; its title shows "Fake | running"
      quiet     a window, and nothing that says a game started
      fail      writes "FAKE ERROR: no BIOS" and stays open, never booting
      exit      writes "FAKE ERROR: bad file" and closes at once, code 2
      crash     boots, then closes by itself, code 3
      stubborn  boots, and will not close when asked (the X button)
      slow      boots; asked to close, its window goes at once and the
                program ends eighteen seconds later (RPCS3 after a game that
                ignored its exit request)
      xbox      a quiet window, and xemu's QEMU monitor on the port given:
                memsave writes an Xbox program header for "Fake Game"
      dash      the same, with a menu's header ("XMenu", 00000005), as
                a real disc that never started showed

    It writes only the log file it is given, and the files memsave names. */
using System;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

public class FakeEmu : Form {
    string mode, log;
    public FakeEmu(string mode, string log) {
        this.mode = mode; this.log = log;
        Text = mode == "title" ? "Fake | running | Test Game" : "Fake emulator";
        StartPosition = FormStartPosition.Manual;
        Location = new Point(-3000, -3000);
        ClientSize = new Size(320, 240);
        ShowInTaskbar = false;
        BackColor = Color.Black;
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    void Log(string line) { try { File.AppendAllText(log, line + Environment.NewLine); } catch (Exception) { } }
    protected override void OnShown(EventArgs e) {
        base.OnShown(e);
        System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
        t.Interval = 400;
        t.Tick += delegate {
            t.Stop();
            if (mode == "play" || mode == "crash" || mode == "stubborn" || mode == "slow") { Log("FAKE BOOTED"); }
            if (mode == "fail") { Log("FAKE ERROR: no BIOS"); }
            if (mode == "crash") {
                System.Windows.Forms.Timer c = new System.Windows.Forms.Timer();
                c.Interval = 600;
                c.Tick += delegate { Environment.Exit(3); };
                c.Start();
            }
        };
        t.Start();
    }
    protected override void OnPaint(PaintEventArgs e) {
        // A picture with something in it, so the check's blank test says no.
        e.Graphics.FillRectangle(Brushes.OrangeRed, 20, 20, 120, 90);
        e.Graphics.FillRectangle(Brushes.DodgerBlue, 160, 110, 130, 100);
    }
    bool leaving;
    protected override void OnFormClosing(FormClosingEventArgs e) {
        if (mode == "stubborn") { e.Cancel = true; return; }
        if (mode == "slow") {
            e.Cancel = true;
            if (leaving) { return; }
            leaving = true;
            Hide();
            System.Windows.Forms.Timer q = new System.Windows.Forms.Timer();
            q.Interval = 18000;                     // past the check's fifteen seconds an ask
            q.Tick += delegate { Environment.Exit(0); };
            q.Start();
            return;
        }
        base.OnFormClosing(e);
    }
    // The header at 0x10000 as memsave would save it: "XBEH", the certificate's
    // address at 0x118, and there the title ID (+8) and name (+0xC, UTF-16).
    static byte[] Header(bool dash) {
        byte[] b = new byte[8192];
        BitConverter.GetBytes(0x48454258u).CopyTo(b, 0);
        BitConverter.GetBytes(0x10200u).CopyTo(b, 0x118);
        BitConverter.GetBytes(dash ? 0x00000005u : 0x4D530001u).CopyTo(b, 0x208);
        Encoding.Unicode.GetBytes(dash ? "XMenu" : "Fake Game").CopyTo(b, 0x20C);
        return b;
    }
    // A QEMU monitor of a sort: the greeting, then {"return": {}} to every
    // command, memsave writing the header to the file it names.
    static void Monitor(int port, bool dash) {
        TcpListener l = new TcpListener(IPAddress.Loopback, port);
        l.Start();
        Thread th = new Thread(delegate () {
            while (true) {
                try {
                    using (TcpClient c = l.AcceptTcpClient()) {
                        NetworkStream s = c.GetStream();
                        StreamReader r = new StreamReader(s);
                        StreamWriter w = new StreamWriter(s);
                        w.NewLine = "\r\n";
                        w.AutoFlush = true;
                        w.WriteLine("{\"QMP\": {\"version\": {}, \"capabilities\": []}}");
                        string line;
                        while ((line = r.ReadLine()) != null) {
                            if (line.Contains("memsave")) {
                                Match m = Regex.Match(line, "\"filename\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
                                File.WriteAllBytes(Regex.Unescape(m.Groups[1].Value), Header(dash));
                            }
                            w.WriteLine("{\"return\": {}}");
                        }
                    }
                } catch (Exception) { }
            }
        });
        th.IsBackground = true;
        th.Start();
    }
    [STAThread]
    public static void Main(string[] args) {
        string mode = args.Length > 0 ? args[0] : "play";
        string log = args.Length > 1 ? args[1] : "fake.log";
        if (mode == "exit") {
            try { File.AppendAllText(log, "FAKE ERROR: bad file" + Environment.NewLine); } catch (Exception) { }
            Environment.Exit(2);
        }
        if ((mode == "xbox" || mode == "dash") && args.Length > 2) { Monitor(int.Parse(args[2]), mode == "dash"); }
        Application.Run(new FakeEmu(mode, log));
    }
}
