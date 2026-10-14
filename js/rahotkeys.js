/*  Settings > RetroArch + Emulator Controls > RetroArch (Hotkeys and turbo):
    what RetroArch listens to for leaving a game, pausing, saving and turbo,
    read from its own settings (api\controls.php?hotkeys=1, includes\rahotkeys.php).
    The menu, quit and turbo rows also take a choice of yours, kept by
    api\ra-hotkeys.php and handed to RetroArch as a game starts, never written
    into RetroArch's own file. The other rows are read only.
    Pressing a button is a small button beside the list, never an entry in it:
    Settings steps a list with left and right, so a listening entry would be
    stepped onto and the next press taken as the menu button. */

import { iconEl } from "./icons.js";
import { padSeen, padWaitKey, padWaitNothing, padWaitWords } from "./input.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { padListen, padListenEnd } from "./padlisten.js";
import { STD } from "./padmap.js";
import { setBarTo } from "./settings-nav.js";
import { sound } from "./sound.js";
import { el } from "./util.js";

/*  The browser's standard pad layout, index by index, as the sdl2 driver's raw
    numbers (RetroArch's Xbox profile in autoconfig\sdl2; the Xbox button is 16
    here and 5 there). LT and RT are sticks to sdl2, so they have no number. */
var SDL2 = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 9, 5: 10, 8: 4, 9: 6, 10: 7, 11: 8, 12: 11, 13: 12, 14: 13, 15: 14, 16: 5 };
var CATCH_MS = 12000;         // a wait nobody answers ends by itself
var LISTEN = "Press it...";

var offer = null, say = null, waiting = null;

/* RetroArch by itself; given a page name (hotkeys, turbo), walked there when the
   pinned jump holds, else opened plain with the reason said. A click event in place of a page means no page. */
export function openRetroArch(page) {
  if (typeof page !== "string") { page = ""; }
  L("CTRL", "open retroarch" + (page ? " at " + page : ""));
  postJson("api/retroarch.php", page ? { page: page } : {})
    .then(function (r) {
      L("CTRL", "open retroarch: " + (!r.ok ? "refused, " + (r.error || "no answer")
        : r.jump ? "walking to " + r.where : "plain" + (r.note ? ", no jump: " + r.note : "")));
      showStrip(!r.ok ? (r.error || "could not open RetroArch")
        : r.jump ? "RetroArch is opening at " + r.where
        : "RetroArch is opening" + (r.note ? ". No jump: " + r.note : ""), !r.ok);
    });
}

/* Where a row is changed, in RetroArch's own words: the page, then its name there. */
export function hotkeyPlace(h, hot) {
  return (h.page || hot.where) + " > " + h.ra;
}

function note(words, bad, hearing) {
  if (!say || !say.isConnected) { return; }
  say.textContent = words;
  say.classList.toggle("bad", !!bad);
  say.classList.toggle("hearing", !!hearing);
}

/*  One wait for a pad press, whoever asked (the menu row, a turbo row, a game's
    Buttons screen); Esc or twelve seconds end it. `what` names it in the log,
    `forWhat` on screen; done(k) gets the browser's button number. Answers the
    cancel. A key pressed meanwhile is answered, not left to walk the list behind. */
function listenFor(b, what, forWhat, sayIt, done) {
  var w = {
    timer: setTimeout(function () {
      end();
      L("HOTK", what + ": nothing pressed in " + (CATCH_MS / 1000) + "s, left as it was" + (padSeen() ? "" : " (no controller seen)"));
      sayIt(padWaitNothing(), !padSeen());
    }, CATCH_MS),
    key: padWaitKey(what, function (words, bad) { sayIt(words, bad, true); },
                    function () { end(); L("HOTK", what + ": cancelled with Esc"); sayIt("Left as it was."); })
  };
  function end() {
    clearTimeout(w.timer);
    document.removeEventListener("keydown", w.key, true);
    padListenEnd(w.listen);
    b.textContent = LISTEN;
    b.classList.remove("catching");
    if (waiting === w) { waiting = null; }
  }
  w.end = end;
  if (waiting) { waiting.end(); }
  waiting = w;
  b.textContent = "Press a button...";
  b.classList.add("catching");
  sayIt(padWaitWords(forWhat), false, true);
  L("HOTK", what + ": listening for a pad button" + (padSeen() ? "" : " (no controller seen yet)"));
  document.addEventListener("keydown", w.key, true);
  w.listen = padListen(function (k) { end(); done(k); }, function () {
    // Another row took the listen: this one goes back to its button.
    end();
    L("HOTK", what + ": another row is listening now, left as it was");
    sayIt("Left as it was: another one is being set now.");
  }, what);
  return end;
}

