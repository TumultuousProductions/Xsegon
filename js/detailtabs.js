/*  Details' tabs. The right column, under Back and Play, is a row of tabs
    and one pane; a new tab is one more line in dtabs().

    A tab's build(pane, g, full) fills the pane. One with a list in it hands
    the list to setTabRows() in the pickers' own shape ({ cells, at, move,
    choose, find }, with word when a press there does not select), and the
    keys and the pad then walk it: Down goes in, Up past the top or Esc
    comes back out to the tabs. Left and right change tab, as LB and RB do.

    A card's versions are one game (includes\versions.php). A tab about the
    file (file: what it shows) is built from the version selected in the
    Versions tab and that version's own full record; with none selected it
    asks for one. Every other tab is the whole game's. */

import { accPane, accTabLabel } from "./acctab.js";
import { achPane, achTabLabel } from "./achtab.js";
import { cheatsPane, cheatsTabLabel } from "./cheattab.js";
import { aboutPane } from "./details.js";
import { fileCheckPane, fileCheckTabLabel } from "./filecheck.js";
import { hacksPane, hacksTabLabel } from "./hackstab.js";
import { paintHelp } from "./help.js";
import { iconEl } from "./icons.js";
import { L, api } from "./log.js";
import { mediaPane, mediaTabLabel } from "./mediatab.js";
import { notesPane, notesTabLabel } from "./notestab.js";
import { savesPane, savesTabLabel } from "./savestab.js";
import { sound } from "./sound.js";
import { texPacksFor, texPacksPane, texPacksTabLabel } from "./texpacktab.js";
import { el, versionInUse, versionLabel } from "./util.js";
import { versionsPane, versionsTabLabel } from "./versionstab.js";

/* Tabs with a group share one button in the row, which opens the part last
   used there; the open group's parts stand in a smaller row under it. The
   keys and the pad still walk every part, in this order; F and N open theirs. */
var DGROUPS = { more: "More" };

function dtabs(g) {
  var t = [
    { key: "about",  label: function () { return "About"; }, build: aboutPane },
    { key: "media",  label: mediaTabLabel, build: mediaPane },
    { key: "saves",  label: savesTabLabel, build: savesPane, file: "its saves and save slots" },
    { key: "cheats", label: cheatsTabLabel, build: cheatsPane },
    { key: "hacks", label: hacksTabLabel, build: hacksPane }
  ];
  // A game RetroArch starts, on a console RetroAchievements has sets for (api\library.php ach).
  if (g && g.ach) { t.push({ key: "achievements", label: achTabLabel, build: achPane, file: "its achievements" }); }
  // Only a game of a console whose emulator here loads texture packs.
  if (texPacksFor(g)) { t.push({ key: "texpacks", label: texPacksTabLabel, build: texPacksPane, file: "its texture packs" }); }
  // Only a card holding several versions gets the tab: one file is nothing
  // to choose between. row says it builds from the row, with no full record.
  if (g && g.versions && g.versions.length > 1) { t.push({ key: "versions", label: versionsTabLabel, build: versionsPane, row: true }); }
  // A program of yours or a Steam game is no file of a console: nothing goes with it.
  if (g && !g.local && !g.steam) { t.push({ key: "accompanied", label: accTabLabel, build: accPane, file: "the files that go with it" }); }
  t.push({ key: "filecheck", label: fileCheckTabLabel, build: fileCheckPane, group: "more", file: "its file check" },
         { key: "notes", label: notesTabLabel, build: notesPane, group: "more" });
  return t;
}

/* A group's button: its name, wearing a part's mark (a note written: "Notes •"). */
function groupLabel(group, up) {
  var marked = dtabs(up.g).some(function (t) { return t.group === group && / •$/.test(labelOf(t, up)); });
  return DGROUPS[group] + (marked ? " •" : "");
}

var dtabGame = null;      // whose details the tab is remembered for
var dtabKey = "about";
var dgroupAt = {};        // the part each group last showed, for that game
var dtabUp = null;        // { g, full, bar, pane } while details is built
var dtabRows = null;      // the open tab's list, when it has one
var dtabIn = false;       // the keys are inside that list
var dtabLeave = null;     // what the open tab does when it is left (a note not kept yet)
var dfile = { id: null, full: null };   // the selected version's own full record, once it is in

