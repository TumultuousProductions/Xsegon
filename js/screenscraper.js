/*  Pictures & Videos > ScreenScraper videos (includes\screenscraper.php).
 *
 *  Every game with no video, by console, and the logins ScreenScraper wants
 *  (kept on this computer, never shown back). Fetch asks first, then the snaps
 *  come down in the background. A game that has a video is not listed, except
 *  as saved while its fetch runs. One a fetch found no video for is listed
 *  apart, folded away, and can be selected there to ask again.
 */

import { confirmWindow } from "./confirm.js";
import { closeEditor, reloadKeeping, setEditorOnClose } from "./editors.js";
import { jobSayOnce, jobsWatch } from "./jobbars.js";
import { showStrip } from "./launch.js";
import { L, api, logWarn, postJson } from "./log.js";
import { skraperRoute } from "./skraper.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor, games, sel } from "./state.js";
import { el } from "./util.js";

var WORDS = {
  waiting: "waiting", asking: "asking ScreenScraper...", fetching: "downloading...", done: "saved",
  none: "not found on ScreenScraper", novideo: "ScreenScraper has no video of it", failed: "could not be fetched"
};
// The developer ID is Xsegon's own (includes\screenscraper.php), so only the member's login is asked.
var FIELDS = [
  ["user", "Member name", "text"], ["password", "Member password", "password"]
];
var showTried = false;      // the games with no video before are shown, while the page is up

