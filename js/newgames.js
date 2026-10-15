/*  New games in the games folders, added by themselves (includes\newgames.php):
 *  one look after the page has started, and one when its window comes back to
 *  the front after being away a while (Explorer, copying games in). The server
 *  holds the hard limits; here the page asks at most once a minute, never over
 *  an open window or question, and an ask that had to wait is owed, not lost.
 */

import { reloadKeeping } from "./editors.js";
import { fillWatch } from "./fillbar.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { mailArrived } from "./news.js";
import { setupAsking } from "./nogames.js";
import { $editor, S, games, sel } from "./state.js";
import { plural } from "./util.js";

var START_MS = 8000;        // after the page is up, not while it is still arriving
var AWAY_MS = 10000;        // away at least this long: a glance at another window is no reason
var GAP_MS = 60000;         // one look a minute at the most
var AGAIN_MS = 35000;       // files still arriving are looked at once more, this much later
var POLL_MS = 1000;
var POLL_MOST = 600;        // ten minutes of asking how a look goes, then it is left

var lastAsk = 0, owed = null, owedTimer = 0, awaySince = 0, watching = false;

// The tests shorten the waits (window.XSEGON.newGamesMs); everyone else has the numbers above.
function ms(n) { var t = window.XSEGON && window.XSEGON.newGamesMs; return t ? Math.min(n, t) : n; }

function on() { return !(S.library && S.library.addNewGames === false); }

// Something is up that games arriving behind would spoil: a window, a question, Set it all up finding games.
function busy() { return !$editor.hidden || !!document.querySelector(".confirm-wrap") || setupAsking(); }

/* Asked again later, once: when the wait is over and the window is in front.
   One owed ask at a time; a newer reason takes its place. */
function owe(why, wait) {
  if (!owed) { L("NEWG", "a look for new games waits (" + why + ")"); }
  owed = why;
  clearTimeout(owedTimer);
  owedTimer = setTimeout(function () {
    if (document.hidden) { return; }       // the way back asks it
    var w = owed;
    owed = null;
    ask(w);
  }, Math.max(1000, wait));
}

function ask(why) {
  if (!on()) { return; }
  if (document.hidden) { owed = owed || why; return; }
  var wait = lastAsk + ms(GAP_MS) - Date.now();
  if (wait > 0 && why !== "again") { owe(why, wait); return; }
  if (watching || busy()) { owe(why, ms(GAP_MS)); return; }
  lastAsk = Date.now();
  postJson("api/newgames.php", { start: why }).then(function (r) {
    if (!r || !r.ok) { L("NEWG", "the look was not asked for: " + ((r && r.error) || "no answer")); return; }
    if (r.started) { follow(why); return; }
    /* A game running or switched off: nothing owed (coming back from the game
       asks again). Another look at work, or one a moment ago: owed. */
    if (/look is at work|seconds ago|Unpack/.test(r.no || "")) { owe(why, ms(GAP_MS)); }
  });
}

function follow(why) {
  watching = true;
  var n = 0;
  function read() {
    api("api/newgames.php").then(function (r) {
      var job = r && r.ok ? r.job : null;
      if (job && job.state === "running" && ++n < POLL_MOST) { setTimeout(read, POLL_MS); return; }
      watching = false;
      if (job) { ended(job, why); }
    }, function () { watching = false; });
  }
  setTimeout(read, POLL_MS);
}

/* What came, first and by name; what Xsegon was not sure of, after, and where it waits. */
function ended(job, why) {
  if (job.state !== "done") { L("NEWG", "the look ended " + job.state + ": " + (job.error || "")); return; }
  var titles = job.titles || [];
  var line = "";
  if (job.added > 0) {
    line = plural(job.added, "new game", "new games") + " added: " + titles.join(", ") +
      (job.added > titles.length ? " and " + (job.added - titles.length) + " more" : "");
    if (job.fill) { line += ", looking up names and pictures"; fillWatch(); }
    reloadKeeping(games[sel] ? games[sel].id : null);
  }
  var unsure = job.many ? job.many + " new games found at once" : job.told ? plural(job.told, "file", "files") + " Xsegon was not sure of" : "";
  if (unsure) {
    line += (line ? "  ·  " : "") + unsure + ": use Games > Scan for Games for " + (job.many || job.told > 1 ? "them" : "it") + " (Messages lists them)";
    mailArrived();
  }
  if (line) { showStrip(line, false); }
  // Files still being copied: looked at once more, a little later.
  if (job.fresh > 0 && why !== "again") { setTimeout(function () { ask("again"); }, ms(AGAIN_MS)); }
}

function wentAway() { if (!awaySince) { awaySince = Date.now(); } }

function cameBack() {
  if (document.hidden) { return; }
  var away = awaySince ? Date.now() - awaySince : 0;
  awaySince = 0;
  if (owed) { var w = owed; owed = null; clearTimeout(owedTimer); ask(w); return; }
  if (away >= ms(AWAY_MS)) { ask("back"); }
}

/* Called once the page is up (js\main.js). Coming back is the window taking
   the focus again, or being shown again after it was minimised. */
export function initNewGames() {
  window.addEventListener("blur", wentAway);
  window.addEventListener("focus", cameBack);
  document.addEventListener("visibilitychange", function () { if (document.hidden) { wentAway(); } else { cameBack(); } });
  setTimeout(function () { ask("start"); }, ms(START_MS));
}
