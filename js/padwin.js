/*  A window or the mailbox by controller: the cross walks whatever can be
    pressed, by where it stands on screen, and yes presses it. LB and RB step
    through everything in order, so nothing is out of reach. The right stick
    scrolls, and so do up and down once nothing further lies that way.
    A dropdown opens as one of Xsegon's own menus (js\padtop.js); a box for
    typing takes the caret and back leaves it. Nothing is lit until the controller moves. */

import { closeEditor } from "./editors.js";
import { L } from "./log.js";
import { closeMail, mailOpen } from "./news.js";
import { padChoices } from "./padtop.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";

var CAN = "button, select, textarea, input:not([type=hidden]), a[href], summary, [tabindex]:not([tabindex='-1'])";
var HOLD_MS = 400, AGAIN_MS = 110;       // a direction held: the wait before it repeats, then how fast
var ASIDE = 3;                           // a step aside counts this many times a step ahead
var PART = 0.35;                         // one scroll: this much of the box's height
var ROLL = 45;                           // the right stick pushed all the way: this far at each look

var at = null;               // the control the bar is on; null until the controller moves
var place = 0;               // where it stood among the window's controls, for a window that draws itself again
var sign = "";               // what told it from the others there
var title = "";              // the window it stood in
var caret = null;            // a box for typing this controller opened
var roll = [];               // what the right stick may scroll, looked for as it is first pushed
var again = 0;
var watched = [];

function win() { return mailOpen() ? document.getElementById("mailbox") : $editor; }
function titleOf(w) { return (w.querySelector(".panel-title") || {}).textContent || ""; }
function shown(n) { return !n.disabled && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== "hidden"; }
function all(w) { return Array.prototype.filter.call(w.querySelectorAll(CAN), shown); }
function nameOf(n) { return (n.id || n.textContent.replace(/\s+/g, " ").trim() || n.name || n.placeholder || n.type || n.tagName).slice(0, 40); }
function typed(n) { return n.tagName === "TEXTAREA" || (n.tagName === "INPUT" && !/^(checkbox|radio|button|submit|reset|file|range|color)$/.test(n.type)); }
function slider(n) { return n.tagName === "INPUT" && n.type === "range"; }
// What tells one control from another when a window is drawn again: its kind, else its words.
function mark(n) { return n.tagName + "|" + (n.classList[0] || nameOf(n)); }

// The boxes inside a window that scroll by themselves (a long list, the log's lines), and the one a control is in.
function scrolls(n) { return n.scrollHeight > n.clientHeight + 1 && !n.matches(CAN) && /auto|scroll/.test(getComputedStyle(n).overflowY); }
function boxes(w) { return Array.prototype.filter.call(w.querySelectorAll("*"), scrolls); }
function holder(n, held, w) {
  var deep = w;
  held.forEach(function (s) { if (s.contains(n)) { deep = s; } });
  return deep;
}
function room(s, dy) { return dy > 0 ? s.scrollTop + s.clientHeight < s.scrollHeight - 1 : s.scrollTop > 0; }
function inSight(n, s) {
  var r = n.getBoundingClientRect(), v = s.getBoundingClientRect();
  return r.bottom > v.top && r.top < v.bottom && r.right > v.left && r.left < v.right;
}
// How far apart two stretches are. Ones that only touch count a hair apart, so what stands level beats what merely borders it.
function apart(lo, hi, lo2, hi2) { return Math.min(hi, hi2) - Math.max(lo, lo2) < 1 ? Math.max(0, lo2 - hi, lo - hi2) + 0.5 : 0; }

// The control that way, nearest by where it stands. One that a scrolling box hides counts only from inside that box.
function toward(from, list, dx, dy, own, held, w) {
  var c = from.getBoundingClientRect(), best = null, least = Infinity;
  function look(n) {
    if (n === from) { return; }
    var r = n.getBoundingClientRect();
    var ahead = dx > 0 ? r.left - c.right : dx < 0 ? c.left - r.right : dy > 0 ? r.top - c.bottom : c.top - r.bottom;
    if (ahead < -2) { return; }
    var aside = dx ? apart(c.top, c.bottom, r.top, r.bottom) : apart(c.left, c.right, r.left, r.right);
    var far = Math.max(0, ahead) + aside * ASIDE;
    if (far < least) { least = far; best = n; }
  }
  if (own !== w) { list.forEach(function (n) { if (own.contains(n)) { look(n); } }); }
  if (best) { return best; }
  list.forEach(function (n) {
    var s = holder(n, held, w);
    if (s === w || s === own || inSight(n, s)) { look(n); }
  });
  return best;
}

function unlight() { if (at) { at.classList.remove("pad-at"); } }
function forget() { unlight(); at = null; place = 0; sign = ""; title = ""; caret = null; roll = []; }
function put(n, list, w, quiet) {
  if (caret && caret !== n) { caret.blur(); caret = null; }
  unlight();
  at = n;
  place = list.indexOf(n);
  sign = mark(n);
  title = titleOf(w);
  n.classList.add("pad-at");
  n.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (!quiet) { L("PAD", "window: on " + nameOf(n)); sound("move"); }
}

/* A hand on the mouse or the keys takes the bar off (typing in a box this
   controller opened does not). A window put away forgets where the bar stood. */
function handBack(e) {
  if (!at || !e.isTrusted || (e.type === "keydown" && caret && e.target === caret)) { return; }
  unlight();
  at = null;
  title = "";
}
function watch(w) {
  if (watched.indexOf(w) >= 0) { return; }
  if (!watched.length) {
    document.addEventListener("mousedown", handBack, true);
    document.addEventListener("keydown", handBack, true);
  }
  watched.push(w);
  new MutationObserver(function () { if (w.hidden) { forget(); } }).observe(w, { attributes: true, attributeFilter: ["hidden"] });
}

