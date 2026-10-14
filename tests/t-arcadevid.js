/* The Arcade Database's part of Pictures & Videos > Videos from online archives
 * (includes\arcadevid.php): one press asks the Arcade Database first for
 * arcade games, then the online archives for the rest.
 * Nothing goes online: XSEGON_ARCADEDB and XSEGON_ARCHIVE (tests\sandbox.js)
 * point at stand-in answers and tiny videos here, and what lands is compared
 * byte for byte with its stand-in.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { api, DATA, Guard, sleep } = require("./lib");

const FX = path.join(DATA, "fixtures", "arcadedb");
const IA = path.join(DATA, "fixtures", "archive");
const SET = "test-arcade-a";
const ARCADE = "Arcade", SNES = "Super Nintendo Entertainment System";
// The stand-in's address, written as tests/sandbox.js writes it: a video is fetched only from an address that starts so.
const SRC = "file:///" + FX.split(path.sep).join("/");

// A stand-in video: the first bytes of an MP4 and words of its own.
function video(words) {
  const box = (type, body) => { const head = Buffer.alloc(8); head.writeUInt32BE(8 + body.length, 0); head.write(type, 4, "latin1"); return Buffer.concat([head, body]); };
  return Buffer.concat([box("ftyp", Buffer.from("mp42\0\0\0\0mp42isom", "latin1")), box("moov", Buffer.from("stsd avc1 " + words))]);
}
const game = (n, title, platform, rom) => ({ id: "xs-scan-adtest" + n, title, platform, rom: path.join(FX, "roms", rom), added: new Date().toISOString() });

const GAMES = [
  game(1, "Alpha Fighter", ARCADE, "alphaf.zip"),              // the Arcade Database has its video, and so has the Archive's set
  game(2, "Beta Blaster", ARCADE, "betabu.zip"),               // another version of betab, which has the video
  game(3, "Gamma Run", ARCADE, "gammar.zip"),                  // the Arcade Database has none yet: the Archive's set has
  game(4, "Delta Drive", ARCADE, "deltad.zip"),                // a name the database does not know, and no archive has
  game(5, "Epsilon Wars", ARCADE, "Epsilon Wars (World).zip"), // a file not named as MAME names games: not asked about
  game(6, "Zeta Zone", ARCADE, "zetaz.zip"),                   // what comes for it is not a video
  game(7, "Eta Quest", SNES, "Eta Quest (USA).sfc"),           // no arcade game, and its console is not chosen
  game(8, "Alpha Fighter", ARCADE, "alphafj.zip"),             // another version of Alpha Fighter, with a video of its own there: the game still has one
];
// What the Arcade Database's stand-in knows: [the game it is a version of, has a video, what its video file holds].
const KNOWN = {
  alphaf: ["", true, "video"],
  alphafj: ["alphaf", true, "video"],
  betabu: ["betab", false, null],
  betab: ["", true, "video"],
  gammar: ["", false, null],
  zetaz: ["", true, "words"],
};
// What the Archive's one stand-in set holds, named as MAME names them.
const IN_SET = { "alphaf.mp4": video("alpha, the archive's own"), "gammar.mp4": video("gamma, the archive's own") };
const fileOf = (name) => path.join(FX, "videos", name + ".mp4");

function makeAll() {
  fs.rmSync(FX, { recursive: true, force: true });
  for (const d of ["roms", "videos", "query_mame"]) { fs.mkdirSync(path.join(FX, d), { recursive: true }); }
  for (const g of GAMES) { fs.writeFileSync(g.rom, "not a game, a stand-in"); }
  for (const name of Object.keys(KNOWN)) {
    const [parent, has, kind] = KNOWN[name];
    if (has) { fs.writeFileSync(fileOf(name), kind === "video" ? video(name + ", the arcade database's own") : Buffer.from("these are words, not a video")); }
    fs.writeFileSync(path.join(FX, "query_mame", name + ".json"), JSON.stringify({ release: 6, result: [{ index: 1, game_name: name, title: name, cloneof: parent,
      url_video_shortplay: has ? SRC + "/videos/" + name + ".mp4" : "", url_video_shortplay_hd: "", url_image_title: "https://elsewhere.example/never-fetched.png" }] }));
  }
  fs.writeFileSync(path.join(FX, "query_mame", "deltad.json"), JSON.stringify({ release: 6, result: [] }));
  allowance(250000);
  // The online archives' side: one set for the Arcade console, as tests\t-archivevid.js makes its own.
  const rows = [];
  for (const name of Object.keys(IN_SET)) {
    const file = path.join(IA, "download", SET, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, IN_SET[name]);
    rows.push({ name, source: "original", size: String(IN_SET[name].length), md5: crypto.createHash("md5").update(IN_SET[name]).digest("hex") });
  }
  fs.mkdirSync(path.join(IA, "metadata", SET), { recursive: true });
  fs.writeFileSync(path.join(IA, "metadata", SET, "files"), JSON.stringify({ result: rows }));
  fs.writeFileSync(path.join(DATA, "archivevid-sets.json"), JSON.stringify({ sets: [{ id: SET, folder: "arcade", whose: "ia-test", videos: 2, hevc: false }] }));
}
function allowance(files) {
  fs.writeFileSync(path.join(FX, "download_status.json"), JSON.stringify({ release: 1, result: { download_limit_files: files, download_limit_bytes: 40000000000 } }));
}

module.exports = async function (b, check) {
  const kept = new Guard(["scanned-games.json", "arcadevid-job.json", "archivevid-job.json", "archivevid-sets.json", "archivevid-none.json", "messages.json"]);
  const mineNow = () => api("api/arcadevid.php");
  const theirsNow = () => api("api/archivevid.php");
  // The one press, for the Arcade console; then both parts waited for: [the Arcade Database's job, the online archives' job].
  const press = () => api("api/archivevid.php", { fetch: [ARCADE] });
  const ended = async (ms) => {
    let m = {}, t = {};
    for (const end = Date.now() + ms; Date.now() < end;) {
      m = (await mineNow()).job || {};
      t = (await theirsNow()).job || {};
      if (m.state && m.state !== "running" && t.state && t.state !== "running") { break; }
      await sleep(120);
    }
    return [m, t];
  };
  const libRow = async (id) => ((await api("api/library.php?versions=all")).games || []).find((g) => g.id === id) || {};
  const place = (g) => path.join(DATA, "videos", g.platform, g.title + ".mp4");
  const arcadeDir = path.join(DATA, "videos", ARCADE);
  const is = (g, bytes) => fs.existsSync(place(g)) && fs.readFileSync(place(g)).equals(bytes);
  // Alpha Fighter is two versions of one game: its one video is whichever of the two was found first.
  const alphaIsTheDatabases = () => ["alphaf", "alphafj"].some((v) => is(GAMES[0], fs.readFileSync(fileOf(v))));
  const alphaFiles = () => fs.readdirSync(arcadeDir).filter((n) => /^Alpha Fighter/.test(n));
  const clear = () => { for (const g of GAMES) { fs.rmSync(place(g), { force: true }); } };
  const halfWritten = () => (fs.existsSync(arcadeDir) ? fs.readdirSync(arcadeDir).filter((f) => /\.(part|err)$/.test(f)).length : 0);

  try {
    makeAll();
    fs.rmSync(path.join(DATA, "arcadevid-job.json"), { force: true });
    fs.rmSync(path.join(DATA, "archivevid-job.json"), { force: true });
    fs.rmSync(path.join(DATA, "archivevid-none.json"), { force: true });
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), JSON.stringify(GAMES));

    /* ---- before any press ------------------------------------------------ */
    const first = await mineNow();
    check("the arcade games with no video are counted, and how many of them can be asked about by MAME's name",
      [first.ok, first.curl, first.job, first.need, first.named, first.unnamed], [true, true, null, 7, 6, 1]);
    check("it has no start of its own: asked for one, it names the one press there is",
      /asked as part of Pictures & Videos > Videos from online archives: start it there/.test((await api("api/arcadevid.php", { fetch: true })).error || ""), true);

    /* ---- the Arcade Database away: the press still fetches --------------- */
    fs.rmSync(path.join(FX, "download_status.json"));
    check("the one press starts", (await press()).started, true);
    let [mine, theirs] = await ended(60000);
    check("with the Arcade Database out of reach its part says so, and the online archives are asked for the arcade games all the same",
      [mine.state, /^the Arcade Database could not be reached \(is the internet there\?\): .* The online archives are asked for the arcade games as well\.$/.test(mine.error || ""),
       theirs.state, is(GAMES[0], IN_SET["alphaf.mp4"]), is(GAMES[2], IN_SET["gammar.mp4"])], ["failed", true, "done", true, true]);
    clear();
    allowance(0);
    [mine, theirs] = (await press()).started ? await ended(60000) : [{}, {}];
    check("and with its allowance used up it says to try again tomorrow, and the archives go on",
      [/giving no more files for now.*Try again tomorrow\. The online archives are asked/.test(mine.error || ""), theirs.state, is(GAMES[2], IN_SET["gammar.mp4"])], [true, "done", true]);
    clear();
    allowance(250000);

    /* ---- the one press, both there --------------------------------------- */
    [mine, theirs] = (await press()).started ? await ended(60000) : [{}, {}];
    check("the Arcade Database's part ends saying how many videos came from it and that the archives are asked for the rest: never a count of games beside a count of videos",
      [mine.state, mine.games, mine.added, mine.asked, (mine.said || "").replace(/, \d+ MB in \d+ s\./, ", so many MB in so many s.")],
      ["done", 6, 2, 6, "2 videos came from the Arcade Database (adb.arcadeitalia.net), so many MB in so many s. None came for 4 other arcade games. The online archives are asked for those next."]);
    const why = (title) => ((mine.none || []).find((g) => g.title === title) || {}).why || "";
    check("its job keeps why each of the others got none from it",
      [why("Gamma Run"), why("Delta Drive"), /not named the way MAME names a game \(sf2\.zip\), so the Arcade Database was not asked about it$/.test(why("Epsilon Wars")),
       /^its video could not be fetched: what came is not a video a browser can play$/.test(why("Zeta Zone"))],
      ["the Arcade Database has no video of it yet", "the Arcade Database knows no game named deltad", true, true]);
    check("one video a game, the first found: the Arcade Database's, though the archives' set holds one of that game too",
      [alphaIsTheDatabases(), is(GAMES[0], IN_SET["alphaf.mp4"])], [true, false]);
    check("two versions of one game have one video between them: one file, and the second version was never asked about",
      [alphaFiles(), (mine.none || []).some((g) => g.title === "Alpha Fighter")], [["Alpha Fighter.mp4"], false]);
    check("a version with no video of its own got the video of the game it is a version of", is(GAMES[1], fs.readFileSync(fileOf("betab"))), true);
    check("then the online archives' part ran by itself and filled what the Arcade Database had none of",
      [theirs.state, is(GAMES[2], IN_SET["gammar.mp4"]), /^1 of 4 games with no video got one from the online archives/.test(theirs.said || "")], ["done", true, true]);
    check("what was not a video was not kept, and nothing half written or waiting is left by either part",
      [fs.existsSync(place(GAMES[5])), halfWritten(), ["arcadevid-tmp", "arcadevid-stop", "archivevid-tmp", "archivevid-stop"].filter((f) => fs.existsSync(path.join(DATA, f)))], [false, 0, []]);
    check("a game of a console that was not chosen was left alone", [fs.existsSync(place(GAMES[6])), (mine.none || []).some((g) => g.title === "Eta Quest")], [false, false]);
    const rows = await Promise.all(GAMES.map((g) => libRow(g.id)));
    check("the library says so: three games have a video, both versions of the first, and the rest do not", rows.map((r) => r.hasVideo), [true, true, true, false, false, false, false, true]);

    /* ---- the corner, and a second press ---------------------------------- */
    const bars = ((await api("api/jobs.php")).jobs || []).filter((j) => j.key === "arcadevid" || j.key === "archivevid").map((j) => j.name + ": " + j.state).sort();
    check("each part is a bar of the corner's, under its source's name", bars, ["Arcade Database videos: done", "Videos from online archives: done"]);
    check("asking its part to stop when nothing is at work stops nothing", (await api("api/arcadevid.php", { stop: true })).stopping, false);
    [mine, theirs] = (await press()).started ? await ended(60000) : [{}, {}];
    check("a second press brings nothing new, says so in words that hold no count to misread, and the games keep their video",
      [mine.added, mine.said, theirs.state, alphaIsTheDatabases(), is(GAMES[2], IN_SET["gammar.mp4"])],
      [0, "No video came from the Arcade Database (adb.arcadeitalia.net) for the 3 arcade games with none. The online archives are asked for those next.", "done", true, true]);

    /* ---- the window names it --------------------------------------------- */
    if (b) {
      await b.goto();
      await b.setView("grid");
      await b.openBar("media");
      await b.menuItem(/^Videos from online archives/);
      check("the window of the one press names the Arcade Database and its maker, as they ask",
        await b.until(`/Arcade games are asked of the Arcade Database \\(adb\\.arcadeitalia\\.net, by motoschifo\\) first/.test((document.querySelector("#editor .group-help") || {}).textContent || "")`, true, 8000), true);
      await b.key("Escape");
    }
  } finally {
    for (const g of GAMES) { for (const end of ["", ".part", ".part.err", ".adb.part", ".adb.part.err"]) { fs.rmSync(place(g) + end, { force: true }); } }
    try { fs.rmdirSync(arcadeDir); } catch (e) { /* the copy's own videos are in it */ }
    fs.rmSync(FX, { recursive: true, force: true });
    fs.rmSync(path.join(IA, "download", SET), { recursive: true, force: true });
    fs.rmSync(path.join(IA, "metadata", SET), { recursive: true, force: true });
    for (const f of ["arcadevid-stop", "archivevid-stop"]) { fs.rmSync(path.join(DATA, f), { force: true }); }
    for (const f of ["arcadevid-tmp", "archivevid-tmp"]) { fs.rmSync(path.join(DATA, f), { recursive: true, force: true }); }
    kept.restore();
  }
};
