/*  Play on a game whose console has no emulator and that RetroArch does not
 *  play (includes\emusuggest.php, api\emusuggest.php, js\emuhelp.js): the
 *  window naming the emulators to get, their makers' pages (dry here), the
 *  list of every console's, and Add an emulator... from them.
 *
 *  Its own three games, and a table with no emulator for their consoles, in
 *  the run's own copy of data: nothing is started and no page opens. */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, DATA, Guard } = require("./lib");

const FX = path.join(DATA, "fixtures", "emuhelp");
const PS3 = "Sony Playstation 3", SWITCH = "Nintendo Switch", CDI = "Philips CD-i";
const game = (n, title, platform, rom) => ({ id: "xs-scan-ehtest" + n, title, platform, rom: path.join(FX, rom), added: new Date().toISOString() });
const GAMES = [game(1, "Ehtest Souls", PS3, "souls.iso"), game(2, "Ehtest Kart", SWITCH, "kart.nsp"), game(3, "Ehtest Disc", CDI, "disc.chd")];

module.exports = async function (b, check) {
  if (!fs.existsSync(path.join(DATA, "fixtures"))) {
    check("emuhelp: runs only on the test server's own copy", true, true);
    return;
  }
  const kept = new Guard(["scanned-games.json", "emulators.json", "settings.json"]);
  const askTitle = `(document.querySelector(".setup-confirm h2") || {}).textContent || ""`;
  const askButtons = `[...document.querySelectorAll(".setup-confirm .confirm-bar button")].map((x) => x.textContent)`;
  const askText = `(document.querySelector(".setup-confirm .confirm") || {}).textContent || ""`;
  const tool = `(e => e.hidden ? "" : e.dataset.tool || "")(document.getElementById("editor"))`;
  const strip = `document.getElementById("strip").textContent`;

  try {
    fs.mkdirSync(FX, { recursive: true });
    for (const g of GAMES) { fs.writeFileSync(g.rom, "not a game, a stand-in"); }
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), JSON.stringify(GAMES));
    const table = JSON.parse(fs.readFileSync(path.join(DATA, "emulators.json"), "utf8"));
    for (const k of Object.keys(table.platforms || {})) {
      if (GAMES.some((g) => g.platform.toLowerCase() === k.toLowerCase())) { delete table.platforms[k]; }
    }
    fs.writeFileSync(path.join(DATA, "emulators.json"), JSON.stringify(table));
    await api("api/settings.php", { launch: { confirmBeforeLaunch: false }, view: { heroPanel: true } });

    /* ---- what the server says ------------------------------------------ */
    const ps3 = await api("api/emusuggest.php?platform=" + encodeURIComponent(PS3));
    const rpcs3 = (ps3.emulators || [])[0] || {};
    check("a console RetroArch does not play has its well-known emulator, its makers' site and what it asks for",
      [ps3.ok, ps3.ra, ps3.none, (ps3.emulators || []).map((e) => e.name).join(), rpcs3.site, /system software, a free download/.test(rpcs3.needs || "")],
      [true, false, false, "RPCS3", "rpcs3.net", true]);
    const sw = await api("api/emusuggest.php?platform=" + encodeURIComponent(SWITCH));
    check("Switch has none named, on purpose", [(sw.emulators || []).length, sw.none], [0, true]);
    const cdi = await api("api/emusuggest.php?platform=" + encodeURIComponent(CDI));
    check("a console with none known has none, not on purpose", [(cdi.emulators || []).length, cdi.none], [0, false]);
    check("a console's name is matched whatever the case of its letters",
      ((await api("api/emusuggest.php?platform=sony%20playstation%202")).emulators || []).map((e) => e.name).join(), "PCSX2");
    check("Wii U is known by both its names", ((await api("api/emusuggest.php?platform=Nintendo%20Wii%20U")).emulators || []).map((e) => e.name).join(), "Cemu");
    const all = await api("api/emusuggest.php");
    check("every console's: the ones to get, the ones named none, the ones RetroArch plays",
      [all.ok, (all.consoles || []).map((c) => c.platform).join(), (all.none || []).join(), (all.ra || []).includes("Nintendo 64"), (all.ra || []).includes(PS3)],
      [true, "Nintendo GameCube,Nintendo Wii,Wii U,Sony Playstation 2,Sony Playstation 3,Microsoft Xbox,Microsoft Xbox 360", "Nintendo Switch,Nintendo 3DS", true, false]);
    check("no address goes to the page, only a site's name", JSON.stringify(all).includes("https://"), false);
    const open = await api("api/emusuggest.php", { open: "rpcs3", dry: true });
    check("a makers' page is opened from the list's own address (dry here)", [open.ok, open.url, open.dry], [true, "https://rpcs3.net/", true]);
    const sent = await api("api/emusuggest.php", { open: "https://example.com/" });
    check("an address sent in is refused", [sent.ok, /no such emulator/.test(sent.error || "")], [false, true]);
    const row = ((await api("api/library.php?platform=" + encodeURIComponent(PS3))).games || []).find((g) => g.id === GAMES[0].id) || {};
    check("the game reads as having no emulator, with no RetroArch offer", [row.playable, /^no emulator/.test(row.why || ""), row.raOffer || null], [false, true, null]);

    /* ---- Play on it ----------------------------------------------------- */
    await b.goto();
    await b.openPlatform(PS3);
    await b.key("Enter");
    check("Play opens a window in place of a red line, with Add an emulator... as its press",
      await b.until(`[${askTitle}, ${askButtons}]`, [PS3 + " needs an emulator", ["Not now", "Add an emulator..."]], 8000),
      [PS3 + " needs an emulator", ["Not now", "Add an emulator..."]]);
    check("it says what Xsegon brings, names RPCS3 with its site and what it asks for, and what Xsegon never provides",
      await b.ev(`(() => { const t = ${askText}; return [/Xsegon brings RetroArch/.test(t), [...document.querySelectorAll(".setup-confirm .eh-name")].map((x) => x.textContent).join(),
        [...document.querySelectorAll(".setup-confirm .eh-site")].map((x) => x.textContent).join(), /system software/.test(t), /never provides games, BIOS or firmware/.test(t)]; })()`),
      [true, "RPCS3", "Open rpcs3.net", true, true]);
    await b.ev(`document.querySelector(".setup-confirm .eh-site").click()`);
    check("its site's press says it opened (dry on a test copy)", await b.until(`/Opened rpcs3\\.net in your browser/.test(${strip})`, true, 6000), true);
    check("and the window stays", await b.ev(askTitle), PS3 + " needs an emulator");
    await b.ev(`[...document.querySelectorAll(".setup-confirm button")].find((x) => x.textContent === "Emulators for every console...").click()`);
    check("Emulators for every console... opens the list in its place",
      await b.until(`[${tool}, !!document.querySelector(".setup-confirm")]`, ["emuhelp", false], 8000), ["emuhelp", false]);
    check("the list names each console's, the ones named none, and what RetroArch plays",
      await b.ev(`(() => { const t = document.getElementById("editor").textContent; return [[...document.querySelectorAll("#editor .eh-console-name")].length,
        /Xsegon names no emulator for Nintendo Switch and Nintendo 3DS/.test(t), /RetroArch plays .*Nintendo 64/.test(t), /never provides games, BIOS or firmware/.test(t)]; })()`),
      [7, true, true, true]);
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`, true, 6000);

    await b.openPlatform(SWITCH);
    await b.key("Enter");
    await b.until(askTitle, SWITCH + " needs an emulator", 8000);
    check("on Switch it names none, and Add an emulator... is still the way for one you have",
      await b.ev(`(() => { const t = ${askText}; return [document.querySelectorAll(".setup-confirm .eh-emu").length, /Xsegon names no emulator for Nintendo Switch\\. If you have one, Add an emulator\\.\\.\\. puts it in/.test(t)]; })()`),
      [0, true]);
    await b.ev(`[...document.querySelectorAll(".setup-confirm .confirm-bar button")].find((x) => x.textContent === "Add an emulator...").click()`);
    check("Add an emulator... opens that screen", await b.until(tool, "emuadd", 8000), "emuadd");
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`, true, 6000);

    await b.openPlatform(CDI);
    await b.key("Enter");
    await b.until(askTitle, CDI + " needs an emulator", 8000);
    check("a console with none known says so in its own words", /Xsegon knows no emulator to suggest for Philips CD-i/.test(await b.ev(askText)), true);
    await b.key("Escape");
    check("Esc closes it with nothing started", await b.until(`!document.querySelector(".setup-confirm")`, true, 6000), true);

    /* ---- the game panel, Details and the game's menu -------------------- */
    await b.openPlatform(PS3);
    const btnOf = (sel) => `(x => x ? [x.textContent, x.disabled] : null)(document.querySelector(${JSON.stringify(sel)}))`;
    if (await b.ev(`!document.getElementById("hero").hidden`)) {
      check("the game panel's Play reads Get an emulator..., not a greyed Cannot play",
        await b.until(btnOf("#hero .bar button.primary"), ["Get an emulator...", false], 8000), ["Get an emulator...", false]);
      await b.ev(`document.querySelector("#hero .bar button.primary").click()`);
      check("and opens the same window", await b.until(askTitle, PS3 + " needs an emulator", 8000), PS3 + " needs an emulator");
      await b.key("Escape");
      await b.until(`!document.querySelector(".setup-confirm")`, true, 6000);
    } else {
      console.log("    (this view has no game panel: its button rests)");
    }
    await b.key(" ");
    await b.until(`!document.getElementById("details").hidden`, true, 8000);
    check("Details' Play reads Get an emulator... too",
      await b.until(btnOf("#details .bar button.primary"), ["Get an emulator...", false], 8000), ["Get an emulator...", false]);
    await b.ev(`document.querySelector("#details .bar button.primary").click()`);
    check("and opens the window over Details", await b.until(`[${askTitle}, !document.getElementById("details").hidden]`, [PS3 + " needs an emulator", true], 8000),
      [PS3 + " needs an emulator", true]);
    await b.key("Escape");
    await b.until(`!document.querySelector(".setup-confirm")`, true, 6000);
    await b.key("Escape");
    await b.until(`document.getElementById("details").hidden`, true, 6000);
    await b.ev(`import("/js/menus.js").then(m => m.openGameMenuAtSelection())`);
    await b.waitFor(`!!document.querySelector(".ctx")`, 3000);
    await b.menuDeep(/^Get an emulator/);
    check("the game's own menu has Get an emulator... as a row", await b.until(askTitle, PS3 + " needs an emulator", 8000), PS3 + " needs an emulator");
    await b.key("Escape");
    await b.until(`!document.querySelector(".setup-confirm")`, true, 6000);

    /* ---- from Settings > Emulators -------------------------------------- */
    await b.ev(`import("/js/settings-ui.js").then(m => m.openSettings("emulators"))`);
    const setRow = `[...document.querySelectorAll("#settings .set-page[data-group=emulators] .opt")].find((r) => r.querySelector("label").firstChild.textContent === "Emulators for other consoles")`;
    check("Settings > Emulators has the row, with Show... as its press", await b.until(`(r => r ? r.querySelector("button").textContent : "")(${setRow})`, "Show...", 8000), "Show...");
    await b.ev(`(${setRow}).querySelector("button").click()`);
    check("its Show... opens the list, with Settings closed for it", await b.until(`[${tool}, document.getElementById("settings").hidden]`, ["emuhelp", true], 8000), ["emuhelp", true]);
    await b.key("Escape");
    check("and closing it goes back to Settings at Emulators", await b.until(`!document.getElementById("settings").hidden && !!(${setRow})`, true, 8000), true);
    await b.key("Escape");
  } finally {
    kept.restore();
    fs.rmSync(FX, { recursive: true, force: true });
  }
};
