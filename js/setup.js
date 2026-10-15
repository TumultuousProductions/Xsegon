/*  Getting a new person up and going (includes\setup.php).
 *
 *  Three offers, each behind a window saying what, how big, from where and into
 *  which folder:
 *    Get RetroArch         only while NO RetroArch is found anywhere.
 *    Use the one you have  a RetroArch found that the emulator table does not run yet.
 *    Get missing cores     only consoles whose core is missing, never into a folder Xsegon only reads.
 *  And the first-run guide that puts those in order with the games folder, Scan
 *  for Games and Fill in. The server refuses each when the rules say no, so a
 *  stale page cannot fetch a second RetroArch.
 */

import { confirmWindow } from "./confirm.js";
import { closeEditor, reloadKeeping, setEditorOnClose } from "./editors.js";
import { openFillTool } from "./fill.js";
import { fillWords, setFillListener } from "./fillbar.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { openGamesFolder } from "./nogames.js";
import { openScanTool, pickWindowsFolder } from "./scan.js";
import { jobBarNode, jobBarSet, jobFrac, jobLine, quietDone, setGuidePaint, setRowsPaint, watchSetup, watchUp } from "./setupbar.js";
import { openSetupWindow } from "./setupwin.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor, games, sel } from "./state.js";
import { el, megabytes } from "./util.js";

function post(body) {
  return postJson("api/setup.php", body);
}


/* The asking window is js\confirm.js's, shared with the video fetchers and Settings. */

/* ---------- Get RetroArch ---------- */

export function confirmGet(st, firstRun, after) {
  L("SETUP", "asked: get RetroArch" + (firstRun ? " (first run)" : ""));
  confirmWindow("Get RetroArch?", function (box) {
    box.appendChild(el("p", null,
      "Xsegon plays most consoles through RetroArch, a free emulator from libretro. None was found on this computer."));
    box.appendChild(el("p", "confirm-game", "RetroArch " + st.get.version + ", " + (st.get.carried ? "which came with Xsegon: nothing to download" : megabytes(st.get.bytes) + " download")));
    box.appendChild(el("p", "confirm-note", "From: " + (st.get.carried ? "the copy in Xsegon's own folder, as libretro publishes it at " : "") + st.get.url));
    box.appendChild(el("p", "confirm-note", "Into: " + st.get.dest));
    box.appendChild(el("p", null, "Because this copy is Xsegon's own, it is set up for Xsegon before it first runs:"));
    st.get.sets.forEach(function (s) {
      box.appendChild(el("p", "confirm-note", s.key + " = " + s.value + "   (" + s.why + ")"));
    });
    box.appendChild(el("p", "confirm-safe",
      "Nothing else on your computer is changed. The download is checked against the copy Xsegon was tested with before it is unpacked."));
    box.appendChild(el("p", "confirm-note",
      "Games also need a core per console: Xsegon offers the missing ones once it knows your consoles. BIOS files and games are never downloaded."));
  }, { label: "Download RetroArch", run: function () { markAsked(); startGet(after); } },
     firstRun ? "Not now" : "Cancel",
     function () { if (firstRun) { markAsked(); showStrip("Settings > Emulators can get RetroArch any time", false); } });
}

function markAsked() { post({ asked: true }); }

function startGet(after) {
  L("SETUP", "get RetroArch");
  post({ get: "retroarch" }).then(function (r) {
    if (!r.ok) { showStrip("RetroArch was not fetched: " + (r.error || ""), true); return; }
    showStrip("downloading RetroArch in the background...", false);
    watchSetup(function (st) {
      sound("ok");
      var real = (st.cores || []).some(function (c) { return c.may && !c.popular; });
      if (st.job.kind === "cores") {
        // Set it all up chained the cores on; the job that ended is theirs
        showStrip(jobLine(st.job) + ": your consoles are ready", false);
      } else if (real) {
        // not "set up to use it" over an empty cores folder: that reads as ready to play
        showStrip("RetroArch is ready. Next: cores for your consoles", false);
      } else if ((st.cores || []).length) {
        showStrip("RetroArch is ready. Next: your games folder, then Scan for Games", false);
      } else {
        showStrip("RetroArch is ready: " + ((st.job.filled || []).length) + " consoles set up to use it", false);
      }
      if (after) { after(st); }
      // only consoles that really have games pop by themselves: the guess
      // list for a library with no games stays behind step 4's button
      if (!st.auto && real) { offerCores(st, after); }
    }, after);
  });
}

