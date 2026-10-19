/*  Xsegon - the front end. This file is the one the page loads; it brings in
    the rest and puts them up.

    Plain JavaScript on purpose: the UI must never depend on what is hosting
    it, so no framework, no host API, nothing but fetch(). Swapping a browser
    kiosk for a native shell is then changing what you double-click.

    Views are presentations of one model, not separate screens: list and grid
    read the same rows and differ only in render() and in how far a keypress
    moves.

    Every module here rides inside the page (index.php, the loader at its
    end), read from disk on every load, so a change is always the one on
    screen.

    Where things are:

      state.js         what everything shares, and the setters for it
      dom, util.js     el(), picture addresses, stars, closeOnBackdrop
      icons.js         the drawn icon set
      log.js           L(), the ring, api(), bug() and guard()
      sound.js         the sound packs, the volume, and the sound under the pointer
      library.js       load(), the platform lists, surprise me, the filters
      views.js         list, grid, shelf, wheel, carousel: drawing and moving
      shelf.js         one spine of the Shelf view
      viewsize.js      how big the grid and the shelf are drawn, and the gear for it
      drag.js          grabbing a wheel or a carousel to turn it
      hero.js          the info panel beside the list and the wheel
      help.js          the legend along the bottom, in keys or pad buttons
      sidebar.js       the consoles down the left of the list and the grid
      chrome.js        how much room the bars take, measured
      snap.js          video snaps
      details.js       the details panel
      docs.js          a game's manual, maps and guides, and the panel they open in
      steam.js         Games > Add Steam games
      tags.js          your tags: a game's Tags list and New tag
      menus.js         the right-click menu and the menu bar
      editors.js       edit metadata, your own games, hiding
      art-editors.js   pictures, a platform's pictures, video, find online
      fill.js          Fill in scanned games, from the Games Database
      hint.js          the three second note under Pictures & Videos
      tools.js         the log viewer and the media tool
      launch.js        launching, save states, the strip
      cores.js         which RetroArch core a game runs on
      systems.js       the consoles screen
      status.js        the screensaver and the status poll
      settings-ui.js   the settings screen
      settings-nav.js  driving settings without a mouse
      settings-save.js settings saving themselves, with no Save button
      appwindow.js     the window's own minimise and close
      input.js         the keyboard and the pad
      main.js          this: the order it all goes up in

    Nothing may import this file. On the ordinary load (the way back in
    index.php) the page asks for it with a ?v= on the address and an import
    would not have one, so the browser would hold two of it and run the
    second in the middle of the first.                                       */

import { openAddChooser } from "./add.js";
import { inApp, initWindowButtons, toggleStatus, watchScreen } from "./appwindow.js";
import { initArtEditors } from "./art-editors.js";
import { initChrome } from "./chrome.js";
import { attachSpin } from "./drag.js";
import { closeEditor } from "./editors.js";
import { paintHelp, paintHelpHere } from "./help.js";
import { initInput, pollPad } from "./input.js";
import { load, randomGame, searchTyped, setPeriod } from "./library.js";
import { initList } from "./list.js";
import { listGlide } from "./listglide.js";
import { initListMenu } from "./listmenu.js";
import { L, LOG_MOVES, bug, initLog } from "./log.js";
import { askLogging } from "./logask.js";
import { initMenus } from "./menus.js";
import { initMotion } from "./motion.js";
import { initNewGames } from "./newgames.js";
import { checkNews, wireMail } from "./news.js";
import { padsBegin } from "./padfound.js";
import { initRain } from "./rain.js";
import { initRowStars } from "./rowstars.js";
import { initSettingsSave } from "./settings-save.js";
import { closeSettings, openSettings, toggleContrast } from "./settings-ui.js";
import { firstRunSetup } from "./setup.js";
import { initSnow } from "./snow.js";
import { initVolume, wireHoverSound } from "./sound.js";
import { $added, $btnSystems, $editor, $info, $platform, $q, $settings, $sort, $syswall, $view, $viewsel, startInSystems, sysStage, view } from "./state.js";
import { checkIdle, lastStatus, paintStatus, pollStatus, statusOnFocus, touch } from "./status.js";
import { backToWall, enterSystems, hasWallShape, moveSys, startOnAllGames, sysStyle } from "./systems.js";
import { closeOnBackdrop, initVersionTips } from "./util.js";
import { paintViewLock } from "./viewlock.js";
import { ctl, move, setView, tickClock } from "./views.js";
import { applyViewSizes } from "./viewsize.js";
import { checkWhatsNew } from "./whatsnew.js";
import { wireWheelGear } from "./wheelgear.js";
import { spinScroller } from "./wheelscroll.js";

