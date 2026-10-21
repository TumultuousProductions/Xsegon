/*  The compare in a game's Media tab (roadmap BM): one kind of its media, the
    one it shows now beside a choice, both big (js\mediastage.js), and every
    choice the places have in a strip, a group per place. A choice pressed shows
    beside the one now; Use this one keeps it at once, and Put back the one
    before undoes it while the compare is open. Look in (js\medialook.js) turns
    places on and off. The places are asked as it opens, each with its own bar
    while it waits (js\mediaplaces.js). The keys and the pad go down the
    choices, then the presses (setTabRows); moving onto a choice shows it.  */

import { uploadArt, uploadPieces, videoClearLines } from "./art-editors.js";
import { confirmWindow } from "./confirm.js";
import { setTabRows, tabSays } from "./detailtabs.js";
import { iconEl } from "./icons.js";
import { showStrip } from "./launch.js";
import { L, api } from "./log.js";
import { drawLookIn, inOrder, placeIsOn, placeWords, searchPicker } from "./medialook.js";
import { KIND_LABEL, PIC_KINDS, PLACE_NAME, askPlaces, picFrom, sizeWords, takesWhy } from "./mediaplaces.js";
import { mcButton, mcClock, mcDropOn, mcIsPic, mcPlace, paintNow, paintThis, picFrame, sayFrame, thisSig, videoFrame } from "./mediastage.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { el } from "./util.js";

var SHORT = { box: "Box art", box3d: "3D box", logo: "Clear logo", shot: "Screenshot", fanart: "Fanart", video: "Video", manual: "Manual" };
var open = null;            // the compare up now: closed when the tab, the kind or the game changes

/* The compare up now is let go: its asking ends, its folder on the server goes, its previews stop. */
export function closeCompare() {
  var c = open;
  if (!c) { return; }
  open = null;
  c.closed = true;
  if (c.pending) { showStrip(KIND_LABEL[c.kind] + " was not used: the compare closed before it came down"); }
  settle(c, "the compare closed before it came down");
  c.ask.close();
  clearTimeout(c.prepT);
  if (c.nowPages) { c.nowPages.close(); }
  if (c.thisPages) { c.thisPages.close(); }
  c.pane.querySelectorAll(".mc-tab video").forEach(function (v) { v.pause(); v.removeAttribute("src"); v.load(); });
}

/*
 * how: { back() to all media, other() to copy from another game, kind(k) another kind, changed(kind) after
 * the game's own changed, holder: the game whose documents folder holds its manuals }.
 */
export function compareView(pane, g, kind, how) {
  closeCompare();
  if (kind === "video") { stopVideo(); }
  var c = open = { g: g, kind: kind, pane: pane, how: how, closed: false, view: { places: {}, prep: {}, done: false },
                   fits: [], look: {}, now: null, docs: [], docAt: 0, picked: null, lastUsed: "", kept: null, sizes: {},
                   groups: {}, sound: false, together: true, pending: null, working: false, failLogged: {}, cells: [], at: 0, focusKey: "",
                   prepFail: {}, actsSig: "", lookSig: "" };
  c.dropFile = function (dt) { dropped(c, dt); };
  c.redraw = function () { paintNow(c); paintActs(c); relist(c); };
  c.ask = askPlaces(g, kind, function (v) { if (!c.closed) { onView(c, v); } });
  build(c);
  readNow(c);
  L("ART", g.title + ": compare " + kind + " opened (Media tab)");
  // A moment before asking: going quickly across the kinds asks no place (ScreenScraper above all) for the ones passed over.
  setTimeout(function () {
    if (c.closed) { return; }
    c.ask.start().then(function (r) {
      if (c.closed) { return; }
      if (!r.ok) {
        c.view.done = true;
        c.strip.textContent = "";
        c.strip.appendChild(tabSays("The places could not be asked: " + (r.error || "the server did not answer") + ". Look again tries once more"));
        c.strip.appendChild(c.yours);
        lookIn(c);
        paintThis(c);
        relist(c);
        return;
      }
      c.fits = r.fits || [];
      c.look = r.look || {};
      lookIn(c);
      paintStrip(c);
      relist(c);
    });
  }, 250);
}

