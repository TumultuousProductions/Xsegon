/*  Unpack and add (includes\unpack.php, bin\unpack.php, api\unpack.php,
    js\unpack.js): a disc game still in its .zip or .7z.

    Against a games folder made here, with stand-in archives a few hundred
    kilobytes big whose "discs" carry only the marks a console writes (one is
    34 MB of nothing, because an Xbox 360 disc keeps its mark that far in).
    paths.romRoot is pointed at it and put back; no real archive is touched. */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { api, DATA, ROOT, Guard, sleep } = require("./lib");

const FIX = path.join(os.tmpdir(), "xs-unpack-fixture");
const ALL = path.join(os.tmpdir(), "xs-unpack-all-fixture");       // Unpack all's own games folder
const TAR = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
const X360 = path.join(FIX, "systems", "xbox360"), PS3 = path.join(FIX, "systems", "ps3"), MAKE = path.join(os.tmpdir(), "xs-unpack-making");
const MARK = "MICROSOFT*XBOX*MEDIA";

// A game partition alone: the Xbox mark 0x10000 in, and a first folder naming the program.
function xiso(program, seed) {
  const b = Buffer.alloc(0x90000, seed);
  b.write(MARK, 0x10000, "latin1");
  b.writeUInt32LE(40, 0x10014); b.writeUInt32LE(2048, 0x10018);
  b.fill(0, 40 * 2048, 41 * 2048);
  b.write(program, 40 * 2048 + 14, "latin1");
  return b;
}
// A whole Xbox 360 disc as it is dumped: the same mark, 0x2090000 in.
function whole360() {
  const b = Buffer.alloc(0x2090000 + 0x1000);
  b.write("\x01CD001", 0x8000, "latin1");
  b.write(MARK, 0x2090000, "latin1");
  return b;
}
function pack(archive, names) {
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  const args = /\.7z$/.test(archive) ? ["--format", "7zip", "-cf", archive] : ["-a", "-cf", archive];
  execFileSync(TAR, args.concat(["-C", MAKE], names), { windowsHide: true });
}
// A .zip written by hand, files stored as they are, so a name no tool would write can be in it.
function zipOf(files) {
  const zlib = require("zlib");
  const locals = [], central = [];
  let at = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name), crc = zlib.crc32(data);
    const lh = Buffer.alloc(30), ch = Buffer.alloc(46);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(at, 42);
    locals.push(lh, n, data);
    central.push(ch, n);
    at += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat(locals.concat([cd, end]));
}
function made(name, bytes) {
  const p = path.join(MAKE, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes);
}

