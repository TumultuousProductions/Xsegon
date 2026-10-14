/*  Hacks (includes\hacks.php, api\hacks.php, js\hackstab.js): the patches
    that fit a game's file, playing one with that file left as it is, and the
    games of your own started with a game's file (a PC version of it).
    Stand-in games, patches in each format and lists of known releases only:
    no real game or patch is read, every start is dry, LaunchBox is off. */
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");
const { api, DATA, ROOT, Guard, sleep } = require("./lib");

const TAR = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
const NES = "Nintendo - Nintendo Entertainment System";
const crc = (b) => (zlib.crc32(b) >>> 0).toString(16).padStart(8, "0");
const sha1 = (b) => crypto.createHash("sha1").update(b).digest("hex");
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
function bytes(seed, n) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) { b[i] = (i * 29 + seed * 11 + (i >> 7)) & 255; }
  return b;
}
// A number as BPS and UPS write it.
function num(n) {
  const out = [];
  for (;;) {
    const x = n & 0x7f;
    n = Math.floor(n / 128);
    if (n === 0) { out.push(0x80 | x); break; }
    out.push(x);
    n--;
  }
  return Buffer.from(out);
}
/* A BPS using all four of its commands: the start read from the source, new
   bytes, a piece copied from elsewhere in the source, a run that repeats
   itself, and the rest read from the source again. Returns [patch, result]. */
function bps(src, mark) {
  const fresh = Buffer.alloc(64, mark);
  const target = Buffer.concat([src.subarray(0, 1000), fresh, src.subarray(5000, 5300), Buffer.alloc(200, 0xAB), src.subarray(1564)]);
  const act = (len, cmd) => num(((len - 1) << 2) | cmd);
  const body = Buffer.concat([
    Buffer.from("BPS1"), num(src.length), num(target.length), num(0),
    act(1000, 0),
    act(64, 1), fresh,
    act(300, 2), num(5000 << 1),
    act(1, 1), Buffer.from([0xAB]),
    act(199, 3), num(1364 << 1),
    act(src.length - 1564, 0),
    u32(parseInt(crc(src), 16)), u32(parseInt(crc(target), 16)),
  ]);
  return [Buffer.concat([body, u32(zlib.crc32(body))]), target];
}
function ups(src) {
  const target = Buffer.from(src);
  for (let i = 2000; i < 2040; i++) { target[i] = src[i] ^ 0xFF; }
  const body = Buffer.concat([Buffer.from("UPS1"), num(src.length), num(target.length), num(2000), Buffer.alloc(40, 0xFF), Buffer.from([0]),
    u32(parseInt(crc(src), 16)), u32(parseInt(crc(target), 16))]);
  return [Buffer.concat([body, u32(zlib.crc32(body))]), target];
}
function ips(src) {
  const target = Buffer.from(src);
  Buffer.from("IPS WAS HERE").copy(target, 300);
  target.fill(0x5A, 900, 950);
  const rec = (at, data) => Buffer.concat([Buffer.from([at >> 16, (at >> 8) & 255, at & 255, data.length >> 8, data.length & 255]), data]);
  const run = (at, n, v) => Buffer.from([at >> 16, (at >> 8) & 255, at & 255, 0, 0, n >> 8, n & 255, v]);
  return [Buffer.concat([Buffer.from("PATCH"), rec(300, Buffer.from("IPS WAS HERE")), run(900, 50, 0x5A), Buffer.from("EOF")]), target];
}