/* The job watch, quietDone, jobLine, jobFrac and the bar pieces are
   js\setupbar.js's, shared with the corner bar so every place says the same. */

/* ---------- Use the RetroArch you have ---------- */

export function confirmUse(st, after) {
  var ra = st.retroarch;
  confirmWindow("Use the RetroArch you have?", function (box) {
    box.appendChild(el("p", null, "Xsegon found RetroArch here, and is not using it yet:"));
    box.appendChild(el("p", "confirm-game", ra.exe));
    box.appendChild(el("p", null, "Every console with no emulator set up in Xsegon will play through it, each with a usual core."));
    box.appendChild(el("p", "confirm-safe",
      ra.own ? "This is the copy Xsegon fetched." : "Its settings are not changed. Xsegon only writes down where it is."));
  }, { label: "Use it", run: function () {
    post({ use: true }).then(function (r) {
      if (!r.ok) { showStrip("not used: " + (r.error || ""), true); return; }
      L("SETUP", "use " + r.exe);
      sound("ok");
      showStrip("RetroArch at " + r.exe + " now plays " + r.filled.length + " more consoles", false);
      api("api/setup.php").then(function (s2) {
        if (after) { after(s2); }
        // under Set it all up the server chained the cores already: follow
        // that instead of offering a window over a fetch at work.
        var real = (s2.cores || []).some(function (c) { return c.may && !c.popular; });
        if (!s2.auto && real) { offerCores(s2, after); }
        else if (s2.job && s2.job.state === "running" && !watchUp()) { watchSetup(quietDone); }
      });
    });
  } });
}

/* ---------- missing cores ---------- */

export function offerCores(st, after) {
  if (st.job && st.job.state === "running") { return false; }   // a chain is already fetching them
  var rows = (st.cores || []).filter(function (c) { return c.may; });
  if (!rows.length) { return false; }
  confirmCores(st, after);
  return true;
}

