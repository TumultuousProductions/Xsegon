// The test run's own Xsegon: a server of its own on a copy of data\.
//
// The groups add, hide and delete games while they run, so a run starts its
// own php -S on a free port with XSEGON_DATA pointing at a copy
// (includes\boot.php reads it), and the Xsegon on 8099 is never asked
// anything. `node tests\run.js --live` still runs against 8099.
//
// What the copy holds: every small file and folder of data\, and the
// pictures you replaced (art, copied too, so no test can touch them). The
// big folders the tests only read (the media copy, the thumbnails, the sound
// packs) are junctions to the real ones. Left out: the browser profiles, the
// day logs, the backups and reports (fresh, empty), server.log, and a
// fetched Games Database update. The Games Database's working copy is a hard
// link to the real one: safe because bin\gamesdb.php only ever replaces it
// by rename or deletes it, which changes the link and never the file behind
// it. Its small note beside it is copied, as that one is written in place.
//
// A junction is removed as a link, never followed: each is unlinked by name first.
"use strict";
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync, spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const REAL = path.join(ROOT, "data");
/* One folder per run, named after the process, so a second sandbox started
   beside a run cannot rebuild or clear its data half way. A folder left by a
   run that died is cleared by the next run that starts, once nothing owns it. */
const DIR = path.join(os.tmpdir(), "xsegon-test-data-" + process.pid);
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}
function clearStale() {
  for (const name of fs.readdirSync(os.tmpdir())) {
    const m = /^xsegon-test-data(?:-(\d+))?$/.exec(name);
    if (!m || (m[1] && (Number(m[1]) === process.pid || alive(Number(m[1]))))) { continue; }
    try { clear(path.join(os.tmpdir(), name)); } catch (e) { /* still held: the next run tries again */ }
  }
}
const LINKED = ["media", "thumbs", "sounds"];
const FRESH = ["log", "backups", "reports"];
/* libretro: the lists and picture indexes fetched from libretro, a cache the
   libretro group must never see: it serves its own stand-ins through
   XSEGON_LIBRETRO_*, but a cached list is read before any fetch. */
/* screenscraper.json, screenscraper-shared.dat: the person's real ScreenScraper
   logins and the kept copy of Xsegon's own developer ID. Never copied: the
   tests type stand-in ones, and ask a stand-in the group serves itself.
   videos, documents, extras: scraped snaps, manuals and spare pictures,
   gigabytes of them and nothing a test reads; without the snaps the copy
   also keeps games with no video, which the trailer and snap groups need.
   sounds-own, sounds-staged: the sounds the person chose one by one. The
   settings group chooses its own, and what plays under the pointer must not
   depend on whose PC the suite runs on.
   ra-remaps: the button files the person's last real launches staged. A
   launch writes its own there, and the settings group must find the one it
   staged, not a game's file left by a real play. */
const LEFT_OUT = /^(main-busy|phone\.json|phone-(stop|seen|closed)|browser-profile.*|emulators|videos|documents|extras|videos-steam|sounds-own|sounds-staged|ra-remaps|steamvid-job\.json|fill-(job|look)\.json|fill-stop|videos-screenscraper|screenscraper(-job)?\.json|screenscraper-shared\.dat|log|backups|reports|server\.log|gamesdb\.sqlite(-wal|-shm|\.part\d+)?|gamesdb-update|libretro)$/i;
const HARD_LINKED = ["gamesdb.sqlite"];

function php() {
  const cands = [process.env.XSEGON_PHP, path.join(ROOT, "..", "php-8.5.4-nts-Win32-vs17-x64", "php.exe")];
  for (const c of cands) { if (c && fs.existsSync(c)) { return c; } }
  return "php";
}

