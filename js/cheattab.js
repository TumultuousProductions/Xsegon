/*  The Cheats tab of a game's details (js\detailtabs.js). A RetroArch game gets the
    cheat picker (js\cheats.js); a standalone emulator whose cheats Xsegon can read
    (includes\emucheats.php) gets its own list: Dolphin's and PCSX2's patches and
    codes, switched in the game's own settings file; any other game gets the
    sentence saying why there is nothing. */

import { cheatsInto } from "./cheats.js";
import { setFact } from "./details.js";
import { relabelTabs, setTabRows, tabGameId, tabPane, tabSays } from "./detailtabs.js";
import { iconEl } from "./icons.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { sound } from "./sound.js";
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


/* How many are on, and with the game's cheats off in the emulator, what a press on one does. */
function emuLead(emu) {
  var s = (emu.on ? emu.on + " on" : "None on") + " for this game in " + emu.emulator + ".";
  if (!emu.enabled) { s += " Cheats are switched off for it there: switching one on here switches them on for this game alone."; }
  return s + (emu.switch
    ? " " + emu.emulator + "'s own patches (widescreen, frame rate, fixes) and cheat codes, the ones it ships and any of yours. A press switches one on or off, kept in this game's own settings file, " + emu.file + ", as " + emu.emulator + "'s Properties window does."
    : " These are " + emu.emulator + "'s own, read from " + emu.file + ". Xsegon shows them and does not change them: switch them in " + emu.emulator + ", under this game's Properties > Cheats.");
}

// "2 patches and 5 cheats": patches are the "patch" kind, the rest are codes.
function emuCount(list) {
  var p = list.filter(function (c) { return c.kind === "patch"; }).length, k = list.length - p;
  return [p ? p + (p === 1 ? " patch" : " patches") : "", k ? k + (k === 1 ? " cheat" : " cheats") : ""].filter(Boolean).join(" and ");
}

/* A standalone emulator's own patches and cheats: patches first, the ones on at
   the top of each. One whose file in includes\emus\ switches them (emu.switch)
   takes a press on a row, kept at once in the game's own settings file, the
   list drawn again from the answer with the bar still on that row. */
function emuCheats(pane, g, emu) {
  L("CHEAT", "tab " + g.title + " (" + emu.emulator + ": " + emu.on + " on of " + emu.cheats.length + ")");
  var inner = el("div", "ch-inner ch-tab");
  inner.appendChild(el("p", "group-help", emuLead(emu)));

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
    setTabRows(pane, emu.switch ? {
      cells: cells, at: i, find: box, word: "switch it",
      move: function (d) { focusAt(at + d); },
      choose: function () { flip(at); }
    } : {
      cells: cells, at: i, find: box, look: true,       // to look at: nothing in it is a switch
      move: function (d) { focusAt(at + d); },
      choose: function () { /* nothing to choose */ }
    });
    if (cells[i]) { cells[i].scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }
  var shown = [], switching = false;
  // A press on a row: kept at once, and the list drawn again from what the server then reads.
  function flip(i) {
    var c = shown[i];
    if (!c) { return; }
    if (switching) { L("CHEAT", c.name + " pressed while another is being switched: let go"); return; }
    switching = true;
    sound("select");
    L("CHEAT", "switch " + c.name + " (" + c.section + ") " + (c.on ? "off" : "on") + " for " + g.title);
    var cheatsWere = emu.enabled;
    postJson("api/cheats.php", { id: g.id, emuCode: { section: c.section, key: c.key, on: !c.on } }).then(function (res) {
      switching = false;
      if (!res.ok || !res.emu) { showStrip(c.name + " was not switched: " + (res.error || "no answer"), true); return; }
      var now = res.emu;
      L("CHEAT", c.name + " switched: " + now.on + " on of " + now.cheats.length);
      // The count is the emulator's own for either label (cheatsTabLabel, details.js), so 0 reads as 0.
      relabelTabs({ cheats: now.on, emuCheats: now.on }, g.id);
      if (tabGameId() === g.id) { setFact("cheats", cheatsFact(now.on, now.cheats.length)); }
      // Cheats turned on for the game bring back any its file already named.
      var more = now.cheats.filter(function (x) { return x.kind !== "patch" && x.on; }).length - 1;
      if (!cheatsWere && now.enabled && !c.on && c.kind !== "patch" && more > 0) {
        showStrip("With cheats on for this game, " + more + (more === 1 ? " more it already listed is" : " more it already listed are") + " on as well: switch any off here", false);
      }
      if (!list.isConnected) { return; }             // another tab or game by now: the tab reads afresh when it opens again
      emu = now;
      lead0.textContent = emuLead(emu);
      paint(c);
    });
  }
  var lead0 = inner.firstChild;
  // keep: the row the bar stays on, wherever the new order puts it.
  function paint(keep) {
    if (!list.isConnected) { return; }               // the find box's wait ending after the tab was left
    var q = box.value.trim().toLowerCase();
    list.textContent = "";
    cells = [];
    shown = [];
    emu.cheats.forEach(function (c) {
      if (q && (c.name + " " + c.desc).toLowerCase().indexOf(q) < 0) { return; }
      var line = el("div", "cr-row" + (emu.switch ? "" : " ro") + (c.on ? " on" : ""));
      line.appendChild(iconEl("cr-ico", c.on ? "check" : "disc"));
      var name = el("span", "cr-name", c.name);
      name.title = c.desc || c.name;                   // a name cut short by the column is read here
      line.appendChild(name);
      line.appendChild(el("span", "cr-tag", [c.on ? "on" : "", c.kind || "", c.author, c.copies > 1 ? c.copies + " under this name" : ""].filter(Boolean).join("  ·  ")));
      line.addEventListener("mouseenter", function () { focusAt(cells.indexOf(line)); });
      if (emu.switch) { line.addEventListener("click", function () { flip(cells.indexOf(line)); }); }
      cells.push(line);
      shown.push(c);
      list.appendChild(line);
    });
    foot.textContent = q
      ? cells.length + " of " + emu.cheats.length + " match “" + box.value.trim() + "”."
      : emuCount(emu.cheats) + " for this game.";
    if (keep) {
      var k = shown.findIndex(function (c) { return c.section === keep.section && c.key === keep.key; });
      if (k >= 0) { at = k; }
    }
    focusAt(Math.min(at, cells.length - 1));
  }
  var wait;
  box.addEventListener("input", function () { clearTimeout(wait); wait = setTimeout(function () { at = 0; paint(); }, 120); });
  paint();
}
