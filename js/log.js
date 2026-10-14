import { S } from "./state.js";

// ---------- the log ----------
/* Every action the page takes, one short line each, timestamped when it
   happened: L(code, detail). Kept in a ring here (the last 400, for the
   viewer and for a crash report) and sent to the server in batches, where
   it lands in data\log\<day>.log beside the server's own lines. Off with
   Settings > Debug > Logging. */
var LOG_ON = !(S.debug && S.debug.logging === false);
// For work done only to have a line to write: with logging off it is not done at all.
export function logOn() { return LOG_ON; }
export var LOG_MOVES = !(S.debug && S.debug.logMoves === false);
var logRing = [], logQueue = [], logTimer = null, logSeq = 0;
/* SENDING. Never fetch(keepalive): a browser allows 64 KiB of keepalive requests
   in flight, and one whose answer is never read stays in flight for good, so every
   later batch is refused in silence. A plain POST, one at a time so the lines stay
   in order, its answer read to the end. A failed batch is put back and tried again
   (4s, 8s, 16s, then every 30s, up to LOG_KEEP lines), and a LOG line then says how
   many arrived late. A batch READ and refused (4xx) is let go and counted. Only the
   page leaving uses sendBeacon, which has no answer to leave unread. */
var LOG_BATCH = 400;            // api\log.php takes 500 lines a time
var LOG_KEEP = 3000;            // lines held while nothing can be sent
var logBusy = null, logBusyAt = 0;      // the batch on its way, and since when
var logFails = 0, logFailSince = "", logFailWhy = "", logDropped = 0;
function stamp() {
  var d = new Date();
  var p = function (n, w) { return String(n).padStart(w || 2, "0"); };
  return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()) + "." + p(d.getMilliseconds(), 3);
}
/* ROUTINE CHECKS, as a count: a still-alive poll or folder-window wait that answers
   fine and fast is only counted, riding on the end of the next line as [*N]; a slow
   or failing one has a line of its own. A page left alone writes "LIVE still here
   [*N]" once every five minutes, so a quiet hour still shows the page was alive. */
