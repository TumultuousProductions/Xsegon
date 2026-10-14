/* Emulators moved out of LaunchBox's folder (includes\emumove.php).
 *
 * The check that matters most: LAUNCHBOX'S FOLDER IS READ AND NEVER WRITTEN.
 * Every file of the stand-in LaunchBox is compared, name, size and date,
 * before and after everything here.
 *
 * A stand-in LaunchBox folder is made in the test's own data, and the emulator
 * table and scanned games are replaced by ones naming only what is made here,
 * so the folder the copies go into can never be a real one. Both are put back.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, DATA, sleep } = require("./lib");

const day = 86400000;
function put(file, text, daysAgo) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  const at = new Date(Date.now() - (daysAgo || 0) * day);
  fs.utimesSync(file, at, at);
}
// name:size:date to the second (a copy's date is kept to the second), or "dir"
const filesOf = (dir, exact) => !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { recursive: true }).map((f) => String(f)).sort()
  .map((f) => { const st = fs.statSync(path.join(dir, f)); return f + ":" + (st.isFile() ? st.size + "/" + (exact ? st.mtimeMs : Math.floor(st.mtimeMs / 1000)) : "dir"); });

const FX = path.join(DATA, "fixtures", "emumove");
const LB = path.join(FX, "LaunchBox"), OWN = path.join(FX, "Emulators"), ROMS = path.join(FX, "roms");
const RA = path.join(LB, "Emulators", "RetroArch"), XEMU = path.join(LB, "Emulators", "Xemu");
const GAME = "Move Game (USA)", ID = "xs-scan-emumovetest1";

function makeAll(many) {
  fs.rmSync(FX, { recursive: true, force: true });
  put(path.join(LB, "LaunchBox.exe"), "", 9);
  put(path.join(LB, "Data", "Platforms.xml"), "<LaunchBox />", 9);
  put(path.join(LB, "loose.exe"), "", 9);
  put(path.join(RA, "retroarch.exe"), "the program", 30);
  put(path.join(RA, "retroarch.cfg"), ['savefile_directory = ":\\saves"', 'savestate_directory = ":\\states"', 'sort_savefiles_enable = "true"',
    'sort_savestates_enable = "true"', 'savefiles_in_content_dir = "false"', 'savestates_in_content_dir = "false"', ""].join("\n"), 30);
  put(path.join(RA, "info", "a_libretro.info"), 'corename = "Core A"\n', 30);
  put(path.join(RA, "cores", "a_libretro.dll"), "x".repeat(300000), 30);
  put(path.join(RA, "saves", "Core A", "An Old Game.srm"), "a save made in LaunchBox's RetroArch", 200);
  fs.mkdirSync(path.join(RA, "an empty folder", "inside"), { recursive: true });
  if (many) { for (let i = 0; i < many; i++) { put(path.join(RA, "assets", "set" + (i % 20), "f" + i + ".bin"), "y".repeat(2000)); } }
  put(path.join(XEMU, "xemu.exe"), "the program", 30);
  put(path.join(XEMU, "bios", "boot.bin"), "b".repeat(1000), 30);
  put(path.join(XEMU, "xemu.toml"), "[sys.files]\nbootrom_path = '" + path.join(XEMU, "bios", "boot.bin") + "'\nhdd_path = '" + path.join(XEMU, "saves", "hdd.qcow2")
    + "'\nother = '" + path.join(LB, "Emulators", "Xemu two", "x.bin") + "'\n", 30);
  // two of the person's own, outside LaunchBox: the folder they share is where copies are offered to go
  put(path.join(OWN, "alpha", "alpha.exe"), "", 9);
  put(path.join(OWN, "beta", "bin", "beta.exe"), "", 9);
  // a game that starts in the RetroArch, with a save an earlier setup left beside it
  put(path.join(ROMS, GAME + ".z64"), "not a game, a stand-in", 400);
  put(path.join(ROMS, GAME + ".srm"), "a save beside the game", 300);
  put(path.join(ROMS, GAME + ".state"), "a state beside the game", 300);
}
function table() {
  return { made: new Date().toISOString(), from: "a test", programs: {
    ra: { name: "RetroArch", exe: path.join(RA, "retroarch.exe"), args: "", noQuotes: false },
    xemu: { name: "xemu", exe: path.join(XEMU, "xemu.exe"), args: "", noQuotes: false },
    loose: { name: "Loose", exe: path.join(LB, "loose.exe"), args: "", noQuotes: false },
    alpha: { name: "Alpha", exe: path.join(OWN, "alpha", "alpha.exe"), args: "", noQuotes: false },
    beta: { name: "Beta", exe: path.join(OWN, "beta", "bin", "beta.exe"), args: "", noQuotes: false },
  }, platforms: {
    "nintendo 64": { options: [{ program: "ra", emulator: "RetroArch", args: '-L "cores\\a_libretro.dll" -f', core: "a", load: "cores\\a_libretro.dll", default: true }] },
    "microsoft xbox": { options: [{ program: "xemu", emulator: "xemu", args: "-full-screen -dvd_path", own: true, default: true }] },
    // its core named by a whole path into LaunchBox's RetroArch, the drive letter small, as LaunchBox wrote some
    "sega genesis": { options: [{ program: "ra", emulator: "RetroArch", args: '-L "' + RA.replace(/^C:/, "c:") + '\\cores\\a_libretro.dll" -f', core: "a", load: RA.replace(/^C:/, "c:") + "\\cores\\a_libretro.dll", default: true }] },
  } };
}

module.exports = async function (b, check) {
  const tableF = path.join(DATA, "emulators.json"), scanF = path.join(DATA, "scanned-games.json");
  const tableWas = fs.readFileSync(tableF), scanWas = fs.readFileSync(scanF);
  const mine = ["emumove.json", "emumove-job.json", "emumove-stop", "emulators.before-move.json"].map((f) => path.join(DATA, f));
  const readTable = () => JSON.parse(fs.readFileSync(tableF, "utf8").replace(/^﻿/, ""));
  const get = (q) => api("api/emumove.php" + (q || ""));
  const ended = async (ms) => { let j = null; for (const end = Date.now() + ms; Date.now() < end;) { j = (await get()).job; if (j && j.state !== "running") { break; } await sleep(120); } return j || {}; };
  const reset = (many) => {
    makeAll(many);
    for (const f of mine) { fs.rmSync(f, { force: true }); }
    fs.writeFileSync(tableF, JSON.stringify(table()));
    fs.writeFileSync(scanF, JSON.stringify([{ id: ID, title: "Move Game", platform: "Nintendo 64", rom: path.join(ROMS, GAME + ".z64"), added: new Date().toISOString() }]));
  };

  try {
    reset(0);
    const lbBefore = filesOf(LB, true);

    // ---- what sits inside LaunchBox ----
    const first = await get();
    const row = (res, key) => (res.rows || []).find((r) => r.keys.includes(key)) || {};
    check("the emulators inside LaunchBox's folder are listed, each with its whole folder, and the person's own are not",
      [(first.rows || []).map((r) => r.keys.join("+")).sort(), row(first, "ra").folder, row(first, "ra").consoles, row(first, "xemu").consoles],
      [["loose", "ra", "xemu"], RA, 2, 1]);
    check("a program lying loose in LaunchBox's folder is said to be unmovable, not offered", /lies loose in LaunchBox's folder/.test(row(first, "loose").why || ""), true);
    check("the copies are offered the folder the person's other emulators share, and each would keep its folder's name",
      [first.dest, row(first, "ra").dest, row(first, "ra").there, first.destInside], [OWN, path.join(OWN, "RetroArch"), false, false]);
    const sizes = (await get("?sizes=1")).sizes || {};
    check("how big each one is comes when asked for", [(sizes.ra || {}).files, (sizes.ra || {}).bytes > 300000, (sizes.xemu || {}).files], [5, true, 3]);

    // ---- refusals, before a byte is copied ----
    const start = (keys, dest) => api("api/emumove.php", { start: keys, dest: dest });
    check("no emulator selected, a loose program, and a folder inside LaunchBox are each refused in words",
      [/no emulator is selected/.test((await start([], OWN)).error || ""), /cannot be moved/.test((await start(["loose"], OWN)).error || ""),
       /inside LaunchBox/.test((await start(["ra"], path.join(LB, "Elsewhere"))).error || "")], [true, true, true]);
    fs.mkdirSync(path.join(OWN, "RetroArch"));
    check("a folder of that name already there is refused, and marked on its row",
      [/there is a RetroArch in .* already/.test((await start(["ra"], OWN)).error || ""), row(await get(), "ra").there], [true, true]);
    // What a copy cut short left behind carries its mark: that is not "there already", and the next copy clears it.
    put(path.join(OWN, "RetroArch", ".xsegon-copying"), "", 0);
    put(path.join(OWN, "RetroArch", "half", "a file.bin"), "cut short", 0);
    check("a half-made copy left by a copy cut short does not stand in the way", row(await get(), "ra").there, false);
    check("nothing was started by any of that", (await get()).job, null);

    // ---- the move ----
    const tableBefore = fs.readFileSync(tableF, "utf8");
    check("the copy starts", (await start(["ra", "xemu"], OWN)).started, true);
    const job = await ended(30000);
    check("and ends having moved both", [job.state, (job.items || []).map((i) => i.state), /RetroArch, xemu now start from /.test(job.said || "")], ["done", ["done", "done"], true]);
    check("each copy is its folder whole: every file, its size and its date, the empty folders too, and no mark left in it",
      [filesOf(path.join(OWN, "RetroArch")).filter((f) => !f.includes(GAME) && !/^states(\\|:)/.test(f)),   // but for the save and the state picked up into it afterwards
       filesOf(path.join(OWN, "Xemu")).filter((f) => !/^xemu\.toml:/.test(f))],
      [filesOf(RA), filesOf(XEMU).filter((f) => !/^xemu\.toml:/.test(f))]);
    check("LaunchBox's folder is exactly as it was: not a file added, changed or touched", filesOf(LB, true), lbBefore);
    const now = readTable();
    check("the table points at the copies, the others as they were, and the table as it was is kept beside it",
      [now.programs.ra.exe, now.programs.xemu.exe, now.programs.loose.exe, now.programs.alpha.exe, fs.readFileSync(mine[3], "utf8") === tableBefore],
      [path.join(OWN, "RetroArch", "retroarch.exe"), path.join(OWN, "Xemu", "xemu.exe"), path.join(LB, "loose.exe"), path.join(OWN, "alpha", "alpha.exe"), true]);
    check("a console that named its core by a whole path into the old folder names the copy now: nothing is still loaded from LaunchBox",
      [now.platforms["sega genesis"].options[0].args, now.platforms["sega genesis"].options[0].load, now.platforms["nintendo 64"].options[0].args, /launchbox/i.test(JSON.stringify(now.platforms))],
      ['-L "' + path.join(OWN, "RetroArch", "cores", "a_libretro.dll") + '" -f', path.join(OWN, "RetroArch", "cores", "a_libretro.dll"), '-L "cores\\a_libretro.dll" -f', false]);
    const toml = fs.readFileSync(path.join(OWN, "Xemu", "xemu.toml"), "utf8");
    check("a settings file that named the old folder by its whole path names the new one in the copy, and a folder that only starts the same is left",
      [toml.includes("'" + path.join(OWN, "Xemu", "bios", "boot.bin") + "'"), toml.includes("'" + path.join(OWN, "Xemu", "saves", "hdd.qcow2") + "'"),
       toml.includes("'" + path.join(LB, "Emulators", "Xemu two", "x.bin") + "'"), ((job.items || [])[1] || {}).fixed], [true, true, true, { "xemu.toml": 2 }]);
    const lib = (await api("api/library.php?grouped=0")).games || [];
    const dry = await api("api/launch.php", { id: ID, dry: true });
    check("the game starts in the copy from then on", [lib.some((g) => g.id === ID), String(dry.exe || "").toLowerCase()], [true, path.join(OWN, "RetroArch", "retroarch.exe").toLowerCase()]);
    const pickedTo = path.join(OWN, "RetroArch", "saves", "Core A", GAME + ".srm");
    check("and the save kept beside the game was picked up into the copy, which now may be written to: copied, the one beside the game still there",
      [job.picked, fs.existsSync(pickedTo) && fs.readFileSync(pickedTo, "utf8"), fs.existsSync(path.join(ROMS, GAME + ".srm")), fs.existsSync(path.join(RA, "saves", "Core A", GAME + ".srm"))],
      [2, "a save beside the game", true, false]);
    check("its closing words count the saves, not the games they were beside", /2 saves kept beside one game were put where RetroArch loads them/.test(job.said || ""), true);
    const after = await get();
    check("what was moved is remembered, with the way back, and is not listed as inside LaunchBox any more",
      [(after.rows || []).map((r) => r.keys.join("+")), (after.moved || []).map((m) => [m.key, m.to, m.back]).sort()],
      [["loose"], [["ra", path.join(OWN, "RetroArch"), true], ["xemu", path.join(OWN, "Xemu"), true]]]);

    // ---- back ----
    check("going back points the table at LaunchBox's own again and leaves the copy where it is",
      [(await api("api/emumove.php", { back: "ra" })).ok, readTable().programs.ra.exe, readTable().programs.xemu.exe, fs.existsSync(path.join(OWN, "RetroArch", "retroarch.exe")),
       ((await get()).moved || []).map((m) => m.key)],
      [true, path.join(RA, "retroarch.exe"), path.join(OWN, "Xemu", "xemu.exe"), true, ["xemu"]]);
    check("and its consoles' cores with it", readTable().platforms["sega genesis"].options[0].load.toLowerCase(), path.join(RA, "cores", "a_libretro.dll").toLowerCase());
    check("an emulator that was never moved has no way back", (await api("api/emumove.php", { back: "alpha" })).ok, false);

    // ---- stopped half way: the half-made copy is taken away, nothing pointed at it ----
    reset(1500);
    const lbBig = filesOf(LB, true);
    await start(["ra"], OWN);
    await api("api/emumove.php", { stop: true });
    const cut = await ended(60000);
    if (cut.state === "stopped") {
      check("a copy stopped half way is taken away again, and the table is as it was",
        [fs.existsSync(path.join(OWN, "RetroArch")), readTable().programs.ra.exe, /its half-made copy is taken away/.test(cut.error || ""), ((await get()).moved || []).length],
        [false, path.join(RA, "retroarch.exe"), true, 0]);
    } else {
      console.log("    (the copy ended before the stop reached it: the half-made copy is not checked this time)");
    }
    check("and LaunchBox's folder is exactly as it was after that too", filesOf(LB, true), lbBig);

    // ---- the window ----
    reset(0);
    const lbPage = filesOf(LB, true);
    await b.goto();
    await b.setView("grid");
    check("the page is told how many emulators sit inside LaunchBox", await b.ev(`window.XSEGON.emusInLb`), 3);
    await b.openBar("emulators");
    check("and the Emulators menu offers the way out", await b.ev(`[...document.querySelectorAll(".ctx-item")].some((n) => /Move out of LaunchBox/.test(n.textContent))`), true);
    await b.menuItem(/Move out of LaunchBox/);
    const title = `(document.querySelector("#editor .panel-title") || {}).textContent`;
    const rows = `[...document.querySelectorAll("#editor .em-list .cr-row")]`;
    check("its window lists them, nothing selected for you, with the folder the copies would go into",
      [await b.until(title, "MOVE OUT OF LAUNCHBOX", 8000),
       await b.until(`${rows}.map((r) => r.querySelector(".cr-name").textContent + (r.classList.contains("on") ? "*" : "") + (r.classList.contains("ro") ? " (no)" : ""))`,
         ["RetroArch", "xemu", "Loose (no)", "The folder they are copied into", "Select the emulators to move"], 8000),
       await b.ev(`${rows}[3].querySelector(".sv-sub").textContent`)],
      ["MOVE OUT OF LAUNCHBOX", ["RetroArch", "xemu", "Loose (no)", "The folder they are copied into", "Select the emulators to move"], OWN]);
    check("each says where it is and how many consoles start in it, and its size once measured",
      await b.until(`(r => [r.querySelector(".sv-sub").textContent === ${JSON.stringify(RA)}, /^2 consoles/.test(r.querySelector(".cr-tag").textContent), /\\d+ MB$/.test(r.querySelector(".cr-tag").textContent),
        r.querySelector(".cr-name").getBoundingClientRect().width > 60])(${rows}[0])`, [true, true, true, true], 8000), [true, true, true, true]);
    await b.shot("emulators-move-out");
    await b.ev(`${rows}[0].click()`);
    check("a press selects one, and the button counts what is selected",
      await b.until(`[${rows}[0].classList.contains("on"), /^Copy the 1 selected/.test(${rows}[4].querySelector(".cr-name").textContent)]`, [true, true], 4000), [true, true]);
    await b.ev(`${rows}[4].click()`);
    /* The press starts the copy and closes the window by itself: the copy is a bar in the corner
       from there (the jobs group has the bars), and the strip says how it ended with no window open to say it. */
    const stripSays = `(document.getElementById("strip") || {}).textContent || ""`;
    check("the press starts the copy and closes the window by itself, and the strip says how it ended",
      [await b.until(`document.getElementById("editor").hidden`, true, 6000), await b.until(`/RetroArch now starts from /.test(${stripSays})`, true, 30000)], [true, true]);
    check("RetroArch starts from the copy, and LaunchBox's folder is exactly as it was", [readTable().programs.ra.exe, filesOf(LB, true)], [path.join(OWN, "RetroArch", "retroarch.exe"), lbPage]);
    await b.openBar("emulators");
    await b.menuItem(/Move out of LaunchBox/);
    const back = `[...document.querySelectorAll("#editor .em-moved .cr-row")]`;
    check("opened again, it stands under Moved before, with the way back",
      await b.until(`${back}.map((r) => r.querySelector(".cr-name").textContent)`, ["RetroArch: go back to LaunchBox's own"], 8000), ["RetroArch: go back to LaunchBox's own"]);
    await b.ev(`${back}[0].click()`);
    check("which points Xsegon at LaunchBox's own again", [await b.until(`${back}.length`, 0, 8000), readTable().programs.ra.exe], [0, path.join(RA, "retroarch.exe")]);
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`, true);

    // ---- a PC with nothing inside LaunchBox is not offered it ----
    const none = table();
    delete none.programs.ra; delete none.programs.xemu; delete none.programs.loose;
    none.platforms = {};
    fs.writeFileSync(tableF, JSON.stringify(none));
    await b.goto();
    await b.setView("grid");
    await b.openBar("emulators");
    check("with no emulator inside LaunchBox the menu does not mention it",
      [await b.ev(`window.XSEGON.emusInLb`), await b.ev(`[...document.querySelectorAll(".ctx-item")].some((n) => /Move out of LaunchBox/.test(n.textContent))`)], [0, false]);
    await b.key("Escape");
    check("no script errors through any of it", await b.ev(`(window.__errs || []).length`), 0);
  } finally {
    for (let i = 0; i < 40 && ((await get()).job || {}).state === "running"; i++) { await sleep(250); }
    fs.writeFileSync(tableF, tableWas);
    fs.writeFileSync(scanF, scanWas);
    for (const f of mine) { fs.rmSync(f, { force: true }); }
    fs.rmSync(FX, { recursive: true, force: true });
  }
};
