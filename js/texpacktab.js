/*  The Texture packs tab of a game's details (js\detailtabs.js): the pack its
    emulator loads for the game, the packs the shipped list has for it, and
    putting one in place: one of those by its own download where it has one, or
    a .zip, .7z or folder the person chose in Windows' own window. The work is
    done in the background (api\texpacks.php, bin\texpacks.php) with a bar in
    the corner; when it ends, the library is read again and this tab with it. */

import { confirmWindow } from "./confirm.js";
import { setTabRows, tabPane, tabSays } from "./detailtabs.js";
import { iconEl } from "./icons.js";
import { jobsWatch } from "./jobbars.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { showInExplorer } from "./reveal.js";
import { pickWindowsFolder } from "./scan.js";
import { sound } from "./sound.js";
import { el } from "./util.js";

// The consoles whose games have the tab, as includes\texpacks.php has them.
var CONSOLES = ["sony playstation 2", "nintendo gamecube", "nintendo wii", "nintendo 64"];
var paidOpen = false;          // the folded box of paid packs, opened by the person

export function texPacksFor(g) {
  return !!g && !g.local && !g.steam && CONSOLES.indexOf(String(g.platform || "").toLowerCase()) >= 0;
}

export function texPacksTabLabel(g, full) {
  var n = full && full.texPacks ? full.texPacks.found : 0;
  return n ? "Texture packs (" + n + ")" : "Texture packs";
}

/* About's line for the pack: the one put in place, else how many are listed. */
export function texPackFact(full) {
  var t = full && full.texPacks;
  if (!t) { return ""; }
  if (t.have) { return (t.have.from || "a pack") + ", " + sizeSaid(t.have.bytes); }
  return t.found ? "none on this PC  ·  " + t.found + " found" : "";
}

function sizeSaid(n) {
  return n >= 1073741824 ? (n / 1073741824).toFixed(2) + " GB" : Math.max(0.1, n / 1048576).toFixed(1) + " MB";
}

function packSaid(p) {
  return (p.whole ? "" : "more than ") + p.files.toLocaleString() + (p.files === 1 ? " file" : " files") + ", " + sizeSaid(p.bytes);
}

var KIND = { hand: "Handcrafted", ai: "AI upscale", mixed: "Mixed" };
var PAY = { account: "needs an account", ads: "with ads", paid: "paid" };

export function texPacksPane(pane, g) {
  api("api/texpacks.php?id=" + encodeURIComponent(g.id)).then(function (res) {
    if (tabPane("texpacks") !== pane) { return; }            // another tab, or another game, by now
    if (!res.ok) { pane.textContent = ""; pane.appendChild(tabSays("the texture pack for this game could not be looked at")); return; }
    paint(pane, g, res);
  });
}