export function confirmCores(st, after) {
  var all = st.cores || [];
  var may = all.filter(function (c) { return c.may; });
  var dir = may.length ? may[0].dir : null;
  var here = may.filter(function (c) { return c.dir === dir; });
  var lb = all.filter(function (c) { return !c.may; });
  var ticks = [];
  var w = confirmWindow(here.length ? "Get the missing cores?" : "Missing cores", function (box) {
    if (here.length) {
      box.appendChild(el("p", null, here[0].popular
        ? "No games yet, so these are the usual consoles. Deselect any you will not play."
        : "These consoles have games but their RetroArch core is missing, so they cannot play yet:"));
      var list = el("div", "confirm-list");
      here.forEach(function (c) {
        var lab = el("label", "confirm-pick");
        var box1 = el("input");
        box1.type = "checkbox";
        box1.checked = true;
        box1.value = c.platform;
        ticks.push(box1);
        lab.appendChild(box1);
        lab.appendChild(document.createTextNode(" " + c.platform + (c.games ? "  (" + c.games + (c.games === 1 ? " game" : " games") + ")" : "") + "   " + c.core));
        list.appendChild(lab);
      });
      box.appendChild(list);
      box.appendChild(el("p", "confirm-note", "From: buildbot.libretro.com, the same place RetroArch's own Online Updater uses. About 1 to 30 MB each."));
      box.appendChild(el("p", "confirm-note", "Into: " + dir));
      box.appendChild(el("p", "confirm-safe", "Only the core files are added. No setting is changed."));
    }
    if (lb.length) {
      box.appendChild(el("p", null, (here.length ? "Also: " : "") + lb.length + (lb.length === 1 ? " console" : " consoles") +
        " use the imported library's RetroArch, which Xsegon never changes. Its Online Updater > Core Downloader can fetch " +
        lb.map(function (c) { return c.core; }).join(", ") + "."));
    }
  }, here.length ? { label: "Download", run: function () {
    var picked = ticks.filter(function (t) { return t.checked; }).map(function (t) { return t.value; });
    if (!picked.length) { return; }
    L("SETUP", "get cores " + picked.join(", "));
    // Consoles are picked, cores are fetched: Game Boy and Game Boy Color share one, so the count is of cores.
    var cores = here.filter(function (c) { return picked.indexOf(c.platform) >= 0; }).map(function (c) { return c.core; });
    var n = cores.filter(function (c, i) { return cores.indexOf(c) === i; }).length;
    post({ cores: picked }).then(function (r) {
      if (!r.ok) { showStrip("the cores were not fetched: " + (r.error || ""), true); return; }
      showStrip("fetching " + n + (n === 1 ? " core" : " cores") + " in the background...", false);
      watchSetup(function (s2) { sound("ok"); showStrip(jobLine(s2.job), false); if (after) { after(s2); } }, after);
    });
  } } : null, here.length ? "Not now" : "OK",
  // a declined offer leaves a line in the log
  here.length ? function () { L("SETUP", "cores offer declined"); } : null);
  if (w.yes) {
    ticks.forEach(function (t) {
      t.addEventListener("change", function () { w.yes.disabled = !ticks.some(function (x) { return x.checked; }); });
    });
  }
}

/* Set it all up lives in js\setupwin.js (the window) and js\autosetup.js (what its press starts). */

/* ---------- where these live ---------- */

/* Once, at startup, for someone new: no RetroArch in use, or no games yet.
   The first time only: the setup window while Set it all up is on
   offer (js\setupwin.js), the guide otherwise; Help > Getting started
   opens the guide any time after. Everyone who is already set up hears nothing. */
export function firstRunSetup() {
  return api("api/setup.php").then(function (st) {
    if (!st || !st.ok) { return; }
    if (st.job && st.job.state === "running") { watchSetup(quietDone); return; }
    var fresh = !(st.retroarch.have && st.retroarch.inTable) || st.guide.games === 0;
    if (fresh && !st.guide.shown) {
      post({ asked: "guide" });
      if (!st.auto && (st.canGet || st.canUse)) { openSetupWindow(st, openGuide); } else { openGuide(); }
    }
  });
}

/* ---------- the first-run guide ---------- */

/*  Five steps from nothing to playing, each a row that says whether it is done
    and, if not, one button that does it with the tool that already exists.
    Nothing is done by opening this; every step is a press. */

/*  A step was pressed since the library was last read. Scan for Games and Fill
    in re-read it when CLOSED, but from here they leave with Back, which closes
    nothing, so the guide re-reads it itself when it closes. Kept out here
    because Back opens the guide afresh. */
var guideDid = false;

// A Fill in pass ended with the guide up: its last step is drawn again.
setFillListener(function () {
  if (!$editor.hidden && $editor.querySelector(".gd")) { guideDid = true; openGuide(); }
});

