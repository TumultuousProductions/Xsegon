/*  Settings > RetroArch + Emulator Controls > RetroArch (Keyboard): your keys
    for each console's games in RetroArch. The keyboard half of js\padmap.js,
    built the same way; a key another button had swaps over, so no key does
    two jobs. Kept at once (api\pad-keys.php) and handed to RetroArch as those
    games start; RetroArch's own settings are never changed.
    RetroArch's hotkey keys (Esc to quit, F1 for its menu) cannot be chosen:
    Esc would quit the game and press a button. */

import { iconEl } from "./icons.js";
import { L, api, postJson } from "./log.js";
import { padListen, padListenEnd } from "./padlisten.js";
import { setBarTo } from "./settings-nav.js";
import { sound } from "./sound.js";
import { el } from "./util.js";

var CATCH_MS = 12000;         // a wait nobody answers ends by itself

var box = null, consoles = [], at = 0, hot = {}, waiting = null;

/* A key as the browser names it (KeyboardEvent.code), as RetroArch's settings
   file names it, and as a person reads it. */
var NAMED = {
  Space: ["space", "Space"], Enter: ["enter", "Enter"], NumpadEnter: ["kp_enter", "Numpad Enter"], Tab: ["tab", "Tab"],
  Backspace: ["backspace", "Backspace"], ShiftLeft: ["shift", "Shift"], ShiftRight: ["rshift", "Right Shift"],
  ControlLeft: ["ctrl", "Ctrl"], ControlRight: ["rctrl", "Right Ctrl"], AltLeft: ["alt", "Alt"], AltRight: ["ralt", "Right Alt"],
  ArrowUp: ["up", "Up"], ArrowDown: ["down", "Down"], ArrowLeft: ["left", "Left"], ArrowRight: ["right", "Right"],
  Insert: ["insert", "Insert"], Delete: ["del", "Delete"], Home: ["home", "Home"], End: ["end", "End"],
  PageUp: ["pageup", "Page Up"], PageDown: ["pagedown", "Page Down"], Minus: ["minus", "-"], Equal: ["equals", "="],
  BracketLeft: ["leftbracket", "["], BracketRight: ["rightbracket", "]"], Backslash: ["backslash", "\\"],
  Semicolon: ["semicolon", ";"], Quote: ["quote", "'"], Comma: ["comma", ","], Period: ["period", "."], Slash: ["slash", "/"],
  Backquote: ["tilde", "`"], NumpadAdd: ["add", "Numpad +"], NumpadSubtract: ["subtract", "Numpad -"],
  NumpadMultiply: ["multiply", "Numpad *"], NumpadDivide: ["divide", "Numpad /"], NumpadDecimal: ["kp_period", "Numpad ."],
  CapsLock: ["capslock", "Caps Lock"], Escape: ["escape", "Esc"]
};
var WORDS = {};
Object.keys(NAMED).forEach(function (c) { WORDS[NAMED[c][0]] = NAMED[c][1]; });

export function raKey(code) {
  var m;
  if ((m = /^Key([A-Z])$/.exec(code))) { return [m[1].toLowerCase(), m[1]]; }
  if ((m = /^Digit(\d)$/.exec(code))) { return ["num" + m[1], m[1]]; }
  if ((m = /^Numpad(\d)$/.exec(code))) { return ["keypad" + m[1], "Numpad " + m[1]]; }
  if ((m = /^F(\d{1,2})$/.exec(code)) && Number(m[1]) <= 12) { return ["f" + m[1], "F" + m[1]]; }
  return NAMED[code] || null;
}

export function keyWords(name) {
  var m;
  if (!name || name === "nul") { return "none"; }
  if (WORDS[name]) { return WORDS[name]; }
  if (/^[a-z]$/.test(name)) { return name.toUpperCase(); }
  if ((m = /^num(\d)$/.exec(name))) { return m[1]; }
  if ((m = /^keypad(\d)$/.exec(name))) { return "Numpad " + m[1]; }
  if (/^f\d{1,2}$/.test(name)) { return name.toUpperCase(); }
  return name;
}

function row(label, hint, control, find) {
  var r = el("div", "opt padrow keyrow");
  r.appendChild(iconEl("opt-ico", "lines"));
  var l = el("label");
  l.appendChild(document.createTextNode(label));
  if (hint) { l.appendChild(el("span", "hint", hint)); }
  r.appendChild(l);
  r.appendChild(control);
  r.dataset.find = (label + " " + (hint || "") + " " + (find || "") + " controls keys keyboard remap bind in games retroarch").toLowerCase();
  r.addEventListener("mousemove", function () { setBarTo("page", r); });
  return r;
}

function note(words, bad, hearing) {
  var n = box && box.querySelector(".pad-note");
  if (!n) { return; }
  n.textContent = words;
  n.classList.toggle("bad", !!bad);
  n.classList.toggle("hearing", !!hearing);
}

