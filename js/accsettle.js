/*  Files that may go with a game (includes\accompanied.php): files whose names say
    they are an install or bonus disc. Opened from the mailbox's message; a press says
    which game each goes with, or that it is a game of its own.
    Also here: saying it, for this window and the Files tab. */

import { setEditorOnClose, toolFrame } from "./editors.js";
import { showStrip } from "./launch.js";
import { load } from "./library.js";
import { L, api } from "./log.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { el } from "./util.js";

/* Says it: what is { with: "<game id>" or "" }, { not: true } or { unsettle: true };
   tab, the game whose tab the answer is for. The lists are read again, since a file
   leaves them or comes back. */
export function sayAcc(id, what, tab) {
  var body = { id: id };
  if (tab) { body.tab = tab; }
  Object.keys(what).forEach(function (k) { body[k] = what[k]; });
  return api("api/accompanied.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(function (res) {
    if (res.ok) { load(); }
    return res;
  });
}

/* What it is, in a few words: "the install disc of Alien: Isolation". */
export function accWords(words, title) {
  return "the " + String(words || "accompanied file").toLowerCase() + " of " + (title || "a game that is not in the library");
}

export function openAccSettle() {
  L("ED", "files that may go with a game");
  stopVideo();
  var open = null;                    // the file whose list of games stands open

  function say(r, what, words) {
    sayAcc(r.id, what).then(function (res) {
      if (!res.ok) { sound("back"); showStrip("Not kept: " + (res.error || "the server gave no answer"), true); return; }
      L("ACC", "settled " + r.file + ": " + words);
      sound("ok");
      showStrip(r.file + ": " + words, false);
      open = null;
      paint();
    });
  }

  function picker(card, r) {
    var box = el("div", "hs-pick");
    var find = el("input");
    find.type = "text";
    find.placeholder = "find the game it goes with";
    find.spellcheck = false;
    box.appendChild(find);
    var list = el("div", "hs-bases");
    box.appendChild(list);
    card.appendChild(box);
    api("api/accompanied.php?id=" + encodeURIComponent(r.id) + "&homes=1").then(function (res) {
      if (!box.isConnected) { return; }
      var homes = (res.ok && res.homes) || [];
      function fill() {
        var q = find.value.trim().toLowerCase();
        list.textContent = "";
        var shown = homes.filter(function (h) { return !q || h.title.toLowerCase().indexOf(q) >= 0; });
        shown.forEach(function (h) {
          var one = el("button", "hs-base", h.title);
          one.type = "button";
          one.title = h.file;
          one.addEventListener("click", function () { say(r, { with: h.id }, accWords(r.words, h.title)); });
          list.appendChild(one);
        });
        if (!shown.length) { list.appendChild(el("p", "mt-note", homes.length ? "No game of " + r.platform + " is called that." : "No other game of " + r.platform + " is in the library.")); }
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
    top.appendChild(el("span", "hs-t", r.file));
    top.appendChild(el("span", "hs-p", r.platform + "  ·  in the list as " + r.title));
    c.appendChild(top);
    var s = r.suggest;
    c.appendChild(el("p", "hs-why", "Its name says " + r.words.toLowerCase() + ". "
      + (s ? "Looks like " + accWords(r.words, s.title) + ": " + s.why + "." : "No game in the library could be named for it.")));
    var acts = el("div", "bk-acts hs-acts");
    function act(label, cls, run) {
      var b = el("button", cls, label);
      b.type = "button";
      b.addEventListener("click", run);
      acts.appendChild(b);
    }
    if (s) { act("Yes, " + accWords(r.words, s.title), "primary hs-yes", function () { say(r, { with: s.id }, accWords(r.words, s.title)); }); }
    act(s ? "Another game..." : "Pick the game...", s ? "hs-other" : "primary hs-other", function () {
      open = open === r.id ? null : r.id;
      paint();
    });
    act("Its game is not here", "hs-gone", function () { say(r, { with: "" }, accWords(r.words, "")); });
    act("Not one: a game of its own", "hs-not", function () { say(r, { not: true }, "a game of its own"); });
    c.appendChild(acts);
    if (open === r.id) { picker(c, r); }
    return c;
  }

  function paint() {
    return api("api/accompanied.php?settle=1").then(function (res) {
      if ($editor.dataset.tool !== "accsettle") { return; }
      if (!res.ok) { showStrip("could not read the files: " + (res.error || ""), true); return; }
      var rows = res.files || [];
      var inner = toolFrame("FILES THAT MAY GO WITH A GAME", { cls: "hs-inner" });
      inner.appendChild(el("p", "group-help",
        "Files whose names say they are an install disc or a bonus disc: they come with a game and are not played themselves. " +
        "Say which game each goes with and it leaves the lists for that game's Files tab, with Play greyed; that game wears the multi-disc mark. " +
        "Until you say, each stays a game in its list and plays like one. Nothing on the disk is moved or changed."));
      inner.appendChild(el("p", "rp-verdict " + (rows.length ? "warn" : "good"),
        rows.length ? rows.length + (rows.length === 1 ? " file waits" : " files wait") + " for your word."
                    : "Nothing waits: every file named as an install or bonus disc has been spoken for."));
      rows.forEach(function (r) { inner.appendChild(card(r)); });
      $editor.appendChild(inner);
      $editor.hidden = false;
    });
  }

  $editor.dataset.tool = "accsettle";
  setEditorOnClose(function () { delete $editor.dataset.tool; });
  paint().then(function () { sound("select"); });
}