export function openGuide() {
  L("SETUP", "guide opened");
  stopVideo();
  setEditorOnClose(function () {
    if (!guideDid) { return; }
    guideDid = false;
    reloadKeeping(games[sel] ? games[sel].id : null);
  });
  var inner = el("div", "panel-inner ed-inner gd");
  var head = el("div", "set-head");
  head.appendChild(el("h1", "panel-title", "GETTING STARTED"));
  var done = el("button", "primary", "Done (esc)");
  done.addEventListener("click", closeEditor);
  head.appendChild(done);
  inner.appendChild(head);
  inner.appendChild(el("p", "group-help",
    "Five steps from nothing to playing. What is already done is checked off. Help > Getting started opens this again."));
  var list = el("div", "gd-steps");
  inner.appendChild(list);
  var foot = el("p", "mt-note gd-foot");
  inner.appendChild(foot);
  $editor.textContent = "";
  // The guide says whose the panel is now: the fill tool redraws itself only
  // while the mark is its own (fill.js mine()), or a look ending after Back replaces the guide.
  $editor.dataset.tool = "guide";
  $editor.appendChild(inner);
  $editor.hidden = false;

  // stack: the buttons one over the other, for a step whose words need the
  // room two buttons side by side would take (step 2 names a whole path).
  function step(n, title, state, text, buttons, stack) {
    var r = el("div", "gd-step " + state + (stack ? " gd-stack" : ""));
    r.appendChild(el("span", "gd-mark", state === "done" ? "✓" : String(n)));
    var body = el("div", "gd-body");
    body.appendChild(el("h3", "gd-title", title));
    body.appendChild(el("p", "gd-text", text));
    r.appendChild(body);
    var bar = el("div", "gd-bar");
    (buttons || []).forEach(function (b) {
      var btn = el("button", b.primary ? "primary" : null, b.label);
      btn.disabled = !!b.disabled;
      btn.addEventListener("click", function () { guideDid = true; b.run(); });
      bar.appendChild(btn);
    });
    r.appendChild(bar);
    list.appendChild(r);
  }

  function paint(st) {
    if (!inner.isConnected || !st || !st.ok) { return; }
    list.textContent = "";
    var ra = st.retroarch, g = st.guide, running = st.job && st.job.state === "running";
    var raOk = ra.have && ra.inTable;

    // A fetch something else started (the server's own chain, a reload, a
    // guide opened over a running download): follow it, so the steps below
    // keep counting and the end is said. guidePaint keeps THIS guide drawn.
    if (running && !watchUp()) { watchSetup(quietDone); }

    // Set it all up: the rest of this page without the pressing, shown while
    // RetroArch is the next thing to do; once it is in, the offer is only noise.
    if (!st.auto && !running && (st.canGet || st.canUse)) {
      // What it downloads is said here; the press opens the setup window (js\setupwin.js).
      var lead = el("div", "gd-lead");
      var words = el("div", "gd-lead-words");
      words.appendChild(el("p", "gd-text",
        "Xsegon can set all of this up for you. One window shows the folder your games are in and what it will set up, and one press does the rest: RetroArch, the cores your consoles need, and your games' names and pictures."));
      words.appendChild(el("p", "gd-lead-note", (st.canGet
        ? (st.get.carried ? "It sets up RetroArch " + st.get.version + ", which came with Xsegon, in " + st.get.dest + ", and downloads the cores"
                          : "It downloads RetroArch " + st.get.version + " (" + megabytes(st.get.bytes) + ") from " + st.get.url + " into " + st.get.dest + ", and the cores")
        : "It uses the RetroArch found at " + st.retroarch.exe + " and downloads the cores") +
        ", 1 to 30 MB each, from buildbot.libretro.com. Downloads are checked against the copies Xsegon was tested with. BIOS files and games are never downloaded."));
      lead.appendChild(words);
      var go = el("button", "primary", "Set it all up");
      go.addEventListener("click", function () { guideDid = true; openSetupWindow(st, openGuide, go); });
      lead.appendChild(go);
      list.appendChild(lead);
    } else if (st.auto) {
      var on = el("p", "gd-lead-on");
      on.appendChild(document.createTextNode("Setting up by itself: the cores and pictures your games need come in the background as they are scanned in.  "));
      var off = el("button", null, "Turn that off");
      off.addEventListener("click", function () {
        L("SETUP", "set it all up turned off");
        post({ auto: false }).then(function (r) {
          if (!r || !r.ok) { showStrip("setting up by itself was not turned off: " + ((r && r.error) || "no answer"), true); }
          return read();
        });
      });
      on.appendChild(off);
      list.appendChild(on);
    }

    // 1. RetroArch
    if (raOk) {
      step(1, "RetroArch", "done", "Ready: " + ra.exe);
    } else if (running && st.job.kind === "retroarch") {
      step(1, "RetroArch", "todo", jobLine(st.job));
      var body1 = list.lastChild.querySelector(".gd-body");
      // a real bar, not a number alone
      body1.appendChild(jobBarNode(jobFrac(st.job)));
      // The steps below do not need it: said, so nobody sits out a long download.
      body1.appendChild(el("p", "gd-text gd-go-on", "No need to wait for it to finish: go on to the next step."));
    } else if (st.canUse) {
      step(1, "RetroArch", "todo", "Found at " + ra.exe + ", and Xsegon is not using it yet.",
        [{ label: "Use it...", primary: true, run: function () { confirmUse(st, paint); } }]);
    } else {
      // a download that stopped says so right here, not only in a strip
      // message that may be long gone
      var fell = st.job && st.job.state === "failed" && st.job.kind === "retroarch"
        ? "The download stopped: " + (st.job.error || "") + ". " : "";
      step(1, "RetroArch", "todo",
        fell + "Xsegon plays most consoles through RetroArch, and none was found. " + (st.get.carried
          ? "RetroArch " + st.get.version + " came with Xsegon: it is unpacked and set up for it, with nothing to download."
          : "Xsegon can fetch RetroArch " + st.get.version + " (" + megabytes(st.get.bytes) + ") from libretro, set up for it."),
        [{ label: "Get RetroArch...", primary: true, disabled: !st.canGet, run: function () { confirmGet(st, false, paint); } }]);
    }

    // 2. Where the games are
    var there = g.folders.filter(function (f) { return f.there; });
    /* A new copy starts with a Games folder Xsegon made (includes\scan.php).
       While it is the only folder and holds no games the step stays open and
       says where it is: checked off, it would read as "nothing to do here". */
    var own = there.filter(function (f) { return f.made; })[0];
    if (own && there.length === 1 && !g.games) {
      step(2, "Your games folder", "todo",
        "Xsegon made you a games folder, " + own.path + ", with a folder in it for each console. " +
        "Put your games in it, or choose the folder they are already in.",
        [{ label: "Open the folder", primary: true, run: openGamesFolder },
         { label: "Choose another folder...", run: pickFolder }], true);
    } else {
      step(2, "Your games folder", there.length ? "done" : "todo",
        there.length ? "Looking in " + there.map(function (f) { return f.path; }).join(", ")
                     : "Show Xsegon the folder your games are in. Folders inside it named after a console are recognised, by its full name or a short one (Nintendo 64 or n64, Super Nintendo or snes, PlayStation or psx...). One console's own folder works too.",
        [{ label: there.length ? "Add another folder..." : "Choose a folder...", primary: !there.length, run: pickFolder }]
          .concat(own ? [{ label: "Open the Games folder", run: openGamesFolder }] : []), !!own);
    }

    // 3. Finding them
    step(3, "Find your games", g.games ? "done" : "todo",
      // "found in your games folders", not "in your library": the count leaves out
      // your own games (Steam, programs, web games), which are not on the disk to find.
      g.games ? g.games + (g.games === 1 ? " game" : " games") + " found in your games folders. Scan again any time you add more."
              : "Look through your folders for games and choose which to add.",
      [{ label: "Scan for games...", primary: !g.games && there.length > 0, disabled: !there.length, run: function () { openScanTool(openGuide); } }]);

    // 4. Cores
    var may = st.cores.filter(function (c) { return c.may; });
    if (!raOk) {
      step(4, "Cores for your consoles", "todo", st.auto
        ? "After RetroArch: the cores come by themselves."
        : "After RetroArch: each console needs a core, a small file RetroArch plays it with.");
    } else if (running && st.job.kind === "cores") {
      step(4, "Cores for your consoles", "todo", jobLine(st.job));
      list.lastChild.querySelector(".gd-body").appendChild(jobBarNode(jobFrac(st.job)));
    } else if (!st.cores.length) {
      step(4, "Cores for your consoles", "done", g.games ? "Every console with games has its core." : "Nothing missing yet.");
    } else if (may.length) {
      step(4, "Cores for your consoles", "todo",
        (st.job && st.job.state === "failed" && st.job.kind === "cores" ? "The fetch stopped: " + (st.job.error || "") + ". " : "") +
        may.length + (may.length === 1 ? " console is" : " consoles are") + " missing a core" +
        (may[0].popular ? " (no games yet, so the usual ones are offered)." : ", so those games cannot play yet."),
        [{ label: "Get cores...", primary: true, run: function () { confirmCores(st, paint); } }]);
    } else {
      step(4, "Cores for your consoles", "todo",
        st.cores.length + " missing in the imported library's RetroArch, which Xsegon never changes: its Online Updater > Core Downloader can fetch them.",
        [{ label: "Which?", run: function () { confirmCores(st, paint); } }]);
    }

    // 5. Names and pictures: the Games Database Xsegon carries, or
    // libretro's lists without it (api\fill.php).
    /* Its button is lit once the four before it are done, and the foot never
       says all set while this is open, or people go on to a library with no box art. */
    /* Get Pictures goes through every game it is sure of; Get Specific Pictures
       shows the list first. What a finished pass could not match (g.left) is a
       person's to decide and does not keep the step open. */
    var all = raOk && there.length && g.games && !st.cores.length;
    var left = g.left || 0, todo = g.bare - left;
    var custom = { label: "Get Specific Pictures...", run: function () { openFillTool(openGuide); } };
    /* A pass at work in the background: no buttons. The guide is drawn again
       when it ends (setFillListener). */
    if (g.filling) {
      /* The bar is ON the step: the corner bar steps aside while this window
         is open (js\fillbar.js), and takes over outside it. */
      step(5, "Names and pictures", "todo",
        "Getting them now, in the background. Names and box art come first, the other pictures after. You can press Done and carry on: it finishes by itself.", []);
      var body5 = list.lastChild.querySelector(".gd-body");
      body5.appendChild(el("p", "gd-text gd-fill-line", "looking up your games..."));
      body5.appendChild(jobBarNode(null, "gd-fill-prog"));
      followFill();
    } else
    step(5, "Names and pictures", todo ? "todo" : "done",
      todo ? todo + (todo === 1 ? " scanned game has" : " scanned games have") + " only a file name for a title, and no box art. Get Pictures looks them up and fetches names, years and box art for every game it is sure of. Get Specific Pictures shows you the list first."
           : left ? "Looked up. " + left + (left === 1 ? " game had no sure match and was" : " games had no sure match and were") + " left as " + (left === 1 ? "it is" : "they are") + ": Get Specific Pictures lets you choose for " + (left === 1 ? "it" : "them") + "."
           : (g.scanned ? "Every scanned game has been looked up." : "Nothing to fill in."),
      todo ? [{ label: "Get Pictures", primary: !!all, run: function () { openFillTool(openGuide, true); } }, custom]
           : left ? [custom] : []);

    foot.textContent = !all ? ""
      : g.filling ? "Names and pictures are on their way. Press Done to see your games: they fill in as it goes."
      : todo ? "One step left: Names and pictures. Your games play without it, but they show no box art until it is done."
             : "You are all set. Press Done to see your games.";
    var next = list.querySelector(".gd-step.todo button:not([disabled])") || done;
    if (!inner.contains(document.activeElement) || document.activeElement === document.body) { next.focus(); }
  }

  function read() { api("api/setup.php").then(paint); }
  // the newest guide owns repainting; a closed one's paint no-ops on
  // isConnected, so there is nothing to take back
  setGuidePaint(paint);

  /* Step 5's own live line and bar while Get Pictures runs, since nothing else
     repaints this panel during a pass. One read every 1.5s into the two nodes
     in place, ending itself with the pass or with this guide. */
  var fillT = null;
  function followFill() {
    if (fillT) { return; }
    fillT = setInterval(function () {
      if (!inner.isConnected) { clearInterval(fillT); fillT = null; return; }
      api("api/fill.php?job=1").then(function (r) {
        var j = r && r.ok ? r.job : null;
        if (!j || j.state !== "running" || j.mode === "look") {
          clearInterval(fillT); fillT = null;
          return;
        }
        var lineN = inner.querySelector(".gd-fill-line");
        var barN = inner.querySelector(".gd-fill-prog");
        if (!lineN || !barN) { return; }
        var w = fillWords(j);
        lineN.textContent = w[0];
        jobBarSet(barN, Math.max(0, Math.min(1, w[1])));
      });
    }, 1500);
  }

  function pickFolder() {
    L("SETUP", "choose a games folder");
    // The window, the wait and its failure lines are js\scan.js's: null means
    // the strip has already said what went wrong.
    pickWindowsFolder("Choose the folder your games are in").then(function (path) {
      if (!path) { return; }
      postJson("api/scan.php", { action: "addFolder", path: path }).then(function (res) {
        if (!res.ok) { showStrip(res.error || "that folder could not be added", true); read(); return; }
        L("SETUP", "games folder " + path);
        sound("select");
        showStrip("Xsegon will look for games in " + path, false);
        read();
      });
    });
  }

  read();
}

