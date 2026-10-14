import { closeEditor, reloadKeeping, setEditorOnClose, toolFrame } from "./editors.js";
import { iconEl } from "./icons.js";
import { setPick, showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { el } from "./util.js";

/* ---------- which emulator a game starts in ----------
   A console's games start in the emulator in use for it. This gives one game
   another of the console's emulators, or changes the one every game of the
   console starts in. It opens for every game and says why when there is
   nothing to choose: an entry that quietly does nothing reads as breakage. */
export function openEmuPicker(g) {
  if (!g || g.local) { return; }
  api("api/emuset.php?id=" + encodeURIComponent(g.id)).then(function (res) {
    if (!res.ok) {
      showStrip("could not read the emulators for " + g.title, true);
      return;
    }
    paint(g, res);
  });
}

function paint(g, res) {
  var emus = res.rows || [];
  L("EMU", "open set emulator " + g.title + " (" + emus.length + " to choose from)");
  setEditorOnClose(null);
  var inner = toolFrame("SET EMULATOR", { base: "cr-inner", close: "Cancel (esc)" });
  inner.appendChild(el("p", "group-help", g.title + "  ·  " + g.platform + ".  Which emulator starts it."));

  if (emus.length < 2) {
    var note = el("p", "cr-none");
    note.appendChild(iconEl("cr-ico", "info"));
    note.appendChild(document.createTextNode(" " + (res.why || "there is nothing to choose here")));
    inner.appendChild(note);
    $editor.appendChild(inner);
    $editor.hidden = false;
    return;
  }

  var usualName = (emus.filter(function (e) { return e.usual; })[0] || {}).name || "its console's emulator";
  var cells = [];
  var entries = [];

  function add(list, r) {
    var line = el("div", "cr-row" + (r.emu && !r.emu.there ? " ro" : ""));
    if (r.reset) {
      line.appendChild(iconEl("cr-ico", "refresh"));
      line.appendChild(el("span", "cr-name", "Use " + usualName + " again"));
      line.appendChild(el("span", "cr-tag", "as the rest of " + g.platform + " does"));
    } else {
      var e = r.emu;
      var mine = res.chosen === e.program;
      // In force: for this game its own choice or else the usual one, for the console the usual one.
      var on = r.scope === "game" ? (res.chosen ? mine : e.usual) : e.usual;
      line.appendChild(iconEl("cr-ico", on ? "check" : "disc"));
      line.appendChild(el("span", "cr-name", e.name));
      // The folder tells two builds of one emulator apart.
      var tags = [e.folder];
      if (!e.there) { tags.push("not on the disk"); }
      if (e.usual) { tags.push("the usual one"); }
      if (r.scope === "game" && mine) { tags.push("chosen for this game"); }
      line.appendChild(el("span", "cr-tag", tags.join("  ·  ")));
      if (on) { line.classList.add("on"); }
    }
    line.addEventListener("click", function () { choose(cells.indexOf(line)); });
    line.addEventListener("mouseenter", function () { focusAt(cells.indexOf(line)); });
    cells.push(line);
    entries.push(r);
    list.appendChild(line);
  }

  inner.appendChild(el("h2", "bk-head", "This game"));
  var one = el("div", "cr-list es-game");
  emus.forEach(function (e) { add(one, { scope: "game", emu: e }); });
  if (res.chosen) { add(one, { scope: "game", reset: true }); }
  inner.appendChild(one);

  inner.appendChild(el("h2", "bk-head", "Every " + g.platform + " game (" + res.games + ")"));
  var all = el("div", "cr-list es-every");
  emus.forEach(function (e) { add(all, { scope: "every", emu: e }); });
  inner.appendChild(all);
  inner.appendChild(el("p", "mt-note", "A game given an emulator of its own keeps it. Emulators > Add an emulator puts another one on this list."));

  $editor.appendChild(inner);
  $editor.hidden = false;

  function focusAt(i) {
    i = Math.max(0, Math.min(cells.length - 1, i));
    cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
    setPick({ cells: cells, at: i, move: function (d) { focusAt(i + d); }, choose: function () { choose(i); } });
    cells[i].scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function choose(i) {
    var r = entries[i];
    if (!r) { return; }
    if (r.emu && !r.emu.there) {
      showStrip(r.emu.name + " is not where the table says: Settings > Emulators points it at its file", true);
      return;
    }
    var body = r.reset ? { id: g.id, clear: true } : { id: g.id, program: r.emu.program };
    if (r.scope === "every") { body.every = true; }
    postJson("api/emuset.php", body).then(function (out) {
      if (!out.ok) {
        showStrip(out.error || "that emulator could not be set", true);
        return;
      }
      sound("ok");
      closeEditor();
      // What can start changes with the emulator, so the games are read again.
      reloadKeeping(g.id);
      if (r.scope === "every") {
        L("EMU", g.platform + " -> " + out.name);
        showStrip(g.platform + " games now start in " + out.name, false);
      } else {
        L("EMU", g.title + " -> " + (out.chosen ? out.name : "the usual emulator"));
        showStrip(out.chosen ? g.title + " will start in " + out.name : g.title + " starts in " + usualName + " again", false);
      }
    });
  }

  // Start on what is in force for this game, so Enter alone changes nothing.
  var start = 0;
  for (var k = 0; k < entries.length; k++) {
    var en = entries[k];
    if (en.scope === "game" && en.emu && (res.chosen ? en.emu.program === res.chosen : en.emu.usual)) { start = k; break; }
  }
  focusAt(start);
}
