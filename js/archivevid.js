import { closeEditor, setEditorOnClose, toolFrame } from "./editors.js";
import { iconEl } from "./icons.js";
import { jobsWatch } from "./jobbars.js";
import { setPick, showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { el } from "./util.js";

/* ---------- videos for the games with none, from the online archives (includes\archivevid.php) ----------
   Get Media > Videos from online archives. The window opens on what Xsegon
   already knows; the Archive is asked only after Start, as a bar in the corner. Where a
   set leaves a gap, the first 30 seconds of a World of Longplays recording are cut on
   the way (bin\ffmpeg.exe), never the whole file. */

var av = null;        // the window while it is up: what the server said, the consoles left out, its lines, whether the looked-for list is shown

function avMine() {
  return !!av && !$editor.hidden && $editor.dataset.tool === "archivevid";
}

export function openArchiveVideos() {
  L("ED", "videos from online archives");
  stopVideo();
  api("api/archivevid.php").then(function (res) {
    if (!res.ok) { showStrip(res.error || "could not count the games with no video", true); return; }
    av = { res: res, out: {}, lines: [], runs: [], at: -1 };
    avPaint();
  });
}

function nGames(n) { return n + (n === 1 ? " game" : " games"); }

// A box with a heading, as a page of Settings has them.
function avBox(inner, name) {
  var box = el("div", "pj-sect");
  box.appendChild(el("div", "pj-head", name));
  inner.appendChild(box);
  return box;
}

// One line: an icon, what it is and what is chosen for it, and a small button at the right.
function avLine(box, icon, label, hint, caption, run) {
  var i = av.lines.length, r = el("div", "pj-row"), words = el("div", "pj-words"), set = el("button", "pj-set", caption);
  r.appendChild(iconEl("opt-ico", icon));
  words.appendChild(el("span", "pj-job", label));
  words.appendChild(el("span", "pj-hint", hint));
  r.appendChild(words);
  set.type = "button";
  set.addEventListener("click", function () { avBar(i); run(); });
  r.appendChild(set);
  r.addEventListener("mousemove", function () { if (av && av.at !== i) { avBar(i); } });
  box.appendChild(r);
  av.lines.push(r);
  av.runs.push(run);
}

function avBar(i) {
  if (!av || !av.lines.length) { return; }
  av.at = Math.max(0, Math.min(av.lines.length - 1, i));
  av.lines.forEach(function (r, k) { r.classList.toggle("at", k === av.at); });
  av.lines[av.at].scrollIntoView({ block: "nearest" });
}

// Whether a console can be served: a set, or playthroughs with the cutter here to cut them.
function avServed(c) {
  return !!(c.sets || (c.wol && av.res.ffmpeg));
}

// The consoles the online archives have videos for and that are still selected.
function avChosen() {
  return av.res.consoles.filter(function (c) { return avServed(c) && !av.out[c.platform]; });
}

function avStart() {
  var chosen = avChosen();
  if (!chosen.length) { showStrip("no console is selected: press Not selected on a console's line to select it", true); return; }
  postJson("api/archivevid.php", { fetch: chosen.map(function (c) { return c.platform; }) }).then(function (r) {
    if (!r.ok) { showStrip(r.error || "it could not be started", true); return; }
    L("ARCV", "fetch asked for " + chosen.length + " consoles");
    sound("ok");
    showStrip("fetching videos from the online archives in the background: the bar in the corner shows how far it is", false);
    closeEditor();
    jobsWatch("archivevid");
  });
}

// A list of games with no video, each with why.
function avNoneList(box, rows) {
  var list = el("div", "cr-list");
  rows.slice(0, 400).forEach(function (g) {
    var r = el("div", "cr-row ro");
    r.appendChild(iconEl("cr-ico", "x"));
    var words = el("div", "sv-words");
    words.appendChild(el("span", "cr-name", g.title));
    words.appendChild(el("span", "sv-sub", g.platform + ": " + g.why));
    r.appendChild(words);
    list.appendChild(r);
  });
  box.appendChild(list);
  if (rows.length > 400) { box.appendChild(el("p", "mt-note", "And " + (rows.length - 400) + " more.")); }
}

// How the last fetch ended, and the games that got no video. Those kept as looked for have their own box, not this one.
function avLast(inner, job) {
  var box = avBox(inner, "The last fetch");
  box.appendChild(el("p", "em-said" + (job.error ? " bad" : ""), job.error || job.said || ""));
  var kept = {};
  (av.res.looked || []).forEach(function (g) { kept[g.platform + "|" + g.title] = true; });
  var none = (job.none || []).filter(function (g) { return !kept[g.platform + "|" + g.title]; });
  if (none.length) { avNoneList(box, none); }
}

/* The games looked for before with nothing found: Start leaves them out,
   their list is folded away, and one press asks for them again. */
function avLooked(inner) {
  var looked = av.res.looked || [], n = looked.length, them = n === 1 ? "it" : "them";
  if (!n) { return; }
  var box = avBox(inner, "Looked for, no video found (" + n + ")");
  var last = Math.max.apply(null, looked.map(function (g) { return g.at || 0; }));
  avLine(box, "refresh", "Look again for " + (n === 1 ? "this game" : "these " + n),
    "The online archives were asked and had no video of " + them + ", so Start leaves " + them + " out. This puts " + them + " back for the next Start.",
    "Look again", avLookAgain);
  avLine(box, "lines", "The games", (av.showLooked ? "" : "Folded away. ") + nGames(n) + ", last looked for on " +
    new Date(last * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ".",
    av.showLooked ? "Hide" : "Show", function () { av.showLooked = !av.showLooked; sound("select"); avPaint(); });
  if (av.showLooked) { avNoneList(box, looked); }
}

function avLookAgain() {
  postJson("api/archivevid.php", { lookAgain: true }).then(function (r) {
    if (!r.ok) { showStrip(r.error || "it could not be done", true); return; }
    L("ARCV", "Look again: " + r.again + " games are asked for at the next Start");
    sound("select");
    api("api/archivevid.php").then(function (res) {
      if (!res.ok || !avMine()) { return; }
      av.res = res;
      avPaint();
      showStrip((r.again === 1 ? "that game is" : "those " + r.again + " games are") + " back on the list: Start asks the online archives for " +
        (r.again === 1 ? "it" : "them") + " again", false);
    });
  });
}

function avPaint() {
  var res = av.res, job = res.job, atWork = !!job && job.state === "running";
  var have = res.consoles.filter(avServed), lack = res.consoles.filter(function (c) { return !avServed(c); });
  setEditorOnClose(function () { av = null; });
  $editor.textContent = "";
  $editor.dataset.tool = "archivevid";
  var inner = toolFrame("VIDEOS FROM ONLINE ARCHIVES", { cls: "vp-inner", close: "Close (esc)", keep: true });
  inner.appendChild(el("p", "group-help", atWork
    ? "Videos are being fetched from the online archives. The bar in the corner shows how far it is, and has its Stop."
    : !res.need ? ((res.looked || []).length
      ? "Every game here with no video has been looked for already, and the online archives had none. They are folded away below: Look again asks for them once more."
      : "Every game here has a video: there is nothing to fetch.")
    : !res.curl ? "This needs Windows' own curl.exe, which comes with Windows 10 from 2018 on and is not on this PC."
    : "For the games here that have no video. The Internet Archive (archive.org) holds sets of game videos, a console each, "
      + "and World of Longplays' recordings of whole games, free and with no account. "
      + "Xsegon takes the video that is surely a game's from a set, and where a set leaves a gap it keeps the first 30 seconds of the game's playthrough, never the whole recording. "
      + "Arcade games are asked of the Arcade Database (adb.arcadeitalia.net, by motoschifo) first, whose makers play and record a short video of each. "
      + "A game that has a video keeps it. It needs the internet."));
  $editor.appendChild(inner);
  $editor.hidden = false;
  av.lines = [];
  av.runs = [];
  if (!atWork && res.need && res.curl) {
    if (have.length) {
      var what = avBox(inner, "Consoles with games that have no video");
      // They start selected: the button says how a console stands, and a press changes it.
      var on = avChosen().length;
      what.appendChild(el("p", "pj-note", on === have.length ? (on === 1 ? "It is selected." : "All " + on + " are selected.") + " Press a console's button to leave it out, and again to take it back."
        : on ? on + " of " + have.length + " are selected. Press a console's button to change it."
        : "None is selected. Press a console's button to select it."));
      have.forEach(function (c) {
        var off = !!av.out[c.platform];
        var from = c.sets
          ? "the Archive has " + c.videos + (c.videos === 1 ? " video" : " videos") + " in sets" + (c.wol && res.ffmpeg ? ", and playthrough cuts fill the gaps" : "")
          : "the first 30 seconds of a World of Longplays playthrough, cut on the way";
        avLine(what, "film", c.platform, nGames(c.need) + " with no video  ·  " + from,
          off ? "Not selected" : "✓ Selected", function () {
            av.out[c.platform] = !av.out[c.platform];
            sound("select");
            avPaint();
          });
      });
      var chosen = avChosen(), n = chosen.reduce(function (sum, c) { return sum + c.need; }, 0);
      var go = avBox(inner, "Fetch");
      avLine(go, "play", "Fetch the videos",
        (chosen.length ? nGames(n) + " on " + chosen.length + (chosen.length === 1 ? " console" : " consoles") + ". " : "No console is selected. ")
          + "Only a video that is surely the game's is taken; the rest are listed here afterwards. It runs in the background.", "Start", avStart);
    }
    if (lack.length) {
      var could = lack.filter(function (c) { return c.wol && !res.ffmpeg; });
      inner.appendChild(el("p", "mt-note", (have.length ? "The online archives have nothing for: " : "The online archives have nothing for any console with games that lack a video: ")
        + lack.map(function (c) { return c.platform + " (" + c.need + ")"; }).join(", ") + "."
        + (could.length ? " World of Longplays playthroughs could serve " + could.map(function (c) { return c.platform; }).join(", ")
          + ", but the video cutter (bin\\ffmpeg.exe) is not on this PC." : "")));
    }
  }
  if (!atWork && job) { avLast(inner, job); }
  if (!atWork) { avLooked(inner); }
  // Nothing is lit until the person moves: the keys start from above the first line.
  var at = av.at;
  av.at = -1;
  setPick({ cells: av.lines, at: 0,
    move: function (d) { if (av) { avBar(av.at + d); sound("move"); } },
    choose: function () { if (av && av.runs[av.at]) { av.runs[av.at](); } } });
  if (at >= 0 && avMine()) { avBar(at); }
}
