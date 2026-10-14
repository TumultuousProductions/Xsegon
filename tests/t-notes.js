/*  Notes (api\notes.php, js\notestab.js): a person's own words about a game,
    in the Notes tab of its details, kept as they are written.
    On the test copy's own data; nothing is started. */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, DATA, Guard, sleep } = require("./lib");

module.exports = async function (b, check) {
  const kept = new Guard(["notes.json"]);
  const n64 = (await api("api/library.php?platform=" + encodeURIComponent("Nintendo 64"))).games || [];
  const g = n64.find((x) => /^Star Fox 64/.test(x.title)) || n64[0];
  const other = n64.find((x) => x.id !== g.id);
  check("the library has two games to write about", !!g && !!other, true);
  const stored = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, "notes.json"), "utf8")); } catch (e) { return {}; } };
  const storedIs = async (want) => { for (let i = 0; i < 40; i++) { if ((stored()[g.id] || {}).text === want) { return true; } await sleep(100); } return false; };
  const ask = (id) => api("api/notes.php?id=" + encodeURIComponent(id));
  const record = async (id) => (await api("api/game.php?id=" + encodeURIComponent(id))).game || {};

  try {
    fs.rmSync(path.join(DATA, "notes.json"), { force: true });

    /* ---- kept, read back, taken away ------------------------------------- */
    const none = await ask(g.id);
    check("a game with no note answers with an empty one", [none.ok, none.text, none.at], [true, "", 0]);
    const words = "Stuck on Sector Y.\nPassword: 1234\n  The wide core looked best.";
    const put = await api("api/notes.php", { id: g.id, text: words.replace(/\n/g, "\r\n") });
    check("a note is kept exactly as written, its lines and its spaces", [put.ok, (await ask(g.id)).text, (stored()[g.id] || {}).text, put.at > 0], [true, words, words, true]);
    check("the game's full record says it has one, and another game's says it has none", [(await record(g.id)).myNote, (await record(other.id)).myNote], [true, false]);
    check("a note of nothing but spaces takes the note away, entry and all", [(await api("api/notes.php", { id: g.id, text: "  \n" })).ok, g.id in stored(), (await ask(g.id)).text], [true, false, ""]);
    check("refused: a note for no game, no words given, and one longer than a note holds",
      [(await api("api/notes.php", { id: "xs-nobody", text: "x" })).ok, (await api("api/notes.php", { id: g.id })).ok, (await api("api/notes.php", { id: g.id, text: "x".repeat(20001) })).ok],
      [false, false, false]);

    /* ---- the tab ---------------------------------------------------------- */
    const TABS = `[...document.querySelectorAll("#details .dtabs .dtab")]`;
    const tabOn = `(t => (t ? t.textContent : null))(${TABS}.find((x) => x.classList.contains("on")))`;
    const BOX = `document.querySelector("#details .dtab-pane.is-notes .nt-box")`;
    const inBox = `document.activeElement === ${BOX}`;
    const open = async (id) => {
      const there = await b.ev(`import("/js/state.js").then((S) => { const i = S.games.findIndex((x) => x.id === ${JSON.stringify(id)}); if (i >= 0) { S.setSel(i); } return i >= 0; })`);
      if (!there) { return false; }
      await b.key("i");
      return b.waitFor(`!document.getElementById("details").hidden && !!document.querySelector("#details .dtabs")`, 8000);
    };
    await b.goto();
    await b.setView("list");
    await b.openPlatform("Nintendo 64");
    check("(the game's details open)", await open(g.id), true);
    check("details has a Notes tab, the last one", await b.until(`${TABS}.map((x) => x.textContent).slice(-2)`, ["Accompanied files", "Notes"], 8000), ["Accompanied files", "Notes"]);
    await b.key("n");
    check("N opens it: an empty box that says what it is for",
      [await b.until(tabOn, "Notes", 4000), await b.waitFor(`!!${BOX}`, 6000), await b.ev(`${BOX}.value`), await b.ev(`/Star Fox 64|${g.title.replace(/[^A-Za-z0-9 ]/g, ".")}/.test(${BOX}.placeholder)`)],
      ["Notes", true, "", true]);
    await b.key("ArrowDown");
    check("Down from the tabs goes into the box", await b.until(inBox, true, 3000), true);
    const launches = (await b.ev(`(window.__launches || []).length`)) || 0;
    // Letters that are keys elsewhere in details (f, d, n), then Enter and an arrow.
    for (const k of "find dn") { await b.key(k); }
    await b.key("Enter");
    await b.key("ArrowLeft");
    check("every key belongs to the box while it is written in: no tab changes, no game starts, details stays",
      [await b.ev(`${BOX}.value.replace(/\\n/g, "")`), await b.ev(tabOn), await b.ev(`(window.__launches || []).length`), await b.ev(`document.getElementById("details").hidden`), await b.ev(inBox)],
      ["find dn", "Notes", launches, false, true]);
    check("a pause in the typing keeps it, with nothing pressed",
      [await b.until(`(document.querySelector("#details .nt-says") || {}).textContent`, "Kept.", 6000), ((stored()[g.id] || {}).text || "").replace(/\n/g, "")], ["Kept.", "find dn"]);
    check("and the tab wears a mark from then on", await b.until(tabOn, "Notes •", 4000), "Notes •");
    await b.shot("details-tab-notes");
    await b.key("Escape");
    check("Esc leaves the box and goes back to the tabs, details still up",
      [await b.until(inBox, false, 3000), await b.ev(`document.getElementById("details").hidden`), await b.ev(tabOn)], [false, false, "Notes •"]);
    await b.key("n");
    check("N at the tabs goes back to About", await b.until(tabOn, "About", 3000), "About");

    // Written and left at once: the leaving keeps it.
    await b.key("n");
    await b.waitFor(`!!${BOX}`, 6000);
    await b.ev(`(() => { const x = ${BOX}; x.focus(); x.value = "find dn and more"; x.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await b.clickSel(`#details .dtab[data-tab="about"]`);
    check("changing tab straight after writing keeps what was written", await storedIs("find dn and more"), true);
    await b.clickSel(`#details .dtab[data-tab="notes"]`);
    check("and coming back shows it", await b.until(`(${BOX} || {}).value`, "find dn and more", 6000), "find dn and more");
    await b.ev(`(() => { const x = ${BOX}; x.focus(); x.value = "closed while writing"; x.dispatchEvent(new Event("input", { bubbles: true })); x.blur(); })()`);
    await b.key("Escape");
    await b.until(`document.getElementById("details").hidden`, true, 6000);
    check("closing details straight after writing keeps it too", await storedIs("closed while writing"), true);

    check("(another game's details open)", await open(other.id), true);
    await b.key("n");
    check("another game's Notes are its own: empty, and no mark on its tab", [await b.waitFor(`!!${BOX}`, 6000), await b.ev(`${BOX}.value`), await b.ev(tabOn)], [true, "", "Notes"]);
    await b.key("Escape");
    await b.until(`document.getElementById("details").hidden`, true, 6000);

    check("(the first game's details open again)", await open(g.id), true);
    check("its tab wears the mark before it is opened", await b.until(`${TABS}.map((x) => x.textContent).slice(-1)`, ["Notes •"], 8000), ["Notes •"]);
    await b.key("n");
    await b.waitFor(`!!${BOX}`, 6000);
    await b.ev(`(() => { const x = ${BOX}; x.focus(); x.value = ""; x.dispatchEvent(new Event("input", { bubbles: true })); x.blur(); })()`);
    check("emptying the box takes the note and the mark away",
      [await b.until(tabOn, "Notes", 6000), g.id in stored()], ["Notes", false]);
    await b.key("Escape");
    await b.until(`document.getElementById("details").hidden`, true, 6000);
    check("no script errors through any of it", await b.ev(`(window.__errs || []).length`), 0);
  } finally {
    kept.restore();
  }
};
