/*  Stars (the textures "stars" and "stars-trees", and a few over a
    horizon): small lights drifting slowly, the near ones larger and a
    little faster, each one twinkling, in the colours real stars come in,
    and now and then one falling. Behind them, where the stylesheet asks for
    galaxies, a band of far light and a few galaxies, drawn once. Under
    "stars-trees" a wood of firs stands along the foot of the screen, drawn
    once. How many, how fast, how far down the screen they go and how often
    one falls are the stylesheet's to say. */

var STAR_AREA = 2400, STAR_SIZES = [.55, .8, 1.15, 1.7, 2.3], STAR_REACH = 3, STAR_RAYS = 7;
// The colours stars come in and how many of a hundred: mostly white and blue-white, some yellow, a few orange and red. The theme's two colours are the rest.
var STAR_HUES = [["255, 255, 255", 30], ["214, 226, 255", 22], ["172, 198, 255", 12], ["255, 244, 214", 14], ["255, 214, 150", 10], ["255, 178, 122", 6], ["255, 138, 118", 3]];
var starW = 0, starH = 0, starLot = [], starDots = [], starDrift = 1, starFloor = 0, starEvery = 0, starWait = 0;
var starFalling = null, starInk = "", starWood = null, starDeep = null, starDeepAt = 0;

/* One size of star in one colour, drawn once: bright in the middle and gone
   at three times its size. The largest wear four thin rays as well. */
function starDot(r, ink, dpr, rays) {
  var cv = document.createElement("canvas"), far = r * (rays ? STAR_RAYS : STAR_REACH) * dpr, half = Math.ceil(far) + 1, c, g;
  cv.width = cv.height = half * 2;
  c = cv.getContext("2d");
  g = c.createRadialGradient(half, half, 0, half, half, r * STAR_REACH * dpr);
  g.addColorStop(0, "rgba(" + ink + ", 1)");
  g.addColorStop(1 / STAR_REACH, "rgba(" + ink + ", .55)");
  g.addColorStop(1, "rgba(" + ink + ", 0)");
  c.fillStyle = g;
  c.fillRect(0, 0, half * 2, half * 2);
  if (rays) {
    [[1, 0], [0, 1]].forEach(function (way) {
      var ray = c.createLinearGradient(half - way[0] * far, half - way[1] * far, half + way[0] * far, half + way[1] * far);
      ray.addColorStop(0, "rgba(" + ink + ", 0)");
      ray.addColorStop(.5, "rgba(" + ink + ", .7)");
      ray.addColorStop(1, "rgba(" + ink + ", 0)");
      c.strokeStyle = ray;
      c.lineWidth = Math.max(1, r * .3 * dpr);
      c.beginPath(); c.moveTo(half - way[0] * far, half - way[1] * far); c.lineTo(half + way[0] * far, half + way[1] * far); c.stroke();
    });
  }
  return cv;
}

// Which colour, by the odds above: a number under a hundred walks down the list, and what is left over is the theme's two.
function starHue(roll) {
  for (var i = 0; i < STAR_HUES.length; i++) {
    roll -= STAR_HUES[i][1];
    if (roll < 0) { return i; }
  }
  return STAR_HUES.length + (roll < 1.5 ? 0 : 1);
}

// A star: most are small, a few large enough to wear rays.
function starNew() {
  var roll = Math.random(), k = roll < .5 ? 0 : roll < .8 ? 1 : roll < .94 ? 2 : roll < .985 ? 3 : 4;
  return { x: Math.random() * starW, y: Math.random() * starFloor, k: k, tint: starHue(Math.random() * 100),
           a: .35 + Math.min(k, 3) * .13 + Math.random() * .25, p: Math.random() * 6.283, f: .5 + Math.random() * 2.2 };
}

