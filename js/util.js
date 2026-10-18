/*  The small things everything uses: making an element, where a picture
    lives, a rating in stars, minutes as hours, and the press-not-release
    rule for closing a panel by its backdrop.                               */

// ---------- helpers ----------

/* A game's title, and for one sharing its console and title with another the
   words off its file name that tell it apart (includes\import.php,
   xs_apply_variants). Every screen that names a game to choose it by goes through here. */
export function titleText(g) {
  return g && g.variant ? g.title + "  (" + g.variant + ")" : (g ? g.title : "");
}

export function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) { n.className = cls; }
  if (text !== undefined) { n.textContent = text; }
  return n;
}

/* The console after a card's title (Settings > View > Show the platform
   beside the title), only where the games on screen are from more than one
   console: inside a single console every card would say the same thing. */
export function platformBeside(cap, g) {
  var st = (window.XSEGON && window.XSEGON.settings) || {};
  var open = (document.getElementById("platform") || {}).value || "";
  if (!(st.view && st.view.showPlatformInTitle) || !g || !g.platform || (open !== "" && open.charAt(0) !== "@")) { return; }
  cap.appendChild(el("span", "cap-plat", "  ·  " + g.platform));
}

// Every game image address comes from here. artRev, the age of an image
// replaced in Xsegon, makes a replaced image a NEW address, so the browser
// can never answer it from its cache with the old picture.
export function artUrl(g, kind, full) {
  // A picture already a file of Xsegon's own (a thumbnail, a replaced image, a
  // copy) comes with its plain address, which carries its age. Anything else
  // is asked of api\image.php.
  var own = full ? (g.imgFull && g.imgFull[kind]) : (g.img && g.img[kind]);
  if (own) { return own; }
  return "api/image.php?id=" + encodeURIComponent(g.id) + "&kind=" + kind +
         (full ? "&size=full" : "") + (g.artRev ? "&v=" + g.artRev : "");
}

/* ---------- badges ----------
   The marks a game can wear, as classes on its node and glyphs in a strip.
   The stylesheet draws a mark only while badge-<name> is on the body, so the
   Badges menu is one class per switch and no node is rebuilt. Favourite,
   no-video and cheats keep their own places; the same strip serves the list,
   the grid and the carousel so they cannot disagree about a game. */
var BADGES = [
  ["recent",   "⏱", "played in the last 30 days", function (g) { return !!g.lastPlayed && (Date.now() - Date.parse(g.lastPlayed)) < 30 * 86400000; }],
  ["unplayed", "✦", "never played",                function (g) { return !g.plays; }],
  ["dead",     "⚠", "cannot launch",               function (g) { return !g.playable; }],
  ["edited",   "✎", "edited in Xsegon",            function (g) { return !!g.edited; }],
  ["docs",     "▤", "has a manual, a map or a guide: D opens them", function (g) { return !!g.docs; }],
  // Disc sets, only for games whose files prove they are one of several discs
  // (g.discs, xs_disc_info in includes\scan.php). The warning wears its disc's number.
  ["discs",    "◎", function (g) { return discWords(g); }, function (g) { return !!(g.discs && g.discs.set); }],
  ["onedisc",  function (g) { return String.fromCharCode(0x2460 + Math.min(19, Math.max(0, g.discs.disc - 1))); },
               function (g) { return discWords(g); },    function (g) { return !!(g.discs && !g.discs.set); }],
  // A hack, and a game that may be one until you say (includes/hackof.php). Always shown: no Badges switch.
  ["hack",     "HACK",  "a hack: its own Hacks tab says of which game", function (g) { return g.hack === "yes"; }],
  ["hackq",    "HACK?", "may be a hack: say in its Hacks tab, or in Games > Hacks to settle", function (g) { return g.hack === "ask"; }]
];

/*  What a disc set means for playing it, in one sentence, for the badge's
    hover, the info panel, the rows band and details: the same words
    everywhere. "" for a game not known to be one of several discs. */
export function discWords(g) {
  var d = g && g.discs;
  if (!d) { return ""; }
  if (d.acc) { return d.n + " discs: Play starts the game, and " + (d.acc === 1 ? "the other is" : d.acc + " are") + " in its Files tab, not played"; }
  if (d.set && d.pick) { return d.n + " discs, each its own file: " + (g.chosen ? "Play starts the selected disc" : "Play asks which disc to start"); }
  if (d.set) { return d.n + " discs, as a playlist: change disc in the emulator"; }
  return "Disc " + d.disc + " of a set, no playlist: the other discs cannot be reached from here" +
         (d.onDisk >= 2 ? ". Games > Scan for Games can build one" : ". Its other discs are not in its folder");
}
// And in two or three words, for a pill.
export function discShort(g) {
  var d = g && g.discs;
  if (!d) { return ""; }
  if (d.acc) { return d.n + " discs · " + d.acc + " accompanied"; }
  return d.set ? d.n + " discs · " + (d.pick ? (g.chosen ? "one selected" : "pick at Play") : "playlist") : "Disc " + d.disc + " only · no playlist";
}
/*  How many can play (view.showPlayers). Nothing for a game nobody gave a
    count: a guess would be worse than a gap. The stylesheet shows it only
    while body.show-players is on. */
