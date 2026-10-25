/*  Tumultuous Productions' page: help from the person who makes Xsegon, and
    the games they are making (api\tumultuous.php, includes\tumultuous.php).
    Opened from its card, last on the consoles screen, and from the Help menu,
    as Fan projects opens. It wears the website's own look (css\tppage.css).
    Its words ship with Xsegon; an address opens in the browser or the email
    app only when its button is pressed.                                     */

import { openBiosCheck } from "./bios.js";
import { dropDetails } from "./details.js";
import { dropExtPage } from "./extensions.js";
import { dropFanPage } from "./fanprojects.js";
import { paintHelp, paintHelpHere } from "./help.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { openPadCheck } from "./padcheck.js";
import { qrMatrix } from "./qr.js";
import { openSettingAt } from "./settings-ui.js";
import { openGuide } from "./setup.js";
import { armBrowse, stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $body, $main, $syswall, $toolbar, S, sysStage } from "./state.js";
import { backToWall } from "./systems.js";
import { openReportTool } from "./tools.js";
import { el } from "./util.js";

// The card's name on the consoles screen: a collection's shape, opened here instead of as games.
export var TP_KEY = "@tumultuous";

var TP = null;          // the page's parts, once built
var tpData = null;      // as the server answered: { page, tell }
var tpTab = "help";
var tpAt = null;        // the button a controller or the arrows are on
var tpPadAt = 0;        // when a held direction steps again

export function tpOpen() { return !!(TP && TP.open); }

// Every class on the page is tp- (css\tppage.css), so Xsegon's own rules (.panel, .sidebar...) never reach in: written bare, prefixed here.
function tpClass(cls) {
  return cls ? cls.split(" ").filter(Boolean).map(function (c) { return c.indexOf("tp-") === 0 ? c : "tp-" + c; }).join(" ") : null;
}

/* An element with its class and what goes in it: text, other elements, or a list of both. */
function mk(tag, cls, kids, attrs) {
  var n = el(tag, tpClass(cls));
  [].concat(kids === undefined || kids === null ? [] : kids).forEach(function (k) {
    if (k !== null && k !== undefined && k !== false) { n.appendChild(typeof k === "string" ? document.createTextNode(k) : k); }
  });
  Object.keys(attrs || {}).forEach(function (a) { n.setAttribute(a, attrs[a]); });
  return n;
}

// A button that does one thing, named in data-do; one listener reads them all (tpDo).
function btn(cls, kids, act) { return mk("button", cls, kids, { type: "button", "data-do": act }); }

function tpBuild() {
  TP = { open: false, from: "wall", rain: [] };
  TP.root = mk("div", null, mk("div", "aurora", [mk("span"), mk("span"), mk("span"), mk("span")]));
  TP.root.id = "tppage";
  TP.root.hidden = true;
  TP.scroll = mk("div", "tp-scroll");
  TP.root.appendChild(TP.scroll);
  TP.root.appendChild(mk("div", "grain"));
  TP.scroll.addEventListener("click", function (e) {
    var b = e.target.closest("[data-do]");
    if (b) { tpMark(b, true); tpDo(b.getAttribute("data-do"), b); }
  });
  $syswall.after(TP.root);
  window.addEventListener("resize", function () { if (tpOpen()) { tpRain(); } });
  document.addEventListener("visibilitychange", function () { if (tpOpen()) { tpRain(); } });
}

export function openTpPage() {
  if (!TP) { tpBuild(); }
  if (TP.open) { return; }
  dropDetails();                         // a game's details never stay over the page
  dropFanPage();                         // nor Fan projects or Extensions
  dropExtPage();
  stopVideo();                           // nor a snap playing behind it
  TP.from = sysStage === "wall" ? "wall" : "inside";
  TP.open = true;
  L("NAV", "Tumultuous Productions' page, from the " + TP.from);
  $syswall.hidden = true;
  $main.hidden = true;
  $toolbar.hidden = true;
  $body.classList.add("on-tp");
  TP.root.hidden = false;
  paintHelp("tppage");
  sound("select");
  if (tpData) { tpDraw(); return; }
  TP.scroll.textContent = "";
  TP.scroll.appendChild(mk("p", "tell", "Reading the page..."));
  api("api/tumultuous.php").then(function (r) {
    if (!tpOpen()) { return; }
    if (!r || !r.ok) {
      L("TP", "the page could not be read: " + ((r && r.error) || "no answer"));
      showStrip("Tumultuous Productions' page could not be read: " + ((r && r.error) || "no answer from Xsegon"), true);
      closeTpPage();
      return;
    }
    tpData = { page: r.page || {}, tell: r.tell || {} };
    tpDraw();
  });
}

