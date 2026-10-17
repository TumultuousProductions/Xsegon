/* The Saves tab of a game's details: every save there is for a game, read
 * and never written (includes\saves.php).
 *
 * Stand-ins only: a RetroArch folder in the real one's shape, and a game
 * folder with the saves an earlier setup would have left beside it. The
 * emulator table and the scanned games point at them and are put back. A
 * PCSX2 folder (t-cheats.js makes it) gets save states and a memory card.
 *
 * Nothing is launched: the page's launch is stubbed, and a file shown in
 * its folder is answered dry by the test server.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, DATA, sleep } = require("./lib");
const { pcsx2Fixture } = require("./t-cheats");

const GAME = "Saves Game (USA)";
const ID = "xs-scan-savestest001";
const ID2 = "xs-scan-savestest002";   // the same console's game kept as an archive
const day = 86400000;

function put(file, text, daysAgo) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  const at = new Date(Date.now() - daysAgo * day);
  fs.utimesSync(file, at, at);
}

/* The stand-in RetroArch. beside: its settings keep saves beside the content. */
function raFixture(ra, beside) {
  fs.rmSync(ra, { recursive: true, force: true });
  put(path.join(ra, "retroarch.exe"), "", 0);
  put(path.join(ra, "retroarch.cfg"), [
    'savefile_directory = ":\\saves"', 'savestate_directory = ":\\states"',
    'savefiles_in_content_dir = "' + beside + '"', 'savestates_in_content_dir = "' + beside + '"',
    'sort_savefiles_enable = "' + !beside + '"', 'sort_savestates_enable = "' + !beside + '"',
    'sort_savefiles_by_content_enable = "false"', 'sort_savestates_by_content_enable = "false"',
    'savestate_thumbnail_enable = "true"', 'savestate_auto_load = "false"',
    'network_cmd_enable = "true"', 'input_load_state = "f4"', ""].join("\n"), 0);
  put(path.join(ra, "info", "mupen64plus_next_libretro.info"), 'display_name = "Nintendo - Nintendo 64 (Mupen64Plus-Next)"\ncorename = "Mupen64Plus-Next"\n', 0);
  const own = path.join(ra, "states", "Mupen64Plus-Next");
  put(path.join(own, GAME + ".state"), "state zero", 2);
  fs.mkdirSync(own, { recursive: true });
  fs.copyFileSync(path.join(__dirname, "..", "img", "xsegon-32.png"), path.join(own, GAME + ".state.png"));
  put(path.join(own, GAME + ".state2"), "state two, with no picture", 5);
  put(path.join(own, GAME + ".state.auto"), "the save on closing", 1);
  put(path.join(own, "Another Game (USA).state"), "not this game's", 1);
  put(path.join(ra, "saves", "Mupen64Plus-Next", GAME + ".srm"), "the save in use", 3);
  put(path.join(ra, "saves", "ParaLLEl N64", GAME + ".srm"), "from the other core", 40);
  put(path.join(ra, "states", "ParaLLEl N64", GAME + ".state1"), "from the other core", 41);
}

/* The game's folder: the game, the saves an earlier setup left beside it, and two that are other games'. */
function romFixture(roms) {
  fs.rmSync(roms, { recursive: true, force: true });
  put(path.join(roms, GAME + ".z64"), "not a game, a stand-in", 400);
  put(path.join(roms, GAME + ".srm"), "an older save", 300);           // older than RetroArch's own
  put(path.join(roms, GAME + ".state"), "a newer state", 1);            // newer than RetroArch's slot 0
  put(path.join(roms, GAME + ".state3"), "a slot RetroArch has none of", 310);
  put(path.join(roms, "Other Game (USA).srm"), "another game's", 300);
  put(path.join(roms, GAME + " (Rev 1).srm"), "another version's", 300);
  put(path.join(roms, GAME + ".txt"), "notes, not a save", 300);
}

const filesOf = (dir) => fs.readdirSync(dir, { recursive: true }).map((f) => String(f)).sort()
  .map((f) => f + ":" + (fs.statSync(path.join(dir, f)).isFile() ? fs.statSync(path.join(dir, f)).mtimeMs + "/" + fs.statSync(path.join(dir, f)).size : "dir"));

const TABS = `[...document.querySelectorAll("#details .dtabs .dtab")]`;
const tabOn = `(t => (t ? t.textContent : null))(${TABS}.find((x) => x.classList.contains("on")))`;
const legend = `[...document.querySelectorAll("#help .hitem .hl")].map((x) => x.textContent)`;
const ROWS = `[...document.querySelectorAll("#details .dtab-pane.is-saves .sv-row")]`;

