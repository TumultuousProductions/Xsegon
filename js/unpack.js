/*  Unpack and add (includes\unpack.php): a disc game still in its .zip or
    .7z, on Scan for Games' list of archives. A line looks into its archive
    when asked, says which console's game it is and whether it stands in that
    console's folder, and starts the unpacking; one poll then carries every
    line's bar, and goes on after the window is closed. */

import { reloadKeeping } from "./editors.js";
import { jobSayOnce, jobsWatch } from "./jobbars.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { sound } from "./sound.js";
import { games, sel } from "./state.js";
import { el } from "./util.js";

var lines = {};          // archive, lower case => its line on screen
var timer = null;        // the poll, while anything is at work
var told = {};           // results already said, so a poll says each once
var tally = null;        // { ok, bad, added } for the run in hand
var whenAdded = null;    // the scan window's own "something was added"
var checkFirst = true;   // ask Windows Defender before unpacking: the box above the list, remembered
try { checkFirst = localStorage.getItem("xs-unpack-check") !== "0"; } catch (e) { /* no storage: it stays on */ }
var allTime = null;      // Unpack all's words about that check, filled once the server says Defender is here
var defenderHere = false;

function gb(n) { return (n / 1073741824).toFixed(n >= 10737418240 ? 0 : 1) + " GB"; }
function mins(s) { return s < 90 ? "a minute" : Math.round(s / 60) + " minutes"; }
function clock(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
function base(p) { return p.split(/[\\\/]/).pop(); }
function folderOf(p) { return p.replace(/[\\\/][^\\\/]*$/, ""); }
function post(body) {
  return postJson("api/unpack.php", body);
}

function button(label, cls, press) {
  var b = el("button", cls, label);
  b.type = "button";
  b.addEventListener("click", press);
  return b;
}

function newTally() { return { ok: 0, bad: 0, kept: 0, added: 0, why: "" }; }

/* How a run ended, for the strip: what was unpacked first, then what was left
   packed on purpose and what failed. With nothing unpacked it says so in
   words, and gives the reason itself when one archive is all there was. */
function runSays(t) {
  var rest = (t.kept ? ", " + t.kept + " left packed" : "") + (t.bad ? ", " + t.bad + " not" : "") + (t.kept || t.bad ? " (Scan for Games says why)" : "");
  if (t.ok) { return t.ok + (t.ok === 1 ? " archive" : " archives") + " unpacked, " + t.added + (t.added === 1 ? " game" : " games") + " added" + rest; }
  if (t.kept + t.bad === 1) { return "nothing was unpacked: " + t.why; }
  var parts = [t.kept ? t.kept + " left packed" : "", t.bad ? t.bad + " could not be unpacked" : ""].filter(Boolean);
  return "nothing was unpacked" + (parts.length ? ": " + parts.join(" and ") + " (Scan for Games says why)" : "");
}

/* What one finished archive says on its line. */
function ended(r) {
  if (!r.ok) { return r.stopped ? "Stopped. What it had written was taken away." : (r.kept ? "Left packed: " : "Not unpacked: ") + r.why + "."; }
  return "Unpacked to " + r.dest + (r.added && r.added.length ? " and added: " + r.added.join(", ") + "." : ". " + r.note + ".") +
    (r.checked === "clean" ? " Windows Defender found no threats in it." : r.checked === "unknown" ? " Windows Defender would not say whether it is clean." : " It was not checked by Windows Defender.") +
    " The archive is still there: delete it yourself if you want its space back.";
}

/* What is said beside where it unpacks: what stays behind, and the check that comes first. */
function cautions(found, plan) {
  var runs = (found.odd && found.odd.runs) || [], left = (found.left || []).map(base), out = "";
  if (left.length) { out += " Only the disc is unpacked. Left in the archive: " + left.slice(0, 4).join(", ") + (left.length > 4 ? " and " + (left.length - 4) + " more" : "") + "."; }
  if (runs.length && found.shape === "image") {
    out += " Among them " + (runs.length === 1 ? "is a Windows program (" + base(runs[0]) + ")" : "are Windows programs (" + runs.slice(0, 3).map(base).join(", ") + ")") +
      ": a disc game has no use for one, and it is never unpacked.";
  }
  return out + (!plan.defender ? " Windows Defender is not here to check it first."
    : checkFirst ? " Windows Defender checks it first, about " + mins(plan.defenderSeconds) + "." : " The Windows Defender check is turned off.");
}

function bar(line, share) {
  line.bar.hidden = share === null;
  line.bar.classList.toggle("wait", share === true);
  line.fill.style.width = share === true || share === null ? "" : Math.round(100 * share) + "%";
}

function say(line, text, cls) {
  line.says.textContent = text;
  line.says.className = "up-says" + (cls ? " " + cls : "");
  line.says.hidden = !text;
}

function choices(line, list) {
  line.acts.textContent = "";
  list.forEach(function (b) { line.acts.appendChild(b); });
  line.acts.hidden = !list.length;
}

function start(line, elsewhere) {
  choices(line, []);
  line.go.hidden = true;
  say(line, "Asking for it...");
  post({ action: "start", archive: line.archive, move: !!elsewhere, scan: checkFirst }).then(function (r) {
    if (!r.ok) { sound("back"); say(line, "Not started: " + (r.error || "no answer") + ".", "bad"); line.go.hidden = false; return; }
    L("UNPK", "asked for " + base(line.archive) + (elsewhere ? ", moved first" : ""));
    sound("select");
    tally = tally || newTally();
    paint(r);
    watch();
  });
}

/* The archive looked into, and what its line then offers. */
function looked(line, res) {
  var look = res.look, plan = res.plan, where = "It unpacks to " + plan.dest + " (" + gb(plan.need) +
    (plan.free !== null ? ", " + gb(plan.free) + " free" : "") + ")." + cautions(look, plan);
  var whose = look.console ? look.console + " game" + (look.how ? " (" + look.how + ")" : "") : "";
  line.go.hidden = true;
  bar(line, null);
  var leave = button("Leave it", null, function () { choices(line, []); say(line, ""); line.go.hidden = false; });
  var here = function (label) { return button(label, "primary", function () { start(line, false); }); };

  if (plan.verdict === "nogame") {
    say(line, "No disc and no game folder in it (" + look.entries + (look.entries === 1 ? " file" : " files") + "), so there is nothing to unpack.");
    return;
  }
  if (plan.verdict === "unsafe") {
    say(line, "Xsegon will not unpack this one: " + plan.unsafe + ". If you did not expect that, delete the archive.", "bad");
    return;
  }
  if (plan.verdict === "done") {
    say(line, "Already unpacked: " + plan.already + ". Nothing to do; the archive can be deleted if you want its space back.");
    return;
  }
  if (plan.verdict !== "wrong" && !plan.room) {
    say(line, "A " + whose + ". It needs " + gb(plan.need) + " unpacked and the drive has " + gb(plan.free) + " free.", "bad");
    return;
  }
  if (plan.verdict === "right") {
    say(line, "A " + whose + ", in its own console's folder. " + where);
    choices(line, [here("Unpack and add"), leave]);
    return;
  }
  if (plan.verdict === "unsure") {
    say(line, (look.console ? "This is a " + whose + ", and its folder does not say a console. "
      : "The disc does not say which console it is for, so the folder's word is taken" + (plan.here ? " (" + plan.here + "). " : ". ")) + where);
    choices(line, [here("Unpack and add"), leave]);
    return;
  }
  // In another console's folder.
  var mv = plan.move, wrong = "This is a " + whose + ", and it is in the " + plan.here + " folder";
  if (mv.twin === "same") {
    say(line, wrong + ". The same archive (same name, same size) is already in " + mv.dir +
      ", so this one is a spare copy. Xsegon never deletes a game file: delete it yourself if you want its " + gb(look.bytes) + " back.", "warn");
    choices(line, [leave]);
    return;
  }
  if (mv.twin === "other") {
    say(line, wrong + ". Another file of the same name is already in " + mv.dir + ", so it cannot be moved there.", "warn");
    choices(line, [button("Unpack it here anyway", null, function () { start(line, false); }), leave]);
    return;
  }
  say(line, wrong + ". Its own folder is " + mv.dir + (mv.there ? "" : " (not made yet)") + "." + cautions(look, plan), "warn");
  choices(line, [button("Move it to " + base(mv.dir) + " and unpack there", "primary", function () { start(line, true); }),
                 button("Unpack it here anyway", null, function () { start(line, false); }), leave]);
}

function look(line) {
  line.go.hidden = true;
  say(line, "Looking inside: the list of its files, and the start of its disc...");
  bar(line, true);
  api("api/unpack.php?look=" + encodeURIComponent(line.archive)).then(function (res) {
    bar(line, null);
    if (!res.ok) { sound("back"); say(line, (res.error || "could not look into it") + ".", "bad"); line.go.hidden = false; return; }
    L("UNPK", "looked into " + base(line.archive) + ": " + (res.look.console || "no console said") + ", " + res.plan.verdict);
    looked(line, res);
  });
}

/* Every line brought up to how the unpacking stands. */
function paint(st) {
  var now = st.now, waiting = st.waiting || [];
  Object.keys(lines).forEach(function (k) {
    var line = lines[k], at = waiting.map(function (w) { return w.toLowerCase(); }).indexOf(k);
    line.stop.hidden = true;
    if (now && now.archive.toLowerCase() === k) {
      line.go.hidden = true;
      choices(line, []);
      line.stop.hidden = false;
      if (now.phase === "unpacking" && now.total) {
        say(line, "Unpacking: " + gb(now.bytes || 0) + " of " + gb(now.total) + ".");
        bar(line, Math.min(1, (now.bytes || 0) / now.total));
      } else if (now.phase === "checking") {
        // Defender says nothing until it is done: the bar goes by the clock, and past the guess it only shows it is at work.
        var gone = (st.time || 0) - (now.since || 0), late = gone > (now.about || 0);
        say(line, late ? "Windows Defender is still checking it: " + clock(gone) + " so far, longer than the usual " + mins(now.about || 0) +
            ". It gives no count of its own, so the bar only shows it is at work. Nothing is unpacked until it answers."
          : "Windows Defender is checking it before anything is unpacked: " + clock(gone) + " of about " + mins(now.about || 0) + ". It only looks; nothing is removed.");
        bar(line, late ? true : gone / Math.max(1, now.about || 1));
      } else {
        say(line, now.phase === "moving" ? "Moving it to its own console's folder..." : now.phase === "adding" ? "Adding it to the library..."
          : now.phase === "looking" ? "Reading the start of its disc, to see which console it is for..." : "Starting...");
        bar(line, true);
      }
    } else if (at >= 0) {
      line.go.hidden = true;
      choices(line, []);
      say(line, "Waiting its turn" + (at > 0 ? " (" + at + " ahead)" : "") + ".");
      bar(line, null);
    }
  });
  var atWork = waiting.concat(now ? [now.archive] : []).map(function (w) { return w.toLowerCase(); });
  (st.results || []).forEach(function (r) {
    var k = r.archive.toLowerCase(), id = k + "|" + r.at, line = lines[k];
    // An archive asked for again shows where it stands now, not how it ended last time.
    // And an ending is put on its line once: the next poll must not take a failed line back out of the hands pressing it again.
    if (line && atWork.indexOf(k) < 0 && !(line.said || {})[id] && !(line.done && !tally)) {
      (line.said = line.said || {})[id] = true;
      say(line, ended(r), r.ok ? "good" : r.kept ? "warn" : "bad");
      bar(line, null);
      choices(line, []);
      line.go.hidden = r.ok;
    }
    if (told[id]) { return; }
    told[id] = true;
    if (!tally) { return; }                          // an older run's: shown, not announced
    if (r.ok) { tally.ok++; tally.added += (r.added || []).length; } else {
      // Left packed on purpose is no failure: counted apart, and never said in red.
      if (r.kept) { tally.kept++; } else { tally.bad++; }
      tally.why = r.stopped ? "it was stopped, and what it had written was taken away" : r.why;
    }
    if (r.ok && (r.added || []).length) {
      // With the scan window up, its own closing reloads the library; without it, now.
      if (whenAdded && onScreen()) { whenAdded(); } else { reloadKeeping(games[sel] ? games[sel].id : null); }
    }
  });
}

function onScreen() {
  return Object.keys(lines).some(function (k) { return lines[k].says.isConnected; });
}

function watch() {
  if (timer) { return; }
  timer = setInterval(function () {
    api("api/unpack.php").then(function (st) {
      if (!st.ok) { return; }
      paint(st);
      if (st.running || (st.waiting || []).length) { return; }
      clearInterval(timer);
      timer = null;
      var t = tally;
      tally = null;
      if (!t) { return; }
      L("UNPK", "run over: " + t.ok + " unpacked, " + t.added + " added, " + t.kept + " left packed, " + t.bad + " not");
      if (!jobSayOnce("unpack", st.started || 0)) { return; }       // once, whoever sees the end first (js/jobbars.js)
      sound(t.bad && !t.ok ? "back" : "ok");
      showStrip(st.state === "failed" && st.error ? st.error : runSays(t), !!t.bad || st.state === "failed");
    });
  }, 1000);
}

function timeSays() {
  return !defenderHere ? "" : checkFirst ? " Windows Defender looks at each one first, about four minutes for a 7 GB disc."
    : " The Windows Defender check is turned off, further down.";
}

/* Over the scan's offer: how many disc games are still packed, what they take
   and the room free, and one button for all of them. lead: nothing else is
   offered, so the button is the window's own. started() is called once they
   are asked for, and says whether the window closed. */
export function unpackAll(inner, listed, room, lead, started) {
  allTime = null;
  // A spare copy of an archive unpacked elsewhere is no game waiting: it keeps its line further down.
  var archives = listed.filter(function (a) { return !a.spare; });
  if (!archives.length) { return; }
  var n = archives.length, one = n === 1, drives = (room && room.drives) || [];
  var free = drives.filter(function (d) { return d.free !== null; }).map(function (d) { return d.drive + " has " + gb(d.free) + " free"; }).join(", ");
  var tight = drives.filter(function (d) { return d.free !== null && d.free < d.bytes + 1073741824; }).map(function (d) { return d.drive; });
  var box = el("div", "up-all");
  box.appendChild(el("p", "up-all-head", (one ? "1 disc game is" : n + " disc games are") + " still in a .zip or .7z, so no emulator can play " + (one ? "it" : "them") + " yet."));
  box.appendChild(el("p", "mt-note", "Packed " + (one ? "it takes " : "they take ") + gb((room && room.bytes) || 0) + ", and unpacked " +
    (one ? "it needs" : "they need") + " at least that much again." + (free ? " " + free + "." : "")));
  if (tight.length) {
    box.appendChild(el("p", "mt-note bad", tight.join(" and ") + (tight.length === 1 ? " does" : " do") + " not have the room for " +
      (one ? "it, so it will stay packed and say so." : "all of them: the ones that fit are unpacked, and each that does not stays packed and says so.")));
  }
  var does = el("p", "mt-note", "One press checks " + (one ? "it" : "each one") + ", unpacks it beside its archive and adds the game" + (one ? "" : ", one after another") +
    ", in the background. " + (one ? "The archive stays where it is." : "The archives stay where they are.") +
    " A game in another console's folder stays packed for you to decide, further down.");
  allTime = el("span", null, timeSays());
  does.appendChild(allTime);
  box.appendChild(does);
  var label = one ? "Unpack it" : "Unpack all " + n;
  var go = button(label, lead ? "primary" : null, function () {
    go.disabled = true;
    go.textContent = "Asking for " + (one ? "it" : "them") + "...";
    post({ action: "startAll", archives: archives.map(function (a) { return a.file; }), scan: checkFirst }).then(function (r) {
      if (!r.ok) {
        sound("back");
        go.disabled = false;
        go.textContent = label;
        showStrip("not started: " + (r.error || "no answer"), true);
        return;
      }
      L("UNPK", "Unpack all: asked for " + r.asked + " of " + n + (checkFirst ? "" : ", without the Windows Defender check"));
      sound("select");
      tally = tally || newTally();
      var not = r.not || [];
      showStrip("unpacking " + r.asked + (r.asked === 1 ? " disc game" : " disc games") + " in the background: the bar in the corner shows how far it is" +
        (not.length ? "  ·  " + not.length + " not started: " + not[0].why : ""), false);
      jobsWatch("unpack");
      watch();
      if (started()) { return; }
      // The window stays for what else it offers: the lines further down carry each one's own bar.
      box.textContent = "";
      box.appendChild(el("p", "mt-note good", "Unpacking in the background: the bar in the corner shows how far it is, and each line further down says how its own went."));
      paint(r);
    });
  });
  var acts = el("div", "bk-acts up-acts");
  acts.appendChild(go);
  box.appendChild(acts);
  inner.appendChild(box);
}

/* The scan window's list of archives: a line each, with its button.
   added() is called when a game joined the library from here. An archive
   whose game stands unpacked already is not on the list: left counts those. */
export function unpackTail(inner, archives, added, left) {
  lines = {};
  whenAdded = added;
  var gone = left && left.count ? el("p", "mt-note up-gone", (left.count === 1 ? "1 archive is" : left.count + " archives are") +
    " not listed" + (archives.length ? " here" : "") + ": " + (left.count === 1 ? "its game is" : "their games are") + " unpacked already. " +
    (left.count === 1 ? "It takes " : "They take ") + gb(left.bytes) + ", and Xsegon never deletes one: delete " +
    (left.count === 1 ? "it" : "them") + " yourself if you want the space back.") : null;
  if (!archives.length) {
    if (gone) { inner.appendChild(gone); }
    return;
  }
  inner.appendChild(el("h2", "bk-head", "Disc games still in an archive"));
  inner.appendChild(el("p", "mt-note", "No emulator reads a disc from inside a .zip or a .7z. Unpack and add looks into the archive first, " +
    "says which console's game it is and whether it is in that console's folder, then unpacks it beside itself and adds the game. " +
    "The archive is never changed or deleted."));
  // The virus check, said where it can be turned off; shown once the server says Defender is here.
  var opt = el("label", "up-opt"), tick = el("input");
  tick.type = "checkbox";
  tick.checked = checkFirst;
  tick.addEventListener("change", function () {
    checkFirst = tick.checked;
    L("UNPK", "the Windows Defender check " + (checkFirst ? "on" : "off"));
    try { localStorage.setItem("xs-unpack-check", checkFirst ? "1" : "0"); } catch (e) { /* not remembered, then */ }
    if (allTime) { allTime.textContent = timeSays(); }
  });
  opt.appendChild(tick);
  opt.appendChild(document.createTextNode(" Ask Windows Defender about each archive before it is unpacked. It only looks, nothing is removed, " +
    "and a 7 GB disc takes about four minutes. Either way, an archive whose list of files holds something that does not belong in a game is not unpacked."));
  opt.hidden = true;
  inner.appendChild(opt);
  var none = el("p", "mt-note", "Windows Defender is not here to be asked, so an archive is judged by its list of files alone: " +
    "one that holds something that does not belong in a game is not unpacked.");
  none.hidden = true;
  inner.appendChild(none);
  var box = el("div", "up-rows");
  archives.forEach(function (a) {
    var line = { archive: a.file };
    var node = el("div", "up-row");
    var top = el("div", "up-top");
    top.appendChild(el("span", "up-file", base(a.file)));
    // The end of the path is the part that says where: the console's folder.
    var where = el("span", "up-where", a.platform + "  ·  " + folderOf(a.file).split(/[\\\/]/).slice(-2).join("\\"));
    where.title = folderOf(a.file);
    top.appendChild(where);
    line.go = button("Unpack and add", "up-go", function () { look(line); });
    line.stop = button("Stop", "up-stop", function () {
      post({ action: "stop" }).then(function (r) { if (!r.ok) { showStrip(r.error || "could not stop it", true); } });
    });
    line.stop.hidden = true;
    top.appendChild(line.go);
    top.appendChild(line.stop);
    node.appendChild(top);
    line.says = el("p", "up-says");
    line.says.hidden = true;
    node.appendChild(line.says);
    line.bar = el("div", "mt-bar up-bar");
    line.fill = el("div", "mt-fill");
    line.bar.appendChild(line.fill);
    line.bar.hidden = true;
    node.appendChild(line.bar);
    line.acts = el("div", "bk-acts up-acts");
    line.acts.hidden = true;
    node.appendChild(line.acts);
    box.appendChild(node);
    lines[a.file.toLowerCase()] = line;
  });
  inner.appendChild(box);
  if (gone) { inner.appendChild(gone); }

  // How things stand already: one being unpacked, some waiting, some done before.
  api("api/unpack.php").then(function (st) {
    if (!st.ok) { return; }
    opt.hidden = !st.defender;
    none.hidden = !!st.defender;
    defenderHere = !!st.defender;
    if (allTime) { allTime.textContent = timeSays(); }
    Object.keys(st.unpacked || {}).forEach(function (k) {
      var line = lines[k], rec = st.unpacked[k];
      if (!line) { return; }
      line.done = true;
      line.go.hidden = true;
      say(line, "Unpacked on " + new Date(rec.at * 1000).toISOString().slice(0, 10) + " to " + rec.dest +
        ". The archive is still there: delete it yourself if you want its space back.", "good");
    });
    (st.results || []).forEach(function (r) { if (!tally) { told[r.archive.toLowerCase() + "|" + r.at] = true; } });
    paint(st);
    if (st.running || (st.waiting || []).length) { tally = tally || newTally(); watch(); }
  });
}
