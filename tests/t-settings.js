// The settings screen: its console-menu shape, finding a setting, driving it
// with the arrows, and the three things it grew (accent, text size, snap
// volume). settings.json is one of the protected files, so the saves here are
// put back by the runner however the run ends.
"use strict";
const fs = require("fs");
const path = require("path");
const { sleep, api, apiUntil, DATA, BASE } = require("./lib");

async function open(b) {
  if (await b.ev(`document.getElementById("settings").hidden`)) {
    await b.clickSel("#btn-settings");
    await b.waitFor(`!document.getElementById("settings").hidden`);
    await b.settled();
  }
}
const closeX = `[...document.querySelectorAll("#settings .set-head button")].find(x => x.textContent === "Close (esc)").click()`;
/* Closing Settings draws the page again when something was saved: wait for
   the new page (the old one is marked before the press, as goto does).
   Answers whether a new page came. */
async function closeAndReload(b) {
  await b.ev(`window.__xsLeaving = true`);
  await b.ev(closeX);
  const came = await b.waitQuiet(`!window.__xsLeaving && document.readyState === "complete"`, 10000);
  await b.waitQuiet(`document.getElementById("count").textContent !== ""`, 10000);
  await b.settled();
  return came;
}
const atRow = `(n => n ? n.querySelector("label").firstChild.textContent : null)(document.querySelector("#settings .opt.at"))`;
const atInput = `document.querySelector("#settings .opt.at input, #settings .opt.at select")`;

