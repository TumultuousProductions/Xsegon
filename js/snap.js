import { L, logWarn } from "./log.js";
import { rowsArt } from "./rows.js";
import { openSnapView } from "./snapview.js";
import { SND, gain, muted, paintVolume, setMuted, sound, toggleMute } from "./sound.js";
import { $details, $editor, $hero, $main, $settings, S, games, sel, sysStage, view } from "./state.js";
import { el } from "./util.js";
import { carNodes, flatNodes } from "./views.js";

// ---------- video snaps ----------
/* Rest on a game for video.delaySec and its snap takes the artwork's place;
   move, and the artwork is back at once. One snap at a time, anywhere.
   The snap REPLACES the artwork: it takes the image's classes and exact box,
   so nothing moves, and the image is hidden only once the first frame plays.
   A snap that fails costs nothing: the artwork never leaves. */

export var snap = { timer: null, video: null, art: null };
export var gameRunning = false;
// What rests while a game runs (the rain, the snow, the looks that move) is told when it is over.
var afterGame = [];
export function onGameOver(fn) { afterGame.push(fn); }
export function setGameRunning(v) {
  var was = gameRunning;
  gameRunning = v;
  if (was && !v) { afterGame.forEach(function (fn) { fn(); }); }
}

// snapHeard: the small button on a snap asked for sound this session, which
// outranks Settings > Video > Snap sound being off until the page reloads.
var snapHeard = false;
// The film bar in the volume corner asks the same, when it is raised.
export function hearSnaps() { snapHeard = true; }
/* A snap has a level of its own (Settings > Video > Snap volume), because a
   game's title music at the same level as the menu blips is far too loud.
   Mute still silences it, the way a TV's mute silences everything. */
export function snapLevel() {
  var v = (typeof SND.videoVolume === "number") ? SND.videoVolume : 75;
  return Math.max(0, Math.min(100, v));
}
// The level as loudness, on the same curve as the app's sounds (js\sound.js).
export function snapVolume() { return gain(snapLevel()); }
export function snapMuted() {
  return muted || snapLevel() <= 0 || (SND.videoSound === false && !snapHeard);
}

/* The Play/Pause key, taken off the browser's hands: with a handler of the
   page's own the browser asks the page instead of pausing the snap (armVideo's
   pause listener is the net under this). Logged, so a snap that stopped can be
   told from one only asked to. */
if (navigator.mediaSession) {
  ["play", "pause"].forEach(function (a) {
    try {
      navigator.mediaSession.setActionHandler(a, function () { L("VID", "media key (" + a + ") left alone: a snap does not pause"); });
    } catch (e) { /* a browser without that action: the pause listener covers it */ }
  });
}

/* The snap's own button. Silent for any reason (muted, volume at nothing,
   snap sound off, or a tab that refused sound): bring the sound, the way a
   TV's unmute does, lifting a zero volume to 70. Otherwise mute, everywhere. */
function toggleSnapSound() {
  if (!snap.video) { return; }
  if (snap.video.muted) {
    L("VID", "sound on (snap button)");
    setMuted(false);
    try { localStorage.setItem("xs-muted", "0"); } catch (e) { /* fine */ }
    snapHeard = true;
    // Only for this session, like snapHeard itself: the button is "let me
    // hear this", not a settings change made behind your back.
    if (snapLevel() <= 0) { SND.videoVolume = 70; }
    paintVolume();
    snap.video.muted = false;
    sound("select");
  } else {
    L("VID", "mute (snap button)");
    toggleMute();
  }
  paintSnapMute();
}

var vidLogged = null;
export function stopVideo() {
  if (vidLogged) { L("VID", "stop " + vidLogged); vidLogged = null; }
  clearTimeout(snap.timer);
  snap.timer = null;
  if (snap.video) {
    try { snap.video.pause(); snap.video.removeAttribute("src"); snap.video.load(); } catch (e) { /* fine */ }
    snap.video.remove();
  }
  if (snap.mute) { snap.mute.remove(); snap.mute = null; }
  if (snap.bar) { snap.bar.remove(); snap.bar = null; }
  snap.held = false;
  if (snap.host) { snap.host.classList.remove("snap-host"); snap.host = null; }
  // The panel's frame opens again at once: the next picture needs the room.
  if (snap.frame) {
    snap.frame.classList.remove("snap-fit");
    snap.frame.style.height = "";
    snap.frame = null;
  }
  if (snap.art) { snap.art.hidden = false; }
  snap.video = null;
  snap.art = null;
}

