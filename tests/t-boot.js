/* Opening on last time's copy (js/bootcopy.js), and the page's start-up.
 * The next start draws from the kept answer at once while the library is read:
 * the same, nothing happens; different, the screen is drawn again, keeping your place.
 * What the page did is read from its own log lines (P BOOT ...).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, BASE, sleep } = require("./lib");

// Where a start's time went (index.php, X.started), one line a start: the
// scripts inside the page, or arriving one by one on the ordinary load.
const GLUED = /P BOOT start-up took (\d+)ms: the page (\d+)ms, its (\d+) scripts inside it, making and running them (\d+)ms; (\d+|\?) processor threads, /;
const TOOK = /P BOOT start-up took (\d+)ms: the page (\d+)ms, (\d+) of (\d+) scripts (\d+)ms \(each on average: connecting (\d+)ms, waiting (\d+)ms, receiving (\d+)ms; slowest ([a-z0-9\-]+\.js) (\d+)ms\), running them (\d+)ms; (\d+|\?) processor threads, /;
const STUCK = /P BOOT the page's code has not started after 2s: (\d+) of (\d+) scripts had arrived/;
const JS_ASKED = `performance.getEntriesByType("resource").filter((e) => /\\/js\\/[a-z0-9\\-]+\\.js(\\?|$)/.test(e.name)).length`;

const DRAWN = /P BOOT drawn from last time's copy \((\d+) games\)/;
const CURRENT = /P BOOT last time's copy was current/;
const STALE_WALL = /P BOOT last time's copy was out of date: the consoles drawn again/;
const STALE_GAMES = /P BOOT last time's copy was out of date: drawn again from the fresh library, on the same game/;

async function lines() { return ((await api("api/log.php?tail=400")).lines || []); }
const has = (ls, re) => ls.some((l) => re.test(l));

const FILES = () => fs.readdirSync(path.join(__dirname, "..", "js")).filter((f) => f.endsWith(".js")).length;
const took = (re, ls) => ((ls.filter((l) => re.test(l)).pop() || "").match(re) || []).map((x) => (/^\d+$/.test(x) ? Number(x) : x));

/* The page's scripts ride inside the page (index.php, the loader at its end):
   one answer from the server, each still the module its address names. */
async function gluedStart(b, check, thisStart) {
  const files = FILES();
  await b.goto(BASE + "/");
  const m = took(GLUED, await thisStart(GLUED));
  check("boot: the page's scripts ride inside it, every file in js among them, and the log says where the start's time went",
    [m[3], await b.ev(`window.XSEGON.glued`)], [files, files]);
  check("the browser asks the server for no script at all", await b.ev(JS_ASKED), 0);
  check("each is still the module its address names: asked for by name, it is the page's own, games and all",
    await b.ev(`import("/js/state.js").then((S) => S.games.length > 0)`), true);
  check("and an error in one still names its file and line",
    await b.ev(`import("/js/util.js").then((m) => { try { m.closeOnBackdrop(null, function () {}); } catch (e) { return /\\/js\\/util\\.js:\\d+:\\d+/.test(String(e.stack)); } return "it did not throw"; })`), true);
  check("the start screen is gone once the page is up", await b.waitQuiet(`!document.getElementById("boot-wait")`, 2000), true);
}

/* The start screen (index.php), and the log's line on where the start went.
   Seen on the ordinary load with every answer held back a quarter of a second,
   so the scripts come one by one. */
