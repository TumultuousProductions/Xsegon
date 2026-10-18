/* Cheats: RetroArch's .cht files chosen per game and staged at launch.
 * RetroArch loads <cheat_database_path>\<core name>\<rom name>.cht by itself,
 * and applies it when apply_cheats_after_load is on.
 *
 * The check that matters most: nothing is written into the emulator itself. A
 * launch with cheats repoints RetroArch's cheat folder at Xsegon's own and
 * switches config_save_on_exit off for that run, or the appended values are
 * written back into retroarch.cfg when the game closes. Each of the three
 * lines has a check by name.
 *
 * Nothing is launched: api\launch.php answers with "dry": true.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, DATA, sleep } = require("./lib");

const gamesOn = async (platform) =>
  (await api("api/library.php?platform=" + encodeURIComponent(platform))).games || [];

/* A game's details open on the row it stands on: chosen through the page's
   own state, then the key a person presses. */
async function detailsOf(b, id) {
  const there = await b.ev(`import("/js/state.js").then((S) => { const i = S.games.findIndex((g) => g.id === ${JSON.stringify(id)}); if (i >= 0) { S.setSel(i); } return i >= 0; })`);
  if (!there) { return false; }
  await b.key("i");
  return b.waitFor(`!document.getElementById("details").hidden && !!document.querySelector("#details .dtabs")`, 8000);
}
const TABS = `[...document.querySelectorAll("#details .dtabs .dtab")]`;
// What is open: a part of More (File check, Notes) when More is, else the tab.
const tabOn = `(t => (t ? t.textContent : null))([...document.querySelectorAll("#details .dparts:not([hidden]) .dtab")].find((x) => x.classList.contains("on")) || ${TABS}.find((x) => x.classList.contains("on")))`;
const legend = `[...document.querySelectorAll("#help .hitem .hl")].map((x) => x.textContent)`;
// Media and Saves stand between About and Cheats; Saves, Texture packs and Files carry counts of the game's own, so they are named without them.
const tabNames = `${TABS}.map((x) => (/^Saves/.test(x.textContent) ? "Saves" : /^Texture packs/.test(x.textContent) ? "Texture packs" : /^Files/.test(x.textContent) ? "Files" : x.textContent))`;
const onMedia = `${tabOn} === "Media"`;
const onSaves = `/^Saves/.test(${tabOn} || "")`;
const onFile = `${tabOn} === "File check"`;

/* The tabs of a game's details on a RetroArch game: About as it was, and
   Cheats holding the picker itself, with the keys and the pad. */
