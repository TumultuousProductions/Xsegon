import { showStrip } from "./launch.js";
import { load, setPlatformsFilled } from "./library.js";
import { L, postJson } from "./log.js";
import { pickWindowsFolder } from "./scan.js";
import { $platform, S } from "./state.js";

/* A LaunchBox library, brought in once (api\import.php): its list of games and your
   own play data, never its pictures, videos or sounds. */

/* Games > Bring in a LaunchBox library: the folder is chosen in the Windows window. */
export function bringInLaunchBox() {
  L("ED", "bring in a LaunchBox library");
  pickWindowsFolder("Your LaunchBox folder (the one LaunchBox.exe is in)", { start: S.paths.launchbox || "" }).then(function (dir) {
    if (dir) { runImport(dir); }
  });
}

/* Read it in: from a folder just chosen, or the one kept before (Settings > Library > Re-read LaunchBox). */
export function runImport(folder) {
  showStrip(folder ? "bringing in the LaunchBox library…" : "re-reading LaunchBox…", false);
  postJson("api/import.php", folder ? { folder: folder } : {}).then(function (r) {
    showStrip(r.ok ? ("imported " + r.games + " games in " + r.ms + "ms")
                   : ("import failed: " + r.error), !r.ok);
    if (r.ok && folder) { S.paths.launchbox = folder; }
    setPlatformsFilled(false);
    $platform.length = 1;
    load();
  });
}
