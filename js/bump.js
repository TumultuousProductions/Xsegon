/*  The end of the list, felt: a press past the first or last game stretches
    the games in sight away from the end they ran into, held to it, the way a
    phone's list does, and lets them go, with the sound set's Move played low.
    The mouse wheel past an end, and a spin or a drag past one in Wheel and
    Carousel, pull the same way, further the longer they go on, and let go when
    they stop. The box, its header and its scrollbar stay still. A key, a stick
    or a wheel kept going thuds once. The stretch rests with Settings > Feel >
    Animations off; the sound follows Sound's own switches.                  */

import { rowsNode } from "./rows.js";
import { thud } from "./sound.js";
import { $body, $view, sel, view } from "./state.js";
import { carNodes, wheelNodes } from "./views.js";

// A press the same way sooner than this after the last is a key held down: it covers a key's first repeat (400 to 500 ms).
var HELD_MS = 650;
var MOST = 0.05;          // the stretch at its fullest: the games 5% longer
var PRESS = 1, TURN = 0.5; // a press pulls this much, a notch or a step of a spin this much more; the stretch is 1 - e^-pull of the most
var LET_GO_MS = 120;      // nothing pulling for this long: let go
var OUT = 0.045, BACK = 0.11;   // seconds: how quickly it stretches out, and springs back
var lastAt = 0, lastWay = "";
var on = null;            // the stretch under way

/* way: "up", "down", "left" or "right", as pressed or turned. turned: the mouse
   wheel or a spin, whose every notch pulls on, held or not. */
export function bumpEnd(way, turned) {
  var now = Date.now(), held = way === lastWay && now - lastAt < HELD_MS;
  lastAt = now;
  lastWay = way;
  if (!held) { thud(); }
  if ($body.classList.contains("no-anim") || (held && !turned)) { return; }
  pull(way, turned ? TURN : PRESS);
}

// The box that ran out, and which way it runs. Grid and Shelf run on down the list: their first game is at the top.
function boxOf(way) {
  if (view === "rows") {
    var n = rowsNode(), y = way === "up" || way === "down";
    return { box: y ? $view.querySelector(".rows-list") : n && n.closest(".rrow-track"), y: y };
  }
  return { box: $view, y: view !== "carousel" };
}

// The games of the box in sight, in order but for the wheel's and the carousel's, which are theirs to say.
function inSight(box, y) {
  if (box === $view && (view === "wheel" || view === "carousel")) {
    return ((view === "wheel" ? wheelNodes : carNodes) || []).filter(function (n) { return !n.hidden; });
  }
  var b = box.getBoundingClientRect(), near = y ? b.top : b.left, far = y ? b.bottom : b.right;
  var kids = box.children, lo = 0, hi = kids.length - 1, out = [];
  while (lo < hi) {
    var mid = (lo + hi) >> 1, r = kids[mid].getBoundingClientRect();
    if ((y ? r.bottom : r.right) <= near) { lo = mid + 1; } else { hi = mid; }
  }
  // A row of the grid or a line of the shelf can stand out of step: start a few back, end a box further on.
  for (var i = Math.max(0, lo - 40); i < kids.length; i++) {
    var k = kids[i].getBoundingClientRect(), from = y ? k.top : k.left;
    if (from >= far + (far - near)) { break; }
    if (from < far && (y ? k.bottom : k.right) > near && k.width && getComputedStyle(kids[i]).position !== "sticky") { out.push(kids[i]); }
  }
  return out;
}

/* Where a game scales from on the screen, as laid out. The wheel's plates and
   the carousel's cards all share one place and take theirs from a transform,
   so theirs is read from the layout; a tile from where it shows. */
function originOf(n, box, b, y) {
  if (n.offsetParent === box) {
    var o = getComputedStyle(n).transformOrigin.split(" ").map(parseFloat);
    return y ? b.top + box.clientTop + n.offsetTop - box.scrollTop + o[1] : b.left + box.clientLeft + n.offsetLeft - box.scrollLeft + o[0];
  }
  var r = n.getBoundingClientRect();
  return y ? r.top + r.height / 2 : r.left + r.width / 2;
}

function pull(way, much) {
  var at = boxOf(way), start = way === "up" || way === "left";
  if (!at.box) { return; }
  if (!on || on.box !== at.box || on.start !== start || on.sel !== sel || on.view !== view) {
    drop();
    var b = at.box.getBoundingClientRect(), y = at.y;
    var edge = y ? b.top + at.box.clientTop : b.left + at.box.clientLeft;
    var nodes = inSight(at.box, y).map(function (n) { return [n, originOf(n, at.box, b, y)]; });
    if (!nodes.length) { return; }
    var sc = y ? at.box.scrollTop : at.box.scrollLeft;
    on = { box: at.box, y: y, start: start, sel: sel, view: view, nodes: nodes, pull: 0, shown: 0, raf: 0, prev: 0,
           pin: start ? edge : edge + (y ? at.box.clientHeight : at.box.clientWidth), from: sc, sc: sc };
  }
  on.pull += much;
  on.last = performance.now();
  if (!on.raf) { on.prev = 0; on.raf = requestAnimationFrame(frame); }
}

function frame(t) {
  var st = on;
  st.raf = 0;
  // Moved on, to another game or scrolled back from the end: no longer at it. A scroll still settling into the end is followed.
  var sc = st.y ? st.box.scrollTop : st.box.scrollLeft;
  if (st.sel !== sel || st.view !== view || !st.box.isConnected || (st.start ? sc > st.sc + 1 : sc < st.sc - 1)) { drop(); return; }
  st.sc = sc;
  var dt = st.prev ? Math.min(0.05, (t - st.prev) / 1000) : 1 / 60;
  st.prev = t;
  if (performance.now() - st.last >= LET_GO_MS) { st.pull = 0; }
  var want = 1 - Math.exp(-st.pull);
  st.shown += (want - st.shown) * (1 - Math.exp(-dt / (want > st.shown ? OUT : BACK)));
  if (!st.pull && st.shown < 0.01) { drop(); return; }
  // Scaled round the pinned edge: each game moves on by its distance from it, and stretches as much.
  var s = 1 + MOST * st.shown, moved = sc - st.from;
  st.nodes.forEach(function (e) {
    var d = ((s - 1) * (e[1] - moved - st.pin)).toFixed(2) + "px";
    e[0].style.translate = st.y ? "0 " + d : d + " 0";
    e[0].style.scale = st.y ? "1 " + s.toFixed(4) : s.toFixed(4) + " 1";
  });
  st.raf = requestAnimationFrame(frame);
}

function drop() {
  if (!on) { return; }
  if (on.raf) { cancelAnimationFrame(on.raf); }
  on.nodes.forEach(function (e) { e[0].style.translate = e[0].style.scale = ""; });
  on = null;
}
