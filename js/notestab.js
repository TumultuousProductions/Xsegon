/*  The Notes tab of a game's details (js\detailtabs.js): a box to write
    anything worth remembering about the game, kept in Xsegon's own
    data\notes.json (api\notes.php).

    There is nothing to press: what is written is kept after a pause in the
    typing, when the box is left, and when the tab or details is put away.
    Every key belongs to the box while it is being written in; Esc leaves it. */

import { onTabLeave, relabelTabs, setTabRows, tabPane } from "./detailtabs.js";
import { iconEl } from "./icons.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { el } from "./util.js";

export function notesTabLabel(g, full) { return full && full.myNote ? "Notes •" : "Notes"; }

export function notesPane(pane, g) {
  pane.appendChild(el("p", "dtab-wait", "…"));
  api("api/notes.php?id=" + encodeURIComponent(g.id)).then(function (res) {
    if (tabPane("notes") !== pane) { return; }               // another tab, or another game, by now
    pane.textContent = "";
    var inner = el("div", "ch-inner ch-tab nt-tab");
    pane.appendChild(inner);
    if (!res.ok) {
      var none = el("p", "cr-none");
      none.appendChild(iconEl("cr-ico", "info"));
      none.appendChild(document.createTextNode(" The notes for this game could not be read."));
      inner.appendChild(none);
      setTabRows(pane, null);
      return;
    }
    inner.appendChild(el("p", "group-help", "Yours, about this game: where you left off, a password, which settings worked. Kept as you write; there is nothing to press."));
    var box = el("textarea", "nt-box");
    box.value = res.text || "";
    box.spellcheck = false;
    box.maxLength = 20000;
    box.placeholder = "Write anything you want to remember about " + g.title + ".";
    box.setAttribute("aria-label", "Notes on " + g.title);
    inner.appendChild(box);
    var says = el("p", "mt-note nt-says", res.at ? "Last written " + new Date(res.at * 1000).toISOString().slice(0, 10) + "." : "");
    inner.appendChild(says);

    var kept = box.value, wait = null, sent = 0;
    L("NOTE", "tab " + g.title + (kept ? " (" + kept.length + " characters)" : " (empty)"));

    function keep() {
      clearTimeout(wait);
      var now = box.value;
      if (now === kept) { return; }
      var mine = ++sent;
      says.textContent = "Keeping…";
      says.classList.remove("warn");
      postJson("api/notes.php", { id: g.id, text: now }).then(function (out) {
        if (!out.ok) {
          L("NOTE", g.title + " not kept: " + (out.error || "no answer"));
          if (says.isConnected) { says.textContent = "Not kept: " + (out.error || "the server gave no answer") + ". It is still in the box."; says.classList.add("warn"); }
          showStrip("The note on " + g.title + " was not kept: " + (out.error || "the server gave no answer"), true);
          return;
        }
        if (mine === sent) { kept = now; }
        relabelTabs({ myNote: !!now.trim() }, g.id);
        if (says.isConnected && mine === sent) { says.textContent = now.trim() ? "Kept." : "Nothing written: no note is kept."; }
      });
    }

    box.addEventListener("input", function () {
      says.textContent = "";
      clearTimeout(wait);
      wait = setTimeout(keep, 1200);
    });
    box.addEventListener("blur", keep);
    onTabLeave(pane, keep);                           // another tab, another game, or details put away

    // Down from the tabs, or A, goes into the box.
    setTabRows(pane, { cells: [box], at: 0, word: "write",
                       move: function () { box.focus(); }, choose: function () { box.focus(); } });
  });
}
