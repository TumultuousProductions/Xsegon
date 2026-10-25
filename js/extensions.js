/*  The Extensions page: programs Xsegon works with, fetched from their makers
    only when you press for it (api\extensions.php, roadmap AU11). Opened from
    its card on the consoles screen and from the Games menu. Drawn with the
    games' own boxes, as the Fan projects page is, so every theme dresses it.
    Flashpoint is its one entry so far: found on this PC, or got from its
    makers; set up with the helper that starts its games without its own
    window; its playlists brought in as a Flashpoint list.                   */

import { dropDetails } from "./details.js";
import { dropFanPage } from "./fanprojects.js";
import { paintHelp, paintHelpHere } from "./help.js";
import { jobsWatch } from "./jobbars.js";
import { showStrip } from "./launch.js";
import { load } from "./library.js";
import { L, api, postJson } from "./log.js";
import { popupMenu } from "./menus.js";
import { pickWindowsFolder } from "./scan.js";
import { armBrowse, stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $body, $main, $syswall, $toolbar, S, sysStage } from "./state.js";
import { backToWall, chooseSystem } from "./systems.js";
import { dropTpPage } from "./tppage.js";
import { el } from "./util.js";

// The card's name on the consoles screen: a collection's shape, opened here instead of as games.
export var EXT_KEY = "@extensions";

var EXT_SECTIONS = [["here", "On this PC"], ["ready", "Ready to get"], ["needs", "Needs another first"]];

var XP = null;          // the page's parts, once built
var extList = [];       // as the server answered, in its order
var extShown = [];      // { x, tile }, in the page's order
var extAt = 0;
var extPadAt = 0;       // when a held direction steps again

export function extOpen() { return !!(XP && XP.open); }

function extBuild() {
  XP = { open: false };
  XP.root = el("div", "fanpage extpage");
  XP.root.id = "extpage";
  XP.root.hidden = true;
  var head = el("div", "fan-head");
  head.appendChild(el("span", "fan-name", "Extensions"));
  head.appendChild(el("span", "fan-sub", "Programs Xsegon works with, fetched from their makers when you ask"));
  XP.root.appendChild(head);

  var bar = el("div", "bar");
  var back = el("button", null, "◂ Systems");
  back.type = "button";
  back.addEventListener("click", function () { closeExtPage(); });
  bar.appendChild(back);
  XP.root.appendChild(bar);

  XP.main = el("div", "main with-hero");
  XP.grid = el("div", "grid grid-shot");
  XP.hero = el("div", "hero");
  XP.main.appendChild(XP.grid);
  XP.main.appendChild(XP.hero);
  XP.root.appendChild(XP.main);
  $syswall.after(XP.root);
  window.addEventListener("resize", extFit);
}

// The grid and the panel reach down to the legend, as the games' do.
function extFit() {
  if (!extOpen()) { return; }
  XP.root.style.setProperty("--fan-top", Math.round(XP.main.getBoundingClientRect().top) + "px");
}

export function openExtPage() {
  if (!XP) { extBuild(); }
  if (XP.open) { return; }
  dropDetails();
  dropFanPage();                         // the pages never stand one over another
  dropTpPage();
  stopVideo();
  // The consoles screen only when it is the one showing: with Systems first off the games show with no stage yet.
  XP.from = sysStage === "wall" ? "wall" : "inside";
  XP.open = true;
  L("NAV", "extensions, from the " + XP.from);
  $syswall.hidden = true;
  $main.hidden = true;
  $toolbar.hidden = true;
  $body.classList.add("on-ext");
  XP.root.hidden = false;
  XP.grid.textContent = "";
  XP.hero.textContent = "";
  XP.first = null;
  extShown = [];
  XP.grid.appendChild(el("div", "fan-wait", "Looking for each program on this PC..."));
  extFit();
  paintHelp("extensions");
  sound("select");
  extAt = 0;
  extLoad();
}

function extLoad() {
  api("api/extensions.php").then(function (r) {
    if (!extOpen()) { return; }
    if (!r || !r.ok) {
      L("EXT", "the list could not be read: " + ((r && r.error) || "no answer"));
      showStrip("Extensions could not be read: " + ((r && r.error) || "no answer from Xsegon"), true);
      extList = [];
    } else {
      extList = r.extensions || [];
      L("EXT", extList.length + " on the list, read in " + r.ms + "ms");
    }
    if (r && r.working && XP.working !== r.working) { extFollow(r.working); }
    extDraw();
  });
}

