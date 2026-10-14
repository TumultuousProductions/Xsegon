/*  Every press, from either hand: one keydown handler for the whole page,
    and the pad polled sixteen times a second with the repeat delay and rate
    from Settings > Xsegon Controls. Both end up calling the same functions the
    mouse does.                                                             */

import { closeDetails, openDetails } from "./details.js";
import { detailTabKey, detailTabPad, toggleTab } from "./detailtabs.js";
import { openDocs } from "./docs.js";
import { closeEditor, openEditor, openLocalEditor } from "./editors.js";
import { filterKeys } from "./filterwin.js";
import { setPadMode } from "./help.js";
import { launch, pick } from "./launch.js";
import { pageBy } from "./letters.js";
import { listOwed, listSettled, randomGame, toggleFavourites, togglePlayers } from "./library.js";
import { scrollListX } from "./list.js";
import { L } from "./log.js";
import { $ctx, MB_ORDER, closeGameMenu, ctxAt, ctxFocus, ctxItems, ctxRun, ctxSide, mbOpen, openBarMenu, openGameMenuAtSelection } from "./menus.js";
import { closeMail, mailOpen } from "./news.js";
import { padChange, padHeard } from "./padfound.js";
import { padGhostPoll } from "./padghost.js";
import { padJobs } from "./padjobs.js";
import { padsNow } from "./padlist.js";
import { padTopPoll, padTopRan, padTopSide } from "./padtop.js";
import { padWinPoll } from "./padwin.js";
import { setAdjust, setBack, setEnter, setIntoPage, setMove } from "./settings-nav.js";
import { closeSettings, setUI, toggleContrast } from "./settings-ui.js";
import { peekVolume, setVolume, sound, toggleMute, volume } from "./sound.js";
import { $body, $details, $editor, $platform, $q, $settings, $toolbar, S, games, sel, setSel, sysStage, view } from "./state.js";
import { saverUp, touch } from "./status.js";
import { subBack, subSide } from "./submenu.js";
import { backToWall, chooseSystem, moveSys, openSysMenu, setSysSel, sysList, sysSel, sysStyle, updateSystems } from "./systems.js";
import { openLogViewer } from "./tools.js";
import { ctl, move, navRows, render, rowStep, setView, viewPending } from "./views.js";

// ---------- input ----------

/* A mouse pointer parked in the middle of a television is a smudge. It goes
   away when it stops and is back the instant it moves, which is what every
   media player on a TV does. Settings > Xsegon Controls > Xsegon (Mouse and keyboard). */
var pointerT = null;
function wakePointer() {
  $body.classList.remove("no-cursor");
  clearTimeout(pointerT);
  pointerT = setTimeout(function () { $body.classList.add("no-cursor"); },
                        Math.max(1, Number(ctl("hidePointerSec", 3)) || 3) * 1000);
}
/* Where a key landed in Settings, for the log: the lit category or setting
   (the game list's place says nothing there). */
function setSpot() {
  if (!setUI) { return ""; }
  var at = setUI.where === "nav" ? setUI.tabs[setUI.navAt] : setUI.row;
  var name = at && at.querySelector(".tab-label, .sect-name, label");
  if (!name) { return ""; }
  var words = name.tagName === "LABEL" && name.firstChild ? name.firstChild.textContent : name.textContent;
  return " " + words.replace(/\s+/g, " ").trim().slice(0, 40);
}

/* Put up by main.js before the idle listeners it adds itself: two handlers
   on the same target run in the order they went on, and the keys go first. */
export function initInput() {
  if (ctl("hidePointer", true)) {
    ["mousemove", "mousedown", "wheel"].forEach(function (ev) {
      document.addEventListener(ev, wakePointer, { passive: true });
    });
    wakePointer();
  }
  document.addEventListener("keydown", onKey);
  // A hand back on the mouse means the legend goes back to key names.
  document.addEventListener("mousedown", function () { setPadMode(false); }, { passive: true });
}

/* The platform picker's list is part of the page where the browser dresses
   it (css\xsegon.css, .pfpick option): while it is up its keys are its own,
   as a dropdown's are. Enter there chooses a console, never plays. */
function platformListOpen() {
  try { return $platform.matches(":open"); } catch (err) { return false; }
}

/* What a press may reach. An asking window is over everything and its
   buttons keep the keys and the pad; a list that says loading has nothing on
   screen to walk or play; and a press to play made while the list is being
   read waits for it, and holds only if the same game is still under the bar
   (from the search box: the first of the results). */
