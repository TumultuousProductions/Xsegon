/*  The sign that a setting was saved, and the save that earns it. A setting
 *  changed outside Settings (a menu, the toolbar, a gear) saves through
 *  saveSetting here, which speaks only from the server's answer compared with
 *  what was asked: otherwise a save that did not hold would look saved.
 */

import { showStrip } from "./launch.js";
import { L, postJson } from "./log.js";
import { $settings } from "./state.js";
import { el } from "./util.js";

var node = null, goT = null, leaving = false, watching = false;

/* One small toast, reused for the next save so a slider does not stack them.
   kind: "saved", "warn" or "bad". It stands in Settings while that is open,
   since the page's own toasts are behind an open window. */
export function savedNote(kind, text) {
  var box = $settings.hidden ? document.getElementById("toasts") : $settings;
  if (!box) { return; }
  if (!node || node.parentNode !== box) {
    if (node && node.parentNode) { node.parentNode.removeChild(node); }
    node = el("div", "toast toast-saved");
    node.appendChild(el("span", "ts-mark"));
    node.appendChild(el("span", "ts-text"));
    box.appendChild(node);
  }
  node.className = "toast toast-saved" + (kind === "saved" ? "" : kind === "warn" ? " warn" : " bad");
  node.firstChild.textContent = kind === "saved" ? "✓" : kind === "warn" ? "!" : "✗";
  node.lastChild.textContent = text;
  clearTimeout(goT);
  var mine = node;
  goT = setTimeout(function () {
    mine.classList.add("going");
    if (node === mine) { node = null; }
    setTimeout(function () { if (mine.parentNode) { mine.parentNode.removeChild(mine); } }, 260);
  }, kind === "saved" ? 1800 : 5000);
}

// What was asked for and is not what the answer holds, by name: "view.sort".
function unkept(asked, kept, at, out) {
  Object.keys(asked).forEach(function (k) {
    var a = asked[k], b = kept ? kept[k] : undefined, id = at ? at + "." + k : k;
    if (a && typeof a === "object" && !Array.isArray(a)) { unkept(a, b && typeof b === "object" ? b : null, id, out); }
    else if (JSON.stringify(a) !== JSON.stringify(b)) { out.push(id); }
  });
  return out;
}

/* patch is what api\settings.php takes ({ view: { sort: "title" } }), name what
   a person would call it. A refused or altered save is said on the strip. said:
   the words for a save that held, where the screen may show nothing of it;
   left out, a save that held says nothing. Resolves true only for a save that held. */
export function saveSetting(patch, name, said) {
  if (!watching) { watching = true; window.addEventListener("pagehide", function () { leaving = true; }); }
  return postJson("api/settings.php", patch).then(function (r) {
    if (!r || !r.ok || !r.settings) {
      if (leaving) { return false; }                 // the page is going: a request cut short is not a refusal
      showStrip(name + " could not be saved, so it lasts only until Xsegon is next started: " + ((r && r.error) || "the server did not answer"), true);
      return false;
    }
    var off = unkept(patch, r.settings, "", []);
    if (off.length) {
      L("SET", "asked " + JSON.stringify(patch).slice(0, 200) + ", not kept as asked: " + off.join(", "));
      showStrip(name + " was not kept as chosen, so it goes back when Xsegon is next started", true);
      return false;
    }
    if (said) { savedNote("saved", said); }
    return true;
  });
}
