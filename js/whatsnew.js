/*  What's new: doc\CHANGELOG.md, read in the app (api\changelog.php).
 *
 *  Help > What's new opens it any time, newest day first. After an update a
 *  note in the corner says so once. Someone brand new gets no note, since to
 *  them everything is new: their first start is quietly marked as seen.
 */

import { closeEditor, setEditorOnClose } from "./editors.js";
import { L, api, postJson } from "./log.js";
import { toast } from "./news.js";
import { stopVideo } from "./snap.js";
import { $editor } from "./state.js";
import { el } from "./util.js";

function mark(what, date) {
  if (!date) { return; }
  var b = {};
  b[what] = date;
  postJson("api/changelog.php", b);
}
function markSeen(date) { mark("seen", date); }

/* **bold** and `code` drawn as such; everything else is plain text, never
   HTML, so nothing in the file can put markup on the page. */
function richLine(text) {
  var p = el("li", "wn-item");
  text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).forEach(function (part) {
    if (!part) { return; }
    if (/^\*\*[^*]+\*\*$/.test(part)) { p.appendChild(el("strong", null, part.slice(2, -2))); }
    else if (/^`[^`]+`$/.test(part)) { p.appendChild(el("code", null, part.slice(1, -1))); }
    else { p.appendChild(document.createTextNode(part)); }
  });
  return p;
}

function longDate(iso) {
  var d = new Date(iso + "T12:00:00");
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function openWhatsNew() {
  L("ED", "what's new");
  stopVideo();
  setEditorOnClose(null);
  var inner = el("div", "panel-inner ed-inner wn");
  var head = el("div", "set-head");
  head.appendChild(el("h1", "panel-title", "WHAT'S NEW"));
  var done = el("button", "primary", "Close (esc)");
  done.addEventListener("click", closeEditor);
  head.appendChild(done);
  inner.appendChild(head);
  var body = el("div", "wn-days");
  body.appendChild(el("p", "mt-note", "reading..."));
  inner.appendChild(body);
  $editor.textContent = "";
  $editor.appendChild(inner);
  $editor.hidden = false;
  done.focus();

  api("api/changelog.php").then(function (r) {
    body.textContent = "";
    if (!r.ok || !r.days.length) { body.appendChild(el("p", "mt-note", "The changelog could not be read.")); return; }
    var shown = 0;
    function more(n) {
      r.days.slice(shown, shown + n).forEach(function (d) {
        var day = el("section", "wn-day" + (r.seen && d.date > r.seen ? " fresh" : ""));
        day.appendChild(el("h2", "wn-date", longDate(d.date) + (r.seen && d.date > r.seen ? "   new since you last looked" : "")));
        var ul = el("ul", "wn-list");
        d.items.forEach(function (t) { ul.appendChild(richLine(t)); });
        day.appendChild(ul);
        body.insertBefore(day, older);
      });
      shown += n;
      older.hidden = shown >= r.days.length;
    }
    var older = el("button", "wn-older", "Show older changes");
    older.addEventListener("click", function () { more(5); });
    body.appendChild(older);
    more(3);
    markSeen(r.newest);
  });
}

/* At startup: a note in the corner when the changelog has a newer day than
   the last one this person was told about. */
export function checkWhatsNew() {
  return api("api/changelog.php").then(function (r) {
    if (!r || !r.ok || !r.newest) { return; }
    if (!r.seen) { markSeen(r.newest); return; }         // brand new: nothing is "new" yet
    if (r.newest <= r.seen || (r.told && r.newest <= r.told)) { return; }
    var fresh = r.days.filter(function (d) { return d.date > r.seen; });
    var count = fresh.reduce(function (n, d) { return n + d.items.length; }, 0);
    L("NEWS", "what's new: " + count + " changes since " + r.seen);
    var t = toast("Xsegon has changed", [count + (count === 1 ? " change" : " changes") + " since you last looked.",
                                         "Press here, or Help > What's new."], 12);
    if (t) {
      t.classList.add("toast-press");
      t.addEventListener("click", function (e) {
        if (e.target.closest(".toast-x")) { return; }
        if (t.parentNode) { t.parentNode.removeChild(t); }
        openWhatsNew();
      });
    }
    mark("told", r.newest);
  });
}
