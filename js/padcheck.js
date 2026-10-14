/*  Settings > Xsegon Controls: a picture of a controller that lights as you
    press, in two windows.

    Controller check: which controllers Xsegon has found, what each was read
    as, and whether every button, trigger and stick arrives where it should.
    Under the picture is every button and stick by its number, which is what
    a pad outside the usual layout needs. A press only lights.

    Xsegon's buttons: the same picture beside the seven things a button does
    in Xsegon's own screens, in sections like a page of Settings. Choose
    one, press the button you want for it; the job that button had takes
    the one left free (js\padjobs.js). Kept for each kind of controller.

    While either is open the pad drives nothing behind it (holdPad,
    js\input.js). Out by Esc, Close, Start held for a second, or by itself
    after a minute with nothing pressed, so a pad alone can always leave. */

import { closeEditor, setEditorOnClose } from "./editors.js";
import { padMode, paintHelpAgain, paintHelpHere } from "./help.js";
import { iconEl } from "./icons.js";
import { holdPad, padWaitKey } from "./input.js";
import { L } from "./log.js";
import { padFacts, padMeasure, padStatWords, padStatsNew } from "./padfacts.js";
import { padsAsk } from "./padfound.js";
import { openPadGameHelp } from "./padhelp.js";
import { PAD_JOBS, PAD_JOB_BUTTONS, padJobKey, padJobSet, padJobsFor, padJobsOwn, padJobsStandard } from "./padjobs.js";
import { padButtonWord, padFace, padKindOf, padKindWord, padNamesFor } from "./padkind.js";
import { padsNow } from "./padlist.js";
import { padPicture } from "./padpic.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor, S } from "./state.js";
import { el } from "./util.js";

var HOLD_MS = 1000;          // Start held this long leaves
var IDLE_MS = 60000;         // and so does this long with nothing pressed
var LISTEN_MS = 12000;       // a wait for a button that nobody answers ends by itself
var REACH = 10;              // how far a stick's knob travels in the picture
// Said with no controller in the picture: under it, and in the box of what is known.
var OPENING = "A controller shows up here once one of its buttons has been pressed with Xsegon in front. Keyboard keys light nothing here.";
var NOTHING_YET = "Nothing to tell until a controller has pressed a button.";

/* Xsegon's buttons, in the sections they are shown in: each job's icon and
   a line on what it does, in the order of PAD_JOBS. */
var JOB_SECTS = [
  { name: "Choosing", rows: [
    ["check", "Starts a game, opens what the bar is on, says yes."],
    ["back", "Out of a window or a menu, and from a console back to the consoles."]] },
  { name: "On a game", rows: [
    ["info", "Opens the chosen game's details."],
    ["lines", "Opens the chosen game's menu, or a console's. Inside details, its documents."]] },
  { name: "Getting around", rows: [
    ["jumpBack", "A jump back through a list of games. In details, the tab before."],
    ["jumpOn", "A jump forward through a list of games. In details, the next tab."],
    ["window", "Puts the bar on the menus and buttons at the top of the screen, and brings it back."]] }
];

var ui = null;               // the window while it is open

// The picture for one pad, its face buttons in a kind's names (js\padpic.js draws it).
function picture(kind, level, hasTouch) { return padPicture(kind, level, hasTouch, function (n) { return padFace(kind, n); }); }

function pressed(pad) {
  for (var k = 0; k < pad.buttons.length; k++) { if (pad.buttons[k] && pad.buttons[k].pressed) { return true; } }
  return false;
}

// What is said about the pad in the picture: what it was read as, and its layout.
function words(pad) {
  var kind = padKindOf(pad.id), names = padNamesFor(pad.id);
  var said = kind ? "Read as " + padKindWord(kind) + "." : "Not a kind Xsegon knows: Xbox names are shown.";
  if ((kind || "xbox") !== names) { said += " Button names are set to " + (padKindWord(names) || "By position") + " in Settings."; }
  said += pad.listed ? " The browser does not know it: read as " + pad.listed + ", from the shared controller list."
        : pad.mapping === "standard" ? " In the usual layout."
        : " Not in the usual layout: a button may light somewhere other than where you pressed." + (ui.mode === "check" ? " Its numbers are under What it sends." : "");
  return said;
}

