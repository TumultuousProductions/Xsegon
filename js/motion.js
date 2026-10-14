import { batMotion } from "./motion-bats.js";
import { bubbleMotion } from "./motion-bubbles.js";
import { emberMotion } from "./motion-embers.js";
import { floorMotion } from "./motion-floor.js";
import { starMotion } from "./motion-stars.js";
import { stormMotion } from "./motion-storm.js";
import { gameRunning } from "./snap.js";
import { $body } from "./state.js";

/*  What moves by itself besides the rain and the snow (js\rain.js,
    js\snow.js): a floor that rolls, stars, bubbles, a storm's rain, embers
    and bats. Each is drawn by a file of its own and goes with a word the
    look wears (includes\themes.php). This is their canvas and their clock.
    They rest when the rain does: with Animations off, under High contrast
    and while a game runs.

    A drawing is { fit(box), step(dt), paint(c) }. fit is told the size, the
    colours and the stylesheet's numbers, and answers "front" to be drawn in
    front of the games. step answers false when its picture did not change. */

var MOTION_FRAME_MS = 33;
// The word a look wears and what is drawn for it, the furthest first.
var MOTION_FOR = [["texture", "horizon", [starMotion, floorMotion]], ["texture", "carbon", [emberMotion]],
                  ["texture", "stars", [starMotion]], ["texture", "stars-trees", [starMotion]],
                  ["texture", "bubbles", [bubbleMotion]], ["texture", "storm", [stormMotion]], ["mark", "bat", [batMotion]]];
var motionSheets = {};          // "behind" and "front": { cv, c, lot }
var motionUp = [], motionW = 0, motionH = 0, motionLast = 0, motionGoing = false;

function motionMayRun() { return !$body.classList.contains("no-anim") && !$body.classList.contains("high-contrast"); }

// What the look on the page has that moves, each with the word that brought it.
function motionWorn() {
  var words = document.documentElement.dataset, lot = [];
  MOTION_FOR.forEach(function (m) {
    if (words[m[0]] === m[1]) { m[2].forEach(function (d) { lot.push({ draws: d, word: m[1] }); }); }
  });
  return lot;
}

// A canvas: behind the panels where the rain's goes, or in front of the games and under the bars and the windows.
function motionSheet(where) {
  var s = motionSheets[where], cv, c, beside;
  if (s) { return s; }
  beside = document.querySelector(where === "front" ? ".wrap" : ".backdrop");
  cv = document.createElement("canvas");
  c = cv.getContext("2d");
  if (!beside || !c) { return null; }
  cv.className = "motion " + where;
  cv.setAttribute("aria-hidden", "true");
  beside.after(cv);
  s = motionSheets[where] = { cv: cv, c: c, lot: [] };
  return s;
}

function motionPaint(s) {
  s.c.clearRect(0, 0, motionW, motionH);
  s.lot.forEach(function (d) { d.paint(s.c); });
}

/* Every drawing told the window's size, the theme's colours and the
   stylesheet's numbers, every canvas made that size, and one picture drawn,
   so a look at rest still shows what it has. */
function motionFit() {
  var worn = motionWorn(), look = getComputedStyle($body), dpr = Math.min(window.devicePixelRatio || 1, 2);
  var box = { w: window.innerWidth, h: window.innerHeight, dpr: dpr, word: "",
              says: function (name, or) { var n = parseFloat(look.getPropertyValue(name)); return n >= 0 ? n : or; },
              ink: function (name) { return look.getPropertyValue(name).trim() || "255, 255, 255"; } };
  motionW = box.w; motionH = box.h;
  // What the last look drew and this one does not is told it is off.
  motionUp.forEach(function (d) { if (d.off && !worn.some(function (m) { return m.draws === d; })) { d.off(); } });
  motionUp = worn.map(function (m) { return m.draws; });
  Object.keys(motionSheets).forEach(function (k) { motionSheets[k].lot = []; });
  worn.forEach(function (m) {
    box.word = m.word;
    var s = motionSheet(m.draws.fit(box) === "front" ? "front" : "behind");
    if (s) { s.lot.push(m.draws); }
  });
  Object.keys(motionSheets).forEach(function (k) {
    var s = motionSheets[k];
    if (!s.lot.length) { s.cv.remove(); delete motionSheets[k]; return; }
    s.cv.width = Math.round(box.w * dpr); s.cv.height = Math.round(box.h * dpr);
    s.c.setTransform(dpr, 0, 0, dpr, 0, 0);
    // A canvas that is the texture is as strong as the theme says; one drawn over a texture is not weakened with it.
    s.cv.classList.toggle("as-texture", s.lot.some(function (d) { return !d.over; }));
    motionPaint(s);
  });
}

// Thirty pictures a second, as the rain has: plenty for what moves this slowly.
function motionFrame(t) {
  var sheets = Object.keys(motionSheets).map(function (k) { return motionSheets[k]; });
  if (!sheets.length || !motionMayRun() || gameRunning) {
    motionGoing = false;
    sheets.forEach(function (s) {
      delete s.cv.dataset.moving;
      s.lot.forEach(function (d) { if (d.rest) { d.rest(); } });       // what would hang in the air is taken away
      motionPaint(s);
    });
    if (sheets.length && gameRunning) { setTimeout(motionRun, 2000); }     // it starts again by itself once the game is over
    return;
  }
  requestAnimationFrame(motionFrame);
  if (motionLast && t - motionLast < MOTION_FRAME_MS) { return; }
  var dt = motionLast ? Math.min(.1, (t - motionLast) / 1000) : 1 / 30;
  motionLast = t;
  sheets.forEach(function (s) {
    var changed = false;
    s.lot.forEach(function (d) { if (d.step(dt) !== false) { changed = true; } });
    if (changed) { motionPaint(s); }
  });
}

// Moving, if it may and is not already.
function motionRun() {
  var sheets = Object.keys(motionSheets);
  if (!sheets.length || motionGoing || !motionMayRun() || gameRunning) { return; }
  motionGoing = true;
  motionLast = 0;
  sheets.forEach(function (k) { motionSheets[k].cv.dataset.moving = "1"; });
  requestAnimationFrame(motionFrame);
}

/* The look on the page now: what it has that moves put up, and the last
   look's taken down. Asked at the start, at every change of theme, and when
   a number the drawings read has changed. */
export function motionWear() {
  if (!motionWorn().length) {
    motionUp.forEach(function (d) { if (d.off) { d.off(); } });
    motionUp = [];
    Object.keys(motionSheets).forEach(function (k) { motionSheets[k].cv.remove(); delete motionSheets[k]; });    // the frame that is owed sees them gone and stops
    return;
  }
  motionFit();
  Object.keys(motionSheets).forEach(function (k) { if (motionGoing) { motionSheets[k].cv.dataset.moving = "1"; } });
  motionRun();
}

export function initMotion() {
  window.addEventListener("resize", function () { if (motionUp.length) { motionFit(); } });
  // Animations and High contrast are classes on the body: when one is switched back, it all moves again.
  new MutationObserver(motionRun).observe($body, { attributes: true, attributeFilter: ["class"] });
  motionWear();
}