// Set up or Get at work: followed from here, and the list read again when it is over.
function extFollow(id) {
  XP.working = id;
  clearInterval(XP.followT);
  XP.followT = setInterval(function () {
    api("api/extensions.php?job=1").then(function (r) {
      if (r && r.ok && r.job && r.job.state === "running") { return; }
      clearInterval(XP.followT);
      XP.working = null;
      if (extOpen()) { extLoad(); }
    });
  }, 2000);
}

function extHide() {
  XP.open = false;
  XP.root.hidden = true;
  $body.classList.remove("on-ext");
  if (XP.from === "inside") { $main.hidden = false; $toolbar.hidden = false; }
  else { $syswall.hidden = false; }
}

export function closeExtPage() {
  if (!extOpen()) { return; }
  L("NAV", "extensions closed, back to the " + XP.from);
  extHide();
  if (XP.from === "inside") {
    sound("back");
    paintHelpHere();
    armBrowse();
  } else {
    backToWall();
  }
}

// Put away without a sound or a legend, for a caller about to draw another screen. Answers whether it was up.
export function dropExtPage() {
  if (!extOpen()) { return false; }
  L("NAV", "extensions put away for another screen");
  extHide();
  return true;
}

function n(v) { return Number(v || 0).toLocaleString("en-GB"); }
function mb(bytes) { return bytes >= 1073741824 ? (bytes / 1073741824).toFixed(1) + " GB" : Math.max(1, Math.round(bytes / 1048576)) + " MB"; }
function fpName(x) { return x.version ? "Flashpoint " + x.version.number + (x.version.edition ? " " + x.version.edition : "") : "Flashpoint"; }
function favourites(x) { return (x.playlists || []).filter(function (p) { return p.favourites; })[0] || null; }
// Flashpoint's own best-of list, named by the server only when there are no favourites to bring in.
function starter(x) { return (x.playlists || []).filter(function (p) { return p.file === x.starter; })[0] || null; }

// Where it stands, in one line and its colour.
function extStatus(x) {
  if (XP && XP.working === x.id) { return ["", "At work: the bar in the corner shows how far it is"]; }
  if (x.next === "get") { return ["", "Not found on this PC. Get fetches " + (x.get ? "Flashpoint " + x.get.version + " (" + mb(x.get.size) + ")" : "it") + " from its makers"]; }
  if (x.next === "open") { return ["warn", "On this PC, with no game list yet: open it once so it finishes setting itself up"]; }
  if (x.next === "none") { return ["no", fpName(x) + " is on this PC, and Xsegon does not know how to start its games yet"]; }
  if (x.next === "setup") { return ["warn", fpName(x) + " is on this PC. Set up fetches the small helper that starts its games (" + mb(x.fit.size) + ")"]; }
  if (x.next === "bring" && starter(x)) { return ["ok", fpName(x) + " is set up, with no favourites in it yet. Bring in Flashpoint's best to start"]; }
  if (x.next === "bring") { return ["ok", fpName(x) + " is set up. Bring in its favourites next"]; }
  return ["ok", fpName(x) + ": " + n(x.mine) + (x.mine === 1 ? " game" : " games") + " in your library, in the Flashpoint list"];
}

function extTile(x) {
  var t = el("div", "tile");
  var cap = el("div", "cap", x.name);
  t.appendChild(cap);
  t.appendChild(el("div", "noart fan-noart", x.name.toUpperCase()));
  var st = extStatus(x);
  t.appendChild(el("div", "fan-st" + (st[0] ? " " + st[0] : ""), st[1]));
  return t;
}

