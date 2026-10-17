/*  The Texture packs tab of a game's details (js\detailtabs.js): where the
    game's emulator loads its packs from, putting one in place (a .zip, .7z or
    folder the person chose in Windows' own window), and the packs: the shipped
    list's for the game, a listed one by its own download where it has one, and
    any installed from the person's own files. A pack installed says so on its
    own row, with its Uninstall there. Each row says what it does on a button of
    its own; a press on the row itself only selects it. The work is done in the
    background (api\texpacks.php, bin\texpacks.php), followed here by a bar of
    its own as well as the corner's. */

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

/* About's line for the packs: the ones put in place, else how many are listed. */
export function texPackFact(full) {
  var t = full && full.texPacks;
  if (!t) { return ""; }
  if (t.have) { return (t.have.n > 1 ? t.have.n + " packs" : t.have.from || "a pack") + ", " + sizeSaid(t.have.bytes); }
  return t.found ? "none on this PC  ·  " + t.found + " found" : "";
}

function sizeSaid(n) {
  return n >= 1073741824 ? (n / 1073741824).toFixed(2) + " GB" : Math.max(0.1, n / 1048576).toFixed(1) + " MB";
}

function packSaid(p) {
  return (p.whole ? "" : "more than ") + p.files.toLocaleString() + (p.files === 1 ? " file" : " files") + ", " + sizeSaid(p.bytes);
}

