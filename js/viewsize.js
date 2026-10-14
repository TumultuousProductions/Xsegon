/*  How big the grid's tiles, the shelf's spines and the rows' pictures are, and
    the gear that changes it: on the strip heading the grid and the shelf, and
    in the rows band's corner (the list's holds the Striped rows switch instead).
    A size is a percentage of the usual (view.gridSize, shelfSize, rowsSize);
    the stylesheet does the rest from --grid-scale and the like, so nothing is
    drawn again while the slider moves. The strip is drawn again with the view,
    so the gear is found by its id each time. */

import { iconEl } from "./icons.js";
import { L } from "./log.js";
import { rowsAcross, rowsPaint } from "./rows.js";
import { saveSetting } from "./savednote.js";
import { sound } from "./sound.js";
import { S, sel, view } from "./state.js";
import { el } from "./util.js";
import { columns, flatNodes } from "./views.js";
import { setListStripes } from "./viewset.js";

var KINDS = {
  grid:  { key: "gridSize",  prop: "--grid-scale",  head: "Tile size",  min: 50, max: 250, what: "tiles" },
  shelf: { key: "shelfSize", prop: "--shelf-scale", head: "Shelf size", min: 50, max: 200, what: "games" },
  rows:  { key: "rowsSize",  prop: "--rows-scale",  head: "Picture size", min: 50, max: 150, what: "pictures in the rows" },
  // A switch, not a size: flag is the view setting it turns on and off.
  list:  { flag: "listStripes", head: "Rows", label: "Striped rows", hint: "Every other row a shade apart, so a wide table is easier to follow across." }
};
var STEP = 10;
var pop = null, saveTimer = null;

function kindNow() { return KINDS[view] || null; }

export function viewSize(k) {
  var v = S.view ? Number(S.view[k.key]) : NaN;
  return isFinite(v) && v > 0 ? Math.max(k.min, Math.min(k.max, Math.round(v))) : 100;
}

// The two numbers the stylesheet reads. Called once as the page goes up.
export function applyViewSizes() {
  Object.keys(KINDS).forEach(function (name) {
    var k = KINDS[name];
    if (k.flag) { return; }
    var v = viewSize(k);
    if (v === 100) { document.documentElement.style.removeProperty(k.prop); }
    else { document.documentElement.style.setProperty(k.prop, String(v / 100)); }
  });
}

function setSize(k, v) {
  if (!S.view) { S.view = {}; }
  S.view[k.key] = v;
  applyViewSizes();
  // The chosen game stays in sight while everything round it changes size.
  var cur = flatNodes[sel];
  if (cur && cur.scrollIntoView) { cur.scrollIntoView({ block: "nearest" }); }
  if (view === "rows") { rowsPaint(); }    // the rows keep theirs in sight their own way
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    saveTimer = null;
    var payload = {};
    payload[k.key] = viewSize(k);
    L("SET", k.head.toLowerCase() + " " + payload[k.key] + "% (the gear on the strip)");
    saveSetting({ view: payload }, k.head);
  }, 350);
}

/* The gear, for the strip that heads the grid and the shelf, and for the
   corner of the rows' band (a cog alone there, like the wheel's). The
   list's says Rows, for its switch. Nothing for the wheel and the carousel:
   the wheel has a gear of its own. */
export function sizeButton() {
  var k = kindNow();
  if (!k) { return null; }
  var b = el("button", "vsize" + (pop ? " on" : ""));
  b.type = "button";
  b.id = "vsize";
  b.title = k.flag ? k.head + ": how the list's rows are drawn" : k.head + ": how big the " + k.what + " are drawn";
  b.setAttribute("aria-label", k.head);
  b.setAttribute("aria-haspopup", "dialog");
  b.setAttribute("aria-expanded", pop ? "true" : "false");
  b.appendChild(iconEl("vsize-ico", "gear"));
  if (view !== "rows") { b.appendChild(el("span", "vsize-word", k.flag ? k.head : "Size")); }
  b.addEventListener("click", function (e) { e.stopPropagation(); if (pop) { closeSizer(); } else { openSizer(); } });
  return b;
}

function gearNow() { return document.getElementById("vsize"); }

function say(k) {
  var n = view === "rows" ? rowsAcross() : columns();
  return viewSize(k) === 100 ? "As Xsegon comes. " + n + " across." : n + " across.";
}

