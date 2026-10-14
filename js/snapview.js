/*  A snap shown large: a press on the snap in the info panel or details
    (js\snap.js) opens it in the tool window, carrying on from where the small
    one was. Esc, B or Minimise puts it back small. Unlike the small snap, this
    one may be paused: it is being watched. */

import { setEditorOnClose, toolFrame } from "./editors.js";
import { L } from "./log.js";
import { snapVolume, stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { el, titleText } from "./util.js";

/* small: the snap that was pressed; after: what brings it back once this closes. */
export function openSnapView(g, small, after) {
  var at = small.currentTime || 0;
  var src = small.currentSrc || small.getAttribute("src");
  var loop = small.loop;
  var quiet = small.muted;
  L("VID", "large " + g.title);
  stopVideo();
  setEditorOnClose(after);
  var inner = toolFrame("VIDEO", { base: "vv-inner", close: "Minimise (esc)" });
  inner.appendChild(el("p", "group-help", titleText(g)));

  var stage = el("div", "vv-stage");
  var v = el("video", "vv-video");
  v.playsInline = true;
  v.loop = loop;
  v.muted = quiet;
  v.volume = snapVolume();
  v.src = src;
  v.addEventListener("loadedmetadata", function () {
    try { v.currentTime = Math.min(at, Math.max(0, v.duration - 0.5)); } catch (e) { /* from the start, then */ }
  }, { once: true });
  stage.appendChild(v);
  inner.appendChild(stage);

  var bar = el("div", "bar vv-bar");
  var pp = el("button", "primary vv-play", "Pause");
  var hear = el("button", "vv-sound");
  bar.appendChild(pp);
  bar.appendChild(hear);
  inner.appendChild(bar);

  function paint() {
    pp.textContent = v.paused ? "Play" : "Pause";
    hear.textContent = v.muted ? "Sound on" : "Sound off";
  }
  function playPause() {
    if (v.paused) { v.play().catch(function () { /* the button says Play still */ }); } else { v.pause(); }
  }
  pp.addEventListener("click", playPause);
  v.addEventListener("click", playPause);
  hear.addEventListener("click", function () { v.muted = !v.muted; paint(); });
  ["play", "pause", "ended", "volumechange"].forEach(function (n) { v.addEventListener(n, paint); });
  paint();

  $editor.appendChild(inner);
  $editor.dataset.tool = "video";
  $editor.hidden = false;
  sound("select");
  pp.focus();                            // Space and Enter press it
  v.play().catch(function (err) {
    // A tab that refuses sound before a click still plays it quietly. A Pause
    // pressed before it started also ends this wait, and is left paused.
    if (!err || err.name !== "NotAllowedError") { paint(); return; }
    v.muted = true;
    v.play().catch(function () { paint(); });
  });
}
