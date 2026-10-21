/*  The Fill in bar: a line and a thin track in the bottom corner while the pass
 *  runs as a job on the server (includes\fill.php, bin\fill.php), so no window
 *  holds the server while it works.
 *
 *  The library on screen is read again twice, keeping your place: once every game
 *  has its name and box, and at the end. Never under an open panel: it waits for
 *  the panel to close. A look for Fill in custom's list has no bar (js\fill.js).
 */

import { reloadKeeping } from "./editors.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { troubleSeen } from "./news.js";
import { cornerBox } from "./setupbar.js";
import { gameRunning } from "./snap.js";
import { $editor, $settings, games, sel } from "./state.js";
import { el, plural } from "./util.js";

var TICK_MS = 1500;
var SEEN = "xs-fill-seen";               // the job whose ending has been said, by its start time

var bar = null, line = null, track = null, stopBtn = null;
var timer = null, reloadWanted = false, firstFor = 0, hideT = null;
var over = false;                        // the job has ended: only a re-read may still be owed
var againFor = 0;                        // the stopped pass whose second go has been logged
var listener = null;

/* Told when a pass ends (the guide draws its steps again). One at a time. */
export function setFillListener(fn) { listener = fn; }

function seen() { try { return Number(localStorage.getItem(SEEN) || 0); } catch (e) { return 0; } }
/* Whether the ending of the job started then has been said already. */
export function fillSaid(at) { return seen() === at; }
function markSeen(at) { try { localStorage.setItem(SEEN, String(at)); } catch (e) { /* a private window */ } }

function build() {
  if (bar) { return; }
  bar = el("div", "fill-bar");
  bar.hidden = true;
  line = el("span", "fb-line");
  bar.appendChild(line);
  stopBtn = el("button", "fb-stop", "Stop");
  stopBtn.type = "button";
  stopBtn.title = "Stop after the game in hand. What is filled stays.";
  stopBtn.addEventListener("click", function () {
    stopBtn.disabled = true;
    L("FILL", "stop pressed");
    postJson("api/fill.php", { job: "stop" }).then(function (r) {
      if (!r.ok) { stopBtn.disabled = false; showStrip("Get Pictures was not stopped: " + (r.error || "no answer"), true); }
    });
  });
  bar.appendChild(stopBtn);
  track = el("span", "fb-track");
  track.appendChild(el("span", "fb-fill"));
  bar.appendChild(track);
  cornerBox().appendChild(bar);
}

/* What a running job is doing, in words, and how far through as 0 to 1. The
   look is a fifth of the track, the names and boxes half, the rest the rest. */
export function fillWords(j) {
  var n = j.total || 0;
  if (j.phase === "prepare") { return ["setting up the Games Database (the first time only)", 0.02]; }
  if (j.phase === "first") { return ["names and box art, " + j.done + " of " + n, 0.2 + 0.5 * (n ? j.done / n : 1)]; }
  // The rest phase only visits the games that filled, so games that could
  // not be are not in its count.
  if (j.phase === "rest") { var m = Math.max(0, n - (j.failed || 0)); return ["the other pictures, " + j.restDone + " of " + (m || n), 0.7 + 0.3 * (m ? j.restDone / m : 1)]; }
  // The pictures that did not come, each asked for once more (bin\fill.php).
  if (j.phase === "again") { return ["asking once more for " + plural(j.againAll || 0, "picture", "pictures") + " that did not come, " + (j.againAt || 0) + " of " + (j.againAll || 0), 0.98]; }
  return ["looking up your games" + (j.scanned ? ", " + j.looked + " of " + j.scanned : ""), j.scanned ? 0.2 * j.looked / j.scanned : 0];
}


/* A picture's kind in words, here and in Get Specific Pictures (js\fill.js). */
export var FILL_SLOT_WORDS = { box: "box", logo: "logo", shot: "screenshot", fanart: "background" };

var FILL_PLACE = "Get Media > Get Specific Pictures";

/* What a whole pass left to a person: the games with a likely match, which a
   message in the mailbox names with the way to them, and the ones nothing was
   found for. Messages is named only while that message is there (j.told): the
   same games are never written twice, so after a delete the place is said. */
function leftWords(j) {
  if (j.mode !== "all") { return ""; }
  var said = "";
  if (j.check) {
    said += " " + plural(j.check, "game has", "games have") + " a likely match left for you to check: " +
      (j.told ? "Messages has " : FILL_PLACE + " has ") + (j.check === 1 ? "it." : "them.");
  }
  if (j.none) { said += " " + plural(j.none, "game was", "games were") + " not found by name: " + FILL_PLACE + " lets you search for " + (j.none === 1 ? "it." : "them."); }
  return said;
}

/* The pictures that were asked for twice and never came, the first few named.
   Get Pictures goes back to a game only while its box is missing, so for the
   other pictures the way to ask again is said. */
