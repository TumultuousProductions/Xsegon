/*  The manual reader's side panel (js\reader.js), left of the book: where you
    are and a slider to anywhere, one page or two, full size, the bookmarks
    with a way to take each off, the manual's own contents when the PDF has
    them, and the browser's reader. It draws what the reader tells it and calls back; it
    keeps nothing of its own.  */

import { padMode } from "./help.js";
import { el } from "./util.js";

var STEP_SVG = {   // first, back, forward, last: drawn, so every font shows them alike
  first: '<path d="M7 6v12M18 6l-7 6 7 6"/>', back: '<path d="M15 6l-7 6 7 6"/>',
  fwd: '<path d="M9 6l7 6-7 6"/>', last: '<path d="M17 6v12M6 6l7 6-7 6"/>',
};
function stepBtn(kind, words, run) {
  var b = el("button", "rd-step");
  b.type = "button";
  b.title = words;
  b.setAttribute("aria-label", words);
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + STEP_SVG[kind] + "</svg>";
  b.addEventListener("click", function () { run(); b.blur(); });
  return b;
}
// Answers side by side, the chosen one lit: a press on another chooses it.
function seg(cls, answers, run) {
  var box = el("div", "rd-seg " + cls);
  var btns = answers.map(function (a) {
    var b = el("button", null, a[1]);
    b.type = "button";
    b.dataset.v = a[0];
    b.addEventListener("click", function () { run(a[0]); b.blur(); });
    box.appendChild(b);
    return b;
  });
  box.pick = function (v) { btns.forEach(function (b) { var on = b.dataset.v === v; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); }); };
  box.btns = btns;
  return box;
}
function sect(title) {
  var s = el("div", "rd-sect");
  if (title) { s.appendChild(el("h3", "rd-head", title)); }
  return s;
}
function keyed(words, key) {
  var b = el("button", "rd-act");
  b.type = "button";
  b.appendChild(el("span", null, words));
  var k = el("kbd", null, key);
  b.appendChild(k);
  b.keyCap = k;
  return b;
}

/* h: go(step), goTo(index), one(on), zoom(), mark(), unmark(page), browser(). */
export function readerSide(h) {
  var side = el("aside", "rd-side");
  side.setAttribute("aria-label", "The manual's pages and choices");

  var where = sect(null);
  where.classList.add("rd-where");
  var big = el("div", "rd-big", "");
  big.setAttribute("aria-live", "polite");
  var of = el("div", "rd-of", "");
  var scrub = el("input", "rd-scrub");
  scrub.type = "range";
  scrub.min = "1";
  scrub.title = "Slide to any page";
  scrub.setAttribute("aria-label", "Page");
  var going = false;
  scrub.addEventListener("input", function () { going = true; big.textContent = "Go to " + scrub.value; of.textContent = "let go to open it"; });
  scrub.addEventListener("change", function () { going = false; h.goTo(+scrub.value - 1); scrub.blur(); });
  var steps = el("div", "rd-steps");
  steps.appendChild(stepBtn("first", "The first page (Home)", function () { h.goTo(0); }));
  steps.appendChild(stepBtn("back", "Back a page", function () { h.go(-1); }));
  steps.appendChild(stepBtn("fwd", "Forward a page", function () { h.go(1); }));
  steps.appendChild(stepBtn("last", "The last page (End)", function () { h.goTo(1e6); }));
  [big, of, scrub, steps].forEach(function (n) { where.appendChild(n); });
  side.appendChild(where);

  var pagesS = sect("Pages");
  var pages = seg("rd-pages", [["one", "One"], ["two", "Two side by side"]], function (v) { h.one(v === "one"); });
  var pagesTip = el("p", "rd-tip", "");
  pagesS.appendChild(pages); pagesS.appendChild(pagesTip);
  side.appendChild(pagesS);

  var acts = sect(null);
  var zoomB = keyed("Full size", "Enter");
  zoomB.addEventListener("click", function () { h.zoom(); zoomB.blur(); });
  var markB = keyed("Bookmark this page", "B");
  markB.addEventListener("click", function () { h.mark(); markB.blur(); });
  acts.appendChild(zoomB); acts.appendChild(markB);
  side.appendChild(acts);

  var marksS = sect("Bookmarks");
  var marks = el("div", "rd-marks");
  marksS.appendChild(marks);
  side.appendChild(marksS);

  var tocS = sect("Contents");
  var toc = el("div", "rd-toc");
  tocS.appendChild(toc);
  tocS.hidden = true;
  side.appendChild(tocS);

  var plainS = sect(null);
  plainS.classList.add("rd-plainsect");
  var plain = el("button", "rd-plain", "The browser's reader");
  plain.type = "button";
  plain.addEventListener("click", function () { h.browser(); });
  plainS.appendChild(plain);
  plainS.appendChild(el("p", "rd-tip", "To find a word or copy text."));
  side.appendChild(plainS);

  /* st: n, shown (the page indexes on show), two, oneChosen, fitsTwo, marks
     (page numbers), here (this page bookmarked). */
  function paint(st) {
    var s = st.shown, nums = s.map(function (i) { return i + 1; });
    if (!going) {
      big.textContent = nums.join(" and ");
      of.textContent = (nums.length > 1 ? "pages " : "page ") + "of " + st.n;
    }
    scrub.max = String(st.n);
    scrub.value = String(nums[0]);
    scrub.disabled = st.n < 2;
    steps.children[0].disabled = steps.children[1].disabled = s[0] <= 0;
    steps.children[2].disabled = steps.children[3].disabled = s[s.length - 1] >= st.n - 1;
    pages.pick(st.two ? "two" : "one");
    pages.btns[1].disabled = !st.fitsTwo;
    pagesTip.textContent = st.fitsTwo ? "" : "The window is too narrow for two.";
    zoomB.keyCap.textContent = padMode ? "A" : "Enter";
    markB.keyCap.textContent = padMode ? "X" : "B";
    markB.firstChild.textContent = st.here ? "Take the bookmark off" : "Bookmark this page";
    markB.classList.toggle("on", st.here);
    marks.textContent = "";
    if (!st.marks.length) { marks.appendChild(el("p", "rd-tip", (padMode ? "X" : "B") + " marks the page you are on, up to five.")); }
    st.marks.forEach(function (p) {
      var line = el("div", "rd-mark" + (nums.indexOf(p) >= 0 ? " here" : ""));
      var go = el("button", "rd-markgo", "Page " + p);
      go.type = "button";
      go.title = "Go to page " + p;
      go.addEventListener("click", function () { h.goTo(p - 1); go.blur(); });
      var off = el("button", "rd-markoff", "×");
      off.type = "button";
      off.title = "Take the bookmark on page " + p + " off";
      off.setAttribute("aria-label", off.title);
      off.addEventListener("click", function () { h.unmark(p); });
      line.appendChild(go); line.appendChild(off);
      marks.appendChild(line);
    });
    [].forEach.call(toc.children, function (b) { b.classList.toggle("here", nums.indexOf(+b.dataset.page) >= 0); });
  }
  // The PDF's own contents, where it has any: [{ title, page }], page counted from 1.
  function outline(list) {
    toc.textContent = "";
    list.forEach(function (t) {
      var b = el("button", "rd-tocrow");
      b.type = "button";
      b.dataset.page = String(t.page);
      b.appendChild(el("span", "rd-toct", t.title));
      b.appendChild(el("span", "rd-tocp", String(t.page)));
      b.addEventListener("click", function () { h.goTo(t.page - 1); b.blur(); });
      toc.appendChild(b);
    });
    tocS.hidden = !list.length;
  }
  return { el: side, paint: paint, outline: outline };
}
