/*  The Saves tab of a game's details (js\detailtabs.js): everything saved
    for the game, in groups, as the server found it (includes\saves.php).
    One press on a RetroArch state starts the game from it. A save beside the
    game's file, or made under another core, can be put where RetroArch loads
    it (asked first when RetroArch has its own there, which is kept as a copy),
    only where RetroArch's folder is the person's own; anything else is shown in its folder. */

import { confirmWindow } from "./confirm.js";
import { closeDetails } from "./details.js";
import { setTabRows, tabPane, tabSays } from "./detailtabs.js";
import { iconEl } from "./icons.js";
import { launchNow, showStrip, whenSaved } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { showInExplorer } from "./reveal.js";
import { sound } from "./sound.js";
import { el } from "./util.js";

export function savesTabLabel(g, full) {
  var n = full ? (full.saves || 0) : 0;
  return n ? "Saves (" + n + ")" : "Saves";
}

function bytesSaid(n) {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
}

/* What a row says under its name: the file, and how it stands to the save
   RetroArch itself would load. */
function rowNote(r) {
  var said = [r.file];
  if (r.core) { said.push("kept for " + r.core); }
  if (r.key === "auto") { said.push(r.loads ? "RetroArch loads it at the next start" : "loaded only with RetroArch's auto load on"); }
  if (r.own && r.own.same) {
    said.push("the same as the one RetroArch loads");
  } else if (r.own) {
    said.push(r.own.newer ? "older than RetroArch's own, " + whenSaved(r.own.when)
                          : "newer than RetroArch's own, " + whenSaved(r.own.when));
  } else if (r.own === null) {
    said.push(r.kind === "state" ? "RetroArch has no slot " + r.slot + " of its own" : "RetroArch has no save of its own for this game");
  }
  return said.join("  ·  ");
}


function post(body) {
  return postJson("api/saves.php", body);
}

export function savesPane(pane, g) {
  api("api/saves.php?id=" + encodeURIComponent(g.id)).then(function (res) {
    if (tabPane("saves") !== pane) { return; }               // another tab, or another game, by now
    pane.textContent = "";
    if (!res.ok) { pane.appendChild(tabSays("the saves for this game could not be read")); return; }
    var inner = el("div", "ch-inner ch-tab sv-tab");
    if (res.none) { inner.appendChild(tabSays(res.none)); }
    var list = el("div", "sv-list");
    var cells = [], rows = [], at = 0;

    function showInFolder(r) {
      L("MNU", "show save " + r.key + " in its folder");
      showInExplorer({ id: g.id, what: "save", key: r.key });
    }
    /* Put where RetroArch loads it. With RetroArch's own there the server changes
       nothing and says so; then it is asked, and RetroArch's own is kept as a copy. */
    function useSave(r, replace) {
      L("MNU", "use save " + r.key + (replace ? " (in place of RetroArch's own)" : ""));
      post({ id: g.id, use: r.key, replace: !!replace }).then(function (a) {
        if (!a.ok) { showStrip(a.error || "that save could not be put in place", true); return; }
        if (a.needs === "replace") {
          confirmWindow("Use this save?", function (box) {
            box.appendChild(el("p", null, "RetroArch has a save of its own in that place, from " + whenSaved(a.own)
              + ". This one is from " + whenSaved(r.when) + "."));
            box.appendChild(el("p", null, "RetroArch's own is kept as a copy first (it is listed here under Kept copies), and the one beside the game stays where it is."));
          }, { label: "Use this save", run: function () { useSave(r, true); } }, "Keep RetroArch's");
          return;
        }
        sound("ok");
        showStrip(a.used + " is now what RetroArch loads for " + g.title + (a.kept ? "; the one it replaced is kept" : ""), false);
        savesPane(pane, g);
      });
    }
    function act(r) {
      if (r.play) {
        L("MNU", "run slot " + r.slot + " (details, saves)");
        closeDetails();
        launchNow(g, r.slot);
      } else if (r.use) {
        useSave(r, false);
      } else {
        showInFolder(r);
      }
    }
    function focusAt(i) {
      i = Math.max(0, Math.min(cells.length - 1, i));
      at = i;
      cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
      setTabRows(pane, {
        cells: cells, at: i,
        word: rows[i].play ? "play from it" : rows[i].use ? "use this save" : "show in its folder",
        move: function (d) { focusAt(at + d); },
        choose: function () { act(rows[at]); }
      });
      cells[i].scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    (res.groups || []).forEach(function (gr) {
      var sec = el("div", "sv-group");
      sec.dataset.group = gr.key;
      sec.appendChild(el("h3", "dst-head sv-head", gr.title));
      sec.appendChild(el("p", "sv-help", gr.help));
      var box = el("div", "sv-rows");
      gr.rows.forEach(function (r) {
        var line = el("div", "cr-row sv-row" + (r.play ? " sv-play" : "") + (r.use ? " sv-use" : ""));
        line.dataset.key = r.key;
        line.title = r.play ? "Play from this save" : r.use ? "Put this save where RetroArch loads it" : "Show this file in its folder";
        var fr = el("div", "sv-shot");
        if (r.play && r.shot !== null && r.shot !== undefined) {
          var img = el("img");
          img.alt = "";
          img.loading = "lazy";
          img.src = "api/states.php?id=" + encodeURIComponent(g.id) + "&shot=" + r.slot + "&t=" + r.shot;
          fr.appendChild(img);
        } else {
          fr.appendChild(iconEl("cr-ico", r.kind === "state" ? "image" : "save"));
        }
        line.appendChild(fr);
        var words = el("div", "sv-words");
        words.appendChild(el("span", "cr-name", r.name));
        words.appendChild(el("span", "sv-sub", rowNote(r)));
        line.appendChild(words);
        line.appendChild(el("span", "cr-tag", whenSaved(r.when) + (r.size ? "  ·  " + bytesSaid(r.size) : "")));
        if (r.play) { line.appendChild(iconEl("cr-ico sv-go", "play")); }
        if (r.use) {
          // The press uses it; its folder is one click away for the mouse.
          var dir = el("button", "sv-dir");
          dir.type = "button";
          dir.title = "Show this file in its folder";
          dir.appendChild(iconEl("sv-dir-ico", "folder"));
          dir.addEventListener("click", function (e) { e.stopPropagation(); showInFolder(r); });
          line.appendChild(dir);
        }
        var mine = cells.length;
        line.addEventListener("mouseenter", function () { focusAt(mine); });
        line.addEventListener("click", function () { act(r); });
        cells.push(line);
        rows.push(r);
        box.appendChild(line);
      });
      sec.appendChild(box);
      // Why a save beside the game cannot be put in place here, and what would allow it.
      if (gr.key === "beside" && !res.canUse && res.cannot) { sec.appendChild(el("p", "sv-help sv-cannot", res.cannot.charAt(0).toUpperCase() + res.cannot.slice(1) + ".")); }
      if (gr.where) { sec.appendChild(el("p", "sv-where", gr.where)); }
      list.appendChild(sec);
    });
    if (cells.length) { inner.appendChild(list); }
    pane.appendChild(inner);
    if (cells.length) { focusAt(0); } else { setTabRows(pane, null); }
  });
}
