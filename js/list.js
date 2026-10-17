/*  The list view's table: the column headers, which columns are shown, and
    the cells themselves.

    It lives apart from views.js because the list is the only view with a
    shape you can change: headers, a sort you can press, columns you can put away.

    No module here imports views.js or library.js, because both of those
    reach back to this file. What the header needs from them (sort now,
    draw again) is handed in as a function when the header is built.
*/

import { iconEl } from "./icons.js";
import { carryHeader } from "./listmove.js";
import { L } from "./log.js";
import { saveSetting } from "./savednote.js";
import { sound } from "./sound.js";
import { $q, $sort, $view, S, sel } from "./state.js";
import { badgeClasses, badgesEl, discWords, el, fixWords, hhmm, titleText } from "./util.js";

/* Every column the list can show.

   `sort` is the Arrange By key the header presses, so the menu bar and the
   headers can never disagree: they set the same value. Every column has
   one; a column with none would still be shown, its header not pressing.

   `w` is the track in the grid template. Title is the one that stretches,
   which is why it is the only `1fr`, and why it cannot be put away: a list
   of blank rows with a Year on them is not a list of games. */
/* `alias` is an older class name for the cell: the favourite star, the struck-through
   dead title and the no-video clapperboard are painted off those names in CSS that
   other views share. */
/* `group` is the picker's heading the column is offered under. This list's
   order is the usual order: the table's until a header is carried somewhere
   else (js\listmove.js), and what the picker's way back returns to. */