/*  As figures rather than "1P" / "2P", so it reads without the language: one
    red figure alone, two green side by side, a digit beside them from three up.
    The words are in the label; the drawing is a fixed string, never from a game. */
var FIGURE_ONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4.2"/><path d="M3.5 22c0-4.7 3.8-8.5 8.5-8.5s8.5 3.8 8.5 8.5z"/></svg>';
var FIGURE_TWO = '<svg viewBox="0 0 34 24" aria-hidden="true"><circle cx="10" cy="7" r="3.8"/><path d="M2.5 22c0-4.1 3.4-7.5 7.5-7.5s7.5 3.4 7.5 7.5z"/>' +
                 '<circle cx="24" cy="7" r="3.8"/><path d="M16.5 22c0-4.1 3.4-7.5 7.5-7.5s7.5 3.4 7.5 7.5z"/></svg>';
export function playersIcon(g, cls) {
  var n = Number(g.players) || 0;
  if (n <= 0) { return null; }
  var s = el("span", "gpl " + cls + (n === 1 ? " pl-one" : " pl-more"));
  s.innerHTML = n === 1 ? FIGURE_ONE : FIGURE_TWO;
  if (n > 2) { s.appendChild(el("span", "pl-n", String(n))); }
  var words = n === 1 ? "1 player" : n + " players";
  s.title = words;
  s.setAttribute("aria-label", words);
  s.setAttribute("role", "img");
  return s;
}

/*  A game that needs fixing (api\library.php needsFix: its last launch failed,
    or the runs check could not start it) is greyed a little and wears NEEDS FIX
    across its art wherever it shows. Safe to call again on a frame that shows
    one game after another. Its hover text says why and how the mark comes off,
    on the card and the stamp (for the list); unmarked, the card's own text is put back. */
var FIX_CLEARS = "It will be unmarked on its next successful play from Xsegon.";
// One you marked yourself (the "needs fix" tag) is yours to take off.
var FIX_MINE = "It stays until you take the needs fix tag off (right-click, Tags...).";
export function fixWords(g) {
  return g && g.needsFix ? "Needs fix: " + g.needsFix + "\n" + (g.needsFixMine ? FIX_MINE : FIX_CLEARS) : "";
}
export function fixMark(n, g) {
  if (!n) { return n; }
  var why = (g && g.needsFix) || "";
  var words = fixWords(g);
  n.classList.toggle("needsfix", !!why);
  var m = n.querySelector(":scope > .fixmark");
  if (why && !m) { m = el("span", "fixmark", "NEEDS FIX"); n.appendChild(m); }
  if (m) { m.hidden = !why; m.title = words; }
  if (why) {
    if (n.dataset.ownTitle === undefined) { n.dataset.ownTitle = n.title; }
    n.title = (n.dataset.ownTitle ? n.dataset.ownTitle + "\n" : "") + words;
  } else if (n.dataset.ownTitle !== undefined) {
    n.title = n.dataset.ownTitle;
    delete n.dataset.ownTitle;
  }
  return n;
}

export function badgeClasses(g) {
  return BADGES.filter(function (b) { return b[3](g); }).map(function (b) { return " b-" + b[0]; }).join("");
}
// The strip of small marks, and a card holding several versions (below)
// wears its stack in front of them: one call, so every card that shows the
// marks shows the stack too, the grid, the carousel and the list alike.
export function badgesEl(g) {
  var strip = el("span", "bdg");
  BADGES.forEach(function (b) {
    if (!b[3](g)) { return; }
    var m = el("span", "b-" + b[0], typeof b[1] === "function" ? b[1](g) : b[1]);
    m.title = typeof b[2] === "function" ? b[2](g) : b[2];
    strip.appendChild(m);
  });
  var v = versionsBadge(g);
  if (!v) { return strip; }
  var both = document.createDocumentFragment();
  both.appendChild(v);
  both.appendChild(strip);
  return both;
}

/* Several versions of one game on one card (api\library.php): a stack and a
   count on the art, and on pointing a box that says what is inside. The box
   floats over the page, one for the page, because every card clips what spills past it. */
var STACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="12" height="15" rx="1.5"/>' +
            '<path d="M5 7v12.5c0 .8.7 1.5 1.5 1.5H16" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
