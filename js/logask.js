/*  Keep a log? The first question of all (roadmap BI): at a first start, and
 *  once for everyone already using Xsegon. Asked before the setup window, since
 *  a first setup is what goes wrong most and its lines are what a report needs.
 *  No log, Esc or a press outside turns Settings > Debug > Logging off and takes
 *  back what this start already wrote (api\log.php forget).
 */

import { askCard } from "./askcards.js";
import { L, logStop, postJson } from "./log.js";
import { saveSetting } from "./savednote.js";
import { S } from "./state.js";

/* This start, from a little before the page itself: the request that served it is logged as it ends. */
var since = new Date((performance.timeOrigin || Date.now()) - 2000);

function two(n, w) { return String(n).padStart(w || 2, "0"); }

/** Resolves once answered, at once when it was answered before. */
export function askLogging() {
  var d = S.debug || (S.debug = {});
  // Logging switched off by hand in Settings is an answer already.
  if ((d.asked && d.asked.logging === true) || d.logging === false) { return Promise.resolve(); }
  return new Promise(function (done) {
    askCard({ title: "Keep a log?", cls: "log-ask",
      lines: [["Xsegon can write down what it does, so a problem can be found when you report one."],
              ["It stays on this PC, in Xsegon's data folder, and goes nowhere unless you send a report yourself.", "faint"],
              ["You can change it any time in Settings > Debug > Logging.", "faint"]],
      yes: "Keep a log", no: "No log",
      onYes: function () { keep(d); done(); },
      onNo: function () { stop(d); done(); } });
  });
}

function keep(d) {
  d.asked = { logging: true };
  L("SET", "log question: keep a log");
  saveSetting({ debug: { asked: { logging: true } } }, "Keep a log");
}

function stop(d) {
  logStop();
  d.logging = false;
  d.asked = { logging: true };
  // Off first, so no line lands after the take-back.
  saveSetting({ debug: { logging: false, asked: { logging: true } } }, "No log").then(function (ok) {
    if (!ok) { return; }
    var day = since.getFullYear() + "-" + two(since.getMonth() + 1) + "-" + two(since.getDate());
    var at = two(since.getHours()) + ":" + two(since.getMinutes()) + ":" + two(since.getSeconds()) + "." + two(since.getMilliseconds(), 3);
    postJson("api/log.php", { forget: { day: day, since: at } });
  });
}
