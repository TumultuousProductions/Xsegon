/*  Settings saves itself: a switch or dropdown when changed, a slider or number
    once it rests, a typed box when it is left, and anything still waiting when
    Settings closes or the page leaves. One row a save, in order: api\settings.php
    lays each over the stored file, so nothing changed elsewhere is undone. The
    page reads most settings as it starts, so it is drawn again after. */

import { paintHelpAgain } from "./help.js";
import { showStrip } from "./launch.js";
import { L, api } from "./log.js";
import { savedNote } from "./savednote.js";
import { $editor, $settings, S } from "./state.js";
import { wearTheme } from "./themes.js";

var REST_MS = 400;                       // how long a slider or a number rests before it saves
var queue = Promise.resolve();           // one save at a time, in order
var drawn = {};                          // what the page was drawn with, for each row saved since
var holds = {};                          // and what the server holds for it now
var held = false;                        // Settings is on its way open: not the moment to draw

function rows() {
  return Array.prototype.slice.call($settings.querySelectorAll("[data-group][data-key]"));
}

// A row's value the way api\settings.php takes it.
function valueOf(input) {
  if (input.type === "checkbox") { return input.checked; }
  if (input.type === "number" || input.type === "range") { return Number(input.value); }
  if (input.dataset.list) {
    return input.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  }
  return input.value;
}

// Put a row back to a value, its number and its try-out with it.
function show(input, v) {
  if (input.type === "checkbox") { input.checked = !!v; }
  else { input.value = Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "" : String(v); }
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function nameOf(input) {
  var opt = input.closest(".opt"), label = opt && opt.querySelector("label");
  return (label && label.firstChild && label.firstChild.textContent) || input.dataset.key;
}

// The line at the foot of Settings: what was saved last, or what was not.
function say(text, bad) {
  var n = $settings.querySelector(".set-saved");
  if (!n) { return; }
  n.textContent = text;
  n.classList.toggle("bad", !!bad);
}

/* A saved setting says so where it stands: its row tints and a toast
   (js\savednote.js) names it. Only from the server's answer: green when it kept
   the value asked for, amber when it kept something else, red when nothing. */
function mark(input, kind, text) {
  var opt = input.closest(".opt"), cls = kind === "saved" ? "saved" : kind === "warn" ? "save-warn" : "save-bad";
  if (opt) {
    opt.classList.remove("saved", "save-warn", "save-bad");
    void opt.offsetWidth;                       // so the same row can flash twice running
    opt.classList.add(cls);
    clearTimeout(opt.xsFlash);
    opt.xsFlash = setTimeout(function () { opt.classList.remove("saved", "save-warn", "save-bad"); }, 1400);
  }
  savedNote(kind, text);
}

// A kept value in words, for the line that says it is not what was entered.
function shown(v) { return Array.isArray(v) ? v.join(", ") : v === true ? "on" : v === false ? "off" : String(v); }

/* What the server holds for a row, as text. Only a row that differs from it
   is sent; something else that saves a row's setting (the volume corner,
   your own sounds) says so here. */
export function noteSaved(input) { input.dataset.saved = JSON.stringify(valueOf(input)); }
export function noteAllSaved() { rows().forEach(noteSaved); }

export function saveInput(input) {
  clearTimeout(input.xsRest);
  var was = input.dataset.saved, now = JSON.stringify(valueOf(input));
  if (was === undefined || now === was) { return; }
  var g = input.dataset.group, k = input.dataset.key, patch = {};
  patch[g] = {};
  patch[g][k] = JSON.parse(now);
  var old = (S[g] || {})[k];
  // The page's copy moves at once, so a slider's try-out is not put back on closing.
  S[g] = S[g] || {};
  S[g][k] = patch[g][k];
  input.dataset.saved = now;
  var turn = input.xsTurn = (input.xsTurn || 0) + 1;
  queue = queue.then(function () {
    // keepalive: the last one still goes when the page is on its way out
    return api("api/settings.php", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  }).then(function (r) {
    var latest = turn === input.xsTurn;   // a newer change to this row answers for it
    if (!r || !r.ok || !r.settings) {
      var why = (r && r.error) || "the server did not answer";
      L("SET", g + "." + k + " not saved: " + why);
      if (!latest) { return; }
      S[g][k] = old;
      input.dataset.saved = was;
      show(input, JSON.parse(was));
      say("Not saved: " + nameOf(input), true);
      mark(input, "bad", "Not saved: " + nameOf(input));
      showStrip(nameOf(input) + " was not saved: " + why, true);
      return;
    }
    // What the server kept is the truth: a value it would not take goes back.
    var kept = (r.settings[g] || {})[k], id = g + "." + k;
    if (!(id in drawn)) { drawn[id] = JSON.stringify(old); }
    holds[id] = JSON.stringify(kept);
    if (!latest) { return; }
    S[g][k] = kept;
    if (id === "feel.theme") { wearTheme(kept); }   // the look changes where you are choosing it
    if (g === "controller") { paintHelpAgain(); }   // and so do the legend's button names
    if (JSON.stringify(kept) !== JSON.stringify(valueOf(input))) { show(input, kept); }
    noteSaved(input);
    /* "Saved" only for the value that was asked for. One the server would not
       take, or kept as something else (a number outside its range), is said as that. */
    if (JSON.stringify(kept) === now) {
      say("Saved: " + nameOf(input));
      mark(input, "saved", "Saved: " + nameOf(input));
      return;
    }
    var words = JSON.stringify(kept) === was ? nameOf(input) + " was not changed: that value was not taken"
                                              : nameOf(input) + " is kept as " + shown(kept) + ", not as entered";
    L("SET", g + "." + k + " asked " + now + ", kept " + JSON.stringify(kept));
    say(words, true);
    mark(input, "warn", words);
  }).catch(function (e) { L("ERR", "settings save: " + (e && e.message)); });
}

// Every row that still differs: Settings is closing, or the page is leaving.
export function saveWaiting() { rows().forEach(saveInput); }

export function holdRedraw(on) { held = on; }

/* A job that runs in the page (a file check) would end with the page: the
   redraw waits for it, and is asked again as the last one ends. */
var pageJobs = 0;
export function pageJobRuns(on) {
  pageJobs = Math.max(0, pageJobs + (on ? 1 : -1));
  if (!pageJobs) { redrawIfClear(); }
}

// A row changed and changed back leaves the page as it was drawn: nothing to do.
function due() {
  return Object.keys(drawn).some(function (id) { return drawn[id] !== holds[id]; });
}

/* The page drawn again only when something was saved, the saves are in, and
   neither Settings nor a window reached through it is open or on its way. */
export function redrawIfClear() {
  queue.then(function () {
    if (held || pageJobs || !$settings.hidden || !$editor.hidden || !due()) { return; }
    L("SET", "settings were changed: the page is drawn again");
    location.reload();
  });
}

export function initSettingsSave() {
  // One listener for every row: the mouse, the keys and the pad all end in a change.
  $settings.addEventListener("change", function (e) {
    var input = e.target;
    if (!input || !input.dataset || !input.dataset.group || !input.dataset.key) { return; }
    if (input.type === "range" || input.type === "number") {
      clearTimeout(input.xsRest);
      input.xsRest = setTimeout(function () { saveInput(input); }, REST_MS);
      return;
    }
    saveInput(input);
  });
  // The window closed, or the page loaded again, with Settings still open.
  window.addEventListener("pagehide", function () { if (!$settings.hidden) { saveWaiting(); } });
}
