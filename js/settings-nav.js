import { L } from "./log.js";
import { setUI } from "./settings-ui.js";
import { sound } from "./sound.js";
import { el } from "./util.js";
import { row } from "./views.js";

/* ---------- driving settings without a mouse ----------
   The bar is in the list of categories or the page beside it: up and down move
   it, left and right change the value under it, A opens, B goes back a level.
   The mouse writes to the same two fields, so the bar never disagrees with the pointer. */

/* What the bar can stand on: every setting, and every section's heading,
   so a section folds from the pad as well. A folded section's rows are not
   drawn, which is what takes them out of the walk. */
export var SET_ROWS = ".opt, .sect-head";

function setRows() {
  if (!setUI) { return []; }
  var where = setUI.finding ? setUI.body : setUI.pages[setUI.group];
  if (!where) { return []; }
  return [].slice.call(where.querySelectorAll(SET_ROWS)).filter(function (n) {
    // A search unfolds everything, so its headings have nothing to do.
    if (setUI.finding && n.classList.contains("sect-head")) { return false; }
    return !n.classList.contains("no-match") && n.offsetParent !== null;
  });
}

function isHead(row) { return !!row && row.classList.contains("sect-head"); }

/* Fold a section away, or open it again. Never saved: the screen is drawn
   afresh each time it opens, so it always opens unfolded. Says whether
   anything changed. */
export function foldSect(box, shut) {
  if (box.classList.contains("shut") === shut) { return false; }
  box.classList.toggle("shut", shut);
  var head = box.querySelector(".sect-head");
  var n = box.querySelectorAll(".opt").length;
  head.setAttribute("aria-expanded", shut ? "false" : "true");
  head.querySelector(".sect-count").textContent = shut && n ? n + (n === 1 ? " setting" : " settings") : "";
  L("SET", (shut ? "fold " : "unfold ") + box.dataset.sect);
  return true;
}

/* Where the bar is and which page is open are two fields: in one, the pointer
   crossing a category on its way to a click would leave the click nothing to do.
   navAt is the bar; group is the page showing. */
function setPaintNav() {
  setUI.nav.querySelectorAll(".set-tab").forEach(function (t) {
    t.classList.toggle("at", setUI.where === "nav" && t === setUI.tabs[setUI.navAt]);
  });
}

export function setPaint() {
  if (!setUI) { return; }
  setPaintNav();
  var rows = setRows();
  // Into a page lands on its first setting, not on the heading above it.
  if (setUI.where === "page" && rows.indexOf(setUI.row) < 0) {
    setUI.row = rows.filter(function (r) { return !isHead(r); })[0] || rows[0] || null;
  }
  setUI.body.querySelectorAll(SET_ROWS).forEach(function (r) {
    r.classList.toggle("at", setUI.where === "page" && r === setUI.row);
  });
  if (setUI.where === "page" && setUI.row) {
    setUI.row.scrollIntoView({ block: "nearest" });
  }
}

/* The pointer moving the bar: no sound, no scrolling, no page change, just
   the highlight following the hand. Opening is what the click is for. */
export function setBarTo(where, what) {
  if (!setUI) { return; }
  setUI.where = where;
  if (where === "nav") { setUI.navAt = what; }
  else { setUI.row = what; }
  setPaintNav();
  setUI.body.querySelectorAll(SET_ROWS).forEach(function (r) {
    r.classList.toggle("at", where === "page" && r === setUI.row);
  });
}

// A deliberate move: this one opens the page as well.
export function setGo(where, what) {
  if (!setUI) { return; }
  if (where === "nav") {
    setUI.navAt = what;
    if (what !== setUI.group) {
      setUI.group = what;
      Object.keys(setUI.pages).forEach(function (gk) {
        setUI.pages[gk].hidden = setUI.finding ? false : gk !== what;
        setUI.tabs[gk].classList.toggle("on", gk === what);
      });
      setUI.body.scrollTop = 0;
      setUI.row = null;
    }
  }
  setUI.where = where;
  setPaint();
}

export function setMove(d) {
  if (!setUI) { return; }
  sound("move");
  if (setUI.where === "nav") {
    var i = setUI.order.indexOf(setUI.navAt);
    setGo("nav", setUI.order[(i + d + setUI.order.length) % setUI.order.length]);
    return;
  }
  var rows = setRows();
  if (!rows.length) { return; }
  var at = rows.indexOf(setUI.row);
  setUI.row = rows[(at + d + rows.length) % rows.length];
  setPaint();
}