/* What each button's key is now, and the keys to keep: only those that are
   not RetroArch's own. */
function nowOf(c) {
  var out = {};
  c.buttons.forEach(function (b) { out[b.sends] = b.key; });
  return out;
}
function mineOf(c, now) {
  var out = {};
  c.buttons.forEach(function (b) { if (now[b.sends] !== b.own) { out[b.sends] = now[b.sends]; } });
  return out;
}

function save(c, now, said) {
  var was = c.buttons.map(function (b) { return b.key; });
  c.buttons.forEach(function (b) { b.key = now[b.sends]; });
  paint();
  postJson("api/pad-keys.php", c.every ? { every: true, keys: mineOf(c, now) } : { platform: c.platform, keys: mineOf(c, now) }).then(function (r) {
    // Every console's keys are under each console's: the consoles are read again, so their rows follow.
    if (r.ok) {
      sound("select"); note(said);
      L("PADS", c.platform + " keys kept" + (c.every ? ": the consoles are read again, so their rows follow" : ""));
      if (c.every) { read(true); }
      return;
    }
    L("PADS", c.platform + " keys not kept: " + (r.error || "no answer"));
    c.buttons.forEach(function (b, i) { b.key = was[i]; });
    paint();
    note("Not kept: " + (r.error || "the server said no"), true);
  });
}

function endWait() {
  if (!waiting) { return; }
  clearTimeout(waiting.timer);
  document.removeEventListener("keydown", waiting.key, true);
  padListenEnd(waiting.listen);
  waiting = null;
}

// For closeSettings: a listen left running would take the next key pressed on the games screen.
export function cancelKeyWait() { endWait(); }

/* The wait for a key. Esc cancels (it is RetroArch's quit key anyway); a
   key held with Ctrl or the Windows key is Windows's own and left alone. */
function wait(c, btn, b) {
  endWait();
  var what = (c.every ? "Every console's" : c.platform) + " " + btn.name;
  b.textContent = "Press a key...";
  b.classList.add("catching");
  note("Listening: press the key you want for " + what + " on your keyboard. Esc cancels.", false, true);
  L("PADS", what + ": listening for a key");
  waiting = {
    timer: setTimeout(function () { endWait(); paint(); L("PADS", what + ": no key pressed, left as it was"); note("No key was pressed, so nothing changed."); }, CATCH_MS),
    key: function (e) {
      // Alt too: Alt+Tab away from the listen would save Alt as the key.
      if (e.ctrlKey || e.metaKey || e.altKey || /^(Meta|OS|Alt)$/.test(e.key)) { return; }
      e.preventDefault(); e.stopPropagation();
      if (e.repeat) { return; }
      if (e.key === "Escape") { endWait(); paint(); L("PADS", what + ": cancelled with Esc"); note("Left as it was."); return; }
      var k = raKey(e.code);
      if (!k) {
        L("PADS", what + ": " + e.code + " is not a key RetroArch can be given");
        note("RetroArch cannot be given that key. Press another, or Esc to leave it as it was.", true, true);
        return;
      }
      if (hot[k[0]]) {
        L("PADS", what + ": " + k[1] + " is RetroArch's key for " + hot[k[0]] + ", refused");
        note(k[1] + " is RetroArch's key for " + hot[k[0]] + ", so it cannot be a button too. Press another, or change it in RetroArch: Settings > Input > Hotkeys.", true, true);
        return;
      }
      endWait();
      if (!box || !box.isConnected) { return; }
      var now = nowOf(c), old = now[btn.sends];
      // The key another button had goes to it no longer: that button takes this one's old key.
      var other = c.buttons.filter(function (x) { return x.sends !== btn.sends && now[x.sends] === k[0]; })[0];
      // A button that had no key gives "nul" in exchange, said explicitly: an undefined
      // old key drops out of the posted map, and the server refuses the pair as shared.
      if (other) { now[other.sends] = old || "nul"; }
      now[btn.sends] = k[0];
      L("PADS", what + " = " + k[1] + (other ? ", " + other.name + " = " + keyWords(old) : ""));
      save(c, now, what + " is on " + k[1] + " now" + (other ? "; " + other.name + " took " + keyWords(old) + "." : "."));
    }
  };
  document.addEventListener("keydown", waiting.key, true);
  // A controller button is no key: answered in words, and the wait ends there, so the controller is not held.
  waiting.listen = padListen(function () {
    if (!waiting) { return; }
    endWait(); paint();
    L("PADS", what + ": a controller button was pressed while listening for a keyboard key, left as it was");
    note("That was a button on a controller, and a keyboard key is set here, so nothing changed. A controller's own buttons for games are in RetroArch (Gamepad), above.", true);
  }, function () {
    // Another row took the listen (a Gamepad or Hotkeys one): this one goes back to its key.
    endWait(); paint();
    L("PADS", what + ": another row is listening now, left as it was");
    note("Left as it was: another one is being set now.");
  }, what + " (a keyboard key)");
}

