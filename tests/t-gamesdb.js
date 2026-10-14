/*  The Games Database for everyone without LaunchBox (tools\build-gamesdb.php,
    bin\gamesdb.php, bin\gamesdb-update.php).

    Nothing is downloaded and the real copy is never touched: a stand-in for
    LaunchBox's Metadata.xml, four games long, is built and packed in the
    test server's own folder, the reader unpacks it there (XSEGON_GAMESDB_DIR
    and _COPY), and the updater is pointed at a stand-in for the GitHub
    release served from this process (XSEGON_GAMESDB_URL). Then the server is
    asked which source it would fill from, with LaunchBox off.

    THE ANSWERS ON RECORD (tests\gamesdb-answers.json): the server and the
    page are written against them, and the reader must answer the asks below
    of this stand-in the same, letter for letter. A change to an answer that
    is meant goes into that file with it. */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync, execFile } = require("child_process");
const { DatabaseSync } = require("node:sqlite");
const { api, BASE, DATA, ROOT } = require("./lib");

const XML = `<?xml version="1.0" standalone="yes"?>
<LaunchBox>
  <Game>
    <Name>Dead Space (2008)</Name>
    <ReleaseDate>2008-10-14T00:00:00-04:00</ReleaseDate>
    <Overview>Isaac &amp; the Ishimura &lt;alone&gt;</Overview>
    <MaxPlayers>1</MaxPlayers>
    <Cooperative>false</Cooperative>
    <DatabaseID>14</DatabaseID>
    <CommunityRating>4.1</CommunityRating>
    <Platform>Windows</Platform>
    <CommunityRatingCount>50</CommunityRatingCount>
    <Genres>Horror; Shooter</Genres>
    <Developer>EA Redwood Shores</Developer>
  </Game>
  <Game>
    <Name>The Legend of Zelda: Ocarina of Time</Name>
    <ReleaseYear>1998</ReleaseYear>
    <Cooperative>false</Cooperative>
    <DatabaseID>161</DatabaseID>
    <Platform>Nintendo 64</Platform>
    <CommunityRatingCount>900</CommunityRatingCount>
    <Genres />
  </Game>
  <Game>
    <Name>S.T.A.L.K.E.R.: Clear Sky</Name>
    <Cooperative>false</Cooperative>
    <DatabaseID>101</DatabaseID>
    <Platform>Windows</Platform>
    <CommunityRatingCount>3</CommunityRatingCount>
    <Genres>Shooter</Genres>
  </Game>
  <Game>
    <Name>Dungeons</Name>
    <Cooperative>false</Cooperative>
    <DatabaseID>7</DatabaseID>
    <Platform>Dragon 32/64</Platform>
    <CommunityRatingCount>0</CommunityRatingCount>
    <Genres />
  </Game>
  <GameAlternateName>
    <AlternateName>Zelda 64</AlternateName>
    <DatabaseID>161</DatabaseID>
  </GameAlternateName>
  <GameImage>
    <DatabaseID>161</DatabaseID>
    <FileName>0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.png</FileName>
    <Type>Box - Front</Type>
    <Region>North America</Region>
    <CRC32>1</CRC32>
  </GameImage>
  <GameImage>
    <DatabaseID>161</DatabaseID>
    <FileName>11111111-2222-3333-4444-555555555555.jpg</FileName>
    <Type>Advertisement Flyer - Front</Type>
    <CRC32>2</CRC32>
  </GameImage>
  <Platform>
    <Name>Nintendo 64</Name>
  </Platform>
</LaunchBox>
`;

/* The asks whose answers are on record, and the four files some of them
   name. A list or an object where a title belongs, or an ask that is no ask,
   must not stop the reader whole ("Array to string conversion"). */
