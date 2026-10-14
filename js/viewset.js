/*  The view's own settings: how the games are sorted, which picture a tile
    shows, which marks are drawn, the consoles down the side. Each one is set,
    drawn and saved here; the menu bar (menus.js) and the list's headers only
    call in.                                                                */

import { listOwed, load } from "./library.js";
import { L } from "./log.js";
import { saveSetting } from "./savednote.js";
import { runThumbs } from "./settings-ui.js";
import { sound } from "./sound.js";
import { $body, $sort, $view, S, games, sel, setSel, view } from "./state.js";
import { render } from "./views.js";

// turned: which way round as well (a list header's menu); left out, the direction stays as it is.
export function setSort(v, turned) {
  L("SET", "sort " + v + (turned === undefined ? "" : turned ? ", turned round" : ", its usual way"));
  $sort.value = v;
  // Keep S in step the way setViewFlag does, or anything reading S.view.sort
  // (the list's column headers) sees the value this session started with.
  S.view = S.view || {};
  S.view.sort = v;
  var patch = { sort: v };
  if (turned !== undefined) { S.view.sortReverse = patch.sortReverse = !!turned; }
  load();
  saveSetting({ view: patch }, "The sort order");
}

/* A press on a list column header: the sorting column flips direction, another
   sorts its natural way. It goes through Arrange By's own values, so the menu,
   the dropdown and the headers can never disagree. */
export function sortHeader(key) {
  if ($sort.value === key) {
    setViewFlag("sortReverse", !(S.view && S.view.sortReverse));
    return;
  }
  if (S.view && S.view.sortReverse) {
    S.view.sortReverse = false;
    saveSetting({ view: { sortReverse: false } }, "The sort direction");
  }
  setSort(key);
}

// A view setting that changes what the server sends: set, reload, save.
export function setViewFlag(key, on) {
  L("SET", key + " " + (on ? "on" : "off"));
  S.view = S.view || {};
  S.view[key] = on;
  var keep = games[sel] && games[sel].id;
  /* Drawn once, here, when the list is in: the same game stays chosen. A sort
     turned round leaves the list where it is rather than chasing the chosen
     game; the same scroll is the same place only while undrawn rows stand in
     at a drawn row's height (css draw-near). */
  load({ noDraw: true }).then(function () {
    if (listOwed()) { return; }                    // a newer read is on its way, and draws
    var stay = key === "sortReverse" && (view === "list" || view === "grid" || view === "shelf");
    var down = $view.scrollTop, i = games.findIndex(function (g) { return g.id === keep; });
    if (i >= 0) { setSel(i); }
    render();
    if (stay) { $view.scrollTop = down; }
  });
  var payload = {};
  payload[key] = on;
  saveSetting({ view: payload }, { sortReverse: "The sort direction", groupHeaders: "Grouping under headers" }[key] || "That view setting");
}

/* Image Group: which art the grid's tiles show. The flag each kind needs on a
   game row sits beside its name, so a game without that art can fall back to
   its box instead of showing a hole. */
export var GRID_IMAGES = [["box", "Box art", "hasArt"], ["box3d", "3D box", "hasBox3d"], ["logo", "Clear logo", "hasLogo"],
                   ["shot", "Screenshot", "hasShot"], ["fanart", "Fanart", "hasFanart"], ["medium", "Cartridge or disc", "medium"]];
// A cartridge or a disc is shown as it comes: its picture is small already, so no small copy is built for it.
export function smallCopies(kind) { return kind !== "medium"; }
export var thumbsBy = {};                      // which kinds have a thumbnail cache (api/status.php)
export function setThumbsBy(v) { thumbsBy = v; }
var thumbsAsked = {};                   // builds this page has already started

export function gridImage() {
  var k = S.view && S.view.gridImage;
  return GRID_IMAGES.some(function (p) { return p[0] === k; }) ? k : "box";
}

// The kind this game's tile really shows: the chosen one, or the box.
export function tileKind(g) {
  var want = gridImage();
  for (var i = 0; i < GRID_IMAGES.length; i++) {
    if (GRID_IMAGES[i][0] === want && g[GRID_IMAGES[i][2]]) { return want; }
  }
  return g.hasArt ? "box" : "";
}