function paint() {
  var k = kindNow();
  if (!pop || !k) { return; }
  pop.querySelector(".wpop-head").textContent = k.head;
  var input = pop.querySelector("input");
  if (k.flag) { input.checked = !!(S.view && S.view[k.flag]); return; }
  input.min = k.min; input.max = k.max; input.step = STEP;
  input.value = viewSize(k);
  pop.querySelector(".wpop-n").textContent = viewSize(k) + "%";
  pop.querySelector(".wpop-hint").textContent = say(k);
  pop.querySelector(".vsize-reset").disabled = viewSize(k) === 100;
}

function place() {
  var g = gearNow();
  if (!pop || !g) { return; }
  var r = g.getBoundingClientRect();
  pop.style.top = Math.round(r.bottom + 6) + "px";
  pop.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + "px";
}

function onKeyWhileOpen(e) {
  if (e.key !== "Escape") { return; }
  e.preventDefault();
  e.stopPropagation();
  closeSizer();
  sound("back");
  var g = gearNow();
  if (g) { g.blur(); }
}
function onPressWhileOpen(e) {
  if (pop.contains(e.target) || (e.target.closest && e.target.closest("#vsize"))) { return; }
  closeSizer();
}

// The slider's side of the window: its number, what it comes to, and the way back.
function sizeRows(line, input) {
  line.appendChild(el("span", "wpop-n"));
  pop.appendChild(el("p", "wpop-hint"));
  input.addEventListener("input", function () {
    var now = kindNow();
    if (!now) { return; }
    setSize(now, Number(input.value));
    paint();
    place();                               // a wider or narrower scrollbar side moves the gear
  });
  var reset = el("button", "wpop-more vsize-reset", "Back to the usual size");
  reset.type = "button";
  reset.addEventListener("click", function () {
    var now = kindNow();
    if (!now) { return; }
    setSize(now, 100);
    sound("select");
    paint();
    input.focus();
  });
  pop.appendChild(reset);
}

export function openSizer() {
  var k = kindNow();
  if (!k || !gearNow()) { return; }
  if (pop) { closeSizer(); }
  pop = el("div", "vsize-pop");
  pop.id = "vsize-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", k.head);
  pop.appendChild(el("div", "wpop-head", k.head));
  pop.xsFlag = !!k.flag;
  var line = el("label", "wpop-row" + (k.flag ? " wpop-flag" : ""));
  line.appendChild(el("span", "wpop-k", k.flag ? k.label : "Size"));
  var input = el("input");
  input.type = k.flag ? "checkbox" : "range";
  line.appendChild(input);
  pop.appendChild(line);
  if (k.flag) {
    // The switch: kept at the press, like any selection (js\viewset.js).
    input.className = "tgl";
    pop.appendChild(el("p", "wpop-hint", k.hint));
    input.addEventListener("change", function () { setListStripes(input.checked); });
  } else {
    sizeRows(line, input);
  }
  // Its own keys: the arrows move the slider, not the games behind it.
  pop.addEventListener("keydown", function (e) { if (e.key !== "Escape") { e.stopPropagation(); } });
  document.body.appendChild(pop);
  paint();
  place();
  var g = gearNow();
  g.classList.add("on");
  g.setAttribute("aria-expanded", "true");
  document.addEventListener("keydown", onKeyWhileOpen, true);
  document.addEventListener("pointerdown", onPressWhileOpen, true);
  window.addEventListener("resize", place);
  sound("select");
  input.focus();
}

export function closeSizer() {
  if (!pop) { return; }
  if (pop.parentNode) { pop.parentNode.removeChild(pop); }
  pop = null;
  document.removeEventListener("keydown", onKeyWhileOpen, true);
  document.removeEventListener("pointerdown", onPressWhileOpen, true);
  window.removeEventListener("resize", place);
  var g = gearNow();
  if (g) { g.classList.remove("on"); g.setAttribute("aria-expanded", "false"); }
}

/* The view was drawn again under an open window: it goes with a view that
   has no size of its own, and otherwise says the new view's and stays on
   the new strip's gear. */
export function syncSizer() {
  if (!pop) { return; }
  // A switch's window does not turn into a slider's, nor the other way.
  if (!kindNow() || !gearNow() || pop.xsFlag !== !!kindNow().flag) { closeSizer(); return; }
  paint();
  place();
}
