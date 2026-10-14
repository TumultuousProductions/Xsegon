/*  The Cheats tab of a game's details (js\detailtabs.js). A RetroArch game gets the
    cheat picker (js\cheats.js); a standalone emulator whose cheats Xsegon can read
    (PCSX2, includes\emucheats.php) gets its own list, read only since the files are
    that emulator's; any other game gets the sentence saying why there is nothing. */

import { cheatsInto } from "./cheats.js";
import { setFact } from "./details.js";
import { relabelTabs, setTabRows, tabPane, tabSays } from "./detailtabs.js";
import { iconEl } from "./icons.js";
import { L, api } from "./log.js";
import { el } from "./util.js";

export function cheatsTabLabel(g, full) {
  var n = full ? (full.cheats || full.emuCheats || 0) : (g.cheats || 0);
  return n ? "Cheats (" + n + ")" : "Cheats";
}

/* The cheats fact on the left of details: how many are on, or with none on,
   how many there are to choose from. "" when the game has none. */
export function cheatsFact(on, there) {
  if (on) { return on + (on === 1 ? " cheat on" : " cheats on"); }
  return there ? there + (there === 1 ? " cheat to choose from" : " cheats to choose from") : "";
}

export function cheatsPane(pane, g) {
  api("api/cheats.php?id=" + encodeURIComponent(g.id)).then(function (res) {
    if (tabPane("cheats") !== pane) { return; }               // another tab, or another game, by now
    pane.textContent = "";
    if (!res.ok) { pane.appendChild(tabSays("the cheats for this game could not be read")); return; }
    // With files, the picker; with the cheat lists not on this PC, its offer to fetch them.
    if ((res.files && res.files.length) || res.lists) {
      cheatsInto({
        head: false,
        start: function () { pane.textContent = ""; },
        mount: function (inner) { pane.appendChild(inner); },
        rows: function (v) { if (tabPane("cheats") === pane) { setTabRows(pane, v); } },   // not a list that comes back after the tab was left
        // The tab stays as it is: its own count and the fact beside it follow.
        kept: function (n) {
          relabelTabs({ cheats: n });
          setFact("cheats", cheatsFact(n, ((res.files || [])[0] || {}).cheats || 0));
        }
      }, g, res);
      return;
    }
    if (res.emu && !res.emu.why) { emuCheats(pane, g, res.emu); return; }
    pane.appendChild(tabSays((res.emu && res.emu.why) || res.why || "there are no cheats for this game"));
  });
}


/* A standalone emulator's own cheats: the ones that are on first, then the
   rest as its file has them. Nothing here is a switch. */
function emuCheats(pane, g, emu) {
  L("CHEAT", "tab " + g.title + " (" + emu.emulator + ": " + emu.on + " on of " + emu.cheats.length + ")");
  var inner = el("div", "ch-inner ch-tab");
  var lead = emu.enabled
    ? (emu.on ? emu.on + (emu.on === 1 ? " cheat is" : " cheats are") + " on" : "No cheat is on") + " for this game in " + emu.emulator + "."
    : "Cheats are switched off for this game in " + emu.emulator + ".";
  inner.appendChild(el("p", "group-help", lead + " These are " + emu.emulator + "'s own, read from " + emu.file
    + ". Xsegon shows them and does not change them: switch them in " + emu.emulator + ", under this game's Properties > Cheats."));

  var seek = el("div", "set-find ch-find");
  seek.appendChild(iconEl("find-ico", "search"));
  var box = el("input");
  box.type = "text";
  box.placeholder = "find a cheat";
  box.spellcheck = false;
  seek.appendChild(box);
  inner.appendChild(seek);

  var list = el("div", "ch-list");
  inner.appendChild(list);
  var foot = el("p", "mt-note");
  inner.appendChild(foot);
  pane.appendChild(inner);

  var cells = [], at = 0;
  function focusAt(i) {
    i = Math.max(0, Math.min(cells.length - 1, i));
    at = i;
    cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
    setTabRows(pane, {
      cells: cells, at: i, find: box, look: true,       // to look at: nothing in it is a switch
      move: function (d) { focusAt(at + d); },
      choose: function () { /* nothing to choose */ }
    });
    if (cells[i]) { cells[i].scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }
  function paint() {
    var q = box.value.trim().toLowerCase();
    list.textContent = "";
    cells = [];
    emu.cheats.forEach(function (c) {
      if (q && (c.name + " " + c.desc).toLowerCase().indexOf(q) < 0) { return; }
      var line = el("div", "cr-row ro" + (c.on ? " on" : ""));
      line.appendChild(iconEl("cr-ico", c.on ? "check" : "disc"));
      var name = el("span", "cr-name", c.name);
      name.title = c.desc || c.name;                   // a name cut short by the column is read here
      line.appendChild(name);
      line.appendChild(el("span", "cr-tag", [c.on ? "on" : "", c.author, c.copies > 1 ? c.copies + " under this name" : ""].filter(Boolean).join("  ·  ")));
      line.addEventListener("mouseenter", function () { focusAt(cells.indexOf(line)); });
      cells.push(line);
      list.appendChild(line);
    });
    foot.textContent = q
      ? cells.length + " of " + emu.cheats.length + " match “" + box.value.trim() + "”."
      : emu.cheats.length + (emu.cheats.length === 1 ? " cheat" : " cheats") + " in " + emu.file + ".";
    focusAt(Math.min(at, cells.length - 1));
  }
  var wait;
  box.addEventListener("input", function () { clearTimeout(wait); wait = setTimeout(function () { at = 0; paint(); }, 120); });
  paint();
}
