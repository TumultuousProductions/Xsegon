/*  What the game view and the consoles screen show while the library has no
 *  games at all (not a search or a filter that matched none): as ES-DE does, the
 *  empty screen says so, where Xsegon looked, and the two presses that fix it, so
 *  someone who closed the guide has a road back. The caller hands over openGuide,
 *  so this file never has to import js\setup.js.
 */

import { L, api } from "./log.js";
import { showInExplorer } from "./reveal.js";
import { openScanTool } from "./scan.js";
import { el } from "./util.js";

/* While Set it all up waits for the folder to be chosen the empty screen
   says only that: its buttons read as more to do to someone who had just
   pressed the one that does it all. */
var ASK_FOLDER = "Choose the folder your games are in, in the window that opened. Xsegon does the rest by itself.";
var asking = false, askWords = ASK_FOLDER, shown = [];
export function noGamesAsking(on, words) {
  asking = !!on;
  askWords = words || ASK_FOLDER;
  shown = shown.filter(function (s) { return s.box.isConnected; });
  shown.forEach(function (s) { s.say(); });
}

export function noGamesBox(beforeOpen, openGuideFn) {
  var box = el("div", "nogames");
  var title = el("h2", "nogames-title", "No games yet");
  box.appendChild(title);
  var where = el("p", "nogames-where", "");
  box.appendChild(where);
  var btns = el("div", "nogames-btns");
  var scan = el("button", "primary", "Scan for Games");
  scan.type = "button";
  scan.addEventListener("click", function () { if (beforeOpen) { beforeOpen(); } openScanTool(); });
  var guide = el("button", null, "Getting started");
  guide.type = "button";
  guide.addEventListener("click", function () { if (beforeOpen) { beforeOpen(); } openGuideFn(); });
  btns.appendChild(scan);
  btns.appendChild(guide);
  box.appendChild(btns);
  var openBtn = null;
  function say() {
    box.classList.toggle("asking", asking);
    if (asking) {
      title.textContent = "Setting up";
      where.textContent = askWords;
      return;
    }
    title.textContent = "No games yet";
    where.textContent = "Looking up where Xsegon looks for games...";
    api("api/scan.php?folders=1").then(function (r) {
      if (asking) { return; }
      var folders = (r && r.ok && r.folders) || [];
      where.textContent = "";
      if (!folders.length) {
        where.appendChild(document.createTextNode(
          "Xsegon has not been told where your games are. Getting started asks for the folder, then finds them."));
        return;
      }
      where.appendChild(document.createTextNode(folders.length === 1 ? "Xsegon looks for games in " : "Xsegon looks for games in these folders: "));
      folders.forEach(function (f, i) {
        if (i) { where.appendChild(document.createTextNode(", ")); }
        where.appendChild(el("span", "nogames-path" + (f.there ? "" : " gone"), f.path + (f.there ? "" : " (not found: a drive unplugged?)")));
      });
      where.appendChild(document.createTextNode(
        ". Put your games there, a folder per console works best, then Scan for Games finds them."));
      // The Games folder Xsegon made for a new copy: one press to reach it.
      if (!openBtn && folders.some(function (f) { return f.made && f.there; })) {
        openBtn = el("button", null, "Open the Games folder");
        openBtn.type = "button";
        openBtn.addEventListener("click", openGamesFolder);
        btns.appendChild(openBtn);
      }
    });
  }
  shown = shown.filter(function (s) { return s.box.isConnected; });
  shown.push({ box: box, say: say });
  say();
  return box;
}

/* The Games folder a new copy starts with, in Explorer (api\reveal.php names
   no path: it is the one folder Xsegon made). */
export function openGamesFolder() {
  L("SETUP", "open the Games folder");
  showInExplorer({ what: "games" }, "could not open the folder");
}
