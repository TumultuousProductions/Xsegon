/*  A hack's own page, in the Hacks tab of the game it is a hack of (js\hackstab.js):
    who made it and when, what it is about, its pictures, and Play. The words and
    pictures are the Games Database's when the hack is in it, or yours, written in
    data\hack-about.json (includes\hackabout.php). Back goes to the list of hacks.  */

import { setTabRows, tabPane } from "./detailtabs.js";
import { iconEl } from "./icons.js";
import { L, api } from "./log.js";
import { el } from "./util.js";

var FROM = {
  gamesdb: "Words and pictures from the LaunchBox Games Database.",
  you: "Written by you, in data\\hack-about.json.",
  both: "Written by you in data\\hack-about.json, over the LaunchBox Games Database's."
};

function pic(src, cls) {
  var i = el("img", cls);
  i.src = src;
  i.alt = "";
  i.decoding = "async";
  return i;
}

/* Who made it, when, what kind of game, for how many: what is known of it, in one line. */
function factsOf(a) {
  var out = [];
  if (a.developer) { out.push(a.developer); }
  if (a.released) { out.push(a.released); }
  if (a.genre) { out.push(a.genre.replace(/;\s*/g, ", ")); }
  if (a.players) { out.push(a.players === 1 ? "1 player" : a.players + " players"); }
  return out.join("  ·  ");
}

/* r: the patch's row as the list has it; how: why it fits, in words; play and back: what the two rows do. */
export function hackPage(pane, g, r, how, play, back) {
  pane.textContent = "";
  var inner = el("div", "ch-inner ch-tab hck-tab hp-page");
  var top = el("div", "hp-top");
  var art = el("div", "hp-art");
  art.appendChild(r.about && r.about.box ? pic(r.about.box) : iconEl("hp-none", "disc"));
  var head = el("div", "hp-head");
  var logoAt = el("div", "hp-logo-at");
  var title = el("h3", "hp-title", (r.about && r.about.title) || r.name);
  var facts = el("p", "hp-facts", r.about ? [r.about.developer, r.about.year].filter(Boolean).join("  ·  ") : "");
  head.appendChild(logoAt);
  head.appendChild(title);
  head.appendChild(facts);
  head.appendChild(el("p", "hp-of", "A hack of " + g.title + "  ·  " + r.kind + "  ·  " + r.where));
  var list = el("div", "ch-list hck-list hp-acts");
  head.appendChild(list);
  top.appendChild(art);
  top.appendChild(head);
  inner.appendChild(top);
  var words = el("div", "hp-words");
  words.appendChild(el("p", "dtab-wait", "Reading about " + r.name + "…"));
  inner.appendChild(words);
  // Why it fits, said as a sentence of its own ("fits this file, by ..." in the list).
  var fits = how ? how.charAt(0).toUpperCase() + how.slice(1) + "." : "";
  var foot = el("p", "mt-note", fits);
  inner.appendChild(foot);
  pane.appendChild(inner);

  // Play and Back are there at once; what is known of the hack comes after.
  var acts = [{ name: "Play " + r.name, icon: "play", cls: "hp-play", word: "play it", run: play },
              { name: "Back to the hacks", icon: "back", cls: "ch-act hck-back hp-back", word: "go back", run: back }];
  var cells = [], at = 0;
  function focusAt(i) {
    i = Math.max(0, Math.min(cells.length - 1, i));
    at = i;
    cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
    setTabRows(pane, { cells: cells, at: i, word: acts[i].word,
                       move: function (d) { focusAt(at + d); }, choose: function () { acts[at].run(); } });
  }
  acts.forEach(function (a, i) {
    var line = el("div", "cr-row hck-row " + a.cls);
    line.appendChild(iconEl("cr-ico", a.icon));
    line.appendChild(el("span", "cr-name", a.name));
    line.addEventListener("mouseenter", function () { focusAt(i); });
    line.addEventListener("click", function () { focusAt(i); a.run(); });
    cells.push(line);
    list.appendChild(line);
  });
  focusAt(0);

  api("api/hacks.php?id=" + encodeURIComponent(g.id) + "&about=" + encodeURIComponent(r.key)).then(function (res) {
    if (tabPane("hacks") !== pane || !inner.isConnected) { return; }   // another tab, game or page by now
    words.textContent = "";
    if (!res.ok) {
      words.appendChild(el("p", "mt-note", "What is known of it could not be read: " + (res.error || "the server gave no answer") + "."));
      return;
    }
    L("HACK", "page of " + r.name + ": " + (res.from ? "words from " + res.from : "nothing known of it") + (res.dbId ? ", Games Database " + res.dbId : ""));
    if (res.title) { title.textContent = res.title; }
    facts.textContent = factsOf(res);
    if (res.pics.logo) { logoAt.appendChild(pic(res.pics.logo, "hp-logo")); }
    var face = res.pics.box || res.pics.shots[0];
    if (face) {
      art.textContent = "";
      art.appendChild(pic(face));
    }
    if (res.notes) {
      // Scrolled by hand: the drift of a game's own About tab follows that tab's box only.
      var box = el("div", "notes-box by-hand hp-notes");
      box.appendChild(el("div", "notes-inner", res.notes));
      words.appendChild(box);
    } else {
      words.appendChild(el("p", "mt-note", "Nothing is known of " + r.name + " yet. What it is can be written in data\\hack-about.json, under \"" + res.key + "\"."));
    }
    var shots = res.pics.shots.filter(function (s) { return s !== face; });
    if (shots.length) {
      var strip = el("div", "hp-shots");
      shots.forEach(function (s) { strip.appendChild(pic(s)); });
      words.appendChild(strip);
    }
    foot.textContent = fits + (res.from ? "  " + FROM[res.from] : "");
  });
}
