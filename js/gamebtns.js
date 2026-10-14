/*  One game's own buttons and turbo, over its console's. Opened from the game's details.

    RetroArch reads a game's remap INSTEAD of the core's, so what is kept here is the
    game's whole picture, as moves against the standard layout (the same swap shape as
    a console's; api\game-remap.php refuses anything else). Three states, kept apart by
    the server: none of its own, its own moves, and the standard layout on purpose for
    a game whose console is remapped. The file is written at launch in Xsegon's own
    folder (includes\padmap.php) and replaces a game remap made in RetroArch itself.

    A pad walks it (js\padwin.js) and backs out with B; the press that sets a button
    is the pad's. */

import { setEditorOnClose, toolFrame } from "./editors.js";
import { padSeen, padWaitKey, padWaitNothing, padWaitWords } from "./input.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { padListen, padListenEnd } from "./padlisten.js";
import { PAD_NAMES, STD, padMoved, padPressedFor } from "./padmap.js";
import { turboPickers } from "./rahotkeys.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { el } from "./util.js";

var CATCH_MS = 12000;         // a wait nobody answers ends by itself

var box = null, rowsBox = null, data = null, waiting = null;

// What the game really gets: its own when it has one, else its console's.
function current() {
  return data.own ? data.map : data.console;
}

function same(a, b) {
  var ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(function (k) { return a[k] === b[k]; });
}

function note(words, bad, hearing) {
  var n = box && box.querySelector(".gb-note");
  if (!n) { return; }
  n.textContent = words;
  n.classList.toggle("bad", !!bad);
  n.classList.toggle("hearing", !!hearing);
}

function endWait() {
  if (!waiting) { return; }
  clearTimeout(waiting.timer);
  document.removeEventListener("keydown", waiting.key, true);
  padListenEnd(waiting.listen);
  waiting = null;
}

/* Keep the game's buttons: a map of moves, {} for the standard layout on
   purpose, or null for none of its own. The rows follow at once and go back
   if the server says no. */
function save(map, said) {
  var was = { own: data.own, map: data.map };
  data.own = map !== null;
  data.map = map || {};
  paint();
  postJson("api/game-remap.php", { id: data.id, map: map }).then(function (r) {
    if (r.ok) { sound("select"); note(said); return; }
    L("PADS", "game " + data.title + " not kept: " + (r.error || "no answer"));
    data.own = was.own;
    data.map = was.map;
    paint();
    note("Not kept: " + (r.error || "the server said no"), true);
  });
}

function wait(sends, name, b) {
  endWait();
  var what = "game " + data.title + " " + name;
  b.textContent = "Press a button...";
  b.classList.add("catching");
  note(padWaitWords(name + " in this game"), false, true);
  L("PADS", what + ": listening for a controller button" + (padSeen() ? "" : " (no controller seen yet)"));
  waiting = {
    timer: setTimeout(function () {
      endWait(); paint();
      L("PADS", what + ": nothing pressed, left as it was" + (padSeen() ? "" : " (no controller seen)"));
      note(padWaitNothing(), !padSeen());
    }, CATCH_MS),
    // Esc cancels; any other key is answered and goes no further (js\input.js).
    key: padWaitKey(what, function (words, bad) { note(words, bad, true); },
                    function () { endWait(); paint(); L("PADS", what + ": cancelled with Esc"); note("Left as it was."); })
  };
  document.addEventListener("keydown", waiting.key, true);
  waiting.listen = padListen(function (k) {
    endWait();
    if (!box || !box.isConnected) { return; }
    var press = STD[k];
    if (!press) {                 // the Xbox button: a console has no such button
      paint();
      L("PADS", "game " + data.title + " " + name + ": button " + k + " is not one a console has, left as it was");
      note("That one is not a button a console has: choose again and press another.", true);
      return;
    }
    var next = padMoved(current(), sends, press);
    var words = name + " is on " + PAD_NAMES[press] + " now, for this game only.";
    L("PADS", "game " + data.title + " " + name + " = " + PAD_NAMES[press]);
    if (same(next, data.console)) {
      // Back to exactly what its console has: nothing of its own to keep.
      save(null, name + " is on " + PAD_NAMES[press] + ", which is what " + data.platform + " has, so this game follows its console again.");
    } else {
      // An empty set of moves is still its own when the console is remapped:
      // the standard layout, for this game, on purpose.
      save(next, words);
    }
  }, function () {
    // Another row took the listen: this one goes back to its button.
    endWait(); paint();
    L("PADS", what + ": another row is listening now, left as it was");
    note("Left as it was: another one is being set now.");
  }, what);
}

function row(label, hint, control) {
  var r = el("div", "opt ed-row gb-row");
  var l = el("label");
  l.appendChild(document.createTextNode(label));
  if (hint) { l.appendChild(el("span", "hint", hint)); }
  r.appendChild(l);
  r.appendChild(control);
  return r;
}

