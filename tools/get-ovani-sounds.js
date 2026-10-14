/*  Ovani Sound's five sounds of the built-in set, for the package.

        node tools\get-ovani-sounds.js                         says whether they are in place
        node tools\get-ovani-sounds.js <folder of the pack>    copies in the ones that are missing

    They are from a bought pack ("Fantasy UI Sound FX Pack Vol. 1") and may
    not be handed out on their own, so they are in the download and not in
    git. tools\make-test-copy.js calls ensure() and inGit() before it packs. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SET = path.join(ROOT, "sounds", "Xsegon");
// Xsegon's name: the pack's name for the file, and its SHA-256. Ok and Startup are one file.
const SOUNDS = {
  "Move.wav":    ["Hovers A 001.wav",     "373802c5a82ea1731fec2c48c2fffa71dc7ab99177b44ce0daf4a83597a5e8ab"],
  "Select.wav":  ["Select A 003.wav",     "e99e75496e023cd7bcccd6e5cb0535d38410c7fb3c749dc76850a91eae5fef30"],
  "Back.wav":    ["Back A 004.wav",       "3d6b293f68f70824f839c44718d71847e8140920c1374838bd2450be5a0a4014"],
  "Ok.wav":      ["Transition A 002.wav", "9cb0aa4e874425e94f4a3df3c8d59d2aedbd1fc01d6d8b03f016a413389957b7"],
  "Startup.wav": ["Transition A 002.wav", "9cb0aa4e874425e94f4a3df3c8d59d2aedbd1fc01d6d8b03f016a413389957b7"],
};
const PINS = Object.fromEntries(Object.keys(SOUNDS).map((n) => [n, SOUNDS[n][1]]));

const hashOf = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** The five in the set's folder, each the pinned file, copied from the pack where one is missing. Throws with the reason. */
function ensure(pack, set = SET) {
  const missing = [];
  for (const n of Object.keys(SOUNDS)) {
    const f = path.join(set, n);
    if (!fs.existsSync(f)) { missing.push(n); continue; }
    // Another file under the name is someone's work: never written over.
    if (hashOf(f) !== PINS[n]) { throw new Error(f + " is not Ovani's file pinned in tools\\get-ovani-sounds.js: move it away, or change its pin on purpose"); }
  }
  if (!missing.length) { return { did: "there already" }; }
  const how = "node tools\\get-ovani-sounds.js <folder of the bought pack, Fantasy UI Sound FX Pack Vol. 1>";
  if (!pack) { throw new Error("sounds\\Xsegon has no " + missing.join(", ") + " (Ovani's sounds are not in git): run " + how); }
  if (!fs.existsSync(pack) || !fs.statSync(pack).isDirectory()) { throw new Error(pack + " is not a folder: run " + how); }
  // Found by name and contents, wherever in the folder given.
  const names = new Set(missing.map((n) => SOUNDS[n][0].toLowerCase()));
  const found = new Map();
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) { continue; }
      if (st.isDirectory()) { walk(p); continue; }
      if (names.has(n.toLowerCase())) { found.set(hashOf(p), p); }
    }
  })(pack);
  const lost = missing.filter((n) => !found.has(PINS[n]));
  if (lost.length) { throw new Error("not in " + pack + ", or not the files pinned here: " + [...new Set(lost.map((n) => SOUNDS[n][0]))].join(", ")); }
  fs.mkdirSync(set, { recursive: true });
  for (const n of missing) {
    fs.copyFileSync(found.get(PINS[n]), path.join(set, n));
    if (hashOf(path.join(set, n)) !== PINS[n]) { throw new Error(path.join(set, n) + " did not copy whole"); }
  }
  return { did: "copied from the pack: " + missing.join(", ") };
}

/**
 * Where git holds any of the five, by contents and under any name: the files
 * it tracks now, whether this branch's commits hold one, and whether what was
 * pushed does. null where there is no git to ask.
 */
function inGit(root = ROOT, set = SET) {
  const git = (a) => execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 });
  const ids = new Set();
  for (const n of Object.keys(SOUNDS)) {
    const f = path.join(set, n);
    if (!fs.existsSync(f)) { continue; }
    const bytes = fs.readFileSync(f);
    ids.add(crypto.createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex"));
  }
  const holds = (revs) => git(["rev-list", "--objects"].concat(revs)).split("\n").some((l) => ids.has(l.slice(0, 40)));
  try {
    const tracked = git(["ls-files", "-s", "-z"]).split("\0").filter((l) => ids.has(l.split(/\s+/)[1])).map((l) => l.slice(l.indexOf("\t") + 1));
    return { tracked: tracked, history: holds(["HEAD"]), pushed: holds(["--remotes"]) };
  } catch (e) { return null; }
}

module.exports = { ensure, inGit, PINS };
if (require.main === module) {
  try { console.log("sounds\\Xsegon, Ovani's five: " + ensure(process.argv[2]).did); }
  catch (e) { console.log("STOP: " + e.message); process.exit(1); }
  const held = inGit();
  if (held === null) { console.log("git: none here to ask"); }
  else {
    console.log("git: " + (held.tracked.length ? "TRACKS " + held.tracked.join(", ") : "tracks none of them") +
      "; this branch's commits " + (held.history ? "HOLD them" : "hold none") + "; what was pushed " + (held.pushed ? "HOLDS them" : "holds none"));
  }
}
