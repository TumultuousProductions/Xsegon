/*  The Media tab of a game's details (js\detailtabs.js, roadmap BM): what the
    game shows at a glance, each kind in its own shape and saying where it came
    from: the pictures, the video, the manuals and maps. A press on one opens
    its compare (js\mediacompare.js), every place's choices beside the one it
    shows; a file dropped on a picture replaces it. Under them, Everything one
    place has (js\mediafrom.js): one place's whole answer, or another game's
    media, beside this game's, and Clear all.  */

import { askClearAll, uploadArt } from "./art-editors.js";
import { onTabLeave, setTabRows, tabGameId, tabPane, tabSays } from "./detailtabs.js";
import { reloadKeeping } from "./editors.js";
import { iconEl } from "./icons.js";
import { showStrip } from "./launch.js";
import { L, api } from "./log.js";
import { closeCompare, compareView } from "./mediacompare.js";
import { coverAgain, findView, pickGame, placeView, showFrom } from "./mediafrom.js";
import { KIND_LABEL, PIC_KINDS, PLACE_NAME, picFrom, sizeWords, takesWhy, videoFrom } from "./mediaplaces.js";
import { sound } from "./sound.js";
import { games, sel } from "./state.js";
import { el } from "./util.js";

export function mediaTabLabel() { return "Media"; }

// Which part of the tab is up, kept while this game's details is drawn again:
// { forId, view: over | compare | pick | from | place | find, kind, fromId, place, kinds }.
var route = null;
var changed = null;       // the game whose media changed here: the views behind catch up when the tab is left
var leaving = [];         // what a view lets go of when the tab or the view changes
var sending = {};         // "id|kind" of a picture let go on a card and still being sent, past a redraw
var lastCard = null;      // { id, key } selected last on the cards: coming back to them lands there
var PLACE_ORDER = ["ss", "gamesdb", "libretro", "steam", "archive", "arcadedb"];

/* The game whose documents folder holds its manuals: a card of several versions keeps them with the first that has any (js\docs.js). */
function holderOf(g) {
  var v = (g.versions || []).find(function (x) { return x.docs; });
  return (v || g).id;
}

function letGo() {
  closeCompare();
  leaving.forEach(function (fn) { fn(); });
  leaving = [];
}

export function mediaPane(pane, g) {
  // The views behind are brought up to date once, when the tab is left, as Change Pictures does when it closes.
  onTabLeave(pane, function () {
    letGo();
    // Details drawn again comes straight back to this view; the tab left (another tab, details closed)
    // opens on the cards next time, so no view asks every place again without a press.
    setTimeout(function () { if (!tabPane("media")) { route = null; } }, 0);
    if (changed !== g.id) { return; }
    changed = null;
    reloadKeeping(games[sel] ? games[sel].id : g.id);
  });
  if (!route || route.forId !== g.id) { route = { forId: g.id, view: "over" }; }
  go(pane, g);
}

function to(pane, g, r) {
  route = Object.assign({ forId: g.id }, r);
  go(pane, g);
}

/* A change made here: the views catch up on leaving, and details' cover shows a new box art at once.
   One that lands after the tab was left catches the views up now, as the leaving has passed. */
function markChanged(g, kind) {
  if (tabGameId() === g.id && tabPane("media")) { changed = g.id; }
  else { reloadKeeping(games[sel] ? games[sel].id : g.id); }
  if (kind === "box" || kind === "all") {
    coverAgain(g, "api/image.php?id=" + encodeURIComponent(g.id) + "&kind=box&size=full&v=" + Date.now());
  }
}

/* Whether a view's late answer is still wanted: the tab up, and still on the route it was asked for. */
function liveFor(pane, r) {
  return function () { return route === r && tabPane("media") === pane; };
}

function go(pane, g) {
  letGo();
  // Until the new view hands over its own list, a press goes nowhere: never into the one that was just left.
  setTabRows(pane, { cells: [], at: 0, look: true, word: "", move: function () {}, choose: function () {} });
  var r = route, home = function () { to(pane, g, { view: "over" }); };
  var changedHere = function (kind) { markChanged(g, kind || "all"); };
  if (r.view === "compare") {
    compareView(pane, g, r.kind, { back: home, holder: holderOf(g), changed: changedHere,
      other: function () { to(pane, g, { view: "pick" }); },
      kind: function (k) { to(pane, g, { view: "compare", kind: k }); } });
  } else if (r.view === "pick") {
    pickGame(pane, g, { home: home, live: liveFor(pane, r), open: function (id) { to(pane, g, { view: "from", fromId: id }); } });
  } else if (r.view === "from") {
    showFrom(pane, g, r.fromId, { back: function () { to(pane, g, { view: "pick" }); }, home: home, changed: changedHere, live: liveFor(pane, r) });
  } else if (r.view === "place") {
    placeView(pane, g, r.place, { home: home, changed: changedHere, holder: holderOf(g), live: liveFor(pane, r),
      onLeave: function (fn) { leaving.push(fn); } });
  } else if (r.view === "find") {
    findView(pane, g, r.kinds, { home: home, changed: changedHere, holder: holderOf(g), live: liveFor(pane, r),
      onLeave: function (fn) { leaving.push(fn); } });
  } else {
    overview(pane, g);
  }
}

