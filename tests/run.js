// Xsegon tests - run them all.
//
//     node tests\run.js             every group
//     node tests\run.js menus own   only those groups
//
//     node tests\run.js --live      against the Xsegon on 8099 instead
//
// What it needs: PHP and Chrome or Edge on the machine. Nothing to install.
// A run starts a server of its OWN, on a copy of data\ (tests\sandbox.js),
// and never touches the Xsegon on 8099, so Xsegon can be played meanwhile.
// --live runs against the real server: its groups add and remove games there
// and its Guard undoes whatever a person changes meanwhile, so say so first.
//
// What it does: opens one headless browser, drives the real page through
// every part of the app, and prints pass or fail per check. A failing check
// leaves a screenshot in tests\out. The data files a run can touch are
// snapshotted first and restored however the run ends, so a crash mid-test
// cannot leave a favourite flipped or a test game behind.
"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./lib");
const { OUT, api, Browser, Guard, makeCheck, sleep, sleepBill } = lib;
const sandbox = require("./sandbox");

const GROUPS = {
  modules: "./t-modules",
  api: "./t-api",
  views: "./t-views",
  menus: "./t-menus",
  editing: "./t-editing",
  own: "./t-own",
  log: "./t-log",
  states: "./t-states",
  settings: "./t-settings",
  backup: "./t-backup",
  cores: "./t-cores",
  cheats: "./t-cheats",
  saves: "./t-saves",
  writes: "./t-writes",
  report: "./t-report",
  offline: "./t-offline",
  scan: "./t-scan",
  scanpassed: "./t-scanpassed",
  news: "./t-news",
  deleted: "./t-deleted",
  steam: "./t-steam",
  filters: "./t-filters",
  sameviews: "./t-sameviews",
  tags: "./t-tags",
  screens: "./t-screens",
  setup: "./t-setup",
  steamvid: "./t-steamvid",
  screenscraper: "./t-screenscraper",
  achievements: "./t-achievements",
  videopack: "./t-videopack",
  archivevid: "./t-archivevid",
  arcadevid: "./t-arcadevid",
  cheatlists: "./t-cheatlists",
  runcheck: "./t-runcheck",
  wanted: "./t-wanted",
  paths: "./t-paths",
  boot: "./t-boot",
  bios: "./t-bios",
  filecheck: "./t-filecheck",
  hacks: "./t-hacks",
  hackof: "./t-hackof",
  accompanied: "./t-accompanied",
  texpacks: "./t-texpacks",
  notes: "./t-notes",
  unpack: "./t-unpack",
  libretro: "./t-libretro",
  gamesdb: "./t-gamesdb",
  box: "./t-box",
  reader: "./t-reader",
  letters: "./t-letters",
  wired: "./t-wired",
  pads: "./t-pads",
  emuadd: "./t-emuadd",
  emumove: "./t-emumove",
  phone: "./t-phone",
  jobs: "./t-jobs",
  themes: "./t-themes",
  more: "./t-more",
  fanprojects: "./t-fanprojects",
  extensions: "./t-extensions",
  newversion: "./t-newversion",
  update: "./t-update",
  big: "./t-big",    // a library of 40,000 made-up games: asked for by name, never part of a full run (t-big.js)
  e2e: "./t-e2e",    // last: the one group that starts a real game (t-e2e.js says why)
};
// Private groups (private\tests\t-<name>.js), only where that folder is: before big and e2e.
{
  const dir = path.join(__dirname, "..", "private", "tests");
  const own = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => /^t-([a-z0-9-]+)\.js$/.exec(f)).filter(Boolean) : [];
  const last = { big: GROUPS.big, e2e: GROUPS.e2e };
  delete GROUPS.big; delete GROUPS.e2e;
  for (const m of own) { if (!GROUPS[m[1]]) { GROUPS[m[1]] = path.join(dir, m[0]); } }
  Object.assign(GROUPS, last);
}
// data files a run may write; all put back afterwards
const PROTECTED = ["favourites.json", "my-ratings.json", "tags.json", "fix-marks.json", "overrides.json", "hidden.json", "art-hidden.json", "accompanied.json", "accompanied-told.json", "local-games.json", "scanned-games.json", "sessions.jsonl", "settings.json", "ra-append.cfg", "cores.json", "emulators.json", "cheats.json", "cheats-used.json", "pad-remaps.json", "player-remaps.json", "game-remaps.json", "ra-hotkeys.json", "game-hotkeys.json", "library-seen.json", "messages.json", "deleted.json", "setup-job.json", "setup.json", "pick-folder.json", "steamvid-job.json", "steamvid-none.json", "screenscraper-job.json", "screenscraper-none.json", "damaged.json", "launch-results.json", "launch-log.jsonl", "running.json", "last-error.json", "wanted.json", "manual-places.json", "filecheck.json", "unpacked.json", "unpack-job.json", "emumove.json", "emumove-job.json", "media-copy.json", "videopack.json", "videopack-job.json", "thumbs-job-box.json", "thumbs-job-logo.json", "texpacks-job.json", "texpacks.json", "extensions.json", "extensions-job.json"];

