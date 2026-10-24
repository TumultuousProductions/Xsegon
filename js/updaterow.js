/*  A new version of Xsegon (api\update.php): the press behind Update now and
 *  Go back, for the mailbox's button and Settings > Window > New versions, and
 *  the row on that page saying what this copy is and what is waiting.
 *
 *  Update now asks first, in a window that also asks whether the next new
 *  versions download by themselves, and, when the version brings a newer PHP and
 *  Settings still offers it, whether to take that too (unticked: it never comes
 *  otherwise; left unticked, what that means is said, with the way to the
 *  switch). One not downloaded yet is got ready in the
 *  background with a bar in the corner, then put in place. A press takes a
 *  backup of the data and writes itself down; start.ps1 makes the switch with
 *  no server running. Where Xsegon was opened from Start Xsegon.bat the window
 *  closes and opens again by itself; anywhere else the switch waits for the
 *  next start, and the strip says so.
 */

import { windowOp } from "./appwindow.js";
import { confirmWindow } from "./confirm.js";
import { iconEl } from "./icons.js";
import { jobBar } from "./jobbars.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { saveSetting } from "./savednote.js";
import { gameRunning } from "./snap.js";
import { el } from "./util.js";

var STEP = { list: "getting its signed list", download: "downloading", check: "checking every file", try: "trying it once on its own" };
var following = null;
var openSetting = null;   // Settings at one setting; js\settings-ui.js imports this file, so it hands its opener over

export function setSettingOpener(fn) { openSetting = fn; }

// what: "update" or "back". Update now asks first; Go back goes at once.
export function pressUpdate(what) {
  return what === "update" ? askUpdate() : press("back");
}

/* The press itself. Answers the server's answer, after the strip has said it. */
function press(what) {
  showStrip("Taking a backup of your data first...");
  return postJson("api/update.php", { action: what }).then(function (r) {
    if (!r || !r.ok) {
      showStrip((what === "update" ? "The update was not started: " : "Going back was not started: ") + ((r && r.error) || "no answer") + ". Nothing changed.", true);
      return r;
    }
    var to = what === "update" ? r.ready : r.back;
    L("UPD", (what === "update" ? "Update now: " : "Go back: ") + to + (r.restarts ? ", the window closes and opens again" : ", at the next start"));
    if (r.restarts) {
      showStrip("Xsegon closes now, puts " + to + " in place and opens again in a few seconds.");
      setTimeout(function () { windowOp("close"); }, 2500);
    } else {
      showStrip(to + " goes in place the next time Xsegon starts: close Xsegon to do it now.");
    }
    return r;
  });
}

function mb(n) { return n > 0 ? n + " MB" : "a few MB"; }

function stepLine(f) {
  var line = STEP[f.step] || "starting";
  if (f.step === "download" && f.size > 0) { line += ", " + (f.got / 1048576).toFixed(1) + " of " + (f.size / 1048576).toFixed(1) + " MB"; }
  return line;
}

