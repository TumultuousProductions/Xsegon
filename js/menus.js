/*  Every popup in the app is this one object: the right-click game menu, the
    menu bar dropdowns in list and grid, and the console menu on the wall.
    popupMenu() draws it, the keyboard walks it, and one press anywhere else
    closes it.                                                              */

import { openAbout } from "./about.js";
import { openAddChooser } from "./add.js";
import { openArtEditor, openVideoEditor, pasteBoxArt } from "./art-editors.js";
import { openBiosCheck } from "./bios.js";
import { openCheatPicker } from "./cheats.js";
import { openControls } from "./controls.js";
import { openCorePicker } from "./cores.js";
import { confirmDelete, openMissingTool } from "./deleted.js";
import { openDetails, toggleFav } from "./details.js";
import { openDocs } from "./docs.js";
import { hideGame, openEditor, openLocalEditor, removeLocal } from "./editors.js";
import { openEmuAdd } from "./emuadd.js";
import { askEmulator, needsEmulator } from "./emuhelp.js";
import { openEmuMove } from "./emumove.js";
import { openEmuPicker } from "./emuset.js";
import { openExtPage } from "./extensions.js";
import { openFanPage } from "./fanprojects.js";
import { openFileCheck } from "./filecheck.js";
import { openFilterWindow } from "./filterwin.js";
import { openGetMedia } from "./getmedia.js";
import { hackAsking, openHackSettle } from "./hacksettle.js";
import { iconEl } from "./icons.js";
import { launch, launchNow, openStates, showStrip } from "./launch.js";
import { bringInLaunchBox } from "./lbimport.js";
import { clearFilters, filterWords, paintFilterButton, randomGame } from "./library.js";
import { L, api } from "./log.js";
import { logoTipDone } from "./logotip.js";
import { TIPS, hideMenuTip, leaveMenuTip, menuTipScrolled, restMenuTip } from "./menu-tips.js";
import { openPadCheck } from "./padcheck.js";
import { openPhone } from "./phone.js";
import { getRetroArch, raLabel } from "./raoffer.js";
import { showInExplorer } from "./reveal.js";
import { rowsNode } from "./rows.js";
import { openRunCheck } from "./runcheck.js";
import { openScanTool } from "./scan.js";
import { openSettings, toggleContrast } from "./settings-ui.js";
import { openGuide } from "./setup.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $body, $logo, $sort, $viewsel, S, emusInLaunchBox, games, sel, setSel, sysStage, view } from "./state.js";
import { openSteamTool } from "./steam.js";
import { subClose, subHover, subRow, subWatch } from "./submenu.js";
import { backToWall } from "./systems.js";
import { openTagMenu } from "./tags.js";
import { setTheme, themeId, themeList } from "./themes.js";
import { openBackupTool, openLogViewer, openReportTool } from "./tools.js";
import { openTpPage } from "./tppage.js";
import { el } from "./util.js";
import { lockWords, viewWaits, viewsLocked } from "./viewlock.js";
import { carNodes, flatNodes, render, setView, wheelNodes } from "./views.js";
import { GRID_IMAGES, badgesOn, badgesShown, gridImage, noVideoMarked, playersShown, setBadge, setGridImage, setShowPlayers, setSort, setViewFlag, toggleHeroPanel, toggleListStripes, toggleNoVideoMark, toggleShowBadges, toggleShowPlayers, toggleSidebar } from "./viewset.js";
import { openSizer } from "./viewsize.js";
import { openWantedTool } from "./wanted.js";
import { openWhatsNew } from "./whatsnew.js";

// ---------- the right-click game menu ----------
/* One menu at a time, at body level so no view can clip it. It closes on
   any click elsewhere, Esc, a scroll, or the window losing focus. */

export var $ctx = null;
export var mbOpen = null;                       // which menu bar dropdown is showing
export var ctxItems = [];
export var ctxAt = -1;

export function closeGameMenu() {
  if (!$ctx) { return false; }
  hideMenuTip();                                // an entry's card never outlives its menu
  subClose();                                   // nor a group's box
  if (mbOpen) {
    mbOpen = null;
    document.querySelectorAll("#mb button, #brand-logo").forEach(function (b) { b.classList.remove("open"); });
  }
  $ctx.remove();
  $ctx = null;
  ctxItems = [];
  ctxAt = -1;
  return true;
}

