/* The Fan projects page (roadmap AQ1, js/fanprojects.js, api/fanprojects.php):
   where each project stands is read from what Xsegon keeps, a listed team's
   page is the only thing that can be opened, and the page is a card on the
   consoles screen and an entry in the Games menu. A list of the test's own
   (data/fanprojects.json, read only by a test copy) names games this copy has. */

"use strict";
const fs = require("fs");
const path = require("path");
const { api, BASE, DATA, Guard } = require("./lib");

module.exports = async function (b, check) {
  const kept = new Guard(["fanprojects.json", "wanted.json"]);
  try {
    /* ---- the shipped list -------------------------------------------------- */
    fs.rmSync(path.join(DATA, "fanprojects.json"), { force: true });
    const real = await api("api/fanprojects.php");
    const shipped = real.projects || [];
    check("fan projects: the shipped list is read", [real.ok, shipped.length >= 10], [true, true]);
    check("each with a name, a kind, a console and an https page",
      shipped.every((p) => p.name && p.kindLabel && p.console && /^https:\/\//.test(p.page)), true);
    check("each says where it stands", shipped.every((p) => ["fits", "works", "other", "unchecked", "missing"].includes(p.base.state)), true);

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
    fs.writeFileSync(path.join(DATA, "fanprojects.json"), JSON.stringify({ projects: [
      one("t-fits", { tags: ["coop"], community: "https://example.com/talk", base: base(krec.name, [{ console: kgame.platform, name: krec.name, fit: "fits" }]) }),
      one("t-works", { base: base(krec.name, [{ console: kgame.platform, name: "No Such Release (USA)", fit: "fits" },
                                              { console: kgame.platform, name: krec.name, fit: "works", note: "works; another is better" }]) }),
      one("t-other", { base: base("No Such Release (USA)", [{ console: kgame.platform, name: "No Such Release (USA)", fit: "fits" }],
                                  { id: 999991, title: kgame.title, platform: kgame.platform }) }),
      one("t-missing", { base: base("No Such Game (USA)", [{ console: kgame.platform, name: "No Such Game (USA)", fit: "fits" }],
                                    { id: 999992, title: "No Such Game", platform: kgame.platform }) }),
      one("t-yours", { kind: "pc", console: hgame.platform, base: base("No Such Base", [{ console: hgame.platform, name: "No Such Base", fit: "fits" }]),
                       yours: { header: hrec.header.title.trim(), crc: { [hrec.crc]: "9.9" } } }),
      one("t-plain", { page: "http://example.com/plain", base: base("x", [{ console: kgame.platform, name: "x", fit: "fits" }]) }),
      one("T bad id", { base: base("x", [{ console: kgame.platform, name: "x", fit: "fits" }]) }),
    ] }));
    const own = await api("api/fanprojects.php");
    const by = Object.fromEntries((own.projects || []).map((p) => [p.id, p]));
    check("a test copy's own list is read, and entries with a bad id or a page that is not https are left out",
      Object.keys(by).sort(), ["t-fits", "t-missing", "t-other", "t-works", "t-yours"]);
    check("a release the file check knows fits", [by["t-fits"].base.state, by["t-fits"].base.gameId, by["t-fits"].base.release], ["fits", kid, krec.name]);
    check("the best fit is taken, with its note", [by["t-works"].base.state, by["t-works"].base.note], ["works", "works; another is better"]);
    check("the same game in another release is said so", [by["t-other"].base.state, by["t-other"].base.gameId], ["other", kid]);
    check("a game the library lacks is missing", by["t-missing"].base.state, "missing");
    const mine = by["t-yours"].yours.find((y) => y.id === hid);
    check("a copy already yours is found by its header, its version by its checksum", [!!mine, mine && mine.version], [true, "9.9"]);
    check("the picture is a copy of yours, else the game it is made from", [by["t-yours"].pic, by["t-fits"].pic], [by["t-yours"].yours[0].id, kid]);

    /* ---- the wanted list and the pages ------------------------------------- */
    await api("api/wanted.php", { id: 999992, want: true, title: "No Such Game", platform: kgame.platform, year: "" });
    check("a game on the wanted list is said to be", ((((await api("api/fanprojects.php")).projects || []).find((p) => p.id === "t-missing") || {}).base || {}).wanted, true);
    check("a listed page opens (a test copy opens nothing)", await api("api/fanprojects.php", { open: "t-fits", which: "page" }),
      { ok: true, url: "https://example.com/t-fits", dry: true });
    check("and its community", (await api("api/fanprojects.php", { open: "t-fits", which: "community" })).url, "https://example.com/talk");
    check("a page the list does not name is refused", (await api("api/fanprojects.php", { open: "t-missing", which: "community" })).ok, false);
    check("an address from the request is never opened", (await api("api/fanprojects.php", { open: "https://example.org", which: "page" })).ok, false);

    /* ---- the page ---------------------------------------------------------- */
    await b.goto(BASE + "/");
    await b.waitFor(`!document.getElementById("syswall").hidden && document.querySelectorAll("#syswall .sel").length > 0`, 10000);
    await b.key("End");
    await b.settled();
    check("Fan projects is the last card on the consoles screen", await b.ev(`((document.querySelector("#syswall .sel") || {}).textContent || "").includes("Fan projects")`), true);
    await b.key("Enter");
    check("Enter on it opens the page", await b.waitFor(`!!document.getElementById("fanpage") && !document.getElementById("fanpage").hidden && document.querySelectorAll("#fanpage .tile").length === 5`, 10000));
    check("in place of the consoles screen", await b.ev(`document.getElementById("syswall").hidden`), true);
    check("its headings in the order a person acts, with their counts",
      await b.ev(`[...document.querySelectorAll("#fanpage .ghead")].map((h) => h.textContent)`),
      ["In your library1", "Ready to make2", "You have another release1", "Needs a game you do not have1"]);
    check("the first is chosen and the panel names it",
      await b.ev(`document.querySelector("#fanpage .tile.sel .cap").firstChild.textContent === document.querySelector("#fanpage .hero-name").textContent`), true);
    check("a copy of yours: the panel's first button plays it", await b.ev(`document.querySelector("#fanpage .hero .bar button").textContent`), "Play 9.9");
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
    check("Games > Fan projects opens it from the games", await b.waitFor(`!document.getElementById("fanpage").hidden && document.querySelectorAll("#fanpage .tile").length === 5`, 10000));
    await b.key("Escape");
    check("and Escape goes back to them", await b.waitFor(`document.getElementById("fanpage").hidden && !document.getElementById("main").hidden`, 5000));

    /* ---- every other way out puts the page away, one screen left up ------- */
    // Each step's window rules are checked by the helpers too (setView, menuItem): the page and another screen never both show.
    const shown = `["fanpage", "syswall", "main", "details"].filter((id) => !document.getElementById(id).hidden).join()`;
    const pageUp = `!document.getElementById("fanpage").hidden && document.querySelectorAll("#fanpage .tile").length === 5`;
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
  }
};
