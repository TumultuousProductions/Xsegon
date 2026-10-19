import { openDetails } from "./details.js";
import { dropExtPage } from "./extensions.js";
import { dropFanPage } from "./fanprojects.js";
import { paintHelp } from "./help.js";
import { iconEl } from "./icons.js";
import { pick, setPick, showStrip } from "./launch.js";
import { fillPlatforms, load, setCollectionsAll, setPlatformsAll, setPlatformsFilled } from "./library.js";
import { L, api, logWarn, postJson } from "./log.js";
import { browseOnly } from "./scan.js";
import { redrawIfClear } from "./settings-save.js";
import { ROW_ICONS } from "./settings-ui.js";
import { armBrowse, stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $btnSystems, $details, $editor, $main, $platform, $syswall, $toolbar, games, hasGamesDb, hasLaunchBox, sel, setSel, setSysStage } from "./state.js";
import { el } from "./util.js";
import { render, row, setCarNodes, setWheelNodes } from "./views.js";

// ---------- edit metadata ----------
/* What you change here is saved in Xsegon (data\overrides.json) and laid over
   the imported values, whose files are never written: each edited field's label shows
   the value underneath and "reset" puts it back. A scanned game uses the same form,
   saying "the scan" where it would say "the import" (full.origin, from api\game.php).
   A game of your own has its own form, since its record IS the source. */

var EDIT_FIELDS = [
  { key: "title",     label: "Title" },
  { key: "sortTitle", label: "Sort title", hint: "How it is ordered, e.g. \"Legend of Zelda, The\"" },
  { key: "developer", label: "Developer" },
  { key: "publisher", label: "Publisher" },
  { key: "genre",     label: "Genre" },
  { key: "released",  label: "Release date", hint: "YYYY, YYYY-MM or YYYY-MM-DD" },
  { key: "rating",    label: "Rating", type: "number", hint: "0 to 5" },
  { key: "players",   label: "Players", type: "count", hint: "How many at once. 2 or more puts it in Two players or more; blank means unknown" },
  { key: "playMode",  label: "Play mode" },
  { key: "region",    label: "Region" },
  { key: "notes",     label: "Description", type: "long" }
];

export var editorOnClose = null;
export function setEditorOnClose(fn) { editorOnClose = fn; }

export function closeEditor() {
  if ($editor.hidden) { setPick(null); return; }   // a list left holding the keys with no window to show it
  L("ED", "close " + ((($editor.querySelector(".panel-title") || {}).textContent) || "").toLowerCase());
  // A <video> taken out of the page keeps playing its sound; stop it first.
  $editor.querySelectorAll("video").forEach(function (v) { try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) { /* fine */ } });
  $editor.hidden = true;
  $editor.textContent = "";
  delete $editor.dataset.tool;           // no tool's timer may bring the panel back
  setPick(null);                       // the state picker, if that is what was up
  sound("back");
  var after = editorOnClose;
  editorOnClose = null;
  if (after) { after(); }
  armBrowse();
  redrawIfClear();                         // settings saved before a window reached through Settings (js\settings-save.js)
}

// After a save the rows are re-read; stay on the game that was edited even
// if its new title sorts it somewhere else.
export function reloadKeeping(id) {
  return load().then(function () {
    for (var i = 0; i < games.length; i++) {
      if (games[i].id === id) { setSel(i); break; }
    }
    setWheelNodes(null);
    setCarNodes(null);
    render();
    if (!$details.hidden && games[sel]) { openDetails(); }
  });
}

