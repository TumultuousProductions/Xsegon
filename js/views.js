/*  The views and the moving about in them: the backdrop behind, the hero
    panel, the clock, the drawing of list, grid, shelf, wheel and carousel,
    and what a key does to the selection. The legend along the bottom is
    help.js, grabbing a wheel to turn it is drag.js, one spine is shelf.js,
    how big the grid and the shelf are drawn is viewsize.js. A view is a
    presentation of one model: all read the same rows, differing in render()
    and how far a press moves. */

import { measureChrome } from "./chrome.js";
import { dropDetails, openDetails } from "./details.js";
import { dragAte } from "./drag.js";
import { dropExtPage } from "./extensions.js";
import { dropFanPage } from "./fanprojects.js";
import { paintHelp, paintHelpHere } from "./help.js";
import { heroOn, paintHero, paintHeroArt } from "./hero.js";
import { artHint } from "./hint.js";
import { launch } from "./launch.js";
import { addedEmptyWords, anyFilter, capStrip, clearFilters, filterWords, libraryTotal, load } from "./library.js";
import { closePicker, listCells, listHead, listMinWidth, listPads, listTemplate, rowClass } from "./list.js";
import { L, LOG_MOVES } from "./log.js";
import { logoTip } from "./logotip.js";
import { askPlayersIcon, openGameMenu } from "./menus.js";
import { moreCut, moreFill, moreHold } from "./more.js";
import { noGamesBox } from "./nogames.js";
import { buildRows, rowsCur, rowsForget, rowsFresh, rowsIsCard, rowsPaint, rowsPaintArt, rowsPaintWords, rowsPick, rowsStale, rowsStep, rowsSync } from "./rows.js";
import { saveSetting } from "./savednote.js";
import { openGuide } from "./setup.js";
import { spineNode } from "./shelf.js";
import { paintSidebar, sidebarWanted } from "./sidebar.js";
import { armBrowse, stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $bdA, $bdB, $body, $clock, $details, $hero, $logo, $main, $toolbar, $view, $viewsel, S, games, sel, setSel, setViewMode, sysStage, view } from "./state.js";
import { backToWall, chooseSystem, renderSystems, sysStyle } from "./systems.js";
import { artUrl, badgeClasses, badgesEl, el, fixMark, platformBeside, playersIcon, titleText } from "./util.js";
import { lockRefuses, viewWaits } from "./viewlock.js";
import { gridImage, sortHeader, tileKind } from "./viewset.js";
import { closeSizer, sizeButton, syncSizer } from "./viewsize.js";
import { carouselSpin, wheelDress, wheelSpin } from "./wheelfx.js";

/* What the hand is allowed to do (Settings > Xsegon Controls > Xsegon (Mouse and
   keyboard)). Read through one helper so a missing key means the default. */
var CTL = S.controller || {};
export function ctl(key, dflt) { return CTL[key] === undefined ? dflt : CTL[key]; }

// ---------- the live backdrop ----------
/* The selected game's art, huge and blurred, behind everything, so the whole
   screen answers the selection. Two images alternate so every change is a
   crossfade. The 140ms debounce matters: holding a direction walks the list at
   repeat speed, and an image per step would queue dozens of loads. */

var bdTimer = null, bdLast = "", bdFlip = false;
var $bdWrap = document.querySelector(".backdrop");

/* scene=true is the systems wall's voice: the same crossfade but bigger and
   clearer, scenery to look at rather than a wash behind text. */
export function paintBackdropUrl(url, scene) {
  if (!$bdA || $body.classList.contains("no-backdrop")) { return; }
  clearTimeout(bdTimer);
  bdTimer = setTimeout(function () {
    if ($bdWrap) { $bdWrap.classList.toggle("scene", !!scene); }
    if (url === bdLast) { return; }
    bdLast = url;
    var show = bdFlip ? $bdA : $bdB, hide = bdFlip ? $bdB : $bdA;
    bdFlip = !bdFlip;
    show.onload = function () { show.classList.add("on"); hide.classList.remove("on"); };
    show.onerror = function () { if (bdLast === url) { bdLast = null; } }; show.src = url;   // a failed picture must not pin the old scenery; quiet, offline fires a lot
  }, 140);
}

function paintBackdrop(g) {
  if (!g || !g.hasArt) { return; }        // keep the last art; never flash to black
  paintBackdropUrl(artUrl(g, "box"), false);
}