// Off screen, and what it covered back: the consoles, or the games it was opened from.
function tpHide() {
  TP.open = false;
  TP.root.hidden = true;
  $body.classList.remove("on-tp");
  tpRain();
  if (TP.from === "inside") { $main.hidden = false; $toolbar.hidden = false; }
  else { $syswall.hidden = false; }
}

export function closeTpPage() {
  if (!tpOpen()) { return; }
  L("NAV", "Tumultuous Productions' page closed, back to the " + TP.from);
  tpHide();
  if (TP.from === "inside") { sound("back"); paintHelpHere(); armBrowse(); }
  else { backToWall(); }
}

/* Put away without a sound or a legend, for a caller about to draw another
   screen, as dropFanPage is. Answers whether the page was up. */
export function dropTpPage() {
  if (!tpOpen()) { return false; }
  L("NAV", "Tumultuous Productions' page put away for another screen");
  tpHide();
  return true;
}

/* ---- drawing --------------------------------------------------------- */

function tpDraw() {
  var p = tpData.page, name = String(p.name || "Tumultuous Productions").split(" ");
  TP.scroll.textContent = "";
  TP.tabs = {};
  TP.scroll.appendChild(mk("header", "topbar", mk("div", "wrap", [
    mk("span", "brand", [mk("span", "logo", "TP"), name[0] + " ", mk("b", null, name.slice(1).join(" "))]),
    mk("nav", "nav", [
      btn(null, ["◀ ", "Back"], "back"),
      btn("tabbtn", [mk("span", "key", "LB"), "💬 Help"], "tab:help"),
      btn("tabbtn", ["🎮 My games", mk("span", "key", "RB")], "tab:games")
    ])
  ])));
  TP.tabs.help = TP.scroll.appendChild(tpHelp(p, p.help || {}));
  TP.tabs.games = TP.scroll.appendChild(tpGames(p.games || {}));
  TP.scroll.appendChild(mk("footer", "foot", mk("div", "wrap", [
    mk("span", null, "Tumultuous Productions · I make Xsegon, free for everyone, and games of my own."),
    mk("span", null, ["Effects follow Settings > Feel > Animations ", btn("btn ghost small", "Change it", "anim")])
  ])));
  tpShowTab(tpTab, true);
}

function tpBanner(eyebrow, title, lead) {
  return mk("section", "banner", [mk("canvas", "rain"), mk("canvas", "rain heads"), mk("div", "inner", [
    mk("span", "eyebrow", eyebrow), mk("h1", null, [title[0], mk("b", null, title[1])]), mk("p", null, lead)
  ])]);
}

function tpHead(icon, tone, title, sub) {
  return mk("div", "head", [mk("span", "badge" + (tone ? " " + tone : ""), icon), mk("div", null, [mk("h2", null, title), mk("div", "sub", sub)])]);
}

function tpSide(menu, second) {
  return mk("aside", "side", [
    mk("div", "panel", [mk("h3", null, "On this page"), mk("ul", "menu", menu.map(function (m) {
      return mk("li", null, btn(null, [mk("span", "ico", m[0]), m[1]], "go:" + m[2]));
    }))]),
    second
  ]);
}

