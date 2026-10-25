/*  What changed while you were away, and the mailbox it is kept in.
 *
 *    games arrived  ->  a toast, bottom right, that fades by itself.
 *    games or their
 *    files are gone ->  the amber strip at the top, beside "ROMs not plugged
 *                       in": something you would otherwise find out by pressing Play.
 *    everything else->  the mailbox in the masthead, with a dot until read.
 *
 *  Messages are a list on the server with a kind and a read flag.
 */

import { openAccSettle } from "./accsettle.js";
import { openArchiveManuals } from "./archivedoc.js";
import { openArchiveVideos } from "./archivevid.js";
import { openBiosCheck } from "./bios.js";
import { askCheatLists } from "./cheatlists.js";
import { openFillTool } from "./fill.js";
import { showStrip } from "./launch.js";
import { load } from "./library.js";
import { L, api, postJson } from "./log.js";
import { getRetroArch, raLabel } from "./raoffer.js";
import { openScanTool } from "./scan.js";
import { openScreenScraper } from "./screenscraper.js";
import { sound } from "./sound.js";
import { setViewMode } from "./state.js";
import { chooseSystem } from "./systems.js";
import { openReportTool } from "./tools.js";
import { openTpPage } from "./tppage.js";
import { pressUpdate } from "./updaterow.js";
import { closeOnBackdrop, el } from "./util.js";

var DOT = document.getElementById("mail-dot");
var BTN = document.getElementById("btn-mail");
var TOASTS = document.getElementById("toasts");
var GUARD = document.getElementById("guard-news");

/* ---------- the toast ---------- */

export function toast(title, lines, seconds) {
  if (!TOASTS) { return null; }
  var t = el("div", "toast");
  var head = el("div", "toast-head");
  head.appendChild(el("strong", null, title));
  var x = el("button", "toast-x", "✕");
  x.type = "button";
  x.title = "Dismiss";
  x.addEventListener("click", function () { drop(t); });
  head.appendChild(x);
  t.appendChild(head);
  (lines || []).forEach(function (line) { t.appendChild(el("p", "toast-line", line)); });
  TOASTS.appendChild(t);
  // Read at a distance: long enough for a list of names, not so long that it
  // is still there when you have started doing something else.
  var wait = (seconds || 9) * 1000;
  setTimeout(function () { drop(t); }, wait);
  return t;
}

function drop(t) {
  if (!t || !t.parentNode) { return; }
  t.classList.add("going");
  setTimeout(function () { if (t.parentNode) { t.parentNode.removeChild(t); } }, 260);
}

/* ---------- the amber strip ---------- */

/* Games that are listed but whose file is not on the disk, and games that
   were here last time and are not now. Same area as the ROM drive warning
   and the same amber, because it is the same question: what will not play,
   and why, before you find out by pressing Play.

   The warning names NOBODY: on a screen anyone can see, titles would read out
   what you own. The strip says how many and where to read the rest; the names
   live in the mailbox, which you open on purpose. */
function paintGone(res) {
  if (!GUARD) { return; }
  GUARD.textContent = "";
  var rows = (res.missing || []).concat(res.gone || []);
  if (!rows.length) { return; }

  // Cleared stays cleared until the news itself changes: the signature is
  // the ids, so a NEW missing game brings the warning back rather than
  // being swallowed by a dismissal from last week.
  var sig = rows.map(function (r) { return r.id || r.line; }).sort().join("|");
  try {
    if (localStorage.getItem("xs-missing-cleared") === sig) { return; }
  } catch (e) { /* private window: just show it */ }

  var missingN = (res.missing || []).length;
  var goneN = (res.gone || []).length;
  var box = el("div", "guardrail amber");
  var what = [];
  if (missingN) { what.push(missingN + (missingN === 1 ? " potential missing game" : " potential missing games")); }
  if (goneN) { what.push(goneN + (goneN === 1 ? " game no longer listed" : " games no longer listed")); }
  box.appendChild(el("strong", null, what.join(", ")));
  box.appendChild(el("span", null,
    "Nothing has been deleted. Open Messages to see which ones and what to do about them."));

  var bar = el("div", "g-acts");
  var show = el("button", null, "Show");
  show.type = "button";
  show.addEventListener("click", function () { openMail(); });
  var clear = el("button", null, "Clear");
  clear.type = "button";
  clear.title = "Hide this. It stays in Messages.";
  clear.addEventListener("click", function () {
    try { localStorage.setItem("xs-missing-cleared", sig); } catch (e) { /* fine */ }
    L("NEWS", "warning cleared (" + rows.length + ")");
    GUARD.textContent = "";
    // Clearing the warning counts as having read it. The message itself
    // stays in the mailbox, which is the whole point of having one.
    postJson("api/news.php", { action: "read" }).then(function () { setDot(0); });
  });
  bar.appendChild(show);
  bar.appendChild(clear);
  box.appendChild(bar);
  GUARD.appendChild(box);
}

