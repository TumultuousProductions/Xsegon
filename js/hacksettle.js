/*  Hacks to settle (includes\hackof.php): the games that may be
    hacks and wait for your word. Xsegon names the game each most likely
    comes from; a press says yes, another game, or no hack. Until then a game
    wears "Hack?" in the lists, so none is left unsaid.

    Also here: what was said of one game, taken into the rows on screen, for
    this window and for the Hacks tab of a game's details alike. */

import { setEditorOnClose, toolFrame } from "./editors.js";
import { showStrip } from "./launch.js";
import { L, api } from "./log.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor, games } from "./state.js";
import { el } from "./util.js";
import { render, setCarNodes, setWheelNodes } from "./views.js";

var asking = 0;                       // how many games in the whole library are in doubt
export function hackAsking() { return asking; }
export function setHackAsking(n) { if (typeof n === "number") { asking = n; } }

/* One game's mark as the server now has it: on its rows, in every view. */
export function markHack(id, mark, n) {
  setHackAsking(n);
  var moved = false;
  games.forEach(function (x) {
    if (x.id === id && (x.hack || null) !== (mark || null)) { x.hack = mark || null; moved = true; }
  });
  if (moved) { setWheelNodes(null); setCarNodes(null); render(); }
}

/* Says it: what is { hackOf: "<game id>" or "" }, { notHack: true } or { unsettle: true }. */
export function sayHack(id, what) {
  var body = { id: id };
  Object.keys(what).forEach(function (k) { body[k] = what[k]; });
  return api("api/hacks.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(function (res) {
    if (res.ok) { markHack(id, res.mark, res.asking); }
    return res;
  });
}

export function openHackSettle() {
  L("ED", "hacks to settle");
  stopVideo();
  var open = null;                    // the game whose list of other games stands open

  function say(r, what, words) {
    sayHack(r.id, what).then(function (res) {
      if (!res.ok) { sound("back"); showStrip("Not kept: " + (res.error || "the server gave no answer"), true); return; }
      L("HACK", "settled " + r.title + ": " + words);
      sound("ok");
      showStrip(r.title + ": " + words, false);
      open = null;
      paint();
    });
  }

  function picker(card, r) {
    var box = el("div", "hs-pick");
    var find = el("input");
    find.type = "text";
    find.placeholder = "find the game it is a hack of";
    find.spellcheck = false;
    box.appendChild(find);
    var list = el("div", "hs-bases");
    box.appendChild(list);
    card.appendChild(box);
    api("api/hacks.php?id=" + encodeURIComponent(r.id) + "&bases=1").then(function (res) {
      if (!box.isConnected) { return; }
      var bases = (res.ok && res.bases) || [];
      function fill() {
        var q = find.value.trim().toLowerCase();
        list.textContent = "";
        var shown = bases.filter(function (b) { return !q || b.title.toLowerCase().indexOf(q) >= 0; });
        shown.forEach(function (b) {
          var one = el("button", "hs-base", b.title);
          one.type = "button";
          one.addEventListener("click", function () { say(r, { hackOf: b.id }, "a hack of " + b.title); });
          list.appendChild(one);
        });
        if (!shown.length) { list.appendChild(el("p", "mt-note", bases.length ? "No game of " + r.platform + " is called that." : "No other game of " + r.platform + " is in the library.")); }
      }
      find.addEventListener("input", fill);
      fill();
      find.focus();
    });
  }

  function card(r) {
    var c = el("div", "hs-card");
    c.dataset.id = r.id;
    var top = el("div", "hs-top");
    top.appendChild(el("span", "hs-t", r.title));
    top.appendChild(el("span", "hs-p", r.platform + (r.own ? "  ·  a game of your own" : r.file ? "  ·  " + r.file : "")));
    c.appendChild(top);
    var s = r.suggest;
    c.appendChild(el("p", "hs-why", !s ? "No game could be named for it."
      : (s.id ? "Looks like a hack of " + s.title : "Looks like a hack of " + s.title + ", which is not in your library") + ": " + s.why + "."));
    var acts = el("div", "bk-acts hs-acts");
    function act(label, cls, run) {
      var b = el("button", cls, label);
      b.type = "button";
      b.addEventListener("click", run);
      acts.appendChild(b);
      return b;
    }
    if (s && s.id) { act("Yes, a hack of " + s.title, "primary hs-yes", function () { say(r, { hackOf: s.id }, "a hack of " + s.title); }); }
    act(s && s.id ? "Another game..." : "Pick the game...", s && s.id ? "hs-other" : "primary hs-other", function () {
      open = open === r.id ? null : r.id;
      paint();
    });
    act("Its game is not here", "hs-gone", function () { say(r, { hackOf: "" }, "a hack of a game that is not in the library"); });
    act("Not a hack", "hs-not", function () { say(r, { notHack: true }, "no hack"); });
    c.appendChild(acts);
    if (open === r.id) { picker(c, r); }
    return c;
  }

  function paint() {
    return api("api/hacks.php?settle=1").then(function (res) {
      if ($editor.dataset.tool !== "hacksettle") { return; }
      if (!res.ok) { showStrip("could not read the games in doubt: " + (res.error || ""), true); return; }
      var rows = res.games || [];
      setHackAsking(rows.length);

      var inner = toolFrame("HACKS TO SETTLE", { cls: "hs-inner" });
      inner.appendChild(el("p", "group-help",
        "Games that may be hacks: a file that is no known release, one named or filed as a hack, or a game of your own standing in a console's list. " +
        "Say which game each comes from and it wears Hack in the lists and shows in that game's Hacks tab; it stays a game of its own and plays like one. " +
        "Until you say, it wears Hack? so none is forgotten. Nothing on the disk is moved or changed."));
      inner.appendChild(el("p", "rp-verdict " + (rows.length ? "warn" : "good"),
        rows.length ? rows.length + (rows.length === 1 ? " game waits" : " games wait") + " for your word."
                    : "Nothing waits: every game that may be a hack has been spoken for."));
      rows.forEach(function (r) { inner.appendChild(card(r)); });
      $editor.appendChild(inner);
      $editor.hidden = false;
    });
  }

  $editor.dataset.tool = "hacksettle";
  setEditorOnClose(function () { delete $editor.dataset.tool; });
  paint().then(function () { sound("select"); });
}
