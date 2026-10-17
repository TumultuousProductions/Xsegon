/* The Fan projects page (roadmap AQ1, js/fanprojects.js, api/fanprojects.php):
   where each project stands is read from what Xsegon keeps, a listed team's
   page is the only thing that can be opened, and the page is a card on the
   consoles screen and an entry in the Games menu. A list of the test's own
   (data/fanprojects.json, read only by a test copy) names games this copy has. */

"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { api, apiUntil, BASE, DATA, Guard } = require("./lib");

/* Stand-in discs for the disc-set checks, a few KB each: a PBP holding two discs (a
   PSTITLEIMG table, each disc naming itself at 0x400), and a disc image naming itself in
   its SYSTEM.CNF, in 2048-byte sectors (.iso) or raw 2352-byte ones (.bin). */
function fanPbp(ids) {
  const at = ids.map((_, i) => 0x400 + i * 0x800), b = Buffer.alloc(64 + at[at.length - 1] + 0x410);
  b.write("\0PBP", 0, "latin1");
  b.writeUInt32LE(64, 0x24);
  b.write("PSTITLEIMG000000", 64, "latin1");
  ids.forEach((id, i) => { b.writeUInt32LE(at[i], 64 + 0x200 + 4 * i); b.write("PSISOIMG0000", 64 + at[i], "latin1"); b.write("_" + id, 64 + at[i] + 0x400, "latin1"); });
  return b;
}
function fanDisc(sector, boot) {
  const s = (n) => n * sector + (sector === 2352 ? 24 : 0), b = Buffer.alloc(20 * sector), name = "SYSTEM.CNF;1", cnf = "BOOT = cdrom:\\" + boot + ";1\r\n";
  b[s(16)] = 1;
  b.write("CD001", s(16) + 1, "latin1");
  b.writeUInt32LE(18, s(16) + 158);        // the root directory: sector 18, one sector long
  b.writeUInt32LE(2048, s(16) + 166);
  b[s(18)] = 46;                           // its one record: SYSTEM.CNF in sector 19
  b.writeUInt32LE(19, s(18) + 2);
  b.writeUInt32LE(cnf.length, s(18) + 10);
  b[s(18) + 32] = name.length;
  b.write(name, s(18) + 33, "latin1");
  b.write(cnf, s(19), "latin1");
  return b;
}

/* Stand-ins for Make: an xdelta that copies the whole game and adds a few bytes, with the
   Adler-32 xdelta3 writes for what it makes; and a release zip, stored, listing one file
   with the CRC32 given (a wrong one on purpose for the check that refuses it). */
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) { c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; } return c >>> 0; });
const crc32 = (b) => { let c = 0xFFFFFFFF; for (const x of b) { c = CRC[(c ^ x) & 255] ^ (c >>> 8); } return (c ^ 0xFFFFFFFF) >>> 0; };
const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");
function fanXdelta(src, add) {
  const num = (v) => { const out = [v & 127]; for (v = Math.floor(v / 128); v > 0; v = Math.floor(v / 128)) { out.unshift((v & 127) | 128); } return Buffer.from(out); };
  const made = Buffer.concat([src, add]);
  let a = 1, s = 0;
  for (const x of made) { a = (a + x) % 65521; s = (s + a) % 65521; }
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(((s << 16) | a) >>> 0);
  const inst = Buffer.concat([Buffer.from([19]), num(src.length), Buffer.from([1]), num(add.length)]);   // COPY all of it, then ADD
  const body = Buffer.concat([num(made.length), Buffer.from([0]), num(add.length), num(inst.length), num(1), sum, add, inst, num(0)]);
  return Buffer.concat([Buffer.from([0xD6, 0xC3, 0xC4, 0, 0, 1 | 4]), num(src.length), num(0), num(body.length), body]);
}
function fanZip(name, data, crc) {
  return fanZipOf([[name, data, crc]]);
}
function fanZipOf(files) {
  const locals = [], cens = [];
  let at = 0;
  for (const [name, data, crc] of files) {
    const n = Buffer.from(name, "latin1"), local = Buffer.alloc(30), cen = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(at, 42);
    locals.push(local, n, data);
    cens.push(cen, n);
    at += 30 + n.length + data.length;
  }
  const cen = Buffer.concat(cens), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cen.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat(locals.concat([cen, end]));
}

/* A .pbp whose discs can be written out again: each a PSISOIMG with its table of contents
   and its blocks of 16 sectors, deflated, the way PSX2PSP keeps them (includes\pbp.php). */
function fanPbpDiscs(discs) {
  const zlib = require("zlib"), bcd = (n) => ((Math.floor(n / 10) << 4) | (n % 10));
  const isos = discs.map(([id, data]) => {
    const sectors = data.length / 2352, blocks = Math.ceil(sectors / 16), head = Buffer.alloc(0x100000), parts = [];
    head.write("PSISOIMG0000", 0, "latin1");
    head.write("_" + id, 0x400, "latin1");
    const toc = (i, bytes) => Buffer.from(bytes).copy(head, 0x800 + i * 10);
    toc(0, [0x41, 0, 0xA0, 0, 0, 0, 0, 1, 0x20, 0]);
    toc(1, [0x41, 0, 0xA1, 0, 0, 0, 0, 1, 0, 0]);
    toc(2, [0x01, 0, 0xA2, 0, 0, 0, 0, bcd(Math.floor(sectors / 4500)), bcd(Math.floor(sectors / 75) % 60), bcd(sectors % 75)]);
    toc(3, [0x41, 0, 0x01, 0, 0, 0, 0, 0, 2, 0]);
    let off = 0;
    for (let k = 0; k < blocks; k++) {
      const block = Buffer.alloc(0x9300);
      data.copy(block, 0, k * 0x9300, Math.min(data.length, (k + 1) * 0x9300));
      const z = zlib.deflateRawSync(block);
      head.writeUInt32LE(off, 0x4000 + k * 32);
      head.writeUInt16LE(z.length, 0x4004 + k * 32);
      parts.push(z);
      off += z.length;
    }
    return Buffer.concat([head].concat(parts));
  });
  const top = Buffer.alloc(0x400), pbp = Buffer.alloc(0x40);
  pbp.write("\0PBP", 0, "latin1");
  pbp.writeUInt32LE(0x40, 0x24);
  top.write("PSTITLEIMG000000", 0, "latin1");
  let at = 0x400;
  isos.forEach((iso, i) => { top.writeUInt32LE(at, 0x200 + 4 * i); at += iso.length; });
  return Buffer.concat([pbp, top].concat(isos));
}
// A disc of $sectors raw sectors, each opening as a CD sector does and filled with its own number.
function fanRawDisc(sectors, seed) {
  const d = Buffer.alloc(sectors * 2352);
  for (let s = 0; s < sectors; s++) {
    d[s * 2352] = 0;
    d.fill(0xFF, s * 2352 + 1, s * 2352 + 11);
    d.fill((seed + s) & 255, s * 2352 + 16, (s + 1) * 2352);
  }
  return d;
}

