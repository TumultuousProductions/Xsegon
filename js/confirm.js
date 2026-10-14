/*  The asking window: a box over a dimmed page, Esc or a click outside says no,
 *  the same manner as Delete from Xsegon. Shared by js\setup.js (every fetch asks
 *  through one), the video fetchers and Settings.
 */

import { sound } from "./sound.js";
import { closeOnBackdrop, el } from "./util.js";

/* `yes` may be null for a window that only tells. */
export function confirmWindow(title, build, yes, no, onNo) {
  var wrap = el("div", "confirm-wrap setup-confirm");
  var box = el("div", "confirm");
  box.appendChild(el("h2", null, title));
  build(box);
  var bar = el("div", "confirm-bar");
  var noBtn = el("button", null, no || "Cancel");
  noBtn.addEventListener("click", function () { close(); if (onNo) { onNo(); } });
  bar.appendChild(noBtn);
  var yesBtn = null;
  if (yes) {
    yesBtn = el("button", "primary", yes.label);
    yesBtn.addEventListener("click", function () { close(); yes.run(); });
    bar.appendChild(yesBtn);
  }
  box.appendChild(bar);
  wrap.appendChild(box);
  document.body.appendChild(wrap);
  function close() {
    if (wrap.parentNode) { wrap.parentNode.removeChild(wrap); }
    document.removeEventListener("keydown", key, true);
  }
  function key(e) {
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); sound("back"); if (onNo) { onNo(); } }
  }
  document.addEventListener("keydown", key, true);
  closeOnBackdrop(wrap, function () { close(); if (onNo) { onNo(); } });   // the press decides, not the release
  (yesBtn || noBtn).focus();
  sound("select");
  return { box: box, yes: yesBtn, close: close };
}
