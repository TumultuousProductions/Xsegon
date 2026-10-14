/*  What the chrome takes, measured rather than guessed.

    --top-h    the masthead, for the menu bar to stick UNDER it: both are sticky.
    --help-h   the button legend at the foot, or 0 when it is switched off.
    --strip-h  the message strip along the very bottom, or 0 when it is not up.
               Everything else ends above it, done by the stylesheet from this one
               number (--foot-h there is the legend and the strip together), which
               glides to it, so it is set here and never read back.
    --stage-top  where the turning stage (the consoles screen, the game carousel)
               begins, below whichever top bars are up. The stage runs from there to
               the legend, so its middle is the middle of what you can see.
    --stage-rest  the line that stage turns on, with no strip up; the
               stylesheet takes half the strip off it (--stage-mid).
    --main-top where the games area begins. The list, the grid, the wheel and the
               info panel run from there to just above the legend (--fill-h in the
               stylesheet): a fixed calc() height falls short on some windows.

    It lives in a file of its own rather than in main.js because the views
    call it whenever the shape of the screen changes, and nothing may import
    the page's entry: the entry is loaded with a ?v= on it, an import of it
    would not have one, and the browser would hold two of the same module.  */

import { $body, $main, $syswall, $view } from "./state.js";

var lastStrip = 0;                       // the strip last measured, to see it come
var keepSel = false;                     // the chosen game was in sight before it did

/* Where the app ends: the top of the message strip, or the window's foot.
   For whatever places itself by the window's height and sits under the
   strip (the settings cards). */
export function appBottom() { return window.innerHeight - lastStrip; }

/* The list and the grid get shorter when the strip comes: a chosen game
   that was in sight stays in sight rather than ending up under where the
   strip now is. Asked at once, for a screen that does not glide, and again
   when the glide is over (initChrome), which is when there is something to
   scroll. A game the wheel had already scrolled away from is left alone. */
function chosenTile() {
  return $view && /\b(list|grid)\b/.test($view.className) ? $view.querySelector(".sel") : null;
}
function inSight(n) {
  if (!n) { return false; }
  var r = n.getBoundingClientRect(), v = $view.getBoundingClientRect();
  return r.top >= v.top - 1 && r.bottom <= v.bottom + 1;
}
function keepChosen() {
  var n = keepSel ? chosenTile() : null;
  if (n && !inSight(n)) { n.scrollIntoView({ block: "nearest" }); }
}

/* The consoles screen in both its styles: a fixed guess at the wheel's height puts it
   somewhere else for each set of strips above (the stylesheet's carousel section has the rest). */
function stageEl() {
  var w = $syswall;
  if (w && !w.hidden) { return w; }
  return ($view && $view.classList.contains("gcarousel")) ? $view : null;
}

export function measureChrome() {
  var root = document.documentElement.style;
  var top = document.querySelector("header.top");
  if (top) { root.setProperty("--top-h", top.offsetHeight + "px"); }
  var help = document.getElementById("help");
  var helpH = help && !$body.classList.contains("no-help") ? help.offsetHeight : 0;
  var strip = document.getElementById("strip");
  var stripH = strip && !strip.hidden ? strip.offsetHeight : 0;
  // Looked at before the strip takes its room, while the list is still whole.
  var came = stripH > lastStrip;
  if (stripH !== lastStrip) { keepSel = came && inSight(chosenTile()); }
  lastStrip = stripH;
  root.setProperty("--help-h", helpH + "px");
  root.setProperty("--strip-h", stripH + "px");
  if (came) { keepChosen(); }
  // Only while it is showing: a hidden box has no top to measure, and the
  // last one it had is the one it will come back to.
  if ($main && !$main.hidden && $main.offsetHeight) {
    root.setProperty("--main-top", Math.round($main.getBoundingClientRect().top + window.scrollY) + "px");
  }
  var stage = stageEl();
  if (!stage) { return; }
  // Its own height does not move its own top, so this cannot chase itself.
  var top = stage.getBoundingClientRect().top + window.scrollY;
  root.setProperty("--stage-top", Math.round(top) + "px");

  // And the line everything turns on: halfway between the lowest bar above
  // and the legend below. Worked out here rather than left to the box's own
  // 50%, because the box carries margins and the margins are what put the
  // band a few pixels under the middle.
  var above = 0;
  ["header.top", ".status", "#guardrail", "#toolbar"].forEach(function (q) {
    var n = document.querySelector(q);
    if (!n || !n.offsetHeight) { return; }      // not shown: it takes no room
    above = Math.max(above, n.getBoundingClientRect().bottom + window.scrollY);
  });
  var helpTop = window.scrollY + window.innerHeight - helpH;
  root.setProperty("--stage-rest", Math.round((above + helpTop) / 2 - top) + "px");
}

export function initChrome() {
  measureChrome();
  window.addEventListener("resize", measureChrome);
  // The glide the strip sets off is over: the list is as short as it gets.
  document.documentElement.addEventListener("transitionend", function (e) {
    if (e.target === document.documentElement && e.propertyName === "--strip-h") { keepChosen(); keepSel = false; }
  });
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(measureChrome);
    ["header.top", ".status", "#guardrail", "#toolbar", "#help", "#strip"].forEach(function (q) {
      var n = document.querySelector(q);
      if (n) { ro.observe(n); }
    });
  }
}