export function openEditor(g) {
  L("ED", "metadata " + g.title);
  stopVideo();
  editorOnClose = null;
  api("api/game.php?id=" + encodeURIComponent(g.id)).then(function (res) {
    if (!res.ok) { showStrip("could not read that game: " + (res.error || ""), true); return; }
    var full = res.game, edited = full.edited || [], source = full.source || {};
    var toReset = {};

    /* Whose values the reset buttons put back (api\game.php sets origin): a scanned
       game has no imported value, only the title read off the file name. */
    var scanned = full.origin === "scanned";
    var whose = scanned ? "the scan" : "the import";

    var inner = toolFrame("EDIT METADATA", { close: "Cancel (esc)" });
    inner.appendChild(el("p", "group-help", full.platform + "  ·  " + (scanned
      ? "Found by Scan for Games, so the title came from the file name and the rest is yours to fill in. Saved in Xsegon only, and a rescan keeps your edits."
      : "Saved in Xsegon only. The imported library's files are never changed, and a re-import keeps your edits.")));

    var form = el("div", "ed-form");
    var inputs = {};
    var initial = {};

    EDIT_FIELDS.forEach(function (f) {
      var rowEl = el("div", "opt ed-row" + (f.type === "long" ? " ed-long" : ""));
      var label = el("label");
      label.appendChild(document.createTextNode(f.label));

      var input = f.type === "long" ? el("textarea") : el("input");
      if (f.type === "number") { input.type = "number"; input.min = 0; input.max = 5; input.step = 0.1; }
      else if (f.type === "count") { input.type = "number"; input.min = 1; input.max = 64; input.step = 1; }
      else if (f.type !== "long") { input.type = "text"; }
      if (f.type === "long") { input.rows = 7; }
      input.spellcheck = f.type === "long";
      var cur = full[f.key];
      if (f.type === "count" && !Number(cur)) { cur = null; }   // 0 is LaunchBox for "nobody said"
      input.value = (cur === null || cur === undefined) ? ""
                  : (f.key === "rating" ? String(Math.round(cur * 10) / 10) : String(cur));
      inputs[f.key] = input;
      initial[f.key] = input.value;

      var wasEdited = edited.indexOf(f.key) !== -1;
      if (wasEdited) {
        var was = source[f.key];
        if (f.type === "count" && !Number(was)) { was = null; }   // LaunchBox's 0: nobody said
        var hint = el("span", "hint ed-was", whose + ": " + ((was === null || was === undefined || was === "") ? "(empty)" : String(was).slice(0, 90)));
        var back = el("button", "ed-reset", "reset");
        back.type = "button";
        back.addEventListener("click", function () {
          toReset[f.key] = true;
          input.value = (was === null || was === undefined) ? "" : String(was);
          rowEl.classList.remove("ed-edited");
          hint.textContent = scanned ? "will go back to what the scan found, on save"
                                     : "will go back to the imported value on save";
          back.remove();
        });
        hint.appendChild(document.createTextNode(" "));
        hint.appendChild(back);
        label.appendChild(hint);
        rowEl.classList.add("ed-edited");
      } else if (f.hint) {
        label.appendChild(el("span", "hint", f.hint));
      }
      // Typing in a field you reset means you changed your mind again.
      input.addEventListener("input", function () { delete toReset[f.key]; });

      rowEl.appendChild(label);
      rowEl.appendChild(input);
      form.appendChild(rowEl);
    });
    inner.appendChild(form);

    var foot = el("div", "set-foot");
    var save = el("button", "primary", "Save");
    var err = el("span", "ed-err");
    save.addEventListener("click", function () {
      var set = {};
      EDIT_FIELDS.forEach(function (f) {
        if (toReset[f.key]) { return; }
        // Only what was actually typed over. Sending every field back would
        // turn a displayed value (a rounded rating, a sort title that was
        // following the title) into an edit nobody made.
        if (inputs[f.key].value === initial[f.key]) { return; }
        set[f.key] = inputs[f.key].value;
      });
      save.disabled = true;
      postJson("api/edit.php", { id: full.id, set: set, reset: Object.keys(toReset) }).then(function (r) {
        save.disabled = false;
        if (!r.ok) { err.textContent = r.error || "could not save"; return; }
        $editor.hidden = true;
        $editor.textContent = "";
        sound("select");
        showStrip(r.edited.length ? ("saved: " + r.edited.length +
                                     (r.edited.length === 1 ? " field differs from " : " fields differ from ") + whose)
                                  : ("saved: matches " + whose + " again"), false);
        reloadKeeping(full.id);
      });
    });
    foot.appendChild(save);

    // The LaunchBox Games Database, read from the local copy. Fills only EMPTY
    // fields; a filled one keeps its value, with the database's shown beside it.
    // Nothing is saved until Save.
    var fill = el("button", null, "Fill empty fields from the Games Database");
    var DB_FIELDS = { developer: "developer", publisher: "publisher", genre: "genre", released: "released", rating: "rating", players: "players", notes: "notes" };
    fill.addEventListener("click", function () {
      fill.disabled = true;
      err.textContent = "";
      api("api/gamesdb.php?id=" + encodeURIComponent(full.id) + "&what=game").then(function (r) {
        fill.disabled = false;
        if (!r.ok) { err.textContent = r.error || "could not read the database"; return; }
        if (r.unmatched) { pickMatch(); return; }
        applyDb(r.game);
      });
    });

    // A game LaunchBox never matched: search the database by name, click
    // the right one, and the match is kept (api\gamesdb.php?link=) so
    // Change Pictures > Find online knows it too.
    function pickMatch() {
      var old = inner.querySelector(".ed-match");
      if (old) { old.remove(); }
      var box = el("div", "ed-match");
      box.appendChild(el("p", "mt-note", scanned
        ? "Nothing has matched this game to the database yet: Xsegon found it on the disk, and the title is the file name. Which is it?"
        : "LaunchBox never matched this game to its database. Which is it?"));
      var row = el("div", "pk-search");
      var q = el("input");
      q.type = "text";
      q.value = inputs.title.value;
      var go = el("button", "primary", "Search");
      row.appendChild(q);
      row.appendChild(go);
      box.appendChild(row);
      var results = el("div", "pk-results");
      box.appendChild(results);
      function run() {
        results.textContent = "searching...";
        api("api/gamesdb.php?id=" + encodeURIComponent(full.id) + "&what=search&q=" + encodeURIComponent(q.value)).then(function (r) {
          results.textContent = "";
          if (!r.ok) { results.textContent = r.error || "search failed"; return; }
          if (!r.results.length) { results.textContent = "nothing matched"; return; }
          r.results.forEach(function (m) {
            var line = el("div", "pk-result" + (m.platform === full.platform ? " same" : ""));
            line.appendChild(el("span", "t", m.title));
            line.appendChild(el("span", "p", m.platform + (m.year ? "  ·  " + m.year : "")));
            line.addEventListener("click", function () {
              api("api/gamesdb.php?id=" + encodeURIComponent(full.id) + "&link=" + m.id, { method: "POST" }).then(function (l) {
                if (!l.ok) { results.textContent = l.error || "could not keep that match"; return; }
                box.remove();
                api("api/gamesdb.php?id=" + encodeURIComponent(full.id) + "&what=game").then(function (r2) {
                  if (r2.ok && r2.game) { applyDb(r2.game); }
                });
              });
            });
            results.appendChild(line);
          });
        });
      }
      go.addEventListener("click", run);
      q.addEventListener("keydown", function (e) { if (e.key === "Enter") { run(); } e.stopPropagation(); });
      foot.parentNode.insertBefore(box, foot);
      run();
    }

    function applyDb(d) {
      {
        var filled = 0, shown = 0;
        Object.keys(DB_FIELDS).forEach(function (k) {
          var v = d[DB_FIELDS[k]];
          if (v === null || v === undefined || v === "") { return; }
          v = String(v);
          var input = inputs[k];
          if (input.value.trim() === "") {
            input.value = v;
            delete toReset[k];
            input.dispatchEvent(new Event("input"));
            filled++;
            return;
          }
          if (input.value !== v && !input.parentNode.querySelector(".ed-db")) {
            var hint = el("span", "hint ed-db", "database: " + v.slice(0, 90));
            var use = el("button", "ed-reset", "use");
            use.type = "button";
            use.addEventListener("click", function () { input.value = v; input.dispatchEvent(new Event("input")); hint.remove(); });
            hint.appendChild(document.createTextNode(" "));
            hint.appendChild(use);
            input.parentNode.querySelector("label").appendChild(hint);
            shown++;
          }
        });
        err.textContent = (filled ? filled + " empty field" + (filled === 1 ? "" : "s") + " filled" : "nothing was empty") +
                          (shown ? ", " + shown + " differ" + (shown === 1 ? "s" : "") + " (shown beside the field)" : "") +
                          ". Press Save to keep it.";
        err.classList.add("ok");
      }
    }
    if (hasGamesDb) { foot.appendChild(fill); }   // the Games Database Xsegon carries

    if (edited.length) {
      var all = el("button", null, scanned ? "Reset all to what the scan found" : "Reset all to the imported values");
      all.addEventListener("click", function () {
        postJson("api/edit.php", { id: full.id, reset: "all" }).then(function (r) {
          if (!r.ok) { err.textContent = r.error || "could not reset"; return; }
          $editor.hidden = true;
          $editor.textContent = "";
          showStrip(scanned ? "back to what the scan found" : "back to the imported values", false);
          reloadKeeping(full.id);
        });
      });
      foot.appendChild(all);
    }
    foot.appendChild(err);
    inner.appendChild(foot);

    $editor.appendChild(inner);
    $editor.hidden = false;
    sound("select");
    inputs.title.focus();
    inputs.title.select();
  });
}

