/*  Scrolling the list and the grid with the mouse wheel: a little give.

    The browser's own wheel scroll stops the moment the notches do. Here each
    notch still moves the same distance, eased in, and a quick flick carries
    on a little past the last notch and settles, the way the game wheel's
    Momentum does (js\wheelscroll.js); the same setting governs both, and 0
    hands the list back to the browser untouched. A slow scroll is never
    carried on, so notch by notch stays exact. In the list and the grid a
    scroll kept up for over a second speeds up gently, to a fifth further a
    notch at most, and a pause starts it again at the plain speed;
    Acceleration at 0 turns that off as it does the game wheel's.

    Left to the browser: a sideways scroll (Shift, or a tilt), Ctrl for zoom,
    and any other box. A key, a click, the scrollbar, or the selection
    bringing a row into view all stop a glide where it is. */

import { bumpEnd } from "./bump.js";
import { wheelAccel, wheelGlide } from "./wheelscroll.js";

var EASE = 0.07;        // seconds: how quickly a notch's distance is covered
var CARRY = 0.022;      // seconds of the flick's speed carried on, per point of Momentum
var FLICK = 1200;       // pixels a second: slower than this is never carried on
var QUIET_MS = 90;      // no notch for this long: the hand has let go
var WINDOW_MS = 200;    // the notches a flick's speed is measured over
var LONG_MS = 1000;     // scrolled on this long without a pause: it starts to speed up
var RAMP_MS = 1000;     // and is at its fastest this much later
var QUICKEST = 0.2;     // a fifth further a notch, at most
var PAUSE_MS = 300;     // a pause this long, or a turn the other way, starts again at the plain speed

/* box: the scrolling element. active(): whether it is the list, the grid or
   the shelf. quickens(): whether a long scroll there speeds up. */
export function listGlide(box, active, quickens) {
  var target = null, raf = 0, prevT = 0, last = 0, recent = [], carried = false, setTo = null, runFrom = 0, runWay = 0;

  function max() { return Math.max(0, box.scrollHeight - box.clientHeight); }
  function stop() {
    if (raf) { cancelAnimationFrame(raf); }
    raf = 0; prevT = 0; target = null; recent = []; carried = false; setTo = null;
  }
  function frame(t) {
    raf = 0;
    if (target === null || !active() || document.hidden) { stop(); return; }
    // Moved by something else (the scrollbar, a row brought into view): theirs.
    if (setTo !== null && Math.abs(box.scrollTop - setTo) > 2) { stop(); return; }
    var dt = prevT ? Math.min(0.05, (t - prevT) / 1000) : 1 / 60;
    prevT = t;
    var now = performance.now();
    if (!carried && now - last >= QUIET_MS) {
      carried = true;                       // let go: how fast was it going?
      var sum = 0;
      recent.forEach(function (r) { if (r[0] >= last - WINDOW_MS) { sum += r[1]; } });
      var v = sum / (WINDOW_MS / 1000);
      if (Math.abs(v) >= FLICK) { target = Math.max(0, Math.min(max(), target + v * CARRY * wheelGlide())); }
    }
    var before = box.scrollTop;
    box.scrollTop = before + (target - before) * (1 - Math.exp(-dt / EASE));
    setTo = box.scrollTop;
    // No movement: the last pixel or two, or an end reached. Land and stop.
    if (box.scrollTop === before && carried) { box.scrollTop = target; stop(); return; }
    raf = requestAnimationFrame(frame);
  }

  box.addEventListener("wheel", function (e) {
    if (!active() || e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || !e.deltaY) { return; }
    // Turned on past the top or the bottom: each notch pulls the games out of their end (js\bump.js).
    if (e.deltaY > 0 ? box.scrollTop >= max() - 1 : box.scrollTop <= 0) {
      if (max() > 0) { e.preventDefault(); stop(); bumpEnd(e.deltaY > 0 ? "down" : "up", true); }
      return;
    }
    if (!wheelGlide()) { return; }
    e.preventDefault();
    var px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * box.clientHeight : e.deltaY;
    var now = performance.now();
    if (now - last > PAUSE_MS || Math.sign(px) !== runWay) { runFrom = now; runWay = Math.sign(px); }
    if (quickens() && wheelAccel()) {
      var p = Math.max(0, Math.min(1, (now - runFrom - LONG_MS) / RAMP_MS));
      px *= 1 + QUICKEST * p * p * (3 - 2 * p);    // eased in and out, so the change is never felt as a step
    }
    if (target === null || Math.sign(px) !== Math.sign(target - box.scrollTop)) {
      target = box.scrollTop;              // a fresh start, or a turn the other way
      recent = [];
    }
    carried = false;
    last = now;
    recent.push([now, px]);
    while (recent.length && now - recent[0][0] > WINDOW_MS + QUIET_MS) { recent.shift(); }
    target = Math.max(0, Math.min(max(), target + px));
    setTo = box.scrollTop;
    if (!raf) { prevT = 0; raf = requestAnimationFrame(frame); }
  }, { passive: false });

  document.addEventListener("keydown", stop, true);
  box.addEventListener("pointerdown", stop);
  return { stop: stop };
}
