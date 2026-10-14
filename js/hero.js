/*  The info panel beside the list and the wheel: the chosen game's art in
    the HUD brackets, its badges, its ratings (the library's and yours) and
    your history with it.

    ONE panel, built once and then filled in, so a fast run of steps does not
    flash: the box is the height of its space (--fill-h in the stylesheet), the
    picture's frame has a size nothing inside it can change, and the words have
    a box of fixed height. The one picture element is kept and only its address
    changes, so the old picture shows until the new one is ready. A quick run
    blurs the words and the picture (.holding) and leaves the panel still.   */

import { favStar, myStars, openDetails } from "./details.js";
import { launch } from "./launch.js";
import { addsMissing } from "./missing.js";
import { $hero, S, view } from "./state.js";
import { artUrl, discShort, discWords, el, fixMark, fixWords, hhmm, stars, titleText, versionLabel } from "./util.js";

export function heroOn() {
  // The wheel is half a screen of titles; the hero is its other half. And
  // the shelf's: a spine is the side of a box, the panel shows its front.
  return (view === "list" || view === "wheel" || view === "shelf") && (!S.view || S.view.heroPanel !== false);
}

var H = null;                            // the panel's parts, once built

function build() {
  $hero.textContent = "";
  H = {};
  var frame = H.frame = el("div", "hero-art-frame");
  H.img = el("img", "hero-art");
  H.img.alt = "";
  H.noart = addsMissing(el("div", "hero-noart", "NO ART"), function () { return H.g; }, "art");
  frame.appendChild(H.img);
  frame.appendChild(H.noart);
  $hero.appendChild(frame);

  var info = el("div", "hero-info");
  H.title = el("h3");
  H.pills = el("div", "pills");
  H.stats = el("div", "hero-stats");
  info.appendChild(H.title);
  info.appendChild(H.pills);
  info.appendChild(H.stats);
  $hero.appendChild(info);

  var bar = el("div", "bar");
  H.play = el("button", "primary", "Play");
  H.play.addEventListener("click", launch);
  var more = el("button", null, "Details");
  more.addEventListener("click", openDetails);
  bar.appendChild(H.play);
  bar.appendChild(more);
  $hero.appendChild(bar);
}

/* The picture alone, and its no-art stand-in: what keeps up with every step
   of a fast run (settle in js\views.js), while the words wait for the rest. */
export function paintHeroArt(g) {
  if ($hero.hidden || !g) { return; }
  if (!H || !$hero.contains(H.img)) { build(); }
  H.g = g;
  if (g.hasArt) {
    var url = artUrl(g, "box");
    if (H.img.getAttribute("src") !== url) { H.img.src = url; }
  }
  H.img.hidden = !g.hasArt;
  H.noart.hidden = !!g.hasArt;
  fixMark(H.frame, g);
  // No video: the slashed clapperboard on the artwork's own bottom right
  // corner too, for someone not looking at the wheel.
  if (!H.novid) {
    H.novid = addsMissing(el("span", "hero-novid"), function () { return H.g; }, "video");
    H.frame.appendChild(H.novid);
    H.img.addEventListener("load", placeNovid);
  }
  H.novid.hidden = !!g.hasVideo;
  placeNovid();
}

/* The picture is fitted inside its frame (object-fit: contain), so a tall
   box and a wide one end in different places: the mark goes on the corner
   of what is drawn, not of the frame. On the no-art stand-in, the frame's. */
function placeNovid() {
  if (!H || !H.novid || H.novid.hidden) { return; }
  var fw = H.frame.clientWidth, fh = H.frame.clientHeight;
  var nw = H.img.naturalWidth, nh = H.img.naturalHeight;
  var dx = 0, dy = 0;
  if (!H.img.hidden && nw && nh && fw && fh) {
    var s = Math.min(fw / nw, fh / nh);
    dx = (fw - nw * s) / 2;
    dy = (fh - nh * s) / 2;
  }
  H.novid.style.right = Math.round(dx + 8) + "px";
  H.novid.style.bottom = Math.round(dy + 8) + "px";
}

export function paintHero(g) {
  if ($hero.hidden || !g) { return; }
  paintHeroArt(g);

  // The name has two lines and no more, and the star stands beside it
  // rather than after the last word, where a long name would clip it.
  H.title.textContent = "";
  H.title.appendChild(el("span", "hero-name", titleText(g)));
  H.title.appendChild(favStar(g));
  H.title.title = titleText(g);

  H.pills.textContent = "";
  // Why it cannot launch goes first: it matters most, and the row is cut
  // off at two lines rather than pushing the facts out of their box.
  if (!g.playable) { H.pills.appendChild(el("span", "pill dead", g.why || "cannot launch")); }
  if (g.needsFix) { var fx = el("span", "pill dead", "needs fix"); fx.title = fixWords(g); H.pills.appendChild(fx); }
  // A disc set says how it plays, early for the same reason: "Disc 1 only"
  // is the thing to know before pressing Play. The whole sentence on hover.
  if (g.discs) {
    var dp = el("span", "pill " + (g.discs.set ? "disc" : "disc warn"), discShort(g));
    dp.title = discWords(g);
    H.pills.appendChild(dp);
  }
  // A card holding several versions says how many, and which on hover.
  if (g.versions && g.versions.length > 1) {
    var vp = el("span", "pill vers", g.versions.length + " versions");
    vp.title = g.versions.map(versionLabel).join("\n") + "\nPlay asks which one";
    H.pills.appendChild(vp);
  }
  H.pills.appendChild(el("span", "pill accent", g.platform));
  if (g.released) { H.pills.appendChild(el("span", "pill", g.released.slice(0, 4))); }
  if (g.genre)    { H.pills.appendChild(el("span", "pill", g.genre)); }
  if (g.favourite){ H.pills.appendChild(el("span", "pill fav", "★ favourite")); }
  // No snap to play here: said where the snap would play. The same
  // setting as the clapperboards turns it off (css body.no-novid).
  if (!g.hasVideo) { H.pills.appendChild(addsMissing(el("span", "pill novid-pill", "no video"), function () { return g; }, "video")); }
  // Your tags last, in the collections' magenta: they are yours.
  // "needs fix" is the red pill above already.
  (g.tags || []).forEach(function (t) { if (t.toLowerCase() !== "needs fix") { H.pills.appendChild(el("span", "pill tag", t)); } });

  H.stats.textContent = "";
  function kv(k, v, hot) {
    H.stats.appendChild(el("span", "k", k));
    var val = el("span", "v" + (hot ? " hot" : ""), v);
    val.title = v;
    H.stats.appendChild(val);
  }
  // The library's rating and yours, first among the facts and named like them.
  function kvEl(k, node) {
    H.stats.appendChild(el("span", "k", k));
    var val = el("span", "v");
    val.appendChild(node);
    H.stats.appendChild(val);
  }
  kvEl("global rating", g.rating ? stars(g.rating) : document.createTextNode("-"));
  kvEl("my rating", myStars(g));
  kv("developer", g.developer || "-");
  kv("played", hhmm(g.seconds) || "never", !!g.seconds);
  kv("launches", String(g.plays || 0));
  kv("last played", g.lastPlayed ? g.lastPlayed.slice(0, 10) : "never");

  H.play.textContent = g.playable ? "Play" : "Cannot play";
  H.play.disabled = !g.playable;
}
