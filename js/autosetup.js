/*  Set it all up: the one yes at the top of Getting started. Three presses at most:
 *  the button, the games folder (closing that window starts nothing), and with the
 *  games in, whether to run the games check (js\setuplist.js asks it). js\setup.js
 *  keeps the guide and the by-hand offers. A new copy's first start asks the same
 *  as short questions, one at a time (js\askcards.js).
 */

import { askCard } from "./askcards.js";
import { closeEditor, reloadKeeping } from "./editors.js";
import { fillWatch } from "./fillbar.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { noGamesFound } from "./nofound.js";
import { noGamesAsking, openGamesFolder } from "./nogames.js";
import { saveSetting } from "./savednote.js";
import { pickWindowsFolder } from "./scan.js";
import { quietDone, watchSetup, watchUp } from "./setupbar.js";
import { runAsking, runBegun, runPoke } from "./setuplist.js";
import { sound } from "./sound.js";
import { S, games, sel } from "./state.js";
import { megabytes, plural } from "./util.js";

function post(body) {
  return postJson("api/setup.php", body);
}

/*  Pressed in Getting started. The guide closes itself (it is the by-hand
    road); the folder is asked for unless games are here already or in the
    Games folder Xsegon made, and nothing is fetched until it is answered.
    cards: the yes was the first start's question, and the folder is asked
    as short questions too. */
export function startAuto(st, cards) {
  L("SETUP", "set it all up pressed" + (cards ? " (the first start's question)" : ""));
  gamesKnown(st).then(function (have) {
    sound("select");
    closeEditor();
    if (!cards) { if (have.ask) { folderFirst(st, have); } else { beginAuto(st, have); } return; }
    if (have.scanned) { askSelf(have.where, function () { beginAuto(st, have); }); return; }
    if (have.ask || !have.games) { askWhere(st, have); return; }
    askHere(st, have);
  });
}

/*  Whether new games come in by themselves later (js\newgames.js), asked once
    the folder is known; then(yes) goes on with the setup either way. No answer
    is no: nothing is added later unasked. */
function askSelf(where, then) {
  askCard({ title: "Add new games by themselves?", yes: "Yes", no: "No",
    lines: [["When you put more games in " + (where || "your games folder") + ", they come in when you come back to Xsegon."],
            ["The ones Xsegon is not sure of wait for Games > Scan for Games.", "faint"]],
    onYes: function () { keepSelf(true); then(true); },
    onNo: function () { keepSelf(false); then(false); } });
}

function keepSelf(on) {
  L("SETUP", "first start: new games by themselves, " + (on ? "yes" : "no"));
  S.library = Object.assign({}, S.library, { addNewGames: on });
  saveSetting({ library: { addNewGames: on } }, "Add new games by themselves");
}

/*  A new copy's first start, while Set it all up is on offer: one question,
    and "Set up by hand" is the guide as it always was. The caller hands over
    the guide's opener, so this file never imports js\setup.js. No answer starts nothing. */
export function firstCards(st, byHand) {
  L("SETUP", "first start: asked to set everything up");
  askCard({ title: "Set everything up for you?", yes: "Yes", no: "Set up by hand",
    lines: [["RetroArch, the cores your consoles need, and your games' names and pictures."], [sizeLine(st), "faint"]],
    onYes: function () { startAuto(st, true); },
    onNo: function () { L("SETUP", "first start: set up by hand"); byHand(); },
    onAway: function () {
      L("SETUP", "first start: the question was closed with no answer");
      showStrip("Nothing was set up. Help > Getting started has every step whenever you are ready.", false);
    } });
}

// What the yes downloads, in one line.
function sizeLine(st) {
  var cores = "The cores are 1 to 30 MB each, from libretro.";
  if (!st.canGet) { return "It uses the RetroArch at " + st.retroarch.exe + ". " + cores; }
  if (st.get.carried) { return "RetroArch came with Xsegon. " + cores; }
  return "RetroArch is " + megabytes(st.get.bytes) + " from libretro. " + cores;
}

