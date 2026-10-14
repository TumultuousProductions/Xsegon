/*  Jump by letter. Page Up and Page Down, and the pad's shoulders, take the
    selection to the next letter of whatever the list is arranged by, and that
    letter stands large on the screen for a moment.

    Only where the list really runs by letter: A-Z, developer, publisher,
    genre or console. Arranged any other way a page is four steps, and in the
    Rows view it is three rows.                                             */

import { $platform, $sort, S, games, sel, view } from "./state.js";
import { el } from "./util.js";
import { columns, move, navRows } from "./views.js";

// What each letter order reads its letter from.
var FIELD = { title: "sortTitle", developer: "developer", publisher: "publisher", genre: "genre", platform: "platform" };

/* The letter a name files under, as the list's own headers have it
   (api\library.php): A to Z, and "0-9" for anything else. An accent is
   dropped first, so an E with one is with the Es. Nothing at all is "". */
function letterOf(text) {
  var c = String(text || "").replace(/^\s+/, "").charAt(0).normalize("NFD").charAt(0).toUpperCase();
  return c === "" ? "" : c >= "A" && c <= "Z" ? c : "0-9";
}

/* Every game's letter in the order on screen, or null where the list does
   not run by letter: an order with no letters, Recently added (by date,
   whatever Arrange By says), or letters that turn out scattered. With
   Favourites first the favourites are a run of their own (the "*"). */
function lettersNow() {
  var field = FIELD[$sort.value];
  if (!field || $platform.value === "@added" || games.length < 2) { return null; }
  var favFirst = !!(S.view && S.view.favouritesFirst);
  var keys = [], seen = {}, kinds = 0, runs = 0;
  for (var i = 0; i < games.length; i++) {
    var g = games[i];
    var k = (favFirst && g.favourite ? "*" : "") + letterOf(field === "sortTitle" ? (g.sortTitle || g.title) : g[field]);
    keys.push(k);
    if (!seen[k]) { seen[k] = true; kinds++; }
    if (i === 0 || k !== keys[i - 1]) { runs++; }
  }
  // Each letter in one stretch, give or take a name that files oddly.
  return runs <= kinds * 1.5 + 2 ? keys : null;
}

var $flash = null, flashT = null;
function flash(letter) {
  if (!$flash) {
    $flash = el("div", "letterflash");
    $flash.setAttribute("aria-hidden", "true");
    document.body.appendChild($flash);
  }
  $flash.textContent = letter;
  $flash.classList.add("on");
  clearTimeout(flashT);
  flashT = setTimeout(function () { $flash.classList.remove("on"); }, 700);
}

/* Down (1): the first game of the next letter, or from the last letter its
   last game. Up (-1): the top of this letter, then the top of the one
   before. False where the list does not run by letter. */
function letterJump(sign) {
  var keys = lettersNow();
  if (!keys) { return false; }
  var at = sel, to = at;
  if (sign > 0) {
    to = at + 1;
    while (to < keys.length && keys[to] === keys[at]) { to++; }
    if (to >= keys.length) { to = keys.length - 1; }
  } else {
    while (to > 0 && keys[to - 1] === keys[at]) { to--; }
    if (to === at && at > 0) {
      to = at - 1;
      while (to > 0 && keys[to - 1] === keys[at - 1]) { to--; }
    }
  }
  // At either end there is no letter left: one step, so Wrap around still turns the list over.
  move(to === at ? sign : to - at);
  if (sel !== at) { flash(keys[sel].replace("*", "") || "?"); }
  return true;
}

/* A page up (-1) or down (1), from the keys or a shoulder button. */
export function pageBy(sign) {
  if (view === "rows") { navRows(0, sign * 3); return; }
  if (!letterJump(sign)) { move(sign * 4 * (view === "grid" || view === "shelf" ? columns() : 1)); }
}
