/* The Homebrew page (js/homebrew.js, api/homebrew.php): every game names who made it, only a
   listed team's or jam's place can be opened, Get takes the team's release or the jam's copy and
   checks what came, ares comes only when asked and takes no console over, and the page is a card
   on the consoles screen, an entry in the Games menu and a way out of an empty library. A list of
   the test's own (data/homebrew.json, read only by a test copy) and stand-ins under
   data\fan-fixtures\remote answer in place of the internet. */

"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { api, apiUntil, BASE, DATA, Guard, ROOT } = require("./lib");

const N64 = "Nintendo 64";
const hash = (alg, b) => crypto.createHash(alg).update(b).digest("hex");

// A stand-in ROM: a .z64's own first bytes, and bytes of its own after them.
function rom(seed) {
  const b = Buffer.alloc(4096, seed);
  b.writeUInt32BE(0x80371240, 0);
  return b;
}

// A zip of the files named, stored whole: as much as xs_fm_unpack needs.
function zipOf(files) {
  const heads = [], rows = [];
  let at = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name), crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(n.length, 26);
    heads.push(head, n, data);
    const row = Buffer.alloc(46);
    row.writeUInt32LE(0x02014b50, 0);
    row.writeUInt16LE(20, 4);
    row.writeUInt16LE(20, 6);
    row.writeUInt32LE(crc, 16);
    row.writeUInt32LE(data.length, 20);
    row.writeUInt32LE(data.length, 24);
    row.writeUInt16LE(n.length, 28);
    row.writeUInt32LE(at, 42);
    rows.push(row, n);
    at += head.length + n.length + data.length;
  }
  const dir = Buffer.concat(rows), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(at, 16);
  return Buffer.concat([...heads, dir, end]);
}

