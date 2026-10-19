/*  The rows themselves: asking the server for them, keeping the platform
    and collection lists that ride the rim and fill the dropdown, and the
    things that pick rows rather than draw them: surprise me, and the Filter
    by list behind the funnel in the search box.                            */

import { bootCopyOn, bootRead, bootSave } from "./bootcopy.js";
import { openDetails } from "./details.js";
import { setHackAsking } from "./hacksettle.js";
import { paintHelpHere } from "./help.js";
import { pick, showStrip } from "./launch.js";
import { L, api, bug } from "./log.js";
import { TIPS } from "./menu-tips.js";
import { moreBegin } from "./more.js";
import { saveSetting } from "./savednote.js";
import { sound } from "./sound.js";
import { $added, $count, $details, $platform, $q, $sort, S, games, sel, setAddedSince, setGames, setSel, sysStage, view } from "./state.js";
import { repaintWall } from "./systems.js";
import { el } from "./util.js";
import { setViewsLocked } from "./viewlock.js";
import { render, setCarNodes, setWheelNodes } from "./views.js";

// ---------- library ----------

/* opts.noDraw: read the rows and the console lists, draw nothing. For the
   consoles screen, which needs the lists and not the games: building the whole
   games wheel out of sight under it is slow, and opening a console reads its
   own rows anyway.

   Only the newest read is drawn: the consoles' quiet read of every game can
   land AFTER a quick Enter has gone inside a console. */
var loadSeq = 0;
// How many games the whole library holds, whatever is shown: 0 is "no games
// yet", which the screens say differently from "nothing matches" (js\setup.js
// noGamesBox). null until the first read.
export var libraryTotal = null;

/* Whether the list held is the one asked for. The search box's typing is
   read 150 ms after the last letter; until that read is back, the games
   held are the ones from before it. */
var answered = 0, cameOk = true, typingT = 0;
export function searchTyped() {
  clearTimeout(typingT);
  typingT = setTimeout(function () { typingT = 0; load(); }, 150);
}
export function listOwed() { return !!typingT || answered !== loadSeq; }
/* Resolves once nothing is owed, with whether the list came: the typing's read goes now. */
export function listSettled() {
  if (typingT) { clearTimeout(typingT); typingT = 0; load(); }
  return new Promise(function (resolve) {
    var until = Date.now() + 15000;
    (function wait() {
      if (!listOwed()) { resolve(cameOk); return; }
      if (Date.now() > until) { answered = loadSeq; resolve(false); return; }   // out this long, it holds nothing back any more
      setTimeout(wait, 30);
    })();
  });
}

export function load(opts) {
  var seq = ++loadSeq;
  paintPlatformFace();                     // the picker says what was chosen at once, not after the read
  paintAddedPeriod();
  var draw = !(opts && opts.noDraw) && sysStage !== "wall";
  var params = new URLSearchParams();
  if ($q.value.trim()) { params.set("q", $q.value.trim()); }
  if ($platform.value) { params.set("platform", $platform.value); }
  params.set("added", periodOf("@added"));      // sent, like reverse: the saved setting may not have landed yet
  params.set("changed", periodOf("@changed"));
  FILTERS.forEach(function (f) { if (filters[f.key]) { params.set(f.key, "1"); } });
  if (filters.myrating) { params.set("myrating", String(filters.myrating)); }
  if (filters.fails) { params.set("fails", "1"); }
  filters.tags.forEach(function (t) { params.append("tag[]", t); });
  params.set("sort", $sort.value);
  // Both ways, or "not reversed" leaves the server reading the saved setting, which may still say reversed.
  if (S.view) { params.set("reverse", S.view.sortReverse ? "1" : "0"); }
  // Headers are for list, grid and shelf; the wheel and carousel are one
  // game at a time and have nowhere to put one.
  params.set("grouped", (S.view && S.view.groupHeaders && (view === "list" || view === "grid" || view === "shelf")) ? "1" : "0");

  var ask = { query: params.toString(), seq: seq, draw: draw, boot: !!(opts && opts.boot && bootCopyOn()) };
  /* A read is out, and the server answers one at a time: this one waits for
     it, in the place of any that was waiting. The one it replaces is never
     sent (its answer would have been dropped as it came), and settles when
     this one does. */
  var behind = readNext ? readNext.then : [];
  if (readOut && Date.now() - readOut <= READ_HELD_MS) {
    return new Promise(function (resolve) { readNext = { ask: ask, then: behind.concat([resolve]) }; });
  }
  readNext = null;
  var sent = sendRead(ask);
  if (behind.length) { sent.then(function () { settle(behind); }, function () { settle(behind); }); }
  return sent;
}
function settle(waiting) { waiting.forEach(function (done) { done(); }); }

