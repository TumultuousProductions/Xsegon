// Xsegon tests - the same groups, two at a time.
//
//     node tests\lanes.js              every group but e2e, in two lanes
//     node tests\lanes.js 3            in three
//     node tests\lanes.js menus own    only those groups
//     node tests\lanes.js quick        about three minutes: the slow groups left out
//
// Each lane IS a run.js of its own, with its own server, data copy and
// browser, so nothing is shared but the PC. The groups that read a stopwatch
// run after the lanes, alone. e2e starts a real game and stays run.js's.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
// Their checks time the page or a stand-in: a second lane's load turns them red with nothing broken.
const ALONE = ["views", "log", "runcheck"];
const NOT_HERE = ["e2e", "big"];        // big makes 40,000 files and times a server: by itself, node tests\run.js big
// What a quick run leaves out: the groups that take long for the checks they hold, and the stopwatch ones.
// It is for while a change is being made; the whole run is still the proof before a commit.
const QUICK_OUT = ["api", "setup", "runcheck", "steam", "skraper", "jobs", "offline", "backup", "views", "log"];
// Seconds the slow groups take; any other counts as five. Written here and not measured each run, so the
// same command always puts the same groups after each other: a group's result never moves with the split.
const SECS = { api: 114, setup: 66, steam: 43, skraper: 41, settings: 38, jobs: 38, scan: 33, backup: 24, offline: 23,
               menus: 22, unpack: 16, boot: 15, more: 15, states: 14, writes: 14, cheats: 13, editing: 12, bios: 10 };

