import { L } from "./log.js";

/*  What is at work now, as the corner bars last saw it (js\jobbars.js,
    js\fillbar.js, js\runsbar.js, js\setupbar.js): the X's question names it
    (js\appwindow.js), and while there is any, a close from outside the page
    (Alt+F4, the taskbar) gets Chrome's own "Leave site?" box first. Xsegon's
    own closes and reloads say so beforehand (leaveQuietly) and are not asked. */

var going = {};             // by key: { name, line, onClose }
var quietTill = 0;

/* A bar's job at work, or null once it is not. onClose says what closing
   Xsegon does to it today; a job the page drives itself stops where it is. */
export function setAtWork(key, job) {
  if (job) { going[key] = job; } else { delete going[key]; }
}

export function atWorkList() {
  return Object.keys(going).map(function (k) { return going[k]; });
}

/* Xsegon closing, reloading or opening again its own window: no box for that.
   For 15 s, so a close that did not happen is asked about again. */
export function leaveQuietly() { quietTill = Date.now() + 15000; }

export function initAtWork() {
  window.addEventListener("beforeunload", function (e) {
    var work = atWorkList();
    if (!work.length || Date.now() < quietTill) { return; }
    L("WIN", "the window is being closed or reloaded from outside the X with " +
      work.map(function (j) { return j.name; }).join(", ") + " at work: Chrome's Leave site box asks first");
    e.preventDefault();
    e.returnValue = "";
  });
  // F5 and Ctrl+R only read the page again, which leaves every job going.
  window.addEventListener("keydown", function (e) {
    if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "R"))) { leaveQuietly(); }
  }, true);
}
