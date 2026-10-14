/* The cheat lists, for a RetroArch that came without them (includes\cheatlists.php),
 * the count a game's details show of them, and the one-time message that games
 * can have videos and cheats (includes\tips.php).
 *
 * Nothing reaches libretro: the test server is pointed at a stand-in .zip the
 * sandbox makes (XSEGON_CHEATLISTS, tests\sandbox.js). The library is the
 * test's own: one stand-in game on a stand-in RetroArch with no cheat lists,
 * since a RetroArch that has them is offered nothing.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, DATA, Guard, sleep } = require("./lib");

const FX = path.join(DATA, "fixtures", "cl");
const RA = path.join(FX, "ra");
const LISTS = path.join(DATA, "emulators", "cheat-lists");
const SETUP = path.join(DATA, "setup.json");
const GAME = { id: "xs-scan-cltest1", title: "Stand-in Quest", platform: "Nintendo 64",
               rom: path.join(FX, "roms", "Stand-in Quest (USA).z64"), added: new Date().toISOString() };

module.exports = async function (b, check) {
  const kept = new Guard(["scanned-games.json", "emulators.json", "setup.json", "messages.json", "library-seen.json", "cheatlists-job.json", "cheats.json"]);
  const setupNow = () => { try { return JSON.parse(fs.readFileSync(SETUP, "utf8").replace(/^\uFEFF/, "")); } catch (e) { return {}; } };
  // The one-time message not said yet, as on a PC that has never had it.
  const untold = (more) => { const s = setupNow(); delete s.tipsTold; delete s.run; fs.writeFileSync(SETUP, JSON.stringify(Object.assign(s, more || {}))); };
  const tips = async () => ((await api("api/news.php")).messages || []).filter((m) => m.kind === "tip");
  const gameNow = async () => (await api("api/game.php?id=" + GAME.id)).game || {};
  const listsNow = () => api("api/cheats.php?lists=1");

  try {
    fs.rmSync(FX, { recursive: true, force: true });
    for (const d of ["roms", path.join("ra", "info"), path.join("ra", "cores")]) { fs.mkdirSync(path.join(FX, d), { recursive: true }); }
    fs.writeFileSync(GAME.rom, "not a game, a stand-in");
    fs.writeFileSync(path.join(RA, "retroarch.exe"), "not a real RetroArch: a stand-in");
    fs.writeFileSync(path.join(RA, "retroarch.cfg"), "");
    fs.writeFileSync(path.join(RA, "cores", "mupen64plus_next_libretro.dll"), "a stand-in core");
    fs.writeFileSync(path.join(RA, "info", "mupen64plus_next_libretro.info"), 'corename = "Mupen64Plus-Next"\r\ndatabase = "Nintendo - Nintendo 64"\r\n');
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), JSON.stringify([GAME]));
    fs.writeFileSync(path.join(DATA, "emulators.json"), JSON.stringify({ made: new Date().toISOString(), from: "Xsegon",
      programs: { "retroarch-cltest": { name: "RetroArch", exe: path.join(RA, "retroarch.exe"), args: "", noQuotes: false } },
      platforms: { "nintendo 64": { options: [{ program: "retroarch-cltest", emulator: "RetroArch", emulatorId: "xsegon-retroarch-cltest",
        args: '-L "cores\\mupen64plus_next_libretro.dll" -f', core: "mupen64plus_next", load: "cores\\mupen64plus_next_libretro.dll", default: true }] } } }));
    fs.rmSync(LISTS, { recursive: true, force: true });
    fs.rmSync(path.join(DATA, "cheatlists-job.json"), { force: true });

    /* ---- no lists on the PC: the reason, and what a fetch would bring ----- */
    const none = await api("api/cheats.php?id=" + GAME.id);
    check("a RetroArch game on a PC with no cheat lists says so, and carries what fetching them would bring",
      [none.ok, (none.files || []).length, /^The cheat lists are not on this PC yet/.test(none.why || ""),
       /cheats\.zip$/.test(((none.lists || {}).get || {}).url || ""), ((none.lists || {}).get || {}).dest],
      [true, 0, true, true, LISTS]);
    const st = await listsNow();
    check("asked of the lists alone: not here, none of Xsegon's own, nothing at work", [st.ok, st.have, st.own, st.job], [true, false, false, null]);
    check("and its details count no cheats to choose from", (await gameNow()).cheatsThere, 0);

    /* ---- the one-time message, with the lists not here -------------------- */
    fs.writeFileSync(path.join(DATA, "messages.json"), "[]");
    untold({ run: { started: Math.floor(Date.now() / 1000), by: "a test" } });
    await api("api/news.php?check=1");
    check("while a setting-up run is at work the one-time message waits for its end", [(await tips()).length, !!setupNow().tipsTold], [0, false]);
    untold();
    await api("api/news.php?check=1");
    const told = await tips();
    check("with the games in, one message says they can have cheats and that the lists are a download, with a button for it",
      [told.length, /cheats/.test((told[0] || {}).title || ""),
       ((told[0] || {}).items || []).some((l) => /came without its cheat lists, which are a 35 MB download/.test(l)),
       ((told[0] || {}).opens || []).includes("cheatlists"), (told[0] || {}).read, !!setupNow().tipsTold],
      [1, true, true, true, false, true]);
    await api("api/news.php?check=1");
    check("and it is said once", (await tips()).length, 1);

    /* ---- the fetch, from the stand-in .zip -------------------------------- */
    const start = await api("api/cheats.php", { lists: "get" });
    check("the fetch starts", [start.ok, start.started], [true, true]);
    let job = null;
    for (const end = Date.now() + 60000; Date.now() < end;) { job = (await listsNow()).job; if (job && job.state !== "running") { break; } await sleep(150); }
    check("and ends saying what is in: two consoles' lists, the .zip's other files left out",
      [(job || {}).state, (job || {}).said],
      ["done", "The cheat lists are in: 2 cheat files for 2 consoles. A game that plays on RetroArch has them on the Cheats tab of its details."]);
    check("they are in Xsegon's own folder, a console a folder, with nothing left beside it",
      [fs.existsSync(LISTS) ? fs.readdirSync(LISTS).sort() : null, fs.existsSync(path.join(LISTS, "Nintendo - Nintendo 64", "Stand-in Quest (USA).cht")),
       fs.readdirSync(path.join(DATA, "emulators")).filter((f) => /^cheat-lists\./.test(f))],
      [["Nintendo - Nintendo 64", "Sega - Mega Drive - Genesis"], true, []]);
    check("nothing was written into the RetroArch itself", fs.existsSync(path.join(RA, "cheats")), false);
    const bar = ((await api("api/jobs.php")).jobs || []).find((j) => j.key === "cheatlists") || {};
    check("the job is one of the corner's, said as done with its last words", [bar.name, bar.state, /^The cheat lists are in/.test(bar.said || "")], ["Cheat lists", "done", true]);

    /* ---- and now the game has its cheats ----------------------------------- */
    const now = await api("api/cheats.php?id=" + GAME.id);
    check("the game's cheats are found in them, with no offer left",
      [(now.files || []).map((f) => f.name + ":" + f.cheats), now.lists, now.why], [["Stand-in Quest (USA):2"], null, null]);
    check("its details say how many there are to choose from", (await gameNow()).cheatsThere, 2);
    const picked = await api("api/cheats.php", { id: GAME.id, file: ((now.files || [])[0] || {}).file, on: [{ i: 1, desc: "Moon Jump" }] });
    const withOne = await gameNow();
    check("with one selected, the one on is counted and the count to choose from gives way", [picked.ok, withOne.cheats, withOne.cheatsThere], [true, 1, 0]);
    await api("api/cheats.php", { id: GAME.id, clear: true });
    const again = await api("api/cheats.php", { lists: "get" });
    check("a second fetch is refused in words: they are here", [again.ok, /on this PC already/.test(again.error || "")], [false, true]);
    const here = await listsNow();
    check("asked of the lists alone: here, and Xsegon's own", [here.have, here.own], [true, true]);

    /* ---- the one-time message, with the lists here -------------------------- */
    fs.writeFileSync(path.join(DATA, "messages.json"), "[]");
    untold();
    await api("api/news.php?check=1");
    const told2 = await tips();
    check("with the lists here the message says where a game's cheats are, and offers no download",
      [told2.length, ((told2[0] || {}).items || []).some((l) => /has them on the Cheats tab of its details/.test(l)), ((told2[0] || {}).opens || []).includes("cheatlists")],
      [1, true, false]);

    /* ---- the Cheats tab: the offer, the asking window, and the cheats after --- */
    if (b) {
      fs.rmSync(LISTS, { recursive: true, force: true });
      fs.rmSync(path.join(DATA, "cheatlists-job.json"), { force: true });
      await b.goto();
      await b.setView("list");
      await b.openPlatform("Nintendo 64");
      const there = await b.ev(`import("/js/state.js").then((S) => { const i = S.games.findIndex((g) => g.id === ${JSON.stringify(GAME.id)}); if (i >= 0) { S.setSel(i); } return i >= 0; })`);
      await b.key("i");
      check("(the stand-in game's details open)", [there, await b.until(`!document.getElementById("details").hidden && !!document.querySelector("#details .dtabs")`, true, 8000)], [true, true]);
      await b.ev(`[...document.querySelectorAll("#details .dtabs .dtab")].find((x) => /^Cheats/.test(x.textContent)).click()`);
      const offer = `document.querySelector("#details .dtab-pane .ch-list .cr-row")`;
      const offered = ["The cheat lists are not on this PC yet: the RetroArch here came without them.", "Get the cheat lists...", "about 35 MB, from libretro"];
      check("its Cheats tab says the lists are not here, and offers to get them",
        await b.until(`(r => !!r && [document.querySelector("#details .dtab-pane .cr-none").textContent.trim(), r.querySelector(".cr-name").textContent, r.querySelector(".cr-tag").textContent])(${offer})`, offered, 8000),
        offered);
      await b.ev(`${offer}.click()`);
      const win = `document.querySelector(".setup-confirm .confirm")`;
      const asked = ["Get the cheat lists?", true, true, true, "Not now|Download"];
      check("a press asks first, in a window that says what, how big, from where and into which folder",
        await b.until(`(w => !!w && [w.querySelector("h2").textContent, /about 35 MB to download, about 230 MB on the disk/.test(w.textContent), /From: \\S+cheats\\.zip/.test(w.textContent),
          /Into: \\S.*emulators.cheat-lists/.test(w.textContent), [...w.querySelectorAll(".confirm-bar button")].map(x => x.textContent).join("|")])(${win})`, asked, 8000),
        asked);
      await b.ev(`[...${win}.querySelectorAll(".confirm-bar button")].find(x => x.textContent === "Download").click()`);
      check("Download fetches them, and the tab then has the game's cheats to select",
        await b.until(`[...document.querySelectorAll("#details .dtab-pane .ch-list .cr-row .cr-name")].map(x => x.textContent).includes("Moon Jump")`, true, 30000), true);
      check("no script errors through any of it", await b.ev(`(window.__errs || []).length`), 0);
      await b.key("Escape");
    }
  } finally {
    fs.rmSync(LISTS, { recursive: true, force: true });
    fs.rmSync(path.join(DATA, "cheatlists-stop"), { force: true });
    fs.rmSync(FX, { recursive: true, force: true });
    kept.restore();
  }
};
