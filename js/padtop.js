/*  The top of the screen by controller. One button (the job "top", View on an
    Xbox pad) puts the bar on the masthead, the menu bar and its pickers, and
    the platform sidebar; the cross walks them, yes presses, back returns to
    the games. A dropdown opens as one of Xsegon's own menus, since a controller
    cannot walk its list. The search box is left out: it is for typing. */

import { openFilterWindow } from "./filterwin.js";
import { paintHelp, paintHelpHere } from "./help.js";
import { L } from "./log.js";
import { MB_ORDER, ctxFocus, ctxItems, mbOpen, openBarMenu, popupMenu } from "./menus.js";
import { sound } from "./sound.js";

var ROWS = {
  head: "#brand-logo.as-orb, #btn-info, #warn-mark, #phone-mark, #btn-mail, #btn-add, #btn-contrast, #viewsel, #btn-settings, #btn-min, #btn-close",
  bar:  "#btn-systems, #mb button, #btn-filter, #platform, #added, #sort, #btn-random",
  side: "#sidebar .sb-item"
};
var HOLD_MS = 400, AGAIN_MS = 110;       // a direction held: the wait before it repeats, then how fast

var at = null;               // the control the bar is on; null while the pad is with the games
var row = "";                // which of ROWS it is in
var away = false;            // a press here opened something: the legend is drawn again on the way back
var again = 0;
var armed = false;

// The platform dropdown lies see-through over its drawn face: the face is what is seen and ringed.
function box(n) { return n.closest(".pfpick") || n; }
function shown(n) { return !!n && !n.hidden && !n.disabled && box(n).getClientRects().length > 0; }
function mid(n) { var r = box(n).getBoundingClientRect(); return r.left + r.width / 2; }
function nameOf(n) { return n.id || n.dataset.menu || n.dataset.key || n.textContent.trim() || "all"; }

// One row as it stands on the screen: the stylesheet moves the search box's end of the bar about.
function line(which) {
  var list = Array.prototype.filter.call(document.querySelectorAll(ROWS[which]), shown);
  if (which !== "side") { list.sort(function (p, q) { return box(p).getBoundingClientRect().left - box(q).getBoundingClientRect().left; }); }
  return list;
}
function nearest(list, to) {
  var x = mid(to), best = null, far = Infinity;
  list.forEach(function (n) { var d = Math.abs(mid(n) - x); if (d < far) { far = d; best = n; } });
  return best;
}

function put(n, which) {
  if (at) { box(at).classList.remove("pad-at"); }
  at = n;
  row = which;
  box(n).classList.add("pad-at");
  box(n).scrollIntoView({ block: "nearest" });
  L("PAD", "top: on " + nameOf(n));
}

export function padTopLeave() {
  if (!at) { return; }
  box(at).classList.remove("pad-at");
  at = null;
  row = "";
  away = false;
  L("PAD", "top: back to the games");
  paintHelpHere();
}

// Up from the games: the round X where the menu bar shows, else the bar's first control, else Settings.
function enter() {
  var bar = line("bar"), head = line("head");
  var first = bar.filter(function (n) { return n.dataset.menu === "xsegon"; })[0] || bar[0];
  var to = first || head.filter(function (n) { return n.id === "btn-settings"; })[0] || head[0];
  if (!to) { return; }
  // A hand on the mouse or the keys gives the bar back to them.
  if (!armed) {
    armed = true;
    document.addEventListener("mousedown", padTopLeave, true);
    document.addEventListener("keydown", padTopLeave, true);
  }
  put(to, first ? "bar" : "head");
  sound("select");
  paintHelp("top");
}

function step(dx, dy) {
  var list = line(row), i = list.indexOf(at), to = null, into = row;
  if (row === "side") {
    if (dx > 0) { padTopLeave(); return; }
    if (dy) { to = list[i + dy]; }
    if (!to && dy < 0) { into = "bar"; to = nearest(line("bar"), at); }
  } else if (dx) {
    to = list[i + dx];
  } else if (dy < 0) {
    if (row === "bar") { into = "head"; to = nearest(line("head"), at); }
  } else if (row === "head" && line("bar").length) {
    into = "bar";
    to = nearest(line("bar"), at);
  } else {
    // Down from the bar: the sidebar where it stands under this control, else the games.
    var side = line("side");
    if (row !== "bar" || !side.length || mid(at) > side[0].getBoundingClientRect().right) { padTopLeave(); return; }
    into = "side";
    to = side.filter(function (n) { return n.classList.contains("on"); })[0] || side[0];
  }
  if (to) { put(to, into); sound("move"); }
}