export function openScreenScraper() {
  L("ED", "screenscraper videos");
  stopVideo();
  setEditorOnClose(null);
  var inner = el("div", "panel-inner ed-inner sv ss");
  var head = el("div", "set-head");
  head.appendChild(el("h1", "panel-title", "SCREENSCRAPER VIDEOS"));
  var done = el("button", "primary", "Done (esc)");
  done.addEventListener("click", closeEditor);
  head.appendChild(done);
  inner.appendChild(head);
  var intro = el("p", "group-help", "reading...");
  inner.appendChild(intro);
  var acct = el("div", "ss-acct");
  inner.appendChild(acct);
  var bar = el("div", "sv-bar ss-bar");
  inner.appendChild(bar);
  // On a PC with the Skraper helper the selected games can go through Skraper
  // instead, with no logins (js\skraper.js); elsewhere this adds nothing.
  var skr = skraperRoute(inner, function () { return ticked().map(function (t) { return t.value; }); },
    function () { paintBar(); });
  // Both lists in one area that scrolls in what the rest of the window leaves.
  var scroll = el("div", "st-scroll");
  var rows = el("div", "sc-rows sv-rows");
  scroll.appendChild(rows);
  var apart = el("div", "st-apart");
  apart.hidden = true;
  var apartHead = el("div", "st-apart-head");
  var apartWords = el("div", "st-apart-words");
  var apartName = el("span", "pj-job");
  apartWords.appendChild(apartName);
  apartWords.appendChild(el("span", "pj-hint", "A fetch found no video for these, each says why, so they are kept apart. Select one to ask ScreenScraper again."));
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

  var last = null;        // the newest answer
  var lines = {};         // game id -> { box, note, row }
  var shape = "";         // which rows are drawn, so a progress tick only fills them in
  var ticks = [];
  var go = null;
  var watching = false;
  var editing = false;

  function post(body) {
    return postJson("api/screenscraper.php", body);
  }
  function isRunning(r) { return !!(r.job && r.job.state === "running"); }
  function ticked() { return ticks.filter(function (t) { return t.checked; }); }

  // ---- the logins ----
  function paintAccount(a, check) {
    acct.textContent = "";
    inner.classList.toggle("ss-typing", !a.ready || editing);   // the boxes take room the list gives up
    var note = null;
    if (check) {
      note = el("p", "ss-note " + (check.ok ? "ok" : "bad"), check.ok
        ? "ScreenScraper accepted the login: " + check.today + " of " + check.max + " requests used today."
        : "Not accepted: " + check.error + ".");
    }
    if (a.ready && !editing) {
      acct.appendChild(el("p", "ss-who", "ScreenScraper login stored: member " + a.user + "."));
      var btns = el("div", "ss-btns");
      [["Check the login", function () { send({ check: true }, "asking ScreenScraper..."); }],
       ["Change...", function () { editing = true; paintAccount(a, null); }],
       ["Forget", function () { send({ forget: true }, "forgetting..."); }]].forEach(function (b) {
        var btn = el("button", null, b[0]);
        btn.type = "button";
        btn.addEventListener("click", b[1]);
        btns.appendChild(btn);
      });
      acct.appendChild(btns);
      if (note) { acct.appendChild(note); }
      return;
    }
    acct.appendChild(el("p", "group-help",
      "ScreenScraper asks for a member account, free at screenscraper.fr: type its name and password here. " +
      "They are kept in data\\screenscraper.json on this computer, and never go into a backup, a problem report or the log."));
    var form = el("div", "ss-form");
    var inputs = {};
    FIELDS.forEach(function (f) {
      var id = "ss-" + f[0];
      var label = el("label", null, f[1]);
      label.htmlFor = id;
      var input = el("input");
      input.type = f[2];
      input.id = id;
      input.spellcheck = false;
      input.autocomplete = "off";
      if (f[2] === "text") { input.value = a[f[0]] || ""; }
      else if (a[f[0]]) { input.placeholder = "stored: leave empty to keep it"; }
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); save(); } });
      inputs[f[0]] = input;
      form.appendChild(label);
      form.appendChild(input);
    });
    acct.appendChild(form);
    function save() {
      var body = {};
      FIELDS.forEach(function (f) { body[f[0]] = inputs[f[0]].value; });
      editing = false;
      send({ account: body }, "saving, and asking ScreenScraper...");
    }
    var btns2 = el("div", "ss-btns");
    var saveBtn = el("button", "primary", "Save and check");
    saveBtn.type = "button";
    saveBtn.addEventListener("click", save);
    btns2.appendChild(saveBtn);
    if (a.ready) {
      var cancel = el("button", null, "Cancel");
      cancel.type = "button";
      cancel.addEventListener("click", function () { editing = false; paintAccount(a, null); });
      btns2.appendChild(cancel);
    }
    acct.appendChild(btns2);
    if (note) { acct.appendChild(note); }
  }

  function send(body, words) {
    acct.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
    acct.appendChild(el("p", "ss-note", words));
    post(body).then(function (r) {
      if (!inner.isConnected) { return; }
      if (!r || !r.ok) {
        var a = (last && last.account) || { ready: false };
        paintAccount(a, { ok: false, error: (r && r.error) || "the server did not answer" });
        return;
      }
      if (last) { last.account = r.account; }
      paintAccount(r.account, r.check || null);
      paintBar();
    });
  }

  // ---- the games ----
  function wordsFor(g, state) {
    if (g.has) { return "saved"; }
    if (!g.system) { return "a console ScreenScraper does not have"; }
    return state ? WORDS[state] || state : "";
  }

  function paint(r) {
    if (!inner.isConnected) { return; }
    if (!r || !r.ok) {
      // Wedged on "reading..." with nothing said is what this must never do.
      intro.textContent = "Could not read the list: " + ((r && r.error) || "the server did not answer") + ".";
      return;
    }
    var first = last === null;
    last = r;
    if (first) { paintAccount(r.account, null); }
    var job = r.job, running = isRunning(r);
    var states = {};
    ((job && job.games) || []).forEach(function (g) { states[g.id] = g.state; });
    var got = ((job && job.games) || []).filter(function (g) { return g.state === "done"; }).length;
    var quota = job && job.allowed ? " ScreenScraper counts " + job.used + " of " + job.allowed + " requests used today." : "";
    var nTried = r.games.filter(function (g) { return !g.has && g.tried; }).length;
    var one = nTried === 1;
    if (running) {
      intro.textContent = "Fetching " + job.games.length + " snaps in the background: " + got + " saved so far. You can close this; they carry on." + quota;
    } else if (!r.missing) {
      intro.textContent = "Every game has a video. Nothing to fetch.";
    } else if (job && job.state === "failed") {
      intro.textContent = "The last fetch stopped: " + (job.error || "no reason written") + ". " + got + " saved before that." + quota;
    } else if (nTried === r.missing) {
      // Every game with no video is in the list apart: nothing above it is on offer.
      intro.textContent = (one ? "The one game with no video" : "The " + nTried + " games with no video") + " got none from ScreenScraper when fetched before, so " +
        (one ? "it is" : "they are") + " listed apart below." + quota;
    } else {
      intro.textContent = r.missing + (r.missing === 1 ? " game has" : " games have") + " no video. ScreenScraper has a short gameplay snap for most console games; each plays as that game's video." +
        (nTried ? " " + nTried + " of them got none when fetched before and " + (one ? "is" : "are") + " listed apart below." : "") + quota;
    }

    // One with a video is never offered; while its fetch runs it stays, to show it saved.
    var shown = r.games.filter(function (g) { return !g.has || (running && states[g.id]); });
    // Drawn once for a given list of games and filled in after that, so a
    // progress tick does not throw the scroll back to the top.
    var now = (running ? "r:" : "s:") + shown.map(function (g) { return g.id + (g.tried ? "~" : ""); }).join(",");
    if (now !== shape) {
      shape = now;
      lines = {};
      ticks = [];
      rows.textContent = "";
      tried.textContent = "";
      // Versions of one game share its name; their file names tell them apart.
      var twins = {};
      shown.forEach(function (g) { var k = g.platform + "|" + g.title; twins[k] = (twins[k] || 0) + 1; });
      shown.forEach(function (g) {
        var can = !g.has && g.system > 0;
        var line = el("label", "sc-row sv-row" + (can ? "" : " has"));
        var box = el("input");
        box.type = "checkbox";
        box.value = g.id;
        box.dataset.platform = g.platform;
        box.checked = can && !g.tried && !running && !(states[g.id] && states[g.id] !== "waiting");
        box.disabled = !can || running;
        if (can) { ticks.push(box); }
        if (g.tried) { box.dataset.tried = "1"; }
        box.addEventListener("change", paintGo);
        line.appendChild(box);
        line.appendChild(el("span", "sc-title", g.title));
        line.appendChild(el("span", "ss-plat", g.platform + (twins[g.platform + "|" + g.title] > 1 && g.rom ? " · " + g.rom : "")));
        var note = el("span", "sc-rom sv-state");
        line.appendChild(note);
        (g.tried ? tried : rows).appendChild(line);
        lines[g.id] = { note: note, row: line };
      });
      rows.hidden = !rows.children.length;
      apart.hidden = !tried.children.length;
      apartName.textContent = "Got no video before (" + tried.children.length + ")";
      paintBar();
    }
    shown.forEach(function (g) {
      var st = states[g.id] || g.tried, at = lines[g.id];
      if (!at) { return; }
      at.row.classList.toggle("has", g.has || !g.system);
      at.note.textContent = wordsFor(g, st);
      // The day of that answer: ScreenScraper adds videos now and then, so an old one is worth asking again.
      if (!g.has && g.tried && g.triedAt && st === g.tried) {
        at.note.textContent += ", asked " + new Date(g.triedAt * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      }
      at.note.className = "sc-rom sv-state" + (g.has || st === "done" ? " ok" : (st === "none" || st === "novideo" || st === "failed" || !g.system) ? " off" : "");
    });
    if (running && !watching) { watch(); }
  }

  function paintGo() {
    if (!go) { return; }
    var n = ticked().length, ready = last && last.account && last.account.ready;
    go.textContent = "Fetch " + n + (n === 1 ? " snap..." : " snaps...");
    go.disabled = !n || !ready;
    go.title = ready ? "" : "Fill in the ScreenScraper logins above first";
    skr.count(n);
  }

  function paintBar() {
    bar.textContent = "";
    go = null;
    if (!last || isRunning(last) || !ticks.length) { return; }
    // One console at a time is the gentle way to start: select just that one. The games apart are selected by hand.
    var main = ticks.filter(function (t) { return !t.dataset.tried; });
    var counts = {};
    main.forEach(function (t) { counts[t.dataset.platform] = (counts[t.dataset.platform] || 0) + 1; });
    var chooser = el("select", "ss-pick");
    [["", "Select..."], ["*", "Every console (" + main.length + ")"]]
      .concat(Object.keys(counts).sort().map(function (p) { return ["p:" + p, "Only " + p + " (" + counts[p] + ")"]; }))
      .concat([["-", "None"]])
      .forEach(function (o) {
        var opt = el("option", null, o[1]);
        opt.value = o[0];
        chooser.appendChild(opt);
      });
    chooser.addEventListener("change", function () {
      var v = chooser.value;
      if (v === "") { return; }
      ticks.forEach(function (t) {
        if (v === "-") { t.checked = false; } else if (!t.dataset.tried) { t.checked = v === "*" || "p:" + t.dataset.platform === v; }
      });
      chooser.value = "";
      paintGo();
    });
    go = el("button", "primary", "Fetch snaps...");
    go.addEventListener("click", ask);
    bar.appendChild(go);
    if (main.length) { bar.appendChild(chooser); }
    var sb = skr.button();
    if (sb) { bar.appendChild(sb); }
    paintGo();
  }

  function ask() {
    var ids = ticked().map(function (t) { return t.value; });
    if (!ids.length || !last) { return; }
    var r = last;
    confirmWindow("Fetch " + ids.length + (ids.length === 1 ? " snap?" : " snaps?"), function (box) {
      box.appendChild(el("p", null, "Each game's video snap from ScreenScraper, found by the game's name and console. A few megabytes each."));
      // A look by name and the video; a game not found that way is looked for three more ways (bin\screenscraper.ps1).
      box.appendChild(el("p", "confirm-game", "Two requests for a game found by its name, up to five for one that takes looking for, so up to " + (ids.length * 5) + " of today's allowance, one at a time"));
      box.appendChild(el("p", "confirm-note", "From: ScreenScraper (screenscraper.fr), as " + r.account.user));
      box.appendChild(el("p", "confirm-note", "Into: " + r.dir));
      box.appendChild(el("p", "confirm-safe", "A game that already has a video keeps it, and nothing outside that folder is written. Backups leave these out; they can be fetched again."));
    }, { label: "Fetch", run: function () {
      L("SSCR", "fetch " + ids.length);
      post({ ids: ids }).then(function (res) {
        if (!res.ok) { showStrip("snaps not fetched: " + (res.error || ""), true); return; }
        showStrip("fetching " + res.count + " snaps in the background: the bar in the corner shows how far it is", false);
        closeEditor();                  // nothing more to do here: Done would be an extra press
        jobsWatch("screenscraper");
      });
    } });
  }

  function watch() {
    watching = true;
    var misses = 0;
    (function tick() {
      api("api/screenscraper.php").then(function (r) {
        // A missed read is expected while the server is busy; giving up on
        // one would freeze the rows while the fetch carried on.
        if (!r || !r.ok) {
          if (++misses <= 10) { setTimeout(tick, 3000); return; }
          watching = false;
          logWarn("the snap watch gave up after 10 missed reads; the fetch carries on by itself");
          if (inner.isConnected) { intro.textContent = "Lost sight of the fetch; it carries on by itself. Close and reopen this screen to catch up."; }
          return;
        }
        misses = 0;
        var running = isRunning(r);
        if (inner.isConnected) { paint(r); }
        if (running) { setTimeout(tick, 1500); return; }
        watching = false;
        if (r.job) {
          var saved = r.job.games.filter(function (g) { return g.state === "done"; }).length;
          // The library is read again so the new snaps play without a reload,
          // keeping the game that is chosen now.
          if (saved) { reloadKeeping(games[sel] ? games[sel].id : null); }
          if (jobSayOnce("screenscraper", r.job.started)) {     // once, whoever sees the end first (js/jobbars.js)
            sound("ok");
            showStrip(r.job.state === "failed" ? "snaps stopped: " + (r.job.error || "") : saved + " snaps saved from ScreenScraper", r.job.state === "failed");
          }
        }
      });
    })();
  }

  function read() { api("api/screenscraper.php").then(paint); }
  read();
}
