/*  The floor of a horizon (the texture "horizon", css\xsegon.css): its lines
    across, rolling toward the screen. The stylesheet draws the same lines
    standing still, and leaves them out while this draws them: the page says
    so with data-floor on <html>. How fast is the stylesheet's --floor-roll,
    in lines a second. */

var FLOOR_TOP = .66, FLOOR_DEEP = .32, FLOOR_LINES = 23, FLOOR_HAZE = .11;
var floorW = 0, floorH = 0, floorInk = "", floorRoll = 0, floorAt = 0;

// How strong a line is at its distance, 1 being the nearest: the stylesheet's three strengths, without the steps.
function floorStrong(z) {
  if (z <= 2) { return .5; }
  if (z <= 3) { return .5 - .14 * (z - 2); }
  return z <= 6 ? .36 - .16 * (z - 3) / 3 : .2;
}

export var floorMotion = {
  fit: function (box) {
    floorW = box.w; floorH = box.h;
    floorInk = box.ink("--magenta-rgb");
    floorRoll = Math.min(4, box.says("--floor-roll", .2));
    document.documentElement.dataset.floor = "rolls";
  },
  off: function () { delete document.documentElement.dataset.floor; floorAt = 0; },
  step: function (dt) {
    if (!floorRoll) { return false; }
    floorAt = (floorAt + floorRoll * dt) % 1;
    return true;
  },
  // Line n stands at the distance 1 + n / 2, as in the stylesheet, and comes half a step nearer for each line rolled.
  paint: function (c) {
    for (var n = 0; n <= FLOOR_LINES; n++) {
      var z = 1 + (n - floorAt) / 2, y = floorH * (FLOOR_TOP + FLOOR_DEEP / z), thick = z <= 2 ? 2 : Math.max(1, 2 - (z - 2) / 2);
      if (y > floorH + 2) { continue; }
      // The stylesheet's haze takes the far lines away, and the furthest comes in out of it.
      var haze = Math.max(0, 1 - (y / floorH - FLOOR_TOP) / FLOOR_HAZE);
      var strong = floorStrong(z) * (1 - .9 * haze) * (n === FLOOR_LINES ? floorAt : 1);
      c.fillStyle = "rgba(" + floorInk + ", " + strong.toFixed(3) + ")";
      c.fillRect(0, y - thick / 2, floorW, thick);
    }
  }
};
