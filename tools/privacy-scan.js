/*  Nothing of this PC's goes into the public repo.

        node tools\privacy-scan.js              the files a fresh commit of this folder would hold
        node tools\privacy-scan.js --history    every commit reachable from HEAD, messages included
        node tools\privacy-scan.js --push       what a push sends (tools\hooks\pre-push passes it on)

    Stops with exit code 1 on: a word of this PC's (the Windows user name, the
    computer name, and each line of private\privacy-words.txt); a user folder
    other than the generic ones; an email address not in MAIL_OK; a sound
    kept out of git; a sound or picture with the bytes of one in LaunchBox's folder or
    data\; a file over 10 MB; anything under a folder in NEVER.
    The words are read on this PC, never written in a tracked file.        */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const WORDS_FILE = path.join(ROOT, "private", "privacy-words.txt");
const MAX_BYTES = 10 * 1024 * 1024;
const NEVER = ["data/", "private/", "runtime/", "roms/", "doc/img/"];
// noreply@github.com: GitHub's own, the committer of a pull request merged on its website.
const MAIL_OK = [/^help@tumultuousproductions\.site$/i, /@users\.noreply\.github\.com$/i, /^noreply@anthropic\.com$/i,
                 /@example\.(com|org|net)$/i, /^git@github\.com$/i, /^noreply@github\.com$/i];
// Folder names under X:\Users that name nobody.
const USER_OK = new Set(["public", "default", "all users", "you", "your name", "yourname", "name", "user", "username",
                         "someone", "me", "%username%", "<you>", "<name>", "<user>", "...", "josé"]);
// Third-party licences keep their authors' addresses word for word.
const LICENCE_FILE = /(^|\/)(LICEN[CS]E|COPYING)[^/]*$/i;
// Libraries in js\vendor are their releases byte for byte: an @ in minified code is theirs, never an address of ours.
const VENDOR_FILE = /^js\/vendor\//i;
const SOUND_EXT = /\.(wav|ogg|mp3|flac|m4a|aac|opus|wma)$/i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|svg|tiff?)$/i;
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const git = (args, opts) => execFileSync("git", args, Object.assign({ cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }, opts || {}));

/** This PC's words: read here, so none of them is written in the repo. */
function words() {
  const w = [];
  const me = (os.userInfo().username || "").trim();
  if (me.length >= 3) { w.push(me); }
  if ((process.env.COMPUTERNAME || "").length >= 3) { w.push(process.env.COMPUTERNAME); }
  if (fs.existsSync(WORDS_FILE)) {
    for (const l of fs.readFileSync(WORDS_FILE, "utf8").split(/\r?\n/)) {
      const t = l.trim();
      if (t && !t.startsWith("#")) { w.push(t); }
    }
  }
  return [...new Set(w.map((x) => x.toLowerCase()))];
}

/** Sizes and sums of every sound and picture in LaunchBox's folder and data\, keyed by size. */
function theirs() {
  const tops = [];
  try {
    const lb = String((JSON.parse(fs.readFileSync(path.join(ROOT, "data", "settings.json"), "utf8")).paths || {}).launchbox || "");
    if (lb) { tops.push([lb, true]); }
  } catch (e) { /* no settings: the usual place is still looked at */ }
  tops.push([path.join(os.homedir(), "LaunchBox"), true]);
  for (const n of ["sounds", "platform-art", "art", "media", "sounds-own"]) { tops.push([path.join(ROOT, "data", n), false]); }
  const bySize = new Map();
  const seen = new Set();
  for (const [top, isLb] of tops) {
    const key = path.resolve(top).toLowerCase();
    if (!fs.existsSync(top) || seen.has(key)) { continue; }
    seen.add(key);
    (function walk(d) {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        const st = fs.lstatSync(p);
        if (st.isSymbolicLink()) { continue; }
        // LaunchBox's Emulators folder holds RetroArch's own icons, which Xsegon ships under their licence.
        if (st.isDirectory()) { if (!(isLb && d === top && n.toLowerCase() === "emulators")) { walk(p); } continue; }
        if (!SOUND_EXT.test(n) && !IMG_EXT.test(n)) { continue; }
        if (!bySize.has(st.size)) { bySize.set(st.size, []); }
        bySize.get(st.size).push(p);
      }
    })(top);
  }
  return bySize;
}

