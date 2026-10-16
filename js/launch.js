import { inApp } from "./appwindow.js";
import { closeEditor, setEditorOnClose, toolFrame } from "./editors.js";
import { load } from "./library.js";
import { L, api, postJson } from "./log.js";
import { popupMenu } from "./menus.js";
import { troubleSeen } from "./news.js";
import { askRetroArch, getRetroArch, raLabel } from "./raoffer.js";
import { rowsNode } from "./rows.js";
import { saveSetting } from "./savednote.js";
import { paintSetupBar } from "./setupbar.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $body, $editor, $hero, $strip, S, busy, games, sel, setBusy, view } from "./state.js";
import { stopGame } from "./status.js";
import { el, hhmm, versionLabel } from "./util.js";
import { carNodes, flatNodes, row } from "./views.js";

// ---------- launching ----------

export function launch() {
  var g = games[sel];
  if (!g || busy) { return; }
  // A card holding several versions of one game asks which first, unless one
  // was selected in its details (js\versionstab.js): that one starts at once.
  if (g.versions && g.versions.length > 1) {
    var picked = g.versions.filter(function (v) { return v.id === g.chosen && v.playable; })[0];
    if (picked) { L("LNCH", "the selected version of " + g.title + ": " + versionLabel(picked)); launchGame(picked); return; }
    pickVersion(g);
    return;
  }
  launchGame(g);
}

/* Which version, for a card that holds several (api\library.php, the roll-up):
   the one played last comes first, so Enter plays what you
   played before, and each then goes the ordinary way, save states and all.
   One that cannot start is listed, greyed, and says so. */
function pickVersion(g) {
  L("LNCH", "which version of " + g.title + " (" + g.versions.length + ")");
  var vrows = g.versions.map(function (v) {
    return { icon: "play", label: versionLabel(v),
             hint: !v.playable ? "cannot start" : v.lastPlayed ? "played " + v.lastPlayed.slice(0, 10)
                 : v.plays ? "played before" : "never played",   // imported counts carry no date
             tip: v.playable ? null : "Cannot start: " + (v.why || "it has no launch command"),
             run: v.playable ? function () { launchGame(v); } : null };
  });
  // One with no emulator yet where RetroArch would play it: the press that gets it, last.
  var raVer = g.versions.filter(function (v) { return !v.playable && raLabel(v.raOffer); })[0];
  if (raVer) { vrows.push({ icon: "disc", label: raLabel(raVer.raOffer), tip: raVer.why, run: function () { getRetroArch("the which-version menu"); } }); }
  popupMenu(vrows, Math.round(innerWidth / 2 - 160), Math.round(innerHeight / 3), g.title + ": which version?");
}

function launchGame(g) {
  // No emulator yet where RetroArch would play it: the press that gets it, not a red line.
  if (!g.playable && raLabel(g.raOffer)) { askRetroArch(g); return; }
  if (!g.playable && g.raOffer) { showStrip(g.title + ": " + g.why, false); return; }
  if (!g.playable) { showStrip("cannot launch: " + (g.why || "no command"), true); return; }

  // Ask before launching (Settings > Launching): the yes comes first. The
  // save picker below is an ask of its own, so a game that has saves skips it.
  var start = S.launch && S.launch.confirmBeforeLaunch ? askPlay : function (x) { launchNow(x, null); };
  // A RetroArch game with saved states is offered them first (api\states.php
  // answers in a few ms; a game with none goes straight on). Your own games
  // and the other emulators have no slots to offer.
  if (g.local || !(S.launch && S.launch.offerStates)) { start(g); return; }
  setBusy(true);
  api("api/states.php?id=" + encodeURIComponent(g.id)).then(function (res) {
    setBusy(false);
    if (!res.ok || !res.states || !res.states.length) { start(g); return; }
    openStatePicker(g, res);
  });
}

/* "Play this game?": two buttons on the picker's own keys and pad (left and
   right, Enter or A, Esc or B), so a stray press starts nothing. It opens on
   Play: the second press is the one that means it. */