function paint() {
  if (!box || !rowsBox) { return; }
  rowsBox.textContent = "";
  var cur = current();
  var consoleMoves = Object.keys(data.console).length;

  data.buttons.forEach(function (btn) {
    var p = padPressedFor(cur, btn.sends);
    var b = el("button", "padbtn" + (p === btn.sends ? "" : " moved"), p ? PAD_NAMES[p] : "none");
    b.type = "button";
    b.addEventListener("click", function (e) { e.stopPropagation(); wait(btn.sends, btn.name, b); });
    // Short on purpose: sixteen rows of it. How to set one is said once, above.
    rowsBox.appendChild(row(btn.name,
      p === btn.sends ? "Standard."
                      : (data.own ? "This game's. " : "The console's. ") + "Standard is " + PAD_NAMES[btn.sends] + ".", b));
  });

  var reset = el("button", null, "Same as the console");
  reset.type = "button";
  reset.disabled = !data.own;
  reset.addEventListener("click", function () {
    endWait();
    L("PADS", "game " + data.title + " back to the console's");
    save(null, data.title + " follows " + (data.theirs ? "the remap made in RetroArch again."
         : data.platform + "'s buttons again" + (consoleMoves ? "" : " (the standard layout)") + "."));
  });
  rowsBox.appendChild(row("Same as the console",
    data.own && !Object.keys(data.map).length && consoleMoves
      ? "This game is kept standard on purpose, while its console's buttons are moved. This lets it follow them again."
      : "Back to what " + data.platform + "'s games use" + (consoleMoves ? " (Settings > RetroArch + Emulator Controls)" : ", the standard layout") + ".", reset));
}

/* The door from details: fetch, then the panel. */
export function openGameButtons(g) {
  api("api/game-remap.php?id=" + encodeURIComponent(g.id)).then(function (res) {
    if (!res.ok) {
      L("PADS", "game buttons refused for " + g.title + ": " + (res.error || "no answer"));
      showStrip("this game's buttons could not be opened: " + (res.error || "no answer"), true);
      return;
    }
    data = res;
    data.map = data.map || {};
    data.console = data.console || {};
    var inner = toolFrame("BUTTONS", { base: "cr-inner", close: "Close (esc)" });

    inner.appendChild(el("p", "group-help",
      res.title + "  ·  " + res.platform + ". For this game only: it starts from the console's buttons " +
      "(Settings > RetroArch + Emulator Controls), and what you set here wins over them. Choose a button, then press " +
      "the one you want on your pad; the button it takes over swaps places with it. Kept from the game's " +
      "next start, and nothing in RetroArch is changed."));
    if (res.theirs) {
      inner.appendChild(el("p", "group-help gb-theirs",
        "A remap made in RetroArch itself exists for this game. With nothing set here it wins over the " +
        "console's buttons, as RetroArch has it, so the rows below may not be what the game really gets. " +
        "The buttons set here take its place when Xsegon starts the game; started from RetroArch, its own " +
        "remap still holds."));
    }
    inner.appendChild(el("p", "pad-note gb-note"));

    box = inner;
    rowsBox = el("div");
    inner.appendChild(rowsBox);
    paint();

    /* Turbo fire for this game alone: the same three pickers as Settings > RetroArch +
       Emulator Controls, except the way back is the choice made everywhere, whose words
       the server hands over. The shared helper keeps the two screens one behaviour. */
    var tp = turboPickers({
      own: res.turbo || null,
      first: "Same as everywhere (" + res.everywhere + ")",
      cleared: res.title + "'s turbo is the same as everywhere again (" + res.everywhere + ").",
      who: "game " + res.title + ": ",
      pad: res.pad,
      padIds: res.ids,
      say: note,
      post: function (choice, then) {
        postJson("api/game-remap.php", { id: res.id, turbo: choice }).then(function (r) {
          if (!r.ok) { note("Not kept: " + (r.error || "the server said no"), true); }
          then(!!r.ok, r.error);
        });
      }
    });
    setEditorOnClose(function () { endWait(); tp.cancel(); });
    inner.appendChild(el("p", "hk-sub gb-turbo", "Turbo fire, this game only"));
    inner.appendChild(row("Turbo fire", "Off, on, or the same as everywhere.", tp.on));
    inner.appendChild(row("Turbo button", "The button that works it. In the toggle way, the one that fires is RetroArch's own Turbo Button setting (B as it comes).", tp.btn));
    inner.appendChild(row("Turbo speed", "How often it presses.", tp.spd));

    $editor.appendChild(inner);
    $editor.hidden = false;
    L("PADS", "game buttons open for " + res.title + ": " +
      (res.own ? (Object.keys(res.map).length ? Object.keys(res.map).length + " of its own" : "the standard layout on purpose") : "its console's") +
      ", turbo " + (res.turbo ? "its own" : "as everywhere") + (res.theirs ? ", RetroArch has a remap for it" : ""));
  });
}
