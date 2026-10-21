/*  Get Media (roadmap BL1): every way Xsegon fetches pictures, videos and manuals in bulk,
 *  in one window laid out as a page of Settings, so the keys and a controller walk
 *  it as they walk the rest (js\padwin.js). Opened from its own button on the menu
 *  bar, and from the Xsegon logo's menu where the bar is not. A row's button closes
 *  this window and opens its source's own, or starts its job. The counts are one
 *  look at the library (api\getmedia.php), drawn when they come: nothing is fetched
 *  until a press.
 */

import { openArchiveManuals } from "./archivedoc.js";
import { openArchiveVideos } from "./archivevid.js";
import { closeEditor, toolFrame } from "./editors.js";
import { openFillTool } from "./fill.js";
import { openGetAll } from "./getall.js";
import { iconEl } from "./icons.js";
import { L, api } from "./log.js";
import { TIPS } from "./menu-tips.js";
import { openScreenScraper } from "./screenscraper.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { openSteamTrailers } from "./steamvid.js";
import { el, plural } from "./util.js";
import { exportNoVideos, importVideoPackage } from "./videopack.js";

// Each row's name is the one messages point to ("Get Media > Steam trailers"): changing one means changing them.
var SECTIONS = [
  // Every source below in one press (js\getall.js, roadmap BL2): what it does on the left, its button on the right.
  { name: "All at once", rows: [
    { icon: "sparkle", label: "Every missing cover, video and manual, from every source at once", tip: TIPS.getall, button: "Get Everything", run: openGetAll }
  ] },
  { name: "Pictures", count: function (n) { return n.noCover ? plural(n.noCover, "game", "games") + " with no cover" : "every game has a cover"; }, rows: [
    { icon: "wand", label: "Get Pictures", tip: TIPS.fillAll, note: "every sure match, in the background", button: "Start", run: function () { openFillTool(null, true); } },
    { icon: "wand", label: "Get Specific Pictures", tip: TIPS.fill, note: "the list first, you choose", button: "Choose...", run: function () { openFillTool(); } }
  ] },
  { name: "Videos", count: function (n) { return n.noVideo ? plural(n.noVideo, "game", "games") + " with no video" : "every game has a video"; }, rows: [
    { icon: "film", label: "Steam trailers", tip: TIPS.steamvid, button: "Open...", run: openSteamTrailers,
      note: function (n) { return !n ? "your Steam games" : !n.steam ? "no Steam games here" : n.steamNoVideo ? plural(n.steamNoVideo, "Steam game", "Steam games") + " with none" : "every Steam game has one"; } },
    { icon: "film", label: "ScreenScraper videos", tip: TIPS.sscraper, note: "a free ScreenScraper account", button: "Open...", run: openScreenScraper },
    { icon: "film", label: "Videos from online archives", tip: TIPS.archivevid, note: "no account", button: "Open...", run: openArchiveVideos }
  ] },
  // A game counts as having one when any of its versions has a manual (api\getmedia.php, includes\archivedoc.php).
  { name: "Manuals", count: function (n) { return n.noManual ? plural(n.noManual, "game", "games") + " with no manual" : "every game has a manual"; }, rows: [
    { icon: "book", label: "Manuals from online archives", tip: TIPS.archivedoc, note: "no account", button: "Open...", run: openArchiveManuals }
  ] },
  { name: "Between your own PCs", rows: [
    { icon: "lines", label: "Export Games with No videos", tip: TIPS.vpExport, note: "the list a video package is made from", button: "Export", run: exportNoVideos },
    { icon: "download", label: "Import Xsegon Video Package", tip: TIPS.vpImport, note: "a package made on another PC", button: "Import...", run: importVideoPackage }
  ] }
];

/* A row another part adds (private\web adds its own), after the row it names, else at the end. */
export function addMediaRow(after, row) {
  for (var i = 0; i < SECTIONS.length; i++) {
    var at = SECTIONS[i].rows.findIndex(function (r) { return r.label === after; });
    if (at >= 0) { SECTIONS[i].rows.splice(at + 1, 0, row); return; }
  }
  SECTIONS[SECTIONS.length - 1].rows.push(row);
}

var win = null, counts = null, paints = [];

function paint() { paints.forEach(function (p) { p(); }); }

function section(s) {
  var box = el("div", "set-sect"), head = el("div", "sect-head");
  head.appendChild(el("span", "sect-name", s.name));
  if (s.count) {
    var said = head.appendChild(el("span", "sect-count"));
    paints.push(function () { said.textContent = counts ? s.count(counts) : counts === false ? "" : "counting..."; });
  }
  box.appendChild(head);
  return box;
}

function row(r) {
  var n = el("div", "opt link-row"), right = el("span", "su-right"), note = el("span", "su-note"), btn = el("button", null, r.button || "Open...");
  if (r.tip) { n.title = r.tip; }
  n.appendChild(iconEl("opt-ico", r.icon || "download"));
  n.appendChild(el("label", null, r.label));
  btn.type = "button";
  btn.addEventListener("click", function () {
    L("MNU", "Get Media > " + r.label);
    sound("select");
    closeEditor(true);
    r.run();
  });
  right.appendChild(note);
  right.appendChild(btn);
  n.appendChild(right);
  paints.push(function () { note.textContent = typeof r.note === "function" ? r.note(counts) : r.note || ""; });
  return n;
}

export function openGetMedia() {
  L("ED", "get media");
  stopVideo();
  counts = null;
  paints = [];
  var inner = toolFrame("GET MEDIA", { base: "set-inner", cls: "gm-inner" });
  var body = inner.appendChild(el("div", "set-body"));
  SECTIONS.forEach(function (s) {
    var box = body.appendChild(section(s));
    s.rows.forEach(function (r) { box.appendChild(row(r)); });
  });
  $editor.textContent = "";
  $editor.appendChild(inner);
  $editor.hidden = false;
  win = inner;
  paint();
  api("api/getmedia.php").then(function (res) {
    if (win !== inner || !inner.isConnected) { return; }   // closed, or another window took its place
    counts = res && res.ok ? res : false;
    if (counts) { L("ED", "get media counts: " + counts.noCover + " with no cover, " + counts.noVideo + " with no video (" + counts.steamNoVideo + " of them Steam), " + counts.noManual + " with no manual, of " + counts.games); }
    paint();
  });
}