/* ---------- the mailbox ---------- */

function setDot(unread) {
  if (!DOT) { return; }
  DOT.hidden = !unread;
  if (unread) { DOT.textContent = unread > 9 ? "9+" : String(unread); }
  if (BTN) { BTN.title = unread ? unread + " unread" : "Messages"; }
}

/* A message written while the page is open (the automatic Runs check's
   BIOS note): the dot is read again, since nothing else would light it. */
export function mailArrived() {
  api("api/news.php").then(function (r) { if (r.ok) { setDot(r.unread); } });
}

/* The page's poll heard how many are unread (trouble is kept on the server
   as it happens, includes\news.php). Not while the mailbox is open: opening
   it is reading it. */
export function mailUnread(n) {
  if (!mailOpen()) { setDot(n || 0); }
}

var $mail = null;
var mailShow = "all";                    // what the mailbox lists: all, error or info

/* Where a message's buttons go, by the names includes\tips.php and
   includes\archivevid.php give them: the words on the button, and the press. */
var MAIL_GOES = {
  accompanied: ["Look at these files...", function () { openAccSettle(); }],
  archivevid: ["Videos from online archives...", function () { openArchiveVideos(); }],
  archivedoc: ["Manuals from online archives...", function () { openArchiveManuals(); }],
  cheatlists: ["Get the cheat lists...", function () { askCheatLists(); }],
  fillcheck: ["Check these games...", function (m) { openFillTool(null, false, (m.ids || []).map(String)); }],
  // A newer Xsegon (includes\update.php): asks first, downloads it if need be, then put in place as Xsegon starts again.
  updatenow: ["Update now...", function () { pressUpdate("update"); }],
  // A newer Xsegon (includes\newversion.php): its release page, in a window of its own. Only that page.
  newversion: ["Open its page", function (m) {
    var page = String(m.url || "");
    if (page.indexOf("https://github.com/TumultuousProductions/Xsegon/releases/") !== 0) { page = "https://github.com/TumultuousProductions/Xsegon/releases/latest"; }
    window.open(page, "_blank", "noopener");
  }],
  // A fault of Xsegon's own, where the details go (bin\update-switch.php): Help > Report a problem.
  report: ["Report a problem...", function () { openReportTool(); }],
  // New games left out for want of an emulator RetroArch would be (includes\newgames.php xs_ng_tell).
  rasetup: [raLabel("setup"), function () { getRetroArch("a message"); }],
  raget: [raLabel("get"), function () { getRetroArch("a message"); }],
  rause: [raLabel("use"), function () { getRetroArch("a message"); }],
  scan: ["Scan for Games...", function () { openScanTool(); }],
  screenscraper: ["ScreenScraper videos...", function () { openScreenScraper(); }],
  // A message kept from before 2026-10-17 still names the Skraper steps, which are gone: it gets the same press.
  skraper: ["ScreenScraper videos...", function () { openScreenScraper(); }],
  // A game asked of on Tumultuous Productions' page is out (includes\tumultuous.php).
  tumultuous: ["Tumultuous Productions...", function () { openTpPage(); }]
};

function mailPost(body) {
  return postJson("api/news.php", body);
}

/* For the strip's Clear on a piece of trouble (js\launch.js showStrip): you
   saw it, so its message in the mailbox is read. key as includes\news.php
   keeps it: "launch:<game id>", "job:fill", "damaged:<file>". */
export function troubleSeen(key) {
  return function () {
    mailPost({ action: "read", key: key }).then(function (r) { if (r && r.ok) { mailUnread(r.unread); } });
  };
}