// What a drawing was made from: another pad, or other names for the same one, means drawing again.
function madeFrom(pad, at) {
  return at + "|" + pad.id + "|" + padNamesFor(pad.id) + "|" + pad.mapping + "|" + pad.buttons.length + "|" + pad.axes.length;
}

// Every button and stick the pad reports, by number.
function numbers(pad) {
  ui.nums.textContent = "";
  var byButton = el("div", "pp-line"), byStick = el("div", "pp-line");
  byButton.appendChild(el("span", "pp-cap", "Buttons"));
  for (var k = 0; k < pad.buttons.length; k++) { byButton.appendChild(el("span", "pp-n", String(k))); }
  byStick.appendChild(el("span", "pp-cap", "Sticks"));
  for (var a = 0; a < pad.axes.length; a++) {
    var bar = el("span", "pp-ax");
    bar.title = "axis " + a;
    bar.appendChild(el("i"));
    byStick.appendChild(bar);
  }
  ui.nums.appendChild(byButton);
  ui.nums.appendChild(byStick);
  ui.pills = Array.prototype.slice.call(ui.nums.querySelectorAll(".pp-n"));
  ui.bars = Array.prototype.slice.call(ui.nums.querySelectorAll(".pp-ax i"));
}

// One line of what is known: an icon, what the line is, and what was found (the part that is handed back).
function infoRow(box, f) {
  var r = el("div", "pi-row");
  r.appendChild(iconEl("opt-ico", f[0]));
  r.appendChild(el("span", "pi-k", f[1]));
  r.appendChild(el("span", "pi-v", f[2]));
  box.appendChild(r);
  return r.lastChild;
}

function deadZone() { return (S.controller && S.controller.deadzone) || 0.35; }

// To the window that says how a controller is put right inside games (js\padhelp.js); the way back to Settings goes with it.
function gameHelpButton() {
  var b = el("button", "pi-go", "Wrong in a game?");
  b.type = "button";
  b.addEventListener("click", function () {
    var keep = ui.after;
    ui.after = null;
    shut();
    openPadGameHelp(keep);
  });
  return b;
}

// Rumble is felt, not seen: a press shakes the pad in the picture for half a second.
function shakeButton() {
  var b = el("button", "pi-go", "Test");
  b.type = "button";
  b.addEventListener("click", function () {
    var pad = (padsNow())[ui.shown], act = pad && pad.vibrationActuator;
    if (!act) { return; }
    Promise.resolve(act.playEffect(act.type, { duration: 500, strongMagnitude: 0.8, weakMagnitude: 0.6 })).then(
      function (how) { L("PAD", "check: rumble asked of " + pad.id + ": " + how); },
      function (e) { L("PAD", "check: rumble refused by " + pad.id + ": " + ((e && e.message) || e)); b.textContent = "Refused"; });
  });
  return b;
}

// The lines kept out of sight, shown and hidden by a press: as chosen for as long as the window is open.
function moreButton(rows) {
  var b = el("button", "pi-go", ui.more ? "Hide" : "Show");
  b.type = "button";
  b.addEventListener("click", function () {
    ui.more = !ui.more;
    b.textContent = ui.more ? "Hide" : "Show";
    rows.forEach(function (r) { r.hidden = !ui.more; });
    b.parentNode.parentNode.classList.toggle("pi-end", !ui.more);
  });
  return b;
}

/* What is known of the pad in the picture (js\padfacts.js): the lines looked at most, the rest behind
   More, which names them. The lines that move with the pad are in a box of their own. */