/* A game of your own: add one, or change one. Title, platform (an existing
   console or a new name), and what Play does: run a program or file, or
   open a web address. Saved to data\local-games.json (api\local.php), which
   you can also edit by hand. Pictures and a snap are added afterwards
   through Change Pictures and Replace Video, like any game. */
/* onBack, when given, is where Back goes instead of closing: the + button's
   chooser hands it in, so a wrong turn there costs one press. */
export function openLocalEditor(g, onBack) {
  L("ED", g ? "own game " + g.title : "add own game");
  stopVideo();
  editorOnClose = null;
  api("api/local.php" + (g ? "?id=" + encodeURIComponent(g.id) : "")).then(function (res) {
    if (!res.ok) { showStrip("could not read your games: " + (res.error || ""), true); return; }
    var cur = g ? res.game : {};
    // The platform list comes with the plain listing, not the one-game answer.
    var unknownName = "Unknown";
    var platforms = res.platforms ? Promise.resolve(res.platforms)
                                  : api("api/local.php").then(function (r) { unknownName = r.unknown || unknownName; return r.platforms || []; });
    if (res.unknown) { unknownName = res.unknown; }
    platforms.then(function (names) {
      $editor.textContent = "";
      var inner = el("div", "panel-inner ed-inner");
      var head = el("div", "set-head");
      head.appendChild(el("h1", "panel-title", g ? "EDIT GAME" : "ADD A GAME OF YOUR OWN"));
      if (onBack) {
        var back = el("button", null, "‹ Back");
        back.addEventListener("click", function () { onBack(); });
        head.appendChild(back);
      }
      var closeX = el("button", null, "Cancel (esc)");
      closeX.addEventListener("click", closeEditor);
      head.appendChild(closeX);
      inner.appendChild(head);
      inner.appendChild(el("p", "group-help",
        (hasLaunchBox ? "A game that is not in the imported library: " : "A game of your own: ") + "something you made, a web game you host, a program on this PC. " +
        "Only a title and one way to play are needed; anything left blank stays blank, and a game with no " +
        "platform is filed under " + unknownName + ". Saved in Xsegon only."));

      var form = el("div", "ed-form");
      var inputs = {};
      function row(key, label, type, hint, value) {
        var r = el("div", "opt ed-row" + (type === "long" ? " ed-long" : ""));
        var l = el("label");
        l.appendChild(document.createTextNode(label));
        if (hint) { l.appendChild(el("span", "hint", hint)); }
        var input;
        if (type === "long") { input = el("textarea"); input.rows = 5; }
        else if (type === "platform") {
          /* A dropdown of what exists, plus "Unknown" for something that is not
             a console (blank is filed there too) and "New platform...", which
             opens a box to name one; the name goes in the file as typed. */
          var box = el("div", "plat-pick");
          var pick = el("select");
          var custom = el("input");
          var opts = [["", unknownName + "  (not filed under a console)"]]
                     .concat(names.filter(function (n) { return n !== unknownName; })
                                  .map(function (n) { return [n, n]; }))
                     .concat([["__new", "New platform..."]]);
          opts.forEach(function (p) {
            var o = el("option", null, p[1]);
            o.value = p[0];
            pick.appendChild(o);
          });
          custom.type = "text";
          custom.placeholder = "a name of your own, such as Web or Windows";
          custom.hidden = true;
          pick.addEventListener("change", function () {
            custom.hidden = pick.value !== "__new";
            if (!custom.hidden) { custom.focus(); }
          });
          // Editing a game already filed somewhere: start on that entry. A
          // name the list has never heard of is typed into the new box.
          if (value) {
            pick.value = String(value);
            if (pick.value !== String(value)) {
              pick.value = "__new";
              custom.hidden = false;
              custom.value = String(value);
            }
          }
          box.appendChild(pick);
          box.appendChild(custom);
          // What the save reads: "__new" means whatever is in the box, and
          // an empty box says the same as saying nothing at all.
          inputs[key] = { get value() { return pick.value === "__new" ? custom.value : pick.value; } };
          r.appendChild(l);
          r.appendChild(box);
          form.appendChild(r);
          return inputs[key];
        } else {
          input = el("input");
          input.type = type === "number" ? "number" : "text";
          // The limits belong to the field, not the type: a rating is 0 to 5 in
          // tenths, players are whole numbers up to 64.
          if (type === "number") { input.min = 0; input.max = 5; input.step = 0.1; }
          if (type === "count") {
            input.type = "number";
            input.min = 1; input.max = 64; input.step = 1;
          }
          if (type === "path") { input.className = "path"; input.spellcheck = false; }
        }
        input.value = value === null || value === undefined ? "" : String(value);
        inputs[key] = input;
        r.appendChild(l);
        // A program is chosen in the Windows window, never typed (js/scan.js).
        r.appendChild(type === "path" ? browseOnly(input, { kind: "file", title: "Choose the program or file to run", clear: true }) : input);
        form.appendChild(r);
        return input;
      }
      row("title", "Title", "text", "", cur.title);
      row("platform", "Platform", "platform", "a console you have, a new name of your own, or leave it Unknown", cur.platform);
      row("run", "Run this program or file", "path", "for example C:\\Games\\Mine\\game.exe. Leave blank for a web game", cur.run);
      row("args", "Arguments", "text", "optional, passed to the program", cur.args);
      // A Steam game (Games > Add Steam games): its own program, for
      // right-click > Play without Steam. Play itself goes through Steam.
      if (cur.steamId) {
        row("steamExe", "Without Steam, run", "path", "the game's own program, for right-click > Play without Steam when Steam or the internet is down", cur.steamExe);
      }
      row("url", "Or open this web address", "text", "for example http://127.0.0.1:8090/ . Leave blank for a program", cur.url);
      row("developer", "Developer", "text", "", cur.developer);
      row("publisher", "Publisher", "text", "", cur.publisher);
      row("genre", "Genre", "text", "", cur.genre);
      row("released", "Release date", "text", "YYYY, YYYY-MM or YYYY-MM-DD", cur.released);
      row("rating", "Rating", "number", "0 to 5", cur.rating);
      row("players", "Players", "count", "how many at once. 2 or more puts it in the Two players collection; blank means unknown", cur.players);
      row("notes", "Description", "long", "", cur.notes);
      inner.appendChild(form);

      var foot = el("div", "set-foot");
      var save = el("button", "primary", g ? "Save" : "Add");
      var err = el("span", "ed-err");
      save.addEventListener("click", function () {
        var set = {};
        Object.keys(inputs).forEach(function (k) { set[k] = inputs[k].value; });
        save.disabled = true;
        postJson("api/local.php", g ? { id: g.id, set: set } : { set: set })
          .then(function (r) {
            save.disabled = false;
            if (!r.ok) { err.textContent = r.error || "could not save"; return; }
            $editor.hidden = true;
            $editor.textContent = "";
            sound("select");
            showStrip((r.added ? "added: " : "saved: ") + r.game.title + "  (" + r.game.platform + ")" +
                      (r.noPlatform ? ", no platform given" : ""), false);
            // A new platform name needs to be in the dropdown before it can
            // be chosen; then open on the game inside its platform.
            refillPlatforms().then(function () {
              $platform.value = r.game.platform;
              // From the consoles screen (the + in the masthead) this lands
              // inside the new game's platform; the Back button applies.
              dropFanPage();             // the + pressed over the Fan projects page: what it covered is where it lands
              dropExtPage();             // or over the Extensions page
              if ($syswall && !$syswall.hidden) {
                setSysStage("inside");
                $syswall.hidden = true;
                $main.hidden = false;
                $toolbar.hidden = false;
                $btnSystems.hidden = false;
                paintHelp("inside");
              }
              reloadKeeping(r.game.id);
            });
          });
      });
      foot.appendChild(save);
      foot.appendChild(err);
      inner.appendChild(foot);
      $editor.appendChild(inner);
      $editor.hidden = false;
      sound("select");
      inputs.title.focus();
    });
  });
}