/* Games are in a folder Xsegon already looks in: that one is offered. */
function askHere(st, have) {
  L("SETUP", "first start: are your games in " + have.where + " (" + plural(have.games, "game", "games") + ")");
  askCard({ title: "Are your games here?", big: have.where, yes: "Yes", no: "No",
    lines: [[plural(have.games, "game", "games") + " found."]],
    onYes: function () { L("SETUP", "first start: yes, the games are there"); askSelf(have.where, function () { beginAuto(st, have); }); },
    onNo: function () { L("SETUP", "first start: no, not there"); askWhere(st, have); },
    onAway: notStarted });
}

/* No folder with games yet: the Windows folder window, or the folder to put them in. */
function askWhere(st, have) {
  askCard({ title: "Where are your games?", yes: "Pick the folder", no: "I have none yet",
    lines: [["Choose the folder they are in. Folders inside it named after a console (nes, snes, n64...) work best."]],
    onYes: function () { folderFirst(st, have, true); },
    onNo: function () { noneYet(st, have); },
    onAway: notStarted });
}

/*  No games yet: everything else is set up now, and the card says where they
    go. They come in by themselves, or Scan for Games brings them (the empty screen has it). */
function noneYet(st, have) {
  L("SETUP", "first start: no games yet");
  var own = st.guide.folders.filter(function (f) { return f.there && f.made; })[0];
  askSelf(own ? own.path : "", function (self) {
    beginAuto(st, have, true);
    var then = self && own ? "They come in by themselves when you come back to Xsegon." : "Then press Scan for Games.";
    askCard({ title: own ? "Put your games here" : "Put your games in a folder", big: own ? own.path : "",
      yes: own ? "Open it" : null, no: "OK",
      lines: [[own ? "A folder for each console is already in it. " + then
                   : "A folder for each console works best (nes, snes, n64...). Then press Scan for Games and choose that folder."]],
      onYes: openGamesFolder });
  });
}

function notStarted() {
  L("SETUP", "set it all up ended: the question was closed with no answer");
  showStrip("Set it all up was not started. Help > Getting started has it whenever you are ready.", false);
}

/* Whether the folder has to be asked for, and how many games are in sight:
   scanned ones, or what a look through the folders already set finds (the
   Games folder Xsegon made counts once something is in it). */
function gamesKnown(st) {
  var g = st.guide;
  var there = g.folders.filter(function (f) { return f.there; });
  var own = there.some(function (f) { return f.made; });
  var where = there.map(function (f) { return f.path; }).join(", ");
  if (g.games) { return Promise.resolve({ ask: false, games: g.games, scanned: true, own: own, where: where }); }
  if (!there.length) { return Promise.resolve({ ask: true, games: 0, own: own, where: "" }); }
  showStrip("looking through your games folders...", false);
  return api("api/scan.php").then(function (r) {
    var n = r && r.ok ? (r.new || []).length : 0;
    // nothing in Xsegon's own folder yet: the person's games are somewhere else
    var ownOnly = there.length === 1 && there[0].made;
    return { ask: !n && ownOnly, games: n, own: own, where: where, scan: r && r.ok ? r : null };
  });
}

/* The one thing a person does: which folder the games are in. The plan is
   in the corner and the empty screen says the same. Closing the window
   without choosing ends the setup: nothing has been fetched or changed. */
function folderFirst(st, have, cards) {
  L("SETUP", "set it all up: the games folder is asked first");
  runAsking(true);
  noGamesAsking(true);
  pickWindowsFolder("Choose the folder your games are in").then(function (path) {
    if (!path) {
      runAsking(false);
      noGamesAsking(false);
      L("SETUP", "set it all up ended: the folder window was closed with nothing chosen");
      showStrip("Set it all up was not started: no folder was chosen. Help > Getting started has it whenever you are ready.", false);
      return;
    }
    postJson("api/scan.php", { action: "addFolder", path: path }).then(function (res) {
      // one already on the list (Xsegon's own Games folder, chosen by hand) is as good as added
      if (!res.ok && !/already on the list/.test(res.error || "")) {
        runAsking(false);
        noGamesAsking(false);
        noGamesFound({ folder: path, error: res.error || "it could not be added", own: have.own },
                     { pick: function () { folderFirst(st, have, cards); } });
        return;
      }
      L("SETUP", "games folder " + path + " (set it all up)");
      var go = function () { beginAuto(st, { own: have.own, where: path }); };
      if (cards) { askSelf(path, go); } else { go(); }
    });
  });
}