function tpHelp(p, h) {
  var mail = String(p.mail || ""), paid = h.paid || [];
  var side = tpSide([["🔧", "Fix it yourself", "tp-fix"], ["✉", "Ask me", "tp-ask"], ["🧰", "I can do it for you", "tp-paid"], ["🛡", "Staying safe", "tp-safe"]],
    mk("div", "panel", [mk("h3", null, "Prices"), mk("div", "sides", [mk("div", "free", [mk("span", null, "Asking a question"), mk("b", null, "Free")])].concat(
      paid.map(function (r) { return mk("div", null, [mk("span", null, r.title), mk("b", null, r.per ? r.amount + r.per : r.amount)]); }))),
    btn("btn teal small", "✉ Email me", "mail")]));
  var fix = mk("section", "panel", [tpHead("🔧", "teal", "Fix it yourself", "Free, and already in your Xsegon"), mk("div", "process", (h.fix || []).map(function (f) {
    return mk("div", "proc", [mk("div", "top", [mk("span", "badge" + (f.tone ? " " + f.tone : ""), f.icon), mk("h3", null, f.title)]),
      mk("ul", null, (f.points || []).map(function (t) { return mk("li", null, t); })), btn("btn ghost small", f.button, "fix:" + f.id)]);
  }))], { id: "tp-fix" });
  var qrBox = mk("div", "qr", [tpSquare("mailto:" + mail), mk("div", null, [mk("b", null, "What this code holds"),
    mk("p", null, "Only my email address, " + mail + ", nothing else. Your phone shows the address before it does anything, and nothing is sent until you press Send yourself.")])]);
  qrBox.hidden = true;
  TP.qr = qrBox;
  var ask = mk("section", "panel", [tpHead("✉", "", "Ask me", "Free, always"),
    mk("div", "email", [mk("code", null, mail), btn("btn ghost small", "Copy", "copy"), btn("btn small", "Write to me", "mail")]),
    mk("p", "small muted", "I read every message myself and usually reply " + (p.reply || "within a couple of days") + "."),
    mk("p", null, btn("btn ghost small", "Show a code for my phone", "qr")), qrBox, mk("hr", "glow"),
    mk("h3", null, "Help me help you"), mk("p", null, "A few lines on these and I can give you a real answer the first time:"),
    mk("ul", "ticks", (h.helpme || []).map(function (t) { return mk("li", null, t); }))], { id: "tp-ask" });
  var priced = mk("section", "panel", [tpHead("🧰", "gold", "I can do it for you", "Paid, only if you want it. You bring your own games."),
    mk("div", "freebar", [mk("span", "badge teal", "💬"), mk("div", null, [mk("b", null, "Asking is free"),
      mk("span", null, "Tell me what you need. I tell you if I can help, how, and what it costs. No obligation, and nothing is owed until you say yes.")]),
      btn("btn teal small", "Ask me", "mail")]),
    mk("div", "rates", paid.map(function (r) {
      return mk("div", "rate", [mk("div", "from", r.from), mk("h3", null, r.title), mk("div", "amount", [r.amount, r.per ? mk("small", null, r.per) : null]), mk("p", null, r.about)]);
    })), mk("hr", "glow"), mk("h3", null, "How it works"),
    mk("ol", "steps", (h.steps || []).map(function (s) { return mk("li", null, [mk("b", null, s[0]), " " + s[1]]); }))], { id: "tp-paid" });
  var safe = mk("section", "panel", [tpHead("🛡", "teal", "Staying safe", "How to tell it is really me"), mk("div", "safes", (h.safe || []).map(function (s) {
    return mk("div", "callout" + (s.gold ? " gold" : ""), [mk("b", null, s.title), mk("br"), s.text]);
  }))], { id: "tp-safe" });
  return mk("div", "wrap tp-tab", [tpBanner(h.eyebrow || "", h.title || ["Help with ", "Xsegon"], h.lead || ""),
    mk("div", "layout", [side, mk("main", "content", [fix, ask, priced, safe])])]);
}

function tpGames(g) {
  var list = g.list || [];
  var side = tpSide(list.map(function (x) { return [x.icon || "🎮", x.name, "tp-g-" + x.id]; }).concat([["📰", "Follow along", "tp-follow"]]),
    mk("div", "panel", [mk("h3", null, "Coming"), mk("div", "sides", list.map(function (x) { return mk("div", null, [mk("span", null, x.name), mk("b", null, x.out ? "Out" : x.year)]); })),
      mk("p", "tell", "Tell me when it's out: Xsegon says so in Messages the day it is. No account, no email list.")]));
  var cards = list.map(function (x) {
    var watch = btn("video", [mk("span", "play", "▶"), mk("span", "label", [x.watch, mk("small", null, x.watchSub)])], "open:watch:" + x.id);
    watch.style.backgroundImage = "url(" + x.picture + ")";
    return mk("section", "panel", mk("div", "game", [watch, mk("div", "info", [
      mk("span", "tagline" + (x.tone ? " " + x.tone : ""), x.when), mk("h2", null, x.name), mk("p", null, x.about),
      mk("div", "spec", (x.spec || []).map(function (s) { return mk("span", null, s); })),
      mk("div", "acts", [x.out ? null : tpTellButton(x), x.siteUrl ? btn("btn ghost small", x.site, "open:site:" + x.id) : null])
    ])]), { id: "tp-g-" + x.id });
  });
  var follow = mk("section", "panel", [tpHead("📰", "violet", "Follow along", "News and pictures as the games come along"),
    mk("div", "links", (g.links || []).map(function (l, i) {
      return btn("link", [mk("span", "ico", l.icon), mk("span", null, [l.name, mk("small", null, l.sub)])], "open:link:" + i);
    }))], { id: "tp-follow" });
  return mk("div", "wrap tp-tab", [tpBanner(g.eyebrow || "", ["My ", "games"], g.lead || ""),
    mk("div", "layout", [side, mk("main", "content", cards.concat([follow]))])]);
}