/* ---------- putting it all up ----------

   The order listeners go up in is part of how the page behaves: two handlers
   on the same target run in the order they went on, and the keys go on before
   the idle clock. Modules are evaluated in whatever order the imports demand,
   so nothing below the declarations runs by itself: each part offers an init(),
   called here in order.                                                    */
initLog();
/* A fault in Xsegon's own code (log.js, bug()) is said quietly: one thin
   white line across the top, offering restart or write in, gone after fifteen
   seconds or at its x. Where and why are in the log's BUG line. */
var bugBar = null, bugHide = null;
var HELP = "help@tumultuousproductions.site";
window.addEventListener("xs:bug", function (e) {
  var d = e.detail || {}, code = d.code || "XS-APP-0000", area = d.area || "Xsegon";
  if (!bugBar) {
    bugBar = document.createElement("div");
    bugBar.id = "bugbar";
    bugBar.setAttribute("role", "status");
    bugBar.appendChild(document.createElement("span")).className = "bb-text";
    var x = bugBar.appendChild(document.createElement("button"));
    x.className = "bb-x"; x.type = "button"; x.setAttribute("aria-label", "Dismiss"); x.textContent = "×";
    x.addEventListener("click", function () { bugBar.hidden = true; });
    document.body.appendChild(bugBar);
  }
  /* The code (log.js, bugCode) is the one thing worth reading out: the
     area in words is a rough idea of what went wrong, and the email is
     written for them with the code and the build already in it. */
  var text = bugBar.querySelector(".bb-text");
  text.textContent = "Something went wrong with " + area + " (";
  text.appendChild(document.createElement("b")).textContent = code;
  text.appendChild(document.createTextNode("). Restarting Xsegon usually sorts it out. If it keeps happening, email "));
  var a = text.appendChild(document.createElement("a"));
  a.textContent = HELP;
  a.href = "mailto:" + HELP + "?subject=" + encodeURIComponent("Xsegon error " + code) +
    "&body=" + encodeURIComponent("Error code: " + code + "\nWhere: " + area + "\nBuild: " + ((window.XSEGON || {}).build || "unknown") +
    "\n\nWhat were you doing when it happened?\n\n\n(If you can, attach the report from Settings > Debug > Something is wrong.)");
  text.appendChild(document.createTextNode(" with that code."));
  bugBar.hidden = false;
  clearTimeout(bugHide);
  bugHide = setTimeout(function () { bugBar.hidden = true; }, 15000);
});
initMenus();
initArtEditors();
closeOnBackdrop($editor, closeEditor);
initVolume();
initSettingsSave();
initWindowButtons();
watchScreen();   // a TV plugged in, or taken away: the window is opened again at that screen's size
initInput();

// ---------- wiring ----------

initChrome();
initVersionTips();   // the box that says what a card holding several versions holds
initList();      // the list's sideways scrolling, which freezes the title column
initListMenu();  // a header's own menu, on a right-click
initRowStars();  // and your stars, pressed in a game's own row
initRain();      // a theme's rain, when the look on the page has one
initSnow();      // and a theme's snow
initMotion();    // and whatever else of a theme moves by itself

