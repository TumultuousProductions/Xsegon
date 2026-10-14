/*  The two things that watch rather than wait: the screensaver, which comes
    up when nobody has touched anything, and the status poll, which asks the
    server every few seconds whether a game is running and what it made of
    the last launch.                                                        */

import { inApp } from "./appwindow.js";
import { openDetails } from "./details.js";
import { reloadKeeping } from "./editors.js";
import { fillSaid, fillWatch } from "./fillbar.js";
import { paintHero } from "./hero.js";
import { jobsWatch } from "./jobbars.js";
import { clearedErr, showFinished, showStrip, watchGame, watched, whenSaved } from "./launch.js";
import { L, api, heardInput } from "./log.js";
import { mailOpen, mailUnread, troubleSeen } from "./news.js";
import { serverAnswered } from "./offline.js";
import { askAutoRuns, paintRunsBar } from "./runsbar.js";
import { runWatch } from "./setuplist.js";
import { armBrowse, gameRunning, setGameRunning, stopVideo } from "./snap.js";
import { $details, $editor, $guard, $settings, $status, $strip, S, games, sel } from "./state.js";
import { artUrl, el, hhmm } from "./util.js";
import { setThumbsBy, thumbsBy } from "./viewset.js";

// ---------- screensaver ----------
/* What a console does when you walk away. Idle is measured from the last real
   input, not a timer its own repaints reset, or the status poll keeps it awake
   for ever. Any key, click, or pad press dismisses it. */

var idleSince = Date.now();
var saverOn = false;
var saverTimer = null;
var saverStarting = false;
var saverSeq = 0;                        // moved on by any input: a slide on its way is then not wanted
var $saver = document.getElementById("saver");

// The press that puts the screensaver away is not also carried out (js\input.js).
export function saverUp() { return saverOn; }

export function touch() {
  heardInput();                         // a pad press counts as yours for "working..." (log.js)
  idleSince = Date.now();
  saverSeq++;
  if (saverOn) { stopSaver(); }
}

/* Only games with a picture, shown once it has arrived. One that will not load
   is struck off for the session by address (so a replaced picture is tried
   afresh); with nothing left, the screensaver does not come up, and goes if up. */
var saverDead = {};
var saverShown = null;

function saverPool() {
  return games.filter(function (g) { return g.hasArt && !saverDead[artUrl(g, "box", true)]; });
}

export function checkIdle() {
  var cfg = S.screensaver || {};
  if (!cfg.enabled || saverOn || saverStarting || !saverPool().length) { return; }
  // Not over an open panel, the mailbox, or a game being played.
  if (!$details.hidden || !$settings.hidden || !$editor.hidden || mailOpen() || gameRunning) { return; }
  if (Date.now() - idleSince > (cfg.afterMin || 5) * 60000) { startSaver(); }
}

function startSaver() {
  // Nothing on screen until the first slide's picture has loaded.
  saverStarting = true;
  nextSlide(function (ok) {
    saverStarting = false;
    if (!ok) { return; }
    L("SAVR", "on, " + saverPool().length + " games with a picture");
    stopVideo();
    saverOn = true;
    $saver.hidden = false;
    saverTimer = setInterval(function () {
      nextSlide(function (shown, why) {
        if (!shown && why === "empty") { L("SAVR", "nothing left to show, off"); stopSaver(); }
      });
    }, ((S.screensaver || {}).everySec || 12) * 1000);
  });
}

function stopSaver() {
  saverOn = false;
  $saver.hidden = true;
  clearInterval(saverTimer);
  saverTimer = null;
}

/* The next slide: its picture fetched before anything on screen changes; one
   that fails is struck off and another tried, up to a dozen. done(shown, why):
   "empty" with nothing left, "touched" when someone came back, "slow" past eight
   seconds (the busy server's fault, not the picture's, so not struck off). */
