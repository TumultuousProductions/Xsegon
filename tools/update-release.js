/*  What a release carries for updating Xsegon (roadmap BD1 and BD4), made by
    tools\make-test-copy.js --release and by the tests with a key of their own.

        node tools\update-release.js --new-key

    makes the signing key once: private\update-key.pem, which signs every
    release and never goes in git (keep a copy on a USB stick: without it no
    copy can take an update until it is downloaded by hand), and its public
    half in includes\update-key.pem, which every copy carries and trusts.

    makeUpdate({ app, version, key, out }) lists Xsegon's own files in the
    package folder app (size and SHA-256), zips them, signs the list, writes
    RELEASE.json and RELEASE.sig beside app's index.php, and writes the three
    files to upload beside the big zip into out:
        Xsegon-update-<v>.zip     Xsegon's own files, for bin\update.php
        Xsegon-update-<v>.json    the list, with the zip's size and SHA-256
        Xsegon-update-<v>.sig     the list's signature (ECDSA P-256, SHA-256)
    It first writes NOTE into app, so a person who opens the update zip by
    mistake reads what it is and where the whole program is.
    The big parts are left out, each pinned by its own tool and updated apart:
    PHP and RetroArch (runtime\), 7zr, ffmpeg and the Games Database.          */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PRIVATE_KEY = path.join(ROOT, "private", "update-key.pem");
const PUBLIC_KEY = path.join(ROOT, "includes", "update-key.pem");
const TAR = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");

const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

// On the signed list, so every copy carries it too: its words are true in a copy and in the update zip alike.
const NOTE = "READ ME - how to start Xsegon.txt";
const NOTE_TEXT = [
  "To start Xsegon, double-click Start Xsegon.bat in the folder above this one.",
  "",
  "No Start Xsegon.bat there? Then you have Xsegon's update files, which Xsegon",
  "downloads by itself to update. They are not the program and cannot run on",
  "their own. Get the whole program here, the file marked Windows install:",
  "",
  "https://github.com/TumultuousProductions/Xsegon/releases/latest",
  "",
].join("\r\n");

/** Xsegon's own files in a package folder, by path with forward slashes: what an update replaces. */
function ownFiles(app) {
  const files = {};
  (function walk(d, rel) {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n), r = rel ? rel + "/" + n : n;
      if (fs.statSync(p).isDirectory()) {
        if (!(rel === "" && ["runtime", "gamesdb", "data", "private", "custom", ".git"].includes(n))) { walk(p, r); }
      } else if (!(rel === "" && /^RELEASE\.(json|sig)$/.test(n)) && !/^bin\/(7zr|ffmpeg)/i.test(r)) {
        files[r] = { size: fs.statSync(p).size, sha256: sha(p) };
      }
    }
  })(app, "");
  return files;
}

function makeUpdate({ app, version, key, out }) {
  if (!/^\d+(\.\d+){1,3}$/.test(version)) { throw new Error("a version is numbers and dots, like 0.15"); }
  const priv = fs.readFileSync(key, "utf8");
  // The copy must trust this key, or no copy of this release could take the next one.
  // Compared as keys, not text: git on Windows gives the file CRLF line ends.
  const der = (k) => crypto.createPublicKey(k).export({ type: "spki", format: "der" });
  const shipped = path.join(app, "includes", "update-key.pem");
  let same = false;
  try { same = fs.existsSync(shipped) && der(fs.readFileSync(shipped, "utf8")).equals(der(priv)); } catch (e) { same = false; }
  if (!same) {
    throw new Error("includes\\update-key.pem in the package is not the public half of " + key);
  }
  fs.writeFileSync(path.join(app, NOTE), NOTE_TEXT);
  const files = ownFiles(app);
  fs.mkdirSync(out, { recursive: true });
  // Staged apart, so the zip holds exactly the listed files and nothing of runtime\ or data\.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "xsegon-update-"));
  const zipName = "Xsegon-update-" + version + ".zip";
  const zip = path.join(out, zipName);
  try {
    for (const r of Object.keys(files)) {
      fs.mkdirSync(path.dirname(path.join(stage, r)), { recursive: true });
      fs.copyFileSync(path.join(app, r), path.join(stage, r));
    }
    fs.rmSync(zip, { force: true });
    // Windows' own tar writes a .zip by its name (-a), as Xsegon reads one (includes\unpack.php).
    execFileSync(TAR, ["-a", "-c", "-f", zip, "-C", stage].concat(fs.readdirSync(stage)), { stdio: "ignore" });
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  const list = JSON.stringify({ app: "Xsegon", version, made: new Date().toISOString(),
    zip: { name: zipName, size: fs.statSync(zip).size, sha256: sha(zip) }, files }, null, 1) + "\n";
  const sig = crypto.sign("sha256", Buffer.from(list, "utf8"), priv).toString("base64") + "\n";
  fs.writeFileSync(path.join(out, "Xsegon-update-" + version + ".json"), list);
  fs.writeFileSync(path.join(out, "Xsegon-update-" + version + ".sig"), sig);
  fs.writeFileSync(path.join(app, "RELEASE.json"), list);
  fs.writeFileSync(path.join(app, "RELEASE.sig"), sig);
  return { files: Object.keys(files).length, zip, zipBytes: fs.statSync(zip).size };
}

/** A new key pair: the private half where asked (never in git), the public half where the copies read it. */
function newKey(privFile, pubFile) {
  const pair = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  fs.mkdirSync(path.dirname(privFile), { recursive: true });
  fs.writeFileSync(privFile, pair.privateKey, { flag: "wx" });   // never over a key that exists
  fs.writeFileSync(pubFile, pair.publicKey);
}

module.exports = { ownFiles, makeUpdate, newKey, PRIVATE_KEY, PUBLIC_KEY, NOTE };

if (require.main === module) {
  if (!process.argv.includes("--new-key")) { console.log("node tools\\update-release.js --new-key   (see the top of this file)"); process.exit(2); }
  if (fs.existsSync(PRIVATE_KEY)) { console.log("there is a key already: " + PRIVATE_KEY + " (a new one would stop every copy taking updates)"); process.exit(1); }
  newKey(PRIVATE_KEY, PUBLIC_KEY);
  console.log("the signing key: " + PRIVATE_KEY + "\n  never in git; put a copy on a USB stick now");
  console.log("its public half: " + PUBLIC_KEY + "\n  commit this one: every copy carries it");
}