function asking() { return document.querySelector(".confirm-wrap"); }
function listLoading() { return sysStage !== "wall" && viewPending(); }
function onList() {
  return sysStage !== "wall" && $details.hidden && $editor.hidden && $settings.hidden && !$ctx && !pick && !mailOpen() && !asking();
}
var playWaits = false;
function play(fromBox) {
  if (playWaits) { return; }
  if (!listOwed()) { launch(); return; }
  var was = games[sel] ? games[sel].id : null;
  playWaits = true;
  L("NAV", "play pressed while the list is being read: waiting for it" + (fromBox ? ", for the first result" : ""));
  listSettled().then(function (came) {
    playWaits = false;
    var same = !!games[sel] && games[sel].id === was;
    if (came && (fromBox || same) && onList()) { launch(); return; }
    L("NAV", "nothing started: " + (!came ? "the list did not arrive" : !onList() ? "another screen is up" : "another game is under the bar now"));
  });
}
// The pad in an asking window: sideways walks its buttons, A presses the one in focus, B is its no.
function askPad(wrap, step, a, b) {
  var btns = [].slice.call(wrap.querySelectorAll(".confirm-bar button:not(:disabled)"));
  var at = btns.indexOf(document.activeElement);
  if (step && btns.length) { btns[Math.max(0, Math.min(btns.length - 1, at < 0 ? 0 : at + step))].focus(); sound("move"); }
  if (a && at >= 0) { L("PAD", "a in an asking window: " + btns[at].textContent); btns[at].click(); }
  if (b) { L("PAD", "b in an asking window"); wrap.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); }
}

