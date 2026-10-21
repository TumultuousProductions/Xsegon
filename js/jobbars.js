/*  A bar in the bottom corner for every background job that has no bar of
 *  its own.
 *
 *  Steam trailers, ScreenScraper videos, Move out of LaunchBox, Unpack and
 *  add, a video package: each is a job on the server with a window of its own.
 *  The window closes when the job starts, and this draws the job instead: a
 *  line, a thin track, and Stop where the job has one, stacked with the
 *  other corner bars. One read (api\jobs.php) feeds all of them, only while
 *  a job is at work or has just ended.
 *
 *  An ending is said once on the strip, by whoever sees it first: the
 *  tool's own follower where the page still has one, else this. A page
 *  reloaded mid-job has no follower left, which is why this can say it too.
 */

import { reloadKeeping } from "./editors.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { mailArrived } from "./news.js";
import { cornerBox } from "./setupbar.js";
import { gameRunning } from "./snap.js";
import { $editor, $settings, games, sel } from "./state.js";
import { el } from "./util.js";

var TICK_MS = 1500;
var bars = {};                 // by job key: the bar's nodes
var ownStop = {};              // by job key: the Stop of a job the page drives itself (jobBar)
var seenOver = {};             // by job key: reads on which its ending stood unsaid
var ran = {};                  // by job key: the start time of the run this page has seen at work
var asked = {};                // by job key: when a tool on this page started one itself
var timer = null, reloadWanted = false, quietTill = 0, graceTill = 0;

function saidAt(key) { try { return Number(localStorage.getItem("xs-job-said-" + key) || 0); } catch (e) { return 0; } }

/* The ending of the job started then is about to be said: true for the first
   to ask, false for everyone after. A tool's own follower and the corner both
   ask, so one ending is one line on the strip. */
export function jobSayOnce(key, started) {
  if (saidAt(key) === started) { return false; }
  try { localStorage.setItem("xs-job-said-" + key, String(started)); } catch (e) { /* a private window: said by each */ }
  return true;
}

function build(job) {
  var b = bars[job.key];
  if (b) { return b; }
  b = { node: el("div", "fill-bar job-bar"), line: el("span", "fb-line"), stop: el("button", "fb-stop", "Stop"), track: el("span", "fb-track"), hideT: null };
  b.node.dataset.job = job.key;
  b.node.hidden = true;
  b.node.appendChild(b.line);
  b.stop.type = "button";
  b.stop.addEventListener("click", function () {
    b.stop.disabled = true;
    L("JOBS", "stop pressed on the corner bar: " + job.key);
    if (ownStop[job.key]) { ownStop[job.key](); return; }
    postJson("api/jobs.php", { stop: job.key })
      .then(function (r) { if (!r.ok) { b.stop.disabled = false; showStrip(r.error || "could not stop it", true); } });
  });
  b.node.appendChild(b.stop);
  b.track.appendChild(el("span", "fb-fill"));
  b.node.appendChild(b.track);
  cornerBox().appendChild(b.node);
  bars[job.key] = b;
  return b;
}

/* The library read again, keeping your place, as soon as nothing is over it. */
function tryReload() {
  if (!reloadWanted) { return; }
  if (!$editor.hidden || !$settings.hidden || gameRunning) { return; }
  reloadWanted = false;
  L("JOBS", "the library is read again, keeping your place");
  reloadKeeping(games[sel] ? games[sel].id : null);
}

function paint(job, own) {
  var b = build(job);
  if (job.state === "running") {
    clearTimeout(b.hideT);
    seenOver[job.key] = 0;
    ran[job.key] = job.started;
    b.line.textContent = job.name + ": " + job.line;
    b.track.classList.toggle("wait", job.frac === null);
    b.track.firstChild.style.width = job.frac === null ? "" : Math.round(job.frac * 100) + "%";
    b.stop.hidden = !job.stop;
    b.node.classList.remove("ended");
    b.node.hidden = false;
    return;
  }
  // It has ended. Its own follower, where the page has one, says it on its next read: this waits one read for it.
  // (A job the page drives says its own ending, always.) Only a run this page saw at work is news: a job file
  // that was merely written again (a restore, a copy of the data folder) is an old ending, and is not said twice.
  // (A run this page asked for is its own even if it was over before the first read: a small copy takes a second.)
  if (!own && asked[job.key] && job.started * 1000 >= asked[job.key] - 120000) { ran[job.key] = job.started; }
  if (!own && ran[job.key] === job.started && saidAt(job.key) !== job.started) {
    seenOver[job.key] = (seenOver[job.key] || 0) + 1;
    if (seenOver[job.key] >= 2 && jobSayOnce(job.key, job.started)) {
      L("JOBS", job.key + " ended: " + job.said);
      showStrip(job.said, job.state === "failed");
      if (job.key === "archivevid" || job.key === "archivedoc") { mailArrived(); }   // its ending may have left a message for the games with none
      reloadWanted = true;
    }
  }
  if (!b.node.hidden && !b.node.classList.contains("ended")) {
    b.line.textContent = job.name + ": " + (job.state === "done" ? "done" : "stopped");
    b.track.classList.remove("wait");
    if (job.state === "done") { b.track.firstChild.style.width = "100%"; }
    b.stop.hidden = true;
    b.stop.disabled = false;
    b.node.classList.add("ended");
    clearTimeout(b.hideT);
    b.hideT = setTimeout(function () { b.node.hidden = true; }, 6000);
  }
}

function handle(jobs) {
  var here = {}, owed = false;
  jobs.forEach(function (job) {
    here[job.key] = true;
    paint(job);
    if (job.state === "running" || (ran[job.key] === job.started && saidAt(job.key) !== job.started)) { owed = true; }
  });
  Object.keys(bars).forEach(function (key) {
    if (!here[key] && !(key in ownStop) && !bars[key].node.classList.contains("ended")) { bars[key].node.hidden = true; }
  });
  tryReload();
  // A tool that has just started a job is given a few reads to see it: a worker writes its first word a moment after it is asked for.
  if (!owed && !reloadWanted && Date.now() > graceTill) {
    clearInterval(timer);
    timer = null;
    quietTill = Date.now() + 20000;      // the status look says "jobs" for two minutes after an ending: nothing new to ask meanwhile
  }
}

function tick() {
  api("api/jobs.php").then(function (r) { if (r && r.ok) { handle(r.jobs || []); } });
}

/* A job the page itself drives, with no worker on the server (Check game
   files, Add Steam games): the same bar, painted by the job's own loop on
   each step and once more when it is over. `job` is shaped as api/jobs.php
   gives one; onStop is its Stop, where it has one. */
export function jobBar(job, onStop) {
  ownStop[job.key] = onStop || null;
  paint(job, true);
}

/* A bar of the page's own taken down at once, with no ending said: what it
   was for is no more (a list replaced while its rest was still coming). */
export function jobBarHide(key) {
  var b = bars[key];
  if (b) { clearTimeout(b.hideT); b.node.hidden = true; b.node.classList.add("ended"); }
}

/* A job was started, or the status look says one is at work or has just
   ended: watch until every job is over and said. `key` is given by a tool
   that has just started that job itself, which is never put off. */
export function jobsWatch(key) {
  if (key) { asked[key] = Date.now(); graceTill = Date.now() + 15000; }
  if (timer) { return; }
  if (!key && Date.now() < quietTill) { return; }
  timer = setInterval(tick, TICK_MS);
  tick();
}
