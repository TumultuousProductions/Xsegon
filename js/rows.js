/*  The rows view: the chosen game large across the top, and under it rows of
    box art, each a different way into the same games: Continue playing,
    Favourites, Recently added, the best rated never played, one row per genre.
    Built from the games the page holds, so every filter and sort still works.
    A game can be on screen more than once, so the selection is a card (row,
    place), and sel follows it. Nothing may run off the screen: the rows scroll
    inside the view, each row sideways inside itself. */

import { addsMissing } from "./missing.js";
import { $details, $editor, $main, $view, S, addedSince, games, sel, setSel } from "./state.js";
import { artUrl, discShort, discWords, el, fixMark, hhmm, platformBeside, stars, titleText, versionsBadge } from "./util.js";

var R = { forGames: null, rows: [], r: 0, c: 0, mem: {}, lastId: null, lastKey: null, band: null, list: null };

var ADDED_DAYS = 30;                      // until the server has said where Recently added starts
var TOP = 24;                             // how many the made-up rows hold at most
var MIN_GENRE = 4;                        // a smaller genre gets no row of its own

// ---------- the rows ----------

function firstGenre(g) {
  var s = String(g.genre || "").split(";")[0].trim();
  return s || "Other";
}

function sections() {
  var idx = games.map(function (g, i) { return i; });
  var out = [];
  var add = function (key, label, items) { if (items.length) { out.push({ key: key, label: label, items: items }); } };

  add("recent", "Continue playing", idx.filter(function (i) { return !!games[i].lastPlayed; })
    .sort(function (a, b) { return String(games[b].lastPlayed).localeCompare(String(games[a].lastPlayed)); })
    .slice(0, TOP));
  add("fav", "Favourites", idx.filter(function (i) { return !!games[i].favourite; }));
  // The same stretch as the Recently added collection (api\library.php).
  var cutoff = addedSince || new Date(Date.now() - ADDED_DAYS * 86400000).toISOString().slice(0, 10);
  add("added", "Recently added", idx.filter(function (i) { return !!games[i].addedAt && games[i].addedAt >= cutoff; })
    .sort(function (a, b) { return String(games[b].addedAt).localeCompare(String(games[a].addedAt)); })
    .slice(0, TOP));
  add("try", "Never played, best rated", idx.filter(function (i) { return !games[i].plays && games[i].rating > 0; })
    .sort(function (a, b) { return games[b].rating - games[a].rating; })
    .slice(0, TOP));

  // One row per genre, the biggest first.
  var byGenre = {};
  idx.forEach(function (i) { var k = firstGenre(games[i]); (byGenre[k] = byGenre[k] || []).push(i); });
  Object.keys(byGenre)
    .sort(function (a, b) { return byGenre[b].length - byGenre[a].length || a.localeCompare(b); })
    .forEach(function (k) {
      if (k !== "Other" && byGenre[k].length >= MIN_GENRE) { add("g:" + k, k, byGenre[k]); }
    });
  /* Everything else is exactly what no row above shows, in the sort's order:
     repeating games from the rows above reads as a second copy of the library. */
  var shown = {};
  out.forEach(function (rw) { rw.items.forEach(function (i) { shown[i] = true; }); });
  add("rest", out.length ? "Everything else" : "All games", idx.filter(function (i) { return !shown[i]; }));
  return out;
}

// ---------- building ----------

/* wire(node, gameIndex, row, place): the click and right-click, which
   views.js owns because they are the same contract as every other view.
   gear: the size button (viewsize.js), for the band's corner. */
