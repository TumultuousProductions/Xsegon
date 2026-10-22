/*  Get Media > Steam trailers (includes\steamvid.php).
 *
 *  The Steam games with no video, all selected. Fetch asks first, in the
 *  same window as the RetroArch downloads, then the trailers come down in
 *  the background while this screen shows each game's progress. A game that
 *  has a video is not listed, except as saved while its fetch runs.
 *  One a fetch found no trailer for is listed apart, folded away, and can be
 *  selected there to ask again.
 */

import { confirmWindow } from "./confirm.js";
import { closeEditor, reloadKeeping, setEditorOnClose } from "./editors.js";
import { jobSayOnce, jobsWatch } from "./jobbars.js";
import { showStrip } from "./launch.js";
import { L, api, logWarn, postJson } from "./log.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor, games, sel } from "./state.js";
import { el } from "./util.js";

var WORDS = {
  waiting: "waiting", asking: "asking Steam...", fetching: "downloading...", done: "saved",
  none: "no trailer on Steam", stream: "Steam only streams this one", failed: "could not be fetched"
};
var showTried = false;      // the games with no trailer before are shown, while the page is up

export function openSteamTrailers() {
  L("ED", "steam trailers");
  stopVideo();
  setEditorOnClose(null);
  var inner = el("div", "panel-inner ed-inner sv st");
  var head = el("div", "set-head");
  head.appendChild(el("h1", "panel-title", "STEAM TRAILERS"));
  var done = el("button", "primary", "Done (esc)");
  done.addEventListener("click", closeEditor);
  head.appendChild(done);
  inner.appendChild(head);
  var intro = el("p", "group-help", "reading...");
  inner.appendChild(intro);
  var bar = el("div", "sv-bar");
  inner.appendChild(bar);
  // Both lists in one area that scrolls in what the rest of the window leaves.
  var scroll = el("div", "st-scroll");
  var rows = el("div", "sc-rows sv-rows");
  scroll.appendChild(rows);
  var apart = el("div", "st-apart");
  var apartHead = el("div", "st-apart-head");
  var apartWords = el("div", "st-apart-words");
  var apartName = el("span", "pj-job");
  apartWords.appendChild(apartName);
  apartWords.appendChild(el("span", "pj-hint", "A fetch got no trailer for these, each says why, so they are kept apart. Select one to ask Steam again."));
  apartHead.appendChild(apartWords);
  var fold = el("button", null, showTried ? "Hide" : "Show");
  fold.type = "button";
  fold.addEventListener("click", function () {
    showTried = !showTried;
    tried.hidden = !showTried;
    fold.textContent = showTried ? "Hide" : "Show";
    sound("select");
  });
  apartHead.appendChild(fold);
  apart.appendChild(apartHead);
  var tried = el("div", "sc-rows sv-rows st-tried");
  tried.hidden = !showTried;
  apart.appendChild(tried);
  scroll.appendChild(apart);
  inner.appendChild(scroll);
  $editor.textContent = "";
  $editor.appendChild(inner);
  $editor.hidden = false;
  done.focus();

  var ticks = [];
  var watching = false;

  function paint(r) {
    if (!inner.isConnected) { return; }
    if (!r || !r.ok) {
      // Never left on "reading..." with nothing said.
      intro.textContent = "Could not read the trailers' state: " + ((r && r.error) || "the server did not answer") + ".";
      return;
    }
    var job = r.job, running = job && job.state === "running";
    var states = {};
    ((job && job.games) || []).forEach(function (g) { states[g.id] = g.state; });
    if (!r.games.length) {
      intro.textContent = "No Steam games in the library. Games > Add Steam games brings them in.";
      return;
    }
    var got = ((job && job.games) || []).filter(function (g) { return g.state === "done"; }).length;
    var nTried = r.games.filter(function (g) { return g.tried; }).length;
    var one = nTried === 1;
    // Every game with no video may be in the list apart: then nothing above it is on offer.
    intro.textContent = running
      ? "Fetching " + job.games.length + " trailers in the background: " + got + " saved so far. You can close this; they carry on."
      : !r.missing ? (r.games.length === 1 ? "Your Steam game has a video." : "All " + r.games.length + " Steam games have a video.")
      : nTried === r.missing ? (one ? "The one Steam game with no video" : "The " + nTried + " Steam games with no video") +
        " got no trailer when fetched before, so " + (one ? "it is" : "they are") + " listed apart below."
      : r.missing + " of " + r.games.length + " Steam games have no video. Steam has a trailer for most games; each plays as that game's video snap." +
        (nTried ? " " + nTried + " of them got no trailer when fetched before and " + (one ? "is" : "are") + " listed apart below." : "");
    bar.textContent = "";
    ticks = [];
    var top = scroll.scrollTop;          // a progress tick redraws the rows, and must not scroll back to the top
    rows.textContent = "";
    tried.textContent = "";
    r.games.forEach(function (g) {
      // One with a video is never offered; while its fetch runs it stays, to show it saved.
      if (g.has && !(running && states[g.id])) { return; }
      var line = el("label", "sc-row sv-row" + (g.has ? " has" : ""));
      var box = el("input");
      box.type = "checkbox";
      box.value = g.id;
      box.checked = !g.has && !g.tried && !running && !(states[g.id] && states[g.id] !== "waiting");
      box.disabled = g.has || running;
      if (!g.has) { ticks.push(box); }
      line.appendChild(box);
      line.appendChild(el("span", "sc-title", g.title));
      var st = states[g.id] || g.tried;
      var note = g.has ? (g.trailer ? "trailer saved" : "has a video already") : (st ? WORDS[st] || st : "");
      // The day of that answer: Steam adds trailers now and then, so an old one is worth asking again.
      if (!g.has && g.tried && g.triedAt && st === g.tried) {
        note += ", asked " + new Date(g.triedAt * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      }
      line.appendChild(el("span", "sc-rom sv-state" + (st === "done" ? " ok" : (st === "none" || st === "stream" || st === "failed") ? " off" : ""), note));
      (g.tried ? tried : rows).appendChild(line);
    });
    rows.hidden = !rows.children.length;
    apart.hidden = !nTried;
    apartName.textContent = "Got no trailer before (" + nTried + ")";
    scroll.scrollTop = top;
    if (!running && ticks.length) {
      var go = el("button", "primary", "Fetch trailers...");
      go.addEventListener("click", function () { ask(r); });
      bar.appendChild(go);
      var some = function () { go.disabled = !ticks.some(function (x) { return x.checked; }); };
      some();
      ticks.forEach(function (t) { t.addEventListener("change", some); });
    }
    if (running && !watching) { watch(); }
  }

  function ask(r) {
    var ids = ticks.filter(function (t) { return t.checked; }).map(function (t) { return t.value; });
    if (!ids.length) { return; }
    confirmWindow("Fetch " + ids.length + (ids.length === 1 ? " trailer?" : " trailers?"), function (box) {
      box.appendChild(el("p", null, "Each game's highlighted trailer from its Steam store page, at full quality."));
      box.appendChild(el("p", "confirm-game", "About 50 MB each, so up to about " + (Math.round(ids.length * 50 / 102.4) / 10) + " GB"));
      box.appendChild(el("p", "confirm-note", "From: Steam's store (store.steampowered.com)"));
      box.appendChild(el("p", "confirm-note", "Into: " + r.dir));
      box.appendChild(el("p", "confirm-note", "A trailer Steam only streams is saved as one file, its pieces joined on this PC."));
      box.appendChild(el("p", "confirm-safe", "A game that already has a video keeps it. Backups leave these out; they can be fetched again."));
    }, { label: "Fetch", run: function () {
      L("STEAMV", "fetch " + ids.length);
      postJson("api/steamvid.php", { ids: ids }).then(function (res) {
        if (!res.ok) { showStrip("trailers not fetched: " + (res.error || ""), true); return; }
        showStrip("fetching " + res.count + " trailers in the background: the bar in the corner shows how far it is", false);
        closeEditor();                  // nothing more to do here: Done would be an extra press
        jobsWatch("steamvid");
      });
    } });
  }

  function watch() {
    watching = true;
    var misses = 0;
    (function tick() {
      api("api/steamvid.php").then(function (r) {
        // The server is busy downloading trailers, so a missed read is expected;
        // giving up on one would freeze the rows while the job carries on.
        if (!r || !r.ok) {
          if (++misses <= 10) { setTimeout(tick, 3000); return; }
          watching = false;
          logWarn("the trailer watch gave up after 10 missed reads; the fetch carries on by itself");
          if (inner.isConnected) { intro.textContent = "Lost sight of the fetch; it carries on by itself. Close and reopen this screen to catch up."; }
          return;
        }
        misses = 0;
        var running = r.job && r.job.state === "running";
        if (inner.isConnected) { paint(r); }
        if (running) { setTimeout(tick, 1500); return; }
        watching = false;
        if (r.job) {
          var saved = r.job.games.filter(function (g) { return g.state === "done"; }).length;
          // The library is read again so the new trailers play without a reload,
          // keeping the game that is chosen now.
          if (saved) { reloadKeeping(games[sel] ? games[sel].id : null); }
          if (jobSayOnce("steamvid", r.job.started)) {      // once, whoever sees the end first (js/jobbars.js)
            sound("ok");
            showStrip(r.job.state === "failed" ? "trailers stopped: " + (r.job.error || "") : saved + " Steam trailers saved", r.job.state === "failed");
          }
        }
      });
    })();
  }

  function read() { api("api/steamvid.php").then(paint); }
  read();
}