/* Trouble that happened by itself (a failed launch, a job that stopped, a
   file that will not read) against plain news: the two the list can be
   narrowed to. */
function isError(m) { return m.level === "error"; }

export function openMail() {
  sound("select");
  L("NEWS", "mailbox opened");
  if (!$mail) {
    $mail = el("div", "mailbox");
    $mail.id = "mailbox";
    document.body.appendChild($mail);
    closeOnBackdrop($mail, closeMail);
  }
  $mail.hidden = false;
  $mail.textContent = "";
  var panel = el("div", "mail-panel");
  $mail.appendChild(panel);
  paintMail(panel, null);

  api("api/news.php").then(function (r) {
    if (!r.ok) {
      // A failed read must not look like an empty mailbox.
      paintMail(panel, null, "The messages could not be read: " + (r.error || "the server did not answer") + ".");
      return;
    }
    paintMail(panel, r.messages);
    // Opening it IS reading it: a dot that outlives the look is a nag.
    if (r.unread) {
      mailPost({ action: "read" }).then(function () { setDot(0); });
    }
  });
}

/* The mailbox itself. msgs null: not read yet, or not readable (failedWords).
   Painted again after a filter, a delete or a clear, from what the server
   answered, with no second read. */
function paintMail(panel, msgs, failedWords) {
  panel.textContent = "";
  var all = msgs || [];
  var shown = all.filter(function (m) { return mailShow === "all" || (mailShow === "error") === isError(m); });
  function took(r) {
    if (!r.ok) { showStrip("the messages were not changed: " + (r.error || "no answer"), true); return; }
    setDot(r.unread || 0);
    paintMail(panel, r.messages || []);
  }

  var head = el("div", "mail-head");
  head.appendChild(el("h2", "panel-title", "MESSAGES"));
  if (shown.length) {
    var clear = el("button", "mail-clear", mailShow === "all" ? "Clear all" : mailShow === "error" ? "Clear errors" : "Clear info");
    clear.type = "button";
    clear.addEventListener("click", function () {
      L("NEWS", "clear " + mailShow + " (" + shown.length + ")");
      mailPost(mailShow === "all" ? { action: "clear" } : { action: "clear", level: mailShow }).then(took);
    });
    head.appendChild(clear);
  }
  var done = el("button", "primary", "Done (esc)");
  done.type = "button";
  done.addEventListener("click", closeMail);
  head.appendChild(done);
  panel.appendChild(head);

  if (failedWords) { panel.appendChild(el("p", "mt-note bad", failedWords)); return; }
  if (!msgs) { return; }
  if (!all.length) {
    panel.appendChild(el("p", "mt-note", "Nothing to report. This is where Xsegon leaves what happens without you: a game that would not start, a download that stopped, games that arrived, games whose files have gone."));
    return;
  }

  var errors = all.filter(isError).length;
  var chips = el("div", "mail-chips");
  [["all", "All", all.length], ["error", "Errors", errors], ["info", "Info", all.length - errors]].forEach(function (c) {
    var chip = el("button", "mail-chip" + (mailShow === c[0] ? " on" : "") + (c[0] === "error" && c[2] ? " bad" : ""), c[1] + "  " + c[2]);
    chip.type = "button";
    chip.dataset.show = c[0];
    chip.addEventListener("click", function () { mailShow = c[0]; paintMail(panel, all); });
    chips.appendChild(chip);
  });
  panel.appendChild(chips);
  if (!shown.length) {
    panel.appendChild(el("p", "mt-note", mailShow === "error" ? "No errors." : "Nothing but errors here."));
  }

    // rowEl, never `row`: a local of that name reads as views.js's exported
    // row() to tools\js-imports.js, which writes an import for it.
    shown.forEach(function (m) {
      var rowEl = el("div", "mail-row " + (m.kind || "info") + (isError(m) ? " error" : "") + (m.read ? "" : " unread"));
      var top = el("div", "mail-row-head");
      top.appendChild(el("strong", null, m.title || ""));
      top.appendChild(el("span", "mail-when", when(m.at) + (m.times > 1 ? ", " + m.times + " times" : "")));
      var x = el("button", "mail-x", "✕");
      x.type = "button";
      x.title = "Delete this message";
      x.addEventListener("click", function () {
        L("NEWS", "delete a message: " + (m.title || ""));
        mailPost({ action: "delete", id: m.id }).then(took);
      });
      top.appendChild(x);
      rowEl.appendChild(top);
      if (m.body) { rowEl.appendChild(el("p", "mail-body", m.body)); }
      (m.items || []).forEach(function (line) { rowEl.appendChild(el("p", "mail-item", line)); });
      if (m.n && m.items && m.n > m.items.length) {
        rowEl.appendChild(el("p", "mail-item more", "and " + (m.n - m.items.length) + " more"));
      }
      /* "Show these games": the message carries a collection name, and a
         collection is already "exactly these games, in any view, with the
         sort and the search still working". So this is one parameter, not
         a screen of its own. */
      if (m.show) {
        var go = el("button", "mail-show", OPENS[m.show] || "Show these games in a list");
        go.type = "button";
        go.addEventListener("click", function () { showCollection(m.show); });
        rowEl.appendChild(go);
      }
      // A message about BIOS files opens the screen that sees to them.
      if (m.open === "bios") {
        var see = el("button", "mail-show", "Open the BIOS check");
        see.type = "button";
        see.addEventListener("click", function () { $mail.hidden = true; openBiosCheck(); });
        rowEl.appendChild(see);
      }
      // One that points somewhere has a button for each place (MAIL_GOES).
      (m.opens || []).forEach(function (where) {
        var to = MAIL_GOES[where];
        if (!to) { return; }
        var press = el("button", "mail-show", to[0]);
        press.type = "button";
        press.addEventListener("click", function () { $mail.hidden = true; L("NEWS", "opened from a message: " + where); to[1](m); });
        rowEl.appendChild(press);
      });
      panel.appendChild(rowEl);
    });
}

