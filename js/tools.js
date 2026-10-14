import { backupFailed, backupIoButtons, backupSaid } from "./backup-io.js";
import { closeEditor, setEditorOnClose, toolFrame } from "./editors.js";
import { showStrip } from "./launch.js";
import { load } from "./library.js";
import { L, api, flushLog, postJson } from "./log.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor, hasLaunchBox } from "./state.js";
import { el } from "./util.js";
import { row } from "./views.js";
import { waitBar } from "./waitbar.js";

/* A button that asks by its own words and acts on a second press: is this
   press the yes? A double click is two presses, so the second counts only a
   second after the question was put. */
function sureNow(btn, words) {
  if (btn.dataset.sure !== "1") { btn.dataset.sure = "1"; btn.dataset.at = String(Date.now()); btn.textContent = words; return false; }
  if (Date.now() - Number(btn.dataset.at) < 1000) { L("ED", "a second press too soon after the question is no yes: " + words); return false; }
  return true;
}

/* The log viewer: the last lines of today's log, page and server
   interleaved, newest at the bottom, with a filter. Refresh re-reads;
   Copy puts the visible lines on the clipboard for a report. L opens it. */
export function openLogViewer(after) {
  stopVideo();
  flushLog();
  setEditorOnClose(after || null);         // opened from Settings: Settings again as this closes (js\settings-ui.js)
  var filter = "", tail = 300;
  function paint() {
    api("api/log.php?tail=" + tail).then(function (res) {
      if (!res.ok) { showStrip("could not read the log: " + (res.error || ""), true); return; }
      var inner = toolFrame("THE LOG", { cls: "lg-inner" });
      inner.appendChild(el("p", "group-help", res.file + (res.enabled ? "" : "  ·  logging is OFF (Settings > Debug)") +
        "  ·  P is the page, S is the server."));
      // Which build, on its own line, so Copy shown pastes it with the rest.
      inner.appendChild(el("p", "group-help lg-build", res.build || ""));

      var bar = el("div", "lg-bar");
      var q = el("input");
      q.type = "text";
      q.placeholder = "filter: a code (ERR, LNCH), a word, a time";
      q.value = filter;
      bar.appendChild(q);
      var more = el("button", null, tail >= 2000 ? "All of today" : "More");
      more.addEventListener("click", function () { tail = tail >= 2000 ? 5000 : tail * 3; paint(); });
      bar.appendChild(more);
      var refresh = el("button", null, "Refresh");
      refresh.addEventListener("click", function () { flushLog(); setTimeout(paint, 300); });
      bar.appendChild(refresh);
      var copy = el("button", null, "Copy shown");
      bar.appendChild(copy);
      var errs = el("button", null, "Errors only");
      errs.addEventListener("click", function () { q.value = filter = (filter === "ERR" ? "" : "ERR"); show(); });
      bar.appendChild(errs);
      inner.appendChild(bar);

      var pre = el("pre", "lg-pre");
      inner.appendChild(pre);
      function show() {
        var want = filter.trim().toLowerCase();
        // "err" is every kind of trouble, BUG and WARN among them, not just
        // lines with those three letters in.
        var trouble = /^\S+ [PS] (ERR|BUG|WARN|FAIL|PHPE|WRIT)\s/;
        var lines = res.lines.filter(function (l) {
          return !want || l.toLowerCase().indexOf(want) >= 0 || (want === "err" && trouble.test(l));
        });
        pre.textContent = "";
        lines.forEach(function (l) {
          var m = l.match(/^(\S+) ([PS]) (\S+)\s*(.*)$/);
          var row = el("div", "lg-row" + (m && /^(ERR|BUG|FAIL|PHPE|WRIT)$/.test(m[3]) ? " lg-err" : "") +
                                   (m && m[3] === "WARN" ? " lg-warn" : "") + (m && m[2] === "S" ? " lg-srv" : ""));
          if (m) {
            row.appendChild(el("span", "lg-t", m[1]));
            row.appendChild(el("span", "lg-w", m[2]));
            row.appendChild(el("span", "lg-c", m[3]));
            row.appendChild(el("span", "lg-m", m[4]));
          } else { row.textContent = l; }
          pre.appendChild(row);
        });
        pre.appendChild(el("div", "lg-n", lines.length + " of " + res.lines.length + " lines" + (res.lines.length >= tail ? " (the last " + tail + ")" : "")));
        pre.scrollTop = pre.scrollHeight;
        copy.onclick = function () {
          // The build first: a pasted log that does not say which version
          // wrote it costs a round trip to find out.
          var text = (res.build ? res.build + "\n" + res.file + "\n\n" : "") + lines.join("\n");
          navigator.clipboard.writeText(text).then(function () { copy.textContent = "Copied"; setTimeout(function () { copy.textContent = "Copy shown"; }, 1200); });
        };
      }
      q.addEventListener("input", function () { filter = q.value; show(); });
      q.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Escape") { closeEditor(); } });
      show();
      $editor.appendChild(inner);
      $editor.hidden = false;
    });
  }
  paint();
}