/* Everything starts: the yes is stored, RetroArch begins, and the games are
   scanned straight in. The Runs check is owed to nobody until its question
   has been answered ("ask"), so nothing opens by itself unasked.
   noScan: the person has no games yet, and nothing is looked for. */
function beginAuto(st, have, noScan) {
  post({ auto: true, runs: "ask" }).then(function (r) {
    if (!r.ok) { noGamesAsking(false); runAsking(false); showStrip("that could not be set up: " + (r.error || ""), true); return; }
    runBegun(!have.scanned && !noScan);
    if (r.error) { showStrip(r.error, true); }
    else if (r.started === "retroarch") { showStrip("downloading RetroArch in the background...", false); }
    else if (r.started === "cores") { showStrip("fetching the cores for your consoles in the background...", false); }
    else if (r.used) { showStrip("RetroArch at " + r.used + " now plays your consoles", false); }
    if (r.started && !watchUp()) { watchSetup(quietDone); }
    // the pictures pass now, not at the next status poll
    if (r.fill) { fillWatch(); }
    // scanned before: the POST above already fills, and the question comes now
    if (have.scanned) { noGamesAsking(false); runPoke(); return; }
    // no games yet: the empty screen says where they go and keeps Scan for Games
    if (noScan) { noGamesAsking(false); return; }
    // the empty screen keeps to one line until the games are on it
    noGamesAsking(true, "Looking for your games. Xsegon does the rest by itself.");
    autoScan(have.where, have.own, have.scan);
  });
}

/* The folder window from the no-games window's Choose another folder: a
   wrong folder is one more press, not a road back through the guide. */
function askFolder(own) {
  var again = { pick: function () { askFolder(own); } };
  pickWindowsFolder("Choose the folder your games are in").then(function (path) {
    if (!path) { noGamesFound({ folder: "", own: own }, again); return; }
    postJson("api/scan.php", { action: "addFolder", path: path }).then(function (res) {
      if (!res.ok) { noGamesFound({ folder: path, error: res.error || "it could not be added", own: own }, again); return; }
      L("SETUP", "games folder " + path + " (set it all up)");
      autoScan(path, own);
    });
  });
}

/* Scan and accept without the review screen, as Getting started says. Nothing found
   gets a window of its own (js\nofound.js) with a press for each way on; pictures
   start only from an accept that added games (api\scan.php). */
function autoScan(where, own, looked) {
  var again = { pick: function () { askFolder(own); }, rescan: function () { autoScan(where, own); } };
  (looked ? Promise.resolve(looked) : api("api/scan.php")).then(function (r) {
    if (!r || !r.ok || !(r.new || []).length) { noGamesAsking(false); }
    if (!r || !r.ok) { noGamesFound({ folder: where, error: (r && r.error) || "the scan did not answer", own: own }, again); return; }
    var offer = r.new || [];
    if (!offer.length && r.alreadyHave) {
      showStrip("every game there is in your library already", false);
      return;
    }
    if (!offer.length) { noGamesFound({ folder: where, scan: r, own: own }, again); return; }
    postJson("api/scan.php", { action: "accept", games: offer }).then(function (a) {
      if (!a.ok) { noGamesAsking(false); showStrip("the games could not be added: " + (a.error || ""), true); return; }
      // the wall is read again below and the empty screen goes with it
      setTimeout(function () { noGamesAsking(false); }, 3000);
      L("SETUP", "scanned in by itself: " + a.added + " games");
      sound("ok");
      var line = "added " + a.added + (a.added === 1 ? " game" : " games");
      // (with RetroArch still downloading, its done handler fetches the
      // cores and the watch says so; no claim is made here)
      if (a.auto && a.auto.cores && a.auto.cores.length) {
        line += "  ·  fetching " + (a.auto.cores.length === 1 ? "the " + a.auto.cores[0] + " core" : a.auto.cores.length + " cores");
      }
      if (a.auto && a.auto.fill) { line += ", looking up names and pictures"; }
      showStrip(line, false);
      if (a.auto && a.auto.cores && a.auto.cores.length && !watchUp()) { watchSetup(quietDone); }
      // a short pass could end between status polls and never show its bar
      if (a.auto && a.auto.fill) { fillWatch(); }
      // the wall behind the bars shows the new games now
      reloadKeeping(games[sel] ? games[sel].id : null);
      // and with games to speak of, the one question is asked at once
      runPoke();
    });
  });
}