function facts(pad, at) {
  ui.facts.textContent = "";
  var all = padFacts(pad, at), rest = all.filter(function (f) { return f[3]; }), rows = [];
  all.forEach(function (f) { if (!f[3]) { infoRow(ui.facts, f); } });
  infoRow(ui.facts, ["play", "In games", "RetroArch reads a controller by itself."]).appendChild(gameHelpButton());
  var more = infoRow(ui.facts, ["info", "More", rest.map(function (f) { return f[1]; }).join(", ")]);
  more.parentNode.classList.toggle("pi-end", !ui.more);
  rest.forEach(function (f) {
    var found = infoRow(ui.facts, f);
    found.parentNode.hidden = !ui.more;
    rows.push(found.parentNode);
    if (f[1] === "Rumble" && pad.vibrationActuator) { found.appendChild(shakeButton()); }
  });
  more.appendChild(moreButton(rows));
  ui.stats = padStatsNew();
  ui.live.textContent = "";
  ui.lives = padStatWords(ui.stats, pad, deadZone()).map(function (f) { return infoRow(ui.live, f); });
}

// The lines that move: counted at every look, written only when their words change.
function measure(pad, now) {
  padMeasure(ui.stats, pad, now);
  padStatWords(ui.stats, pad, deadZone()).forEach(function (f, i) {
    if (ui.lives[i] && ui.lives[i].textContent !== f[2]) { ui.lives[i].textContent = f[2]; }
  });
}

// A new pad in the picture: its drawing, its words, and beside it what is known of it or its jobs.
function draw(pad, at) {
  var names = padNamesFor(pad.id);
  ui.shown = at;
  ui.drawn = madeFrom(pad, at);
  ui.names = names;
  ui.stage.innerHTML = picture(names, names === "playstation", pad.buttons.length > 17);
  ui.name.textContent = pad.id;
  ui.said.textContent = words(pad);
  ui.lit = Array.prototype.slice.call(ui.stage.querySelectorAll("[data-b]"));
  ui.pulls = Array.prototype.slice.call(ui.stage.querySelectorAll("[data-pull]"));
  ui.knobs = Array.prototype.slice.call(ui.stage.querySelectorAll("[data-axis]"));
  ui.marks = Array.prototype.slice.call(ui.stage.querySelectorAll("[data-b], [data-mark]"));
  if (ui.mode === "check") { numbers(pad); facts(pad, at); } else { ui.key = padJobKey(pad.id); jobsShow(); }
  ui.met[pad.id] = true;
  // Which one of how many, and its port: two of one model read alike in every other word of the line.
  var nth = 0, found = 0;
  Array.prototype.forEach.call(padsNow(), function (p, i) { if (p && p.buttons.length) { found++; if (i <= at) { nth = found; } } });
  L("PAD", ui.mode + ": showing " + pad.id + ", read as " + (padKindOf(pad.id) || "unknown") + ", names " + names + ", as Controller " + nth + " of " + found + ", port " + (at + 1));
}

// The last controller is gone: the picture and its boxes as at an opening, saying what happened.
function emptied() {
  ui.shown = null;
  ui.drawn = "";
  ui.names = "xbox";
  ui.stage.innerHTML = picture("xbox", false, false);
  ui.name.textContent = "That controller is gone: switched off, unplugged or out of reach.";
  ui.said.textContent = OPENING;
  ui.lit = []; ui.pulls = []; ui.knobs = []; ui.marks = []; ui.pills = []; ui.bars = []; ui.lives = [];
  ui.facts.textContent = "";
  ui.facts.appendChild(el("p", "mt-note", NOTHING_YET));
  ui.live.textContent = "";
  ui.nums.textContent = "";
}