export function setGridImage(kind) {
  L("SET", "grid image " + kind);
  sound("select");
  S.view = S.view || {};
  S.view.gridImage = kind;
  render();
  var label = (GRID_IMAGES.filter(function (p) { return p[0] === kind; })[0] || [kind, kind])[1];
  saveSetting({ view: { gridImage: kind } }, "The picture the tiles show", "Saved: tiles show " + label);
  // Without a cache every tile is the full-size original, so that kind's small
  // copies are built once, the first time it is chosen. thumbsAsked is its own
  // record: the status poll says "not built" until the build finishes.
  if (smallCopies(kind) && !thumbsBy[kind] && !thumbsAsked[kind]) {
    thumbsAsked[kind] = true;
    runThumbs(kind);
  }
}

export function toggleHeroPanel() {
  S.view = S.view || {};
  S.view.heroPanel = S.view.heroPanel === false;
  render();
  saveSetting({ view: { heroPanel: S.view.heroPanel } }, "The info panel beside the list");
}

// The Badges menu's own words for each mark, for the line that says it was saved.
var BADGE_NAMES = { favourite: "Favourite", recent: "Recently played", unplayed: "Never played", dead: "Cannot launch",
                    edited: "Edited in Xsegon", docs: "Manual or guide", discs: "Disc set, as a playlist", onedisc: "Disc set, one disc only" };

export function badgesOn() {
  return (S.view && S.view.badges) || { favourite: true, dead: true };
}

/* Show badges, the Badges menu's first entry: off, none of the menu's marks
   is drawn, and each keeps its own setting for when it is on again. */
export function badgesShown() { return !(S.view && S.view.showBadges === false); }
export function noVideoMarked() { return !S.video || S.video.markMissing !== false; }
export function playersShown() { return !!(S.view && S.view.showPlayers); }

// Every mark's body class, from its own setting and Show badges together.
function paintBadges() {
  var all = badgesShown(), bd = badgesOn();
  Object.keys(BADGE_NAMES).forEach(function (key) { $body.classList.toggle("badge-" + key, all && !!bd[key]); });
  $body.classList.toggle("no-novid", !(all && noVideoMarked()));
  $body.classList.toggle("show-players", all && playersShown());
}

export function toggleShowBadges() {
  S.view = S.view || {};
  S.view.showBadges = !badgesShown();
  L("SET", "showBadges " + (S.view.showBadges ? "on" : "off"));
  sound("select");
  paintBadges();
  saveSetting({ view: { showBadges: S.view.showBadges } }, "Show badges", "Saved: badges " + (S.view.showBadges ? "shown" : "hidden"));
}

export function setBadge(key) {
  var bd = Object.assign({}, badgesOn());
  bd[key] = !bd[key];
  L("SET", "badge " + key + " " + (bd[key] ? "on" : "off"));
  sound("select");
  S.view = S.view || {};
  S.view.badges = bd;
  paintBadges();
  var mark = BADGE_NAMES[key] || key;
  saveSetting({ view: { badges: bd } }, "The " + mark + " mark", "Saved: " + mark + " mark " + (bd[key] ? "on" : "off"));
}

export function toggleShowPlayers() { setShowPlayers(!playersShown()); }

export function setShowPlayers(on) {
  L("SET", "showPlayers " + (on ? "on" : "off"));
  sound("select");
  S.view = S.view || {};
  S.view.showPlayers = on;
  paintBadges();
  saveSetting({ view: { showPlayers: on } }, "Player icons", "Saved: Player icons " + (on ? "on" : "off"));
}

export function toggleNoVideoMark() {
  var on = !noVideoMarked();
  L("SET", "badge novid " + (on ? "on" : "off"));
  sound("select");
  S.video = S.video || {};
  S.video.markMissing = on;
  paintBadges();
  saveSetting({ video: { markMissing: on } }, "The No video mark", "Saved: No video mark " + (on ? "on" : "off"));
}

/* The list's striped rows: one class on the body, so nothing is drawn again.
   Set away from the list, where nothing on screen shows it, the save says so. */
export function toggleListStripes() { setListStripes(!$body.classList.contains("list-stripes")); }

export function setListStripes(on) {
  L("SET", "listStripes " + (on ? "on" : "off"));
  sound("select");
  $body.classList.toggle("list-stripes", on);
  S.view = S.view || {};
  S.view.listStripes = on;
  saveSetting({ view: { listStripes: on } }, "Striped rows", view === "list" ? undefined : "Saved: Striped rows " + (on ? "on" : "off"));
}

/* The consoles down the left of the list and the grid. */
export function toggleSidebar() {
  S.view = S.view || {};
  S.view.sidebar = !S.view.sidebar;
  L("SET", "sidebar " + (S.view.sidebar ? "on" : "off"));
  render();
  saveSetting({ view: { sidebar: S.view.sidebar } }, "The platform sidebar");
}