/* Not really a game (a readme, a firmware file): take it off every view.
   An overlay in data\hidden.json; the imported library is not touched, and Settings >
   Library lists what is hidden with a Show again button. */
export function hideGame(g) {
  L("HIDE", g.title);
  postJson("api/hide.php", { id: g.id, hide: true }).then(function (r) {
    if (!r.ok) { showStrip("could not hide: " + (r.error || ""), true); return; }
    sound("back");
    showStrip("hidden: " + r.title + "  (Settings > Library brings it back)", false);
    var keepSel = sel;
    refillPlatforms().then(load).then(function () { setSel(Math.min(keepSel, Math.max(0, games.length - 1))); render(); });
  });
}

// The platform dropdown is filled once; a change to what platforms exist
// (a game hidden, a game of yours added) rebuilds it, keeping the choice.
function refillPlatforms() {
  var was = $platform.value;
  setPlatformsFilled(false);
  return api("api/library.php?platform=" + encodeURIComponent("@none")).then(function (d) {
    if (!d.ok) {
      // Not truncated before the read: a failed read keeps the old list.
      logWarn("the console dropdown could not be refilled: " + (d.error || "no answer"));
      return;
    }
    $platform.length = 1;
    if (d.platforms) { setPlatformsAll(d.platforms); }
    if (d.collections) { setCollectionsAll(d.collections); }
    fillPlatforms(d.platforms);
    $platform.value = was;
    if ($platform.value !== was) { $platform.value = ""; }
  });
}

