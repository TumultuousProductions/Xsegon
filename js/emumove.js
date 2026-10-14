import { closeEditor, reloadKeeping, setEditorOnClose, toolFrame } from "./editors.js";
import { iconEl } from "./icons.js";
import { jobSayOnce, jobsWatch } from "./jobbars.js";
import { setPick, showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { pickWindowsFolder } from "./scan.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { el } from "./util.js";
import { row } from "./views.js";

/* ---------- emulators moved out of LaunchBox's folder ----------
   LaunchBox's folders are never written, so an emulator in there keeps its saves
   and settings out of Xsegon's reach. This copies the selected ones into a folder
   of the person's own and starts the copies from then on (includes\emumove.php);
   LaunchBox's own stay as they are. The copy runs in the background with a bar. */

var watching = false;      // a copy is being followed to its end
var listAt = 0;            // the row the bar was on, kept while the list is drawn again

function sized(n) {
  return n >= 1073741824 ? (n / 1073741824).toFixed(1) + " GB" : Math.max(1, Math.round(n / 1048576)) + " MB";
}
function post(body) {
  return postJson("api/emumove.php", body);
}
function mine() {
  return !$editor.hidden && $editor.dataset.tool === "emumove";
}

export function openEmuMove(dest) {
  api("api/emumove.php" + (dest ? "?dest=" + encodeURIComponent(dest) : "")).then(function (res) {
    if (!res.ok) { showStrip("could not read where the emulators are", true); return; }
    L("EMU", "open move out of LaunchBox (" + res.rows.length + " inside it)");
    listAt = 0;
    if (res.job && res.job.state === "running") { paintJob(res.job); follow(); } else { paintList(res, {}); }
  });
}

function frame(help) {
  setEditorOnClose(null);
  $editor.textContent = "";
  $editor.dataset.tool = "emumove";
  var inner = toolFrame("MOVE OUT OF LAUNCHBOX", { base: "cr-inner", cls: "em-inner", primary: false, keep: true });
  inner.appendChild(el("p", "group-help", help));
  $editor.appendChild(inner);
  $editor.hidden = false;
  return inner;
}

/* The list: what sits inside LaunchBox, where its copy would go, and what was moved before. */
function paintList(res, picked) {
  var inner = frame("These emulators sit inside LaunchBox's folder, which Xsegon reads and never writes to. "
    + "A copy of each one you select is made in a folder of your own, and Xsegon starts the copy from then on. "
    + "LaunchBox's own are left exactly as they are: LaunchBox goes on working, and you can go back.");
  var cells = [], acts = [], sizes = res.sizes || null;
  var list = el("div", "cr-list em-list");
  inner.appendChild(list);

  // sub: the folder, on a line of its own under the name, so a long path never crowds the name out
  function row(cls, icon, name, sub, tag, run) {
    var line = el("div", "cr-row" + (cls ? " " + cls : ""));
    line.appendChild(iconEl("cr-ico", icon));
    var words = el("div", "sv-words");
    words.appendChild(el("span", "cr-name", name));
    if (sub) { words.appendChild(el("span", "sv-sub", sub)); }
    line.appendChild(words);
    line.appendChild(el("span", "cr-tag", tag));
    line.addEventListener("click", function () { run(); });
    line.addEventListener("mouseenter", function () { focusAt(cells.indexOf(line)); });
    cells.push(line);
    acts.push(run);
    list.appendChild(line);
    return line;
  }
  function chosen() {
    return res.rows.filter(function (r) { return picked[r.keys[0]] && !r.why && !r.there; });
  }
  function tagOf(r) {
    var said = [r.consoles + (r.consoles === 1 ? " console" : " consoles")];
    if (r.why) { said.push(r.why); }
    else if (r.there) { said.push("a " + r.dest.split("\\").pop() + " is in that folder already"); }
    else if (sizes && sizes[r.keys[0]]) { said.push(sized(sizes[r.keys[0]].bytes)); }
    else if (!sizes) { said.push("measuring"); }
    return said.join("  ·  ");
  }

  if (!res.rows.length) {
    var none = el("p", "cr-none");
    none.appendChild(iconEl("cr-ico", "info"));
    none.appendChild(document.createTextNode(" No emulator of yours sits inside LaunchBox's folder: there is nothing to move."));
    inner.insertBefore(none, list);
  }
  res.rows.forEach(function (r) {
    var key = r.keys[0], can = !r.why && !r.there;
    var line = row((picked[key] && can ? "on" : "") + (can ? "" : " ro"), picked[key] && can ? "check" : "disc", r.name, r.folder || r.exe, tagOf(r), function () {
      if (!can) { showStrip(r.name + " cannot be moved: " + (r.why || "a folder of its name is there already"), true); return; }
      picked[key] = !picked[key];
      sound("select");
      paintList(res, picked);
    });
    line.dataset.key = key;
  });
  if (res.rows.length) {
    row("ch-act em-dest", "folder", "The folder they are copied into", res.dest, res.destInside ? "inside LaunchBox: choose another" : "change the folder", function () {
      pickWindowsFolder("The folder your emulators should be kept in", { start: res.dest }).then(function (dir) {
        if (dir && mine()) { openEmuMove(dir); }
      });
    });
    var n = chosen().length;
    var total = sizes ? chosen().reduce(function (sum, r) { return sum + ((sizes[r.keys[0]] || {}).bytes || 0); }, 0) : 0;
    row("ch-act ch-save em-go", "play", n ? "Copy the " + n + " selected" + (total ? " (" + sized(total) + ")" : "") : "Select the emulators to move",
      "", res.running ? "a game is running: close it first" : "", function () {
        var keys = chosen().map(function (r) { return r.keys[0]; });
        if (!keys.length) { showStrip("select the emulators to move first", true); return; }
        post({ start: keys, dest: res.dest }).then(function (out) {
          if (!out.ok) { showStrip(out.error || "the copy could not be started", true); return; }
          sound("ok");
          showStrip("copying out of LaunchBox in the background: the bar in the corner shows how far it is", false);
          closeEditor();                // nothing more to do here: Done would be an extra press
          jobsWatch("emumove");
        });
      });
  }
  (res.moved || []).forEach(function (m, i) {
    if (i === 0) {
      inner.appendChild(el("h2", "bk-head", "Moved before"));
      list = el("div", "cr-list em-moved");
      inner.appendChild(list);
    }
    row(m.back ? "" : "ro", "refresh", m.name + ": go back to LaunchBox's own", m.to, m.back ? "" : "LaunchBox's own is gone", function () {
      if (!m.back) { showStrip("LaunchBox's own " + m.name + " is not there any more", true); return; }
      post({ back: m.key }).then(function (out) {
        if (!out.ok) { showStrip(out.error || "could not go back", true); return; }
        sound("ok");
        L("EMU", m.name + " -> LaunchBox's own again");
        showStrip(m.name + " starts from LaunchBox's folder again; the copy in " + m.to + " is left as it is", false);
        reloadKeeping(null);
        openEmuMove(res.dest);
      });
    });
  });
  inner.appendChild(el("p", "mt-note", "Their saves, settings and cores come along. Whatever you play from LaunchBox itself afterwards saves into LaunchBox's own copy, not this one."));

  function focusAt(i) {
    if (!cells.length) { return; }
    i = Math.max(0, Math.min(cells.length - 1, i));
    cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
    setPick({ cells: cells, at: i, move: function (d) { focusAt(i + d); }, choose: function () { acts[i](); } });
    cells[i].scrollIntoView({ block: "nearest", inline: "nearest" });
    listAt = i;
  }
  focusAt(listAt);

  // How big each one is: asked once the list is up, since measuring takes a moment.
  if (!sizes && res.rows.length) {
    api("api/emumove.php?sizes=1&dest=" + encodeURIComponent(res.dest)).then(function (s) {
      if (!s.ok || !mine() || !inner.isConnected) { return; }
      res.sizes = s.sizes;
      paintList(res, picked);
    });
  }
}

/* The copy at work, or how it ended. */
function paintJob(job) {
  var running = job.state === "running";
  var inner = frame(running ? "Copying. LaunchBox's own are only read. This window can be closed: the copy goes on, and Xsegon says when it is done."
                            : "LaunchBox's own are as they were.");
  var words = { starting: "starting", measuring: "measuring the folders", copying: "copying", checking: "checking the copy", saves: "picking up the saves beside your games", end: "" };
  var line = el("p", "em-said");
  var item = (job.items || [])[job.at || 0] || {};
  line.textContent = running
    ? (job.phase === "copying" || job.phase === "checking" ? (words[job.phase] + " " + (item.name || "") + ": " + sized(job.bytes || 0) + " of " + sized(job.total || 0)) : (words[job.phase] || "working"))
    : (job.error || job.said || "nothing was moved");
  if (!running && job.error) { line.classList.add("bad"); }
  inner.appendChild(line);
  if (running) {
    var track = el("span", "fb-track em-bar" + (job.total ? "" : " wait"));
    var fill = el("span", "fb-fill");
    fill.style.width = job.total ? Math.min(100, Math.round(100 * (job.bytes || 0) / job.total)) + "%" : "";
    track.appendChild(fill);
    inner.appendChild(track);
  }
  var list = el("div", "cr-list em-items");
  (job.items || []).forEach(function (it) {
    var row = el("div", "cr-row ro" + (it.state === "done" ? " on" : ""));
    row.appendChild(iconEl("cr-ico", it.state === "done" ? "check" : it.state === "failed" || it.state === "stopped" ? "x" : "disc"));
    row.appendChild(el("span", "cr-name", it.name));
    row.appendChild(el("span", "cr-tag", (it.state === "done" ? "now in " + it.to : it.state === "copying" ? "copying to " + it.to : it.error || it.state)
      + (it.total ? "  ·  " + sized(it.total) : "")));
    list.appendChild(row);
  });
  inner.appendChild(list);
  if (!running && job.said && job.error) { inner.appendChild(el("p", "mt-note", job.said + ".")); }
  var bar = el("div", "em-foot");
  var btn = el("button", running ? null : "primary", running ? "Stop" : "Back to the list");
  btn.addEventListener("click", function () {
    if (running) { post({ stop: true }); btn.disabled = true; btn.textContent = "Stopping after this file"; } else { openEmuMove(job.dest); }
  });
  bar.appendChild(btn);
  inner.appendChild(bar);
  setPick(null);
}

/* Followed to its end whether the window is up or not: the bar while it is, the strip when it is not. */
function follow() {
  if (watching) { return; }
  watching = true;
  (function again() {
    api("api/emumove.php").then(function (res) {
      var job = res.ok ? res.job : null;
      if (job && job.state === "running") {
        if (mine() && $editor.querySelector(".em-items")) { paintJob(job); }
        setTimeout(again, 700);
        return;
      }
      watching = false;
      if (!job) { return; }
      L("EMU", "move out of LaunchBox ended: " + job.state + (job.said ? " (" + job.said + ")" : "") + (job.error ? " (" + job.error + ")" : ""));
      if (job.state === "done") { sound("ok"); }
      if (job.said) { reloadKeeping(null); }             // what starts each game has changed
      if (mine() && $editor.querySelector(".em-items")) { paintJob(job); }
      else if (jobSayOnce("emumove", job.started)) { showStrip(job.error || job.said || "nothing was moved", !!job.error); }   // once, whoever sees the end first
    });
  })();
}
