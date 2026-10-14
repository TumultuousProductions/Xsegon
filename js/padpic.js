/*  The picture of a controller that js\padcheck.js lights: a pad's outline with
    its buttons, triggers and sticks laid over it. Two layouts: PlayStation's,
    the sticks side by side, and everyone else's, the left stick raised.

    The outlines are other people's drawings, used without their logos and
    lettering:
    - Xbox 360 gamepad, by Grumbel (Open Clip Art Library), CC0:
      commons.wikimedia.org/wiki/File:Xbox360_gamepad.svg
    - DualShock 4 layout, by Tokyoship, CC BY 3.0:
      commons.wikimedia.org/wiki/File:Dualshock_4_Layout.svg
    Each is scaled (fit) so its face buttons stand 21 apart; the places below
    are measured off it. */

var OFFSET = {
  box: "-8 -34 305 246",
  fit: "scale(.3846) translate(.153 -260.352)",
  body: ["M 692.40625,795.6875 C 729.24632,796.78087 745.21397,776.84954 748.8125,678.25 C 752.58374,574.91798 685.51396,378.56055 665.84375,329.03125 C 646.1735,279.50196 547.13046,253.20593 502.1875,281.53125 C 465.20101,304.842 424.68118,307.90625 375.15625,307.90625 C 325.63133,307.90625 285.14275,304.842 248.15625,281.53125 C 235.51605,273.56475 218.57513,269.89652 200.34375,269.875 C 153.75246,269.82 98.606739,293.43208 84.46875,329.03125 C 64.798509,378.56054 -2.2712417,574.91797 1.5,678.25 C 5.0785642,776.30266 20.906856,796.56763 57.3125,795.70312 C 141.78831,786.65213 150.45828,738.83858 207.40625,694.09375 C 260.20364,652.61006 297.18742,648.83525 374.875,650.34375 C 452.56257,648.83527 489.51511,652.61009 542.3125,694.09375 C 599.26048,738.83855 607.93044,786.63651 692.40625,795.6875 z"],
  shoulders: ["M 97.673659,318.60794 C 97.892168,317.5154 101.82534,300.47167 102.26235,297.63105 C 102.69937,294.79043 103.3549,293.26086 106.85105,290.85726 C 139.66464,268.29793 178.05731,257.40679 216.1057,263.5436 C 222.87949,264.63614 231.61987,281.67987 231.61987,281.67987 L 97.673659,318.60794 z", "M 655.50745,318.60794 C 655.28894,317.5154 651.35577,300.47167 650.91876,297.63105 C 650.48174,294.79043 649.82621,293.26086 646.33006,290.85726 C 613.51647,268.29793 575.1238,257.40679 537.07541,263.5436 C 530.30162,264.63614 521.56124,281.67987 521.56124,281.67987 L 655.50745,318.60794 z"],
  triggers: [63.4, 226.4], pullAt: -30,
  ls: [63.1, 44.1], rs: [186.7, 93.7], dpad: [102.3, 92.7], face: [227.5, 47.2],
  select: [115.9, 48.7], start: [175.5, 48.7], home: [145.9, 48.8]
};
var LEVEL = {
  box: "-8 -18 331 220",
  fit: "scale(.525)",
  body: ["m 135.17536,37.68543 c -15.55539,-0.0442 -30.76705,2.95454 -41.972089,9.1254 -6.638555,13.43858 -24.067983,31.41091 -31.27004,60.35428 -25.705779,85.95043 -32.81272,158.57024 -36.322456,202.14445 0,33.54855 27.187916,60.74846 60.736498,60.74846 27.103537,0 48.894897,-15.7845 57.404057,-43.32181 l 24.85598,-71.37881 c 3.69721,-5.8797 12.74174,-8.2975 18.4897,-8.93431 l 225.80599,0 c 5.74795,0.63681 14.79248,3.05461 18.4897,8.93431 l 24.85597,71.37881 c 8.50916,27.53731 30.30051,43.32181 57.40405,43.32181 33.54861,0 60.7365,-27.19991 60.7365,-60.74846 -3.50973,-43.57421 -10.61665,-116.19402 -36.32245,-202.14445 -7.20206,-28.94337 -24.63149,-46.9157 -31.27004,-60.35428 -11.20504,-6.17086 -26.4167,-9.16956 -41.97209,-9.1254 -15.55535,0.0442 -31.46204,3.13115 -44.03843,9.1254 l -241.57241,0 c -12.5764,-5.99425 -28.4831,-9.08125 -44.03844,-9.1254 z"],
  shoulders: ["M 98.961241,39.661931 C 119.06114,28.566101 142.70298,26.469828 166.53156,35.976277 l 0,15.425142 -67.570319,0 z", "M 501.03874,39.661931 C 480.93885,28.566101 457.297,26.469828 433.46843,35.976277 l 0,15.425142 67.57031,0 z"],
  triggers: [69.7, 245.3], pullAt: -14,
  ls: [112, 103.9], rs: [203.9, 103.9], dpad: [68.1, 66], face: [247.7, 65.8],
  select: [99.1, 37.8], start: [216.8, 37.8], home: [157.5, 106],
  upright: true,                        // its two small buttons stand on end
  touch: [112.1, 23.7, 91.8, 50.3]
};
var FACE_AT = [[0, 21], [21, 0], [-21, 0], [0, -21]];