function extDraw() {
  var was = extShown[extAt] ? extShown[extAt].x.id : null;
  XP.grid.textContent = "";
  extShown = [];
  EXT_SECTIONS.forEach(function (sec) {
    var lot = extList.filter(function (x) { return x.section === sec[0]; });
    if (!lot.length) { return; }
    var h = el("div", "ghead");
    h.appendChild(el("span", "ghead-name", sec[1]));
    h.appendChild(el("span", "ghead-n", String(lot.length)));
    XP.grid.appendChild(h);
    lot.forEach(function (x) {
      var t = extTile(x), at = extShown.length;
      t.addEventListener("click", function () { if (at !== extAt) { extGo(at); } });
      XP.grid.appendChild(t);
      extShown.push({ x: x, tile: t });
    });
  });
  if (!extShown.length) {
    XP.grid.appendChild(el("div", "fan-wait", "Nothing to show."));
    XP.hero.textContent = "";
    XP.first = null;
    return;
  }
  var i = extShown.findIndex(function (s) { return s.x.id === was; });
  extGo(i >= 0 ? i : 0, true);
}

function extGo(i, quiet) {
  if (!extShown.length) { return; }
  extAt = Math.max(0, Math.min(extShown.length - 1, i));
  extShown.forEach(function (s, k) { s.tile.classList.toggle("sel", k === extAt); });
  extShown[extAt].tile.scrollIntoView({ block: "nearest" });
  if (!quiet) { sound("move"); }
  extPanel(extShown[extAt].x);
}

function extButton(label, run, primary, off) {
  var b = el("button", primary ? "primary" : null, label);
  b.type = "button";
  if (off) { b.disabled = true; b.title = off; }
  b.addEventListener("click", run);
  return b;
}

function address(url) { return url.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, ""); }

// The panel beside the grid: what it is and who made it, where it stands, and its buttons.
function extPanel(x) {
  XP.hero.textContent = "";
  var top = el("div", "fan-top");
  top.appendChild(el("div", "fan-kind", x.kind || "Program"));
  var h = el("h3");
  h.appendChild(el("span", "hero-name", x.name));
  top.appendChild(h);
  if (x.by) { top.appendChild(el("div", "fan-by", "by " + x.by)); }
  XP.hero.appendChild(top);

  var info = el("div", "hero-info");
  info.appendChild(el("p", "fan-adds", x.adds));
  var stats = el("div", "hero-stats");
  function kv(k, v, hot) { stats.appendChild(el("span", "k", k)); stats.appendChild(el("span", "v" + (hot ? " hot" : ""), v)); }
  var st = extStatus(x);
  kv("Where it stands", st[1], st[0] === "ok");
  if (x.folder) {
    kv("On this PC", fpName(x) + " in " + x.folder);
    if (x.games !== null && x.games !== undefined) { kv("Its list", n(x.games) + " games and animations"); }
    var fav = favourites(x);
    if (fav) { kv("Your favourites", n(fav.count) + " in Flashpoint, " + n(fav.here) + " of them in Xsegon"); }
  }
  if (x.helper) {
    var hh = x.helperHere;
    kv("Starts its games with", x.helper.name + (x.fit ? " " + x.fit.tag : "") + " by " + x.helper.by + " (" + x.helper.licence + ")"
       + (hh && hh.there ? ", beside it" : x.fit ? ", fetched by Set up" : ""));
  }
  kv("Size", x.size || "not given");
  kv("Licence", x.licence || "none given");
  kv("Website", address(x.page));
  info.appendChild(stats);
  XP.hero.appendChild(info);

  var bar = el("div", "bar");
  XP.first = extFirst(x);
  bar.appendChild(XP.first);
  extMore(x).forEach(function (b) { bar.appendChild(b); });
  XP.hero.appendChild(bar);
}

// The panel's first button is the next thing to do; A on a pad presses it.
function extFirst(x) {
  var atWork = XP.working ? "Something is at work: the bar in the corner shows how far it is" : null;
  if (x.next === "get") { return extButton("Get Flashpoint", function () { extGet(x); }, true, atWork); }
  if (x.next === "open") { return extButton("Open Flashpoint", function () { extLauncher(x); }, true); }
  if (x.next === "setup") { return extButton(XP.working === x.id ? "Being set up" : "Set up", function () { extSetup(x); }, true, atWork); }
  if (x.next === "bring") {
    var fav = favourites(x), best = starter(x);
    if (best) { return extButton("Bring in Flashpoint's best (" + best.count + ")", function () { extBring(x, best); }, true); }
    return extButton("Bring in favourites" + (fav ? " (" + fav.count + ")" : ""), function () { extBring(x, fav); }, true,
                     !fav ? "Flashpoint has no favourites playlist: Other playlists has the rest"
                     : !fav.count ? "Your favourites in Flashpoint are empty: Other playlists has the rest" : null);
  }
  if (x.next === "list") {
    return extButton("Show its games", function () { dropExtPage(); chooseSystem("Flashpoint"); }, true);
  }
  var b = extButton("Website", function () { extOpenUrl(x, "page"); }, true);
  b.dataset.opens = "page";
  return b;
}

