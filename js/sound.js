/*  What the app plays: the interface sounds, and the volume the whole app
    (snaps included) is played at.                                          */

import { iconEl } from "./icons.js";
import { saveSetting } from "./savednote.js";
import { noteSaved } from "./settings-save.js";
import { hearSnaps, paintSnapMute, snap, snapLevel, snapMuted, snapVolume } from "./snap.js";
import { S } from "./state.js";

/* A level (0-100) as loudness (0-1), squared: ears hear ratios, so a
   straight scale is loud at 5 with no room below it. */
export function gain(level) {
  var x = Math.max(0, Math.min(100, level));
  return x * x / 10000;
}

// ---------- sound ----------
// Browsers refuse audio before the first gesture, so these stay silent until
// you touch something: no unlocking needed.

var sounds = {};
// Every noise Xsegon makes is under S.sound, the app's own and the snap's,
// as they are laid out on the settings screen.
export var SND = S.sound || {};
export var volume = (typeof SND.volume === "number") ? SND.volume : 70;   // 0-100, on the curve
export var muted = false;
export function setMuted(v) { muted = v; }
try { muted = localStorage.getItem("xs-muted") === "1"; } catch (e) { /* fine */ }

export function sound(name, setOverride) {
  if (!SND.sounds) { return; }
  if (muted || volume <= 0) { return; }
  try {
    // The set is part of the key AND the URL: one address per set, so a
    // switch can never be answered from the cache with the old set.
    var set = setOverride || SND.soundSet || "Xsegon";
    // Back can be rerouted (sound.backSound): to this pack's Select, or to
    // another pack's Back, when a pack is right except for that one noise.
    if (name === "back" && !setOverride && SND.backSound) {
      if (SND.backSound === "select") { name = "select"; }
      else { set = SND.backSound; }
    }
    var key = set + "/" + name;
    var a = sounds[key];
    if (!a) {
      a = sounds[key] = new Audio("api/sound.php?name=" + name +
                                  "&set=" + encodeURIComponent(set));
    }
    a.volume = gain(volume);
    a.currentTime = 0;
    var p = a.play();
    if (p && p.catch) { p.catch(function () {}); }
  } catch (e) { /* a missing sound set is not worth an error */ }
}

// A set whose files changed under the same names reads them again next time.
// Hover too, under every set: yours is not tied to one.
export function forgetSounds(set) {
  Object.keys(sounds).forEach(function (k) {
    if (k.indexOf(set + "/") === 0 || /\/hover$/.test(k)) { delete sounds[k]; }
  });
  hoverVoices = {};
}

// ---------- under the pointer ----------
var GAME_UNDER = ".witem, .gcard, .tile, .row, .spine, .rcard";   // a game, in each view
var PRESS_UNDER = "button, [role=button], [role=menuitem], [role=tab]";   // a thing to press, anywhere
var HOVER_VOICES = 8;                    // Hovers sounding at once; one more takes the oldest one's place
var HOVER_FAST = 120;                    // ms: sooner than this after the last one is a sweep
var HOVER_FAST_LEVEL = 0.75;             // and each sound of a sweep is this much of the usual level
var HOVER_ALL = 30;                      // Settings' slider at its top: no limit
var HOVER_TRY = 800;                     // ms: how long the sweep that slider plays goes on
var hoverVoices = {}, hoverAt = 0, hoverTry = [];

/* The least time between two Hovers: Settings > Sound > Sounds under the
   pointer, at most, which is so many a second. */
function hoverGap(rate) {
  var n = typeof rate === "number" ? rate : (typeof SND.hoverRate === "number" ? SND.hoverRate : 9);
  return n >= HOVER_ALL ? 0 : 1000 / Math.max(1, n);
}

/* Several players take turns, so a new Hover does not cut the last one off,
   and in a sweep each is a little quieter instead.
   or: what plays where there is no Hover at all (the Shelf asks for Move). */
function playHover(or) {
  if (!SND.sounds || muted || volume <= 0) { return; }
  try {
    var set = SND.soundSet || "Xsegon", key = set + "/" + (or || "");
    var v = hoverVoices[key] || (hoverVoices[key] = { list: [], next: 0 });
    var a = null;
    for (var i = 0; i < v.list.length && !a; i++) { if (v.list[i].paused) { a = v.list[i]; } }   // one that is not sounding
    if (!a && v.list.length < HOVER_VOICES) {
      a = new Audio("api/sound.php?name=hover" + (or ? "&or=" + or : "") + "&set=" + encodeURIComponent(set));
      v.list.push(a);
    }
    if (!a) { a = v.list[v.next]; v.next = (v.next + 1) % v.list.length; }
    var now = Date.now(), fast = now - hoverAt < HOVER_FAST;
    hoverAt = now;
    a.volume = gain(volume) * (fast ? HOVER_FAST_LEVEL : 1);
    a.currentTime = 0;
    var p = a.play();
    if (p && p.catch) { p.catch(function () {}); }
  } catch (e) { /* a missing sound is not worth an error */ }
}