// The info panel beside the list and the wheel is hero.js.

// ---------- the clock ----------

export function tickClock() {
  if (!$clock) { return; }
  if (S.feel && S.feel.clock === false) { $clock.textContent = ""; return; }
  var d = new Date();
  $clock.textContent = String(d.getHours()).padStart(2, "0") + ":" +
                       String(d.getMinutes()).padStart(2, "0");
}

// ---------- rendering ----------

/* Keep the dropdown honest: it names what is ON SCREEN. On the consoles screen
   that is the screen's own shape, wheel or carousel; elsewhere the game view.
   What a console opens into is the legend's to say ("Enter  open in list"). */
export function paintSeg() {
  var shown = sysStage === "wall" ? sysStyle() : view;
  if ($viewsel && $viewsel.value !== shown) { $viewsel.value = shown; }
  // Where the menu bar is not, the wordmark stands in for its round X (js\menus.js).
  if ($logo) { $logo.classList.toggle("as-orb", shown === "wheel" || shown === "carousel" || shown === "rows"); }
  logoTip();                               // beside it until it has been opened once (js\logotip.js)
}

/* The games area emptied while the rows for somewhere new are on their way,
   or leaving the consoles screen uncovers whatever the view drew LAST under a
   dropdown already naming the new view. The box says loading (a ::before, so
   no node is mistaken for the new view's first row); render() fills it. */
// The view says loading: the list held is the one before, and none of it is on screen.
export function viewPending() { return $view.className === "pending"; }

export function clearView() {
  if ($details.hidden) { stopVideo(); }
  moreHold();                              // nothing to add to until the next list is drawn (more.js)
  wheelNodes = null;
  carNodes = null;
  flatNodes = [];
  closePicker();
  $view.textContent = "";
  $view.className = "pending";
  $view.style.removeProperty("--cols");
  $view.style.removeProperty("--colsw");
  $hero.hidden = true;
}

