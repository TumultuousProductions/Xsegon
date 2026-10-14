/*  The Accompanied files tab of a game's details (js\detailtabs.js,
    includes\accompanied.php): the files that go with this game and are not
    played, each with Play greyed. It also says what this file itself goes with:
    until someone says, the choices stand first, with the game Xsegon would name. */

import { accWords, sayAcc } from "./accsettle.js";
import { closeDetails } from "./details.js";
import { setTabRows, tabPane, tabSays } from "./detailtabs.js";
import { iconEl } from "./icons.js";
import { showStrip } from "./launch.js";
import { L, api } from "./log.js";
import { sound } from "./sound.js";
import { el } from "./util.js";

export function accTabLabel(g) {
  return "Accompanied files" + (g && g.accompanied ? " (" + g.accompanied + ")" : "");
}

export function accPane(pane, g) {
  pane.appendChild(el("p", "dtab-wait", "…"));
  api("api/accompanied.php?id=" + encodeURIComponent(g.id)).then(function (res) { paint(pane, g, res, null); });
}

function again(pane, g) {
  api("api/accompanied.php?id=" + encodeURIComponent(g.id)).then(function (res) { paint(pane, g, res, null); });
}

/* Said, and the tab drawn from the answer. A file that left the lists closes details: it is no game to show. */
function settle(pane, g, id, what, words, name) {
  sayAcc(id, what, g.id).then(function (res) {
    if (!res.ok) {
      sound("back");
      showStrip("Not kept: " + (res.error || "the server gave no answer"), true);
      again(pane, g);
      return;
    }
    L("ACC", "said of " + name + ": " + words);
    sound("ok");
    showStrip(name + ": " + words, false);
    if (id === g.id && what.with) { closeDetails(); return; }
    paint(pane, g, res.state ? Object.assign({ ok: true }, res.state) : { ok: false }, null);
  });
}

/* A list to pick from with a find box: the games this file could go with, or the files that could go with this game. */
function pick(pane, g, which, back) {
  api("api/accompanied.php?id=" + encodeURIComponent(g.id) + "&" + which + "=1").then(function (res) {
    if (tabPane("accompanied") !== pane) { return; }
    var all = (res.ok && res[which]) || [];
    pane.textContent = "";
    var inner = el("div", "ch-inner ch-tab hck-tab hck-pick");
    inner.appendChild(el("p", "group-help", which === "homes"
      ? "Which game does " + g.title + " go with? The games of " + g.platform + "."
      : "Which file goes with " + g.title + "? It leaves the lists and shows here, with Play greyed. The files of " + g.platform + "."));
    var seek = el("div", "set-find ch-find");
    seek.appendChild(iconEl("find-ico", "search"));
    var box = el("input");
    box.type = "text";
    box.placeholder = which === "homes" ? "find the game" : "find the file";
    box.spellcheck = false;
    seek.appendChild(box);
    inner.appendChild(seek);
    var list = el("div", "ch-list hck-list");
    inner.appendChild(list);
    var foot = el("p", "mt-note");
    inner.appendChild(foot);
    pane.appendChild(inner);

    var cells = [], picks = [], at = 0;
    function choose(i) {
      var p = picks[i];
      if (!p) { back(); return; }
      if (which === "homes") { settle(pane, g, g.id, { with: p.id }, "goes with " + p.title, g.title); }
      else { settle(pane, g, p.id, { with: g.id }, "goes with " + g.title, p.file || p.title); }
    }
    function focusAt(i) {
      i = Math.max(0, Math.min(cells.length - 1, i));
      at = i;
      cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
      setTabRows(pane, { cells: cells, at: i, find: box, word: picks[i] ? "say so" : "go back",
                         move: function (d) { focusAt(at + d); }, choose: function () { choose(at); } });
      if (cells[i]) { cells[i].scrollIntoView({ block: "nearest", inline: "nearest" }); }
    }
    function fill() {
      var q = box.value.trim().toLowerCase();
      list.textContent = "";
      cells = [];
      picks = [null].concat(all.filter(function (h) { return !q || (h.title + " " + h.file).toLowerCase().indexOf(q) >= 0; }));
      picks.forEach(function (h, i) {
        var line = el("div", "cr-row sv-row hck-row " + (h ? "hck-base" : "ch-act hck-back"));
        line.appendChild(iconEl("cr-ico", h ? "disc" : "back"));
        var words = el("div", "sv-words");
        words.appendChild(el("span", "cr-name", h ? h.title : "Back, with nothing said"));
        if (h) { words.appendChild(el("span", "sv-sub hck-sub", h.file)); line.dataset.id = h.id; }
        line.appendChild(words);
        line.addEventListener("mouseenter", function () { focusAt(i); });
        line.addEventListener("click", function () { choose(i); });
        cells.push(line);
        list.appendChild(line);
      });
      foot.textContent = q ? (picks.length - 1) + " of " + all.length + " match “" + box.value.trim() + "”."
        : all.length + (all.length === 1 ? " to pick from." : " to pick from.");
      focusAt(Math.min(at, cells.length - 1));
    }
    var wait;
    box.addEventListener("input", function () { clearTimeout(wait); wait = setTimeout(function () { at = 0; fill(); }, 120); });
    fill();
  });
}

