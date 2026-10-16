import { openPlatformArtEditor } from "./art-editors.js";
import { measureChrome } from "./chrome.js";
import { dropDetails } from "./details.js";
import { dragAte } from "./drag.js";
import { FAN_KEY, dropFanPage, openFanPage } from "./fanprojects.js";
import { openFilterWindow } from "./filterwin.js";
import { paintHelp } from "./help.js";
import { showStrip } from "./launch.js";
import { addedPeriods, collectionCount, collectionsAll, consoleCounts, filterWords, libraryTotal, load, periodOf, platformArtUrl, platformsAll, setPeriod, sysShow } from "./library.js";
import { L, logWarn } from "./log.js";
import { TIPS } from "./menu-tips.js";
import { popupMenu } from "./menus.js";
import { noGamesBox } from "./nogames.js";
import { openGuide } from "./setup.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $body, $btnSystems, $main, $platform, $syswall, $toolbar, S, setSysStage, view } from "./state.js";
import { artUrl, el } from "./util.js";
import { lockRefuses } from "./viewlock.js";
import { clearView, ctl, paintBackdropUrl, paintSeg, settle } from "./views.js";
import { carouselSpin } from "./wheelfx.js";

// ---------- the systems carousel ----------
/* The platforms as big cards turning in 3D, the chosen one facing you. Pick
   one and it opens into the game view the dropdown says; Esc brings the wall
   back. Cards carry the platform's own art (api\image.php?platform=), falling
   back to a showcase game's box. The turn is a transform transition, never a rebuild. */

export var sysList = [];
var sysNodes = [];
export var sysSel = 0;
export function setSysSel(v) { sysSel = v; }

function buildSysList() {
  // With a filter on, only the consoles that have something passing it,
  // counted that way (consoleCounts in library.js).
  var counts = consoleCounts();
  sysList = Object.keys(counts).sort().map(function (name) {
    return { name: name, count: counts[name], show: sysShow[name] || null };
  });
  // The collections ride the rim after the consoles: Favourites, Recently
  // played, Never played. Each is a rim entry like a console, with its own
  // icon (data\platform-art) and the top favourite's scenery behind it.
  collectionsAll.forEach(function (c) {
    var n = collectionCount(c);
    // Only a filter can empty one here: the server leaves out a
    // collection with nothing in it, bar the one that says why.
    if (!n && !c.note) { return; }
    sysList.push({ name: c.key, label: c.label, count: n, show: sysShow[c.key] || null,
                   collection: true, note: c.note || null });
  });
  // Fan projects rides last: a page of its own, not a list of games (js\fanprojects.js).
  sysList.push({ name: FAN_KEY, label: "Fan projects", count: 0, show: null, collection: true, fan: true, note: null });
  if (sysSel >= sysList.length) { sysSel = 0; }
}

/* A filter changes which consoles the wall holds, so it is built again in
   place, staying on the console you were on while that one is still
   there, or on the one that took its place when it stepped aside. */
export function repaintWall() {
  var was = sysList[sysSel] ? sysList[sysSel].name : null;
  var at = sysSel;
  buildSysList();
  var i = sysList.findIndex(function (p) { return p.name === was; });
  sysSel = i >= 0 ? i : Math.max(0, Math.min(at, sysList.length - 1));
  renderSystems();
}

// "34 games", or "12 games · 2+ players" while a filter is on: the number
// is only honest with its condition beside it.
function countLabel(p) {
  if (p.fan) { return "Hacks, mods and PC versions"; }
  if (p.note) { return p.note; }         // an empty collection says why instead of "0 games"
  var words = filterWords();
  return p.count + (p.count === 1 ? " game" : " games") + (words ? " · " + words : "");
}

export function enterSystems() {
  if (!platformsAll) {
    // The first load has not answered (or failed): logged, or a blank
    // consoles screen has no explanation anywhere.
    logWarn("the consoles screen was asked for before the library answered; waiting for the next load");
    return;
  }
  L("NAV", "the wall, " + sysStyle());
  dropDetails();                         // nothing of a game's stays over the consoles
  dropFanPage();                         // nor the Fan projects page
  stopVideo();
  setSysStage("wall");
  buildSysList();
  $platform.value = "";
  $main.hidden = true;
  $toolbar.hidden = true;
  $syswall.hidden = false;
  $body.classList.add("on-wall");
  renderSystems();
  paintSeg();
  paintHelp("systems");
}