function tpTellButton(x) {
  var on = !!(tpData.tell || {})[x.id];
  var b = btn(on ? "btn small told" : "btn small teal", on ? "✓ Xsegon will tell you" : "🔔 Tell me when it's out", "tell:" + x.id);
  b.setAttribute("data-name", x.name);
  return b;
}

// The address as a square a phone's camera reads (js\qr.js), black on white whatever the page wears.
function tpSquare(text) {
  var m = qrMatrix(text);
  if (!m) { return mk("p", "tell", "The address is too long to draw as a square."); }
  var NS = "http://www.w3.org/2000/svg", edge = 4, side = m.length + edge * 2, d = "";
  var svg = document.createElementNS(NS, "svg"), back = document.createElementNS(NS, "rect"), dots = document.createElementNS(NS, "path");
  m.forEach(function (line, y) { line.forEach(function (dark, x) { if (dark) { d += "M" + (x + edge) + " " + (y + edge) + "h1v1h-1z"; } }); });
  svg.setAttribute("viewBox", "0 0 " + side + " " + side);
  svg.setAttribute("shape-rendering", "crispEdges");
  back.setAttribute("width", side); back.setAttribute("height", side); back.setAttribute("fill", "#fff");
  dots.setAttribute("d", d); dots.setAttribute("fill", "#000");
  svg.appendChild(back);
  svg.appendChild(dots);
  return svg;
}

function tpShowTab(t, quiet) {
  tpTab = t;
  Object.keys(TP.tabs).forEach(function (k) { TP.tabs[k].hidden = k !== t; });
  TP.scroll.querySelectorAll(".tp-nav .tp-tabbtn").forEach(function (b) { b.classList.toggle("tp-on", b.getAttribute("data-do") === "tab:" + t); });
  // A new tab starts at its top at once: the page's smooth scroll would slide up from the old tab's place.
  TP.scroll.scrollTo({ top: 0, behavior: "instant" });
  if (!quiet) { L("TP", "tab: " + (t === "help" ? "Help" : "My games")); sound("move"); }
  tpMark(TP.scroll.querySelector('.tp-nav [data-do="tab:' + t + '"]'), false);
  tpRain();
}

/* ---- what a press does ---------------------------------------------- */

function tpDo(act, b) {
  var p = tpData ? tpData.page : {};
  var part = act.split(":"), kind = part[0];
  if (kind === "back") { closeTpPage(); }
  else if (kind === "tab") { tpShowTab(part[1]); }
  else if (kind === "go") {
    var sec = document.getElementById(part[1]);
    if (sec) { sec.scrollIntoView({ block: "start" }); tpMark(sec.querySelector("[data-do]"), false); }
  }
  else if (kind === "fix") {
    L("TP", "fix it yourself: " + part[1]);
    ({ guide: function () { openGuide(); }, report: openReportTool, pad: function () { openPadCheck(); }, bios: openBiosCheck })[part[1]]();
  }
  else if (kind === "qr") {
    TP.qr.hidden = !TP.qr.hidden;
    b.textContent = TP.qr.hidden ? "Show a code for my phone" : "Hide the code";
    L("TP", "the code for a phone " + (TP.qr.hidden ? "hidden" : "shown"));
  }
  else if (kind === "copy") {
    var done = function (ok) { b.textContent = ok ? "Copied" : "Select and copy"; setTimeout(function () { b.textContent = "Copy"; }, 1800); };
    if (navigator.clipboard) { navigator.clipboard.writeText(String(p.mail || "")).then(function () { done(true); }, function () { done(false); }); }
    else { done(false); }
  }
  else if (kind === "mail" || kind === "open") { tpOpenAddress(kind === "mail" ? "mail" : part.slice(1).join(":"), b); }
  else if (kind === "tell") { tpTell(part[1], b); }
  else if (kind === "anim") { openSettingAt("feel", "animations"); }
}

