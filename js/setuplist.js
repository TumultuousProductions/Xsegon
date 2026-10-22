/*  The Setting up list: one corner panel for a whole Set it all up run, in
 *  place of the separate corner bars. Every part has a line and bar from the
 *  start; one not begun says what it waits for, so the whole plan is on screen.
 *
 *  Drawn from api\setup.php?run=1, which reads the jobs' own files, so a page
 *  opened half way shows the same list. The separate bars still work outside a run.
 */

import { askCards } from "./askcards.js";
import { cheatListsSize } from "./cheatlists.js";
import { fillWords } from "./fillbar.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { mailArrived } from "./news.js";
import { getRetroArch } from "./raoffer.js";
import { cornerBox } from "./setupbar.js";
import { el, megabytes, plural } from "./util.js";
import { viewsLocked } from "./viewlock.js";

var TICK_MS = 1500;
var GAME_SECS = 25;                      // what the Runs check spends on one game (includes\setup.php)
var PARTS = [["games", "Your games"], ["retroarch", "RetroArch"], ["cores", "Cores"], ["fill", "Names and pictures"], ["runs", "Runs check"]];
var MARKS = { done: "✓", failed: "!", stopped: "○", skipped: "○" };

var panel = null, headSaid = null, lines = {};
var timer = null, asking = false, lastOver = false;

function sendJson(path, body) {
  return postJson(path, body);
}

/* How long the Runs check will take, in words a person plans by. */
function about(secs) {
  var m = Math.round(secs / 60);
  if (m < 1) { return "under a minute"; }
  if (m < 90) { return "about " + plural(m, "minute", "minutes"); }
  return "about " + (Math.round(m / 6) / 10) + " hours";
}

function build() {
  if (panel) { return; }
  panel = el("div", "setup-list");
  panel.hidden = true;
  var head = el("div", "sl-head");
  head.appendChild(el("span", "sl-title", "Setting up"));
  headSaid = el("span", "sl-said");
  head.appendChild(headSaid);
  panel.appendChild(head);
  PARTS.forEach(function (p) {
    var one = el("div", "sl-row waiting");
    one.dataset.part = p[0];
    var mark = el("span", "sl-mark");
    var name = el("span", "sl-name", p[1]);
    var said = el("span", "sl-line");
    var btn = el("button", "sl-btn");
    btn.type = "button";
    btn.hidden = true;
    var track = el("span", "fb-track");
    track.appendChild(el("span", "fb-fill"));
    [mark, name, btn, said, track].forEach(function (n) { one.appendChild(n); });
    panel.appendChild(one);
    lines[p[0]] = { box: one, mark: mark, said: said, btn: btn, track: track };
  });
  lines.runs.btn.textContent = "Skip";
  lines.runs.btn.title = "Leave the Runs check out. What it has found is kept, and Emulators > Runs check does it any time.";
  lines.runs.btn.addEventListener("click", skipRuns);
  lines.fill.btn.textContent = "Try again";
  lines.fill.btn.addEventListener("click", fillAgain);
  lines.retroarch.btn.textContent = "Try again";
  lines.retroarch.btn.addEventListener("click", function () { getRetroArch("the Setting up list"); });
  cornerBox().appendChild(panel);
}

/* A line that is only there when its part was selected (the cheat lists,
   videos): made the first time it has something to say, above the Runs
   check, and taken away again when it has not. */
function extraLine(part, label, onSkip) {
  if (lines[part]) { return; }
  var one = el("div", "sl-row waiting");
  one.dataset.part = part;
  var mark = el("span", "sl-mark");
  var name = el("span", "sl-name", label);
  var said = el("span", "sl-line");
  var btn = el("button", "sl-btn", "Skip");
  btn.type = "button";
  btn.hidden = true;
  btn.addEventListener("click", onSkip);
  var track = el("span", "fb-track");
  track.appendChild(el("span", "fb-fill"));
  [mark, name, btn, said, track].forEach(function (n) { one.appendChild(n); });
  panel.insertBefore(one, lines.runs.box);
  lines[part] = { box: one, mark: mark, said: said, btn: btn, track: track };
}

