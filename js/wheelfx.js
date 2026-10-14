/*  The games wheel's feel when it turns, round a black hole (css .wheelbox):
      - the light round the hole turns with the plates (.wswirl);
      - each turn the chosen plate sheds particles into the hole (shed);
      - a fast spin brightens the light and paces each swing so the wheel flows
        (pace, .spinning; a blur on passing plates would stutter each spin);
      - at rest the chosen plate strikes on like neon and bounces once (.arrive).
    Classes, one variable and short Web Animations: no canvas, no frame loop.
    Off with Settings > Feel > Animations (body.no-anim); reduce-motion is not followed. */

var FAST_MS = 200;       // turns closer together than this are a spin
var REST_MS = 170;       // this long after the last turn, the wheel is at rest
var ARC = 7.5;           // views.js WHEEL_ARC: the light turns as far as the plates do
var PARTS_MAX = 120;     // particles in flight at once, at most
var SHED_STEP = 12, SHED_SPIN = 3;     // particles a single step sheds, and a spin's step
var SHED_GAP = 45;       // in a fast spin, a plate sheds at most this often (ms)
var FLOW = 1.6;          // in a spin, a step's swing lasts this many times the time between steps
var SWING_MIN = 50, SWING_MAX = 240;   // ms, and never shorter or longer than these
var restTimer = null, lastTurn = 0, lastShed = 0, turn = 0, partsLive = 0, paceMs = 0;
var geo = null, geoWatch = false, swirl = null;

/* The turning light, an element of its own that views.js puts in the box. Not
   the box's ::after turned by a variable on the box: that variable is inherited
   by every plate, hidden ones too, so each step would restyle the whole
   library. Its own transform touches it alone. */
export function wheelDress(box) {
  swirl = document.createElement("i");
  swirl.className = "wswirl";
  swirl.style.transform = "rotate(" + turn + "deg)";
  box.appendChild(swirl);
}

export function wheelSpin(box, steps) {
  if (!box || !steps) { return; }
  // A jump (Home, End, a letter, round the end) turns it three plates at
  // most: the light has no mark to be counted by, so it lands looking right.
  turn += Math.max(-3, Math.min(3, steps)) * ARC;
  if (!swirl || swirl.parentNode !== box) { wheelDress(box); }
  swirl.style.transform = "rotate(" + turn + "deg)";
  if (document.body.classList.contains("no-anim")) { return; }
  var now = performance.now(), gap = Math.min(now - lastTurn, FAST_MS);
  var was = box.classList.contains("spinning");
  if (now - lastTurn < FAST_MS || Math.abs(steps) > 2) { box.classList.add("spinning"); }
  lastTurn = now;
  var spinning = box.classList.contains("spinning");
  if (spinning) { pace(box, was ? paceMs * 0.5 + gap * 0.5 : gap); }
  if (!document.hidden && (!spinning || now - lastShed >= SHED_GAP)) {
    lastShed = now;
    shed(box, steps > 0 ? 1 : -1, spinning ? SHED_SPIN : SHED_STEP);
  }
  clearTimeout(restTimer);
  restTimer = setTimeout(function () {
    restTimer = null;
    // After a fast spin the plate lands without the bounce, which there
    // only holds up the stop: the neon strike alone.
    var spun = box.classList.contains("spinning");
    box.classList.remove("spinning");
    // Off every plate first, so one left marked cannot replay when it is
    // chosen later; then restarted on the chosen one (off, layout read, on).
    box.querySelectorAll(".witem.arrive").forEach(function (n) { n.classList.remove("arrive", "spun"); });
    var chosen = box.querySelector(".witem.sel");
    if (!chosen) { return; }
    void chosen.offsetWidth;
    measure(box);                          // free here: the line above laid the page out
    chosen.classList.toggle("spun", spun);
    chosen.classList.add("arrive");
  }, REST_MS);
}

/* How long a step's swing lasts in a spin: FLOW times the gap between steps
   (averaged), so the next step comes while the plates still move, at an even
   pace (css .wheelbox.spinning .wnear). A fixed swing either stops and starts
   or trails the chosen game. On the plates on show and the ring only, never the box. */
function pace(box, ms) {
  paceMs = ms;
  var dur = Math.round(Math.max(SWING_MIN, Math.min(SWING_MAX, ms * FLOW))) + "ms";
  box.querySelectorAll(".wnear").forEach(function (n) { n.style.setProperty("--wdur", dur); });
  if (swirl) { swirl.style.setProperty("--wdur", dur); }
}

/* The carousels' share (the game carousel, and the consoles screen's cards): in
   a fast run each slide lasts a little longer than the gap between steps, at an
   even pace as the wheel's swing (pace, above), so the row moves as one. The
   views keep three unseen cards either side (views.js updateCarousel,
   systems.js updateSystems), so a card slides in instead of popping. .cnear
   marks the cards kept; css times them by --wdur while .spinning is on. */