var COLUMNS = [
  // `min` is only needed where `w` is not a plain pixel number: the title is
  // the one track that stretches, and 220 is the floor it stretches from.
  { key: "title",     label: "Title",       w: "minmax(220px, 1fr)", min: 220, sort: "title", fixed: true, alias: "t", group: "game",
    text: function (g) { return titleText(g); } },
  { key: "platform",  label: "System",      w: "190px", sort: "platform", alias: "p", group: "game",
    text: function (g) { return g.platform; } },
  { key: "genre",     label: "Genre",       w: "150px", sort: "genre", alias: "g", group: "game",
    text: function (g) { return g.genre || ""; } },
  { key: "developer", label: "Developer",   w: "170px", sort: "developer", group: "game",
    text: function (g) { return g.developer || ""; } },
  { key: "publisher", label: "Publisher",   w: "170px", sort: "publisher", group: "game",
    text: function (g) { return g.publisher || ""; } },
  { key: "released",  label: "Year",        w: "70px",  sort: "year", num: true, group: "game",
    text: function (g) { return (g.released || "").slice(0, 4); } },
  { key: "rating",    label: "Rating",      w: "80px",  sort: "rating", num: true, group: "game",
    text: function (g) { return g.rating ? Number(g.rating).toFixed(1) : ""; } },
  { key: "favourite", label: "Favourite",   w: "100px", sort: "favourite", group: "marks",
    text: function (g) { return g.favourite ? "★" : ""; },
    tip: function () { return "A favourite of yours"; } },
  // Yours, as stars (data\my-ratings.json); the Rating beside it is the library's.
  // s<n> says how many, for the unlit rest the pointer brings out (js\rowstars.js sets them from the row).
  { key: "myRating",  label: "Your rating", w: "118px", sort: "myrating", group: "marks",
    text: function (g) { return g.myRating ? "★★★★★".slice(0, g.myRating) : ""; },
    cls: function (g) { return "s" + (g.myRating || 0); },
    tip: function (g) { return "Yours: " + g.myRating + " of 5"; } },
  { key: "players",   label: "Players",     w: "80px",  sort: "players", num: true, group: "game",
    text: function (g) { return g.players ? String(g.players) : ""; } },
  { key: "plays",     label: "Plays",       w: "70px",  sort: "plays", num: true, group: "stats",
    text: function (g) { return g.plays ? String(g.plays) : ""; } },
  { key: "seconds",   label: "Time",        w: "90px",  sort: "playtime", num: true, alias: "n", group: "stats",
    // A dead game says why it is dead here rather than just refusing to work.
    text: function (g) { return g.playable ? hhmm(g.seconds) : (g.why || "no launch"); } },
  { key: "lastPlayed", label: "Last played", w: "120px", sort: "recent", num: true, group: "stats",
    text: function (g) { return (g.lastPlayed || "").slice(0, 10); } },
  { key: "addedAt",   label: "Added",       w: "110px", sort: "added", num: true, group: "stats",
    text: function (g) { return g.addedAt || ""; } },
  /* What Filter by asks, shown (Favourite above is one of them): a list cut
     down by a filter can say why each game is in it. */
  { key: "tags",      label: "Tags",        w: "170px", sort: "tags", group: "marks",
    text: function (g) { return (g.tags || []).join(" · "); } },
  { key: "cheats",    label: "Cheats",      w: "80px",  sort: "cheats", num: true, group: "marks",
    text: function (g) { return g.cheats ? String(g.cheats) : ""; },
    tip: function (g) { return g.cheats === 1 ? "1 cheat selected: it starts with it" : g.cheats + " cheats selected: it starts with them"; } },
  // What it lacks, by name; a game with everything shows nothing, so the gaps stand out.
  { key: "missing",   label: "Missing art", w: "200px", sort: "missing", group: "files",
    text: function (g) { return missingArt(g).join(" · "); },
    tip: function (g) { return "No " + missingArt(g).join(", no "); } },
  { key: "ready",     label: "Ready",       w: "150px", sort: "ready", group: "files",
    text: function (g) { return readyWords(g); },
    cls: function (g) { return isReady(g) ? "" : "off"; } },
  { key: "needsFix",  label: "Needs fix",   w: "200px", sort: "needsfix", group: "files",
    text: function (g) { return g.needsFix || ""; },
    tip: function (g) { return fixWords(g); } },
  { key: "source",    label: "Source",      w: "110px", sort: "source", group: "files",
    text: function (g) { return SOURCES[sourceOf(g)][0]; },
    tip: function (g) { return SOURCES[sourceOf(g)][1]; } },
  { key: "file",      label: "File",        w: "230px", sort: "file", group: "files",
    text: function (g) { return g.file || ""; } },
  // What the Has a manual and the two hacks filters ask, and how many discs: each from the row's own word.
  { key: "docs",      label: "Documents",   w: "110px", sort: "docs", group: "files",
    text: function (g) { return g.docs ? "yes" : ""; }, tip: function () { return "It has a manual, a map or a guide: D opens them"; } },
  { key: "hack",      label: "Hack",        w: "130px", sort: "hack", group: "files",
    text: function (g) { return g.hack === "yes" ? "hack" : g.hack === "ask" ? "may be a hack" : ""; } },
  { key: "discs",     label: "Discs",       w: "110px", sort: "discs", group: "files",
    text: function (g) { return !g.discs ? "" : g.discs.set ? g.discs.n + " discs" : "disc " + g.discs.disc + " only"; },
    tip: function (g) { return discWords(g); } },
];

// The picker's headings, in the order it shows them.
var GROUPS = [["game", "About the game"], ["marks", "Your marks"], ["stats", "Stats"], ["files", "Files and pictures"]];

// The pictures in Image Group's own words, and the video.
var ART = [["hasArt", "box art"], ["hasBox3d", "3D box"], ["hasLogo", "logo"],
           ["hasShot", "screenshot"], ["hasFanart", "fanart"], ["hasVideo", "video"]];
function missingArt(g) {
  return ART.filter(function (a) { return !g[a[0]]; }).map(function (a) { return a[1]; });
}

/* Filter by's Ready to play, in words: the server's own answer (g.ready).
   A game that can launch and is not ready has its folder away. */