// What a sweep at a limit sounds like: Settings plays it as its slider is let go.
export function hearHoverRate(rate) {
  hoverTry.forEach(clearTimeout);
  hoverTry = [];
  var gap = hoverGap(rate) || 1000 / HOVER_ALL;
  for (var t = 0; t < HOVER_TRY; t += gap) { hoverTry.push(setTimeout(playHover, t, "")); }
}

/* The Hover sound as the pointer passes from game to game in the view (box),
   and onto anything to press. Only a pointer that really moved counts: a view
   scrolling under a still one sends a move with the same place in it. */
export function wireHoverSound(box) {
  var x = -1, y = -1, over = null, late = null;
  document.addEventListener("mousemove", function (e) {
    if (e.clientX === x && e.clientY === y) { return; }
    x = e.clientX; y = e.clientY;
    var t = e.target.closest ? e.target : null;
    var game = t && box.contains(t) ? t.closest(GAME_UNDER) : null;
    var press = t ? t.closest(PRESS_UNDER) : null;
    // One that cannot be pressed (greyed) is no button to the ear either.
    if (press && (press.disabled || press.classList.contains("off") || press.getAttribute("aria-disabled") === "true")) { press = null; }
    // A button on a game is its own thing; a button around one is not.
    var g = press && (!game || game.contains(press)) ? press : game;
    if (g === over) { return; }
    over = g;
    clearTimeout(late);
    if (!g || SND.hoverSound === false) { return; }
    var or = g === game && box.classList.contains("shelf") ? "move" : "";
    var wait = hoverAt + hoverGap() - Date.now();
    if (wait <= 0) { playHover(or); return; }
    // Too soon after the last one: it sounds when its turn comes if the pointer
    // is still on this game, so the one it stops on is never silent.
    late = setTimeout(playHover, wait, or);
  });
  document.documentElement.addEventListener("mouseleave", function () { over = null; clearTimeout(late); });
}

// ---------- volume ----------
/* Two levels, bottom right: Xsegon's own sounds (the X) and a video snap's
   (the film). A speaker until clicked, then the two bars above it until a click
   elsewhere; the - + and m keys show them for a moment. Mute (m) silences both,
   a bar's icon that one alone. Games are not touched. */

var $vol = document.getElementById("vol");
var $volPop = document.getElementById("vol-pop");
var $volBtn = document.getElementById("vol-btn");
var $volRange = document.getElementById("vol-range");
var $volNum = document.getElementById("vol-num");
var $appIco = document.getElementById("vol-app-ico");
var $snapRange = document.getElementById("vol-snap");
var $snapNum = document.getElementById("vol-snap-num");
var $snapIco = document.getElementById("vol-snap-ico");
var volSaveT = null, snapSaveT = null;
// The level a bar's icon put away, for the same icon to bring back.
var appWas = 0, snapWas = 0;
var barsOpen = "";       // "", "click" (stays) or "peek" (goes by itself)
var peekT = null;

function label(b, text) { b.title = text; b.setAttribute("aria-label", text); }

export function paintVolume() {
  var off = muted || volume <= 0;
  $volRange.value = String(volume);
  $volNum.textContent = off ? "off" : String(volume);
  $appIco.classList.toggle("muted", off);
  label($appIco, off ? "Xsegon's sounds are off: click to hear them" : "Mute Xsegon's sounds (m mutes both)");
  var sv = snapLevel(), snapOff = snapMuted();
  $snapRange.value = String(sv);
  $snapNum.textContent = snapOff ? "off" : String(sv);
  $snapIco.classList.toggle("muted", snapOff);
  label($snapIco, snapOff ? "Video snaps are silent: click to hear them" : "Mute video snaps (m mutes both)");
  $volBtn.classList.toggle("muted", off && snapOff);
  label($volBtn, muted ? "Volume: muted (m)" : "Volume");
  if (snap.video) { snap.video.muted = snapMuted(); snap.video.volume = snapVolume(); }
  paintSnapMute();
}