module.exports = async function (b, check) {
  const kept = new Guard(["homebrew.json", "homebrew-got.json", "homebrew-job.json", "scanned-games.json", "emulators.json", "emu-choice.json",
                          "overrides.json", "settings.json", "changed.json", "news.json", "hidden.json"]);
  const fix = path.join(DATA, "fan-fixtures"), games = path.join(DATA, "homebrew-games"), aresDir = path.join(DATA, "emulators", "ares");
  const HOLD = path.join(DATA, "fixtures", "defender-hold");   // keeps the stand-in Defender on a file (tests\sandbox.js)
  try {
    /* ---- the shipped list: the credit ------------------------------------------ */
    for (const f of ["homebrew.json", "homebrew-got.json", "homebrew-job.json"]) { fs.rmSync(path.join(DATA, f), { force: true }); }
    const shipped = (await api("api/homebrew.php")).games || [];
    const named = Object.fromEntries(shipped.map((g) => [g.id, g]));
    check("homebrew: the shipped list is read, every game kept", shipped.length, 29);
    check("each names who made it, what it is, its licence, its jam and a way to its makers",
      shipped.filter((g) => !(g.name && g.team && g.about && g.licence && g.jam && g.community && g.jamPage && (g.page || g.repo))).map((g) => g.id), []);
    check("everyone on a team is named, as they write their names",
      [/lambertjamesd, Pyroxene, SapphireOnze, beta_dynast, terzdesign/.test(named["junk-runner-64"].team), /Flávio Zavan/.test(named["biosphere-64"].team),
       /Sloan 누구/.test(named.bunbrush.team), /lepidotós/.test(named["untitled-racing-game"].team)], [true, true, true, true]);
    check("the winners stand first, with their places", shipped.slice(0, 3).map((g) => [g.name, g.place]),
      [["Junk Runner 64", 1], ["Cathode Quest 64", 2], ["Phazer 64", 3]]);
    check("what a game stands on is credited too", [named["junk-runner-64"].basedon, /HailToDodongo/.test(named["cathode-quest-64"].basedon)], ["libdragon and Tiny3D", true]);
    check("its makers' warning and their own words come as they wrote them",
      [named["somewhere-to-escape"].warn, /WILL NOT PRESS/.test(named["plug-n-repair"].notes)], ["May trigger epilepsy", true]);
    const file = JSON.parse(fs.readFileSync(path.join(ROOT, "includes", "homebrew", "games.json"), "utf8"));
    check("every game has a file the list can check, and Cathode Quest's release is never the engine's",
      [file.games.filter((g) => !(g.file.drive && /^[0-9a-f]{40}$/.test(g.file.drive.sha1) && g.file.drive.size > 0)).length,
       file.games.find((g) => g.id === "cathode-quest-64").file.release], [0, undefined]);
    check("the list holds no long dash", /[–—]/.test(fs.readFileSync(path.join(ROOT, "includes", "homebrew", "games.json"), "utf8")), false);
    check("every game but the 2024 cart has a picture, and each says whose",
      [shipped.filter((g) => !g.pic).map((g) => g.id), named.asterisk.picsBy, named.pandemonium.picsBy], [["n64brew-jam-2024"], "N64 Squid", "its makers, N64 Squid"]);
    check("a picture comes from its makers' places or the one site the list names",
      [...new Set(file.games.flatMap((g) => Object.values(g.art || {}).flat()).map((u) => new URL(u).host))].sort(),
      ["img.itch.zone", "n64squid.com", "raw.githubusercontent.com"]);

    /* ---- a list of the test's own, and stand-ins of the teams' places ------------ */
    const put = (url, bytes) => {
      const u = new URL(url), at = path.join(fix, "remote", u.host, ...u.pathname.split("/").filter(Boolean).map(decodeURIComponent));
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.writeFileSync(at, bytes);
    };
    const JAM = { "t-jam": { name: "Test Jam", theme: "Testing", page: "https://example.com/jam", community: "https://example.com/chat" } };
    const TEAM = "Test Team (One, Two)";
    const entry = (id, name, f, more) => Object.assign({ id, name, console: N64, about: "A game of the test's.", team: TEAM, jam: "t-jam",
      repo: "https://github.com/xsegon-test/" + id, licence: "MIT", file: f }, more || {});
    const drive = (b64) => ({ id: "x".repeat(24), size: b64.length, sha1: hash("sha1", b64) });
    const fromTeam = rom(0x11), fromJam = rom(0x22), page = Buffer.alloc(4096, 0x3c), other = rom(0x33);
    const asset = (repo, name, bytes, tag) => {
      const url = "https://github.com/xsegon-test/" + repo + "/releases/download/" + tag + "/" + name;
      put(url, bytes);
      put("https://api.github.com/repos/xsegon-test/" + repo + "/releases/latest", JSON.stringify({ tag_name: tag, name: tag, assets: [
        { name, size: bytes.length, browser_download_url: url, digest: "sha256:" + hash("sha256", bytes), updated_at: "2026-10-01T00:00:00Z" }] }));
    };
    asset("t-rel", "t-rel-2.z64", fromTeam, "v2");
    fs.writeFileSync(path.join(DATA, "homebrew.json"), JSON.stringify({ jams: JAM, pictures: { "n64squid.com": "N64 Squid" }, games: [
      entry("t-rel", "Release Game", { release: "\\.z64$", drive: drive(fromJam) }, { place: 1, tested: "NTSC N64 only", warn: "Mind the test.", notes: "Our own words." }),
      entry("t-fall", "Fallback Game", { release: "\\.z64$", drive: drive(fromJam) }),
      entry("t-sum", "Wrong Sum Game", { drive: drive(other) }),
      entry("t-page", "Page Game", { drive: drive(page) }),
      entry("t-ares", "Ares Game", { drive: drive(fromJam) }, { emulator: "ares" }),
      entry("t-home", "Home Game", { drive: drive(fromJam) }, { art: { box: ["https://example.com/gone.png", "https://n64squid.com/t/box.png"], shot: ["https://example.com/t/shot.png"] } }),
      { id: "t-noteam", name: "Nobody's Game", console: N64, about: "Unnamed makers.", jam: "t-jam", repo: "https://github.com/xsegon-test/x", licence: "MIT", file: { drive: drive(fromJam) } },
      entry("t-badurl", "Bad Address", { drive: drive(fromJam) }, { repo: "http://example.com/x" }),
    ] }));
    const list = async () => Object.fromEntries(((await api("api/homebrew.php")).games || []).map((g) => [g.id, g]));
    const by = await list();
    check("a game with no team named, or a bad address, is left out, never shown uncredited", [!!by["t-noteam"], !!by["t-badurl"], Object.keys(by).length], [false, false, 6]);

    /* ---- only a listed place opens ------------------------------------------------ */
    check("its GitHub, its community and its jam open (a test copy opens nothing)",
      [(await api("api/homebrew.php", { open: "t-rel", which: "repo" })).url, (await api("api/homebrew.php", { open: "t-rel", which: "community" })).url,
       (await api("api/homebrew.php", { open: "t-rel", which: "jam" })).url],
      ["https://github.com/xsegon-test/t-rel", "https://example.com/chat", "https://example.com/jam"]);
    check("an address the list does not name is never opened",
      [(await api("api/homebrew.php", { open: "t-rel", which: "evil" })).ok, (await api("api/homebrew.php", { open: "https://example.org", which: "page" })).ok], [false, false]);

    /* ---- Get ---------------------------------------------------------------------- */
    const ended = () => apiUntil(async () => { const j = (await api("api/homebrew.php?job=1")).job; return j && j.state !== "running" ? j : null; }, 30000);
    const got = await api("api/homebrew.php", { get: "t-rel" });
    const job = await ended();
    const made = (job && job.made) || {};
    check("Get: the team's latest release, checked, in the console's HomeBrew folder, named for the game",
      [got.ok, job && job.state, made.version, path.basename(path.dirname(made.file || "")), path.basename(made.file || ""),
       !!made.file && fs.existsSync(made.file) && hash("sha1", fs.readFileSync(made.file))],
      [true, "done", "v2", "HomeBrew", "Release Game.z64", hash("sha1", fromTeam)]);
    const n64 = (await api("api/library.php?platform=" + encodeURIComponent(N64) + "&grouped=0")).games || [];
    const over = JSON.parse(fs.readFileSync(path.join(DATA, "overrides.json"), "utf8"))[made.id] || {};
    check("in its console's list, its team kept on it as its developer, with its jam, its licence and its pages in its notes",
      [n64.some((g) => g.id === made.id), over.developer, /Made by Test Team \(One, Two\) for Test Jam/.test(over.notes || ""), /Licence: MIT/.test(over.notes || ""),
       /github\.com\/xsegon-test\/t-rel/.test(over.notes || "")], [true, TEAM, true, true, true]);
    const now = await list();
    check("the page has it as yours, with its version", [now["t-rel"].mine && now["t-rel"].mine.id, now["t-rel"].mine && now["t-rel"].mine.version], [made.id, "v2"]);
    check("a second Get is refused: the game is in your library already", [(await api("api/homebrew.php", { get: "t-rel" })).ok, /already/.test((await api("api/homebrew.php", { get: "t-rel" })).error || "")], [false, true]);
    const bar = ((await api("api/jobs.php")).jobs || []).find((j) => j.key === "homebrew") || {};
    check("the corner bar says how it ended", [bar.state, /Release Game is in your Nintendo 64 list/.test(bar.said || ""), bar.name], ["done", true, "Get Release Game"]);

    // Hidden from Xsegon, it is out of the library: Get says so and where to show it again, and fetches no second copy.
    await api("api/hide.php", { id: made.id, hide: true });
    const whileHidden = await api("api/homebrew.php", { get: "t-rel" });
    await api("api/hide.php", { id: made.id, hide: false });
    check("a game of yours hidden from Xsegon is not fetched again: Get says it is hidden, and where it shows again",
      [whileHidden.ok, /is in your library, hidden from Xsegon: Settings > Library shows it again/.test(whileHidden.error || "")], [false, true]);

    // Deleted from Xsegon, its file and its row kept: Get says where it comes back, as Scan for Games never offers it again.
    await api("api/deleted.php", { action: "delete", ids: [made.id], confirm: "1" });
    const whileDeleted = await api("api/homebrew.php", { get: "t-rel" });
    await api("api/deleted.php", { action: "restore", id: made.id });
    check("a game of yours deleted from Xsegon is not fetched again: Get says where it is put back",
      [whileDeleted.ok, /was deleted from Xsegon, its file kept: Settings > Library > Deleted from Xsegon puts it back/.test(whileDeleted.error || "")], [false, true]);

    // No release to take: the copy entered in the jam, its size and SHA-1 checked.
    put("https://drive.google.com/uc", fromJam);
    await api("api/homebrew.php", { get: "t-fall" });
    const fall = await ended();
    check("no release from the team: the copy entered in the jam, said to be that",
      [fall && fall.state, ((fall && fall.made) || {}).version, !!(fall && fall.made) && hash("sha1", fs.readFileSync(fall.made.file))], ["done", "jam copy", hash("sha1", fromJam)]);

    // Fetched before and not taken in (Xsegon closed as it was added): Get adds that copy, and fetches nothing again.
    const fallId = ((fall && fall.made) || {}).id, fallFile = ((fall && fall.made) || {}).file;
    await api("api/scan.php", { action: "remove", id: fallId });
    put("https://drive.google.com/uc", page);            // were it fetched again, it would fail its checks
    const resumed = await api("api/homebrew.php", { get: "t-fall" });
    const back = await ended();
    const n64Back = (await api("api/library.php?platform=" + encodeURIComponent(N64) + "&grouped=0")).games || [];
    check("a game fetched before that the library did not take in: Get adds that copy, and fetches nothing again",
      [resumed.ok, back && back.state, ((back && back.made) || {}).file, n64Back.some((g) => g.id === fallId), fs.existsSync(fallFile) && hash("sha1", fs.readFileSync(fallFile))],
      [true, "done", fallFile, true, hash("sha1", fromJam)]);

    put("https://drive.google.com/uc", fromJam);
    await api("api/homebrew.php", { get: "t-sum" });
    const sum = await ended();
    check("a file that is not the one the list names: nothing is kept, and it says why, and where to go",
      [sum && sum.state, /other than the file the list names/.test((sum && sum.error) || ""), /Its own page has it/.test((sum && sum.error) || ""),
       fs.existsSync(path.join(games, N64, "HomeBrew", "Wrong Sum Game.z64"))], ["failed", true, true, false]);

    // A copy of the person's own, by its name: the page has it as theirs, and Get makes no second one nor writes over it.
    const scanFile = path.join(DATA, "scanned-games.json"), scanWas = fs.readFileSync(scanFile, "utf8");
    const ownCopy = path.join(fix, "own", "wrong_sum_game.z64");
    fs.mkdirSync(path.dirname(ownCopy), { recursive: true });
    fs.writeFileSync(ownCopy, rom(0x66));
    fs.writeFileSync(scanFile, JSON.stringify(JSON.parse(scanWas).concat([
      { id: "xs-scan-hbown0000000", title: "Wrong Sum Game", platform: N64, rom: ownCopy, added: new Date().toISOString() }])));
    const ownMine = ((await list())["t-sum"] || {}).mine;
    const ownGet = await api("api/homebrew.php", { get: "t-sum" });
    fs.writeFileSync(scanFile, scanWas);
    check("a copy of your own by its name is yours on the page, and Get says so and fetches nothing",
      [ownMine && ownMine.id, ownGet.ok, /is in your library already, as Wrong Sum Game \(wrong_sum_game\.z64\)/.test(ownGet.error || "")], ["xs-scan-hbown0000000", false, true]);

    put("https://drive.google.com/uc", page);
    await api("api/homebrew.php", { get: "t-page" });
    const notRom = await ended();
    check("a page in place of a game, though it is the size and sum the list names: it is no game, so it is not kept",
      [notRom && notRom.state, /is no Nintendo 64 game/.test((notRom && notRom.error) || ""), fs.existsSync(path.join(games, N64, "HomeBrew", "Page Game.z64"))], ["failed", true, false]);

    /* ---- it goes where the console's games are, in a folder of the person's naming ---- */
    const shelf = path.join(fix, "roms", "n64");
    fs.mkdirSync(path.join(shelf, "HomeBrewGames"), { recursive: true });
    // More games on the shelf than Get has brought so far: most of a console's games decide where its folder is.
    const shelved = [...Array(9).keys()].map((n) => {
      const at = path.join(shelf, "Base Game " + n + ".z64");
      fs.writeFileSync(at, rom(0x44 + n));
      return { id: "xs-scan-hb000000000" + n, title: "Base Game " + n, platform: N64, rom: at, added: new Date().toISOString() };
    });
    const onDisk = JSON.parse(fs.readFileSync(path.join(DATA, "scanned-games.json"), "utf8"));
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), JSON.stringify(onDisk.concat(shelved)));
    put("https://drive.google.com/uc", fromJam);
    const PIC = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    put("https://n64squid.com/t/box.png", PIC);
    put("https://example.com/t/shot.png", PIC);
    await api("api/homebrew.php", { get: "t-home" });
    const home = await ended();
    check("Get finds the console's folder from its games, and a folder there starting HomeBrew is the person's own, whatever else it is called",
      [home && home.state, !!(home && home.made) && path.dirname(home.made.file)], ["done", path.join(shelf, "HomeBrewGames")]);

    /* ---- its pictures: on Get, and in the Media tab for a copy put there by hand ---- */
    const homeId = (home && home.made && home.made.id) || "";
    const artFile = (kind) => path.join(DATA, "art", homeId + "-" + kind + ".png");
    const inLibrary = (await api("api/game.php?id=" + homeId)).game || {};
    check("Get brings its pictures: the first of each kind that comes, and one that does not come costs the game nothing",
      [fs.existsSync(artFile("box")), fs.existsSync(artFile("shot")), home && home.state], [true, true, "done"]);
    check("the game's notes say where the pictures came from", /Pictures from N64 Squid, its makers\./.test(inLibrary.notes || ""), true);
    for (const kind of ["box", "shot"]) { fs.rmSync(artFile(kind), { force: true }); }
    const byHand = path.join(shelf, "HomeBrewGames", "homegame-1.2.z64");
    fs.writeFileSync(byHand, rom(0x55));
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), JSON.stringify(JSON.parse(fs.readFileSync(path.join(DATA, "scanned-games.json"), "utf8")).concat([
      { id: "xs-scan-hbhand000000", title: "homegame-1.2", platform: N64, rom: byHand, added: new Date().toISOString() }])));
    const placesFor = async (id) => (((await api("api/mediachoice.php?id=" + id + "&places=1")).places || {}).pictures || []).map((p) => p.key);
    check("a copy put there by hand is known by its file name, so the Media tab offers the list's pictures, and no other game is offered them",
      [(await placesFor("xs-scan-hbhand000000")).includes("homebrew"), (await placesFor(shelved[0].id)).includes("homebrew")], [true, false]);
    const asked = await api("api/mediachoice.php?id=xs-scan-hbhand000000&kind=box&only=homebrew");
    const looked = await apiUntil(async () => { const j = await api("api/mediachoice.php?ticket=" + asked.ticket); return j.done ? j : null; }, 15000);
    check("each picture there says who it comes from",
      ((((looked || {}).places || {}).homebrew || {}).items || []).map((i) => i.label), ["its makers", "N64 Squid"]);

    /* ---- ares: asked for, never taking a console over ------------------------------ */
    const table = () => JSON.parse(fs.readFileSync(path.join(DATA, "emulators.json"), "utf8"));
    const usual = (t) => (((t.platforms || {})["nintendo 64"] || {}).options || []).filter((o) => o.default).map((o) => o.program);
    const before = usual(table());
    check("a game that plays in ares says so while the PC has none", [(await list())["t-ares"].needsAres, (await list())["t-rel"].needsAres], [true, false]);
    const unasked = await api("api/homebrew.php", { get: "t-ares" });
    check("ares is never fetched without a yes", [unasked.ok, /plays in ares/.test(unasked.error || ""), fs.existsSync(aresDir)], [false, true, false]);
    const zip = zipOf([["ares-v148/ares.exe", Buffer.from("MZ stand-in")], ["ares-v148/Database/Nintendo 64.bml", Buffer.from("stand-in")]]);
    const zipUrl = "https://github.com/ares-emulator/ares/releases/download/v148/ares-windows-x64.zip";
    put(zipUrl, zip);
    put("https://api.github.com/repos/ares-emulator/ares/releases/latest", JSON.stringify({ tag_name: "v148", assets: [
      { name: "ares-macos-universal.zip", size: 5, browser_download_url: "https://github.com/ares-emulator/ares/releases/download/v148/ares-macos-universal.zip" },
      { name: "ares-windows-x64.zip", size: zip.length, browser_download_url: zipUrl, digest: "sha256:" + hash("sha256", zip) }] }));
    put("https://drive.google.com/uc", fromJam);
    // Stop pressed while Windows Defender checks ares: the stand-in is held on the download until then.
    fs.writeFileSync(HOLD, "homebrew.download");
    await api("api/homebrew.php", { get: "t-ares", ares: true });
    const inCheck = await apiUntil(async () => { const j = (await api("api/homebrew.php?job=1")).job; return j && j.phase === "checking" ? j : null; }, 20000);
    await api("api/jobs.php", { stop: "homebrew" });
    const stopped = await ended();
    fs.rmSync(HOLD, { force: true });
    check("Stop while Windows Defender checks ares: none of it is kept, and the emulator table is as it was",
      [!!inCheck, stopped && stopped.state, stopped && stopped.error, fs.existsSync(aresDir), !!(table().programs || {}).ares],
      [true, "failed", "stopped: nothing was kept", false, false]);
    await api("api/homebrew.php", { get: "t-ares", ares: true });
    const withAres = await ended();
    const after = table(), aresKey = "ares", gameId = ((withAres && withAres.made) || {}).id;
    check("with a yes: ares from its makers, the right download of its release, its program at the top of its folder",
      [withAres && withAres.state, fs.existsSync(path.join(aresDir, "ares.exe")), fs.existsSync(path.join(aresDir, "Database", "Nintendo 64.bml")),
       (after.programs[aresKey] || {}).exe], ["done", true, true, path.join(aresDir, "ares.exe")]);
    check("your other Nintendo 64 games keep what starts them", usual(after), before.length ? before : ["ares"]);
    const choice = JSON.parse(fs.readFileSync(path.join(DATA, "emu-choice.json"), "utf8"));
    const row = ((await api("api/library.php?platform=" + encodeURIComponent(N64) + "&grouped=0")).games || []).find((g) => g.id === gameId) || {};
    check("only this game starts in ares", [choice[gameId], row.emu, Object.values(choice).filter((k) => k === aresKey).length], [aresKey, "ares", 1]);
    check("and no other game is asked for it now", (await list())["t-fall"].needsAres, false);

    /* ---- the page ------------------------------------------------------------------ */
    await api("api/settings.php", { view: { showTumultuous: false } });
    await b.goto(BASE + "/");
    await b.waitFor(`!document.getElementById("syswall").hidden && document.querySelectorAll("#syswall .sel").length > 0`, 10000);
    await b.key("End");
    await b.settled();
    await b.key("ArrowLeft");
    await b.settled();
    await b.key("ArrowLeft");
    await b.settled();
    check("Homebrew is the card before Extensions on the consoles screen, saying what it is",
      await b.until(`((document.querySelector("#syswall .sel") || {}).textContent || "").includes("Homebrew")`, true, 3000), true);
    await b.key("Enter");
    check("Enter on it opens the page, in place of the consoles screen",
      [await b.waitFor(`!!document.getElementById("hbpage") && !document.getElementById("hbpage").hidden && document.querySelectorAll("#hbpage .tile").length === 6`, 10000),
       await b.ev(`document.getElementById("syswall").hidden`)], [true, true]);
    check("yours stand first, then the jam, each heading with its count",
      await b.until(`[...document.querySelectorAll("#hbpage .ghead")].map((h) => h.textContent)`, ["In your library4", "Test Jam2"]), ["In your library4", "Test Jam2"]);
    await b.ev(`(() => { const i = document.querySelector("#hbpage .fan-find, #hbpage input[type=search]"); i.value = "Wrong Sum"; i.dispatchEvent(new Event("input")); })()`);
    check("the find box narrows by name", await b.until(`document.querySelectorAll("#hbpage .tile").length`, 1, 3000), 1);
    check("a tile says who made it", await b.ev(`document.querySelector("#hbpage .tile .fan-st").textContent`), "by Test Team");
    await b.ev(`(() => { const i = document.querySelector("#hbpage input[type=search]"); i.value = "One"; i.dispatchEvent(new Event("input")); })()`);
    await b.until(`document.querySelectorAll("#hbpage .tile").length`, 6, 3000);
    check("and it finds by who made it", await b.ev(`document.querySelectorAll("#hbpage .tile").length`), 6);
    await b.ev(`(() => { const i = document.querySelector("#hbpage input[type=search]"); i.value = "Release Game"; i.dispatchEvent(new Event("input")); i.blur(); })()`);
    await b.until(`document.querySelectorAll("#hbpage .tile").length`, 1, 3000);
    check("the panel credits everyone, then its place, what it is and its makers' own words",
      await b.until(`[document.querySelector("#hbpage .hero-name").textContent, document.querySelector("#hbpage .fan-by").textContent,
                      document.querySelector("#hbpage .hb-warn").textContent, document.querySelector("#hbpage .hb-says").textContent]`,
        ["Release Game", "by Test Team (One, Two)", "Its makers warn: Mind the test.", "Its makers say: Our own words."]),
      ["Release Game", "by Test Team (One, Two)", "Its makers warn: Mind the test.", "Its makers say: Our own words."]);
    check("its buttons: Play, then its makers' places and its jam",
      await b.ev(`[...document.querySelectorAll("#hbpage .hero .bar button")].map((x) => x.textContent)`), ["Play", "GitHub", "Community", "The jam"]);
    check("the legend says what the keys do here", await b.ev(`document.getElementById("help").textContent.includes("the panel's first button")`), true);
    await b.key("Escape");
    check("Escape goes back to the consoles", await b.waitFor(`document.getElementById("hbpage").hidden && !document.getElementById("syswall").hidden`, 5000));

    await b.setView("grid");               // the menu bar is in list and grid; the copy keeps this PC's own view
    await b.openBar("games");
    await b.menuItem(/^Homebrew/);
    check("Games > Homebrew opens it from the games", await b.waitFor(`!document.getElementById("hbpage").hidden && document.querySelectorAll("#hbpage .tile").length > 0`, 10000));
    await b.key("Escape");
    check("and Escape goes back to them", await b.waitFor(`document.getElementById("hbpage").hidden && !document.getElementById("main").hidden`, 5000));

    /* ---- an empty library has a way in ------------------------------------------------ */
    await b.ev(`import("/js/nogames.js").then((m) => { const n = m.noGamesBox(null, () => {}); n.id = "ng-hb"; document.body.appendChild(n); })`);
    check("the box an empty library shows offers free homebrew games beside Scan for Games and Getting started",
      await b.until(`[...document.querySelectorAll("#ng-hb .nogames-btns button")].map((x) => x.textContent)`, ["Scan for Games", "Getting started", "Free homebrew games"]),
      ["Scan for Games", "Getting started", "Free homebrew games"]);
    await b.ev(`document.getElementById("ng-hb").remove()`);
  } finally {
    kept.restore();
    fs.rmSync(fix, { recursive: true, force: true });
    fs.rmSync(games, { recursive: true, force: true });
    fs.rmSync(aresDir, { recursive: true, force: true });
    fs.rmSync(HOLD, { force: true });
  }
};