function isReady(g) {
  return !!g.playable && g.ready !== false;
}
function readyWords(g) {
  if (!g.playable) { return g.why || "no launch"; }
  return isReady(g) ? "ready" : "its drive is not there right now";
}

var SOURCES = {
  steam:   ["Steam",     "From your Steam library"],
  own:     ["Your own",  "A game you added yourself"],
  scanned: ["Scanned",   "Found on the disk by Scan for Games"],
  library: ["LaunchBox", "Imported from LaunchBox"],
};
function sourceOf(g) {
  return g.steam ? "steam" : g.local ? "own" : g.scanned ? "scanned" : "library";
}

// The columns shown until someone picks others.
var DEFAULT_COLUMNS = ["title", "platform", "genre", "seconds"];

/** The columns to draw, in the order they are kept in. Title is always in and always first, whatever is saved. */
export function listColumns() {
  var want = (S.view && S.view.listColumns) || DEFAULT_COLUMNS;
  if (!want.length) { want = DEFAULT_COLUMNS; }
  var out = COLUMNS.filter(function (c) { return c.fixed; });
  want.forEach(function (k) {
    var c = COLUMNS.filter(function (x) { return x.key === k; })[0];
    if (c && out.indexOf(c) < 0) { out.push(c); }
  });
  return out;
}
// The same columns as the table comes with them: what "the usual order" means.
function usualOrder(keys) {
  return COLUMNS.map(function (c) { return c.key; }).filter(function (k) { return keys.indexOf(k) >= 0; });
}

/* The widths you dragged, by column key. Only the changed ones are kept, so
   a column you never touched follows the table's own width and a column
   added in a later version arrives at a sensible size rather than at
   whatever this file happened to remember. */
export function listWidths() {
  var w = (S.view && S.view.listWidths) || {};
  return (w && typeof w === "object" && !Array.isArray(w)) ? w : {};
}

/* Title is the track that stretches, which is what makes the table fill its
   box. Drag it to a width of its own and it stops stretching, so something
   else has to take the slack: a filler track goes in before the hamburger,
   and the rows grow an empty cell to match. Without it the columns would sit
   in a heap at the left with the hamburger stranded in the middle. */
function hasFiller() {
  return listWidths().title !== undefined;
}
export function listPads() {
  return hasFiller() ? 2 : 1;
}

/* The grid template both the header and every row use. It is set once on the
   .list container as a custom property, so the two can never fall out of
   step: one number, read twice. The trailing track is the hamburger's
   column, which the rows leave empty so everything above it lines up. */
export function listTemplate() {
  var w = listWidths();
  var tracks = listColumns().map(function (c) {
    return w[c.key] !== undefined ? w[c.key] + "px" : c.w;
  });
  return tracks.join(" ") + (hasFiller() ? " minmax(0, 1fr)" : "") + " 38px";
}

/* How wide the table needs to be to show every chosen column at its proper
   width, so the list can scroll sideways to reach the ones that do not fit.

   Worked out here rather than left to `min-width: max-content`, which sizes
   the title track to the LONGEST TITLE in the library and would put a
   scrollbar on the usual four columns, where there is nothing to scroll to.
   Title is the one flexible track: it takes the slack while there is slack,
   and holds at its floor once there is not.

   GAP and PAD are the two numbers in the .row rule in css\xsegon.css, repeated
   here: a width that ignored them is short by a column or more with every column on. */
var GAP = 14;
var PAD = 14;
var HAMBURGER = 38;

export function listMinWidth() {
  return minWidthFor(listWidths());
}
function minWidthFor(w) {
  var cols = listColumns();
  var px = cols.reduce(function (sum, c) {
    return sum + (w[c.key] !== undefined ? w[c.key] : (c.min || parseInt(c.w, 10)));
  }, 0);
  return px + HAMBURGER + GAP * cols.length + PAD * 2;
}

