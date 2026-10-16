import { setEditorOnClose, toolFrame } from "./editors.js";
import { iconEl } from "./icons.js";
import { showStrip } from "./launch.js";
import { L, api } from "./log.js";
import { openRetroArch } from "./rahotkeys.js";
import { raButton } from "./raoffer.js";
import { $editor } from "./state.js";
import { el } from "./util.js";

/* ---------- what the emulator will listen to ----------
 *
 * Read only: the rows come from the emulator's own files (api\controls.php reads
 * them as a guest), so this panel can report a binding but never break one.
 * Bindings are per core and console; a RetroArch remap for one game or core gets
 * its own block. For a RetroArch game the hotkeys that leave and pause come first,
 * each with RetroArch's own name for it so it can be found in RetroArch's screen.
 */
export function openControls(g) {
  if (!g || g.local) { return; }
  api("api/controls.php?id=" + encodeURIComponent(g.id)).then(function (res) {
    if (!res.ok) {
      showStrip("could not read the controls for " + g.title, true);
      return;
    }
    paint(g, res);
  });
}

function head(inner, words) { inner.appendChild(el("h2", "ctl-head", words)); }

function pairRow(inner, name, value) {
  var line = el("div", "opt ed-row");
  var l = el("label");
  l.appendChild(document.createTextNode(name));
  line.appendChild(l);
  line.appendChild(el("span", "ctl-val", value));
  inner.appendChild(line);
  return line;
}

/* One hotkey: our words for it, what is bound, and under that the name
   RetroArch gives it (and the override file, when the value came from one). */
function hotkeyRow(inner, h) {
  var line = pairRow(inner, h.name, h.value);
  line.classList.add("ctl-hot");
  line.dataset.hotkey = h.id;
  if (!h.set) { line.classList.add("ctl-unset"); }
  var sub = "In RetroArch: " + h.ra + (h.page ? ", on " + h.page : "") +
    (h.from ? ". Set by " + h.from : "") + (h.note ? ". " + h.note : "");
  line.lastChild.appendChild(el("span", "ctl-sub", sub));
  // A choice of yours rides along when Xsegon starts the game.
  if (h.yours) {
    line.lastChild.appendChild(el("span", "ctl-sub ctl-yours",
      "Yours: " + h.yours + " when Xsegon starts the game (Settings > RetroArch + Emulator Controls)."));
  }
}

function paint(g, res) {
  var hot = res.hotkeys || null;
  L("CTRL", "open " + g.title + " via " + (res.via || "?") + " (" + (res.rows || []).length + " rows" +
    (hot ? ", " + (hot.leave.length + hot.other.length) + " hotkeys" : "") + ")");
  setEditorOnClose(null);
  var inner = toolFrame("CONTROLS", { base: "cr-inner", close: "Close (esc)" });

  inner.appendChild(el("p", "group-help", g.title + "  ·  " + g.platform + ", through " + (res.via || "its emulator")
    + ". Read from the emulator's own files and never written: changing these stays its own settings screen."));

  if (hot) {
    head(inner, "Leaving and pausing a game");
    hot.leave.forEach(function (h) { hotkeyRow(inner, h); });
    head(inner, g.platform + ": the buttons");
  }

  var rows = res.rows || [];
  if (!rows.length) {
    // "No rows" is an answer only when it says WHY there are none.
    var note = el("p", "cr-none");
    note.appendChild(iconEl("cr-ico", "info"));
    note.appendChild(document.createTextNode(" " + ((res.source && res.source.note) || "nothing readable here")));
    inner.appendChild(note);
    // No emulator yet, on a console RetroArch plays: the press that gets it (js\raoffer.js).
    var ra = raButton(res.raOffer, "Controls");
    if (ra) { var raBar = el("div", "bar"); raBar.appendChild(ra); inner.appendChild(raBar); }
  } else {
    rows.forEach(function (r) { pairRow(inner, r.name, r.value); });
  }

  if (res.remap && res.remap.changes && res.remap.changes.length) {
    inner.appendChild(el("p", "group-help", "A remap you made in RetroArch changes " +
      (res.remap.changes.length === 1 ? "one button" : res.remap.changes.length + " buttons") + " here:"));
    res.remap.changes.forEach(function (c) { pairRow(inner, c.from, "acts as " + c.to); });
  }

  // The game's own buttons set in Xsegon (details > Buttons).
  if (res.gameMap && res.gameMap.standard) {
    inner.appendChild(el("p", "group-help ctl-game", "This game's own buttons, set in Xsegon (details > Buttons): " +
      "the standard layout, whatever its console's are, when Xsegon starts it" +
      (res.gameMap.over ? ", in place of the remap above" : "") + "."));
  } else if (res.gameMap && res.gameMap.changes && res.gameMap.changes.length) {
    inner.appendChild(el("p", "group-help ctl-game", "This game's own buttons, set in Xsegon (details > Buttons), change " +
      (res.gameMap.changes.length === 1 ? "one button" : res.gameMap.changes.length + " buttons") + " when Xsegon starts it" +
      (res.gameMap.over ? ", in place of the remap above" : "") + ":"));
    res.gameMap.changes.forEach(function (c) { pairRow(inner, c.from, "acts as " + c.to); });
  }

  if (hot) {
    head(inner, "Turbo fire");
    (hot.turbo || []).forEach(function (h) { hotkeyRow(inner, h); });
    head(inner, "RetroArch's other hotkeys");
    hot.other.forEach(function (h) { hotkeyRow(inner, h); });
    var foot = el("p", "mt-note ctl-where");
    foot.appendChild(document.createTextNode(
      "The hotkeys are the same for every console. " +
      (hot.unset ? hot.unset + " more " + (hot.unset === 1 ? "is" : "are") + " not set. " : "") +
      "To change one, open RetroArch and go to " + hot.where + ". "));
    var open = el("button", "ctl-open", "Open RetroArch");
    open.addEventListener("click", function () { openRetroArch("hotkeys"); });
    foot.appendChild(open);
    inner.appendChild(foot);
  }

  if (res.source && res.source.file) {
    inner.appendChild(el("p", "mt-note", "Read from " + res.source.file
      + (res.source.note && rows.length ? ". " + res.source.note : "")));
  }

  $editor.appendChild(inner);
  $editor.hidden = false;
}
