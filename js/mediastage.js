/*  The stage of the Media tab's compare (js\mediacompare.js): Now and This one,
    each a picture, a video or a manual's page shown big, and the frames of the
    choices in the strip, each saying its size once it is known, or that it
    would not show. A manual pages through both together while that is on.  */

import { iconEl } from "./icons.js";
import { L } from "./log.js";
import { PIC_KINDS, PLACE_NAME, picFrom, sizeWords, videoFrom } from "./mediaplaces.js";
import { pdfPages } from "./reader.js";
import { sound } from "./sound.js";
import { el, plural } from "./util.js";

export function mcIsPic(kind) { return PIC_KINDS.indexOf(kind) >= 0; }
export function mcPlace(it) { return it.ref.split(":")[0]; }
export function mcClock(s) { s = Math.round(s || 0); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }

/* A press of the compare: key finds it again after a redraw, word is the legend's for it. */
export function mcButton(cls, text, run, key, word) {
  var b = el("button", cls, text);
  b.type = "button";
  b.dataset.key = key;
  b.dataset.word = word || text.replace(/\.\.\.$/, "").toLowerCase();
  b.addEventListener("click", run);
  return b;
}

/* A picture in a frame. onSize(w, h, failed) once it has come, or would not. */
export function picFrame(cls, src, onSize) {
  var f = el("div", "mc-frame " + cls);
  if (!src) { f.appendChild(el("span", "md-none", "none")); return f; }
  var img = el("img");
  img.alt = "";
  img.decoding = "async";
  img.onload = function () { if (onSize) { onSize(img.naturalWidth, img.naturalHeight, false); } };
  img.onerror = function () {
    img.remove();
    f.appendChild(el("span", "md-none", "would not show"));
    if (onSize) { onSize(0, 0, true); }
  };
  img.src = src;
  f.appendChild(img);
  return f;
}

/* A video in a frame: its first picture, or playing without sound when play is true (never with sound unasked).
   onMeta(seconds, w, h, failed). */
export function videoFrame(cls, src, play, onMeta) {
  var f = el("div", "mc-frame mc-vid " + cls);
  if (!src) { f.appendChild(el("span", "md-none", "none")); return f; }
  var v = el("video");
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.preload = "metadata";
  v.onloadedmetadata = function () { if (onMeta) { onMeta(v.duration, v.videoWidth, v.videoHeight, false); } };
  v.onerror = function () {
    v.remove();
    f.appendChild(el("span", "md-none", "would not play"));
    if (onMeta) { onMeta(0, 0, 0, true); }
  };
  v.src = src;
  if (play) { v.autoplay = true; }
  f.appendChild(v);
  return f;
}

/* A frame that waits: what for, and a bar that fills when the size is known. */
export function waitFrame(cls, words, got, size) {
  var f = el("div", "mc-frame mc-wait " + cls);
  f.appendChild(el("span", "mc-wait-words", words));
  var bar = el("span", "tp-prog" + (size ? "" : " wait"));
  var fill = el("i");
  if (size) { fill.style.width = Math.min(100, Math.round(100 * (got || 0) / size)) + "%"; }
  bar.appendChild(fill);
  f.appendChild(bar);
  return f;
}

/* Words in a frame, where there is nothing to show. */
export function sayFrame(cls, words) {
  var f = el("div", "mc-frame " + cls);
  f.appendChild(el("span", "md-none mc-say", words));
  return f;
}

/* A manual shown a page at a time: { el, go(step), at(), pages(), close() }. A picture document shows as
   itself. onOpen(pages, failed) once it has opened, or would not. */
export function pagesFrame(cls, url, isPdf, onOpen) {
  var f = el("div", "mc-frame mc-page " + cls);
  var doc = null, at = 0, closed = false, asked = 0;
  var me = { el: f, at: function () { return at; }, pages: function () { return doc ? doc.pages : isPdf ? 0 : 1; },
             go: function () { return at; }, close: function () { closed = true; if (doc) { doc.close(); doc = null; } } };
  if (!isPdf) {
    var img = el("img");
    img.alt = "";
    img.src = url;
    f.appendChild(img);
    if (onOpen) { onOpen(1, false); }
    return me;
  }
  f.appendChild(el("span", "md-none", "opening..."));
  function draw() {
    var mine = ++asked;
    doc.page(at, Math.max(160, f.clientWidth || 220)).then(function (c) {
      if (closed || mine !== asked) { return; }
      f.textContent = "";
      f.appendChild(c);
    }, function (e) {
      // Closed or turned on meanwhile: that draw was let go, not failed.
      if (closed || mine !== asked) { return; }
      f.textContent = "";
      f.appendChild(el("span", "md-none", "this page would not draw"));
      L("ART", "a manual's page " + (at + 1) + " would not draw: " + ((e && e.message) || e));
    });
  }
  pdfPages(url).then(function (d) {
    if (closed) { d.close(); return; }
    doc = d;
    draw();
    if (onOpen) { onOpen(d.pages, false); }
  }, function (e) {
    if (closed) { return; }
    f.textContent = "";
    f.appendChild(el("span", "md-none", "would not open"));
    L("ART", "a manual would not open (" + url.slice(0, 80) + "): " + ((e && e.message) || e));
    if (onOpen) { onOpen(0, true); }
  });
  me.go = function (step) {
    if (!doc) { return at; }
    var next = Math.max(0, Math.min(doc.pages - 1, at + step));
    if (next !== at) { at = next; draw(); }
    return at;
  };
  return me;
}

