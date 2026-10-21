/* Saving, when saving does not work.
 *
 * Every overlay Xsegon owns goes through xs_write_json. rename() on Windows
 * replaces a file, and a failed rename leaves the old one untouched, so an
 * unlink first buys nothing and costs the file whenever anything else (a
 * scanner) has it open for a moment.
 *
 * The PHP probe (tests\write-probe.php) drives the function directly, since
 * a held file cannot be arranged from a browser. This half proves the reason
 * reaches the page: a folder is put where a data file belongs, and the
 * answer must say what happened.
 *
 * The folder is put back in a finally, and run.js's Guard clears a folder in
 * the way as well, so a crash in the middle cannot cost real data.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, BASE, DATA, ROOT, sleep } = require("./lib");
const { execFileSync, spawn } = require("child_process");

/** The php.exe that is running the server, which the status knows. */
async function phpExe() {
  const st = await api("api/status.php");
  const exe = (st.build || {}).phpExe;
  if (!exe || !fs.existsSync(exe)) { throw new Error("the status does not say which php.exe is running"); }
  return exe;
}

/** Stand a folder where a file belongs, do something, then put it all back. */
async function withFolderInTheWay(name, body) {
  const p = path.join(DATA, name);
  const kept = fs.existsSync(p) ? fs.readFileSync(p) : null;
  fs.rmSync(p, { force: true });
  fs.mkdirSync(p);
  try {
    return await body();
  } finally {
    fs.rmSync(p, { recursive: true, force: true });
    fs.rmSync(p + ".tmp", { force: true });
    if (kept !== null) { fs.writeFileSync(p, kept); }
  }
}