function build(c) {
  c.pane.textContent = "";
  var inner = el("div", "ch-inner ch-tab md-tab mc-tab");
  var top = el("div", "mc-top");
  c.backBtn = mcButton("mc-back md-back", "All media", function () { sound("back"); c.how.back(); }, "back", "back to all media");
  c.backBtn.prepend(iconEl("mc-back-ico", "back"));
  top.appendChild(c.backBtn);
  var kinds = el("div", "mc-kinds");
  c.kindBtns = PIC_KINDS.concat(["video", "manual"]).map(function (k) {
    var b = mcButton("mc-kind" + (k === c.kind ? " on" : ""), SHORT[k], function () {
      if (k !== c.kind) { sound("select"); c.how.kind(k); }
    }, "kind:" + k, "compare the " + KIND_LABEL[k].toLowerCase());
    b.dataset.kind = k;
    kinds.appendChild(b);
    return b;
  });
  top.appendChild(kinds);
  inner.appendChild(top);
  c.body = el("div", "mc-body mt-fit");
  var main = el("div", "mc-main");
  var stage = el("div", "mc-stage");
  c.nowSide = el("div", "mc-side mc-now");
  c.thisSide = el("div", "mc-side mc-this");
  stage.appendChild(c.nowSide);
  stage.appendChild(iconEl("mc-arrow", "play"));
  stage.appendChild(c.thisSide);
  main.appendChild(stage);
  c.acts = el("div", "mc-acts");
  main.appendChild(c.acts);
  c.strip = el("div", "mc-strip");
  c.strip.appendChild(el("p", "dtab-wait", "asking the places..."));
  main.appendChild(c.strip);
  c.body.appendChild(main);
  c.lookBox = el("div", "mc-look");
  c.body.appendChild(c.lookBox);
  inner.appendChild(c.body);
  // A picture chosen through Wrong game? Search... (openPicker): the game's own is read again, and every place asked again.
  inner.addEventListener("xs-art-changed", function () {
    if (c.closed) { return; }
    c.how.changed(c.kind);
    readNow(c);
    again(c);
  });
  // A file let go beside the frames must not open in place of the page.
  inner.addEventListener("dragover", function (e) { e.preventDefault(); });
  inner.addEventListener("drop", function (e) { e.preventDefault(); });
  c.pane.appendChild(inner);
  c.yours = yoursGroup(c);
  paintThis(c);
}

/* What the game shows now: its pictures and video (api\art.php), or its documents (api\game.php). */
function readNow(c, wantDoc) {
  var q = c.kind === "manual" ? "api/game.php?id=" + encodeURIComponent(c.how.holder) : "api/art.php?id=" + encodeURIComponent(c.g.id);
  api(q).then(function (res) {
    if (c.closed) { return; }
    if (!res.ok) {
      L("ART", c.g.title + ": what it shows now would not read: " + (res.error || "no answer"));
      c.now = null;
    } else if (c.kind === "manual") {
      c.docs = (res.game && res.game.documents) || [];
      var at = c.docs.map(function (d) { return d.file; }).indexOf(wantDoc || "");
      c.docAt = at >= 0 ? at : Math.max(0, Math.min(c.docAt, c.docs.length - 1));
    } else {
      c.now = res;
    }
    c.redraw();
  });
}

/* ---- the presses under the stage ---- */

