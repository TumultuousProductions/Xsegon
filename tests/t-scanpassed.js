/*  Scan for Games says what it passed over (includes\scan.php 'passed' and
    'junkFiles', js\scanpassed.js): a file taken for a game that is in the
    library under another file is named and can be added as another version,
    and a cartridge kept as a .bin is a game when the file says it is one.

    Against a games folder made here; paths.romRoot is pointed at it and put
    back. No real game file is read. */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { api, DATA, Guard, sleep } = require("./lib");

const FIX = path.join(os.tmpdir(), "xs-scanpassed-fixture");
const put = (rel, body) => {
  const p = path.join(FIX, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body || "x");
  return p;
};
// A Genesis cartridge: it signs itself 256 bytes in.
function genesisRom() {
  const b = Buffer.alloc(0x400, 0xff);
  b.write("SEGA GENESIS    ", 0x100, "latin1");
  return b;
}

module.exports = async function (b, check) {
  if (!fs.existsSync(path.join(DATA, "fixtures"))) {
    check("scanpassed: runs only on the test server's own copy", true, true);
    return;
  }
  const kept = new Guard(["scanned-games.json", "messages.json", "library-seen.json"]);
  const before = (await api("api/settings.php")).settings.paths;
  fs.rmSync(FIX, { recursive: true, force: true });
  const usa = put("systems/n64/Xsp Fighter (USA).z64");
  const japan = put("systems/n64/Xsp Fighter (Japan).z64");
  const cart = put("systems/genesis/Xsp Lost World.bin", genesisRom());
  const notCart = put("systems/genesis/Xsp bios.bin", Buffer.alloc(0x400, 0x11));
  const save = put("systems/genesis/Xsp Lost World.srm", "a save");
  const scanned = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, "scanned-games.json"), "utf8")); } catch (e) { return []; } };
  const names = (list) => (list || []).map((x) => path.basename(typeof x === "string" ? x : x.rom)).sort();

  try {
    await api("api/settings.php", { paths: { romRoot: FIX, scanFolders: [] } });
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), "[]");

    /* ---- a cartridge kept as a .bin --------------------------------------- */
    let r = await api("api/scan.php");
    check("a .bin in a cartridge console's folder is a game when the file says it is one, and no game when it does not",
      [r.new.filter((g) => g.platform === "Sega Genesis").map((g) => g.title), names(r.junkFiles)],
      [["Xsp Lost World"], ["Xsp Lost World.srm", "Xsp bios.bin"]]);
    check("what is counted as no game is named, not only counted", [r.junk, r.junkFiles.length], [2, 2]);
    check("two versions of one game not yet in the library are both offered",
      r.new.filter((g) => g.platform === "Nintendo 64").map((g) => path.basename(g.rom)).sort(), ["Xsp Fighter (Japan).z64", "Xsp Fighter (USA).z64"]);

    /* ---- a file taken for a game that is here ------------------------------ */
    const one = r.new.find((g) => g.rom === usa);
    r = await api("api/scan.php", { action: "accept", games: [one] });
    check("one version is taken in", [r.ok, r.added], [true, 1]);
    r = await api("api/scan.php");
    check("the other version is then no longer offered, and it is said why: taken for the game that is here, with that game's file",
      [names(r.new).includes("Xsp Fighter (Japan).z64"), r.passed.map((p) => [path.basename(p.rom), p.why, path.basename(p.has), p.title, p.platform])],
      [false, [["Xsp Fighter (Japan).z64", "have", "Xsp Fighter (USA).z64", "Xsp Fighter", "Nintendo 64"]]]);
    check("it is counted as known, as before", r.alreadyHave, 2);

    /* ---- on the window ------------------------------------------------------ */
    await b.goto();
    await b.enterConsole();
    await b.setView("grid");
    await b.openBar("games");
    await b.menuItem(/Scan for Games/);
    const title = `(document.querySelector("#editor .panel-title") || {}).textContent`;
    await b.waitFor(`${title} === "SCAN FOR GAMES"`, 10000);
    const row = `document.querySelector("#editor .ps-row")`;
    check("Scan for Games lists it under Other files of games you already have, with the library's file and a button",
      [await b.until(`document.querySelectorAll("#editor .ps-row").length`, 1, 10000),
       await b.ev(`[...document.querySelectorAll("#editor h2.bk-head")].some(h => h.textContent === "Other files of games you already have")`),
       await b.ev(`${row}.querySelector(".up-file").textContent`), await b.ev(`${row}.querySelector(".up-says").textContent`), await b.ev(`${row}.querySelector(".up-go").textContent`)],
      [1, true, "n64\\Xsp Fighter (Japan).z64", "The library has n64\\Xsp Fighter (USA).z64 for it.", "Add as another version"]);
    await b.ev(`${row}.querySelector(".up-go").click()`);
    check("one press adds it as another version, and the line says so",
      [await b.until(`${row}.querySelector(".up-says").textContent`, "Added as another version of Xsp Fighter.", 10000), await b.ev(`${row}.querySelector(".up-go").hidden`)],
      ["Added as another version of Xsp Fighter.", true]);
    check("both files are in the library now, under the one title",
      scanned().filter((g) => g.title === "Xsp Fighter").map((g) => path.basename(g.rom)).sort(), ["Xsp Fighter (Japan).z64", "Xsp Fighter (USA).z64"]);
    await b.key("Escape");
    await sleep(500);
    r = await api("api/scan.php");
    check("and the next scan passes nothing over", [r.passed.length, names(r.new).filter((n) => /Fighter/.test(n))], [0, []]);
    const lib = (await api("api/library.php")).games.filter((g) => g.title === "Xsp Fighter");
    check("the library shows them as one game with two versions", [lib.length, (lib[0] && lib[0].versions || []).length], [1, 2]);

    /* ---- a later disc in a folder of its own, on a console that plays through a playlist ---- */
    const d1 = put("systems/psx/Xsp Saga (USA) (Disc 1).cue", 'FILE "Xsp Saga (USA) (Disc 1).bin" BINARY\n');
    put("systems/psx/Xsp Saga (USA) (Disc 1).bin");
    const d2 = put("systems/psx/Xsp Saga (USA, Canada) (Disc 2)/Xsp Saga (USA, Canada) (Disc 2).cue", 'FILE "Xsp Saga (USA, Canada) (Disc 2).bin" BINARY\n');
    put("systems/psx/Xsp Saga (USA, Canada) (Disc 2)/Xsp Saga (USA, Canada) (Disc 2).bin");
    r = await api("api/scan.php");
    await api("api/scan.php", { action: "accept", games: [r.new.find((g) => g.rom === d1)] });
    let saga = (await api("api/library.php")).games.find((g) => g.title === "Xsp Saga") || {};
    r = await api("api/scan.php");
    const row2 = r.passed.find((p) => p.rom === d2) || {};
    check("before: the library says disc 1 only, and the scan names disc 2 as one that can be joined to it",
      [saga.discs, row2.why, row2.disc, row2.join, path.basename(row2.has || "")], [{ set: false, disc: 1, onDisk: 1 }, "have", 2, true, "Xsp Saga (USA) (Disc 1).cue"]);
    check("a file that is no later disc of a library game cannot be joined", (await api("api/scan.php", { action: "join", rom: usa })).ok, false);
    r = await api("api/scan.php", { action: "join", rom: d2 });
    const list = path.join(FIX, "systems", "psx", "Xsp Saga (USA).m3u");
    check("joined, a playlist stands beside disc 1 and reaches down into disc 2's own folder",
      [r.ok, r.path, fs.existsSync(list) && fs.readFileSync(list, "utf8").trim().split("\n")],
      [true, list, ["Xsp Saga (USA) (Disc 1).cue", "Xsp Saga (USA, Canada) (Disc 2)\\Xsp Saga (USA, Canada) (Disc 2).cue"]]);
    saga = (await api("api/library.php")).games.find((g) => g.title === "Xsp Saga") || {};
    check("the library then says two discs as a playlist, and it is the playlist that plays", [saga.discs, saga.file], [{ set: true, n: 2 }, "Xsp Saga (USA).m3u"]);
    r = await api("api/scan.php");
    check("and the scan has nothing left to say of disc 2: not passed, not offered, no hole",
      [r.passed.filter((p) => /Saga/.test(p.rom)).length, r.new.filter((g) => /Saga/.test(g.rom)).length, r.gaps.filter((g) => /Saga/.test(g.title)).length], [0, 0, 0]);

    /* ---- a console whose emulator reads no playlist ------------------------- */
    put("systems/xbox360/Xsp Trilogy/Xsp Trilogy (USA) (Disc 1).iso");
    put("systems/xbox360/Xsp Trilogy/Xsp Trilogy (USA) (Disc 2).iso");
    put("systems/xbox360/Xsp Trilogy/Xsp Trilogy (USA).m3u", "Xsp Trilogy (USA) (Disc 1).iso\nXsp Trilogy (USA) (Disc 2).iso\n");
    const a1 = put("systems/xbox360/Xsp Alone (USA) (Installation Disc)/Xsp Alone (USA) (Disc 1) (Installation Disc).iso");
    const a2 = put("systems/xbox360/Xsp Alone (USA)/Xsp Alone (USA) (Disc 2).iso");
    r = await api("api/scan.php");
    const tri = r.new.find((g) => /Trilogy/.test(g.rom)), alone = r.new.filter((g) => /Alone/.test(g.rom));
    await api("api/scan.php", { action: "accept", games: [tri, alone.find((g) => g.rom === a1)] });
    const triGame = (await api("api/library.php")).games.find((g) => g.title === "Xsp Trilogy") || {};
    const dry = await api("api/launch.php", { id: triGame.id, dry: true });
    if (dry.ok) {
      check("a playlist on a console whose emulator reads none: the game is the playlist, and the emulator is handed its first disc",
        [triGame.discs, /Xsp Trilogy \(USA\) \(Disc 1\)\.iso"/.test(dry.command), /\.m3u"'? -GameId|\.m3u" *'/.test(dry.command)], [{ set: true, n: 2 }, true, false]);
    } else {
      check("(no Xbox 360 emulator on this machine: the playlist's launch steps aside)", true);
    }
    r = await api("api/scan.php");
    const other = r.passed.find((p) => p.rom === a2) || {};
    check("there a second disc is not joined by a playlist: it is offered as another version", [other.why, other.join], ["have", false]);
    await api("api/scan.php", { action: "accept", games: [{ id: other.id, title: other.title, platform: other.platform, rom: other.rom, discs: other.discs }] });
    const card = (await api("api/library.php")).games.find((g) => g.title === "Xsp Alone") || {};
    check("and with both discs in, the card stands for the set: two discs, picked at Play, no word of disc 1 only",
      [(card.versions || []).length, card.discs], [2, { set: true, n: 2, pick: true }]);

    /* ---- nothing alike in name is dropped unseen ---------------------------- */
    const alike = ["Xsp Quest (USA).sfc", "Xsp Quest (USA) [T+Spa].sfc", "Xsp Kart v1.0.sfc", "Xsp Kart v1.1.sfc",
      "ドラゴン (Japan).sfc", "ファイナル (Japan).sfc"];
    alike.forEach((n) => put("systems/snes/" + n, Buffer.alloc(4000, 7)));
    const gdi = "3\n1 0 4 2352 track01.bin 0\n2 600 0 2352 track02.raw 0\n3 45000 4 2352 track03.bin 0\n";
    for (const g of ["Xsp Racer", "Xsp Taxi", "Xsp Diver"]) {
      put("systems/dreamcast/" + g + "/disc.gdi", gdi);
      ["track01.bin", "track02.raw", "track03.bin"].forEach((t) => put("systems/dreamcast/" + g + "/" + t, Buffer.alloc(4000, 7)));
    }
    const twin = put("systems/snes/Xsp Twin (USA).sfc", Buffer.alloc(4000, 7));
    put("systems/snes/Spare/Xsp Twin (USA).sfc", Buffer.alloc(4000, 7));
    put("systems/snes/Spare/Xsp Second (USA).sfc", Buffer.alloc(4000, 7));
    r = await api("api/scan.php");
    check("files alike in name are each offered: a translation beside its original, two revisions, two names with no Latin letter",
      names(r.new.filter((g) => alike.includes(path.basename(g.rom)))), alike.slice().sort());
    const dc = r.new.filter((g) => g.platform === "Sega Dreamcast");
    check("three games each kept as disc.gdi in a folder of its own are three games, each with its own id",
      [dc.map((g) => g.title).sort(), new Set(dc.map((g) => g.id)).size], [["Xsp Diver", "Xsp Racer", "Xsp Taxi"], 3]);
    const twins = r.new.filter((g) => /Xsp Twin/.test(g.rom)), spare = (r.copies || []).filter((c) => /Xsp Twin/.test(c.rom));
    check("the same game in a second folder is offered once, and the other is named with the file it copies",
      [twins.length, spare.map((c) => [c.title, c.rom !== twins[0].rom, c.has === twins[0].rom.toLowerCase()]), [twins[0].rom, spare[0].rom].sort()],
      [1, [["Xsp Twin", true, true]], [path.join(FIX, "systems", "snes", "Spare", "Xsp Twin (USA).sfc"), twin].sort()]);
    r = await api("api/scan.php", { action: "accept", games: [dc[0]] });
    const dcLeft = (await api("api/scan.php")).new.filter((g) => g.platform === "Sega Dreamcast");
    check("with one of the three taken in, the other two are still offered, under the ids they had",
      [r.added, dcLeft.map((g) => g.id).sort()], [1, dc.slice(1).map((g) => g.id).sort()]);
    r = await api("api/scan.php", { action: "accept", games: dcLeft });
    check("and they are taken in beside it", [r.added, scanned().filter((g) => g.platform === "Sega Dreamcast").length], [2, 3]);
  } finally {
    await api("api/settings.php", { paths: { romRoot: before.romRoot, scanFolders: before.scanFolders || [] } });
    kept.restore();
    fs.rmSync(FIX, { recursive: true, force: true });
    void cart; void notCart; void save; void japan;
  }
};
