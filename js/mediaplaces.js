/*  The places a game's pictures, video and manual can come from, for the Media tab
    (js\mediatab.js, js\mediacompare.js, js\mediafrom.js): asking them through
    api\mediachoice.php, whose worker asks in the background, and watching the
    answers come in place by place. Every compare asks afresh, and its folder on
    the server goes when it closes: nothing is kept for the next one.  */

import { L, api, postJson } from "./log.js";
import { saveSetting } from "./savednote.js";

export var KIND_LABEL = { box: "Box art", box3d: "3D box", logo: "Clear logo", shot: "Screenshot", fanart: "Fanart / background",
                          video: "Video", manual: "Manual" };
export var PIC_KINDS = ["box", "box3d", "logo", "shot", "fanart"];
export var PLACE_NAME = { ss: "ScreenScraper", gamesdb: "Games Database", libretro: "libretro", steam: "Steam",
                          archive: "Internet Archive", arcadedb: "Arcade Database" };
// Where a video the game plays is found when Xsegon did not choose it (video_from, includes\video.php).
var LAYER = { own: "chosen in Xsegon", media: "your media copy", steam: "Steam", screenscraper: "ScreenScraper", name: "found by name" };

/* Where one of a game's own pictures came from (api\art.php: kinds[k].from), in words. */
export function picFrom(k) {
  if (k.hidden) { return "hidden: no picture shown"; }
  if (!k.has && !k.replaced) { return "none yet"; }
  if (!k.replaced) { return "the original"; }
  return k.from ? fromWords(k.from) : "chosen in Xsegon";
}

export function videoFrom(v) {
  if (!v.has) { return "none yet"; }
  return v.from ? fromWords(v.from) : LAYER[v.layer] || "found by name";
}

function fromWords(f) {
  if (f.from === "copy") { return "copied from " + f.game; }
  if (f.from === "file") { return "your own file"; }
  return PLACE_NAME[f.from] || f.from;
}

export function sizeWords(bytes) {
  if (!bytes) { return ""; }
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
}

/* What a kind takes from a file of your own: the endings and the most, as the server checks them after sending. */
var TAKES = { video: [/\.(mp4|m4v|webm)$/i, 400, "an MP4 or WebM video"], manual: [/\.(pdf|png|jpe?g|webp|gif)$/i, 200, "a PDF or a picture"] };
export function takesWhy(kind, file) {
  var t = TAKES[kind] || [/\.(png|jpe?g|webp|gif)$/i, 40, "a PNG, JPEG, WebP or GIF picture"];
  if (!t[0].test(file.name)) { return file.name + " is not " + t[2]; }
  if (file.size > t[1] * 1048576) { return file.name + " is " + Math.round(file.size / 1048576) + " MB, more than " + t[1] + " MB"; }
  return file.size ? "" : file.name + " is empty";
}

/* The groups Look in keeps its order and switches for (library.look, includes\settings.php). */
export function lookGroup(kind) { return kind === "video" ? "videos" : kind === "manual" ? "manuals" : "pictures"; }

/* A place turned on or off, or moved up: the whole of Look in saved again, as it was given with the answer. */
export function saveLook(look, why) {
  L("ART", "look in: " + why);
  return saveSetting({ library: { look: look } }, "Look in");
}

/*
 * One compare's asking: a ticket, and one more for each place turned on after it (asked alone), watched
 * until every place has answered and nothing is coming down. onUpdate(view) at every change, where view
 * is { places: { key: { state, why, search, items } }, prep: { ref: {...} }, done }, each item carrying
 * its ticket and place. The first answer's places, fits and look are on .first. A list of kinds for
 * kind is Find any: every place that is on, for those kinds.
 */
