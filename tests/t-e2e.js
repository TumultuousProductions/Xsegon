/*  The end to end check: one real game, in the real RetroArch. Every other
    group drives stand-ins, and t-settings proves the remap FILE is right; no
    stand-in can prove that the installed RetroArch accepts the command Xsegon
    builds and really reads the buttons staged for the console. So this group,
    and only this group, starts a real program.

    Twice, briefly, each in a small window, never the whole screen:
      1. the dry launch's command run straight, with a quieting config of this
         group's own on the end (muted, saves and history away from the real
         ones) and RetroArch's verbose log caught, to hear it load the remap;
      2. a real press of Play through api\launch.php, to see the launcher seat
         the game, the LNCH log line carry pads=, and the seat come back when
         the game ends. The sound is off, and it is cut short after a moment.

    Nothing of the installed RetroArch is written (checked), and what the
    launcher writes in data\ is put back. With the ROM drive away there is no
    game to start, and every check steps aside.  */
"use strict";
const fs = require("fs");
const path = require("path");
const dgram = require("dgram");
const { spawn, execFile } = require("child_process");
const { api, DATA, OUT, sleep } = require("./lib");

/* The first launch answers network commands on a port Windows hands out at that
   moment: a fixed one can sit in a block Windows set aside, where nothing can open it. */
let NET_PORT = 0;
function freeUdpPort() {
  return new Promise((resolve) => {
    const s = dgram.createSocket("udp4");
    s.once("error", () => resolve(0));
    s.bind(0, "127.0.0.1", () => { const port = s.address().port; s.close(() => resolve(port)); });
  });
}
/* Full screen taken off a command line, outside its quoted paths: a real game
   a test starts is a small window, never the whole screen. */
const windowed = (args) => String(args).split('"').map((part, i) => (i % 2 ? part : part.replace(/(^|\s)(-f|--fullscreen)(?=\s|$)/g, "$1"))).join('"');