function dropLine(part) {
  if (!lines[part]) { return; }
  lines[part].box.remove();
  delete lines[part];
}

/* One line: its state, its words, how far its bar is (0 to 1, null while
   it is busy with something unmeasured, which makes the bar travel), and
   whether its button shows. */
function paintLine(part, state, words, frac, btn) {
  var n = lines[part];
  n.box.className = "sl-row " + state;
  n.mark.textContent = MARKS[state] || "";
  n.said.textContent = words;
  n.track.classList.toggle("wait", frac === null);
  // unmeasured: the width it had goes, or the travelling piece keeps it (none at 0%, the whole track at 100%)
  n.track.firstChild.style.width = frac === null ? "" : Math.round(Math.max(0, Math.min(1, frac)) * 100) + "%";
  n.btn.hidden = !btn;
  if (!btn) { n.btn.disabled = false; }
}

function gamesLine(r) {
  if (r.games) { paintLine("games", "done", plural(r.games, "game", "games") + " found", 1); return; }
  if (asking) { paintLine("games", "running", "choose the folder in the window that opened", null); return; }
  paintLine("games", "waiting", "none yet: Scan for Games adds them", 0);
}

function raLine(a) {
  if (a.state === "done") { paintLine("retroarch", "done", a.had ? "already here" : "ready", 1); return; }
  // Until it is in, Wheel and Carousel wait (js\viewlock.js): said where its progress is.
  var then = viewsLocked() ? "; Wheel and Carousel open once it is in" : "";
  // Stopped: Try again gets it (js\raoffer.js), so the games waiting on it are not left without a press.
  if (a.state === "failed") { paintLine("retroarch", "failed", "stopped: " + (a.error || "no reason given") + then, 0, true); return; }
  if (a.state === "waiting") { paintLine("retroarch", "waiting", (a.for === "folder" ? "starts once the folder is chosen" : "starting...") + then, 0); return; }
  if (a.step === "check") { paintLine("retroarch", "running", "checking RetroArch..." + then, null); return; }
  if (a.step === "unpack") {
    // 7zr says how far it is; tar does not, and the piece travels
    var far = typeof a.unpacked === "number";
    paintLine("retroarch", "running", "unpacking" + (far ? " " + a.unpacked + "%" : "") + ": a few minutes on a slower disk" + then, far ? a.unpacked / 100 : null);
    return;
  }
  var pct = a.total ? Math.min(100, Math.round(a.bytes * 100 / a.total)) : 0;
  paintLine("retroarch", "running", "downloading: " + megabytes(a.bytes) + " of " + megabytes(a.total) + " (" + pct + "%)" + then, a.total ? a.bytes / a.total : 0);
}

function coresLine(c) {
  if (c.state === "waiting") { paintLine("cores", "waiting", c.for === "games" ? "waiting for your games" : "waiting for RetroArch", 0); return; }
  if (c.state === "stopped") { paintLine("cores", "stopped", "not fetched: RetroArch did not arrive", 0); return; }
  if (c.state === "failed") { paintLine("cores", "failed", "stopped: " + (c.error || "no reason given"), 0); return; }
  if (c.state === "running") { paintLine("cores", "running", "fetching: " + c.got + " of " + c.all, c.all ? c.moved / c.all : 0); return; }
  paintLine("cores", "done", c.all ? c.got + " of " + c.all + " fetched" + (c.bad ? ", " + c.bad + " could not be" : "") : "nothing missing", 1);
}