function onKey(e) {
  setPadMode(false);                       // the keyboard is in use: key names on the legend
  // The press that puts the screensaver away does nothing else.
  if (saverUp()) { L("KEY", e.key + " woke the screen"); e.preventDefault(); return; }
  // An asking window: Enter presses its button in focus (the browser's doing), Esc is its no, nothing behind hears a key.
  if (asking()) {
    if (e.key === "Enter" || e.key === "Escape") { L("KEY", e.key + " in an asking window"); }
    return;
  }
  if (platformListOpen()) {
    if (e.key === "Enter" || e.key === "Escape") { L("KEY", e.key + " in the platform list"); }
    return;
  }
  // Every key that could mean something, with where it landed. Plain typing
  // in a text box is left out: a search string is not an action.
  var inField = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (!inField || e.key === "Escape" || e.key === "Enter") {
    L("KEY", e.key + (e.ctrlKey ? "+ctrl" : "") + (e.altKey ? "+alt" : "") + (e.metaKey ? "+win" : "") + (e.shiftKey ? "+shift" : "") + " " + ($ctx ? "menu" : !$editor.hidden ? "editor" : !$settings.hidden ? "settings" : !$details.hidden ? "details" : sysStage === "wall" ? "wall" : view) +
      ($ctx === null && $editor.hidden && !$settings.hidden ? setSpot() : games[sel] && sysStage !== "wall" && $ctx === null ? " " + sel + "/" + games.length : ""));
  }
  /* A letter, digit or sign with Ctrl, Alt or the Windows key held belongs
     to the browser or to Windows, never to Xsegon, whose own shortcuts are
     all bare keys: Ctrl+R would reload and also run R (Surprise me). The
     line above still records the press, with what was held. */
  if ((e.ctrlKey || e.altKey || e.metaKey) && e.key.length === 1) { return; }
  // Enter or Space held down is one press, not one for every screen that opens under it.
  if (e.repeat && !inField && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); return; }
  // The mailbox is a panel over everything: Esc closes it and nothing else
  // sees that press, the same bargain every other overlay here makes.
  if (mailOpen()) {
    if (e.key === "Escape" || e.key === "Backspace") {
      closeMail();
      e.preventDefault();
    }
    return;
  }

  // The game menu is modal while it is up: it gets the keys, nothing else.
  if ($ctx) {
    if (e.key === "ArrowDown")      { ctxFocus(ctxAt + 1); }
    else if (e.key === "ArrowUp")   { ctxFocus(ctxAt - 1); }
    else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && subSide(e.key === "ArrowRight" ? 1 : -1)) { /* a group's box */ }
    else if (mbOpen && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      var at = MB_ORDER.indexOf(mbOpen) + (e.key === "ArrowRight" ? 1 : -1);
      openBarMenu(MB_ORDER[(at + MB_ORDER.length) % MB_ORDER.length]);
    }
    // A menu of sections: sideways is the section beside.
    else if (e.key === "ArrowRight" || e.key === "ArrowLeft") { ctxSide(e.key === "ArrowRight" ? 1 : -1); }
    else if (e.key === "Enter" || e.key === " ") { if (ctxItems[ctxAt]) { ctxRun(ctxItems[ctxAt]); } }
    else if (e.key === "Escape" || e.key === "Backspace" || e.key === "ContextMenu") { if (!subBack()) { closeGameMenu(); } sound("back"); }
    e.preventDefault();
    return;
  }

  // The state picker is a row of tiles: left and right, Enter, Esc.
  // The cheats picker is the same object with a find box on it, so while that
  // box has the words the letters are its and the arrows are still the list's,
  // exactly as the settings find box behaves.
  if (pick) {
    var inFind = pick.find && e.target === pick.find;
    if (inFind && !/^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|Enter|Escape)$/.test(e.key)) {
      return;                                   // typing, including Backspace
    }
    if (inFind && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      return;                                   // the caret's, while typing
    }
    if (inFind && (e.key === "Enter" || e.key === "ArrowDown")) { pick.find.blur(); }
    if (e.key === "ArrowRight" || e.key === "ArrowDown")     { pick.move(1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")   { pick.move(-1); }
    else if (e.key === "Home")                               { pick.move(-999); }
    else if (e.key === "End")                                { pick.move(999); }
    else if (e.key === "Enter" || e.key === " ")             { if (!(e.repeat && pick.once)) { pick.choose(); } }
    else if (e.key === "Escape" || e.key === "Backspace")    { closeEditor(); }
    // Any other letter starts a search, where there is one to start.
    else if (pick.find && e.key.length === 1 && !e.ctrlKey && !e.altKey) {
      pick.find.focus();
      return;                                   // let the letter land in the box
    }
    e.preventDefault();
    return;
  }

  // The editor is a form: it keeps its own keys, and only Esc is ours.
  if (!$editor.hidden) {
    if (e.key === "Escape") { closeEditor(); e.preventDefault(); }
    else if (filterKeys(e)) { e.preventDefault(); }       // the Filter by window walks by the arrows
    return;
  }

  // Volume works on every screen, overlays included, like a TV remote's,
  // and shows its bars for a moment the way a TV shows its level.
  var tag = e.target && e.target.tagName;
  if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") {
    // Steps of 1: on the curve the low end is where the room is.
    if (e.key === "-" || e.key === "_")      { setVolume(volume - 1, true); peekVolume(); return; }
    else if (e.key === "+" || e.key === "=") { setVolume(volume + 1, true); peekVolume(); return; }
    else if (e.key === "m" || e.key === "M") { toggleMute(); peekVolume(); return; }   // M too: Caps Lock is often on for a TV
  }

  /* Settings is a console menu: the bar moves with the arrows, the
     value under it changes with left and right, Enter opens, Esc backs out
     one level and then closes. A text box that has the keyboard keeps it,
     because typing a path is typing, not navigating. */
  if (!$settings.hidden) {
    var box = document.activeElement;
    var typing = box && /^(INPUT|TEXTAREA)$/.test(box.tagName) &&
                 !/^(checkbox|range|button)$/.test(box.type);
    if (typing && box !== (setUI && setUI.find)) {
      if (e.key === "Escape" || e.key === "Enter") { box.blur(); e.preventDefault(); }
      return;                                   // every other key is theirs
    }
    // The find box: typing goes in, the arrows still drive the menu.
    if (typing) {
      if (e.key === "Escape") { if (!setBack()) { box.blur(); } e.preventDefault(); return; }
      // Left and right stay the caret's while you are typing a query.
      if (!/^(ArrowUp|ArrowDown|Enter)$/.test(e.key)) { return; }
      if (e.key === "Enter" || e.key === "ArrowDown") { box.blur(); }
    }
    if (e.key === "ArrowDown")       { setMove(1); }
    else if (e.key === "ArrowUp")    { setMove(-1); }
    else if (e.key === "ArrowRight") { if (setUI && setUI.where === "nav") { setIntoPage(); sound("select"); } else { setAdjust(1); } }
    else if (e.key === "ArrowLeft")  { if (setUI && setUI.where === "page") { setAdjust(-1); } }
    else if (e.key === "Enter" || e.key === " ") { setEnter(); }
    else if (e.key === "Tab")        { setMove(e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape" || e.key === "Backspace") { if (!setBack()) { closeSettings(); } }
    // Any other letter starts a search, the way a console menu's own find does.
    else if (setUI && e.key.length === 1 && !e.ctrlKey && !e.altKey && e.key !== "-" && e.key !== "+") {
      setUI.find.focus();
      return;                                   // let the letter land in the box
    }
    e.preventDefault();
    return;
  }
  if (!$details.hidden) {
    // Its tabs, and a tab's list, come first (js\detailtabs.js); a find box keeps its letters.
    var tabTook = detailTabKey(e);
    if (tabTook === "typing") { return; }
    if (tabTook) { e.preventDefault(); return; }
    if (e.key === "Escape" || e.key === "Backspace") { closeDetails(); e.preventDefault(); }
    else if (e.key === "Enter") { closeDetails(); launch(); }
    else if (e.key === "d" && games[sel] && games[sel].docs) { openDocs(games[sel]); }
    else if (e.key === "f" || e.key === "F") { toggleTab("filecheck"); }
    else if (e.key === "n" || e.key === "N") { toggleTab("notes"); }
    return;
  }
  // The search box keeps its letters and its caret, the same in every view. Down leaves it for the games and
  // Enter plays the chosen one, as the other find boxes do; Esc empties it and leaves it, not the console.
  if (e.target === $q) {
    if (e.key === "Escape") {
      L("NAV", "search box: Esc" + ($q.value ? ", emptied" : ""));
      if ($q.value) { $q.value = ""; $q.dispatchEvent(new Event("input", { bubbles: true })); }
      $q.blur();
      e.preventDefault();
      return;
    }
    if (e.key !== "Enter" && e.key !== "ArrowDown") { return; }
    L("NAV", "search box: " + (e.key === "Enter" ? "Enter" : "Down") + ", the keys go to the games");
    $q.blur();
    // Enter plays the first of what was typed for, not the game chosen before the results are in.
    if (e.key === "Enter" && sysStage !== "wall") { play(true); e.preventDefault(); return; }
  }

  // The wall of systems has its own, smaller vocabulary.
  if (sysStage === "wall") {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { moveSys(1); e.preventDefault(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { moveSys(-1); e.preventDefault(); }
    else if (e.key === "Enter") { if (sysList[sysSel]) { chooseSystem(sysList[sysSel].name); } }
    else if (e.key === "Home") { setSysSel(0); updateSystems(); }
    else if (e.key === "End")  { setSysSel(sysList.length - 1); updateSystems(); }
    else if (e.key === "g")    { setView(sysStyle() === "wheel" ? "carousel" : "wheel"); }
    else if (e.key === "c")    { toggleContrast(); }
    else if (e.key === "2")    { togglePlayers(); }
    else if (e.key === "f")    { toggleFavourites(); }
    // The same menu the mouse gets, for the console in the middle.
    else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      if (sysList[sysSel]) { openSysMenu(sysList[sysSel], sysSel, innerWidth / 2, innerHeight / 2); }
      e.preventDefault();
    }
    return;
  }

  // A list that says loading: the one before it is not walked, opened or played.
  if (listLoading() && (/^(Arrow(Up|Down|Left|Right)|Page(Up|Down)|Home|End|Enter|i| |e|d|r|ContextMenu)$/.test(e.key) || (e.key === "F10" && e.shiftKey))) {
    L("KEY", e.key + " while the list is being read: left");
    e.preventDefault();
    return;
  }

  // The rows view moves by card along a row and by row between them.
  if (view === "rows" && /^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|PageUp|PageDown|Home|End)$/.test(e.key)) {
    var rk = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
               PageUp: [0, -3], PageDown: [0, 3], Home: [-Infinity, 0], End: [Infinity, 0] }[e.key];
    navRows(rk[0], rk[1]);
    e.preventDefault();
    return;
  }

  if (e.key === "ArrowDown")       { move(rowStep(1)); e.preventDefault(); }
  else if (e.key === "ArrowUp")    { move(rowStep(-1)); e.preventDefault(); }
  // The carousel runs sideways, so left and right are its natural keys; up
  // and down still work there too.
  else if (e.key === "ArrowRight" && (view === "grid" || view === "shelf" || view === "carousel")) { move(1); e.preventDefault(); }
  else if (e.key === "ArrowLeft"  && (view === "grid" || view === "shelf" || view === "carousel")) { move(-1); e.preventDefault(); }
  /* In the list, left and right move the TABLE, not the selection: with more
     columns than fit, the ones off the right edge otherwise need a mouse, and
     a pad has no way to reach them at all. */
  else if (e.key === "ArrowRight" && view === "list") { if (scrollListX(1)) { e.preventDefault(); } }
  else if (e.key === "ArrowLeft"  && view === "list") { if (scrollListX(-1)) { e.preventDefault(); } }
  // To the next letter where the list runs by letter, else four steps (js\letters.js).
  else if (e.key === "PageDown")   { pageBy(1); e.preventDefault(); }
  else if (e.key === "PageUp")     { pageBy(-1); e.preventDefault(); }
  else if (e.key === "Home")       { setSel(0); render(); }
  else if (e.key === "End")        { setSel(games.length - 1); render(); }
  else if (e.key === "Enter")      { play(false); }
  else if (e.key === "i" || e.key === " ") { openDetails(); e.preventDefault(); }
  // The Menu key, or Shift+F10: what Windows itself uses for "right-click".
  else if (e.key === "e" && games[sel] && games[sel].local) { openLocalEditor(games[sel]); }
  else if (e.key === "e")          { if (games[sel]) { openEditor(games[sel]); } }
  else if (e.key === "d")          { if (games[sel] && games[sel].docs) { openDocs(games[sel]); } }   // its manual and maps (js\docs.js)
  else if (e.key === "F10" && !e.shiftKey && $toolbar.classList.contains("as-menubar")) { openBarMenu("xsegon"); e.preventDefault(); }
  else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) { openGameMenuAtSelection(); e.preventDefault(); }
  else if (e.key === "g")          { setView({ list: "grid", grid: "shelf", shelf: "wheel", wheel: "carousel", carousel: "rows", rows: "list" }[view] || "list"); }
  else if (e.key === "c")          { toggleContrast(); }
  else if (e.key === "l")          { openLogViewer(); }
  else if (e.key === "r")          { randomGame(); }
  else if (e.key === "f")          { toggleFavourites(); }
  else if (e.key === "2")          { togglePlayers(); }
  else if (e.key === "Escape")     {
    if (sysStage === "inside") { backToWall(); } else { $q.blur(); }
  }
  else if (e.key === "/")          { $q.focus(); e.preventDefault(); }
}

