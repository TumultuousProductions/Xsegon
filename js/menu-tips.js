import { el } from "./util.js";

/* ---------- the menu tooltips ----------
 * Rest on an entry of any menu for a moment (TIP_WAIT) and a small card
 * beside the menu says what the entry does, or why it is greyed.
 *
 * "Rest on" means the entry the menu's bar is on: menus.js calls restMenuTip
 * from ctxFocus, the one place the mouse, the keys and the pad all move the bar
 * through. A greyed entry can never wear the bar, so it is armed by the pointer
 * alone (byHover). The words are the entry's own (en.tip in menus.js, data-tip).
 *
 * A card that outlives its row is worse than no card (as js\settings-tips.js):
 * it takes no pointer events, anything that moves the bar or closes the menu
 * puts it away, and a watchdog every 400ms puts it away if its row is gone.
 * One clock, one watchdog, one card, and every path here clears all three. */
var TIP_WAIT = 1000;                      // shorter than Settings (1500): a menu is used faster

/* Every sentence, in one place, so they can be read and reworded together.
   One or two short sentences each: what the entry does, and the one thing
   worth knowing before pressing it. menus.js, systems.js and library.js
   name them by key. The few that depend on the game (why Play is greyed)
   are put together where the game is known. */
export var TIPS = {
  // a game's right-click menu
  playDirect: "Starts the game's own program and skips Steam, for when Steam or the internet is not there.",
  playDirectOff: "Xsegon did not find this game's own program, so only Steam can start it.",
  states: "The saves RetroArch has made for this game. Choose one to play from it, or press Esc to only look.",
  docs: "Its manual, maps and guides.",
  fav: "Favourites wear a star, and Filter by can show only them.",
  tags: "Short labels of your own. Filter by can narrow the library to the games that carry one.",
  editMeta: "Change the title, description, genre and the rest. Every field can be put back to what it was.",
  editLocal: "Change this game's title, its program and its details.",
  pictures: "Choose the box, logo, screenshot and background this game shows. Reset brings the original back.",
  pasteBox: "The picture you copied becomes this game's box art. The first time, the browser asks to let Xsegon see what you copied. Change Pictures can put the original back.",
  video: "The short video that plays when you rest on this game.",
  emulation: "The core, the controls and the cheats for this game, and RetroArch itself.",
  explorer: "Open the folder that holds this game's file, its pictures or its video.",
  core: "Which RetroArch core runs this game. Only this game changes.",
  emulator: "Which emulator starts this game, among those its console has. The console's own can be changed there too.",
  controls: "The buttons as the emulator has them for this console. Read only: nothing here can change them.",
  cheats: "Switch cheats on for this game. They apply the next time it starts.",
  retroarch: "Opens RetroArch by itself, for its settings, its cores and its controller mapping.",
  emuAlone: "Opens the emulator this game runs in by itself, for its settings and its controller mapping.",
  noImages: "This game has no pictures yet.",
  noVideo: "This game has no video yet.",
  removeLocal: "Takes this game off the list, after asking. Its pictures and play history stay on the disk.",
  hide: "Takes it out of sight. Settings > Library shows it again.",
  del: "Takes it out of your library, after asking. No file on the disk is deleted, and Settings > Library can put it back.",
  // The bar: Xsegon, Games, Get Media, Emulators, Help
  getMedia: "Every way to get pictures, videos and more for many games at once, in one window: Get Pictures, Steam trailers, ScreenScraper, online archives and video packages.",
  random:"Jumps to a game picked at random.",
  guide: "The first steps for a new library, in order: an emulator, your games, their names and pictures.",
  lbImport: "Asks for your LaunchBox folder and brings in its list of games and your play data. Nothing of LaunchBox's pictures, videos or sounds comes with it.",
  scan: "Looks through your game folders and offers what the library does not have. Nothing is added until you select it.",
  fillAll: "Looks up every scanned game and gets the pictures, name and details of each one it is sure of, in the background: a bar in the corner says how far it is. Only empty fields are filled.",
  fill: "Shows what each scanned game was matched to, the doubtful ones apart, and waits, so you choose which games to get pictures, names and details for. Only empty fields are filled.",
  steam: "Adds the games Steam has installed, with Steam's own pictures. Run it again after installing something.",
  steamvid: "Fetches Steam's trailer for each Steam game that has no video.",
  sscraper: "Fetches a short video for each game that has none. Needs a ScreenScraper login.",
  archivevid: "Fetches a short video for each game that has none, from the Internet Archive's sets and World of Longplays playthroughs. No account. You choose the consoles first.",
  archivedoc: "Fetches the manual for each game that has none, from the Internet Archive's sets of manuals. No account. You choose the consoles first.",
  getall: "Fetches every missing cover, video and manual in one press, every source at once. With a ScreenScraper account you choose where each comes from first.",
  vpExport: "Writes a list of the games here that have no video, for a video package to be made from.",
  vpImport: "Puts the videos of a package onto the games here that have none.",
  missing: "Lists the games whose files are gone from the disk, to take out of the library together.",
  fileCheck: "What each game's file really is, by its checksum: region and revision, or a translation, a hack or a patch. Files are never changed.",
  hackSettle: "The games that may be hacks, each with the game Xsegon would name for it: say yes, another game, or no hack. A hack shows in the Hacks tab of the game it comes from.",
  wanted: "Every game on record for a console that is not in your library. Star the ones you want and export them as a list.",
  fanProjects: "Hacks, mods and PC versions made from games you own: each one checked against your copy, with a way to the team that made it.",
  extensions: "Programs Xsegon works with, such as Flashpoint for web games: found on this PC, or fetched from their makers when you press for it.",
  runcheck: "Starts each game for a few seconds to see which ones boot. Games open on the screen while it runs.",
  bios: "Which consoles need startup files of their own, and whether they are in place. It never downloads one.",
  emuAdd: "Adds an emulator of your own, such as Dolphin or PCSX2: choose its program, select its consoles, and their games start in it.",
  emuSettings: "Which emulator each console uses and where each one is. Opens Settings at Emulators.",
  emuMove: "Copies the emulators that sit inside LaunchBox's folder into a folder of your own and starts the copies from then on. LaunchBox's own are left as they are.",
  planned: "Planned. Not built yet.",
  controller: "A picture of your controller that lights up as you press, with the way to set what each button does in Xsegon.",
  phone: "Lets a phone on the home Wi-Fi browse your games and start one on this PC. Closed until you switch it on here.",
  backup: "Saves what only you have (settings, favourites, tags, edits) and restores it, part by part. Export and Import carry it to a stick or another PC.",
  data: "Opens the folder Xsegon keeps everything in: settings, favourites, logs.",
  add: "Add one game by hand, or scan a folder of them.",
  whatsnew: "What changed in each version, newest first.",
  log: "What Xsegon has been doing, line by line. The place to look when something went wrong.",
  report: "Checks for the usual problems first. It can also make a zip to send, and says what is in it.",
  about: "Xsegon's version, its licence and who makes it, whatever name and logo this copy wears.",
  tumultuous: "The person who makes Xsegon: free help, paid help if you want it, how to tell it is really them, and the games they are making.",
  // View
  list: "One line per game, in columns you can sort and choose.",
  grid: "A wall of pictures.",
  shelf: "The games standing side by side by the sides of their boxes.",
  wheel: "A turning wheel of games, one chosen at a time.",
  carousel: "A row of covers, the chosen one in the middle.",
  rows: "Rows of covers like a streaming app: Continue playing, Favourites, then a row for each genre.",
  filter: "Narrow the library: favourites, two players or more, ready to play, never played, and your tags. They stack.",
  hero: "The panel that shows the chosen game's picture and details.",
  sidebar: "The consoles down the left side of the list and the grid.",
  stripes: "In the List view, every other row a shade apart, so a wide table is easier to follow across.",
  contrast: "Brighter words and stronger edges.",
  theme: "The colours of everything. Xsegon is the look it comes with: its accent colour, glow and scanlines wait while another theme is on.",
  themeFamily: "A family of themes: one look in several shades. Opens the list of them.",
  // Arrange By
  plays: "By how many times each game was played.",
  myrating: "By the stars you gave, most first. Games you have not rated come last.",
  playtime: "By the total time played.",
  recent: "The games played last come first.",
  shuffle: "A new shuffle each time.",
  group: "Puts a heading above each group: each letter, developer, genre, whatever the order is by.",
  // Image Group
  noSuchPicture: "A game with none of these shows its box instead.",
  // Badges
  bAll: "Every mark below at once. Off, none of them is drawn, and each keeps its own setting.",
  bWaits: "Show badges is off, so no mark is drawn. Its own setting is kept.",
  bDocs: "Marks the games that have a manual, a map or a guide to open.",
  bFavourite: "A star on your favourites.",
  bNoVideo: "Marks the games that have no video.",
  bRecent: "Marks the games played in the last 30 days.",
  bUnplayed: "Marks the games you have not played yet.",
  bDead: "Marks the games that cannot start.",
  bEdited: "Marks the games whose details you changed in Xsegon.",
  bDiscs: "Marks a game of several discs that is filed as one playlist, so its discs can be changed while playing.",
  bOneDisc: "Marks a game of several discs that is filed disc by disc, with that disc's number.",
  bPlayers: "Small figures for how many can play, on the carousel and the wheel.",
  playersOff: "Badges > Player icons brings them back.",
  // Filter by
  ready: "Leaves out the games whose file or drive is not there right now.",
  unrated: "Only the games you have not given stars of your own. The stars are set in a game's details.",
  missingArt: "Only the games that lack a picture of some kind, or their video. The list's Missing art column says which.",
  docsOnly: "Only the games that have a manual, a map or a guide. D opens them.",
  cheatsOn: "Only the games that start with cheats you selected.",
  hacksOnly: "Only the games marked HACK.",
  noHacks: "Every game but the ones marked HACK.",
  texPacks: "Only the games with a texture pack: one listed in their Texture packs tab, or one installed.",
  texInstalled: "Only the games with a texture pack Xsegon installed that is still in place.",
  minRating: "Only the games you gave at least this many stars. Press a star, or press the row to step it up a star; after five it is off again.",
  // a console's right-click menu
  sysEmpty: "No games here yet.",
  sysPictures: "Choose this console's logo and its picture."
};
var tip = null, tipWait = null, tipWatch = null, tipOn = null, tipHover = false;

