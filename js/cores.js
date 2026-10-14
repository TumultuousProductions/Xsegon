import { closeEditor, setEditorOnClose, toolFrame } from "./editors.js";
import { iconEl } from "./icons.js";
import { setPick, showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { sound } from "./sound.js";
import { $editor, hasLaunchBox } from "./state.js";
import { el } from "./util.js";

/* ---------- which core a game runs on ----------
 *
 * A game names an emulator, and the pair (emulator, platform) names the core, so
 * the choices are read per platform: the cores set up for that console, not every
 * core in the folder, since a core is console-specific.
 *
 * With nothing to choose the dialog still opens and says why: an entry that
 * quietly does nothing reads as breakage.
 */
export function openCorePicker(g) {
  if (!g || g.local) { return; }
  api("api/cores.php?id=" + encodeURIComponent(g.id)).then(function (res) {
    if (!res.ok) {
      showStrip("could not read the cores for " + g.title, true);
      return;
    }
    paint(g, res);
  });
}

function paint(g, res) {
  var cores = res.cores || [];
  L("CORE", "open " + g.title + " (" + cores.length + " to choose from)");
  setEditorOnClose(null);
  var inner = toolFrame("SET CORE", { base: "cr-inner", close: "Cancel (esc)" });

  inner.appendChild(el("p", "group-help", g.title + "  ·  " + g.platform +
    ".  Which RetroArch core runs it. Your choice is Xsegon's own" + (hasLaunchBox ? " and is never written into the imported library." : ".")));

  // Nothing to choose: say which of the two reasons it is, and stop.
  if (cores.length < 2) {
    var note = el("p", "cr-none");
    note.appendChild(iconEl("cr-ico", "info"));
    note.appendChild(document.createTextNode(" " + (res.why || "there is nothing to choose here")));
    inner.appendChild(note);
    if (hasLaunchBox) {
      inner.appendChild(el("p", "mt-note", "Cores are set up per console in the library you brought in. Add another one for " +
        g.platform + " there and it will be offered here."));
    }
    $editor.appendChild(inner);
    $editor.hidden = false;
    return;
  }

  var list = el("div", "cr-list");
  var cells = [];
  var rows = cores.map(function (c) { return { core: c.core, emulator: c.emulator, isDefault: c.default }; });
  // "Use the usual core again" is only an answer when there is something to
  // undo, so it is added only while a choice is in force.
  if (res.chosen) { rows.push({ reset: true }); }

  // Named "line", not "row": views.js exports a row(), and a local called row
  // here makes the import checker add an import for it.
  rows.forEach(function (r) {
    var line = el("div", "cr-row");
    if (r.reset) {
      line.appendChild(iconEl("cr-ico", "refresh"));
      line.appendChild(el("span", "cr-name", hasLaunchBox ? "Use the imported core again" : "Use the usual core again"));
    } else {
      var chosen = res.chosen === r.core;
      line.appendChild(iconEl("cr-ico", chosen ? "check" : "disc"));
      line.appendChild(el("span", "cr-name", r.core));
      var tags = [];
      if (r.isDefault) { tags.push(hasLaunchBox ? "the imported choice" : "the usual one"); }
      if (chosen) { tags.push("running now"); }
      // The emulator title is worth showing but never on its own: every
      // default here is an entry called plainly "RetroArch" while loading a
      // different core on every console, so the title alone says nothing.
      line.appendChild(el("span", "cr-tag", tags.length ? tags.join("  ·  ") : r.emulator));
      if (chosen) { line.classList.add("on"); }
    }
    line.addEventListener("click", function () { choose(cells.indexOf(line)); });
    line.addEventListener("mouseenter", function () { focusAt(cells.indexOf(line)); });
    cells.push(line);
    list.appendChild(line);
  });
  inner.appendChild(list);

  if (!res.chosen) {
    inner.appendChild(el("p", "mt-note", "Nothing is chosen, so " + g.title + " runs on " + (hasLaunchBox ? "the core it was imported with." : "its console's usual core.")));
  }
  $editor.appendChild(inner);
  $editor.hidden = false;

  function focusAt(i) {
    i = Math.max(0, Math.min(cells.length - 1, i));
    cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
    focusAt.at = i;
    setPick({ cells: cells, at: i, move: function (d) { focusAt(i + d); }, choose: function () { choose(i); } });
    cells[i].scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function choose(i) {
    var r = rows[i];
    if (!r) { return; }
    var body = r.reset ? { id: g.id, clear: true } : { id: g.id, core: r.core };
    postJson("api/cores.php", body).then(function (out) {
      if (!out.ok) {
        showStrip(out.error || "that core could not be set", true);
        return;
      }
      L("CORE", g.title + " -> " + (out.chosen || "the usual core"));
      sound("ok");
      closeEditor();
      showStrip(out.chosen
        ? g.title + " will run on " + out.chosen
        : g.title + " is back on " + (hasLaunchBox ? "its imported core" : "its usual core"), false);
    });
  }

  // Start on what is in force, so Enter alone changes nothing.
  var start = 0;
  for (var i = 0; i < rows.length; i++) {
    if ((res.chosen && rows[i].core === res.chosen) || (!res.chosen && rows[i].isDefault)) { start = i; break; }
  }
  focusAt(start);
}