// Remove the copy, links first and by name, so nothing can follow one.
function clear(dir = DIR) {
  if (!fs.existsSync(dir)) { return; }
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let st;
    try { st = fs.lstatSync(p); } catch (e) { continue; }
    if (st.isSymbolicLink()) {
      try { fs.rmdirSync(p); } catch (e) { fs.unlinkSync(p); }
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

function build() {
  clearStale();
  clear();
  fs.mkdirSync(DIR, { recursive: true });
  for (const name of fs.readdirSync(REAL)) {
    const from = path.join(REAL, name), to = path.join(DIR, name);
    if (LEFT_OUT.test(name)) { continue; }
    if (LINKED.includes(name)) { fs.symlinkSync(from, to, "junction"); continue; }
    if (HARD_LINKED.includes(name)) {
      // Another drive cannot hard link: then the copy is simply missing and
      // the reader makes one of its own, slower but just as safe.
      try { fs.linkSync(from, to); } catch (e) { /* made afresh when asked */ }
      continue;
    }
    fs.cpSync(from, to, { recursive: true, preserveTimestamps: true });
  }
  for (const name of FRESH) { fs.mkdirSync(path.join(DIR, name), { recursive: true }); }
  /* A runs check going on the real Xsegon while the suite runs: its status,
     copied, says "running" with a live runner, and the copy's server would
     refuse every start, restore and launch the tests ask for. */
  const rcStatus = path.join(DIR, "runcheck", "status.json");
  try {
    if (JSON.parse(fs.readFileSync(rcStatus, "utf8").replace(/^﻿/, "")).running) { fs.rmSync(rcStatus, { force: true }); }
  } catch (e) { /* none, or unreadable: nothing running to keep out */ }
  /* The same for a game being played on the real Xsegon while the suite
     runs: running.json, copied, makes the copy's server refuse every launch,
     dry ones too. */
  fs.rmSync(path.join(DIR, "running.json"), { force: true });
  /* A test copy starts as someone who has had the one-time videos and cheats
     message (includes\tips.php): the first look of every run would write it
     into the mailbox the groups count. The group that tests it takes the mark off. */
  const setupJson = path.join(DIR, "setup.json");
  try {
    const sj = fs.existsSync(setupJson) ? JSON.parse(fs.readFileSync(setupJson, "utf8").replace(/^﻿/, "")) : {};
    if (!sj.tipsTold) { sj.tipsTold = "a test copy"; fs.writeFileSync(setupJson, JSON.stringify(sj)); }
  } catch (e) { /* unreadable: the groups that read it say so */ }
  /* Nor does a test copy add new games by itself (js\newgames.js): its look
     reads the real games folders and would change the library every group
     counts. The scan group switches it on for its own checks. */
  const settingsJson = path.join(DIR, "settings.json");
  try {
    const st = fs.existsSync(settingsJson) ? JSON.parse(fs.readFileSync(settingsJson, "utf8").replace(/^﻿/, "")) : {};
    st.library = Object.assign({}, st.library, { addNewGames: false });
    fs.writeFileSync(settingsJson, JSON.stringify(st, null, 2));
  } catch (e) { /* unreadable: the settings group says so */ }
}

/* Stand-ins for libretro's download site (t-setup): a RetroArch
   .7z holding only a retroarch.exe that is not one, and core .zips for the
   usual consoles, made with Windows' own tar.exe, which is what unpacks the
   real ones. The server is told about them through XSEGON_SETUP_*, which
   includes\setup.php only honours beside XSEGON_DATA, so Get RetroArch runs
   end to end here offline, and nothing real is ever downloaded or run. The
   "usual places" a person's RetroArch lives become one empty folder here. */
const TAR = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
const FIX_CORES = ["mesen", "snes9x", "mupen64plus_next", "gambatte", "mgba", "genesis_plus_gx", "pcsx_rearmed"];
function fixtures(ssPort) {
  const fx = path.join(DIR, "fixtures");
  const ra = path.join(fx, "ra", "RetroArch-Win64");
  fs.mkdirSync(ra, { recursive: true });
  fs.writeFileSync(path.join(ra, "retroarch.exe"), "not a real RetroArch: the test run's stand-in\r\n");
  const seven = path.join(fx, "RetroArch.7z");
  execFileSync(TAR, ["--format", "7zip", "-cf", seven, "-C", path.join(fx, "ra"), "RetroArch-Win64"], { windowsHide: true });
  const cores = path.join(fx, "cores"), loose = path.join(fx, "loose");
  fs.mkdirSync(cores, { recursive: true });
  fs.mkdirSync(loose, { recursive: true });
  for (const c of FIX_CORES) {
    fs.writeFileSync(path.join(loose, c + "_libretro.dll"), "stand-in core\r\n");
    execFileSync(TAR, ["-a", "-cf", path.join(cores, c + "_libretro.dll.zip"), "-C", loose, c + "_libretro.dll"], { windowsHide: true });
  }
  /* The cheat lists' stand-in (includes\cheatlists.php, t-cheatlists.js): a .zip
     with two consoles' folders, and two things in it that are no cheat list. */
  const clSrc = path.join(fx, "cheatlists-src");
  const cht = (names) => "cheats = " + names.length + "\r\n\r\n" + names.map((n, i) =>
    "cheat" + i + "_desc = \"" + n + "\"\r\ncheat" + i + "_code = \"AAAA-BBBB\"\r\ncheat" + i + "_enable = false\r\n").join("\r\n");
  for (const d of [["Nintendo - Nintendo 64"], ["Sega - Mega Drive - Genesis"], ["deep", "er"]]) { fs.mkdirSync(path.join(clSrc, ...d), { recursive: true }); }
  fs.writeFileSync(path.join(clSrc, "Nintendo - Nintendo 64", "Stand-in Quest (USA).cht"), cht(["Infinite Lives", "Moon Jump"]));
  fs.writeFileSync(path.join(clSrc, "Sega - Mega Drive - Genesis", "Other Stand-in (USA).cht"), cht(["Infinite Time"]));
  fs.writeFileSync(path.join(clSrc, "deep", "er", "Nested (USA).cht"), cht(["Never taken"]));
  fs.writeFileSync(path.join(clSrc, "readme.txt"), "not a cheat list\r\n");
  const cheatsZip = path.join(fx, "cheats.zip");
  execFileSync(TAR, ["-a", "-cf", cheatsZip, "-C", clSrc, "Nintendo - Nintendo 64", "Sega - Mega Drive - Genesis", "deep", "readme.txt"], { windowsHide: true });
  const places = path.join(DIR, "places");
  fs.mkdirSync(places, { recursive: true });
  /* The folder the guide's "Choose a folder" answers with (api\pick-folder.php
     writes it as if chosen, and no window opens): one console folder holding
     one stand-in game, so a scan of it finds exactly that. */
  const roms = path.join(DIR, "fresh-roms");
  fs.mkdirSync(path.join(roms, "snes"), { recursive: true });
  fs.writeFileSync(path.join(roms, "snes", "Stand-in Quest (USA).sfc"), "not a game\r\n");
  /* Stand-ins for Steam's store API and video server (includes\steamvid.php):
     empty folders the steamvid tests fill with an answer per app and a small
     "trailer" per movie. ffmpeg is switched off here, so a stream-only
     trailer is reported as needing it rather than fetched. */
  const steam = path.join(fx, "steam");
  fs.mkdirSync(path.join(steam, "api"), { recursive: true });
  fs.mkdirSync(path.join(steam, "cdn"), { recursive: true });
  const url = (p) => "file:///" + p.replace(/\\/g, "/");
  /* libretro's thumbnail server and detail files (includes\libretro.php):
     two folders the libretro group fills with stand-ins, so a fill never
     reaches the internet. */
  const lr = path.join(fx, "libretro");
  fs.mkdirSync(path.join(lr, "thumbs"), { recursive: true });
  fs.mkdirSync(path.join(lr, "meta"), { recursive: true });
  /* A stand-in for RetroArch's system folder (includes\bios.php), so the
     BIOS check never reads the real one: it starts empty, and the bios
     group writes wrong-on-purpose files into it. */
  const raSys = path.join(fx, "ra-system");
  fs.mkdirSync(raSys, { recursive: true });
  /* And stand-in checksums for it (xs_bios_test_sums): the bios group
     writes this file to make a "genuine" file with no real BIOS anywhere. */
  const biosSums = path.join(fx, "bios-sums.json");
  /* A stand-in for the Games Database's picture server (includes\gamesdb.php,
     xs_gamesdb_picture_url): one small picture that answers for every name,
     so a Fill in job run for real here stores pictures and never reaches
     the internet. */
  /* A stand-in for Windows Defender's scanner (includes\unpack.php): a file
     with "virus" in its name is a find, any other is clean. No test starts
     the real one, which takes minutes and answers for the person's own PC.
     While fixtures\defender-hold names a part of the file's name it waits
     (half a minute at most): a test's way to keep a run going. */
  const defender = path.join(fx, "defender.php");
  fs.writeFileSync(defender, [
    "<?php",
    "$f = (string) ($argv[5] ?? '');",
    "$hold = __DIR__ . '/defender-hold';",
    "for ($i = 0; $i < 300 && is_file($hold); $i++) {",
    "    $part = trim((string) @file_get_contents($hold));",
    "    if ($part === '' || stripos(basename($f), $part) === false) { break; }",
    "    usleep(100000);",
    "}",
    "echo \"Scan starting...\\nScan finished.\\n\";",
    "if (stripos(basename($f), 'virus') === false) { echo \"Scanning $f found no threats.\\n\"; exit(0); }",
    "echo \"Scanning $f found 1 threats.\\n\\n<===========================LIST OF DETECTED THREATS==========================>\\n\";",
    "echo \"----------------------------- Threat information ------------------------------\\n\";",
    "echo \"Threat                  : Virus:DOS/Stand_In_Test\\nResources               : 1 total\\n    file                : $f\\n\";",
    "exit(2);",
    "",
  ].join("\n"));
  const gdbPic = path.join(fx, "gamesdb-picture.png");
  fs.copyFileSync(path.join(ROOT, "img", "xsegon-32.png"), gdbPic);
  /* A stand-in for ScreenScraper's API (includes\screenscraper.php). It has
     to answer with statuses (a refused login is a 403, a spent quota a 430),
     so files will not do: the screenscraper group serves it from its own
     process on the port written here, and the server is told the address
     now, since it reads it once at start. */
  const ss = path.join(fx, "ss");
  fs.mkdirSync(ss, { recursive: true });
  fs.writeFileSync(path.join(ss, "port.txt"), String(ssPort));
  /* A stand-in for the Skraper staging helper (includes\skraper.php): the
     same modes and closing words as the real stage.js, against this copy's
     own folder. While its hold file exists it waits, so a test can look at
     a step in flight. A skraper-open file plays Skraper's open window. */
  const skraper = path.join(fx, "skraper-helper");
  fs.mkdirSync(skraper, { recursive: true });
  fs.writeFileSync(path.join(skraper, "stage.js"), [
    '"use strict";',
    'const fs = require("fs"), path = require("path");',
    'const W = __dirname, mode = process.argv[2] || "build";',
    "(async () => {",
    '  for (let i = 0; i < 300 && fs.existsSync(path.join(W, "hold")); i++) { await new Promise((r) => setTimeout(r, 100)); }',
    '  if (mode === "build") {',
    '    const r = await (await fetch(process.env.XSEGON_URL + "/api/screenscraper.php")).json();',
    '    const pick = path.join(W, "pick.json");',
    '    const ids = fs.existsSync(pick) ? JSON.parse(fs.readFileSync(pick, "utf8")).ids.map(String) : null;',
    '    const games = r.games.filter((g) => !g.has && g.system > 0 && (!ids || ids.includes(String(g.id))));',
    '    if (!games.length) { console.log("none of the picked games is still without a video; nothing staged."); fs.rmSync(pick, { force: true }); return; }',
    '    const stage = path.join(W, "stage");',
    "    fs.rmSync(stage, { recursive: true, force: true });",
    '    for (const g of games) { fs.mkdirSync(path.join(stage, g.platform), { recursive: true }); fs.writeFileSync(path.join(stage, g.platform, g.title.replace(/[\\\\/*?"<>|:]/g, " ") + ".iso"), "a stand-in, not a game"); }',
    '    console.log(games.length + " stand-ins for " + new Set(games.map((g) => g.platform)).size + " consoles, in " + stage);',
    '    if (ids) { console.log("staged only the " + games.length + " games picked in Xsegon"); }',
    "    fs.rmSync(pick, { force: true });",
    '  } else if (mode === "check") {',
    '    const stage = path.join(W, "stage");',
    '    const n = fs.existsSync(stage) ? fs.readdirSync(stage, { recursive: true }).filter((f) => /\\.iso$/.test(String(f))).length : 0;',
    '    console.log("videos in (this test copy):\\n  " + n + "  in all");',
    '    console.log("still without a video in Xsegon: plenty");',
    '    console.log("LaunchBox Data\\\\Platforms: exactly as it was (0 files)");',
    '  } else if (mode === "retry") {',
    '    // The second go: with a nothing-left file, the way it ends when only copies were to be made.',
    '    if (fs.existsSync(path.join(W, "nothing-left"))) {',
    '      console.log("1 given a copy of the video the game they are made from already has:\\n  A Stand-In Hack");',
    '      console.log("nothing left to ask Skraper for: every other game on the second-go list has its video.");',
    '    } else {',
    '      fs.mkdirSync(path.join(W, "stage", "second"), { recursive: true });',
    '      fs.writeFileSync(path.join(W, "stage", "second", "A Stand-In Game.iso"), "a stand-in, not a game");',
    '      console.log("1 stand-ins for the second go, in " + path.join(W, "stage"));',
    '    }',
    '  } else if (mode === "tidy") {',
    '    fs.rmSync(path.join(W, "stage"), { recursive: true, force: true });',
    '    fs.rmSync(path.join(W, "second-go.json"), { force: true });',
    '    console.log("1 videos given the name Xsegon looks for");',
    '    console.log("still without a video in Xsegon: 3");',
    '  } else if (mode === "restore") {',
    '    console.log("Skraper\'s settings are back as they were (a stand-in: nothing was changed).");',
    '  } else { console.log("no such step: " + mode); process.exit(2); }',
    '})().catch((e) => { console.log("stopped: " + e.message); process.exit(1); });',
    "",
  ].join("\n"));
  return {
    XSEGON_SKRAPER: skraper,
    XSEGON_SS_API: "http://127.0.0.1:" + ssPort + "/",
    XSEGON_SS_SHARED: "http://127.0.0.1:" + ssPort + "/shared.json",   // the website's copy of Xsegon's own developer ID
    XSEGON_RA_SYSTEM: raSys,
    XSEGON_BIOS_SUMS: biosSums,
    XSEGON_LIBRETRO_THUMBS: url(path.join(lr, "thumbs")),
    XSEGON_LIBRETRO_META: url(path.join(lr, "meta")),
    XSEGON_GAMESDB_IMAGES: url(gdbPic),
    XSEGON_STEAMVID_API: url(path.join(steam, "api")) + "/{appid}.json",
    XSEGON_STEAMVID_CDN: url(path.join(steam, "cdn")) + "/{movie}.mp4",
    XSEGON_FFMPEG: path.join(fx, "archive", "cutter.php"),   // the cutter's stand-in: t-archivevid.js writes it
    XSEGON_ARCHIVE: url(path.join(fx, "archive")),      // the Internet Archive's stand-in: t-archivevid.js fills it
    XSEGON_ARCADEDB: url(path.join(fx, "arcadedb")),    // the Arcade Database's stand-in: t-arcadevid.js fills it
    XSEGON_CHEATLISTS: url(cheatsZip),                  // libretro's cheat lists, as the stand-in above
    XSEGON_DEFENDER: defender,
    XSEGON_PICK_ANSWER: roms,
    XSEGON_SETUP_SOURCE: seven,
    XSEGON_SETUP_SHA: crypto.createHash("sha256").update(fs.readFileSync(seven)).digest("hex"),
    XSEGON_SETUP_CORES: "file:///" + cores.replace(/\\/g, "/"),
    XSEGON_SETUP_PLACES: path.join(places, "RetroArch"),
  };
}

/* The person's real emulator folders, as the live emulator table names them.
   The test server is told (XSEGON_TEST_KEEP_OUT) and never writes into one:
   xs_test_keep_out, includes\boot.php. A folder the copy itself sits under is
   left out, or the copy could not be written either. */
function realEmulatorFolders() {
  try {
    const table = JSON.parse(fs.readFileSync(path.join(REAL, "emulators.json"), "utf8").replace(/^﻿/, ""));
    const dirs = Object.values(table.programs || {}).map((p) => String((p && p.exe) || ""))
      .filter((exe) => /^[A-Za-z]:\\/.test(exe)).map((exe) => path.dirname(exe));
    return [...new Set(dirs)].filter((d) => !(DIR.toLowerCase() + "\\").startsWith(d.toLowerCase().replace(/\\+$/, "") + "\\"));
  } catch (e) { return []; }      // no table yet: nothing real to keep out of
}

// An even port with the one above it free: the page starts the fast lane on the port above the server's,
// and with every port a run takes for itself even, two runs started together never sit on each other's lane.
async function freePort() {
  const any = () => new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => { const port = srv.address().port; srv.close(() => resolve(port)); });
  });
  const open = (port) => new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
  for (let tries = 0; tries < 40; tries++) {
    const port = await any();
    if (port % 2 === 0 && await open(port + 1)) { return port; }
  }
  return any();                 // none in forty: any free port
}

