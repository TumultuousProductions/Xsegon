import { confirmWindow } from "./confirm.js";
import { reloadKeeping, setEditorOnClose, toolFrame } from "./editors.js";
import { pick, showStrip } from "./launch.js";
import { load, setPlatformArtRev } from "./library.js";
import { L, api, postJson } from "./log.js";
import { snapVolume, stopVideo } from "./snap.js";
import { muted, sound } from "./sound.js";
import { $editor, hasGamesDb } from "./state.js";
import { renderSystems } from "./systems.js";
import { el, namesAnd, plural } from "./util.js";
import { row } from "./views.js";

// ---------- replace images ----------
/* Four slots: box art, clear logo, screenshot, fanart. A file picked or dropped on a
   slot replaces that image in Xsegon only (data\art); "Reset" deletes the replacement.
   Sent in pieces, since PHP caps a request's size, and checked whole on the server. */

var ART_PIECE = 3 * 1024 * 1024;

// The open Change Pictures' listener, so opening it again (on another game)
// replaces it rather than leaving the last game's answering too.
var artChanged = null;

export function uploadArt(g, kind, file, say) {
  return uploadPieces("api/art.php?id=" + encodeURIComponent(g.id) + "&kind=" + kind, file, say);
}

// Shared by images and videos: url is the endpoint with its id (and kind).
function uploadPieces(url, file, say) {
  var pieces = Math.max(1, Math.ceil(file.size / ART_PIECE));
  var base = url + "&of=" + pieces;
  function sendPiece(n) {
    say(pieces > 1 ? ("sending " + (n + 1) + " of " + pieces + "...") : "sending...");
    return fetch(base + "&part=" + n, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file.slice(n * ART_PIECE, (n + 1) * ART_PIECE)
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "bad response" }; });
    }).then(function (r) {
      // The one fetch outside api(): its failures are logged here, or a
      // failed upload would leave no line at all.
      if (!r.ok) { L("ERR", "upload " + url.split("?")[0] + " piece " + n + ": " + (r.error || "bad response")); throw new Error(r.error || "upload failed"); }
      return n + 1 < pieces ? sendPiece(n + 1) : r;
    });
  }
  return sendPiece(0);
}