export function paintHiddenList(page) {
  var box = el("div", "opt hidden-list");
  box.appendChild(iconEl("opt-ico", ROW_ICONS.list));
  var l = el("label");
  l.appendChild(document.createTextNode("Hidden from Xsegon"));
  l.appendChild(el("span", "hint", "Right-click a game > Hide from Xsegon puts it here." + (hasLaunchBox ? " The imported library is not changed." : "")));
  box.appendChild(l);
  box.dataset.find = "hidden from xsegon show again library";
  var list = el("div", "hl-list", "reading...");
  box.appendChild(list);
  page.appendChild(box);
  api("api/hide.php").then(function (r) {
    list.textContent = "";
    if (!r.ok || !r.hidden.length) { list.textContent = "nothing is hidden"; return; }
    r.hidden.forEach(function (h) {
      var line = el("div", "hl-row");
      line.appendChild(el("span", "t", h.title + (h.platform ? "  (" + h.platform + ")" : "")));
      var back = el("button", null, "Show again");
      back.addEventListener("click", function () {
        postJson("api/hide.php", { id: h.id, hide: false }).then(function (r2) {
          if (!r2.ok) { showStrip("could not show it: " + (r2.error || ""), true); return; }
          line.remove();
          if (!list.children.length) { list.textContent = "nothing is hidden"; }
          refillPlatforms().then(load);
        });
      });
      line.appendChild(back);
      list.appendChild(line);
    });
  });
}

