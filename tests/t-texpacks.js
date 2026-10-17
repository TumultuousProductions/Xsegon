/* A game's texture pack (includes\texpacks.php): the Texture packs tab of a game's
 * details for PS2 (PCSX2), GameCube (Dolphin) and N64 (RetroArch's Mupen64Plus-Next
 * core). A pack put in place from a folder, a .zip, a .7z, an .hts, an .htc and a listed
 * pack's own download, replaced, put beside another and uninstalled one at a time, with
 * the emulator's switch turned on for the game alone and put back as it was with the
 * last; the N64 core's own cache of the packs before cleared; the packs listed for a
 * game, in the shipped list's shape, found by its title written another way too.
 *
 * Nothing real is read or written: for the length of the group the library is eight
 * stand-in games on a stand-in portable PCSX2, a stand-in portable Dolphin and a
 * stand-in RetroArch in the test's own data, the list is a stand-in of the test's
 * own (data\texpacks-list.json), a download comes from a server the test runs on this
 * PC, and the packs are a few bytes each. Windows' file window is answered by
 * pick-answer.txt, and no page is opened (the test server answers dry).
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const zlib = require("zlib");
const { execFileSync } = require("child_process");
const { api, DATA, Guard, ROOT, sleep } = require("./lib");

const FX = path.join(DATA, "fixtures", "texpacks");
const PCSX2 = path.join(FX, "pcsx2"), DOLPHIN = path.join(FX, "dolphin"), RA = path.join(FX, "ra");
const PACKS = path.join(FX, "packs");
const SERIAL = "SCUS-97472", CRC = 0xABCD1234;
const INTO = path.join(PCSX2, "textures", SERIAL, "replacements");
const INI = path.join(PCSX2, "gamesettings", SERIAL + "_ABCD1234.ini");
const CHEATS = "[EmuCore]\r\nEnableCheats = true\r\n\r\n[Cheats]\r\nEnable = Unlock Stages\r\n";
const DOL_INTO = path.join(DOLPHIN, "User", "Load", "Textures", "GALE01");
const DOL_INI = path.join(DOLPHIN, "User", "GameSettings", "GALE01.ini");
const N64_INTO = path.join(RA, "system", "Mupen64plus", "hires_texture", "STANDIN KART");
const N64_HTS = path.join(RA, "system", "Mupen64plus", "cache", "STANDIN KART_HIRESTEXTURES.hts");
const N64_HTC = path.join(RA, "system", "Mupen64plus", "cache", "STANDIN KART_HIRESTEXTURES.htc");
const N64_OPT = path.join(RA, "config", "Mupen64Plus-Next", "Stand-in Kart (USA).opt");
const game = (n, title, platform, file) => ({ id: "xs-scan-tptest" + n, title, platform, rom: path.join(FX, "roms", file), added: new Date().toISOString() });
const GAME = game(1, "Stand-in Colossus", "Sony Playstation 2", "Stand-in Colossus (USA).iso");
const MELEE = game(2, "Stand-in Melee", "Nintendo GameCube", "Stand-in Melee (USA).iso");
const KART = game(3, "Stand-in Kart", "Nintendo 64", "Stand-in Kart (USA).z64");
const OTHER = game(4, "Stand-in Quest", "Super Nintendo Entertainment System", "Stand-in Quest (USA).sfc");
// Titles the list writes another way: words run together with II for 2, two releases joined by " + ", and an X that stays a letter.
const BRAWL = game(5, "Standin Brawl II", "Sony Playstation 2", "Standin Brawl II (USA).iso");
const SAGA = game(6, "Stand-in Saga", "Sony Playstation 2", "Stand-in Saga (USA).iso");
const SAGA_INT = game(7, "Stand-in Saga International", "Sony Playstation 2", "Stand-in Saga International (Japan).iso");
const HERO = game(8, "Stand-in Hero X", "Sony Playstation 2", "Stand-in Hero X (USA).iso");
const ANSWER = path.join(DATA, "pick-answer.txt");

/* A portable PCSX2 that lists the stand-in game under SERIAL, as PCSX2 2.x keeps its game list. */
function pcsx2(dir, rom) {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const d of ["inis", "cache", "gamesettings"]) { fs.mkdirSync(path.join(dir, d), { recursive: true }); }
  fs.writeFileSync(path.join(dir, "pcsx2-qt.exe"), "");
  fs.writeFileSync(path.join(dir, "portable.ini"), "");
  fs.writeFileSync(path.join(dir, "inis", "PCSX2.ini"), "[Folders]\r\nCache = cache\r\nTextures = textures\r\n\r\n[EmuCore/GS]\r\nLoadTextureReplacements = false\r\n");
  const str = (s) => { const b = Buffer.from(s, "utf8"), n = Buffer.alloc(4); n.writeUInt32LE(b.length); return Buffer.concat([n, b]); };
  const tail = Buffer.alloc(23); tail.writeUInt32LE(CRC, 18);
  const head = Buffer.alloc(8); head.write("GLCE", 0, "latin1"); head.writeUInt32LE(34, 4);
  fs.writeFileSync(path.join(dir, "cache", "gamelist.cache"), Buffer.concat([head, str(rom), str(SERIAL), str("A Game"), str("Game, A"), str("A Game"), tail]));
  fs.writeFileSync(path.join(dir, "gamesettings", SERIAL + "_ABCD1234.ini"), CHEATS);
}

/* A portable Dolphin, and a RetroArch with the N64 core, its shared options holding the core's lines and another core's. */
function dolphin() {
  put(path.join(DOLPHIN, "Dolphin.exe"), "");
  put(path.join(DOLPHIN, "portable.txt"), "");
  put(path.join(DOLPHIN, "User", "Config", "GFX.ini"), "[Settings]\r\nInternalResolution = 3\r\n");
}
function retroarch() {
  put(path.join(RA, "retroarch.exe"), "");
  put(path.join(RA, "retroarch.cfg"), 'system_directory = ":\\system"\nrgui_config_directory = ":\\config"\nlibretro_info_path = ":\\info"\ngame_specific_options = "true"\nglobal_core_options = "true"\n');
  put(path.join(RA, "retroarch-core-options.cfg"), 'mupen64plus-43screensize = "640x480"\nmupen64plus-txHiresEnable = "False"\nmupen64plus-EnableEnhancedHighResStorage = "False"\nsnes9x_overclock = "disabled"\n');
  put(path.join(RA, "info", "mupen64plus_next_libretro.info"), 'corename = "Mupen64Plus-Next"\r\n');
  put(path.join(RA, "cores", "mupen64plus_next_libretro.dll"), "a stand-in core");
}

