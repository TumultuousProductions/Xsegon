/* Report a problem.
 *
 * What is checked is whether it says the right thing: an unplugged ROM folder
 * is BAD and the first thing report.txt says; with everything fine it says so.
 *
 * The zip is read back with a reader written here, not the writer that made
 * it: a writer that marks its own work proves nothing.
 *
 * Nothing is sent anywhere. Every report this makes is deleted through the
 * endpoint at the end, which also tests the deleting.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { api, apiUntil, BASE, DATA, ROOT, sleep } = require("./lib");

/* A zip reader, from the central directory backwards. Enough for a store or
   deflate archive with no zip64, which is what includes\backup.php writes. */
function unzip(file) {
  const b = fs.readFileSync(file);
  let end = b.length - 22;
  while (end >= 0 && b.readUInt32LE(end) !== 0x06054b50) { end--; }
  if (end < 0) { throw new Error("no end-of-central-directory: not a zip"); }
  const count = b.readUInt16LE(end + 10);
  let at = b.readUInt32LE(end + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(at) !== 0x02014b50) { throw new Error("central directory entry " + i + " is malformed"); }
    const method = b.readUInt16LE(at + 10);
    const csize = b.readUInt32LE(at + 20);
    const nlen = b.readUInt16LE(at + 28);
    const offset = b.readUInt32LE(at + 42);
    const name = b.slice(at + 46, at + 46 + nlen).toString("utf8");
    const lnlen = b.readUInt16LE(offset + 26);
    const lxlen = b.readUInt16LE(offset + 28);
    const from = offset + 30 + lnlen + lxlen;
    const body = b.slice(from, from + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(body) : body;
    at += 46 + nlen + b.readUInt16LE(at + 30) + b.readUInt16LE(at + 32);
  }
  return out;
}

const stateOf = (checks, key) => (checks.find((c) => c.key === key) || {}).state;
const saysOf = (checks, key) => (checks.find((c) => c.key === key) || {}).says || "";