function endWait() { if (waiting) { waiting.end(); } }

// Settings closing ends a hotkey or turbo listen too: its key listener is this page's own.
export function cancelHotkeyWait() { endWait(); }

/* The small button beside a list that listens for a press. */
function listenButton(title) {
  var b = el("button", "hk-listen", LISTEN);
  b.type = "button";
  b.title = title;
  return b;
}

/* A list and its listening button, side by side, the list first so Settings works the list. */
function withListen(list, b) {
  var box = el("div", "hk-ctl");
  box.appendChild(list);
  box.appendChild(b);
  return box;
}

/* What choosing a single button means, said when it is chosen. */
function btnWarn(n) {
  var w = n === 5 ? "The Xbox button is also the Game Bar's and Steam's button: if one of those opens too, turn its use of it off there, or pick a combo. " : "";
  if (offer && offer.xbox && !offer.xbox.ok) { w += offer.xbox.why + " "; }
  if (offer && offer.ungated && offer.ungated.length) {
    w += "With the menu on its own button, Hotkey Enable is freed for that run, so these stop needing it held: " + offer.ungated.join(", ") + ".";
  }
  return w;
}

function btnName(n) {
  return offer && offer.names && offer.names[n] ? " (" + offer.names[n] + " on an Xbox pad)" : "";
}

/* Keep one choice (null is RetroArch's own again); the select snaps back when the server says no. */
function keep(slot, choice, list, after) {
  var body = {};
  body[slot] = choice;
  postJson("api/ra-hotkeys.php", body)
    .then(function (r) {
      if (!r.ok) {
        L("HOTK", slot + " not kept: " + (r.error || "no answer"));
        note("Not kept: " + (r.error || "the server said no"), true);
        list.value = list.dataset.was;
        return;
      }
      sound("select");
      list.dataset.was = list.value;
      after(r);
    });
}

function chose(slot, list) {
  endWait();
  var name = slot === "menu" ? "Open RetroArch's menu" : "Quit the game";
  var v = list.value;
  if (v === "") {
    keep(slot, null, list, function () { note(name + " is RetroArch's own again from the next launch."); L("HOTK", slot + " = RetroArch's own"); });
    return;
  }
  var m = v.split(":");
  var choice = m[0] === "btn" ? { kind: "button", btn: Number(m[1]) } : { kind: "combo", combo: Number(m[1]) };
  keep(slot, choice, list, function (r) {
    var words = (r.words && r.words[slot]) || "that";
    note(name + ": " + words + " from the next launch, when Xsegon starts the game. " +
         (m[0] === "btn" ? btnWarn(choice.btn) : "A combo needs no Hotkey Enable held."));
    L("HOTK", slot + " = " + words);
  });
}

/* The choice itself: RetroArch's own, the Xbox button or a combo from the
   list, and for the menu a press on the pad from the button beside it. */