/*  One read of the list at a time. Every console, sort, filter and pause in a
    search asks the server, which answers one request at a time and runs a
    dropped one to its end all the same, so aborting does not help. The newest
    waits for the one that is out and the ones between are not sent. Nothing is
    kept: every read sent is answered by the server from the disk. */
var READ_HELD_MS = 8000;                 // a read out this long holds nothing back any more
var readOut = 0, readNo = 0, readNext = null;
var sentAsk = { seq: 0, query: "" };     // the read last sent: what a list's rest is asked with (js\more.js)
function sendRead(ask) {
  var mine = ++readNo;
  readOut = Date.now();
  sentAsk = { seq: ask.seq, query: ask.query };
  var fresh = api("api/library.php?" + ask.query);
  // The opening read draws from last time's copy first (js/bootcopy.js).
  var drawn = ask.boot ? bootLoad(ask.query, fresh, ask.seq, ask.draw)
                       : fresh.then(function (data) { took(data, ask.seq, ask.draw); });
  function back() {
    if (readNo !== mine) { return; }       // given up on, and another has gone since
    readOut = 0;
    var next = readNext;
    readNext = null;
    if (!next) { return; }
    if (next.then.length > 1) { L("API", "library.php: " + (next.then.length - 1) + " overtaken while a read was out, not sent; the newest goes now"); }
    var sent = sendRead(next.ask);
    sent.then(function () { settle(next.then); }, function () { settle(next.then); });
  }
  fresh.then(back, back);
  return drawn;
}

/*  The opening read (js/bootcopy.js says why). Last time's answer to this
    same request is drawn at once, and the promise settles then, so the
    consoles come up without waiting. The library is read as always, and when
    it answers:
      the same        nothing happens
      different       drawn once more from the fresh answer, on the game or
                      console you were on
      no answer       the copy stays up, and the usual line says the games
                      could not be read
    With nothing kept (a first start, another view, a new build) this is the
    ordinary first load. XSEGON.libraryFresh is false from the moment a copy
    is drawn until the fresh answer has been dealt with: the tests wait on it,
    so none of them reads a screen that is about to change. */
function bootLoad(query, fresh, seq, draw) {
  var shown = null, freshIn = false;
  var first = bootRead(query).then(function (kept) {
    if (!kept || freshIn || seq !== loadSeq) { return false; }
    shown = kept.text;
    window.XSEGON.libraryFresh = false;
    L("BOOT", "drawn from last time's copy (" + kept.data.games.length + " games) while the library is read");
    took(kept.data, seq, draw);
    return true;
  });
  var later = fresh.then(function (data) {
    freshIn = true;
    return first.then(function () {
      var text = data && data.ok ? bootSave(query, data) : null;
      if (shown === null || text === null) { took(data, seq, draw); }
      else if (text === shown) { L("BOOT", "last time's copy was current: nothing to draw again"); }
      else if (seq !== loadSeq) { L("BOOT", "last time's copy was out of date, and a newer read has already replaced it"); }
      else { swapIn(data, seq); }
      window.XSEGON.libraryFresh = true;
    });
  });
  later.catch(function (e) { window.XSEGON.libraryFresh = true; bug("the opening library read", e); });
  return first.then(function (drawn) { return drawn ? undefined : later; });
}

/* The fresh answer over an out-of-date copy: everything read again, drawn
   once, and your place kept (the console you were on, or the game). */
function swapIn(data, seq) {
  var keep = games[sel] ? games[sel].id : null;
  took(data, seq, false);
  if (sysStage === "wall") {
    repaintWall();
    L("BOOT", "last time's copy was out of date: the consoles drawn again from the fresh library");
    return;
  }
  var i = keep === null ? -1 : games.findIndex(function (g) { return g.id === keep; });
  if (i >= 0) { setSel(i); }
  render();
  if (!$details.hidden && games[sel]) { openDetails(); }
  L("BOOT", "last time's copy was out of date: drawn again from the fresh library" + (i >= 0 ? ", on the same game" : ""));
}

