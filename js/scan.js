/*  Games > Scan for Games.
 *
 *  The review IS the feature: nothing joins the library that was not selected
 *  on this screen, and nothing found is dropped without a line saying why
 *  (archives that cannot play, disc sets with holes, folders not recognised).
 */

import { closeEditor, reloadKeeping, setEditorOnClose, toolFrame } from "./editors.js";
import { fillWatch } from "./fillbar.js";
import { clearStrip, followSetupJob, showStrip } from "./launch.js";
import { L, api, logWarn, postJson } from "./log.js";
import { passedTail } from "./scanpassed.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor, games, sel } from "./state.js";
import { unfinishedTail } from "./unfinished.js";
import { unpackAll, unpackTail } from "./unpack.js";
import { el, plural } from "./util.js";
import { waitBar } from "./waitbar.js";

/* The Windows "choose a folder" window (api\pick-folder.php, a real dialog in its
   own process). Resolves with the path, or null when cancelled or lost; the strip
   carries the reason by then, so a caller only handles the happy path. */
var picking = false;            // a folder or file window is open and not yet answered

export function pickWindowsFolder(title, opts) {
  // opts.kind "file" opens the Windows open-a-file window instead, and
  // opts.start is where it opens: what was chosen before. opts.types
  // "sounds" makes that window show sound files, where it shows programs.
  var what = opts && opts.kind === "file" ? "file" : "folder";
  // One at a time: the windows share one answer, so a second would hand its answer to both askers.
  if (picking) {
    L("ED", "a second " + what + " window was asked for while one is open: refused");
    showStrip("a window to choose in is already open (it may be behind Xsegon): choose there or close it first", true);
    return Promise.resolve(null);
  }
  picking = true;
  return postJson("api/pick-folder.php", { title: title, kind: what, start: (opts && opts.start) || "", types: (opts && opts.types) || "" }).then(function (r) {
    if (!r.ok) { picking = false; showStrip("the " + what + " window did not open: " + (r.error || ""), true); return null; }
    var asking = "choose the " + what + " in the window that opened";
    showStrip(asking, false);
    return new Promise(function (done) {
      function resolve(p) { picking = false; done(p); }
      (function wait(tries) {
        api("api/pick-folder.php").then(function (p) {
          // A failed read has no state at all: a miss, not an answer, so the wait goes on.
          if ((p.state === "waiting" || !p.state) && tries < 1200) { setTimeout(function () { wait(tries + 1); }, 500); return; }
          if (p.state !== "done" || !p.path) {
            if (p.state === "failed") { showStrip("the folder window failed: " + (p.error || ""), true); }
            else if (!p.state) { logWarn("the folder wait gave up: pick-folder.php stopped answering"); showStrip("lost sight of the folder window; if you picked one, press the button again", true); }
            else { clearStrip(asking); }          // closed with nothing chosen: its line goes with it
            resolve(null);
            return;
          }
          clearStrip(asking);                     // chosen: the caller says what comes next
          resolve(p.path);
        });
      })(0);
    });
  });
}

/*  A path is never typed: a window that only shows what is there cannot get a
    drive wrong. The box stays read-only to show what is set (and is what a Save
    reads); Browse opens the Windows window, Clear (where blank means something) empties it.
    opts: kind "file" or "folder", title, clear (offer Clear), then(path). */
export function browseOnly(input, opts) {
  opts = opts || {};
  var wrap = el("span", "path-pick");
  input.readOnly = true;
  input.title = "Press Browse to change this";
  wrap.appendChild(input);
  function put(v) {
    input.value = v;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (opts.then) { opts.then(v); }
  }
  var browse = el("button", "path-browse", "Browse...");
  browse.type = "button";
  browse.addEventListener("click", function () {
    browse.disabled = true;
    pickWindowsFolder(opts.title || (opts.kind === "file" ? "Choose the file" : "Choose the folder"),
                      { kind: opts.kind, start: input.value }).then(function (p) {
      browse.disabled = false;
      if (!p) { return; }
      L("ED", "browsed to " + p);
      showStrip("chosen: " + p, false);
      put(p);
    });
  });
  wrap.appendChild(browse);
  if (opts.clear) {
    var clear = el("button", "path-clear", "Clear");
    clear.type = "button";
    clear.title = "Empty this, which puts it back to what blank means";
    clear.addEventListener("click", function () { if (input.value !== "") { put(""); } });
    wrap.appendChild(clear);
  }
  return wrap;
}