function picker(slot) {
  var list = el("select", "hk-pick");
  var own = el("option", null, "RetroArch's own setting");
  own.value = "";
  list.appendChild(own);
  if (slot === "menu") {
    var xb = el("option", null, "The Xbox button");
    xb.value = "btn:5";
    list.appendChild(xb);
  }
  (offer.combos || []).forEach(function (c) {
    var o = el("option", null, c.words);
    o.value = "combo:" + c.value;
    list.appendChild(o);
  });
  function ensure(n) {            // a button that is not on the list gets an entry of its own
    if (list.querySelector('option[value="btn:' + n + '"]')) { return; }
    var o = el("option", null, "Pad button " + n + btnName(n));
    o.value = "btn:" + n;
    list.appendChild(o);
  }
  var c = offer.choices && offer.choices[slot];
  if (c && c.kind === "button") { ensure(c.btn); }
  list.value = c ? (c.kind === "combo" ? "combo:" + c.combo : "btn:" + c.btn) : "";
  list.dataset.was = list.value;
  list.addEventListener("click", function (e) { e.stopPropagation(); });
  list.addEventListener("change", function () { chose(slot, list); });
  if (slot !== "menu") { return list; }

  var b = listenButton("Press the pad button you want for RetroArch's menu");
  b.addEventListener("click", function (e) {
    e.stopPropagation();
    listenFor(b, "menu", "RetroArch's menu", note, function (k) {
      if (!list.isConnected) { return; }
      var n = SDL2[k];
      if (n === undefined) {
        L("HOTK", "menu: button " + k + " is a trigger, not a button to the pad driver; left as it was");
        note("That one is a trigger, which the pad driver reads as a stick, not a button: pick another, or a combo.", true);
        return;
      }
      ensure(n);
      list.value = "btn:" + n;
      chose(slot, list);
    });
  });
  return withListen(list, b);
}

/*  The three turbo pickers, one choice across them, shared with a game's
    Buttons screen. The button and the speed sleep until turbo is on.
    opts: own (the kept choice or null), first (the unset option's words),
    cleared (said when the choice is taken away), who (whose turbo, for the
    log: "" here, "game <title>: " on a game's screen), pad and padIds
    (RetroPad names and ids in RetroArch's order), say(words, bad), and
    post(choice or null, then(ok)). Answers on, btn (the list and its
    listening button together), spd, and cancel. */
export function turboPickers(opts) {
  var t = opts.own ? JSON.parse(JSON.stringify(opts.own)) : null;
  var who = opts.who || "";
  var on = el("select", "hk-pick"), btn = el("select", "hk-pick"), spd = el("select", "hk-pick");
  var hear = listenButton("Press the pad button you want as the Turbo button");
  var stop = null;               // the wait in progress, when there is one

  [[on, [["", opts.first], ["off", "Off when Xsegon starts a game"],
         ["on:0", "On: hold the Turbo button and a button"],
         ["on:2", "On: the Turbo button toggles one button's rapid fire"]]],
   [btn, [["", "No Turbo button"]].concat(opts.padIds.map(function (x, i) { return [String(i), opts.pad[i]]; }))],
   [spd, [["", "RetroArch's own speed"], ["3", "A press every 3 frames (fast)"],
          ["6", "A press every 6 frames"], ["10", "A press every 10 frames (gentle)"]]]
  ].forEach(function (pair) {
    pair[1].forEach(function (o) { var x = el("option", null, o[1]); x.value = o[0]; pair[0].appendChild(x); });
    pair[0].addEventListener("click", function (e) { e.stopPropagation(); });
  });

  function words(c) {
    if (!c) { return opts.first; }
    if (c.set === "off") { return "off"; }
    return (c.mode === 2 ? "on, the Turbo button switches one button's rapid fire on and off" : "on, hold the Turbo button and a button")
      + (c.bind !== null && c.bind !== undefined ? ", Turbo on " + opts.pad[c.bind] : ", no Turbo button yet")
      + (c.period ? ", a press every " + c.period + " frames" : "");
  }
  function paint() {
    var isOn = !!t && t.set === "on";
    on.value = !t ? "" : (t.set === "off" ? "off" : "on:" + (t.mode || 0));
    btn.disabled = !isOn;
    spd.disabled = !isOn;
    hear.disabled = !isOn;
    btn.title = isOn ? "" : "Turbo has to be on first.";
    spd.title = btn.title;
    btn.value = isOn && t.bind !== null && t.bind !== undefined ? String(t.bind) : "";
    spd.value = isOn && t.period ? String(t.period) : "";
    if (spd.selectedIndex < 0) {   // a speed kept by hand that is not on the list
      var x = el("option", null, "A press every " + t.period + " frames");
      x.value = String(t.period);
      spd.appendChild(x);
      spd.value = String(t.period);
    }
  }
  function cancel() { if (stop) { stop(); stop = null; } }
  function post(next) {
    cancel();
    opts.post(next, function (ok, why) {
      if (ok) { t = next; sound("select"); L("HOTK", who + "turbo = " + words(t)); }
      else { L("HOTK", who + "turbo not kept: " + (why || "no answer")); }
      paint();
      if (ok) { opts.say(next === null ? opts.cleared : "Turbo: " + words(t) + ". From the next launch, when Xsegon starts the game."); }
    });
  }
  function carry(part) {         // the choice as it stands, with one part changed
    var next = { set: "on", mode: t.mode,
                 bind: t.bind === undefined ? null : t.bind,
                 period: t.period === undefined ? null : t.period };
    Object.keys(part).forEach(function (k) { next[k] = part[k]; });
    return next;
  }
  on.addEventListener("change", function () {
    if (on.value === "") { post(null); return; }
    if (on.value === "off") { post({ set: "off" }); return; }
    var mode = Number(on.value.split(":")[1]);
    post(t && t.set === "on" ? carry({ mode: mode }) : { set: "on", mode: mode, bind: null, period: null });
  });
  // Asleep means asleep: Settings steps a list with left and right whether or
  // not it is disabled, so a nudge on a sleeping one is put back, not sent.
  function awake() {
    if (t && t.set === "on") { return true; }
    paint();
    opts.say("Turbo has to be on first.");
    return false;
  }
  btn.addEventListener("change", function () { if (awake()) { post(carry({ bind: btn.value === "" ? null : Number(btn.value) })); } });
  spd.addEventListener("change", function () { if (awake()) { post(carry({ period: spd.value === "" ? null : Number(spd.value) })); } });
  hear.addEventListener("click", function (e) {
    e.stopPropagation();
    if (!awake()) { return; }
    stop = listenFor(hear, who + "turbo button", "the Turbo button", opts.say, function (k) {
      stop = null;
      var i = opts.padIds.indexOf(STD[k]);
      if (i < 0) {
        L("HOTK", who + "turbo button: button " + k + " is not one a console has; left as it was");
        opts.say("That one is not a button a console has: pick another.", true);
        return;
      }
      post(carry({ bind: i }));
    });
  });

  paint();
  return { on: on, btn: withListen(btn, hear), spd: spd, cancel: cancel };
}