/* Highlighting, the way the settings screen does it: the letters you typed,
   found in what is on screen, lit rather than merely surviving the filter.

   The search is normalised on the server (punctuation and case thrown away),
   so a query CAN match a row without appearing in it letter for letter.
   When that happens the cell is drawn plain instead of guessing: a wrong
   highlight is worse than none. */
function litText(cell, value, q) {
  if (!q || !value) { cell.textContent = value || ""; return; }
  var at = value.toLowerCase().indexOf(q);
  if (at < 0) { cell.textContent = value; return; }
  cell.appendChild(document.createTextNode(value.slice(0, at)));
  cell.appendChild(el("mark", "hit", value.slice(at, at + q.length)));
  cell.appendChild(document.createTextNode(value.slice(at + q.length)));
}

/** One game's cells, in the chosen order. */
export function listCells(g) {
  var q = ($q.value || "").trim().toLowerCase();
  return listColumns().map(function (c) {
    var cell = el("span", "cell c-" + c.key + (c.num ? " num" : "") + (c.alias ? " " + c.alias : "") +
                          (c.cls ? " " + c.cls(g) : ""));
    var text = c.text(g);
    litText(cell, text, q);
    // Cells clip rather than wrap, so anything longer than its column can be
    // read by resting on it. Not on the title, where the tooltip would only
    // repeat what is already in front of you. A dead game's reason, a path
    // in a narrow column, is the one that needs this.
    if (text && !c.fixed) { cell.title = c.tip ? c.tip(g) : text; }
    // The badge strip rides the title, where the star and the clapperboard
    // already are; which of its marks show is the Badges menu's business.
    if (c.key === "title") { cell.appendChild(badgesEl(g)); }
    return cell;
  });
}

/* ---------- the header ---------- */

/* Which way each sort runs unreversed (true: smallest first), and its words
   both ways. Matches api\library.php: text and years run up, the rest down. */
var AZ = ["A to Z", "Z to A"];
var ORDER = {
  title: [true, AZ], platform: [true, AZ], genre: [true, AZ], developer: [true, AZ], publisher: [true, AZ],
  year:     [true,  ["Oldest first", "Newest first"]],
  rating:   [false, ["Highest rated first", "Lowest rated first"]],
  myrating: [false, ["Your highest rated first", "Your lowest rated first"]],
  plays:    [false, ["Most plays first", "Fewest plays first"]],
  playtime: [false, ["Longest played first", "Shortest played first"]],
  recent:   [false, ["Last played first", "Longest ago first"]],
  // The columns Arrange By does not list: a header is their only way in.
  tags: [true, AZ], needsfix: [true, AZ], source: [true, AZ], file: [true, AZ],
  players:   [false, ["Most players first", "Fewest players first"]],
  added:     [false, ["Newest first", "Oldest first"]],
  favourite: [false, ["Favourites first", "Favourites last"]],
  cheats:    [false, ["Most cheats first", "Fewest cheats first"]],
  missing:   [false, ["Most missing first", "Least missing first"]],
  ready:     [false, ["What cannot start first", "Ready first"]],
  docs:      [false, ["With documents first", "With documents last"]],
  hack:      [false, ["Hacks first", "Hacks last"]],
  discs:     [false, ["Most discs first", "Fewest discs first"]],
};

function reversed() {
  return !!(S.view && S.view.sortReverse);
}

// Up for smallest first (A to Z, fewest), as a file list shows it.
function arrow(key) {
  var o = ORDER[key];
  if (!o) { return ""; }
  return o[0] !== reversed() ? " ▲" : " ▼";
}

function sortTip(c, on) {
  var o = ORDER[c.sort];
  if (!on || !o) { return "Sort by " + c.label; }
  var r = reversed() ? 1 : 0;
  return o[1][r] + ". Press again for " + o[1][1 - r];
}
/** A sort's two ways in words, its usual one first: for a header's own menu (js\listmenu.js). */
export function sortWords(key) { return (ORDER[key] || [true, AZ])[1]; }

