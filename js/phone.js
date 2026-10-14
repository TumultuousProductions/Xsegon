/*  Connect a phone...: the page a phone on the home Wi-Fi opens to browse the games and
    start one on this PC (includes\phone.php, router-phone.php). The window holds the switch,
    the square a phone's camera reads, what Windows allows, and the phones let in. */

import { setEditorOnClose, toolFrame } from "./editors.js";
import { iconEl } from "./icons.js";
import { setPick, showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { qrMatrix } from "./qr.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { el } from "./util.js";

var PH_LOOK_MS = 5000;          // how often the window asks how things stand
var PH_SQUARE_MS = 100000;      // a new square before the old one's two minutes are up
var PH_STAYS = { on: "until you switch it off", close: "until Xsegon closes", idle: "until no phone has used it for 30 minutes" };

var ph = null;                  // the window while it is up: the server's answer, Windows' answer, its lines
var $phMark = document.getElementById("phone-mark");

function phMine() {
  return !!ph && !$editor.hidden && $editor.dataset.tool === "phone";
}
function phMark(on) {
  if ($phMark) { $phMark.hidden = !on; }
}

export function openPhone() {
  L("ED", "phone");
  stopVideo();
  api("api/phone.php?square=1").then(function (res) {
    if (!res.ok) { showStrip(res.error || "the phone page could not be read", true); return; }
    if (ph) { clearInterval(ph.timer); }
    ph = { res: res, win: null, lines: [], runs: [], at: -1, drawn: Date.now(), asking: 0, timer: setInterval(phLook, PH_LOOK_MS) };
    phMark(res.on);
    phPaint();
    phWindows();
  });
}

// What Windows allows: asked apart, since it takes Windows a few seconds to say.
function phWindows() {
  if (!ph || !ph.res.on) { return; }
  api("api/phone.php?windows=1").then(function (res) {
    if (!phMine() || !res.ok || !res.windows) { return; }
    if (ph.win && ph.win.open === false && res.windows.open) { L("PHONE", "Windows now lets phones in"); ph.asking = 0; }
    var first = !ph.win;
    ph.win = res.windows;
    L("PHONE", "Windows: " + res.windows.why + (res.windows.told ? " (Windows' own list names it " + res.windows.told + ")" : ""));
    phPaint();
    // Switched on and Windows says no: its question is brought up at once, not left for a button to be found.
    // Not for a No given to Windows' own question: the shield question cannot take that one back.
    if (first && ph.justOn && res.windows.open === false && !res.windows.told) { ph.justOn = false; phAllow(); }
  });
}

function phLook() {
  if (!phMine()) { return; }
  var due = ph.res.on && (!ph.res.link || Date.now() - ph.drawn > PH_SQUARE_MS);
  api("api/phone.php" + (due ? "?square=1" : "")).then(function (res) {
    if (!phMine() || !res.ok) { return; }
    // A phone that joined has used the square up: the next look draws a new one.
    var joined = res.phones.length > ph.res.phones.length;
    if (res.link) { ph.drawn = Date.now(); } else if (res.on && res.up && !joined) { res.link = ph.res.link; }
    if (joined) { sound("ok"); }
    var same = JSON.stringify(res) === JSON.stringify(ph.res);
    ph.res = res;
    phMark(res.on);
    if (!same) { phPaint(); }
    if (ph.asking > 0) { ph.asking--; phWindows(); }
  });
}

// Look again, after a No was taken back in Windows' own list: asked at a press, since Windows takes seconds to say.
function phLookAgain() {
  showStrip("Asking Windows what it allows...", false);
  phWindows();
}

// The way to take back a No given to Windows' own "Allow access?" question, by the name Windows' list has it under.
function phUndo(win) {
  var which = win.kind === "Private" || win.kind === "Public" ? "its " + win.kind + " box" : "the box for this network";
  return "Windows was told No for this program, most likely with Cancel on its own \"Allow access?\" question, and Ask Windows cannot take that back. "
    + "In Windows, open Windows Security > Firewall & network protection > Allow an app through firewall. Press Change settings, find "
    + win.told + " in the list, select " + which + " and press OK. Then press Look again here, and the square comes.";
}

function phSwitch() {
  var to = ph.res.on ? "off" : "on";
  postJson("api/phone.php", { op: to }).then(function (res) {
    if (!res.ok) { showStrip(res.error || "the switch could not be saved", true); return; }
    if (!phMine()) { return; }
    L("PHONE", "the switch: " + to);
    sound("select");
    ph.res = res;
    ph.win = null;
    ph.justOn = res.on;
    phMark(res.on);
    phPaint();
    phWindows();
  });
}

function phAllow() {
  postJson("api/phone.php", { op: "allow" }).then(function (res) {
    if (!res.ok || !res.asked) { showStrip("Windows could not be asked", true); return; }
    showStrip("Windows is asking: press Yes on its shield question. If nothing comes up, press the Windows key and look for a shield in the taskbar.", false);
    if (ph) { ph.asking = 12; }
  });
}

function phForget(id, name) {
  postJson("api/phone.php", { op: "forget", id: id || "" }).then(function (res) {
    if (!res.ok) { showStrip(res.error || "it could not be removed", true); return; }
    if (!phMine()) { return; }
    showStrip(id ? name + " is no longer let in" : "No phone is let in any more", false);
    res.link = ph.res.link;
    ph.res = res;
    phPaint();
  });
}

// The link as a square. Black on white whatever the theme: it is for a camera, not for the eye.
function phSquare(link) {
  var m = qrMatrix(link);
  if (!m) { return el("p", "mt-note bad", "The link is too long to draw as a square."); }
  var NS = "http://www.w3.org/2000/svg", edge = 4, side = m.length + edge * 2, d = "";
  var svg = document.createElementNS(NS, "svg"), back = document.createElementNS(NS, "rect"), dots = document.createElementNS(NS, "path");
  m.forEach(function (line, y) { line.forEach(function (dark, x) { if (dark) { d += "M" + (x + edge) + " " + (y + edge) + "h1v1h-1z"; } }); });
  svg.setAttribute("viewBox", "0 0 " + side + " " + side);
  svg.setAttribute("class", "ph-square");
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.dataset.cells = String(m.length);
  back.setAttribute("width", side); back.setAttribute("height", side); back.setAttribute("fill", "#fff");
  dots.setAttribute("d", d); dots.setAttribute("fill", "#000");
  svg.appendChild(back);
  svg.appendChild(dots);
  return svg;
}

function phBox(inner, name) {
  var box = el("div", "pj-sect");
  box.appendChild(el("div", "pj-head", name));
  inner.appendChild(box);
  return box;
}

// One line: an icon, what it is and how it stands, and a small button at the right where there is something to press.
function phLine(box, icon, label, hint, caption, run) {
  var i = ph.lines.length, r = el("div", "pj-row"), words = el("div", "pj-words");
  r.appendChild(iconEl("opt-ico", icon));
  words.appendChild(el("span", "pj-job", label));
  words.appendChild(el("span", "pj-hint", hint));
  r.appendChild(words);
  if (run) {
    var set = el("button", "pj-set", caption);
    set.type = "button";
    set.addEventListener("click", function () { phBar(i); run(); });
    r.appendChild(set);
  }
  r.addEventListener("mousemove", function () { if (ph && ph.at !== i) { phBar(i); } });
  box.appendChild(r);
  ph.lines.push(r);
  ph.runs.push(run || null);
  return r;
}

function phBar(i) {
  if (!ph || !ph.lines.length) { return; }
  ph.at = Math.max(0, Math.min(ph.lines.length - 1, i));
  ph.lines.forEach(function (r, k) { r.classList.toggle("at", k === ph.at); });
  ph.lines[ph.at].scrollIntoView({ block: "nearest" });
}

function phPaint() {
  var res = ph.res, win = ph.win, open = res.on && res.up;
  setEditorOnClose(function () { if (ph) { clearInterval(ph.timer); } ph = null; });
  $editor.textContent = "";
  $editor.dataset.tool = "phone";
  var inner = toolFrame("CONNECT A PHONE", { cls: "vp-inner", close: "Close (esc)", keep: true });
  inner.appendChild(el("p", "group-help",
    "A phone on the home Wi-Fi can open a page of your games and start one on this PC. Nothing is installed on the phone, and it needs no internet. "
    + "It is closed until you switch it on here."));
  $editor.appendChild(inner);
  $editor.hidden = false;
  ph.lines = [];
  ph.runs = [];

  var page = phBox(inner, "The phone page");
  phLine(page, "phone", "Phone page",
    !res.on ? "Closed. Nothing on this PC is open to the home network."
      : open ? "Open at " + res.address + ":" + res.port + ", on the home network only. It stays open " + (PH_STAYS[res.stays] || PH_STAYS.on) + " (Settings > Window)."
      : (res.why || "The phone page is starting."),
    res.on ? "Switch off" : "Switch on", phSwitch);

  if (res.on) {
    var w = phBox(inner, "Windows");
    phLine(w, "shield", "What Windows allows",
      !win ? "Asking Windows what it allows..."
        : win.told ? win.why + ". Only Windows' own list takes that back: the way is under Let a phone in."
        : win.open === false ? win.why + ". A phone is shut out until Windows says yes: one shield question, asked once."
        : win.why + ".",
      win && win.told ? "Look again" : "Ask Windows", win && win.told ? phLookAgain : win && win.open === false ? phAllow : null);
  }

  // No square while Windows would shut the phone out: a scan that cannot work is not offered.
  if (res.on && win && win.told) {
    phBox(inner, "Let a phone in").appendChild(el("p", "mt-note ph-wait warn", phUndo(win)));
  } else if (open && res.link && (!win || win.open === false)) {
    phBox(inner, "Let a phone in").appendChild(el("p", "mt-note ph-wait" + (win ? " warn" : ""), !win
      ? "The square comes once Windows has said what it allows."
      : "Windows is shutting phones out, so there is no square to scan yet. Press Ask Windows above and say Yes to its shield question: the square comes by itself."));
  } else if (open && res.link) {
    var join = phBox(inner, "Let a phone in"), hold = el("div", "ph-join"), words = el("div", "ph-words");
    hold.appendChild(phSquare(res.link));
    words.appendChild(el("p", null, "Point the phone's camera at the square and tap the link it shows. The phone has to be on the home Wi-Fi."));
    words.appendChild(el("p", "mt-note", "A square works once, for two minutes, and a new one is drawn by itself. A phone let in stays let in: next time it only opens its bookmark."));
    if (win.open === null) { words.appendChild(el("p", "mt-note warn", "Windows would not say what it allows. If the phone cannot open the link, Windows' firewall is the first thing to look at.")); }
    hold.appendChild(words);
    join.appendChild(hold);
  }

  var list = phBox(inner, "Phones let in");
  if (!res.phones.length) { list.appendChild(el("p", "mt-note ph-none", "None yet.")); }
  res.phones.forEach(function (p) {
    phLine(list, "phone", p.name, "let in " + new Date(p.added * 1000).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
      "Remove", function () { phForget(p.id, p.name); });
  });
  if (res.phones.length > 1) {
    phLine(list, "x", "Every phone", "Each one has to scan the square again to come back.", "Forget all", function () { phForget("", ""); });
  }
  inner.appendChild(el("p", "mt-note", "A phone let in can see your games' names and pictures and start one. It cannot reach your settings, your files or anything else on this PC. "
    + "What passes between a phone and this PC is not encrypted: let in the phones of people you would hand the controller to."));

  // Nothing is lit until the person moves: the keys start from above the first line.
  var at = ph.at;
  ph.at = -1;
  setPick({ cells: ph.lines, at: 0,
    move: function (d) { if (ph) { phBar(ph.at + d); sound("move"); } },
    choose: function () { if (ph && ph.runs[ph.at]) { ph.runs[ph.at](); } } });
  if (at >= 0 && phMine()) { phBar(at); }
}

// The mark in the top row: there while the page is open, and a press on it is this window.
if ($phMark) {
  phMark(!!(window.XSEGON && window.XSEGON.phoneOn));
  $phMark.addEventListener("click", openPhone);
}