/*  The pad.

    A gamepad does not exist until a button is pressed while the page is
    focused, so there is nothing to do but poll and wait. Some PCs list a
    phantom device with no buttons, so pads reporting none can be skipped.

    Repeat is deliberate: holding a direction should walk the grid, and the
    first step waits longer than the rest or a nudge overshoots. Both numbers
    are settings.                                                            */

var padPrev = {};
var shoulderPrev = {};
var repeatAt = 0;
var repeatDir = 0;

/* Waiting for one button, for Settings > RetroArch + Emulator Controls > RetroArch (Gamepad)
   (js\padmap.js): the next button pressed on any pad goes to cb as its number
   in the standard layout (0 is the bottom face button), and nothing else on
   the page hears it. Only a fresh press counts: whatever is already held
   when the wait begins (the A that asked for it) has to be let go first.
   Works with the pad switched off for getting around. */
var padCatch = null;
export function catchPadButton(cb) { padCatch = { cb: cb, held: null }; }
export function stopPadCatch() { padCatch = null; }

/* Whether a controller is here to be heard. The browser shows a pad only
   once a button on it has been pressed with the page in front, so "no" also
   means "not touched yet": the words below say both. */
export function padSeen() {
  var pads = padsNow();
  for (var i = 0; i < pads.length; i++) {
    if (pads[i] && pads[i].buttons && pads[i].buttons.length) { return true; }
  }
  return false;
}