/**
 * The header row.
 *   onSort(key)     press a header: set that Arrange By sort and load again
 *   onColumns()     the picker changed what is shown: draw the list again
 */
export function listHead(onSort, onColumns) {
  var head = el("div", "lhead");
  // The dropdown, not S.view: it is what load() actually sent, so the marked
  // column is the column the rows are really in.
  var now = $sort.value || (S.view && S.view.sort) || "title";

  listColumns().forEach(function (c) {
    // c-<key> is on the header AND on every cell, so one rule can freeze the
    // title column in both without the two being described separately.
    var h = el("span", "lh c-" + c.key + (c.num ? " num" : "") + (c.sort === now ? " on" : "") +
                       (c.sort ? " sortable" : ""));
    h.appendChild(el("span", "lh-t", c.label + (c.sort === now ? arrow(c.sort) : "")));
    h.title = (c.sort ? sortTip(c, c.sort === now) : c.label) + (c.fixed ? "" : ". Drag to move this column") + ". Right-click for more";
    // Every column but Title can be carried to another place; Title stays in front of what is put down.
    if (!c.fixed) {
      h.dataset.key = c.key;
      carryHeader(h, c.label, function (keys) {
        saveColumns(listColumns().filter(function (x) { return x.fixed; }).map(function (x) { return x.key; }).concat(keys), onColumns);
      });
    }
    if (c.sort) {
      // No log line of its own: the sort it calls writes SET sort <key>.
      h.addEventListener("click", function () {
        sound("move");
        onSort(c.sort);
      });
    }
    h.appendChild(grip(c, h, onColumns));
    head.appendChild(h);
  });

  // The track that takes the slack once Title has a width of its own, so
  // the table still reaches the right-hand edge. Nothing in it.
  if (hasFiller()) { head.appendChild(el("span", "lh lh-filler")); }

  // The hamburger, hard right, in the header's own last track.
  var btn = el("button", "lh-cols");
  btn.type = "button";
  btn.title = "Which columns to show";
  btn.setAttribute("aria-label", "Which columns to show");
  btn.appendChild(iconEl("lh-ico", "lines"));
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    openPicker(head, btn, onColumns);
  });
  head.appendChild(btn);
  return head;
}

/* ---------- dragging a column wider ----------

   A grip down the right-hand edge of each header cell, inside it, so a column
   is widened from its own edge. While the drag runs the template is written
   straight onto the list and nothing is redrawn; the width is saved on release.

   The held edge stays under the pointer: for the length of a drag Title keeps
   its width (a stretching Title would give or take the room) and the table gets
   no shorter (a table scrolled to its right end would slide back), with the room
   left over at the right-hand end; on release the table takes its own shape. */

var dragging = null;

/* What each track measures, as the header is laid out: Title's cell is wider
   than its track (it covers the row's padding), so reading the cell would jump. */
function trackWidths(head) {
  return getComputedStyle(head).gridTemplateColumns.split(/\s+/).map(parseFloat);
}

// The template of a drag: Title held at a width, the room left over in the last track.
function dragTemplate() {
  var w = listWidths();
  if (dragging.title === null) { return listTemplate(); }   // Title has a width of its own: the filler has the room already
  return listColumns().map(function (c) {
    if (c.key === "title") { return (w.title !== undefined ? w.title : dragging.title) + "px"; }
    return w[c.key] !== undefined ? w[c.key] + "px" : c.w;
  }).join(" ") + " minmax(38px, 1fr)";
}

function onDragMove(e) {
  if (!dragging) { return; }
  // A floor, because a column dragged to nothing is a column whose grip you
  // can no longer find. No ceiling: the table scrolls.
  var want = Math.max(60, Math.round(dragging.was + (e.clientX - dragging.from)));
  if (want === dragging.at) { return; }
  dragging.at = want;
  dragging.moved = true;
  var w = Object.assign({}, listWidths());
  w[dragging.key] = want;
  dragging.live = w;
  /* Straight onto the list: one custom property, read by the header and by
     every row, so all of them follow at once and no row is rebuilt. */
  if (!S.view) { S.view = {}; }
  S.view.listWidths = w;
  var held = dragging.title !== null && w.title === undefined ? Object.assign({ title: dragging.title }, w) : w;
  $view.style.setProperty("--cols", dragTemplate());
  $view.style.setProperty("--colsw", Math.max(minWidthFor(held), dragging.wide) + "px");
}

