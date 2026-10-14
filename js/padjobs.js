/*  What each controller button does in Xsegon's own screens: seven jobs, each
    on one button. Standard places, Confirm with (Settings) swapping the first
    two, and over both a person's own choice per kind of controller
    (js\padcheck.js). Start and the middle button are never offered; games are not touched. */

import { api } from "./log.js";
import { padHeardId, padKindOf } from "./padkind.js";
import { saveSetting, savedNote } from "./savednote.js";
import { S } from "./state.js";

export var PAD_JOBS = [
  { job: "confirm",  label: "Play, open, yes" },
  { job: "back",     label: "Back" },
  { job: "details",  label: "Details" },
  { job: "menu",     label: "Menu" },
  { job: "pageUp",   label: "Jump back, the tab before" },
  { job: "pageDown", label: "Jump forward, the next tab" },
  { job: "top",      label: "The menus at the top" }
];
var STANDARD = { confirm: 0, back: 1, details: 2, menu: 3, pageUp: 4, pageDown: 5, top: 8 };
// Jobs that came after people had set their buttons: a kept set without one is given it, not thrown out.
var LATER = ["top"];
// What a job may sit on: the face buttons, the shoulders, the triggers, Select and the two stick presses.
export var PAD_JOB_BUTTONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11];

// Whose map a pad uses: its kind's, or one of its very own for a pad of no kind Xsegon knows.
export function padJobKey(id) { return padKindOf(id) || (id ? "pad:" + id : "none"); }

function chosen() {
  var all = S.controller && S.controller.padJobs;
  return all && typeof all === "object" && !Array.isArray(all) ? all : {};
}
export function padJobsOwn(key) { return !!chosen()[key]; }

function worked(key) {
  var jobs = Object.assign({}, STANDARD), own = chosen()[key];
  if (S.controller && S.controller.confirmButton === "b") { jobs.confirm = 1; jobs.back = 0; }
  if (!own || typeof own !== "object") { return jobs; }
  own = Object.assign({}, own);
  LATER.forEach(function (job) {
    if (own[job] !== undefined) { return; }
    var used = Object.keys(own).map(function (k) { return own[k]; });
    var free = [STANDARD[job]].concat(PAD_JOB_BUTTONS).filter(function (n) { return used.indexOf(n) < 0; });
    own[job] = free[0];
  });
  // A map edited by hand is used only when it is whole: each job on a button of its own that may hold one.
  var taken = {}, mine = {};
  var whole = PAD_JOBS.every(function (j) {
    var n = own[j.job];
    if (PAD_JOB_BUTTONS.indexOf(n) < 0 || taken[n]) { return false; }
    taken[n] = true;
    mine[j.job] = n;
    return true;
  });
  return whole ? mine : jobs;
}

// Asked at every poll of the pad: worked out once for each key, and again when the settings change.
var memo = { from: null, swap: null, by: {} };
export function padJobsFor(key) {
  var c = S.controller || {};
  if (memo.from !== c.padJobs || memo.swap !== c.confirmButton) { memo = { from: c.padJobs, swap: c.confirmButton, by: {} }; }
  return memo.by[key] || (memo.by[key] = worked(key));
}
export function padJobs(pad) { return padJobsFor(padJobKey(pad && pad.id)); }
// The jobs of the pad that pressed last: what the legend names.
export function padJobsNow() { return padJobsFor(padJobKey(padHeardId())); }

function keep(key, jobs, said) {
  var all = {}, had = chosen();
  Object.keys(had).forEach(function (k) { all[k] = had[k]; });
  if (jobs) { all[key] = jobs; } else { delete all[key]; }
  return saveSetting({ controller: { padJobs: all } }, "Xsegon's buttons", said).then(function (held) {
    if (held) { S.controller.padJobs = all; }
    return held;
  });
}

/* A job onto a button; the job that button had takes the one this job leaves.
   Resolves with the job that moved (or null), or false when the save did not hold. */
export function padJobSet(key, job, button, said) {
  var jobs = Object.assign({}, padJobsFor(key)), other = null;
  PAD_JOBS.forEach(function (j) { if (j.job !== job && jobs[j.job] === button) { other = j; } });
  if (other) { jobs[other.job] = jobs[job]; }
  jobs[job] = button;
  return keep(key, jobs, said).then(function (held) { return held ? other : false; });
}

// Back to the standard places. A key taken away is not in the answer saveSetting compares, so it is looked for.
export function padJobsStandard(key, said) {
  return keep(key, null, "").then(function (held) {
    if (!held) { return false; }
    return api("api/settings.php").then(function (r) {
      var kept = r && r.settings && r.settings.controller && r.settings.controller.padJobs;
      return !(kept && !Array.isArray(kept) && kept[key]);
    });
  }).then(function (gone) {
    if (gone && said) { savedNote("saved", said); }
    return gone;
  });
}
