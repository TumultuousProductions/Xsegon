/*  The lists in a game's details end just above the legend and the strip, at any
    size of screen and whatever stands above the page (the amber band of missing
    games): where each one begins is measured, as --main-top is for the games area
    (js\chrome.js), not guessed from the top of the window. Each list's height is
    the stylesheet's --fit-max; until it is measured the old guess stands. */

import { $details } from "./state.js";

// Every box in details that scrolls in what the screen leaves (css\xsegon.css, var(--fit-max, ...)).
var FIT = ".notes-box, .ach-list, .sv-list, .ch-tab .ch-list, .ch-tab .hck-list, .ch-tab .md-list, .md-tab .pk-grid, .nt-box, .mt-fit";
var asked = false;

/* What stands under a box in its own column: its later siblings, and theirs up the tree. */
function below(n) {
  var h = parseFloat(getComputedStyle(n).marginBottom) || 0;
  for (var x = n; x && x.parentElement && x.parentElement !== $details; x = x.parentElement) {
    for (var s = x.nextElementSibling; s; s = s.nextElementSibling) {
      var cs = getComputedStyle(s);
      if (cs.display === "none" || cs.position === "absolute" || cs.position === "fixed") { continue; }
      h += s.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    }
    var ps = getComputedStyle(x.parentElement);
    h += (parseFloat(ps.paddingBottom) || 0) + (parseFloat(ps.borderBottomWidth) || 0);
  }
  return h;
}

/* Measured a frame later, once: called as often as anything changes, and never
   inside a size watcher's own turn (a size changed there is a fault to Chrome). */
export function fitDetails() {
  if (asked) { return; }
  asked = true;
  requestAnimationFrame(function () {
    asked = false;
    if (!$details || $details.hidden) { return; }
    var ds = getComputedStyle($details);
    var foot = (parseFloat(ds.paddingBottom) || 0) + (parseFloat(ds.borderBottomWidth) || 0);
    $details.querySelectorAll(FIT).forEach(function (n) {
      if (!n.offsetParent) { return; }                 // in a tab that is not shown
      var top = n.getBoundingClientRect().top + window.scrollY;
      var room = Math.round(top + below(n) + foot);
      n.style.setProperty("--fit-max", "calc(100vh - " + room + "px - var(--foot-h, var(--strip-h)))");
    });
  });
}

// Anything that grows or shrinks in details (a tab opened, its list arriving) measures again.
if (window.ResizeObserver && $details) { new ResizeObserver(fitDetails).observe($details); }
