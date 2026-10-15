/*  Details' tabs. The right column, under Back and Play, is a row of tabs
    and one pane; a new tab is one more line in dtabs().

    A tab's build(pane, g, full) fills the pane. One with a list in it hands
    the list to setTabRows() in the pickers' own shape ({ cells, at, move,
    choose, find }, with word when a press there does not select), and the
    keys and the pad then walk it: Down goes in, Up past the top or Esc
    comes back out to the tabs. Left and right change tab, as LB and RB do. */

import { accPane, accTabLabel } from "./acctab.js";
import { cheatsPane, cheatsTabLabel } from "./cheattab.js";
import { aboutPane } from "./details.js";
import { fileCheckPane, fileCheckTabLabel } from "./filecheck.js";
import { hacksPane, hacksTabLabel } from "./hackstab.js";
import { paintHelp } from "./help.js";
import { iconEl } from "./icons.js";
import { L } from "./log.js";
import { mediaPane, mediaTabLabel } from "./mediatab.js";
import { notesPane, notesTabLabel } from "./notestab.js";
import { savesPane, savesTabLabel } from "./savestab.js";
import { sound } from "./sound.js";
import { el } from "./util.js";
import { versionsPane, versionsTabLabel } from "./versionstab.js";

function dtabs(g) {
  var t = [
    { key: "about",  label: function () { return "About"; }, build: aboutPane },
    { key: "media",  label: mediaTabLabel, build: mediaPane },
    { key: "saves",  label: savesTabLabel, build: savesPane },
    { key: "filecheck", label: fileCheckTabLabel, build: fileCheckPane },
    { key: "cheats", label: cheatsTabLabel, build: cheatsPane },
    { key: "hacks", label: hacksTabLabel, build: hacksPane }
  ];
  // Only a card holding several versions gets the tab: one file is nothing
  // to choose between. row says it builds from the row, with no full record.
  if (g && g.versions && g.versions.length > 1) { t.push({ key: "versions", label: versionsTabLabel, build: versionsPane, row: true }); }
  // A program of yours or a Steam game is no file of a console: nothing goes with it.
  if (g && !g.local && !g.steam) { t.push({ key: "accompanied", label: accTabLabel, build: accPane }); }
  t.push({ key: "notes", label: notesTabLabel, build: notesPane });
  return t;
}

var dtabGame = null;      // whose details the tab is remembered for
var dtabKey = "about";
var dtabUp = null;        // { g, full, bar, pane } while details is built
var dtabRows = null;      // the open tab's list, when it has one
var dtabIn = false;       // the keys are inside that list
var dtabLeave = null;     // what the open tab does when it is left (a note not kept yet)

/* The row of tabs and the pane, added to the right column. The tab stays
   where it was while the same game is redrawn (the full record arriving, a
   save), and a new game opens on About. */
export function detailTabs(right, g, full) {
  if (dtabGame !== g.id) { dtabGame = g.id; dtabKey = "about"; }
  var all = dtabs(g);
  if (!all.some(function (t) { return t.key === dtabKey; })) { dtabKey = "about"; }
  var bar = el("div", "dtabs");
  bar.setAttribute("role", "tablist");
  all.forEach(function (t) {
    var b = el("button", "dtab", t.label(g, full));
    b.type = "button";
    b.dataset.tab = t.key;
    b.setAttribute("role", "tab");
    b.addEventListener("click", function () { if (t.key !== dtabKey) { sound("select"); showTab(t.key); } });
    bar.appendChild(b);
  });
  var pane = el("div", "dtab-pane");
  pane.setAttribute("role", "tabpanel");
  // A press inside the pane gives its list the keys, as a press on a picker does.
  pane.addEventListener("mousedown", function () { if (dtabRows && !dtabIn) { intoRows(false); } });
  right.appendChild(bar);
  right.appendChild(pane);
  dtabUp = { g: g, full: full, bar: bar, pane: pane };
  fillTab();
}

/* A tab with something still to keep says so here; it is called once, when
   the tab, the game or details is left. */