function ask(cmd, wait = 1200) {
  return new Promise((resolve) => {
    const s = dgram.createSocket("udp4");
    const t = setTimeout(() => { s.close(); resolve(""); }, wait);
    s.on("message", (m) => { clearTimeout(t); s.close(); resolve(String(m)); });
    s.on("error", () => { clearTimeout(t); resolve(""); });
    s.send(cmd, NET_PORT, "127.0.0.1", (err) => { if (err) { clearTimeout(t); s.close(); resolve(""); } });
  });
}
const ps = (cmd) => new Promise((resolve) => execFile("powershell.exe", ["-NoProfile", "-Command", cmd], { windowsHide: true }, (e, out) => resolve(String(out || "").trim())));
const readIf = (f) => (fs.existsSync(f) ? fs.readFileSync(f) : null);
const putBack = (f, was) => { if (was === null) { fs.rmSync(f, { force: true }); } else { fs.writeFileSync(f, was); } };
const quoted = (args) => [...String(args).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const shape = (f) => { const s = fs.statSync(f); return s.size + "@" + s.mtimeMs; };

module.exports = async function (b, check) {
  /* Never against the real Xsegon: there DATA is the real data\, a plain Play
     press really plays, and the cleanup sweep would reach a game being played. */
  if (process.argv.includes("--live")) {
    console.log("    (the end to end checks run on the sandbox only; --live is the real Xsegon)");
    return;
  }
  /* ---- a game that can really start: its console's buttons can be set,
     its files are all here, and the runs check has seen it boot if any has */
  const padList = await api("api/pad-remap.php");
  const lib = await api("api/library.php");
  let tags = {};
  try { tags = JSON.parse(String(readIf(path.join(DATA, "tags.json")) || "{}").replace(/^﻿/, "")); } catch (e) { tags = {}; }
  const consoles = new Map((padList.consoles || []).map((c) => [c.platform, c]));
  const runs = (g) => ((tags[g.id] || []).includes("runs") ? 1 : 0);
  const candidates = (lib.games || [])
    .filter((g) => g.playable && !g.local && !g.steam && consoles.has(g.platform))
    .sort((a, c) => runs(c) - runs(a));
  let game = null, dry = null;
  for (const g of candidates.slice(0, 24)) {
    const d = await api("api/launch.php", { id: g.id, dry: true });
    if (!d.ok) { continue; }
    const rom = quoted(d.args).pop();
    if (fs.existsSync(d.exe) && rom && fs.existsSync(rom)) { game = g; dry = d; break; }
  }
  if (!game) {
    console.log("    (no RetroArch game is reachable right now, likely the ROM drive is away; the end to end checks step aside)");
    return;
  }

  const keep = consoles.get(game.platform).map || {};   // whatever is set for this console stays set afterwards
  const was = { sessions: readIf(path.join(DATA, "sessions.jsonl")),
                results: readIf(path.join(DATA, "launch-results.json")),
                launches: readIf(path.join(DATA, "launch-log.jsonl")) };
  const den = path.join(DATA, "e2e");
  const raLog = path.join(OUT, "e2e-retroarch.log");
  let child = null, aside = null;
  try {
    await api("api/pad-remap.php", { platform: game.platform, map: { a: "b", b: "a" } });

    /* ---- 1. the command itself, run for real ------------------------------ */
    const dry2 = await api("api/launch.php", { id: game.id, dry: true });
    check("the buttons ride along on the game's command", [!!dry2.pads, /^--appendconfig="/.test(dry2.args)], [true, true]);
    const cfgReal = path.join(path.dirname(dry2.exe), "retroarch.cfg");
    const cfgWas = fs.existsSync(cfgReal) ? shape(cfgReal) : null;
    /* The quieting config rides behind Xsegon's own append file ('|' is
       RetroArch's delimiter); none of its lines touch the remap keys under test. */
    fs.mkdirSync(den, { recursive: true });
    NET_PORT = await freeUdpPort();
    check("Windows hands out a port for the game to answer on", NET_PORT > 0, true);
    const quiet = path.join(den, "quiet.cfg");
    fs.writeFileSync(quiet, [["savestate_auto_save", "false"], ["savestate_auto_load", "false"],
      ["savefile_directory", den], ["savestate_directory", den], ["screenshot_directory", den],
      ["savefiles_in_content_dir", "false"], ["savestates_in_content_dir", "false"], ["screenshots_in_content_dir", "false"],
      ["content_runtime_log", "false"], ["content_runtime_log_aggregate", "false"], ["history_list_enable", "false"],
      ["audio_mute_enable", "true"], ["video_fullscreen", "false"], ["video_scale", "1"],
      ["pause_nonactive", "false"], ["quit_press_twice", "false"],
      ["network_cmd_enable", "true"], ["network_cmd_port", String(NET_PORT)],
    ].map((kv) => kv[0] + ' = "' + kv[1] + '"').join("\n") + "\n");
    fs.rmSync(raLog, { force: true });
    const args = windowed(dry2.args).replace(/^--appendconfig="([^"]+)"/, (m, f) => '--appendconfig="' + f + "|" + quiet + '"')
               + ' --verbose --log-file="' + raLog + '"';
    // One string, taken verbatim: the dry run's args are already quoted for a
    // command line. argv0 carries its own quotes for the same reason.
    /* Node 24 refuses to spawn a .bat or .cmd directly (EINVAL), so cmd /d /s /c
       runs the line verbatim. In the emulator's own folder, as bin\launch.ps1 does:
       core paths are relative, and from anywhere else RetroArch dies with no core. */
    const inItsFolder = { cwd: path.dirname(dry2.exe), windowsVerbatimArguments: true, stdio: "ignore", detached: false };
    child = /\.(bat|cmd)$/i.test(dry2.exe)
      ? spawn("cmd.exe", ["/d", "/s", "/c", '""' + dry2.exe + '" ' + args + '"'], inItsFolder)
      : spawn(dry2.exe, [args], Object.assign({ argv0: '"' + dry2.exe + '"' }, inItsFolder));
    let gone = false;
    child.on("exit", () => { gone = true; });
    let status = "";
    for (let i = 0; i < 40 && !/PLAYING/.test(status) && !gone; i++) { await sleep(700); status = await ask("GET_STATUS"); }
    const remapDirSaid = await ask("GET_CONFIG_PARAM input_remapping_directory");
    const fullSaid = await ask("GET_CONFIG_PARAM video_fullscreen");
    await ask("QUIT");
    for (let i = 0; i < 20 && !gone; i++) { await sleep(400); }
    if (!gone) { try { child.kill("SIGKILL"); } catch (e) {} for (let i = 0; i < 10 && !gone; i++) { await sleep(300); } }
    const log = fs.existsSync(raLog) ? fs.readFileSync(raLog, "utf8") : "";
    check("RetroArch really starts and plays on the command Xsegon builds", /PLAYING/.test(status), true);
    check("in a window, not the whole screen: full screen is off the command and RetroArch says it is off",
          [/(^|\s)-f(\s|$)/.test(args.split('"').filter((p, i) => i % 2 === 0).join(" ")), /video_fullscreen false/.test(fullSaid) || fullSaid], [false, true]);
    if (!/PLAYING/.test(status)) { console.log("    (RetroArch never said PLAYING for " + game.title + "; its log is kept at tests\\out\\e2e-retroarch.log)"); }
    const said = log.toLowerCase();
    check("and is pointed at Xsegon's remap folder, not LaunchBox's",
          said.includes("ra-remaps") || remapDirSaid.toLowerCase().includes("ra-remaps"), true);
    const rmpRoot = (dry2.pads || {}).folder || path.join(DATA, "ra-remaps");
    const coreDir = fs.existsSync(rmpRoot) ? (fs.readdirSync(rmpRoot)[0] || "") : "";
    check("and says it loaded the buttons set for the console",
          /remap[^\n]{0,80}(loaded|found)|(loaded|found)[^\n]{0,80}remap/i.test(log) || (!!coreDir && said.includes((coreDir + ".rmp").toLowerCase())), true);
    if (log && !/remap/i.test(log)) { console.log("    (RetroArch's verbose log never says remap; kept at tests\\out\\e2e-retroarch.log to see what it says instead)"); }
    check("and this PC's own RetroArch settings are exactly as they were",
          cfgWas === null || shape(cfgReal) === cfgWas, true);

    /* ---- 2. a real press of Play, through the whole product ---------------
       The sandbox server turns every launch dry unless asked with forReal
       (api\launch.php): first the lock is proved for everyone who does not ask.
       Step aside is off meanwhile, so the launcher leaves the person's Xsegon window alone. */
    check("without the named door a test launch stays a rehearsal", (await api("api/launch.php", { id: game.id })).dry, true);
    const s0 = await api("api/settings.php");
    aside = { was: ((s0.settings || s0).launch || {}).stepAside };
    await api("api/settings.php", { launch: { stepAside: false } });
    const d = new Date();
    const dayLog = path.join(DATA, "log", d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + ".log");
    const logAt = fs.existsSync(dayLog) ? fs.statSync(dayLog).size : 0;
    const go = await api("api/launch.php", { id: game.id, forReal: true });
    check("a real press of Play answers and seats the game", [go.ok, fs.existsSync(path.join(DATA, "running.json"))], [true, true]);
    /* logAt is a BYTE offset (statSync), so the log is sliced as bytes: a string
       slice drifts past the LNCH line once the page has logged multibyte characters. */
    const lnch = (fs.existsSync(dayLog) ? fs.readFileSync(dayLog).slice(logAt).toString("utf8") : "").split("\n").find((l) => / LNCH /.test(l)) || "";
    check("and the launch log line says the buttons went along", / pads=2( |$)/.test(lnch), true);
    // this group's game and no other: only it runs on the sandbox's append file
    const mine = "Get-CimInstance Win32_Process -Filter \"Name='retroarch.exe'\" | Where-Object { $_.CommandLine -like '*" + path.join(DATA, "ra-append.cfg") + "*' }";
    let pid = "";
    for (let i = 0; i < 40 && !pid; i++) { await sleep(500); pid = await ps("@(" + mine + " | Select-Object -First 1 -ExpandProperty ProcessId)"); }
    check("and the game's own process stands up", /^\d+$/.test(pid), true);
    /* A real start from the test copy is a small window (api\launch.php): full
       screen is off its command line and off in the settings appended, with the sound. */
    const line = /^\d+$/.test(pid) ? await ps("(Get-CimInstance Win32_Process -Filter \"ProcessId=" + pid + "\").CommandLine") : "";
    const appended = String(readIf(path.join(DATA, "ra-append.cfg")) || "");
    check("in a small window with the sound off, never the whole screen",
          [line !== "" && !/(^|\s)(-f|--fullscreen)(\s|$)/.test(line.split('"').filter((p, i) => i % 2 === 0).join(" ")),
           /^video_fullscreen = "false"$/m.test(appended), /^audio_mute_enable = "true"$/m.test(appended), /^config_save_on_exit = "false"$/m.test(appended)],
          [true, true, true, true]);
    await sleep(1500);
    if (/^\d+$/.test(pid)) { await ps("Stop-Process -Id " + pid + " -Force -ErrorAction SilentlyContinue"); }
    let seated = true;
    for (let i = 0; i < 100 && seated; i++) { await sleep(400); seated = fs.existsSync(path.join(DATA, "running.json")); }
    check("and when the game ends the seat comes back", seated, false);
    /* The launcher gives the seat back and THEN writes how it ended, so the
       result is waited for, like the seat. */
    let results = {};
    for (let i = 0; i < 12 && !results[game.id]; i++) {
      try { results = JSON.parse(String(readIf(path.join(DATA, "launch-results.json")) || "{}").replace(/^﻿/, "")); } catch (e) { results = {}; }
      if (!results[game.id]) { await sleep(400); }
    }
    check("and the launcher wrote down how it ended", !!results[game.id], true);

    /* ---- 3. Play with the core missing: refused with words, not exit 1 ----
       The table is pointed at a core not on disk: the refusal comes before
       anything spawns, names the core and where to get it, and says "waiting"
       while a cores fetch runs. Only this group may take the non-dry road. */
    const tblPath = path.join(DATA, "emulators.json");
    const tblWas = fs.readFileSync(tblPath);
    const tbl = JSON.parse(String(tblWas).replace(/^﻿/, ""));
    for (const o of (tbl.platforms[game.platform.toLowerCase()] || {}).options || []) {
      o.args = String(o.args || "").replace(/-L\s+"[^"]*"/, '-L "cores\\zz_missing_libretro.dll"');
      o.load = "cores\\zz_missing_libretro.dll";
    }
    fs.writeFileSync(tblPath, JSON.stringify(tbl, null, 2));
    try {
      const no = await api("api/launch.php", { id: game.id, forReal: true });
      check("a missing core refuses the launch, naming it and where to get it",
            [no.ok, /zz_missing/.test(no.error || "") && /not downloaded yet/.test(no.error || ""), fs.existsSync(path.join(DATA, "running.json"))],
            [false, true, false]);
      const sj = path.join(DATA, "setup-job.json");
      const sjWas = readIf(sj);
      fs.writeFileSync(sj, JSON.stringify({ kind: "cores", state: "running", pid: process.pid, started: Math.floor(Date.now() / 1000), cores: [] }));
      const waitSaid = await api("api/launch.php", { id: game.id, forReal: true });
      putBack(sj, sjWas);
      check("and while the cores download it says waiting, not failure",
            [waitSaid.ok, /waiting on the cores download/.test(waitSaid.error || ""), waitSaid.waiting], [false, true, true]);
    } finally {
      fs.writeFileSync(tblPath, tblWas);
    }
  } finally {
    if (child && child.exitCode === null) { try { child.kill("SIGKILL"); } catch (e) {} }
    // any RetroArch this group started and lost track of goes too, found by
    // the sandbox's own append file on its command line
    await ps("Get-CimInstance Win32_Process -Filter \"Name='retroarch.exe'\" | Where-Object { $_.CommandLine -like '*" + path.join(DATA, "ra-append.cfg") + "*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }");
    await api("api/pad-remap.php", { platform: game.platform, map: keep });
    if (aside) { await api("api/settings.php", { launch: { stepAside: aside.was === undefined ? true : aside.was } }); }
    putBack(path.join(DATA, "sessions.jsonl"), was.sessions);
    putBack(path.join(DATA, "launch-results.json"), was.results);
    putBack(path.join(DATA, "launch-log.jsonl"), was.launches);
    fs.rmSync(path.join(DATA, "running.json"), { force: true });
    fs.rmSync(den, { recursive: true, force: true });
  }
};