/* One answer from api/library.php, taken in and (unless draw is false, or
   the consoles are up) drawn. */
function took(data, seq, draw) {
    if (seq !== loadSeq) { return; }               // a newer read is on its way
    answered = seq;
    cameOk = !!data.ok;
    if (!data.ok) {
      // Said on screen, not only in the log: a silent return here leaves the
      // OLD rows under a lit funnel, or a first load stuck on nothing at
      // all. The next press asks again.
      showStrip("the games could not be read: " + (data.error || "the server did not answer"), true);
      return;
    }
    var wasEmpty = libraryTotal === 0;
    libraryTotal = typeof data.total === "number" ? data.total : libraryTotal;
    setGames(data.games || []);
    setSel(0);
    setWheelNodes(null);               // wheel and carousel nodes match one games array
    setCarNodes(null);
    // A list longer than its first lot: the rest is added as it goes, once a view is drawn (js\more.js).
    moreBegin(sentAsk.seq === seq ? sentAsk.query : null, data, function () { load(); });
    if (data.platforms) { platformsAll = data.platforms; }
    if (data.collections) { collectionsAll = data.collections; }
    filtered = data.filtered || null;
    if (data.tags) { tagsAll = data.tags; }
    if (data.platformArtRev) { platformArtRev = data.platformArtRev; }
    if (data.addedSince) { setAddedSince(data.addedSince); }
    // Wheel, Carousel and the consoles screen: open the moment an emulator is in (js\viewlock.js).
    if (typeof data.viewsLocked === "boolean") { setViewsLocked(data.viewsLocked, data.viewsWaitRa); }
    setHackAsking(data.hackAsk);
    // The dropdown is filled again when the filters or what it lists change,
    // still naming what it named: a value with no option reads as every game.
    if (platformsFilled && (filledFor !== filterKey() || filledRev !== platformArtRev || filledRows !== JSON.stringify(dropdownRows(platformsAll)))) { refillPlatforms(); }
    else { fillPlatforms(data.platforms); }
    noteShowcases();
    // Before the drawing, which puts the count on the strip over the table.
    $count.textContent = (data.count ?? "?") + " of " + (data.total ?? "?");
    // A random order is made new at every read and has no rest to ask for: how many are shown is said.
    if (!data.sig && data.count > (data.games || []).length) { $count.textContent = data.games.length + " shown of " + data.count; }
    paintPlatformFace();                   // the pictures' revision may have moved
    if (draw) { render(); }
    // The consoles screen is not drawn from here: when the first games have
    // just arrived (or the last gone), it is built again to say so.
    else if (sysStage === "wall" && wasEmpty !== (libraryTotal === 0)) { repaintWall(); }
}

/* What the platform dropdown holds, in words: a console's name, a
   collection's label, or all of them. */
function platformLabel(key) {
  if (!key) { return "All platforms"; }
  var c = collectionsAll.find(function (x) { return x.key === key; });
  return c ? c.label : key;
}

/* The picker's face (index.php #pfpick): the chosen console's icon, as the
   sidebar shows it (yours, or RetroArch's that ship with
   Xsegon: api\image.php?kind=icon); failing that the
   console's own picture; failing both a glyph, the sidebar's (a star for a
   collection), or four squares for all of them. The dropdown lies over it
   see-through, and everything that changes it asks for a read, which
   repaints this. An icon, not the name, which crowds the bar. */
var faceKey = null;
function paintPlatformFace() {
  var face = document.getElementById("pf-face");
  if (!face) { return; }
  var key = $platform.value;
  if (key + "|" + platformArtRev + "|" + collectionsAll.length === faceKey) { return; }
  faceKey = key + "|" + platformArtRev + "|" + collectionsAll.length;   // the labels arrive with the first read
  face.parentNode.title = platformLabel(key);
  var img = face.querySelector(".pf-ico"), all = face.querySelector(".pf-all"), glyph = face.querySelector(".pf-glyph");
  var tries = [platformArtUrl(key || "@all", "icon")];
  if (key && key.charAt(0) !== "@") { tries.push(platformArtUrl(key, "device")); }
  // The four squares are an svg, which has no `hidden` property: the attribute is set itself.
  var squares = function (show) { all.toggleAttribute("hidden", !show); };
  var next = function () {
    var src = tries.shift();
    img.hidden = !src; squares(false); glyph.hidden = true;
    if (src) { img.src = src; return; }
    img.removeAttribute("src");
    if (!key) { squares(true); return; }
    glyph.textContent = key.charAt(0) === "@" ? "★" : "▣";
    glyph.hidden = false;
  };
  img.onerror = next;
  next();
}

