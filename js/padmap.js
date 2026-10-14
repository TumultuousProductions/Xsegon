/*  Settings > RetroArch + Emulator Controls > RetroArch (Gamepad): your buttons for each console's games in
    RetroArch, set by pressing them. A button that moves swaps places with the
    one it takes over, so none does two jobs or goes dead. Kept at once
    (api\pad-remap.php); the file RetroArch reads is written as a game starts
    (includes\padmap.php), in Xsegon's own folder: RetroArch's own settings are
    never changed, and a game's own remap made in RetroArch still wins. STD turns
    standard-layout presses into RetroPad buttons; names shown are an Xbox pad's. */

import { iconEl } from "./icons.js";
import { padSeen, padWaitKey, padWaitNothing, padWaitWords } from "./input.js";
import { L, api, postJson } from "./log.js";
import { padListen, padListenEnd, padListenStop } from "./padlisten.js";
import { setBarTo } from "./settings-nav.js";
import { sound } from "./sound.js";
import { el } from "./util.js";

// The browser's standard layout, button by button, as RetroPad buttons.
// Shared with the per-game editor (js\gamebtns.js).
export var STD = ["b", "a", "y", "x", "l", "r", "l2", "r2", "select", "start", "l3", "r3", "up", "down", "left", "right"];
export var PAD_NAMES = {
  b: "A (bottom)", a: "B (right)", y: "X (left)", x: "Y (top)", l: "LB", r: "RB", l2: "LT", r2: "RT",
  select: "View (Back)", start: "Menu (Start)", l3: "Left stick press", r3: "Right stick press",
  up: "D-pad up", down: "D-pad down", left: "D-pad left", right: "D-pad right"
};
var CATCH_MS = 12000;         // a wait nobody answers ends by itself

var box = null, consoles = [], at = 0, waiting = null;
var who = 1, most = 4;        // the player whose buttons are shown, and how many players there are
var helpRow = null;           // "A controller wrong in games", kept under the rows that are drawn again

// A player's buttons on a console: their own, else player 1's, which are the console's.
function own(c) { return who > 1 && c.players[who] ? c.players[who] : null; }
function mapOf(c) { return own(c) || c.map || {}; }
function whose(c) { return c.platform + (who > 1 ? " player " + who : ""); }

// The pad button that sends this console button now: the one mapped to it,
// or itself when nothing moved it.
export function padPressedFor(map, sends) {
  for (var p in map) { if (map[p] === sends) { return p; } }
  return map[sends] ? null : sends;
}

// Set console button `sends` to pad button `press`, swapping with whatever
// that pad button sent before. Returns the new map of moved buttons only.
export function padMoved(map, sends, press) {
  var f = {};
  STD.forEach(function (p) { f[p] = map[p] || p; });
  var had = null;
  STD.forEach(function (p) { if (f[p] === sends) { had = p; } });
  var took = f[press];
  f[press] = sends;
  if (had !== null && had !== press) { f[had] = took; }
  var out = {};
  STD.forEach(function (p) { if (f[p] !== p) { out[p] = f[p]; } });
  return out;
}

function row(label, hint, control, find) {
  var r = el("div", "opt padrow");
  r.appendChild(iconEl("opt-ico", "gamepad"));
  var l = el("label");
  l.appendChild(document.createTextNode(label));
  if (hint) { l.appendChild(el("span", "hint", hint)); }
  r.appendChild(l);
  r.appendChild(control);
  r.dataset.find = (label + " " + (hint || "") + " " + (find || "") + " controls buttons remap bind in games").toLowerCase();
  r.addEventListener("mousemove", function () { setBarTo("page", r); });
  return r;
}

// A player's buttons into the list: player 1's are the console's, and null puts another player back with player 1.
function put(c, n, map) {
  if (n === 1) { c.map = map; return; }
  if (map) { c.players[n] = map; } else { delete c.players[n]; }
}