function light(pad) {
  ui.lit.forEach(function (g) {
    var bt = pad.buttons[Number(g.dataset.b)];
    g.classList.toggle("on", !!(bt && bt.pressed));
  });
  ui.pulls.forEach(function (r) {
    // A trigger that only says pressed or not is drawn full.
    var bt = pad.buttons[Number(r.dataset.pull)], h = Math.round(24 * Math.max(0, Math.min(1, (bt && (bt.value || (bt.pressed ? 1 : 0))) || 0)));
    r.setAttribute("height", String(h));
    r.setAttribute("y", String(Number(r.dataset.foot) - h));
  });
  ui.knobs.forEach(function (c) {
    var a = Number(c.dataset.axis), x = pad.axes[a] || 0, y = pad.axes[a + 1] || 0;
    c.setAttribute("transform", "translate(" + (x * REACH).toFixed(1) + " " + (y * REACH).toFixed(1) + ")");
  });
  ui.pills.forEach(function (p, k) { p.classList.toggle("on", !!(pad.buttons[k] && pad.buttons[k].pressed)); });
  ui.bars.forEach(function (i, a) { i.style.left = (((pad.axes[a] || 0) + 1) * 50).toFixed(1) + "%"; });
}

/* The controllers found, one chip each, numbered as they stand now (one that goes leaves no gap; its
   port is among what is known of it): the one in the picture is marked, and a click chooses another. */
function chips(pads) {
  var sum = pads.map(function (p, i) { return p && p.buttons.length ? i + ":" + p.id : ""; }).join("|") + "@" + ui.shown;
  if (sum === ui.chipsFor) { return; }
  ui.chipsFor = sum;
  ui.pads.textContent = "";
  var nth = 0;
  pads.forEach(function (p, i) {
    if (!p || !p.buttons.length) { return; }
    var c = el("button", "pp-chip" + (i === ui.shown ? " on" : ""), "Controller " + (++nth) + ": " + (padKindWord(padKindOf(p.id)) || "not known"));
    c.type = "button";
    c.title = p.id;
    c.addEventListener("click", function () { if (!ui.wait) { ui.shown = i; ui.drawn = ""; ui.heard = Date.now(); } });
    ui.pads.appendChild(c);
  });
}

/* ---------- Xsegon's buttons ---------- */

function tell(text, bad) {
  ui.told.textContent = text;
  ui.told.classList.toggle("bad", !!bad);
}

function endWait() {
  if (!ui || !ui.wait) { return; }
  document.removeEventListener("keydown", ui.wait.key, true);
  ui.wait = null;
}

// A button in the names of the pad in the picture: its drawing where it has one, then its word.
function keyInto(node, n) {
  var art = n < 4 ? padFace(ui.names, n).art : null;
  node.innerHTML = art ? '<svg class="pj-key" viewBox="0 0 16 16" aria-hidden="true">' + art + "</svg>" : "";
  node.appendChild(document.createTextNode(padButtonWord(ui.names, n)));
}

// The lines as they stand: which is under the bar, which is listening, and each job's button in this pad's names.
function jobsShow() {
  var jobs = padJobsFor(ui.key), under = PAD_JOBS[ui.bar];
  ui.lines.forEach(function (line, i) {
    var j = PAD_JOBS[i], waiting = !!(j && ui.wait && ui.wait.job === j.job);
    line.classList.toggle("at", i === ui.bar);
    line.classList.toggle("catching", waiting);
    if (j && waiting) { ui.ons[i].textContent = "Press a button..."; }
    else if (j) { keyInto(ui.ons[i], jobs[j.job]); }
  });
  // Off the lines the bar is on Close, drawn once a controller is what moves it.
  ui.done.classList.toggle("pj-at", ui.bar < 0 && ui.steered);
  // On the picture: the button the line under the bar is on.
  ui.marks.forEach(function (g) { g.classList.toggle("pick", !!under && (g.dataset.b || g.dataset.mark) === String(jobs[under.job])); });
  var kind = padKindOf(ui.key);
  ui.whose.textContent = ui.key === "none" ? "Press any button on a controller to set its buttons."
    : "Buttons for " + (kind ? padKindWord(kind) + " controllers" : "this controller") + (padJobsOwn(ui.key) ? ", set by you." : ", as they come.");
}