/* Settings open over the corner: its slider follows a level set from the
   corner or the keys, and counts as saved, since the corner saves it. */
function followInSettings(key, v) {
  var input = document.querySelector('#settings input[data-group="sound"][data-key="' + key + '"]');
  if (!input) { return; }
  input.value = String(v);
  noteSaved(input);
  var n = input.parentNode.querySelector(".set-range-n");
  if (n) { n.textContent = String(v); }
}

// Saved after the drag rests, not once per pixel of it.
function saveSound(patch) {
  saveSetting({ sound: patch }, "The volume");
}

function unmute() {
  if (!muted) { return; }
  muted = false;
  try { localStorage.setItem("xs-muted", "0"); } catch (e) { /* fine */ }
}

export function setVolume(v, audible, save) {
  volume = Math.max(0, Math.min(100, Math.round(v)));
  if (volume > 0) { unmute(); }
  SND.volume = volume;
  paintVolume();
  if (audible) { sound("move"); }        // hear the level you just chose
  clearTimeout(volSaveT);
  // save === false is an icon mute: this session only, so the level kept in
  // Settings stays. Saving the 0 would make the mute permanent and lose the level.
  if (save !== false) {
    followInSettings("volume", volume);
    volSaveT = setTimeout(function () { saveSound({ volume: volume }); }, 400);
  }
}

/* The film bar. Raising it is asking to hear snaps, so it lifts a mute and,
   for this session, Snap sound being off, as the snap's own button does. */
function setSnapVolume(v, save) {
  v = Math.max(0, Math.min(100, Math.round(v)));
  SND.videoVolume = v;
  if (v > 0) { unmute(); hearSnaps(); }
  paintVolume();
  clearTimeout(snapSaveT);
  if (save !== false) {
    followInSettings("videoVolume", v);
    snapSaveT = setTimeout(function () { saveSound({ videoVolume: v }); }, 400);
  }
}

// A bar's icon: that sound alone off, or back at the level it had. Off is
// never saved (see setVolume): the icon the other way, or a reload, brings
// the kept level back.
function toggleApp() {
  if (muted || volume <= 0) { setVolume(volume > 0 ? volume : (appWas || 70), false); }
  else { appWas = volume; setVolume(0, false, false); }
  sound("select");
}
function toggleSnap() {
  var sv = snapLevel();
  if (snapMuted()) { setSnapVolume(sv > 0 ? sv : (snapWas || 75)); }
  else { snapWas = sv; setSnapVolume(0, false); }   // this session only, as toggleApp
  sound("select");
}

export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem("xs-muted", muted ? "1" : "0"); } catch (e) { /* fine */ }
  paintVolume();
  sound("select");
}

function showBars(how) {
  clearTimeout(peekT);
  barsOpen = how;
  $volPop.hidden = !how;
  $vol.classList.toggle("open", !!how);
  $volBtn.setAttribute("aria-expanded", how ? "true" : "false");
}

// For the keys. Bars opened by a click stay as they are.
export function peekVolume() {
  if (barsOpen === "click") { return; }
  showBars("peek");
  peekT = setTimeout(function () { showBars(""); }, 2000);
}

export function initVolume() {
  $volBtn.appendChild(iconEl("vol-on", "speaker"));
  $volBtn.appendChild(iconEl("vol-off", "speakerOff"));
  $snapIco.appendChild(iconEl("vol-film", "film"));
  $volBtn.addEventListener("click", function () {
    showBars(barsOpen === "click" ? "" : "click");
    sound(barsOpen ? "select" : "back");
    $volBtn.blur();
  });
  // A pointer that reaches bars shown by a key keeps them.
  $vol.addEventListener("pointerenter", function () { if (barsOpen === "peek") { showBars("click"); } });
  document.addEventListener("pointerdown", function (e) {
    if (barsOpen && !$vol.contains(e.target)) { showBars(""); }
  }, true);
  $volRange.addEventListener("input", function () { setVolume(Number($volRange.value), false); });
  $snapRange.addEventListener("input", function () { setSnapVolume(Number($snapRange.value)); });
  // On release: play the level, and give the arrow keys back to the wheel.
  $volRange.addEventListener("change", function () { sound("move"); $volRange.blur(); });
  $snapRange.addEventListener("change", function () { $snapRange.blur(); });
  $appIco.addEventListener("click", function () { toggleApp(); $appIco.blur(); });
  $snapIco.addEventListener("click", function () { toggleSnap(); $snapIco.blur(); });
  paintVolume();
}
