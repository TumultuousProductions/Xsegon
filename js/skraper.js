/*  The Skraper route on the ScreenScraper videos window (includes\skraper.php):
    on a PC with the staging helper, Skraper fetches the selected games with no
    logins typed into Xsegon. Stage writes a tiny stand-in per game and opens
    Skraper; when it closes, what arrived is read, with the window open or not.
    A copy without the helper never shows any of this. */

import { confirmWindow } from "./confirm.js";
import { reloadKeeping } from "./editors.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { games, sel } from "./state.js";
import { el } from "./util.js";

var st = null;           // the last answer from api/skraper.php
var timer = null;        // the poll: while a step runs, and while Skraper is followed
var follow = null;       // { seen, then, until } after a staging, until Skraper is seen closed; then: the step its closing starts
var pane = null;         // the open window's { draw, on, fail }, when there is one
var acted = -1;          // the finished check already acted on; -1 before the first answer
var byItself = false;    // the check in hand was started by Skraper closing

function post(body) {
  return postJson("api/skraper.php", body);
}
function atWork() { return !!(st && st.job && st.job.state === "running"); }
function onScreen() { return !!(pane && pane.on()); }
function followFrom(seen, then) { follow = { seen: seen, then: then, until: Date.now() + 6 * 3600000 }; }

/* A step that may have brought videos: a check, a tidy, and a second go that copied and staged nothing. */
function brings(job) {
  return job.mode === "check" || job.mode === "tidy" || (job.mode === "retry" && !job.staged);
}

/* An answer taken in. A step that has just ended and may have brought videos has the library read again, so they play. */
function took(r) {
  var job = r.job, ended = job && job.state !== "running" && job.finished && brings(job) ? job.finished : 0;
  if (acted < 0) { acted = ended; }                    // what stood before this page looked: not news
  st = r;
  // A second go with nothing left to ask Skraper for: there is no Skraper to wait on.
  if (job && job.mode === "retry" && job.state !== "running" && !job.staged && follow && follow.then === "tidy") { follow = null; }
  if (ended && ended !== acted) {
    acted = ended;
    if (job.state === "done") { reloadKeeping(games[sel] ? games[sel].id : null); }
    if (byItself && !onScreen()) {
      var left = /still without a video in Xsegon: (\d+)/.exec(job.said || "");
      showStrip(job.state === "done"
        ? "Skraper has closed and what it fetched is read" + (left ? ": " + left[1] + (left[1] === "1" ? " game still has" : " games still have") + " no video" : "")
        : "Skraper has closed, but what it fetched could not be read: " + (job.error || "no reason written"), job.state !== "done");
    }
    byItself = false;
  }
  if (onScreen()) { pane.draw(); }
}

function step(mode) {
  post({ mode: mode }).then(function (r) {
    if (!r.ok) {
      byItself = false;
      if (onScreen()) { pane.fail("Not started: " + (r.error || "no answer") + "."); }
      return;
    }
    L("SKRP", mode);
    took(r);
    watch();
  });
}

/* Polls while a step runs, and after a staging until Skraper has been seen
   open and then closed: then what arrived is read without a press. A check
   pressed meanwhile does not end the following. */
function watch() {
  if (timer) { return; }
  timer = setInterval(function () {
    if (follow && Date.now() > follow.until) { follow = null; }
    if (!atWork() && !follow) { clearInterval(timer); timer = null; return; }
    api("api/skraper.php").then(function (r) {
      if (!r.ok || !r.here) { return; }
      took(r);
      if (!follow || atWork()) { return; }
      if (r.skraper === "open") { follow.seen = true; return; }
      if (r.skraper === "closed" && follow.seen) {
        var next = follow.then;
        follow = null;
        byItself = true;
        L("SKRP", "Skraper closed: " + (next === "tidy" ? "filing the second go" : "reading what arrived"));
        step(next);
      }
    });
  }, 2000);
}

/*  inner: where the status area goes. pickedIds(): the ids selected now.
    refreshBar(): the window redraws its buttons once the helper is known to
    be here. */