function listen(j) {
  if (ui.key === "none") { tell("Press a button on a controller first, so Xsegon knows whose buttons these are.", true); return; }
  endWait();
  ui.wait = { job: j.job, label: j.label, until: Date.now() + LISTEN_MS,
              key: padWaitKey("xsegon " + j.job, tell, function () { endWait(); tell("Left as it was."); jobsShow(); }) };
  document.addEventListener("keydown", ui.wait.key, true);
  tell("Listening: press the controller button you want for " + j.label + ". Esc cancels.");
  L("PAD", "buttons: listening for " + j.job + " on " + ui.key);
  jobsShow();
}

// The button pressed while a job listens: taken when it may hold a job, said when it may not.
function take(k) {
  if (PAD_JOB_BUTTONS.indexOf(k) < 0) {
    tell(k >= 12 && k <= 15 ? "The cross always moves in Xsegon, so it cannot take a job: press another button."
                            : "That one is not offered (Start is kept for leaving, the middle button is Windows's own): press another button.", true);
    return;
  }
  var w = ui.wait, key = ui.key, word = padButtonWord(ui.names, k), here = ui;
  endWait();
  padJobSet(key, w.job, k, "Saved: " + w.label + " is on " + word).then(function (moved) {
    if (ui !== here) { return; }               // closed, or turned to the other window, before the answer came
    if (moved === false) { tell("Not saved, so nothing changed.", true); }
    else {
      L("PAD", "buttons: " + key + " " + w.job + " = " + k + (moved ? ", " + moved.job + " takes the one it left" : ""));
      tell(w.label + " is on " + word + " now." + (moved ? " " + moved.label + " took the button it left, so nothing is without one." : ""));
      paintHelpAgain();
    }
    jobsShow();
  });
  jobsShow();
}

function standard() {
  var key = ui.key, here = ui;
  if (key === "none") { tell("Press a button on a controller first, so Xsegon knows whose buttons these are.", true); return; }
  padJobsStandard(key, "Saved: the standard buttons").then(function (gone) {
    if (ui !== here) { return; }
    L("PAD", "buttons: " + key + (gone ? " back to the standard layout" : " not put back, the save did not hold"));
    tell(gone ? "Back to the standard buttons." : "Not saved, so nothing changed.", !gone);
    paintHelpAgain();
    jobsShow();
  });
}

// The buttons that went down on this pad since the last look; a pad's first look spends whatever it holds.
function fresh(pad, at) {
  var before = ui.prev[at], down = pad.buttons.map(function (bt) { return !!(bt && bt.pressed); }), hits = [];
  if (before) { down.forEach(function (d, k) { if (d && !before[k]) { hits.push(k); } }); }
  ui.prev[at] = down;
  return hits;
}

/* The pad in this window: the cross and the left stick walk from Close down
   the lines, the button that says yes starts a line listening (on Close it
   closes), the one that goes back closes. While a line listens the next
   press is its button. */
function steer(pad, at, now) {
  var hits = fresh(pad, at), jobs = padJobsFor(ui.key);
  var y = pad.axes[1] || 0, tilt = y > 0.5 ? 1 : y < -0.5 ? -1 : 0, nudged = tilt !== 0 && tilt !== ui.tilt;
  ui.tilt = tilt;
  if (ui.wait) {
    if (hits.length) { take(hits[0]); }
    else if (now >= ui.wait.until) { endWait(); tell("Nothing was pressed on a controller, so nothing changed."); jobsShow(); }
    return;
  }
  // Until a controller has pressed here the bar on Close is not drawn: its first press draws it.
  var seen = ui.steered;
  if (!seen && (hits.length || nudged)) { ui.steered = true; jobsShow(); }
  var step = hits.indexOf(13) >= 0 || (nudged && tilt > 0) ? 1 : hits.indexOf(12) >= 0 || (nudged && tilt < 0) ? -1 : 0;
  if (step) {
    ui.bar = Math.max(-1, Math.min(ui.lines.length - 1, ui.bar + step));
    ui.byMouse = false;
    (ui.lines[ui.bar] || ui.done).scrollIntoView({ block: "nearest" });
    sound("move");
    jobsShow();
  }
  if (hits.indexOf(jobs.confirm) >= 0) {
    if (PAD_JOBS[ui.bar]) { listen(PAD_JOBS[ui.bar]); }
    else if (ui.bar >= 0) { standard(); }
    else if (seen) { L("PAD", "buttons: yes pressed on Close, leaving"); closeEditor(); }
  }
  else if (hits.indexOf(jobs.back) >= 0) { L("PAD", "buttons: back pressed, leaving"); closeEditor(); }
}