function onDragEnd() {
  if (!dragging) { return; }
  var live = dragging.live, moved = dragging.moved, back = dragging.onColumns;
  dragging.grip.classList.remove("drag");
  dragging = null;
  $view.classList.remove("resizing");
  window.removeEventListener("pointermove", onDragMove, true);
  window.removeEventListener("pointerup", onDragEnd, true);
  window.removeEventListener("pointercancel", onDragEnd, true);
  /* A press that never moved is not a resize. Without this, a stray click on
     a grip would write the width the column already had, which is how a
     table quietly fills up with widths nobody chose. */
  if (moved && live) { saveWidths(live, back); }
}

export function saveWidths(w, onColumns) {
  if (!S.view) { S.view = {}; }
  S.view.listWidths = w;
  L("SET", "widths " + Object.keys(w).map(function (k) { return k + "=" + w[k]; }).join(","));
  saveSetting({ view: { listWidths: w } }, "The column widths");
  if (onColumns) { onColumns(); }
}

function grip(c, cell, onColumns) {
  var g = el("span", "lh-grip");
  g.title = "Drag to resize " + c.label + ", double-click to put it back";

  // The header sorts when pressed, so the grip must not let a press through.
  g.addEventListener("click", function (e) { e.stopPropagation(); });

  /* The moves and the release are listened for on the WINDOW, not on the grip:
     a drag leaves the narrow grip at once, and pointer capture is not guaranteed
     (it throws on an unseen pointer id and ends when the pointer leaves the window). */
  g.addEventListener("pointerdown", function (e) {
    if (e.button !== 0 && e.button !== undefined) { return; }
    e.stopPropagation();
    e.preventDefault();
    var tracks = trackWidths(cell.parentNode);
    var mine = tracks[listColumns().map(function (x) { return x.key; }).indexOf(c.key)];
    dragging = {
      key: c.key,
      from: e.clientX,
      was: Math.round(isFinite(mine) ? mine : cell.getBoundingClientRect().width),
      // For the drag: the width Title has now (null when it has one of its own), and how wide the table is.
      title: hasFiller() || !isFinite(tracks[0]) ? null : Math.round(tracks[0]),
      wide: $view.scrollWidth,
      grip: g,
      onColumns: onColumns,
      moved: false,
    };
    g.classList.add("drag");               // this grip alone stays lit (css .list.resizing)
    try { g.setPointerCapture(e.pointerId); } catch (err) { /* not needed */ }
    $view.classList.add("resizing");
    window.addEventListener("pointermove", onDragMove, true);
    window.addEventListener("pointerup", onDragEnd, true);
    window.addEventListener("pointercancel", onDragEnd, true);
  });

  /* Double-click puts this column back to the width the table ships with.
     The alternative, hunting for a Reset in a menu, is worse for the one
     mistake this feature invites: dragging the wrong edge. */
  g.addEventListener("dblclick", function (e) {
    e.stopPropagation();
    e.preventDefault();
    var w = Object.assign({}, listWidths());
    if (w[c.key] === undefined) { return; }
    delete w[c.key];
    sound("back");
    saveWidths(w, onColumns);
  });

  return g;
}

/* ---------- the column picker ---------- */

var openPanel = null;

export function closePicker() {
  if (!openPanel) { return; }
  document.removeEventListener("click", clickAway, true);
  document.removeEventListener("keydown", pickerKey, true);
  window.removeEventListener("scroll", followButton, true);
  if (openPanel.parentNode) { openPanel.parentNode.removeChild(openPanel); }
  openPanel = null;
}

