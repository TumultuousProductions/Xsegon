/*  The Hacks tab of a game's details (js\detailtabs.js): the patches on this
    PC that fit this game's file, as the server found them (includes\hacks.php).

    A press on one opens its own page (js\hackpage.js): what it is, and Play,
    which plays the game with it and leaves the game's file as it is: RetroArch
    patches as it loads, or Xsegon makes a patched copy once (the row above the
    patches says which). Then the games of your own started with this
    file, and the games said to be hacks of this one. And what this game itself
    is (includes\hackof.php): while in doubt, the choices stand first.       */

import { closeDetails } from "./details.js";
import { setTabRows, tabPane, tabSays } from "./detailtabs.js";
import { hackPage } from "./hackpage.js";
import { sayHack } from "./hacksettle.js";
import { iconEl } from "./icons.js";
import { launchNow, showStrip } from "./launch.js";
import { L, api } from "./log.js";
import { sound } from "./sound.js";
import { games } from "./state.js";
import { el } from "./util.js";

export function hacksTabLabel() { return "Hacks"; }

var HOW = {
  checksum: "fits this file, by the checksum the patch carries",
  readme: "fits this file, by the checksum its readme states",
  name: "named like this file: this kind of patch names no game, so it goes on unchecked",
  said: "said by you to be a hack of this game: this kind of patch names no game, so it goes on unchecked"
};

function leaf(path) { return String(path).split(/[\\/]/).filter(Boolean).pop() || path; }

/* The game started with the patch; the entry that is only a patch plays on the game it was made for. */
function playPatch(on, r) {
  L("HACK", "play " + on.title + " with " + r.name + (r.route ? " (" + r.route + ")" : ""));
  closeDetails();
  launchNow(on, null, false, null, { key: r.key, name: r.name,
    wait: r.route === "copy" && !r.made ? "Making the patched copy of " + on.title + ", once…" : "starting " + on.title + " with " + r.name + "…" });
}

/* Where it looked, and what it passed over, under the list. */
function footWords(res) {
  var where = (res.folders || []).map(leaf);
  var said = "Looked in " + (where.length ? "the " + where.join(", ") + (where.length === 1 ? " folder" : " folders") + " of " + res.platform + " and in " : "")
    + "the library's own files that hold a patch and no game.";
  if (res.more) {
    said += "  " + res.more + (res.more === 1 ? " patch there names no game" : " patches there name no game")
      + " (an IPS or an xdelta carries no checksum) and " + (res.more === 1 ? "is" : "are") + " not named like this file.";
  }
  return said;
}

export function hacksPane(pane, g) {
  // The first look at a console reads its patches: said, so the wait is not a blank.
  pane.appendChild(el("p", "dtab-wait", "Looking for patches that fit this game…"));
  api("api/hacks.php?id=" + encodeURIComponent(g.id)).then(function (res) { paint(pane, g, res, 0, false); });
}

/* What is said of this game itself is kept, and the tab drawn from the answer. */
function settle(pane, g, what, words) {
  sayHack(g.id, what).then(function (now) {
    if (!now.ok) {
      sound("back");
      showStrip("Not kept: " + (now.error || "the server gave no answer"), true);
      api("api/hacks.php?id=" + encodeURIComponent(g.id)).then(function (res) { paint(pane, g, res, 0, false); });
      return;
    }
    L("HACK", "said of " + g.title + ": " + words);
    sound("ok");
    showStrip(g.title + ": " + words, false);
    paint(pane, g, now, 0, false);
  });
}