export function render() {
  // A detached <video> keeps playing its sound, so it is stopped before the
  // view is rebuilt under it. Not while details is open: that snap is its.
  if ($details.hidden) { stopVideo(); }
  $toolbar.classList.toggle("as-menubar", view === "list" || view === "grid" || view === "shelf");
  artHint();                               // the pictures hint under Get Media, when it is due (hint.js)
  if ((view !== "grid" && view !== "shelf" && view !== "rows" && view !== "list") || !games.length) { closeSizer(); }   // its gear is about to go
  paintSeg();
  var hero = heroOn();
  $main.className = "main" + (hero ? " with-hero" : "") +
                    (view === "wheel" ? " wheelmode" : "") +
                    (sidebarWanted() ? " with-sidebar" : "");
  // While the sidebar shows it is the platform picker, and the dropdown on
  // the bar gives way to it: the stylesheet does that, since it also knows
  // the width below which the sidebar folds away and the dropdown is back.
  $body.classList.toggle("with-sidebar", sidebarWanted());
  $hero.hidden = !hero;
  // List, grid and wheel stand in the space between the bars and the legend
  // and scroll inside it, so the page itself has nothing to scroll (the
  // stylesheet's --fill-h). The carousel keeps its own rule.
  $body.classList.toggle("on-fill", (view !== "carousel" || !games.length) && sysStage !== "wall");
  paintSidebar();                          // the consoles down the left, when asked for

  if (!games.length) {
    $view.textContent = "";
    $view.className = "list";
    $hero.hidden = true;
    // The sidebar keeps its column with nothing to show: with the dropdown
    // given way to it, it is the only road to another console from here.
    $main.className = "main" + (sidebarWanted() ? " with-sidebar" : "");
    // No games at all is not "nothing matches": it says so, and how to get some.
    if (libraryTotal === 0) { $view.appendChild(noGamesBox(null, openGuide)); return; }
    // Empty because of a filter, it says which, with the way to put them
    // back: the bare "nothing matches" read as a console with no games.
    if (anyFilter()) {
      var box = el("div", "empty", "nothing here with the filter on: " + filterWords() + " ");
      var clear = el("button", "empty-clear", "Clear filters");
      clear.type = "button";
      clear.addEventListener("click", function () { clearFilters(); });
      box.appendChild(clear);
      $view.appendChild(box);
    } else {
      // An empty Recently added says why, not "nothing matches".
      $view.appendChild(el("div", "empty", addedEmptyWords() || "nothing matches"));
    }
    return;
  }

  if (view !== "rows") { rowsForget(); }
  if (view === "rows") {
    wheelNodes = null;
    carNodes = null;
    flatNodes = [];
    closePicker();
    $view.style.removeProperty("--cols");
    $view.style.removeProperty("--colsw");
    $view.className = "rowsview";
    if (!rowsFresh()) { buildRows(wireRowCard, sizeButton()); } else { rowsSync(); }   // with the gear for their size, in the band's corner (viewsize.js)
    rowsPaint();
    rowsPaintArt(games[sel]);
    rowsPaintWords(games[sel]);
    syncSizer();                           // an open size window stays on the new band's gear
    // The rest of a long list comes in as games alone, and the rows are made again once, when all are in (more.js).
    moreFill(null, function () { if (view === "rows") { rowsStale(); render(); } });
  } else if (view === "wheel") {
    carNodes = null;
    $view.className = "wheelbox"; $view.scrollTop = $view.scrollLeft = 0;   // no scroll left by the list (css .wheelbox)
    if (!wheelNodes) { buildWheel(); }
    updateWheel();
    moreFill(function (g, i) { wheelNodes.push(wheelPlate(g, i)); if (i - sel <= WHEEL_SHOW) { updateWheel(); } });
  } else if (view === "carousel") {
    wheelNodes = null;
    $view.className = "gcarousel";
    if (!carNodes) { buildCarousel(); }
    updateCarousel();
    moreFill(function (g, i) { carNodes.push(carCard(g, i)); if (i - sel <= 7) { updateCarousel(); } });
  } else {
    wheelNodes = null;
    carNodes = null;
    var strip = capStrip(), gear = sizeButton();             // what is shown and how many, over the table (library.js)
    if (gear) { strip.appendChild(gear); }                   // and the gear: the grid's and the shelf's size, the list's rows (viewsize.js)
    $view.textContent = ""; $view.appendChild(strip);
    // grid-<kind>: screenshots and fanart are landscape, so the tiles widen.
    // The shelf is drawn here too: a flat run of games, like the other two.
    $view.className = view === "grid" ? "grid grid-" + gridImage() : view;
    /* The table's shape: one template, read by the header and every row.
       The column picker is NOT closed here: it lives on the body, and selecting
       a column redraws the list, so closing it would shut it at every use. It
       only closes when the list itself goes. */
    if (view === "list") {
      $view.style.setProperty("--cols", listTemplate());
      // and how wide the table has to be for them, so the box scrolls
      // sideways to the columns that do not fit rather than losing them.
      $view.style.setProperty("--colsw", listMinWidth() + "px");
      var head = listHead(sortHeader, render);
      $view.appendChild(head);
      // The header is stuck to the top of the box, so a row brought into
      // view going up stops under it rather than behind it.
      $view.style.setProperty("--lhead-h", head.offsetHeight + "px");
    } else {
      closePicker();
      $view.style.removeProperty("--cols");
      $view.style.removeProperty("--colsw");
      $view.classList.remove("xscroll");
    }
    // A header wherever the arranged-by value changes (the server labels each
    // row). flatNodes is the games alone, in order: with headers between, the
    // Nth child is not the Nth game, so finding a game's node goes through this.
    flatNodes = [];
    flatGroup = null;
    flatHeads = {};
    moreCut();                             // a long list: nodes for its first lot now, the rest as it goes (more.js)
    games.forEach(addFlat);
    moreFill(function (g, i) {
      var was = flatGroup;
      addFlat(g, i);
      // Added under a header already standing: every header of that label counts it.
      if (g.group !== undefined && was === g.group) { headCount(flatHeads[was], flatHeads[was].n + 1); }
    });
    var cur = flatNodes[sel];
    if (cur && cur.scrollIntoView) { cur.scrollIntoView({ block: "nearest" }); }
    syncSizer();                           // an open size window stays on the new strip's gear
  }

  // The carousel is one screenful, like the consoles screen: nothing below
  // it to scroll to, and a page that scrolls would drift it off centre.
  $body.classList.toggle("on-carousel", view === "carousel" && sysStage !== "wall");

  // The screen answers the move: panel and backdrop follow the selection.
  paintHero(games[sel]);
  paintBackdrop(games[sel]);
  measureChrome();                       // the stage may have just appeared or gone
  armBrowse();
}

