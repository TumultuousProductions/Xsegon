/*  Watching for a ghost: a controller whose presses arrive twice.

    Steam in the background sends keys and mouse presses for a pad's buttons
    and moves the pointer with a stick; DS4Windows and its kind show a made-up
    Xbox pad beside the real one. This file only logs what it sees: nothing
    is dropped. Pads are looked at when js\input.js looks (every 60 ms), so
    "near" is by that look. */

import { L } from "./log.js";
import { padsNow } from "./padlist.js";

var NEAR_MS = 100;            // a key this long before a pad press is seen is taken as the same press heard twice
var AFTER_MS = 30;            // and one this long after: the pad is seen late, so its key seldom follows it
var STICK_MS = 250;           // the pointer or the wheel this soon after a stick is pushed
var STILL_MS = 1500;          // and only a pointer that had rested this long counts
var PUSHED = 0.5;             // a stick this far over counts as pushed
var FIRST = 5, EVERY = 25;    // the first few are written one by one, then one line in so many
var STICKS = ["left stick left", "left stick right", "left stick up", "left stick down",
              "right stick left", "right stick right", "right stick up", "right stick down"];

var lastHeld = [];            // what each pad held at the last look: a bit a button, eight more for the sticks
var padNames = [];
var lately = [];              // the last presses heard, from pads and from the keyboard and mouse
var tally = { key: 0, click: 0, wheel: 0, pointer: 0, twin: 0 };
var untwinned = 0;            // presses no second pad repeated, while more than one was here
var hearing = false, restedAt = 0, spot = "", drift = null, shove = null;

function partName(n) { return n < 18 ? "button " + n : STICKS[n - 18]; }

function heldBits(p) {
  var bits = 0, i;
  for (i = 0; i < p.buttons.length && i < 18; i++) {
    if (p.buttons[i] && p.buttons[i].pressed) { bits |= 1 << i; }
  }
  for (i = 0; i < 4; i++) {
    var v = (p.axes && p.axes[i]) || 0;
    if (v < -PUSHED) { bits |= 1 << (18 + i * 2); } else if (v > PUSHED) { bits |= 1 << (19 + i * 2); }
  }
  return bits;
}

function tell(kind, words) {
  var n = ++tally[kind];
  if (n <= FIRST || n % EVERY === 0) { L("PAD", "ghost " + kind + ": " + words + " (" + n + " so far)"); }
}

function newest(test) {
  for (var k = lately.length - 1; k >= 0; k--) { if (test(lately[k])) { return lately[k]; } }
  return null;
}

// An event's own time, on the clock the pads are looked at by.
function timeOf(e) {
  var now = performance.now(), t = e.timeStamp;
  return t > 0 && t < now + 1000 ? t : now;
}

// Is a key at this time the shadow of a pad press seen at that one?
function near(padT, evT) { var d = padT - evT; return d <= NEAR_MS && d >= -AFTER_MS; }

// A key or a mouse press and a pad press close together: written once for the pair.
function doubled(ev, pr) {
  ev.used = pr.used = true;
  var gap = Math.round(pr.t - ev.t);
  tell(ev.kind, ev.what + " came " + (gap >= 0 ? gap + " ms before " : -gap + " ms after ") + partName(pr.n) + " was seen held on controller " + pr.pad +
    (pr.own ? ", " + Math.abs(Math.round(pr.own - ev.t)) + " ms apart by the controller's own clock" : "") +
    (tally[ev.kind] === 0 ? " | " + padNames[pr.pad] : ""));
}

// The pointer starting to move, after a rest, as a stick is pushed.
function drifted() {
  if (!shove || shove.moved || !drift) { return; }
  var gap = Math.round(drift.t - shove.t);
  if (gap < -NEAR_MS || gap > STICK_MS) { return; }
  shove.moved = true;
  tell("pointer", "the pointer began to move " + (gap >= 0 ? gap + " ms after " : -gap + " ms before ") + partName(shove.n) + " was seen on controller " + shove.pad +
    ", having rested " + (drift.rest / 1000).toFixed(1) + " s");
}