export function onTabLeave(pane, fn) {
  if (dtabUp && pane === dtabUp.pane) { dtabLeave = fn; }
}

function leaveTab() {
  var fn = dtabLeave;
  dtabLeave = null;
  if (fn) { fn(); }
}

function fillTab() {
  var up = dtabUp;
  leaveTab();
  dtabRows = null;
  dtabIn = false;
  up.bar.querySelectorAll(".dtab").forEach(function (b) {
    b.classList.toggle("on", b.dataset.tab === dtabKey);
    b.setAttribute("aria-selected", b.dataset.tab === dtabKey ? "true" : "false");
  });
  up.pane.className = "dtab-pane is-" + dtabKey;
  up.pane.textContent = "";
  var tab = dtabs(up.g).filter(function (t) { return t.key === dtabKey; })[0];
  // Details is drawn twice, from the row and then from the full record: a
  // tab that asks the server for its own words waits for the second.
  if (!up.full && dtabKey !== "about" && !tab.row) { up.pane.appendChild(el("p", "dtab-wait", "…")); return; }
  tab.build(up.pane, up.g, up.full);
}

function showTab(key) {
  if (!dtabUp || key === dtabKey) { return; }
  dtabKey = key;
  L("NAV", "details tab " + key);
  fillTab();
  paintHelp("details");
}

/* A key that stands for one tab (F, the file check): it opens that tab, and
   pressed there again goes back to About. */
export function toggleTab(key) {
  if (!dtabUp || !dtabUp.pane.isConnected) { return false; }
  sound("select");
  showTab(dtabKey === key ? "about" : key);
  return true;
}

/* A press elsewhere in details that means one tab (the cheats fact on the left). */
export function openTab(key) {
  if (!dtabUp || !dtabUp.pane.isConnected || dtabKey === key) { return; }
  sound("select");
  showTab(key);
}

function nextTab(d) {
  var keys = dtabs(dtabUp.g).map(function (t) { return t.key; });
  var to = keys[keys.indexOf(dtabKey) + d];
  if (!to) { return; }
  sound("select");
  showTab(to);
}

/* A count changed under a tab that is up (a cheat selected in it): the
   labels are written again from the full record with that change in it. */
export function relabelTabs(change, forId) {
  if (!dtabUp || !dtabUp.bar.isConnected || (forId && dtabUp.g.id !== forId)) { return; }
  if (dtabUp.full) { Object.assign(dtabUp.full, change); }
  dtabs(dtabUp.g).forEach(function (t) {
    var b = dtabUp.bar.querySelector('.dtab[data-tab="' + t.key + '"]');
    if (b) { b.textContent = t.label(dtabUp.g, dtabUp.full); }
  });
}

/* The pane of the tab that is open, when it is `key`: for what arrives late
   and belongs to one tab (the saves, in About). */
export function tabPane(key) {
  return dtabUp && dtabUp.pane.isConnected && dtabKey === key ? dtabUp.pane : null;
}

/* A tab's list, handed over each time it is painted; null when it has none.
   A list that is not on the screen any more is not listened to. */
export function setTabRows(pane, v) {
  if (!dtabUp || pane !== dtabUp.pane || !pane.isConnected) { return; }
  var had = !!dtabRows, word = dtabRows ? dtabRows.word : null;
  dtabRows = v;
  if (!v) { outOfRows(); }
  if (had !== !!v) { paintHelp("details"); }
  else if (dtabIn && v && v.word !== word) { paintHelp("tabrows"); }   // the press does something else on this row
}

export function tabHasRows() { return !!dtabRows; }
export function tabRowsLook() { return !!(dtabRows && dtabRows.look); }    // a list with nothing to select in it
export function tabRowsWord() { return (dtabRows && dtabRows.word) || ""; }  // what a press does there, when it is not selecting
export function tabRowsFind() { return !!(dtabRows && dtabRows.find); }      // a list with a find box to type into

