/*  Emulators > Runs check: which games boot. The panel starts and stops
    bin\runcheck.ps1 through api\runcheck.php and shows a screenshot a few
    seconds into each game, sorted by result. The check runs on without the
    panel. A tool that starts hundreds of games by itself says what it will not
    do (saves, play history) before anyone presses Start. */

import { openDetails } from "./details.js";
import { closeEditor, setEditorOnClose } from "./editors.js";
import { showStrip } from "./launch.js";
import { filters, load } from "./library.js";
import { L, api, postJson } from "./log.js";
import { popupMenu } from "./menus.js";
import { sound } from "./sound.js";
import { $editor, $platform, $q, games, setSel, sysStage } from "./state.js";
import { chooseSystem } from "./systems.js";
import { openTagMenu } from "./tags.js";
import { el } from "./util.js";
import { render, setView } from "./views.js";

var RESULT = {
  boots:    ["boots", "good"],
  blank:    ["blank screen", "warn"],
  look:     ["look at it", "warn"],
  crashed:  ["crashed", "bad"],
  nostart:  ["did not start", "bad"],
  noanswer: ["no answer", "off"]
};
var SECS_EACH = 20;                      // about how long one game takes, for the estimate

function post(body) {
  return postJson("api/runcheck.php", body);
}

// A result's kind as shown: a game that booted to a blank picture is its own.
function kindOf(r) { return r.result === "boots" && r.blank ? "blank" : r.result; }

// The ones whose check went wrong. A blank screen booted, so it is not here.
function failedOf(rows) {
  return (rows || []).filter(function (r) { return r.result === "crashed" || r.result === "nostart" || r.result === "noanswer"; });
}

// Every filter and the search stand aside: pressing a result means "take me
// to that", and a funnel quietly hiding it would read as a broken button.
function dropFilters() {
  ["fav", "players", "ready", "unplayed", "unrated", "missing", "fails"].forEach(function (k) { filters[k] = false; });
  filters.tags = [];
  filters.myrating = 0;
  $q.value = "";
}

// From a result to the game itself: its console opens with it chosen, and
// its details on top. The one game it cannot reach is one rolled under
// another version's card; then the console is still open and a strip says.
function jumpTo(r) {
  L("RCHK", "to the game " + r.title);
  closeEditor();
  dropFilters();
  if (sysStage === "wall") { chooseSystem(r.platform); }
  else { $platform.value = r.platform; }
  load().then(function () {
    for (var i = 0; i < games.length; i++) {
      if (games[i].id === r.id) {
        setSel(i);
        render();
        openDetails();
        return;
      }
    }
    render();
    showStrip(r.title + " is not its own card here (another version's card may hold it)", true);
  });
}

// A section of the panel: its heading, with what it is about at the right.
function card(title, aside) {
  var c = el("section", "rc-card");
  var h = el("h2", "rc-card-head");
  h.appendChild(el("span", null, title));
  if (aside) { h.appendChild(el("span", "rc-card-aside", aside)); }
  c.appendChild(h);
  return c;
}

