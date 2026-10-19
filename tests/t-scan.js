/* Scan for Games.
 *
 * The scanner is tested against a fixture tree, not a real ROM drive, which
 * may be unplugged and is never deterministic. The fixture holds, in
 * miniature, each shape a real one has: flat cartridges, a folder that is
 * the game, the PS3 EBOOT nesting, disc sets, an m3u, a set with a hole, an
 * archive on a disc console, an unknown folder and a mame folder.
 *
 * paths.romRoot is pointed at the fixture through the settings API and put
 * back at the end; settings.json is in the Guard as well, so a crash cannot
 * leave Xsegon reading a temp folder.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { api, BASE, DATA, sleep } = require("./lib");

const FIX = path.join(os.tmpdir(), "xs-scan-fixture");

/* Whether the scan window names a folder outside its "Left out as not games" lines
   (js\scanpassed.js), and whether those lines name <folder>\<file> (every file is on pointing). */
function namedWhere(folder, file) {
  return `(() => { const ed = document.getElementById("editor"), sl = String.fromCharCode(92);
    const h = [...ed.querySelectorAll("h2.bk-head")].find(x => x.textContent === "Left out as not games"), lines = [];
    for (let n = h && h.nextElementSibling; n && n.tagName === "P"; n = n.nextElementSibling) { lines.push(n); }
    let rest = ed.textContent;
    [h, ...lines].forEach(n => { if (n) { rest = rest.replace(n.textContent, ""); } });
    return [rest.includes(${JSON.stringify(folder)}),
            lines.some(n => n.title.split(String.fromCharCode(10)).some(f => f.endsWith(${JSON.stringify(folder)} + sl + ${JSON.stringify(file)})))]; })()`;
}

function buildFixture() {
  fs.rmSync(FIX, { recursive: true, force: true });
  const put = (rel, body) => {
    const p = path.join(FIX, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body || "x");
  };
  // flat cartridges
  put("systems/n64/Xsfix Kart (USA).z64");
  put("systems/n64/Vimm's Lair.txt");                       // junk
  // a folder that is the game, named tersely, the file saying more
  put("systems/psx/XF8/Xsfix Fantasy (USA) (Disc 1)/Xsfix Fantasy (USA) (Disc 1).cue");
  put("systems/psx/XF8/Xsfix Fantasy (USA) (Disc 1)/Xsfix Fantasy (USA) (Disc 1).bin");
  // a top-level disc pair that must collapse to Disc 1
  put("systems/psx/Xsfix Quest (USA) (Disc 1).cue");
  put("systems/psx/Xsfix Quest (USA) (Disc 1).bin");
  put("systems/psx/Xsfix Quest (USA) (Disc 2).cue");
  put("systems/psx/Xsfix Quest (USA) (Disc 2).bin");
  // an m3u that must beat its own discs
  put("systems/psx/Xsfix Saga.m3u", "Xsfix Saga CD1.cue\nXsfix Saga CD2.cue\n");
  put("systems/psx/Xsfix Saga CD1.cue");
  put("systems/psx/Xsfix Saga CD1.bin");
  put("systems/psx/Xsfix Saga CD2.cue");
  put("systems/psx/Xsfix Saga CD2.bin");
  // a set with a hole: disc 2 and no disc 1
  put("systems/psx/Xsfix Hole (USA) (Disc 2).cue");
  put("systems/psx/Xsfix Hole (USA) (Disc 2).bin");
  // an archive on a disc console: flagged, never offered
  put("systems/psx/Xsfix Archived (USA).7z");
  // an empty archive with a browser's part file beside it: a download not finished, named, never offered
  fs.writeFileSync(path.join(FIX, "systems/psx/Xsfix Unfinished (USA).7z"), "");
  put("systems/psx/Xsfix Unfinished (USA).k3Rt9pQa.7z.part");
  const stopped = new Date("2026-10-13T21:21:00");
  fs.utimesSync(path.join(FIX, "systems/psx/Xsfix Unfinished (USA).k3Rt9pQa.7z.part"), stopped, stopped);
  // a dump that is only its tracks, sheet missing: named in its own tail,
  // never offered, because a track bin with no cue launches nowhere
  put("systems/dreamcast/Xsfix Orphan (USA) (Rev A)/Xsfix Orphan (USA) (Rev A) (Track 1).bin");
  put("systems/dreamcast/Xsfix Orphan (USA) (Rev A)/Xsfix Orphan (USA) (Rev A) (Track 2).bin");
  // a top-level track bin whose cue is named differently: the cue is the
  // game and the track is its data (a same-name guard alone misses this)
  put("systems/dreamcast/Xsfix Sheet (USA).cue", 'FILE "Xsfix Sheet (USA) (Track 1).bin" BINARY\n');
  put("systems/dreamcast/Xsfix Sheet (USA) (Track 1).bin");
  // an emulator's own data beside the games, never offered (Dolphin's
  // portable User folder, its NAND's fst.bin passing for a disc)
  put("systems/psx/User/Config/Dolphin.ini");
  put("systems/psx/User/Wii/fst.bin");
  put("systems/psx/bios/scph1001.bin");
  put("systems/psx/saves/Xsfix Quest (USA) (Disc 1).bin");
  // the one game the run's copy of data\ "already has" (module.exports
  // seeds it), so a console the library knows exists
  put("systems/psx/Xsfix Known.cue");
  // the PS3 shape
  put("systems/ps3/Xsfix Thieves/PS3_GAME/USRDIR/EBOOT.BIN");
  // a console the library does not have but the emulator table knows:
  // playable, not warned about
  put("systems/saturn/Xsfix Dragoon Saga.chd");
  // and one REAL title on that console, for the Games Database pass: the
  // invented ones prove a miss is honest, this one proves a hit is right
  put("systems/saturn/Panzer Dragoon Saga (USA).chd");
  // and one the table does not know (its name: a version number that is not
  // a file ending, a note in braces and one whose closing bracket was lost)
  put("systems/channelf/Xsfix Channel v1.2 {beta} [T+Eng (2017).zip");
  /* Folders under a console's folder, to any depth. A folder of several
     games is a shelf; one of a single game is that game; a game unpacked
     into its folder stays one game (a bare .bin is never a shelf's game). */
  put("systems/n64/Hack/Xsfix Nested A.zip");
  put("systems/n64/Hack/Xsfix Nested B.zip");
  put("systems/n64/Hack/More/Even more/Xsfix Nested C.zip");
  // empty archives on a cartridge console, where a .zip is a game: downloads not finished, at the top and on a shelf
  fs.writeFileSync(path.join(FIX, "systems/n64/Xsfix Cart Unfinished (USA).zip"), "");
  fs.writeFileSync(path.join(FIX, "systems/n64/Hack/Xsfix Shelf Unfinished (USA).7z"), "");
  put("systems/n64/New/Xsfix Fresh.z64");
  put("systems/saturn/Shelf/Xsfix One.chd");
  put("systems/saturn/Shelf/Xsfix Two.chd");
  put("systems/psx/Xsfix Unpacked/Xsfix Unpacked.cue");
  put("systems/psx/Xsfix Unpacked/data/level one.bin");
  put("systems/psx/Xsfix Unpacked/data/level two.bin");
  // a folder named the way a new person names it: the console's full name
  put("systems/Game Boy Advance/Xsfix Advance (USA).gba");
  // noise the scanner must name, not swallow
  put("systems/weirdfolder/file.bin");
  // arcade sets: a game, another version of it, a version whose main set is not here, a BIOS set, and a name the list does not hold
  for (const set of ["kof2003", "kof2003h", "sf2ua", "neogeo", "xsfixnew"]) { put("systems/mame/" + set + ".zip"); }
  put("systems/_incoming-test/half.iso");
}

/* ---- stand-ins a console can be read from (includes\romid.php) ----------
   Small, and real where it matters: the zip has a true list of names and a
   true packed file, the disc images carry the words each console writes at
   the place it writes them. */