// One game's node in the list, the grid or the shelf, with a header before it wherever the arranged-by value changes.
var flatGroup = null;                   // the label the last game stands under
var flatHeads = {};                     // by label: how many games carry it, and the count's node in each header that names it
function headCount(hd, n) { hd.n = n; hd.at.forEach(function (s) { s.textContent = String(n); }); }
function addFlat(g, i) {
  if (g.group !== undefined && g.group !== flatGroup) {
    flatGroup = g.group;
    var h = el("div", "ghead"), hd = flatHeads[g.group] || (flatHeads[g.group] = { n: 0, at: [] });
    h.appendChild(el("span", "ghead-name", g.group));
    hd.at.push(h.appendChild(el("span", "ghead-n", "")));
    headCount(hd, games.filter(function (x) { return x.group === g.group; }).length);
    $view.appendChild(h);
  }
  var n = view === "grid" ? tile(g, i) : view === "shelf" ? wireGame(spineNode(g, i === sel), i) : row(g, i);
  flatNodes.push(n);
  $view.appendChild(n);
}

// ---------- the wheel ----------
/* Titles on an arc that turns past a fixed point, the chosen one largest.
   Every node pivots around a point far off the edge, so a change of rotation
   IS the turn. The nodes are built once per games array and only their
   transforms change on a move, so CSS swings them; a rebuild would snap. */

export var wheelNodes = null;
export function setWheelNodes(v) { wheelNodes = v; }
var WHEEL_ARC = 7.5, WHEEL_GAP = 5;     // degrees between plates, and more either side of the chosen one (css .witem.sel is 1.5x)
var WHEEL_SHOW = 7;                     // how many are drawn either side

function buildWheel() {
  $view.textContent = ""; wheelDress($view);   // the light that turns round the hole (wheelfx.js)
  moreCut();                                   // a long list: plates for its first lot now, the rest as it goes (more.js)
  wheelNodes = games.map(wheelPlate);
}

// One game's plate, hidden until the wheel turns it near.
function wheelPlate(g, i) {
  var n = el("div", "witem" + (g.favourite ? " fav" : "") + (g.playable ? "" : " dead") + (g.hasVideo ? "" : " novid") + (g.cheats ? " cheaton" : ""));
  n.hidden = true;
  // The name first, the Clear Logo once it arrives: a plate sized by an unloaded
  // image is a zero-area box.
  var wt = el("span", "t", titleText(g)); n.appendChild(wt);
  if (g.hasLogo) {
    n.classList.add("has-logo");   // the no-video mark hangs off the picture
    var img = el("img", "wlogo"); img.decoding = "async";
    img.onload = function () { wt.remove(); };
    img.onerror = function () { img.remove(); n.classList.remove("has-logo"); };
    img.src = artUrl(g, "logo");
    img.alt = g.title;
    n.appendChild(img);
  }
  var wp = playersIcon(g, "witem-pl");      // figures for how many can play, the plate's top right
  if (wp) { wp.addEventListener("click", askPlayersIcon); n.appendChild(wp); }   // keep or turn off
  wireGame(n, i);
  $view.appendChild(n);
  return n;
}

function updateWheel() {
  wheelNodes.forEach(function (n, i) {
    var d = i - sel;
    if (Math.abs(d) > WHEEL_SHOW) {
      if (!n.hidden) { n.hidden = true; n.classList.remove("wnear"); }
      return;
    }
    n.hidden = false; n.classList.add("wnear");   // css styles a fast spin by this, not .witem: the 15 on show, not the library
    // Pivot is off the RIGHT edge, so the sign flips: minus turns later
    // games downward, the way the reference wheel hangs.
    // No scale on the chosen plate: it is bigger by its size (css), since a scale would swing it round the far-off pivot.
    n.style.transform = "translateY(-50%) rotate(" + (d * -WHEEL_ARC - Math.sign(d) * WHEEL_GAP) + "deg)";
    n.style.opacity = String(1 - Math.abs(d) * 0.09);
    n.style.zIndex = String(100 - Math.abs(d));
    n.classList.toggle("sel", d === 0);
  });
}

// ---------- the game carousel ----------
// The gallery, for games: box art cards turning in 3D, the chosen one
// facing you. Same persistent-node contract as the wheel.

export var carNodes = null;
export function setCarNodes(v) { carNodes = v; }
export var flatNodes = [];                     // list and grid: the game nodes, headers excluded

function buildCarousel() {
  $view.textContent = "";
  moreCut();                                   // a long list: cards for its first lot now, the rest as it goes (more.js)
  carNodes = games.map(carCard);
}