export function closeMail() {
  if (!$mail) { return; }
  $mail.hidden = true;
  sound("back");
}

export function mailOpen() { return !!$mail && !$mail.hidden; }

/* Open one collection as a plain list.

   chooseSystem() is the same door the consoles rim uses, so this needs no
   machinery of its own: it leaves the wall, sets the one parameter, reads
   again and refuses an empty collection with its reason. The view is set
   first so the games land in a list, which is what a list of things to fix
   wants to be. New games and new videos are to play and watch: those open
   in the view you have, under the collection's own name. */
var OPENS = { "@added": "Open Recently added", "@changed": "Open Recently changed" };
function showCollection(key) {
  closeMail();
  L("NEWS", "show " + key);
  if (!OPENS[key]) { setViewMode("list"); }
  /* The library is read again FIRST: the collection this message points at
     is usually newer than the page's last read, and without it chooseSystem
     falls through to every game. The fresh read carries @missing and
     repaints the dropdown; then this door works like any other. */
  load({ noDraw: true }).then(function () { chooseSystem(key); });
}

function when(iso) {
  if (!iso) { return ""; }
  var then = new Date(iso), now = new Date();
  var mins = Math.round((now - then) / 60000);
  if (mins < 1) { return "just now"; }
  if (mins < 60) { return mins + (mins === 1 ? " minute ago" : " minutes ago"); }
  var hrs = Math.round(mins / 60);
  if (hrs < 24) { return hrs + (hrs === 1 ? " hour ago" : " hours ago"); }
  return then.toISOString().slice(0, 10);
}

/* ---------- the startup look ---------- */

export function checkNews() {
  return api("api/news.php?check=1").then(function (r) {
    if (!r || !r.ok) { return; }
    setDot(r.unread || 0);
    paintGone(r);
    L("NEWS", "checked: " + (r.added || []).length + " added, " + (r.gone || []).length +
      " gone, " + (r.missing || []).length + " files missing" + (r.first ? " (first look)" : ""));
    if ((r.added || []).length) {
      var lines = r.added.slice(0, 5).map(function (a) { return a.line; });
      if (r.added.length > 5) { lines.push("and " + (r.added.length - 5) + " more"); }
      toast(r.added.length === 1 ? "1 game added" : r.added.length + " games added", lines);
    }
  });
}

/* Wired from main.js, not here: a module that puts up a listener as it loads
   is a module whose import order changes behaviour, and the suite refuses
   one (tests\run.js, the modules group). */
export function wireMail() {
  if (!BTN) { return; }
  BTN.addEventListener("click", function () { if (mailOpen()) { closeMail(); } else { openMail(); } });
}
