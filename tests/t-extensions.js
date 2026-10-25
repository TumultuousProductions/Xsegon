/* The Extensions page (roadmap AU11, js/extensions.js, api/extensions.php): a
   test copy finds no Flashpoint but the one it is told of, a made-up one here
   (a game list of three games built with PHP's sqlite3, two playlists, pictures,
   preferences); its favourites come in as games of your own under Flashpoint,
   started through the helper beside it; Set up and Get fetch from stand-ins of
   their makers' places (data\fan-fixtures\remote) and check what came. Nothing
   real is downloaded, opened or started. */

"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { api, apiUntil, BASE, DATA, ROOT, Guard } = require("./lib");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const GAME_A = "aa11aa11-0000-4000-8000-000000000001";       // its zip downloaded already, both pictures in Flashpoint's folder
const GAME_B = "bb22bb22-0000-4000-8000-000000000002";       // no zip (it fetches as it plays); its logo only where Flashpoint fetches pictures
const GAME_C = "cc33cc33-0000-4000-8000-000000000003";       // a zip not downloaded yet, no pictures anywhere
const GAME_GONE = "dd44dd44-0000-4000-8000-000000000004";    // on the playlist, gone from the game list
const GAME_E = "ee55ee55-0000-4000-8000-000000000005";       // tagged with a tag Flashpoint's settings hide
const GAME_F = "ff66ff66-0000-4000-8000-000000000006";       // marked broken

function php() {
  for (const c of [process.env.XSEGON_PHP, path.join(ROOT, "..", "php-8.5.12-nts-Win32-vs17-x64", "php.exe")]) {
    if (c && fs.existsSync(c)) { return c; }
  }
  return "php";
}

// Flashpoint's game list as its 12.1 keeps it, the columns the reader asks for, with three games.
function makeGameList(file) {
  const code = [
    "$db = new SQLite3($argv[1]);",
    "$db->exec('CREATE TABLE game (id TEXT PRIMARY KEY, title TEXT, developer TEXT, publisher TEXT, releaseDate TEXT, originalDescription TEXT,'",
    "  . ' platformName TEXT, library TEXT, playMode TEXT, status TEXT, tagsStr TEXT, applicationPath TEXT, launchCommand TEXT, broken INTEGER)');",
    "$db->exec('CREATE TABLE game_data (id INTEGER PRIMARY KEY, gameId TEXT, presentOnDisk INTEGER, path TEXT, size INTEGER, sha256 TEXT,'",
    "  . ' applicationPath TEXT, launchCommand TEXT, parameters TEXT, dateAdded TEXT)');",
    "$g = $db->prepare('INSERT INTO game VALUES (:id, :t, :d, :p, :r, :o, :pl, :l, :m, :s, :tg, :a, :c, :b)');",
    "foreach (json_decode($argv[2], true) as $row) { foreach ($row as $k => $v) { $g->bindValue(':' . $k, $v); } $g->execute(); $g->reset(); }",
    "$d = $db->prepare('INSERT INTO game_data (gameId, presentOnDisk, path, size, sha256, applicationPath, launchCommand, parameters, dateAdded) VALUES (:g, :p, :f, 10, :h, :a, :c, :x, :w)');",
    "foreach (json_decode($argv[3], true) as $row) { foreach ($row as $k => $v) { $d->bindValue(':' . $k, $v); } $d->execute(); $d->reset(); }",
    "echo 'made';",
  ].join("\n");
  const flash = "FPSoftware/Flash/flashplayer_32_sa.exe".split("/").join(String.fromCharCode(92));
  const games = [
    { id: GAME_A, t: "Test Tanks", d: "Test Studio", p: "Test Publisher", r: "2004-09-18", o: "Drive a tank.", pl: "Flash", l: "arcade", m: "Single Player",
      s: "Playable", tg: "Action", a: "", c: "", b: 0 },
    { id: GAME_B, t: "Test Online", d: "", p: "", r: "2009", o: "", pl: "Flash", l: "arcade", m: "", s: "Playable", tg: "", a: flash, c: "http://example.com/b.swf", b: 0 },
    { id: GAME_C, t: "Test Later", d: "Later Studio", p: "", r: "not a date", o: "", pl: "Java", l: "arcade", m: "", s: "Playable", tg: "Gore", a: "", c: "", b: 0 },
    { id: GAME_E, t: "Test Gory", d: "", p: "", r: "2010", o: "", pl: "Flash", l: "arcade", m: "", s: "Playable", tg: "Action; gore", a: flash, c: "http://example.com/e.swf", b: 0 },
    { id: GAME_F, t: "Test Broken", d: "", p: "", r: "2011", o: "", pl: "Flash", l: "arcade", m: "", s: "Playable", tg: "Action", a: flash, c: "http://example.com/f.swf", b: 1 },
  ];
  const data = [
    { g: GAME_A, p: 1, f: GAME_A + "-1.zip", h: "AA", a: flash, c: "http://localflash/a.swf", x: "", w: "2023-01-01" },
    { g: GAME_C, p: 0, f: GAME_C + "-1.zip", h: "CC", a: flash, c: "http://localflash/c.swf", x: "-extract", w: "2023-01-01" },
  ];
  const exe = php();
  return String(execFileSync(exe, ["-d", "extension_dir=" + path.join(path.dirname(exe), "ext"), "-d", "extension=sqlite3", "-r", code, file,
                                   JSON.stringify(games), JSON.stringify(data)], { stdio: ["ignore", "pipe", "ignore"] }));
}