async function detailTabsOnAGame(b, check, sf) {
  await api("api/cheats.php", { id: sf.id, clear: true });
  await b.goto();
  await b.setView("list");
  await b.openPlatform("Nintendo 64");
  check("(the game's details open)", await detailsOf(b, sf.id), true);
  check("details has a row of tabs under Back and Play, About first and open",
    await b.ev(`[${tabNames}, ${tabOn}, document.querySelector("#details .dright .bar").nextElementSibling.className, document.querySelector("#details .dtab-pane").className]`),
    [["About", "Media", "Saves", "Cheats", "Hacks", "Achievements", "Texture packs", "Files", "More"], "About", "dtabs", "dtab-pane is-about"]);
  check("and the legend names the keys for them", await b.until(`${legend}.includes("tabs")`, true), true);
  check("the open tab's words can be read: they are not the colour of the tab",
    await b.ev(`(s => s.color !== s.backgroundColor)(getComputedStyle(${TABS}.find((x) => x.classList.contains("on"))))`), true);
  await b.shot("details-tab-about");
  // The description (js\details.js): made longer than its box, the window made the user's own size, so its
  // size is followed and it drifts; it ends above the legend and the strip (js\detailfit.js); the wheel takes it over.
  if (await b.ev(`!!document.querySelector("#details .notes-inner") && !document.body.classList.contains("no-anim") && !matchMedia("(prefers-reduced-motion: reduce)").matches`)) {
    await b.ev(`document.querySelector("#details .notes-inner").textContent += " " + "A line of words to read, again and again. ".repeat(300)`);
    await b.send("Emulation.setDeviceMetricsOverride", { width: 1536, height: 960, deviceScaleFactor: 1.25, mobile: false });
    try {
      check("a description longer than its box drifts, measured as its box changes size",
        await b.until(`document.querySelector("#details .notes-box").classList.contains("notes-auto")`, true, 4000), true);
      check("and it ends above the legend and the strip, wherever it begins",
        await b.until(`(x => Math.round(x.getBoundingClientRect().bottom) <= innerHeight - parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--foot-h")))(document.querySelector("#details .notes-box"))`, true, 4000), true);
      check("the wheel takes it over by hand from where it stands, with its bar",
        await b.ev(`(x => { x.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }));
          return [x.classList.contains("by-hand"), x.classList.contains("notes-auto"), x.scrollTop > 0, x.offsetWidth - x.clientWidth >= 10]; })(document.querySelector("#details .notes-box"))`),
        [true, false, true, true]);
    } finally {
      await b.send("Emulation.clearDeviceMetricsOverride");
    }
  } else {
    check("(no description here, or animations are off: the drift is not looked at)", true);
  }

  await b.key("ArrowRight");
  check("Right opens the next tab, Media", await b.until(onMedia, true), true);
  await b.key("ArrowRight");
  check("Right again opens Saves", await b.until(onSaves, true), true);
  await b.key("ArrowRight");
  check("and once more opens Cheats, and the picker stands in the tab: no panel, no title, no Cancel",
    [await b.waitFor(`document.querySelectorAll("#details .dtab-pane.is-cheats .ch-list .cr-row").length > 3`, 9000), await b.ev(tabOn),
     await b.ev(`document.getElementById("editor").hidden`), await b.ev(`!!document.querySelector("#details .panel-title")`),
     await b.ev(`[...document.querySelectorAll("#details .dtab-pane button")].some((x) => /Cancel/.test(x.textContent))`)],
    [true, "Cheats", true, false, false]);
  check("the file it chose heads the list, as in the picker",
    await b.ev(`/Star Fox 64 \\(USA\\) \\(Rev 1\\)/.test(document.querySelector("#details .ch-list .cr-row").textContent)`), true);
  check("no row wears the bar until the keys are in the list, and the legend offers the way in",
    [await b.ev(`getComputedStyle(document.querySelector("#details .ch-list .cr-row.sel")).backgroundImage`), await b.until(`${legend}.includes("the list")`, true)], ["none", true]);

  // Down goes into the list, and Enter there selects: it does not play.
  await b.key("ArrowDown");
  check("Down goes into the list: the bar is on its first row and the legend changes",
    [await b.until(`document.querySelector("#details .dtab-pane").classList.contains("in")`, true),
     await b.ev(`[...document.querySelectorAll("#details .ch-list .cr-row")].findIndex((x) => x.classList.contains("sel"))`),
     await b.until(`${legend}.includes("back to the tabs")`, true)], [true, 0, true]);
  await b.key("ArrowDown"); await b.key("ArrowDown"); await b.settled();
  const onRow = await b.ev(`(document.querySelector("#details .ch-list .cr-row.sel") || {}).textContent`);
  const launches = (await b.ev(`(window.__launches || []).length`)) || 0;
  await b.key("Enter");
  check("Enter selects the cheat the bar is on, and starts no game",
    [await b.until(`(n => n ? n.textContent : null)(document.querySelector("#details .ch-list .cr-row.on"))`, onRow), await b.ev(`(window.__launches || []).length`),
     await b.ev(`document.getElementById("details").hidden`)], [onRow, launches, false]);
  await b.shot("details-tab-cheats");

  // That press is the saving: no Save row, the tab stays, and says how many.
  const factOn = (words) => `[...document.querySelectorAll("#details .dleft > dl dt")].some((d) => d.textContent === "cheats" && d.nextElementSibling.textContent === ${JSON.stringify(words)})`;
  const kept = async () => ((await api("api/cheats.php?id=" + encodeURIComponent(sf.id))).chosen || { on: [] }).on.map((c) => c.desc);
  check("the press itself keeps it: the tab counts the cheat, as the facts beside it do, and the server has it",
    [await b.until(tabOn, "Cheats (1)", 9000), await b.until(factOn("1 cheat on"), true, 6000), await kept()], ["Cheats (1)", true, [onRow]]);
  check("with no Save row to press, the list where it was, and the bar still on that cheat",
    [await b.ev(`!!document.querySelector("#details .ch-list .ch-save")`),
     await b.ev(`(document.querySelector("#details .ch-list .cr-row.sel") || {}).textContent`),
     await b.ev(`(document.querySelector("#details .ch-list .ch-clear .cr-tag") || {}).textContent`)], [false, onRow, "1 on"]);
  check("a launch straight from there plays with it", ((await api("api/launch.php", { id: sf.id, dry: true })).cheats || {}).on, 1);
  await b.key("ArrowDown");
  const second = await b.ev(`(document.querySelector("#details .ch-list .cr-row.sel") || {}).textContent`);
  await b.key("Enter");
  check("a second press is kept beside the first", [await b.until(tabOn, "Cheats (2)", 9000), (await kept()).sort()], ["Cheats (2)", [onRow, second].sort()]);
  await b.key("Enter");
  check("and a press on one that is on turns that one off", [await b.until(tabOn, "Cheats (1)", 9000), await kept(), await b.until(factOn("1 cheat on"), true, 6000)], ["Cheats (1)", [onRow], true]);
  await b.ev(`document.querySelector("#details .ch-list .ch-clear").click()`);
  // With none on, the fact beside it says how many there are to choose from (api\game.php cheatsThere).
  check("the row above turns them all off: no count on the tab, the fact beside it back to what there is to choose from, nothing on the server",
    [await b.until(tabOn, "Cheats", 9000), await b.until(`[...document.querySelectorAll("#details .dleft > dl dt")].some((d) => d.textContent === "cheats" && / to choose from$/.test(d.nextElementSibling.textContent))`, true, 6000), await kept(),
     await b.until(`(document.querySelector("#details .ch-list .ch-clear .cr-name") || {}).textContent`, "No cheat is on", 6000)], ["Cheats", true, [], "No cheat is on"]);
  await b.ev(`[...document.querySelectorAll("#details .ch-list .cr-row")].find((x) => x.textContent === ${JSON.stringify(onRow)}).click()`);
  await b.until(tabOn, "Cheats (1)", 9000);
  await b.key("Escape");
  await b.until(`document.querySelector("#details .dtab-pane").classList.contains("in")`, false);

  // Esc comes out of the list first, then out of details.
  await b.key("ArrowDown");
  await b.until(`document.querySelector("#details .dtab-pane").classList.contains("in")`, true);
  await b.key("Escape");
  check("Esc in the list goes back to the tabs, details still up",
    [await b.until(`document.querySelector("#details .dtab-pane").classList.contains("in")`, false), await b.ev(`document.getElementById("details").hidden`)], [false, false]);
  await b.key("ArrowLeft");
  await b.until(onSaves, true);
  await b.key("ArrowLeft");
  await b.until(onMedia, true);
  await b.key("ArrowLeft");
  check("Left goes back tab by tab to About, with the words as they were",
    [await b.until(tabOn, "About"), await b.ev(`document.querySelector("#details .dtab-pane").className`)], ["About", "dtab-pane is-about"]);
  await b.key("ArrowRight");
  await b.until(onMedia, true);
  await b.key("ArrowRight");
  await b.until(onSaves, true);
  await b.key("ArrowRight");
  await b.until(tabOn, "Cheats (1)");
  await b.key("Escape");
  check("Esc at the tabs closes details", await b.until(`document.getElementById("details").hidden`, true), true);
  check("(details open again)", await detailsOf(b, sf.id), true);
  check("and the next time details opens on About", await b.ev(tabOn), "About");

  /* The pad: LB and RB change tab, the cross goes into the list without moving
     the game chosen behind the panel, B comes out of the list, then closes details. */
  const chosen = `import("/js/state.js").then((S) => S.sel)`;
  const was = await b.ev(chosen);
  await b.ev(`window.__dtWas = navigator.getGamepads; window.__dtPad = { id: "stand-in", mapping: "standard", connected: true, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }; navigator.getGamepads = () => [window.__dtPad]`);
  const press = async (n) => { await b.ev(`window.__dtPad.buttons[${n}].pressed = true`); await sleep(120); await b.ev(`window.__dtPad.buttons[${n}].pressed = false`); await sleep(120); };
  try {
    await press(13);                                       // down, on About: nothing to go into
    check("the cross over details does not move the game chosen behind it", await b.ev(chosen), was);
    await press(5);
    await b.until(onMedia, true);
    await press(5);
    await b.until(onSaves, true);
    await press(5);
    check("RB opens the next tab, and the ones after", await b.until(tabOn, "Cheats (1)"), "Cheats (1)");
    await b.waitFor(`document.querySelectorAll("#details .dtab-pane.is-cheats .ch-list .cr-row").length > 3`, 9000);
    await press(13);
    check("the cross goes down into its list", await b.until(`document.querySelector("#details .dtab-pane").classList.contains("in")`, true), true);
    check("where the legend speaks pad", await b.until(`[...document.querySelectorAll("#help .hitem")].some((h) => h.querySelector(".hl").textContent === "back to the tabs")`, true), true);
    await press(1);
    check("B comes out of the list, details still up",
      [await b.until(`document.querySelector("#details .dtab-pane").classList.contains("in")`, false), await b.ev(`document.getElementById("details").hidden`)], [false, false]);
    await press(4);
    await b.until(onSaves, true);
    await press(4);
    await b.until(onMedia, true);
    await press(4);
    check("LB goes back, a tab a press", await b.until(tabOn, "About"), "About");
    await press(1);
    check("and B at the tabs closes details, as it did", await b.until(`document.getElementById("details").hidden`, true), true);
  } finally {
    await b.ev(`navigator.getGamepads = window.__dtWas`);
    await b.key("Shift");                                  // the legend goes back to the keys
    await api("api/cheats.php", { id: sf.id, clear: true });
  }
}