// One row of a tool's facts: what it is, and its value.
function line(parent, k, v, cls) {
  var r = el("div", "mt-row" + (cls ? " " + cls : ""));
  r.appendChild(el("span", "mt-k", k));
  r.appendChild(el("span", "mt-v", v));
  parent.appendChild(r);
  return r;
}

function size(bytes) {
  if (bytes >= 1073741824) { return (bytes / 1073741824).toFixed(2) + " GB"; }
  return (bytes / 1048576).toFixed(bytes >= 104857600 ? 0 : 1) + " MB";
}

/* ---------- backing up the things only you have ----------
   Two screens: the first says what is precious, how old the newest archive is
   and where they are kept, and makes one. The second, from Restore, says for
   every part how many files would be replaced, added or are the same, and acts
   only on a press: a restore with no idea what it lands on is how work is lost. */
export function openBackupTool(after) {
  L("ED", "backup tool");
  stopVideo();
  var restored = false;


  function shell(title) { return toolFrame(title); }

  function when(b) {
    var hours = Math.max(0, Math.round((Date.now() - b.stamp * 1000) / 3600000));
    if (hours < 1) { return "just now"; }
    if (hours < 48) { return hours + (hours === 1 ? " hour ago" : " hours ago"); }
    return Math.round(hours / 24) + " days ago";
  }

  function paint() {
    return api("api/backup.php").then(function (res) {
      if ($editor.dataset.tool !== "backup") { return; }        // closed while asking
      if (!res.ok) { showStrip("could not read the backups: " + (res.error || ""), true); return; }

      var inner = shell("BACK UP WHAT YOU MADE");
      inner.appendChild(el("p", "group-help",
        "The pictures you replaced, the text you edited, your favourites, your own games and every play recorded. " +
        "None of it can be got again " + (hasLaunchBox ? "from the imported library or " : "") + "from anywhere else. The archive is an ordinary zip laid out like " +
        "Xsegon's data folder, so it opens in Explorer and can be put back by hand with no Xsegon at all."));

      var box = el("div", "mt-box");
      if (res.newest) {
        line(box, "Newest backup", when(res.newest) + "  ·  " + res.newest.at + "  ·  " + size(res.newest.bytes),
             res.ageHours > 24 * 14 ? "warn" : "good");
      } else {
        line(box, "Newest backup", "there is no backup yet", "warn");
      }
      line(box, "To back up", res.files + " files  ·  " + size(res.bytes));
      line(box, "Kept in", res.dir);
      line(box, "Free on that drive", size(res.free));
      inner.appendChild(box);

      if (res.large) {
        inner.appendChild(el("p", "mt-note warn",
          "This backup will be over 4 GB or 65,535 files, so it is written in the larger zip format. Windows Explorer and 7-Zip open it; " +
          "some older tools do not. Large backups are new in this build: Xsegon reads every file back before it says the backup is made."));
      }
      if (res.inData) {
        inner.appendChild(el("p", "mt-note warn",
          "Those archives sit inside the data folder they are backing up, so they go with it if this disk does. " +
          "Settings > Paths > Backup folder moves them: another drive, or a stick you plug in now and then."));
      }

      // What goes in, part by part, so it is never a mystery bundle.
      var parts = el("div", "bk-parts");
      res.parts.forEach(function (p) {
        var row = el("div", "bk-part" + (p.count ? "" : " bk-empty"));
        row.appendChild(el("span", "bk-name", p.label));
        row.appendChild(el("span", "bk-n", p.count ? (p.count + (p.count === 1 ? " file" : " files") + "  ·  " + size(p.bytes)) : "nothing yet"));
        row.appendChild(el("span", "bk-help", p.help));
        parts.appendChild(row);
      });
      inner.appendChild(parts);

      var left = el("p", "mt-note");
      left.textContent = "Left out, because a pull or a rebuild brings it back: " +
        res.skipped.filter(function (s) { return s.bytes > 0; })
          .map(function (s) { return s.path + " (" + size(s.bytes) + ")"; }).join(", ") + ".";
      inner.appendChild(left);

      var btns = el("div", "art-btns");
      var go = el("button", "primary", "Back up now");
      go.addEventListener("click", function () {
        go.disabled = true;
        go.textContent = "Backing up...";
        waitBar(btns, "Backing up your files", postJson("api/backup.php", { action: "make" })).then(function (r) {
          if (!r.ok) { backupFailed("The backup was not made", "could not back up", r, openReportTool); paint(); return; }
          sound("select");
          // A file that was there and would not read is named, not passed over.
          var miss = r.made.missed || [];
          if (miss.length) { showStrip("backed up " + r.made.files + " files, but " + miss.length + " would not read and " + (miss.length === 1 ? "is" : "are") + " NOT in it: " + miss.slice(0, 5).join(", ") + ". Try again in a moment.", true); }
          else { showStrip("backed up " + backupSaid(r.made, size) + ", to " + r.made.name, false); }
          paint();
        });
      });
      btns.appendChild(go);
      backupIoButtons(btns, size, paint, inspect, openReportTool);
      inner.appendChild(btns);
      inner.appendChild(el("p", "mt-note", "Export writes the same archive into a folder you choose: a stick, another drive, " +
        "the way to another PC. Import takes one in from anywhere and opens it for restoring."));

      // The archives on hand.
      if (res.backups.length) {
        inner.appendChild(el("h2", "bk-head", "Backups on hand"));
        var list = el("div", "bk-list");
        res.backups.forEach(function (b) {
          var row = el("div", "bk-row");
          var name = el("div", "bk-file");
          name.appendChild(el("span", "bk-when", b.at));
          name.appendChild(el("span", "bk-size", size(b.bytes) + "  ·  " + (b.files === null ? "unreadable" : b.files + " files")));
          name.appendChild(el("span", "bk-id", b.name + (b.safety ? "  ·  taken automatically before a restore" : "")));
          row.appendChild(name);

          var acts = el("div", "bk-acts");
          if (b.bad) {
            row.classList.add("bad");
            name.appendChild(el("span", "bk-id bad", "cannot be read: " + b.bad));
          } else {
            var open = el("button", null, "Restore...");
            open.addEventListener("click", function () { inspect(b.name); });
            acts.appendChild(open);
          }
          var del = el("button", null, "Delete");
          del.addEventListener("click", function () {
            if (!sureNow(del, "Delete, really?")) { return; }
            postJson("api/backup.php", { action: "remove", name: b.name }).then(function (r) {
              if (!r.ok) { showStrip("could not delete it: " + (r.error || ""), true); return; }
              sound("back");
              paint();
            });
          });
          acts.appendChild(del);
          row.appendChild(acts);
          list.appendChild(row);
        });
        inner.appendChild(list);
      }

      $editor.appendChild(inner);
      $editor.hidden = false;
    });
  }

  function inspect(name) {
    // Every file here is summed against the one in the archive: seconds for gigabytes, so it says so.
    return waitBar(document.querySelector("#editor .art-btns"), "Reading the backup", postJson("api/backup.php", { action: "inspect", name: name })).then(function (res) {
      if ($editor.dataset.tool !== "backup") { return; }
      if (!res.ok) { showStrip("could not read that backup: " + (res.error || ""), true); return; }
      var b = res.backup;

      var inner = shell("RESTORE FROM A BACKUP");
      inner.appendChild(el("p", "group-help",
        "From " + b.at + "  ·  " + size(b.bytes) + ". Nothing is put back until you press the button, and a copy of " +
        "what is here now is taken first, so a restore can itself be undone."));

      var ticks = {};
      var parts = el("div", "bk-parts");
      b.parts.forEach(function (p) {
        var row = el("label", "bk-part bk-pick");
        var tick = el("input");
        tick.type = "checkbox";
        tick.checked = p.replace > 0 || p.add > 0 || p.merge > 0;   // nothing to do is nothing to select
        ticks[p.key] = tick;
        row.appendChild(tick);
        row.appendChild(el("span", "bk-name", p.label));
        var said = [];
        if (p.replace) { said.push(p.replace + " would be replaced"); }
        if (p.add) { said.push(p.add + " would be put back"); }
        // The play logs are added to, never overwritten: an old archive must
        // not cost you the evenings since it was made.
        if (p.merge) { said.push(p.merge + " would be merged, keeping newer plays"); }
        if (p.same) { said.push(p.same + " already the same"); }
        row.appendChild(el("span", "bk-n", p.count + (p.count === 1 ? " file" : " files")));
        row.appendChild(el("span", "bk-help" + (p.replace ? " warn" : ""), said.join(", ")));
        parts.appendChild(row);
      });
      inner.appendChild(parts);

      var btns = el("div", "art-btns");
      var go = el("button", "primary", "Restore what is selected");
      go.addEventListener("click", function () {
        var want = Object.keys(ticks).filter(function (k) { return ticks[k].checked; });
        if (!want.length) { showStrip("nothing is selected", true); return; }
        if (!sureNow(go, "Restore, really?")) { return; }
        go.disabled = true;
        go.textContent = "Restoring...";
        waitBar(go.parentNode, "Putting your files back", postJson("api/backup.php", { action: "restore", name: b.name, parts: want })).then(function (r) {
          if (!r.ok) { backupFailed("The restore did not go through", "could not restore", r, openReportTool); paint(); return; }
          restored = true;
          sound("select");
          showStrip("put back " + r.restored.written + " files. What was here first is in " + r.restored.safety, false);
          paint();
        });
      });
      btns.appendChild(go);
      var back = el("button", null, "Back");
      back.addEventListener("click", function () { sound("back"); paint(); });
      btns.appendChild(back);
      inner.appendChild(btns);

      if (b.stray.length) {
        inner.appendChild(el("p", "mt-note warn",
          b.stray.length + " thing(s) in that archive are not part of anything Xsegon backs up, and would be left alone."));
      }

      $editor.appendChild(inner);
      $editor.hidden = false;
    });
  }

  $editor.dataset.tool = "backup";
  setEditorOnClose(function () {
    delete $editor.dataset.tool;
    // A restore changes the library under the page: read it again. What Settings
    // showed may no longer be so either, so it is told to close and not come back.
    if (restored) { load(); }
    if (after) { after(restored); }
  });
  paint().then(function () { sound("select"); });
}

