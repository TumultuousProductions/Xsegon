/*  Your rating, given in the list's own row. A cell gets the details' five
    stars (js\details.js myStars) only once the pointer comes to it, with one
    listener for every row, so a long list is no heavier for them.
    The press does not choose the row: a second press on a chosen game would open its details. */

import { myStars } from "./details.js";
import { listCells } from "./list.js";
import { $view, games } from "./state.js";
import { flatNodes } from "./views.js";

function starCell(node) { return node && node.closest ? node.closest(".row > .c-myRating") : null; }

export function initRowStars() {
  $view.addEventListener("mouseover", function (e) {
    var cell = starCell(e.target);
    if (!cell || cell.querySelector(".mystars")) { return; }
    var g = games[flatNodes.indexOf(cell.parentNode)];
    if (!g) { return; }
    cell.textContent = "";
    cell.removeAttribute("title");               // the stars say it themselves, and how to take one off
    cell.classList.remove("s0", "s1", "s2", "s3", "s4", "s5");
    cell.appendChild(myStars(g));
  });
}

/* A rating changed somewhere else (the details, the panel beside the list):
   the game's row says the same. A cell that has its stars repaints itself. */
export function rowStarsAgain(g) {
  var at = games.indexOf(g), line = at >= 0 ? flatNodes[at] : null;
  var cell = line && line.querySelector ? line.querySelector(".c-myRating") : null;
  if (!cell || cell.querySelector(".mystars")) { return; }
  var fresh = listCells(g).filter(function (c) { return c.classList.contains("c-myRating"); })[0];
  if (fresh) { cell.replaceWith(fresh); }
}
