/*  The Fan projects page: hacks, mods and PC versions made from games you own
    (api\fanprojects.php). Opened from its card on the consoles screen and from
    the Games menu. Drawn with the games' own boxes (the grid, its tiles and
    headings, the panel beside them), so every theme dresses it as it dresses
    the games. Make makes a project from your game where the list says how
    (includes\fanmake.php, roadmap AQ2 and AQ3): a patched copy, a PC version
    from the team's release or source, or a disc mod's pack.                 */

import { dropDetails } from "./details.js";
import { dropExtPage } from "./extensions.js";
import { paintHelp, paintHelpHere } from "./help.js";
import { jobsWatch } from "./jobbars.js";
import { launchNow, showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { armBrowse, stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $body, $main, $syswall, $toolbar, S, sysStage } from "./state.js";
import { backToWall } from "./systems.js";
import { el } from "./util.js";

// The card's name on the consoles screen: a collection's shape, opened here instead of as games.
export var FAN_KEY = "@fanprojects";

var FAN_SECTIONS = [["mine", "In your library"], ["ready", "Ready to make"],
                    ["other", "You have another release"], ["missing", "Needs a game you do not have"], ["soon", "Coming soon"]];
var FAN_ADDS = [["", "Adds anything"], ["coop", "Couch co-op"], ["fighters", "New fighters"],
                ["levels", "New stages and tracks"], ["widescreen", "Widescreen and 60 fps"]];
var FAN_TAGS = { coop: "Couch co-op", fighters: "New fighters", levels: "New stages", widescreen: "Widescreen" };

var FP = null;          // the page's parts, once built
var fanProjects = [];   // as the server answered, in its order
var fanShown = [];      // what passes the filters, in the page's order: { p, tile }
var fanAt = 0;
var fanPadAt = 0;       // when a held direction steps again

export function fanOpen() { return !!(FP && FP.open); }

function fanBuild() {
  FP = { open: false };
  FP.root = el("div", "fanpage");
  FP.root.id = "fanpage";
  FP.root.hidden = true;
  var head = el("div", "fan-head");
  head.appendChild(el("span", "fan-name", "Fan projects"));
  head.appendChild(el("span", "fan-sub", "Hacks, mods and PC versions made from your games"));
  FP.root.appendChild(head);

  var bar = el("div", "bar");
  var back = el("button", null, "◂ Systems");
  back.type = "button";
  back.addEventListener("click", function () { closeFanPage(); });
  FP.consoles = el("select");
  FP.adds = el("select");
  FAN_ADDS.forEach(function (a) { var o = el("option", null, a[1]); o.value = a[0]; FP.adds.appendChild(o); });
  FP.find = el("input");
  FP.find.type = "search";
  FP.find.placeholder = "Find a project";
  [FP.consoles, FP.adds].forEach(function (s) { s.addEventListener("change", function () { fanDraw(); }); });
  FP.find.addEventListener("input", function () { fanDraw(); });
  [back, FP.consoles, FP.adds, FP.find].forEach(function (n) { bar.appendChild(n); });
  FP.root.appendChild(bar);

  FP.main = el("div", "main with-hero");
  FP.grid = el("div", "grid grid-shot");
  FP.hero = el("div", "hero");
  FP.main.appendChild(FP.grid);
  FP.main.appendChild(FP.hero);
  FP.root.appendChild(FP.main);
  $syswall.after(FP.root);
  window.addEventListener("resize", fanFit);
}

// The grid and the panel reach down to the legend, as the games' do.
function fanFit() {
  if (!fanOpen()) { return; }
  FP.root.style.setProperty("--fan-top", Math.round(FP.main.getBoundingClientRect().top) + "px");
}

export function openFanPage() {
  if (!FP) { fanBuild(); }
  if (FP.open) { return; }
  dropDetails();                         // a game's details never stay over the page
  dropExtPage();                         // nor the Extensions page
  stopVideo();                           // nor a snap playing behind it
  FP.from = sysStage === "inside" ? "inside" : "wall";
  FP.open = true;
  L("NAV", "fan projects, from the " + FP.from);
  $syswall.hidden = true;
  $main.hidden = true;
  $toolbar.hidden = true;
  $body.classList.add("on-fan");
  FP.root.hidden = false;
  FP.grid.textContent = "";
  FP.hero.textContent = "";
  FP.first = null;                       // no press reaches the last visit's buttons while it reads
  fanShown = [];
  FP.grid.appendChild(el("div", "fan-wait", "Reading your games for what each project needs..."));
  fanFit();
  paintHelp("fanprojects");
  sound("select");
  fanAt = 0;
  fanLoad();
}

// The list read, and drawn keeping the chosen project; a make at work is followed from here.
function fanLoad() {
  api("api/fanprojects.php").then(function (r) {
    if (!fanOpen()) { return; }
    if (!r || !r.ok) {
      L("FAN", "the list could not be read: " + ((r && r.error) || "no answer"));
      showStrip("Fan projects could not be read: " + ((r && r.error) || "no answer from Xsegon"), true);
      fanProjects = [];
    } else {
      fanProjects = r.projects || [];
      L("FAN", fanProjects.length + " projects read in " + r.ms + "ms");
    }
    fanConsoles();
    if (r && r.making && FP.making !== r.making) { fanFollow(r.making); }
    fanDraw();
  });
}

/* Make: one press. The bar in the corner says how far it is and how it ended
   (js\jobbars.js); the page reads its list again when it is over, so what was
   made stands under In your library. */
function fanMake(p) {
  if (FP.making) { return; }
  L("FAN", "make " + p.name + " pressed");
  postJson("api/fanprojects.php", { make: p.id }).then(function (r) {
    if (!r || !r.ok) {
      showStrip(p.name + " was not made: " + ((r && r.error) || "no answer"), true);
      sound("back");
      return;
    }
    sound("select");
    showStrip("Making " + p.name + " from your " + (p.base.yourTitle || "game") + (p.base.state === "unchecked" ? ", its file checked first" : "") +
              ": the bar in the corner shows how far it is", false);
    jobsWatch("fanmake");
    fanFollow(p.id);
    if (fanOpen()) { fanDraw(); }
  });
}

function fanFollow(id) {
  FP.making = id;
  clearInterval(FP.followT);
  FP.followT = setInterval(function () {
    api("api/fanprojects.php?job=1").then(function (r) {
      if (r && r.ok && r.job && r.job.state === "running") { return; }
      clearInterval(FP.followT);
      FP.making = null;
      if (fanOpen()) { fanLoad(); }
    });
  }, 2000);
}

// Off screen, and what it covered back: the consoles, or the games it was opened from.
function fanHide() {
  FP.open = false;
  FP.root.hidden = true;
  $body.classList.remove("on-fan");
  if (FP.from === "inside") { $main.hidden = false; $toolbar.hidden = false; }
  else { $syswall.hidden = false; }
}

export function closeFanPage() {
  if (!fanOpen()) { return; }
  L("NAV", "fan projects closed, back to the " + FP.from);
  fanHide();
  if (FP.from === "inside") {
    sound("back");
    paintHelpHere();
    armBrowse();
  } else {
    backToWall();
  }
}

/* Put away without a sound or a legend, for a caller about to draw another
   screen (a view change, the consoles, a console, a game's details), as
   dropDetails is. Answers whether the page was up. */
export function dropFanPage() {
  if (!fanOpen()) { return false; }
  L("NAV", "fan projects put away for another screen");
  fanHide();
  return true;
}

// The consoles the list holds, as the first select's choices.
function fanConsoles() {
  var was = FP.consoles.value, seen = [];
  FP.consoles.textContent = "";
  var all = el("option", null, "All consoles");
  all.value = "";
  FP.consoles.appendChild(all);
  fanProjects.forEach(function (p) {
    if (seen.indexOf(p.console) >= 0) { return; }
    seen.push(p.console);
    var o = el("option", null, p.console);
    o.value = p.console;
    FP.consoles.appendChild(o);
  });
  FP.consoles.value = seen.indexOf(was) >= 0 ? was : "";
}

function fanSection(p) {
  if (p.yours.length) { return "mine"; }
  if (p.soon) { return "soon"; }
  var s = p.base.state;
  // A game not checked yet is ready too: Make checks its file first.
  return s === "fits" || s === "works" || s === "unchecked" ? "ready" : s === "missing" ? "missing" : "other";
}

// Where a project stands, in one line and its colour.
function fanStatus(p) {
  var b = p.base;
  if (FP && FP.making === p.id) { return ["", "Being made: the bar in the corner shows how far it is"]; }
  if (p.yours.length) {
    return ["", "Yours: " + p.yours.map(function (y) { return y.version || "a copy"; }).join(" and ")];
  }
  // A copy whose title is not the game's, known by its checksum: said so, so the name is not a surprise.
  var sum = b.bySum ? " (known by its checksum)" : "";
  if (b.state === "fits") { return ["ok", "Your " + b.yourTitle + " fits" + sum]; }
  if (b.state === "works") { return ["warn", "Your " + b.yourTitle + " " + (b.note || "works") + sum]; }
  if (b.state === "other") { return ["warn", "Yours is " + (b.release || b.yourTitle) + "; this needs " + b.title]; }
  if (b.state === "partial") { return ["warn", "Yours has " + b.have + " of its " + b.need + " discs; this needs all of them"]; }
  if (b.state === "unchecked") { return ["", "Your " + b.yourTitle + ": Make checks its file first"]; }
  if (b.state === "unread") { return ["", "Your " + b.yourTitle + ": which discs it is cannot be read from this kind of file yet"]; }
  return ["no", "Needs " + b.title];
}

function fanPic(id, kinds, img, onNone) {
  var i = 0;
  function next() {
    if (!id || i >= kinds.length) { onNone(); return; }
    img.src = "api/image.php?id=" + encodeURIComponent(id) + "&kind=" + kinds[i++];
  }
  img.onerror = next;
  next();
}

// A tile as the panel reads: the project's name over its picture, where it stands under it.
function fanTile(p) {
  var t = el("div", "tile");
  var cap = el("div", "cap", p.name);
  var kind = el("span", "bdg");
  kind.appendChild(el("span", "b-hack", p.kindLabel.toUpperCase()));
  cap.appendChild(kind);
  t.appendChild(cap);
  var img = el("img", "shot as-shot");
  img.alt = "";
  t.appendChild(img);
  fanPic(p.pic, ["shot", "fanart", "box"], img, function () {
    var none = el("div", "noart fan-noart", p.base.title.toUpperCase());
    img.replaceWith(none);
  });
  // Under Coming soon a tile says where the project stands; whether your game fits waits in the panel.
  var st = fanSection(p) === "soon" ? ["", p.soon] : fanStatus(p);
  t.appendChild(el("div", "fan-st" + (st[0] ? " " + st[0] : ""), st[1]));
  return t;
}

// The grid again, under the filters, keeping the chosen project where it still shows.
function fanDraw() {
  var was = fanShown[fanAt] ? fanShown[fanAt].p.id : null;
  var c = FP.consoles.value, adds = FP.adds.value, words = FP.find.value.trim().toLowerCase();
  FP.grid.textContent = "";
  fanShown = [];
  FAN_SECTIONS.forEach(function (sec) {
    var lot = fanProjects.filter(function (p) {
      return fanSection(p) === sec[0] && (!c || p.console === c) && (!adds || p.tags.indexOf(adds) >= 0)
        && (!words || (p.name + " " + p.base.title + " " + p.adds + " " + p.team).toLowerCase().indexOf(words) >= 0);
    });
    if (!lot.length) { return; }
    var h = el("div", "ghead");
    h.appendChild(el("span", "ghead-name", sec[1]));
    h.appendChild(el("span", "ghead-n", String(lot.length)));
    FP.grid.appendChild(h);
    lot.forEach(function (p) {
      var t = fanTile(p), at = fanShown.length;
      t.addEventListener("click", function () { if (at !== fanAt) { fanGo(at); } });
      FP.grid.appendChild(t);
      fanShown.push({ p: p, tile: t });
    });
  });
  if (!fanShown.length) {
    FP.grid.appendChild(el("div", "fan-wait", fanProjects.length ? "No project passes these filters." : "No projects to show."));
    FP.hero.textContent = "";
    FP.first = null;
    return;
  }
  var i = fanShown.findIndex(function (s) { return s.p.id === was; });
  fanGo(i >= 0 ? i : 0, true);
}

function fanGo(i, quiet) {
  if (!fanShown.length) { return; }
  fanAt = Math.max(0, Math.min(fanShown.length - 1, i));
  fanShown.forEach(function (s, k) { s.tile.classList.toggle("sel", k === fanAt); });
  fanShown[fanAt].tile.scrollIntoView({ block: "nearest" });
  if (!quiet) { sound("move"); }
  fanPanel(fanShown[fanAt].p);
}

function fanButton(label, run, primary, off) {
  var b = el("button", primary ? "primary" : null, label);
  b.type = "button";
  if (off) { b.disabled = true; b.title = off; }
  b.addEventListener("click", run);
  return b;
}

// The places a project lives, in the order its buttons stand: its website, its GitHub, its community.
var FAN_LINKS = [["page", "Website"], ["repo", "GitHub"], ["community", "Community"]];

function fanAddress(url) { return url.replace(/^https:\/\/(github\.com\/)?/, "").replace(/\/$/, ""); }

// The panel beside the grid: the project's name and who made it over its picture; what it adds, where it stands and its buttons under it.
function fanPanel(p) {
  FP.hero.textContent = "";
  var top = el("div", "fan-top");
  top.appendChild(el("div", "fan-kind", p.kindLabel + " · " + p.console));
  var h = el("h3");
  h.appendChild(el("span", "hero-name", p.name));
  top.appendChild(h);
  if (p.team) { top.appendChild(el("div", "fan-by", "by " + p.team)); }
  // The work it stands on, credited with its makers.
  if (p.basedon) { top.appendChild(el("div", "fan-by fan-based", "based on " + p.basedon)); }
  FP.hero.appendChild(top);

  var frame = el("div", "hero-art-frame");
  var img = el("img", "hero-art");
  img.alt = "";
  frame.appendChild(img);
  fanPic(p.pic, ["box", "shot"], img, function () { img.replaceWith(el("div", "hero-noart", "NO ART")); });
  FP.hero.appendChild(frame);

  var info = el("div", "hero-info");
  var tags = p.tags.filter(function (t) { return FAN_TAGS[t]; });
  if (tags.length) {
    var pills = el("div", "pills");
    tags.forEach(function (t) { pills.appendChild(el("span", "pill", FAN_TAGS[t])); });
    info.appendChild(pills);
  }
  info.appendChild(el("p", "fan-adds", p.adds));
  var stats = el("div", "hero-stats");
  function kv(k, v, hot) { stats.appendChild(el("span", "k", k)); stats.appendChild(el("span", "v" + (hot ? " hot" : ""), v)); }
  var st = fanStatus(p);
  if (p.soon) { kv("Coming soon", p.soon); }
  kv("Built from", p.base.title);
  kv("Yours",p.yours.length ? st[1].replace(/^Yours: /, "") : st[1], st[0] === "ok");
  kv("Licence", p.licence || "none given");
  if (p.page) { kv("Website", fanAddress(p.page)); }
  if (p.repo) { kv("GitHub", fanAddress(p.repo)); }
  info.appendChild(stats);
  FP.hero.appendChild(info);

  var bar = el("div", "bar");
  FP.first = fanFirst(p);
  bar.appendChild(FP.first);
  // Make stands on every project; beside Play and the wanted list it is the second button.
  var s = fanSection(p);
  if (s === "mine") { bar.appendChild(fanMakeButton(p, "Make another copy", false)); }
  else if (s === "missing" && p.base.db) { bar.appendChild(fanMakeButton(p, "Make", false)); }
  FAN_LINKS.forEach(function (w) {
    if (!p[w[0]]) { return; }
    var b = fanButton(w[1], function () { fanOpenUrl(p, w[0]); });
    b.title = fanAddress(p[w[0]]);
    bar.appendChild(b);
  });
  FP.hero.appendChild(bar);
}

// The panel's first button is the next thing to do for this project; A on a pad presses it.
function fanFirst(p) {
  var s = fanSection(p);
  if (s === "mine") {
    var y = p.yours[0];
    return fanButton("Play " + (y.version || ""), function () {
      L("FAN", "play " + p.name + " " + (y.version || "") + " (" + y.id + ")");
      launchNow({ id: y.id, title: y.title, platform: y.platform, local: !!y.local }, null);
    }, true);
  }
  if (s === "missing" && p.base.db) {
    return fanButton(p.base.wanted ? "On your wanted list" : "Add to wanted list", function () { fanWant(p); }, true,
                     p.base.wanted ? p.base.db.title + " is on your wanted list already" : null);
  }
  return fanMakeButton(p, "Make", true);
}

// Make, greyed where it cannot be pressed: the pointer over it, or A and Enter, say why (the server's words).
function fanMakeButton(p, label, primary) {
  var another = FP.making ? "Something is being made: the bar in the corner shows how far it is" : null;
  return fanButton(FP.making === p.id ? "Being made" : label, function () { fanMake(p); }, primary, another || p.makeWhy);
}

// The game it is made from onto the wanted list, said only from the server's answer.
function fanWant(p) {
  var db = p.base.db;
  postJson("api/wanted.php", { id: db.id, want: true, title: db.title, platform: db.platform, year: "" }).then(function (r) {
    if (!r || !r.ok) {
      showStrip(db.title + " was not added to your wanted list: " + ((r && r.error) || "no answer"), true);
      return;
    }
    L("FAN", db.title + " wanted, for " + p.name);
    p.base.wanted = true;
    sound("select");
    showStrip(db.title + " is on your wanted list (Games > Games you do not have)", false);
    if (fanShown[fanAt] && fanShown[fanAt].p === p) { fanPanel(p); }
  });
}

// The team's website, GitHub or community in your own browser: the server opens what the list names, never an address from here.
function fanOpenUrl(p, which) {
  postJson("api/fanprojects.php", { open: p.id, which: which }).then(function (r) {
    if (!r || !r.ok) {
      showStrip(p.name + "'s page did not open: " + ((r && r.error) || "no answer"), true);
      return;
    }
    L("FAN", "open " + which + " of " + p.name);
    sound("select");
    showStrip("Opened " + r.url.replace(/^https:\/\//, "") + " in your browser", false);
  });
}

function fanPress() {
  var b = FP && FP.first;
  if (!b) { return; }
  if (b.disabled) { showStrip(b.title, false); sound("back"); return; }
  b.click();
}

// The nearest tile that way, by where the tiles stand on screen, so the walk follows the grid's rows and headings.
function fanStep(dx, dy) {
  if (!fanShown.length) { return; }
  var from = fanShown[fanAt].tile.getBoundingClientRect(), best = -1, bestD = Infinity;
  fanShown.forEach(function (s, k) {
    if (k === fanAt) { return; }
    var r = s.tile.getBoundingClientRect();
    var ddx = r.left - from.left, ddy = r.top - from.top;
    if (dx && (Math.sign(ddx) !== dx || Math.abs(ddy) > from.height / 2)) { return; }
    if (dy && Math.sign(ddy) !== dy) { return; }
    var d = dy ? Math.abs(ddy) * 4 + Math.abs(ddx) : Math.abs(ddx);
    if (d < bestD) { bestD = d; best = k; }
  });
  if (best >= 0) { fanGo(best); }
}

/* The keys while the page is up: arrows walk the tiles, Enter presses the
   panel's first button, Esc goes back, and typing finds. The find box and
   the selects keep their own keys until Esc or Down. Answers whether the
   key was the page's. */
export function fanKeys(e) {
  if (!fanOpen()) { return false; }
  var tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "SELECT") {
    if (e.key === "Escape" || (e.key === "ArrowDown" && tag === "INPUT") || e.key === "Enter") { e.target.blur(); e.preventDefault(); }
    return true;
  }
  if (e.key === "ArrowRight") { fanStep(1, 0); }
  else if (e.key === "ArrowLeft") { fanStep(-1, 0); }
  else if (e.key === "ArrowDown") { fanStep(0, 1); }
  else if (e.key === "ArrowUp") { fanStep(0, -1); }
  else if (e.key === "Home") { fanGo(0); }
  else if (e.key === "End") { fanGo(fanShown.length - 1); }
  else if (e.key === "Enter" || e.key === " ") { fanPress(); }
  else if (e.key === "Escape" || e.key === "Backspace") { closeFanPage(); }
  else if (e.key.length === 1 && !e.ctrlKey && !e.altKey) { FP.find.focus(); return true; }
  else { return true; }
  e.preventDefault();
  return true;
}

/* The pad while the page is up: the cross walks the tiles (held, it steps
   on), A presses the panel's first button, X opens their page, B goes back.
   Answers the buttons as they stand, for the next poll to compare. */
export function fanPad(k, prev) {
  var d = k.right ? [1, 0] : k.left ? [-1, 0] : k.down ? [0, 1] : k.up ? [0, -1] : null;
  var key = d ? d.join() : "", now = Date.now(), padSet = S.controller || {};
  if (!d) { fanPadAt = 0; }
  else if (key !== prev.fd) { fanStep(d[0], d[1]); fanPadAt = now + (padSet.repeatDelayMs || 400); }
  else if (now >= fanPadAt) { fanStep(d[0], d[1]); fanPadAt = now + (padSet.repeatRateMs || 110); }
  if (k.a && !prev.a) { fanPress(); }
  if (k.x && !prev.x && fanShown[fanAt]) { fanOpenUrl(fanShown[fanAt].p, fanShown[fanAt].p.page ? "page" : "repo"); }
  if (k.b && !prev.b) { closeFanPage(); }
  return { a: k.a, b: k.b, x: k.x, y: k.y, fd: key };
}