// The rest of its buttons, after the first: what can be done next, then its pages.
function extMore(x) {
  var out = [];
  if (x.next === "list") {
    var fav = favourites(x);
    if (fav) { out.push(extButton("Bring in new favourites", function () { extBring(x, fav); })); }
  }
  if ((x.next === "bring" || x.next === "list") && (x.playlists || []).length) {
    var other = extButton("Other playlists...", function () { extPlaylists(x, other); });
    out.push(other);
  }
  if (x.folder && x.next !== "open") { out.push(extButton("Open Flashpoint", function () { extLauncher(x); })); }
  out.push(extButton(x.folder ? "Choose another folder..." : "Find it in a folder...", function () { extChoose(x); }));
  if (!XP.first || XP.first.dataset.opens !== "page") { out.push(extButton("Website", function () { extOpenUrl(x, "page"); })); }
  if (x.next === "get" && x.get) { out.push(extButton("Its downloads page", function () { extOpenUrl(x, "listed"); })); }
  return out;
}

// Get: the folder it goes in chosen first (a Flashpoint folder is made in it), then one download in the corner.
function extGet(x) {
  pickWindowsFolder("Choose where Flashpoint goes (a Flashpoint folder is made in it; " + mb(x.get.size) + " to download, up to 4 GB once set up)").then(function (dir) {
    if (!dir) { return; }
    L("EXT", "get " + x.name + " into " + dir);
    extStart({ get: x.id, into: dir }, x, "Getting Flashpoint " + x.get.version + " from its makers into " + dir + "\\Flashpoint: the bar in the corner shows how far it is");
  });
}

function extSetup(x) {
  L("EXT", "set up " + x.name + " pressed");
  extStart({ setup: x.id }, x, "Setting up " + fpName(x) + ": the bar in the corner shows how far it is");
}

function extStart(body, x, said) {
  if (XP.working) { return; }
  postJson("api/extensions.php", body).then(function (r) {
    if (!r || !r.ok) {
      showStrip(x.name + ": " + ((r && r.error) || "no answer"), true);
      sound("back");
      return;
    }
    sound("select");
    showStrip(said, false);
    jobsWatch("extensions");
    extFollow(x.id);
    if (extOpen()) { extDraw(); }
  });
}

// Flashpoint's own window, for what only it does: its first setup, its own settings and updates.
function extLauncher(x) {
  postJson("api/extensions.php", { launcher: x.id }).then(function (r) {
    if (!r || !r.ok) { showStrip("Flashpoint did not open: " + ((r && r.error) || "no answer"), true); return; }
    L("EXT", "Flashpoint's own window opened");
    sound("select");
    showStrip(x.next === "open" ? "Flashpoint is opening: let it finish setting itself up, close it, then come back here"
                                : "Flashpoint is opening in its own window", false);
  });
}

// Where it is, when Xsegon did not find it or should look elsewhere: said only from the server's answer.
function extChoose(x) {
  pickWindowsFolder("Choose Flashpoint's folder (the one with Launcher, Data and FPSoftware in it)", { start: x.folder || "" }).then(function (dir) {
    if (!dir) { return; }
    postJson("api/extensions.php", { folder: dir, id: x.id }).then(function (r) {
      if (!r || !r.ok) { showStrip("That folder was not taken: " + ((r && r.error) || "no answer"), true); sound("back"); return; }
      sound("select");
      showStrip("Flashpoint's folder is " + r.folder, false);
      extLoad();
    });
  });
}

function extPlaylists(x, from) {
  var r = from.getBoundingClientRect();
  popupMenu(x.playlists.map(function (p) {
    return { icon: "download", label: p.title + " (" + p.count + ")", hint: p.here ? p.here + " here" : null,
             run: function () { extBring(x, p); } };
  }), r.left, r.bottom, "Bring in a playlist");
}