function askPlay(g) {
  L("MNU", "ask before launching " + g.title);
  stopVideo();
  setEditorOnClose(null);
  $editor.textContent = "";
  var inner = el("div", "panel-inner ask-inner");
  inner.appendChild(el("h1", "panel-title", "PLAY THIS GAME?"));
  inner.appendChild(el("p", "group-help", g.title + "  ·  " + g.platform));
  var bar = el("div", "ask-row");
  var yes = el("button", "primary", "Play");
  var no = el("button", null, "Not now (esc)");
  var cells = [yes, no];
  function focusAt(i) {
    pick.at = Math.max(0, Math.min(cells.length - 1, i));
    cells[pick.at].focus();
  }
  yes.addEventListener("click", function () {
    L("MNU", "run play, asked first");
    pick = null;
    $editor.hidden = true;
    $editor.textContent = "";
    launchNow(g, null);
  });
  no.addEventListener("click", closeEditor);
  bar.appendChild(yes);
  bar.appendChild(no);
  inner.appendChild(bar);
  $editor.appendChild(inner);
  $editor.hidden = false;
  // once: a key held down is one press here, or the Enter that asked would also answer.
  pick = { cells: cells, at: 0, once: true, move: function (d) { focusAt(pick.at + d); }, choose: function () { cells[pick.at].click(); } };
  focusAt(0);
}

/* The saves, asked for by name rather than on the way into a launch: the
   right-click menu's Save States entry. The same picker, the same keys, and
   choosing one still plays from it; Esc just looks and leaves. It answers
   whether the pre-launch ask is on or off, because opening it by hand IS
   the ask. */
export function openStates(g) {
  g = g || games[sel];
  if (!g || g.local) { return; }
  api("api/states.php?id=" + encodeURIComponent(g.id)).then(function (res) {
    if (!res.ok || !res.states || !res.states.length) {
      showStrip("no save states for " + g.title + " yet", false);
      return;
    }
    openStatePicker(g, res);
  });
}

/* The launch pulse: the thing standing for the chosen game swells and
   glows once, so the press visibly took before the emulator has said a
   word. Which node that is depends on the view; a wheel's rim items and a
   carousel's cards live on their own transforms, so there the pulse lands
   on the image inside rather than the positioned node. */
function pulseLaunch() {
  if ($body.classList.contains("no-anim")) { return; }
  var n = null;
  if (view === "wheel") { n = $hero.querySelector("img"); }
  else if (view === "carousel" && carNodes) { n = carNodes[sel] && carNodes[sel].querySelector("img"); }
  else if (view === "rows") { n = rowsNode(); }
  else if (flatNodes) { n = flatNodes[sel]; }
  if (!n) { return; }
  n.classList.remove("launching");
  void n.offsetWidth;
  n.classList.add("launching");
  setTimeout(function () { n.classList.remove("launching"); }, 700);
}

/* slot: null for a fresh start, or the save state slot RetroArch opens on.
   choice: how that save loads this once ("session" or "key"), the answer to
   the question below before the setting has come back saved.
   hack: { key, name, wait } to play with one of its hacks (js\hackstab.js);
   wait is what the bottom line says while a patched copy is made. */
export function launchNow(g, slot, direct, choice, hack) {
  if (busy) { return; }
  setBusy(true);
  stopVideo();
  sound("select");
  pulseLaunch();
  L("LNCH", "ask " + g.title + " [" + g.platform + "]" + (g.local ? " own" : "") + (slot === null ? "" : " slot " + slot) + (direct ? " without Steam" : "") + (hack ? " hack " + hack.name : ""));
  showStrip(hack && hack.wait ? hack.wait : "starting " + g.title + "…", false);

  postJson("api/launch.php", hack ? { id: g.id, hack: hack.key } : direct ? { id: g.id, direct: true } : slot === null ? { id: g.id }
                         : choice ? { id: g.id, slot: slot, stateLoad: choice } : { id: g.id, slot: slot }).then(function (res) {
    setBusy(false);
    // Network commands are off and nobody has said how a save should load.
    if (res.ok && res.ask === "stateLoad") { $strip.hidden = true; askStateLoad(g, slot, res.hotkey || "F4"); return; }
    if (!res.ok) {
      // The guardrail speaks for itself; anything else gets the real reason.
      // "waiting" is the cores download under way (api\launch.php): said as
      // it is, not as a failure, and followed so "press Play again" comes
      // the moment it is true.
      showStrip(res.guardrail ? res.error + " - " + res.detail
              : res.waiting ? res.error
              : ("launch failed: " + res.error), true);
      if (res.waiting) { followSetupJob("the cores are fetched: press Play on " + g.title + " again"); }
      return;
    }
    if (res.url) { openWebGame(g, res.url); return; }
    var how = res.slot === null || res.slot === undefined ? ""
            : res.loads === "sent" ? "  ·  loading slot " + res.slot + " for you"
            : "  ·  on slot " + res.slot + ", press " + (res.hotkey || pickHotkey) + " to load it";
    showStrip("running: " + res.launched + "  (" + res.via + ")" + how, false);
    $strip.dataset.kind = "running";
    watchGame(res.launched, null, false);
  });
}