function row(h, hot, tp) {
  var r = el("div", "opt hkrow" + (h.set ? "" : " hk-unset"));
  r.dataset.hotkey = h.id;
  r.appendChild(iconEl("opt-ico", "gamepad"));
  var slot = h.id === "menu_toggle" ? "menu" : (h.id === "exit_emulator" ? "quit" : null);
  if (slot && (!offer || offer.none)) { slot = null; }
  var turbo = tp ? { turbo_enable: tp.on, turbo_button: tp.btn, turbo_speed: tp.spd }[h.id] : null;
  var l = el("label");
  l.appendChild(document.createTextNode(h.name));
  // What a choice is and where it goes is said once, at the head of the
  // section, not on each of the five rows that take one.
  var hint = "In RetroArch: " + hotkeyPlace(h, hot) + "." + (h.note ? " " + h.note : "") +
    (h.id === "turbo_enable" && turbo ? " In the toggle way the button that fires is RetroArch's own Turbo Button setting, B as it comes." : "");
  l.appendChild(el("span", "hint", hint));
  r.appendChild(l);
  if (slot || turbo) {
    var cell = el("div", "hk-set");
    cell.appendChild(el("span", "hk-val", h.value));
    cell.appendChild(turbo || picker(slot));
    r.appendChild(cell);
  } else {
    r.appendChild(el("span", "hk-val", h.value));
  }
  r.dataset.find = (h.name + " " + h.value + " " + hint + " retroarch hotkey hotkeys exit quit leave pause turbo" +
    (slot || turbo ? " change choose combo press" : "") + (slot ? " xbox button" : "")).toLowerCase();
  r.addEventListener("mousemove", function () { setBarTo("page", r); });
  return r;
}

