/* Jump by letter (js/letters.js): Page Up and Page Down, and the pad's
 * shoulders, go to the next letter of whatever the list is arranged by, and
 * the letter stands large for a moment. Where the list does not run by
 * letter a page is four steps.
 * The landing is worked out with this file's own reading of a letter, never
 * the page's, so a wrong rule in js/letters.js cannot agree with itself.
 */
"use strict";
const { api, sleep } = require("./lib");

const STATE = `import("/js/state.js")`;
const SEL = `${STATE}.then((m) => m.sel)`;
const FLASH = `(f => f ? [f.classList.contains("on"), f.textContent] : [false, null])(document.querySelector(".letterflash"))`;
// Each game's letter in the order on screen; favourites are a run of their own when asked.
const keysOf = (favFirst) => `${STATE}.then((m) => m.games.map((g) => { const c = String(g.sortTitle || g.title).trim().charAt(0).normalize("NFD").charAt(0).toUpperCase(); return (${favFirst ? "g.favourite" : "false"} ? "*" : "") + (/^[A-Z]$/.test(c) ? c : "0-9"); }))`;
const put = (i) => `Promise.all([${STATE}, import("/js/views.js")]).then(([s, v]) => { s.setSel(${i}); v.render(); return s.sel; })`;

// Where a page down or up should land, by the rule in the header of js/letters.js.
function down(keys, at) {
  let to = at + 1;
  while (to < keys.length && keys[to] === keys[at]) { to++; }
  return Math.min(to, keys.length - 1);
}
function up(keys, at) {
  let to = at;
  while (to > 0 && keys[to - 1] === keys[at]) { to--; }
  if (to === at && at > 0) { to = at - 1; while (to > 0 && keys[to - 1] === keys[at - 1]) { to--; } }
  return to;
}