// Where the bar starts: where it stood in this window, else the control with the caret, else the first under the heading.
function first(list, w) {
  var has = document.activeElement, stood = list[Math.min(place, list.length - 1)];
  if (title && title === titleOf(w) && stood) { return stood; }
  if (has && list.indexOf(has) >= 0) { return has; }
  return list.filter(function (n) { return !n.closest(".set-head, .mail-head"); })[0] || list[0];
}

// What may scroll, in the order it is tried: the box the bar is in, then the others in sight, then the window.
function rollers(w, held) {
  held = held || boxes(w);
  var own = at && w.contains(at) ? holder(at, held, w) : null;
  return [own].concat(held.filter(function (s) { return inSight(s, w); }), [w]).filter(Boolean);
}
function roller(w, dy, held) { return rollers(w, held).filter(function (s) { return room(s, dy); })[0] || null; }
function scroll(s, dy) {
  if (!s) { return; }
  s.scrollBy(0, dy * Math.max(60, Math.round(s.clientHeight * PART)));
  L("PAD", "window: scrolled " + (dy > 0 ? "down" : "up"));
}

function step(w, dx, dy, order) {
  var list = all(w), i = at ? list.indexOf(at) : -1;
  if (!list.length) { if (dy) { scroll(roller(w, dy), dy); } return; }
  // Nothing lit yet, or what was lit has gone from sight: the bar is shown, and moves at the next press.
  if (!at || (i < 0 && !at.getClientRects().length)) { put(first(list, w), list, w); return; }
  if (order) {
    if (i < 0) { i = order > 0 ? place - 1 : place; }      // lit but switched off: its neighbours are where it stood
    put(list[(i + order + list.length) % list.length], list, w);
    return;
  }
  if (dx && slider(at)) {
    if (dx > 0) { at.stepUp(); } else { at.stepDown(); }
    at.dispatchEvent(new Event("input", { bubbles: true }));
    at.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  var held = boxes(w), own = holder(at, held, w);
  var to = toward(at, list, dx, dy, own, held, w);
  if (!to) { if (dy) { scroll(roller(w, dy, held), dy); } return; }
  // Far out of sight (a long text between): the box scrolls toward it first, so what lies between can be read.
  if (dy) {
    var s = holder(to, held, w), r = to.getBoundingClientRect(), v = s.getBoundingClientRect();
    if ((dy > 0 ? r.top - v.bottom : v.top - r.bottom) > s.clientHeight * PART && room(s, dy)) { scroll(s, dy); return; }
  }
  put(to, list, w);
}

// The same walk for a window's arrow keys (js\filterwin.js): the control that way from the one with the caret, or where to start.
export function winToward(w, from, dx, dy) {
  var list = all(w), held = boxes(w);
  return from && list.indexOf(from) >= 0 ? toward(from, list, dx, dy, holder(from, held, w), held, w) : first(list, w);
}

function press() {
  var n = at;
  L("PAD", "window: press " + nameOf(n));
  if (n.tagName === "SELECT") {
    padChoices(n, (n.labels && n.labels[0] && n.labels[0].textContent.replace(/\s+/g, " ").trim()) || "Choose");
    return;
  }
  sound("select");
  if (typed(n)) { n.focus(); caret = n; return; }
  n.click();
}

/* Asked at every poll while a window or the mailbox is up with nothing over it.
   `k` is what is held now, with lb and rb just pressed and ry the right stick
   (0 inside its dead zone); `prev` what the last poll left. Answers what to leave for the next. */
export function padWinPoll(k, prev) {
  var w = win(), now = Date.now();
  var d = k.down ? 2 : k.up ? -2 : k.right ? 1 : k.left ? -1 : 0;
  var sd = k.ry > 0 ? 1 : k.ry < 0 ? -1 : 0;
  watch(w);
  // The window drew itself again: the bar goes back where it stood, if the same control is there.
  if (at && !w.contains(at)) {
    var same = title === titleOf(w), list = same ? all(w) : [];
    var there = list[Math.min(place, list.length - 1)];
    at = null;
    caret = null;
    if (there && mark(there) === sign) { put(there, list, w, true); }
    else if (!same) { place = 0; title = ""; }
  }
  if (d !== 0 && (d !== prev.wd || now >= again)) {
    again = now + (d !== prev.wd ? HOLD_MS : AGAIN_MS);
    step(w, d === 1 ? 1 : d === -1 ? -1 : 0, d === 2 ? 1 : d === -2 ? -1 : 0, 0);
  } else if (k.lb || k.rb) {
    step(w, 0, 0, k.rb ? 1 : -1);
  }
  // The right stick: the first of them with room that way scrolls, so a list at its end hands on to the window.
  if (sd !== 0) {
    if (sd !== prev.ws) { roll = rollers(w); }
    var turn = roll.filter(function (s) { return s.isConnected && room(s, sd); })[0];
    if (sd !== prev.ws) { L("PAD", "window: the right stick scrolls " + (sd > 0 ? "down" : "up") + (turn ? "" : ", nothing to scroll")); }
    if (turn) { turn.scrollBy(0, Math.round(k.ry * ROLL)); }
  }
  if (at && k.a && !prev.a) { press(); }
  if (k.b && !prev.b) {
    if (caret && document.activeElement === caret) {
      L("PAD", "window: left the box for typing");
      caret.blur();
      caret = null;
      sound("back");
    } else {
      forget();
      if (mailOpen()) { closeMail(); } else { closeEditor(); }
    }
  }
  return { a: !!k.a, b: !!k.b, x: !!k.x, y: !!k.y, wd: d, ws: sd };
}
