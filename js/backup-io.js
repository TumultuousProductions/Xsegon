/*  Back up what you made: Export to a folder... and Import from a file...
    The same archive handed to you, or taken back from you: a stick, another
    drive, another PC. An import only lists the archive and opens it for
    restoring, so Restore stays the one place anything is put back. */

import { confirmWindow } from "./confirm.js";
import { showStrip } from "./launch.js";
import { L, postJson } from "./log.js";
import { pickWindowsFolder } from "./scan.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { HELP_MAIL, el } from "./util.js";
import { waitBar } from "./waitbar.js";

function post(body) {
  return postJson("api/backup.php", body);
}

// The backup screen may have been closed while a window or the server was asked.
function here() { return $editor.dataset.tool === "backup"; }

// A backup just made, in words: it is only ever said once every file in it has been read back.
export function backupSaid(made, size) {
  return made.files + " files (" + size(made.bytes) + "), every one read back" + (made.large ? ", in the larger zip format" : "");
}

/* A backup or a restore that failed on a fault of the disk's or of Xsegon's
   own (the server says report): why, in its words, and where the details go.
   report opens Help > Report a problem. Anything else stays a line on the strip. */
export function backupFailed(title, strip, r, report) {
  sound("back");
  if (!r.report) { showStrip(strip + ": " + (r.error || "no answer"), true); return; }
  L("ED", title + ": " + (r.error || "no answer"));
  confirmWindow(title, function (box) {
    box.appendChild(el("p", null, r.error || "The server gave no answer."));
    box.appendChild(el("p", "confirm-note", "Help > Report a problem makes one file with the details. Please email it to " +
      HELP_MAIL + " so this can be put right."));
  }, { label: "Report a problem...", run: report }, "Close");
}

/* The two buttons, for the backup screen's own row. size writes a byte
   count, repaint draws the screen again, inspect opens Restore on a name,
   report opens Help > Report a problem. */
export function backupIoButtons(btns, size, repaint, inspect, report) {
  var out = el("button", null, "Export to a folder...");
  out.addEventListener("click", function () {
    pickWindowsFolder("Choose the folder to put a copy of your backup in").then(function (dir) {
      if (!dir || !here()) { return; }
      out.disabled = true;
      out.textContent = "Exporting...";
      waitBar(btns, "Backing up your files", post({ action: "export", dir: dir })).then(function (r) {
        if (!here()) { return; }
        if (!r.ok) { backupFailed("The backup was not exported", "could not export", r, report); repaint(); return; }
        sound("select");
        var miss = r.made.missed || [];
        if (miss.length) { showStrip("exported " + r.made.files + " files, but " + miss.length + " would not read and " + (miss.length === 1 ? "is" : "are") + " NOT in it: " + miss.slice(0, 5).join(", ") + ". Try again in a moment.", true); }
        else { showStrip("exported " + backupSaid(r.made, size) + ", to " + r.made.dir + "\\" + r.made.name, false); }
        repaint();
      });
    });
  });
  btns.appendChild(out);

  var take = el("button", null, "Import from a file...");
  take.addEventListener("click", function () {
    pickWindowsFolder("Choose an Xsegon backup (a .zip)", { kind: "file" }).then(function (file) {
      if (!file || !here()) { return; }
      post({ action: "import", file: file }).then(function (r) {
        if (!here()) { return; }
        if (!r.ok) { sound("back"); showStrip("not imported: " + (r.error || ""), true); return; }
        sound("select");
        showStrip((r.imported.already ? "that backup is already here" : "imported as " + r.imported.name) +
          ". Nothing is put back until you select it and press Restore.", false);
        inspect(r.imported.name);
      });
    });
  });
  btns.appendChild(take);
}
