/*  Games > Add Steam games (api\steam.php, includes\steam.php).
 *
 *  Every game Steam has installed, as a list to select. Each becomes a game of
 *  your own under Steam, with the pictures Steam keeps for it; the Games
 *  Database fills in the rest. Play starts it through Steam; Play without Steam
 *  starts its own program, for when the internet is down. What is here already
 *  is not listed; selecting one again only fills in what it still misses.
 */

import { closeEditor, reloadKeeping, setEditorOnClose, toolFrame } from "./editors.js";
import { jobBar } from "./jobbars.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor, $settings, games, hasGamesDb, sel } from "./state.js";
import { el } from "./util.js";
import { waitBar } from "./waitbar.js";

var GROUPS = [
  { kind: "game", title: "Games" },
  { kind: "demo", title: "Demos and playtests" },
  { kind: "tool", title: "Not games", note: "Steam calls these a tool or an application. Left unselected." },
  { kind: "none", title: "Not installed", note: "Steam still lists these, but their folder is not there." },
];
var SLOT_WORDS = { box: "cover", logo: "logo", fanart: "background", shot: "screenshot" };

export function openSteamTool(onBack) {
  L("ED", "steam tool");
  stopVideo();
  var changed = false;
  var showHere = false;

  // In the library and linked to its Steam app: nothing is left to add.
  function isHere(app) { return !!(app.have && app.have.linked); }

  function shell() { return toolFrame("ADD STEAM GAMES", { before: onBack ? [{ label: "‹ Back", run: function () { onBack(); } }] : [] }); }

  function show(inner) {
    $editor.textContent = "";
    $editor.appendChild(inner);
  }

  // What a row says about itself before anything is done.
  function describe(app) {
    var bits = [];
    bits.push(app.pictures.length
      ? "Steam has its " + app.pictures.map(function (k) { return SLOT_WORDS[k] || k; }).join(", ")
      : "no pictures in Steam's cache");
    if (app.kind !== "none") { bits.push(app.direct ? "plays without Steam too" : "Steam only"); }
    if (app.have) {
      bits.unshift(app.have.linked ? "here already" : "here already as " + app.have.title + ", not yet linked to Steam");
    }
    return bits.join("  ·  ");
  }

  function paint() {
    var waiting = shell();
    var reading = el("p", "group-help", "Reading Steam's list of installed games...");
    waiting.appendChild(reading);
    show(waiting);
    $editor.hidden = false;

    return waitBar(reading, "Reading Steam's games", api("api/steam.php")).then(function (res) {
      if ($editor.dataset.tool !== "steam") { return; }
      list(res);
    });
  }

  function list(res) {
    var inner = shell();
    if (!res.ok) {
      inner.appendChild(el("p", "mt-note bad", "Could not read Steam: " + (res.error || "the server did not answer")));
      show(inner);
      return;
    }
    if (!res.found) {
      inner.appendChild(el("p", "mt-note bad", res.why));
      show(inner);
      return;
    }
    inner.appendChild(el("p", "group-help",
      "Every game Steam has installed, ready to add as a game of your own under Steam. Each one gets the " +
      "pictures Steam keeps for it" + (hasGamesDb ? ", and the LaunchBox Games Database fills in what Steam does not have: the " +
      "details (genre, year, description, players) and any missing picture" : "") + ". Play starts a game through Steam; " +
      "right-click > Play without Steam starts its own program, for when the internet is down. Only empty " +
      "fields and empty picture slots are filled, and Steam's folders are only read."));
    var c = res.counts;
    inner.appendChild(el("p", "group-help",
      "Steam has " + c.game + (c.game === 1 ? " game" : " games") + ", " + c.demo + (c.demo === 1 ? " demo or playtest" : " demos and playtests") +
      (c.tool ? ", " + c.tool + " that " + (c.tool === 1 ? "is" : "are") + " not a game" : "") +
      "  ·  from " + res.steam));
    if (!res.steamExe) {
      inner.appendChild(el("p", "mt-note warn", "steam.exe is not in that folder, so these will start by their own program instead of through Steam."));
    }
    var here = res.apps.filter(isHere);
    var shown = res.apps.filter(function (a) { return showHere || !isHere(a); });
    L("ED", "steam list: " + shown.length + " listed, " + here.length + " here already" + (showHere ? ", shown" : ", not listed"));
    if (here.length) {
      var gone = el("p", "group-help st-here", here.length + (here.length === 1 ? " is" : " are") + " here already and " +
        (showHere ? "listed below, unselected. Selecting one again only fills in a picture or a detail it is still missing. " : "not listed. "));
      var flip = el("button", null, showHere ? "Hide them" : "Show them");
      flip.addEventListener("click", function () {
        showHere = !showHere;
        sound("select");
        list(res);
      });
      gone.appendChild(flip);
      inner.appendChild(gone);
    }
    if (!shown.some(function (a) { return a.kind === "game" || a.kind === "demo"; })) {
      inner.appendChild(el("p", "mt-note good", "Every game Steam has installed is here already. Nothing new to add."));
    }

    var picks = [];
    GROUPS.forEach(function (grp) {
      var apps = shown.filter(function (a) { return a.kind === grp.kind; });
      if (!apps.length) { return; }
      var head = el("div", "sc-head");
      head.appendChild(el("b", null, grp.title));
      head.appendChild(el("span", "sc-tag", apps.length + (grp.note ? "  ·  " + grp.note : "")));
      inner.appendChild(head);
      var rows = el("div", "sc-rows");
      apps.forEach(function (app) {
        var rowEl = el("div", "sc-row fl-row st-app");
        rowEl.dataset.app = app.id;
        var box = el("input"); box.type = "checkbox";
        // Selected: every game and demo not linked yet, a game added by hand
        // included (it gets its pictures and both ways to start). Not: what
        // is linked already, what is not a game, what is not there.
        box.checked = (app.kind === "game" || app.kind === "demo") && !(app.have && app.have.linked);
        box.disabled = app.kind === "none";
        var lab = el("label");
        lab.appendChild(box);
        lab.appendChild(el("span", "sc-title", " " + app.name));
        rowEl.appendChild(lab);
        rowEl.appendChild(el("span", "fl-match" + (app.pictures.length ? "" : " warn"), describe(app)));
        var result = el("span", "fl-result");
        rowEl.appendChild(result);
        rows.appendChild(rowEl);
        picks.push({ box: box, app: app, result: result });
      });
      inner.appendChild(rows);
    });

    var opts = el("div", "fl-opts");
    function opt(words) {
      var lab = el("label");
      var box = el("input"); box.type = "checkbox"; box.checked = true;
      lab.appendChild(box);
      lab.appendChild(document.createTextNode(" " + words));
      opts.appendChild(lab);
      opts.appendChild(el("br"));
      return box;
    }
    var wantDetails = opt("Details from the Games Database: genre, year, description, players");
    var wantPics = opt("Pictures from the Games Database for what Steam does not have (one download each)");
    inner.appendChild(opts);

    var btns = el("div", "art-btns");
    var all = el("button", null, "Select all games");
    all.addEventListener("click", function () {
      picks.forEach(function (p) { if (p.app.kind === "game" || p.app.kind === "demo") { p.box.checked = true; } });
    });
    var none = el("button", null, "Deselect all");
    none.addEventListener("click", function () { picks.forEach(function (p) { p.box.checked = false; }); });
    var go = el("button", "primary", "Add the selected games");
    var summary = el("span", "mt-note");
    go.addEventListener("click", function () {
      var todo = picks.filter(function (p) { return p.box.checked && !p.box.disabled; });
      if (!todo.length) { showStrip("nothing is selected", true); return; }
      L("ED", "steam add " + todo.length);
      go.disabled = true;
      var added = 0, updated = 0, pics = 0, failed = 0, firstWhy = "";
      /* The window closes itself and the bar in the corner counts them: a
         hundred games is minutes. What each game got is in the log; the strip
         says the sum, and why the first one that failed did. */
      showStrip("adding " + todo.length + (todo.length === 1 ? " Steam game" : " Steam games") + " in the background: the bar in the corner shows how far it is", false);
      closeEditor();
      function corner(i, over) {
        jobBar({ key: "steamadd", name: "Add Steam games", state: over ? (failed && !added && !updated ? "failed" : "done") : "running",
                 line: over ? "" : (i + 1) + " of " + todo.length + ": " + todo[i].app.name, frac: i / todo.length, stop: false });
      }
      // The library read again once nothing is over it: this window's own closing is long past.
      function reread() {
        if (!$editor.hidden || !$settings.hidden) { setTimeout(reread, 1000); return; }
        reloadKeeping(games[sel] ? games[sel].id : null);
      }
      // One game per request, in turn: this server answers one request at a
      // time, and a picture from the database is a download, so the bar
      // shows each game finishing rather than one long wait.
      function next(i) {
        if (i >= todo.length) {
          go.disabled = false;
          go.textContent = "Add the selected games";
          summary.textContent = "Done: " + added + " added, " + updated + " brought up to date, " + pics +
                                (pics === 1 ? " picture" : " pictures") + (failed ? ", " + failed + " failed" : "") + ".";
          L("ED", "steam add over: " + summary.textContent);
          showStrip("Steam: " + added + " added" + (updated ? ", " + updated + " brought up to date" : "") +
                    (failed ? ", " + failed + " not: " + firstWhy : ""), failed > 0 && !added && !updated);
          sound("select");
          corner(i, true);
          if (added || updated) { reread(); }
          return;
        }
        var p = todo[i];
        corner(i);
        go.textContent = "Adding " + (i + 1) + " of " + todo.length + "...";
        p.result.textContent = "adding...";
        p.result.className = "fl-result";
        postJson("api/steam.php", { app: p.app.id, details: wantDetails.checked, pictures: wantPics.checked })
          .then(function (r) {
            if (!r.ok) {
              failed++;
              if (!firstWhy) { firstWhy = p.app.name + ", " + (r.error || "no reason given"); }
              L("ED", "steam add: " + p.app.name + " was not added: " + (r.error || "no reason given"));
              p.result.textContent = r.error || "failed";
              p.result.className = "fl-result bad";
              next(i + 1);
              return;
            }
            if (r.added) { added++; } else { updated++; }
            var steamPics = Object.keys(r.pictures).filter(function (k) { return r.pictures[k] === "steam"; });
            var dbPics = Object.keys(r.pictures).filter(function (k) { return r.pictures[k] === "database"; });
            pics += steamPics.length + dbPics.length;
            var bits = [r.added ? "added" : (r.linked ? "linked to Steam" : "brought up to date")];
            if (steamPics.length) { bits.push(steamPics.length + " from Steam"); }
            if (dbPics.length) { bits.push(dbPics.length + " from the database"); }
            if (r.filled.length) { bits.push(r.filled.length + (r.filled.length === 1 ? " detail" : " details")); }
            p.result.textContent = bits.join(", ");
            L("ED", "steam add: " + p.app.name + ": " + bits.join(", "));
            p.result.className = "fl-result good";
            p.box.checked = false;
            p.app.have = { id: r.id, title: r.title, linked: true, pictures: [] };
            next(i + 1);
          });
      }
      next(0);
    });
    btns.appendChild(all);
    btns.appendChild(none);
    btns.appendChild(go);
    btns.appendChild(summary);
    inner.appendChild(btns);
    show(inner);
  }

  $editor.dataset.tool = "steam";
  setEditorOnClose(function () {
    delete $editor.dataset.tool;
    // A hundred games may have arrived under the page: read it again.
    if (changed) { reloadKeeping(games[sel] ? games[sel].id : null); }
  });
  paint().then(function () { sound("select"); });
}