/* What a screen says while it waits for a pad button: plainly that only a
   controller's buttons are set here, and whether a controller has been seen. */
export function padWaitWords(forWhat) {
  return (padSeen() ? "Listening: press the controller button you want for " + forWhat + "."
    : "Listening for " + forWhat + ", but no controller has been seen yet. If one is connected, press the button you want on it. With none connected, nothing can be set here.") +
    " Keyboard keys are not set here. Esc cancels.";
}
export function padWaitNothing() {
  return "Nothing was pressed on a controller, so nothing changed." +
    (padSeen() ? "" : " No controller has been seen: check it is on and connected.");
}

/* The keyboard during that wait: Esc cancels, and any other key is answered
   on screen and goes no further, so the arrows do not walk the list behind.
   A key held with Alt, Ctrl or the Windows key is Windows's own (Alt+Tab)
   and is left alone. `what` names the wait in the log (code PADS). */
export function padWaitKey(what, say, cancel) {
  return function (e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); return; }
    if (e.altKey || e.ctrlKey || e.metaKey || /^(Alt|Control|Shift|Meta|OS|Tab|CapsLock)$/.test(e.key)) { return; }
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) { return; }
    L("PADS", what + ": the keyboard's " + e.key + " was pressed while listening for a controller button" + (padSeen() ? "" : " (no controller seen)"));
    say("That was a key on the keyboard. Only a controller's buttons are set here: press one on the controller, or Esc to leave it as it was.", true);
  };
}

