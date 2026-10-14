/*  A controller that is wrong inside a game: what to do, and the way there.
    Xsegon does not teach RetroArch a controller: RetroArch keeps what it learns
    as a profile. This window gives the steps in RetroArch's own words, opens
    RetroArch on that page, and says which way RetroArch reads controllers. */

import { setEditorOnClose, toolFrame } from "./editors.js";
import { iconEl } from "./icons.js";
import { L, api } from "./log.js";
import { openRetroArch } from "./rahotkeys.js";
import { stopVideo } from "./snap.js";
import { $editor } from "./state.js";
import { el } from "./util.js";

var STEPS = [
  ["play", "Press Open RetroArch, at the top of this window. It opens on RetroPad Binds where it can. Where it cannot, it says so: go to Settings, then Input, then RetroPad Binds."],
  ["gamepad", "Choose Port 1 Controls. For a second player's controller, Port 2 Controls."],
  ["grid", "Choose Set All Controls, and press each button as RetroArch asks for it."],
  ["check", "Choose Save Controller Profile. RetroArch then knows this controller every time."],
  ["back", "Close RetroArch. The buttons you set per console in Xsegon sit on top of what RetroArch learned."]
];

function section(inner, name) {
  var s = el("div", "pj-sect"), list = el("div", "pi-list");
  s.appendChild(el("div", "pj-head", name));
  s.appendChild(list);
  inner.appendChild(s);
  return list;
}

function fact(list, icon, what, words) {
  var r = el("div", "pi-row");
  r.appendChild(iconEl("opt-ico", icon));
  r.appendChild(el("span", "pi-k", what));
  r.appendChild(el("span", "pi-v", words));
  list.appendChild(r);
  return r.lastChild;
}

// `after` is run as the window closes: Settings, when it was opened from there.
export function openPadGameHelp(after) {
  L("ED", "a controller in games");
  stopVideo();
  setEditorOnClose(typeof after === "function" ? after : null);
  var inner = toolFrame("A CONTROLLER IN GAMES", { cls: "padcheck", close: "Close (esc)",
    before: [{ label: "Open RetroArch", run: function () { openRetroArch("binds"); } }] });
  inner.appendChild(el("p", "mt-note",
    "Xsegon and RetroArch each read a controller by themselves. When a controller does nothing in a game, or its buttons are wrong there " +
    "while Xsegon's own screens are fine, RetroArch has to learn it. That is done in RetroArch, once for each kind of controller."));
  var steps = section(inner, "Teaching RetroArch a controller");
  STEPS.forEach(function (s, i) { fact(steps, s[0], "Step " + (i + 1), s[1]); });
  var reads = section(inner, "How RetroArch reads controllers");
  var how = fact(reads, "gamepad", "Its controller driver", "reading...");
  fact(reads, "info", "What needs which", "Your buttons per console, per game and per player work under any of them. Only a single button for RetroArch's menu needs sdl2. It is changed in RetroArch: Settings, then Drivers.");
  $editor.appendChild(inner);
  $editor.hidden = false;
  api("api/ra-hotkeys.php").then(function (r) {
    if (!how.isConnected) { return; }
    var driver = !r || !r.ok ? "Could not be read: " + ((r && r.error) || "no answer")
      : r.none ? "No RetroArch is set up yet"
      : r.driver || "RetroArch's own choice: its settings name none";
    how.textContent = driver;
    L("CTRL", "a controller in games: RetroArch's pad driver is " + (r && r.ok && !r.none ? r.driver || "not named" : "not read"));
  });
}
