/*  A copy of Xsegon to give someone to try, or the public download. Run from
    the Xsegon folder:

        node tools\make-test-copy.js <folder to make it in> [guide.html] [--with-launchbox] [--build v0.01]
        node tools\make-test-copy.js <folder> --release     the public download

    --build v0.01 names the package: it goes into Xsegon\BUILD with the commit
    and the day, and from there into each day's log and every report
    (includes\version.php), so a report says which copy it came from.

    What it makes there:

        Xsegon\                        the program, and nothing of this PC's:
                                       no data\ beyond the one setting below,
                                       no .git, no tests\, of doc\ only the
                                       changelog, and nothing named in LEAVE.
                                       bin\ carries 7zr.exe and ffmpeg.exe
                                       with their licences
        Xsegon\runtime\php\            the PHP this PC runs, where start.ps1
                                       looks first; its php.ini without the
                                       lines that name a folder on this PC
        Xsegon\runtime\RetroArch\      RetroArch's pinned archive and its
                                       licence, which setup unpacks
        Start Xsegon.bat               double-click to start

    and a .zip of all of it beside the folder; a guide page, when given, goes
    beside them as "How to test Xsegon.html". No Node.js goes in: the build
    stops if a node.exe is found in what it made.

    LaunchBox is switched off in a test copy (data\settings.json says its
    folder is nothing). --with-launchbox and --release leave that file out,
    so unzipping a newer download over an older one keeps a person's library.

    Nothing here writes data\; it is read only to make sure no sound or
    picture of LaunchBox's or this PC's goes in (the checks near the end).
    PHP sits in Xsegon\runtime under its own name with its licence: a known
    program under another name is what antivirus calls masquerading.      */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PHP = path.join(ROOT, "..", "php-8.5.4-nts-Win32-vs17-x64");
// --release: the public download (a GitHub Release). LaunchBox is left on,
// for whoever has it, as --with-launchbox does.
const release = process.argv.includes("--release");
const withLb = release || process.argv.includes("--with-launchbox");
const buildAt = process.argv.indexOf("--build");
const build = buildAt > 0 ? String(process.argv[buildAt + 1] || "") : "";
if (buildAt > 0 && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,23}$/.test(build)) { console.log("--build wants a short name, like v0.01"); process.exit(2); }
// A release says which version it is (RELEASE.json, below): copies compare it with the newest.
if (release && !/^v\d+(\.\d+){1,3}$/.test(build)) { console.log("--release wants --build with its version, like --build v0.15"); process.exit(2); }
const args = process.argv.slice(2).filter((a, i) => a !== "--with-launchbox" && a !== "--release" && a !== "--build" && i + 2 !== buildAt + 1);
const out = args[0];
if (!out) { console.log("say where: node tools\\make-test-copy.js <folder>"); process.exit(2); }
if (fs.existsSync(out) && fs.readdirSync(out).length) { console.log(out + " is not empty: choose a new folder"); process.exit(2); }

