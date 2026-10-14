/*  Embers (over the texture "carbon"): a few sparks in the theme's
    highlight rising from the foot of the screen, wavering, and going out.
    Few on purpose: 1 in the stylesheet's --embers-many is one to every
    115000 square pixels, about a dozen on a screen. */

var EMBER_AREA = 115000, EMBER_REACH = 3.2;
var emberW = 0, emberH = 0, emberLot = [], emberDot = null;

// A spark, drawn once: nearly white at its heart, the highlight around it, and gone at three times its size.
function emberDraw(heart, ink, dpr) {
  var cv = document.createElement("canvas"), half = Math.ceil(2 * EMBER_REACH * dpr) + 1, c = cv.getContext("2d"), g;
  cv.width = cv.height = half * 2;
  g = c.createRadialGradient(half, half, 0, half, half, 2 * EMBER_REACH * dpr);
  g.addColorStop(0, "rgba(" + heart + ", 1)");
  g.addColorStop(.22, "rgba(" + ink + ", .85)");
  g.addColorStop(1, "rgba(" + ink + ", 0)");
  c.fillStyle = g;
  c.fillRect(0, 0, half * 2, half * 2);
  return cv;
}

// A spark starts low, or under the foot of the screen: part way through its life at the start, so they do not all rise together.
function emberNew(begun) {
  var life = 5 + Math.random() * 6;
  return { x: Math.random() * emberW, y: emberH * (.62 + Math.random() * .42), r: .9 + Math.random() * 1.2, v: 14 + Math.random() * 20,
           age: begun ? Math.random() * life : 0, life: life, p: Math.random() * 6.283, f: .7 + Math.random() * 1.1 };
}

export var emberMotion = {
  over: true,
  fit: function (box) {
    var want = Math.min(200, Math.round(box.w * box.h / EMBER_AREA * box.says("--embers-many", 1)));
    if (box.w !== emberW || box.h !== emberH) { emberLot = []; }
    emberW = box.w; emberH = box.h;
    emberDot = emberDraw(box.ink("--glint-rgb"), box.ink("--cyan-rgb"), box.dpr);
    emberLot.length = Math.min(emberLot.length, want);
    while (emberLot.length < want) { emberLot.push(emberNew(true)); }
  },
  off: function () { emberLot = []; emberW = 0; },
  step: function (dt) {
    emberLot.forEach(function (e, i) {
      e.age += dt;
      e.p += e.f * dt;
      e.y -= e.v * dt;
      e.x += Math.sin(e.p) * 9 * dt;
      if (e.age >= e.life) { emberLot[i] = emberNew(false); }
    });
    return emberLot.length > 0;
  },
  // It comes up quickly, flickers, and fades and shrinks over the last part of its life.
  paint: function (c) {
    emberLot.forEach(function (e) {
      var left = Math.min(1, (e.life - e.age) / (e.life * .45)), reach = e.r * EMBER_REACH * (.6 + .4 * left);
      c.globalAlpha = Math.max(0, Math.min(1, e.age / .7) * left * (.78 + .22 * Math.sin(e.p * 5.3)));
      c.drawImage(emberDot, e.x - reach, e.y - reach, reach * 2, reach * 2);
    });
    c.globalAlpha = 1;
  }
};
