/*  The Shelf view: the games standing side by side by the sides of their boxes,
    each as wide as its own box is thick. A flat view like the grid: views.js
    draws and walks it; this file only makes one spine.

    A spine's picture comes with its size (api\library.php, g.spine), so the
    shelf does not shuffle as pictures arrive. One lying on its side (a long
    SNES or N64 box) is turned a quarter clockwise to read top down like the
    rest. A game with no spine picture gets a plain one with its name on it. */

import { el, titleText } from "./util.js";

var MADE = 0.13;                         // a made spine's width, as a part of its height

// A colour from a name: the same one every time for the same words.
function hueOf(text) {
  var h = 0;
  for (var i = 0; i < text.length; i++) { h = (h * 31 + text.charCodeAt(i)) % 360; }
  return h;
}

export function spineNode(g, chosen) {
  var n = el("div", "spine" + (chosen ? " sel" : "") + (g.favourite ? " fav" : "") + (g.playable ? "" : " dead"));
  n.title = titleText(g);
  n.dataset.id = g.id;
  var inner = el("div", "spine-in");
  var sp = g.spine;
  if (sp && sp.w > 0 && sp.h > 0) {
    var lying = sp.w > sp.h;
    // the standing spine's width over its height, whichever way the picture lies
    n.style.setProperty("--sr", String(Math.min(0.4, lying ? sp.h / sp.w : sp.w / sp.h)));
    var img = el("img", "spine-art" + (lying ? " lying" : ""));
    img.src = sp.url;
    img.alt = g.title;
    img.loading = "lazy";                // hundreds of them: fetch what is on screen
    img.decoding = "async";
    // A picture that will not load leaves a made spine, not a hole in the shelf.
    img.onerror = function () { img.remove(); made(n, inner, g); };
    inner.appendChild(img);
  } else {
    made(n, inner, g);
  }
  n.appendChild(inner);
  return n;
}

function made(n, inner, g) {
  n.classList.add("made");
  n.style.setProperty("--sr", String(MADE));
  // The console's colour, shifted a little by the game's own name, so one
  // console's made spines are not a wall of one colour.
  n.style.setProperty("--sh", String((hueOf(g.platform || "") + hueOf(g.title || "") % 37 - 18 + 360) % 360));
  inner.appendChild(el("span", "spine-name", titleText(g)));
}