/* How far back Recently added and Recently changed look (view.addedPeriod,
   view.changedPeriod), each its own. The dropdown beside the picker is up
   only while one of them is open, and is that one's; on the consoles screen
   each collection's own menu offers the same choices. */
var PERIODS = { "@added": { key: "addedPeriod", none: "month", name: "Recently added" },
                "@changed": { key: "changedPeriod", none: "week", name: "Recently changed" } };
// null for a collection with no stretch of its own.
export function periodOf(c) { var p = PERIODS[c]; return p ? (S.view && S.view[p.key]) || p.none : null; }
// The choices as the setting words them: [key, label].
export function addedPeriods() {
  return Array.prototype.map.call($added.options, function (o) { return [o.value, o.text]; });
}
// Recently added opens even when empty: its dropdown is inside, so the way to look further back is there.
export function opensEmpty(c) { return c === "@added"; }
// What an empty list says inside such a collection: the server's reason, and where to look further back.
export function addedEmptyWords() {
  var c = collectionsAll.find(function (x) { return x.key === $platform.value; });
  if (!c || !opensEmpty(c.key) || !c.note) { return ""; }
  return c.note + (periodOf(c.key) !== "year" ? ": the dropdown at the top looks further back" : "");
}
function paintAddedPeriod() {
  var p = PERIODS[$platform.value];
  $added.hidden = !p;
  if (!p) { return; }
  $added.value = periodOf($platform.value);
  $added.title = "How far back " + p.name + " looks";
  $added.setAttribute("aria-label", p.name + " goes back");
}
export function setPeriod(c, v) {
  var p = PERIODS[c];
  if (!p || v === periodOf(c)) { return; }
  L("SET", p.key + " " + v);
  S.view = S.view || {};
  S.view[p.key] = v;
  sound("select");
  var w = {};
  w[p.key] = v;
  saveSetting({ view: w }, "How far back " + p.name + " looks");
  // The consoles screen draws no rows, only its numbers: ask, then draw the rim again.
  if (sysStage === "wall") {
    load({ noDraw: true }).then(function () { if (sysStage === "wall") { repaintWall(); } });
  } else {
    load();
  }
}

/* The strip heading the list and the grid: what is shown and how many, on
   one thin line. views.js puts it first in the box; the stylesheet keeps it
   stuck to the top (.vcap). */
export function capStrip() {
  var s = el("div", "vcap");
  s.appendChild(el("span", "vcap-name", platformLabel($platform.value)));
  s.appendChild(el("span", "vcap-n", $count.textContent));
  return s;
}

/* A number that changes whenever a console's pictures might have: added to
   their addresses so the browser can keep each one for a year and still see
   a new one the moment it is chosen (api\image.php, api\library.php). */
export var platformArtRev = 0;
export function setPlatformArtRev(v) { platformArtRev = v; }

/* A console's picture, by kind (clearlogo, device, icon; none is the logo
   chain), at an address that changes when its pictures might have. */
export function platformArtUrl(name, kind) {
  return "api/image.php?platform=" + encodeURIComponent(name) + (kind ? "&kind=" + kind : "") +
         (platformArtRev ? "&v=" + platformArtRev : "");
}

// Each platform's showcase game -- the art its carousel card falls back to
// and the backdrop behind it. Only remembered from an unfiltered load, so a
// search cannot quietly shrink the carousel's idea of the library.
export var platformsAll = null;
export var collectionsAll = [];               // Favourites, Recently played, Never played: from the server
export function setCollectionsAll(v) { collectionsAll = v; }
export function setPlatformsAll(v) { platformsAll = v; }
export var sysShow = {};
// Your tags, every one on a game in the library, with how many carry it
// (api\library.php): what Filter by and a game's Tags list offer.
export var tagsAll = [];
export function setTagsAll(v) { tagsAll = v; }
// While a filter is on, how many pass it, per console and per collection,
// counted by the server whatever console was asked for (api\library.php).
var filtered = null;

/* The consoles and their sizes as things stand: every game, or while a
   filter is on, only what passes, with a console that has none of that left
   out. The rim and the sidebar read this and the dropdown reads the same
   numbers, so the three cannot disagree about what the filters leave. */
