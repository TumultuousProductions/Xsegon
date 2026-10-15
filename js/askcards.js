/*  One short question at a time, in big words over the dimmed page: a new
 *  copy's first start (js\autosetup.js) and what Set it all up asks once the
 *  games are in (js\setuplist.js). Made of the asking window's own pieces
 *  (.confirm-wrap, .confirm-bar), so the keys and the pad work as in any other.
 *  Neither answer is lit; Esc or a press outside is the answer that starts nothing.
 */

import { sound } from "./sound.js";
import { closeOnBackdrop, el } from "./util.js";

/*  q: title; big, a folder or a count said large under it; lines, each
    [words, kind] with kind "note" (said in ink: the long wait) or "faint";
    yes and no, the two answers (yes may be left out for a card that only
    tells); onYes, onNo; onAway for Esc or a press outside, onNo when not given. */
export function askCard(q) {
  var wrap = el("div", "confirm-wrap setup-confirm ask-card" + (q.cls ? " " + q.cls : ""));
  var box = el("div", "confirm");
  box.appendChild(el("h2", null, q.title));
  if (q.big) { box.appendChild(el("p", "ask-big", q.big)); }
  (q.lines || []).forEach(function (l) { box.appendChild(el("p", "ask-line" + (l[1] ? " ask-" + l[1] : ""), l[0])); });
  var bar = el("div", "confirm-bar");
  if (q.yes) { bar.appendChild(answer(q.yes, q.onYes)); }
  var noBtn = answer(q.no, q.onNo);
  bar.appendChild(noBtn);
  box.appendChild(bar);
  wrap.appendChild(box);
  document.body.appendChild(wrap);
  function answer(label, run) {
    var b = el("button", null, label);
    b.type = "button";
    b.addEventListener("click", function () { close(); if (run) { run(); } });
    return b;
  }
  function away() { close(); var run = q.onAway || q.onNo; if (run) { run(); } }
  function close() {
    if (wrap.parentNode) { wrap.parentNode.removeChild(wrap); }
    document.removeEventListener("keydown", key, true);
  }
  function key(e) {
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); sound("back"); away(); }
  }
  document.addEventListener("keydown", key, true);
  closeOnBackdrop(wrap, away);   // the press decides, not the release
  // Enter on the answer that starts nothing; the cross walks to the other
  noBtn.focus();
  sound("select");
  return { box: box, close: close };
}

/*  Several in turn, each answered yes or no. list: [{ key, q }], q as above
    without its handlers. done(got, away): got holds true or false for every
    key; Esc or a press outside ends it there, the rest answered no. The
    handle's close() takes the card down and calls nothing (answered on
    another page). */
export function askCards(list, done) {
  var got = {}, at = 0, card = null;
  list.forEach(function (c) { got[c.key] = false; });
  function next() {
    if (at >= list.length) { card = null; done(got, false); return; }
    var c = list[at];
    var q = Object.assign({}, c.q);
    q.onYes = function () { got[c.key] = true; at++; next(); };
    q.onNo = function () { at++; next(); };
    q.onAway = function () { card = null; done(got, true); };
    card = askCard(q);
  }
  next();
  return { close: function () { if (card) { card.close(); card = null; } } };
}