// A zip of stored files, enough for tar to unpack: [[name, bytes], ...].
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) { c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; }
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function zipOf(files) {
  const locals = [], centrals = [];
  let at = 0;
  for (const [name, data] of files) {
    const nm = Buffer.from(name), crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(at, 42);
    locals.push(lh, nm, data);
    centrals.push(ch, nm);
    at += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat(locals.concat([cd, end]));
}
const sha256 = (x) => crypto.createHash("sha256").update(x).digest("hex");

module.exports = async function (b, check) {
  const kept = new Guard(["extensions.json", "extensions-list.json", "extensions-job.json", "local-games.json", "art-hidden.json", "flashpoint-pad.json", "settings.json"]);
  const fix = path.join(DATA, "ext-fixtures");
  const remote = path.join(DATA, "fan-fixtures", "remote");
  const put = (url, bytes) => {
    const u = new URL(url), at = path.join(remote, u.host, ...u.pathname.split("/").filter(Boolean).map(decodeURIComponent));
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, bytes);
  };
  const ended = () => apiUntil(async () => { const j = (await api("api/extensions.php?job=1")).job; return j && j.state !== "running" ? j : null; }, 60000);
  try {
    /* ---- the shipped list, and no Flashpoint but the one it is told of ---------- */
    fs.rmSync(path.join(DATA, "extensions.json"), { force: true });
    fs.rmSync(path.join(DATA, "extensions-list.json"), { force: true });
    fs.rmSync(path.join(DATA, "extensions-job.json"), { force: true });
    const real = await api("api/extensions.php");
    const fp0 = (real.extensions || []).find((x) => x.id === "flashpoint") || {};
    check("extensions: the shipped list has Flashpoint, its makers' page, their download and the helper that starts its games",
      [real.ok, fp0.name, fp0.page, !!fp0.get && /^Flashpoint Infinity [\d.]+\.7z$/.test(fp0.get.file) && fp0.get.size > 1e9, (fp0.helper || {}).name, (fp0.helper || {}).licence],
      [true, "Flashpoint Archive", "https://flashpointarchive.org/", true, "CLIFp", "AGPL-3.0"]);
    check("a test copy finds no Flashpoint by itself, so it offers to get one",
      [fp0.section, fp0.folder, fp0.next], ["ready", "", "get"]);

    /* ---- a made-up Flashpoint, chosen as its folder ---------------------------- */
    // The copy holds this PC's own games: Flashpoint ones brought in here are set aside, so the counts below are this test's (kept puts them back).
    const ownGames = path.join(DATA, "local-games.json");
    if (fs.existsSync(ownGames)) {
      fs.writeFileSync(ownGames, JSON.stringify(JSON.parse(fs.readFileSync(ownGames, "utf8")).filter((e) => !e.fpId && e.platform !== "Flashpoint")));
    }
    fs.rmSync(fix, { recursive: true, force: true });
    const root = path.join(fix, "Flashpoint");
    for (const d of ["Data/Playlists", "Data/Images/Logos/aa/11", "Data/Images/Screenshots/aa/11", "Launcher", "FPSoftware"]) {
      fs.mkdirSync(path.join(root, ...d.split("/")), { recursive: true });
    }
    fs.writeFileSync(path.join(root, "version.txt"), "Flashpoint 12.1 Infinity - Test\n");
    fs.writeFileSync(path.join(root, "Launcher", "Flashpoint.exe"), "");
    fs.writeFileSync(path.join(root, "preferences.json"), JSON.stringify({ playlistFolderPath: "Data/Playlists", imageFolderPath: "Data/Images",
      onDemandImages: true, onDemandBaseUrl: "https://images.example.com/images/", browsePageShowExtreme: false,
      tagFilters: [{ name: "Violence", extreme: true, enabled: false, tags: ["Gore"] }, { name: "Not hidden", extreme: false, enabled: false, tags: ["Action"] }] }));
    fs.writeFileSync(path.join(root, "Data", "Playlists", "Favorites.json"), JSON.stringify({ id: "x", title: "Favorites",
      games: [GAME_A, GAME_B, GAME_C, GAME_GONE].map((gameId) => ({ gameId, notes: "" })) }));
    fs.writeFileSync(path.join(root, "Data", "Playlists", "Other.json"), JSON.stringify({ id: "y", title: "A Other List", games: [{ gameId: GAME_A }] }));
    fs.writeFileSync(path.join(root, "Data", "Playlists", "broken.json"), "{ not json");
    fs.writeFileSync(path.join(root, "Data", "Images", "Logos", "aa", "11", GAME_A + ".png"), PNG);
    fs.writeFileSync(path.join(root, "Data", "Images", "Screenshots", "aa", "11", GAME_A + ".png"), PNG);
    put("https://images.example.com/images/Logos/bb/22/" + GAME_B + ".png", PNG);
    const made = makeGameList(path.join(root, "Data", "flashpoint.sqlite"));
    check("the made-up Flashpoint's game list is built", made, "made");

    check("a folder that is no Flashpoint is refused, and said why",
      [(await api("api/extensions.php", { folder: fix, id: "flashpoint" })).ok], [false]);
    const chose = await api("api/extensions.php", { folder: root, id: "flashpoint" });
    check("Flashpoint's own folder is taken", [chose.ok, chose.folder], [true, root]);
    let fp = ((await api("api/extensions.php")).extensions || []).find((x) => x.id === "flashpoint") || {};
    check("found: its version, its game list counted, its playlists with Favorites first (a file that does not read is left out)",
      [fp.section, fp.version && fp.version.number, fp.version && fp.version.edition, fp.games, (fp.playlists || []).map((p) => p.title + " " + p.count)],
      ["here", "12.1", "Infinity", 5, ["Favorites 4", "A Other List 1"]]);
    check("the helper release for 12.1 is the one to fetch, and it is not beside it yet, so Set up is next",
      [fp.fit && fp.fit.tag, fp.helperHere && fp.helperHere.there, fp.next], ["v0.9.10", false, "setup"]);

    /* ---- its favourites brought in, before Set up --------------------------------- */
    const bring = await api("api/extensions.php", { bring: "flashpoint", playlist: "Favorites.json" });
    check("Favorites brought in: three games, one gone from Flashpoint's list left out, two that download at their first play; none of your own picks is hidden, Gore and all",
      [bring.ok, bring.added, bring.kept, bring.unknown, bring.online, (bring.ids || []).length, bring.platform, bring.hidden], [true, 3, 0, 1, 2, 3, "Flashpoint", 0]);
    const own = () => JSON.parse(fs.readFileSync(path.join(DATA, "local-games.json"), "utf8")).filter((e) => e.fpId);
    const mine = own();
    const ga = mine.find((e) => e.fpId === GAME_A) || {}, gc = mine.find((e) => e.fpId === GAME_C) || {};
    check("each a game of your own under Flashpoint, started by the helper beside Flashpoint with its own ID",
      [ga.platform, ga.run, ga.args, ga.title, ga.developer, ga.publisher, ga.released, ga.notes],
      ["Flashpoint", path.join(root, "CLIFp.exe"), "play -i " + GAME_A, "Test Tanks", "Test Studio", "Test Publisher", "2004-09-18", "Drive a tank."]);
    check("a date that is not one is left empty, never refusing the game", [gc.title, gc.released], ["Test Later", undefined]);
    const lib = (await api("api/library.php?platform=Flashpoint&grouped=0")).games || [];
    const la = lib.find((g) => g.id === ga.id) || {};
    check("in the library under Flashpoint, saying why it cannot start yet", [lib.length, /not set up for Xsegon yet/.test(la.why || "")], [3, true]);
    const early = await api("api/launch.php", { id: ga.id });
    check("and Play says it", [early.ok, /Extensions, select Flashpoint, then press Set up/.test(early.error || "")], [false, true]);

    fs.writeFileSync(path.join(DATA, "local-games.json"), JSON.stringify(JSON.parse(fs.readFileSync(path.join(DATA, "local-games.json"), "utf8"))
      .map((e) => e.fpId === GAME_A ? Object.assign(e, { developer: "My Own Words" }) : e)));
    const again = await api("api/extensions.php", { bring: "flashpoint", playlist: "Favorites.json" });
    check("brought in again: none twice, and what you changed is kept",
      [again.added, again.kept, own().length, (own().find((e) => e.fpId === GAME_A) || {}).developer], [0, 3, 3, "My Own Words"]);
    check("a playlist Flashpoint does not have is refused", (await api("api/extensions.php", { bring: "flashpoint", playlist: "Nope.json" })).ok, false);

    /* ---- their pictures ------------------------------------------------------------ */
    const pa = await api("api/extensions.php", { pictures: ga.id });
    const pb = await api("api/extensions.php", { pictures: (mine.find((e) => e.fpId === GAME_B) || {}).id });
    const pc = await api("api/extensions.php", { pictures: gc.id });
    check("pictures: from Flashpoint's folder, else from where Flashpoint fetches them, else none",
      [pa.pictures, pb.pictures, pc.pictures],
      [{ box: "flashpoint", shot: "flashpoint" }, { box: "online", shot: "none" }, { box: "none", shot: "none" }]);
    check("and a slot already filled is left alone", (await api("api/extensions.php", { pictures: ga.id })).pictures, { box: "already", shot: "already" });
    check("a game not from Flashpoint gets none", (await api("api/extensions.php", { pictures: "xs-not-a-flashpoint-game" })).ok, false);

    /* ---- Set up: the helper from a stand-in of its GitHub, checked ------------------- */
    const exe = Buffer.from("MZ stand-in for the helper");
    const relZip = zipOf([["bin/CLIFp.exe", exe], ["README.md", Buffer.from("read me")]]);
    const relUrl = "https://github.com/xsegon-test/CLIFp/releases/download/v0.9.10/CLIFp-test.zip";
    put(relUrl, relZip);
    const list = (sum) => ({ extensions: [{ id: "flashpoint", name: "Flashpoint Archive", kind: "Game collection", adds: "a test", by: "the testers",
      licence: "MIT", page: "https://flashpointarchive.org/", repo: "https://github.com/xsegon-test/launcher", size: "small",
      helper: { name: "CLIFp", by: "the helpers", licence: "AGPL-3.0", repo: "https://github.com/xsegon-test/CLIFp",
                fits: [{ flashpoint: "12.1", tag: "v0.9.10", asset: "CLIFp-test.zip", size: relZip.length, sha256: sum, exeSize: exe.length },
                       { flashpoint: "14.0", tag: "v0.9.16", asset: "CLIFp-test.zip", size: relZip.length, sha256: sum, exeSize: exe.length + 1 }] } }] });
    fs.writeFileSync(path.join(DATA, "extensions-list.json"), JSON.stringify(list(sha256(Buffer.from("not it")))));
    const badStart = await api("api/extensions.php", { setup: "flashpoint" });
    const badJob = await ended();
    check("a download that is not the file its makers list: nothing is put beside Flashpoint, and it says why",
      [badStart.ok, badJob && badJob.state, /SHA-256 differs/.test((badJob && badJob.error) || ""), fs.existsSync(path.join(root, "CLIFp.exe"))],
      [true, "failed", true, false]);
    fs.writeFileSync(path.join(DATA, "extensions-list.json"), JSON.stringify(list(sha256(relZip))));
    const start = await api("api/extensions.php", { setup: "flashpoint" });
    const job = await ended();
    check("Set up: the helper fetched, checked and put beside Flashpoint",
      [start.ok, job && job.state, fs.existsSync(path.join(root, "CLIFp.exe")) && fs.readFileSync(path.join(root, "CLIFp.exe")).equals(exe)], [true, "done", true]);
    check("nothing else of the download is left there", fs.readdirSync(root).sort(), ["CLIFp.exe", "Data", "FPSoftware", "Launcher", "preferences.json", "version.txt"]);
    const bar = ((await api("api/jobs.php")).jobs || []).find((j) => j.key === "extensions") || {};
    check("the corner bar says how it ended", [bar.state, /CLIFp v0\.9\.10 is beside Flashpoint/.test(bar.said || "")], ["done", true]);
    fp = ((await api("api/extensions.php")).extensions || []).find((x) => x.id === "flashpoint") || {};
    check("Xsegon knows it put it there, and its games are next to see",
      [fp.helperHere && fp.helperHere.there, fp.helperHere && fp.helperHere.mine, fp.helperHere && fp.helperHere.tag, fp.mine, fp.next],
      [true, true, "v0.9.10", 3, "list"]);
    check("a second Set up is refused: the helper there is never replaced, nor fetched twice",
      [(await api("api/extensions.php", { setup: "flashpoint" })).ok, ((await ended()) || {}).state], [false, "done"]);
    const dry = await api("api/launch.php", { id: ga.id });
    check("now Play starts the helper with the game's ID (a test copy starts nothing)",
      [dry.ok, dry.dry, dry.via, dry.exe, dry.args], [true, true, "Flashpoint", path.join(root, "CLIFp.exe"), "play -i " + GAME_A]);

    /* ---- the controller as the game's keys (roadmap AU13, bin/padtokeys.ps1) ------- */
    check("a Flashpoint game with no keys of its own: the d-pad and left stick as the arrows, into its player's window, full screen in Flash Player only, beside the launcher",
      [dry.padKeys && dry.padKeys.map, dry.padKeys && dry.padKeys.windows, dry.padKeys && dry.padKeys.fullScreen, dry.padKeys && dry.padKeys.fullScreenIn, dry.padKeys && dry.padKeys.own,
       /padtokeys\.ps1' -Map 'move=arrows' -Windows 'flashplayer\*,saflashplayer,flashpla,ruffle\*,java\*' -FullScreen 'Ctrl\+F' -FullScreenIn 'flashplayer\*,saflashplayer,flashpla' -GameId '/.test(dry.padCall || "")],
      ["move=arrows", "flashplayer*,saflashplayer,flashpla,ruffle*,java*", "Ctrl+F", "flashplayer*,saflashplayer,flashpla", false, true]);
    const shippedPad = JSON.parse(fs.readFileSync(path.join(ROOT, "includes", "extensions", "flashpoint-pad.json"), "utf8"));
    check("Super Mario Bros. Crossover's keys ship as its Options screen gives them",
      shippedPad.games["b0ce771e-7c02-4317-8528-ba48139e2688"].map, "move=arrows,a=Z,b=X,x=X,y=C,start=Enter,back=A");
    fs.writeFileSync(path.join(DATA, "flashpoint-pad.json"), JSON.stringify({ games: { [GAME_A]: { map: "move=arrows,a=Space,start=Enter", fullScreen: "Ctrl+F" },
                                                                                          [GAME_C]: { map: "a=Z; Remove-Item C:/", fullScreen: "Ctrl+F" } } }));
    const ownPad = (await api("api/launch.php", { id: ga.id })).padKeys || {};
    check("your own keys for a game come first, with full screen pressed once", [ownPad.map, ownPad.fullScreen, ownPad.own], ["move=arrows,a=Space,start=Enter", "Ctrl+F", true]);
    const badPad = (await api("api/launch.php", { id: gc.id })).padKeys || {};
    check("a map that is not one is never handed on", [badPad.map, badPad.fullScreen], ["move=arrows", "Ctrl+F"]);
    fs.rmSync(path.join(DATA, "flashpoint-pad.json"), { force: true });

    /* ---- no favourites: Flashpoint's own best first, without what its settings hide ---- */
    const libFile = path.join(DATA, "local-games.json"), favFile = path.join(root, "Data", "Playlists", "Favorites.json");
    const bestFile = path.join(root, "Data", "Playlists", "FlashpointSuperHallOfFame.json");
    const libKept = fs.readFileSync(libFile, "utf8"), favKept = fs.readFileSync(favFile);
    fs.writeFileSync(libFile, JSON.stringify(JSON.parse(libKept).filter((e) => !e.fpId)));
    fs.writeFileSync(favFile, JSON.stringify({ id: "x", title: "Favorites", games: [] }));
    fs.writeFileSync(bestFile, JSON.stringify({ id: "z", title: "Flashpoint Super Hall of Fame", games: [GAME_A, GAME_E, GAME_F].map((gameId) => ({ gameId })) }));
    fp = ((await api("api/extensions.php")).extensions || []).find((x) => x.id === "flashpoint") || {};
    check("with no favourites to bring in, Flashpoint's own Super Hall of Fame is offered first", [fp.next, fp.starter], ["bring", "FlashpointSuperHallOfFame.json"]);
    // End lands on the last card: Fan projects, with Tumultuous Productions' card put away (kept puts it back).
    await api("api/settings.php", { view: { showTumultuous: false } });
    await b.goto(BASE + "/");
    await b.waitFor(`!document.getElementById("syswall").hidden && document.querySelectorAll("#syswall .sel").length > 0`, 10000);
    await b.key("End");
    await b.settled();
    await b.key("ArrowLeft");
    await b.settled();
    await b.key("Enter");
    check("and its first button says so",
      await b.until(`((document.querySelector("#extpage .hero .bar button") || {}).textContent || "")`, "Bring in Flashpoint's best (3)", 10000), "Bring in Flashpoint's best (3)");
    await b.key("Escape");
    const best = await api("api/extensions.php", { bring: "flashpoint", playlist: "FlashpointSuperHallOfFame.json" });
    check("brought in without what Flashpoint's settings hide: a tag of an extreme group while extreme is not shown, a game marked broken; a tag of a group switched off comes",
      [best.ok, best.added, best.hidden, best.hiddenWhy], [true, 1, 2, { gore: 1, broken: 1 }]);
    fs.writeFileSync(libFile, libKept);
    fs.writeFileSync(favFile, favKept);
    fp = ((await api("api/extensions.php")).extensions || []).find((x) => x.id === "flashpoint") || {};
    check("with favourites in Flashpoint, they stay first: the best-of list is only in Other playlists", [fp.next, fp.starter], ["list", null]);
    fs.rmSync(bestFile, { force: true });

    /* ---- pages, and Flashpoint's own window --------------------------------------- */
    check("its website opens (a test copy opens nothing)", await api("api/extensions.php", { open: "flashpoint", which: "page" }),
      { ok: true, url: "https://flashpointarchive.org/", dry: true });
    check("an address the list does not name is never opened",
      [(await api("api/extensions.php", { open: "flashpoint", which: "listed" })).ok, (await api("api/extensions.php", { open: "https://example.org", which: "page" })).ok],
      [false, false]);
    const win = await api("api/extensions.php", { launcher: "flashpoint" });
    check("Flashpoint's own window is the one in its folder (a test copy opens nothing)",
      [win.ok, win.exe, win.dry], [true, path.join(root, "Launcher", "Flashpoint.exe"), true]);

    /* ---- the page ------------------------------------------------------------------ */
    await b.goto(BASE + "/");
    await b.waitFor(`!document.getElementById("syswall").hidden && document.querySelectorAll("#syswall .sel").length > 0`, 10000);
    await b.key("End");
    await b.settled();
    await b.key("ArrowLeft");
    await b.settled();
    check("Extensions is the card before Fan projects on the consoles screen",
      await b.until(`((document.querySelector("#syswall .sel") || {}).textContent || "").includes("Extensions")`, true, 3000), true);
    await b.key("Enter");
    check("Enter on it opens the page, in place of the consoles screen",
      [await b.waitFor(`!!document.getElementById("extpage") && !document.getElementById("extpage").hidden && document.querySelectorAll("#extpage .tile").length === 1`, 10000),
       await b.ev(`document.getElementById("syswall").hidden`)], [true, true]);
    check("Flashpoint under On this PC, its panel naming it, its first button the next thing to do",
      await b.until(`[[...document.querySelectorAll("#extpage .ghead")].map((h) => h.textContent), document.querySelector("#extpage .hero-name").textContent,
                      [...document.querySelectorAll("#extpage .hero .bar button")].map((x) => x.textContent)]`,
        [["On this PC1"], "Flashpoint Archive", ["Show its games", "Bring in new favourites", "Other playlists...", "Open Flashpoint", "Choose another folder...", "Website"]], 3000),
      [["On this PC1"], "Flashpoint Archive", ["Show its games", "Bring in new favourites", "Other playlists...", "Open Flashpoint", "Choose another folder...", "Website"]]);
    check("the legend says what the keys do here", await b.ev(`document.getElementById("help").textContent.includes("the panel's first button")`), true);
    await b.key("Enter");
    check("Show its games: the page goes and the Flashpoint list is up",
      await b.until(`[document.getElementById("extpage").hidden, document.getElementById("platform").value, !document.getElementById("main").hidden]`,
        [true, "Flashpoint", true], 8000), [true, "Flashpoint", true]);

    await b.setView("grid");               // the menu bar is in list and grid; the copy keeps this PC's own view
    await b.openBar("games");
    await b.menuItem(/Extensions/);
    check("Games > Extensions opens it from the games", await b.waitFor(`!document.getElementById("extpage").hidden && document.querySelectorAll("#extpage .tile").length === 1`, 10000));
    await b.key("Escape");
    check("and Escape goes back to them", await b.waitFor(`document.getElementById("extpage").hidden && !document.getElementById("main").hidden`, 5000));
    // Where the bar is not, the wordmark is the round X and carries its menus (js\views.js paintSeg).
    await b.setView("wheel");
    await b.clickSel("#brand-logo");
    await b.waitFor(`!!document.querySelector(".ctx")`, 3000);
    await b.menuItem(/^Games$/);
    await b.menuItem(/Extensions/);
    await b.waitFor(`!document.getElementById("extpage").hidden`, 10000);
    await b.clickSel("#brand-logo");
    await b.waitFor(`!!document.querySelector(".ctx")`, 3000);
    await b.menuItem(/^Games$/);
    await b.menuItem(/^Fan projects/);
    check("Fan projects from over it: one page up at a time",
      await b.until(`[document.getElementById("extpage").hidden, !document.getElementById("fanpage").hidden]`, [true, true], 8000), [true, true]);
    await b.key("Escape");

    /* ---- Get: Flashpoint from a stand-in of its makers' download, unpacked where chosen ---- */
    const fresh = zipOf([["Flashpoint Test/version.txt", Buffer.from("Flashpoint 14.0.3 Infinity - Test")],
                         ["Flashpoint Test/Data/flashpoint.sqlite", fs.readFileSync(path.join(root, "Data", "flashpoint.sqlite"))]]);
    const getUrl = "https://download.example.com/archive/Flashpoint%20Test.zip";
    put(getUrl, fresh);
    const withGet = list(sha256(relZip));
    withGet.extensions[0].get = { version: "14.0.3", file: "Flashpoint Test.zip", url: getUrl, size: fresh.length, sha256: sha256(fresh),
                                   listed: "https://flashpointarchive.org/downloads" };
    fs.writeFileSync(path.join(DATA, "extensions-list.json"), JSON.stringify(withGet));
    const into = path.join(fix, "new place");
    fs.mkdirSync(into, { recursive: true });
    check("Get asks where first, and never unpacks over a Flashpoint folder that has things in it",
      [(await api("api/extensions.php", { get: "flashpoint", into: "" })).ok, (await api("api/extensions.php", { get: "flashpoint", into: fix })).ok], [false, false]);
    const got = await api("api/extensions.php", { get: "flashpoint", into });
    const gotJob = await ended();
    check("Get: fetched, checked and unpacked into a Flashpoint folder where chosen, nothing else left beside it",
      [got.ok, gotJob && gotJob.state, fs.existsSync(path.join(into, "Flashpoint", "version.txt")), fs.readdirSync(into)], [true, "done", true, ["Flashpoint"]]);
    fp = ((await api("api/extensions.php")).extensions || []).find((x) => x.id === "flashpoint") || {};
    check("and that Flashpoint is the one found now, with its version and its helper still to fetch",
      [fp.folder, fp.version && fp.version.number, fp.next, (fp.put || {}).flashpoint], [path.join(into, "Flashpoint"), "14.0.3", "setup", path.join(into, "Flashpoint")]);
    // A Flashpoint whose own first start has not made its game list yet: still found, and opened once before anything else.
    fs.rmSync(path.join(into, "Flashpoint", "Data", "flashpoint.sqlite"));
    fs.mkdirSync(path.join(into, "Flashpoint", "Launcher"), { recursive: true });
    fs.writeFileSync(path.join(into, "Flashpoint", "Launcher", "Flashpoint.exe"), "");
    fp = ((await api("api/extensions.php")).extensions || []).find((x) => x.id === "flashpoint") || {};
    check("one with no game list yet is still found, and Open Flashpoint is first", [fp.section, fp.games, fp.next], ["here", null, "open"]);
  } finally {
    fs.rmSync(fix, { recursive: true, force: true });
    kept.restore();
  }
};
