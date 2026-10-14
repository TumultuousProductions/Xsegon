/*  The file check (includes\filecheck.php): what a game's file really is, by
    its checksum against the list of every known release for its console.
    A tab of a game's details, and Games > Check game files. */

import { setTabRows } from "./detailtabs.js";
import { closeEditor, setEditorOnClose, toolFrame } from "./editors.js";
import { iconEl } from "./icons.js";
import { jobBar } from "./jobbars.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { pageJobRuns } from "./settings-save.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { el, plural } from "./util.js";

var WRAPPED = {
  header: "The game itself is the known one. Its 16-byte header is not the standard one, and a patch may expect the standard header.",
  copier: "The game itself is the known one. A copier's header (512 bytes) stands in front of it, which a patch does not expect.",
  v64: "The game itself is the known one. The file keeps it in another byte order (v64); the standard is z64.",
  n64: "The game itself is the known one. The file keeps it in another byte order (n64); the standard is z64."
};
var GUESSED = { translation: "a translation", hack: "a hack", homebrew: "homebrew" };

function post(ids) {
  return postJson("api/filecheck.php", { ids: ids });
}


// A release sold in the USA: its own, or one made for everywhere.
function isUsa(c) { return (c.regions || []).some(function (r) { return r === "USA" || r === "World"; }); }

/* One line for an answer: where it is from and what it is. */
export function fileCheckLine(c) {
  if (!c) { return "not checked yet"; }
  if (c.kind === "known") {
    var from = [(c.regions || []).join(", "), c.revision].filter(Boolean).join(", ");
    return (from ? from + "  ·  " : "") + "a known release" + (c.fix ? ", wrapped differently" : "");
  }
  if (c.kind === "unknown") {
    return "not a known release" + (c.guess ? "  ·  " + GUESSED[c.guess] + ", by its name" : c.base ? "  ·  built on " + c.base : "");
  }
  if (c.kind === "patch") { return "a patch, not a game"; }
  return "could not be read";
}

function headerWords(h) {
  return [h.title, h.region, h.code ? "code " + h.code : ""].filter(Boolean).join("  ·  ");
}

/* Everything kept for one file, as the facts under the line. */
function facts(c, platform) {
  var box = el("div", "fc-facts");
  function note(text, cls) { box.appendChild(el("p", "fc-note" + (cls ? " " + cls : ""), text)); }
  if (c.stale) { note("The file has changed since it was checked.", "warn"); }
  if (c.kind === "unknown") {
    note("No release on the list for " + platform + " has this checksum. A translation, a hack and homebrew all read like that, and so does a damaged copy.");
  } else if (c.kind === "patch") {
    note("This archive holds a patch and no game. A patch changes a game you already have; on its own it cannot be played.");
  } else if (c.kind === "unread") {
    note("The file could not be read: " + (c.why || "no reason given") + ".", "warn");
  } else if (c.fix) {
    note(WRAPPED[c.fix] || "");
  }
  var dl = el("dl");
  function pair(k, v) {
    if (!v) { return; }
    dl.appendChild(el("dt", null, k));
    dl.appendChild(el("dd", null, String(v)));
  }
  if (c.kind === "known") {
    pair("official name", c.name);
    pair("region", (c.regions || []).join(", "));
    pair("revision", c.revision || "the original");
    pair("languages", (c.languages || []).join(", "));
    pair("also marked", (c.also || []).join("  ·  "));
  }
  if (c.kind === "unknown" && c.guess) { pair("by its name", GUESSED[c.guess]); }
  if (c.base) { pair("built on", c.base + "  (by the game code it carries)"); }
  if (c.header) { pair("its header says", headerWords(c.header)); }
  pair("file", c.file + (c.inner ? "  (inside: " + c.inner + ")" : ""));
  if (c.bytes) { pair("size", c.bytes.toLocaleString("en-US") + " bytes"); }
  pair("sha-1", c.sha1);
  pair("crc32", c.crc);
  pair("checked", new Date(c.at * 1000).toISOString().slice(0, 10));
  box.appendChild(dl);
  return box;
}

export function fileCheckTabLabel() { return "File check"; }

/* The File check tab of a game's details (js\detailtabs.js): the answer in
   one line, the row that reads the file, and everything kept for it under
   that. full.fileCheck is what api\game.php sends: { can, why, check }. */
