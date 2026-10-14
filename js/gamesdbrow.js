/*  Settings > Library > Games Database: which copy is in use, what the last
 *  check found, and Check now, which works whether updates are Automatic or
 *  Manual (api\gamesdb-update.php).
 *
 *  A check mostly answers in a second, so Settings stays open for it and the row
 *  shows the answer. A newer copy's fetch is a bar on the row and in the corner
 *  once Settings is closed; its end is said on the strip.
 */

import { jobBar } from "./jobbars.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { el } from "./util.js";

var GIVE_UP_MS = 20 * 60 * 1000;         // the updater itself gives a fetch a quarter of an hour
var painter = null;                      // the row on screen now: a check can outlive the row that began it
var following = false;

function megs(bytes) { return Math.round(bytes / 1048576) + " MB"; }

function words(result) {
  if (result === "fetched") { return "a newer Games Database was fetched: it is used from the next lookup"; }
  if (result === "up to date") { return "the Games Database is up to date"; }
  if (result === "nothing published yet") { return "no newer Games Database has been published yet: the one here is the newest there is"; }
  if (/^could not check/.test(result)) { return "could not check for a newer Games Database (no internet?)"; }
  return "the Games Database was not updated: " + result;
}

function day(iso) {
  var d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/* Asks again until the check has an answer newer than `was`. asked: Check
   now was pressed here, so even "up to date" is said; a check found already
   running says only a fetch or a failure. */
function follow(was, asked) {
  if (following) { return; }
  following = true;
  var t0 = Date.now(), started = Math.floor(t0 / 1000), fetching = false;
  function bar(state, line, frac) {
    jobBar({ key: "gamesdb", name: "Games Database", state: state, started: started, line: line, frac: frac, stop: false, said: "" });
  }
  (function wait() {
    api("api/gamesdb-update.php").then(function (s) {
      var answered = !!(s.ok && s.last && s.last.at !== was && !s.running);
      if (s.ok && s.running && s.fetch) {
        fetching = true;
        bar("running", "fetching the newer copy: " + megs(s.fetch.bytes) + " of " + megs(s.fetch.total), s.fetch.bytes / s.fetch.total);
      }
      if (painter) { painter(s); }
      if (!answered && Date.now() - t0 < GIVE_UP_MS) { setTimeout(wait, fetching ? 1000 : 2000); return; }
      following = false;
      var good = answered && /^(fetched|up to date|nothing published)/.test(s.last.result);
      if (fetching) { bar(good ? "done" : "failed", "", good ? 1 : 0); }
      if (!answered) { showStrip("the check for a newer Games Database gave no answer", true); return; }
      L("GDB", "check answered: " + s.last.result);
      if (asked || fetching || !good) { showStrip(words(s.last.result), !good); }
    });
  })();
}

export function gamesdbRow(page, actionRow) {
  var rowEl = actionRow("Games Database", "reading...", "Check now", function () {
    btn.disabled = true;
    showStrip("checking for a newer Games Database…", false);
    api("api/gamesdb-update.php").then(function (before) {
      var was = before.last ? before.last.at : null;
      postJson("api/gamesdb-update.php", { action: "check" }).then(function (r) {
        if (!r.ok) { btn.disabled = false; showStrip(r.error || "could not check", true); return; }
        L("GDB", "check now");
        follow(was, true);
      });
    });
  });
  page.appendChild(rowEl);
  var hint = rowEl.querySelector(".hint");
  var btn = rowEl.querySelector("button");
  // The fetch's own bar, under the row's words: hidden until there are bytes to count.
  var track = el("span", "fb-track gd-prog gdb-prog");
  track.appendChild(el("span", "fb-fill"));
  track.hidden = true;
  hint.parentNode.appendChild(track);
  function paint(s) {
    if (!s || !s.ok) { hint.textContent = "could not read the Games Database's state"; return; }
    var have = s.built ? "In use: " + s.where + ", built " + day(s.built) +
      (s.games ? " (" + Number(s.games).toLocaleString() + " games)" : "") + "." : "No copy here yet.";
    var last = s.running && s.fetch ? " Fetching the newer copy: " + megs(s.fetch.bytes) + " of " + megs(s.fetch.total) + "."
      : s.running ? " Checking now…" : s.last && s.last.at ? " Last checked " + day(s.last.at) + ": " + s.last.result + "." : " Not checked yet.";
    var how = !s.applies ? " Filling uses libretro, or nothing here can read the database, so there is nothing to check."
      : s.mode !== "auto" ? " Checked only when you press Check now."
      : s.paused ? " The check by itself waits for Xsegon's first release: until then only Check now asks."
      : " Checked by itself once a day.";
    hint.textContent = have + last + how;
    track.hidden = !(s.running && s.fetch);
    if (!track.hidden) { track.firstChild.style.width = Math.round(100 * s.fetch.bytes / s.fetch.total) + "%"; }
    btn.disabled = !s.applies || s.running;
  }
  painter = paint;
  api("api/gamesdb-update.php").then(function (s) {
    paint(s);
    // A check already at work (the daily one, or one begun before a reload): this row keeps up with it.
    if (s && s.ok && s.running) { follow(s.last ? s.last.at : null, false); }
  });
}