// Of doc\, only the changelog, which What's new reads. gamesdb\ is the Games
// Database; sounds\ the built-in interface sounds (includes\sounds.php).
//
// The only sounds a package may carry are those named here, by folder, name
// and contents: LaunchBox's packs are not ours to hand out. The checks below
// stop the build on any other sound file, a missing or changed one, or any
// sound or picture with the bytes of one in LaunchBox's folder or data\.
// A changed built-in sound means changing its line here, on purpose.
//   Xsegon     Ovani Sound's royalty-free set, the one a new copy starts on
//   Xsegon 2   Xsegon's own
// Each set's Ok is one of its other sounds: Startup's in Xsegon, Select's in Xsegon 2.
// Ovani's five (Move, Select, Back, Ok, Startup) are not in git: their lines
// are in tools\get-ovani-sounds.js, which puts the files in sounds\Xsegon.
const ovani = require("./get-ovani-sounds");
const BUILTIN_SOUNDS = {
  "Xsegon": Object.assign({}, ovani.PINS, {
    "Hover.wav":   "492f1108e0e0dd441be3c6eb962f6af62f8793fbc73feb1a3c9e6270ad618b3d",
  }),
  "Xsegon 2": {
    "Move.ogg":    "3889636ca6731519af5542df3c7bf8a3517f6ebe4a8a808e7069752b3f631f9b",
    "Select.wav":  "d421262dd4946b5e041f4aa4ee4253b923f6191926af2133c77740978a91772f",
    "Back.wav":    "73cc617a9c769941b1cfa9f168ae5bf74e83446b078f9288aba41e38931c722f",
    "Ok.wav":      "d421262dd4946b5e041f4aa4ee4253b923f6191926af2133c77740978a91772f",
  },
};
const SOUND_DIRS = Object.keys(BUILTIN_SOUNDS).map((n) => path.join("sounds", n));
const TAKE = ["api", "bin", "css", path.join("doc", "CHANGELOG.md"), "gamesdb", "img", "includes", "js", "phone", ...SOUND_DIRS, "themes", "index.php", "play.php", "router.php", "router-fast.php", "router-phone.php", "start.ps1", "LICENSE", "THIRD-PARTY.txt", "CONTRIBUTING.md"];
// The display guard lives in private\, which no package takes; by its name it is refused anywhere.
const LEAVE = [path.join("bin", "display-guard.ps1")];
// Of gamesdb\, these three and nothing else that may be lying there (a
// half-built file, an older packing).
const GAMESDB = ["README.md", "gamesdb.json", "gamesdb.sqlite.bz2"].map((n) => path.join("gamesdb", n));

function copy(from, to, rel) {
  if (LEAVE.includes(rel) || (path.dirname(rel) === "gamesdb" && !GAMESDB.includes(rel))) { return; }
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const n of fs.readdirSync(from)) { copy(path.join(from, n), path.join(to, n), path.join(rel, n)); }
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