module.exports = async function (b, check) {
  const fx = path.join(DATA, "fixtures", "libretro");
  if (!fs.existsSync(fx)) {
    check("hacks: runs only on the test server's own copy (never against libretro itself)", true, true);
    return;
  }
  const kept = new Guard(["scanned-games.json", "hack-choice.json", "local-games.json", "hack-of.json"]);
  const before = (await api("api/settings.php")).settings;
  const roms = path.join(DATA, "fixtures", "hacks-roms");
  const dir = path.join(roms, "nes");
  const hacks = path.join(dir, "Hacks");
  fs.rmSync(roms, { recursive: true, force: true });
  fs.rmSync(path.join(DATA, "hacks"), { recursive: true, force: true });
  fs.mkdirSync(path.join(hacks, "Deeper"), { recursive: true });
  for (const f of fs.existsSync(path.join(DATA, "libretro")) ? fs.readdirSync(path.join(DATA, "libretro")) : []) {
    if (/\.crcs\.json$/.test(f)) { fs.rmSync(path.join(DATA, "libretro", f), { force: true }); }
  }

  /* ---- the stand-in games and patches -------------------------------------- */
  const head = Buffer.from([0x4E, 0x45, 0x53, 0x1A, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const A = Buffer.concat([head, bytes(1, 16384)]), B = Buffer.concat([head, bytes(2, 16384)]), C = Buffer.concat([head, bytes(3, 16384)]);
  const fileA = path.join(dir, "Hk Base (USA).nes");
  fs.writeFileSync(fileA, A);
  fs.writeFileSync(path.join(dir, "Hk Rev (USA) (Rev 1).nes"), C);
  fs.writeFileSync(path.join(roms, "Hk Zipped (USA).nes"), B);
  const zipB = path.join(dir, "Hk Zipped (USA).zip");
  execFileSync(TAR, ["-a", "-cf", zipB, "-C", roms, "Hk Zipped (USA).nes"], { windowsHide: true });
  fs.writeFileSync(path.join(roms, "A Disc.bin"), bytes(9, 4096));

  const [colour, colourMade] = bps(A, 0x43);
  const [inside, insideMade] = bps(A, 0x49);
  const [fix, fixMade] = ups(B);
  const [named, namedMade] = ips(A);
  const hurt = Buffer.from(colour); hurt[40] ^= 0xFF;
  fs.writeFileSync(path.join(hacks, "Hk_Colour_Hack.bps"), colour);
  fs.writeFileSync(path.join(hacks, "Hk Zipped Fix.ups"), fix);
  fs.writeFileSync(path.join(hacks, "Hk Base (USA).ips"), named);
  fs.writeFileSync(path.join(hacks, "Deeper", "Loose Thing.ips"), named);
  fs.writeFileSync(path.join(hacks, "Damaged.bps"), hurt);
  fs.writeFileSync(path.join(hacks, "Not A Patch.bps"), "only called one");
  fs.writeFileSync(path.join(hacks, "Zz Colour Again.bps"), colour);     // the same patch kept twice
  // In archives: a patch with its readme naming the base, and the library's own patch-only file.
  fs.writeFileSync(path.join(roms, "bundle.xdelta"), Buffer.concat([Buffer.from([0xD6, 0xC3, 0xC4, 0]), bytes(7, 200)]));
  fs.writeFileSync(path.join(roms, "notes.txt"), "Apply to:\r\nHk Base (USA).nes\r\nCRC32: " + crc(A).toUpperCase() + "\r\n");
  execFileSync(TAR, ["-a", "-cf", path.join(hacks, "[77]Hk+Bundle.zip"), "-C", roms, "bundle.xdelta", "notes.txt"], { windowsHide: true });
  fs.writeFileSync(path.join(roms, "inside.bps"), inside);
  const zipPatch = path.join(dir, "(MOD)Hk Patch Only.zip");
  execFileSync(TAR, ["-a", "-cf", zipPatch, "-C", roms, "inside.bps", "notes.txt"], { windowsHide: true });
  // A patch kept in a .7z, of a kind that names no game and with no readme that does: it joins the library later.
  const has7z = fs.existsSync(path.join(ROOT, "bin", "7zr.exe"));
  fs.writeFileSync(path.join(roms, "seven thing.ips"), named);
  fs.writeFileSync(path.join(roms, "who.txt"), "Made by somebody.\r\n");
  const sevenZ = path.join(dir, "(MOD)Hk Seven.7z");
  execFileSync(TAR, ["--format", "7zip", "-cf", sevenZ, "-C", roms, "seven thing.ips", "who.txt"], { windowsHide: true });

  const datDir = path.join(fx, "meta", "no-intro");
  fs.mkdirSync(datDir, { recursive: true });
  const rom = (name, buf) => ["game (", "\tname \"" + name + "\"", "\trom ( name \"" + name + ".nes\" size " + buf.length + " crc " + crc(buf).toUpperCase() + " md5 0 sha1 " + sha1(buf).toUpperCase() + " )", ")"];
  fs.writeFileSync(path.join(datDir, NES + ".dat"), ["clrmamepro (", "\tname \"" + NES + "\"", ")", ""].concat(rom("Hk Base (USA)", A), rom("Hk Base (USA) (Rev 1)", C)).join("\n") + "\n");

  const id = (n) => "xs-scan-hkt-" + n;
  const games = [
    { id: id("base"), title: "Hkt Base", platform: "Nintendo Entertainment System", rom: fileA },
    { id: id("rev"), title: "Hkt Rev", platform: "Nintendo Entertainment System", rom: path.join(dir, "Hk Rev (USA) (Rev 1).nes") },
    { id: id("zip"), title: "Hkt Zipped", platform: "Nintendo Entertainment System", rom: zipB },
    { id: id("patch"), title: "Hkt Patch Only", platform: "Nintendo Entertainment System", rom: zipPatch },
    { id: id("disc"), title: "Hkt A Disc", platform: "Sony Playstation", rom: path.join(roms, "A Disc.bin") },
  ];
  const ask = (n) => api("api/hacks.php?id=" + id(n));
  const row = (list, name) => (list.rows || []).find((r) => r.name === name) || {};
  const tree = () => fs.readdirSync(roms, { recursive: true }).map(String).sort().map((f) => f + ":" + (fs.statSync(path.join(roms, f)).isFile() ? fs.statSync(path.join(roms, f)).mtimeMs + "/" + fs.statSync(path.join(roms, f)).size : "dir"));

  try {
    await api("api/settings.php", { paths: { launchbox: "" } });
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), JSON.stringify(games));
    fs.rmSync(path.join(DATA, "hack-choice.json"), { force: true });
    const untouched = tree();

    /* ---- what fits, and why ----------------------------------------------- */
    let base = await ask("base");
    check("a cartridge game's patches are looked for in the Hack folder beside it",
      [base.ok, base.can, (base.folders || []).map((f) => path.basename(f))], [true, true, ["Hacks"]]);
    check("the ones that fit come first, by name: found loose, in an archive, and as the library's own patch-only file; a file only called a patch is not one",
      (base.rows || []).map((r) => [r.name, r.kind, r.fits]),
      [["Damaged", "BPS", true], ["Hk Base (USA)", "IPS", true], ["Hk Bundle", "xdelta", true], ["Hk Colour Hack", "BPS", true], ["Hk Patch Only", "BPS", true]]);
    check("a BPS is placed by the checksum it carries, an xdelta by the checksum its readme states, an IPS by being named like the game's file",
      [row(base, "Hk Colour Hack").how, row(base, "Hk Patch Only").how, row(base, "Hk Bundle").how, row(base, "Hk Base (USA)").how],
      ["checksum", "checksum", "readme", "name"]);
    check("a patch that names no game and is not named like this one is counted, not listed", base.more, 1);
    check("the same patch kept in two files is listed once", (base.rows || []).some((r) => r.name === "Zz Colour Again"), false);
    check("a patch that does not sum to its own checksum says it is damaged and has no way to play",
      [row(base, "Damaged").sound, row(base, "Damaged").route, /damaged/.test(row(base, "Damaged").why || "")], [false, null, true]);
    const zipped = await ask("zip");
    check("a game inside a .zip is matched by the checksum the zip keeps for it: its UPS fits, the others' patches do not show",
      (zipped.rows || []).map((r) => [r.name, r.kind, r.fits, r.how]), [["Hk Zipped Fix", "UPS", true, "checksum"]]);
    const rev = await ask("rev");
    check("another release of the game lists the patches made for the first, none of them fitting, each saying which release it wants",
      [(rev.rows || []).map((r) => r.name), (rev.rows || []).every((r) => !r.fits && r.route === null), row(rev, "Hk Colour Hack").note],
      [["Damaged", "Hk Bundle", "Hk Colour Hack", "Hk Patch Only"], true, "made for Hk Base (USA); this file is Hk Base (USA) (Rev 1)"]);
    const own = await ask("patch");
    check("the library entry that is only a patch says so, and names the game it plays on",
      [own.can, (own.rows || []).length, (own.own || []).map((o) => [o.name, o.kind, (o.on || {}).id, (o.on || {}).title])],
      [true, 0, [["Hk Patch Only", "BPS", id("base"), "Hkt Base"]]]);
    const disc = await ask("disc");
    check("a disc console is answered in a sentence", [disc.can, /cartridge consoles only for now, and Sony Playstation is not one/.test(disc.why || "")], [false, true]);
    check("an unknown game is refused", (await api("api/hacks.php?id=xs-scan-hkt-nobody")).ok, false);
    check("what was read is kept, so a second look reads no patch again", fs.existsSync(path.join(DATA, "hacks", "index.json")), true);

    /* ---- a game of your own that plays from a game's file ----------------- */
    check("a game that no program of yours plays from lists none", [(base.programs || []).length, (disc.programs || []).length], [0, 0]);
    const ownFile = path.join(DATA, "local-games.json");
    const mine = (() => { try { return JSON.parse(fs.readFileSync(ownFile, "utf8")); } catch (e) { return []; } })();
    const pc = (n, title, run, args) => ({ id: "xs-" + n.repeat(12), title, platform: "Windows", run, args, added: "2026-10-07" });
    fs.writeFileSync(ownFile, JSON.stringify(mine.concat([
      pc("a", "Hkt PC Version", process.execPath, '--rom "' + fileA + '" --scale 3'),
      pc("b", "Hkt Other File", process.execPath, '--rom "' + fileA + '.bak"'),
      pc("c", "Hkt Gone Program", path.join(roms, "gone.exe"), "-rom " + fileA.split(path.sep).join("/").toUpperCase()),
      pc("d", "Hkt Disc Player", process.execPath, "--image=" + path.join(roms, "A Disc.bin")),
      pc("e", "Hkt Unzipped Player", process.execPath, '--scale 3 --rom="' + path.join(roms, "Hk Zipped (USA).nes") + '"'),
    ])));
    base = await ask("base");
    check("a program of yours whose arguments name a game's file is listed for that game: quoted or bare, either slash, any case; a longer file name is another file",
      (base.programs || []).map((p) => [p.id, p.title, p.platform, p.ready, p.how]),
      [["xs-cccccccccccc", "Hkt Gone Program", "Windows", false, "file"], ["xs-aaaaaaaaaaaa", "Hkt PC Version", "Windows", true, "file"]]);
    check("and for no other game", ((await ask("rev")).programs || []).length, 0);
    check("a game kept in a .zip lists the program handed its own unpacked copy of it, known by the checksum; a file of the same size that is another game is not it",
      ((await ask("zip")).programs || []).map((p) => [p.title, p.how]), [["Hkt Unzipped Player", "copy"]]);
    const played = await ask("disc");
    check("a disc game has no patches looked for and still lists the program that plays from its file",
      [played.can, (played.programs || []).map((p) => p.title)], [false, ["Hkt Disc Player"]]);
    check("the patches a game lists are the same with it", (base.rows || []).map((r) => r.name), ["Damaged", "Hk Base (USA)", "Hk Bundle", "Hk Colour Hack", "Hk Patch Only"]);

    /* ---- playing one: patched as the game loads --------------------------- */
    const plain = await api("api/launch.php", { id: id("base"), dry: true });
    const key = (n) => row(base, n).key;
    if (!plain.ok) {
      console.log("    (no emulator starts a Nintendo Entertainment System game here: starting a hack is not checked)");
    } else if (!base.memory) {
      console.log("    (this PC starts Nintendo Entertainment System games in " + plain.via + ", which is not patched in memory: that road is not checked)");
    } else {
      check("where the core takes the game from memory, a hack starts that way", [row(base, "Hk Colour Hack").route, row(base, "Hk Bundle").route], ["memory", "memory"]);
      const m = await api("api/launch.php", { id: id("base"), hack: key("Hk Colour Hack"), dry: true });
      const saves = path.join(DATA, "hacks", "saves", key("Hk Colour Hack"));
      check("RetroArch is handed the patch by name and the game's own file, which is not changed",
        [m.ok, (m.hack || {}).route, m.args.includes('--bps="' + path.join(hacks, "Hk_Colour_Hack.bps") + '"'), m.args.includes('"' + fileA + '"'), /with Hk Colour Hack$/.test(m.via)],
        [true, "memory", true, true, true]);
      check("with saves and save states in a folder of the hack's own, since RetroArch names them after the game",
        [m.append.includes('savefile_directory = "' + saves + '"'), m.append.includes('savestate_directory = "' + saves + '"'),
         m.append.includes('savefiles_in_content_dir = "false"'), m.append.includes('savestates_in_content_dir = "false"'), fs.existsSync(saves)],
        [true, true, true, true, true]);
      check("and nothing of it kept in RetroArch's own settings afterwards", m.append.includes('config_save_on_exit = "false"'), true);
      const z = await api("api/launch.php", { id: id("base"), hack: key("Hk Patch Only"), dry: true });
      const put = path.join(DATA, "hacks", "patches", key("Hk Patch Only") + ".bps");
      check("a patch kept in an archive is put out in Xsegon's own folder for RetroArch, byte for byte",
        [z.ok, z.args.includes('--bps="' + put + '"'), fs.existsSync(put) && fs.readFileSync(put).equals(inside)], [true, true, true]);
      const x = await api("api/launch.php", { id: id("base"), hack: key("Hk Bundle"), dry: true });
      check("an xdelta goes the same way, under its own option", [x.ok, /--xdelta="[^"]+\.xdelta"/.test(x.args)], [true, true]);
      check("a save picked for the game is not loaded into a hack", (await api("api/launch.php", { id: id("base"), hack: key("Hk Colour Hack"), slot: 1, dry: true })).ok, false);
    }

    /* ---- playing one: from a patched copy --------------------------------- */
    const set = await api("api/hacks.php", { id: id("base"), copy: true });
    check("a game's hacks can be set to start from a patched copy, and that is kept",
      [set.ok, set.copy, JSON.parse(fs.readFileSync(path.join(DATA, "hack-choice.json"), "utf8")).copy[id("base")]], [true, true, true]);
    check("then a BPS and an IPS start from a copy, and an xdelta, which only RetroArch can put on, says why it cannot",
      [row(set, "Hk Colour Hack").route, row(set, "Hk Base (USA)").route, row(set, "Hk Bundle").route, /xdelta patch can only be put on as the game loads/.test(row(set, "Hk Bundle").why || "")],
      ["copy", "copy", null, true]);
    if (plain.ok) {
      const c = await api("api/launch.php", { id: id("base"), hack: key("Hk Colour Hack"), dry: true });
      const made = path.join(DATA, "hacks", "made", id("base"), "Hk Colour Hack.nes");
      check("the copy is made in Xsegon's own folder, named for the hack, and is the patched game byte for byte (every BPS command used)",
        [c.ok, (c.hack || {}).route, (c.hack || {}).file, fs.existsSync(made) && fs.readFileSync(made).equals(colourMade)], [true, "copy", made, true]);
      check("the start names the copy in place of the game's file, and adds no save folders: a copy has its own name",
        [c.args.includes('"' + made + '"'), c.args.includes(fileA), (c.append || []).some((l) => /savefile_directory/.test(l))], [true, false, false]);
      const stamp = fs.statSync(made).mtimeMs;
      await api("api/launch.php", { id: id("base"), hack: key("Hk Colour Hack"), dry: true });
      check("a second start uses the copy that is there", fs.statSync(made).mtimeMs, stamp);
      const i = await api("api/launch.php", { id: id("base"), hack: key("Hk Base (USA)"), dry: true });
      check("an IPS is put on the same way, its run of one byte included",
        [i.ok, fs.readFileSync(path.join(DATA, "hacks", "made", id("base"), "Hk Base (USA).nes")).equals(namedMade)], [true, true]);
      await api("api/hacks.php", { id: id("zip"), copy: true });
      const u = await api("api/launch.php", { id: id("zip"), hack: row(zipped, "Hk Zipped Fix").key, dry: true });
      check("a UPS on a game inside a .zip: the game is read out of the zip, and the copy is the patched game",
        [u.ok, fs.readFileSync(path.join(DATA, "hacks", "made", id("zip"), "Hk Zipped Fix.nes")).equals(fixMade)], [true, true]);
      const bad = await api("api/launch.php", { id: id("base"), hack: key("Damaged"), dry: true });
      check("the damaged patch is refused in words, and so is a patch that belongs to another game",
        [bad.ok, /damaged/.test(bad.error || ""), (await api("api/launch.php", { id: id("base"), hack: row(zipped, "Hk Zipped Fix").key, dry: true })).error],
        [false, true, "that patch is not one that fits Hkt Base"]);
    }

    /* ---- an entry that is only a patch: Play starts its game ----------------- */
    if (plain.ok) {
      const t = await api("api/launch.php", { id: id("patch"), dry: true });
      check("Play on the entry that is only a patch starts the game it was made for with the patch, and it is the entry that is named as played",
        [t.ok, t.launched, t.plays, (t.hack || {}).name, (t.hack || {}).kind], [true, "Hkt Patch Only", "Hkt Base", "Hk Patch Only", "bps"]);
      if (!has7z) {
        console.log("    (bin\\7zr.exe is not here: a patch kept in a .7z is not checked)");
      } else {
        fs.rmSync(path.join(DATA, "hack-of.json"), { force: true });
        fs.writeFileSync(path.join(DATA, "scanned-games.json"), JSON.stringify(games.concat([{ id: id("seven"), title: "Hkt Seven Patch", platform: "Nintendo Entertainment System", rom: sevenZ }])));
        const s7 = await ask("seven");
        check("a patch kept in a .7z is read: the entry's file is a patch, of a kind that names no game, so it plays on nothing yet and is in doubt",
          [(s7.own || []).map((o) => [o.name, o.kind, o.on, o.names]), (s7.is || {}).state], [[["Hk Seven", "IPS", null, false]], "ask"]);
        const refused = await api("api/launch.php", { id: id("seven"), dry: true });
        check("Play on it says what it is and what to do, and never hands the emulator an archive with no game in it",
          [refused.ok, refused.error], [false, "Hkt Seven Patch is a patch, not a game. Say in its Hacks tab which game it is a hack of, and Play starts that game with it"]);
        const said = await api("api/hacks.php", { id: id("seven"), hackOf: id("base") });
        check("said to be a hack of a game, it plays on that game", (said.own || []).map((o) => [(o.on || {}).id, o.how]), [[id("base"), "said"]]);
        const row7 = row(await ask("base"), "Hk Seven");
        check("and that game lists it among its patches, as said by you, knowing which entry it is kept in", [row7.fits, row7.how, row7.kind, row7.from], [true, "said", "IPS", id("seven")]);
        const t7 = await api("api/launch.php", { id: id("seven"), dry: true });
        check("Play on it now starts that game with the patch taken out of the .7z",
          [t7.ok, t7.launched, t7.plays, (t7.hack || {}).name, (t7.hack || {}).kind,
           (t7.hack || {}).route !== "copy" || fs.readFileSync(path.join(DATA, "hacks", "made", id("base"), "Hk Seven.nes")).equals(namedMade)],
          [true, "Hkt Seven Patch", "Hkt Base", "Hk Seven", "ips", true]);
        await api("api/hacks.php", { id: id("seven"), unsettle: true });
        fs.writeFileSync(path.join(DATA, "scanned-games.json"), JSON.stringify(games));
      }
    }
    check("through all of it nothing in the games folder was written, changed or added", tree(), untouched);

    /* ---- the tab, in the page ---------------------------------------------- */
    await api("api/hacks.php", { id: id("base"), copy: false });
    base = await ask("base");
    const TABS = `[...document.querySelectorAll("#details .dtabs .dtab")]`;
    const tabOn = `(t => (t ? t.textContent : null))(${TABS}.find((x) => x.classList.contains("on")))`;
    const legend = `[...document.querySelectorAll("#help .hitem .hl")].map((x) => x.textContent)`;
    // The patches and the games: what the game itself is said to be has rows of its own (tests\t-hackof.js).
    const ROWS = `[...document.querySelectorAll("#details .dtab-pane.is-hacks .hck-row:not(.hck-is)")]`;
    const names = `${ROWS}.map((r) => r.querySelector(".cr-name").textContent)`;
    const details = async (n) => {
      const there = await b.ev(`(async () => { const S = await import("/js/state.js"), V = await import("/js/views.js");
        const i = S.games.findIndex(g => g.id === ${JSON.stringify(id(n))}); if (i < 0) { return false; } S.setSel(i); V.render(); return true; })()`);
      check("the game is on the list (" + n + ")", there, true);
      await b.settled();
      await b.key("i");
      await b.waitFor(`!document.getElementById("details").hidden && !!document.querySelector("#details .dtabs")`, 8000);
      await b.clickSel(`#details .dtab[data-tab="hacks"]`);
      await b.until(tabOn, "Hacks", 4000);
    };
    const back = async () => { await b.key("Escape"); await b.until(`document.getElementById("details").hidden`, true, 6000); };
    await b.goto();
    await b.setView("list");
    await b.openPlatform("Nintendo Entertainment System");
    await b.ev(`(() => { window.__realFetch = window.fetch; window.__launches = []; window.fetch = function (u, o) {
        if (String(u).indexOf("api/launch.php") >= 0) { window.__launches.push(JSON.parse(o.body)); return Promise.resolve(new Response(JSON.stringify({ ok: true, launched: "stub", via: "stub" }), { headers: { "Content-Type": "application/json" } })); }
        return window.__realFetch(u, o); }; })()`);
    try {
      await details("base");
      check("details has a Hacks tab, after Cheats", await b.ev(`${TABS}.map((x) => x.textContent.replace(/ \\(\\d+\\)$/, "")).slice(-4, -2)`), ["Cheats", "Hacks"]);
      const want = (base.memory ? ["Starts patched as the game loads"] : []).concat(["Damaged", "Hk Base (USA)", "Hk Bundle", "Hk Colour Hack", "Hk Patch Only", "Hkt Gone Program", "Hkt PC Version"]);
      check("it lists the patches that fit" + (base.memory ? ", under the row that says how they start" : "") + ", and last the games of your own that play from its file", await b.until(names, want, 9000), want);
      const rowOf = (n) => `${ROWS}.find((r) => r.querySelector(".cr-name").textContent === ${JSON.stringify(n)})`;
      check("a game of your own says it is started with this game's file, and where it is filed; one whose program is gone is to look at",
        [await b.ev(`(r => [r.querySelector(".hck-sub").textContent, r.querySelector(".cr-tag").textContent, r.classList.contains("ro")])(${rowOf("Hkt PC Version")})`),
         await b.ev(`(r => [r.querySelector(".hck-sub").textContent, r.classList.contains("ro")])(${rowOf("Hkt Gone Program")})`)],
        [["a game of your own, started with this game's file", "Windows", false], ["a game of your own; its program is not there to start", true]]);
      check("each saying why it fits, and where the patch is",
        await b.ev(`(r => [r.querySelector(".hck-sub").textContent, /^BPS  ·  Hacks.Hk_Colour_Hack\\.bps$/.test(r.querySelector(".cr-tag").textContent)])(${ROWS}.find((r) => r.querySelector(".cr-name").textContent === "Hk Colour Hack"))`),
        ["fits this file, by the checksum the patch carries", true]);
      check("with where it looked and what it passed over under the list",
        await b.ev(`(t => [/the Hacks folder of Nintendo Entertainment System/.test(t), /1 patch there names no game/.test(t)])(document.querySelector("#details .dtab-pane.is-hacks .mt-note").textContent)`), [true, true]);
      await b.shot("details-tab-hacks");
      if (base.memory) {
        await b.ev(`document.querySelector("#details .hck-route").click()`);
        check("a press on the row above changes how they start, kept there and then",
          [await b.until(`(document.querySelector("#details .hck-route .cr-name") || {}).textContent`, "Starts from a patched copy", 6000), (await ask("base")).copy],
          ["Starts from a patched copy", true]);
        check("and the xdelta, which cannot start from a copy, now says so on its row",
          await b.ev(`/cannot be played: an xdelta patch/.test(${ROWS}.find((r) => r.querySelector(".cr-name").textContent === "Hk Bundle").querySelector(".hck-sub").textContent)`), true);
        await b.ev(`document.querySelector("#details .hck-route").click()`);
        await b.until(`(document.querySelector("#details .hck-route .cr-name") || {}).textContent`, "Starts patched as the game loads", 6000);
      }
      await b.key("ArrowDown");
      check("Down goes into the list, and the legend says what a press there does",
        [await b.until(`document.querySelector("#details .dtab-pane").classList.contains("in")`, true, 3000), await b.until(`${legend}.includes(${JSON.stringify(base.memory ? "change" : "play with it")})`, true, 3000)], [true, true]);
      await b.ev(`${ROWS}.find((r) => r.querySelector(".cr-name").textContent === "Hk Colour Hack").click()`);
      check("a press on a patch that fits starts the game with it, and closes details",
        [await b.until(`JSON.stringify(window.__launches)`, JSON.stringify([{ id: id("base"), hack: key("Hk Colour Hack") }]), 6000), await b.until(`document.getElementById("details").hidden`, true, 6000)],
        [JSON.stringify([{ id: id("base"), hack: key("Hk Colour Hack") }]), true]);
      check("the bottom line names the hack while it starts", await b.until(`/running: stub/.test(document.getElementById("strip").textContent)`, true, 6000), true);
      await sleep(300);

      await b.ev(`window.__launches = []`);
      await details("base");
      await b.until(names, want, 9000);
      await b.ev(`${rowOf("Hkt Gone Program")}.click()`);
      await sleep(300);
      check("a press on the one whose program is gone starts nothing", [await b.ev(`window.__launches.length`), await b.ev(`document.getElementById("details").hidden`)], [0, false]);
      await b.ev(`${rowOf("Hkt PC Version")}.click()`);
      check("a press on a game of your own starts it, as itself, and closes details",
        [await b.until(`JSON.stringify(window.__launches)`, JSON.stringify([{ id: "xs-aaaaaaaaaaaa" }]), 6000), await b.until(`document.getElementById("details").hidden`, true, 6000)],
        [JSON.stringify([{ id: "xs-aaaaaaaaaaaa" }]), true]);
      await sleep(300);

      await b.ev(`window.__launches = []`);
      await details("rev");
      check("another release lists the patches made for the first, to look at: each says which release it wants",
        [await b.until(names, ["Damaged", "Hk Bundle", "Hk Colour Hack", "Hk Patch Only"], 9000),
         await b.ev(`${ROWS}.every((r) => r.classList.contains("ro"))`),
         await b.ev(`${ROWS}[2].querySelector(".hck-sub").textContent`)],
        [["Damaged", "Hk Bundle", "Hk Colour Hack", "Hk Patch Only"], true, "made for Hk Base (USA); this file is Hk Base (USA) (Rev 1)"]);
      await b.ev(`${ROWS}[2].click()`);
      await sleep(300);
      check("and a press on one starts nothing", [await b.ev(`window.__launches.length`), await b.ev(`document.getElementById("details").hidden`)], [0, false]);
      await back();

      await details("patch");
      check("the entry that is only a patch says why Play cannot start it, and offers the game it plays on",
        [await b.until(names, ["Hk Patch Only"], 9000), await b.ev(`[...document.querySelectorAll("#details .dtab-pane.is-hacks .group-help")].some((x) => /is a patch and no game/.test(x.textContent))`),
         await b.ev(`${ROWS}[0].querySelector(".hck-sub").textContent`)],
        [["Hk Patch Only"], true, "plays on Hkt Base, which it fits by its checksum"]);
      await b.ev(`${ROWS}[0].click()`);
      check("a press there starts that game with the patch",
        await b.until(`JSON.stringify(window.__launches)`, JSON.stringify([{ id: id("base"), hack: key("Hk Patch Only") }]), 6000),
        JSON.stringify([{ id: id("base"), hack: key("Hk Patch Only") }]));
      await sleep(300);

      await details("zip");
      const progs = `${ROWS}.filter((r) => r.classList.contains("hck-prog")).map((r) => r.querySelector(".cr-name").textContent + ": " + r.querySelector(".hck-sub").textContent)`;
      check("a zipped game's tab says the game of your own plays from its own copy of the file",
        await b.until(progs, ["Hkt Unzipped Player: a game of your own, started with its own copy of this game's file"], 9000),
        ["Hkt Unzipped Player: a game of your own, started with its own copy of this game's file"]);
      await back();

      await b.openPlatform("Sony Playstation");
      await details("disc");
      check("a disc game's tab is the game of your own that plays from its file, with why no patches are looked for under it",
        [await b.until(names, ["Hkt Disc Player"], 9000),
         await b.ev(`/^A game of your own plays from this game's file/.test(document.querySelector("#details .dtab-pane.is-hacks .group-help").textContent)`),
         await b.ev(`/cartridge consoles only for now/.test(document.querySelector("#details .dtab-pane.is-hacks .mt-note").textContent)`)],
        [["Hkt Disc Player"], true, true]);
      await back();
    } finally {
      await b.ev(`window.fetch = window.__realFetch`);
    }
    check("no script errors through any of it", await b.ev(`(window.__errs || []).length`), 0);
  } finally {
    await api("api/settings.php", { paths: { launchbox: before.paths.launchbox } });
    kept.restore();
    fs.rmSync(roms, { recursive: true, force: true });
    fs.rmSync(path.join(DATA, "hacks"), { recursive: true, force: true });
  }
};