export function askPlaces(g, kind, onUpdate) {
  var tickets = [], answers = {}, timer = 0, closed = false, a = { first: null }, misses = 0;
  var unasked = {};           // a place turned on whose asking would not start: { state: "failed", why }
  var what = Array.isArray(kind) ? kind.join(", ") : kind;

  function merged() {
    var out = { places: {}, prep: {}, done: true };
    tickets.forEach(function (t) {
      var r = answers[t];
      if (!r) { out.done = false; return; }
      Object.keys(r.places).forEach(function (key) {
        var p = r.places[key];
        out.places[key] = Object.assign({}, p, { items: p.items.map(function (it) { return Object.assign({ ticket: t, place: key }, it); }) });
      });
      Object.keys(r.prep).forEach(function (ref) { out.prep[ref] = r.prep[ref]; });
      if (!r.done) { out.done = false; }
    });
    Object.keys(unasked).forEach(function (key) { if (!out.places[key]) { out.places[key] = unasked[key]; } });
    Object.keys(out.prep).forEach(function (ref) { if (out.prep[ref].state === "running") { out.done = false; } });
    return out;
  }
  /* A ticket the server no longer has (swept, or the server restarted): what it said stays, and what was
     still coming says it never will, so nothing waits on "asking..." for good. */
  function lost(t) {
    var r = answers[t] || { places: {}, prep: {} }, why = "this compare has closed on the server; Look again";
    var places = {}, prep = {};
    Object.keys(r.places).forEach(function (key) {
      var p = r.places[key];
      places[key] = p.state === "waiting" || p.state === "asking" ? Object.assign({}, p, { state: "failed", why: why }) : p;
    });
    Object.keys(r.prep).forEach(function (ref) {
      prep[ref] = r.prep[ref].state === "running" ? Object.assign({}, r.prep[ref], { state: "failed", why: why }) : r.prep[ref];
    });
    return { places: places, prep: prep, done: true, gone: true };
  }
  function poll() {
    clearTimeout(timer);
    if (closed || !tickets.length) { return; }
    var failed = false;
    Promise.all(tickets.map(function (t) {
      if (answers[t] && answers[t].gone) { return null; }
      return api("api/mediachoice.php?ticket=" + t).then(function (r) {
        if (r.ok) { answers[t] = r; return; }
        if (r.gone) {
          L("ART", g.title + ": a compare's answer is gone from the server (" + (r.error || "no answer") + ")");
          answers[t] = lost(t);
          return;
        }
        failed = true;        // the server busy or restarting: asked again in a moment, the last answer kept
      });
    })).then(function () {
      if (closed) { return; }
      misses = failed ? misses + 1 : 0;
      if (misses === 1) { L("ART", g.title + ": a compare's answer would not read; asking again"); }
      var v = merged();
      onUpdate(v);
      if (!v.done) { timer = setTimeout(poll, failed ? Math.min(10000, 700 * Math.pow(2, misses)) : 700); }
    });
  }
  a.start = function (only) {
    var q = "api/mediachoice.php?id=" + encodeURIComponent(g.id)
      + (Array.isArray(kind) ? "&find=" + kind.join(",") : "&kind=" + kind + (only ? "&only=" + only : ""));
    return api(q).then(function (r) {
      if (closed) { if (r.ok) { done(r.ticket); } return r; }
      if (!r.ok) {
        L("ART", g.title + ": the places could not be asked for its " + what + (only ? " (" + only + ")" : "") + ": " + (r.error || "no answer"));
        // One place turned on: it says why, instead of waiting for an answer that will not come.
        if (only && a.first) { unasked[only] = { state: "failed", why: r.error || "it could not be asked", items: [], kinds: [] }; onUpdate(merged()); }
        return r;
      }
      delete unasked[only || ""];
      if (!a.first) { a.first = r; }
      tickets.push(r.ticket);
      L("ART", g.title + ": " + what + " asked of " + (r.places.map(function (p) { return p.key; }).join(", ") || "no place"));
      poll();
      return r;
    });
  };
  /* Every place asked again: the old tickets go, and a new one comes. */
  a.again = function () {
    tickets.forEach(done);
    tickets = [];
    answers = {};
    unasked = {};
    a.first = null;
    return a.start();
  };
  a.prepare = function (it) {
    return postJson("api/mediachoice.php", { ticket: it.ticket, ref: it.ref, prepare: true }).then(function (r) {
      if (r.ok) { answers[it.ticket] = r; poll(); }
      else { L("ART", g.title + ": " + it.ref + " would not come down: " + (r.error || "no answer")); }
      return r;
    });
  };
  a.use = function (it, how, doc, holder) {
    return postJson("api/mediachoice.php", { ticket: it.ticket, ref: it.ref, id: g.id, use: true, how: how || "", doc: doc || "", holder: holder || "" });
  };
  a.back = function (ticket, kindNow, holder) {
    return postJson("api/mediachoice.php", { ticket: ticket, id: g.id, back: kindNow, holder: holder || "" });
  };
  a.poll = poll;
  a.close = function () {
    closed = true;
    clearTimeout(timer);
    tickets.forEach(done);
  };
  return a;
}

function done(ticket) { postJson("api/mediachoice.php", { ticket: ticket, done: true }); }