// The packed Games Database goes in gamesdb\ (git-ignored, so it is built,
// not checked out): a download without it would have no descriptions until
// its first check for a newer one.
for (const f of ["gamesdb.sqlite.bz2", "gamesdb.json"]) {
  if (!fs.existsSync(path.join(ROOT, "gamesdb", f))) { console.log("STOP: no gamesdb\\" + f + ": run php tools\\build-gamesdb.php first"); process.exit(1); }
}
// The .bz2 must be the one the manifest describes, or the copy would refuse
// to unpack it on someone else's PC and say so there, not here.
{
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, "gamesdb", "gamesdb.json"), "utf8"));
  const sum = require("crypto").createHash("sha256").update(fs.readFileSync(path.join(ROOT, "gamesdb", "gamesdb.sqlite.bz2"))).digest("hex");
  if (m.sha256 !== sum) { console.log("STOP: gamesdb\\gamesdb.sqlite.bz2 is not the file gamesdb.json describes: run php tools\\build-gamesdb.php again"); process.exit(1); }
}
// 7-Zip's 7zr.exe and its licence go in bin\ (not in git either: fetched by
// version and checked against its hash, tools\get-7zr.js says why it is
// shipped). Get RetroArch turns to it when Windows' own tar cannot unpack.
let sevenZip;
try { sevenZip = require("./get-7zr").ensure(); console.log("7zr " + sevenZip.version + ": " + sevenZip.did); }
catch (e) { console.log("STOP: " + e.message + "; not making a package without bin\\7zr.exe"); process.exit(1); }
// ffmpeg goes in bin\ the same way (tools\get-ffmpeg.js says why it is shipped):
// Videos from online archives cuts World of Longplays recordings with it.
try { const ff = require("./get-ffmpeg").ensure(); console.log("ffmpeg " + ff.version + ": " + ff.did); }
catch (e) { console.log("STOP: " + e.message + "; not making a package without bin\\ffmpeg.exe"); process.exit(1); }
// RetroArch goes in runtime\RetroArch the same way (tools\get-retroarch.js): setup unpacks it, nothing downloaded.
let retroArch;
try { retroArch = require("./get-retroarch").ensure(); console.log("RetroArch " + retroArch.version + ": " + retroArch.did); }
catch (e) { console.log("STOP: " + e.message + "; not making a package without runtime\\RetroArch"); process.exit(1); }
// Ovani Sound's five sounds are in the download and never in git, where they
// would be handed out on their own: no package without them, or while git tracks one.
try { console.log("Ovani's sounds: " + ovani.ensure().did); }
catch (e) { console.log("STOP: " + e.message); process.exit(1); }
{
  const held = ovani.inGit();
  if (held === null) { console.log("Ovani's sounds: no git here, so not looked for in it"); }
  else if (held.tracked.length) { console.log("STOP: git tracks Ovani's sounds, which may not be in the repo: " + held.tracked.join(", ") + " (git rm --cached takes one out and leaves the file)"); process.exit(1); }
  else if (held.history) {
    // A public download means a public repo, and its older commits are public with it.
    const said = "Ovani's sounds are still in this branch's older commits" + (held.pushed ? ", and in what was pushed" : "") + ": the repo cannot be made public until its history is without them";
    if (release) { console.log("STOP: " + said); process.exit(1); }
    console.log("NOTE: " + said);
  }
}
// The public download goes with the public repo: neither carries anything of this PC's.
if (release) {
  const found = require("./privacy-scan").fresh();
  if (found.length) { console.log("STOP: the privacy scan found " + found.length + ":\n  " + found.slice(0, 50).join("\n  ") + "\n(node tools\\privacy-scan.js lists them all)"); process.exit(1); }
  console.log("privacy scan: nothing of this PC's in what the repo would hold");
}
// Every top-level thing git tracks is taken or named here as not for a package,
// so a new folder cannot be left out of the download unnoticed.
const NOT_TAKEN = [".gitignore", "README.md", "tests", "tools", "Welcome to Xsegon.html"];   // the welcome page goes beside Xsegon\, with --release
{
  let tracked = null;
  try { tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean); }
  catch (e) { console.log("NOTE: no git here, so what is tracked was not held against what is taken"); }
  if (tracked) {
    const taken = new Set(TAKE.map((t) => t.split(path.sep)[0]));
    const loose = [...new Set(tracked.map((f) => f.split("/")[0]))].filter((t) => !taken.has(t) && !NOT_TAKEN.includes(t));
    if (loose.length) { console.log("STOP: git tracks " + loose.join(", ") + ", which is neither taken nor left out on purpose (TAKE and NOT_TAKEN in tools\\make-test-copy.js)"); process.exit(1); }
  }
}
const app = path.join(out, "Xsegon");
for (const t of TAKE) { copy(path.join(ROOT, t), path.join(app, t), t); }
for (const n of ["7zr.exe", "7zr-LICENSE.txt"]) {
  if (!fs.existsSync(path.join(app, "bin", n))) { console.log("STOP: bin\\" + n + " did not reach the package"); process.exit(1); }
}
if (require("crypto").createHash("sha256").update(fs.readFileSync(path.join(app, "bin", "7zr.exe"))).digest("hex") !== sevenZip.sha256) {
  console.log("STOP: the 7zr.exe in the package is not the pinned one"); process.exit(1);
}
const RUNTIME = path.join(app, "runtime");
copy(PHP, path.join(RUNTIME, "php"), "");
copy(path.dirname(retroArch.archive), path.join(RUNTIME, "RetroArch"), "");
if (fs.statSync(path.join(RUNTIME, "RetroArch", "RetroArch.7z")).size !== require("./get-retroarch").BYTES) {
  console.log("STOP: the RetroArch.7z in the package is not the pinned one"); process.exit(1);
}

