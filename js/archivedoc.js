import { closeEditor, setEditorOnClose, toolFrame } from "./editors.js";
import { iconEl } from "./icons.js";
import { jobsWatch } from "./jobbars.js";
import { setPick, showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { el } from "./util.js";

/* ---------- manuals for the games with none, from the online archives (includes\archivedoc.php) ----------
   Get Media > Manuals from online archives. The window opens on what Xsegon
   already knows; the Archive is asked only after Start, as a bar in the corner. A
   manual becomes the game's Manual.pdf, read in its Documents. */

var md = null;        // the window while it is up: what the server said, the consoles left out, its lines, whether the looked-for list is shown

function mdMine() {
  return !!md && !$editor.hidden && $editor.dataset.tool === "archivedoc";
}

export function openArchiveManuals() {
  L("ED", "manuals from online archives");
  stopVideo();
  api("api/archivedoc.php").then(function (res) {
    if (!res.ok) { showStrip(res.error || "could not count the games with no manual", true); return; }
    md = { res: res, out: {}, lines: [], runs: [], at: -1 };
    mdPaint();
  });
}

function nGames(n) { return n + (n === 1 ? " game" : " games"); }

// A box with a heading, as a page of Settings has them.
function mdBox(inner, name) {
  var box = el("div", "pj-sect");
  box.appendChild(el("div", "pj-head", name));
  inner.appendChild(box);
  return box;
}

// One line: an icon, what it is and what is chosen for it, and a small button at the right.
function mdLine(box, icon, label, hint, caption, run) {
  var i = md.lines.length, r = el("div", "pj-row"), words = el("div", "pj-words"), set = el("button", "pj-set", caption);
  r.appendChild(iconEl("opt-ico", icon));
  words.appendChild(el("span", "pj-job", label));
  words.appendChild(el("span", "pj-hint", hint));
  r.appendChild(words);
  set.type = "button";
  set.addEventListener("click", function () { mdBar(i); run(); });
  r.appendChild(set);
  r.addEventListener("mousemove", function () { if (md && md.at !== i) { mdBar(i); } });
  box.appendChild(r);
  md.lines.push(r);
  md.runs.push(run);
}

function mdBar(i) {
  if (!md || !md.lines.length) { return; }
  md.at = Math.max(0, Math.min(md.lines.length - 1, i));
  md.lines.forEach(function (r, k) { r.classList.toggle("at", k === md.at); });
  md.lines[md.at].scrollIntoView({ block: "nearest" });
}

// The consoles the online archives have manuals for and that are still selected.
function mdChosen() {
  return md.res.consoles.filter(function (c) { return c.sets && !md.out[c.platform]; });
}

function mdStart() {
  var chosen = mdChosen();
  if (!chosen.length) { showStrip("no console is selected: press Not selected on a console's line to select it", true); return; }
  postJson("api/archivedoc.php", { fetch: chosen.map(function (c) { return c.platform; }) }).then(function (r) {
    if (!r.ok) { showStrip(r.error || "it could not be started", true); return; }
    L("MANU", "fetch asked for " + chosen.length + " consoles");
    sound("ok");
    showStrip("fetching manuals from the online archives in the background: the bar in the corner shows how far it is", false);
    closeEditor();
    jobsWatch("archivedoc");
  });
}

// A list of games with no manual, each with why.
function mdNoneList(box, rows) {
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

// How the last fetch ended, and the games that got no manual. Those kept as looked for have their own box, not this one.
function mdLast(inner, job) {
  var box = mdBox(inner, "The last fetch");
  box.appendChild(el("p", "em-said" + (job.error ? " bad" : ""), job.error || job.said || ""));
  var kept = {};
  (md.res.looked || []).forEach(function (g) { kept[g.platform + "|" + g.title] = true; });
  var none = (job.none || []).filter(function (g) { return !kept[g.platform + "|" + g.title]; });
  if (none.length) { mdNoneList(box, none); }
}

/* The games looked for before with nothing found: Start leaves them out,
   their list is folded away, and one press asks for them again. */
function mdLooked(inner) {
  var looked = md.res.looked || [], n = looked.length, them = n === 1 ? "it" : "them";
  if (!n) { return; }
  var box = mdBox(inner, "Looked for, no manual found (" + n + ")");
  var last = Math.max.apply(null, looked.map(function (g) { return g.at || 0; }));
  mdLine(box, "refresh", "Look again for " + (n === 1 ? "this game" : "these " + n),
    "The online archives were asked and had no manual Xsegon is sure of for " + them + ", so Start leaves " + them + " out. This puts " + them + " back for the next Start.",
    "Look again", mdLookAgain);
  mdLine(box, "lines", "The games", (md.showLooked ? "" : "Folded away. ") + nGames(n) + ", last looked for on " +
    new Date(last * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ".",
    md.showLooked ? "Hide" : "Show", function () { md.showLooked = !md.showLooked; sound("select"); mdPaint(); });
  if (md.showLooked) { mdNoneList(box, looked); }
}

function mdLookAgain() {
  postJson("api/archivedoc.php", { lookAgain: true }).then(function (r) {
    if (!r.ok) { showStrip(r.error || "it could not be done", true); return; }
    L("MANU", "Look again: " + r.again + " games are asked for at the next Start");
    sound("select");
    api("api/archivedoc.php").then(function (res) {
      if (!res.ok || !mdMine()) { return; }
      md.res = res;
      mdPaint();
      showStrip((r.again === 1 ? "that game is" : "those " + r.again + " games are") + " back on the list: Start asks the online archives for " +
        (r.again === 1 ? "it" : "them") + " again", false);
    });
  });
}

function mdPaint() {
  var res = md.res, job = res.job, atWork = !!job && job.state === "running";
  var have = res.consoles.filter(function (c) { return c.sets; }), lack = res.consoles.filter(function (c) { return !c.sets; });
  setEditorOnClose(function () { md = null; });
  $editor.textContent = "";
  $editor.dataset.tool = "archivedoc";
  var inner = toolFrame("MANUALS FROM ONLINE ARCHIVES", { cls: "vp-inner", close: "Close (esc)", keep: true });
  inner.appendChild(el("p", "group-help", atWork
    ? "Manuals are being fetched from the online archives. The bar in the corner shows how far it is, and has its Stop."
    : !res.need ? ((res.looked || []).length
      ? "Every game here with no manual has been looked for already, and the online archives had none. They are folded away below: Look again asks for them once more."
      : "Every game here has a manual: there is nothing to fetch.")
    : !res.curl ? "This needs Windows' own curl.exe, which comes with Windows 10 from 2018 on and is not on this PC."
    : "For the games here that have no manual. The Internet Archive (archive.org) holds sets of game manuals, a console each, "
      + "mostly the North American releases, free and with no account. Xsegon takes the manual that is surely a game's by its name, "
      + "in English or of the game's own region, and it opens in the game's Documents. A game that has a manual keeps it. It needs the internet."));
  $editor.appendChild(inner);
  $editor.hidden = false;
  md.lines = [];
  md.runs = [];
  if (!atWork && res.need && res.curl) {
    if (have.length) {
      var what = mdBox(inner, "Consoles with games that have no manual");
      // They start selected: the button says how a console stands, and a press changes it.
      var on = mdChosen().length;
      what.appendChild(el("p", "pj-note", on === have.length ? (on === 1 ? "It is selected." : "All " + on + " are selected.") + " Press a console's button to leave it out, and again to take it back."
        : on ? on + " of " + have.length + " are selected. Press a console's button to change it."
        : "None is selected. Press a console's button to select it."));
      have.forEach(function (c) {
        var off = !!md.out[c.platform];
        mdLine(what, "book", c.platform, nGames(c.need) + " with no manual  ·  the Archive has " + c.manuals + (c.manuals === 1 ? " manual" : " manuals") + " in sets",
          off ? "Not selected" : "✓ Selected", function () {
            md.out[c.platform] = !md.out[c.platform];
            sound("select");
            mdPaint();
          });
      });
      var chosen = mdChosen(), n = chosen.reduce(function (sum, c) { return sum + c.need; }, 0);
      var go = mdBox(inner, "Fetch");
      mdLine(go, "play", "Fetch the manuals",
        (chosen.length ? nGames(n) + " on " + chosen.length + (chosen.length === 1 ? " console" : " consoles") + ". " : "No console is selected. ")
          + "Only a manual that is surely the game's is taken; the rest are listed here afterwards. It runs in the background.", "Start", mdStart);
    }
    if (lack.length) {
      inner.appendChild(el("p", "mt-note", (have.length ? "The online archives have no manuals for: " : "The online archives have no manuals for any console with games that lack one: ")
        + lack.map(function (c) { return c.platform + " (" + c.need + ")"; }).join(", ") + "."));
    }
  }
  if (!atWork && job) { mdLast(inner, job); }
  if (!atWork) { mdLooked(inner); }
  // Nothing is lit until the person moves: the keys start from above the first line.
  var at = md.at;
  md.at = -1;
  setPick({ cells: md.lines, at: 0,
    move: function (d) { if (md) { mdBar(md.at + d); sound("move"); } },
    choose: function () { if (md && md.runs[md.at]) { md.runs[md.at](); } } });
  if (at >= 0 && mdMine()) { mdBar(at); }
}