export function ctxFocus(i) {
  if (!ctxItems.length) { return; }
  ctxAt = (i + ctxItems.length) % ctxItems.length;
  ctxItems.forEach(function (it, n) { it.node.classList.toggle("at", n === ctxAt); });
  subWatch(ctxItems[ctxAt]);
  // A long list scrolls in its own box; the row the keys or the pad are on
  // stays in sight.
  var at = ctxItems[ctxAt].node;
  if (at.scrollIntoView) { at.scrollIntoView({ block: "nearest" }); }
  // Rest here a moment and the entry says what it does (js\menu-tips.js):
  // from this one place, so the mouse, the keys and the pad all get it.
  restMenuTip(at);
}

/* Another list for the keys and the pad to walk: a group's box, or back to
   the menu it hangs from (js\submenu.js). */
export function ctxUse(items, at) {
  ctxItems.forEach(function (it) { it.node.classList.remove("at"); });
  ctxItems = items;
  ctxFocus(at);
}

// The pointer on a row: the bar goes there, unless it is on its way to a group's box.
function hoverRow(it) { if (!subHover(it)) { ctxFocus(ctxItems.indexOf(it)); } }

/* Left and Right in a menu of sections: the same row of the section beside,
   or its last. A section with nothing to press (no tags yet) is stepped over. */
export function ctxSide(d) {
  var from = ctxItems[ctxAt];
  if (!from || !(from.col >= 0)) { return false; }
  var inCol = function (c) { return ctxItems.filter(function (it) { return it.col === c; }); };
  var rowAt = inCol(from.col).indexOf(from);
  var last = ctxItems.reduce(function (m, it) { return Math.max(m, it.col === undefined ? -1 : it.col); }, -1);
  for (var c = from.col + d; c >= 0 && c <= last; c += d) {
    var there = inCol(c);
    if (there.length) { ctxFocus(ctxItems.indexOf(there[Math.min(rowAt, there.length - 1)])); return true; }
  }
  return false;
}

export function ctxRun(it) {
  if (it.sub) { it.run(); return; }             // a group: its box opens, the menu stays
  L("MNU", "run " + ((it.node.querySelector(".ctx-label") || it.node).textContent || "").trim());
  closeGameMenu();
  it.run();
}

function reveal(g, what) { showInExplorer({ id: g.id, what: what }); }

/* One popup for every menu in the app: the game's right-click menu and the
   menu bar's dropdowns are the same object, so they look, key and close
   alike. entries: { icon, label, hint, tip, run } | { rule: true }. An entry
   with no run is shown greyed (that is how "planned" items appear); checked
   puts a check mark where the icon goes; tip is the sentence its card says.
   { pair: [a, b] } puts two entries side by side on one row: each is an
   entry like any other, so the keys and the pad step through them in turn.
   { cols: [{ head, items }] } stands sections side by side, under headings
   where they have one (the rest of your tags, js\filterwin.js): Up and Down
   still walk every entry, Left and Right step between sections (ctxSide).
   key names an entry so it can be found again. */
export function popupMenu(entries, x, y, title) {
  var live = function (list) {
    return list.reduce(function (n, e) { return n + (e.cols ? e.cols.reduce(function (m, c) { return m + live(c.items); }, 0) : e.run ? 1 : 0); }, 0);
  };
  L("MNU", "open " + (title || "bar") + " (" + live(entries) + " live)");
  closeGameMenu();
  stopVideo();

  $ctx = el("div", "ctx");
  $ctx.setAttribute("role", "menu");
  if (title) { $ctx.appendChild(el("div", "ctx-title", title)); }

  menuFill(entries, $ctx, ctxItems);
  $ctx.addEventListener("scroll", menuTipScrolled);

  document.body.appendChild($ctx);

  // Keep it on screen: flip to the other side of the pointer at an edge.
  var w = $ctx.offsetWidth, h = $ctx.offsetHeight;
  var left = (x + w + 8 > window.innerWidth) ? Math.max(8, x - w) : x;
  var top  = (y + h + 8 > window.innerHeight) ? Math.max(8, window.innerHeight - h - 8) : y;
  $ctx.style.left = left + "px";
  $ctx.style.top = top + "px";
  ctxFocus(0);
  sound("select");
}

/* A menu's rows, into a box. What can be pressed goes into items, in order:
   the menu's own list, or a group's (js\submenu.js). */