function catchPoll(pads) {
  var first = padCatch.held === null;
  if (first) { padCatch.held = {}; }
  for (var i = 0; i < pads.length; i++) {
    var p = pads[i];
    if (!p || !p.buttons) { continue; }
    // 17, not 16: the standard layout's last button (16) is the Guide (Xbox)
    // button, which the menu-button picker listens for.
    for (var k = 0; k < Math.min(17, p.buttons.length); k++) {
      var on = !!(p.buttons[k] && p.buttons[k].pressed), key = i + ":" + k;
      if (on && !first && !padCatch.held[key]) {
        var cb = padCatch.cb;
        padCatch = null;
        setPadMode(true); touch();
        /* The snapshot at this loop's end is skipped by the return below, so
           the caught press would still be "fresh" to pollPad next tick and the
           screen would act on it twice. Every pad's state is written down first,
           in the superset of the shapes pollPad compares against. */
        var dz = (S.controller && S.controller.deadzone) || 0.35;
        for (var j = 0; j < pads.length; j++) {
          var q = pads[j];
          if (!q || !q.buttons) { continue; }
          var qx = (q.axes && q.axes[0]) || 0, qy = (q.axes && q.axes[1]) || 0;
          var qd = !!((q.buttons[13] && q.buttons[13].pressed) || qy > dz);
          var qu = !!((q.buttons[12] && q.buttons[12].pressed) || qy < -dz);
          var qr = !!((q.buttons[15] && q.buttons[15].pressed) || qx > dz);
          var ql = !!((q.buttons[14] && q.buttons[14].pressed) || qx < -dz);
          var v = qd ? 1 : qu ? -1 : 0, h = qr ? 1 : ql ? -1 : 0, qj = padJobs(q);
          padPrev[j] = { a: !!(q.buttons[qj.confirm] && q.buttons[qj.confirm].pressed), b: !!(q.buttons[qj.back] && q.buttons[qj.back].pressed),
                         x: !!(q.buttons[qj.details] && q.buttons[qj.details].pressed), y: !!(q.buttons[qj.menu] && q.buttons[qj.menu].pressed),
                         md: v, pd: (qr || qd) ? 1 : (ql || qu) ? -1 : 0, sv: v, sh: h, wd: qd ? 2 : qu ? -2 : h };
        }
        L("PAD", "caught button " + k);
        cb(k);
        return;
      }
      padCatch.held[key] = on;
    }
    // What the rest of the page will compare against once the wait is over,
    // so a button still down then is not a fresh press to Settings.
    var pj = padJobs(p);
    padPrev[i] = { a: !!(p.buttons[pj.confirm] && p.buttons[pj.confirm].pressed), b: !!(p.buttons[pj.back] && p.buttons[pj.back].pressed),
                   x: !!(p.buttons[pj.details] && p.buttons[pj.details].pressed), y: !!(p.buttons[pj.menu] && p.buttons[pj.menu].pressed) };
  }
}

/* The controller check (js\padcheck.js) reads the pad itself while it is
   open, and nothing else hears it. On the way out whatever is still held
   is spent, as the press that wakes the screen is. */
var padHeld = false;
export function holdPad(on) {
  padHeld = !!on;
  if (!on) { for (var k = 0; k < 8; k++) { padPrev[k] = { woke: true }; } }
}

