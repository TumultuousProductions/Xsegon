/*  Turning a wheel with the scroll wheel: the game wheel, the carousel and the
    consoles rim. Three settings shape it (Settings > Xsegon Controls > Xsegon
    (Mouse and keyboard), and the gear on the game wheel, js\wheelgear.js):
      - Speed, how far a notch turns it: 5 is one game, 1 under half, 10 three.
      - Momentum: a quick flick glides on after the last notch; a slow scroll
        never does, so notch by notch stays exact.
      - Acceleration: fast notches count more (wheelBoost), since a mouse sends
        few notches a second and a long list needs it.
    A notch the other way while it glides is a brake. A notch turns one game at
    once; the rest it owes is paid a couple of games a frame, so a hard spin
    flows. The loop runs only while the hand is on it, a debt is paid or it glides. */

import { S } from "./state.js";

var SPEEDS = [0.4, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];   // Speed 1 to 10, in games a notch
var GLIDE_TAU = 0.05;    // seconds: how slowly a glide dies away, per point of Momentum
var FLICK = 8;           // games a second: slower than this is placed notch by notch, never carried on
var QUIET_MS = 90;       // no notch for this long: the hand has let go
var WINDOW_MS = 200;     // the notches a flick's speed is measured over
var V_MAX = 45;          // the fastest it glides, games a second
var STALE_MS = 1500;     // part of a game left over from longer ago than this is forgotten
var PACE_MS = 250;       // the notches a spin's pace is measured over, for Acceleration
var CALM = 8;            // notches a second: at or under this, a notch is Speed's worth exactly
var TILT = 18;           // notches a second: at or over this, it counts all Acceleration allows
var PER_FRAME = 2;       // games a frame at most while a debt is paid

function setting(key, dflt, lo, hi) {
  var v = S.controller ? S.controller[key] : undefined;
  return Math.max(lo, Math.min(hi, typeof v === "number" ? v : dflt));
}
export function wheelSpeed() { return SPEEDS[Math.round(setting("wheelSpeed", 5, 1, 10)) - 1]; }
export function wheelGlide() { return setting("wheelGlide", 4, 0, 10); }
export function wheelAccel() { return setting("wheelAccel", 5, 0, 10); }
// How many times a notch counts at this pace (notches a second): 1 up to
// CALM, rising evenly to 1 + 0.5 x Acceleration at TILT and beyond.
export function wheelBoost(pace) {
  var k = Math.max(0, Math.min(1, (pace - CALM) / (TILT - CALM)));
  return 1 + 0.5 * wheelAccel() * k;
}

/* step(n): turn by one game, n being 1 or -1. active(): whether this wheel
   is the one on screen. Returns { wheel: the event handler, stop }. */
export function spinScroller(step, active) {
  var acc = 0, dir = 0, v = 0, recent = [], taps = [], last = -1e9, raf = 0, prevT = 0, gliding = false;

  function out(most) {
    for (var n = 0; acc >= 1 && n < most; n++) { step(1); acc -= 1; }
    for (n = 0; acc <= -1 && n < most; n++) { step(-1); acc += 1; }
  }
  // Done moving, the part of a game not yet turned kept, so at a Speed of
  // 1.5 two slow notches turn three games and not two.
  function park() {
    if (raf) { cancelAnimationFrame(raf); }
    raf = 0; prevT = 0; v = 0; recent = []; gliding = false;
  }
  // And everything forgotten: a key, a grab, a brake, another view.
  function stop() { park(); acc = 0; taps = []; }
  function frame(t) {
    raf = 0;
    if (!active() || document.hidden) { stop(); return; }
    var dt = prevT ? Math.min(0.05, (t - prevT) / 1000) : 0;
    prevT = t;
    if (!gliding) {
      out(PER_FRAME);                                 // what the last notches still owe
      if (performance.now() - last < QUIET_MS || Math.abs(acc) >= 1) { raf = requestAnimationFrame(frame); return; }
      if (!wheelGlide()) { park(); return; }
      // Let go: how fast was it going at the end?
      var sum = 0;
      recent.forEach(function (r) { if (r[0] >= last - WINDOW_MS) { sum += r[1]; } });
      v = Math.max(-V_MAX, Math.min(V_MAX, sum / (WINDOW_MS / 1000)));
      if (Math.abs(v) < FLICK) { park(); return; }
      gliding = true;
    }
    acc += v * dt;
    out(PER_FRAME);
    v *= Math.exp(-dt / (GLIDE_TAU * wheelGlide()));
    if (Math.abs(v) < 1.5) { park(); return; }
    raf = requestAnimationFrame(frame);
  }

  function wheel(e) {
    var d = e.deltaY || e.deltaX;
    if (!d) { return; }
    // Lines or pages on some mice, pixels on most: a mouse's click is about
    // 100px; a touchpad sends slivers, which add up.
    var n = e.deltaMode === 1 ? d / 3 : e.deltaMode === 2 ? d * 5 : d / 100;
    var notch = Math.abs(n) >= 0.5;
    if (notch) { n = Math.sign(n); }
    var now = performance.now(), way = Math.sign(n);
    if (gliding) {
      var brake = way !== Math.sign(v);
      stop();
      if (brake) { last = now; return; }
    }
    if (way !== dir || now - last > STALE_MS) { acc = 0; recent = []; taps = []; }
    dir = way; last = now;
    // The pace, in notches a second (a touchpad's slivers added up), over
    // the last quarter second, and what this notch is worth at it.
    taps.push([now, Math.abs(n)]);
    while (taps.length && now - taps[0][0] > PACE_MS) { taps.shift(); }
    var pace = 0;
    taps.forEach(function (x) { pace += x[1]; });
    var amt = n * wheelSpeed() * wheelBoost(pace / (PACE_MS / 1000));
    recent.push([now, amt]);
    while (recent.length && now - recent[0][0] > WINDOW_MS + QUIET_MS) { recent.shift(); }
    acc += amt;
    // A notch always moves when nothing is owed, even at a slow Speed: it
    // turns a whole game at once, and the next notches pay it back.
    if (notch && acc * way >= 0 && Math.abs(acc) < 1) { step(way); acc -= way; }
    else { out(1); }
    if (!raf) { prevT = 0; raf = requestAnimationFrame(frame); }
  }

  return { wheel: wheel, stop: stop };
}