export function consoleCounts() {
  if (!anyFilter() || !filtered) { return platformsAll || {}; }
  var out = {};
  Object.keys(platformsAll || {}).forEach(function (name) {
    if (filtered.platforms[name]) { out[name] = filtered.platforms[name]; }
  });
  return out;
}

// A collection's size the same way: all of it, or what of it passes.
export function collectionCount(c) {
  return anyFilter() && filtered ? (filtered.collections[c.key] || 0) : c.count;
}

function noteShowcases() {
  if ($q.value.trim() || $platform.value || anyFilter()) { return; }
  sysShow = {};
  // Fanart outranks box art here: the wall behind the systems wants scenery.
  games.forEach(function (g) {
    var score = (g.hasFanart ? 4 : 0) + (g.hasArt ? 2 : 0) + (g.favourite ? 1 : 0);
    if (!score) { return; }
    var cur = sysShow[g.platform];
    if (!cur || score > cur._score) {
      g._score = score;
      sysShow[g.platform] = g;
    }
    // The Favourites entry shows a favourite; the other two collections
    // show whatever has the best scenery.
    if (g.favourite && (!sysShow["@favourites"] || score > sysShow["@favourites"]._score)) { sysShow["@favourites"] = g; }
    if (!sysShow["@recent"] || score > sysShow["@recent"]._score) { sysShow["@recent"] = g; sysShow["@unplayed"] = g; }
    // Recently added shows the newest arrival that has any scenery at all.
    if (g.addedAt && (!sysShow["@added"] || g.addedAt > sysShow["@added"].addedAt)) { sysShow["@added"] = g; }
    if (g.changedAt && (!sysShow["@changed"] || g.changedAt > sysShow["@changed"].changedAt)) { sysShow["@changed"] = g; }
    // Two players or more shows whatever seats the most people, so the wall
    // picks a real couch game rather than the first two-player game it met.
    // Rating breaks the tie among the many that seat exactly four.
    if (g.players >= 2) {
      var most = sysShow["@players"];
      if (!most || g.players > most.players
          || (g.players === most.players && (g.rating || 0) > (most.rating || 0))) {
        sysShow["@players"] = g;
      }
    }
  });
}

export var platformsFilled = false;
export function setPlatformsFilled(v) { platformsFilled = v; }
var filledFor = "";                           // the filters the dropdown's numbers were counted under
var filledRows = "";                          // and what it listed, so a new list is noticed
var filledRev = 0;                            // and the pictures' revision its icons were asked under

/* The dropdown's options as data: the consoles, then the collections. */
function dropdownRows(map) {
  var rows = [];
  var cut = anyFilter() && filtered;
  Object.keys(map).sort().forEach(function (name) {
    var n = cut ? (filtered.platforms[name] || 0) : map[name];
    // While a filter is on, a console with nothing that passes is listed
    // but not choosable, where the rim leaves it out: the dropdown may be
    // naming it at that moment, and an option that vanished from under its
    // own value would leave the box blank.
    rows.push({ value: name, label: name, n: n, glyph: "▣", off: !n });
  });
  // The collections, after a rule, so the dropdown can hold one the same
  // way the consoles screen opens one (the value is what load() sends).
  if (collectionsAll.length) {
    rows.push({ value: null, label: "----------", off: true });
    collectionsAll.forEach(function (c) {
      // An empty one is listed but not choosable, wearing its reason, so
      // the dropdown and the rim tell the same story; Recently added opens anyway.
      rows.push({ value: c.key, label: c.label, n: c.note || collectionCount(c), glyph: "★", off: !collectionCount(c) && !opensEmpty(c.key) });
    });
  }
  return rows;
}

/* One row of the dropdown, dressed as the sidebar's are: the icon (a glyph
   where there is none, drawn by the stylesheet so the row's words stay its
   name and number), the name, the number. A browser whose dropdown cannot
   draw pictures (css\xsegon.css, .pfpick option) shows the words alone. */
function dressRow(o, key, label, n, glyph) {
  o.textContent = "";
  var ico = el("span", "pf-oico");
  ico.dataset.glyph = glyph;
  var img = el("img");
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.src = platformArtUrl(key || "@all", "icon");
  img.addEventListener("error", function () { img.remove(); ico.classList.add("glyph"); });
  ico.appendChild(img);
  o.appendChild(ico);
  o.appendChild(el("span", "pf-name", label));
  if (n !== undefined) { o.appendChild(el("span", "pf-n", "  (" + n + ")")); }
}