/*  The game the bottom line is about, so it can be taken down when the game
    ends, even one that ended before the next status poll.
    seen: the poll has said it was running. Until then it is given 20 s,
    because the launcher takes a moment to start (js\status.js). */
export var watched = { game: null };
export function watchGame(title, startedAt, seen) {
  var w = watched.game;
  if (w && w.title === title) {
    w.seen = w.seen || seen;
    w.startedAt = w.startedAt || startedAt;
    return;
  }
  watched.game = { title: title, at: Date.now(), startedAt: startedAt, seen: seen };
}

/*  "Finished X · 12 min" for a few seconds, with a close and a Don't show again,
    which is the setting Settings > Launching > Say when a game finishes. */
export function showFinished(w) {
  var from = Date.parse(w.startedAt || "") || w.at;
  var took = hhmm(Math.round((Date.now() - from) / 1000));
  showStrip("Finished " + w.title + "  ·  " + (took && took !== "0m" ? took.replace(/m$/, " min").replace(/h /, " h ") : "under a minute"), false);
  $strip.dataset.kind = "finished";
  var off = el("button", null, "Don't show again");
  off.addEventListener("click", function () {
    S.launch = S.launch || {};
    S.launch.showFinished = false;
    $strip.hidden = true;
    postJson("api/settings.php", { launch: { showFinished: false } }).then(function (r) {
      if (!r.ok) { showStrip("could not turn that off: " + (r.error || "no answer"), true); }
    });
  });
  $strip.insertBefore(off, $strip.lastChild);        // before Clear
  setTimeout(function () {
    if ($strip.dataset.kind === "finished") { $strip.hidden = true; $strip.dataset.kind = ""; }
  }, 4000);
}

/*  The save state picker.

    Shown between pressing A and RetroArch opening, only when the game has
    states. Each tile is the screenshot RetroArch saved beside the state
    (savestate_thumbnail_enable) with its slot and when it was made, newest
    first; the first tile is a fresh start.

    What the pick does is set the slot, not load the state: RetroArch's
    --entryslot wants a file Xsegon would have to write beside your saves
    (includes\states.php). So the tile says what happens next: F4 loads it,
    or Xsegon sends that press when network commands are on.                */

export var pick = null;                        // { cells, at, choose } while the picker is up
export function setPick(v) { pick = v; }
var pickHotkey = "F4";

