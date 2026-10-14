/*  Taking games out of the library, and the tidy-up screen for the ones
 *  whose files are gone.
 *
 *    One game   right-click > Delete from Xsegon..., a dialog with a button you have to mean.
 *    Many games Games > Missing Games: only games whose files are ALREADY gone, nothing
 *               selected when it opens, and the last step makes you type the number. It
 *               stays off the right-click menu, where a bulk delete would happen by accident.
 *
 *  Neither ever touches a file on the disk, and every screen says so.
 */

import { reloadKeeping, setEditorOnClose, toolFrame } from "./editors.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { sound } from "./sound.js";
import { $editor, games, sel } from "./state.js";
import { closeOnBackdrop, el } from "./util.js";

/* ---------- one game ---------- */

export function confirmDelete(g) {
  L("ED", "delete asked " + g.title);
  var wrap = el("div", "confirm-wrap");
  var box = el("div", "confirm");
  box.appendChild(el("h2", null, "Delete from Xsegon?"));
  box.appendChild(el("p", "confirm-game", g.title + "  (" + g.platform + ")"));
  box.appendChild(el("p", null,
    "This takes the game out of your library: off the wall, out of the counts, " +
    "out of every view."));
  box.appendChild(el("p", "confirm-safe",
    "It does NOT delete the file from your disk. Nothing on the ROM drive is touched."));
  box.appendChild(el("p", "confirm-note",
    "Your stars, edits and pictures for it are kept, so putting it back " +
    "(Settings > Library) gets all of it. If you only want it out of sight, " +
    "Hide from Xsegon is the gentler one."));

  var bar = el("div", "confirm-bar");
  var no = el("button", null, "Keep it");
  no.addEventListener("click", function () { close(); });
  var yes = el("button", "danger", "Delete from Xsegon");
  yes.addEventListener("click", function () {
    yes.disabled = true;
    yes.textContent = "Deleting...";
    postJson("api/deleted.php", { action: "delete", ids: [g.id], confirm: "1" })
      .then(function (r) {
        close();
        if (!r.ok) { showStrip("could not delete it: " + (r.error || ""), true); return; }
        sound("select");
        showStrip("deleted " + g.title + " from Xsegon", false);
        reloadKeeping(null);
      });
  });
  bar.appendChild(no);
  bar.appendChild(yes);
  box.appendChild(bar);
  wrap.appendChild(box);
  document.body.appendChild(wrap);

  function close() {
    if (wrap.parentNode) { wrap.parentNode.removeChild(wrap); }
    document.removeEventListener("keydown", key, true);
  }
  function key(e) {
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); sound("back"); }
  }
  document.addEventListener("keydown", key, true);
  closeOnBackdrop(wrap, close);                 // the press decides, not the release
  no.focus();
  sound("select");
}

/* ---------- the tidy-up screen ---------- */