export function openRunCheck() {
  L("ED", "runs check");
  var want = { platform: "", skipDone: true, wait: 10, filter: "" };
  var timer = null, clearArmed = false, clearAskedAt = 0, painted = false;

  function paint(res) {
    if ($editor.dataset.tool !== "runcheck") { return; }
    if (res && res.ok && res.consoles) { last = res; }        // a whole answer (or one merged into it): what changes merge into
    /* Painted again as results come in: it keeps its scroll place and plays the
       scale-in only the first time, or the panel shakes every two seconds. */
    var top = $editor.scrollTop;
    $editor.textContent = "";
    var inner = el("div", "panel-inner ed-inner rc");
    if (painted) { inner.style.animation = "none"; }
    painted = true;
    var head = el("div", "set-head");
    head.appendChild(el("h1", "panel-title", "RUNS CHECK"));
    var done = el("button", "primary", "Done (esc)");
    done.addEventListener("click", closeEditor);
    head.appendChild(done);
    inner.appendChild(head);
    $editor.appendChild(inner);
    $editor.hidden = false;
    if (!res || !res.ok) {
      inner.appendChild(el("p", "mt-note bad", (res && res.error) || "could not ask"));
      return;
    }

    /* One line on what it does; the promises fold away under it, said once
       before anyone presses Start and there whenever they want them. */
    var intro = el("div", "rc-intro");
    intro.appendChild(el("p", null, "Starts each game for a few seconds, takes a picture, and closes it. One at a time, about " + SECS_EACH + " seconds each."));
    var about = el("details", "rc-about");
    about.appendChild(el("summary", null, "What it does and never does"));
    var safe = el("ul", "rc-safe");
    [
      "Your saves are never touched by RetroArch, Dolphin, Xenia or RPCS3: theirs go to the check's own folder. PCSX2, Cemu and xemu boot with your own memory cards.",
      "It never counts as playing: no play count, no play time.",
      "Small window, never full screen; your own settings stay as they are.",
      "A game that started is closed the way its X button would, never forced.",
      "Boots means it starts, not that it plays to the end."
    ].forEach(function (t) { safe.appendChild(el("li", null, t)); });
    about.appendChild(safe);
    intro.appendChild(about);
    inner.appendChild(intro);

    var st = res.status || {};
    var starting = !!st.starting && !st.running && Date.now() - Date.parse(st.startedAt || 0) < 30000;
    var run = card("Check", st.running || starting ? "running" : "");
    run.appendChild(st.running || starting ? progress(st) : controls(res));
    // Stopped by itself (the games folder went away, say), with the reason.
    if (!st.running && st.endedAt && st.why) { run.appendChild(el("p", "rc-note bad", st.why)); }
    if (!st.running && st.endedAt && st.restored) {
      run.appendChild(el("p", "rc-note", "The play history had changed during the check and was put back as it was."));
    }
    // Emulators the check knows but cannot run unwatched, and the change that lets it.
    (res.left || []).forEach(function (x) {
      var p = el("p", "rc-note rc-left");
      p.appendChild(el("b", null, x.emulator));
      p.appendChild(document.createTextNode(" (" + x.games + (x.games === 1 ? " game" : " games") + ") is left out: it " + x.why));
      run.appendChild(p);
    });
    inner.appendChild(run);
    inner.appendChild(resultsView(res));
    $editor.scrollTop = top;

    clearTimeout(timer);
    if (st.running || starting) { timer = setTimeout(refresh, 2000); }
  }

  /* What to check, how, and the buttons that start it: labelled fields on
     the left, the actions on their own row below. */
  function controls(res) {
    var box = el("div", "rc-controls");
    var fields = el("div", "rc-fields");
    function field(label, control) {
      fields.appendChild(el("span", "rc-k", label));
      var v = el("div", "rc-v");
      v.appendChild(control);
      fields.appendChild(v);
      return v;
    }
    var chooser = el("select");
    var all = res.consoles.reduce(function (a, c) { return { games: a.games + c.games, checked: a.checked + c.checked }; }, { games: 0, checked: 0 });
    var opt = function (value, label, c) {
      var o = el("option", null, label + "  (" + c.checked + " of " + c.games + " checked)");
      o.value = value;
      o.selected = want.platform === value;
      chooser.appendChild(o);
    };
    opt("", "Every console", all);
    res.consoles.forEach(function (c) { opt(c.platform, c.platform, c); });
    // The console chosen narrows the results below too, not only what Start runs.
    chooser.addEventListener("change", function () { want.platform = chooser.value; L("RCHK", "console " + (want.platform || "every console")); paint(last); });
    field("Console", chooser);

    var skipL = el("label", "rc-check");
    var skip = el("input");
    skip.type = "checkbox";
    skip.checked = want.skipDone;
    skip.addEventListener("change", function () { want.skipDone = skip.checked; paintGo(); });
    skipL.appendChild(skip);
    skipL.appendChild(document.createTextNode(" Skip games already checked"));
    var waitL = el("label", "rc-check");
    var wait = el("input");
    wait.type = "number"; wait.min = "3"; wait.max = "60"; wait.value = String(want.wait);
    wait.addEventListener("change", function () { want.wait = Math.max(3, Math.min(60, parseInt(wait.value, 10) || 10)); wait.value = String(want.wait); paintGo(); });
    waitL.appendChild(document.createTextNode("Picture after "));
    waitL.appendChild(wait);
    waitL.appendChild(document.createTextNode(" s"));
    var how = el("div", "rc-how");
    how.appendChild(skipL);
    how.appendChild(waitL);
    field("Options", how);
    box.appendChild(fields);

    var acts = el("div", "rc-act");
    box.appendChild(acts);
    /* It has started: the games take the screen and the bar in the corner has
       the count and Stop. Opening this again shows the same check at work. */
    function started() {
      showStrip("the Runs check has started: the bar in the corner shows how far it is, and has Stop", false);
      closeEditor();
    }
    var go = el("button", "primary");
    function paintGo() {
      var c = want.platform ? res.consoles.filter(function (x) { return x.platform === want.platform; })[0] || all : all;
      var n = want.skipDone ? c.games - c.checked : c.games;
      var mins = Math.max(1, Math.round(n * (SECS_EACH + want.wait - 10) / 60));
      go.textContent = n ? "Start: " + n + (n === 1 ? " game" : " games") + ", about " + (mins >= 90 ? Math.round(mins / 6) / 10 + " hours" : mins + " min") : "Nothing left to check";
      go.disabled = !n;
    }
    go.addEventListener("click", function () {
      go.disabled = true;
      go.textContent = "Starting...";
      post({ action: "start", platform: want.platform, skipDone: want.skipDone, wait: want.wait }).then(function (r) {
        if (!r.ok) { showStrip("the runs check did not start: " + (r.error || "no answer"), true); refresh(); return; }
        sound("select");
        started();
      });
    });
    paintGo();
    acts.appendChild(go);

    // The failed ones again, after a fix (a moved BIOS, a changed core):
    // only them, however many are selected as checked.
    var failed = failedOf(res.results).filter(function (r) { return !want.platform || r.platform === want.platform; });
    if (failed.length) {
      var re = el("button", null, "Rerun the " + failed.length + " failed");
      re.addEventListener("click", function () {
        re.disabled = true;
        re.textContent = "Starting...";
        post({ action: "start", only: "failed", platform: want.platform, wait: want.wait }).then(function (r) {
          if (!r.ok) { showStrip("the rerun did not start: " + (r.error || "no answer"), true); refresh(); return; }
          sound("select");
          started();
        });
      });
      acts.appendChild(re);
    }
    return box;
  }

  /* While it runs: the game on screen beside Stop, the bar, and the
     counts so far as small coloured figures. */
  function progress(st) {
    var box = el("div", "rc-progress");
    var line = el("div", "rc-nowline");
    line.appendChild(el("p", "rc-now"));
    var stop = el("button", "danger", "Stop after this game");
    stop.addEventListener("click", function () {
      stop.disabled = true;
      stop.textContent = "Stopping...";
      post({ action: "stop" }).then(function (r) {
        if (!r.ok) { showStrip("the Runs check was not stopped: " + (r.error || "no answer"), true); }
        refresh();
      });
    });
    line.appendChild(stop);
    box.appendChild(line);
    var bar = el("div", "rc-bar");
    bar.appendChild(el("div", "rc-fill"));
    box.appendChild(bar);
    box.appendChild(el("div", "rc-sofar"));
    setProgress(box, st);
    return box;
  }

  // The bar, the game on screen and the counts, written into the box where it is.
  function setProgress(box, st) {
    var total = st.total || 0, at = st.index || 0, c = st.counts || {};
    box.querySelector(".rc-fill").style.width = (total ? Math.round(Math.max(0, at - 1) / total * 100) : 0) + "%";
    var now = box.querySelector(".rc-now");
    now.textContent = "";
    if (at) { now.appendChild(el("span", "rc-at", at + " of " + total)); }
    now.appendChild(document.createTextNode(st.current ? st.current.title + "  ·  " + st.current.platform : "starting..."));
    var sofar = box.querySelector(".rc-sofar");
    sofar.textContent = "";
    [["boots", "boot"], ["look", "to look at"], ["crashed", "crashed"], ["nostart", "did not start"], ["noanswer", "no answer"]].forEach(function (k) {
      var n = c[k[0]] || 0;
      sofar.appendChild(el("span", "rc-stat " + (n ? RESULT[k[0]][1] : "zero"), n + " " + k[1]));
    });
    sofar.appendChild(el("span", "rc-eta", "about " + Math.max(1, Math.round((total - at + 1) * SECS_EACH / 60)) + " min to go"));
  }

  function resultsView(res) {
    var every = res.results || [];
    // The console chosen above, then what happened (the chips): the two together.
    var rows = want.platform ? every.filter(function (r) { return r.platform === want.platform; }) : every;
    var wrap = card("Results", (want.platform || "Every console") + (rows.length ? "  ·  " + rows.length + " checked" : ""));
    wrap.classList.add("rc-results");
    if (!rows.length) {
      wrap.appendChild(el("p", "rc-note", every.length ? "Nothing checked on " + want.platform + " yet." : "Nothing checked yet: press Start above."));
      return wrap;
    }
    var count = {};
    rows.forEach(function (r) { var k = kindOf(r); count[k] = (count[k] || 0) + 1; });
    if (want.filter && !count[want.filter]) { want.filter = ""; }      // nothing of that kind on this console
    var chips = el("div", "rc-chips");
    chips.appendChild(el("span", "rc-chips-label", "Show"));
    [["", "All", rows.length]].concat(Object.keys(RESULT).filter(function (k) { return count[k]; })
      .map(function (k) { return [k, RESULT[k][0], count[k]]; }))
      .forEach(function (c) {
        var b = el("button", "rc-chip" + (c[0] ? " " + RESULT[c[0]][1] : "") + (want.filter === c[0] ? " on" : ""), c[1] + "  " + c[2]);
        b.addEventListener("click", function () { want.filter = c[0]; L("RCHK", "show " + (c[0] || "all")); paint(last); });
        chips.appendChild(b);
      });
    wrap.appendChild(chips);

    var grid = el("div", "rc-grid");
    rows.filter(function (r) { return !want.filter || kindOf(r) === want.filter; }).forEach(function (r) {
      var k = kindOf(r);
      var t = el("div", "rc-tile " + RESULT[k][1]);
      if (r.shot) {
        var img = el("img");
        img.src = r.shot;
        img.alt = "";
        img.loading = "lazy";
        t.appendChild(img);
      } else {
        t.appendChild(el("div", "rc-noshot", "no picture"));
      }
      t.appendChild(el("div", "rc-title", r.title));
      t.appendChild(el("div", "rc-meta", r.platform + (r.emu ? " · " + r.emu : "")));
      t.appendChild(el("div", "rc-result", RESULT[k][0]));
      if (r.reason) { t.appendChild(el("div", "rc-reason", r.reason)); }
      // The check could not tell: the picture is for you, and so is the answer.
      if (k === "look" && !(res.status || {}).running) {
        var said = el("div", "rc-said");
        [["It ran", true], ["It did not", false]].forEach(function (a) {
          var b = el("button", null, a[0]);
          b.type = "button";
          b.addEventListener("click", function (e) {
            e.stopPropagation();
            b.disabled = true;
            L("RCHK", r.title + ": " + a[0].toLowerCase());
            post({ action: "mark", id: r.id, ran: a[1] }).then(function (m) {
              if (!m.ok) { showStrip("could not save that: " + (m.error || "no answer"), true); refresh(); return; }
              sound("select");
              paint(m);
            });
          });
          said.appendChild(b);
        });
        t.appendChild(said);
      }
      if ((r.tags || []).length) { t.appendChild(el("div", "rc-tags", r.tags.join("  ·  "))); }
      t.title = r.title + " (" + r.platform + "): " + RESULT[k][0] + (r.reason ? ", " + r.reason : "") +
        ".  Press for the game's details; right-click to say it runs or needs fix, or to tag it.";
      t.addEventListener("click", function () { jumpTo(r); });
      t.addEventListener("contextmenu", function (e) { e.preventDefault(); resultMenu(r, k, e.clientX, e.clientY, res); });
      grid.appendChild(t);
    });
    wrap.appendChild(grid);

    if (!(res.status || {}).running) {
      // Above the tiles, not under hundreds of them.
      var btns = el("div", "art-btns rc-bulk");
      // The failed ones as games rather than tiles: the list view, filtered
      // to exactly them, where they can be played, edited or deleted. These
      // buttons act on every console, so they count every console.
      var failed = failedOf(every);
      if (failed.length) {
        var see = el("button", null, "See the " + failed.length + " failed in the list");
        see.addEventListener("click", function () {
          L("RCHK", "see the failed in the list");
          closeEditor();
          dropFilters();
          filters.fails = true;
          if (sysStage !== "wall") { $platform.value = ""; }
          setView("list");                 // on the consoles screen this opens every game itself
          if (sysStage !== "wall") { load(); }
        });
        btns.appendChild(see);
      }
      var ok = every.filter(function (r) { return kindOf(r) === "boots"; }).length;
      var tag = el("button", null, "Tag the " + ok + " that boot \"runs\"");
      tag.disabled = !ok;
      tag.title = "A blank screen is left out: look at those first.";
      tag.addEventListener("click", function () {
        post({ action: "tag" }).then(function (r) {
          if (!r.ok) { showStrip("could not tag them: " + (r.error || ""), true); return; }
          showStrip("tagged " + r.tagged + (r.tagged === 1 ? " game" : " games") + " \"runs\"", false);
          paint(r);
        });
      });
      btns.appendChild(tag);
      var clear = el("button", "danger", clearArmed ? "Press again to forget every result" : "Forget the results...");
      clear.addEventListener("click", function () {
        if (!clearArmed) { clearArmed = true; clearAskedAt = Date.now(); clear.textContent = "Press again to forget every result"; return; }
        // A double click is two presses: the second counts only a second after the question.
        if (Date.now() - clearAskedAt < 1000) { L("RCHK", "a second press too soon after the question is no yes: forget every result"); return; }
        clearArmed = false;
        post({ action: "clear" }).then(paint);
      });
      btns.appendChild(clear);
      wrap.insertBefore(btns, grid);
    }
    return wrap;
  }

  /* A result's right-click: your verdict over the check's, its tags, its
     details, or forgetting it so the next check runs it again. While a check
     runs the verdicts wait, greyed: the runner keeps rewriting the results. */
  function resultMenu(r, k, x, y, res) {
    var running = !!(res.status || {}).running;
    var wait = running ? "After the check: it is still writing its results." : null;
    var said = { runs: "marked as running, and tagged runs", needsfix: "marked needs fix", forget: "result forgotten: the next check runs it again" };
    function verdict(as) {
      return running ? null : function () {
        L("RCHK", r.title + ": right-click, " + as);
        showStrip(r.title + ": saving...", false);
        post({ action: "set", id: r.id, as: as }).then(function (m) {
          if (!m.ok) { showStrip("could not save that: " + (m.error || "no answer"), true); return; }
          sound("select");
          showStrip(r.title + ": " + said[as], false);
          paint(m);
        });
      };
    }
    var g = { id: r.id, title: r.title, tags: (r.tags || []).slice() };
    // A check mark only where that is the verdict now, or a blank screen reads as done already.
    popupMenu([
      { icon: "play", label: "It runs", hint: "mark it, tag runs", checked: k === "boots" && !r.needsFix, run: verdict("runs"), tip: wait },
      { icon: "x", label: "Needs fix", hint: "until you take it off", checked: !!r.needsFix, run: verdict("needsfix"), tip: wait },
      { rule: true },
      { icon: "tag", label: g.tags.length ? "Tags (" + g.tags.length + ")..." : "Tags...",
        run: function () { openTagMenu(g, x, y, undefined, function () { refresh(); }); } },
      { icon: "info", label: "Details", run: function () { jumpTo(r); } },
      { rule: true },
      { icon: "refresh", label: "Forget this result", hint: "checked again next time", run: verdict("forget"), tip: wait }
    ], x, y, r.title);
  }

  /* While a check runs, only what changed since the last look (?since), merged
     into the whole answer kept from before; the whole answer again when the
     check ends or the reply is not a change list. */
  var last = null;
  function refresh() {
    var st = (last && last.status) || {};
    if (!last || !last.cursor || !(st.running || st.starting)) { return api("api/runcheck.php").then(paint); }
    return api("api/runcheck.php?since=" + encodeURIComponent(last.cursor)).then(function (d) {
      if (!d || !d.ok || !d.delta) { paint(d); return; }
      if (!(d.status || {}).running && !(d.status || {}).starting) { return api("api/runcheck.php").then(paint); }
      // No new result: only the progress moves, and the hundreds of tiles stay as they are.
      var shown = $editor.querySelector(".rc-progress");
      if (!d.results.length && shown && $editor.dataset.tool === "runcheck") {
        last = Object.assign({}, last, { status: d.status, cursor: Math.max(last.cursor, d.cursor || 0) });
        setProgress(shown, d.status);
        clearTimeout(timer);
        timer = setTimeout(refresh, 2000);
        return;
      }
      var byId = {};
      last.results.forEach(function (r) { byId[r.id] = r; });
      d.results.forEach(function (r) { byId[r.id] = r; });
      var rows = Object.keys(byId).map(function (k) { return byId[k]; });
      rows.sort(function (a, b) {
        return a.platform.localeCompare(b.platform, undefined, { sensitivity: "base" }) ||
               a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      });
      paint(Object.assign({}, last, { status: d.status, results: rows, cursor: Math.max(last.cursor, d.cursor || 0) }));
    });
  }

  $editor.dataset.tool = "runcheck";
  setEditorOnClose(function () {
    clearTimeout(timer);
    delete $editor.dataset.tool;
  });
  refresh().then(function () { sound("select"); });
}