/* Games deleted from Xsegon (api\deleted.php), under the hidden ones: Put back brings
   one in again with its stars, edits and pictures, which were kept. Newest first. */
export function paintDeletedList(page) {
  var box = el("div", "opt hidden-list");
  box.appendChild(iconEl("opt-ico", ROW_ICONS.list));
  var l = el("label");
  l.appendChild(document.createTextNode("Deleted from Xsegon"));
  l.appendChild(el("span", "hint", "Right-click a game > Delete from Xsegon, and Games > Missing Games, put games here."
    + " Put back brings one in again with its stars, edits and pictures. No file on the disk was deleted."));
  box.appendChild(l);
  box.dataset.find = "deleted from xsegon put back library";
  box.dataset.land = "deleted";            // where Scan for Games' press lands (openSettingAt)
  var list = el("div", "hl-list", "reading...");
  box.appendChild(list);
  page.appendChild(box);
  api("api/deleted.php").then(function (r) {
    list.textContent = "";
    if (!r.ok) { list.textContent = "the list could not be read: " + (r.error || "no answer"); return; }
    L("ED", "Settings > Library lists " + r.deleted.length + " deleted from Xsegon");
    if (!r.deleted.length) { list.textContent = "nothing is deleted"; return; }
    r.deleted.slice().reverse().forEach(function (d) {
      var line = el("div", "hl-row");
      line.appendChild(el("span", "t", d.title + (d.platform ? "  (" + d.platform + ")" : "")));
      line.title = (d.rom || "") + (d.at ? "  ·  deleted " + String(d.at).slice(0, 10) : "");
      var back = el("button", null, "Put back");
      back.addEventListener("click", function () {
        back.disabled = true;
        postJson("api/deleted.php", { action: "restore", id: d.id }).then(function (r2) {
          if (!r2.ok) { back.disabled = false; showStrip("could not put it back: " + (r2.error || ""), true); return; }
          L("ED", "put back " + d.title + " (" + d.platform + ", " + d.id + ")");
          sound("select");
          line.remove();
          if (!list.children.length) { list.textContent = "nothing is deleted"; }
          refillPlatforms().then(load);
        });
      });
      line.appendChild(back);
      list.appendChild(line);
    });
  });
}

