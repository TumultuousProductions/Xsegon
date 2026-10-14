/* Games > Games you do not have: the wanted list.
 *
 * Every game on record for a console, without the ones in the library; a
 * star puts one on the wanted list (data/wanted.json), and the starred ones
 * export as a file. Read from the Games Database Xsegon already carries.
 * wanted.json is in the run's guard, so a crash here cannot leave a test
 * star in the real list.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, BASE, DATA, sleep } = require("./lib");

const FILE = path.join(DATA, "wanted.json");
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { return null; } };

module.exports = async function (b, check) {
  const was = fs.existsSync(FILE) ? fs.readFileSync(FILE) : null;
  fs.rmSync(FILE, { force: true });
  try {
    /* ---- the consoles ---------------------------------------------------- */
    const top = await api("api/wanted.php");
    check("wanted: the consoles on record are listed", [top.ok, (top.platforms || []).length > 50], [true, true]);
    const mine = (top.platforms || []).filter((p) => p.yours > 0);
    check("the consoles you have games for come first", (top.platforms || []).slice(0, mine.length).every((p) => p.yours > 0), true);
    check("with nothing starred yet", top.wanted, []);
    // A console with a fair number of games here, so "have" has something to find.
    const con = mine.filter((p) => p.name !== "Windows").sort((a, b2) => b2.yours - a.yours)[0];

    /* ---- one console's games --------------------------------------------- */
    const one = await api("api/wanted.php?platform=" + encodeURIComponent(con.name));
    const games = one.games || [];
    check("every game on record for a console is listed", [one.ok, games.length, games.length > 20], [true, con.games, true]);
    check("each with what a person chooses by", games.every((g) => g.id > 0 && typeof g.title === "string" && g.title !== "" && typeof g.have === "boolean"), true);
    const have = games.filter((g) => g.have && (!g.type || g.type === "Released")).length;
    check("some are marked as ones you have, and most are not", [have > 0, have < games.length], [true, true]);
    const lib = await api("api/library.php?grouped=0&platform=" + encodeURIComponent(con.name));
    const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
    const libKeys = new Set((lib.games || []).map((g) => key(g.title)));
    const hit = games.find((g) => g.have && libKeys.has(key(g.title)));
    check("a game marked have really is in the library, by name", !!hit, true);
    check("a console that is not on record answers an empty list, not an error", (await api("api/wanted.php?platform=No%20Such%20Console")).games, []);

    /* ---- starring -------------------------------------------------------- */
    const pick = games.filter((g) => !g.have && g.type === "Released").slice(0, 2);
    const odd = "=Odd, \"Title\"";
    check("a star with no title is refused", (await api("api/wanted.php", { id: pick[0].id, want: true })).ok, false);
    check("and one with no game", (await api("api/wanted.php", { want: true, title: "x", platform: "y" })).ok, false);
    check("nothing was written by either", fs.existsSync(FILE), false);
    const s1 = await api("api/wanted.php", { id: pick[0].id, want: true, title: pick[0].title, platform: con.name, year: pick[0].year });
    const s2 = await api("api/wanted.php", { id: pick[1].id, want: true, title: odd, platform: con.name, year: "1999" });
    check("starring a game puts it on the wanted list", [s1.ok, s2.ok, s2.wanted], [true, true, 2]);
    const kept = (read() || {})[pick[0].id] || {};
    check("kept by the database's number, with its title, console and year", [kept.title, kept.platform, kept.year], [pick[0].title, con.name, pick[0].year]);
    check("the console's list says which are starred", ((await api("api/wanted.php?platform=" + encodeURIComponent(con.name))).wanted || []).sort(), [pick[0].id, pick[1].id].sort());
    check("and the consoles say how many", ((await api("api/wanted.php")).platforms.find((p) => p.name === con.name) || {}).starred, 2);

    /* ---- the export ------------------------------------------------------ */
    const csvRes = await fetch(BASE + "/api/wanted.php?export=csv");
    const csv = Buffer.from(await csvRes.arrayBuffer()).toString("utf8");
    check("the export is a file to save, named for today", [csvRes.status, /text\/csv/.test(csvRes.headers.get("content-type") || ""),
      /attachment; filename="xsegon-wanted-\d{4}-\d\d-\d\d\.csv"/.test(csvRes.headers.get("content-disposition") || "")], [200, true, true]);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    check("with a heading and one line per starred game", [lines[0], lines.length], ["Title,Console,Year,Starred", 3]);
    const q = (s) => "\"" + s.replace(/"/g, "\"\"") + "\"";
    check("each cell quoted, quotes doubled, and a title that starts like a formula made harmless",
      lines.some((l) => l.startsWith(q("'" + odd) + "," + q(con.name) + "," + q("1999") + ",")), true);
    check("and the real one as it is named", lines.some((l) => l.startsWith(q(pick[0].title) + "," + q(con.name))), true);
    const txt = await (await fetch(BASE + "/api/wanted.php?export=txt")).text();
    check("the plain text one is grouped under its console", [txt.includes("Games I want (2)"), txt.includes("\r\n" + con.name + "\r\n"), txt.includes("  " + pick[0].title)], [true, true, true]);
    check("one console alone can be exported, and another's has no games in it",
      [(await (await fetch(BASE + "/api/wanted.php?export=txt&platform=" + encodeURIComponent(con.name))).text()).includes("Games I want (2)"),
       (await (await fetch(BASE + "/api/wanted.php?export=txt&platform=Nope")).text()).includes("Games I want (0)")], [true, true]);
    check("an export that is neither kind is refused", (await api("api/wanted.php?export=exe")).ok, false);

    check("taking a star off takes it off the list", [(await api("api/wanted.php", { id: pick[1].id, want: false })).wanted, Object.keys(read() || {})], [1, [String(pick[0].id)]]);

    /* ---- the screen ------------------------------------------------------ */
    await b.goto(BASE + "/");
    await b.enterConsole();
    await b.setView("grid");
    await b.ev(`localStorage.setItem("xs-wanted-console", ${JSON.stringify(con.name)})`);
    await b.openBar("games");
    await b.menuItem(/Games you do not have/);
    check("Games opens it", await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "GAMES YOU DO NOT HAVE"`, 10000));
    check("on the console it was on last, with its games listed", await b.waitFor(`(document.querySelector("#editor .want-console") || {}).value === ${JSON.stringify(con.name)} && document.querySelectorAll("#editor .want-row").length > 0`, 20000));
    check("a long list is drawn a part at a time", await b.ev(`document.querySelectorAll("#editor .want-row").length <= 600`), true);
    check("none of them a game you have", await b.ev(`document.querySelectorAll("#editor .want-row.have").length`), 0);
    check("the one starred before is shown starred", await b.ev(`[...document.querySelectorAll("#editor .want-row.wanted .sc-title")].map((n) => n.textContent)`), [pick[0].title]);
    check("and the line above says what is on record, what you have and what is starred",
      await b.ev(`/ on record, you have ${have}, 1 starred here/.test([...document.querySelectorAll("#editor .mt-note")].map((n) => n.textContent).join(" | "))`), true);

    // Star a second one by pressing it, and narrow to the starred.
    await b.ev(`[...document.querySelectorAll("#editor .want-row:not(.wanted) .want-star")][0].click()`);
    check("pressing a star saves it", await b.waitFor(`document.querySelectorAll("#editor .want-row.wanted").length === 2`, 6000));
    for (let i = 0; i < 30 && Object.keys(read() || {}).length !== 2; i++) { await sleep(100); }
    check("in the file", Object.keys(read() || {}).length, 2);
    const tick = (re) => `(() => { [...document.querySelectorAll("#editor .want-check")].find((l) => ${re}.test(l.textContent)).querySelector("input").click(); })()`;
    await b.ev(tick("/Only starred/"));
    check("Only starred narrows the list to them", await b.waitFor(`document.querySelectorAll("#editor .want-row").length === 2`, 6000));
    await b.ev(tick("/Only starred/"));
    await b.ev(`(() => { const i = document.querySelector("#editor .want-find"); i.value = ${JSON.stringify(pick[0].title)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    check("typing finds a game by name", await b.waitFor(`document.querySelectorAll("#editor .want-row").length >= 1 && document.querySelectorAll("#editor .want-row").length < 20`, 6000));
    await b.ev(`(() => { const i = document.querySelector("#editor .want-find"); i.value = ${JSON.stringify(hit ? hit.title : "")}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await b.ev(tick("/ones I have too/"));
    check("Show the ones I have too brings them in, marked", await b.waitFor(`document.querySelectorAll("#editor .want-row.have .want-have").length > 0`, 6000));
    await b.key("Escape");
    await sleep(500);
    check("Escape closes it", await b.ev(`document.getElementById("editor").hidden`), true);
  } finally {
    if (was === null) { fs.rmSync(FILE, { force: true }); } else { fs.writeFileSync(FILE, was); }
  }
};