/** The files a fresh commit of this folder would hold: not ignored, and on disk. */
function freshFiles() {
  const listed = git(["ls-files", "-z", "-c", "-o", "--exclude-standard"]).split("\0").filter(Boolean);
  const onDisk = [...new Set(listed)].filter((f) => fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).isFile());
  // Tracked files that .gitignore now names are left out of a fresh commit too.
  const r = spawnSync("git", ["check-ignore", "--no-index", "-z", "--stdin"], { cwd: ROOT, input: onDisk.join("\0") + "\0", maxBuffer: 1 << 28 });
  const ignored = new Set(String(r.stdout || "").split("\0").filter(Boolean));
  return onDisk.filter((f) => !ignored.has(f)).map((f) => ({ name: f, read: () => fs.readFileSync(path.join(ROOT, f)) }));
}

/** Blob contents by id, read in one go. */
function blobs(ids) {
  const out = new Map();
  if (!ids.length) { return out; }
  const r = spawnSync("git", ["cat-file", "--batch"], { cwd: ROOT, input: ids.join("\n") + "\n", maxBuffer: 1 << 30 });
  const buf = r.stdout;
  let at = 0;
  while (at < buf.length) {
    const nl = buf.indexOf(10, at);
    const head = buf.slice(at, nl).toString("utf8").split(" ");
    const size = Number(head[2]);
    out.set(head[0], buf.slice(nl + 1, nl + 1 + size));
    at = nl + 1 + size + 1;
  }
  return out;
}

/** The files and messages of these commits: what each one added or changed. */
function commitFiles(commits) {
  const files = [];
  const notes = [];
  const want = new Map();
  for (const c of commits) {
    const raw = git(["diff-tree", "-r", "--root", "--no-commit-id", "-z", "--diff-filter=AMRC", c]).split("\0");
    for (let i = 0; i + 1 < raw.length; i++) {
      if (!raw[i].startsWith(":")) { continue; }
      const id = raw[i].split(" ")[3];
      const status = raw[i].split(" ")[4] || "";
      const name = raw[i + (/^[RC]/.test(status) ? 2 : 1)];
      if (!/^0+$/.test(id)) { want.set(id + " " + name, { id, name: name + " (" + c.slice(0, 7) + ")" }); }
    }
    notes.push({ name: "message of " + c.slice(0, 7), text: git(["log", "-1", "--format=%an <%ae>%n%cn <%ce>%n%B", c]) });
  }
  const got = blobs([...new Set([...want.values()].map((w) => w.id))]);
  for (const w of want.values()) { files.push({ name: w.name, read: () => got.get(w.id) || Buffer.alloc(0) }); }
  return { files, notes };
}

// The sounds every package carries and git never holds, pinned in private\tools (none on a PC without it).
function keptOut() {
  try { return new Set(Object.values(require("../private/tools/sounds-kept").PINS)); } catch (e) { return new Set(); }
}