function save(c, map) {
  var n = who, name = whose(c), was = n > 1 ? c.players[n] : c.map;
  put(c, n, map);
  paint();
  postJson("api/pad-remap.php", n > 1 ? { platform: c.platform, player: n, map: map } : { platform: c.platform, map: map }).then(function (r) {
    if (r.ok) { sound("select"); return; }
    L("PADS", name + " not kept: " + (r.error || "no answer"));
    put(c, n, was);
    paint();
    note("Not kept: " + (r.error || "the server said no"), true);
  });
}

function note(words, bad, hearing) {
  var n = box && box.querySelector(".pad-note");
  if (!n) { return; }
  n.textContent = words;
  n.classList.toggle("bad", !!bad);
  n.classList.toggle("hearing", !!hearing);     // the wait, said at a size nobody misses
}

function endWait() {
  if (!waiting) { return; }
  clearTimeout(waiting.timer);
  document.removeEventListener("keydown", waiting.key, true);
  padListenEnd(waiting.listen);
  waiting = null;
}

/* For closeSettings: a listen left running would save the next press on the games
   screen as a button move. padListenStop also ends a hotkey or turbo wait. */
export function cancelPadWait() { endWait(); padListenStop(); }

function wait(c, sends, name, b) {
  endWait();
  var what = whose(c) + " " + name;
  b.textContent = "Press a button...";
  b.classList.add("catching");
  note(padWaitWords(what), false, true);
  L("PADS", what + ": listening for a controller button" + (padSeen() ? "" : " (no controller seen yet)"));
  waiting = {
    timer: setTimeout(function () {
      endWait(); paint();
      L("PADS", what + ": nothing pressed in " + (CATCH_MS / 1000) + "s, left as it was" + (padSeen() ? "" : " (no controller seen)"));
      note(padWaitNothing(), !padSeen());
    }, CATCH_MS),
    // Esc cancels; any other key is answered and goes no further (js\input.js).
    key: padWaitKey(what, function (words, bad) { note(words, bad, true); },
                    function () { endWait(); paint(); L("PADS", what + ": cancelled with Esc"); note("Left as it was."); })
  };
  document.addEventListener("keydown", waiting.key, true);
  waiting.listen = padListen(function (k) {
    endWait();
    var press = STD[k];
    if (!box || !box.isConnected) { return; }
    if (!press) {                 // the Xbox button: a console has no such button
      paint();
      L("PADS", what + ": button " + k + " is not one a console has, left as it was");
      note("That one is not a button a console has: choose again and press another.", true);
      return;
    }
    L("PADS", what + " = " + PAD_NAMES[press]);
    // A player with none of their own starts from player 1's, the picture they were shown.
    save(c, padMoved(mapOf(c), sends, press));
    note(what + " is on " + PAD_NAMES[press] + " now.");
  }, function () {
    // Another row took the listen: this one goes back to its button.
    endWait(); paint();
    L("PADS", what + ": another row is listening now, left as it was");
    note("Left as it was: another one is being set now.");
  }, what);
}

// The Player row: whose buttons the rows under it are, and who has their own.
function playerRow(c) {
  var seat = el("select");
  for (var n = 1; n <= most; n++) {
    var o = el("option", null, "Player " + n + (n > 1 ? (c.players[n] ? "  (their own)" : "  (same as player 1)") : ""));
    o.value = String(n);
    if (n === who) { o.selected = true; }
    seat.appendChild(o);
  }
  seat.addEventListener("change", function () { endWait(); who = Number(seat.value); paint(); note(""); });
  var hint = who === 1 ? "Player 1's buttons, and those of every player with none of their own."
    : own(c) ? "Player " + who + "'s own buttons. A game with buttons of its own keeps those for every player."
    : "Player " + who + " has player 1's buttons. Change one and it is kept for player " + who + " alone.";
  return row("Player", hint, seat, "player 1 2 3 4 two players second controller");
}

