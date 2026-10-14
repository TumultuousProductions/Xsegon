/*  Filter by: a window of its own, laid out as a page of Settings: sections that
    fold, a row to each filter with its switch, and along the top what is on and
    how many games that leaves. A press takes effect at once and the list behind
    is read again; nothing here is saved (js\library.js says why).

    Hacks is one row with three answers, since Hacks only and Leave hacks out can
    never both be on. Your tags are small buttons, at most two lines of them; the
    rest open as a list, so no number of tags pushes the window off the screen. */

import { setEditorOnClose, toolFrame } from "./editors.js";
import { iconEl } from "./icons.js";
import { FILTERS, anyFilter, clearFilters, filterWords, filters, listSettled, setMinRating, tagFiltered, tagsAll, toggleFilter, toggleTagFilter } from "./library.js";
import { L } from "./log.js";
import { TIPS } from "./menu-tips.js";
import { $ctx, closeGameMenu, ctxFocus, ctxItems, popupMenu } from "./menus.js";
import { winToward } from "./padwin.js";
import { sound } from "./sound.js";
import { $count, $editor } from "./state.js";
import { el } from "./util.js";

var TAGS_SHOWN = 6;          // tags with a button of their own, at most; the rest are behind the button after them
var TAG_LINES = 2;           // and no more lines of them than this: one fewer gets a button until they fit
var PER_COL = 10;            // the rest, in columns this long, so their list never scrolls
var ICON = { fav: "star", players: "gamepad", unplayed: "play", cheats: "wand", ready: "check", missing: "image", docs: "book", unrated: "star" };
// The sections, left column then right: [heading, FILTERS group].
var LEFT = [["Play", "play"], ["Ratings", "ratings"]], RIGHT = [["Files and pictures", "files"], ["Hacks", "hacks"], ["Your tags", "tags"]];
var HACKS = [["", "All"], ["hacks", "Only hacks"], ["nohacks", "No hacks"]];
var STEP = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

var win = null;              // the window, while it is up
var paints = [];             // what each part does to show how things now stand
var tagsBox = null, tagsSig = "", tagsFit = TAGS_SHOWN, restWasUp = false;

function hackNow() { return filters.hacks ? "hacks" : filters.nohacks ? "nohacks" : ""; }
// How many filters of a section are on, for its heading while it is folded.
function onIn(group) {
  if (group === "tags") { return filters.tags.length; }
  if (group === "hacks") { return hackNow() ? 1 : 0; }
  return FILTERS.filter(function (f) { return f.group === group && filters[f.key]; }).length + (group === "ratings" && filters.myrating ? 1 : 0);
}

function filterRow(icon, words, key, tip) {
  var r = el("div", "opt");
  r.dataset.key = key;
  if (tip) { r.title = tip; }
  r.appendChild(iconEl("opt-ico", icon));
  r.appendChild(el("label", null, words));
  return r;
}

/* A row or a heading pressed whole: by the pointer, by Enter or Space, and by
   a controller, which presses with a click (js\padwin.js). It is the one
   place on its line where the keys and a controller stand, so Left and Right
   go to the line beside it in the other column. */
function pressable(n, run) {
  n.tabIndex = 0;
  n.addEventListener("click", run);
  n.addEventListener("keydown", function (e) {
    if (e.target === n && !e.repeat && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); run(); }
  });
}

// A filter that is on or off: the row is what is pressed, its switch shows how it stands.
function switchRow(f) {
  var r = filterRow(ICON[f.key], f.label, f.key, f.tip), face = el("input", "tgl");
  if (f.hint && f.hint.length === 1) { r.querySelector("label").appendChild(el("span", "flt-keys", f.hint)); }   // its key in the list: F, 2
  face.type = "checkbox";
  face.disabled = true;
  face.setAttribute("aria-hidden", "true");
  r.setAttribute("role", "switch");
  pressable(r, function () { toggleFilter(f.key); paint(); });
  r.appendChild(face);
  paints.push(function () {
    face.checked = !!filters[f.key];
    r.setAttribute("aria-checked", filters[f.key] ? "true" : "false");
  });
  return r;
}