function paint(pane, g, res) {
  pane.textContent = "";
  var inner = el("div", "ch-inner ch-tab sv-tab tp-tab");
  var list = el("div", "sv-list");
  var cells = [], rows = [], at = 0;
  var can = !!res.can;

  function group(title, help) {
    var sec = el("div", "sv-group");
    sec.appendChild(el("h3", "dst-head sv-head", title));
    if (help) { sec.appendChild(el("p", "sv-help", help)); }
    var box = el("div", "sv-rows");
    sec.appendChild(box);
    list.appendChild(sec);
    return { sec: sec, box: box };
  }
  function addRow(box, r) {
    var line = el("div", "cr-row sv-row" + (r.act ? " ch-act" : "") + (r.ro ? " ro" : ""));
    var fr = el("div", "sv-shot");
    fr.appendChild(iconEl("cr-ico", r.icon));
    line.appendChild(fr);
    var words = el("div", "sv-words");
    var name = el("span", "cr-name", r.name);
    if (r.kind) { name.appendChild(el("span", "tp-kind" + (r.kind === "hand" ? " hand" : ""), KIND[r.kind])); }
    words.appendChild(name);
    if (r.sub) { words.appendChild(el("span", "sv-sub", r.sub)); }
    line.appendChild(words);
    if (r.tag) { line.appendChild(el("span", "cr-tag", r.tag)); }
    if (r.tip) {
      var tip = el("button", "tp-tip", "Tip");
      tip.type = "button";
      tip.title = "The pack maker's tip page, in your browser";
      tip.addEventListener("click", function (e) { e.stopPropagation(); openPage(g, r.tip, "tip"); });
      line.appendChild(tip);
    }
    if (r.go) { line.appendChild(iconEl("cr-ico sv-go", r.go)); }
    if (r.run) {
      var mine = cells.length;
      line.addEventListener("mouseenter", function () { focusAt(mine); });
      line.addEventListener("click", function () { r.run(); });
      cells.push(line);
      rows.push(r);
    }
    box.appendChild(line);
    return line;
  }
  function focusAt(i) {
    i = Math.max(0, Math.min(cells.length - 1, i));
    at = i;
    cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
    setTabRows(pane, {
      cells: cells, at: i, word: rows[i].word,
      move: function (d) { focusAt(at + d); },
      choose: function () { rows[at].run(); }
    });
    cells[i].scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // ---- the pack on this PC, and putting one in place ----
  if (!can) {
    inner.appendChild(tabSays(res.why || "texture packs cannot be put in place for this game"));
  } else {
    var here = group("On this PC", res.emulator + " loads a pack for this game from " + res.where + ".");
    var p = res.installed;
    if (res.job) {
      addRow(here.box, { icon: "download", ro: true, name: res.job.action === "remove" ? "Taking the pack away" : "Putting a pack in place",
                         sub: "the bar in the corner shows how far it is" });
      jobsWatch("texpacks");
    } else if (p) {
      addRow(here.box, { icon: "image", go: "folder", word: "show in its folder",
        name: p.mine && p.from ? "A pack from " + p.from : "A pack put here by hand",
        sub: res.folder + "  ·  " + res.setWords + (res.loads ? " is on for this game" : " is off for this game, so it is not shown"),
        tag: packSaid(p),
        run: function () { L("MNU", "texture pack shown in its folder: " + g.title); showInExplorer({ id: g.id, what: "texpack" }); } });
      addRow(here.box, { icon: "trash", act: true, word: "take it away", name: "Take this pack away...",
        sub: "Asks first; " + res.emulator + " then shows the game's own textures",
        run: function () { askRemove(g, res, pane); } });
    }
    if (!res.job) {
      addRow(here.box, { icon: "download", act: true, word: "choose the file", name: p ? "Install another pack you downloaded..." : "Install a pack you downloaded...",
        sub: "A .zip or .7z from a pack's page: Xsegon puts it in place and turns " + res.setWords + " on for this game only" + (p ? "; asks before it replaces the one above" : ""),
        run: function () { choose(g, "file", pane); } });
      addRow(here.box, { icon: "folder", act: true, word: "choose the folder", name: "Install from a folder you unpacked...",
        sub: "For a .rar, or a pack you unpacked yourself: its files are copied, the folder stays as it is",
        run: function () { choose(g, "folder", pane); } });
    }
  }

  // ---- the packs the list has for it ----
  var found = res.found || [];
  var free = found.filter(function (f) { return f.pay !== "paid"; }), paid = found.filter(function (f) { return f.pay === "paid"; });
  var gets = can && !res.job && free.some(function (f) { return f.get; });
  var listed = group("Found for this game", found.length
    ? "From the Texture Packs Archive, kept by Sad Origami. Handmade first. " + (gets
      ? "A press on a row with the arrow down gets the pack and puts it in place; the others open their page: download it there, then Install a pack you downloaded."
      : "A press opens the pack's page: download it there, then Install a pack you downloaded.")
    : "The list that came with this Xsegon has no pack for this game.");
  function packRow(box, f) {
    var direct = f.get && can && !res.job;
    var sub = [f.status, f.kind ? "" : "kind not said", f.note, f.name ? "by " + f.by : "", f.where + (PAY[f.pay] ? ", " + PAY[f.pay] : "")]
      .filter(Boolean).join("  ·  ");
    return addRow(box, { icon: "image", name: f.name || f.by, kind: f.kind, sub: sub, tag: f.size ? sizeSaid(f.size) : "size not said",
      tip: f.tip ? f.k : "", go: direct ? "download" : "external", word: direct ? "get it" : "open its page",
      run: function () { if (direct) { getPack(g, f, false, pane); } else { openPage(g, f.k, "page"); } } });
  }
  free.forEach(function (f) { packRow(listed.box, f); });
  if (!free.length && found.length) { listed.box.remove(); }
  if (paid.length) {
    // Paid packs folded away, as the person chose: the box opens with a press, by the mouse or the keys.
    var fold = el("div", "fc-sec tp-paid");
    var head = el("div", "sv-rows");
    addRow(head, { icon: paidOpen ? "minus" : "plus", act: true, name: "Paid packs (" + paid.length + ")", word: paidOpen ? "fold them away" : "show them",
      sub: "Sold by their makers, mostly on Patreon", run: function () { paidOpen = !paidOpen; L("MNU", "texture packs: paid ones " + (paidOpen ? "shown" : "folded")); paint(pane, g, res); } });
    fold.appendChild(head);
    if (paidOpen) {
      var inside = el("div", "sv-rows");
      paid.forEach(function (f) { packRow(inside, f); });
      fold.appendChild(inside);
    }
    listed.sec.appendChild(fold);
  }

  inner.appendChild(list);
  inner.appendChild(el("p", "mt-note", "A texture pack is its maker's own: Xsegon never keeps or hands out a copy. "
    + "A big pack can make a game take longer to start, or stutter; taking it away puts the game back as it was."));
  pane.appendChild(inner);
  if (cells.length) { focusAt(Math.min(at, cells.length - 1)); } else { setTabRows(pane, null); }
}

/* A listed pack's page, or its maker's tip page, opened in the browser by the server (by its key, never an address). */
function openPage(g, k, which) {
  L("MNU", "texture pack: open its " + which + " for " + g.title);
  postJson("api/texpacks.php", { id: g.id, open: k, which: which }).then(function (r) {
    if (!r.ok) { showStrip("the page did not open: " + (r.error || "no answer"), true); return; }
    sound("select");
    showStrip("opened in your browser: " + r.url, false);
  });
}

/* Windows' own window for the pack, then the work in the background. */
function choose(g, kind, pane) {
  L("MNU", "texture pack: choose a " + kind + " for " + g.title);
  pickWindowsFolder(kind === "file" ? "Choose the texture pack for " + g.title + " (.zip or .7z)" : "Choose the folder of the texture pack for " + g.title,
    { kind: kind, types: kind === "file" ? "textures" : "" }).then(function (path) {
    if (path) { start(g, { from: path }, path.split("\\").pop(), false, pane); }
  });
}

function getPack(g, f, replace, pane) {
  start(g, { get: f.k }, (f.name || "the pack by " + f.by) + (f.size ? ", " + sizeSaid(f.size) : ""), replace, pane);
}

/* Started, or asked first when a pack is there: what is there, what comes in its place. */
function start(g, body, said, replace, pane) {
  postJson("api/texpacks.php", Object.assign({ id: g.id, replace: !!replace }, body)).then(function (r) {
    if (!r.ok) { showStrip("the texture pack was not put in place: " + (r.error || "no answer"), true); return; }
    if (r.needs === "replace") {
      var p = r.installed || { files: 0, bytes: 0, whole: true };
      confirmWindow("Replace the texture pack?", function (box) {
        box.appendChild(el("p", null, g.title + " has a texture pack now: " + (p.mine && p.from ? "from " + p.from : "put there by hand") + ", " + packSaid(p) + "."));
        box.appendChild(el("p", "confirm-game", "In its place: " + said));
        box.appendChild(el("p", "confirm-note", "The one there is deleted once the new one is all in, not put in the Recycle Bin. "
          + (p.mine && p.from ? "Where it came from is not touched, so it can be installed again." : "Xsegon did not put it there, so where it came from is not known.")));
      }, { label: "Replace it", run: function () { start(g, body, said, true, pane); } }, "Keep the one there",
         function () { L("MNU", "texture pack: kept the one there for " + g.title); });
      return;
    }
    L("MNU", "texture pack: putting " + said + " in place for " + g.title);
    sound("ok");
    showStrip((body.get ? "getting the texture pack and putting it in place" : "putting the texture pack in place") + " in the background: the bar in the corner shows how far it is", false);
    jobsWatch("texpacks");
    if (tabPane("texpacks") === pane) { texPacksPane(pane, g); }
  });
}

function askRemove(g, res, pane) {
  var p = res.installed;
  confirmWindow("Take the texture pack away?", function (box) {
    box.appendChild(el("p", "confirm-game", g.title + ": " + packSaid(p)));
    box.appendChild(el("p", "confirm-note", "From: " + res.folder));
    box.appendChild(el("p", null, "Its files are deleted, not put in the Recycle Bin. "
      + (p.mine && p.from ? "Where it came from, " + p.from + ", is not touched, so it can be installed again." : "Xsegon did not put it there, so where it came from is not known.")));
    if (p.mine) { box.appendChild(el("p", "confirm-safe", res.setWords + " goes back to how it was for this game.")); }
  }, { label: "Take it away", run: function () { remove(g, pane); } }, "Keep it",
     function () { L("MNU", "texture pack: kept for " + g.title); });
}

function remove(g, pane) {
  postJson("api/texpacks.php", { id: g.id, remove: true }).then(function (r) {
    if (!r.ok) { showStrip("the texture pack was not taken away: " + (r.error || "no answer"), true); return; }
    L("MNU", "texture pack: taking it away for " + g.title);
    sound("ok");
    showStrip("taking the texture pack away in the background: the bar in the corner shows how far it is", false);
    jobsWatch("texpacks");
    if (tabPane("texpacks") === pane) { texPacksPane(pane, g); }
  });
}
