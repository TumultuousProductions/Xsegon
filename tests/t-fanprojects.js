/* The Fan projects page (roadmap AQ1, js/fanprojects.js, api/fanprojects.php):
   where each project stands is read from what Xsegon keeps, a listed team's
   page is the only thing that can be opened, and the page is a card on the
   consoles screen and an entry in the Games menu. A list of the test's own
   (data/fanprojects.json, read only by a test copy) names games this copy has. */

"use strict";
const fs = require("fs");
const path = require("path");
const { api, BASE, DATA, Guard } = require("./lib");

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

module.exports = async function (b, check) {
  const kept = new Guard(["fanprojects.json", "wanted.json", "local-games.json"]);
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
  } finally {
    kept.restore();
    fs.rmSync(fix, { recursive: true, force: true });
  }
};
