/*  The runs check: api\runcheck.php, bin\runcheck.ps1 and Emulators > Runs check.

    No real game is ever started here. The API is driven with dry runs and
    with results written by hand; the runner itself runs only the stand-in
    RetroArch (tests\fake-retroarch.js), in a data folder of its own. */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { api, BASE, DATA, ROOT, sleep, romDrive } = require("./lib");

const post = (body) => api("api/runcheck.php", body);

function runRunner(data, wait = "1") {
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "bin", "runcheck.ps1"),
      "-Plan", path.join(data, "runcheck", "plan.json"), "-DataDir", data, "-Wait", wait, "-StartWithin", "4", "-Log"],
      { timeout: 120000, windowsHide: true }, (err, out, e2) => resolve({ err, out: String(out || ""), e2: String(e2 || "") }));
  });
}

function fakePlan(data, modes) {
  const rc = path.join(data, "runcheck");
  for (const d of ["raw", "ralog"]) { fs.mkdirSync(path.join(rc, d), { recursive: true }); }
  const fake = path.join(ROOT, "tests", "fake-retroarch.js");
  const base = 41000 + (process.pid % 3000) * 3;
  const games = modes.map((m, i) => ({ id: "t-" + m + "-" + i, title: "Fake " + m, platform: "Test", port: base + i, exe: process.execPath,
    args: `"${fake}" ${base + i} ${m} "${path.join(rc, "raw")}" "${path.join(rc, "ralog")}"` }));
  fs.writeFileSync(path.join(rc, "plan.json"), JSON.stringify({ label: "test", games }));
  return games;
}
/* The runner's guards, against the stand-in RetroArch. Nothing here needs
   the ROM drive. */
async function runnerGuards(check) {
  // Play added to the history during a check is kept, not put back over.
  const d1 = fs.mkdtempSync(path.join(os.tmpdir(), "xs-runcheck-s3-"));
  try {
    fakePlan(d1, ["exit"]);
    fs.writeFileSync(path.join(d1, "runcheck", "sessions.before.jsonl"), '{"a":1}\n');
    fs.writeFileSync(path.join(d1, "sessions.jsonl"), '{"a":1}\n{"a web game played meanwhile":1}\n');
    await runRunner(d1);
    check("play ADDED to the history during a check is kept", fs.readFileSync(path.join(d1, "sessions.jsonl"), "utf8"), '{"a":1}\n{"a web game played meanwhile":1}\n');
    const st1 = readJson(path.join(d1, "runcheck", "status.json")) || {};
    const log1 = fs.readdirSync(path.join(d1, "log")).map((f) => fs.readFileSync(path.join(d1, "log", f), "utf8")).join("");
    check("the status does not claim it was put back, and the log says it was kept", [st1.restored, /play from outside it, kept/.test(log1)], [false, true]);
  } finally {
    fs.rmSync(d1, { recursive: true, force: true });
  }
  /* A launch-results.json that will not read is never started again: that
     would lose every other game's NEEDS FIX mark. The launcher's function is
     lifted out of bin/launch.ps1 as written and run by itself. */
  const d3 = fs.mkdtempSync(path.join(os.tmpdir(), "xs-launchres-"));
  try {
    const src = fs.readFileSync(path.join(ROOT, "bin", "launch.ps1"), "utf8");
    const fn = src.slice(src.indexOf("function Set-LaunchResult"), src.indexOf("function Write-Failure"));
    const lr = path.join(d3, "launch-results.json");
    fs.writeFileSync(path.join(d3, "t.ps1"), [
      "param($Mode)", "$DataDir = $PSScriptRoot; $GameId = 'new-game'; $Title = 'New Game'",
      "function Write-Log($code, $msg) { Add-Content -LiteralPath (Join-Path $DataDir 'log.txt') -Value $msg }",
      fn, "Set-LaunchResult $false 'it broke'"].join("\n"));
    const run = () => new Promise((resolve) => execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(d3, "t.ps1")],
      { timeout: 60000, windowsHide: true }, () => resolve()));
    check("(the launcher's function was found)", fn.length > 200, true);
    fs.writeFileSync(lr, '{"old-game":{"ok":false,"why":"needs a BIOS"}}');
    await run();
    check("launcher: a new result is added beside the ones already there", Object.keys(readJson(lr) || {}).sort(), ["new-game", "old-game"]);
    const broken = '{"old-game":{"ok":false,"why":"needs a BIOS"}';                // cut short
    fs.writeFileSync(lr, broken);
    await run();
    check("a results file that will not read is left exactly as it is, not started again", fs.readFileSync(lr, "utf8"), broken);
    check("and the log says this launch was not recorded", /left as it is.*not recorded this time/.test(fs.existsSync(path.join(d3, "log.txt")) ? fs.readFileSync(path.join(d3, "log.txt"), "utf8") : ""), true);
    fs.writeFileSync(lr, "");
    await run();
    check("an empty one has nothing to lose and is started again", Object.keys(readJson(lr) || {}), ["new-game"]);
  } finally {
    fs.rmSync(d3, { recursive: true, force: true });
  }
  // The games folder pulled part way stops the check, with nothing recorded.
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "xs-runcheck-s5-"));
  try {
    const games = fakePlan(d2, ["exit", "exit", "exit"]);
    const here = path.join(d2, "rom-here.zip");
    fs.writeFileSync(here, "x");
    games[0].rom = here; games[0].home = d2;                                   // there: runs as always
    games[1].rom = "Z:/XS-AWAY/games/b.zip"; games[1].home = "Z:/XS-AWAY";     // its folder is gone: stop here
    games[2].rom = here; games[2].home = d2;                                   // never reached
    fs.writeFileSync(path.join(d2, "runcheck", "plan.json"), JSON.stringify({ label: "test", games }));
    await runRunner(d2);
    const res = readJson(path.join(d2, "runcheck", "results.json")) || {};
    const st2 = readJson(path.join(d2, "runcheck", "status.json")) || {};
    check("with a game's folder gone part way, the check stops there", [Object.keys(res), st2.stopped, st2.running], [[games[0].id], true, false]);
    check("and says which folder, and that nothing was recorded for the rest", /XS-AWAY is not there any more.*stopped at game 2 of 3.*Nothing was recorded/.test(st2.why || ""), true);
    const log2 = fs.readdirSync(path.join(d2, "log")).map((f) => fs.readFileSync(path.join(d2, "log", f), "utf8")).join("");
    check("the log says so too", /RCHK .*XS-AWAY is not there any more/.test(log2), true);
  } finally {
    fs.rmSync(d2, { recursive: true, force: true });
  }
  /* RetroArch's first start on a PC can outlast the wait and mark a working
     game NEEDS FIX: until it has answered once in a check, a no answer gets one more go. */
  const d4 = fs.mkdtempSync(path.join(os.tmpdir(), "xs-runcheck-cold-"));
  try {
    const games = fakePlan(d4, ["cold", "silent"]);
    await runRunner(d4);
    const res = readJson(path.join(d4, "runcheck", "results.json")) || {};
    const st4 = readJson(path.join(d4, "runcheck", "status.json")) || {};
    const log4 = fs.readdirSync(path.join(d4, "log")).map((f) => fs.readFileSync(path.join(d4, "log", f), "utf8")).join("");
    check("a first game RetroArch did not answer for is tried once more, and boots", [(res[games[0].id] || {}).result, st4.counts],
      ["boots", { boots: 1, crashed: 0, nostart: 0, noanswer: 1, look: 0 }]);
    check("one that is deaf after RetroArch has answered is no answer at once, and the log says the one second go",
      [(res[games[1].id] || {}).result, (log4.match(/tried once more/g) || []).length], ["noanswer", 1]);
    fs.rmSync(path.join(d4, "runcheck"), { recursive: true, force: true });
    fs.rmSync(path.join(d4, "log"), { recursive: true, force: true });
    const deaf = fakePlan(d4, ["silent", "silent"]);
    await runRunner(d4);
    const res2 = readJson(path.join(d4, "runcheck", "results.json")) || {};
    const log5 = fs.readdirSync(path.join(d4, "log")).map((f) => fs.readFileSync(path.join(d4, "log", f), "utf8")).join("");
    check("a RetroArch that never answers gets that second go once, not for every game",
      [deaf.map((g) => (res2[g.id] || {}).result), (log5.match(/tried once more/g) || []).length], [["noanswer", "noanswer"], 1]);
  } finally {
    fs.rmSync(d4, { recursive: true, force: true });
  }
}