export function openArtEditor(g) {
  L("ED", "pictures " + g.title);
  stopVideo();
  var dirty = false;

  function paint() {
    return api("api/art.php?id=" + encodeURIComponent(g.id)).then(function (res) {
      if (!res.ok) { showStrip("could not read that game's images: " + (res.error || ""), true); return; }

      var inner = toolFrame("CHANGE PICTURES");
      inner.appendChild(el("p", "group-help", res.title +
        "  ·  Choose a file, or drop one on a slot. Stored in Xsegon only."));

      var grid = el("div", "art-grid");
      Object.keys(res.kinds).forEach(function (kind) {
        var k = res.kinds[kind];
        var slot = el("div", "art-slot" + (k.replaced ? " replaced" : ""));

        var frame = el("div", "art-frame art-" + kind);
        if (k.has) {
          var img = el("img");
          // size=full skips the thumbnail cache; the time makes it a fresh
          // address, so the slot shows what is on disk NOW.
          img.src = "api/image.php?id=" + encodeURIComponent(g.id) + "&kind=" + kind + "&size=full&v=" + Date.now();
          img.alt = "";
          frame.appendChild(img);
        } else {
          frame.appendChild(el("div", "hero-noart", "NONE"));
        }
        slot.appendChild(frame);

        slot.appendChild(el("div", "art-name", k.label));
        /* "the original": a picture Xsegon has not replaced, from the copy in data\media. */
        var state = el("div", "art-state", k.replaced ? "replaced in Xsegon"
                                          : k.hidden ? "hidden: the original is not used"
                                          : (k.has ? "the original" : "no image"));
        if (k.hidden) { slot.classList.add("hidden-art"); }
        slot.appendChild(state);

        var pick = el("input");
        pick.type = "file";
        pick.accept = "image/png,image/jpeg,image/webp,image/gif";
        pick.hidden = true;

        function take(file) {
          if (!file) { return; }
          slot.classList.add("busy");
          uploadArt(g, kind, file, function (t) { state.textContent = t; }).then(function () {
            dirty = true;
            sound("select");
            paint();
          }).catch(function (e) {
            slot.classList.remove("busy");
            state.textContent = e.message;
            state.classList.add("bad");
          });
        }
        pick.addEventListener("change", function () { take(pick.files[0]); });

        var btns = el("div", "art-btns");
        var choose = el("button", null, k.has ? "Replace..." : "Add...");
        choose.addEventListener("click", function () { pick.click(); });
        btns.appendChild(choose);
        // Every picture the LaunchBox Games Database has for this slot.
        var find = el("button", null, "Find online...");
        find.addEventListener("click", function () { openPicker(g, kind, k.label, grid); });
        if (hasGamesDb) { btns.appendChild(find); }   // the Games Database Xsegon ships
        if (k.replaced) {
          var reset = el("button", null, k.hadOne ? "Reset to the original" : "Remove");
          reset.addEventListener("click", function () {
            api("api/art.php?id=" + encodeURIComponent(g.id) + "&kind=" + kind + "&reset=1", { method: "POST" })
              .then(function (r) {
                if (!r.ok) { state.textContent = r.error || "could not reset"; state.classList.add("bad"); return; }
                dirty = true;
                paint();
              });
          });
          btns.appendChild(reset);
        }
        // A picture on disk but wrong (a logo in the wrong language) can show nothing
        // instead. Only offered for the original: a replaced one was already chosen.
        if (!k.replaced && (k.has || k.hidden)) {
          var hide = el("button", null, k.hidden ? "Use the original again" : "Use no picture");
          hide.addEventListener("click", function () {
            api("api/art.php?id=" + encodeURIComponent(g.id) + "&kind=" + kind + "&hide=" + (k.hidden ? "0" : "1"), { method: "POST" })
              .then(function (r) {
                if (!r.ok) { state.textContent = r.error || "could not change that"; state.classList.add("bad"); return; }
                dirty = true;
                sound("select");
                paint();
              });
          });
          btns.appendChild(hide);
        }
        slot.appendChild(btns);
        slot.appendChild(pick);

        slot.addEventListener("dragover", function (e) { e.preventDefault(); slot.classList.add("drop"); });
        slot.addEventListener("dragleave", function () { slot.classList.remove("drop"); });
        slot.addEventListener("drop", function (e) {
          e.preventDefault();
          slot.classList.remove("drop");
          take(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
        });

        grid.appendChild(slot);
      });
      inner.appendChild(grid);

      // Clear all: every picture and the video show nothing. The window says what is deleted first.
      var showing = Object.keys(res.kinds).some(function (kind) { return res.kinds[kind].has || res.kinds[kind].replaced; });
      if (showing || (res.video && res.video.has)) {
        var all = el("div", "art-btns art-clear");
        var clear = el("button", null, "Clear all...");
        // Repainted either way: a video that stays still leaves the pictures cleared.
        clear.addEventListener("click", function () {
          askClearAll(g, res, function (err) {
            dirty = true;
            paint().then(function () { if (err) { showStrip(err, true); } });
          });
        });
        all.appendChild(clear);
        inner.appendChild(all);
      }

      $editor.appendChild(inner);
      $editor.hidden = false;
    });
  }

  // Closing is when the views behind are brought up to date, once, rather
  // than rebuilding 500 rows after every slot.
  setEditorOnClose(function () { if (dirty) { reloadKeeping(g.id); } });
  if (artChanged) { $editor.removeEventListener("xs-art-changed", artChanged); }
  artChanged = function onChanged() {
    if ($editor.hidden) { $editor.removeEventListener("xs-art-changed", onChanged); artChanged = null; return; }
    dirty = true;
    paint();
  };
  $editor.addEventListener("xs-art-changed", artChanged);
  paint().then(function () { sound("select"); });
}

/* ---------- a platform's own pictures ----------
   Right-click a console on the wall: the rim logo and the console itself. A picture
   chosen here goes in data\platform-art and outranks the shipped one; Remove brings it back. */

export function openPlatformArtEditor(p) {
  var name = p.name;
  L("ED", "platform pictures " + name);
  stopVideo();
  var dirty = false;
  var q = "platform=" + encodeURIComponent(name);

  function paint() {
    return api("api/platform-art.php?" + q).then(function (res) {
      if (!res.ok) { showStrip("could not read that platform: " + (res.error || ""), true); return; }

      var inner = toolFrame("CONSOLE PICTURES");
      inner.appendChild(el("p", "group-help", (p.label || name) +
        "  ·  The logo rides the rim; the console stands in the middle. Choose a file or drop one on a slot. " +
        "Stored in Xsegon only."));

      var grid = el("div", "art-grid");
      Object.keys(res.kinds).forEach(function (kind) {
        var k = res.kinds[kind];
        var slot = el("div", "art-slot" + (k.mine ? " replaced" : ""));

        var frame = el("div", "art-frame art-" + (kind === "device" ? "shot" : "logo"));
        if (k.has) {
          var img = el("img");
          // The same address the wall uses, with the moment appended so the
          // slot shows what is on disk now rather than what was cached.
          img.src = "api/image.php?" + q + "&kind=" + kind + "&v=" + Date.now();
          img.alt = "";
          img.onerror = function () { img.remove(); frame.appendChild(el("div", "hero-noart", "NONE")); };
          frame.appendChild(img);
        } else {
          frame.appendChild(el("div", "hero-noart", "NONE"));
        }
        slot.appendChild(frame);

        slot.appendChild(el("div", "art-name", k.label));
        /* "in Xsegon", not "yours": chosen and shipped pictures alike sit in data\platform-art. */
        var state = el("div", "art-state", k.mine ? "in Xsegon" : "no picture");
        slot.appendChild(state);

        var pick = el("input");
        pick.type = "file";
        pick.accept = "image/png,image/jpeg,image/webp,image/gif";
        pick.hidden = true;

        function take(file) {
          if (!file) { return; }
          slot.classList.add("busy");
          uploadPieces("api/platform-art.php?" + q + "&kind=" + kind, file, function (t) { state.textContent = t; })
            .then(function () { dirty = true; sound("select"); paint(); })
            .catch(function (e) {
              slot.classList.remove("busy");
              state.textContent = e.message;
              state.classList.add("bad");
            });
        }
        pick.addEventListener("change", function () { take(pick.files[0]); });

        var btns = el("div", "art-btns");
        var choose = el("button", null, k.has ? "Replace..." : "Add...");
        choose.addEventListener("click", function () { pick.click(); });
        btns.appendChild(choose);
        if (k.mine) {
          var reset = el("button", null, "Remove");
          reset.addEventListener("click", function () {
            api("api/platform-art.php?" + q + "&kind=" + kind + "&reset=1", { method: "POST" }).then(function (r) {
              if (!r.ok) { state.textContent = r.error || "could not reset"; state.classList.add("bad"); return; }
              dirty = true;
              sound("back");
              paint();
            });
          });
          btns.appendChild(reset);
        }
        slot.appendChild(btns);
        slot.appendChild(pick);

        slot.addEventListener("dragover", function (e) { e.preventDefault(); slot.classList.add("drop"); });
        slot.addEventListener("dragleave", function () { slot.classList.remove("drop"); });
        slot.addEventListener("drop", function (e) {
          e.preventDefault();
          slot.classList.remove("drop");
          take(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
        });

        grid.appendChild(slot);
      });
      inner.appendChild(grid);
      $editor.appendChild(inner);
      $editor.hidden = false;
    });
  }

  // The wall is rebuilt once, on the way out, rather than after every slot.
  // A new address for every console picture, or the browser, told it may
  // keep them for a year, would go on showing the one just replaced.
  setEditorOnClose(function () { if (dirty) { setPlatformArtRev(Date.now()); renderSystems(); } });
  paint().then(function () { sound("select"); });
}

// ---------- replace video ----------
/* One slot. The chosen video is filed under the game (data\video-own), so it outranks
   a snap found by name and survives a rename; "Reset" deletes it. MP4 and WebM only:
   what a browser plays. Clear video deletes every video the game could play. */

// Where the video a game plays comes from, as the window says it (video_from, includes\video.php).
var VIDEO_FROM = { name: "found by name", media: "from your media copy", steam: "from Steam", screenscraper: "from ScreenScraper" };

// What Clear video deletes, for both asking windows: v is {file, files, shared}.
export function videoClearLines(box, v) {
  var more = (v.files || 1) - 1;
  box.appendChild(el("p", null, "The video is deleted: " + v.file +
    (more ? " (and " + plural(more, "more file", "more files") + " it could play)" : "") + "."));
  if (v.shared && v.shared.length) {
    box.appendChild(el("p", null, namesAnd(v.shared) + (v.shared.length === 1 ? " plays" : " play") +
      " the same file and " + (v.shared.length === 1 ? "loses" : "lose") + " it too."));
  }
  box.appendChild(el("p", "mt-note", "A later Videos from online archives may fetch a new one."));
}

/* Clear all in Change Pictures: pictures stored in Xsegon are deleted, originals hidden
   (each comes back with Use the original again), and the video deleted. done(error or null). */
export function askClearAll(g, res, done) {
  var kinds = Object.keys(res.kinds).map(function (kind) { return res.kinds[kind]; });
  var gone = kinds.filter(function (k) { return k.replaced; }).length;
  var hide = kinds.filter(function (k) { return k.replaced ? k.hadOne && !k.hidden : k.has; }).length;
  var video = res.video || {};
  confirmWindow("Clear all of " + res.title + "?", function (box) {
    if (gone) {
      box.appendChild(el("p", null, plural(gone, "picture", "pictures") + " stored in Xsegon " + (gone === 1 ? "is" : "are") + " deleted."));
    }
    if (hide) {
      box.appendChild(el("p", null, plural(hide, "original picture", "original pictures") + (hide === 1 ? " is" : " are") +
        " hidden: the file stays on your disk, and Use the original again brings " + (hide === 1 ? "it" : "each one") + " back."));
    }
    if (video.has) { videoClearLines(box, video); }
  }, { label: "Clear all", run: function () {
    stopVideo();
    api("api/art.php?id=" + encodeURIComponent(g.id) + "&clear=1", { method: "POST" }).then(function (r) {
      L("ED", "clear all " + g.title + ": " + (r.ok ? r.deleted + " deleted, " + r.hidden + " hidden, " + r.videos + " videos" : r.error));
      sound(r.ok ? "ok" : "back");
      done(r.ok ? null : (r.error || "it could not be cleared"));
    });
  } });
}

export function openVideoEditor(g) {
  L("ED", "video " + g.title);
  stopVideo();
  var dirty = false;

  function paint() {
    return api("api/video-own.php?id=" + encodeURIComponent(g.id)).then(function (res) {
      if (!res.ok) { showStrip("could not read that game's video: " + (res.error || ""), true); return; }

      var inner = toolFrame(res.has ? "REPLACE VIDEO" : "ADD VIDEO");
      inner.appendChild(el("p", "group-help", res.title +
        "  ·  Choose an MP4 or WebM, or drop one here. Stored in Xsegon only."));

      var slot = el("div", "art-slot vid-slot" + (res.replaced ? " replaced" : ""));
      var frame = el("div", "vid-frame");
      var v = null;
      if (res.has) {
        v = el("video");
        v.controls = true;
        v.preload = "metadata";
        v.volume = snapVolume();
        v.muted = muted;
        v.src = "api/video.php?id=" + encodeURIComponent(g.id) + "&v=" + (res.rev || Date.now());
        frame.appendChild(v);
      } else {
        frame.appendChild(el("div", "hero-noart", "NO VIDEO"));
      }
      slot.appendChild(frame);

      var state = el("div", "art-state",
        res.replaced ? "chosen in Xsegon"
                     : (res.has ? (VIDEO_FROM[res.from] || VIDEO_FROM.name) + "  ·  " + res.file : "this game has no video yet"));
      slot.appendChild(state);

      var pick = el("input");
      pick.type = "file";
      pick.accept = "video/mp4,video/webm,.mp4,.m4v,.webm";
      pick.hidden = true;

      function take(file) {
        if (!file) { return; }
        slot.classList.add("busy");
        state.classList.remove("bad");
        uploadPieces("api/video-own.php?id=" + encodeURIComponent(g.id), file,
                     function (t) { state.textContent = t; }).then(function () {
          dirty = true;
          sound("select");
          paint();
        }).catch(function (e) {
          slot.classList.remove("busy");
          state.textContent = e.message;
          state.classList.add("bad");
        });
      }
      pick.addEventListener("change", function () { take(pick.files[0]); });

      var btns = el("div", "art-btns");
      var choose = el("button", null, res.has ? "Replace..." : "Choose a video...");
      choose.addEventListener("click", function () { pick.click(); });
      btns.appendChild(choose);
      if (res.replaced) {
        var reset = el("button", null, res.hadOne ? "Reset to the one " + (VIDEO_FROM[res.under] || VIDEO_FROM.name) : "Remove");
        reset.addEventListener("click", function () {
          api("api/video-own.php?id=" + encodeURIComponent(g.id) + "&reset=1", { method: "POST" })
            .then(function (r) {
              if (!r.ok) { state.textContent = r.error || "could not reset"; state.classList.add("bad"); return; }
              dirty = true;
              paint();
            });
        });
        btns.appendChild(reset);
      }
      if (res.has) {
        var wipe = el("button", null, "Clear video...");
        wipe.addEventListener("click", function () {
          confirmWindow("Clear the video of " + res.title + "?", function (box) { videoClearLines(box, res); }, { label: "Clear video", run: function () {
            // The player lets go of the file first: a video being played cannot be deleted.
            if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
            stopVideo();
            api("api/video-own.php?id=" + encodeURIComponent(g.id) + "&clear=1", { method: "POST" }).then(function (r) {
              L("ED", "clear video " + g.title + ": " + (r.ok ? r.gone + " deleted" : r.error));
              sound(r.ok ? "ok" : "back");
              dirty = true;
              paint().then(function () { if (!r.ok) { showStrip(r.error || "the video could not be cleared", true); } });
            });
          } });
        });
        btns.appendChild(wipe);
      }
      slot.appendChild(btns);
      slot.appendChild(pick);

      slot.addEventListener("dragover", function (e) { e.preventDefault(); slot.classList.add("drop"); });
      slot.addEventListener("dragleave", function () { slot.classList.remove("drop"); });
      slot.addEventListener("drop", function (e) {
        e.preventDefault();
        slot.classList.remove("drop");
        take(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
      });

      inner.appendChild(slot);
      $editor.appendChild(inner);
      $editor.hidden = false;
    });
  }

  setEditorOnClose(function () { if (dirty) { reloadKeeping(g.id); } });
  paint().then(function () { sound("select"); });
}

/* Find online: the LaunchBox Games Database's pictures for one slot (api\gamesdb.php);
   a click downloads one as the replacement. It takes the slots' place until Back, and
   a game not matched to the database gets a search first. onBack: told when the slots are back. */
export function openPicker(g, kind, label, slotsEl, onBack) {
  var host = slotsEl.parentNode;
  var box = el("div", "pk");
  slotsEl.hidden = true;
  host.appendChild(box);

  function back() { box.remove(); slotsEl.hidden = false; if (onBack) { onBack(); } }
  function head(text) {
    var h = el("div", "pk-head");
    var b = el("button", null, "Back");
    b.addEventListener("click", back);
    h.appendChild(b);
    h.appendChild(el("span", "pk-title", text));
    return h;
  }

  function showImages(res) {
    box.textContent = "";
    box.appendChild(head(label + " for " + g.title + " (Games Database #" + res.dbId + ")"));
    var list = (res.slots && res.slots[kind]) || [];
    if (!list.length) {
      box.appendChild(el("p", "mt-note", "The database has no " + label.toLowerCase() + " for this game."));
      var other = el("button", null, "Not the right game? Search...");
      other.addEventListener("click", function () { showSearch(); });
      box.appendChild(other);
      return;
    }
    var note = el("p", "mt-note", list.length + " on record, best first. Click one to use it.");
    box.appendChild(note);
    var grid = el("div", "pk-grid");
    list.forEach(function (it) {
      var cell = el("div", "pk-cell");
      var fr = el("div", "pk-frame art-" + kind);
      var img = el("img");
      img.loading = "lazy";
      img.alt = "";
      img.src = it.url;
      fr.appendChild(img);
      cell.appendChild(fr);
      cell.appendChild(el("div", "pk-cap", (it.region || "any region") + "  ·  " + it.type));
      cell.addEventListener("click", function () {
        cell.classList.add("busy");
        note.textContent = "Downloading...";
        postJson("api/gamesdb.php?id=" + encodeURIComponent(g.id) + "&kind=" + kind, { file: it.file })
          .then(function (r) {
            if (!r.ok) { cell.classList.remove("busy"); note.textContent = r.error || "could not download that"; note.classList.add("warn"); return; }
            sound("select");
            back();
            // the slots repaint through the dialog's own paint, via a
            // synthetic "dirty" reload: the dialog listens on this event
            host.dispatchEvent(new CustomEvent("xs-art-changed", { bubbles: true }));
          });
      });
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    var wrong = el("button", null, "Not the right game? Search...");
    wrong.addEventListener("click", function () { showSearch(); });
    box.appendChild(wrong);
  }

  function showSearch() {
    box.textContent = "";
    box.appendChild(head("Find " + g.title + " in the Games Database"));
    var row = el("div", "pk-search");
    var q = el("input");
    q.type = "text";
    q.value = g.title;
    var go = el("button", "primary", "Search");
    row.appendChild(q);
    row.appendChild(go);
    box.appendChild(row);
    var results = el("div", "pk-results");
    box.appendChild(results);
    function run() {
      results.textContent = "searching...";
      api("api/gamesdb.php?id=" + encodeURIComponent(g.id) + "&what=search&q=" + encodeURIComponent(q.value)).then(function (r) {
        results.textContent = "";
        if (!r.ok) { results.textContent = r.error || "search failed"; return; }
        if (!r.results.length) { results.textContent = "nothing matched"; return; }
        r.results.forEach(function (m) {
          var line = el("div", "pk-result" + (m.platform === g.platform ? " same" : ""));
          line.appendChild(el("span", "t", m.title));
          line.appendChild(el("span", "p", m.platform + (m.year ? "  ·  " + m.year : "")));
          line.addEventListener("click", function () {
            api("api/gamesdb.php?id=" + encodeURIComponent(g.id) + "&link=" + m.id, { method: "POST" }).then(function (l) {
              if (!l.ok) { results.textContent = l.error || "could not keep that match"; return; }
              sound("select");
              load();               // the game row now carries the id
              api("api/gamesdb.php?id=" + encodeURIComponent(g.id) + "&what=images").then(showImages);
            });
          });
          results.appendChild(line);
        });
      });
    }
    go.addEventListener("click", run);
    q.addEventListener("keydown", function (e) { if (e.key === "Enter") { run(); } e.stopPropagation(); });
    run();
  }

  box.appendChild(head(label + " for " + g.title));
  box.appendChild(el("p", "mt-note", "asking the Games Database..."));
  api("api/gamesdb.php?id=" + encodeURIComponent(g.id) + "&what=images").then(function (res) {
    if (!res.ok) { box.textContent = ""; box.appendChild(head(label)); box.appendChild(el("p", "mt-note warn", res.error || "could not read the database")); return; }
    if (res.unmatched) { showSearch(); return; }
    showImages(res);
  });
}

export function initArtEditors() {
  // A file dropped beside a slot must not make the browser navigate to it.
  $editor.addEventListener("dragover", function (e) { e.preventDefault(); });
  $editor.addEventListener("drop", function (e) { e.preventDefault(); });
}