export function backToWall() {
  // The consoles screen has a wheel's or a carousel's shape: it waits with them (js\viewlock.js).
  if (lockRefuses("the consoles screen")) { return; }
  L("NAV", "back to the wall from " + ($platform.value || "all"));
  dropDetails();
  dropFanPage();
  stopVideo();
  // Built here too, not only on the way in: the wall can be reached without
  // ever having been entered (opening on every game in List or Grid, or the
  // mailbox's "show these games"), and would come up EMPTY.
  var from = $platform.value;
  buildSysList();
  // Back onto the console you were in. The rim can change while you are
  // inside (a filter takes consoles off it), and the place you left, kept
  // as a number, is then some other console.
  var at = sysList.findIndex(function (p) { return p.name === from; });
  if (at >= 0) { sysSel = at; }
  setSysStage("wall");
  $platform.value = "";
  $main.hidden = true;
  $toolbar.hidden = true;
  $syswall.hidden = false;
  $body.classList.add("on-wall");
  sound("back");
  renderSystems();
  paintSeg();
  paintHelp("systems");
  load({ noDraw: true });               // the lists and counts, quietly; no games drawn out of sight
}

/* name: a platform, a collection (@favourites...), or "" for every game.
   "" is how List and Grid open from the consoles screen: they have no wall
   shape, so they open the whole library and the back arrow goes back. */
export function chooseSystem(name) {
  if (name === FAN_KEY) { openFanPage(); return; }
  // An empty collection stays on the rim, greyed, so it can explain its
  // rule instead of vanishing and reading as broken. Opening it would show
  // nothing; the answer is the rule, from every door that leads here.
  for (var ci = 0; ci < collectionsAll.length; ci++) {
    var c = collectionsAll[ci];
    if (c.key === name && !c.count) {
      L("NAV", "refused empty " + name);
      // Recently added and Recently changed can look further back, and their menus are the way from here.
      var wider = periodOf(name) && periodOf(name) !== "year" ? ". Its menu (right-click, or Y) looks further back" : "";
      showStrip(c.label + ": " + (c.note || "nothing in it yet") + wider, false);
      sound("back");
      return;
    }
  }
  // A collection the list does not carry at all (it emptied between the
  // press and now): refused with words, never opened as every game.
  if (name && name.charAt(0) === "@" && !collectionsAll.some(function (x) { return x.key === name; })) {
    L("NAV", "refused unknown " + name);
    showStrip("nothing to show: that list is empty now", false);
    sound("back");
    return;
  }
  L("NAV", "open " + (name || "all platforms") + " as " + view);
  showInside(name);
  // Not what the view drew last: that stood uncovered under the new name
  // until the rows came back (clearView says more).
  clearView();
  sound("select");
  load();
}

/* Off the consoles screen and into the games, the consoles one press away.
   The dropdown is painted the moment the wall goes, or for the length of a
   request it names the wall's shape over a list. */
function showInside(name) {
  dropFanPage();                         // a console or every game, chosen from over the Fan projects page
  setSysStage("inside");
  // The game view is whatever the dropdown says: systems first is a toggle,
  // so the systems wheel can open into the game wheel.
  $platform.value = name;
  $syswall.hidden = true;
  $body.classList.remove("on-wall");
  $main.hidden = false;
  $toolbar.hidden = false;
  $btnSystems.hidden = false;
  paintSeg();
  paintHelp("inside");
}

/* Opening in List or Grid with Systems first on: they have no shape on the
   consoles screen, so they open on every game, as choosing List there does.
   The rows are the ones the first load drew, so nothing is asked for again. */
export function startOnAllGames() {
  L("NAV", "open on all games as " + view);
  showInside("");
}

/* Whether this view has a shape on the consoles screen: only then does
   Systems first put the consoles up when Xsegon opens. */
export function hasWallShape(v) {
  return v === "wheel" || v === "carousel";
}

// Wheel of banners or the console gallery: a settings dropdown, like every other choice.
export function sysStyle() {
  return (S.view && S.view.systemsStyle) === "carousel" ? "carousel" : "wheel";
}

var sysInfoEl = null;
var SYS_ARC = 9;                        // degrees between banners on the rim

function sysClick(p, i) {
  return function () {
    if (dragAte()) { return; }
    if (i === sysSel) { chooseSystem(p.name); return; }
    sysSel = i;
    sound("move");
    updateSystems();
  };
}

/* Right-click a console. Short on purpose: it offers what the screen cannot
   otherwise, its pictures and the Filter by window, which this screen has no
   search box for and which the pad reaches only here (Y opens this menu). */