async function slowStart(b, check, thisStart) {
  const files = FILES();
  const seen = [];
  await b.send("Network.enable");
  await b.send("Network.emulateNetworkConditions", { offline: false, latency: 250, downloadThroughput: -1, uploadThroughput: -1 });
  try {
    await b.ev(`window.__xsLeaving = true`);
    await b.send("Page.navigate", { url: BASE + "/" });
    for (const end = Date.now() + 30000; Date.now() < end;) {
      let s = null;
      try {
        s = await b.ev(`(() => { const w = document.getElementById("boot-wait");
          if (window.__xsLeaving || !window.XSEGON) { return null; }
          return { up: !!window.XSEGON.booted, t: Math.round(performance.now()),
                   say: w ? document.getElementById("boot-say").textContent : null, count: !!document.getElementById("boot-count"),
                   travels: w ? w.querySelector(".fb-track").classList.contains("wait") && getComputedStyle(w.querySelector(".fb-fill")).animationName : null,
                   width: w ? w.querySelector(".fb-fill").style.width : null,
                   shown: w ? getComputedStyle(w.querySelector(".boot-more")).opacity : null }; })()`);
      } catch (e) { s = null; }
      if (s) { seen.push(s); }
      if (s && s.up) { break; }
      await sleep(50);
    }
  } finally {
    await b.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await b.send("Network.disable");
  }
  const waiting = seen.filter((s) => !s.up && s.say !== null);
  check("on a slow start the start screen says it is starting",
    [waiting.length > 5, waiting.every((s) => s.say === "starting Xsegon…")], [true, true]);
  // The bar shows no count of scripts arrived: a piece travels along it.
  check("a piece travels along its bar the whole time, with nothing counted and nothing filling",
    [waiting.every((s) => s.travels === "xs-prog-wait"), waiting.some((s) => s.count), waiting.every((s) => s.width === "")], [true, false, true]);
  check("and the bar is held back a second, so an ordinary start never shows it",
    [waiting.filter((s) => s.t < 700).every((s) => Number(s.shown) === 0), waiting.some((s) => s.t > 2200 && Number(s.shown) === 1)], [true, true]);
  await b.waitQuiet(`!document.getElementById("boot-wait")`, 5000);
  const m = took(TOOK, await thisStart(TOOK));
  check("a browser that cannot take the scripts inside the page is sent every one the ordinary way, and the page is up",
    [await b.ev(`window.XSEGON.glued === undefined && window.XSEGON.booted`), await b.ev(JS_ASKED), m[3], m[4]], [true, files, files, files]);
  // Chrome's hold shows as receiving, not waiting: the three together are what a script took.
  check("the log's line times the scripts then: a quarter of a second each here, and it names the slowest",
    [m[1] > 2000, m[6] + m[7] + m[8] >= 240 ? true : [m[6], m[7], m[8]], typeof m[9]], [true, true, "string"]);
}

/* Anything going wrong while the page makes its modules, before its code is
   asked for: the ordinary load, not a dead page. */
async function brokenGlue(b, check) {
  const broke = (await b.send("Page.addScriptToEvaluateOnNewDocument", { source: `URL.createObjectURL = function () { throw new Error("no blobs here"); };` })).result.identifier;
  try {
    await b.goto(BASE + "/");
    check("when the page cannot make its modules, it loads the ordinary way and is up all the same",
      [await b.ev(`window.XSEGON.glued === undefined && window.XSEGON.booted`), await b.ev(JS_ASKED)], [true, FILES()]);
  } finally {
    await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: broke });
  }
}

/* A page whose code never starts (one script cannot be had): reloaded once,
   and the second time it says so. A tab has no window to restart. The wait
   is 45 seconds; the page takes a shorter one from this test alone. */