var ROUTINE = /^api\/(status|running)\.php(\?beat=1)?$|^api\/(pick-folder|step)\.php$/;
var routineN = 0, lastLineAt = Date.now();
var LIVE_EVERY_MS = 300000;
function routine() {
  routineN++;
  if (Date.now() - lastLineAt >= LIVE_EVERY_MS) { L("LIVE", "still here"); }
}
// The last thing the person did, so a BUG line says what led to it.
var lastDid = "";
export function L(code, detail) {
  if (code === "NAV" || code === "CLK" || code === "KEY" || code === "PAD") { lastDid = code + " " + String(detail).slice(0, 60); }
  if (!LOG_ON) { return; }
  var text = detail === undefined ? "" : String(detail).slice(0, code === "BUG" ? 600 : 300);
  // The cut can land in the middle of an emoji, and half of one makes the
  // whole batch invalid JSON to PHP, which then refuses all of it.
  if (text.toWellFormed) { text = text.toWellFormed(); }
  if (routineN) { text += " [*" + routineN + "]"; routineN = 0; }
  lastLineAt = Date.now();
  var line = [stamp(), code, text];
  logRing.push(line);
  if (logRing.length > 400) { logRing.shift(); }
  logQueue.push(line);
  logSeq++;
  if (logQueue.length > LOG_KEEP) { logQueue.shift(); logDropped++; }
  if (logFails) { return; }       // sends are failing: the retry timer is in charge
  // errors go at once; the rest every two seconds, or when forty have piled up
  if (code === "ERR" || code === "BUG" || code === "WARN" || logQueue.length >= 40) { flushLog(); }
  else if (!logTimer) { logTimer = setTimeout(flushLog, 2000); }
}
export function flushLog(beacon) {
  clearTimeout(logTimer);
  logTimer = null;
  if (beacon) { leaveLog(); return; }
  if (logBusy || !logQueue.length) { return; }      // one at a time; sent() goes on with the rest
  var batch = logQueue.splice(0, LOG_BATCH);
  logBusy = batch;
  logBusyAt = Date.now();
  try {
    fetch("api/log.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: batch }) })
      .then(function (r) {
        // Read to the end whatever it says: see SENDING above.
        return r.text().then(function () { sent(batch, r.ok, "HTTP " + r.status, r.status >= 400 && r.status < 500); });
      })
      .catch(function (e) { sent(batch, false, (e && e.message) || "no answer", false); });
  } catch (e) { sent(batch, false, (e && e.message) || "could not be sent", false); }
}
// What became of a batch. The log must never be the thing that breaks, so
// nothing here throws and nothing here is an ERR line of its own.
function sent(batch, ok, why, refused) {
  if (logBusy !== batch) { return; }                // the page left and took it (leaveLog)
  logBusy = null;
  if (!ok) {
    if (refused) {
      logDropped += batch.length;                   // read and refused: the same lines would be refused again
    } else {
      logQueue = batch.concat(logQueue);
      while (logQueue.length > LOG_KEEP) { logQueue.shift(); logDropped++; }
    }
    if (!logFails) { logFailSince = stamp(); }
    logFails++;
    logFailWhy = why;
    clearTimeout(logTimer);
    logTimer = setTimeout(flushLog, Math.min(30000, 2000 * Math.pow(2, Math.min(logFails, 4))));
    return;
  }
  if (logFails) {
    var held = batch.length + logQueue.length;
    var said = "sent late: " + held + (held === 1 ? " line" : " lines") + " waited through " + logFails +
               (logFails === 1 ? " failed send" : " failed sends") + " since " + logFailSince + " (" + logFailWhy + ")" +
               (logDropped ? "; " + logDropped + " more could not be kept and are missing" : "");
    logFails = 0;
    logDropped = 0;
    L("LOG", said);
  }
  if (logQueue.length >= 40) { flushLog(); }
  else if (logQueue.length && !logTimer) { logTimer = setTimeout(flushLog, 2000); }
}
/* The page is leaving: what has not gone goes by sendBeacon, which outlives
   the page. A batch on its way for over a second and a half is taken along
   too (a duplicate line is better than a lost one); a fresher one is trusted
   to land. sendBeacon takes 64 KiB, so after a long failure only the newest
   lines that fit are sent. */
function leaveLog() {
  var rest = logQueue;
  logQueue = [];
  if (logBusy && Date.now() - logBusyAt > 1500) { rest = logBusy.concat(rest); logBusy = null; }
  if (!rest.length || !navigator.sendBeacon) { return; }
  var body = JSON.stringify({ lines: rest });
  while (body.length > 60000 && rest.length > 1) {
    rest = rest.slice(Math.ceil(rest.length / 4));
    body = JSON.stringify({ lines: rest });
  }
  try { navigator.sendBeacon("api/log.php", new Blob([body], { type: "application/json" })); } catch (e) { /* leaving anyway */ }
}
/* A fault in Xsegon's own code, as against something that failed (a game
   that would not start, a request that said no: those stay ERR). A BUG line
   says WHERE it happened, the error, the top of the stack as file:line, the
   last thing you did and anything the caller knows. It also goes to the
   browser's console, where the test runner turns it into a failure, and
   raises xs:bug, which main.js answers with one quiet line at the top, so a
   screen that could not open never just does nothing. The same fault twice
   in five seconds is counted, not repeated. */
var lastBug = "", lastBugAt = 0, bugRepeats = 0;
export function bug(where, err, extra) {
  var msg = err && err.message ? err.message : String(err);
  var key = where + "|" + msg, now = Date.now();
  if (key === lastBug && now - lastBugAt < 5000) { bugRepeats++; lastBugAt = now; return; }
  var again = bugRepeats ? " (the one before came " + (bugRepeats + 1) + " times)" : "";
  lastBug = key; lastBugAt = now; bugRepeats = 0;
  var top = stackTop(err), id = bugCode(where, msg, top);
  var line = where + ": " + msg + " @ " + top + (extra ? " | " + extra : "") +
             (lastDid ? " | after " + lastDid : "") + again + " | code " + id.code;
  L("BUG", line);
  try { console.error("[xs BUG] " + line); } catch (e) { /* fine */ }
  try { window.dispatchEvent(new CustomEvent("xs:bug", { detail: { where: where, message: msg, code: id.code, area: id.words } })); } catch (e) { /* fine */ }
}

/* An error code a player can read out: XS-<area>-<fingerprint>, such as XS-SET-4F2A.
   The area comes from the file at the top of the stack (or `where`), with words
   the bar can say. The fingerprint is four hex digits hashed from where, the error
   with its numbers taken out, and the file:line, so the same fault gives the same
   code on every machine running the same build, and the code finds its BUG line. */
var AREAS = [
  [/^settings/, "SET", "the settings screen"],
  [/^systems\.js/, "CON", "the consoles screen"],
  [/^(views|viewsize|list|shelf|drag)\.js/, "LST", "the game list"],
  [/^(menus|help)\.js/, "MNU", "a menu"],
  [/^(library|sidebar|tags)\.js/, "LIB", "the library"],
  [/^(hero|details|docs)\.js/, "INF", "a game's details"],
  [/^(launch|cores|cheats)\.js/, "PLY", "starting a game"],
  [/^(editors|art-editors|add|scan|fill|steam|deleted)\.js/, "EDT", "adding or editing games"],
  [/^tools\.js/, "TLS", "a tool"],
  [/^news\.js/, "MSG", "the messages"],
  [/^(snap|sound)\.js/, "MED", "videos or sound"],
  [/^input\.js/, "INP", "the controls"],
  [/^(status|offline)\.js/, "SRV", "talking to Xsegon's server"]
];
export function bugCode(where, msg, top) {
  var file = (String(top).match(/^([\w.-]+\.js)/) || [])[1] || "";
  var area = ["APP", "Xsegon"];
  for (var i = 0; i < AREAS.length; i++) {
    if (AREAS[i][0].test(file) || AREAS[i][0].test(String(where))) { area = [AREAS[i][1], AREAS[i][2]]; break; }
  }
  var seed = where + "|" + String(msg).replace(/\d+/g, "#") + "|" + String(top).split(" < ")[0];
  var h = 5381;
  for (var j = 0; j < seed.length; j++) { h = ((h * 33) ^ seed.charCodeAt(j)) >>> 0; }
  var print = ("000" + (h & 0xffff).toString(16).toUpperCase()).slice(-4);
  return { code: "XS-" + area[0] + "-" + print, words: area[1] };
}

// Something odd that did not break anything yet: a value of the wrong kind,
// a thing that should be there and is not. Worth reading before it is a BUG.
export function logWarn(detail) {
  L("WARN", detail);
  try { console.warn("[xs WARN] " + detail); } catch (e) { /* fine */ }
}

// The top three frames as file:line, which is what finding it needs.
function stackTop(err) {
  var s = err && err.stack ? String(err.stack) : "";
  var frames = s.split("\n").map(function (l) {
    var m = l.match(/([\w.-]+\.js):(\d+):(\d+)/);
    // guard() and bug() themselves say nothing about where the fault was
    return m && m[1] !== "log.js" ? m[1] + ":" + m[2] : null;
  }).filter(Boolean);
  return frames.length ? frames.slice(0, 3).join(" < ") : "no stack";
}

/* fn, but a throw inside it is a BUG line naming `where` instead of a dead
   screen. For anything that opens a screen or paints one row of many: one
   bad row costs that row, not the whole screen. */
export function guard(where, fn, extra) {
  return function () {
    try { return fn.apply(this, arguments); }
    catch (e) { bug(where, e, typeof extra === "function" ? extra.apply(this, arguments) : extra); return undefined; }
  };
}

// What a value looks like, short enough for a log line.
export function shapeOf(v) {
  var kind = v === null ? "null" : Array.isArray(v) ? "list" : typeof v === "object" ? "set" : typeof v;
  var text;
  try { text = JSON.stringify(v); } catch (e) { text = String(v); }
  return kind + " " + String(text).slice(0, 80);
}

// What a module has to say as the page leaves: run ahead of the last send, so its line goes with it.
var leaving = [];
export function beforeLeave(fn) { leaving.push(fn); }

export function initLog() {
  window.addEventListener("pagehide", function () {
    leaving.forEach(function (fn) { try { fn(); } catch (e) { /* leaving anyway */ } });
    L("BOOT", "leave");
    flushLog(true);
  });
  window.addEventListener("error", function (e) {
    // The browser's own file:line:column as well, for a stack that has none.
    bug("uncaught", e.error || e.message, "at " + (e.filename || "").split("/").pop() + ":" + e.lineno + ":" + e.colno);
  });
  window.addEventListener("unhandledrejection", function (e) {
    bug("unhandled promise", e.reason);
  });
  // Every button, by its id or its words, wherever it is. One listener.
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("button, #brand-logo.as-orb, a.nav-doc, .switem, .syscard, .tile, .row, .witem, .gcard, .ctx-item") : null;
    if (!b) { return; }
    var what = b.id || b.getAttribute("data-menu") || (b.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40) || b.className;
    L("CLK", what);
  }, true);
  // A key or a click makes the next request yours, for "working..." below.
  document.addEventListener("keydown", heardInput, true);
  document.addEventListener("pointerdown", heardInput, true);
}

