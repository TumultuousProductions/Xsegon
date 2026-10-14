/*  Grabbing a wheel or a carousel and pulling it round (kept out of views.js
    for the 700-line rule).                                                 */

import { ctl } from "./views.js";

// ---------- drag to spin ----------
/* Dragging vertically spins the wheels, horizontally slides the carousels, 64px
   per notch; the scroll wheel does one notch at a time. A drag ends where a click
   begins, and that click must not choose what is under the pointer: dragAte() is
   set on release after real movement and consumed by the first click after. */

var dragState = { ate: false };
export function dragAte() {
  var a = dragState.ate;
  dragState.ate = false;
  return a;
}

export function attachSpin(container, axisFn, navFn, activeFn) {
  var down = false, last = 0, acc = 0, moved = 0, pid = null;
  var STEP = 64;

  container.addEventListener("pointerdown", function (e) {
    if (!ctl("dragSpins", true)) { return; }
    if (!activeFn() || e.button !== 0) { return; }
    down = true; moved = 0; acc = 0; pid = e.pointerId;
    last = axisFn() === "y" ? e.clientY : e.clientX;
  });

  container.addEventListener("pointermove", function (e) {
    if (!down || e.pointerId !== pid) { return; }
    var cur = axisFn() === "y" ? e.clientY : e.clientX;
    var dpx = cur - last;
    last = cur;
    acc += dpx;
    moved += Math.abs(dpx);
    // Dragging down (or right) pulls earlier items toward you, like
    // grabbing the rim.
    while (acc > STEP)  { acc -= STEP; navFn(-1); }
    while (acc < -STEP) { acc += STEP; navFn(1); }
    if (moved > 6 && container.setPointerCapture) {
      try { container.setPointerCapture(pid); } catch (err) { /* fine */ }
    }
  });

  ["pointerup", "pointercancel"].forEach(function (ev) {
    container.addEventListener(ev, function () {
      if (!down) { return; }
      down = false;
      if (moved > 8) {
        dragState.ate = true;
        setTimeout(function () { dragState.ate = false; }, 150);
      }
    });
  });
}
