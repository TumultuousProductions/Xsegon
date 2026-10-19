/*  The manual reader: a game's PDF as a booklet (roadmap BA1, BA2). pdf.js
    (js\vendor\pdf-<version>) draws each page as a picture at the size it is
    shown, only the pages near the open one; StPageFlip (js\vendor\page-flip-
    <version>) bends and turns them, the covers as soft as the pages. Both load
    the first time a manual opens, never with the page.

    A manual opens on the page it was left on, with its bookmarks and its one
    page or two (api\manual-place.php). With Animations off, or where turns
    stutter, the pages are swapped flat instead of bent. js\docs.js opens it
    in a document's tab and hands it the keys and the pad (js\input.js).  */

import { closeEditor } from "./editors.js";
import { padMode } from "./help.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { readerSide } from "./readerside.js";
import { sound } from "./sound.js";
import { $body } from "./state.js";
import { el } from "./util.js";

var PDF_AT = "/js/vendor/pdf-6.4.299/", FLIP_AT = "/js/vendor/page-flip-2.0.7/page-flip.js";
var TURN_MS = 650;          // a turn, eased at both ends: about two thirds of a second
var SLOW_FPS = 40;          // two turns in a row below this and the manual is swapped flat
var MARKS_MAX = 5;          // as api\manual-place.php keeps

var libs = null;
function loadLibs() {
  if (libs) { return libs; }
  var at = location.origin;
  libs = Promise.all([import(at + PDF_AT + "pdf.min.js"), import(at + FLIP_AT)]).then(function (m) {
    m[0].GlobalWorkerOptions.workerSrc = at + PDF_AT + "pdf.worker.min.js";
    // One worker for every manual: starting one is the slow part of opening.
    return { pdfjs: m[0], PageFlip: m[1].PageFlip, worker: new m[0].PDFWorker() };
  });
  libs.catch(function () { libs = null; });          // tried again at the next manual
  return libs;
}

/* opts.gid: the game whose documents folder holds it; opts.move(step): the
   documents beside (up and down), opts.many when there are any; opts.browser():
   the browser's own reader. */
