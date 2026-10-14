/*  A bar for a wait inside one request: a scan's walk, a backup being written.
 *  The main server answers one request at a time, so it cannot be asked how
 *  the one it is on goes: it writes that down (xs_step, includes\boot.php) and
 *  the fast lane reads it out (api\step.php). A wait under SHOW_AFTER_MS shows
 *  no bar; with no fast lane, or work that counts nothing, the bar travels.
 */

import { api } from "./log.js";
import { el } from "./util.js";

var SHOW_AFTER_MS = 500, TICK_MS = 300;

/* under: the node the bar goes beneath (the words or the button that began
   the wait). words: what the wait is for. promise: the request waited on,
   handed back so a caller wraps it in place. */
export function waitBar(under, words, promise) {
  var bar = null, line = null, fill = null, timer = null, over = false, asking = false;
  function paint(step) {
    var measured = step.total > 0;
    line.textContent = step.what + (measured ? ": " + step.done + " of " + step.total : "...");
    bar.classList.toggle("wait", !measured);
    fill.style.width = measured ? Math.round(100 * Math.min(1, step.done / step.total)) + "%" : "";
  }
  function tick() {
    if (asking) { return; }                   // never two out: asked of the main server, one waits its turn
    asking = true;
    api("api/step.php").then(function (r) {
      asking = false;
      if (!over && bar && r && r.ok && r.step) { paint(r.step); }
    });
  }
  var show = setTimeout(function () {
    if (over || !under || !under.isConnected) { return; }
    bar = el("div", "wait-bar wait");
    line = el("span", "wb-line", words + "...");
    bar.appendChild(line);
    var track = el("span", "mt-bar");
    fill = el("span", "mt-fill");
    track.appendChild(fill);
    bar.appendChild(track);
    under.parentNode.insertBefore(bar, under.nextSibling);
    timer = setInterval(tick, TICK_MS);
    tick();
  }, SHOW_AFTER_MS);
  function end() {
    over = true;
    clearTimeout(show);
    clearInterval(timer);
    if (bar && bar.parentNode) { bar.parentNode.removeChild(bar); }
  }
  promise.then(end, end);
  return promise;
}