/* Update now: what happens, and the choice for the next versions, before anything is downloaded or changed. */
function askUpdate() {
  return api("api/update.php").then(function (r) {
    if (!r || !r.ok) { showStrip("Could not read which version is waiting: " + ((r && r.error) || "no answer"), true); return; }
    if (r.going) { showStrip("Waiting for Xsegon to close: the update happens as it starts again."); return; }
    if (r.cannot) { showStrip("This copy cannot update itself: " + r.cannot + ". Its page has the new version, to update by hand.", true); return; }
    var v = r.out ? r.out.version : r.ready;
    if (!v) { showStrip("No new version is waiting. Settings > Window > New versions says when Xsegon last looked."); return; }
    if (r.fetch && r.fetch.alive && r.fetch.version === v) {
      showStrip("Xsegon " + v + " is being downloaded: the bar in the corner shows how far it is.");
      follow(v);
      return;
    }
    var here = !r.out;     // downloaded, checked and tried already
    var phpTick = null;    // the newer PHP's box, drawn below when this version brings one; read when Update now is pressed
    L("UPD", "asked: update to " + v + (here ? ", ready" : ", not downloaded yet"));
    confirmWindow("Update to Xsegon " + v + "?", function (box) {
      box.appendChild(el("p", null, here
        ? v + " is downloaded, checked against the list its maker signed, and tried once on its own."
        : "Xsegon downloads it first (" + mb(r.out.mb) + "), checks it against the list its maker signed and tries it once on its own. The bar in the corner shows how far it is."));
      box.appendChild(el("p", null, "Then it takes a backup of your data, " + (r.restarts
        ? "closes, puts " + v + " in place and opens again."
        : "and " + v + " goes in place the next time Xsegon starts.") + (here ? "" : " A game you are playing is left to finish first.")));
      box.appendChild(el("p", "confirm-safe", "Your games, settings and pictures stay as they are. Settings > Window > New versions can go back to " + r.have + " afterwards."));
      // A newer PHP comes only when ticked here: never by itself, and never with the next versions that download by themselves.
      if (r.php && r.php.version && r.readyPhp !== r.php.version) {
        var plab = el("label", "confirm-pick");
        phpTick = el("input");
        phpTick.type = "checkbox";
        phpTick.checked = false;
        plab.appendChild(phpTick);
        plab.appendChild(document.createTextNode(" Also update PHP, the program Xsegon runs on, from " + r.php.have + " to " + r.php.version + " (" + mb(r.php.mb) + " more)"));
        box.appendChild(plab);
        box.appendChild(el("p", "confirm-note", "PHP's new versions carry its own fixes, some of them for security. It is checked and tried with "
          + v + " before anything changes, your PHP settings stay, and going back puts " + r.php.have + " back too."));
      } else if (here && r.readyPhp) {
        box.appendChild(el("p", "confirm-note", "PHP, the program Xsegon runs on, goes from " + (r.php ? r.php.have : "this one") + " to " + r.readyPhp + " with it, as you chose."));
      }
      var lab = el("label", "confirm-pick");
      var tick = el("input");
      tick.type = "checkbox";
      tick.checked = !!r.get;
      tick.addEventListener("change", function () {
        L("UPD", "download new versions by themselves: " + (tick.checked ? "on" : "off") + ", from the Update now window");
        saveSetting({ window: { getNewVersions: tick.checked } }, "Download new versions by themselves");
      });
      lab.appendChild(tick);
      lab.appendChild(document.createTextNode(" Download the next new versions by themselves, so Update now takes only a moment"));
      box.appendChild(lab);
      box.appendChild(el("p", "confirm-note", "Either way, nothing of Xsegon changes until you press Update now. Settings > Window > New versions has this choice too."));
    }, { label: "Update now", run: function () {
      var php = !!(phpTick && phpTick.checked);
      L("UPD", "Update now pressed for " + v + (phpTick ? ", the newer PHP " + (php ? "ticked" : "left out") : ""));
      // Left unticked: what keeping this PHP means is said first, with the way to the switch that stops the offer.
      if (phpTick && !php) { keepPhp(v, here, r.php); return; }
      updateTo(v, here, php);
    } }, "Not now",
       function () { L("UPD", "update to " + v + " put off"); });
  });
}

function updateTo(v, here, php) {
  // Got ready already without the PHP that was then ticked: got again, with it.
  if (here && !php) { press("update"); } else { getThenPress(v, php); }
}

/* The newer PHP left unticked: the update without it, Back to the Update now window, or the switch in Settings that stops the offer. */
function keepPhp(v, here, php) {
  L("UPD", "warned: " + v + " without PHP " + php.version + " keeps PHP " + php.have);
  var w = confirmWindow("Update without the newer PHP?", function (box) {
    box.appendChild(el("p", null, "Xsegon " + v + " runs on PHP " + php.have + " too, so nothing stops working. But PHP " + php.version
      + " has fixes that " + php.have + " does not, some of them for security."));
    box.appendChild(el("p", "confirm-safe", "You can take it at a later update by ticking it. Not wanting it offered at all? Switch off Offer a newer PHP "
      + "with new versions, in Settings > Window > New versions."));
  }, { label: "Update, keep PHP " + php.have, run: function () {
    L("UPD", "Update now: " + v + " keeping PHP " + php.have + ", as chosen after the warning");
    updateTo(v, here, false);
  } }, "Back", function () { askUpdate(); });
  var open = el("button", null, "Open that setting");
  open.addEventListener("click", function () {
    L("UPD", "warned: the PHP offer's setting opened, nothing updated");
    w.close();
    if (openSetting) { openSetting("window", "offerNewPhp"); }
  });
  w.box.querySelector(".confirm-bar").insertBefore(open, w.yes);
}

function getThenPress(v, php) {
  postJson("api/update.php", { action: "get", php: !!php }).then(function (r) {
    if (!r || !r.ok) { showStrip("Xsegon " + v + " was not downloaded: " + ((r && r.error) || "no answer") + ". Nothing changed.", true); return; }
    if (r.ready === v && !r.out && !(r.fetch && r.fetch.alive) && (!php || r.readyPhp)) { press("update"); return; }
    L("UPD", "Update now: getting " + v + " ready first" + (php ? ", with the newer PHP" : ""));
    showStrip("Downloading Xsegon " + v + ": the bar in the corner shows how far it is, and Xsegon updates when it is ready.");
    follow(v);
  });
}

