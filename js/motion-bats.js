/*  Bats (with the mark "bat"): now and then one, two or three cross the
    screen and are gone, and nothing moves in between. A bat is drawn here
    from lines of its own, joint by joint: no picture is loaded. They fly in
    front of the games and under the bars and the windows, or behind the
    panels when the stylesheet's --bats-front is 0. How long between flights
    (--bats-wait, seconds) and how large (--bats-size) are said there too. */

var BAT_UNIT = 46;              // pixels to one unit of the drawing: a wing at full stretch is about 1.25 units
var batLot = [], batW = 0, batH = 0, batEvery = 60, batBig = 1, batClock = 0, batDue = 0, batUp = false, batInk = null;

function batPoint(from, angle, far) { return [from[0] + Math.cos(angle) * far, from[1] - Math.sin(angle) * far]; }

// A wing's joints at one moment of the beat (1 up, -1 down): the arm leads and the fingers follow it.
function batWing(beat, late) {
  var shoulder = [.09, -.03], lift = .4 + .85 * beat, elbow = batPoint(shoulder, .28 + .62 * beat, .27), wrist = batPoint(elbow, lift, .3), out = -.42 + .95 * late;
  return { shoulder: shoulder, elbow: elbow, wrist: wrist, hip: [.065, .27], thumb: batPoint(wrist, lift + .95, .075),
           tips: [batPoint(wrist, out, .66), batPoint(wrist, out - .6, .56), batPoint(wrist, out - 1.22, .46)] };
}

// The skin between two finger tips hangs in a curve, drawn in toward the joint it is stretched from.
function batBow(c, a, b, toward) {
  var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  c.quadraticCurveTo(mx + (toward[0] - mx) * .4, my + (toward[1] - my) * .4, b[0], b[1]);
}

// One wing, the right one: its skin, the light along its edge, then the arm, the three fingers and the thumb's claw.
function batWingDraw(c, w, thin) {
  c.beginPath();
  c.moveTo(w.shoulder[0], w.shoulder[1]);
  c.lineTo(w.elbow[0], w.elbow[1]);
  c.lineTo(w.wrist[0], w.wrist[1]);
  c.lineTo(w.tips[0][0], w.tips[0][1]);
  batBow(c, w.tips[0], w.tips[1], w.wrist);
  batBow(c, w.tips[1], w.tips[2], w.wrist);
  batBow(c, w.tips[2], w.hip, w.elbow);
  c.closePath();
  c.fillStyle = batInk.skin;
  c.fill();
  c.fillStyle = "rgba(" + batInk.rim + ", .16)";
  c.fill();
  c.strokeStyle = "rgba(" + batInk.rim + ", .5)";
  c.lineWidth = thin;
  c.stroke();
  c.beginPath();
  c.moveTo(w.shoulder[0], w.shoulder[1]);
  c.lineTo(w.elbow[0], w.elbow[1]);
  c.lineTo(w.wrist[0], w.wrist[1]);
  w.tips.forEach(function (tip) { c.moveTo(w.wrist[0], w.wrist[1]); c.lineTo(tip[0], tip[1]); });
  c.moveTo(w.wrist[0], w.wrist[1]);
  c.lineTo(w.thumb[0], w.thumb[1]);
  c.strokeStyle = "rgba(" + batInk.rim + ", .6)";
  c.lineWidth = thin * 1.6;
  c.stroke();
}

// One ear, the right one (side 1) or the left (-1): tall and pointed, with a paler inside.
function batEar(c, side, thin) {
  c.beginPath();
  c.moveTo(.012 * side, -.16);
  c.quadraticCurveTo(.03 * side, -.27, .088 * side, -.315);
  c.quadraticCurveTo(.108 * side, -.2, .066 * side, -.115);
  c.closePath();
  c.fillStyle = batInk.fur;
  c.fill();
  c.strokeStyle = "rgba(" + batInk.rim + ", .5)";
  c.lineWidth = thin;
  c.stroke();
  c.beginPath();
  c.moveTo(.04 * side, -.18);
  c.lineTo(.078 * side, -.275);
  c.lineTo(.074 * side, -.165);
  c.closePath();
  c.fillStyle = "rgba(" + batInk.eye + ", .32)";
  c.fill();
}

// The body over the wings' roots: tail skin, legs and claws, a furred trunk with a ruff, ears, head, eyes and two teeth.
function batBody(c, thin) {
  var side, i;
  c.strokeStyle = "rgba(" + batInk.rim + ", .5)";
  c.lineWidth = thin;
  c.beginPath();
  c.moveTo(-.065, .24);
  c.quadraticCurveTo(-.03, .33, 0, .41);
  c.quadraticCurveTo(.03, .33, .065, .24);
  c.closePath();
  c.fillStyle = batInk.skin;
  c.fill();
  c.stroke();
  c.beginPath();
  for (side = -1; side <= 1; side += 2) {
    c.moveTo(.04 * side, .25);
    c.lineTo(.056 * side, .335);
    for (i = -1; i <= 1; i++) { c.moveTo(.056 * side, .335); c.lineTo((.056 + i * .016) * side, .365); }
  }
  c.stroke();
  c.beginPath();
  c.ellipse(0, .09, .086, .18, 0, 0, 6.2832);
  c.fillStyle = batInk.fur;
  c.fill();
  c.stroke();
  // The ruff: tufts of fur across the chest, lit with the theme's highlight.
  c.beginPath();
  c.moveTo(-.084, -.01);
  for (i = 0; i < 6; i++) { c.lineTo(-.07 + i * .028, i % 2 ? .0 : .062); }
  c.lineTo(.084, -.01);
  c.quadraticCurveTo(0, -.07, -.084, -.01);
  c.fillStyle = "rgba(" + batInk.rim + ", .28)";
  c.fill();
  batEar(c, -1, thin);
  batEar(c, 1, thin);
  c.beginPath();
  c.arc(0, -.115, .07, 0, 6.2832);
  c.fillStyle = batInk.fur;
  c.fill();
  c.strokeStyle = "rgba(" + batInk.rim + ", .5)";
  c.stroke();
  c.beginPath();
  c.ellipse(0, -.082, .03, .021, 0, 0, 6.2832);
  c.fillStyle = batInk.skin;
  c.fill();
  for (side = -1; side <= 1; side += 2) {
    c.beginPath();
    c.arc(.027 * side, -.128, .028, 0, 6.2832);
    c.fillStyle = "rgba(" + batInk.eye + ", .22)";
    c.fill();
    c.beginPath();
    c.arc(.027 * side, -.128, .0115, 0, 6.2832);
    c.fillStyle = "rgb(" + batInk.eye + ")";
    c.fill();
    c.beginPath();
    c.moveTo(.006 * side, -.072);
    c.lineTo(.013 * side, -.046);
    c.lineTo(.02 * side, -.072);
    c.closePath();
    c.fillStyle = "rgba(" + batInk.tooth + ", .92)";
    c.fill();
  }
}