export function openMissingTool() {
  L("ED", "missing games");
  var picked = {};

  function paint() {
    var inner = toolFrame("MISSING GAMES");
    $editor.appendChild(inner);
    $editor.hidden = false;

    return api("api/deleted.php?missing=1").then(function (res) {
      if ($editor.dataset.tool !== "missing") { return; }
      var body = toolFrame("MISSING GAMES", { keep: true });

      if (!res.ok) {
        body.appendChild(el("p", "mt-note bad", res.error || "could not look"));
        $editor.textContent = "";
        $editor.appendChild(body);
        return;
      }

      body.appendChild(el("p", "group-help",
        "Games your library lists whose file is not on the disk any more. They still " +
        "show on the wall and say what is wrong when you open them; this is where you " +
        "tidy them out if you want to."));
      body.appendChild(el("p", "group-help",
        "Deleting takes the entry out of Xsegon. It never deletes anything from your " +
        "disk: these files are already gone. Nothing is selected to begin with."));

      // A games folder that is not there right now: its games
      // are away, not missing, and are left off this list.
      (res.away || []).forEach(function (a) {
        body.appendChild(el("p", "mt-note bad", a.folder + " is not there right now, so its " + a.games +
          (a.games === 1 ? " game is" : " games are") + " left off this list. Plug it in, or take the folder out in Scan for Games."));
      });

      if (!res.missing.length) {
        body.appendChild(el("p", "mt-note good", "Every game in your library has its file. Nothing to tidy."));
        $editor.textContent = "";
        $editor.appendChild(body);
        return;
      }

      var boxes = [];
      var rows = el("div", "sc-rows");
      res.missing.forEach(function (m) {
        var rowEl = el("label", "sc-row");
        var c = el("input");
        c.type = "checkbox";
        c.checked = !!picked[m.id];
        c.addEventListener("change", function () {
          picked[m.id] = c.checked;
          paintCount();
        });
        rowEl.appendChild(c);
        rowEl.appendChild(el("span", "sc-title", m.title + (m.favourite ? "  ★" : "") +
                             (m.plays ? "  · played " + m.plays + (m.plays === 1 ? " time" : " times") : "")));
        rowEl.appendChild(el("span", "sc-rom", m.platform + "  ·  " + m.rom));
        rows.appendChild(rowEl);
        boxes.push({ box: c, game: m });
      });
      body.appendChild(rows);

      var all = el("button", null, "Select all " + res.missing.length);
      all.addEventListener("click", function () {
        boxes.forEach(function (b) { b.box.checked = true; picked[b.game.id] = true; });
        paintCount();
      });
      var none = el("button", null, "Deselect all");
      none.addEventListener("click", function () {
        boxes.forEach(function (b) { b.box.checked = false; picked[b.game.id] = false; });
        paintCount();
      });
      var btns = el("div", "art-btns");
      btns.appendChild(all);
      btns.appendChild(none);
      var go = el("button", "danger", "Delete the selected ones...");
      go.addEventListener("click", function () {
        var ids = boxes.filter(function (b) { return b.box.checked; }).map(function (b) { return b.game.id; });
        if (!ids.length) { showStrip("nothing is selected", true); return; }
        confirmMany(ids, boxes.filter(function (b) { return b.box.checked; }).map(function (b) { return b.game; }));
      });
      btns.appendChild(go);
      body.appendChild(btns);
      var count = el("p", "mt-note");
      body.appendChild(count);

      function paintCount() {
        var n = boxes.filter(function (b) { return b.box.checked; }).length;
        count.textContent = n ? n + (n === 1 ? " game selected" : " games selected") : "Nothing selected.";
        go.disabled = !n;
      }
      paintCount();

      $editor.textContent = "";
      $editor.appendChild(body);
    });
  }

  /* The last gate. Typing the number is not theatre: it is the one step that
     cannot be satisfied by a repeated press, a held key or a click landing
     on a screen that changed underneath you. The server asks for the same
     number, so a page that skipped this would still be refused. */
  function confirmMany(ids, rows) {
    var wrap = el("div", "confirm-wrap");
    var box = el("div", "confirm");
    box.appendChild(el("h2", null, "Delete " + ids.length + (ids.length === 1 ? " game" : " games") + " from Xsegon?"));
    rows.slice(0, 8).forEach(function (r) {
      box.appendChild(el("p", "confirm-game", r.title + "  (" + r.platform + ")"));
    });
    if (rows.length > 8) { box.appendChild(el("p", "confirm-game", "and " + (rows.length - 8) + " more")); }
    box.appendChild(el("p", "confirm-safe",
      "This does NOT delete anything from your disk. These files are already gone; " +
      "this takes their entries out of Xsegon."));
    box.appendChild(el("p", null, "Type " + ids.length + " to confirm:"));
    var typed = el("input");
    typed.type = "text";
    typed.className = "confirm-type";
    typed.autocomplete = "off";
    box.appendChild(typed);

    var bar = el("div", "confirm-bar");
    var no = el("button", null, "Cancel");
    no.addEventListener("click", function () { close(); });
    var yes = el("button", "danger", "Delete " + ids.length);
    yes.disabled = true;
    typed.addEventListener("input", function () {
      yes.disabled = typed.value.trim() !== String(ids.length);
    });
    yes.addEventListener("click", function () {
      yes.disabled = true;
      yes.textContent = "Deleting...";
      postJson("api/deleted.php", { action: "delete", ids: ids, confirm: String(ids.length) })
        .then(function (r) {
          close();
          if (!r.ok) { showStrip("could not delete them: " + (r.error || ""), true); return; }
          sound("select");
          showStrip("deleted " + r.deleted + (r.deleted === 1 ? " game" : " games") + " from Xsegon", false);
          picked = {};
          paint();
        });
    });
    bar.appendChild(no);
    bar.appendChild(yes);
    box.appendChild(bar);
    wrap.appendChild(box);
    document.body.appendChild(wrap);

    function close() {
      if (wrap.parentNode) { wrap.parentNode.removeChild(wrap); }
      document.removeEventListener("keydown", key, true);
    }
    function key(e) {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); sound("back"); }
    }
    document.addEventListener("keydown", key, true);
    closeOnBackdrop(wrap, close);                 // the press decides, not the release
    typed.focus();
    sound("select");
  }

  $editor.dataset.tool = "missing";
  setEditorOnClose(function () {
    delete $editor.dataset.tool;
    reloadKeeping(games[sel] ? games[sel].id : null);
  });
  paint().then(function () { sound("select"); });
}
