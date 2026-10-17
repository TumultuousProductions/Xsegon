/*  Hardcore before a start (api\launch.php answers "ask" with why "state" or
    "cheats"): RetroArch is signed in to RetroAchievements with hardcore on,
    which refuses a save loaded and cheats inside the game. Asked here instead,
    two ways each; Esc starts nothing. go(hc, fromStart) starts it as chosen:
    hc "soft" is softcore for this one play, "nocheats" leaves the cheats out. */

import { closeEditor, setEditorOnClose, toolFrame } from "./editors.js";
import { L } from "./log.js";
import { stopVideo } from "./snap.js";
import { $editor } from "./state.js";
import { el } from "./util.js";

export function askHardcore(title, why, slot, go) {
  L("MNU", "ask hardcore, " + title + " (" + why + ")");
  stopVideo();
  setEditorOnClose(null);
  var save = why === "state";
  var inner = toolFrame(save ? "HARDCORE AND YOUR SAVE" : "HARDCORE AND YOUR CHEATS", { base: "st-ask", close: "Cancel (esc)" });
  inner.appendChild(el("p", "group-help", save
    ? "RetroArch plays with RetroAchievements in hardcore, and hardcore does not allow loading a save. Starting " + title + " from slot " + slot + " turns hardcore off for this play."
    : "RetroArch plays with RetroAchievements in hardcore, and hardcore does not allow cheats. Playing " + title + " with the cheats you selected turns hardcore off for this play."));
  inner.appendChild(el("p", "group-help", "Hardcore stays on for every other game, and for this one next time."));
  var bar = el("div", "st-ask-bar");
  [[save ? "Play from my save (softcore this time)" : "Play with my cheats (softcore this time)",
    function () { L("LNCH", "hardcore off for this play of " + title); closeEditor(); go("soft", false); }],
   [save ? "Play from the start (hardcore)" : "Play without cheats (hardcore)",
    function () { L("LNCH", "hardcore kept for " + title + (save ? ", from the start" : ", without cheats")); closeEditor(); go(save ? null : "nocheats", save); }]
  ].forEach(function (b, i) {
    var btn = el("button", i === 0 ? "primary" : null, b[0]);
    btn.addEventListener("click", b[1]);
    bar.appendChild(btn);
  });
  inner.appendChild(bar);
  $editor.appendChild(inner);
  $editor.hidden = false;
  bar.querySelector("button").focus();
}