/* How far the work is, in words and as a part of the whole (null while there is nothing to measure). */
function progressOf(j) {
  var sized = (j.phase === "fetching" || j.phase === "unpacking" || j.phase === "copying") && j.total > 0;
  var words = sized ? (j.phase === "fetching" ? "Downloading" : j.phase === "unpacking" ? "Unpacking" : "Copying") + ": " + sizeSaid(j.bytes) + " of " + sizeSaid(j.total)
    : j.phase === "fetching" ? "Downloading: " + sizeSaid(j.bytes)
    : j.phase === "removing" ? "Deleting: " + (j.at || 0).toLocaleString() + " of " + (j.files || 0).toLocaleString() + " files"
    : j.phase === "reading" ? "Reading what is in it"
    : j.phase === "placing" || j.phase === "setting" || j.phase === "tidying" ? "Putting it in place" : "Starting";
  var frac = sized ? j.bytes / j.total : j.phase === "removing" && j.files > 0 ? j.at / j.files : null;
  return { words: words, frac: frac };
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
  var packs = can ? res.packs || [] : [];

  function group(title, help) {
    var sec = el("div", "sv-group");
    sec.appendChild(el("h3", "dst-head sv-head", title));
    if (help) { sec.appendChild(el("p", "sv-help", help)); }
    var box = el("div", "sv-rows");
    sec.appendChild(box);
    list.appendChild(sec);
    return { sec: sec, box: box };
  }
  function small(label, title, run) {
    var b = el("button", "tp-btn", label);
    b.type = "button";
    if (title) { b.title = title; }
    b.addEventListener("click", function (e) { e.stopPropagation(); run(); });
    return b;
  }
  /* A row: its words, then its buttons at the right. `button` is what the row
     does, pressed by the mouse, or by Enter or A with the row selected. */
  function addRow(box, r) {
    var line = el("div", "cr-row sv-row" + (r.button ? "" : " ro"));
    var fr = el("div", "sv-shot");
    fr.appendChild(iconEl("cr-ico", r.icon));
    line.appendChild(fr);
    var words = el("div", "sv-words");
    var name = el("span", "cr-name", r.name);
    if (r.kind) { name.appendChild(el("span", "tp-kind" + (r.kind === "hand" ? " hand" : ""), KIND[r.kind])); }
    if (r.on) { name.appendChild(el("span", "tp-kind on", "Installed")); }
    words.appendChild(name);
    if (r.sub) { words.appendChild(el("span", "sv-sub", r.sub)); }
    if (r.bar) { words.appendChild(r.bar); }
    line.appendChild(words);
    if (r.tag) { line.appendChild(el("span", "cr-tag", r.tag)); }
    if (r.tip) { line.appendChild(small("Tip", "The pack maker's tip page, in your browser", function () { openPage(g, r.tip, "tip"); })); }
    if (r.button) {
      line.appendChild(small(r.button, r.title, r.run));
      var mine = cells.length;
      line.addEventListener("mouseenter", function () { focusAt(mine); });
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
      cells: cells, at: i, word: rows[i].button.replace(/\.\.\.$/, "").toLowerCase(),
      move: function (d) { focusAt(at + d); },
      choose: function () { rows[at].run(); }
    });
    cells[i].scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // ---- the pack on this PC, and putting one in place ----
  if (!can) {
    inner.appendChild(tabSays(res.why || "texture packs cannot be put in place for this game"));
  } else {
    var here = group("On this PC", res.emulator + " loads this game's packs from " + res.where + ", every pack there at once.");
    if (res.job) {
      // The work, followed here as well as in the corner, until it ends.
      var now = progressOf(res.job);
      var bar = el("div", "tp-prog");
      var fill = el("i");
      bar.appendChild(fill);
      var line = addRow(here.box, { icon: res.job.action === "remove" ? "trash" : "download", bar: bar,
        name: res.job.action === "remove" ? "Uninstalling the pack" : "Installing " + (res.job.name || "the pack"), sub: now.words,
        button: res.job.action === "remove" ? "" : "Stop", title: "Stop: nothing is put in place", run: function () { stop(); } });
      var follow = function (j) {
        var w = progressOf(j);
        line.querySelector(".sv-sub").textContent = w.words;
        bar.classList.toggle("wait", w.frac === null);
        fill.style.width = w.frac === null ? "" : Math.round(w.frac * 100) + "%";
      };
      follow(res.job);
      jobsWatch("texpacks");
      (function poll() {
        setTimeout(function () {
          if (tabPane("texpacks") !== pane) { return; }
          api("api/texpacks.php?id=" + encodeURIComponent(g.id)).then(function (r) {
            if (tabPane("texpacks") !== pane || !r.ok) { return; }
            if (r.job) { follow(r.job); poll(); } else { paint(pane, g, r); }
          });
        }, 1000);
      })();
    } else if (packs.length) {
      addRow(here.box, { icon: "folder", name: "Its texture folder",
        sub: res.folder + "  ·  " + res.setWords + (res.loads ? " is on for this game" : " is off for this game, so its packs are not shown"),
        button: "Open folder", title: "Show the game's texture folder in Explorer",
        run: function () { L("MNU", "texture pack shown in its folder: " + g.title); showInExplorer({ id: g.id, what: "texpack" }); } });
      if (res.readsFirst) {
        addRow(here.box, { icon: "info", name: "The next start reads the packs first",
          sub: sizeSaid(res.readsFirst) + (res.readsFirst > 314572800 ? ": that can take minutes" : ": that can take a while")
            + ", and " + res.emulator + "'s window does not answer until it is done. Later starts are quicker." });
      }
    }
    if (!res.job) {
      addRow(here.box, { icon: "download", name: packs.length ? "Install another pack you downloaded" : "Install a pack you downloaded",
        sub: "A .zip or .7z from a pack's page: Xsegon puts it in place and turns " + res.setWords + " on for this game only"
          + (packs.length ? "; asks whether it goes beside the " + (packs.length === 1 ? "one" : "ones") + " installed or in their place" : ""),
        button: "Choose file...", run: function () { choose(g, "file", pane); } });
      addRow(here.box, { icon: "folder", name: "Install from a folder you unpacked",
        sub: "For a .rar, or a pack you unpacked yourself: its files are copied, the folder stays as it is",
        button: "Choose folder...", run: function () { choose(g, "folder", pane); } });
    }
  }

  // ---- the packs: the list's for it, and any installed from the person's own files ----
  var found = res.found || [];
  var free = found.filter(function (f) { return f.pay !== "paid"; }), paid = found.filter(function (f) { return f.pay === "paid"; });
  var own = can ? packs.filter(function (p) { return !p.listed; }) : [];
  var gets = can && !res.job && free.some(function (f) { return f.get && !f.pack; });
  var listed = group("Found for this game", found.length
    ? "From the Texture Packs Archive, kept by Sad Origami. Handmade first. " + (gets
      ? "Install downloads a pack and puts it in place, after a question. Their page opens a pack's own page in your browser: download it there, then Install a pack you downloaded."
      : "Their page opens a pack's own page in your browser: download it there, then Install a pack you downloaded.")
    : "The list that came with this Xsegon has no pack for this game" + (own.length ? ": the one" + (own.length > 1 ? "s" : "") + " below came from your own files." : "."));
  // Marked installed; its Uninstall waits while a pack is being installed or uninstalled.
  function uninstallRow(r, p) {
    return Object.assign(r, res.job ? { on: true } : { on: true, button: "Uninstall...", title: "Uninstall this pack (asks first)", run: function () { askRemove(g, res, p, pane); } });
  }
  // Installed from a file or folder the person chose, or put there by hand: a row of its own, at the top of the packs.
  own.forEach(function (p) {
    addRow(listed.box, uninstallRow({ icon: "image", name: p.mine && p.from ? p.from : "A pack put in its folder by hand",
      sub: [p.mine ? "from your own file or folder" : "not put there by Xsegon", packSaid(p), p.file ? "one file in the core's cache folder" : "",
            p.for ? "made for " + p.for : ""].filter(Boolean).join("  ·  ") }, p));
  });
  function packRow(box, f) {
    var p = f.pack && can ? packs.filter(function (x) { return x.id === f.pack; })[0] : null;
    var direct = f.get && can && !res.job;
    var sub = [f.status, f.kind ? "" : "kind not said", f.note, f.name ? "by " + f.by : "", f.where + (PAY[f.pay] ? ", " + PAY[f.pay] : ""),
               p ? "installed: " + packSaid(p) : ""].filter(Boolean).join("  ·  ");
    var r = { icon: "image", name: f.name || f.by, kind: f.kind, sub: sub, tag: f.size ? sizeSaid(f.size) : "size not said", tip: f.tip ? f.k : "" };
    if (p) { return addRow(box, uninstallRow(r, p)); }
    return addRow(box, Object.assign(r, { button: direct ? "Install..." : "Their page",
      title: direct ? "Download this pack and put it in place (asks first)" : "Open this pack's page in your browser",
      run: function () { if (direct) { askGet(g, f, res, pane); } else { openPage(g, f.k, "page"); } } }));
  }
  free.forEach(function (f) { packRow(listed.box, f); });
  if (!free.length && !own.length && found.length) { listed.box.remove(); }
  if (paid.length) {
    // Paid packs folded away, as the person chose: its own button opens and folds it, by the mouse or the keys.
    var fold = el("div", "fc-sec tp-paid");
    var head = el("div", "sv-rows");
    addRow(head, { icon: paidOpen ? "minus" : "plus", name: "Paid packs (" + paid.length + ")", sub: "Sold by their makers, mostly on Patreon",
      button: paidOpen ? "Hide" : "Show", run: function () { paidOpen = !paidOpen; L("MNU", "texture packs: paid ones " + (paidOpen ? "shown" : "folded")); paint(pane, g, res); } });
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
    + "A big pack can make a game take longer to start, or stutter; Uninstall puts the game back as it was."));
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

