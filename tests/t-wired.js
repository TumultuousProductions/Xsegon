/* Settings rows that must be read by code.
 *
 * Four are walked here: Ask before launching, Confirm with, Show games with
 * no art, Show the platform beside the title. Six that did nothing must stay
 * gone from the screen, and that is checked too.
 *
 * No game starts: the test browser makes every page launch a dry one
 * (tests\lib.js), and the server answers with what it would have run.
 */
"use strict";
const { api, sleep } = require("./lib");

const STATE = `import("/js/state.js")`;
const put = (i) => `Promise.all([${STATE}, import("/js/views.js")]).then(([s, v]) => { s.setSel(${i}); v.render(); return s.sel; })`;
const askUp = `(e => !e.hidden && /PLAY THIS GAME\\?/.test((e.querySelector(".panel-title") || {}).textContent || ""))(document.getElementById("editor"))`;
const stripSays = `(s => s.hidden ? "" : s.textContent)(document.getElementById("strip"))`;

module.exports = async function (b, check) {
  const before = (await api("api/settings.php")).settings;
  const keep = {
    view: { showMissingArt: before.view.showMissingArt !== false, showPlatformInTitle: !!before.view.showPlatformInTitle },
    launch: { confirmBeforeLaunch: !!before.launch.confirmBeforeLaunch, offerStates: before.launch.offerStates !== false },
    controller: { confirmButton: before.controller.confirmButton === "b" ? "b" : "a", enabled: before.controller.enabled !== false },
  };
  try {
    /* ---- the six that are gone ------------------------------------------- */
    const answer = await api("api/settings.php");
    const gone = [["library", "mergeDuplicates"], ["launch", "resumeFromState"], ["feel", "startupVideo"],
                  ["debug", "showStatusBar"], ["debug", "verboseLaunchLog"], ["debug", "showUnmatchedArt"]];
    check("the six settings that did nothing are no longer offered",
          gone.filter(([g, k]) => k in (answer.defaults[g] || {}) || k in ((answer.schema || {})[g] || {})).map((x) => x.join(".")), []);
    check("and the four that stayed each say what they do",
          [["view", "showMissingArt"], ["view", "showPlatformInTitle"], ["launch", "confirmBeforeLaunch"], ["controller", "confirmButton"]]
            .filter(([g, k]) => !(((answer.schema || {})[g] || {})[k] || {}).help).map((x) => x.join(".")), []);

    /* ---- Show games with no art ------------------------------------------- */
    await api("api/settings.php", { view: { showMissingArt: true } });
    const all = await api("api/library.php?grouped=0&versions=all");
    const bare = all.games.filter((g) => !g.hasArt);
    await api("api/settings.php", { view: { showMissingArt: false } });
    const some = await api("api/library.php?grouped=0&versions=all");
    if (bare.length) {
      check("with it off, the games with no box picture are left out", [some.games.some((g) => !g.hasArt), some.games.length], [false, all.games.length - bare.length]);
      const sum = (o) => Object.values(o || {}).reduce((t, n) => t + n, 0);
      check("the consoles count what is left", sum(some.platforms), some.games.length);
      check("and the total says so", some.total, some.games.length);
    } else {
      console.log("    (every game here has a box picture; the hidden-games checks step aside)");
      check("with it off and nothing to hide, every game is still there", some.games.length, all.games.length);
    }
    await api("api/settings.php", { view: { showMissingArt: true } });
    check("switched on again, they are all back", (await api("api/library.php?grouped=0&versions=all")).games.length, all.games.length);

    /* ---- Show the platform beside the title -------------------------------- */
    await api("api/settings.php", { view: { showPlatformInTitle: true }, launch: { confirmBeforeLaunch: false, offerStates: false }, controller: { enabled: true, confirmButton: "a" } });
    await b.goto();
    await b.setView("grid");
    const tile = `(t => t ? [t.querySelector(".cap").childNodes[0].textContent, (t.querySelector(".cap-plat") || {}).textContent || null] : null)(document.querySelector("#view .tile"))`;
    const first = await b.ev(`${STATE}.then((m) => [m.games[0].title, m.games[0].platform, m.games[0].variant || null])`);
    const got = await b.ev(tile);
    check("over every game, a grid tile names its console after the title", [got[0].indexOf(first[0]) === 0, (got[1] || "").replace(/[\s·]/g, "")], [true, first[1].replace(/\s/g, "")]);
    check("quieter than the title it follows", await b.ev(`(c => getComputedStyle(c.querySelector(".cap-plat")).color !== getComputedStyle(c).color)(document.querySelector("#view .tile .cap"))`), true);
    await b.openPlatform(first[1]);
    await b.setView("grid");
    check("inside one console no tile repeats its name", await b.ev(`[document.querySelectorAll("#view .tile").length > 0, document.querySelectorAll("#view .cap-plat").length]`), [true, 0]);
    await api("api/settings.php", { view: { showPlatformInTitle: false } });
    await b.goto();
    await b.setView("grid");
    check("and with it off, no tile anywhere carries one", await b.ev(`[document.querySelectorAll("#view .tile").length > 0, document.querySelectorAll("#view .cap-plat").length]`), [true, 0]);

    /* ---- Ask before launching ----------------------------------------------- */
    const playable = await b.ev(`${STATE}.then((m) => m.games.findIndex((g) => g.playable && !(g.versions && g.versions.length > 1)))`);
    await api("api/settings.php", { launch: { confirmBeforeLaunch: true, offerStates: false } });
    await b.goto();
    await b.setView("list");
    await b.ev(`(() => { window.__launches = 0; const real = window.fetch; window.fetch = function (u, o) { if (String(u).indexOf("api/launch.php") !== -1) { window.__launches++; } return real.call(this, u, o); }; })()`);
    await b.ev(put(playable));
    const title = await b.ev(`${STATE}.then((m) => m.games[m.sel].title)`);
    await b.key("Enter");
    check("with it on, Enter asks first", await b.until(askUp, true, 3000), true);
    check("naming the game, and starting nothing yet", await b.ev(`[document.getElementById("editor").textContent.indexOf(${JSON.stringify(title)}) >= 0, window.__launches]`), [true, 0]);
    check("it opens on Play", await b.ev(`(document.activeElement || {}).textContent`), "Play");
    await b.key("ArrowRight");
    check("Right moves to Not now", await b.until(`(document.activeElement || {}).textContent`, "Not now (esc)", 2000), "Not now (esc)");
    await b.key("Enter");
    check("and Enter there closes it with nothing started", [await b.until(`document.getElementById("editor").hidden`, true, 2000), await b.ev(`window.__launches`)], [true, 0]);
    await b.key("Enter");
    await b.until(askUp, true, 3000);
    await b.key("Escape");
    check("Esc closes it too", [await b.until(`document.getElementById("editor").hidden`, true, 2000), await b.ev(`window.__launches`)], [true, 0]);
    await b.key("Enter");
    await b.until(askUp, true, 3000);
    // A key held down repeats: the Enter that asked must not also answer.
    await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, autoRepeat: true });
    await sleep(200);
    check("a held Enter does not answer its own question", [await b.ev(askUp), await b.ev(`window.__launches`)], [true, 0]);
    await b.key("Enter");
    check("a second press of Enter plays", await b.until(`window.__launches`, 1, 3000), 1);
    check("and the strip answers for the launch", await b.until(`/starting|running|playing|launch/.test(${stripSays})`, true, 5000), true);
    await b.until(`${STATE}.then((m) => !m.busy)`, true, 4000);

    /* ---- Confirm with -------------------------------------------------------- */
    await api("api/settings.php", { launch: { confirmBeforeLaunch: false }, controller: { enabled: true, confirmButton: "b" } });
    await b.goto();
    check("(the consoles screen is up)", await b.ev(`!document.getElementById("syswall").hidden`), true);
    await b.ev(`window.__wdWas = navigator.getGamepads; window.__wdPad = { id: "stand-in", mapping: "standard", connected: true, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }; navigator.getGamepads = () => [window.__wdPad]`);
    const tap = async (n) => { await b.ev(`window.__wdPad.buttons[${n}].pressed = true`); await sleep(180); await b.ev(`window.__wdPad.buttons[${n}].pressed = false`); await sleep(180); };
    try {
      await tap(0);
      check("with Confirm with on B, A no longer opens a console", await b.ev(`!document.getElementById("syswall").hidden`), true);
      await tap(1);
      check("and B does", await b.until(`document.getElementById("syswall").hidden`, true, 4000), true);
      await b.settled();
      check("the legend names B for what confirms and A for back", await b.until(`(h => [(h.find((x) => x[1] === "play") || [])[0], (h.find((x) => /^back/.test(x[1])) || [])[0]])([...document.querySelectorAll("#help .hitem")].map((n) => [n.querySelector(".hk").textContent, n.querySelector(".hl").textContent]))`, ["B", "A"], 3000), ["B", "A"]);
      await tap(0);
      check("and A goes back to the consoles", await b.until(`!document.getElementById("syswall").hidden`, true, 4000), true);
    } finally {
      await b.ev(`navigator.getGamepads = window.__wdWas`);
    }
  } finally {
    await api("api/settings.php", Object.assign({}, keep, { view: Object.assign({ default: "wheel", systemsFirst: true, systemsStyle: "wheel" }, keep.view) }));
  }
};