/* A small speaker in the snap's bottom right corner: the same mute as the m
   key and the slider. Sits in the video's parent, which becomes the anchor. */
function placeSnapMute(v) {
  var host = v.parentNode;
  if (!host) { return; }
  host.classList.add("snap-host");
  var b = el("button", "snap-mute");
  b.type = "button";
  b.title = "Mute (m)";
  b.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); });
  b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); toggleSnapSound(); });
  b.addEventListener("contextmenu", function (e) { e.stopPropagation(); });
  host.appendChild(b);
  snap.host = host;
  snap.mute = b;
  b.style.left = (v.offsetLeft + v.offsetWidth - 24) + "px";
  b.style.top = edgeTop(v, 24);
  paintSnapMute();
}

/* Where something stands that is `up` pixels above the snap's bottom edge.
   The panel's snap is placed from the middle of its frame (fitSnap), so what
   rides on it is too, and both follow the frame as it closes up. */
function edgeTop(v, up) {
  return v.dataset.mid ? "calc(50% + " + (v.offsetHeight / 2 - up) + "px)"
                       : (v.offsetTop + v.offsetHeight - up) + "px";
}

export function paintSnapMute() {
  if (!snap.mute) { return; }
  var off = snap.video ? snap.video.muted : snapMuted();   // the video's truth: a tab may have refused sound
  snap.mute.classList.toggle("muted", off);
  snap.mute.title = off ? "Unmute (m)" : "Mute (m)";
  snap.mute.innerHTML = off
    ? '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>'
    : '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6 6 0 0 1 0 9" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>';
}

/* Pause or play, and how far along it is, on the snap's bottom edge beside
   the speaker. Up only while the pointer is on the snap (the stylesheet),
   and a pause pressed here is the one pause a snap keeps (snap.held). */
var ICON_PAUSE = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor"/></svg>';
var ICON_PLAY = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4.5 2.5v11l9-5.5z" fill="currentColor"/></svg>';