function fillLine(f) {
  if (f.state === "skipped") { paintLine("fill", "skipped", "left out: Get Media > Get Pictures any time", 0); return; }
  if (f.state === "waiting") { paintLine("fill", "waiting", "waiting for your games", 0); return; }
  if (f.state === "running") {
    if (f.phase === "starting") { paintLine("fill", "running", "starting...", null); return; }
    var w = fillWords(f);
    paintLine("fill", "running", w[0], f.phase === "prepare" ? null : w[1]);
    return;
  }
  if (f.state === "failed") {
    // one more try is owed once the downloads are out of its way
    if (f.again) { paintLine("fill", "running", "stopped once: tried again when the downloads are done", null); return; }
    paintLine("fill", "failed", "stopped: " + (f.error || "no reason given"), 0, true);
    return;
  }
  if (f.state === "stopped") { paintLine("fill", "stopped", "stopped at " + f.done + " of " + f.total + ": what was filled is kept", 0); return; }
  // true: this run had no pass of its own. A pass's own none is a count, the games nothing was found for.
  if (f.none === true) { paintLine("fill", "done", "nothing to look up", 1); return; }
  paintLine("fill", "done", plural(Math.max(0, f.done - f.failed), "game", "games") + ", " + plural(f.pictures, "picture", "pictures") +
    (f.left ? ", " + f.left + " left for you to check" : ""), 1);
}

/* The cheat lists, when they were selected: one .zip by size, then its files by count. */
function cheatsLine(c) {
  if (!c || c.state === "skipped") { dropLine("cheats"); return; }
  extraLine("cheats", "Cheat lists", skipCheats);
  if (c.state === "running") {
    if (c.phase === "unpacking") { paintLine("cheats", "running", "unpacking: " + c.at + " of " + c.files, c.files ? c.at / c.files : null, true); return; }
    if (c.phase === "fetching") {
      paintLine("cheats", "running", "downloading: " + megabytes(c.bytes) + (c.total ? " of " + megabytes(c.total) : ""), c.total ? c.bytes / c.total : null, true);
      return;
    }
    paintLine("cheats", "running", "starting...", null, true);
    return;
  }
  if (c.state === "done") { paintLine("cheats", "done", "in: a game's Cheats tab has them", 1); return; }
  if (c.state === "stopped") { paintLine("cheats", "stopped", "stopped: a game's Cheats tab gets them any time", 0); return; }
  paintLine("cheats", "failed", "stopped: " + (c.error || "no reason given"), 0);
}

/* Videos, when they were selected: they wait for the names, then go as the Archive fetch goes. */
function videosLine(v) {
  if (!v || v.state === "skipped") { dropLine("videos"); return; }
  extraLine("videos", "Videos", skipVideos);
  if (v.state === "waiting") { paintLine("videos", "waiting", v.for === "fetch" ? "after the video fetch already at work" : "after the names and pictures", 0, true); return; }
  if (v.state === "running") {
    if (v.phase === "arcade") { paintLine("videos", "running", "arcade games first, from the Arcade Database: " + v.at + " of " + v.games, v.games ? v.at / v.games : null, true); return; }
    if (v.phase === "playthroughs") { paintLine("videos", "running", "asking World of Longplays what it has", null, true); return; }
    if (v.phase === "cutting") { paintLine("videos", "running", "cutting playthroughs: " + (v.cutAt || 0) + " of " + plural(v.cuts || 0, "game", "games"), v.cuts ? v.cutAt / v.cuts : null, true); return; }
    if (v.phase === "fetching" && v.total) {
      paintLine("videos", "running", "fetching: " + v.added + " of " + v.found + ", " + megabytes(v.bytes) + " of " + megabytes(v.total), v.bytes / v.total, true);
      return;
    }
    if (v.phase === "listing") { paintLine("videos", "running", "asking the Archive what it has: " + v.setsAt + " of " + v.sets, v.sets ? v.setsAt / v.sets : null, true); return; }
    if (v.phase === "matching") { paintLine("videos", "running", "looking for videos: " + v.at + " of " + v.games, v.games ? v.at / v.games : null, true); return; }
    paintLine("videos", "running", "starting...", null, true);
    return;
  }
  if (v.state === "done") {
    var none = Math.max(0, (v.games || 0) - (v.found || 0));
    paintLine("videos", "done", v.note === "none" ? "nothing to fetch" : plural(v.added || 0, "video", "videos") + " fetched" +
      (none ? ", " + plural(none, "game", "games") + " got none: Messages says why" : ""), 1);
    return;
  }
  if (v.state === "stopped") { paintLine("videos", "stopped", v.error || "stopped: what was fetched is kept", 0); return; }
  paintLine("videos", "failed", "stopped: " + (v.error || "no reason given"), 0);
}