function paintActs(c) {
  var acts = c.acts, kind = c.kind, it = c.picked;
  // Drawn again only when what they say has changed: a press mid-way through a redraw would be lost.
  var sig = JSON.stringify([kind, it && it.ref, c.lastUsed, !!c.kept, c.pending && c.pending.ref, c.sound, c.working,
                            c.now && mcIsPic(kind) ? c.now.kinds[kind] : null, !!(c.now && c.now.video && c.now.video.has), c.docs.length, c.docAt, c.together]);
  if (sig === c.actsSig && acts.firstChild) { return; }
  c.actsSig = sig;
  acts.textContent = "";
  var shown = !!it && it.ref === c.lastUsed;
  if (kind === "manual") {
    var hasNow = !!c.docs[c.docAt];
    var useIt = mcButton("mc-use primary", hasNow ? "Use in its place" : "Use as the manual", function () { if (c.picked) { useItem(c, c.picked, "replace"); } }, "use");
    useIt.disabled = !it || shown;
    acts.appendChild(useIt);
    if (hasNow) {
      var both = mcButton("mc-keep", "Keep both", function () { if (c.picked) { useItem(c, c.picked, "keep"); } }, "keep", "keep both");
      both.disabled = !it || shown;
      acts.appendChild(both);
    }
  } else {
    var use = mcButton("mc-use primary", shown ? "Shown now" : "Use this one", function () { if (c.picked) { useItem(c, c.picked, ""); } }, "use");
    use.disabled = !it || shown;
    acts.appendChild(use);
  }
  if (c.kept) {
    var kept = el("span", "mc-kept");
    kept.appendChild(iconEl("mc-kept-ico", "check"));
    kept.appendChild(document.createTextNode("Kept."));
    acts.appendChild(kept);
    acts.appendChild(mcButton("mc-putback", "Put back the one before", function () { putBack(c); }, "putback"));
  }
  if (c.pending) { acts.appendChild(el("span", "mc-dim", "it is used as soon as it has come down")); }
  acts.appendChild(el("span", "mc-gap"));
  if (mcIsPic(kind)) {
    var k = c.now && c.now.kinds[kind];
    if (k && k.replaced) {
      acts.appendChild(mcButton("mc-small", k.hadOne ? "Reset to the original" : "Remove", function () { askReset(c, k); }, "reset"));
    } else if (k && (k.has || k.hidden)) {
      acts.appendChild(mcButton("mc-small", k.hidden ? "Use the original again" : "Use no picture",
        function () { artPost(c, "&hide=" + (k.hidden ? "0" : "1"), k.hidden ? "original again" : "no picture"); }, "hide"));
    }
  } else if (kind === "video") {
    var snd = mcButton("mc-small", c.sound ? "Turn sound off" : "Turn sound on", function () {
      c.sound = !c.sound;
      L("ART", c.g.title + ": compare previews " + (c.sound ? "with" : "without") + " sound");
      var playing = c.thisSide.querySelector("video");
      if (playing) { playing.muted = !c.sound; }
      c.thisSide.querySelector(".mc-lab").textContent = c.sound ? "This one, with sound" : "This one, playing without sound";
      paintActs(c);
      relist(c);
    }, "sound", c.sound ? "turn sound off" : "turn sound on");
    snd.prepend(iconEl("mc-snd-ico", c.sound ? "speakerOff" : "speaker"));
    acts.appendChild(snd);
    var v = c.now && c.now.video;
    if (v && v.has) { acts.appendChild(mcButton("mc-small", "Clear video...", function () { clearVideo(c); }, "clear")); }
  } else if (c.docs.length) {
    var both2 = el("label", "mc-check");
    var tick = el("input");
    tick.type = "checkbox";
    tick.checked = c.together;
    tick.addEventListener("change", function () { c.together = tick.checked; });
    both2.appendChild(tick);
    both2.appendChild(document.createTextNode("Turn both pages together"));
    acts.appendChild(both2);
  }
}

/* Remove or Reset deletes the picture chosen for it, which nothing here brings back: asked first, the one
   press on this screen that is (Use this one has Put back, Use no picture has Use the original again). */
function askReset(c, k) {
  var what = KIND_LABEL[c.kind].toLowerCase();
  confirmWindow(k.hadOne ? "Go back to the original " + what + "?" : "Remove the " + what + "?", function (box) {
    box.appendChild(el("p", null, "The " + what + " " + c.g.title + " shows now (" + picFrom(k) + ") is deleted, and cannot be put back here. "
      + (k.hadOne ? "The original shows again." : "It will have none.")));
    if (c.kept) { box.appendChild(el("p", null, "To bring back the one it had before this compare instead, press Put back the one before.")); }
  }, { label: k.hadOne ? "Reset" : "Remove", run: function () { artPost(c, "&reset=1", "reset"); } }, "Cancel");
}

/* Use no picture, the original again, or reset: as Change Pictures does them (api\art.php). */
function artPost(c, q, what) {
  settle(c, "another press came first");
  api("api/art.php?id=" + encodeURIComponent(c.g.id) + "&kind=" + c.kind + q, { method: "POST" }).then(function (r) {
    if (!r.ok) { sound("back"); showStrip(KIND_LABEL[c.kind] + ": " + (r.error || "that could not be done"), true); return; }
    sound("select");
    L("ART", c.g.title + ": " + c.kind + " " + what + " (Media tab compare)");
    c.how.changed(c.kind);
    if (c.closed) { return; }
    c.kept = null;
    readNow(c);
  });
}