/** Build the copy, start its server, and say where it is. */
async function start() {
  const t0 = Date.now();
  build();
  const port = await freePort();
  // The ScreenScraper stand-in's port: never the server's, nor the one above
  // it, which is where the page starts the fast lane.
  let ssPort = await freePort();
  while (ssPort === port || ssPort === port + 1) { ssPort = await freePort(); }
  const setup = fixtures(ssPort);
  const url = "http://127.0.0.1:" + port;
  const proc = spawn(php(), ["-S", "127.0.0.1:" + port, "-t", ROOT, path.join(ROOT, "router.php")], {
    // HOME as a test shell has it, so RetroArch's "~" folders read alike from any shell (a launch can be asked for Windows' way: assumeNoHome).
    cwd: ROOT, env: Object.assign({}, process.env, { XSEGON_DATA: DIR, HOME: process.env.HOME || process.env.USERPROFILE || "", XSEGON_TEST_KEEP_OUT: realEmulatorFolders().join("|") }, setup), stdio: "ignore", windowsHide: true,
  });
  let up = false;
  for (const end = Date.now() + 15000; Date.now() < end && !up;) {
    try { const r = await fetch(url + "/api/status.php"); up = r.ok; } catch (e) { /* not yet */ }
    if (!up) { await new Promise((r) => setTimeout(r, 150)); }
  }
  if (!up) { try { proc.kill(); } catch (e) { /* gone */ } throw new Error("the test server did not start on " + url); }
  return {
    url, data: DIR, port, ms: Date.now() - t0, setup, fixCores: FIX_CORES,
    stop() {
      try { proc.kill(); } catch (e) { /* gone */ }
      try { clear(); } catch (e) { /* a file still held; the next run clears it */ }
    },
  };
}

module.exports = { start, DIR };
