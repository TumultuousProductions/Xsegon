// The right-click menu, the menu bar, favourites, hide, details.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { sleep, api, apiUntil, ROOT } = require("./lib");

/* A menu bar entry that draws the view again: the view's first child is
   marked, the entry pressed, and a fresh child waited for along with `done`,
   then the arrival animations. */
async function viaMenu(b, bar, re, done) {
  await b.ev(`(n => { if (n) { n.__old = true; } })(document.querySelector("#view > *"))`);
  await b.openBar(bar); await b.menuItem(re);
  await b.waitFor(`(n => !!n && !n.__old)(document.querySelector("#view > *")) && (${done || "true"})`, 10000);
  await b.settled();
}
module.exports = async function (b, check) {
  await b.goto();
  await b.setView("grid");
  await b.openPlatform("Nintendo 64");
  const n = await b.ev(`document.querySelectorAll("#view .tile").length`);

  // right-click menu
  await b.contextMenu("#view .tile.sel");
  const labels = await b.ev(`[...document.querySelectorAll(".ctx-item .ctx-label")].map(x => x.textContent)`);
  for (const want of ["Play", "Details", "Edit Metadata...", "Change Pictures...", "Hide from Xsegon", "Show in Explorer"]) {
    check("menu has " + want, labels.includes(want));
  }
  check("menu hides Remove Game for a LaunchBox game", !labels.includes("Remove Game..."));
  // The Explorer entries sit behind a group: a press opens them in a box beside
  // the group's row, the menu still up behind it (js\submenu.js).
  const menuRows = await b.ev(`document.querySelectorAll(".ctx .ctx-item").length`);
  await b.ev(`[...document.querySelectorAll(".ctx .ctx-item")].find(n => /Show in Explorer/.test(n.textContent)).click()`);
  check("and Show ROM is one press inside it",
        await b.waitFor(`[...document.querySelectorAll(".ctx .ctx-label")].some(x => x.textContent === "Show ROM")`, 6000));
  const BOX = `(() => { const m = document.querySelector(".ctx:not(.ctx-sub)"), s = document.querySelector(".ctx.ctx-sub"), row = document.querySelector(".ctx-item.has-sub.open");
    if (!m || !s || !row) { return null; }
    const a = m.getBoundingClientRect(), c = s.getBoundingClientRect(), r = row.getBoundingClientRect(), f = s.querySelector(".ctx-item").getBoundingClientRect();
    return { row: row.querySelector(".ctx-label").textContent, beside: Math.abs(c.left - (a.right - 3)) < 1.5 || Math.abs(c.right - (a.left + 3)) < 1.5, level: Math.abs(f.top - r.top) < 1.5,
             onScreen: c.left >= 0 && c.top >= 0 && c.right <= innerWidth && c.bottom <= innerHeight,
             back: [...document.querySelectorAll(".ctx .ctx-label")].some(x => x.textContent === "Back"), menuRows: m.querySelectorAll(".ctx-item").length }; })()`;
  check("in a box beside its row, level with it and on the screen, the whole menu still up behind it and no Back row",
        await b.ev(BOX), { row: "Show in Explorer", beside: true, level: true, onScreen: true, back: false, menuRows });
  // The pointer resting on the other group's row opens that one in the first one's place.
  const emuAt = await b.ev(`(r => ({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }))([...document.querySelectorAll(".ctx:not(.ctx-sub) .ctx-item")].find(n => /Emulation/.test(n.textContent)).getBoundingClientRect())`);
  await b.moveTo(emuAt.x - 20, emuAt.y);
  await b.moveTo(emuAt.x, emuAt.y);
  check("resting the pointer on Emulation opens its box in the other's place, with no press",
        await b.until(`(b => b && [b.row, b.beside, b.level, document.querySelectorAll(".ctx").length])(${BOX})`, ["Emulation", true, true, 2], 4000), ["Emulation", true, true, 2]);
  // Open RetroArch is inside the Emulation group.
  await b.ev(`[...document.querySelectorAll(".ctx .ctx-item")].find(n => /Emulation/.test(n.textContent)).click()`);
  check("Open RetroArch is live inside Emulation",
        await b.waitFor(`[...document.querySelectorAll(".ctx .ctx-item:not(.off) .ctx-label")].some(x => x.textContent === "Open RetroArch")`, 6000));
  /* Controls: read only, so opening it and reading a row IS the whole
     behaviour to prove, plus Esc leaving nothing behind. */
  await b.ev(`[...document.querySelectorAll(".ctx .ctx-item")].find(n => /Controls/.test(n.textContent)).click()`);
  check("Controls opens read-only from Emulation",
        await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "CONTROLS"`, 8000));
  check("and shows rows or says why there are none",
        await b.waitFor(`document.querySelectorAll("#editor .ed-row").length > 0 || !!document.querySelector("#editor .cr-none")`, 6000));
  /* RetroArch's hotkeys in the same panel: whatever is bound, the five presses
     that leave and pause a game are always listed first, in this order, each
     with RetroArch's name for it. A game that is not RetroArch's has none. */
  const hotIds = JSON.parse(await b.ev(`JSON.stringify([...document.querySelectorAll("#editor .ctl-hot")].map(n => n.dataset.hotkey))`));
  if (hotIds.length) {
    check("a RetroArch game's controls lead with leaving and pausing: menu, quit, close, pause, Hotkey Enable",
          hotIds.slice(0, 5), ["menu_toggle", "exit_emulator", "close_content", "pause_toggle", "enable_hotkey"]);
    check("under a heading that says so, above the console's own buttons",
          await b.ev(`(h => [h.textContent, (h.compareDocumentPosition(document.querySelector("#editor .ed-row:not(.ctl-hot)")) & 4) === 4])(document.querySelector("#editor .ctl-head"))`),
          ["Leaving and pausing a game", true]);
    check("each hotkey says what RetroArch calls it, so it can be found there",
          await b.ev(`[...document.querySelectorAll("#editor .ctl-hot .ctl-sub")].every(s => /^In RetroArch: \\S/.test(s.textContent))`), true);
    check("and the foot says where they are changed, with a button that opens RetroArch",
          await b.ev(`(p => [/Settings > Input > Hotkeys/.test(p.textContent), !!p.querySelector("button.ctl-open")])(document.querySelector("#editor .ctl-where"))`), [true, true]);
  }
  /* The reading itself (includes\rahotkeys.php), on a settings file of the
     test's own, so the answers do not depend on the installed RetroArch. */
  const hkDir = path.join(os.tmpdir(), "xs-hotkeys-test");
  fs.rmSync(hkDir, { recursive: true, force: true });
  fs.mkdirSync(hkDir, { recursive: true });
  const hkCfg = path.join(hkDir, "retroarch.cfg"), hkOver = path.join(hkDir, "Some Core.cfg");
  const phpExe = ((await api("api/status.php")).build || {}).phpExe;
  const hotkeys = (...files) => JSON.parse(execFileSync(phpExe, [path.join(ROOT, "tests", "hotkeys-probe.php"), ...files], { encoding: "utf8" }));
  const hk = (o, id) => o.leave.concat(o.other).find((r) => r.id === id) || {};
  /* A file RetroArch has written carries a line for every hotkey, "nul" for
     the ones with no key; the lines under test go after and win. */
  const hkIds = hotkeys("--ids");
  const hkSaid = ['input_joypad_driver = "sdl2"', 'input_menu_toggle = "f1"', 'input_menu_toggle_btn = "nul"',
    'input_menu_toggle_gamepad_combo = "4"', 'input_exit_emulator = "escape"', 'input_exit_emulator_btn = "5"',
    'input_quit_gamepad_combo = "0"', 'quit_press_twice = "true"', 'menu_pause_libretro = "true"',
    'input_enable_hotkey_btn = "9"', 'input_pause_toggle = "nul"', 'input_save_state = "f2"',
    'input_save_state_btn = "h0up"', 'input_load_state_axis = "+4"', 'input_player1_a = "x"'];
  fs.writeFileSync(hkCfg, hkIds.map((id) => "input_" + id + ' = "nul"').concat(hkSaid).join("\n") + "\n");
  let read = hotkeys(hkCfg);
  check("the menu: its key, or its controller combination in words, and that the game is paused meanwhile",
        [hk(read, "menu_toggle").value, hk(read, "menu_toggle").note], ["F1, or Start + Select", "The game is paused while the menu is open."]);
  check("quit: pressed twice when RetroArch is set so, and a pad button in an Xbox pad's words under sdl2",
        hk(read, "exit_emulator").value, "Esc, pressed twice, or pad button 5 (the Xbox button on an Xbox pad)");
  check("a leaving hotkey that is not set is still listed, and says so", [hk(read, "pause_toggle").value, hk(read, "pause_toggle").set], ["not set", false]);
  check("Hotkey Enable warns that the others need it held",
        [hk(read, "enable_hotkey").value, /only answer with it held/.test(hk(read, "enable_hotkey").note || "")], ["pad button 9 (LB on an Xbox pad)", true]);
  check("the rest are listed only when set (a key or a d-pad direction, a stick axis), the others counted, and a console button is not taken for a hotkey",
        [read.other.map((r) => r.id + "=" + r.value), read.unset], [["save_state=F2, or D-pad up", "load_state=pad axis +4"], hkIds.length - 7]);
  fs.writeFileSync(hkOver, 'input_exit_emulator = "q"\nquit_press_twice = "false"\n');
  read = hotkeys(hkCfg, hkOver);
  check("a core's override file wins, as it does in RetroArch, and the row names the file",
        [hk(read, "exit_emulator").value, hk(read, "exit_emulator").from], ["Q, or pad button 5 (the Xbox button on an Xbox pad)", "Some Core.cfg"]);
  fs.writeFileSync(hkCfg, fs.readFileSync(hkCfg, "utf8").replace('"sdl2"', '"xinput"'));
  read = hotkeys(hkCfg);
  check("under another pad driver a button is only its number: what a number means is the driver's", hk(read, "enable_hotkey").value, "pad button 9");
  /* A RetroArch that has never closed has no hotkey lines, only what Xsegon
     wrote before its first run. No line means RetroArch's own key, not no key,
     so those keys are named and kept off the console's buttons. */
  fs.writeFileSync(hkCfg, ['network_cmd_enable = "true"', 'quit_press_twice = "false"'].join("\n") + "\n");
  read = hotkeys(hkCfg);
  check("a settings file with no hotkey lines reads as RetroArch's own keys: Esc quits, F1 is the menu, P pauses",
        [hk(read, "exit_emulator").value, hk(read, "menu_toggle").value.split(",")[0], hk(read, "pause_toggle").value, hk(read, "close_content").value],
        ["Esc", "F1", "P", "not set"]);
  let kept = hotkeys("--kept", hkCfg);
  check("and those keys are kept off the buttons, each saying what it does",
        [kept.p, kept.space, kept.f1, kept.escape, kept.add, kept.tilde, Object.keys(kept).length],
        ["Pause", "Fast forward (turbo speed), on and off", "Open RetroArch's menu", "Quit the game", "Volume up", "Netplay: chat", 30]);
  check("a key no hotkey has is still free", [kept.j, kept.x], [undefined, undefined]);
  fs.appendFileSync(hkCfg, 'input_pause_toggle = "nul"\ninput_exit_emulator = "q"\ninput_recording_toggle = "j"\n');
  kept = hotkeys("--kept", hkCfg);
  check("what the file does say wins: a hotkey set to no key frees its key, a moved one keeps the new key, and one RetroArch ships without a key is kept once it has one",
        [kept.p, kept.escape, kept.q, kept.j], [undefined, undefined, "Quit the game", "Recording, on and off"]);
  fs.appendFileSync(hkCfg, 'input_enable_hotkey = "ctrl"\n');
  kept = hotkeys("--kept", hkCfg);
  check("with Hotkey Enable on a key, only that key is kept back", kept, { ctrl: "Hotkey Enable" });
  fs.rmSync(hkDir, { recursive: true, force: true });
  await b.key("Escape");
  check("Esc closes the controls panel", await b.until(`document.getElementById("editor").hidden`));
  await b.contextMenu("#view .tile.sel, #view .row.sel");
  await b.until(`[...document.querySelectorAll(".ctx .ctx-item")].some(n => /Emulation/.test(n.textContent))`);
  await b.key("Escape");
  check("Esc closes the menu", await b.until(`!document.querySelector(".ctx")`));

  // favourite toggles both ways and survives a reload
  const id = await b.ev(`(() => { const t = document.querySelector("#view .tile.sel"); return t.classList.contains("fav"); })()`);
  await b.contextMenu("#view .tile.sel");
  await b.menuItem(/(Favourite|Unfavourite)/);
  check("favourite toggled", await b.until(`document.querySelector("#view .tile.sel").classList.contains("fav")`, !id), !id);
  await b.settled();
  await b.contextMenu("#view .tile.sel");
  await b.menuItem(/(Favourite|Unfavourite)/);
  check("favourite toggled back", await b.until(`document.querySelector("#view .tile.sel").classList.contains("fav")`, id), id);
  await b.settled();

  // details
  await b.key(" ");
  check("Space opens details", await b.until(`!document.getElementById("details").hidden`));
  check("details shows the cover", await b.until(`(i => !!i && i.complete && i.naturalWidth > 0)(document.querySelector("#details img"))`, true, 6000));
  await b.settled();
  await b.key("Escape");
  check("Esc closes details", await b.until(`document.getElementById("details").hidden`));

  /* ---- the game's own buttons, from details ----
     The door shows only for a RetroArch game of a console whose buttons Xsegon
     knows. The console has an A and a B, so the press lands the same everywhere. */
  const gbCon = (((await api("api/pad-remap.php")).consoles) || []).find((c) => c.buttons.some((x) => x.sends === "a") && c.buttons.some((x) => x.sends === "b"));
  if (!gbCon) {
    check("a console whose buttons can be set, to try the game door on", false);
  } else {
    await b.openPlatform(gbCon.platform);
    const gbId = await b.ev(`import("/js/state.js").then(m => m.games[m.sel].id)`);
    const gbPad = (await api("api/game.php?id=" + gbId)).game;
    // What it has of its own before the test (null: none, which is not the same
    // as an empty map: that is the standard layout kept on purpose), put back after.
    const gbWas = gbPad.padable ? await api("api/game-remap.php?id=" + gbId) : {};
    const gbKeep = gbWas.own ? gbWas.map : null;
    if (gbWas.own) { await api("api/game-remap.php", { id: gbId, map: null }); }
    await b.key(" ");
    await b.until(`!document.getElementById("details").hidden`);
    await b.settled();
    /* The door comes with the full record, a second build that queues behind
       this test's own calls on the one-at-a-time server, so presence is
       waited for and absence is read after the wait would have passed. */
    check("details offers the game's Buttons exactly when they can be set",
          await b.waitFor(`[...document.querySelectorAll("#details .bar button")].some(x => x.textContent.indexOf("Buttons") === 0)`, 8000),
          gbPad.padable);
    if (gbPad.padable) {
      const gbAName = gbCon.buttons.find((x) => x.sends === "a").name;
      const gbRow = `[...document.querySelectorAll("#editor .gb-row")].find(r => r.querySelector("label").firstChild.textContent === ${JSON.stringify(gbAName)})`;
      await b.ev(`[...document.querySelectorAll("#details .bar button")].find(x => x.textContent.indexOf("Buttons") === 0).click()`);
      check("the game's buttons open over details", await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "BUTTONS"`, 8000));
      check("a row for each of the console's buttons, and the way back to the console's",
            await b.ev(`[document.querySelectorAll("#editor .gb-row .padbtn").length, [...document.querySelectorAll("#editor .gb-row button")].some(x => x.textContent === "Same as the console")]`),
            [gbCon.buttons.length, true]);
      await b.ev(`window.__gbWas = navigator.getGamepads; window.__gbPad = { id: "stand-in", mapping: "standard", connected: true, axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }; navigator.getGamepads = () => [window.__gbPad]`);
      await b.ev(`${gbRow}.querySelector(".padbtn").click()`);
      check("choosing one waits for a press", await b.until(`!!document.querySelector("#editor .padbtn.catching")`), true);
      await sleep(200);
      await b.ev(`window.__gbPad.buttons[0].pressed = true`);
      await sleep(200);
      await b.ev(`window.__gbPad.buttons[0].pressed = false`);
      check("the press is kept for this game alone",
            await apiUntil(async () => JSON.stringify(((await api("api/game-remap.php?id=" + gbId)).map) || {}) === JSON.stringify({ b: "a", a: "b" })));
      check("the row wears it", await b.until(`${gbRow}.querySelector(".padbtn").textContent`, "A (bottom)"), "A (bottom)");
      await b.ev(`[...document.querySelectorAll("#editor .gb-row button")].find(x => x.textContent === "Same as the console").click()`);
      check("Same as the console takes the game's own away",
            await apiUntil(async () => (await api("api/game-remap.php?id=" + gbId)).own === false));
      /* Turbo for this game alone: the same three pickers as Settings >
         Controls, the button and the speed asleep until it is on. */
      check("turbo for this game alone: three pickers, the button, its listening button and the speed asleep",
            await b.ev(`(s => [s.length, s[1].disabled, s[2].disabled, document.querySelector("#editor .hk-listen").disabled])([...document.querySelectorAll("#editor select.hk-pick")])`),
            [3, true, true, true]);
      await b.ev(`(s => { s.value = "on:0"; s.dispatchEvent(new Event("change")); })(document.querySelector("#editor select.hk-pick"))`);
      check("turning it on is kept for this game",
            await apiUntil(async () => ((((await api("api/game-remap.php?id=" + gbId)).turbo) || {}).set) === "on"));
      check("and wakes the other two", await b.until(`[...document.querySelectorAll("#editor select.hk-pick")][1].disabled`, false), false);
      await b.ev(`(s => { s.value = ""; s.dispatchEvent(new Event("change")); })(document.querySelector("#editor select.hk-pick"))`);
      check("same as everywhere again",
            await apiUntil(async () => ((await api("api/game-remap.php?id=" + gbId)).turbo) === null));
      await b.ev(`navigator.getGamepads = window.__gbWas`);
      await b.key("Escape");
      check("Esc closes the game's buttons", await b.until(`document.getElementById("editor").hidden`));
      await b.key("Escape");
      await b.until(`document.getElementById("details").hidden`);
      if (gbKeep !== null) { await api("api/game-remap.php", { id: gbId, map: gbKeep }); }
    } else {
      await b.key("Escape");
      await b.until(`document.getElementById("details").hidden`);
    }
    await b.openPlatform("Nintendo 64");   // back where the group stood
  }

  // hide, then show again from Settings > Library
  const title = await b.ev(`document.querySelector("#view .tile.sel .cap").textContent`);
  await b.contextMenu("#view .tile.sel");
  await b.menuItem(/Hide from Xsegon/);
  check("hide removes one tile and stays in the platform", await b.until(`document.querySelectorAll("#view .tile").length`, n - 1, 8000), n - 1);
  await b.settled();
  const hidden = await api("api/hide.php");
  check("hide is recorded", hidden.hidden.some((h) => h.title === title));
  await b.clickSel("#btn-settings");
  await b.waitFor(`!document.getElementById("settings").hidden`); await b.settled();
  await b.ev(`[...document.querySelectorAll("#settings .set-nav button")].find(x => /Library/i.test(x.textContent)).click()`);
  /* The hidden list is fetched from a server that answers one request at a
     time, so it is waited for: a fixed sleep gets too short as the suite grows. */
  const listed = `[...document.querySelectorAll("#settings .hl-row")].some(r => r.textContent.includes(${JSON.stringify(title)}))`;
  check("Settings > Library lists it with Show again", await b.waitFor(listed, 8000));
  await b.ev(`(r => r && r.querySelector("button").click())([...document.querySelectorAll("#settings .hl-row")].find(r => r.textContent.includes(${JSON.stringify(title)})))`);
  await b.waitFor(`!(${listed})`, 8000);
  await b.key("Escape");
  check("shown again", await b.waitFor(`document.querySelectorAll("#view .tile").length === ${n}`, 8000));

  // menu bar: Arrange By and Image Group
  await b.openBar("arrange");
  check("Arrange By lists the sorts", await b.ev(`document.querySelectorAll(".ctx-item").length`) >= 12);
  await b.ev(`(n => { if (n) { n.__old = true; } })(document.querySelector("#view > *"))`);
  await b.menuItem(/^Developer$/);
  await b.waitFor(`(n => !!n && !n.__old)(document.querySelector("#view > *"))`, 10000); await b.settled();
  check("sort by developer applied", await b.ev(`document.getElementById("sort").value`), "developer");
  await viaMenu(b, "arrange", /Group under headers/, `document.querySelectorAll("#view .ghead").length > 3`);
  check("group headers drawn", await b.ev(`document.querySelectorAll("#view .ghead").length`) > 3);
  await viaMenu(b, "arrange", /Group under headers/, `document.querySelectorAll("#view .ghead").length === 0`);
  await viaMenu(b, "arrange", /^Title$/, `document.getElementById("sort").value === "title"`);

  await viaMenu(b, "images", /^Screenshot$/, `document.getElementById("view").className === "grid grid-shot"`);
  check("Image Group: screenshots", await b.ev(`document.getElementById("view").className`), "grid grid-shot");
  await viaMenu(b, "images", /^3D box$/, `document.getElementById("view").className === "grid grid-box3d"`);
  check("Image Group: 3D boxes", await b.ev(`document.getElementById("view").className`), "grid grid-box3d");
  check("3D box tiles carry the kind", await b.ev(`document.querySelectorAll("#view .tile .shot.as-box3d").length`) > 30);
  // img, not .shot: the chosen tile's snap video wears the art's class too
  check("a 3D box tile is served", await b.ev(`(async () => { const i = document.querySelector("#view .tile img.shot.as-box3d"); const r = await fetch(i.src); return r.status === 200 && /image\\/(png|jpeg)/.test(r.headers.get("content-type")); })()`));
  await viaMenu(b, "images", /^Box art$/, `document.getElementById("view").className === "grid grid-box"`);
  check("Image Group: back to boxes", await b.ev(`document.getElementById("view").className`), "grid grid-box");

  /* The bar names each menu for what is in it: the round X is Xsegon's own,
     then Games, Pictures & Videos, Emulators, the view's four, and Help. */
  check("the bar: the round X, then menus named for what is in them",
        await b.ev(`[...document.querySelectorAll("#mb button")].map(x => x.classList.contains("mb-orb") ? "(" + x.title + ")" : x.textContent)`),
        ["(Xsegon)", "Games", "Pictures & Videos", "Emulators", "View", "Arrange By", "Image Group", "Badges", "Help"]);
  check("the X is a round button wearing Xsegon's mark",
        await b.ev(`(o => { const s = getComputedStyle(o), r = o.getBoundingClientRect(); return [s.borderTopLeftRadius, Math.round(r.width) === Math.round(r.height), /xsegon-180\\.png/.test(s.backgroundImage)]; })(document.querySelector("#mb .mb-orb"))`),
        ["50%", true, true]);
  check("left to right: the back arrow with no word, the round X, the platform picker, then Games",
        await b.ev(`(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(), a = r("#btn-systems"), o = r("#mb .mb-orb"), p = r("#pfpick"), g = r('#mb [data-menu="games"]');
          return [document.getElementById("btn-systems").textContent.trim(), !!document.querySelector("#btn-systems svg"), a.width > 0 && a.right <= o.left, o.right <= p.left, p.width > 0 && p.right <= g.left]; })()`),
        ["", true, true, true, true]);
  const barMenu = async (key) => {
    await b.openBar(key);
    const m = await b.ev(`(() => { const c = document.querySelector(".ctx"), r = c.getBoundingClientRect(), t = document.querySelector('#mb [data-menu="${key}"]').getBoundingClientRect();
      return { labels: [...c.querySelectorAll(".ctx-item:not(.off) .ctx-label")].map(x => x.textContent).filter(x => !/LaunchBox/.test(x)),
               under: r.top >= t.bottom, whole: r.bottom <= innerHeight && c.scrollHeight <= c.clientHeight + 1 }; })()`);
    await b.key("Escape"); await b.until(`!document.querySelector(".ctx")`);
    return m;
  };
  const bar = {};
  for (const key of ["xsegon", "games", "media", "emulators", "view", "arrange", "images", "badges", "help"]) { bar[key] = await barMenu(key); }
  check("the X opens on Settings, then the controller and the backup", bar.xsegon.labels.slice(0, 3), ["Settings...", "Controller...", "Back up what you made..."]);
  // Hacks to settle carries how many wait, which is this library's own number.
  check("Games: adding them, a random one, the two lists of what is not there, and the hacks that wait for a word",
        bar.games.labels.map((l) => l.replace(/^Hacks to settle \(\d+\)\.\.\.$/, "Hacks to settle...")),
        ["Add Games...", "Scan for Games...", "Add Steam games...", "Surprise me", "Missing Games...", "Check game files...", "Hacks to settle...", "Games you do not have..."]);
  // Find videos from Package is there only where private\ is, which adds it after Export.
  const ownFind = fs.existsSync(path.join(ROOT, "private", "web", "main.js"));
  check("Pictures & Videos: the pictures, the three kinds of video, and a video package's list out and package in", bar.media.labels,
        ["Get Pictures", "Get Specific Pictures...", "Steam trailers...", "ScreenScraper videos...", "Videos from online archives...",
         "Export Games with No videos"].concat(ownFind ? ["Find videos from Package..."] : [], ["Import Xsegon Video Package..."]));
  check("Emulators: RetroArch, the two checks, adding one of your own and their settings", bar.emulators.labels,
        ["Open RetroArch", "BIOS check...", "Runs check...", "Add an emulator...", "Emulator settings..."]);
  check("Help: the guide, what changed, the log, a report and the data folder", bar.help.labels,
        ["Getting started...", "What's new", "Show the log", "Report a problem...", "Open the data folder"]);
  check("every menu opens under its own button, whole, with nothing to scroll",
        Object.keys(bar).filter(k => !bar[k].under || !bar[k].whole), []);
  await b.openBar("emulators");
  await b.menuItem(/Emulator settings/);
  check("Emulator settings opens Settings at Emulators",
        await b.until(`(t => !!t && !document.getElementById("settings").hidden && t.textContent.trim())(document.querySelector("#settings .set-tab.on .tab-label"))`, "Emulators", 8000), "Emulators");
  await b.key("Escape");
  await b.until(`document.getElementById("settings").hidden`);
  await b.settled();

  /* ---- the menu tooltips ----
     "Rest" is the menu's own bar, which mouse, keys and pad all move through
     one function, so the keys prove it here. A greyed entry never wears the
     bar: only a real pointer (CDP) can rest on it. */
  const tipHid = `(n => !n || n.hidden)(document.querySelector(".ctx-tip"))`;
  const tipShown = `(n => !!n && !n.hidden)(document.querySelector(".ctx-tip"))`;
  const tipIsForBar = `${tipShown} && document.querySelector(".ctx-tip .tip-name").textContent === document.querySelector(".ctx-item.at .ctx-label").textContent`;
  await b.openBar("help");
  await sleep(500);
  check("a menu tooltip does not come at once", await b.ev(tipHid), true);
  check("resting on an entry for a moment brings its card", await b.until(tipShown, true, 3000), true);
  check("naming the entry the bar is on, and saying what it does",
        [await b.ev(tipIsForBar), await b.ev(`/first steps for a new library/.test(document.querySelector(".ctx-tip .tip-body").textContent)`)], [true, true]);
  check("beside the menu and level with its entry, never over the menu",
        await b.ev(`(() => { const c = document.querySelector(".ctx-tip").getBoundingClientRect(), m = document.querySelector(".ctx").getBoundingClientRect(), r = document.querySelector(".ctx-item.at").getBoundingClientRect(); return (c.left >= m.right || c.right <= m.left) && Math.abs(c.top - r.top) < 3; })()`), true);
  check("the card takes no pointer, so it can never hold its own hover", await b.ev(`getComputedStyle(document.querySelector(".ctx-tip")).pointerEvents`), "none");
  await b.key("ArrowDown");
  check("moving the bar puts the card away at once", await b.ev(tipHid), true);
  check("and the next entry gets its own after a rest", await b.until(tipIsForBar, true, 3000), true);
  // A greyed entry says why it is off, to a pointer that rests on it (View has one).
  await b.key("Escape"); await b.until(`!document.querySelector(".ctx")`);
  await b.openBar("view");
  const offAt = await b.ev(`(n => { const c = n.getBoundingClientRect(); return { x: Math.round(c.left + 60), y: Math.round(c.top + c.height / 2) }; })([...document.querySelectorAll(".ctx-item.off")].find(n => /Show titles under tiles/.test(n.textContent)))`);
  await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: offAt.x, y: offAt.y, button: "none", buttons: 0 });
  check("a greyed entry says why it is off, to a resting pointer",
        await b.until(`${tipShown} && /Planned/.test(document.querySelector(".ctx-tip .tip-body").textContent)`, true, 3000), true);
  await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2, button: "none", buttons: 0 });
  check("and the card goes when the pointer leaves it", await b.until(tipHid, true), true);
  // The watchdog: the bar gone from under a showing card, with no event to help.
  await b.key("ArrowDown");
  await b.until(tipShown, true, 3000);
  await b.ev(`document.querySelector(".ctx-item.at").classList.remove("at")`);
  check("a card whose entry lost the bar with no event is put away by the watchdog", await b.until(tipHid, true, 3000), true);
  await b.key("ArrowDown");
  await b.until(tipShown, true, 3000);
  await b.key("Escape");
  check("Esc closes the menu, and a card never outlives its menu", [await b.until(`!document.querySelector(".ctx")`), await b.ev(tipHid)], [true, true]);
  // Settings... needs no sentence, so it has no card however long the rest.
  await b.openBar("xsegon");
  await sleep(1600);
  check("an entry with nothing to add has no card", [await b.ev(`document.querySelector(".ctx-item.at .ctx-label").textContent`), await b.ev(tipHid)], ["Settings...", true]);
  await b.key("Escape"); await sleep(200);
  // The game's own menu carries them too: the sentence that matters most.
  await b.contextMenu("#view .tile.sel");
  check("on a game's menu, Delete says no file is deleted, and a Play that works says nothing",
        [await b.ev(`/No file on the disk is deleted/.test([...document.querySelectorAll(".ctx-item")].find(n => /Delete from Xsegon/.test(n.textContent)).dataset.tip || "")`),
         await b.ev(`(n => !n || n.dataset.tip === undefined)([...document.querySelectorAll(".ctx-item:not(.off)")].find(n => n.querySelector(".ctx-label").textContent === "Play"))`)], [true, true]);
  await b.key("Escape"); await sleep(200);

  /* Badges: every entry is a switch, selected while its mark is drawn,
     and the mark is a body class the stylesheet reads. */
  await b.openBar("badges");
  check("the Badges menu is switches, not promises", await b.ev(`[...document.querySelectorAll(".ctx-item")].every(n => !/planned/.test(n.textContent))`));
  // Nearly every game is a scanned one, so there is no scanned mark.
  check("with no switch for a scanned mark", await b.ev(`[...document.querySelectorAll(".ctx-item .ctx-label")].every(x => !/scan/i.test(x.textContent))`));
  check("and no game wears one", await b.ev(`!document.querySelector(".b-scanned") && !document.body.classList.contains("badge-scanned")`));
  const hadUnplayed = await b.ev(`document.body.classList.contains("badge-unplayed")`);
  await b.menuItem(/^Never played$/);
  /* The menu has closed and no game in sight may carry the mark, so the press says it was saved:
     the small toast of Settings, with the page's own toasts, only once the server has answered. */
  const savedToast = `(n => (n ? n.querySelector(".ts-text").textContent : ""))(document.querySelector("#toasts .toast-saved:not(.going)"))`;
  check("a badge switch says it was saved, by name, once the server has answered",
        await b.until(savedToast, "Saved: Never played mark " + (hadUnplayed ? "off" : "on"), 4000), "Saved: Never played mark " + (hadUnplayed ? "off" : "on"));
  check("a badge switch flips its body class", await b.until(`document.body.classList.contains("badge-unplayed")`, !hadUnplayed), !hadUnplayed);
  // Drawn or not: the strip is a flex box, so a shown mark computes as
  // "block", never "inline", and only "none" is the honest comparison.
  check("and a never-played tile shows or hides the mark with it",
        await b.ev(`(m => m ? getComputedStyle(m).display !== "none" : "no such tile")(document.querySelector("#view .tile.b-unplayed .bdg .b-unplayed"))`), !hadUnplayed);
  check("and it is saved", await apiUntil(async () => (await api("api/settings.php")).settings.view.badges.unplayed === !hadUnplayed), true);
  await b.openBar("badges"); await b.menuItem(/^Never played$/);
  check("and switched back", await apiUntil(async () => (await api("api/settings.php")).settings.view.badges.unplayed === hadUnplayed), true);
  await b.until(`document.body.classList.contains("badge-unplayed")`, hadUnplayed);
  check("and the toast goes by itself", await b.until(`!document.querySelector("#toasts .toast-saved")`, true, 6000), true);

  /* A setting saved from a menu reads the server's answer: the mark has changed on screen by then, so a
     save that did not hold would look saved. The stand-in answers keep another value, then refuse the save. */
  const stripSays = `(document.getElementById("strip") || {}).textContent || ""`;
  const answers = (how) => b.ev(`(() => { window.__realFetch = window.__realFetch || window.fetch; window.fetch = function (u, o) {
    if (String(u).indexOf("api/settings.php") >= 0 && o && o.method === "POST") {
      const say = (body) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
      return ${JSON.stringify(how)} === "refuses" ? Promise.resolve(say({ ok: false, error: "the disk is full" }))
        : window.__realFetch("api/settings.php").then((r) => r.json()).then((j) => say({ ok: true, settings: j.settings }));
    }
    return window.__realFetch.apply(this, arguments); }; })()`);
  await answers("keeps the old value");
  await b.openBar("badges"); await b.menuItem(/^Never played$/);
  check("a badge the server kept as something else is said as that, and never as saved",
        [await b.until(`/The Never played mark was not kept as chosen, so it goes back when Xsegon is next started/.test(${stripSays})`, true, 4000),
         await b.ev(`!!document.querySelector("#toasts .toast-saved")`)], [true, false]);
  await answers("refuses");
  await b.openBar("badges"); await b.menuItem(/^Never played$/);
  check("and one the server would not save says so, with the reason",
        [await b.until(`/The Never played mark could not be saved, so it lasts only until Xsegon is next started: the disk is full/.test(${stripSays})`, true, 4000),
         await b.ev(`!!document.querySelector("#toasts .toast-saved")`)], [true, false]);
  await b.ev(`window.fetch = window.__realFetch`);
  await b.ev(`(c => c && c.click())([...document.querySelectorAll("#strip button")].find((x) => x.textContent === "Clear"))`);
  check("(the mark is back as it was, on screen and on the server)",
        [await b.ev(`document.body.classList.contains("badge-unplayed")`), (await api("api/settings.php")).settings.view.badges.unplayed], [hadUnplayed, hadUnplayed]);

  /* Show badges: one switch over every mark of the menu. Set on first, since
     the test copy starts from the person's own settings. */
  const marksOn = `["favourite", "recent", "unplayed", "dead", "edited", "docs", "discs", "onedisc"].filter(k => document.body.classList.contains("badge-" + k)).join() + "|" + document.body.classList.contains("no-novid") + "|" + document.body.classList.contains("show-players")`;
  const menuLabels = `[...document.querySelectorAll(".ctx-item .ctx-label")].map(x => x.textContent)`;
  const hadAll = (await api("api/settings.php")).settings.view.showBadges !== false;
  if (!hadAll) { await b.openBar("badges"); await b.menuItem(/^Show badges$/); await b.until(`!!document.querySelector("#toasts .toast-saved")`, true, 4000); }
  const before = await b.ev(marksOn);
  await b.openBar("badges");
  check("Show badges is the menu's first entry, selected, and Manual or guide is one of the marks",
        [(await b.ev(menuLabels))[0], await b.ev(`document.querySelector(".ctx-item").classList.contains("on")`), (await b.ev(menuLabels)).includes("Manual or guide")], ["Show badges", true, true]);
  await b.menuItem(/^Show badges$/);
  check("off, no mark is drawn: no badge class, no No video mark, no player icons", await b.until(marksOn, "|true|false", 4000), "|true|false");
  check("and it is kept", (await api("api/settings.php")).settings.view.showBadges, false);
  await b.openBar("badges");
  check("each mark then waits greyed, its own setting still shown",
        await b.ev(`[...document.querySelectorAll(".ctx-item")].map(n => n.classList.contains("off")).join()`),
        ["false"].concat(Array((await b.ev(menuLabels)).length - 1).fill("true")).join());
  await b.menuItem(/^Show badges$/);
  check("on again, every mark is as it was", await b.until(marksOn, before, 4000), before);
  const hadDocs = await b.ev(`document.body.classList.contains("badge-docs")`);
  await b.openBar("badges"); await b.menuItem(/^Manual or guide$/);
  check("the Manual or guide switch flips its body class, and is kept",
        [await b.until(`document.body.classList.contains("badge-docs")`, !hadDocs, 4000), (await api("api/settings.php")).settings.view.badges.docs], [!hadDocs, !hadDocs]);
  await b.openBar("badges"); await b.menuItem(/^Manual or guide$/);
  await b.until(`document.body.classList.contains("badge-docs")`, hadDocs, 4000);
  if (!hadAll) { await b.openBar("badges"); await b.menuItem(/^Show badges$/); await b.until(marksOn, "|true|false", 4000); }

  /* Show in folder says so when it works too: Explorer's window can come up behind a
     full-screen Xsegon. A test copy opens no window, and says that. */
  await b.openBar("help"); await b.menuItem(/^Open the data folder$/);
  check("Open the data folder says what Explorer opens on",
        await b.until(`/a test copy opens no window: Explorer would open on .*xsegon-test-data/i.test(${stripSays})`, true, 6000), true);
  await b.ev(`(c => c && c.click())([...document.querySelectorAll("#strip button")].find((x) => x.textContent === "Clear"))`);

  /* One read of the list at a time: the server answers one request at a time and runs a dropped one
     to its end, so reads overtaken while one is out are not sent at all. */
  await b.settled();
  const sortWas = await b.ev(`document.getElementById("sort").value`);
  await b.ev(`(() => { window.__realFetch = window.__realFetch || window.fetch; window.__libReads = []; window.fetch = function (u, o) {
    if (String(u).indexOf("api/library.php") >= 0) { window.__libReads.push(new URL(String(u), location.href).searchParams.get("sort")); }
    return window.__realFetch.apply(this, arguments); }; })()`);
  await b.ev(`(() => { const s = document.getElementById("sort"); for (const v of ["developer", "year", "rating", "genre", "publisher"]) { s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); } })()`);
  check("five sorts chosen at once are two reads of the list: the first, and the newest when that is back",
        await b.until(`window.__libReads.join(",")`, "developer,publisher", 8000), "developer,publisher");
  await sleep(700);
  check("and the three between were never sent", await b.ev(`window.__libReads.join(",")`), "developer,publisher");
  await b.ev(`(() => { window.fetch = window.__realFetch; const s = document.getElementById("sort"); s.value = ${JSON.stringify(sortWas)}; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await b.settled();

  /* The platform sidebar: on by default, and in list and grid it is the
     platform picker, the dropdown on the bar giving way to it. A run starts
     with it off (tests\run.js), so View switching it on is walked here. */
  check("the sidebar is on by default, the way LaunchBox has it", (await api("api/settings.php")).defaults.view.sidebar, true);
  // Shown at all, by any ancestor: the dropdown sits inside the picker's
  // face (#pfpick), and it is the face that gives way.
  const platformShown = `!!document.getElementById("platform").offsetParent`;
  check("off, the bar has the platform dropdown", await b.ev(`!document.getElementById("sidebar") || document.getElementById("sidebar").hidden`) && await b.ev(platformShown));
  /* Its list wears the consoles' icons as the sidebar's rows do: the same
     dropdown underneath, every option dressed, and the list a part of the
     page, so its keys must not reach the games behind. */
  check("its list has an icon for every row, and a row's words are still its name and number",
        await b.ev(`(() => { const o = [...document.getElementById("platform").options], n64 = o.find(x => x.value === "Nintendo 64");
          return [o.filter(x => !x.classList.contains("pf-sep") && !x.querySelector(".pf-oico")).length, o[0].textContent, /^Nintendo 64  \\(\\d+\\)$/.test(n64.textContent)]; })()`), [0, "All platforms", true]);
  if (await b.ev(`CSS.supports("appearance", "base-select")`)) {
    const listOpen = `document.getElementById("platform").matches(":open")`;
    const started = `(() => { const real = window.fetch; window.__pfStarts = 0; window.fetch = function (u, o) { if (String(u).indexOf("api/launch.php") >= 0) { window.__pfStarts++; } return real.apply(this, arguments); }; window.__pfReal = real; })()`;
    await b.ev(started);
    await b.clickSel("#pfpick");
    check("pressed, the list opens in the page with the pictures in it",
          await b.waitFor(`${listOpen} && [...document.querySelectorAll("#platform .pf-oico img")].some(i => i.complete && i.naturalWidth > 0)`, 8000));
    await b.key("Escape");
    check("Esc closes the list and stays in the console",
          [await b.waitFor(`!${listOpen}`, 3000), await b.ev(`document.getElementById("syswall").hidden`), await b.ev(`document.getElementById("platform").value`)], [true, true, "Nintendo 64"]);
    const next = await b.ev(`(o => (o.slice(o.findIndex(x => x.value === "Nintendo 64") + 1).find(x => !x.disabled) || {}).value)([...document.getElementById("platform").options])`);
    await b.clickSel("#pfpick");
    await b.waitFor(listOpen, 3000);
    await b.key("ArrowDown");
    await b.key("Enter");
    check("Down and Enter there choose the next console, and no game is started",
          [await b.until(`document.getElementById("platform").value`, next, 5000), await b.ev(`window.__pfStarts`)], [next, 0]);
    await b.ev(`(() => { window.fetch = window.__pfReal; const p = document.getElementById("platform"); p.value = "Nintendo 64"; p.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await b.waitFor(`document.querySelectorAll("#view .tile").length === ${n}`, 8000);
  } else {
    console.log("    (this browser cannot dress a dropdown: the list is words, and its opening checks step aside)");
  }
  /* All platforms in the picker: a picture, or four squares when no picture
     answers. The squares are an svg, which has no `hidden` property to show it by. */
  const faceIs = `(() => { const f = document.getElementById("pf-face"), w = (s) => Math.round(f.querySelector(s).getBoundingClientRect().width), i = f.querySelector(".pf-ico");
    return { picture: !i.hidden && i.complete && i.naturalWidth > 0, squares: w(".pf-all") }; })()`;
  await b.ev(`(() => { const p = document.getElementById("platform"); p.value = ""; p.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  check("All platforms wears a picture in the picker", await b.waitFor(`document.getElementById("platform").value === "" && ${faceIs}.picture`, 8000));
  await b.ev(`document.querySelector("#pf-face .pf-ico").src = "api/image.php?platform=%40nosuchone&kind=icon"`);
  check("and four squares when no picture answers", [await b.waitFor(`${faceIs}.squares >= 16`, 5000), await b.ev(`${faceIs}.picture`)], [true, false]);
  await b.ev(`(() => { const p = document.getElementById("platform"); p.value = "Nintendo 64"; p.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await b.waitFor(`document.querySelectorAll("#view .tile").length === ${n}`, 8000);
  await b.openBar("view"); await b.menuItem(/^Platform sidebar$/);
  check("View switches it on",await b.waitFor(`document.getElementById("sidebar") && !document.getElementById("sidebar").hidden && document.querySelectorAll("#sidebar .sb-item").length > 10`, 5000));
  check("and the dropdown gives way to it on the bar", await b.ev(platformShown), false);
  check("the search box takes the right end of the bar", await b.ev(`(() => { const bar = document.getElementById("toolbar").getBoundingClientRect(), q = document.getElementById("qbox").getBoundingClientRect(); return bar.right - q.right < 12 && q.width >= 240; })()`));
  check("the open console is marked", await b.ev(`(x => x ? x.dataset.key : "")(document.querySelector("#sidebar .sb-item.on"))`), "Nintendo 64");
  // With the dropdown gone, the sidebar is the only road to another console,
  // so a search that finds nothing must leave it standing.
  await b.ev(`(q => { q.value = "zzqqxx nothing like this"; q.dispatchEvent(new Event("input", { bubbles: true })); })(document.getElementById("q"))`);
  await b.waitFor(`!!document.querySelector("#view .empty")`, 8000);
  check("a search that finds nothing leaves the sidebar standing", await b.ev(`(s => !!s && !s.hidden && s.offsetWidth > 100)(document.getElementById("sidebar"))`));
  await b.ev(`(q => { q.value = ""; q.dispatchEvent(new Event("input", { bubbles: true })); })(document.getElementById("q"))`);
  await b.waitFor(`document.querySelectorAll("#view .tile").length === ${n}`, 8000);
  check("with the icon pack's pictures", await b.waitFor(`[...document.querySelectorAll("#sidebar .sb-ico img")].some(i => i.complete && i.naturalWidth > 0)`, 8000));
  await b.ev(`[...document.querySelectorAll("#sidebar .sb-item")].find(x => x.dataset.key === "").click()`);
  check("pressing All games opens the whole library", await b.waitFor(`document.getElementById("platform").value === "" && document.querySelectorAll("#view .tile").length > ${n}`, 8000));
  await b.ev(`[...document.querySelectorAll("#sidebar .sb-item")].find(x => x.dataset.key === "Nintendo 64").click()`);
  await b.waitFor(`document.querySelectorAll("#view .tile").length === ${n}`, 8000);
  // Choosing the wheel inside a platform goes back to the wall first (that
  // is the wheel's whole journey), so the platform is opened again in it.
  await b.setView("wheel");
  await b.openPlatform("Nintendo 64");
  check("the wheel never shows it", await b.ev(`document.querySelectorAll(".witem").length > 0 && document.getElementById("sidebar").hidden`));
  check("and keeps its platform dropdown", await b.ev(platformShown));
  await b.setView("grid");
  await b.openBar("view"); await b.menuItem(/^Platform sidebar$/);
  check("and View switches it off again", await b.waitFor(`document.getElementById("sidebar").hidden`, 5000));
  check("with the dropdown back on the bar", await b.ev(platformShown));

  /* The wordmark is the round X where the menu bar is not: a wheel, a carousel
     or rows. In a grid the X is on the bar and the wordmark is a picture.
     logoState: is it the X, is it lit, the menu's first three entries, does it hang under it. */
  const logoState = `(() => { const c = document.querySelector(".ctx"), l = document.getElementById("brand-logo"), t = l.getBoundingClientRect(), r = c && c.getBoundingClientRect();
    return [l.classList.contains("as-orb"), l.classList.contains("open"), c ? [...c.querySelectorAll(".ctx-label")].slice(0, 3).map(x => x.textContent).join(", ") : null, !!c && r.top >= t.bottom && Math.abs(r.left - t.left) < 3]; })()`;
  const X_MENU = [true, true, "Settings..., Controller..., Back up what you made...", true];
  const X_SHUT = [true, false, null, false];
  const shutMenu = async () => { await b.key("Escape"); await b.until(`!document.querySelector(".ctx")`); };
  await b.clickSel("#brand-logo"); await sleep(250);
  check("in a grid a press on the wordmark opens nothing: the round X is on the bar", await b.ev(logoState), [false, false, null, false]);

  await b.openBar("view"); await b.menuItem(/^Wheel$/);
  check("View menu switches view", await b.until(`document.getElementById("viewsel").value`, "wheel"), "wheel");
  await b.settled();

  await b.clickSel("#brand-logo");
  check("on the consoles wheel a press on the wordmark opens the round X's menu under it, and lights it", await b.until(logoState, X_MENU, 3000), X_MENU);
  await b.key("ArrowRight"); await sleep(200);
  check("right, in that menu, opens no menu of a bar that is not on screen", await b.ev(logoState), X_MENU);
  await b.clickSel("#brand-logo");
  check("a second press puts the menu away", await b.until(logoState, X_SHUT, 3000), X_SHUT);
  await b.openPlatform("Nintendo 64");
  await b.clickSel("#brand-logo");
  check("the same over a wheel of games", await b.until(logoState, X_MENU, 3000), X_MENU);
  await b.menuItem(/^Settings\.\.\.$/);
  check("and its Settings... opens Settings", await b.until(`!document.getElementById("settings").hidden`, true, 8000), true);
  await b.key("Escape");
  await b.until(`document.getElementById("settings").hidden`);
  await b.settled();
  await b.setView("rows");
  await b.clickSel("#brand-logo");
  check("the same over rows", await b.until(logoState, X_MENU, 3000), X_MENU);
  await shutMenu();
  await b.setView("carousel");
  await b.clickSel("#brand-logo");
  check("and over a carousel", await b.until(logoState, X_MENU, 3000), X_MENU);
  await shutMenu();
  check("the log has the presses", await apiUntil(async () => ((await api("api/log.php?tail=1000")).lines || []).filter((l) => /CLK\s+brand-logo/.test(l)).length >= 5, 6000), true);
  await b.setView("wheel");                 // the consoles wheel again, as the checks below found it

  /* Clicking the dark behind a panel closes it on the press, not the release:
     a text selection let go past the panel's edge is a release on the dark. */
  async function box(sel) {
    return JSON.parse(await b.ev(`JSON.stringify((q => ({ l: Math.round(q.left), t: Math.round(q.top), w: Math.round(q.width) }))(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect()))`));
  }
  await b.clickSel("#btn-settings");
  await b.waitFor(`!document.getElementById("settings").hidden`);
  await b.settled();
  let p = await box("#settings .set-inner");
  await b.drag(p.l + Math.round(p.w / 2), p.t + 40, 8, p.t + 40);
  await sleep(400);
  check("a selection that runs off Settings leaves it open", await b.ev(`!document.getElementById("settings").hidden`));
  await b.pressAt(8, p.t + 40);
  check("pressing the dark closes Settings", await b.until(`document.getElementById("settings").hidden`));
  await b.releaseAt(8, p.t + 40); await sleep(400);
  check("and lets go of nothing else", await b.ev(`document.getElementById("editor").hidden && document.getElementById("details").hidden`));

  await b.clickSel("#btn-add");
  await b.waitFor(`!document.getElementById("editor").hidden`);
  await b.settled();
  p = await box("#editor .panel-inner");
  await b.drag(p.l + Math.round(p.w / 2), p.t + 40, 8, p.t + 40);
  await sleep(400);
  check("a selection that runs off a panel leaves it open", await b.ev(`!document.getElementById("editor").hidden`));
  await b.pressAt(8, p.t + 40);
  check("pressing the dark closes the panel", await b.until(`document.getElementById("editor").hidden`));
  await b.releaseAt(8, p.t + 40); await sleep(300);

  /* A game that runs in an emulator of its own: Emulation offers Open and that emulator's name, not
     Open RetroArch, and pressing it asks for that game's emulator. The test server starts nothing. */
  const own = ((await api("api/library.php")).games || []).filter((g) => g.emu && g.playable);
  if (own.length) {
    const plat = own[0].platform;
    const wanted = [...new Set(own.filter((g) => g.platform === plat).map((g) => "Open " + g.emu))];
    await b.goto();
    await b.setView("grid");
    await b.openPlatform(plat);
    await b.contextMenu("#view .tile.sel");
    await b.ev(`[...document.querySelectorAll(".ctx .ctx-item")].find(n => /Emulation/.test(n.textContent)).click()`);
    await b.waitFor(`[...document.querySelectorAll(".ctx .ctx-label")].some(x => x.textContent === "Controls...")`, 6000);
    const inGroup = await b.ev(`[...document.querySelectorAll(".ctx .ctx-item:not(.off) .ctx-label")].map(x => x.textContent)`);
    check("a game that runs in an emulator of its own offers to open that one, and not RetroArch (" + plat + ")",
          [inGroup.some((l) => wanted.includes(l)), inGroup.includes("Open RetroArch")], [true, false]);
    await b.ev(`(() => { window.__emu = []; const real = window.fetch; window.fetch = function (u, o) { if (String(u).indexOf("api/emuopen.php") !== -1) { window.__emu.push(String((o || {}).body || "")); } return real.call(this, u, o); }; })()`);
    await b.ev(`[...document.querySelectorAll(".ctx .ctx-label")].find(x => /^Open /.test(x.textContent)).closest(".ctx-item").click()`);
    await b.waitFor(`window.__emu.length > 0`, 6000);
    check("pressing it asks the server for that game's emulator, once", /^\{"id":"[^"|]+"\}$/.test(await b.ev(`window.__emu.join("|")`)), true);
    check("and the strip says which one is opening",
          await b.waitFor(`${JSON.stringify(wanted.map((w) => w.slice(5) + " is opening"))}.some(s => document.getElementById("strip").textContent.indexOf(s) !== -1)`, 6000));
  }

  /* The keys in a group's box: Right or Enter on its row goes in, Left or Esc comes back out and
     closes it, and only then does Esc close the menu. One list is walked at a time, the box's or the menu's. */
  await b.goto();
  await b.setView("grid");
  await b.openPlatform("Nintendo 64");
  await b.contextMenu("#view .tile.sel");
  const AT = `[...document.querySelectorAll(".ctx-item.at")].map(n => (n.closest(".ctx-sub") ? "box: " : "menu: ") + n.querySelector(".ctx-label").textContent).join()`;
  const BOXES = `document.querySelectorAll(".ctx").length`;
  for (let i = 0; i < 20 && (await b.ev(AT)) !== "menu: Emulation"; i++) { await b.key("ArrowDown"); }
  check("Down reaches Emulation, and standing on it opens nothing", [await b.ev(AT), await b.ev(BOXES)], ["menu: Emulation", 1]);
  await b.key("ArrowRight");
  check("Right on Emulation goes into its box, on its first entry", [await b.until(AT, "box: Set Core...", 3000), await b.ev(BOXES)], ["box: Set Core...", 2]);
  await b.key("ArrowDown");
  check("Down walks the box", await b.until(AT, "box: Set Emulator...", 3000), "box: Set Emulator...");
  await b.key("ArrowLeft");
  check("Left closes the box and stands on Emulation, the menu still up", [await b.until(AT, "menu: Emulation", 3000), await b.ev(BOXES)], ["menu: Emulation", 1]);
  await b.key("Enter");
  check("Enter opens it as Right does", [await b.until(AT, "box: Set Core...", 3000), await b.ev(BOXES)], ["box: Set Core...", 2]);
  await b.key("Escape");
  check("Esc closes the box only", [await b.until(AT, "menu: Emulation", 3000), await b.ev(BOXES)], ["menu: Emulation", 1]);
  await b.key("Escape");
  check("and Esc again closes the menu", await b.until(BOXES, 0, 3000), 0);
};
