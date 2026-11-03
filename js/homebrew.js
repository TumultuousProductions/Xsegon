/*  The Homebrew page: free games fans made for consoles, and the people who made
    them (api\homebrew.php). Opened from its card on the consoles screen, the
    Games menu and the box an empty library shows. Drawn with Fan projects' boxes,
    so every theme dresses it as it dresses that page. Get fetches a game from its
    team or its jam (bin\homebrew.php) and it joins its console's list: this page
    is what can be had, never a second library.                                 */

import { confirmWindow } from "./confirm.js";
import { dropDetails } from "./details.js";
import { dropExtPage } from "./extensions.js";
import { dropFanPage, fanAddress, fanButton, fanKeys, fanOpen, fanPad, gridNear } from "./fanprojects.js";
import { paintHelp, paintHelpHere } from "./help.js";
import { jobsWatch } from "./jobbars.js";
import { launchNow, showStrip } from "./launch.js";
import { load } from "./library.js";
import { L, api, postJson } from "./log.js";
import { armBrowse, stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $body, $main, $syswall, $toolbar, S, sysStage } from "./state.js";
import { backToWall } from "./systems.js";
import { dropTpPage } from "./tppage.js";
import { el } from "./util.js";

// The card's name on the consoles screen: a collection's shape, opened here instead of as games.
export var HB_KEY = "@homebrew";

var PLACES = { 1: "1st place", 2: "2nd place", 3: "3rd place" };

var HB = null;          // the page's parts, once built
var hbGames = [];       // as the server answered, in its order
var hbShown = [];       // what passes the filters, in the page's order: { g, tile }
var hbAt = 0;
var hbPadAt = 0;        // when a held direction steps again

export function hbOpen() { return !!(HB && HB.open); }

// js\input.js stands at its line limit, so this page and Fan projects answer it through one import.
export function pageOpen() { return hbOpen() || fanOpen(); }
export function pageKeys(e) { return hbKeys(e) || fanKeys(e); }
export function pagePad(k, prev) { return (hbOpen() ? hbPad : fanPad)(k, prev); }

function hbBuild() {
  HB = { open: false };
  HB.root = el("div", "fanpage");
  HB.root.id = "hbpage";
  HB.root.hidden = true;
  var head = el("div", "fan-head");
  head.appendChild(el("span", "fan-name", "Homebrew"));
  head.appendChild(el("span", "fan-sub", "Free games made by fans, from their makers"));
  HB.root.appendChild(head);

  var bar = el("div", "bar");
  var back = el("button", null, "◂ Systems");
  back.type = "button";
  back.addEventListener("click", function () { closeHbPage(); });
  HB.consoles = el("select");
  HB.find = el("input");
  HB.find.type = "search";
  HB.find.placeholder = "Find a game or who made it";
  HB.consoles.addEventListener("change", function () { hbDraw(); });
  HB.find.addEventListener("input", function () { hbDraw(); });
  [back, HB.consoles, HB.find].forEach(function (n) { bar.appendChild(n); });
  HB.root.appendChild(bar);

  HB.main = el("div", "main with-hero");
  HB.grid = el("div", "grid grid-shot");
  HB.hero = el("div", "hero");
  HB.main.appendChild(HB.grid);
  HB.main.appendChild(HB.hero);
  HB.root.appendChild(HB.main);
  $syswall.after(HB.root);
  window.addEventListener("resize", hbFit);
}

// The grid and the panel reach down to the legend, as the games' do.
function hbFit() {
  if (!hbOpen()) { return; }
  HB.root.style.setProperty("--fan-top", Math.round(HB.main.getBoundingClientRect().top) + "px");
}

export function openHbPage() {
  if (!HB) { hbBuild(); }
  if (HB.open) { return; }
  dropDetails();                         // a game's details never stay over the page
  dropFanPage();                         // the pages never stand one over another
  dropExtPage();
  dropTpPage();
  stopVideo();                           // nor a snap playing behind it
  HB.from = sysStage === "wall" ? "wall" : "inside";
  HB.open = true;
  L("NAV", "homebrew, from the " + HB.from);
  $syswall.hidden = true;
  $main.hidden = true;
  $toolbar.hidden = true;
  $body.classList.add("on-fan");
  HB.root.hidden = false;
  HB.grid.textContent = "";
  HB.hero.textContent = "";
  HB.first = null;                       // no press reaches the last visit's buttons while it reads
  hbShown = [];
  hbAt = 0;
  hbFit();
  paintHelp("homebrew");
  sound("select");
  hbLoad();
}

