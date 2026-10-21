/*  The logo tip: where the menu bar is not (a wheel, a carousel, rows), a note
 *  beside the Xsegon logo says that its menu holds Games, Get Media,
 *  Emulators and Help. It stays until its X is pressed or the logo's menu is
 *  first opened, then never comes back: kept in the settings
 *  (feel.tipsGone.logoMenu, which Reset to defaults keeps) and in this browser
 *  as well, in case that save fails. It stands in the masthead's empty middle,
 *  so windows cover it and it covers nothing, and it is not shown where that
 *  middle has no room.
 */

import { logoTipWords } from "./brand.js";
import { L } from "./log.js";
import { saveSetting } from "./savednote.js";
import { $logo, S } from "./state.js";
import { el } from "./util.js";

var KEEP = "xs-tip-logo-gone";      // this browser's own mark, beside the settings
var ROOM = 200;                     // the least width, in pixels, it is shown in
var $tip = null, gone = false, told = false, watching = false;

// Put away already, or no word from the settings: it is never shown on a guess.
function putAway() {
  var t = S.feel && S.feel.tipsGone;
  if (gone || !t || t.logoMenu !== false) { return true; }
  try { return localStorage.getItem(KEEP) === "1"; } catch (e) { return false; }   // no browser storage: the settings decide
}

function drop() {
  if ($tip) { $tip.remove(); }
  $tip = null;
}

function make() {
  $tip = el("div", "logo-tip");
  $tip.setAttribute("role", "note");
  $tip.appendChild(el("span", "logo-tip-arrow"));
  $tip.appendChild(el("span", "logo-tip-words", logoTipWords()));
  var x = el("button", "logo-tip-x", "✕");
  x.type = "button";
  x.tabIndex = -1;                  // out of the Tab order: Enter on a focused button is also Enter, the game key
  x.title = "Put this tip away for good";
  x.setAttribute("aria-label", x.title);
  x.addEventListener("mousedown", function (e) { e.stopPropagation(); });
  x.addEventListener("click", function (e) { e.stopPropagation(); logoTipDone("its X was pressed"); });
  $tip.appendChild(x);
}

/* Beside the logo, level with it, as far as the next thing on the masthead's
   row. Hidden while that is narrower than ROOM: a narrow window, or a
   masthead that has wrapped. */
function place() {
  var head = $logo.closest("header"), brand = $logo.closest(".brand");
  if (!head || !brand) { drop(); return; }
  if (!$tip) { make(); }
  if ($tip.parentNode !== head) { head.appendChild($tip); }
  var h = head.getBoundingClientRect(), b = brand.getBoundingClientRect(), lg = $logo.getBoundingClientRect();
  var left = b.right + 18, end = h.right;
  Array.prototype.forEach.call(head.children, function (n) {
    if (n === $tip || n.contains(brand)) { return; }
    var r = n.getBoundingClientRect();
    if (r.width && r.left >= b.right && r.top < lg.bottom && r.bottom > lg.top) { end = Math.min(end, r.left); }
  });
  var room = Math.floor(end - 16 - left);
  $tip.hidden = room < ROOM;
  if ($tip.hidden) { return; }
  $tip.style.maxWidth = room + "px";
  $tip.style.left = Math.round(left - h.left) + "px";
  $tip.style.top = Math.round(lg.top + lg.height / 2 - $tip.offsetHeight / 2 - h.top) + "px";
}

// Each time the logo may have become the menu or stopped being it (paintSeg, js\views.js).
export function logoTip() {
  if (!$logo) { return; }
  if (!$logo.classList.contains("as-orb") || putAway()) { drop(); return; }
  place();
  if (!watching) {
    watching = true;
    window.addEventListener("resize", function () { if ($tip) { place(); } });
  }
  if (!told && !$tip.hidden) {
    told = true;
    L("MNU", "logo tip shown beside the logo");
  }
}

/* For good: its X, or the logo's menu opened (js\menus.js). Saved once, and
   saved again where only this browser had kept it. */
export function logoTipDone(how) {
  drop();
  var t = S.feel && S.feel.tipsGone;
  if (gone || !t) { gone = true; return; }
  gone = true;
  try { localStorage.setItem(KEEP, "1"); } catch (e) { /* the settings keep it */ }
  if (t.logoMenu === true) { return; }
  L("MNU", "logo tip put away for good: " + how);
  S.feel.tipsGone = Object.assign({}, t, { logoMenu: true });
  saveSetting({ feel: { tipsGone: S.feel.tipsGone } }, "Putting the logo tip away");
}