export function fileCheckPane(pane, g, full) {
  var fc = (full && full.fileCheck) || { can: false };
  var inner = el("div", "ch-inner ch-tab fc-tab");
  pane.appendChild(inner);
  if (!fc.can) {
    var none = el("p", "cr-none");
    none.appendChild(iconEl("cr-ico", "info"));
    none.appendChild(document.createTextNode(" " + (fc.why || "This game's file cannot be checked.")));
    inner.appendChild(none);
    setTabRows(pane, null);
    return;
  }
  var reading = false;

  function paint(c) {
    inner.textContent = "";
    inner.appendChild(el("p", "group-help", "What this game's file really is: its checksum, looked up in the list of every known release for " +
      g.platform + ". That says its region and revision for certain, whatever the file is called. The file is read and never changed."));
    inner.appendChild(el("p", "fc-line" + (c && (c.kind !== "known" || c.stale) ? " odd" : ""), fileCheckLine(c)));

    var list = el("div", "ch-list fc-list");
    var go = el("div", "cr-row ch-act fc-go");
    go.appendChild(iconEl("cr-ico", c ? "refresh" : "check"));
    var name = el("span", "cr-name", c ? "Check again" : "Check this file");
    go.appendChild(name);
    go.appendChild(el("span", "cr-tag", c ? "reads the file again" : "a second or two"));
    function check() {
      if (reading) { return; }
      reading = true;
      name.textContent = "Checking...";
      L("FCHK", "check from details: " + g.title);
      post([g.id]).then(function (r) {
        reading = false;
        if (!inner.isConnected) { return; }            // another tab, or another game, by now
        var why = !r.ok ? (r.error || "no answer") : (r.failed || {})[g.id];
        if (why || !(r.done || {})[g.id]) {
          sound("back");
          showStrip("Not checked: " + (why || "no answer"), true);
          name.textContent = c ? "Check again" : "Check this file";
          return;
        }
        sound("ok");
        fc.check = r.done[g.id];                       // coming back to the tab shows it
        paint(fc.check);
      });
    }
    go.addEventListener("click", check);
    list.appendChild(go);
    inner.appendChild(list);
    if (c) { inner.appendChild(facts(c, g.platform)); }

    go.classList.add("sel");
    // Details is built before it is put on the screen, and a list is only taken from a pane that is on it.
    Promise.resolve().then(function () {
      if (!go.isConnected) { return; }
      setTabRows(pane, { cells: [go], at: 0, word: c ? "check again" : "check this file", move: function () { /* one row */ }, choose: check });
    });
  }
  paint(fc.check);
}

// ---------- Games > Check game files ----------

var KINDS = [
  ["unknown", "Not a known release"],
  ["patch", "A patch, not a game"],
  ["unread", "Could not be read"],
  ["other", "Known releases from other regions"],
  ["usa", "Known USA releases"],
  ["todo", "Not checked yet"]
];

function kindOf(it) {
  var c = it.check;
  if (!c || c.stale) { return "todo"; }
  if (c.kind !== "known") { return c.kind; }
  return isUsa(c) ? "usa" : "other";
}

function rowWords(it) {
  var c = it.check;
  if (!c || c.stale) { return c ? "changed since it was checked" : it.file; }
  if (c.kind === "known") { return c.name + (c.fix ? "  ·  wrapped differently" : ""); }
  if (c.kind === "unknown") {
    return [c.guess ? GUESSED[c.guess] + ", by its name" : "",
            c.base ? "built on " + c.base : c.header ? "its header says " + headerWords(c.header) : ""].filter(Boolean).join("  ·  ") || it.file;
  }
  return c.kind === "unread" ? (c.why || it.file) : it.file;
}

/*  A check at work is the page's own loop, a batch of files a request, and it
    goes on with the window closed: the window closes itself
    when a check starts and the bar in the corner takes it from there, with
    Stop. Opened again meanwhile, the window shows the same check. */
var run = null;                 // { total, done, failed, why } while files are being read
var repaint = null;             // the open window's own paint, for when a check ends

function corner(over) {
  var r = over || run;
  if (!r) { return; }
  jobBar({ key: "filecheck", name: "Check game files", state: over ? (over.failed && !over.done ? "failed" : "done") : "running",
           line: (r.done + r.failed) + " of " + plural(r.total, "file", "files"), frac: (r.done + r.failed) / Math.max(1, r.total), stop: !over },
         function () { if (run) { finish(); } });
}

function finish() {
  var was = run;
  run = null;
  pageJobRuns(false);
  L("FCHK", "checked " + was.done + " of " + was.total + (was.failed ? ", " + was.failed + " not: " + was.why : ""));
  sound(was.failed && !was.done ? "back" : "ok");
  showStrip(plural(was.done, "file", "files") + " checked" +
    (was.failed ? ", " + was.failed + " not: " + was.why : "") +
    (repaint ? "" : "  ·  Games > Check game files shows what each is"), !!was.failed);
  corner(was);
  if (repaint) { repaint(); }
}

function paintBar() {
  var fill = $editor.querySelector(".fc-run .mt-fill"), says = $editor.querySelector(".fc-run .fc-says");
  if (!run || !fill) { return; }
  fill.style.width = Math.round(100 * (run.done + run.failed) / Math.max(1, run.total)) + "%";
  says.textContent = "Checked " + (run.done + run.failed) + " of " + run.total + "...";
}