/* A standalone emulator's own cheats, read and never written (includes\emucheats.php).
   A stand-in portable PCSX2: a game list cache naming one of the library's PS2 files,
   a .pnach and the game's own settings. The emulator table points at it meanwhile. */
function pcsx2Fixture(dir, rom, opts) {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const d of ["inis", "cache", "cheats", "gamesettings"]) { fs.mkdirSync(path.join(dir, d), { recursive: true }); }
  fs.writeFileSync(path.join(dir, "pcsx2-qt.exe"), "");
  fs.writeFileSync(path.join(dir, "portable.ini"), "");
  fs.writeFileSync(path.join(dir, "inis", "PCSX2.ini"), "[Folders]\nCheats = cheats\nCache = cache\n\n[EmuCore]\nEnableCheats = " + (opts.global ? "true" : "false") + "\n");
  const str = (s) => { const b = Buffer.from(s, "utf8"), n = Buffer.alloc(4); n.writeUInt32LE(b.length); return Buffer.concat([n, b]); };
  const entry = (file, serial, crc) => {
    const tail = Buffer.alloc(23);                         // type, region, size, changed, code, rating
    tail.writeUInt32LE(crc, 18);
    return Buffer.concat([str(file), str(serial), str("A Game"), str("Game, A"), str("A Game"), tail]);
  };
  const head = Buffer.alloc(8); head.write("GLCE", 0, "latin1"); head.writeUInt32LE(34, 4);
  let cache = Buffer.concat([head, entry("Z:\\elsewhere\\Another (USA).iso", "SLUS-11111", 0x11111111), entry(rom, "SLUS-99999", 0xABCD1234)]);
  if (opts.torn) { cache = cache.subarray(0, cache.length - 1); }
  fs.writeFileSync(path.join(dir, "cache", "gamelist.cache"), cache);
  fs.writeFileSync(path.join(dir, "cheats", "ABCD1234.pnach"),
    "gametitle=A Game\n\n[Infinite Health]\nauthor=One\ndescription=\npatch=1,EE,20100000,extended,00000001\n\n"
    + "[Max Money]\nauthor=Two\ndescription=All the money, 50% off included\npatch=1,EE,20100004,extended,0098967F\n\n"
    + "[Infinite Health]\nauthor=Three\ndescription=\npatch=1,EE,EE100000,extended,51B6D565\n\n"
    + "[All Stages]\nauthor=One\ndescription=\npatch=1,EE,20100008,extended,FFFFFFFF\n");
  fs.writeFileSync(path.join(dir, "cheats", "11111111.pnach"), "[Another Game's]\npatch=1,EE,20100000,extended,00000001\n");
  fs.writeFileSync(path.join(dir, "gamesettings", "SLUS-99999_ABCD1234.ini"),
    (opts.own === undefined ? "" : "[EmuCore]\nEnableCheats = " + (opts.own ? "true" : "false") + "\n\n")
    + "[Cheats]\nEnable = All Stages\nEnable = Infinite Health\nEnable = One That Is Gone\n");
}
const filesOf = (dir) => fs.readdirSync(dir, { recursive: true }).map((f) => String(f)).sort()
  .map((f) => f + ":" + (fs.statSync(path.join(dir, f)).isFile() ? fs.statSync(path.join(dir, f)).mtimeMs + "/" + fs.statSync(path.join(dir, f)).size : "dir"));