// One game's card, hidden until the carousel turns it near.
function carCard(g, i) {
  var n = el("div", "gcard" + (g.favourite ? " fav" : "") + (g.playable ? "" : " dead") + (g.hasVideo ? "" : " novid") + (g.cheats ? " cheaton" : ""));
  n.hidden = true;
  if (g.hasArt) {
    var img = el("img", "gcard-art");
    img.src = artUrl(g, "box");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    n.appendChild(img);
  } else {
    n.appendChild(el("div", "hero-noart", "NO ART"));
  }
  var cap = el("div", "gcard-cap", titleText(g));
  platformBeside(cap, g);
  cap.appendChild(badgesEl(g));
  n.appendChild(cap);
  var gp = playersIcon(g, "gcard-pl");      // figures for how many can play, under the title
  if (gp) { gp.addEventListener("click", askPlayersIcon); n.appendChild(gp); }
  wireGame(n, i);
  $view.appendChild(n);
  return n;
}

function updateCarousel() {
  carNodes.forEach(function (n, i) {
    var d = i - sel, far = Math.abs(d) > 4;                  // four either side show; three more are kept, unseen
    if (Math.abs(d) > 7) {
      if (!n.hidden) { n.hidden = true; n.classList.remove("cnear"); }
      return;
    }
    n.hidden = false; n.classList.add("cnear");  // so a fast run slides them in and out, evenly, never popping (wheelfx.js carouselSpin)
    n.style.transform = "translate(-50%, -50%) translateX(" + (d * 250) + "px)" +
                        " rotateY(" + (Math.max(-4, Math.min(4, d)) * -32) + "deg)" +
                        " scale(" + (d === 0 ? 1 : 0.68) + ")";
    n.style.opacity = String(d === 0 ? 1 : far ? 0 : 0.4);
    n.style.zIndex = String(50 - Math.abs(d));
    n.classList.toggle("sel", d === 0);
  });
}

/* The mouse contract, everywhere a game can be clicked: click chooses, clicking
   the chosen one opens DETAILS, right-click opens the game menu. Only its Play,
   details' Play, or Enter launches: a misclick must never boot a game. */
function gameClick(i) {
  if (dragAte()) { return; }
  if (sel !== i) { goTo(i); return; }
  // The second click on the same game. Details by default, because it is
  // the one that cannot be undone by pressing Esc.
  var what = ctl("clickChosen", "details");
  if (what === "play") { launch(); }
  else if (what !== "nothing") { openDetails(); }
}

/* The rows view's cards: the same contract, except that a game can be on
   screen twice, so "the chosen one" is the card, not the game. */
function wireRowCard(n, i, r, c) {
  n.addEventListener("click", function () {
    if (!rowsIsCard(r, c)) { rowsPick(r, c); rowsMoved(); return; }
    var what = ctl("clickChosen", "details");
    if (what === "play") { launch(); }
    else if (what !== "nothing") { openDetails(); }
  });
  n.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    if (!rowsIsCard(r, c)) { rowsPick(r, c); rowsMoved(); }
    openGameMenu(i, e.clientX, e.clientY);
  });
}

/* A step in the rows view: dx along a row, dy between rows (Infinity for
   the row's ends). The keys and the pad call this instead of move(). */
export function navRows(dx, dy) {
  if (!games.length || rowsStep(dx, dy) < 0) { return; }
  rowsMoved();
}

function rowsMoved() {
  setSel(rowsCur());
  stopVideo();
  sound("move");
  rowsPaint();
  rowsPaintArt(games[sel]);
  var band = document.querySelector(".rows-band");
  settle(band, function () { rowsPaintWords(games[sel]); armBrowse(); });
  paintBackdrop(games[sel]);
}

function wireGame(n, i) {
  fixMark(n, games[i]); n.addEventListener("click", function () { gameClick(i); });   // every view's card, so NEEDS FIX shows on them all
  n.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    openGameMenu(i, e.clientX, e.clientY);
  });
  return n;
}

export function row(g, i) {
  var n = el("div", rowClass(g, i));
  listCells(g).forEach(function (cell) { n.appendChild(cell); });
  // The empty tracks at the end: the hamburger's always, and the one that
  // takes the slack once Title has been dragged to a width of its own.
  // listPads() says how many, so the row and the header cannot disagree.
  for (var p = 0; p < listPads(); p++) { n.appendChild(el("span", "cell pad")); }
  wireGame(n, i);
  return n;
}