async function detailsOf(b, id) {
  const there = await b.ev(`import("/js/state.js").then((S) => { const i = S.games.findIndex((g) => g.id === ${JSON.stringify(id)}); if (i >= 0) { S.setSel(i); } return i >= 0; })`);
  if (!there) { return false; }
  await b.key("i");
  return b.waitFor(`!document.getElementById("details").hidden && !!document.querySelector("#details .dtabs")`, 8000);
}

module.exports = async function (b, check) {
  const tableF = path.join(DATA, "emulators.json"), scanF = path.join(DATA, "scanned-games.json");
  const tableWas = fs.readFileSync(tableF), scanWas = fs.readFileSync(scanF);
  const table = JSON.parse(tableWas.toString("utf8").replace(/^﻿/, ""));
  const n64 = ((table.platforms || {})["nintendo 64"] || {}).options || [];
  const opt = n64.find((o) => o.default) || n64[0];
  if (!opt || !/mupen64plus_next/.test(String(opt.args || ""))) {
    console.log("    (the Nintendo 64 does not start in RetroArch's Mupen64Plus-Next here: the Saves tab is not checked)");
    return;
  }
  // A test reads the real saves and never writes one: asked of a real game, before the stand-in takes its place.
  const realN64 = ((await api("api/library.php?grouped=0")).games || []).find((g) => /^nintendo 64$/i.test(String(g.platform)) && !g.local);
  if (realN64) {
    const realSaves = await api("api/saves.php?id=" + encodeURIComponent(realN64.id));
    check("a test may not put a save into this PC's real RetroArch, and the answer says why",
      [realSaves.canUse, /a test copy never writes into a real emulator's folder|a folder Xsegon never writes to/.test(realSaves.cannot || "")], [false, true]);
  }
  const ra = path.join(DATA, "fixtures", "ra-saves"), roms = path.join(DATA, "fixtures", "saves-roms", "n64");
  const ps2Dir = path.join(DATA, "fixtures", "pcsx2-saves");
  const ask = (id) => api("api/saves.php?id=" + encodeURIComponent(id || ID));
  const group = (res, key) => (res.groups || []).find((g) => g.key === key) || { rows: [] };
  const said = (rows) => rows.map((r) => [r.name, r.file, !!r.play]);

  try {
    raFixture(ra, false);
    romFixture(roms);
    table.programs[opt.program].exe = path.join(ra, "retroarch.exe");
    fs.writeFileSync(tableF, JSON.stringify(table));
    const scanned = JSON.parse(scanWas.toString("utf8").replace(/^﻿/, ""));
    scanned.push({ id: ID, title: "Saves Game", platform: "Nintendo 64", rom: path.join(roms, GAME + ".z64"), added: new Date().toISOString() });
    fs.writeFileSync(scanF, JSON.stringify(scanned));
    const before = filesOf(ra).concat(filesOf(roms));

    // ---- the reader ----
    const got = await ask();
    check("a game's saves come in groups, RetroArch's own first", (got.groups || []).map((g) => g.key), ["states", "saves", "other", "beside"]);
    check("every save state of RetroArch's, newest first, then its save on closing, which is not played from",
      said(group(got, "states").rows),
      [["Slot 0", GAME + ".state", true], ["Slot 2", GAME + ".state2", true], ["RetroArch's save on closing", GAME + ".state.auto", false]]);
    check("a state says whether it has a picture",
      group(got, "states").rows.filter((r) => r.play).map((r) => r.shot !== null), [true, false]);
    check("the in-game save is the one in the folder of the core the game starts in",
      [said(group(got, "saves").rows), /saves.Mupen64Plus-Next$/.test(group(got, "saves").where)], [[["In-game save", GAME + ".srm", false]], true]);
    check("the same game's saves under another core are listed apart, with the core's name",
      group(got, "other").rows.map((r) => [r.name, r.core]).sort(), [["In-game save", "ParaLLEl N64"], ["Save state, slot 1", "ParaLLEl N64"]]);
    check("and the help under them names the core that does not read them", /Mupen64Plus-Next does not read them/.test(group(got, "other").help), true);
    const beside = group(got, "beside").rows;
    check("the saves beside the game's file are picked up: its own name only, saves and states only",
      beside.map((r) => r.file).sort(), [GAME + ".srm", GAME + ".state", GAME + ".state3"]);
    check("each held against RetroArch's own: older, newer, or none of that slot",
      [GAME + ".srm", GAME + ".state", GAME + ".state3"].map((f) => { const r = beside.find((x) => x.file === f) || {}; return r.own ? r.own.newer : r.own; }),
      [true, false, null]);
    check("none of them is played from, and the group says RetroArch does not load them",
      [beside.some((r) => r.play), /RetroArch does not load these/.test(group(got, "beside").help), group(got, "beside").where.toLowerCase() === roms.toLowerCase()], [false, true, true]);
    check("counted, and the game's full record carries the count for the tab", [got.count, (await api("api/game.php?id=" + ID)).game.saves], [9, 9]);
    check("an unknown game and a bad id are refused", [(await ask("nope")).ok, (await ask("../x")).ok], [false, false]);

    // ---- a row shown in its folder: by its key, never a path ----
    const key = (beside.find((r) => r.file === GAME + ".srm") || {}).key;
    const shown = await api("api/reveal.php", { id: ID, what: "save", key: key });
    check("a row is shown in its folder by its key (dry here: the test server opens no window)",
      [shown.ok, String(shown.revealed).toLowerCase(), shown.dry], [true, path.join(roms, GAME + ".srm").toLowerCase(), true]);
    check("a key that names no row, and one that is a path, are refused",
      [(await api("api/reveal.php", { id: ID, what: "save", key: "beside:99" })).ok, (await api("api/reveal.php", { id: ID, what: "save", key: "..\\\\x" })).ok], [false, false]);

    // ---- the tab, in the page ----
    await b.goto();
    await b.setView("list");
    await b.openPlatform("Nintendo 64");
    check("(the game's details open)", await detailsOf(b, ID), true);
    check("the Saves tab stands after About and Media, before Cheats and Hacks, and counts what there is",
      await b.until(`${TABS}.map((x) => x.textContent.replace(/^(Texture packs) \\(\\d+\\)$/, "$1"))`, ["About", "Media", "Saves (9)", "Cheats", "Hacks", "Achievements", "Texture packs", "Files", "More"], 8000),
      ["About", "Media", "Saves (9)", "Cheats", "Hacks", "Achievements", "Texture packs", "Files", "More"]);
    await b.ev(`(() => { window.__realFetch = window.fetch; window.__launches = []; window.__shown = []; window.fetch = function (u, o) {
        if (String(u).indexOf("api/launch.php") >= 0) { window.__launches.push(JSON.parse(o.body)); return Promise.resolve(new Response(JSON.stringify({ ok: true, launched: "stub", via: "stub", slot: JSON.parse(o.body).slot === undefined ? null : JSON.parse(o.body).slot, loads: "hotkey" }), { headers: { "Content-Type": "application/json" } })); }
        if (String(u).indexOf("api/reveal.php") >= 0) { window.__shown.push(JSON.parse(o.body)); }
        return window.__realFetch(u, o); }; })()`);
    await b.key("ArrowRight");
    await b.until(`${TABS}.some((x) => x.classList.contains("on") && x.textContent === "Media")`, true, 4000);
    await b.key("ArrowRight");
    check("Right, past Media, opens it: the groups by name, and a row for every save",
      [await b.until(`[...document.querySelectorAll("#details .dtab-pane.is-saves .sv-head")].map((h) => h.textContent)`,
         ["Save states", "In-game save", "Kept for another core", "Beside the game's file"], 9000), await b.ev(`${ROWS}.length`), await b.ev(tabOn)],
      [["Save states", "In-game save", "Kept for another core", "Beside the game's file"], 9, "Saves (9)"]);
    check("a state with a picture shows it", await b.until(`${ROWS}.some((r) => (r.querySelector(".sv-shot img") || {}).naturalWidth > 0)`, true, 6000), true);
    check("a row says the file, and how it stands to RetroArch's own",
      await b.ev(`(t => [t.includes(${JSON.stringify(GAME + ".srm")}), /older than RetroArch's own/.test(t)])((${ROWS}.find((r) => r.dataset.key === ${JSON.stringify(key)}) || {}).textContent || "")`),
      [true, true]);
    check("every group says where its files are", await b.ev(`[...document.querySelectorAll("#details .dtab-pane.is-saves .sv-where")].map((p) => /saves-roms|ra-saves/.test(p.textContent))`), [true, true, true]);
    check("the list stays inside the panel and scrolls when it is long",
      await b.ev(`(l => l.getBoundingClientRect().bottom <= innerHeight && getComputedStyle(l).overflowY === "auto")(document.querySelector("#details .sv-list"))`), true);
    await b.shot("details-tab-saves");

    // Down goes in; what Enter does is said, and it is the row's own.
    const selKey = `((${ROWS}.find((r) => r.classList.contains("sel")) || {}).dataset || {}).key`;
    await b.key("ArrowDown");
    check("Down goes into the list, onto the newest save state, and the legend offers playing from it",
      [await b.until(`document.querySelector("#details .dtab-pane").classList.contains("in")`, true), await b.until(`${legend}.includes("play from it")`, true), await b.ev(selKey)], [true, true, "state:0"]);
    await b.key("ArrowDown"); await b.key("ArrowDown"); await b.key("ArrowDown");
    check("on the in-game save the legend offers its folder: the press is the row's own",
      [await b.until(selKey, "saves:0"), await b.until(`${legend}.includes("show in its folder")`, true), await b.ev(`${legend}.includes("play from it")`)], ["saves:0", true, false]);
    await b.key("Enter");
    check("Enter there shows the file in its folder and starts no game",
      [await b.until(`window.__shown.length`, 1, 4000), (await b.ev(`window.__shown[0]`)) || {}, await b.ev(`window.__launches.length`), await b.ev(`document.getElementById("details").hidden`)],
      [1, { id: ID, what: "save", key: "saves:0" }, 0, false]);
    await b.key("ArrowUp"); await b.key("ArrowUp"); await b.key("ArrowUp");
    await b.until(selKey, "state:0");
    await b.key("Enter");
    check("Enter on a save state plays from its slot, and details steps aside",
      [await b.until(`window.__launches.length`, 1, 4000), ((await b.ev(`window.__launches[0]`)) || {}).slot, ((await b.ev(`window.__launches[0]`)) || {}).id,
       await b.until(`document.getElementById("details").hidden`, true)], [1, 0, ID, true]);
    await b.ev(`window.fetch = window.__realFetch`);
    await b.settled();
    check("nothing in RetroArch's folder or the game's was written or touched by any of it", filesOf(ra).concat(filesOf(roms)), before);

    // ---- a save put where RetroArch loads it: this RetroArch is the person's own ----
    const SRM = GAME + ".srm", ST0 = GAME + ".state", ST3 = GAME + ".state3";
    const raSave = path.join(ra, "saves", "Mupen64Plus-Next", SRM);
    const keptDir = path.join(DATA, "saves-kept", ID);
    check("a RetroArch outside LaunchBox may be given a save: the ones beside the game, and another core's save but not its state",
      [got.canUse, beside.filter((r) => r.use).map((r) => r.file).sort(), group(got, "other").rows.filter((r) => r.use).map((r) => r.name)],
      [true, [SRM, ST0, ST3], ["In-game save"]]);
    const picked = await api("api/saves.php", { id: ID, pickup: true });
    const st3 = path.join(ra, "states", "Mupen64Plus-Next", ST3);
    check("picking up takes only what RetroArch has none of its own for, and copies it with its date",
      [picked.picked, fs.existsSync(st3) && fs.readFileSync(st3, "utf8"), fs.existsSync(st3) && Math.abs(fs.statSync(st3).mtimeMs - fs.statSync(path.join(roms, ST3)).mtimeMs) < 2000,
       fs.readFileSync(raSave, "utf8")],
      [[ST3], "a slot RetroArch has none of", true, "the save in use"]);
    const after = await ask();
    check("it is then one of RetroArch's own states, and the one beside the game says it is the same and offers nothing",
      [group(after, "states").rows.some((r) => r.slot === 3 && r.play), (({ own, use }) => [!!(own && own.same), !!use])(group(after, "beside").rows.find((r) => r.file === ST3) || {})],
      [true, [true, false]]);
    check("a second pickup has nothing left to take", (await api("api/saves.php", { id: ID, pickup: true })).picked, []);
    const srmKey = (group(after, "beside").rows.find((r) => r.file === SRM) || {}).key;
    const first = await api("api/saves.php", { id: ID, use: srmKey });
    check("where RetroArch has its own, nothing is done until it is asked for: the answer says so, and when its own is from",
      [first.ok, first.needs, /^\d{4}-/.test(first.own || ""), fs.readFileSync(raSave, "utf8"), fs.existsSync(keptDir)], [true, "replace", true, "the save in use", false]);
    check("a state kept for another core is refused: it is that core's alone",
      (await api("api/saves.php", { id: ID, use: (group(after, "other").rows.find((r) => r.kind === "state") || {}).key })).ok, false);

    // In the page: the press asks, and RetroArch's own is kept before the other takes its place.
    check("(the game's details open again)", await detailsOf(b, ID), true);
    await b.clickSel(`#details .dtab[data-tab="saves"]`);
    await b.waitFor(`${ROWS}.length > 5`, 9000);
    const rowOf = `${ROWS}.find((r) => r.dataset.key === ${JSON.stringify(srmKey)})`;
    await b.ev(`(r => { r.closest(".dtab-pane").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); r.dispatchEvent(new MouseEvent("mouseenter")); })(${rowOf})`);
    check("on a save beside the game the legend offers using it", await b.until(`${legend}.includes("use this save")`, true), true);
    await b.ev(`${rowOf}.click()`);
    const asks = `(c => c ? [c.querySelector("h2").textContent, /RetroArch has a save of its own in that place/.test(c.textContent), [...c.querySelectorAll(".confirm-bar button")].map((x) => x.textContent)] : null)(document.querySelector(".confirm"))`;
    check("the press asks first, with the way to keep RetroArch's", await b.until(asks, ["Use this save?", true, ["Keep RetroArch's", "Use this save"]], 6000),
      ["Use this save?", true, ["Keep RetroArch's", "Use this save"]]);
    await b.shot("details-tab-saves-use");
    await b.ev(`[...document.querySelectorAll(".confirm-bar button")].find((x) => x.textContent === "Use this save").click()`);
    check("yes puts it in place, keeps RetroArch's own as a copy, and leaves the one beside the game as it was",
      [await b.until(`/the same as the one RetroArch loads/.test((${rowOf} || {}).textContent || "")`, true, 9000), fs.readFileSync(raSave, "utf8"),
       fs.existsSync(keptDir) ? fs.readdirSync(keptDir).map((f) => fs.readFileSync(path.join(keptDir, f), "utf8")) : [], fs.readFileSync(path.join(roms, SRM), "utf8"),
       await b.ev(`[...document.querySelectorAll("#details .dtab-pane.is-saves .sv-head")].map((h) => h.textContent).includes("Kept copies")`)],
      [true, "an older save", ["the save in use"], "an older save", true]);
    await b.key("Escape"); await b.key("Escape");
    await b.until(`document.getElementById("details").hidden`, true);

    // The same RetroArch inside a LaunchBox folder: read, and never written.
    const lbMark = path.join(DATA, "fixtures", "LaunchBox.exe");
    fs.writeFileSync(lbMark, "");
    const inLb = await ask();
    check("inside LaunchBox's folder nothing may be put: it says why, and where the way out is",
      [inLb.canUse, /inside a folder Xsegon never writes to.*Emulators > Move out of LaunchBox/.test(inLb.cannot || ""), group(inLb, "beside").rows.some((r) => r.use),
       (await api("api/saves.php", { id: ID, use: (group(inLb, "beside").rows.find((r) => r.file === ST0) || {}).key, replace: true })).ok,
       (await api("api/saves.php", { id: ID, pickup: true })).picked],
      [false, true, false, false, []]);
    fs.rmSync(lbMark, { force: true });
    fs.rmSync(path.join(DATA, "saves-kept"), { recursive: true, force: true });

    // ---- RetroArch told to keep saves beside the content: then those are its own ----
    raFixture(ra, true);
    const own = await ask();
    check("with saves kept beside the content, the ones beside the game are RetroArch's own: no file is listed twice",
      [(own.groups || []).map((g) => g.key), said(group(own, "states").rows), said(group(own, "saves").rows)],
      [["states", "saves"], [["Slot 0", GAME + ".state", true], ["Slot 3", GAME + ".state3", true]], [["In-game save", GAME + ".srm", false]]]);

    // ---- a game with nothing, and games Xsegon does not read saves for ----
    raFixture(ra, false);
    fs.rmSync(roms, { recursive: true, force: true });
    put(path.join(roms, GAME + ".z64"), "not a game, a stand-in", 400);
    for (const d of ["states", "saves"]) { fs.rmSync(path.join(ra, d), { recursive: true, force: true }); }
    const none = await ask();
    check("a game with nothing saved says so, and counts nothing", [(none.groups || []).length, none.count, /Nothing is saved for this game yet/.test(none.none || "")], [0, 0, true]);
    // ---- an archive, in a core that wants a plain file: RetroArch unpacks it into its temp folder, which has to be one it finds ----
    const cfgF = path.join(ra, "retroarch.cfg"), cfgWas = fs.readFileSync(cfgF, "utf8");
    const infoF = path.join(ra, "info", "mupen64plus_next_libretro.info"), infoWas = fs.readFileSync(infoF, "utf8");
    const packed = path.join(roms, "Packed Game (USA).zip");
    put(packed, "not an archive, a stand-in", 400);
    const withPacked = JSON.parse(fs.readFileSync(scanF, "utf8").replace(/^﻿/, ""));
    withPacked.push({ id: ID2, title: "Packed Game", platform: "Nintendo 64", rom: packed, added: new Date().toISOString() });
    fs.writeFileSync(scanF, JSON.stringify(withPacked));
    // What a start of the game names as RetroArch's temp folder (null: nothing, RetroArch's own setting stands), with one line added to its settings.
    const tempOf = async (id, line, extra) => {
      fs.writeFileSync(cfgF, cfgWas + line + "\n");
      const dry = await api("api/launch.php", Object.assign({ id: id, dry: true }, extra || {}));
      const at = (dry.append || []).find((l) => /^cache_directory = /.test(l));
      return { ok: dry.ok === true, dir: at ? at.replace(/^cache_directory = "(.*)"$/, "$1") : null, dry: dry };
    };
    const gone = 'cache_directory = "' + path.join(DATA, "fixtures", "no-such-temp") + '"';
    const profileTemp = path.join(process.env.USERPROFILE || "", "AppData", "Local", "Temp");
    // Inside LaunchBox's folder the settings are only read, so the folder is this run's. (In a RetroArch of your own the line itself is put right, below.)
    const lbMark1 = path.join(DATA, "fixtures", "LaunchBox.exe");
    fs.writeFileSync(lbMark1, "");
    check("an archive started where RetroArch has no temp folder set is left alone: RetroArch unpacks beside the game",
      (({ ok, dir }) => [ok, dir])(await tempOf(ID2, "")), [true, null]);
    const lost = await tempOf(ID2, gone);
    check("where its temp folder is not there, the start names one that is, for that run only: nothing of it is saved into RetroArch's settings",
      [lost.ok, lost.dir !== null && fs.existsSync(lost.dir), lost.dir !== path.join(DATA, "fixtures", "no-such-temp"),
       lost.dry.append.includes('config_save_on_exit = "false"'), /^--appendconfig="[^"]*ra-append\.cfg" /.test(lost.dry.args || "")],
      [true, true, true, true, true]);
    const tilde = await tempOf(ID2, 'cache_directory = "~\\AppData\\Local\\Temp"', { assumeNoHome: true });
    check("a temp folder written with ~ is one RetroArch cannot find as Windows starts it: the folder it meant is named by its whole path",
      [tilde.ok, tilde.dir !== null && fs.existsSync(tilde.dir), !fs.existsSync(profileTemp) || String(tilde.dir).toLowerCase() === profileTemp.toLowerCase()],
      [true, true, true]);
    fs.mkdirSync(path.join(ra, "temp"), { recursive: true });
    check("a temp folder RetroArch does find is not named again, and neither is one for a game that is not an archive",
      [(await tempOf(ID2, 'cache_directory = ":\\temp"')).dir, (await tempOf(ID, gone)).dir], [null, null]);
    fs.writeFileSync(infoF, infoWas + 'supported_extensions = "n64|v64|z64|zip"\n');
    check("nor for a core that opens the archive itself", (await tempOf(ID2, gone)).dir, null);
    fs.writeFileSync(infoF, infoWas);
    fs.writeFileSync(cfgF, cfgWas);
    fs.rmSync(lbMark1, { force: true });

    // ---- two lines of RetroArch's settings put right: a command port Windows has set aside, a temp folder it cannot find ----
    // Windows is not asked to set a port aside: the answer is told which block it has (assumeAside), and every other port is tried for real.
    const fixed = (extra) => api("api/retroarch.php", Object.assign({ assumeAside: [[55348, 55447]] }, extra));
    const broken = cfgWas + 'network_cmd_port = "55355"\ncache_directory = "~\\AppData\\Local\\Temp"\nvideo_fullscreen = "true"\n';
    const keptDirCfg = path.join(DATA, "retroarch-cfg-kept");
    const keptNow = () => (fs.existsSync(keptDirCfg) ? fs.readdirSync(keptDirCfg).sort() : []);
    const keptWas = keptNow();          // the copy of data\ may bring real kept files along
    fs.writeFileSync(cfgF, broken);
    const look = await fixed({ fix: "look", assumeNoHome: true });
    const portOf = (res) => Number((((res || {}).faults || []).find((f) => f.key === "network_cmd_port") || {}).now || 0);
    if (!look.ok || path.dirname(String(look.exe || "")).toLowerCase() !== ra.toLowerCase()) {
      console.log("    (the library's RetroArch is not the stand-in here: its settings are not written, and the command-port fix is not checked)");
    } else if (look.how === "run" && /RetroArch is open/.test(look.why || "")) {
      console.log("    (a RetroArch is open on this PC, so no settings file may be written: the command-port fix is not checked)");
    } else {
      const newPort = portOf(look);
      check("a look finds both lines, says what would put each right and where, and writes nothing",
        [look.faults.map((f) => [f.key, f.was]), newPort > 1024 && (newPort < 55348 || newPort > 55447), look.how, fs.readFileSync(cfgF, "utf8") === broken, keptNow()],
        [[["network_cmd_port", "55355"], ["cache_directory", "~\\AppData\\Local\\Temp"]], true, "settings", true, keptWas]);
      const dryCan = await api("api/launch.php", { id: ID, dry: true, assumeAside: [[55348, 55447]], assumeNoHome: true });
      check("a start of a RetroArch that may be written asks on the port it would be given, with nothing appended for it: a dry start only looks",
        [dryCan.asks === portOf(dryCan.raFix), (dryCan.raFix || {}).how, (dryCan.append || []).some((l) => /^(network_cmd_port|cache_directory) = /.test(l)), fs.readFileSync(cfgF, "utf8") === broken],
        [true, "settings", false, true]);
      const done = await fixed({ fix: true, assumeNoHome: true });
      const wrote = fs.readFileSync(cfgF, "utf8");
      const tempNow = (((done.faults || []).find((f) => f.key === "cache_directory") || {}).now) || "";
      check("the fix writes those two lines and no other byte, and keeps the file as it was",
        [done.how, wrote === cfgWas + 'network_cmd_port = "' + portOf(done) + '"\ncache_directory = "' + tempNow + '"\nvideo_fullscreen = "true"\n',
         tempNow !== "" && fs.existsSync(tempNow), !!done.kept && fs.readFileSync(done.kept, "utf8") === broken, path.dirname(String(done.kept || "")).toLowerCase() === keptDirCfg.toLowerCase()],
        ["settings", true, true, true, true]);
      const logs = fs.readdirSync(path.join(DATA, "log")).filter((f) => /^\d{4}-\d\d-\d\d\.log$/.test(f)).map((f) => fs.readFileSync(path.join(DATA, "log", f), "utf8")).join("\n");
      check("the log says what was changed, why, and where the old file is",
        [/S RA\s+retroarch\.cfg: network_cmd_port was "55355" and is now "\d+" \(Windows has port 55355 set aside[^)]*\); the file as it was is kept as /.test(logs),
         /S RA\s+retroarch\.cfg: cache_directory was "~/.test(logs)], [true, true]);
      const after = await fixed({ fix: true });
      check("after it there is nothing left to put right, and a start asks RetroArch on the port now in its settings",
        [after.faults, after.how, (await api("api/launch.php", { id: ID, dry: true, assumeAside: [[55348, 55447]] })).asks, fs.readFileSync(cfgF, "utf8") === wrote],
        [[], null, portOf(done), true]);
      // A line that is not there is added at the end, and a port that opens is left alone.
      fs.writeFileSync(cfgF, cfgWas);
      const added = await fixed({ fix: true });
      check("with no port line at all, RetroArch's own default is the one looked at, and the line is added at the end",
        [added.how, fs.readFileSync(cfgF, "utf8") === cfgWas + 'network_cmd_port = "' + portOf(added) + '"\n'], ["settings", true]);
      fs.writeFileSync(cfgF, cfgWas + 'network_cmd_port = "' + portOf(done) + '"\n');
      check("a port RetroArch can open is not touched", (({ faults, how }) => [faults, how])(await fixed({ fix: true })), [[], null]);
      // Inside LaunchBox's folder the file is read only: the start is given the port for that run.
      fs.writeFileSync(cfgF, broken);
      const lbMark2 = path.join(DATA, "fixtures", "LaunchBox.exe");
      fs.writeFileSync(lbMark2, "");
      const inLb2 = await fixed({ fix: true, assumeNoHome: true });
      const dryLb = await api("api/launch.php", { id: ID, dry: true, assumeAside: [[55348, 55447]], assumeNoHome: true });
      check("a RetroArch inside LaunchBox's folder is never written: it says why, and a start gives RetroArch the port for that run alone",
        [inLb2.how, /inside a folder Xsegon (only reads|never writes to)/.test(inLb2.why || ""), fs.readFileSync(cfgF, "utf8") === broken,
         (dryLb.append || []).includes('network_cmd_port = "' + portOf(inLb2) + '"'), (dryLb.append || []).includes('config_save_on_exit = "false"'), dryLb.asks === portOf(inLb2)],
        ["run", true, true, true, true, true]);
      fs.rmSync(lbMark2, { force: true });
    }
    fs.writeFileSync(cfgF, cfgWas);
    for (const f of keptNow()) { if (!keptWas.includes(f)) { fs.rmSync(path.join(keptDirCfg, f), { force: true }); } }

    const all = (await api("api/library.php?grouped=0")).games || [];
    const mine = all.find((g) => g.local);
    if (mine) {
      check("a game of your own keeps its own saves, and is told so", /keeps its own saves/.test((await ask(mine.id)).none || ""), true);
    }

    // ---- PCSX2: its save states by the game's code, and its memory cards ----
    const prog = Object.keys(table.programs || {}).find((k) => /^pcsx2[^\\/]*\.exe$/i.test(path.basename(String(table.programs[k].exe || ""))));
    let ps2 = null, rom = null;
    for (const g of all.filter((x) => /playstation 2/i.test(x.platform)).slice(0, 6)) {
      const dry = await api("api/launch.php", { id: g.id, dry: true });
      const m = dry.ok && /pcsx2/i.test(String(dry.exe || "")) ? /"([^"]+)"\s*$/.exec(String(dry.args || "")) : null;
      if (m) { ps2 = g; rom = m[1]; break; }
    }
    if (!prog || !ps2) {
      console.log("    (no PCSX2 game can be started here: PCSX2's saves are not checked)");
    } else {
      const make = (opts) => {
        pcsx2Fixture(ps2Dir, rom, opts);
        fs.appendFileSync(path.join(ps2Dir, "inis", "PCSX2.ini"),
          "\n[Folders]\nSavestates = sstates\nMemoryCards = memcards\nCache = cache\nCheats = cheats\n\n[MemoryCards]\nSlot1_Enable = true\nSlot1_Filename = Mcd001.ps2\nSlot2_Enable = false\nSlot2_Filename = Mcd002.ps2\n");
        put(path.join(ps2Dir, "sstates", "SLUS-99999 (ABCD1234).01.p2s"), "slot one", 9);
        put(path.join(ps2Dir, "sstates", "SLUS-99999 (ABCD1234).01.p2s.backup"), "the one before it", 12);
        put(path.join(ps2Dir, "sstates", "SLUS-99999 (ABCD1234).resume.p2s"), "on closing", 8);
        put(path.join(ps2Dir, "sstates", "SLUS-11111 (11111111).00.p2s"), "another game's", 8);
        put(path.join(ps2Dir, "memcards", "Mcd001.ps2"), "card one", 4);
        put(path.join(ps2Dir, "memcards", "Mcd002.ps2"), "card two, not in", 4);
      };
      make({ global: false, own: true });
      table.programs[prog].exe = path.join(ps2Dir, "pcsx2-qt.exe");
      fs.writeFileSync(tableF, JSON.stringify(table));
      const p = await ask(ps2.id);
      check("a PCSX2 game lists PCSX2's own save states, by the game's code: its slots and its save on closing, not another game's, not a backup",
        said(group(p, "states").rows), [["PCSX2's save on closing", "SLUS-99999 (ABCD1234).resume.p2s", false], ["Slot 1", "SLUS-99999 (ABCD1234).01.p2s", false]]);
      check("and the memory cards that are in, which every PS2 game shares and which are not counted as this game's",
        [said(group(p, "cards").rows), /every PS2 game shares/.test(group(p, "cards").help), group(p, "states").rows.length + group(p, "beside").rows.length === p.count],
        [[["Memory card 1", "Mcd001.ps2", false]], true, true]);
      for (const f of fs.readdirSync(path.join(ps2Dir, "sstates"))) { if (/^SLUS-99999/.test(f)) { fs.rmSync(path.join(ps2Dir, "sstates", f)); } }
      check("with no save state for the game it says so, the cards still listed",
        (({ none: n, groups }) => [/PCSX2 has no save state for this game yet/.test(n || ""), groups.some((g) => g.key === "cards")])(await ask(ps2.id)), [true, true]);
      make({ global: false, own: true, torn: true });
      check("a game list cache that does not read whole is not guessed at: no state is called this game's",
        (({ none: n, groups }) => [/has not listed this game yet/.test(n || ""), groups.some((g) => g.key === "states")])(await ask(ps2.id)), [true, false]);
    }
    check("no script errors through any of it", await b.ev(`(window.__errs || []).length`), 0);
  } finally {
    fs.writeFileSync(tableF, tableWas);
    fs.writeFileSync(scanF, scanWas);
    for (const d of [ra, path.join(DATA, "fixtures", "saves-roms"), ps2Dir, path.join(DATA, "saves-kept"), path.join(DATA, "fixtures", "LaunchBox.exe")]) { fs.rmSync(d, { recursive: true, force: true }); }
    await sleep(50);
  }
};