function clearVideo(c) {
  var v = c.now.video;
  confirmWindow("Clear the video of " + c.g.title + "?", function (box) { videoClearLines(box, v); }, { label: "Clear video", run: function () {
    c.pane.querySelectorAll(".mc-now video").forEach(function (x) { x.pause(); x.removeAttribute("src"); x.load(); });
    stopVideo();
    api("api/video-own.php?id=" + encodeURIComponent(c.g.id) + "&clear=1", { method: "POST" }).then(function (r) {
      L("ART", c.g.title + ": clear video from the compare: " + (r.ok ? r.gone + " deleted" : r.error));
      sound(r.ok ? "ok" : "back");
      if (!r.ok) { showStrip(r.error || "the video could not be cleared", true); }
      c.kept = null;
      c.how.changed("video");
      readNow(c);
    });
  } });
}

/* ---- using one, and putting it back ---- */

function useItem(c, it, how) {
  if (c.working || c.closed) { return; }
  // The one in use, pressed again (a double press), changes nothing: Put back still brings back the one before it.
  if (it.ref === c.lastUsed && c.kept) { sound("back"); return; }
  var prep = c.view.prep[it.ref];
  // Used from what came down: a video or manual, or a picture still at its place, comes first and is used as it lands.
  var here = (prep && prep.state === "done") || (mcIsPic(c.kind) && (it.view || "").indexOf("api/mediachoice.php") === 0);
  if (!here) {
    // Asked again after a failure: a "failed" read before the new asking answers is the old one.
    c.pending = { ref: it.ref, how: how, asked: !prep || prep.state === "failed" };
    delete c.prepFail[it.ref];
    if (c.pending.asked) { prepare(c, it, true); }
    paintActs(c);
    relist(c);
    return;
  }
  c.working = true;
  c.pending = null;
  var doc = c.kind === "manual" && how !== "keep" && c.docs[c.docAt] ? c.docs[c.docAt].file : "";
  c.ask.use(it, how, doc, c.how.holder).then(function (r) {
    c.working = false;
    // Said even when the compare has closed since: the views behind catch up all the same.
    if (r.ok) { c.how.changed(c.kind); }
    if (c.closed) { return; }
    if (!r.ok) {
      sound("back");
      showStrip(KIND_LABEL[c.kind] + " from " + PLACE_NAME[mcPlace(it)] + " could not be used: " + (r.error || "the server did not answer"), true);
      paintActs(c);
      return;
    }
    sound("ok");
    L("ART", c.g.title + ": " + c.kind + " from " + PLACE_NAME[mcPlace(it)] + ", " + it.label + (how === "keep" ? ", kept beside the others" : "") + " used (Media tab compare)");
    c.kept = { ticket: it.ticket };
    c.lastUsed = it.ref;
    c.focusKey = "c:" + it.ref;          // the choice stays selected, not the Put back that took the Use button's place
    readNow(c, r.doc);
    c.strip.querySelectorAll(".mc-cand").forEach(function (b) { b.classList.toggle("now", b.dataset.key === "c:" + it.ref); });
  });
}

function putBack(c) {
  if (!c.kept || c.working) { return; }
  settle(c, "another press came first");
  c.working = true;
  c.ask.back(c.kept.ticket, c.kind, c.how.holder).then(function (r) {
    c.working = false;
    if (r.ok) { c.how.changed(c.kind); }
    if (c.closed) { return; }
    if (!r.ok) { sound("back"); showStrip("It could not be put back: " + (r.error || "the server did not answer"), true); paintActs(c); return; }
    sound("back");
    L("ART", c.g.title + ": " + c.kind + " put back as it was (Media tab compare)");
    c.kept = null;
    c.lastUsed = "";
    c.strip.querySelectorAll(".mc-cand.now").forEach(function (b) { b.classList.remove("now"); });
    readNow(c);
  });
}