function pickerKey(e) {
  if (e.key === "Escape") {
    e.stopPropagation();          // Escape closes the panel, not the view
    e.preventDefault();
    closePicker();
    sound("back");
  }
}

export function saveColumns(keys, onColumns) {
  if (!S.view) { S.view = {}; }
  S.view.listColumns = keys;
  L("SET", "columns " + keys.join(","));
  saveSetting({ view: { listColumns: keys } }, "The list's columns");
  onColumns();
}

function openPicker(head, btn, onColumns) {
  if (openPanel) { closePicker(); sound("back"); return; }
  sound("select");
  var panel = el("div", "lcols");
  panel.appendChild(el("p", "lcols-head", "COLUMNS"));

  var chosen = listColumns().map(function (c) { return c.key; });
  // Side by side under their headings, so the panel needs no scrolling.
  var blocks = el("div", "lcols-groups");
  GROUPS.forEach(function (grp) {
    var block = el("div", "lcols-group");
    block.appendChild(el("p", "lcols-ghead", grp[1]));
    COLUMNS.filter(function (c) { return c.group === grp[0]; }).forEach(function (c) {
      // rowEl, not row: a local called `row` reads as views.js's exported row()
      // to tools\js-imports.js, which then writes an import for it.
      var rowEl = el("label", "lcols-row" + (c.fixed ? " fixed" : ""));
      rowEl.dataset.key = c.key;
      var box = el("input");
      box.type = "checkbox";
      box.checked = chosen.indexOf(c.key) >= 0;
      box.disabled = !!c.fixed;
      rowEl.appendChild(box);
      rowEl.appendChild(el("span", "lcols-name", c.label));
      if (c.fixed) { rowEl.appendChild(el("span", "lcols-why", "always")); }
      box.addEventListener("change", function () {
        // The order on screen is kept: a column selected arrives at the right-hand end, one deselected leaves its place.
        var keys = listColumns().map(function (x) { return x.key; }).filter(function (k) { return k !== c.key; });
        if (box.checked) { keys.push(c.key); }
        saveColumns(keys, onColumns);
      });
      block.appendChild(rowEl);
    });
    blocks.appendChild(block);
  });
  panel.appendChild(blocks);

  /* Widths are dragged on the headers, so the only thing the picker owes
     them is a way back. Shown only when there is something to undo: a
     button that does nothing is a button you have to think about. */
  // The order is carried on the headers too, and gets a way back the same way: only when it is not the usual one.
  if (chosen.join() !== usualOrder(chosen).join()) {
    var order = el("button", "lcols-reset lcols-oreset", "Back to the usual order");
    order.type = "button";
    order.addEventListener("click", function () {
      saveColumns(usualOrder(listColumns().map(function (x) { return x.key; })), onColumns);
      closePicker();
    });
    panel.appendChild(order);
  }
  if (Object.keys(listWidths()).length) {
    panel.appendChild(el("p", "lcols-note", "Drag a header to move its column, or right-click it for more. Drag the edge of a header to resize one, or double-click that edge to put it back."));
    // Its own class, not lcols-reset: two buttons sharing one name means
    // anything that reaches for "the reset button" gets whichever comes
    // first in the panel, which is not the one it meant.
    var widths = el("button", "lcols-reset lcols-wreset", "Back to the usual widths");
    widths.type = "button";
    widths.addEventListener("click", function () {
      saveWidths({}, onColumns);
      closePicker();
    });
    panel.appendChild(widths);
  } else {
    panel.appendChild(el("p", "lcols-note", "Drag a header to move its column, or the edge of a header to resize one. Right-click a header for more."));
  }

  var reset = el("button", "lcols-reset lcols-allreset", "Back to the usual four");
  reset.type = "button";
  reset.addEventListener("click", function () {
    // Both, because "back to the usual" meaning only half of it is the kind
    // of thing you find out by pressing it and still being stuck.
    saveWidths({}, null);
    saveColumns(DEFAULT_COLUMNS.slice(), onColumns);
    closePicker();
  });
  panel.appendChild(reset);

  /* On the body, not in the header: the list is its own scrolling box
     (.main.with-hero .list) and would clip the panel. Fixed to the button's
     place on screen instead, and moved with it as anything scrolls. */
  document.body.appendChild(panel);
  panel.__btn = btn;          // so it can follow the button when anything scrolls
  placePanel(panel, btn);
  openPanel = panel;
  /* Captured, so a press anywhere else closes it before that press lands.
     Captured means it runs BEFORE the press reaches the panel, so the check
     is made here: a press INSIDE the panel is somebody using it, not leaving it. */
  setTimeout(function () {
    document.addEventListener("click", clickAway, true);
    document.addEventListener("keydown", pickerKey, true);
    /* Scroll is captured too, catching any box on the page. The header is sticky,
       so the panel follows its button rather than closing: closing would shut it
       through render()'s own scrollIntoView when a column is selected. */
    window.addEventListener("scroll", followButton, true);
  }, 0);
}