function tpOpenAddress(what, b) {
  postJson("api/tumultuous.php", { open: what }).then(function (r) {
    if (!r || !r.ok) { showStrip("It did not open: " + ((r && r.error) || "no answer from Xsegon"), true); return; }
    if (r.dry) { showStrip("A test copy opens nothing: it would open " + (what === "mail" ? "an email to " + (tpData.page.mail || "") : r.url) + ".", false); return; }
    showStrip(what === "mail" ? "Your email app should open now, with Xsegon's version in the email. If nothing opens, Copy the address and write from any email."
                              : "Opening " + ((b && b.textContent) || "it").replace(/^[▶\s]+/, "").trim() + " in your browser.", false);
  });
}

function tpTell(id, b) {
  var on = !(tpData.tell || {})[id], name = b.getAttribute("data-name");
  postJson("api/tumultuous.php", { tell: id, on: on }).then(function (r) {
    if (!r || !r.ok) { showStrip("Not kept: " + ((r && r.error) || "no answer from Xsegon"), true); return; }
    tpData.tell = r.tell || {};
    var fresh = tpTellButton({ id: id, name: name });
    b.replaceWith(fresh);
    tpMark(fresh, false);
    showStrip(on ? "Xsegon will say so in Messages when " + name + " is out." : "No message when " + name + " is out.", false);
  });
}

/* ---- the controller and the arrows ------------------------------------ */

function tpButtons() {
  return [...TP.scroll.querySelectorAll("[data-do]")].filter(function (b) { return b.getClientRects().length > 0; });
}

function tpMark(b, byPointer) {
  if (tpAt) { tpAt.classList.remove("tp-at"); }
  tpAt = b || null;
  if (!tpAt) { return; }
  if (!byPointer) { tpAt.classList.add("tp-at"); tpAt.scrollIntoView({ block: "nearest" }); }
}

// The nearest button that way, by where it stands on screen; past the last one, the page itself scrolls on.
function tpStep(dx, dy) {
  var all = tpButtons();
  if (!tpAt || all.indexOf(tpAt) < 0) { tpMark(all[0], false); return; }
  var from = tpAt.getBoundingClientRect(), cx = from.left + from.width / 2, cy = from.top + from.height / 2, best = null, bestD = Infinity;
  all.forEach(function (b) {
    if (b === tpAt) { return; }
    var r = b.getBoundingClientRect(), ddx = r.left + r.width / 2 - cx, ddy = r.top + r.height / 2 - cy;
    if ((dx && Math.sign(ddx) !== dx) || (dy && Math.sign(ddy) !== dy) || (dx && Math.abs(ddx) < 2) || (dy && Math.abs(ddy) < 2)) { return; }
    var d = dy ? Math.abs(ddy) + Math.abs(ddx) * 2.5 : Math.abs(ddx) + Math.abs(ddy) * 2.5;
    if (d < bestD) { bestD = d; best = b; }
  });
  if (best) { sound("move"); tpMark(best, false); }
  else if (dy) { TP.scroll.scrollBy({ top: dy * 160 }); }
}

function tpPress() {
  if (tpAt && tpAt.getClientRects().length) { tpAt.click(); }
}

/* The keys while the page is up: arrows walk the buttons, Enter presses one,
   Q and E (or Page Up and Down) change tab, Esc goes back. Answers whether the key was the page's. */
export function tpKeys(e) {
  if (!tpOpen()) { return false; }
  var k = e.key;
  if (k === "ArrowRight") { tpStep(1, 0); }
  else if (k === "ArrowLeft") { tpStep(-1, 0); }
  else if (k === "ArrowDown") { tpStep(0, 1); }
  else if (k === "ArrowUp") { tpStep(0, -1); }
  else if (k === "Enter" || k === " ") { tpPress(); }
  else if (k === "q" || k === "Q" || k === "PageUp") { if (tpData) { tpShowTab("help"); } }
  else if (k === "e" || k === "E" || k === "PageDown") { if (tpData) { tpShowTab("games"); } }
  else if (k === "Home") { TP.scroll.scrollTop = 0; }
  else if (k === "End") { TP.scroll.scrollTop = TP.scroll.scrollHeight; }
  else if (k === "Escape" || k === "Backspace") { closeTpPage(); }
  else { return true; }
  e.preventDefault();
  return true;
}

