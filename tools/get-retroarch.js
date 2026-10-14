/*  RetroArch, carried by the package so setup needs no 200 MB download.

        node tools\get-retroarch.js

    Puts runtime\RetroArch\RetroArch.7z and RetroArch-LICENSE.txt in place, or
    says they are there already. tools\make-test-copy.js calls ensure() and
    copies both into the package's runtime\RetroArch; neither is in git.
    Setup (includes\setup.php, xs_setup_source) unpacks the carried archive
    after the same hash check a download gets, so nothing is fetched.

    PINNED in one place: XS_RA_VERSION, XS_RA_BYTES and XS_RA_SHA256 in
    includes\setup.php, read here, so the package always carries the very
    file a download would have been.

    LICENCE: RetroArch is GNU GPL v3. It is handed on unchanged, as libretro
    builds it, with the licence and where its source is beside it. Xsegon
    runs it as a separate program and links nothing of it, so Xsegon stays MIT. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SETUP = fs.readFileSync(path.join(ROOT, "includes", "setup.php"), "utf8");
const pin = (name) => (new RegExp("const " + name + "\\s*=\\s*'?([^';]+)'?;").exec(SETUP) || [])[1];
const VERSION = pin("XS_RA_VERSION");
const BYTES = Number(pin("XS_RA_BYTES"));
const SHA256 = pin("XS_RA_SHA256");
const URL = "https://buildbot.libretro.com/stable/" + VERSION + "/windows/x86_64/RetroArch.7z";
const GPL_URL = "https://www.gnu.org/licenses/gpl-3.0.txt";

const DIR = path.join(ROOT, "runtime", "RetroArch");
const ARCHIVE = path.join(DIR, "RetroArch.7z");
const LICENCE = path.join(DIR, "RetroArch-LICENSE.txt");
const CURL = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "curl.exe");

const hashOf = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function fetchTo(url, to) {
  execFileSync(CURL, ["-L", "--fail", "--silent", "--show-error", "--connect-timeout", "20", "-o", to, url], { stdio: ["ignore", "ignore", "inherit"] });
}

/** Both files in place and the archive the pinned one, fetching what is not. Throws with the reason. */
function ensure() {
  if (!VERSION || !BYTES || !/^[0-9a-f]{64}$/.test(SHA256 || "")) { throw new Error("the RetroArch pin in includes\\setup.php could not be read"); }
  const held = fs.existsSync(LICENCE) ? fs.readFileSync(LICENCE, "utf8") : "";
  if (held.includes("RetroArch " + VERSION + " ") && fs.existsSync(ARCHIVE) && fs.statSync(ARCHIVE).size === BYTES && hashOf(ARCHIVE) === SHA256) {
    return { version: VERSION, archive: ARCHIVE, licence: LICENCE, did: "there already" };
  }
  fs.mkdirSync(DIR, { recursive: true });
  const part = ARCHIVE + ".part";
  fetchTo(URL, part);
  const got = hashOf(part);
  if (got !== SHA256) {
    fs.rmSync(part, { force: true });
    throw new Error("the archive from " + URL + " hashes to " + got + ", not the pinned " + SHA256 + ": thrown away");
  }
  fs.renameSync(part, ARCHIVE);
  const gpl = ARCHIVE + ".gpl";
  fetchTo(GPL_URL, gpl);
  const text = fs.readFileSync(gpl, "utf8");
  fs.rmSync(gpl, { force: true });
  if (!/GNU GENERAL PUBLIC LICENSE\s+Version 3/.test(text)) { throw new Error(GPL_URL + " did not give the GNU GPL v3"); }
  fs.writeFileSync(LICENCE, [
    "RetroArch " + VERSION + " for Windows (64-bit), by libretro (retroarch.com), the",
    "program that plays most of the consoles Xsegon lists.",
    "",
    "RetroArch.7z beside this file is libretro's own stable build, unchanged, from",
    "    " + URL,
    "    SHA-256: " + SHA256,
    "Xsegon unpacks it into its own folder the first time it sets up, after",
    "checking that SHA-256, so nothing has to be downloaded.",
    "",
    "Its source code, for exactly this version, is published by libretro at",
    "    https://github.com/libretro/RetroArch/tree/v" + VERSION,
    "",
    "RetroArch is not part of Xsegon and is not under Xsegon's licence. It is",
    "free software under the GNU General Public License, version 3, which",
    "follows.",
    "",
    "------------------------------------------------------------------------",
    "",
  ].join("\r\n") + text.replace(/\r?\n/g, "\r\n"));
  return { version: VERSION, archive: ARCHIVE, licence: LICENCE, did: "fetched, with its licence" };
}

module.exports = { ensure, VERSION, SHA256, BYTES };
if (require.main === module) {
  try { const r = ensure(); console.log("runtime\\RetroArch\\RetroArch.7z " + r.version + ": " + r.did); }
  catch (e) { console.log("STOP: " + e.message); process.exit(1); }
}