export function openSysMenu(p, i, x, y) {
  if (i !== sysSel) { sysSel = i; updateSystems(); }
  // Recently added and Recently changed: how far back each looks, here because an empty one cannot be opened to choose.
  var verb = { "@added": "Added", "@changed": "Changed" }[p.name];
  var stretch = !verb ? [] : [{ rule: true }].concat(addedPeriods().map(function (o) {
    return { label: o[0] === "today" ? verb + " today" : verb + " in the " + o[1].toLowerCase(),
             checked: periodOf(p.name) === o[0], run: function () { setPeriod(p.name, o[0]); } };
  }));
  popupMenu([
    { icon: "play", label: "Open " + (p.label || p.name), hint: p.note ? "empty" : null, tip: p.note ? TIPS.sysEmpty : null,
      run: p.note ? null : function () { chooseSystem(p.name); } },
  ].concat(stretch, [
    { rule: true },
    { icon: "filter", label: "Filter by...", hint: filterWords() || null, tip: TIPS.filter, run: openFilterWindow },
    { icon: "image", label: "Change Pictures...", hint: "logo and console", tip: TIPS.sysPictures,
      run: function () { openPlatformArtEditor(p); } },
  ]), x, y, p.label || p.name);
}

function wireSys(node, p, i) {
  node.addEventListener("click", sysClick(p, i));
  node.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    openSysMenu(p, i, e.clientX, e.clientY);
  });
}

export function renderSystems() {
  $syswall.textContent = "";
  var wheelStyle = sysStyle() === "wheel";
  $syswall.className = "syswall " + (wheelStyle ? "sw-wheel" : "sw-cards");
  sysInfoEl = null;

  // No games at all: no consoles to turn through, so the wall says why.
  // The rim is emptied too, so nothing steers onto a console that is not drawn.
  if (libraryTotal === 0) {
    sysList = [];
    sysNodes = [];
    $syswall.classList.add("sw-empty");
    $syswall.appendChild(noGamesBox(null, openGuide));
    return;
  }

  if (wheelStyle) {
    // The left half: the chosen console presented large; the right half:
    // every system's banner riding the same rim the game wheel uses.
    sysInfoEl = el("div", "sysinfo");
    $syswall.appendChild(sysInfoEl);

    sysNodes = sysList.map(function (p, i) {
      var n = el("div", "switem" + (p.collection ? " coll" : "") + (p.note ? " off" : ""));
      n.hidden = true;
      /* The name first, the banner when it arrives. The plate is sized by its
         content, so one that is only an unloaded img is a zero-area box (never
         lazily loaded, and stuck while the server is busy): with the name in
         it from the start it is a wheel of names at worst, never slivers. */
      var t = el("span", "t", p.label || p.name);
      n.appendChild(t);
      var img = el("img", "swbanner");
      img.alt = p.label || p.name;
      img.onload = function () { t.remove(); };
      // Name logos only on the rim: a miss falls to the name in text, never to a banner picture.
      img.onerror = function () { img.remove(); };
      img.src = platformArtUrl(p.name, "clearlogo");
      n.appendChild(img);
      wireSys(n, p, i);
      $syswall.appendChild(n);
      return n;
    });
  } else {
    sysNodes = sysList.map(function (p, i) {
      var card = el("div", "syscard");
      card.hidden = true;

      // The console itself, transparent, is the card's face when there is
      // one (your own, or the one built in); the banner and
      // the showcase box stand in behind it.
      var art = el("img", "sysbanner");
      art.alt = "";
      art.loading = "lazy";
      // Device, then banner, then the name logo the wheel shows, and only then
      // a game's box: a console with a logo alone (Steam) would read as a game.
      art.onerror = function () {
        if (!art.dataset.step) {
          art.dataset.step = "1";
          art.src = platformArtUrl(p.name);
        } else if (art.dataset.step === "1") {
          art.dataset.step = "logo";
          art.classList.add("is-logo");
          art.src = platformArtUrl(p.name, "clearlogo");
        } else if (art.dataset.step === "logo" && p.show) {
          art.dataset.step = "2";
          art.classList.remove("is-logo");
          art.src = artUrl(p.show, "box");
        } else {
          art.remove();
        }
      };
      art.src = platformArtUrl(p.name, "device");
      card.appendChild(art);

      if (p.collection) { card.classList.add("coll"); }
      if (p.note) { card.classList.add("off"); }
      card.appendChild(el("div", "sysname", p.label || p.name));
      card.appendChild(el("div", "syscount", countLabel(p)));
      wireSys(card, p, i);
      $syswall.appendChild(card);
      return card;
    });
  }
  measureChrome();                       // the gallery's band centres on what is left
  updateSystems();
}

/* The chosen console, presented. Built once per wall and then filled in, as the
   info panel beside the games is (hero.js): the picture keeps its element and a
   fixed-height box, so moving along the rim swaps one console for the next in place. */
var SI = null;

