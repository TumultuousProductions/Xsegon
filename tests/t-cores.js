/* Which core a game runs on (api\cores.php).
 *
 * A game names an emulator, and the pair (emulator, platform) names the core.
 * The checks prove Xsegon reads that pair as LaunchBox does, and that a choice
 * made in Xsegon changes ONLY the core: the SNES default carries a CRT shader
 * in the same command line, and a swap that rebuilt the line would drop it.
 *
 * Nothing is launched: api\launch.php answers with "dry": true.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, BASE, DATA, sleep, apiUntil } = require("./lib");

/* The -L value, and the line with the core taken out, so "did anything else
   move" is one comparison rather than a guess. */
const coreOf = (args) => {
  const m = /-L\s+"([^"]*)"|-L\s+(\S+)/i.exec(args || "");
  if (!m) { return null; }
  return (m[1] || m[2]).replace(/\\/g, "/").split("/").pop().replace(/_libretro\.dll$/i, "");
};
const withoutCore = (args) => (args || "").replace(/-L\s+("[^"]*"|\S+)/i, "-L <CORE>");

const first = async (platform) => {
  const lib = await api("api/library.php?platform=" + encodeURIComponent(platform));
  return (lib.games || [])[0];
};

module.exports = async function (b, check) {
  /* ---- Xsegon's own emulator table -----------------------------------
     Seeded on an import and read from then on, so a core can still be chosen
     with LaunchBox moved or gone. */
  const tablePath = path.join(DATA, "emulators.json");
  check("Xsegon has an emulator table of its own", fs.existsSync(tablePath));
  const table = JSON.parse(fs.readFileSync(tablePath, "utf8"));
  const progs = Object.values(table.programs || {});
  check("it names the programs, not the 29 LaunchBox entries", progs.length >= 5 && progs.length <= 12);
  check("the 22 RetroArch entries folded into one program",
    progs.filter((p) => /retroarch/i.test(p.exe)).length, 1);
  check("every program has an absolute path", progs.every((p) => /^[A-Za-z]:\\|^\\\\/.test(p.exe)));
  /* A path written as "LaunchBox\..\Downloads\..." only means the right folder
     while LaunchBox sits where it was, so the ".." is folded away. */
  check("with no .. left in any of them", progs.every((p) => !p.exe.includes("..")));
  check("and every one of them is on disk", progs.every((p) => fs.existsSync(p.exe)));
  check("it covers the consoles", Object.keys(table.platforms || {}).length > 10);

  // Every game the library says is playable must map to a program in here.
  const all = await api("api/library.php");
  const platforms = new Set(all.games.filter((g) => g.playable && !g.local).map((g) => g.platform.toLowerCase()));
  const missing = [...platforms].filter((p) => !(table.platforms || {})[p]);
  check("every playable console has an entry", missing.join(",") , "");

  /* ---- the Emulators screen, and moving one ------------------------
     Moving an emulator is one path changed here, and it takes effect with no
     re-import, since importing needs LaunchBox. */
  const emu = await api("api/emulators.php");
  check("the emulator table answers", emu.ok === true && emu.programs.length > 0);
  check("it is Xsegon's own, not read live", emu.mine, true);
  check("every program says whether it is really there", emu.programs.every((p) => typeof p.there === "boolean"));
  check("and all of them are", emu.programs.every((p) => p.there));
  check("the one carrying the most consoles is first",
    emu.programs[0].consoles.length >= emu.programs[emu.programs.length - 1].consoles.length);

  const ra = emu.programs.find((p) => /retroarch/i.test(p.exe));
  check("RetroArch is in the table", !!ra);
  const badPath = await api("api/emulators.php", { program: ra.key, exe: "C:\\NoSuchFolder\\nope.exe" });
  check("a path with no file there is refused", badPath.ok === false && /no file at/.test(badPath.error || ""));
  const badProg = await api("api/emulators.php", { program: "not-a-program", exe: ra.exe });
  check("so is a program that is not in the table", badProg.ok === false);
  const foreignEmu = await fetch(BASE + "/api/emulators.php", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
    body: JSON.stringify({ program: ra.key, exe: ra.exe }),
  });
  check("and a foreign origin cannot move an emulator",
    foreignEmu.status === 403 || (await foreignEmu.json()).ok === false);

  /* RetroArch pointed at the retroarch.exe beside its wrapper, a real file to
     move to: the next launch uses it with nothing re-imported. */
  const beside = ra.exe.replace(/retroarch_wrapper\.bat$/i, "retroarch.exe");
  if (beside !== ra.exe && fs.existsSync(beside)) {
    const moved = await api("api/emulators.php", { program: ra.key, exe: beside });
    check("an emulator can be pointed somewhere else", moved.ok === true && moved.exe, beside);
    const afterMove = await api("api/launch.php", { id: (await first("Nintendo 64")).id, dry: true });
    check("and the next launch uses it, with no re-import", afterMove.exe, beside);
    const back = await api("api/emulators.php", { program: ra.key, exe: ra.exe });
    check("and it can be put back", back.ok === true && back.exe, ra.exe);
    const afterBack = await api("api/launch.php", { id: (await first("Nintendo 64")).id, dry: true });
    check("the launch follows it back", afterBack.exe, ra.exe);
  }

  // ---- what the platform offers ----
  const snes = await first("Super Nintendo Entertainment System");
  check("a SNES game is there to test with", !!snes);
  const offer = await api("api/cores.php?id=" + encodeURIComponent(snes.id));
  check("the cores for a platform are listed", offer.ok && offer.cores.length >= 2);
  check("each carries its core name and what to load",
    offer.cores.every((c) => typeof c.core === "string" && c.core && typeof c.load === "string" && c.load));
  check("exactly one is LaunchBox's default", offer.cores.filter((c) => c.default).length, 1);
  check("and the list has no core twice",
    new Set(offer.cores.map((c) => c.core)).size, offer.cores.length);
  check("nothing is chosen to begin with", offer.chosen, null);

  // ---- a console with one core, and one with no RetroArch at all ----
  // Two different reasons for nothing to offer, each said in its own words.
  const gc = await first("Nintendo GameCube");
  const none = await api("api/cores.php?id=" + encodeURIComponent(gc.id));
  check("a console that is not RetroArch offers none", none.ok && none.cores.length, 0);
  check("and says what it does run on", /Dolphin/.test(none.why || ""));
  const dc = await first("Sega Dreamcast");
  const one = await api("api/cores.php?id=" + encodeURIComponent(dc.id));
  check("a console with a single core offers that one", one.ok && one.cores.length, 1);
  check("and says so rather than pretending to choose", /one core/.test(one.why || ""));

  // ---- the swap changes the core and NOTHING else ----
  const before = await api("api/launch.php", { id: snes.id, dry: true });
  check("a dry launch answers with the command", before.ok && !!before.args);
  const wasCore = coreOf(before.args);
  check("and LaunchBox's core is in it", wasCore, offer.cores.find((c) => c.default).core);
  check("this SNES line carries a shader too", /--set-shader/.test(before.args));

  const other = offer.cores.find((c) => !c.default);
  const set = await api("api/cores.php", { id: snes.id, core: other.core });
  check("a core can be chosen", set.ok === true && set.chosen, other.core);

  const after = await api("api/launch.php", { id: snes.id, dry: true });
  check("the launch now uses it", coreOf(after.args), other.core);
  check("the dry launch says whose choice that was", after.core, other.core);
  check("and names it in via", /your choice/.test(after.via || ""));
  // The one that matters: everything except the core is byte for byte.
  check("nothing else in the command line moved", withoutCore(after.args), withoutCore(before.args));
  check("so the shader survived the swap", /--set-shader/.test(after.args));

  // ---- what it refuses ----
  const wrong = await api("api/cores.php", { id: snes.id, core: "mupen64plus_next" });
  check("a core from another console is refused", wrong.ok === false);
  check("and says which console it was asked about", /Super Nintendo/.test(wrong.error || ""));
  const junk = await api("api/cores.php", { id: snes.id, core: "../../evil" });
  check("a made-up core is refused", junk.ok === false);
  const noId = await api("api/cores.php", { id: "no-such-game", core: "snes9x" });
  check("an unknown game is refused", noId.ok === false);
  const foreign = await fetch(BASE + "/api/cores.php", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
    body: JSON.stringify({ id: snes.id, core: "snes9x" }),
  });
  check("a foreign origin cannot set one", foreign.status === 403 || (await foreign.json()).ok === false);

  // ---- the details panel says which core, and whose choice ----
  const full = await api("api/game.php?id=" + encodeURIComponent(snes.id));
  check("the game record carries the core", full.game.core, other.core);
  check("and that it was yours", full.game.coreMine, true);
  const gcFull = await api("api/game.php?id=" + encodeURIComponent(gc.id));
  check("a game with no core says none", gcFull.game.core, null);

  // ---- clearing puts LaunchBox back exactly ----
  const cleared = await api("api/cores.php", { id: snes.id, clear: true });
  check("the choice can be cleared", cleared.ok === true && cleared.chosen, null);
  const back = await api("api/launch.php", { id: snes.id, dry: true });
  check("and the command is LaunchBox's again, exactly", back.args, before.args);
  check("with nothing claimed about a choice", back.core, null);
  const fullBack = await api("api/game.php?id=" + encodeURIComponent(snes.id));
  check("the details panel stops calling it yours", fullBack.game.coreMine, false);
  check("but still names the core running", fullBack.game.core, wasCore);

  /* ---- with LaunchBox taken away -------------------------------------
     A LaunchBox path to a missing folder stands in for a moved or uninstalled
     LaunchBox: the cores still come from Xsegon's table, not Emulators.xml.
     The path is put back whatever happens, and settings.json is a protected file. */
  const settingsNow = await api("api/settings.php");
  const lbPath = (settingsNow.settings || settingsNow).paths.launchbox;
  try {
    await api("api/settings.php", { paths: { launchbox: "C:\\NoSuchLaunchBox" } });
    const st = await api("api/status.php");
    check("LaunchBox can be missing", st.checks.launchbox.present, false);
    // RetroArch's quit and resume are read from the games as shown, not from library.json (roadmap BH9).
    check("and the status still finds RetroArch from the games, so the quit hint can show",
          /retroarch\.exe$/i.test((st.retroarch || {}).exe || ""), true);

    const offGone = await api("api/cores.php?id=" + encodeURIComponent(snes.id));
    check("the cores are still listed without LaunchBox", offGone.ok && offGone.cores.length, offer.cores.length);
    check("and it does not pretend there is nothing to choose", offGone.why, null);
    const setGone = await api("api/cores.php", { id: snes.id, core: other.core });
    check("a core can still be chosen", setGone.ok === true && setGone.chosen, other.core);
    const dryGone = await api("api/launch.php", { id: snes.id, dry: true });
    check("and the launch still carries it", coreOf(dryGone.args), other.core);
    check("with the rest of the command untouched", withoutCore(dryGone.args), withoutCore(before.args));
    await api("api/cores.php", { id: snes.id, clear: true });

    const gcGone = await api("api/cores.php?id=" + encodeURIComponent(gc.id));
    check("a console that is not RetroArch still says so, not something vague",
      /Dolphin/.test(gcGone.why || ""));
  } finally {
    await api("api/settings.php", { paths: { launchbox: lbPath } });
  }
  // Put back as it was, which may be blank.
  check("the LaunchBox path is put back as it was", (await api("api/status.php")).checks.launchbox.present, lbPath !== "" && require("fs").existsSync(lbPath));

  // ---- the dialog on the page ----
  await b.goto();
  await b.setView("grid");
  await b.openPlatform("Super Nintendo Entertainment System");
  const openMenu = `(() => {
    const n = document.querySelector("#view .tile, #view .row");
    const r = n.getBoundingClientRect();
    n.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 }));
  })()`;
  await b.ev(openMenu);
  await b.waitFor(`!!document.querySelector(".ctx")`, 3000); await b.settled();
  // Set Core sits in the Emulation group; b.menuDeep opens the group to reach it.
  check("the right-click menu offers Emulation, which holds Set Core",
    await b.ev(`[...document.querySelectorAll(".ctx .ctx-item")].some(n => /Emulation/.test(n.textContent))`));
  await b.menuDeep(/Set Core/, /Emulation/);
  await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "SET CORE"`);
  check("it opens the dialog", await b.ev(`(document.querySelector("#editor .panel-title")||{}).textContent`), "SET CORE");
  check("with a row per core", await b.ev(`document.querySelectorAll("#editor .cr-row").length`), offer.cores.length);
  check("the core is the big word on the row, not the emulator",
    await b.ev(`[...document.querySelectorAll("#editor .cr-name")].map(n => n.textContent).join(",")`),
    offer.cores.map((c) => c.core).join(","));
  // The dialog wears LaunchBox's name only while a LaunchBox is hooked up
  // (js\cores.js): without one the same row says "the usual one".
  check("the table's default is marked",
    await b.ev(`[...document.querySelectorAll("#editor .cr-row")].some(n => /LaunchBox's choice|the usual one/.test(n.textContent))`));
  check("each row drew its icon", await b.ev(`document.querySelectorAll("#editor .cr-row svg").length`), offer.cores.length);
  check("one row is under the bar to start with", await b.ev(`!!document.querySelector("#editor .cr-row.sel")`));

  // keyboard: the picker rides the same keys the save state picker does
  await b.key("ArrowUp"); await b.settled();
  const onNow = await b.ev(`(document.querySelector("#editor .cr-row.sel .cr-name")||{}).textContent`);
  check("the arrows move the bar", typeof onNow === "string" && onNow.length > 0);
  await b.key("Enter");
  check("Enter chooses and closes", await b.until(`document.getElementById("editor").hidden`, true, 6000), true);
  await b.until(`/will run on/.test(document.getElementById("strip").textContent)`, true, 4000);
  check("and the strip says what happened",
    await b.ev(`document.getElementById("strip").textContent`).then((t) => /will run on/.test(t)));
  let chosenNow = null;
  await apiUntil(async () => { chosenNow = (await api("api/cores.php?id=" + encodeURIComponent(snes.id))).chosen; return chosenNow === onNow; });
  check("the choice reached the server", chosenNow, onNow);

  // reopening offers the way back, and it works
  await b.ev(openMenu); await b.waitFor(`!!document.querySelector(".ctx")`, 3000); await b.settled();
  await b.menuDeep(/Set Core/, /Emulation/);
  await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "SET CORE"`);
  check("reopening marks the one running now",
    await b.ev(`[...document.querySelectorAll("#editor .cr-row")].some(n => /running now/.test(n.textContent))`));
  check("and offers the usual core back",
    await b.ev(`[...document.querySelectorAll("#editor .cr-row")].some(n => /core again/.test(n.textContent))`));
  await b.ev(`[...document.querySelectorAll("#editor .cr-row")].find(n => /core again/.test(n.textContent)).click()`);
  check("which clears it", await apiUntil(async () => (await api("api/cores.php?id=" + encodeURIComponent(snes.id))).chosen === null, 6000), true);
  await b.until(`document.getElementById("editor").hidden`, true, 4000);

  // a console with nothing to choose explains itself instead of opening empty
  await b.goto();
  await b.setView("grid");
  await b.openPlatform("Nintendo GameCube");
  await b.ev(openMenu); await b.waitFor(`!!document.querySelector(".ctx")`, 3000); await b.settled();
  await b.menuDeep(/Set Core/, /Emulation/);
  await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "SET CORE"`);
  check("a console with no choice opens no rows", await b.ev(`document.querySelectorAll("#editor .cr-row").length`), 0);
  check("and says why on the page",
    await b.ev(`(document.querySelector("#editor .cr-none")||{}).textContent`).then((t) => /Dolphin/.test(t || "")));
  await b.key("Escape");
  await sleep(300);
  check("no script errors through any of it", await b.ev(`(window.__errs || []).length`), 0);
};