var NOTES = {
  dry: "a test copy: nothing is started",
  none: "nothing to check",
  bios: "left out: BIOS files are missing, Messages says which",
  nodrive: "not run: the ROM drive is away",
  started: "started"
};

function runsLine(u) {
  if (u.state === "skipped") { paintLine("runs", "skipped", "left for later: Emulators > Runs check", 0); return; }
  if (u.state === "waiting") {
    if (u.for === "games") { paintLine("runs", "waiting", "waiting for your games", 0); return; }
    if (u.for === "answer") { paintLine("runs", "waiting", "waiting for your answer", 0); return; }
    paintLine("runs", "waiting", "last: " + about(u.secs) + " for " + plural(u.games, "game", "games"), 0, true);
    return;
  }
  if (u.state === "running") {
    paintLine("runs", "running", u.index ? "game " + u.index + " of " + u.total + (u.title ? ", " + u.title : "") : "starting " + plural(u.total, "game", "games"),
      u.total ? Math.max(0, u.index - 1) / u.total : 0, true);
    return;
  }
  if (u.state === "stopped") {
    paintLine("runs", "stopped", u.why || "stopped at game " + u.index + " of " + u.total + ": Emulators > Runs check carries on from there", 0);
    return;
  }
  var c = u.counts;
  if (!c) { paintLine("runs", "done", NOTES[u.note] || "done", 1); return; }
  var bad = (c.crashed || 0) + (c.nostart || 0) + (c.noanswer || 0), look = c.look || 0;
  paintLine("runs", "done", plural(c.boots || 0, "game starts", "games start") + (bad ? ", " + bad + " did not" : "") +
    (look ? ", " + look + " to look at" : "") + (bad || look ? ": Emulators > Runs check shows which" : ""), 1);
}

function paint(r) {
  build();
  gamesLine(r);
  raLine(r.retroarch);
  coresLine(r.cores);
  fillLine(r.fill);
  cheatsLine(r.cheats);
  videosLine(r.videos);
  runsLine(r.runs);
  headSaid.textContent = r.ready ? "Ready to play" : r.over ? "" : "not ready to play yet";
  headSaid.classList.toggle("ready", !!r.ready);
  panel.classList.toggle("over", !!r.over);
  panel.hidden = false;
  cornerBox().classList.add("run-on");
  // Its end may have left a message (videos and cheats, said once): the dot is read again.
  if (r.over && !lastOver) { L("SETUP", "the Setting up list is done" + (r.ready ? ": ready to play" : "")); mailArrived(); }
  lastOver = !!r.over;
  // the one question, once the games are in; a page opened later asks it too
  if (r.runs.state === "waiting" && r.runs.for === "answer" && r.games > 0) {
    if (!runsAnswered) { askRuns(r.games); }                   // (a read from before the answer must not ask it again)
  } else {
    runsAnswered = false;
    askWanted = false;
    if (runsWin) { runsWin.close(); runsWin = null; }          // answered on another page
  }
}

/*  "Check which games start?", asked once the games are in and everything else is
    at work, so nothing waits for the answer: only the person knows how long
    their PC takes. No answer (Esc, a press outside) is Later. A card a question
    (js\askcards.js): videos and the cheat lists first when they are on offer. */
