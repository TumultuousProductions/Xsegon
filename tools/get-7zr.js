/*  7-Zip's small extractor, for the package.

        node tools\get-7zr.js

    Puts bin\7zr.exe and bin\7zr-LICENSE.txt in place, or says they are
    there already. tools\make-test-copy.js calls ensure() before it copies
    bin\, so every package carries them; neither file is in git.

    Shipped because libretro offers RetroArch only as a .7z or an installer,
    and Windows' tar cannot open a .7z on every PC. 7zr.exe is GNU LGPL, run
    as a separate program and shipped unchanged with its licence, so Xsegon
    stays MIT. It is only given the libretro file whose SHA-256 was checked:
    move this pin when 7-Zip fixes something in its .7z code.

    Pinned by version to the official release and its SHA-256; a file that
    hashes to anything else is thrown away. Moving on is these three lines. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const VERSION = "26.03";
const URL = "https://github.com/ip7z/7zip/releases/download/" + VERSION + "/7zr.exe";
const SHA256 = "ad4c82fadcbdf93c03b4fc440f300509c7d60c5c2f4d183e35d9d70d6957037d";

const BIN = path.join(__dirname, "..", "bin");
const EXE = path.join(BIN, "7zr.exe");
const LICENCE = path.join(BIN, "7zr-LICENSE.txt");
const CURL = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "curl.exe");

const hashOf = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function fetchTo(url, to) {
  execFileSync(CURL, ["-L", "--fail", "--silent", "--show-error", "--connect-timeout", "20", "-o", to, url], { stdio: ["ignore", "ignore", "inherit"] });
}

/** Both files in place and the program the pinned one, fetching what is not. Throws with the reason. */
function ensure() {
  let did = "there already";
  if (!fs.existsSync(EXE) || hashOf(EXE) !== SHA256) {
    const part = EXE + ".part";
    fetchTo(URL, part);
    const got = hashOf(part);
    if (got !== SHA256) {
      fs.rmSync(part, { force: true });
      throw new Error("7zr.exe from " + URL + " hashes to " + got + ", not the pinned " + SHA256 + ": thrown away");
    }
    fs.renameSync(part, EXE);
    did = "fetched";
  }
  if (!fs.existsSync(LICENCE) || !fs.readFileSync(LICENCE, "utf8").includes("7zr.exe " + VERSION)) {
    const part = LICENCE + ".part";
    fetchTo("https://www.7-zip.org/license.txt", part);
    const text = fs.readFileSync(part, "utf8");
    fs.rmSync(part, { force: true });
    if (!/GNU LGPL/.test(text)) { throw new Error("what came from 7-zip.org/license.txt is not 7-Zip's licence"); }
    fs.writeFileSync(LICENCE, [
      "7zr.exe " + VERSION + ", the small console extractor of 7-Zip (www.7-zip.org), by Igor Pavlov.",
      "",
      "It is the official file, unchanged, from",
      "    " + URL,
      "    SHA-256 " + SHA256,
      "and its source code is on the same page:",
      "    https://github.com/ip7z/7zip/releases/tag/" + VERSION,
      "",
      "Xsegon runs it for one thing: unpacking RetroArch when Windows' own tar.exe",
      "cannot. It is not part of Xsegon and is not under Xsegon's licence. 7zr.exe is",
      "under the GNU LGPL; 7-Zip's licence follows, as published at",
      "www.7-zip.org/license.txt.",
      "",
      "------------------------------------------------------------------------",
      "",
    ].join("\r\n") + text.replace(/\r?\n/g, "\r\n"));
    did = did === "fetched" ? "fetched, with its licence" : "licence written";
  }
  return { version: VERSION, sha256: SHA256, exe: EXE, licence: LICENCE, did: did };
}

module.exports = { ensure, VERSION, SHA256 };
if (require.main === module) {
  try { const r = ensure(); console.log("bin\\7zr.exe " + r.version + ": " + r.did); }
  catch (e) { console.log("STOP: " + e.message); process.exit(1); }
}