export function menuFill(entries, box, items) {
  var colAt = -1;                                 // the section being filled, -1 outside any
  entries.forEach(function (en) { add(en, box); });
  function add(en, into) {
    if (en.hidden) { return; }
    if (en.rule) { into.appendChild(el("div", "ctx-rule")); return; }
    if (en.head) { into.appendChild(el("div", "ctx-head", en.head)); return; }   // names the rows under it; the bar passes it by
    if (en.pair) {
      var both = into.appendChild(el("div", "ctx-pair"));
      en.pair.forEach(function (half) { add(half, both); });
      return;
    }
    if (en.cols) {
      var strip = into.appendChild(el("div", "ctx-cols"));
      en.cols.forEach(function (c, ci) {
        var section = strip.appendChild(el("div", "ctx-col"));
        if (c.head) { section.appendChild(el("div", "ctx-head", c.head)); }
        colAt = ci;
        c.items.forEach(function (item) { add(item, section); });
      });
      colAt = -1;
      return;
    }
    var n = el("div", "ctx-item" + (en.run || en.sub ? "" : " off") + (en.checked ? " on" : "") +
                      (en.danger ? " danger" : "") + (en.sub ? " has-sub" : ""));
    n.setAttribute("role", "menuitem");
    n.appendChild(en.checked || en.icon ? iconEl("ctx-ico", en.checked ? "check" : en.icon)
                                        : el("span", "ctx-ico"));
    n.appendChild(el("span", "ctx-label", en.label));
    if (en.hint) { n.appendChild(el("span", "ctx-hint", en.hint)); }
    if (en.tip) { n.dataset.tip = en.tip; }
    if (en.key) { n.dataset.key = en.key; }
    /* A group. Kept to two on the game menu on purpose: a menu you have to
       go spelunking in is worse than a long one, so only the two groups
       nobody opens in a hurry are folded (the emulator ones and the Explorer
       ones). Its entries open in a box beside the row, the menu still up
       behind it (js\submenu.js). */
    if (en.sub) {
      n.appendChild(el("span", "ctx-arrow", "›"));
      var subIt = subRow(n, en);
      items.push(subIt);
      n.addEventListener("mousemove", function () { hoverRow(subIt); });
    } else if (en.run) {
      var it = { node: n, run: en.run, col: colAt };
      items.push(it);
      n.addEventListener("click", function (e) { e.stopPropagation(); ctxRun(it); });
      n.addEventListener("mousemove", function () { hoverRow(it); });
    } else if (en.tip) {
      // Greyed: the bar never lands here, so its card (why it is off) is
      // the pointer's alone.
      n.addEventListener("mouseenter", function () { restMenuTip(n, true); });
      n.addEventListener("mouseleave", function () { leaveMenuTip(n); });
    }
    into.appendChild(n);
  }
}

