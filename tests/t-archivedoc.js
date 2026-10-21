/* Manuals for the games with none, from the online archives (includes\archivedoc.php):
 * Get Media > Manuals from online archives.
 * Nothing goes online: XSEGON_ARCHIVE (tests\sandbox.js) points at stand-in sets of
 * tiny PDFs here, and the sets are the test's own data\archivedoc-sets.json.
 * What lands is compared byte for byte with its stand-in.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { api, DATA, Guard, sleep } = require("./lib");

const FX = path.join(DATA, "fixtures", "archive");
const NES = "Nintendo Entertainment System", SNES = "Super Nintendo Entertainment System", PSX = "Sony Playstation", N64 = "Nintendo 64";

const pdf = (words) => Buffer.from("%PDF-1.4\n% a stand-in manual: " + words + "\n%%EOF\n");
const game = (n, title, platform, rom) => ({ id: "xs-scan-mdtest" + n, title, platform, rom: path.join(FX, "roms-doc", rom), added: new Date().toISOString() });

const GAMES = [
  game(1, "Alpha Quest", NES, "Alpha Quest (USA).nes"),          // its file's own name
  game(2, "The Beta Saga", SNES, "bs.sfc"),                      // its title, the article moved
  game(3, "Gamma Run", NES, "Gamma Run (USA).nes"),              // only a Japanese manual: left out
  game(4, "Delta Force", SNES, "Delta Force (USA).sfc"),         // its manual arrives damaged
  game(5, "Epsilon Wars", SNES, "ew.sfc"),                       // only a similar name: left out
  game(6, "Zeta Blaster", "Nintendo Switch", "zeta.nsp"),        // a console with no set
  game(7, "Theta Ball", N64, "Theta Ball (USA).z64"),            // its set's list will not come
  game(8, "Iota Pilot", NES, "Iota Pilot (USA).nes"),            // has a manual already: not asked for
  game(9, "Kappa Kart", NES, "Kappa Kart (USA).nes"),            // two versions of one game, one card:
  game(10, "Kappa Kart", NES, "Kappa Kart (Europe).nes"),        //   one manual, the second with a map of its own
  game(11, "Lambda", PSX, "Lambda (USA).cue"),                   // the set's own PDF, never the Archive's searchable copy
  game(12, "Mu Racer", PSX, "Mu Racer (USA).cue"),               // what comes is not a PDF
];
const SETS = [
  { id: "test-doc-nes", folder: "nes", manuals: 4,
    files: { "Alpha Quest (USA).pdf": pdf("alpha"), "Gamma Run (Japan).pdf": pdf("gamma, in Japanese"), "Kappa Kart (USA).pdf": pdf("kappa"), "Iota Pilot (USA).pdf": pdf("iota from the Archive") } },
  { id: "test-doc-snes", folder: "snes", manuals: 3,
    files: { "Beta Saga, The (USA).pdf": pdf("beta"), "Delta Force (USA).pdf": pdf("delta"), "Epsilon Wars - The Return (USA).pdf": pdf("epsilon's sequel") } },
  { id: "test-doc-psx", folder: "psx", manuals: 2,
    files: { "Lambda (USA).pdf": pdf("lambda"), "Lambda (USA)_text.pdf": pdf("lambda, the searchable copy"), "Mu Racer (USA).pdf": Buffer.from("an error page, not a manual") } },
  { id: "test-doc-n64-gone", folder: "n64", manuals: 1, files: null },
];
const IDS = GAMES.map((g) => g.id);

function makeAll() {
  for (const s of SETS) {
    fs.rmSync(path.join(FX, "download", s.id), { recursive: true, force: true });
    fs.rmSync(path.join(FX, "metadata", s.id), { recursive: true, force: true });
  }
  fs.rmSync(path.join(FX, "roms-doc"), { recursive: true, force: true });
  fs.mkdirSync(path.join(FX, "roms-doc"), { recursive: true });
  for (const g of GAMES) { fs.writeFileSync(g.rom, "not a game, a stand-in"); }
  for (const s of SETS) {
    if (!s.files) { continue; }
    const rows = [];
    for (const [name, bytes] of Object.entries(s.files)) {
      const file = path.join(FX, "download", s.id, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
      // Delta's checksum is another file's: what arrives is not what the list promised. The searchable copy is the Archive's own.
      rows.push({ name, source: /_text\.pdf$/.test(name) ? "derivative" : "original", size: String(bytes.length),
                  md5: /Delta/.test(name) ? "0".repeat(32) : crypto.createHash("md5").update(bytes).digest("hex") });
    }
    rows.push({ name: "Alpha Quest (USA)_text.pdf", source: "original", size: "9", md5: "" });   // marked as the set's own, still never taken
    fs.mkdirSync(path.join(FX, "metadata", s.id), { recursive: true });
    fs.writeFileSync(path.join(FX, "metadata", s.id, "files"), JSON.stringify({ result: rows }));
  }
  fs.writeFileSync(path.join(DATA, "archivedoc-sets.json"), JSON.stringify({ sets: SETS.map((s) => Object.assign({}, s, { files: undefined })) }));
  // Iota has its manual already; Kappa's Europe version has only a map, which is no manual.
  const own = (g, name, bytes) => { fs.mkdirSync(path.join(DATA, "documents", g.id), { recursive: true }); fs.writeFileSync(path.join(DATA, "documents", g.id, name), bytes); };
  own(GAMES[7], "Manual.pdf", pdf("iota, the person's own"));
  own(GAMES[9], "Map.png", Buffer.from("not a manual"));
}

module.exports = async function (b, check) {
  const kept = new Guard(["scanned-games.json", "local-games.json", "archivedoc-sets.json", "archivedoc-job.json", "archivedoc-none.json", "messages.json"]);
  const looked = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, "archivedoc-none.json"), "utf8")); } catch (e) { return {}; } };
  const mail = async () => ((await api("api/news.php")).messages || []).filter((m) => m.key === "archivedoc:none");
  const get = () => api("api/archivedoc.php");
  const post = (body) => api("api/archivedoc.php", body);
  const ended = async (ms) => { let j = null; for (const end = Date.now() + ms; Date.now() < end;) { j = (await get()).job; if (j && j.state !== "running") { break; } await sleep(120); } return j || {}; };
  const manual = (g) => path.join(DATA, "documents", g.id, "Manual.pdf");
  const from = (set, name) => fs.readFileSync(path.join(FX, "download", set, name));
  const folder = (g) => fs.existsSync(path.join(DATA, "documents", g.id));

  try {
    makeAll();
    fs.rmSync(path.join(DATA, "archivedoc-job.json"), { force: true });
    fs.rmSync(path.join(DATA, "archivedoc-none.json"), { force: true });
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), JSON.stringify(GAMES));
    // The copy's own programs would join the counts (one is filed under the NES): the test's games alone.
    fs.writeFileSync(path.join(DATA, "local-games.json"), "[]");

    /* ---- what the window opens on: nothing asked of the Archive yet ------- */
    const first = await get();
    const con = (name) => (first.consoles || []).find((c) => c.platform === name) || {};
    check("the consoles with games that have no manual are counted, two versions of one game as one, a game with a manual left out",
      [first.ok, first.curl, first.job, con(NES).need, con(NES).sets, con(NES).manuals, con(SNES).need, con(PSX).need, con(N64).need, con("Nintendo Switch").sets],
      [true, true, null, 3, 1, 4, 3, 2, 1, 0]);
    check("the consoles the online archives have manuals for come first",
      (first.consoles || []).map((c) => c.sets > 0).join().replace(/^(true,?)+(false,?)*$/, "in order"), "in order");
    check("a start with no console is refused in words, and so is one for a console the archives have nothing for",
      [/select a console the online archives have manuals for first/.test((await post({ fetch: [] })).error || ""),
       /select a console the online archives have manuals for first/.test((await post({ fetch: ["Nintendo Switch"] })).error || "")], [true, true]);
    check("nothing was started by any of that", (await get()).job, null);

    /* ---- the fetch ------------------------------------------------------- */
    check("the fetch starts", (await post({ fetch: [NES, SNES, PSX, N64] })).started, true);
    const done = await ended(60000);
    check("and ends saying how many games got a manual, how many got none, and that a list would not come",
      [done.state, done.sets, done.added, /^4 of 9 games with no manual got one from the online archives \(/.test(done.said || ""),
       / 5 got none: Get Media > Manuals from online archives lists them\./.test(done.said || ""), /1 of the Archive's lists would not come/.test(done.said || "")],
      ["done", 4, 4, true, true, true]);
    const why = (title) => ((done.none || []).find((g) => g.title === title) || {}).why || "";
    check("the games that got none are listed with why",
      [why("Gamma Run"), why("Epsilon Wars"), /^its manual could not be fetched: it did not arrive whole/.test(why("Delta Force")),
       why("Mu Racer"), why("Theta Ball")],
      ["only a manual of another region was found (Japan), and that is left out: Gamma Run (Japan).pdf",
       "only a manual with a similar name was found, and that is left out: Epsilon Wars - The Return (USA).pdf", true,
       "its manual could not be fetched: what came is not a PDF", "no manuals for this console on the Internet Archive"]);
    check("each manual is the game's Manual.pdf, the Archive's own file byte for byte, and never its searchable copy",
      [fs.readFileSync(manual(GAMES[0])).equals(from("test-doc-nes", "Alpha Quest (USA).pdf")),
       fs.readFileSync(manual(GAMES[1])).equals(from("test-doc-snes", "Beta Saga, The (USA).pdf")),
       fs.readFileSync(manual(GAMES[10])).equals(from("test-doc-psx", "Lambda (USA).pdf"))], [true, true, true]);
    check("two versions of one game get one manual, on the first, and the second keeps its map",
      [fs.readFileSync(manual(GAMES[8])).equals(from("test-doc-nes", "Kappa Kart (USA).pdf")), fs.existsSync(manual(GAMES[9])),
       fs.existsSync(path.join(DATA, "documents", GAMES[9].id, "Map.png"))], [true, false, true]);
    check("a manual the person has is left as it is", fs.readFileSync(manual(GAMES[7])).equals(pdf("iota, the person's own")), true);
    check("nothing is left behind for the ones that got none: no folder, no half file, no worker's leftovers",
      [folder(GAMES[2]), folder(GAMES[3]), folder(GAMES[4]), folder(GAMES[11]), folder(GAMES[6]),
       fs.existsSync(path.join(DATA, "archivedoc-tmp")), fs.existsSync(path.join(DATA, "archivedoc-stop"))],
      [false, false, false, false, false, false, false]);
    const rows = ((await api("api/library.php?versions=all")).games || []).filter((g) => IDS.includes(g.id));
    check("the library says so: the four have documents, the rest do not, the person's own still there",
      IDS.map((id) => (rows.find((r) => r.id === id) || {}).docs),
      [true, true, false, false, false, false, false, true, true, true, true, false]);
    const docs = ((await api("api/game.php?id=" + GAMES[0].id)).game || {}).documents || [];
    check("the game's Documents list it as its Manual, a PDF", docs.map((d) => [d.label, d.kind]), [["Manual", "pdf"]]);
    check("a game the online archives had nothing sure for is kept as looked for, with why; one whose fetch failed, or whose console's list would not come, is not",
      [Object.keys(looked()).sort(), /another region/.test((looked()[GAMES[2].id] || {}).why || "")],
      [[GAMES[2].id, GAMES[4].id].sort(), true]);
    const told = await mail();
    check("one message says how many got none and on which consoles, the way on with ScreenScraper, and the two windows as its buttons",
      [told.length, (told[0] || {}).title, /None came for games on /.test((told[0] || {}).body || ""),
       /ScreenScraper videos fetches them, with Manuals too selected/.test((told[0] || {}).body || ""), (told[0] || {}).opens],
      [1, "5 games got no manual", true, true, ["screenscraper", "archivedoc"]]);

    /* ---- the corner bar, and a second fetch ------------------------------ */
    const bar = ((await api("api/jobs.php")).jobs || []).find((j) => j.key === "archivedoc") || {};
    check("the job is one of the corner's, said as done with its last words", [bar.name, bar.state, /^4 of 9 games/.test(bar.said || "")], ["Manuals from online archives", "done", true]);
    check("asking to stop when nothing is at work stops nothing", (await post({ stop: true })).stopping, false);
    const again = await (async () => { await post({ fetch: [NES, SNES, PSX, N64] }); return ended(60000); })();
    check("a second fetch brings nothing new and leaves out the ones kept as looked for",
      [again.added, (again.none || []).map((g) => g.title).sort()], [0, ["Delta Force", "Mu Racer", "Theta Ball"]]);
    check("and its message takes the place of the first fetch's: one, not two", (await mail()).length, 1);

    /* ---- the window ------------------------------------------------------ */
    if (b) {
      fs.rmSync(manual(GAMES[0]), { force: true });
      fs.rmdirSync(path.join(DATA, "documents", GAMES[0].id));
      await b.goto();
      await b.setView("grid");
      await b.getMedia(/^Manuals from online archives/);
      check("Manuals from online archives opens its window", await b.until(`(document.querySelector("#editor .panel-title") || {}).textContent`, "MANUALS FROM ONLINE ARCHIVES", 8000), "MANUALS FROM ONLINE ARCHIVES");
      check("with a box of consoles and a box to fetch, every console selected, and no line lit",
        await b.ev(`[[...document.querySelectorAll("#editor .pj-head")].map(x => x.textContent).slice(0, 2), document.querySelectorAll("#editor .pj-row.at").length,
          [...document.querySelectorAll("#editor .pj-row")].filter(r => r.querySelector(".pj-set").textContent === "Not selected").length]`),
        [["Consoles with games that have no manual", "Fetch"], 0, 0]);
      check("the consoles the archives have nothing for are named in one line",
        await b.ev(`/The online archives have no manuals for: .*Nintendo Switch \\(1\\)/.test((document.querySelector("#editor .mt-note") || {}).textContent || "")`), true);
      const rowOf = (name) => `[...document.querySelectorAll("#editor .pj-row")].find(r => r.querySelector(".pj-job").textContent === ${JSON.stringify(name)})`;
      await b.ev(`${rowOf("Fetch the manuals")}.querySelector(".pj-set").click()`);
      check("Start closes the window: the job is the corner's from there", await b.until(`document.getElementById("editor").hidden`, true, 8000), true);
      check("and the corner says how it ended", await b.until(`/1 of \\d+ games with no manual got one from the online archives/.test(document.getElementById("strip").textContent)`, true, 60000), true);
      check("the manual is there again", fs.readFileSync(manual(GAMES[0])).equals(from("test-doc-nes", "Alpha Quest (USA).pdf")), true);
      await b.getMedia(/^Manuals from online archives/);
      const lookedHead = `[...document.querySelectorAll("#editor .pj-head")].map(x => x.textContent).find(t => /^Looked for, no manual found/.test(t)) || ""`;
      check("the games looked for with nothing found have a box of their own, folded away", await b.until(lookedHead, "Looked for, no manual found (2)", 8000), "Looked for, no manual found (2)");
      await b.ev(`[...document.querySelectorAll("#editor .pj-set")].find(x => x.textContent === "Look again").click()`);
      check("Look again puts them back: the box goes and the strip says so",
        [await b.until(`!(${lookedHead})`, true, 8000), await b.until(`/back on the list: Start asks the online archives for (it|them) again/.test(document.getElementById("strip").textContent)`, true, 5000),
         fs.existsSync(path.join(DATA, "archivedoc-none.json"))], [true, true, false]);
      await b.key("Escape");
    }
  } finally {
    for (const id of IDS) { fs.rmSync(path.join(DATA, "documents", id), { recursive: true, force: true }); }
    for (const s of SETS) {
      fs.rmSync(path.join(FX, "download", s.id), { recursive: true, force: true });
      fs.rmSync(path.join(FX, "metadata", s.id), { recursive: true, force: true });
    }
    fs.rmSync(path.join(FX, "roms-doc"), { recursive: true, force: true });
    fs.rmSync(path.join(DATA, "archivedoc-stop"), { force: true });
    fs.rmSync(path.join(DATA, "archivedoc-tmp"), { recursive: true, force: true });
    kept.restore();
  }
};