/* The games it could be a hack of, to pick one: a find box over the console's own games. */
function pickBase(pane, g, back) {
  api("api/hacks.php?id=" + encodeURIComponent(g.id) + "&bases=1").then(function (res) {
    if (tabPane("hacks") !== pane) { return; }
    var bases = (res.ok && res.bases) || [];
    pane.textContent = "";
    var inner = el("div", "ch-inner ch-tab hck-tab hck-pick");
    inner.appendChild(el("p", "group-help", "Which game is " + g.title + " a hack of? The games of " + g.platform + " that are not hacks themselves."));
    var seek = el("div", "set-find ch-find");
    seek.appendChild(iconEl("find-ico", "search"));
    var box = el("input");
    box.type = "text";
    box.placeholder = "find the game";
    box.spellcheck = false;
    seek.appendChild(box);
    inner.appendChild(seek);
    var list = el("div", "ch-list hck-list");
    inner.appendChild(list);
    var foot = el("p", "mt-note");
    inner.appendChild(foot);
    pane.appendChild(inner);

    var cells = [], picks = [], at = 0;
    function choose(i) {
      if (!picks[i]) { back(); return; }
      settle(pane, g, { hackOf: picks[i].id }, "a hack of " + picks[i].title);
    }
    function focusAt(i) {
      i = Math.max(0, Math.min(cells.length - 1, i));
      at = i;
      cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
      setTabRows(pane, { cells: cells, at: i, find: box, word: picks[i] ? "say so" : "go back",
                         move: function (d) { focusAt(at + d); }, choose: function () { choose(at); } });
      if (cells[i]) { cells[i].scrollIntoView({ block: "nearest", inline: "nearest" }); }
    }
    function fill() {
      var q = box.value.trim().toLowerCase();
      list.textContent = "";
      cells = [];
      picks = [null].concat(bases.filter(function (b) { return !q || b.title.toLowerCase().indexOf(q) >= 0; }));
      picks.forEach(function (b, i) {
        var line = el("div", "cr-row hck-row " + (b ? "hck-base" : "ch-act hck-back"));
        line.appendChild(iconEl("cr-ico", b ? "disc" : "back"));
        line.appendChild(el("span", "cr-name", b ? b.title : "Back, with nothing said"));
        if (b) { line.dataset.id = b.id; }
        line.addEventListener("mouseenter", function () { focusAt(i); });
        line.addEventListener("click", function () { choose(i); });
        cells.push(line);
        list.appendChild(line);
      });
      foot.textContent = q ? (picks.length - 1) + " of " + bases.length + " match “" + box.value.trim() + "”."
        : bases.length + (bases.length === 1 ? " game" : " games") + " to pick from.";
      focusAt(Math.min(at, cells.length - 1));
    }
    var wait;
    box.addEventListener("input", function () { clearTimeout(wait); wait = setTimeout(function () { at = 0; fill(); }, 120); });
    fill();
  });
}