export function openScanTool(onBack) {
  L("ED", "scan tool");
  stopVideo();
  var added = false;

  // Back only when something sent us here (the + chooser): from the Games
  // menu a Back to nowhere is worse than no Back at all.
  function shell(title) {
    return toolFrame(title, { before: onBack ? [{ label: "\u2039 Back", run: function () { onBack(); } }] : [] });
  }

  /* The places Xsegon looks: a list, since games do not all live on one disk.
     The ROM drive is always first and belongs to Settings > Paths. */
  function folderList(after) {
    var box = el("div", "sc-folders");
    box.appendChild(el("h2", "bk-head", "Folders Xsegon looks in"));
    var rows = el("div", "sc-rows");
    box.appendChild(rows);
    var msg = el("p", "mt-note");
    box.appendChild(msg);

    function paintRows() {
      api("api/scan.php?folders=1").then(function (r) {
        rows.textContent = "";
        if (!r.ok) {
          // An empty list here would read as "no folders set" and invite re-adding ones that exist.
          msg.textContent = "The folders could not be read: " + (r.error || "the server did not answer") + ".";
          return;
        }
        r.folders.forEach(function (f) {
          var rowEl = el("div", "sc-row sc-folder" + (f.there ? "" : " bad"));
          rowEl.appendChild(el("span", "sc-title", f.path));
          rowEl.appendChild(el("span", "sc-rom", f.there ? "" : "not there right now"));
          // Added by itself and named like a console, the folder is walked as that console: the row says so.
          if (f.console) { rowEl.appendChild(el("span", "sc-tag", "read as the " + f.console + " folder")); }
          /* One empty folder per console with an emulator, made inside this games
             folder (api\scan.php, makeFolders), for games that cannot say their
             console themselves. Not offered on a console's own folder. */
          if (f.there && !f.console) {
            var mk = el("button", "sc-mk", "Make console folders");
            mk.type = "button";
            mk.title = "Makes an empty folder for each console (" + Object.keys(r.names || {}).slice(0, 6).join(", ") + "...) inside this one. Nothing is moved.";
            mk.addEventListener("click", function () {
              mk.disabled = true;
              postJson("api/scan.php", { action: "makeFolders", path: f.path })
                .then(function (res) {
                  mk.disabled = false;
                  if (!res.ok) { msg.textContent = res.error || "could not make the folders"; return; }
                  sound("select");
                  msg.textContent = res.made.length
                    ? res.made.length + " console folders made in " + res.in + (res.had.length ? " (" + res.had.length + " were already there)" : "") + ": " + res.made.join(", ") + "."
                    : "Every console already has its folder in " + res.in + ".";
                });
            });
            rowEl.appendChild(mk);
          }
          if (f.fixed) {
            rowEl.appendChild(el("span", "sc-tag", "the ROM drive, from Settings > Paths"));
          } else {
            var rm = el("button", "sc-rm", "Remove");
            rm.type = "button";
            rm.addEventListener("click", function () {
              postJson("api/scan.php", { action: "removeFolder", path: f.path })
                .then(function (res) {
                  if (!res.ok) { msg.textContent = res.error || "could not remove it"; return; }
                  sound("back");
                  after();
                });
            });
            rowEl.appendChild(rm);
          }
          rows.appendChild(rowEl);
        });
      });
    }
    paintRows();

    /* The Windows folder window and no box to type in: a typed example path
       lands on the wrong drive. The window reaches a share through its address bar. */
    var addRow = el("div", "sc-addfolder");
    var browse = el("button", null, "Add a folder...");
    browse.type = "button";
    browse.addEventListener("click", function () {
      browse.disabled = true;
      pickWindowsFolder("Choose a folder to look for games in").then(function (p) {
        if (!p) { browse.disabled = false; return; }
        postJson("api/scan.php", { action: "addFolder", path: p })
          .then(function (res) {
            browse.disabled = false;
            if (!res.ok) { msg.textContent = res.error || "could not add it"; return; }
            msg.textContent = "";
            sound("select");
            after();
          });
      });
    });
    addRow.appendChild(browse);
    box.appendChild(addRow);
    box.appendChild(el("p", "mt-note",
      "Opens the Windows folder window. Choose the folder that holds your games: every folder under it is " +
      "looked through. One console's folder by itself works too (gb, snes, psx, or the console's full name)."));
    return box;
  }

  function paint() {
    var waiting = shell("SCAN FOR GAMES");
    var walking = el("p", "group-help", "Walking the ROM folders...");
    waiting.appendChild(walking);
    $editor.appendChild(waiting);
    $editor.hidden = false;

    return waitBar(walking, "Looking through your games folders", api("api/scan.php")).then(function (res) {
      if ($editor.dataset.tool !== "scan") { return; }
      if (!res.ok) {
        // Leave the answer on the panel, not only in a strip that fades:
        // "the drive is not there" has to still be readable a minute later.
        var failed = shell("SCAN FOR GAMES");
        failed.appendChild(el("p", "mt-note bad", "Could not scan: " + (res.error || "the server did not answer")));
        // The folder list still goes up: a scan that failed because a folder
        // is wrong is exactly when you need to reach the folders.
        failed.appendChild(folderList(paint));
        $editor.textContent = "";
        $editor.appendChild(failed);
        showStrip("could not scan: " + (res.error || ""), true);
        return;
      }

      var inner = shell("SCAN FOR GAMES");
      inner.appendChild(el("p", "group-help",
        "What is on the disk that the library does not know. Titles are read from the file names; " +
        "Pictures & Videos > Get Pictures asks the Games Database for the rest. Nothing joins the library unless it is " +
        "selected here, and nothing found is hidden: what was skipped says why, further down."));
      var walked = (res.folders || []).filter(function (f) { return f.ok; }).length;
      inner.appendChild(el("p", "group-help",
        "Looked in " + walked + (walked === 1 ? " folder" : " folders") +
        "  ·  already answered for: " + res.alreadyHave +
        "  ·  accepted before: " + res.accepted));
      // A folder that could not be read is named here rather than silently
      // contributing nothing: with three folders on three disks, one being
      // unplugged must not look like "you have everything".
      (res.folders || []).forEach(function (f) {
        if (!f.ok) { inner.appendChild(el("p", "mt-note bad", f.path + " was not read: " + f.why)); }
      });

      var boxes = [];
      if (!res.new.length) {
        // "Nothing new" only when a game was actually seen: with nothing seen it
        // reads as "you have everything". Otherwise the line says what happened.
        // Folders with nothing in them are not listed, so they are no reason to point below.
        var skippedAny = (res.archives || []).length || (res.unfinished || []).length || (res.orphans || []).length
                       || (res.gaps || []).length || (res.skippedFolders || []).length || (res.unsure || []).length;
        if (res.alreadyHave > 0) {
          inner.appendChild(el("p", "mt-note good", "Nothing new. Every game found is already in the library."));
        } else if (skippedAny) {
          inner.appendChild(el("p", "mt-note bad", "No games were offered. Everything seen was skipped, and why is listed below."));
        } else {
          inner.appendChild(el("p", "mt-note bad",
            "No games were found. Xsegon looks through every folder under the ones listed below, " +
            "so add the folder your games are in (or one above it)."));
        }
      }

      // Disc games still packed are said up here, with one press for all of them (js/unpack.js).
      unpackAll(inner, res.archives || [], res.archivesRoom, !res.new.length, function () {
        if (res.new.length) { return false; }        // the games offered here would go with the window
        closeEditor();
        return true;
      });

      /* The button goes OVER the list and stays in view while it scrolls, as
         Fill in's does (js\fill.js): after the last row it is screens down and unseen. */
      if (res.new.length) {
        var btns = el("div", "art-btns");
        var go = el("button", "primary", "Add the selected games");
        go.addEventListener("click", function () {
          var picks = boxes.filter(function (b) { return b.box.checked; }).map(function (b) { return b.game; });
          if (!picks.length) { showStrip("nothing is selected", true); return; }
          L("ED", "scan add " + picks.length);
          go.disabled = true;
          go.textContent = "Adding...";
          postJson("api/scan.php", { action: "accept", games: picks }).then(function (r) {
            if (!r.ok) { showStrip("could not add them: " + (r.error || ""), true); paint(); return; }
            sound("select");
            if (r.added > 0) { added = true; }
            var line = "added " + r.added + (r.added === 1 ? " game" : " games");
            if (r.skipped && r.skipped.length) {
              line += ", " + r.skipped.length + " skipped: " + r.skipped[0].why;
            }
            /* Set up by itself (js\setup.js): the server started what the new games
               need. The cores are followed so "fetched" is said wherever this was
               opened from; the pictures bar is armed now, not at the next status poll. */
            if (r.auto && r.auto.cores && r.auto.cores.length) {
              line += "  ·  fetching " + (r.auto.cores.length === 1 ? "the " + r.auto.cores[0] + " core" : r.auto.cores.length + " cores") + " in the background";
              followSetupJob("the cores are fetched: your consoles are ready to play");
            }
            if (r.auto && r.auto.fill) { line += ", looking up names and pictures"; fillWatch(); }
            // Not left unspoken for: said here, and each wears Hack? until settled (js/hacksettle.js).
            if (r.mayBeHacks) { line += "  ·  " + r.mayBeHacks + (r.mayBeHacks === 1 ? " may be a hack" : " may be hacks") + ": Games > Hacks to settle"; }
            showStrip(line, r.added === 0);
            // Added: nothing more to do here, and the bars of what it started are behind this window.
            if (r.added > 0) { closeEditor(); } else { paint(); }
          });
        });
        btns.appendChild(go);
        btns.appendChild(el("span", "fl-count", res.new.length + (res.new.length === 1 ? " game" : " games") +
          " found, selected below. Deselect what you do not want."));
        var bar = el("div", "fl-bar");
        bar.appendChild(btns);
        inner.appendChild(bar);
      }

      // one section per console, selected by default: the offer
      var byPlat = {};
      res.new.forEach(function (g) { (byPlat[g.platform] = byPlat[g.platform] || []).push(g); });
      Object.keys(byPlat).sort().forEach(function (p) {
        var isNewPlat = res.newPlatforms.indexOf(p) >= 0;
        var noEmu = res.noEmulator.indexOf(p) >= 0;
        var head = el("div", "sc-head");
        var all = el("input"); all.type = "checkbox"; all.checked = true;
        var lab = el("label");
        lab.appendChild(all);
        lab.appendChild(el("b", null, " " + p + "  (" + byPlat[p].length + ")"));
        head.appendChild(lab);
        if (isNewPlat) { head.appendChild(el("span", "sc-tag", "a console the library does not have yet")); }
        if (noEmu) { head.appendChild(el("span", "sc-tag warn", "no emulator for this console yet: they will list as unplayable until one is added (Emulators > Add an emulator)")); }
        inner.appendChild(head);
        var rows = el("div", "sc-rows");
        byPlat[p].forEach(function (g) {
          var rowEl = el("label", "sc-row");
          var c = el("input"); c.type = "checkbox"; c.checked = true; c.dataset.plat = p;
          rowEl.appendChild(c);
          rowEl.appendChild(el("span", "sc-title", g.title + (g.discs ? "  ·  multi-disc" : "")));
          rowEl.appendChild(el("span", "sc-rom", g.rom));
          rows.appendChild(rowEl);
          boxes.push({ box: c, game: g });
        });
        inner.appendChild(rows);
        all.addEventListener("change", function () {
          boxes.forEach(function (b) { if (b.game.platform === p) { b.box.checked = all.checked; } });
        });
      });

      /* Disc sets with no playlist play as Disc 1 only until a .m3u beside the
         discs lists them. The button writes exactly the file shown and nothing
         else. Offered for known games too: sets imported long ago need it most. */
      if (res.m3u && res.m3u.length) {
        inner.appendChild(el("h2", "bk-head", "Disc sets with no playlist"));
        inner.appendChild(el("p", "mt-note",
          "Each of these plays as Disc 1 only. A playlist (.m3u) beside the discs makes RetroArch play the set as one game, " +
          "swapping discs when the game asks. Build writes that one small text file next to the discs and touches nothing else."));
        var m3uRows = el("div", "sc-rows");
        res.m3u.forEach(function (m) {
          var rowEl = el("div", "sc-row sc-m3u");
          rowEl.appendChild(el("span", "sc-title", m.platform + ": " + m.title + "  (" + m.discs.length + " discs)"));
          rowEl.appendChild(el("span", "sc-rom", m.dir + "\\" + m.file));
          var b = el("button", "sc-rm", "Build " + m.file);
          b.type = "button";
          b.addEventListener("click", function () {
            b.disabled = true;
            postJson("api/scan.php", { action: "m3u", dir: m.dir, file: m.file })
              .then(function (r) {
                if (!r.ok) { b.disabled = false; showStrip("could not build it: " + (r.error || ""), true); return; }
                sound("select");
                added = true;              // the set now launches through the playlist
                b.replaceWith(el("span", "sc-tag", "written, " + r.discs.length + " discs listed"));
              });
          });
          rowEl.appendChild(b);
          m3uRows.appendChild(rowEl);
        });
        inner.appendChild(m3uRows);
      }

      // the honest tail: what was found and NOT offered, with reasons
      function tail(title, rows, line) {
        if (!rows.length) { return; }
        inner.appendChild(el("h2", "bk-head", title));
        rows.forEach(function (r) { inner.appendChild(el("p", "mt-note", line(r))); });
      }
      tail("Disc sets with holes", res.gaps, function (g) {
        return g.platform + ": " + g.title + " has discs " + g.have + " (" + g.why + ")";
      });
      // A disc still in its archive gets a line with a button: looked into, unpacked, added (js/unpack.js).
      unpackTail(inner, res.archives || [], function () { added = true; }, res.archivesDone);
      // An empty .zip or .7z is a download not finished: how far it got, and Clear it (js/unfinished.js).
      unfinishedTail(inner, res.unfinished || []);
      // A file taken for a game that is here under another file: named, with a way to add it after all (js/scanpassed.js).
      passedTail(inner, res.passed, function () { added = true; });
      // The same game found in a second folder: the first is the one offered, and the other is named, not left out unseen.
      tail("The same game in two places", res.copies || [], function (c) {
        var two = function (p) { return String(p || "").split(/[\\\/]/).slice(-2).join("\\"); };
        return c.platform + ": " + c.title + "  ·  " + two(c.rom) + " is taken as a second copy of " + two(c.has) + ", so it is not offered twice";
      });
      tail("Dumps missing their cue sheet", res.orphans || [], function (o) {
        return o.platform + ": " + o.folder + "  ·  " + o.why;
      });
      // A folder of arcade sets: what its files were taken for, and what was left out (includes\arcade.php).
      tail("Arcade sets", res.arcade || [], function (a) {
        var left = [];
        if (a.versions) { left.push(plural(a.versions, "other version", "other versions") + " of a game that is there"); }
        if (a.bios) { left.push(plural(a.bios, "BIOS or device set", "BIOS and device sets") + " (other games need them, they are not games)"); }
        if (a.machines) { left.push(plural(a.machines, "mechanical machine or computer", "mechanical machines and computers")); }
        return a.folder + "  ·  " + plural(a.sets, "file", "files") + ", " + plural(a.games, "game", "games") + " named from MAME's own list"
          + (left.length ? ". Left out: " + left.join(", ") : "")
          + (a.unknown ? ". " + plural(a.unknown, "file", "files") + " the list does not know " + (a.unknown === 1 ? "is" : "are") + " offered under the file's own name" : "") + ".";
      });
      /* Games that cannot say their console (includes\romid.php: a .chd or .7z
         cannot be looked inside) need a folder named for it, so the names are said here. */
      if ((res.unsure || []).length) {
        inner.appendChild(el("h2", "bk-head", "Games Xsegon could not match to a console"));
        res.unsure.forEach(function (u) {
          inner.appendChild(el("p", "mt-note", u.folder + " holds " + u.n + (u.n === 1 ? " file" : " files") +
            " that may be games (" + u.kinds + ")."));
        });
        var names = Object.keys(res.names || {});
        inner.appendChild(el("p", "mt-note sc-names",
          "Most games say which console they are for, wherever they are kept. These kinds cannot be looked into, " +
          "so Xsegon goes by the folder: put them in a folder named for their console, anywhere under a games " +
          "folder, and scan again. A zip of several games needs unpacking first. Folder names Xsegon understands: " +
          names.join(", ") + ". A console's full name works too (Sega Saturn, Game Boy Advance). " +
          "Make console folders, beside each games folder below, makes them for you."));
      }
      tail("Folders skipped on purpose", res.skippedFolders, function (s) {
        return s.folder + "  ·  " + s.why;
      });

      // Last, because it is the setup rather than the answer: you come here
      // once to point Xsegon at a disk, and after that you want the games.
      inner.appendChild(folderList(paint));

      $editor.textContent = "";
      $editor.appendChild(inner);
    });
  }

  $editor.dataset.tool = "scan";
  setEditorOnClose(function () {
    delete $editor.dataset.tool;
    // the library grew: read it again so the new consoles stand on the rim
    if (added && games[sel]) { reloadKeeping(games[sel].id); } else if (added) { reloadKeeping(null); }
  });
  paint().then(function () { sound("select"); });
}