// A .zip of [name, body, packed?] entries.
function zipOf(files) {
  const zlib = require("zlib");
  const parts = [], central = [];
  let at = 0;
  for (const [name, body, packed] of files) {
    const raw = Buffer.from(body), data = packed ? zlib.deflateRawSync(raw) : raw, nm = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(packed ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nm.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(packed ? 8 : 0, 10);
    cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(at, 42);
    parts.push(local, nm, data); central.push(cd, nm);
    at += 30 + nm.length + data.length;
  }
  const cdBuf = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat(parts.concat([cdBuf, end]));
}
// A Genesis cartridge: it signs itself 256 bytes in.
function genesisRom() {
  const b = Buffer.alloc(0x400, 0xff);
  b.write("SEGA GENESIS    ", 0x100, "latin1");
  return b;
}
// A PlayStation disc as plain 2048 byte sectors: the label in sector 16, the
// root folder in 18 naming SYSTEM.CNF in 19, whose boot line says 1 or 2.
function playstationIso(bootLine) {
  const b = Buffer.alloc(20 * 2048), pvd = 16 * 2048, dir = 18 * 2048, name = "SYSTEM.CNF;1";
  b.write("\u0001CD001", pvd, "latin1"); b.write("PLAYSTATION", pvd + 8, "latin1"); b.writeUInt32LE(18, pvd + 156 + 2);
  b[dir] = 33 + name.length; b.writeUInt32LE(19, dir + 2); b[dir + 32] = name.length; b.write(name, dir + 33, "latin1");
  b.write(bootLine, 19 * 2048, "latin1");
  return b;
}
// A Saturn disc: its name is the first thing on it.
function saturnIso() {
  const b = Buffer.alloc(4096);
  b.write("SEGA SEGASATURN ", 0, "latin1");
  return b;
}
// A GameCube .ciso: a 32 KB map, then the disc's first block whole, magic number and all.
function cubeCiso() {
  const b = Buffer.alloc(0x8040);
  b.write("CISO", 0, "latin1"); b.writeUInt32LE(2097152, 4); b.writeUInt32BE(0xC2339F3D, 0x801C);
  return b;
}
// A .chd whose own notes say GD-ROM, the Dreamcast's disc.
function gdromChd() {
  const b = Buffer.alloc(124 + 16);
  b.write("MComprHD", 0, "latin1"); b.writeUInt32BE(124, 8); b.writeUInt32BE(5, 12); b.writeBigUInt64BE(124n, 48);
  b.write("CHGD", 124, "latin1");
  return b;
}

module.exports = async function (b, check) {
  buildFixture();
  /* The real accepted scans ride into the run's copy of data\, and every
     count below assumes the fixture is the scanner's whole world. So the
     copy's list is replaced with one game: a PSX cue in the fixture, which
     keeps a console the library already has and suppresses nothing. */
  const seeded = [{ id: "xs-scan-seedknown000", title: "Xsfix Known", platform: "Sony Playstation",
                    rom: path.join(FIX, "systems", "psx", "Xsfix Known.cue"), added: new Date().toISOString() }];
  const scanPath = path.join(DATA, "scanned-games.json");
  const scanWas = fs.existsSync(scanPath) ? fs.readFileSync(scanPath) : null;
  fs.writeFileSync(scanPath, JSON.stringify(seeded));
  const before = (await api("api/settings.php")).settings.paths.romRoot;
  try {
    await api("api/settings.php", { paths: { romRoot: FIX } });

    /* ---- the walk --------------------------------------------------------- */
    const r = await api("api/scan.php");
    check("the walk answers", r.ok === true);
    const titles = r.new.map((g) => g.platform + "|" + g.title).sort();
    check("it offers exactly the games that are there", titles, [
      "Arcade|Street Fighter II: The World Warrior",
      "Arcade|The King of Fighters 2003",
      "Arcade|xsfixnew",
      "Fairchild Channel F|Xsfix Channel v1.2",
      "Nintendo 64|Xsfix Fresh",
      "Nintendo 64|Xsfix Kart",
      "Nintendo 64|Xsfix Nested A",
      "Nintendo 64|Xsfix Nested B",
      "Nintendo 64|Xsfix Nested C",
      "Nintendo Game Boy Advance|Xsfix Advance",
      "Sega Dreamcast|Xsfix Sheet",
      "Sega Saturn|Panzer Dragoon Saga",
      "Sega Saturn|Xsfix Dragoon Saga",
      "Sega Saturn|Xsfix One",
      "Sega Saturn|Xsfix Two",
      "Sony Playstation 3|Xsfix Thieves",
      "Sony Playstation|Xsfix Fantasy",
      "Sony Playstation|Xsfix Hole",
      "Sony Playstation|Xsfix Quest",
      "Sony Playstation|Xsfix Saga",
      "Sony Playstation|Xsfix Unpacked",
    ]);
    const by = {};
    r.new.forEach((g) => { by[g.title] = g; });
    check("a terse folder takes its title from the file inside", !!by["Xsfix Fantasy"]);
    check("a disc pair collapsed to one game", by["Xsfix Quest"].rom.includes("(Disc 1).cue"));
    check("never a bare disc 2", r.new.filter((g) => /Disc 2/.test(g.rom)).map((g) => g.title), ["Xsfix Hole"]);
    check("the m3u beat its own discs", by["Xsfix Saga"].rom.endsWith(".m3u"));
    check("the PS3 folder resolved to its EBOOT", by["Xsfix Thieves"].rom.endsWith("EBOOT.BIN"));
    check("the set with a hole is warned about", r.gaps.length === 1 && r.gaps[0].why, "no disc 1 here");
    check("a track bin beside a differently named cue is the cue's data, not a game",
      r.new.filter((g) => /Track/.test(g.rom)).length, 0);
    check("the trackless dump is named in its own tail, not swallowed",
      r.orphans.length === 1 && r.orphans[0].folder === "Xsfix Orphan (USA) (Rev A)" && /cue sheet/.test(r.orphans[0].why));
    check("the archive is flagged, not offered", r.archives.length === 1 && /Extract it and rescan/.test(r.archives[0].why));
    const unfPsx = r.unfinished.filter((u) => u.platform === "Sony Playstation");
    check("an empty archive is a download not finished: named with its part file, never offered to unpack",
      [unfPsx.map((u) => u.file.split(/[\\/]/).pop()), /stopped part way on .* in Xsfix Unfinished \(USA\)\.k3Rt9pQa\.7z\.part beside it/.test((unfPsx[0] || {}).why)],
      [["Xsfix Unfinished (USA).7z"], true]);
    check("on a cartridge console too, at the top of its folder and on a shelf, and never offered as a game",
      r.unfinished.filter((u) => u.platform === "Nintendo 64").map((u) => u.file.split(/[\\/]/).pop()).sort(),
      ["Xsfix Cart Unfinished (USA).zip", "Xsfix Shelf Unfinished (USA).7z"]);
    const packed = path.join(FIX, "systems/psx/Xsfix Archived (USA).7z"), unf = path.join(FIX, "systems/psx/Xsfix Unfinished (USA).7z");
    check("Clear it refuses an archive that is not empty, and leaves it where it is",
      [(await api("api/scan.php", { action: "clear", file: packed })).ok, fs.existsSync(packed)], [false, true]);
    const cleared = await api("api/scan.php", { action: "clear", file: unf });
    check("Clear it deletes an empty archive and its part file, and says how much came back",
      [cleared.ok, cleared.freed, fs.existsSync(unf), fs.existsSync(unf.replace(/\.7z$/, ".k3Rt9pQa.7z.part"))], [true, 1, false, false]);
    check("the unrecognised folder is named", r.unknown.some((u) => u.folder === "weirdfolder"));
    /* Folders under a console's folder. The exact list above already holds
       them; these say which rule put each one there. */
    check("a folder of several games is a shelf, read to any depth, a folder named new included",
      ["Xsfix Nested A", "Xsfix Nested B", "Xsfix Nested C", "Xsfix Fresh", "Xsfix One", "Xsfix Two"].map((t) => !!by[t] && by[t].rom.startsWith(FIX)),
      [true, true, true, true, true, true]);
    check("a game unpacked into its folder is still one game, whatever data files lie under it",
      [by["Xsfix Unpacked"].rom.endsWith("Xsfix Unpacked.cue"), r.new.filter((g) => /level (one|two)/.test(g.rom)).length], [true, 0]);
    check("the walk says which folder names it understands", [r.names.snes, r.names.psx], ["Super Nintendo Entertainment System", "Sony Playstation"]);
    check("a title keeps its version number and loses its notes, closed or not", !!by["Xsfix Channel v1.2"]);
    check("arcade sets are named from MAME's own list, by the file's short name, and one the list does not hold keeps its file's name",
      [by["The King of Fighters 2003"].rom.endsWith("kof2003.zip"), by["Street Fighter II: The World Warrior"].rom.endsWith("sf2ua.zip"), by["xsfixnew"].platform], [true, true, "Arcade"]);
    check("another version beside its main set and a BIOS set are not offered, and the folder's line counts each",
      [r.new.filter((g) => /kof2003h|neogeo/.test(g.rom)).length, (r.arcade || []).map((a) => [path.basename(a.folder), a.sets, a.games, a.versions, a.bios, a.machines, a.unknown])],
      [0, [["mame", 5, 2, 1, 1, 0, 1]]]);
    check("and the mame folder is no longer skipped", r.skippedFolders.some((s) => /mame|arcade/i.test(s.folder + s.why)), false);
    check("the staging folder is skipped", r.skippedFolders.some((s) => s.folder === "_incoming-test"));
    check("Saturn is called a new console", r.newPlatforms.includes("Sega Saturn"));
    check("but not accused of missing an emulator: the table knows it here",
      r.noEmulator.includes("Sega Saturn"), false);
    check("the console the table does not know is the one named",
      r.noEmulator, ["Fairchild Channel F"]);
    check("consoles the library has are not called new", r.newPlatforms.includes("Sony Playstation"), false);

    /* ---- the trail and the failures --------------------------------------- */
    const tail = (await api("api/log.php?tail=60")).lines.join("\n");
    check("every walk leaves a SCAN line with its counts", /SCAN\s+walk .*offered.*\d+ files no console could be read from.*in \d+ms/.test(tail));

    await api("api/settings.php", { paths: { romRoot: FIX + "-unplugged" } });
    const unplugged = await api("api/scan.php");
    check("a missing ROM folder is a sentence, not an empty answer",
      unplugged.ok === false && /is not there/.test(unplugged.error || ""));
    await api("api/settings.php", { paths: { romRoot: FIX } });

    const ghost = await api("api/scan.php", { action: "accept", games: [{
      id: "xs-scan-000000000000", title: "Xsfix Ghost", platform: "Nintendo 64",
      rom: FIX + "\\systems\\n64\\ghost.z64" }] });
    check("a pick whose file vanished is skipped and says so",
      ghost.ok === true && ghost.added === 0
        && ghost.skipped.length === 1 && /not there any more/.test(ghost.skipped[0].why));

    /* ---- accepting -------------------------------------------------------- */
    const picks = r.new.filter((g) => g.title !== "Xsfix Hole");
    const acc = await api("api/scan.php", { action: "accept", games: picks });
    check("accepting keeps the selected ones", acc.ok === true && acc.added, picks.length);
    const twice = await api("api/scan.php", { action: "accept", games: picks });
    check("accepting the same picks again skips them all, each with the reason",
      twice.added === 0 && twice.skipped.length === picks.length
        && twice.skipped.every((s) => /already accepted/.test(s.why)));

    const lib = await api("api/library.php");
    // By id, not by an invented prefix: one of the fixture's titles is real.
    const mine = lib.games.filter((g) => picks.some((p) => p.id === g.id));
    check("they are in the library on the next read", mine.length, picks.length);
    check("the deselected one is not", lib.games.some((g) => g.title === "Xsfix Hole"), false);
    // four: the two at the top of saturn\ and the two on its shelf (saturn\Shelf)
    check("Saturn stands as a console now", lib.platforms["Sega Saturn"], 4);
    // The flag must survive into the library row, or the page cannot tell a
    // scanned game from an imported one.
    const panzer = mine.find((g) => g.title === "Panzer Dragoon Saga");
    check("a scanned row says it was scanned", !!panzer && panzer.scanned, true);
    check("and only the scanned ones say so", lib.games.filter((g) => g.scanned).length, mine.length + seeded.length);

    const kart = mine.find((g) => g.title === "Xsfix Kart");
    check("a console with an emulator gets a real command", kart.playable, true);
    const dry = await api("api/launch.php", { id: kart.id, dry: true });
    check("and a dry launch builds it, core and all", dry.ok === true && /-L\s/.test(JSON.stringify(dry)));

    const sat = mine.find((g) => g.title === "Xsfix Dragoon Saga");
    check("a brand-new console with a table entry is simply playable", sat.playable && !sat.why, true);
    const chan = mine.find((g) => g.title === "Xsfix Channel v1.2");
    check("a console with no emulator says exactly what to do", /Emulators > Add an emulator/.test(chan.why || ""), true);

    /* ---- the ROM folder away --------------------------------------------
       With the drive out, the drive is "not there", not each game: they stay
       whole on screen to browse, and Ready to play leaves them out. The
       fixture is moved aside to stand for a drive pulled out. */
    const away = FIX + "-away";
    fs.renameSync(FIX, away);
    try {
      const out = (await api("api/library.php")).games.find((g) => g.id === kart.id);
      check("with the ROM folder away, its game still reads as playable, nothing against it",
        !!out && out.playable === true && !out.why, true);
      check("and it is in no Missing files list", (await api("api/library.php?platform=%40missing")).games.some((g) => g.id === kart.id), false);
      check("but Ready to play leaves it out", (await api("api/library.php?ready=1")).games.some((g) => g.id === kart.id), false);
    } finally {
      fs.renameSync(away, FIX);
    }
    check("with it back, the game is ready again", (await api("api/library.php?ready=1")).games.some((g) => g.id === kart.id), true);

    /* ---- editing one -----------------------------------------------------
       A scanned game is edited through the metadata overlay: it is not in
       library.json, and it has no form of its own like a game of yours. */
    const ed = await api("api/edit.php", { id: sat.id, set: { title: "Xsfix Dragoon Saga II", genre: "Role Playing" } });
    check("a scanned game can be renamed", ed.ok === true && ed.edited.slice().sort(), ["genre", "title"]);
    check("and is told apart from an imported game and one of your own", ed.origin, "scanned");
    const one = (await api("api/game.php?id=" + encodeURIComponent(sat.id))).game;
    check("the new name is what the library reads back", one.title, "Xsfix Dragoon Saga II");
    check("the dialog is told whose values its reset buttons put back", one.origin, "scanned");
    // Not LaunchBox's, because there are none: what the scanner read off the
    // file name is the only thing there is to go back to.
    check("and what that value is: the scanner's title", one.source.title, "Xsfix Dragoon Saga");
    const back = await api("api/edit.php", { id: sat.id, set: { title: "Xsfix Dragoon Saga" } });
    check("typing the scanner's own title back stops being an edit", back.edited, ["genre"]);
    check("reset all takes the rest off", (await api("api/edit.php", { id: sat.id, reset: "all" })).edited, []);
    // The title is not how a scanned game is found on the disk, so renaming
    // one must not touch its launch. The id is a hash of console and file
    // name for the same reason.
    check("a renamed scanned game still launches",
          (await api("api/launch.php", { id: sat.id, dry: true })).ok, true);
    check("and an id that is in none of the three homes still says unknown game",
          (await api("api/edit.php", { id: "xs-scan-000000000000", set: { genre: "No" } })).error, "unknown game");

    /* ---- the Games Database pass ------------------------------------------
       Invented titles must come back as nothing, not a guess; the real one
       found on its own console and sure. Metadata is written for real
       (overrides.json is in the Guard); pictures are named, not fetched. */
    const fill = await api("api/fill.php?scope=scanned");
    check("the pass lists every scanned game", fill.ok === true && fill.count, mine.length + seeded.length);
    const fp = fill.games.find((g) => g.id === panzer.id);
    check("a real title is matched, and sure of it", !!fp && fp.match.confidence === "sure" && fp.match.best.title, "Panzer Dragoon Saga");
    check("on its own console", fp.match.best.platform, "Sega Saturn");
    check("an invented one matches nothing and says so", fill.games.find((g) => g.id === kart.id).match.confidence, "none");
    check("and the sure ones are counted", fill.sure >= 1);
    check("it refuses without a match", (await api("api/fill.php", { id: panzer.id })).ok, false);
    check("and refuses a picture slot that does not exist",
          (await api("api/fill.php", { id: panzer.id, dbId: fp.match.best.id, pictures: ["poster"] })).ok, false);
    const filled = await api("api/fill.php", { id: panzer.id, dbId: fp.match.best.id, metadata: true, pictures: ["box", "logo"], dry: true });
    check("filling takes the empty fields from the database", filled.ok === true && filled.filled.includes("developer") && filled.filled.includes("released"));
    check("and names the picture it would fetch, fetching nothing", /^would fetch (https|file):\/\//.test(filled.pictures.box || ""));
    const pz = (await api("api/game.php?id=" + encodeURIComponent(panzer.id))).game;
    check("the game has a developer now", pz.developer !== "");
    // The scanner writes 0 players, and that 0 must not be read as a value to keep.
    check("and its player count, which the scan left at 0", [filled.filled.includes("players"), pz.players > 0], [true, true]);
    check("as an edit, so it can be put back in the scan's name", pz.origin === "scanned" && pz.edited.includes("developer"));
    check("the match is remembered for Find online", (await api("api/gamesdb.php?id=" + encodeURIComponent(panzer.id) + "&what=game")).dbId, fp.match.best.id);
    const twiceF = await api("api/fill.php", { id: panzer.id, dbId: fp.match.best.id, metadata: true, pictures: [], dry: true });
    check("a second pass fills nothing and keeps what is there", twiceF.filled.length === 0 && twiceF.kept.includes("developer"));
    await api("api/edit.php", { id: panzer.id, set: { genre: "Mine" } });
    await api("api/fill.php", { id: panzer.id, dbId: fp.match.best.id, metadata: true, pictures: [], dry: true });
    check("a field you typed is left alone", (await api("api/game.php?id=" + encodeURIComponent(panzer.id))).game.genre, "Mine");
    check("and the row is listed as chosen before from then on",
          (await api("api/fill.php?scope=scanned")).games.find((g) => g.id === panzer.id).match.confidence, "linked");

    /* ---- whose decision each game is ---------------------------------------
       A guess, and two of your games matching one entry under different
       names, are for a person to check, or both get one name. Made here by
       hand: the other Saturn game is linked to Panzer's entry. */
    const sorted = (await api("api/fill.php?scope=scanned")).games;
    check("the pass says whose decision each game is: chosen before but no box yet is ready, nothing found is none",
          [sorted.find((g) => g.id === panzer.id).state, sorted.find((g) => g.id === kart.id).state], ["ready", "none"]);
    const dbPanzer = fp.match.best.id;
    await api("api/gamesdb.php?id=" + encodeURIComponent(panzer.id) + "&link=0", {});
    await api("api/gamesdb.php?id=" + encodeURIComponent(sat.id) + "&link=" + dbPanzer, {});
    const clash = (await api("api/fill.php?scope=scanned")).games.find((g) => g.id === panzer.id);
    check("a game whose entry another of your games already is, under a different name, is for a person to check",
          [clash.state, clash.why, clash.with], ["check", "clash", ["Xsfix Dragoon Saga"]]);
    const keptName = await api("api/fill.php", { id: panzer.id, dbId: dbPanzer, metadata: true, pictures: [], dry: true });
    check("and filled anyway, it keeps the name its file gave it", [keptName.ok, keptName.nameKeptFor], [true, "Xsfix Dragoon Saga"]);
    await api("api/gamesdb.php?id=" + encodeURIComponent(sat.id) + "&link=0", {});
    check("a pass in the background is asked for by its kind, and one of picked games needs some",
          [(await api("api/fill.php", { job: "start", mode: "everything" })).ok, (await api("api/fill.php", { job: "start", mode: "picked", picks: [] })).error], [false, "nothing is selected"]);
    check("Stop with nothing running stops nothing", [(await api("api/fill.php", { job: "stop" })).stopping], [false]);
    check("and Getting started is told no pass is at work", (await api("api/setup.php?guide=1")).guide.filling, false);
    check("with the other one let go, it is ready again",
          (await api("api/fill.php?scope=scanned")).games.find((g) => g.id === panzer.id).state, "ready");

    /* ---- one playlist for a disc set ------------------------------------
       The pair with no m3u is offered one; a set with one or with a hole is
       not. The file is written only from what the disk holds. */
    check("the walk offers a playlist for the set with no m3u", r.m3u.some((m) => m.file === "Xsfix Quest (USA).m3u" && m.discs.length === 2));
    check("but not for the set that has one, nor the one with a hole", r.m3u.every((m) => !/Saga|Hole/.test(m.title)));
    const m = r.m3u.find((x) => x.file === "Xsfix Quest (USA).m3u");
    check("a folder outside the scan roots is refused", (await api("api/scan.php", { action: "m3u", dir: os.tmpdir(), file: m.file })).ok, false);
    check("a name with a path in it is refused", (await api("api/scan.php", { action: "m3u", dir: m.dir, file: "..\\x.m3u" })).ok, false);
    check("a set that is not there is refused", (await api("api/scan.php", { action: "m3u", dir: m.dir, file: "Xsfix Nothing (USA).m3u" })).ok, false);
    const built = await api("api/scan.php", { action: "m3u", dir: m.dir, file: m.file });
    check("the offered one is written", built.ok === true && built.discs.length, 2);
    check("and lists the discs in order, by name only",
          fs.readFileSync(path.join(m.dir, m.file), "utf8"), "Xsfix Quest (USA) (Disc 1).cue\nXsfix Quest (USA) (Disc 2).cue\n");
    check("writing it twice is refused", (await api("api/scan.php", { action: "m3u", dir: m.dir, file: m.file })).ok, false);
    const quest = mine.find((g) => g.title === "Xsfix Quest");
    const dryQ = await api("api/launch.php", { id: quest.id, dry: true });
    check("the game accepted as Disc 1 now launches through the playlist", dryQ.ok === true && /Xsfix Quest \(USA\)\.m3u/.test(JSON.stringify(dryQ)));
    check("and the next walk has nothing to offer for it", !(await api("api/scan.php")).m3u.some((x) => x.file === m.file));

    /* ---- rescans and removal --------------------------------------------- */
    const again = await api("api/scan.php");
    check("a rescan does not offer what was accepted", again.new.map((g) => g.title), ["Xsfix Hole"]);

    const gone = await api("api/scan.php", { action: "remove", id: kart.id });
    check("a scanned game can be taken back out", gone.ok === true);
    const after = await api("api/library.php");
    check("and it is gone from the library", after.games.some((g) => g.id === kart.id), false);
    check("removing a made-up id refuses", (await api("api/scan.php", { action: "remove", id: "xs-scan-nope" })).ok, false);

    /* ---- more than one folder --------------------------------------------
       A second root is built beside the fixture and added through the
       endpoint, exactly as the screen does it. */
    const EXTRA = FIX + "-second";
    fs.rmSync(EXTRA, { recursive: true, force: true });
    fs.mkdirSync(path.join(EXTRA, "systems", "gba"), { recursive: true });
    fs.writeFileSync(path.join(EXTRA, "systems", "gba", "Xsfix Second (USA).gba"), "x");
    /* Games outside any console's folder: each file is asked which console
       it is for. Ones that cannot say (a .chd, a zip of zips) are counted,
       never guessed at; what is not a game (a patch, a .md note) is not mentioned. */
    const loose = (rel, body) => {
      const p = path.join(EXTRA, "systems", rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body);
    };
    loose("Xsfix Stray (USA).gba", "x");
    loose("Xsfix Sealed (USA).chd", "x");
    loose("Old downloads/Xsfix Zipped (USA).zip", zipOf([["Xsfix Zipped (USA).sfc", "x"], ["readme.txt", "hello"]]));
    loose("Old downloads/Xsfix Bundle.zip", zipOf([["one.zip", "x"], ["two.zip", "x"]]));
    loose("Old downloads/deeper/Xsfix Sonic.zip", zipOf([["rom.bin", genesisRom(), true]]));
    loose("Old downloads/deeper/Xsfix Patch.zip", zipOf([["fix.ips", "x"], ["readme.txt", "x"]]));
    loose("Old downloads/deeper/notes.md", "# notes\nnot a Genesis game\n");
    loose("Old downloads/deeper/Xsfix Station Two (USA).iso", playstationIso("BOOT2 = cdrom0:\\SLUS_000.00;1\r\n"));
    loose("Old downloads/deeper/Xsfix Station One (USA).iso", playstationIso("BOOT = cdrom:\\SLUS_000.00;1\r\n"));
    loose("Old downloads/deeper/Xsfix Saturnine.iso", saturnIso());
    loose("Old downloads/deeper/Xsfix Dream.chd", gdromChd());
    /* A games folder holding Xsegon itself and RetroArch: a program's own
       folder is not looked through, or its system\dc\*.bin and cheats\
       README.md pass for games. Also a file named with underscores for spaces. */
    loose("Emulators/RetroArch/retroarch.exe", "not a real one");
    loose("Emulators/RetroArch/system/dc/Xsfix Nvmem.bin", "x");
    loose("Emulators/RetroArch/cheats/Atari - Jaguar/README.md", "# cheats\n");
    loose("Emulators/RetroArch/downloads/Xsfix Inside RetroArch (USA).gba", "x");
    loose("Xsegon-test/Xsegon/router.php", "x");
    loose("Xsegon-test/Xsegon/start.ps1", "x");
    loose("Xsegon-test/Xsegon/includes/boot.php", "x");
    loose("Xsegon-test/Xsegon/data/emulators/snes/Xsfix Inside Xsegon (USA).sfc", "x");
    loose("gba/README.md", "# the games in this folder\n");
    loose("Xsfix_Under_Score_USA.gba", "x");
    // and a folder that IS named for a console, met on the way down
    loose("Old downloads/deeper/gbc/Xsfix Deep (USA).zip", "x");
    /* In a console's folder the file overrules the folder when it names for sure a console the
       folder's cannot play (xs_scan_file_says): a PlayStation disc in gc, a .sfc in nes. A GameCube
       .ciso stays (the PSP uses .ciso too), and a Game Boy game in gba stays: it plays there. */
    loose("gc/Xsfix Misfiled Fighter (USA).iso", playstationIso("BOOT = cdrom:\\SLUS_006.05;1\r\n"));
    loose("gc/Xsfix Cube Kart (USA).ciso", cubeCiso());
    loose("nes/Xsfix Misfiled Plumber (USA).sfc", "x");
    loose("gba/Xsfix Old Pocket (USA).gb", "x");
    // And a console's own folder, added by itself: its name says which console it is.
    const OWNBASE = FIX + "-own";
    const OWN = path.join(OWNBASE, "gb");
    fs.rmSync(OWNBASE, { recursive: true, force: true });
    fs.mkdirSync(OWN, { recursive: true });
    fs.writeFileSync(path.join(OWN, "Xsfix Pocket (USA).zip"), "x");
    const folders0 = (await api("api/settings.php")).settings.paths.scanFolders || [];
    try {
      check("a folder that is not there is refused, not saved",
            (await api("api/scan.php", { action: "addFolder", path: FIX + "-nope" })).ok, false);
      check("a real one is taken", (await api("api/scan.php", { action: "addFolder", path: EXTRA })).ok, true);
      check("the same one twice is refused",
            (await api("api/scan.php", { action: "addFolder", path: EXTRA })).ok, false);
      const two = await api("api/scan.php?folders=1");
      check("both are on the list", two.folders.map((f) => f.path), [FIX, EXTRA]);
      check("and the ROM drive is marked as not this screen's to remove", two.folders[0].fixed, true);

      const w2 = await api("api/scan.php");
      check("the walk says which folders it read", (w2.folders || []).filter((f) => f.ok).length, 2);
      check("and offers the game from the second one",
            (w2.new || []).some((g) => g.title === "Xsfix Second" && g.platform === "Nintendo Game Boy Advance"));
      check("while still offering the first one's",
            (w2.new || []).some((g) => g.title === "Xsfix Hole"));
      const placed = (title) => ((w2.new || []).find((g) => g.title === title) || {}).platform || null;
      check("a game file at the top of a games folder says its own console, and is offered there",
            placed("Xsfix Stray"), "Nintendo Game Boy Advance");
      check("a zip is opened as far as its names: the one game inside says the console",
            placed("Xsfix Zipped"), "Super Nintendo Entertainment System");
      check("a Genesis game zipped as a plain .bin is known by the name it signs inside itself",
            placed("Xsfix Sonic"), "Sega Genesis");
      check("a PlayStation disc is 1 or 2 by its own boot line",
            [placed("Xsfix Station One"), placed("Xsfix Station Two")], ["Sony Playstation", "Sony Playstation 2"]);
      check("a Saturn disc and a Dreamcast .chd say so themselves",
            [placed("Xsfix Saturnine"), placed("Xsfix Dream")], ["Sega Saturn", "Sega Dreamcast"]);
      check("a folder named for a console, three levels down a folder that is not, is read as that console",
            placed("Xsfix Deep"), "Nintendo Game Boy Color");
      check("in a console's folder, a disc naming a console the folder's cannot play is offered as its own, and so is an ending only one console uses",
            [placed("Xsfix Misfiled Fighter"), placed("Xsfix Misfiled Plumber")], ["Sony Playstation", "Super Nintendo Entertainment System"]);
      check("a GameCube .ciso stays GameCube, and a Game Boy game in gba stays: the folder's console plays it",
            [placed("Xsfix Cube Kart"), placed("Xsfix Old Pocket")], ["Nintendo GameCube", "Nintendo Game Boy Advance"]);
      check("and a game offered as another console says which console's folder it stands in",
            ((w2.new || []).find((g) => g.title === "Xsfix Misfiled Fighter") || {}).filedIn, "Nintendo GameCube");
      check("what cannot say is counted where it lies and named by kind, never offered on a guess",
            [(w2.unsure || []).map((u) => u.folder.slice(EXTRA.length + 1).split(path.sep).join("/") + ": " + u.kinds).sort(),
             placed("Xsfix Sealed"), placed("Xsfix Bundle")],
            [["systems/Old downloads: 1 .zip", "systems: 1 .chd"], null, null]);
      const unsureLine = ((await api("api/log.php?tail=80")).lines || []).filter((l) => /SCAN +no console read from the files in: /.test(l)).pop() || "";
      check("and the log names each such folder with its kinds, so a report says what they are",
            [/Old downloads \(1 \.zip\)/.test(unsureLine), /systems \(1 \.chd\)/.test(unsureLine)], [true, true]);
      check("and what is not a game is neither offered nor mentioned: a patch in a zip, a note called .md",
            [placed("Xsfix Patch"), placed("notes"), (w2.unknown || []).some((u) => /Old downloads/.test(u.folder))], [null, null, false]);
      check("a program's own folder under a games folder is not looked through: nothing of RetroArch's or of a copy of Xsegon is offered",
            [placed("Xsfix Nvmem"), placed("README"), placed("Xsfix Inside RetroArch"), placed("Xsfix Inside Xsegon")], [null, null, null, null]);
      check("and each is named with the reason, never passed over in silence",
            (w2.skippedFolders || []).filter((s) => /not a place games are kept/.test(s.why)).map((s) => path.basename(s.folder) + ": " + s.why.split(",")[0]).sort(),
            ["RetroArch: RetroArch's own folder", "Xsegon: a copy of Xsegon"]);
      check("a README.md in a console's folder is a note, not a game of that console",
            (w2.new || []).some((g) => /README/i.test(g.title)), false);
      check("underscores standing for spaces are read as spaces",
            placed("Xsfix Under Score USA"), "Nintendo Game Boy Advance");
      check("a program's own folder chosen as the games folder is not read, and says why",
            await (async () => {
              const ra = path.join(EXTRA, "systems", "Emulators", "RetroArch");
              const added = await api("api/scan.php", { action: "addFolder", path: ra });
              const w = await api("api/scan.php");
              await api("api/scan.php", { action: "removeFolder", path: ra });
              const row = (w.folders || []).find((f) => f.path.toLowerCase() === ra.toLowerCase()) || {};
              return [added.ok, row.ok, /RetroArch's own folder, not a games folder/.test(row.why || ""), (w.new || []).some((g) => /Inside RetroArch|Nvmem/.test(g.title))];
            })(), [true, false, true, false]);

      /* The console folders, made on request: inside a games folder on the
         list and nowhere else; an existing one is left alone; twice is harmless. */
      const mk = await api("api/scan.php", { action: "makeFolders", path: EXTRA });
      check("console folders are made inside a games folder, one per console there is an emulator for",
            [mk.ok, mk.in === path.join(EXTRA, "systems"), mk.made.includes("snes") && mk.made.includes("psx"),
             fs.existsSync(path.join(EXTRA, "systems", "snes")), fs.existsSync(path.join(EXTRA, "systems", "psx"))],
            [true, true, true, true, true]);
      check("a console that already has its folder gets no second one",
            [mk.had.includes("gba"), mk.made.includes("gba"), mk.made.includes("gbc")], [true, false, true]);
      const mk2 = await api("api/scan.php", { action: "makeFolders", path: EXTRA });
      check("asked twice, nothing more is made", [mk2.ok, mk2.made.length], [true, 0]);
      check("a folder that is not on the list is refused",
            (await api("api/scan.php", { action: "makeFolders", path: path.join(EXTRA, "systems") })).ok, false);
      const w2b = await api("api/scan.php");
      check("and empty console folders change nothing that is offered",
            (w2b.new || []).map((g) => g.id).sort(), (w2.new || []).map((g) => g.id).sort());

      /* A console's own folder, added directly: the walk reads it as that
         console, and the folder list says which console it read it as. */
      check("a console's own folder is taken", (await api("api/scan.php", { action: "addFolder", path: OWN })).ok, true);
      check("and marked with the console it reads as",
            (await api("api/scan.php?folders=1")).folders.find((f) => f.path === OWN).console, "Nintendo Game Boy");
      const w3 = await api("api/scan.php");
      check("its games are offered on that console",
            (w3.new || []).some((g) => g.title === "Xsfix Pocket" && g.platform === "Nintendo Game Boy"));
      check("a parent folder is not read as a console", w3.folders.find((f) => f.path === FIX).console === undefined);

      check("the ROM drive cannot be removed here",
            (await api("api/scan.php", { action: "removeFolder", path: FIX })).ok, false);
      check("an added one can", (await api("api/scan.php", { action: "removeFolder", path: EXTRA })).ok, true);
      check("removing it twice is refused",
            (await api("api/scan.php", { action: "removeFolder", path: EXTRA })).ok, false);
      check("the console's folder can go too", (await api("api/scan.php", { action: "removeFolder", path: OWN })).ok, true);
      check("and they are off the list", (await api("api/scan.php?folders=1")).folders.length, 1);
    } finally {
      await api("api/settings.php", { paths: { scanFolders: folders0 } });
      fs.rmSync(EXTRA, { recursive: true, force: true });
      fs.rmSync(OWNBASE, { recursive: true, force: true });
    }

    /* ---- the Games folder a new copy starts with ---------------------------
       start.ps1 asks for it on every start. Made once, only for a copy with
       no games folder, a folder per console and a note. A test server makes
       it inside its own data copy, never beside the real Xsegon. */
    const GAMES = path.join(DATA, "Games");
    const same = (a, b2) => path.resolve(String(a)).toLowerCase() === path.resolve(String(b2)).toLowerCase();
    const setupPath = path.join(DATA, "setup.json");
    const setupWas = fs.existsSync(setupPath) ? fs.readFileSync(setupPath, "utf8") : null;
    const scanNow = fs.readFileSync(scanPath, "utf8");
    const first = () => api("api/scan.php", { action: "firstFolder" });
    fs.rmSync(GAMES, { recursive: true, force: true });
    try {
      const j0 = setupWas ? JSON.parse(setupWas.charCodeAt(0) === 0xFEFF ? setupWas.slice(1) : setupWas) : {};
      delete j0.gamesFolder;
      fs.writeFileSync(setupPath, JSON.stringify(j0));
      const f0 = await first();
      check("a copy that already has a games folder is given no Games folder", [f0.ok, f0.made, fs.existsSync(GAMES)], [true, false, false]);
      await api("api/settings.php", { paths: { romRoot: "", scanFolders: [] } });
      const f1 = await first();
      check("a copy with none gets one on its first start", [f1.ok, f1.made, same(f1.path, GAMES), fs.existsSync(GAMES)], [true, true, true, true]);
      const note = fs.existsSync(path.join(GAMES, "Put your games here.txt")) ? fs.readFileSync(path.join(GAMES, "Put your games here.txt"), "utf8") : "";
      check("with a folder for each console, and a note saying which is which",
            [fs.existsSync(path.join(GAMES, "snes")), fs.existsSync(path.join(GAMES, "psx")), f1.folders >= 5,
             /snes\s+Super Nintendo Entertainment System/.test(note), note.split("").some((c) => c.charCodeAt(0) === 0x2013 || c.charCodeAt(0) === 0x2014)], [true, true, true, true, false]);
      const listed = (await api("api/scan.php?folders=1")).folders;
      check("it is on the list Scan for Games looks in, marked as the one Xsegon made",
            [listed.length, same(listed[0].path, GAMES), listed[0].made, listed[0].there], [1, true, true, true]);
      const wf = await api("api/scan.php");
      check("scanned while empty, it is an answer and not an error: no games, no folder called unknown",
            [wf.ok, (wf.new || []).length, (wf.unknown || []).length], [true, 0, 0]);
      fs.writeFileSync(path.join(GAMES, "snes", "Xsfix Start (USA).sfc"), "x");
      fs.writeFileSync(path.join(GAMES, "Xsfix Anywhere (USA).gba"), "x");
      const wg = await api("api/scan.php");
      check("a game put in a console's folder, and one dropped at the top, are both offered",
            (wg.new || []).filter((g) => /Xsfix (Start|Anywhere)/.test(g.title)).map((g) => g.platform + "|" + g.title).sort(),
            ["Nintendo Game Boy Advance|Xsfix Anywhere", "Super Nintendo Entertainment System|Xsfix Start"]);
      const rv = await api("api/reveal.php", { what: "games" });
      check("Open the folder answers with that folder (no window from a test)", [rv.ok, same(rv.folder, GAMES), rv.dry], [true, true, true]);
      const f2 = await first();
      check("the next start makes nothing more", [f2.ok, f2.made], [true, false]);

      // The guide's step 2: named and still open while no game is in yet,
      // checked off once there are games.
      const step2 = `(s => ({ state: s.classList.contains("done") ? "done" : "todo", buttons: [...s.querySelectorAll("button")].map(x => x.textContent), text: s.querySelector(".gd-text").textContent }))([...document.querySelectorAll("#editor .gd-step")][1])`;
      const guideUp = async () => { await b.openBar("help"); await b.menuItem(/Getting started/); await b.until(`document.querySelectorAll("#editor .gd-step").length`, 5, 8000); };
      await b.goto(BASE + "/");
      await b.enterConsole();
      await b.setView("grid");
      await guideUp();
      const sDone = await b.ev(step2);
      check("with games in the library, the guide's step 2 is done and still offers the Games folder",
            [sDone.state, sDone.buttons], ["done", ["Add another folder...", "Open the Games folder"]]);
      await b.key("Escape");
      await b.until(`document.getElementById("editor").hidden`);
      fs.writeFileSync(scanPath, "[]");
      const bare = (await api("api/setup.php?guide=1")).guide;
      check("the guide is told which folder is Xsegon's own", [bare.games, bare.folders.length, bare.folders[0].made], [0, 1, true]);
      await guideUp();
      const sTodo = await b.ev(step2);
      check("with no games yet, step 2 stays open and says where the folder is",
            [sTodo.state, sTodo.buttons, /Xsegon made you a games folder/.test(sTodo.text), sTodo.text.toLowerCase().includes(path.resolve(GAMES).toLowerCase())],
            ["todo", ["Open the folder", "Choose another folder..."], true, true]);
      fs.writeFileSync(scanPath, scanNow);
      await b.key("Escape");
      await b.until(`document.getElementById("editor").hidden`);

      check("taken off the list, it can go", (await api("api/scan.php", { action: "removeFolder", path: f1.path })).ok, true);
      const f3 = await first();
      check("and it is not brought back by the next start", [f3.made, (await api("api/scan.php?folders=1")).folders.length], [false, 0]);
    } finally {
      fs.writeFileSync(scanPath, scanNow);
      await api("api/settings.php", { paths: { romRoot: FIX, scanFolders: folders0 } });
      if (setupWas === null) { fs.rmSync(setupPath, { force: true }); } else { fs.writeFileSync(setupPath, setupWas); }
      fs.rmSync(GAMES, { recursive: true, force: true });
    }

    /* ---- the screen ------------------------------------------------------- */
    await b.goto(BASE + "/");
    await b.enterConsole();
    await b.setView("grid");
    await b.openBar("games");
    await b.menuItem(/Scan for Games/);
    check("Games opens it", await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "SCAN FOR GAMES"`, 10000));
    check("the folders it looks in are on the screen, with a way to add one",
          await b.waitFor(`document.querySelectorAll("#editor .sc-folder").length > 0 &&
                           !!document.querySelector("#editor .sc-addfolder button")`, 8000));
    check("adding is the Windows folder window, with no box to type a path in",
          await b.ev(`[[...document.querySelectorAll("#editor .sc-addfolder button")].map(x => x.textContent), !!document.querySelector("#editor .sc-addfolder input")]`),
          [["Add a folder..."], false]);
    // From the Games menu there is nowhere behind this screen, so no Back is offered.
    check("and no Back to nowhere when it was opened from the Games menu",
          await b.ev(`[...document.querySelectorAll("#editor button")].some(x => /Back/.test(x.textContent))`), false);
    check("the offer is on screen, selected", await b.waitFor(`document.querySelectorAll("#editor .sc-row input:checked").length >= 1`, 8000));
    check("the Add button comes before the list and is held in view, not left under the last game",
          await b.ev(`(g => !!g && !!(g.compareDocumentPosition(document.querySelector("#editor .sc-rows")) & Node.DOCUMENT_POSITION_FOLLOWING) && getComputedStyle(g.closest(".fl-bar")).position === "sticky")([...document.querySelectorAll("#editor button")].find(x => /^Add the selected games/.test(x.textContent)))`), true);
    check("what was skipped says why, and a folder of arcade sets says what its files were taken for",
          await b.ev(`(t => [/not a console folder/.test(t), /5 files, 2 games named from MAME's own list/.test(t), /1 BIOS or device set/.test(t)])(document.getElementById("editor").textContent)`), [true, true, true]);
    check("a folder with no games in it is not listed: its file is named only under Left out as not games",
          await b.ev(namedWhere("weirdfolder", "file.bin")), [false, true]);
    await b.key("Escape");
    await sleep(600);

    /* ---- and the pass, on the real screen --------------------------------- */
    await b.openBar("media");
    check("Pictures & Videos has Get Pictures and Get Specific Pictures side by side on one row",
          await b.ev(`(p => !!p && [...p.children].map(n => n.querySelector(".ctx-label").textContent).join("|") === "Get Pictures|Get Specific Pictures..." && Math.abs(p.children[0].getBoundingClientRect().top - p.children[1].getBoundingClientRect().top) < 2 && p.children[1].getBoundingClientRect().left >= p.children[0].getBoundingClientRect().right - 1)(document.querySelector(".ctx .ctx-pair"))`), true);
    await b.menuItem(/^Get Specific Pictures/);
    check("Get Specific Pictures opens the pass", await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "GET SPECIFIC PICTURES"`, 10000));
    /* The first screen lists every scanned game from the library alone, so
       it is up at once; nothing is looked up until its button is pressed.
       Kart was taken back out above, and the seeded game counts as scanned. */
    const scannedN = picks.length - 1 + seeded.length;
    const jobWas = JSON.stringify((await api("api/fill.php?job=1")).job);
    const pickRows = `[...document.querySelectorAll("#editor .fl-pick")]`;
    const barBtn = (name) => `[...document.querySelectorAll("#editor .fl-bar button")].find(x => x.textContent.trim() === ${JSON.stringify(name)})`;
    const findFor = (words) => b.ev(`(i => { i.value = ${JSON.stringify(words)}; i.dispatchEvent(new Event("input", { bubbles: true })); })(document.querySelector("#editor .fl-narrow input"))`);
    check("with a row per scanned game, none selected",
          await b.waitFor(`${pickRows}.length === ${scannedN} && document.querySelectorAll("#editor .fl-pick input:checked").length === 0`, 10000));
    check("the count says so, and the button is to look the selected games up",
          await b.ev(`[document.querySelector("#editor .fl-count").textContent, document.querySelector("#editor .fl-bar button.primary").textContent]`),
          ["0 of " + scannedN + " selected", "Look up the selected games"]);
    check("opening it looked nothing up", JSON.stringify((await api("api/fill.php?job=1")).job), jobWas);
    check("each game says which pictures it lacks",
          await b.ev(`${pickRows}.every(r => /^(no pictures yet|missing: )/.test(r.querySelector(".fl-match").textContent))`), true);
    const listed = (await api("api/fill.php?list=1")).games || [];
    const saturn = listed.filter((g) => g.platform === panzer.platform).length;
    await b.ev(`(s => { s.value = ${JSON.stringify(panzer.platform)}; s.dispatchEvent(new Event("change", { bubbles: true })); })(document.querySelector("#editor .fl-narrow select"))`);
    check("choosing a console narrows the list to its games", [await b.ev(`${pickRows}.length`), saturn > 0 && saturn < scannedN], [saturn, true]);
    await b.ev(`(s => { s.value = ""; s.dispatchEvent(new Event("change", { bubbles: true })); })(document.querySelector("#editor .fl-narrow select"))`);
    await findFor("panzer");
    check("the find box narrows it to a name", await b.ev(`${pickRows}.map(r => r.querySelector(".sc-title").textContent.trim())`), [panzer.title]);
    await b.ev(`${barBtn("Select all shown")}.click()`);
    await findFor("thieves");
    await b.ev(`${pickRows}.find(r => /Xsfix Thieves/.test(r.textContent)).querySelector("input").click()`);
    await findFor("");
    check("the selection is kept while the list is narrowed and widened again",
          [await b.ev(`${pickRows}.length`), await b.ev(`document.querySelectorAll("#editor .fl-pick input:checked").length`), await b.ev(`document.querySelector("#editor .fl-count").textContent`)],
          [scannedN, 2, "2 of " + scannedN + " selected"]);
    await b.ev(`document.querySelector("#editor .fl-bar button.primary").click()`);
    check("Look up the selected games looks those two up, and no others",
          await b.waitFor(`document.querySelectorAll("#editor .fl-row:not(.fl-pick)").length === 2 && !document.querySelector("#editor .fl-pick")`, 40000));
    const partLook = await api("api/fill.php?job=rows");
    check("the look was of the two, and says it was a part",
          [partLook.job.mode, partLook.job.state, partLook.job.scanned, partLook.part, partLook.rows.map((g) => g.title).sort()],
          ["look", "done", 2, true, [panzer.title, "Xsfix Thieves"].sort()]);
    await b.ev(`[...document.querySelectorAll("#editor .set-head button")].find(x => /Other games/.test(x.textContent)).click()`);
    check("Other games goes back to the first screen with the two still selected",
          await b.waitFor(`${pickRows}.length === ${scannedN} && document.querySelectorAll("#editor .fl-pick input:checked").length === 2`, 8000));
    await b.ev(`${barBtn("Deselect all")}.click()`);
    check("Deselect all leaves none", await b.ev(`document.querySelector("#editor .fl-count").textContent`), "0 of " + scannedN + " selected");
    await b.ev(`${barBtn("Select all shown")}.click()`);
    await b.ev(`document.querySelector("#editor .fl-bar button.primary").click()`);
    check("with every game selected, the list has a row for each", await b.waitFor(`document.querySelectorAll("#editor .fl-row:not(.fl-pick)").length === ${scannedN} && !document.querySelector("#editor .fl-pick")`, 40000));
    /* The button is over the list and stays on screen however far the list
       is scrolled: under the last of hundreds of rows it is missed. */
    const goBtn = `[...document.querySelectorAll("#editor button")].find(x => /^Get pictures for the selected games/.test(x.textContent.trim()))`;
    const inSight = `(r => r.top >= 0 && r.bottom <= innerHeight)(${goBtn}.getBoundingClientRect())`;
    check("the Fill button comes before the list", await b.ev(`!!(${goBtn}.compareDocumentPosition(document.querySelector("#editor .sc-rows")) & Node.DOCUMENT_POSITION_FOLLOWING)`), true);
    await b.ev(`(() => { const rows = document.querySelector("#editor .sc-rows"); const pad = document.createElement("div"); pad.id = "fl-test-pad"; pad.style.height = "4000px"; rows.appendChild(pad); document.getElementById("editor").scrollTop = 3000; })()`);
    check("and is still on screen with the list scrolled far down", [await b.until(`document.getElementById("editor").scrollTop > 2000`, true), await b.ev(inSight)], [true, true]);
    await b.ev(`(() => { document.getElementById("fl-test-pad").remove(); document.getElementById("editor").scrollTop = 0; })()`);
    check("the matched one is selected and named",
          await b.ev(`(r => !!r && r.querySelector("input").checked && /Panzer Dragoon Saga/.test(r.querySelector(".fl-match").textContent))([...document.querySelectorAll("#editor .fl-row")].find(r => /Panzer/.test(r.textContent)))`));
    check("an invented one is not selected, and says why",
          await b.ev(`(r => !!r && !r.querySelector("input").checked && /nothing in the database/.test(r.textContent))([...document.querySelectorAll("#editor .fl-row")].find(r => /Xsfix Thieves/.test(r.textContent)))`));
    /* Sorted by whose decision each game is: ready to fill, for you to
       check, nothing found, already filled. */
    const flGroups = await b.ev(`[...document.querySelectorAll("#editor .fl-group")].map(h => h.firstChild.textContent.split("  (")[0])`);
    check("the list is sorted by whose decision each game is", [flGroups.includes("Ready to fill"), flGroups.includes("Nothing found")], [true, true]);
    /* Select all and Deselect all, and the count beside them. A row with
       nothing found has no box. Select all is the games Xsegon is sure of:
       a guess is selected by a person, one at a time. */
    const flBtn = (name) => `[...document.querySelectorAll("#editor .fl-bar button")].find(x => x.textContent.trim() === ${JSON.stringify(name)})`;
    const flState = `({ on: document.querySelectorAll("#editor .fl-row input:checked").length, ready: document.querySelectorAll('#editor .fl-row[data-state="ready"] input:not(:disabled)').length, guessed: document.querySelectorAll('#editor .fl-row[data-state="check"] input:checked').length, rows: document.querySelectorAll("#editor .fl-row").length, says: document.querySelector("#editor .fl-count").textContent })`;
    await b.ev(`${flBtn("Deselect all")}.click()`);
    const flOff = await b.ev(flState);
    check("Deselect all leaves nothing selected, and the count says so", [flOff.on, flOff.says], [0, "0 of " + flOff.rows + " selected"]);
    await b.ev(`${flBtn("Select all")}.click()`);
    const flOn = await b.ev(flState);
    check("Select all takes every game Xsegon is sure of, and no guess", [flOn.on === flOn.ready, flOn.ready > 0 && flOn.ready < flOn.rows, flOn.guessed, flOn.says], [true, true, 0, flOn.ready + " of " + flOn.rows + " selected"]);
    const lookJob = (await api("api/fill.php?job=1")).job;
    check("Get Specific Pictures waits for its button: the games were looked up and nothing has been filled", [lookJob.mode, lookJob.state, lookJob.total], ["look", "done", 0]);

    /* The press: a job in the background, the screen gone, a bar in the
       corner. Run for real on the one matched game: the test server's
       pictures come from a stand-in file (tests\sandbox.js). */
    await b.ev(`${flBtn("Deselect all")}.click()`);
    await b.ev(`[...document.querySelectorAll("#editor .fl-row")].find(r => /Panzer/.test(r.textContent)).querySelector("input").click()`);
    await b.ev(`${goBtn}.click()`);
    check("Get pictures for the selected games starts the pass and closes the screen", await b.until(`document.getElementById("editor").hidden`, true, 8000), true);
    const fillEnd = async () => {
      for (const end = Date.now() + 60000; Date.now() < end;) {
        const j = (await api("api/fill.php?job=1")).job;
        if (j && j.state !== "running") { return j; }
        await sleep(300);
      }
      return (await api("api/fill.php?job=1")).job;
    };
    const ran = await fillEnd();
    check("the pass runs to its end in the background: the game, its details, its pictures",
          [ran.state, ran.mode, ran.total, ran.done, ran.failed, ran.pictures >= 1, ran.firstDone], ["done", "picked", 1, 1, 0, true, true]);
    // the bar stands in the fixed corner box both bars share
    check("a bar in the corner says so, off the list and out of its way",
          await b.until(`(n => !!n && /^Get Pictures: /.test(n.textContent) && n.closest("#corner-bars") && getComputedStyle(document.getElementById("corner-bars")).position === "fixed")(document.querySelector(".fill-bar .fb-line") && document.querySelector(".fill-bar"))`, true, 8000), true);
    check("and the strip says how it ended, once", await b.until(`/Get Pictures finished: 1 game, /.test(document.getElementById("strip").textContent)`, true, 8000), true);
    /* Out of the way while Settings is open (it would sit on the footer's
       words), back when it closes. Shown by hand, so the check does not
       hang on how long the pass took. */
    // getClientRects sees an ancestor's display:none too: the hiding is on
    // the shared corner box
    const barShown = `(n => !!n && n.getClientRects().length > 0)(document.querySelector(".fill-bar"))`;
    await b.ev(`document.querySelector(".fill-bar").hidden = false`);
    await b.clickSel("#btn-settings");
    await b.waitFor(`!document.getElementById("settings").hidden`, 5000);
    check("the bar steps aside while Settings is open", await b.ev(barShown), false);
    await b.key("Escape");
    await b.waitFor(`document.getElementById("settings").hidden`, 5000);
    check("and is back the moment it closes", await b.ev(barShown), true);
    await b.ev(`document.querySelector(".fill-bar").hidden = true`);
    check("the game has its box now, stored as a picture of its own", fs.readdirSync(path.join(DATA, "art")).some((n) => n.startsWith(panzer.id + "-box.")), true);
    const fillLog = ((await api("api/log.php?tail=200")).lines || []).filter((l) => / S FILL /.test(l)).join("\n");
    check("the day log has the pass: started, what was filled, finished",
          [/started in the background: 1 selected games/.test(fillLog), /filling 1 games/.test(fillLog), /finished: 1 games/.test(fillLog)], [true, true, true]);
    await sleep(800);
    await b.settled();

    /* A picture that did not come is asked for once more when the rest is in,
       and named in the ending if it still does not come. The rule itself on a
       stand-in fetch (tests\fill-probe.php); then a real pass with the
       picture server's stand-in taken away, so one picture fails both times. */
    const phpExe = ((await api("api/status.php")).build || {}).phpExe;
    const probe = JSON.parse(require("child_process").execFileSync(phpExe, [path.join(__dirname, "fill-probe.php")], { encoding: "utf8", windowsHide: true }));
    check("each picture that did not come is asked for once more, once", probe.calls, ["Came The Second Time:box", "Never Came:logo", "Chosen Meanwhile:box", "Gone:shot"]);
    check("one that came is counted in, one chosen or gone meanwhile is wanted no more, one that failed again is named",
          [probe.all.came, probe.all.dropped, probe.all.missing, probe.all.stopped], [1, 2, [{ title: "Never Came", kind: "logo" }], false]);
    check("Stop ends the asking where it is", [probe.halted.stopped, probe.halted.came + probe.halted.missing.length], [true, 2]);
    check("a failed fetch is asked for again, a name the source has wrong is not, and nothing that did not fail", probe.wanted, [true, true, false, false, false, false]);

    /* Sure, and the same name, fill by themselves; a name that only starts the same waits;
       a game named only after its console gets no guess ("gb" found Bonk's Adventure
       through its Japanese name, GB Genjin). Rows made by hand. */
    const row = (id, title, platform, confidence, extra, sameName) => Object.assign({ id: id, title: title, platform: platform, dbId: 0, art: { box: false }, was: title,
      match: Object.assign({ best: confidence === "none" ? null : { id: 9000 + id.length, title: "Some Game", platform: platform }, confidence: confidence, candidates: [] },
        sameName === undefined ? {} : { sameName: sameName }) }, extra || {});
    const sortRows = (rows) => JSON.parse(require("child_process").execFileSync(phpExe, [path.join(__dirname, "fill-probe.php"), "sort", JSON.stringify(rows)],
      { encoding: "utf8", windowsHide: true, env: Object.assign({}, process.env, { XSEGON_DATA: DATA }) })).rows;
    const sortedBy = sortRows([
      row("c1", "gb", "Nintendo Game Boy", "maybe"), row("c2", "NES", "Nintendo Entertainment System", "likely"),
      row("c3", "sega 32x", "Sega 32X", "sure"), row("c4", "Super Nintendo", "Super Nintendo Entertainment System", "sure"),
      row("c5", "Contra", "Nintendo Entertainment System", "sure"), row("c66", "Star Ocean", "Super Nintendo Entertainment System", "likely", null, false),
      row("c777", "gb", "Nintendo Game Boy", "linked", { dbId: 18322 }), row("c8888", "Tetris", "Nintendo Entertainment System", "likely", null, true),
    ]);
    check("a console's name alone gets no guess, however sure; sure and the same name fill by themselves, a name that only starts the same waits; a choice made stays",
          sortedBy.map((r) => r.state + (r.why ? ":" + r.why : "") + (r.match.best ? "" : ":nobest")),
          ["none:console:nobest", "none:console:nobest", "none:console:nobest", "none:console:nobest", "ready", "check:guess", "ready", "ready"]);
    const consoleLog = fs.readdirSync(path.join(DATA, "log")).map((n) => fs.readFileSync(path.join(DATA, "log", n), "utf8")).join("\n");
    check("and the log names them", /FILL no guess for 4 games named only after a console: gb, NES, sega 32x, Super Nintendo/.test(consoleLog), true);
    const artDir = path.join(DATA, "art"), standIn = path.join(DATA, "fixtures", "gamesdb-picture.png");
    const pzRow = ((await api("api/fill.php?job=rows")).rows || []).find((g) => g.id === panzer.id) || {};
    const pzPick = { id: panzer.id, dbId: String(pzRow.dbId || ((pzRow.match || {}).best || {}).id || "") };
    const logos = fs.readdirSync(artDir).filter((n) => n.startsWith(panzer.id + "-logo."));
    if (pzPick.dbId && logos.length && fs.existsSync(standIn)) {
      logos.forEach((n) => fs.rmSync(path.join(artDir, n)));
      fs.renameSync(standIn, standIn + ".aside");
      let twice;
      try {
        await api("api/fill.php", { job: "start", mode: "picked", picks: [pzPick], pictures: true });
        twice = await fillEnd();
      } finally {
        fs.renameSync(standIn + ".aside", standIn);
      }
      check("a picture that fails both times leaves the pass done, counted and named",
            [twice.state, twice.pictures, twice.picsFailed, twice.againAll, twice.againAt, (twice.picsMissing || []).map((p) => p.kind + (/Panzer/.test(p.title) ? "" : " of another game"))], ["done", 0, 1, 1, 1, ["logo"]]);
      check("the ending names it and says how it is asked for again",
            await b.until(`/1 picture could not be fetched \\(the logo of .+\\): to ask for it again, select the game under Already filled in Pictures & Videos > Get Specific Pictures\\./.test(document.getElementById("strip").textContent)`, true, 8000), true);
      const againLog = ((await api("api/log.php?tail=200")).lines || []).filter((l) => / S FILL /.test(l)).join("\n");
      check("the day log has the second ask and what came of it",
            [/1 pictures did not come: each is asked for once more, one at a time/.test(againLog), /: logo asked for once more: failed: /.test(againLog)], [true, true]);
      await api("api/fill.php", { job: "start", mode: "picked", picks: [pzPick], pictures: true });
      const next = await fillEnd();
      check("and the next run brings it, with nothing asked twice", [next.state, next.pictures, next.picsFailed, next.againAll, fs.readdirSync(artDir).some((n) => n.startsWith(panzer.id + "-logo."))], ["done", 1, 0, 0, true]);
      await sleep(800);
      await b.settled();
    } else {
      console.log("    (the filled game has no logo or no match to pick here; the fails-both-times pass steps aside)");
    }

    /* Fill in all, the other half of the same row: no screen at all, the
       same job. The one sure game is filled, so this pass finds nothing it
       is sure of and says what is left for a person. */
    // The arcade games are real titles, two sure matches that would be fetched from the internet:
    // they leave the library before the pass that is to find nothing it is sure of.
    for (const g of picks.filter((p) => p.platform === "Arcade")) { await api("api/scan.php", { action: "remove", id: g.id }); }
    await b.openBar("media");
    await b.menuItem(/^Get Pictures$/);
    const allRan = await fillEnd();
    check("Get Pictures opens no screen: it looks every game up and fills the ones it is sure of, in the background",
          [await b.ev(`document.getElementById("editor").hidden`), allRan.mode, allRan.state, allRan.total, allRan.left > 0], [true, "all", "done", 0, true]);
    /* What is left, in two kinds: the games with a likely match, which one
       message in the mailbox names with a button to them, and the games
       nothing was found for, which get a count and no message. */
    check("what is left is counted in its two kinds", [allRan.check + allRan.none, allRan.check >= 0 && allRan.none >= 0], [allRan.left, true]);
    // Messages is named only while its message is there (told); the place is named for the rest.
    const place = "Pictures & Videos > Get Specific Pictures";
    const leftSays = (allRan.check ? " " + allRan.check + (allRan.check === 1 ? " game has" : " games have") + " a likely match left for you to check: " + (allRan.told ? "Messages has " : place + " has ") + (allRan.check === 1 ? "it." : "them.") : "") +
                     (allRan.none ? " " + allRan.none + (allRan.none === 1 ? " game was" : " games were") + " not found by name: " + place + " lets you search for " + (allRan.none === 1 ? "it." : "them.") : "");
    check("and it says what is left for a person to check", await b.until(`document.getElementById("strip").textContent.indexOf(${JSON.stringify(leftSays)}) >= 0`, true, 8000), true);
    const checkMsg = async () => ((await api("api/news.php")).messages || []).filter((m) => m.key === "fill:check");
    if (allRan.check > 0) {
      const told = await checkMsg();
      check("one message names the games with a likely match, with the way to them",
            [told.length, (told[0] || {}).n, ((told[0] || {}).ids || []).length, (told[0] || {}).opens, /likely match waiting for your yes$/.test((told[0] || {}).title || "")], [1, allRan.check, allRan.check, ["fillcheck"], true]);
      // Its button opens Get Specific Pictures on those games, looked up at once.
      await b.ev(`import("/js/news.js").then((m) => m.openMail())`);
      const goBtnSel = `[...document.querySelectorAll("#mailbox .mail-show")].find(x => x.textContent === "Check these games...")`;
      check("the message has a button to them", await b.until(`!!${goBtnSel}`, true, 5000), true);
      await b.ev(`${goBtnSel}.click()`);
      check("pressed, the mailbox goes and Get Specific Pictures opens on those games alone, looked up",
            await b.until(`(() => { const rows = [...document.querySelectorAll("#editor .fl-row[data-state]")]; return rows.length + "|" + rows.some(r => r.dataset.state === "check") + "|" + document.getElementById("mailbox").hidden; })()`,
              allRan.check + "|true|true", 30000), allRan.check + "|true|true");
      await b.key("Escape");
      await b.until(`document.getElementById("editor").hidden`, true, 4000);
      // Deleted, and the same games left by the next pass: not said a second time.
      await api("api/news.php", { action: "delete", id: told[0].id });
      await b.openBar("media");
      await b.menuItem(/^Get Pictures$/);
      const allAgain = await fillEnd();
      check("the same games left by the next pass are not said a second time", [allAgain.state, allAgain.check, (await checkMsg()).length], ["done", allRan.check, 0]);
      await sleep(800);
      await b.settled();
    } else {
      /* This pass left no game with a likely match, so there is no message.
         The message itself is then made by the function the pass calls
         (tests\fill-probe.php tell), for two of the games it did look up. */
      check("with no likely match left there is no message", (await checkMsg()).length, 0);
      const two = ((await api("api/fill.php?job=rows")).rows || []).filter((g) => g.id !== panzer.id).slice(0, 2).map((g) => ({ id: g.id, title: g.title, platform: g.platform }));
      const tell = (rows) => JSON.parse(require("child_process").execFileSync(phpExe, [path.join(__dirname, "fill-probe.php"), "tell", JSON.stringify(rows)],
        { encoding: "utf8", windowsHide: true, env: Object.assign({}, process.env, { XSEGON_DATA: DATA }) })).wrote;
      if (two.length === 2) {
        check("games with a likely match get one message", tell(two), true);
        const told = await checkMsg();
        check("naming them, unread, with the way to them",
              [told.length, (told[0] || {}).n, ((told[0] || {}).ids || []).slice().sort(), (told[0] || {}).items, (told[0] || {}).opens, (told[0] || {}).read, (told[0] || {}).title],
              [1, 2, two.map((g) => String(g.id)).sort(), two.slice().sort((x, y) => (String(x.id) < String(y.id) ? -1 : 1)).map((g) => g.title + " (" + g.platform + ")"), ["fillcheck"], false, "2 games have a likely match waiting for your yes"]);
        check("the same games are not said a second time", [tell(two), (await checkMsg()).length], [false, 1]);
        // Its button opens Get Specific Pictures on those games, looked up at once.
        await b.ev(`import("/js/news.js").then((m) => m.openMail())`);
        const goBtnSel = `[...document.querySelectorAll("#mailbox .mail-show")].find(x => x.textContent === "Check these games...")`;
        check("the message has a button to them", await b.until(`!!${goBtnSel}`, true, 5000), true);
        await b.ev(`${goBtnSel}.click()`);
        check("pressed, the mailbox goes and Get Specific Pictures opens on those games alone, looked up",
              await b.until(`document.querySelectorAll("#editor .fl-row[data-state]").length + "|" + document.getElementById("mailbox").hidden`, "2|true", 30000), "2|true");
        await b.key("Escape");
        await b.until(`document.getElementById("editor").hidden`, true, 4000);
        await api("api/news.php", { action: "delete", id: told[0].id });
        check("nor after the message was deleted", [tell(two), (await checkMsg()).length], [false, 0]);
        check("a changed list is said, in the old one's place", [tell(two.slice(0, 1)), (await checkMsg()).map((m) => m.title)], [true, ["1 game has a likely match waiting for your yes"]]);
        check("and with none left the message goes", [tell([]), (await checkMsg()).length], [false, 0]);
        // The look above is a job of its own: the pass's rows are put back for the checks below.
        await b.openBar("media");
        await b.menuItem(/^Get Pictures$/);
        await fillEnd();
        await sleep(800);
        await b.settled();
      } else {
        console.log("    (fewer than two games were looked up besides the filled one; the message's own checks step aside)");
      }
    }
    const looked = (await api("api/fill.php?job=rows")).rows;
    check("a game filled before, with its box, is not offered again", (looked.find((g) => g.id === panzer.id) || {}).state, "done");
    await b.openBar("media");
    await b.menuItem(/^Get Specific Pictures/);
    // It has its pictures now, so it is under All games, not Missing a picture.
    await b.waitFor(`document.querySelectorAll("#editor .fl-pick").length > 0`, 10000);
    check("a game with its pictures is left off the first screen until All games is chosen",
          await b.ev(`[...document.querySelectorAll("#editor .fl-pick")].some(r => /Panzer/.test(r.textContent))`), false);
    await b.ev(`document.querySelector('#editor .fl-chip[data-show="all"]').click()`);
    check("and All games lists it", await b.ev(`[...document.querySelectorAll("#editor .fl-pick")].some(r => /Panzer/.test(r.textContent))`), true);
    await b.ev(`${barBtn("Select all shown")}.click()`);
    await b.ev(`document.querySelector("#editor .fl-bar button.primary").click()`);
    check("on the screen it is folded away under Already filled",
          await b.until(`(h => !!h && h.nextElementSibling.nextElementSibling.classList.contains("folded"))([...document.querySelectorAll("#editor .fl-group")].find(h => /^Already filled/.test(h.textContent)))`, true, 30000), true);
    await b.key("Escape");
    await sleep(600);
    for (const n of fs.readdirSync(path.join(DATA, "art"))) { if (n.startsWith(panzer.id + "-")) { fs.rmSync(path.join(DATA, "art", n)); } }
    await sleep(400);
    await b.settled();

    /* A game hidden or deleted while the pass runs is not part of it: not
       filled, not failed, not in the count. The pass is the filled game
       eight times over, then two more; those two are taken out once the
       worker is past its one read of the library, before their turn. */
    const outGames = looked.filter((g) => g.id !== panzer.id).slice(0, 2);
    const outDb = (looked.find((g) => g.id === panzer.id) || {}).dbId;
    check("the fixture has two more scanned games to take out mid-run, and the filled one's match", [outGames.length, !!outDb], [2, true]);
    if (outGames.length === 2 && outDb) {
      const hidFile = path.join(DATA, "hidden.json"), delFile = path.join(DATA, "deleted.json"), jobFile = path.join(DATA, "fill-job.json");
      const keepOf = (f) => (fs.existsSync(f) ? fs.readFileSync(f) : null);
      const putBack = (f, kept) => { if (kept === null) { fs.rmSync(f, { force: true }); } else { fs.writeFileSync(f, kept); } };
      const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8").trim()); } catch (e) { return d; } };
      const hidKeep = keepOf(hidFile), delKeep = keepOf(delFile);
      const [hideMe, deleteMe] = outGames;
      const outPicks = Array(8).fill({ id: panzer.id, dbId: outDb }).concat(outGames.map((g) => ({ id: g.id, dbId: outDb })));
      const outStart = await api("api/fill.php", { job: "start", mode: "picked", pictures: false, picks: outPicks });
      // Watched on the disk, not through the server the worker is busy asking.
      let inFirst = false;
      for (const end = Date.now() + 30000; Date.now() < end && !inFirst;) {
        inFirst = readJson(jobFile, {}).phase === "first";
        if (!inFirst) { await sleep(20); }
      }
      const outAt = readJson(jobFile, {}).done;
      fs.writeFileSync(hidFile, JSON.stringify(Object.assign({}, readJson(hidFile, {}), { [hideMe.id]: hideMe.title })));
      fs.writeFileSync(delFile, JSON.stringify(readJson(delFile, []).concat([{ id: deleteMe.id, title: deleteMe.title, platform: deleteMe.platform, rom: "", at: new Date().toISOString() }])));
      const outRan = await fillEnd();
      const outJob = readJson(jobFile, {});
      putBack(hidFile, hidKeep);
      putBack(delFile, delKeep);
      check("the two were taken out while the pass was at work, before their turn", [outStart.ok, inFirst, outAt < 8], [true, true, true]);
      check("a game hidden and a game deleted while Get Pictures runs are not in its count: eight of the ten, none failed",
            [outRan.state, outRan.total, outRan.done, outRan.failed, outJob.gone], ["done", 8, 8, 0, 2]);
      const outLog = ((await api("api/log.php?tail=200")).lines || []).filter((l) => / S FILL /.test(l)).join("\n");
      check("the day log names both as left out, and the ending counts eight",
            [outLog.includes(hideMe.title + ": hidden or taken out of the library while this ran"), outLog.includes(deleteMe.title + ": hidden or taken out of the library while this ran"), /finished: 8 games/.test(outLog)], [true, true, true]);
      check("and the strip says eight games, with nothing that could not be filled",
            await b.until(`(t => /Get Pictures finished: 8 games, /.test(t) && !/could not be filled/.test(t))(document.getElementById("strip").textContent)`, true, 8000), true);
      check("both are back in the library afterwards, untouched", (await api("api/fill.php?scope=scanned")).games.filter((g) => g.id === hideMe.id || g.id === deleteMe.id).map((g) => g.title).sort(), [hideMe.title, deleteMe.title].sort());
      await sleep(800);
      await b.settled();
    }

    /* ---- and editing one on the real screen -------------------------------
       The words are most of this: a reset to LaunchBox's value for a game
       LaunchBox never had offers something that does not exist. */
    // The grid is still filtered to a console: the filter comes off first,
    // since the point here is the dialog, not finding the tile.
    await b.ev(`(n => { if (n) { n.__old = true; } })(document.querySelector("#view > *"))`);
    await b.ev(`(() => { const p = document.getElementById("platform"); p.value = ""; p.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await b.waitFor(`(n => !!n && !n.__old)(document.querySelector("#view > *"))`, 10000);
    await b.settled();
    await b.ev(`(() => { const q = document.getElementById("q"); q.value = "Xsfix Dragoon"; q.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    check("the search finds the scanned game",
          await b.waitFor(`/Xsfix Dragoon/.test((document.querySelector("#view .tile.sel") || {}).textContent || "")`, 8000));
    await b.contextMenu("#view .tile.sel");
    check("its menu offers Edit Metadata, not Edit Game",
          await b.ev(`[...document.querySelectorAll(".ctx-item .ctx-label")].some(n => /Edit Metadata/.test(n.textContent))`));
    await b.menuDeep(/Edit Metadata/);
    check("which opens", await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "EDIT METADATA"`, 10000));
    const help = await b.ev(`(document.querySelector("#editor .group-help") || {}).textContent || ""`);
    check("the dialog says where the title came from", /file name/.test(help));
    check("and does not claim LaunchBox is behind it", /LaunchBox/.test(help), false);

    await b.ev(`(() => { const i = document.querySelector("#editor .ed-row input");
      i.value = "Xsfix Dragoon Saga III"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await b.ev(`[...document.querySelectorAll("#editor .set-foot button")].find(x => x.textContent === "Save").click()`);
    check("Save saves, rather than sending you to a form that does not exist",
          await b.waitFor(`document.getElementById("editor").hidden`, 8000));
    check("the strip names the scan as what the game now differs from",
          await b.ev(`document.getElementById("strip").textContent`).then((t) => /the scan/.test(t) && !/LaunchBox/.test(t)));
    check("and the new name is on the game",
          await b.waitFor(`/Xsfix Dragoon Saga III/.test(document.getElementById("view").textContent)`, 8000));

    // Reopened, the edited field offers its way back, in the scan's name.
    await b.contextMenu("#view .tile.sel");
    await b.menuDeep(/Edit Metadata/);
    await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "EDIT METADATA"`, 10000);
    check("an edited field shows what the scan found, with a way back",
          await b.ev(`(() => { const w = document.querySelector("#editor .ed-was");
            return w ? w.textContent : ""; })()`).then((t) => /^the scan: Xsfix Dragoon Saga/.test(t)));
    check("and Reset all is offered in the scan's name too",
          await b.ev(`[...document.querySelectorAll("#editor .set-foot button")].map(x => x.textContent).join("|")`)
            .then((t) => /Reset all to what the scan found/.test(t)));
    await b.key("Escape");
    await sleep(400);
    await api("api/edit.php", { id: sat.id, reset: "all" });
    await b.ev(`(() => { const q = document.getElementById("q"); q.value = ""; q.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(600);

    /* ---- the empty answer, honestly ---------------------------------------
       "Nothing new" over zero games is a false claim. Seen-but-skipped and
       nothing-at-all each get their own sentence; the claim needs a game seen. */
    const VACANT = FIX + "-vacant";
    fs.rmSync(VACANT, { recursive: true, force: true });
    fs.mkdirSync(path.join(VACANT, "weird"), { recursive: true });
    fs.writeFileSync(path.join(VACANT, "weird", "file.bin"), "x");
    // Skipped on purpose, so there is a reason on the screen to point at.
    fs.mkdirSync(path.join(VACANT, "bios"), { recursive: true });
    const BLANK = FIX + "-blank";
    fs.rmSync(BLANK, { recursive: true, force: true });
    fs.mkdirSync(BLANK, { recursive: true });
    try {
      await api("api/settings.php", { paths: { romRoot: VACANT } });
      await b.openBar("games");
      await b.menuItem(/Scan for Games/);
      check("skipped-everything says so instead of \"nothing new\"",
            await b.waitFor(`/No games were offered/.test(document.getElementById("editor").textContent)`, 10000));
      check("and does not claim the library has it all",
            await b.ev(`/Nothing new/.test(document.getElementById("editor").textContent)`), false);
      check("the folder skipped on purpose is listed, the one with no games in it is not: its file is named under Left out as not games",
            [await b.ev(`/not a console folder/.test(document.getElementById("editor").textContent)`), ...await b.ev(namedWhere("weird", "file.bin"))], [true, false, true]);
      await b.key("Escape");
      await sleep(600);
      await api("api/settings.php", { paths: { romRoot: BLANK } });
      await b.openBar("games");
      await b.menuItem(/Scan for Games/);
      check("nothing-at-all names the layout that works",
            await b.waitFor(`/No games were found/.test(document.getElementById("editor").textContent)`, 10000));
      await b.key("Escape");
      await sleep(600);
    } finally {
      await api("api/settings.php", { paths: { romRoot: FIX } });
      fs.rmSync(VACANT, { recursive: true, force: true });
      fs.rmSync(BLANK, { recursive: true, force: true });
    }

    /* ---- new games by themselves (includes\newgames.php, js\newgames.js) ----
       A games folder of its own: a game Xsegon is sure of, one whose name says
       hack, a disc set waiting for its playlist, an archive and one still being
       copied. The test copy has the look switched off (tests\sandbox.js). */
    const NEWFIX = FIX + "-new";
    const ngJob = path.join(DATA, "newgames-job.json");
    const ngTold = path.join(DATA, "newgames-told.json");
    const msgPath = path.join(DATA, "messages.json");
    const runPath = path.join(DATA, "running.json");
    const keepNg = {};
    for (const f of [ngJob, ngTold, msgPath]) { keepNg[f] = fs.existsSync(f) ? fs.readFileSync(f) : null; }
    const hourAgo = Date.now() / 1000 - 3600;
    const putOld = (rel) => { const p = path.join(NEWFIX, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, "x"); fs.utimesSync(p, hourAgo, hourAgo); return p; };
    // The least time between two looks is the server's: each look here starts from none.
    const look = async (why) => {
      fs.rmSync(ngJob, { force: true });
      const r = await api("api/newgames.php", { start: why || "test" });
      if (!r.started) { return r; }
      for (const end = Date.now() + 20000; Date.now() < end;) {
        const j = (await api("api/newgames.php")).job;
        if (j && j.state !== "running") { return j; }
        await sleep(200);
      }
      return { state: "still running after 20 s" };
    };
    const allMsgs = () => JSON.parse(fs.readFileSync(msgPath, "utf8").replace(/^﻿/, "") || "[]");
    const firstMsg = () => (allMsgs()[0] || {});
    fs.rmSync(NEWFIX, { recursive: true, force: true });
    try {
      putOld("systems/saturn/Xsnew Plain (USA).chd");
      putOld("systems/saturn/Xsnew Racer (Hack).chd");
      putOld("systems/psx/Xsnew Duo (USA) (Disc 1).cue");
      putOld("systems/psx/Xsnew Duo (USA) (Disc 1).bin");
      putOld("systems/psx/Xsnew Duo (USA) (Disc 2).cue");
      putOld("systems/psx/Xsnew Duo (USA) (Disc 2).bin");
      putOld("systems/psx/Xsnew Packed (USA).7z");
      const arriving = path.join(NEWFIX, "systems", "saturn", "Xsnew Arriving (USA).chd");
      fs.writeFileSync(arriving, "x");                       // written now: still being copied
      await api("api/settings.php", { paths: { romRoot: NEWFIX } });

      fs.rmSync(ngJob, { force: true });
      const off = await api("api/newgames.php", { start: "test" });
      check("switched off, no look is started, and that is no fault", [off.ok, off.started, off.no], [true, false, "switched off in Settings > Library"]);
      await api("api/settings.php", { library: { addNewGames: true } });

      const j1 = await look();
      check("on, the look adds only the game it is sure of", [j1.state, j1.added, j1.titles], ["done", 1, ["Xsnew Plain"]]);
      check("and leaves the hack and the disc set waiting for its playlist, and the file still arriving for later",
            [j1.left, j1.fresh], [2, 1]);
      const inList = JSON.parse(fs.readFileSync(scanPath, "utf8")).map((g) => g.title).filter((t) => /^Xsnew/.test(t)).sort();
      check("the library has that one and none of the others", inList, ["Xsnew Plain"]);
      const m1 = firstMsg();
      check("the mailbox names what it was not sure of, once, with Scan for Games to see to them",
            [m1.title, m1.opens, (m1.items || []).slice().sort(), j1.told],
            ["3 files Xsegon was not sure of", ["scan"], ["Xsnew Duo (USA) (Disc 1).cue: a disc set waiting for its playlist",
              "Xsnew Packed (USA).7z: an archive to unpack", "Xsnew Racer (Hack).chd: its name says it may be a hack"], 3]);
      // Nobody pressed anything for the one it added: that is news, with the way to Recently added.
      const a1 = allMsgs()[1] || {};
      check("and a message names the game it added, opening Recently added",
            [a1.title, a1.show, (a1.items || []).map((l) => l.split("  (")[0])], ["A new game was added", "@added", ["Xsnew Plain"]]);

      const soon = await api("api/newgames.php", { start: "test" });
      check("asked again at once, the server says no: once in thirty seconds at the most", [soon.started, /seconds ago$/.test(soon.no || "")], [false, true]);

      fs.writeFileSync(runPath, JSON.stringify({ title: "Xsnew Test", pending: true, startedAt: new Date().toISOString() }));
      fs.rmSync(ngJob, { force: true });
      const playing = await api("api/newgames.php", { start: "test" });
      fs.rmSync(runPath, { force: true });
      check("never while a game is running", [playing.started, playing.no], [false, "a game is running"]);

      fs.utimesSync(arriving, hourAgo, hourAgo);
      const idsBefore = new Set(allMsgs().map((m) => m.id));
      const j2 = await look("again");
      check("the file that was still arriving comes in on the next look", [j2.added, j2.titles, j2.fresh], [1, ["Xsnew Arriving"], 0]);
      // By id, not by count: the mailbox keeps so many, and a full one drops its oldest.
      check("and what was named once is not named again: the one new message is the game that came",
            [j2.told, allMsgs().filter((m) => !idsBefore.has(m.id)).map((m) => m.title)], [0, ["A new game was added"]]);

      for (let i = 0; i < 101; i++) { putOld("systems/saturn/Xsnew Many " + i + " (USA).chd"); }
      const j3 = await look();
      check("more than a hundred new games at once: none added, left for Scan for Games and named in the mailbox",
            [j3.added, j3.many, firstMsg().title], [0, 101, "101 new games to look over"]);
      const msgCount = () => JSON.parse(fs.readFileSync(msgPath, "utf8").replace(/^﻿/, "") || "[]").length;
      const msgsMany = msgCount();
      const j3b = await look("again");
      check("the same hundred and one at the next look: said neither in Messages nor on the strip again (roadmap AR25)",
            [j3b.added, j3b.many, msgCount()], [0, 0, msgsMany]);
      for (let i = 0; i < 101; i++) { fs.rmSync(path.join(NEWFIX, "systems", "saturn", "Xsnew Many " + i + " (USA).chd"), { force: true }); }

      /* The page: a look once it is up, and one when the window comes back
         after a while away. The waits are cut short for the test (XSEGON.newGamesMs). */
      putOld("systems/saturn/Xsnew Start (USA).chd");
      fs.rmSync(ngJob, { force: true });
      await b.goto();
      check("the page looks once it is up, and the strip names what came",
            await b.waitFor(`/1 new game added: Xsnew Start/.test(document.getElementById("strip").textContent)`, 20000));
      check("and the new game is in the list of scanned games",
            JSON.parse(fs.readFileSync(scanPath, "utf8")).some((g) => g.title === "Xsnew Start"), true);
      putOld("systems/saturn/Xsnew Back (USA).chd");
      fs.rmSync(ngJob, { force: true });
      await b.ev(`window.XSEGON.newGamesMs = 300; window.dispatchEvent(new Event("blur"))`);
      await sleep(500);
      await b.ev(`window.dispatchEvent(new Event("focus"))`);
      check("away a while and back, it looks again",
            await b.waitFor(`/1 new game added: Xsnew Back/.test(document.getElementById("strip").textContent)`, 15000));
      await b.ev(`window.XSEGON.newGamesMs = 0`);
    } finally {
      await api("api/settings.php", { library: { addNewGames: false }, paths: { romRoot: FIX } });
      fs.rmSync(runPath, { force: true });
      for (const [f, was] of Object.entries(keepNg)) { if (was === null) { fs.rmSync(f, { force: true }); } else { fs.writeFileSync(f, was); } }
      fs.rmSync(NEWFIX, { recursive: true, force: true });
    }
  } finally {
    await api("api/settings.php", { paths: { romRoot: before } });
    /* Put back what the run's copy held, not an empty slate: real games live
       in this file, and later groups (runcheck, screens) read the same copy. */
    if (scanWas === null) { fs.rmSync(scanPath, { force: true }); } else { fs.writeFileSync(scanPath, scanWas); }
    fs.rmSync(FIX, { recursive: true, force: true });
  }
};