// The list read, and drawn keeping the chosen game; a Get at work is followed from here.
function hbLoad() {
  api("api/homebrew.php").then(function (r) {
    if (!hbOpen()) { return; }
    if (!r || !r.ok) {
      L("HBRW", "the list could not be read: " + ((r && r.error) || "no answer"));
      showStrip("Homebrew could not be read: " + ((r && r.error) || "no answer from Xsegon"), true);
      hbGames = [];
    } else {
      hbGames = r.games || [];
      L("HBRW", hbGames.length + " games read in " + r.ms + "ms");
    }
    hbConsoles();
    if (r && r.getting && HB.getting !== r.getting) { hbFollow(r.getting); }
    hbDraw();
  });
}

function hbGet(g, ares) {
  if (HB.getting || HB.asking) { return; }
  HB.asking = true;                      // a second press before the answer is the same press, not a refused one
  L("HBRW", "get " + g.name + " pressed" + (ares ? ", with ares" : ""));
  postJson("api/homebrew.php", { get: g.id, ares: !!ares }).then(function (r) {
    HB.asking = false;
    if (!r || !r.ok) {
      showStrip(g.name + " was not fetched: " + ((r && r.error) || "no answer"), true);
      sound("back");
      return;
    }
    sound("select");
    showStrip("Getting " + g.name + ": the bar in the corner shows how far it is", false);
    jobsWatch("homebrew");
    hbFollow(g.id);
    if (hbOpen()) { hbDraw(); }
  });
}

// A program is new to the PC, so it is asked for first; a game alone is one press.
function hbAskAres(g) {
  confirmWindow(g.name + " plays in ares", function (box) {
    box.appendChild(el("p", null, "ares is a free emulator that plays these games the way a real Nintendo 64 does, and nearly all of their makers name it. It is not on this PC yet."));
    box.appendChild(el("p", null, "Xsegon fetches it from its makers' own releases, checks it, and keeps it in Xsegon's folder. Your other " + g.console + " games stay as they are."));
  }, { label: "Get ares and " + g.name, run: function () { hbGet(g, true); } }, "Not now");
}

function hbFollow(id) {
  HB.getting = id;
  clearInterval(HB.followT);
  var missed = 0;
  HB.followT = setInterval(function () {
    api("api/homebrew.php?job=1").then(function (r) {
      if (r && r.ok && r.job && r.job.state === "running") { missed = 0; return; }
      // One ask with no answer is no end: the Get may well still be at work. Thirty seconds of none is.
      if ((!r || !r.ok) && ++missed < 15) { return; }
      clearInterval(HB.followT);
      HB.getting = null;
      load({ noDraw: true });            // the library has a game more, and the screens behind this one must know it
      if (hbOpen()) { hbLoad(); }
    });
  }, 2000);
}

// Off screen, and what it covered back: the consoles, or the games it was opened from.
function hbHide() {
  HB.open = false;
  HB.root.hidden = true;
  $body.classList.remove("on-fan");
  if (HB.from === "inside") { $main.hidden = false; $toolbar.hidden = false; }
  else { $syswall.hidden = false; }
}

export function closeHbPage() {
  if (!hbOpen()) { return; }
  L("NAV", "homebrew closed, back to the " + HB.from);
  hbHide();
  if (HB.from === "inside") {
    sound("back");
    paintHelpHere();
    armBrowse();
  } else {
    backToWall();
  }
}

/* Put away without a sound or a legend, for a caller about to draw another
   screen, as dropFanPage is. Answers whether the page was up. */
export function dropHbPage() {
  if (!hbOpen()) { return false; }
  L("NAV", "homebrew put away for another screen");
  hbHide();
  return true;
}

// The consoles the list holds, as the select's choices.
function hbConsoles() {
  var was = HB.consoles.value, seen = [];
  HB.consoles.textContent = "";
  var all = el("option", null, "All consoles");
  all.value = "";
  HB.consoles.appendChild(all);
  hbGames.forEach(function (g) {
    if (seen.indexOf(g.console) >= 0) { return; }
    seen.push(g.console);
    var o = el("option", null, g.console);
    o.value = g.console;
    HB.consoles.appendChild(o);
  });
  HB.consoles.value = seen.indexOf(was) >= 0 ? was : "";
}

