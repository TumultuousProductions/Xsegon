/*  Show in folder: a game's file, a save, or a folder of Xsegon's own, in
 *  Explorer (api\reveal.php finds the path). Explorer can come up behind a
 *  full-screen Xsegon, so the strip says what was opened.
 */

import { showStrip } from "./launch.js";
import { postJson } from "./log.js";

// body is what api\reveal.php takes; failed, the words when it gives none.
export function showInExplorer(body, failed) {
  return postJson("api/reveal.php", body).then(function (r) {
    if (!r.ok) { showStrip(r.error || failed || "could not open Explorer", true); return r; }
    var where = r.revealed || r.folder || "";
    showStrip(r.dry ? "a test copy opens no window: Explorer would open on " + where : "Explorer is opening on " + where, false);
    return r;
  });
}