export function openGameMenu(i, x, y) {
  if (!games[i]) { return; }
  // The menu is about the game under the pointer, so that game is chosen.
  if (sel !== i) { setSel(i); render(); }
  var g = games[i];

  /* Two folded groups, and no more than two by rule. Both hold things you
     go looking for rather than reach for: which core and which cheats, and
     the Explorer entries. Everything done often is one press from the top. */
  var emulation = function () {
    return [
      // Shown on every game, including those with no choice: the dialog
      // explains why, and an entry that quietly vanished would read as breakage.
      { icon: "disc", label: "Set Core...", tip: TIPS.core, run: function () { openCorePicker(g); } },
      { icon: "disc", label: "Set Emulator...", tip: TIPS.emulator, hidden: !!g.local, run: function () { openEmuPicker(g); } },
      // Read only: bindings are per console, so any game answers
      // for its whole shelf, straight from the emulator's own files.
      { icon: "gamepad", label: "Controls...", tip: TIPS.controls, run: function () { openControls(g); } },
      { icon: "wand", label: g.cheats ? "Cheats (" + g.cheats + ")..." : "Cheats...",
        tip: TIPS.cheats, run: function () { openCheatPicker(g); } },
      // The emulator this game runs in, by itself: Ryujinx on a Switch game, RetroArch where it is the one.
      g.emu ? { icon: "disc", label: "Open " + g.emu, tip: TIPS.emuAlone, run: function () { openEmulator(g); } }
            : { icon: "disc", label: "Open RetroArch", tip: TIPS.retroarch, run: openRetroArch },
    ];
  };
  var explorer = function () {
    return [
      { icon: "external", label: g.local ? "Show File" : "Show ROM", run: function () { reveal(g, "rom"); } },
      { icon: "external", label: "Show Images", run: g.hasArt || g.hasLogo || g.hasFanart ? function () { reveal(g, "images"); } : null,
        tip: g.hasArt || g.hasLogo || g.hasFanart ? null : TIPS.noImages },
      { icon: "external", label: "Show Video", run: g.hasVideo ? function () { reveal(g, "video"); } : null, tip: g.hasVideo ? null : TIPS.noVideo },
    ];
  };

  popupMenu([
    { icon: "play", label: "Play", hint: "Enter", run: g.playable ? function () { launch(); } : null,
      tip: g.playable ? null : "Cannot start: " + (g.why || "it has no launch command") },
    // No emulator yet where RetroArch would play it: the press that gets it (js\raoffer.js).
    { icon: "disc", label: raLabel(g.raOffer) || "", hidden: g.playable || !raLabel(g.raOffer), tip: g.why,
      run: function () { getRetroArch("the game menu"); } },
    // No emulator where RetroArch is not the way: the emulators to get (js\emuhelp.js).
    { icon: "disc", label: "Get an emulator...", hidden: !needsEmulator(g), tip: g.why, run: function () { askEmulator(g); } },
    // A Steam game's own program, for when Steam or the internet is not
    // there. Play itself goes through Steam.
    { icon: "play", label: "Play without Steam", hidden: !g.steam,
      run: g.steam && g.steam.direct ? function () { launchNow(g, null, true); } : null,
      tip: g.steam && g.steam.direct ? TIPS.playDirect : TIPS.playDirectOff },
    { icon: "info", label: "Details", hint: "I", run: function () { openDetails(); } },
    // The same picker the launch offers, reachable without launching:
    // choosing a save still plays from it, Esc just looks and leaves.
    { icon: "save", label: "Save States...", tip: TIPS.states, run: function () { openStates(g); }, hidden: !!g.local },
    // Its manual, maps and guides (js\docs.js), for a game that has any.
    { icon: "book", label: "Documents...", hint: "D", tip: TIPS.docs, run: function () { openDocs(g); }, hidden: !g.docs },
    { icon: g.favourite ? "starFill" : "star", label: g.favourite ? "Unfavourite" : "Favourite", tip: TIPS.fav, run: function () { toggleFav(g); } },
    // Your own labels: a list of switches, like Filter by.
    { icon: "tag", label: g.tags && g.tags.length ? "Tags (" + g.tags.length + ")..." : "Tags...",
      tip: TIPS.tags, run: function () { openTagMenu(g, x, y); } },
    { rule: true },
    { icon: "pencil", label: g.local ? "Edit Game..." : "Edit Metadata...", hint: "E", tip: g.local ? TIPS.editLocal : TIPS.editMeta, run: function () { g.local ? openLocalEditor(g) : openEditor(g); } },
    { icon: "image", label: "Change Pictures...", tip: TIPS.pictures, run: function () { openArtEditor(g); } },
    { icon: "image", label: "Paste as Box Art", tip: TIPS.pasteBox, run: function () { pasteBoxArt(g); } },
    { icon: "film", label: g.hasVideo ? "Replace Video..." : "Add Video...", tip: TIPS.video, run: function () { openVideoEditor(g); } },
    { icon: "disc", label: "Emulation", tip: TIPS.emulation, sub: emulation, hidden: !!g.local },
    { icon: "folder", label: "Show in Explorer", tip: TIPS.explorer, sub: explorer },
    { rule: true },
    { icon: "x", label: "Remove Game...", tip: TIPS.removeLocal, run: g.local ? function () { removeLocal(g); } : null, hidden: !g.local },
    { icon: "eyeOff", label: "Hide from Xsegon", tip: TIPS.hide, run: g.local ? null : function () { hideGame(g); }, hidden: !!g.local },
    // Not the same thing as hiding, and the dialog is where that is
    // explained. Last, on its own, and marked: it is the one entry here
    // that changes what your library IS.
    { icon: "trash", label: "Delete from Xsegon...", danger: true, tip: TIPS.del,
      run: g.local ? null : function () { confirmDelete(g); }, hidden: !!g.local },
  ], x, y, g.title);
}

// ---------- the menu bar (list and grid) ----------
/* Each menu is named for what is in it, so nothing has to be opened to find
   out. An entry not built yet is greyed as "planned", the same rule the
   game menu follows. */

var $mb = document.getElementById("mb");
// The bar's menus, left to right. Get Media between Games and Emulators is a window, not a menu (js\getmedia.js).
export var MB_ORDER = ["xsegon", "games", "emulators", "view", "arrange", "images", "badges", "help"];

