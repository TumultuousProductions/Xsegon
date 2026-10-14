/*  Videos with Skraper, in steps: the way on for games the Internet Archive
 *  has no video for. Opened from the message a fetch leaves
 *  when games got none (includes\archivevid.php). Xsegon fetches nothing
 *  here: Skraper is a program of its own, with the person's own free account.
 */

import { confirmWindow } from "./confirm.js";
import { showStrip } from "./launch.js";
import { L, postJson } from "./log.js";
import { el } from "./util.js";

var STEPS = [
  "Make a free account at screenscraper.fr. Get Skraper from skraper.net and sign in to it with that account.",
  "In Skraper, add a console and show it the folder that console's games are in.",
  "In its list of media keep only Video. Choose the normalised video where it is offered: smaller files, all one kind.",
  "Set where it writes to that console's folder in Xsegon's videos folder, named below. The folder's name is how a video finds its console.",
  "Turn its game list off: Xsegon does not read one.",
  "Run it for one console first. Then start Xsegon again: the videos are found by the names of your game files, with nothing to bring in."
];

var MIND = [
  "If LaunchBox is on this PC, never let Skraper use its LaunchBox setting (under Games & front-end). With that setting its game list is LaunchBox's own list of games, and it writes over it. Any other front end there, with the game list off.",
  "It does not see GameCube .ciso or Wii U .wux files, or a game kept as a folder: right-click > Add Video on a game takes a video you choose.",
  "A free account has a daily allowance, so a big library takes more than one day."
];

/* `m` is the message, with the consoles it names: [{ platform, games, folder }]. */
export function openSkraperHow(m) {
  var consoles = (m && m.consoles) || [];
  L("NEWS", "the Skraper steps opened (" + consoles.length + " consoles named)");
  confirmWindow("Videos with Skraper", function (box) {
    box.classList.add("skraper-how");
    box.appendChild(el("p", null,
      "Skraper is a free program for Windows that fetches game videos from ScreenScraper, a free database kept by its community. It is not part of Xsegon, and it works with an account of your own."));
    var steps = el("ol", "confirm-points");
    STEPS.forEach(function (words) { steps.appendChild(el("li", null, words)); });
    box.appendChild(steps);
    if (consoles.length) {
      box.appendChild(el("p", null, "Where its videos go, a console each:"));
      var list = el("div", "confirm-list");
      consoles.slice(0, 12).forEach(function (c) {
        list.appendChild(el("p", "confirm-note", c.platform + " (" + c.games + (c.games === 1 ? " game" : " games") + "): " + c.folder));
      });
      box.appendChild(list);
      var open = el("button", null, "Open the videos folder");
      open.type = "button";
      open.addEventListener("click", function () {
        postJson("api/reveal.php", { what: "videos", consoles: consoles.slice(0, 12).map(function (c) { return c.platform; }) }).then(function (r) {
          if (!r || !r.ok) { showStrip("the videos folder was not opened: " + ((r && r.error) || "no answer"), true); }
        });
      });
      box.appendChild(open);
    }
    box.appendChild(el("p", null, "Worth knowing first:"));
    var mind = el("ul", "confirm-points");
    MIND.forEach(function (words) { mind.appendChild(el("li", null, words)); });
    box.appendChild(mind);
  }, null, "Close");
}
