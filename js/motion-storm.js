/*  A storm's rain (the texture "storm"): thin streaks falling fast at a
    slant, in three depths, the near ones longer and brighter, with the wind
    leaning them a little more and a little less. No lightning: a flash
    behind words is hard on the eyes. How much, how fast and how slanted are
    the stylesheet's to say. */

var STORM_AREA = 4800, STORM_SPEEDS = [560, 780, 1040], STORM_INKS = [.13, .2, .3], STORM_THICK = [.8, 1, 1.3], STORM_LONG = .03;
var stormW = 0, stormH = 0, stormLot = [[], [], []], stormFall = 1, stormSlant = .2, stormLean = .2, stormGust = 0, stormInk = "";

// A streak: anywhere at the start, above the top edge after that, and far enough to the side to slant in.
function stormNew(anywhere) {
  return { x: Math.random() * (stormW + stormH * .9) - stormH * .9, y: anywhere ? Math.random() * stormH : -40 - Math.random() * 80 };
}

export var stormMotion = {
  fit: function (box) {
    var want = Math.min(1800, Math.round(box.w * box.h / STORM_AREA * box.says("--storm-many", 1)));
    if (box.w !== stormW || box.h !== stormH) { stormLot = [[], [], []]; }
    stormW = box.w; stormH = box.h;
    stormFall = Math.min(4, box.says("--storm-fall", 1));
    stormSlant = stormLean = Math.min(.9, box.says("--storm-slant", .2));
    stormInk = box.ink("--magenta-rgb");
    stormLot.forEach(function (lot, k) {
      var mine = Math.round(want * [.45, .33, .22][k]);
      lot.length = Math.min(lot.length, mine);
      while (lot.length < mine) { lot.push(stormNew(true)); }
    });
  },
  off: function () { stormLot = [[], [], []]; stormW = 0; },
  step: function (dt) {
    stormGust += dt;
    stormLean = stormSlant ? Math.max(0, stormSlant + .045 * Math.sin(stormGust * .23) + .02 * Math.sin(stormGust * .71)) : 0;
    stormLot.forEach(function (lot, k) {
      var down = STORM_SPEEDS[k] * stormFall * dt;
      lot.forEach(function (d, i) {
        d.y += down;
        d.x += down * stormLean;
        if (d.y > stormH + 40) { lot[i] = stormNew(false); }
      });
    });
    return true;
  },
  // Each depth is one path and one stroke.
  paint: function (c) {
    c.lineCap = "round";
    stormLot.forEach(function (lot, k) {
      var long = STORM_SPEEDS[k] * STORM_LONG;
      c.strokeStyle = "rgba(" + stormInk + ", " + STORM_INKS[k] + ")";
      c.lineWidth = STORM_THICK[k];
      c.beginPath();
      lot.forEach(function (d) { c.moveTo(d.x, d.y); c.lineTo(d.x - long * stormLean, d.y - long); });
      c.stroke();
    });
  }
};
