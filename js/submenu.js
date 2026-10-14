import { L } from "./log.js";
import { hideMenuTip } from "./menu-tips.js";
import { ctxAt, ctxFocus, ctxItems, ctxUse, menuFill } from "./menus.js";
import { sound } from "./sound.js";
import { el } from "./util.js";

/*  A group's box: a row that leads to more entries opens them in a box at its
 *  side, the menu staying up behind. One level only.
 *  The pointer: resting on the row opens the box, a press opens it at once. The
 *  way to the box crosses other rows, so one closes it only once the pointer stays.
 *  Keys and pad: Right or Enter (A) go into the box, Left or Esc (B) come back
 *  out. One list is walked at a time (ctxUse).
 */
var OPEN_WAIT = 200, AWAY_WAIT = 300;
var box = null, owner = null, items = [];    // the box, the row it hangs from, what can be pressed in it
var behind = null;                           // the menu's own list, while the bar is in the box
var openTimer = 0, openFor = null, awayTimer = 0, awayTo = null;

/* Beside the menu, its first entry level with the row: over the menu's edge
   by a hair so the two read as one thing, and on the other side where the
   screen ends. */
function place() {
  var r = owner.node.getBoundingClientRect(), m = owner.node.closest(".ctx").getBoundingClientRect();
  var w = box.offsetWidth, h = box.offsetHeight, cs = getComputedStyle(box);
  var lead = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.borderTopWidth) || 0);
  var left = m.right - 3;
  if (left + w > innerWidth - 8) { left = m.left - w + 3; }
  box.style.left = Math.round(Math.max(8, left)) + "px";
  box.style.top = Math.round(Math.max(8, Math.min(r.top - lead, innerHeight - h - 8))) + "px";
}

function show(it, en, pressed) {
  clearTimeout(openTimer);
  openFor = null;
  if (owner === it) { return; }
  hide();
  owner = it;
  items = [];
  box = el("div", "ctx ctx-sub");
  box.setAttribute("role", "menu");
  menuFill(en.sub(), box, items);
  document.body.appendChild(box);
  place();
  it.node.classList.add("open");
  hideMenuTip();                             // the box stands where the row's card would
  L("MNU", "open " + en.label + " (" + items.length + " live)" + (pressed ? "" : ", rested on"));
  if (pressed) { sound("select"); }
}

// Gone, and nothing else touched: the menu itself is closing, or the keys walked off the row.
function drop() {
  clearTimeout(openTimer);
  clearTimeout(awayTimer);
  openTimer = awayTimer = 0;
  openFor = awayTo = null;
  if (box) { owner.node.classList.remove("open"); box.remove(); }
  box = null;
  owner = null;
  items = [];
  behind = null;
}

// Closed by the person: the bar goes back to the row it hung from, if it was in the box.
function hide() {
  if (!box) { return; }
  var list = behind, from = owner;
  drop();
  if (list) { ctxUse(list, list.indexOf(from)); }
}

function enter(at) {
  if (!box || behind) { return; }
  behind = ctxItems;
  ctxUse(items, at);
}

// The bar back on the row, the box still open beside it.
function leave() {
  if (!behind) { return; }
  var list = behind;
  behind = null;
  ctxUse(list, list.indexOf(owner));
}

/* A group's row: the item the menu's list holds for it. */
export function subRow(node, en) {
  var it = { node: node, sub: true };
  it.show = function (pressed) { show(it, en, pressed); };
  it.run = function () { it.show(true); enter(0); };         // Enter, A, Right
  node.addEventListener("click", function (e) { e.stopPropagation(); it.show(true); });
  return it;
}

/* The pointer on a row of the menu or of the box. True: the bar is not to
   move yet, the pointer may be on its way to the box. */
export function subHover(it) {
  if (box && items.indexOf(it) >= 0) {
    clearTimeout(awayTimer);
    awayTimer = 0;
    enter(items.indexOf(it));
    return false;
  }
  if (box && it !== owner) {
    awayTo = it;
    if (!awayTimer) { awayTimer = setTimeout(function () { var to = awayTo; awayTimer = 0; hide(); land(to); }, AWAY_WAIT); }
    return true;
  }
  clearTimeout(awayTimer);
  awayTimer = 0;
  leave();
  if (openFor && openFor !== it) { clearTimeout(openTimer); openFor = null; }
  if (it.sub && !box && openFor !== it) {
    openFor = it;
    openTimer = setTimeout(function () { openFor = null; if (ctxItems[ctxAt] === it) { it.show(false); } }, OPEN_WAIT);
  }
  return false;
}
function land(it) { if (it && !subHover(it)) { ctxFocus(ctxItems.indexOf(it)); } }

/* The bar came to rest on a row of the menu: a box hanging from another row goes. */
export function subWatch(it) {
  if (box && !behind && it !== owner) { drop(); }
}

/* Right on a group's row goes into its box, Left in a box comes back out. False: neither. */
export function subSide(d) {
  var it = ctxItems[ctxAt];
  if (d > 0 && !behind && it && it.sub) { it.run(); return true; }
  if (d < 0 && behind) { hide(); return true; }
  return false;
}

/* Esc, Backspace, B: out of the box when the bar is in one. False: it is not. */
export function subBack() {
  if (!behind) { return false; }
  hide();
  return true;
}

export function subClose() { drop(); }