function tile(g, i) {
  var n = el("div", "tile" + (i === sel ? " sel" : "") +
                    (g.favourite ? " fav" : "") + (g.playable ? "" : " dead") + (g.hasVideo ? "" : " novid") + (g.cheats ? " cheaton" : "") +
                    badgeClasses(g));
  n.appendChild(badgesEl(g));              // bottom right; the star and the clapperboard keep the top
  var kind = tileKind(g);
  if (kind) {
    // as-<kind> is the art actually shown, so a tile that fell back to its
    // box is framed as a box even in a grid of screenshots.
    // A cartridge or a disc comes from data\extras, with its own address on the row.
    var img = el("img", "shot as-" + kind);
    img.src = kind === "medium" ? g.medium.url : artUrl(g, kind);
    img.alt = g.title;
    img.loading = "lazy";          // hundreds of tiles: fetch what is on screen
    img.decoding = "async";
    n.appendChild(img);
  } else {
    n.appendChild(el("div", "noart", "NO ART"));
  }
  var cap = el("div", "cap", titleText(g));
  platformBeside(cap, g);
  n.appendChild(cap);
  wireGame(n, i);
  return n;
}

/* How many tiles fit on a row, measured rather than assumed. The grid is
   auto-fill so the answer changes with the window, and Up/Down have to move
   by whatever it currently is. */
export function columns() {
  if ((view !== "grid" && view !== "shelf") || !flatNodes.length) { return 1; }
  // The widest row, not the first: with group headers a group can end after
  // one tile, and the first row is then no guide to the grid's width.
  var counts = {}, best = 1;
  for (var i = 0; i < flatNodes.length && i < 400; i++) {
    var t = flatNodes[i].offsetTop;
    counts[t] = (counts[t] || 0) + 1;
    if (counts[t] > best) { best = counts[t]; }
  }
  return best;
}

/* Up and Down in the grid, by where the tiles ARE: group headers make rows
   ragged, so counting columns lands wrong. Takes the next row's tile nearest
   the current one's column. Returns the distance to move. */
export function rowStep(sign) {
  if (view !== "grid" && view !== "shelf") { return sign; }
  var cur = flatNodes[sel];
  if (!cur) { return sign; }
  var top = cur.offsetTop, left = cur.offsetLeft, rowTop = null, best = -1, bestGap = Infinity;
  for (var i = sel + sign; i >= 0 && i < flatNodes.length; i += sign) {
    var n = flatNodes[i];
    if (n.offsetTop === top) { continue; }            // still on this row
    if (rowTop === null) { rowTop = n.offsetTop; }
    if (n.offsetTop !== rowTop) { break; }            // past the target row
    var gap = Math.abs(n.offsetLeft - left);
    if (gap < bestGap) { bestGap = gap; best = i; }
  }
  // No further row: run to the end, as Down on the last row always has.
  return best === -1 ? (sign > 0 ? flatNodes.length - 1 - sel : -sel) : best - sel;
}

export function move(delta) {
  if (!games.length) { return; }
  var next = Math.max(0, Math.min(games.length - 1, sel + delta));
  // Past the end, round to the other one, if that is what you asked for.
  if (next === sel && ctl("arrowsWrap", false) && delta !== 0) {
    next = delta > 0 ? 0 : games.length - 1;
  }
  if (next === sel) { return; }
  goTo(next);
}

/* The selection moves to game i, by a key, the wheel, a drag or a click, without
   drawing the view again: a redraw replays every tile's arrival. */
function goTo(next) {
  var prev = sel;
  setSel(next);
  stopVideo();                           // a switch was made: artwork back, now
  sound("move");
  // The wheel turns in place rather than re-rendering: same nodes, new
  // transforms, and the CSS transition does the swing.
  if (view === "wheel" && wheelNodes && wheelNodes.length === games.length) {
    updateWheel(); wheelSpin($view, sel - prev);
    settle($hero, function () { paintHero(games[sel]); armBrowse(); }, function () { paintHeroArt(games[sel]); });
    paintBackdrop(games[sel]);
    return;
  }
  if (view === "carousel" && carNodes && carNodes.length === games.length) {
    updateCarousel(); carouselSpin($view, sel - prev);
    paintBackdrop(games[sel]);
    armBrowse();
    return;
  }
  // List, grid and shelf move the highlight, they do not rebuild 500 rows
  // per keypress: that rebuild was most of the judder when a key was held.
  if ((view === "list" || view === "grid" || view === "shelf") && flatNodes.length === games.length) {
    if (flatNodes[prev]) { flatNodes[prev].classList.remove("sel"); }
    var cur = flatNodes[sel];
    cur.classList.add("sel");
    if (cur.scrollIntoView) { cur.scrollIntoView({ block: "nearest" }); }
    settle($hero, function () { paintHero(games[sel]); armBrowse(); }, function () { paintHeroArt(games[sel]); });
    paintBackdrop(games[sel]);
    return;
  }
  render();
}

