/*  Set everything up: one window for a new person's setup (roadmap AL8b), from
 *  the first start and from Getting started's Set it all up. The games folder on
 *  top, then a switch for each part, all on but the games check, and one press.
 *  Set up by hand is the guide. Laid out as a page of Settings, so the keys and a
 *  controller walk it as they walk the rest (js\padwin.js).
 */

import { askCard } from "./askcards.js";
import { beginAuto, gamesKnown } from "./autosetup.js";
import { closeEditor, setEditorOnClose, toolFrame } from "./editors.js";
import { iconEl } from "./icons.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { openGamesFolder } from "./nogames.js";
import { saveSetting } from "./savednote.js";
import { pickWindowsFolder } from "./scan.js";
import { sound } from "./sound.js";
import { $editor, S } from "./state.js";
import { el, megabytes, plural } from "./util.js";
import { waitBar } from "./waitbar.js";

var GAME_SECS = 25;       // what the Runs check spends on one game (includes\setup.php)
var VIDEO_MB = 4.2;       // a video's usual size, for the estimate (js\setuplist.js)

var win = null, st = null, have = null, offers = { videos: false, cheats: null };
var on = {}, paints = [], gone = false, byHand = null;
var added = [];           // folders added in this window: their new games come in at Set it up, even into a library that has games

function sizeWords(mb) { return mb >= 1024 ? "about " + (Math.round(mb / 102.4) / 10) + " GB" : "about " + Math.max(1, Math.round(mb)) + " MB"; }
function timeWords(secs) {
  var m = Math.round(secs / 60);
  return m < 1 ? "under a minute" : m < 90 ? "about " + plural(m, "minute", "minutes") : "about " + (Math.round(m / 6) / 10) + " hours";
}

/* A row or a button pressed whole: by the pointer, by Enter or Space, and by
   a controller, which presses with a click (js\padwin.js). */
function pressable(n, run) {
  n.tabIndex = 0;
  n.addEventListener("click", run);
  n.addEventListener("keydown", function (e) {
    if (e.target === n && !e.repeat && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); run(); }
  });
}

function row(icon, words, tip) {
  var r = el("div", "opt");
  if (tip) { r.title = tip; }
  r.appendChild(iconEl("opt-ico", icon));
  r.appendChild(el("label", null, words));
  return r;
}

/* One part that can be left out: the row is what is pressed, its switch shows
   how it stands, and the note at its right says what it takes. */
function switchRow(key, icon, words, tip, note) {
  var r = row(icon, words, tip), right = el("span", "su-right"), said = el("span", "su-note"), face = el("input", "tgl");
  face.type = "checkbox";
  face.disabled = true;
  face.setAttribute("aria-hidden", "true");
  r.dataset.key = key;
  r.setAttribute("role", "switch");
  right.appendChild(said);
  right.appendChild(face);
  r.appendChild(right);
  pressable(r, function () { on[key] = !on[key]; sound("move"); paint(); });
  paints.push(function () {
    face.checked = !!on[key];
    r.setAttribute("aria-checked", on[key] ? "true" : "false");
    said.textContent = note ? note() : "";
  });
  return r;
}

function section(name) {
  var box = el("div", "set-sect"), head = el("div", "sect-head");
  head.appendChild(el("span", "sect-name", name));
  box.appendChild(head);
  return box;
}

// How many games the sizes are for: those found in the folders, or those in the library.
function count() { return have ? have.games : 0; }

function folderWords() {
  if (!have) { return "looking through your games folders..."; }
  if (have.scanned) { return plural(have.games, "game", "games") + " in your library" + (have.where ? ", from " + have.where : ""); }
  if (have.games) { return have.where + ", " + plural(have.games, "game", "games"); }
  return have.where ? have.where + ": no games in it yet" : "Not chosen yet";
}

function paint() {
  if (!win) { return; }
  paints.forEach(function (p) { p(); });
}