/** Every finding in these files and texts, as "where: what". */
function scan(files, notes) {
  const found = [];
  const ws = words();
  const kept = keptOut();
  const mine = [];
  // Whole words only: a three-letter computer name sits inside many others.
  const wordRe = ws.map((w) => [w, new RegExp("(?<![a-z0-9])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![a-z0-9])", "i")]);
  const look = (name, text) => {
    const lines = text.split(/\r?\n/);
    const file = name.split(" (")[0].replace(/\\/g, "/");
    const mailOk = LICENCE_FILE.test(file) || VENDOR_FILE.test(file);
    for (let i = 0; i < lines.length; i++) {
      for (const [w, re] of wordRe) { if (re.test(lines[i])) { found.push(name + ":" + (i + 1) + ": a word of this PC's (" + w + ")"); } }
      for (const m of lines[i].matchAll(/[A-Za-z]:[\\/]+Users[\\/]+([^\\/\s"'`<>|*?(),;:]+)/gi)) {
        if (!USER_OK.has(m[1].toLowerCase())) { found.push(name + ":" + (i + 1) + ": a user folder (" + m[0] + ")"); }
      }
      for (const m of lines[i].matchAll(/\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b|[\w-]+\.[\w-]+\.ts\.net\b/g)) {
        found.push(name + ":" + (i + 1) + ": a Tailscale address (" + m[0] + ")");
      }
      for (const m of lines[i].matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)*\.[A-Za-z]{2,}\b/g)) {
        if (!mailOk && !MAIL_OK.some((re) => re.test(m[0]))) { found.push(name + ":" + (i + 1) + ": an email address (" + m[0] + ")"); }
      }
    }
  };
  for (const f of files) {
    const n = f.name.split(" (")[0].replace(/\\/g, "/");
    if (NEVER.some((p) => n.toLowerCase().startsWith(p))) { found.push(f.name + ": a folder that never goes public"); continue; }
    const b = f.read();
    if (b.length > MAX_BYTES) { found.push(f.name + ": " + Math.round(b.length / 1048576) + " MB, over the 10 MB a repo file may be"); }
    if (SOUND_EXT.test(n) || IMG_EXT.test(n)) {
      if (kept.has(sha(b))) { found.push(f.name + ": a sound kept out of git, which is never in the repo"); }
      mine.push({ name: f.name, size: b.length, sum: sha(b) });
    }
    if (!b.slice(0, 8000).includes(0)) { look(f.name, b.toString("utf8")); }
  }
  for (const t of notes) { look(t.name, t.text); }
  const bySize = theirs();
  for (const m of mine) {
    for (const p of bySize.get(m.size) || []) {
      if (sha(fs.readFileSync(p)) === m.sum) { found.push(m.name + ": the same bytes as " + p); break; }
    }
  }
  return found;
}

/** The fresh-commit scan, for tools\make-test-copy.js --release. */
function fresh() { return scan(freshFiles(), []); }

function report(found, what) {
  if (found.length) {
    console.log("STOP: " + found.length + " thing" + (found.length === 1 ? "" : "s") + " of this PC's in " + what + ":");
    for (const f of found.slice(0, 200)) { console.log("  " + f); }
    if (found.length > 200) { console.log("  ... and " + (found.length - 200) + " more"); }
    process.exit(1);
  }
  console.log("privacy scan: nothing of this PC's in " + what + (fs.existsSync(WORDS_FILE) ? "" : " (no private\\privacy-words.txt here: only the user and computer names were looked for)"));
}

if (require.main === module) {
  const arg = process.argv[2] || "";
  if (arg === "--history" || arg === "--push") {
    let commits = [];
    if (arg === "--history") { commits = git(["rev-list", "HEAD"]).split(/\s+/).filter(Boolean); }
    else {
      // pre-push hands over one line per ref: local ref, local id, remote ref, remote id.
      for (const l of fs.readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean)) {
        const [, local, , remote] = l.split(" ");
        if (/^0+$/.test(local)) { continue; }
        // A new branch sends only what the remote has not got: what it has is public already.
        const range = /^0+$/.test(remote) ? [local, "--not", "--remotes"] : [remote + ".." + local];
        commits = commits.concat(git(["rev-list"].concat(range)).split(/\s+/).filter(Boolean));
      }
    }
    const { files, notes } = commitFiles([...new Set(commits)]);
    report(scan(files, notes), commits.length + " commit" + (commits.length === 1 ? "" : "s"));
  } else {
    const files = freshFiles();
    report(scan(files, []), "the " + files.length + " files a fresh commit would hold");
  }
}

module.exports = { fresh };