/* Files let go on Now or on Yours: one file, of the right kind, while nothing else is being sent. */
function dropped(c, dt) {
  var files = dt && dt.files ? Array.prototype.slice.call(dt.files) : [];
  var entry = dt && dt.items && dt.items[0] && dt.items[0].webkitGetAsEntry ? dt.items[0].webkitGetAsEntry() : null;
  var why = entry && entry.isDirectory ? "a folder cannot be used here: let go of one file"
          : files.length > 1 ? "let go of one file at a time (" + files.length + " came)"
          : c.working ? "the one before is still being sent: let go of this one when it is done" : "";
  if (why) {
    sound("back");
    L("ART", c.g.title + ": a file let go on the " + c.kind + " compare was not used: " + why);
    showStrip(why.charAt(0).toUpperCase() + why.slice(1), true);
    return;
  }
  upload(c, files[0], c.yoursSay);
}

/* A file of your own: a picture, a video, or a manual kept beside the others. */
function upload(c, file, say) {
  if (!file || c.working) { return; }
  var bad = takesWhy(c.kind, file);
  if (bad) {
    sound("back");
    L("ART", c.g.title + ": a file of your own was not sent for the " + c.kind + ": " + bad);
    showStrip(bad, true);
    return;
  }
  settle(c, "a file of your own came first");
  c.working = true;
  var was = say ? say.textContent : "";
  var tell = function (t) { if (say) { say.textContent = t; } };
  var id = encodeURIComponent(c.g.id);
  var go = c.kind === "video" ? uploadPieces("api/video-own.php?id=" + id, file, tell)
         : c.kind === "manual" ? uploadPieces("api/mediachoice.php?id=" + encodeURIComponent(c.how.holder) + "&doc=Manual", file, tell)
         : uploadArt(c.g, c.kind, file, tell);
  go.then(function (r) {
    c.working = false;
    c.how.changed(c.kind);
    if (c.closed) { return; }
    tell(was);
    sound("select");
    L("ART", c.g.title + ": " + c.kind + " from a file of your own, " + file.name + " (Media tab compare)");
    c.kept = null;
    c.lastUsed = "";
    readNow(c, r && r.doc);
    checkPending(c);
  }, function (e) {
    c.working = false;
    tell(was);
    sound("back");
    L("ART", c.g.title + ": a file of your own for the " + c.kind + " was refused: " + ((e && e.message) || e));
    showStrip(file.name + " could not be used: " + ((e && e.message) || "the server did not answer"), true);
    checkPending(c);
  });
}

/* ---- the choices ---- */

function prepare(c, it, now) {
  clearTimeout(c.prepT);
  // Moving down the choices brings down only the one stopped on, not every one passed.
  c.prepT = setTimeout(function () {
    if (c.closed || (!now && (!c.picked || c.picked.ref !== it.ref))) { return; }
    c.ask.prepare(it).then(function (r) {
      if (c.closed) { return; }
      if (r.ok) { if (c.pending && c.pending.ref === it.ref) { c.pending.asked = false; } return; }
      // Said where it was asked for, in This one, and a Use waiting on it lets go.
      c.prepFail[it.ref] = r.error || "no answer";
      if (c.pending && c.pending.ref === it.ref) { c.pending = null; }
      showStrip(KIND_LABEL[c.kind] + " from " + PLACE_NAME[mcPlace(it)] + " would not come down: " + c.prepFail[it.ref], true);
      paintThis(c);
      paintActs(c);
      relist(c);
    });
  }, now ? 0 : 600);
}

function pick(c, it) {
  if (!it || c.closed) { return; }
  // Another choice pressed while one waited to be used: the person changed their mind, and that one is not used.
  if (c.pending && c.pending.ref !== it.ref) { settle(c, "another was chosen"); }
  c.picked = it;
  c.strip.querySelectorAll(".mc-cand").forEach(function (b) { b.classList.toggle("on", b.dataset.key === "c:" + it.ref); });
  if (!mcIsPic(c.kind) && !it.view && !c.view.prep[it.ref] && !c.prepFail[it.ref]) { prepare(c, it, false); }
  paintThis(c);
  paintActs(c);
}