/* What a file tab is built from: the game and its record, the selected version
   and its own record (null until it is in), or null with none selected. */
function fileTarget(up) {
  var v = versionInUse(up.g);
  if (!v) { return null; }
  if (v === up.g) { return { g: up.g, full: up.full }; }
  return { g: v, full: dfile.id === v.id ? dfile.full : null };
}

// A tab's name: a file tab's from its version's record, its count left off while none is selected.
function labelOf(t, up) {
  if (!t.file) { return t.label(up.g, up.full); }
  var f = fileTarget(up);
  return t.label(f ? f.g : up.g, f ? f.full : null);
}

/* The selected version's own record (api\game.php): its saves, texture packs
   and file check are counted for its file. Asked once per selection. */
function askFile(up) {
  var v = versionInUse(up.g);
  if (!v || v === up.g || dfile.id === v.id) { return; }
  dfile = { id: v.id, full: null };
  var t0 = Date.now();
  api("api/game.php?id=" + encodeURIComponent(v.id)).then(function (res) {
    // Details is drawn again when the game's own record arrives: the same game is enough.
    if (dfile.id !== v.id || !dtabUp || dtabUp.g.id !== up.g.id) { return; }
    if (!res.ok) {
      // Said in the tab, not left on "…": the version's tabs cannot be drawn without it.
      dfile.failed = "the record of " + versionLabel(v) + " could not be read: " + (res.error || "the server did not answer");
      L("VERS", up.g.title + ": " + dfile.failed);
      var shut = dtabs(up.g).filter(function (t) { return t.key === dtabKey; })[0];
      if (shut && shut.file) { fillTab(); }
      return;
    }
    dfile.full = res.game;
    L("VERS", up.g.title + ": the per-file tabs follow " + versionLabel(v) + " (" + v.id + "), its record in " + (Date.now() - t0) + " ms");
    relabelTabs({});
    var open = dtabs(up.g).filter(function (t) { return t.key === dtabKey; })[0];
    if (open && open.file) { fillTab(); }
  });
}

/* A file tab with no version selected: what to do, and the way there as a row a pad can press. */
function askForVersion(pane, up, noun) {
  var inner = el("div", "ch-inner ch-tab");
  inner.appendChild(tabSays("Select a version in Versions to see " + noun));
  var list = el("div", "ch-list");
  var go = el("div", "cr-row ch-act sel");
  go.appendChild(iconEl("cr-ico", "disc"));
  go.appendChild(el("span", "cr-name", "Open Versions"));
  function open() { sound("select"); showTab("versions"); }
  go.addEventListener("click", open);
  list.appendChild(go);
  inner.appendChild(list);
  pane.appendChild(inner);
  var rows = { cells: [go], at: 0, move: function () { /* one row */ }, choose: open };
  setTabRows(pane, rows);
  // Details is built before it is on the screen: the row is handed over again a moment later, as Versions does.
  Promise.resolve().then(function () { if (dtabUp === up && up.pane === pane) { setTabRows(pane, rows); } });
}

/* The Versions tab selected or deselected one: the file tabs follow the new one. */
export function versionChanged() {
  if (!dtabUp || !dtabUp.bar.isConnected) { return; }
  dfile = { id: null, full: null };
  askFile(dtabUp);
  relabelTabs({});
}

/* The row of tabs and the pane, added to the right column. The tab stays
   where it was while the same game is redrawn (the full record arriving, a
   save), and a new game opens on About. */