function openStatePicker(g, res) {
  L("MNU", "states " + g.title + " (" + res.states.length + ")");
  stopVideo();
  setEditorOnClose(null);
  pickHotkey = res.hotkey || "F4";
  var inner = toolFrame("WHERE TO START", { base: "st-inner", close: "Cancel (esc)" });
  inner.appendChild(el("p", "group-help", g.title + "  ·  " + res.states.length + (res.states.length === 1 ? " save" : " saves") +
    (res.sends ? ".  Pick one and Xsegon loads it once the game is up."
     : res.mode === "ask" ? ".  Pick one to start there."
     : ".  Pick one, then press " + pickHotkey + " once the game is up to load it.")));

  var row = el("div", "st-row");
  var cells = [];
  function cell(label, cap, slot, shotUrl) {
    var c = el("div", "st-cell");
    var fr = el("div", "st-frame");
    if (shotUrl) {
      var img = el("img");
      img.alt = "";
      img.src = shotUrl;
      fr.appendChild(img);
    } else {
      fr.appendChild(el("div", "st-fresh", slot === null ? "▶" : "?"));
    }
    c.appendChild(fr);
    c.appendChild(el("div", "st-label", label));
    c.appendChild(el("div", "st-cap", cap));
    c.addEventListener("click", function () { choose(cells.indexOf(c)); });
    c.addEventListener("mouseenter", function () { focusAt(cells.indexOf(c)); });
    cells.push(c);
    row.appendChild(c);
    return c;
  }
  cell("Fresh start", "from the title screen", null, null);
  res.states.forEach(function (st) {
    cell("Slot " + st.slot, whenSaved(st.when),
         st.slot, st.shot === null ? null : "api/states.php?id=" + encodeURIComponent(g.id) + "&shot=" + st.slot + "&t=" + st.shot);
  });
  inner.appendChild(row);
  if (res.auto) {
    inner.appendChild(el("p", "mt-note", "RetroArch also has its own exit save for this game, which only its savestate_auto_load setting can bring back."));
  }
  $editor.appendChild(inner);
  $editor.hidden = false;

  function focusAt(i) {
    i = Math.max(0, Math.min(cells.length - 1, i));
    cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
    pick.at = i;
    cells[i].scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function choose(i) {
    var slot = i === 0 ? null : res.states[i - 1].slot;
    L("MNU", "run " + (slot === null ? "fresh start" : "slot " + slot));
    pick = null;
    $editor.hidden = true;
    $editor.textContent = "";
    launchNow(g, slot);
  }
  pick = { cells: cells, at: 0, move: function (d) { focusAt(pick.at + d); }, choose: function () { choose(pick.at); } };
  // the newest save is the likely answer; the fresh start is one step left
  focusAt(res.states.length ? 1 : 0);
}

/*  How should a save load? Asked once, the first time a save is picked while
    RetroArch's network commands are off (api\launch.php answers "ask"
    instead of launching). Three ways, the best first:

      Show me how   the steps to switch them on in RetroArch itself, and a
                    button that opens it. Nothing saved: once they are on,
                    Xsegon never asks again, because it never needs to.
      For Xsegon's games only   Xsegon switches them on for each of its own
                    launches (launch.stateLoad = session). The catch, said
                    here: settings changed inside RetroArch during those
                    games are not saved.
      I'll press the key   the person loads it themselves (stateLoad = key).

    Either answer is kept in Settings > Launching, where it can be changed.
    Esc puts the question away and launches nothing.                       */
function askStateLoad(g, slot, hotkey) {
  L("MNU", "ask how saves load, " + g.title + " slot " + slot);
  stopVideo();
  setEditorOnClose(null);
  function page(title, lines, buttons) {
    var inner = toolFrame(title, { base: "st-ask", close: "Cancel (esc)" });
    lines.forEach(function (t) { inner.appendChild(el("p", "group-help", t)); });
    var bar = el("div", "st-ask-bar");
    buttons.forEach(function (b) {
      var btn = el("button", b.primary ? "primary" : null, b.label);
      btn.addEventListener("click", b.run);
      if (b.note) { btn.title = b.note; }
      bar.appendChild(btn);
    });
    inner.appendChild(bar);
    $editor.appendChild(inner);
    $editor.hidden = false;
    var first = bar.querySelector("button");
    if (first) { first.focus(); }
  }
  function keep(mode) {
    S.launch = S.launch || {};
    S.launch.stateLoad = mode;
    saveSetting({ launch: { stateLoad: mode } }, "How a save state is loaded");
  }
  function go(choice) { closeEditor(); launchNow(g, slot, false, choice); }
  function ask() {
    page("LOADING YOUR SAVE", [
      "Xsegon can load slot " + slot + " for you as soon as " + g.title + " starts. For that, RetroArch has to let Xsegon send it a message, which is its Network Commands setting, and it is off.",
      "Choose how you would like it. You will not be asked again, and Settings > Launching can change it."
    ], [
      { label: "Show me how to turn it on", primary: true, run: steps },
      { label: "Turn it on just for Xsegon's games", note: "Settings you change inside RetroArch during these games are not saved.",
        run: function () { L("SET", "stateLoad session"); keep("session"); go("session"); } },
      { label: "I'll press " + hotkey + " myself", run: function () { L("SET", "stateLoad key"); keep("key"); go("key"); } }
    ]);
    $editor.querySelector(".st-ask").appendChild(el("p", "mt-note",
      "Just for Xsegon's games: Xsegon switches it on each time it starts a game, and off again when you quit. Settings you change inside RetroArch during those games are not saved."));
  }
  function steps() {
    page("TURN ON NETWORK COMMANDS", [
      "1.  Open RetroArch (the button below opens the one your games use).",
      "2.  Go to Settings > Network and switch on Network Commands. Leave the port at 55355.",
      "3.  Quit RetroArch, so it keeps the change. If Windows asks about network access, choose Private networks.",
      "After that Xsegon loads every save you pick by itself, and this question never comes back."
    ], [
      { label: "Open RetroArch", primary: true, run: function () {
          api("api/retroarch.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(function (r) {
            showStrip(r.ok ? "RetroArch is opening: Settings > Network > Network Commands" : ("could not open RetroArch: " + (r.error || "")), !r.ok);
          });
        } },
      { label: "Play now, I'll press " + hotkey, run: function () { go("key"); } },
      { label: "Back", run: ask }
    ]);
  }
  ask();
}

export function whenSaved(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) { return ""; }
  var days = Math.floor((Date.now() - d.getTime()) / 86400000);
  var hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (days === 0) { return "today " + hm; }
  if (days === 1) { return "yesterday " + hm; }
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: days > 300 ? "numeric" : undefined }) + ", " + hm;
}