(async () => {
  const LIVE = process.argv.includes("--live");
  const want = process.argv.slice(2).filter((a) => GROUPS[a]);
  const names = want.length ? want : Object.keys(GROUPS).filter((g) => g !== "big");   // big only when it is named
  const unknown = process.argv.slice(2).filter((a) => !GROUPS[a] && a !== "--live");
  if (unknown.length) { console.log("no such group: " + unknown.join(", ") + " (have: " + Object.keys(GROUPS).join(", ") + ")"); process.exit(2); }

  // A server of the run's own, on a copy of data\ (sandbox.js). Stopped and
  // its copy removed however the run ends, a Ctrl+C included.
  let own = null;
  if (!LIVE) {
    try { own = await sandbox.start(); } catch (e) { console.log(String(e.message || e)); process.exit(2); }
    lib.useTarget(own.url, own.data);
    process.on("exit", () => own.stop());
    process.on("SIGINT", () => process.exit(130));
    console.log("on a server of its own at " + own.url + ", a copy of data\\ made in " + (own.ms / 1000).toFixed(1) + "s; the Xsegon on 8099 is not touched");
  } else {
    console.log("LIVE: against the Xsegon at " + lib.BASE + "; anything changed there during the run is put back at the end");
  }
  const BASE = lib.BASE;

  // the server first: everything else is pointless without it
  let st;
  try { st = await api("api/status.php"); } catch (e) { st = null; }
  if (!st || !st.ok) {
    console.log("Xsegon is not answering at " + BASE + ". Start it (start.ps1) and run this again.");
    process.exit(2);
  }

  fs.mkdirSync(OUT, { recursive: true });
  const guard = new Guard(PROTECTED);
  const settingsBefore = (await api("api/settings.php"));
  const view0 = (settingsBefore.settings || settingsBefore).view;
  /* Every run starts from the same place, whatever this machine's own view
     is: Systems first, on a wheel. b.goto() does the same on every page visit
     (on a list Enter LAUNCHES the chosen game, lib.js says more); this is for
     the API-only groups that never navigate. The Guard puts the real
     settings back afterwards.

     And every game in one page: the library answers at most "Games shown at
     once" games, and past that a game a test had just added sorted off the
     end of the page and could not be found.

     And the list and the grid as they come: the views group reads the
     table's headers, looks for the sorted one's arrow and selects columns
     from there, so columns, a sort or a sidebar of the person's own would
     turn its checks red with nothing broken. */
  await api("api/settings.php", { view: { default: "wheel", systemsFirst: true, systemsStyle: "wheel", pageSize: 2000,
                                          listColumns: ["title", "platform", "genre", "seconds"], listWidths: {},
                                          sort: "title", sortReverse: false, groupHeaders: false, addedPeriod: "month", changedPeriod: "week",
                                          gridImage: "box", gridSize: 100, shelfSize: 100, rowsSize: 100, heroPanel: true, sidebar: false,
                                          // every game shown, under its title alone (the wired group sets its own)
                                          showMissingArt: true, showPlatformInTitle: false },
                                  // Play starts at once, A confirms and the legend follows the pad: what every group's Enter and A assume
                                  launch: { confirmBeforeLaunch: false }, controller: { confirmButton: "a", buttonNames: "auto", padJobs: {} },
                                  // The look it comes with: the settings group's colour checks read its accent
                                  feel: { theme: "xsegon" },
                                  // The X asks before it closes, as a new copy's does: the settings group
                                  // presses it and reads the question
                                  window: { confirmClose: true },
                                  // Keep a log? answered, or every group's page opens under it (the setup group asks it itself)
                                  debug: { asked: { logging: true } } });
  /* And RetroArch told nothing of this machine's own. A console's buttons, a
     game's own buttons, and the menu, quit and turbo choices each add lines
     to what a launch appends, and the cheats and states groups count those
     lines one by one. The copy starts with none; the groups that test them
     set their own and take them away. Against the real Xsegon only the three
     choices are cleared, through the API, and the Guard puts every file back. */
  const RA_CHOICES = ["pad-remaps.json", "player-remaps.json", "game-remaps.json", "ra-hotkeys.json", "game-hotkeys.json"];
  if (own) {
    for (const f of RA_CHOICES) { fs.rmSync(path.join(own.data, f), { force: true }); }
  } else {
    await api("api/ra-hotkeys.php", { menu: null, quit: null, turbo: null });
  }
  /* XSEGON_TEST_ROMS_OUT=1: run as if the ROM drive were unplugged. The test
     copy's ROM folder points somewhere that is not there, so the checks that
     need the drive (lib.js romDrive) prove they step aside, not go red. */
  if (process.env.XSEGON_TEST_ROMS_OUT === "1") {
    await api("api/settings.php", { paths: { romRoot: "Z:\\XSEGON-TEST-NO-DRIVE" } });
    console.log("(as if the ROM drive were out: the test copy's ROM folder is Z:\\XSEGON-TEST-NO-DRIVE)");
  }

  const b = new Browser();
  let total = 0, failed = 0;
  const t0 = Date.now();
  try {
    await b.start();
    for (const name of names) {
      const report = [];
      const check = makeCheck(report);
      const started = Date.now();
      const sleptBefore = sleepBill.total;
      let crashed = null;
      b.errors.length = 0;
      b.screenFaults.length = 0;
      try {
        await require(GROUPS[name])(b, check);
      } catch (e) {
        crashed = e;
      }
      if (b.errors.length) { check("no script errors in the page", b.errors.length === 0 ? true : b.errors.join(" | "), true); }
      // Every group is held to the window rules (lib.js, SCREEN_RULES).
      if (b.screenFaults.length) { check("windows open only when they should", b.screenFaults.join(" | "), true); }
      const bad = report.filter((r) => !r.ok);
      total += report.length; failed += bad.length + (crashed ? 1 : 0);
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      // How much of that was fixed waiting: the part a faster suite can take back.
      const slept = ((sleepBill.total - sleptBefore) / 1000).toFixed(1);
      // At least one space after the name: tests\lanes.js reads the name and the count apart.
      console.log((bad.length || crashed ? "FAIL " : "ok   ") + name.padEnd(8) + " " + (report.length - bad.length) + "/" + report.length + "  " + secs + "s  (slept " + slept + "s)");
      for (const r of bad) {
        console.log("       x " + r.name + (r.want !== undefined ? "   got " + JSON.stringify(r.got) + ", wanted " + JSON.stringify(r.want) : ""));
      }
      if (crashed) { console.log("       crashed: " + (crashed.stack || crashed).toString().split("\n").slice(0, 3).join("\n         ")); }
      // What the browser's console said last, for a failure the page never
      // threw about (a module that would not load stops everything quietly).
      if ((bad.length || crashed) && b.consoleLog.length) {
        console.log("       the page's console, last " + Math.min(6, b.consoleLog.length) + ":");
        for (const line of b.consoleLog.slice(-6)) { console.log("         " + line); }
      }
      b.consoleLog.length = 0;
      if (bad.length || crashed) { try { await b.shot("fail-" + name); console.log("       screenshot: tests\\out\\fail-" + name + ".png"); } catch (e) { /* no shot */ } }
    }
  } finally {
    // the page might hold a dialog or a game open; go home before restoring
    try { await b.goto(BASE + "/?test-done=1"); } catch (e) { /* fine */ }
    await b.stop();
    guard.restore();
    // settings.json is restored byte for byte above; this also tells a
    // still-open real window nothing, since it reads on load
    if (LIVE) await api("api/settings.php", { view: { default: view0.default, sort: view0.sort, systemsStyle: view0.systemsStyle, sortReverse: !!view0.sortReverse, groupHeaders: !!view0.groupHeaders, gridImage: view0.gridImage || "box", listColumns: view0.listColumns, listWidths: view0.listWidths || {} } });
  }
  console.log("");
  console.log((failed ? "FAILED: " : "passed: ") + (total - failed) + " of " + total + " checks in " + ((Date.now() - t0) / 1000).toFixed(0) + "s"
              + ", of which " + (sleepBill.total / 1000).toFixed(0) + "s was fixed sleeps");
  // The bill by line, biggest first, so the next lazy sleep is easy to find.
  const sites = Object.entries(sleepBill.sites).sort((a, b) => b[1] - a[1]);
  fs.writeFileSync(path.join(OUT, "sleeps.json"), JSON.stringify({ at: new Date().toISOString(), totalMs: sleepBill.total, sites: Object.fromEntries(sites) }, null, 1));
  console.log("slowest sleeps: " + sites.slice(0, 4).map(([k, v]) => k + " " + (v / 1000).toFixed(1) + "s").join(" | "));
  // the last whole run's result, for anything that reports on the suite
  if (!want.length) { fs.writeFileSync(path.join(OUT, "last.json"), JSON.stringify({ at: new Date().toISOString(), total, failed })); }
  process.exit(failed ? 1 : 0);
})();
