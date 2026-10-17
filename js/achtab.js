/*  The Achievements tab of a game's details (api\achievements.php ?game=):
    which RetroAchievements set the game's file opens, and every achievement
    in it, the earned ones in colour, the rest in their grey copy. RetroArch
    earns them; this only reads. Not set up, it says the step that is left.
    The first row chooses what shows, so the pad can change it too.        */

import { signInWords } from "./achsettings.js";
import { setTabRows, tabSays } from "./detailtabs.js";
import { iconEl } from "./icons.js";
import { showStrip } from "./launch.js";
import { L, api } from "./log.js";
import { openSettingAt } from "./settings-ui.js";
import { el } from "./util.js";

export function achTabLabel() { return "Achievements"; }

// What the first row shows, in turn: [key, words, which achievements].
var SHOWS = [
  ["all", "All", function () { return true; }],
  ["earned", "Earned", function (a) { return !!a.earned; }],
  ["not", "Not yet", function (a) { return !a.earned; }],
  ["miss", "Can be missed", function (a) { return a.kind === "missable" && !a.earned; }]
];
var achShow = "all";      // kept while details is up, across games

export function achPane(pane, g) {
  pane.appendChild(el("p", "dtab-wait", "asking RetroAchievements what " + g.title + " has…"));
  api("api/achievements.php?game=" + encodeURIComponent(g.id)).then(function (res) {
    if (!pane.isConnected || !pane.classList.contains("is-achievements")) { return; }
    pane.textContent = "";
    paint(pane, g, res);
  });
}

// A day as a person reads it: 12 Oct, with the year when it is not this one.
function day(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) { return ""; }
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function bar(buttons) {
  var b = el("div", "bar ach-acts");
  buttons.forEach(function (x) {
    var btn = el("button", null, x[0]);
    btn.addEventListener("click", x[1]);
    b.appendChild(btn);
  });
  return b;
}

// Settings > Emulators, the bar on the Achievements section's sign-in row (js\achsettings.js).
function toSettings() { openSettingAt("emulators", "achievements"); }

// The tab's top row: who RetroArch is signed in as, and the way to sign in or out.
function signRow(who) {
  var r = el("div", "cr-row ch-act ach-sign");
  r.appendChild(iconEl("cr-ico", "shield"));
  r.appendChild(el("span", "cr-name", "Sign in or out"));
  r.appendChild(el("span", "cr-tag", "signed in as " + who + "  ·  Settings > Emulators > Achievements"));
  r.addEventListener("click", toSettings);
  return r;
}

function openRetroArch() {
  api("api/retroarch.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(function (r) {
    showStrip(r.ok ? "RetroArch is opening: Settings > Achievements" : ("could not open RetroArch: " + (r.error || "")), !r.ok);
  });
}