// A team's name without its members, for a tile; the panel names everyone.
function hbShortTeam(team) { return team.replace(/\s*\(.*$/, ""); }

function hbPic(url, img, onNone) {
  if (!url) { onNone(); return; }
  img.onerror = onNone;
  img.src = url;
}

// A tile as the panel reads: the game's name over its picture, who made it under it.
function hbTile(g) {
  var t = el("div", "tile");
  var cap = el("div", "cap", g.name);
  if (g.place) {
    var mark = el("span", "bdg");
    mark.appendChild(el("span", "b-hack", PLACES[g.place].toUpperCase()));
    cap.appendChild(mark);
  }
  t.appendChild(cap);
  var img = el("img", "shot as-shot");
  img.alt = "";
  t.appendChild(img);
  hbPic(g.pic, img, function () { img.replaceWith(el("div", "noart fan-noart", g.name.toUpperCase())); });
  t.appendChild(el("div", "fan-st" + (g.mine ? " ok" : ""), g.mine ? "In your library" : "by " + hbShortTeam(g.team)));
  return t;
}

// The grid again, under the filters: yours first, then each jam, keeping the chosen game where it still shows.
function hbDraw() {
  var was = hbShown[hbAt] ? hbShown[hbAt].g.id : null;
  var c = HB.consoles.value, words = HB.find.value.trim().toLowerCase();
  HB.grid.textContent = "";
  hbShown = [];
  var lot = hbGames.filter(function (g) {
    return (!c || g.console === c) && (!words || (g.name + " " + g.team + " " + g.about + " " + g.jam).toLowerCase().indexOf(words) >= 0);
  });
  var sections = [{ name: "In your library", games: lot.filter(function (g) { return g.mine; }) }];
  lot.forEach(function (g) {
    if (g.mine) { return; }
    var s = sections.filter(function (x) { return x.name === g.jam; })[0];
    if (!s) { s = { name: g.jam, games: [] }; sections.push(s); }
    s.games.push(g);
  });
  sections.forEach(function (s) {
    if (!s.games.length) { return; }
    var h = el("div", "ghead");
    h.appendChild(el("span", "ghead-name", s.name));
    h.appendChild(el("span", "ghead-n", String(s.games.length)));
    HB.grid.appendChild(h);
    s.games.forEach(function (g) {
      var t = hbTile(g), at = hbShown.length;
      t.addEventListener("click", function () { if (at !== hbAt) { hbGo(at); } });
      HB.grid.appendChild(t);
      hbShown.push({ g: g, tile: t });
    });
  });
  if (!hbShown.length) {
    HB.grid.appendChild(el("div", "fan-wait", hbGames.length ? "No game passes these filters." : "No games to show."));
    HB.hero.textContent = "";
    HB.first = null;
    return;
  }
  var i = hbShown.findIndex(function (s) { return s.g.id === was; });
  hbGo(i >= 0 ? i : 0, true);
}

function hbGo(i, quiet) {
  if (!hbShown.length) { return; }
  hbAt = Math.max(0, Math.min(hbShown.length - 1, i));
  hbShown.forEach(function (s, k) { s.tile.classList.toggle("sel", k === hbAt); });
  hbShown[hbAt].tile.scrollIntoView({ block: "nearest" });
  if (!quiet) { sound("move"); }
  hbPanel(hbShown[hbAt].g);
}

// The places a game lives, in the order its buttons stand: its website, its source, its community, its jam.
var HB_LINKS = [["page", "Website"], ["repo", "GitHub"], ["community", "Community"], ["jamPage", "The jam"]];

// The panel beside the grid: the game and everyone who made it over its picture; what it is, their own words and its buttons under it.
function hbPanel(g) {
  HB.hero.textContent = "";
  var top = el("div", "fan-top");
  top.appendChild(el("div", "fan-kind", "Homebrew · " + g.console));
  var h = el("h3");
  h.appendChild(el("span", "hero-name", g.name));
  top.appendChild(h);
  top.appendChild(el("div", "fan-by", "by " + g.team));
  // The work it stands on, credited with its makers.
  if (g.basedon) { top.appendChild(el("div", "fan-by fan-based", "made with " + g.basedon)); }
  HB.hero.appendChild(top);

  var frame = el("div", "hero-art-frame");
  var img = el("img", "hero-art");
  img.alt = "";
  frame.appendChild(img);
  hbPic(g.pic, img, function () { img.replaceWith(el("div", "hero-noart", "NO ART")); });
  HB.hero.appendChild(frame);

  var info = el("div", "hero-info");
  if (g.place) {
    var pills = el("div", "pills");
    pills.appendChild(el("span", "pill", PLACES[g.place] + ", " + g.jam));
    info.appendChild(pills);
  }
  info.appendChild(el("p", "fan-adds", g.about));
  if (g.warn) { info.appendChild(el("p", "hb-warn", "Its makers warn: " + g.warn)); }
  if (g.notes) { info.appendChild(el("p", "hb-says", "Its makers say: " + g.notes)); }
  var stats = el("div", "hero-stats");
  function kv(k, v) { stats.appendChild(el("span", "k", k)); stats.appendChild(el("span", "v", v)); }
  kv("Made for", g.jam + (g.theme ? " (theme: " + g.theme + ")" : ""));
  if (g.mine) { kv("Yours", g.mine.version || "a copy"); }
  if (g.emulator) { kv("Plays in", g.emulator); }
  if (g.tested) { kv("Tested on", g.tested); }
  kv("Licence", g.licence);
  if (g.picsBy) { kv("Pictures", g.picsBy); }
  if (g.page) { kv("Website", fanAddress(g.page)); }
  if (g.repo) { kv("GitHub", fanAddress(g.repo)); }
  info.appendChild(stats);
  HB.hero.appendChild(info);

  var bar = el("div", "bar");
  HB.first = hbFirst(g);
  bar.appendChild(HB.first);
  HB_LINKS.forEach(function (w) {
    if (!g[w[0]]) { return; }
    var b = fanButton(w[1], function () { hbOpenUrl(g, w[0] === "jamPage" ? "jam" : w[0]); });
    b.title = fanAddress(g[w[0]]);
    bar.appendChild(b);
  });
  HB.hero.appendChild(bar);
}

// The panel's first button is the next thing to do for this game; A on a pad presses it.
function hbFirst(g) {
  if (g.mine) {
    return fanButton("Play", function () {
      L("HBRW", "play " + g.name + " (" + g.mine.id + ")");
      launchNow({ id: g.mine.id, title: g.mine.title, platform: g.mine.platform, local: g.mine.local }, null);
    }, true);
  }
  var waiting = HB.getting ? "A game is on its way: the bar in the corner shows how far it is" : null;
  return fanButton(HB.getting === g.id ? "On its way" : "Get", function () {
    if (g.needsAres) { hbAskAres(g); } else { hbGet(g, false); }
  }, true, waiting);
}

// The team's or the jam's place in your own browser: the server opens what the list names, never an address from here.
function hbOpenUrl(g, which) {
  postJson("api/homebrew.php", { open: g.id, which: which }).then(function (r) {
    if (!r || !r.ok) {
      showStrip(g.name + "'s page did not open: " + ((r && r.error) || "no answer"), true);
      return;
    }
    L("HBRW", "open " + which + " of " + g.name);
    sound("select");
    showStrip("Opened " + r.url.replace(/^https:\/\//, "") + " in your browser", false);
  });
}

function hbPress() {
  var b = HB && HB.first;
  if (!b) { return; }
  if (b.disabled) { showStrip(b.title, false); sound("back"); return; }
  b.click();
}

function hbStep(dx, dy) {
  var best = gridNear(hbShown, hbAt, dx, dy);
  if (best >= 0) { hbGo(best); }
}

/* The keys while the page is up: arrows walk the tiles, Enter presses the
   panel's first button, Esc goes back, and typing finds. The find box and
   the select keep their own keys until Esc or Down. Answers whether the
   key was the page's. */
export function hbKeys(e) {
  if (!hbOpen()) { return false; }
  var tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "SELECT") {
    if (e.key === "Escape" || (e.key === "ArrowDown" && tag === "INPUT") || e.key === "Enter") { e.target.blur(); e.preventDefault(); }
    return true;
  }
  if (e.key === "ArrowRight") { hbStep(1, 0); }
  else if (e.key === "ArrowLeft") { hbStep(-1, 0); }
  else if (e.key === "ArrowDown") { hbStep(0, 1); }
  else if (e.key === "ArrowUp") { hbStep(0, -1); }
  else if (e.key === "Home") { hbGo(0); }
  else if (e.key === "End") { hbGo(hbShown.length - 1); }
  else if (e.key === "Enter" || e.key === " ") { hbPress(); }
  else if (e.key === "Escape" || e.key === "Backspace") { closeHbPage(); }
  else if (e.key.length === 1 && !e.ctrlKey && !e.altKey) { HB.find.focus(); return true; }
  else { return true; }
  e.preventDefault();
  return true;
}

/* The pad while the page is up: the cross walks the tiles (held, it steps
   on), A presses the panel's first button, X opens their page, B goes back.
   Answers the buttons as they stand, for the next poll to compare. */
export function hbPad(k, prev) {
  var d = k.right ? [1, 0] : k.left ? [-1, 0] : k.down ? [0, 1] : k.up ? [0, -1] : null;
  var key = d ? d.join() : "", now = Date.now(), padSet = S.controller || {};
  if (!d) { hbPadAt = 0; }
  else if (key !== prev.fd) { hbStep(d[0], d[1]); hbPadAt = now + (padSet.repeatDelayMs || 400); }
  else if (now >= hbPadAt) { hbStep(d[0], d[1]); hbPadAt = now + (padSet.repeatRateMs || 110); }
  if (k.a && !prev.a) { hbPress(); }
  if (k.x && !prev.x && hbShown[hbAt]) { hbOpenUrl(hbShown[hbAt].g, hbShown[hbAt].g.page ? "page" : "repo"); }
  if (k.b && !prev.b) { closeHbPage(); }
  return { a: k.a, b: k.b, x: k.x, y: k.y, fd: key };
}
