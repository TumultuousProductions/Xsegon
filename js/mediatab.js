/*  The Media tab of a game's details (js\detailtabs.js): another game's
    pictures and video, copied onto this one (api\copy-media.php).

    It opens on the library's games, this console's first, with a find box. A
    press on one shows what it has beside what this game shows, a row a kind;
    a press on a row copies that one, and asks first when it replaces one this
    game shows. The copy shows at once in details and in the view behind. */

import { confirmWindow } from "./confirm.js";
import { setTabRows, tabPane, tabSays } from "./detailtabs.js";
import { iconEl } from "./icons.js";
import { showStrip } from "./launch.js";
import { L, api } from "./log.js";
import { sound } from "./sound.js";
import { artUrl, el } from "./util.js";
import { render, setCarNodes, setWheelNodes } from "./views.js";

export function mediaTabLabel() { return "Media"; }

// The game being copied from, kept while this game's details is drawn again.
var copyFrom = null;      // { forId, id }

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
  if (copyFrom && copyFrom.forId === g.id) { showFrom(pane, g, copyFrom.id, 0); return; }
  copyFrom = null;
  pickGame(pane, g);
}

/* The games to copy from: a find box over the library, asked of the server as it is typed. */
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

  var cells = [], found = [], at = 0, asked = 0;
  function focusAt(i) {
    i = Math.max(0, Math.min(cells.length - 1, i));
    at = Math.max(0, i);
    cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
    setTabRows(pane, { cells: cells, at: at, find: box, word: "open", look: !cells.length,
                       move: function (d) { focusAt(at + d); }, choose: function () { choose(at); } });
    if (cells[i]) { cells[i].scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }
  function choose(i) {
    var x = found[i];
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
      list.textContent = "";
      cells = [];
      found = (res.ok && res.games) || [];
      if (!res.ok) { foot.textContent = "The library could not be read: " + (res.error || "the server gave no answer"); focusAt(0); return; }
      found.forEach(function (x, i) {
        var line = el("div", "cr-row md-game" + (x.same ? "" : " md-other"));
        line.appendChild(iconEl("cr-ico", "image"));
        line.appendChild(el("span", "cr-name", nameOf(x)));
        line.appendChild(el("span", "cr-tag", (x.same ? "" : x.platform + "  ·  ") + hasWords(x.has)));
        line.addEventListener("mouseenter", function () { focusAt(i); });
        line.addEventListener("click", function () { choose(i); });
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
  var cover = document.querySelector("#details .dleft img.cover");
  if (cover && got.indexOf("box") >= 0) { cover.src = artUrl(g, "box", true); }
  var lacks = document.querySelector("#details .dlacks");
  if (lacks && got.indexOf("video") >= 0) { lacks.remove(); }
}