/* One light read every 1.5 seconds until it is ready or has failed, painted as a corner bar; then the press. */
function follow(v) {
  if (following) { return; }
  var started = Math.floor(Date.now() / 1000), name = "Xsegon " + v;
  following = setInterval(function () {
    api("api/update.php").then(function (r) {
      if (!r || !r.ok || !following) { return; }   // a read that did not come: the next one asks again
      var f = r.fetch || {};
      if (f.alive && f.version === v) {
        jobBar({ key: "update", name: name, line: stepLine(f), frac: f.step === "download" && f.size > 0 ? Math.min(1, f.got / f.size) : null,
                 state: "running", started: started, stop: false });
        return;
      }
      clearInterval(following);
      following = null;
      if (r.ready === v) {
        jobBar({ key: "update", name: name, state: "done", started: started });
        L("UPD", v + " is ready after Update now" + (gameRunning ? ", put in place once the game is closed" : ""));
        whenNoGame(function () { press("update"); });
        return;
      }
      jobBar({ key: "update", name: name, state: "failed", started: started });
      L("UPD", "Update now: " + v + " was not got ready: " + (f.why || "it stopped"));
      showStrip(name + " was not got ready: " + (f.why || "it stopped") + ". Nothing of this copy changed; its page has it, to update by hand.", true);
    });
  }, 1500);
}

/* The window closes for the switch: never under a game being played. */
function whenNoGame(go) {
  if (!gameRunning) { go(); return; }
  showStrip("Xsegon's update is ready: it goes in place when your game is closed.");
  var t = setInterval(function () { if (!gameRunning) { clearInterval(t); go(); } }, 2000);
}

function day(iso) {
  var d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/* The last try at putting it in place, when it did not work (bin\update-switch.php failed.json). */
function tried(x) {
  return "The last try" + (day(x.at) ? ", " + day(x.at) + "," : "") + " did not work: " + (x.why || "no reason was given") + ".";
}

/* What the row says: this copy, the last look, and what is waiting or can be undone. */
function words(r) {
  if (!r.release) { return "This is " + r.have + ", not a copy from the release page (a tester's copy or a checkout), so it never looks for a newer one."; }
  var out = ["This is " + r.have + "."];
  var look = r.look || {}, f = r.fetch || {};
  if (!r.on) { out.push("Looking for a newer one is switched off."); }
  else if (look.at && look.error) { out.push("The last look, " + day(look.at) + ", could not reach GitHub."); }
  else if (look.at && look.newest) { out.push("Last looked " + day(look.at) + ": " + (look.newer ? look.newest + " is out." : "it is the newest.")); }
  if (r.going) { out.push("Waiting for Xsegon to close: " + (r.going === "update" ? "the update" : "going back") + " happens as it starts again."); }
  else if (f.alive) { out.push("Getting " + f.version + " ready: " + stepLine(f) + "."); }
  else if (r.out) {
    if (f.state === "failed" && f.version === r.out.version) { out.push("Downloading it did not work: " + (f.why || "it stopped") + "."); }
    if (r.failed) { out.push(tried(r.failed)); }
    out.push("Update now asks first, then downloads it (" + mb(r.out.mb) + "), checks it and puts it in place.");
  }
  else if (r.ready) {
    out.push(r.ready + " is ready: Update now takes a backup, closes Xsegon, puts it in place and opens it again.");
    if (r.failed) { out.push(tried(r.failed)); }
  }
  if (r.back && !r.going) { out.push("Updated from " + r.back + ": Go back puts it back the same way."); }
  if ((r.kept || []).length) { out.push("Files of Xsegon's you had changed are kept in data\\update\\previous: " + r.kept.slice(0, 5).join(", ") + (r.kept.length > 5 ? " and " + (r.kept.length - 5) + " more" : "") + "."); }
  if (r.cannot && r.release) { out.push("It cannot update itself: " + r.cannot + "."); }
  return out.join(" ");
}

export function updateRow(page) {
  var rowEl = el("div", "opt");
  rowEl.appendChild(iconEl("opt-ico", "bolt"));   // settings-ui.js ROW_ICONS.action, named here: that file imports this one
  var l = el("label");
  l.appendChild(document.createTextNode("This version"));
  var hint = el("span", "hint", "reading...");
  l.appendChild(hint);
  rowEl.appendChild(l);
  rowEl.dataset.find = "version update go back new versions download";
  var acts = el("div", "opt-acts");
  rowEl.appendChild(acts);
  page.appendChild(rowEl);
  api("api/update.php").then(function (r) {
    if (!r || !r.ok) { hint.textContent = "Could not read which version this is: " + ((r && r.error) || "no answer") + "."; return; }
    hint.textContent = words(r);
    acts.textContent = "";
    if (r.going) { return; }
    if ((r.ready || r.out) && !r.cannot && !(r.fetch && r.fetch.alive)) {
      var up = el("button", null, "Update now...");
      up.type = "button";
      up.addEventListener("click", function () { pressUpdate("update"); });
      acts.appendChild(up);
    }
    if (r.back && !r.cannot) {
      var back = el("button", null, "Go back to " + r.back);
      back.type = "button";
      back.addEventListener("click", function () { pressUpdate("back"); });
      acts.appendChild(back);
    }
  });
}
