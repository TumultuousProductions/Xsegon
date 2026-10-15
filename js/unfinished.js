/*  Downloads that have not finished, on Scan for Games: an empty .zip or .7z,
 *  most often with the browser's .part beside it (includes\scan.php). Each line
 *  says how far the download got, and Clear it deletes the empty file and its
 *  .part once the person says yes. The server reads both again at the press.
 */

import { backupFailed } from "./backup-io.js";
import { confirmWindow } from "./confirm.js";
import { L, postJson } from "./log.js";
import { sound } from "./sound.js";
import { openReportTool } from "./tools.js";
import { el, megabytes } from "./util.js";

function base(p) { return String(p || "").split(/[\\\/]/).pop(); }
function gigabytes(n) { return n >= 1073741824 ? (n / 1073741824).toFixed(1) + " GB" : megabytes(n); }

export function unfinishedTail(inner, rows) {
  if (!rows.length) { return; }
  inner.appendChild(el("h2", "bk-head", "Downloads that have not finished"));
  var box = el("div", "up-rows");
  rows.forEach(function (u) {
    var node = el("div", "up-row"), top = el("div", "up-top");
    top.appendChild(el("span", "up-file", base(u.file)));
    // The end of the path is the part that says where: the console's folder.
    var folder = String(u.file).split(/[\\\/]/).slice(0, -1);
    var where = el("span", "up-where", u.platform + "  ·  " + folder.slice(-2).join("\\"));
    where.title = folder.join("\\");
    top.appendChild(where);
    var says = el("p", "up-says", u.why + ".");
    // Still downloading: the server would refuse, and the line already says to wait.
    var go = el("button", "up-go", "Clear it");
    go.type = "button";
    go.hidden = !!u.going;
    go.addEventListener("click", function () { ask(u, go, says); });
    top.appendChild(go);
    node.appendChild(top);
    node.appendChild(says);
    box.appendChild(node);
  });
  inner.appendChild(box);
}

function ask(u, go, says) {
  confirmWindow("Clear this download?", function (box) {
    box.appendChild(el("p", null, base(u.file) + " is an empty file" + (u.part
      ? ", and the download so far, " + gigabytes(u.bytes) + ", is in " + base(u.part) + ". Both are deleted."
      : ". It is deleted.")));
    box.appendChild(el("p", "confirm-note", "To have the game, start its download again from the site."));
  }, { label: "Clear it", run: function () { clear(u, go, says); } }, "Keep it");
}

function clear(u, go, says) {
  go.disabled = true;
  postJson("api/scan.php", { action: "clear", file: u.file }).then(function (r) {
    if (!r.ok) {
      go.disabled = false;
      backupFailed("The download was not cleared", "not cleared", r, openReportTool);
      return;
    }
    L("SCAN", "cleared " + base(u.file) + (r.freed ? ", " + gigabytes(r.freed) + " back" : ""));
    sound("ok");
    go.hidden = true;
    says.className = "up-says good";
    says.textContent = r.freed ? "Cleared: " + gigabytes(r.freed) + " back." : "Cleared.";
  });
}
