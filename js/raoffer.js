/*  The press that gets RetroArch, wherever a game says it has no emulator
 *  (includes\setup.php xs_setup_ra_offer gives raOffer): Set it all up while it
 *  was never used, else Get RetroArch or Use RetroArch, whose cores follow by
 *  themselves. Every press asks the server again, so it does what is true now.
 */

import { confirmWindow } from "./confirm.js";
import { reloadKeeping } from "./editors.js";
import { showStrip } from "./launch.js";
import { L, api } from "./log.js";
import { confirmGet, confirmUse, openGuide } from "./setup.js";
import { jobLine, quietDone, watchSetup, watchUp } from "./setupbar.js";
import { openSetupWindow } from "./setupwin.js";
import { games, sel } from "./state.js";
import { el } from "./util.js";

/** The press's words for an offer, or null where there is nothing to press ('coming', none).
    No module-level value: js\news.js asks at load, perhaps before this file has run. */
export function raLabel(offer) {
  return offer === "setup" ? "Set it all up..." : offer === "get" ? "Get RetroArch..." : offer === "use" ? "Use RetroArch..." : null;
}

/** A button for the offer, or null. from: where it was pressed, for the log. */
export function raButton(offer, from, cls) {
  var label = raLabel(offer);
  if (!label) { return null; }
  var b = el("button", cls || "primary", label);
  b.type = "button";
  b.addEventListener("click", function () { getRetroArch(from); });
  return b;
}

export function getRetroArch(from) {
  L("SETUP", "RetroArch asked for from " + from);
  api("api/setup.php").then(function (st) {
    if (!st || !st.ok) { showStrip("RetroArch could not be looked at: " + ((st && st.error) || "no answer"), true); return; }
    if (st.job && st.job.state === "running") {
      showStrip("RetroArch is being set up: " + jobLine(st.job), false);
      if (!watchUp()) { watchSetup(quietDone); }
      return;
    }
    if (!st.auto && (st.canGet || st.canUse)) { openSetupWindow(st, openGuide); return; }
    if (st.canGet) { confirmGet(st, false); return; }
    if (st.canUse) { confirmUse(st); return; }
    // In already: the games on screen were read before it came.
    L("SETUP", "RetroArch is in already: " + (st.retroarch.exe || ""));
    showStrip("RetroArch is set up already: " + (st.retroarch.exe || ""), false);
    reloadKeeping(games[sel] ? games[sel].id : null);
  });
}

/* Play on a game that has no emulator: what plays it, and the press, in a small window. */
export function askRetroArch(g) {
  L("SETUP", "play pressed on " + g.title + " with no emulator: RetroArch offered (" + g.raOffer + ")");
  confirmWindow("No emulator yet", function (box) {
    box.appendChild(el("p", "confirm-game", g.title + "  ·  " + g.platform));
    box.appendChild(el("p", null, g.why));
  }, { label: raLabel(g.raOffer), run: function () { getRetroArch("Play on " + g.title); } }, "Not now");
}