// A dropdown's choices as a menu of Xsegon's own, opened on the one in use. Also a window's dropdown (js\padwin.js), under `title`.
export function padChoices(s, title) {
  var r = box(s).getBoundingClientRect(), entries = [];
  var add = function (o) {
    if (o.disabled || o.hidden) { return; }
    entries.push({ label: o.textContent.trim(), checked: o.selected, run: function () {
      s.value = o.value;
      s.dispatchEvent(new Event("change", { bubbles: true }));
    } });
  };
  Array.prototype.forEach.call(s.children, function (c) {
    if (c.tagName !== "OPTGROUP") { add(c); return; }
    entries.push({ rule: true });
    Array.prototype.forEach.call(c.children, add);
  });
  popupMenu(entries, Math.round(r.left), Math.round(r.bottom + 2), title || s.getAttribute("aria-label") || s.title || "Arrange by");
  var on = ctxItems.findIndex(function (it) { return it.node.classList.contains("on"); });
  ctxFocus(on >= 0 ? on : 0);
}

function press() {
  var n = at;
  L("PAD", "top: press " + nameOf(n));
  away = true;
  if (n.dataset.menu) { openBarMenu(n.dataset.menu); ctxFocus(0); }
  else if (n.id === "btn-filter") { openFilterWindow(); }
  else if (n.tagName === "SELECT") { padChoices(n); }
  else if (row === "side") { padTopLeave(); n.click(); }     // a console chosen: its games are what comes next
  else { sound("select"); n.click(); }
}

/* Asked at every poll once no window, menu or details has the pad. `k` is what
   is held now, with `hit` for the top button just pressed; `prev` what the last
   poll left. Answers what to leave for the next poll, or null for the games. */
export function padTopPoll(k, prev) {
  var d = k.down ? 2 : k.up ? -2 : k.right ? 1 : k.left ? -1 : 0, now = Date.now();
  var held = { a: !!k.a, b: !!k.b, x: !!k.x, y: !!k.y, td: d };
  if (!at) {
    if (!k.hit) { return null; }
    enter();
    return at ? held : null;
  }
  // The control went from under the bar (another view, a console opened): the nearest one left, or the games.
  if (!shown(at)) {
    var rest = line(row);
    if (!rest.length) { padTopLeave(); return held; }
    put(rest[0], row);
  }
  if (away) { away = false; paintHelp("top"); }
  if (d !== 0 && (d !== prev.td || now >= again)) {
    again = now + (d !== prev.td ? HOLD_MS : AGAIN_MS);
    step(d === 1 ? 1 : d === -1 ? -1 : 0, d === 2 ? 1 : d === -2 ? -1 : 0);
  }
  if (at && k.a && !prev.a) { press(); }
  else if (at && ((k.b && !prev.b) || k.hit)) { sound("back"); padTopLeave(); }
  return held;
}

// A menu entry run by the pad: what it does is what comes next, so the bar goes back to the games. A folded group only opens.
export function padTopRan(it) { if (at && !it.sub) { padTopLeave(); } }

// Left and right in one of the bar's menus: the menu beside it, as the arrow keys do.
export function padTopSide(d) {
  if (!mbOpen) { return; }
  var i = MB_ORDER.indexOf(mbOpen);
  for (var k = 1; k < MB_ORDER.length; k++) {
    var which = MB_ORDER[(i + d * k + MB_ORDER.length * k) % MB_ORDER.length];
    var b = document.querySelector('#mb [data-menu="' + which + '"]');
    if (!shown(b)) { continue; }
    openBarMenu(which);
    ctxFocus(0);
    if (at) { put(b, "bar"); }
    sound("move");
    return;
  }
}