function mbEntries(which) {
  // The round X: Xsegon itself. Its settings, the controller, the backup and the look.
  // Minimise and close are the window's own buttons, and are not said twice.
  if (which === "xsegon") {
    // Where the bar is not (a wheel, a carousel, rows), what it holds opens from here: each menu in a box beside its row, Get Media as its window.
    var menu = function (key, label, icon) { return { icon: icon, label: label, sub: function () { return withAdded(key, mbEntries(key)); } }; };
    var e = barButton("games") ? [] : [menu("games", "Games", "library"), { icon: "image", label: "Get Media...", tip: TIPS.getMedia, run: openGetMedia },
      menu("emulators", "Emulators", "disc"), menu("help", "Help", "info"), { rule: true }];
    e = e.concat([
      { icon: "gear", label: "Settings...", run: function () { openSettings(); } },
      { icon: "gamepad", label: "Controller...", tip: TIPS.controller, run: function () { openPadCheck(); } },
      { icon: "shield", label: "Back up what you made...", tip: TIPS.backup, run: openBackupTool },
      { icon: "phone", label: "Connect a phone...", tip: TIPS.phone, run: openPhone },
      { rule: true },
      { head: "Themes" }
    ]);
    // The look, a row a theme (js\themes.js), and a family of them folded into one row: the one in use wears the mark.
    var themeRow = function (t) { return { label: t.name + " theme", checked: t.id === themeId, tip: TIPS.theme, run: function () { setTheme(t.id); } }; };
    var kin = {};
    themeList().forEach(function (t) {
      if (t.family) { (kin[t.family] = kin[t.family] || []).push(t); } else { e.push(themeRow(t)); }
    });
    Object.keys(kin).forEach(function (family) {
      e.push({ icon: "folder", label: family + " themes", tip: TIPS.themeFamily, checked: kin[family].some(function (t) { return t.id === themeId; }),
               sub: function () { return kin[family].map(themeRow); } });
    });
    return e;
  }
  if (which === "games") {
    return [
      { icon: "plus", label: "Add Games...", tip: TIPS.add, run: openAddChooser },
      { icon: "search", label: "Scan for Games...", tip: TIPS.scan, run: openScanTool },
      // The games Steam has installed, as games of your own.
      { icon: "gamepad", label: "Add Steam games...", tip: TIPS.steam, run: function () { openSteamTool(); } },
      { icon: "refresh", label: "Bring in a LaunchBox library...", tip: TIPS.lbImport, run: bringInLaunchBox },
      { icon: "dice", label: "Surprise me", hint: "R", tip: TIPS.random, run: function () { randomGame(); } },
      { rule: true },
      // Here and never on a game's right-click menu: a bulk delete one stray
      // press away from a list of games happens by accident.
      { icon: "trash", label: "Missing Games...", tip: TIPS.missing, run: openMissingTool },
      { icon: "check", label: "Check game files...", tip: TIPS.fileCheck, run: openFileCheck },
      // The games that may be hacks and wait for your word, counted (js/hacksettle.js).
      { icon: "tag", label: "Hacks to settle" + (hackAsking() ? " (" + hackAsking() + ")" : "") + "...", tip: TIPS.hackSettle, run: openHackSettle },
      // The other way round: every game on record for a console that is not
      // in the library, to star and export as a wanted list (js/wanted.js).
      { icon: "star", label: "Games you do not have...", tip: TIPS.wanted, run: openWantedTool },
      // Hacks, mods and PC versions made from games you have (js/fanprojects.js), also a card on the consoles screen.
      { icon: "wand", label: "Fan projects...", tip: TIPS.fanProjects, run: openFanPage },
      // Programs Xsegon works with, Flashpoint first (js/extensions.js), also a card on the consoles screen.
      { icon: "download", label: "Extensions...", tip: TIPS.extensions, run: openExtPage }
    ];
  }
  if (which === "emulators") {
    return [
      { icon: "disc", label: "Open RetroArch", tip: TIPS.retroarch, run: openRetroArch },
      { icon: "disc", label: "BIOS check...", tip: TIPS.bios, run: openBiosCheck },
      { icon: "check", label: "Runs check...", tip: TIPS.runcheck, run: openRunCheck },   // which games boot: starts each one for a few seconds
      { rule: true },
      { icon: "plus", label: "Add an emulator...", tip: TIPS.emuAdd, run: function () { openEmuAdd(); } },
      { icon: "folder", label: "Move out of LaunchBox...", tip: TIPS.emuMove, hidden: !emusInLaunchBox, run: function () { openEmuMove(); } },
      { icon: "gear", label: "Emulator settings...", tip: TIPS.emuSettings, run: function () { openSettings("emulators"); } }
    ];
  }
  if (which === "help") {
    return [
      // First, because it is where someone new starts (js\setup.js).
      { icon: "sparkle", label: "Getting started...", tip: TIPS.guide, run: openGuide },
      { icon: "note", label: "What's new", tip: TIPS.whatsnew, run: openWhatsNew },
      { rule: true },
      { icon: "lines", label: "Show the log", hint: "L", tip: TIPS.log, run: openLogViewer },
      { icon: "shield", label: "Report a problem...", tip: TIPS.report, run: openReportTool },
      { icon: "folder", label: "Open the data folder", tip: TIPS.data, run: openDataFolder },
      { rule: true },
      // Also a card on the consoles screen, unless Settings > View put it away (js\tppage.js).
      { icon: "chat", label: "Help from Tumultuous Productions...", tip: TIPS.tumultuous, run: openTpPage },
      { icon: "info", label: "About Xsegon...", tip: TIPS.about, run: openAbout }
    ];
  }
  if (which === "view") {
    var views = { list: "List", grid: "Grid", shelf: "Shelf", wheel: "Wheel", carousel: "Carousel", rows: "Rows" };
    // Wheel, Carousel and the consoles screen wait for an emulator (js\viewlock.js): greyed, saying why.
    var v = Object.keys(views).map(function (k) {
      var waits = viewWaits(k);
      return { label: views[k], checked: view === k, tip: waits ? lockWords() : TIPS[k], run: waits ? null : function () { $viewsel.value = k; setView(k); } };
    });
    if (sysStage === "inside") {
      v.push({ rule: true }, { icon: "back", label: "Back to consoles", hint: "Esc", tip: viewsLocked() ? lockWords() : null,
                               run: viewsLocked() ? null : function () { backToWall(); } });
    }
    return v.concat([
      { rule: true },
      // The same list as the funnel in the search box, from where anyone
      // looking in View for "favourites only" would look.
      { icon: "filter", label: "Filter by...", hint: filterWords() || null, tip: TIPS.filter, run: openFilterWindow },
      { label: "Info panel beside the list", checked: !S.view || S.view.heroPanel !== false, tip: TIPS.hero, run: toggleHeroPanel },
      { label: "Platform sidebar", checked: !!(S.view && S.view.sidebar), tip: TIPS.sidebar, run: toggleSidebar },
      { label: "Striped rows", hint: view === "list" ? null : "list", checked: $body.classList.contains("list-stripes"), tip: TIPS.stripes, run: toggleListStripes },
      { label: "High contrast", hint: "C", checked: $body.classList.contains("high-contrast"), tip: TIPS.contrast, run: function () { toggleContrast(); } },
      { rule: true },
      // The gear on the strip over the grid and the shelf, and in the rows' corner, from the menu (js\viewsize.js).
      { icon: "gear", label: view === "shelf" ? "Shelf size..." : view === "rows" ? "Picture size..." : "Tile size...",
        hint: view === "grid" || view === "shelf" || view === "rows" ? null : "grid, shelf and rows",
        run: view === "grid" || view === "shelf" || view === "rows" ? function () { openSizer(); } : null },
      { label: "Show titles under tiles", hint: "planned", tip: TIPS.planned }
    ]);
  }
  if (which === "arrange") {
    var sorts = [["title", "Title"], ["developer", "Developer"], ["publisher", "Publisher"], ["genre", "Genre"], ["platform", "Platform"],
                 ["year", "Release date"], ["rating", "Rating"], ["myrating", "Your rating"], ["plays", "Play count"], ["playtime", "Most played"],
                 ["recent", "Recently played"], ["random", "Random"]];   // and, while it is in use, a sort only a list header sets
    if ($sort.value && !sorts.some(function (p) { return p[0] === $sort.value; })) { sorts.push([$sort.value, $sort.selectedOptions[0].textContent]); }
    return sorts.map(function (p) {
      return { label: p[1], checked: $sort.value === p[0], run: function () { setSort(p[0]); },
               tip: { myrating: TIPS.myrating, plays: TIPS.plays, playtime: TIPS.playtime, recent: TIPS.recent, random: TIPS.shuffle }[p[0]] };
    }).concat([
      { rule: true },
      { label: "Reverse the order", checked: !!(S.view && S.view.sortReverse),
        run: function () { setViewFlag("sortReverse", !(S.view && S.view.sortReverse)); } },
      { label: "Group under headers", checked: !!(S.view && S.view.groupHeaders), tip: TIPS.group,
        run: function () { setViewFlag("groupHeaders", !(S.view && S.view.groupHeaders)); } }
    ]);
  }
  if (which === "images") {
    var list = view === "list" || view === "shelf";
    return GRID_IMAGES.map(function (p) {
      // The list has no pictures (and the shelf only spines), so there the
      // choice says where it will show rather than seeming to do nothing.
      return { label: p[1], checked: gridImage() === p[0], hint: list ? "shows in grid" : "", tip: p[0] === "box" ? null : TIPS.noSuchPicture,
               run: function () { setGridImage(p[0]); } };
    });
  }
  /* Badges: each entry is a switch, selected while its mark is
     drawn. "No video" is the older video.markMissing setting, listed here
     because this is where anyone will look for it; the rest are
     view.badges, saved as one object because the settings API replaces a
     key whole rather than merging into it. */
  var bd = badgesOn(), all = badgesShown();
  // With Show badges off each mark keeps its own setting and waits, greyed: its card says why.
  var mark = function (label, key, tip, hint) {
    return { label: label, hint: hint, checked: !!bd[key], tip: all ? tip : TIPS.bWaits, run: all ? function () { setBadge(key); } : null };
  };
  return [
    { label: "Show badges", checked: all, tip: TIPS.bAll, run: toggleShowBadges },
    { rule: true },
    mark("Favourite", "favourite", TIPS.bFavourite),
    { label: "No video", checked: noVideoMarked(), tip: all ? TIPS.bNoVideo : TIPS.bWaits, run: all ? toggleNoVideoMark : null },
    mark("Recently played", "recent", TIPS.bRecent, "30 days"),
    mark("Never played", "unplayed", TIPS.bUnplayed),
    mark("Cannot launch", "dead", TIPS.bDead),
    mark("Edited in Xsegon", "edited", TIPS.bEdited),
    mark("Manual or guide", "docs", TIPS.bDocs),
    mark("Disc set, as a playlist", "discs", TIPS.bDiscs),
    mark("Disc set, one disc only", "onedisc", TIPS.bOneDisc),
    // Its own setting (view.showPlayers) because Settings > View shows it
    // too; the carousel and the wheel are where it is drawn.
    { label: "Player icons", hint: "carousel, wheel", checked: playersShown(), tip: all ? TIPS.bPlayers : TIPS.bWaits, run: all ? toggleShowPlayers : null }
  ];
}