function cand(c, it) {
  var kind = c.kind;
  var b = mcButton("mc-cand" + (c.picked && c.picked.ref === it.ref ? " on" : "") + (it.ref === c.lastUsed ? " now" : ""), "", function () {
    sound("select");
    pick(c, it);
    focusKey(c, "c:" + it.ref);
  }, "c:" + it.ref, kind === "manual" ? "use in its place" : "use this one");
  b._item = it;
  b.addEventListener("dblclick", function () { useItem(c, it, kind === "manual" ? "replace" : ""); });
  var size = el("span", "mc-dim");
  var place = mcPlace(it);
  var failed = function () {
    if (c.failLogged[place]) { return; }
    c.failLogged[place] = true;
    L("ART", c.g.title + ": a " + kind + " from " + PLACE_NAME[place] + " would not show (" + it.ref.slice(0, 120) + ")");
  };
  if (mcIsPic(kind)) {
    b.appendChild(picFrame("mc-small mc-k-" + kind, it.view, function (w, h, bad) {
      if (bad) { failed(); return; }
      size.textContent = w + " × " + h;
      c.sizes[it.ref] = w * h;
      biggest(c);
    }));
  } else if (kind === "video" && it.view) {
    b.appendChild(videoFrame("mc-small", it.view, false, function (s, w, h, bad) {
      if (bad) { failed(); return; }
      size.textContent = [mcClock(s), w + " × " + h].join("  ·  ");
    }));
  } else {
    var f = sayFrame("mc-small" + (kind === "manual" ? " mc-paper" : ""), kind === "manual" ? "PDF" : "comes down when chosen");
    f.prepend(iconEl("mc-small-ico", kind === "manual" ? "book" : "film"));
    b.appendChild(f);
    size.textContent = sizeWords(it.size);
  }
  b.appendChild(el("span", "mc-cap", it.label));
  if (it.sub && it.sub !== it.label) { b.appendChild(el("span", "mc-dim mc-sub", it.sub)); }
  b.appendChild(size);
  var marks = el("span", "mc-badges");
  marks.appendChild(el("span", "mc-badge mc-shown", "shown now"));
  marks.appendChild(el("span", "mc-badge mc-most", "biggest"));
  b.appendChild(marks);
  return b;
}

/* The choice with the most pixels, among those that have come, wears "biggest". */
function biggest(c) {
  var top = "", most = 0;
  Object.keys(c.sizes).forEach(function (ref) { if (c.sizes[ref] > most) { most = c.sizes[ref]; top = ref; } });
  c.strip.querySelectorAll(".mc-cand").forEach(function (b) { b.classList.toggle("biggest", b.dataset.key === "c:" + top); });
}

function groupEl(c, p, st) {
  var grp = el("div", "mc-group");
  grp.dataset.place = p.key;
  grp.appendChild(el("span", "mc-glab", p.name));
  var waiting = !st || st.state === "waiting" || st.state === "asking";
  if (waiting && !p.note) {
    var ghosts = el("div", "mc-thumbs");
    ghosts.appendChild(el("span", "mc-ghost"));
    ghosts.appendChild(el("span", "mc-ghost"));
    grp.appendChild(ghosts);
    var bar = el("span", "tp-prog wait mc-bar");
    bar.appendChild(el("i"));
    grp.appendChild(bar);
    grp.appendChild(el("span", "mc-dim", "asking " + p.name + "..."));
    return grp;
  }
  var items = st && st.state === "done" ? st.items.filter(function (it) { return it.kind === c.kind; }) : [];
  if (!items.length) {
    grp.appendChild(el("p", "mc-why" + (st && st.state === "failed" ? " bad" : ""), placeWords({ on: true, note: p.note }, st)));
    return grp;
  }
  var thumbs = el("div", "mc-thumbs");
  items.forEach(function (it) { thumbs.appendChild(cand(c, it)); });
  grp.appendChild(thumbs);
  return grp;
}

function yoursGroup(c) {
  var grp = el("div", "mc-group mc-yours");
  grp.appendChild(el("span", "mc-glab", "Yours"));
  var words = c.kind === "video" ? "Choose an MP4 or WebM" : c.kind === "manual" ? "Choose a PDF or a picture" : "Choose a file";
  var say = c.yoursSay = el("span", "mc-add-words", words);
  var tile = mcButton("mc-addfile", "", function () {
    if (c.working) { showStrip("The one before is still being sent: choose this one when it is done", true); return; }
    var box = el("input");
    box.type = "file";
    box.accept = c.kind === "video" ? "video/mp4,video/webm,.mp4,.m4v,.webm"
               : c.kind === "manual" ? "application/pdf,.pdf,image/png,image/jpeg,image/webp,image/gif" : "image/png,image/jpeg,image/webp,image/gif";
    box.addEventListener("change", function () { upload(c, box.files[0], say); });
    box.click();
  }, "file", words.toLowerCase());
  tile.appendChild(iconEl("mc-add-ico", "plus"));
  tile.appendChild(say);
  mcDropOn(c, tile);
  grp.appendChild(tile);
  return grp;
}