/* Your rating at least, the one filter with a value: a press on a star is
   that many and up, the same star again takes it off, and a press on the
   row steps it up a star and round to off, which is all the keys and a
   controller need. */
function starsRow() {
  var r = filterRow("starFill", "Your rating at least", "stars", TIPS.minRating), five = el("span", "flt-stars"), all = [];
  [1, 2, 3, 4, 5].forEach(function (n) {
    var s = el("span", "flt-star", "★");
    s.addEventListener("click", function (e) { e.stopPropagation(); setMinRating(n === filters.myrating ? 0 : n); paint(); });
    all.push(five.appendChild(s));
  });
  r.setAttribute("role", "button");
  pressable(r, function () { setMinRating((filters.myrating + 1) % 6); paint(); });
  r.appendChild(five);
  paints.push(function () {
    all.forEach(function (s, i) { s.classList.toggle("off", i >= filters.myrating); });
    r.setAttribute("aria-label", "Your rating at least: " + (filters.myrating ? filters.myrating + " and up" : "off"));
  });
  return r;
}

/* Hacks: with the rest, only them, or left out, one answer at a time. A
   press on an answer is that one; a press on the row steps to the next and
   round, as the stars do. */
function hacksRow() {
  var r = filterRow("bolt", "Hacks", "hack", "The games marked HACK: shown with the rest, only them, or left out. Press an answer, or press the row to step to the next."),
      seg = el("span", "seg flt-seg"), all = [];
  // The one asked for goes on and lets go of the other; All takes off the one that is on.
  var set = function (v) { if (v !== hackNow()) { toggleFilter(v || hackNow()); paint(); } };
  var said = function () { return HACKS.filter(function (h) { return h[0] === hackNow(); })[0]; };
  HACKS.forEach(function (h) {
    var b = el("span", "flt-ans", h[1]);
    b.dataset.hack = h[0];
    b.addEventListener("click", function (e) { e.stopPropagation(); set(h[0]); });
    all.push(seg.appendChild(b));
  });
  r.setAttribute("role", "button");
  pressable(r, function () { set(HACKS[(HACKS.indexOf(said()) + 1) % HACKS.length][0]); });
  r.appendChild(seg);
  paints.push(function () {
    all.forEach(function (b) { b.classList.toggle("on", b.dataset.hack === hackNow()); });
    r.setAttribute("aria-label", "Hacks: " + said()[1]);
  });
  return r;
}

/* Your tags, and one selected here whose last game has since let go of it,
   so it can be deselected. The ones with the most games get a button, A to
   Z, as many as fit (tagsFit); the rest are behind the button after them. */
function tagSplit() {
  var all = tagsAll.slice();
  filters.tags.forEach(function (t) {
    if (!all.some(function (x) { return x.name.toLowerCase() === t.toLowerCase(); })) { all.push({ name: t, count: 0 }); }
  });
  var top = all.slice().sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); }).slice(0, tagsFit);
  return { shown: all.filter(function (t) { return top.indexOf(t) >= 0; }), rest: all.filter(function (t) { return top.indexOf(t) < 0; }) };
}

function tagButton(t) {
  var b = el("button", "flt-tag");
  b.dataset.tag = t.name;
  b.title = t.name + ": " + t.count + (t.count === 1 ? " game" : " games");
  b.appendChild(iconEl("flt-tag-ico", "tag"));
  b.appendChild(el("span", "flt-tag-name", t.name));
  b.appendChild(el("span", "flt-tag-n", String(t.count)));
  b.addEventListener("click", function () { toggleTagFilter(t.name); paint(); });
  return b;
}