/** The groups in run.js's own order: its list is the one list. */
function groupNames() {
  const src = fs.readFileSync(path.join(__dirname, "run.js"), "utf8");
  const block = (/const GROUPS = \{([\s\S]*?)\n\};/.exec(src) || [])[1] || "";
  const names = [...block.matchAll(/^\s*"?([a-z0-9-]+)"?:\s*"\.\/t-/gm)].map((m) => m[1]);
  if (names.length < 10) { throw new Error("the list of groups in tests\\run.js was not found"); }
  // and the private groups (private\tests), which run.js adds where that folder is
  const dir = path.join(ROOT, "private", "tests");
  const own = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => (/^t-([a-z0-9-]+)\.js$/.exec(f) || [])[1]).filter(Boolean) : [];
  return names.concat(own.filter((n) => !names.includes(n)));
}

/** One run.js over these groups; its lines are passed on as they come, marked with the lane. */
function run(tag, groups) {
  return new Promise((resolve) => {
    const got = { tag, groups, passed: 0, total: 0, red: [], secs: {}, code: null, ms: 0 };
    const t0 = Date.now();
    const child = spawn(process.execPath, [path.join(__dirname, "run.js")].concat(groups), { cwd: ROOT, windowsHide: true });
    let rest = "";
    const line = (l) => {
      const g = /^(ok|FAIL)\s+(\S+)\s+\d+\/\d+\s+([\d.]+)s/.exec(l);
      if (g) { got.secs[g[2]] = Number(g[3]); if (g[1] === "FAIL") { got.red.push(g[2]); } }
      const end = /^(?:passed|FAILED): (\d+) of (\d+) checks/.exec(l);
      if (end) { got.passed = Number(end[1]); got.total = Number(end[2]); return; }
      if (/^slowest sleeps:/.test(l) || l.trim() === "") { return; }
      console.log(tag + "  " + l);
    };
    const feed = (d) => { rest += d; const parts = rest.split(/\r?\n/); rest = parts.pop(); parts.forEach(line); };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("close", (code) => { if (rest) { line(rest); } got.code = code; got.ms = Date.now() - t0; resolve(got); });
  });
}

const mmss = (ms) => Math.floor(ms / 60000) + "m" + String(Math.round(ms / 1000) % 60).padStart(2, "0") + "s";

(async () => {
  const args = process.argv.slice(2);
  if (args.includes("--live")) { console.log("lanes run on copies of their own: the real Xsegon is tests\\run.js --live"); process.exit(2); }
  const all = groupNames();
  const count = Math.max(1, Math.min(4, Number(args.find((a) => /^\d+$/.test(a)) || 2)));
  const quick = args.includes("quick");
  const named = args.filter((a) => !/^\d+$/.test(a) && a !== "quick");
  const unknown = named.filter((a) => !all.includes(a));
  if (unknown.length) { console.log("no such group: " + unknown.join(", ") + " (have: " + all.join(", ") + ")"); process.exit(2); }
  if (named.includes("e2e")) { console.log("(e2e starts a real game and is not run in lanes: node tests\\run.js e2e)"); }
  if (named.includes("big")) { console.log("(big is run by itself: node tests\\run.js big)"); }
  const asked = (named.length ? all.filter((g) => named.includes(g)) : all).filter((g) => !NOT_HERE.includes(g));
  const want = asked.filter((g) => !quick || !QUICK_OUT.includes(g));
  const leftOut = asked.filter((g) => !want.includes(g));
  if (!want.length) { console.log("nothing to run" + (leftOut.length ? ": a quick run leaves out " + leftOut.join(" ") : "")); process.exit(2); }
  const alone = want.filter((g) => ALONE.includes(g));
  const rest = want.filter((g) => !ALONE.includes(g));

  // Each group to the lane with the least in it so far, in run.js's order:
  // inside a lane the groups follow each other as they always have.
  const lanes = Array.from({ length: Math.min(count, Math.max(1, rest.length)) }, (x, i) => ({ tag: String.fromCharCode(65 + i), groups: [], secs: 0 }));
  for (const g of rest) {
    const l = lanes.reduce((a, b) => (b.secs < a.secs ? b : a));
    l.groups.push(g); l.secs += SECS[g] || 5;
  }
  const busy = lanes.filter((l) => l.groups.length);
  for (const l of busy) { console.log("lane " + l.tag + ": " + l.groups.join(" ")); }
  if (alone.length) { console.log("then alone: " + alone.join(" ")); }
  if (leftOut.length) { console.log("quick, so not run: " + leftOut.join(" ")); }
  console.log("");

  const t0 = Date.now();
  const done = await Promise.all(busy.map((l) => run(l.tag, l.groups)));
  const side = Date.now() - t0;
  if (alone.length) { done.push(await run("-", alone)); }
  const wall = Date.now() - t0;

  const passed = done.reduce((a, d) => a + d.passed, 0), total = done.reduce((a, d) => a + d.total, 0);
  const red = done.flatMap((d) => d.red.map((g) => g + " (" + d.tag + ")"));
  // A lane that never reached its checks (no server, no browser) is a failure of the run, not a short one.
  const lost = done.filter((d) => (d.code !== 0 && d.code !== 1) || d.total === 0);
  const inARow = done.reduce((a, d) => a + Object.values(d.secs).reduce((x, y) => x + y, 0), 0);

  console.log("");
  console.log("side by side " + mmss(side) + " (" + busy.map((l, i) => l.tag + " " + mmss(done[i].ms)).join(", ") + ")" + (alone.length ? ", then alone " + mmss(wall - side) : ""));
  for (const d of lost) { console.log("!! lane " + d.tag + " did not finish its groups (exit " + d.code + "): " + d.groups.join(" ")); }
  console.log((red.length || lost.length ? "FAILED: " : "passed: ") + passed + " of " + total + " checks in " + mmss(wall)
              + "; one after another these groups took " + mmss(inARow * 1000));
  if (red.length) { console.log("red: " + red.join(", ")); }
  if (leftOut.length) { console.log("a quick run: " + leftOut.length + " groups were not run (" + leftOut.join(" ") + "). The whole run is node tests\\lanes.js"); }
  process.exit(red.length || lost.length ? 1 : 0);
})();
