/*  The + button: which kind of adding (a folder, one game by hand, Steam).
 *  Asking costs one press, and each choice's Back returns here rather than closing.
 */

import { openLocalEditor, setEditorOnClose, toolFrame } from "./editors.js";
import { iconEl } from "./icons.js";
import { L } from "./log.js";
import { openScanTool } from "./scan.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { openSteamTool } from "./steam.js";
import { el } from "./util.js";

export function openAddChooser() {
  L("ED", "add chooser");
  setEditorOnClose(null);
  $editor.textContent = "";
  $editor.dataset.tool = "add";

  var inner = toolFrame("ADD GAMES", { keep: true });

  var pair = el("div", "add-pair");
  pair.appendChild(bigButton("folder", "Add automatically from a folder",
    "Point Xsegon at a folder of ROMs and it works out what is in it, console by console. " +
    "You see everything it found and select what you want. You can give it more than one folder.",
    function () { openScanTool(openAddChooser); }));
  pair.appendChild(bigButton("plus", "Add one by hand",
    "For a game Xsegon cannot find by looking: a program on your machine, a web game, " +
    "anything with its own way of starting. You give it a name, a console and how to run it.",
    function () { openLocalEditor(null, openAddChooser); }));
  pair.appendChild(bigButton("gamepad", "Add your Steam games",
    "Everything Steam has installed, with the pictures Steam keeps for each one. Select what you want; " +
    "they start through Steam, or without it from the right-click menu.",
    function () { openSteamTool(openAddChooser); }));
  inner.appendChild(pair);

  $editor.appendChild(inner);
  $editor.hidden = false;
  sound("select");
}

function bigButton(icon, title, words, run) {
  var b = el("button", "add-big");
  b.type = "button";
  var top = el("div", "add-big-top");
  top.appendChild(iconEl("add-ico", icon));
  top.appendChild(el("span", "add-big-title", title));
  b.appendChild(top);
  b.appendChild(el("span", "add-big-words", words));
  b.addEventListener("click", run);
  return b;
}
