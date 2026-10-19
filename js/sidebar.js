/*  The platform sidebar: the consoles down the left of the list and the grid,
    each with its icon. Off by default (View > Platform sidebar); the wheel and
    carousel never show it. It is the platform dropdown drawn long: an entry sets
    the dropdown's value and loads the same way, so the two never disagree.
    Icons come from api\image.php?kind=icon, with a glyph for one that has none. */

import { collectionCount, collectionsAll, consoleCounts, load, opensEmpty, platformArtRev, platformArtUrl } from "./library.js";
import { L } from "./log.js";
import { sound } from "./sound.js";
import { $main, $platform, $view, S, view } from "./state.js";
import { el } from "./util.js";

export var $sidebar = null;
var built = "";                          // what the list was built from, so it is not rebuilt per move

export function sidebarWanted() {
  return (view === "list" || view === "grid" || view === "shelf") && !!(S.view && S.view.sidebar);
}

function entry(key, label, count, glyph) {
  var n = el("button", "sb-item");
  n.type = "button";
  n.dataset.key = key;
  var ico = el("span", "sb-ico");
  var img = el("img");
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.src = platformArtUrl(key === "" ? "@all" : key, "icon");
  // No icon on record: a glyph, so the row still has a shape at the left.
  img.addEventListener("error", function () { img.remove(); ico.textContent = glyph; ico.classList.add("glyph"); });
  ico.appendChild(img);
  n.appendChild(ico);
  n.appendChild(el("span", "sb-label", label));
  n.appendChild(el("span", "sb-count", String(count)));
  n.addEventListener("click", function () {
    if ($platform.value === key) { return; }
    L("NAV", "sidebar " + (key || "all"));
    $platform.value = key;
    sound("select");
    load();
  });
  return n;
}

function build() {
  $sidebar.textContent = "";
  // The rim's own numbers: while Two players or more is on, only what
  // seats two, and a console with none of that left out.
  var counts = consoleCounts();
  var names = Object.keys(counts).sort();
  var total = 0;
  names.forEach(function (n) { total += counts[n]; });
  $sidebar.appendChild(entry("", "All games", total, "▦"));
  names.forEach(function (n) { $sidebar.appendChild(entry(n, n, counts[n], "▣")); });
  if (collectionsAll.length) {
    $sidebar.appendChild(el("div", "sb-rule"));
    collectionsAll.forEach(function (c) {
      var size = collectionCount(c);
      if (!size && !opensEmpty(c.key)) { return; }   // an empty one has nothing to open, bar Recently added
      $sidebar.appendChild(entry(c.key, c.label, size, "★"));
    });
  }
}

export function paintSidebar() {
  if (!sidebarWanted()) {
    if ($sidebar) { $sidebar.hidden = true; }
    return;
  }
  if (!$sidebar) {
    $sidebar = el("nav", "sidebar");
    $sidebar.id = "sidebar";
    $sidebar.setAttribute("aria-label", "Platforms");
    $main.insertBefore($sidebar, $view);
  }
  $sidebar.hidden = false;
  var key = JSON.stringify([consoleCounts(), platformArtRev, collectionsAll.map(function (c) { return c.key + collectionCount(c); })]);
  if (key !== built) { built = key; build(); }
  var cur = $platform.value;
  $sidebar.querySelectorAll(".sb-item").forEach(function (n) { n.classList.toggle("on", n.dataset.key === cur); });
}