export function skraperRoute(inner, pickedIds, refreshBar) {
  var area = el("div", "sk-area");
  var words = el("p", "mt-note");
  var acts = el("div", "ss-btns");
  var said = el("pre", "sk-said");
  area.appendChild(words);
  area.appendChild(acts);
  area.appendChild(said);
  area.hidden = true;
  inner.appendChild(area);

  var btn = null;          // Stage N for Skraper, on the window's own bar
  var n = 0;               // how many games are selected

  function label() {
    if (!btn) { return; }
    btn.textContent = "Stage " + n + " for Skraper...";
    btn.disabled = !n || atWork();
    btn.title = "Skraper fetches the selected games' videos itself: no logins typed into Xsegon";
  }

  function button() {
    if (!st || !st.here) { return null; }
    if (!btn) {
      btn = el("button", null, "");
      btn.type = "button";
      btn.addEventListener("click", ask);
      label();
    }
    return btn;
  }

  function buttons(list) {
    acts.textContent = "";
    list.forEach(function (b) {
      var x = el("button", null, b[0]);
      x.type = "button";
      x.addEventListener("click", b[1]);
      acts.appendChild(x);
    });
    acts.hidden = !list.length;
  }

  function fail(text) {
    area.hidden = false;
    words.className = "mt-note bad";
    words.textContent = text;
  }

  function draw() {
    if (!st || !st.here) { return; }
    var job = st.job, check = ["Check what arrived", function () { step("check"); }];
    label();
    if (!job) { area.hidden = true; return; }
    area.hidden = false;
    said.textContent = job.said || "";
    said.hidden = !job.said;
    words.className = "mt-note";
    buttons([]);
    if (job.state === "running") {
      words.textContent = job.mode === "build" ? "Staging " + (job.games || "the") + " picked games for Skraper..."
        : job.mode === "check" ? "Reading what Skraper fetched..."
        : job.mode === "retry" ? "Staging the second go: the games Skraper missed, under the names ScreenScraper knows them by..."
        : job.mode === "tidy" ? "Giving the second go's videos the names Xsegon looks for..." : "Putting Skraper's settings back...";
      return;
    }
    if (job.state === "failed") {
      fail("The step failed: " + (job.error || "no reason written") + ".");
      buttons([check]);
      return;
    }
    // Still followed: its closing is what ends this, with the window open or not.
    var later = follow ? " When Skraper is closed, Xsegon reads what arrived by itself, with this window open or not; that is all there is to do." : "";
    if (job.mode === "build") {
      words.textContent = (job.opened ? "The stand-ins are ready and Skraper is open. Choose ALL SYSTEMS in it and press Start."
        : "The stand-ins are ready, but " + (job.openNote || "Skraper could not be opened") + ". Open Skraper, choose ALL SYSTEMS in it and press Start.") + later;
      buttons([check]);
      return;
    }
    var after = [["Check again", function () { step("check"); }], ["Second go for the ones it missed...", second], ["Put Skraper's settings back", restore]];
    if (job.mode === "check") {
      words.textContent = "That is what Skraper fetched so far. A video that arrived plays on its game right away." + later;
      buttons(after);
      return;
    }
    if (job.mode === "retry") {
      words.textContent = !job.staged ? "The second go had nothing left to ask Skraper for. What it could copy from a game you already have is in place and plays."
        : (job.opened ? "The second go is staged and Skraper is open. Choose ALL SYSTEMS in it and press Start."
          : "The second go is staged, but " + (job.openNote || "Skraper could not be opened") + ". Open Skraper, choose ALL SYSTEMS in it and press Start.") +
          (follow ? " When Skraper is closed, Xsegon gives the videos the names it looks for by itself, with this window open or not." : "");
      buttons(job.staged ? [["File the second go now", function () { step("tidy"); }]] : after);
      return;
    }
    if (job.mode === "tidy") {
      words.textContent = "What Skraper fetched is read and filed: a video asked for under another name has the name Xsegon looks for, and plays on its game.";
      buttons(after);
      return;
    }
    words.textContent = "Skraper's settings are back as they were. Careful: they point at LaunchBox again.";
  }

  function second() {
    confirmWindow("A second go for the games Skraper missed?", function (box) {
      box.appendChild(el("p", null, "The helper keeps a list of games ScreenScraper knows under another name than their file's, " +
        "and of hacks and mods that can wear the video of the game they are made from. Each one still without a video is staged under that name. No game of yours is renamed."));
      box.appendChild(el("p", "confirm-game", "A hack whose own game already has its video here gets a copy of it at once. For the rest Skraper opens: choose ALL SYSTEMS and press Start in it."));
      box.appendChild(el("p", "confirm-safe", "When Skraper is closed again, Xsegon gives the videos the names it looks for by itself. A game that already has a video keeps it."));
    }, { label: "Stage the second go", run: function () {
      L("SKRP", "second go");
      post({ mode: "retry" }).then(function (r) {
        if (!r.ok) { fail("Not staged: " + (r.error || "no answer") + "."); return; }
        followFrom(false, "tidy");
        took(r);
        watch();
      });
    } });
  }

  function ask() {
    var ids = pickedIds();
    if (!ids.length) { return; }
    confirmWindow("Stage " + ids.length + (ids.length === 1 ? " game" : " games") + " for Skraper?", function (box) {
      box.appendChild(el("p", null, "A tiny stand-in file for each selected game. Skraper's settings are pointed at the stand-ins and at Xsegon's videos folder, " +
        "with a backup kept first; no path into LaunchBox or a ROM folder is written."));
      box.appendChild(el("p", "confirm-game", "Then Skraper opens: choose ALL SYSTEMS and press Start in it. No logins go into Xsegon; Skraper asks ScreenScraper with its own."));
      box.appendChild(el("p", "confirm-note", "Into: data\\videos"));
      box.appendChild(el("p", "confirm-safe", "Nothing is fetched until you press Start in Skraper, and a game that already has a video keeps it. " +
        "When Skraper is closed again, Xsegon reads what arrived by itself."));
    }, { label: "Stage", run: function () {
      L("SKRP", "stage " + ids.length);
      post({ mode: "stage", ids: ids }).then(function (r) {
        if (!r.ok) { fail("Not staged: " + (r.error || "no answer") + "."); return; }
        followFrom(false, "check");
        took(r);
        watch();
      });
    } });
  }

  function restore() {
    confirmWindow("Put Skraper's settings back?", function (box) {
      box.appendChild(el("p", null, "As they were before the first staging. Careful: those settings point at LaunchBox again."));
    }, { label: "Put them back", run: function () { step("restore"); } });
  }

  pane = { draw: draw, fail: fail, on: function () { return inner.isConnected; } };
  api("api/skraper.php").then(function (r) {
    if (!r.ok || !r.here || !inner.isConnected) { return; }
    // A staging this page did not see through (it was loaded again since): Skraper is followed from here.
    var job = r.job;
    if (!follow && job && job.staged && job.state === "done" && r.time - (job.finished || 0) < 43200) {
      followFrom(r.skraper === "open" || !!job.opened, job.mode === "retry" ? "tidy" : "check");
    }
    took(r);
    refreshBar();
    if (atWork() || follow) { watch(); }
  });

  return { button: button, count: function (picked) { n = picked; label(); } };
}