/* The strip, each place's group drawn again only when what it said has changed, so nothing flickers as the answers come. */
function paintStrip(c) {
  var keep = {};
  var note = c.strip.querySelector(".dtab-wait");
  if (note) { note.remove(); }
  var n = 0;
  // A group is moved only when it is out of place: one moved under the pointer loses the press on it.
  var place = function (node) {
    if (c.strip.children[n] !== node) { c.strip.insertBefore(node, c.strip.children[n] || null); }
    n++;
  };
  inOrder(c.fits, c.look, c.kind).forEach(function (p) {
    if (!placeIsOn(c.look, c.kind, p.key)) { return; }
    var st = c.view.places[p.key];
    var sig = (st ? st.state + "|" + st.why + "|" + st.items.map(function (it) { return it.ref + (it.view ? "+" : ""); }).join(",") : "-") + "|" + c.lastUsed;
    var had = c.groups[p.key];
    if (!had || had.sig !== sig) {
      var fresh = groupEl(c, p, st);
      if (had) { had.el.replaceWith(fresh); }
      c.groups[p.key] = had = { sig: sig, el: fresh };
    }
    keep[p.key] = true;
    place(had.el);
  });
  Object.keys(c.groups).forEach(function (k) { if (!keep[k]) { c.groups[k].el.remove(); delete c.groups[k]; } });
  place(c.yours);
  biggest(c);
  // The first choice to come is shown at once, where seeing it costs nothing (a picture, or a video that plays from its place).
  if (!c.picked) {
    var first = c.strip.querySelector(".mc-cand");
    if (first && (mcIsPic(c.kind) || (c.kind === "video" && first._item.view))) { pick(c, first._item); }
  }
}

/* Look in, and the presses under it: drawn again only when what it says has changed, so no press on it is lost. */
function lookIn(c) {
  var sig = JSON.stringify([c.fits, c.look, Object.keys(c.view.places).map(function (k) { return k + c.view.places[k].state + c.view.places[k].why; })]);
  if (sig === c.lookSig && c.lookBox.firstChild) { return; }
  c.lookSig = sig;
  drawLookIn(c.lookBox, c, function (key, on) {
    var st = c.view.places[key];
    if (on && (!st || st.state === "account")) { c.ask.start(key); }
    paintStrip(c);
    lookIn(c);
    relist(c);
  }, function () {
    paintStrip(c);
    lookIn(c);
    relist(c);
  });
  var foot = el("div", "mc-foot");
  foot.appendChild(el("p", "mc-dim", "Asked when this opened, every time. Nothing is kept."));
  foot.appendChild(mcButton("mc-small", "Look again", function () { sound("select"); again(c); }, "again"));
  foot.appendChild(mcButton("mc-small", "Another game...", function () { sound("select"); c.how.other(); }, "other"));
  if (mcIsPic(c.kind) && c.fits.some(function (p) { return p.key === "gamesdb"; })) {
    foot.appendChild(mcButton("mc-small", "Wrong game? Search...", function () { sound("select"); searchPicker(c, function () { relist(c); }); }, "search", "search the games database"));
  }
  c.lookBox.appendChild(foot);
}

function again(c) {
  // Not while a press is on its way: its answer belongs to the compare it was made in.
  if (c.working) { showStrip("Wait for the last press to finish, then Look again", true); return; }
  L("ART", c.g.title + ": compare " + c.kind + ", every place asked again");
  c.kept = null;
  c.picked = null;
  c.pending = null;
  c.groups = {};
  c.sizes = {};
  c.prepFail = {};
  c.view = { places: {}, prep: {}, done: false };
  c.lookSig = "";
  c.strip.textContent = "";
  c.strip.appendChild(el("p", "dtab-wait", "asking the places..."));
  c.ask.again().then(function (r) {
    if (c.closed) { return; }
    if (!r.ok) {
      c.view.done = true;
      c.strip.textContent = "";
      c.strip.appendChild(tabSays("The places could not be asked: " + (r.error || "the server did not answer") + ". Look again tries once more"));
      c.strip.appendChild(c.yours);
    } else {
      // A first asking that failed left Look in without the saved order: this answer brings it.
      c.fits = r.fits || c.fits;
      c.look = r.look || c.look;
      paintStrip(c);
    }
    lookIn(c);
    paintThis(c);
    paintActs(c);
    relist(c);
  });
}

