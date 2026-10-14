/*  A controller was found: logged the first time each one presses, and said
    once in the corner with the way to change its button names (Settings >
    Xsegon Controls > Button names). Said again only for another kind, never
    while the names are chosen by hand. */

import { setPadMode } from "./help.js";
import { L, api, beforeLeave, logOn } from "./log.js";
import { toast } from "./news.js";
import { padKindOf, padKindWord } from "./padkind.js";
import { openSettingAt } from "./settings-ui.js";
import { $editor, $settings, S } from "./state.js";
import { el } from "./util.js";

var TOLD = "xs-pad-told";
var NOTICE_SECS = 14;
var logged = {};             // pads already written to the log, by place and name
var kinds = {};              // each name's kind, worked out once: this is asked at every poll of a held button
var startHeld = {};          // each pad's Start at the last poll
var notice = null;           // the notice while it is up

var toldKind = null;         // the kind last said, kept from one start to the next
try { toldKind = localStorage.getItem(TOLD); } catch (e) { /* a private window: said once a start */ }

/* For the log only: a page hears a controller only once it presses, so Windows
   is asked what is plugged in (api\pad-plugged.php), and the page logs as it leaves which ones pressed. */
var openedAt = Date.now();
export function padsPlugged(why) {
  if (!logOn()) { return Promise.resolve(""); }
  return api("api/pad-plugged.php?for=" + why).then(function (r) { return (r && r.ok && r.words) || ""; });
}
/* The same for the controller picture, which says the answer on screen: asked whatever logging is set to
   (the server writes its line only with logging on). Null when there is no answer. */
export function padsAsk() {
  return api("api/pad-plugged.php?for=check").then(function (r) { return r && r.ok ? r : null; });
}
// Once, as the page starts (js\main.js).
export function padsBegin() {
  padsPlugged("page");
  beforeLeave(function () {
    var ids = Object.keys(logged).map(function (k) { return k.replace(/^\d+:/, ""); });
    var mins = Math.round((Date.now() - openedAt) / 60000);
    L("PAD", (ids.length ? ids.length + (ids.length === 1 ? " controller" : " controllers") + " pressed a button while this page was open: " + ids.join("; ")
                         : "no controller pressed a button while this page was open") + " (" + mins + " min)");
  });
}

function noticeUp() { return !!(notice && notice.parentNode && !notice.classList.contains("going")); }

function change(how) {
  L("PAD", "names: change asked by " + how);
  if (notice && notice.parentNode) { notice.parentNode.removeChild(notice); }
  notice = null;
  openSettingAt("controller", "buttonNames");
}

function say(kind, usual) {
  var word = padKindWord(kind);
  var lines = [word ? "Xsegon shows " + word + " button names." : "Not one Xsegon knows: it shows Xbox button names."];
  if (!usual) { lines.push("It is not in the usual layout: buttons may sit elsewhere."); }
  notice = toast(word ? word + " controller found" : "Controller found", lines, NOTICE_SECS);
  if (!notice) { return false; }
  var go = el("p", "toast-line toast-go");
  var press = el("button", null, "Change");
  press.type = "button";
  press.addEventListener("click", function () { change("a click"); });
  go.appendChild(press);
  go.appendChild(el("span", null, "or press Start on the controller"));
  notice.appendChild(go);
  return true;
}

/* A press on a pad, from the poll: the legend speaks that pad's names, and a
   pad not met before is written down and, where due, said. */
export function padHeard(pad, i) {
  setPadMode(true, pad);
  var kind = kinds[pad.id] || (kinds[pad.id] = padKindOf(pad.id) || "unknown"), usual = pad.mapping === "standard";
  var chosen = (S.controller && S.controller.buttonNames) || "auto";
  if (!logged[i + ":" + pad.id]) {
    logged[i + ":" + pad.id] = true;
    L("PAD", "seen: " + pad.id + " | layout " + (pad.listed ? "from the shared list as " + pad.listed : pad.mapping || "not the usual one") + " | " + (pad.buttons || []).length +
      " buttons, " + (pad.axes || []).length + " axes | read as " + kind + (chosen === "auto" ? "" : ", names set to " + chosen));
  }
  // Not behind an open window, where it would go by unseen: the next press tries again.
  if (chosen !== "auto" || toldKind === kind || !$settings.hidden || !$editor.hidden) { return; }
  if (!say(kind, usual)) { return; }
  toldKind = kind;
  try { localStorage.setItem(TOLD, kind); } catch (e) { /* said once a start */ }
  L("PAD", "notice: " + kind + " controller found");
}

// Start, pressed while the notice is up, is its Change button: true when it took the press.
export function padChange(pad, i) {
  var down = !!(pad.buttons && pad.buttons[9] && pad.buttons[9].pressed), before = startHeld[i];
  startHeld[i] = down;
  if (!down || before || !noticeUp()) { return false; }
  setPadMode(true, pad);
  change("Start on the pad");
  return true;
}
