/*  The Graphic packs tab of a Wii U game's details (js\detailtabs.js, roadmap CA18): the
    community's packs Cemu has for this game (resolution, frame rate, fixes, mods,
    cheats) and which are on, read from Cemu's own files (api\emupacks.php). They are
    switched in Cemu, whose one settings file holds every game's (the user's word,
    CA17), so the tab says where and opens Cemu. A pack of the person's own that sits
    where Cemu's next download of the packs deletes it is said so. */

import { setTabRows, tabPane } from "./detailtabs.js";
import { iconEl } from "./icons.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { sound } from "./sound.js";
import { el } from "./util.js";

// By the console, as texture packs are: the table's name for the emulator is the person's to choose. The server tells Cemu by its program.
export function emuPacksFor(g) { return !!(g && g.emu && !g.local && !g.steam && /wii u/i.test(String(g.platform || ""))); }
export function emuPacksTabLabel() { return "Graphic packs"; }

var OPEN_HOLD_MS = 10000;      // Cemu takes a few seconds to show: a press in that time does not start a second one
var openedAt = 0;

export function emuPacksPane(pane, g) { readPacks(pane, g, 0, false); }

// at and back: the row the bar was on, and that Cemu was opened from here, when the tab is read again.
function readPacks(pane, g, at, back) {
  // Cemu's packs are a few hundred small files, read afresh each time: a couple of seconds the first time.
  pane.appendChild(el("p", "dtab-wait", "Reading Cemu's graphic packs for " + g.title + "…"));
  api("api/emupacks.php?id=" + encodeURIComponent(g.id)).then(function (res) {
    if (tabPane("graphicpacks") !== pane) { return; }          // another tab, or another game, by now
    pane.textContent = "";
    var inner = el("div", "ch-inner ch-tab gp-tab");
    pane.appendChild(inner);
    var opening = false;
    function openCemu() {
      if (opening) { return; }
      sound("select");
      if (Date.now() - openedAt < OPEN_HOLD_MS) { L("PACK", "Open Cemu again within " + OPEN_HOLD_MS / 1000 + " s: not sent"); showStrip("Cemu is opening: Options > Graphic packs"); return; }
      opening = true;
      L("PACK", "open Cemu for " + g.title);
      postJson("api/emuopen.php", { id: g.id }).then(function (r) {
        opening = false;
        if (r.ok) { openedAt = Date.now(); backFromCemu(); }
        showStrip(r.ok ? "Cemu is opening: Options > Graphic packs" : (r.error || "could not open Cemu"), !r.ok);
      });
    }
    // Packs switched in Cemu: once it is opened from here, the tab reads them again each time Xsegon is in front, while it is up.
    var listening = false;
    function backFromCemu() {
      if (listening) { return; }
      listening = true;
      window.addEventListener("focus", function again() {
        window.removeEventListener("focus", again);
        if (tabPane("graphicpacks") !== pane || !inner.isConnected) { return; }
        L("PACK", "back in Xsegon: " + g.title + "'s packs read again");
        pane.textContent = "";
        readPacks(pane, g, cur, true);
      });
    }
    if (back) { backFromCemu(); }
    var go = el("div", "ch-list gp-open");
    var act = el("div", "cr-row ch-act");
    act.appendChild(iconEl("cr-ico", "disc"));
    act.appendChild(el("span", "cr-name", "Open Cemu"));
    act.addEventListener("click", openCemu);
    go.appendChild(act);

    // Every pack row and Open Cemu take the bar, so a long list is walked by pad; A on any opens Cemu.
    var cells = [], cur = 0;
    function focusAt(i) {
      if (!inner.isConnected) { return; }
      cur = Math.max(0, Math.min(cells.length - 1, i));
      cells.forEach(function (c, k) { c.classList.toggle("sel", k === cur); });
      setTabRows(pane, { cells: cells, at: cur, word: "open Cemu", move: function (d) { focusAt(cur + d); }, choose: openCemu });
      if (cells[cur]) { cells[cur].scrollIntoView({ block: "nearest", inline: "nearest" }); }
    }
    function cell(n) {
      var k = cells.length;
      n.addEventListener("mouseenter", function () { focusAt(k); });
      cells.push(n);
    }

    if (!res.ok || !res.has) {
      var none = el("p", "cr-none");
      none.appendChild(iconEl("cr-ico", "info"));
      none.appendChild(document.createTextNode(" " + (res.ok ? "No graphic packs to show: " + res.why + "."
        : "Cemu's graphic packs could not be read just now" + (res.error ? ": " + res.error : "") + ".")));
      inner.appendChild(none);
      inner.appendChild(go);
      cell(act);
      focusAt(0);
      return;
    }
    var on = res.packs.filter(function (p) { return p.on; }).length;
    L("PACK", "tab " + g.title + ": " + res.packs.length + " packs, " + on + " on, title " + res.titleId);
    inner.appendChild(el("p", "group-help", res.packs.length + (res.packs.length === 1 ? " graphic pack" : " graphic packs") + " for " + g.title
      + " in Cemu, " + (on ? on + " on" : "none on") + ". " + res.where));
    res.packs.filter(function (p) { return p.late; }).forEach(function (p) {
      var warn = el("p", "gp-late");
      warn.appendChild(iconEl("cr-ico", "shield"));
      warn.appendChild(document.createTextNode(" " + p.name + " looks like your own: it was added to Cemu's downloaded packs after Cemu downloaded them, and Cemu's next Download latest deletes that folder. "
        + "To keep it, move its folder out of downloadedGraphicPacks into graphicPacks. It is now in " + p.folder));
      inner.appendChild(warn);
    });
    var kind = "";
    res.packs.forEach(function (p) {
      if (p.kind !== kind) { kind = p.kind; inner.appendChild(el("h2", "ctl-head", kind)); }
      var line = el("div", "opt ed-row gp-row" + (p.on ? " gp-on" : ""));
      var l = el("label");
      l.appendChild(document.createTextNode(p.name));
      if (p.description) { l.appendChild(el("span", "hint", p.description)); }
      line.appendChild(l);
      line.appendChild(el("span", "ctl-val", (p.on ? "On" : "Off") + (p.own ? ", yours" : "")));
      inner.appendChild(line);
      cell(line);
    });
    inner.appendChild(go);
    cell(act);
    inner.appendChild(el("p", "mt-note", res.whose + (res.set ? " This PC has " + res.set + "." : "")));
    focusAt(at || 0);
  });
}