// Which copy this is: one line in Xsegon\BUILD, "v0.01 (<commit>, <day>)".
// "with changes" when what is packed holds work that is not committed yet, so
// the commit alone is never taken for the whole of what was packed. Work in
// tests\ or tools\ is not in a package and does not count.
if (build) {
  const git = (a) => { try { return execFileSync("git", a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch (e) { return null; } };
  const sha = git(["rev-parse", "--short=7", "HEAD"]);
  const dirty = sha !== null && git(["status", "--porcelain", "--"].concat(TAKE.map((p) => p.split(path.sep).join("/")))) !== "";
  const d = new Date();
  const day = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const line = build + " (" + (sha !== null ? sha + (dirty ? " with changes" : "") + ", " : "") + day + ")";
  fs.writeFileSync(path.join(app, "BUILD"), line + "\r\n");
  console.log("package " + line);
} else {
  console.log("no --build: this package will not say which copy it is");
}

// A release names its version and each of Xsegon's own files with its size and
// SHA-256 in a signed list (RELEASE.json and .sig, read by includes\version.php
// xs_release and bin\update.php), and makes the update the copies before it take:
// Xsegon-update-<v>.zip, .json and .sig beside the big zip, uploaded with it
// (tools\update-release.js). A tester's copy has none, so it never asks for a newer one.
if (release) {
  const ur = require("./update-release");
  if (!fs.existsSync(ur.PRIVATE_KEY)) { console.log("STOP: a release is signed, and there is no key yet: node tools\\update-release.js --new-key, once"); process.exit(1); }
  const made = ur.makeUpdate({ app, version: build.slice(1), key: ur.PRIVATE_KEY, out: path.dirname(path.resolve(out)) });
  console.log("release " + build.slice(1) + ": " + made.files + " of Xsegon's own files in the signed list; the update, "
    + (made.zipBytes / 1048576).toFixed(1) + " MB, and its list and signature beside the zip: upload all four");
}

// php.ini: the certificate lines name a folder on this PC; start.ps1 gives
// PHP the file beside php.exe instead. The value goes too, not only the
// line's effect: commented out, it still shows this PC's user name.
const ini = path.join(RUNTIME, "php", "php.ini");
if (fs.existsSync(ini)) {
  const text = fs.readFileSync(ini, "utf8").split(/\r?\n/)
    .map((l) => { const m = /^\s*;?\s*(curl\.cainfo|openssl\.cafile)\s*=/.exec(l); return m ? ";" + m[1] + " =   ; set by start.ps1" : l; }).join("\r\n");
  fs.writeFileSync(ini, text);
}

fs.writeFileSync(path.join(out, "Start Xsegon.bat"), [
  "@echo off",
  "rem Starts Xsegon: the app in Chrome or Edge, and its server out of sight.",
  "rem Closing Xsegon stops the server. A start that fails shows a window saying why.",
  "rem conhost.exe is the plain Windows console, the one a window can be hidden in",
  "rem (start.ps1 -Hidden). Where that will not start, the old way: the server in this window.",
  'start "" /min "%SystemRoot%\\System32\\conhost.exe" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0Xsegon\\start.ps1" -Hidden %* || powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Xsegon\\start.ps1" %*',
  "",
].join("\r\n"));

if (args[1]) { fs.copyFileSync(args[1], path.join(out, "How to test Xsegon.html")); }
// The public download opens beside the welcome page the repository keeps.
if (release && fs.existsSync(path.join(ROOT, "Welcome to Xsegon.html"))) {
  fs.copyFileSync(path.join(ROOT, "Welcome to Xsegon.html"), path.join(out, "Welcome to Xsegon.html"));
}

// LaunchBox off: the one setting the copy starts with.
const SEED = JSON.stringify({ paths: { launchbox: "" } }, null, 2) + "\n";
if (!withLb) {
  fs.mkdirSync(path.join(app, "data"), { recursive: true });
  fs.writeFileSync(path.join(app, "data", "settings.json"), SEED);
}

// Nothing of this PC's may have come along: no data file, and no file that
// says this PC's user name (a path written into a config file would). The
// big files are programs and the packed database, not places a path hides.
const leaks = [];
const named = [];
const USER = path.basename(require("os").homedir()).toLowerCase();
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (/^(settings|sessions|favourites|tags|local-games|scanned-games)\.json(l)?$/.test(n) &&
        !(n === "settings.json" && fs.readFileSync(p, "utf8") === SEED)) { leaks.push(p); }
    if (USER && st.size < 4 * 1048576 && fs.readFileSync(p, "latin1").toLowerCase().includes(USER)) { named.push(p); }
  }
})(out);
if (leaks.length || (fs.existsSync(path.join(app, "data")) && fs.readdirSync(path.join(app, "data")).some((n) => n !== "settings.json"))) { console.log("STOP: data came along: " + leaks.join(", ")); process.exit(1); }
if (named.length) { console.log("STOP: this PC's user name is in: " + named.join(", ")); process.exit(1); }
// And nothing that was to be left out: looked for by name anywhere in the
// package, in case it is ever moved or copied to another folder.
const came = [];
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    if (LEAVE.some((l) => path.basename(l).toLowerCase() === n.toLowerCase())) { came.push(p); }
  }
})(out);
if (came.length) { console.log("STOP: not for a package, and in it: " + came.join(", ")); process.exit(1); }
// No Node.js, and nothing only Node.js could use: a package runs on PHP alone.
const nodes = [];
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) { if (n.toLowerCase() === "node" || n === "node_modules") { nodes.push(p); } walk(p); continue; }
    if (/^node(\.exe)?$/i.test(n) || /\.br$/i.test(n)) { nodes.push(p); }
  }
})(out);
if (nodes.length) { console.log("STOP: Node.js, or a file only it reads, is in the package: " + nodes.join(", ")); process.exit(1); }
// The sounds: exactly the built-in sets named at the top, each file the one
// pinned there, each set with the note saying whose its sounds are, and no
// other sound file anywhere in the package (a LaunchBox pack, a pack of this
// PC's own, a folder dropped into sounds\, a sound renamed into a set).
const SOUND_EXT = /\.(wav|mp3|ogg|oga|opus|flac|m4a|aac|wma|aiff?|mid|midi)$/i;
const sumOf = (f) => require("crypto").createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const strays = [];
const shipped = [];
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    if (!SOUND_EXT.test(n)) { continue; }
    const set = path.relative(path.join(app, "sounds"), path.dirname(p));
    const pin = BUILTIN_SOUNDS[set] && Object.prototype.hasOwnProperty.call(BUILTIN_SOUNDS[set], n) ? BUILTIN_SOUNDS[set][n] : null;
    if (!pin) { strays.push(p); }
    else if (sumOf(p) !== pin) { strays.push(p + " (not the file pinned in tools\\make-test-copy.js)"); }
    else { shipped.push(p); }
  }
})(out);
if (strays.length) { console.log("STOP: a sound that is not one of the built-in sets is in the package: " + strays.join(", ")); process.exit(1); }
const lacking = [];
for (const set of Object.keys(BUILTIN_SOUNDS)) {
  for (const n of Object.keys(BUILTIN_SOUNDS[set]).concat(["ABOUT.txt"])) {
    if (!fs.existsSync(path.join(app, "sounds", set, n))) { lacking.push(path.join("sounds", set, n)); }
  }
}
if (lacking.length) { console.log("STOP: a built-in sound set is not whole, missing " + lacking.join(", ")); process.exit(1); }
// The console icons, photos and logos, each the file its tool fetched and wrote
// down in its sources.json: img\consoles with its credit (ABOUT.txt),
// img\console-photos (public domain, no credit owed), and img\console-logos
// with the note that they are still their owners' trademarks (ABOUT.txt).
for (const [folder, tool, about] of [["consoles", "node tools\\get-console-icons.js", true],
                                     ["console-photos", "php tools\\get-console-photos.php", false],
                                     ["console-logos", "php tools\\get-console-logos.php", true]]) {
  const dir = path.join(app, "img", folder);
  let src = null;
  try { src = JSON.parse(fs.readFileSync(path.join(dir, "sources.json"), "utf8")); } catch (e) { /* said below */ }
  if (!src || !src.files || (about && !fs.existsSync(path.join(dir, "ABOUT.txt")))) { console.log("STOP: img\\" + folder + " has no sources.json" + (about ? " or ABOUT.txt" : "") + ": run " + tool); process.exit(1); }
  const odd = fs.readdirSync(dir).filter((n) => n !== "sources.json" && n !== "ABOUT.txt" &&
    !(src.files[n] && sumOf(path.join(dir, n)) === src.files[n].sha256));
  if (odd.length) { console.log("STOP: in img\\" + folder + " but not as " + tool + " fetched it: " + odd.join(", ")); process.exit(1); }
}
// And nothing in the package is LaunchBox's, or this PC's own, under another
// name: every sound and picture compared by contents with those in LaunchBox's
// folder and in data\sounds, platform-art, art and media. LaunchBox's
// Emulators folder is left out: RetroArch's own copy of the icons is there.
{
  const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|svg|tiff?)$/i;
  const mine = [];
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (SOUND_EXT.test(n) || IMG_EXT.test(n)) { mine.push(p); }
    }
  })(out);
  const lbs = [];
  try {
    const lb = String((JSON.parse(fs.readFileSync(path.join(ROOT, "data", "settings.json"), "utf8")).paths || {}).launchbox || "");
    if (lb) { lbs.push(lb); }
  } catch (e) { /* no settings here: the usual place is still looked at */ }
  lbs.push(path.join(require("os").homedir(), "LaunchBox"));
  const theirs = lbs.concat(["sounds", "platform-art", "art", "media"].map((n) => path.join(ROOT, "data", n)));
  const ours = new Map(mine.map((p) => [sumOf(p), p]));
  const sizes = new Set(mine.map((p) => fs.statSync(p).size));
  const same = [];
  let looked = 0;
  const seen = new Map();   // the same folder named twice is looked at once
  for (const top of theirs) {
    if (!fs.existsSync(top) || seen.has(path.resolve(top).toLowerCase())) { continue; }
    seen.set(path.resolve(top).toLowerCase(), path.resolve(top));
    const isLb = lbs.some((l) => path.resolve(l).toLowerCase() === path.resolve(top).toLowerCase());
    (function walk(d) {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        const st = fs.lstatSync(p);
        if (st.isSymbolicLink()) { continue; }
        if (st.isDirectory()) { if (!(isLb && d === top && n.toLowerCase() === "emulators")) { walk(p); } continue; }
        if (!SOUND_EXT.test(n) && !IMG_EXT.test(n)) { continue; }
        looked++;
        const s = sizes.has(st.size) ? sumOf(p) : "";
        if (ours.has(s)) { same.push(ours.get(s) + " is " + p); }
      }
    })(top);
  }
  if (same.length) { console.log("STOP: a sound or picture in the package is LaunchBox's, or this PC's own: " + same.join(", ")); process.exit(1); }
  console.log("sounds: " + shipped.length + " in " + Object.keys(BUILTIN_SOUNDS).length + " built-in sets; " +
    "sounds and pictures: " + mine.length + " in the package, none the same as any of " + looked + " in " +
    (seen.size ? [...seen.values()].join(", ") : "no LaunchBox or data folder on this PC"));
}

const zip = out.replace(/[\\/]+$/, "") + ".zip";
fs.rmSync(zip, { force: true });
execFileSync("powershell.exe", ["-NoProfile", "-Command",
  "Compress-Archive -Path (Join-Path $env:XS_OUT '*') -DestinationPath $env:XS_ZIP -CompressionLevel Optimal"],
  { env: Object.assign({}, process.env, { XS_OUT: out, XS_ZIP: zip }), stdio: "inherit" });
console.log("made " + out + "\nand  " + zip + " (" + Math.round(fs.statSync(zip).size / 1048576) + " MB)");