// A box with a heading, as a page of Settings has them.
function boxed(name) {
  var box = el("div", "pj-sect");
  box.appendChild(el("div", "pj-head", name));
  return box;
}

/* The lines: an icon, what the job is, and at the right a small button
   wearing the controller button it is on. The bar follows the pointer over
   them and leaves with it. */
function jobsBuild() {
  function line(box, job, icon, label, hint, caption, run) {
    var i = ui.lines.length, r = el("div", "pj-row" + (job ? "" : " pj-std")), words = el("div", "pj-words"), set = el("button", "pj-set");
    if (job) { r.dataset.job = job; }
    r.appendChild(iconEl("opt-ico", icon));
    words.appendChild(el("span", "pj-job", label));
    words.appendChild(el("span", "pj-hint", hint));
    r.appendChild(words);
    set.type = "button";
    set.appendChild(el("span", "pj-on", caption));
    set.addEventListener("click", function () { ui.bar = i; ui.byMouse = true; run(); });
    r.appendChild(set);
    r.addEventListener("mousemove", function () {
      if (ui.wait || ui.bar === i) { return; }
      ui.bar = i;
      ui.byMouse = true;
      jobsShow();
    });
    box.appendChild(r);
    ui.lines.push(r);
    ui.ons.push(set.firstChild);
  }
  JOB_SECTS.forEach(function (s) {
    var box = boxed(s.name);
    s.rows.forEach(function (look) {
      var j = PAD_JOBS[ui.lines.length];
      line(box, j.job, look[0], j.label, look[1], "", function () { listen(j); });
    });
    ui.jobs.appendChild(box);
  });
  var all = boxed("Putting them back");
  line(all, "", "refresh", "Standard layout", "Every job back on the button it comes on, for this kind of controller.", "Put back", standard);
  ui.jobs.appendChild(all);
  ui.jobs.addEventListener("mouseleave", function () {
    if (!ui || !ui.byMouse || ui.wait) { return; }
    ui.bar = -1;
    ui.byMouse = false;
    jobsShow();
  });
}

/* ---------- both windows ---------- */

function frame() {
  if (!ui) { return; }
  ui.raf = requestAnimationFrame(frame);
  var pads = Array.prototype.slice.call(padsNow());
  var now = Date.now(), at = ui.shown, startDown = false;
  pads.forEach(function (p, i) {
    if (!p || !p.buttons.length) { return; }
    if (pressed(p)) {
      ui.heard = now;
      // The pad that presses takes the picture, unless the one in it is pressed too or a job is listening.
      if (i !== at && !ui.wait && !(pads[at] && pressed(pads[at]))) { at = i; }
    }
    if (p.buttons[9] && p.buttons[9].pressed) { startDown = true; }
  });
  // A controller that goes leaves the picture to one still on; the check, with none left, says it is gone.
  var gone = at !== null && !ui.wait && !(pads[at] && pads[at].buttons.length);
  if (gone) { at = null; }
  if (at === null) { pads.some(function (p, i) { if (p && p.buttons.length) { at = i; return true; } return false; }); }
  var pad = at === null ? null : pads[at];
  if (gone && (pad || ui.mode === "check")) { L("PAD", ui.mode + ": " + ui.name.textContent + " is gone from the browser's list" + (pad ? "" : ", and no other controller is on")); }
  if (pad) {
    if (ui.drawn !== madeFrom(pad, at)) { draw(pad, at); }
    light(pad);
    if (ui.mode === "buttons") { steer(pad, at, now); } else { measure(pad, now); }
    if (!ui) { return; }                     // the button that goes back closed it
  } else if (gone && ui.mode === "check") {
    emptied();
  }
  chips(pads);
  ui.since = startDown ? (ui.since || now) : 0;
  ui.leave.classList.toggle("on", startDown);
  if (startDown && now - ui.since >= HOLD_MS) { L("PAD", ui.mode + ": Start held, leaving"); closeEditor(); return; }
  if (now - ui.heard >= IDLE_MS) { L("PAD", ui.mode + ": nothing pressed for a minute, leaving"); closeEditor(); }
}