document.getElementById("btn-settings").addEventListener("click", openSettings);
document.getElementById("btn-random").addEventListener("click", randomGame);

// The idle clock listens to real input only -- a status poll must never
// count as "someone is here".
["keydown", "mousedown", "wheel", "touchstart"].forEach(function (ev) {
  document.addEventListener(ev, touch, { passive: true });
});
setInterval(checkIdle, 10000);
$viewsel.addEventListener("change", function () { setView($viewsel.value); });

// Spin by grabbing: wheels vertically, carousels horizontally.
attachSpin($view,
  function () { return view === "carousel" ? "x" : "y"; },
  function (d) { move(d); },
  function () { return view === "wheel" || view === "carousel"; });
attachSpin($syswall,
  function () { return sysStyle() === "wheel" ? "y" : "x"; },
  function (d) { moveSys(d); },
  function () { return sysStage === "wall"; });

// And by scrolling, at the Speed set and with the Momentum set (js\wheelscroll.js).
var viewScroll = spinScroller(function (d) { move(d); }, function () { return view === "wheel" || view === "carousel"; });
var sysScroll = spinScroller(function (d) { moveSys(d); }, function () { return sysStage === "wall"; });
$view.addEventListener("wheel", function (e) {
  if (!ctl("wheelTurns", true)) { return; }
  if (view !== "wheel" && view !== "carousel") { return; }
  e.preventDefault();
  viewScroll.wheel(e);
}, { passive: false });
$syswall.addEventListener("wheel", function (e) {
  if (!ctl("wheelTurns", true)) { return; }
  if (sysStage !== "wall") { return; }
  e.preventDefault();
  sysScroll.wheel(e);
}, { passive: false });
// Anything else you do stops a glide where it is: a key, or taking hold.
document.addEventListener("keydown", function () { viewScroll.stop(); sysScroll.stop(); }, true);
$view.addEventListener("pointerdown", viewScroll.stop);
$syswall.addEventListener("pointerdown", sysScroll.stop);
wireWheelGear();                           // the gear on the game wheel: Speed and Momentum
applyViewSizes();                          // how big the grid and the shelf are drawn (js\viewsize.js)
wireHoverSound($view);                     // a game, and a button, sound as the pointer comes onto them (js\sound.js)
listGlide($view, function () { return view === "list" || view === "grid" || view === "shelf"; });   // a little give to the list's scroll (js\listglide.js)
document.getElementById("btn-contrast").addEventListener("click", toggleContrast);
// + asks which kind of adding first: a folder full of games, or one by hand.
document.getElementById("btn-add").addEventListener("click", openAddChooser);
wireMail();
document.getElementById("warn-mark").addEventListener("click", function () {
  localStorage.removeItem("xs-warn-folded");
  if (lastStatus) { paintStatus(lastStatus); }
});
$info.addEventListener("click", toggleStatus);
$btnSystems.addEventListener("click", function () {
  if (sysStage === "inside") { backToWall(); }
});

$q.addEventListener("input", searchTyped);   // read 150 ms after the last letter (js\library.js)
// While the search box has the keys, the legend says how to leave it (js\input.js).
$q.addEventListener("focus", function () { paintHelp("search"); });
$q.addEventListener("blur", paintHelpHere);
$platform.addEventListener("change", load);
$sort.addEventListener("change", load);
$added.addEventListener("change", function () { setPeriod($platform.value, $added.value); });
/* A dropdown chosen by hand gives the keys back to the games: kept, its own letters and arrows
   changed it again under Xsegon's keys (g on View flashed the next view and bounced back to Grid). */
[$viewsel, $platform, $added, $sort].forEach(function (s) {
  s.addEventListener("change", function (e) {
    if (!e.isTrusted) { return; }             // the pad's menu and the menu bar set it without the keys (js\padtop.js)
    L("CLK", (s.getAttribute("aria-label") || s.id) + " dropdown: " + ((s.selectedOptions[0] || {}).textContent || s.value).trim());
    s.blur();
  });
});
closeOnBackdrop($settings, closeSettings);

