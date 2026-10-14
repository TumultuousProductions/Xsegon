/*  Which game a hack is a hack of (includes\hackof.php, api\hacks.php,
    js\hacksettle.js, js\hackstab.js): the games that may be hacks, the game
    Xsegon names for each, and what is said of them.
    Stand-in games and lists of known releases only: no real game is read,
    nothing reaches libretro, every start is a stub, LaunchBox is off. */
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { api, DATA, Guard, sleep } = require("./lib");

const NES = "Nintendo - Nintendo Entertainment System", SNES = "Nintendo - Super Nintendo Entertainment System", N64 = "Nintendo - Nintendo 64";
const sum = (algo, b) => crypto.createHash(algo).update(b).digest("hex").toUpperCase();
function bytes(seed, n) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) { b[i] = (i * 37 + seed * 13 + (i >> 6)) & 255; }
  return b;
}
function list(fx, sys, roms) {
  const dir = path.join(fx, "meta", "no-intro");
  fs.mkdirSync(dir, { recursive: true });
  const out = ["clrmamepro (", "\tname \"" + sys + "\"", ")", ""];
  for (const [name, b, serial] of roms) {
    out.push("game (", "\tname \"" + name.replace(/\.[a-z0-9]+$/, "") + "\"",
      "\trom ( name \"" + name + "\" size " + b.length + " crc 00000000 md5 " + sum("md5", b) + " sha1 " + sum("sha1", b) + (serial ? " serial \"" + serial + "\"" : "") + " )", ")");
  }
  fs.writeFileSync(path.join(dir, sys + ".dat"), out.join("\n") + "\n");
}

