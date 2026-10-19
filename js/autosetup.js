/*  Set it all up: what the setup window's one press starts (js\setupwin.js asks
 *  everything first: the games folder and a switch for each part). Then nothing
 *  more is asked: RetroArch and the cores come, the games are scanned straight in,
 *  and what was switched on follows. js\setup.js keeps the guide and the by-hand offers.
 */

import { reloadKeeping } from "./editors.js";
import { fillWatch } from "./fillbar.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { noGamesFound } from "./nofound.js";
import { noGamesAsking } from "./nogames.js";
import { pickWindowsFolder } from "./scan.js";
import { quietDone, watchSetup, watchUp } from "./setupbar.js";
import { runAsking, runBegun, runPoke } from "./setuplist.js";
import { sound } from "./sound.js";
import { games, sel } from "./state.js";

function post(body) {
  return postJson("api/setup.php", body);
}

/* Whether the folder has to be asked for, and how many games are in sight:
   scanned ones, or what a look through the folders already set finds (the
   Games folder Xsegon made counts once something is in it). */
export function gamesKnown(st) {
  var g = st.guide;
  var there = g.folders.filter(function (f) { return f.there; });
  var own = there.some(function (f) { return f.made; });
  var where = there.map(function (f) { return f.path; }).join(", ");
  if (g.games) { return Promise.resolve({ ask: false, games: g.games, scanned: true, own: own, where: where }); }
  if (!there.length) { return Promise.resolve({ ask: true, games: 0, own: own, where: "" }); }
  return api("api/scan.php").then(function (r) {
    var n = r && r.ok ? (r.new || []).length : 0;
    // nothing in Xsegon's own folder yet: the person's games are somewhere else
    var ownOnly = there.length === 1 && there[0].made;
    return { ask: !n && ownOnly, games: n, own: own, where: where, scan: r && r.ok ? r : null };
  });
}

/* Everything starts: the yes is stored with what the window switched on
   (answers: runs, videos, cheats, pictures), RetroArch begins, and the games
   are scanned straight in. noScan: the person has no games yet, and nothing is looked for. */
export function beginAuto(st, have, answers, noScan) {
  post(Object.assign({ auto: true }, answers)).then(function (r) {
    if (!r.ok) { noGamesAsking(false); runAsking(false); showStrip("that could not be set up: " + (r.error || ""), true); return; }
    runBegun(!have.scanned && !noScan);
    if (r.error) { showStrip(r.error, true); }
    // The copy the package carries is unpacked, not downloaded (st.get.carried, as the setup window says).
    else if (r.started === "retroarch") { showStrip(st && st.get && st.get.carried ? "setting up the RetroArch that came with Xsegon in the background..." : "downloading RetroArch in the background...", false); }
    else if (r.started === "cores") { showStrip("fetching the cores for your consoles in the background...", false); }
    else if (r.used) { showStrip("RetroArch at " + r.used + " now plays your consoles", false); }
    if (r.started && !watchUp()) { watchSetup(quietDone); }
    // the pictures pass now, not at the next status poll
    if (r.fill) { fillWatch(); }
    // scanned before: the POST above already fills; a folder added in the setup window still brings its own new games
    if (have.scanned) {
      noGamesAsking(false);
      runPoke();
      if (have.added && have.added.length) { autoScan(have.where, have.own, null, have.added); }
      return;
    }
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
function autoScan(where, own, looked, only) {
  var again = { pick: function () { askFolder(own); }, rescan: function () { autoScan(where, own); } };
  (looked ? Promise.resolve(looked) : api("api/scan.php")).then(function (r) {
    // only: folders added to a library that has games; their new games alone come in, the rest stay for Scan for Games
    if (only && r && r.ok) {
      var inside = function (rom) {
        var p = String(rom || "").toLowerCase().replace(/\//g, "\\");
        return only.some(function (f) { return p.indexOf(String(f).toLowerCase().replace(/\//g, "\\").replace(/\\+$/, "") + "\\") === 0; });
      };
      r = Object.assign({}, r, { "new": (r.new || []).filter(function (g) { return inside(g.rom); }) });
      L("SETUP", r.new.length + " new games in the folder added in the setup window");
      if (!r.new.length) { showStrip("no new games in " + only.join(", "), false); return; }
    }
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
      // and the Setting up list reads the games now, not at its next tick
      runPoke();
    });
  });
}