paintHelp("browse");
paintViewLock();            // the back arrow greyed while the consoles screen waits (js\viewlock.js); index.php greyed the dropdown
tickClock();
setInterval(tickClock, 15000);

window.XSEGON.booted = true;             // the start-up watchdog in index.php stands down
/** The browser by name and version: an update of it is a cause nothing else in a report shows. */
function browserSays() {
  var d = navigator.userAgentData;
  var own = ((d && d.brands) || []).filter(function (x) { return !/not.?a.?brand|chromium/i.test(x.brand); })[0];
  if (own) { return own.brand.replace(/^(Google|Microsoft) /, "") + " " + own.version; }
  var m = /(Edg|Firefox|Chrome)\/(\d+)/.exec(navigator.userAgent);
  return m ? (m[1] === "Edg" ? "Edge" : m[1]) + " " + m[2] : "unknown";
}
/** The screen as the page is laid out on it. A browser started at a scale of its own (bin\xsbrowser.ps1) takes
    that scale off its screen's size twice: its full window is then wider than its screen. Put back once. */
function screenSays() {
  var r = window.devicePixelRatio || 1;
  var twice = innerWidth > screen.width + 1 && Math.abs(screen.width * r - innerWidth) <= 2;
  return Math.round(screen.width * (twice ? r : 1)) + "x" + Math.round(screen.height * (twice ? r : 1));
}
L("BOOT", "page " + (inApp ? "app" : "tab") + " view=" + view + " " + innerWidth + "x" + innerHeight + (LOG_MOVES ? "" : " (no SEL)")
  + " browser=" + browserSays() + " screen=" + screenSays() + " scale=" + Math.round((window.devicePixelRatio || 1) * 100) + "%");
if (window.XSEGON.started) { L("BOOT", window.XSEGON.started()); }   // where the start went (index.php)
// Opening on the consoles, the games are read for their lists and counts but
// not drawn: building the whole wheel out of sight holds up the consoles.
var consolesFirst = startInSystems && hasWallShape(view);
load({ noDraw: consolesFirst, boot: true }).then(function () {
  // "Systems first" can only come up once the first load has said what the
  // systems ARE. And only for a view that HAS a shape there: List and Grid
  // open on every game, or Xsegon would open on a wheel of consoles under a
  // dropdown that said List (startOnAllGames says the rest).
  if (consolesFirst) { enterSystems(); }
  else if (startInSystems) { startOnAllGames(); }
  pollStatus();
  padsBegin();              // controller found or not, for the log (js\padfound.js)
  // Keep a log? comes before anything else is offered, once (js\logask.js).
  // What changed since last time, once, after the screen is up: it sweeps
  // every game file, and this server answers one request at a time, so it
  // goes last rather than racing the library the page is waiting on.
  // The two after it run whatever the news check does: a failure there is
  // logged as a bug, never a reason for someone new to miss the guide.
  askLogging().then(checkNews).catch(function (e) { bug("startup news check", e); }).then(function () {
    // Someone new (no RetroArch in use, or no games) gets the getting
    // started guide, once (js\setup.js). Everyone else hears nothing.
    firstRunSetup();
    // After an update, a note in the corner once (js\whatsnew.js).
    checkWhatsNew();
    // New games in the games folders, now and whenever the window comes back (js\newgames.js).
    initNewGames();
  });
});
setInterval(pollStatus, 4000);
window.addEventListener("focus", statusOnFocus);
setInterval(pollPad, 60);
// What private\web adds, only where that folder is; a full address, since a glued module's base is a blob.
if (window.XSEGON.private) {
  import(location.origin + "/private/web/main.js?v=" + window.XSEGON.private)
    .catch(function (e) { L("BOOT", "the private parts did not load: " + e); });
}
