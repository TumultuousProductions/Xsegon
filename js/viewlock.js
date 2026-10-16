/*  Wheel and Carousel, and the consoles screen that has their shape, wait while
 *  no emulator is on this PC (a new copy: until RetroArch is in), whether the
 *  setup was skipped or is at work: they have no menu bar, and someone new lost
 *  there finds no way to Getting started. The page opens on List meanwhile
 *  (index.php), and each library read says again (api\library.php), so they
 *  can be chosen the moment it is in.
 */

import { showStrip } from "./launch.js";
import { L } from "./log.js";
import { $btnSystems, $viewsel } from "./state.js";

var waiting = !!(window.XSEGON && window.XSEGON.viewsLocked);
// RetroArch is named only while it plays a console in the library (api\library.php viewsWaitRa).
var byRa = true;

function walled(v) { return v === "wheel" || v === "carousel"; }

/** Whether they wait now. */
export function viewsLocked() { return waiting; }

/** A view that waits: Wheel or Carousel while they do. */
export function viewWaits(v) { return waiting && walled(v); }

/** What a refusal and a greyed entry say. */
export function lockWords() { return "Wheel, Carousel and the consoles screen open once " + (byRa ? "RetroArch is in" : "an emulator is set up"); }

/** Refused and said: true when they wait. what: for the log. */
export function lockRefuses(what) {
  if (!waiting) { return false; }
  L("VW", what + " refused: no emulator on this PC yet");
  showStrip(lockWords() + (byRa ? ": Set it all up gets it" : ": Emulators > Add an emulator gives your consoles one"), false);
  return true;
}

/** G's next view, past the ones that wait. */
export function nextView(v) {
  var ring = { list: "grid", grid: "shelf", shelf: "wheel", wheel: "carousel", carousel: "rows", rows: "list" };
  var n = ring[v] || "list";
  while (viewWaits(n)) { n = ring[n]; }
  return n;
}

/** From each library read: lifted the moment an emulator is in. ra: whether RetroArch is the way. */
export function setViewsLocked(now, ra) {
  if (!!now === waiting && ra !== false === byRa) { return; }
  if (!!now !== waiting) {
    L("VW", now ? "wheel, carousel and the consoles screen wait for an emulator" : "an emulator is in: wheel, carousel and the consoles screen can be chosen");
  }
  waiting = !!now;
  byRa = ra !== false;
  paintViewLock();
}

/** The dropdown's Wheel and Carousel, greyed and saying why, and the back arrow to the consoles screen. */
export function paintViewLock() {
  Array.prototype.forEach.call($viewsel.options, function (o) {
    if (!walled(o.value)) { return; }
    o.disabled = waiting;
    o.textContent = (o.value === "wheel" ? "Wheel" : "Carousel") + (waiting ? (byRa ? " (once RetroArch is in)" : " (once an emulator is in)") : "");
  });
  $btnSystems.disabled = waiting;
  $btnSystems.title = waiting ? lockWords() : "Back to consoles (Esc)";
}
