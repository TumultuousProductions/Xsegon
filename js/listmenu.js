/*  A list header's own menu, on a right-click: sort by the column either way,
    move it a place left or right, make it as wide as its longest entry, or take
    it off the table, so a column can be moved without a drag.

    Title's menu sorts and nothing more: Title is always shown, always first,
    and takes the room the other columns leave. */

import { listColumns, listWidths, saveColumns, saveWidths, sortWords } from "./list.js";
import { ctxFocus, ctxItems, popupMenu } from "./menus.js";
import { sound } from "./sound.js";
import { $sort, $view, S, games } from "./state.js";
import { render } from "./views.js";
import { setSort, setViewFlag } from "./viewset.js";

// The columns that can be moved, in the order they stand in.
function movable() {
  return listColumns().filter(function (c) { return !c.fixed; }).map(function (c) { return c.key; });
}
function keepOrder(keys) {
  saveColumns(listColumns().filter(function (c) { return c.fixed; }).map(function (c) { return c.key; }).concat(keys), render);
}

// How wide words stand in a node's own lettering.
function wideIn(node) {
  var cs = getComputedStyle(node), pen = document.createElement("canvas").getContext("2d");
  pen.font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
  var gap = parseFloat(cs.letterSpacing) || 0, capitals = cs.textTransform === "uppercase";
  return function (text) { return pen.measureText(capitals ? text.toUpperCase() : text).width + gap * text.length; };
}

/* As wide as the column's longest entry. Measured from the games and not
   from the rows, since a long list has not drawn them all; the header's own
   name counts too, with room for the arrow a sort puts beside it. */
function fitWidth(c) {
  var cell = $view.querySelector(".row .cell.c-" + c.key), name = $view.querySelector(".lhead .c-" + c.key + " .lh-t");
  if (!cell || !name) { return 0; }
  var inRow = wideIn(cell), most = wideIn(name)(c.label + " ▲");
  games.forEach(function (g) {
    var words = c.text(g);
    if (words) { most = Math.max(most, inRow(words)); }
  });
  return Math.max(60, Math.ceil(most) + 2);
}

function headMenu(c, x, y, standOn) {
  var keys = movable(), i = keys.indexOf(c.key), ways = sortWords(c.sort);
  var sorting = $sort.value === c.sort, turned = !!(S.view && S.view.sortReverse);
  // A column moved a place keeps its menu where it is, on the same entry: the next press moves it again.
  var step = function (by, key) {
    return function () {
      var next = keys.slice();
      next.splice(i, 1);
      next.splice(i + by, 0, c.key);
      sound("select");
      keepOrder(next);
      headMenu(c, x, y, key);
    };
  };
  // The column the list is sorted by is only turned round, the way a press on its header does: the list
  // keeps its place. The way it already runs is left alone. Another column is a new sort, from the top.
  var sortThat = function (round) {
    return function () {
      if (!sorting) { setSort(c.sort, round); }
      else if (turned !== round) { setViewFlag("sortReverse", round); }
    };
  };
  var entries = [
    { label: ways[0], checked: sorting && !turned, run: sortThat(false) },
    { label: ways[1], checked: sorting && turned, run: sortThat(true) }
  ];
  if (!c.fixed) {
    entries.push(
      { rule: true },
      { key: "left", label: "Move left", run: i > 0 ? step(-1, "left") : null,
        tip: i > 0 ? "One place to the left. Dragging the header moves it further." : "It is the first column after Title, which stays in front." },
      { key: "right", label: "Move right", run: i < keys.length - 1 ? step(1, "right") : null,
        tip: i < keys.length - 1 ? "One place to the right. Dragging the header moves it further." : "It is the last column already." },
      { rule: true },
      { label: "Fit to its longest entry", tip: "As wide as the longest thing in this column, and no wider. Double-click the header's edge for its usual width.",
        run: function () {
          var w = fitWidth(c), all = Object.assign({}, listWidths());
          if (!w) { return; }
          all[c.key] = w;
          sound("select");
          saveWidths(all, render);
        } },
      { icon: "x", label: "Remove this column", tip: "Takes it off the table. The three-lines button at the right of the headers brings it back.",
        run: function () {
          sound("select");
          keepOrder(keys.filter(function (k) { return k !== c.key; }));
        } });
  }
  popupMenu(entries, x, y, c.label);
  var at = standOn ? ctxItems.findIndex(function (it) { return it.node.dataset.key === standOn; }) : -1;
  if (at >= 0) { ctxFocus(at); }
}

export function initListMenu() {
  $view.addEventListener("contextmenu", function (e) {
    var cell = e.target.closest ? e.target.closest(".lhead .lh") : null;
    if (!cell) { return; }
    var c = listColumns().filter(function (x) { return cell.classList.contains("c-" + x.key); })[0];
    if (!c) { return; }                            // the empty track at the end
    e.preventDefault();
    headMenu(c, e.clientX, e.clientY);
  });
}