/* Left and right on a row change the value in place, which is the whole
   point of a console settings menu: you never open anything. A text box is
   the exception, since a pad cannot type. */
export function setAdjust(d) {
  if (!setUI || setUI.where !== "page" || !setUI.row) { return; }
  // A heading's value is whether its section is open: left folds, right opens.
  if (isHead(setUI.row)) {
    if (foldSect(setUI.row.parentNode, d < 0)) { sound("move"); }
    return;
  }
  var input = setUI.row.querySelector("input, select, button");
  if (!input) { return; }
  if (input.tagName === "BUTTON") { return; }
  if (input.type === "checkbox") {
    var want = d > 0;
    if (input.checked === want) { return; }
    input.checked = want;
  } else if (input.type === "range" || input.type === "number") {
    var step = Number(input.step) || 1;
    var min = input.min === "" ? -Infinity : Number(input.min);
    var max = input.max === "" ? Infinity : Number(input.max);
    var next = Math.min(max, Math.max(min, Number(input.value) + d * step));
    if (next === Number(input.value)) { return; }
    // Kept to the step's own precision: 0.35 + 0.05 is 0.39999999999999997.
    input.value = String(Math.round(next * 1000) / 1000);
  } else if (input.tagName === "SELECT") {
    var n = input.selectedIndex + d;
    if (n < 0 || n >= input.options.length) { return; }
    input.selectedIndex = n;
  } else {
    return;                                   // a text box: nothing to nudge
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  sound("move");
}

// Into the page beside the list: open whichever category the bar is on
// first, in case the bar and the open page have drifted apart.
export function setIntoPage() {
  setGo("nav", setUI.navAt);
  setGo("page", setUI.group);
}

// A: into the page from the list, or work the control under the bar.
export function setEnter() {
  if (!setUI) { return; }
  if (setUI.where === "nav") { sound("select"); setIntoPage(); return; }
  if (!setUI.row) { return; }
  if (isHead(setUI.row)) {
    var box = setUI.row.parentNode;
    foldSect(box, !box.classList.contains("shut"));
    sound("select");
    return;
  }
  // A box that cannot be typed in (a folder's) is passed over: its Browse is the control.
  var input = setUI.row.querySelector("input:not([readonly]), select, button");
  if (!input) { return; }
  if (input.tagName === "BUTTON") { sound("select"); input.click(); return; }
  if (input.type === "checkbox") {
    input.checked = !input.checked;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    sound("select");
    return;
  }
  // Anything you have to read or type: hand it the keyboard.
  input.focus();
  if (input.select) { try { input.select(); } catch (e) { /* range has none */ } }
  sound("select");
}

// B backs out one level at a time, the way every console menu does.
export function setBack() {
  if (!setUI) { return false; }
  if (setUI.finding && setUI.find.value) {
    setUI.find.value = "";
    setFind("");
    sound("back");
    return true;
  }
  if (setUI.where === "page") { setGo("nav", setUI.group); sound("back"); return true; }
  return false;                                // already at the top: close
}

/* Find a setting: while there are words in the box every page is shown at
   once with only the matching rows left standing, so you see the answer and
   which category it lives in without hunting through nine of them. */
export function setFind(q) {
  if (!setUI) { return; }
  q = (q || "").trim().toLowerCase();
  setUI.finding = !!q;
  setUI.body.classList.toggle("finding", !!q);
  var none = setUI.body.querySelector(".set-none");
  if (none) { none.remove(); }
  var hits = 0;
  Object.keys(setUI.pages).forEach(function (gk) {
    var page = setUI.pages[gk], seen = 0;
    page.querySelectorAll(".opt").forEach(function (row) {
      var ok = !q || (row.dataset.find || "").indexOf(q) >= 0;
      row.classList.toggle("no-match", !ok);
      if (ok) { seen++; }
    });
    // A section with nothing that matches goes too, heading and all.
    page.querySelectorAll(".set-sect").forEach(function (box) {
      box.classList.toggle("no-match", !!q && !box.querySelector(".opt:not(.no-match)"));
    });
    page.classList.toggle("no-match", !!q && seen === 0);
    page.hidden = q ? false : gk !== setUI.group;
    hits += seen;
  });
  if (q && !hits) {
    setUI.body.appendChild(el("div", "set-none", "Nothing matches " + q + "."));
  }
  L("SET", "find " + (q || "(cleared)") + " " + hits);
  setUI.where = "page";
  setUI.row = null;
  setPaint();
}