function clock(secs) {
  var s = Math.max(0, Math.floor(secs || 0));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

function placeSnapBar(v) {
  var host = v.parentNode;
  if (!host || v.offsetWidth < 90) { return; }   // no room for a bar on a snap that small
  var bar = el("div", "snap-ctl");
  var pp = el("button", "snap-pp");
  pp.type = "button";
  var track = el("div", "snap-track");
  var fill = el("div", "snap-fill");
  var time = el("span", "snap-time");
  track.appendChild(fill);
  bar.appendChild(pp);
  bar.appendChild(track);
  bar.appendChild(time);
  time.hidden = v.offsetWidth < 250;

  // Presses stay on the bar: under it is a tile that opens, or a snap that goes large.
  // A right-click goes through, so the game's menu opens here as anywhere on it.
  ["pointerdown", "mousedown", "click", "dblclick"].forEach(function (n) {
    bar.addEventListener(n, function (e) {
      if (n === "mousedown") { e.preventDefault(); }
      e.stopPropagation();
    });
  });

  var shown = null;
  function paint() {
    var d = v.duration, known = isFinite(d) && d > 0;
    fill.style.width = (known ? Math.min(100, 100 * v.currentTime / d) : 0) + "%";
    time.textContent = known ? clock(v.currentTime) + " / " + clock(d) : "";
    // Only when it changes: a button redrawn under a press loses the press.
    if (shown !== v.paused) {
      shown = v.paused;
      pp.innerHTML = shown ? ICON_PLAY : ICON_PAUSE;
      pp.title = shown ? "Play" : "Pause";
    }
  }
  pp.addEventListener("click", function () {
    if (snap.video !== v) { return; }
    if (v.paused) {
      L("VID", "play (snap bar)");
      snap.held = false;
      var r = v.play();
      if (r && r.catch) { r.catch(function () { paint(); }); }
    } else {
      L("VID", "pause (snap bar)");
      snap.held = true;
      v.pause();
    }
    paint();
  });
  function seek(e) {
    var box = track.getBoundingClientRect();
    if (snap.video !== v || !box.width || !isFinite(v.duration) || !v.duration) { return; }
    v.currentTime = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * v.duration;
    paint();
  }
  track.addEventListener("pointerdown", function (e) {
    try { track.setPointerCapture(e.pointerId); } catch (x) { /* the press still seeks */ }
    seek(e);
  });
  track.addEventListener("pointermove", function (e) { if (e.buttons & 1) { seek(e); } });
  ["timeupdate", "durationchange", "play", "pause", "seeked"].forEach(function (n) { v.addEventListener(n, paint); });

  host.appendChild(bar);
  snap.bar = bar;
  // Along the video's own bottom edge, stopping short of the speaker.
  bar.style.left = (v.offsetLeft + 4) + "px";
  bar.style.top = edgeTop(v, 24);
  bar.style.width = (v.offsetWidth - 32) + "px";
  paint();
}

/* In the info panel and in details a snap keeps the panel's width but takes
   its own shape, so a widescreen one is not a tall black box. Elsewhere (a
   tile, a card, the rows band) it keeps the picture's box: those cannot move. */
function bigPanel(art, where) {
  return where === "details" || art.classList.contains("hero-art");
}

function fitSnap(v, art, w, h) {
  var vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh || !w) { return; }
  var fw = w, fh = Math.round(w * vh / vw);
  if (h && fh > h) { fh = h; fw = Math.round(h * vw / vh); }
  v.style.width = fw + "px";
  v.style.height = fh + "px";
  // The panel's picture is placed in its frame: the snap goes in the middle
  // of it, measured from the middle so it stays there while the frame closes up.
  if (art.classList.contains("hero-art")) {
    v.style.left = Math.round((w - fw) / 2) + "px";
    v.style.top = "calc(50% - " + (fh / 2) + "px)";
    v.style.right = "auto";
    v.style.bottom = "auto";
    v.dataset.mid = "1";
  }
}

/* In the info panel a snap is seldom the cover's shape, so once it plays the
   frame closes up to its height, slowly (.snap-fit), and the words under it
   come up. It opens again at once when the snap goes (stopVideo). */
function closeFrame(v) {
  var frame = v.parentNode;
  if (!frame || !frame.classList.contains("hero-art-frame")) { return; }
  var full = frame.offsetHeight, want = v.offsetHeight;
  if (!want || full - want < 8) { return; }      // the snap all but fills it already
  frame.style.height = full + "px";
  frame.classList.add("snap-fit");
  void frame.offsetHeight;                       // the glide starts from the full height
  frame.style.height = want + "px";
  snap.frame = frame;
}