/* ---- everything at a glance ---- */

function overview(pane, g) {
  if (!pane.firstChild) { pane.appendChild(el("p", "dtab-wait", "…")); }
  var id = encodeURIComponent(g.id);
  Promise.all([api("api/art.php?id=" + id), api("api/game.php?id=" + encodeURIComponent(holderOf(g))), api("api/mediachoice.php?id=" + id + "&places=1")])
    .then(function (r) {
      if (tabPane("media") !== pane || route.view !== "over" || route.forId !== g.id) { return; }
      if (!r[0].ok) {
        pane.textContent = "";
        pane.appendChild(tabSays(r[0].error || "this game's pictures could not be read"));
        setTabRows(pane, null);
        return;
      }
      // Documents that would not read are not "none": Find any then leaves the manual out rather than add a second.
      paintOver(pane, g, r[0], r[1].ok && r[1].game ? r[1].game.documents || [] : null, r[2].ok ? r[2].places : null);
    });
}

function section(name, count) {
  var s = el("div", "mt-sect");
  var head = el("div", "mt-head");
  head.appendChild(el("h3", "mt-name", name));
  if (count) { head.appendChild(el("span", "mt-count", count)); }
  s.appendChild(head);
  return s;
}

function card(cls, key, word) {
  var c = el("div", "mt-card " + cls);
  c.dataset.key = key;
  c.dataset.word = word;
  return c;
}