/* What Windows lists, under the picture until a controller presses: none detected, or the ones it sees.
   Only words: a press shows the controller whatever was said, and with no answer the words stay as they were. */
function windowsSays(mine, r) {
  if (ui !== mine || ui.shown !== null || !r.asked) { return; }
  // A row of Windows' list is a controller: two of one model are named once, with how many.
  var names = [], many = {}, n = (r.pads || []).length;
  (r.pads || []).forEach(function (p) {
    var name = p.name || (p.xbox ? "an Xbox controller" : "one with no name on record (" + p.vendor + ":" + p.product + ")");
    if (!many[name]) { names.push(name); }
    many[name] = (many[name] || 0) + 1;
  });
  var listed = names.map(function (name) { return name + (many[name] > 1 ? " (" + many[name] + ")" : ""); }).join(", ");
  var keys = " Keyboard keys light nothing here.";
  if (!n) {
    ui.name.textContent = "No controller detected.";
    ui.said.textContent = "Plug one in or switch it on, then press a button on it with Xsegon in front." + keys;
  } else {
    ui.name.textContent = "Windows sees " + (n === 1 ? "a controller: " : n + " controllers: ") + listed + ".";
    ui.said.textContent = "Press a button on " + (n === 1 ? "it" : "one") + " with Xsegon in front and it shows here." + keys;
  }
  L("PAD", ui.mode + ": says " + (n ? "Windows sees " + listed : "no controller detected"));
}

/* A keyboard key in a window that is a controller's: counted for the closing line, and a letter, a digit
   or an arrow is answered in words, since silence here reads as a fault to someone pressing a game's keys. */
function keyed(e) {
  if (!ui || e.key === "Escape") { return; }
  ui.keys++;
  if (ui.wait || e.repeat || e.ctrlKey || e.altKey || e.metaKey || !((e.key.length === 1 && e.key !== " ") || /^Arrow/.test(e.key))) { return; }
  if (!ui.keyTold) { ui.keyTold = true; L("PAD", ui.mode + ": the keyboard's " + e.key + " was pressed: told that this window is a controller's"); }
  tell("That was a key on the keyboard. " + (ui.mode === "check" ? "This picture lights for a controller's buttons only." : "Only a controller's buttons are set here.") +
       " The keys a game takes from the keyboard are in Settings > RetroArch + Emulator Controls > RetroArch (Keyboard).", true);
}

function shut() {
  if (!ui) { return; }
  // What the window found, as it closes: the log's answer to whether a controller was there.
  var ids = Object.keys(ui.met);
  L("PAD", ui.mode + ": closed after " + Math.round((Date.now() - ui.opened) / 1000) + " s: " +
    (ids.length ? "showed " + ids.join("; ") : "no controller pressed a button") + ", " +
    ui.keys + (ui.keys === 1 ? " keyboard key" : " keyboard keys") + " pressed" + (ui.windows ? "; " + ui.windows : ""));
  cancelAnimationFrame(ui.raf);
  endWait();
  $editor.removeEventListener("mousemove", ui.stir);
  $editor.removeEventListener("keydown", ui.stir);
  $editor.removeEventListener("keydown", ui.keyed);
  var after = ui.after;
  ui = null;
  holdPad(false);
  paintHelpHere();             // the screen behind gets its own legend back
  if (after) { after(); }      // opened from Settings: Settings stands there again
}