function intoRows(fromKeys) {
  if (!dtabRows) { return; }
  dtabIn = true;
  dtabUp.pane.classList.add("in");
  if (fromKeys) { dtabRows.move(-9999); sound("move"); }
  paintHelp("tabrows");
}

function outOfRows() {
  if (!dtabIn) { return; }
  dtabIn = false;
  if (dtabUp) { dtabUp.pane.classList.remove("in"); }
  if (document.activeElement && dtabUp && dtabUp.pane.contains(document.activeElement)) { document.activeElement.blur(); }
  paintHelp("details");
}

/* Details put away: the next one opens on About, at the tabs. */
export function detailTabsOff() {
  leaveTab();
  dtabGame = null;
  dtabKey = "about";
  dtabUp = null;
  dtabRows = null;
  dtabIn = false;
}

/* A key over details. True: it was the tabs' or the list's. "typing": it is
   the find box's own, leave it be. False: details' own keys have it. */
export function detailTabKey(e) {
  if (!dtabUp || !dtabUp.pane.isConnected) { return false; }
  var k = e.key, rows = dtabRows;
  // A box to write in (the Notes tab) keeps every key but Esc, which leaves it for the tabs.
  if (e.target && e.target.tagName === "TEXTAREA" && dtabUp.pane.contains(e.target)) {
    if (k !== "Escape") { return "typing"; }
    e.target.blur();
    outOfRows();
    sound("back");
    return true;
  }
  var typing = !!(rows && rows.find && e.target === rows.find);
  if (typing && !dtabIn) { intoRows(false); }
  if (dtabIn && rows) {
    if (typing && !/^(ArrowUp|ArrowDown|Enter|Escape)$/.test(k)) { return "typing"; }
    if (typing && (k === "Enter" || k === "ArrowDown")) { rows.find.blur(); return true; }
    if (k === "ArrowDown") { rows.move(1); }
    else if (k === "ArrowUp") { if (rows.at <= 0 || typing) { outOfRows(); sound("back"); } else { rows.move(-1); } }
    else if (k === "Home") { rows.move(-9999); }
    else if (k === "End") { rows.move(9999); }
    else if (k === "Enter" || k === " ") { if (!e.repeat) { rows.choose(); } }
    else if (k === "Escape" || k === "Backspace") { outOfRows(); sound("back"); }
    else if (k === "ArrowLeft" || k === "ArrowRight") { nextTab(k === "ArrowRight" ? 1 : -1); }
    else if (rows.find && k.length === 1 && !e.ctrlKey && !e.altKey) { rows.find.focus(); return "typing"; }
    return true;
  }
  if (k === "ArrowRight" || k === "ArrowLeft") { nextTab(k === "ArrowRight" ? 1 : -1); return true; }
  if (k === "ArrowDown" && rows) { intoRows(true); return true; }
  return false;
}

/* The pad over details: "up", "down", "left", "right", "lb", "rb", "a" or
   "b". True when the tabs or the list took it; A and B are details' own
   (play, back) while the pad is at the tabs. */
export function detailTabPad(what) {
  if (!dtabUp || !dtabUp.pane.isConnected) { return false; }
  var rows = dtabRows;
  if (what === "lb" || what === "rb") { nextTab(what === "rb" ? 1 : -1); return true; }
  if (dtabIn && rows) {
    if (what === "down") { rows.move(1); }
    else if (what === "up") { if (rows.at <= 0) { outOfRows(); sound("back"); } else { rows.move(-1); } }
    else if (what === "a") { rows.choose(); }
    else if (what === "b") { outOfRows(); sound("back"); }
    return true;
  }
  if (what === "left" || what === "right") { nextTab(what === "right" ? 1 : -1); return true; }
  if (what === "down" && rows) { intoRows(true); return true; }
  return false;
}

/* A tab with one thing to say (nothing here, or why not): the sentence, with its mark. */
export function tabSays(why) {
  var note = el("p", "cr-none");
  note.appendChild(iconEl("cr-ico", "info"));
  note.appendChild(document.createTextNode(" " + why + (/[.!?]$/.test(why) ? "" : ".")));
  return note;
}