function drawTags(split) {
  tagsSig = JSON.stringify(split);
  tagsBox.textContent = "";
  split.shown.forEach(function (t) { tagsBox.appendChild(tagButton(t)); });
  if (!split.shown.length) { tagsBox.appendChild(el("span", "flt-none", "None yet: right-click a game, Tags...")); }
  if (!split.rest.length) { return; }
  var more = tagsBox.appendChild(el("button", "flt-tag flt-more", split.rest.length + " more..."));
  more.title = "The rest of your tags";
  // A press while its list is up closes it, as the bar's buttons do: the press that closed it is not also one that opens it.
  more.addEventListener("mousedown", function () { restWasUp = !!($ctx && $ctx.dataset.menu === "filter-tags"); });
  more.addEventListener("click", function () { if (restWasUp) { restWasUp = false; return; } openRest(); });
}
// How many lines the buttons stand on (one while their section is folded).
function tagLines() {
  var tops = {};
  Array.prototype.forEach.call(tagsBox.children, function (n) { tops[n.offsetTop] = true; });
  return Object.keys(tops).length;
}

// Which of them are on, and how many of the rest.
function tagStates(split) {
  Array.prototype.forEach.call(tagsBox.querySelectorAll("[data-tag]"), function (b) {
    b.classList.toggle("on", tagFiltered(b.dataset.tag));
    b.setAttribute("aria-pressed", tagFiltered(b.dataset.tag) ? "true" : "false");
  });
  var rest = tagsBox.querySelector(".flt-more"), on = split.rest.filter(function (t) { return tagFiltered(t.name); }).length;
  if (rest) {
    rest.textContent = split.rest.length + " more..." + (on ? " (" + on + " on)" : "");
    rest.classList.toggle("on", on > 0);
  }
}

/* Drawn again only when the tags or their counts changed, so the caret and a
   controller's bar stay where they are. How many get a button is measured
   with the button after them at its widest, so selecting one of the rest
   never moves a button. */
function paintTags() {
  if (!tagsBox) { return; }
  var split = tagSplit(), rest = null;
  if (JSON.stringify(split) !== tagsSig) { drawTags(split); }
  do {
    rest = tagsBox.querySelector(".flt-more");
    if (rest) { rest.textContent = split.rest.length + " more... (" + split.rest.length + " on)"; }
    if (tagsFit <= 1 || tagLines() <= TAG_LINES) { break; }
    tagsFit--;
    split = tagSplit();
    drawTags(split);
  } while (true);
  tagStates(split);
}

/* The rest of your tags, as a list under their button. It stays up while
   you select, drawn again in place, as a game's Tags list does. `at` is the
   key of the entry to stand on. */
function openRest(at) {
  var btn = win && win.querySelector(".flt-more"), rest = tagSplit().rest;
  if (!btn || !rest.length) { return; }
  var items = rest.map(function (t) {
    return { key: "t:" + t.name, icon: "tag", label: t.name, hint: String(t.count), checked: tagFiltered(t.name),
             run: function () { toggleTagFilter(t.name, true); paint(); openRest("t:" + t.name); } };
  });
  btn.scrollIntoView({ block: "nearest" });      // where the window scrolls, its list hangs from a button in sight
  var cols = [], r = btn.getBoundingClientRect();
  for (var i = 0; i < items.length; i += PER_COL) { cols.push({ items: items.slice(i, i + PER_COL) }); }
  popupMenu(cols.length > 1 ? [{ cols: cols }] : items, Math.round(r.left), Math.round(r.bottom + 4), "More of your tags");
  // With no room under its button it stands over it, so the button is never covered.
  var h = $ctx.offsetHeight;
  if (r.bottom + 4 + h > window.innerHeight - 8) { $ctx.style.top = Math.max(8, Math.round(r.top - 4 - h)) + "px"; }
  $ctx.dataset.menu = "filter-tags";
  var on = at ? ctxItems.findIndex(function (it) { return it.node.dataset.key === at; }) : -1;
  if (on >= 0) { ctxFocus(on); }
}

/* A section: a box with a heading that folds it, as on a page of Settings.
   Every one opens unfolded each time; folded, its heading says how many of
   its filters are on. */