async function neverStarts(b, check) {
  const fresh = (ls) => ls.filter((l) => STUCK.test(l));
  const before = b.errors.length;
  await b.ev(`sessionStorage.setItem("xs-boot-wait", "2000"); sessionStorage.removeItem("xs-boot-tries")`);
  await b.send("Network.enable");
  await b.send("Network.setBlockedURLs", { urls: ["*/js/hint.js*"] });
  let ls = [];
  try {
    await b.send("Page.navigate", { url: BASE + "/" });
    for (const end = Date.now() + 15000; Date.now() < end;) {
      ls = fresh(await lines());
      if (ls.some((l) => /left as it is/.test(l))) { break; }
      await sleep(250);
    }
    const first = (ls.find((l) => /reloading once/.test(l)) || "").match(STUCK) || [];
    check("a page whose code has not started is reloaded once, and the log says how far its scripts had got",
      [ls.filter((l) => /reloading once/.test(l)).length, Number(first[2]), Number(first[1]) < Number(first[2])],
      [1, fs.readdirSync(path.join(__dirname, "..", "js")).filter((f) => f.endsWith(".js")).length, true]);
    check("the second time it stops and says so, in the log and on the screen",
      [ls.filter((l) => /a tab, so left as it is/.test(l)).length, await b.ev(`document.getElementById("view").textContent`)],
      [1, "Xsegon did not start. Close this tab and open Xsegon again."]);
    check("and the script that could not be had was named", has(await lines(), /P BOOT before start-up: .*\(js\/main\.js/), true);
  } finally {
    await b.send("Network.setBlockedURLs", { urls: [] });
    await b.send("Network.disable");
    try { await b.ev(`sessionStorage.removeItem("xs-boot-wait"); sessionStorage.removeItem("xs-boot-tries")`); } catch (e) { /* no page */ }
    b.errors.length = Math.min(b.errors.length, before);   // the page was broken on purpose
  }
}

module.exports = async function (b, check) {
  /* The page's own lines since it last started ("P BOOT page ..."), once one
     matching `re` is among them, or six seconds on. Counting matches over the
     log's last 400 lines fails: lines slide out as other groups write. */
  /* The page first writes a mark of its own: until it is in the log, the start
     before could stand in for this one. */
  let marks = 0;
  const thisStart = async (re) => {
    let mine = [];
    const mark = "test mark " + process.pid + "-" + (++marks);
    await b.ev(`import("/js/log.js").then((m) => { m.L("BOOT", ${JSON.stringify(mark)}); })`);
    for (const end = Date.now() + 6000; Date.now() < end;) {
      await b.ev(`import("/js/log.js").then((m) => { m.flushLog(); })`);
      const ls = await lines();
      const at = ls.map((l) => /P BOOT page /.test(l)).lastIndexOf(true);
      mine = at >= 0 && ls.some((l) => l.indexOf(mark) >= 0) ? ls.slice(at) : [];
      if (has(mine, re)) { return mine; }
      await sleep(200);
    }
    return mine;
  };
  const UP = /P NAV\s+(the wall|open on all games)/;
  const kept = `caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("xs-boot-")).map((k) => caches.open(k).then((c) => c.keys()).then((r) => [k, r.length]))))`;
  try {
    await gluedStart(b, check, thisStart);
    /* The start screen and the watchdog are watched on the ordinary load, the
       way back: this page is told its browser reads no import map. */
    const noMaps = (await b.send("Page.addScriptToEvaluateOnNewDocument", { source: `HTMLScriptElement.supports = function () { return false; };` })).result.identifier;
    try {
      await slowStart(b, check, thisStart);
      await neverStarts(b, check);
    } finally {
      await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: noMaps });
    }
    await brokenGlue(b, check);

    /* ---- a first start: nothing kept, the ordinary first load ------------- */
    await b.goto(BASE + "/");
    await sleep(700);                                     // let that start finish keeping its own copy
    await b.ev(`caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).then(() => caches.open("xs-boot-some-older-build")).then((c) => c.put("/__boot/library?x=1", new Response("{}")))`);
    await b.goto(BASE + "/");
    let ls = await thisStart(UP);
    check("boot: with nothing kept, a start waits for the library as it always did", [has(ls, UP), has(ls, DRAWN)], [true, false]);
    const store = await b.ev(kept);
    const build = await b.ev(`String(window.XSEGON.build)`);
    check("and keeps the answer for next time, one of them, under this build's name", store, [["xs-boot-" + build, 1]]);
    check("a copy kept by another build is thrown away, never read", store.some((s) => /older-build/.test(s[0])), false);

    /* ---- the next start: drawn from the copy, and the copy was right ------ */
    const total = (await api("api/library.php?limit=1")).total;
    await b.goto(BASE + "/");
    ls = await thisStart(CURRENT);
    check("the next start is drawn from last time's copy", has(ls, DRAWN), true);
    check("which holds every game", Number((ls.filter((l) => DRAWN.test(l)).pop() || "").match(DRAWN)[1]), total);
    check("and when the library answers the same, nothing is drawn again", has(ls, CURRENT), true);
    const tail = ls.slice(ls.map((l) => DRAWN.test(l)).lastIndexOf(true));
    const wallAt = tail.findIndex((l) => /P NAV\s+the wall/.test(l)), readAt = tail.findIndex((l) => /P API\s+GET library\.php/.test(l));
    check("the consoles are up before the library has answered", [wallAt >= 0, readAt >= 0, wallAt < readAt], [true, true, true]);
    check("the page says the fresh library is in", await b.ev(`window.XSEGON.libraryFresh`), true);

    /* ---- something changed since: one redraw, from the fresh answer ------- */
    const lib = await api("api/library.php?grouped=0");
    const g = lib.games.find((x) => !x.favourite);
    check("(a game is made a favourite between two starts)", (await api("api/favourite.php", { id: g.id, fav: true })).ok, true);
    await b.goto(BASE + "/");
    ls = await thisStart(STALE_WALL);
    check("a copy that is out of date is drawn first, then the consoles are drawn again from the fresh library", [has(ls, DRAWN), has(ls, STALE_WALL)], [true, true]);
    check("and what the page holds is the fresh answer", await b.ev(`import("/js/state.js").then((S) => (S.games.find((x) => x.id === ${JSON.stringify(g.id)}) || {}).favourite)`), true);
    // The console dropdown too: filled only from the copy, Favourites keeps the old count.
    const favs = ((await api("api/library.php?limit=1")).collections || []).find((c) => c.key === "@favourites");
    check("and the console dropdown lists what the fresh library holds, not the copy",
          await b.ev(`(o => o ? o.textContent : null)([...document.getElementById("platform").options].find((o) => o.value === "@favourites"))`),
          favs ? favs.label + "  (" + (favs.note || favs.count) + ")" : null);
    await api("api/favourite.php", { id: g.id, fav: false });

    /* ---- your place is kept: the game you were on, wherever it now sorts --- */
    await api("api/settings.php", { view: { default: "list", systemsFirst: true } });
    await b.goto(BASE + "/", { keepView: true });         // keeps the list's own answer
    // The kept copy with its games the other way round: the game drawn first
    // is the one the fresh library puts last.
    const lastId = await b.ev(`caches.keys().then((ks) => caches.open(ks.find((k) => k.startsWith("xs-boot-")))).then((c) => c.keys().then((reqs) =>
      c.match(reqs[0]).then((r) => r.json()).then((d) => { d.games.reverse(); const id = d.games[0].id;
        return c.put(reqs[0], new Response(JSON.stringify(d))).then(() => id); })))`);
    await b.goto(BASE + "/", { keepView: true });
    ls = await thisStart(STALE_GAMES);
    check("opening on every game from an out-of-date copy, the list is drawn again once", [has(ls, DRAWN), has(ls, STALE_GAMES)], [true, true]);
    check("and the game you were on is still the one selected, in its new place",
      await b.ev(`import("/js/state.js").then((S) => [(S.games[S.sel] || {}).id, S.sel === S.games.length - 1])`), [lastId, true]);

    /* ---- the off switch ---------------------------------------------------- */
    await api("api/settings.php", { feel: { openFromLast: false }, view: { default: "wheel", systemsFirst: true, systemsStyle: "wheel" } });
    await b.goto(BASE + "/");
    ls = await thisStart(UP);
    check("with Open on the copy from last time off, a start waits for the library", [has(ls, UP), has(ls, DRAWN)], [true, false]);
  } finally {
    await api("api/settings.php", { feel: { openFromLast: true }, view: { default: "wheel", systemsFirst: true, systemsStyle: "wheel" } });
  }
};
