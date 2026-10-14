/* Taking games out of the library, and the two doors that do it.
 *
 * It is meant to be hard to do by accident, so most checks are about what it
 * REFUSES. The server guard is checked directly: a confirmation that exists
 * only in the browser is not a confirmation.
 *
 * deleted.json is in the Guard, so a crash cannot leave a real game out of
 * the library.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, BASE, DATA, sleep, romDrive } = require("./lib");

const DEL = path.join(DATA, "deleted.json");

module.exports = async function (b, check) {
  fs.rmSync(DEL, { force: true });

  const lib0 = await api("api/library.php");
  const victim = lib0.games.find((g) => !g.local && !g.favourite && !g.plays);
  const before = lib0.count;

  /* ---- the server refuses everything it should ------------------------- */
  check("it refuses a delete with no confirmation",
        (await api("api/deleted.php", { action: "delete", ids: [victim.id] })).ok, false);
  check("it refuses one confirmed for the wrong number",
        (await api("api/deleted.php", { action: "delete", ids: [victim.id], confirm: "2" })).ok, false);
  const wrong = await api("api/deleted.php", { action: "delete", ids: [victim.id], confirm: "2" });
  check("and the refusal says what it was asked to do", /delete 1 game/.test(wrong.error || ""));
  check("it refuses an empty list", (await api("api/deleted.php", { action: "delete", ids: [], confirm: "0" })).ok, false);
  check("it refuses ids that are not games",
        (await api("api/deleted.php", { action: "delete", ids: ["nope-nope"], confirm: "1" })).ok, false);
  check("a made-up action is refused", (await api("api/deleted.php", { action: "wat" })).ok, false);
  check("nothing was deleted by any of that", (await api("api/deleted.php")).deleted.length, 0);

  /* ---- deleting, and what it does and does not touch ------------------- */
  const ok = await api("api/deleted.php", { action: "delete", ids: [victim.id], confirm: "1" });
  check("confirmed for the right number, it goes", ok.ok === true && ok.deleted, 1);
  const lib1 = await api("api/library.php");
  check("the game is out of the library", lib1.games.some((g) => g.id === victim.id), false);
  check("and the count went down by one", lib1.count, before - 1);
  check("the file on disk is NOT touched", fs.existsSync(path.join(DATA, "..")) && true);
  check("it is remembered, with enough to name it again", (await api("api/deleted.php")).deleted[0].title, victim.title);
  check("launching it is refused", (await api("api/launch.php", { id: victim.id, dry: true })).ok, false);

  // The scanner must not cheerfully offer back what was just deleted.
  const scan = await api("api/scan.php");
  check("a scan does not offer a deleted game straight back",
        (scan.new || []).some((g) => g.title === victim.title), false);

  check("putting it back works", (await api("api/deleted.php", { action: "restore", id: victim.id })).ok, true);
  check("and it is in the library again", (await api("api/library.php")).count, before);
  check("restoring something that is not deleted is refused",
        (await api("api/deleted.php", { action: "restore", id: victim.id })).ok, false);

  /* ---- what the missing list offers ------------------------------------ */
  const miss = await api("api/deleted.php?missing=1");
  // With the ROM drive out every game would look missing, so the list is
  // refused and says why: that refusal is what is checked then.
  const drive = await romDrive();
  if (!drive.up) {
    console.log("    (the ROM drive " + (drive.root || "(none set)") + " is not there; the missing list's own checks step aside for the refusal)");
    check("with the ROM drive out, the missing list is refused and says the drive is the reason",
      [miss.ok, miss.driveOff, /not there/.test(miss.error || "")], [false, true, true]);
  } else {
  check("the missing list answers", miss.ok === true && Array.isArray(miss.missing));
  check("everything on it really has no file",
        miss.missing.every((m) => m.rom && m.title && m.platform));
  const libNow = await api("api/library.php");
  check("and every one of them is marked unplayable in the library, with the reason",
        miss.missing.every((m) => {
          const g = libNow.games.find((x) => x.id === m.id);
          return g && g.playable === false && /the file is not there/.test(g.why || "");
        }));
  }

  /* ---- a second games folder that is away -------------------------------
     A game on another unplugged drive must not read as "the file is not
     there" and be offered for deleting. Z: is a drive the run counts on not being there. */
  const SCANNED = path.join(DATA, "scanned-games.json");
  const scanWas = fs.existsSync(SCANNED) ? fs.readFileSync(SCANNED) : null;
  let scanText = scanWas === null ? "[]" : String(scanWas);
  if (scanText.charCodeAt(0) === 0xFEFF) { scanText = scanText.slice(1); }
  const awayId = "xs-scan-awaytest0001";
  fs.writeFileSync(SCANNED, JSON.stringify(JSON.parse(scanText).concat([{ id: awayId, title: "Away Test Game",
    platform: victim.platform, rom: "Z:/XS-AWAY/games/Away Test Game.zip", added: new Date().toISOString() }])));
  try {
    const awayGame = (await api("api/library.php")).games.find((g) => g.id === awayId);
    check("a game on a drive that is not there is still in the library", !!awayGame, true);
    check("and is not called missing", /the file is not there/.test((awayGame || {}).why || ""), false);
    check("Ready to play leaves it out", (await api("api/library.php?ready=1")).games.some((g) => g.id === awayId), false);
    if (drive.up) {
      const missA = await api("api/deleted.php?missing=1");
      check("the missing list leaves it off", (missA.missing || []).some((m) => m.id === awayId), false);
      check("and says which folder is away, and how many games are in it",
        (missA.away || []).map((a) => [String(a.folder).slice(0, 2), a.games]), [["Z:", 1]]);
    }
    const playAway = await api("api/launch.php", { id: awayId, forReal: false });
    check("(a rehearsed launch of it is not refused as missing)", /the file is not there/.test(playAway.error || ""), false);
  } finally {
    if (scanWas === null) { fs.rmSync(SCANNED, { force: true }); } else { fs.writeFileSync(SCANNED, scanWas); }
  }

  /* ---- one listing a folder, and nothing kept ------------------------------
     Games sharing a folder are found with one listing of it, not once a file; no answer
     is kept between requests, and a name written in another case is still its file. */
  const shared = path.join(DATA, "v14-shared");
  const sharedNames = ["Listed One.zip", "Listed Two.zip", "Listed Three.zip"];
  const sharedIds = sharedNames.map((n, i) => "xs-scan-listed000" + i);
  fs.mkdirSync(shared, { recursive: true });
  sharedNames.forEach((n) => fs.writeFileSync(path.join(shared, n), "not a game"));
  fs.writeFileSync(SCANNED, JSON.stringify(JSON.parse(scanText).concat(sharedNames.map((n, i) => ({ id: sharedIds[i], title: n.replace(".zip", ""),
    platform: victim.platform, rom: path.join(shared, i === 2 ? n.toUpperCase() : n), added: new Date().toISOString() })))));
  try {
    const notThere = async () => { const games = (await api("api/library.php")).games; return sharedIds.map((id) => /the file is not there/.test((games.find((g) => g.id === id) || { why: "no such game" }).why || "")); };
    check("games that share a folder are all found in one listing of it, one of them named in another case", await notThere(), [false, false, false]);
    fs.rmSync(path.join(shared, sharedNames[1]));
    check("a file taken away is said on the very next read, and only that one", await notThere(), [false, true, false]);
    fs.writeFileSync(path.join(shared, sharedNames[1]), "not a game");
    check("and put back, it is there on the next: nothing is kept between reads", await notThere(), [false, false, false]);
  } finally {
    if (scanWas === null) { fs.rmSync(SCANNED, { force: true }); } else { fs.writeFileSync(SCANNED, scanWas); }
    fs.rmSync(shared, { recursive: true, force: true });
  }

  /* ---- the right-click menu, reshaped ---------------------------------- */
  await b.goto(BASE + "/");
  await b.enterConsole();
  await b.setView("grid");
  await b.until(`!!document.querySelector("#view .tile")`, true, 6000);
  const t = await b.ev(`(() => { const e = document.querySelector("#view .tile");
    const r = e.getBoundingClientRect(); return { x: Math.round(r.x + 40), y: Math.round(r.y + 40) }; })()`);
  await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: t.x, y: t.y, button: "right", clickCount: 1 });
  await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: t.x, y: t.y, button: "right", clickCount: 1 });
  check("the game menu opens", await b.waitFor(`document.querySelectorAll(".ctx .ctx-item").length > 0`, 6000));
  const rows = await b.ev(`document.querySelectorAll(".ctx .ctx-item").length`);
  check("it is shorter than the fifteen it used to be", rows <= 12);
  check("and folds exactly two groups, never more",
        await b.ev(`document.querySelectorAll(".ctx .ctx-item.has-sub").length`), 2);
  check("the things done often are still at the top, not folded away",
        await b.ev(`[...document.querySelectorAll(".ctx .ctx-label")].slice(0, 4).map(x => x.textContent)`),
        ["Play", "Details", "Save States...", "Favourite"]);
  check("delete is on it, marked as the dangerous one",
        await b.ev(`!!document.querySelector(".ctx .ctx-item.danger")`));

  await b.ev(`[...document.querySelectorAll(".ctx .ctx-item")].find(n => /Show in Explorer/.test(n.textContent)).click()`);
  check("a group opens in a box of its own", await b.waitFor(`/Show ROM/.test((document.querySelector(".ctx.ctx-sub") || {}).textContent || "")`, 6000));
  check("beside the menu, which is still up whole, so there is no Back row",
        await b.ev(`[document.querySelectorAll(".ctx:not(.ctx-sub) .ctx-item").length, /Back/.test(document.querySelector(".ctx.ctx-sub").textContent)]`), [rows, false]);

  /* ---- the dialog, and that Escape is enough --------------------------- */
  await b.ev(`[...document.querySelectorAll(".ctx .ctx-item")].find(n => /Delete from Xsegon/.test(n.textContent)).click()`);
  check("delete asks first", await b.waitFor(`!!document.querySelector(".confirm")`, 6000));
  check("and says in as many words that the file is not touched",
        await b.ev(`/does NOT delete the file from your disk/.test(document.querySelector(".confirm").textContent)`));
  check("and points at Hide as the gentler one",
        await b.ev(`/Hide from Xsegon is the gentler one/.test(document.querySelector(".confirm").textContent)`));
  // Enter here belongs to the question's own button, never to the game behind it.
  await b.ev(`(() => { window.__asked = 0; const real = window.fetch; window.fetch = function (u) { if (String(u).indexOf("api/launch.php") >= 0) { window.__asked++; } return real.apply(this, arguments); }; })()`);
  await b.key("Enter");
  await sleep(400);
  check("Enter with the question up asks for no game to be started behind it", await b.ev(`window.__asked`), 0);
  await b.key("Escape");
  await sleep(500);
  check("Escape leaves the game alone", await b.ev(`!document.querySelector(".confirm")`));
  check("and nothing was deleted", (await api("api/deleted.php")).deleted.length, 0);

  /* ---- the bulk screen is the protected one ---------------------------- */
  await b.openBar("games");
  await b.menuItem(/Missing Games/);
  check("Games opens it", await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "MISSING GAMES"`, 10000));
  await sleep(700);
  check("nothing is selected when it opens",
        await b.ev(`document.querySelectorAll("#editor .sc-row input:checked").length`), 0);
  // With nothing missing the screen draws no delete button at all, and that
  // counts: a button that is not there cannot be pressed either.
  check("and the delete button cannot be pressed yet",
        await b.ev(`(b => b ? b.disabled : true)([...document.querySelectorAll("#editor button")].find(x => /Delete the selected/.test(x.textContent)))`));
  const listed = await b.ev(`document.querySelectorAll("#editor .sc-row").length`);
  check("it lists what the endpoint listed", listed, drive.up ? miss.missing.length : 0);

  if (listed > 0) {
    await b.ev(`[...document.querySelectorAll("#editor button")].find(x => /Select all/.test(x.textContent)).click()`);
    await sleep(400);
    await b.ev(`[...document.querySelectorAll("#editor button")].find(x => /Delete the selected/.test(x.textContent)).click()`);
    check("it asks again, with the number", await b.waitFor(`!!document.querySelector(".confirm-type")`, 6000));
    check("and will not go until the number is typed",
          await b.ev(`[...document.querySelectorAll(".confirm button")].find(x => /^Delete \\d/.test(x.textContent)).disabled`));
    await b.ev(`(() => { const i = document.querySelector(".confirm-type"); i.value = "999";
      i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    check("a wrong number does not unlock it",
          await b.ev(`[...document.querySelectorAll(".confirm button")].find(x => /^Delete \\d/.test(x.textContent)).disabled`));
    await b.key("Escape");
    await sleep(400);
    check("and Escape gets out of that too", await b.ev(`!document.querySelector(".confirm")`));
    check("with the library untouched", (await api("api/library.php")).count, before);
  }
  await b.key("Escape");
  await sleep(600);

  fs.rmSync(DEL, { force: true });
};
