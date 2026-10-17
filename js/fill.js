/*  Pictures & Videos > Get Pictures.
 *
 *  A scanned game arrives with only a title read off the file name. Fill in
 *  asks the Games Database that ships with Xsegon (gamesdb\) what each game is
 *  and fills only the empty fields and picture slots. Without it, or with
 *  Settings > Library saying so, the server asks libretro instead
 *  (includes\libretro.php) and answers with source: "libretro".
 *
 *  The pass is a job on the server (includes\fill.php, bin\fill.php) with a
 *  bar in the corner (js\fillbar.js). Fill in all starts it for every game and
 *  fills the ones it is sure of. Fill in custom opens at once on the library's
 *  games, and only the selected ones are looked up: looking every game up first
 *  keeps a big library waiting for minutes.
 *
 *  WHOSE DECISION (includes\fill.php, xs_fill_sort):
 *
 *      Ready to fill      Xsegon is sure; selected
 *      For you to check   a name that only starts the same, a guess, or two
 *                         of your games matched to one entry; never selected
 *                         for you, not by Fill in all and not by Select all
 *      Nothing found      Change... searches by hand; also a game named only
 *                         after its console, which gets no guess
 *      Already filled     folded away: filling them again only takes time
 */

import { closeEditor, setEditorOnClose, toolFrame } from "./editors.js";
import { FILL_SLOT_WORDS, fillWatch, fillWords } from "./fillbar.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { el } from "./util.js";

var WORDS = { sure: "sure", likely: "probably", maybe: "a guess", none: "nothing in the database with these words", linked: "chosen before",
              console: "named only after its console, so no guess" };
var LR_NONE = "not on libretro's lists";
var LOOK_MS = 600;

var GROUPS = [
  ["ready", "Ready to fill", "Xsegon is sure of these."],
  ["check", "For you to check", "Xsegon is not sure of these: a name that only starts the same, a guess, or two of your games matched to one entry. None of these is filled unless you select it: look at each, and use Change... where it is wrong."],
  ["none", "Nothing found", "Nothing under these names. Change... searches for the game yourself."],
  ["done", "Already filled", "Filled before, each with its box. Select one to look for its other pictures again."]
];

function post(body) {
  return postJson("api/fill.php", body);
}

/* Fill in all: the job, and nothing on screen but the bar. From Getting
   started the guide is drawn again, and its step says the pass is at work. */
function fillAll(onBack) {
  L("ED", "fill in all, in the background");
  post({ job: "start", mode: "all", pictures: true }).then(function (r) {
    if (!r.ok) { showStrip(r.error || "Get Pictures could not be started", !/already running/.test(r.error || "")); return; }
    sound("select");
    fillWatch();
    if (onBack) { onBack(); }
  });
}

