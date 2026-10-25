import { gameRunning, onGameOver } from "./snap.js";
import { $body } from "./state.js";

/*  The rain (a theme's texture "rain", includes\themes.php): digits falling
    behind the panels in the theme's highlight, drawn here because a stylesheet
    cannot. It rests with Animations off, under High contrast and while a game
    runs. Windows' reduce-motion is not followed, as the wheel's effects do not follow it. */

var FRAME_MS = 33, CELL = 16, FADE = 1.6;
var GLYPHS = "0101010101011010アイウエオカキクケコサシスセソタチツテトナニヌネノ0110";
var $rain = null, rainCtx = null, trailCv = null, trailCtx = null;
var drops = [], rainW = 0, rainH = 0, lastFrame = 0, falling = false, inkTrail = "", inkHead = "";

function rainOn() { return document.documentElement.dataset.texture === "rain"; }
function rainGlyph() { return GLYPHS[Math.random() * GLYPHS.length | 0]; }
function rainMayFall() { return !$body.classList.contains("no-anim") && !$body.classList.contains("high-contrast"); }

// One step of falling: the trails fade, and a head that enters a new cell leaves its digit behind.
function rainStep(dt) {
  trailCtx.globalCompositeOperation = "destination-out";
  trailCtx.fillStyle = "rgba(0, 0, 0, " + Math.min(1, dt * FADE).toFixed(3) + ")";
  trailCtx.fillRect(0, 0, rainW, rainH);
  trailCtx.globalCompositeOperation = "source-over";
  trailCtx.fillStyle = inkTrail;
  drops.forEach(function (d, i) {
    d.y += d.v * dt;
    var here = Math.floor(d.y);
    if (here !== d.row) {
      if (d.row >= 0) { trailCtx.fillText(d.ch, i * CELL, d.row * CELL); }
      d.row = here;
      d.ch = rainGlyph();
    }
    if (d.y * CELL > rainH + CELL && Math.random() < .02) { d.y = -Math.random() * 10; d.row = -1; d.v = 3 + Math.random() * 4; }
  });
}

function rainPaint() {
  rainCtx.clearRect(0, 0, rainW, rainH);
  rainCtx.drawImage(trailCv, 0, 0, rainW, rainH);
  rainCtx.fillStyle = inkHead;
  drops.forEach(function (d, i) { if (d.y >= 0) { rainCtx.fillText(d.ch, i * CELL, d.y * CELL - CELL); } });
}

/* The canvas at the window's size and colours, with every trail drawn as old as
   it would be by now, so it opens mid-fall. */
function rainFit() {
  if (!$rain) { return; }
  var dpr = Math.min(window.devicePixelRatio || 1, 2), look = getComputedStyle($body), rows;
  rainW = window.innerWidth; rainH = window.innerHeight; rows = rainH / CELL;
  [[$rain, rainCtx], [trailCv, trailCtx]].forEach(function (pair) {
    pair[0].width = Math.round(rainW * dpr); pair[0].height = Math.round(rainH * dpr);
    pair[1].setTransform(dpr, 0, 0, dpr, 0, 0);
    pair[1].font = CELL + "px Consolas, monospace";
    pair[1].textBaseline = "top";
  });
  inkTrail = "rgba(" + look.getPropertyValue("--cyan-rgb").trim() + ", .5)";
  inkHead = "rgba(" + look.getPropertyValue("--glint-rgb").trim() + ", .85)";
  drops = [];
  trailCtx.fillStyle = inkTrail;
  for (var i = 0; i < Math.ceil(rainW / CELL); i++) {
    var d = { y: -rows + Math.random() * rows * 2, v: 3 + Math.random() * 4, row: -1, ch: rainGlyph() };
    d.row = Math.floor(d.y);
    for (var r = d.row - 1; r >= 0; r--) {
      var left = Math.exp(-FADE * (d.y - r) / d.v);
      if (left < .03) { break; }
      trailCtx.globalAlpha = left;
      trailCtx.fillText(rainGlyph(), i * CELL, r * CELL);
    }
    drops.push(d);
  }
  trailCtx.globalAlpha = 1;
  rainPaint();
}

// Thirty pictures a second is plenty for digits falling a few rows a second, on a screen of any speed.
function rainFrame(t) {
  if (!$rain || !rainMayFall() || gameRunning) {
    falling = false;
    if ($rain) { delete $rain.dataset.falling; }
    return;
  }
  requestAnimationFrame(rainFrame);
  if (lastFrame && t - lastFrame < FRAME_MS) { return; }
  rainStep(lastFrame ? Math.min(.1, (t - lastFrame) / 1000) : 1 / 30);
  lastFrame = t;
  rainPaint();
}

// Falling, if it may and is not already.
function rainRun() {
  if (!$rain || falling || !rainMayFall() || gameRunning) { return; }
  falling = true;
  lastFrame = 0;
  $rain.dataset.falling = "1";
  requestAnimationFrame(rainFrame);
}

/* The theme on the page now: its rain put up, or the last theme's taken
   down. Asked at the start and at every change of theme. */
export function rainWear() {
  if (!rainOn()) {
    if ($rain) { $rain.remove(); $rain = rainCtx = trailCv = trailCtx = null; drops = []; }    // the frame that is owed sees it gone and stops
    return;
  }
  if (!$rain) {
    var under = document.querySelector(".backdrop");
    if (!under) { return; }
    $rain = document.createElement("canvas");
    $rain.className = "rain";
    $rain.setAttribute("aria-hidden", "true");
    trailCv = document.createElement("canvas");
    rainCtx = $rain.getContext("2d");
    trailCtx = trailCv.getContext("2d");
    if (!rainCtx || !trailCtx) { $rain = rainCtx = trailCv = trailCtx = null; return; }
    under.after($rain);
  }
  rainFit();
  rainRun();
}

export function initRain() {
  window.addEventListener("resize", rainFit);
  // Animations and High contrast are classes on the body: when one is switched back, the rain starts again.
  new MutationObserver(rainRun).observe($body, { attributes: true, attributeFilter: ["class"] });
  onGameOver(rainRun);                 // it rested while the game ran
  rainWear();
}