// `after` is run once the window has closed for good, not when it turns into the other one.
function openWith(mode, after) {
  var check = mode === "check";
  L("ED", check ? "controller check" : "xsegon's buttons");
  stopVideo();
  var inner = el("div", "panel-inner ed-inner padcheck pj-wide");
  var head = el("div", "set-head");
  head.appendChild(el("h1", "panel-title", check ? "CONTROLLER CHECK" : "XSEGON'S BUTTONS"));
  // The other window on the same picture, one press away.
  var other = el("button", null, check ? "Set buttons..." : "Check a controller...");
  other.addEventListener("click", function () {
    var keep = ui.after;
    ui.after = null;
    shut();
    openWith(check ? "buttons" : "check", keep);
  });
  head.appendChild(other);
  var done = el("button", "primary", "Close (esc)");
  done.addEventListener("click", closeEditor);
  head.appendChild(done);
  inner.appendChild(head);
  var pads = el("div", "pp-pads");
  var name = el("p", "pp-name", "Press any button on a controller.");
  var said = el("p", "mt-note", OPENING);
  var stage = el("div", "pp-stage");
  stage.innerHTML = picture("xbox", false, false);
  var nums = el("div", "pp-nums"), whose = el("p", "pp-whose"), jobs = el("div", "pj-sects"), told = el("p", "mt-note pj-told");
  var leave = el("p", "mt-note pp-leave", check
    ? "The controller does nothing else while this is open. To leave: Esc, Close, or hold Start on the controller for a second. It closes by itself after a minute with nothing pressed."
    : "Move with the cross or the left stick, press the button that says yes on a line, then the button you want for it. Or click a line's button. The cross and the left stick always move. To leave: the button that goes back, Esc, Close, or Start held for a second. Only Xsegon's own screens change: games keep their own buttons.");
  // The picture stays at the left, in sight; at the right what is known of the controller, or the jobs.
  var cols = el("div", "pj-cols"), side = el("div", "pj-side"), known = el("div", "pi-list"), live = el("div", "pi-list"), right = jobs;
  if (check) {
    right = el("div", "pj-sects");
    known.appendChild(el("p", "mt-note", NOTHING_YET));
    [["This controller", known], ["What it sends", nums], ["Sticks and triggers", live]].forEach(function (b) { right.appendChild(boxed(b[0])).appendChild(b[1]); });
  }
  (check ? [pads, name, said, stage, told] : [pads, name, said, stage, whose, told]).forEach(function (n) { side.appendChild(n); });
  cols.appendChild(side);
  cols.appendChild(right);
  inner.appendChild(cols);
  inner.appendChild(leave);
  $editor.textContent = "";
  $editor.appendChild(inner);
  $editor.hidden = false;
  done.focus();
  // The bar starts on Close, off the lines; a controller that opened the window sees it there at once.
  ui = { mode: mode, after: after || null, facts: known, live: live, lives: [], stats: padStatsNew(),
         pads: pads, name: name, said: said, stage: stage, nums: nums, whose: whose, jobs: jobs, told: told, leave: leave, done: done,
         shown: null, drawn: "", chipsFor: "", more: false, names: "xbox", key: "none", bar: -1, steered: padMode, byMouse: false, wait: null, prev: {}, tilt: 0,
         lit: [], pulls: [], knobs: [], pills: [], bars: [], marks: [], lines: [], ons: [], heard: Date.now(), since: 0, raf: 0,
         stir: function () { if (ui) { ui.heard = Date.now(); } },
         // For the line written at the close: how long it was open, the controllers shown, the keyboard keys pressed, Windows' own list.
         opened: Date.now(), met: {}, keys: 0, windows: "", keyed: keyed };
  var mine = ui;
  padsAsk().then(function (r) { if (r) { mine.windows = r.words || ""; windowsSays(mine, r); } });
  if (!check) { jobsBuild(); jobsShow(); }
  $editor.addEventListener("mousemove", ui.stir);
  $editor.addEventListener("keydown", ui.stir);
  $editor.addEventListener("keydown", ui.keyed);
  setEditorOnClose(shut);
  holdPad(true);
  frame();
}

export function openPadCheck(after) { openWith("check", after); }
export function openPadButtons(after) { openWith("buttons", after); }