function buildSysInfo() {
  SI = { host: sysInfoEl, p: null };
  SI.img = el("img", "sysdevice");
  SI.img.alt = "";
  // A collection has no console to show: a big mark stands where the
  // console would, and opens the collection the way the console does.
  SI.img.onerror = function () {
    SI.img.hidden = true;
    SI.mark.hidden = !(SI.p && SI.p.collection);
  };
  SI.mark = el("div", "sysmark", "★");
  SI.mark.hidden = true;
  // The console IS the chosen system: clicking it opens it, as its name on the
  // rim does, and right-clicking it offers its pictures.
  [SI.img, SI.mark].forEach(function (n) {
    n.addEventListener("click", function () {
      if (dragAte() || !SI.p) { return; }
      chooseSystem(SI.p.name);
    });
  });
  sysInfoEl.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    if (SI.p) { openSysMenu(SI.p, sysSel, e.clientX, e.clientY); }
  });
  SI.name = el("div", "sysname");
  SI.count = el("div", "syscount");
  // The picture's box keeps its height with no picture in it, so a console
  // with none does not pull its name up into the space.
  var box = el("div", "sysart");
  box.appendChild(SI.img);
  box.appendChild(SI.mark);
  sysInfoEl.appendChild(box);
  sysInfoEl.appendChild(SI.name);
  sysInfoEl.appendChild(SI.count);
}

/* The console's picture alone: what keeps up with every step of a fast run
   along the rim (settle in js\views.js), while its name and count wait. */
function paintSysArt(p) {
  if (!sysInfoEl || !p) { return; }
  if (!SI || SI.host !== sysInfoEl) { buildSysInfo(); }
  SI.p = p;
  SI.mark.textContent = p.fan ? "✦" : "★";
  var url = platformArtUrl(p.name, "device");
  if (SI.img.getAttribute("src") !== url) {
    SI.img.hidden = false;
    SI.mark.hidden = true;
    SI.img.src = url;
  }
}

function paintSysInfo(p) {
  if (!sysInfoEl || !p) { return; }
  paintSysArt(p);
  sysInfoEl.classList.toggle("off", !!p.note);
  SI.name.textContent = p.label || p.name;
  SI.count.textContent = countLabel(p);
}

function sysScene(p) {
  // The wall's background: the showcase game's fanart, and its box only when there is none.
  var g = p && p.show;
  if (!g) { return; }
  if (g.hasFanart) {
    paintBackdropUrl(artUrl(g, "fanart"), true);
  } else if (g.hasArt) {
    paintBackdropUrl(artUrl(g, "box"), true);
  }
}

export function updateSystems() {
  var wheelStyle = sysStyle() === "wheel";
  sysNodes.forEach(function (n, i) {
    var d = i - sysSel;
    // The cards show three either side and keep three more, unseen, so a fast
    // run slides them in and out instead of popping (wheelfx.js carouselSpin); the rim shows five.
    var reach = wheelStyle ? 5 : 6, far = !wheelStyle && Math.abs(d) > 3;
    if (Math.abs(d) > reach) {
      if (!n.hidden) { n.hidden = true; }
      n.classList.remove("cnear");
      // And it is not the chosen one any more: a jump of more than five would
      // hide the old node with "sel" still on it, two marked at once.
      n.classList.remove("sel");
      return;
    }
    n.hidden = false;
    if (wheelStyle) {
      n.style.transform = "translateY(-50%) rotate(" + (d * -SYS_ARC) + "deg)" +
                          (d === 0 ? " scale(1.05)" : "");
      n.style.opacity = String(1 - Math.abs(d) * 0.14);
    } else {
      n.classList.add("cnear");
      n.style.transform = "translate(-50%, -50%) translateX(" + (d * 250) + "px)" +
                          " rotateY(" + (Math.max(-3, Math.min(3, d)) * -28) + "deg)" +
                          " scale(" + (d === 0 ? 1 : 0.76) + ")";
      n.style.opacity = String(d === 0 ? 1 : far ? 0 : 0.42);
    }
    n.style.zIndex = String(50 - Math.abs(d));
    n.classList.toggle("sel", d === 0);
  });
  var p = sysList[sysSel];
  if (sysInfoEl) {
    settle(sysInfoEl, function () { paintSysInfo(sysList[sysSel]); },
           function () { paintSysArt(sysList[sysSel]); });
  }
  sysScene(p);
}

export function moveSys(d) {
  if (!sysList.length) { return; }
  var next = Math.max(0, Math.min(sysList.length - 1, sysSel + d));
  if (next === sysSel && ctl("arrowsWrap", false) && d !== 0) {
    next = d > 0 ? 0 : sysList.length - 1;
  }
  if (next === sysSel) { return; }
  var steps = next - sysSel;
  sysSel = next;
  sound("move");
  updateSystems();
  if (sysStyle() !== "wheel") { carouselSpin($syswall, steps); }
}