export function buildRows(wire, gear) {
  $view.textContent = "";
  if (sizeWatch) { sizeWatch.disconnect(); }   // the old rows are gone
  R.forGames = games;
  R.rows = sections();

  R.band = buildBand();
  if (gear) { R.band.box.appendChild(gear); }
  $view.appendChild(R.band.box);

  R.list = el("div", "rows-list");
  R.rows.forEach(function (rw, r) {
    var box = el("section", "rrow");
    box.dataset.key = rw.key;
    var head = el("div", "rrow-head");
    head.appendChild(el("span", "rrow-name", rw.label));
    head.appendChild(el("span", "rrow-n", String(rw.items.length)));
    box.appendChild(head);
    var track = el("div", "rrow-track");
    rw.nodes = rw.items.map(function (i, c) {
      var g = games[i];
      var n = el("div", "rcard" + (g.favourite ? " fav" : "") + (g.playable ? "" : " dead"));
      if (g.hasArt) {
        var img = el("img", "rcard-art");
        img.src = artUrl(g, "box");
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        n.appendChild(img);
      } else {
        n.appendChild(el("div", "rcard-noart", titleText(g)));
      }
      var rcap = el("div", "rcard-cap", titleText(g));
      platformBeside(rcap, g);
      n.appendChild(rcap);
      var vb = versionsBadge(g);           // several versions on one card
      if (vb) { n.appendChild(vb); }
      n.title = titleText(g);
      n.dataset.id = g.id;                   // titles repeat across consoles; the id does not
      fixMark(n, g);                         // greyed under NEEDS FIX (util.js)
      wire(n, i, r, c);
      track.appendChild(n);
      return n;
    });
    rw.track = track;
    box.appendChild(track);
    wireTrack(box, track);
    R.list.appendChild(box);
  });
  $view.appendChild(R.list);
  wireOutside();

  // Back to the card you were on, when it is still here (after a reload, a
  // favourite, a game played); otherwise the top left.
  R.r = 0; R.c = 0;
  if (R.lastId !== null) {
    var at = find(R.lastId, R.lastKey);
    if (at) { R.r = at.r; R.c = at.c; }
  }
  if (R.rows.length) { setSel(cur()); }
}

/* The way along a row, with no scrollbar: a row with more past an edge fades
   there, with a chevron under a mouse. The wheel moves the row sideways and at
   its end walks the rows (Settings > Xsegon Controls > Scroll wheel turns the rim). */
function wireTrack(box, track) {
  var sync = function () {
    box.classList.toggle("can-l", track.scrollLeft > 2);
    box.classList.toggle("can-r", track.scrollLeft + track.clientWidth < track.scrollWidth - 2);
  };
  track.addEventListener("scroll", sync, { passive: true });
  [-1, 1].forEach(function (dir) {
    var b = el("button", "rrow-more " + (dir < 0 ? "less" : "more"), dir < 0 ? "‹" : "›");
    b.type = "button";
    b.tabIndex = -1;                       // the arrows walk the cards; Tab has no business here
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      track.scrollBy({ left: dir * Math.round(track.clientWidth * 0.8), behavior: "smooth" });
    });
    box.appendChild(b);
  });
  if (!S.controller || S.controller.wheelTurns === undefined || S.controller.wheelTurns) {
    track.addEventListener("wheel", function (e) {
      if (!e.deltaY || e.deltaX) { return; }         // a sideways gesture already goes sideways
      var can = e.deltaY > 0 ? track.scrollLeft + track.clientWidth < track.scrollWidth - 2
                             : track.scrollLeft > 2;
      if (!can) { return; }                          // at the end: the page scrolls as normal
      e.preventDefault();
      track.scrollLeft += (e.deltaY > 0 ? 1 : -1) * 130;
    }, { passive: false });
  }
  requestAnimationFrame(sync);             // measured once the row has its width
  watchSize(track, sync);
}

/* And again whenever the row or its cards change size: a row built before the
   view had its final size would keep a stale fade. One watcher for every row, dropped with the rows. */
var sizeWatch = null, sizeSyncs = new WeakMap();
function watchSize(track, sync) {
  if (!window.ResizeObserver) { return; }
  if (!sizeWatch) {
    sizeWatch = new ResizeObserver(function (seen) {
      seen.forEach(function (s) {
        var f = sizeSyncs.get(s.target.closest(".rrow-track"));
        if (f) { f(); }
      });
    });
  }
  sizeSyncs.set(track, sync);
  sizeWatch.observe(track);
  if (track.firstElementChild) { sizeWatch.observe(track.firstElementChild); }
}

/* The wheel on the empty sides of the page, or on the band, walks the rows:
   nothing under it scrolls, so otherwise it does nothing at all. */