module.exports = async function (b, check) {
  const fx = path.join(DATA, "fixtures", "libretro");
  if (!fs.existsSync(fx)) {
    check("hackof: runs only on the test server's own copy (never against libretro itself)", true, true);
    return;
  }
  const kept = new Guard(["scanned-games.json", "filecheck.json", "local-games.json", "hack-of.json"]);
  const before = (await api("api/settings.php")).settings;
  const roms = path.join(DATA, "fixtures", "hackof-roms");
  fs.rmSync(roms, { recursive: true, force: true });
  fs.rmSync(path.join(DATA, "hacks"), { recursive: true, force: true });
  fs.mkdirSync(path.join(roms, "nes", "Hacks"), { recursive: true });
  for (const f of fs.existsSync(path.join(DATA, "libretro")) ? fs.readdirSync(path.join(DATA, "libretro")) : []) {
    if (/\.(releases|crcs)\.json$/.test(f)) { fs.rmSync(path.join(DATA, "libretro", f), { force: true }); }
  }

  /* ---- the stand-in games ------------------------------------------------ */
  const head = Buffer.from([0x4E, 0x45, 0x53, 0x1A, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const nes = (seed) => Buffer.concat([head, bytes(seed, 16384)]);
  const file = (rel, buf) => { const p = path.join(roms, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); return p; };
  const snes = (seed, title) => {
    const s = bytes(seed, 32768);
    s.write(title.padEnd(21), 0x7FC0, "latin1");
    s[0x7FD5] = 0x20; s[0x7FD9] = 0x01;
    s.writeUInt16LE(0xEDCB, 0x7FDC); s.writeUInt16LE(0x1234, 0x7FDE);
    return s;
  };
  const n64 = (seed, code) => {
    const z = bytes(seed, 4096);
    Buffer.from([0x80, 0x37, 0x12, 0x40]).copy(z, 0);
    z.write("HKO SIXTY FOUR".padEnd(20), 0x20, "latin1");
    z.write(code, 0x3B, "latin1");
    return z;
  };
  const quest = file("nes/Hko Quest (USA).nes", nes(1));
  const kart = snes(11, "HKO KART"), kartHack = Buffer.from(kart); kartHack[0x100] ^= 0xFF;
  const sixty = n64(21, "NHKE"), sixtyHack = Buffer.from(sixty); sixtyHack[0x800] ^= 0xFF;
  const goneHack = n64(22, "NGOE"); goneHack[0x900] ^= 0xFF;
  list(fx, NES, [["Hko Quest (USA).nes", nes(1)], ["Hko Quest II (USA).nes", nes(2)]]);
  list(fx, SNES, [["Hko Kart (USA).sfc", kart]]);
  list(fx, N64, [["Hko Sixty Four (USA).z64", sixty, "NHKE"], ["Hko Gone Game (USA).z64", n64(22, "NGOE"), "NGOE"]]);

  const id = (n) => "xs-scan-hko-" + n;
  const PN = "Nintendo Entertainment System", PS = "Super Nintendo Entertainment System", P64 = "Nintendo 64", PX = "Sony Playstation";
  const games = [
    { id: id("quest"), title: "Hko Quest", platform: PN, rom: quest },
    { id: id("quest2"), title: "Hko Quest II", platform: PN, rom: file("nes/Hko Quest II (USA).nes", nes(2)) },
    { id: id("two"), title: "Hko Quest - Two Players", platform: PN, rom: file("nes/Hacks/Hko Quest - Two Players (v1).nes", nes(3)) },
    { id: id("hard"), title: "Hko Quest II Hard Mode", platform: PN, rom: file("nes/Hko Quest II Hard Mode [h1].nes", nes(4)) },
    { id: id("mystery"), title: "Zzz Mystery", platform: PN, rom: file("nes/Zzz Mystery.nes", nes(5)) },
    { id: id("rus"), title: "Hko Quest in Russian", platform: PN, rom: file("nes/Hko Quest (U) [T+Rus Somebody].nes", nes(6)) },
    { id: id("kart"), title: "Hko Kart", platform: PS, rom: file("snes/Hko Kart (USA).sfc", kart) },
    { id: id("karthack"), title: "Turbo Circuit", platform: PS, rom: file("snes/Turbo Circuit.sfc", kartHack) },
    { id: id("sixty"), title: "Hko Sixty Four", platform: P64, rom: file("n64/Hko Sixty Four (USA).z64", sixty) },
    { id: id("remix"), title: "Sixty Remix", platform: P64, rom: file("n64/Sixty Remix.z64", sixtyHack) },
    { id: id("orphan"), title: "Orphan Remix", platform: P64, rom: file("n64/Orphan Remix.z64", goneHack) },
    { id: id("racer"), title: "Hko Racer", platform: PX, rom: file("psx/Hko Racer.bin", bytes(31, 4096)) },
    { id: id("coop"), title: "Hko Racer - Co-Op Mod", platform: PX, rom: file("psx/Hko Racer - Co-Op Mod.bin", bytes(32, 4096)) },
  ];
  // Two files the scan adds later: one no list knows, and one that is a known release under another name.
  const fresh = file("nes/Brand New Remix.nes", nes(9)), again = file("nes/Quest Again.nes", nes(1));
  // And two more of the same kinds, for a scan that adds four at once.
  const fresh2 = file("nes/Second New Remix.nes", nes(10)), again2 = file("nes/Quest Two Again.nes", nes(2));
  const own = [
    { id: "xs-aaaaaaaaaaaa", title: "Hko Quest PC", platform: PN, run: process.execPath, args: '--rom "' + quest + '"', added: "2026-10-07" },
    { id: "xs-bbbbbbbbbbbb", title: "Hko Windows Game", platform: "Windows", run: process.execPath, added: "2026-10-07" },
  ];
  const ask = (n) => api("api/hacks.php?id=" + (/^xs-/.test(n) ? n : id(n)));
  const say = (n, what) => api("api/hacks.php", Object.assign({ id: /^xs-/.test(n) ? n : id(n) }, what));
  const rows = async () => { const out = {}; for (const p of [PN, PS, P64, PX, "Windows"]) { for (const g of (await api("api/library.php?platform=" + encodeURIComponent(p))).games || []) { out[g.id] = g.hack || null; } } return out; };
  const stored = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, "hack-of.json"), "utf8")); } catch (e) { return {}; } };
  const tree = () => fs.readdirSync(roms, { recursive: true }).map(String).sort().map((f) => f + ":" + (fs.statSync(path.join(roms, f)).isFile() ? fs.statSync(path.join(roms, f)).mtimeMs + "/" + fs.statSync(path.join(roms, f)).size : "dir"));

  try {
    await api("api/settings.php", { paths: { launchbox: "" } });
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), JSON.stringify(games));
    fs.writeFileSync(path.join(DATA, "local-games.json"), JSON.stringify(own));
    fs.rmSync(path.join(DATA, "filecheck.json"), { force: true });
    fs.rmSync(path.join(DATA, "hack-of.json"), { force: true });
    const untouched = tree();

    /* ---- before any file is checked: the name and the folder --------------- */
    let marks = await rows();
    check("before a file is checked, one named or filed as a hack is in doubt, and so is a game of your own in a console's list; the rest wear nothing",
      [marks[id("two")], marks[id("hard")], marks[id("coop")], marks["xs-aaaaaaaaaaaa"], marks[id("quest")], marks[id("mystery")], marks[id("rus")], marks[id("racer")], marks["xs-bbbbbbbbbbbb"]],
      ["ask", "ask", "ask", "ask", null, null, null, null, null]);

    /* ---- once checked: what is no known release ---------------------------- */
    const cart = games.filter((g) => g.platform !== PX).map((g) => g.id);
    for (let left = cart, i = 0; left.length && i < 50; i++) { left = (await api("api/filecheck.php", { ids: left })).left || []; }
    marks = await rows();
    check("checked: a file that is no known release is in doubt, a known release and a translation are not",
      [marks[id("mystery")], marks[id("karthack")], marks[id("remix")], marks[id("orphan")], marks[id("two")], marks[id("quest")], marks[id("quest2")], marks[id("kart")], marks[id("sixty")], marks[id("rus")]],
      ["ask", "ask", "ask", "ask", "ask", null, null, null, null, null]);
    const lib = await api("api/library.php?platform=" + encodeURIComponent(PN));
    check("the library says how many wait in all", lib.hackAsk, 8);

    /* ---- the game Xsegon names for each ------------------------------------ */
    const settle = await api("api/hacks.php?settle=1");
    const sug = (n) => { const r = (settle.games || []).find((x) => x.id === (/^xs-/.test(n) ? n : id(n))) || {}; return r.suggest ? [r.suggest.id, r.suggest.title, r.suggest.why] : null; };
    check("every game in doubt is listed to settle, by console and name", [settle.ok, settle.count, (settle.games || []).map((g) => g.title)],
      [true, 8, ["Orphan Remix", "Sixty Remix", "Hko Quest - Two Players", "Hko Quest II Hard Mode", "Hko Quest PC", "Zzz Mystery", "Hko Racer - Co-Op Mod", "Turbo Circuit"]]);
    check("named by the code its cartridge carries, when the release with that code is in the library", sug("remix"),
      [id("sixty"), "Hko Sixty Four", "its cartridge carries the code of Hko Sixty Four (USA)"]);
    check("and named all the same when that release is not in the library: no game to stand under", sug("orphan"),
      ["", "Hko Gone Game", "its cartridge carries the code of Hko Gone Game (USA), which is not in the library"]);
    check("named by what its cartridge header says", sug("karthack"), [id("kart"), "Hko Kart", "its cartridge header says HKO KART"]);
    check("named by its own name, the longest that fits: a hack of the second game is not put under the first",
      [sug("two"), sug("hard")], [[id("quest"), "Hko Quest", "it is named like that game"], [id("quest2"), "Hko Quest II", "it is named like that game"]]);
    check("a disc game, which no list can check, is named by its name too", sug("coop"), [id("racer"), "Hko Racer", "it is named like that game"]);
    check("a game of your own is named for the game whose file it is started with", sug("xs-aaaaaaaaaaaa"), [id("quest"), "Hko Quest", "it is started with that game's file"]);
    check("and where nothing names a game, none is named", sug("mystery"), null);
    const bases = (await api("api/hacks.php?id=" + id("mystery") + "&bases=1")).bases || [];
    check("the games to pick from are the console's own that are no hack and not in doubt", bases.map((x) => x.title), ["Hko Quest", "Hko Quest II", "Hko Quest in Russian"]);

    /* ---- saying it ---------------------------------------------------------- */
    const yes = await say("two", { hackOf: id("quest") });
    check("said to be a hack of a game: kept, the mark is a hack's, and one fewer waits",
      [yes.ok, (yes.is || {}).state, ((yes.is || {}).of || {}).title, yes.mark, yes.asking, (stored()[id("two")] || {}).is, (stored()[id("two")] || {}).of],
      [true, "hack", "Hko Quest", "yes", 7, "hack", id("quest")]);
    check("the game it comes from lists it among its hacks", ((await ask("quest")).hacks || []).map((h) => [h.id, h.title, h.ready !== undefined]), [[id("two"), "Hko Quest - Two Players", true]]);
    const gone = await say("orphan", { hackOf: "" });
    check("a hack of a game that is not in the library wears the mark and stands under none", [gone.ok, (gone.is || {}).state, (gone.is || {}).of, gone.mark], [true, "hack", null, "yes"]);
    const no = await say("mystery", { notHack: true });
    check("said to be no hack: no mark, and not asked about again",
      [no.ok, (no.is || {}).state, no.mark, ((await api("api/hacks.php?settle=1")).games || []).some((g) => g.id === id("mystery"))], [true, "not", null, false]);
    const back = await say("mystery", { unsettle: true });
    check("taken back, it is in doubt again", [back.ok, (back.is || {}).state, back.mark, (id("mystery") in stored())], [true, "ask", "ask", false]);
    check("refused: a hack of itself, of a game that is not there, and of a game of your own",
      [(await say("two", { hackOf: id("two") })).ok, (await say("two", { hackOf: "xs-scan-hko-nobody" })).ok, (await say("two", { hackOf: "xs-aaaaaaaaaaaa" })).ok, (await say("two", {})).ok],
      [false, false, false, false]);
    check("a known release is not asked about at all", [((await ask("quest")).is || {}).may, ((await ask("quest")).is || {}).state], [false, null]);
    marks = await rows();
    check("the lists carry all of it", [marks[id("two")], marks[id("orphan")], marks[id("mystery")], marks[id("hard")]], ["yes", "yes", "ask", "ask"]);

    /* ---- a new file, as the scan adds it -------------------------------------- */
    const acc = await api("api/scan.php", { action: "accept", games: [
      { id: id("fresh"), title: "Brand New Remix", platform: PN, rom: fresh }, { id: id("again"), title: "Quest Again", platform: PN, rom: again }] });
    const checked = JSON.parse(fs.readFileSync(path.join(DATA, "filecheck.json"), "utf8"));
    check("a cartridge is checked as the scan adds it: one that is no known release is in doubt from the start and the scan says so, a known release is not",
      [acc.ok, acc.added, acc.mayBeHacks, (checked[id("fresh")] || {}).kind, (checked[id("again")] || {}).kind, (await rows())[id("fresh")], (await rows())[id("again")]],
      [true, 2, 1, "unknown", "known", "ask", null]);
    await api("api/scan.php", { action: "remove", id: id("fresh") });
    await api("api/scan.php", { action: "remove", id: id("again") });
    /* Three or more at once are looked up in one read of the list, one or two
       each alone: both ways must give the same answers. */
    const four = ["fresh", "again", "fresh2", "again2"];
    const acc4 = await api("api/scan.php", { action: "accept", games: [
      { id: id("fresh"), title: "Brand New Remix", platform: PN, rom: fresh }, { id: id("again"), title: "Quest Again", platform: PN, rom: again },
      { id: id("fresh2"), title: "Second New Remix", platform: PN, rom: fresh2 }, { id: id("again2"), title: "Quest Two Again", platform: PN, rom: again2 }] });
    const checked4 = JSON.parse(fs.readFileSync(path.join(DATA, "filecheck.json"), "utf8"));
    const rows4 = await rows();
    const said = ((await api("api/log.php?tail=300")).lines || []).filter((l) => / S HACK of the \d+ games? just added/.test(l)).slice(-2);
    check("four added at once get the answers the two got alone, and the log says how each lot was read and how long it took",
      [acc4.ok, acc4.added, acc4.mayBeHacks, four.map((n) => (checked4[id(n)] || {}).kind), four.map((n) => rows4[id(n)]),
       / of the 2 games just added, 2 checked as they came in, 1 may be hacks: looked at in \d+ms, each game read alone$/.test(said[0] || ""),
       / of the 4 games just added, 4 checked as they came in, 2 may be hacks: looked at in \d+ms, the list read once$/.test(said[1] || "")],
      [true, 4, 2, ["unknown", "known", "unknown", "known"], ["ask", null, "ask", null], true, true]);
    for (const n of four) { await api("api/scan.php", { action: "remove", id: id(n) }); }
    check("nothing in the games folder was written, changed or added", tree(), untouched);

    /* ---- in the page --------------------------------------------------------- */
    const TABS = `[...document.querySelectorAll("#details .dtabs .dtab")]`;
    const tabOn = `(t => (t ? t.textContent : null))(${TABS}.find((x) => x.classList.contains("on")))`;
    const IS = `[...document.querySelectorAll("#details .dtab-pane.is-hacks .hck-row.hck-is")]`;
    const isNames = `${IS}.map((r) => r.querySelector(".cr-name").textContent)`;
    const badge = (title) => `(r => r ? [...r.querySelectorAll(".bdg .b-hack, .bdg .b-hackq")].map((x) => x.textContent).join(",") : "no row")([...document.querySelectorAll("#view .row")].find((r) => [...((r.querySelector(".c-title") || {}).childNodes || [])].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("") === ${JSON.stringify(title)}))`;
    const details = async (gid) => {
      const there = await b.ev(`(async () => { const S = await import("/js/state.js"), V = await import("/js/views.js");
        const i = S.games.findIndex(g => g.id === ${JSON.stringify(gid)}); if (i < 0) { return false; } S.setSel(i); V.render(); return true; })()`);
      check("the game is on the list (" + gid.replace("xs-scan-hko-", "") + ")", there, true);
      await b.settled();
      await b.key("i");
      await b.waitFor(`!document.getElementById("details").hidden && !!document.querySelector("#details .dtabs")`, 8000);
      await b.clickSel(`#details .dtab[data-tab="hacks"]`);
      await b.until(tabOn, "Hacks", 4000);
    };
    const leave = async () => { await b.key("Escape"); await b.until(`document.getElementById("details").hidden`, true, 6000); };
    await b.goto();
    await b.setView("list");
    await b.openPlatform(PN);
    await b.ev(`(() => { window.__realFetch = window.fetch; window.__launches = []; window.fetch = function (u, o) {
        if (String(u).indexOf("api/launch.php") >= 0) { window.__launches.push(JSON.parse(o.body)); return Promise.resolve(new Response(JSON.stringify({ ok: true, launched: "stub", via: "stub" }), { headers: { "Content-Type": "application/json" } })); }
        return window.__realFetch(u, o); }; })()`);
    try {
      check("in the list a hack wears Hack, a game in doubt Hack?, and a real game neither",
        [await b.until(badge("Hko Quest - Two Players"), "HACK", 6000), await b.ev(badge("Hko Quest II Hard Mode")), await b.ev(badge("Hko Quest"))], ["HACK", "HACK?", ""]);
      check("the page knows how many wait, for the Games menu", await b.ev(`import("/js/hacksettle.js").then((m) => m.hackAsking())`), 6);

      await details(id("hard"));
      check("a game in doubt opens its Hacks tab on the choices, the game Xsegon names first",
        await b.until(isNames, ["Yes, a hack of Hko Quest II", "A hack of another game…", "A hack of a game that is not in the library", "Not a hack"], 9000),
        ["Yes, a hack of Hko Quest II", "A hack of another game…", "A hack of a game that is not in the library", "Not a hack"]);
      check("with why it names that game", await b.ev(`${IS}[0].querySelector(".hck-sub").textContent`), "Xsegon's reading: it is named like that game");
      await b.shot("details-tab-hacks-in-doubt");
      await b.ev(`${IS}[0].click()`);
      check("a press on Yes keeps it: the tab says what it is, and the list behind wears Hack at once",
        [await b.until(isNames, ["A hack of Hko Quest II"], 6000), (stored()[id("hard")] || {}).of, await b.until(badge("Hko Quest II Hard Mode"), "HACK", 6000)],
        [["A hack of Hko Quest II"], id("quest2"), "HACK"]);
      await b.ev(`${IS}[0].click()`);
      check("a press on what was said opens the choices again, with a way to take it back",
        await b.until(`${isNames}.slice(-1)`, ["Take back what was said"], 6000), ["Take back what was said"]);
      await leave();

      await details(id("mystery"));
      await b.until(isNames, ["Pick the game it is a hack of…", "A hack of a game that is not in the library", "Not a hack"], 9000);
      await b.ev(`${IS}[0].click()`);
      const BASES = `[...document.querySelectorAll("#details .dtab-pane.is-hacks .hck-base")].map((r) => r.querySelector(".cr-name").textContent)`;
      check("where no game is named, Pick the game lists the console's games to choose from", await b.until(BASES, ["Hko Quest", "Hko Quest II", "Hko Quest in Russian"], 9000), ["Hko Quest", "Hko Quest II", "Hko Quest in Russian"]);
      await b.ev(`(() => { const x = document.querySelector("#details .dtab-pane.is-hacks .ch-find input"); x.value = "russian"; x.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      check("and the find box narrows it", await b.until(BASES, ["Hko Quest in Russian"], 4000), ["Hko Quest in Russian"]);
      await b.ev(`document.querySelector("#details .dtab-pane.is-hacks .hck-base").click()`);
      check("a press on one says it", [await b.until(isNames, ["A hack of Hko Quest in Russian"], 6000), (stored()[id("mystery")] || {}).of], [["A hack of Hko Quest in Russian"], id("rus")]);
      await leave();

      await details(id("quest"));
      const GAMES = `[...document.querySelectorAll("#details .dtab-pane.is-hacks .hck-row.hck-game")]`;
      check("the game it comes from lists the hack in its own Hacks tab, as a game in the library",
        [await b.until(`${GAMES}.map((r) => r.querySelector(".cr-name").textContent)`, ["Hko Quest - Two Players"], 9000), await b.ev(`${GAMES}[0].querySelector(".hck-sub").textContent`)],
        [["Hko Quest - Two Players"], "a game in your library, said to be a hack of this one"]);
      check("a known release is not asked what it is", await b.ev(isNames), []);
      await b.shot("details-tab-hacks-of-this-game");
      await b.ev(`${GAMES}[0].click()`);
      check("a press there plays the hack, as the game it is, and closes details",
        [await b.until(`JSON.stringify(window.__launches)`, JSON.stringify([{ id: id("two") }]), 6000), await b.until(`document.getElementById("details").hidden`, true, 6000)],
        [JSON.stringify([{ id: id("two") }]), true]);
      await sleep(300);

      /* ---- Games > Hacks to settle ------------------------------------------- */
      await b.ev(`import("/js/hacksettle.js").then((m) => m.openHackSettle())`);
      const CARDS = `[...document.querySelectorAll("#editor .hs-card")]`;
      check("Hacks to settle lists the games still in doubt, with what Xsegon names for each",
        [await b.until(`${CARDS}.map((c) => c.querySelector(".hs-t").textContent)`, ["Sixty Remix", "Hko Quest PC", "Hko Racer - Co-Op Mod", "Turbo Circuit"], 9000),
         await b.ev(`document.querySelector("#editor .rp-verdict").textContent`),
         await b.ev(`${CARDS}[0].querySelector(".hs-why").textContent`)],
        [["Sixty Remix", "Hko Quest PC", "Hko Racer - Co-Op Mod", "Turbo Circuit"], "4 games wait for your word.",
         "Looks like a hack of Hko Sixty Four: its cartridge carries the code of Hko Sixty Four (USA)."]);
      await b.shot("hacks-to-settle");
      await b.ev(`${CARDS}[1].querySelector(".hs-yes").click()`);
      check("Yes on a card keeps it and the card goes; the game of your own on the list behind wears Hack",
        [await b.until(`${CARDS}.length`, 3, 6000), (stored()["xs-aaaaaaaaaaaa"] || {}).of, await b.until(badge("Hko Quest PC"), "HACK", 6000)], [3, id("quest"), "HACK"]);
      await b.ev(`${CARDS}[2].querySelector(".hs-other").click()`);
      check("Another game opens the console's games under the card",
        await b.until(`[...document.querySelectorAll("#editor .hs-card .hs-base")].map((x) => x.textContent)`, ["Hko Kart"], 6000), ["Hko Kart"]);
      await b.ev(`${CARDS}[2].querySelector(".hs-not").click()`);
      check("Not a hack takes a card away for good", [await b.until(`${CARDS}.length`, 2, 6000), (stored()[id("karthack")] || {}).is], [2, "not"]);
      check("and the count the Games menu shows follows", await b.ev(`import("/js/hacksettle.js").then((m) => m.hackAsking())`), 2);
      await b.key("Escape");
      await b.until(`document.getElementById("editor").hidden`, true, 6000);
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
