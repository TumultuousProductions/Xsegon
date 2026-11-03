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

export function emuPacksFor(g) { return !!(g && g.emu === "Cemu" && !g.local && !g.steam); }
export function emuPacksTabLabel() { return "Graphic packs"; }

export function emuPacksPane(pane, g) {
  // Cemu's packs are a few hundred small files, read afresh each time: a couple of seconds the first time.
  pane.appendChild(el("p", "dtab-wait", "Reading Cemu's graphic packs for " + g.title + "…"));
  api("api/emupacks.php?id=" + encodeURIComponent(g.id)).then(function (res) {
    if (tabPane("graphicpacks") !== pane) { return; }          // another tab, or another game, by now
    pane.textContent = "";
    var inner = el("div", "ch-inner ch-tab gp-tab");
    pane.appendChild(inner);
    var open = el("button", "gp-open", "Open Cemu");
    function openCemu() {
      sound("select");
      L("PACK", "open Cemu for " + g.title);
      postJson("api/emuopen.php", { id: g.id }).then(function (r) {
        showStrip(r.ok ? "Cemu is opening: Options > Graphic packs" : (r.error || "could not open Cemu"), !r.ok);
      });
    }
    open.addEventListener("click", openCemu);
    if (!res.ok || !res.has) {
      var none = el("p", "cr-none");
      none.appendChild(iconEl("cr-ico", "info"));
      none.appendChild(document.createTextNode(" " + (res.ok ? "No graphic packs to show: " + res.why + "." : "Cemu's graphic packs could not be read just now.")));
      inner.appendChild(none);
      inner.appendChild(open);
      setTabRows(pane, { cells: [open], at: 0, word: "open Cemu", move: function () {}, choose: openCemu });
      return;
    }
    var on = res.packs.filter(function (p) { return p.on; }).length;
    L("PACK", "tab " + g.title + ": " + res.packs.length + " packs, " + on + " on, title " + res.titleId);
    inner.appendChild(el("p", "group-help", res.packs.length + (res.packs.length === 1 ? " graphic pack" : " graphic packs") + " for " + g.title
      + " in Cemu, " + (on ? on + " on" : "none on") + ". " + res.where));
    res.packs.filter(function (p) { return p.late; }).forEach(function (p) {
      var warn = el("p", "gp-late");
      warn.appendChild(iconEl("cr-ico", "shield"));
      warn.appendChild(document.createTextNode(" " + p.name + " looks like your own: it was put in Cemu's downloaded packs after they came, and Cemu's next Download latest deletes that folder. Moved to "
        + "graphicPacks, beside downloadedGraphicPacks, it is kept: " + p.folder));
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
    });
    inner.appendChild(open);
    inner.appendChild(el("p", "mt-note", res.whose + (res.set ? " This PC has " + res.set + "." : "")));
    setTabRows(pane, { cells: [open], at: 0, word: "open Cemu", move: function () {}, choose: openCemu });
  });
}