module.exports = async function (b, check) {
  /* Dragged column widths are saved as names and numbers, not a list: a row
     that joins them as a list stops the screen opening. The whole group
     runs with some saved; the Guard puts the file back. */
  await api("api/settings.php", { view: { listWidths: { title: 212, platform: 89 } } });
  await b.goto();
  await b.key("Escape");
  await open(b);
  check("it opens with column widths saved", await b.ev(`document.querySelectorAll("#settings .set-tab").length > 0`));

  // ---- the shape: a category per page, an icon on every line ----
  check("thirteen categories down the side", await b.ev(`document.querySelectorAll("#settings .set-tab").length`), 13);
  /* The order is the check: what you change often comes first
     (xs_settings_order), and a category added without being placed falls to the end. */
  check("what you change most comes first", await b.ev(`[...document.querySelectorAll("#settings .tab-label")].map(n => n.textContent).join(",")`),
    "Sound,Video,Xsegon Controls,RetroArch + Emulator Controls,View,Feel,Launching,Emulators,Library,Paths,Window,Screensaver,Debug");
  check("and settings opens on the first of them", await b.ev(`(document.querySelector("#settings .set-page:not([hidden]) h2")||{}).textContent`), "Sound");
  check("every category has a drawn icon", await b.ev(`[...document.querySelectorAll("#settings .set-tab")].every(t => !!t.querySelector(".tab-ico svg path, .tab-ico svg rect, .tab-ico svg circle"))`));
  check("and a chevron, the way a console menu says there is more", await b.ev(`document.querySelectorAll("#settings .tab-more").length`), 13);
  check("every row has a drawn icon", await b.ev(`[...document.querySelectorAll("#settings .opt")].every(r => !!r.querySelector(".opt-ico svg"))`));
  /* Every row wears a name, never its key: a setting with no schema entry is
     drawn under the key itself. Hidden pages count: every page is built when
     Settings opens. */
  check("no row is named by its key", await b.ev(`[...document.querySelectorAll("#settings .set-page .opt > label")].map(l => (l.firstChild && l.firstChild.textContent || "").trim()).filter(t => /^[a-z]+[A-Z][A-Za-z]*$/.test(t))`), []);
  check("one page shows at a time", await b.ev(`[...document.querySelectorAll("#settings .set-page")].filter(p => !p.hidden).length`), 1);
  check("the bar starts in the category list", await b.ev(`!!document.querySelector("#settings .set-tab.at")`));
  // The gradient lives on an overlay, so its opacity can ease between rows.
  check("the bar is a gradient that eases in", await b.ev(`(() => { const s = getComputedStyle(document.querySelector("#settings .set-tab.at"), "::before"); return /linear-gradient/.test(s.backgroundImage) && parseFloat(s.opacity) > 0; })()`));

  /* ---- the tooltips ----
     A pointer resting on a row brings a card. Real pointer moves (CDP),
     never synthetic events: the card only shows while the row is truly
     under the pointer, and that is one of the guardrails proved here. */
  const tipHid = `(n => !n || n.hidden)(document.querySelector(".set-tip"))`;
  const tipShown = `(n => !!n && !n.hidden)(document.querySelector(".set-tip"))`;
  const restOn = async (sel, nudge = 0) => {
    const p = await b.ev(`(r => { const c = r.getBoundingClientRect(); return { x: Math.round(c.left + 40), y: Math.round(c.top + c.height / 2) }; })(${sel})`);
    await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x + nudge, y: p.y, button: "none", buttons: 0 });
  };
  await restOn(`document.querySelector('#settings .set-page[data-group=sound] .opt')`);
  await sleep(800);
  check("a tooltip does not come at once", await b.ev(tipHid), true);
  check("resting on a row for a moment brings it", await b.until(tipShown, true, 3000), true);
  check("naming the row", await b.ev(`document.querySelector(".set-tip .tip-name").textContent`), "Sounds for what you do");
  check("with its words at reading size", await b.ev(`/Move, select, back/.test(document.querySelector(".set-tip .tip-body").textContent)`));
  check("and the default and the key it saves", await b.ev(`document.querySelector(".set-tip .tip-foot").textContent`), "Default: on · saved as sound.sounds");
  check("the card itself takes no pointer, so it can never hold its own hover", await b.ev(`getComputedStyle(document.querySelector(".set-tip")).pointerEvents`), "none");
  await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2, button: "none", buttons: 0 });
  check("moving off the row puts it away", await b.until(tipHid, true), true);
  // A category tab wears one too, saying what is behind it before it opens.
  await restOn(`document.querySelector("#settings .set-tab.on")`);
  check("a category tab has a card as well", await b.until(tipShown, true, 3000), true);
  check("with the category's own words", await b.ev(`/Every noise Xsegon makes/.test(document.querySelector(".set-tip .tip-body").textContent)`));
  // The guardrails. A key means the hand moved on: away at once.
  await b.key("ArrowDown");
  check("any key puts it away at once", await b.until(tipHid, true), true);
  // That key also walked the categories and opened the next page, so come
  // back to Sound before resting on its rows again.
  await b.ev(`(() => { const t = [...document.querySelectorAll("#settings .set-tab")].find(x => x.textContent.includes("Sound")); t.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })); t.click(); })()`);
  await b.until(`[...document.querySelectorAll("#settings .set-page")].find(p => !p.hidden).dataset.group`, "sound");
  // And the watchdog: a row hidden under a resting pointer (here by the find
  // box) takes its card with it within half a second, with no event to help.
  await restOn(`document.querySelector('#settings .set-page:not([hidden]) .opt')`, 1);
  check("resting again brings the card back", await b.until(tipShown, true, 3000), true);
  await b.ev(`(() => { const f = document.querySelector(".set-find input"); f.value = "qqzz"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  check("a row hidden under a resting pointer takes its card with it", await b.until(tipHid, true, 3000), true);
  await b.ev(`(() => { const f = document.querySelector(".set-find input"); f.value = ""; f.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await b.until(`[...document.querySelectorAll("#settings .set-page")].filter(p => !p.hidden).length`, 1);

  /* ---- the pointer opens a category ----
     The pointer moves onto a tab before it clicks, and the bar follows the
     move: if the bar and the open page were one field, the click would do nothing. */
  const clickTab = (name) => b.ev(`(() => { const t = [...document.querySelectorAll("#settings .set-tab")].find(x => x.textContent.includes(${JSON.stringify(name)})); t.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })); t.click(); })()`);
  await clickTab("Library");
  check("clicking a category opens it", await b.until(`[...document.querySelectorAll("#settings .set-page")].find(p => !p.hidden).dataset.group`, "library"), "library");
  check("and its tab is the one marked", await b.ev(`document.querySelector("#settings .set-tab.on .tab-label").textContent`), "Library");
  await clickTab("Screensaver");
  check("and again, from a tab the pointer is already on", await b.until(`[...document.querySelectorAll("#settings .set-page")].find(p => !p.hidden).dataset.group`, "screensaver"), "screensaver");
  await clickTab("Paths");
  check("and back", await b.until(`[...document.querySelectorAll("#settings .set-page")].find(p => !p.hidden).dataset.group`, "paths"), "paths");

  // ---- the arrows drive it ----
  // With the LaunchBox folder row hidden (path empty; js\state.js
  // launchBoxOff), the bar lands one row further down, so the expected rows follow the data.
  const lbRow = ((await api("api/settings.php")).settings.paths.launchbox || "") !== "";
  await b.key("ArrowRight");
  check("right goes into the page", await b.until(atRow, lbRow ? "LaunchBox folder" : "ROM drive"), lbRow ? "LaunchBox folder" : "ROM drive");
  await b.key("ArrowDown");
  check("down moves the bar", await b.until(atRow, lbRow ? "ROM drive" : "Steam folder"), lbRow ? "ROM drive" : "Steam folder");
  await b.key("Escape");
  check("Esc comes back to the categories", await b.until(`!!document.querySelector("#settings .set-tab.at")`));
  check("and does not close the screen", await b.ev(`!document.getElementById("settings").hidden`));
  /* Down moves by one, whatever the list is: the movement is the behaviour,
     the destination is the list's business. */
  const atTab = `document.querySelector("#settings .set-tab.at .tab-label").textContent`;
  const labels = await b.ev(`[...document.querySelectorAll("#settings .tab-label")].map(n => n.textContent)`);
  const startTab = await b.ev(atTab);
  const nextTab = labels[(labels.indexOf(startTab) + 1) % labels.length];
  await b.key("ArrowDown");
  check("down walks the categories", await b.until(atTab, nextTab), nextTab);
  await b.key("ArrowUp");
  check("and up walks back", await b.until(atTab, startTab), startTab);

  // ---- sound, in two named halves ----
  await clickTab("Sound");
  check("the page follows a click", await b.until(`[...document.querySelectorAll("#settings .set-page")].find(p => !p.hidden).dataset.group`, "sound"), "sound");
  check("Sound comes in its named parts", await b.ev(`[...document.querySelectorAll("#settings .set-page[data-group=sound] .sect-name")].map(n => n.textContent).join("|")`), "In the app|Video snaps|Your own sounds");
  check("all of them show at once", await b.ev(`document.querySelectorAll("#settings .set-page[data-group=sound] .set-sect:not([hidden])").length`), 3);
  /* ---- sections you can see the edges of ----
     Every page is in named boxes with a border, and every row has a line
     under it, so where one setting ends is plain. */
  check("every page is in sections, Emulators with them", await b.ev(`[...document.querySelectorAll("#settings .set-page")].filter(p => !p.querySelector(".set-sect")).map(p => p.dataset.group).join(",")`), "");
  /* Every setting under a heading that folds. The one box without is the
     signpost at the top of Xsegon Controls, which is no setting. */
  check("and every box of every page has a heading that folds, but the signpost on Xsegon Controls",
        await b.ev(`[...document.querySelectorAll("#settings .set-sect")].filter(s => !s.querySelector(":scope > .sect-head")).map(s => s.closest(".set-page").dataset.group + ":" + s.querySelectorAll(".opt").length).join(",")`), "controller:1");
  check("Window, Screensaver and Emulators say what each part holds",
        await b.ev(`["window", "screensaver", "emulators"].map(g => [...document.querySelectorAll("#settings .set-page[data-group=" + g + "] .sect-name")].map(n => n.textContent).join("|")).join(" / ")`),
        "Closing Xsegon|On a big screen|Connecting a phone|New versions / When it starts|What it shows / Add and set up|Your emulators|Achievements");
  check("every section heading has its fold drawn", await b.ev(`[...document.querySelectorAll("#settings .sect-head")].every(h => !!h.querySelector(".sect-caret svg path"))`));
  check("a section has a border you can see", await b.ev(`(s => parseFloat(s.borderTopWidth) >= 1 && s.borderTopStyle === "solid")(getComputedStyle(document.querySelector("#settings .set-page[data-group=sound] .set-sect")))`));
  check("and so does every row", await b.ev(`(s => parseFloat(s.borderBottomWidth) >= 1 && !/, 0\\.0\\d\\)$/.test(s.borderBottomColor))(getComputedStyle(document.querySelector("#settings .set-page[data-group=sound] .set-sect .opt")))`));
  check("Launching comes in the order a game does", await b.ev(`[...document.querySelectorAll("#settings .set-page[data-group=launch] .sect-name")].map(n => n.textContent).join("|")`), "Before a game starts|While it plays|When it ends");
  check("everything opens unfolded", await b.ev(`document.querySelectorAll("#settings .set-sect.shut").length`), 0);

  check("and the button that brings the packs in", await b.waitFor(`[...document.querySelectorAll("#settings .set-page[data-group=sound] .opt")].some(n => /Sound packs/.test(n.textContent))`));
  check("which says how many are Xsegon's own", await b.waitFor(`/Xsegon's own|none of them copied/.test([...document.querySelectorAll("#settings .set-page[data-group=sound] .opt")].map(n => n.textContent).join(" "))`));
  // The set that ships with Xsegon (sounds\Xsegon) is counted apart from
  // the packs, and is one of the sets to choose from.
  check("and that the built-in set is there too, on the row and in the list of sets",
        [await b.waitFor(`/built-in set/.test([...document.querySelectorAll("#settings .set-page[data-group=sound] .opt")].find(n => /Sound packs/.test(n.textContent)).textContent)`),
         await b.ev(`[...document.querySelector('#settings [data-key="soundSet"]').options].some(o => o.value === "Xsegon")`)], [true, true]);
  // Both built-in sets, and every sound in them decoded by the browser, the .ogg included.
  check("the other built-in set is on the list as Xsegon 2",
        await b.ev(`[...document.querySelector('#settings [data-key="soundSet"]').options].some(o => o.value === "Xsegon 2")`), true);
  check("every built-in sound decodes in the browser, with a length to it",
        await b.ev(`(async () => {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const out = [];
          for (const [set, name] of [["Xsegon", "move"], ["Xsegon", "hover"], ["Xsegon", "select"], ["Xsegon", "back"], ["Xsegon", "ok"], ["Xsegon 2", "move"], ["Xsegon 2", "select"], ["Xsegon 2", "back"], ["Xsegon 2", "ok"]]) {
            try {
              const r = await fetch("api/sound.php?name=" + name + "&set=" + encodeURIComponent(set), { cache: "no-store" });
              const d = await ctx.decodeAudioData(await r.arrayBuffer());
              // Hover is a tick of a tenth of a second or so, by design
              out.push(d.duration > (name === "hover" ? 0.02 : 0.1) ? "" : set + "/" + name + " is " + d.duration + " s");
            } catch (e) { out.push(set + "/" + name + ": " + e.message); }
          }
          ctx.close();
          return out.filter(Boolean).join(" | ");
        })()`), "");

  // ---- left and right change the value under the bar ----
  await b.key("ArrowRight");
  check("first row of Sound", await b.until(atRow, "Sounds for what you do"), "Sounds for what you do");
  await b.key("ArrowLeft");
  check("left turns a switch off", await b.until(`${atInput}.checked`, false), false);
  await b.key("ArrowRight");
  check("right turns it on", await b.until(`${atInput}.checked`, true), true);
  await b.key("ArrowDown");
  await b.until(`${atInput}.type === "range"`);
  const v0 = Number(await b.ev(`${atInput}.value`));
  /* Right first, unless the level is at the top: then left first. The volume
     is the person's own, copied into the sandbox; at the top a right does
     nothing and an untaken-back left redraws the page on close. */
  const atTop = await b.ev(`Number(${atInput}.value) >= Number(${atInput}.max)`);
  const [away, home1, by] = atTop ? ["ArrowLeft", "ArrowRight", -1] : ["ArrowRight", "ArrowLeft", 1];
  await b.key(away);
  const v1 = Number(await b.until(`${atInput}.value`, String(v0 + by)));
  check("right steps a slider up by its step", (v1 - v0) * by, 1);
  check("and the number beside it follows", await b.until(`document.querySelector("#settings .opt.at .set-range-n").textContent`, String(v1)), String(v1));
  await b.key(home1);
  check("left steps it back", Number(await b.until(`${atInput}.value`, String(v0))), v0);
  await b.key("ArrowDown");
  await b.until(`${atInput}.tagName === "SELECT"`);
  const was = await b.ev(`${atInput}.value`);
  /* Right first, unless the answer chosen is the last on the list: then left
     first. Which set is chosen is the person's own, copied into the sandbox. */
  const atEnd = await b.ev(`${atInput}.selectedIndex === ${atInput}.options.length - 1`);
  const [out, home] = atEnd ? ["ArrowLeft", "ArrowRight"] : ["ArrowRight", "ArrowLeft"];
  await b.key(out);
  check("right walks a dropdown to the next answer", await b.until(`${atInput}.value !== ${JSON.stringify(was)}`));
  await b.key(home);
  check("and left walks it back", await b.until(`${atInput}.value`, was), was);

  // ---- find a setting ----
  // RetroArch's own volume hotkeys are rows of the RetroArch + Emulator Controls page where
  // RetroArch has them set, and "volume" finds those as well: counted, not assumed.
  const volKeys = (((await api("api/controls.php?hotkeys=1")).hotkeys || {}).other || []).filter((h) => /volume/i.test(h.name + " " + h.value + " " + h.ra)).map((h) => h.name);
  await b.ev(`(() => { const f = document.querySelector(".set-find input"); f.value = "volume"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  // (the page list already said "sound" before the search ran: wait on the rows)
  await b.until(`[...document.querySelectorAll("#settings .opt:not(.no-match)")].filter(n => n.offsetParent).length`, 2 + volKeys.length);
  check("finding shows every page that matches", await b.ev(`[...document.querySelectorAll("#settings .set-page")].filter(p => !p.hidden && !p.classList.contains("no-match")).map(p => p.dataset.group).join(",")`), volKeys.length ? "sound,gamecontrols" : "sound");
  // And draws no other: every category's title and words above the answer
  // push it off the bottom of the screen.
  check("and draws no page that does not", await b.ev(`[...document.querySelectorAll("#settings .set-page")].filter(p => p.offsetParent).map(p => p.dataset.group).join(",")`), volKeys.length ? "sound,gamecontrols" : "sound");
  check("and only the rows that match", await b.ev(`[...document.querySelectorAll("#settings .opt:not(.no-match)")].filter(n => n.offsetParent).map(n => n.querySelector("label").firstChild.textContent).join("|")`), ["Volume", "Snap volume"].concat(volKeys).join("|"));
  check("the arrows move through what it found", await b.ev(`(() => { const r = [...document.querySelectorAll("#settings .opt:not(.no-match)")].filter(n => n.offsetParent); return r.length; })()`), 2 + volKeys.length);
  await b.ev(`(() => { const f = document.querySelector(".set-find input"); f.value = "qqzz"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await b.until(`!!document.querySelector("#settings .set-none")`);
  check("nothing matching says so", await b.ev(`(n => !!n && /qqzz/.test(n.textContent))(document.querySelector("#settings .set-none"))`));
  await b.ev(`(() => { const f = document.querySelector(".set-find input"); f.value = ""; f.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await b.until(`[...document.querySelectorAll("#settings .set-page")].filter(p => !p.hidden).length`, 1);
  check("clearing it goes back to one page", await b.ev(`[...document.querySelectorAll("#settings .set-page")].filter(p => !p.hidden).length`), 1);

  /* ---- controls: two pages, one per program ----
     Xsegon Controls is getting around Xsegon; RetroArch + Emulator Controls
     is the controls inside games. A heading is a row the bar stands on: left
     folds it, right opens it, A does either; folded rows leave the walk. */
  const ctl = `#settings .set-page[data-group=controller]`;
  const rctl = `#settings .set-page[data-group=gamecontrols]`;
  const sect = (name) => `document.querySelector('#settings .set-sect[data-sect="${name}"]')`;
  const XS = "Xsegon (Gamepad)", XM = "Xsegon (Mouse and keyboard)", RB = "RetroArch (Gamepad)", RK = "RetroArch (Keyboard)", RH = "RetroArch (Hotkeys and turbo)";
  const tabFor = (re) => `[...document.querySelectorAll("#settings .set-tab")].find(t => ${re}.test(t.textContent))`;
  const pageNow = `[...document.querySelectorAll("#settings .set-page")].find(p => !p.hidden).dataset.group`;
  const atHead = `(n => n ? n.querySelector(".sect-name").textContent : null)(document.querySelector("#settings .sect-head.at"))`;
  check("every category name fits on its tab", await b.ev(`[...document.querySelectorAll("#settings .set-tab .tab-label")].filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.textContent)`), []);
  check("the two Controls pages stand side by side in the list, Xsegon's first",
    await b.ev(`(t => t.indexOf("Xsegon Controls") >= 0 && t.indexOf("RetroArch + Emulator Controls") === t.indexOf("Xsegon Controls") + 1)([...document.querySelectorAll("#settings .set-tab .tab-label")].map(n => n.textContent))`), true);
  await b.ev(`${tabFor("/^RetroArch \\+ Emulator Controls/")}.click()`);
  await b.until(pageNow, "gamecontrols");
  check("RetroArch + Emulator Controls holds the controls inside games, each heading naming RetroArch",
    await b.ev(`[...document.querySelectorAll("${rctl} .sect-name")].map(n => n.textContent).join("|")`), RB + "|" + RK + "|" + RH);
  check("and says other emulators and Steam games keep their own", await b.ev(`/Other emulators and Steam games keep their controls in their own settings/.test(document.querySelector("${rctl} .group-help").textContent)`), true);
  check("and has no way back to Xsegon Controls on it: the one way across is from Xsegon Controls", await b.ev(`[...document.querySelectorAll("${rctl} .opt button")].some(x => /^Go there/.test(x.textContent))`), false);
  check("its name on the side list is two lines, RetroArch + Emulator, then Controls",
    await b.ev(`(t => [...t.querySelectorAll(".tl")].map(n => [n.textContent.trim(), Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight))]))(${tabFor("/^RetroArch/")})`),
    [["RetroArch + Emulator", 1], ["Controls", 1]]);
  await b.ev(`${tabFor("/^Xsegon Controls/")}.click()`);
  await b.until(pageNow, "controller");
  const across = `[...document.querySelectorAll("${ctl} .opt")].find(r => r.querySelector("button") && /^Go there/.test(r.querySelector("button").textContent))`;
  await b.ev(`${across}.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))`);
  check("the row with the way across never lights up as a row: only its button does",
    await b.ev(`(r => [getComputedStyle(r, "::before").opacity, getComputedStyle(r).boxShadow, getComputedStyle(r.querySelector("button")).boxShadow !== "none"])(${across})`), ["0", "none", true]);
  await b.ev(`${across}.querySelector("button").click()`);
  check("and its button goes to RetroArch + Emulator Controls", await b.until(pageNow, "gamecontrols"), "gamecontrols");
  await b.ev(`${tabFor("/^Xsegon Controls/")}.click()`);
  await b.until(pageNow, "controller");
  await b.settled();
  check("Xsegon Controls has its two sections, each heading naming Xsegon", await b.ev(`[...document.querySelectorAll("${ctl} .sect-name")].map(n => n.textContent).join("|")`), XS + "|" + XM);
  check("and says at the top it is not used in games", await b.ev(`/Not used in games/.test(document.querySelector("${ctl} .group-help").textContent)`), true);
  check("all of it at once, and no tabs", await b.ev(`[...document.querySelectorAll("${ctl} .set-sect")].filter(s => s.offsetParent).length + "," + document.querySelectorAll("#settings .sub-strip").length`), "3,0");
  check("the pad settings are the first", await b.ev(`[...document.querySelectorAll("${ctl} .opt")].filter(n => n.offsetParent).some(n => /deadzone/i.test(n.textContent))`));
  check("and the mouse settings are in front of you", await b.ev(`[...${sect(XM)}.querySelectorAll(".opt")].filter(n => n.offsetParent).map(n => n.querySelector("label").firstChild.textContent).join("|")`),
    "Scroll wheel turns the rim|Scroll speed|Scroll momentum|Scroll acceleration|Drag to spin|Clicking the chosen game|Hide the pointer when it stops|Hide it after (seconds)|Arrows wrap around the ends");
  const unfoldedFile = fs.readFileSync(path.join(DATA, "settings.json"), "utf8");
  await b.key("ArrowRight");
  check("into the page lands on its first row, the way to the other page", await b.until(atRow, "Looking for the controls inside your games?"), "Looking for the controls inside your games?");
  await b.key("ArrowDown");
  await b.key("ArrowDown");
  check("then the first setting, under its heading", await b.until(atRow, "Controller navigation"), "Controller navigation");
  await b.key("ArrowUp");
  check("up from there stands on the heading", await b.until(atHead, XS), XS);
  await b.key("ArrowLeft");
  check("left folds the section", await b.until(`${sect(XS)}.classList.contains("shut")`, true), true);
  check("its rows go", await b.ev(`[...${sect(XS)}.querySelectorAll(".opt")].filter(n => n.offsetParent).length`), 0);
  check("and its heading says how many", await b.ev(`${sect(XS)}.querySelector(".sect-count").textContent`), "10 settings");
  await b.key("ArrowDown");
  check("down steps over what is folded", await b.until(atHead, XM), XM);
  await b.key("ArrowUp");
  await b.key("ArrowRight");
  check("right opens it again", await b.until(`${sect(XS)}.classList.contains("shut")`, false), false);
  await b.key("Enter");
  check("A folds it", await b.until(`${sect(XS)}.classList.contains("shut")`, true), true);
  await b.key("Enter");
  check("and opens it", await b.until(`${sect(XS)}.classList.contains("shut")`, false), false);
  await b.ev(`${sect(XM)}.querySelector(".sect-head").click()`);
  check("a click folds one too", await b.until(`${sect(XM)}.classList.contains("shut")`, true), true);
  await b.ev(`(() => { const f = document.querySelector(".set-find input"); f.value = "pointer"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  // Sound under the pointer and its limit answer to the same word from
  // Sound's first section; the two after them are the folded one's.
  const found = "Sound under the pointer|Sounds under the pointer, at most|Hide the pointer when it stops|Hide it after (seconds)";
  check("a search reaches into a folded section", await b.until(`[...document.querySelectorAll("#settings .opt:not(.no-match)")].filter(n => n.offsetParent).map(n => n.querySelector("label").firstChild.textContent).join("|")`, found), found);
  check("and shows no section with nothing in it", await b.ev(`[...document.querySelectorAll("#settings .set-sect")].filter(s => s.offsetParent).map(s => s.dataset.sect).join("|")`), "In the app|" + XM);
  await b.ev(`(() => { const f = document.querySelector(".set-find input"); f.value = ""; f.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await b.until(`[...document.querySelectorAll("#settings .set-page")].filter(p => !p.hidden).length`, 1);
  // Never saved: the next time Settings opens, everything is open.
  await b.key("Escape"); await b.key("Escape");
  await b.until(`document.getElementById("settings").hidden`, true);
  await open(b);
  check("folding is never kept: it opens unfolded again", await b.ev(`document.querySelectorAll("#settings .set-sect.shut").length`), 0);
  check("and nothing about it was saved", fs.readFileSync(path.join(DATA, "settings.json"), "utf8") === unfoldedFile, true);
  await b.ev(`${tabFor("/^RetroArch \\+ Emulator Controls/")}.click()`);
  await b.until(pageNow, "gamecontrols");

  /* ---- In games: your buttons per console, set by pressing them ----
     A stand-in pad through navigator.getGamepads (headless Chrome has none).
     Pressing the bottom button for A swaps A and B; a dry launch must point
     RetroArch at Xsegon's own remap folder for that run, in RetroArch's words. */
  const padOf = (list) => (list.consoles || []).find((c) => c.buttons.some((x) => x.sends === "a") && c.buttons.some((x) => x.sends === "b"));
  const padKeep = (padOf(await api("api/pad-remap.php")) || {});
  if (padKeep.map && Object.keys(padKeep.map).length) {
    // The copy carries buttons of yours for it: standard for the test, put back after.
    await api("api/pad-remap.php", { platform: padKeep.platform, map: {} });
    await b.ev(`import("/js/settings-ui.js").then((m) => m.openSettings())`);
    await b.until(`!!document.querySelector("#settings .set-tab")`, true);
    await b.ev(`${tabFor("/^RetroArch \\+ Emulator Controls/")}.click()`);
  }
  check("In games lists the consoles whose buttons can be set", await b.waitFor(`document.querySelectorAll("#settings .padrow select option").length > 0`, 8000));
  const padList = await api("api/pad-remap.php");
  const padC = padOf(padList);
  if (!padC) {
    check("a console with an A and a B to try it on", false);
  } else {
    await b.ev(`(s => { s.value = String(${padList.consoles.indexOf(padC)}); s.dispatchEvent(new Event("change")); })(document.querySelector("#settings .padrow select"))`);
    const padRow = (name) => `[...document.querySelectorAll("#settings .padrow")].find(r => r.querySelector("label").firstChild.textContent === ${JSON.stringify(name)})`;
    const aName = padC.buttons.find((x) => x.sends === "a").name, bName = padC.buttons.find((x) => x.sends === "b").name;
    check("each button shows the pad button it is on", await b.ev(`${padRow(aName)}.querySelector(".padbtn").textContent`), "B (right)");
    /* The wait is said plainly: keyboard keys are answered, not walked into
       the list behind, and it says only a controller's buttons are set here.
       First with no controller at all. */
    const padNote = `document.querySelector("#settings .pad-note")`;
    await b.ev(`${padRow(aName)}.querySelector(".padbtn").click()`);
    check("with no controller, choosing a button says none has been seen, and that keyboard keys are not set here",
      await b.until(`(n => [n.classList.contains("hearing"), /no controller has been seen yet/.test(n.textContent), /Keyboard keys are not set here/.test(n.textContent)].join())(${padNote})`, "true,true,true"), "true,true,true");
    const rowWas = await b.ev(`(document.querySelector("#settings .opt.at") || {}).textContent || ""`);
    await b.key("ArrowDown");
    check("a keyboard key pressed meanwhile is answered on screen, and the wait goes on",
      await b.until(`(n => [/That was a key on the keyboard/.test(n.textContent), !!document.querySelector("#settings .padbtn.catching")].join())(${padNote})`, "true,true"), "true,true");
    check("and the key went no further: the list behind did not move",
      await b.ev(`(document.querySelector("#settings .opt.at") || {}).textContent || ""`), rowWas);
    await b.key("Escape");
    check("Esc leaves it as it was, with Settings still open",
      await b.until(`[${padNote}.textContent, !!document.querySelector("#settings .padbtn.catching"), document.getElementById("settings").hidden].join()`, "Left as it was.,false,false"), "Left as it was.,false,false");
    await b.ev(`import("/js/log.js").then((m) => { m.flushLog(); })`);
    await sleep(300);
    const padLog = ((await api("api/log.php?tail=120")).lines || []).filter((l) => / P PADS /.test(l)).join("\n");
    check("each of those is in the log: the wait with no controller, the key, the Esc",
      [/listening for a controller button \(no controller seen yet\)/.test(padLog), /the keyboard.s ArrowDown was pressed while listening/.test(padLog), /cancelled with Esc/.test(padLog)], [true, true, true]);
    await b.ev(`window.__padWas = navigator.getGamepads; window.__pad = { id: "stand-in", mapping: "standard", connected: true, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }; navigator.getGamepads = () => [window.__pad]`);
    await b.ev(`${padRow(aName)}.querySelector(".padbtn").click()`);
    check("choosing one waits for a press", await b.until(`!!document.querySelector("#settings .padbtn.catching")`), true);
    check("and with a controller here, says it is listening for its button", await b.ev(`/^Listening: press the controller button you want for /.test(${padNote}.textContent)`), true);
    await sleep(200);
    await b.ev(`window.__pad.buttons[0].pressed = true`);
    await sleep(200);
    await b.ev(`window.__pad.buttons[0].pressed = false`);
    check("pressing the bottom button puts it there", await b.until(`${padRow(aName)}.querySelector(".padbtn").textContent`, "A (bottom)"), "A (bottom)");
    check("and the one it took over swaps to where it was", await b.ev(`${padRow(bName)}.querySelector(".padbtn").textContent`), "B (right)");
    check("and Settings itself heard nothing of the press", await b.ev(`!document.getElementById("settings").hidden`), true);
    check("it is kept", await apiUntil(async () => JSON.stringify(((await api("api/pad-remap.php")).consoles.find((c) => c.platform === padC.platform) || {}).map) === JSON.stringify({ b: "a", a: "b" })));
    const padGame = (await api("api/library.php")).games.find((g) => g.platform === padC.platform && g.playable && !g.local);
    if (padGame) {
      const dry = await api("api/launch.php", { id: padGame.id, dry: true });
      check("that console's game is pointed at Xsegon's remaps, for that run only",
        dry.ok && !!dry.pads && dry.append.some((l) => /^input_remapping_directory = /.test(l)) && dry.append.includes('config_save_on_exit = "false"'), true);
      const rmp = dry.pads ? fs.readdirSync(dry.pads.folder).flatMap((d) => fs.readdirSync(path.join(dry.pads.folder, d)).map((f) => fs.readFileSync(path.join(dry.pads.folder, d, f), "utf8"))).join("\n") : "";
      check("in RetroArch's own words: the bottom button sends A, the right one B",
        /input_player1_btn_b = "8"/.test(rmp) && /input_player1_btn_a = "0"/.test(rmp), true);
    }
    check("a change that would leave a button dead is refused", (await api("api/pad-remap.php", { platform: padC.platform, map: { a: "b" } })).ok, false);
    await b.ev(`[...document.querySelectorAll("#settings .padrow button")].find(x => x.textContent === "Standard layout").click()`);
    check("Standard layout puts them back", await apiUntil(async () => Object.keys(((await api("api/pad-remap.php")).consoles.find((c) => c.platform === padC.platform) || {}).map || {}).length === 0));
    if (padGame) {
      check("and a launch adds nothing for them then",
        ((await api("api/launch.php", { id: padGame.id, dry: true })).append || []).some((l) => /remap/.test(l)), false);
    }

    /* ---- players 2 to 4 with buttons of their own ----------------------
       A console's buttons are player 1's; the others share them until given
       their own (data\player-remaps.json), written under that player's port
       alone. The console is standard here (reset above). */
    const plSel = `[...document.querySelectorAll("#settings .padrow")].find(r => r.querySelector("label").firstChild.textContent === "Player").querySelector("select")`;
    const plBtn = (text) => `[...document.querySelectorAll("#settings .padrow button")].find(x => x.textContent === ${JSON.stringify(text)})`;
    const plOf = async () => ((await api("api/pad-remap.php")).consoles.find((c) => c.platform === padC.platform) || {});
    // The core's own file of the launch just staged: the newest one in Xsegon's remap folder.
    const plFile = (dry) => {
      if (!dry.pads) { return ""; }
      const all = fs.readdirSync(dry.pads.folder).map((d) => path.join(dry.pads.folder, d, d + ".rmp")).filter((f) => fs.existsSync(f));
      all.sort((x, y) => fs.statSync(y).mtimeMs - fs.statSync(x).mtimeMs);
      return all.length ? fs.readFileSync(all[0], "utf8") : "";
    };
    const plPorts = (text) => [1, 2, 3, 4].map((n) => text.includes("input_player" + n + '_btn_b = "8"'));
    check("a Player row offers four players, and starts on player 1", await b.ev(`(s => [s.options.length, s.value].join())(${plSel})`), "4,1");
    await b.ev(`(s => { s.value = "2"; s.dispatchEvent(new Event("change")); })(${plSel})`);
    check("player 2 starts with player 1's buttons, and has none of their own to give up",
      await b.ev(`[${padRow(aName)}.querySelector(".padbtn").textContent, ${plBtn("Same as player 1")}.disabled].join()`), "B (right),true");
    await b.ev(`${padRow(aName)}.querySelector(".padbtn").click()`);
    await b.until(`!!document.querySelector("#settings .padbtn.catching")`, true);
    await sleep(200);
    await b.ev(`window.__pad.buttons[0].pressed = true`);
    await sleep(200);
    await b.ev(`window.__pad.buttons[0].pressed = false`);
    check("a button pressed under player 2 moves it for player 2", await b.until(`${padRow(aName)}.querySelector(".padbtn").textContent`, "A (bottom)"), "A (bottom)");
    check("it is kept as player 2's own, and player 1's are left standard",
      await apiUntil(async () => { const c = await plOf(); return JSON.stringify([c.map, c.players]) === JSON.stringify([{}, { 2: { b: "a", a: "b" } }]); }));
    check("the picker says who has their own", await b.ev(`[...${plSel}.options].map(o => o.textContent).join("|")`),
      "Player 1|Player 2  (their own)|Player 3  (same as player 1)|Player 4  (same as player 1)");
    await b.ev(`(s => { s.value = "1"; s.dispatchEvent(new Event("change")); })(${plSel})`);
    check("player 1's rows still show the standard buttons", await b.ev(`${padRow(aName)}.querySelector(".padbtn").textContent`), "B (right)");
    if (padGame) {
      const plDry = await api("api/launch.php", { id: padGame.id, dry: true });
      check("a launch writes the swap under player 2's port alone",
        [plPorts(plFile(plDry)), !!plDry.pads && plDry.pads.players["2"]], [[false, true, false, false], 2]);
    }
    await b.ev(`(s => { s.value = "2"; s.dispatchEvent(new Event("change")); })(${plSel})`);
    await b.ev(`${plBtn("Same as player 1")}.click()`);
    check("Same as player 1 gives the own buttons up", await apiUntil(async () => Object.keys((await plOf()).players || {}).length === 0));
    check("and the rows show player 1's again", await b.ev(`${padRow(aName)}.querySelector(".padbtn").textContent`), "B (right)");
    await b.ev(`(s => { s.value = "1"; s.dispatchEvent(new Event("change")); })(${plSel})`);
    if (padGame) {
      check("and a launch adds nothing then", ((await api("api/launch.php", { id: padGame.id, dry: true })).append || []).some((l) => /remap/.test(l)), false);
      // The other way round: player 1 with a swap, player 2 standard on purpose.
      await api("api/pad-remap.php", { platform: padC.platform, map: { b: "a", a: "b" } });
      check("an empty set is kept as player 2's own: standard, whatever player 1 has",
        ((r) => [r.ok, r.own])(await api("api/pad-remap.php", { platform: padC.platform, player: 2, map: {} })), [true, true]);
      check("then players 1, 3 and 4 get player 1's swap and player 2 gets none",
        plPorts(plFile(await api("api/launch.php", { id: padGame.id, dry: true }))), [true, false, true, true]);
      const plGm = await api("api/game-remap.php?id=" + padGame.id);
      await api("api/game-remap.php", { id: padGame.id, map: { b: "a", a: "b" } });
      const plGmDry = await api("api/launch.php", { id: padGame.id, dry: true });
      check("a game with buttons of its own keeps those for every player",
        [!!plGmDry.pads && plGmDry.pads.gameOwn, !!plGmDry.pads && Object.keys(plGmDry.pads.players).length], [true, 0]);
      await api("api/game-remap.php", { id: padGame.id, map: plGm.own ? plGm.map : null });
      await api("api/pad-remap.php", { platform: padC.platform, map: {} });
    }
    check("a player outside 1 to 4 is refused",
      [(await api("api/pad-remap.php", { platform: padC.platform, player: 5, map: {} })).ok, (await api("api/pad-remap.php", { platform: padC.platform, player: 0, map: {} })).ok], [false, false]);
    check("and so is a set of theirs that would leave a button dead", (await api("api/pad-remap.php", { platform: padC.platform, player: 2, map: { a: "b" } })).ok, false);
    check("null puts a player back with player 1", ((r) => [r.ok, r.own])(await api("api/pad-remap.php", { platform: padC.platform, player: 2, map: null })), [true, false]);

    /* ---- one game's own buttons, over the console's ----------------------
       Kept per game id (data\game-remaps.json), written at launch under the
       ROM's own name. A game remap replaces the core's in RetroArch, so the
       map kept is the game's whole picture. The console is standard here. */
    if (padGame) {
      const gm = await api("api/game-remap.php?id=" + padGame.id);
      const gmKeep = gm.own ? gm.map : null;        // null: none of its own, as the API says it
      if (gm.own) { await api("api/game-remap.php", { id: padGame.id, map: null }); }
      check("a game's buttons answer: the console to start from, the layout, whether it has its own, whether RetroArch has a remap",
            [gm.ok, gm.platform, Array.isArray(gm.buttons) && gm.buttons.length > 0, typeof gm.own, typeof gm.theirs],
            [true, padC.platform, true, "boolean", "boolean"]);
      check("a map that would leave a button dead is refused", (await api("api/game-remap.php", { id: padGame.id, map: { a: "b" } })).ok, false);
      const localGame = (await api("api/library.php")).games.find((x) => x.local);
      if (localGame) {
        check("a game RetroArch does not run is refused", (await api("api/game-remap.php?id=" + localGame.id)).ok, false);
      }
      check("a swap is kept for the game", (await api("api/game-remap.php", { id: padGame.id, map: { b: "a", a: "b" } })).ok, true);
      const gmDry = await api("api/launch.php", { id: padGame.id, dry: true });
      check("a launch stages the game's own buttons, the console's standing standard",
            [gmDry.ok, !!gmDry.pads && gmDry.pads.game, !!gmDry.pads && gmDry.pads.moved,
             (gmDry.append || []).some((l) => /^input_remapping_directory = /.test(l))],
            [true, 2, 0, true]);
      const gmFiles = gmDry.pads ? fs.readdirSync(gmDry.pads.folder).flatMap((d) =>
        fs.readdirSync(path.join(gmDry.pads.folder, d)).map((f) => ({ d: d, f: f }))) : [];
      const gmOwn = gmFiles.find((x) => x.f.toLowerCase().endsWith(".rmp") && x.f.toLowerCase() !== (x.d + ".rmp").toLowerCase());
      check("written under the ROM's own name, in RetroArch's words",
            !!gmOwn && /input_player1_btn_b = "8"/.test(fs.readFileSync(path.join(gmDry.pads.folder, gmOwn.d, gmOwn.f), "utf8")), true);
      check("all sixteen buttons are written, the unmoved as themselves: RetroArch reads a game's file instead of the console's",
            !!gmOwn && (fs.readFileSync(path.join(gmDry.pads.folder, gmOwn.d, gmOwn.f), "utf8").match(/^input_player1_btn_/gm) || []).length, 16);
      const gmFull = await api("api/game.php?id=" + padGame.id);
      check("the details record offers the door, counts the buttons and says they are its own",
            [gmFull.game.padable, gmFull.game.gameButtons, gmFull.game.gameOwn], [true, 2, true]);
      const gmPanel = await api("api/controls.php?id=" + encodeURIComponent(padGame.id));
      check("the Controls panel lists the game's own buttons", ((gmPanel.gameMap || {}).changes || []).length, 2);

      /* The standard layout on purpose: with its console remapped, a game set
         back to standard must not read as "follow the console". An empty map
         is its own choice, apart from none (null), staged as sixteen buttons
         each sending itself. */
      await api("api/pad-remap.php", { platform: padC.platform, map: { b: "a", a: "b" } });
      const gmStd = await api("api/game-remap.php", { id: padGame.id, map: {} });
      check("an empty map is kept as the game's own: standard, whatever its console's", [gmStd.ok, gmStd.own], [true, true]);
      const stdDry = await api("api/launch.php", { id: padGame.id, dry: true });
      const stdFile = stdDry.pads && gmOwn ? fs.readFileSync(path.join(stdDry.pads.folder, gmOwn.d, gmOwn.f), "utf8") : "";
      check("staged beside the console's swap as sixteen buttons each sending itself",
            [!!stdDry.pads && stdDry.pads.moved, !!stdDry.pads && stdDry.pads.gameOwn, /input_player1_btn_a = "8"/.test(stdFile) && /input_player1_btn_b = "0"/.test(stdFile)],
            [2, true, true]);
      check("and the Controls panel says standard on purpose",
            ((await api("api/controls.php?id=" + encodeURIComponent(padGame.id))).gameMap || {}).standard, true);
      const gmNone = await api("api/game-remap.php", { id: padGame.id, map: null });
      check("null takes the game's own away: it follows its console again", [gmNone.ok, gmNone.own], [true, false]);
      const backDry = await api("api/launch.php", { id: padGame.id, dry: true });
      check("and a launch then stages the console's alone", [!!backDry.pads && backDry.pads.moved, !!backDry.pads && backDry.pads.gameOwn], [2, false]);
      await api("api/pad-remap.php", { platform: padC.platform, map: {} });
      check("with the console standard again, nothing is staged at all", !!(await api("api/launch.php", { id: padGame.id, dry: true })).pads, false);
      if (gmKeep !== null) { await api("api/game-remap.php", { id: padGame.id, map: gmKeep }); }
    }
    await b.ev(`navigator.getGamepads = window.__padWas`);
    if (padKeep.map && Object.keys(padKeep.map).length) { await api("api/pad-remap.php", { platform: padKeep.platform, map: padKeep.map }); }

    /* ---- RetroArch (Keyboard): your keys per console --------------------
       A key pressed for a button, a key another button had swapping over,
       hotkey keys refused, the keys handed to RetroArch for that run only. */
    const keysFile = path.join(DATA, "pad-keys.json");
    const keysKeep = fs.existsSync(keysFile) ? fs.readFileSync(keysFile) : null;
    const press = async (key, code, vk) => {
      for (const type of ["keyDown", "keyUp"]) { await b.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, text: key.length === 1 ? key : undefined }); }
    };
    const kList = await api("api/pad-keys.php");
    const kC = (kList.consoles || []).find((c) => c.platform === padC.platform);
    check("RetroArch (Keyboard) offers the same consoles, each button with RetroArch's own key",
      [kList.ok, !!kC, !!kC && kC.buttons.length === padC.buttons.length && kC.buttons.every((x) => typeof x.own === "string")], [true, true, true]);
    /* Every console RetroArch plays here, not only the first easy ones:
       checked where this copy's library has them. */
    const padAll = (await api("api/pad-remap.php")).consoles || [];
    const n64 = padAll.find((c) => c.platform === "Nintendo 64"), sat = padAll.find((c) => c.platform === "Sega Saturn");
    if (n64) { check("the Nintendo 64 is offered, saying its C buttons are on the right stick", [n64.buttons.find((x) => x.name === "Z").sends, /C buttons/.test(n64.note || "")], ["l2", true]); }
    if (sat) { check("the Saturn is offered with its core's own buttons: C on R, Z on L", [sat.buttons.find((x) => x.name === "C").sends, sat.buttons.find((x) => x.name === "Z").sends], ["r", "l"]); }
    check("and the keyboard list offers the same consoles as the gamepad's", (kList.consoles || []).map((c) => c.platform).join("|"), padAll.map((c) => c.platform).join("|"));
    if (kC) {
      await api("api/pad-keys.php", { platform: kC.platform, keys: {} });
      const hotKey = Object.keys(kList.hot || {})[0];
      if (hotKey) {
        const refusedHot = await api("api/pad-keys.php", { platform: kC.platform, keys: { a: hotKey } });
        check("a key RetroArch keeps for a hotkey is refused, saying which", [refusedHot.ok, /is RetroArch's key for/.test(refusedHot.error || "")], [false, true]);
      }
      check("two buttons on one key are refused", (await api("api/pad-keys.php", { platform: kC.platform, keys: { a: "j", b: "j" } })).ok, false);
      check("and so is a key RetroArch does not know", (await api("api/pad-keys.php", { platform: kC.platform, keys: { a: "banana" } })).ok, false);
      const keySect = sect(RK);
      const keyRow = (name) => `[...${keySect}.querySelectorAll(".keyrow")].find(r => r.querySelector("label").firstChild.textContent === ${JSON.stringify(name)})`;
      const keyNote = `${keySect}.querySelector(".pad-note")`;
      await b.waitFor(`${keySect}.querySelectorAll(".keyrow").length > 1`, 8000);
      // Chosen by name: Every console stands first in the picker, before the consoles.
      const pickKeys = (name) => b.ev(`(s => { s.value = [...s.options].find(o => o.text.replace(/\\s+\\(yours\\)$/, "") === ${JSON.stringify(name)}).value; s.dispatchEvent(new Event("change")); })(${keySect}.querySelector(".keyrow select"))`);
      check("the picker opens on Every console, the consoles after it",
        await b.ev(`(s => [s.options[s.selectedIndex].text, s.options.length])(${keySect}.querySelector(".keyrow select"))`), ["Every console", kList.consoles.length + 1]);
      await pickKeys(kC.platform);
      await b.ev(`${keyRow(aName)}.querySelector(".keybtn").click()`);
      check("choosing a button listens for a key, and says so",
        await b.until(`[!!document.querySelector("#settings .keybtn.catching"), ${keyNote}.classList.contains("hearing"), /press the key you want/.test(${keyNote}.textContent)].join()`, "true,true,true"), "true,true,true");
      await press("j", "KeyJ", 74);
      check("pressing J puts it there", await b.until(`${keyRow(aName)}.querySelector(".keybtn").textContent`, "J"), "J");
      check("kept, as the one key that differs from RetroArch's",
        await apiUntil(async () => JSON.stringify(((await api("api/pad-keys.php")).consoles.find((c) => c.platform === kC.platform) || {}).mine) === JSON.stringify({ a: "j" })));
      if (padGame) {
        const kd = await api("api/launch.php", { id: padGame.id, dry: true });
        check("that console's game hands RetroArch the key, for that run only",
          [kd.keys, (kd.append || []).includes('input_player1_a = "j"'), (kd.append || []).includes('config_save_on_exit = "false"')], [1, true, true]);
      }
      const bOwn = kC.buttons.find((x) => x.sends === "b").own;
      if (/^[a-z]$/.test(bOwn)) {
        await b.ev(`${keyRow(aName)}.querySelector(".keybtn").click()`);
        await press(bOwn, "Key" + bOwn.toUpperCase(), bOwn.toUpperCase().charCodeAt(0));
        check("a key another button had swaps over: A takes it, and that button takes A's old key",
          await b.until(`[${keyRow(aName)}.querySelector(".keybtn").textContent, ${keyRow(bName)}.querySelector(".keybtn").textContent].join()`, bOwn.toUpperCase() + ",J"), bOwn.toUpperCase() + ",J");
      }
      if ((kList.hot || {}).f1) {
        await b.ev(`${keyRow(aName)}.querySelector(".keybtn").click()`);
        await press("F1", "F1", 112);
        check("a hotkey's key pressed on screen is refused, saying why, and the wait goes on",
          await b.until(`[/is RetroArch's key for/.test(${keyNote}.textContent), !!document.querySelector("#settings .keybtn.catching")].join()`, "true,true"), "true,true");
        await b.key("Escape");
        check("Esc leaves it as it was, with Settings still open", await b.until(`[${keyNote}.textContent, document.getElementById("settings").hidden].join()`, "Left as it was.,false"), "Left as it was.,false");
      }
      await b.ev(`[...${keySect}.querySelectorAll("button")].find(x => x.textContent === "RetroArch's keys").click()`);
      check("RetroArch's keys puts them all back",
        await apiUntil(async () => Object.keys(((await api("api/pad-keys.php")).consoles.find((c) => c.platform === kC.platform) || {}).mine || {}).length === 0));
      if (padGame) { check("and a launch then hands RetroArch no keys", (await api("api/launch.php", { id: padGame.id, dry: true })).keys, null); }

      /* A controller button while a key is awaited: answered in words, the
         wait over and nothing changed, so a press on the wrong thing is not
         taken for a fault. */
      await b.ev(`window.__kPadWas = navigator.getGamepads; window.__kPad = { id: "stand-in", mapping: "standard", connected: true, axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }; navigator.getGamepads = () => [window.__kPad]`);
      const aWas = await b.ev(`${keyRow(aName)}.querySelector(".keybtn").textContent`);
      await b.ev(`${keyRow(aName)}.querySelector(".keybtn").click()`);
      await b.until(`!!document.querySelector("#settings .keybtn.catching")`, true, 2000);
      await sleep(250);
      await b.ev(`window.__kPad.buttons[2].pressed = true`);
      check("a controller button pressed while a key is awaited is answered in words, and the wait ends",
        await b.until(`[/^That was a button on a controller, and a keyboard key is set here, so nothing changed\\./.test(${keyNote}.textContent), !!document.querySelector("#settings .keybtn.catching")].join()`, "true,false", 3000), "true,false");
      await b.ev(`window.__kPad.buttons[2].pressed = false`);
      await sleep(200);
      check("with the button's key as it was, and Settings still open", [await b.ev(`${keyRow(aName)}.querySelector(".keybtn").textContent`), await b.ev(`document.getElementById("settings").hidden`)], [aWas, false]);
      await b.ev(`navigator.getGamepads = window.__kPadWas`);

      /* ---- Every console: one set of keys under each console's own ----------
         RetroArch's sixteen buttons get a key once; a console follows until it
         has a key of its own there, and its own keys never share one. */
      const free = ["g", "v", "c", "d", "o"].filter((k) => !(k in (kList.hot || {})) && !((kList.every || {}).buttons || []).some((x) => x.own === k));
      check("the list offers Every console's keys: RetroArch's sixteen buttons, none of them set",
        [((kList.every || {}).buttons || []).length, Object.keys((kList.every || {}).mine || {}).length, free.length >= 3], [16, 0, true]);
      const [f1, f2, f3] = free;
      const consoleNow = async () => (await api("api/pad-keys.php")).consoles.find((c) => c.platform === kC.platform);
      const btnOf = (c, sends) => c.buttons.find((x) => x.sends === sends);
      const dryKeys = async () => { const d = await api("api/launch.php", { id: padGame.id, dry: true }); return [d.keys, d.keysEvery, (d.append || []).filter((l) => /^input_player1_(a|b) = /.test(l)).join("|")]; };
      check("a key for every console is kept", (await api("api/pad-keys.php", { every: true, keys: { a: f1 } })).ok, true);
      let cNow = await consoleNow();
      check("a console with no key of its own follows it, and its list says whose key that is",
        [btnOf(cNow, "a").key, btnOf(cNow, "a").own, btnOf(cNow, "a").every, btnOf(cNow, "b").every, Object.keys(cNow.mine).length], [f1, f1, true, false, 0]);
      if (padGame) { check("its game is handed that key, for that run only", await dryKeys(), [null, 1, `input_player1_a = "${f1}"`]); }
      check("a console's own key goes over it", (await api("api/pad-keys.php", { platform: kC.platform, keys: { a: f2 } })).ok, true);
      if (padGame) { check("and its game is then handed the console's own", await dryKeys(), [1, 1, `input_player1_a = "${f2}"`]); }
      const clash = await api("api/pad-keys.php", { every: true, keys: { a: f1, b: f2 } });
      check("a key for every console that this console has on another button is refused, naming the console",
        [clash.ok, (clash.error || "").indexOf("On " + kC.platform + ", which has keys of its own, ") === 0, / would share /.test(clash.error || "")], [false, true, true]);
      check("and what was kept for every console stands", JSON.stringify((await api("api/pad-keys.php")).every.mine), JSON.stringify({ a: f1 }));
      const hotKey2 = Object.keys(kList.hot || {})[0];
      if (hotKey2) { check("a key RetroArch keeps for a hotkey is refused for every console too", (await api("api/pad-keys.php", { every: true, keys: { a: hotKey2 } })).ok, false); }
      await api("api/pad-keys.php", { platform: kC.platform, keys: {} });
      await api("api/pad-keys.php", { every: true, keys: {} });
      if (padGame) { check("with both taken away a launch hands RetroArch no keys again", await dryKeys(), [null, null, ""]); }

      // On the page: a key pressed under Every console shows on the console, which says whose it is.
      const startOf = kC.buttons.find((x) => x.sends === "start");
      if (startOf) {
        await pickKeys("Every console");
        await b.ev(`${keyRow("Start")}.querySelector(".keybtn").click()`);
        await b.until(`!!document.querySelector("#settings .keybtn.catching")`, true, 2000);
        await press(f3, "Key" + f3.toUpperCase(), f3.toUpperCase().charCodeAt(0));
        check("pressing a key under Every console keeps it for every console",
          await apiUntil(async () => JSON.stringify((await api("api/pad-keys.php")).every.mine) === JSON.stringify({ start: f3 })));
        // An option's text comes back with its run of spaces as one.
        check("and the picker says Every console is yours", await b.until(`(s => s.options[0].text)(${keySect}.querySelector(".keyrow select"))`, "Every console (yours)", 3000), "Every console (yours)");
        await pickKeys(kC.platform);
        check("the console shows that key on its own button, and says it is Every console's",
          await b.until(`(r => [r.querySelector(".keybtn").textContent, r.querySelector(".hint").textContent].join("|"))(${keyRow(startOf.name)})`,
            f3.toUpperCase() + "|Every console's: " + f3.toUpperCase() + ". Choose, then press the key you want.", 4000),
          f3.toUpperCase() + "|Every console's: " + f3.toUpperCase() + ". Choose, then press the key you want.");
        check("and the way back from a key of its own is to Every console's keys",
          await b.ev(`[...${keySect}.querySelectorAll(".keyrow button")].some(x => x.textContent === "Every console's keys")`), true);
        await pickKeys("Every console");
        await b.ev(`[...${keySect}.querySelectorAll(".keyrow button")].find(x => x.textContent === "RetroArch's keys").click()`);
        check("RetroArch's keys under Every console takes them all away again",
          await apiUntil(async () => Object.keys((await api("api/pad-keys.php")).every.mine || {}).length === 0));
      }
    }
    if (keysKeep === null) { fs.rmSync(keysFile, { force: true }); } else { fs.writeFileSync(keysFile, keysKeep); }
  }

  /* ---- RetroArch hotkeys: how to leave, pause and turbo ----
     Read from RetroArch's own settings. Whatever is bound, the order is
     fixed: leaving and pausing, turbo fire, then the rest that are set. */
  const hkSect = sect(RH);
  const hkAns = await api("api/controls.php?hotkeys=1");
  if (hkAns.hotkeys) {
    await b.waitFor(`${hkSect}.querySelectorAll(".hkrow[data-hotkey]").length >= 8`, 8000);
    const hkIds = JSON.parse(await b.ev(`JSON.stringify([...${hkSect}.querySelectorAll(".hkrow[data-hotkey]")].map(r => r.dataset.hotkey))`));
    check("RetroArch hotkeys leads with leaving and pausing: menu, quit, close, pause, Hotkey Enable",
          hkIds.slice(0, 5), ["menu_toggle", "exit_emulator", "close_content", "pause_toggle", "enable_hotkey"]);
    check("then turbo fire: whether it is on, its button, its speed", hkIds.slice(5, 8), ["turbo_enable", "turbo_button", "turbo_speed"]);
    check("then every other hotkey that is set, as many as the server read", hkIds.length - 8, hkAns.hotkeys.other.length);
    check("a row says what is set, and under its name where in RetroArch it is changed",
          await b.ev(`(r => [r.querySelector(".hk-val").textContent.length > 0, /^In RetroArch: Settings > Input > Hotkeys > Quit\\./.test(r.querySelector(".hint").textContent)])(${hkSect}.querySelector('.hkrow[data-hotkey="exit_emulator"]'))`),
          [true, true]);
    check("the turbo button is changed on another page of RetroArch's, and its row says which",
          await b.ev(`/^In RetroArch: Settings > Input > (RetroPad Binds > Port 1 Controls|Turbo Fire) > Turbo\\./.test(${hkSect}.querySelector('.hkrow[data-hotkey="turbo_button"] .hint').textContent)`), true);
    check("only the menu, quit and turbo rows take a choice; the rest change nothing, and the last button opens RetroArch",
          await b.ev(`[${hkSect}.querySelectorAll(".opt input").length, [...${hkSect}.querySelectorAll(".opt select.hk-pick")].map(s => s.closest(".hkrow").dataset.hotkey).join("|"), [...${hkSect}.querySelectorAll(".opt button")].map(x => x.closest(".hkrow").dataset.hotkey || x.textContent).join("|")]`),
          [0, "menu_toggle|exit_emulator|turbo_enable|turbo_button|turbo_speed", "menu_toggle|turbo_button|Open RetroArch"]);
    /* Listening is a button beside the list, never an entry in it: Settings
       steps a list with left and right, and an entry that listens would take
       the next press (the D-pad or B) as the menu button. */
    check("no list has an entry that listens; the menu and the Turbo button have a button for it, each after its list",
          await b.ev(`[[...${hkSect}.querySelectorAll("select.hk-pick option")].some(o => /press it|listen/i.test(o.textContent) || o.value === "listen"),
                       [...${hkSect}.querySelectorAll(".hk-ctl")].map(c => [...c.children].map(n => n.tagName).join("+")).join("|")]`),
          [false, "SELECT+BUTTON|SELECT+BUTTON"]);
    check("and the row's first control is the list, which is what Settings works with the pad",
          await b.ev(`${hkSect}.querySelector('.hkrow[data-hotkey="menu_toggle"]').querySelector("input, select, button").tagName`), "SELECT");
    // The find box reaches them by the words a person would type.
    await b.ev(`(() => { const f = document.querySelector(".set-find input"); f.value = "turbo fire"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    check("the find box finds the turbo rows", await b.waitFor(`[...document.querySelectorAll("#settings .hkrow[data-hotkey]")].filter(r => r.offsetParent).some(r => r.dataset.hotkey === "turbo_enable")`, 4000));
    await b.ev(`(() => { const f = document.querySelector(".set-find input"); f.value = ""; f.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await b.until(`[...document.querySelectorAll("#settings .set-page")].filter(p => !p.hidden).length`, 1);

    /* ---- leaving and pausing, your choice ----
       A combo for either row; the Xbox button or a pressed pad button for the
       menu. Kept in data\ra-hotkeys.json, appended to Xsegon's RetroArch
       launches only; unset says nothing and RetroArch's own setting holds. */
    const rh = await api("api/ra-hotkeys.php");
    check("the choices answer: ten combos in 1.22.2's words, the Xbox button, the sdl2 names",
          [rh.ok, (rh.combos || []).length, ((rh.combos || []).find((c) => c.value === 4) || {}).words, rh.xbox && rh.xbox.btn, (rh.names || [])[5]],
          [true, 10, "Start + Select", 5, "the Xbox button"]);
    const rhKeep = rh.choices || {};
    check("a quit combo is kept, in words", ((await api("api/ra-hotkeys.php", { quit: { kind: "combo", combo: 4 } })).words || {}).quit, "Start + Select");
    check("a combo nobody has is refused", (await api("api/ra-hotkeys.php", { quit: { kind: "combo", combo: 99 } })).ok, false);
    check("quit cannot sit on a single button", (await api("api/ra-hotkeys.php", { quit: { kind: "button", btn: 5 } })).ok, false);
    check("the menu takes the Xbox button", (await api("api/ra-hotkeys.php", { menu: { kind: "button", btn: 5 } })).ok, true);
    const rhCon = (((await api("api/pad-remap.php")).consoles) || [])[0];
    const rhGame = rhCon && (await api("api/library.php")).games.find((g) => g.platform === rhCon.platform && g.playable && !g.local);
    if (rhGame) {
      const dry = await api("api/launch.php", { id: rhGame.id, dry: true });
      const btnOk = hkAns.hotkeys.driver === "sdl2";   // the button is a raw number, sdl2 only
      check("a launch carries the choices, the button only under sdl2, and saving on exit off",
            [dry.ok, (dry.append || []).includes('input_quit_gamepad_combo = "4"'),
             (dry.append || []).includes('input_menu_toggle_btn = "5"') === btnOk,
             (dry.append || []).includes('input_enable_hotkey_btn = "nul"') === btnOk,
             (dry.append || []).includes('config_save_on_exit = "false"'), typeof dry.hot === "string"],
            [true, true, true, true, true, true]);
      check("and the game's Controls panel says Yours on the quit row",
            ((((await api("api/controls.php?id=" + encodeURIComponent(rhGame.id))).hotkeys || {}).leave || []).find((h) => h.id === "exit_emulator") || {}).yours, "Start + Select");
    }
    // The page again, with the choices on it. Settings has to really close
    // first: openSettings over an open Settings rebuilds nothing.
    const hkPick = (id) => `((${hkSect} && ${hkSect}.querySelector('.hkrow[data-hotkey="${id}"] select.hk-pick')) || {})`;
    await b.key("Escape"); await b.key("Escape"); await b.key("Escape");
    await b.until(`document.getElementById("settings").hidden`, true);
    await open(b);
    await b.ev(`${tabFor("/^RetroArch \\+ Emulator Controls/")}.click()`);
    check("the pickers show what is chosen",
          await b.until(`[${hkPick("menu_toggle")}.value, ${hkPick("exit_emulator")}.value].join("|")`, "btn:5|combo:4"),
          "btn:5|combo:4");
    check("and the row still shows RetroArch's own value above the choice",
          await b.ev(`(((${hkSect} && ${hkSect}.querySelector('.hkrow[data-hotkey="menu_toggle"] .hk-set .hk-val')) || { textContent: "" }).textContent.length > 0)`), true);
    // Its listening button: the stand-in pad again; standard button 9 (Start) is sdl2's 6.
    await b.ev(`window.__padWas2 = navigator.getGamepads; window.__pad2 = { id: "stand-in", mapping: "standard", connected: true, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }; navigator.getGamepads = () => [window.__pad2]`);
    const hkHear = `(${hkSect} && ${hkSect}.querySelector('.hkrow[data-hotkey="menu_toggle"] .hk-listen'))`;
    await b.ev(`${hkHear}.click()`);
    check("the listening button says it is waiting", await b.until(`${hkHear}.classList.contains("catching")`, true), true);
    await sleep(200);
    await b.ev(`window.__pad2.buttons[9].pressed = true`);
    await sleep(200);
    await b.ev(`window.__pad2.buttons[9].pressed = false`);
    check("pressing a pad button keeps its sdl2 number for the menu",
          await apiUntil(async () => ((((await api("api/ra-hotkeys.php")).choices || {}).menu) || {}).btn === 6));
    check("and the picker shows it", await b.until(`${hkPick("menu_toggle")}.value`, "btn:6"), "btn:6");
    await b.ev(`navigator.getGamepads = window.__padWas2`);
    // RetroArch's own again, from the picker; then everything as it was.
    await b.ev(`(s => { if (s && s.dispatchEvent) { s.value = ""; s.dispatchEvent(new Event("change")); } })(${hkPick("exit_emulator")})`);
    check("RetroArch's own setting takes the quit choice away", await apiUntil(async () => !((await api("api/ra-hotkeys.php")).choices || {}).quit));
    await api("api/ra-hotkeys.php", { menu: null });
    if (rhGame) {
      check("and with nothing chosen a launch says nothing",
            ((await api("api/launch.php", { id: rhGame.id, dry: true })).append || []).some((l) => /menu_toggle|quit_gamepad|enable_hotkey/.test(l)), false);
    }
    await api("api/ra-hotkeys.php", { menu: rhKeep.menu || null, quit: rhKeep.quit || null });
    check("put back as they were", JSON.stringify((await api("api/ra-hotkeys.php")).choices), JSON.stringify(rhKeep));

    /* ---- turbo fire, your choice ----
       Nothing chosen says nothing, so turbo stays off until someone asks. A
       game's own choice (api\game-remap.php) wins over the global for that game. */
    const tbKeep = ((await api("api/ra-hotkeys.php")).choices || {}).turbo || null;
    if (tbKeep === null) {
      // Settings nudges a list with left and right whether or not it is asleep.
      const tbBtn = `${hkSect}.querySelector('.hkrow[data-hotkey="turbo_button"] select.hk-pick')`;
      await b.ev(`(s => { s.selectedIndex = 1; s.dispatchEvent(new Event("change", { bubbles: true })); })(${tbBtn})`);
      await sleep(150);
      check("with turbo not on, its button list nudged by the pad is put back and nothing is sent",
            [await b.ev(`[${tbBtn}.disabled, ${tbBtn}.value]`), ((await api("api/ra-hotkeys.php")).choices || {}).turbo === undefined],
            [[true, ""], true]);
    }
    check("a turbo choice that is not off or on is refused", (await api("api/ra-hotkeys.php", { turbo: { set: "maybe" } })).ok, false);
    check("a turbo speed outside 2 to 30 frames is refused", (await api("api/ra-hotkeys.php", { turbo: { set: "on", mode: 0, period: 99 } })).ok, false);
    check("turbo on is kept, its button and speed in words",
          ((await api("api/ra-hotkeys.php", { turbo: { set: "on", mode: 0, bind: 8, period: 6 } })).words || {}).turbo,
          "on, hold the Turbo button and a button, Turbo on A, a press every 6 frames");
    if (rhGame) {
      const tbDry = await api("api/launch.php", { id: rhGame.id, dry: true });
      check("a launch carries the turbo lines, RetroPad words so any driver",
            ['input_turbo_enable = "true"', 'input_turbo_mode = "0"', 'input_turbo_bind = "8"', 'input_turbo_period = "6"', 'config_save_on_exit = "false"']
              .every((l) => (tbDry.append || []).includes(l)) && /turbo=on/.test(tbDry.hot || ""), true);
      check("a game's own turbo is kept over the global", (await api("api/game-remap.php", { id: rhGame.id, turbo: { set: "off" } })).ok, true);
      check("and that game's launch says off while the global stands on",
            ((await api("api/launch.php", { id: rhGame.id, dry: true })).append || []).includes('input_turbo_enable = "false"'), true);
      check("the game's Controls panel says whose turbo it is",
            ((((await api("api/controls.php?id=" + encodeURIComponent(rhGame.id))).hotkeys || {}).turbo || []).find((h) => h.id === "turbo_enable") || {}).yours,
            "off (this game's own)");
      await api("api/game-remap.php", { id: rhGame.id, turbo: null });
      check("same as everywhere again", (await api("api/game-remap.php?id=" + rhGame.id)).turbo, null);
    }
    await api("api/ra-hotkeys.php", { turbo: tbKeep });
    check("turbo put back as it was", JSON.stringify(((await api("api/ra-hotkeys.php")).choices || {}).turbo || null), JSON.stringify(tbKeep));

    /* ---- the pinned jump: walk RetroArch to the page a setting lives on,
       offered only when every read condition holds (1.22.2 on the exe, ozone
       with Settings shown, network commands on). Dry only: the plan must
       agree with itself whichever way the RetroArch here falls. */
    const rj = (await api("api/ra-hotkeys.php")).jump || {};
    check("the answer says whether the pinned jump holds here",
          [typeof rj.ok, rj.ok ? rj.why === null : typeof rj.why === "string" && rj.why.length > 0],
          ["boolean", true]);
    const jp = await api("api/retroarch.php", { page: "hotkeys", dry: true });
    check("asked for the hotkeys page, the plan matches the pin and names the page",
          [jp.ok, jp.dry, jp.jump, jp.where,
           jp.jump ? jp.route : (typeof jp.note === "string" && jp.note.length > 0)],
          [true, true, rj.ok, "Settings > Input > Hotkeys",
           jp.jump ? "LEFT DOWN RIGHT DOWN DOWN DOWN OK DOWN DOWN OK" : true]);
    check("the turbo page has a walk of its own, one step shorter",
          (await api("api/retroarch.php", { page: "turbo", dry: true })).where, "Settings > Input > Turbo Fire");
    check("a page nobody knows is refused", (await api("api/retroarch.php", { page: "nowhere", dry: true })).ok, false);
  } else {
    check("with no RetroArch in use, the section says so and lists nothing",
          await b.ev(`[${hkSect}.querySelectorAll(".hkrow").length, ${hkSect}.querySelector(".pad-note").textContent.length > 0]`), [0, true]);
  }

  // ---- where the sound settings live now, and what came with them ----
  const before = await api("api/settings.php");
  check("sound is a category of its own", typeof before.defaults.sound, "object");
  check("with the app's noises in it", typeof before.settings.sound.soundSet, "string");
  check("and the snap's", typeof before.settings.sound.videoVolume, "number");
  check("video keeps only what it shows", Object.keys(before.defaults.video).join(","), "enabled,delaySec,inBrowse,inDetails,loop,markMissing,ssManuals");
  check("the accent is a setting", before.defaults.feel.accent, "cyan");
  // Not LaunchBox's "Classic": a copy with no LaunchBox has no Classic.
  check("a new copy starts on the sound set that ships with Xsegon", before.defaults.sound.soundSet, "Xsegon");
  // A number of pixels, where older files say Small, Normal or Large;
  // what Large was is the default.
  check("so is the menu text size, in pixels, Large's by default", before.defaults.feel.textSize, 19);

  /* A settings.json written before Sound was a category of its own. The file
     is one of the protected ones, and it is put back here as well. */
  const file = path.join(DATA, "settings.json");
  const kept = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, JSON.stringify({ feel: { volume: 33, soundSet: "Classic" }, video: { sound: false } }, null, 2));
  const fwd = await api("api/settings.php");
  // 33 on the old straight scale is 57 on the curve: as loud as it was
  check("an older settings.json is read forward", [fwd.settings.sound.volume, fwd.settings.sound.videoSound].join(","), "57,false");
  check("and the moved keys are not handed out twice", fwd.settings.feel.volume === undefined && fwd.settings.video.sound === undefined, true);
  /* The volume levels on a curve: a file saved before keeps its loudness,
     and its first save moves both levels and marks the file, so neither is
     ever moved twice. */
  fs.writeFileSync(file, JSON.stringify({ sound: { volume: 50, videoVolume: 60 } }, null, 2));
  const straight = (await api("api/settings.php")).settings.sound;
  check("levels saved on the old straight scale are read as loud as they were", [straight.volume, straight.videoVolume], [71, 77]);
  await api("api/settings.php", { sound: { volume: 72 } });
  const marked = JSON.parse(fs.readFileSync(file, "utf8"));
  const after = (await api("api/settings.php")).settings.sound;
  check("the first save moves the other level too and marks the file", [marked._volumeScale, marked.sound.videoVolume, after.volume, after.videoVolume], [2, 77, 72, 77]);
  check("a new copy starts as loud as before, on the curve", [before.defaults.sound.volume, before.defaults.sound.videoVolume], [70, 75]);
  /* And a text size saved as a word. Small and Large were chosen and keep
     their size; Normal was written by every Save, chosen or not, so it
     takes the new default. */
  const sizeOf = async (word) => {
    fs.writeFileSync(file, JSON.stringify({ feel: { textSize: word } }, null, 2));
    return (await api("api/settings.php")).settings.feel.textSize;
  };
  check("a saved text size word is read as pixels", [await sizeOf("small"), await sizeOf("normal"), await sizeOf("large"), await sizeOf("nonsense")].join(","), "14,19,19,19");
  // and is not reported as a setting of the wrong kind
  await sizeOf("large");
  check("nor called a setting of the wrong kind", ((await api("api/settings.php")).drift || []).filter((d) => /textSize/.test(d)), []);
  fs.writeFileSync(file, kept);

  await b.ev(`(() => {
    const set = (k, v) => { const n = document.querySelector('[data-key="' + k + '"]'); n.value = v; n.dispatchEvent(new Event("change", { bubbles: true })); };
    set("accent", "green"); set("textSize", 22);
  })()`);
  check("closing Settings after a change draws the page again", await closeAndReload(b));
  check("the accent is worn by the body", await b.ev(`document.body.classList.contains("accent-green")`));
  check("and every rule mixed from it changes colour", await b.ev(`getComputedStyle(document.body).getPropertyValue("--cyan-rgb").trim()`), "52, 211, 153");
  check("including the ones that say var(--cyan)", await b.ev(`getComputedStyle(document.body).getPropertyValue("--cyan").trim()`), "rgb(52, 211, 153)");
  check("the menu text scale is the size over 16", await b.ev(`getComputedStyle(document.body).getPropertyValue("--fs").trim()`), "1.375");

  // put the costume back the way it was, then prove the default holds
  await b.key("Escape"); await sleep(200);
  await open(b);
  const big = await b.ev(`parseFloat(getComputedStyle(document.querySelector("#settings .opt label")).fontSize)`);
  check("and the setting names really are that many pixels", big > 21.5 && big < 22.5, true);
  check("the slider says its number, in pixels", await b.ev(`document.querySelector('#settings [data-key="textSize"]').parentNode.querySelector(".set-range-n").textContent`), "22 px");
  /* The window is sized by the text size too, so a window resizing mid-drag moves the knob away from
     the pointer and the size flips end to end. From press to release the window keeps its size.
     Dragged towards smaller, where no screen is too small for the window to change. */
  await b.ev(`[...document.querySelectorAll("#settings .set-tab")].find(x => /Feel/.test(x.textContent)).click()`);
  const knob = await b.ev(`(() => { const i = document.querySelector('#settings [data-key="textSize"]'); i.closest(".opt").scrollIntoView({ block: "center" }); const r = i.getBoundingClientRect();
    return { x: Math.round(r.left + 8 + (r.width - 16) * (Number(i.value) - 12) / 16), y: Math.round(r.top + r.height / 2) }; })()`);
  const winSize = `(r => Math.round(r.width) + "x" + Math.round(r.height))(document.querySelector("#settings .set-inner").getBoundingClientRect())`;
  const winBefore = await b.ev(winSize);
  await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: knob.x, y: knob.y, button: "none", buttons: 0 });
  await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: knob.x, y: knob.y, button: "left", buttons: 1, clickCount: 1 });
  const trail = [], wins = new Set();
  for (let i = 1; i <= 40; i++) {
    await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: knob.x - i, y: knob.y, button: "left", buttons: 1 });
    await sleep(20);
    trail.push(await b.ev(`Number(document.querySelector('#settings [data-key="textSize"]').value)`));
    wins.add(await b.ev(winSize));
  }
  const dragged = trail[trail.length - 1];
  const grewTo = await b.ev(`parseFloat(getComputedStyle(document.querySelector('#settings [data-key="textSize"]').closest(".opt").querySelector("label")).fontSize)`);
  await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: knob.x - 40, y: knob.y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(150);
  check("dragging the text size slider with the mouse, the size follows the hand and never turns back",
    [trail.every((v, i) => i === 0 || v <= trail[i - 1]), dragged < 22, dragged > 12], [true, true, true]);
  check("the window keeps its size while the slider is held, and the words still change under the hand", [[...wins], grewTo], [[winBefore], dragged]);
  check("and it takes its new size on letting go", [(await b.ev(winSize)) !== winBefore, await b.ev(`document.querySelector("#settings .set-inner").style.width`)], [true, ""]);
  /* It goes past what Large was, and shows itself as it moves, like the
     brightness sliders; closing saves the size it was left at. */
  await b.ev(`(i => { i.value = 28; i.dispatchEvent(new Event("input", { bubbles: true })); })(document.querySelector('#settings [data-key="textSize"]'))`);
  check("sliding it resizes the screen there and then", await b.ev(`parseFloat(getComputedStyle(document.querySelector("#settings .opt label")).fontSize)`), 28);
  await closeAndReload(b);
  check("closing keeps the size the slider was left at", [(await api("api/settings.php")).settings.feel.textSize, await b.ev(`getComputedStyle(document.body).getPropertyValue("--fs").trim()`)], [28, "1.75"]);
  await open(b);
  await b.ev(`(() => {
    const set = (k, v) => { const n = document.querySelector('[data-key="' + k + '"]'); n.value = v; n.dispatchEvent(new Event("change", { bubbles: true })); };
    set("accent", "cyan"); set("textSize", 16);
  })()`);
  await closeAndReload(b);
  check("back to cyan", await b.ev(`getComputedStyle(document.body).getPropertyValue("--cyan").trim()`), "rgb(34, 211, 238)");
  check("and to the old Normal size", await b.ev(`getComputedStyle(document.body).getPropertyValue("--fs").trim()`), "1");
  await open(b);
  const normal = await b.ev(`parseFloat(getComputedStyle(document.querySelector("#settings .opt label")).fontSize)`);
  check("which is smaller", normal < big, true);

  // ---- Esc at the top closes it ----
  await b.key("Escape"); await sleep(200);
  await open(b);
  await b.key("Escape");
  check("Esc in the categories closes the screen", await b.until(`document.getElementById("settings").hidden`));

  /* ---- and the mouse and keyboard settings do what they say ----
     All three at once, because each one costs a save and a reload. */
  const rim = `(() => { const all = [...document.querySelectorAll("#syswall .switem, #syswall .syscard")]; return { n: all.length, at: all.findIndex(x => x.classList.contains("sel")) }; })()`;
  await api("api/settings.php", { controller: { arrowsWrap: true, wheelTurns: false, hidePointer: true, hidePointerSec: 1 } });
  await b.goto();
  await b.key("Home");
  check("the rim starts at the first console", await b.until(`(${rim}).at`, 0), 0);
  await b.settled();
  const rimN = (await b.ev(rim)).n;
  await b.key("ArrowLeft");
  check("with wrapping on, left from the first lands on the last", await b.until(`(${rim}).at`, rimN - 1), rimN - 1);
  await b.settled();
  let r = await b.ev(rim);
  // A jump of more than five must not leave the old node marked as chosen
  // while hidden.
  check("and only one console is marked chosen", await b.ev(`document.querySelectorAll("#syswall .sel").length`), 1);
  await b.ev(`document.getElementById("syswall").dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }))`);
  await sleep(400);
  check("with the wheel off, scrolling moves nothing", (await b.ev(rim)).at, r.n - 1);
  await b.ev(`document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))`);
  check("the pointer is there while it moves", await b.ev(`!document.body.classList.contains("no-cursor")`));
  // hidePointerSec is 1: gone within a second or so, however long the page took
  check("and gone once it has stopped", await b.until(`document.body.classList.contains("no-cursor")`, true, 4000), true);

  /* ---- the X asks before it closes the whole app ----
     Only the app window has an X, so this runs in app mode. api\window.php
     is stubbed: a real close would shut the person's own Xsegon window,
     since windows are closed by name. */
  const stub = `window.__ops = []; (() => { const f = window.fetch; window.fetch = function (u, o) {
    if (String(u).indexOf("window.php") >= 0) { window.__ops.push(String((o || {}).body || "")); return Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { "Content-Type": "application/json" } })); }
    return f.apply(window, arguments); }; })()`;
  const asking = `(n => !!n && /CLOSE XSEGON/.test(n.textContent))(document.querySelector("#editor .panel-title"))`;

  await b.goto(BASE + "/?app=1");
  await b.ev(stub);
  check("the app window has an X", await b.until(`!document.getElementById("winctl").hidden`));
  await b.clickSel("#btn-close");
  check("the X asks first", await b.until(asking));
  await b.settled();
  check("and closes nothing yet", await b.ev(`window.__ops.length`), 0);
  await b.ev(`[...document.querySelectorAll("#editor button")].find(x => /Stay/.test(x.textContent)).click()`);
  check("Stay puts it away", await b.until(`document.getElementById("editor").hidden`));
  check("with nothing closed", await b.ev(`window.__ops.length`), 0);
  await b.clickSel("#btn-close");
  await b.until(asking); await b.settled();
  await b.key("Escape");
  check("Esc answers it the same way", await b.until(`document.getElementById("editor").hidden && window.__ops.length === 0`));
  // The round X's menu does not say them a second time: the window's own two buttons are the way.
  await b.setView("grid");
  await b.openBar("xsegon");
  check("the round X's menu has no Minimise or Close of its own, in the app window either",
        await b.ev(`[...document.querySelectorAll(".ctx-item .ctx-label")].map(x => x.textContent).filter(t => /Minimise|Close Xsegon/.test(t))`), []);
  await b.key("Escape"); await b.until(`!document.querySelector(".ctx")`);
  await b.clickSel("#btn-close");
  await b.until(asking); await b.settled();
  await b.ev(`[...document.querySelectorAll("#editor button")].find(x => /Close Xsegon/.test(x.textContent)).click()`);
  await b.until(`window.__ops.length > 0`);
  await sleep(300);                       // and no second close behind it
  check("saying yes closes the window, once", await b.ev(`window.__ops.join("|")`), '{"op":"close"}');

  await api("api/settings.php", { window: { confirmClose: false } });
  await b.goto(BASE + "/?app=1");
  await b.ev(stub);
  await b.until(`!document.getElementById("winctl").hidden`);
  await b.clickSel("#btn-close");
  check("with the question turned off it just closes", await b.until(`window.__ops.join("|")`, '{"op":"close"}'), '{"op":"close"}');
  check("and never asked", await b.ev(asking), false);
  await api("api/settings.php", { window: { confirmClose: true } });

  await api("api/settings.php", { controller: { arrowsWrap: false, wheelTurns: true, hidePointer: false, hidePointerSec: 3 } });
  await b.goto();
  await b.key("Home");
  await b.until(`(${rim}).at`, 0); await b.settled();
  await b.key("ArrowLeft"); await sleep(400);   // nothing to wait for: it must NOT move
  check("with wrapping off it stays put", (await b.ev(rim)).at, 0);
  await b.ev(`document.getElementById("syswall").dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }))`);
  check("and the wheel turns the rim again", await b.until(`(${rim}).at`, 1), 1);
  /* ---- text brightness ----
     A slider in Feel mixes the pure white and the ink from one number; the
     greyer text stays. */
  const whiteNow = `(() => { const d = document.createElement("span"); d.style.color = "var(--white)"; document.body.appendChild(d);
    const c = getComputedStyle(d).color; d.remove(); return Number((c.match(/\\d+/) || [0])[0]); })()`;
  const set0 = await api("api/settings.php");
  check("text brightness is a setting, full by default", set0.defaults.feel.textBrightness, 100);
  check("a slider from 60 to 100", [set0.schema.feel.textBrightness.type, set0.schema.feel.textBrightness.min, set0.schema.feel.textBrightness.max].join(","), "range,60,100");
  // from full, said rather than assumed. High contrast moves --faint and
  // --ink too, so it is off for the measurement and put back after: the
  // numbers below are the base theme's.
  const hc0 = set0.settings.feel.highContrast;
  await api("api/settings.php", { feel: { textBrightness: 100, highContrast: false } });
  await b.goto(); await b.key("Escape");
  check("at 100 the brightest text is white", await b.ev(whiteNow), 255);
  await open(b);
  await clickTab("Feel");
  await b.until(`[...document.querySelectorAll("#settings .set-page")].find(p => !p.hidden).dataset.group`, "feel");
  check("the slider is on the Feel page", await b.ev(`!!document.querySelector('#settings [data-key="textBrightness"]')`));
  await b.ev(`(n => { n.value = 70; n.dispatchEvent(new Event("input", { bubbles: true })); })(document.querySelector('#settings [data-key="textBrightness"]'))`);
  check("moving it dims the whitest text at once", await b.until(whiteNow, 179), 179);
  check("while the grey text stays as it was", await b.ev(`getComputedStyle(document.body).getPropertyValue("--faint").trim()`), "rgba(190, 247, 255, .66)");
  await closeAndReload(b);
  check("closing saves it where the slider was left", [(await api("api/settings.php")).settings.feel.textBrightness, await b.ev(whiteNow)], [70, 179]);
  await api("api/settings.php", { feel: { textBrightness: 80 } });
  await b.goto();
  check("saved, it holds after a reload", await b.ev(whiteNow), 204);
  check("and the ink dims with it", await b.ev(`(() => { const d = document.createElement("span"); d.style.color = "var(--ink)"; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; })()`), "rgb(187, 202, 204)");
  await api("api/settings.php", { feel: { textBrightness: 100, highContrast: hc0 } });

  /* ---- overall brightness: everything, pictures included ----
     A black veil over the window (body::after), as thick as the slider is
     short of 100, that every click goes through. */
  const veil = `Number(getComputedStyle(document.body, "::after").opacity)`;
  check("overall brightness is a setting, full by default", set0.defaults.feel.brightness, 100);
  check("a slider from 40 to 100", [set0.schema.feel.brightness.type, set0.schema.feel.brightness.min, set0.schema.feel.brightness.max].join(","), "range,40,100");
  await api("api/settings.php", { feel: { brightness: 100 } });
  await b.goto(); await b.key("Escape");
  check("at 100 nothing veils the screen", await b.ev(veil), 0);
  await open(b);
  await clickTab("Feel");
  await b.until(`[...document.querySelectorAll("#settings .set-page")].find(p => !p.hidden).dataset.group`, "feel");
  await b.ev(`(n => { n.value = 60; n.dispatchEvent(new Event("input", { bubbles: true })); })(document.querySelector('#settings [data-key="brightness"]'))`);
  check("moving it dims everything at once", await b.until(veil, 0.4), 0.4);
  check("and a click still goes through the veil", await b.ev(`getComputedStyle(document.body, "::after").pointerEvents`), "none");
  await closeAndReload(b);
  check("closing saves it where the slider was left", [(await api("api/settings.php")).settings.feel.brightness, await b.ev(veil)], [60, 0.4]);
  await api("api/settings.php", { feel: { brightness: 70 } });
  await b.goto();
  check("saved, it holds after a reload", await b.ev(veil), 0.3);
  await api("api/settings.php", { feel: { brightness: 100 } });

  /* ---- the guardrails against a value of the wrong kind ----
     Refused and logged; one already in the file is named in the log and the
     report; a fault in the page's code is a BUG line plus a quiet line at
     the top, never a screen that silently does nothing. */
  const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
  const logFile = path.join(DATA, "log", d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + ".log");
  const logSize = () => { try { return fs.statSync(logFile).size; } catch (e) { return 0; } };
  // by bytes: the log has a ✗ and a … in it, so characters and bytes differ
  const logUntil = async (at, re, ms = 4000) => {
    const end = Date.now() + ms;
    for (;;) { const t = logSince(at); if (re.test(t) || Date.now() > end) { return t; } await new Promise((r) => setTimeout(r, 50)); }
  };
  const logSince = (at) => { try { return fs.readFileSync(logFile).subarray(at).toString("utf8"); } catch (e) { return ""; } };

  let mark = logSize();
  const wrong = await api("api/settings.php", { view: { sort: ["title"], listColumns: "title" } });
  check("a list where a word belongs is refused", wrong.settings.view.sort, "title");
  check("and a word where a list belongs", Array.isArray(wrong.settings.view.listColumns), true);
  check("and both are written down as WARN", ((await logUntil(mark, /refused view\.sort[\s\S]*refused view\.listColumns|refused view\.listColumns[\s\S]*refused view\.sort/)).match(/WARN settings: refused view\.(sort|listColumns)/g) || []).length, 2);

  // One already in the file (written by hand, or by an older build).
  const setFile = path.join(DATA, "settings.json");
  const raw = JSON.parse(fs.readFileSync(setFile, "utf8").replace(/^﻿/, ""));
  raw.view.showMissingArt = "yes";
  fs.writeFileSync(setFile, JSON.stringify(raw, null, 2));
  mark = logSize();
  const drifted = await api("api/settings.php");
  check("a saved value of the wrong kind is named", (drifted.drift || []).join("|"), "view.showMissingArt is a word, its default a switch");
  const rep = await api("api/report.php");
  check("and the problem report says so", ((rep.checks || []).find((c) => c.key === "drift") || {}).state, "warn");
  await b.goto(); await b.key("Escape");
  await open(b);
  check("Settings still opens over it", await b.ev(`document.querySelectorAll("#settings .set-tab").length`), 13);
  // the page sends its WARN at once; wait for it to land, not 2.5 seconds
  const since = await logUntil(mark, /P WARN setting view\.showMissingArt/);
  check("the server logs it", /S WARN settings: view\.showMissingArt is a word/.test(since));
  check("and so does the page, with the value", /P WARN setting view\.showMissingArt is a string, its default a boolean: string "yes"/.test(since));
  await b.key("Escape"); await sleep(300);
  await api("api/settings.php", { view: { showMissingArt: true } });
  check("setting it again puts it right", ((await api("api/settings.php")).drift || []).length, 0);

  // A fault in the page's own code. log.js is imported again here, without
  // the page's ?v=, so it is a second copy, but it raises the same event and
  // writes the same line, which is all this needs.
  mark = logSize();
  await b.ev(`import("./js/log.js").then(m => m.guard("a test fault", () => { throw new Error("test-bug one"); })())`);
  /* Said quietly: one white line at the top offering a restart and the help
     address, not a red strip; where and why are the log's. */
  check("a fault shows one quiet line at the top", await b.until(`(n => !!n && !n.hidden && /Something went wrong/.test(n.textContent))(document.getElementById("bugbar"))`), true);
  check("suggesting a restart and where to write", await b.ev(`(n => /Restarting Xsegon/.test(n.textContent) && n.querySelector("a").getAttribute("href").split("?")[0])(document.getElementById("bugbar"))`), "mailto:help@tumultuousproductions.site");
  /* An error code to read out: XS-<area>-<fingerprint>. */
  const shownCode = await b.ev(`(document.querySelector("#bugbar b") || {}).textContent || ""`);
  check("with an error code to quote", /^XS-[A-Z]{3}-[0-9A-F]{4}$/.test(shownCode), true);
  check("and the email carries the code and the build", await b.ev(`(h => h.indexOf(encodeURIComponent("Xsegon error ${shownCode}")) > 0 && h.indexOf("Build%3A%200.") > 0)(document.querySelector("#bugbar a").getAttribute("href"))`), true);
  check("which is a single thin line", await b.ev(`(n => { const r = n.getBoundingClientRect(); return r.top === 0 && r.height <= 30; })(document.getElementById("bugbar"))`));
  check("and says nothing in red", await b.ev(`document.getElementById("strip").hidden || !/Something went wrong/.test(document.getElementById("strip").textContent)`));
  await b.ev(`Promise.reject(new Error("test-bug two")); 1`);
  const bugs = await logUntil(mark, /test-bug one[\s\S]*unhandled promise: test-bug two/);
  // (thrown from this snippet, so it has no file:line; t-log checks a real one)
  check("and a BUG line naming where, with the error", /P BUG\s+a test fault: test-bug one @ /.test(bugs));
  check("a promise nobody caught is a BUG too", /P BUG\s+unhandled promise: test-bug two/.test(bugs));
  // (the page's own copy of log.js, the one that has seen the keys pressed)
  check("with the last thing you did", /test-bug two @ .*\| after (NAV|CLK|KEY|PAD) /.test(bugs));
  check("and the code the bar showed, to search the log by", bugs.indexOf("| code " + shownCode) > 0);
  // The code is the same fault's everywhere, and names the part it came from.
  const codes = await b.ev(`import("./js/log.js").then(m => [
    m.bugCode("settings row view.x", "boom 12", "settings-ui.js:291 < settings-ui.js:163").code,
    m.bugCode("settings row view.x", "boom 99", "settings-ui.js:291 < main.js:10").code,
    m.bugCode("settings row view.x", "boom 12", "settings-ui.js:300").code,
    m.bugCode("uncaught", "x", "views.js:40").code,
    m.bugCode("uncaught", "x", "no stack").code])`);
  check("the same fault gives the same code, whatever its numbers", codes[0], codes[1]);
  check("a fault on another line gets another", codes[0] !== codes[2], true);
  check("the area is the part it came from", codes.map((c) => c.split("-")[1]).join(","), "SET,SET,SET,LST,APP");
  // Those two were on purpose: the runner fails a group on any other.
  // (the browser cuts its own report short, sometimes at "Error: test")
  b.errors.splice(0, b.errors.length, ...b.errors.filter((e) => !/test-bug|Error: test/.test(e)));
  await b.ev(`document.querySelector("#bugbar .bb-x").click()`);
  check("and its x puts it away", await b.until(`document.getElementById("bugbar").hidden`), true);

  /* ---- Reset to defaults: asks, keeps the folders, keeps a copy ----
     One press must not delete settings.json, folders and all, with nothing
     to put back. */
  const curSet = (await api("api/settings.php")).settings;
  await api("api/settings.php", { feel: { textBrightness: 81, tipsGone: { logoMenu: true } }, paths: { scanFolders: [DATA] } });
  const foreign = await fetch(BASE + "/api/settings.php?reset=1", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://example.com" }, body: "{}" });
  check("a reset from another site is refused", [foreign.status >= 400, (await api("api/settings.php")).settings.feel.textBrightness], [true, 81]);
  await b.goto();
  await open(b);
  await b.ev(`[...document.querySelectorAll("#settings .set-foot button")].find(x => x.textContent === "Reset to defaults").click()`);
  const askH = `(document.querySelector(".setup-confirm h2") || {}).textContent || ""`;
  check("Reset to defaults asks first", await b.until(askH, "Reset settings to their defaults?"), "Reset settings to their defaults?");
  check("saying the folders are kept", await b.ev(`/Paths\\) are kept/.test(document.querySelector(".setup-confirm").textContent)`), true);
  await b.key("Escape");
  check("Esc keeps every setting", await b.until(`!document.querySelector(".setup-confirm")`) && (await api("api/settings.php")).settings.feel.textBrightness === 81, true);
  const safetyDir = path.join(DATA, "safety");
  const copiesBefore = fs.existsSync(safetyDir) ? fs.readdirSync(safetyDir).filter((f) => f.startsWith("settings.before-reset-")).length : 0;
  const resetRes = await api("api/settings.php?reset=1", {});
  const afterReset = (await api("api/settings.php")).settings;
  check("a reset puts the settings back to their defaults", afterReset.feel.textBrightness, 100);
  check("but keeps the folders, so the games are still found", [afterReset.paths.romRoot, afterReset.paths.scanFolders], [curSet.paths.romRoot, [DATA]]);
  // The logo tip was put away above: a reset must not bring it back.
  check("and a tip put away for good stays put away", afterReset.feel.tipsGone, { logoMenu: true });
  const copies = fs.existsSync(safetyDir) ? fs.readdirSync(safetyDir).filter((f) => f.startsWith("settings.before-reset-")) : [];
  check("and keeps a copy of what it replaced", copies.length === copiesBefore + 1 && !!resetRes.copy && JSON.parse(fs.readFileSync(resetRes.copy, "utf8")).feel.textBrightness === 81, true);
  await b.key("Escape");
  // Everything as it was before the reset, not only the folders: defaults
  // (the sidebar on, which run.js turns off) break the groups after this one.
  await api("api/settings.php", curSet);

  /* ---- the volume corner: a speaker that opens into two bars, the film
     for video snaps and the X for Xsegon's own sounds ---- */
  await b.goto();
  const pop = `document.getElementById("vol-pop").hidden`;
  const nums = `[document.getElementById("vol-snap-num").textContent, document.getElementById("vol-num").textContent]`;
  const drag = (id, v) => b.ev(`(n => { n.value = ${v}; n.dispatchEvent(new Event("input", { bubbles: true })); n.dispatchEvent(new Event("change", { bubbles: true })); })(document.getElementById("${id}"))`);
  check("the volume corner is a speaker until it is clicked", await b.ev(`[${pop}, !!document.querySelector("#vol-btn svg")]`), [true, true]);
  await b.clickSel("#vol-btn");
  check("clicked, it opens into two bars: the film's, then the X's",
        await b.ev(`[${pop}, [...document.querySelectorAll("#vol-pop .vol-row")].map(r => (r.querySelector(".vol-ico svg") ? "film" : r.querySelector(".vol-ico img") ? "X" : "?") + ":" + !!r.querySelector("input[type=range]"))]`),
        [false, ["film:true", "X:true"]]);
  await drag("vol-snap", 25);
  await drag("vol-range", 40);
  check("each bar sets its own level", await b.ev(nums), ["25", "40"]);  check("and both are saved", !!(await apiUntil(async () => { const s = (await api("api/settings.php")).settings.sound; return s.videoVolume === 25 && s.volume === 40; })), true);
  await b.clickSel("#vol-app-ico");
  check("the X's icon silences Xsegon's sounds alone", await b.ev(nums), ["25", "off"]);
  await b.clickSel("#vol-app-ico");
  check("and brings them back at the level they had", await b.ev(nums), ["25", "40"]);
  await b.clickSel("#vol-snap-ico");
  check("the film's icon does the same for snaps", await b.ev(nums), ["off", "40"]);
  await b.clickSel("#vol-snap-ico");
  check("and back", await b.ev(nums), ["25", "40"]);
  check("the bars stay open while they are used", await b.ev(pop), false);
  await b.ev(`document.getElementById("help").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
  check("a click anywhere else folds them away", await b.ev(pop), true);
  // The pointer is still parked on the corner from the clicks above, and a
  // pointer on the bars is what keeps them open: move it off first.
  await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 400, y: 300 });
  await b.key("-");
  check("the - key shows them for a moment, a step of 1", [await b.ev(pop), await b.ev(`document.getElementById("vol-num").textContent`)], [false, "39"]);
  check("and they go by themselves", await b.until(pop, true), true);
  check("the bars move in steps of 1", await b.ev(`["vol-range", "vol-snap"].map(id => document.getElementById(id).step)`), ["1", "1"]);
  // loudness is the level squared: room at the low end
  check("a level is played on a curve: 5 is a twentieth of what it was", await b.ev(`import("/js/sound.js").then(m => [m.gain(5), m.gain(50), m.gain(100)])`), [0.0025, 0.25, 1]);
  // Saved after the bars rest: waited for, so neither lands after the put back.
  await apiUntil(async () => { const s = (await api("api/settings.php")).settings.sound; return s.videoVolume === 25 && s.volume === 39; });

  /* A level changed from the corner while Settings is open is kept when
     Settings closes: the slider follows it, and counts as saved. */
  await open(b);
  await b.ev(`[...document.querySelectorAll("#settings .set-tab")].find(x => /Sound/.test(x.textContent)).click()`);
  await b.settled();
  const setVol = `document.querySelector('#settings input[data-group="sound"][data-key="volume"]')`;
  check("Settings > Sound shows the level", await b.ev(`${setVol}.value`), "39");
  await b.key("+");
  await b.key("+");
  check("a level set from the keys over Settings moves its slider too",
        [await b.ev(`${setVol}.value`), await b.ev(`${setVol}.parentNode.querySelector(".set-range-n").textContent`)], ["41", "41"]);
  await b.ev(`window.__xsStayed = true`);
  await b.ev(closeX);
  check("so closing Settings keeps it instead of undoing it", await apiUntil(async () => (await api("api/settings.php")).settings.sound.volume === 41), true);
  await sleep(600);
  check("and the page is not drawn again for a level the corner saved", await b.ev(`window.__xsStayed === true`), true);
  await api("api/settings.php", { sound: { volume: curSet.sound.volume, videoVolume: curSet.sound.videoVolume } });

  /* ---- the limit on the sound under the pointer: a slider in Settings >
     Sound, so many a second, no limit at its far right; letting it go plays
     a sweep that fast, so it is set by ear ---- */
  const rateWas = (await api("api/settings.php")).settings.sound.hoverRate;
  check("the limit is kept inside its slider: 1 to 30 a second",
        [(await api("api/settings.php", { sound: { hoverRate: 99 } })).settings.sound.hoverRate, (await api("api/settings.php", { sound: { hoverRate: 0 } })).settings.sound.hoverRate], [30, 1]);
  await api("api/settings.php", { sound: { hoverRate: rateWas } });
  await b.goto();
  await open(b);
  await b.ev(`[...document.querySelectorAll("#settings .set-tab")].find(x => /Sound/.test(x.textContent)).click()`);
  await b.settled();
  const rate = `document.querySelector('#settings input[data-group="sound"][data-key="hoverRate"]')`;
  const rateSays = `${rate}.parentNode.querySelector(".set-range-n").textContent`;
  const slide = (v) => b.ev(`(n => { n.value = ${v}; n.dispatchEvent(new Event("input", { bubbles: true })); n.dispatchEvent(new Event("change", { bubbles: true })); })(${rate})`);
  check("Settings > Sound has it as a slider, in the app's own half",
        await b.ev(`[${rate}.type, ${rate}.min, ${rate}.max, ${rate}.closest(".opt").querySelector("label").firstChild.textContent, ${rate}.closest(".set-sect").querySelector(".sect-name").textContent]`),
        ["range", "1", "30", "Sounds under the pointer, at most", "In the app"]);
  await b.ev(`(() => { window.__hv = 0; const p = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.__play = p;
    HTMLMediaElement.prototype.play = function () { if (/name=hover/.test(this.src)) { window.__hv++; } return p.call(this); }; })()`);
  await slide(5);
  check("it says how many a second", await b.ev(rateSays), "5 a second");
  if (await b.ev(`(s => s.sounds !== false && s.volume > 0 && localStorage.getItem("xs-muted") !== "1")(window.XSEGON.settings.sound)`)) {
    check("letting it go plays a sweep that fast: four sounds in its 0.8 seconds, and no more after",
          [await b.until(`window.__hv`, 4), await sleep(500).then(() => b.ev(`window.__hv`))], [4, 4]);
  } else {
    console.log("    (Xsegon's sounds are off or silent in these settings; the sweep the slider plays steps aside)");
  }
  check("and it is saved where it rests", await apiUntil(async () => (await api("api/settings.php")).settings.sound.hoverRate === 5), true);
  await slide(30);
  check("all the way right it says no limit", await b.ev(rateSays), "no limit");
  // Put back where it was and saved before Settings closes, so the page is not drawn again for it.
  await slide(rateWas);
  await apiUntil(async () => (await api("api/settings.php")).settings.sound.hoverRate === rateWas);
  await sleep(900);
  await b.ev(`HTMLMediaElement.prototype.play = HTMLMediaElement.prototype.__play`);
  await b.ev(closeX);
  await sleep(600);

  /* ---- Settings saves itself: no Save button ----
     A switch when it is changed, a box that is typed in when it is left and
     never per letter, whatever is waiting when Settings closes, and the
     page drawn again once no window is open. */
  const feel0 = (await api("api/settings.php")).settings;
  const said = `document.querySelector("#settings .set-saved").textContent`;
  await open(b);
  check("there is no Save button", await b.ev(`[...document.querySelectorAll("#settings button")].filter(x => x.textContent.trim() === "Save").length`), 0);
  check("the foot says changes save themselves", await b.ev(said), "Every change is saved as you make it.");
  await b.ev(`window.__xsStayed = true`);
  await b.ev(`document.querySelector('#settings input[data-group="feel"][data-key="clock"]').click()`);
  check("a switch is saved the moment it is changed", await apiUntil(async () => (await api("api/settings.php")).settings.feel.clock === !feel0.feel.clock), true);
  check("and the foot says which", await b.until(said, "Saved: Clock"), "Saved: Clock");

  /* A saved setting says so where it stands: its row tints and a toast names it. Only on the server's answer,
     and green only for the value asked for: the two answers below stand in for a server that refuses a save,
     and one that keeps another value. */
  const clockBox = `document.querySelector('#settings input[data-group="feel"][data-key="clock"]')`;
  const rowIs = (cls) => `!!document.querySelector('#settings .opt.${cls} input[data-group="feel"][data-key="clock"]')`;
  const note = `(n => (n ? [n.querySelector(".ts-text").textContent, n.className.replace("toast toast-saved", "").trim()] : null))(document.querySelector("#settings .toast-saved:not(.going)"))`;
  check("its row is marked saved and a small toast names it, over the Settings window, once the server has answered",
    [await b.until(rowIs("saved"), true, 3000), await b.ev(note),
     await b.ev(`(r => r.width > 0 && !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).closest(".toast-saved"))(document.querySelector("#settings .toast-saved").getBoundingClientRect())`)],
    [true, ["Saved: Clock", ""], true]);
  await b.shot("settings-saved-toast");
  check("and both go by themselves", await b.until(`!document.querySelector("#settings .opt.saved") && !document.querySelector("#settings .toast-saved")`, true, 6000), true);
  const answers = (how) => b.ev(`(() => { window.__realFetch = window.__realFetch || window.fetch; window.fetch = function (u, o) {
    if (String(u).indexOf("api/settings.php") >= 0 && o && o.method === "POST") {
      const say = (body) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
      return ${JSON.stringify(how)} === "refuses" ? Promise.resolve(say({ ok: false, error: "the disk is full" }))
        : window.__realFetch("api/settings.php").then((r) => r.json()).then((j) => say({ ok: true, settings: j.settings }));
    }
    return window.__realFetch.apply(this, arguments); }; })()`);
  const clockNow = (await api("api/settings.php")).settings.feel.clock;
  await answers("refuses");
  await b.ev(`${clockBox}.click()`);
  check("a save the server refuses is never called saved: the row and the toast say not saved, and the switch goes back",
    [await b.until(rowIs("save-bad"), true, 3000), await b.ev(note), await b.ev(`!!document.querySelector("#settings .opt.saved")`),
     await b.ev(`${clockBox}.checked`), (await api("api/settings.php")).settings.feel.clock, await b.ev(said)],
    [true, ["Not saved: Clock", "bad"], false, clockNow, clockNow, "Not saved: Clock"]);
  await answers("keeps the old value");
  await b.ev(`${clockBox}.click()`);
  check("nor is a value the server did not take: it says so, with no green, and the switch shows what is kept",
    [await b.until(rowIs("save-warn"), true, 3000), await b.ev(note), await b.ev(`!!document.querySelector("#settings .opt.saved")`), await b.ev(`${clockBox}.checked`)],
    [true, ["Clock was not changed: that value was not taken", "warn"], false, clockNow]);
  await b.ev(`window.fetch = window.__realFetch`);
  await b.ev(`document.querySelectorAll("#settings .toast-saved").forEach((n) => n.remove())`);
  const title = `document.querySelector('#settings input[data-group="launch"][data-key="focusTitle"]')`;
  await b.ev(`(i => { i.focus(); i.value = "Xseg"; i.dispatchEvent(new Event("input", { bubbles: true })); })(${title})`);
  await sleep(700);
  check("a box being typed in is not saved per letter", (await api("api/settings.php")).settings.launch.focusTitle, feel0.launch.focusTitle);
  await b.ev(`(i => { i.value = "Xsegon test"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); })(${title})`);
  check("it is saved when it is left", await apiUntil(async () => (await api("api/settings.php")).settings.launch.focusTitle === "Xsegon test"), true);
  check("with Settings still open the page has not been drawn again", await b.ev(`window.__xsStayed === true && !document.getElementById("settings").hidden`), true);
  // still being typed in when Settings closes: saved by the closing
  await b.ev(`(i => { i.value = ${JSON.stringify(feel0.launch.focusTitle)}; i.dispatchEvent(new Event("input", { bubbles: true })); })(${title})`);
  await b.ev(`document.querySelector('#settings input[data-group="feel"][data-key="clock"]').click()`);
  await b.ev(closeX);
  check("closing saves what was still waiting", await apiUntil(async () => { const s = (await api("api/settings.php")).settings; return s.launch.focusTitle === feel0.launch.focusTitle && s.feel.clock === feel0.feel.clock; }), true);
  await sleep(600);
  check("and with everything put back as it was, the page is not drawn again", await b.ev(`window.__xsStayed === true`), true);
  // Out through a tool's window: drawn again when that window closes.
  await open(b);
  await b.ev(`document.querySelector('#settings input[data-group="feel"][data-key="clock"]').click()`);
  await b.ev(`[...document.querySelectorAll("#settings .set-tab")].find(x => /Debug/.test(x.textContent)).click()`);
  await b.settled();
  await b.ev(`[...document.querySelectorAll("#settings button")].find(x => x.textContent === "Show the log").click()`);
  check("a tool opens from Settings", await b.waitFor(`!document.getElementById("editor").hidden && document.getElementById("settings").hidden`, 5000));
  await sleep(400);
  check("the page waits while that window is open", await b.ev(`!document.getElementById("editor").hidden`), true);
  await b.ev(`window.__xsLeaving = true`);
  await b.ev(`[...document.querySelectorAll("#editor button")].find(x => x.textContent === "Done (esc)").click()`);
  // The window closes back onto Settings, on the page it was opened from, not onto the games.
  const backAt = `[document.getElementById("editor").hidden, document.getElementById("settings").hidden]`;
  check("the tool closes back onto Settings, on the page it was opened from",
    [await b.until(backAt, [true, false], 5000), await b.ev(`!![...document.querySelectorAll("#settings button")].find(x => x.textContent === "Show the log")`)], [[true, false], true]);
  await sleep(400);
  check("and the page still waits, with Settings open again", await b.ev(`window.__xsLeaving === true`), true);
  await b.ev(closeX);
  check("and is drawn again when Settings closes", await b.waitQuiet(`!window.__xsLeaving && document.readyState === "complete"`, 10000));
  await b.waitQuiet(`document.getElementById("count").textContent !== ""`, 10000);
  await b.settled();
  await api("api/settings.php", { feel: { clock: feel0.feel.clock } });
  for (const [tab, button] of [["Debug", "Report a problem..."], ["Library", "Back up..."]]) {
    await open(b);
    await b.ev(`[...document.querySelectorAll("#settings .set-tab")].find(x => x.textContent.includes(${JSON.stringify(tab)})).click()`);
    await b.settled();
    await b.ev(`[...document.querySelectorAll("#settings button")].find(x => x.textContent.trim() === ${JSON.stringify(button)}).click()`);
    await b.waitFor(`!document.getElementById("editor").hidden && document.getElementById("settings").hidden`, 15000);
    await b.key("Escape");
    check(button + " from Settings closes back onto Settings too", await b.until(backAt, [true, false], 5000), [true, false]);
    await b.ev(closeX);
    await b.until(`document.getElementById("settings").hidden`, true, 3000);
  }

  /* ---- your own sounds: a file per sound, its rules written beside it ----
     Real files, made here: a .wav short enough for Move, one too long, and
     a text file named .wav. The file window is answered with each in turn
     (data\pick-answer.txt, honoured only on a test copy). */
  // sounds-own, not a folder inside data\sounds: the test copy's sounds are
  // a link to the real packs, and nothing here may write through it
  const ownDir = path.join(DATA, "sounds-own"), stageDir = path.join(DATA, "sounds-staged");
  const fx = path.join(DATA, "own-sound-fixtures"), answer = path.join(DATA, "pick-answer.txt");
  const wav = (secs) => {
    const rate = 8000, n = Math.round(rate * secs), w = Buffer.alloc(44 + n, 128);
    w.write("RIFF", 0); w.writeUInt32LE(36 + n, 4); w.write("WAVE", 8); w.write("fmt ", 12); w.writeUInt32LE(16, 16);
    w.writeUInt16LE(1, 20); w.writeUInt16LE(1, 22); w.writeUInt32LE(rate, 24); w.writeUInt32LE(rate, 28);
    w.writeUInt16LE(1, 32); w.writeUInt16LE(8, 34); w.write("data", 36); w.writeUInt32LE(n, 40);
    return w;
  };
  const setWas = curSet.sound.soundSet;
  // Its last step empties the folder, so it never runs where someone's own sounds are (--live).
  if (fs.existsSync(ownDir) && fs.readdirSync(ownDir).some((n) => /[.](wav|ogg|mp3)$/i.test(n))) {
    console.log("    (this data folder holds sounds of your own; choosing and removing them steps aside)");
  } else try {
    fs.mkdirSync(fx, { recursive: true });
    fs.writeFileSync(path.join(fx, "Jump.wav"), wav(0.3));
    fs.writeFileSync(path.join(fx, "Long.wav"), wav(2));
    fs.writeFileSync(path.join(fx, "Fake.wav"), "not a sound at all, only words in a file named like one");
    await open(b);
    await b.ev(`[...document.querySelectorAll("#settings .set-tab")].find(x => /Sound/.test(x.textContent)).click()`);
    const own = `[...document.querySelectorAll('#settings .opt.own-snd')]`;
    const hintOf = (n) => `(r => r ? r.querySelector(".hint").textContent : null)(document.querySelector('#settings .opt.own-snd[data-sound="${n}"]'))`;
    await b.until(`${own}.length`, 5, 8000);
    check("Settings > Sound has a row for each of your own sounds, with Choose file, Play and Remove",
          await b.ev(`${own}.map(r => r.querySelector("label").firstChild.textContent + ":" + [...r.querySelectorAll("button")].map(x => x.textContent).join("/"))`),
          ["Move:Choose file.../Play/Remove", "Hover:Choose file.../Play/Remove", "Select:Choose file.../Play/Remove", "Back:Choose file.../Play/Remove", "Ok:Choose file.../Play/Remove"]);
    check("the formats and the size are written above them",
          await b.ev(`/a \\.wav, \\.ogg or \\.mp3 of up to 2 MB/.test(document.querySelector("#settings .own-rules").textContent)`), true);
    check("and each row says how long it may be, and that the built-in one plays until you choose",
          [await b.ev(hintOf("move")), await b.ev(hintOf("ok"))],
          ["Up to 0.5 seconds. Not chosen: the built-in one plays.", "Up to 3 seconds. Not chosen: the built-in one plays."]);
    const choose = async (file, name = "move") => {
      fs.writeFileSync(answer, path.join(fx, file));
      await b.ev(`(() => { const s = document.getElementById("strip"); s.textContent = ""; })()`);
      await b.ev(`[...document.querySelector('#settings .opt.own-snd[data-sound="${name}"]').querySelectorAll("button")].find(x => x.textContent === "Choose file...").click()`);
      await b.until(`/not changed|yours now/.test(document.getElementById("strip").textContent)`, true, 10000);
      return b.ev(`document.querySelector("#strip > span:not(.who):not(.spacer)").textContent`);
    };
    const moveFiles = () => (fs.existsSync(ownDir) ? fs.readdirSync(ownDir).filter((n) => /^Move\./.test(n)) : []);
    /* Hover is not tied to the set (no LaunchBox pack has one): yours plays
       under every set and changes no other sound. Checked first, while the
       set is still the one the copy came with. */
    const hoverFiles = () => (fs.existsSync(ownDir) ? fs.readdirSync(ownDir).filter((n) => /^Hover\./.test(n)) : []);
    const hoverOf = (set, more) => fetch(BASE + "/api/sound.php?name=hover" + (more || "") + "&set=" + encodeURIComponent(set));
    const isJump = async (r) => r.status === 200 && Buffer.from(await r.arrayBuffer()).equals(fs.readFileSync(path.join(fx, "Jump.wav")));
    const hoverUnchosen = "Up to 1 second. Not chosen: the sound set's own plays, or the built-in one.";
    const builtHover = fs.readFileSync(path.join(__dirname, "..", "sounds", "Xsegon", "Hover.wav"));
    check("Hover says it is not tied to the set, above the rows and on its own",
          [await b.ev(`/Hover, the sound under the pointer, is the exception: yours plays under every set[.]/.test(document.querySelector("#settings .own-rules").textContent)`), await b.ev(hintOf("hover"))],
          [true, hoverUnchosen]);
    check("and the rules say a copied path can be pasted into the window that opens",
          await b.ev(`/a path you copied can be pasted into File name/.test(document.querySelector("#settings .own-rules").textContent)`), true);
    check("before any is chosen, a set with no Hover plays the built-in one",
          Buffer.from(await (await hoverOf("Xsegon 2")).arrayBuffer()).equals(builtHover), true);
    check("a Hover of your own is kept, and the sound set stays the one it was",
          [await choose("Jump.wav", "hover"), hoverFiles(), await sleep(500).then(async () => (await api("api/settings.php")).settings.sound.soundSet),
           await b.ev(`document.querySelector('#settings [data-key="soundSet"]').value`)],
          ["Hover is yours now (0.3 seconds)", ["Hover.wav"], setWas, setWas]);
    check("its row says so", await b.ev(hintOf("hover")), "Up to 1 second. Yours: Hover.wav, 0.3 seconds.");
    check("it plays under every set: the one in use, another, and where the Shelf asks for Move in its place",
          [await isJump(await hoverOf(setWas)), await isJump(await hoverOf("Xsegon 2")), await isJump(await hoverOf("Xsegon 2", "&or=move"))], [true, true, true]);
    check("and no other sound of that set is touched by it", await isJump(await fetch(BASE + "/api/sound.php?name=move&set=" + encodeURIComponent("Xsegon 2"))), false);
    await b.ev(`[...document.querySelector('#settings .opt.own-snd[data-sound="hover"]').querySelectorAll("button")].find(x => x.textContent === "Remove").click()`);
    check("Remove gives the pointer back: the set's own Hover, or the built-in one",
          [await b.until(hintOf("hover"), hoverUnchosen, 8000), hoverFiles(), Buffer.from(await (await hoverOf("Xsegon 2")).arrayBuffer()).equals(builtHover),
           await b.until(`/Hover is no longer yours: the sound set's own plays, or the built-in one/.test(document.getElementById("strip").textContent)`, true, 5000)],
          [hoverUnchosen, [], true, true]);
    check("a sound too long is refused, saying why, and nothing is copied",
          [await choose("Long.wav"), moveFiles()], ["Move not changed: 2 seconds: Move can be up to 0.5 seconds", []]);
    check("so is a file that only looks like a sound",
          [await choose("Fake.wav"), moveFiles()], ["Move not changed: it is named .wav but is not one inside", []]);
    check("one that fits becomes the sound, and the set becomes yours",
          [await choose("Jump.wav"), moveFiles()], ["Move is yours now (0.3 seconds), and Sound set is Your own", ["Move.wav"]]);
    check("its row says so", await b.ev(hintOf("move")), "Up to 0.5 seconds. Yours: Move.wav, 0.3 seconds.");
    check("the set is saved at once, no Save needed", (await apiUntil(async () => (await api("api/settings.php")).settings.sound.soundSet === "Your own")), true);
    const played = await fetch(BASE + "/api/sound.php?name=move&set=" + encodeURIComponent("Your own"));
    check("Move plays your file", Buffer.from(await played.arrayBuffer()).equals(fs.readFileSync(path.join(fx, "Jump.wav"))), true);
    const backed = await fetch(BASE + "/api/sound.php?name=back&set=" + encodeURIComponent("Your own"));
    const builtinBack = fs.readdirSync(path.join(__dirname, "..", "sounds", "Xsegon")).find((n) => /^Back\./.test(n));
    check("and a sound you left empty plays the built-in one",
          Buffer.from(await backed.arrayBuffer()).equals(fs.readFileSync(path.join(__dirname, "..", "sounds", "Xsegon", builtinBack))), true);
    check("nothing is left waiting to be checked", fs.existsSync(stageDir) ? fs.readdirSync(stageDir) : [], []);
    await b.ev(`[...document.querySelector('#settings .opt.own-snd[data-sound="move"]').querySelectorAll("button")].find(x => x.textContent === "Remove").click()`);
    check("Remove puts the built-in one back", [await b.until(hintOf("move"), "Up to 0.5 seconds. Not chosen: the built-in one plays.", 8000), moveFiles()],
          ["Up to 0.5 seconds. Not chosen: the built-in one plays.", []]);
    check("none of it was written into the sound packs' folder", fs.existsSync(path.join(DATA, "sounds", "Your own")), false);
    check("and your own sounds are not listed as a pack to copy", ((await api("api/sounds.php")).packs || []).some((p) => p.name === "Your own"), false);
    await b.key("Escape");
  } finally {
    fs.rmSync(answer, { force: true });
    fs.rmSync(fx, { recursive: true, force: true });
    fs.rmSync(ownDir, { recursive: true, force: true });
    fs.rmSync(stageDir, { recursive: true, force: true });
    await api("api/settings.php", { sound: { soundSet: setWas } });
  }

  /* ---- presses that said nothing, or said it too soon ----
     Nothing is said until the server answers: a build it refused says so, and one that began closes
     Settings, its bar being in the corner. The answers are stand-ins: no build is started from here. */
  await b.goto();
  await open(b);
  await clickTab("Library");
  const stripSays = `(document.getElementById("strip") || {}).textContent || ""`;
  const thumbsAnswer = (ok) => b.ev(`(() => { window.__realFetch = window.__realFetch || window.fetch; window.__thumbsAsked = 0; window.fetch = function (u, o) {
    if (String(u).indexOf("api/thumbs.php") >= 0) {
      window.__thumbsAsked++;
      return Promise.resolve(new Response(JSON.stringify(${ok} ? { ok: true, started: true, kind: "box", games: 3 } : { ok: false, error: "could not start the thumbnail builder" }),
        { headers: { "Content-Type": "application/json" } }));
    }
    return window.__realFetch.apply(this, arguments); }; })()`);
  const buildThumbs = `[...document.querySelectorAll("#settings button")].find((x) => x.textContent.trim() === "Build thumbs").click()`;
  await thumbsAnswer(false);
  await b.ev(buildThumbs);
  check("a thumbnail build the server refused says so, is never called building, and leaves Settings open",
    [await b.until(`/the thumbnails were not built: could not start the thumbnail builder/.test(${stripSays})`, true, 5000),
     await b.ev(`/building/.test(${stripSays})`), await b.ev(`document.getElementById("settings").hidden`), await b.ev(`window.__thumbsAsked > 0`)],
    [true, false, false, true]);
  await b.ev(`(c => c && c.click())([...document.querySelectorAll("#strip button")].find((x) => x.textContent === "Clear"))`);

  /* The folder window's line must not stay after Cancel. An empty answer file is a window closed
     with nothing chosen (a test copy only). */
  const noAnswer = path.join(DATA, "pick-answer.txt"), pickFile = path.join(DATA, "pick-folder.json");
  fs.writeFileSync(noAnswer, "");
  fs.rmSync(pickFile, { force: true });
  try {
    await clickTab("Paths");
    await b.ev(`document.querySelector("#settings .path-browse").click()`);
    // The press waits its turn behind Settings' own requests while the rows are drawn again, so the button
    // says nothing yet: the answer stays, and nothing is judged, until the page has been told the window closed.
    await apiUntil(async () => { try { return JSON.parse(fs.readFileSync(pickFile, "utf8")).logged === true; } catch (e) { return false; } });
    await b.until(`!/in the window that opened/.test(${stripSays})`, true, 6000);
    check("a folder window closed with nothing chosen takes its line off the strip",
      [await b.until(`document.querySelector("#settings .path-browse").disabled`, false, 6000), await b.ev(`/in the window that opened/.test(${stripSays}) && !document.getElementById("strip").hidden`)],
      [false, false]);
  } finally {
    fs.rmSync(noAnswer, { force: true });
  }

  await clickTab("Library");
  await thumbsAnswer(true);
  await b.ev(buildThumbs);
  check("a build that began closes Settings, since its bar is in the corner", await b.until(`document.getElementById("settings").hidden`, true, 5000), true);
  await b.ev(`window.fetch = window.__realFetch`);

  // The widths set at the top go again: the groups after this one read the
  // list at its natural widths (tests\run.js).
  await api("api/settings.php", { view: { listWidths: {} } });
};