// A whole bat where it is now: the body sinks a little as the wings go up and rises as they come down.
function batDraw(c, b) {
  var unit = BAT_UNIT * b.big, wing = batWing(Math.sin(b.beat), Math.sin(b.beat - .6)), thin = 1.1 / unit;
  c.save();
  c.translate(b.x, b.y + Math.sin(b.beat) * unit * .05);
  c.rotate(b.tilt);
  c.scale(unit, unit);
  c.lineJoin = c.lineCap = "round";
  batWingDraw(c, wing, thin);
  c.scale(-1, 1);
  batWingDraw(c, wing, thin);
  c.scale(-1, 1);
  batBody(c, thin);
  c.restore();
}

// A bat setting out from one side: the first of a flight, or one that follows it, smaller and a little behind.
function batNew(lead, nth) {
  var way = lead ? lead.way : (Math.random() < .5 ? 1 : -1), big = (lead ? .58 + Math.random() * .26 : .9 + Math.random() * .25) * batBig;
  var back = 150 * big + nth * (110 + Math.random() * 80);
  return { way: way, big: big, x: way > 0 ? -back : batW + back, y: 0, tilt: 0, age: 0,
           v: lead ? lead.v * (.94 + Math.random() * .12) : 150 + Math.random() * 70,
           y0: lead ? lead.y0 + (Math.random() < .5 ? -1 : 1) * (45 + Math.random() * 70) : batH * (.14 + Math.random() * .46),
           a1: 22 + Math.random() * 22, w1: 1 + Math.random() * .7, p1: Math.random() * 6.283,
           a2: 6 + Math.random() * 6, w2: 2.8 + Math.random() * 1.4, p2: Math.random() * 6.283,
           beat: Math.random() * 6.283, hz: (3.3 + Math.random() * .8) / Math.sqrt(big / batBig) };
}

// One, two or three set out together, mostly one.
function batFlight() {
  var roll = Math.random(), lead = batNew(null, 0);
  batLot = [lead];
  if (roll > .6) { batLot.push(batNew(lead, 1)); }
  if (roll > .9) { batLot.push(batNew(lead, 2)); }
}

// The next flight is brought forward to now: the door the themes test group sends a bat through.
export function batSend() {
  if (!batLot.length) { batDue = batClock; }
}

export var batMotion = {
  over: true,
  fit: function (box) {
    var ground = box.ink("--ground-rgb").split(",").map(Number);
    batW = box.w; batH = box.h;
    batEvery = Math.max(2, box.says("--bats-wait", 90));
    batBig = Math.max(.2, Math.min(4, box.says("--bats-size", .6)));
    batInk = { skin: "rgba(" + ground.map(function (g) { return Math.round(g * .4); }).join(", ") + ", .95)", fur: "rgb(" + box.ink("--panel-2-rgb") + ")",
               rim: box.ink("--cyan-rgb"), eye: box.ink("--magenta-rgb"), tooth: box.ink("--glint-rgb") };
    // The first flight comes soon, so a look just put on shows what it has.
    if (!batUp) { batUp = true; batClock = 0; batDue = 3 + Math.random() * 3; }
    batDue = Math.min(batDue, batClock + batEvery * 1.3);
    return box.says("--bats-front", 1) >= .5 ? "front" : "behind";
  },
  off: function () { batLot = []; batUp = false; },
  rest: function () { batLot = []; },
  step: function (dt) {
    var flying = batLot.length > 0;
    batClock += dt;
    if (!flying && batClock >= batDue) { batFlight(); }
    batLot = batLot.filter(function (b) {
      var was = b.y;
      b.age += dt;
      b.x += b.way * b.v * dt;
      b.y = b.y0 + b.a1 * Math.sin(b.w1 * b.age + b.p1) + b.a2 * Math.sin(b.w2 * b.age + b.p2);
      b.tilt = b.way * (.1 + (b.age > dt ? Math.atan2((b.y - was) / dt, b.v) * .45 : 0));
      b.beat += 6.2832 * b.hz * dt;
      return b.way > 0 ? b.x < batW + 160 * b.big : b.x > -160 * b.big;
    });
    if (flying && !batLot.length) { batDue = batClock + batEvery * (.7 + Math.random() * .6); }
    return flying || batLot.length > 0;
  },
  paint: function (c) {
    batLot.forEach(function (b) { batDraw(c, b); });
  }
};
