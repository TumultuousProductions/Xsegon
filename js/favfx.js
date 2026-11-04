/*  The favourite star's answer to a press: on, it turns once about its upright
    and bounces, larger and back; off, the lit star left where it stood goes up
    in a puff of smoke and the empty one fades in under it. Off with Settings
    > Feel > Animations.                                                    */

import { $body } from "./state.js";
import { el } from "./util.js";

// The star in sight: details' or the info panel's, never one left in a panel that is shut.
function starInSight() {
  return [].slice.call(document.querySelectorAll(".favbtn")).filter(function (b) {
    return b.offsetParent && b.getBoundingClientRect().width > 0;
  })[0] || null;
}

var starDone = null;                     // takes the last press's listeners off

// on: the game has just become a favourite. Called after the repaint, which makes the star anew.
export function starAnswers(on) {
  if ($body.classList.contains("no-anim")) { return; }
  var b = starInSight();
  if (!b) { return; }
  var cls = on ? "spin" : "dim";
  b.classList.remove("spin", "dim");
  // Measured before anything moves: the fade-in starts the star smaller.
  var at = { box: b.getBoundingClientRect(), text: textBox(b) };
  at.mid = inkMiddle(b, at);
  b.style.transformOrigin = at.mid.x + "px " + at.mid.y + "px";
  void b.offsetWidth;                    // the same class again starts it again
  b.classList.add(cls);
  // The last press's end is not this one's: its cancel comes a frame after this press took its class away.
  var want = on ? "xs-fav-on" : "xs-fav-off";
  if (starDone) { starDone(); }
  var done = function (e) {
    if (e.animationName !== want) { return; }
    b.classList.remove(cls);
    off();
  };
  var off = function () {
    b.removeEventListener("animationend", done);
    b.removeEventListener("animationcancel", done);
    if (starDone === off) { starDone = null; }
  };
  starDone = off;
  b.addEventListener("animationend", done);
  b.addEventListener("animationcancel", done);
  if (!on) { puff(b, at); }
}

/* The middle of the star's ink in its button, so it turns about itself: a
   glyph seldom sits in the middle of its box (the letter spacing after it,
   for one), and turned about the box it sways. Read from the font that draws
   it, so another PC's star is right too; the box's middle where it says nothing. */
function inkMiddle(b, at) {
  var cs = getComputedStyle(b), r = at.box, t = at.text, pen = document.createElement("canvas").getContext("2d");
  pen.font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
  var m = pen.measureText(b.textContent);
  if (!t.width || !(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent)) { return { x: r.width / 2, y: r.height / 2 }; }
  var x = t.left + (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
  var y = t.top + m.fontBoundingBoxAscent - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  return { x: +(x - r.left).toFixed(1), y: +(y - r.top).toFixed(1) };
}

/* The lit star, in the star's own font, put where its words were, grows,
   blurs and fades about the ink's middle; wisps rise off it, each drifting
   its own way. */
function puff(b, at) {
  var cs = getComputedStyle(b), r = at.box, size = parseFloat(cs.fontSize) || 21;
  var cx = r.left + at.mid.x, cy = r.top + at.mid.y;
  var ghost = el("span", "fav-ghost", "★");
  ghost.style.cssText = "left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;" +
    "font-style:" + cs.fontStyle + ";font-weight:" + cs.fontWeight + ";font-size:" + cs.fontSize + ";font-family:" + cs.fontFamily +
    ";letter-spacing:" + cs.letterSpacing;
  document.body.appendChild(ghost);
  // A flex box centres its line a little apart from a button: moved by the difference, the two stars are one.
  var now = textBox(ghost), gx = r.left + at.text.left - now.left, gy = r.top + at.text.top - now.top;
  ghost.style.left = gx + "px";
  ghost.style.top = gy + "px";
  ghost.style.transformOrigin = (cx - gx).toFixed(1) + "px " + (cy - gy).toFixed(1) + "px";
  gone(ghost, ghost.animate([
    { transform: "scale(1)", opacity: 1, filter: "blur(0)" },
    { transform: "translateY(-3px) scale(1.6)", opacity: 0, filter: "blur(3px)" }
  ], { duration: 460, easing: "ease-out" }));
  for (var i = 0; i < 6; i++) {
    var wisp = el("i", "fav-smoke"), w = Math.round(size * (0.4 + Math.random() * 0.25));
    wisp.style.cssText = "left:" + cx + "px;top:" + cy + "px;width:" + w + "px;height:" + w + "px";
    document.body.appendChild(wisp);
    var turn = (i / 6) * Math.PI * 2 + Math.random() * 0.6, far = size * (0.5 + Math.random() * 0.5);
    var dx = Math.cos(turn) * far, dy = Math.sin(turn) * far * 0.6 - size * 0.6;   // outward, and up
    gone(wisp, wisp.animate([
      { transform: "translate(-50%, -50%) scale(.4)", opacity: 0 },
      { offset: 0.25, opacity: 0.75 },
      { transform: "translate(-50%, -50%) translate(" + dx.toFixed(1) + "px, " + dy.toFixed(1) + "px) scale(1.6)", opacity: 0 }
    ], { duration: 600 + Math.random() * 250, easing: "ease-out", delay: Math.random() * 60, fill: "backwards" }));
  }
}

// Where a node's words are drawn, which is not its box.
function textBox(n) {
  var text = document.createRange();
  text.selectNodeContents(n);
  return text.getBoundingClientRect();
}

function gone(n, run) { run.onfinish = run.oncancel = function () { n.remove(); }; }