/* ---- Now: what the game shows (c is the compare, js\mediacompare.js) ---- */

/* A place a file of your own can be let go on (Now, and the Yours tile): the compare checks what came. */
export function mcDropOn(c, frame) {
  frame.title = "A file let go here takes its place";
  frame.addEventListener("dragover", function (e) { e.preventDefault(); frame.classList.add("drop"); });
  frame.addEventListener("dragleave", function () { frame.classList.remove("drop"); });
  frame.addEventListener("drop", function (e) {
    e.preventDefault();
    e.stopPropagation();
    frame.classList.remove("drop");
    c.dropFile(e.dataTransfer);
  });
}

export function paintNow(c) {
  var side = c.nowSide, kind = c.kind;
  side.textContent = "";
  if (c.nowPages) { c.nowPages.close(); c.nowPages = null; }
  side.appendChild(el("span", "mc-lab", "Now"));
  var dim = el("span", "mc-dim"), frame, cap = "";
  if (kind === "video") {
    var v = c.now && c.now.video;
    frame = v && v.has ? videoFrame("mc-big", "api/video.php?id=" + encodeURIComponent(c.g.id) + "&v=" + Date.now(), false, function (s, w, h, bad) {
      dim.textContent = bad ? "would not play" : [mcClock(s), w + " × " + h, sizeWords(v.bytes)].filter(Boolean).join("  ·  ");
    }) : sayFrame("mc-big", "no video yet");
    if (v && v.has) { frame.querySelector("video").controls = true; }
    cap = v ? videoFrom(v) : "";
  } else if (kind === "manual") {
    var d = c.docs[c.docAt];
    if (!d) {
      frame = sayFrame("mc-big mc-paper", "no manual yet");
      cap = "none yet";
    } else {
      c.nowPages = pagesFrame("mc-big mc-paper", d.url, d.kind === "pdf", function (n, bad) {
        dim.textContent = bad ? "would not open" : [plural(n, "page", "pages"), sizeWords(d.bytes)].join("  ·  ");
        pagers(c);
      });
      frame = c.nowPages.el;
      cap = d.label;
    }
  } else {
    var k = c.now && c.now.kinds[kind];
    frame = k && k.has
      ? picFrame("mc-big mc-k-" + kind, "api/image.php?id=" + encodeURIComponent(c.g.id) + "&kind=" + kind + "&size=full&v=" + Date.now(),
                 function (w, h, bad) { dim.textContent = bad ? "would not show" : w + " × " + h; })
      : sayFrame("mc-big mc-k-" + kind, k && k.hidden ? "hidden: no picture shown" : "none yet");
    cap = k ? picFrom(k) : "";
  }
  mcDropOn(c, frame);
  side.appendChild(frame);
  if (kind === "manual" && c.docs.length) { side.appendChild(pager(c, "now")); }
  side.appendChild(el("span", "mc-cap", cap));
  side.appendChild(dim);
  // A game with a manual and a map: which of them Now is, and what Use in its place replaces.
  if (kind === "manual" && c.docs.length > 1) {
    var pickDoc = el("select", "mc-doc");
    pickDoc.setAttribute("aria-label", "Which document Now shows");
    c.docs.forEach(function (doc, i) {
      var o = pickDoc.appendChild(el("option", null, doc.label));
      o.value = String(i);
      if (i === c.docAt) { o.selected = true; }
    });
    pickDoc.addEventListener("change", function () { c.docAt = parseInt(pickDoc.value, 10) || 0; c.redraw(); });
    side.appendChild(pickDoc);
  }
}

/* ---- This one: the choice beside it ---- */