// The same numbers every time, so the wood and the far sky are the same at every look.
function starSame(seed) {
  return function () {
    seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* A band of far light across the sky, as the Milky Way is: a haze in the
   theme's two colours and a dust of small stars along a line that rises and
   falls. The line and the haze are the same at both edges, so the sky can
   go round. */
function starBand(c, w, h, inks, same) {
  var line = function (x) { return h * (.34 + .09 * Math.sin(x / w * 6.2832 + 1.1) + .03 * Math.sin(x / w * 12.5664 + .4)); }, i, x, y, r, g;
  for (i = 0; i < 14; i++) {
    x = same() * w;
    r = h * (.1 + same() * .1);
    y = line(x) + (same() - .5) * h * .05;
    [x - w, x, x + w].forEach(function (at) {
      g = c.createRadialGradient(at, y, 0, at, y, r);
      g.addColorStop(0, "rgba(" + inks[i % 2] + ", .075)");
      g.addColorStop(1, "rgba(" + inks[i % 2] + ", 0)");
      c.fillStyle = g;
      c.fillRect(at - r, y - r, r * 2, r * 2);
    });
  }
  for (i = 0; i < w * 1.5; i++) {
    x = same() * w;
    y = line(x) + (same() + same() + same() - 1.5) * h * .07;
    r = .6 + same() * .7;
    c.fillStyle = "rgba(" + STAR_HUES[same() * STAR_HUES.length | 0][0] + ", " + (.08 + same() * .22).toFixed(2) + ")";
    c.fillRect(x, y, r, r);
  }
}

/* A galaxy far off: a warm heart, a pale disc, and two arms of small lights
   winding out of it, blue toward the rim with a pink one here and there. It
   is seen tilted, so the round thing is drawn squashed and turned. */
function starGalaxy(c, x, y, big, same) {
  var arm, i, far, turn, r, g, lit;
  c.save();
  c.translate(x, y);
  c.rotate(same() * 3.1416);
  c.scale(1, .24 + same() * .46);
  g = c.createRadialGradient(0, 0, 0, 0, 0, big);
  g.addColorStop(0, "rgba(255, 240, 214, .6)");
  g.addColorStop(.14, "rgba(255, 232, 200, .22)");
  g.addColorStop(.5, "rgba(176, 200, 255, .07)");
  g.addColorStop(1, "rgba(176, 200, 255, 0)");
  c.fillStyle = g;
  c.beginPath(); c.arc(0, 0, big, 0, 6.2832); c.fill();
  for (arm = 0; arm < 2; arm++) {
    for (i = 0; i < 240; i++) {
      far = Math.pow(same(), .8);
      turn = arm * 3.1416 + far * 8.2 + (same() - .5) * .5;
      r = big * (.08 + .88 * far) + (same() - .5) * big * .1;
      lit = ((.6 - .42 * far) * (.4 + .6 * same())).toFixed(2);
      c.fillStyle = "rgba(" + (same() < .06 ? "255, 150, 190" : far < .35 ? "255, 236, 204" : "184, 208, 255") + ", " + lit + ")";
      c.beginPath(); c.arc(Math.cos(turn) * r, Math.sin(turn) * r, .5 + same() * .8, 0, 6.2832); c.fill();
    }
  }
  c.restore();
}

/* The far sky, drawn once on a canvas of its own: the band, and as many
   galaxies as the stylesheet asks for, each kept clear of the others and of
   the edges. */
function starDeepDraw(box, many) {
  var cv = document.createElement("canvas"), c = cv.getContext("2d"), same = starSame(7), w = box.w, h = box.h, fine = Math.min(box.dpr, 1.25), put = [], tries, big, x, y;
  if (!c) { return null; }
  cv.width = Math.round(w * fine); cv.height = Math.round(h * fine);
  c.setTransform(fine, 0, 0, fine, 0, 0);
  starBand(c, w, h, [box.ink("--cyan-rgb"), box.ink("--magenta-rgb")], same);
  for (tries = 0; tries < many * 12 && put.length < many; tries++) {
    big = h * (.045 + same() * .05);
    x = big + 8 + same() * (w - 2 * big - 16);
    y = h * (.07 + same() * .5);
    if (put.every(function (g) { return Math.hypot(g[0] - x, g[1] - y) > g[2] + big + 70; })) { put.push([x, y, big]); }
  }
  put.forEach(function (g) { starGalaxy(c, g[0], g[1], g[2], same); });
  return cv;
}

// One fir: boughs in tiers from the tip down, each wider than the last and none quite even, on a short trunk.
function starFir(c, x, foot, tall, same) {
  var tiers = 6 + (same() * 4 | 0), wide = tall * (.2 + same() * .09), each = tall * .9 / tiers, right = [], left = [], t, y, half;
  for (t = 1; t <= tiers; t++) {
    y = foot - tall + each * t;
    half = wide * t / tiers;
    right.push([x + half * (.82 + same() * .36), y, x + half * .4, y - each * .16]);
    left.push([x - half * (.82 + same() * .36), y, x - half * .4, y - each * .16]);
  }
  c.beginPath();
  c.moveTo(x, foot - tall);
  right.forEach(function (b, i) { c.lineTo(b[0], b[1]); if (i < tiers - 1) { c.lineTo(b[2], b[3]); } });
  c.lineTo(x + tall * .014, foot - tall + each * tiers);
  c.lineTo(x + tall * .014, foot + 2);
  c.lineTo(x - tall * .014, foot + 2);
  c.lineTo(x - tall * .014, foot - tall + each * tiers);
  for (t = tiers - 1; t >= 0; t--) { c.lineTo(left[t][0], left[t][1]); if (t > 0) { c.lineTo(left[t - 1][2], left[t - 1][3]); } }
  c.closePath();
  c.fill();
}

// A ridge of firs on ground that rolls a little, filled to the foot of the screen.
function starRidge(c, w, h, up, roll, gap, tall, same) {
  var ground = function (x) { return h - up - Math.sin(x * .0041 + roll) * h * .012 - Math.sin(x * .0127 + roll * 3) * h * .005; }, x;
  c.beginPath();
  c.moveTo(0, h);
  for (x = 0; x <= w + 8; x += 8) { c.lineTo(x, ground(x)); }
  c.lineTo(w, h);
  c.closePath();
  c.fill();
  for (x = -gap[1] * same(); x < w + gap[1]; x += gap[0] + same() * (gap[1] - gap[0])) {
    starFir(c, x, ground(x), h * (tall[0] + same() * (tall[1] - tall[0])), same);
  }
}

/* The wood, drawn once on a canvas of its own: a glow low in the sky, a far
   ridge of small firs in the haze, and a near one of tall firs, darker than
   the ground, so no star shows through a tree. */
function starWoodDraw(box) {
  var cv = document.createElement("canvas"), c = cv.getContext("2d"), same = starSame(41), w = box.w, h = box.h, glow, mix, dusk;
  var ground = box.ink("--ground-rgb").split(",").map(Number), tint = box.ink("--cyan-rgb").split(",").map(Number);
  cv.width = Math.round(w * box.dpr); cv.height = Math.round(h * box.dpr);
  if (!c) { return null; }
  c.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
  glow = c.createLinearGradient(0, h * .52, 0, h * .9);
  glow.addColorStop(0, "rgba(" + tint.join(", ") + ", 0)");
  glow.addColorStop(1, "rgba(" + tint.join(", ") + ", .2)");
  c.fillStyle = glow;
  c.fillRect(0, h * .52, w, h * .48);
  mix = function (k, dim) { return "rgb(" + ground.map(function (g, i) { return Math.round((g + (tint[i] - g) * k) * dim); }).join(", ") + ")"; };
  c.fillStyle = mix(.16, .8);
  starRidge(c, w, h, h * .15, 1.3, [11, 24], [.035, .08], same);
  // The far ground darkens toward the near wood, so no pale strip shows between the near trunks.
  dusk = c.createLinearGradient(0, h * .84, 0, h * .93);
  dusk.addColorStop(0, mix(.03, .45).replace("rgb(", "rgba(").replace(")", ", 0)"));
  dusk.addColorStop(1, mix(.03, .45));
  c.fillStyle = dusk;
  c.fillRect(0, h * .84, w, h * .16);
  c.fillStyle = mix(.03, .45);
  starRidge(c, w, h, h * .085, 4.1, [22, 60], [.09, .21], same);
  return cv;
}

function starFall() {
  var right = Math.random() < .5 ? 1 : -1, far = 140 + Math.random() * 160;
  starFalling = { x: starW * (.15 + Math.random() * .7), y: starFloor * (.05 + Math.random() * .4), dx: right * far, dy: far * (.35 + Math.random() * .3),
                  age: 0, life: .7 + Math.random() * .5 };
}

export var starMotion = {
  fit: function (box) {
    var floor = box.h * Math.min(1, box.says("--stars-reach", 1)), galaxies = Math.min(8, Math.round(box.says("--stars-galaxies", 0))), inks, want;
    if (box.w !== starW || floor !== starFloor) { starLot = []; }
    starW = box.w; starH = box.h; starFloor = floor;
    starDrift = Math.min(20, box.says("--stars-drift", 1));
    starEvery = box.says("--stars-fall", 0);
    if (!starWait) { starWait = starEvery * (.4 + Math.random() * .6); }
    starInk = box.ink("--glint-rgb");
    inks = STAR_HUES.map(function (hue) { return hue[0]; }).concat([box.ink("--magenta-rgb"), box.ink("--cyan-rgb")]);
    starDots = inks.map(function (ink) { return STAR_SIZES.map(function (r, k) { return starDot(r, ink, box.dpr, k === 4); }); });
    want = Math.min(2500, Math.round(starW * starFloor / STAR_AREA * box.says("--stars-many", 1)));
    starLot.length = Math.min(starLot.length, want);
    while (starLot.length < want) { starLot.push(starNew()); }
    starDeep = galaxies > 0 ? starDeepDraw(box, galaxies) : null;
    starWood = box.word === "stars-trees" ? starWoodDraw(box) : null;
  },
  off: function () { starLot = []; starWood = starDeep = null; starFalling = null; starWait = 0; starW = 0; starDeepAt = 0; },
  rest: function () { starFalling = null; },
  step: function (dt) {
    starLot.forEach(function (s) {
      s.p += s.f * dt;
      s.x -= (1.2 + Math.min(s.k, 3) * 1.5) * starDrift * dt;
      if (s.x < -6) { s.x = starW + 6; s.y = Math.random() * starFloor; }
    });
    // The far sky goes the same way as the stars, at half the pace of the furthest.
    if (starDeep && starW) { starDeepAt = (starDeepAt + .6 * starDrift * dt) % starW; }
    if (starFalling) {
      starFalling.age += dt;
      if (starFalling.age >= starFalling.life) { starFalling = null; }
    } else if (starEvery > 0) {
      starWait -= dt;
      if (starWait <= 0) { starFall(); starWait = starEvery * (.6 + Math.random() * .8); }
    }
    return true;
  },
  paint: function (c) {
    var fade = starH * .14;
    if (starDeep) {
      c.drawImage(starDeep, -starDeepAt, 0, starW, starH);
      c.drawImage(starDeep, starW - starDeepAt, 0, starW, starH);
    }
    starLot.forEach(function (s) {
      var reach = STAR_SIZES[s.k] * (s.k === 4 ? STAR_RAYS : STAR_REACH), low = starFloor < starH ? Math.min(1, (starFloor - s.y) / fade) : 1;
      c.globalAlpha = Math.max(0, s.a * (.68 + .32 * Math.sin(s.p)) * low);
      c.drawImage(starDots[s.tint][s.k], s.x - reach, s.y - reach, reach * 2, reach * 2);
    });
    c.globalAlpha = 1;
    if (starFalling) {
      // A falling star: a short line, bright at its head, that comes and goes inside a second.
      var k = starFalling.age / starFalling.life, head = Math.min(1, k * 1.25), tail = Math.max(0, head - .3), line;
      var x1 = starFalling.x + starFalling.dx * head, y1 = starFalling.y + starFalling.dy * head;
      var x0 = starFalling.x + starFalling.dx * tail, y0 = starFalling.y + starFalling.dy * tail;
      line = c.createLinearGradient(x0, y0, x1, y1);
      line.addColorStop(0, "rgba(" + starInk + ", 0)");
      line.addColorStop(1, "rgba(" + starInk + ", " + (.8 * Math.sin(Math.PI * Math.min(1, k))).toFixed(3) + ")");
      c.strokeStyle = line;
      c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }
    if (starWood) { c.drawImage(starWood, 0, 0, starW, starH); }
  }
};
