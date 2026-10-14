/* Backing up and putting back the things only you have.
 * The whole round trip on the data folder: makes an archive, reads it with a
 * reader of its own (not the code that wrote it), spoils a file, restores that
 * part, and checks the file came back and nothing else moved.
 * Every archive it makes is deleted at the end; the files it spoils are in the
 * runner's protected list.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");
const { api, BASE, DATA, sleep } = require("./lib");

/* A zip reader of its own, so "it is a real zip" is not judged by the code
   that wrote it. Central directory only: enough to list names and read one. */
function unzip(file) {
  const buf = fs.readFileSync(file);
  let at = buf.length - 22;
  while (at >= 0 && buf.readUInt32LE(at) !== 0x06054b50) { at--; }
  if (at < 0) { throw new Error("no end record: not a zip"); }
  const count = buf.readUInt16LE(at + 10);
  let p = buf.readUInt32LE(at + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) { throw new Error("bad central header"); }
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    out.push({ name, method, crc, csize, usize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: out.map((e) => e.name),
    entries: out,
    read(name) {
      const e = out.find((x) => x.name === name);
      if (!e) { throw new Error("no such entry: " + name); }
      const nameLen = buf.readUInt16LE(e.offset + 26);
      const extraLen = buf.readUInt16LE(e.offset + 28);
      const start = e.offset + 30 + nameLen + extraLen;
      const body = buf.slice(start, start + e.csize);
      const data = e.method === 8 ? zlib.inflateRawSync(body) : body;
      if (data.length !== e.usize) { throw new Error("wrong size for " + name); }
      return data;
    },
  };
}

/* A zip written here, stored and nothing else: what a person makes by hand,
   or a zip that has nothing to do with Xsegon. */
function zipOf(entries) {
  const crc = (buf) => {
    let c = ~0;
    for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) { c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } }
    return ~c >>> 0;
  };
  const locals = [], central = [];
  let at = 0;
  for (const [name, text] of Object.entries(entries)) {
    const n = Buffer.from(name), d = Buffer.from(text), head = Buffer.alloc(26);
    head.writeUInt16LE(20, 0); head.writeUInt32LE(crc(d), 10); head.writeUInt32LE(d.length, 14); head.writeUInt32LE(d.length, 18);
    head.writeUInt16LE(n.length, 22);
    const where = Buffer.alloc(14);
    where.writeUInt32LE(at, 10);
    locals.push(Buffer.from("PK\x03\x04", "latin1"), head, n, d);
    central.push(Buffer.from("PK\x01\x02\x14\x00", "latin1"), head, where, n);
    at += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.write("PK\x05\x06", 0, "latin1"); end.writeUInt16LE(central.length / 4, 8); end.writeUInt16LE(central.length / 4, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat([...locals, cd, end]);
}

module.exports = async function (b, check) {
  const mine = [];                       // archives this run made, deleted at the end
  const outDir = path.join(DATA, "xs-test-export"), answer = path.join(DATA, "pick-answer.txt");

  try {
    // ---- what it says is precious ----
    const health = await api("api/backup.php");
    check("backup health answers", health.ok === true);
    const keys = (health.parts || []).map((p) => p.key);
    check("it names every part", keys.join(","), "art,platform-art,video-own,edits,marks,own,history,settings");
    check("and counts what would go in", health.files > 0 && health.bytes > 0);
    const left = (health.skipped || []).map((s) => s.path);
    check("the copies and caches are left out", left.includes("media") && left.includes("thumbs") && left.includes("gamesdb.sqlite"));
    check("it says where the archives are kept", typeof health.dir === "string" && health.dir.length > 3);

    // ---- making one ----
    // With a picture still on its way in, as Get Pictures leaves one mid-download.
    const halfPic = path.join(DATA, "art", ".fetch-xs-test-zz-box.part");
    fs.mkdirSync(path.dirname(halfPic), { recursive: true });
    fs.writeFileSync(halfPic, "half a picture");
    // Your keyboard keys per console must be in the backup with your buttons.
    const keysFile = path.join(DATA, "pad-keys.json"), hadKeys = fs.existsSync(keysFile);
    if (!hadKeys) { fs.writeFileSync(keysFile, "{}"); }
    const made = await api("api/backup.php", { action: "make" });
    if (!hadKeys) { fs.rmSync(keysFile, { force: true }); }
    check("a backup is made", made.ok === true && made.made && made.made.files > 0);
    if (!made.ok) { return; }
    mine.push(made.made.name);
    check("and is listed afterwards", (made.backups || []).some((x) => x.name === made.made.name));
    check("with the age of the newest one", made.ageHours === 0);
    // Said only once every file in it has been read back, and under a working name until then.
    check("it was read back whole before it was said to be made", [made.made.checked, made.made.large], [made.made.files, false]);
    check("and no archive is left under its working name", fs.readdirSync(made.made.dir).filter((n) => /\.part$/.test(n)), []);
    check("a backup this size is said to be an ordinary zip", health.large, false);

    // ---- it is a zip, read by something else ----
    const file = path.join(made.made.dir, made.made.name);
    const zip = unzip(file);
    check("the archive is a readable zip", zip.names.length, made.made.files);
    check("it carries a manifest", zip.names.includes("manifest.json"));
    const manifest = JSON.parse(zip.read("manifest.json").toString("utf8"));
    check("the manifest says when and what", !!manifest.made && !!manifest.parts.art);
    check("it is laid out like data\\", zip.names.some((n) => n.startsWith("art/")) && zip.names.includes("overrides.json"));
    check("a picture still on its way in is left out", zip.names.some((n) => /\.(part|tmp)$/.test(n)), false);
    check("your keyboard keys per console go in with your buttons", zip.names.includes("pad-keys.json"), true);
    fs.rmSync(halfPic, { force: true });
    const inZip = zip.read("overrides.json");
    check("and an entry comes out byte for byte",
      Buffer.compare(inZip, fs.readFileSync(path.join(DATA, "overrides.json"))), 0);
    check("text goes in packed, and a picture as it is",
      [(zip.entries.find((e) => e.name === "manifest.json") || {}).method,
       zip.entries.filter((e) => /\.(png|jpe?g|webp|gif)$/i.test(e.name)).every((e) => e.method === 0)], [8, true]);

    /* The zip driven directly (tests\zip-probe.php): the form past 4 GB, and a
       damaged archive caught by the read-back, neither reachable from the screen. */
    const exe = ((await api("api/status.php")).build || {}).phpExe;
    let rows = [];
    try {
      rows = JSON.parse(execFileSync(exe, [path.join(__dirname, "zip-probe.php")],
        { encoding: "utf8", env: Object.assign({}, process.env, { XSEGON_DATA: DATA }) }).trim().split("\n").pop());
    } catch (e) { check("the zip probe ran", String(e.message || e).slice(0, 300), "valid JSON"); }
    for (const r of rows) { check(r.name, r.got, r.want); }

    // ---- what a restore would land on ----
    const seen = await api("api/backup.php", { action: "inspect", name: made.made.name });
    check("a backup can be looked into", seen.ok === true && seen.backup.parts.length > 0);
    const edits = seen.backup.parts.find((p) => p.key === "edits");
    check("nothing has changed since, so nothing would be replaced", edits.same >= 1 && edits.replace === 0 && edits.add === 0);
    check("and nothing in it is a stranger", seen.backup.stray.length, 0);

    // ---- the round trip: spoil one file, put that part back ----
    const overrides = path.join(DATA, "overrides.json");
    const before = fs.readFileSync(overrides);
    const favourites = path.join(DATA, "favourites.json");
    const favBefore = fs.readFileSync(favourites);
    fs.writeFileSync(overrides, '{"xs-test-spoiled":true}');

    const seen2 = await api("api/backup.php", { action: "inspect", name: made.made.name });
    const edits2 = seen2.backup.parts.find((p) => p.key === "edits");
    check("a changed file is reported as one that would be replaced", edits2.replace, 1);

    /* A restore writes the whole part asked for, so the count is what that part
       holds, asked of the server: a literal breaks whenever a file joins the part. */
    const editsHolds = (health.parts.find((p) => p.key === "edits") || {}).count;
    const put = await api("api/backup.php", { action: "restore", name: made.made.name, parts: ["edits"] });
    check("the restore reports what it wrote", put.ok === true && put.restored.written, editsHolds);
    check("your edits are back, byte for byte", Buffer.compare(fs.readFileSync(overrides), before), 0);
    check("and nothing outside the part asked for was touched",
      Buffer.compare(fs.readFileSync(favourites), favBefore), 0);

    // the safety copy taken before the restore
    check("a copy of what was there first was taken", typeof put.restored.safety === "string" && put.restored.safety.includes("before-restore"));
    mine.push(put.restored.safety);
    const safety = unzip(path.join(made.made.dir, put.restored.safety));
    check("and it holds the spoiled file, not the good one",
      safety.read("overrides.json").toString("utf8"), '{"xs-test-spoiled":true}');

    /* ---- the play logs are added to, not written over ----
       A line only on disk survives the restore; a line only in the archive comes back. */
    const sessions = path.join(DATA, "sessions.jsonl");
    const sessBefore = fs.readFileSync(sessions, "utf8");
    const fresh = JSON.stringify({ id: "xs-test-session", at: "2099-01-01T00:00:00+00:00", seconds: 7 });
    fs.writeFileSync(sessions, sessBefore.replace(/\n?$/, "\n") + fresh + "\n");

    const seen3 = await api("api/backup.php", { action: "inspect", name: made.made.name });
    const hist = seen3.backup.parts.find((p) => p.key === "history");
    check("a play log is reported as one that would be merged", hist.merge >= 1 && hist.replace, 0);

    const put2 = await api("api/backup.php", { action: "restore", name: made.made.name, parts: ["history"] });
    check("the restore says it merged", put2.ok === true && put2.restored.merged >= 1);
    mine.push(put2.restored.safety);
    const after = fs.readFileSync(sessions, "utf8");
    check("the newer session is still there", after.includes("xs-test-session"));
    // A merge rewrites the file with one line ending, so compare the lines
    // themselves: a log may hold CRLF lines.
    check("and the archived ones came back too",
      sessBefore.split(/\r?\n/).filter(Boolean).every((l) => after.includes(l.replace(/\r$/, ""))));
    check("with nothing counted twice",
      after.split("\n").filter((l) => l.includes("xs-test-session")).length, 1);
    fs.writeFileSync(sessions, sessBefore);

    // ---- what it refuses ----
    const noName = await api("api/backup.php", { action: "restore", name: "../../settings.json", parts: ["edits"] });
    check("a name that is not a backup is refused", noName.ok === false);
    const noParts = await api("api/backup.php", { action: "restore", name: made.made.name, parts: [] });
    check("a restore with nothing chosen is refused", noParts.ok === false);
    const noAction = await api("api/backup.php", { action: "wat" });
    check("an unknown action is refused", noAction.ok === false);
    const foreign = await fetch(BASE + "/api/backup.php", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
      body: JSON.stringify({ action: "make" }),
    });
    check("a foreign origin cannot make one", foreign.status === 403 || (await foreign.json()).ok === false);

    /* ---- export to a folder, import from a file ----
       An import is only copied in and listed: nothing is put back by it. */
    fs.mkdirSync(outDir, { recursive: true });
    const exp = await api("api/backup.php", { action: "export", dir: outDir });
    const expFile = path.join(outDir, (exp.made || {}).name || "none");
    check("an export writes the archive into the folder chosen", [exp.ok, fs.existsSync(expFile)], [true, true]);
    check("and it holds what a backup holds", unzip(expFile).names.length, (await api("api/backup.php")).files + 1);
    const noDir = await api("api/backup.php", { action: "export", dir: path.join(DATA, "xs-test-no-such-folder") });
    check("an export to a folder that is not there is refused, saying so", [noDir.ok, /not there/.test(noDir.error || "")], [false, true]);

    // carried off under a name of the person's own, as from another PC
    const carried = path.join(outDir, "my library.zip");
    fs.renameSync(expFile, carried);
    const favNow = fs.readFileSync(favourites);
    const imp = await api("api/backup.php", { action: "import", file: carried });
    check("an import takes a backup in from anywhere", [imp.ok, (imp.imported || {}).already], [true, false]);
    if (imp.ok) { mine.push(imp.imported.name); }
    check("under a name Xsegon knows, whatever the file was called", /^xsegon-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.zip$/.test((imp.imported || {}).name || ""));
    check("it is listed with the others, every file counted",
      ((imp.backups || []).find((x) => x.name === imp.imported.name) || {}).files, exp.made.files - 1);
    check("and nothing was put back by importing", Buffer.compare(fs.readFileSync(favourites), favNow), 0);
    const twice = await api("api/backup.php", { action: "import", file: carried });
    check("the same file brought in twice is not doubled", [twice.ok, twice.imported.already, twice.imported.name], [true, true, imp.imported.name]);
    const seenImp = await api("api/backup.php", { action: "inspect", name: imp.imported.name });
    check("an imported backup opens for restoring like any other", seenImp.ok === true && seenImp.backup.parts.length > 0);

    // three days ago, to the minute, written the way the list and a backup's name write it
    const old = new Date(Date.now() - 3 * 86400000);
    old.setSeconds(0, 0);
    const p2 = (n) => String(n).padStart(2, "0");
    const oldDay = old.getFullYear() + "-" + p2(old.getMonth() + 1) + "-" + p2(old.getDate());
    const byHand = path.join(outDir, "by hand.zip");
    fs.writeFileSync(byHand, zipOf({ "favourites.json": favNow }));
    fs.utimesSync(byHand, old, old);
    const hand = await api("api/backup.php", { action: "import", file: byHand });
    if (hand.ok) { mine.push(hand.imported.name); }
    check("a zip made by hand, with no manifest, is taken in", [hand.ok, (hand.imported || {}).files], [true, 1]);
    check("named and dated for the day it was made, not for today",
      [(hand.imported || {}).name, ((hand.backups || []).find((x) => x.name === hand.imported.name) || {}).at],
      ["xsegon-" + oldDay + "-" + p2(old.getHours()) + p2(old.getMinutes()) + ".zip", oldDay + " " + p2(old.getHours()) + ":" + p2(old.getMinutes())]);
    check("so an old one brought in is not the newest", (hand.newest || {}).name !== (hand.imported || {}).name);

    const before2 = fs.readdirSync(made.made.dir).length;
    const stranger = path.join(outDir, "holiday.zip");
    fs.writeFileSync(stranger, zipOf({ "photos/beach.txt": "sand" }));
    const strange = await api("api/backup.php", { action: "import", file: stranger });
    check("a zip with nothing of Xsegon's in it is refused, saying so", [strange.ok, /not an Xsegon backup/.test(strange.error || "")], [false, true]);
    const words = path.join(outDir, "notes.zip");
    fs.writeFileSync(words, "not a zip at all, only words in a file named like one");
    const notZip = await api("api/backup.php", { action: "import", file: words });
    check("so is a file that is only named .zip", [notZip.ok, /not a zip/.test(notZip.error || "")], [false, true]);
    const gone = await api("api/backup.php", { action: "import", file: path.join(outDir, "nothing here.zip") });
    check("and one that is not there", [gone.ok, /not there/.test(gone.error || "")], [false, true]);
    check("none of the refused ones was copied in", fs.readdirSync(made.made.dir).length, before2);

    /* ---- not under a job that writes what a restore puts back ----
       Faked with this runner's own process id, so the server sees a live worker. */
    const fillJob = path.join(DATA, "fill-job.json");
    const fillWas = fs.existsSync(fillJob) ? fs.readFileSync(fillJob) : null;
    fs.writeFileSync(fillJob, JSON.stringify({ mode: "all", state: "running", phase: "first", pid: process.pid, started: Math.floor(Date.now() / 1000), total: 1, done: 0 }));
    const underFill = await api("api/backup.php", { action: "restore", name: made.made.name, parts: ["edits"] });
    check("a restore waits for Get Pictures, and says how to stop it",
          [underFill.ok, /Get Pictures is still at work/.test(underFill.error || "") && /Stop/.test(underFill.error || "")], [false, true]);
    if (fillWas) { fs.writeFileSync(fillJob, fillWas); } else { fs.rmSync(fillJob, { force: true }); }
    const rcStatus = path.join(DATA, "runcheck", "status.json");
    const rcWas = fs.existsSync(rcStatus) ? fs.readFileSync(rcStatus) : null;
    fs.mkdirSync(path.dirname(rcStatus), { recursive: true });
    fs.writeFileSync(rcStatus, JSON.stringify({ running: true, pid: process.pid, index: 1, total: 2 }));
    const underCheck = await api("api/backup.php", { action: "restore", name: made.made.name, parts: ["edits"] });
    check("and for the Runs check, which puts the play history back when it ends",
          [underCheck.ok, /Runs check is still going/.test(underCheck.error || "")], [false, true]);
    if (rcWas) { fs.writeFileSync(rcStatus, rcWas); } else { fs.rmSync(rcStatus, { force: true }); }

    /* ---- a restore is all or nothing ----
       A folder where one working copy has to go: the restore must say so and
       leave every file as it was. */
    const blocker = overrides + ".restoring";
    fs.writeFileSync(overrides, '{"xs-test-spoiled-again":true}');
    fs.mkdirSync(blocker);
    try {
      const cut = await api("api/backup.php", { action: "restore", name: made.made.name, parts: ["edits"] });
      check("a restore that cannot write every file is refused", cut.ok, false);
      check("and says nothing was restored", /Nothing was restored: every file is as it was/.test(cut.error || ""), true);
      check("the file it would have replaced is as it was", fs.readFileSync(overrides, "utf8"), '{"xs-test-spoiled-again":true}');
      check("and no working copy is left lying about",
        fs.readdirSync(DATA).filter((n) => n.endsWith(".restoring") && n !== path.basename(blocker)), []);
    } finally {
      fs.rmSync(blocker, { recursive: true, force: true });
      fs.writeFileSync(overrides, before);
      for (const n of fs.readdirSync(made.made.dir)) { if (n.includes("before-restore") && !mine.includes(n)) { mine.push(n); } }
    }

    /* ---- a backup says what it could not read ----
       A file held by another program must be named, not left out silently. */
    const { spawn } = require("child_process");
    const holder = spawn("powershell.exe", ["-NoProfile", "-Command",
      "$f = [System.IO.File]::Open($env:XS_HOLD, 'Open', 'ReadWrite', 'None'); 'held'; Start-Sleep 20; $f.Close()"],
      { env: Object.assign({}, process.env, { XS_HOLD: overrides }), windowsHide: true });
    try {
      const held = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), 15000);
        holder.stdout.on("data", (d) => { if (/held/.test(String(d))) { clearTimeout(t); resolve(true); } });
      });
      check("(another program takes hold of overrides.json)", held, true);
      const part = await api("api/backup.php", { action: "make" });
      if (part.ok) { mine.push(part.made.name); }
      check("a backup made then still answers, and names the file it could not read", [part.ok, (part.made || {}).missed], [true, ["overrides.json"]]);
      check("and holds one file fewer", (part.made || {}).files, made.made.files - 1);
    } finally {
      holder.kill();
      await new Promise((r) => setTimeout(r, 600));
    }
    check("a backup with nothing held misses nothing", made.made.missed, []);

    // ---- the screen ----
    await b.goto(BASE + "/");
    await sleep(600);
    await b.ev(`document.getElementById("btn-settings").click()`);
    await sleep(600);
    await b.ev(`(function(){ var t=[...document.querySelectorAll('#settings .set-tab')].find(r=>/Library/.test(r.textContent));
                              t.dispatchEvent(new MouseEvent('mousemove',{bubbles:true})); t.click(); })()`);
    await sleep(400);
    await b.ev(`[...document.querySelectorAll('#settings button')].find(x=>x.textContent.trim()==='Back up...').click()`);
    await b.waitFor(`(document.querySelector('#editor .panel-title') || {}).textContent === 'BACK UP WHAT YOU MADE'`);
    check("Settings > Library opens the backup screen",
      await b.ev(`(document.querySelector('#editor .panel-title')||{}).textContent`), "BACK UP WHAT YOU MADE");
    check("it lists every part", await b.ev(`document.querySelectorAll('#editor .bk-part').length`), 8);
    check("it names the newest backup",
      await b.ev(`[...document.querySelectorAll('#editor .mt-row')].some(r=>/Newest backup/.test(r.textContent) && /2026|just now/.test(r.textContent))`));
    check("the title is on screen, not above it",
      await b.ev(`document.querySelector('#editor .panel-title').getBoundingClientRect().top`) > 0);
    check("the archives on hand are listed",
      await b.ev(`document.querySelectorAll('#editor .bk-row').length`) >= 1);

    // The safety archive by name, not "the first row": it differs from the disk
    // (it holds the spoiled file), and rows can tie on their timestamps.
    await b.ev(`(function(){
      var row = [...document.querySelectorAll('#editor .bk-row')].find(r => r.textContent.indexOf(${JSON.stringify(put.restored.safety)}) >= 0);
      [...row.querySelectorAll('button')].find(x => /Restore/.test(x.textContent)).click();
    })()`);
    await b.waitFor(`(document.querySelector('#editor .panel-title') || {}).textContent === 'RESTORE FROM A BACKUP'`);
    check("Restore opens a screen of its own",
      await b.ev(`(document.querySelector('#editor .panel-title')||{}).textContent`), "RESTORE FROM A BACKUP");
    check("with a checkbox for each part and what it would do",
      await b.ev(`document.querySelectorAll('#editor .bk-pick input[type=checkbox]').length`) >= 6);
    check("and it says what is already the same",
      await b.ev(`[...document.querySelectorAll('#editor .bk-help')].some(n=>/already the same/.test(n.textContent))`));

    // the button asks before it does anything
    const first = await b.ev(`(function(){
      var b=[...document.querySelectorAll('#editor button')].find(x=>/Restore what/.test(x.textContent));
      b.click(); return b.textContent;
    })()`);
    check("restoring asks once before it happens", /really/i.test(first));
    await b.ev(`[...document.querySelectorAll('#editor button')].find(x=>/Back$/.test(x.textContent.trim())).click()`);
    await b.waitFor(`(document.querySelector('#editor .panel-title') || {}).textContent === 'BACK UP WHAT YOU MADE'`);
    check("Back returns to the list",
      await b.ev(`(document.querySelector('#editor .panel-title')||{}).textContent`), "BACK UP WHAT YOU MADE");

    /* A restore that fails on a fault says why in a window of its own, with
       where to send the details: the blocking folder again, through the screen. */
    fs.mkdirSync(blocker);
    try {
      await b.ev(`(function(){
        var row = [...document.querySelectorAll('#editor .bk-row')].find(r => r.textContent.indexOf(${JSON.stringify(made.made.name)}) >= 0);
        [...row.querySelectorAll('button')].find(x => /Restore/.test(x.textContent)).click();
      })()`);
      await b.waitFor(`(document.querySelector('#editor .panel-title') || {}).textContent === 'RESTORE FROM A BACKUP'`);
      await b.ev(`[...document.querySelectorAll('#editor .bk-pick')].forEach((r) => { r.querySelector('input').checked = /Text you edited/.test(r.textContent); })`);
      const GO = `[...document.querySelectorAll('#editor button')].find((x) => /Restore what|Restore, really/.test(x.textContent))`;
      await b.ev(`${GO}.click()`);
      await sleep(1100);
      await b.ev(`${GO}.click()`);
      await b.until(`!!document.querySelector('.confirm-wrap')`, true, 15000);
      check("a restore that fails on a fault says so in a window of its own, with the reason",
        [await b.ev(`(document.querySelector('.confirm-wrap h2') || {}).textContent`),
         await b.ev(`/Nothing was restored: every file is as it was/.test((document.querySelector('.confirm-wrap') || {}).textContent || "")`)],
        ["The restore did not go through", true]);
      check("and where to send the details, with Report a problem one press away",
        [await b.ev(`/Please email it to help@/.test((document.querySelector('.confirm-wrap') || {}).textContent || "")`),
         await b.ev(`[...document.querySelectorAll('.confirm-wrap button')].map((x) => x.textContent)`)], [true, ["Close", "Report a problem..."]]);
      await b.ev(`(() => { const c = [...document.querySelectorAll('.confirm-wrap button')].find((x) => x.textContent === "Close"); if (c) { c.click(); } })()`);
    } finally {
      fs.rmSync(blocker, { recursive: true, force: true });
      for (const n of fs.readdirSync(made.made.dir)) { if (n.includes("before-restore") && !mine.includes(n)) { mine.push(n); } }
    }
    await b.waitFor(`(document.querySelector('#editor .panel-title') || {}).textContent === 'BACK UP WHAT YOU MADE'`);

    /* Export and Import on the screen. The Windows window is answered for the
       test (data\pick-answer.txt, a test copy only). */
    const press = async (label) => {
      await b.ev(`(() => { const s = document.getElementById("strip"); s.textContent = ""; })()`);
      await b.ev(`[...document.querySelectorAll('#editor .art-btns button')].find(x => x.textContent === ${JSON.stringify(label)}).click()`);
    };
    check("the screen offers both beside Back up now",
      await b.ev(`[...document.querySelectorAll('#editor .art-btns button')].map(x => x.textContent)`),
      ["Back up now", "Export to a folder...", "Import from a file..."]);
    const shown = path.join(outDir, "from the screen");
    fs.mkdirSync(shown, { recursive: true });
    fs.writeFileSync(answer, shown);
    await press("Export to a folder...");
    await b.until(`/exported \\d+ files|could not export/.test(document.getElementById("strip").textContent)`, true, 15000);
    check("Export to a folder... puts the archive in the folder chosen, and says where",
      [fs.readdirSync(shown).filter((n) => /^xsegon-.*\.zip$/.test(n)).length,
       await b.ev(`document.getElementById("strip").textContent.indexOf(${JSON.stringify(shown)}) >= 0`)], [1, true]);
    check("and that every file in it was read back", await b.ev(`/every one read back/.test(document.getElementById("strip").textContent)`), true);
    // the screen draws itself again after an export: wait for the new buttons
    await b.until(`[...document.querySelectorAll('#editor .art-btns button')].some(x => x.textContent === "Export to a folder..." && !x.disabled)`, true, 15000);
    fs.writeFileSync(answer, carried);
    await press("Import from a file...");
    check("Import from a file... opens the archive for restoring, with nothing put back yet",
      [await b.until(`(document.querySelector('#editor .panel-title') || {}).textContent`, "RESTORE FROM A BACKUP", 15000),
       await b.ev(`/already here/.test(document.getElementById("strip").textContent)`),
       Buffer.compare(fs.readFileSync(favourites), favBefore)], ["RESTORE FROM A BACKUP", true, 0]);
    fs.writeFileSync(answer, stranger);
    await b.ev(`[...document.querySelectorAll('#editor button')].find(x=>/Back$/.test(x.textContent.trim())).click()`);
    await b.waitFor(`(document.querySelector('#editor .panel-title') || {}).textContent === 'BACK UP WHAT YOU MADE'`);
    await press("Import from a file...");
    check("a file that is not a backup is refused on the screen, which stays where it was",
      [await b.until(`/not imported: that zip is not an Xsegon backup/.test(document.getElementById("strip").textContent)`, true, 15000),
       await b.ev(`(document.querySelector('#editor .panel-title')||{}).textContent`)], [true, "BACK UP WHAT YOU MADE"]);
    /* Delete acts on a second press, counted only a second after the question
       (a double click is two presses); pressed on a backup this run made. */
    const doomed = mine[0];
    const DEL = `(() => { const r = [...document.querySelectorAll('#editor .bk-row')].find((x) => ((x.querySelector('.bk-id') || {}).textContent || '').indexOf(${JSON.stringify(doomed)}) === 0); return r ? [...r.querySelectorAll('.bk-acts button')].pop() : null; })()`;
    const onHand = async () => ((await api("api/backup.php")).backups || []).some((x) => x.name === doomed);
    await b.ev(`(() => { const d = ${DEL}; d.click(); d.click(); })()`);
    check("a double click on Delete asks, and deletes nothing", [await b.ev(`${DEL}.textContent`), await onHand()], ["Delete, really?", true]);
    await sleep(1100);
    await b.ev(`${DEL}.click()`);
    check("a press a second later is the yes: the backup is gone, and its row with it", [await b.until(`!${DEL}`, true, 8000), await onHand()], [true, false]);
    await b.key("Escape");
    await sleep(300);
    await b.ev(`import("/js/settings-ui.js").then((m) => m.closeSettings())`);   // the window closes back onto Settings, where it was opened from
  } finally {
    fs.rmSync(answer, { force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
    for (const name of mine) {
      await api("api/backup.php", { action: "remove", name: name });
    }
  }
};
