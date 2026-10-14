// Every window open and shut, and nothing open that should not be: a check
// that does not ask what else is on screen misses a window left standing.
// Each window is closed every way there is, and after each step exactly what
// should be up is said. SCREEN_RULES (lib.js) is checked at every step too.
"use strict";
const { sleep, SCREENS, SCREEN_RULES } = require("./lib");

module.exports = async function (b, check) {
  /* What is up, compared on the keys given, and the rules on top. Waited
     for rather than read once: a window closes on the press, but its
     arrival and departure are animated. */
  async function expect(name, want) {
    const keys = Object.keys(want);
    const pick = `(s => ({ ${keys.map((k) => k + ": s." + k).join(", ")} }))(${SCREENS})`;
    const got = await b.until(pick, want, 4000);
    check(name, got, want);
    const bad = await b.ev(SCREEN_RULES);
    if (bad.length) { check(name + ": and no rule broken", bad.join("; "), ""); }
  }
  const box = async (sel) => b.ev(`(r => ({ l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width) }))(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`);
  const NOTHING = { details: false, settings: false, editor: false, mailbox: false, menus: 0, picker: 0, saver: false };

  // ---- the consoles screen, and into a console ----
  await b.goto();
  await expect("the app opens on the consoles screen alone", Object.assign({ wall: true, main: false, toolbar: false, consolesBtn: false }, NOTHING));
  await b.enterConsole();
  await expect("Enter opens the console: the games and their bar, no consoles", Object.assign({ wall: false, main: true, toolbar: true, consolesBtn: true }, NOTHING));

  // ---- details: Space, then every way out ----
  await b.key(" ");
  await expect("Space opens details, in place of the games", { details: true, main: false, wall: false, toolbar: false });
  await b.key("Escape");
  await expect("Esc closes details and the games come back", { details: false, main: true, toolbar: true, wall: false });
  await b.key(" ");
  await b.until(`!document.getElementById("details").hidden`);
  await b.ev(`[...document.querySelectorAll("#details button")].find(x => /Back/.test(x.textContent)).click()`);
  await expect("its Back button does the same", { details: false, main: true, wall: false });
  await b.key(" ");
  await b.until(`!document.getElementById("details").hidden`);
  await b.key("Backspace");
  await expect("and so does Backspace", { details: false, main: true, wall: false });
  await b.key(" ");
  await b.until(`!document.getElementById("details").hidden`);
  await b.key("Escape"); await b.until(`document.getElementById("details").hidden`);
  await b.key("Escape");
  await expect("Esc twice from details lands on the consoles, with no details over them", { wall: true, main: false, details: false });

  // details, then a view change, then the consoles (the bug this group is for)
  await b.enterConsole();
  await b.key(" ");
  await b.until(`!document.getElementById("details").hidden`);
  await b.setView("carousel");
  await expect("a view change from the dropdown puts details away", { details: false });
  await b.setView("wheel");
  await expect("and the consoles come up with nothing of the game's over them", { wall: true, details: false, main: false });

  // ---- the right-click menu ----
  await b.setView("grid");
  await b.openPlatform("Nintendo 64");
  await b.contextMenu("#view .tile.sel");
  await expect("a right-click opens one menu", { menus: 1, main: true });
  await b.key("Escape");
  await expect("Esc closes the menu and only the menu", { menus: 0, main: true, wall: false });
  await b.contextMenu("#view .tile.sel");
  await b.ev(`document.querySelectorAll("#view .tile")[3].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 600, clientY: 500 }))`);
  await expect("a second right-click still leaves one menu, not two", { menus: 1 });
  await b.key("Escape");
  await b.until(`!document.querySelector(".ctx")`);
  await b.contextMenu("#view .tile.sel");
  const cnt = await box("#count");
  await b.click(cnt.l + 5, cnt.t + 5);
  await expect("a press outside the menu closes it", { menus: 0, main: true });

  // ---- an editor from the menu: Esc, then the dark around it ----
  await b.contextMenu("#view .tile.sel");
  await b.menuItem(/Edit Metadata/);
  await expect("Edit Metadata opens the editor, and the menu is gone", { editor: true, menus: 0, settings: false });
  await b.key("Escape");
  await expect("Esc closes the editor, back to the games", { editor: false, main: true, wall: false });
  await b.contextMenu("#view .tile.sel");
  await b.menuItem(/Edit Metadata/);
  await b.until(`!document.getElementById("editor").hidden`); await b.settled();
  const ed = await box("#editor .panel-inner");
  await b.pressAt(8, ed.t + 40); await b.releaseAt(8, ed.t + 40);
  await expect("a press on the dark around it closes it too", { editor: false, main: true });

  // ---- Settings: Esc, and its Close button ----
  await b.clickSel("#btn-settings");
  await expect("Settings opens over the games", { settings: true, editor: false, menus: 0 });
  await b.key("Escape");
  await expect("Esc closes Settings", { settings: false, main: true, wall: false });
  await b.clickSel("#btn-settings");
  await b.until(`!document.getElementById("settings").hidden`); await b.settled();
  await b.ev(`[...document.querySelectorAll("#settings .set-head button")].find(x => /Close/.test(x.textContent)).click()`);
  await expect("and so does its Close button", { settings: false, main: true });
  // a tool opened from Settings takes its place rather than stacking on it
  await b.clickSel("#btn-settings");
  await b.until(`!document.getElementById("settings").hidden`); await b.settled();
  await b.ev(`[...document.querySelectorAll("#settings .set-tab")].find(t => /Debug/.test(t.textContent)).click()`);
  await b.ev(`[...document.querySelectorAll("#settings button")].find(x => x.textContent.trim() === "Show the log").click()`);
  await expect("the log opened from Settings takes Settings' place", { editor: true, settings: false });
  await b.key("Escape");
  await expect("and Esc closes it back onto Settings, where it was opened from", { editor: false, settings: true, menus: 0 });
  await b.ev(`[...document.querySelectorAll("#settings .set-head button")].find(x => /Close/.test(x.textContent)).click()`);
  await expect("and closing Settings then leaves nothing behind", { editor: false, settings: false, main: true });

  // ---- the log viewer by its key ----
  await b.key("l");
  await expect("L opens the log", { editor: true });
  await b.key("Escape");
  await expect("Esc closes the log", { editor: false, main: true });

  // ---- the mailbox ----
  await b.clickSel("#btn-mail");
  await expect("the mail button opens the mailbox", { mailbox: true, menus: 0 });
  await b.key("Escape");
  await expect("Esc closes the mailbox, and only the mailbox", { mailbox: false, main: true, wall: false });
  await b.clickSel("#btn-mail");
  await b.until(`(n => !!n && !n.hidden)(document.getElementById("mailbox"))`); await b.settled();
  await b.clickSel("#btn-mail");
  await expect("the mail button again closes it", { mailbox: false });

  // ---- Filter by, the funnel ----
  await b.ev(`document.getElementById("btn-filter").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))`);
  await expect("the funnel opens the Filter by window, and no menu", { editor: true, menus: 0 });
  await b.key("Escape");
  await expect("Esc closes it", { editor: false, menus: 0, main: true });

  // ---- the list's column picker ----
  await b.setView("list");
  await b.until(`!!document.querySelector("#view .lh-cols")`);
  await b.ev(`document.querySelector("#view .lh-cols").click()`);
  await expect("the lines at the end of the headers open the column picker", { picker: 1 });
  // The button closes what it opened, not closes and opens again in one press.
  await b.ev(`document.querySelector("#view .lh-cols").click()`);
  await expect("the same button again puts it away", { picker: 0 });
  await b.ev(`document.querySelector("#view .lh-cols").click()`);
  await expect("and a third press opens it once more", { picker: 1 });
  await b.ev(`document.getElementById("count").click()`);
  await expect("a press outside puts it away", { picker: 0 });
  await b.ev(`document.querySelector("#view .lh-cols").click()`);
  await b.until(`!!document.querySelector(".lcols")`);
  await b.setView("grid");
  await expect("changing view takes it away with the list", { picker: 0, main: true });

  // ---- the screensaver ----
  await b.ev(`(async () => { const St = await import("/js/state.js"), Ss = await import("/js/status.js");
    St.S.screensaver = { enabled: true, afterMin: 0.0001, everySec: 60 }; await new Promise(r => setTimeout(r, 30)); Ss.checkIdle(); })()`);
  await expect("the screensaver comes up when idle", { saver: true });
  await b.ev(`import("/js/status.js").then(m => m.touch())`);
  await expect("and goes at a touch, leaving the games as they were", { saver: false, main: true, wall: false, details: false });

  // ---- and back to the consoles clean ----
  await b.key("Escape");
  await expect("Esc from the games goes to the consoles with nothing left open", Object.assign({ wall: true, main: false, toolbar: false }, NOTHING));
  await sleep(0);
};
