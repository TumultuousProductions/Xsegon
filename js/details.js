import { cheatsFact } from "./cheattab.js";
import { detailTabs, detailTabsOff, openTab, tabPane } from "./detailtabs.js";
import { openDocs } from "./docs.js";
import { dropExtPage } from "./extensions.js";
import { dropFanPage } from "./fanprojects.js";
import { openGameButtons } from "./gamebtns.js";
import { paintHelp } from "./help.js";
import { launch, launchNow, openStates, showStrip, whenSaved } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { addsMissing } from "./missing.js";
import { getRetroArch, raLabel } from "./raoffer.js";
import { rowsStale } from "./rows.js";
import { rowStarsAgain } from "./rowstars.js";
import { armBrowse, armVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $body, $details, $main, $toolbar, games, sel, sysStage } from "./state.js";
import { startOnAllGames } from "./systems.js";
import { texPackFact } from "./texpacktab.js";
import { dropTpPage } from "./tppage.js";
import { artUrl, discWords, el, fixMark, fixWords, hhmm, stars, titleText, versionInUse, versionsFact } from "./util.js";
import { render, setCarNodes, setWheelNodes } from "./views.js";

// ---------- details ----------
// Where video goes, when there is any: an addition beside the art, never a
// replacement for the tile.

/* In the same window as the wheel: the wheel (and toolbar) hide, details
   stands where they stood, Back swaps them straight back. Built twice:
   at once from the row so nothing waits, then again from api\game.php's full record. */
/* The star that makes a favourite: the click writes to Xsegon's own overlay
   (data\favourites.json), which outranks the imported flag both ways. */
export function favStar(g) {
  var b = el("button", "favbtn" + (g.favourite ? " on" : ""),
             g.favourite ? "★" : "☆");
  b.title = g.favourite ? "Unfavourite" : "Favourite";
  b.addEventListener("click", function (e) {
    e.stopPropagation();
    toggleFav(g);
    // render() repaints the hero and its star; the star in details is not
    // rebuilt by that, so it is brought up to date by hand.
    b.textContent = g.favourite ? "★" : "☆";
    b.classList.toggle("on", g.favourite);
    b.title = g.favourite ? "Unfavourite" : "Favourite";
  });
  return b;
}

/* Your own rating, beside the library's: five stars in the magenta that marks what
   is yours. A click sets it, a click on the rating it has takes it off. Saved to
   Xsegon's own data\my-ratings.json (api\my-rating.php), like a favourite. */
export function myStars(g) {
  var w = el("span", "mystars");
  w.setAttribute("role", "group");
  w.setAttribute("aria-label", "My rating");
  var marks = [];
  function paint(n) {
    marks.forEach(function (b, i) { b.classList.toggle("on", i < n); });
    w.title = g.myRating ? "Yours: " + g.myRating + " of 5. Click the same star to take it off." : "Not rated by you. Click a star.";
  }
  [1, 2, 3, 4, 5].forEach(function (n) {
    var b = el("button", "mystar", "★");
    b.type = "button";
    b.setAttribute("aria-label", n + (n === 1 ? " star" : " stars"));
    b.addEventListener("mouseenter", function () { paint(n); });
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      rateGame(g, g.myRating === n ? 0 : n);
      paint(g.myRating);
    });
    marks.push(b);
    w.appendChild(b);
  });
  w.addEventListener("mouseleave", function () { paint(g.myRating || 0); });
  w.repaint = function () { paint(g.myRating || 0); };   // for a rating the server would not keep
  paint(g.myRating || 0);
  return w;
}

function rateGame(g, n) {
  var was = g.myRating || 0;
  L("RATE", g.title + " " + (n ? n + " of 5" : "off"));
  g.myRating = n;                                     // instant, then saved
  sound("select");
  starsAgain(g);
  postJson("api/my-rating.php", { id: g.id, stars: n }).then(function (r) {
    if (r.ok) { markVersions(r.ids, g, function (x) { x.myRating = n; rowStarsAgain(x); }); return; }
    g.myRating = was;
    starsAgain(g);
    showStrip("Rating not saved: " + (r.error || "the server said no"), true);
  });
}

/* A mark is kept on every version of a game (includes\versions.php), and the
   answer names them: the other rows of it in the list (Show every version)
   wear it at once. How many, for the log. */
function markVersions(ids, g, apply) {
  var n = 0;
  games.forEach(function (x) { if (x !== g && (ids || []).indexOf(x.id) >= 0) { apply(x); n++; } });
  if (n) { L("VERS", g.title + ": the same mark shown on " + n + " other row" + (n === 1 ? "" : "s") + " of it in the list"); }
  return n;
}