// only: game ids a message named (js\news.js): those are selected and looked up at once.
export function openFillTool(onBack, auto, only) {
  if (auto) { fillAll(onBack); return; }
  L("ED", "fill tool");
  stopVideo();
  var lr = false;                        // the answer came from libretro
  var looking = false;                   // a look of ours is on its way
  var scanned = [];                      // every scanned game, as the first screen lists them
  var slots = [];                        // the picture slots this source can fill
  var chosen = {};                       // game id => true: selected on the first screen
  var want = { console: "", show: "", find: "" };
  var turn = 0;                          // which look, or first screen, the panel is on

  function mine() { return $editor.dataset.tool === "fill"; }

  // other: one more button for the head, {label, run}.
  function shell(other) {
    var before = [];
    if (onBack) { before.push({ label: "‹ Back", run: function () { leave(); onBack(); } }); }
    if (other) { before.push({ label: other.label, run: function () { leave(); other.run(); } }); }
    // keep: show() below swaps the old panel for this one itself
    return toolFrame("GET SPECIFIC PICTURES", { before: before, keep: true });
  }

  function show(inner) {
    $editor.textContent = "";
    $editor.appendChild(inner);
    $editor.hidden = false;
  }

  // A look nobody is waiting for any more is told to stop.
  function leave() {
    if (looking) { looking = false; post({ job: "stop" }); }
  }

  function matchLine(g) {
    var m = g.match || {};
    if (g.dbId && m.confidence === "linked") {
      var b = m.best && m.best.id === g.dbId ? m.best : null;
      return (b ? b.title + (b.year ? "  ·  " + b.year : "") : (lr ? g.dbId : "database #" + g.dbId)) + "  ·  " + WORDS.linked;
    }
    if (!m.best) { return g.why === "console" ? WORDS.console : lr ? LR_NONE : WORDS.none; }
    return m.best.title + (m.best.platform !== g.platform ? "  (" + m.best.platform + ")" : "") +
           (m.best.year ? "  ·  " + m.best.year : "") + "  ·  " +
           (g.why === "clash" ? "also the match for " + (g.with || []).join(", ") : (WORDS[m.confidence] || m.confidence));
  }

  /* Wait for a job to end, saying how far it is. A fill started elsewhere
     (Fill in all, or this screen a moment ago) is waited for first, with a
     way to stop it; then the look this screen needs is made. */
  function waitFor(line, isLook, alive) {
    return new Promise(function (resolve) {
      (function again() {
        if (!alive()) { resolve(null); return; }
        api("api/fill.php?job=1").then(function (r) {
          if (!alive()) { resolve(null); return; }
          var j = r && r.job;
          if (!j || j.state !== "running") { resolve(j || {}); return; }
          var w = fillWords(j);
          line.textContent = isLook
            ? (j.phase === "prepare" ? "Setting up the Games Database. This happens once, and takes up to half a minute..."
               : "Looked up " + (j.looked || 0) + (j.scanned ? " of " + j.scanned : "") + "...")
            : "Get Pictures is at work in the background: " + w[0] + ". The list opens when it has finished.";
          setTimeout(again, LOOK_MS);
        });
      })();
    });
  }

  // Back to the first screen, the selection kept.
  var otherGames = { label: "‹ Other games", run: function () { choose(); } };

  function failed(words) {
    var inner = shell(scanned.length ? otherGames : null);
    inner.appendChild(el("p", "mt-note bad", words));
    show(inner);
  }

  /* The first screen: every scanned game as the library has it, nothing
     looked up, so it is up at once however many there are. */
  function firstScreen() {
    var inner = shell();
    inner.appendChild(el("p", "group-help", "Reading your games..."));
    show(inner);
    api("api/fill.php?list=1").then(function (res) {
      if (!mine()) { return; }
      if (!res.ok) { failed("Could not read your games: " + (res.error || "the server did not answer")); return; }
      lr = res.source === "libretro";
      slots = res.slots || [];
      scanned = (res.games || []).slice().sort(function (a, b) {
        return a.platform.localeCompare(b.platform) || a.title.localeCompare(b.title);
      });
      sound("select");
      if (only && only.length) {
        var named = scanned.filter(function (g) { return only.indexOf(String(g.id)) >= 0; }).map(function (g) { return g.id; });
        only = null;
        if (named.length) {
          named.forEach(function (id) { chosen[id] = true; });
          L("ED", "fill look " + named.length + " games named by a message");
          lookFor(named);
          return;
        }
        choose("The games that message named are no longer in the library. These are the ones that are.");
        return;
      }
      choose();
    });
  }

  function lacks(g) { return slots.filter(function (k) { return !(g.art || {})[k]; }); }

  function choose(note) {
    turn++;                              // a look still on its way is nobody's now
    var inner = shell();
    if (note) { inner.appendChild(el("p", "mt-note bad", note)); }
    if (!scanned.length) {
      inner.appendChild(el("p", "mt-note", "No scanned games yet. Games > Scan for Games is where they come from."));
      show(inner);
      return;
    }
    inner.appendChild(el("p", "group-help",
      "Select the games you want pictures for. Only those are looked up, and nothing is changed until you say so on the next screen."));
    // The box is the picture a game is known by: the games without one come first.
    var SHOWS = [
      ["nobox", "No box art", function (g) { return !(g.art || {}).box; }],
      ["missing", "Missing any picture", function (g) { return lacks(g).length > 0; }],
      ["all", "All games", function () { return true; }]
    ];
    var showN = {};
    SHOWS.forEach(function (s) { showN[s[0]] = scanned.filter(s[2]).length; });
    if (want.show === "") { want.show = showN.nobox ? "nobox" : showN.missing ? "missing" : "all"; }
    function inShow(g) { return SHOWS.filter(function (s) { return s[0] === want.show; })[0][2](g); }

    var box = el("div", "sc-rows fl-rows");
    var emptyNote = el("p", "mt-note");
    var count = el("span", "mt-note fl-count");
    var shownNow = [];
    function paintCount() {
      count.textContent = Object.keys(chosen).length + " of " + scanned.length + " selected";
    }
    function paintRows() {
      var find = want.find.trim().toLowerCase();
      shownNow = scanned.filter(function (g) {
        return (!want.console || g.platform === want.console) && inShow(g) &&
               (!find || g.title.toLowerCase().indexOf(find) >= 0);
      });
      box.textContent = "";
      shownNow.forEach(function (g) {
        var rowEl = el("div", "sc-row fl-row fl-pick");
        var c = el("input"); c.type = "checkbox"; c.checked = !!chosen[g.id];
        c.addEventListener("change", function () {
          if (c.checked) { chosen[g.id] = true; } else { delete chosen[g.id]; }
          paintCount();
        });
        var lab = el("label");
        lab.appendChild(c);
        lab.appendChild(el("span", "sc-title", " " + g.title));
        lab.appendChild(el("span", "sc-rom", g.platform));
        rowEl.appendChild(lab);
        var need = lacks(g);
        rowEl.appendChild(el("span", "fl-match" + (need.length ? " warn" : ""),
          !need.length ? "has every picture" : need.length === slots.length ? "no pictures yet"
            : "missing: " + need.map(function (k) { return FILL_SLOT_WORDS[k] || k; }).join(", ")));
        box.appendChild(rowEl);
      });
      box.hidden = !shownNow.length;
      emptyNote.hidden = !!shownNow.length;
      emptyNote.textContent = want.show !== "all" && !find && !want.console
        ? (want.show === "nobox" ? "Every game has its box art." : "Every game has all its pictures.") + " All games lists them anyway."
        : "No games here match.";
      paintCount();
    }

    var btns = el("div", "art-btns");
    var go = el("button", "primary", "Look up the selected games");
    var allBtn = el("button", null, "Select all shown");
    var noneBtn = el("button", null, "Deselect all");
    go.addEventListener("click", function () {
      var ids = scanned.filter(function (g) { return chosen[g.id]; }).map(function (g) { return g.id; });
      if (!ids.length) { showStrip("nothing is selected", true); return; }
      L("ED", "fill look " + ids.length + " of " + scanned.length);
      lookFor(ids);
    });
    allBtn.addEventListener("click", function () {
      shownNow.forEach(function (g) { chosen[g.id] = true; });
      paintRows();
      sound("select");
    });
    noneBtn.addEventListener("click", function () { chosen = {}; paintRows(); sound("select"); });
    [go, allBtn, noneBtn, count].forEach(function (n) { btns.appendChild(n); });

    // Which games the list shows: a console, the ones short of a picture or all, a name.
    var narrow = el("div", "fl-narrow");
    var perConsole = {};
    scanned.forEach(function (g) { perConsole[g.platform] = (perConsole[g.platform] || 0) + 1; });
    var pickConsole = el("select");
    var every = el("option", null, "All consoles (" + scanned.length + ")");
    every.value = "";
    pickConsole.appendChild(every);
    Object.keys(perConsole).sort().forEach(function (p) {
      var o = el("option", null, p + " (" + perConsole[p] + ")");
      o.value = p;
      pickConsole.appendChild(o);
    });
    pickConsole.value = want.console;
    pickConsole.addEventListener("change", function () { want.console = pickConsole.value; paintRows(); });
    narrow.appendChild(pickConsole);
    var chips = SHOWS.map(function (s) {
      var chip = el("button", "fl-chip" + (want.show === s[0] ? " on" : ""), s[1] + "  " + showN[s[0]]);
      chip.type = "button";
      chip.dataset.show = s[0];
      chip.addEventListener("click", function () {
        want.show = s[0];
        chips.forEach(function (n) { n.classList.toggle("on", n === chip); });
        paintRows();
      });
      narrow.appendChild(chip);
      return chip;
    });
    var findBox = el("input");
    findBox.type = "text";
    findBox.placeholder = "Find a game";
    findBox.value = want.find;
    findBox.addEventListener("input", function () { want.find = findBox.value; paintRows(); });
    // Typing is for the box; Esc still closes the screen.
    findBox.addEventListener("keydown", function (e) { if (e.key !== "Escape") { e.stopPropagation(); } });
    narrow.appendChild(findBox);

    var bar = el("div", "fl-bar");
    bar.appendChild(btns);
    bar.appendChild(narrow);
    inner.appendChild(bar);
    inner.appendChild(box);
    inner.appendChild(emptyNote);
    paintRows();
    show(inner);
  }

  /* The look, of the selected games only. A fill at work elsewhere is waited
     for first, with a way to stop it. */
  function lookFor(ids) {
    var my = ++turn;
    function alive() { return mine() && my === turn; }
    var words = "Looking up " + ids.length + (ids.length === 1 ? " game..." : " games...");
    var inner = shell(otherGames);
    var line = el("p", "group-help", words);
    inner.appendChild(line);
    var stopRow = el("div", "art-btns");
    inner.appendChild(stopRow);
    show(inner);

    /* Ours and nobody else's. A look still ending (this screen closed
       mid-look and opened again) is told to stop and waited out, then ours
       starts: waiting for it instead would show its rows as if they were ours. */
    function begin(tries) {
      return post({ job: "start", mode: "look", ids: ids }).then(function (r) {
        if (!alive()) { return null; }
        if (r.ok) { looking = true; return waitFor(line, true, alive); }
        if (tries > 0 && /looked up/.test(r.error || "")) {
          return post({ job: "stop" }).then(function () { return waitFor(line, true, alive); })
            .then(function (j) { return j === null ? null : begin(tries - 1); });
        }
        failed("Could not look them up: " + (r.error || "the server did not answer"));
        return null;
      });
    }

    return api("api/fill.php?job=1").then(function (r) {
      if (!alive()) { return null; }
      var j = (r && r.job) || {};
      if (j.state !== "running" || j.mode === "look") { return j; }
      var stopBtn = el("button", null, "Stop it");
      stopBtn.addEventListener("click", function () { stopBtn.disabled = true; post({ job: "stop" }); });
      stopRow.appendChild(stopBtn);
      return waitFor(line, false, alive);
    }).then(function (before) {
      if (!alive() || before === null) { return null; }
      stopRow.textContent = "";
      line.textContent = words;
      return begin(3);
    }).then(function (j) {
      if (!alive() || !j) { return; }
      looking = false;
      if (j.state === "failed") { failed("Could not look them up: " + (j.error || "the worker stopped")); return; }
      // Stopped from somewhere else: there is nothing of ours to show.
      if (j.state !== "done" || j.mode !== "look") { choose("The lookup was stopped before it finished. Nothing was changed."); return; }
      return api("api/fill.php?job=rows").then(function (res) {
        if (!alive()) { return; }
        if (!res.ok) { failed("Could not read what was found: " + (res.error || "the server did not answer")); return; }
        if ((res.lookedAt || 0) < (j.started || 0)) { choose("The lookup did not finish. Nothing was changed."); return; }
        lr = res.source === "libretro";
        list(res.rows || [], ids.length < scanned.length);
      });
    });
  }

  // part: the look was of chosen games, not of every scanned game.
  function list(rows, part) {
    var inner = shell(otherGames);
    inner.appendChild(el("p", "group-help", lr
      ? "Looked up on libretro's lists, the ones RetroArch uses. Only empty fields and empty picture slots are filled: " +
        "a name you changed and a picture you chose stay."
      : "Looked up in the LaunchBox Games Database (a copy is on this PC). Only empty fields and empty picture slots " +
        "are filled: anything you typed or chose stays."));

    if (!rows.length) {
      inner.appendChild(el("p", "mt-note", "None of those games is in the library any more."));
      show(inner);
      return;
    }
    var n = { ready: 0, check: 0, none: 0, done: 0 };
    rows.forEach(function (g) { n[g.state] = (n[g.state] || 0) + 1; });
    var said = [rows.length + (rows.length === 1 ? " game" : " games")];
    [["ready", "ready to fill and selected"], ["check", "for you to check"], ["none", "with nothing found"], ["done", "filled before"]].forEach(function (c) {
      if (n[c[0]]) { said.push(n[c[0]] + " " + c[1]); }
    });
    inner.appendChild(el("p", "group-help", said.join("  ·  ") + ". Get pictures for the selected games runs in the background, and this screen closes."));

    var picks = [];
    function rowFor(g) {
      var rowEl = el("div", "sc-row fl-row");
      rowEl.dataset.state = g.state;
      var c = el("input"); c.type = "checkbox";
      var conf = (g.match || {}).confidence;
      // Selected for you only where Xsegon is sure. A guess is yours to select.
      // One filled before that you chose on the first screen is selected too, while it lacks a picture.
      var again = !!part && g.state === "done" && slots.some(function (k) { return !(g.art || {})[k]; });
      c.checked = g.state === "ready" || again;
      c.disabled = !(g.match && g.match.best) && !g.dbId;
      var lab = el("label");
      lab.appendChild(c);
      lab.appendChild(el("span", "sc-title", " " + g.title));
      lab.appendChild(el("span", "sc-rom", g.platform));
      rowEl.appendChild(lab);
      var line = el("span", "fl-match" + (g.state === "none" ? " bad" : g.state === "check" ? " warn" : ""), matchLine(g));
      rowEl.appendChild(line);
      var change = el("button", "sc-rm", "Change...");
      change.type = "button";
      rowEl.appendChild(change);
      var rowPick = { box: c, game: g, state: g.state, chosen: again, dbId: g.dbId || (g.match && g.match.best ? g.match.best.id : 0) };
      picks.push(rowPick);

      // Not that one: a search box in the row, the same search Find online
      // uses, and the chosen game becomes this row's match.
      change.addEventListener("click", function () {
        var old = rowEl.querySelector(".pk-search");
        if (old) { old.remove(); rowEl.querySelector(".pk-results").remove(); return; }
        var search = el("div", "pk-search");
        var q = el("input"); q.type = "text"; q.value = g.title;
        var go = el("button", "primary", "Search");
        search.appendChild(q); search.appendChild(go);
        var results = el("div", "pk-results");
        rowEl.appendChild(search);
        rowEl.appendChild(results);
        function run() {
          results.textContent = "searching...";
          api(lr ? "api/fill.php?id=" + encodeURIComponent(g.id) + "&search=" + encodeURIComponent(q.value)
                 : "api/gamesdb.php?id=" + encodeURIComponent(g.id) + "&what=search&q=" + encodeURIComponent(q.value)).then(function (r) {
            results.textContent = "";
            if (!r.ok) { results.textContent = r.error || "search failed"; return; }
            if (!r.results.length) { results.textContent = "nothing matched"; return; }
            r.results.forEach(function (m) {
              var hit = el("div", "pk-result" + (m.platform === g.platform ? " same" : ""));
              hit.appendChild(el("span", "t", m.title));
              hit.appendChild(el("span", "p", m.platform + (m.year ? "  ·  " + m.year : "")));
              hit.addEventListener("click", function () {
                rowPick.dbId = m.id;
                rowPick.chosen = true;           // yours now: Select all takes it
                c.checked = true;
                c.disabled = false;
                paintCount();
                line.textContent = m.title + (m.platform !== g.platform ? "  (" + m.platform + ")" : "") + (m.year ? "  ·  " + m.year : "") + "  ·  chosen by you";
                line.className = "fl-match";
                search.remove(); results.remove();
                sound("select");
              });
              results.appendChild(hit);
            });
          });
        }
        go.addEventListener("click", run);
        q.addEventListener("keydown", function (e) { if (e.key === "Enter") { run(); } e.stopPropagation(); });
        run();
      });
      return rowEl;
    }

    var body = el("div", "fl-groups");
    GROUPS.forEach(function (grp) {
      var these = rows.filter(function (g) { return g.state === grp[0]; });
      if (!these.length) { return; }
      var h = el("h3", "fl-group " + grp[0], grp[1] + "  (" + these.length + ")");
      var box = el("div", "sc-rows fl-rows");
      these.forEach(function (g) { box.appendChild(rowFor(g)); });
      body.appendChild(h);
      body.appendChild(el("p", "fl-group-help", grp[2]));
      // The ones filled before are folded away until asked for, unless you chose these games yourself.
      if (grp[0] === "done" && !part) {
        box.classList.add("folded");
        var fold = el("button", null, "Show");
        fold.type = "button";
        fold.addEventListener("click", function () {
          fold.textContent = box.classList.toggle("folded") ? "Show" : "Hide";
        });
        h.appendChild(fold);
      }
      body.appendChild(box);
    });
    inner.appendChild(body);

    var opts = el("div", "fl-opts");
    var picsLab = el("label");
    var pics = el("input"); pics.type = "checkbox"; pics.checked = true;
    picsLab.appendChild(pics);
    picsLab.appendChild(document.createTextNode(lr
      ? " Pictures too (box, logo, screenshot, and the title screen as the background), one download each, for the slots that have none"
      : " Pictures too (box, logo, screenshot, background), one download each, for the slots that have none"));
    opts.appendChild(picsLab);

    var btns = el("div", "art-btns");
    var go = el("button", "primary", "Get pictures for the selected games");
    /* Select all is every game Xsegon is sure of, and any matched with Change....
       Never the guesses: a guess is often another console's or another game, and a
       field filled from the wrong game is no longer empty for the right one. */
    var all = el("button", null, "Select all");
    all.title = "Every game Xsegon is sure of. The ones for you to check are selected one at a time.";
    var none = el("button", null, "Deselect all");
    var count = el("span", "mt-note fl-count");
    function paintCount() {
      var on = picks.filter(function (p) { return p.box.checked && p.dbId; }).length;
      count.textContent = on + " of " + picks.length + " selected";
    }
    all.addEventListener("click", function () {
      picks.forEach(function (p) { if (!p.box.disabled && p.dbId && (p.state === "ready" || p.chosen)) { p.box.checked = true; } });
      paintCount();
      sound("select");
    });
    none.addEventListener("click", function () {
      picks.forEach(function (p) { p.box.checked = false; });
      paintCount();
      sound("select");
    });
    body.addEventListener("change", paintCount);
    paintCount();

    /* One press starts the job for every selected game, and the screen goes:
       the bar in the corner takes over. complete tells the job that nothing
       Xsegon is sure of was left out, so Getting started can check its step
       off when the job is through. */
    go.addEventListener("click", function () {
      var todo = picks.filter(function (p) { return p.box.checked && p.dbId; });
      if (!todo.length) { showStrip("nothing is selected", true); return; }
      var complete = !part && !picks.some(function (p) { return p.state === "ready" && !p.box.checked; });
      L("ED", "fill " + todo.length + " of " + picks.length + ", in the background");
      go.disabled = all.disabled = none.disabled = true;
      post({ job: "start", mode: "picked", pictures: pics.checked, complete: complete,
             picks: todo.map(function (p) { return { id: p.game.id, dbId: p.dbId }; }) }).then(function (r) {
        if (!r.ok) {
          go.disabled = all.disabled = none.disabled = false;
          showStrip(r.error || "Get Pictures could not be started", true);
          return;
        }
        fillWatch();
        if (!mine()) { return; }
        if (onBack) { onBack(); } else { closeEditor(); }
      });
    });
    btns.appendChild(go);
    btns.appendChild(all);
    btns.appendChild(none);
    btns.appendChild(count);
    /* The button goes OVER the list and stays in view as the list scrolls:
       after the last row it would be screens down, under hundreds of games. */
    var bar = el("div", "fl-bar");
    bar.appendChild(btns);
    bar.appendChild(opts);
    inner.insertBefore(bar, body);
    // Credit where the details come from (gamesdb\README.md).
    inner.appendChild(el("p", "mt-note", lr
      ? "Names, details and pictures from libretro (github.com/libretro), the lists RetroArch uses."
      : "Details and pictures from the LaunchBox Games Database (gamesdb.launchbox-app.com), with thanks to LaunchBox and everyone who adds to it."));
    show(inner);
    sound("select");

    /* With nothing Xsegon is sure of on the list, the pass is as complete as
       it can be without a person: the server is told, so Getting started
       stops counting the games nobody could match as work to do. */
    if (!n.ready && !part) {
      postJson("api/setup.php", { asked: "fill" });
    }
  }

  $editor.dataset.tool = "fill";
  setEditorOnClose(function () {
    leave();
    delete $editor.dataset.tool;
  });
  firstScreen();
}