module.exports = async function (b, check) {
  if (!fs.existsSync(path.join(DATA, "fixtures"))) {
    check("unpack: runs only on the test server's own copy", true, true);
    return;
  }
  if (!fs.existsSync(path.join(ROOT, "bin", "7zr.exe"))) {
    check("unpack: needs bin\\7zr.exe for its .7z stand-ins (7zr.exe is not in git)", true, true);
    return;
  }
  const kept = new Guard(["scanned-games.json", "unpacked.json", "unpack-job.json", "messages.json", "library-seen.json"]);
  const before = (await api("api/settings.php")).settings.paths;
  fs.rmSync(FIX, { recursive: true, force: true });
  fs.rmSync(MAKE, { recursive: true, force: true });
  fs.mkdirSync(X360, { recursive: true });
  fs.mkdirSync(PS3, { recursive: true });

  /* ---- the stand-in archives --------------------------------------------- */
  const halo = path.join(X360, "Xsup Halo (USA).7z");
  made("Xsup Halo (USA).iso", xiso("default.xex", 1));
  pack(halo, ["Xsup Halo (USA).iso"]);
  const gears = path.join(X360, "Xsup Gears (World) (Disc 1).7z");
  made("Xsup Gears (World) (Disc 1).iso", xiso("default.xex", 2));
  pack(gears, ["Xsup Gears (World) (Disc 1).iso"]);
  const wrong = path.join(PS3, "Xsup Wrong (USA).7z");
  made("Xsup Wrong (USA).iso", whole360());
  pack(wrong, ["Xsup Wrong (USA).iso"]);
  const twin = path.join(PS3, "Xsup Halo (USA).7z");
  fs.copyFileSync(halo, twin);
  const renamed = path.join(X360, "Xsup Renamed.7z");               // the same disc, in an archive not named for it
  fs.copyFileSync(halo, renamed);
  const thieves = path.join(PS3, "Xsup Thieves (USA).zip");
  made("Xsup Thieves (USA)/PS3_GAME/USRDIR/EBOOT.BIN", "not a real program");
  made("Xsup Thieves (USA)/PS3_GAME/PARAM.SFO", "nor its notes");
  pack(thieves, ["Xsup Thieves (USA)"]);
  const disc3 = path.join(PS3, "Xsup Disc (USA).7z");
  const ps3iso = Buffer.alloc(0x9000, 3); ps3iso.write("PlayStation3", 0x800, "latin1");
  made("Xsup Disc (USA).iso", ps3iso);
  pack(disc3, ["Xsup Disc (USA).iso"]);
  const papers = path.join(X360, "Xsup Papers.zip");
  made("notes.txt", "only a note");
  pack(papers, ["notes.txt"]);
  const cube = path.join(X360, "Xsup Cube (USA).7z");
  const gc = Buffer.alloc(0x9000, 4); Buffer.from([0xC2, 0x33, 0x9F, 0x3D]).copy(gc, 0x1C);
  made("Xsup Cube (USA).iso", gc);
  pack(cube, ["Xsup Cube (USA).iso"]);
  const xbe = path.join(X360, "Xsup Older (USA).7z");
  made("Xsup Older (USA).iso", xiso("default.xbe", 5));
  pack(xbe, ["Xsup Older (USA).iso"]);
  const outside = path.join(os.tmpdir(), "xs-unpack-outside.7z");
  fs.copyFileSync(halo, outside);
  // What the check before unpacking has to stop, and what it has to let through.
  const virus = path.join(X360, "Xsup Virus (USA).7z");            // the stand-in Defender "finds" one in this name
  made("Xsup Virus (USA).iso", xiso("default.xex", 6));
  pack(virus, ["Xsup Virus (USA).iso"]);
  const astray = path.join(PS3, "Xsup Virus Astray (USA).7z");     // and this one is in the wrong folder as well
  made("Xsup Virus Astray (USA).iso", xiso("default.xex", 10));
  pack(astray, ["Xsup Virus Astray (USA).iso"]);
  const extra = path.join(X360, "Xsup Extra (USA).7z");            // a program and a note beside the disc
  made("Xsup Extra (USA).iso", xiso("default.xex", 7));
  made("setup.exe", "MZ not a real program");
  made("Vimm's Lair.txt", "a note that comes along");
  pack(extra, ["Xsup Extra (USA).iso", "setup.exe", "Vimm's Lair.txt"]);
  const marks = path.join(X360, "Xsup Marks [!] (USA).zip");       // a name tar would read as a pattern
  made("Xsup Marks [!] (USA).iso", xiso("default.xex", 8));
  const old = new Date("1996-12-24T22:32:00Z");                    // the date the archives going round give their files
  fs.utimesSync(path.join(MAKE, "Xsup Marks [!] (USA).iso"), old, old);
  pack(marks, ["Xsup Marks [!] (USA).iso", "notes.txt"]);
  const tooled = path.join(PS3, "Xsup Tooled (USA).zip");          // a game folder with a Windows program in it
  made("Xsup Tooled (USA)/PS3_GAME/USRDIR/EBOOT.BIN", "not a real program");
  made("Xsup Tooled (USA)/PS3_GAME/USRDIR/patcher.exe", "MZ nor this");
  pack(tooled, ["Xsup Tooled (USA)"]);
  const climbs = path.join(X360, "Xsup Climbs (USA).zip");         // a file that would land outside its folder
  fs.writeFileSync(climbs, zipOf([["Xsup Climbs (USA).iso", xiso("default.xex", 9)], ["../climbed-out.txt", Buffer.from("outside")]]));
  const broken = path.join(X360, "Xsup Broken (USA).zip");         // lists whole, and one byte of its disc is wrong
  const bad = zipOf([["Xsup Broken (USA).iso", xiso("default.xex", 11)]]);
  bad[30 + "Xsup Broken (USA).iso".length + 100] ^= 0xFF;
  fs.writeFileSync(broken, bad);
  const slow = path.join(X360, "Xsup Slow (USA).7z");              // the stand-in Defender is made to take its time over this one
  made("Xsup Slow (USA).iso", xiso("default.xex", 12));
  pack(slow, ["Xsup Slow (USA).iso"]);
  const HOLD = path.join(DATA, "fixtures", "defender-hold");
  const later = path.join(X360, "Xsup Later (USA).7z");            // asked for while a worker on older code is at work
  made("Xsup Later (USA).iso", xiso("default.xex", 13));
  pack(later, ["Xsup Later (USA).iso"]);

  const look = (a) => api("api/unpack.php?look=" + encodeURIComponent(a));
  const scanned = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, "scanned-games.json"), "utf8")); } catch (e) { return []; } };
  const idle = async (ms = 60000) => {
    for (const end = Date.now() + ms; Date.now() < end;) {
      const st = await api("api/unpack.php");
      if (!st.running && !(st.waiting || []).length) { return st; }
      await sleep(250);
    }
    return await api("api/unpack.php");
  };
  const last = (st, archive) => (st.results || []).filter((r) => r.archive.toLowerCase() === archive.toLowerCase()).pop() || {};

  try {
    await api("api/settings.php", { paths: { romRoot: FIX, scanFolders: [] } });
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), "[]");
    for (const f of ["unpacked.json", "unpack-job.json", "unpack-stop"]) { fs.rmSync(path.join(DATA, f), { force: true }); }
    fs.rmSync(path.join(DATA, "unpack-queue"), { recursive: true, force: true });

    /* ---- looking into an archive ----------------------------------------- */
    const walk = await api("api/scan.php");
    check("the scan names every archived disc game, and offers none of them as a game",
      [(walk.archives || []).length, (walk.new || []).length, (walk.archivesDone || {}).count], [19, 0, 0]);

    let r = await look(halo);
    check("an Xbox 360 disc in the Xbox 360 folder is the right game in the right place, by the program on the disc",
      [r.ok, r.look.console, r.look.shape, r.look.main, /default\.xex/.test(r.look.how), r.plan.verdict, r.plan.move],
      [true, "Microsoft Xbox 360", "image", "Xsup Halo (USA).iso", true, "right", null]);
    check("it would unpack into a folder named for the game, and the room is counted",
      [r.plan.dest, r.plan.need, r.plan.room], [path.join(X360, "Xsup Halo (USA)"), 0x90000, true]);
    r = await look(gears);
    check("a disc of a set unpacks into a folder without its disc number, so the set's discs meet there",
      r.plan.dest, path.join(X360, "Xsup Gears (World)"));

    r = await look(wrong);
    check("a whole Xbox 360 disc is known by the mark it keeps 34 MB in, and in the PlayStation 3 folder it is in the wrong place",
      [r.look.console, /where an Xbox 360 disc keeps it/.test(r.look.how), r.plan.verdict, r.plan.here, r.plan.belongs],
      ["Microsoft Xbox 360", true, "wrong", "Sony Playstation 3", "Microsoft Xbox 360"]);
    check("its own folder is the xbox360 one beside it, with no file of its name there, and that is where it would unpack",
      [r.plan.move.dir, r.plan.move.there, r.plan.move.twin, r.plan.move.dest], [X360, true, null, path.join(X360, "Xsup Wrong (USA)")]);

    r = await look(twin);
    check("the same archive already in its own console's folder is said to be there, same size", [r.plan.verdict, r.plan.move.twin], ["wrong", "same"]);
    r = await look(thieves);
    check("a PS3 game kept as a folder is known by its PS3_GAME folder, without reading any disc, and unpacks beside its archive",
      [r.look.console, r.look.shape, r.look.top, r.look.entries, r.plan.verdict, r.plan.dest],
      ["Sony Playstation 3", "folder", "Xsup Thieves (USA)", 2, "right", PS3]);
    r = await look(disc3);
    check("a PS3 disc is known by its own signature", [r.look.console, /PlayStation3/.test(r.look.how), r.plan.verdict], ["Sony Playstation 3", true, "right"]);
    r = await look(papers);
    check("an archive with no disc and no game folder is said to hold no game", [r.look.shape, r.plan.verdict], ["none", "nogame"]);
    r = await look(cube);
    check("another console's disc is named, and its folder, not made yet, is the one Scan for Games would read",
      [r.look.console, r.plan.verdict, r.plan.move.there, path.basename(r.plan.move.dir)], ["Nintendo GameCube", "wrong", false, "gc"]);
    r = await look(xbe);
    check("an original Xbox disc is told from an Xbox 360 one by its program", [r.look.console, r.plan.verdict], ["Microsoft Xbox", "wrong"]);
    check("a file outside the games folders is refused, and so is one that is no archive",
      [(await look(outside)).ok, (await look(path.join(X360, "nothing.7z"))).ok, (await api("api/unpack.php", { action: "start", archive: outside })).ok], [false, false, false]);
    check("looking changed nothing: no archive moved, nothing unpacked",
      [fs.readdirSync(X360).sort(), fs.readdirSync(PS3).sort()],
      [["Xsup Broken (USA).zip", "Xsup Climbs (USA).zip", "Xsup Cube (USA).7z", "Xsup Extra (USA).7z", "Xsup Gears (World) (Disc 1).7z", "Xsup Halo (USA).7z", "Xsup Later (USA).7z",
        "Xsup Marks [!] (USA).zip", "Xsup Older (USA).7z", "Xsup Papers.zip", "Xsup Renamed.7z", "Xsup Slow (USA).7z", "Xsup Virus (USA).7z"],
       ["Xsup Disc (USA).7z", "Xsup Halo (USA).7z", "Xsup Thieves (USA).zip", "Xsup Tooled (USA).zip", "Xsup Virus Astray (USA).7z", "Xsup Wrong (USA).7z"]]);

    /* ---- what does not belong in a game ----------------------------------- */
    r = await look(extra);
    check("a program and a note beside the disc are seen, and only the disc would be taken out",
      [r.look.odd.runs, r.look.left.slice().sort(), r.look.take, r.plan.verdict, r.plan.need],
      [["setup.exe"], ["Vimm's Lair.txt", "setup.exe"], ["Xsup Extra (USA).iso"], "right", 0x90000]);
    check("Windows Defender is here to be asked first (the test's stand-in), with how long it would take", [r.plan.defender, r.plan.defenderSeconds >= 1], [true, true]);
    r = await look(tooled);
    check("a game kept as a folder with a Windows program in it is not to be unpacked, and the program is named",
      [r.plan.verdict, /Windows programs inside \(.*patcher\.exe\)/.test(r.plan.unsafe || "")], ["unsafe", true]);
    r = await look(climbs);
    check("an archive with a file that would land outside its folder is not to be unpacked",
      [r.plan.verdict, /outside its own folder \(\.\.\/climbed-out\.txt\)/.test(r.plan.unsafe || "")], ["unsafe", true]);

    /* ---- unpacking and adding --------------------------------------------- */
    check("nothing to stop while nothing is unpacked", (await api("api/unpack.php", { action: "stop" })).ok, false);
    r = await api("api/unpack.php", { action: "start", archive: halo });
    check("Unpack and add starts in the background", [r.ok, r.running || r.waiting.length > 0 || (r.results || []).length > 0], [true, true]);
    let st = await idle();
    const haloIso = path.join(X360, "Xsup Halo (USA)", "Xsup Halo (USA).iso");
    check("the disc is unpacked whole into its folder, and the archive is still there",
      [last(st, halo).ok, last(st, halo).dest, fs.existsSync(haloIso) && fs.statSync(haloIso).size, fs.existsSync(halo)],
      [true, path.join(X360, "Xsup Halo (USA)"), 0x90000, true]);
    check("Windows Defender was asked first, and found nothing", last(st, halo).checked, "clean");
    const got = scanned().find((g) => g.title === "Xsup Halo") || {};
    check("and the game is in the library, taken in the way Scan for Games takes one in",
      [last(st, halo).added, got.platform, got.rom], [["Xsup Halo"], "Microsoft Xbox 360", haloIso]);
    check("it is kept as unpacked, with where to", (st.unpacked[halo.toLowerCase()] || {}).dest, path.join(X360, "Xsup Halo (USA)"));
    r = await look(halo);
    check("looked into again, it is already unpacked, and says where", [r.plan.verdict, r.plan.already], ["done", haloIso]);

    check("a spare copy cannot be moved over the one in its own console's folder",
      [(r = await api("api/unpack.php", { action: "start", archive: twin, move: true })).ok, /already in/.test(r.error || "")], [false, true]);
    check("and an archive that is in the right place has nowhere to be moved", (await api("api/unpack.php", { action: "start", archive: gears, move: true })).ok, false);

    r = await api("api/unpack.php", { action: "start", archive: wrong, move: true });
    const two = await api("api/unpack.php", { action: "start", archive: thieves });
    check("two asked for one after the other both start: one waits its turn", [r.ok, two.ok], [true, true]);
    st = await idle();
    const wrongIso = path.join(X360, "Xsup Wrong (USA)", "Xsup Wrong (USA).iso");
    check("the one in the wrong folder was moved to its own console's folder and unpacked there",
      [last(st, wrong).ok, fs.existsSync(wrong), fs.existsSync(path.join(X360, "Xsup Wrong (USA).7z")), fs.existsSync(wrongIso) && fs.statSync(wrongIso).size],
      [true, false, true, 0x2090000 + 0x1000]);
    check("and added as an Xbox 360 game", (scanned().find((g) => g.title === "Xsup Wrong") || {}).platform, "Microsoft Xbox 360");
    const eboot = path.join(PS3, "Xsup Thieves (USA)", "PS3_GAME", "USRDIR", "EBOOT.BIN");
    check("the PS3 folder game was unpacked beside its .zip, as the folder it brought, and added",
      [last(st, thieves).ok, last(st, thieves).dest, fs.existsSync(eboot), (scanned().find((g) => g.title === "Xsup Thieves") || {}).rom],
      [true, PS3, true, eboot]);

    r = await api("api/unpack.php", { action: "start", archive: thieves });
    st = await idle();
    check("asked for again, nothing is unpacked over what is there, and the reason is said",
      [last(st, thieves).ok, /already in/.test(last(st, thieves).why || "")], [false, true]);

    /* ---- the check before anything is unpacked ---------------------------- */
    await api("api/unpack.php", { action: "start", archive: virus });
    await api("api/unpack.php", { action: "start", archive: astray, move: true });
    await api("api/unpack.php", { action: "start", archive: extra });
    await api("api/unpack.php", { action: "start", archive: marks, scan: false });
    await api("api/unpack.php", { action: "start", archive: tooled });
    await api("api/unpack.php", { action: "start", archive: climbs });
    await api("api/unpack.php", { action: "start", archive: broken });
    st = await idle();
    check("an archive Windows Defender finds something in is not unpacked: the find is named, nothing is written, the archive stays",
      [last(st, virus).ok, last(st, virus).checked, /Windows Defender found Virus:DOS\/Stand_In_Test in it, so nothing was unpacked/.test(last(st, virus).why || ""),
       fs.existsSync(path.join(X360, "Xsup Virus (USA)")), fs.existsSync(virus)], [false, "found", true, false, true]);
    check("and one in the wrong folder is not even moved: the check comes before anything is touched",
      [last(st, astray).ok, last(st, astray).checked, fs.existsSync(astray), fs.existsSync(path.join(X360, "Xsup Virus Astray (USA).7z"))], [false, "found", true, false]);
    const extraDir = path.join(X360, "Xsup Extra (USA)");
    check("of an archive with a program beside its disc only the disc is unpacked: the program and the note never leave the archive",
      [last(st, extra).ok, fs.existsSync(extraDir) && fs.readdirSync(extraDir), (last(st, extra).left || []).slice().sort(), fs.existsSync(path.join(X360, "setup.exe"))],
      [true, ["Xsup Extra (USA).iso"], ["Vimm's Lair.txt", "setup.exe"], false]);
    const marksDir = path.join(X360, "Xsup Marks [!] (USA)");
    check("a .zip whose names tar would read as patterns unpacks its disc alone all the same, and with the check turned off it says so",
      [last(st, marks).ok, fs.existsSync(marksDir) && fs.readdirSync(marksDir), last(st, marks).checked], [true, ["Xsup Marks [!] (USA).iso"], "skipped"]);
    const marksIso = path.join(marksDir, "Xsup Marks [!] (USA).iso");
    check("a .zip's files are not given the archive's dates: an exFAT drive refuses them, and tar then calls a whole unpack a failed one",
      fs.existsSync(marksIso) && fs.statSync(marksIso).mtimeMs > Date.now() - 3600000, true);
    check("an archive that will not unpack whole says what the unpacking program said, and nothing of it stays",
      [last(st, broken).ok, /tar ended with \d+, saying: .*CRC/i.test(last(st, broken).why || ""), fs.existsSync(path.join(X360, "Xsup Broken (USA)"))],
      [false, true, false]);
    check("a game folder with a Windows program in it is refused by the worker too, and nothing of it is written",
      [last(st, tooled).ok, /Windows programs inside/.test(last(st, tooled).why || ""), fs.existsSync(path.join(PS3, "Xsup Tooled (USA)"))], [false, true, false]);
    check("and so is the archive that reaches outside its folder: nothing landed there",
      [last(st, climbs).ok, /outside its own folder/.test(last(st, climbs).why || ""), fs.existsSync(path.join(FIX, "systems", "climbed-out.txt")), fs.existsSync(path.join(X360, "Xsup Climbs (USA)"))],
      [false, true, false, false]);

    const log = ((await api("api/log.php?tail=400")).lines || []).join("\n");
    check("the log has each step: looked into, asked for, checked, moved, unpacked, done",
      [/UNPK.*looked into Xsup Wrong/.test(log), /UNPK.*asked for: .*Xsup Wrong/.test(log), /UNPK.*Windows Defender on Xsup Wrong \(USA\)\.7z: clean/.test(log),
       /UNPK.*moved .*Xsup Wrong/.test(log), /UNPK.*unpacked Xsup Wrong/.test(log), /UNPK.*Xsup Halo \(USA\)\.7z: done, added Xsup Halo/.test(log),
       /UNPK.*Windows Defender on Xsup Virus \(USA\)\.7z: found \(Virus:DOS\/Stand_In_Test\)/.test(log)], [true, true, true, true, true, true, true]);

    /* ---- what is unpacked leaves the list ---------------------------------- */
    const names = (w) => (w.archives || []).map((a) => path.basename(a.file)).sort();
    let w = await api("api/scan.php");
    check("an archive whose game stands unpacked is no longer named by the scan, only counted with the room it takes; a spare copy elsewhere and a failed one stay",
      [names(w), w.archivesDone.count, w.archivesDone.bytes > 0],
      [["Xsup Broken (USA).zip", "Xsup Climbs (USA).zip", "Xsup Cube (USA).7z", "Xsup Disc (USA).7z", "Xsup Gears (World) (Disc 1).7z", "Xsup Halo (USA).7z",
        "Xsup Later (USA).7z", "Xsup Older (USA).7z", "Xsup Papers.zip", "Xsup Renamed.7z", "Xsup Slow (USA).7z", "Xsup Tooled (USA).zip", "Xsup Virus (USA).7z",
        "Xsup Virus Astray (USA).7z"], 5, true]);
    r = await look(renamed);
    w = await api("api/scan.php");
    check("an archive not named for its disc is found unpacked when it is looked into, and then leaves the list too",
      [r.plan.verdict, names(w).includes("Xsup Renamed.7z"), w.archivesDone.count], ["done", false, 6]);
    fs.rmSync(marksDir, { recursive: true, force: true });
    w = await api("api/scan.php");
    check("and one whose unpacked game was deleted since is listed again, to be unpacked again",
      [names(w).includes("Xsup Marks [!] (USA).zip"), w.archivesDone.count], [true, 5]);

    /* ---- on Scan for Games ------------------------------------------------ */
    const title = `(document.querySelector("#editor .panel-title") || {}).textContent`;
    const line = (name) => `[...document.querySelectorAll("#editor .up-row")].find(n => n.querySelector(".up-file").textContent === ${JSON.stringify(name)})`;
    const says = (name) => `(n => n ? n.querySelector(".up-says").textContent : null)(${line(name)})`;
    const acts = (name) => `[...${line(name)}.querySelectorAll(".up-acts button")].map(x => x.textContent)`;
    await b.goto();
    await b.enterConsole();
    await b.setView("grid");
    await b.openBar("games");
    await b.menuItem(/Scan for Games/);
    await b.waitFor(`${title} === "SCAN FOR GAMES"`, 10000);
    check("Scan for Games lists the archived discs, each with Unpack and add",
      [await b.until(`document.querySelectorAll("#editor .up-row").length`, 14, 8000), await b.ev(`(${line("Xsup Gears (World) (Disc 1).7z")}.querySelector(".up-go") || {}).textContent`)],
      [14, "Unpack and add"]);
    check("above them, the Windows Defender check is offered and selected, with what it does and how long it takes",
      [await b.until(`(o => !!o && !o.hidden && o.querySelector("input").checked)(document.querySelector("#editor .up-opt"))`, true, 5000),
       await b.ev(`/only looks, nothing is removed.*about four minutes/.test(document.querySelector("#editor .up-opt").textContent)`)], [true, true]);
    check("one unpacked before is not on the list any more, and a line under it says how many are left out and what they take",
      [await b.ev(`!${line("Xsup Thieves (USA).zip")}`), await b.ev(`!${line("Xsup Wrong (USA).7z")}`),
       await b.ev(`/^5 archives are not listed here: their games are unpacked already\\. They take \\d.* GB, and Xsegon never deletes one/.test((document.querySelector("#editor .up-gone") || {}).textContent || "")`)],
      [true, true, true]);

    const spare = `[...document.querySelectorAll("#editor .up-row")].filter(n => n.querySelector(".up-file").textContent === "Xsup Halo (USA).7z" && /ps3/.test(n.querySelector(".up-where").textContent))[0]`;
    await b.ev(`${spare}.querySelector(".up-go").click()`);
    check("a spare copy in the wrong console's folder is said to be one, with nothing to press but Leave it",
      [await b.until(`/Microsoft Xbox 360 game.*in the Sony Playstation 3 folder.*spare copy.*never deletes/.test(${spare}.querySelector(".up-says").textContent)`, true, 10000),
       await b.ev(`[...${spare}.querySelectorAll(".up-acts button")].map(x => x.textContent)`)], [true, ["Leave it"]]);

    await b.ev(`${line("Xsup Cube (USA).7z")}.querySelector(".up-go").click()`);
    check("another console's game offers the move to that console's folder, to unpack it here anyway, or to leave it",
      [await b.until(`/Nintendo GameCube game.*in the Microsoft Xbox 360 folder/.test(${says("Xsup Cube (USA).7z")} || "")`, true, 10000), await b.ev(acts("Xsup Cube (USA).7z"))],
      [true, ["Move it to gc and unpack there", "Unpack it here anyway", "Leave it"]]);
    await b.ev(`[...${line("Xsup Cube (USA).7z")}.querySelectorAll(".up-acts button")].pop().click()`);
    check("Leave it puts the line back as it was", [await b.ev(`${line("Xsup Cube (USA).7z")}.querySelector(".up-go").hidden`), await b.ev(`${line("Xsup Cube (USA).7z")}.querySelector(".up-says").hidden`)], [false, true]);

    await b.ev(`${line("Xsup Tooled (USA).zip")}.querySelector(".up-go").click()`);
    check("an archive that holds what does not belong in a game says it will not be unpacked, and why, with nothing to press",
      [await b.until(`/^Xsegon will not unpack this one: the game in it is a folder with Windows programs inside \\(.*patcher\\.exe\\)/.test(${says("Xsup Tooled (USA).zip")} || "")`, true, 10000),
       await b.ev(acts("Xsup Tooled (USA).zip"))], [true, []]);

    await b.ev(`${line("Xsup Gears (World) (Disc 1).7z")}.querySelector(".up-go").click()`);
    check("the right game in the right folder says so, with where it will stand, how big it is, and that Windows Defender checks it first",
      [await b.until(`/^A Microsoft Xbox 360 game .*in its own console's folder\\. It unpacks to .*Xsup Gears \\(World\\) \\(0\\.0 GB.*Windows Defender checks it first, about a minute\\./.test(${says("Xsup Gears (World) (Disc 1).7z")} || "")`, true, 10000),
       await b.ev(acts("Xsup Gears (World) (Disc 1).7z"))], [true, ["Unpack and add", "Leave it"]]);
    await b.shot("unpack-scan");
    await b.ev(`${line("Xsup Gears (World) (Disc 1).7z")}.querySelector(".up-acts button").click()`);
    check("one press unpacks it and adds the game, and the line says both",
      await b.until(`/^Unpacked to .*Xsup Gears \\(World\\) and added: Xsup Gears\\. Windows Defender found no threats in it\\./.test(${says("Xsup Gears (World) (Disc 1).7z")} || "")`, true, 30000), true);
    check("the strip says how the run went",
      await b.waitFor(`/1 archive unpacked, 1 game added/.test((s => s.hidden ? "" : s.textContent)(document.getElementById("strip")))`, 8000), true);
    check("and the game is in the library", (scanned().find((g) => g.title === "Xsup Gears") || {}).platform, "Microsoft Xbox 360");
    await b.key("Escape");
    await sleep(500);
    check("Escape closes the window", await b.ev(`document.getElementById("editor").hidden`), true);

    /* ---- pressed again while the run goes on -------------------------------- */
    // One archive fails, and the next is kept in its check: the run is still going while the failed line is pressed.
    fs.writeFileSync(HOLD, "Broken");
    await api("api/unpack.php", { action: "start", archive: broken });
    await api("api/unpack.php", { action: "start", archive: slow });
    fs.writeFileSync(HOLD, "Slow");
    await b.openBar("games");
    await b.menuItem(/Scan for Games/);
    await b.waitFor(`${title} === "SCAN FOR GAMES"`, 10000);
    check("with the window opened on a run that goes on, the archive that failed says why and the one in hand is being checked",
      [await b.until(`/^Not unpacked: .*saying: .*CRC/.test(${says("Xsup Broken (USA).zip")} || "")`, true, 15000),
       await b.until(`/^Windows Defender is (still )?checking it/.test(${says("Xsup Slow (USA).7z")} || "")`, true, 10000)], [true, true]);
    await b.ev(`${line("Xsup Broken (USA).zip")}.querySelector(".up-go").click()`);
    const offered = await b.until(`${acts("Xsup Broken (USA).zip")}.length`, 2, 10000);
    await sleep(1600);                                 // more than one of the page's polls
    check("a failed line pressed again keeps what it offers: the next poll does not put it back to its failure",
      [offered, await b.ev(acts("Xsup Broken (USA).zip")), await b.ev(`/^A Microsoft Xbox 360 game/.test(${says("Xsup Broken (USA).zip")})`)],
      [2, ["Unpack and add", "Leave it"], true]);
    // The worker in hand is made one from before a change: the job's mark of its code is another.
    const jobFile = path.join(DATA, "unpack-job.json");
    fs.writeFileSync(jobFile, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(jobFile, "utf8")), { code: "an older one" })));
    r = await api("api/unpack.php", { action: "start", archive: later });
    const heldDir = path.join(DATA, "unpack-queue", "held");
    check("an archive asked for while a worker from before a change is at work is taken and kept for a fresh one: it waits, out of that worker's reach",
      [r.ok, (r.waiting || []).map((w) => path.basename(w)), fs.existsSync(heldDir) && fs.readdirSync(heldDir).length,
       fs.readdirSync(path.join(DATA, "unpack-queue")).filter((f) => /\.json$/.test(f)).length],
      [true, ["Xsup Later (USA).7z"], 1, 0]);
    check("and its line says it is waiting its turn", await b.until(`/^Waiting its turn/.test(${says("Xsup Later (USA).7z")} || "")`, true, 5000), true);
    fs.rmSync(HOLD, { force: true });
    st = await idle(40000);
    check("when that worker has ended a fresh one starts by itself and unpacks and adds what was kept; the one before it finished its own",
      [last(st, later).ok, last(st, later).added, (scanned().find((g) => g.title === "Xsup Slow") || {}).platform, fs.existsSync(heldDir)],
      [true, ["Xsup Later"], "Microsoft Xbox 360", false]);
    check("and the page followed it across the two: the kept one's line says it was unpacked and added",
      await b.until(`/^Unpacked to .* and added: Xsup Later\\./.test(${says("Xsup Later (USA).7z")} || "")`, true, 10000), true);
    // Stop lets go of what waits for a fresh worker as well.
    fs.writeFileSync(HOLD, "Virus");
    await api("api/unpack.php", { action: "start", archive: virus });
    fs.writeFileSync(jobFile, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(jobFile, "utf8")), { code: "an older one" })));
    await api("api/unpack.php", { action: "start", archive: cube });
    r = await api("api/unpack.php", { action: "stop" });
    fs.rmSync(HOLD, { force: true });
    st = await idle(20000);
    check("Stop lets go of an archive kept for a fresh worker too: nothing starts afterwards",
      [r.ok, fs.existsSync(heldDir), st.running, (st.waiting || []).length, fs.existsSync(path.join(X360, "Xsup Cube (USA)"))], [true, false, false, 0, false]);

    /* ---- a run that ended part way ------------------------------------------ */
    // What such a run leaves: a cut-short disc in the working folder, where its game will stand.
    const cut = path.join(X360, "Xsup Cut (USA).7z");
    made("Xsup Cut (USA).iso", xiso("default.xex", 14));
    pack(cut, ["Xsup Cut (USA).iso"]);
    const cutWork = path.join(X360, "Xsup Cut (USA)", ".xsegon-unpacking");
    fs.mkdirSync(cutWork, { recursive: true });
    fs.writeFileSync(path.join(cutWork, "Xsup Cut (USA).iso"), "half a disc");
    r = await api("api/scan.php");
    check("a disc left half written by a run that never finished is no game to the scan, and its archive is still there to unpack",
      [r.new.filter((g) => /Xsup Cut/.test(g.rom)).length, (r.archives || []).filter((a) => /Xsup Cut/.test(a.file)).length], [0, 1]);
    await api("api/unpack.php", { action: "start", archive: cut, scan: false });
    st = await idle(40000);
    const cutIso = path.join(X360, "Xsup Cut (USA)", "Xsup Cut (USA).iso");
    check("asked for again it unpacks whole and is added: what was left is cleared, and no working folder stays behind",
      [last(st, cut).ok, last(st, cut).added, fs.existsSync(cutWork), fs.existsSync(cutIso) && fs.statSync(cutIso).size === fs.statSync(path.join(MAKE, "Xsup Cut (USA).iso")).size],
      [true, ["Xsup Cut"], false, true]);
    // A worker gone with one archive in hand and another waiting: its job still says running, its process is no more.
    const left = path.join(X360, "Xsup Left (USA).7z");
    made("Xsup Left (USA).iso", xiso("default.xex", 15));
    pack(left, ["Xsup Left (USA).iso"]);
    const queued = (archive) => {
      fs.mkdirSync(path.join(DATA, "unpack-queue"), { recursive: true });
      fs.writeFileSync(path.join(DATA, "unpack-queue", (Date.now() / 1000).toFixed(4) + "-test.json"), JSON.stringify({ archive: archive, moveTo: null, scan: false, asked: 1 }));
    };
    const gone = () => {
      fs.writeFileSync(jobFile, JSON.stringify({ state: "running", started: 1, pid: 4194000, code: "x", now: { archive: cut, phase: "unpacking" }, results: [] }));
      const then = new Date(Date.now() - 120000);
      fs.utimesSync(jobFile, then, then);
    };
    queued(left);
    gone();
    await api("api/unpack.php");
    st = await idle(40000);
    check("an archive left waiting by a worker that ended part way gets a worker by itself, and the one that was in hand is said, not forgotten",
      [last(st, left).ok, last(st, left).added, last(st, cut).ok, /ended before it was whole/.test(last(st, cut).why || "")],
      [true, ["Xsup Left"], false, true]);
    queued(broken);
    gone();
    r = await api("api/unpack.php", { action: "stop" });
    check("Stop with no worker at work lets go of what waits",
      [r.ok, (r.waiting || []).length, fs.readdirSync(path.join(DATA, "unpack-queue")).filter((f) => /\.json$/.test(f)).length], [true, 0, 0]);
    await b.key("Escape");
    await sleep(300);

    /* ---- Unpack all --------------------------------------------------------- */
    // A games folder of its own: two that are where they belong, and an Xbox 360 disc in the PlayStation 3 folder.
    fs.rmSync(ALL, { recursive: true, force: true });
    const one = path.join(ALL, "systems", "xbox360", "Xsall One (USA).7z");
    made("Xsall One (USA).iso", xiso("default.xex", 21));
    pack(one, ["Xsall One (USA).iso"]);
    const twoZip = path.join(ALL, "systems", "ps3", "Xsall Two (USA).zip");
    made("Xsall Two (USA)/PS3_GAME/USRDIR/EBOOT.BIN", "not a real program");
    pack(twoZip, ["Xsall Two (USA)"]);
    const stray = path.join(ALL, "systems", "ps3", "Xsall Astray (USA).7z");
    made("Xsall Astray (USA).iso", xiso("default.xex", 22));
    pack(stray, ["Xsall Astray (USA).iso"]);
    await api("api/settings.php", { paths: { romRoot: ALL, scanFolders: [] } });
    const packed = [one, twoZip, stray].reduce((sum, f) => sum + fs.statSync(f).size, 0);
    w = await api("api/scan.php");
    const room = w.archivesRoom || {}, drive = (room.drives || [])[0] || {};
    check("the scan says what the packed games take as they are, each and together, and the room free on their drive",
      [names(w), (w.archives || []).every((a) => a.bytes === fs.statSync(a.file).size), room.bytes, (room.drives || []).length, drive.bytes, drive.free > 0],
      [["Xsall Astray (USA).7z", "Xsall One (USA).7z", "Xsall Two (USA).zip"], true, packed, 1, packed, true]);
    check("Unpack all with nothing named, or with only a file outside the games folders, starts nothing",
      [(await api("api/unpack.php", { action: "startAll", archives: [] })).ok, (r = await api("api/unpack.php", { action: "startAll", archives: [outside] })).ok,
       /none of them could be started/.test(r.error || ""), (await api("api/unpack.php")).running], [false, false, true, false]);

    const allBox = `document.querySelector("#editor .up-all")`;
    const allHead = `(document.querySelector("#editor .up-all .up-all-head") || {}).textContent`;
    const strip = `(s => s.hidden ? "" : s.textContent)(document.getElementById("strip"))`;
    await b.openBar("games");
    await b.menuItem(/Scan for Games/);
    await b.waitFor(`${title} === "SCAN FOR GAMES"`, 10000);
    check("Scan for Games says at the top how many disc games are still packed, over the list of them, with one button for all",
      [await b.until(allHead, "3 disc games are still in a .zip or .7z, so no emulator can play them yet.", 8000),
       await b.ev(`${allBox}.querySelector("button").textContent`), await b.ev(`${allBox}.querySelector("button").classList.contains("primary")`),
       await b.ev(`!!(${allBox}.compareDocumentPosition(document.querySelector("#editor .up-rows")) & Node.DOCUMENT_POSITION_FOLLOWING)`)],
      ["3 disc games are still in a .zip or .7z, so no emulator can play them yet.", "Unpack all 3", true, true]);
    check("with what they take, the room free, that the archives stay, and that Windows Defender looks at each first",
      [await b.until(`/Windows Defender looks at each one first/.test(${allBox}.textContent)`, true, 5000),
       await b.ev(`/Packed they take \\d.* GB, and unpacked they need at least that much again\\. \\S+ has \\d.* GB free\\./.test(${allBox}.textContent)`),
       await b.ev(`/The archives stay where they are\\. A game in another console's folder stays packed/.test(${allBox}.textContent)`)], [true, true, true]);
    await b.shot("unpack-all");
    await b.ev(`${allBox}.querySelector("button").click()`);
    check("one press asks for all of them: the window closes by itself, the strip says so, and the run is a bar in the corner",
      [await b.until(`document.getElementById("editor").hidden`, true, 8000),
       await b.until(`/unpacking 3 disc games in the background: the bar in the corner/.test(${strip})`, true, 8000),
       await b.until(`!!document.querySelector('#corner-bars .job-bar[data-job="unpack"]')`, true, 12000)], [true, true, true]);
    check("its ending is said once it is over, and not as a failure: two unpacked and added, one left packed",
      [await b.waitFor(`/2 archives unpacked, 2 games added, 1 left packed \\(Scan for Games says why\\)/.test(${strip})`, 60000),
       await b.ev(`document.getElementById("strip").classList.contains("err")`)], [true, false]);
    st = await idle();
    const oneIso = path.join(ALL, "systems", "xbox360", "Xsall One (USA)", "Xsall One (USA).iso");
    const twoBoot = path.join(ALL, "systems", "ps3", "Xsall Two (USA)", "PS3_GAME", "USRDIR", "EBOOT.BIN");
    check("the two that are where they belong were unpacked whole and added, each as its own console's game, their archives still there",
      [last(st, one).ok, fs.existsSync(oneIso) && fs.statSync(oneIso).size, (scanned().find((g) => g.title === "Xsall One") || {}).platform,
       last(st, twoZip).ok, fs.existsSync(twoBoot), (scanned().find((g) => g.title === "Xsall Two") || {}).platform, fs.existsSync(one), fs.existsSync(twoZip)],
      [true, 0x90000, "Microsoft Xbox 360", true, true, "Sony Playstation 3", true, true]);
    check("the Xbox 360 game in the PlayStation 3 folder was left packed, with the reason: nothing of it moved, nothing unpacked, nothing added",
      [last(st, stray).ok, last(st, stray).kept, /^it is a Microsoft Xbox 360 game in the Sony Playstation 3 folder, and Unpack all moves nothing/.test(last(st, stray).why || ""),
       fs.existsSync(stray), fs.existsSync(path.join(ALL, "systems", "xbox360", "Xsall Astray (USA).7z")), fs.existsSync(path.join(ALL, "systems", "ps3", "Xsall Astray (USA)")),
       scanned().some((g) => g.title === "Xsall Astray")], [false, true, true, true, false, false, false]);
    const allLog = ((await api("api/log.php?tail=400")).lines || []).join("\n");
    check("the log has the press, each one asked for with the rest, and what the worker read of the one it left",
      [/UNPK.*Unpack all: 3 asked for, of 3 named/.test(allLog), /UNPK.*asked for: .*Xsall One \(USA\)\.7z, with the rest \(Unpack all\)/.test(allLog),
       /UNPK.*Unpack all looked into Xsall Astray \(USA\)\.7z: Microsoft Xbox 360, wrong/.test(allLog)], [true, true, true]);

    // A game offered beside them: the window is not closed over an offer nobody has answered.
    fs.mkdirSync(path.join(ALL, "systems", "gba"), { recursive: true });
    fs.writeFileSync(path.join(ALL, "systems", "gba", "Xsall Cart (USA).gba"), "x");
    const three = path.join(ALL, "systems", "xbox360", "Xsall Three (USA).7z");
    made("Xsall Three (USA).iso", xiso("default.xex", 23));
    pack(three, ["Xsall Three (USA).iso"]);
    // Two spare copies in the PlayStation 3 folder: of the archive unpacked above, and of the one still packed.
    const spareOne = path.join(ALL, "systems", "ps3", "Xsall One (USA).7z");
    fs.copyFileSync(one, spareOne);
    const spareThree = path.join(ALL, "systems", "ps3", "Xsall Three (USA).7z");
    fs.copyFileSync(three, spareThree);
    w = await api("api/scan.php");
    check("a spare copy of an archive whose game stands unpacked is marked as one and left out of what the packed games take; the others are not",
      [(w.archives || []).map((a) => path.basename(path.dirname(a.file)) + "/" + path.basename(a.file) + (a.spare ? " spare" : "")).sort(),
       w.archivesRoom.bytes === [stray, three, spareThree].reduce((sum, f) => sum + fs.statSync(f).size, 0)],
      [["ps3/Xsall Astray (USA).7z", "ps3/Xsall One (USA).7z spare", "ps3/Xsall Three (USA).7z", "xbox360/Xsall Three (USA).7z"], true]);
    const lineIn = (name, dir) => `[...document.querySelectorAll("#editor .up-row")].filter(n => n.querySelector(".up-file").textContent === ${JSON.stringify(name)} && n.querySelector(".up-where").textContent.includes(${JSON.stringify(dir)}))[0]`;
    const saysIn = (name, dir) => `(n => n ? n.querySelector(".up-says").textContent : null)(${lineIn(name, dir)})`;
    await b.openBar("games");
    await b.menuItem(/Scan for Games/);
    await b.waitFor(`${title} === "SCAN FOR GAMES"`, 10000);
    check("opened again, the box counts the games still waiting and not the spare copy, which keeps its line; the one left packed says why, its own button still there",
      [await b.until(allHead, "3 disc games are still in a .zip or .7z, so no emulator can play them yet.", 8000),
       await b.until(`document.querySelectorAll("#editor .up-row").length`, 4, 8000),
       await b.until(`/^Left packed: it is a Microsoft Xbox 360 game in the Sony Playstation 3 folder, and Unpack all moves nothing\\. Its own Unpack and add button offers to move it\\./.test(${says("Xsall Astray (USA).7z")} || "")`, true, 8000),
       await b.ev(`${line("Xsall Astray (USA).7z")}.querySelector(".up-go").hidden`)],
      ["3 disc games are still in a .zip or .7z, so no emulator can play them yet.", 4, true, false]);
    check("with a game offered in the same window the button is not the window's own",
      [await b.ev(`${allBox}.querySelector("button").textContent`), await b.ev(`${allBox}.querySelector("button").classList.contains("primary")`),
       await b.ev(`document.querySelectorAll("#editor .sc-row input:checked").length`)], ["Unpack all 3", false, 1]);
    await b.ev(`${allBox}.querySelector("button").click()`);
    check("pressed there, the window stays with its offer still selected, and each line carries its own: the new one is unpacked and added",
      [await b.until(`/^Unpacked to .*Xsall Three \\(USA\\) and added: Xsall Three\\./.test(${saysIn("Xsall Three (USA).7z", "xbox360")} || "")`, true, 40000),
       await b.ev(`document.getElementById("editor").hidden`), await b.ev(`document.querySelectorAll("#editor .sc-row input:checked").length`),
       await b.ev(`/^Unpacking in the background: the bar in the corner/.test(${allBox}.textContent)`)], [true, false, 1, true]);
    check("its ending leads with what was unpacked and counts the two left packed apart, not as a failure",
      [await b.waitFor(`/1 archive unpacked, 1 game added, 2 left packed \\(Scan for Games says why\\)/.test(${strip})`, 40000),
       await b.ev(`document.getElementById("strip").classList.contains("err")`)], [true, false]);
    st = await idle();
    check("and the game in the wrong folder was left packed once more", [last(st, three).ok, last(st, stray).ok, fs.existsSync(stray)], [true, false, true]);
    check("a spare copy of an archive that is in its own console's folder is said to be one, on its line too, with nothing offered to move: it stays where it is",
      [last(st, spareThree).ok, last(st, spareThree).kept,
       /^it is a spare copy of the archive already in .*xbox360, where this Microsoft Xbox 360 game belongs\. Delete this one yourself/.test(last(st, spareThree).why || ""),
       await b.ev(`/^Left packed: it is a spare copy of the archive already in /.test(${saysIn("Xsall Three (USA).7z", "ps3")} || "")`),
       fs.existsSync(spareThree), fs.existsSync(path.join(ALL, "systems", "ps3", "Xsall Three (USA)"))], [false, true, true, true, true, false]);
    check("the spare copy the scan had marked was never asked for",
      (st.results || []).some((x) => x.archive.toLowerCase() === spareOne.toLowerCase()), false);
    await b.key("Escape");
    await sleep(300);

    // The one archive there is to ask for is left packed, so nothing is unpacked at all.
    await b.openBar("games");
    await b.menuItem(/Scan for Games/);
    await b.waitFor(`${title} === "SCAN FOR GAMES"`, 10000);
    check("with only one game left waiting the box says so and its button is Unpack it: both spare copies are out of the count now",
      [await b.until(allHead, "1 disc game is still in a .zip or .7z, so no emulator can play it yet.", 8000), await b.ev(`${allBox}.querySelector("button").textContent`)],
      ["1 disc game is still in a .zip or .7z, so no emulator can play it yet.", "Unpack it"]);
    await b.ev(`${allBox}.querySelector("button").click()`);
    check("when nothing was unpacked the ending says so in words with the reason itself, not as a count of zeros and not as a failure",
      [await b.waitFor(`/nothing was unpacked: it is a Microsoft Xbox 360 game in the Sony Playstation 3 folder, and Unpack all moves nothing\\. Its own Unpack and add button offers to move it/.test(${strip})`, 40000),
       await b.ev(`document.getElementById("strip").classList.contains("err")`), await b.ev(`/\\b0 (archives|games)/.test(${strip})`)], [true, false, false]);
    st = await idle();
    check("and the corner's own ending for that run reads the same",
      (((await api("api/jobs.php")).jobs || []).find((j) => j.key === "unpack") || {}).said,
      "nothing was unpacked: it is a Microsoft Xbox 360 game in the Sony Playstation 3 folder, and Unpack all moves nothing. Its own Unpack and add button offers to move it");
    await b.key("Escape");
    await sleep(300);
  } finally {
    fs.rmSync(ALL, { recursive: true, force: true });
    fs.rmSync(HOLD, { force: true });
    await idle(20000);
    await api("api/settings.php", { paths: { romRoot: before.romRoot, scanFolders: before.scanFolders || [] } });
    kept.restore();
    fs.rmSync(path.join(DATA, "unpack-queue"), { recursive: true, force: true });
    fs.rmSync(FIX, { recursive: true, force: true });
    fs.rmSync(MAKE, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
};