/* Another folder: added to where Xsegon looks, and everything is looked at again. */
function pickFolder() {
  L("SETUP", "setup window: a folder asked for");
  pickWindowsFolder("Choose the folder your games are in").then(function (path) {
    if (!path || !win) { return; }
    postJson("api/scan.php", { action: "addFolder", path: path }).then(function (res) {
      if (!res.ok && !/already on the list/.test(res.error || "")) { showStrip("that folder could not be added: " + (res.error || ""), true); return; }
      L("SETUP", "games folder " + path + " (setup window)");
      if (added.indexOf(path) < 0) { added.push(path); }
      look();
    });
  });
}

/* What the folders hold now, then the sizes that follow from it. */
function look() {
  var was = have;
  have = null;
  paint();
  api("api/setup.php").then(function (s) {
    if (!win) { return; }
    // A failed look keeps what the window showed, so its buttons work again.
    if (!s || !s.ok) { have = was; paint(); showStrip("the games folders could not be looked at again: " + ((s && s.error) || "no answer"), true); return; }
    st = s;
    return gamesKnown(st).then(function (h) { have = h; paint(); });
  });
}

/* The one press: what is switched on goes with the yes, and the window steps aside. */
function setItUp() {
  if (!have || !st) { return; }
  gone = true;
  var answers = { runs: !!on.runs, videos: !!on.videos && offers.videos, cheats: !!on.cheats && !!offers.cheats, pictures: !!on.pictures };
  L("SETUP", "set it up pressed: " + Object.keys(on).map(function (k) { return k + (on[k] ? " on" : " off"); }).join(", "));
  S.library = Object.assign({}, S.library, { addNewGames: !!on.self });
  saveSetting({ library: { addNewGames: !!on.self } }, "Add new games by themselves");
  closeEditor();
  sound("select");
  // A folder with no games yet: everything else is set up, and the card says where they go.
  if (!have.scanned && !have.games && (have.ask || !have.where)) {
    var own = st.guide.folders.filter(function (f) { return f.there && f.made; })[0];
    beginAuto(st, have, answers, true);
    askCard({ title: own ? "Put your games here" : "Put your games in a folder", big: own ? own.path : "",
      yes: own ? "Open it" : null, no: "OK",
      lines: [[own ? "A folder for each console is already in it. " + (on.self ? "They come in by themselves when you come back to Xsegon." : "Then press Scan for Games.")
                   : "A folder for each console works best (nes, snes, n64...). Then press Scan for Games and choose that folder."]],
      onYes: openGamesFolder });
    return;
  }
  beginAuto(st, Object.assign({}, have, { added: added.slice() }), answers);
}

/* The window, from the first start (js\setup.js firstRunSetup) and from the
   guide's Set it all up. guide: the guide's opener, handed over so this file
   never imports js\setup.js. under: the button pressed, which a bar goes
   beneath while what can be offered is asked; the window opens with its rows settled. */
var asking = false;
export function openSetupWindow(state, guide, under) {
  if (asking) { return; }
  asking = true;
  // What can be offered: videos need Windows' own curl, the cheat lists only where RetroArch came without them.
  var offered = Promise.all([api("api/archivevid.php"), api("api/cheats.php?lists=1")]);
  (under ? waitBar(under, "Looking at what can be set up", offered) : offered).then(function (got) {
    var av = got[0], cl = got[1];
    asking = false;
    showWindow(state, guide, { videos: !!(av && av.ok && av.curl),
      cheats: cl && cl.ok && !cl.have && !(cl.job && cl.job.state === "running") ? cl.get : null });
  });
}