function section(name, group) {
  var box = el("div", "set-sect"), head = el("div", "sect-head"), count = el("span", "sect-count");
  box.dataset.sect = name;
  head.setAttribute("role", "button");
  head.appendChild(iconEl("sect-caret", "caret"));
  head.appendChild(el("span", "sect-name", name));
  head.appendChild(count);
  pressable(head, function () {
    box.classList.toggle("shut");
    sound("move");
    L("ED", "filter by: " + name + (box.classList.contains("shut") ? " folded" : " unfolded"));
    paint();
  });
  box.appendChild(head);
  if (group === "ratings") { box.appendChild(starsRow()); }
  if (group === "hacks") { box.appendChild(hacksRow()); }
  else if (group === "tags") { tagsBox = box.appendChild(el("div", "flt-tags")); }
  else { FILTERS.filter(function (f) { return f.group === group; }).forEach(function (f) { box.appendChild(switchRow(f)); }); }
  paints.push(function () {
    var shut = box.classList.contains("shut"), on = onIn(group);
    head.setAttribute("aria-expanded", shut ? "false" : "true");
    count.textContent = shut && on ? on + " on" : "";
  });
  return box;
}

// Everything in the window says how the filters stand; the count follows once the list has been read again.
function paint() {
  if (!win) { return; }
  var mine = win, n = win.querySelector(".flt-now-n");
  paints.forEach(function (p) { p(); });
  paintTags();
  n.classList.add("owed");
  listSettled().then(function () {
    if (win !== mine) { return; }
    n.textContent = $count.textContent ? $count.textContent + " games" : "";
    n.classList.remove("owed");
    paintTags();                               // the tags and their counts come with the list
  });
}

export function openFilterWindow() {
  L("ED", "filter by");
  closeGameMenu();
  // The search box lets go of the keys: a letter typed here is not a search behind the window.
  if (document.activeElement && document.activeElement !== document.body) { document.activeElement.blur(); }
  paints = [];
  tagsSig = "";
  tagsFit = TAGS_SHOWN;
  var inner = toolFrame("FILTER BY", { base: "set-inner", cls: "flt-inner", close: "Close (esc)",
                                       before: [{ label: "Clear all filters", run: function () { clearFilters(); paint(); } }] });
  var clear = inner.querySelector(".set-head button");
  // What is on, in the funnel's own words, and how many games that leaves.
  var now = inner.appendChild(el("div", "flt-now")), words = el("span", "flt-now-w");
  now.appendChild(el("span", "flt-now-k", "On now"));
  now.appendChild(words);
  now.appendChild(el("span", "flt-now-n"));
  paints.push(function () {
    var w = filterWords();
    words.textContent = w || "nothing";
    words.title = w;
    words.classList.toggle("none", !w);
    clear.hidden = !anyFilter();
  });
  var body = inner.appendChild(el("div", "set-body flt-cols"));
  [LEFT, RIGHT].forEach(function (side) {
    var col = body.appendChild(el("div", "flt-col"));
    side.forEach(function (s) { col.appendChild(section(s[0], s[1])); });
  });
  $editor.appendChild(inner);
  $editor.hidden = false;
  win = inner;
  setEditorOnClose(function () { win = null; paints = []; tagsBox = null; closeGameMenu(); });
  paint();
}

/* The keys in the window: the arrows walk what can be pressed, by where it
   stands (the walk a controller has, js\padwin.js), and a filter's own key
   (F, 2) is its switch here as in the list. Enter and Space press what the
   keys are on (pressable, and a button's own). Says whether the key was the
   window's. */
export function filterKeys(e) {
  var has = document.activeElement, d = STEP[e.key];
  if (!win || !win.isConnected) { return false; }
  var inside = win.contains(has);
  var own = FILTERS.filter(function (f) { return f.hint && f.hint.length === 1 && f.hint.toLowerCase() === e.key.toLowerCase(); })[0];
  if (own) { toggleFilter(own.key); paint(); return true; }
  if (!d) { return false; }
  var to = winToward($editor, inside ? has : null, d[0], d[1]);
  if (to) { to.focus(); sound("move"); }
  return true;
}