function part(n, inside) { return '<g class="pp-b" data-b="' + n + '">' + inside + "</g>"; }
function stick(n, axis, c) {
  return '<g class="pp-b pp-stick" data-b="' + n + '"><circle class="pp-s" cx="' + c[0] + '" cy="' + c[1] + '" r="20"/>' +
    '<circle class="pp-knob" data-axis="' + axis + '" cx="' + c[0] + '" cy="' + c[1] + '" r="11"/></g>';
}
function pill(n, c, upright) {
  var w = upright ? 9 : 18, h = upright ? 17 : 10;
  return part(n, '<rect class="pp-s" x="' + (c[0] - w / 2) + '" y="' + (c[1] - h / 2) + '" width="' + w + '" height="' + h + '" rx="' + (Math.min(w, h) / 2) + '"/>');
}

/* The picture for one pad. `level`: the sticks side by side; `face(n)` answers
   a face button's name and drawing (padFace, js\padkind.js). */
export function padPicture(kind, level, hasTouch, face) {
  var at = level ? LEVEL : OFFSET, d = at.dpad;
  var s = '<g class="pp-body" transform="' + at.fit + '">' + at.body.map(function (p) { return '<path d="' + p + '"/>'; }).join("") + "</g>";
  // The triggers fill as far as they are pulled; the shoulders under them, in the drawing's own shape.
  at.triggers.forEach(function (x, i) {
    s += '<rect class="pp-s" data-mark="' + (6 + i) + '" x="' + (x - 20) + '" y="' + at.pullAt + '" width="40" height="24" rx="5"/>' +
         '<rect class="pp-fill" data-pull="' + (6 + i) + '" data-foot="' + (at.pullAt + 24) + '" x="' + (x - 20) + '" y="' + (at.pullAt + 24) + '" width="40" height="0" rx="5"/>';
  });
  at.shoulders.forEach(function (p, i) { s += part(4 + i, '<path class="pp-s" transform="' + at.fit + '" d="' + p + '"/>'); });
  if (hasTouch && at.touch) { s += part(17, '<rect class="pp-s" x="' + at.touch[0] + '" y="' + at.touch[1] + '" width="' + at.touch[2] + '" height="' + at.touch[3] + '" rx="6"/>'); }
  [[12, -7, -21], [13, -7, 7], [14, -21, -7], [15, 7, -7]].forEach(function (a) {
    s += part(a[0], '<rect class="pp-s" x="' + (d[0] + a[1]) + '" y="' + (d[1] + a[2]) + '" width="14" height="14" rx="3"/>');
  });
  s += stick(10, 0, at.ls) + stick(11, 2, at.rs);
  FACE_AT.forEach(function (o, n) {
    var x = at.face[0] + o[0], y = at.face[1] + o[1], f = face(n);
    var mark = f.art ? '<g class="pp-m" transform="translate(' + (x - 6) + " " + (y - 6) + ') scale(.75)">' + f.art + "</g>"
             : kind === "position" ? "" : '<text x="' + x + '" y="' + y + '">' + f.name + "</text>";
    s += '<g class="pp-b" data-b="' + n + '"><title>' + f.name + '</title><circle class="pp-s" cx="' + x + '" cy="' + y + '" r="10.5"/>' + mark + "</g>";
  });
  s += pill(8, at.select, at.upright) + pill(9, at.start, at.upright);
  s += part(16, '<circle class="pp-s" cx="' + at.home[0] + '" cy="' + at.home[1] + '" r="7.5"/>');
  return '<svg class="padpic" viewBox="' + at.box + '" data-layout="' + (level ? "level" : "offset") + '" data-names="' + kind + '" role="img" aria-label="A controller">' + s + "</svg>";
}
