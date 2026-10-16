/*  The corner bar for a setup download (RetroArch or its cores): the same
 *  line-and-track as the Get Pictures bar, stacked just above it, and hidden by
 *  the same rule while a window is open (the guide and Settings draw the job
 *  inline then). Painted by whoever follows the job: watchSetup here, the
 *  lighter look in js\launch.js.
 */

import { reloadKeeping } from "./editors.js";
import { showStrip } from "./launch.js";
import { L, api, logWarn } from "./log.js";
import { sound } from "./sound.js";
import { $editor, $settings, games, sel } from "./state.js";
import { el, megabytes } from "./util.js";

/* What a job is doing, in words. Shared by the corner, the guide's steps
   and Settings > Emulators, so every place says the same thing. */
export function jobLine(job) {
  if (!job) { return ""; }
  if (job.state === "failed") { return "stopped: " + job.error; }
  if (job.kind === "retroarch") {
    if (job.state === "done") { return "RetroArch " + job.version + " is ready"; }
    if (job.step === "check") { return "checking RetroArch..."; }
    if (job.step === "unpack") { return typeof job.unpacked === "number" ? "unpacking: " + job.unpacked + "%" : "unpacking..."; }
    var pct = job.total ? Math.min(100, Math.round(job.bytes * 100 / job.total)) : 0;
    return "downloading RetroArch: " + megabytes(job.bytes) + " of " + megabytes(job.total) + " (" + pct + "%)";
  }
  var got = (job.cores || []).filter(function (c) { return c.state === "done"; }).length;
  var bad = (job.cores || []).filter(function (c) { return c.state === "failed"; }).length;
  if (job.state === "done") { return got + " of " + job.cores.length + " cores fetched" + (bad ? ", " + bad + " could not be" : ""); }
  return "fetching cores: " + got + " of " + job.cores.length;
}

/* How far along a running job is, 0 to 1, or null while it is busy with
   something unmeasured (checking the hash, an unpack that gives no
   percentage): the track waits. */
export function jobFrac(job) {
  if (!job) { return 0; }
  if (job.kind === "retroarch") {
    if (job.step === "unpack" && typeof job.unpacked === "number") { return job.unpacked / 100; }
    if (job.step === "check" || job.step === "unpack") { return null; }
    return job.total ? Math.max(0, Math.min(1, (job.bytes || 0) / job.total)) : 0;
  }
  var all = (job.cores || []).length;
  var moved = (job.cores || []).filter(function (c) { return c.state !== "waiting"; }).length;
  return all ? moved / all : 0;
}

/* The same track inline: under a guide step's words and under Settings >
   Emulators' progress line. A number alone does not read as a download. */
export function jobBarNode(frac, extra) {
  var t = el("span", "fb-track gd-prog" + (extra ? " " + extra : ""));
  t.appendChild(el("span", "fb-fill"));
  jobBarSet(t, frac);
  return t;
}
export function jobBarSet(t, frac) {
  t.classList.toggle("wait", frac === null);
  // unmeasured: the width it had goes, or the travelling piece keeps it (none at 0%, the whole track at 100%)
  t.firstChild.style.width = frac === null ? "" : Math.round(Math.max(0, Math.min(1, frac)) * 100) + "%";
}

/* The one fixed box both corner bars stand in, bottom right: the setup bar
   above, the pictures bar below, so neither covers the other. The CSS hides
   the whole box while Settings or a tool window is open. */
export function cornerBox() {
  var box = document.getElementById("corner-bars");
  if (!box) {
    box = el("div", null);
    box.id = "corner-bars";
    document.body.appendChild(box);
  }
  return box;
}

var bar = null, line = null, track = null, hideT = null;

function build() {
  if (bar) { return; }
  bar = el("div", "fill-bar setup-bar");
  bar.hidden = true;
  line = el("span", "fb-line");
  bar.appendChild(line);
  track = el("span", "fb-track");
  track.appendChild(el("span", "fb-fill"));
  bar.appendChild(track);
  cornerBox().appendChild(bar);
}