/* A playlist's games into the library as one press: the games first, in one
   answer, then each one's pictures, said as they come; the library is read
   again at the end so the Flashpoint list stands on the consoles screen. */
function extBring(x, p) {
  if (!p || XP.bringing) { return; }
  XP.bringing = true;
  L("EXT", "bring in " + p.title + " (" + p.count + ")");
  showStrip("Bringing in " + p.title + " from Flashpoint...", false, true);
  postJson("api/extensions.php", { bring: x.id, playlist: p.file }).then(function (r) {
    if (!r || !r.ok) {
      XP.bringing = false;
      showStrip(p.title + " was not brought in: " + ((r && r.error) || "no answer"), true);
      sound("back");
      return;
    }
    var ids = r.ids || [], done = 0;
    function ending() {
      XP.bringing = false;
      sound("select");
      var lines = [n(r.added + r.kept) + " Flashpoint " + ((r.added + r.kept) === 1 ? "game" : "games") + " from " + r.playlist + " in your library ("
                   + n(r.added) + " new)"];
      if (r.online) { lines.push(n(r.online) + " download the first time they are played, so the internet is needed then"); }
      if (r.unknown) { lines.push(n(r.unknown) + " are no longer in Flashpoint's list and were left out"); }
      if (r.hidden) {
        var why = Object.keys(r.hiddenWhy || {}).map(function (k) { return (k === "broken" ? "marked broken" : k) + " " + n(r.hiddenWhy[k]); });
        lines.push(n(r.hidden) + " left out, as Flashpoint's own settings hide them (" + why.join(", ") + ")");
      }
      showStrip(lines.join("; "), false);
      load({ noDraw: true });
      if (extOpen()) { extLoad(); }
    }
    (function next() {
      if (done >= ids.length) { ending(); return; }
      showStrip("Pictures for the Flashpoint games: " + (done + 1) + " of " + ids.length, false, true);
      postJson("api/extensions.php", { pictures: ids[done] }).then(function () { done++; next(); });
    })();
  });
}

// Its makers' page in your own browser: the server opens what the list names, never an address from here.
function extOpenUrl(x, which) {
  postJson("api/extensions.php", { open: x.id, which: which }).then(function (r) {
    if (!r || !r.ok) { showStrip(x.name + "'s page did not open: " + ((r && r.error) || "no answer"), true); return; }
    L("EXT", "open " + which + " of " + x.name);
    sound("select");
    showStrip("Opened " + address(r.url) + " in your browser", false);
  });
}

function extPress() {
  var b = XP && XP.first;
  if (!b) { return; }
  if (b.disabled) { showStrip(b.title, false); sound("back"); return; }
  b.click();
}

function extStep(d) {
  if (extShown.length) { extGo(extAt + d); }
}

/* The keys while the page is up: arrows walk the entries, Enter presses the
   panel's first button, Esc goes back. Answers whether the key was the page's. */
export function extKeys(e) {
  if (!extOpen()) { return false; }
  if (e.key === "ArrowRight" || e.key === "ArrowDown") { extStep(1); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { extStep(-1); }
  else if (e.key === "Enter" || e.key === " ") { extPress(); }
  else if (e.key === "Escape" || e.key === "Backspace") { closeExtPage(); }
  else { return true; }
  e.preventDefault();
  return true;
}

/* The pad while the page is up: the cross walks the entries, A presses the
   panel's first button, X opens its website, B goes back. Answers the
   buttons as they stand, for the next poll to compare. */
export function extPad(k, prev) {
  var d = k.right || k.down ? 1 : k.left || k.up ? -1 : 0;
  var key = d ? String(d) : "", now = Date.now(), padSet = S.controller || {};
  if (!d) { extPadAt = 0; }
  else if (key !== prev.fd) { extStep(d); extPadAt = now + (padSet.repeatDelayMs || 400); }
  else if (now >= extPadAt) { extStep(d); extPadAt = now + (padSet.repeatRateMs || 110); }
  if (k.a && !prev.a) { extPress(); }
  if (k.x && !prev.x && extShown[extAt]) { extOpenUrl(extShown[extAt].x, "page"); }
  if (k.b && !prev.b) { closeExtPage(); }
  return { a: k.a, b: k.b, x: k.x, y: k.y, fd: key };
}
