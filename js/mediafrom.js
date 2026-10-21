/*  Everything one place has for a game, beside what it shows (the Media tab,
    roadmap BM5): another game in the library (api\copy-media.php, as Copy from
    another game always did), or a place such as ScreenScraper or the Games
    Database (api\mediachoice.php, every kind asked of that place alone). A row
    a kind: theirs on the left, this game's on the right; a press takes one,
    and Take all it has takes every one that differs, asking first where it
    replaces one this game shows. Find any is the same rows for the kinds the
    game has none of, the first found in any place, and Apply.  */

import { confirmWindow } from "./confirm.js";
import { setTabRows, tabGameId, tabPane, tabSays } from "./detailtabs.js";
import { iconEl } from "./icons.js";
import { showStrip } from "./launch.js";
import { L, api } from "./log.js";
import { KIND_LABEL, PIC_KINDS, PLACE_NAME, askPlaces, lookGroup, sizeWords } from "./mediaplaces.js";
import { addsMissing } from "./missing.js";
import { sound } from "./sound.js";
import { artUrl, el } from "./util.js";
import { render, setCarNodes, setWheelNodes } from "./views.js";

var KIND_WORDS = { box: "box art", box3d: "3D box", logo: "clear logo", shot: "screenshot", fanart: "fanart", video: "video", manual: "manual" };

export function nameOf(x) { return x.title + (x.variant ? " (" + x.variant + ")" : ""); }

function hasWords(has) {
  var pics = has.filter(function (k) { return k !== "video"; }).length;
  var words = [];
  if (pics) { words.push(pics + (pics === 1 ? " picture" : " pictures")); }
  if (has.indexOf("video") >= 0) { words.push("a video"); }
  return words.join(", ");
}

function listWords(kinds) {
  var w = kinds.map(function (k) { return KIND_WORDS[k] || k; });
  return w.length > 1 ? w.slice(0, -1).join(", ") + " and " + w[w.length - 1] : w[0] || "";
}