/* "Working...": a click that seems to do nothing is the worst kind of slow.
   This server answers one request at a time, so a press can wait behind
   another job. A request you started (within a second of a
   key, click or pad press) that takes longer than 0.4s shows a small mark
   until it answers. Polls and the log never do: they are not yours. */
var BUSY_AFTER_MS = 400;
var lastInput = -1e9, busyN = 0, busyTimer = null, busyEl = null;
export function heardInput() { lastInput = Date.now(); }
function paintBusy(on) {
  if (on && !busyEl) {
    busyEl = document.createElement("div");
    busyEl.className = "busy-mark";
    busyEl.setAttribute("role", "status");
    busyEl.textContent = "working...";
    document.body.appendChild(busyEl);
  }
  if (busyEl) { busyEl.classList.toggle("on", on); }
  document.body.classList.toggle("busy", on);
}
function busyStart(path) {
  // Nor the rest of a long list, asked for as it goes (js\more.js): the first lot was yours, and it is in.
  if (Date.now() - lastInput > 1000 || /^api\/(log|running|status|step)\.php/.test(path) || /[?&]from=\d/.test(path)) { return false; }
  busyN++;
  if (!busyTimer) { busyTimer = setTimeout(function () { busyTimer = null; if (busyN > 0) { paintBusy(true); } }, BUSY_AFTER_MS); }
  return true;
}
function busyEnd() {
  busyN = Math.max(0, busyN - 1);
  if (busyN === 0) { clearTimeout(busyTimer); busyTimer = null; paintBusy(false); }
}

