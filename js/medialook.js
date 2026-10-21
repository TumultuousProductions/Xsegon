/*  Look in, beside the Media tab's compare (js\mediacompare.js): every place
    that fits the game, a switch each, an arrow that moves one up (the first is
    shown first), and what each said. Kept for next time as library.look
    (js\mediaplaces.js, saveLook); a place that does not fit is not listed.  */

import { openPicker } from "./art-editors.js";
import { setTabRows } from "./detailtabs.js";
import { iconEl } from "./icons.js";
import { KIND_LABEL, lookGroup, saveLook } from "./mediaplaces.js";
import { sound } from "./sound.js";
import { el, plural } from "./util.js";

// What a place that does not fit is for, so a missing one is not a mystery.
var ONLY = { pictures: "Steam is listed for a Steam game only.", videos: "Steam's trailers are listed for a Steam game, the Arcade Database for an arcade game.",
             manuals: "" };

/* What a place said, as its row says it. */
export function placeWords(p, st) {
  if (!p.on) { return "off: not asked"; }
  if (p.note) { return p.note; }
  if (!st || st.state === "waiting" || st.state === "asking") { return "asking..."; }
  if (st.state === "done") { return plural(st.items.length, "found", "found"); }
  if (st.state === "none") { return st.why || "has none"; }
  return "could not be asked: " + (st.why || "no answer");
}

/* The places in the person's order: fits as the server listed them, look as saved. */
export function inOrder(fits, look, kind) {
  var order = (look && look[lookGroup(kind)]) || [];
  var at = function (k) { var i = order.indexOf(k); return i < 0 ? 99 : i; };
  return fits.slice().sort(function (a, b) { return at(a.key) - at(b.key); });
}

/* Turned on and off as the person left it; a place with no saved word is on. */
export function placeIsOn(look, kind, key) {
  return ((look && look.off) || []).indexOf(lookGroup(kind) + ":" + key) < 0;
}

/*
 * The panel, drawn again from c (the compare: fits, look, view, kind) at every change. onToggle(key, on)
 * and onUp(key) are told after the look is saved; c.look is changed in place.
 */
export function drawLookIn(box, c, onToggle, onUp) {
  box.textContent = "";
  box.appendChild(el("span", "mc-ptitle", "Look in"));
  box.appendChild(el("p", "mc-help", "Turn a place on or off. The arrow moves one up: the first is shown first. Kept for next time."));
  var group = lookGroup(c.kind);
  var list = inOrder(c.fits, c.look, c.kind);
  if (!list.length) { box.appendChild(el("p", "mc-dim", "No place Xsegon knows has these for this console.")); }
  list.forEach(function (p, i) {
    var on = placeIsOn(c.look, c.kind, p.key);
    var line = el("div", "mc-place" + (on ? "" : " off"));
    line.dataset.place = p.key;
    var sw = el("button", "mc-sw" + (on ? " on" : ""));
    sw.type = "button";
    sw.dataset.key = "sw:" + p.key;
    sw.dataset.word = on ? "turn off" : "turn on";
    sw.setAttribute("aria-pressed", on ? "true" : "false");
    sw.setAttribute("aria-label", p.name);
    sw.appendChild(el("span", "mc-knob"));      // the knob is its own: a button's ::after is its hover sweep
    sw.addEventListener("click", function () {
      var off = (c.look.off || []).filter(function (x) { return x !== group + ":" + p.key; });
      if (on) { off.push(group + ":" + p.key); }
      c.look.off = off;
      sound(on ? "back" : "select");
      saveLook(c.look, group + " " + p.key + (on ? " off" : " on"));
      onToggle(p.key, !on);
    });
    line.appendChild(sw);
    var words = el("span", "mc-pwords");
    words.appendChild(el("span", "mc-pname", p.name));
    var st = c.view.places[p.key];
    var said = placeWords({ on: on, note: p.note }, st);
    words.appendChild(el("span", "mc-pstate" + (st && st.state === "failed" ? " bad" : ""), said));
    line.appendChild(words);
    var up = el("button", "mc-up" + (i === 0 ? " hide" : ""));
    up.type = "button";
    up.dataset.key = "up:" + p.key;
    up.dataset.word = "show it sooner";
    up.setAttribute("aria-label", "Show " + p.name + " sooner");
    up.appendChild(iconEl("mc-up-ico", "up"));
    up.addEventListener("click", function () {
      if (i === 0) { return; }
      var order = list.map(function (x) { return x.key; });
      order.splice(i, 1);
      order.splice(i - 1, 0, p.key);
      // The places that do not fit this game keep their places after these.
      var kept = (c.look[group] || []).filter(function (k) { return order.indexOf(k) < 0; });
      c.look[group] = order.concat(kept);
      sound("move");
      saveLook(c.look, group + " " + p.key + " up");
      onUp(p.key);
    });
    line.appendChild(up);
    box.appendChild(line);
  });
  if (ONLY[group]) { box.appendChild(el("p", "mc-dim", ONLY[group])); }
}

/* Wrong game? Search...: the Games Database's own search, for a game it has under another name (js\art-editors.js,
   openPicker), the pad going down its presses; done() once it closes. */
export function searchPicker(c, done) {
  var box = openPicker(c.g, c.kind, KIND_LABEL[c.kind], c.body, function () { if (!c.closed) { done(); } });
  var on = 0;
  function presses() { return Array.prototype.slice.call(box.querySelectorAll(".pk-head button, .pk-search button, .pk > button, .pk-cell, .pk-result")); }
  function mark(i) {
    var all = presses();
    on = Math.max(0, Math.min(all.length - 1, i));
    all.forEach(function (x, n) { x.classList.toggle("sel", n === on); });
    if (all[on]) { all[on].scrollIntoView({ block: "nearest", inline: "nearest" }); }
    setTabRows(c.pane, { cells: all, at: on, word: "choose", move: function (d) { mark(on + d); },
                         choose: function () { var x = presses()[on]; if (x) { x.click(); } } });
  }
  mark(0);
}
