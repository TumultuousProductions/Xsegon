/*  The Media tab of a game's details (js\detailtabs.js): this game's own
    pictures and video, and another game's copied onto it (api\copy-media.php).

    It opens on what this game shows, a row a picture and one for the video. A
    press on a picture opens what Change Pictures offers for that slot
    (js\art-editors.js), and a file dropped on one replaces it. The video row
    says where its file is, and a press clears it. Copy from another game opens
    the library's games, this console's first, with a find box: a press on one
    shows what it has beside what this game shows, and a press on a row copies
    that one, asking first when it replaces one this game shows. */

import { askClearAll, openPicker, uploadArt, videoClearLines } from "./art-editors.js";
import { confirmWindow } from "./confirm.js";
import { onTabLeave, setTabRows, tabPane, tabSays } from "./detailtabs.js";
import { reloadKeeping } from "./editors.js";
import { iconEl } from "./icons.js";
import { showStrip } from "./launch.js";
import { L, api } from "./log.js";
import { popupMenu } from "./menus.js";
import { addsMissing } from "./missing.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { games, hasGamesDb, sel } from "./state.js";
import { artUrl, el } from "./util.js";
import { render, setCarNodes, setWheelNodes } from "./views.js";

export function mediaTabLabel() { return "Media"; }

// Which part of the tab is up, kept while this game's details is drawn again.
var copyFrom = null;      // { forId, id }: the game being copied from
var picking = null;       // the game whose tab shows the games to copy from
var changed = null;       // the game whose pictures changed here: the views behind catch up when the tab is left

var KIND_WORDS = { box: "box art", box3d: "3D box", logo: "clear logo", shot: "screenshot", fanart: "fanart", video: "video" };

function nameOf(x) { return x.title + (x.variant ? " (" + x.variant + ")" : ""); }

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

export function mediaPane(pane, g) {
  // The views behind are brought up to date once, when the tab is left, as Change Pictures does when it closes.
  onTabLeave(pane, function () {
    if (changed !== g.id) { return; }
    changed = null;
    reloadKeeping(games[sel] ? games[sel].id : g.id);
  });
  if (copyFrom && copyFrom.forId === g.id) { showFrom(pane, g, copyFrom.id, 0); return; }
  copyFrom = null;
  if (picking === g.id) { pickGame(pane, g); return; }
  picking = null;
  ownMedia(pane, g, 0);
}

/* ---- this game's own pictures and video ---- */

function ownMedia(pane, g, keepAt) {
  if (!pane.firstChild) { pane.appendChild(el("p", "dtab-wait", "…")); }
  api("api/art.php?id=" + encodeURIComponent(g.id)).then(function (res) {
    if (tabPane("media") !== pane || picking === g.id || (copyFrom && copyFrom.forId === g.id)) { return; }
    if (!res.ok) {
      pane.textContent = "";
      pane.appendChild(tabSays(res.error || "this game's pictures could not be read"));
      setTabRows(pane, null);
      return;
    }
    paintOwn(pane, g, res, keepAt);
  });
}

/* A picture in a row's frame, fresh from the disk, or a dash where there is none. */
function ownShot(g, kind, k) {
  var frame = el("div", "sv-shot md-shot");
  if (!k.has) { frame.appendChild(el("span", "md-none", "none")); return frame; }
  var img = el("img");
  img.alt = "";
  // size=full skips the thumbnail cache, and the moment makes it an address the browser has not kept.
  img.src = "api/image.php?id=" + encodeURIComponent(g.id) + "&kind=" + kind + "&size=full&v=" + Date.now();
  img.onerror = function () { img.remove(); frame.appendChild(el("span", "md-none", "none")); };
  frame.appendChild(img);
  return frame;
}