/* What This one shows, in a few words: drawn again only when it changes, so a playing video is left playing. */
export function thisSig(c) {
  var it = c.picked, p = it ? c.view.prep[it.ref] : null;
  if (!it) { return ""; }
  // One that shows from its place keeps playing while its file comes down: only a wait frame counts what has come.
  var src = it.view || (p && p.state === "done" ? p.view : "");
  return it.ref + "|" + (src ? "src " + src : p ? p.state + "|" + Math.round((p.got || 0) / 262144) : "") + "|" + (c.prepFail[it.ref] || "");
}

export function paintThis(c) {
  var side = c.thisSide, kind = c.kind, it = c.picked;
  side.textContent = "";
  if (c.thisPages) { c.thisPages.close(); c.thisPages = null; }
  side.appendChild(el("span", "mc-lab", kind === "video" ? (c.sound ? "This one, with sound" : "This one, playing without sound") : "This one"));
  c.thisSig = thisSig(c);
  if (!it) {
    side.appendChild(sayFrame("mc-big mc-k-" + kind, c.view.done ? "press a choice to see it here" : "the places are being asked..."));
    return;
  }
  var place = mcPlace(it), prep = c.view.prep[it.ref];
  var dim = el("span", "mc-dim", [it.sub, sizeWords(it.size)].filter(Boolean).join("  ·  "));
  var src = it.view || (prep && prep.state === "done" ? prep.view : "");
  var frame;
  if (mcIsPic(kind)) {
    frame = picFrame("mc-big mc-k-" + kind, src, function (w, h, bad) {
      dim.textContent = bad ? "would not show" : [it.sub, w + " × " + h].filter(Boolean).join("  ·  ");
    });
  } else if (kind === "video" && src) {
    frame = videoFrame("mc-big", src, true, function (s, w, h, bad) {
      dim.textContent = bad ? "would not play" : [mcClock(s), w + " × " + h, sizeWords(it.size || (prep && prep.size))].filter(Boolean).join("  ·  ");
    });
    frame.querySelector("video").muted = !c.sound;
  } else if (kind === "manual" && prep && prep.state === "done") {
    c.thisPages = pagesFrame("mc-big mc-paper", prep.view, true, function (n, bad) {
      dim.textContent = bad ? "would not open" : [plural(n, "page", "pages"), sizeWords(prep.size)].join("  ·  ");
      pagers(c);
    });
    frame = c.thisPages.el;
  } else if ((prep && prep.state === "failed") || c.prepFail[it.ref]) {
    frame = sayFrame("mc-big", "it would not come down: " + ((prep && prep.why) || c.prepFail[it.ref] || "no reason given"));
  } else {
    // A wait says what it waits for: a ScreenScraper download in line says so.
    frame = waitFrame("mc-big", (prep && prep.why ? prep.why : "coming down from " + PLACE_NAME[place] + (it.size ? ", " + sizeWords(it.size) : "")) + "...",
                      prep ? prep.got : 0, prep ? (prep.size || it.size) : it.size);
  }
  side.appendChild(frame);
  if (kind === "manual" && c.thisPages) { side.appendChild(pager(c, "this")); }
  side.appendChild(el("span", "mc-cap", PLACE_NAME[place] + "  ·  " + it.label));
  side.appendChild(dim);
}

/* A manual's page turns: ‹ page n of m ›, the other side turning with it while Turn both pages together is on. */
function pager(c, which) {
  var line = el("div", "mc-pager");
  var turn = function (step) {
    var a = which === "now" ? c.nowPages : c.thisPages, b = which === "now" ? c.thisPages : c.nowPages;
    if (a) { a.go(step); }
    if (c.together && b) { b.go(step); }
    sound("move");
    pagers(c);
  };
  var prev = mcButton("mc-pg", "", function () { turn(-1); }, "pg:" + which + ":-1", "page before");
  prev.appendChild(iconEl("mc-pg-ico", "back"));
  prev.setAttribute("aria-label", "Page before");
  var next = mcButton("mc-pg mc-pg-next", "", function () { turn(1); }, "pg:" + which + ":1", "next page");
  next.appendChild(iconEl("mc-pg-ico", "back"));
  next.setAttribute("aria-label", "Next page");
  line.appendChild(prev);
  line.appendChild(el("span", "mc-pgw mc-pgw-" + which, ""));
  line.appendChild(next);
  return line;
}

export function pagers(c) {
  [["now", c.nowPages], ["this", c.thisPages]].forEach(function (x) {
    var w = c.pane.querySelector(".mc-pgw-" + x[0]);
    if (w && x[1]) { w.textContent = x[1].pages() ? "page " + (x[1].at() + 1) + " of " + x[1].pages() : ""; }
  });
}