export function openFileCheck() {
  L("ED", "file check");
  stopVideo();
  var open = {};                // which consoles and kinds stand open, kept over a repaint

  function start(rows) {
    var ids = rows.filter(function (r) { return kindOf(r) === "todo"; }).map(function (r) { return r.id; });
    if (!ids.length) { ids = rows.map(function (r) { return r.id; }); }
    run = { total: ids.length, done: 0, failed: 0, why: "" };
    pageJobRuns(true);                // Settings closing after a change does not draw the page again under it
    L("FCHK", "checking " + ids.length + " file(s)");
    showStrip("checking " + plural(ids.length, "file", "files") + " in the background: the bar in the corner shows how far it is", false);
    closeEditor();                // nothing more to do here: Done would be an extra press
    corner();
    (function next(left) {
      if (!run) { return; }                                              // stopped
      if (!left.length) { finish(); return; }
      post(left.slice(0, 60)).then(function (r) {
        if (!run) { return; }
        if (!r.ok) { run.why = r.error || "no answer"; run.failed += left.length; finish(); return; }
        var did = Object.keys(r.done || {}).length, bad = Object.keys(r.failed || {});
        run.done += did;
        run.failed += bad.length;
        if (bad.length) { run.why = r.failed[bad[0]]; }
        paintBar();
        corner();
        next((r.left || []).concat(left.slice(60)));
      });
    })(ids);
  }

  function section(key, title, n, build) {
    var d = el("details", "fc-sec");
    d.open = !!open[key];
    var s = el("summary", null, title);
    s.appendChild(el("span", "fc-n", String(n)));
    d.appendChild(s);
    d.addEventListener("toggle", function () {
      open[key] = d.open;
      if (d.open && !d.dataset.built) { d.dataset.built = "1"; build(d); }
    });
    if (d.open) { d.dataset.built = "1"; build(d); }
    return d;
  }

  function paint() {
    return api("api/filecheck.php").then(function (res) {
      if ($editor.dataset.tool !== "filecheck") { return; }
      if (!res.ok) { showStrip("could not read the checks: " + (res.error || ""), true); return; }
      var rows = res.games || [];

      var inner = toolFrame("CHECK GAME FILES");
      inner.appendChild(el("p", "group-help",
        "What each game's file really is: its checksum, looked up in the list of every known release for its console. " +
        "A file's name proves nothing, and this does: its region and revision, or that it is a translation, a hack or a patch. " +
        "Cartridge consoles only for now. Files are read and never changed; the lists come from libretro and are kept for a month."));

      var todo = rows.filter(function (r) { return kindOf(r) === "todo"; }).length;
      inner.appendChild(el("p", "rp-verdict " + (rows.length && !todo ? "good" : "warn"),
        !rows.length ? "No games here are for a console this can check."
        : todo ? plural(rows.length - todo, "file", "files") + " checked, " + todo + " not yet."
        : "All " + plural(rows.length, "file", "files") + " checked."));

      if (run) {
        var box = el("div", "fc-run");
        var bar = el("div", "mt-bar");
        bar.appendChild(el("div", "mt-fill"));
        box.appendChild(bar);
        box.appendChild(el("p", "mt-note fc-says", ""));
        var stop = el("button", null, "Stop");
        stop.type = "button";
        stop.addEventListener("click", function () { if (run) { finish(); } });
        box.appendChild(stop);
        inner.appendChild(box);
      } else if (rows.length) {
        var acts = el("div", "bk-acts fc-acts");
        var go = el("button", todo ? "primary" : null, todo ? "Check " + plural(todo, "file", "files") : "Check them all again");
        go.type = "button";
        go.addEventListener("click", function () { start(rows); });
        acts.appendChild(go);
        inner.appendChild(acts);
      }

      // One closed line per console, most games first; inside, one closed line per kind.
      var by = {};
      rows.forEach(function (r) { (by[r.platform] = by[r.platform] || []).push(r); });
      Object.keys(by).sort(function (a, c) { return by[c].length - by[a].length || a.localeCompare(c); }).forEach(function (p) {
        var mine = by[p], n = {};
        mine.forEach(function (r) { var k = kindOf(r); n[k] = (n[k] || 0) + 1; });
        var says = [n.usa ? n.usa + " USA" : "", n.other ? plural(n.other, "other region", "other regions") : "",
                    n.unknown ? n.unknown + " not known" : "", n.patch ? plural(n.patch, "patch", "patches") : "",
                    n.unread ? n.unread + " unread" : "", n.todo ? n.todo + " not checked" : ""].filter(Boolean).join("  ·  ");
        inner.appendChild(section(p, p + "  ·  " + says, mine.length, function (d) {
          KINDS.forEach(function (k) {
            if (!n[k[0]]) { return; }
            d.appendChild(section(p + "|" + k[0], k[1], n[k[0]], function (dd) {
              var list = el("div", "fc-rows");
              mine.filter(function (r) { return kindOf(r) === k[0]; }).forEach(function (r) {
                var line = el("div", "fc-row");
                line.appendChild(el("span", "fc-t", r.title));
                line.appendChild(el("span", "fc-w", rowWords(r)));
                list.appendChild(line);
              });
              dd.appendChild(list);
            }));
          });
        }));
      });

      $editor.appendChild(inner);
      $editor.hidden = false;
      paintBar();
    });
  }

  $editor.dataset.tool = "filecheck";
  repaint = paint;
  setEditorOnClose(function () { repaint = null; delete $editor.dataset.tool; });     // a check at work goes on: its bar is in the corner
  paint().then(function () { sound("select"); });
}
