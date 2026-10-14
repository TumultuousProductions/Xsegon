/*  Emulators > Add an emulator: a program of your own for one console or
    several. Choose the program, select its consoles, and their games start
    in it. The common ones are known by name; any other works the same way. */

import { confirmWindow } from "./confirm.js";
import { closeEditor, setEditorOnClose, toolFrame } from "./editors.js";
import { showStrip } from "./launch.js";
import { load } from "./library.js";
import { L, postJson } from "./log.js";
import { openScanTool, pickWindowsFolder } from "./scan.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { el } from "./util.js";

function post(body) {
  return postJson("api/emulators.php", body);
}

function gamesWord(n) { return n === 0 ? "no games yet" : n + (n === 1 ? " game" : " games"); }

function listed(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }

/*  opts.program changes that emulator instead of adding one; opts.after
    runs when the screen closes (Settings opens it and wants to come back). */
export function openEmuAdd(opts) {
  opts = opts || {};
  L("ED", opts.program ? "change emulator " + opts.program : "add emulator");
  stopVideo();
  var st = { key: null, info: null, name: "", args: "", on: {}, already: false };

  function shell(title, close) { return toolFrame(title, { cls: "ea-inner", close: close }); }

  function show(inner) {
    $editor.appendChild(inner);
    $editor.hidden = false;
  }

  function lookAt(body) {
    return post(body).then(function (r) {
      if ($editor.dataset.tool !== "emuadd") { return; }
      if (!r.ok) { sound("back"); showStrip(r.error || "could not read that program", true); return; }
      // The very file is in Xsegon already: this changes that one.
      if (r.same) { st.already = true; return lookAt({ action: "look", program: r.same }); }
      st.info = r;
      st.key = r.key;
      st.name = r.name;
      st.args = r.args;
      st.on = {};
      r.consoles.forEach(function (c) { if (c.on) { st.on[c.name] = true; } });
      if (body.exe) { showStrip(r.retroarch ? "that is RetroArch" : r.known ? "that is " + r.name : "chosen: " + r.file, false); }
      form();
    });
  }

  function choose() {
    pickWindowsFolder("Choose the emulator's program", { kind: "file", start: st.info ? st.info.exe : "" }).then(function (path) {
      if (!path || $editor.dataset.tool !== "emuadd") { return; }
      if (st.key) {
        // One being changed keeps its name, consoles and options: only the file moves.
        st.info.exe = path;
        st.info.file = path.split(/[\\/]/).pop();
        form();
        return;
      }
      lookAt({ action: "look", exe: path });
    });
  }

  function form() {
    var info = st.info, editing = !!st.key;
    var inner = shell(editing ? "CHANGE " + st.name.toUpperCase() : "ADD AN EMULATOR", "Cancel (esc)");
    inner.appendChild(el("p", "group-help", editing
      ? "Where " + st.name + " is, the consoles whose games start in it, and the options it is started with."
      : "An emulator is the program that plays a console's games. Choose its program, select its consoles, and their games start in it."));

    inner.appendChild(el("h2", "bk-head", "1. The program"));
    if (!info) {
      inner.appendChild(el("p", "mt-note",
        "Choose the emulator's own program: the file you would double-click to open it, such as Dolphin.exe or " +
        "pcsx2-qt.exe. Xsegon knows the common ones by name and fills in the rest."));
      var first = el("button", "primary", "Choose the program...");
      first.type = "button";
      first.addEventListener("click", choose);
      var acts0 = el("div", "bk-acts");
      acts0.appendChild(first);
      inner.appendChild(acts0);
      inner.appendChild(el("p", "mt-note", "Then: select its consoles, and see how it starts a game."));
      show(inner);
      return;
    }

    var line = el("div", "ea-exe");
    line.appendChild(el("span", "ea-file", info.exe));
    var again = el("button", null, "Choose another...");
    again.type = "button";
    again.addEventListener("click", choose);
    line.appendChild(again);
    inner.appendChild(line);

    if (info.retroarch) {
      inner.appendChild(el("p", "rp-verdict warn", "This is RetroArch."));
      inner.appendChild(el("p", "mt-note",
        "Xsegon sets RetroArch up by itself, with a core for every console it plays: Help > Getting started, or " +
        "Emulators > Emulator settings to use a RetroArch you already have."));
      show(inner);
      return;
    }

    var says = st.already ? "This program is already in Xsegon as " + info.name + ", so this changes it."
      : editing ? ""
      : info.known ? "This is " + info.name + ". Xsegon knows it, so its consoles and usual options are filled in below."
      : "Xsegon does not know " + info.file + " by name. That is fine: give it a name and select its consoles below.";
    if (says) { inner.appendChild(el("p", "ea-says" + (info.known ? " ok" : ""), says)); }

    // A second copy of one already here is most often a newer version of it.
    if (info.alike && !editing) {
      var alike = el("div", "ea-alike");
      alike.appendChild(el("span", null, "You already have " + info.alike.name + ", at " + info.alike.exe +
        ". If this is a newer copy of it, use this file for it. Carry on below to keep both."));
      var swap = el("button", null, "Use this file for " + info.alike.name);
      swap.type = "button";
      swap.addEventListener("click", function () {
        swap.disabled = true;
        post({ program: info.alike.key, exe: info.exe }).then(function (r) {
          if (!r.ok) { swap.disabled = false; sound("back"); showStrip(r.error || "could not use that file", true); return; }
          L("EMU", info.alike.key + " -> " + r.exe);
          sound("ok");
          showStrip(info.alike.name + " now runs from " + r.exe, false);
          lookAt({ action: "look", program: info.alike.key });
        });
      });
      alike.appendChild(swap);
      inner.appendChild(alike);
    }

    var nameRow = el("label", "ea-name");
    nameRow.appendChild(el("span", null, "Name"));
    var name = el("input");
    name.type = "text";
    name.maxLength = 60;
    name.spellcheck = false;
    name.value = st.name;
    nameRow.appendChild(name);
    inner.appendChild(nameRow);

    inner.appendChild(el("h2", "bk-head", "2. The consoles it plays"));
    inner.appendChild(el("p", "mt-note", "Select every console whose games should start in it. The ones with games here are near the top."));
    var find = el("input");
    find.type = "text";
    find.className = "ea-find";
    find.placeholder = "find a console";
    find.spellcheck = false;
    inner.appendChild(find);
    var list = el("div", "sc-rows ea-consoles");
    var lines = [];
    info.consoles.forEach(function (c) {
      var one = el("label", "sc-row");
      var box = el("input");
      box.type = "checkbox";
      box.checked = !!st.on[c.name];
      one.appendChild(box);
      one.appendChild(el("b", null, c.name));
      one.appendChild(el("span", "sc-tag", gamesWord(c.games)));
      var tag = el("span", "sc-tag ea-now");
      one.appendChild(tag);
      box.addEventListener("change", function () {
        if (box.checked) { st.on[c.name] = true; } else { delete st.on[c.name]; }
        update();
      });
      lines.push({ c: c, node: one, tag: tag, box: box });
      list.appendChild(one);
    });
    inner.appendChild(list);
    find.addEventListener("input", function () {
      var q = find.value.trim().toLowerCase();
      lines.forEach(function (l) { l.node.hidden = q !== "" && l.c.name.toLowerCase().indexOf(q) < 0; });
    });

    inner.appendChild(el("h2", "bk-head", "3. How it starts a game"));
    var cmd = el("div", "ea-cmd");
    cmd.appendChild(el("span", "ea-file", info.file));
    var args = el("input");
    args.type = "text";
    args.className = "ea-args";
    args.spellcheck = false;
    args.maxLength = 400;
    args.placeholder = "nothing needed";
    args.value = st.args;
    cmd.appendChild(args);
    cmd.appendChild(el("span", "ea-file", "\"the game's file\""));
    inner.appendChild(cmd);
    inner.appendChild(el("p", "mt-note", info.known
      ? "These are the usual options for " + info.name + ". Another version of it may want different ones, so they stay yours to change: here, at any time."
      : "Most emulators need nothing here: they open the game's file when it is handed to them. If its games do not start, " +
        "the emulator's own help lists its command line options, and the ones that go before the game's file go in this box."));

    var acts = el("div", "bk-acts ea-acts");
    var go = el("button", "primary", "");
    go.type = "button";
    go.addEventListener("click", function () { go.disabled = true; save(function () { go.disabled = false; }); });
    acts.appendChild(go);
    if (editing) {
      var drop = el("button", null, "Remove " + st.name + "...");
      drop.type = "button";
      drop.addEventListener("click", remove);
      acts.appendChild(drop);
    }
    inner.appendChild(acts);
    var why = el("p", "mt-note ea-why");
    inner.appendChild(why);

    function update() {
      var n = Object.keys(st.on).length, called = st.name.trim() || info.name;
      go.textContent = (editing ? "Save " : "Add ") + called;
      go.disabled = n === 0;
      why.textContent = n === 0 ? "Select at least one console for it to play." : "";
      lines.forEach(function (l) {
        var c = l.c, on = l.box.checked;
        l.tag.classList.toggle("warn", !on && !c.now && !c.mine && c.games > 0);
        l.tag.textContent = on ? (c.mine ? "starts in " + called
                                         : "will start in " + called + (c.now ? " instead of " + c.now : ""))
          : c.mine ? "will no longer start in " + called
          : c.now ? "starts in " + c.now
          : c.games ? "nothing starts these yet" : "";
      });
    }
    name.addEventListener("input", function () { st.name = name.value; update(); });
    args.addEventListener("input", function () { st.args = args.value; });
    update();
    show(inner);
  }

  function save(failed) {
    var body = { action: st.key ? "change" : "add", program: st.key || "", exe: st.info.exe,
                 name: st.name, args: st.args, consoles: Object.keys(st.on) };
    post(body).then(function (r) {
      if ($editor.dataset.tool !== "emuadd") { return; }
      if (!r.ok) { failed(); sound("back"); showStrip(r.error || "that could not be saved", true); return; }
      L("EMU", (r.new ? "added " : "changed ") + r.name + " for " + r.rows.map(function (c) { return c.name; }).join(", "));
      sound("ok");
      load();
      finished(r);
    });
  }

  function remove() {
    var mine = st.info.consoles.filter(function (c) { return c.mine; }).map(function (c) { return c.name; });
    confirmWindow("Remove " + st.name + "?", function (box) {
      box.appendChild(el("p", null, mine.length
        ? listed(mine) + (mine.length === 1 ? " goes" : " go") + " back to what started " + (mine.length === 1 ? "it" : "them") +
          " before, or to nothing when this was the only one."
        : "No console's games start in it now."));
      box.appendChild(el("p", "mt-note", "Only Xsegon forgets it: the program and its files stay on your disk."));
    }, { label: "Remove", run: function () {
      post({ action: "remove", program: st.key }).then(function (r) {
        if (!r.ok) { sound("back"); showStrip(r.error || "it could not be removed", true); return; }
        L("EMU", "removed " + r.name);
        sound("ok");
        load();
        showStrip(r.name + " removed" + (r.bare.length ? ": " + listed(r.bare) + " now " + (r.bare.length === 1 ? "has" : "have") + " no emulator" : ""), false);
        closeEditor();
      });
    } }, "Keep it");
  }

  /* What was done, and the next thing to do for each console. */
  function finished(r) {
    var inner = shell(r.name.toUpperCase() + (r.new ? " IS ADDED" : " IS SAVED"), "Done (esc)");
    var ready = r.rows.filter(function (c) { return c.games > 0; }).length;
    inner.appendChild(el("p", "rp-verdict good", ready
      ? "Press Play on one of its games to try it."
      : r.name + " is ready for its games."));
    var rows = el("div", "rp-checks");
    var toScan = false;
    r.rows.forEach(function (c) {
      var one = el("div", "rp-check " + (c.games ? "ok" : "info"));
      one.appendChild(el("span", "rp-state", c.games ? "READY" : "NO GAMES"));
      var t = el("div", "rp-text");
      t.appendChild(el("span", "rp-label", c.name + (c.games ? "  ·  " + gamesWord(c.games) : "")));
      if (!c.games && c.folder) { toScan = true; }
      t.appendChild(el("span", "rp-says", c.games
        ? (c.games === 1 ? "it starts" : "they start") + " in " + r.name + " now" + (c.took ? ", instead of " + c.took : "") + "."
        : c.folder ? "Put its games in a folder named " + c.folder + ", inside a folder Xsegon looks in, then choose Scan for Games."
        : "Scan for Games does not find this console's games yet."));
      one.appendChild(t);
      rows.appendChild(one);
    });
    inner.appendChild(rows);
    if (r.left.length) {
      inner.appendChild(el("p", "mt-note", listed(r.left) + (r.left.length === 1 ? " no longer starts" : " no longer start") +
        " in it, and " + (r.left.length === 1 ? "is" : "are") + " back with what started " + (r.left.length === 1 ? "it" : "them") + " before."));
    }
    inner.appendChild(el("p", "mt-note",
      "If a game does not start, the options are the first thing to look at: Emulators > Emulator settings, then Change... beside " + r.name + "."));
    var acts = el("div", "bk-acts ea-acts");
    if (toScan) {
      var scan = el("button", null, "Scan for Games...");
      scan.type = "button";
      scan.addEventListener("click", function () { setEditorOnClose(null); delete $editor.dataset.tool; openScanTool(); });
      acts.appendChild(scan);
    }
    var more = el("button", null, "Add another emulator");
    more.type = "button";
    more.addEventListener("click", function () { st = { key: null, info: null, name: "", args: "", on: {}, already: false }; form(); });
    acts.appendChild(more);
    inner.appendChild(acts);
    show(inner);
  }

  $editor.dataset.tool = "emuadd";
  setEditorOnClose(function () { delete $editor.dataset.tool; if (opts.after) { opts.after(); } });
  if (opts.program) {
    lookAt({ action: "look", program: opts.program }).then(function () { sound("select"); });
  } else {
    form();
    sound("select");
  }
}