/* The other emulators' commands, from made-up emulator folders: which are
   left out and why, and that each one kept stays in a window, on copies of
   its settings, never a change to them. Asked of includes\runcheck.php by
   the test server's PHP; nothing is started. */
async function emuProfiles(check) {
  const phpExe = ((await api("api/status.php")).build || {}).phpExe;
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "xs-rc-emu-"));
  try {
    const mk = (rel, text) => { const f = path.join(d, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
    const rom = "\"E:\\games\\a game.iso\"";
    const cases = {
      unknown:   { exe: mk("other/snes9x.exe", ""), args: rom },
      pcsx2On:   { exe: mk("pcsx2-on/pcsx2-qt.exe", ""), args: "-fullscreen -nogui " + rom },
      pcsx2Off:  { exe: mk("pcsx2-off/pcsx2-qt.exe", ""), args: "-fullscreen -nogui " + rom },
      rpcs3On:   { exe: mk("rpcs3-on/rpcs3.exe", ""), args: "--no-gui " + rom },
      rpcs3Off:  { exe: mk("rpcs3-off/rpcs3.exe", ""), args: "--no-gui " + rom },
      cemuOn:    { exe: mk("cemu-on/Cemu.exe", ""), args: "-g " + rom },
      cemuOff:   { exe: mk("cemu-off/Cemu.exe", ""), args: "-f -g " + rom },
      dolphin:   { exe: mk("dolphin/Dolphin.exe", ""), args: "-b -C Dolphin.Interface.ConfirmStop=False -C Dolphin.Display.Fullscreen=True -e " + rom },
      xenia:     { exe: mk("xenia/xenia.exe", ""), args: rom },
      xemu:      { exe: mk("xemu/xemu.exe", ""), args: "-full-screen -dvd_path " + rom },
    };
    mk("pcsx2-on/portable.ini", ""); mk("pcsx2-on/inis/PCSX2.ini", "[UI]\r\nSettingsVersion = 1\r\nConfirmShutdown = true\r\n");
    mk("pcsx2-off/portable.ini", ""); mk("pcsx2-off/inis/PCSX2.ini", "[UI]\r\nConfirmShutdown = false\r\nStartFullscreen = true\r\n");
    mk("rpcs3-on/GuiConfigs/CurrentSettings.ini", "[main_window]\nloggerVisible=false\n");
    mk("rpcs3-off/GuiConfigs/CurrentSettings.ini", "[Meta]\nconfirmationBoxExitGame=true\n[main_window]\nconfirmationBoxExitGame=false\n");
    const rpcsCfg = mk("rpcs3-off/config/config.yml", "Audio:\n  Master Volume: 100\nMiscellaneous:\n  Start games in fullscreen mode: true\n  Show trophy popups: true\n");
    mk("rpcs3-on/config/config.yml", "Miscellaneous:\n  Start games in fullscreen mode: true\n");
    mk("cemu-on/settings.xml", "<content><fullscreen>true</fullscreen></content>");
    mk("cemu-off/settings.xml", "<content><fullscreen>false</fullscreen></content>");
    mk("dolphin/portable.txt", ""); fs.mkdirSync(path.join(d, "dolphin", "User"), { recursive: true });
    const xemuToml = mk("xemu/xemu.toml", "[display.window]\nfullscreen_on_startup = true\nstartup_size = '1920x1080'\n");
    const data = path.join(d, "data");
    fs.mkdirSync(data);
    const casesFile = mk("cases.json", JSON.stringify(cases));
    const script = mk("ask.php", "<?php\nrequire 'includes/runcheck.php';\n$out = [];\n"
      + "foreach (json_decode(file_get_contents($argv[1]), true) as $k => $c) {\n"
      + "  $name = xs_runcheck_emu_name($c['exe']);\n"
      + "  $why = $name === null ? null : xs_runcheck_emu_why_not($c['exe']);\n"
      + "  $out[$k] = ['name' => $name, 'why' => $why, 'p' => $name !== null && $why === null ? xs_runcheck_emu($c + ['kind' => 'emulator']) : null];\n"
      + "}\necho json_encode($out);\n");
    let got = {};
    try {
      got = JSON.parse(execFileSyncQuiet(phpExe, [script, casesFile],
        { cwd: ROOT, env: Object.assign({}, process.env, { XSEGON_DATA: data, APPDATA: d, USERPROFILE: d }), windowsHide: true }));
    } catch (e) { got = { error: String(e.message).slice(0, 300) }; }
    check("(the made-up emulators were asked about)", !!got.pcsx2Off, true);
    const p = (k) => (got[k] || {}).p || {};
    const toks = (k) => (p(k).args || "").match(/"[^"]*"|\S+/g) || [];
    const emuDir = path.join(data, "runcheck", "emu");
    check("an emulator the check does not know is not one of them", [got.unknown && got.unknown.name, got.pcsx2Off && got.pcsx2Off.name], [null, "PCSX2"]);
    check("PCSX2 asking \"are you sure\" leaves it out, and says what to turn off",
      [/Confirm Shutdown.*Settings > Interface/.test((got.pcsx2On || {}).why || ""), (got.pcsx2Off || {}).why], [true, null]);
    check("PCSX2 kept: -nofullscreen, its log written into the check's folder, -nogui kept, the game last",
      [toks("pcsx2Off").includes("-fullscreen"), toks("pcsx2Off").slice(0, 3), toks("pcsx2Off").filter((t) => t === "-nogui").length, toks("pcsx2Off").slice(-1)[0]],
      [false, ["-nofullscreen", "-logfile", '"' + path.join(emuDir, "pcsx2.log") + '"'], 1, rom]);
    check("RPCS3 asking before it exits leaves it out (a question never set asks), and says where to turn it off",
      [/exit the game.*Configuration > GUI/.test((got.rpcs3On || {}).why || ""), (got.rpcs3Off || {}).why], [true, null]);
    const rCopy = path.join(emuDir, "rpcs3-config.yml");
    check("RPCS3 kept: a copy of its settings with full screen off and muted, as the spare user",
      [toks("rpcs3Off").slice(0, 4), fs.existsSync(rCopy) && /Start games in fullscreen mode: false/.test(fs.readFileSync(rCopy, "utf8")),
       fs.existsSync(rCopy) && /Master Volume: 0/.test(fs.readFileSync(rCopy, "utf8")), p("rpcs3Off").title],
      [["--config", '"' + rCopy + '"', "--user-id", "00000099"], true, true, "FPS:\\s*[1-9]"]);
    check("and its own settings are left exactly as they were", fs.readFileSync(rpcsCfg, "utf8"), "Audio:\n  Master Volume: 100\nMiscellaneous:\n  Start games in fullscreen mode: true\n  Show trophy popups: true\n");
    check("Cemu set to full screen is left out; kept, it loses -f and is read from its own log",
      [/full screen.*Cemu's general settings/.test((got.cemuOn || {}).why || ""), toks("cemuOff"), p("cemuOff").log, p("cemuOff").logMode],
      [true, ["-g", rom], path.join(d, "cemu-off", "log.txt"), "rewrite"]);
    check("Dolphin: its own full screen line swapped for the check's, batch once, Wii saves in the check's folder, judged by its window title",
      [p("dolphin").args.includes('"Dolphin.Display.Fullscreen=False"'), /Fullscreen=True/i.test(p("dolphin").args), toks("dolphin").filter((t) => t === "-b").length,
       p("dolphin").args.includes('"Dolphin.General.NANDRootPath=' + path.join(emuDir, "dolphin-nand") + '"'), p("dolphin").title, p("dolphin").log, toks("dolphin").slice(-2)],
      [true, false, 1, true, "\\|[^|]*\\|[^|]*\\|", "", ["-e", rom]]);
    check("Xenia: --fullscreen=false, its log and saves in the check's folder",
      [toks("xenia").slice(0, 3), toks("xenia").slice(-1)[0]],
      [["--fullscreen=false", '--log_file="' + path.join(emuDir, "xenia.log") + '"', '--content_root="' + path.join(emuDir, "xenia-content") + '"'], rom]);
    const xCopy = path.join(emuDir, "xemu.toml");
    check("xemu: a copy of its settings with full screen off, -full-screen gone, its monitor opened for the runner, look at it the way out",
      [toks("xemu"), fs.existsSync(xCopy) && fs.readFileSync(xCopy, "utf8"), fs.readFileSync(xemuToml, "utf8").includes("fullscreen_on_startup = true"), p("xemu").look, p("xemu").qmp],
      [["-config_path", '"' + xCopy + '"', "-qmp", "tcp:127.0.0.1:{QMP},server=on,wait=off", "-dvd_path", rom], "[display.window]\nfullscreen_on_startup = false\nstartup_size = '1920x1080'\n", true, true, true]);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

function execFileSyncQuiet(exe, args, opts) {
  return require("child_process").execFileSync(exe, args, Object.assign({ stdio: ["ignore", "pipe", "pipe"] }, opts)).toString();
}

/* The runner against a stand-in emulator (tests\fake-emulator.cs, built
   here): a small window off the screen that never takes the focus. Each way
   a game can go is judged from its log and title as the plan says. */
async function emuRunner(check) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "xs-rc-fake-"));
  const kill = () => new Promise((resolve) => execFile("taskkill.exe", ["/F", "/IM", "xsfake-emu.exe"], { windowsHide: true }, () => resolve()));
  const alive = () => new Promise((resolve) => execFile("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process -Name xsfake-emu -ErrorAction SilentlyContinue).Count"],
    { windowsHide: true }, (e, out) => resolve(String(out).trim())));
  try {
    const exe = path.join(d, "xsfake-emu.exe");
    const src = path.join(ROOT, "tests", "fake-emulator.cs");
    await new Promise((resolve) => execFile("powershell.exe", ["-NoProfile", "-Command",
      `Add-Type -OutputAssembly '${exe}' -OutputType WindowsApplication -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition ([IO.File]::ReadAllText('${src}'))`],
      { windowsHide: true, timeout: 90000 }, () => resolve()));
    check("(the stand-in emulator was built)", fs.existsSync(exe), true);
    if (!fs.existsSync(exe)) { return; }
    const data = path.join(d, "data");
    const emu = path.join(data, "runcheck", "emu");
    fs.mkdirSync(emu, { recursive: true });
    const log = path.join(emu, "fake.log");
    const entry = (i, prog, extra) => Object.assign({ id: "e-" + i + "-" + prog, title: "Fake " + prog, platform: "Test", mode: "emu", emu: "FakeEmu",
      exe, args: prog + ' "' + log + '"', proc: "xsfake-emu", out: path.join(emu, "out.txt"), log, logMode: "fresh",
      boot: "FAKE BOOTED", fail: "FAKE ERROR", title: "", look: false, start: 6, extra: 0, saves: false }, extra);
    const plan = (games) => fs.writeFileSync(path.join(data, "runcheck", "plan.json"), JSON.stringify({ label: "test", games }));
    const xemuLike = (i, prog) => entry(i, prog, { look: true, qmp: true, start: 15, args: prog + ' "' + log + '" {QMP}' });
    const games = [entry(0, "play"), entry(1, "title", { boot: "", title: "Fake \\| running" }), entry(2, "quiet", { start: 4 }),
                   entry(3, "quiet", { look: true, id: "e-3-look" }), entry(4, "fail"), entry(5, "exit"), entry(6, "crash"),
                   xemuLike(7, "xbox"), xemuLike(8, "dash"), entry(9, "slow"), entry(10, "play", { id: "e-10-after" })];
    plan(games);
    await runRunner(data);
    const res = readJson(path.join(data, "runcheck", "results.json")) || {};
    const r = (i) => res[games[i].id] || {};
    check("other emulator: its log saying the game started is a boot, with a picture of its window",
      [r(0).result, r(0).shot, r(0).blank, r(0).emu], ["boots", true, false, "FakeEmu"]);
    check("so is its window title saying so", r(1).result, "boots");
    check("open and quiet, with nothing saying the game started, is look at it, with a picture",
      [r(2).result, /stayed open 4s without showing that the game started/.test(r(2).reason || ""), r(2).shot], ["look", true, true]);
    check("an emulator that cannot say at all (xemu) is look at it once its window is up",
      [r(3).result, /cannot say whether a game started/.test(r(3).reason || "")], ["look", true]);
    check("one that says why and never starts did not start, in its own words",
      [r(4).result, /said the game could not start: FAKE ERROR: no BIOS/.test(r(4).reason || "")], ["nostart", true]);
    check("one that closes at once did not start, with its exit code and its words",
      [r(5).result, /closed before the game started \(exit code 2\): FAKE ERROR: bad file/.test(r(5).reason || "")], ["nostart", true]);
    check("one that started and closed by itself crashed", [r(6).result, /closed by itself.*\(exit code 3\)/.test(r(6).reason || "")], ["crashed", true]);
    check("xemu's monitor naming the game's own program is a boot, saying which",
      [r(7).result, r(7).reason, r(7).shot], ["boots", "xemu ran \"Fake Game\" (title 4D530001)", true]);
    check("and a dashboard or menu instead (no publisher's letters in its title ID) did not start, and says which",
      [r(8).result, /went to "XMenu" \(title 00000005\), a dashboard or menu, instead of the game/.test(r(8).reason || "")], ["nostart", true]);
    // Like RPCS3: its window gone at once, the program seconds after (here eighteen, past an ask's fifteen).
    check("one whose window goes at once but whose program takes its time is waited for: a boot, and the check goes on",
      [r(9).result, r(10).result], ["boots", "boots"]);
    const st = readJson(path.join(data, "runcheck", "status.json")) || {};
    check("the counts add up, look at it among them, and nothing stopped it", [st.running, st.stopped, st.counts],
      [false, false, { boots: 5, crashed: 1, nostart: 3, noanswer: 0, look: 2 }]);
    check("and every stand-in was closed", await alive(), "0");

    // One that will not close: left open, never forced, and the check stops there.
    fs.rmSync(path.join(data, "runcheck", "results.json"), { force: true });
    plan([entry(7, "stubborn"), entry(8, "play")]);
    await runRunner(data);
    const res2 = readJson(path.join(data, "runcheck", "results.json")) || {};
    const st2 = readJson(path.join(data, "runcheck", "status.json")) || {};
    check("a game that will not close is still a boot, and the check stops after it",
      [Object.keys(res2), (res2["e-7-stubborn"] || {}).result, st2.stopped], [["e-7-stubborn"], "boots", true]);
    check("saying it was left open rather than forced shut", /did not close when asked, so the check stopped at game 1 of 2 rather than force it shut/.test(st2.why || ""), true);
    check("and it really was left running", await alive(), "1");
    // With it still open, the next check never starts a second one.
    fs.rmSync(path.join(data, "runcheck", "results.json"), { force: true });
    plan([entry(9, "play")]);
    await runRunner(data);
    const r3 = (readJson(path.join(data, "runcheck", "results.json")) || {})["e-9-play"] || {};
    check("an emulator already open is not started again: no answer, and why", [r3.result, /was already open, so this game was not started/.test(r3.reason || "")], ["noanswer", true]);
  } finally {
    await kill();
    // The batch file's cmd lets go of the folder a moment after the stand-in is gone.
    for (let i = 0; ; i++) {
      try { fs.rmSync(d, { recursive: true, force: true }); break; } catch (e) { if (i >= 30) { throw e; } await sleep(500); }
    }
  }
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")); } catch (e) { return null; } };

module.exports = async function (b, check) {
  /* A copy of real data can carry a real run's results and pictures (and
  --live IS the real data): set them aside, and put them back at the end. */
  const rcDir = path.join(DATA, "runcheck");
  const aside = fs.mkdtempSync(path.join(os.tmpdir(), "xs-runcheck-aside-"));
  // (A copy made while a real check runs leaves its "running" status out: tests\sandbox.js.)
  const moved = ["results.json", "shots"];
  for (const f of moved) {
    if (fs.existsSync(path.join(rcDir, f))) { fs.renameSync(path.join(rcDir, f), path.join(aside, f)); }
  }
  try {
    await body(b, check);
    await runnerGuards(check);
    await emuProfiles(check);
    await emuRunner(check);
  } finally {
    for (const f of moved) {
      fs.rmSync(path.join(rcDir, f), { recursive: true, force: true });
      if (fs.existsSync(path.join(aside, f))) { fs.renameSync(path.join(aside, f), path.join(rcDir, f)); }
    }
    fs.rmSync(aside, { recursive: true, force: true });
  }
};

async function body(b, check) {
  /* ---- the API: what it would check, and with what ---------------------- */
  /* With the ROM folder away a check is refused outright, dry or not: every
     game would be written down as "did not start". Then only that refusal is checked. */
  const drive = await romDrive();
  if (!drive.up) {
    console.log("    (the ROM drive " + (drive.root || "(none set)") + " is not there; the runs check's own checks step aside for the refusal)");
    const off = await post({ action: "start", platform: "", skipDone: false, wait: 10, dry: true });
    check("with the ROM drive out, a runs check is refused and says the drive is the reason", [off.ok, off.driveOff, /not there/.test(off.error || "")], [false, true, true]);
    return;
  }
  const first = await api("api/runcheck.php");
  check("runs check: it says where it is and what it can check", [first.ok, Array.isArray(first.results), first.consoles.length > 0, Array.isArray(first.left)], [true, true, true, true]);
  // A RetroArch console for the RetroArch checks; the other emulators have their own below.
  const raCons = first.consoles.filter((c) => c.via.length === 1 && c.via[0] === "RetroArch");
  const con = raCons.slice().sort((a, b) => a.games - b.games).find((c) => c.games >= 3) || raCons[0];
  // What is there already (a copy of real data can hold a real run's files):
  // a dry run must leave it exactly so.
  const stamp = () => ["plan.json", "sessions.before.jsonl", "status.json"].map((f) => { const p = path.join(DATA, "runcheck", f); return fs.existsSync(p) ? fs.statSync(p).mtimeMs : 0; });
  const before = stamp();
  const dry = await post({ action: "start", platform: con.platform, skipDone: false, wait: 10, dry: true });
  check("a dry start lists that console's RetroArch games and starts nothing", [dry.ok, dry.games, dry.plan.every((g) => g.platform === con.platform)], [true, con.games, true]);
  check("and writes no list, copies nothing and changes no status", stamp(), before);
  check("each game carries its file and the folder it lives under, for the runner to look for", dry.plan.every((g) => !!g.rom && !!g.home), true);
  const cfgPath = ((dry.plan[0] || {}).args || "").match(/^--appendconfig="([^"]+)" /);
  check("every game runs with the check's own RetroArch settings", !!cfgPath && dry.plan.every((g) => g.args.startsWith('--appendconfig="' + cfgPath[1] + '" ')), true);
  const cfg = cfgPath ? fs.readFileSync(cfgPath[1], "utf8") : "";
  const has = (k, v) => new RegExp("^" + k + ' = "' + v + '"$', "m").test(cfg);
  check("which never write back into retroarch.cfg", has("config_save_on_exit", "false"), true);
  check("never auto save or auto load a state", [has("savestate_auto_save", "false"), has("savestate_auto_load", "false")], [true, true]);
  const inCheck = (k) => (cfg.match(new RegExp("^" + k + ' = "([^"]+)"$', "m")) || [])[1] || "";
  check("send saves, states and screenshots to the check's own folder, never beside the ROMs",
    [["savefile_directory", "savestate_directory", "screenshot_directory"].every((k) => inCheck(k).toLowerCase().startsWith(path.join(DATA, "runcheck").toLowerCase())),
     has("savefiles_in_content_dir", "false"), has("savestates_in_content_dir", "false"), has("screenshots_in_content_dir", "false")], [true, true, true, true]);
  check("keep RetroArch's own play time and history out of it, and mute it",
    [has("content_runtime_log", "false"), has("content_runtime_log_aggregate", "false"), has("history_list_enable", "false"), has("audio_mute_enable", "true")], [true, true, true, true]);
  check("and can be asked and quit", [has("network_cmd_enable", "true"), has("pause_nonactive", "false"), has("quit_press_twice", "false")], [true, true, true]);
  check("in a small window, not full screen, and only for the check (never saved)",
    [has("video_fullscreen", "false"), has("video_scale", "1"), has("config_save_on_exit", "false")], [true, true, true]);
  // A -f on the command line beats any config, so the check's commands lose it.
  check("and no check command carries RetroArch's force-fullscreen flag",
    dry.plan.some((g) => /(^|\s)(-f|--fullscreen)(\s|$)/.test(g.args.replace(/"[^"]*"/g, '""'))), false);
  // Direct3D 11's GPU read back crashes RetroArch at every screenshot; the
  // core's own picture does not.
  check("and take the core's own picture, not the graphics card's", has("video_gpu_screenshot", "false"), true);
  // LaunchBox's wrapper opens a core selector on any error and waits for an
  // answer: never in a run nobody is watching.
  check("RetroArch itself is started, never a wrapper script beside it",
    dry.plan.every((g) => !/\.(bat|cmd)$/i.test(g.exe) || !fs.existsSync(path.join(path.dirname(g.exe), "retroarch.exe"))), true);
  check("a wait outside 3 to 60 seconds is refused", (await post({ action: "start", wait: 99, dry: true })).ok, false);
  const lib = await api("api/library.php");
  const steamOrOwn = lib.games.filter((g) => g.steam || g.local).map((g) => g.id);
  const every = await post({ action: "start", platform: "", skipDone: false, dry: true });
  check("no Steam game or program of yours is on the list", every.plan.some((g) => steamOrOwn.includes(g.id)), false);

  /* ---- the other emulators: windowed, saves elsewhere -------------------- */
  const emus = every.plan.filter((g) => g.mode === "emu");
  const byEmu = (n) => emus.filter((g) => g.emu === n);
  const inEmu = (p) => String(p || "").toLowerCase().startsWith(path.join(DATA, "runcheck", "emu").toLowerCase());
  if (!emus.length) {
    console.log("    (no game here runs on an emulator other than RetroArch; their command checks step aside)");
  } else {
    check("games on the other emulators are on the list, each with what proves it started",
      emus.every((g) => !!g.proc && !!g.out && !!(g.boot || g.title || g.look)), true);
    const toks = (g) => g.args.match(/"[^"]*"|\S+/g) || [];
    check("none of them is started full screen",
      emus.some((g) => toks(g).some((t) => /^(-fullscreen|-full-screen|--fullscreen|-f)$/i.test(t) || /fullscreen=true/i.test(t))), false);
    if (byEmu("PCSX2").length) {
      check("PCSX2 is told -nofullscreen, and writes its log into the check's folder",
        byEmu("PCSX2").every((g) => toks(g).includes("-nofullscreen") && inEmu(g.log) && g.args.includes('-logfile "' + g.log + '"')), true);
    }
    if (byEmu("Dolphin").length) {
      check("Dolphin stays in a window, asks nothing on stop, and keeps Wii and GameCube saves in the check's folder",
        byEmu("Dolphin").every((g) => g.args.includes('"Dolphin.Display.Fullscreen=False"') && g.args.includes('"Dolphin.Interface.ConfirmStop=False"')
          && inEmu((g.args.match(/"Dolphin\.General\.NANDRootPath=([^"]+)"/) || [])[1]) && inEmu((g.args.match(/"Dolphin\.Core\.GCIFolderAPath=([^"]+)"/) || [])[1])), true);
    }
    if (byEmu("Xenia").length) {
      check("Xenia stays in a window, with its log and saves in the check's folder",
        byEmu("Xenia").every((g) => toks(g).includes("--fullscreen=false") && inEmu(g.log) && inEmu((g.args.match(/--content_root="([^"]+)"/) || [])[1])), true);
    }
    if (byEmu("RPCS3").length) {
      const r = byEmu("RPCS3")[0];
      const cfg = (r.args.match(/--config "([^"]+)"/) || [])[1];
      check("RPCS3 runs on a copy of its settings with full screen off, as a spare user",
        [inEmu(cfg), !!cfg && /^\s*Start games in fullscreen mode: false\s*$/m.test(fs.readFileSync(cfg, "utf8")), /--user-id 00000099 /.test(r.args)], [true, true, true]);
    }
    if (byEmu("xemu").length) {
      const x = byEmu("xemu")[0];
      const cfg = (x.args.match(/-config_path "([^"]+)"/) || [])[1];
      check("xemu runs on a copy of its settings with full screen off, asked through its monitor, look at it when that says nothing",
        [inEmu(cfg), !!cfg && /^fullscreen_on_startup = false/m.test(fs.readFileSync(cfg, "utf8")), x.qmp, /-qmp tcp:127\.0\.0\.1:\{QMP\},server=on,wait=off /.test(x.args), x.look],
        [true, true, true, true, true]);
    }
    if (byEmu("Cemu").length) {
      check("Cemu is read from its own log", byEmu("Cemu").every((g) => /log\.txt$/i.test(g.log) && g.logMode === "rewrite"), true);
    }
  }
  // Set it all up asks for a check by itself (js\runsbar.js): RetroArch's games only.
  const auto = await post({ action: "start", platform: "", skipDone: false, auto: true, dry: true });
  check("the one yes checks RetroArch's games alone, never opening another emulator", [auto.ok, auto.plan.some((g) => g.mode === "emu")], [true, false]);

  /* ---- results kept between runs, and what the page is sent -------------- */
  const rc = path.join(DATA, "runcheck");
  fs.mkdirSync(path.join(rc, "shots"), { recursive: true });
  const [g1, g2, g3] = dry.plan.length >= 2 ? [dry.plan[0], dry.plan[1], every.plan.find((g) => g.platform !== con.platform) || dry.plan[0]] : [];
  const png = fs.readFileSync(path.join(ROOT, "img", "xsegon-32.png"));
  const safe = (id) => id.replace(/[^A-Za-z0-9_-]/g, "_");
  fs.writeFileSync(path.join(rc, "shots", safe(g1.id) + ".png"), png);
  fs.writeFileSync(path.join(rc, "shots", safe(g2.id) + ".png"), png);
  fs.writeFileSync(path.join(rc, "results.json"), JSON.stringify({
    [g1.id]: { id: g1.id, title: g1.title, platform: g1.platform, result: "boots", reason: "", shot: true, blank: false, at: new Date().toISOString() },
    [g2.id]: { id: g2.id, title: g2.title, platform: g2.platform, result: "boots", reason: "", shot: true, blank: true, at: new Date().toISOString() },
    [g3.id]: { id: g3.id, title: g3.title, platform: g3.platform, result: "nostart", reason: "it closed before the game started: Firmware missing", shot: false, blank: false, at: new Date().toISOString() },
    "gone-from-the-library": { id: "x", title: "Gone", platform: "Test", result: "boots" },
  }));
  const withRes = await api("api/runcheck.php");
  check("results come back for games still in the library only", withRes.results.length, 3);
  const r1 = withRes.results.find((r) => r.id === g1.id);
  check("with the screenshot's address", !!r1 && /^files\/runcheck\/[^/]+\.png\?v=\d+$/.test(r1.shot), true);
  const shotRes = await fetch(BASE + "/" + r1.shot);
  check("which is served, as a picture", [shotRes.status, shotRes.headers.get("content-type")], [200, "image/png"]);
  check("and nothing else in the check's folder is", [(await fetch(BASE + "/files/runcheck/..%2Fresults.json")).status, (await fetch(BASE + "/files/runcheck/..%2Fstatus.json")).status], [404, 404]);
  // While a check runs the panel asks only for what changed: a result
  // written again (Rerun the failed rewrites, it does not add) comes back alone.
  const quiet = await api("api/runcheck.php?since=" + withRes.cursor);
  check("the answer carries a cursor, and nothing new since it is an empty change list",
    [withRes.cursor > 0, quiet.ok, quiet.delta, quiet.results.length, "consoles" in quiet], [true, true, true, 0, false]);
  const resNow = readJson(path.join(rc, "results.json"));
  resNow[g3.id].at = new Date(Date.now() + 2000).toISOString();
  fs.writeFileSync(path.join(rc, "results.json"), JSON.stringify(resNow));
  const moved = await api("api/runcheck.php?since=" + withRes.cursor);
  check("and a result written again since comes back alone, with the cursor moved on",
    [moved.results.map((r) => r.id), moved.cursor > withRes.cursor], [[g3.id], true]);
  const skip = await post({ action: "start", platform: con.platform, skipDone: true, dry: true });
  check("skipping the checked leaves those off the list", skip.games, dry.games - [g1, g2].filter((g) => g.platform === con.platform).length);
  check("and the counts say how many are checked", (withRes.consoles.find((c) => c.platform === con.platform) || {}).checked, [g1, g2, g3].filter((g) => g.platform === con.platform).length);
  // The failed ones again: only the game whose check went wrong, not the
  // boot or the blank screen, and the library can be narrowed to the same.
  const failedDry = await post({ action: "start", only: "failed", dry: true });
  check("a rerun of the failed lists exactly them", [failedDry.ok, failedDry.games, (failedDry.plan[0] || {}).id], [true, 1, g3.id]);
  // A copy of real data may carry real failed launches and your own needs
  // fix marks: both are set aside, so only the check's word counts here.
  const lrFile = path.join(DATA, "launch-results.json"), fixFile = path.join(DATA, "fix-marks.json");
  const lrBefore = fs.existsSync(lrFile) ? fs.readFileSync(lrFile) : null;
  const fixBefore = fs.existsSync(fixFile) ? fs.readFileSync(fixFile) : null;
  const later = new Date(Date.now() + 60000).toISOString();
  try {
    fs.writeFileSync(lrFile, "{}");
    fs.writeFileSync(fixFile, "{}");
    const failLib = await api("api/library.php?fails=1&versions=all");
    check("and the library filtered to the failed answers just that game",
      [failLib.ok, failLib.count, (failLib.games[0] || {}).id], [true, 1, g3.id]);
    check("and it says why it needs fixing", /runs check could not start it/.test((failLib.games[0] || {}).needsFix || ""), true);
    // NEEDS FIX follows the newer of the check and the last launch
    // (includes\needsfix.php): a good launch since clears it, a failed launch
    // marks a game the check found booting.
    fs.writeFileSync(lrFile, JSON.stringify({ [g3.id]: { ok: true, at: later, why: "" },
                                              [g1.id]: { ok: false, at: later, why: "exited with code 1 after 1s" } }));
    const lr = await api("api/library.php?fails=1&versions=all");
    check("a good launch since clears NEEDS FIX, and a failed one sets it",
      [lr.count, (lr.games[0] || {}).id, /last launch failed: exited with code 1/.test((lr.games[0] || {}).needsFix || "")], [1, g1.id, true]);
  } finally {
    if (lrBefore) { fs.writeFileSync(lrFile, lrBefore); } else { fs.rmSync(lrFile, { force: true }); }
    if (fixBefore) { fs.writeFileSync(fixFile, fixBefore); } else { fs.rmSync(fixFile, { force: true }); }
  }

  /* ---- Tag the ones that boot "runs": a blank screen left out ------------ */
  const tagsFile = path.join(DATA, "tags.json");
  const tagsBefore = fs.existsSync(tagsFile) ? fs.readFileSync(tagsFile) : null;
  try {
    // A copy of real data may carry a real "runs" tag on these games already.
    const start = readJson(tagsFile) || {};
    for (const g of [g1, g2, g3]) { if (start[g.id]) { start[g.id] = start[g.id].filter((t) => t !== "runs"); } }
    fs.writeFileSync(tagsFile, JSON.stringify(start));
    const tagged = await post({ action: "tag" });
    const tags = readJson(tagsFile) || {};
    check("tagging marks the ones that boot, and not the blank screen or the failure",
      [tagged.tagged, (tags[g1.id] || []).includes("runs"), (tags[g2.id] || []).includes("runs"), (tags[g3.id] || []).includes("runs")], [1, true, false, false]);
    check("and a second time adds nothing", (await post({ action: "tag" })).tagged, 0);
  } finally {
    if (tagsBefore === null) { fs.rmSync(tagsFile, { force: true }); } else { fs.writeFileSync(tagsFile, tagsBefore); }
  }

  /* ---- the panel ---------------------------------------------------------- */
  await b.goto();
  await b.enterConsole();
  const opened = await b.ev(`(async () => { const m = await import("/js/runcheck.js"); m.openRunCheck(); return true; })()`);
  await b.waitFor(`!!document.querySelector("#editor .rc-grid")`, 6000);
  const panel = await b.ev(`(() => { const e = document.getElementById("editor");
    return { safe: e.querySelectorAll(".rc-safe li").length, saves: /saves are never touched/.test(e.textContent), play: /never counts as playing/.test(e.textContent),
      tiles: e.querySelectorAll(".rc-tile").length, pics: e.querySelectorAll(".rc-tile img").length,
      chips: [...e.querySelectorAll(".rc-chip")].map(c => c.textContent.replace(/\\s+/g, " ")),
      start: (e.querySelector(".rc-controls .primary") || {}).textContent || "" }; })()`);
  check("the panel says what it will never do before Start is pressed", [opened, panel.safe, panel.saves, panel.play], [true, 5, true, true]);
  check("and shows each result, with its picture", [panel.tiles, panel.pics], [3, 2]);
  check("sorted into boots, blank screen and did not start", panel.chips, ["All 3", "boots 1", "blank screen 1", "did not start 1"]);
  check("Start says how many and how long", /^Start: \d+ games?, about \d/.test(panel.start), true);
  // The console chosen narrows the results too, and the chips count within it.
  await b.ev(`(s => { s.value = ${JSON.stringify(con.platform)}; s.dispatchEvent(new Event("change")); })(document.querySelector("#editor .rc-controls select"))`);
  await b.settled(300);
  const narrowed = await b.ev(`(() => { const e = document.getElementById("editor");
    return { tiles: e.querySelectorAll(".rc-tile").length, label: (e.querySelector(".rc-results .rc-card-aside") || {}).textContent || "",
      all: ([...e.querySelectorAll(".rc-chip")].find((c) => /^All/.test(c.textContent)) || {}).textContent || "" }; })()`);
  const onCon = [g1, g2, g3].filter((g, i, a) => g.platform === con.platform && a.indexOf(g) === i).length;
  check("choosing a console in the list shows only its results, the chips counting them",
    [narrowed.tiles, narrowed.label.replace(/\s+/g, " "), narrowed.all.replace(/\s+/g, " ")], [onCon, con.platform + " · " + onCon + " checked", "All " + onCon]);
  await b.ev(`(s => { s.value = ""; s.dispatchEvent(new Event("change")); })(document.querySelector("#editor .rc-controls select"))`);
  await b.settled(300);
  check("and Every console shows them all again", await b.ev(`document.querySelectorAll("#editor .rc-tile").length`), 3);
  const offered = await b.ev(`(() => { const e = document.getElementById("editor");
    return { rerun: [...e.querySelectorAll(".rc-controls button")].map(x => x.textContent).find(t => /Rerun/.test(t)) || "",
             see: [...e.querySelectorAll(".art-btns button")].map(x => x.textContent).find(t => /failed in the list/.test(t)) || "" }; })()`);
  check("Rerun the failed and See them in the list are both offered, counted",
    [/Rerun the 1 failed/.test(offered.rerun), /See the 1 failed in the list/.test(offered.see)], [true, true]);
  // A result pressed is that game's details, wherever the check was opened.
  await b.ev(`(() => { [...document.querySelectorAll("#editor .rc-tile")].find(t => /did not start/.test(t.textContent)).click(); })()`);
  await b.waitFor(`!document.getElementById("details").hidden`, 6000);
  check("pressing a result opens that game's details",
    await b.ev(`(async () => { const S = await import("/js/state.js"); return [!S.$details.hidden, (S.games[S.sel] || {}).id]; })()`),
    [true, g3.id]);
  await b.key("Escape");
  await b.settled();
  // And the failed as a list of games, filtered to exactly them.
  await b.ev(`(async () => { const m = await import("/js/runcheck.js"); m.openRunCheck(); })()`);
  await b.waitFor(`!!document.querySelector("#editor .art-btns")`, 6000);
  await b.ev(`(() => { [...document.querySelectorAll("#editor .art-btns button")].find(t => /failed in the list/.test(t.textContent)).click(); })()`);
  await b.waitFor(`document.getElementById("editor").hidden && document.getElementById("view").classList.contains("list")`, 6000);
  check("See the failed opens the list, narrowed to them",
    await b.ev(`(async () => { const S = await import("/js/state.js"); const Li = await import("/js/library.js");
      return [Li.filters.fails, S.games.some((g) => g.id === ${JSON.stringify(g3.id)})]; })()`),
    [true, true]);
  check("and it is greyed under a red NEEDS FIX",
    await b.ev(`(() => { const m = document.querySelector("#view .row.needsfix > .fixmark");
      return [!!m && !m.hidden, m ? m.textContent : "", m ? getComputedStyle(m).color : ""]; })()`),
    [true, "NEEDS FIX", "rgb(248, 113, 113)"]);
  await b.ev(`import("/js/library.js").then((m) => m.clearFilters(true))`);
  await b.key("Escape");

  /* ---- look at it: the check could not tell, so you say ----------------- */
  // One with no launch of its own on record: a failed Play would rightly keep its NEEDS FIX.
  const launchedNow = readJson(path.join(DATA, "launch-results.json")) || {};
  const lookG = emus.find((g) => !launchedNow[g.id]) || g1;
  fs.writeFileSync(path.join(rc, "results.json"), JSON.stringify({ [lookG.id]: { id: lookG.id, title: lookG.title, platform: lookG.platform,
    result: "look", reason: "xemu cannot say whether a game started: look at the picture and choose", shot: false, blank: false, emu: "xemu", at: new Date().toISOString() } }));
  const la = (await api("api/runcheck.php")).results.find((r) => r.id === lookG.id) || {};
  check("a game the check could not judge comes back as look at it, naming its emulator", [la.result, la.emu, la.byYou], ["look", "xemu", false]);
  const noFail = await post({ action: "start", only: "failed", dry: true });
  const lookLib = await api("api/library.php?fails=1&versions=all");
  check("and it is no failure: nothing to rerun, and no NEEDS FIX", [noFail.ok, (lookLib.games || []).some((g) => g.id === lookG.id)], [false, false]);
  check("an answer for a game that was not checked is refused", (await post({ action: "mark", id: "no-such-game", ran: true })).ok, false);
  await b.ev(`(async () => { const m = await import("/js/runcheck.js"); m.openRunCheck(); })()`);
  await b.waitFor(`!!document.querySelector("#editor .rc-said")`, 6000);
  check("its tile asks you: it ran, or it did not",
    await b.ev(`[...document.querySelectorAll("#editor .rc-said button")].map((x) => x.textContent)`), ["It ran", "It did not"]);
  await b.ev(`document.querySelector("#editor .rc-said button").click()`);
  await b.waitFor(`!document.querySelector("#editor .rc-said") && /boots/.test((document.querySelector("#editor .rc-tile .rc-result") || {}).textContent || "")`, 6000);
  const saidRan = (readJson(path.join(rc, "results.json")) || {})[lookG.id] || {};
  check("It ran makes it a boot, kept as your answer, and the tile says so", [saidRan.result, saidRan.by, saidRan.reason], ["boots", "you", "you said it ran"]);
  await b.key("Escape");

  /* ---- a result's right-click: your verdict over the check's -------------- */
  const keepTags = fs.existsSync(tagsFile) ? fs.readFileSync(tagsFile) : null;
  const keepFix = fs.existsSync(fixFile) ? fs.readFileSync(fixFile) : null;
  try {
    const rowOf = (a) => ((a && a.results) || []).find((x) => x.id === lookG.id) || {};
    const nf = await post({ action: "set", id: lookG.id, as: "needsfix" });
    check("Needs fix on a result: did not start, marked by you, the needs fix tag on",
      [nf.ok, rowOf(nf).result, rowOf(nf).reason, rowOf(nf).needsFix, (rowOf(nf).tags || []).includes("needs fix"), rowOf(nf).byYou],
      [true, "nostart", "you marked it needs fix", true, true, true]);
    const libNf = (await api("api/library.php?grouped=0&versions=all")).games.find((x) => x.id === lookG.id) || {};
    check("and the game wears it everywhere: NEEDS FIX, yours, with the tag",
      [libNf.needsFix, libNf.needsFixMine, (libNf.tags || []).includes("needs fix")], ["you marked it needs fix", true, true]);
    const ru = await post({ action: "set", id: lookG.id, as: "runs" });
    check("It runs: a boot, tagged runs, with NEEDS FIX and its tag off",
      [rowOf(ru).result, (rowOf(ru).tags || []).includes("runs"), (rowOf(ru).tags || []).includes("needs fix"), rowOf(ru).needsFix], ["boots", true, false, false]);
    await b.ev(`(async () => { const m = await import("/js/runcheck.js"); m.openRunCheck(); })()`);
    await b.waitFor(`!!document.querySelector("#editor .rc-tile")`, 6000);
    check("the tile shows its tags", /(^|·\s*)runs(\s|$)/.test(await b.ev(`(document.querySelector("#editor .rc-tile .rc-tags") || {}).textContent || ""`)), true);
    // Forget the results asks and acts on a second press; a double click is two presses, and must only ask.
    const FORGET = `[...document.querySelectorAll("#editor button.danger")].find((x) => /forget/i.test(x.textContent))`;
    await b.ev(`(() => { const f = ${FORGET}; f.click(); f.click(); })()`);
    check("a double click on Forget the results asks, and forgets nothing",
      [await b.ev(`${FORGET}.textContent`), ((await api("api/runcheck.php")).results || []).length > 0], ["Press again to forget every result", true]);
    await b.ev(`(t => { const r = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20 })); })(document.querySelector("#editor .rc-tile"))`);
    await b.waitFor(`!!document.querySelector(".ctx")`, 4000);
    const menu = await b.ev(`[...document.querySelectorAll(".ctx .ctx-label")].map((x) => x.textContent)`);
    check("right-clicking a result offers your verdict, its tags, its details and forgetting it",
      [menu[0], menu[1], /^Tags( \(\d+\))?\.\.\.$/.test(menu[2] || ""), menu[3], menu[4]], ["It runs", "Needs fix", true, "Details", "Forget this result"]);
    check("with It runs checked for a game that boots", await b.ev(`[...document.querySelectorAll(".ctx .ctx-item")].map((n) => n.classList.contains("on")).slice(0, 2)`), [true, false]);
    await b.key("Escape");
    /* A blank screen, with the real mouse: a check mark on It runs there
       would read as done already. */
    const rcFile = path.join(rc, "results.json");
    const asBlank = readJson(rcFile) || {};
    asBlank[lookG.id] = Object.assign({}, asBlank[lookG.id], { result: "boots", blank: true, reason: "", by: null, at: new Date(Date.now() + 1000).toISOString() });
    fs.writeFileSync(rcFile, JSON.stringify(asBlank));
    await b.ev(`(async () => { const m = await import("/js/runcheck.js"); m.openRunCheck(); })()`);
    await b.waitFor(`/blank screen/.test((document.querySelector("#editor .rc-tile .rc-result") || {}).textContent || "")`, 6000);
    const at = await b.ev(`(t => { t.scrollIntoView({ block: "center" }); const r = t.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 40) }; })(document.querySelector("#editor .rc-tile"))`);
    for (const type of ["mousePressed", "mouseReleased"]) { await b.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "right", clickCount: 1 }); }
    await b.waitFor(`!!document.querySelector(".ctx")`, 4000);
    check("on a blank screen It runs carries no check mark", await b.ev(`document.querySelector(".ctx .ctx-item").classList.contains("on")`), false);
    const runsAt = await b.ev(`(r => ({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }))(document.querySelector(".ctx .ctx-item").getBoundingClientRect())`);
    await b.click(runsAt.x, runsAt.y);
    let marked = {};
    for (let i = 0; i < 40 && !(marked.result === "boots" && marked.blank === false); i++) { await sleep(250); marked = (readJson(rcFile) || {})[lookG.id] || {}; }
    check("and pressing it marks it running, a blank screen no more", [marked.result, marked.blank, marked.by], ["boots", false, "you"]);
    check("saying so in the strip", await b.until(`/marked as running, and tagged runs/.test(document.getElementById("strip").textContent)`, true, 6000), true);
    await b.key("Escape");
    const fg = await post({ action: "set", id: lookG.id, as: "forget" });
    check("Forget this result takes it off, to be checked again", [fg.ok, (fg.results || []).some((x) => x.id === lookG.id)], [true, false]);
    check("a verdict for a game that was not checked is refused", (await post({ action: "set", id: "no-such-game", as: "runs" })).ok, false);
  } finally {
    if (keepTags === null) { fs.rmSync(tagsFile, { force: true }); } else { fs.writeFileSync(tagsFile, keepTags); }
    if (keepFix === null) { fs.rmSync(fixFile, { force: true }); } else { fs.writeFileSync(fixFile, keepFix); }
  }

  /* ---- while it runs, nothing else starts -------------------------------- */
  const status = path.join(rc, "status.json");
  fs.writeFileSync(status, JSON.stringify({ running: true, pid: process.pid, total: 5, index: 2, current: { id: g1.id, title: g1.title, platform: g1.platform } }));
  try {
    const st = await api("api/runcheck.php");
    check("a live check is seen as running", st.status.running, true);
    const play = await api("api/launch.php", { id: g1.id, dry: true });
    check("Play is refused while it runs, and says why", [play.ok, /runs check is going/.test(play.error || "")], [false, true]);
    check("so is a second start", (await post({ action: "start", dry: true })).ok, false);
    check("and a verdict on a result: the runner is still writing them", (await post({ action: "set", id: g1.id, as: "runs" })).ok, false);
    const stop = await post({ action: "stop" });
    check("stop asks it to stop", [stop.ok, fs.existsSync(path.join(rc, "stop"))], [true, true]);
  } finally {
    fs.rmSync(status, { force: true });
    fs.rmSync(path.join(rc, "stop"), { force: true });
  }
  check("a check whose runner has gone is not running", (await api("api/runcheck.php")).status.running, false);
  /* Windows' answer about the runner can blip mid-game: a status written
     moments ago counts, whatever tasklist says; an old one does not. */
  fs.writeFileSync(status, JSON.stringify({ running: true, pid: 999999, total: 2, index: 1 }));
  try {
    check("a status written moments ago counts as running, even if Windows cannot see the runner", (await api("api/runcheck.php")).status.running, true);
    const old = new Date(Date.now() - 3 * 60000);
    fs.utimesSync(status, old, old);
    check("but not one left three minutes ago by a runner that is gone", (await api("api/runcheck.php")).status.running, false);
  } finally {
    fs.rmSync(status, { force: true });
  }
  check("forgetting clears every result and picture", [(await post({ action: "clear" })).results.length, fs.readdirSync(path.join(rc, "shots")).length], [0, 0]);

  /* ---- the runner, against a stand-in RetroArch --------------------------- */
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "xs-runcheck-"));
  try {
    const games = fakePlan(data, ["play", "blank", "crash", "nostart", "exit", "silent"]);
    // Changed, not only added to: that is still put back (added lines are kept, runnerGuards).
    fs.writeFileSync(path.join(data, "sessions.jsonl"), "{\"changed\":1}\n{\"written during the run\":1}\n");
    fs.writeFileSync(path.join(data, "runcheck", "sessions.before.jsonl"), "{\"a\":1}\n");
    await runRunner(data);
    const res = readJson(path.join(data, "runcheck", "results.json")) || {};
    const got = (m) => { const r = res[games.find((g) => g.id.startsWith("t-" + m + "-")).id] || {}; return r; };
    check("runner: a game that plays boots, with its screenshot", [got("play").result, got("play").shot, got("play").blank], ["boots", true, false]);
    check("a black picture is still a boot, marked blank", [got("blank").result, got("blank").blank], ["boots", true]);
    check("one that closes by itself after starting crashed, with RetroArch's words", [got("crash").result, /closed by itself.*the core stopped/.test(got("crash").reason)], ["crashed", true]);
    check("one that never plays did not start", [got("nostart").result, /never started/.test(got("nostart").reason)], ["nostart", true]);
    check("one that closes at once did not start, and says the missing BIOS", [got("exit").result, /Firmware missing: scph5501\.bin/.test(got("exit").reason)], ["nostart", true]);
    check("one that never answers is no answer, not a failure", [got("silent").result, /did not answer/.test(got("silent").reason)], ["noanswer", true]);
    const shots = fs.readdirSync(path.join(data, "runcheck", "shots")).sort();
    check("only the games that boot have a picture", shots, [games[0].id + ".png", games[1].id + ".png"].sort());
    check("the play history is exactly as it was before the run", fs.readFileSync(path.join(data, "sessions.jsonl"), "utf8"), "{\"a\":1}\n");
    const st = readJson(path.join(data, "runcheck", "status.json")) || {};
    check("and the status says it was put back, and the run ended", [st.restored, st.running, st.counts], [true, false, { boots: 2, crashed: 1, nostart: 2, noanswer: 1, look: 0 }]);
    check("the runner never writes a running game or a launch error", [fs.existsSync(path.join(data, "running.json")), fs.existsSync(path.join(data, "last-error.json"))], [false, false]);
    const logText = fs.readdirSync(path.join(data, "log")).map((f) => fs.readFileSync(path.join(data, "log", f), "utf8")).join("");
    check("the log has a line per game and says the history was put back", [(logText.match(/ RCHK Fake /g) || []).length, /put back as it was before/.test(logText)], [6, true]);
    await sleep(500);
    const left = await new Promise((resolve) => execFile("powershell.exe", ["-NoProfile", "-Command",
      "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*fake-retroarch*' }).Count"], { windowsHide: true }, (e, out) => resolve(String(out).trim())));
    check("and no game is left running", left, "0");

    // Stopped part way: the game it is on finishes, the rest are left.
    fs.rmSync(path.join(data, "runcheck", "results.json"), { force: true });
    fakePlan(data, ["play", "play", "play", "play"]);
    const running = runRunner(data, "2");
    for (let i = 0; i < 60 && !fs.existsSync(path.join(data, "runcheck", "results.json")); i++) { await sleep(200); }
    fs.writeFileSync(path.join(data, "runcheck", "stop"), "now");
    await running;
    const partial = Object.keys(readJson(path.join(data, "runcheck", "results.json")) || {}).length;
    const st2 = readJson(path.join(data, "runcheck", "status.json")) || {};
    check("a stop ends it after the game it is on", [partial >= 1 && partial < 4, st2.stopped, st2.running], [true, true, false]);

    // A PS1 that RetroArch calls playing, on the PlayStation's own menu.
    fs.rmSync(path.join(data, "runcheck", "results.json"), { force: true });
    const menuGames = fakePlan(data, ["menu", "menu"]);
    menuGames[0].menu = "ps1";
    fs.writeFileSync(path.join(data, "runcheck", "plan.json"), JSON.stringify({ label: "test", games: menuGames }));
    await runRunner(data);
    const mres = readJson(path.join(data, "runcheck", "results.json")) || {};
    const m0 = mres[menuGames[0].id] || {}, m1 = mres[menuGames[1].id] || {};
    check("a PS1 picture of the PlayStation's own menu is look at it, saying why, not a boot",
      [m0.result, /PlayStation's own menu \(Memory Card, CD Player\)/.test(m0.reason || ""), m0.shot], ["look", true, true]);
    check("the same blue on another console is still a boot", m1.result, "boots");
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
}