/* A download is asked about first: what comes, how big, from where, and what changes. */
function askGet(g, f, res, pane) {
  L("MNU", "texture pack: asked to install " + (f.name || f.by) + " for " + g.title);
  confirmWindow("Install this texture pack?", function (box) {
    box.appendChild(el("p", "confirm-game", (f.name || "The pack by " + f.by) + (f.size ? ", " + sizeSaid(f.size) : "")));
    box.appendChild(el("p", "confirm-note", "From: " + f.where + ", the pack's own download" + (f.name ? ", made by " + f.by : "")));
    box.appendChild(el("p", "confirm-note", "Into: " + res.folder));
    box.appendChild(el("p", "confirm-safe", res.setWords + " is turned on for " + g.title + " alone. Uninstall takes the pack away and puts that back as it was."));
  }, { label: "Install", run: function () { start(g, { get: f.k }, (f.name || "the pack by " + f.by) + (f.size ? ", " + sizeSaid(f.size) : ""), false, pane); } }, "Not now",
     function () { L("MNU", "texture pack: not installed, " + (f.name || f.by)); });
}

/* Started, or asked first when packs are there: beside them, or in their place. */
function start(g, body, said, how, pane) {
  postJson("api/texpacks.php", Object.assign({ id: g.id }, how ? { how: how } : {}, body)).then(function (r) {
    if (!r.ok) { showStrip("the texture pack was not installed: " + (r.error || "no answer"), true); return; }
    if (r.needs === "choose") { askHow(g, body, said, r, pane); return; }
    L("MNU", "texture pack: installing " + said + " for " + g.title);
    sound("ok");
    showStrip("installing the texture pack in the background: its bar is in the tab and in the corner", false);
    jobsWatch("texpacks");
    if (tabPane("texpacks") === pane) { texPacksPane(pane, g); }
  });
}