const FILES = {
  "have.json": { titles: ["Dead Space", "Zelda 64"], dbIds: [101, "7"] },
  "many.json": [{ id: "a", platform: "Nintendo 64", title: "Zelda 64" }, { id: "b", platform: "Windows", title: "Stalker" },
    { id: 12, platform: "Windows", title: "Nothing Like This" }, { id: "", title: "skipped" }],
  "odd.json": [{ id: "list", platform: ["Windows"], title: ["Dead Space"] }, { id: "obj", platform: "Windows", title: { a: 1 } },
    { id: ["x", 1], platform: null, title: 161 }, { id: 1.5, title: true }, { id: {}, platform: {}, title: [] }, { id: "ok", platform: "Windows", title: "Dungeons" },
    { title: "no id" }, "text", 7, null, [], ["Zelda 64"]],
  "odd-have.json": { titles: ["Dead Space", ["Zelda 64"], { a: 1 }, 7, null, true], dbIds: [[101], "7", {}, null, "x"] },
};
const ASKS = [["matchmany", "odd.json"], ["list", "Windows", "odd-have.json"], ["list", "Nintendo 64", "odd-have.json"], ["game", "14"], ["game", "161"],
  ["game", "nope"], ["game", "999"], ["images", "161"], ["images", "14"], ["platforms"], ["list", "Windows", "have.json"], ["list", "Nintendo 64"], ["list"],
  ["search", "Windows", "dead"], ["search", "", "the legend of zelda"], ["search", "Windows"], ["match", "Nintendo 64", "  Zelda 64  "],
  ["match", "Windows", "Dungeons"], ["fill", "Nintendo 64", "The Legend of Zelda: Ocarina of Time"], ["fill", "Windows", "Zelda 64"],
  ["matchmany", "many.json"], ["matchmany", "have.json"], ["nonsense"]];