module.exports = async function (b, check) {
  /* ---- the checks, before anything is made ------------------------------ */
  const res = await api("api/report.php");
  // Reports are not in run.js's Guard (they are files this feature owns, in a
  // folder of its own), so the test deletes what IT made and nothing else.
  const before = new Set((res.reports || []).map((r) => r.name));
  check("the checks run on the way in", Array.isArray(res.checks) && res.checks.length >= 6);
  check("every one says what it is and how bad it is",
    res.checks.every((c) => c.key && c.label && c.says && /^(bad|warn|ok|info)$/.test(c.state)));
  check("it names the build", /^Xsegon \d+(\.\d+){1,3} /.test(saysOf(res.checks, "build")));
  check("and what was changed from the release, which a checkout has no list for", /^not a release/.test(saysOf(res.checks, "changed")));
  check("it proves it can write, rather than assuming", stateOf(res.checks, "write"), "ok");
  check("and leaves no probe file behind", fs.existsSync(path.join(DATA, "write-check.json")), false);
  check("the library is found", stateOf(res.checks, "library"), "ok");
  check("every emulator is on disk", stateOf(res.checks, "emulators"), "ok");
  check("the worst state is the headline", ["bad", "warn", "ok"].includes(res.worst));

  /* A missing ROM folder is the commonest cause of a launch doing nothing.
     Whichever way it is right now, the sentence has to match the state. */
  const roms = res.checks.find((c) => c.key === "roms");
  if (roms.state === "bad") {
    check("an unplugged ROM drive is called out as bad", /NOT THERE/.test(roms.says));
    check("and says what to do about it", /plug it in/i.test(roms.says));
  } else {
    check("a ROM folder that is there is not called a problem", roms.state, "ok");
  }

  /* ---- make one --------------------------------------------------------- */
  const made = await api("api/report.php", { action: "make" });
  check("a report is made", made.ok && !!made.made);
  const zip = path.join(res.folder, made.made.name);
  check("named so it sorts by when it was made", /^xsegon-report-\d{4}-\d\d-\d\d-\d{4}\.zip$/.test(made.made.name));
  check("and it is on disk", fs.existsSync(zip));
  check("small enough to send", made.made.bytes < 12 * 1024 * 1024);

  const got = unzip(zip);
  const names = Object.keys(got);
  check("an outside reader can open it", names.length >= 5);
  check("report.txt is in it", names.includes("report.txt"));
  check("so is a library summary", names.includes("library-summary.txt"));
  check("so is what PHP is running", names.includes("php.txt"));
  check("so are the settings", names.includes("settings.json"));
  check("and at least one day of log", names.some((n) => /^log\/\d{4}-\d\d-\d\d\.log$/.test(n)));

  /* What must NOT be in it. This is the rule that lets someone send it. */
  check("no ROM, picture or video went in",
    names.filter((n) => /\.(zip|7z|iso|cue|bin|n64|z64|sfc|nes|png|jpe?g|webp|mp4|webm|avi)$/i.test(n)), []);
  check("and not the whole library.json, which is megabytes", names.includes("library.json"), false);

  const txt = got["report.txt"].toString("utf8");
  check("report.txt leads with the version", /^XSEGON DIAGNOSTICS REPORT\n=+\nMade [\d-]+ [\d:]+\nXsegon \d/.test(txt));
  check("it lists every check", res.checks.every((c) => txt.includes(c.label)));
  check("it says what is in the zip", txt.includes("WHAT IS IN THIS ZIP"));
  check("and lists each file it carries", names.filter((n) => n !== "report.txt").every((n) => txt.includes(n)));
  check("it says what is deliberately left out", /WHAT IS NOT[\s\S]*ROMs/.test(txt));
  check("it warns that your folder names are in it", /cannot answer a path question/.test(txt));

  /* The headline has to agree with the checks, in both directions. */
  const bad = res.checks.filter((c) => c.state === "bad");
  if (bad.length) {
    check("a bad check is the first thing it says", /START HERE/.test(txt.split("EVERY CHECK")[0]));
    check("and it is named up there", txt.split("EVERY CHECK")[0].includes(bad[0].label));
  } else {
    check("with nothing wrong it does not invent a worry", /START HERE/.test(txt), false);
  }

  const summary = got["library-summary.txt"].toString("utf8");
  check("the summary counts games per console", /Console\s+Games\s+No cover\s+No launch/.test(summary));
  check("and names the ones that cannot launch", /Games with no launch command/.test(summary));
  // Each game's file by name (which copy it is), never its folder.
  const file0 = (((await api("api/library.php?grouped=0")).games || []).find((g) => g.file) || {}).file;
  const each = summary.split("Every game and its file, by console:")[1] || "";
  check("and every game with its file's name, never its folder",
    [each !== "", !file0 || each.includes("  =  " + file0), /[A-Za-z]:\\/.test(each)], [true, true, false]);

  /* ---- what it refuses -------------------------------------------------- */
  const badName = await api("api/report.php", { action: "remove", name: "../../boot.php" });
  check("it will not delete a file it did not write", badName.ok, false);
  const notThere = await api("api/report.php", { action: "remove", name: "xsegon-report-1999-01-01-0000.zip" });
  check("nor one that is not there", notThere.ok, false);
  const badGet = await fetch(BASE + "/api/report.php?get=" + encodeURIComponent("../settings.json"));
  check("and it will not hand out a file outside its own folder", badGet.status, 400);

  /* The download really is the zip, byte for byte. */
  const dl = await fetch(BASE + "/api/report.php?get=" + encodeURIComponent(made.made.name));
  check("the download answers as a zip", dl.headers.get("content-type"), "application/zip");
  check("offered as a file to save", /attachment; filename="xsegon-report-/.test(dl.headers.get("content-disposition") || ""));
  const body = Buffer.from(await dl.arrayBuffer());
  check("and it is the same file", body.equals(fs.readFileSync(zip)));

  /* ---- the screen -------------------------------------------------------- */
  await b.goto(BASE + "/");
  await b.enterConsole();                   // into a console: the wall has no menu bar
  await b.setView("grid");                // the bar shows in list and grid only
  await b.openBar("help");
  await b.menuItem(/Report a problem/);
  check("Help opens it", await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "REPORT A PROBLEM"`, 8000));
  check("the checks are on screen", await b.ev(`document.querySelectorAll("#editor .rp-check").length`), res.checks.length);
  check("worst first", await b.ev(`(n => !n || n.classList.contains(${JSON.stringify(res.worst)}))(document.querySelector("#editor .rp-check"))`));
  check("with a verdict in words", /genuinely wrong|worth a look|Every check passed/.test(
    await b.ev(`(document.querySelector("#editor .rp-verdict") || {}).textContent || ""`)));
  check("the report made above is listed", await b.ev(`[...document.querySelectorAll("#editor .bk-id")].some(n => n.textContent.includes(${JSON.stringify(made.made.name)}))`));
  check("with a way to save a copy", await b.ev(`!!document.querySelector("#editor .bk-acts a[download]")`));
  await b.key("Escape");
  await sleep(500);

  /* ---- what a report can tell without the log being read by hand -------------
     Sittings, controllers found, what the PC was busy with, when a RetroArch
     opened by itself closed. Each is only a log line, so also checked with logging off. */
  const { execFileSync, spawn } = require("child_process");
  const os = require("os");
  const phpExe = ((await api("api/status.php")).build || {}).phpExe;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xs-report-"));
  const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const ps = (args) => execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass"].concat(args), { encoding: "utf8", windowsHide: true });
  const tail = async (n) => ((await api("api/log.php?tail=" + (n || 400))).lines || []);
  try {
    /* The sittings, on the reader itself (tests\sittings-probe.php) over two
       day logs written here, so each rule has a line that tries it. */
    const logs = path.join(tmp, "logs");
    fs.mkdirSync(logs);
    fs.writeFileSync(path.join(logs, "2026-01-05.log"), [
      "09:00:00.000 S VER  Xsegon test",
      "09:00:01.000 S REQ  GET /api/status.php 20ms 200",
      "09:00:02.000 S WIN  opened the app window with chrome.exe 1 (process 1), full screen",
      "09:00:04.000 P BOOT page app view=list 1920x1080 browser=Chrome 1 screen=1920x1080 scale=100%",
      "09:00:04.100 P BOOT start-up took 2100ms: the page 1500ms",
      "09:00:05.000 S PAD  Windows lists no game controller plugged in (as the page opened)",
      "09:00:10.000 P CLK  Play",
      "09:00:11.000 S LNCH run Tetris",
      "09:30:00.000 S LNCH end Tetris 1729s exit 0",
      "09:30:05.000 P KEY  ArrowDown list 1/3",
      "09:30:06.000 P ED   controller check",
      "09:30:20.000 P PAD  check: closed after 14 s: no controller pressed a button, 7 keyboard keys pressed",
      "09:30:21.000 P ED   close controller check",
      "09:31:00.000 P ERR  GET status.php?beat=1 48741ms FAIL bad response",
      "09:31:30.000 P BOOT leave",
      "09:31:31.000 S WIN  the app window has been closed for 12s: ending the server (process 2)",
      "09:37:00.000 S REQ  GET /api/status.php 20ms 200",
      "09:37:02.000 S WIN  opened the app window with chrome.exe 1 (process 3), full screen",
      "09:37:04.000 P BOOT page app view=list 1920x1080 browser=Chrome 1 screen=1920x1080 scale=100%",
      "09:37:04.100 P BOOT start-up took 900ms: the page 500ms",
      "09:37:10.000 P PAD  seen: Xbox 360 Controller (XInput STANDARD GAMEPAD) | layout standard | 17 buttons, 4 axes | read as xbox",
      "09:37:11.000 S PAD  Windows lists 1 game controller plugged in: 045e:0b13, read the Xbox way (as the page opened)",
      "09:37:20.000 S WDOG restarting the app window: no heartbeat",
      "09:37:25.000 S WIN  opened the app window with chrome.exe 1 (process 4), full screen",
      "09:37:27.000 P BOOT page app view=list 1920x1080 browser=Chrome 1 screen=1920x1080 scale=100%",
      "09:38:00.000 S BUSY the PC while running.php took 4106 ms: processor 96% busy",
      "09:38:30.000 P BOOT leave",
    ].join("\n") + "\n");
    fs.writeFileSync(path.join(logs, "2026-01-06.log"), [
      "14:00:00.000 P BOOT page tab view=grid 1920x1080 browser=Chrome 1 screen=1920x1080 scale=100%",
      "14:00:01.000 P CLK  xsegon",
      "14:05:01.000 P LIVE still here [*70]",
      "14:09:00.000 P CLK  btn-settings",
      "14:20:30.000 P CLK  xsegon",
      "14:20:31.000 P NAV  details Contra",
    ].join("\n") + "\n");
    const probe = (flags) => {
      const out = execFileSync(phpExe, flags.concat([path.join(__dirname, "sittings-probe.php"), logs]),
        { encoding: "utf8", env: Object.assign({}, process.env, { XSEGON_DATA: DATA }), windowsHide: true });
      return JSON.parse(out.slice(out.indexOf('{"sittings"')));
    };
    const told = probe([]);
    const s = told.sittings;
    check("each time Xsegon was open is told as a sitting", s.length, 4);
    check("a game half an hour long does not end the sitting it was played in",
      [s[0].plays.map((p) => [p.title, p.seconds, p.exit]), Math.round(s[0].to - s[0].from)], [[["Tetris", 1729, 0]], 1891]);
    check("a window opened six minutes after the last one closed is a new sitting, and the start's own first line is its own",
      Math.round(s[1].from - s[0].to), 329);
    check("a window the watchdog restarted is the same sitting, and the restart is counted", [s[1].restarts, s[1].page], [1, 5]);
    check("ten minutes with nothing written end a sitting in a browser tab, which has no window line", [s[2].clicks, s[3].clicks, Object.keys(s[3].details)], [2, 1, ["Contra"]]);
    check("a sitting knows what was pressed, opened and went wrong in it",
      [s[0].clicks, s[0].keys, s[0].opened, s[0].trouble, s[1].busy], [1, 1, { "controller check": 1 }, { ERR: 1 }, 1]);
    check("and whether a controller pressed a button, beside what Windows listed as plugged in",
      [Object.keys(s[0].pads), Object.keys(s[0].windows), Object.keys(s[1].pads), Object.keys(s[1].windows)],
      [[], ["Windows lists no game controller plugged in"], ["Xbox 360 Controller (XInput STANDARD GAMEPAD)"],
       ["Windows lists 1 game controller plugged in: 045e:0b13, read the Xbox way"]]);
    check("in words: when, how long, the start-up, the game", /^1\.\s+5 Jan 09:00 to 09:31 \(32 min\)\. Start-up 2\.1 s\.\n\s+Played\s+1 time: Tetris 29 min\n/m.test(told.text), true);
    check("in words: no controller", /^\s+Controller\s+none pressed a button\. Windows lists no game controller plugged in$/m.test(told.text), true);
    check("in words: a controller, and a slow PC",
      [/^\s+Controller\s+pressed a button: Xbox 360 Controller \(XInput STANDARD GAMEPAD\)\. Windows lists 1 game controller plugged in: 045e:0b13, read the Xbox way$/m.test(told.text),
       /^\s+Trouble\s+1 BUSY /m.test(told.text), /The window was restarted 1 time\./.test(told.text)], [true, true, true]);
    check("the controllers that pressed a button are read off the same logs", told.seen, ["Xbox 360 Controller (XInput STANDARD GAMEPAD)"]);
    check("with no page line to read, that is said and no sitting is made up", /None can be told/.test(told.none), true);

    /* What Windows lists as plugged in. This test server's PHP has no FFI, so
       the function is asked directly with it loaded where the PHP has it. */
    if (!told.ffi) {
      check("a PHP that cannot ask Windows says so, and answers nothing", [told.pads, /^Windows could not be asked which game controllers are plugged in \(/.test(told.words)], [null, true]);
    }
    if (told.ffi || fs.existsSync(path.join(path.dirname(phpExe), "ext", "php_ffi.dll"))) {
      const w = told.ffi ? told : probe(["-d", "extension=ffi", "-d", "ffi.enable=1"]);
      check("asked directly, Windows answers with its list of game controllers", [w.ffi, Array.isArray(w.pads)], [true, true]);
      check("each with its maker and product numbers", (w.pads || []).every((p) => /^[0-9a-f]{4}$/.test(p.vendor) && /^[0-9a-f]{4}$/.test(p.product) && typeof p.xbox === "boolean"), true);
      check("said as one line", /^Windows lists (no game controller|1 game controller|\d+ game controllers) plugged in/.test(w.words), true);
    }
    const asked = await api("api/pad-plugged.php?for=check");
    check("the page can ask for that line", [asked.ok, typeof asked.words, Array.isArray(asked.pads)], [true, "string", true]);
    /* The picture's words wait on the answer, so a server that cannot ask
       Windows itself asks through a helper. The page-open ask stays cheap. */
    if (!told.ffi && fs.existsSync(path.join(path.dirname(phpExe), "ext", "php_ffi.dll"))) {
      check("for the controller picture, a server that cannot ask Windows itself asks through the helper",
        [asked.asked, /^Windows lists (no game controller|1 game controller|\d+ game controllers) plugged in/.test(asked.words)], [true, true]);
      const cheap = await api("api/pad-plugged.php?for=page");
      check("as a page opens it asks only itself, and says so when it cannot", [cheap.asked, /^Windows could not be asked /.test(cheap.words)], [false, true]);
      check("the report's own check asks through the helper too", /^Windows lists /.test(saysOf((await api("api/report.php")).checks, "pads")), true);
    }
    check("and it goes in the log with what asked for it", (await tail()).some((l) => / S PAD\s+Windows (lists|could not be asked) .* \(as the controller picture opened\)$/.test(l)), true);

    /* The report carries both. */
    check("the checks say what is known of controllers", [stateOf(res.checks, "pads"), /^Windows (lists|could not be asked) /.test(saysOf(res.checks, "pads")),
      /pressed a button in Xsegon/.test(saysOf(res.checks, "pads"))], ["info", true, true]);
    check("report.txt has the sittings under the checks", txt.indexOf("SITTINGS: EACH TIME XSEGON WAS OPEN") > txt.indexOf("EVERY CHECK"), true);

    /* ---- a choked PC: what it is busy with (bin\busy.ps1) -------------------- */
    const dry = await api("api/busy.php", { check: "running.php", ms: 4106 });
    check("on a test copy a slow check starts no look at the PC unless the test asks", [dry.ok, dry.looked, dry.why], [true, false, "a test copy"]);
    const looked = await api("api/busy.php", { check: "running.php", ms: 4106, look: true });
    check("asked for, the look is started", [looked.ok, looked.looked], [true, true]);
    check("and writes one BUSY line: how busy the processor is, with what, and what is reading and writing",
      !!(await apiUntil(async () => (await tail()).some((l) =>
        / S BUSY the PC while running\.php took 4106 ms: processor \d+% busy.*(most read and written: |nothing reading or writing much).*the look took [\d.]+s$/.test(l)), 40000)), true);

    /* ---- a RetroArch opened by itself: when it is closed (bin\ra-watch.ps1) ---
       Never RetroArch itself: a copy of Windows' own waitfor.exe under another
       name stands in, sits for a few seconds and ends. */
    const standin = path.join(tmp, "xs-standin-ra.exe");
    fs.copyFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "waitfor.exe"), standin);
    const watchData = path.join(tmp, "watch-data");
    const watch = (extra) => ps(["-File", path.join(ROOT, "bin", "ra-watch.ps1"), "-Exe", standin, "-Since", String(Math.floor(Date.now() / 1000)), "-DataDir", watchData].concat(extra));
    const watchLog = () => (fs.existsSync(path.join(watchData, "log")) ? fs.readdirSync(path.join(watchData, "log")).map((f) => fs.readFileSync(path.join(watchData, "log", f), "utf8")).join("") : "");
    spawn(standin, ["/T", "3", "XsNobodySendsThis"], { stdio: "ignore", windowsHide: true });
    watch(["-Log"]);
    check("the program it opened is watched, and its closing written with how long it was open",
      /^\d\d:\d\d:\d\d\.\d{3} S RA   closed after \d+ s \(opened with no game\)\n$/.test(watchLog()), true);
    spawn(standin, ["/T", "2", "XsNobodySendsThis"], { stdio: "ignore", windowsHide: true });
    check("without the log switch the same watch writes nothing", [/closed after \d+ s/.test(watch([])), watchLog().trim().split("\n").length], [true, 1]);

    /* ---- the scripts that write their own lines honour the switch too ---------
       The window, the watchdog, the fast lane and the thumbnail build write
       into data\log by themselves (bin\xslog.ps1 asks the setting for them). */
    const fake = path.join(tmp, "root");
    fs.mkdirSync(path.join(fake, "data"), { recursive: true });
    const set = (text) => fs.writeFileSync(path.join(fake, "data", "settings.json"), text);
    const line = () => ps(["-Command", ". " + lit(path.join(ROOT, "bin", "xsbrowser.ps1")) + "; Write-XsegonLine " + lit(fake) + " 'WIN' 'a line from a script'"]);
    set('{"debug":{"logging":false,"logMoves":true}}');
    line();
    check("with logging off a script's own line is not written, nor a log folder made", fs.existsSync(path.join(fake, "data", "log")), false);
    set('{"debug":{"logging":true}}');
    line();
    const fakeLog = path.join(fake, "data", "log");
    check("with it on the line is written", fs.existsSync(fakeLog) && /S WIN  a line from a script\n$/.test(fs.readFileSync(path.join(fakeLog, fs.readdirSync(fakeLog)[0]), "utf8")), true);
    set("{ this is not json");
    check("settings that will not read, or are not there, count as on: the server's own rule",
      ps(["-Command", ". " + lit(path.join(ROOT, "bin", "xslog.ps1")) + "; Test-XsegonLogging " + lit(path.join(fake, "data")) + "; Test-XsegonLogging " + lit(path.join(tmp, "nowhere"))]).trim().split(/\r?\n/), ["True", "True"]);
    check("every script that writes into the log itself asks the setting or is handed it",
      fs.readdirSync(path.join(ROOT, "bin")).filter((f) => /\.ps1$/.test(f)).filter((f) => {
        const src = fs.readFileSync(path.join(ROOT, "bin", f), "utf8");
        return /AppendAllText\(\$file/.test(src) && !/Test-XsegonLogging|if \(-not \$Log\) \{ return \}/.test(src);
      }), []);

    /* ---- a still-alive check that takes seconds asks for the look, once a minute */
    const slowDown = (n) => b.ev(`(() => { const real = window.fetch; window.__busy = []; window.__slow = ${n};
      window.fetch = function (u, o) { const s = String(u);
        if (s.indexOf("api/busy.php") >= 0) { window.__busy.push(JSON.parse(o.body)); return Promise.resolve(new Response('{"ok":true}')); }
        if ((s.indexOf("api/running.php") >= 0 || s.indexOf("api/status.php") >= 0) && window.__slow > 0) { window.__slow--; return new Promise((go) => setTimeout(() => go(real.call(window, u, o)), 3300)); }
        return real.call(window, u, o); }; })()`);
    await b.goto(BASE + "/");
    await slowDown(2);
    check("a still-alive check that takes over three seconds asks the server what the PC is busy with", await b.until(`window.__busy.length`, 1, 14000), 1);
    check("saying which check it was and how long it took", await b.ev(`[/^(running|status)\\.php$/.test(window.__busy[0].check), window.__busy[0].ms >= 3000]`), [true, true]);
    await b.until(`window.__slow`, 0, 14000);
    await sleep(4200);
    check("and a second slow one inside the same minute does not ask again", await b.ev(`window.__busy.length`), 1);

    /* ---- one still-alive check at a time: none is sent while one is out, and
            one that gets no answer is given up on (30 s, cut short here) ---- */
    await b.goto(BASE + "/");
    await b.ev(`(() => { const real = window.fetch; window.__sent = 0; window.__answered = 0; window.__hold = 6000;
      window.fetch = function (u, o) { const s = String(u);
        if (s.indexOf("api/running.php") < 0 && s.indexOf("api/status.php") < 0) { return real.call(window, u, o); }
        window.__sent++;
        return new Promise((go) => setTimeout(() => { window.__answered++; go(real.call(window, u, o)); }, window.__hold)); }; })()`);
    await b.until(`window.__sent`, 1, 9000);
    await sleep(5200);
    check("while a still-alive check is out, no other is sent", await b.ev(`[window.__sent, window.__answered]`), [1, 0]);
    check("once it is answered the next one goes", await b.until(`window.__sent`, 2, 9000), 2);
    await b.ev(`import("/js/status.js").then((m) => { m.pollTuning(1500); return true; })`);
    check("one that gets no answer in time is given up on, and another is sent", [await b.until(`window.__sent`, 3, 7000), await b.ev(`window.__answered`)], [3, 1]);
    await b.ev(`(() => { window.__hold = 0; return import("/js/status.js").then((m) => { m.pollTuning(30000); return true; }); })()`);

    /* ---- logging off: none of it is written, and nothing is started for it ---- */
    const wasOn = ((await api("api/settings.php")).settings.debug || {}).logging !== false;
    const logFile = (await api("api/log.php?tail=20")).file;
    try {
      await api("api/settings.php", { debug: { logging: false } });
      await sleep(400);
      const mark = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
      const quiet = await api("api/busy.php", { check: "running.php", ms: 9999, look: true });
      check("with logging off a slow check starts no look at all", [quiet.ok, quiet.looked, quiet.why], [true, false, "logging is off"]);
      await api("api/pad-plugged.php?for=page");
      const off = await api("api/report.php");
      check("the report says logging is off, and that presses are then not known", [stateOf(off.checks, "logging"), /With logging off/.test(saysOf(off.checks, "pads"))], ["warn", true]);
      await b.goto(BASE + "/");
      await slowDown(1);
      await b.until(`window.__slow`, 0, 9000);
      await sleep(4200);
      check("the page asks for no look either", await b.ev(`window.__busy.length`), 0);
      await b.ev(`window.dispatchEvent(new Event("pagehide"))`);
      await sleep(900);
      const added = fs.existsSync(logFile) ? fs.readFileSync(logFile).subarray(mark).toString("utf8") : "";
      check("and not one line of the page's or of these requests reaches the day log",
        added.split("\n").filter((l) => /^\d\d:\d\d:\d\d\.\d{3} (P |S (REQ|PAD|BUSY|RPT|LANE|SET)\b)/.test(l)), []);
    } finally {
      await api("api/settings.php", { debug: { logging: wasOn } });
      await b.goto(BASE + "/");
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /* ---- tidy up: the ones this made go, through the endpoint --------------- */
  for (const r of (await api("api/report.php")).reports) {
    if (!before.has(r.name)) { await api("api/report.php", { action: "remove", name: r.name }); }
  }
  const left = (await api("api/report.php")).reports.map((r) => r.name);
  check("the test left none of its own behind", left.filter((n) => !before.has(n)), []);
  check("and kept the ones that were already there", left.length, before.size);
};