export function pollPad() {
  padGhostPoll();             // only watches, for the log (js\padghost.js)
  if (padHeld) { return; }
  if (padCatch) { catchPoll(padsNow()); return; }
  if (!S.controller || !S.controller.enabled) { return; }
  var pads = padsNow();
  var dz = (S.controller.deadzone) || 0.35;
  var now = Date.now();

  for (var i = 0; i < pads.length; i++) {
    var p = pads[i];
    if (!p) { continue; }
    if (S.controller.ignoreEmptyPads && (!p.buttons || !p.buttons.length)) { continue; }
    if (padChange(p, i)) { continue; }      // Start on the "controller found" notice (js\padfound.js)

    var ax = p.axes[0] || 0, ay = p.axes[1] || 0;

    var down  = (p.buttons[13] && p.buttons[13].pressed) || ay > dz;
    var up    = (p.buttons[12] && p.buttons[12].pressed) || ay < -dz;
    var right = (p.buttons[15] && p.buttons[15].pressed) || ax > dz;
    var left  = (p.buttons[14] && p.buttons[14].pressed) || ax < -dz;

    // Which button each job is on for this pad: the standard places, Confirm
    // with, or the person's own for its kind (js\padjobs.js).
    var job = padJobs(p);
    var a = p.buttons[job.confirm] && p.buttons[job.confirm].pressed;   // confirms
    var b = p.buttons[job.back] && p.buttons[job.back].pressed;         // backs out
    var x = p.buttons[job.details] && p.buttons[job.details].pressed;   // opens details
    var y = p.buttons[job.menu] && p.buttons[job.menu].pressed;         // opens the menu
    // Page Up and Page Down, the shoulders as they come. Kept apart from padPrev, which
    // each screen below writes in its own shape: read here every poll, a
    // shoulder held while a menu closes is never a fresh press afterwards.
    var lb = !!(p.buttons[job.pageUp] && p.buttons[job.pageUp].pressed), rb = !!(p.buttons[job.pageDown] && p.buttons[job.pageDown].pressed);
    var held = shoulderPrev[i] || {};
    var lbHit = lb && !held.lb, rbHit = rb && !held.rb;
    var tb = !!(p.buttons[job.top] && p.buttons[job.top].pressed), tbHit = tb && !held.tb;   // up to the top menus (js\padtop.js)
    shoulderPrev[i] = { lb: lb, rb: rb, tb: tb };

    // Any press at all and the legend speaks pad: the first one is usually
    // a nudge to see what happens, and the answer should be on the screen.
    // It is also what keeps the screensaver away: the pad makes no DOM
    // events, so the idle clock hears it only from here.
    var woke = saverUp() && (a || b || x || y || lb || rb || up || down || left || right);
    if (a || b || x || y || lb || rb || tb || up || down || left || right) { padHeard(p, i); touch(); }

    var onWall = sysStage === "wall";
    var dir = onWall ? ((right || down) ? 1 : (left || up) ? -1 : 0)
            : down ? 2 : up ? -2               // a DIRECTION, not a distance: see nav()
            : ((view === "grid" || view === "shelf" || view === "rows" || view === "carousel") && right) ? 1
            : ((view === "grid" || view === "shelf" || view === "rows" || view === "carousel") && left) ? -1 : 0;

    var prev = padPrev[i] || {};

    // The press that put the screensaver away does nothing else, however long it is held.
    if (woke || prev.woke) {
      var still = a || b || x || y || up || down || left || right;
      if (woke) { L("PAD", "woke the screen"); }
      padPrev[i] = { a: a, b: b, x: x, y: y, woke: !!still };
      repeatDir = 0;
      continue;
    }
    // An asking window takes the pad as it takes the keys.
    var askUp = asking();
    if (askUp) {
      var ad = (right || down) ? 1 : (left || up) ? -1 : 0;
      askPad(askUp, ad !== prev.ad ? ad : 0, a && !prev.a, b && !prev.b);
      padPrev[i] = { a: a, b: b, x: x, y: y, ad: ad };
      repeatDir = 0;
      continue;
    }

    // A menu that is up takes the pad, as it takes the keys: up and down
    // walk it, A presses the row, B and Y put it away. Without this, Y
    // would open a menu the pad could not use, which is worse than no Y.
    if ($ctx) {
      var md = down ? 1 : up ? -1 : 0;
      if (md !== 0 && md !== prev.md) { L("PAD", (md > 0 ? "down" : "up") + " menu"); ctxFocus(ctxAt + md); }
      // Sideways, in a menu of sections: the section beside.
      var ms = md !== 0 ? 0 : right ? 1 : left ? -1 : 0;
      if (ms !== 0 && ms !== prev.ms) { L("PAD", (ms > 0 ? "right" : "left") + " menu"); if (!subSide(ms) && !ctxSide(ms)) { padTopSide(ms); } }
      if (a && !prev.a) { if (ctxItems[ctxAt]) { padTopRan(ctxItems[ctxAt]); ctxRun(ctxItems[ctxAt]); } }
      if ((b && !prev.b) || (y && !prev.y)) { if (!subBack()) { closeGameMenu(); } sound("back"); }
      padPrev[i] = { a: a, b: b, x: x, y: y, md: md, ms: ms };
      continue;
    }

    // The state picker takes the pad while it is up: one step per nudge,
    // A picks, B backs out. Nothing else on the page hears it.
    if (pick) {
      var pd = (right || down) ? 1 : (left || up) ? -1 : 0;
      if (pd !== 0 && pd !== prev.pd) { L("PAD", (pd > 0 ? "right" : "left") + " states"); pick.move(pd); }
      if (a && !prev.a) { pick.choose(); }
      if (b && !prev.b) { closeEditor(); }
      padPrev[i] = { a: a, b: b, x: x, pd: pd };
      continue;
    }

    // Settings, from the couch: the same four directions as the keyboard,
    // A opens, B backs out one level and then closes it.
    if (!$settings.hidden) {
      var sv = down ? 1 : up ? -1 : 0;
      var sh = right ? 1 : left ? -1 : 0;
      if (sv !== 0 && sv !== prev.sv) { L("PAD", (sv > 0 ? "down" : "up") + " settings"); setMove(sv); }
      if (sh !== 0 && sh !== prev.sh) {
        L("PAD", (sh > 0 ? "right" : "left") + " settings");
        if (setUI && setUI.where === "nav" && sh > 0) { setIntoPage(); sound("select"); }
        else if (setUI && setUI.where === "page") { setAdjust(sh); }
      }
      if (a && !prev.a) { setEnter(); }
      if (b && !prev.b) { if (!setBack()) { closeSettings(); } }
      padPrev[i] = { a: a, b: b, x: x, sv: sv, sh: sh };
      continue;
    }

    // The mailbox and a window a menu opened: the cross walks what is in
    // them, A presses it, B closes them as Esc does (js\padwin.js). The right
    // stick scrolls, only on a pad whose sticks are sure and past its dead zone.
    if (mailOpen() || !$editor.hidden) {
      padPrev[i] = padWinPoll({ up: up, down: down, left: left, right: right, a: a, b: b, x: x, y: y, lb: lbHit, rb: rbHit,
                                ry: p.mapping === "standard" && !p.listed && Math.abs(p.axes[3] || 0) > dz ? p.axes[3] : 0 }, prev);
      repeatDir = 0;
      continue;
    }

    /* Details: the cross walks its tabs and a tab's list, never the game behind
       the panel (A must start the game shown); LB and RB change tab, and A, B,
       X and Y are play, back, back, the documents unless a list has A and B. */
    if (!$details.hidden) {
      var td = down ? 2 : up ? -2 : right ? 1 : left ? -1 : 0;
      var tw = td === 2 ? "down" : td === -2 ? "up" : td === 1 ? "right" : "left";
      if (td === 0) { repeatDir = 0; }
      else if (td !== repeatDir) {
        L("PAD", tw + " details");
        detailTabPad(tw);
        repeatDir = td;
        repeatAt = now + (S.controller.repeatDelayMs || 400);
      } else if (now >= repeatAt && (td === 2 || td === -2)) {
        detailTabPad(tw);
        repeatAt = now + (S.controller.repeatRateMs || 110);
      }
      if (lbHit || rbHit) { L("PAD", (rbHit ? "rb" : "lb") + " details"); detailTabPad(rbHit ? "rb" : "lb"); }
      if (a && !prev.a && !detailTabPad("a")) { closeDetails(); launch(); }
      if (b && !prev.b && !detailTabPad("b")) { closeDetails(); }
      if (x && !prev.x) { closeDetails(); }
      if (y && !prev.y) { L("PAD", "y details"); if (games[sel] && games[sel].docs) { openDocs(games[sel]); } }
      padPrev[i] = { a: a, b: b, x: x, y: y };
      continue;
    }

    // The bar up among the menus and buttons at the top: its own walk until it comes back down.
    var tp = padTopPoll({ up: up, down: down, left: left, right: right, a: a, b: b, x: x, y: y, hit: tbHit }, prev);
    if (tp) { padPrev[i] = tp; repeatDir = dir; repeatAt = now + (S.controller.repeatDelayMs || 400); continue; }

    // dir stays a fixed marker per direction so the repeat timer can tell
    // "still holding Down" from "changed direction". How FAR Down goes is
    // worked out at the moment of the move, because in a grouped grid it
    // differs from row to row.
    function nav(d) {
      L("PAD", (d === 2 ? "down" : d === -2 ? "up" : d > 0 ? "right" : "left") + " " + (sysStage === "wall" ? "wall" : view));
      if (onWall) { moveSys(d); }
      else if (view === "rows") { navRows(d === 2 || d === -2 ? 0 : d, d === 2 ? 1 : d === -2 ? -1 : 0); }
      else if (d === 2 || d === -2) { move(rowStep(d > 0 ? 1 : -1)); }
      else { move(d); }
    }

    // A list that says loading has nothing on screen to walk or play: only B is heard.
    if (listLoading()) {
      if (b && !prev.b) { backToWall(); }
      repeatDir = 0;
      padPrev[i] = { a: a, b: b, x: x, y: y };
      continue;
    }

    if (dir !== 0) {
      if (dir !== repeatDir) {
        nav(dir);
        repeatDir = dir;
        repeatAt = now + (S.controller.repeatDelayMs || 400);
      } else if (now >= repeatAt) {
        nav(dir);
        repeatAt = now + (S.controller.repeatRateMs || 110);
      }
    } else {
      repeatDir = 0;
    }

    if (a && !prev.a) {
      if (onWall) { if (sysList[sysSel]) { chooseSystem(sysList[sysSel].name); } }
      else if ($details.hidden) { play(false); }
      else { closeDetails(); launch(); }
    }
    if (b && !prev.b) {
      if (!closeDetails() && sysStage === "inside") { backToWall(); }
    }
    if (x && !prev.x) {
      if (onWall) { /* the wall has no details */ }
      else if ($details.hidden) { openDetails(); }
      else { closeDetails(); }
    }
    // Y: the same menu the Menu key opens, for the console in the middle on
    // the wall and for the chosen game elsewhere. Over details, where the
    // keys offer no menu either, it opens the game's documents, as D does.
    if (y && !prev.y) {
      L("PAD", "y " + (onWall ? "wall" : view));
      if (onWall) { if (sysList[sysSel]) { openSysMenu(sysList[sysSel], sysSel, innerWidth / 2, innerHeight / 2); } }
      else if ($details.hidden) { openGameMenuAtSelection(); }
      else if (games[sel] && games[sel].docs) { openDocs(games[sel]); }
    }
    // LB and RB: a page, which is a letter where the list runs by letter
    // (js\letters.js). Not on the consoles screen, nor over details.
    if ((lbHit || rbHit) && !onWall && $details.hidden) {
      L("PAD", (rbHit ? "rb " : "lb ") + view);
      pageBy(rbHit ? 1 : -1);
    }

    padPrev[i] = { a: a, b: b, x: x, y: y };
  }
}
