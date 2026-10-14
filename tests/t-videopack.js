/* Videos for the games here from a package made on another PC (includes\videopack.php):
 * Pictures & Videos > Export Games with No videos, and Import Xsegon Video Package.
 *
 * Nothing real is read or written: the games, their files and the videos are
 * stand-ins in the test's own data. The package is written with Xsegon's own
 * zip writer in the form a package from another PC has (tests\vpack-probe.php);
 * making one from a folder of videos is not tested here.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { api, BASE, DATA, Guard, sleep } = require("./lib");

const FX = path.join(DATA, "fixtures", "videopack");
const VIDEOS = path.join(FX, "videos"), ROMS = path.join(FX, "roms"), OUT = path.join(FX, "out");
const PSX = "Sony Playstation", SNES = "Super Nintendo Entertainment System";

// A stand-in video: the first bytes of an MP4, the codec named where a real one names it, and words of its own.
function video(file, codec, words) {
  const box = (type, body) => { const head = Buffer.alloc(8); head.writeUInt32BE(8 + body.length, 0); head.write(type, 4, "latin1"); return Buffer.concat([head, body]); };
  const ftyp = box("ftyp", Buffer.from("mp42\0\0\0\0mp42isom", "latin1"));
  const moov = box("moov", Buffer.concat([Buffer.from("stsd"), Buffer.alloc(12), Buffer.from(codec), Buffer.from(" " + words)]));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([ftyp, moov]));
}
const game = (n, title, platform, rom) => ({ id: "xs-scan-vptest" + n, title, platform, rom: path.join(ROMS, rom), added: new Date().toISOString() });

const GAMES = [
  game(1, "Alpha Game", PSX, "Alpha Game (USA).cue"),
  game(2, "Beta Racer", PSX, "broadcast.cue"),
  game(3, "The Gamma Quest", SNES, "gq.sfc"),
  game(4, "Delta Force II", SNES, "dforce.sfc"),
  game(5, "Epsilon Wars", SNES, "ew.sfc"),                       // not in the package
  game(6, "Zeta Blaster", "Nintendo Switch", "zeta.nsp"),        // not in the package
  game(7, "Eta Kart", PSX, "Eta Kart (USA).cue"),
  game(8, "Theta Ball", PSX, "Theta Ball (USA).cue"),            // gets a video of its own before the import
];
const GONE = { id: "xs-scan-vptestgone", title: "Iota Nowhere", platform: PSX, file: "Iota Nowhere (USA).cue" };   // in the package, not in this library

const filesOf = (dir) => !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { recursive: true }).map(String).sort()
  .map((f) => { const st = fs.statSync(path.join(dir, f)); return f + ":" + (st.isFile() ? st.size + "/" + st.mtimeMs : "dir"); });

module.exports = async function (b, check) {
  const kept = new Guard(["scanned-games.json", "videopack-job.json"]);
  const stop = path.join(DATA, "videopack-stop");
  const get = (q) => api("api/videopack.php" + (q || ""));
  const post = (body) => api("api/videopack.php", body);
  const ended = async (ms) => { let j = null; for (const end = Date.now() + ms; Date.now() < end;) { j = (await get()).job; if (j && j.state !== "running") { break; } await sleep(120); } return j || {}; };
  const libRow = async (id) => ((await api("api/library.php?versions=all")).games || []).find((g) => g.id === id) || {};
  const added = [];                       // videos this run put into the copy's videos folder, taken away at the end
  const place = (g, ext) => path.join(DATA, "videos", g.platform, g.title + (ext || ".mp4"));

  try {
    fs.rmSync(FX, { recursive: true, force: true });
    for (const g of GAMES) { fs.mkdirSync(ROMS, { recursive: true }); fs.writeFileSync(g.rom, "not a game, a stand-in"); }
    fs.rmSync(path.join(DATA, "videopack-job.json"), { force: true });
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), JSON.stringify(GAMES));

    /* ---- the list of the games with no video ------------------------------ */
    const need = await get("?need=1");
    check("the games here with no video are counted, and the list's name carries the day and nothing of this computer",
      [need.ok, need.need >= GAMES.length, /^xsegon-no-videos-\d{4}-\d\d-\d\d\.json$/.test(need.name || "")], [true, true, true]);
    const res = await fetch(BASE + "/api/videopack.php?export=1");
    const doc = JSON.parse(Buffer.from(await res.arrayBuffer()).toString("utf8"));
    check("the export is a file to keep, named the same", [/attachment; filename="xsegon-no-videos-/.test(res.headers.get("content-disposition") || ""), res.headers.get("cache-control")], [true, "no-store"]);
    const listed = (id) => (doc.games || []).find((g) => g.id === id) || {};
    check("it says what it is, and carries each game's title, console and file name, never a folder and never this computer's name",
      [doc.xsegon, doc.games.length, listed(GAMES[0].id).title, listed(GAMES[0].id).platform, listed(GAMES[0].id).file, JSON.stringify(doc).includes("fixtures"),
       Object.keys(doc).sort()],
      ["games-with-no-videos", need.need, "Alpha Game", PSX, "Alpha Game (USA).cue", false, ["games", "made", "note", "version", "xsegon"]]);
    check("and says where a package made from it goes in", /Import Xsegon Video Package/.test(doc.note || ""), true);
    check("nothing was started by any of that", (await get()).job, null);

    /* ---- a package from another PC ---------------------------------------- */
    const into = [GAMES[0], GAMES[1], GAMES[2], GAMES[3], GAMES[6], GAMES[7], GONE];
    const rows = into.map((g) => {
      const from = path.join(VIDEOS, g.platform, g.title + " (USA).mp4");
      video(from, "avc1", g.title.toLowerCase());
      return { id: g.id, title: g.title, platform: g.platform, file: path.basename(g.rom || g.file), video: "videos/" + g.platform + "/" + g.title + ".mp4", from, how: "same title" };
    });
    fs.mkdirSync(OUT, { recursive: true });
    const manifest = path.join(FX, "manifest.json");
    fs.writeFileSync(manifest, JSON.stringify({ xsegon: "video-package", version: 1, made: new Date().toISOString(), games: rows.map((r) => Object.assign({}, r, { from: path.basename(r.from) })), none: [] }));
    const zip = path.join(OUT, "xsegon-videos-test.zip");
    const phpExe = ((await api("api/status.php")).build || {}).phpExe;
    const made = execFileSync(phpExe, [path.join(__dirname, "vpack-probe.php"), zip, manifest].concat(...rows.map((r) => [r.video, r.from])), { encoding: "utf8", windowsHide: true });
    check("a package is made for the test with Xsegon's own zip writer", made.trim(), "ok");

    /* ---- the package's videos onto the games here ------------------------- */
    video(place(GAMES[7]), "avc1", "theta's own, got in the meantime");
    added.push(place(GAMES[7]));
    const thetaOwn = fs.readFileSync(place(GAMES[7]));
    check("a file that is no package is refused in words",
      [/not a \.zip that can be read/.test((await post({ take: manifest })).error || ""), /not there/.test((await post({ take: path.join(OUT, "nope.zip") })).error || "")], [true, true]);
    for (const g of [GAMES[0], GAMES[1], GAMES[2], GAMES[3], GAMES[6]]) { added.push(place(g)); }
    check("the import starts", (await post({ take: zip })).started, true);
    const took = await ended(30000);
    check("and ends saying how many games got a video, how many kept their own, and how many are not here",
      [took.state, took.kind, took.added, took.had, took.absent, took.bad, took.said],
      ["done", "import", 5, 1, 1, 0, "5 games now have a video from the package: 1 game already had a video and kept it, 1 video is for a game not in this library"]);
    check("each video lies where a video is found by name, under its console and the game's title, with nothing half written",
      filesOf(path.join(DATA, "videos")).map((f) => f.split(":")[0]).filter((f) => /\.(mp4|part)$/.test(f) && /Alpha|Beta|Gamma|Delta|Eta Kart|Theta|Iota/.test(f)).sort(),
      [GAMES[0], GAMES[1], GAMES[2], GAMES[3], GAMES[6], GAMES[7]].map((g) => path.join(g.platform, g.title + ".mp4")).sort());
    const libRows = await Promise.all(GAMES.map((g) => libRow(g.id)));
    check("the library says so: the five have a video, the two that were not in the package do not", libRows.map((r) => r.hasVideo), [true, true, true, true, false, false, true, true]);
    check("and it is the very video the package carried", fs.readFileSync(place(GAMES[0])).equals(fs.readFileSync(rows[0].from)), true);
    check("a game that got a video in the meantime keeps its own", fs.readFileSync(place(GAMES[7])).equals(thetaOwn), true);
    check("a second import of the same package adds nothing",
      [(await post({ take: zip })).started, (await ended(30000)).said], [true, "No game got a video from the package: 6 games already had a video and kept it, 1 video is for a game not in this library"]);
    check("the stop file is gone after each job", fs.existsSync(stop), false);

    /* ---- the corner bar --------------------------------------------------- */
    const jobs = (await api("api/jobs.php")).jobs || [];
    const bar = jobs.find((j) => j.key === "videopack") || {};
    check("the job is one of the corner's, said as done with its last words", [bar.name, bar.state, /No game got a video/.test(bar.said || "")], ["Import videos", "done", true]);
  } finally {
    for (const f of added) { fs.rmSync(f, { force: true }); fs.rmSync(f + ".part", { force: true }); }
    for (const p of [PSX, SNES, "Nintendo Switch"]) { try { fs.rmdirSync(path.join(DATA, "videos", p)); } catch (e) { /* the person's own videos are in it */ } }
    fs.rmSync(FX, { recursive: true, force: true });
    fs.rmSync(stop, { force: true });
    kept.restore();
  }
};
