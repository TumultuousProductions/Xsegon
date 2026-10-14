/*  A left click on a NO ART stand-in or a no-video mark offers the two
    entries the right-click menu has for them. Wired only where a click
    means nothing else (the info panel, the Rows picture, Details), so a
    game's own tile keeps its clicks. */

import { openArtEditor, openVideoEditor } from "./art-editors.js";
import { TIPS } from "./menu-tips.js";
import { popupMenu } from "./menus.js";

/* The entry for what was clicked comes first. */
function offer(g, x, y, what) {
  var pics = { icon: "image", label: "Change Pictures...", tip: TIPS.pictures, run: function () { openArtEditor(g); } };
  var vid = { icon: "film", label: g.hasVideo ? "Replace Video..." : "Add Video...", tip: TIPS.video, run: function () { openVideoEditor(g); } };
  popupMenu(what === "video" ? [vid, pics] : [pics, vid], x, y, g.title);
}

/* `game` is asked at the click: the info panel and the Rows picture keep
   one node for every game. */
export function addsMissing(node, game, what) {
  node.classList.add("can-add");
  node.title = what === "video" ? "No video for this game. Click to add one." : "No picture for this game. Click to add one.";
  node.addEventListener("click", function (e) {
    var g = game();
    if (!g) { return; }
    e.stopPropagation();
    offer(g, e.clientX, e.clientY, what);
  });
  return node;
}