module.exports = async function (b, check) {
  const kept = new Guard(["fanprojects.json", "wanted.json", "local-games.json", "scanned-games.json", "filecheck.json", "hack-of.json",
                          "fan-made.json", "fanmake-job.json"]);
  const fix = path.join(DATA, "fan-fixtures");
  try {
    /* ---- the shipped list -------------------------------------------------- */
    fs.rmSync(path.join(DATA, "fanprojects.json"), { force: true });
    const real = await api("api/fanprojects.php");
    const shipped = real.projects || [];
    check("fan projects: the shipped list is read", [real.ok, shipped.length >= 10], [true, true]);
    check("each with a name, a kind, a console, and a website on https or a GitHub, or both",
      shipped.every((p) => p.name && p.kindLabel && p.console && (p.page || p.repo)
        && (!p.page || /^https:\/\//.test(p.page)) && (!p.repo || /^https:\/\/github\.com\//.test(p.repo))), true);
    check("each says where it stands", shipped.every((p) => ["fits", "works", "other", "partial", "unchecked", "unread", "missing"].includes(p.base.state)), true);

    /* ---- a list of the test's own, from games this copy has ---------------- */
    const lib = (await api("api/library.php?grouped=0")).games || [];
    const byId = new Map(lib.map((g) => [g.id, g]));
    const fc = JSON.parse(fs.readFileSync(path.join(DATA, "filecheck.json"), "utf8"));
    // A game alone in its release and its name on its console, so "fits" and "another release" can only mean it.
    const words = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\bthe\b/g, " ").replace(/\s+/g, " ").trim();
    const twins = (id, r) => Object.entries(fc).some(([o, q]) => o !== id && byId.has(o) && q.name === r.name)
      || lib.some((g) => g.id !== id && g.platform === byId.get(id).platform && words(g.title) === words(byId.get(id).title));
    const known = Object.entries(fc).filter(([id, r]) => byId.has(id) && r.kind === "known" && r.name && !twins(id, r));
    const headed = Object.entries(fc).filter(([id, r]) => byId.has(id) && r.header && (r.header.title || "").trim() && r.crc);
    if (!known.length || !headed.length) { check("this copy has checked games to test with", false); return; }
    const [kid, krec] = known[0];
    const kgame = byId.get(kid);
    const [hid, hrec] = headed[0];
    const hgame = byId.get(hid);
    const one = (id, over) => Object.assign({ id, name: "Test " + id.slice(2), kind: "patch", console: kgame.platform, adds: "a test", tags: [],
      team: "the testers", page: "https://example.com/" + id, licence: "MIT" }, over);
    const base = (title, match, db) => ({ title, db: db || { id: 999990, title: "Test base", platform: kgame.platform }, match });
    // Games of the test's own on the stand-in discs: two discs in a .pbp; an .m3u of an .iso and a .cue's .bin; a PC version's folder.
    const PS = "Sony Playstation";
    fs.rmSync(fix, { recursive: true, force: true });
    fs.mkdirSync(path.join(fix, "port"), { recursive: true });
    fs.writeFileSync(path.join(fix, "set.pbp"), fanPbp(["TEST_00001", "TEST_00002"]));
    fs.writeFileSync(path.join(fix, "three-a.iso"), fanDisc(2048, "TEST_000.03"));
    fs.writeFileSync(path.join(fix, "three-b.bin"), fanDisc(2352, "TEST_000.04"));
    fs.writeFileSync(path.join(fix, "three-b.cue"), "FILE \"three-b.bin\" BINARY\r\n  TRACK 01 MODE2/2352\r\n    INDEX 01 00:00:00\r\n");
    fs.writeFileSync(path.join(fix, "three.m3u"), "three-a.iso\nthree-b.cue\n");
    fs.writeFileSync(path.join(fix, "port", "launch.bat"), "@echo off\r\n");
    fs.writeFileSync(path.join(fix, "port", "port-abc1234def.jar"), "");
    const ownFile = path.join(DATA, "local-games.json");
    const own = fs.existsSync(ownFile) ? JSON.parse(fs.readFileSync(ownFile, "utf8")) : [];
    fs.writeFileSync(ownFile, JSON.stringify(own.concat([
      { id: "xs-fa0000000001", title: "Fan Fixture", platform: PS, run: path.join(fix, "set.pbp") },
      { id: "xs-fa0000000002", title: "Fan Fixture Three", platform: PS, run: path.join(fix, "three.m3u") },
      { id: "xs-fa0000000003", title: "Fan Fixture Port", platform: "Windows", run: path.join(fix, "port", "launch.bat") },
    ])));
    const fixtureDb = { id: 999993, title: "Fan Fixture", platform: PS };
    fs.writeFileSync(path.join(DATA, "fanprojects.json"), JSON.stringify({ projects: [
      one("t-fits", { tags: ["coop"], community: "https://example.com/talk", repo: "https://github.com/xsegon-test/t-fits",
                      base: base(krec.name, [{ console: kgame.platform, name: krec.name, fit: "fits" }]) }),
      one("t-works", { base: base(krec.name, [{ console: kgame.platform, name: "No Such Release (USA)", fit: "fits" },
                                              { console: kgame.platform, name: krec.name, fit: "works", note: "works; another is better" }]) }),
      one("t-other", { base: base("No Such Release (USA)", [{ console: kgame.platform, name: "No Such Release (USA)", fit: "fits" }],
                                  { id: 999991, title: kgame.title, platform: kgame.platform }) }),
      one("t-missing", { base: base("No Such Game (USA)", [{ console: kgame.platform, name: "No Such Game (USA)", fit: "fits" }],
                                    { id: 999992, title: "No Such Game", platform: kgame.platform }) }),
      one("t-yours", { kind: "pc", console: hgame.platform, base: base("No Such Base", [{ console: hgame.platform, name: "No Such Base", fit: "fits" }]),
                       yours: { header: hrec.header.title.trim(), crc: { [hrec.crc]: "9.9" } } }),
      one("t-port", { kind: "pc", console: PS, base: base("No Such Base", [{ console: PS, name: "No Such Base", fit: "fits" }]),
                      yours: { console: "Windows", title: "Fixture Port", build: "^port-([0-9a-f]{7})[0-9a-f]*\\.jar$" } }),
      one("t-set", { console: PS, base: base("Fan Fixture (USA)", [{ console: PS, discs: ["TEST-00001", "TEST-00002"], fit: "fits" }], fixtureDb) }),
      one("t-set3", { console: PS, base: base("Fan Fixture (USA)", [{ console: PS, discs: ["TEST-00003", "TEST-00004", "TEST-00005"], fit: "fits" }], fixtureDb) }),
      one("t-plain", { page: "http://example.com/plain", base: base("x", [{ console: kgame.platform, name: "x", fit: "fits" }]) }),
      one("t-offhub", { repo: "https://example.com/not-github", base: base("x", [{ console: kgame.platform, name: "x", fit: "fits" }]) }),
      one("T bad id", { base: base("x", [{ console: kgame.platform, name: "x", fit: "fits" }]) }),
    ] }));
    const mineList = await api("api/fanprojects.php");
    const by = Object.fromEntries((mineList.projects || []).map((p) => [p.id, p]));
    check("a test copy's own list is read, and entries with a bad id, a page that is not https or a GitHub that is not GitHub are left out",
      Object.keys(by).sort(), ["t-fits", "t-missing", "t-other", "t-port", "t-set", "t-set3", "t-works", "t-yours"]);
    check("a release the file check knows fits", [by["t-fits"].base.state, by["t-fits"].base.gameId, by["t-fits"].base.release], ["fits", kid, krec.name]);
    check("the best fit is taken, with its note", [by["t-works"].base.state, by["t-works"].base.note], ["works", "works; another is better"]);
    check("the same game in another release is said so", [by["t-other"].base.state, by["t-other"].base.gameId], ["other", kid]);
    check("a game the library lacks is missing", by["t-missing"].base.state, "missing");
    const mine = by["t-yours"].yours.find((y) => y.id === hid);
    check("a copy already yours is found by its header, its version by its checksum", [!!mine, mine && mine.version], [true, "9.9"]);
    check("the picture is a copy of yours, else the game it is made from", [by["t-yours"].pic, by["t-fits"].pic], [by["t-yours"].yours[0].id, kid]);
    check("every disc of a set in one .pbp: it fits, the .pbp's game standing for it",
      [by["t-set"].base.state, by["t-set"].base.gameId], ["fits", "xs-fa0000000001"]);
    check("a set's discs read from an .m3u (an .iso, a .cue's raw .bin) with one not there: said as 2 of 3, never taken for the game",
      [by["t-set3"].base.state, by["t-set3"].base.have, by["t-set3"].base.need, by["t-set3"].base.gameId], ["partial", 2, 3, "xs-fa0000000002"]);
    check("a PC version kept as a game of your own: found by its name, its build from a file beside what it runs",
      by["t-port"].yours.map((y) => [y.id, y.version, y.local]), [["xs-fa0000000003", "build abc1234", true]]);

    /* ---- the wanted list and the pages ------------------------------------- */
    await api("api/wanted.php", { id: 999992, want: true, title: "No Such Game", platform: kgame.platform, year: "" });
    check("a game on the wanted list is said to be", ((((await api("api/fanprojects.php")).projects || []).find((p) => p.id === "t-missing") || {}).base || {}).wanted, true);
    check("a listed page opens (a test copy opens nothing)", await api("api/fanprojects.php", { open: "t-fits", which: "page" }),
      { ok: true, url: "https://example.com/t-fits", dry: true });
    check("and its community", (await api("api/fanprojects.php", { open: "t-fits", which: "community" })).url, "https://example.com/talk");
    check("and its GitHub", (await api("api/fanprojects.php", { open: "t-fits", which: "repo" })).url, "https://github.com/xsegon-test/t-fits");
    check("a page the list does not name is refused", (await api("api/fanprojects.php", { open: "t-missing", which: "community" })).ok, false);
    check("an address from the request is never opened", (await api("api/fanprojects.php", { open: "https://example.org", which: "page" })).ok, false);

    /* ---- the page ---------------------------------------------------------- */
    await b.goto(BASE + "/");
    await b.waitFor(`!document.getElementById("syswall").hidden && document.querySelectorAll("#syswall .sel").length > 0`, 10000);
    await b.key("End");
    await b.settled();
    check("Fan projects is the last card on the consoles screen", await b.ev(`((document.querySelector("#syswall .sel") || {}).textContent || "").includes("Fan projects")`), true);
    await b.key("Enter");
    check("Enter on it opens the page", await b.waitFor(`!!document.getElementById("fanpage") && !document.getElementById("fanpage").hidden && document.querySelectorAll("#fanpage .tile").length === 8`, 10000));
    check("in place of the consoles screen", await b.ev(`document.getElementById("syswall").hidden`), true);
    check("its headings in the order a person acts, with their counts",
      await b.ev(`[...document.querySelectorAll("#fanpage .ghead")].map((h) => h.textContent)`),
      ["In your library2", "Ready to make3", "You have another release2", "Needs a game you do not have1"]);
    check("the first is chosen and the panel names it",
      await b.ev(`document.querySelector("#fanpage .tile.sel .cap").firstChild.textContent === document.querySelector("#fanpage .hero-name").textContent`), true);
    check("the panel: its kind, name and makers over the picture, the details and buttons under it",
      await b.ev(`[[...document.querySelector("#fanpage .hero").children].map((c) => c.className), document.querySelector("#fanpage .fan-by").textContent]`),
      [["fan-top", "hero-art-frame", "hero-info", "bar"], "by the testers"]);
    check("a tile reads the same way: its name over the picture, where it stands under it",
      await b.ev(`[...document.querySelectorAll("#fanpage .tile")].every((t) => t.firstElementChild.className === "cap" && t.lastElementChild.classList.contains("fan-st"))`), true);
    check("a copy of yours: the panel's first button plays it", await b.ev(`document.querySelector("#fanpage .hero .bar button").textContent`), "Play 9.9");
    await b.ev(`[...document.querySelectorAll("#fanpage .tile")].find((t) => t.textContent.includes("Test fits")).click()`);
    check("a project with a website, a GitHub and a community: a button for each after its first",
      await b.until(`[...document.querySelectorAll("#fanpage .hero .bar button")].map((x) => x.textContent)`, ["Make", "Website", "GitHub", "Community"], 3000),
      ["Make", "Website", "GitHub", "Community"]);
    await b.key("Home");
    check("the legend says what the keys do here", await b.ev(`document.getElementById("help").textContent.includes("the panel's first button")`), true);
    await b.key("ArrowDown");
    check("an arrow walks to the next row", await b.waitFor(`document.querySelector("#fanpage .tile.sel .cap").firstChild.textContent !== "Test yours"`, 3000));
    await b.ev(`[...document.querySelectorAll("#fanpage .tile")].find((t) => t.textContent.includes("Test missing")).click()`);
    check("a game you lack, already wanted: said on its first button",
      await b.waitFor(`(document.querySelector("#fanpage .hero .bar button") || {}).textContent === "On your wanted list"`, 3000));
    check("its tile says what it needs", await b.ev(`document.querySelector("#fanpage .tile.sel .fan-st").textContent`), "Needs No Such Game (USA)");
    await b.ev(`(() => { const i = document.querySelector("#fanpage input[type=search]"); i.value = "works"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    check("typing finds a project", await b.waitFor(`document.querySelectorAll("#fanpage .tile").length === 1`, 3000));
    await b.ev(`(() => { const i = document.querySelector("#fanpage input[type=search]"); i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); i.blur(); })()`);
    // Nothing passes the filters: Enter presses nothing, not the Play of the project selected before (roadmap AR19).
    await b.ev(`[...document.querySelectorAll("#fanpage .tile")].find((t) => t.textContent.includes("Test yours")).click()`);
    await b.ev(`(() => { window.__fanAsked = []; window.__fanFetch = window.fetch; window.fetch = function (u, o) { window.__fanAsked.push(String(u)); return window.__fanFetch.call(this, u, o); }; })()`);
    await b.ev(`(() => { const i = document.querySelector("#fanpage input[type=search]"); i.value = "no project is called this"; i.dispatchEvent(new Event("input", { bubbles: true })); i.blur(); })()`);
    await b.key("Enter");
    check("nothing passes the filters: Enter presses nothing",
      await b.ev(`[document.querySelectorAll("#fanpage .tile").length, window.__fanAsked.filter((u) => /launch|fanprojects|wanted/.test(u)).length]`), [0, 0]);
    await b.ev(`(() => { window.fetch = window.__fanFetch; const i = document.querySelector("#fanpage input[type=search]"); i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); i.blur(); })()`);
    await b.key("Escape");
    check("Escape goes back to the consoles screen",
      await b.waitFor(`document.getElementById("fanpage").hidden && !document.getElementById("syswall").hidden`, 5000));

    /* ---- from the Games menu, and back to the games ------------------------ */
    await b.key("Home");
    await b.settled();
    await b.enterConsole();
    await b.setView("grid");
    await b.openBar("games");
    await b.menuItem(/Fan projects/);
    check("Games > Fan projects opens it from the games", await b.waitFor(`!document.getElementById("fanpage").hidden && document.querySelectorAll("#fanpage .tile").length === 8`, 10000));
    await b.key("Escape");
    check("and Escape goes back to them", await b.waitFor(`document.getElementById("fanpage").hidden && !document.getElementById("main").hidden`, 5000));

    /* ---- every other way out puts the page away, one screen left up ------- */
    // Each step's window rules are checked by the helpers too (setView, menuItem): the page and another screen never both show.
    const shown = `["fanpage", "syswall", "main", "details"].filter((id) => !document.getElementById(id).hidden).join()`;
    const pageUp = `!document.getElementById("fanpage").hidden && document.querySelectorAll("#fanpage .tile").length === 8`;
    const fromGames = async () => { await b.openBar("games"); await b.menuItem(/Fan projects/); await b.waitFor(pageUp, 10000); };
    const fromWall = async () => { await b.key("End"); await b.settled(); await b.key("Enter"); await b.waitFor(pageUp, 10000); };
    await fromGames();
    await b.setView("list");
    check("from the games, the view switch to List: the page goes, the games come back as a list",
      [await b.ev(shown), await b.ev(`document.getElementById("view").classList.contains("list")`)], ["main", true]);
    await fromGames();
    await b.setView("wheel");
    check("from the games, the switch to Wheel: the consoles screen, as from the games themselves", await b.until(shown, "syswall"), "syswall");
    await fromWall();
    await b.setView("carousel");
    check("from the consoles screen, the switch to Carousel: the consoles come back, as a carousel",
      [await b.ev(shown), await b.ev(`document.getElementById("syswall").classList.contains("sw-cards")`)], ["syswall", true]);
    await fromWall();
    await b.setView("grid");
    check("from the consoles screen, the switch to Grid: every game, as a grid",
      [await b.ev(shown), await b.ev(`document.getElementById("platform").value`)], ["main", ""]);
    await b.key("Escape");
    await b.waitFor(`!document.getElementById("syswall").hidden`, 5000);
    await b.settled();
    await fromWall();
    await b.clickSel("#brand-logo");
    await b.waitFor(`!!document.querySelector(".ctx")`, 3000);
    await b.menuItem(/^Games$/);
    await b.menuItem(/^Surprise me$/);
    check("the round X's Surprise me: a game's details, the page and the consoles gone", await b.until(shown, "details", 5000), "details");
    await b.key("Escape");
    check("and Escape leaves the details for every game", await b.until(shown, "main", 5000), "main");

    /* ---- Make, from stand-ins of a team's own places (roadmap AQ2) ---------- */
    // A tiny game in the library, the team's list, its patch and its GitHub release: files under
    // data\fan-fixtures\remote that a test copy fetches in place of the internet (includes\fanmake.php).
    const N64 = "Nintendo 64", BASEID = "xs-scan-fa000000b001";
    const put = (url, bytes) => {
      const u = new URL(url), at = path.join(fix, "remote", u.host, ...u.pathname.split("/").filter(Boolean).map(decodeURIComponent));
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.writeFileSync(at, bytes);
    };
    const game = Buffer.alloc(4096, 0x5a);
    game.writeUInt32BE(0x80371240, 0);                 // a .z64's own first bytes
    const add = Buffer.from("XSEGON FAN MAKE TEST");
    const patch = fanXdelta(game, add);
    fs.writeFileSync(path.join(fix, "base.z64"), game);
    const scanned = fs.existsSync(path.join(DATA, "scanned-games.json")) ? JSON.parse(fs.readFileSync(path.join(DATA, "scanned-games.json"), "utf8")) : [];
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), JSON.stringify(scanned.concat([
      { id: BASEID, title: "Fan Make Base", platform: N64, rom: path.join(fix, "base.z64"), added: new Date().toISOString() }])));
    fs.writeFileSync(path.join(DATA, "filecheck.json"), JSON.stringify(Object.assign({}, fc, { [BASEID]: { kind: "known", name: "Fan Make Base (USA)" } })));
    for (const [dir, ver, crc] of [["fanmake", "9.9.9", crc32(patch)], ["badcrc", "9.9.8", (crc32(patch) ^ 1) >>> 0]]) {
      const file = "fanmake" + ver + ".xdelta", zip = fanZip("patches/" + file, patch, crc);
      const zipUrl = "https://github.com/xsegon-test/fanmake/releases/download/" + ver + "/fanmake" + ver + ".zip";
      put("https://example.com/" + dir + "/releases.json", JSON.stringify([{ name: "Fan Make " + ver, version: ver,
        original_url: "https://github.com/xsegon-test/fanmake/releases/tag/" + ver, files: { ntsc: file, pal: "not-this.xdelta" } }]));
      put("https://example.com/" + dir + "/files/" + file, patch);
      put(zipUrl, zip);
      put("https://api.github.com/repos/xsegon-test/fanmake/releases/tags/" + ver, JSON.stringify({ assets: [{ name: "fanmake" + ver + ".zip", size: zip.length, browser_download_url: zipUrl }] }));
    }
    const maker = (id, dir, list) => one(id, { name: id === "t-make" ? "Fan Make" : "Fan " + id.slice(2), console: N64, repo: "https://github.com/xsegon-test/fanmake",
      base: base("Fan Make Base (USA)", [{ console: N64, name: "Fan Make Base (USA)", fit: "fits" }], { id: 999995, title: "Fan Make Base", platform: N64 }),
      make: { list: list || "https://example.com/" + dir + "/releases.json", from: "https://example.com/" + dir + "/files/", take: "ntsc", patch: "xdelta",
              base: { format: "z64", md5: md5(game) }, ending: "z64" } });
    fs.writeFileSync(path.join(DATA, "fanprojects.json"), JSON.stringify({ projects: [
      maker("t-make", "fanmake"), maker("t-badcrc", "badcrc"), maker("t-offsite", "fanmake", "https://elsewhere.example.org/releases.json")] }));
    const mk = Object.fromEntries(((await api("api/fanprojects.php")).projects || []).map((p) => [p.id, p]));
    check("Make is offered where the list says how, from the team's own website or GitHub only",
      [mk["t-make"] && mk["t-make"].make, mk["t-make"] && mk["t-make"].base.state, mk["t-offsite"] && mk["t-offsite"].make], [true, "fits", false]);
    check("a project with no way to make it is refused", (await api("api/fanprojects.php", { make: "t-offsite" })).ok, false);
    const ended = () => apiUntil(async () => { const j = (await api("api/fanprojects.php?job=1")).job; return j && j.state !== "running" ? j : null; }, 30000);
    const bad = await api("api/fanprojects.php", { make: "t-badcrc" });
    const badJob = await ended();
    check("a patch that is not the one its GitHub release lists: nothing is made, and it says why",
      [bad.ok, badJob && badJob.state, /is not the one/.test((badJob && badJob.error) || ""), fs.existsSync(path.join(DATA, "fan-made"))], [true, "failed", true, false]);
    const good = await api("api/fanprojects.php", { make: "t-make" });
    const job = await ended();
    const made = (job && job.made) || {};
    check("Make: the team's latest release, its patch checked, your game read, the copy made",
      [good.ok, job && job.state, made.version, !!made.file && fs.existsSync(made.file) && md5(fs.readFileSync(made.file))],
      [true, "done", "9.9.9", md5(Buffer.concat([game, add]))]);
    check("into the console's Hacks folder, named for the project and its version",
      [path.basename(path.dirname(made.file || "")), path.basename(made.file || "")], ["Hacks", "Fan Make 9.9.9.z64"]);
    const n64 = (await api("api/library.php?platform=" + encodeURIComponent(N64) + "&grouped=0")).games || [];
    const hackOf = JSON.parse(fs.existsSync(path.join(DATA, "hack-of.json")) ? fs.readFileSync(path.join(DATA, "hack-of.json"), "utf8") : "{}");
    check("in the console's list, tied to the game it is made from",
      [n64.some((g) => g.id === made.id), (hackOf[made.id] || {}).of], [true, BASEID]);
    const after = ((await api("api/fanprojects.php")).projects || []).find((p) => p.id === "t-make") || {};
    check("and the page has it as yours, with its version", (after.yours || []).map((y) => [y.id, y.version]), [[made.id, "9.9.9"]]);
    const bar = ((await api("api/jobs.php")).jobs || []).find((j) => j.key === "fanmake") || {};
    check("the corner bar says how it ended", [bar.state, /Fan Make 9\.9\.9 is made from your Fan Make Base/.test(bar.said || "")], ["done", true]);

    /* ---- Make for a PC version: the team's GitHub release, given your game (roadmap AQ3) ---- */
    // A release's Windows zip and GitHub's answer about it, with the sha256 GitHub gives (a wrong one on purpose for the refusal).
    const sha256 = (x) => crypto.createHash("sha256").update(x).digest("hex");
    const portZip = fanZipOf([["FanPort/port.exe", Buffer.from("MZ stand-in"), crc32(Buffer.from("MZ stand-in"))],
                              ["FanPort/readme.txt", Buffer.from("read me"), crc32(Buffer.from("read me"))]]);
    const release = (repo, sum) => {
      const url = "https://github.com/xsegon-test/" + repo + "/releases/download/v1.2/FanPort-win64.zip";
      put(url, portZip);
      put("https://api.github.com/repos/xsegon-test/" + repo + "/releases/latest", JSON.stringify({ tag_name: "v1.2", name: "Fan Port 1.2",
        assets: [{ name: "FanPort-linux.zip", size: 10, browser_download_url: url.replace("win64", "linux") },
                 { name: "FanPort-win64.zip", size: portZip.length, browser_download_url: url, digest: "sha256:" + sum, updated_at: "2026-10-01T00:00:00Z" }] }));
    };
    release("fanport", sha256(portZip));
    release("fanportbad", sha256(Buffer.from("not it")));
    // A set of two discs in one .pbp, for a port that reads discs.
    const discA = fanRawDisc(20, 1), discB = fanRawDisc(17, 9);
    fs.writeFileSync(path.join(fix, "discs.pbp"), fanPbpDiscs([["TEST_00011", discA], ["TEST_00012", discB]]));
    const own2 = JSON.parse(fs.readFileSync(ownFile, "utf8"));
    fs.writeFileSync(ownFile, JSON.stringify(own2.concat([{ id: "xs-fa0000000011", title: "Fan Disc Base", platform: PS, run: path.join(fix, "discs.pbp") }])));
    const porter = (id, repo, over) => one(id, Object.assign({ name: "Fan " + id.slice(2), kind: "pc", console: N64, repo: "https://github.com/xsegon-test/" + repo,
      community: "https://example.com/talk", team: "the porters",
      base: base("Fan Make Base (USA)", [{ console: N64, name: "Fan Make Base (USA)", fit: "fits" }], { id: 999995, title: "Fan Make Base", platform: N64 }),
      make: { how: "release", asset: "-win64\\.zip$", folder: "Fan " + id.slice(2), run: "port.exe", first: "Its first start reads your game.",
              game: { to: "data/base.z64", format: "z64", md5: [md5(game)] } } }, over));
    fs.writeFileSync(path.join(DATA, "fanprojects.json"), JSON.stringify({ projects: [
      porter("t-port", "fanport"), porter("t-portbad", "fanportbad"),
      porter("t-portwrong", "fanport", { make: { how: "release", asset: "-win64\\.zip$", folder: "Fan portwrong", run: "port.exe", game: { to: "base.z64", format: "z64", md5: ["0".repeat(32)] } } }),
      porter("t-portaway", "fanport", { make: { how: "release", repo: "https://github.com/someone-else/fanport", asset: "-win64\\.zip$", folder: "x", run: "port.exe", game: { to: "base.z64" } } }),
      porter("t-discs", "fanport", { console: PS, base: base("Fan Disc Base (USA)", [{ console: PS, discs: ["TEST-00011", "TEST-00012"], fit: "fits" }], { id: 999996, title: "Fan Disc Base", platform: PS }),
                                      make: { how: "release", asset: "-win64\\.zip$", folder: "Fan discs", run: "port.exe", game: { discs: "isos", name: "Fan Disc Base" } } }),
    ] }));
    const pc = Object.fromEntries(((await api("api/fanprojects.php")).projects || []).map((p) => [p.id, p]));
    check("a PC version: Make is offered from the project's own GitHub, never another's",
      [pc["t-port"] && pc["t-port"].make, pc["t-discs"] && pc["t-discs"].make, pc["t-discs"] && pc["t-discs"].base.state, pc["t-portaway"] && pc["t-portaway"].make],
      [true, true, "fits", false]);
    const portsDir = path.join(DATA, "fan-made", N64, "Ports");
    await api("api/fanprojects.php", { make: "t-portbad" });
    const badPort = await ended();
    check("a download that is not the file GitHub lists: nothing is unpacked or kept, and it says why",
      [badPort && badPort.state, /sha256 differs/.test((badPort && badPort.error) || ""), fs.existsSync(portsDir) ? fs.readdirSync(portsDir) : []], ["failed", true, []]);
    await api("api/fanprojects.php", { make: "t-portwrong" });
    const wrongPort = await ended();
    check("a game that is not a copy the port takes: said before anything is downloaded",
      [wrongPort && wrongPort.state, /is not a copy it takes/.test((wrongPort && wrongPort.error) || ""), wrongPort && wrongPort.file], ["failed", true, undefined]);
    await api("api/fanprojects.php", { make: "t-port" });
    const portJob = await ended();
    const portDir = path.join(portsDir, "Fan port");
    check("Make for a PC version: the release unpacked into the console's Ports folder, opened up, your game where the port reads it",
      [portJob && portJob.state, fs.existsSync(path.join(portDir, "port.exe")), fs.existsSync(path.join(portDir, "data", "base.z64")) && md5(fs.readFileSync(path.join(portDir, "data", "base.z64")))],
      ["done", true, md5(game)]);
    const ownNow = (await api("api/local.php")).games || [];
    const added = ownNow.find((g) => g.id === ((portJob && portJob.made) || {}).id) || {};
    check("added to your Windows list, run from its folder, the team's links in its notes",
      [added.platform, added.run, /github\.com\/xsegon-test\/fanport/.test(added.notes || "") && /example\.com\/talk/.test(added.notes || "")],
      ["Windows", path.join(portDir, "port.exe"), true]);
    const portAfter = ((await api("api/fanprojects.php")).projects || []).find((p) => p.id === "t-port") || {};
    check("the page has it as yours, its version the release's tag", (portAfter.yours || []).map((y) => [y.id, y.version, y.local]), [[added.id, "v1.2", true]]);
    check("the corner bar's ending names where it went and what its first start does",
      /Fan port v1\.2 is set up from your Fan Make Base: .*Fan port, in your Windows list\. Its first start reads your game\./.test(
        ((((await api("api/jobs.php")).jobs || []).find((j) => j.key === "fanmake")) || {}).said || ""), true);
    await api("api/fanprojects.php", { make: "t-discs" });
    const discJob = await ended();
    const isos = path.join(DATA, "fan-made", PS, "Ports", "Fan discs", "isos");
    const binOf = (n) => path.join(isos, "Fan Disc Base (Disc " + n + ").bin");
    check("a set of discs from one .pbp: each disc written out as it was, with its .cue",
      [discJob && discJob.state, fs.existsSync(binOf(1)) && md5(fs.readFileSync(binOf(1))), fs.existsSync(binOf(2)) && md5(fs.readFileSync(binOf(2))),
       fs.existsSync(path.join(isos, "Fan Disc Base (Disc 2).cue")) && fs.readFileSync(path.join(isos, "Fan Disc Base (Disc 2).cue"), "latin1")],
      ["done", md5(discA), md5(discB), "FILE \"Fan Disc Base (Disc 2).bin\" BINARY\r\n  TRACK 01 MODE2/2352\r\n    INDEX 01 00:00:00\r\n"]);

    /* ---- a port with an emulator of its own, a build from source, a Riivolution pack ---------- */
    const file = (name, text) => [name, Buffer.from(text), crc32(Buffer.from(text))];
    // Its own emulator, pointed at your game where it is (as Project+'s Dolphin is): one release with what it opens, one without.
    const emuZip = fanZipOf([file("Emu/emu.exe", "MZ"), file("Emu/user/Launcher/start.dol", "dol")]), emuBare = fanZipOf([file("Emu/emu.exe", "MZ")]);
    for (const [repo, zip] of [["fanemu", emuZip], ["fanemubare", emuBare]]) {
      const url = "https://github.com/xsegon-test/" + repo + "/releases/download/v3/Emu-Windows.zip";
      put(url, zip);
      put("https://api.github.com/repos/xsegon-test/" + repo + "/releases/latest", JSON.stringify({ tag_name: "v3", assets: [{ name: "Emu-Windows.zip", size: zip.length, browser_download_url: url, digest: "sha256:" + sha256(zip) }] }));
    }
    const emuMake = { how: "release", asset: "-Windows\\.zip$", folder: "Fan Emu", run: "emu.exe", args: "-e \"{folder}\\user\\Launcher\\start.dol\"",
                      need: ["user/Launcher/start.dol"], game: { ini: "user/Config/Emu.ini", section: "Core", key: "DefaultISO" } };
    // Told its disc when it starts (as Dusklight and Slippi are): the disc's path in its arguments; a recipe that leaves {disc} out is not offered.
    const argMake = { how: "release", asset: "-Windows\\.zip$", folder: "Fan Arg", run: "emu.exe", args: "--user-dir \"{folder}\\data\" --dvd \"{disc}\"", game: { args: true } };
    // A build: the team's source at its newest commit, a compiler and a library from the releases its build guide names.
    const SHA = "abcdef0123456789abcdef0123456789abcdef01";
    const srcZip = fanZipOf([file("fanbuild-" + SHA + "/src/a.c", "int a;"), file("fanbuild-" + SHA + "/src/b.c", "int b;"), file("fanbuild-" + SHA + "/README.md", "read me")]);
    const ccZip = fanZipOf([file("cc/cc.php", "<?php $o = ''; $f = []; foreach (array_slice($argv, 1) as $a) { if (str_starts_with($a, '-o')) { $o = substr($a, 2); } elseif ($a[0] !== '-') { $f[] = $a; } } file_put_contents($o, implode(\"\\n\", $f));")]);
    const libZip = fanZipOf([file("lib-1/lib.dll", "a library")]);
    put("https://api.github.com/repos/xsegon-test/fanbuild/commits/main", JSON.stringify({ sha: SHA, commit: { committer: { date: "2026-10-02T00:00:00Z" } } }));
    put("https://github.com/xsegon-test/fanbuild/archive/" + SHA + ".zip", srcZip);
    put("https://github.com/someone/cc/releases/download/v1/cc.zip", ccZip);
    put("https://github.com/someone/lib/releases/download/v1/lib-1.zip", libZip);
    const buildMake = { how: "build", branch: "main", folder: "Fan build", run: "game.exe", args: "game.sfc",
      tools: [{ url: "https://github.com/someone/cc/releases/download/v1/cc.zip", size: ccZip.length, into: "third_party" },
              { url: "https://github.com/someone/lib/releases/download/v1/lib-1.zip", size: libZip.length, into: "third_party" }],
      compile: ["third_party/cc/cc.php", "-ogame.exe", "-Ithird_party/lib-1", "src/*.c"], copy: [["third_party/lib-1/lib.dll", "lib.dll"]],
      game: { to: "game.sfc", format: "z64", md5: [md5(game)] } };
    // A Riivolution pack from the team's own server: its full pack, the updates after it, and what an update takes away.
    const host = "https://cdn.example.org/pack/";
    put("https://example.com/pack/install.txt", host + "1.0.0-full.zip\n");
    put("https://example.com/pack/versions.txt", "0.9.0 " + host + "0.9.0.zip /0.9.0.zip Old\n1.0.0 " + host + "1.0.0.zip /1.0.0.zip Same\n1.0.1 " + host + "1.0.1.zip /1.0.1.zip New\n");
    put("https://example.com/pack/deletes.txt", "0.9.0 /Pack6/kept.txt\n1.0.1 /Pack6/gone.txt\n");
    put(host + "1.0.0-full.zip", fanZipOf([file("Pack6/version.txt", "1.0.0"), file("Pack6/kept.txt", "kept"), file("Pack6/gone.txt", "gone"),
                                           file("riivolution/Pack6.xml", "<wiidisc/>"), file("apps/console-only.dol", "not for Dolphin")]));
    put(host + "1.0.1.zip", fanZipOf([file("Pack6/new.txt", "new")]));
    const packMake = (install) => ({ how: "pack", hosts: ["example.org"], install, updates: "https://example.com/pack/versions.txt",
      deletes: "https://example.com/pack/deletes.txt", take: ["Pack6", "riivolution"], version: "Pack6/version.txt", xml: "riivolution/Pack6.xml",
      options: [{ "section-name": "Pack", "option-name": "Pack", choice: 1 }], folder: "Fan Pack" });
    fs.writeFileSync(path.join(DATA, "fanprojects.json"), JSON.stringify({ projects: [
      porter("t-emu", "fanemu", { make: emuMake }), porter("t-emubare", "fanemubare", { make: emuMake }),
      porter("t-arg", "fanemu", { make: argMake }), porter("t-argnone", "fanemu", { make: Object.assign({}, argMake, { args: "-b" }) }),
      porter("t-build", "fanbuild", { make: buildMake }),
      porter("t-buildaway", "fanbuild", { make: Object.assign({}, buildMake, { tools: [{ url: "https://example.com/cc.zip", size: 1, into: "third_party" }] }) }),
      porter("t-pack", "fanport", { kind: "disc", page: "https://example.com/pack", make: packMake("https://example.com/pack/install.txt") }),
      porter("t-packaway", "fanport", { kind: "disc", page: "https://example.com/pack", make: packMake("https://elsewhere.example.net/install.txt") }),
    ] }));
    const kinds = Object.fromEntries(((await api("api/fanprojects.php")).projects || []).map((p) => [p.id, p.make]));
    check("its own emulator, a disc in its arguments, a build and a pack are offered; {disc} left out, a tool from no GitHub release, or a pack from another's server, is not",
      kinds, { "t-emu": true, "t-emubare": true, "t-arg": true, "t-argnone": false, "t-build": true, "t-buildaway": false, "t-pack": true, "t-packaway": false });
    await api("api/fanprojects.php", { make: "t-emubare" });
    const bare = await ended();
    check("a release without what it is told to open: refused, nothing kept",
      [bare && bare.state, /has no user\/Launcher\/start\.dol in it/.test((bare && bare.error) || ""), fs.existsSync(path.join(portsDir, "Fan Emu"))], ["failed", true, false]);
    await api("api/fanprojects.php", { make: "t-emu" });
    const emuJob = await ended();
    const emuDir = path.join(portsDir, "Fan Emu"), emuIni = path.join(emuDir, "user", "Config", "Emu.ini");
    const emuOwn = ((await api("api/local.php")).games || []).find((g) => g.id === ((emuJob && emuJob.made) || {}).id) || {};
    check("its own emulator: pointed at your game where it is, nothing copied, told what to open in its folder",
      [emuJob && emuJob.state, fs.existsSync(emuIni) && fs.readFileSync(emuIni, "utf8"), fs.existsSync(path.join(emuDir, "base.z64")), emuOwn.args],
      ["done", "[Core]\r\nDefaultISO = " + path.join(fix, "base.z64") + "\r\n", false, "-e \"" + emuDir + "\\user\\Launcher\\start.dol\""]);
    await api("api/fanprojects.php", { make: "t-arg" });
    const argJob = await ended();
    const argDir = path.join(portsDir, "Fan Arg");
    const argOwn = ((await api("api/local.php")).games || []).find((g) => g.id === ((argJob && argJob.made) || {}).id) || {};
    check("a disc in its arguments: nothing copied, started with your game where it is and its own folder for its data",
      [argJob && argJob.state, fs.existsSync(path.join(argDir, "emu.exe")), fs.existsSync(path.join(argDir, "base.z64")), argOwn.args],
      ["done", true, false, "--user-dir \"" + argDir + "\\data\" --dvd \"" + path.join(fix, "base.z64") + "\""]);
    await api("api/fanprojects.php", { make: "t-build" });
    const buildJob = await ended();
    const buildDir = path.join(portsDir, "Fan build");
    check("a build: the source opened up, the tools in their folders, the build line run there with its files named, what it needs beside it",
      [buildJob && buildJob.state, buildJob && buildJob.version,
       fs.existsSync(path.join(buildDir, "game.exe")) && fs.readFileSync(path.join(buildDir, "game.exe"), "utf8"),
       fs.existsSync(path.join(buildDir, "lib.dll")), fs.existsSync(path.join(buildDir, "game.sfc")) && md5(fs.readFileSync(path.join(buildDir, "game.sfc")))],
      ["done", "build abcdef0", "src\\a.c\nsrc\\b.c", true, md5(game)]);
    await api("api/fanprojects.php", { make: "t-pack" });
    const packJob = await ended();
    const packDir = path.join(DATA, "fan-made", N64, "Mods", "Fan Pack");
    const desc = fs.existsSync(path.join(packDir, "Fan Pack.json")) ? JSON.parse(fs.readFileSync(path.join(packDir, "Fan Pack.json"), "utf8")) : {};
    check("a pack: its mod folders only, each newer update put on, what an update takes away gone and the rest kept",
      [packJob && packJob.state, fs.existsSync(path.join(packDir, "apps")), ["kept.txt", "gone.txt", "new.txt"].map((f) => fs.existsSync(path.join(packDir, "Pack6", f))),
       fs.existsSync(path.join(packDir, "Pack6", "version.txt")) && fs.readFileSync(path.join(packDir, "Pack6", "version.txt"), "utf8")],
      ["done", false, [true, false, true], "1.0.1"]);
    check("and Dolphin's start file boots your game where it is, with the pack and its options",
      [desc.type, desc["base-file"], ((desc.riivolution || {}).patches || [])[0]],
      ["dolphin-game-mod-descriptor", path.join(fix, "base.z64"), { xml: path.join(packDir, "riivolution", "Pack6.xml"), root: packDir, options: [{ "section-name": "Pack", "option-name": "Pack", choice: 1 }] }]);
    const n64Now = (await api("api/library.php?platform=" + encodeURIComponent(N64) + "&grouped=0")).games || [];
    const hackOf2 = JSON.parse(fs.existsSync(path.join(DATA, "hack-of.json")) ? fs.readFileSync(path.join(DATA, "hack-of.json"), "utf8") : "{}");
    const packId = ((packJob && packJob.made) || {}).id;
    check("in the console's list, the start file its game, tied to the game it is made from, yours at its version",
      [n64Now.some((g) => g.id === packId), (hackOf2[packId] || {}).of,
       ((((await api("api/fanprojects.php")).projects || []).find((p) => p.id === "t-pack") || {}).yours || []).map((y) => y.version)],
      [true, BASEID, ["1.0.1"]]);
  } finally {
    kept.restore();
    fs.rmSync(fix, { recursive: true, force: true });
    fs.rmSync(path.join(DATA, "fan-made"), { recursive: true, force: true });
  }
};
