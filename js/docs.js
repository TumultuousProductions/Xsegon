/*  A game's documents: its manual, its maps, a guide. Each is a file in
    data\documents\<game id>\ whose own name is its label ("Manual.pdf" reads
    Manual), so there is no second list to keep in step (includes\extras.php).
    api\game.php sends the list; a library row only says whether there is any.

    A tab per document. A PDF opens as a booklet (js\reader.js), which takes
    the keys and the pad while it is up, with the browser's own reader one
    press away; a picture opens fitted, and full size on a press, to be
    dragged. It is a picker to the keys and the pad (launch.js, pick).  */

import { setEditorOnClose, toolFrame } from "./editors.js";
import { setPick, showStrip } from "./launch.js";
import { L, api } from "./log.js";
import { openReader } from "./reader.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { el, titleText, wheelSideways } from "./util.js";

function sizeWords(bytes) {
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
}

/* at: which document to open on, the first when not said. A card holding
   several versions of one game shows the documents of the first version
   that has any: they are the game's, whichever file they were found for. */
export function openDocs(g, at) {
  if (!g) { return; }
  var holder = (g.versions || []).find(function (v) { return v.docs; }) || g;
  api("api/game.php?id=" + encodeURIComponent(holder.id)).then(function (res) {
    var docs = (res.ok && res.game && res.game.documents) || [];
    if (!docs.length) { showStrip("no documents for " + g.title + " yet", false); return; }
    show(g, docs, Math.max(0, Math.min(docs.length - 1, at || 0)), holder.id);
  });
}

function show(g, docs, at, gid) {
  L("DOC", "open " + g.title + " (" + docs.length + ")");
  stopVideo();
  var reader = null, inFrame = false;
  function shut() { if (reader) { reader.close(); reader = null; } P.key = P.pad = null; }
  setEditorOnClose(shut);
  var inner = toolFrame("DOCUMENTS", { base: "doc-inner", close: "Back (esc)" });
  inner.appendChild(el("p", "group-help", titleText(g) + "  ·  " + docs.length + (docs.length === 1 ? " document" : " documents")));

  var tabs = el("div", "doc-tabs");
  wheelSideways(tabs);
  tabs.setAttribute("role", "tablist");
  var buttons = docs.map(function (d, i) {
    var b = el("button", "doc-tab", d.label);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.title = d.file + "  ·  " + sizeWords(d.bytes);
    b.addEventListener("click", function () { go(i); });
    tabs.appendChild(b);
    return b;
  });
  inner.appendChild(tabs);
  var stage = el("div", "doc-stage");
  inner.appendChild(stage);
  var note = el("p", "mt-note doc-note");
  inner.appendChild(note);
  $editor.appendChild(inner);
  $editor.dataset.tool = "docs";
  $editor.hidden = false;
  sound("select");

  function go(i) {
    i = Math.max(0, Math.min(docs.length - 1, i));
    P.at = i;
    var d = docs[i];
    buttons.forEach(function (b, k) {
      b.classList.toggle("on", k === i);
      b.setAttribute("aria-selected", k === i ? "true" : "false");
    });
    buttons[i].scrollIntoView({ block: "nearest", inline: "nearest" });
    shut();
    inFrame = false;
    stage.textContent = "";
    stage.className = "doc-stage " + (d.kind === "pdf" ? "is-pdf" : "is-pic");
    if (d.kind === "pdf") {
      reader = openReader(stage, note, g, d, { gid: gid, many: docs.length > 1, move: function (k) { P.move(k); }, browser: function () { frame(d); } });
      P.key = reader.key;
      P.pad = reader.pad;
    } else {
      var img = el("img", "doc-pic");
      img.alt = d.label;
      img.src = d.url;
      img.draggable = false;
      img.addEventListener("click", zoom);
      stage.appendChild(img);
      note.textContent = "Enter or a click shows it at its full size, and again fits it back. At full size, drag it to move about.";
    }
    L("DOC", "show " + d.file);
  }

  // The browser's own reader, for searching and copying a PDF's text; Enter or its tab is the booklet again.
  function frame(d) {
    shut();
    inFrame = true;
    stage.textContent = "";
    stage.className = "doc-stage is-pdf";
    var fr = el("iframe", "doc-frame");
    fr.title = d.label;
    fr.src = d.url + "#view=FitH";
    stage.appendChild(fr);
    note.textContent = "This is the browser's own reader: its arrows and the scroll wheel turn the pages, Ctrl+F finds a word. Enter, or the tab above, opens the booklet again.";
    L("DOC", "the browser's reader for " + d.file);
  }

  /* Full size and back. The place pressed stays under the pointer, so a
     click on a corner of a map opens on that corner; from the keys or the
     pad it opens on the middle. A drag that moved the picture is not a
     press, so letting go does not shrink it again. */
  var drag = null, dragged = false;
  function zoom(e) {
    var img = stage.querySelector(".doc-pic");
    if (!img) { return; }
    if (dragged) { dragged = false; return; }
    var r = img.getBoundingClientRect();
    var fx = e && r.width ? (e.clientX - r.left) / r.width : 0.5;
    var fy = e && r.height ? (e.clientY - r.top) / r.height : 0.5;
    var on = !stage.classList.contains("zoomed");
    stage.classList.toggle("zoomed", on);
    if (on) {
      stage.scrollLeft = img.offsetWidth * fx - stage.clientWidth / 2;
      stage.scrollTop = img.offsetHeight * fy - stage.clientHeight / 2;
    }
  }
  stage.addEventListener("pointerdown", function (e) {
    if (!stage.classList.contains("zoomed") || e.button !== 0) { return; }
    drag = { x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    dragged = false;
  });
  stage.addEventListener("pointermove", function (e) {
    if (!drag) { return; }
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 5) { dragged = true; }
    stage.scrollLeft = drag.left - (e.clientX - drag.x);
    stage.scrollTop = drag.top - (e.clientY - drag.y);
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
    stage.addEventListener(ev, function () { drag = null; });
  });

  var P = { at: at, move: function (d) { if (P.at + d >= 0 && P.at + d < docs.length) { sound("move"); } go(P.at + d); },
            choose: function () { if (inFrame) { go(P.at); } else { zoom(null); } }, key: null, pad: null };
  setPick(P);
  go(at);
}