/* Fast scrolling: the wheel keeps up with every notch, the words beside it do
   not try to. A single step paints at once; a run blurs the words and pictures
   (.holding), waits for the selection to rest, then paints once. Only those:
   fading the whole panel makes it vanish and return on a fast scroll.
   A run lasts until the selection rests, not by the gap since the last step,
   since a mouse wheel's notches are uneven. Each panel keeps its own run
   (target._settle): one shared timer can leave a panel faded out. */
/* quick: the part that keeps up, drawn on every step even at speed (the
   picture, a small thumbnail usually fetched already); only the rest waits. */
export function settle(target, paint, quick) {
  var now = Date.now();
  var run = target._settle || (target._settle = { t: null, at: 0 });
  var fast = run.t !== null || now - run.at < 170;
  run.at = now;
  clearTimeout(run.t); run.t = null;
  if (!fast) {
    target.classList.remove("holding");
    paint();
    logSel();
    return;
  }
  if (quick) { quick(); }
  target.classList.add("holding");
  run.t = setTimeout(function () {
    run.t = null;
    paint();
    target.classList.remove("holding");
    logSel();
  }, 190);
}
// The game you came to rest on. One line per rest, not per notch: holding
// a key through fifty games is one SEL, where you stopped.
var lastSelLogged = -1;
function logSel() {
  if (!LOG_MOVES || sel === lastSelLogged || !games[sel]) { return; }
  lastSelLogged = sel;
  var g = games[sel];
  L("SEL", sel + "/" + games.length + " " + g.title + " [" + g.platform + "]" + (g.hasVideo ? " vid" : "") + (g.playable ? "" : " DEAD"));
}

export function setView(next) {
  // Wheel and Carousel wait for an emulator (js\viewlock.js): the dropdown goes back to what is on screen.
  if (viewWaits(next)) { lockRefuses("the view " + next); paintSeg(); return; }
  L("VW", view + " -> " + next + (sysStage === "wall" ? " (on the wall)" : ""));
  dropDetails();                         // a new view is never drawn under details
  dropFanPage();                         // nor under the Fan projects page: the screen it covered comes back to change
  dropExtPage();                         // nor under the Extensions page
  setViewMode(next);
  var payload = { "default": next };

  if (sysStage === "wall") {
    // On the wall the dropdown is never a silent no-op. Wheel and Carousel are
    // one idea on both screens, so the choice restyles the wall NOW and the game view after.
    if (next === "wheel" || next === "carousel") {
      S.view = S.view || {};
      S.view.systemsStyle = next;
      payload.systemsStyle = next;
      renderSystems();
      paintSeg();
      paintHelp("systems");              // a console now opens in the shape on screen
    } else {
      // List and grid have no wall shape, so the choice opens the library in
      // that view, every platform at once. chooseSystem paints the dropdown
      // once the wall has gone, so it never names the wall's shape over a list.
      saveSetting({ view: payload }, "The view");
      chooseSystem("");
      return;
    }
  } else if (sysStage === "inside" && (next === "wheel" || next === "carousel")) {
    // Wheel and carousel are a whole journey, not just a game view: the
    // switch starts it over, so the platform is picked again in the new
    // shape before its games open in it.
    S.view = S.view || {};
    S.view.systemsStyle = next;
    payload.systemsStyle = next;
    setSel(0);
    backToWall();
  } else {
    setSel(0);
    // Drawn NOW, in the new shape. Group labels are only sent for list and
    // grid, so with headers on the rows are read again too, after the redraw:
    // waiting for them leaves the old view standing under the new name.
    render();
    paintHelpHere();                     // the rows view's arrows go four ways
    if (S.view && S.view.groupHeaders) { load(); }
  }
  // Stored, not just toggled.
  saveSetting({ view: payload }, "The view");
}
