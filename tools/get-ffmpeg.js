/*  ffmpeg, the video cutter, for the package.

        node tools\get-ffmpeg.js

    Puts bin\ffmpeg.exe and bin\ffmpeg-LICENSE.txt in place, or says they
    are there already. tools\make-test-copy.js calls ensure() before it
    copies bin\, so every package carries them; neither file is in git.
    bin\archivevid.php cuts the first 30 seconds of a World of Longplays
    recording with it: nothing in Windows cuts a video without fetching
    the whole file.

    This build is GNU GPL v3, shipped unchanged with its LICENSE beside it
    and run as a separate program, so Xsegon stays MIT.

    Pinned like 7zr.exe: gyan.dev's release essentials build (listed on
    ffmpeg.org's download page), by version and its published SHA-256. A
    file that hashes to anything else is thrown away. Moving on is these
    three lines.                                                          */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const VERSION = "8.1.2";
const URL = "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-" + VERSION + "-essentials_build.zip";
const SHA256 = "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec";

const BIN = path.join(__dirname, "..", "bin");
const EXE = path.join(BIN, "ffmpeg.exe");
const LICENCE = path.join(BIN, "ffmpeg-LICENSE.txt");
const CURL = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "curl.exe");
const TAR = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");

const hashOf = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function fetchTo(url, to) {
  execFileSync(CURL, ["-L", "--fail", "--silent", "--show-error", "--connect-timeout", "20", "-o", to, url], { stdio: ["ignore", "ignore", "inherit"] });
}

/** Both files in place and the program the recorded one, fetching what is not. Throws with the reason. */
function ensure() {
  // The licence header records the hash of the exe the zip held, so a later
  // run can see both are still the pinned build's without the zip.
  const held = fs.existsSync(LICENCE) ? fs.readFileSync(LICENCE, "utf8") : "";
  const recorded = (held.match(/SHA-256 of ffmpeg\.exe: ([0-9a-f]{64})/) || [])[1];
  if (held.includes("ffmpeg.exe " + VERSION) && recorded && fs.existsSync(EXE) && hashOf(EXE) === recorded) {
    return { version: VERSION, exe: EXE, licence: LICENCE, did: "there already" };
  }
  const zip = path.join(os.tmpdir(), "xsegon-ffmpeg-" + VERSION + ".zip");
  fetchTo(URL, zip);
  const got = hashOf(zip);
  if (got !== SHA256) {
    fs.rmSync(zip, { force: true });
    throw new Error("the zip from " + URL + " hashes to " + got + ", not the pinned " + SHA256 + ": thrown away");
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xsegon-ffmpeg-"));
  const inner = "ffmpeg-" + VERSION + "-essentials_build";
  execFileSync(TAR, ["-xf", zip, "-C", dir, inner + "/bin/ffmpeg.exe", inner + "/LICENSE"], { stdio: ["ignore", "ignore", "inherit"] });
  fs.rmSync(zip, { force: true });
  fs.copyFileSync(path.join(dir, inner, "bin", "ffmpeg.exe"), EXE);
  const text = fs.readFileSync(path.join(dir, inner, "LICENSE"), "utf8");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.writeFileSync(LICENCE, [
    "ffmpeg.exe " + VERSION + ", the video converter and cutter of the FFmpeg project",
    "(ffmpeg.org), built for Windows by Gyan Doshi (gyan.dev), whose builds",
    "ffmpeg.org's own download page lists.",
    "",
    "It is the official release essentials build, unchanged, from",
    "    " + URL,
    "    SHA-256 of the zip: " + SHA256,
    "    SHA-256 of ffmpeg.exe: " + hashOf(EXE),
    "(the builder publishes that checksum beside the zip, as",
    "    https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-" + VERSION + "-essentials_build.zip.sha256),",
    "and the source code is published at",
    "    https://ffmpeg.org/download.html (the source), https://www.gyan.dev/ffmpeg/builds/ (the build)",
    "",
    "Xsegon runs it for one thing: keeping the first 30 seconds of a World of",
    "Longplays recording as a game's video, read from the Internet Archive",
    "without fetching the whole file. It is not part of Xsegon and is not under",
    "Xsegon's licence. This build of ffmpeg is under the GNU GPL v3; the",
    "build's own LICENSE file follows.",
    "",
    "------------------------------------------------------------------------",
    "",
  ].join("\r\n") + text.replace(/\r?\n/g, "\r\n"));
  return { version: VERSION, exe: EXE, licence: LICENCE, did: "fetched, with its licence" };
}

module.exports = { ensure, VERSION, SHA256 };
if (require.main === module) {
  try { const r = ensure(); console.log("bin\\ffmpeg.exe " + r.version + ": " + r.did); }
  catch (e) { console.log("STOP: " + e.message); process.exit(1); }
}