var runsWin = null, runsAnswered = false, askWanted = false, askLooking = false;
var VIDEO_MB = 4.2;                      // a video's usual size, for the estimate
var VIDEO_MB_SEC = 3;                    // what the Archive gives on a good day

/*  The question waits on two looks: are the cheat lists on this PC, and how
    many games have no video the Archive may hold; they decide whether those two
    are offered. Looked up once, however many reads say the question is owed. */
function askRuns(n) {
  askWanted = true;
  if (runsWin || askLooking) { return; }
  askLooking = true;
  Promise.all([api("api/cheats.php?lists=1"), api("api/archivevid.php")]).then(function (got) {
    askLooking = false;
    if (!askWanted || runsAnswered || runsWin) { return; }      // answered meanwhile, here or on another page
    var cl = got[0], av = got[1];
    var lists = cl && cl.ok && !cl.have && !(cl.job && cl.job.state === "running") ? cl.get : null;
    var vids = av && av.ok && av.curl && !(av.job && av.job.state === "running")
      ? (av.consoles || []).reduce(function (sum, c) { return sum + (c.sets || c.wol ? c.need : 0); }, 0) : 0;
    openAsk(n, lists, vids);
  }, function () { askLooking = false; });
}

function openAsk(n, lists, vids) {
  L("RCHK", "asked: run the games check? " + plural(n, "game", "games") + (vids ? ", and videos for " + vids : "") + (lists ? ", and the cheat lists" : ""));
  function answered(yes, also) {
    runsWin = null;
    runsAnswered = true;
    askWanted = false;
    L("RCHK", (yes ? "answered: run the check, last" : "answered: later") + (also.videos ? ", videos selected" : "") + (also.cheats ? ", the cheat lists selected" : ""));
    var body = { runs: yes };
    if (vids) { body.videos = !!also.videos; }
    if (lists) { body.cheats = !!also.cheats; }
    // an answer that did not reach the server is asked for again
    sendJson("api/setup.php", body).then(function (res) { if (!res || !res.ok) { runsAnswered = false; } return read(); });
  }
  /* One question a card, in this order; Esc or a press outside is no to
     the rest. Nothing is fetched or opened unasked. */
  var cards = [];
  if (vids) {
    var mb = vids * VIDEO_MB;
    cards.push({ key: "videos", q: { title: "Videos for your games?", yes: "Yes", no: "No",
      lines: [["A short video for each game Xsegon is sure of, from archive.org: free, no account, in the background."],
              [cap(sizeWords(mb) + " for " + plural(vids, "game", "games") + ": " + about(mb / VIDEO_MB_SEC) + " on a good day."), "note"]] } });
  }
  if (lists) {
    cards.push({ key: "cheats", q: { title: "Cheat lists for your games?", yes: "Yes", no: "No",
      lines: [["For a game's Cheats tab. None is turned on by itself."], [cap(cheatListsSize(lists)) + ", from libretro.", "note"]] } });
  }
  var secs = n * GAME_SECS;
  cards.push({ key: "runs", q: { title: "Check which games start?", yes: "Yes", no: "Later",
    lines: [["Each game is opened for a few seconds to see that it starts."],
            [cap(about(secs)) + " for your " + (n === 1 ? "game" : n + " games") + ", longer on a slow computer.", "note"],
            ["Later: Emulators > Runs check, any time. Your games play without it.", "faint"]] } });
  cards.forEach(function (c) { c.q.cls = "runs-ask"; });
  runsWin = askCards(cards, function (got) { answered(got.runs, { videos: got.videos, cheats: got.cheats }); });
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function sizeWords(mb) {
  return mb >= 1024 ? (Math.round(mb / 102.4) / 10) + " GB" : Math.max(1, Math.round(mb)) + " MB";
}

function hide() {
  if (panel) { panel.hidden = true; }
  cornerBox().classList.remove("run-on");
  lastOver = false;
}

function stop() {
  clearInterval(timer);
  timer = null;
}

function read() {
  return api("api/setup.php?run=1").then(function (res) {
    if (!res || !res.ok) { return; }              // a busy server: the next read says
    if (asking) { return; }
    if (!res.run) { hide(); stop(); return; }
    paint(res.run);
  });
}

function skipRuns() {
  var going = lines.runs.box.classList.contains("running");
  lines.runs.btn.disabled = true;
  L("RCHK", "Skip pressed on the Setting up list" + (going ? ", with the check at work" : ""));
  // Either refused: said, and the button is there to press again.
  function took(what) {
    return function (res) {
      if (res && res.ok) { return; }
      lines.runs.btn.disabled = false;
      showStrip(what + ": " + ((res && res.error) || "no answer"), true);
    };
  }
  if (going) { sendJson("api/runcheck.php", { action: "stop" }).then(took("the Runs check was not stopped")); }
  sendJson("api/setup.php", { runs: false }).then(took("the Runs check was not skipped")).then(read);
}

/* Skip on a selected extra's line: a fetch at work is stopped as its own corner bar stops it. */
function stopJob(key, part, what) {
  lines[part].btn.disabled = true;
  L("SETUP", "Skip pressed on the Setting up list: " + what);
  sendJson("api/jobs.php", { stop: key }).then(function (res) {
    if (res && res.ok) { return; }
    if (lines[part]) { lines[part].btn.disabled = false; }
    showStrip(what + " was not stopped: " + ((res && res.error) || "no answer"), true);
  });
}

function skipCheats() { stopJob("cheatlists", "cheats", "the cheat lists fetch"); }

function skipVideos() {
  if (!lines.videos.box.classList.contains("waiting")) { stopJob("archivevid", "videos", "the videos fetch"); return; }
  // not begun: no longer owed
  lines.videos.btn.disabled = true;
  L("SETUP", "Skip pressed on the Setting up list: videos, before they began");
  sendJson("api/setup.php", { videos: false }).then(function (res) {
    if (res && res.ok) { return; }
    if (lines.videos) { lines.videos.btn.disabled = false; }
    showStrip("videos were not skipped: " + ((res && res.error) || "no answer"), true);
  }).then(read);
}

function fillAgain() {
  lines.fill.btn.disabled = true;
  L("FILL", "Try again pressed on the Setting up list");
  sendJson("api/fill.php", { job: "start", mode: "all", pictures: true }).then(function (res) {
    if (!res || !res.ok) { lines.fill.btn.disabled = false; showStrip("the pictures were not tried again: " + ((res && res.error) || "no answer"), true); }
    return read();
  });
}

/* A run is on (the yes was just given, or the status poll says so): follow
   it until the server says it is over and gone. */
export function runWatch() {
  if (asking || timer) { return; }
  timer = setInterval(read, TICK_MS);
  read();
}

/* The folder question, before the run exists: the plan is on screen with
   its first line asking, every other line waiting. Off, the list follows
   the run that began, or goes when none did. */
export function runAsking(on) {
  asking = on;
  if (!on) { runWatch(); return; }
  stop();
  paint({ games: 0, ready: false, over: false, retroarch: { state: "waiting", for: "folder" }, cores: { state: "waiting", for: "retroarch" },
          fill: { state: "waiting", for: "games" }, runs: { state: "waiting", for: "games" } });
}

/* The yes has just been stored: the plan at once, before the first read
   (which can wait behind the folder scan on this one-at-a-time server). */
export function runBegun(looking) {
  asking = false;
  paint({ games: 0, ready: false, over: false, retroarch: { state: "waiting" }, cores: { state: "waiting", for: "retroarch" },
          fill: { state: "waiting", for: "games" }, runs: { state: "waiting", for: "games" } });
  if (looking) { paintLine("games", "running", "looking for your games...", null); }
  runWatch();
}

/* Read now, not at the next tick: the games have just been scanned in. */
export function runPoke() { if (!asking) { read(); } }