export function versionLabel(v) {
  return v.variant || v.file || v.title;
}
// The versions fact in details: every version, the selected one said (js\versionstab.js).
export function versionsFact(g) {
  return g.versions.map(function (v) { return versionLabel(v) + (g.chosen === v.id ? " (selected)" : ""); }).join("  ·  ");
}
export function versionsBadge(g) {
  var n = g && g.versions ? g.versions.length : 0;
  if (n < 2) { return null; }
  var b = el("span", "vbadge");
  b.innerHTML = STACK;
  b.appendChild(el("span", "vb-n", String(n)));
  b.setAttribute("role", "img");
  b.setAttribute("aria-label", "Contains " + n + " versions");
  b._xsVersions = g.versions;
  b._xsGame = g;            // the shared row, so the tip reads a selection made while the badge stands
  return b;
}
var tipEl = null;
export function initVersionTips() {
  document.addEventListener("mouseover", function (e) {
    var b = e.target.closest ? e.target.closest(".vbadge") : null;
    if (!b || !b._xsVersions) { return; }
    if (!tipEl) { tipEl = el("div", "vtip"); document.body.appendChild(tipEl); }
    tipEl.textContent = "";
    tipEl.appendChild(el("div", "vtip-head", "Contains " + b._xsVersions.length + " versions"));
    var picked = null;      // the one selected in details > Versions, if any
    b._xsVersions.forEach(function (v) { if (b._xsGame && v.id === b._xsGame.chosen) { picked = v; } });
    b._xsVersions.forEach(function (v) { tipEl.appendChild(el("div", "vtip-row", versionLabel(v) + (picked === v ? "  ·  selected" : ""))); });
    tipEl.appendChild(el("div", "vtip-foot", picked && picked.playable ? "Play starts the selected one" : "Play asks which one"));
    tipEl.hidden = false;
    var r = b.getBoundingClientRect();
    tipEl.style.left = Math.max(8, Math.min(r.left, innerWidth - tipEl.offsetWidth - 8)) + "px";
    tipEl.style.top = (r.bottom + 6 + tipEl.offsetHeight > innerHeight ? r.top - tipEl.offsetHeight - 6 : r.bottom + 6) + "px";
  });
  document.addEventListener("mouseout", function (e) {
    var b = e.target.closest ? e.target.closest(".vbadge") : null;
    if (b && tipEl && !b.contains(e.relatedTarget)) { tipEl.hidden = true; }
  });
}

export function hhmm(seconds) {
  if (!seconds) { return ""; }
  var h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
  return h > 0 ? h + "h " + m + "m" : m + "m";
}

// ---------- stars ----------
// A rating is a picture in every front end, not "4.2 / 5": five dim stars
// behind, a bright row clipped to the score in front.

export function stars(r) {
  var w = el("span", "stars");
  w.appendChild(el("span", "stars-bg", "★★★★★"));
  var f = el("span", "stars-fill", "★★★★★");
  f.style.width = (Math.max(0, Math.min(5, r)) / 5 * 100) + "%";
  w.appendChild(f);
  w.title = r.toFixed(1) + " / 5";
  return w;
}

/* Clicking the dark behind a panel closes it, on the press, not the release:
   a text selection let go past the panel's edge is a release on the dark. */
export function closeOnBackdrop(host, close) {
  host.addEventListener("mousedown", function (e) {
    if (e.target === host && e.button === 0) { close(); }
  });
}

// "1 game", "3 games": a number with the word for one or for many.
export function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

// "a, b and c": names joined the way a sentence says them.
export function namesAnd(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }

// A size in whole megabytes: "70 MB".
export function megabytes(bytes) { return Math.round((bytes || 0) / 1048576) + " MB"; }

/* The mouse wheel moves a row that scrolls sideways (the save picker, Documents' tabs), one
   item a notch, as the Rows view's rows do. At either end it lets go: the window scrolls. */
export function wheelSideways(box) {
  box.addEventListener("wheel", function (e) {
    if (!e.deltaY || e.deltaX || e.shiftKey) { return; }       // a sideways gesture, or Shift, already goes sideways
    var can = e.deltaY > 0 ? box.scrollLeft + box.clientWidth < box.scrollWidth - 2 : box.scrollLeft > 2;
    if (!can) { return; }
    e.preventDefault();
    var first = box.firstElementChild;
    var step = first ? first.getBoundingClientRect().width + (parseFloat(getComputedStyle(box).columnGap) || 0) : 130;
    box.scrollBy({ left: (e.deltaY > 0 ? 1 : -1) * step, behavior: "smooth" });
  }, { passive: false });
}

// Where a person writes in, and sends the file Help > Report a problem makes.
export var HELP_MAIL = "help@tumultuousproductions.site";
