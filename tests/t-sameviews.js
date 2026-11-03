/*  The search box and a filter are the same thing in every view: wheel, list,
 *  grid, shelf, rows and carousel, all inside one console.
 *
 *    - a word typed leaves exactly the games the server finds, drawn as that
 *      many cards, rows or plates;
 *    - inside a console its own name is not what a search looks at: every
 *      game there carries it, so it would match all of them. Over every
 *      game the name still finds the console;
 *    - in the box the letters and the caret are the box's. Down leaves it for
 *      the games with the search kept, and the arrows are the view's again
 *      (Left and Right turn the carousel); Esc empties it and leaves it, and
 *      stays in the console;
 *    - a filter leaves the same games in all six.
 *
 *  Nothing is written but the view, which the Guard puts back.
 */
"use strict";
const { api } = require("./lib");

const VIEWS = ["wheel", "list", "grid", "shelf", "rows", "carousel"];
const NODES = { wheel: ".witem", carousel: ".gcard", list: ".row", grid: ".tile", shelf: ".spine", rows: ".rcard" };
const SIDEWAYS = ["grid", "shelf", "carousel"];   // Left and Right step from game to game

module.exports = async function (b, check) {
  /* ---- the server: a console's own name narrows nothing inside it -------- */
  const all = await api("api/library.php?grouped=0");
  const flat = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const holds = (g, w) => [g.title, g.developer, g.publisher, g.genre].concat(g.tags || []).some((v) => flat(v).includes(w));
  // The biggest console whose name has a word that some of its games hold themselves, and not all of them.
  let con = null, word = "";
  for (const name of Object.keys(all.platforms).sort((x, y) => all.platforms[y] - all.platforms[x])) {
    const files = (await api("api/library.php?versions=all&grouped=0&platform=" + encodeURIComponent(name))).games;
    for (const w of name.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 4)) {
      const n = files.filter((g) => holds(g, w)).length;
      if (n > 2 && n < files.length) { con = name; word = w; break; }
    }
    if (con) { break; }
  }
  if (!con) {
    check("(no console here has a word of its name in some of its games and not in all: nothing to hold)", true, true);
    return;
  }
  const here = "&platform=" + encodeURIComponent(con);
  const files = await api("api/library.php?versions=all&grouped=0&q=" + word + here);
  check("inside a console, a word of the console's own name finds only the games that hold it themselves",
        [files.count > 0, files.games.every((g) => holds(g, word))], [true, true]);
  const want = await api("api/library.php?grouped=0&q=" + word + here);
  check("so it narrows the console instead of matching all of it", want.count > 0 && want.count < all.platforms[con], true);
  check("over every game the same word still finds the whole console", (await api("api/library.php?grouped=0&q=" + word)).games.filter((g) => g.platform === con).length, all.platforms[con]);
  const two = await api("api/library.php?grouped=0&players=1" + here);
  const ids = (list) => list.map((g) => g.id).sort();

  /* ---- the page: the same in every view --------------------------------- */
  const S = (expr) => `import("/js/state.js").then((S) => (${expr}))`;
  const pageIds = S(`S.games.map((g) => g.id).sort()`);
  const inBox = `document.activeElement === document.getElementById("q")`;
  const qNow = `document.getElementById("q").value`;
  const drawn = (v) => v === "rows" ? `new Set([...document.querySelectorAll("#view .rcard")].map(n => n.dataset.id)).size`
                                    : `document.querySelectorAll("#view ${NODES[v]}").length`;
  const legend = `[...document.querySelectorAll("#help .hitem .hl")].map((x) => x.textContent)`;
  const type = async (text) => {
    for (let i = 0; i < text.length; i++) {
      await b.key(text[i]);
      await b.until(qNow, text.slice(0, i + 1), 1500);
    }
  };

  await b.goto();
  // The thud is the set's Move played slower: counted as it plays, with Xsegon's sounds on and unmuted for it.
  const soundWas = await b.ev(`import("/js/sound.js").then((m) => { const was = [m.muted, m.SND.sounds]; m.setMuted(false); m.SND.sounds = true;
    const real = HTMLMediaElement.prototype.play; window.__thuds = 0;
    HTMLMediaElement.prototype.play = function () { if (this.playbackRate < 1) { window.__thuds++; } return real.apply(this, arguments); };
    return was; })`);
  await b.openPlatform(con);
  for (const v of VIEWS) {
    if (v !== "wheel") { await b.setView(v); }
    // Wheel and carousel start their journey over on the consoles: the console is opened again.
    if (await b.ev(S(`S.sysStage !== "inside"`))) { await b.openPlatform(con); }
    await b.until(S(`S.games.length`), all.platforms[con], 6000);

    /* the search */
    await b.key("/");
    check(v + ": / puts the keys in the search box, and the legend says how to leave it",
          [await b.until(inBox, true, 2000), (await b.ev(legend)).includes("to the games")], [true, true]);
    await type(word);
    await b.until(S(`S.games.length`), want.count, 6000);
    check(v + ": a word typed leaves exactly the games the server finds, and that many are drawn",
          [await b.ev(pageIds), await b.until(drawn(v), want.count, 3000)], [ids(want.games), want.count]);
    // Where the selection stands is the view's own business (the rows view keeps its place): only that it stays.
    const stood = await b.ev(S(`S.sel`));
    await b.key("ArrowRight");
    const afterRight = await b.ev(S(`S.sel`));
    await b.key("ArrowLeft");
    check(v + ": in the box, Left and Right are the caret's: no game moves and the keys stay in the box",
          [afterRight === stood, (await b.ev(S(`S.sel`))) === stood, await b.ev(inBox)], [true, true, true]);

    /* Down: onto the games, the search kept */
    await b.key("ArrowDown");
    check(v + ": Down leaves the box for the games, the search still on",
          [await b.until(inBox, false, 2000), await b.ev(qNow), await b.ev(S(`S.games.length`))], [false, word, want.count]);
    if (v !== "rows") {
      const down = await b.until(S(`S.sel > 0 && S.sel`), undefined, 2000);
      await b.key("ArrowUp");
      check(v + ": and the arrows are the view's again: Up comes back to the first game", [down > 0, await b.until(S(`S.sel`), 0, 2000)], [true, 0]);
    }

    /* Up past the first game (js\bump.js): the games in sight stretch away from the
       end they ran into, held to it, along the view's own line, and the set's Move
       plays low; the key's own repeat is a key held; then they let go, and a fresh
       press is felt again. Where it stands is the game and, in Rows, the row: a game
       can stand in two rows, so a step up a row may leave the game as it was. */
    const where = S(`S.sel + "|" + [...document.querySelectorAll(".rrow")].findIndex((r) => r.classList.contains("cur"))`);
    let stopped = false;
    for (let i = 0; i < 40 && !stopped; i++) {
      const was = await b.ev(where);
      await b.key("ArrowUp");
      stopped = (await b.ev(where)) === was;
    }
    const thudsBefore = await b.ev(`window.__thuds`);
    // Each game stretched: how far it moved along the line, how much longer it is along it, and across it.
    const ax = v === "carousel" ? 0 : 1;
    const stretched = `[...document.querySelectorAll("#view *")].filter((n) => n.style.scale).map((n) => {
      const t = n.style.translate.split(" ").map(parseFloat), s = n.style.scale.split(" ").map(Number);
      return [t[${ax}] || 0, s[${ax}], s[${1 - ax}]]; })`;
    const pulled = await b.until(`(${stretched}).length > 0`, true, 600);
    const seen = await b.ev(stretched);
    check(v + ": Up past the first game stretches the games in sight " + (v === "carousel" ? "rightwards, held to the left" : "downwards, held to the top"),
          [stopped, pulled, seen.every((x) => x[1] > 1 && x[2] === 1), seen.some((x) => x[0] > 0.5), seen.every((x) => x[0] > -0.5)],
          [true, true, true, true, true]);
    await b.ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", code: "ArrowUp", repeat: true, bubbles: true, cancelable: true }))`);
    check(v + ": with one thud, and the key's own repeat is a key held down: no second one",
          [thudsBefore, await b.ev(`window.__thuds`)], [1, 1]);
    check(v + ": and the games let go, nothing left on them", await b.until(`(${stretched}).length`, 0, 1500), 0);
    await b.key("ArrowUp");
    check(v + ": a fresh press at the end is felt again, whatever the time since the last", await b.until(`window.__thuds`, 2, 1000), 2);
    await b.until(`(${stretched}).length`, 0, 1500);
    await b.ev(`window.__thuds = 0`);
    if (SIDEWAYS.includes(v)) {
      await b.key("ArrowRight");
      check(v + ": Right steps to the next game", await b.until(S(`S.sel`), 1, 2000), 1);
    }

    /* Esc: empties the search and leaves the box, and not the console */
    await b.key("/");
    await b.until(inBox, true, 2000);
    await b.key("Escape");
    await b.until(S(`S.games.length`), all.platforms[con], 6000);
    check(v + ": Esc in the box empties the search and leaves the box, still inside the console",
          [await b.ev(qNow), await b.ev(inBox), await b.ev(S(`S.sysStage`)), await b.ev(S(`S.games.length`)), await b.until(drawn(v), all.platforms[con], 3000)],
          ["", false, "inside", all.platforms[con], all.platforms[con]]);

    /* a filter */
    await b.key("2");
    await b.until(S(`S.games.length`), two.count, 6000);
    check(v + ": Two players or more leaves the same games as in every other view",
          [await b.ev(pageIds), await b.until(drawn(v), two.count, 3000)], [ids(two.games), two.count]);
    await b.key("2");
    await b.until(S(`S.games.length`), all.platforms[con], 6000);
  }

  // Out of the box, Esc is what it always was: back to the consoles.
  await b.key("Escape");
  check("with the keys on the games, Esc still goes back to the consoles", await b.until(S(`S.sysStage`), "wall", 5000), "wall");
  await b.ev(`import("/js/sound.js").then((m) => { m.setMuted(${!!soundWas[0]}); m.SND.sounds = ${soundWas[1] !== false}; })`);
};