/** A press outside the panel puts it away; one inside is somebody using it. */
function clickAway(e) {
  if (openPanel && openPanel.contains(e.target)) { return; }
  // The button puts it away itself: closed here first, its own press would open it again.
  if (e.target.closest && e.target.closest(".lh-cols")) { return; }
  closePicker();
}

/** Keep the panel on its button, and close only if the button has gone. */
function followButton(e) {
  if (!openPanel) { return; }
  if (openPanel.contains(e.target)) { return; }   // the panel's own list scrolling
  var btn = openPanel.__btn;
  if (!btn || !btn.isConnected) { closePicker(); return; }
  placePanel(openPanel, btn);
}

/** Hang the panel under its button, or above it when there is no room below. */
function placePanel(panel, btn) {
  var r = btn.getBoundingClientRect();
  if (r.bottom <= 0 || r.top >= window.innerHeight) { closePicker(); return; }
  panel.style.top = Math.round(r.bottom + 4) + "px";
  panel.style.right = Math.round(window.innerWidth - r.right) + "px";
  // No wider than the room to its left, so its groups fold before the edge.
  panel.style.maxWidth = Math.max(200, Math.round(r.right - 8)) + "px";
  var h = panel.getBoundingClientRect().height;
  if (r.bottom + 4 + h > window.innerHeight - 8) {
    panel.style.top = Math.max(8, Math.round(r.top - 4 - h)) + "px";
  }
}

/* ---------- scrolling sideways ----------

   With every column on, the table is wider than its box, so the box scrolls.
   The title column is frozen at the left (css\xsegon.css), and `xscroll` on the
   list says the table is scrolled, which draws the shadow down the frozen column. */
export function initList() {
  $view.addEventListener("scroll", function () {
    if (!$view.classList.contains("list")) { return; }
    $view.classList.toggle("xscroll", $view.scrollLeft > 0);
  }, { passive: true });
}

/** Move the table sideways, for the keyboard and the pad. True if it moved. */
export function scrollListX(dir) {
  if (!$view.classList.contains("list")) { return false; }
  var most = $view.scrollWidth - $view.clientWidth;
  if (most <= 0) { return false; }               // nothing to reach
  var was = $view.scrollLeft;
  $view.scrollLeft = Math.max(0, Math.min(most, was + dir * 180));
  return $view.scrollLeft !== was;
}

/** The row's own selected state, kept here so views.js has one thing to call. */
export function rowClass(g, i) {
  return "row" + (i === sel ? " sel" : "") + (g.favourite ? " fav" : "") +
         (g.playable ? "" : " dead") + (g.hasVideo ? "" : " novid") +
         (g.cheats ? " cheaton" : "") + badgeClasses(g);
}