function paint(pane, g, res) {
  var sign = res.who ? signRow(res.who) : null;
  if (sign) {
    var signBox = el("div", "ch-list ach-who");
    signBox.appendChild(sign);
    pane.appendChild(signBox);
  }
  var say = function (words, buttons) {
    pane.appendChild(tabSays(words));
    if (buttons && buttons.length) { pane.appendChild(bar(buttons)); }
    if (sign) { sign.classList.add("sel"); }
    setTabRows(pane, sign ? { cells: [sign], at: 0, word: "sign in or out", move: function () {}, choose: toSettings } : null);
  };
  if (!res.ok) { say(res.error || "RetroAchievements could not be asked"); return; }
  L("ACH", "tab " + g.title + ": " + res.state + (res.set ? ", set " + res.set.id + ", " + res.earned + " of " + res.total : ""));
  if (res.state === "setup") {
    var ra = res.ra || { step: "none" };
    if (ra.step !== "ready") {
      say("RetroArch earns these, signed in to RetroAchievements. " + signInWords(ra),
          (ra.step === "none" ? [] : [["Open RetroArch", openRetroArch]]).concat([["Settings > Emulators", toSettings]]));
    } else {
      say("RetroArch earns these. To show them here, Xsegon needs your RetroAchievements key: Settings > Emulators > Achievements.", [["Settings > Emulators", toSettings]]);
    }
    return;
  }
  if (res.state === "noset") {
    say("RetroAchievements has no achievements for this file" +
        (res.alike && res.alike.length ? ". It has them for " + res.alike[0] + ", made for another release of the game" : ""));
    return;
  }
  if (res.state !== "ok") { say(res.why || "RetroAchievements could not be asked"); return; }

  var top = el("div", "ach-head");
  if (res.asOf) {
    top.appendChild(el("p", "mt-note warn", "No answer from RetroAchievements (" + res.why + "): this is what it said on " + day(res.asOf) + "."));
  }
  if (res.set.parent) {
    top.appendChild(el("p", "mt-note warn", "This file opens " + res.set.title + ", a side set" + (res.set.parent.title ? " of " + res.set.parent.title : "") +
                                            ". The regular set is for another release of the game."));
  }
  var line = el("div", "ach-top");
  line.appendChild(el("b", null, res.earned + " of " + res.total + " earned"));
  var prog = el("div", "ach-prog");
  var done = el("i");
  done.style.width = (res.total ? Math.round(100 * res.earned / res.total) : 0) + "%";
  prog.appendChild(done);
  line.appendChild(prog);
  line.appendChild(el("span", null, res.pointsEarned + " of " + res.points + " points  ·  " + (res.hardcore ? "hardcore" : "softcore")));
  top.appendChild(line);
  pane.appendChild(top);

  var list = el("div", "cr-list ach-list");
  pane.appendChild(list);
  var cells = [], at = 0;
  var shows = SHOWS.filter(function (s) { return s[0] !== "miss" || res.achievements.some(s[2]); });
  if (!shows.some(function (s) { return s[0] === achShow; })) { achShow = "all"; }

  var showAt = sign ? 1 : 0;   // the row that chooses what shows, under Sign in or out
  function focusAt(i) {
    at = Math.max(0, Math.min(cells.length - 1, i));
    cells.forEach(function (c, k) { c.classList.toggle("sel", k === at); });
    // Sign in or out, then the row that changes what shows; the rest are to look at.
    setTabRows(pane, { cells: cells, at: at, look: at > showAt, word: at === showAt ? "change what shows" : at < showAt ? "sign in or out" : "",
                       move: function (d) { focusAt(at + d); },
                       choose: function () { if (at === showAt) { nextShow(); } else if (at < showAt) { toSettings(); } } });
    if (cells[at]) { cells[at].scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }
  function nextShow() {
    var i = shows.findIndex(function (s) { return s[0] === achShow; });
    achShow = shows[(i + 1) % shows.length][0];
    L("ACH", "tab shows " + achShow);
    drawList();
    focusAt(showAt);
  }
  function drawList() {
    list.textContent = "";
    cells = sign ? [sign] : [];
    var chosen = shows.filter(function (s) { return s[0] === achShow; })[0];
    var showRow = el("div", "cr-row ach-show");
    showRow.appendChild(iconEl("cr-ico", "filter"));
    showRow.appendChild(el("span", "cr-name", "Show: " + chosen[1]));
    showRow.appendChild(el("span", "cr-tag", shows.map(function (s) { return s[1] + " " + res.achievements.filter(s[2]).length; }).join("  ·  ")));
    showRow.addEventListener("click", function () { nextShow(); });
    list.appendChild(showRow);
    cells.push(showRow);
    var these = res.achievements.filter(chosen[2]);
    these.forEach(function (a) { var r = achRow(a); list.appendChild(r); cells.push(r); });
    if (!these.length) { list.appendChild(el("p", "cr-none", "None here.")); }
  }
  drawList();
  focusAt(showAt);
}

// One achievement: its badge (grey until earned), name, what it asks, points, how many players have it, the day.
function achRow(a) {
  var r = el("div", "cr-row ach-item" + (a.earned ? " got" : ""));
  r.title = a.desc;
  var pic = el("span", "ach-badge" + (a.share < 2 ? " rarest" : a.share < 10 ? " rare" : ""));
  var img = el("img");
  img.alt = "";
  img.loading = "lazy";
  img.src = "api/achievements.php?badge=" + encodeURIComponent(a.badge) + (a.earned ? "" : "&grey=1");
  pic.appendChild(img);
  r.appendChild(pic);
  var words = el("div", "ach-words");
  words.appendChild(el("span", "cr-name", a.title));
  var why = a.kind === "missable" && !a.earned ? "Can be missed: " + a.desc : a.kind === "win_condition" ? "Beats the game: " + a.desc : a.desc;
  words.appendChild(el("span", "ach-why" + (a.kind === "missable" && !a.earned ? " warn" : a.kind === "win_condition" ? " good" : ""), why));
  r.appendChild(words);
  r.appendChild(el("span", "cr-tag ach-pt", a.points + " pts"));
  r.appendChild(el("span", "cr-tag ach-few" + (a.share < 2 ? " gold" : ""), a.share + "% of players"));
  r.appendChild(el("span", "cr-tag ach-day", a.earned ? day(a.earned) + (a.hard ? "" : ", softcore") : "not yet"));
  return r;
}
