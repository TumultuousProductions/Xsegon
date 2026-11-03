/*  The cover between the games and their details: as details opens, the box
    art the view showed for the game travels to its place there while the
    panel fades in under it, and back as details closes. Off with Settings >
    Feel > Animations and where Windows asks for less motion; its time is the
    stylesheet's --cover-fly, which 0 turns off.                            */

import { rowsNode } from "./rows.js";
import { $body, $details, $hero, sel, view } from "./state.js";
import { artUrl, el } from "./util.js";
import { carNodes, flatNodes } from "./views.js";

var flight = null;                       // the one in the air: { clone, run, away, wait }

// Its time in ms, from the stylesheet; 340 where nothing says.
function flyMs() {
  var v = getComputedStyle(document.documentElement).getPropertyValue("--cover-fly").trim();
  if (!v) { return 340; }
  var n = parseFloat(v) || 0;
  return /[^m]s$/.test(v) ? n * 1000 : n;
}

function still() {
  return $body.classList.contains("no-anim") || matchMedia("(prefers-reduced-motion: reduce)").matches || !(flyMs() > 0);
}

/* Where an nw by nh picture is drawn in n on the screen: inside the border
   and padding, fitted as object-fit fits it, as large as a transform on it or
   its card makes it. In a video, fitted inside it; a picture not loaded yet
   is as tall as nw by nh will make it. Null for a picture cropped or
   stretched, which is not the whole cover. */
function drawn(n, nw, nh) {
  var r = n.getBoundingClientRect(), cs = getComputedStyle(n);
  if (!n.offsetWidth || !r.width || !nw || !nh) { return null; }
  var k = r.width / n.offsetWidth, isImg = n.tagName === "IMG", fit = isImg ? cs.objectFit : "contain";
  var pl = parseFloat(cs.paddingLeft) || 0, pt = parseFloat(cs.paddingTop) || 0;
  var bw = n.clientWidth - pl - (parseFloat(cs.paddingRight) || 0);
  var bh = n.clientHeight - pt - (parseFloat(cs.paddingBottom) || 0);
  var w = bw, h = bh, dy = 0;
  if (isImg && !(n.complete && n.naturalWidth)) { h = bw * nh / nw; }
  else if (fit === "contain" || fit === "scale-down") {
    var s = Math.min(bw / nw, bh / nh, fit === "scale-down" ? 1 : Infinity);
    w = nw * s; h = nh * s; dy = (bh - h) / 2;
  } else if (!bh || Math.abs(bw / bh - nw / nh) > 0.03 * nw / nh) { return null; }
  if (w < 8 || h < 8) { return null; }
  return { x: r.left + (n.clientLeft + pl + (bw - w) / 2) * k, y: r.top + (n.clientTop + pt + dy) * k, w: w * k, h: h * k };
}

// The picture as it stands, or the snap playing in its place, which hides it (js\snap.js); null when neither is in sight.
function shown(img) {
  if (!img.hidden) { return img.offsetParent ? img : null; }
  var v = img.parentNode && img.parentNode.querySelector("video.snap");
  return v && v.offsetParent ? v : null;
}

/* The game's box art as the view shows it: its tile in the grid, its card in
   the carousel or Rows, else the info panel's. Only one loaded and in sight. */
function onView(g) {
  var url = artUrl(g, "box");
  var card = view === "carousel" ? carNodes && carNodes[sel] : view === "rows" ? rowsNode() : view === "grid" ? flatNodes[sel] : null;
  var imgs = [].slice.call(card ? card.querySelectorAll("img") : []);
  if (!$hero.hidden) { imgs = imgs.concat([].slice.call($hero.querySelectorAll("img.hero-art"))); }
  for (var i = 0; i < imgs.length; i++) {
    var im = imgs[i];
    var at = im.getAttribute("src") === url && im.complete && im.naturalWidth ? shown(im) : null;
    var r = at && drawn(at, im.naturalWidth, im.naturalHeight);
    if (r && r.x < innerWidth && r.y < innerHeight && r.x + r.w > 0 && r.y + r.h > 0) {
      return { img: im, r: r, where: (im.classList.contains("hero-art") ? "the info panel" : "the " + view + " view") + (at === im ? "" : ", where its video played") };
    }
  }
  return null;
}