function paintOver(pane, g, res, docs, places) {
  pane.textContent = "";
  var inner = el("div", "ch-inner ch-tab md-tab mt-over");
  var top = el("div", "mt-top");
  top.appendChild(el("p", "group-help", "What " + g.title + " shows, and where each came from. Press one to see every other choice "
    + "beside it; a file dropped on a picture replaces it. Stored in Xsegon only."));
  inner.appendChild(top);
  var fit = el("div", "mt-fit");
  inner.appendChild(fit);
  pane.appendChild(inner);
  var cells = [], at = 0;
  var open = function (kind) { sound("select"); L("ART", g.title + ": compare " + kind + " from the Media tab"); to(pane, g, { view: "compare", kind: kind }); };

  // Find any: the kinds this game has none of, looked for in every place at one press. A picture hidden
  // on purpose is not missing, and is said apart. The manual is missing when no document is one (a map
  // alone is not), and is left out when the documents would not read, so a second is never added blind.
  var docsRead = docs !== null;
  docs = docs || [];
  var hidden = PIC_KINDS.filter(function (k) { return res.kinds[k].hidden; });
  var hasManual = docs.some(function (d) { return d.kind === "pdf" || /^manual/i.test(d.label); });
  var missing = PIC_KINDS.filter(function (k) { return !res.kinds[k].has && !res.kinds[k].hidden; })
    .concat((res.video || {}).has ? [] : ["video"], hasManual || !docsRead ? [] : ["manual"]);
  var hiddenWords = hidden.length ? "hidden, not looked for: " + hidden.map(function (k) { return KIND_LABEL[k]; }).join(", ") : "";
  var findBox = el("div", "mt-findbox");
  var find = el("button", "mt-place mt-find" + (missing.length ? " primary" : ""), "Find any");
  find.type = "button";
  find.dataset.key = "find";
  find.dataset.word = missing.length ? "find what is missing" : "nothing is missing";
  find.addEventListener("click", function () {
    if (!missing.length) {
      sound("back");
      showStrip(g.title + " has every kind already" + (hidden.length ? " (the hidden ones stay hidden)" : "") + ". Press a card to choose a different one.", false);
      return;
    }
    sound("select");
    L("ART", g.title + ": Find any for " + missing.join(", ") + " (Media tab)");
    to(pane, g, { view: "find", kinds: missing });
  });
  cells.push(find);
  findBox.appendChild(find);
  findBox.appendChild(el("span", "mt-dim", (missing.length ? missing.length + " missing: " + missing.map(function (k) { return KIND_LABEL[k]; }).join(", ")
                                                           : "Nothing missing") + (hiddenWords ? "; " + hiddenWords : "")));
  top.appendChild(findBox);

  // The pictures, each in its own shape: a file let go on one replaces it.
  var shown = PIC_KINDS.filter(function (k) { return res.kinds[k].has; }).length;
  var pics = section("Pictures", shown + " of " + PIC_KINDS.length + " shown");
  var band = el("div", "mt-cards");
  PIC_KINDS.forEach(function (kind) {
    var k = res.kinds[kind];
    var c = card("md-kind md-mine" + (k.hidden ? " md-hid" : ""), "k:" + kind, "compare and change");
    c.dataset.kind = kind;
    c.title = "Compare it with every other choice";
    var frame = el("div", "mt-frame mt-k-" + kind);
    if (k.has) {
      var img = el("img");
      img.alt = "";
      // size=full skips the thumbnail cache, and the moment makes it an address the browser has not kept.
      img.src = "api/image.php?id=" + encodeURIComponent(g.id) + "&kind=" + kind + "&size=full&v=" + Date.now();
      img.onerror = function () { img.remove(); frame.appendChild(el("span", "md-none", "none")); };
      frame.appendChild(img);
    } else {
      frame.appendChild(el("span", "md-none", k.hidden ? "hidden" : "none"));
    }
    c.appendChild(frame);
    c.appendChild(el("span", "mt-label", k.label));
    c.appendChild(el("span", "mt-from sv-sub" + (k.has ? "" : " none"), picFrom(k)));
    c.addEventListener("click", function () { open(kind); });
    c.addEventListener("dragover", function (e) { e.preventDefault(); c.classList.add("drop"); });
    c.addEventListener("dragleave", function () { c.classList.remove("drop"); });
    c.addEventListener("drop", function (e) {
      e.preventDefault();
      c.classList.remove("drop");
      var files = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : [];
      var file = files[0];
      var said = c.querySelector(".mt-from");
      // One picture at a time, and one for each kind until it is in: a second sent beside it would mix the two.
      var no = !file ? "" : sending[g.id + "|" + kind] ? "still sending the one before"
             : files.length > 1 ? "let go of one picture at a time"
             : takesWhy(kind, file);
      if (!file || no) {
        if (no) { sound("back"); said.textContent = no; said.classList.add("bad"); L("ART", g.title + ": a file let go on the " + kind + " was not used: " + no); }
        return;
      }
      sending[g.id + "|" + kind] = true;
      uploadArt(g, kind, file, function (t) { said.textContent = t; }).then(function () {
        delete sending[g.id + "|" + kind];
        sound("select");
        L("ART", g.title + ": " + kind + " from a file let go on the Media tab (" + file.name + ")");
        markChanged(g, kind);
        if (route && route.view === "over" && tabPane("media") === pane) { overview(pane, g); }
      }, function (err) {
        delete sending[g.id + "|" + kind];
        said.textContent = err.message;
        said.classList.add("bad");
        L("ART", g.title + ": a file let go on the " + kind + " was refused: " + err.message);
      });
    });
    cells.push(c);
    band.appendChild(c);
  });
  pics.appendChild(band);
  fit.appendChild(pics);

  // The video and the manuals, side by side.
  var two = el("div", "mt-two");
  var v = res.video || {};
  var vs = section("Video");
  var vc = card("mt-wide md-video" + (v.has ? "" : " md-none-card"), "k:video", "compare and change");
  vc.dataset.kind = "video";
  var vf = el("div", "mt-frame mt-k-video");
  if (v.has) {
    var vid = el("video");
    vid.muted = true;                    // only its first frame: nothing plays here
    vid.preload = "metadata";
    vid.src = "api/video.php?id=" + encodeURIComponent(g.id) + "&v=" + Date.now();
    vf.appendChild(vid);
    vf.appendChild(iconEl("mt-play", "play"));
  } else {
    vf.appendChild(el("span", "md-none", "none"));
  }
  vc.appendChild(vf);
  var vw = el("span", "mt-words");
  vw.appendChild(el("span", "mt-label", "Video"));
  vw.appendChild(el("span", "mt-from sv-sub" + (v.has ? "" : " none"), videoFrom(v)));
  if (v.has) { vw.appendChild(el("span", "mt-dim md-path", [v.file, sizeWords(v.bytes)].filter(Boolean).join("  ·  "))); }
  vw.appendChild(el("span", "mt-dim", v.has ? "Press to compare it with every place that has one." : "Press to see every place that has one."));
  vc.appendChild(vw);
  vc.addEventListener("click", function () { open("video"); });
  cells.push(vc);
  vs.appendChild(vc);
  two.appendChild(vs);

  var ms = section("Manuals and maps");
  var mc = card("mt-wide md-manual" + (docs.length ? "" : " md-none-card"), "k:manual", "compare and change");
  mc.dataset.kind = "manual";
  var mf = el("div", "mt-frame mt-k-manual" + (docs.length ? " mt-paper" : ""));
  mf.appendChild(docs.length ? iconEl("mt-book", "book") : el("span", "md-none", "none"));
  mc.appendChild(mf);
  var mw = el("span", "mt-words");
  mw.appendChild(el("span", "mt-label", docs.length ? docs[0].label : "Manual"));
  mw.appendChild(el("span", "mt-from sv-sub" + (docs.length ? "" : " none"), docs.length ? sizeWords(docs[0].bytes) : "none yet"));
  if (docs.length > 1) {
    mw.appendChild(el("span", "mt-dim", "Also here: " + docs.slice(1).map(function (d) { return d.label; }).join(", ") + "."));
  }
  mw.appendChild(el("span", "mt-dim", docs.length ? "Press to page through it beside every other one found." : "Press to see every place that has one."));
  mc.appendChild(mw);
  mc.addEventListener("click", function () { open("manual"); });
  cells.push(mc);
  ms.appendChild(mc);
  two.appendChild(ms);
  fit.appendChild(two);

  // Everything one place has, and the game to copy from.
  var all = section("Everything one place has");
  all.appendChild(el("p", "mt-help", "What one place has for this game, every kind of it, beside what it shows now. Take one, or all of it."));
  var btns = el("div", "mt-places");
  var seen = {};
  if (places) {
    ["pictures", "videos", "manuals"].forEach(function (grp) {
      (places[grp] || []).forEach(function (p) { if (!seen[p.key]) { seen[p.key] = p; } });
    });
  }
  var button = function (cls, text, key, word, run) {
    var b = el("button", cls, text);
    b.type = "button";
    b.dataset.key = key;
    b.dataset.word = word;
    b.addEventListener("click", run);
    cells.push(b);
    return b;
  };
  PLACE_ORDER.filter(function (k) { return seen[k]; }).forEach(function (k) {
    var b = button("mt-place", PLACE_NAME[k], "p:" + k, "see everything " + PLACE_NAME[k] + " has", function () {
      sound("select");
      L("ART", g.title + ": everything " + PLACE_NAME[k] + " has (Media tab)");
      to(pane, g, { view: "place", place: k });
    });
    if (seen[k].note) { b.title = seen[k].note; b.classList.add("mt-note-place"); }
    btns.appendChild(b);
  });
  btns.appendChild(button("mt-place md-copy", "Another game...", "copy", "open", function () { sound("select"); to(pane, g, { view: "pick" }); }));
  btns.appendChild(el("span", "mt-gap"));
  var showing = v.has || PIC_KINDS.some(function (kind) { return res.kinds[kind].has || res.kinds[kind].replaced; });
  if (showing) {
    btns.appendChild(button("mt-place md-clear", "Clear all...", "clear", "clear all", function () {
      askClearAll(g, res, function (err) {
        markChanged(g, "all");
        overview(pane, g);
        if (err) { showStrip(err, true); }
      });
    }));
  }
  all.appendChild(btns);
  fit.appendChild(all);

  // A file let go beside the cards must not open in place of the page.
  inner.addEventListener("dragover", function (e) { e.preventDefault(); });
  inner.addEventListener("drop", function (e) { e.preventDefault(); });

  function focusAt(i) {
    i = Math.max(0, Math.min(cells.length - 1, i));
    at = i;
    lastCard = { id: g.id, key: cells[i].dataset.key };
    cells.forEach(function (c, n) { c.classList.toggle("sel", n === i); });
    setTabRows(pane, { cells: cells, at: i, word: cells[i].dataset.word, move: function (d) { focusAt(at + d); },
                       choose: function () { cells[at].click(); } });
    cells[i].scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  cells.forEach(function (c, i) { c.addEventListener("mouseenter", function () { focusAt(i); }); });
  // The card selected last for this game, else the box art (as before Find any sat above it).
  var was = lastCard && lastCard.id === g.id ? cells.map(function (c) { return c.dataset.key; }).indexOf(lastCard.key) : -1;
  focusAt(was >= 0 ? was : 1);
  // Details is built before it is on the screen, and setTabRows ignores a
  // pane that is not on it: the list is handed over again a moment later.
  Promise.resolve().then(function () { if (tabPane("media") === pane) { focusAt(at); } });
}
