/*  Opening on last time's copy: the library's opening answer is kept in the browser,
 *  and the next start draws from it at once, then again from the fresh read only if
 *  that differs (js\library.js, load). Only the opening read is kept.
 *
 *  The browser's cache store, not localStorage, which stops at about five megabytes,
 *  too small for a big library. The store is named for the build, so another version's
 *  copy is never read. Any failure here is "nothing kept" and the page waits for the
 *  server; Settings > Feel > Open on last time's copy turns it off.
 */

import { L } from "./log.js";
import { S } from "./state.js";

var PREFIX = "xs-boot-";

function storeName() { return PREFIX + String((window.XSEGON && window.XSEGON.build) || "dev"); }
function keyFor(query) { return "/__boot/library?" + query; }

export function bootCopyOn() {
  return !!window.caches && !(S.feel && S.feel.openFromLast === false);
}

/* The answer kept for this exact request, as { text, data }, or null. */
export function bootRead(query) {
  if (!bootCopyOn()) { return Promise.resolve(null); }
  return caches.open(storeName()).then(function (c) { return c.match(keyFor(query)); })
    .then(function (r) { return r ? r.text() : null; })
    .then(function (text) {
      if (!text) { return null; }
      var data = JSON.parse(text);
      return data && data.ok && Array.isArray(data.games) ? { text: text, data: data } : null;
    })
    .catch(function (e) { L("BOOT", "last time's copy did not read (" + (e && e.message) + "); waiting for the library"); return null; });
}

/* Keep this answer for next time, and throw away what other builds kept.
   Answers with the text that was kept, which is what "the same" is asked of. */
export function bootSave(query, data) {
  var text = JSON.stringify(data);
  if (!bootCopyOn()) { return text; }
  caches.keys().then(function (names) {
    names.forEach(function (n) { if (n.indexOf(PREFIX) === 0 && n !== storeName()) { caches.delete(n); } });
    return caches.open(storeName());
  }).then(function (c) {
    // One answer is kept, so whatever was kept for another view or sorting goes.
    return c.keys().then(function (reqs) {
      return Promise.all(reqs.map(function (r) { return c.delete(r); }));
    }).then(function () {
      return c.put(keyFor(query), new Response(text, { headers: { "Content-Type": "application/json" } }));
    });
  }).catch(function (e) { L("BOOT", "could not keep a copy for next time (" + (e && e.message) + ")"); });
  return text;
}