/* A web game of yours (includes\local.php, "url") opens in a WINDOW OF ITS
   OWN, never in this one: this window is the kiosk, and location.href here
   leaves no way back short of Alt+F4. api\open-game.php opens an app window
   on play.php, which frames the game, adds Esc, an X and a minimise, and
   counts the play time. In an ordinary tab the page opens beside this one. */
function openWebGame(g, url) {
  if (inApp) {
    showStrip("opening " + g.title + " in its own window…  (Esc or the X in its corner comes back)", false);
    postJson("api/open-game.php", { id: g.id }).then(function (r) {
      if (!r.ok) { showStrip("could not open that game: " + (r.error || ""), true); return; }
      // Its window has the keyboard now; the wall waits behind it. The
      // session is written by play.php when the window closes, so this
      // only has to notice the game is back to refresh the history.
      window.addEventListener("focus", function again() {
        window.removeEventListener("focus", again);
        load();
      });
    });
    return;
  }
  var w = window.open("play.php?id=" + encodeURIComponent(g.id), "_blank");
  if (!w) { showStrip("the browser blocked the new tab; allow pop-ups for this page", true); return; }
  showStrip("playing " + g.title + " in a new tab", false);
  var poll = setInterval(function () {
    if (w.closed) { clearInterval(poll); load(); showStrip("back from " + g.title, false); }
  }, 1000);
  void url;                              // play.php looks the address up by id
}

/* A setup fetch somebody else started (Play refused while the cores
   download, the scan's own quiet fetches): one light look every few
   seconds until it ends, then say so. The heavy 1 second watch lives in
   js\setup.js for the fetches this page starts itself; this one only has
   to catch the end. The latest caller's words win. */
var followT = null, followSaid = "";
export function followSetupJob(doneText) {
  followSaid = doneText || "";
  if (followT) { return; }
  var looksLeft = 1200;                 // two hours of looks, the job's own ceiling
  followT = setInterval(function () {
    api("api/setup.php").then(function (st) {
      if (!st.ok || !st.job) { return; }        // a busy server: ask again next look
      paintSetupBar(st.job);                    // the corner bar rides this look too
      if (st.job.state === "running" && --looksLeft > 0) { return; }
      clearInterval(followT);
      followT = null;
      if (st.job.state === "done") {
        sound("ok");
        showStrip(followSaid || "the cores are fetched", false);
      } else if (st.job.state === "failed") {
        showStrip("the fetch stopped: " + (st.job.error || ""), true, null, null, troubleSeen("job:setup"));
      }
    });
  }, 6000);
}

var stripSaid = "";
// onClear: run when Clear is pressed (js\news.js troubleSeen: its message is read).
export function showStrip(text, isError, running, errAt, onClear) {
  // The status poll shows a standing failure again every four seconds; the
  // log wants it once.
  var said = (isError ? "E" : "M") + text;
  if (said !== stripSaid || $strip.hidden) {
    if (isError) { L("ERR", "strip: " + text); } else if (!running) { L("MSG", text); }
  }
  stripSaid = said;
  $strip.hidden = false;
  $strip.dataset.kind = running ? "running" : "";
  $strip.className = "strip" + (isError ? " err" : "");
  $strip.textContent = "";
  $strip.appendChild(el("span", "who", isError ? "✗" : "▶"));
  $strip.appendChild(el("span", null, text));

  if (running && S.launch && S.launch.offerQuitButton && (!running.kind || running.kind === "retroarch")) {
    $strip.appendChild(el("span", "spacer"));
    var stop = el("button", null, "Stop game");
    stop.addEventListener("click", stopGame);
    $strip.appendChild(stop);
  } else if (!running) {
    // Clear remembers WHICH standing trouble was dismissed (by its
    // timestamp): that one stays gone, the next one still shows.
    $strip.appendChild(el("span", "spacer"));
    var clear = el("button", null, "Clear");
    clear.addEventListener("click", function () {
      if (errAt) {
        clearedErr = errAt;
        try { localStorage.setItem("xs-cleared-error", errAt); } catch (e) { /* fine */ }
      }
      $strip.hidden = true;
      if (onClear) { onClear(); }
    });
    $strip.appendChild(clear);
  }
}

/* Takes a line off the strip, but only while it is still the one showing:
   the wait it spoke of is over, and nothing has been said since. */
export function clearStrip(text) {
  if (stripSaid === "M" + text && !$strip.hidden) { $strip.hidden = true; }
}

export var clearedErr = null;
try { clearedErr = localStorage.getItem("xs-cleared-error"); } catch (e) { /* fine */ }