function fly(img, from, to, landed) {
  var c = el("img", "cover-fly");
  c.alt = "";
  c.src = img.currentSrc || img.src;
  c.style.cssText = "left:" + to.x + "px;top:" + to.y + "px;width:" + to.w + "px;height:" + to.h + "px";
  var grey = getComputedStyle(img).filter;          // a NEEDS FIX cover flies grey, as it stands
  if (grey && grey !== "none") { c.style.filter = grey; }
  document.body.appendChild(c);
  var run = c.animate([
    { transform: "translate(" + (from.x - to.x) + "px, " + (from.y - to.y) + "px) scale(" + from.w / to.w + ", " + from.h / to.h + ")" },
    { transform: "none" }
  ], { duration: flyMs(), easing: "cubic-bezier(.2, .7, .2, 1)" });
  var f = flight = { clone: c, run: run, away: null, wait: 0 };
  run.onfinish = function () { if (flight === f) { landed(f); } };
  return f;
}

// Whatever is in the air put down at once: the copy gone, each picture it stood for shown.
export function land() {
  var f = flight;
  if (!f) { return; }
  flight = null;
  clearTimeout(f.wait);
  f.run.onfinish = null;
  f.run.cancel();
  f.clone.remove();
  if (f.away) { f.away.classList.remove("cover-away"); }
  $details.classList.remove("cover-hid");
}

// Landed in details: the copy stays over the cover until its own picture has come, 1.5 s at most.
function intoPlace(f) {
  var cov = $details.querySelector(".dleft img.cover");
  if (!cov || (cov.complete && cov.naturalWidth) || $details.hidden) { land(); return; }
  f.wait = setTimeout(land, 1500);
  var done = function () { if (flight === f) { land(); } };
  cov.addEventListener("load", done, { once: true });
  cov.addEventListener("error", done, { once: true });
}

// Where the game's cover stands, read while the view is still on the screen; null for no flight.
export function coverFrom(g) {
  return g && g.hasArt && !still() ? onView(g) : null;
}

/* Details just shown: the copy leaves from, the panel fades in rather than
   scaling, and the cover there waits, through the second drawing from the full record. */
export function flyIn(from) {
  land();
  $details.classList.toggle("cover-in", !!from);
  var img = from && $details.querySelector(".dleft img.cover");
  var to = img && (img.complete && img.naturalWidth ? drawn(img, img.naturalWidth, img.naturalHeight)
                                                    : drawn(img, from.img.naturalWidth, from.img.naturalHeight));
  if (!to) { $details.classList.remove("cover-in"); return; }
  $details.classList.add("cover-hid");
  fly(from.img, from.r, to, intoPlace);
}

// Details' cover, read before details goes, for flyOut once the view is back.
export function coverLeaving() {
  land();
  if (still()) { return null; }
  var img = $details.querySelector(".dleft img.cover");
  var at = img && img.complete && img.naturalWidth ? shown(img) : null;
  var r = at && drawn(at, img.naturalWidth, img.naturalHeight);
  return r ? { img: img, r: r } : null;
}

/* The view just came back, and its opening wave runs again: on the picture
   and what holds it, that is ended, so the picture stands where the copy lands.
   The other games still come in around it. */
function arrived(img) {
  for (var n = img; n && n !== $body; n = n.parentElement) {
    n.getAnimations().forEach(function (a) { if (a.effect && isFinite(a.effect.getComputedTiming().endTime)) { a.finish(); } });
  }
}

// Back to its place in the view, the view's own picture hidden under it until it lands.
export function flyOut(g, from) {
  var to = from && g && onView(g);
  if (!to) { return; }
  arrived(to.img);
  var r = drawn(to.img, to.img.naturalWidth, to.img.naturalHeight);
  if (!r) { return; }
  to.img.classList.add("cover-away");
  fly(from.img, from.r, r, land).away = to.img;
}