/* The pad while the page is up: the cross walks the buttons (held, it steps on),
   A presses, LB and RB change tab, B goes back. Answers the buttons as they stand. */
export function tpPad(k, prev) {
  var d = k.right ? [1, 0] : k.left ? [-1, 0] : k.down ? [0, 1] : k.up ? [0, -1] : null;
  var key = d ? d.join() : "", now = Date.now(), padSet = S.controller || {};
  if (!d) { tpPadAt = 0; }
  else if (key !== prev.fd) { tpStep(d[0], d[1]); tpPadAt = now + (padSet.repeatDelayMs || 400); }
  else if (now >= tpPadAt) { tpStep(d[0], d[1]); tpPadAt = now + (padSet.repeatRateMs || 110); }
  if (k.a && !prev.a) { tpPress(); }
  if (k.lb && tpData) { tpShowTab("help"); }
  if (k.rb && tpData) { tpShowTab("games"); }
  if (k.b && !prev.b) { closeTpPage(); }
  return { a: k.a, b: k.b, fd: key };
}

/* ---- the rain behind the banner's words, as the website has it ------ */

// Dim falling digits on the shown tab's banner; still when Animations is off or the page is away.
function tpRain() {
  TP.rain.forEach(function (r) { r.stop = true; });
  TP.rain = [];
  if (!tpOpen() || !TP.tabs || !TP.tabs[tpTab]) { return; }
  var cv = TP.tabs[tpTab].querySelectorAll(".tp-banner canvas");
  if (cv.length < 2) { return; }
  var still = $body.classList.contains("no-anim") || document.hidden, FS = 16;
  var glyphs = "0101010101011010アイウエオカキクケコサシスセソタチツテトナニヌネノ0110";
  var glyph = function () { return glyphs[Math.random() * glyphs.length | 0]; };
  var w = cv[0].clientWidth, h = cv[0].clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2), run = { stop: false };
  var ctx = cv[0].getContext("2d"), hx = cv[1].getContext("2d");
  [[cv[0], ctx], [cv[1], hx]].forEach(function (c) {
    c[0].width = w * dpr; c[0].height = h * dpr;
    c[1].setTransform(dpr, 0, 0, dpr, 0, 0); c[1].font = FS + "px Consolas, monospace"; c[1].textBaseline = "top";
  });
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
  var rows = h / FS, cols = [];
  for (var i = 0; i < Math.ceil(w / FS); i++) { cols.push({ y: -rows + Math.random() * rows * 2, v: 3 + Math.random() * 4, row: -1, ch: glyph() }); }
  if (still) {
    for (var x = 0; x < w; x += FS) { for (var y = 0; y < h; y += FS) { if (Math.random() < 0.3) { ctx.fillStyle = "rgba(34, 211, 238, " + (0.03 + Math.random() * 0.08).toFixed(3) + ")"; ctx.fillText(glyph(), x, y); } } }
    return;
  }
  function step(dt) {
    ctx.fillStyle = "rgba(0, 0, 0, " + Math.min(1, dt * 1.6).toFixed(3) + ")"; ctx.fillRect(0, 0, w, h);
    cols.forEach(function (c, n) {
      c.y += c.v * dt;
      var cell = Math.floor(c.y);
      if (cell !== c.row) { if (c.row >= 0) { ctx.fillStyle = "rgba(34, 211, 238, .13)"; ctx.fillText(c.ch, n * FS, c.row * FS); } c.row = cell; c.ch = glyph(); }
      if (c.y * FS > h + FS && Math.random() < 0.02) { c.y = -Math.random() * 10; c.row = -1; c.v = 3 + Math.random() * 4; }
    });
  }
  for (var n = 0; n < 150; n++) { step(1 / 30); }                 // it opens mid-rain
  var last = 0;
  function tick(t) {
    if (run.stop) { return; }
    var dt = last ? Math.min(0.1, (t - last) / 1000) : 1 / 60;
    last = t;
    step(dt);
    hx.clearRect(0, 0, w, h);
    hx.fillStyle = "rgba(165, 243, 252, .3)";
    cols.forEach(function (c, m) { if (c.y >= 0) { hx.fillText(c.ch, m * FS, c.y * FS - FS); } });
    requestAnimationFrame(tick);
  }
  TP.rain.push(run);
  requestAnimationFrame(tick);
}