var car = { last: 0, pace: 0, timer: null };
var CAR_MAX = 280;       // ms: a carousel's own slide; a run's is never longer
export function carouselSpin(box, steps) {
  if (!box || !steps || document.body.classList.contains("no-anim")) { return; }
  var now = performance.now(), gap = Math.min(now - car.last, FAST_MS);
  var was = box.classList.contains("spinning");
  if (now - car.last < FAST_MS || Math.abs(steps) > 2) { box.classList.add("spinning"); }
  car.last = now;
  if (box.classList.contains("spinning")) {
    car.pace = was ? car.pace * 0.5 + gap * 0.5 : gap;
    var dur = Math.round(Math.max(SWING_MIN, Math.min(CAR_MAX, car.pace * FLOW))) + "ms";
    box.querySelectorAll(".cnear").forEach(function (n) { n.style.setProperty("--wdur", dur); });
  }
  clearTimeout(car.timer);
  car.timer = setTimeout(function () { car.timer = null; box.classList.remove("spinning"); }, REST_MS);
}

/* The box's size, for shed(). Read at rest and kept, never mid-turn: reading a
   size straight after a turn forces a layout on the spot, the bulk of a spin's
   work. A window resize forgets it; the next step reads it once. */
function measure(box) {
  if (!geoWatch) { geoWatch = true; window.addEventListener("resize", function () { geo = null; }); }
  geo = { box: box, W: box.clientWidth, H: box.clientHeight };
}

/* The chosen plate's particles: from its right end and the right of its top
   and bottom edges, each spiralling in towards the pivot the way the wheel
   turned (dir: 1 is clockwise), gone at the hole's edge. Where the plate will
   stand is worked out from css .witem's numbers rather than measured, since
   its size is still easing: the pivot at 62% plus 85 units, the hole 45 units
   round, its height from a logo or a line of text. Nothing here reads the layout. */
function shed(box, dir, n) {
  if (!geo || geo.box !== box) { measure(box); }   // the first turn, or after a resize: once
  var W = geo.W, H = geo.H;
  if (!W || !H) { return; }
  var u = Math.min(H / 100, 0.008 * W);
  var plate = Math.max(288, Math.min(0.75 * W, 60 * u, 875));
  var hw = Math.min(0.75 * plate, (W - 32) / 2);
  var cx = W - Math.max(16, 0.54 * W - 0.75 * plate) - hw, cy = H / 2;
  var px = 0.62 * W + 85 * u, py = cy, rim = 45 * u;
  var plateNow = box.querySelector(".witem.sel");
  var inner = plateNow && plateNow.querySelector(".wlogo") ? Math.max(97, Math.min(18.75 * u, 277))
                                                           : 1.3 * Math.max(24, Math.min(3.6 * u, 45));
  var hh = (inner + 2 * Math.max(9, Math.min(1.65 * u, 24))) / 2;
  for (var i = 0; i < n && partsLive < PARTS_MAX; i++) {
    var sx, sy, side = Math.random();
    if (side < 0.4) { sx = cx + hw - Math.random() * 2 * u; sy = cy + (Math.random() * 2 - 1) * hh * 0.85; }
    else { sx = cx + hw * (0.45 + 0.55 * Math.random()); sy = cy + (side < 0.7 ? -hh : hh); }
    var r0 = Math.hypot(sx - px, sy - py), a0 = Math.atan2(sy - py, sx - px);
    if (r0 <= rim * 1.02) { continue; }            // already over the hole
    var twist = dir * (0.12 + Math.random() * 0.16), s = 0.7 + Math.random() * 0.8;
    var at = function (t, k) {
      var r = r0 + (rim * 0.97 - r0) * t, a = a0 + twist * Math.pow(t, 1.5);
      return "translate(" + (px + r * Math.cos(a)).toFixed(1) + "px, " + (py + r * Math.sin(a)).toFixed(1) + "px) scale(" + (s * k).toFixed(2) + ")";
    };
    var p = document.createElement("i");
    p.className = "wpart";
    box.appendChild(p);
    partsLive++;
    var run = p.animate([
      { offset: 0, transform: at(0, 1), opacity: 0 },
      { offset: 0.15, opacity: 0.95 },
      { offset: 0.35, transform: at(0.35, 1) },
      { offset: 0.7, transform: at(0.7, 0.7), opacity: 0.75 },
      { offset: 1, transform: at(1, 0.25), opacity: 0 }
    ], { duration: 700 + Math.random() * 400, easing: "ease-in", delay: Math.random() * 120, fill: "backwards" });
    run.onfinish = run.oncancel = (function (dot) { return function () { dot.remove(); partsLive--; }; })(p);
  }
}