module.exports = async function (b, check) {
  const dir = path.join(DATA, "fixtures", "gamesdb");
  if (!fs.existsSync(path.join(DATA, "fixtures"))) {
    check("gamesdb: runs only on the test server's own copy", true, true);
    return;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  const out = path.join(dir, "out");
  fs.mkdirSync(dir, { recursive: true });
  const xml = path.join(dir, "Metadata.xml");
  fs.writeFileSync(xml, XML);
  const mtime = (p) => fs.statSync(p).mtimeMs;
  const manifest = (d) => JSON.parse(fs.readFileSync(path.join(d, "gamesdb.json"), "utf8"));
  const PACKED = "gamesdb.sqlite.bz2";

  /* The PHP the test server runs on, started with the words includes\gamesdb.php
     starts it with (the extensions php.ini leaves off, and the server's time zone),
     asked of that file rather than copied here, so the two cannot drift apart. */
  const phpExe = ((await api("api/status.php")).build || {}).phpExe;
  const phpFlags = JSON.parse(execFileSync(phpExe, ["-r", "require 'includes/boot.php'; require 'includes/gamesdb.php'; echo json_encode(xs_gamesdb_php_cmd(true));"],
    { cwd: ROOT, env: Object.assign({}, process.env, { XSEGON_DATA: DATA }), windowsHide: true }).toString()).slice(1);
  check("gamesdb: the server starts its reader with the extensions it needs and its own time zone",
    [phpFlags.some((w) => /^extension_dir=.+/.test(w)), phpFlags.some((w) => /^date\.timezone=.+/.test(w))], [true, true]);

  /* ---- from a folder with an accent in its name -------------------------- */
  /* PHP gives its own php.exe's path in the Windows code page and every other
     path in UTF-8, so a command made of both misses a folder with accents. This
     PHP, linked into such a folder, starts a child with the reader's command: the
     child must have its extensions and get an accented word as it was sent. */
  {
    const accent = path.join(dir, "Jos\u00e9 \u00fc");
    const from = path.dirname(phpExe);
    const place = (a, b) => { try { fs.linkSync(a, b); } catch (e) { fs.copyFileSync(a, b); } };
    fs.mkdirSync(path.join(accent, "ext"), { recursive: true });
    for (const n of fs.readdirSync(from)) { if (/\.(exe|dll|ini|pem)$/i.test(n)) { place(path.join(from, n), path.join(accent, n)); } }
    for (const n of fs.readdirSync(path.join(from, "ext"))) { if (/\.dll$/i.test(n)) { place(path.join(from, "ext", n), path.join(accent, "ext", n)); } }
    const code = "require 'includes/boot.php'; require 'includes/gamesdb.php'; require 'includes/version.php'; "
      + "$c = array_merge(xs_gamesdb_php_cmd(true), ['-r', 'echo json_encode([extension_loaded(\"sqlite3\"), extension_loaded(\"bz2\"), extension_loaded(\"intl\"), bin2hex($argv[1])]);', \"Pok\\u{E9}mon\"]); "
      + "$p = proc_open($c, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, null, ['bypass_shell' => true]); "
      + "echo stream_get_contents($pipes[1]), substr(stream_get_contents($pipes[2]), 0, 300); proc_close($p); "
      // and the status answer, which holds this PHP's path, can be written at all rather than going out empty
      + "echo ' ', bin2hex(substr(dirname(xs_php_exe()), -8)), ' ', json_encode(xs_version()) === false ? 'no status' : 'status';";
    let got = "";
    try { got = execFileSync(path.join(accent, "php.exe"), ["-r", code],
      { cwd: ROOT, env: Object.assign({}, process.env, { XSEGON_DATA: DATA }), windowsHide: true }).toString(); } catch (e) { got = "could not run: " + e.message.slice(0, 300); }
    check("gamesdb: started from a folder with accents in its name, the reader has its extensions and gets an accented title as sent, and the status can be answered",
      got, '[true,true,true,"506f6bc3a96d6f6e"] 4a6f73c3a920c3bc status');
  }

  /* ---- a look-up gives a background program no time limit ---------------- */
  /* The wait for the reader pushes PHP's 30-second limit back each lap, for a
     request; in a background program, which has none, it must not SET one, or
     the Fill in worker is stopped mid-way. */
  {
    let got = "";
    try { got = execFileSync(phpExe, ["-r", "require 'includes/boot.php'; require 'includes/gamesdb.php'; $a = ini_get('max_execution_time'); "
      + "$r = xs_gamesdb_run(['nonsense'], 20); echo $a, ' ', ini_get('max_execution_time'), ' ', $r['error'] ?? 'answered';"],
      { cwd: ROOT, env: Object.assign({}, process.env, { XSEGON_DATA: DATA }), windowsHide: true }).toString(); } catch (e) { got = "could not run: " + e.message.slice(0, 300); }
    // before, after, and that the reader was really asked (it has no such command)
    check("gamesdb: a program with no time limit has none after asking the reader",
      [got.split(" ").slice(0, 2).join(" "), got.split(" ").length > 2], ["0 0", true]);
  }

  /* ---- several pictures at once ---------------------------------------- */
  /* Get Pictures downloads a few pictures side by side. Asked for three this
     server serves and one it does not: each comes back as it is on disk, and the
     missing one is nothing rather than an error page stored as a picture. */
  {
    const files = ["img/xsegon-32.png", "img/xsegon-180.png", "img/xsegon-192.png"];
    // (a picture this server answers 404 for: a file that is not there is answered with the app's own page)
    const urls = files.map((f) => BASE + "/" + f).concat(BASE + "/api/image.php?platform=%40no-such&kind=icon");
    const sha = (buf) => require("crypto").createHash("sha1").update(buf).digest("hex");
    let got = {};
    try { got = JSON.parse(execFileSync(phpExe, ["-r", "require 'includes/boot.php'; require 'includes/gamesdb.php'; $u = json_decode($argv[1], true); "
      + "$r = xs_gamesdb_pictures_get($u, $how); echo json_encode(['sums' => array_map(fn ($x) => $r[$x] === null ? null : sha1($r[$x]), $u), 'how' => $how, "
      + "'one' => array_values(array_map(fn ($b) => $b === null ? null : sha1($b), xs_gamesdb_pictures_get([$u[0]], $h1))), 'h1' => $h1]);", JSON.stringify(urls)],
      { cwd: ROOT, env: Object.assign({}, process.env, { XSEGON_DATA: DATA }), windowsHide: true }).toString()); } catch (e) { got = { error: e.message.slice(0, 300) }; }
    check("gamesdb: several pictures asked for at once each come back as they are, and one that is not there is nothing",
      got.sums || got.error, files.map((f) => sha(fs.readFileSync(path.join(ROOT, f)))).concat(null));
    check("they came side by side, and a single picture is fetched the plain way", [got.how, got.one, got.h1],
      [{ side: 3, plain: 0 }, [sha(fs.readFileSync(path.join(ROOT, files[0])))], { side: 0, plain: 1 }]);
  }

  /* ---- the build ------------------------------------------------------- */
  // Started plainly, as it is run by hand: it loads the extensions it lacks itself.
  const said = execFileSync(phpExe, [path.join(ROOT, "tools", "build-gamesdb.php"), xml],
    { env: Object.assign({}, process.env, { XSEGON_GAMESDB_OUT: out }), windowsHide: true }).toString();
  check("gamesdb: the builder reads the download's games, other names and pictures, leaving out types Xsegon never shows",
    /done: 4 games, 1 other names, 1 pictures \(1 left out\)/.test(said), true);
  const m0 = manifest(out);
  const bz = path.join(out, PACKED);
  check("and packs it, with a manifest saying when, how many games, how big and its checksum",
    [fs.existsSync(bz), m0.games, m0.size === (fs.existsSync(bz) ? fs.statSync(bz).size : -1),
     m0.sha256 === (fs.existsSync(bz) ? require("crypto").createHash("sha256").update(fs.readFileSync(bz)).digest("hex") : ""),
     /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(m0.built), Object.keys(m0)], [true, 4, true, true, true, ["built", "size", "sha256", "games"]]);

  const home = path.join(dir, "home");
  const data = path.join(home, "data"), lb = path.join(home, "LaunchBox");
  const fetched = path.join(data, "gamesdb-update"), pub = path.join(home, "published");
  fs.mkdirSync(data, { recursive: true });
  const copy = path.join(home, "copy.sqlite"), note = copy + ".from";
  const setLb = (p) => fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ paths: { launchbox: p } }));
  let port = 0;
  const env = (more) => Object.assign({}, process.env, { XSEGON_DATA: data, XSEGON_GAMESDB_DIR: out, XSEGON_GAMESDB_COPY: copy,
    XSEGON_GAMESDB_URL: "http://127.0.0.1:" + port + "/" }, more || {});
  const command = (script, args) => [phpExe, [...phpFlags, path.join(ROOT, "bin", script + ".php"), ...args]];
  const raw = (args, e) => { const c = command("gamesdb", args); return execFileSync(c[0], c[1], { env: e || env(), windowsHide: true }).toString(); };
  const reader = (...args) => JSON.parse(raw(args));

  /* ---- unpacked, and asked ---------------------------------------------- */
  setLb("");
  check("without LaunchBox, prepare unpacks the copy that came with Xsegon", reader("prepare").ok, true);
  const zelda = reader("match", "Nintendo 64", "Legend of Zelda, The - Ocarina of Time");
  check("and it answers: a file name's title is sure", [zelda.ok, zelda.confidence, (zelda.best || {}).id], [true, "sure", 161]);
  check("a note says which copy it is", fs.readFileSync(note, "utf8"), "bz2 " + m0.built + " " + m0.sha256.slice(0, 16));
  const idx = new DatabaseSync(copy, { readOnly: true });
  const names = idx.prepare("select name from sqlite_master where type = 'index'").all().map((r) => r.name).sort();
  idx.close();
  check("with the indexes left out of the packed copy", names,
    ["IX_GameAlternateTitles_DatabaseID", "IX_GameImages_DatabaseId_Type", "IX_Games_Platform_Name"]);
  check("another name finds the game", reader("match", "Nintendo 64", "Zelda 64").confidence, "sure");
  // "Great_Greed_USA": region words on the end with no brackets must not find nothing.
  const tailed = reader("match", "Nintendo 64", "Legend of Zelda, The - Ocarina of Time USA Europe");
  check("bare region words on the end of a file name are looked past when the whole name finds nothing",
        [tailed.confidence, (tailed.best || {}).id], ["sure", 161]);
  check("but never down to nothing: a name that is only such words finds nothing", reader("match", "Nintendo 64", "USA Europe").confidence, "none");
  check("a note in brackets is not part of the name (Dead Space (2008))", (reader("match", "Windows", "Dead Space").best || {}).id, 14);
  check("full stops vanish rather than split the word (S.T.A.L.K.E.R.)", ((reader("search", "Windows", "Stalker Clear Sky").results || [])[0] || {}).id, 101);
  const g = reader("game", "14").game || {};
  check("a game's details, with the XML's escapes undone", [g.notes, g.genre, g.released, g.players, g.rating, g.developer],
    ["Isaac & the Ishimura <alone>", "Horror; Shooter", "2008-10-14", 1, 4.1, "EA Redwood Shores"]);
  const im = reader("images", "161");
  check("pictures: the box is there, the flyer was never kept", [im.total, ((im.slots || {}).box || [])[0] && im.slots.box[0].file],
    [1, "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.png"]);
  const t1 = mtime(copy);
  reader("game", "14");
  check("asked again, it is not unpacked again", mtime(copy), t1);

  /* ---- the answers on record -------------------------------------------- */
  for (const n of Object.keys(FILES)) { fs.writeFileSync(path.join(home, n), JSON.stringify(FILES[n])); }
  const record = JSON.parse(fs.readFileSync(path.join(__dirname, "gamesdb-answers.json"), "utf8"));
  const apart = [];
  for (const a of ASKS) {
    const label = a.join(" ");
    const got = raw(a.map((w) => FILES[w] ? path.join(home, w) : w));
    if (got !== record[label]) { apart.push(label + "\n         now    " + got.slice(0, 300) + "\n         record " + String(record[label]).slice(0, 300)); }
  }
  if (apart.length) { console.log("       " + apart.join("\n       ")); }
  check("the reader answers " + ASKS.length + " asks as the record has them, letter for letter", [apart.length, Object.keys(record).length], [0, ASKS.length]);

  /* ---- four asks at once, nothing unpacked yet ---------------------------- */
  /* Each unpacking the whole database for itself fails: the later ones cannot put
     theirs over the file the first is by then reading. */
  {
    const copy4 = path.join(home, "four.sqlite");
    const four = [["game", "14"], ["platforms"], ["search", "Windows", "dead"], ["game", "161"]];
    const outs = await Promise.all(four.map((a) => new Promise((resolve) => {
      const c = command("gamesdb", a);
      execFile(c[0], c[1], { env: env({ XSEGON_GAMESDB_COPY: copy4 }), windowsHide: true }, (e, so) => resolve(String(so)));
    })));
    check("four asks at the same moment on a copy not yet unpacked all get their answer",
      outs.map((o, i) => o === record[four[i].join(" ")]), [true, true, true, true]);
    check("and leave one whole copy, with no half-made file beside it",
      fs.readdirSync(home).filter((n) => n.startsWith("four.sqlite")).sort(), ["four.sqlite", "four.sqlite.from", "four.sqlite.lock"]);
  }

  /* ---- a damaged copy heals itself ---------------------------------------- */
  fs.writeFileSync(copy, "garbage where a database was");
  const hurt = reader("game", "14");
  check("a damaged copy is thrown away with its note, and the failure says to ask again",
    [hurt.ok, /made afresh/.test(hurt.error || ""), fs.existsSync(copy), fs.existsSync(note)], [false, true, false, false]);
  check("and the next ask makes it afresh and answers", (reader("game", "14").game || {}).id, 14);

  /* ---- the updater, against a stand-in for the GitHub release ------------- */
  const http = require("http");
  fs.mkdirSync(pub, { recursive: true });
  const server = http.createServer((req, res) => {
    const f = path.join(pub, path.basename(decodeURIComponent(req.url)));
    if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200); res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  const publishAs = (built, sha) => {
    fs.copyFileSync(path.join(out, PACKED), path.join(pub, PACKED));
    fs.writeFileSync(path.join(pub, "gamesdb.json"), JSON.stringify(Object.assign({}, m0, { built, sha256: sha || m0.sha256 })));
  };
  const update = (...a) => new Promise((resolve) => {
    const c = command("gamesdb-update", a);
    execFile(c[0], c[1], { env: env(), windowsHide: true }, (e, so) => { try { resolve(JSON.parse(so)); } catch (x) { resolve({ result: "no answer: " + so }); } });
  });
  try {
    // Until a copy is published the release page has nothing on it.
    check("the updater: a release page with nothing on it is nothing published, not a check that failed", (await update()).result, "nothing published yet");
    publishAs(m0.built);
    check("the updater: the same copy published is up to date", (await update()).result, "up to date");
    check("and a check a moment ago means the next is not due yet", (await update("--if-due")).result, "not due");
    publishAs("2099-01-01T00:00:00.000Z", "0".repeat(64));
    const bad = await update();
    check("a download that does not match its checksum is refused, and nothing is put in place",
      [bad.result, fs.existsSync(path.join(fetched, PACKED))], ["the download does not match its checksum", false]);
    publishAs("2099-01-01T00:00:00.000Z");
    const got = await update();
    check("a newer one is fetched, checked, and put in data\\gamesdb-update", [got.result, got.built, manifest(fetched).built, fs.existsSync(path.join(fetched, PACKED))],
      ["fetched", "2099-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z", true]);
    const t2 = mtime(copy);
    reader("game", "14");
    check("the reader then unpacks the newer one in place of the one that came with Xsegon",
      [mtime(copy) !== t2, fs.readFileSync(note, "utf8").startsWith("bz2 2099-01-01")], [true, true]);
    check("and a check after that is up to date", (await update()).result, "up to date");
  } finally {
    server.close();
  }
  const off = await update();
  check("with no internet (nothing answering), it says so and changes nothing", /^could not check/.test(off.result), true);
  check("and the day's log has the updater's own lines",
    fs.readdirSync(path.join(data, "log")).some((n) => / S GDB  update check: fetched \(built 2099-01-01/.test(fs.readFileSync(path.join(data, "log", n), "utf8"))), true);
  {
    // In today's file by the local clock, at the local time of day: PHP on
    // its own stamps in UTC, hours away and after the evening a day ahead.
    const now = new Date(), p2 = (n) => String(n).padStart(2, "0");
    const today = path.join(data, "log", now.getFullYear() + "-" + p2(now.getMonth() + 1) + "-" + p2(now.getDate()) + ".log");
    const last = (fs.existsSync(today) ? fs.readFileSync(today, "utf8").split("\n").filter((l) => /^\d\d:\d\d:\d\d\.\d{3} S GDB  update check: /.test(l)) : []).pop() || "";
    const gap = last ? Math.abs(Number(last.slice(0, 2)) * 60 + Number(last.slice(3, 5)) - (now.getHours() * 60 + now.getMinutes())) : 999;
    check("stamped with this PC's own time of day, in today's file", Math.min(gap, 1440 - gap) <= 2, true);
  }

  /* ---- an older copy from LaunchBox, and LaunchBox's own, never read ----- */
  const stamp = fs.readFileSync(note, "utf8");
  fs.rmSync(note);
  reader("game", "14");
  check("a copy with no note (an older one taken from LaunchBox's own file) is replaced by the packed one, with its note",
    [fs.existsSync(note) ? fs.readFileSync(note, "utf8") : null], [stamp]);
  fs.mkdirSync(path.join(lb, "Metadata"), { recursive: true });
  fs.writeFileSync(path.join(lb, "Metadata", "LaunchBox.Metadata.db"), "not a database: reading it would fail");
  setLb(lb);
  const t3 = mtime(copy);
  check("with LaunchBox here, its own database file is never read: the copy and its note stay as they are",
    [reader("game", "161").ok, mtime(copy), fs.readFileSync(note, "utf8")], [true, t3, stamp]);
  setLb("");

  /* ---- no Node.js anywhere in what Xsegon runs --------------------------- */
  /* No file of the program starts it or names a Node.js reader in its code (its
     comments are not read), and the package tool refuses a package with a node.exe in it. */
  {
    const hits = [];
    const names = (rel) => {
      const code = fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\/|<#[\s\S]*?#>/g, "").replace(/^\s*(\/\/|#).*$/gm, "");
      return /node\.exe|xs_node_|['"]node['"]|gamesdb(-update|-shared)?\.js\b/.test(code);
    };
    const look = (d) => {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const rel = d + "/" + e.name;
        if (e.isDirectory()) { look(rel); continue; }
        if (/\.js$/.test(e.name) && d === "bin") { hits.push(rel + " (a script only Node.js could run)"); continue; }
        if (/\.(php|ps1|bat)$/.test(e.name) && names(rel)) { hits.push(rel); }
      }
    };
    ["api", "bin", "includes"].forEach(look);
    for (const f of ["index.php", "play.php", "router.php", "router-fast.php", "start.ps1"]) { if (names(f)) { hits.push(f); } }
    if (hits.length) { console.log("       " + hits.join("\n       ")); }
    check("nothing Xsegon runs starts Node.js or names a Node.js reader", hits.length, 0);
  }

  /* ---- which the server fills from ------------------------------------- */
  const before = (await api("api/settings.php")).settings;
  const lbBefore = before.paths.launchbox, lib0 = before.library || {};
  const flag = async () => { const m = /gamesdb: (true|false),/.exec(await (await fetch(BASE + "/")).text()); return m ? m[1] : "?"; };
  try {
    // updates manual: a page load on the test server must not go to GitHub
    await api("api/settings.php", { paths: { launchbox: "" }, library: { detailsFrom: "gamesdb", gamesdbUpdates: "manual" } });
    check("server: without LaunchBox the Games Database still fills games in", await flag(), "true");
    // One game: who answers is the check, and the api group matches every game.
    const list = await api("api/fill.php?scope=scanned&limit=1");
    check("and Fill in scanned games asks it, not libretro", [list.ok, list.source === "libretro"], [true, false]);
    const st = await api("api/gamesdb-update.php");
    check("Settings > Library is told the updates are manual, and that checking applies here",
      [st.ok, st.mode, st.applies, "launchbox" in st], [true, "manual", true, false]);
    check("and that the PHP it runs on can read the database", st.readable, true);
    check("and that the check by itself is on, now that the release is up", st.paused, false);
    // On screen: Settings > Library has the database's row, with Check now.
    await b.goto();
    await b.ev(`import("/js/settings-ui.js").then(m => m.openSettings())`);
    await b.waitFor(`[...document.querySelectorAll("#settings .set-tab")].some(x => x.textContent.includes("Library"))`, 8000);
    await b.ev(`(() => { const t = [...document.querySelectorAll("#settings .set-tab")].find(x => x.textContent.includes("Library")); t.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })); t.click(); })()`);
    const rowText = `(r => r ? r.textContent : "")([...document.querySelectorAll("#settings .set-page[data-group=library] .opt")].find(n => (n.querySelector("label") || {}).firstChild && n.querySelector("label").firstChild.textContent === "Games Database"))`;
    const shown = await b.until(`(t => /In use: .*built .*Checked only when you press Check now.*Check now$/.test(t))(${rowText})`, true, 8000);
    if (!shown) { console.log("       the row says: " + JSON.stringify(await b.ev(rowText))); }
    check("Settings > Library shows the Games Database: the copy in use, manual, and Check now", shown, true);
    await b.key("Escape");

    /* A newer copy on its way down has a bar: on its row while Settings is open, and in the
       corner once it is closed, with the end said on the strip. Nothing is fetched here: the files the
       updater keeps while it downloads are written by hand, as a fetch a third of the way through. */
    const upd = path.join(DATA, "gamesdb-update");
    const keep = ["checked.json", ".running", "fetching.json"].map((n) => [path.join(upd, n), fs.existsSync(path.join(upd, n)) ? fs.readFileSync(path.join(upd, n)) : null]);
    try {
      fs.mkdirSync(upd, { recursive: true });
      fs.writeFileSync(path.join(upd, ".running"), String(process.pid));
      fs.writeFileSync(path.join(upd, "fetching.json"), JSON.stringify({ bytes: 24 * 1048576, total: 72 * 1048576, at: Math.floor(Date.now() / 1000) }));
      const mid = await api("api/gamesdb-update.php");
      check("the server says a fetch is under way, and how far", [mid.running, mid.fetch], [true, { bytes: 24 * 1048576, total: 72 * 1048576 }]);
      await b.goto();
      await b.ev(`import("/js/settings-ui.js").then(m => m.openSettings())`);
      await b.waitFor(`[...document.querySelectorAll("#settings .set-tab")].some(x => x.textContent.includes("Library"))`, 8000);
      await b.ev(`(() => { const t = [...document.querySelectorAll("#settings .set-tab")].find(x => x.textContent.includes("Library")); t.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })); t.click(); })()`);
      check("its row says so, with a bar a third full, and Check now waits",
        [await b.until(`/Fetching the newer copy: 24 MB of 72 MB/.test(${rowText})`, true, 8000),
         await b.ev(`(t => !!t && !t.hidden && t.firstChild.style.width)(document.querySelector("#settings .gdb-prog"))`),
         await b.ev(`[...document.querySelectorAll("#settings .set-page[data-group=library] button")].find(x => x.textContent === "Check now").disabled`)],
        [true, "33%", true]);
      await b.shot("settings-gamesdb-fetching");
      await b.key("Escape");
      const cornerBar = `(x => (x && !x.hidden && getComputedStyle(x.parentNode).display !== "none" ? x.querySelector(".fb-line").textContent : ""))(document.querySelector('#corner-bars .job-bar[data-job="gamesdb"]'))`;
      check("with Settings closed the same fetch is a bar in the corner",
        await b.until(cornerBar, "Games Database: fetching the newer copy: 24 MB of 72 MB", 8000), "Games Database: fetching the newer copy: 24 MB of 72 MB");
      fs.rmSync(path.join(upd, "fetching.json"), { force: true });
      fs.rmSync(path.join(upd, ".running"), { force: true });
      fs.writeFileSync(path.join(upd, "checked.json"), JSON.stringify({ at: new Date().toISOString(), result: "fetched", built: "2026-10-07" }));
      check("and when it is in, the strip says so though no window is open",
        await b.until(`/a newer Games Database was fetched/.test((document.getElementById("strip") || {}).textContent || "")`, true, 8000), true);
    } finally {
      keep.forEach(([file, was]) => { if (was === null) { fs.rmSync(file, { force: true }); } else { fs.writeFileSync(file, was); } });
    }
    check("the settings refuse an update mode that is neither Automatic nor Manual, keeping the one there was",
      (await api("api/settings.php", { library: { gamesdbUpdates: "sometimes" } })).settings.library.gamesdbUpdates, "manual");
    await api("api/settings.php", { library: { detailsFrom: "libretro" } });
    /* One game is asked for: who answers is the question, and the whole library
       on libretro's road can take longer than the wait. libretro saying it
       cannot be reached is libretro answering too. */
    const viaLr = await api("api/fill.php?scope=scanned&limit=1");
    check("Settings > Library can send it to libretro instead",
          [await flag(), viaLr.source || (/libretro/.test(viaLr.error || "") ? "libretro" : null)], ["false", "libretro"]);
    const refused = await api("api/gamesdb-update.php", { action: "check" });
    check("and Check now then has nothing to check, and says so", [refused.ok, /libretro/.test(refused.error || "")], [false, true]);
  } finally {
    await api("api/settings.php", { paths: { launchbox: lbBefore },
      library: { detailsFrom: lib0.detailsFrom || "gamesdb", gamesdbUpdates: lib0.gamesdbUpdates === "manual" ? "manual" : "auto" } });
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