export function detailTabs(right, g, full) {
  if (dtabGame !== g.id) { dtabGame = g.id; dtabKey = "about"; dgroupAt = {}; dfile = { id: null, full: null }; }
  var up = { g: g, full: full };
  var all = dtabs(g);
  if (!all.some(function (t) { return t.key === dtabKey; })) { dtabKey = "about"; }
  var bar = el("div", "dtabs");
  bar.setAttribute("role", "tablist");
  var shown = {};
  all.forEach(function (t) {
    if (t.group && shown[t.group]) { return; }
    if (t.group) { shown[t.group] = true; }
    var b = el("button", "dtab", t.group ? groupLabel(t.group, up) : labelOf(t, up));
    b.type = "button";
    b.dataset.tab = t.group || t.key;
    b.setAttribute("role", "tab");
    b.addEventListener("click", function () {
      var to = t.group ? partOf(t.group) : t.key;
      if (to !== dtabKey) { sound("select"); showTab(to); }
    });
    bar.appendChild(b);
  });
  var parts = el("div", "dparts");
  parts.setAttribute("role", "tablist");
  var pane = el("div", "dtab-pane");
  pane.setAttribute("role", "tabpanel");
  // A press inside the pane gives its list the keys, as a press on a picker does.
  pane.addEventListener("mousedown", function () { if (dtabRows && !dtabIn) { intoRows(false); } });
  right.appendChild(bar);
  right.appendChild(parts);
  right.appendChild(pane);
  up.bar = bar;
  up.parts = parts;
  up.pane = pane;
  dtabUp = up;
  askFile(up);
  fillTab();
}

// The part a group's button opens: the one last shown there, else its first.
function partOf(group) {
  var keys = dtabs(dtabUp.g).filter(function (t) { return t.group === group; }).map(function (t) { return t.key; });
  return keys.indexOf(dgroupAt[group]) >= 0 ? dgroupAt[group] : keys[0];
}

// One button of a row, lit when it is the open one.
function tabButton(b, on) {
  b.classList.toggle("on", on);
  b.setAttribute("aria-selected", on ? "true" : "false");
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
  var all = dtabs(up.g);
  var tab = all.filter(function (t) { return t.key === dtabKey; })[0];
  if (tab.group) { dgroupAt[tab.group] = dtabKey; }
  up.bar.querySelectorAll(".dtab").forEach(function (b) { tabButton(b, b.dataset.tab === (tab.group || dtabKey)); });
  // The open group's parts, when it has more than one here.
  var mine = tab.group ? all.filter(function (t) { return t.group === tab.group; }) : [];
  up.parts.textContent = "";
  up.parts.hidden = mine.length < 2;
  if (mine.length > 1) {
    mine.forEach(function (t) {
      var b = el("button", "dtab dpart", labelOf(t, up));
      b.type = "button";
      b.dataset.tab = t.key;
      b.setAttribute("role", "tab");
      tabButton(b, t.key === dtabKey);
      b.addEventListener("click", function () { if (t.key !== dtabKey) { sound("select"); showTab(t.key); } });
      up.parts.appendChild(b);
    });
  }
  up.pane.className = "dtab-pane is-" + dtabKey;
  up.pane.textContent = "";
  // A tab about the file: the selected version's, or the ask for one.
  if (tab.file) {
    var f = fileTarget(up);
    if (!f) {
      L("VERS", up.g.title + ": " + dtabKey + " tab, no version selected, asked for one");
      askForVersion(up.pane, up, tab.file);
      return;
    }
    if (!f.full) { up.pane.appendChild(f.g !== up.g && dfile.failed ? tabSays(dfile.failed) : el("p", "dtab-wait", "…")); return; }
    if (f.g !== up.g) { L("VERS", up.g.title + ": " + dtabKey + " tab of " + versionLabel(f.g) + " (" + f.g.id + ")"); }
    tab.build(up.pane, f.g, f.full);
    return;
  }
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
  if (!dtabUp || !dtabUp.bar.isConnected || (forId && dtabUp.g.id !== forId && dfile.id !== forId)) { return; }
  // A change from a file tab of the selected version is that version's record's.
  var rec = forId && forId === dfile.id && forId !== dtabUp.g.id ? dfile.full : dtabUp.full;
  if (rec) { Object.assign(rec, change); }
  dtabs(dtabUp.g).forEach(function (t) {
    var b = (t.group ? dtabUp.parts : dtabUp.bar).querySelector('.dtab[data-tab="' + t.key + '"]');
    if (b) { b.textContent = labelOf(t, dtabUp); }
  });
  Object.keys(DGROUPS).forEach(function (group) {
    var b = dtabUp.bar.querySelector('.dtab[data-tab="' + group + '"]');
    if (b) { b.textContent = groupLabel(group, dtabUp); }
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