/* ---------- Help > Report a problem ----------
   Most of this screen is useful BEFORE anything is made: the checks run when it
   opens, worst first. The zip carries the log, settings, emulator table and a
   library summary, and says what it carries (includes\report.php). */
export function openReportTool(after) {
  L("ED", "report tool");
  stopVideo();

  function shell(title) { return toolFrame(title); }

  function paint() {
    return api("api/report.php").then(function (res) {
      if ($editor.dataset.tool !== "report") { return; }        // closed while asking
      if (!res.ok) { showStrip("could not run the checks: " + (res.error || ""), true); return; }

      var inner = shell("REPORT A PROBLEM");
      inner.appendChild(el("p", "group-help",
        "Every check below runs now, not when the report is made. Read them first: most problems are on this " +
        "screen already. The report is for when they are not, and it gathers the log, your settings, the " +
        "emulator table and a summary of your library into one zip small enough to send."));

      var bad = res.checks.filter(function (c) { return c.state === "bad"; });
      var warn = res.checks.filter(function (c) { return c.state === "warn"; });
      inner.appendChild(el("p", "rp-verdict " + (bad.length ? "bad" : (warn.length ? "warn" : "good")),
        bad.length ? (bad.length === 1 ? "One thing looks genuinely wrong." : bad.length + " things look genuinely wrong.")
          : (warn.length ? "Nothing is outright broken, but " + warn.length + " thing" + (warn.length === 1 ? " is" : "s are") + " worth a look."
                         : "Every check passed. Whatever happened is not one of the usual causes, so the log is the place to look.")));

      // Worst first, which is the order a person would want to read them in.
      var rank = { bad: 0, warn: 1, ok: 2, info: 3 };
      var rows = el("div", "rp-checks");
      res.checks.slice().sort(function (a, c) { return rank[a.state] - rank[c.state]; }).forEach(function (c) {
        var row = el("div", "rp-check " + c.state);
        row.appendChild(el("span", "rp-state", c.state.toUpperCase()));
        var t = el("div", "rp-text");
        t.appendChild(el("span", "rp-label", c.label));
        t.appendChild(el("span", "rp-says", c.says));
        row.appendChild(t);
        rows.appendChild(row);
      });
      inner.appendChild(rows);

      if (!res.logging) {
        inner.appendChild(el("p", "mt-note warn",
          "Logging is off, so a report made now carries very little. Turn it on in Settings > Debug, make the " +
          "problem happen again, then come back."));
      }
      inner.appendChild(el("p", "mt-note",
        "In the report: the last " + res.days + " days of log, your settings and the folders in them, the emulator " +
        "table, the cores and cheats you chose, and the names of your games. Where Xsegon was slow, the log also " +
        "names the three programs that were using this PC the most at that moment. Not in it: your ROMs, your pictures " +
        "and your videos. It lists its own contents, so you can read it before you send it."));

      var btns = el("div", "art-btns");
      var go = el("button", "primary", "Make a report");
      go.addEventListener("click", function () {
        go.disabled = true;
        go.textContent = "Gathering...";
        waitBar(go.parentNode, "Making the report", postJson("api/report.php", { action: "make" })).then(function (r) {
          if (!r.ok) { showStrip("could not make the report: " + (r.error || ""), true); paint(); return; }
          sound("select");
          showStrip("report made: " + r.made.name + " (" + size(r.made.bytes) + ")", false);
          paint();
        });
      });
      btns.appendChild(go);
      inner.appendChild(btns);

      if (res.reports.length) {
        inner.appendChild(el("h2", "bk-head", "Reports on hand"));
        inner.appendChild(el("p", "mt-note", "Kept in " + res.folder + "."));
        var list = el("div", "bk-list");
        res.reports.forEach(function (rp) {
          var row = el("div", "bk-row");
          var name = el("div", "bk-file");
          name.appendChild(el("span", "bk-when", rp.at));
          name.appendChild(el("span", "bk-size", size(rp.bytes)));
          name.appendChild(el("span", "bk-id", rp.name));
          row.appendChild(name);

          var acts = el("div", "bk-acts");
          var save = el("a", "btn-like", "Save a copy");
          save.href = "api/report.php?get=" + encodeURIComponent(rp.name);
          save.setAttribute("download", rp.name);
          acts.appendChild(save);
          var del = el("button", null, "Delete");
          del.addEventListener("click", function () {
            if (!sureNow(del, "Delete, really?")) { return; }
            postJson("api/report.php", { action: "remove", name: rp.name }).then(function (r) {
              if (!r.ok) { showStrip("could not delete it: " + (r.error || ""), true); }
              paint();
            });
          });
          acts.appendChild(del);
          row.appendChild(acts);
          list.appendChild(row);
        });
        inner.appendChild(list);
      }

      $editor.appendChild(inner);
      $editor.hidden = false;
    });
  }

  $editor.dataset.tool = "report";
  setEditorOnClose(function () { delete $editor.dataset.tool; if (after) { after(); } });
  paint().then(function () { sound("select"); });
}
