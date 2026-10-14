/*  The Versions tab of a game's details (js\detailtabs.js), only for a card
    holding several versions (api\library.php). A press selects one, kept at
    the press (api\select-version.php), and Play starts it without asking; a
    press on the selected one deselects it. Built from the row alone, so it
    never waits for the full record. */

import { setFact } from "./details.js";
import { setTabRows, tabPane } from "./detailtabs.js";
import { iconEl } from "./icons.js";
import { showStrip } from "./launch.js";
import { L, postJson } from "./log.js";
import { sound } from "./sound.js";
import { el, versionLabel, versionsFact } from "./util.js";

export function versionsTabLabel(g) {
  return "Versions (" + (g.versions || []).length + ")";
}

export function versionsPane(pane, g) {
  var inner = el("div", "ch-inner ch-tab");
  inner.appendChild(el("p", "group-help", "The " + g.versions.length + " files this card stands for."
    + " Press one to select it: Play then starts it without asking."
    + " Pressing the selected one deselects it, and Play asks which one again."));
  var list = el("div", "ch-list");
  inner.appendChild(list);
  var foot = el("p", "mt-note");
  inner.appendChild(foot);
  pane.appendChild(inner);

  var cells = [], at = 0, saving = false;

  function playedWords(v) {
    return v.lastPlayed ? "played " + v.lastPlayed.slice(0, 10)
         : v.plays ? "played before" : "never played";   // imported counts carry no date
  }

  function focusAt(i) {
    i = Math.max(0, Math.min(cells.length - 1, i));
    at = i;
    cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
    var v = g.versions[i];
    setTabRows(pane, {
      cells: cells, at: i, look: !v.playable,
      word: g.chosen === v.id ? "deselect" : "select",
      move: function (d) { focusAt(at + d); },
      choose: function () { choose(at); }
    });
    if (cells[i]) { cells[i].scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }

  function choose(i) {
    var v = g.versions[i];
    if (!v || !v.playable || saving) { return; }
    var off = g.chosen === v.id;
    saving = true;
    postJson("api/select-version.php", { id: v.id, selected: !off }).then(function (r) {
      saving = false;
      if (!r.ok) { sound("back"); showStrip("Selection not kept: " + (r.error || "the server said no"), true); return; }
      g.chosen = off ? null : v.id;
      L("VERS", g.title + ": " + versionLabel(v) + (off ? " deselected, Play asks again" : " selected"));
      sound("select");
      setFact("versions", versionsFact(g));
      if (tabPane("versions") === pane) { paint(); }
    });
  }

  function paint() {
    list.textContent = "";
    cells = [];
    g.versions.forEach(function (v, i) {
      var on = g.chosen === v.id;
      var line = el("div", "cr-row sv-row" + (on ? " on" : "") + (v.playable ? "" : " ro"));
      line.appendChild(iconEl("cr-ico", on ? "check" : v.playable ? "disc" : "info"));
      var words = el("div", "sv-words");
      words.appendChild(el("span", "cr-name", versionLabel(v)));
      // The file itself, when the name above is only the words that tell it apart.
      if (v.file && v.file !== versionLabel(v)) { words.appendChild(el("span", "sv-sub", v.file)); }
      line.appendChild(words);
      line.appendChild(el("span", "cr-tag",
        [on ? "selected" : "", v.playable ? playedWords(v) : "cannot start"].filter(Boolean).join("  ·  ")));
      if (!v.playable) { line.title = "Cannot start: " + (v.why || "it has no launch command"); }
      line.addEventListener("mouseenter", function () { focusAt(i); });
      line.addEventListener("click", function () { choose(i); });
      cells.push(line);
      list.appendChild(line);
    });
    foot.textContent = g.chosen
      ? "Play starts the selected one. Each version keeps saves and plays of its own."
      : "Nothing is selected, so Play asks which one each time.";
    focusAt(Math.min(at, cells.length - 1));
  }
  paint();
  // Details is built before it is on the screen, and setTabRows ignores a
  // pane that is not on it: the list is handed over again a moment later.
  Promise.resolve().then(function () { if (tabPane("versions") === pane) { focusAt(at); } });
}