export function openReader(stage, note, g, d, opts) {
  var t0 = Date.now(), closed = false, ready = false;
  var pdf = null, task = null, n = 0, ratio = 0.75, first = null;
  var cur = 0, marks = [], oneChosen = false, flat = $body.classList.contains("no-anim"), slowRun = 0;
  var pageW = 0, pageH = 0, two = false, book = null, pf = null, pages = [], slots = [];
  var canv = {}, painting = false, zoomed = false, saveT = 0, sizeT = 0;
  var dpr = Math.min(2.5, window.devicePixelRatio || 1);

  stage.textContent = "";
  stage.className = "doc-stage is-book";
  var side = readerSide({ go: function (k) { go(k); }, goTo: function (i) { goTo(i); }, one: setOne,
                          zoom: function () { zoom(!zoomed, null); }, mark: function () { mark(); }, unmark: unmark,
                          browser: function () { if (opts.browser) { opts.browser(); } } });
  side.el.hidden = true;
  stage.appendChild(side.el);
  var area = el("div", "rd-area");
  stage.appendChild(area);
  var wait = el("p", "rd-wait", "Opening the manual...");
  area.appendChild(wait);
  var folios = el("div", "rd-folios");              // each page's number, under it
  var zoomBox = el("div", "rd-zoom");
  zoomBox.hidden = true;
  area.appendChild(zoomBox);
  note.textContent = "";

  loadLibs().then(function (lib) {
    if (closed) { return null; }
    task = lib.pdfjs.getDocument({ url: d.url, worker: lib.worker, wasmUrl: location.origin + PDF_AT, rangeChunkSize: 1048576, isEvalSupported: false });
    return Promise.all([task.promise, api("api/manual-place.php?id=" + encodeURIComponent(opts.gid) + "&doc=" + encodeURIComponent(d.file))]);
  }).then(function (got) {
    if (!got || closed) { return null; }
    pdf = got[0];
    var place = got[1] && got[1].ok ? got[1] : { page: 1, marks: [], one: false };
    n = pdf.numPages;
    cur = Math.max(0, Math.min(n - 1, (place.page || 1) - 1));
    marks = (place.marks || []).filter(function (m) { return m >= 1 && m <= n; });
    oneChosen = !!place.one;
    return pdf.getPage(1).then(function (p) { first = p.getViewport({ scale: 1 }); ratio = first.width / first.height; });
  }).then(function () {
    if (closed || !pdf) { return; }
    ready = true;
    wait.remove();
    side.el.hidden = false;
    setNote();                 // first: the line under the book takes height, and the book is sized to what is left
    build();
    contents();
    L("DOC", "reader " + d.file + ": " + n + " pages, opened on page " + (cur + 1) + (flat ? ", flat (Animations off)" : "") + ", in " + (Date.now() - t0) + "ms");
  }).catch(function (e) {
    if (closed) { return; }
    var why = String((e && e.message) || e).split("\n")[0];
    L("DOC", "reader could not open " + d.file + ": " + why);
    wait.textContent = "This manual could not be opened here (" + why + "). The browser's own reader may still read it.";
    wait.className = "rd-fail";
    var b = el("button", "primary", "Open it in the browser's reader");
    b.type = "button";
    b.addEventListener("click", function () { if (opts.browser) { opts.browser(); } });
    area.insertBefore(b, zoomBox);
  });

  function setNote() {
    var others = opts.many ? (padMode ? ", up and down the other documents" : ", up and down go to the other documents") : "";
    note.textContent = padMode
      ? "LB and RB, the cross or the right stick turn the pages, held for page after page. A shows a page at full size, X marks it, Y one page or two" + others + ", B back."
      : "A click on a page, left and right, Page Up and Down or the wheel turn the pages. Enter shows a page at full size, B marks it" + others + ".";
  }
  // The PDF's own contents, its outline, where it has one: each entry's page found once, the first 60 kept.
  function contents() {
    pdf.getOutline().then(function (list) {
      return Promise.all((list || []).slice(0, 60).map(function (t) {
        var dest = typeof t.dest === "string" ? pdf.getDestination(t.dest) : Promise.resolve(t.dest);
        return dest.then(function (dd) { return !dd ? -1 : typeof dd[0] === "number" ? dd[0] : dd[0] ? pdf.getPageIndex(dd[0]) : -1; })
          .then(function (i) { return { title: String(t.title || "").trim(), page: i + 1 }; }, function () { return { title: "", page: 0 }; });
      }));
    }).then(function (rows) {
      rows = rows.filter(function (r) { return r.title && r.page >= 1; });
      if (closed || !rows.length) { return; }
      side.outline(rows);
      turned();
      L("DOC", d.file + " has its own contents: " + rows.length + " entries");
    }).catch(function () { /* no outline: nothing to show */ });
  }

  /* ---- what is on show ---------------------------------------------- */

  // The pages side by side as a booklet lays them: the cover alone on the right, the last page alone on the left.
  function slotsAt(i) {
    if (!two) { return [i]; }
    if (i <= 0) { return [null, 0]; }
    var s = i - ((i - 1) % 2);
    return [s, s + 1 < n ? s + 1 : null];
  }
  function shown() { return slotsAt(cur).filter(function (x) { return x !== null; }); }
  function words() {
    var s = shown();
    return s.length > 1 ? "Pages " + (s[0] + 1) + " and " + (s[1] + 1) + " of " + n : "Page " + (s[0] + 1) + " of " + n;
  }
  // The room the book has: the area beside the side panel, less a margin and the page numbers under it.
  function room() { return { w: area.clientWidth - 24, h: area.clientHeight - 44 }; }
  function fitsTwo() { var r = room(); return r.w >= 1.5 * r.h * ratio; }     // two only where each page keeps most of its size
  function wantTwo() { return !oneChosen && fitsTwo(); }
  function fit() {
    var r = room(), t = wantTwo(), w = Math.floor(Math.min(t ? r.w / 2 : r.w, r.h * ratio));
    return { two: t, w: w, h: Math.floor(w / ratio) };
  }

  function build() {
    teardown();
    var f = fit();
    two = f.two; pageW = f.w; pageH = f.h;
    book = el("div", "rd-book" + (flat ? " is-flat" : "") + (two ? "" : " is-one"));
    book.style.width = (two ? pageW * 2 : pageW) + "px";
    book.style.height = pageH + "px";
    area.insertBefore(book, zoomBox);
    area.insertBefore(folios, zoomBox);
    if (flat) {
      slots = (two ? [0, 1] : [0]).map(function () { var s = el("div", "rd-slot"); book.appendChild(s); return s; });
      hotZones();
    } else {
      pages = [];
      for (var i = 0; i < n; i++) {
        var p = el("div", "rd-page");
        p.dataset.density = "soft";
        p.appendChild(el("span", "rd-num", String(i + 1)));
        pages.push(p);
        book.appendChild(p);
      }
      libs.then(function (lib) {
        if (closed || !book) { return; }
        // No corner lifts under the pointer and nothing follows a drag: a click is only ever a whole turn.
        pf = new lib.PageFlip(book, { width: pageW, height: pageH, size: "fixed", autoSize: false, usePortrait: true, showCover: true,
                                      startPage: cur, flippingTime: TURN_MS, drawShadow: true, maxShadowOpacity: 0.5, showPageCorners: false,
                                      disableFlipByClick: true, mobileScrollSupport: false, swipeDistance: 30, useMouseEvents: false });
        pf.loadFromHTML(pages);
        for (var k = 0; k < n; k++) { pf.getPage(k).setDensity("soft"); }    // soft covers, the user's choice
        pf.on("flip", function (e) { cur = e.data; turned(); });
        pf.on("changeState", function (e) { if (e.data === "flipping") { countFrames(); } else if (e.data === "read") { paintNear(); } });
        Object.keys(canv).forEach(function (k2) { place(+k2); });
        hotZones();
        turned();
      });
    }
    show();
  }
  // Each half of the book is a button, back on the left and forward on the right, with an arrow shown on hover.
  function hotZones() {
    if (!book) { return; }
    [-1, 1].forEach(function (dir) {
      var z = el("div", "rd-hot " + (dir > 0 ? "next" : "prev"));
      z.title = dir > 0 ? "Forward a page" : "Back a page";
      z.addEventListener("click", function (e) { e.stopPropagation(); go(dir); });
      book.appendChild(z);
    });
  }
  function teardown() {
    if (pf) { try { pf.destroy(); } catch (e) { /* already gone */ } pf = null; }
    if (book) { book.remove(); book = null; }
  }

  function show() {
    if (flat) {
      var s = slotsAt(cur);
      slots.forEach(function (slot, k) {
        slot.textContent = "";
        slot.classList.toggle("empty", s[k] === null || s[k] === undefined);
        if (s[k] !== null && s[k] !== undefined) {
          if (canv[s[k]] && canv[s[k]].canvas) { slot.appendChild(canv[s[k]].canvas); } else { slot.appendChild(el("span", "rd-num", String(s[k] + 1))); }
        }
      });
    }
    turned();
  }
  function turned() {
    var s = shown();
    side.paint({ n: n, shown: s, two: two, oneChosen: oneChosen, fitsTwo: fitsTwo(), marks: marks, here: marks.indexOf(s[0] + 1) >= 0 });
    area.setAttribute("aria-label", words());
    folios.style.width = book ? book.style.width : "";
    folios.textContent = "";
    slotsAt(cur).forEach(function (i) { folios.appendChild(el("span", "rd-folio", i === null || i === undefined ? "" : String(i + 1))); });
    if (book) {
      [].forEach.call(book.querySelectorAll(".rd-hot"), function (z) { z.classList.toggle("off", z.classList.contains("next") ? s[s.length - 1] >= n - 1 : s[0] <= 0); });
    }
    stage.dataset.page = String(s[0] + 1);
    stage.dataset.pages = String(n);
    stage.dataset.mode = flat ? "flat" : "book";
    save(false);
    paintNear();
  }

  /* ---- turning ------------------------------------------------------ */

  function turning() { return !!pf && pf.getState() !== "read"; }
  function go(dir, quiet) {
    if (!ready || zoomed) { return; }
    var s = shown(), to = dir > 0 ? s[s.length - 1] + 1 : s[0] - 1;
    if (to < 0 || to >= n) { return; }
    if (!quiet) { sound("move"); }
    L("DOC", "page " + (to + 1) + " of " + n + (dir > 0 ? " (forward)" : " (back)"));
    if (pf) { if (dir > 0) { pf.flipNext("bottom"); } else { pf.flipPrev("bottom"); } return; }
    cur = to;
    show();
  }
  function goTo(i) {
    if (!ready) { return; }
    i = Math.max(0, Math.min(n - 1, i));
    if (zoomed) { zoom(false); }
    cur = i;
    if (pf) { pf.turnToPage(i); turned(); } else { show(); }
    L("DOC", "page " + (i + 1) + " of " + n + " (a jump)");
  }

  // A turn's frames, counted while it runs: two slow ones in a row and the pages are swapped flat (roadmap BA1's guard).
  function countFrames() {
    var t = performance.now(), frames = 0;
    requestAnimationFrame(function tick() {
      if (!pf || closed) { return; }
      if (pf.getState() === "flipping") { frames++; requestAnimationFrame(tick); return; }
      var ms = performance.now() - t;
      if (ms < TURN_MS * 0.6) { return; }       // cut short by the next press: not a whole turn
      var fps = Math.round(frames / (ms / 1000));
      var had = (stage.dataset.turns || "").split(",").filter(Boolean).slice(-9);
      had.push(String(fps));
      stage.dataset.turns = had.join(",");
      slowRun = fps < SLOW_FPS ? slowRun + 1 : 0;
      if (slowRun >= 2) {
        L("DOC", "turns ran at " + had.slice(-2).join(" and ") + " frames a second here: " + d.file + " is swapped flat from now on");
        flat = true;
        build();
        note.textContent = "The pages are swapped flat: on this PC their turns were not smooth. " + note.textContent;
      }
    });
  }

  /* ---- drawing the pages -------------------------------------------- */

  // The open pages first, then the next ones, then the ones behind: only the few near the open one are kept.
  function near() {
    var s = shown(), a = s[0], b = s[s.length - 1];
    return [a, b, b + 1, b + 2, a - 1, a - 2, b + 3, a - 3].filter(function (i, k, all) { return i >= 0 && i < n && all.indexOf(i) === k; });
  }
  function fresh(i) { var c = canv[i]; return !!c && (c.failed || c.w >= pageW * dpr * 0.9); }
  function paintNear() {
    if (painting || closed || !pdf || turning()) { return; }       // never during a turn: drawing would cost it frames
    var i = near().find(function (k) { return !fresh(k); });
    if (i === undefined) { dropFar(); return; }
    painting = true;
    paintPage(i, pageW).then(function (c) {
      canv[i] = c;
      place(i);
    }).catch(function (e) {
      canv[i] = { failed: true, w: 0 };
      L("DOC", "page " + (i + 1) + " of " + d.file + " could not be drawn: " + String((e && e.message) || e).split("\n")[0]);
    }).then(function () { painting = false; paintNear(); });
  }
  function paintPage(i, width) {
    return pdf.getPage(i + 1).then(function (p) {
      var vp = p.getViewport({ scale: width * dpr / p.getViewport({ scale: 1 }).width });
      var c = document.createElement("canvas");
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      return p.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise.then(function () { return { canvas: c, w: c.width }; });
    });
  }
  function place(i) {
    var c = canv[i];
    if (!c || !c.canvas) { return; }
    if (flat) { if (shown().indexOf(i) >= 0) { show(); } return; }
    var p = pages[i];
    if (p && c.canvas.parentNode !== p) { p.textContent = ""; p.appendChild(c.canvas); }
  }
  function dropFar() {
    var s = shown()[0];
    Object.keys(canv).forEach(function (k) {
      if (Math.abs(+k - s) <= 8) { return; }
      var c = canv[k];
      if (c.canvas) { c.canvas.width = 0; c.canvas.remove(); }
      delete canv[k];
      if (pages[+k]) { pages[+k].textContent = ""; pages[+k].appendChild(el("span", "rd-num", String(+k + 1))); }
    });
  }

  /* ---- full size ---------------------------------------------------- */

  var drag = null, dragged = false;
  function zoom(on) {
    if (on === zoomed) { return; }
    zoomed = on;
    stage.classList.toggle("rd-zoomed", on);
    sound(on ? "select" : "back");
    if (!on) { zoomBox.hidden = true; zoomBox.textContent = ""; L("DOC", "fitted back"); return; }
    var list = shown(), w = Math.floor(zoomBox.parentNode.clientWidth - 24);
    zoomBox.textContent = "";
    zoomBox.hidden = false;
    list.forEach(function (i) {
      var h = el("div", "rd-zpage");
      h.style.width = w + "px";
      h.style.height = Math.floor(w / ratio) + "px";
      if (canv[i] && canv[i].canvas) { var q = document.createElement("canvas"); q.width = canv[i].canvas.width; q.height = canv[i].canvas.height; q.getContext("2d").drawImage(canv[i].canvas, 0, 0); h.appendChild(q); }
      zoomBox.appendChild(h);
      paintPage(i, w).then(function (c) { if (zoomed && h.isConnected) { h.textContent = ""; h.appendChild(c.canvas); } }).catch(function () { /* the fitted picture stays */ });
    });
    zoomBox.scrollTop = 0;
    L("DOC", "full size, page " + (list[0] + 1));
  }
  zoomBox.addEventListener("pointerdown", function (e) {
    if (e.button !== 0) { return; }
    drag = { x: e.clientX, y: e.clientY, left: zoomBox.scrollLeft, top: zoomBox.scrollTop };
    dragged = false;
  });
  zoomBox.addEventListener("pointermove", function (e) {
    if (!drag) { return; }
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 5) { dragged = true; }
    zoomBox.scrollLeft = drag.left - (e.clientX - drag.x);
    zoomBox.scrollTop = drag.top - (e.clientY - drag.y);
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) { zoomBox.addEventListener(ev, function () { drag = null; }); });
  zoomBox.addEventListener("click", function () { if (dragged) { dragged = false; return; } zoom(false); });
  function nudge(dx, dy) { zoomBox.scrollLeft += dx * zoomBox.clientWidth; zoomBox.scrollTop += dy * zoomBox.clientHeight; }

  /* ---- bookmarks, one page or two, and the place kept ------------------ */

  function mark() {
    if (!ready) { return; }
    var p = shown()[0] + 1, had = marks.indexOf(p) >= 0;
    if (!had && marks.length >= MARKS_MAX) { showStrip("a manual keeps " + MARKS_MAX + " bookmarks: open one and take it off to mark another page", false); return; }
    keepMarks(had ? marks.filter(function (m) { return m !== p; }) : marks.concat([p]), had);
  }
  function unmark(p) { keepMarks(marks.filter(function (m) { return m !== p; }), true); }
  function keepMarks(want, off) {
    save(true, want).then(function (res) {
      if (!res || !res.ok) { showStrip("the bookmark was not kept: " + ((res && res.error) || "no answer from Xsegon"), false); return; }
      marks = res.marks;                      // the list comes from the server's answer: saved means confirmed
      sound(off ? "back" : "select");
      turned();
    });
  }
  function setOne(on) {
    oneChosen = on;
    L("DOC", on ? "one page at a time" : "two pages side by side");
    save(true);
    build();
  }
  function save(now, wantMarks) {
    clearTimeout(saveT);
    if (!ready) { return Promise.resolve(null); }
    if (!now) { saveT = setTimeout(function () { save(true); }, 1500); return Promise.resolve(null); }
    var body = { id: opts.gid, doc: d.file, page: shown()[0] + 1, marks: wantMarks || marks, one: oneChosen };
    return postJson("api/manual-place.php", body).then(function (res) {
      if (!res.ok) { L("DOC", "the place in " + d.file + " was not kept: " + res.error); }
      return res;
    }).catch(function () { return null; });
  }

  /* ---- the keys and the pad, through js\docs.js's picker --------------- */

  function key(e) {
    if (!ready) { return false; }
    var k = e.key;
    if (zoomed) {
      if (k === "Escape" || k === "Backspace" || k === "Enter" || k === " ") { zoom(false); }
      else if (k === "ArrowDown" || k === "PageDown") { nudge(0, 0.2); }
      else if (k === "ArrowUp" || k === "PageUp") { nudge(0, -0.2); }
      else if (k === "ArrowRight") { nudge(0.2, 0); }
      else if (k === "ArrowLeft") { nudge(-0.2, 0); }
      return true;
    }
    if (k === "ArrowRight" || k === "PageDown") { if (!(e.repeat && turning())) { go(1, e.repeat); } return true; }
    if (k === "ArrowLeft" || k === "PageUp") { if (!(e.repeat && turning())) { go(-1, e.repeat); } return true; }
    if (k === "Home" || k === "End") { goTo(k === "Home" ? 0 : n - 1); return true; }
    if (k === "Enter" || k === " ") { zoom(true, null); return true; }
    if (k === "b" || k === "B") { mark(); return true; }
    return false;                                  // up and down: the other documents; Esc: back
  }
  function pad(s, prev) {
    var now = performance.now(), dt = prev.t ? Math.min(0.1, (now - prev.t) / 1000) : 0;
    var sx = s.rx > 0.6 ? 1 : s.rx < -0.6 ? -1 : 0;     // the right stick turns pages as the cross does
    var turn = s.right || s.rb || sx > 0 ? 1 : s.left || s.lb || sx < 0 ? -1 : 0, ud = s.down ? 1 : s.up ? -1 : 0;
    var next = { t: now, a: s.a, b: s.b, x: s.x, y: s.y, turn: turn, ud: ud, held: turn ? (prev.held || now) : 0 };
    if (s.b && !prev.b) { L("PAD", "b in the reader"); if (zoomed) { zoom(false); } else { closeEditor(); } return next; }
    if (!ready) { if (ud && ud !== prev.ud && opts.move) { opts.move(ud); } return next; }
    if (s.a && !prev.a) { zoom(!zoomed, null); }
    if (zoomed) { nudge((s.rx + (s.right ? 1 : s.left ? -1 : 0)) * dt * 1.2, (s.ry + ud) * dt * 1.2); return next; }
    if (s.x && !prev.x) { mark(); }
    if (s.y && !prev.y) { setOne(!oneChosen); }
    if (turn && turn !== prev.turn) { go(turn); next.held = now; }
    else if (turn && now - prev.held > TURN_MS + 80) { go(turn, true); next.held = now; }   // held: page after page
    if (ud && ud !== prev.ud && opts.move) { opts.move(ud); return next; }
    return next;
  }

  function onWheel(e) {
    if (zoomed || !ready || turning() || Math.abs(e.deltaY) < 4) { return; }
    e.preventDefault();
    go(e.deltaY > 0 ? 1 : -1);
  }
  stage.addEventListener("wheel", onWheel, { passive: false });
  function onSize() {
    clearTimeout(sizeT);
    sizeT = setTimeout(function () { var f = fit(); if (ready && !closed && (f.two !== two || Math.abs(f.w - pageW) > 30)) { build(); } }, 250);
  }
  window.addEventListener("resize", onSize);

  function close() {
    if (closed) { return; }
    if (ready) { save(true); }
    closed = true;
    clearTimeout(saveT); clearTimeout(sizeT);
    window.removeEventListener("resize", onSize);
    stage.removeEventListener("wheel", onWheel);
    teardown();
    Object.keys(canv).forEach(function (k) { if (canv[k].canvas) { canv[k].canvas.width = 0; } });
    canv = {};
    if (task) { task.destroy(); }
    pdf = null;
  }

  return { key: key, pad: pad, close: close };
}
