/* Tags of your own: labels you put on any game, and Filter by
 * narrows to. What is worth holding:
 *
 *   - the server files them one spelling per tag, refuses what cannot be a
 *     tag (no name, too long, a game that is not there), and a tag goes when
 *     its last game lets go of it;
 *   - every row carries its tags, the library lists every tag with its
 *     count, a tag filters (without case), two tags stack to the games that
 *     carry both, and the search finds a game by its tag;
 *   - on the screen: Tags... on the right-click menu, the list of switches
 *     that stays up, New tag..., the magenta pill in the info panel, the
 *     line in details, and the tag in Filter by narrowing the console;
 *   - "needs fix" and "runs" in every list, and "needs fix" being the NEEDS
 *     FIX mark itself both ways.
 *
 * tags.json is in the Guard, so a crash cannot leave a test tag behind; the
 * group takes its own tags off as it goes as well.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, sleep, DATA } = require("./lib");

const A_TAG = "Xsegon Test Tag";
const B_TAG = "Zz Second Test";
const UI_TAG = "Xsegon Screen Tag";

module.exports = async function (b, check) {
  const tag = (id, add, name) => api("api/tags.php", add ? { id, add: name } : { id, remove: name });
  const n64 = await api("api/library.php?grouped=0&platform=" + encodeURIComponent("Nintendo 64"));
  const [ga, gb] = n64.games;

  /* ---- the server ------------------------------------------------------ */
  const first = await tag(ga.id, true, A_TAG);
  check("a tag goes on a game", first.ok === true && first.tags.includes(A_TAG));
  check("and the whole list comes back with its count", (first.all.find((t) => t.name === A_TAG) || {}).count, 1);
  const second = await tag(gb.id, true, A_TAG.toLowerCase());
  check("the same tag in other letters is filed in the first spelling", second.ok && second.tags.includes(A_TAG) && !second.tags.includes(A_TAG.toLowerCase()));
  check("two games now carry it", (second.all.find((t) => t.name === A_TAG) || {}).count, 2);
  check("putting it on twice does not double it", (await tag(ga.id, true, A_TAG)).tags.filter((t) => t === A_TAG).length, 1);
  check("a tag with no name is refused", (await tag(ga.id, true, "   ")).ok, false);
  check("so is one longer than 24 characters", (await tag(ga.id, true, "x".repeat(25))).ok, false);
  check("and one for a game that is not there", (await tag("no-such-game-here", true, A_TAG)).ok, false);
  check("and a request that says neither add nor remove", (await api("api/tags.php", { id: ga.id })).ok, false);

  const lib = await api("api/library.php?grouped=0");
  check("every row carries its tags", lib.games.every((g) => Array.isArray(g.tags)));
  check("the tagged games say so", [ga, gb].every((x) => (lib.games.find((g) => g.id === x.id) || { tags: [] }).tags.includes(A_TAG)));
  check("the library lists the tag with its count", (lib.tags.find((t) => t.name === A_TAG) || {}).count, 2);
  const byTag = await api("api/library.php?grouped=0&tag%5B%5D=" + encodeURIComponent(A_TAG));
  check("a tag filters to the games that carry it", byTag.count === 2 && byTag.games.every((g) => g.tags.includes(A_TAG)));
  check("whatever the letters", (await api("api/library.php?grouped=0&tag%5B%5D=" + encodeURIComponent(A_TAG.toUpperCase()))).count, 2);
  check("and counts the consoles the same way", Object.values(byTag.filtered.platforms).reduce((a, n) => a + n, 0), 2);
  await tag(ga.id, true, B_TAG);
  const both = await api("api/library.php?grouped=0&tag%5B%5D=" + encodeURIComponent(A_TAG) + "&tag%5B%5D=" + encodeURIComponent(B_TAG));
  check("two tags stack to the games that carry both", both.count === 1 && both.games[0].id === ga.id);
  const found = await api("api/library.php?grouped=0&q=" + encodeURIComponent("xsegon test tag"));
  check("the search finds a game by its tag", [ga.id, gb.id].every((id) => found.games.some((g) => g.id === id)));
  await tag(gb.id, false, A_TAG);
  check("taking it off one game counts one fewer", ((await api("api/tags.php")).tags.find((t) => t.name === A_TAG) || {}).count, 1);
  await tag(ga.id, false, A_TAG);
  await tag(ga.id, false, B_TAG);
  const gone = await api("api/tags.php");
  check("a tag goes when its last game lets go of it", !gone.tags.some((t) => t.name === A_TAG || t.name === B_TAG));

  /* ---- "needs fix" and "runs": standard, and needs fix is the mark ------- */
  const std = (list) => ["needs fix", "runs"].every((n) => list.some((t) => t.name.toLowerCase() === n));
  check("needs fix and runs are in every tag list, carried by a game or not", [std(gone.tags), std(lib.tags)], [true, true]);
  const [, , gc, gd] = n64.games;
  const fixFile = path.join(DATA, "fix-marks.json"), lrFile = path.join(DATA, "launch-results.json"), tagsFile = path.join(DATA, "tags.json");
  const keep = [fixFile, lrFile].map((f) => (fs.existsSync(f) ? fs.readFileSync(f) : null));
  const one = async (id) => (await api("api/library.php?grouped=0&versions=all")).games.find((g) => g.id === id) || {};
  const later = (s) => new Date(Date.now() + s * 1000).toISOString();
  try {
    const lr0 = (() => { try { return JSON.parse(String(keep[1] || "{}").replace(/^﻿/, "")); } catch (e) { return {}; } })();
    delete lr0[gc.id]; delete lr0[gd.id];
    fs.writeFileSync(lrFile, JSON.stringify(lr0));
    const on = await tag(gc.id, true, "needs fix");
    check("the needs fix tag goes on, and is the NEEDS FIX mark: yours", [on.ok, on.tags.includes("needs fix"), on.needsFix], [true, true, "you marked it needs fix"]);
    const stored = (() => { try { return JSON.parse(fs.readFileSync(tagsFile, "utf8").replace(/^﻿/, "")); } catch (e) { return {}; } })();
    check("kept as your word on the mark, not as a tag in tags.json", (stored[gc.id] || []).some((t) => t.toLowerCase() === "needs fix"), false);
    const c1 = await one(gc.id);
    check("the game wears NEEDS FIX, marked by you, with the tag", [c1.needsFix, c1.needsFixMine, (c1.tags || []).includes("needs fix")], ["you marked it needs fix", true, true]);
    const byFix = await api("api/library.php?grouped=0&versions=all&tag%5B%5D=" + encodeURIComponent("Needs Fix"));
    const fails = await api("api/library.php?grouped=0&versions=all&fails=1");
    check("the tag filter and the failed filter find the same game", [byFix.games.some((g) => g.id === gc.id), fails.games.some((g) => g.id === gc.id)], [true, true]);
    fs.writeFileSync(lrFile, JSON.stringify(Object.assign({}, lr0, { [gc.id]: { ok: true, at: later(60), why: "" } })));
    check("yours stays on through a good play after it", (await one(gc.id)).needsFix, "you marked it needs fix");
    await tag(gc.id, false, "needs fix");
    const c2 = await one(gc.id);
    check("taking the tag off takes the mark off", [c2.needsFix, (c2.tags || []).includes("needs fix")], [null, false]);
    // A failed launch: the same mark, so the same tag, and taking it off is the same word.
    fs.writeFileSync(lrFile, JSON.stringify(Object.assign({}, lr0, { [gd.id]: { ok: false, at: new Date().toISOString(), why: "exited with code 1 after 1s" } })));
    const d1 = await one(gd.id);
    check("a failed launch's NEEDS FIX carries the needs fix tag, not marked by you",
      [d1.needsFix, d1.needsFixMine, (d1.tags || []).includes("needs fix")], ["the last launch failed: exited with code 1 after 1s", false, true]);
    await tag(gd.id, false, "needs fix");                // in the same second, your word outranks the launch
    check("taking its tag off clears it", (await one(gd.id)).needsFix, null);
    fs.writeFileSync(lrFile, JSON.stringify(Object.assign({}, lr0, { [gd.id]: { ok: false, at: later(60), why: "exited with code 1 after 1s" } })));
    check("and a failure after that marks it again", (await one(gd.id)).needsFix, "the last launch failed: exited with code 1 after 1s");
  } finally {
    [fixFile, lrFile].forEach((f, i) => { if (keep[i] === null) { fs.rmSync(f, { force: true }); } else { fs.writeFileSync(f, keep[i]); } });
  }

  /* ---- the screen ------------------------------------------------------ */
  await b.goto();
  await b.openPlatform("Nintendo 64");
  const labels = `[...document.querySelectorAll(".ctx-item .ctx-label")].map(n => n.textContent)`;
  const ticked = (label) => `[...document.querySelectorAll(".ctx-item")].some(n => n.querySelector(".ctx-label").textContent === ${JSON.stringify(label)} && n.classList.contains("on"))`;
  await b.contextMenu("#view .witem.sel");
  // "Tags (1)..." on a game that already carries one of yours
  check("the right-click menu has Tags...", (await b.ev(labels)).some((t) => /^Tags( \(\d+\))?\.\.\.$/.test(t)));
  await b.menuItem(/^Tags/);
  await b.waitFor(`(document.querySelector(".ctx .ctx-title") || {}).textContent.startsWith("Tags: ")`, 3000);
  check("which opens this game's list, with New tag... at the bottom", (await b.ev(labels)).slice(-1)[0], "New tag...");
  await b.menuItem(/^New tag\.\.\.$/);
  await b.waitFor(`!document.getElementById("editor").hidden && (document.querySelector("#editor .panel-title") || {}).textContent === "NEW TAG"`, 3000);
  check("New tag... asks for a name, 24 characters at most", await b.ev(`(document.querySelector("#editor input") || {}).maxLength`), 24);
  await b.ev(`(i => { i.value = ${JSON.stringify(UI_TAG)}; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })(document.querySelector("#editor input"))`);
  await b.waitFor(`document.getElementById("editor").hidden && !!document.querySelector(".ctx")`, 6000);
  check("Enter puts it on the game and the list comes back with it selected", await b.ev(ticked(UI_TAG)));
  check("the server has it", ((await api("api/tags.php")).tags.find((t) => t.name === UI_TAG) || {}).count, 1);
  check("the info panel shows it, in its own colour", await b.waitFor(`[...document.querySelectorAll("#hero .pill.tag")].some(p => p.textContent === ${JSON.stringify(UI_TAG)})`, 4000));
  await b.menuItem(new RegExp("^" + UI_TAG + "$"));
  check("selecting it again takes it off, and the list stays up", await b.ev(`!!document.querySelector(".ctx")`) && !(await b.ev(ticked(UI_TAG))));
  await b.waitFor(`![...document.querySelectorAll("#hero .pill.tag")].some(p => p.textContent === ${JSON.stringify(UI_TAG)})`, 4000);
  await b.menuItem(new RegExp("^" + UI_TAG + "$"));
  await b.waitFor(ticked(UI_TAG), 3000);
  check("and on again", await b.ev(ticked(UI_TAG)));
  await sleep(300);                     // the save
  await b.key("Escape");
  await sleep(150);

  // Details says it in words.
  await b.key(" ");
  await b.waitFor(`!document.getElementById("details").hidden`, 4000);
  check("details lists the game's tags", await b.waitFor(`[...document.querySelectorAll("#details dt")].some(d => d.textContent === "tags" && d.nextElementSibling.textContent.includes(${JSON.stringify(UI_TAG)}))`, 4000));
  await b.key("Escape");
  await sleep(200);

  // Filter by offers it, and narrows to it: on a button of its own, or in the list of the rest where six others have more games.
  await b.openFilters();
  const pressed = await b.filterTag(UI_TAG);
  check("Filter by offers your tag with its count", pressed.count, "1");
  await b.waitFor(`document.querySelectorAll("#view .witem").length === 1`, 6000);
  check("selecting it narrows the console to the game that carries it", await b.ev(`document.querySelectorAll("#view .witem").length`), 1);
  check("the funnel is lit with it, and the window names it at the top",
        [await b.ev(`document.getElementById("btn-filter").classList.contains("on") && document.querySelector("#btn-filter .qf-n").textContent === "1"`),
         await b.ev(`document.querySelector("#editor .flt-inner .flt-now-w").textContent`)], [true, UI_TAG]);
  await b.ev(`document.querySelector("#editor .flt-inner .set-head button").click()`);
  await b.waitFor(`document.querySelectorAll("#view .witem").length > 1`, 6000);
  check("Clear all filters puts the console back", await b.ev(`document.querySelectorAll("#view .witem").length`) > 1);
  await b.key("Escape");
  await b.waitFor(`document.getElementById("editor").hidden`, 3000);

  // Take it off again, the way it went on.
  const now = await api("api/library.php?grouped=0&tag%5B%5D=" + encodeURIComponent(UI_TAG));
  for (const g of now.games) { await tag(g.id, false, UI_TAG); }
  check("and the test tag is gone again", !(await api("api/tags.php")).tags.some((t) => t.name === UI_TAG));
};
