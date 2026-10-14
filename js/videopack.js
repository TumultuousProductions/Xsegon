import { jobsWatch } from "./jobbars.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { pickWindowsFolder } from "./scan.js";
import { sound } from "./sound.js";
import { el } from "./util.js";

/* ---------- videos for the games here from a package made on another PC (includes\videopack.php) ----------
   Two entries of the Pictures & Videos menu: a list of the games with no video
   goes out, and a package made from it comes back in. Nothing is chosen a
   video at a time, and no path is typed: the package is chosen in the Windows window. */

/* Pictures & Videos > Export Games with No videos. */
export function exportNoVideos() {
  api("api/videopack.php?need=1").then(function (r) {
    if (!r.ok) { showStrip(r.error || "could not count the games with no video", true); return; }
    if (!r.need) { showStrip("every game here has a video: there is nothing to export", false); return; }
    var a = el("a");
    a.href = "api/videopack.php?export=1";
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    L("ED", "games with no video exported (" + r.need + ")");
    showStrip(r.need + (r.need === 1 ? " game with no video is" : " games with no video are") + " listed in your Downloads folder as " + r.name
      + ". A video package made from that list goes in with Pictures & Videos > Import Xsegon Video Package", false);
  });
}

/* Pictures & Videos > Import Xsegon Video Package: the package is chosen, and the rest is a bar in the corner. */
export function importVideoPackage() {
  L("ED", "import video package");
  pickWindowsFolder("Choose the video package (an xsegon-videos .zip)", { kind: "file", types: "packages" }).then(function (file) {
    if (!file) { return; }
    postJson("api/videopack.php", { take: file }).then(function (r) {
      if (!r.ok) { showStrip(r.error || "the package could not be read", true); return; }
      sound("ok");
      showStrip("adding the package's videos to your games in the background: the bar in the corner shows how far it is", false);
      jobsWatch("videopack");
    });
  });
}