// Wherever a game's stars stand they say the same: its details, the panel beside the list, its row.
function starsAgain(g) {
  document.querySelectorAll(".mystars").forEach(function (x) { if (x.repaint) { x.repaint(); } });
  rowStarsAgain(g);
}

/* The players line: the imported number where there is one, and its words
   beside it. The number is what the Two players collection is built on, so
   showing it is how a game explains why it is in there (or is not). */
function playersLine(n, mode) {
  n = n || 0;
  var num = n >= 2 ? "up to " + n : (n === 1 ? "one player" : "");
  return [num, mode].filter(Boolean).join("  ·  ");
}

// Shared by the star and the right-click menu.
export function toggleFav(g) {
  L("FAV", (g.favourite ? "off " : "on ") + g.title);
  g.favourite = !g.favourite;                         // instant, then saved
  sound("select");
  // The wheel and carousel keep their nodes between renders, and the
  // star/tag is baked into them at build time -- so the view behind the
  // details has to be rebuilt, or Back returns to a stale favourite tag.
  setWheelNodes(null);
  setCarNodes(null);
  rowsStale();                                        // the Favourites row changes
  render();
  postJson("api/favourite.php", { id: g.id, fav: g.favourite }).then(function (r) {
    if (r.ok) {
      if (markVersions(r.ids, g, function (x) { x.favourite = g.favourite; })) { setWheelNodes(null); setCarNodes(null); render(); }
      return;
    }
    // Not saved: the star goes back and says why, as a tag does.
    g.favourite = !g.favourite;
    setWheelNodes(null);
    setCarNodes(null);
    rowsStale();
    render();
    showStrip("Favourite not saved: " + (r.error || "the server said no"), true);
  });
  // A press deserves an answer: whichever star is on screen pops once.
  // After the repaint, because render() just rebuilt the node it lives on.
  if (g.favourite && !$body.classList.contains("no-anim")) {
    requestAnimationFrame(function () {
      var b = document.querySelector("#details .favbtn") || document.querySelector(".favbtn");
      if (!b) { return; }
      b.classList.remove("pop");
      void b.offsetWidth;                  // restart the animation
      b.classList.add("pop");
      setTimeout(function () { b.classList.remove("pop"); }, 420);
    });
  }
}

/* What else came in the box, under the facts: the side of the
   box, laid down so its words read across, and the cartridge or the disc.
   Each comes with its size (api\library.php), so a spine that stands
   upright in its picture, taller than wide, is the one that gets turned. */
function boxKit(g) {
  if (!g.spine && !g.medium) { return null; }
  var kit = el("div", "dkit");
  if (g.spine) {
    var sp = g.spine, upright = sp.h > sp.w;
    var strip = el("div", "dspine");
    strip.style.setProperty("--lr", String(upright ? sp.h / sp.w : sp.w / sp.h));
    var s = el("img", upright ? "upright" : null);
    s.src = sp.url;
    s.alt = "The side of the box";
    strip.appendChild(s);
    kit.appendChild(strip);
  }
  if (g.medium) {
    var m = el("img", "dmedium is-" + g.medium.kind);
    m.src = g.medium.url;
    m.alt = g.medium.kind === "disc" ? "The disc" : "The cartridge";
    m.title = m.alt;
    kit.appendChild(m);
  }
  return kit;
}

/* Cover, title and every fact in the LEFT column; the right column is the
   words -- Back and Play up top, then the description with the whole
   height to scroll in. */