function nextSlide(done) {
  var seq = saverSeq, tries = 0;
  (function attempt() {
    if (seq !== saverSeq) { done(false, "touched"); return; }
    var pool = saverPool();
    if (!pool.length) { done(false, "empty"); return; }
    if (tries++ >= 12) { done(false, "tries"); return; }
    // Not the same cover twice running, when there is another to show.
    var fresh = pool.length > 1 ? pool.filter(function (x) { return x.id !== saverShown; }) : pool;
    var g = fresh[Math.floor(Math.random() * fresh.length)];
    var url = artUrl(g, "box", true);
    var art = el("img", "saver-art");
    art.alt = "";
    var slow = setTimeout(function () {
      art.onload = art.onerror = null;
      done(false, "slow");
    }, 8000);
    art.onload = function () {
      clearTimeout(slow);
      if (!art.naturalWidth) { art.onerror(); return; }   // loaded, but nothing in it
      if (seq !== saverSeq) { done(false, "touched"); return; }
      paintSaver(g, art);
      done(true);
    };
    art.onerror = function () {
      clearTimeout(slow);
      saverDead[url] = true;
      L("SAVR", "no picture, skipped " + g.title);
      attempt();
    };
    art.src = url;
  })();
}

function paintSaver(g, art) {
  saverShown = g.id;
  $saver.textContent = "";
  $saver.appendChild(art);

  var cap = el("div", "saver-cap");
  cap.appendChild(el("div", "saver-title", g.title));
  cap.appendChild(el("div", "saver-sub", g.platform + (g.released ? "  ·  " + g.released.slice(0, 4) : "")));
  if ((S.screensaver || {}).mode === "clock") {
    var now = new Date();
    cap.appendChild(el("div", "saver-clock",
      String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0")));
  }
  $saver.appendChild(cap);
}

// ---------- status ----------

var caps = null;
export var lastStatus = null;                  // the last answer, for a repaint on demand

/* Consecutive failed polls. One means nothing: this server answers one request
   at a time, so a poll can miss behind a long copy. Three in a row means it has gone. */
var misses = 0;
export var MISSES_BEFORE_OFFLINE = 3;

/*  Two answers. api/running.php every time: whether a game runs, the last
    launch error, a damaged file. api/status.php, which rebuilds the library and
    is the costly one, only when the page opens, when its window comes back to
    the front, after a game, and once a minute. */
var lastFullAt = 0;
var fullWanted = true;
var FULL_EVERY_MS = 60000;
/* The window came back to the front: the full status, a moment later (js/main.js
   wires it), since a minimise pressed just after would wait behind it on this
   one-at-a-time server. Skipped if the window has gone again. */
var FOCUS_WAIT_MS = 1500;
var focusWait = null;
export function statusOnFocus() {
  clearTimeout(focusWait);
  focusWait = setTimeout(function () {
    focusWait = null;
    fullWanted = true;
    if (!document.hidden) { pollStatus(); }
  }, FOCUS_WAIT_MS);
}

/*  The main server stuck on one thing: the fast lane, which answers this poll,
    says how long it has been on the same request (mainBusy). Said at two minutes
    and at ten; at fifteen the lane's minder ends it (bin\fastlane.ps1). */
var busyStep = 0;
function mainBusyNote(mb) {
  var step = !mb ? 0 : mb.sec >= 600 ? 2 : mb.sec >= 120 ? 1 : 0;
  if (step === busyStep) { return; }
  if (step > busyStep) {
    var mins = Math.floor(mb.sec / 60);
    showStrip(step === 2
      ? "Xsegon has not answered for " + mins + " minutes (stuck on " + mb.what + "). If this goes on it will be closed: start it again then."
      : "Xsegon has been busy with one thing for " + mins + " minutes (" + mb.what + "). Anything you press waits behind it.", step === 2);
  }
  busyStep = step;
}

/* When a kept failure happened, on the message itself: without it, an old
   "exited with code 1" reads as happening now. */
function whenErr(iso) {
  var w = iso ? whenSaved(iso) : "";
  return w ? "  (" + w + ")" : "";
}

/* A failed launch is said on the strip once, when it happens, and kept in the
   mailbox (includes\news.php). One from before this page opened is the mailbox's
   alone, and one already said is not repainted over newer news. */
var openedAt = Date.now();
var saidErr = null;
function freshError(e) {
  if (!e) { return false; }
  var at = e.at || "?";
  if (at === clearedErr || at === saidErr) { return false; }
  var t = Date.parse(e.at || "");
  return isNaN(t) || t >= openedAt - 5000;
}
function sayError(e, withWhen) {
  saidErr = e.at || "?";
  showStrip(e.title + ": " + e.error + (withWhen ? whenErr(e.at) : ""), true, null, saidErr, troubleSeen("launch:" + (e.gameId || e.title || "?")));
}

/* One check at a time: sent regardless, they stand in line on a PC too busy to answer and add to its load.
   One not answered in half a minute is given up on, so the watchdog (three minutes) still hears from the page. */
var POLL_WAIT_MS = 30000;
var pollOut = 0;                         // when the check still out was sent; 0 with none out
var pollHeld = 0;                        // checks not sent while that one was out
// For the report group only (tests\t-report.js): a shorter wait, so giving up is seen in seconds.
export function pollTuning(waitMs) { POLL_WAIT_MS = waitMs; }

export function pollStatus() {
  var now = Date.now();
  if (pollOut && now - pollOut < POLL_WAIT_MS) {
    if (!pollHeld++) { L("LIVE", "the last still-alive check is not answered yet (sent " + Math.round((now - pollOut) / 1000) + " s ago): no other is sent until it is, or until " + Math.round(POLL_WAIT_MS / 1000) + " s have passed"); }
    return;
  }
  if (pollOut) { L("LIVE", "no answer to the still-alive check in " + Math.round((now - pollOut) / 1000) + " s: asking again"); pollHeld = 0; }
  var sent = pollOut = now;
  var full = fullWanted || !lastStatus || now - lastFullAt > FULL_EVERY_MS;
  if (full) { fullWanted = false; }
  // beat=1: the app window's heartbeat, which bin\watchdog.ps1 watches.
  api((full ? "api/status.php" : "api/running.php") + (inApp ? "?beat=1" : "")).then(function (st) {
    // The answer to the check that is out: the next one may go. A late answer to one given up on changes nothing here.
    if (pollOut === sent) {
      if (pollHeld) { L("LIVE", "the still-alive check was answered after " + Math.round((Date.now() - sent) / 1000) + " s; " + pollHeld + " not sent meanwhile"); }
      pollOut = 0;
      pollHeld = 0;
    }
    // A network failure and a 500 are the same thing from here: no answer. A
    // refusal WITH an answer (ok:false) is not; the fast lane answering for a
    // main server that has gone (mainUp false) counts as no answer.
    if ((!st.ok && /^network:|^bad response/.test(String(st.error || ""))) || st.mainUp === false) {
      if (full) { fullWanted = true; }
      misses++;
      if (misses >= MISSES_BEFORE_OFFLINE) { serverAnswered(false, pollStatus); }
      return;
    }
    misses = 0;
    serverAnswered(true, pollStatus);
    mainBusyNote(st.mainBusy);
    // A Fill in pass at work, or one that ended and has not been said yet
    // (a page opened or reloaded meanwhile): its bar takes it from here.
    if (st.fill && st.fill.mode !== "look" && (st.fill.state === "running" || !fillSaid(st.fill.started))) { fillWatch(); }
    // The Runs check's corner bar, and the check Set it all up owes.
    // (only the light poll carries it, so only the light poll can say it is gone)
    if (st.runs || st.light) { paintRunsBar(st.runs || null); }
    if (st.autoRuns === "ready") { askAutoRuns(); }
    // A setting-up run under way: its list comes up, whichever page this is.
    if (st.setupRun) { runWatch(); }
    // Another background job at work or just ended (trailers, a copy, an unpack): its bar in the corner.
    if (st.jobs) { jobsWatch(); }
    if (!st.ok) { if (full) { fullWanted = true; } return; }
    if (!st.light) {
      caps = st.retroarch;
      lastStatus = st;
      lastFullAt = Date.now();
      paintStatus(st);
      if (st.mail) { mailUnread(st.mail.unread); }
    }

    // A snap must never play over a running game, nor start under one.
    var wasRunning = gameRunning;
    setGameRunning(!!st.running);
    if (gameRunning) { stopVideo(); }
    else if (wasRunning) { armBrowse(); }

    var newError = freshError(st.error);
    var w = watched.game;
    if (st.running) {
      watchGame(st.running.title, st.running.startedAt || null, true);
      // With RetroArch's quit_press_twice on, "I pressed quit and nothing
      // happened" is a mystery from ten feet away: say it. Only for RetroArch
      // (kind, from bin\launch.ps1): a Steam game or a program is quit from inside itself.
      var how = (st.running.kind && st.running.kind !== "retroarch") ? " - quit the game to come back"
        : (caps && caps.quitTwice) ? " - press quit twice in RetroArch"
        : " - quit in RetroArch to come back";
      runningId = st.running.gameId || runningId;
      showStrip("playing " + st.running.title + how, false, st.running);
    } else if (w && (w.seen || Date.now() - w.at > 20000)) {
      // The game the bottom line was about has ended: an error if it left
      // one, else "Finished", else nothing. Counts and play time moved.
      watched.game = null;
      fullWanted = true;
      playedAgain(runningId);
      runningId = null;
      if (newError) {
        sayError(st.error, true);
      } else if (!S.launch || S.launch.showFinished !== false) {
        showFinished(w);
      } else if ($strip.dataset.kind === "running") {
        $strip.hidden = true;
      }
    } else if (w) {
      // just pressed Play and not seen running yet: leave "running: X" up
    } else if (st.damaged && st.damaged.length && ("damaged:" + st.damaged[0].file + st.damaged[0].at) !== clearedErr) {
      // A file of yours that will not read: said until it reads again, and
      // Xsegon is not saving over it meanwhile (includes\boot.php).
      showStrip(st.damaged[0].message, true, null, "damaged:" + st.damaged[0].file + st.damaged[0].at, troubleSeen("damaged:" + st.damaged[0].file));
    } else if (newError) {
      // One this page did not start itself (another window's Play): once.
      sayError(st.error, false);
    } else if ($strip.dataset.kind === "running" && !$strip.hidden) {
      // "playing X" left from before the page last looked (a reload mid-game)
      $strip.hidden = true;
    }
  });
}

/*  The game that just ended: its play time, read again, since the list was
    loaded before it was played. api/game.php counts it fresh; the row in hand
    is updated and the panel showing it painted again. */
var runningId = null;
function playedAgain(id) {
  if (!id) { return; }
  api("api/game.php?id=" + encodeURIComponent(id)).then(function (res) {
    if (!res.ok || !res.game) { return; }
    var marked = null;                     // NEEDS FIX as the rows in hand have it; null: not listed here
    games.forEach(function (g) {
      (g.id === id ? [g] : []).concat((g.versions || []).filter(function (v) { return v.id === id; })).forEach(function (x) {
        x.seconds = res.game.seconds; x.plays = res.game.plays; x.lastPlayed = res.game.lastPlayed;
        if (marked === null) { marked = x.needsFix || ""; }
      });
    });
    L("LNCH", "play time read again: " + (res.game.plays || 0) + " play(s), " + (res.game.seconds || 0) + "s");
    // NEEDS FIX follows the launch that just ended. The mark is the "needs fix"
    // tag and a filter too, so the rows are read again, as a tag change does.
    var now = res.game.needsFix || "";
    if (marked !== null && marked !== now) {
      L("FIX", (res.game.title || id) + (now ? ": NEEDS FIX put on after that launch (" + now + ")" : ": NEEDS FIX taken off after that play") + "; reading the list again");
      reloadKeeping(games[sel] ? games[sel].id : null);
      return;
    }
    if (!games[sel] || games[sel].id !== id) { return; }
    paintHero(games[sel]);
    if (!$details.hidden) { openDetails(); }
  });
}

export function stopGame() {
  api("api/quit.php", { method: "POST" }).then(function (r) {
    if (r.ok) { showStrip("asked RetroArch to quit…", false); return; }
    // Explain the missing capability rather than failing quietly.
    showStrip(r.detail ? (r.error + " - " + r.detail) : ("could not quit: " + r.error), true);
  });
}

// Links another part adds at the end of the status line.
var statusLinks = [];
export function addStatusLink(label, title, run) { statusLinks.push({ label: label, title: title, run: run }); }

export function paintStatus(st) {
  var c = st.checks, n = st.counts;
  setThumbsBy(st.thumbsBy || thumbsBy);
  $status.textContent = "";

  function stat(label, value, dot, big) {
    var s = el("span", "stat");
    if (dot) { s.appendChild(el("span", "dot " + dot)); }
    s.appendChild(el("span", "k", label));
    s.appendChild(el("span", "v" + (big ? " big" : ""), value));
    $status.appendChild(s);
  }

  stat("roms", c.romRoot.set === false ? "not set" : c.romRoot.present ? c.romRoot.path : "missing",
       c.romRoot.set === false ? null : c.romRoot.present ? "good" : "bad");
  stat("games", String(n.games), null, true);
  stat("platforms", String(n.platforms));
  stat("no art", String(n.noArt), n.noArt ? "warn" : "good");
  if (st.thumbs) {
    stat("thumbs", st.thumbs.total + " @ " + st.thumbs.width + "px", "good");
  } else {
    stat("thumbs", "not built", "warn");
  }
  stat("played", hhmm(n.secondsPlayed) || "0m");
  if (c.stale) { stat("library", "stale - import", "warn"); }

  // Two RetroArch config flags Xsegon would like, reported as they are:
  // turning them on changes your RetroArch, so this only reports.
  if (st.retroarch) {
    stat("quit cmd", st.retroarch.canQuit ? "enabled" : "off",
         st.retroarch.canQuit ? "good" : "off");
    stat("resume", st.retroarch.canResume ? "enabled" : "off",
         st.retroarch.canResume ? "good" : "off");
  }

  statusLinks.forEach(function (k) {
    var b = el("button", "stat-link", k.label);
    b.type = "button";
    b.title = k.title;
    b.addEventListener("click", k.run);
    $status.appendChild(b);
  });

  // The guardrail, at the size of the problem. Minimise folds it into a red
  // mark in the masthead until the drive comes back. Only this warning's own
  // child is cleared: the missing-files warning lives in the same strip.
  var romBox = document.getElementById("guard-rom") || $guard;
  romBox.textContent = "";
  var mark = document.getElementById("warn-mark");
  if (!c.romRoot.present) {
    var folded = localStorage.getItem("xs-warn-folded") === "1";
    mark.classList.toggle("shown", folded);
    if (!folded) {
      var box = el("div", "guardrail");
      box.appendChild(el("strong", null, "ROMs not plugged in"));
      box.appendChild(el("span", null, c.romRoot.path +
        " is not there. Nothing here will launch until it is."));
      var min = el("button", "g-min", "Minimise");
      min.addEventListener("click", function () {
        localStorage.setItem("xs-warn-folded", "1");
        paintStatus(st);
      });
      box.appendChild(min);
      romBox.appendChild(box);
    }
  } else {
    mark.classList.remove("shown");
    localStorage.removeItem("xs-warn-folded");   // next time it is gone, say so in full
  }
}