/* The top of Settings > Emulators: a row per offer that applies, and a line
   of progress while a fetch runs. Draws nothing when nothing applies. */
export function setupRows(page, actionRow, repaint) {
  var box = el("div", "setup-rows");
  page.insertBefore(box, page.firstChild);
  function paint(st) {
    if (!box.isConnected) { return; }    // the page was closed or rebuilt
    box.textContent = "";
    if (!st || !st.ok) { return; }
    if (st.job && (st.job.state === "running" || st.job.state === "failed")) {
      box.appendChild(el("p", "mt-note setup-prog" + (st.job.state === "failed" ? " bad" : ""), jobLine(st.job)));
      if (st.job.state === "running") { box.appendChild(jobBarNode(jobFrac(st.job))); }
    }
    var again = function (s2) { paint(s2); if (s2.job && s2.job.state !== "running" && repaint) { repaint(); } };
    if (st.canGet) {
      box.appendChild(actionRow("Get RetroArch",
        "No RetroArch was found on this computer. " + (st.get.carried ? "RetroArch " + st.get.version + " came with Xsegon, and is unpacked into its own folder, set up for it."
          : "Xsegon can fetch RetroArch " + st.get.version + " (" + megabytes(st.get.bytes) + ") into its own folder, set up for it."),
        "Get it...", function () { confirmGet(st, false, again); }));
    }
    if (st.canUse) {
      box.appendChild(actionRow("Use the RetroArch you have",
        "Found at " + st.retroarch.exe + ", and not used by Xsegon yet.",
        "Use it...", function () { confirmUse(st, again); }));
    }
    if ((st.cores || []).length && !(st.job && st.job.state === "running")) {
      var may = st.cores.filter(function (c) { return c.may; }).length;
      box.appendChild(actionRow("Missing cores",
        (st.cores[0].popular ? "RetroArch has no cores yet, so no console can play. The usual ones are offered"
          : st.cores.length + (st.cores.length === 1 ? " console has" : " consoles have") + " games but no RetroArch core to play them") +
        (may ? "." : ". They use the imported library's RetroArch, whose Online Updater can fetch them."),
        may ? "Get them..." : "Which?", function () { confirmCores(st, again); }));
    }
  }
  // the newest Emulators page owns its repainting, like the guide: a watch
  // already running (started elsewhere) keeps this page counting too
  setRowsPaint(paint);
  api("api/setup.php").then(function (st) {
    paint(st);
    // a fetch already under way (the chain, or started before this page
    // opened): follow it, so the progress line moves and the end is said
    if (st && st.ok && st.job && st.job.state === "running" && !watchUp()) { watchSetup(quietDone, paint); }
  });
}