function paintOwn(pane, g, res, keepAt) {
  pane.textContent = "";
  var inner = el("div", "ch-inner ch-tab md-tab");
  inner.appendChild(el("p", "group-help", "What " + g.title + " shows. A press on a picture says what can be done with it, "
    + "as Change Pictures does, and a file dropped on one replaces it. Stored in Xsegon only."));
  var list = el("div", "ch-list md-list md-own");
  inner.appendChild(list);
  pane.appendChild(inner);

  var v = res.video || {};
  var kinds = Object.keys(res.kinds);
  var showing = v.has || kinds.some(function (kind) { return res.kinds[kind].has || res.kinds[kind].replaced; });
  var lines = kinds.map(function (kind) { return { act: "pic", kind: kind, k: res.kinds[kind] }; })
    .concat([{ act: "video" }, { act: "copy" }], showing ? [{ act: "clear" }] : []);
  var WORD = { pic: "change it", video: "clear it", copy: "open", clear: "clear all" };
  var cells = [], at = 0, finding = null;
  var working = false;      // a change on its way: one at a time

  function focusAt(i) {
    i = Math.max(0, Math.min(cells.length - 1, i));
    at = i;
    cells.forEach(function (c, n) { c.classList.toggle("sel", n === i); });
    var x = lines[i];
    setTabRows(pane, { cells: cells, at: i, word: WORD[x.act], look: x.act === "video" && !v.has,
                       move: function (d) { focusAt(at + d); }, choose: function () { choose(at); } });
    if (cells[i]) { cells[i].scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }
  function say(cell, text, bad) {
    var sub = cell.querySelector(".sv-sub");
    if (sub) { sub.textContent = text; sub.classList.toggle("bad", !!bad); }
  }
  // A change made: the rows are read again, and the cover beside them shows a new box art at once.
  function again(kind) {
    changed = g.id;
    if (kind === "box") { coverAgain(g, "api/image.php?id=" + encodeURIComponent(g.id) + "&kind=box&size=full&v=" + Date.now()); }
    if (tabPane("media") === pane) { ownMedia(pane, g, at); }
  }
  function upload(x, cell, file) {
    if (!file || working) { return; }
    working = true;
    uploadArt(g, x.kind, file, function (t) { say(cell, t, false); }).then(function () {
      sound("select");
      again(x.kind);
    }).catch(function (e) { working = false; say(cell, e.message, true); });
  }
  function pickFile(x, cell) {
    var fileBox = el("input");
    fileBox.type = "file";
    fileBox.accept = "image/png,image/jpeg,image/webp,image/gif";
    fileBox.addEventListener("change", function () { upload(x, cell, fileBox.files[0]); });
    fileBox.click();
  }
  function post(x, cell, q, fail) {
    working = true;
    api("api/art.php?id=" + encodeURIComponent(g.id) + "&kind=" + x.kind + q, { method: "POST" }).then(function (r) {
      working = false;
      if (!r.ok) { sound("back"); say(cell, r.error || fail, true); return; }
      sound("select");
      again(x.kind);
    });
  }
  // Find online takes the rows' place until Back, as it takes the slots' in Change Pictures.
  // Its presses are the tab's list, read afresh as it fills, so Enter or A never falls through to Play.
  function findOnline(x) {
    finding = x.kind;
    var box = openPicker(g, x.kind, x.k.label, list, function () { if (tabPane("media") === pane) { focusAt(at); } });
    var on = 0;
    function presses() { return Array.prototype.slice.call(box.querySelectorAll(".pk-head button, .pk-search button, .pk > button, .pk-cell, .pk-result")); }
    function mark(i) {
      var all = presses();
      on = Math.max(0, Math.min(all.length - 1, i));
      all.forEach(function (c, n) { c.classList.toggle("sel", n === on); });
      if (all[on]) { all[on].scrollIntoView({ block: "nearest", inline: "nearest" }); }
      setTabRows(pane, { cells: all, at: on, word: "choose", move: function (d) { mark(on + d); },
                         choose: function () { var c = presses()[on]; if (c) { c.click(); } } });
    }
    mark(0);
  }
  inner.addEventListener("xs-art-changed", function () { if (finding) { again(finding); } });

  function choose(i) {
    var x = lines[i], cell = cells[i];
    if (!x || working) { return; }
    if (x.act === "copy") { sound("select"); picking = g.id; pickGame(pane, g); return; }
    if (x.act === "clear") {
      askClearAll(g, res, function (err) {
        again("box");
        if (err) { showStrip(err, true); }
      });
      return;
    }
    if (x.act === "video") {
      if (!v.has) { sound("back"); return; }
      confirmWindow("Clear the video of " + res.title + "?", function (box) { videoClearLines(box, v); }, { label: "Clear video", run: function () {
        stopVideo();
        api("api/video-own.php?id=" + encodeURIComponent(g.id) + "&clear=1", { method: "POST" }).then(function (r) {
          L("ART", g.title + ": clear video from the Media tab: " + (r.ok ? r.gone + " deleted" : r.error));
          sound(r.ok ? "ok" : "back");
          again("video");
          if (!r.ok) { showStrip(r.error || "the video could not be cleared", true); }
        });
      } });
      return;
    }
    // A picture: the buttons Change Pictures has under its slot, as a menu on the row.
    var k = x.k, r = cell.getBoundingClientRect();
    var did = function (what, run) { return function () { L("ART", g.title + ": " + what + " " + x.kind + " (Media tab)"); run(); }; };
    popupMenu([
      { label: k.has ? "Replace..." : "Add...", icon: "folder", run: did("choose a file for", function () { pickFile(x, cell); }) },
      { label: "Find online...", icon: "search", hidden: !hasGamesDb, run: did("find online", function () { findOnline(x); }) },
      { label: k.hadOne ? "Reset to the original" : "Remove", icon: "refresh", hidden: !k.replaced,
        run: did("reset", function () { post(x, cell, "&reset=1", "could not reset"); }) },
      { label: k.hidden ? "Use the original again" : "Use no picture", icon: "minus", hidden: k.replaced || !(k.has || k.hidden),
        run: did(k.hidden ? "use the original again for" : "use no picture for", function () { post(x, cell, "&hide=" + (k.hidden ? "0" : "1"), "could not change that"); }) }
    ], Math.round(r.left + 24), Math.round(r.bottom), k.label);
  }

  lines.forEach(function (x, i) {
    var line, words = el("div", "sv-words");
    if (x.act === "pic") {
      var k = x.k;
      line = el("div", "cr-row sv-row md-kind md-mine" + (k.hidden ? " md-hid" : ""));
      line.dataset.kind = x.kind;
      line.title = "What can be done with this picture";
      line.appendChild(ownShot(g, x.kind, k));
      words.appendChild(el("span", "cr-name", k.label));
      words.appendChild(el("span", "sv-sub", k.replaced ? "replaced in Xsegon" : k.hidden ? "hidden: the original is not used" : k.has ? "the original" : "no image"));
      line.appendChild(words);
      line.addEventListener("dragover", function (e) { e.preventDefault(); line.classList.add("drop"); });
      line.addEventListener("dragleave", function () { line.classList.remove("drop"); });
      line.addEventListener("drop", function (e) {
        e.preventDefault();
        line.classList.remove("drop");
        upload(x, line, e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
      });
    } else if (x.act === "video") {
      // Only where its file is: nothing plays here.
      line = el("div", "cr-row sv-row md-kind md-video" + (v.has ? "" : " ro"));
      line.dataset.kind = "video";
      if (v.has) { line.title = "Clear this video"; }
      line.appendChild(iconEl("cr-ico", "film"));
      words.appendChild(el("span", "cr-name", "Video"));
      words.appendChild(el("span", "sv-sub md-path", v.has ? v.path : "none"));
      line.appendChild(words);
      if (v.has) { line.appendChild(el("span", "cr-tag", "Clear video...")); }
    } else if (x.act === "copy") {
      line = el("div", "cr-row ch-act md-copy");
      line.appendChild(iconEl("cr-ico", "download"));
      line.appendChild(el("span", "cr-name", "Copy from another game..."));
    } else {
      line = el("div", "cr-row ch-act md-clear");
      line.appendChild(iconEl("cr-ico", "trash"));
      line.appendChild(el("span", "cr-name", "Clear all..."));
      line.appendChild(el("span", "cr-tag", "every picture and the video show nothing; it asks first"));
    }
    line.addEventListener("mouseenter", function () { focusAt(i); });
    line.addEventListener("click", function () { choose(i); });
    cells.push(line);
    list.appendChild(line);
  });
  // A file let go beside the rows must not open in place of the page.
  inner.addEventListener("dragover", function (e) { e.preventDefault(); });
  inner.addEventListener("drop", function (e) { e.preventDefault(); });
  focusAt(keepAt || 0);
  // Details is built before it is on the screen, and setTabRows ignores a
  // pane that is not on it: the list is handed over again a moment later.
  Promise.resolve().then(function () { if (tabPane("media") === pane) { focusAt(at); } });
}

/* ---- the games to copy from: a find box over the library, asked of the server as it is typed ---- */

function pickGame(pane, g) {
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
  back.addEventListener("mouseenter", function () { focusAt(0); });
  back.addEventListener("click", function () { choose(0); });
  var cells = [back], found = [], at = 0, asked = 0;
  list.appendChild(back);
  function focusAt(i) {
    i = Math.max(0, Math.min(cells.length - 1, i));
    at = i;
    cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
    setTabRows(pane, { cells: cells, at: at, find: box, word: i === 0 ? "go back" : "open",
                       move: function (d) { focusAt(at + d); }, choose: function () { choose(at); } });
    if (cells[i]) { cells[i].scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }
  function choose(i) {
    if (i === 0) { sound("back"); picking = null; ownMedia(pane, g, 0); return; }
    var x = found[i - 1];
    if (!x) { return; }
    sound("select");
    copyFrom = { forId: g.id, id: x.id };
    L("ART", g.title + ": looking at " + nameOf(x) + " to copy from");
    showFrom(pane, g, x.id, 0);
  }
  function ask() {
    var mine = ++asked, words = box.value.trim();
    api("api/copy-media.php?id=" + encodeURIComponent(g.id) + "&find=" + encodeURIComponent(words)).then(function (res) {
      if (mine !== asked || tabPane("media") !== pane) { return; }   // typed on since, or the tab left
      cells.slice(1).forEach(function (c) { c.remove(); });
      cells = [back];
      found = (res.ok && res.games) || [];
      if (!res.ok) { foot.textContent = "The library could not be read: " + (res.error || "the server gave no answer"); focusAt(0); return; }
      found.forEach(function (x, i) {
        var line = el("div", "cr-row md-game" + (x.same ? "" : " md-other"));
        line.appendChild(iconEl("cr-ico", "image"));
        line.appendChild(el("span", "cr-name", nameOf(x)));
        line.appendChild(el("span", "cr-tag", (x.same ? "" : x.platform + "  ·  ") + hasWords(x.has)));
        line.addEventListener("mouseenter", function () { focusAt(i + 1); });
        line.addEventListener("click", function () { choose(i + 1); });
        cells.push(line);
        list.appendChild(line);
      });
      var n = found.length;
      foot.textContent = !n ? (words ? "No game with pictures or a video matches “" + words + "”." : "No other game in the library has pictures or a video.")
        : res.more ? "The first " + n + " shown. Type part of a name to find the rest."
        : n + (n === 1 ? " game" : " games") + (words ? " match “" + words + "”." : " with pictures or a video.");
      focusAt(Math.min(at, cells.length - 1));
    });
  }
  var wait;
  box.addEventListener("input", function () { clearTimeout(wait); wait = setTimeout(function () { at = 0; ask(); }, 200); });
  focusAt(0);
  ask();
}

/* A picture or the video in a row's frame, or a dash where there is none. */
function shot(kind, url, cls) {
  var frame = el("div", "sv-shot md-shot " + cls);
  if (!url) { frame.appendChild(el("span", "md-none", "none")); return frame; }
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

/* What the other game has beside what this one shows. keepAt: the row the bar stays on after a copy. */
function showFrom(pane, g, fromId, keepAt) {
  if (!pane.firstChild) { pane.appendChild(el("p", "dtab-wait", "…")); }
  api("api/copy-media.php?id=" + encodeURIComponent(g.id) + "&from=" + encodeURIComponent(fromId)).then(function (res) {
    if (tabPane("media") !== pane) { return; }
    if (!res.ok) {
      copyFrom = null;
      pane.textContent = "";
      pane.appendChild(tabSays(res.error || "that game could not be read"));
      setTabRows(pane, null);
      return;
    }
    paintFrom(pane, g, res, keepAt);
  });
}

function paintFrom(pane, g, res, keepAt) {
  pane.textContent = "";
  var inner = el("div", "ch-inner ch-tab md-tab");
  inner.appendChild(el("p", "group-help", "From " + nameOf(res.from) + ", " + res.from.platform
    + ". A press copies one onto " + g.title + "; what " + g.title + " shows now is on the right."));
  var list = el("div", "ch-list md-list md-kinds");
  inner.appendChild(list);
  inner.appendChild(el("p", "mt-note", "A copy is this game's own picture or video: Change Pictures and Replace Video can take it away again."));
  pane.appendChild(inner);

  var can = res.rows.filter(function (r) { return r.from && !r.same; });
  var lines = [{ act: "back" }, { act: "all" }].concat(res.rows.map(function (r) { return { act: "kind", r: r }; }));
  var cells = [], at = 0, copying = false;

  function focusAt(i) {
    i = Math.max(0, Math.min(cells.length - 1, i));
    at = i;
    cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
    var x = lines[i], off = x.act === "all" ? !can.length : x.act === "kind" && (!x.r.from || x.r.same);
    setTabRows(pane, { cells: cells, at: i, word: x.act === "back" ? "go back" : "copy", look: off,
                       move: function (d) { focusAt(at + d); }, choose: function () { choose(at); } });
    if (cells[i]) { cells[i].scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }

  function choose(i) {
    var x = lines[i];
    if (copying || !x) { return; }
    if (x.act === "back") { sound("back"); copyFrom = null; pickGame(pane, g); return; }
    var kinds = x.act === "all" ? can.map(function (r) { return r.kind; }) : (x.r.from && !x.r.same ? [x.r.kind] : []);
    if (!kinds.length) { sound("back"); return; }
    var replaces = res.rows.filter(function (r) { return kinds.indexOf(r.kind) >= 0 && r.to; });
    if (!replaces.length) { copy(x.act === "all" ? "all" : x.r.kind, cells[i]); return; }
    confirmWindow("This replaces its " + listWords(replaces.map(function (r) { return r.kind; })), function (box) {
      var one = replaces.length === 1;
      box.appendChild(el("p", null, "On the left, what " + g.title + " shows now. On the right, " + nameOf(res.from)
        + "’s, which " + (one ? "takes its" : "take their") + " place."));
      replaces.forEach(function (r) {
        var pair = el("div", "md-pair");
        pair.appendChild(shot(r.kind, r.to, "md-to"));
        pair.appendChild(el("span", "md-arrow", "→"));
        pair.appendChild(shot(r.kind, r.from, "md-from"));
        pair.appendChild(el("span", "md-what", r.label));
        box.appendChild(pair);
      });
    }, { label: "Copy", run: function () { copy(x.act === "all" ? "all" : x.r.kind, cells[i]); } }, "Cancel");
  }

  function copy(kind, cell) {
    copying = true;
    var tag = cell && cell.querySelector(".sv-sub, .cr-tag");
    if (tag) { tag.textContent = "copying…"; }
    api("api/copy-media.php?id=" + encodeURIComponent(g.id) + "&from=" + encodeURIComponent(res.from.id) + "&kind=" + kind, { method: "POST" }).then(function (now) {
      copying = false;
      var got = (now && now.copied) || [], lost = (now && now.failed) || [];
      if (got.length) { takeIn(g, now.patch, got); }
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
      if (tabPane("media") !== pane) { return; }
      if (now.rows) { res.rows = now.rows; paintFrom(pane, g, res, at); }
      else { showFrom(pane, g, res.from.id, at); }
    });
  }

  lines.forEach(function (x, i) {
    var line;
    if (x.act === "back") {
      line = el("div", "cr-row ch-act md-back");
      line.appendChild(iconEl("cr-ico", "back"));
      line.appendChild(el("span", "cr-name", "Back to the games"));
    } else if (x.act === "all") {
      line = el("div", "cr-row ch-act md-all" + (can.length ? "" : " ro"));
      line.appendChild(iconEl("cr-ico", "download"));
      line.appendChild(el("span", "cr-name", "Copy all it has"));
      line.appendChild(el("span", "cr-tag", can.length ? listWords(can.map(function (r) { return r.kind; })) : "nothing more to copy"));
    } else {
      var r = x.r, off = !r.from || r.same;
      line = el("div", "cr-row sv-row md-kind" + (off ? " ro" : "") + (r.same ? " on" : ""));
      line.dataset.kind = r.kind;
      line.appendChild(iconEl("cr-ico", r.same ? "check" : r.kind === "video" ? "film" : "image"));
      var words = el("div", "sv-words");
      words.appendChild(el("span", "cr-name", r.label));
      words.appendChild(el("span", "sv-sub", !r.from ? nameOf(res.from) + " has none"
        : r.same ? "the same as this game’s" : r.to ? "a press replaces this game’s" : "this game has none: a press copies it"));
      line.appendChild(words);
      line.appendChild(shot(r.kind, r.from, "md-from"));
      line.appendChild(el("span", "md-arrow", "→"));
      line.appendChild(shot(r.kind, r.to, "md-to"));
    }
    line.addEventListener("mouseenter", function () { focusAt(i); });
    line.addEventListener("click", function () { choose(i); });
    cells.push(line);
    list.appendChild(line);
  });
  focusAt(keepAt || 0);
  // Details is built before it is on the screen, and setTabRows ignores a
  // pane that is not on it: the list is handed over again a moment later.
  Promise.resolve().then(function () { if (tabPane("media") === pane) { focusAt(at); } });
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
  if (lacks && got.indexOf("video") >= 0) { lacks.remove(); }
}

/* Details' cover after the box art changed in the tab: the new picture once
   it has come, or NO ART back when there is none (its address answers 404),
   each in the other's place. The old one shows until then. */
function coverAgain(g, src) {
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
