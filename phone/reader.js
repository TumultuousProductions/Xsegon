/*  The phone's booklet (roadmap BA6, AB2), served at /reader.js by
    router-phone.php: a game's PDF a page at a time on the same pdf.js and
    StPageFlip as the TV's reader (js\reader.js), loaded through the phone
    server's door to js\vendor. A tap on the right side turns forward, on the
    left side back, the page bending whole; the slider goes anywhere. The page
    reached is kept through the PC, so the TV and the phone open on it.  */

var PDF_AT = "/js/vendor/pdf-6.4.299/", FLIP_AT = "/js/vendor/page-flip-2.0.7/page-flip.js";
var TURN_MS = 650;          // as the TV's: about two thirds of a second, eased at both ends

var libs = null;
function loadLibs() {
  if (libs) { return libs; }
  libs = Promise.all([import(PDF_AT + "pdf.min.js"), import(FLIP_AT)]).then(function (m) {
    m[0].GlobalWorkerOptions.workerSrc = PDF_AT + "pdf.worker.min.js";
    return { pdfjs: m[0], PageFlip: m[1].PageFlip, worker: new m[0].PDFWorker() };
  });
  libs.catch(function () { libs = null; });          // tried again at the next manual
  return libs;
}
function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) { n.className = cls; }
  if (text !== undefined) { n.textContent = text; }
  return n;
}

/* box: where the booklet goes, sized by the page; doc: {url, file, label,
   page}; keep(page): the page reached, sent to the PC a moment after turning. */