function paint() {
  if (!box) { return; }
  box.querySelectorAll(".padrow").forEach(function (r) { r.remove(); });
  var c = consoles[at];
  if (!c) { return; }

  var which = el("select");
  consoles.forEach(function (x, i) {
    var o = el("option", null, x.platform + (Object.keys(x.map || {}).length || Object.keys(x.players).length ? "  (yours)" : ""));
    o.value = String(i);
    if (i === at) { o.selected = true; }
    which.appendChild(o);
  });
  which.addEventListener("change", function () { endWait(); at = Number(which.value); paint(); note(""); });
  box.appendChild(row("Console", "Whose buttons these are. A console you changed says (yours)." + (c.note ? " " + c.note : ""), which));   // under the note, which stays in sight
  box.appendChild(playerRow(c));

  var m = mapOf(c);
  c.buttons.forEach(function (btn) {
    var p = padPressedFor(m, btn.sends);
    var b = el("button", "padbtn" + (p === btn.sends ? "" : " moved"), p ? PAD_NAMES[p] : "none");
    b.type = "button";
    b.addEventListener("click", function (e) { e.stopPropagation(); wait(c, btn.sends, btn.name, b); });
    box.appendChild(row(btn.name,
      p === btn.sends ? "Standard: " + PAD_NAMES[btn.sends] + ". Choose, then press the one you want."
                      : "Yours. Standard is " + PAD_NAMES[btn.sends] + ".", b, c.platform));
  });

  // For player 2 to 4 this is a choice of their own: standard, whatever player 1 has.
  var reset = el("button", null, "Standard layout");
  reset.type = "button";
  reset.disabled = !Object.keys(m).length;
  reset.addEventListener("click", function () { endWait(); L("PADS", whose(c) + " back to standard"); save(c, {}); note(whose(c) + " is back to its standard buttons."); });
  box.appendChild(row("Standard layout", "Every " + c.platform + " button back where RetroArch puts it" + (who > 1 ? ", for player " + who + "." : "."), reset));

  if (who > 1) {
    var same = el("button", null, "Same as player 1");
    same.type = "button";
    same.disabled = !own(c);
    same.addEventListener("click", function () { endWait(); L("PADS", whose(c) + " the same as player 1 again"); save(c, null); note("Player " + who + " has player 1's " + c.platform + " buttons again."); });
    box.appendChild(row("Same as player 1", "Player " + who + " gives up their own " + c.platform + " buttons and follows player 1's.", same));
  }
  if (helpRow) { box.appendChild(helpRow); }
}

/* The buttons-per-console part of RetroArch + Emulator Controls, filled once the consoles are in. */
export function padMapPage(part, toHelp) {
  box = part;
  who = 1;                    // each visit starts on player 1: a change meant for everyone must not land on player 2
  // The last row: the way to the window for a controller RetroArch itself does not know (js\padhelp.js).
  var help = el("button", null, "How to fix it...");
  help.type = "button";
  help.addEventListener("click", function (e) { e.stopPropagation(); endWait(); toHelp(); });
  helpRow = row("A controller wrong in games", "When a controller does nothing in a game, or its buttons are wrong there while Xsegon's own screens are fine.", help, "unknown controller not working teach retroarch");
  box.appendChild(el("p", "group-help pad-intro",
    "Your buttons for each console's games in RetroArch. Choose a button, then press the one you want on your pad; " +
    "the button it takes over swaps places with it. Kept for that console's games from their next start. " +
    "Nothing in RetroArch's own settings is changed, and a game's own remap made in RetroArch still wins. " +
    "Up to four players can each have their own: RetroArch makes the first controller it finds player 1, the next player 2."));
  box.appendChild(el("p", "pad-note"));
  api("api/pad-remap.php").then(function (r) {
    if (!r.ok) { note("Could not read the consoles: " + (r.error || "no answer"), true); return; }
    most = r.most || most;
    consoles = (r.consoles || []).map(function (c) { c.map = c.map || {}; c.players = c.players || {}; return c; });
    if (!consoles.length) {
      note("None of your consoles can have their buttons set here yet: none of them is played by RetroArch with buttons Xsegon knows.");
      box.appendChild(helpRow);
      return;
    }
    at = Math.min(at, consoles.length - 1);
    paint();
  });
}
