/*  Settings > RetroArch + Emulator Controls > Other emulators: each standalone emulator
    the table starts games in (api\emusetup.php, roadmap CA15). How a game in it is
    left with a pad, and Set up: Xsegon's own profiles written, each game's own file
    naming them from its next start; Put back takes all of it away. An emulator's main
    settings are never changed. What a row says comes from the server's answer. */

import { iconEl } from "./icons.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { sound } from "./sound.js";
import { el } from "./util.js";

export function emuSetupPage(part) {
  var box = el("div", "emus-rows");
  part.appendChild(box);
  api("api/emusetup.php").then(function (res) {
    if (!res.ok) { box.appendChild(el("p", "hint", "The other emulators could not be read just now.")); return; }
    if (!res.emus.length) { box.appendChild(el("p", "hint", "None of your games start in an emulator other than RetroArch.")); return; }
    res.emus.forEach(function (e) { box.appendChild(row(e)); });
  });
}

function row(e) {
  var r = el("div", "opt emus-row");
  r.dataset.emu = e.key;
  r.appendChild(iconEl("opt-ico", "gamepad"));
  var l = el("label");
  l.appendChild(document.createTextNode(e.name + (e.on ? ": set up by Xsegon" + (e.games ? ", " + e.games + (e.games === 1 ? " game" : " games") + " so far" : "") : "")));
  l.appendChild(el("span", "hint", "Leaving a game: " + e.leave.words));
  l.appendChild(el("span", "hint", e.words));
  r.appendChild(l);
  r.dataset.find = (e.name + " " + e.leave.words + " " + e.words).toLowerCase();
  if (e.canSetUp) {
    var b = el("button", null, e.on ? "Put back" : "Set up");
    b.addEventListener("click", function () { press(e, r, b); });
    r.appendChild(b);
  }
  return r;
}

function press(e, r, b) {
  var on = !e.on;
  b.disabled = true;
  sound("select");
  L("EMUS", (on ? "set up " : "put back ") + e.name);
  postJson("api/emusetup.php", { key: e.key, on: on }).then(function (res) {
    b.disabled = false;
    if (!res.ok) {
      showStrip(e.name + ": " + (res.error || "it could not be done"), true);
      return;
    }
    // Drawn again from the server's own list, so the row says what is true now.
    api("api/emusetup.php").then(function (all) {
      var now = all.ok && all.emus.find(function (x) { return x.key === e.key; });
      if (now) { r.replaceWith(row(now)); }
    });
  });
}