export function openBook(box, doc, keep) {
  var closed = false, pdf = null, task = null, n = 0, ratio = 0.75, cur = Math.max(0, (doc.page || 1) - 1);
  var book = null, pf = null, pages = [], canv = {}, painting = false, saveT = 0, sizeT = 0, kept = cur, pageW = 0, pageH = 0;
  var dpr = Math.min(3, window.devicePixelRatio || 1);

  box.textContent = "";
  var stage = el("div", "bk-stage");
  var wait = el("p", "bk-wait", "Opening the manual...");
  var foot = el("div", "bk-foot"), folio = el("span", "bk-folio", ""), scrub = el("input", "bk-scrub");
  scrub.type = "range";
  scrub.min = "1";
  scrub.setAttribute("aria-label", "Page");
  stage.appendChild(wait);
  foot.appendChild(folio);
  foot.appendChild(scrub);
  foot.hidden = true;
  box.appendChild(stage);
  box.appendChild(foot);
  var tip = el("p", "hint", "Tap the right side to turn forward, the left side to go back.");
  tip.hidden = true;
  box.appendChild(tip);
  scrub.addEventListener("input", function () { folio.textContent = "Go to " + scrub.value; });
  scrub.addEventListener("change", function () { goTo(+scrub.value - 1); });

  loadLibs().then(function (lib) {
    if (closed) { return null; }
    task = lib.pdfjs.getDocument({ url: doc.url, worker: lib.worker, wasmUrl: location.origin + PDF_AT, rangeChunkSize: 1048576, isEvalSupported: false });
    return task.promise;
  }).then(function (p) {
    if (!p || closed) { return null; }
    pdf = p;
    n = pdf.numPages;
    cur = Math.min(cur, n - 1);
    return pdf.getPage(1).then(function (pg) { var v = pg.getViewport({ scale: 1 }); ratio = v.width / v.height; });
  }).then(function () {
    if (closed || !pdf) { return; }
    wait.remove();
    foot.hidden = false;
    tip.hidden = false;
    build();
  }).catch(function (e) {
    if (closed) { return; }
    var why = String((e && e.message) || e).split("\n")[0];
    wait.textContent = "This manual could not be opened here (" + why + "). ";
    wait.className = "bk-fail";
    var a = el("a", null, "Open the file itself");
    a.href = doc.url;
    a.target = "_blank";
    wait.appendChild(a);
  });

  function build() {
    teardown();
    var w = stage.clientWidth, h = stage.clientHeight;
    pageW = Math.floor(Math.min(w, h * ratio));
    pageH = Math.floor(pageW / ratio);
    book = el("div", "bk-book");
    book.style.width = pageW + "px";
    book.style.height = pageH + "px";
    stage.appendChild(book);
    pages = [];
    for (var i = 0; i < n; i++) {
      var p = el("div", "bk-page");
      p.dataset.density = "soft";
      p.appendChild(el("span", "bk-num", String(i + 1)));
      pages.push(p);
      book.appendChild(p);
    }
    libs.then(function (lib) {
      if (closed || !book) { return; }
      // No corner follows a finger: a tap is only ever a whole turn, as on the TV. disableFlipByClick stays off, as there:
      // with the library's own touch handling off it guards nothing, and on one page it stops flipPrev.
      pf = new lib.PageFlip(book, { width: pageW, height: pageH, size: "fixed", autoSize: false, usePortrait: true, showCover: true,
                                    startPage: cur, flippingTime: TURN_MS, drawShadow: true, maxShadowOpacity: 0.5, showPageCorners: false,
                                    disableFlipByClick: false, mobileScrollSupport: false, useMouseEvents: false });
      pf.loadFromHTML(pages);
      for (var k = 0; k < n; k++) { pf.getPage(k).setDensity("soft"); }
      pf.on("flip", function (e) { cur = e.data; turned(); });
      pf.on("changeState", function (e) { if (e.data === "read") { paintNear(); } });
      [-1, 1].forEach(function (dir) {
        var z = el("div", "bk-hot " + (dir > 0 ? "next" : "prev"));
        z.addEventListener("click", function () { go(dir); });
        book.appendChild(z);
      });
      Object.keys(canv).forEach(function (k2) { place(+k2); });
      turned();
    });
  }
  function teardown() {
    if (pf) { try { pf.destroy(); } catch (e) { /* already gone */ } pf = null; }
    if (book) { book.remove(); book = null; }
  }

  function turned() {
    folio.textContent = "Page " + (cur + 1) + " of " + n;
    scrub.max = String(n);
    scrub.value = String(cur + 1);
    box.dataset.page = String(cur + 1);
    box.dataset.pages = String(n);
    clearTimeout(saveT);
    saveT = setTimeout(save, 1500);
    paintNear();
  }
  function save() {
    clearTimeout(saveT);
    if (cur === kept || !pdf) { return; }
    kept = cur;
    keep(cur + 1);
  }
  function turning() { return !!pf && pf.getState() !== "read"; }
  function go(dir) {
    var to = cur + dir;
    if (!pf || to < 0 || to >= n) { return; }
    if (dir > 0) { pf.flipNext("bottom"); } else { pf.flipPrev("bottom"); }
  }
  function goTo(i) {
    if (!pf) { return; }
    cur = Math.max(0, Math.min(n - 1, i));
    pf.turnToPage(cur);
    turned();
  }

  // The open page first, then the next ones and the one behind; never during a turn, which would cost it frames.
  function paintNear() {
    if (painting || closed || !pdf || turning()) { return; }
    var i = [cur, cur + 1, cur + 2, cur - 1, cur - 2].find(function (k) { return k >= 0 && k < n && !(canv[k] && (canv[k].failed || canv[k].w >= pageW * dpr * 0.9)); });
    if (i === undefined) { dropFar(); return; }
    painting = true;
    pdf.getPage(i + 1).then(function (pg) {
      var vp = pg.getViewport({ scale: pageW * dpr / pg.getViewport({ scale: 1 }).width });
      var c = document.createElement("canvas");
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      return pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise.then(function () { canv[i] = { canvas: c, w: c.width }; place(i); });
    }).catch(function () { canv[i] = { failed: true, w: 0 }; }).then(function () { painting = false; paintNear(); });
  }
  function place(i) {
    var c = canv[i], p = pages[i];
    if (c && c.canvas && p && c.canvas.parentNode !== p) { p.textContent = ""; p.appendChild(c.canvas); }
  }
  function dropFar() {
    Object.keys(canv).forEach(function (k) {
      if (Math.abs(+k - cur) <= 6) { return; }
      if (canv[k].canvas) { canv[k].canvas.width = 0; canv[k].canvas.remove(); }
      delete canv[k];
      if (pages[+k]) { pages[+k].textContent = ""; pages[+k].appendChild(el("span", "bk-num", String(+k + 1))); }
    });
  }

  // Turned sideways or a keyboard up: drawn again at the new size when it has settled.
  function onSize() {
    clearTimeout(sizeT);
    sizeT = setTimeout(function () {
      if (closed || !pdf || !book) { return; }
      var w = Math.floor(Math.min(stage.clientWidth, stage.clientHeight * ratio));
      if (Math.abs(w - pageW) > 30) { build(); }        // a page drawn too small for the new size is drawn again
    }, 250);
  }
  window.addEventListener("resize", onSize);

  function close() {
    if (closed) { return; }
    save();
    closed = true;
    clearTimeout(sizeT);
    window.removeEventListener("resize", onSize);
    teardown();
    Object.keys(canv).forEach(function (k) { if (canv[k].canvas) { canv[k].canvas.width = 0; } });
    canv = {};
    if (task) { task.destroy(); }
    pdf = null;
  }
  return { close: close };
}
