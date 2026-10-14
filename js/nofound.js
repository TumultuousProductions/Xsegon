/*  When Set it all up found no games: the window that says so, and why.
 *
 *  What happened, in the scan's own findings (files whose console could not
 *  be told, folders not named for a console, archives that hold discs), and a
 *  press for each way on: choose another folder, scan again, open Xsegon's own
 *  Games folder, or not now, which leaves the main screen's No games yet box
 *  (js\nogames.js) as the standing way back.
 */

import { L } from "./log.js";
import { openGamesFolder } from "./nogames.js";
import { sound } from "./sound.js";
import { closeOnBackdrop, el, plural } from "./util.js";

/* Why the scan found nothing, from what it saw: at most three lines, the
   likeliest fix first. */
function reasons(scan) {
  var out = [];
  var unsure = scan.unsure || [], unknown = scan.unknown || [], archives = scan.archives || [], skipped = scan.skippedFolders || [];
  if (unsure.length) {
    var n = unsure.reduce(function (t, u) { return t + (u.n || 0); }, 0);
    out.push(plural(n, "file", "files") + " whose console Xsegon could not tell (" + unsure[0].kinds + (unsure.length > 1 ? ", and more" : "") +
      "). Put them in a folder named after their console: psx, saturn, n64 and so on.");
  }
  if (unknown.length) {
    out.push(plural(unknown.length, "folder", "folders") + " not named after a console, such as \"" + String(unknown[0].folder).replace(/\\/g, "/").split("/").pop() +
      "\". Name a folder after the console its games are for (nes, snes, n64, gba...), or put the games in one that is.");
  }
  if (archives.length) {
    out.push(plural(archives.length, "archive that holds", "archives that hold") + " a disc. Extract " + (archives.length === 1 ? "it" : "them") + " and scan again.");
  }
  if (!out.length && skipped.length) { out.push(skipped[0].why + "."); }
  if (!out.length) {
    out.push("Nothing in it is a game file Xsegon knows. Put your games in it, a folder per console works best (nes, snes, n64...), then scan again.");
  }
  return out.slice(0, 3);
}

/*  info: { folder, error, scan, own }: the folder looked in (or none), a
    reason it could not be used, the scan's answer, and whether it is the
    Games folder Xsegon made (the only one it can open in Explorer).
    on: { pick, rescan }: what Choose another folder and Scan again do. */
export function noGamesFound(info, on) {
  var title = info.folder ? "No games found yet" : "No games folder yet";
  L("SETUP", "set it all up found no games: " + (info.error || (info.folder ? "nothing in " + info.folder : "no folder chosen")));
  var wrap = el("div", "confirm-wrap setup-confirm nofound");
  var box = el("div", "confirm");
  box.appendChild(el("h2", null, title));
  if (!info.folder) {
    box.appendChild(el("p", null, "No folder was chosen, so there are no games to add yet. RetroArch and the rest carry on by themselves."));
  } else if (info.error) {
    box.appendChild(el("p", null, "Xsegon could not look in " + info.folder + ": " + info.error + "."));
  } else {
    box.appendChild(el("p", null, "Xsegon looked in " + info.folder + " and found no games it can add."));
    reasons(info.scan || {}).forEach(function (r) { box.appendChild(el("p", "confirm-note", r)); });
  }
  box.appendChild(el("p", "confirm-safe", "Names and pictures start by themselves once games are added. Not now leaves this for later: the main screen keeps a way back."));
  var bar = el("div", "confirm-bar");
  function btn(label, primary, run, keep) {
    var b = el("button", primary ? "primary" : null, label);
    b.type = "button";
    b.addEventListener("click", function () { if (!keep) { close(); } if (run) { run(); } });
    bar.appendChild(b);
    return b;
  }
  btn("Not now", false, function () { L("SETUP", "no games: not now"); });
  // Stays open: put the games in, then Scan again is right here.
  if (info.own) { btn("Open the Games folder", false, openGamesFolder, true); }
  if (info.folder && !info.error) { btn("Scan again", false, on.rescan); }
  var first = btn(info.folder ? "Choose another folder..." : "Choose a folder...", true, on.pick);
  box.appendChild(bar);
  wrap.appendChild(box);
  document.body.appendChild(wrap);
  function close() {
    if (wrap.parentNode) { wrap.parentNode.removeChild(wrap); }
    document.removeEventListener("keydown", key, true);
  }
  function key(e) {
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); sound("back"); }
  }
  document.addEventListener("keydown", key, true);
  closeOnBackdrop(wrap, close);
  first.focus();
  sound("select");
}