function buildDetails(g, full) {
  $details.textContent = "";

  var left = el("div", "dleft");
  var coverEl = null;
  if (g.hasArt) {
    var img = el("img", "cover");
    coverEl = img;
    img.src = artUrl(g, "box", true);
    img.alt = g.title;
    if (g.needsFix) {                    // a frame for NEEDS FIX to lie across (util.js fixMark)
      var fixFrame = el("div", "cover-fix");
      fixFrame.appendChild(img);
      left.appendChild(fixMark(fixFrame, g));
    } else {
      left.appendChild(img);
    }
  } else {
    left.appendChild(addsMissing(el("div", "hero-noart cover-noart", "NO ART"), function () { return g; }, "art"));
  }
  // Why, in words, for a game that needs fixing, before anything else.
  if (g.needsFix) { var fixWhy = el("p", "fix-why", "Needs fix: " + g.needsFix); fixWhy.title = fixWords(g); left.appendChild(fixWhy); }

  var titleRow = el("h2");
  titleRow.appendChild(document.createTextNode(titleText(g) + " "));
  titleRow.appendChild(favStar(g));
  left.appendChild(titleRow);

  left.appendChild(el("p", "meta", [g.platform, g.released ? g.released.slice(0, 4) : "",
                                    g.genre].filter(Boolean).join("  ·  ")));
  if (!g.hasVideo) {
    var lacks = el("p", "dlacks");
    lacks.appendChild(addsMissing(el("span", "pill novid-pill", "no video"), function () { return g; }, "video"));
    left.appendChild(lacks);
  }

  var dl = el("dl");
  function pair(k, v) {
    if (!v && v !== 0) { return; }
    dl.appendChild(el("dt", null, k));
    dl.appendChild(el("dd", null, String(v)));
  }
  // The library's rating and yours, named like every other fact.
  function pairEl(k, node) {
    dl.appendChild(el("dt", null, k));
    var dd = el("dd");
    dd.appendChild(node);
    dl.appendChild(dd);
  }
  pairEl("global rating", g.rating ? stars(g.rating) : document.createTextNode("-"));
  pairEl("my rating", myStars(g));
  pair("developer", g.developer);
  // Yours; right-click > Tags... changes them.
  pair("tags", (g.tags || []).join("  ·  "));
  pair("discs", discWords(g));
  // A card holding several versions: which ones, the selected one said. The
  // Versions tab selects; Play asks between them while nothing is selected.
  if (g.versions && g.versions.length > 1) { pair("versions", versionsFact(g)); }
  if (full) {
    pair("publisher", full.publisher);
    pair("players", playersLine(full.players, full.playMode));
    pair("region", full.region);
    // Which core runs it, and whose decision that was. A core chosen here
    // is otherwise invisible once the dialog closes.
    pair("core", full.core ? (full.core + (full.coreMine ? "  ·  your choice" : "")) : "");
    // Cheats stay on until turned off, so the panel says so in words as well
    // as by the mark on the game.
    var chOn = full.cheats || full.emuCheats || 0;      // Xsegon's for RetroArch, or the emulator's own
    var chSays = cheatsFact(chOn, full.cheatsThere || 0);
    pair("cheats", chSays);
    // With none on it says how many there are, so cheats are seen without opening the tab; a press goes there.
    if (chSays) {
      dl.lastChild.classList.add("fact-go");
      dl.lastChild.title = "Open the Cheats tab";
      dl.lastChild.addEventListener("click", function () { openTab("cheats"); });
    }
    // The pack put in place, else how many are listed; a press opens its tab.
    var tpSays = texPackFact(full);
    pair("texture pack", tpSays);
    if (tpSays) {
      dl.lastChild.classList.add("fact-go");
      dl.lastChild.title = "Open the Texture packs tab";
      dl.lastChild.addEventListener("click", function () { openTab("texpacks"); });
    }
  }
  pair("played", hhmm(g.seconds) || "never");
  pair("launches", g.plays || 0);
  pair("last played", g.lastPlayed ? g.lastPlayed.slice(0, 10) : "never");
  if (!g.playable) { pair("problem", g.why); }
  left.appendChild(dl);
  // The side of the box and the disc, under the name and the facts.
  var kit = boxKit(g);
  if (kit) { left.appendChild(kit); }

  var right = el("div", "dright");

  var bar = el("div", "bar");
  var back = el("button", null, "◂ Back");
  back.addEventListener("click", closeDetails);
  // No emulator yet where RetroArch would play it: the button gets RetroArch (js\raoffer.js).
  var fix = g.playable ? null : raLabel(g.raOffer);
  var play = el("button", "primary", g.playable ? "▸ Play" : fix || "Cannot play");
  play.disabled = !g.playable && !fix;
  play.addEventListener("click", function () { if (fix) { getRetroArch("Details"); return; } closeDetails(); launch(); });
  bar.appendChild(back);
  bar.appendChild(play);
  // Its manual, maps and guides (js\docs.js). The row only knows there are
  // some; the full record says how many, and one alone is named.
  if (g.docs) {
    var dn = full && full.documents ? full.documents.length : 0;
    var docs = el("button", "docbtn", dn === 1 ? full.documents[0].label : dn > 1 ? "Documents (" + dn + ")" : "Documents");
    docs.title = "The manual, maps and guides kept for this game (D)";
    docs.addEventListener("click", function () { openDocs(g); });
    bar.appendChild(docs);
  }
  // Its own buttons, over its console's. Only for a RetroArch game of a
  // console whose buttons Xsegon knows, which the full record says.
  if (full && full.padable) {
    var gb = el("button", "docbtn", full.gameOwn ? "Buttons (yours)" : "Buttons");
    gb.title = "This game's own buttons and turbo, over " + g.platform + "'s (those are in Settings > RetroArch + Emulator Controls)";
    gb.addEventListener("click", function () { openGameButtons(g); });
    bar.appendChild(gb);
  }
  right.appendChild(bar);
  // Under them, the tabs: About (the saves and the words), Saves, File check, Cheats (js\detailtabs.js).
  detailTabs(right, g, full);

  $details.appendChild(left);
  $details.appendChild(right);

  // The snap stands where the cover stands. Built twice (row, then the
  // full record), so armed twice: the second simply restarts the wait.
  armVideo(coverEl, g, "details");
}

