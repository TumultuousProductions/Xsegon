import { cheatListsOffer } from "./cheatlists.js";
import { setEditorOnClose, toolFrame } from "./editors.js";
import { iconEl } from "./icons.js";
import { setPick, showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { sound } from "./sound.js";
import { $editor, games } from "./state.js";
import { el } from "./util.js";
import { render, setCarNodes, setWheelNodes } from "./views.js";

/* ---------- cheats ----------
 *
 * Finds the RetroArch cheat file belonging to a game and lets you switch cheats on
 * inside it. At launch (includes\cheats.php) the file is written into Xsegon's own
 * folder and RetroArch is pointed there for that run alone.
 *
 * Most games match more than one file (region, revision, kind) and they are not
 * interchangeable, so the file is a row of its own, best match chosen. One file can
 * hold tens of thousands of cheats, so the list is paged from the server and the find
 * box asks the server too: a checklist that long would take the page down.
 */
export function openCheatPicker(g) {
  if (!g || g.local) { return; }
  api("api/cheats.php?id=" + encodeURIComponent(g.id)).then(function (res) {
    if (!res.ok) {
      showStrip("could not read the cheats for " + g.title, true);
      return;
    }
    cheatsInto(IN_EDITOR, g, res);
  });
}

/* Where the picker stands: the editor panel, with a title and Close, or a
   tab of the game's details (js\cheattab.js), which has neither. A host
   clears itself, takes the screen built for it, is handed the list the keys
   walk, and is told how many cheats are on each time that changes. */
var IN_EDITOR = {
  head: true,
  start: function () { setEditorOnClose(null); $editor.textContent = ""; },
  mount: function (inner) { IN_EDITOR.up = inner; $editor.appendChild(inner); $editor.hidden = false; },
  // A list that comes back after the window was closed is not handed the keys.
  rows: function (v) { if (IN_EDITOR.up && IN_EDITOR.up.isConnected && !$editor.hidden) { setPick(v); } },
  kept: function () { /* the mark on the game behind is all there is to show */ }
};

/* The count on the game itself, which the views draw the mark from. */
function markGame(g, n) {
  g.cheats = n;
  games.forEach(function (x) { if (x.id === g.id) { x.cheats = n; } });
  setWheelNodes(null);
  setCarNodes(null);
  render();
}

export function cheatsInto(host, g, res) {
  if (!res.files || !res.files.length) {
    paintNone(host, g, res);
    return;
  }
  var start = res.chosen
    ? (findFile(res.files, res.chosen.file) || res.files[0])
    : res.files[0];
  openFile(host, g, res, start.file);
}

function findFile(files, want) {
  for (var i = 0; i < files.length; i++) {
    if (files[i].file === want) { return files[i]; }
  }
  return null;
}

function shell(host, title, g, help) {
  host.start();
  if (!host.head) {                      // a tab: the game is named beside it already
    var bare = el("div", "ch-inner ch-tab");
    bare.appendChild(el("p", "group-help", help));
    return bare;
  }
  var inner = toolFrame(title, { base: "ch-inner", close: "Close (esc)", keep: true });
  inner.appendChild(el("p", "group-help", g.title + "  ·  " + g.platform + ".  " + help));
  return inner;
}

/* Nothing to offer: four reasons, each in its own sentence, since one shared
   sentence ends up wrong for some of them. */
function paintNone(host, g, res) {
  L("CHEAT", "open " + g.title + " (nothing" + (res.lists ? ": the cheat lists are not here" : "") + ")");
  var inner = shell(host, "CHEATS", g, res.lists ? "Cheats come from RetroArch's cheat lists, a folder for each console."
    : "Cheats come from RetroArch's own database, which is already on this machine.");
  var note = el("p", "cr-none");
  note.appendChild(iconEl("cr-ico", "info"));
  note.appendChild(document.createTextNode(" " + (res.why || "there are no cheats for this game")));
  inner.appendChild(note);
  // The one reason with a way out: the lists can be fetched, and the game's cheats are drawn when they are in.
  var offer = null;
  if (res.lists) {
    offer = cheatListsOffer(res.lists, function () { return inner.isConnected; }, function () {
      api("api/cheats.php?id=" + encodeURIComponent(g.id)).then(function (now) { if (now.ok && inner.isConnected) { cheatsInto(host, g, now); } });
    });
    var list = el("div", "ch-list");
    list.appendChild(offer.line);
    inner.appendChild(list);
  }
  host.mount(inner);
  host.rows(offer ? { cells: [offer.line], at: 0, move: function () { /* one row */ }, choose: offer.choose } : null);
}

// ---------- which file ----------
function openFileList(host, g, res, current) {
  L("CHEAT", "files " + g.title + " (" + res.files.length + ")");
  var inner = shell(host, "WHICH CHEAT FILE", g,
    "RetroArch has " + res.files.length + " for this game. They differ by region and revision, "
    + "and they are not the same cheats.");

  var list = el("div", "ch-list");
  var cells = [];
  res.files.forEach(function (f) {
    var line = el("div", "cr-row");
    var on = f.file === current;
    line.appendChild(iconEl("cr-ico", on ? "check" : "disc"));
    line.appendChild(el("span", "cr-name", f.name));
    var tags = [f.cheats + (f.cheats === 1 ? " cheat" : " cheats")];
    if (res.chosen && res.chosen.file === f.file) { tags.push(res.chosen.on.length + " on"); }
    if (f.score === 3) { tags.push("named like your ROM"); }
    if (on) { tags.push("open now"); }
    line.appendChild(el("span", "cr-tag", tags.join("  ·  ")));
    if (on) { line.classList.add("on"); }
    line.addEventListener("click", function () { openFile(host, g, res, f.file); });
    line.addEventListener("mouseenter", function () { focusAt(cells.indexOf(line)); });
    cells.push(line);
    list.appendChild(line);
  });
  inner.appendChild(list);
  host.mount(inner);

  function focusAt(i) {
    i = Math.max(0, Math.min(cells.length - 1, i));
    cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
    host.rows({
      cells: cells, at: i,
      move: function (d) { focusAt(i + d); },
      choose: function () { openFile(host, g, res, res.files[i].file); },
    });
    cells[i].scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  var at = 0;
  for (var k = 0; k < res.files.length; k++) {
    if (res.files[k].file === current) { at = k; break; }
  }
  focusAt(at);
}

// ---------- which cheats ----------
/* A press on a cheat is kept there and then: there is no Save, so playing
   straight from here plays with what is marked. */
function openFile(host, g, res, file) {
  // What is selected, as index -> description. Seeded from the saved choice, so
  // reopening shows what is running rather than an empty list.
  var on = {};
  function seed() {
    on = {};
    if (res.chosen && res.chosen.file === file) { res.chosen.on.forEach(function (c) { on[c.i] = c.desc; }); }
  }
  seed();

  var loaded = [];          // the rows fetched so far
  var matching = 0;         // how many the current find matches
  var whole = 0;            // how many are in the file altogether
  var query = "";
  // Cheats active: what was on as the list loaded (listed there alone), and a copy of each turned on since.
  var top = [];
  var alone = {};
  var lifted = [];          // turned off under Cheats active: they head Other cheats

  /* A cheat turned off under Cheats active cannot stay there: it goes to the top of
     Other cheats, listed there once. */
  function lift(c) {
    delete alone[c.i];
    lifted = lifted.filter(function (x) { return x.i !== c.i; });
    lifted.unshift(c);
  }

  var inner = shell(host, "CHEATS", g,
    "Select what you want. Each one is kept as you select it, and applied every time you play until you turn it off.");
  var find = el("div", "set-find ch-find");
  find.appendChild(iconEl("find-ico", "search"));
  var findBox = el("input");
  findBox.type = "text";
  findBox.placeholder = "find a cheat";
  findBox.spellcheck = false;
  find.appendChild(findBox);
  inner.appendChild(find);

  var list = el("div", "ch-list");
  inner.appendChild(list);
  var foot = el("p", "mt-note");
  inner.appendChild(foot);
  host.mount(inner);

  var cells = [];
  var rows = [];
  var at = 0;

  function fileName(f) { var hit = findFile(res.files, f); return hit ? hit.name : f; }

  function paint() {
    list.textContent = "";
    cells = [];
    rows = [];

    if (res.files.length > 1) {
      rows.push({ act: "file" });
    }
    rows.push({ act: "clear" });           // always there, so a press never moves the rows under the bar
    top.forEach(function (c, k) { rows.push({ i: c.i, desc: c.desc, where: "top", head: k === 0 ? "Cheats active" : "" }); });
    var up = {};
    lifted.forEach(function (c) { up[c.i] = true; });
    lifted.concat(loaded.filter(function (c) { return !alone[c.i] && !up[c.i]; })).forEach(function (c, k) {
      rows.push({ i: c.i, desc: c.desc, where: "rest", head: k === 0 && top.length ? "Other cheats" : "" });
    });
    if (loaded.length < matching) { rows.push({ act: "more" }); }

    var n = Object.keys(on).length;
    // A game plays with one cheat file: what is on in another gives way to a press here.
    var other = res.chosen && res.chosen.file !== file ? res.chosen : null;

    rows.forEach(function (r) {
      if (r.head) { list.appendChild(el("div", "ch-head", r.head)); }
      var line = el("div", "cr-row");
      if (r.act === "file") {
        line.classList.add("ch-act");
        line.appendChild(iconEl("cr-ico", "disc"));
        line.appendChild(el("span", "cr-name", "From " + fileName(file)));
        line.appendChild(el("span", "cr-tag", res.files.length - 1 + " other file"
          + (res.files.length === 2 ? "" : "s") + " for this game"));
      } else if (r.act === "clear") {
        line.classList.add("ch-act", "ch-clear");
        if (!n && !other) { line.classList.add("ro"); }
        line.appendChild(iconEl("cr-ico", n || other ? "refresh" : "info"));
        line.appendChild(el("span", "cr-name", n || other ? "Turn cheats off for this game" : "No cheat is on"));
        line.appendChild(el("span", "cr-tag", n ? n + " on"
          : other ? other.on.length + " on, from " + fileName(other.file) + ": a press below replaces them"
          : "a press on one below turns it on"));
      } else if (r.act === "more") {
        line.classList.add("ch-act");
        line.appendChild(iconEl("cr-ico", "chevrons"));
        line.appendChild(el("span", "cr-name", "Show more"));
        line.appendChild(el("span", "cr-tag", (matching - loaded.length) + " still to come"));
      } else {
        var ticked = on[r.i] !== undefined;
        line.appendChild(iconEl("cr-ico", ticked ? "check" : "disc"));
        line.appendChild(el("span", "cr-name", r.desc));
        if (ticked) { line.classList.add("on"); }
      }
      line.addEventListener("click", function () { run(cells.indexOf(line)); });
      line.addEventListener("mouseenter", function () { focusAt(cells.indexOf(line)); });
      cells.push(line);
      list.appendChild(line);
    });

    foot.textContent = (query
      ? matching + " of " + whole + " match “" + query + "”"
      : whole + (whole === 1 ? " cheat in this file" : " cheats in this file"))
      + ".  While cheats are on, settings changed inside RetroArch during that game are not saved,"
      + " which is the price of leaving your own RetroArch settings untouched.";
    focusAt(Math.min(at, cells.length - 1));
  }

  function focusAt(i) {
    i = Math.max(0, Math.min(cells.length - 1, i));
    at = i;
    cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
    host.rows({
      cells: cells, at: i, find: findBox,
      move: function (d) { focusAt(at + d); },
      choose: function () { run(at); },
    });
    if (cells[i]) { cells[i].scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }

  function run(i) {
    var r = rows[i];
    if (!r) { return; }
    if (r.act === "file") { openFileList(host, g, res, file); return; }
    if (r.act === "more") { fetchPage(loaded.length); return; }
    if (r.act === "clear") {
      if (!res.chosen && !Object.keys(on).length) { return; }
      on = {};
      top.slice().reverse().forEach(lift);
      top = [];
    } else if (on[r.i] !== undefined) {
      delete on[r.i];
      // Pressed under Cheats active it leaves for the top of Other cheats; pressed below, it stays put.
      var was = top.filter(function (c) { return c.i === r.i; })[0];
      top = top.filter(function (c) { return c.i !== r.i; });
      if (was && r.where === "top") { lift(was); }
    } else {
      on[r.i] = r.desc;
      // A copy goes under Cheats active at once; the row pressed stays where it is, lit.
      if (!inTop(r.i)) { top.push({ i: r.i, desc: r.desc }); }
    }
    sound("select");
    paintHeld();
    keep();
  }

  function inTop(i) { return top.some(function (c) { return c.i === i; }); }
  function rowOf(test) {
    for (var k = 0; k < rows.length; k++) { if (test(rows[k])) { return k; } }
    return -1;
  }

  /* Redrawn with the bar on the row it was on, standing where it stood: a copy put
     under Cheats active would otherwise push the list down under it. */
  function paintHeld() {
    var r = rows[at];
    var y = cells[at] ? cells[at].getBoundingClientRect().top : 0;
    paint();
    if (!r) { return; }
    var k = rowOf(function (x) { return x.act === r.act && x.where === r.where && x.i === r.i; });
    if (k >= 0) {
      focusAt(k);
      list.scrollTop += cells[k].getBoundingClientRect().top - y;
      return;
    }
    // Gone from where it was, turned off under Cheats active: the bar goes with it.
    k = rowOf(function (x) { return !x.act && x.i === r.i; });
    if (k >= 0) { focusAt(k); }
  }

  /* What is marked goes to the server at every press. Only the newest answer
     is listened to, and a refusal puts back what the server still has. */
  var sent = 0;
  function keep() {
    var mine = ++sent;
    var marked = Object.keys(on).map(function (k) { return { i: Number(k), desc: on[k] }; });
    postJson("api/cheats.php", marked.length ? { id: g.id, file: file, on: marked } : { id: g.id, clear: true }).then(function (out) {
      if (mine !== sent) { return; }
      if (!out.ok) {
        L("CHEAT", g.title + " not kept: " + (out.error || "no answer"));
        showStrip("Not kept: " + (out.error || "the server gave no answer"), true);
        api("api/cheats.php?id=" + encodeURIComponent(g.id)).then(function (now) {
          if (mine !== sent || !now.ok) { return; }
          res.chosen = now.chosen || null;
          seed();
          // Cheats active follows what the server has.
          top.filter(function (c) { return on[c.i] === undefined; }).reverse().forEach(lift);
          top = top.filter(function (c) { return on[c.i] !== undefined; });
          loaded.forEach(function (c) { if (on[c.i] !== undefined && !inTop(c.i)) { top.push(c); } });
          paint();
        });
        return;
      }
      res.chosen = out.chosen || null;
      var left = res.chosen ? res.chosen.on.length : 0;
      L("CHEAT", g.title + " -> " + left + (left ? " from " + file : ""));
      markGame(g, left);
      host.kept(left);
      if (!left) { paint(); }              // the row above says so, whichever file they were in
    });
  }

  function fetchPage(from) {
    api("api/cheats.php?id=" + encodeURIComponent(g.id)
      + "&file=" + encodeURIComponent(file)
      + "&from=" + from
      + (query ? "&q=" + encodeURIComponent(query) : "")).then(function (out) {
      if (!out.ok) {
        showStrip(out.error || "could not read that cheat file", true);
        return;
      }
      matching = out.matching;
      whole = out.whole;
      if (from === 0) { loaded = []; top = []; alone = {}; lifted = []; }
      // The server puts cheats on now and on before first, so a press can move one into the next page.
      var have = {};
      loaded.forEach(function (c) { have[c.i] = true; });
      var fresh = out.cheats.filter(function (c) { return !have[c.i]; });
      fresh.forEach(function (c) {
        if (on[c.i] !== undefined && !inTop(c.i)) { alone[c.i] = true; top.push(c); }
      });
      loaded = loaded.concat(fresh);
      if (from === 0) { at = 0; }
      paint();
    });
  }

  var wait;
  findBox.addEventListener("input", function () {
    clearTimeout(wait);
    wait = setTimeout(function () {
      query = findBox.value.trim();
      fetchPage(0);
    }, 150);
  });

  L("CHEAT", "open " + g.title + " " + file);
  fetchPage(0);
}