export function fillPlatforms(map) {
  if (platformsFilled || !map) { return; }
  var rows = dropdownRows(map);
  dressRow($platform.options[0], "", "All platforms", undefined, "▦");
  rows.forEach(function (r) {
    var o = el("option");
    if (r.value === null) {
      o.className = "pf-sep";
      o.textContent = r.label;
    } else {
      o.value = r.value;
      dressRow(o, r.value, r.label, r.n, r.glyph);
    }
    o.disabled = r.off;
    $platform.appendChild(o);
  });
  filledFor = filterKey();
  filledRows = JSON.stringify(rows);
  filledRev = platformArtRev;
  platformsFilled = true;
}

/* The dropdown again, with the numbers the filters leave. Rebuilt rather
   than patched, being a couple of dozen options, and left naming whatever
   it named. */
function refillPlatforms() {
  var keep = $platform.value;
  while ($platform.options.length > 1) { $platform.remove(1); }
  platformsFilled = false;
  fillPlatforms(platformsAll);
  $platform.value = keep;
}

// ---------- surprise me ----------
// It picks, scrolls to it, and opens the details; never launches, because
// a wrong guess that starts a game is a rude surprise.

export function randomGame() {
  if (!games.length) { return; }
  var pool = games.filter(function (g) { return g.playable; });
  if (!pool.length) { return; }
  var pick = pool[Math.floor(Math.random() * pool.length)];
  setSel(games.indexOf(pick));
  render();
  openDetails();
}

// ---------- the filters ----------
/* The Filter by list behind the funnel at the right end of the search box,
   the way Steam's library filters: switches that narrow whatever is open, a
   console, a collection or every game, and that stack. The key is the name the
   server takes (api\library.php). While any is on, the consoles screen counts
   only what passes, and the funnel is lit with how many are on.

   Not saved: a filter that outlived the evening would hide half the
   library from whoever sat down next, with nothing on the screen to say
   why. */
// `group` is the section of the Filter by window the switch stands in (js\filterwin.js).
export var FILTERS = [
  { key: "fav",      label: "Favourites only",     word: "favourites",    hint: "F", group: "play" },
  { key: "players",  label: "Two players or more", word: "2+ players",    hint: "2", group: "play" },
  { key: "ready",    label: "Ready to play",       word: "ready to play", hint: "can start now", tip: TIPS.ready, group: "files" },
  { key: "unplayed", label: "Never played",        word: "never played",  hint: null, group: "play" },
  { key: "unrated",  label: "Not rated by you",    word: "not rated by you", hint: null, tip: TIPS.unrated, group: "ratings" },
  { key: "missing",  label: "Missing art",         word: "missing art",   hint: null, tip: TIPS.missingArt, group: "files" },
  { key: "docs",     label: "Has a manual",        word: "has a manual",  hint: null, tip: TIPS.docsOnly, group: "files" },
  { key: "hacks",    label: "Hacks only",          word: "hacks only",    hint: null, tip: TIPS.hacksOnly, group: "hacks" },
  { key: "nohacks",  label: "Leave hacks out",     word: "no hacks",      hint: null, tip: TIPS.noHacks, group: "hacks" },
  { key: "cheats",   label: "Cheats on",           word: "cheats on",     hint: null, tip: TIPS.cheatsOn, group: "play" },
  { key: "texpacks", label: "Has texture packs",   word: "has texture packs", hint: null, tip: TIPS.texPacks, group: "texpacks" },
  { key: "texinstalled", label: "Texture pack installed", word: "texture pack installed", hint: null, tip: TIPS.texInstalled, group: "texpacks" }
];
// tags: the tags selected in Filter by, by name. Each is a condition of its
// own, so two are the games that carry both (api\library.php).
// fails: the games whose last runs check went wrong. Not in FILTERS, so the
// funnel never offers it; the runs check panel's "see them" turns it on,
// and Clear filters turns it off like any other.
// myrating: your rating at least, 1 to 5 stars; 0 is off. The one filter with a value.
export var filters = { fav: false, players: false, ready: false, unplayed: false, unrated: false, missing: false, docs: false, hacks: false, nohacks: false,
                       cheats: false, texpacks: false, texinstalled: false, myrating: 0, fails: false, tags: [] };

