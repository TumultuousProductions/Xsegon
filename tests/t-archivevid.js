/* Videos for the games with none, from the online archives (includes\archivevid.php):
 * Pictures & Videos > Videos from online archives.
 * Nothing goes online: XSEGON_ARCHIVE (tests\sandbox.js) points at stand-in sets,
 * tiny videos and a World of Longplays list here, XSEGON_FFMPEG at a stand-in
 * cutter that copies, and the sets are the test's own data\archivevid-sets.json.
 * What lands is compared byte for byte with its stand-in.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { api, DATA, Guard, sleep } = require("./lib");

const FX = path.join(DATA, "fixtures", "archive");
const PSX = "Sony Playstation", SNES = "Super Nintendo Entertainment System", N64 = "Nintendo 64";

// A stand-in video: the first bytes of an MP4 and words of its own.
function video(words) {
  const box = (type, body) => { const head = Buffer.alloc(8); head.writeUInt32BE(8 + body.length, 0); head.write(type, 4, "latin1"); return Buffer.concat([head, body]); };
  return Buffer.concat([box("ftyp", Buffer.from("mp42\0\0\0\0mp42isom", "latin1")), box("moov", Buffer.from("stsd avc1 " + words))]);
}
const game = (n, title, platform, rom) => ({ id: "xs-scan-avtest" + n, title, platform, rom: path.join(FX, "roms", rom), added: new Date().toISOString() });

const GAMES = [
  game(1, "Alpha Game", PSX, "Alpha Game (USA).cue"),          // its file's own name
  game(2, "Beta Racer", PSX, "broadcast.cue"),                 // its title, in a name written without spaces
  game(3, "The Gamma Quest", SNES, "gq.sfc"),                  // its title, the article moved
  game(4, "Delta Force", SNES, "Delta Force (USA).sfc"),       // its video arrives damaged
  game(5, "Epsilon Wars", SNES, "ew.sfc"),                     // only a similar name: left out
  game(6, "Eta Kart", PSX, "Eta Kart (USA).cue"),              // in no set: a playthrough fills the gap
  game(7, "Zeta Blaster", "Nintendo Switch", "zeta.nsp"),      // a console with no set at all: playthroughs alone
  game(8, "Theta Ball", N64, "Theta Ball (USA).z64"),          // its set's list will not come
  game(9, "Kappa Fighter", "Nintendo Switch", "kappa.nsp"),    // its recording has no smaller copy to cut from
  game(10, "Lambda Golf", "Nintendo Switch", "lambda.nsp"),    // its cut will fail: the recording is gone
  game(11, "Iota Pilot", "Philips CD-i", "iota.chd"),          // a console the online archives have nothing for
];
const SETS = [
  { id: "test-psx-a", folder: "psx", whose: "ia-test", videos: 2, hevc: false,
    files: { "Alpha Game (USA).mp4": "alpha", "sub folder/betaracerusa.mp4": "beta", "Alpha Game (USA).txt": null } },
  { id: "test-snes-a", folder: "snes", whose: "ia-test", videos: 3, hevc: false,
    files: { "Gamma Quest, The (USA).mp4": "gamma", "Delta Force (USA).mp4": "delta", "Epsilon Wars - The Return (USA).mp4": "epsilon's sequel" } },
  { id: "test-n64-gone", folder: "n64", whose: "ia-test", videos: 1, hevc: false, files: null },
];
// World of Longplays' stand-ins: one item a recording, the console said before "Longplay".
const WOL = [
  { id: "test-wol-zeta", title: "Switch Longplay [001] Zeta Blaster US", who: "Tester One", file: "zeta.ia.mp4", words: "zeta's playthrough" },
  { id: "test-wol-eta", title: "PSX Longplay [002] Eta Kart", who: "Tester Two", file: "eta.ia.mp4", words: "eta's playthrough" },
  { id: "test-wol-eta2", title: "PSX Longplay [003] Eta Kart (Disc 2 of 2)", who: "Tester Two", file: "eta2.ia.mp4", words: "a later disc: never taken" },
  { id: "test-wol-kappa", title: "Switch Longplay [004] Kappa Fighter", who: "Tester Three", file: null, words: "" },
  { id: "test-wol-lambda", title: "Switch Longplay [005] Lambda Golf", who: "Tester Four", file: "lambda.ia.mp4", words: null },
  { id: "test-wol-junk", title: "A page with no console word", who: "", file: null, words: "" },
];

function makeAll() {
  fs.rmSync(FX, { recursive: true, force: true });
  fs.mkdirSync(path.join(FX, "roms"), { recursive: true });
  for (const g of GAMES) { fs.writeFileSync(g.rom, "not a game, a stand-in"); }
  for (const s of SETS) {
    if (!s.files) { continue; }
    const rows = [];
    for (const name of Object.keys(s.files)) {
      const bytes = s.files[name] === null ? Buffer.from("not a video") : video(s.files[name]);
      const file = path.join(FX, "download", s.id, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
      // Delta's checksum is another file's: what arrives is not what the list promised.
      rows.push({ name, source: "original", size: String(bytes.length), md5: /Delta/.test(name) ? "0".repeat(32) : crypto.createHash("md5").update(bytes).digest("hex") });
    }
    rows.push({ name: "Alpha Game (USA).ia.mp4", source: "derivative", size: "9", md5: "" });   // the Archive's own re-made copy: never taken
    fs.mkdirSync(path.join(FX, "metadata", s.id), { recursive: true });
    fs.writeFileSync(path.join(FX, "metadata", s.id, "files"), JSON.stringify({ result: rows }));
  }
  fs.writeFileSync(path.join(DATA, "archivevid-sets.json"), JSON.stringify({ sets: SETS.map((s) => Object.assign({}, s, { files: undefined })) }));
  // World of Longplays: the collection's list, each recording's description, and the recordings themselves.
  fs.writeFileSync(path.join(FX, "scrape.json"), JSON.stringify({ items: WOL.map((w) => ({ identifier: w.id, title: w.title })), count: WOL.length, total: WOL.length }));
  for (const w of WOL) {
    const files = [{ name: "about.txt", source: "original", size: "9" }];
    if (w.file) { files.push({ name: w.file, source: "derivative", size: "9" }); }
    fs.writeFileSync(path.join(FX, "metadata", w.id), JSON.stringify({ metadata: { creator: w.who }, files }));
    if (w.file && w.words !== null) {
      fs.mkdirSync(path.join(FX, "download", w.id), { recursive: true });
      // Padded past 4 KB: the worker refuses a cut smaller than that as no real snap.
      fs.writeFileSync(path.join(FX, "download", w.id, w.file), Buffer.concat([video(w.words), Buffer.alloc(8192)]));
    }
  }
  // The cutter's stand-in (XSEGON_FFMPEG): "cuts" by copying the whole tiny recording.
  fs.writeFileSync(path.join(FX, "cutter.php"), [
    "<?php",
    "$url = '';",
    "$args = array_slice($argv, 1);",
    "foreach ($args as $i => $a) { if ($a === '-i') { $url = (string) ($args[$i + 1] ?? ''); } }",
    "$to = $args === [] ? '' : (string) end($args);",
    "$path = preg_match('~^file:///(.+)$~', $url, $m) ? rawurldecode($m[1]) : $url;",
    "$body = $path === '' ? false : @file_get_contents($path);",
    "if ($body === false || $to === '') { fwrite(STDERR, 'the recording could not be read' . PHP_EOL); exit(1); }",
    "file_put_contents($to, $body);",
    "exit(0);",
    "",
  ].join("\n"));
}

module.exports = async function (b, check) {
  const kept = new Guard(["scanned-games.json", "archivevid-sets.json", "archivevid-job.json", "archivevid-none.json", "messages.json"]);
  const looked = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, "archivevid-none.json"), "utf8")); } catch (e) { return {}; } };
  const noVideoMail = async () => ((await api("api/news.php")).messages || []).filter((m) => m.key === "archivevid:none");
  const get = () => api("api/archivevid.php");
  const post = (body) => api("api/archivevid.php", body);
  const ended = async (ms) => { let j = null; for (const end = Date.now() + ms; Date.now() < end;) { j = (await get()).job; if (j && j.state !== "running") { break; } await sleep(120); } return j || {}; };
  const libRow = async (id) => ((await api("api/library.php?versions=all")).games || []).find((g) => g.id === id) || {};
  const place = (g) => path.join(DATA, "videos", g.platform, g.title + ".mp4");
  const from = (set, name) => fs.readFileSync(path.join(FX, "download", set, name));
  const mine = [GAMES[0], GAMES[1], GAMES[2], GAMES[3], GAMES[5], GAMES[6], GAMES[8], GAMES[9]].map(place);

  try {
    makeAll();
    fs.rmSync(path.join(DATA, "archivevid-job.json"), { force: true });
    fs.rmSync(path.join(DATA, "archivevid-none.json"), { force: true });
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), JSON.stringify(GAMES));

    /* ---- what the window opens on: nothing asked of the Archive yet ------- */
    const first = await get();
    const con = (name) => (first.consoles || []).find((c) => c.platform === name) || {};
    check("the consoles with games that have no video are counted, with what the online archives have for each",
      [first.ok, first.curl, first.ffmpeg, first.job, con(PSX).need >= 3, con(PSX).sets, con(PSX).videos, con(SNES).sets, con(SNES).videos,
       con("Nintendo Switch").sets, con("Nintendo Switch").wol, con("Philips CD-i").wol],
      [true, true, true, null, true, 1, 2, 1, 3, 0, true, false]);
    check("the consoles the online archives have videos for come first",
      (first.consoles || []).map((c) => c.sets > 0 || c.wol).join().replace(/^(true,?)+(false,?)*$/, "in order"), "in order");
    check("a start with no console is refused in words, and so is one for a console the archives have nothing for",
      [/select a console the online archives have videos for first/.test((await post({ fetch: [] })).error || ""),
       /select a console the online archives have videos for first/.test((await post({ fetch: ["Philips CD-i"] })).error || "")], [true, true]);
    check("nothing was started by any of that", (await get()).job, null);

    /* ---- the fetch ------------------------------------------------------- */
    check("the fetch starts", (await post({ fetch: [PSX, SNES, N64, "Nintendo Switch"] })).started, true);
    const done = await ended(60000);
    check("and ends saying how many games got a video, how many are playthrough cuts, how many got none, and that a list would not come",
      [done.state, done.sets, done.added, /^5 of \d+ games with no video got one from the online archives \(/.test(done.said || ""),
       /; 2 are the first 30 seconds of a World of Longplays playthrough\)/.test(done.said || ""),
       /got none: Pictures & Videos > Videos from online archives lists them\./.test(done.said || ""), /1 of the Archive's lists would not come/.test(done.said || "")],
      ["done", 3, 5, true, true, true, true]);
    const why = (title) => ((done.none || []).find((g) => g.title === title) || {}).why || "";
    check("the games that got none are listed with why, the sets' reason and World of Longplays' side by side",
      [/similar name was found, and that is left out: Epsilon Wars - The Return \(USA\)\.mp4/.test(why("Epsilon Wars")),
       /could not be fetched: it did not arrive whole/.test(why("Delta Force")),
       /World of Longplays has no recording of this console's games$/.test(why("Delta Force")),
       why("Theta Ball"), why("Kappa Fighter"), why("Lambda Golf")],
      [true, true, true,
       "no videos for this console on the Internet Archive; World of Longplays has no recording of this console's games",
       "its playthrough could not be used: the recording has no smaller copy to cut from",
       "its playthrough could not be cut: the recording could not be read"]);
    const told = await noVideoMail();
    check("one message says how many got none, which console the Archive has nothing for, and the way on with Skraper",
      [told.length, /^\d+ games got no video$/.test((told[0] || {}).title || ""), /It has none at all for .*Nintendo 64 \(\d+\)/.test((told[0] || {}).body || ""),
       /Skraper, a free program, can fetch videos for them with a free ScreenScraper account\.$/.test((told[0] || {}).body || ""), (told[0] || {}).opens,
       ((told[0] || {}).consoles || []).some((c) => c.platform === N64 && /videos.Nintendo 64$/.test(c.folder))],
      [1, true, true, true, ["skraper", "archivevid"], true]);
    check("each video lies where a video is found by name, and is the Archive's own file, byte for byte",
      [fs.readFileSync(place(GAMES[0])).equals(from("test-psx-a", "Alpha Game (USA).mp4")), fs.readFileSync(place(GAMES[1])).equals(from("test-psx-a", "sub folder/betaracerusa.mp4")),
       fs.readFileSync(place(GAMES[2])).equals(from("test-snes-a", "Gamma Quest, The (USA).mp4"))], [true, true, true]);
    check("a gap no set covers is filled from a playthrough: on a console with a set, and on one with none",
      [fs.readFileSync(place(GAMES[5])).equals(from("test-wol-eta", "eta.ia.mp4")), fs.readFileSync(place(GAMES[6])).equals(from("test-wol-zeta", "zeta.ia.mp4"))], [true, true]);
    check("the damaged one was not kept, and nothing half written is left",
      [fs.existsSync(place(GAMES[3])), fs.readdirSync(path.join(DATA, "videos", SNES)).filter((f) => /\.(part|err)$/.test(f)).length,
       fs.existsSync(path.join(DATA, "videos", "Nintendo Switch")) ? fs.readdirSync(path.join(DATA, "videos", "Nintendo Switch")).filter((f) => /\.(part|err)$/.test(f)).length : 0,
       fs.existsSync(path.join(DATA, "archivevid-tmp")), fs.existsSync(path.join(DATA, "archivevid-stop"))], [false, 0, 0, false, false]);
    const rows = await Promise.all(GAMES.map((g) => libRow(g.id)));
    check("the library says so: the five have a video, the rest do not", rows.map((r) => r.hasVideo),
      [true, true, true, false, false, true, true, false, false, false, false]);
    check("a game the online archives were asked for and had nothing for is kept as looked for, with why; one whose fetch or cut failed, or whose console's list would not come, is not",
      [!!looked()[GAMES[4].id], /similar name was found/.test((looked()[GAMES[4].id] || {}).why || ""),
       [GAMES[3], GAMES[7], GAMES[8], GAMES[9]].filter((g) => looked()[g.id]).map((g) => g.title)], [true, true, []]);
    check("the window's answer lists it apart, with why and when",
      ((await get()).looked || []).some((g) => g.title === "Epsilon Wars" && g.platform === SNES && /similar name/.test(g.why) && g.at > 0), true);

    /* ---- the corner bar, and a second fetch ------------------------------ */
    const bar = ((await api("api/jobs.php")).jobs || []).find((j) => j.key === "archivevid") || {};
    check("the job is one of the corner's, said as done with its last words", [bar.name, bar.state, /^5 of \d+ games/.test(bar.said || "")], ["Videos from online archives", "done", true]);
    check("asking to stop when nothing is at work stops nothing", (await post({ stop: true })).stopping, false);
    check("a second fetch brings nothing new", [(await post({ fetch: [PSX] })).started, (await ended(60000)).added], [true, 0]);
    check("and its message takes the place of the first fetch's: one, not two", (await noVideoMail()).length, 1);
    check("a fetch for its console leaves it out: the one whose fetch failed is asked again, the one kept as looked for is not",
      [(await post({ fetch: [SNES] })).started, ((await ended(60000)).none || []).map((g) => g.title).filter((t) => t === "Delta Force" || t === "Epsilon Wars")],
      [true, ["Delta Force"]]);
    check("the games that had a video kept theirs", fs.readFileSync(place(GAMES[0])).equals(from("test-psx-a", "Alpha Game (USA).mp4")), true);

    /* ---- the window ------------------------------------------------------ */
    if (b) {
      fs.rmSync(place(GAMES[2]), { force: true });
      // Eta's cut too: with it in place PlayStation has no gap and no row to press.
      fs.rmSync(place(GAMES[5]), { force: true });
      await b.goto();
      await b.setView("grid");
      await b.openBar("media");
      await b.menuItem(/^Videos from online archives/);
      check("Videos from online archives opens its window", await b.until(`(document.querySelector("#editor .panel-title") || {}).textContent`, "VIDEOS FROM ONLINE ARCHIVES", 8000), "VIDEOS FROM ONLINE ARCHIVES");
      check("with a box of consoles and a box to fetch, every console selected, and no line lit",
        await b.ev(`[[...document.querySelectorAll("#editor .pj-head")].map(x => x.textContent).slice(0, 2), [...new Set([...document.querySelectorAll("#editor .pj-row .pj-set")].map(x => x.textContent))], document.querySelectorAll("#editor .pj-row.at").length]`),
        [["Consoles with games that have no video", "Fetch"], ["✓ Selected", "Start", "Look again", "Show"], 0]);
      check("the box says they are selected already, and what a press on a console's button does",
        await b.ev(`/^(All \\d+ are|It is) selected\\. Press a console's button to leave it out, and again to take it back\\.$/.test((document.querySelector("#editor .pj-note") || {}).textContent || "")`), true);
      check("a console served by playthroughs alone says so on its line",
        await b.ev(`/the first 30 seconds of a World of Longplays playthrough/.test([...document.querySelectorAll("#editor .pj-row")].find(r => r.querySelector(".pj-job").textContent === "Nintendo Switch").querySelector(".pj-hint").textContent)`), true);
      check("the consoles the archives have nothing for are named in one line", await b.ev(`/The online archives have nothing for: .*Philips CD-i \\(1\\)/.test(document.querySelector("#editor .mt-note").textContent)`), true);
      const rowOf = (name) => `[...document.querySelectorAll("#editor .pj-row")].find(r => r.querySelector(".pj-job").textContent === ${JSON.stringify(name)})`;
      // The test copy carries real games too, so how many consoles are served is read, not assumed.
      const before = await b.ev(`((${rowOf("Fetch the videos")}.querySelector(".pj-hint").textContent.match(/on (\\d+) consoles?/) || [])[1]) || "0"`);
      await b.ev(`${rowOf(PSX)}.querySelector(".pj-set").click()`);
      check("a press on a console's button leaves it out, and the last line counts one console fewer",
        await b.until(`${rowOf(PSX)}.querySelector(".pj-set").textContent + "|" + /on ${before - 1} consoles?\\./.test(${rowOf("Fetch the videos")}.querySelector(".pj-hint").textContent)`, "Not selected|true"), "Not selected|true");
      await b.ev(`${rowOf(N64)}.querySelector(".pj-set").click()`);
      await b.until(`${rowOf(N64)}.querySelector(".pj-set").textContent`, "Not selected");
      await b.ev(`${rowOf("Fetch the videos")}.querySelector(".pj-set").click()`);
      check("Start closes the window: the job is the corner's from there", await b.until(`document.getElementById("editor").hidden`, true, 8000), true);
      check("and the corner says how it ended", await b.until(`/1 of \\d+ games with no video got one from the online archives/.test(document.getElementById("strip").textContent)`, true, 60000), true);
      check("the video is there again", fs.readFileSync(place(GAMES[2])).equals(from("test-snes-a", "Gamma Quest, The (USA).mp4")), true);
      await b.openBar("media");
      await b.menuItem(/^Videos from online archives/);
      const names = `[...document.querySelectorAll("#editor .cr-row .cr-name")].map(x => x.textContent)`;
      check("opened again, the last fetch lists the game that may still come (its fetch failed), and not the one kept as looked for",
        [await b.until(`${names}.includes("Delta Force")`, true, 8000), await b.ev(`${names}.includes("Epsilon Wars")`)], [true, false]);
      const lookedHead = `[...document.querySelectorAll("#editor .pj-head")].map(x => x.textContent).find(t => /^Looked for, no video found/.test(t)) || ""`;
      check("the games looked for with nothing found have a box of their own at the bottom, folded away",
        [/^Looked for, no video found \(\d+\)$/.test(await b.ev(lookedHead)), /^Folded away\. \d+ games?, last looked for on /.test(await b.ev(`${rowOf("The games")}.querySelector(".pj-hint").textContent`))],
        [true, true]);
      await b.ev(`${rowOf("The games")}.querySelector(".pj-set").click()`);
      check("Show unfolds them, each with why",
        await b.until(`[...document.querySelectorAll("#editor .cr-row")].some(r => r.querySelector(".cr-name").textContent === "Epsilon Wars" && /similar name/.test(r.querySelector(".sv-sub").textContent))`, true, 5000), true);
      await b.ev(`[...document.querySelectorAll("#editor .pj-set")].find(x => x.textContent === "Look again").click()`);
      check("Look again puts them back: the box goes, the strip says so, and the next Start asks for them again",
        [await b.until(`!(${lookedHead})`, true, 8000),
         await b.until(`/back on the list: Start asks the online archives for (it|them) again/.test(document.getElementById("strip").textContent)`, true, 5000),
         fs.existsSync(path.join(DATA, "archivevid-none.json")), ((await get()).looked || []).length], [true, true, false, 0]);
      // Every console's button pressed once, as by someone who reads "Selected" as the thing to press.
      check("with every console's button pressed none is selected, and the box says how to select one",
        await b.ev(`(() => { let x, n = 0; while ((x = [...document.querySelectorAll("#editor .pj-row .pj-set")].find(s => s.textContent === "✓ Selected")) && n < 200) { x.click(); n++; } return [n > 0, (document.querySelector("#editor .pj-note") || {}).textContent]; })()`),
        [true, "None is selected. Press a console's button to select it."]);
      await b.ev(`${rowOf("Fetch the videos")}.querySelector(".pj-set").click()`);
      check("Start with none selected says so, with what to press, and the window stays",
        [await b.until(`/no console is selected: press Not selected on a console's line to select it/.test(document.getElementById("strip").textContent)`, true, 5000),
         await b.ev(`document.getElementById("editor").hidden`)], [true, false]);
      await b.key("Escape");
    }
  } finally {
    for (const f of mine) { fs.rmSync(f, { force: true }); fs.rmSync(f + ".part", { force: true }); fs.rmSync(f + ".part.err", { force: true }); }
    for (const p of [PSX, SNES, N64, "Nintendo Switch", "Philips CD-i"]) { try { fs.rmdirSync(path.join(DATA, "videos", p)); } catch (e) { /* the copy's own videos are in it */ } }
    fs.rmSync(FX, { recursive: true, force: true });
    fs.rmSync(path.join(DATA, "archivevid-stop"), { force: true });
    kept.restore();
  }
};