function missedWords(j) {
  if (!j.picsFailed) { return ""; }
  var list = j.picsMissing || [];
  var named = list.slice(0, 2).map(function (p) { return "the " + (FILL_SLOT_WORDS[p.kind] || p.kind) + " of " + p.title; });
  var more = j.picsFailed - named.length;
  var boxes = list.filter(function (p) { return p.kind === "box"; }).length, others = list.length - boxes;
  var it = j.picsFailed === 1 ? "it" : "them";
  var again = !others ? "Get Pictures asks for " + it + " again the next time you run it."
    : (boxes ? "Get Pictures asks again for a box the next time you run it; for the other pictures, " : "to ask for " + it + " again, ") +
      "select the game under Already filled in " + FILL_PLACE + ".";
  return " " + plural(j.picsFailed, "picture", "pictures") + " could not be fetched" +
    (named.length ? " (" + named.join(", ") + (more > 0 ? " and " + more + " more" : "") + ")" : "") + ": " + again;
}

/* How a pass ended, in one line for the strip. */
function ending(j) {
  var left = leftWords(j);
  if (j.state === "failed") { return j.error || "Get Pictures stopped before it finished."; }
  if (j.state === "stopped") { return "Get Pictures stopped at " + j.done + " of " + j.total + ". What was filled is kept."; }
  if (!j.total) { return "Get Pictures: nothing here that Xsegon is sure of." + left; }
  // A game hidden or taken out while it ran is in neither number (bin\fill.php).
  return "Get Pictures finished: " + plural(j.done - j.failed, "game", "games") + ", " + plural(j.fields, "detail", "details") +
    (j.pics ? ", " + plural(j.pictures, "picture", "pictures") : "") + "." +
    (j.failed ? " " + plural(j.failed, "game", "games") + " could not be filled." : "") + missedWords(j) + left;
}

/* The library read again, keeping your place, as soon as nothing is over it. */
function tryReload() {
  if (!reloadWanted) { return; }
  if (!$editor.hidden || !$settings.hidden || gameRunning) { return; }
  reloadWanted = false;
  L("FILL", "the library is read again, keeping your place");
  reloadKeeping(games[sel] ? games[sel].id : null);
}

function stop() {
  if (reloadWanted) { return; }          // still owed a re-read: keep looking for the moment
  clearInterval(timer);
  timer = null;
}

function handle(j) {
  if (!j || j.mode === "look") { over = true; tryReload(); stop(); if (bar) { bar.hidden = true; } return; }
  if (j.state === "running") {
    build();
    clearTimeout(hideT);
    var w = fillWords(j);
    line.textContent = "Get Pictures: " + w[0];
    track.firstChild.style.width = Math.round(Math.max(0, Math.min(1, w[1])) * 100) + "%";
    stopBtn.hidden = false;
    bar.classList.remove("ended");
    bar.hidden = false;
    // Every game has its name and its box: the list is worth reading again.
    if (j.firstDone && firstFor !== j.started) { firstFor = j.started; reloadWanted = true; }
    tryReload();
    return;
  }
  // It has ended. Said once, whichever page hears of it first.
  over = true;
  // Stopped under Set it all up, which tries it once more by itself (the
  // Setting up list says so): not an ending to call out, or to keep as trouble.
  if (j.state === "failed" && j.again) {
    if (againFor !== j.started) { againFor = j.started; L("FILL", "stopped once (" + (j.error || "no reason given") + "): set it all up tries it again"); }
    if (bar) { bar.hidden = true; }
    tryReload();
    stop();
    return;
  }
  if (seen() !== j.started) {
    markSeen(j.started);
    var said = ending(j);
    L("FILL", "ended: " + said);
    showStrip(said, j.state === "failed", null, null, j.state === "failed" ? troubleSeen("job:fill") : null);
    reloadWanted = true;
    if (bar) {
      line.textContent = j.state === "done" ? "Get Pictures: done" : "Get Pictures: stopped";
      track.firstChild.style.width = j.state === "done" ? "100%" : track.firstChild.style.width;
      stopBtn.hidden = true;
      stopBtn.disabled = false;
      bar.classList.add("ended");
      clearTimeout(hideT);
      hideT = setTimeout(function () { bar.hidden = true; }, 6000);
    }
    if (listener) { listener(j); }
  } else if (bar && !bar.classList.contains("ended")) {
    bar.hidden = true;
  }
  tryReload();
  stop();
}

function tick() {
  // Ended, and waiting only for a panel to close: nothing to ask the server.
  if (over) { tryReload(); stop(); return; }
  api("api/fill.php?job=1").then(function (r) { if (r && r.ok) { handle(r.job); } });
}

/* A pass was started, or the status poll says one is at work (or has just
   ended): watch it until it is over and the library has been read again. */
export function fillWatch() {
  if (timer && !over) { return; }
  over = false;
  if (!timer) { timer = setInterval(tick, TICK_MS); }
  tick();
}
