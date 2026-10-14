import { sound } from "./sound.js";
import { $view } from "./state.js";
import { el } from "./util.js";

/*  Moving a column of the list: its header is held, carried sideways and
    put down between two others. js\list.js builds the header and keeps the
    order; this is the carrying. Title is never handed here, and nothing is
    put down to its left. The table is drawn again once, on letting go:
    moving the cells of every row under the pointer would stutter. */

var LIFT_AFTER = 6, LIFT_EDGE = 48, LIFT_STEP = 14, LIFT_GAP = 7;
var lifted = null;

// The headers that can stand anywhere, left to right.
function liftCells(head) {
  return [].slice.call(head.querySelectorAll(".lh[data-key]"));
}

/* Where the carried header would stand among the others, and where on the
   screen that is: before the first one whose middle is right of the pointer.
   Never left of Title's right-hand edge, which the others slide under. */
function liftSlot() {
  var cells = liftCells(lifted.head), box = $view.getBoundingClientRect(), fixed = lifted.head.querySelector(".c-title");
  var least = fixed ? fixed.getBoundingClientRect().right : box.left, x = Math.max(lifted.x, least + 1), at = cells.length, r;
  for (var i = 0; i < cells.length; i++) {
    r = cells[i].getBoundingClientRect();
    if (x < r.left + r.width / 2) { at = i; break; }
  }
  r = (cells[at] || cells[cells.length - 1]).getBoundingClientRect();
  return { at: at, x: Math.max(least + LIFT_GAP, Math.min(box.right - 2, at < cells.length ? r.left - LIFT_GAP : r.right + LIFT_GAP)), least: least, most: box.right };
}

// The copy under the pointer, and the line where it would land.
function liftShow() {
  var slot = liftSlot(), top = lifted.head.getBoundingClientRect().top;
  lifted.at = slot.at;
  lifted.ghost.style.left = Math.round(lifted.x - lifted.grab) + "px";
  lifted.ghost.style.top = Math.round(top) + "px";
  lifted.line.style.left = Math.round(slot.x - 1) + "px";
  lifted.line.style.top = Math.round(top) + "px";
  lifted.line.style.height = Math.max(0, Math.round($view.getBoundingClientRect().bottom - top)) + "px";
  return slot;
}

// Held near either end of a table wider than its box, the table scrolls that way, so a column can be carried across.
function liftTick() {
  if (!lifted || !lifted.up || lifted.gone) { return; }
  var slot = liftShow(), was = $view.scrollLeft;
  if (lifted.x > slot.most - LIFT_EDGE) { $view.scrollLeft = was + LIFT_STEP; }
  else if (lifted.x < slot.least + LIFT_EDGE) { $view.scrollLeft = was - LIFT_STEP; }
  if ($view.scrollLeft !== was) { liftShow(); }
  requestAnimationFrame(liftTick);
}

function liftUp() {
  var r = lifted.cell.getBoundingClientRect(), marked = window.getSelection && window.getSelection();
  lifted.up = true;
  lifted.ghost = el("div", "lh-ghost", lifted.label);
  lifted.ghost.style.width = Math.round(r.width) + "px";
  lifted.line = el("div", "lh-drop");
  document.body.appendChild(lifted.ghost);
  document.body.appendChild(lifted.line);
  lifted.cell.classList.add("carried");
  $view.classList.add("moving");
  if (marked && marked.removeAllRanges) { marked.removeAllRanges(); }
  requestAnimationFrame(liftTick);
}

// What was put on the screen for the carrying, taken off again.
function liftDown(l) {
  if (l.ghost) { l.ghost.remove(); l.line.remove(); l.ghost = l.line = null; }
  l.cell.classList.remove("carried");
  $view.classList.remove("moving");
}

function liftMove(e) {
  if (!lifted || lifted.gone) { return; }
  lifted.x = e.clientX;
  // A press that has not moved yet may still be a press: the header sorts on it.
  if (!lifted.up) {
    if (Math.abs(lifted.x - lifted.from) < LIFT_AFTER) { return; }
    liftUp();
  }
  liftShow();
}

// Esc puts the header back where it was, and is not the Esc that leaves the list.
function liftKey(e) {
  if (e.key !== "Escape" || !lifted || !lifted.up || lifted.gone) { return; }
  e.stopPropagation();
  e.preventDefault();
  lifted.gone = true;
  liftDown(lifted);
  sound("back");
}

function liftEnd(e) {
  if (!lifted) { return; }
  var was = lifted, keys, from;
  lifted = null;
  window.removeEventListener("pointermove", liftMove, true);
  window.removeEventListener("pointerup", liftEnd, true);
  window.removeEventListener("pointercancel", liftEnd, true);
  window.removeEventListener("keydown", liftKey, true);
  if (!was.up) { return; }                       // never carried: the click that follows sorts
  // Carried: the click that follows the release is not a press on a header.
  var eat = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
  window.addEventListener("click", eat, true);
  setTimeout(function () { window.removeEventListener("click", eat, true); }, 0);
  if (was.gone) { return; }
  keys = liftCells(was.head).map(function (n) { return n.dataset.key; });
  from = keys.indexOf(was.cell.dataset.key);
  liftDown(was);
  if (e.type === "pointercancel" || from < 0 || was.at < 0 || was.at === from || was.at === from + 1) { return; }   // put down where it stood
  keys.splice(from, 1);
  keys.splice(was.at > from ? was.at - 1 : was.at, 0, was.cell.dataset.key);
  sound("select");
  was.drop(keys);
}

/**
 * A header that can be carried.
 *   drop(keys)     it was put down somewhere else: every header that can move, in the new order
 */
export function carryHeader(cell, label, drop) {
  cell.addEventListener("pointerdown", function (e) {
    if ((e.button !== 0 && e.button !== undefined) || lifted) { return; }
    lifted = { cell: cell, head: cell.parentNode, label: label, drop: drop, from: e.clientX, x: e.clientX,
               grab: e.clientX - cell.getBoundingClientRect().left, up: false, gone: false, at: -1, ghost: null, line: null };
    // On the window for the length of the press, as the grip's are: the pointer leaves a header at once.
    window.addEventListener("pointermove", liftMove, true);
    window.addEventListener("pointerup", liftEnd, true);
    window.addEventListener("pointercancel", liftEnd, true);
    window.addEventListener("keydown", liftKey, true);
  });
}
