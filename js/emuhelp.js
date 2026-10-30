/*  Play on a game whose console has no emulator, where RetroArch is not the way:
 *  what Xsegon brings, the well-known emulators to get from their makers, and
 *  Add an emulator... (api\emusuggest.php). The list of every console's is the
 *  same rows, opened from that window and from Settings > Emulators.
 */

import { confirmWindow } from "./confirm.js";
import { closeEditor, setEditorOnClose, toolFrame } from "./editors.js";
import { openEmuAdd } from "./emuadd.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { el, namesAnd } from "./util.js";

var NEVER = "Xsegon never provides games, BIOS or firmware.";

/** A game that cannot start for want of an emulator, where RetroArch is not the press (js\raoffer.js). */
export function needsEmulator(g) {
  return !!g && !g.playable && !g.raOffer && /^no emulator/.test(g.why || "");
}

// Its makers' page in your own browser: the server opens what its list names, never an address from here.
function openSite(e) {
  postJson("api/emusuggest.php", { open: e.id }).then(function (r) {
    if (!r || !r.ok) { showStrip(e.name + "'s website did not open: " + ((r && r.error) || "no answer"), true); return; }
    L("EMU", "opened the website of " + e.name);
    sound("select");
    showStrip("Opened " + e.site + " in your browser", false);
  });
}

/* One emulator: its name, the press that opens its makers' site, and what it asks for. */
function emuRow(e) {
  var r = el("div", "eh-emu");
  var head = r.appendChild(el("div", "eh-head"));
  head.appendChild(el("span", "eh-name", e.name));
  var b = head.appendChild(el("button", "eh-site", "Open " + e.site));
  b.type = "button";
  b.title = "Its makers' own website, in your browser";
  b.addEventListener("click", function () { openSite(e); });
  if (e.needs) { r.appendChild(el("p", "confirm-note eh-needs", e.needs)); }
  return r;
}

/* The words for a console with none named: on purpose, or none known. */
function noneWords(res) {
  return (res.none ? "Xsegon names no emulator for " : "Xsegon knows no emulator to suggest for ") + res.platform +
    ". If you have one, Add an emulator... puts it in, and its games are ready to play.";
}

export function askEmulator(g) {
  L("EMU", "play pressed on " + g.title + " with no emulator for " + g.platform + ": the emulators to get shown");
  api("api/emusuggest.php?platform=" + encodeURIComponent(g.platform)).then(function (res) {
    // No answer: the red line it always was.
    if (!res || !res.ok) { showStrip("cannot launch: " + (g.why || "no command"), true); return; }
    var list = res.emulators || [];
    var win = confirmWindow(g.platform + " needs an emulator", function (box) {
      box.classList.add("emu-help");
      box.appendChild(el("p", "confirm-game", g.title + "  ·  " + g.platform));
      box.appendChild(el("p", null, res.ra
        ? "RetroArch, which comes with Xsegon, plays " + g.platform + ", but nothing here is set to start its games. Settings > Emulators shows what each console uses, or get an emulator of your own."
        : "Xsegon brings RetroArch, which plays most older consoles. " + g.platform + " is not one of them: its games need an emulator of their own, which you get yourself, free, from the people who make it."));
      if (list.length) {
        box.appendChild(el("p", null, (list.length === 1 ? "The well-known one for " : "Well-known ones for ") + g.platform + ":"));
        list.forEach(function (e) { box.appendChild(emuRow(e)); });
        box.appendChild(el("p", null, "Once it is on your PC, Add an emulator... puts it in, and these games are ready to play."));
      } else {
        box.appendChild(el("p", null, noneWords(res)));
      }
      box.appendChild(el("p", "confirm-note", NEVER));
      var all = box.appendChild(el("button", "eh-all", "Emulators for every console..."));
      all.type = "button";
      all.addEventListener("click", function () { win.close(); openEmuList(); });
    }, { label: "Add an emulator...", run: function () { openEmuAdd(); } }, "Not now");
  });
}

/* Every console's: the ones to get yourself, the ones named none, the ones RetroArch plays.
   opts.after runs when it closes (Settings opens it and wants to come back). */
export function openEmuList(opts) {
  opts = opts || {};
  L("EMU", "emulators for every console opened");
  api("api/emusuggest.php").then(function (res) {
    if (!res || !res.ok) { showStrip("The list of emulators could not be read: " + ((res && res.error) || "no answer"), true); return; }
    var inner = toolFrame("EMULATORS FOR EVERY CONSOLE", { cls: "eh-inner", before: [{ label: "Add an emulator...", run: function () {
      // Straight to the screen: Settings comes back after it, not in between.
      setEditorOnClose(null);
      closeEditor(true);
      openEmuAdd({ after: opts.after });
    } }] });
    inner.appendChild(el("p", "group-help", "Xsegon brings RetroArch, which plays " + res.ra.length + " consoles. Every other console needs an emulator of its own, " +
      "which you get yourself, free, from the people who make it. Once it is on your PC, Add an emulator... puts it in."));
    function sect(title) {
      var s = inner.appendChild(el("div", "eh-sect"));
      s.appendChild(el("h2", "eh-title", title));
      return s;
    }
    var get = sect("Get these yourself");
    res.consoles.forEach(function (c) {
      var block = get.appendChild(el("div", "eh-console"));
      block.appendChild(el("div", "eh-console-name", c.platform));
      c.emulators.forEach(function (e) { block.appendChild(emuRow(e)); });
    });
    sect("None named").appendChild(el("p", "mt-note", "Xsegon names no emulator for " + namesAnd(res.none) + ". If you have one, Add an emulator... puts it in."));
    sect("Comes with Xsegon").appendChild(el("p", "mt-note", "RetroArch plays " + namesAnd(res.ra) + "."));
    inner.appendChild(el("p", "confirm-note eh-never", NEVER));
    $editor.appendChild(inner);
    $editor.hidden = false;
    $editor.dataset.tool = "emuhelp";
    setEditorOnClose(function () { delete $editor.dataset.tool; if (opts.after) { opts.after(); } });
    sound("select");
  });
}