export function armVideo(art, g, where) {
  if (g && g.hasVideo && S.video && S.video.enabled !== false) { L("VID", "arm " + where + " " + g.title); }
  stopVideo();
  var V = S.video || {};
  if (!art || !g || !g.hasVideo || V.enabled === false || gameRunning) { return; }
  if (where === "details" ? V.inDetails === false : V.inBrowse === false) { return; }

  var delay = Math.max(0, Number(V.delaySec === undefined ? 2 : V.delaySec)) * 1000;
  snap.timer = setTimeout(function () {
    // Still the thing on screen? A rebuild or a hidden view means no, and the log says why.
    if (!art.isConnected || !art.offsetWidth) {
      L("VID", "skip " + g.title + ": " + (!art.isConnected ? "its picture was drawn again before the wait ended" : "its picture has no size on screen"));
      return;
    }

    var v = document.createElement("video");
    var artW = art.offsetWidth, artH = art.offsetHeight;
    v.className = art.className + " snap";
    v.style.width = artW + "px";
    v.style.height = artH + "px";
    v.style.display = "none";            // takes no room until it is playing
    v.loop = V.loop !== false;
    v.playsInline = true;
    v.preload = "auto";
    v.muted = snapMuted();
    v.volume = snapVolume();
    // videoRev: a replaced video is a new address, never the cached old one.
    // videoUrl: the snap's plain address, where the server gives one.
    v.src = g.videoUrl ||
            ("api/video.php?id=" + encodeURIComponent(g.id) + (g.videoRev ? "&v=" + g.videoRev : ""));

    v.addEventListener("playing", function () {
      if (snap.video !== v) { return; }
      vidLogged = g.title;
      L("VID", "playing " + g.title + (v.muted ? " (muted)" : ""));
      if (bigPanel(art, where)) {
        fitSnap(v, art, artW, artH);
        // A press on a panel's snap shows it large (js\snapview.js).
        v.classList.add("snap-big");
        v.title = "Show it large";
        v.addEventListener("click", function (e) {
          e.stopPropagation();
          openSnapView(g, v, function () { if (art.isConnected) { armVideo(art, g, where); } });
        });
      }
      art.hidden = true;
      v.style.display = "";
      placeSnapMute(v);
      placeSnapBar(v);
      closeFrame(v);
    }, { once: true });
    v.addEventListener("error", function () {
      if (snap.video !== v) { return; }
      // Said, or a corrupt snap reads as "the delay never came".
      logWarn("the snap for " + g.title + " could not play (" + (v.error ? "code " + v.error.code : "no reason") + "); the artwork stays");
      stopVideo();
    });
    v.addEventListener("ended", function () { if (snap.video === v) { stopVideo(); } });
    /* A snap is not something to pause: pulling a headphone plug out sends a
       Play/Pause press and the browser pauses whatever plays. Whatever paused
       it, it carries on, a few tries only so something that insists wins. A snap
       this module stopped, and a pause on the snap's own bar (snap.held), are left. */
    var resumed = 0;
    v.addEventListener("pause", function () {
      if (snap.video !== v || v.ended || snap.held || resumed >= 5) { return; }
      resumed++;
      // Where the window was says which: the browser itself pauses a video in a window it cannot see.
      var was = document.hidden ? "hidden (covered or minimised)" : document.hasFocus() ? "in front" : "in sight with another window in front";
      L("VID", "resumed " + g.title + ": the browser paused it (a Play/Pause key, or headphones pulled out); Xsegon's window was " + was);
      var r = v.play();
      if (r && r.catch) {
        r.catch(function (err) {
          if (snap.video === v) { logWarn("the snap for " + g.title + " stayed paused (" + ((err && err.name) || "refused") + ")"); }
        });
      }
    });

    art.parentNode.insertBefore(v, art);
    snap.video = v;
    snap.art = art;

    var p = v.play();
    if (p && p.catch) {
      p.catch(function (err) {
        // An ordinary tab refuses sound before the first click. Silent is
        // still a snap; the app window is started with autoplay allowed.
        if (snap.video !== v) { return; }
        L("VID", "the browser would not play " + g.title + " with sound (" + ((err && err.name) || "refused") + "); trying muted");
        v.muted = true;
        paintSnapMute();
        var again = v.play();
        if (again && again.catch) {
          again.catch(function (err2) {
            if (snap.video !== v) { return; }
            logWarn("the snap for " + g.title + " was refused even muted (" + ((err2 && (err2.name + ": " + err2.message)) || "no reason") + "); the artwork stays");
            stopVideo();
          });
        }
      });
    }
  }, delay);
}

// Where the artwork is, in whichever view is showing.
export function armBrowse() {
  if (!$details.hidden) { return; }      // details owns the snap while it is open
  stopVideo();
  if (sysStage === "wall" || !$settings.hidden || !$editor.hidden || $main.hidden || !games.length) { return; }
  var g = games[sel], art = null;
  if (view === "carousel" && carNodes && carNodes[sel]) {
    art = carNodes[sel].querySelector(".gcard-art");
  } else if (view === "rows") {
    art = rowsArt();                     // the picture in the band across the top
  } else if (view === "grid" && flatNodes[sel]) {
    art = flatNodes[sel].querySelector(".shot");
  } else if (!$hero.hidden) {
    art = $hero.querySelector(".hero-art");
  }
  armVideo(art, g, "browse");
}