function paint() {
  if (!box) { return; }
  box.querySelectorAll(".keyrow").forEach(function (r) { r.remove(); });
  var c = consoles[at];
  if (!c) { return; }

  var which = el("select");
  consoles.forEach(function (x, i) {
    var o = el("option", null, x.platform + (Object.keys(x.mine || {}).length ? "  (yours)" : ""));
    o.value = String(i);
    if (i === at) { o.selected = true; }
    which.appendChild(o);
  });
  which.addEventListener("change", function () { endWait(); at = Number(which.value); paint(); note(""); });
  box.appendChild(row("Console", c.every
    ? "One set of keys for every console in this list, on RetroArch's own names for the buttons. A console keeps any key you gave it alone: choose it here to see its buttons."
    : "Whose keys these are. A console you changed says (yours)." + (c.note ? " " + c.note : ""), which, "every console all consoles at once"));

  // A console's button follows Every console's key where that one has been set, RetroArch's where not.
  var follows = !c.every && c.buttons.some(function (x) { return x.every; });
  c.buttons.forEach(function (btn) {
    var mine = btn.key !== btn.own, whose = btn.every ? "Every console's" : "RetroArch's";
    var b = el("button", "padbtn keybtn" + (mine ? " moved" : ""), keyWords(btn.key));
    b.type = "button";
    b.addEventListener("click", function (e) { e.stopPropagation(); wait(c, btn, b); });
    box.appendChild(row(btn.name,
      mine ? "Yours. " + whose + " is " + keyWords(btn.own) + "." : whose + ": " + keyWords(btn.own) + ". Choose, then press the key you want.", b, c.platform));
  });

  var back = follows ? "Every console's keys" : "RetroArch's keys";
  var reset = el("button", null, back);
  reset.type = "button";
  reset.disabled = !c.buttons.some(function (x) { return x.key !== x.own; });
  reset.addEventListener("click", function () {
    endWait();
    var now = {};
    c.buttons.forEach(function (x) { now[x.sends] = x.own; });
    L("PADS", c.platform + " keys back to " + back);
    save(c, now, c.platform + " is back on " + (follows ? "Every console's keys." : "RetroArch's own keys."));
  });
  box.appendChild(row(back, c.every ? "Every button back on the key RetroArch has for it, on each console that has no key of its own there."
    : "Every " + c.platform + " button back on the key " + (follows ? "it has without this console's own: Every console's, or RetroArch's." : "RetroArch has for it."), reset));
}

/* The consoles and their keys as the server has them, Every console first, and the part painted from them.
   `again` is the read after an Every console save: it leaves the line that says what was kept. */
function read(again) {
  var which = again ? "read again" : "read";
  return api("api/pad-keys.php").then(function (r) {
    if (!box || !box.isConnected) { L("PADS", "keys " + which + ": the screen had gone, nothing drawn"); return; }
    if (!r || !r.ok) {
      L("PADS", "keys " + which + ": the consoles could not be read: " + ((r && r.error) || "no answer"));
      note("Could not read the consoles: " + ((r && r.error) || "no answer"), true);
      return;
    }
    // A listen begun while this was on its way holds the rows as they were: ended, so no row shows one key and listens for another.
    if (again && waiting) {
      endWait();
      L("PADS", "keys read again: a listen begun meanwhile was ended, its row would have shown the old key");
      note("The keys were read again, so that listen ended: choose the button again.");
    }
    hot = r.hot || {};
    consoles = r.consoles || [];
    if (!consoles.length) {
      note("None of your consoles can have their keys set here yet: none of them is played by RetroArch with buttons Xsegon knows.");
      return;
    }
    if (r.every) { consoles.unshift({ platform: "Every console", every: true, buttons: r.every.buttons, mine: r.every.mine }); }
    // Said at the first read only: after a save it would take the place of the line that says what was kept.
    if (!r.read && !again) { note("RetroArch's own settings could not be read, so its usual keys are shown."); }
    L("PADS", "keys " + which + ": " + consoles.length + " in the list" + (r.read ? "" : ", RetroArch's own settings could not be read (its usual keys are shown)"));
    at = Math.min(at, consoles.length - 1);
    paint();
  });
}

/* The keyboard part of RetroArch + Emulator Controls, filled once the consoles are in. */
export function padKeysPage(part) {
  box = part;
  box.appendChild(el("p", "group-help pad-intro",
    "Your keys for games in RetroArch. Every console sets a key once for all the consoles in the list; choose a console to give it keys of its own. " +
    "Choose a button, then press the key you want on your keyboard; " +
    "the button that had that key takes this one's old key. Kept for those games from their next start. " +
    "The keys RetroArch keeps for its hotkeys (Esc to quit, F1 for its menu and the like) cannot be chosen, and nothing in RetroArch's own settings is changed."));
  box.appendChild(el("p", "pad-note"));
  read();
}