var outGoal = null, outRaf = 0, outSet = null, outPrev = 0, outWired = false;
function wireOutside() {
  if (outWired) { return; }
  outWired = true;
  document.addEventListener("wheel", function (e) {
    var lst = R.list, t = e.target;
    if (!lst || !lst.isConnected || !$view.classList.contains("rowsview") || !$details.hidden || !$editor.hidden) { return; }
    if (!e.deltaY || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { return; }
    if (!(t === document.body || t === document.documentElement || t === $main || t === $view ||
          (t.classList && t.classList.contains("wrap")) || (R.band && R.band.box.contains(t)))) { return; }
    e.preventDefault();
    var px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * lst.clientHeight : e.deltaY;
    if (outGoal === null) { outGoal = lst.scrollTop; }
    outGoal = Math.max(0, Math.min(lst.scrollHeight - lst.clientHeight, outGoal + px));
    outSet = lst.scrollTop;
    if (!outRaf) { outPrev = 0; outRaf = requestAnimationFrame(outStep); }
  }, { passive: false });
}
// Eased like the list's wheel (listglide.js); anything else moving the rows stops it.
function outStep(t) {
  outRaf = 0;
  var lst = R.list;
  if (outGoal === null || !lst || !lst.isConnected || Math.abs(lst.scrollTop - outSet) > 2) { outGoal = null; return; }
  var dt = outPrev ? Math.min(0.05, (t - outPrev) / 1000) : 1 / 60;
  outPrev = t;
  var before = lst.scrollTop;
  lst.scrollTop = before + (outGoal - before) * (1 - Math.exp(-dt / 0.07));
  if (lst.scrollTop === before || Math.abs(outGoal - lst.scrollTop) < 1) { lst.scrollTop = outGoal; outGoal = null; return; }
  outSet = lst.scrollTop;
  outRaf = requestAnimationFrame(outStep);
}

function buildBand() {
  var b = { box: el("div", "rows-band") };
  var pic = el("div", "rows-pic");
  b.img = el("img", "rows-art");
  b.img.alt = "";
  b.noart = addsMissing(el("div", "hero-noart", "NO ART"), function () { return games[sel]; }, "art");
  pic.appendChild(b.img);
  pic.appendChild(b.noart);
  b.box.appendChild(pic);
  var words = el("div", "rows-words");
  b.title = el("div", "rows-title");
  b.meta = el("div", "rows-meta");
  b.stars = el("div", "rows-stars");
  b.hist = el("div", "rows-hist");
  b.disc = el("div", "rows-disc");
  [b.title, b.meta, b.stars, b.disc, b.hist].forEach(function (n) { words.appendChild(n); });
  b.box.appendChild(words);
  return b;
}

// ---------- where the selection is ----------

export function rowsFresh() { return R.forGames === games && !!R.list && R.list.isConnected; }
export function rowsStale() { R.forGames = null; }
// Leaving the view: the next visit starts at the top left.
export function rowsForget() { R.forGames = null; R.lastId = null; R.lastKey = null; R.mem = {}; R.list = null; R.band = null; }

function cur() { var rw = R.rows[R.r]; return rw ? rw.items[R.c] : -1; }
export function rowsCur() { return cur(); }

function find(id, key) {
  var best = null;
  R.rows.forEach(function (rw, r) {
    rw.items.forEach(function (i, c) {
      if (games[i].id !== id) { return; }
      if (!best || (rw.key === key && R.rows[best.r].key !== key)) { best = { r: r, c: c }; }
    });
  });
  return best;
}

/* sel was set by something else (Home, End, a random game): find it, in
   the row you are on if it is there. */
export function rowsSync() {
  if (!R.rows.length || cur() === sel) { return; }
  var g = games[sel];
  var here = R.rows[R.r] && R.rows[R.r].items.indexOf(sel);
  if (here >= 0) { R.c = here; return; }
  var at = g && find(g.id, null);
  if (at) { R.r = at.r; R.c = at.c; }
}

/* A step: dx along the row, dy between rows. Returns the game index now
   chosen, or -1 when there was nowhere to go. Each row remembers where you
   left it, the way a streaming app's rows do. */
export function rowsStep(dx, dy) {
  if (!R.rows.length) { return -1; }
  var r = R.r, c = R.c;
  if (dy) {
    r = Math.max(0, Math.min(R.rows.length - 1, R.r + dy));
    if (r === R.r) { return -1; }
    R.mem[R.rows[R.r].key] = R.c;
    c = Math.min(R.mem[R.rows[r].key] || 0, R.rows[r].items.length - 1);
  } else if (dx === Infinity || dx === -Infinity) {
    c = dx > 0 ? R.rows[r].items.length - 1 : 0;
  } else {
    c = Math.max(0, Math.min(R.rows[r].items.length - 1, R.c + dx));
  }
  if (r === R.r && c === R.c) { return -1; }
  R.r = r; R.c = c;
  return cur();
}

export function rowsPick(r, c) { R.r = r; R.c = c; return cur(); }
export function rowsIsCard(r, c) { return R.r === r && R.c === c; }
export function rowsNode() { var rw = R.rows[R.r]; return rw && rw.nodes ? rw.nodes[R.c] : null; }
export function rowsArt() { return R.band ? R.band.img : null; }
export function rowsBand() { return R.band ? R.band.box : null; }
// How many cards a row shows across at this size, for the size window (viewsize.js).
export function rowsAcross() {
  var rw = R.rows[R.r] || R.rows[0], n = rw && rw.nodes ? rw.nodes[0] : null;
  if (!n || !n.offsetWidth) { return 1; }
  return Math.max(1, Math.floor((rw.track.clientWidth + 12) / (n.offsetWidth + 12)));
}

// ---------- drawing the selection ----------

/* The highlight and the scrolling, done by hand rather than with
   scrollIntoView, which also scrolls every box around it (the page
   included) and has no room-either-side. */
export function rowsPaint() {
  $view.querySelectorAll(".rcard.sel, .rrow.cur").forEach(function (n) { n.classList.remove("sel", "cur"); });
  var rw = R.rows[R.r];
  if (!rw) { return; }
  var n = rw.nodes[R.c];
  n.classList.add("sel");
  rw.track.parentNode.classList.add("cur");
  R.lastId = games[cur()].id;
  R.lastKey = rw.key;

  var t = rw.track, room = n.offsetWidth;
  if (n.offsetLeft - room < t.scrollLeft) { t.scrollLeft = Math.max(0, n.offsetLeft - room); }
  else if (n.offsetLeft + n.offsetWidth + room > t.scrollLeft + t.clientWidth) {
    t.scrollLeft = n.offsetLeft + n.offsetWidth + room - t.clientWidth;
  }
  var box = rw.track.parentNode, lst = R.list;
  if (box.offsetTop < lst.scrollTop) { lst.scrollTop = box.offsetTop; }
  else if (box.offsetTop + box.offsetHeight > lst.scrollTop + lst.clientHeight) {
    lst.scrollTop = box.offsetTop + box.offsetHeight - lst.clientHeight;
  }
}

// The band's picture keeps up with every step; its words wait for a rest
// (views.js settle), the same as the info panel.
export function rowsPaintArt(g) {
  var b = R.band;
  if (!b || !g) { return; }
  var kind = g.hasFanart ? "fanart" : g.hasShot ? "shot" : g.hasArt ? "box" : "";
  b.box.classList.toggle("as-box", kind === "box");
  b.img.hidden = !kind;
  b.noart.hidden = !!kind;
  if (kind) {
    var url = artUrl(g, kind);
    if (b.img.getAttribute("src") !== url) { b.img.src = url; }
  }
  fixMark(b.img.parentNode, g);
}

export function rowsPaintWords(g) {
  var b = R.band;
  if (!b || !g) { return; }
  b.title.textContent = titleText(g);
  b.meta.textContent = [g.platform, (g.released || "").slice(0, 4), g.genre ? firstGenre(g) : ""].filter(Boolean).join("  ·  ");
  b.stars.textContent = "";
  if (g.rating) { b.stars.appendChild(stars(g.rating)); }
  b.disc.textContent = discShort(g);
  b.disc.title = discWords(g);
  b.disc.className = "rows-disc" + (g.discs && !g.discs.set ? " warn" : "");
  b.hist.textContent = g.plays
    ? "played " + g.plays + (g.plays === 1 ? " time" : " times") + (g.seconds ? ", " + hhmm(g.seconds) : "") +
      (g.lastPlayed ? "  ·  last " + g.lastPlayed.slice(0, 10) : "")
    : "never played";
  b.box.classList.toggle("fav", !!g.favourite);
}