function showWindow(state, guide, found) {
  L("SETUP", "the setup window opened" + (found.videos ? "" : ", with no videos to offer") + (found.cheats ? "" : ", with no cheat lists to offer"));
  st = state;
  byHand = guide;
  have = null;
  gone = false;
  paints = [];
  added = [];
  on = { pictures: true, self: !(S.library && S.library.addNewGames === false), videos: true, cheats: true, runs: false };
  offers = found;
  var inner = toolFrame("SET EVERYTHING UP", { base: "set-inner", cls: "su-inner", close: "Not now (esc)", primary: false });
  var body = inner.appendChild(el("div", "set-body"));

  var gamesBox = body.appendChild(section("Your games"));
  var fr = row("folder", "", "The folder your games are in. Folders inside it named after a console (nes, snes, n64...) work best.");
  fr.classList.add("link-row");
  var pickBtn = el("button", null, "");
  pickBtn.type = "button";
  pickBtn.addEventListener("click", pickFolder);
  fr.appendChild(pickBtn);
  gamesBox.appendChild(fr);
  paints.push(function () {
    fr.querySelector("label").textContent = folderWords();
    pickBtn.textContent = have && (have.games || have.scanned) ? "Another folder..." : "Pick the folder...";
    pickBtn.disabled = !have;
  });

  var parts = body.appendChild(section("What Xsegon sets up"));
  var ra = row("disc", "RetroArch and the cores", "RetroArch plays most consoles; each console needs a core, 1 to 30 MB, from libretro.");
  ra.appendChild(el("span", "su-note", !st.canGet ? "the one on this PC" : st.get.carried ? "came with Xsegon" : megabytes(st.get.bytes)));
  parts.appendChild(ra);
  parts.appendChild(switchRow("pictures", "image", "Names and box art", "Each game's name, year and box art, looked up once the games are in. Get Media > Get Pictures does it any time."));
  parts.appendChild(switchRow("self", "refresh", "Add new games by themselves", "Games you put in your games folder later come in when you come back to Xsegon. The ones it is not sure of wait for Games > Scan for Games."));
  var vRow = parts.appendChild(switchRow("videos", "film", "Videos", "A short video for each game Xsegon is sure of, from archive.org, free and with no account, after the names and pictures.",
    function () { return count() ? sizeWords(count() * VIDEO_MB) : "about 4 MB a game"; }));
  var cRow = parts.appendChild(switchRow("cheats", "wand", "Cheat lists", "For a game's Cheats tab, from libretro. None is turned on by itself.",
    function () { return offers.cheats ? offers.cheats.mb + " MB" : ""; }));
  parts.appendChild(switchRow("runs", "check", "Check which games start", "Each game is opened for a few seconds to see that it starts. It goes last, and Emulators > Runs check does it any time.",
    function () { return count() ? timeWords(count() * GAME_SECS) : ""; }));
  var all = parts.appendChild(el("div", "su-all"));
  [["All on", true], ["All off", false]].forEach(function (b) {
    var btn = el("button", null, b[0]);
    btn.type = "button";
    btn.addEventListener("click", function () { Object.keys(on).forEach(function (k) { on[k] = b[1]; }); sound("move"); paint(); });
    all.appendChild(btn);
  });
  paints.push(function () {
    vRow.hidden = !offers.videos;
    cRow.hidden = !offers.cheats;
  });

  var bar = inner.appendChild(el("div", "su-bar"));
  var goBtn = el("button", null, "Set it up");
  goBtn.type = "button";
  goBtn.addEventListener("click", setItUp);
  var handBtn = el("button", null, "Set up by hand");
  handBtn.type = "button";
  handBtn.addEventListener("click", function () { gone = true; L("SETUP", "setup window: set up by hand"); byHand(); });
  bar.appendChild(goBtn);
  bar.appendChild(handBtn);
  paints.push(function () { goBtn.disabled = !have; });

  $editor.textContent = "";
  $editor.dataset.tool = "setup";
  $editor.appendChild(inner);
  $editor.hidden = false;
  win = inner;
  setEditorOnClose(function () {
    win = null;
    paints = [];
    delete $editor.dataset.tool;
    if (!gone) {
      L("SETUP", "setup window closed with nothing set up");
      showStrip("Nothing was set up. Help > Getting started has every step whenever you are ready.", false);
    }
  });
  paint();
  gamesKnown(st).then(function (h) { have = h; paint(); });
}
