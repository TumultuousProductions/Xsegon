/*  Bubbles (the texture "bubbles"): rings in the theme's second colour
    rising with a sway, the large ones faster, each with a glint on it. How
    many and how fast are the stylesheet's to say. */

var BUBBLE_AREA = 24000, BUBBLE_SIZES = [1.6, 2.6, 4, 6, 8.5, 11.5], BUBBLE_ODDS = [.3, .56, .76, .89, .96, 1];
var bubbleW = 0, bubbleH = 0, bubbleLot = [], bubbleDots = [], bubbleRise = 1;

// One size of bubble, drawn once: a thin ring, a little light inside its edge and a glint up on the left.
function bubbleDot(r, ink, dpr) {
  var cv = document.createElement("canvas"), half = Math.ceil((r + 2) * dpr), c, g;
  cv.width = cv.height = half * 2;
  c = cv.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, half, half);
  g = c.createRadialGradient(0, 0, r * .45, 0, 0, r);
  g.addColorStop(0, "rgba(" + ink + ", 0)");
  g.addColorStop(1, "rgba(" + ink + ", .2)");
  c.fillStyle = g;
  c.beginPath(); c.arc(0, 0, r, 0, 6.2832); c.fill();
  c.strokeStyle = "rgba(" + ink + ", .75)";
  c.lineWidth = Math.max(.7, r * .12);
  c.beginPath(); c.arc(0, 0, r, 0, 6.2832); c.stroke();
  if (r >= 3) {
    c.strokeStyle = "rgba(255, 255, 255, .8)";
    c.lineWidth = Math.max(.8, r * .15);
    c.lineCap = "round";
    c.beginPath(); c.arc(0, 0, r * .6, 3.5, 4.4); c.stroke();
  }
  return cv;
}

// A bubble: anywhere on the screen at the start, under its foot after that.
function bubbleNew(anywhere) {
  var roll = Math.random(), k = 0;
  while (roll > BUBBLE_ODDS[k]) { k++; }
  return { x: Math.random() * bubbleW, y: anywhere ? Math.random() * bubbleH : bubbleH + 14 + Math.random() * 50, k: k,
           a: .32 + Math.random() * .4, p: Math.random() * 6.283, f: .5 + Math.random() * .9 };
}

export var bubbleMotion = {
  fit: function (box) {
    var ink = box.ink("--magenta-rgb"), want;
    if (box.w !== bubbleW || box.h !== bubbleH) { bubbleLot = []; }
    bubbleW = box.w; bubbleH = box.h;
    bubbleRise = Math.min(8, box.says("--bubbles-rise", 1));
    bubbleDots = BUBBLE_SIZES.map(function (r) { return bubbleDot(r, ink, box.dpr); });
    want = Math.min(600, Math.round(bubbleW * bubbleH / BUBBLE_AREA * box.says("--bubbles-many", 1)));
    bubbleLot.length = Math.min(bubbleLot.length, want);
    while (bubbleLot.length < want) { bubbleLot.push(bubbleNew(true)); }
  },
  off: function () { bubbleLot = []; bubbleW = 0; },
  step: function (dt) {
    bubbleLot.forEach(function (b, i) {
      var r = BUBBLE_SIZES[b.k];
      b.y -= (12 + r * 4.2) * bubbleRise * dt;
      b.p += b.f * dt;
      if (b.y < -r * 2 - 4) { bubbleLot[i] = bubbleNew(false); }
    });
    return true;
  },
  paint: function (c) {
    bubbleLot.forEach(function (b) {
      var r = BUBBLE_SIZES[b.k], half = r + 2;
      c.globalAlpha = b.a;
      c.drawImage(bubbleDots[b.k], b.x + Math.sin(b.p) * (3 + r * 1.1) - half, b.y - half, half * 2, half * 2);
    });
    c.globalAlpha = 1;
  }
};