/* A list in the tab: rows the keys and the pad go down, one press each. */
function rowsOf(pane, cells, word, choose, find) {
  var at = 0;
  function focusAt(i) {
    i = Math.max(0, Math.min(cells.length - 1, i));
    at = i;
    cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
    setTabRows(pane, { cells: cells, at: at, find: find, word: word(i), look: cells[i] && cells[i].classList.contains("ro"),
                       move: function (d) { focusAt(at + d); }, choose: function () { choose(at); } });
    if (cells[i]) { cells[i].scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }
  // A row kept across lists (Back above the games found) is listened to once, and does what the newest list says.
  cells.forEach(function (c, i) {
    c._enter = function () { focusAt(i); };
    c._press = function () { choose(i); };
    if (c._heard) { return; }
    c._heard = true;
    c.addEventListener("mouseenter", function () { c._enter(); });
    c.addEventListener("click", function () { c._press(); });
  });
  return { focusAt: focusAt, at: function () { return at; } };
}

/* Words in the tab with a way back, for a view that could not be drawn: never a screen with no press. */
function sayBack(pane, words, backWords, back) {
  pane.textContent = "";
  var inner = el("div", "ch-inner ch-tab md-tab");
  inner.appendChild(tabSays(words));
  var list = el("div", "ch-list md-list");
  var line = el("div", "cr-row ch-act md-back");
  line.appendChild(iconEl("cr-ico", "back"));
  line.appendChild(el("span", "cr-name", backWords));
  list.appendChild(line);
  inner.appendChild(list);
  pane.appendChild(inner);
  rowsOf(pane, [line], function () { return "go back"; }, function () { sound("back"); back(); }).focusAt(0);
}

/* ---- the games to copy from: a find box over the library, asked of the server as it is typed ---- */

/* how: { home() back to all media, open(fromId) one game's media to copy }. */
export function pickGame(pane, g, how) {
  pane.textContent = "";
  var inner = el("div", "ch-inner ch-tab md-tab");
  inner.appendChild(el("p", "group-help", "Copy pictures or a video from another game in the library onto " + g.title
    + ". Press a game to see what it has. Games of " + g.platform + " come first."));
  var seek = el("div", "set-find ch-find");
  seek.appendChild(iconEl("find-ico", "search"));
  var box = el("input");
  box.type = "text";
  box.placeholder = "find a game";
  box.spellcheck = false;
  seek.appendChild(box);
  inner.appendChild(seek);
  var list = el("div", "ch-list md-list");
  inner.appendChild(list);
  var foot = el("p", "mt-note", "Reading the library…");
  inner.appendChild(foot);
  pane.appendChild(inner);

  // The first row goes back to this game's own media; the games follow it.
  var back = el("div", "cr-row ch-act md-back md-home");
  back.appendChild(iconEl("cr-ico", "back"));
  back.appendChild(el("span", "cr-name", "Back to this game's media"));
  var cells = [back], found = [], rows = null, asked = 0;
  list.appendChild(back);
  function choose(i) {
    if (i === 0) { sound("back"); how.home(); return; }
    var x = found[i - 1];
    if (!x) { return; }
    sound("select");
    L("ART", g.title + ": looking at " + nameOf(x) + " to copy from");
    how.open(x.id);
  }
  function relist(at) {
    rows = rowsOf(pane, cells, function (i) { return i === 0 ? "go back" : "open"; }, choose, box);
    rows.focusAt(at);
  }
  function ask() {
    var mine = ++asked, words = box.value.trim();
    api("api/copy-media.php?id=" + encodeURIComponent(g.id) + "&find=" + encodeURIComponent(words)).then(function (res) {
      if (mine !== asked || !how.live()) { return; }   // typed on since, gone Back, or the tab left
      cells.slice(1).forEach(function (c) { c.remove(); });
      cells = [back];
      found = (res.ok && res.games) || [];
      if (!res.ok) { foot.textContent = "The library could not be read: " + (res.error || "the server gave no answer"); relist(0); return; }
      found.forEach(function (x) {
        var line = el("div", "cr-row md-game" + (x.same ? "" : " md-other"));
        line.appendChild(iconEl("cr-ico", "image"));
        line.appendChild(el("span", "cr-name", nameOf(x)));
        line.appendChild(el("span", "cr-tag", (x.same ? "" : x.platform + "  ·  ") + hasWords(x.has)));
        cells.push(line);
        list.appendChild(line);
      });
      var n = found.length;
      foot.textContent = !n ? (words ? "No game with pictures or a video matches “" + words + "”." : "No other game in the library has pictures or a video.")
        : res.more ? "The first " + n + " shown. Type part of a name to find the rest."
        : n + (n === 1 ? " game" : " games") + (words ? " match “" + words + "”." : " with pictures or a video.");
      relist(Math.min(rows ? rows.at() : 0, cells.length - 1));
    });
  }
  var wait;
  box.addEventListener("input", function () { clearTimeout(wait); wait = setTimeout(ask, 200); });
  relist(0);
  ask();
}

/* A picture, the video's first frame or a manual's mark in a row's frame, or a dash where there is none. */
export function shot(kind, url, cls) {
  var frame = el("div", "sv-shot md-shot " + cls);
  if (!url) { frame.appendChild(el("span", "md-none", "none")); return frame; }
  // "-": a place's video or manual, which comes down only when it is taken.
  if (url === "-" || kind === "manual") { frame.appendChild(iconEl("md-doc-ico", kind === "video" ? "film" : "book")); return frame; }
  if (kind === "video") {
    var v = el("video");
    v.muted = true;                     // only ever its first frame: nothing plays here
    v.preload = "metadata";
    v.src = url;
    frame.appendChild(v);
  } else {
    var img = el("img");
    img.loading = "lazy";
    img.alt = "";
    img.src = url;
    img.onerror = function () { img.remove(); frame.appendChild(el("span", "md-none", "none")); };
    frame.appendChild(img);
  }
  return frame;
}

/* ---- one source's rows: another game's, or a place's ---- */

/*
 * src: { title (who has them), help, rows: [{ kind, label, from (theirs: an address, or null), to (this
 * game's), same, note }], take(kinds, done) }. A row a kind, with Back and Take all it has above them.
 */
function paintRows(pane, g, src, how, keepAt) {
  pane.textContent = "";
  var inner = el("div", "ch-inner ch-tab md-tab");
  inner.appendChild(el("p", "group-help", src.help));
  var list = el("div", "ch-list md-list md-kinds");
  inner.appendChild(list);
  inner.appendChild(el("p", "mt-note", src.foot || "A copy is this game's own picture or video: the Media tab can put it back or take it away again."));
  pane.appendChild(inner);

  // A kind hidden on purpose is taken only by its own press, never by Take all.
  var can = src.rows.filter(function (r) { return r.from && !r.same && !r.hidden; });
  var lines = [{ act: "back" }, { act: "all" }].concat(src.rows.map(function (r) { return { act: "kind", r: r }; }));
  var cells = [], rows = null, taking = false;

  function choose(i) {
    var x = lines[i];
    if (!x) { return; }
    // Back works while a take runs: leaving stops it, and its ending is said.
    if (x.act === "back") { sound("back"); how.back(); return; }
    if (taking) { return; }
    var kinds = x.act === "all" ? can.map(function (r) { return r.kind; }) : (x.r.from && !x.r.same ? [x.r.kind] : []);
    if (!kinds.length) { sound("back"); return; }
    // A manual added beside the game's own replaces nothing, so it is not asked about.
    var replaces = src.rows.filter(function (r) { return kinds.indexOf(r.kind) >= 0 && r.to && !r.adds; });
    var go = function () {
      taking = true;
      var tag = cells[i] && cells[i].querySelector(".sv-sub, .cr-tag");
      if (tag) { tag.textContent = "taking…"; }
      src.take(kinds, function (say) {
        taking = false;
        if (say && tag) { tag.textContent = say; }
      }, function (t) { if (tag) { tag.textContent = t; } });
    };
    if (!replaces.length) { go(); return; }
    confirmWindow("This replaces its " + listWords(replaces.map(function (r) { return r.kind; })), function (box) {
      var one = replaces.length === 1;
      box.appendChild(el("p", null, "On the left, what " + g.title + " shows now. On the right, " + src.title
        + "’s, which " + (one ? "takes its" : "take their") + " place."));
      replaces.forEach(function (r) {
        var pair = el("div", "md-pair");
        pair.appendChild(shot(r.kind, r.to, "md-to"));
        pair.appendChild(el("span", "md-arrow", "→"));
        pair.appendChild(shot(r.kind, r.from, "md-from"));
        pair.appendChild(el("span", "md-what", r.label));
        box.appendChild(pair);
      });
    }, { label: "Take " + (replaces.length === 1 && kinds.length === 1 ? "it" : "them"), run: go }, "Cancel");
  }

  lines.forEach(function (x) {
    var line;
    if (x.act === "back") {
      line = el("div", "cr-row ch-act md-back");
      line.appendChild(iconEl("cr-ico", "back"));
      line.appendChild(el("span", "cr-name", src.backWords || "Back to all media"));
    } else if (x.act === "all") {
      line = el("div", "cr-row ch-act md-all" + (can.length ? "" : " ro"));
      line.appendChild(iconEl("cr-ico", "download"));
      line.appendChild(el("span", "cr-name", src.allWords || "Take all it has"));
      line.appendChild(el("span", "cr-tag", can.length ? listWords(can.map(function (r) { return r.kind; })) : src.busy ? "still asking…" : "nothing more to take"));
    } else {
      var r = x.r, off = !r.from || r.same;
      line = el("div", "cr-row sv-row md-kind" + (off ? " ro" : "") + (r.same ? " on" : ""));
      line.dataset.kind = r.kind;
      line.appendChild(iconEl("cr-ico", r.same ? "check" : r.kind === "video" ? "film" : r.kind === "manual" ? "book" : "image"));
      var words = el("div", "sv-words");
      words.appendChild(el("span", "cr-name", r.label));
      words.appendChild(el("span", "sv-sub", r.note || (!r.from ? src.title + " has none"
        : r.same ? "the same as this game’s" : r.to ? "a press replaces this game’s" : "this game has none: a press takes it")));
      line.appendChild(words);
      line.appendChild(shot(r.kind, r.from, "md-from"));
      line.appendChild(el("span", "md-arrow", "→"));
      line.appendChild(shot(r.kind, r.to, "md-to"));
    }
    cells.push(line);
    list.appendChild(line);
  });
  rows = rowsOf(pane, cells, function (i) { return lines[i].act === "back" ? "go back" : "take"; }, choose);
  rows.focusAt(keepAt || 0);
  // Details is built before it is on the screen, and setTabRows ignores a pane that is not on it.
  Promise.resolve().then(function () { if (tabPane("media") === pane) { rows.focusAt(rows.at()); } });
  return rows;
}

/* What another game has beside what this one shows (api\copy-media.php). how: { back() to the games, home() }. */
export function showFrom(pane, g, fromId, how, keepAt) {
  if (!pane.firstChild) { pane.appendChild(el("p", "dtab-wait", "…")); }
  api("api/copy-media.php?id=" + encodeURIComponent(g.id) + "&from=" + encodeURIComponent(fromId)).then(function (res) {
    if (!how.live()) { return; }
    if (!res.ok) {
      sayBack(pane, res.error || "that game could not be read", "Back to the games", how.back);
      return;
    }
    var rows = null;
    rows = paintRows(pane, g, {
      title: nameOf(res.from), backWords: "Back to the games", allWords: "Copy all it has",
      help: "From " + nameOf(res.from) + ", " + res.from.platform + ". A press copies one onto " + g.title + "; what " + g.title + " shows now is on the right.",
      rows: res.rows.map(function (r) { return { kind: r.kind, label: r.label, from: r.from, to: r.to, same: r.same,
        note: !r.from ? nameOf(res.from) + " has none" : r.same ? "the same as this game’s" : r.to ? "a press replaces this game’s" : "this game has none: a press copies it" }; }),
      take: function (kinds, done) { copy(pane, g, res, kinds.length > 1 ? "all" : kinds[0], how, rows ? rows.at() : 0, done); }
    }, how, keepAt);
  });
}

function copy(pane, g, res, kind, how, at, done) {
  api("api/copy-media.php?id=" + encodeURIComponent(g.id) + "&from=" + encodeURIComponent(res.from.id) + "&kind=" + kind, { method: "POST" }).then(function (now) {
    var got = (now && now.copied) || [], lost = (now && now.failed) || [];
    if (got.length) { takeIn(g, now.patch, got); how.changed(); }
    L("ART", g.title + ": " + (got.length ? listWords(got) + " copied from " + nameOf(res.from) : "nothing copied")
      + (lost.length ? "; not copied: " + lost.map(function (f) { return f.kind + " (" + f.why + ")"; }).join(", ") : ""));
    if (!now.ok || lost.length) {
      sound("back");
      showStrip((got.length ? "Copied " + listWords(got) + ". " : "") + "Not copied: "
        + (lost.length ? lost.map(function (f) { return (KIND_WORDS[f.kind] || f.kind) + ", " + f.why; }).join("; ") : now.error || "the server gave no answer"), true);
    } else if (!got.length) {
      sound("back");
      showStrip(g.title + " already shows everything " + nameOf(res.from) + " has.", false);
    } else {
      sound("ok");
      showStrip(g.title + ": " + listWords(got) + " copied from " + nameOf(res.from), false);
    }
    done();
    if (how.live()) { showFrom(pane, g, res.from.id, how, at); }
  });
}

/* ---- everything one place has, and Find any ---- */

/* how: { home() to all media, changed(kind) after the game's own changed, holder: the game holding its manuals }. */
export function placeView(pane, g, place, how) {
  takeView(pane, g, place, PIC_KINDS.concat(["video", "manual"]), how);
}

/* Find any: the kinds this game has none of, asked of every place turned on in Look in; the first found
   of each, in Look in's order, beside its empty spot. Apply takes them all. */
export function findView(pane, g, kinds, how) {
  takeView(pane, g, "", kinds, how);
}

/* One place's rows, or with no place the first found anywhere for each kind. */
function takeView(pane, g, place, kinds, how) {
  var who = place ? PLACE_NAME[place] : "every place";
  pane.textContent = "";
  pane.appendChild(el("p", "dtab-wait", "asking " + who + "…"));
  var now = null, docs = [], rows = null, closed = false, taking = null, answer = { places: {}, prep: {}, done: false };
  var applied = {};        // the item each kind was taken from here: its row is checked off
  var ask = askPlaces(g, place ? "all" : kinds, function (v) { answer = v; paint(); if (pending) { pending(); } });
  var pending = null;
  // Left mid-way: what is left is not taken, a file still coming is let go, and the ending is still said.
  how.onLeave(function () {
    closed = true;
    if (taking) { taking.stop("this view was left before it was done"); }
    ask.close();
  });
  /* Whether the game has a kind now (another window or Get Media may have filled it since this opened). */
  function hasNow(k) {
    return k === "video" ? !!(now && now.video.has) : k === "manual" ? docs.some(function (d) { return d.kind === "pdf" || /^manual/i.test(d.label); })
         : !!(now && now.kinds[k].has);
  }
  function readNow() {
    return Promise.all([api("api/art.php?id=" + encodeURIComponent(g.id)), api("api/game.php?id=" + encodeURIComponent(how.holder))]).then(function (r) {
      now = r[0].ok ? r[0] : null;
      docs = (r[1].ok && r[1].game && r[1].game.documents) || [];
    });
  }
  /* The places a kind is looked for in, Look in's order first: Find any waits on a place above the first found, so a row never changes under the person. */
  function placesFor(kind) {
    if (place) { return [place]; }
    var order = ((ask.first && ask.first.look) || {})[lookGroup(kind)] || [];
    var at = function (k) { var i = order.indexOf(k); return i < 0 ? 99 : i; };
    // Only the places asked for this kind: a row never waits on one that was asked for something else.
    return ((ask.first && ask.first.places) || []).filter(function (p) { return !p.kinds || p.kinds.indexOf(kind) >= 0; })
      .map(function (p) { return p.key; }).sort(function (a, b) { return at(a) - at(b); });
  }
  function firstOf(kind) {
    if (!ask.first) { return { asking: who }; }
    var keys = placesFor(kind);
    if (!keys.length) { return { off: true }; }
    for (var i = 0; i < keys.length; i++) {
      var st = answer.places[keys[i]];
      if (!st || st.state === "waiting" || st.state === "asking") { return { asking: PLACE_NAME[keys[i]] }; }
      var it = st.state === "done" ? st.items.find(function (x) { return x.kind === kind; }) : null;
      if (it) { return { it: it }; }
    }
    return {};
  }
  /* Every one found of a kind, in the same order: Find any goes on to the next when one will not come down or be used. */
  function candidates(kind) {
    return placesFor(kind).reduce(function (out, k) {
      var st = answer.places[k];
      return st && st.state === "done" ? out.concat(st.items.filter(function (x) { return x.kind === kind; })) : out;
    }, []);
  }
  var drawn = "";
  function paint() {
    if (closed || !how.live() || taking) { return; }
    var st = place ? answer.places[place] : null;
    var nowhere = !!ask.first && !(ask.first.places || []).length;
    var asking = !ask.first || (!nowhere && (Object.keys(answer.places).length === 0
      || Object.keys(answer.places).some(function (k) { return answer.places[k].state === "waiting" || answer.places[k].state === "asking"; })));
    // Drawn again only when what the places said, or a file coming down, has changed.
    var sig = JSON.stringify([answer.places, answer.prep, now && now.rev, docs.length, applied]);
    if (sig === drawn) { return; }
    drawn = sig;
    var out = kinds.map(function (k) {
      var f = firstOf(k), it = applied[k] || f.it || null, prep = it ? answer.prep[it.ref] : null;
      var mine = k === "video" ? (now && now.video.has ? "api/video.php?id=" + encodeURIComponent(g.id) + "&v=" + (now.video.bytes || 0) : null)
               : k === "manual" ? (docs[0] ? docs[0].url : null)
               : (now && now.kinds[k].has ? "api/image.php?id=" + encodeURIComponent(g.id) + "&kind=" + k + "&size=full&v=" + (now.rev || 0) : null);
      var theirs = it ? (it.view || (prep && prep.state === "done" ? prep.view : "") || (k === "manual" || k === "video" ? "-" : "")) : null;
      var what = it ? [place ? "" : PLACE_NAME[it.place], it.label, sizeWords(it.size)].filter(Boolean).join("  ·  ") : "";
      // A manual goes beside the game's documents (it never replaces one); a picture hidden on purpose is said so.
      var adds = k === "manual";
      var hid = PIC_KINDS.indexOf(k) >= 0 && !!(now && now.kinds[k].hidden);
      // Find any is for what is missing: a kind the game got since it opened (another window, Get Media) is not offered.
      var since = !place && !applied[k] && hasNow(k);
      return { kind: k, label: KIND_LABEL[k], from: since ? null : theirs, to: mine, same: !!applied[k], it: it, adds: adds, hidden: hid && !applied[k],
               note: applied[k] ? (place ? "taken" : "applied, from " + PLACE_NAME[applied[k].place])
                   : since ? "it has one now"
                   : f.asking ? "asking " + f.asking + "…"
                   : f.off ? "no place that has one is turned on in Look in"
                   : !it ? (!place ? "none of the places has one"
                           : st && (st.state === "failed" || st.state === "account") ? "could not be asked: " + st.why : who + " has none")
                   : prep && prep.state === "running" ? (prep.why || "coming down") + (prep.size ? ", " + Math.round(100 * prep.got / prep.size) + "%" : "…")
                   : what + (hid ? "  ·  hidden on purpose: only its own press shows this one"
                           : adds ? "  ·  a press adds it beside " + (mine ? "this game’s" : "nothing: it has none")
                           : mine ? "  ·  a press replaces this game’s" : "  ·  this game has none: a press takes it") };
    });
    // Find any says once which places could not be asked, and why, or that none is turned on.
    var unasked = place ? [] : Object.keys(answer.places).filter(function (k) { return answer.places[k].state === "failed" || answer.places[k].state === "account"; })
      .map(function (k) { return PLACE_NAME[k] + " could not be asked: " + answer.places[k].why + "."; });
    if (nowhere) { unasked.push("No place that has these is turned on in Look in: open a card's compare, and turn one on in Look in beside the choices."); }
    rows = paintRows(pane, g, place ? {
      title: who, busy: asking,
      help: "Everything " + who + " has for " + g.title + " on the left, what it shows now on the right. A press takes one; "
        + (st && st.why && st.state !== "done" ? st.why : "Take all it has takes every one, and shows each it replaces first."),
      foot: "Asked when this opened, every time. That kind's card in the Media tab compares it with every other choice.",
      rows: out,
      take: function (list, done, tell) { takeAll(out.filter(function (r) { return list.indexOf(r.kind) >= 0; }), done, tell); }
    } : {
      title: who, busy: asking, allWords: "Apply",
      help: "What " + g.title + " has none of, and the first found for each in the places turned on in Look in, in its order. "
        + "Apply takes them all; a press takes one." + (unasked.length ? " " + unasked.join(" ") : ""),
      foot: "Asked when this opened, every time. To choose between every place's, press that kind's card in the Media tab.",
      rows: out,
      take: function (list, done, tell) { takeAll(out.filter(function (r) { return list.indexOf(r.kind) >= 0; }), done, tell); }
    }, { back: function () { how.home(); } }, rows ? rows.at() : 0);
  }
  /* One kind after another: a picture at once, a video or a manual once it has come down. */
  function takeAll(list, done, tell) {
    var got = [], lost = [], stopped = "", cur = null;
    tell = tell || function () {};
    taking = { stop: function (why) {
      stopped = why;
      // A file still coming is let go: its kind is not taken, and the ending is said.
      if (pending && cur) { pending = null; lost.push(KIND_WORDS[cur.kind] + ", " + why); next(); }
    } };
    var end = function () {
      taking = null;
      sound(lost.length ? "back" : "ok");
      var said = place ? listWords(got) : got.map(function (k) { return KIND_WORDS[k] + " from " + PLACE_NAME[applied[k].place]; }).join(", ");
      L("ART", g.title + ": " + (place ? "from " + who + ", took " : "Find any applied ") + (said || "nothing") + (lost.length ? "; not taken: " + lost.join("; ") : ""));
      showStrip(got.length ? g.title + ": " + said + (place ? " from " + who : "") + (lost.length ? ". Not taken: " + lost.join("; ") : "")
                           : "Nothing was taken: " + lost.join("; "), !!lost.length);
      done();
      if (closed) { return; }
      drawn = "";
      readNow().then(paint);
    };
    var next = function () {
      if (stopped) { list.splice(0).forEach(function (x) { lost.push(KIND_WORDS[x.kind] + ", " + stopped); }); }
      var r = cur = list.shift();
      if (!r) { end(); return; }
      // Find any is for what is missing: a kind the game got meanwhile (another window, Get Media) is left as it is.
      if (!place && hasNow(r.kind)) { lost.push(KIND_WORDS[r.kind] + ", it has one now"); next(); return; }
      tell("taking the " + KIND_WORDS[r.kind] + "…");
      tryOne(r, r.it, []);
    };
    var tryOne = function (r, it, tried) {
      tried.push(it.ref);
      // Find any takes the first good one: a damaged or refused one makes way for the next found, three more at most.
      var failed = function (why) {
        var more = place || stopped ? null : candidates(r.kind).find(function (x) { return tried.indexOf(x.ref) < 0; });
        if (more && tried.length < 4) {
          L("ART", g.title + ": Find any: " + it.ref + " not taken (" + why + "), trying " + more.ref);
          tryOne(r, more, tried);
          return;
        }
        lost.push(KIND_WORDS[r.kind] + ", " + why);
        next();
      };
      var use = function () {
        // Find any's manual is the game's first, so it is its Manual.pdf; a place's sits beside the ones it has.
        ask.use(it, r.kind === "manual" && place ? "keep" : "", "", how.holder).then(function (u) {
          if (!u.ok) { failed(u.error || "no answer"); return; }
          got.push(r.kind);
          applied[r.kind] = it;
          how.changed(r.kind);          // at once: the views catch up even if the tab is left before the end
          next();
        });
      };
      var prep = answer.prep[it.ref];
      // Used from what came down: a video or manual, or a picture still at its place, comes first.
      var here = (prep && prep.state === "done") || (PIC_KINDS.indexOf(r.kind) >= 0 && (it.view || "").indexOf("api/mediachoice.php") === 0);
      if (here) { use(); return; }
      ask.prepare(it).then(function (p) {
        // Left while the asking was on its way: this kind is not taken, and the ending is still said.
        if (stopped) { lost.push(KIND_WORDS[r.kind] + ", " + stopped); next(); return; }
        if (!p.ok) { failed(p.error || "it would not come down"); return; }
        pending = function () {
          var q = answer.prep[it.ref];
          if (!q || q.state === "running") {
            if (q && q.size) { tell(KIND_WORDS[r.kind] + " coming down, " + Math.round(100 * q.got / q.size) + "%"); }
            return;
          }
          pending = null;
          if (q.state === "done") { use(); } else { failed(q.why || "it would not come down"); }
        };
      });
    };
    readNow().then(next);
  }
  readNow().then(function () {
    if (closed) { return; }
    ask.start(place).then(function (r) {
      if (!r.ok && !closed && how.live()) {
        sayBack(pane, (place ? who : "The places") + " could not be asked: " + (r.error || "the server did not answer"), "Back to all media", how.home);
        return;
      }
      paint();
    });
  });
}

/* The copy, onto the game's row: every view and details' cover show it without the library read again. */
function takeIn(g, patch, got) {
  if (!patch) { return; }
  Object.keys(patch).forEach(function (k) {
    if (k === "img" || k === "imgFull") { g[k] = Object.assign({}, g[k] || {}, patch[k]); }
    else { g[k] = patch[k]; }
  });
  setWheelNodes(null);
  setCarNodes(null);
  render();
  if (got.indexOf("box") >= 0) { coverAgain(g, artUrl(g, "box", true)); }
  var lacks = document.querySelector("#details .dlacks");
  if (lacks && got.indexOf("video") >= 0 && tabGameId() === g.id) { lacks.remove(); }
}

/* Details' cover after the box art changed in the tab: the new picture once
   it has come, or NO ART back when there is none (its address answers 404),
   each in the other's place. The old one shows until then. */
export function coverAgain(g, src) {
  // Only on this game's own details: an answer that comes after another game was opened leaves its cover alone.
  if (tabGameId() !== g.id) { return; }
  var now = document.querySelector("#details .dleft img.cover, #details .dleft .cover-noart");
  if (!now) { return; }
  var img = el("img", "cover");
  img.alt = g.title;
  img.onload = function () { now.replaceWith(img); };
  img.onerror = function () {
    if (now.classList.contains("cover-noart")) { return; }
    now.replaceWith(addsMissing(el("div", "hero-noart cover-noart", "NO ART"), function () { return g; }, "art"));
  };
  img.src = src;
}
