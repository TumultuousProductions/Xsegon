import { gameRunning } from "./snap.js";
import { $body } from "./state.js";

/*  The snow (a theme's texture "snow", includes\themes.php): soft flakes
    falling behind the panels in the theme's second colour, the near ones
    larger and faster. Drawn here as the rain is (js\rain.js) and at rest
    when the rain is: with Animations off, under High contrast and while a
    game runs. How many and how fast are the stylesheet's to say. */

var SNOW_FRAME_MS = 33, SNOW_SIZES = [1.1, 1.5, 2, 2.6, 3.2], SNOW_REACH = 2.2, SNOW_AREA = 3200;
var $snow = null, snowCtx = null, snowDots = [], snowFlakes = [], snowW = 0, snowH = 0, snowLast = 0, snowFalling = false, snowRate = 1;

function snowOn() { return document.documentElement.dataset.texture === "snow"; }
function snowMayFall() { return !$body.classList.contains("no-anim") && !$body.classList.contains("high-contrast"); }

// One size of flake, drawn once: bright in the middle and gone at a little over twice its size.
function snowDot(r, ink, dpr) {
  var cv = document.createElement("canvas"), half = Math.ceil(r * SNOW_REACH * dpr) + 1, c, g;
  cv.width = cv.height = half * 2;
  c = cv.getContext("2d");
  g = c.createRadialGradient(half, half, 0, half, half, r * SNOW_REACH * dpr);
  g.addColorStop(0, "rgba(" + ink + ", 1)");
  g.addColorStop(1 / SNOW_REACH, "rgba(" + ink + ", .45)");
  g.addColorStop(1, "rgba(" + ink + ", 0)");
  c.fillStyle = g;
  c.fillRect(0, 0, half * 2, half * 2);
  return cv;
}

// A flake: anywhere on the screen at the start, at the top edge after that. Small ones are the bright ones.
function snowNew(anywhere) {
  var k = Math.random() * SNOW_SIZES.length | 0;
  return { x: Math.random() * snowW, y: anywhere ? Math.random() * snowH : -8, k: k, a: .5 - k * .07 + Math.random() * .06,
           p: Math.random() * 6.283, f: .4 + Math.random() * .8 };
}

// One step of falling: down by its size's speed, and a little from side to side.
function snowStep(dt) {
  snowFlakes.forEach(function (f, i) {
    var r = SNOW_SIZES[f.k];
    f.y += (16 + r * 14) * snowRate * dt;
    f.p += f.f * dt;
    f.x += Math.sin(f.p) * (4 + r * 3) * Math.min(1, snowRate) * dt;
    if (f.y > snowH + 8) { snowFlakes[i] = snowNew(false); }
    else if (f.x < -8) { f.x = snowW + 8; }
    else if (f.x > snowW + 8) { f.x = -8; }
  });
}

function snowPaint() {
  snowCtx.clearRect(0, 0, snowW, snowH);
  snowFlakes.forEach(function (f) {
    var reach = SNOW_SIZES[f.k] * SNOW_REACH;
    snowCtx.globalAlpha = f.a;
    snowCtx.drawImage(snowDots[f.k], f.x - reach, f.y - reach, reach * 2, reach * 2);
  });
  snowCtx.globalAlpha = 1;
}

/* The canvas at the window's size, in the theme's colour, with as many
   flakes as the stylesheet says for that size, already all over the screen.
   Flakes in the air stay where they are when only the numbers change. */
function snowFit() {
  if (!$snow) { return; }
  var dpr = Math.min(window.devicePixelRatio || 1, 2), look = getComputedStyle($body);
  var ink = look.getPropertyValue("--magenta-rgb").trim() || "255, 255, 255";
  var many = parseFloat(look.getPropertyValue("--snow-flakes")), rate = parseFloat(look.getPropertyValue("--snow-fall")), want;
  if (window.innerWidth !== snowW || window.innerHeight !== snowH) { snowFlakes = []; }
  snowW = window.innerWidth; snowH = window.innerHeight;
  $snow.width = Math.round(snowW * dpr); $snow.height = Math.round(snowH * dpr);
  snowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  snowDots = SNOW_SIZES.map(function (r) { return snowDot(r, ink, dpr); });
  snowRate = rate >= 0 ? Math.min(5, rate) : 1;
  want = Math.min(1500, Math.round(snowW * snowH / SNOW_AREA * (many >= 0 ? many : 1)));
  snowFlakes.length = Math.min(snowFlakes.length, want);
  while (snowFlakes.length < want) { snowFlakes.push(snowNew(true)); }
  snowPaint();
}

// Thirty pictures a second is plenty for flakes this slow, on a screen of any speed.
function snowFrame(t) {
  if (!$snow || !snowMayFall() || gameRunning) {
    snowFalling = false;
    if ($snow) { delete $snow.dataset.falling; }
    if ($snow && gameRunning) { setTimeout(snowRun, 2000); }     // it starts again by itself once the game is over
    return;
  }
  requestAnimationFrame(snowFrame);
  if (snowLast && t - snowLast < SNOW_FRAME_MS) { return; }
  snowStep(snowLast ? Math.min(.1, (t - snowLast) / 1000) : 1 / 30);
  snowLast = t;
  snowPaint();
}

// Falling, if it may and is not already.
function snowRun() {
  if (!$snow || snowFalling || !snowMayFall() || gameRunning) { return; }
  snowFalling = true;
  snowLast = 0;
  $snow.dataset.falling = "1";
  requestAnimationFrame(snowFrame);
}

/* The theme on the page now: its snow put up, or the last theme's taken
   down. Asked at the start and at every change of theme. */
export function snowWear() {
  if (!snowOn()) {
    if ($snow) { $snow.remove(); $snow = snowCtx = null; snowFlakes = []; snowW = snowH = 0; }    // the frame that is owed sees it gone and stops
    return;
  }
  if (!$snow) {
    var under = document.querySelector(".backdrop");
    if (!under) { return; }
    $snow = document.createElement("canvas");
    $snow.className = "snow";
    $snow.setAttribute("aria-hidden", "true");
    snowCtx = $snow.getContext("2d");
    if (!snowCtx) { $snow = null; return; }
    under.after($snow);
  }
  snowFit();
  snowRun();
}

export function initSnow() {
  window.addEventListener("resize", snowFit);
  // Animations and High contrast are classes on the body: when one is switched back, the snow falls again.
  new MutationObserver(snowRun).observe($body, { attributes: true, attributeFilter: ["class"] });
  snowWear();
}