export function api(path, opts) {
  var t0 = Date.now();
  var method = (opts && opts.method) || "GET";
  if (busyStart(path)) {
    return apiCall(path, opts, t0, method).then(function (j) { busyEnd(); return j; });
  }
  return apiCall(path, opts, t0, method);
}
/* A POST with a JSON body, which is what nearly every save is: the one place
   the method and the header are written. A request that needs
   anything else (keepalive, no body at all) still goes through api(). */
export function postJson(path, body) {
  return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
/* The fast lane (router-fast.php): a second server for the reads a person
   waits on, so they never queue behind the main server's work. When it does
   not answer, answers as anything but this folder's fast lane, or refuses, the
   request goes to the main server at once and the lane rests 10 seconds (short:
   the lane is often up a second after the page first asks). Ten misses in a row
   and it rests for good. A POST (minimise, close) is sent again only when
   nothing answered at all, so it never happens twice. */
var LANE_READS = /^api\/(running|library|game|step|hide|changelog|states)\.php(\?|$)/;
var LANE_POSTS = /^api\/window\.php$/;
var LANE_REST_MS = 10000;
var LANE_MAX_MISSES = 10;
var laneRestUntil = 0, laneMisses = 0;
function laneFor(path, method) {
  var X = window.XSEGON || {};
  if (!X.fastLane || Date.now() < laneRestUntil) { return null; }
  var which = method === "GET" ? LANE_READS : method === "POST" ? LANE_POSTS : null;
  return which && which.test(path) ? X.fastLane : null;
}
function laneDown(why) {
  if (Date.now() < laneRestUntil) { return; }        // resting already: this one was on its way before
  laneMisses++;
  if (laneMisses >= LANE_MAX_MISSES) {
    laneRestUntil = Infinity;
    L("LANE", "the fast lane " + why + ", " + laneMisses + " times in a row; the main server takes everything from now on");
    return;
  }
  if (laneMisses === 1) { L("LANE", "the fast lane " + why + "; the main server takes everything, and it is tried again every 10s"); }
  laneRestUntil = Date.now() + LANE_REST_MS;
}
function laneUp() {
  if (laneMisses) { L("LANE", "the fast lane answers, after " + laneMisses + (laneMisses === 1 ? " miss" : " misses")); laneMisses = 0; }
}
/* For the log group only (tests\t-log.js): shorter waits, so ten fast lane
   misses and a quiet page's LIVE line are seen in seconds rather than
   minutes. The lane's count of misses starts again from none. */
export function logTuning(laneRestMs, liveEveryMs) {
  LANE_REST_MS = laneRestMs;
  LIVE_EVERY_MS = liveEveryMs;
  laneRestUntil = 0;
  laneMisses = 0;
}
// Resolves to { r: Response, fast: true|false }, or rejects as fetch does.
function send(path, opts, method) {
  var lane = laneFor(path, method);
  if (!lane) { return fetch(path, opts).then(function (r) { return { r: r, fast: false }; }); }
  return fetch(lane + "/" + path, Object.assign({}, opts, { mode: "cors" })).then(function (r) {
    var id = r.headers.get("X-Xsegon-Lane");
    // A 404 from game.php is an answer (no such game); a 5xx on a read is
    // the lane's own trouble (a refused write among them), and a 404 on a
    // POST is its router refusing the path.
    var bad = id !== (window.XSEGON || {}).laneId ? "answered as another server"
            : method === "GET" && r.status >= 500 ? "failed a read (" + r.status + ")"
            : method !== "GET" && r.status === 404 ? "refused it" : "";
    if (!bad) { laneUp(); return { r: r, fast: true }; }
    laneDown(bad + " on " + path.split("?")[0]);
    if (method !== "GET") { return { r: r, fast: true }; }     // it did answer: never a second minimise
    return fetch(path, opts).then(function (m) { return { r: m, fast: false }; });
  }, function (err) {
    laneDown("did not answer (" + (err && err.message) + ")");
    return fetch(path, opts).then(function (m) { return { r: m, fast: false }; });
  });
}

/* A still-alive check that takes seconds means the PC is choked. The server
   is asked to write down what with (api\busy.php, a BUSY line), at most once
   a minute, and never with logging off. */
var SLOW_CHECK_MS = 3000, BUSY_EVERY_MS = 60000, busyAskedAt = -BUSY_EVERY_MS;
function slowCheck(path, ms) {
  if (!LOG_ON || ms < SLOW_CHECK_MS || !/^api\/(status|running)\.php/.test(path) || Date.now() - busyAskedAt < BUSY_EVERY_MS) { return; }
  busyAskedAt = Date.now();
  try {
    fetch("api/busy.php", { method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ check: path.split("?")[0].replace("api/", ""), ms: ms }) })
      .then(function (r) { return r.text(); }).catch(function () { /* the log never breaks the page */ });
  } catch (e) { /* nor here */ }
}

function apiCall(path, opts, t0, method) {
  return send(path, opts, method).then(function (sent) {
    var r = sent.r;
    return r.json().catch(function () { return { ok: false, error: "bad response" }; }).then(function (j) {
      var ms = Date.now() - t0;
      slowCheck(path, ms);
      // the routine checks are counted unless slow or failing (ROUTINE above);
      // everything else is a line
      var quiet = method === "GET" && ROUTINE.test(path) && ms < 300 && j.ok !== false;
      if (quiet) { routine(); } else { L(j.ok === false ? "ERR" : "API", method + " " + path.split("?")[0].replace("api/", "") + (path.indexOf("?") > 0 ? "?" + path.split("?")[1].slice(0, 60) : "") + " " + ms + "ms" + (sent.fast ? " fast" : "") + (j.ok === false ? " FAIL " + (j.error || "") : "")); }
      return j;
    });
  }, function (err) {
    L("ERR", method + " " + path.split("?")[0] + " network: " + (err && err.message));
    return { ok: false, error: "network: " + (err && err.message) };
  });
}
