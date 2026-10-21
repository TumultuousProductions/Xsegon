/*  The pictures hint: a three second note with a small arrow at the
    Get Media button, once the games are in and the menu bar shows.

    Only while there are scanned games no Fill in pass has been through (the count
    that keeps step 5 of Getting started open, api\setup.php?guide=1), once per
    visit, three times in all, never over a window or a menu; any key, press or
    wheel puts it away, and it takes no pointer.

    views.js calls artHint() at the end of every render; everything that says
    "not now" is checked before the server is asked, and the server is asked
    again only when the size of the library has changed. */

import { libraryTotal } from "./library.js";
import { L, api, postJson } from "./log.js";
import { $details, $editor, $settings, $toolbar } from "./state.js";
import { el } from "./util.js";

var SHOW_MS = 3000;           // three seconds
var SETTLE_MS = 700;          // the view that just came in is drawn first
var TIMES = 3;                // in all, until a Fill in pass has run

var shown = false;            // once per visit
var asking = false;
var askedAt = null;           // the library's size when the server last said "nothing waiting"
var $hint = null, timer = 0;

function mediaBtn() { return document.getElementById("btn-getmedia"); }

// The menu bar is on screen: the toolbar is up and wearing it.
function barUp() {
  var b = mediaBtn();
  return !$toolbar.hidden && $toolbar.classList.contains("as-menubar") && !!b && b.offsetParent !== null;
}

// A window, a menu or a question is up: not now.
function busy() {
  return !$editor.hidden || !$details.hidden || !$settings.hidden ||
         !!document.querySelector(".ctx, .setup-confirm, .saver:not([hidden])");
}

function hide() {
  if (!$hint) { return; }
  clearTimeout(timer);
  ["keydown", "mousedown", "wheel"].forEach(function (ev) { document.removeEventListener(ev, hide, true); });
  window.removeEventListener("resize", hide);
  var n = $hint;
  $hint = null;
  n.classList.add("going");
  setTimeout(function () { n.remove(); }, 260);
}

function show(todo) {
  if (shown || $hint || !barUp() || busy()) { return; }
  shown = true;
  var r = mediaBtn().getBoundingClientRect();
  $hint = el("div", "art-hint");
  $hint.setAttribute("role", "status");
  $hint.appendChild(el("span", "art-hint-arrow"));
  $hint.appendChild(el("span", "art-hint-words",
    "Get Media > Get Pictures adds box art and names to " + (todo === 1 ? "1 game" : todo + " games")));
  // Under the button, the arrow's point on its middle.
  $hint.style.left = Math.max(8, Math.round(r.left + r.width / 2 - 22)) + "px";
  $hint.style.top = Math.round(r.bottom + 9) + "px";
  document.body.appendChild($hint);
  L("SETUP", "pictures hint shown under Get Media: " + todo + " scanned games not filled in yet");
  timer = setTimeout(hide, SHOW_MS);
  ["keydown", "mousedown", "wheel"].forEach(function (ev) { document.addEventListener(ev, hide, true); });
  window.addEventListener("resize", hide);
  postJson("api/setup.php", { asked: "hint" });
}

export function artHint() {
  if (shown || asking || libraryTotal === null || libraryTotal === askedAt || !barUp() || busy()) { return; }
  asking = true;
  var size = libraryTotal;
  api("api/setup.php?guide=1").then(function (r) {
    asking = false;
    var g = r && r.ok && r.guide;
    var todo = g ? g.bare - (g.left || 0) : 0;
    // Not while a pass is at work: the bar in the corner already says so,
    // and the note would spend one of its three showings.
    if (!g || g.filling || todo <= 0 || (g.hinted || 0) >= TIMES) { askedAt = size; return; }
    setTimeout(function () { show(todo); }, SETTLE_MS);
  });
}