function paint(pane, g, res, keepAt, choosing) {
  if (tabPane("hacks") !== pane) { return; }                 // another tab, or another game, by now
  pane.textContent = "";
  var inner = el("div", "ch-inner ch-tab hck-tab");
  pane.appendChild(inner);
  if (!res.ok) {
    inner.appendChild(tabSays("the patches for this game could not be read"));
    setTabRows(pane, null);
    return;
  }
  var progs = res.programs || [], is = res.is || {};
  var own = res.own || [], found = res.rows || [];
  var fits = found.filter(function (r) { return r.fits; });
  // A program of yours that plays from this game's file is listed once, as that; so is an entry whose patch is listed.
  var theirs = (res.hacks || []).filter(function (h) {
    return !progs.some(function (p) { return p.id === h.id; }) && !found.some(function (r) { return r.from === h.id; });
  });
  L("HACK", "tab " + g.title + ": " + fits.length + " fit, " + (found.length - fits.length) + " for another release" + (own.length ? ", its own file is a patch" : "")
    + (progs.length ? ", " + progs.length + " of your own playing from its file" : "")
    + (theirs.length ? ", " + theirs.length + " said to be a hack of it" : "")
    + (is.state === "ask" ? ", itself in doubt" : is.state === "hack" ? ", itself a hack" : ""));

  var rows = [];
  var s = is.suggest;
  // What this game itself is: the choices while it is in doubt, else what was said, to change.
  if (is.state === "ask" || choosing) {
    inner.appendChild(el("p", "group-help", (is.own ? "A game of your own standing in a console's list" : "This file may be a hack")
      + ". Say which game it comes from: it then wears Hack in the lists and shows in that game's Hacks tab. It stays a game of its own, and nothing on the disk is touched."));
    if (s && s.id) { rows.push({ act: "say", of: s.id, name: "Yes, a hack of " + s.title, sub: "Xsegon's reading: " + s.why, words: "a hack of " + s.title }); }
    rows.push({ act: "pick", name: s && s.id ? "A hack of another game…" : "Pick the game it is a hack of…", sub: "from the games of " + g.platform });
    rows.push({ act: "say", of: "", name: "A hack of a game that is not in the library",
                sub: s && !s.id ? "Xsegon's reading: " + s.title + ", since " + s.why : "it wears Hack, and stands in no game's Hacks tab",
                words: "a hack of a game that is not in the library" });
    rows.push({ act: "not", name: "Not a hack", sub: "a translation, homebrew, or a game in its own right: it is not asked about again" });
    if (is.state === "hack" || is.state === "not") { rows.push({ act: "unsettle", name: "Take back what was said", sub: "as if nothing had been said of it" }); }
  } else if (is.state === "hack") {
    rows.push({ act: "change", name: "A hack of " + (is.of ? is.of.title || "a game that is no longer in the library" : "a game that is not in the library"),
                sub: "said by you; a press changes it" });
  } else if (is.state === "not" && is.may) {
    rows.push({ act: "change", name: "Said to be no hack", sub: "said by you; a press changes it" });
  }
  var mine = rows.length;

  if (own.length) {
    inner.appendChild(el("p", "group-help", "This entry's file is a patch and no game. Play starts the game it was made for with the patch, and so does a press here:"));
    own.forEach(function (o) { rows.push({ act: o.on ? "own" : "none", o: o }); });
  } else if (found.length) {
    inner.appendChild(el("p", "group-help", "Patches on this PC for this game. A press plays the game with one. The game's own file is never changed, and each hack keeps saves of its own."));
    if (res.memory && fits.length) { rows.push({ act: "route" }); }
    found.forEach(function (r) { rows.push({ act: r.fits ? "play" : "none", r: r }); });
  }
  if (progs.length) {
    var many = progs.length > 1;
    inner.appendChild(el("p", "group-help", rows.length > mine
      ? "After them " + (many ? "come the games of your own that play" : "comes a game of your own that plays") + " from this game's file."
      : (many ? "Games of your own play" : "A game of your own plays") + " from this game's file. A press starts " + (many ? "one." : "it.")));
    progs.forEach(function (p) { rows.push({ act: p.ready ? "prog" : "none", p: p }); });
  }
  if (theirs.length) {
    inner.appendChild(el("p", "group-help", (theirs.length > 1 ? "Games in your library that are hacks of this one. A press plays one." : "A game in your library is a hack of this one. A press plays it.")));
    theirs.forEach(function (h) { rows.push({ act: h.ready ? "game" : "none", h: h }); });
  }
  // The way in for a game nothing marked: said once, at the foot.
  if (is.may && !is.state && !choosing) {
    rows.push({ act: "change", name: "This game is a hack of another…", sub: "say which, and it wears Hack and shows in that game's Hacks tab" });
  }
  var patches = own.length || found.length;
  var foot = !res.can ? res.why : (patches ? "" : "No patch on this PC fits this game's file. ") + footWords(res);
  if (!rows.length) {
    inner.appendChild(tabSays(res.can ? "No patch on this PC fits this game's file" : res.why));
    if (res.can) { inner.appendChild(el("p", "mt-note", footWords(res))); }
    setTabRows(pane, null);
    return;
  }

  var list = el("div", "ch-list hck-list");
  var cells = [], at = 0;
  function busyRoute() { return list.dataset.busy === "1"; }

  function run(i) {
    var item = rows[i];
    if (!item || item.act === "none" || busyRoute()) { return; }
    if (item.act === "change") { sound("select"); paint(pane, g, res, 0, true); return; }
    if (item.act === "pick") { sound("select"); pickBase(pane, g, function () { paint(pane, g, res, 0, choosing); }); return; }
    if (item.act === "say" || item.act === "not" || item.act === "unsettle") {
      list.dataset.busy = "1";
      settle(pane, g, item.act === "say" ? { hackOf: item.of } : item.act === "not" ? { notHack: true } : { unsettle: true },
        item.act === "say" ? item.words : item.act === "not" ? "no hack" : "what was said is taken back");
      return;
    }
    if (item.act === "prog" || item.act === "game") {
      var it = item.p || item.h;
      L("HACK", "play " + it.title + (item.p ? ", which plays from the file of " : ", a hack of ") + g.title);
      closeDetails();
      launchNow(games.filter(function (x) { return x.id === it.id; })[0] || { id: it.id, title: it.title, platform: it.platform, local: !!(item.p || it.own) }, null);
      return;
    }
    if (item.act === "route") {
      list.dataset.busy = "1";
      sound("select");
      api("api/hacks.php", { method: "POST", headers: { "Content-Type": "application/json" },
                             body: JSON.stringify({ id: g.id, copy: !res.copy }) }).then(function (now) {
        if (!now.ok) { delete list.dataset.busy; showStrip("Not kept: " + (now.error || "the server gave no answer"), true); return; }
        L("HACK", g.title + " hacks start " + (now.copy ? "from a copy" : "as the game loads"));
        paint(pane, g, now, at, choosing);
      });
      return;
    }
    var r = item.act === "own" ? item.o : item.r;
    if (item.act === "play" && !r.route) {
      sound("back");
      showStrip(r.name + " cannot be played: " + r.why, true);
      return;
    }
    if (item.act === "play") {
      // A patch that fits opens its own page first; Back comes to this row again.
      sound("select");
      hackPage(pane, g, r, HOW[r.how], function () { playPatch(g, r); }, function () { sound("back"); paint(pane, g, res, i, choosing); });
      return;
    }
    playPatch(games.filter(function (x) { return x.id === r.on.id; })[0] || { id: r.on.id, title: r.on.title, platform: g.platform }, r);
  }

  var WORD = { route: "change", none: "", play: "open it", prog: "play it", game: "play it", say: "say so", not: "say so", pick: "choose", change: "change", unsettle: "take back" };
  function focusAt(i) {
    i = Math.max(0, Math.min(cells.length - 1, i));
    at = i;
    cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
    var act = rows[i].act;
    setTabRows(pane, {
      cells: cells, at: i, look: act === "none",
      word: act in WORD ? WORD[act] : "play with it",
      move: function (d) { focusAt(at + d); },
      choose: function () { run(at); }
    });
    cells[i].scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  var ICON = { say: "check", pick: "search", not: "x", unsettle: "back", change: "tag" };
  rows.forEach(function (item) {
    var line = el("div", "cr-row sv-row hck-row");
    var words = el("div", "sv-words");
    var tag = "";
    if (item.act === "route") {
      line.classList.add("ch-act", "hck-route");
      line.appendChild(iconEl("cr-ico", "refresh"));
      words.appendChild(el("span", "cr-name", res.copy ? "Starts from a patched copy" : "Starts patched as the game loads"));
      words.appendChild(el("span", "sv-sub hck-sub", res.copy
        ? "Xsegon makes the copy once, in its own folder, and starts that. A press here has RetroArch put the patch on as the game loads instead."
        : "RetroArch puts the patch on as the game loads; nothing is made on the disk. If a hack comes up as the plain game, a press here starts from a patched copy instead."));
    } else if (item.act in ICON) {
      line.classList.add("ch-act", "hck-is");
      line.dataset.act = item.act;
      line.appendChild(iconEl("cr-ico", ICON[item.act]));
      words.appendChild(el("span", "cr-name", item.name));
      words.appendChild(el("span", "sv-sub hck-sub", item.sub));
    } else if (item.h) {
      line.classList.add("hck-game");
      line.appendChild(iconEl("cr-ico", item.h.ready ? "play" : "info"));
      words.appendChild(el("span", "cr-name", item.h.title));
      words.appendChild(el("span", "sv-sub hck-sub", item.h.ready ? "a game in your library, said to be a hack of this one" : "a hack of this one; it cannot be started now"));
      tag = item.h.platform === g.platform ? "" : item.h.platform;
      line.dataset.id = item.h.id;
      if (!item.h.ready) { line.classList.add("ro"); }
    } else if (item.p) {
      line.classList.add("hck-prog");
      line.appendChild(iconEl("cr-ico", item.p.ready ? "play" : "info"));
      words.appendChild(el("span", "cr-name", item.p.title));
      words.appendChild(el("span", "sv-sub hck-sub", !item.p.ready ? "a game of your own; its program is not there to start"
        : item.p.how === "copy" ? "a game of your own, started with its own copy of this game's file" : "a game of your own, started with this game's file"));
      tag = item.p.platform;
      line.dataset.id = item.p.id;
      if (!item.p.ready) { line.classList.add("ro"); }
    } else if (item.act === "own" || (item.act === "none" && item.o)) {
      line.appendChild(iconEl("cr-ico", item.o.on ? "play" : "info"));
      words.appendChild(el("span", "cr-name", item.o.name));
      words.appendChild(el("span", "sv-sub hck-sub", item.o.on
        ? "plays on " + item.o.on.title + (item.o.how === "said" ? ", as you said: the patch names no game, so it goes on unchecked" : ", which it fits by its checksum")
        : item.o.needs ? "made for " + item.o.needs + ", which is not in the library"
        : item.o.names ? "the game it was made for is not in the library, or is another release of it"
        : "this kind of patch names no game: say above which game it is a hack of, and it plays on that"));
      tag = item.o.kind;
      if (!item.o.on) { line.classList.add("ro"); }
    } else {
      var r = item.r, about = r.fits && r.route ? r.about : null;
      // Its box, when one is known (includes\hackabout.php), and who made it and when under its name.
      if (about && about.box) {
        var thumb = el("div", "sv-shot hck-thumb"), face = el("img");
        face.src = about.box;
        face.alt = "";
        face.loading = "lazy";
        thumb.appendChild(face);
        line.appendChild(thumb);
      } else {
        line.appendChild(iconEl("cr-ico", r.fits && r.route ? "play" : "info"));
      }
      words.appendChild(el("span", "cr-name", r.name));
      var known = about ? [about.developer, about.year].filter(Boolean).join("  ·  ") : "";
      words.appendChild(el("span", "sv-sub hck-sub", r.fits ? (r.route ? known || HOW[r.how] : "cannot be played: " + r.why) : r.note));
      tag = r.kind + "  ·  " + r.where;
      line.dataset.key = r.key;
      if (!r.fits) { line.classList.add("ro", "hck-other"); }
      if (r.fits && r.route) { line.classList.add("hck-fits"); line.dataset.route = r.route; }
    }
    line.appendChild(words);
    if (tag) { line.appendChild(el("span", "cr-tag", tag)); }
    var here = cells.length;
    line.addEventListener("mouseenter", function () { focusAt(here); });
    line.addEventListener("click", function () { run(here); });
    cells.push(line);
    list.appendChild(line);
  });
  inner.appendChild(list);
  inner.appendChild(el("p", "mt-note", foot));
  focusAt(Math.min(keepAt || 0, cells.length - 1));
}