/* One of the facts on the left changed while details is up (a cheat selected
   in its tab): the line follows, comes, or goes. */
export function setFact(k, v) {
  var dl = $details.querySelector(".dleft > dl");
  if (!dl) { return; }
  var dts = [].slice.call(dl.querySelectorAll("dt"));
  var dt = dts.filter(function (n) { return n.textContent === k; })[0];
  if (dt && !v) { dt.nextElementSibling.remove(); dt.remove(); return; }
  if (dt) { dt.nextElementSibling.textContent = v; return; }
  if (!v) { return; }
  var before = dts.filter(function (n) { return n.textContent === "played"; })[0] || null;
  dl.insertBefore(el("dt", null, k), before);
  dl.insertBefore(el("dd", null, v), before);
}

/* The About tab: the saves, then the words with the whole height to scroll
   in, then the way to Wikipedia. Coming back to it from another tab, the
   saves and the drift are started again here; the first time, openDetails
   starts them once the panel is on the screen. */
export function aboutPane(pane, g, full) {
  if (full && full.notes) {
    var box = el("div", "notes-box");
    box.appendChild(el("div", "notes-inner", full.notes));
    pane.appendChild(box);
  }
  if (full && full.wikipedia) {
    /* Only a web address: the value comes from a data file, which a hand edit or a
       shared copy could make a script link (javascript:). One written without its
       https:// gets it; anything else is no link, and the log says so. */
    var wiki = String(full.wikipedia).trim();
    if (!/^https?:\/\//i.test(wiki) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(wiki)) { wiki = "https://" + wiki; }
    if (/^https?:\/\/[^\s]+$/i.test(wiki)) {
      var wik = el("a", "wikilink", "Wikipedia ↗");
      wik.href = wiki;
      wik.target = "_blank";
      wik.rel = "noopener";
      pane.appendChild(wik);
    } else {
      L("NAV", "details: " + g.title + "'s Wikipedia link left out, not a web address: " + wiki.slice(0, 60));
    }
  }
  if (full && pane.isConnected) { startNotesScroll(); paintStates(g); }
}

/* If the text is taller than its box it drifts at reading pace, holds, and
   drifts back -- ES's trick. Distance and duration are measured, not
   guessed, so a two-line note never crawls and a long one never sprints;
   and measured again when the box changes size (the strip coming up, the
   window resized), so its last lines are never left out of reach. */
var notesBox = null;       // the description box followed, one at a time
var notesSize = null;      // what follows its size

function startNotesScroll() {
  var box = $details.querySelector(".notes-box");
  var inner = $details.querySelector(".notes-inner");
  if (!box || !inner) { return; }
  measureNotes(box, inner);
  if (notesBox === box) { return; }
  if (!notesSize && window.ResizeObserver) {
    notesSize = new ResizeObserver(function () {
      if (notesBox && notesBox.isConnected) { measureNotes(notesBox, notesBox.querySelector(".notes-inner")); }
    });
  }
  if (notesSize) { if (notesBox) { notesSize.unobserve(notesBox); } notesSize.observe(box); }
  notesBox = box;
  box.addEventListener("wheel", function (e) { notesByHand(box, inner, e); }, { passive: false });
}

function measureNotes(box, inner) {
  if (!inner || box.classList.contains("by-hand")) { return; }
  var dist = inner.scrollHeight - box.clientHeight;
  var drift = dist > 14 && !$body.classList.contains("no-anim");
  if (drift) {
    inner.style.setProperty("--scroll-dist", dist + "px");
    inner.style.setProperty("--scroll-dur", Math.max(10, Math.round(dist / 22) + 6) + "s");
  }
  box.classList.toggle("notes-auto", drift);
}

/* The wheel over the drifting words (paused under the pointer by the stylesheet):
   they stop where they stand and scroll by hand from there while this game's details are open. */
function notesByHand(box, inner, e) {
  if (!box.classList.contains("notes-auto") || !e.deltaY) { return; }
  var t = getComputedStyle(inner).transform;
  var at = t && t !== "none" ? Math.max(0, -new DOMMatrixReadOnly(t).m42) : 0;
  box.classList.remove("notes-auto");
  box.classList.add("by-hand");
  box.scrollTop = at;
  e.preventDefault();                  // this first turn: the box could not scroll when it began
  box.scrollTop += e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
  L("NAV", "details: the description taken over by the wheel");
}

/* The saves, at the top of the About tab: RetroArch's own screenshot per slot,
   newest first, one press plays from it. Fetched after the full record (the server
   answers one request at a time, so the words come first) and added, not rebuilt.
   The newest three only: "All N saves..." opens the picker, so the strip never grows. */
var DST_SHOW = 3;
function paintStates(g) {
  if (g.local || !tabPane("about")) { return; }        // another tab is open: About asks when it is back
  // Save slots are a file's: the selected version's, and none shown while a card of several has none selected.
  var fg = versionInUse(g);
  if (!fg) { L("VERS", g.title + ": About shows no save slots until a version is selected"); return; }
  api("api/states.php?id=" + encodeURIComponent(fg.id)).then(function (res) {
    if (!res.ok || !res.states || !res.states.length) { return; }
    if ($details.hidden || !games[sel] || games[sel].id !== g.id) { return; }
    var about = tabPane("about");                      // and it may have been left while the answer came
    if (!about || $details.querySelector(".dstates")) { return; }

    var wrap = el("div", "dst-wrap");
    wrap.appendChild(el("h3", "dst-head", "SAVE STATES"));
    var strip = el("div", "dstates");
    res.states.slice(0, DST_SHOW).forEach(function (st) {
      var c = el("div", "st-cell");
      c.title = "Play from this save";
      var fr = el("div", "st-frame");
      if (st.shot !== null) {
        var img = el("img");
        img.alt = "";
        img.src = "api/states.php?id=" + encodeURIComponent(fg.id) + "&shot=" + st.slot + "&t=" + st.shot;
        fr.appendChild(img);
      } else {
        fr.appendChild(el("div", "st-fresh", "?"));
      }
      c.appendChild(fr);
      c.appendChild(el("div", "st-label", "Slot " + st.slot));
      c.appendChild(el("div", "st-cap", whenSaved(st.when)));
      c.addEventListener("click", function () {
        L("MNU", "run slot " + st.slot + " (details)" + (fg !== g ? " of version " + fg.id : ""));
        closeDetails();
        launchNow(fg, st.slot);
      });
      strip.appendChild(c);
    });
    wrap.appendChild(strip);

    if (res.states.length > DST_SHOW) {
      var more = el("button", "dst-more", "All " + res.states.length + " saves...");
      more.addEventListener("click", function () {
        closeDetails();
        openStates(fg);
      });
      wrap.appendChild(more);
    }
    about.insertBefore(wrap, about.firstChild);
  });
}

export function openDetails() {
  if (games[sel]) { L("NAV", "details " + games[sel].title); }
  var g = games[sel];
  if (!g) { return; }
  // Surprise me from over the Fan projects page: the details stand over every game, never over the page or the consoles.
  if ((dropFanPage() || dropExtPage() || dropTpPage()) && sysStage === "wall") { startOnAllGames(); }
  sound("select");

  buildDetails(g, null);
  $main.hidden = true;
  $toolbar.hidden = true;
  $details.hidden = false;
  paintHelp("details");

  api("api/game.php?id=" + encodeURIComponent(g.id)).then(function (res) {
    // Only fill in if these details are still the ones on screen.
    if (!res.ok || $details.hidden || !games[sel] || games[sel].id !== res.game.id) { return; }
    buildDetails(g, res.game);
    startNotesScroll();
    paintStates(g);
  });
}

/* Details put away without a sound or a legend, for a caller about to draw something
   else (a view change, the way to the consoles): the masthead's view dropdown stays live
   while details is open. Main and the bar come back; the caller then shows or hides them. */
export function dropDetails() {
  if ($details.hidden) { return false; }
  L("NAV", "details put away by a view change");
  detailTabsOff();
  $details.hidden = true;
  $main.hidden = false;
  $toolbar.hidden = false;
  return true;
}

export function closeDetails() {
  if ($details.hidden) { return false; }
  detailTabsOff();
  $details.hidden = true;
  $main.hidden = false;
  $toolbar.hidden = false;
  sound("back");
  paintHelp(sysStage === "inside" ? "inside" : "browse");
  armBrowse();                           // ends the details snap, waits on the wheel's
  return true;
}