export function hideMenuTip() {
  if (tipWait) { clearTimeout(tipWait); tipWait = null; }
  if (tipWatch) { clearInterval(tipWatch); tipWatch = null; }
  tipOn = null;
  if (tip) { tip.hidden = true; }
}

// The menu and a group's box beside it, as one width: the card stands outside both.
function menuSpan() {
  var left = Infinity, right = -Infinity;
  document.querySelectorAll(".ctx").forEach(function (b) {
    var q = b.getBoundingClientRect();
    left = Math.min(left, q.left);
    right = Math.max(right, q.right);
  });
  return { left: left, right: right };
}

// True when the row the card belongs to is no longer the row rested on.
function tipGone() {
  return !tipOn || !tipOn.isConnected ||
    (tipHover ? !tipOn.matches(":hover") : !tipOn.classList.contains("at"));
}

function showTip() {
  tipWait = null;
  if (tipGone()) { hideMenuTip(); return; }
  var menu = tipOn.closest(".ctx");
  var label = tipOn.querySelector(".ctx-label");
  if (!menu || !label || !tipOn.dataset.tip) { hideMenuTip(); return; }
  if (!tip) {
    // One card for the app's lifetime, on body so nothing can clip it.
    tip = el("div", "ctx-tip");
    document.body.appendChild(tip);
  }
  tip.textContent = "";
  tip.appendChild(el("div", "tip-name", label.textContent));
  tip.appendChild(el("div", "tip-body", tipOn.dataset.tip));
  tip.hidden = false;
  /* Beside the menu, level with the entry, and never over the menu: on
     the right when there is room, on the left when not. Only a window too
     narrow for either gets it under the entry (over it at the bottom
     edge). Measured at a known spot first, because a card still at its
     last place measures wrapped. */
  tip.style.left = "0px";
  tip.style.top = "0px";
  var m = menuSpan(), r = tipOn.getBoundingClientRect();
  var w = tip.offsetWidth, h = tip.offsetHeight;
  var left = m.right + 8, top = r.top;
  if (left + w > window.innerWidth - 8) { left = m.left - 8 - w; }
  if (left < 8) {
    left = Math.max(8, Math.min(m.left, window.innerWidth - w - 8));
    top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) { top = r.top - h - 6; }
  }
  tip.style.left = Math.round(left) + "px";
  tip.style.top = Math.round(Math.max(8, Math.min(top, window.innerHeight - h - 8))) + "px";
  tipWatch = setInterval(function () { if (tipGone()) { hideMenuTip(); } }, 400);
}

/* The bar came to rest on this row (or, byHover, the pointer on a greyed
   one). The same row again keeps its clock: a mouse moving within one entry
   calls this on every pixel. */
export function restMenuTip(node, byHover) {
  if (node && node === tipOn && !!byHover === tipHover) { return; }
  hideMenuTip();
  if (!node || !node.dataset || !node.dataset.tip || node.classList.contains("open")) { return; }
  tipOn = node;
  tipHover = !!byHover;
  tipWait = setTimeout(showTip, TIP_WAIT);
}

// The pointer left a greyed row: its card goes, nobody else's.
export function leaveMenuTip(node) {
  if (tipHover && tipOn === node) { hideMenuTip(); }
}

/* The menu scrolled under the card (a long list of tags): the entry has
   moved, so the card goes and the clock starts again for the same row. */
export function menuTipScrolled() {
  var node = tipOn, byHover = tipHover;
  if (!node) { return; }
  hideMenuTip();
  restMenuTip(node, byHover);
}