function onNow() { return FILTERS.filter(function (f) { return filters[f.key]; }); }
// "your rating 4+", or nothing while it is off.
function ratingWords() {
  return filters.myrating ? ["your rating " + filters.myrating + (filters.myrating < 5 ? "+" : "")] : [];
}
export function anyFilter() { return onNow().length > 0 || filters.myrating > 0 || filters.fails || filters.tags.length > 0; }
export function filterKey() {
  return onNow().map(function (f) { return f.key; })
    .concat(filters.myrating ? ["myrating" + filters.myrating] : [])
    .concat(filters.fails ? ["fails"] : [])
    .concat(filters.tags.map(function (t) { return "#" + t.toLowerCase(); })).join(",");
}
// "2+ players · favourites": what the numbers on the consoles screen count.
export function filterWords() {
  return onNow().map(function (f) { return f.word; })
    .concat(ratingWords())
    .concat(filters.fails ? ["failed the runs check"] : [])
    .concat(filters.tags).join(" · ");
}
export function tagFiltered(name) {
  var key = name.toLowerCase();
  return filters.tags.some(function (t) { return t.toLowerCase() === key; });
}
export function toggleTagFilter(name, quiet) {
  var on = !tagFiltered(name);
  filters.tags = on ? filters.tags.concat([name])
                    : filters.tags.filter(function (t) { return t.toLowerCase() !== name.toLowerCase(); });
  L("NAV", "filter tag " + name + " " + (on ? "on" : "off"));
  afterFilters(quiet);
}

// quiet: from inside the list itself, which makes its own sound as it is
// drawn again, so the press is not heard twice.
export function toggleFilter(key, quiet) {
  filters[key] = !filters[key];
  // Not rated, and rated at least so many, can only ever give an empty list: one lets go of the other.
  if (key === "unrated" && filters.unrated) { filters.myrating = 0; }
  // And so can Hacks only with Leave hacks out.
  if (key === "hacks" && filters.hacks) { filters.nohacks = false; }
  if (key === "nohacks" && filters.nohacks) { filters.hacks = false; }
  // Texture packs is one answer at a time in Filter by, as Hacks is: one lets go of the other.
  if (key === "texpacks" && filters.texpacks) { filters.texinstalled = false; }
  if (key === "texinstalled" && filters.texinstalled) { filters.texpacks = false; }
  L("NAV", "filter " + key + " " + (filters[key] ? "on" : "off"));
  afterFilters(quiet);
}
// Your rating at least n stars; 0 takes it off.
export function setMinRating(n, quiet) {
  filters.myrating = Math.max(0, Math.min(5, n | 0));
  if (filters.myrating) { filters.unrated = false; }
  L("NAV", "filter myrating " + (filters.myrating ? filters.myrating + " and up" : "off"));
  afterFilters(quiet);
}
export function clearFilters(quiet) {
  if (!anyFilter()) { return; }
  FILTERS.forEach(function (f) { filters[f.key] = false; });
  filters.myrating = 0;
  filters.fails = false;
  filters.tags = [];
  L("NAV", "filters cleared");
  afterFilters(quiet);
}
export function toggleFavourites() { toggleFilter("fav"); }
export function togglePlayers() { toggleFilter("players"); }

function afterFilters(quiet) {
  if (!quiet) { sound("select"); }
  paintFilterButton();
  paintHelpHere();
  // The consoles screen draws no rows, only its numbers, and the server
  // counts those under the filters: ask, then draw the rim again.
  if (sysStage === "wall") {
    load({ noDraw: true }).then(function () { if (sysStage === "wall") { repaintWall(); } });
  } else {
    load();
  }
}

/* The funnel: lit, with how many are on, while any is, so a list cut down
   by a filter never passes for the whole console. */
export function paintFilterButton() {
  var b = document.getElementById("btn-filter");
  if (!b) { return; }
  var on = onNow().map(function (f) { return f.label.toLowerCase(); }).concat(ratingWords()).concat(filters.tags);
  b.classList.toggle("on", on.length > 0);
  var n = b.querySelector(".qf-n");
  if (n) { n.textContent = on.length ? String(on.length) : ""; }
  b.title = on.length
    ? "Filtered: " + on.join(", ") + ". Press to change"
    : "Filter by: favourites, two players or more, never played, ready to play, missing art, your rating, your tags";
  // The x on its corner is there only while there is something to clear.
  var x = document.getElementById("btn-filter-clear");
  if (x) { x.hidden = !anyFilter(); }
}