/* res: the tab's answer. asking: the file whose row was pressed, to offer taking it back. */
function paint(pane, g, res, asking, choosing) {
  if (tabPane("accompanied") !== pane) { return; }
  pane.textContent = "";
  var inner = el("div", "ch-inner ch-tab hck-tab acc-tab");
  pane.appendChild(inner);
  if (!res.ok) {
    inner.appendChild(tabSays("what goes with this game could not be read"));
    setTabRows(pane, null);
    return;
  }
  var files = res.files || [], s = res.suggest, rows = [];
  L("ACC", "tab " + g.title + ": " + files.length + " file(s) with it" + (res.state ? ", itself " + res.state : ""));

  if (asking) {
    inner.appendChild(el("p", "group-help", asking.file));
    rows.push({ act: "unsettle", id: asking.id, name: "Take it back", sub: "it returns to the " + g.platform + " list as a game of its own, and plays like one", words: "back in the list as a game", who: asking.file });
    rows.push({ act: "back", name: "Back, with nothing changed", sub: "it stays here, not played" });
  } else if (res.state === "ask" || choosing) {
    var kind = res.words.toLowerCase();
    inner.appendChild(el("p", "group-help", (res.state === "ask" ? "This file's name says it is " + (/^[aeiou]/.test(kind) ? "an " : "a ") + kind + ". " : "")
      + "Say which game it goes with: it then leaves the lists and shows in that game's Accompanied files tab, with Play greyed. Nothing on the disk is touched."));
    if (s) { rows.push({ act: "say", with: s.id, name: "Yes, " + accWords(res.words, s.title), sub: "Xsegon's reading: " + s.why, words: "goes with " + s.title }); }
    rows.push({ act: "homes", name: s ? "It goes with another game…" : "Pick the game it goes with…", sub: "from the games of " + g.platform });
    rows.push({ act: "say", with: "", name: "It goes with a game that is not in the library", sub: "it stays in the list, with Play greyed", words: "goes with a game that is not in the library" });
    rows.push({ act: "not", name: "Not one: it is a game of its own", sub: res.state === "ask" ? "it is not suggested again" : "nothing changes", words: "a game of its own" });
    if (res.state === "with" || res.state === "not") { rows.push({ act: "unsettle", id: g.id, name: "Take back what was said", sub: "as if nothing had been said of it", words: "what was said is taken back", who: g.title }); }
  } else if (res.state === "with") {
    rows.push({ act: "change", name: "Goes with " + (res.with ? res.with.title || "a game that is no longer in the library" : "a game that is not in the library"),
                sub: "said by you, so Play is greyed; a press changes it" });
  } else if (res.state === "not") {
    rows.push({ act: "change", name: "Said to be a game of its own", sub: "said by you; a press changes it" });
  }

  if (!asking && files.length) {
    inner.appendChild(el("p", "group-help", (files.length > 1 ? "Files that go" : "A file that goes") + " with this game and " + (files.length > 1 ? "are" : "is")
      + " not played: Play on this game starts the game itself. A press on one offers to take it back into the list."));
    files.forEach(function (f) { rows.push({ act: "file", f: f }); });
  }
  if (!asking && !choosing && res.state !== "ask" && res.state !== "with") {
    rows.push({ act: "files", name: "Add a file that goes with this game…", sub: "an install disc, a bonus disc: it leaves the lists and shows here" });
    if (res.may && !files.length && res.state !== "not") {
      rows.push({ act: "change", name: "This file goes with another game…", sub: "say which, and it leaves the lists for that game's tab" });
    }
  }
  if (!rows.length) {
    inner.appendChild(tabSays("Nothing goes with this game"));
    setTabRows(pane, null);
    return;
  }

  var list = el("div", "ch-list hck-list");
  var cells = [], at = 0;
  function run(i) {
    var item = rows[i];
    if (!item || list.dataset.busy === "1") { return; }
    if (item.act === "change") { sound("select"); paint(pane, g, res, null, true); return; }
    if (item.act === "back") { sound("back"); paint(pane, g, res, null); return; }
    if (item.act === "file") { sound("select"); paint(pane, g, res, item.f); return; }
    if (item.act === "homes" || item.act === "files") {
      sound("select");
      pick(pane, g, item.act, function () { paint(pane, g, res, null, choosing); });
      return;
    }
    list.dataset.busy = "1";
    if (item.act === "say") { settle(pane, g, g.id, { with: item.with }, item.words, g.title); }
    else if (item.act === "not") { settle(pane, g, g.id, { not: true }, item.words, g.title); }
    else if (item.act === "unsettle") { settle(pane, g, item.id, { unsettle: true }, item.words, item.who); }
  }
  var WORD = { say: "say so", not: "say so", homes: "choose", files: "choose", change: "change", unsettle: "take back", back: "go back", file: "choose" };
  function focusAt(i) {
    i = Math.max(0, Math.min(cells.length - 1, i));
    at = i;
    cells.forEach(function (c, k) { c.classList.toggle("sel", k === i); });
    setTabRows(pane, { cells: cells, at: i, word: WORD[rows[i].act] || "", move: function (d) { focusAt(at + d); }, choose: function () { run(at); } });
    cells[i].scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  var ICON = { say: "check", homes: "search", files: "search", not: "x", unsettle: "back", change: "tag", back: "back" };
  rows.forEach(function (item, here) {
    var line = el("div", "cr-row sv-row hck-row");
    var words = el("div", "sv-words");
    if (item.f) {
      // Play greyed: the file is listed to say it is here, not to be started.
      line.classList.add("acc-file");
      line.appendChild(iconEl("cr-ico", "disc"));
      words.appendChild(el("span", "cr-name", item.f.file));
      words.appendChild(el("span", "sv-sub hck-sub", item.f.words + " · not played"));
      line.appendChild(words);
      var play = el("span", "cr-tag acc-noplay", "▸ Play");
      play.title = "Not played: it goes with " + g.title;
      line.appendChild(play);
    } else {
      line.classList.add("ch-act", "hck-is");
      line.dataset.act = item.act;
      line.appendChild(iconEl("cr-ico", ICON[item.act] || "info"));
      words.appendChild(el("span", "cr-name", item.name));
      words.appendChild(el("span", "sv-sub hck-sub", item.sub));
      line.appendChild(words);
    }
    line.addEventListener("mouseenter", function () { focusAt(here); });
    line.addEventListener("click", function () { run(here); });
    cells.push(line);
    list.appendChild(line);
  });
  inner.appendChild(list);
  focusAt(0);
}