export function removeLocal(g) {
  if (!window.confirm("Remove \"" + g.title + "\" from Xsegon? Its pictures and play history stay on disk.")) { return; }
  postJson("api/local.php", { id: g.id, remove: true }).then(function (r) {
    if (!r.ok) { showStrip("could not remove: " + (r.error || ""), true); return; }
    sound("back");
    showStrip("removed: " + r.removed, false);
    refillPlatforms().then(load);
  });
}

/* The frame a tool's window has: the panel, its title, and the button that
   closes it. What a tool has of its own is asked for, so the frame is written once:
     base    the panel's kind, when not "ed-inner"
     cls     a class of its own on the panel
     close   the closing button's words, when not "Done (esc)" (which alone is the primary one)
     primary whether the closing button is the primary one, when its words do not say
     before  buttons that stand before it: [{ label, run }], a Back or the tool beside this one
     keep    what is in the window stays: the caller swaps the old panel for this one itself */
export function toolFrame(title, opts) {
  opts = opts || {};
  if (!opts.keep) { $editor.textContent = ""; }
  var inner = el("div", "panel-inner " + (opts.base || "ed-inner") + (opts.cls ? " " + opts.cls : ""));
  var head = el("div", "set-head");
  head.appendChild(el("h1", "panel-title", title));
  (opts.before || []).forEach(function (b) {
    var extra = el("button", null, b.label);
    extra.addEventListener("click", b.run);
    head.appendChild(extra);
  });
  var words = opts.close || "Done (esc)";
  var main = opts.primary === undefined ? words === "Done (esc)" : opts.primary;
  var shut = el("button", main ? "primary" : null, words);
  shut.addEventListener("click", closeEditor);
  head.appendChild(shut);
  inner.appendChild(head);
  return inner;
}