/* ---- the answers coming in ---- */

function onView(c, v) {
  c.view = v;
  paintStrip(c);
  lookIn(c);
  if (c.picked) {
    // The item as the answer now has it (a picture that has come down since has its address).
    var fresh = c.strip.querySelector('.mc-cand[data-key="c:' + CSS.escape(c.picked.ref) + '"]');
    if (fresh && fresh._item) { c.picked = fresh._item; }
    if (thisSig(c) !== c.thisSig) { paintThis(c); }
  } else {
    paintThis(c);
  }
  checkPending(c);
  paintActs(c);
  relist(c);
}

/* A Use waiting on its file: used once it has come (and nothing else is being done), or let go if it would not come. */
function checkPending(c) {
  if (!c.pending || c.pending.asked || c.working || c.closed) { return; }
  var p = c.view.prep[c.pending.ref];
  if (p && p.state === "done" && c.picked && c.picked.ref === c.pending.ref) { useItem(c, c.picked, c.pending.how); }
  else if (p && p.state === "failed") {
    c.pending = null;
    showStrip(KIND_LABEL[c.kind] + " would not come down, so it was not used: " + (p.why || "no reason given"), true);
  }
}

/* A Use still waiting on its file, let go: another press came first, or the compare closed. */
function settle(c, why) {
  if (!c.pending) { return; }
  L("ART", c.g.title + ": waiting " + c.kind + " not used: " + why);
  c.pending = null;
}

/* ---- the keys and the pad ---- */

function relist(c) {
  if (c.closed || !c.pane.querySelector(".mc-body:not([hidden])")) { return; }
  var q = function (box, css) { return box ? Array.prototype.slice.call(box.querySelectorAll(css)) : []; };
  // Which document Now shows, and Turn both pages together, are reached by the pad too.
  c.cells = q(c.strip, ".mc-cand, .mc-addfile").concat(q(c.nowSide, "button, select"), q(c.thisSide, "button"),
            q(c.acts, "button:not([disabled]), input[type=checkbox]"), q(c.lookBox, "button:not(.hide)"), c.kindBtns, [c.backBtn]);
  // Until the person moves, the choice shown is selected (else the first, else All media): never a press that changes the game.
  var key = c.moved ? c.focusKey : c.picked ? "c:" + c.picked.ref : (c.strip.querySelector(".mc-cand") || c.backBtn).dataset.key;
  var at = -1;
  c.cells.forEach(function (x, i) { if (x.dataset.key === key) { at = i; } });
  focusAt(c, at >= 0 ? at : Math.min(c.at, c.cells.length - 1), false);
}

function focusKey(c, key) {
  c.moved = true;
  c.focusKey = key;
  relist(c);
}

function focusAt(c, i, moved) {
  var cells = c.cells;
  if (!cells.length) { return; }
  i = Math.max(0, Math.min(cells.length - 1, i));
  c.at = i;
  c.focusKey = cells[i].dataset.key || "";
  cells.forEach(function (x, n) { x.classList.toggle("sel", n === i); });
  if (moved) {
    c.moved = true;
    cells[i].scrollIntoView({ block: "nearest", inline: "nearest" });
    // The presses under the stage are drawn again for the choice shown: the list is taken again with them.
    if (cells[i]._item) { pick(c, cells[i]._item); relist(c); return; }
  }
  setTabRows(c.pane, { cells: cells, at: i, word: cells[i].dataset.word || "select",
                       move: function (d) { focusAt(c, c.at + d, true); },
                       choose: function () {
                         var x = c.cells[c.at];
                         if (!x) { return; }
                         if (x._item) { useItem(c, x._item, c.kind === "manual" ? "replace" : ""); }
                         else if (x.tagName === "SELECT") {
                           // A press goes on to the next document, as a pad cannot open the list.
                           x.selectedIndex = (x.selectedIndex + 1) % x.options.length;
                           x.dispatchEvent(new Event("change"));
                         } else { x.click(); }
                       } });
}