/* The RetroArch hotkeys part of the Controls page, filled once they are read. */
export function hotkeysPage(part) {
  part.appendChild(el("p", "group-help pad-intro",
    "What RetroArch listens to for leaving a game, pausing, saving and turbo, read from RetroArch's own settings. " +
    "The menu, quit and turbo rows take a choice of yours, applied when Xsegon starts a game and never written into " +
    "RetroArch: what RetroArch itself has stays shown above each choice, and holds while nothing is chosen. " +
    "One game's own buttons and turbo live on its details > Buttons screen. " +
    "Everything else is changed in RetroArch, on the page named under it."));
  say = el("p", "pad-note");
  part.appendChild(say);
  Promise.all([api("api/controls.php?hotkeys=1"), api("api/ra-hotkeys.php")]).then(function (both) {
    var res = both[0];
    offer = both[1] && both[1].ok ? both[1] : null;
    var hot = res && res.hotkeys;
    if (!res || !res.ok || !hot) {
      say.textContent = (res && res.note) || "RetroArch's settings could not be read.";
      L("HOTK", "the hotkeys page has nothing to show: " + say.textContent);
      return;
    }
    if (!offer) { L("HOTK", "the choices could not be read (" + ((both[1] && both[1].error) || "no answer") + "), so the rows are read only"); }
    part.appendChild(el("p", "hk-sub", "Leaving and pausing a game"));
    hot.leave.forEach(function (h) { part.appendChild(row(h, hot)); });
    part.appendChild(el("p", "hk-sub", "Turbo fire"));
    /* The global turbo choice: unset says nothing, and RetroArch's turbo fires
       nothing without a Turbo button, so it is off until asked for. A game's own choice wins. */
    var tp = offer && !offer.none && offer.pad ? turboPickers({
      own: (offer.choices && offer.choices.turbo) || null,
      first: "RetroArch's own setting",
      cleared: "Turbo is RetroArch's own again from the next launch.",
      pad: offer.pad,
      padIds: offer.padIds,
      say: note,
      post: function (choice, then) {
        postJson("api/ra-hotkeys.php", { turbo: choice }).then(function (r) {
          if (!r.ok) { note("Not kept: " + (r.error || "the server said no"), true); }
          then(!!r.ok, r.error);
        });
      }
    }) : null;
    (hot.turbo || []).forEach(function (h) { part.appendChild(row(h, hot, tp)); });
    part.appendChild(el("p", "hk-sub", "Other hotkeys that are set"));
    hot.other.forEach(function (h) { part.appendChild(row(h, hot)); });

    var open = el("div", "opt hkrow hk-open");
    open.appendChild(iconEl("opt-ico", "external"));
    var l = el("label");
    l.appendChild(document.createTextNode("Change them"));
    var words = "The rest are changed in RetroArch itself. " +
      (hot.unset ? hot.unset + " more " + (hot.unset === 1 ? "hotkey is" : "hotkeys are") + " not set. " : "") +
      "A core with settings of its own can differ: right-click one of its games > Emulation > Controls shows that." +
      (offer && offer.jump ? (offer.jump.ok
        ? " This RetroArch is the one the routes were read on, so the button walks it to Settings > Input > Hotkeys by itself."
        : " The button opens RetroArch plain: " + offer.jump.why + ".") : "");
    l.appendChild(el("span", "hint", words));
    open.appendChild(l);
    var b = el("button", null, "Open RetroArch");
    b.type = "button";
    b.addEventListener("click", function (e) { e.stopPropagation(); openRetroArch("hotkeys"); });
    open.appendChild(b);
    open.dataset.find = ("change them open retroarch " + words + " hotkeys").toLowerCase();
    open.addEventListener("mousemove", function () { setBarTo("page", open); });
    part.appendChild(open);
    L("HOTK", "hotkeys page: " + hot.leave.length + " leaving, " + (hot.turbo || []).length + " turbo, " + hot.other.length +
      " others set; yours: " + (offer ? (Object.keys(offer.words || {}).map(function (k) { return k + "=" + offer.words[k]; }).join(", ") || "none") : "unread") +
      "; jump " + (offer && offer.jump ? (offer.jump.ok ? "offered" : "not offered") : "unknown"));
  });
}