async function emulatorsOwnCheats(b, check) {
  const tableF = path.join(DATA, "emulators.json");
  const table = JSON.parse(fs.readFileSync(tableF, "utf8").replace(/^\uFEFF/, ""));
  const prog = Object.keys(table.programs || {}).find((k) => /^pcsx2[^\\/]*\.exe$/i.test(path.basename(String(table.programs[k].exe || ""))));
  const all = (await api("api/library.php?grouped=0")).games || [];
  let ps2 = null, rom = null;
  for (const g of all.filter((x) => /playstation 2/i.test(x.platform)).slice(0, 6)) {
    const dry = await api("api/launch.php", { id: g.id, dry: true });
    const m = dry.ok && /pcsx2/i.test(String(dry.exe || "")) ? /"([^"]+)"\s*$/.exec(String(dry.args || "")) : null;
    if (m) { ps2 = g; rom = m[1]; break; }
  }
  if (!prog || !ps2) {
    console.log("    (no PCSX2 game can be started here: an emulator's own cheats are not checked)");
    return;
  }
  const dir = path.join(DATA, "fixtures", "pcsx2");
  const was = fs.readFileSync(tableF);
  const ask = () => api("api/cheats.php?id=" + encodeURIComponent(ps2.id));
  try {
    pcsx2Fixture(dir, rom, { global: false, own: true });
    table.programs[prog].exe = path.join(dir, "pcsx2-qt.exe");
    fs.writeFileSync(tableF, JSON.stringify(table));
    const before = filesOf(dir);

    const got = await ask();
    const emu = got.emu || { cheats: [] };
    check("a PCSX2 game offers no RetroArch files, and its own emulator's cheats instead",
      [(got.files || []).length, emu.emulator, emu.why, emu.file], [0, "PCSX2", null, "cheats\\ABCD1234.pnach"]);
    check("read from the game's own files: the ones that are on first, a name once however many times the file has it, and another game's left out",
      emu.cheats.map((c) => [c.name, c.on, c.copies, c.author]),
      [["Infinite Health", true, 2, "One"], ["All Stages", true, 1, "One"], ["Max Money", false, 1, "Two"]]);
    check("counted, with the game's own switch read before PCSX2's general one", [emu.enabled, emu.on], [true, 2]);
    check("and the game's full record carries the count for the tab", (await api("api/game.php?id=" + encodeURIComponent(ps2.id))).game.emuCheats, 2);
    check("the picker's sentence for such a game points at the tab", /PCSX2's own are listed in this game's details, under Cheats/.test(got.why || ""), true);

    // ---- the tab, in the page: a list to look at ----
    await b.goto();
    await b.setView("list");
    await b.openPlatform(ps2.platform);
    check("(the PCSX2 game's details open)", await detailsOf(b, ps2.id), true);
    check("its Cheats tab counts what PCSX2 has on", await b.until(tabNames, ["About", "Media", "Saves", "Cheats (2)", "Hacks", "Texture packs", "Files", "More"], 8000), ["About", "Media", "Saves", "Cheats (2)", "Hacks", "Texture packs", "Files", "More"]);
    await b.key("ArrowRight");
    await b.until(onMedia, true);
    await b.key("ArrowRight");
    await b.until(onSaves, true);
    await b.key("f");
    check("a disc game's File check, under More, says in a sentence why there is nothing to check",
      [await b.until(onFile, true), await b.until(`/cartridge consoles only for now, and .*Playstation 2 is not one of them/.test((document.querySelector("#details .dtab-pane.is-filecheck .cr-none") || {}).textContent || "")`, true, 6000)], [true, true]);
    await b.clickSel(`#details .dtab[data-tab="cheats"]`);
    const rowsNow = `[...document.querySelectorAll("#details .dtab-pane.is-cheats .ch-list .cr-row")].map((r) => [r.querySelector(".cr-name").textContent, r.classList.contains("on"), r.classList.contains("ro")])`;
    check("and lists them, the ones that are on marked, none of them a switch",
      await b.until(rowsNow, [["Infinite Health", true, true], ["All Stages", true, true], ["Max Money", false, true]], 9000),
      [["Infinite Health", true, true], ["All Stages", true, true], ["Max Money", false, true]]);
    check("saying whose they are, where they were read from, and where they are switched",
      await b.ev(`(t => [/2 cheats are on for this game in PCSX2/.test(t), /read from cheats.ABCD1234\\.pnach/.test(t), /does not change them/.test(t), /Properties > Cheats/.test(t)])(document.querySelector("#details .dtab-pane .group-help").textContent)`),
      [true, true, true, true]);
    check("in a box no taller than its three rows", await b.ev(`document.querySelector("#details .dtab-pane .ch-list").getBoundingClientRect().height < 200`), true);
    await b.shot("details-tab-cheats-pcsx2");
    await b.ev(`document.querySelectorAll("#details .dtab-pane .ch-list .cr-row")[2].click()`);
    await b.key("ArrowDown"); await b.key("ArrowDown"); await b.key("Enter");
    await sleep(300);
    check("in that list the legend offers moving and the way back, and no selecting",
      await b.ev(`(l => [l.includes("move"), l.includes("back to the tabs"), l.includes("select")])(${legend})`), [true, true, false]);
    check("a press on one changes nothing, by the mouse or by Enter", [await b.ev(rowsNow + ".map((r) => r[1])"), await b.ev(`document.getElementById("details").hidden`)], [[true, true, false], false]);
    await b.ev(`(() => { const f = document.querySelector("#details .dtab-pane .ch-find input"); f.value = "50%"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    check("the find box looks in the names and what they say",
      await b.until(`[...document.querySelectorAll("#details .dtab-pane .ch-list .cr-row .cr-name")].map((x) => x.textContent)`, ["Max Money"], 4000), ["Max Money"]);
    await b.key("Escape"); await b.key("Escape");
    await b.until(`document.getElementById("details").hidden`, true);
    check("nothing in the emulator's folder was written or touched by any of it", filesOf(dir), before);

    // ---- the answers that are not a list ----
    pcsx2Fixture(dir, rom, { global: true });
    check("with no switch of the game's own, PCSX2's general one decides", [(await ask()).emu.enabled, (await ask()).emu.on], [true, 2]);
    pcsx2Fixture(dir, rom, { global: true, own: false });
    check("cheats switched off for the game: listed, none of them on", (({ enabled, on, cheats }) => [enabled, on, cheats.length])((await ask()).emu), [false, 0, 3]);
    fs.rmSync(path.join(dir, "cheats", "ABCD1234.pnach"));
    check("no cheat file for the game says so, naming the file that would be one",
      /PCSX2 has no cheat file for this game\. One would be .*cheats.ABCD1234\.pnach$/.test((await ask()).emu.why || ""), true);
    pcsx2Fixture(dir, rom, { global: true, own: true, torn: true });
    check("a game list cache that does not read whole is not guessed at", /has not listed this game yet/.test((await ask()).emu.why || ""), true);
    pcsx2Fixture(dir, "Z:\\somewhere\\else.iso", { global: true, own: true });
    check("and a game PCSX2 has not listed says how to get it listed", /Open PCSX2 once with this game in its list/.test((await ask()).emu.why || ""), true);
  } finally {
    fs.writeFileSync(tableF, was);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = async function (b, check) {
  // ---- which file belongs to which game -------------------------------
  const n64 = await gamesOn("Nintendo 64");
  const sf = n64.find((g) => /^Star Fox 64/.test(g.title));
  check("the library has the game the naming rule is proved on", !!sf);

  const offer = await api("api/cheats.php?id=" + encodeURIComponent(sf.id));
  check("it offers cheat files", offer.ok && offer.files.length > 1);
  check("every file it offers is a .cht in a database folder",
    offer.files.every((f) => /^[^/]+\/.+\.cht$/.test(f.file)));
  check("each one says how many cheats are in it", offer.files.every((f) => f.cheats > 0));

  /* The ROM is "Star Fox 64 (USA) (Rev 1).zip" and a cheat file has exactly that
     name; the title alone would pick one of four others, of the wrong region or revision. */
  check("the file named like the ROM is offered first",
    offer.files[0].name, "Star Fox 64 (USA) (Rev 1)");
  check("and is marked as such", offer.files[0].score, 3);
  check("the others are still offered, not dropped", offer.files.length >= 4);

  // ---- reading one file, in pages ---------------------------------------
  // Nothing on and nothing once on (data\cheats-used.json), so the file's own order comes back.
  await api("api/cheats.php", { id: sf.id, clear: true });
  fs.rmSync(path.join(DATA, "cheats-used.json"), { force: true });
  const file = offer.files[0].file;
  const page = await api("api/cheats.php?id=" + encodeURIComponent(sf.id)
    + "&file=" + encodeURIComponent(file));
  check("a page of cheats comes back", page.ok && page.cheats.length > 0);
  check("a page is capped rather than sent whole", page.cheats.length <= 200);
  check("and it says how many there are altogether", page.whole > 200);
  check("every row has a number and a description",
    page.cheats.every((c) => typeof c.i === "number" && typeof c.desc === "string"));
  // The codes are not sent: they make the big files heavy and say nothing a person can act on.
  check("the codes are not sent", page.cheats.every((c) => c.code === undefined));

  const more = await api("api/cheats.php?id=" + encodeURIComponent(sf.id)
    + "&file=" + encodeURIComponent(file) + "&from=200");
  check("the next page carries on where the first stopped",
    more.ok && more.cheats.length > 0 && more.cheats[0].i > page.cheats[199].i);

  const found = await api("api/cheats.php?id=" + encodeURIComponent(sf.id)
    + "&file=" + encodeURIComponent(file) + "&q=infinite");
  check("the find box narrows it", found.matching > 0 && found.matching < page.whole);
  check("and every row it returns matches",
    found.cheats.every((c) => /infinite/i.test(c.desc)));

  // a file that is not this game's is refused, so the address cannot read the disk
  const bad = await api("api/cheats.php?id=" + encodeURIComponent(sf.id)
    + "&file=" + encodeURIComponent("../../../retroarch.cfg"));
  check("a file this game did not match is refused", bad.ok, false);

  // ---- the biggest file on the machine ----------------------------------
  /* Turok's cheat file holds 30,911 cheats: sent whole it would take the page down.
     Named exactly, since Turok 3's file holds only 166. */
  const turok = n64.find((g) => /^Turok: Dinosaur Hunter/.test(g.title));
  if (turok) {
    const big = await api("api/cheats.php?id=" + encodeURIComponent(turok.id));
    const huge = (big.files || []).find((f) => f.cheats > 10000);
    check("the 30,911 cheat file is found", !!huge);
    if (huge) {
      const p1 = await api("api/cheats.php?id=" + encodeURIComponent(turok.id)
        + "&file=" + encodeURIComponent(huge.file));
      check("and comes back 200 at a time", p1.cheats.length, 200);
      check("saying how many there really are", p1.whole > 10000);
    }
  }

  // ---- choosing, and what a launch then does ----------------------------
  /* What a launch appends with no cheat chosen: nothing on a new copy, or the
     console's own keys and buttons where set, the last line stopping RetroArch saving. */
  await api("api/cheats.php", { id: sf.id, clear: true });
  const own = ((await api("api/launch.php", { id: sf.id, dry: true })).append || []).length;
  const pick = page.cheats.slice(0, 3).map((c) => ({ i: c.i, desc: c.desc }));
  const set = await api("api/cheats.php", { id: sf.id, file: file, on: pick });
  check("the choice is kept", set.ok && set.count === 3);
  check("in a file of Xsegon's own", fs.existsSync(path.join(DATA, "cheats.json")));

  const dry = await api("api/launch.php", { id: sf.id, dry: true });
  check("a launch now stages a cheat file", !!(dry.cheats && dry.cheats.staged));

  // Checked line by line, so a change that drops one says which.
  check("it appends exactly three settings (two where your own keys already stop the saving)", (dry.append || []).length, own ? own + 2 : 3);
  check("it points RetroArch's cheat folder at Xsegon's own",
    // the server's own data folder: the run's copy (tests\sandbox.js), or data\ itself
    dry.append[0] === 'cheat_database_path = "' + require("path").join(require("./lib").DATA, "cheats") + '"');
  check("it turns applying on", dry.append[1], 'apply_cheats_after_load = "true"');
  /* Without this line the two above are written into the person's retroarch.cfg
     when the game closes, because config_save_on_exit is true. */
  check("and it stops RetroArch saving any of it", dry.append[2], 'config_save_on_exit = "false"');
  check("through --appendconfig, at the front of the command",
    /^--appendconfig="[^"]+ra-append\.cfg"/.test(dry.args));

  // the staged file itself
  const staged = dry.cheats.staged;
  check("the staged file is inside data\\", staged.startsWith(DATA));
  check("in a folder named after the core, not the console",
    path.basename(path.dirname(staged)), "Mupen64Plus-Next");
  check("and named after the ROM, which is what RetroArch looks for",
    path.basename(staged), "Star Fox 64 (USA) (Rev 1).cht");

  const body = fs.readFileSync(staged, "utf8");
  check("three cheats are on in it", (body.match(/_enable = "true"/g) || []).length, 3);
  check("and the rest are off", (body.match(/_enable = "false"/g) || []).length, page.whole - 3);
  /* Copied rather than rebuilt: a cheat can carry other keys, and a file rebuilt
     from desc and code alone would lose the search-built ones. */
  check("the rest of the file is left alone", /cheat0_code = "/.test(body));
  check("the header still counts them all", new RegExp("^cheats = " + page.whole, "m").test(body));

  // nothing of the emulator's own was touched
  const lbCheat = path.join(path.dirname(dry.exe), "cheats");
  const before = fs.statSync(lbCheat).mtimeMs;
  await api("api/launch.php", { id: sf.id, dry: true });
  check("RetroArch's own cheat folder is never written", fs.statSync(lbCheat).mtimeMs, before);

  // ---- a stale choice is ignored, not obeyed ----------------------------
  await api("api/cheats.php", {
    id: sf.id, file: file,
    on: [{ i: 999999, desc: "a cheat that was never in this file" }],
  });
  const stale = await api("api/launch.php", { id: sf.id, dry: true });
  check("a choice naming a cheat that is gone launches anyway", stale.ok, true);
  check("with no cheats and no appended settings of theirs", (stale.append || []).length, own);

  // ---- turning them off --------------------------------------------------
  await api("api/cheats.php", { id: sf.id, file: file, on: pick });
  const off = await api("api/cheats.php", { id: sf.id, clear: true });
  check("clearing forgets the choice", off.ok && off.chosen === null);
  const clean = await api("api/launch.php", { id: sf.id, dry: true });
  check("and the next launch appends nothing for cheats at all", (clean.append || []).length, own);
  check("and stages nothing", clean.cheats, null);

  // selecting nothing reads the same as clearing rather than leaving an empty entry
  const none = await api("api/cheats.php", { id: sf.id, file: file, on: [] });
  check("selecting nothing turns cheats off", none.ok && none.chosen === null);

  // ---- the order: on now, then on before, then the rest -----------------
  const order = async (f) => (await api("api/cheats.php?id=" + encodeURIComponent(sf.id) + "&file=" + encodeURIComponent(f || file))).cheats.map((c) => c.i);
  const one = (c) => ({ i: c.i, desc: c.desc });
  const [c0, c40, c150] = [page.cheats[0], page.cheats[40], page.cheats[150]];
  await api("api/cheats.php", { id: sf.id, clear: true });
  fs.rmSync(path.join(DATA, "cheats-used.json"), { force: true });
  await api("api/cheats.php", { id: sf.id, file: file, on: [one(c150)] });
  await api("api/cheats.php", { id: sf.id, file: file, on: [one(c40)] });
  check("the cheat on now comes first, then the one on before, then the rest as the file has them",
    (await order()).slice(0, 3), [c40.i, c150.i, c0.i]);
  await api("api/cheats.php", { id: sf.id, clear: true });
  check("with all of them off, the ones on before still lead, in the file's order", (await order()).slice(0, 3), [c40.i, c150.i, c0.i]);
  await api("api/cheats.php", { id: sf.id, file: file, on: [one(c150)] });
  check("on now goes above on before, even one earlier in the file", (await order()).slice(0, 3), [c150.i, c40.i, c0.i]);
  const rest = await api("api/cheats.php?id=" + encodeURIComponent(sf.id) + "&file=" + encodeURIComponent(file) + "&from=200");
  const both = (await order()).concat(rest.cheats.map((c) => c.i));
  check("the two pages still hold every cheat once", [both.length, new Set(both).size], [page.matching, page.matching]);
  const theirs = await order(offer.files[1].file);
  check("another cheat file of the game keeps its own order", theirs.every((i, k) => k === 0 || i > theirs[k - 1]), true);
  await api("api/cheats.php", { id: sf.id, clear: true });
  fs.rmSync(path.join(DATA, "cheats-used.json"), { force: true });

  // ---- the games with nothing to offer ----------------------------------
  const gc = (await gamesOn("Nintendo GameCube"))[0];
  const notRa = await api("api/cheats.php?id=" + encodeURIComponent(gc.id));
  check("a game not on RetroArch offers no files", (notRa.files || []).length, 0);
  check("and says so naming its own emulator", /Dolphin/.test(notRa.why || ""));

  const hack = (await gamesOn("Nintendo 64")).find((g) => /SM64 Multiplayer|Smash Remix/.test(g.title));
  if (hack) {
    const miss = await api("api/cheats.php?id=" + encodeURIComponent(hack.id));
    check("a ROM hack with no entry says that instead", /database has nothing/.test(miss.why || ""));
  }

  // ---- the screen --------------------------------------------------------
  await b.goto();
  await b.setView("list");
  await b.openPlatform("Nintendo 64");
  const openMenu = `(() => {
    const rows = [...document.querySelectorAll("#view .row")];
    const n = rows.find(r => /Star Fox 64/.test(r.textContent)) || rows[0];
    const r = n.getBoundingClientRect();
    n.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 }));
  })()`;
  await b.ev(openMenu);
  await b.waitFor(`!!document.querySelector(".ctx")`, 3000); await b.settled();
  // Cheats sits in the Emulation group; b.menuDeep opens the group to reach it.
  check("the right-click menu offers Emulation, which holds Cheats",
    await b.ev(`[...document.querySelectorAll(".ctx .ctx-item")].some(n => /Emulation/.test(n.textContent))`));
  await b.menuDeep(/^Cheats/, /Emulation/);
  await b.waitFor(`document.querySelectorAll("#editor .ch-list .cr-row").length > 3`, 9000);

  check("it opens on the cheats screen",
    await b.ev(`(document.querySelector("#editor .panel-title")||{}).textContent`), "CHEATS");
  check("with the file it chose at the top",
    await b.ev(`/Star Fox 64 \\(USA\\) \\(Rev 1\\)/.test(document.querySelector("#editor .ch-list .cr-row").textContent)`));
  check("and the other files one row away",
    await b.ev(`/4 other files/.test(document.querySelector("#editor .ch-list .cr-row").textContent)`));
  check("a page of rows, not all 302",
    await b.ev(`document.querySelectorAll("#editor .ch-list .cr-row").length`) < 210);
  check("the footer says how many there are",
    await b.ev(`/302 cheats in this file/.test(document.querySelector("#editor .mt-note").textContent)`));
  // The screen states the trade, since it changes how the emulator behaves for that run.
  check("and warns that RetroArch will not save settings that run",
    await b.ev(`/not saved/.test(document.querySelector("#editor .mt-note").textContent)`));

  // selecting with the keyboard, which is the only way on a sofa
  await b.key("ArrowDown"); await b.key("ArrowDown"); await b.settled();
  const onRow = await b.ev(`(document.querySelector("#editor .ch-list .cr-row.sel")||{}).textContent`);
  const barAt = `Math.round(document.querySelector("#editor .ch-list .cr-row.sel").getBoundingClientRect().top)`;
  const barWas = await b.ev(barAt);
  await b.key("Enter");
  await b.until(`!!document.querySelector("#editor .ch-list .cr-row.on")`);
  check("Enter selects the row the bar is on",
    await b.ev(`[...document.querySelectorAll("#editor .ch-list .cr-row.on")].map(n => n.textContent)[0]`), onRow);
  // A copy goes under Cheats active at once; the row pressed stays lit, the bar on it, standing where it stood.
  check("the press puts a copy under Cheats active at once, the row pressed staying lit with the bar on it where it stood",
    await b.ev(`[[...document.querySelectorAll("#editor .ch-list .ch-head")].map((h) => h.textContent),
      [...document.querySelectorAll("#editor .ch-list .cr-row.on")].filter((n) => n.textContent === ${JSON.stringify(onRow)}).length,
      document.querySelector("#editor .ch-list .cr-row.sel").textContent, Math.abs(${barAt} - ${barWas}) <= 1]`),
    [["Cheats active", "Other cheats"], 2, onRow, true]);
  /* Selecting is the saving: with a Save row to press as well, cheats were
     selected and the game played with none. */
  check("and that press keeps it, with no Save row to press: the row above counts it and the server has it",
    [await b.until(`(document.querySelector("#editor .ch-list .ch-clear .cr-tag") || {}).textContent`, "1 on", 6000),
     await b.ev(`!!document.querySelector("#editor .ch-list .ch-save")`),
     ((await api("api/cheats.php?id=" + encodeURIComponent(sf.id))).chosen || { on: [] }).on.length,
     await b.ev(`document.getElementById("editor").hidden`)], ["1 on", false, 1, false]);
  check("the window closes with Close, since nothing is left to cancel",
    await b.ev(`[...document.querySelectorAll("#editor .set-head button")].map((x) => x.textContent)`), ["Close (esc)"]);
  check("and the game behind it wears the mark at once", await b.until(`[...document.querySelectorAll("#view .row.cheaton")].some((r) => /Star Fox 64/.test(r.textContent))`, true, 6000), true);

  // the find box, driven by typing rather than by clicking into it
  await b.key("i"); await sleep(120);
  await b.ev(`(() => { const f = document.querySelector("#editor .ch-find input");
    f.value = "infinite"; f.dispatchEvent(new Event("input", {bubbles:true})); return true; })()`);
  await b.until(`/of 302 match/.test(document.querySelector("#editor .mt-note").textContent)`, true, 6000);
  check("typing narrows the list",
    await b.ev(`/of 302 match/.test(document.querySelector("#editor .mt-note").textContent)`));
  check("to the ones that match",
    await b.ev(`[...document.querySelectorAll("#editor .ch-list .cr-row")].slice(2)
      .every(n => /infinite/i.test(n.textContent))`));

  await b.key("Escape");
  await sleep(300);

  // The window lists them in that order: the one on now, the one on before, then the file's first.
  await api("api/cheats.php", { id: sf.id, clear: true });
  fs.rmSync(path.join(DATA, "cheats-used.json"), { force: true });
  await api("api/cheats.php", { id: sf.id, file: file, on: [one(c40)] });
  await api("api/cheats.php", { id: sf.id, file: file, on: [one(c150)] });
  await b.goto();
  await b.setView("list");
  await b.openPlatform("Nintendo 64");
  await b.ev(openMenu);
  await b.waitFor(`!!document.querySelector(".ctx")`, 3000); await b.settled();
  await b.menuDeep(/^Cheats/, /Emulation/);
  await b.waitFor(`document.querySelectorAll("#editor .ch-list .cr-row").length > 3`, 9000);
  check("the window opens with the cheat on now under Cheats active, then the one on before heading the other cheats, each listed once",
    await b.ev(`[[...document.querySelectorAll("#editor .ch-list .cr-row")].slice(2, 5).map((r) => [r.querySelector(".cr-name").textContent, r.classList.contains("on")]),
      [...document.querySelectorAll("#editor .ch-list > *")].filter((n) => n.classList.contains("ch-head") || n.textContent === ${JSON.stringify(c150.desc)}).map((n) => n.textContent)]`),
    [[[c150.desc, true], [c40.desc, false], [c0.desc, false]], ["Cheats active", c150.desc, "Other cheats"]]);
  // Off is not active: turned off there, it leaves for the top of the other cheats, above c40 though later in the file.
  await b.key("ArrowDown"); await b.key("ArrowDown"); await b.settled();
  await b.key("Enter");
  check("turned off under Cheats active, a cheat leaves it at once for the top of the other cheats, listed once, the bar on it",
    [await b.until(`document.querySelectorAll("#editor .ch-list .ch-head").length`, 0, 6000),
     await b.ev(`[...document.querySelectorAll("#editor .ch-list .cr-row")].slice(2, 4).map((r) => [r.textContent, r.classList.contains("on"), r.classList.contains("sel")])`),
     await b.ev(`[...document.querySelectorAll("#editor .ch-list .cr-row")].filter((r) => r.textContent === ${JSON.stringify(c150.desc)}).length`)],
    [0, [[c150.desc, false, true], [c40.desc, false, false]], 1]);
  await b.key("Escape");
  await sleep(300);
  await api("api/cheats.php", { id: sf.id, clear: true });
  fs.rmSync(path.join(DATA, "cheats-used.json"), { force: true });

  // and a game with nothing says so rather than opening an empty list
  await b.goto();
  await b.setView("grid");
  await b.openPlatform("Nintendo GameCube");
  await b.ev(`(() => {
    const n = document.querySelector("#view .tile, #view .row");
    const r = n.getBoundingClientRect();
    n.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 }));
  })()`);
  await b.waitFor(`!!document.querySelector(".ctx")`, 3000); await b.settled();
  await b.menuDeep(/^Cheats/, /Emulation/);
  await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "CHEATS"`);
  check("a console with no cheats opens no rows",
    await b.ev(`document.querySelectorAll("#editor .ch-list .cr-row").length`), 0);
  check("and says why, naming its own emulator",
    await b.ev(`/Dolphin/.test((document.querySelector("#editor .cr-none")||{}).textContent || "")`));
  await b.key("Escape");
  await sleep(300);

  // ---- the Cheats tab of a game's details -------------------------------
  await detailTabsOnAGame(b, check, sf);
  await emulatorsOwnCheats(b, check);

  check("no script errors through any of it", await b.ev(`(window.__errs || []).length`), 0);
};

// The stand-in PCSX2 folder, for the groups that read other things out of it (t-saves.js).
module.exports.pcsx2Fixture = pcsx2Fixture;
