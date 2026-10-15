/*  The legend along the bottom: what the keys do, right now, in this
    context, the one thing every console front end keeps and a web page does
    not. It changes with context, because "Esc closes this" is only true
    sometimes, and it speaks pad while a pad is in use. Kept out of views.js
    for the 700-line rule.                                                  */

import { tabHasRows, tabRowsFind, tabRowsLook, tabRowsWord } from "./detailtabs.js";
import { filters } from "./library.js";
import { padJobsNow } from "./padjobs.js";
import { padKeyNamed, padPressed } from "./padkind.js";
import { $body, $help, games, sel, sysStage, view } from "./state.js";
import { sysStyle } from "./systems.js";
import { el } from "./util.js";

var HELP = {
  browse:   [["↑↓", "navigate"], ["Enter", "play"], ["Space", "details"],
             ["Click", "details"], ["R‑Click", "menu"], ["G", "next view"],
             ["F", "faves"], ["2", "two players"], ["R", "random"], ["/", "search"]],
  systems:  [["←→", "turn"], ["Enter", "open system"], ["2", "two players"]],
  inside:   [["↑↓", "navigate"], ["Enter", "play"], ["Space", "details"],
             ["2", "two players"], ["/", "search"], ["Esc", "back to systems"]],
  // while the search box has the keys (js\input.js)
  search:   [["Type", "search"], ["↓", "to the games"], ["Enter", "play"], ["Esc", "clear"]],
  details:  [["←→", "tabs"], ["↓", "the list"], ["Enter", "play"], ["D", "documents"], ["F", "file check"], ["N", "notes"], ["Esc", "back"]],
  // inside the list of a tab of details (js\detailtabs.js)
  tabrows:  [["↑ ↓", "move"], ["Enter", "select"], ["Type", "find"], ["Esc", "back to the tabs"]],
  settings: [["↑↓", "move"], ["←→", "change"], ["Enter", "open"],
             ["Esc", "back"], ["Type", "find a setting"]],
  // the Fan projects page (js\fanprojects.js)
  fanprojects: [["↑↓←→", "choose"], ["Enter", "the panel's first button"], ["Type", "find a project"], ["Esc", "back"]]
};

/* The same legend in the pad's words. The moment a pad is used
   the keys become buttons: A, B, X, Y and the cross, drawn round; the first
   key press or click puts the key names back. What each does is what
   input.js makes it do, so the two tables are kept side by side here. */
var HELP_PAD = {
  browse:   [["✥", "navigate"], ["LB RB", "jump"], ["A", "play"], ["X", "details"], ["Y", "menu"], ["View", "top menus"], ["B", "back"]],
  systems:  [["✥", "turn"], ["A", "open system"], ["Y", "menu"], ["View", "top menus"]],
  inside:   [["✥", "navigate"], ["LB RB", "jump"], ["A", "play"], ["X", "details"], ["Y", "menu"], ["View", "top menus"], ["B", "back to systems"]],
  // the bar up among the menus and buttons at the top of the screen (js\padtop.js)
  top:      [["✥", "move"], ["A", "open"], ["B", "back to the games"]],
  details:  [["LB RB", "tabs"], ["▾", "the list"], ["A", "play"], ["Y", "documents"], ["B", "back"]],
  tabrows:  [["✥", "move"], ["A", "select"], ["B", "back to the tabs"]],
  settings: [["✥", "move"], ["◂▸", "change"], ["A", "open"], ["B", "back"]],
  fanprojects: [["✥", "choose"], ["A", "the panel's first button"], ["X", "their page"], ["B", "back"]]
};
export var padMode = false;
var helpCtx = "browse";

// `pad`, when it is known which one pressed: the legend takes that pad's names and jobs (js\padkind.js, js\padjobs.js).
export function setPadMode(on, pad) {
  var renamed = on && pad ? padPressed(pad) : false;
  if (padMode === !!on && !renamed) { return; }
  padMode = !!on;
  $body.classList.toggle("pad", padMode);
  paintHelp(helpCtx);
}

// The same legend again, after something it shows has changed (the button names, which button confirms).
export function paintHelpAgain() { paintHelp(helpCtx); }

/* The legend for wherever you are now, for a panel that closes back onto
   whatever was underneath it: the browsing keys are wrong over the consoles screen. */
export function paintHelpHere() {
  paintHelp(sysStage === "wall" ? "systems" : sysStage === "inside" ? "inside" : "browse");
}

export function paintHelp(ctx) {
  if (!$help) { return; }
  helpCtx = ctx;
  $help.textContent = "";
  var table = padMode ? HELP_PAD : HELP;
  (table[ctx] || table.browse).forEach(function (h) {
    var label = h[1];
    // A game with no manual, map or guide has no documents to offer.
    if (label === "documents" && !(games[sel] && games[sel].docs)) { return; }
    // Only a tab with a list in it has one to go down into.
    if (label === "the list" && !tabHasRows()) { return; }
    // And a list that is only to look at has nothing to select.
    if (ctx === "tabrows" && label === "select" && tabRowsLook()) { return; }
    // Or the press does something other than select: plays from a save, shows a file.
    if (ctx === "tabrows" && label === "select" && tabRowsWord()) { label = tabRowsWord(); }
    // And typing finds only where the list has a find box.
    if (ctx === "tabrows" && label === "find" && !tabRowsFind()) { return; }
    // On the consoles screen the dropdown names the screen's own shape, so
    // when a console will open into something else (a List, say, under a
    // carousel of consoles) the legend is where that is said.
    if (ctx === "systems" && label === "open system" && view !== sysStyle()) { label = "open in " + view; }
    // Two players or more is a switch, so the key says what pressing it
    // will do now: while it is on, that is putting every game back.
    if (h[0] === "2" && filters.players) { label = "show all"; }
    // The rows view and the shelf move four ways, not two, and the carousel
    // takes left and right as well as up and down.
    var key = h[0] === "↑↓" && (view === "rows" || view === "shelf" || view === "carousel") && ctx !== "systems" ? "↑↓←→" : h[0];
    var it = el("span", "hitem");
    var hk = el("span", "hk", key);
    /* The table's A, B, X, Y and shoulders stand for what they do: each is
       shown as the button that job is on for the pad in use, in that pad's
       names (Confirm with, and Xsegon's buttons, move them). */
    if (padMode) { padKeyNamed(hk, key, padJobsNow()); }
    // More than a letter on one key ("LB RB", "Options") is a pill, not a stretched circle.
    if (padMode && hk.textContent.length > 2) { hk.classList.add("hk-wide"); }
    it.appendChild(hk);
    it.appendChild(el("span", "hl", label));
    $help.appendChild(it);
  });
}