function padPressed(i, n, now, own, many) {
  var mine = { t: now, own: own, pad: i, n: n, used: false, twin: false };
  // The same button on another pad in the same moment: one controller shown twice.
  var other = newest(function (e) { return e.pad >= 0 && e.pad !== i && e.n === n && !e.twin && now - e.t <= NEAR_MS; });
  if (other) {
    other.twin = mine.twin = true;
    untwinned = Math.max(0, untwinned - 1);
    tell("twin", "controllers " + other.pad + " and " + i + " both pressed " + partName(n) +
      (own && other.own ? ", " + Math.abs(Math.round(own - other.own)) + " ms apart by their own clocks" : "") +
      ", " + untwinned + " presses without a twin" +
      (tally.twin === 0 ? " | " + other.pad + ": " + padNames[other.pad] + " | " + i + ": " + padNames[i] : ""));
  } else if (many) { untwinned++; }
  var ev = newest(function (e) { return e.pad < 0 && !e.used && near(now, e.t); });
  if (ev) { doubled(ev, mine); }
  lately.push(mine);
  if (n >= 18) { shove = mine; drifted(); }
}

function inputHeard(kind, what, e) {
  if (!e.isTrusted || e.repeat) { return; }      // Xsegon's own made-up events, and a held key, are not presses
  var mine = { t: timeOf(e), pad: -1, kind: kind, what: what, used: false };
  var pr = newest(function (x) { return x.pad >= 0 && !x.used && near(x.t, mine.t); });
  if (pr) { doubled(mine, pr); }
  lately.push(mine);
}

function pointerMoved(e) {
  var at = e.screenX + "," + e.screenY;
  if (!e.isTrusted || at === spot) { return; }   // the browser sends a move under a still pointer as the page scrolls
  var now = timeOf(e);
  spot = at;
  if (now - restedAt >= STILL_MS) { drift = { t: now, rest: now - restedAt }; drifted(); }
  restedAt = now;
}

function wheelTurned(e) {
  if (!e.isTrusted || !shove || shove.wheeled) { return; }
  var gap = Math.round(timeOf(e) - shove.t);
  if (gap < -NEAR_MS || gap > STICK_MS) { return; }
  shove.wheeled = true;
  tell("wheel", "the wheel turned " + (gap >= 0 ? gap + " ms after " : -gap + " ms before ") + partName(shove.n) + " was seen on controller " + shove.pad);
}

// Listened for only once a controller is here: a PC with none pays nothing.
function hearInput() {
  hearing = true;
  document.addEventListener("keydown", function (e) { inputHeard("key", e.key === " " ? "Space" : e.key, e); }, true);
  document.addEventListener("mousedown", function (e) { inputHeard("click", "mouse button " + e.button, e); }, true);
  document.addEventListener("wheel", wheelTurned, { capture: true, passive: true });
  document.addEventListener("mousemove", pointerMoved, true);
}

/* One look at every pad, first thing in the pad poll (js\input.js), so also
   while a window holds the pad. */
export function padGhostPoll() {
  var pads = padsNow(), now = performance.now(), here = 0, i;
  for (i = 0; i < pads.length; i++) {
    if (pads[i] && pads[i].buttons && pads[i].buttons.length) { here++; }
  }
  if (!here) { return; }
  if (!hearing) { hearInput(); }
  for (i = 0; i < pads.length; i++) {
    var p = pads[i];
    if (!p || !p.buttons || !p.buttons.length) { lastHeld[i] = 0; continue; }
    var bits = heldBits(p), fresh = bits & ~(lastHeld[i] || 0);
    lastHeld[i] = bits;
    padNames[i] = p.id;
    // The pad's own time of its last change, used only when it is from since the last look.
    var own = p.timestamp > 0 && now - p.timestamp >= 0 && now - p.timestamp <= 70 ? p.timestamp : 0;
    for (var n = 0; fresh && n < 26; n++) {
      if (fresh & (1 << n)) { padPressed(i, n, now, own, here > 1); }
    }
  }
  while (lately.length && (lately.length > 200 || now - lately[0].t > 1000)) { lately.shift(); }
}