/*  Clicking the player figures on a game: a small
    menu that keeps them or turns them off. Nothing else brings them back
    but Settings > View or Badges > Player icons, on purpose: a mark you
    turned off should not reappear to ask again. */
export function askPlayersIcon(e) {
  e.stopPropagation();                  // the game under it is not being clicked
  e.preventDefault();
  popupMenu([
    { icon: "check", label: "Keep", run: function () { L("SET", "showPlayers kept"); } },
    { icon: "eyeOff", label: "Turn off", tip: TIPS.playersOff, run: function () { setShowPlayers(false); } }
  ], e.clientX, e.clientY, "Player icons");
}

/* RetroArch on its own, for its settings, its cores and its controller
   mapping. The server starts it detached, like a game. */
function openRetroArch() {
  L("MNU", "open retroarch");
  api("api/retroarch.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    .then(function (r) {
      showStrip(r.ok ? "RetroArch is opening" : (r.error || "could not open RetroArch"), !r.ok);
    });
}

/* The same for every other emulator: the one this game runs in (api\emuopen.php). */
function openEmulator(g) {
  L("MNU", "open emulator " + g.emu + " (" + g.title + ")");
  api("api/emuopen.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: g.id }) })
    .then(function (r) {
      showStrip(r.ok ? g.emu + " is opening" : (r.error || "could not open " + g.emu), !r.ok);
    });
}

/* Everything Xsegon makes, in Explorer. */
function openDataFolder() {
  L("MNU", "open data folder");
  showInExplorer({ what: "data" }, "could not open the folder");
}

// What a bar menu hangs from: its button, or for Xsegon's own the wordmark where that stands in for the round X.
// None while the bar is not on screen, so the arrow keys in the wordmark's menu open no menu in a corner.
function barButton(which) {
  if (which === "xsegon" && $logo.classList.contains("as-orb")) { return $logo; }
  var b = $mb.querySelector('[data-menu="' + which + '"]');
  return b && b.getClientRects().length ? b : null;
}

// Entries another part adds to a bar menu, each after the entry it names (private\web adds its own).
var addedEntries = [];
export function addMenuEntry(which, after, entry) { addedEntries.push({ which: which, after: after, entry: entry }); }
function withAdded(which, entries) {
  addedEntries.forEach(function (a) {
    if (a.which !== which) { return; }
    var at = entries.findIndex(function (e) { return e.label === a.after; });
    entries.splice(at < 0 ? entries.length : at + 1, 0, a.entry);
  });
  return entries;
}

export function openBarMenu(which) {
  var btn = barButton(which);
  if (!btn) { return; }
  var r = btn.getBoundingClientRect();
  popupMenu(withAdded(which, mbEntries(which)), Math.round(r.left), Math.round(r.bottom + 2), null);
  mbOpen = which;
  $mb.querySelectorAll("button").forEach(function (b) { b.classList.toggle("open", b === btn); });
  $logo.classList.toggle("open", btn === $logo);
  if (btn === $logo) { logoTipDone("the logo's menu was opened"); }   // the tip has done its work (js\logotip.js)
}

// From the keyboard: open it beside whatever stands for the selected game.
export function openGameMenuAtSelection() {
  var n = null;
  if (view === "wheel" && wheelNodes) { n = wheelNodes[sel]; }
  else if (view === "carousel" && carNodes) { n = carNodes[sel]; }
  else if (view === "rows") { n = rowsNode(); }
  else { n = flatNodes[sel]; }
  var r = n ? n.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
  openGameMenu(sel, Math.round(r.left + Math.min(r.width / 2, 160)), Math.round(r.top + r.height / 2));
}

export function initMenus() {
  // Get Media is a window, not a menu: a click, so Enter and a controller's press open it too (js\padtop.js).
  var gm = document.getElementById("btn-getmedia");
  if (gm) {
    gm.title = TIPS.getMedia;
    gm.addEventListener("click", function () { closeGameMenu(); openGetMedia(); });
  }
  $mb.querySelectorAll("button[data-menu]").forEach(function (b) {
    // mousedown, not click: the document's own mousedown handler closes any
    // open popup first, and a click would then reopen the one just closed.
    b.addEventListener("mousedown", function (e) {
      e.stopPropagation();
      var which = b.dataset.menu;
      if (mbOpen === which) { closeGameMenu(); } else { openBarMenu(which); }
    });
    // With one menu open, sliding along the bar opens the others, as it does
    // in every desktop menu bar.
    b.addEventListener("mouseenter", function () {
      if (mbOpen && mbOpen !== b.dataset.menu) { openBarMenu(b.dataset.menu); }
    });
  });
  // The wordmark, while it is the round X (views.js paintSeg): the same press. Not the image's own drag.
  $logo.addEventListener("mousedown", function (e) {
    // Said, since a press that opens nothing leaves no other line (roadmap AZ14).
    if (!$logo.classList.contains("as-orb")) { L("CLK", "brand-logo: not the round X in this view, nothing opens"); return; }
    e.stopPropagation();
    e.preventDefault();
    if (mbOpen === "xsegon") { closeGameMenu(); } else { openBarMenu("xsegon"); }
  });

  // The funnel at the right end of the search box opens the Filter by window
  // (js\filterwin.js). mousedown for the same reason as the bar's buttons. Out
  // of the Tab order on purpose (index.php): Enter on a focused button would
  // also be Enter the game key, and play. The keys reach the window through
  // View > Filter by... (F10).
  var fb = document.getElementById("btn-filter");
  if (fb) {
    fb.appendChild(iconEl("qf-ico", "filter"));
    fb.appendChild(el("span", "qf-n"));
    fb.addEventListener("mousedown", function (e) {
      e.stopPropagation();
      e.preventDefault();
      closeGameMenu();
      openFilterWindow();
    });
    paintFilterButton();
  }
  // The x on the funnel's corner takes every filter off, and opens nothing.
  var fx = document.getElementById("btn-filter-clear");
  if (fx) {
    fx.addEventListener("mousedown", function (e) {
      e.stopPropagation();
      e.preventDefault();
      closeGameMenu();
      clearFilters();
    });
  }

  document.addEventListener("mousedown", function (e) {
    if ($ctx && !(e.target.closest && e.target.closest(".ctx"))) { closeGameMenu(); }
  });
  window.addEventListener("blur", closeGameMenu);
  window.addEventListener("resize", closeGameMenu);
  // A scroll elsewhere closes it; a scroll inside is a long list being read,
  // and must not.
  document.addEventListener("wheel", function (e) {
    if ($ctx && e.target.closest && e.target.closest(".ctx")) { return; }
    closeGameMenu();
  }, { passive: true });
}
