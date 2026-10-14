/*  Emulators > BIOS check: which consoles want their own startup files,
    whether each is in place and genuine, and your own files copied there
    from a folder you choose. A BIOS is copyrighted: none is ever fetched. */

import { setEditorOnClose, toolFrame } from "./editors.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { pickWindowsFolder } from "./scan.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { el, plural } from "./util.js";

function post(body) {
  return postJson("api/bios.php", body);
}


export function openBiosCheck() {
  L("ED", "bios check");
  stopVideo();
  var found = null;             // the look at a chosen folder, kept on screen until Done

  function shell(title) { return toolFrame(title); }

  function check(state, label, title, says) {
    var line = el("div", "rp-check " + state);
    line.appendChild(el("span", "rp-state", label));
    var t = el("div", "rp-text");
    t.appendChild(el("span", "rp-label", title));
    t.appendChild(el("span", "rp-says", says));
    line.appendChild(t);
    return line;
  }

  function fileRow(c, f) {
    var required = c.need === "required";
    return check(f.status === "ok" ? "ok" : f.status === "wrong" ? "bad" : required ? "warn" : "info",
      f.status === "ok" ? "OK" : f.status === "wrong" ? "WRONG" : "MISSING",
      f.file + (f.note ? "  ·  " + f.note : ""),
      f.status === "ok" ? "here and genuine" + (f.md5 ? " (its checksum matches)" : "")
      : f.status === "wrong" ? "a file is here, but it is not the real one: its checksum differs. Games can fail oddly on it."
      : required ? "without it, these games do not start."
      : "fine to leave missing for most games.");
  }

  /* One line per copy the chosen folder allows. A folder Xsegon only reads
     is never written to: those copies are named for the person to make. */
  function foundRow(r) {
    var title = r.file + (r.note ? "  ·  " + r.note : "");
    if (r.state === "there") { return check("ok", "HERE", title, "already where the emulator looks: " + r.to); }
    var goes = "from " + r.from + " to " + r.to;
    if (!r.writable) {
      return check("warn", "BY HAND", title, goes + ". Xsegon never writes into that folder: copy this one yourself.");
    }
    return check("info", "READY", title, goes +
      (r.state === "replace" ? ". The file there now is not the real one: it is kept beside the new one as " + r.file.split("/").pop() + ".not-genuine." : "."));
  }

  function placeBox(inner) {
    inner.appendChild(el("h2", "bk-head", "Put your BIOS files in place"));
    inner.appendChild(el("p", "mt-note",
      "Choose the folder your own BIOS files are in. Xsegon knows each real one by its checksum, whatever it is " +
      "called, and copies it to where the emulator looks, under the name it wants. Your files stay where they " +
      "are, and nothing is downloaded."));
    var acts = el("div", "bk-acts bios-acts");
    var choose = el("button", null, found ? "Choose another folder..." : "Choose folder...");
    choose.type = "button";
    choose.addEventListener("click", function () {
      pickWindowsFolder("Choose the folder your BIOS files are in", { start: found ? found.folder : "" }).then(function (path) {
        if (!path) { return; }
        post({ action: "look", folder: path }).then(function (r) {
          if (!r.ok) { sound("back"); showStrip("could not look there: " + (r.error || "no answer"), true); return; }
          found = r;
          L("BIOS", "looked in " + path + ": " + r.found + " known, " + r.todo + " to copy, " + r.byHand + " by hand");
          showStrip(r.found ? plural(r.found, "BIOS file", "BIOS files") + " known in " + path
                            : "no BIOS file an emulator here uses is in " + path, false);
          paint();
        });
      });
    });
    acts.appendChild(choose);
    if (found && found.todo) {
      var put = el("button", "primary", "Put " + plural(found.todo, "file", "files") + " in place");
      put.type = "button";
      put.addEventListener("click", function () {
        put.disabled = true;
        post({ action: "place", folder: found.folder }).then(function (r) {
          if (!r.ok) { sound("back"); showStrip(r.error || "the files could not be copied", true); if (r.rows) { found = r; } paint(); return; }
          found = r;
          L("BIOS", "put in place: " + r.placed.join(", ") + (r.failed.length ? "; failed: " + r.failed.join(", ") : ""));
          sound("ok");
          showStrip(plural(r.placed.length, "BIOS file", "BIOS files") + " put in place" +
            (r.failed.length ? ", " + r.failed.length + " could not be copied" : ""), !!r.failed.length);
          paint();
        });
      });
      acts.appendChild(put);
    }
    inner.appendChild(acts);
    if (!found) { return; }
    if (found.rows.length) {
      var rows = el("div", "rp-checks bios-found");
      found.rows.forEach(function (r) { rows.appendChild(foundRow(r)); });
      inner.appendChild(rows);
    }
    var fake = found.notReal || [];
    inner.appendChild(el("p", "mt-note bios-rest",
      (found.found ? "" : "No BIOS file an emulator here uses is in " + found.folder + ". ") +
      (fake.length ? "Not copied: " + fake.join(", ") + (fake.length === 1 ? " is" : " are") +
        " named like a BIOS file but " + (fake.length === 1 ? "is" : "are") + " not the real one (the checksum differs). " : "") +
      (found.unknown ? plural(found.unknown, "other file", "other files") + " there " + (found.unknown === 1 ? "is" : "are") +
        " not one an emulator here uses, and " + (found.unknown === 1 ? "was" : "were") + " left alone." : "")));
  }

  function paint() {
    return api("api/bios.php").then(function (res) {
      if ($editor.dataset.tool !== "bios") { return; }          // closed while asking
      if (!res.ok) { showStrip("could not check: " + (res.error || ""), true); return; }

      var inner = shell("BIOS CHECK");
      inner.appendChild(el("p", "group-help",
        "A BIOS is the console's own startup software, and some emulators want a copy of it beside them " +
        "before their games start. This screen checks those files, so a game that will not boot is not a " +
        "mystery. The files are copyrighted, so Xsegon never downloads one: each comes from a console you " +
        "own, read off it with its own homebrew tools. The one handed out legally is the PlayStation 3's, " +
        "from Sony."));

      var needed = 0, wrong = 0;
      res.consoles.forEach(function (c) {
        c.files.forEach(function (f) {
          if (f.status === "wrong") { wrong++; }
          if (f.status === "missing" && c.need === "required") { needed++; }
        });
      });
      inner.appendChild(el("p", "rp-verdict " + (wrong ? "bad" : needed ? "warn" : "good"),
        wrong ? (wrong === 1 ? "One file is not what it says it is." : wrong + " files are not what they say they are.")
        : needed ? needed + (needed === 1 ? " file" : " files") + " that games here may need " + (needed === 1 ? "is" : "are") + " missing."
        : "Everything your games need is in place."));

      placeBox(inner);

      // The consoles whose games can be blocked come first, as in the report.
      res.consoles.slice().sort(function (a, c) {
        return (a.need === "required" ? 0 : 1) - (c.need === "required" ? 0 : 1);
      }).forEach(function (c) {
        inner.appendChild(el("h2", "bk-head", c.platform + "  ·  " + c.games + (c.games === 1 ? " game" : " games")));
        inner.appendChild(el("p", "mt-note", (c.need === "required" ? "Needed: " : "Optional: ") + c.why + ".  The files go in " + c.dir + "."));
        var rows = el("div", "rp-checks");
        c.files.forEach(function (f) { rows.appendChild(fileRow(c, f)); });
        inner.appendChild(rows);
      });

      if (res.outside.length) {
        inner.appendChild(el("h2", "bk-head", "Consoles with their own programs"));
        var rows2 = el("div", "rp-checks");
        res.outside.forEach(function (o) {
          rows2.appendChild(check("info", "ITS OWN", o.platform + "  ·  " + o.games + (o.games === 1 ? " game" : " games"), o.note));
        });
        inner.appendChild(rows2);
      }

      if (res.fine.length) {
        inner.appendChild(el("p", "mt-note", "No BIOS at all is needed for " + res.fine.join(", ") + "."));
      }

      $editor.appendChild(inner);
      $editor.hidden = false;
    });
  }

  $editor.dataset.tool = "bios";
  setEditorOnClose(function () { delete $editor.dataset.tool; });
  paint().then(function () { sound("select"); });
}
