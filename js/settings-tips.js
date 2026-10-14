import { appBottom } from "./chrome.js";
import { $settings } from "./state.js";
import { el } from "./util.js";

/* ---------- the settings tooltips ----------
 * Rest the pointer on a row (TIP_WAIT) and a card shows its name, whole hint,
 * and for a setting the default and key. The words are read from the row as the
 * card shows, so a hint that rewrites itself is current (settings-ui.js paints them).
 *
 * A card that outlives its row is worse than none: the card takes no pointer
 * events, anything that means the hand or screen moved on puts it away, and a
 * watchdog every 400ms puts it away if the row is gone or no longer under the
 * pointer. One clock, one watchdog, one card; every path clears all three. */
var TIP_WAIT = 1500;
var tip = null, tipWait = null, tipWatch = null, tipOn = null, tipX = 0, tipY = 0;

export function hideTip() {
  if (tipWait) { clearTimeout(tipWait); tipWait = null; }
  if (tipWatch) { clearInterval(tipWatch); tipWatch = null; }
  tipOn = null;
  if (tip) { tip.hidden = true; }
}

// True when the row the card belongs to is no longer the row under the hand.
function tipGone() {
  return !tipOn || !tipOn.isConnected || !tipOn.offsetParent ||
    $settings.hidden || !tipOn.matches(":hover");
}

function showTip() {
  tipWait = null;
  if (tipGone()) { hideTip(); return; }
  var label = tipOn.querySelector("label");
  var name = label && label.firstChild ? label.firstChild.textContent
           : (tipOn.querySelector(".tab-label") || {}).textContent || "";
  var hint = tipOn.querySelector(".hint");
  var body = tipOn.dataset.tip || (hint ? hint.textContent : "");
  // A row with no words has no card (the sub-tab strip, the emulator rows).
  if (!name || !body) { hideTip(); return; }
  tip.textContent = "";
  tip.appendChild(el("div", "tip-name", name));
  tip.appendChild(el("div", "tip-body", body));
  if (tipOn.dataset.tipKey) {
    tip.appendChild(el("div", "tip-foot",
      "Default: " + tipOn.dataset.tipDefault + " · saved as " + tipOn.dataset.tipKey));
  }
  tip.hidden = false;
  // Beside the pointer, kept on screen, and above the pointer when there is
  // no room below. Measured at a known spot first, because a card still at
  // its last place measures wrapped.
  tip.style.left = "0px";
  tip.style.top = "0px";
  var w = tip.offsetWidth, h = tip.offsetHeight;
  var left = Math.min(Math.max(8, tipX + 18), Math.max(8, window.innerWidth - w - 8));
  var top = tipY + 22;
  if (top + h > appBottom() - 8) { top = tipY - h - 14; }     // the message strip is over a card, not under it
  tip.style.left = left + "px";
  tip.style.top = Math.max(8, top) + "px";
  tipWatch = setInterval(function () { if (tipGone()) { hideTip(); } }, 400);
}

export function armTips(root) {
  hideTip();                               // a fresh paint owes nothing to the last one
  if (!tip) {
    // One card for the app's lifetime, on body so no panel can clip it.
    tip = el("div", "set-tip");
    tip.hidden = true;
    document.body.appendChild(tip);
    window.addEventListener("blur", hideTip);
    window.addEventListener("resize", hideTip);
    // On the document, not the panel: the keys that drive the settings land
    // wherever the focus is, and any key means the hand moved on.
    document.addEventListener("keydown", hideTip, true);
  }
  root.addEventListener("mousemove", function (e) {
    tipX = e.clientX;
    tipY = e.clientY;
    // A button held down is a drag (a slider, a text selection), not a rest.
    if (e.buttons) { hideTip(); return; }
    var over = e.target.closest ? e.target.closest(".opt, .set-tab") : null;
    if (over === tipOn) { return; }        // the same row: the clock keeps counting
    hideTip();
    if (!over) { return; }
    tipOn = over;
    tipWait = setTimeout(showTip, TIP_WAIT);
  });
  root.addEventListener("mouseleave", hideTip);
  root.addEventListener("mousedown", hideTip, true);
  root.addEventListener("wheel", hideTip, { passive: true });
  root.addEventListener("scroll", hideTip, true);   // capture: scroll does not bubble
}
