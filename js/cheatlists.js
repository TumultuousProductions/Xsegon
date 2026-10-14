/*  The cheat lists, for a RetroArch that came without them
 *  (includes\cheatlists.php). Asked in a window that says what, how big,
 *  from where and into which folder; from then on it is a bar in the corner
 *  (js\jobbars.js). Nothing is turned on by it: which cheats a game plays
 *  with stays a press on each.
 */

import { confirmWindow } from "./confirm.js";
import { iconEl } from "./icons.js";
import { jobsWatch } from "./jobbars.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { sound } from "./sound.js";
import { el } from "./util.js";

/* What the fetch brings, in the words every place that offers it uses. */
export function cheatListsSize(get) {
  return "about " + get.mb + " MB to download, about " + get.disk + " MB on the disk";
}

/* Ask, then fetch. `started` is told once they are on their way. */
export function askCheatLists(started) {
  api("api/cheats.php?lists=1").then(function (st) {
    if (!st || !st.ok) { showStrip("the cheat lists could not be looked at: " + ((st && st.error) || "no answer"), true); return; }
    if (st.job && st.job.state === "running") {
      showStrip("the cheat lists are being fetched: the bar in the corner shows how far it is", false);
      jobsWatch("cheatlists");
      if (started) { started(); }
      return;
    }
    if (st.have) { showStrip("the cheat lists are on this PC already: a game has them on the Cheats tab of its details", false); return; }
    L("CHTL", "asked: get the cheat lists");
    confirmWindow("Get the cheat lists?", function (box) {
      box.appendChild(el("p", null,
        "RetroArch reads its cheats from lists, a folder for each console, and the RetroArch on this PC came without them. With them, a game's Cheats tab has its cheats to select."));
      box.appendChild(el("p", "confirm-game", "The cheat lists, " + cheatListsSize(st.get)));
      box.appendChild(el("p", "confirm-note", "From: " + st.get.url));
      box.appendChild(el("p", "confirm-note", "Into: " + st.get.dest));
      box.appendChild(el("p", "confirm-safe",
        "They are lists and nothing else. No setting is changed and no cheat is turned on: which cheats a game plays with stays yours to select."));
    }, { label: "Download", run: function () { startCheatLists(started); } }, "Not now",
       function () { L("CHTL", "the cheat lists offer declined"); });
  });
}

function startCheatLists(started) {
  postJson("api/cheats.php", { lists: "get" }).then(function (r) {
    if (!r || !r.ok) { showStrip("the cheat lists were not fetched: " + ((r && r.error) || "no answer"), true); return; }
    L("CHTL", "the cheat lists fetch was started");
    sound("ok");
    showStrip("fetching the cheat lists in the background: the bar in the corner shows how far it is", false);
    jobsWatch("cheatlists");
    if (started) { started(); }
  });
}

/*  The row a game with no cheat lists offers, where its cheats would be
    (js\cheats.js). `lists` is what the server said of them; `alive` says
    whether the row is still on the screen; `again` draws the game's cheats
    anew once the lists are in. A fetch at work is followed from here, one
    light read every two seconds, until it ends or the row is gone. */
export function cheatListsOffer(lists, alive, again) {
  var onWay = !!(lists.job && lists.job.state === "running");
  var line = el("div", "cr-row ch-act sel");
  var name = el("span", "cr-name"), tag = el("span", "cr-tag");
  line.appendChild(iconEl("cr-ico", "download"));
  line.appendChild(name);
  line.appendChild(tag);
  function paint() {
    name.textContent = onWay ? "The cheat lists are being fetched" : "Get the cheat lists...";
    tag.textContent = onWay ? "the bar in the corner shows how far it is" : "about " + lists.get.mb + " MB, from libretro";
  }
  function follow() {
    onWay = true;
    paint();
    var t = setInterval(function () {
      if (!alive()) { clearInterval(t); return; }
      api("api/cheats.php?lists=1").then(function (st) {
        if (!st || !st.ok || (st.job && st.job.state === "running")) { return; }
        clearInterval(t);
        if (!alive()) { return; }
        if (st.have) { again(); return; }
        onWay = false;                    // stopped, or it did not come: the corner said why
        paint();
      });
    }, 2000);
  }
  function choose() { if (!onWay) { askCheatLists(follow); } }
  line.addEventListener("click", choose);
  paint();
  if (onWay) { follow(); }
  return { line: line, choose: choose };
}