/* Beside the packs there (all load; the default, as nothing goes), or in their place; an N64 .hts or .htc is only ever in their place. */
function askHow(g, body, said, r, pane) {
  var packs = r.packs || [], one = packs.length === 1;
  var mine = packs.every(function (p) { return p.mine && p.from; });
  var w = confirmWindow(r.beside ? "Add it beside the " + (one ? "pack" : "packs") + " there?" : "Replace the texture " + (one ? "pack?" : "packs?"), function (box) {
    box.appendChild(el("p", null, g.title + " has " + (one ? "a texture pack" : packs.length + " texture packs") + " installed: "
      + packs.map(function (p) { return (p.mine && p.from ? p.from : "one put there by hand") + ", " + packSaid(p); }).join("; ") + "."));
    box.appendChild(el("p", "confirm-game", "New: " + said));
    if (r.beside) {
      box.appendChild(el("p", "confirm-note", "Add it beside: every pack loads. Where two change the same texture, the emulator shows one of them."));
    } else {
      box.appendChild(el("p", "confirm-note", "The N64 core loads a pack that is one .hts or .htc file alone, so the two cannot sit together."));
    }
    box.appendChild(el("p", "confirm-note", "Replace: the " + (one ? "one" : "ones") + " there " + (one ? "is" : "are") + " deleted once the new one is all in, not put in the Recycle Bin. "
      + (mine ? "Where " + (one ? "it" : "they") + " came from is not touched, so " + (one ? "it" : "they") + " can be installed again." : "Where a pack put there by hand came from is not known.")));
  }, r.beside ? { label: "Add it beside", run: function () { start(g, body, said, "beside", pane); } }
              : { label: "Replace it", run: function () { start(g, body, said, "replace", pane); } },
     r.beside ? "Not now" : one ? "Keep the one there" : "Keep the ones there", function () { L("MNU", "texture pack: kept the ones there for " + g.title + ", none added"); });
  if (r.beside && w.yes) {
    // A third choice, between no and yes, as the keys and the pad reach every button in the window.
    var rep = el("button", null, one ? "Replace it" : "Replace them");
    rep.addEventListener("click", function () { w.close(); start(g, body, said, "replace", pane); });
    w.yes.parentNode.insertBefore(rep, w.yes);
  }
}

function stop() {
  L("MNU", "texture pack: stop pressed in the tab");
  postJson("api/texpacks.php", { stop: true }).then(function (r) {
    if (!r.ok) { showStrip("it could not be stopped: " + (r.error || "no answer"), true); }
  });
}

function askRemove(g, res, p, pane) {
  var last = (res.packs || []).length <= 1;
  confirmWindow("Uninstall this texture pack?", function (box) {
    box.appendChild(el("p", "confirm-game", g.title + ": " + (p.mine && p.from ? p.from : "the pack put there by hand") + ", " + packSaid(p)));
    box.appendChild(el("p", "confirm-note", "From: " + res.folder));
    box.appendChild(el("p", null, "Its files are deleted, not put in the Recycle Bin. "
      + (p.mine && p.from ? "Where it came from is not touched, so it can be installed again." : "Xsegon did not put it there, so where it came from is not known.")));
    if (!last) { box.appendChild(el("p", "confirm-safe", "The other " + ((res.packs.length - 1) === 1 ? "pack stays" : (res.packs.length - 1) + " packs stay") + ", and " + res.setWords + " stays on.")); }
    else if (p.mine) { box.appendChild(el("p", "confirm-safe", res.setWords + " goes back to how it was for this game.")); }
  }, { label: "Uninstall", run: function () { remove(g, p, pane); } }, "Keep it",
     function () { L("MNU", "texture pack: kept for " + g.title + ", " + (p.from || "the one put there by hand")); });
}

function remove(g, p, pane) {
  postJson("api/texpacks.php", { id: g.id, remove: p.id }).then(function (r) {
    if (!r.ok) { showStrip("the texture pack was not uninstalled: " + (r.error || "no answer"), true); return; }
    L("MNU", "texture pack: uninstalling for " + g.title);
    sound("ok");
    showStrip("uninstalling the texture pack in the background: its bar is in the tab and in the corner", false);
    jobsWatch("texpacks");
    if (tabPane("texpacks") === pane) { texPacksPane(pane, g); }
  });
}
