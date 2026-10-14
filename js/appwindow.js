import { closeEditor, setEditorOnClose } from "./editors.js";
import { iconEl } from "./icons.js";
import { showStrip } from "./launch.js";
import { L, postJson } from "./log.js";
import { saveSetting } from "./savednote.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $body, $editor, $info, S } from "./state.js";
import { el } from "./util.js";
import { row } from "./views.js";

// ---------- the window's own minimise and close ----------
/* Only inside the app window: bin\open.ps1 adds ?app=1, and the display-mode
   check catches an app window opened without it. A page cannot minimise or close
   its own window, so both go to api\window.php, which does it from outside. */
export var inApp = /[?&]app=1\b/.test(location.search);
try {
  inApp = inApp || window.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches;
} catch (e) { /* fine */ }

export function windowOp(op) {
  L("WIN", op);
  sound(op === "close" ? "back" : "select");
  postJson("api/window.php", { op: op }).then(function (r) {
    if (!r.ok) { showStrip("could not " + op + " the window: " + (r.error || "no answer"), true); }
  });
}

/* The X asks first (Settings > Window > Ask before closing Xsegon): it sits a few
   pixels from the open panel's Close. It logs "close asked" first, so a window that
   vanishes without that line did not go out through this button. */
export function askClose() {
  if (!(S.window || {}).confirmClose) { windowOp("close"); return; }
  L("WIN", "close asked");
  stopVideo();
  // A tool open underneath (the media copy repaints itself every second)
  // checks this marker before painting; without it, it would paint over this.
  delete $editor.dataset.tool;
  // Every way out of this dialog that is not the yes button is a cancel:
  // the Stay button, Esc, and a press on the dark behind it.
  setEditorOnClose(function () { L("WIN", "close cancelled"); });
  $editor.textContent = "";
  var inner = el("div", "panel-inner ask-inner");
  inner.appendChild(el("h1", "panel-title", "CLOSE XSEGON?"));
  inner.appendChild(el("p", "group-help",
    "This closes the whole window, not the screen you are on. Nothing is lost: favourites, edits and play history are already saved."));
  var row = el("div", "ask-row");
  var yes = el("button", "primary", "Close Xsegon");
  yes.addEventListener("click", function () {
    L("WIN", "close confirmed");
    setEditorOnClose(null);
    closeEditor();
    windowOp("close");
  });
  var no = el("button", null, "Stay (esc)");
  no.addEventListener("click", closeEditor);
  row.appendChild(yes);
  row.appendChild(no);
  inner.appendChild(row);
  $editor.appendChild(inner);
  $editor.hidden = false;
  sound("select");
  // Staying is the safe answer, so that is the button the keyboard starts
  // on: Enter keeps the app, and Esc does the same.
  no.focus();
}

export function initWindowButtons() {
  if (!inApp) { return; }
  document.getElementById("winctl").hidden = false;
  // The two window buttons wear the same drawn icons as every menu.
  document.getElementById("btn-min").textContent = "";
  document.getElementById("btn-min").appendChild(iconEl("win-ico", "minus"));
  document.getElementById("btn-close").textContent = "";
  document.getElementById("btn-close").appendChild(iconEl("win-ico", "x"));
  document.getElementById("btn-min").addEventListener("click", function () { windowOp("minimize"); });
  document.getElementById("btn-close").addEventListener("click", askClose);
}

// ---------- the window follows its screen ----------
/* How large everything is drawn is the browser's from its start (bin\xsbrowser.ps1),
   so a window that was open when a TV was plugged in, or taken away, has the
   other screen's size. The page sees its screen change and asks; bin\open.ps1
   -Fit opens the window again, and only when it does not fit. */
function screenNow() {
  var r = window.devicePixelRatio || 1;
  return { w: Math.round(innerWidth * r), h: Math.round(innerHeight * r), r: r };
}
function sameScreen(a, b) { return !!a && !!b && Math.abs(a.w - b.w) <= 8 && Math.abs(a.h - b.h) <= 8; }
function screenWords(s) { return s.w + "x" + s.h + " at " + Math.round(s.r * 100) + "%"; }
// Drawn smaller than Fill a big screen has it: the sum of Get-XsegonFit.
function drawnSmall(s) {
  var fit = Math.floor(Math.min(s.w / 1920, s.h / 1200) * 20 + 0.0001) / 20;
  return fit > Math.max(1, s.r) + 0.075;
}

export function watchScreen() {
  if (!inApp) { return; }
  var first = screenNow(), asked = null, timer = 0;
  function look() {
    if (document.hidden) { return; }                     // looked at again when the window is shown
    // A window of its own size (bin\open.ps1 -Windowed) is no screen's measure.
    if (innerWidth < screen.width - 1 || innerHeight < screen.height - 1) { return; }
    var now = screenNow();
    var small = drawnSmall(now) && (S.window || {}).fillBigScreen !== false;
    // Each screen is asked about once; the one the page started on only when it is drawn small.
    if (sameScreen(now, asked) || (sameScreen(now, first) && !small)) { return; }
    asked = now;
    L("WIN", (sameScreen(now, first) ? "a " + screenWords(now) + " screen is drawn smaller than Fill a big screen has it"
      : "the screen changed, from " + screenWords(first) + " to " + screenWords(now)) + ": asking whether the window still fits it");
    postJson("api/window.php", { op: "fit" }).then(function (r) {
      if (!r.ok || r.held) { asked = null; }             // no answer, or a game is on: asked again at the next change
    });
  }
  function soon(ms) { clearTimeout(timer); timer = setTimeout(look, ms); }
  // A change of screen comes as several sizes one after another: the last one is looked at.
  window.addEventListener("resize", function () { soon(1500); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { soon(1500); } });
  soon(3000);
}

// Same contract as contrast: the page answers first, the save follows.
export function toggleStatus() {
  var on = $body.classList.contains("no-status");
  $body.classList.toggle("no-status", !on);
  $info.setAttribute("aria-expanded", on ? "true" : "false");
  sound("select");
  saveSetting({ feel: { statusBar: on } }, "The status bar");
}
