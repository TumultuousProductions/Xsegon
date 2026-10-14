/*  The Runs check's bar in the corner, with Stop, and the check Set it all up
 *  owes: once the status poll (api\running.php) says "ready", this asks
 *  api\runcheck.php to start it, as the Runs check panel does.
 */

import { showStrip } from "./launch.js";
import { L, postJson } from "./log.js";
import { mailArrived, troubleSeen } from "./news.js";
import { cornerBox } from "./setupbar.js";
import { sound } from "./sound.js";
import { el, plural } from "./util.js";

var bar = null, line = null, track = null, stopBtn = null, hideT = null;
var asking = false;

function post(body) {
  return postJson("api/runcheck.php", body);
}

function build() {
  if (bar) { return; }
  bar = el("div", "fill-bar runs-bar");
  bar.hidden = true;
  line = el("span", "fb-line");
  bar.appendChild(line);
  stopBtn = el("button", "fb-stop", "Stop");
  stopBtn.type = "button";
  stopBtn.title = "Stop after the game on screen. What was found is kept.";
  stopBtn.addEventListener("click", function () {
    stopBtn.disabled = true;
    L("RCHK", "stop pressed on the corner bar");
    // A stop the server could not take leaves games starting: said, and Stop is there to press again.
    post({ action: "stop" }).then(function (r) {
      if (!r.ok) { stopBtn.disabled = false; showStrip("the Runs check was not stopped: " + (r.error || "no answer"), true); }
    });
  });
  bar.appendChild(stopBtn);
  track = el("span", "fb-track");
  track.appendChild(el("span", "fb-fill"));
  bar.appendChild(track);
  cornerBox().appendChild(bar);
}


/* How a run ended, in one line for the strip. */
function ending(r) {
  if (r.stopped) { return r.why || "the Runs check stopped at game " + r.index + " of " + r.total + ": Emulators > Runs check starts it again where it left off"; }
  var c = r.counts || {};
  var bad = (c.crashed || 0) + (c.nostart || 0) + (c.noanswer || 0);
  var look = c.look || 0;                 // the emulator could not say: yours to judge
  return "Runs check finished: " + plural(c.boots || 0, "game starts", "games start") +
    (bad ? ", " + bad + " did not" : "") + (look ? ", " + look + " to look at" : "") +
    (bad || look ? ": Emulators > Runs check shows which" : "");
}

/* Painted from every light status poll: null when it carries no check (a
   runner that died goes quiet; the log says so). Its end is said only by a
   page that showed it running; the panel keeps every result. */
export function paintRunsBar(r) {
  if (!r) {
    if (bar && !bar.classList.contains("ended")) { bar.hidden = true; }
    return;
  }
  if (r.running) {
    build();
    clearTimeout(hideT);
    line.textContent = "Runs check: " + (r.index ? "game " + r.index + " of " + r.total + (r.title ? ", " + r.title : "") : "starting " + plural(r.total, "game", "games"));
    track.firstChild.style.width = Math.round((r.total ? Math.max(0, r.index - 1) / r.total : 0) * 100) + "%";
    stopBtn.hidden = false;
    bar.classList.remove("ended");
    bar.hidden = false;
    return;
  }
  if (!bar || bar.hidden || bar.classList.contains("ended")) { return; }
  var said = ending(r);
  L("RCHK", "ended: " + said);
  sound("ok");
  var itself = !!r.stopped && !!r.why;      // stopped by itself, not by you
  showStrip(said, itself, null, null, itself ? troubleSeen("job:runcheck") : null);
  line.textContent = r.stopped ? "Runs check: stopped" : "Runs check: done";
  if (!r.stopped) { track.firstChild.style.width = "100%"; }
  stopBtn.hidden = true;
  stopBtn.disabled = false;
  bar.classList.add("ended");
  hideT = setTimeout(function () { bar.hidden = true; }, 6000);
}

/* The games the server left out because a BIOS file is not in place, as the
   tail of a strip line: "" when there are none. Messages has the files. */
function leftOut(r) {
  var bios = (r && r.bios) || [];
  if (!bios.length) { return ""; }
  var n = bios.reduce(function (sum, o) { return sum + o.games; }, 0);
  var names = bios.map(function (o) { return o.platform; });
  var who = names.length > 3 ? names.length + " consoles" : names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0];
  return ". " + plural(n, "game was", "games were") + " left out: " + who + " " + (names.length === 1 ? "needs" : "need") +
    " BIOS files Xsegon cannot download. Messages says which";
}

/* The poll said Set it all up's downloads and pictures are done. Asked once at
   a time; the server clears what owed it, so the next poll is quiet. */
export function askAutoRuns() {
  if (asking) { return; }
  asking = true;
  L("RCHK", "set it all up: the downloads and pictures are done, asking for the check");
  post({ action: "start", auto: true }).then(function (r) {
    asking = false;
    var out = leftOut(r);
    if (out) { mailArrived(); }
    if (r && r.ok && r.dry) {
      showStrip("the Runs check would start " + plural(r.games, "game", "games") + " now (a test copy: nothing is started)" + out, false);
    } else if (r && r.ok) {
      sound("select");
      showStrip("checking that each game starts: they open on the screen for a few seconds each, and Skip on the list in the corner stops it" + out, false);
    } else if (r && out) {
      showStrip("the Runs check has nothing it can start yet" + out, false);
    } else if (r && /nothing left to check|no RetroArch games/.test(r.error || "")) {
      L("RCHK", "set it all up had nothing to check: " + r.error);
    } else if (r && /quit it first|still downloading|still going/.test(r.error || "")) {
      // passing: the server kept what owes it, and the poll asks again
      L("RCHK", "the check waits: " + r.error);
    } else {
      showStrip("the Runs check did not start: " + ((r && r.error) || "no answer") + ". Emulators > Runs check starts it by hand", true);
    }
  });
}