module.exports = async function (b, check) {
  /* ---- the function itself, driven directly ------------------------------ */
  const exe = await phpExe();
  // The run's own data folder, so the probe's log lines land in the copy
  // and not in the real data\log.
  const out = execFileSync(exe, [path.join(ROOT, "tests", "write-probe.php")], { encoding: "utf8", env: Object.assign({}, process.env, { XSEGON_DATA: require("./lib").DATA }) });
  let rows;
  try { rows = JSON.parse(out.trim().split("\n").pop()); } catch (e) {
    check("the write probe ran", out.slice(0, 300), "valid JSON");
    return;
  }
  for (const r of rows) { check(r.name, r.got, r.want); }

  /* A server told to use a data folder that is gone refuses, and never falls
     back to the real one: a test copy deleted under a running suite would
     let test games into the person's data. */
  const realLog = path.join(ROOT, "data", "log");
  const logSize = () => { try { return fs.readdirSync(realLog).reduce((n, f) => n + fs.statSync(path.join(realLog, f)).size, 0); } catch (e) { return 0; } };
  const before = logSize();
  let refused = null;
  try {
    execFileSync(exe, ["-r", "require 'includes/boot.php'; echo xs_data_dir(); xs_log('WRIT', 'must never reach the real log');"],
      { cwd: ROOT, encoding: "utf8", stdio: "pipe", env: Object.assign({}, process.env, { XSEGON_DATA: path.join(require("./lib").DATA, "no-such-folder") }) });
    refused = "it ran on";
  } catch (e) { refused = /data folder is gone/.test(String(e.stdout || "")) ? "refused" : String(e.stdout || e.message).slice(0, 120); }
  check("a server whose data folder is gone refuses rather than use the real one", refused, "refused");
  check("and writes nothing into the real folder", logSize(), before);

  /* Nothing of LaunchBox's files is copied: an import brings in the list of
     games and the person's own play data, never its pictures, sound packs or
     video snaps. On a data folder and a stand-in LaunchBox of the check's
     own, since the run's sounds and media folders are the real ones. */
  const pullDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "xs-pull-"));
  try {
    const lb = path.join(pullDir, "LaunchBox"), pullData = path.join(pullDir, "data");
    for (const d of [["Sounds", "Stand-in Pack"], ["Images", "Nintendo 64", "Box - Front"], ["Videos", "Nintendo 64"], ["Data", "Platforms"]]) { fs.mkdirSync(path.join(lb, ...d), { recursive: true }); }
    fs.writeFileSync(path.join(lb, "Sounds", "Stand-in Pack", "Move.wav"), "RIFFxxxxWAVE");
    fs.writeFileSync(path.join(lb, "Images", "box.png"), "not a real picture");
    fs.writeFileSync(path.join(lb, "Images", "Nintendo 64", "Box - Front", "Stand In Game-01.png"), "not a real picture");
    fs.writeFileSync(path.join(lb, "Videos", "Nintendo 64", "Stand In Game.mp4"), "not a real video");
    fs.writeFileSync(path.join(lb, "Data", "Platforms.xml"), "<?xml version=\"1.0\"?><LaunchBox><Platform><Name>Nintendo 64</Name></Platform></LaunchBox>");
    fs.writeFileSync(path.join(lb, "Data", "Platforms", "Nintendo 64.xml"), "<?xml version=\"1.0\"?><LaunchBox><Game><Title>Stand In Game</Title><ID>stand-in-1</ID>" +
      "<Platform>Nintendo 64</Platform><ApplicationPath>C:\\Games\\Stand In Game.z64</ApplicationPath><Favorite>true</Favorite><PlayCount>3</PlayCount></Game></LaunchBox>");
    fs.mkdirSync(pullData);
    fs.writeFileSync(path.join(pullData, "settings.json"), JSON.stringify({ paths: { launchbox: lb } }));
    const pull = JSON.parse(execFileSync(exe, [path.join(ROOT, "tests", "pull-probe.php"), lb],
      { cwd: ROOT, encoding: "utf8", stdio: "pipe", env: Object.assign({}, process.env, { XSEGON_DATA: pullData }) }).trim().split("\n").pop());
    check("nothing is left that copies LaunchBox's files after an import, or its sound packs at all",
      [pull.copiers, pull.afterImport, pull.soundsIn], [[], false, []]);
    check("the Copy media tool is gone as well, and a game of LaunchBox's is read with nothing made in the data folder",
      [pull.copyTool, pull.shownFrom, pull.made], [[], path.join(lb, "Images", "box.png"), []]);
    check("an import brings in the game and your own data for it, and none of LaunchBox's pictures",
      [pull.imported, pull.importedArt], [[true, 1, "Stand In Game", true, 3], []]);
    check("and LaunchBox's sound packs and videos are never looked for: Xsegon's own folders only",
      [pull.packs.includes("Stand-in Pack"), pull.videoRoots.some((d) => d.toLowerCase().startsWith(lb.toLowerCase()))], [false, false]);
  } finally { fs.rmSync(pullDir, { recursive: true, force: true }); }

  /* A drive that has stopped answering (includes\drives.php). A look at a
     drive is announced in a small file, taken away when the drive answers;
     one left standing means the drive is holding a request up, and the next
     request does not look. Made by hand here: a real dead drive takes
     Windows forty seconds to give up on. */
  const drvDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "xs-drive-"));
  let drvKept = null;
  try {
    const drvData = path.join(drvDir, "data");
    fs.mkdirSync(drvData);
    fs.writeFileSync(path.join(drvData, "settings.json"), JSON.stringify({ paths: { launchbox: "", romRoot: "" } }));
    const probe = (args) => JSON.parse(execFileSync(exe, [path.join(ROOT, "tests", "drive-probe.php")].concat(args),
      { cwd: ROOT, encoding: "utf8", stdio: "pipe", env: Object.assign({}, process.env, { XSEGON_DATA: drvData }) }).trim().split("\n").pop());
    const dead = "\\\\xs-no-such-pc\\games\\Xs Stuck Game.zip";       // never looked at: its announcement is found first
    const where = probe(["where", dead]);
    drvKept = where.dir;
    check("a path's drive is its letter or its share, and a path with neither has none",
      [where.drive, probe(["where", "e:/roms/x.zip"]).drive, probe(["where", "roms/x.zip"]).drive], ["\\\\xs-no-such-pc\\games", "E:\\", ""]);
    // A look announced half a minute ago and never answered, and its waiter heard from just now.
    fs.mkdirSync(where.dir, { recursive: true });
    fs.writeFileSync(path.join(where.dir, where.stem + "-4242.look"), String(Date.now() / 1000 - 30));
    fs.writeFileSync(path.join(where.dir, where.stem + ".wait"), "");
    const held = probe(["stuck", dead]);
    check("a drive whose announced look was never answered is not looked at: said at once, and a file on it counts as there",
      [held.stuck, held.seen, held.ms < 1500], ["\\\\xs-no-such-pc\\games", true, true]);
    fs.writeFileSync(path.join(drvData, "scanned-games.json"), JSON.stringify([{ id: "xs-scan-aaaaaaaaaaaa", title: "Xs Stuck Game", platform: "Nintendo 64", rom: dead, added: "2026-10-11T00:00:00-04:00" }]));
    const read = probe(["games"]);
    check("a game on that drive is read without a look at its file, and is not called missing",
      [read.games.length, /not there/.test(String((read.games[0] || [])[1])), read.ms < 1500], [1, false, true]);
    /* The status check's read leaves every drive alone (roadmap BN1): a game on a share
       nothing has announced is read with no look at all, so nothing is announced either. */
    const fresh = "\\\\xs-no-such-pc-2\\games\\Xs Alone Game.zip", freshAt = probe(["where", fresh]);
    fs.writeFileSync(path.join(drvData, "scanned-games.json"), JSON.stringify([{ id: "xs-scan-bbbbbbbbbbbb", title: "Xs Alone Game", platform: "Nintendo 64", rom: fresh, added: "2026-10-21T00:00:00-04:00" }]));
    const alone = probe(["alone"]);
    check("with every drive left alone, a game on a share never asked is read at once, with no look at any drive, and is not called missing",
      [alone.games.length, /not there/.test(String((alone.games[0] || [])[1])), alone.looks, alone.ms < 1500,
       fs.readdirSync(freshAt.dir).some((f) => f.startsWith(freshAt.stem))], [1, false, [], true, false]);
    // A drive letter nothing is on answers at once ("not there"), which is an answer.
    const free = "QRSTUVWXYZ".split("").find((l) => !fs.existsSync(l + ":\\"));
    if (free) {
      const spare = free + ":\\xs\\Game.zip", at = probe(["where", spare]);
      const kept = () => fs.readdirSync(at.dir).filter((f) => f.startsWith(at.stem));
      fs.writeFileSync(path.join(at.dir, at.stem + "-4242.look"), String(Date.now() / 1000 - 30));
      fs.writeFileSync(path.join(at.dir, at.stem + ".wait"), "");
      const longAgo = new Date(Date.now() - 600000);
      fs.utimesSync(path.join(at.dir, at.stem + ".wait"), longAgo, longAgo);
      check("a waiter not heard from for minutes is gone: what was kept is taken away and the drive is asked again",
        [probe(["stuck", spare]).stuck, kept()], [null, []]);
      fs.writeFileSync(path.join(at.dir, at.stem + "-4242.look"), String(Date.now() / 1000 - 30));
      let ended = null;
      try { execFileSync(exe, [path.join(ROOT, "bin", "drive-wait.php"), free + ":", "2"], { cwd: ROOT, stdio: "pipe", timeout: 30000, env: Object.assign({}, process.env, { XSEGON_DATA: drvData }) }); ended = 0; } catch (e) { ended = e.status === null ? "timed out" : e.status; }
      check("the waiter gives a drive back once it has answered quickly for the time asked, and ends by itself", [ended, kept()], [0, []]);
    } else {
      check("(every drive letter from Q to Z is in use here: the waiter is left to a PC with one free)", true);
    }
  } finally {
    if (drvKept) { fs.rmSync(drvKept, { recursive: true, force: true }); }
    fs.rmSync(drvDir, { recursive: true, force: true });
  }

  /* A screen bigger than 1920 x 1200 (bin\xsbrowser.ps1): Xsegon's window is
     started at the scale that makes it read as one, never under Windows' own,
     unless Settings > Window > Fill a big screen is off. The rule is asked
     with made-up screens and a folder of the check's own; no window opens
     (tests\scale-probe.ps1). */
  const scaleDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "xs-scale-"));
  try {
    const sc = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "tests", "scale-probe.ps1"), scaleDir],
      { cwd: ROOT, encoding: "utf8", stdio: "pipe", timeout: 60000 }).trim().split("\n").pop());
    check("a screen bigger than 1920 x 1200 gets the scale at which it reads as one; a smaller one, a tall one, and one Windows already has as large, none",
      sc.fits, ["1280x720@1=0", "1920x1080@1=0", "1920x1200@1=0", "2560x1440@1=1.2", "2560x1440@1.25=0", "3440x1440@1=1.2", "2560x1600@1=1.3",
                "3840x2160@1=1.8", "3840x2160@1.5=1.8", "3840x2160@1.75=0", "3840x2160@3=0", "5120x2880@2=2.4", "1440x2560@1=0"]);
    const flag = "--force-device-scale-factor=";
    check("the browser is told so when the window starts: with the switch on or never set, not with it off, not on a screen no bigger, and a size asked for by hand wins",
      [sc.none, sc.on, sc.off, sc.small, sc.hand, sc.quiet], [flag + "1.8", flag + "1.8", null, null, flag + "1.5", null]);
    check("and the log says what was done and why, once a start",
      [sc.said.length, /a 3840 x 2160 screen, which Windows has at 150%: everything is drawn at 180%, so the page is laid out as on a 2133 x 1200 screen/.test(sc.said[0] || ""),
       /Fill a big screen is off \(Settings > Window\), so everything stays at that size/.test(sc.said[2] || ""), /drawn at 150%, asked for by hand/.test(sc.said[3] || "")],
      [4, true, true, true]);
    /* The scale is the browser's from its start, so a window open when a TV is plugged in, or taken
       away, has the other screen's. bin\open.ps1 -Fit opens it again then, and only then. */
    const kind = (sc.misfit || []).map((m) => m.split(":")[0]);
    check("a window on another screen than it was started on is opened again: a TV plugged in, the TV taken away, the switch turned off since; one that fits stays, and so does a size asked for by hand",
      [kind[0], kind[1], kind[2], kind[3], kind[4], kind[8], kind[9]], ["again 1", "stays", "again 1", "stays", "stays", "again 1", "stays"]);
    check("never a third time in a minute, and what a window was started with is written down and kept for the same window found again",
      [kind[5], kind[6], kind[7], /twice in the last minute: not a third time$/.test(sc.misfit[5] || ""), sc.record], ["stays", "again 1", "again 2", true, "1.8 False 1"]);
    check("and the log line says both screens' sizes in words",
      /^again 1: the screen is now a 3840 x 2160 screen, which Windows has at 125%: the window was opened at Windows' own size, and this screen is drawn at 180%$/.test(sc.misfit[0] || ""), true);
    check("Windows says how big this PC's own screen is", /^\d+x\d+@\d+(\.\d+)?$/.test(String(sc.here)), true);
  } finally { fs.rmSync(scaleDir, { recursive: true, force: true }); }

  /* A background job's values reach it exactly, whatever they hold. cmd.exe
     does not know \" quoting, so a ROM path with an & splits a command line:
     they go as PowerShell's -EncodedCommand. A stand-in script writes back
     what it was given. */
  const spawnDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "xs-spawn-"));
  try {
    const echo = path.join(spawnDir, "echo.ps1");
    const got = path.join(spawnDir, "got.json");
    fs.writeFileSync(echo, "param([string] $Out, [string] $Title, [string] $Arguments, [int] $Port, [switch] $Log, [switch] $Off)\r\n" +
      "[IO.File]::WriteAllText($Out, (@{ title = $Title; arguments = $Arguments; port = $Port; log = [bool] $Log; off = [bool] $Off } | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))\r\n");
    const title = "Mario & Luigi: \"Quest\" | Tony Hawk\u2019s %PATH% ^x <b> Pok\u00e9mon 'y' $(whoami) `n";
    const args = '-L "cores\\snes9x_libretro.dll" "E:\\ROMS\\Game & Watch Gallery (USA).zip"';
    fs.writeFileSync(path.join(spawnDir, "in.json"), JSON.stringify({ out: got, title, args }));
    execFileSync(exe, ["-r", "require 'includes/boot.php'; $j = json_decode(file_get_contents($argv[1]), true); " +
      "exit(xs_spawn_ps(xs_ps_call($argv[2], ['Out' => $j['out'], 'Title' => $j['title'], 'Arguments' => $j['args'], 'Port' => 55355, 'Log' => true, 'Off' => false]), ['hidden' => true]) ? 0 : 1);",
      path.join(spawnDir, "in.json"), echo], { cwd: ROOT, encoding: "utf8", stdio: "pipe", env: Object.assign({}, process.env, { XSEGON_DATA: require("./lib").DATA }) });
    const t0 = Date.now();
    while (!fs.existsSync(got) && Date.now() - t0 < 15000) { await new Promise((r) => setTimeout(r, 100)); }
    const back = fs.existsSync(got) ? JSON.parse(fs.readFileSync(got, "utf8")) : {};
    check("a title with & | % ^ < > quotes, a curly apostrophe, an accent and $( ) reaches the script exactly", back.title, title);
    check("and so do arguments with a quoted ROM path holding an &", back.arguments, args);
    check("a number, a switch that is on and one that is off", [back.port, back.log, back.off], [55355, true, false]);
  } finally {
    fs.rmSync(spawnDir, { recursive: true, force: true });
  }

  /* A file of yours that will not read is never saved over: one comma out of
     place would read as empty and the next save write a nearly empty file.
     Refused, left exactly as it was, said on screen, let go once it reads. */
  const favPath = path.join(DATA, "favourites.json");
  const favWas = fs.existsSync(favPath) ? fs.readFileSync(favPath) : null;
  const broken = '{\n  "xs-aaaa": true\n  "xs-bbbb": true\n}\n';          // the missing comma
  fs.writeFileSync(favPath, broken);
  try {
    const libB = await api("api/library.php");
    const someone = (libB.games || []).find((g) => g.playable) || (libB.games || [])[0];
    const refusedFav = await api("api/favourite.php", { id: someone.id, fav: true });
    check("starring a game with favourites.json damaged is refused", refusedFav.ok, false);
    check("and says which file, why, and what to do", /favourites\.json cannot be read.*will not save over it.*Settings > Backups/.test(refusedFav.error || ""), true);
    check("the damaged file is left exactly as it was", fs.readFileSync(favPath, "utf8"), broken);
    const stD = await api("api/status.php");
    check("the status names it", (stD.damaged || []).map((d) => d.file), ["favourites.json"]);
    await b.goto();
    check("and the page says so at the bottom", await b.until(`/favourites\\.json cannot be read/.test((document.getElementById("strip") || {}).textContent || "")`, true, 8000), true);
    fs.writeFileSync(favPath, '{\n  "xs-aaaa": true,\n  "xs-bbbb": true\n}\n');   // put right by hand
    check("once it reads again, nothing is said any more", ((await api("api/status.php")).damaged || []).length, 0);
    check("and saving works again", (await api("api/favourite.php", { id: someone.id, fav: false })).ok, true);
    check("the note is gone too", fs.existsSync(path.join(DATA, "damaged.json")), false);
  } finally {
    if (favWas === null) { fs.rmSync(favPath, { force: true }); } else { fs.writeFileSync(favPath, favWas); }
    fs.rmSync(path.join(DATA, "damaged.json"), { force: true });
  }

  /* The same loss by two more roads: a file of yours that is empty (cut
     short by something else's save), and one another program is holding as
     it is read. Neither may read as "nothing there" and be saved over. A
     file that is not there at all is fine: deleting it starts it again. */
  const favWas2 = fs.existsSync(favPath) ? fs.readFileSync(favPath) : null;
  let holder = null;
  try {
    const libE = await api("api/library.php");
    const one = (libE.games || []).find((g) => g.playable) || (libE.games || [])[0];
    fs.writeFileSync(favPath, "");
    const refusedEmpty = await api("api/favourite.php", { id: one.id, fav: true });
    check("starring a game with favourites.json empty is refused", refusedEmpty.ok, false);
    check("and says it is empty, and both ways out", /favourites[.]json is empty.*will not save over it.*Settings > Backups.*delete the file/.test(refusedEmpty.error || ""), true);
    check("the empty file is left as it was", fs.readFileSync(favPath, "utf8"), "");
    check("the status names it", ((await api("api/status.php")).damaged || []).map((d) => d.file), ["favourites.json"]);
    fs.rmSync(favPath);
    check("with the file deleted, nothing is said any more", ((await api("api/status.php")).damaged || []).length, 0);
    check("and a save starts it again", (await api("api/favourite.php", { id: one.id, fav: true })).ok, true);

    const good = fs.readFileSync(favPath, "utf8");
    holder = spawn("powershell.exe", ["-NoProfile", "-Command",
      "$f = [System.IO.File]::Open($env:XS_HOLD, 'Open', 'ReadWrite', 'None'); 'held'; Start-Sleep 20; $f.Close()"],
      { env: Object.assign({}, process.env, { XS_HOLD: favPath }), windowsHide: true });
    const held = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), 15000);
      holder.stdout.on("data", (d) => { if (/held/.test(String(d))) { clearTimeout(t); resolve(true); } });
    });
    check("(another program takes hold of favourites.json)", held, true);
    const refusedHeld = await api("api/favourite.php", { id: one.id, fav: false });
    check("a save while something else holds the file is refused", refusedHeld.ok, false);
    check("and says it was not saved and nothing changed", /favourites[.]json was not saved: it could not be opened.*Nothing in it was changed/.test(refusedHeld.error || ""), true);
    holder.kill();
    holder = null;
    await sleep(600);
    check("the held file comes out exactly as it went in", fs.readFileSync(favPath, "utf8"), good);
    check("and once it is let go, saving works again", (await api("api/favourite.php", { id: one.id, fav: false })).ok, true);
  } finally {
    if (holder) { holder.kill(); await sleep(600); }
    if (favWas2 === null) { fs.rmSync(favPath, { force: true }); } else { fs.writeFileSync(favPath, favWas2); }
    fs.rmSync(path.join(DATA, "damaged.json"), { force: true });
  }

  /* One "inside this folder" check for every picture, sound and video door:
     without a separator, ...\Images matches ...\Images2. */
  const inside = execFileSync(exe, ["-r", "require 'includes/boot.php'; echo json_encode([" +
    "xs_inside('C:\\\\LB\\\\Images\\\\a.png', 'C:\\\\LB\\\\Images'), xs_inside('C:\\\\LB\\\\Images2\\\\a.png', 'C:\\\\LB\\\\Images'), " +
    "xs_inside('c:\\\\lb\\\\images\\\\a.png', 'C:\\\\LB\\\\Images\\\\'), xs_inside('C:\\\\a.png', '')]);"],
    { cwd: ROOT, encoding: "utf8", stdio: "pipe", env: Object.assign({}, process.env, { XSEGON_DATA: DATA }) });
  check("inside: yes, not a neighbour with the same start, any case, never inside nothing", inside.trim(), "[true,false,true,false]");

  /* A Games Database lookup has a time limit: it runs inside a request on a
     one-at-a-time server, and one that never answers freezes every page.
     With no time at all it must be stopped and say so. */
  const gdb = JSON.parse(execFileSync(exe, ["-r", "require 'includes/gamesdb.php'; echo json_encode(xs_gamesdb(['search', 'Nintendo 64', 'Mario'], 0));"],
    { cwd: ROOT, encoding: "utf8", stdio: "pipe", env: Object.assign({}, process.env, { XSEGON_DATA: DATA }) }));
  check("a database lookup past its limit is stopped, and says so", [gdb.ok, /did not answer within 0 seconds/.test(gdb.error || "")], [false, true]);

  /* Disc sets: marked only when the files prove a game is one of several
     discs, worked out from the files each read. */
  const discDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "xs-discs-"));
  try {
    const files = {
      "Alone (Disc 1).cue": "", "Pair (Disc 1).cue": "", "Pair (Disc 2).cue": "", "Pair (Disc 2).bin": "",
      "Single.cue": "", "Once (Disc 1 of 1).cue": "", "Cart.z64": "",
      "Set.m3u": "#EXTM3U\r\nSet (Disc 1).cue\r\n\r\nSet (Disc 2).cue\r\nSet (Disc 3).cue\r\n", "One.m3u": "One (Disc 1).cue\r\n",
    };
    for (const [n, body] of Object.entries(files)) { fs.writeFileSync(path.join(discDir, n), body); }
    const ask = ["Alone (Disc 1).cue", "Pair (Disc 2).cue", "Single.cue", "Once (Disc 1 of 1).cue", "Cart.z64", "Set.m3u", "One.m3u"];
    const d = JSON.parse(execFileSync(exe, [path.join(ROOT, "tests", "disc-probe.php"), discDir, JSON.stringify(ask)],
      { cwd: ROOT, encoding: "utf8", stdio: "pipe", env: Object.assign({}, process.env, { XSEGON_DATA: DATA }) }));
    check("discs: a disc of a set with no playlist is marked, with how many of the set are beside it",
      [d["Alone (Disc 1).cue"], d["Pair (Disc 2).cue"]], [{ set: false, disc: 1, onDisk: 1 }, { set: false, disc: 2, onDisk: 2 }]);
    check("a playlist of three discs is a set of three (its comment and blank line not counted)", d["Set.m3u"], { set: true, n: 3 });
    check("one disc, a cartridge, (Disc 1 of 1) and a playlist of one are never marked",
      [d["Single.cue"], d["Cart.z64"], d["Once (Disc 1 of 1).cue"], d["One.m3u"]], [null, null, null, null]);
  } finally {
    fs.rmSync(discDir, { recursive: true, force: true });
  }

  /* Days of log past the last 30 go when a new day's log starts. On a folder
     of its own, not this run's. */
  const pruneData = fs.mkdtempSync(path.join(require("os").tmpdir(), "xs-logprune-"));
  try {
    const pruneLog = path.join(pruneData, "log");
    fs.mkdirSync(pruneLog);
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10) + ".log";
    for (const f of [day(45), day(32), day(20), "notes.log"]) { fs.writeFileSync(path.join(pruneLog, f), "x\n"); }
    execFileSync(exe, ["-r", "require 'includes/boot.php'; xs_log('TEST', 'a new day');"],
      { cwd: ROOT, encoding: "utf8", stdio: "pipe", env: Object.assign({}, process.env, { XSEGON_DATA: pruneData }) });
    const left = fs.readdirSync(pruneLog).sort();
    check("a new day's log removes days older than 30, and nothing else", [left.includes(day(45)), left.includes(day(32)), left.includes(day(20)), left.includes("notes.log"), left.length],
          [false, false, true, true, 3]);
  } finally {
    fs.rmSync(pruneData, { recursive: true, force: true });
  }

  /* ---- and the reason arriving at the page ------------------------------- */
  const lib = await api("api/library.php");
  const game = (lib.games || []).find((g) => g.playable && !g.local);

  const fav = await withFolderInTheWay("favourites.json", () =>
    api("api/favourite.php", { id: game.id, fav: true }));
  check("a star that cannot be saved is not called a success", fav.ok, false);
  check("and the answer says which file", /favourites\.json/.test(fav.error || ""));
  check("and what to look at", /holding it|disk|folder|read only/i.test(fav.error || ""));

  const hid = await withFolderInTheWay("hidden.json", () =>
    api("api/hide.php", { id: game.id, hide: true }));
  check("hiding says why it could not", hid.ok, false);
  check("naming hidden.json, not a generic line", /hidden\.json/.test(hid.error || ""));

  const set = await withFolderInTheWay("settings.json", () =>
    api("api/settings.php", { video: { enabled: true } }));
  /* The write's result must not be thrown away, or a settings file that never
     reached the disk answers 200 OK and the page shows a value not kept. */
  check("settings no longer answer OK when nothing was saved", set.ok, false);
  check("saying so in words", /settings\.json/.test(set.error || ""));

  // The star really was not set: the failure is honest both ways.
  const after = await api("api/library.php?platform=" + encodeURIComponent(game.platform));
  check("and the game it could not star is not starred", !!(after.games.find((g) => g.id === game.id) || {}).fav, false);

  /* ---- the version stamp, where a report would find it -------------------- */
  const st = await api("api/status.php");
  check("the status says which build answered", /^\d+(\.\d+){1,3}$/.test((st.build || {}).version || ""));
  check("with the commit it was built from", /^[0-9a-f]{7}$/.test((st.build || {}).commit || ""));

  const log = await api("api/log.php?tail=20");
  check("the log carries the build line too", /^Xsegon \d+(\.\d+){1,3} .*PHP /.test(log.build || ""));

  await b.goto(BASE + "/");
  // The wall of consoles has a smaller vocabulary and L is not in it, so go
  // into one first, the way t-log reaches the viewer.
  await b.enterConsole();
  await b.key("l");
  check("the log viewer shows it on screen",
    await b.waitFor(`!!document.querySelector("#editor .lg-build") && /^Xsegon \\d/.test(document.querySelector("#editor .lg-build").textContent)`, 6000));
  await b.key("Escape");
  await sleep(400);
};