module.exports = async function (b, check) {
  const before = (await api("api/settings.php")).settings;
  const arrange = async (view, shape) => {
    await api("api/settings.php", { view, controller: { enabled: true, arrowsWrap: false } });
    await b.goto();
    await b.setView(shape || "list");
  };
  const press = async (key, want) => { await b.key(key); return b.until(SEL, want, 3000); };
  const flashGone = () => b.until(`(f => !f || !f.classList.contains("on"))(document.querySelector(".letterflash"))`, true, 3000);

  try {
    /* ---- A to Z, in the list ------------------------------------------------ */
    await arrange({ sort: "title", sortReverse: false, favouritesFirst: false, groupHeaders: false });
    let keys = await b.ev(keysOf(false));
    const n = keys.length;
    check("(the library is big enough to have letters to jump between)", n > 30 && new Set(keys).size > 5);

    await b.ev(put(0));
    let want = down(keys, 0);
    check("Page Down goes to the first game of the next letter", await press("PageDown", want), want);
    check("and that letter stands on the screen", await b.until(FLASH, [true, keys[want]], 2000), [true, keys[want]]);
    check("it takes no pointer and sits under the menus", await b.ev(`(s => [s.pointerEvents, Number(s.zIndex) < 200])(getComputedStyle(document.querySelector(".letterflash")))`), ["none", true]);
    const next = down(keys, want);
    check("Page Down again goes on to the letter after", await press("PageDown", next), next);
    check("and the letter on screen follows", await b.until(FLASH, [true, keys[next]], 2000), [true, keys[next]]);
    check("the letter goes again by itself", await flashGone(), true);

    // A letter with three games or more: from inside it, up is its own top first.
    let top = -1;
    for (let i = 1; i < n - 2 && top < 0; i++) { if (keys[i] !== keys[i - 1] && keys[i + 1] === keys[i] && keys[i + 2] === keys[i]) { top = i; } }
    check("(some letter past the first has three games)", top > 0);
    await b.ev(put(top + 2));
    check("Page Up from inside a letter goes to that letter's first game", await press("PageUp", top), top);
    check("and shows that letter", await b.until(FLASH, [true, keys[top]], 2000), [true, keys[top]]);
    want = up(keys, top);
    check("Page Up again goes to the top of the letter before", await press("PageUp", want), want);

    // The ends: nowhere to jump, and with Wrap around off nothing moves.
    await b.ev(put(0));
    await b.key("PageUp"); await sleep(250);
    check("Page Up on the first game stays there", await b.ev(SEL), 0);
    let lastTop = n - 1;
    while (lastTop > 0 && keys[lastTop - 1] === keys[n - 1]) { lastTop--; }
    if (lastTop < n - 1) {
      await b.ev(put(lastTop));
      check("Page Down inside the last letter goes to the last game", await press("PageDown", n - 1), n - 1);
    }
    await b.ev(put(n - 1));
    await b.key("PageDown"); await sleep(250);
    check("and on the last game it stays there", await b.ev(SEL), n - 1);

    /* ---- the pad's shoulders, on the same list ------------------------------- */
    await b.ev(put(top + 2));
    await flashGone();
    await b.ev(`window.__ltWas = navigator.getGamepads; window.__ltPad = { id: "stand-in", mapping: "standard", connected: true, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }; navigator.getGamepads = () => [window.__ltPad]`);
    try {
      await b.ev(`window.__ltPad.buttons[4].pressed = true`);
      check("LB is Page Up: the top of this letter", await b.until(SEL, top, 3000), top);
      await sleep(600);
      check("held down, it jumps once and no more", await b.ev(SEL), top);
      await b.ev(`window.__ltPad.buttons[4].pressed = false`);
      await sleep(150);
      await b.ev(`window.__ltPad.buttons[5].pressed = true`);
      want = down(keys, top);
      check("RB is Page Down: the next letter", await b.until(SEL, want, 3000), want);
      check("with its letter on the screen", await b.until(FLASH, [true, keys[want]], 2000), [true, keys[want]]);
      await b.ev(`window.__ltPad.buttons[5].pressed = false`);
      check("and the legend, speaking pad, names the shoulders", await b.until(`[...document.querySelectorAll("#help .hitem")].some((h) => h.querySelector(".hk").textContent === "LB RB" && h.querySelector(".hl").textContent === "jump")`, true, 2000), true);
    } finally {
      await b.ev(`navigator.getGamepads = window.__ltWas`);
    }

    /* ---- the same in the wheel, which moves by turning, not by drawing again -- */
    // The console with the most games, opened from the consoles screen as a wheel.
    const per = {};
    for (const g of (await api("api/library.php?grouped=0")).games) { per[g.platform] = (per[g.platform] || 0) + 1; }
    const big = Object.keys(per).sort((x, y) => per[y] - per[x])[0];
    await b.goto();
    await b.openPlatform(big);
    keys = await b.ev(keysOf(false));
    await b.ev(put(0));
    want = down(keys, 0);
    check("the wheel turns to the next letter too", [await b.ev(`document.querySelectorAll("#view .witem").length > 0`), await press("PageDown", want)], [true, want]);
    check("and shows it", await b.until(FLASH, [true, keys[want]], 2000), [true, keys[want]]);

    /* ---- favourites first: they are a run of their own ------------------------ */
    await arrange({ sort: "title", sortReverse: false, favouritesFirst: true, groupHeaders: false });
    keys = await b.ev(keysOf(true));
    await b.ev(put(0));
    want = down(keys, 0);
    check("with Favourites first, a jump stays inside the favourites until they end", await press("PageDown", want), want);

    /* ---- Z to A: the next letter is the next one down the list ---------------- */
    await arrange({ sort: "title", sortReverse: true, favouritesFirst: false, groupHeaders: false });
    keys = await b.ev(keysOf(false));
    await b.ev(put(0));
    want = down(keys, 0);
    check("turned round, Page Down still goes to the next letter down the list", await press("PageDown", want), want);
    check("and names it", await b.until(FLASH, [true, keys[want]], 2000), [true, keys[want]]);
    await flashGone();

    /* ---- an order with no letters: four steps, as it always was --------------- */
    await arrange({ sort: "rating", sortReverse: false, favouritesFirst: false, groupHeaders: false });
    await b.ev(put(0));
    check("arranged by rating, Page Down moves four games", await press("PageDown", 4), 4);
    check("and no letter is shown", await b.ev(`(f => !f || !f.classList.contains("on"))(document.querySelector(".letterflash"))`), true);
    await b.setView("grid");
    await b.ev(put(0));
    const cols = await b.ev(`import("/js/views.js").then((v) => v.columns())`);
    want = Math.min(4 * cols, n - 1);
    check("in the grid that is four rows", await press("PageDown", want), want);
  } finally {
    await api("api/settings.php", {
      view: { default: "wheel", systemsFirst: true, systemsStyle: "wheel", sort: "title", sortReverse: false, groupHeaders: false,
              favouritesFirst: !!(before.view && before.view.favouritesFirst) },
      controller: { enabled: !(before.controller && before.controller.enabled === false), arrowsWrap: !!(before.controller && before.controller.arrowsWrap) },
    });
  }
};