export function paintSetupBar(job) {
  if (!job || job.state !== "running") {
    if (job && job.state === "done") {
      // A last green moment, also for a fetch that ended before the first
      // read (a small core, the server busy scanning): every caller follows
      // a job it just started or saw running, so this end is news.
      build();
      line.textContent = jobLine(job);
      track.classList.remove("wait");
      track.firstChild.style.width = "100%";
      bar.classList.add("ended");
      bar.hidden = false;
      clearTimeout(hideT);
      hideT = setTimeout(function () { bar.hidden = true; }, 6000);
    } else if (bar) {
      bar.hidden = true;                  // failed or gone: the strip carries the reason
    }
    return;
  }
  build();
  clearTimeout(hideT);
  bar.classList.remove("ended");
  line.textContent = jobLine(job);
  var frac = jobFrac(job);
  track.classList.toggle("wait", frac === null);
  track.firstChild.style.width = frac === null ? "" : Math.round(frac * 100) + "%";
  bar.hidden = false;
}

/* Follows the job until it ends, calling `tick` on every read so a Settings
   page can draw progress. One is enough: openGuide and setupRows arm one only
   while none is alive (watchAlive), and the OPEN guide's paint is always called
   too (guidePaint), so a guide reopened mid-download keeps counting. */
var watchAlive = false;
var guidePaint = null;
var rowsPaint = null;      // Settings > Emulators keeps counting the same way
export function watchSetup(done, tick) {
  var misses = 0;
  var lastKind = "";
  var sawRa = false;                     // RetroArch came in this watch: the games on screen could not play before it
  watchAlive = true;
  function read() {
    // Only the job, unless a page draws from the whole answer: the full one
    // reads the library every second on a server that answers one request at
    // a time, and the pictures pass waits behind each.
    var light = done === quietDone && !tick && $editor.hidden && $settings.hidden;
    api(light ? "api/setup.php?job=1" : "api/setup.php").then(function (st) {
      // One missed read must not end the watch: the server answers one request
      // at a time and may be busy unpacking, and a quit watcher leaves the strip on "downloading...".
      if (!st.ok || !st.job) {
        if (++misses <= 10) { setTimeout(read, 2000); return; }
        watchAlive = false;
        logWarn("setup watch gave up after 10 missed reads; the fetch carries on by itself");
        showStrip("lost sight of the download; it carries on: Help > Getting started shows it", true);
        return;
      }
      misses = 0;
      // the corner bar rides every read; it hides itself when a window is
      // open (the guide and Settings draw the job inline) and at the end
      paintSetupBar(st.job);
      // Set it all up (includes\setup.php): the RetroArch job becomes the
      // cores job in place, still running. Say the hand-over once.
      if (lastKind === "retroarch" && st.job.kind === "cores" && st.job.state === "running") {
        sound("ok");
        showStrip("RetroArch is ready: fetching the cores for your consoles next...", false);
      }
      lastKind = st.job.kind;
      if (st.job.kind === "retroarch") { sawRa = true; }
      if (tick) { tick(st); }
      if (!st.light && guidePaint && guidePaint !== tick) { guidePaint(st); }
      if (!st.light && rowsPaint && rowsPaint !== tick) { rowsPaint(st); }
      if (st.job.state === "running") { setTimeout(read, 1000); return; }
      watchAlive = false;
      if (st.job.state === "failed") {
        L("SETUP", "failed: " + st.job.error);
        showStrip((st.job.kind === "cores" ? "the cores" : "RetroArch") + " could not be fetched: " + st.job.error, true);
        return;
      }
      // Their Play buttons said what was missing: read again, so they play.
      if (sawRa) { L("SETUP", "RetroArch is in: the games are read again"); reloadKeeping(games[sel] ? games[sel].id : null); }
      done(st);
    });
  }
  setTimeout(read, 600);
}

/* The watch a page arms over a fetch something else started (a reload, a
   reopened guide, the server's own chain): say how it ended, nothing more. */
export function quietDone(s2) {
  sound("ok");
  showStrip(jobLine(s2.job) + (s2.job.kind === "cores" ? ": your consoles are ready" : ""), false);
}

export function watchUp() { return watchAlive; }
/* The open guide's and the Emulators page's own paints, riding every read:
   whichever page is newest owns its repainting (a closed one's paint no-ops
   on isConnected), set through these, never assigned across modules. */
export function setGuidePaint(fn) { guidePaint = fn; }
export function setRowsPaint(fn) { rowsPaint = fn; }