/* A .zip of its own, stored: what a pack's page hands out, in miniature. */
function zip(file, entries) {
  const locals = [], centrals = [];
  let at = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text), nm = Buffer.from(name), crc = zlib.crc32(data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x0800, 6); l.writeUInt16LE(0x21, 12);
    l.writeUInt32LE(crc, 14); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(at, 42);
    locals.push(l, nm, data); centrals.push(c, nm);
    at += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(at, 16);
  fs.writeFileSync(file, Buffer.concat([...locals, cd, end]));
}

const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const filesOf = (dir) => !fs.existsSync(dir) ? null : fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort();
const row = (k, t, by, more) => Object.assign({ k, t, name: "", by, kind: "", st: "Complete", r: "", bytes: 0, pay: "free",
  page: "https://gbatemp.net/threads/" + by.toLowerCase() + ".1/", where: "gbatemp.net", tip: "", get: null }, more || {});

module.exports = async function (b, check) {
  const kept = new Guard(["scanned-games.json", "emulators.json", "texpacks-job.json", "texpacks.json", "texpacks-list.json", "pick-folder.json", "pick-answer.txt"]);
  const outside = path.join(os.tmpdir(), "xsegon-tptest-outside-" + process.pid);
  const get = (id) => api("api/texpacks.php?id=" + (id || GAME.id));
  const post = (body, id) => api("api/texpacks.php", Object.assign({ id: id || GAME.id }, body));
  // The job's end. A press in the page starts it a moment later, so its file is taken away first (`fresh`) and waited for.
  const JOB = path.join(DATA, "texpacks-job.json");
  const fresh = () => fs.rmSync(JOB, { force: true });
  const ended = async (ms) => { let j = null; for (const end = Date.now() + (ms || 15000); Date.now() < end;) { j = fs.existsSync(JOB) ? JSON.parse(fs.readFileSync(JOB, "utf8")) : null; if (j && j.state !== "running") { break; } await sleep(120); } return j || {}; };
  const table = (pcsx2Exe) => JSON.stringify({ made: new Date().toISOString(), from: "Xsegon",
    programs: { "pcsx2-tptest": { name: "PCSX2", exe: pcsx2Exe, args: "-fullscreen -nogui", noQuotes: false },
                "dolphin-tptest": { name: "Dolphin", exe: path.join(DOLPHIN, "Dolphin.exe"), args: "-b -e", noQuotes: false },
                "retroarch-tptest": { name: "RetroArch", exe: path.join(RA, "retroarch.exe"), args: "", noQuotes: false } },
    platforms: {
      "sony playstation 2": { options: [{ program: "pcsx2-tptest", emulator: "PCSX2", emulatorId: "xsegon-pcsx2-tptest", args: "-fullscreen -nogui", core: null, load: null, default: true }] },
      "nintendo gamecube": { options: [{ program: "dolphin-tptest", emulator: "Dolphin", emulatorId: "xsegon-dolphin-tptest", args: "-b -e", core: null, load: null, default: true }] },
      "nintendo 64": { options: [{ program: "retroarch-tptest", emulator: "RetroArch", emulatorId: "xsegon-retroarch-tptest", args: '-L "cores\\mupen64plus_next_libretro.dll" -f',
        core: "mupen64plus_next", load: "cores\\mupen64plus_next_libretro.dll", default: true }] } } });
  // A download from a server of the test's own, on this PC: the pack's own host, in miniature.
  const served = {};
  const server = http.createServer((req, res) => {
    const f = served[req.url];
    if (!f) { res.writeHead(404); res.end(); return; }
    const data = fs.readFileSync(f.file || f);
    res.writeHead(200, { "Content-Length": data.length });
    if (!f.slow) { res.end(data); return; }
    // Half at once and the rest only after a long wait, so the work is seen at it, and stopped.
    res.write(data.subarray(0, data.length >> 1));
    const t = setTimeout(() => { try { res.end(data.subarray(data.length >> 1)); } catch (e) { /* gone */ } }, 30000);
    req.on("close", () => clearTimeout(t));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const HOST = "http://127.0.0.1:" + server.address().port;

  try {
    fs.rmSync(FX, { recursive: true, force: true });
    put(GAME.rom, "not a game, a stand-in");
    put(OTHER.rom, "not a game, a stand-in");
    for (const g of [BRAWL, SAGA, SAGA_INT, HERO]) { put(g.rom, "not a game, a stand-in"); }
    put(MELEE.rom, Buffer.concat([Buffer.from("GALE01"), Buffer.from([0, 2]), Buffer.alloc(64)]));
    const n64 = Buffer.alloc(1024); n64.writeUInt32BE(0x80371240, 0); n64.write("STANDIN KART        ", 0x20, "latin1");
    put(KART.rom, n64);
    pcsx2(PCSX2, GAME.rom);
    dolphin();
    retroarch();
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), JSON.stringify([GAME, MELEE, KART, OTHER, BRAWL, SAGA, SAGA_INT, HERO]));
    fs.writeFileSync(path.join(DATA, "emulators.json"), table(path.join(PCSX2, "pcsx2-qt.exe")));
    for (const f of ["texpacks-job.json", "texpacks.json", "pick-answer.txt"]) { fs.rmSync(path.join(DATA, f), { force: true }); }
    // The packs: a folder as a person unpacked it, a .zip made for another release, a .7z, a .rar; one for Dolphin; two for the N64 core.
    put(path.join(PACKS, "Folder Pack", SERIAL, "replacements", "a.png"), "A");
    put(path.join(PACKS, "Folder Pack", SERIAL, "replacements", "ui", "b.dds"), "BB");
    put(path.join(PACKS, "Folder Pack", "readme.txt"), "not a texture");
    zip(path.join(PACKS, "Euro Pack.zip"), [["Euro Pack/SCES-53326/replacements/c.png", "CCC"], ["Euro Pack/SCES-53326/replacements/d.png", "DDDD"],
                                            ["../outside.png", "never"], ["Euro Pack/notes.txt", "notes"]]);
    put(path.join(PACKS, "x.rar"), "Rar!");
    put(path.join(PACKS, "Melee HD", "GALE01", "tex1_64x64_a.png"), "M");
    put(path.join(PACKS, "Melee HD", "GALE01", "ui", "tex1_32x32_b.png"), "MM");
    zip(path.join(PACKS, "kart.zip"), [["Kart Pack/STANDIN KART/STANDIN KART#1234ABCD#0#2_all.png", "K"], ["Kart Pack/readme.txt", "r"]]);
    served["/kart.zip"] = path.join(PACKS, "kart.zip");
    put(path.join(PACKS, "STANDIN KART_HIRESTEXTURES.hts"), "an hts pack");
    put(path.join(PACKS, "htc", "STANDIN KART_HIRESTEXTURES.htc"), "an htc pack");
    const before = filesOf(path.join(PACKS, "Folder Pack"));
    // The list, in the shape tools\build-texpacks.js writes it.
    fs.writeFileSync(path.join(DATA, "texpacks-list.json"), JSON.stringify({ made: "2026-10-15", from: "a test", consoles: {
      "sony playstation 2": [row("aaaaaaaaaaa1", "Stand-in Colossus", "Upscaler", { kind: "ai", r: "NTSC-U", tip: "https://ko-fi.com/upscaler" }),
                             row("aaaaaaaaaaa2", "Stand-in Colossus", "Painter", { kind: "hand", r: "PAL", bytes: 2104533974 }),
                             row("aaaaaaaaaaa3", "Stand-in Colossus", "Seller", { kind: "ai", pay: "paid", page: "https://www.patreon.com/seller", where: "patreon.com" }),
                             row("aaaaaaaaaaa4", "Another Game Entirely", "Someone"),
                             row("aaaaaaaaaab1", "Stand-in Brawl 2", "Joiner"),
                             row("aaaaaaaaaab2", "Stand-in Brawl 2", "Handmaker", { page: "https://example.org/brawl", where: "example.org", from: "xsegon", says: "its download holds more than textures" }),
                             row("aaaaaaaaaab3", "Stand-in Saga + International", "Twofold"),
                             row("aaaaaaaaaab4", "Stand-in Hero 10", "Tenth")],
      // A pack with a download of its own carries that download's size, as tools\build-texpacks.js writes it.
      "nintendo 64": [row("bbbbbbbbbbb1", "Stand-in Kart", "Kartist", { kind: "hand", name: "Kartist's Stand-in Kart Retexture", page: "https://emulationking.com/x/",
                             where: "emulationking.com", bytes: fs.statSync(path.join(PACKS, "kart.zip")).size, get: { url: HOST + "/kart.zip", bytes: fs.statSync(path.join(PACKS, "kart.zip")).size, name: "Kartist's Stand-in Kart Retexture" } })] } }));

    /* ---- where it goes, with nothing there ------------------------------- */
    const none = await get();
    check("a PS2 game on PCSX2: where its pack goes, by the disc ID PCSX2 lists it under, nothing there, Load Textures off",
      [none.ok, none.can, none.emulator, none.key, none.folder, none.packs, none.loads, /textures folder for SCUS-97472, your disc's own ID/.test(none.where || "")],
      [true, true, "PCSX2", SERIAL, INTO, [], false, true]);
    check("a game of a console with no tab says why", [(await get(OTHER.id)).can, /PlayStation 2, GameCube, Wii and N64/.test((await get(OTHER.id)).why || "")], [false, true]);
    check("an unknown game and a bad id are refused", [(await get("xs-scan-nope")).ok, (await get("..%5Cx")).ok], [false, false]);

    /* ---- the packs listed for it ------------------------------------------- */
    check("the packs listed for the game: its own title only, handmade first, then the ones made for its release",
      none.found.map((f) => [f.by, f.kind, f.pay, f.note]),
      [["Painter", "hand", "free", "made for the European release (PAL)"], ["Upscaler", "ai", "free", "made for the USA release, as yours is"], ["Seller", "ai", "paid", ""]]);
    check("each with its size, whether it has a tip page, and no download of its own", none.found.map((f) => [f.size, f.tip, f.get]), [[2104533974, false, false], [0, true, false], [0, false, false]]);
    check("the full record counts them for the tab, with no pack there", ((await api("api/game.php?id=" + GAME.id)).game || {}).texPacks, { found: 3, have: null });
    const page = await post({ open: "aaaaaaaaaaa2", which: "page" });
    check("a pack's page is opened from the list by its key (dry here)", [page.ok, page.url, page.dry], [true, "https://gbatemp.net/threads/painter.1/", true]);
    check("and its maker's tip page", (await post({ open: "aaaaaaaaaaa1", which: "tip" })).url, "https://ko-fi.com/upscaler");
    check("a pack with no tip page, another game's pack and a key that is no key are refused",
      [(await post({ open: "aaaaaaaaaaa2", which: "tip" })).ok, (await post({ open: "aaaaaaaaaaa4" })).ok, (await post({ open: "..\\x" })).ok], [false, false, false]);
    check("a pack with no download of its own cannot be got", /no download Xsegon can fetch/.test((await post({ get: "aaaaaaaaaaa2" })).error || ""), true);
    check("a title the list writes another way finds its packs (Standin Brawl II, Stand-in Brawl 2); a row of Xsegon's own list says so, with its word on it",
      (await get(BRAWL.id)).found.map((f) => [f.by, f.from, f.says]), [["Joiner", "", ""], ["Handmaker", "xsegon", "its download holds more than textures"]]);
    check("a listed title of two releases joined by + is found for each of them; an X stays a letter, not 10",
      [(await get(SAGA.id)).found.map((f) => f.by), (await get(SAGA_INT.id)).found.map((f) => f.by), (await get(HERO.id)).found], [["Twofold"], ["Twofold"], []]);
    const texHas = ((await api("api/library.php?texpacks=1&versions=all&grouped=0")).games || []).map((g) => g.id);
    check("Filter by > Texture packs finds them the same way", [BRAWL, SAGA, SAGA_INT, HERO].map((g) => texHas.includes(g.id)), [true, true, true, false]);

    /* ---- from a folder ----------------------------------------------------- */
    const s1 = await post({ from: path.join(PACKS, "Folder Pack") });
    check("a folder is taken, the work in the background", [s1.ok, s1.started], [true, true]);
    let j = await ended();
    check("it ends done, saying what came and when PCSX2 loads it", [j.state, /in place for Stand-in Colossus: 2 files/.test(j.said || ""), /PCSX2 loads it the next time the game starts/.test(j.said || "")], ["done", true, true]);
    const FP = (...p) => path.join("Folder Pack", ...p);
    check("its textures are in a folder of its own in PCSX2's place for the game, its subfolders kept, the rest of the folder left out", filesOf(INTO), [FP("a.png"), FP("ui", "b.dds")]);
    check("the folder it came from is as it was", filesOf(path.join(PACKS, "Folder Pack")), before);
    const ini1 = fs.readFileSync(INI, "utf8");
    check("Load Textures is on in the game's own settings, its cheats as they were", [/\[EmuCore\/GS\]\r\nLoadTextureReplacements = true/.test(ini1), ini1.startsWith(CHEATS)], [true, true]);
    check("PCSX2's own settings are not touched", /LoadTextureReplacements = false/.test(fs.readFileSync(path.join(PCSX2, "inis", "PCSX2.ini"), "utf8")), true);
    const st1 = await get();
    check("the tab's answer: the pack, whose it is, and that PCSX2 loads it",
      [st1.packs.length, st1.packs[0].files, st1.packs[0].mine, st1.packs[0].from, /^[a-f0-9]{10}$/.test(st1.packs[0].id), st1.packs[0].paths, st1.loads], [1, 2, true, "Folder Pack", true, undefined, true]);
    check("the full record has it for About's line", ((await api("api/game.php?id=" + GAME.id)).game.texPacks || {}).have, { from: "Folder Pack", n: 1, bytes: 3 });
    check("a pack from a folder is no listed pack's, and no listed row says it is installed", [st1.packs[0].listed, st1.found.map((f) => f.pack)], [null, [null, null, null]]);
    const bar = ((await api("api/jobs.php")).jobs || []).find((x) => x.key === "texpacks") || {};
    check("the corner bar has it, done, under the game's name", [bar.name, bar.state, /in place/.test(bar.said || "")], ["Texture pack for Stand-in Colossus", "done", true]);
    const shown = await api("api/reveal.php", { id: GAME.id, what: "texpack" });
    check("Open folder shows the pack's folder, found from the game (dry here)", [shown.ok, shown.folder, shown.dry], [true, INTO, true]);

    /* ---- a pack there already: asked first --------------------------------- */
    const ask = await post({ from: path.join(PACKS, "Euro Pack.zip") });
    check("with a pack there, nothing is done: it says what is there, that one more can go beside it, and waits to be asked again",
      [ask.ok, ask.needs, (ask.packs || []).map((p) => p.files), ask.beside], [true, "choose", [2], true]);
    check("(and nothing changed)", filesOf(INTO), [FP("a.png"), FP("ui", "b.dds")]);

    /* ---- replaced, from a .zip for another release ------------------------ */
    check("asked again to replace it: started", (await post({ from: path.join(PACKS, "Euro Pack.zip"), replace: true })).started, true);
    j = await ended();
    check("done, saying it was made for another release and that a name was left out",
      [j.state, /made for SCES-53326, another release than yours \(SCUS-97472\)/.test(j.said || ""), /1 file was left out/.test(j.said || "")], ["done", true, true]);
    check("the one there is gone, the new one in its place, nothing written outside the folder",
      [filesOf(INTO), fs.existsSync(path.join(PCSX2, "textures", "outside.png")), fs.existsSync(path.join(PCSX2, "textures", SERIAL, "outside.png"))],
      [[path.join("Euro Pack", "c.png"), path.join("Euro Pack", "d.png")], false, false]);
    check("no work folder left behind", fs.readdirSync(path.join(PCSX2, "textures")).filter((n) => n.startsWith(".xsegon")), []);

    /* ---- from a .7z -------------------------------------------------------- */
    const seven = path.join(ROOT, "bin", "7zr.exe");
    if (fs.existsSync(seven)) {
      put(path.join(PACKS, "src7", "Seven Pack", "e.png"), "EEEEE");
      put(path.join(PACKS, "src7", "Seven Pack", "deep", "f.png"), "FFFFFF");
      execFileSync(seven, ["a", "-t7z", path.join(PACKS, "Seven Pack.7z"), "Seven Pack"], { cwd: path.join(PACKS, "src7"), stdio: "ignore" });
      await post({ from: path.join(PACKS, "Seven Pack.7z"), replace: true });
      j = await ended();
      check("a .7z with no replacements folder: the folder all its pictures share is the pack", [j.state, filesOf(INTO)], ["done", [path.join("Seven Pack", "deep", "f.png"), path.join("Seven Pack", "e.png")]]);
    } else {
      console.log("    (bin\\7zr.exe is not here: a .7z is not tried)");
    }

    /* ---- a second pack beside the one there, and one of two uninstalled ----- */
    const first = (await get()).packs[0];
    const firstDir = fs.readdirSync(INTO)[0];
    check("asked to go beside it: started", (await post({ from: path.join(PACKS, "Folder Pack"), how: "beside" })).started, true);
    j = await ended();
    check("done, saying it sits beside the one there", [j.state, /sits beside the pack there/.test(j.said || "")], ["done", true]);
    const two = await get();
    check("both are there, each in a folder of its own, the first as it was",
      [two.packs.map((p) => p.from), fs.readdirSync(INTO).sort(), filesOf(path.join(INTO, firstDir)).length > 0], [[first.from, "Folder Pack"], [firstDir, "Folder Pack"].sort(), true]);
    check("About's line counts them", ((await api("api/game.php?id=" + GAME.id)).game.texPacks || {}).have.n, 2);
    check("with two, an uninstall must say which", /which one is to be uninstalled is not said/.test((await post({ remove: true })).error || ""), true);
    check("one that is not there, or a name that is no id, is refused",
      [/not installed for this game now/.test((await post({ remove: "0123456789" })).error || ""), (await post({ remove: "..\\x" })).ok], [true, false]);
    check("the first one uninstalled by its own id: started", (await post({ remove: first.id })).started, true);
    j = await ended();
    check("done, saying the other stays", [j.state, /is uninstalled from Stand-in Colossus/.test(j.said || ""), /The other pack stays/.test(j.said || "")], ["done", true, true]);
    check("only its folder went; Load Textures stays on", [fs.readdirSync(INTO), /LoadTextureReplacements = true/.test(fs.readFileSync(INI, "utf8"))], [["Folder Pack"], true]);
    // A picture put in the game's folder by hand is a pack of its own, uninstalled alone.
    put(path.join(INTO, "hand.png"), "H");
    const hand = (await get()).packs;
    check("a picture put there by hand shows as a pack put there by hand", hand.map((p) => [p.id === "hand" ? "hand" : p.from, p.mine, p.files]), [["Folder Pack", true, 2], ["hand", false, 1]]);
    await post({ remove: "hand" });
    j = await ended();
    check("and uninstalls alone, the other pack left", [j.state, fs.readdirSync(INTO)], ["done", ["Folder Pack"]]);

    /* ---- what is refused, and why ------------------------------------------ */
    const rar = await post({ from: path.join(PACKS, "x.rar"), replace: true });
    check("a .rar is refused, with the way round it", [rar.ok, /cannot open a \.rar.*Install from a folder/.test(rar.error || "")], [false, true]);
    check("so is a whole drive", /whole drive/.test((await post({ from: "C:\\", replace: true })).error || ""), true);
    check("and a folder inside PCSX2's own texture folder", /inside PCSX2's own texture folder/.test((await post({ from: INTO, replace: true })).error || ""), true);
    check("and a file that is not there", /not there any more/.test((await post({ from: path.join(PACKS, "gone.zip"), replace: true })).error || ""), true);
    check("and an .hts for a PS2 game", /for RetroArch's N64 core, not for PCSX2/.test(((await post({ from: path.join(PACKS, "STANDIN KART_HIRESTEXTURES.hts"), replace: true })).ok && (await ended()).error) || ""), true);

    /* ---- uninstalled: the line as it was ----------------------------------- */
    check("uninstalled: started", (await post({ remove: true })).started, true);
    j = await ended();
    check("done, saying what went", [j.state, /uninstalled/.test(j.said || "")], ["done", true]);
    check("its files and the game's folder are gone", [fs.existsSync(INTO), fs.existsSync(path.join(PCSX2, "textures", SERIAL))], [false, false]);
    check("the game's settings are byte for byte as they were before the first pack", fs.readFileSync(INI, "utf8"), CHEATS);
    const st2 = await get();
    check("the tab's answer: nothing there, Load Textures off", [st2.packs, st2.loads, Object.keys(JSON.parse(fs.readFileSync(path.join(DATA, "texpacks.json"), "utf8")))], [[], false, []]);
    check("nothing to uninstall is refused", /no texture pack for this game to uninstall/.test((await post({ remove: true })).error || ""), true);

    /* ---- a GameCube game on Dolphin ---------------------------------------- */
    const dol = await get(MELEE.id);
    check("a GameCube game on Dolphin: by the disc's own ID, read from its file, into Load\\Textures", [dol.can, dol.emulator, dol.key, dol.folder, dol.loads], [true, "Dolphin", "GALE01", DOL_INTO, false]);
    await post({ from: path.join(PACKS, "Melee HD") }, MELEE.id);
    j = await ended();
    check("its pack goes in under the game's ID, the folder named so in the pack taken", [j.state, filesOf(DOL_INTO)],
      ["done", [path.join("Melee HD", "tex1_64x64_a.png"), path.join("Melee HD", "ui", "tex1_32x32_b.png")]]);
    check("Dolphin's Load Custom Textures is on for that game alone, in a file of its own Xsegon made",
      [fs.readFileSync(DOL_INI, "utf8"), fs.readFileSync(path.join(DOLPHIN, "User", "Config", "GFX.ini"), "utf8")], ["[Video_Settings]\r\nHiresTextures = True\r\n", "[Settings]\r\nInternalResolution = 3\r\n"]);
    await post({ remove: true }, MELEE.id);
    j = await ended();
    check("uninstalled: the pack and the file Xsegon made both gone", [j.state, fs.existsSync(DOL_INTO), fs.existsSync(DOL_INI)], ["done", false, false]);

    /* ---- an N64 game on RetroArch's Mupen64Plus-Next core ------------------ */
    const kart = await get(KART.id);
    check("an N64 game on the Mupen64Plus-Next core: by the name inside the cartridge", [kart.can, kart.emulator, kart.key, kart.folder, kart.loads], [true, "RetroArch", "STANDIN KART", N64_INTO, false]);
    check("its listed pack has a download of its own", kart.found.map((f) => [f.name, f.get, f.size > 0]), [["Kartist's Stand-in Kart Retexture", true, true]]);
    // The core's own cache of the packs before, which it would read in place of the new one.
    put(N64_HTC, "the core's cache of a pack before");
    check("got with one press", (await post({ get: "bbbbbbbbbbb1" }, KART.id)).started, true);
    j = await ended(20000);
    check("fetched from its own host, then put in place under the cartridge's name", [j.state, filesOf(N64_INTO)],
      ["done", [path.join("Kartist's Stand-in Kart Retexture", "STANDIN KART#1234ABCD#0#2_all.png")]]);
    check("no download left behind", fs.readdirSync(path.join(RA, "system", "Mupen64plus")).filter((n) => n.startsWith(".xsegon")), []);
    const kp = await get(KART.id);
    check("the listed pack's own row knows it is installed, and the pack knows its row; no address or path reaches the page",
      [kp.found[0].pack === kp.packs[0].id, kp.packs[0].listed, "url" in kp.found[0], "path" in kp.packs[0]], [true, "bbbbbbbbbbb1", false, false]);
    // A pack recorded before the listed key was kept is known by the download it came from.
    const recs = JSON.parse(fs.readFileSync(path.join(DATA, "texpacks.json"), "utf8"));
    delete recs[KART.id].packs[0].k;
    fs.writeFileSync(path.join(DATA, "texpacks.json"), JSON.stringify(recs));
    check("(and one recorded without its key, by the download it came from)", (await get(KART.id)).found[0].pack === kp.packs[0].id, true);
    check("the core's cache of the packs before is gone, and the next start's whole read is said",
      [fs.existsSync(N64_HTC), /next start reads the packs first.*does not answer until then/.test(j.said || ""), (await get(KART.id)).readsFirst > 0], [false, true, true]);
    const lnch = await api("api/launch.php", { id: KART.id, dry: true });
    check("and a start of the game says so", [lnch.ok, lnch.texRead > 0], [true, true]);
    put(N64_HTC, "the core's cache, made at that start");
    check("once the core has made its cache, nothing is said", [(await get(KART.id)).readsFirst, (await api("api/launch.php", { id: KART.id, dry: true })).texRead], [0, null]);
    check("the game's own options file: the core's lines from the shared one, another core's left out, hi-res textures on",
      fs.readFileSync(N64_OPT, "utf8"), 'mupen64plus-43screensize = "640x480"\nmupen64plus-EnableEnhancedHighResStorage = "False"\nmupen64plus-txHiresEnable = "True"\n');
    check("RetroArch's shared options are not touched", /mupen64plus-txHiresEnable = "False"/.test(fs.readFileSync(path.join(RA, "retroarch-core-options.cfg"), "utf8")), true);
    check("the tab: the pack, named as its page names it, and that the core loads it", [(await get(KART.id)).packs.map((p) => p.from), (await get(KART.id)).loads], [["Kartist's Stand-in Kart Retexture"], true]);
    await post({ from: path.join(PACKS, "STANDIN KART_HIRESTEXTURES.hts"), replace: true }, KART.id);
    j = await ended();
    check("an .hts pack in its place: the file in the core's cache folder, the folder gone, its storage switched on too",
      [j.state, fs.existsSync(N64_HTS), fs.existsSync(N64_INTO), /mupen64plus-EnableEnhancedHighResStorage = "True"/.test(fs.readFileSync(N64_OPT, "utf8"))], ["done", true, false, true]);
    await post({ remove: true }, KART.id);
    j = await ended();
    check("uninstalled: the .hts and the options file Xsegon made both gone", [j.state, fs.existsSync(N64_HTS), fs.existsSync(N64_OPT)], ["done", false, false]);
    await post({ from: path.join(PACKS, "htc", "STANDIN KART_HIRESTEXTURES.htc") }, KART.id);
    j = await ended();
    check("an .htc pack goes in under its own name, the core's file storage left off",
      [j.state, fs.existsSync(N64_HTC), fs.existsSync(N64_HTS), /mupen64plus-EnableEnhancedHighResStorage = "False"/.test(fs.readFileSync(N64_OPT, "utf8"))], ["done", true, false, true]);
    const htcAsk = await post({ get: "bbbbbbbbbbb1" }, KART.id);
    check("nothing can go beside it: only Replace is offered", [htcAsk.needs, htcAsk.beside], ["choose", false]);
    check("and beside is refused if asked", /loads an \.hts or \.htc pack alone/.test((await post({ get: "bbbbbbbbbbb1", how: "beside" }, KART.id)).error || ""), true);
    await post({ remove: true }, KART.id);
    j = await ended();
    check("uninstalled: the .htc and the options file both gone", [j.state, fs.existsSync(N64_HTC), fs.existsSync(N64_OPT)], ["done", false, false]);
    fs.writeFileSync(path.join(RA, "retroarch.cfg"), 'system_directory = ":\\system"\nrgui_config_directory = ":\\config"\nlibretro_info_path = ":\\info"\n');
    const para = JSON.parse(table(path.join(PCSX2, "pcsx2-qt.exe")));
    para.platforms["nintendo 64"].options[0].args = '-L "cores\\parallel_n64_libretro.dll" -f';
    put(path.join(RA, "info", "parallel_n64_libretro.info"), 'corename = "ParaLLEl N64"\r\n');
    fs.writeFileSync(path.join(DATA, "emulators.json"), JSON.stringify(para));
    const p64 = await get(KART.id);
    check("on another N64 core: said, with the one that loads packs named, and its listed pack still shown",
      [p64.can, /ParaLLEl N64 core, which loads no texture packs\. Mupen64Plus-Next does/.test(p64.why || ""), p64.found.length], [false, true, 1]);
    fs.writeFileSync(path.join(DATA, "emulators.json"), table(path.join(PCSX2, "pcsx2-qt.exe")));

    /* ---- an emulator outside the test's own data is never written --------- */
    pcsx2(outside, GAME.rom);
    fs.writeFileSync(path.join(DATA, "emulators.json"), table(path.join(outside, "pcsx2-qt.exe")));
    check("a test copy never writes a PCSX2 outside its own data",
      [/test copy never writes a real PCSX2/.test((await post({ from: path.join(PACKS, "Folder Pack") })).error || ""), fs.existsSync(path.join(outside, "textures"))], [true, false]);
    fs.writeFileSync(path.join(outside, "cache", "gamelist.cache"), "GLCE");
    check("a game PCSX2 has not listed says how to get it listed", /Open PCSX2 once with this game in its list/.test((await get()).why || ""), true);
    fs.writeFileSync(path.join(DATA, "emulators.json"), table(path.join(PCSX2, "pcsx2-qt.exe")));

    /* ---- the tab, in the page ---------------------------------------------- */
    const TABS = `[...document.querySelectorAll("#details .dtabs .dtab")]`;
    const PANE = `document.querySelector("#details .dtab-pane.is-texpacks")`;
    const names = `[...${PANE}.querySelectorAll(".cr-name")].map((x) => x.childNodes[0].textContent)`;
    const buttons = `[...${PANE}.querySelectorAll(".cr-row")].map((r) => [...r.querySelectorAll(".tp-btn")].map((x) => x.textContent))`;
    // A row's own button is its last; a Tip, where there is one, stands before it.
    const press = (i) => b.ev(`[...${PANE}.querySelectorAll(".cr-row")][${i}].querySelector(".tp-btn:last-of-type").click()`);
    await b.goto();
    await b.setView("list");
    await b.openPlatform("Sony Playstation 2");
    await b.ev(`import("/js/state.js").then((S) => { const i = S.games.findIndex((g) => g.id === ${JSON.stringify(GAME.id)}); if (i >= 0) { S.setSel(i); } })`);
    await b.key("i");
    await b.waitFor(`!document.getElementById("details").hidden && !!document.querySelector("#details .dtabs")`, 8000);
    check("a PS2 game's details have a Texture packs tab after Hacks, counting the packs listed",
      await b.until(`${TABS}.map((x) => (/^Saves/.test(x.textContent) ? "Saves" : x.textContent))`, ["About", "Media", "Saves", "File check", "Cheats", "Hacks", "Texture packs (3)", "Accompanied files", "Notes"], 8000),
      ["About", "Media", "Saves", "File check", "Cheats", "Hacks", "Texture packs (3)", "Accompanied files", "Notes"]);
    check("and About says how many are found, the line a way to the tab",
      await b.ev(`(dts => { const i = dts.findIndex((d) => d.textContent === "texture pack"); return i < 0 ? null : [dts[i].nextElementSibling.textContent, dts[i].nextElementSibling.classList.contains("fact-go")]; })([...document.querySelectorAll("#details .dleft dt")])`),
      ["none on this PC  ·  3 found", true]);
    await b.ev(`document.querySelector('#details .dtab[data-tab="texpacks"]').click()`);
    check("it offers a file or a folder, then the packs found, handmade first, the paid one folded away",
      await b.until(names, ["Install a pack you downloaded", "Install from a folder you unpacked", "Painter", "Upscaler", "Paid packs (1)"], 8000),
      ["Install a pack you downloaded", "Install from a folder you unpacked", "Painter", "Upscaler", "Paid packs (1)"]);
    check("every row says what it does on a button of its own, a Tip beside it where the maker has a tip page",
      await b.ev(buttons), [["Choose file..."], ["Choose folder..."], ["Their page"], ["Tip", "Their page"], ["Show"]]);
    check("each pack's kind said beside its name", await b.ev(`[...${PANE}.querySelectorAll(".cr-row")].slice(2, 4).map((r) => (r.querySelector(".tp-kind") || {}).textContent)`), ["Handcrafted", "AI upscale"]);
    // A press on a row itself only selects it: no page, no window, no install (the page's own log lines are not asks).
    await b.ev(`(() => { window.__tpAsked = 0; const f = window.fetch; window.__tpFetch = f; window.fetch = function (u, o) { if (o && o.method === "POST" && /texpacks|pick-folder|reveal/.test(String(u))) { window.__tpAsked++; } return f.apply(this, arguments); }; })()`);
    await b.ev(`[...${PANE}.querySelectorAll(".cr-row")].forEach((r) => { r.querySelector(".cr-name").click(); r.click(); })`);
    await sleep(600);
    check("a press on a row's words does nothing but select it", await b.ev(`[window.__tpAsked, !!document.querySelector(".confirm"), [...${PANE}.querySelectorAll(".cr-row.sel")].length]`), [0, false, 1]);
    await b.ev(`(() => { window.fetch = window.__tpFetch; })()`);
    await press(4);
    check("Show on the folded box shows the paid one, and becomes Hide", [await b.until(`${names}.slice(4)`, ["Paid packs (1)", "Seller"], 4000), (await b.ev(buttons))[4]], [["Paid packs (1)", "Seller"], ["Hide"]]);
    await press(4);
    await b.until(`${names}.length`, 5, 4000);
    await b.shot("details-tab-texpacks-none");
    fs.writeFileSync(ANSWER, path.join(PACKS, "Folder Pack"));
    fresh();
    await press(1);
    j = await ended();
    check("the folder chosen in Windows' window is put in place", [j.state, filesOf(INTO)], ["done", [FP("a.png"), FP("ui", "b.dds")]]);
    const NAMES4 = ["Its texture folder", "Install another pack you downloaded", "Install from a folder you unpacked", "Folder Pack"];
    check("and when it ends it is among the packs, marked installed with its Uninstall on its own row, and nothing above says it",
      [await b.until(`(n => n.slice(0, 4))(${names})`, NAMES4, 15000), (await b.ev(buttons)).slice(0, 4),
       await b.ev(`[...${PANE}.querySelectorAll(".tp-kind.on")].map((x) => x.closest(".sv-group").querySelector("h3").textContent + ": " + x.parentNode.childNodes[0].textContent)`)],
      [NAMES4, [["Open folder"], ["Choose file..."], ["Choose folder..."], ["Uninstall..."]], ["Found for this game: Folder Pack"]]);
    await b.shot("details-tab-texpacks-installed");
    // Another pack, with one there: asked whether it goes beside it or in its place.
    fs.writeFileSync(ANSWER, path.join(PACKS, "Euro Pack.zip"));
    await press(1);
    check("another pack asks first: beside the one there, or in its place",
      await b.until(`(c => c ? [c.querySelector("h2").textContent, [...c.querySelectorAll(".confirm-bar button")].map((x) => x.textContent)] : null)(document.querySelector(".confirm"))`,
        ["Add it beside the pack there?", ["Not now", "Replace it", "Add it beside"]], 6000), ["Add it beside the pack there?", ["Not now", "Replace it", "Add it beside"]]);
    await b.ev(`document.querySelector(".confirm .confirm-bar button").click()`);
    await press(3);
    check("Uninstall asks first", await b.until(`(document.querySelector(".confirm h2") || {}).textContent || ""`, "Uninstall this texture pack?", 4000), "Uninstall this texture pack?");
    fresh();
    await b.ev(`document.querySelector(".confirm .confirm-bar .primary").click()`);
    j = await ended();
    check("and its Uninstall uninstalls it", [j.state, fs.existsSync(INTO), /uninstalled/.test(j.said || "")], ["done", false, true]);
    check("the tab is back to offering a pack", await b.until(`(n => n.slice(0, 2))(${names})`, ["Install a pack you downloaded", "Install from a folder you unpacked"], 15000),
      ["Install a pack you downloaded", "Install from a folder you unpacked"]);

    /* ---- a listed pack's Install, followed in the tab, and stopped ----------- */
    const LIST = path.join(DATA, "texpacks-list.json");
    const listNow = JSON.parse(fs.readFileSync(LIST, "utf8"));
    listNow.consoles["nintendo 64"][0].get.url = HOST + "/slow.zip";
    fs.writeFileSync(LIST, JSON.stringify(listNow));
    served["/slow.zip"] = { file: path.join(PACKS, "kart.zip"), slow: true };
    await b.key("Escape");
    await b.until(`document.getElementById("details").hidden`, true, 6000);
    await b.openPlatform("Nintendo 64");
    await b.ev(`import("/js/state.js").then((S) => { const i = S.games.findIndex((g) => g.id === ${JSON.stringify(KART.id)}); if (i >= 0) { S.setSel(i); } })`);
    await b.key("i");
    await b.waitFor(`!document.getElementById("details").hidden && !!document.querySelector("#details .dtabs")`, 8000);
    await b.ev(`document.querySelector('#details .dtab[data-tab="texpacks"]').click()`);
    check("an N64 pack with its own download offers Install",
      await b.until(`(n => n.slice(2))(${names})`, ["Kartist's Stand-in Kart Retexture"], 8000), ["Kartist's Stand-in Kart Retexture"]);
    check("(its button)", (await b.ev(buttons))[2], ["Install..."]);
    await press(2);
    check("Install asks first, saying what comes, from where and into where",
      await b.until(`(c => c ? [c.querySelector("h2").textContent, /From: emulationking\\.com/.test(c.textContent), /Into: .*STANDIN KART/.test(c.textContent)] : null)(document.querySelector(".confirm"))`,
        ["Install this texture pack?", true, true], 4000), ["Install this texture pack?", true, true]);
    fresh();
    await b.ev(`document.querySelector(".confirm .confirm-bar .primary").click()`);
    check("while it downloads, the tab shows it at work with a bar of its own and Stop",
      await b.until(`(r => r ? [r.querySelector(".cr-name").textContent, /^Downloading/.test(r.querySelector(".sv-sub").textContent), !!r.querySelector(".tp-prog"), (r.querySelector(".tp-btn") || {}).textContent] : null)(${PANE}.querySelector(".cr-row"))`,
        ["Installing Kartist's Stand-in Kart Retexture", true, true, "Stop"], 10000), ["Installing Kartist's Stand-in Kart Retexture", true, true, "Stop"]);
    await b.shot("details-tab-texpacks-working");
    await press(0);
    j = await ended(15000);
    check("Stop stops it, nothing put in place", [j.state, fs.existsSync(N64_INTO), fs.existsSync(N64_OPT)], ["stopped", false, false]);
    check("and the tab offers it again", await b.until(`(n => n.slice(0, 1))(${names})`, ["Install a pack you downloaded"], 8000), ["Install a pack you downloaded"]);

    /* ---- a listed pack installed: its own row says so, its Uninstall there ---- */
    listNow.consoles["nintendo 64"][0].get.url = HOST + "/kart.zip";
    fs.writeFileSync(LIST, JSON.stringify(listNow));
    await press(2);
    await b.until(`!!document.querySelector(".confirm")`, true, 4000);
    fresh();
    await b.ev(`document.querySelector(".confirm .confirm-bar .primary").click()`);
    j = await ended(20000);
    const KROW = `[...${PANE}.querySelectorAll(".cr-row")].find((r) => r.querySelector(".cr-name").childNodes[0].textContent === "Kartist's Stand-in Kart Retexture")`;
    check("installed from the list, its own row says so in green, with Uninstall in place of Install",
      [j.state, await b.until(`(r => r ? [!!r.querySelector(".tp-kind.on"), [...r.querySelectorAll(".tp-btn")].map((x) => x.textContent)] : null)(${KROW})`, [true, ["Uninstall..."]], 15000)],
      ["done", [true, ["Uninstall..."]]]);
    check("and the core's whole read at the next start is said with the game's folder", await b.ev(`${names}.includes("The next start reads the packs first")`), true);
    await b.shot("details-tab-texpacks-listed-installed");
    await b.ev(`${KROW}.querySelector(".tp-btn").click()`);
    await b.until(`(document.querySelector(".confirm h2") || {}).textContent || ""`, "Uninstall this texture pack?", 4000);
    fresh();
    await b.ev(`document.querySelector(".confirm .confirm-bar .primary").click()`);
    j = await ended();
    check("its Uninstall there uninstalls it, and the row offers Install again",
      [j.state, fs.existsSync(N64_INTO), await b.until(`(r => r ? [...r.querySelectorAll(".tp-btn")].map((x) => x.textContent) : null)(${KROW})`, ["Install..."], 15000)],
      ["done", false, ["Install..."]]);
    check("no script errors through any of it", await b.ev(`(window.__errs || []).length`), 0);
  } finally {
    server.close();
    fs.rmSync(ANSWER, { force: true });
    fs.rmSync(FX, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(path.join(DATA, "texpacks-kept"), { recursive: true, force: true });
    kept.restore();
  }
};
