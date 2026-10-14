/*  Emulators > Add an emulator (includes\emuadd.php, api\emulators.php,
 *  js\emuadd.js): a program of your own given to one console or several.
 *
 *  The programs here are stand-ins, empty files with an emulator's name, in
 *  the run's own copy of data: nothing is started (every launch is dry) and
 *  the Windows file window is answered by data\pick-answer.txt. */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, BASE, DATA, Guard, apiUntil } = require("./lib");

module.exports = async function (b, check) {
  if (!fs.existsSync(path.join(DATA, "fixtures"))) {
    check("emuadd: runs only on the test server's own copy", true, true);
    return;
  }
  const fx = path.join(DATA, "fixtures", "emus");
  const stand = (...p) => { const f = path.join(fx, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, "MZ"); return f; };
  const duck = stand("DuckStation", "duckstation-qt-x64-ReleaseLTCG.exe");
  const odd = stand("Odd", "MyOddEmu.exe");
  const ryu = stand("Ryujinx", "Ryujinx.exe");
  const note = stand("Odd", "readme.txt");
  const answer = path.join(DATA, "pick-answer.txt");
  const tablePath = path.join(DATA, "emulators.json");
  const tableNow = () => JSON.parse(fs.readFileSync(tablePath, "utf8"));
  const post = (body) => api("api/emulators.php", body);
  const kept = new Guard(["emulators.json", "scanned-games.json", "settings.json", "emu-choice.json"]);
  const first = async (platform) => ((await api("api/library.php?platform=" + encodeURIComponent(platform))).games || [])[0];
  const PSX = "Sony Playstation";

  try {
    const was = tableNow();
    const psx = await first(PSX);
    check("a PlayStation game is there to start", !!psx);
    const before = await api("api/launch.php", { id: psx.id, dry: true });

    /* ---- what Xsegon says about a program ----------------------------- */
    let look = await post({ action: "look", exe: duck });
    const row = (r, name) => (r.consoles || []).find((c) => c.name === name) || {};
    check("a known emulator is named from its file, with its usual options",
      [look.ok, look.known, look.name, look.args, look.retroarch], [true, true, "DuckStation", "-batch -fullscreen", false]);
    check("its console is selected and first, and says what starts it now",
      [look.consoles[0].name, look.consoles[0].on, look.consoles[0].mine, /RetroArch/.test(look.consoles[0].now || "")], [PSX, true, false, true]);
    check("and nothing else is selected for it", look.consoles.filter((c) => c.on).length, 1);
    check("each console says how many games it has and the folder the scan reads as it",
      [row(look, PSX).games > 0, row(look, PSX).folder, row(look, "Nintendo Switch").folder, row(look, "Arcade").folder], [true, "psx", "switch", "arcade"]);

    look = await post({ action: "look", exe: odd });
    check("a program Xsegon does not know is named as its file is written, with nothing filled in",
      [look.known, look.name, look.args, look.consoles.filter((c) => c.on).length], [false, "MyOddEmu", "", 0]);
    const ra = Object.values(was.programs).find((p) => /retroarch/i.test(p.exe));
    look = await post({ action: "look", exe: ra.exe });
    check("a program already in the table is said to be", typeof look.same, "string");
    check("a file that is not there is refused", (await post({ action: "look", exe: path.join(fx, "nope.exe") })).ok, false);

    /* ---- what adding refuses ------------------------------------------ */
    const refuse = async (body) => { const r = await post(Object.assign({ action: "add", name: "Odd", args: "", consoles: ["Nintendo 64"], exe: odd }, body)); return r.ok === false ? r.error : "added"; };
    check("no console selected is refused", /at least one console/.test(await refuse({ consoles: [] })), true);
    check("a console Xsegon has never heard of is refused", /no console called/.test(await refuse({ consoles: ["Xsfix Console"] })), true);
    check("options Windows would read as commands are refused", /& \| < > \^/.test(await refuse({ args: "-x & del" })), true);
    check("a file that is not a program is refused", /not a program/.test(await refuse({ exe: note })), true);
    check("RetroArch is sent to Getting started", /Getting started/.test(await refuse({ exe: ra.exe })), true);
    check("and none of that touched the table", tableNow(), was);
    const foreign = await fetch(BASE + "/api/emulators.php", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
      body: JSON.stringify({ action: "add", exe: odd, name: "Odd", args: "", consoles: ["Nintendo 64"] }),
    });
    check("a foreign origin cannot add one", foreign.status === 403 || (await foreign.json()).ok === false);

    /* ---- adding one, and what a launch then does ----------------------- */
    const add = await post({ action: "add", exe: duck, name: "DuckStation", args: "-batch -fullscreen", consoles: [PSX] });
    check("an emulator is added under a short name of its own", [add.ok, add.new, add.program, add.name], [true, true, "duckstation", "DuckStation"]);
    check("the answer says what it took over from", [add.rows[0].name, add.rows[0].games > 0, /RetroArch/.test(add.rows[0].took || "")], [PSX, true, true]);
    const entry = tableNow().platforms["sony playstation"];
    const mineOpt = entry.options.find((o) => o.program === "duckstation");
    check("it is the one the console starts in, and the only one marked so",
      [mineOpt.default, mineOpt.own, entry.options.filter((o) => o.default).length], [true, true, 1]);
    check("RetroArch's cores stay in the table beside it", entry.options.length, was.platforms["sony playstation"].options.length + 1);
    const after = await api("api/launch.php", { id: psx.id, dry: true });
    check("the very next launch starts in it, options first, then the game",
      [after.exe, after.via, after.args.startsWith('-batch -fullscreen "')], [duck, "DuckStation", true]);
    check("as a program of its own: nothing of RetroArch's is handed to it",
      [/-Kind 'other'/.test(after.command), (after.append || []).length, /appendconfig/.test(after.args), after.failHint], [true, 0, false, null]);
    const cores = await api("api/cores.php?id=" + encodeURIComponent(psx.id));
    check("Set Core offers nothing for it and says what it runs on", [cores.cores.length, /DuckStation/.test(cores.why || "")], [0, true]);
    let list = await api("api/emulators.php");
    const mineRow = list.programs.find((p) => p.key === "duckstation");
    check("the Emulators list says which console starts in it", [mineRow.kind, mineRow.plays, mineRow.there], ["other", [PSX], true]);
    check("and RetroArch is marked as RetroArch", list.programs.find((p) => /retroarch/i.test(p.exe)).kind, "retroarch");

    /* ---- Set Emulator: one game in another of its console's emulators --- */
    const emuset = (body) => api("api/emuset.php", body);
    const offered = () => api("api/emuset.php?id=" + encodeURIComponent(psx.id));
    const dryExe = async (id) => (await api("api/launch.php", { id: id, dry: true })).exe;
    const psxWas = [...new Set(was.platforms["sony playstation"].options.map((o) => o.program))];
    const backKey = Object.keys(was.programs).find((k) => was.programs[k].exe === before.exe) || psxWas[0];
    const psx2 = ((await api("api/library.php?platform=" + encodeURIComponent(PSX))).games || []).find((g) => g.id !== psx.id);
    let offer = await offered();
    check("Set Emulator offers each of the console's emulators once, and marks the one in use",
      [offer.rows.map((r) => r.program).sort(), offer.usual, offer.chosen, offer.why, offer.rows.every((r) => r.there)],
      [psxWas.concat(["duckstation"]).sort(), "duckstation", null, null, true]);
    check("an emulator the console does not have is refused", (await emuset({ id: psx.id, program: "xs-no-such" })).ok, false);
    const mineSet = await emuset({ id: psx.id, program: backKey });
    check("one game is given another of them", [mineSet.ok, mineSet.chosen], [true, backKey]);
    const own = await api("api/launch.php", { id: psx.id, dry: true });
    check("and starts in it, the way it did before the console changed", [own.exe, own.args, /your choice/.test(own.via)], [before.exe, before.args, true]);
    if (psx2) { check("the console's other games stay where they were", await dryExe(psx2.id), duck); }
    check("the window's answer says which one this game has", (await offered()).chosen, backKey);
    await emuset({ id: psx.id, clear: true });
    check("taken back, it starts in the console's emulator again", await dryExe(psx.id), duck);
    const flip = await emuset({ id: psx.id, program: backKey, every: true });
    const flipped = tableNow().platforms["sony playstation"];
    check("the emulator a console's games start in can be changed among those it has",
      [flip.ok, flip.was, flipped.options.filter((o) => o.default).length, flipped.options.find((o) => o.default).program, flipped.options.some((o) => o.program === "duckstation")],
      [true, "DuckStation", 1, backKey, true]);
    check("and every game of it follows", await dryExe((psx2 || psx).id), before.exe);
    await emuset({ id: psx.id, program: "duckstation", every: true });
    check("changed back, the table is as it was after the adding", tableNow().platforms["sony playstation"], entry);

    look = await post({ action: "look", exe: duck });
    check("the same file chosen again is the one already there", look.same, "duckstation");
    look = await post({ action: "look", program: "duckstation" });
    check("looked at for changing, it shows its own name, options and console",
      [look.key, look.name, look.args, row(look, PSX).on, row(look, PSX).mine, row(look, PSX).now], ["duckstation", "DuckStation", "-batch -fullscreen", true, true, null]);

    /* ---- changing it --------------------------------------------------- */
    // Options that hold "-l " are RetroArch's sign anywhere else in the table.
    let change = await post({ action: "change", program: "duckstation", name: "Duck", args: "-l 0 -batch", consoles: [PSX] });
    check("its name and options can be changed", [change.ok, change.new, change.name], [true, false, "Duck"]);
    const relaunch = await api("api/launch.php", { id: psx.id, dry: true });
    check("the launch carries the new options, still as a program of its own",
      [relaunch.args.startsWith('-l 0 -batch "'), relaunch.via, /-Kind 'other'/.test(relaunch.command)], [true, "Duck", true]);
    change = await post({ action: "change", program: "duckstation", name: "Duck", args: "", consoles: ["Sony PSP"] });
    check("a console deselected is handed back", [change.ok, change.left, change.rows.map((r) => r.name)], [true, [PSX], ["Sony PSP"]]);
    const handed = await api("api/launch.php", { id: psx.id, dry: true });
    check("to exactly what started it before", [handed.exe, handed.args, handed.via], [before.exe, before.args, before.via]);

    /* ---- taking it out -------------------------------------------------- */
    const gone = await post({ action: "remove", program: "duckstation" });
    check("an emulator can be removed", [gone.ok, gone.name], [true, "Duck"]);
    const now = tableNow();
    check("and the table is as it was before it came", [now.programs, now.platforms], [was.programs, was.platforms]);
    check("RetroArch is not removed here", (await post({ action: "remove", program: Object.keys(was.programs).find((k) => /retroarch/i.test(was.programs[k].exe)) })).ok, false);
    check("nor one that is not there", (await post({ action: "remove", program: "duckstation" })).ok, false);
    fs.writeFileSync(path.join(DATA, "emu-choice.json"), JSON.stringify({ [psx.id]: "duckstation" }));
    check("a game's choice of an emulator since removed is not in force", [(await offered()).chosen, await dryExe(psx.id)], [null, before.exe]);
    fs.rmSync(path.join(DATA, "emu-choice.json"), { force: true });

    /* ---- a second copy of one already here ------------------------------ */
    const dolphinKey = Object.keys(was.programs).find((k) => /dolphin/i.test(path.basename(was.programs[k].exe)));
    if (dolphinKey) {
      const dolphin2 = stand("Dolphin new", path.basename(was.programs[dolphinKey].exe));
      look = await post({ action: "look", exe: dolphin2 });
      check("a second copy of an emulator already here is noticed, and named apart",
        [look.same, look.alike && look.alike.key, look.name], [null, dolphinKey, was.programs[dolphinKey].name + " 2"]);
      const second = await post({ action: "add", exe: dolphin2, name: look.name, args: look.args, consoles: ["Nintendo Wii"] });
      check("kept as a second one, it gets a key of its own", [second.ok, second.program !== dolphinKey, !!tableNow().programs[dolphinKey]], [true, true, true]);
      await post({ action: "remove", program: second.program });
      check("and removing it hands the console back to the first", tableNow().platforms["nintendo wii"], was.platforms["nintendo wii"]);
    }

    /* ---- a console only an emulator of your own plays ------------------ */
    const gamesDir = path.join(DATA, "fixtures", "emu-games");
    const nsp = path.join(gamesDir, "switch", "Xsemu Odyssey (USA).nsp");
    fs.mkdirSync(path.dirname(nsp), { recursive: true });
    fs.writeFileSync(nsp, "x");
    fs.writeFileSync(path.join(gamesDir, "Xsemu Loose (USA).3ds"), "x");
    const romRootWas = (await api("api/settings.php")).settings.paths.romRoot;
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), "[]");
    // A Switch emulator of the person's own in the copied table would answer for it.
    const bareTable = tableNow();
    delete bareTable.platforms["nintendo switch"];
    fs.writeFileSync(tablePath, JSON.stringify(bareTable));
    try {
      await api("api/settings.php", { paths: { romRoot: gamesDir } });
      const walk = await api("api/scan.php");
      check("the scan reads a switch folder, and a 3DS game by its ending wherever it is",
        walk.new.map((g) => g.platform + "|" + g.title).sort(), ["Nintendo 3DS|Xsemu Loose", "Nintendo Switch|Xsemu Odyssey"]);
      check("and says neither console has an emulator yet", walk.noEmulator.slice().sort(), ["Nintendo 3DS", "Nintendo Switch"]);
      const odyssey = walk.new.find((g) => g.platform === "Nintendo Switch");
      fs.writeFileSync(path.join(DATA, "scanned-games.json"),
        JSON.stringify([{ id: odyssey.id, title: odyssey.title, platform: odyssey.platform, rom: odyssey.rom, added: new Date().toISOString() }]));
      let mine = await first("Nintendo Switch");
      check("its game lists as unplayable, and says how to give it an emulator",
        [mine.playable, /Add an emulator/.test(mine.why || "")], [false, true]);
      list = await api("api/emulators.php");
      check("the Emulators list names the console with games and no emulator",
        (list.without || []).filter((c) => c.name === "Nintendo Switch").map((c) => c.games), [1]);

      look = await post({ action: "look", exe: ryu });
      check("Ryujinx is known, with the Switch selected and nothing starting it yet",
        [look.known, look.name, row(look, "Nintendo Switch").on, row(look, "Nintendo Switch").now], [true, "Ryujinx", true, null]);
      const sw = await post({ action: "add", exe: ryu, name: look.name, args: look.args, consoles: ["Nintendo Switch"] });
      check("added, it took over from nothing", [sw.ok, sw.rows[0].took, sw.rows[0].games, sw.rows[0].folder], [true, null, 1, "switch"]);
      mine = await first("Nintendo Switch");
      check("and the game is playable at once, with no scan run again", mine.playable, true);
      const play = await api("api/launch.php", { id: mine.id, dry: true });
      check("its launch is the program and the game's file", [play.exe, play.args], [ryu, '"' + nsp + '"']);
      check("the scan no longer calls the Switch a console with no emulator", (await api("api/scan.php")).noEmulator.includes("Nintendo Switch"), false);
      const bare = await post({ action: "remove", program: sw.program });
      check("removing the only emulator a console had says the console is left with none", bare.bare, ["Nintendo Switch"]);
      check("and its game is unplayable again", (await first("Nintendo Switch")).playable, false);
    } finally {
      await api("api/settings.php", { paths: { romRoot: romRootWas } });
      kept.restore();
    }
    check("the table is back as it was", [tableNow().programs, tableNow().platforms], [was.programs, was.platforms]);

    /* ---- the screen ----------------------------------------------------- */
    const title = `(document.querySelector("#editor .panel-title") || {}).textContent`;
    const press = (re) => b.ev(`(() => { const x = [...document.querySelectorAll("#editor button")].find(n => ${re}.test(n.textContent)); if (!x) { return false; } x.click(); return true; })()`);
    await b.goto();
    const viewWas = await b.ev(`import("/js/state.js").then(m => m.view)`);
    await b.setView("list");
    await b.openBar("emulators");
    await b.menuItem(/Add an emulator/);
    check("Emulators > Add an emulator opens the screen", await b.until(title, "ADD AN EMULATOR", 6000), "ADD AN EMULATOR");
    check("which starts with one thing to do: choose the program",
      await b.ev(`[[...document.querySelectorAll("#editor button.primary")].map(n => n.textContent), !!document.querySelector("#editor .ea-consoles")]`),
      [["Choose the program..."], false]);

    fs.writeFileSync(answer, duck);
    await press("/Choose the program/");
    check("choosing a known program fills in the rest", await b.until(`!!document.querySelector("#editor .ea-consoles")`, true, 8000), true);
    check("it says which emulator this is", await b.ev(`document.querySelector("#editor .ea-says").textContent`).then((t) => /This is DuckStation/.test(t)), true);
    check("its console is selected, and says what changes",
      await b.ev(`(() => { const r = document.querySelector("#editor .ea-consoles .sc-row"); return [r.querySelector("b").textContent, r.querySelector("input").checked, /will start in DuckStation instead of RetroArch/.test(r.textContent)]; })()`),
      [PSX, true, true]);
    check("the options are shown between the program and the game's file",
      await b.ev(`[document.querySelector("#editor .ea-args").value, /duckstation-qt/.test(document.querySelector("#editor .ea-cmd").textContent)]`), ["-batch -fullscreen", true]);
    check("and the button says what it will do", await b.ev(`document.querySelector("#editor .ea-acts button.primary").textContent`), "Add DuckStation");

    await b.ev(`(() => { const f = document.querySelector("#editor .ea-find"); f.value = "saturn"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    check("the find box narrows the consoles",
      await b.ev(`[...document.querySelectorAll("#editor .ea-consoles .sc-row")].filter(r => !r.hidden).map(r => r.querySelector("b").textContent)`), ["Sega Saturn"]);
    await b.ev(`(() => { const f = document.querySelector("#editor .ea-find"); f.value = ""; f.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await b.ev(`document.querySelector("#editor .ea-consoles .sc-row input").click()`);
    check("with no console selected it cannot be added, and says why",
      await b.ev(`[document.querySelector("#editor .ea-acts button.primary").disabled, document.querySelector("#editor .ea-why").textContent]`),
      [true, "Select at least one console for it to play."]);
    await b.ev(`document.querySelector("#editor .ea-consoles .sc-row input").click()`);

    await press("/^Add DuckStation/");
    check("adding it says so, and what to do next", await b.until(`/IS ADDED/.test(${title})`, true, 8000), true);
    check("its console is ready, with what it took over from",
      await b.ev(`document.querySelector("#editor .rp-check").textContent`).then((t) => /READY/.test(t) && /start in DuckStation now, instead of RetroArch/.test(t)), true);
    check("the table has it", await apiUntil(async () => !!tableNow().programs.duckstation, 4000), true);
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`, true, 4000);

    // Set Emulator, from a game's right-click menu
    await b.setView("grid");
    await b.openPlatform(PSX);
    await b.ev(`(() => { const n = document.querySelector("#view .tile, #view .row"); const r = n.getBoundingClientRect();
      n.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 })); })()`);
    await b.waitFor(`!!document.querySelector(".ctx")`, 3000); await b.settled();
    const menuGame = await b.ev(`import("/js/state.js").then(m => m.games[m.sel].id)`);
    await b.menuDeep(/Set Emulator/, /Emulation/);
    check("the Emulation group of a game's menu opens Set Emulator", await b.until(title, "SET EMULATOR", 6000), "SET EMULATOR");
    check("with the console's emulators for this game and for every game of it, the one in use marked",
      await b.ev(`[document.querySelectorAll("#editor .es-game .cr-row").length, document.querySelectorAll("#editor .es-every .cr-row").length,
        (document.querySelector("#editor .es-game .cr-row.on .cr-name") || {}).textContent, (document.querySelector("#editor .cr-row.sel .cr-name") || {}).textContent]`),
      [psxWas.length + 1, psxWas.length + 1, "DuckStation", "DuckStation"]);
    await b.ev(`[...document.querySelectorAll("#editor .es-game .cr-row")].find(n => !/DuckStation/.test(n.textContent)).click()`);
    check("choosing one closes it and says so", await b.until(`/will start in/.test(document.getElementById("strip").textContent)`, true, 6000), true);
    check("and the choice reached the server", await apiUntil(async () => (await api("api/emuset.php?id=" + encodeURIComponent(menuGame))).chosen === backKey, 6000), true);
    await emuset({ id: menuGame, clear: true });
    await b.goto();
    await b.setView("list");

    // Settings > Emulators: the row, Change..., and Remove
    await b.openBar("emulators");
    await b.menuItem(/Emulator settings/);
    const mineSel = `[...document.querySelectorAll("#settings .emu-row")].find(r => /DuckStation/.test(r.querySelector(".emu-name").textContent))`;
    check("Settings > Emulators lists it with its console", await b.until(`(r => !!r && r.querySelector(".emu-plays").textContent)(${mineSel})`, "Starts the games of Sony Playstation.", 8000), "Starts the games of Sony Playstation.");
    check("the page offers Add an emulator, and Change... on every emulator but RetroArch",
      await b.ev(`[[...document.querySelectorAll("#settings .opt label")].some(l => /^Add an emulator/.test(l.textContent)),
        [...document.querySelectorAll("#settings .emu-row")].filter(r => /RetroArch/.test(r.querySelector(".emu-name").textContent) && r.querySelector(".emu-change")).length,
        !!${mineSel}.querySelector(".emu-change")]`), [true, 0, true]);
    await b.ev(`${mineSel}.querySelector(".emu-change").click()`);
    check("Change... opens it for changing, over a closed Settings",
      [await b.until(title, "CHANGE DUCKSTATION", 8000), await b.ev(`document.getElementById("settings").hidden`)], ["CHANGE DUCKSTATION", true]);
    check("with its console shown as starting in it",
      await b.until(`(r => !!r && /starts in DuckStation/.test(r.textContent))(document.querySelector("#editor .ea-consoles .sc-row"))`, true, 6000), true);
    await press("/^Remove DuckStation/");
    check("Remove asks first, and says the program itself stays",
      await b.until(`(c => !!c && /stay on your disk/.test(c.textContent))(document.querySelector(".confirm"))`, true, 4000), true);
    await b.ev(`document.querySelector(".confirm .primary").click()`);
    check("removed, the table is as it was", await apiUntil(async () => !tableNow().programs.duckstation, 6000), true);
    check("and Settings comes back at Emulators, without it",
      await b.until(`!document.getElementById("settings").hidden && [...document.querySelectorAll("#settings .emu-row .emu-name")].length > 0 && ![...document.querySelectorAll("#settings .emu-row .emu-name")].some(n => /DuckStation/.test(n.textContent))`, true, 8000), true);
    await b.key("Escape");
    await b.until(`document.getElementById("settings").hidden`, true, 4000);

    // RetroArch chosen by mistake
    await b.ev(`import("/js/emuadd.js").then(m => m.openEmuAdd())`);
    await b.until(title, "ADD AN EMULATOR", 6000);
    fs.writeFileSync(answer, ra.exe);
    await press("/Choose the program/");
    check("RetroArch chosen here is named, and sent to Getting started",
      await b.until(`(v => !!v && v.textContent)(document.querySelector("#editor .rp-verdict"))`, "This is RetroArch.", 8000), "This is RetroArch.");
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`, true, 4000);
    await b.setView(viewWas);
    check("no script errors through any of it", await b.ev(`(window.__errs || []).length`), 0);
  } finally {
    fs.rmSync(answer, { force: true });
    kept.restore();
    fs.rmSync(fx, { recursive: true, force: true });
    fs.rmSync(path.join(DATA, "fixtures", "emu-games"), { recursive: true, force: true });
  }
};
