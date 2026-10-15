// The consoles screen and the four game views, by keyboard.
"use strict";
const { BASE, DATA, sleep, api, apiUntil } = require("./lib");
const fs = require("fs");
const path = require("path");

/* The view is drawn again: its first child is marked before `act` and a
   fresh one is waited for, then the arrival animations. */
async function redraw(b, act, ms = 10000) {
  await b.ev(`(n => { if (n) { n.__old = true; } })(document.querySelector("#view > *"))`);
  await b.ev(act);
  await b.waitFor(`(n => !!n && !n.__old)(document.querySelector("#view > *"))`, ms);
  await b.settled();
}
module.exports = async function (b, check) {
  await b.goto();
  check("consoles screen shows first", await b.ev(`!document.getElementById("syswall").hidden`));
  // Nothing built out of sight underneath it: a whole wheel of games built
  // first holds the consoles back.
  check("and no games are drawn out of sight under it",
        await b.ev(`document.querySelectorAll("#view .witem, #view .gcard, #view .tile, #view .row").length`), 0);
  // The legend speaks pad while a pad is in use: the pad poll puts a class on
  // the body. Headless Chrome has no pad, so the class is set by hand and only
  // the shape checked.
  const keyShape = await b.ev(`getComputedStyle(document.querySelector("#help .hk")).borderRadius`);
  await b.ev(`document.body.classList.add("pad")`);
  check("in pad mode the legend's keys are round buttons", await b.ev(`getComputedStyle(document.querySelector("#help .hk")).borderRadius`) !== keyShape);
  await b.ev(`document.body.classList.remove("pad")`);
  check("consoles screen: page cannot scroll", await b.ev(`document.body.classList.contains("on-wall") && document.documentElement.scrollHeight <= innerHeight + 1`));
  // However many the server sent: the full four when something is recently
  // added (or that one greyed), three only if a fresh library had an empty
  // Favourites too. Count against the API, not against a number.
  check("collections ride the rim", await b.ev(`document.querySelectorAll("#syswall .coll").length`),
        ((await api("api/library.php")).collections || []).length);
  check("header at the top", await b.ev(`Math.round(document.querySelector("header.top").getBoundingClientRect().top)`), 0);
  // and edge to edge, like the legend at the foot, while the games below it
  // stay in the centred column
  check("the masthead spans the window", await b.ev(`(() => { const h = document.querySelector("header.top").getBoundingClientRect(), f = document.getElementById("help").getBoundingClientRect(), w = document.documentElement.clientWidth; return { left: Math.round(h.left), right: Math.round(h.right), matchesFoot: Math.round(h.width) === Math.round(f.width), w: w }; })()`).then((h) => h.left === 0 && h.right === h.w && h.matchesFoot));
  check("and the title is not against the glass", await b.ev(`Math.round(document.querySelector("header.top h1").getBoundingClientRect().left)`) >= 12);
  check("no sideways scroll from the full width", await b.ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`));
  const selName = `(n => n ? ((n.querySelector("img") || {}).alt || n.textContent) : "")(document.querySelector("#syswall .sel"))`;
  const first = await b.ev(selName);
  await b.key("ArrowRight");
  check("Right turns the wheel", await b.until(`${selName} !== ${JSON.stringify(first)}`));
  await b.key("ArrowLeft");
  await b.until(`${selName} === ${JSON.stringify(first)}`);
  await b.settled();
  /* The console in the middle, through a quick run: its picture keeps up
     with every step, unblurred and ungreyed, and only its words wait. It
     neither fades whole nor moves, even for a two-line name. */
  const siBox = `(s => s ? [Math.round(s.querySelector(".sysart").getBoundingClientRect().top), getComputedStyle(s).opacity] : null)(document.querySelector(".sysinfo"))`;
  const si0 = await b.ev(siBox);
  for (let i = 0; i < 4; i++) { await b.key("ArrowRight"); await sleep(50); }
  check("a quick run on the consoles keeps the console's picture coming, and only its words wait",
    await b.ev(`(s => { const art = s.querySelector(".sysart"), n = document.querySelector("#syswall .switem.sel"); const name = n ? (n.querySelector("img") ? n.querySelector("img").alt : n.textContent) : "";
      return s.classList.contains("holding") && getComputedStyle(s).opacity === "1" && getComputedStyle(art).filter === "none" && getComputedStyle(art).opacity === "1"
        && parseFloat(getComputedStyle(s.querySelector(".sysname")).opacity) < 0.5 && name !== "" && s.querySelector("img").getAttribute("src").includes(encodeURIComponent(name)); })(document.querySelector(".sysinfo"))`));
  await b.waitFor(`!document.querySelector(".sysinfo").classList.contains("holding")`, 3000);
  check("and the console stands where it stood", await b.ev(siBox), si0);
  check("one picture element, kept from console to console", await b.ev(`document.querySelectorAll(".sysinfo img").length`), 1);

  // the view is chosen BEFORE entering: changing it on the wall sends you
  // back to the wall (by design: switching wheel/carousel re-picks the platform)
  await b.setView("wheel");
  await b.openPlatform("Nintendo 64");
  check("inside a platform", await b.ev(`document.getElementById("platform").value`), "Nintendo 64");
  check("wheel view", await b.ev(`document.getElementById("viewsel").value`), "wheel");
  const items = await b.ev(`document.querySelectorAll(".witem").length`);
  check("wheel has the platform's games", items > 40);
  check("wheel logos keep their clear bed", await b.ev(`[...document.querySelectorAll(".witem img")].every(n => getComputedStyle(n).backgroundColor === "rgba(0, 0, 0, 0)")`));
  const selGame = `(n => n ? ((n.querySelector("img") || {}).alt || n.textContent) : "")(document.querySelector(".witem.sel"))`;
  const t0 = await b.ev(selGame);
  await b.key("ArrowDown");
  check("Down moves the wheel", await b.until(`${selGame} !== ${JSON.stringify(t0)}`));
  await b.settled();
  /* Whether a game here is without a video is the library's business, not
     the page's: with none left without, the check steps aside. */
  const noVideoHere = await b.ev(`import("./js/state.js").then(m => m.games.filter(g => !g.hasVideo).length)`);
  if (noVideoHere > 0) {
    check("no-video mark on some", await b.ev(`document.querySelectorAll(".witem.novid").length`) > 0);
  } else {
    console.log("    (every game on this wheel has a video; the no-video mark check steps aside)");
  }
  /* The info panel beside it. A quick run holds its words back while its
     picture keeps up, neither blurred nor greyed; the panel stays where it
     is, the same size, not faded, so nothing reads as flashing. */
  const heroBox = `(h => { const r = h.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), getComputedStyle(h).opacity]; })(document.getElementById("hero"))`;
  const box0 = await b.ev(heroBox);
  await b.ev(`document.querySelector("#hero .hero-art").__keep = true`);
  for (let i = 0; i < 5; i++) { await b.key("ArrowDown"); await sleep(50); }
  const run = await b.ev(`(async () => { const St = await import("/js/state.js"), U = await import("/js/util.js");
    const h = document.getElementById("hero"), img = h.querySelector(".hero-art"), g = St.games[St.sel];
    return { holding: h.classList.contains("holding"), words: getComputedStyle(h.querySelector(".hero-info")).opacity,
             art: getComputedStyle(img).filter, artOpacity: getComputedStyle(img).opacity,
             current: !g.hasArt || img.getAttribute("src") === U.artUrl(g, "box") }; })()`);
  check("a quick run holds the panel's words back", run.holding && parseFloat(run.words) < 0.5);
  check("while its picture keeps up with every step, neither greyed nor blurred",
        run.current && !/grayscale|blur/.test(run.art) && run.artOpacity === "1");
  check("while the panel itself stays, the same size, not faded", await b.ev(heroBox), box0);
  check("and the words come back when it rests", await b.waitFor(`getComputedStyle(document.querySelector("#hero .hero-info")).opacity === "1" && !/grayscale/.test(getComputedStyle(document.querySelector("#hero .hero-art")).filter) && !document.getElementById("hero").classList.contains("holding")`, 3000));
  check("the picture is the same element throughout, only its address changes", await b.ev(`!!document.querySelector("#hero .hero-art").__keep`));
  check("the panel is just as tall after the run", await b.ev(heroBox), box0);
  /* Two ratings: the library's, named the global rating, and your own, five
     stars to click. A click sets yours; the same star again takes it off. */
  check("the panel names the global rating and yours, first among its facts",
    await b.ev(`[...document.querySelectorAll("#hero .hero-stats .k")].slice(0, 2).map(k => k.textContent).join("|")`), "global rating|my rating");
  const myLit = `document.querySelectorAll("#hero .mystar.on").length`;
  const rated = await b.ev(`(async () => { const St = await import("/js/state.js"); return St.games[St.sel].id; })()`);
  const myWas = await b.ev(myLit);           // the copy may carry one of yours: another star, then it back
  const pick = myWas === 4 ? 3 : 4;
  await b.clickSel(`#hero .mystar:nth-child(${pick})`);
  check("a click on a star lights that many", await b.ev(myLit), pick);
  check("and it is kept", await apiUntil(async () => ((await api("api/library.php")).games.find((g) => g.id === rated) || {}).myRating === pick));
  await b.clickSel(`#hero .mystar:nth-child(${pick})`);
  check("the same star again takes it off", await b.ev(myLit), 0);
  check("and that is kept too", await apiUntil(async () => ((await api("api/library.php")).games.find((g) => g.id === rated) || {}).myRating === 0));
  check("a rating past five is refused", (await api("api/my-rating.php", { id: rated, stars: 6 })).ok, false);
  await api("api/my-rating.php", { id: rated, stars: myWas });
  /* The games area runs from under the bars to just above the legend, and
     whatever stands in it is exactly that tall: a guessed height leaves the
     panel's buttons running on under the legend. */
  var fits = `(() => { const v = document.getElementById("view").getBoundingClientRect(), f = document.getElementById("help").getBoundingClientRect(), h = document.getElementById("hero");
    const hr = h.hidden ? null : h.getBoundingClientRect();
    return Math.round(f.top - v.bottom) >= 4 && Math.round(f.top - v.bottom) <= 20 && (!hr || Math.round(hr.bottom) === Math.round(v.bottom)) && document.documentElement.scrollHeight <= innerHeight; })()`;
  check("the wheel and its panel run to just above the legend, and the page stays still", await b.ev(fits));

  await b.setView("grid");
  check("grid draws tiles", await b.ev(`document.querySelectorAll("#view .tile").length`), items);
  check("grid shows the menu bar", await b.ev(`document.getElementById("toolbar").classList.contains("as-menubar")`));
  // The tile's picture stands on black, so a clear logo or a 3D box is not
  // washed by the panel blue behind it. The tile's caption keeps the panel.
  check("a tile's art stands on black", await b.ev(`getComputedStyle(document.querySelector("#view .tile img.shot")).backgroundColor`), "rgb(0, 0, 0)");
  check("the tile itself is still a panel", await b.ev(`getComputedStyle(document.querySelector("#view .tile")).backgroundColor !== "rgb(0, 0, 0)"`));
  await b.key("ArrowDown");
  check("grid Down goes to a lower row", await b.until(`(() => { const t = [...document.querySelectorAll("#view .tile")]; const s = document.querySelector("#view .tile.sel"); return s.offsetTop > t[0].offsetTop; })()`));
  await b.settled();
  // The grid scrolls in a box of its own, with a scrollbar in the theme, and
  // the page never moves: the masthead and the menu bar stay where they are.
  const barTop = `Math.round(document.getElementById("toolbar").getBoundingClientRect().top)`;
  const bar0 = await b.ev(barTop);
  await b.ev(`document.getElementById("view").scrollTop = 1200`);
  check("the grid scrolls in its own box, not the page", await b.until(`document.getElementById("view").scrollTop > 500 && scrollY === 0`));
  check("header stays at the top while it does", await b.ev(`Math.round(document.querySelector("header.top").getBoundingClientRect().top)`), 0);
  check("and the menu bar does not move", await b.ev(barTop), bar0);
  // and it is under the masthead, never sliding up over the buttons
  check("menu bar is below the masthead, not over it", await b.ev(`(() => { const h = document.querySelector("header.top").getBoundingClientRect(), t = document.getElementById("toolbar").getBoundingClientRect(); return t.top >= h.bottom - 1; })()`));
  check("the grid draws a scrollbar", await b.ev(`(v => v.offsetWidth - v.clientWidth)(document.getElementById("view"))`) >= 8);
  check("and runs to just above the legend", await b.ev(fits));
  check("its tiles keep their height in a box that size", await b.ev(`document.querySelector("#view .tile").offsetHeight > 150`));
  await b.shot("grid-scrolled");
  await b.ev(`document.getElementById("view").scrollTop = 0`);
  /* The message strip pushes the app up instead of lying over it: it is the
     last thing on screen, the legend and the volume corner stand on it, a
     window over everything ends where it begins, and all of it is back at
     the window's foot when the strip goes. */
  const edge = (id) => `(r => ({ top: Math.round(r.top), bottom: Math.round(r.bottom) }))(document.getElementById("${id}").getBoundingClientRect())`;
  const onStrip = `((s, h, v) => !document.getElementById("strip").hidden && s.bottom === innerHeight && h.bottom === s.top && v.bottom === s.top)(${edge("strip")}, ${edge("help")}, ${edge("vol")})`;
  const onFloor = `((h, v) => h.bottom === innerHeight && v.bottom === innerHeight)(${edge("help")}, ${edge("vol")})`;
  const say = (text) => b.ev(`import("/js/launch.js").then((m) => m.showStrip(${JSON.stringify(text)}, false))`);
  check("with no message the legend and the volume corner are at the window's foot", await b.ev(onFloor), true);
  await say("a message the screen makes room for");
  check("the message strip is at the very bottom, the legend and the volume corner standing on it", await b.until(onStrip, true, 3000), true);
  check("and the grid still ends just above the legend, under nothing", await b.until(fits, true, 3000), true);
  await b.clickSel("#btn-settings");
  await b.waitFor(`!document.getElementById("settings").hidden`, 5000);
  check("a window over everything ends where the strip begins, its foot clear of it",
        await b.until(`((p, c, s) => p.bottom === s.top && Math.round(c.bottom) <= s.top)(${edge("settings")}, document.querySelector("#settings .panel-inner").getBoundingClientRect(), ${edge("strip")})`, true, 3000), true);
  await b.key("Escape");
  await b.waitFor(`document.getElementById("settings").hidden`, 5000);
  await b.ev(`document.getElementById("strip").hidden = true`);
  check("and with the strip gone the grid runs to the legend again", await b.until(fits, true, 3000), true);
  check("with the legend and the volume corner back at the window's foot", await b.until(onFloor, true, 3000), true);
  /* And it glides: the strip is there at once and the app moves up out of
     its way, where it would otherwise jump. Motion is switched on for the
     moment (the suite pins reduced motion, under which it jumps, as above). */
  const stripRoom = `parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--strip-h"))`;
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  try {
    await say("a message the screen glides out of the way of");
    check("with motion on, the app is still on its way up when the strip has arrived",
          await b.until(`(room => room > 0 && room < document.getElementById("strip").offsetHeight && ${edge("strip")}.bottom === innerHeight)(${stripRoom})`, true, 2000), true);
    check("and comes to rest with the legend standing on the strip", await b.until(onStrip, true, 3000), true);
    await b.ev(`document.getElementById("strip").hidden = true`);
    check("and glides back down when the strip goes", await b.until(`${stripRoom} === 0 && ${onFloor}`, true, 3000), true);
  } finally {
    await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  }

  /* The gear at the right end of the strip: how big the tiles are drawn
     (js\viewsize.js). One slider in a small window; the grid follows it
     while it moves and it is saved when it rests. */
  const across = `new Set([...document.querySelectorAll("#view .tile")].slice(0, 80).map(t => t.offsetLeft)).size`;
  const across0 = await b.ev(across);
  const selTile = `[...document.querySelectorAll("#view .tile")].findIndex(t => t.classList.contains("sel"))`;
  const selTile0 = await b.ev(selTile);
  check("the grid's strip has a gear for the tiles' size, at its right end, inside the strip",
        await b.ev(`(g => { if (!g) return false; const r = g.getBoundingClientRect(), s = document.querySelector("#view .vcap").getBoundingClientRect();
          return r.width > 20 && r.right <= s.right + 1 && r.left > s.left + s.width / 2 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1; })(document.getElementById("vsize"))`));
  await b.clickSel("#vsize");
  check("it opens a small window with one slider, at the usual size",
        await b.until(`(p => p && p.querySelectorAll("input[type=range]").length === 1 && p.getBoundingClientRect().width <= 320 ? p.querySelector("input").value : null)(document.getElementById("vsize-pop"))`, "100"), "100");
  const slideTo = (v) => b.ev(`(i => { i.value = ${v}; i.dispatchEvent(new Event("input", { bubbles: true })); })(document.querySelector("#vsize-pop input"))`);
  await slideTo(60);
  const acrossSmall = await b.ev(across);
  check("smaller tiles put more of them across, at once", acrossSmall > across0);
  check("and the window says how many", await b.ev(`document.querySelector("#vsize-pop .wpop-hint").textContent`), acrossSmall + " across.");
  await slideTo(180);
  check("larger tiles put fewer across", await b.ev(across) < across0);
  await b.key("ArrowRight");
  check("the arrows move the slider, not the games behind it",
        [await b.until(`document.querySelector("#vsize-pop input").value`, "190"), await b.ev(selTile)], ["190", selTile0]);
  check("the size is saved once it rests", await apiUntil(async () => (await api("api/settings.php")).settings.view.gridSize === 190), true);
  await b.key("Escape");
  check("Esc closes the window and nothing else", await b.until(`!document.getElementById("vsize-pop") && document.getElementById("view").classList.contains("grid")`, true), true);
  await b.openBar("view");
  await b.menuItem(/^Tile size/);
  check("View > Tile size opens the same window", await b.until(`(p => p ? p.querySelector("input").value : null)(document.getElementById("vsize-pop"))`, "190"), "190");
  await b.ev(`document.querySelector("#vsize-pop .vsize-reset").click()`);
  check("and its button puts the usual size back", await b.until(across, across0), across0);
  check("saved as that", await apiUntil(async () => (await api("api/settings.php")).settings.view.gridSize === 100), true);
  await b.ev(`document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
  check("a press anywhere else closes it", await b.until(`!document.getElementById("vsize-pop")`, true), true);

  // a snap gets its own tiny mute button at the video's corner
  const withVideo = await b.ev(`(() => { const t = [...document.querySelectorAll("#view .tile")]; return t.findIndex(x => !x.classList.contains("novid")); })()`);
  if (withVideo >= 0) {
    // the snap starts after its delay; waited for, not slept for
    await b.ev(`document.querySelectorAll("#view .tile")[${withVideo}].click()`);
    await b.until(`!!document.querySelector(".snap-mute")`, true, 8000);
    const mute = await b.ev(`(b => b ? { has: true, muted: b.classList.contains("muted"), w: b.offsetWidth } : { has: false })(document.querySelector(".snap-mute"))`);
    check("a playing snap has a small mute button", mute.has && mute.w <= 24);
    if (mute.has) {
      const kept = await b.ev(`localStorage.getItem("xs-muted")`);
      await b.ev(`document.querySelector(".snap-mute").click()`);
      check("clicking it flips the mute", await b.until(`document.querySelector(".snap-mute").classList.contains("muted")`, !mute.muted) !== mute.muted);
      await b.ev(`document.querySelector(".snap-mute").click()`);
      await b.until(`document.querySelector(".snap-mute").classList.contains("muted")`, mute.muted);
      /* A snap that began silent is given its sound by the first click, and the second mutes
         everything (js\snap.js). What is kept for the next page is put back as it was, or every
         later check that listens for a sound steps aside. */
      await b.ev(`(v => v === null ? localStorage.removeItem("xs-muted") : localStorage.setItem("xs-muted", v))(${JSON.stringify(kept)})`);
    }
    /* Paused from outside, the way the browser pauses it when a Play/Pause
       key arrives (a headphone plug pulled out sends one): it carries on
       rather than sitting on one frame. */
    if (await b.ev(`!!document.querySelector("video.snap")`)) {
      await b.ev(`document.querySelector("video.snap").pause()`);
      check("a snap the browser paused carries on by itself", await b.until(`(v => !!v && !v.paused)(document.querySelector("video.snap"))`, true, 4000), true);
    }
    /* Its own bar: pause or play and how far along, up only while the
       pointer is on the snap. The pause pressed there is the one it keeps. */
    if (await b.ev(`!!document.querySelector("video.snap") && !!document.querySelector(".snap-ctl")`)) {
      const ctlSeen = `getComputedStyle(document.querySelector(".snap-ctl")).opacity`;
      await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
      check("a snap's bar is out of sight with the pointer elsewhere", await b.until(ctlSeen, "0"), "0");
      const mid = await b.ev(`(r => ({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }))(document.querySelector("video.snap").getBoundingClientRect())`);
      await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: mid.x, y: mid.y });
      check("and up while the pointer is on the snap", await b.until(ctlSeen, "1"), "1");
      check("along the video's bottom edge, short of the speaker", await b.ev(`((c, v, m) => c.top >= v.top && c.bottom <= v.bottom + 1 && c.left >= v.left && c.right <= m.left)(
        document.querySelector(".snap-ctl").getBoundingClientRect(), document.querySelector("video.snap").getBoundingClientRect(), document.querySelector(".snap-mute").getBoundingClientRect())`));
      check("it shows how far along the snap is", await b.until(`parseFloat(document.querySelector(".snap-fill").style.width) > 0`, true, 5000), true);
      await b.ev(`document.querySelector(".snap-pp").click()`);
      check("Pause on the bar pauses the snap", await b.until(`document.querySelector("video.snap").paused`, true), true);
      await sleep(900);                      // long enough for the carry-on above to have undone it
      check("and that pause is kept", await b.ev(`(v => !!v && v.paused)(document.querySelector("video.snap"))`), true);
      check("the button now says Play", await b.ev(`document.querySelector(".snap-pp").title`), "Play");
      await b.ev(`document.querySelector(".snap-pp").click()`);
      check("Play carries on", await b.until(`(v => !!v && !v.paused)(document.querySelector("video.snap"))`, true), true);
      check("a press on the bar is not a press on the game", await b.ev(`document.getElementById("details").hidden && document.getElementById("editor").hidden`));
      await b.ev(`document.querySelector(".snap-ctl").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }))`);
      check("a right-click on the bar still opens the game's menu", await b.until(`[...document.querySelectorAll(".ctx-item .ctx-label")].some(n => n.textContent === "Play")`, true), true);
      await b.key("Escape");
      await b.until(`!document.querySelector(".ctx-item")`, true);
      await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
    }
  }
  /* NEEDS FIX says on hover why, and that a successful play takes it off:
     on the marked card and on its stamp, and nowhere on a game that is not
     marked. A card's own hover text stays, and comes back whole when the
     mark goes. Made here rather than found: no game in the library has to
     be broken for it. */
  const fixHover = await b.ev(`import("./js/util.js").then(m => {
    const a = document.createElement("div"), c = document.createElement("div");
    a.className = "tile"; a.title = "Its own title"; c.title = "Another title";
    document.getElementById("view").appendChild(a);
    m.fixMark(a, { needsFix: "it would not start" }); m.fixMark(c, { needsFix: null });
    const mk = a.querySelector(".fixmark");
    const out = { card: a.title, stamp: mk.title, mouse: getComputedStyle(mk).pointerEvents, other: c.title, otherStamp: !!c.querySelector(".fixmark") };
    m.fixMark(a, { needsFix: null });
    out.after = a.title; out.stampAfter = mk.hidden;
    a.remove();
    return out;
  })`);
  const clears = "Needs fix: it would not start\nIt will be unmarked on its next successful play from Xsegon.";
  check("a marked game says on hover how the mark comes off, on the card and on the stamp",
    [fixHover.card, fixHover.stamp, fixHover.mouse !== "none"], ["Its own title\n" + clears, clears, true]);
  check("a game that is not marked says nothing of it", [fixHover.other, fixHover.otherStamp], ["Another title", false]);
  check("and the card's own hover text is back when the mark goes", [fixHover.after, fixHover.stampAfter], ["Its own title", true]);

  // A click on another tile moves the highlight, the way a key does: drawing
  // the whole grid again would replay every tile's arrival, a blink per click.
  const clicked = await b.ev(`(() => { const t = [...document.querySelectorAll("#view .tile")]; t.forEach(x => { x.__old = true; }); const i = (t.findIndex(x => x.classList.contains("sel")) + 1) % t.length; t[i].click(); return i; })()`);
  check("a click on another tile moves the highlight without drawing the grid again",
    await b.until(`(t => t.every(x => x.__old) && t[${clicked}].classList.contains("sel") && t.filter(x => x.classList.contains("sel")).length === 1)([...document.querySelectorAll("#view .tile")])`));

  await b.setView("list");
  check("list draws rows", await b.ev(`document.querySelectorAll("#view .row").length`), items);
  check("the list's strip has a gear too, which says Rows: its rows follow the text size, so it holds a switch and no size",
        await b.ev(`(g => !!g && !!g.closest("#view .vcap") && !!g.querySelector("svg") ? g.textContent.trim() : null)(document.getElementById("vsize"))`), "Rows");
  check("the list and the panel beside it run to just above the legend", await b.ev(fits));
  check("and the list draws a scrollbar", await b.ev(`(v => v.offsetWidth - v.clientWidth)(document.getElementById("view"))`) >= 8);
  check("TITLE sits level with the other column headers", await b.ev(`(() => { const y = [...document.querySelectorAll("#view .lhead .lh-t")].map(x => { const r = x.getBoundingClientRect(); return Math.round(r.top + r.height / 2); }); return y.every(v => Math.abs(v - y[0]) <= 1); })()`));
  // Title's cell is the header's full height where the others are a line of text: its line and grip must not run into the first row.
  check("and no header's dividing line or grip runs past the header", await b.ev(`(() => { const head = document.querySelector("#view .lhead").getBoundingClientRect();
    return [...document.querySelectorAll("#view .lhead span.lh:not(.lh-filler)")].every(h => {
      const r = h.getBoundingClientRect(), line = getComputedStyle(h, "::before"), g = h.querySelector(".lh-grip").getBoundingClientRect();
      const top = r.top + parseFloat(line.top), tall = parseFloat(line.height);
      return g.top >= head.top - 1 && g.bottom <= head.bottom + 1 && (line.content === "none" || (top >= head.top - 1 && top + tall <= head.bottom + 1)); }); })()`));

  /* ---- the table: headers, the column picker, highlighting ---------------
     The list is the only view with a shape you can change, so it is the only
     one with a header. listColumns is in the Guard, so selecting columns here
     cannot leave the next run looking at a different table. */
  check("the list has column headers", await b.ev(`[...document.querySelectorAll("#view .lhead .lh-t")].map(x => x.textContent.replace(/\\s*[\\u25B2\\u25BC]$/, ""))`),
        ["Title", "System", "Genre", "Time"]);
  // The arrow points up for smallest first: A to Z here.
  const arrowOn = `(h => h ? h.textContent.trim().slice(-1) : "")(document.querySelector("#view .lhead .lh.on .lh-t"))`;
  check("the sorted column is marked, with its direction", await b.ev(arrowOn), "▲");
  // One template, read twice: a header that does not line up with its rows
  // is worse than no header at all.
  check("the header lines up with the rows exactly", await b.ev(`(() => {
    const h = document.querySelector("#view .lhead"), r = document.querySelector("#view .row");
    return getComputedStyle(h).gridTemplateColumns === getComputedStyle(r).gridTemplateColumns; })()`));
  check("it stays put when the list scrolls", await b.ev(`getComputedStyle(document.querySelector("#view .lhead")).position`), "sticky");

  // pressing a header sorts by it, through Arrange By's own value
  await b.ev(`[...document.querySelectorAll("#view .lhead .lh.sortable")].find(h => /System/.test(h.textContent)).click()`);
  check("pressing a header sorts by that column", await b.waitFor(`document.getElementById("sort").value === "platform"`, 6000));
  await b.ev(`[...document.querySelectorAll("#view .lhead .lh.sortable")].find(h => /System/.test(h.textContent)).click()`);
  check("pressing the same one again turns it round", await b.waitFor(`document.querySelector("#view .lhead .lh.on .lh-t").textContent.trim().endsWith("▼")`, 6000));
  // A number column starts largest first, arrow down, and says which way the next press goes.
  await b.ev(`[...document.querySelectorAll("#view .lhead .lh.sortable")].find(h => /Time/.test(h.textContent)).click()`);
  await b.waitFor(`document.getElementById("sort").value === "playtime"`, 6000);
  check("Time sorts longest played first, arrow down",
        [await b.waitFor(`document.querySelector("#view .lhead .lh.on.c-seconds") !== null`, 6000), await b.ev(arrowOn),
         await b.ev(`document.querySelector("#view .lhead .lh.on").title`)],
        [true, "▼", "Longest played first. Press again for Shortest played first. Drag to move this column. Right-click for more"]);
  /* Wait for the redraw itself, not a value the click sets at once: drawing
     the list closes the column picker, so opening it mid-render opens it into
     nothing. The marked header node going is the only signal the redraw has
     landed; `sort` is set synchronously and a sleep is a race. */
  await b.ev(`document.querySelector("#view .lhead").dataset.probe = "sortwait"`);
  await b.ev(`[...document.querySelectorAll("#view .lhead .lh.sortable")].find(h => /Title/.test(h.textContent)).click()`);
  await b.waitFor(`document.getElementById("sort").value === "title"`, 6000);
  check("the redraw after a header press really lands",
        await b.waitFor(`!document.querySelector('#view .lhead[data-probe="sortwait"]')`, 8000));
  // The rows themselves, not only the arrow: Title again runs Z to A, and a third press A to Z.
  {
    const topTitle = `(c => c ? c.textContent : "")(document.querySelector("#view .row .c-title"))`;
    const pressTitle = async () => {
      await b.ev(`document.querySelector("#view .lhead").dataset.probe = "sortwait"`);
      await b.ev(`[...document.querySelectorAll("#view .lhead .lh.sortable")].find(h => /Title/.test(h.textContent)).click()`);
      await b.waitFor(`!document.querySelector('#view .lhead[data-probe="sortwait"]')`, 8000);
    };
    const aToZ = await b.ev(topTitle);
    await pressTitle();
    check("Title pressed again runs Z to A, arrow down", [(await b.ev(topTitle)) !== aToZ, await b.ev(arrowOn)], [true, "▼"]);
    await pressTitle();
    check("and a third press runs A to Z again, arrow up", [await b.ev(topTitle), await b.ev(arrowOn)], [aToZ, "▲"]);
  }

  // A snap in the info panel keeps the panel's width but takes its own shape; a press shows it large.
  {
    // Rows with a snap (no novid mark), a few of them, since a snap file may be missing from this copy of data.
    const tries = await b.ev(`[...document.querySelectorAll("#view .row")].map((r, i) => r.matches(":not(.novid):not(.dead)") ? i : -1).filter(i => i > 0).slice(0, 4)`);
    let playing = false;
    for (const at of tries) {
      await b.ev(`document.querySelectorAll("#view .row")[${at}].click()`);
      if ((playing = await b.until(`(v => !!v && v.style.display !== "none" && v.videoWidth > 0)(document.querySelector("#hero video.snap"))`, true, 6000))) { break; }
    }
    if (tries.length) {
      if (playing) {
        check("the panel's snap is as wide as its frame, in the video's own shape", await b.ev(`(v => {
          const f = v.parentNode.clientWidth, h = v.parentNode.clientHeight, want = v.offsetWidth * v.videoHeight / v.videoWidth;
          return (Math.abs(v.offsetWidth - f) <= 2 || Math.abs(v.offsetHeight - h) <= 2) && Math.abs(v.offsetHeight - want) <= 2; })(document.querySelector("#hero video.snap"))`), true);
        /* The frame closes up to the snap's height (a 4:3 one fills under half
           of it), the words come up under it, and Play keeps the foot so it
           never moves from under a hand. */
        const boxes = `((q) => ({ v: q("#hero video.snap"), f: q("#hero .hero-art-frame"), i: q("#hero .hero-info"), p: q("#hero > .bar"), h: q("#hero"), m: q("#hero .snap-mute"), c: q("#hero .snap-ctl") }))((s) => { const n = document.querySelector(s); return n ? n.getBoundingClientRect() : null; })`;
        check("the panel's frame closes up to the snap's height", await b.until(`(b => !!b.v && Math.abs(b.f.height - b.v.height) <= 2 && Math.abs(b.f.top - b.v.top) <= 2)(${boxes})`, true, 6000), true);
        check("and the words come up to stand right under it", await b.ev(`(b => b.i.top >= b.v.bottom && b.i.top - b.v.bottom < 30)(${boxes})`));
        check("while Play keeps the foot of the panel", await b.ev(`(b => b.p.top > b.i.bottom + 40 && b.h.bottom - b.p.bottom < 30)(${boxes})`));
        check("the speaker and the bar rode up on the snap's bottom edge", await b.ev(`(b => !!b.m && !!b.c && Math.abs(b.v.bottom - 4 - b.m.bottom) <= 2 && Math.abs(b.v.bottom - 4 - b.c.bottom) <= 2)(${boxes})`));
        await b.ev(`document.querySelector("#hero video.snap").click()`);
        check("a press on it shows it large", await b.until(`!document.getElementById("editor").hidden && !!document.querySelector("#editor .vv-video")`, true, 4000), true);
        const big = `document.querySelector("#editor .vv-video")`;
        check("carrying on playing there", await b.until(`(v => !!v && !v.paused)(${big})`, true, 6000), true);
        if (await b.ev(`${big}.paused`)) {
          console.log("    the large video: " + JSON.stringify(await b.ev(`(v => [v.readyState, v.networkState, v.muted, v.error && v.error.code, v.currentSrc.slice(-40)])(${big})`)));
        }
        await b.ev(`document.querySelector("#editor .vv-play").click()`);
        check("where Pause pauses it and says Play", await b.until(`${big}.paused && document.querySelector("#editor .vv-play").textContent === "Play"`, true, 3000), true);
        await b.ev(`document.querySelector("#editor .vv-play").click()`);
        check("and Play plays it again", await b.until(`!${big}.paused`, true, 3000), true);
        await b.key("Escape");
        check("Esc puts it back small in the panel", await b.until(`document.getElementById("editor").hidden && !!document.querySelector("#hero video.snap")`, true, 10000), true);
        // The next picture needs the room: no glide back, the frame is whole at once.
        await b.until(`document.querySelector("#hero .hero-art-frame").classList.contains("snap-fit")`, true, 6000);
        const whole = await b.ev(`document.querySelector("#hero .hero-info").getBoundingClientRect().top`);
        await b.key("ArrowDown");
        check("moving to another game opens the frame again at once", await b.ev(`(f => !f.classList.contains("snap-fit") && f.style.height === "" && !document.querySelector("#hero video.snap"))(document.querySelector("#hero .hero-art-frame"))`));
        check("and the words are back where they stand for a cover", await b.ev(`document.querySelector("#hero .hero-info").getBoundingClientRect().top`).then((t) => t > whole + 40));
      } else {
        console.log("    (no snap would play in this copy of data; the panel snap checks step aside)");
      }
      // Back to the top of the list, where the checks below expect it.
      await b.ev(`document.querySelectorAll("#view .row")[0].click()`);
      await b.ev(`document.getElementById("view").scrollTop = 0`);
      await b.settled();
    } else {
      console.log("    (no game with a snap in this list; the panel snap checks step aside)");
    }
  }

  // the hamburger: every column offered, Title not removable
  await b.ev(`document.querySelector("#view .lh-cols").click()`);
  check("the hamburger offers every column", await b.until(`document.querySelectorAll(".lcols .lcols-row").length`, 21), 21);
  await b.settled();
  // Twenty-one in one run would be taller than a small window: four headings, side by side.
  check("under four headings that stand side by side", await b.ev(`(() => {
    const g = [...document.querySelectorAll(".lcols .lcols-group")], tops = g.map(x => Math.round(x.getBoundingClientRect().top));
    return [g.map(x => x.querySelector(".lcols-ghead").textContent), g.map(x => x.querySelectorAll(".lcols-row").length), tops.every(t => t === tops[0])]; })()`),
    [["About the game", "Your marks", "Stats", "Files and pictures"], [8, 4, 4, 5], true]);
  // The panel hangs from its right edge: given less width it must fold, not leave the screen by the left.
  check("it is given the room to its left and no more, and with less the headings fold under each other", await b.ev(`(() => {
    const p = document.querySelector(".lcols"), r = document.querySelector("#view .lh-cols").getBoundingClientRect();
    const room = parseInt(p.style.maxWidth, 10) === Math.round(r.right - 8), was = p.style.maxWidth;
    p.style.maxWidth = "420px";
    const tops = [...p.querySelectorAll(".lcols-group")].map(x => Math.round(x.getBoundingClientRect().top));
    const folded = p.getBoundingClientRect().width <= 420 && new Set(tops).size > 1;
    p.style.maxWidth = was;
    return [room, folded]; })()`), [true, true]);
  check("what Filter by asks is offered as columns", await b.ev(`(g => [1, 3].map(i => [...g[i].querySelectorAll(".lcols-name")].map(n => n.textContent)))(document.querySelectorAll(".lcols .lcols-group"))`),
    [["Favourite", "Your rating", "Tags", "Cheats"], ["Missing art", "Ready", "Needs fix", "Source", "File", "Documents", "Hack", "Discs"]]);
  check("and the whole panel is on the screen, not clipped by the list", await b.ev(`(() => {
    const r = document.querySelector(".lcols").getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && r.width > 100; })()`));
  check("Title cannot be taken away", await b.ev(`document.querySelector(".lcols .lcols-row.fixed input").disabled`));
  /* Clicked, not a change event dispatched at the box: a listener on the
     click is never met by a test that only fires `change`. Anything a finger
     does, the test does. */
  await b.ev(`[...document.querySelectorAll(".lcols .lcols-row")]
    .find(x => /Developer/.test(x.textContent)).querySelector("input").click()`);
  check("selecting one adds the column", await b.waitFor(`[...document.querySelectorAll("#view .lhead .lh-t")].some(x => /Developer/.test(x.textContent))`, 6000));
  // The list redraws when a column is selected. The panel has to survive that,
  // or you could only ever choose one column per opening.
  check("and the picker is still open, ready for the next one",
        await b.ev(`!!document.querySelector(".lcols")`));
  // A row carries one cell more than the header has columns: the empty one
  // under the hamburger, which is what keeps the two lined up.
  check("and the rows grew a cell to match", await b.ev(`(() => {
    const h = document.querySelectorAll("#view .lhead .lh").length;
    const c = document.querySelectorAll("#view .row")[0].querySelectorAll(".cell:not(.pad)").length;
    return h === c && h === 5; })()`));

  // Several clicks in a row must all land: the panel must not go after the first.
  for (const name of ["Publisher", "Year", "Rating"]) {
    await b.ev(`[...document.querySelectorAll(".lcols .lcols-row")]
      .find(x => x.querySelector(".lcols-name").textContent === ${JSON.stringify(name)})
      .querySelector("input").click()`);
    // its header drawn and the picker back up, ready for the next click
    await b.until(`!!document.querySelector(".lcols") && [...document.querySelectorAll("#view .lhead .lh-t")].some(x => x.textContent.startsWith(${JSON.stringify(name === "Year" ? "Year" : name)}))`);
    await b.settled();
  }
  // Time was already on, one of the usual four: each column selected arrives at
  // the right-hand end, after it, in the order it was selected.
  check("and four clicks in a row all land, each at the right-hand end", await b.ev(`
    [...document.querySelectorAll("#view .lhead .lh-t")].map(x => x.textContent.replace(/\\s*[\\u25B2\\u25BC]$/, ""))`),
    ["Title", "System", "Genre", "Time", "Developer", "Publisher", "Year", "Rating"]);
  check("with the picker still up after all of them",
        await b.ev(`!!document.querySelector(".lcols")`));
  // Every selection redrew the header, so this is a button the picker was not opened from.
  await b.ev(`document.querySelector("#view .lh-cols").click()`);
  check("a press on the button puts the picker away, on the button a redraw made too",
        await b.until(`!document.querySelector(".lcols")`));
  await b.ev(`document.querySelector("#view .lh-cols").click()`);
  check("and the next press opens it again", await b.until(`!!document.querySelector(".lcols")`));
  await b.settled();
  await b.ev(`document.getElementById("count").click()`);
  check("while a press outside it still puts it away",
        await b.until(`!document.querySelector(".lcols")`));
  // it is remembered on the server, not just on this page
  check("the choice is saved", (await api("api/settings.php")).settings.view.listColumns.includes("developer"));

  /* ---- more columns than fit ------------------------------------------
     There is no cap on how many you may choose, so the table must be able
     to be wider than its box: html has overflow-x hidden, so columns past
     the edge, and the hamburger, would otherwise be gone. */
  await api("api/settings.php", { view: { listColumns: ["title", "platform", "genre", "developer",
    "publisher", "released", "rating", "favourite", "myRating", "players", "plays", "seconds", "lastPlayed", "addedAt",
    "tags", "cheats", "missing", "ready", "needsFix", "source", "file"] } });
  await b.goto(BASE + "/");
  await b.key("Enter");
  await b.waitFor(`document.getElementById("syswall").hidden && !document.getElementById("main").hidden && !!document.querySelector("#view > *")`, 10000);
  await b.settled();
  await b.setView("list");
  await b.until(`document.querySelectorAll("#view .lhead .lh").length`, 21, 8000);
  await b.settled();
  const wide = await b.ev(`(() => { const l = document.getElementById("view");
    return { client: l.clientWidth, scroll: l.scrollWidth,
             cols: document.querySelectorAll("#view .lhead .lh").length }; })()`);
  check("every column can be on at once", wide.cols, 21);
  check("and the table is then wider than its box", wide.scroll > wide.client);
  check("the hamburger stays on the screen, so a column can be taken off again",
        await b.ev(`(() => { const r = document.querySelector("#view .lh-cols").getBoundingClientRect();
          return r.right <= innerWidth && r.left >= 0 && r.width > 0; })()`));

  /* What Filter by asks, as columns: every cell read against
     the game the page holds for its row, over every game, so the rule is
     held for favourites, tagged, dead and incomplete games alike. */
  {
    const here = await b.ev(`document.getElementById("platform").value`);
    const open = async (v) => {
      await b.ev(`document.querySelector("#view .lhead").dataset.probe = "platwait"`);
      await b.ev(`(s => { s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event("change", { bubbles: true })); })(document.getElementById("platform"))`);
      await b.waitFor(`!!document.querySelector("#view .lhead") && !document.querySelector('#view .lhead[data-probe="platwait"]')`, 10000);
      await b.settled();
    };
    await open("");
    const cells = await b.ev(`import("/js/state.js").then((S) => [...document.querySelectorAll("#view .row")].map((r, i) => {
      const g = S.games[i], t = (k) => (r.querySelector(".c-" + k) || {}).textContent;
      return { fav: !!g.favourite, tags: g.tags || [], cheats: g.cheats || 0, playable: !!g.playable, isReady: g.ready, why: g.why, fix: g.needsFix,
               has: [g.hasArt, g.hasBox3d, g.hasLogo, g.hasShot, g.hasFanart, g.hasVideo], from: g.steam ? "Steam" : g.local ? "Your own" : g.scanned ? "Scanned" : "LaunchBox", name: g.file,
               c: { fav: t("favourite"), tags: t("tags"), cheats: t("cheats"), missing: t("missing"), ready: t("ready"), fix: t("needsFix"), source: t("source"), file: t("file") },
               red: r.querySelector(".c-ready").classList.contains("off") }; }))`);
    const KINDS = ["box art", "3D box", "logo", "screenshot", "fanart", "video"];
    const lacks = (x) => KINDS.filter((_, i) => !x.has[i]).join(" · ");
    const readyWords = (x) => !x.playable ? (x.why || "no launch") : x.isReady === false ? "its drive is not there right now" : "ready";
    const wrong = (rule) => { const n = cells.filter((x) => !rule(x)).length; return n ? n + " of " + cells.length + " rows" : true; };
    check("every game is in the list for it", cells.length > 20);
    check("Missing art names exactly what each game lacks, in Image Group's words", wrong((x) => x.c.missing === lacks(x)), true);
    check("and is empty for a game that lacks nothing", wrong((x) => x.has.some((h) => !h) || x.c.missing === ""), true);
    check("Favourite is a star on your favourites and nothing else", wrong((x) => x.c.fav === (x.fav ? "★" : "")), true);
    check("Tags are the game's own, in a row", wrong((x) => x.c.tags === x.tags.join(" · ")), true);
    check("Cheats is how many are selected, blank for none", wrong((x) => x.c.cheats === (x.cheats ? String(x.cheats) : "")), true);
    check("Ready says ready, or why not, by the server's own answer", wrong((x) => x.c.ready === readyWords(x)), true);
    check("and a game that is not ready says so in red", wrong((x) => x.red === (x.c.ready !== "ready")), true);
    check("Needs fix is the reason, blank for a game with none", wrong((x) => x.c.fix === (x.fix || "")), true);
    check("Source says where the game came from", wrong((x) => x.c.source === x.from), true);
    check("File is the file's name", wrong((x) => x.c.file === (x.name || "")), true);
    const some = (rule) => cells.filter(rule).length;
    console.log("    (in this library: " + some((x) => x.c.missing !== "") + " lack some art, " + some((x) => x.fav) + " favourites, " +
                some((x) => x.tags.length) + " tagged, " + some((x) => x.c.ready !== "ready") + " not ready)");

    /* Every header sorts. Missing art is walked: most kinds first, turned
       round by a second press, the games that lack nothing last both ways.
       Favourites may lead, so each half is read by itself. */
    check("every column's header can be pressed to sort", await b.ev(`[...document.querySelectorAll("#view .lhead span.lh:not(.lh-filler)")].every(h => h.classList.contains("sortable"))`));
    const press = async (name) => {
      await b.ev(`document.querySelector("#view .lhead").dataset.probe = "sortwait"`);
      await b.ev(`[...document.querySelectorAll("#view .lhead .lh.sortable")].find(h => h.textContent.indexOf(${JSON.stringify(name)}) === 0).click()`);
      await b.waitFor(`!document.querySelector('#view .lhead[data-probe="sortwait"]')`, 8000);
    };
    const kindsIn = `[...document.querySelectorAll("#view .row")].map(r => [r.classList.contains("fav"), (t => t ? t.split(" · ").length : 0)(r.querySelector(".c-missing").textContent)])`;
    const inOrder = (rows, up) => [true, false].every((fav) => {
      const v = rows.filter((r) => r[0] === fav).map((r) => r[1]), none = v.indexOf(0), has = none < 0 ? v : v.slice(0, none);
      return has.every((n, i) => i === 0 || (up ? has[i - 1] <= n : has[i - 1] >= n)) && v.slice(has.length).every((n) => n === 0); });
    await press("Missing art");
    check("a press on Missing art sorts by it, most missing first, and the header says so",
          [await b.ev(`document.getElementById("sort").value`), await b.ev(arrowOn), await b.ev(`document.querySelector("#view .lhead .lh.on").title`), inOrder(await b.ev(kindsIn), false)],
          ["missing", "▼", "Most missing first. Press again for Least missing first. Drag to move this column. Right-click for more", true]);
    check("and the server keeps it, as it keeps any sort", (await api("api/settings.php")).settings.view.sort, "missing");
    await b.openBar("arrange");
    check("Arrange By names it while it is the order in use", await b.ev(`[...document.querySelectorAll(".ctx-item.on")].map(n => (n.querySelector(".ctx-label") || n).textContent.trim())`), ["Missing art"]);
    await b.key("Escape");
    await b.until(`!document.querySelector(".ctx")`, true, 3000);
    await press("Missing art");
    check("a second press turns it round: least missing first, the complete games still last", [await b.ev(arrowOn), inOrder(await b.ev(kindsIn), true)], ["▲", true]);
    await press("Title");
    await b.openBar("arrange");
    check("and back on Title, Arrange By lists only its own twelve again", await b.ev(`[...document.querySelectorAll(".ctx-item")].some(n => /Missing art/.test(n.textContent))`), false);
    await b.key("Escape");
    await b.until(`!document.querySelector(".ctx")`, true, 3000);
    await open(here);
  }

  /* Your own rating: a column of the stars you gave and a sort of its own,
     the unrated last either way. Favourites do not lead this one: unrated
     favourites would stand as a gap between the stars. Two games are given
     stars for it and put back. */
  {
    const here = await b.ev(`document.getElementById("platform").value`);
    const open = async (v) => {
      await b.ev(`document.querySelector("#view .lhead").dataset.probe = "platwait"`);
      await b.ev(`(s => { s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event("change", { bubbles: true })); })(document.getElementById("platform"))`);
      await b.waitFor(`!!document.querySelector("#view .lhead") && !document.querySelector('#view .lhead[data-probe="platwait"]')`, 10000);
      await b.settled();
    };
    const two = (await api("api/library.php?grouped=0")).games.slice(0, 2);
    if (two.length === 2) {
      await api("api/my-rating.php", { id: two[0].id, stars: 2 });
      await api("api/my-rating.php", { id: two[1].id, stars: 5 });
      await open("");
      const press = async (name) => {
        await b.ev(`document.querySelector("#view .lhead").dataset.probe = "sortwait"`);
        await b.ev(`[...document.querySelectorAll("#view .lhead .lh.sortable")].find(h => h.textContent.indexOf(${JSON.stringify(name)}) === 0).click()`);
        await b.waitFor(`!document.querySelector('#view .lhead[data-probe="sortwait"]')`, 8000);
      };
      const stars = `[...document.querySelectorAll("#view .row .c-myRating")].map(c => c.textContent.length)`;
      const ordered = (v, up) => { const some = v.indexOf(0) < 0 ? v : v.slice(0, v.indexOf(0));
        return [some.length >= 2, some.every((n, i) => i === 0 || (up ? some[i - 1] <= n : some[i - 1] >= n)), v.slice(some.length).every((n) => n === 0)]; };
      await press("Your rating");
      check("Your rating is a column, and its header sorts your highest first with the unrated last, favourites and all",
            [await b.ev(`document.getElementById("sort").value`), await b.ev(arrowOn), ...ordered(await b.ev(stars), false)], ["myrating", "▼", true, true, true]);
      check("its cells are the stars you gave, and say so in words",
            await b.ev(`[...document.querySelectorAll("#view .row .c-myRating")].some(c => c.textContent === "★★★★★" && c.title === "Yours: 5 of 5")`), true);
      await press("Your rating");
      check("pressed again it runs your lowest first, the unrated still last", [await b.ev(arrowOn), ...ordered(await b.ev(stars), true)], ["▲", true, true, true]);
      await api("api/my-rating.php", { id: two[0].id, stars: two[0].myRating || 0 });
      await api("api/my-rating.php", { id: two[1].id, stars: two[1].myRating || 0 });
      await press("Title");
      await open(here);
    } else {
      console.log("    (fewer than two games in this library; the Your rating column checks step aside)");
    }
  }

  const titleAt = `Math.round(document.querySelector("#view .row .c-title").getBoundingClientRect().left)`;
  const yearAt = `Math.round(document.querySelector("#view .row .c-released").getBoundingClientRect().left)`;
  const before = await b.ev(`[${titleAt}, ${yearAt}]`);
  const headTitleAt = `Math.round(document.querySelector("#view .lhead .c-title").getBoundingClientRect().left)`;
  const headBefore = await b.ev(headTitleAt);
  await b.ev(`document.getElementById("view").scrollLeft = 400`);
  await b.until(`document.getElementById("view").classList.contains("xscroll")`);
  await b.settled();
  const after = await b.ev(`[${titleAt}, ${yearAt}]`);
  check("scrolling sideways leaves the title column where it is", after[0], before[0]);
  /* And the headers never meet at either frozen edge: the Title header stays
     with the titles, and the last headers pass under a solid column picker. */
  check("the TITLE header stays with the titles", await b.ev(headTitleAt), headBefore);
  check("the column picker is a solid block the headers pass under", await b.ev(`(c => { const bg = getComputedStyle(c).backgroundColor; const r = c.getBoundingClientRect(), h = c.parentElement.getBoundingClientRect();
    return bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent" && Math.round(r.top) <= Math.round(h.top) + 1 && Math.round(r.bottom) >= Math.round(h.bottom) - 2; })(document.querySelector("#view .lh-cols"))`));
  check("and no header shows through it", await b.ev(`(() => { const c = document.querySelector("#view .lh-cols"), r = c.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(x, y); return !!hit && (hit === c || c.contains(hit)); })()`));
  check("while the rest of the table moves under it", after[1] < before[1] - 300);
  check("and the list says it is scrolled, which is what draws the edge",
        await b.ev(`document.getElementById("view").classList.contains("xscroll")`));
  // The frozen column has to be opaque or the columns slide through it.
  check("the frozen column hides what passes behind it", await b.ev(`
    getComputedStyle(document.querySelector("#view .row .c-title")).backgroundColor !== "rgba(0, 0, 0, 0)"`));
  /* And it covers the whole row: the row aligns cells on the baseline, so a
     frozen cell only as tall as its text lets columns show through above and
     below. The row's 1px separator stays visible, so the cell may be that much shorter. */
  check("corner to corner, not a band across the middle", await b.ev(`(() => {
    const r = document.querySelector("#view .row").getBoundingClientRect();
    const c = document.querySelector("#view .row .c-title").getBoundingClientRect();
    return c.top === r.top && r.bottom - c.bottom <= 1; })()`));

  /* The pad has no sideways gesture, so left and right move the table rather
     than the selection. */
  await b.ev(`document.getElementById("view").scrollLeft = 0`);
  await b.until(`!document.getElementById("view").classList.contains("xscroll")`);
  const wasSel = await b.ev(`[...document.querySelectorAll("#view .row")].findIndex(r => r.classList.contains("sel"))`);
  await b.key("ArrowRight");
  check("right arrow moves the table sideways", await b.until(`document.getElementById("view").scrollLeft > 0`));
  await b.settled();
  check("and does not move the selection while doing it",
        await b.ev(`[...document.querySelectorAll("#view .row")].findIndex(r => r.classList.contains("sel"))`), wasSel);
  await b.key("ArrowLeft");
  check("left arrow brings it back", await b.until(`document.getElementById("view").scrollLeft === 0`));

  /* ---- dragging a column wider ----------------------------------------
     The grip lives just past a header cell's right edge: `overflow: hidden`
     on the cell clips it away while it still reports a size, so the ellipsis
     is on the text, and this presses real pixels rather than calling a handler. */
  await api("api/settings.php", { view: { listColumns: ["title", "platform", "genre", "developer", "seconds"], listWidths: {} } });
  await b.goto(BASE + "/");
  await b.key("Enter");
  await b.waitFor(`document.getElementById("syswall").hidden && !document.getElementById("main").hidden && !!document.querySelector("#view > *")`, 10000);
  await b.settled();
  await b.setView("list");
  await b.until(`document.querySelectorAll("#view .lhead .lh-grip").length`, 5, 8000);
  await b.settled();
  check("every column has a grip to drag",
        await b.ev(`document.querySelectorAll("#view .lhead .lh-grip").length`), 5);
  check("and the grip is what the pointer actually finds there", await b.ev(`(() => {
    const g = document.querySelector("#view .lhead .c-developer .lh-grip");
    const r = g.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return hit === g ? true : (hit ? hit.tagName + "." + hit.className + (hit.id ? "#" + hit.id : "") : "nothing");   // a miss says what is on top
  })()`), true);

  const sortWas = await b.ev(`document.getElementById("sort").value`);
  await b.dragBy("#view .lhead .c-developer .lh-grip", 120);
  check("dragging it makes the column wider", await b.ev(`
    Math.round(document.querySelector("#view .lhead .c-developer").getBoundingClientRect().width) > 250`));
  // The header sorts when pressed, so the grip has to swallow its own press.
  check("and does not sort the table on the way",
        await b.ev(`document.getElementById("sort").value`), sortWas);
  check("the rows follow the header exactly", await b.ev(`(() => {
    const h = Math.round(document.querySelector("#view .lhead .c-developer").getBoundingClientRect().width);
    const r = Math.round(document.querySelector("#view .row .c-developer").getBoundingClientRect().width);
    return h === r ? true : [h, r];        // the numbers, so a miss says how far
  })()`), true);
  check("and the width reaches the server",
        (await api("api/settings.php")).settings.view.listWidths.developer > 250);

  /* Title is the track that stretches, so giving it a width of its own means
     something else has to take the slack: a filler track, and one more empty
     cell on every row to match it. */
  await b.dragBy("#view .lhead .c-title .lh-grip", -60);
  check("the title can be dragged too", (await api("api/settings.php")).settings.view.listWidths.title > 0);
  check("and the rows grow the extra empty cell the filler needs", await b.ev(`(() => {
    const h = document.querySelectorAll("#view .lhead span.lh").length;
    const c = document.querySelectorAll("#view .row")[0].querySelectorAll(".cell").length;
    return c === h + 1; })()`));
  check("with the header and the rows still on one template", await b.ev(`
    getComputedStyle(document.querySelector("#view .lhead")).gridTemplateColumns ===
    getComputedStyle(document.querySelector("#view .row")).gridTemplateColumns`));

  // Double-click the grip puts that one column back, and leaves the others.
  await b.doubleClickSel("#view .lhead .c-developer .lh-grip");
  const left = (await api("api/settings.php")).settings.view.listWidths;
  // Written as a boolean on purpose: check(name, got, want) reads a `want` of
  // undefined as "no expected value given, just tell me `got` is truthy", so
  // asserting that something IS undefined the other way round can never pass.
  check("double-clicking a grip puts that column back", left.developer === undefined);
  check("and leaves the other widths alone", left.title > 0);

  await b.ev(`document.querySelector("#view .lh-cols").click()`);
  await b.until(`!!document.querySelector(".lcols-allreset")`);
  // By name, not by position: the panel has two reset buttons once a width
  // has been dragged, and "the first one" is the other one.
  await b.ev(`document.querySelector(".lcols-allreset").click()`);
  check("and there is a way back to the usual four", await b.waitFor(`document.querySelectorAll("#view .lhead .lh").length === 4`, 6000));
  await b.settled();
  // "The usual" has to mean the widths as well, or half of it puts itself
  // back and you are left wondering which half.
  check("which puts the widths back too",
        await apiUntil(async () => Object.keys((await api("api/settings.php")).settings.view.listWidths || {}).length === 0), true);
  check("which needs no sideways scrolling at all", await b.ev(`(() => {
    const l = document.getElementById("view"); return l.scrollWidth <= l.clientWidth; })()`));
  check("so the frozen column stops being marked", await b.ev(`!document.getElementById("view").classList.contains("xscroll")`));

  /* The edge in hand stays under the pointer, not running over other headers.
     Measured part way through a drag, the mouse still down: the edge, the
     scroll, and only the held grip lit. */
  {
    const widths = async () => (await api("api/settings.php")).settings.view.listWidths || {};
    const titleTrack = `Math.round(parseFloat(getComputedStyle(document.querySelector("#view .lhead")).gridTemplateColumns))`;
    // Press on a column's grip, move by dx, read where its edge is with the mouse down, let go.
    const dragSeen = async (key, dx) => {
      const p = await b.ev(`(() => { const g = document.querySelector("#view .lhead .c-${key} .lh-grip"), r = g.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), edge: Math.round(g.parentNode.getBoundingClientRect().right), scroll: Math.round(document.getElementById("view").scrollLeft) }; })()`);
      await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "none", buttons: 0 });
      await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 4; i++) { await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x + Math.round(dx * i / 4), y: p.y, button: "left", buttons: 1 }); }
      const mid = `(() => { const v = document.getElementById("view");
        return [Math.round(v.querySelector(".lhead .c-${key}").getBoundingClientRect().right) - ${p.edge}, Math.round(v.scrollLeft) - ${p.scroll},
                [...v.querySelectorAll(".lh-grip")].filter((n) => getComputedStyle(n, "::after").opacity > 0.5).length]; })()`;
      const seen = await b.until(mid, [dx, 0, 1], 2000);
      await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x + dx, y: p.y, button: "left", buttons: 0, clickCount: 1 });
      await b.until(`!document.getElementById("view").classList.contains("resizing")`, true, 2000);
      return seen;                           // how far the edge went, how far the list scrolled, how many grips were lit
    };
    // The table as it comes: Title stretching, everything in sight.
    check("the table as it comes: an edge dragged wider stays under the pointer, and its grip alone is lit", await dragSeen("platform", 80), [80, 0, 1]);
    check("let go, the column keeps that width and Title gives up the room: the table still fills the list, nothing to scroll to",
          [await apiUntil(async () => (await widths()).platform === 270), (await widths()).title === undefined,
           await b.until(`(l => l.scrollWidth <= l.clientWidth)(document.getElementById("view"))`, true)], [true, true, true]);
    check("and narrower the same way", await dragSeen("genre", -60), [-60, 0, 1]);
    // Title's cell is 14px wider than its track: read off the cell, a drag of Title would begin with a 14px jump.
    const titleWas = await b.ev(titleTrack);
    check("Title's edge moves by what the pointer moves, with no jump at the start", await dragSeen("title", -40), [-40, 0, 1]);
    check("and is kept as exactly that", await apiUntil(async () => (await widths()).title === titleWas - 40), true);
    // Wider than the list and scrolled to its right-hand end, where a narrowing table can slide back under the pointer.
    await b.ev(`(async () => { const St = await import("/js/state.js"), V = await import("/js/views.js");
      St.S.view.listWidths = { title: 600, platform: 700, genre: 700 }; V.render();
      const v = document.getElementById("view"); v.scrollLeft = v.scrollWidth; return true; })()`);
    check("(the table is wider than the list now, and scrolled to its end)",
          await b.until(`(v => v.scrollLeft > 100 && v.scrollLeft >= v.scrollWidth - v.clientWidth - 1)(document.getElementById("view"))`, true), true);
    check("scrolled to the right-hand end, an edge dragged narrower stays under the pointer and the list does not slide", await dragSeen("genre", -80), [-80, 0, 1]);
    check("and that width is kept", await apiUntil(async () => (await widths()).genre === 620), true);
    await api("api/settings.php", { view: { listWidths: {} } });
    await b.ev(`(async () => { const St = await import("/js/state.js"), V = await import("/js/views.js"); St.S.view.listWidths = {}; V.render(); return true; })()`);
    await b.settled();
  }

  /* ---- a column carried to another place ----------------------------------
     A header held by its name and pulled sideways is put down between two
     others, and the order is kept (js\listmove.js). Title stays first; a
     press that does not move still sorts, and one that carried does not. Real
     pixels, as for the grip: the carrying begins on a pointer going down. */
  {
    const heads = `[...document.querySelectorAll("#view .lhead .lh-t")].map(x => x.textContent.replace(/\\s*[\\u25B2\\u25BC]$/, ""))`;
    const kept = async () => (await api("api/settings.php")).settings.view.listColumns.join();
    const USUAL = ["title", "platform", "genre", "seconds"];
    const shown = `({ copy: !!document.querySelector(".lh-ghost"), line: !!document.querySelector(".lh-drop"),
      moving: document.getElementById("view").classList.contains("moving"), dim: document.querySelectorAll("#view .lh.carried").length })`;
    const NOTHING = { copy: false, line: false, moving: false, dim: 0 };
    const box = (sel) => b.ev(`(r => ({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), left: Math.round(r.left), right: Math.round(r.right) }))(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`);
    const mouse = (type, x, y, down) => b.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !down ? "none" : "left", buttons: down ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1 });
    // The page's own list of columns set and drawn, as a start to carry from.
    const draw = async (keys) => {
      await b.ev(`(async () => { const St = await import("/js/state.js"), V = await import("/js/views.js"); St.S.view.listColumns = ${JSON.stringify(keys)}; V.render(); return true; })()`);
      await b.settled();
    };
    // Press on a header's name, go to x in steps, read the screen with the button down, hold or press Esc if asked, and let go.
    const carry = async (key, toX, more) => {
      const p = await box("#view .lhead .c-" + key + " .lh-t");
      await mouse("mouseMoved", p.x, p.y, false);
      await mouse("mousePressed", p.x, p.y, true);
      for (let i = 1; i <= 6; i++) { await mouse("mouseMoved", Math.round(p.x + (toX - p.x) * i / 6), p.y, true); }
      const mid = await b.ev(shown);
      const lineAt = await b.ev(`(n => n ? Math.round(n.getBoundingClientRect().left) : null)(document.querySelector(".lh-drop"))`);
      const held = more && more.until ? await b.until(more.until, true, 5000) : null;
      if (more && more.esc) { await b.key("Escape"); }
      const after = await b.ev(shown);
      await mouse("mouseReleased", toX, p.y, false);
      return { mid, lineAt, held, after };
    };

    await draw(["title", "seconds", "platform", "genre"]);
    check("the columns stand in the order they are kept in, not the table's own", await b.ev(heads), ["Title", "Time", "System", "Genre"]);
    await draw(["genre", "title", "nope", "genre", "platform"]);
    check("Title is first whatever is kept, and a name that is no column or comes twice is passed over", await b.ev(heads), ["Title", "Genre", "System"]);
    await api("api/settings.php", { view: { listColumns: USUAL } });
    await draw(USUAL);

    const sortWas = await b.ev(`document.getElementById("sort").value`);
    let seen = await carry("genre", (await box("#view .lhead .c-platform")).left + 20);
    check("a header held and pulled shows a copy under the pointer and a line where it would land, and dims where it stood", seen.mid, { copy: true, line: true, moving: true, dim: 1 });
    check("let go in front of System, it stands there", await b.until(heads, ["Title", "Genre", "System", "Time"], 6000), ["Title", "Genre", "System", "Time"]);
    check("the rows follow the header", await b.ev(`[...document.querySelector("#view .row").querySelectorAll(".cell:not(.pad)")].map(c => [...c.classList].find(k => /^c-/.test(k)))`),
          ["c-title", "c-genre", "c-platform", "c-seconds"]);
    check("the order is kept on the server", await apiUntil(async () => (await kept()) === "title,genre,platform,seconds"), true);
    check("the carrying did not sort the table", await b.ev(`document.getElementById("sort").value`), sortWas);
    check("and nothing of it is left on screen", await b.ev(shown), NOTHING);

    await b.clickSel("#view .lhead .c-platform .lh-t");
    check("a press on a header's name that does not move still sorts", await b.waitFor(`document.getElementById("sort").value === "platform"`, 6000));
    await b.ev(`document.querySelector("#view .lhead").dataset.probe = "sortwait"`);
    await b.ev(`[...document.querySelectorAll("#view .lhead .lh.sortable")].find(h => /Title/.test(h.textContent)).click()`);
    await b.waitFor(`document.getElementById("sort").value === "title" && !document.querySelector('#view .lhead[data-probe="sortwait"]')`, 8000);
    await b.settled();

    const title = await box("#view .lhead .c-title");
    seen = await carry("title", title.x + 300);
    check("Title is not picked up", [seen.mid, await b.ev(heads)], [NOTHING, ["Title", "Genre", "System", "Time"]]);
    seen = await carry("seconds", title.left + 30);
    check("carried over Title, the line stands at Title's right-hand edge and the column lands right after it, never in front",
          [Math.abs(seen.lineAt - (title.right + 6)) <= 3, await b.until(heads, ["Title", "Time", "Genre", "System"], 6000)], [true, ["Title", "Time", "Genre", "System"]]);
    seen = await carry("genre", (await box("#view .lhead .c-platform")).right - 10, { esc: true });
    check("Esc while carrying puts it back: the copy and the line go, nothing is put down, and the list is not left",
          [seen.after, await b.ev(heads), await b.ev(`!document.getElementById("main").hidden && document.getElementById("view").classList.contains("list")`),
           await apiUntil(async () => (await kept()) === "title,seconds,genre,platform")],
          [NOTHING, ["Title", "Time", "Genre", "System"], true, true]);

    await b.ev(`document.querySelector("#view .lh-cols").click()`);
    check("the picker offers a way back while the order is not the usual one", await b.until(`!!document.querySelector(".lcols-oreset")`, true, 3000), true);
    await b.ev(`document.querySelector(".lcols-oreset").click()`);
    check("Back to the usual order puts the same columns in the table's own order, and keeps that",
          [await b.until(heads, ["Title", "System", "Genre", "Time"], 6000), await apiUntil(async () => (await kept()) === USUAL.join())], [["Title", "System", "Genre", "Time"], true]);
    await b.ev(`document.querySelector("#view .lh-cols").click()`);
    await b.until(`!!document.querySelector(".lcols")`, true, 3000);
    check("and it is not offered when the order is the usual one", await b.ev(`!!document.querySelector(".lcols-oreset")`), false);
    await b.ev(`document.querySelector("#view .lh-cols").click()`);
    await b.until(`!document.querySelector(".lcols")`, true, 3000);

    // More columns than fit: held near the right-hand end, the table scrolls under the carried header.
    await draw(["title", "platform", "genre", "developer", "publisher", "released", "rating", "players", "plays", "seconds", "lastPlayed", "addedAt", "file"]);
    const list = await box("#view");
    seen = await carry("platform", list.right - 30, { until: `document.getElementById("view").scrollLeft > 150` });
    check("held near the right-hand end of a table wider than its box, the table scrolls under the carried header", seen.held, true);
    check("and it is put down far from where it stood", await apiUntil(async () => (await kept()).split(",").indexOf("platform") >= 4), true);
    await api("api/settings.php", { view: { listColumns: USUAL, listWidths: {} } });
    await draw(USUAL);
    await b.ev(`document.getElementById("view").scrollLeft = 0`);
    await b.settled();
  }

  /* ---- more for the list: striped rows from the gear on its strip,
     your stars pressed in a game's own row, and a header's own menu. Real
     pixels where the pointer is the point: the stars come with it, and the
     menu with a right-click. */
  {
    const heads = `[...document.querySelectorAll("#view .lhead .lh-t")].map(x => x.textContent.replace(/\\s*[\\u25B2\\u25BC]$/, ""))`;
    const kept = async () => (await api("api/settings.php")).settings.view;
    const USUAL = ["title", "platform", "genre", "seconds"];
    const box = (sel) => b.ev(`(r => ({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }))(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`);
    const mouse = (type, x, y, button) => b.send("Input.dispatchMouseEvent", { type, x, y, button: button || (type === "mouseMoved" ? "none" : "left"),
                                                                                buttons: type === "mousePressed" ? (button === "right" ? 2 : 1) : 0, clickCount: type === "mouseMoved" ? 0 : 1 });
    const press = async (x, y, button) => { await mouse("mouseMoved", x, y); await mouse("mousePressed", x, y, button); await mouse("mouseReleased", x, y, button); };
    const draw = async (keys) => {
      await b.ev(`(async () => { const St = await import("/js/state.js"), V = await import("/js/views.js"); St.S.view.listColumns = ${JSON.stringify(keys)}; V.render(); return true; })()`);
      await b.settled();
    };
    // The menu on screen: its heading, and each entry with whether it is greyed or marked.
    const menu = `(c => c ? [(c.querySelector(".ctx-title") || {}).textContent, [...c.querySelectorAll(".ctx-item")].map(n => n.querySelector(".ctx-label").textContent + (n.classList.contains("off") ? " (off)" : "") + (n.classList.contains("on") ? " (on)" : ""))] : null)(document.querySelector(".ctx"))`;
    const headMenu = async (key) => { const p = await box("#view .lhead .c-" + key + " .lh-t"); await press(p.x, p.y, "right"); await b.waitFor(`!!document.querySelector(".ctx")`, 3000); };

    // striped rows
    check("striped rows are off unless asked for", [(await api("api/settings.php")).defaults.view.listStripes, await b.ev(`document.body.classList.contains("list-stripes")`)], [false, false]);
    await b.clickSel("#vsize");
    check("the gear on the list's strip opens a small window with one switch and no slider",
          await b.until(`(p => p ? [p.querySelector(".wpop-head").textContent, p.querySelector(".wpop-k").textContent, p.querySelectorAll("input[type=checkbox]").length, p.querySelectorAll("input[type=range]").length, p.querySelector("input").checked] : null)(document.getElementById("vsize-pop"))`, ["Rows", "Striped rows", 1, 0, false]),
          ["Rows", "Striped rows", 1, 0, false]);
    await b.clickSel("#vsize-pop input");
    // Every other game a shade apart, the chosen one aside: it keeps its bar.
    const stripes = `(() => { const r = [...document.querySelectorAll("#view .row")].slice(0, 8);
      return r.length > 3 && r.every((n, i) => n.classList.contains("sel") || (getComputedStyle(n).backgroundColor !== "rgba(0, 0, 0, 0)") === (i % 2 === 1)); })()`;
    check("the switch stripes every other row at the press, the window staying open", [await b.until(stripes, true), await b.ev(`!!document.getElementById("vsize-pop")`)], [true, true]);
    check("and it is kept", await apiUntil(async () => (await kept()).listStripes === true), true);
    check("the page arrives striped the next time", await b.ev(`fetch("/").then(r => r.text()).then(t => /<body class="[^"]*\\blist-stripes\\b/.test(t))`), true);
    await b.key("Escape");
    check("Esc closes the window, the stripes and the list staying", await b.until(`!document.getElementById("vsize-pop") && document.body.classList.contains("list-stripes") && document.getElementById("view").classList.contains("list")`, true), true);
    await b.openBar("view");
    check("View > Striped rows says they are on", await b.ev(`(n => !!n && n.classList.contains("on"))([...document.querySelectorAll(".ctx-item")].find(n => /^Striped rows$/.test(n.querySelector(".ctx-label").textContent)))`), true);
    await b.menuItem(/^Striped rows$/);
    check("and turns them off again, kept", [await b.until(`document.body.classList.contains("list-stripes")`, false), await b.until(stripes, false), await apiUntil(async () => (await kept()).listStripes === false)], [false, false, true]);

    // your stars, pressed in a game's own row
    await api("api/settings.php", { view: { listColumns: ["title", "platform", "myRating", "seconds"] } });
    await draw(["title", "platform", "myRating", "seconds"]);
    // A game with no stars of yours, not the chosen one, whose row is in sight under the headers.
    const at = await b.ev(`import("/js/state.js").then((St) => { const v = document.getElementById("view").getBoundingClientRect(), top = document.querySelector("#view .lhead").getBoundingClientRect().bottom;
      return [...document.querySelectorAll("#view .row")].findIndex((n, i) => { const r = n.getBoundingClientRect(); return St.games[i] && !St.games[i].myRating && i !== St.sel && r.top >= top && r.bottom <= v.bottom; }); })`);
    if (at >= 0) {
      const cell = `document.querySelectorAll("#view .row")[${at}].querySelector(".c-myRating")`;
      const mine = `import("/js/state.js").then((St) => [St.games[${at}].myRating, St.sel, document.getElementById("details").hidden])`;
      const id = await b.ev(`import("/js/state.js").then((St) => St.games[${at}].id)`), selWas = await b.ev(`import("/js/state.js").then((St) => St.sel)`);
      const onServer = async () => ((await api("api/library.php")).games.find((g) => g.id === id) || {}).myRating;
      check("a game with no stars of yours shows none until the pointer comes", await b.ev(`[${cell}.textContent, ${cell}.querySelectorAll(".mystar").length]`), ["", 0]);
      const c = await b.ev(`(r => ({ x: r.left + 4, y: r.top + r.height / 2 }))(${cell}.getBoundingClientRect())`);
      const tall = await b.ev(`document.querySelectorAll("#view .row")[${at}].getBoundingClientRect().height`);
      await mouse("mouseMoved", c.x, c.y);
      check("the pointer on its Your rating brings five stars, the row no taller", [await b.until(`${cell}.querySelectorAll(".mystar").length`, 5), await b.ev(`document.querySelectorAll("#view .row")[${at}].getBoundingClientRect().height`)], [5, tall]);
      const star = await b.ev(`(r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }))(${cell}.querySelectorAll(".mystar")[3].getBoundingClientRect())`);
      await press(star.x, star.y);
      check("a press on the fourth gives the game four: the row is not chosen and its details do not open", await b.until(mine, [4, selWas, true]), [4, selWas, true]);
      check("and it is kept", await apiUntil(async () => (await onServer()) === 4), true);
      await press(star.x, star.y);
      check("a press on the rating it has takes it off, kept", [await b.until(mine, [0, selWas, true]), await apiUntil(async () => (await onServer()) === 0)], [[0, selWas, true], true]);
      // Given beside the list, the chosen game's row says the same without being drawn again.
      const own = `import("/js/state.js").then((St) => document.querySelectorAll("#view .row")[St.sel].querySelector(".c-myRating").textContent)`;
      const ownWas = await b.ev(`document.querySelectorAll("#hero .mystar.on").length`), give = ownWas === 2 ? 3 : 2;
      await b.clickSel(`#hero .mystar:nth-child(${give})`);
      check("stars given in the panel beside the list show in the game's row at once", await b.until(own, "★★★★★".slice(0, give)), "★★★★★".slice(0, give));
      const chosen = await b.ev(`import("/js/state.js").then((St) => St.games[St.sel].id)`);
      await api("api/my-rating.php", { id: chosen, stars: ownWas });
    } else {
      console.log("    (no unrated game among the rows in sight; the stars pressed in a row step aside)");
    }
    await api("api/settings.php", { view: { listColumns: USUAL } });
    await draw(USUAL);

    // a header's own menu
    await headMenu("genre");
    check("a right-click on a header opens its own menu", await b.ev(menu), ["Genre", ["A to Z", "Z to A", "Move left", "Move right", "Fit to its longest entry", "Remove this column"]]);
    await b.menuItem(/^Move right$/);
    check("Move right moves it one place, kept", [await b.until(heads, ["Title", "System", "Time", "Genre"], 6000), await apiUntil(async () => (await kept()).listColumns.join() === "title,platform,seconds,genre")],
          [["Title", "System", "Time", "Genre"], true]);
    check("its menu is up again, and at the right-hand end Move right is greyed", await b.until(`(m => m ? m[1][3] : null)(${menu})`, "Move right (off)"), "Move right (off)");
    await b.menuItem(/^Move left$/);
    check("Move left moves it back, the menu standing on Move left for the next press",
          [await b.until(heads, ["Title", "System", "Genre", "Time"], 6000), await b.until(`(n => n ? n.querySelector(".ctx-label").textContent : null)(document.querySelector(".ctx .ctx-item.at"))`, "Move left")],
          [["Title", "System", "Genre", "Time"], "Move left"]);
    await b.menuItem(/^Move left$/);
    check("right after Title, Move left is greyed and Title is still first", [await b.until(heads, ["Title", "Genre", "System", "Time"], 6000), await b.until(`(m => m ? m[1][2] : null)(${menu})`, "Move left (off)")],
          [["Title", "Genre", "System", "Time"], "Move left (off)"]);
    await b.ev(`document.querySelector("#view .lhead").dataset.probe = "sortwait"`);
    await b.menuItem(/^Z to A$/);
    await b.waitFor(`!document.querySelector('#view .lhead[data-probe="sortwait"]')`, 8000);
    check("Z to A sorts by the column that way round in one press, kept",
          [await b.ev(`document.getElementById("sort").value`), await b.ev(`(h => h ? h.textContent.trim().slice(-1) : "")(document.querySelector("#view .lhead .lh.on.c-genre .lh-t"))`),
           await apiUntil(async () => { const v = await kept(); return v.sort === "genre" && v.sortReverse === true; })], ["genre", "▼", true]);
    await headMenu("genre");
    check("and the menu marks the way it is sorted", (await b.ev(menu))[1].slice(0, 2), ["A to Z", "Z to A (on)"]);
    await b.key("Escape");
    await b.until(`!document.querySelector(".ctx")`, true, 3000);
    await headMenu("title");
    check("Title's menu sorts and nothing more", await b.ev(menu), ["Title", ["A to Z", "Z to A"]]);
    await b.ev(`document.querySelector("#view .lhead").dataset.probe = "sortwait"`);
    await b.menuItem(/^A to Z$/);
    await b.waitFor(`!document.querySelector('#view .lhead[data-probe="sortwait"]')`, 8000);
    check("and A to Z there puts the list back by title, its usual way", [await b.ev(`document.getElementById("sort").value`), await apiUntil(async () => { const v = await kept(); return v.sort === "title" && v.sortReverse === false; })], ["title", true]);
    // Fit: a column dragged far too narrow, then given the width of its longest entry.
    await api("api/settings.php", { view: { listColumns: ["title", "platform", "genre", "developer", "seconds"], listWidths: { developer: 30 } } });
    await b.ev(`(async () => { const St = await import("/js/state.js"), V = await import("/js/views.js"); St.S.view.listColumns = ["title", "platform", "genre", "developer", "seconds"]; St.S.view.listWidths = { developer: 30 }; V.render(); return true; })()`);
    await b.settled();
    const cut = `[...document.querySelectorAll("#view .row .c-developer")].filter(c => c.scrollWidth > c.clientWidth).length`;
    const cutWas = await b.ev(cut);
    await headMenu("developer");
    await b.menuItem(/^Fit to its longest entry$/);
    check("Fit to its longest entry widens a column until nothing in it is cut short, kept",
          [cutWas > 0, await b.until(cut, 0, 6000), await apiUntil(async () => ((await kept()).listWidths || {}).developer > 60)], [true, 0, true]);
    await headMenu("developer");
    await b.menuItem(/^Remove this column$/);
    check("Remove this column takes it off the table, kept", [await b.until(heads, ["Title", "System", "Genre", "Time"], 6000), await apiUntil(async () => (await kept()).listColumns.join() === "title,platform,genre,seconds")],
          [["Title", "System", "Genre", "Time"], true]);
    check("and no header menu is left up", await b.ev(`!document.querySelector(".ctx")`), true);
    await api("api/settings.php", { view: { listColumns: USUAL, listWidths: {} } });
    await b.ev(`(async () => { const St = await import("/js/state.js"), V = await import("/js/views.js"); St.S.view.listColumns = ${JSON.stringify(USUAL)}; St.S.view.listWidths = {}; V.render(); return true; })()`);
    await b.settled();

    /* A sort turned round leaves the list where the person had it. The chosen
       game stays chosen and goes where the new order puts it; the list does
       not go after it, which would throw the person far down. */
    const place = `import("/js/state.js").then((St) => [Math.round(document.getElementById("view").scrollTop), St.games[St.sel].id, !!(St.S.view && St.S.view.sortReverse)])`;
    // Something that draws the list again, waited for by the header it makes anew.
    const redrawn = async (act) => {
      await b.ev(`document.querySelector("#view .lhead").dataset.probe = "sortwait"`);
      await act();
      await b.waitFor(`!document.querySelector('#view .lhead[data-probe="sortwait"]')`, 8000);
      await b.settled();
    };
    const down = async (px) => { await b.ev(`document.getElementById("view").scrollTop = ${px}`); await b.settled(); return (await b.ev(place))[0]; };
    await down(0);
    const chosen = (await b.ev(place))[1];
    await redrawn(() => b.clickSel("#view .lhead .c-title .lh-t"));
    check("a sort turned round at the top of the list leaves it at the top, the same game chosen", await b.ev(place), [0, chosen, true]);
    const mid = await down(3000);
    await redrawn(() => b.clickSel("#view .lhead .c-title .lh-t"));
    check("turned round part of the way down, the list stays as far down: it does not go after the chosen game",
          await b.ev(place).then((p) => [mid > 1000, Math.abs(p[0] - mid) <= 2, p[1], p[2]]), [true, true, chosen, false]);
    await headMenu("title");
    await redrawn(() => b.menuItem(/^Z to A$/));
    check("the other way round from the header's menu keeps the place too", await b.ev(place).then((p) => [Math.abs(p[0] - mid) <= 2, p[1], p[2]]), [true, chosen, true]);
    await headMenu("title");
    await b.ev(`document.querySelector("#view .lhead").dataset.probe = "still"`);
    await b.menuItem(/^Z to A$/);
    await sleep(500);                     // nothing is to happen: there is nothing to wait for but the time
    check("and the way the list already runs does nothing: no list drawn again, no way back to the top",
          [await b.ev(`!!document.querySelector('#view .lhead[data-probe="still"]')`), await b.ev(place).then((p) => [Math.abs(p[0] - mid) <= 2, p[2]])], [true, [true, true]]);
    await headMenu("title");
    await redrawn(() => b.menuItem(/^A to Z$/));
    // A row not yet drawn stands in at a drawn row's height at any text size, so the list is as long before its rows are drawn as after.
    check("a row far down the list, not drawn yet, is as tall as a drawn one at a larger text size",
          await b.ev(`(async () => { const V = await import("/js/views.js"), body = document.body, was = body.style.getPropertyValue("--fs"), v = document.getElementById("view");
            body.style.setProperty("--fs", "1.4"); v.scrollTop = 0;
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 150))));
            const tall = (n) => Math.round(n.getBoundingClientRect().height * 10) / 10, out = [tall(V.flatNodes[1]), tall(V.flatNodes[V.flatNodes.length - 1])];
            if (was) { body.style.setProperty("--fs", was); } else { body.style.removeProperty("--fs"); }
            return [out[0] > 44, Math.abs(out[0] - out[1]) <= 0.2]; })()`), [true, true]);
    await b.settled();
  }

  // highlighting: the letters you typed, lit where they landed
  await redraw(b, `(() => { const p = document.getElementById("platform"); p.value = ""; p.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await b.ev(`(() => { const q = document.getElementById("q"); q.value = "mario"; q.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  check("a search lights the letters it matched", await b.waitFor(`document.querySelectorAll("#view .row mark.hit").length > 0`, 8000));
  check("and lights them inside the title, not around it",
        await b.ev(`(m => m ? m.textContent.toLowerCase() : "")(document.querySelector("#view .row mark.hit"))`), "mario");
  // the search reaches the columns the table can now show
  await b.ev(`(() => { const q = document.getElementById("q"); q.value = "konami"; q.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  check("a developer can be searched for, now that it is a column",
        await b.waitFor(`document.querySelectorAll("#view .row").length > 0`, 8000));
  await redraw(b, `(() => { const q = document.getElementById("q"); q.value = ""; q.dispatchEvent(new Event("input", { bubbles: true })); })()`);

  await b.setView("carousel");
  /* Choosing the carousel inside a view starts its journey over, on the
     consoles, so the game cards are the ones a console opens into.
     Waited on, not slept for: on a busy machine the cards take longer to
     stand up, and every fixed sleep is a race (TESTING.md). */
  await b.openPlatform("Nintendo 64");
  check("carousel draws cards", await b.waitFor(`!document.getElementById("main").hidden && document.querySelectorAll(".gcarousel .gcard").length > 0`, 8000));
  // the black bed is the grid's alone: these two stand on the scenery
  check("carousel art keeps its clear bed", await b.ev(`[...document.querySelectorAll("img.gcard-art")].every(n => getComputedStyle(n).backgroundColor === "rgba(0, 0, 0, 0)")`));

  /* The carousel runs sideways, so left and right move it as well as up and
     down: the keys, the pad's cross and a sideways scroll. The pad is a
     stand-in read through navigator.getGamepads, as in t-settings. */
  const carSel = `import("/js/state.js").then((m) => m.sel)`;
  const c0 = await b.ev(carSel);
  await b.key("ArrowRight");
  check("right moves the carousel to the next game", await b.until(carSel, c0 + 1), c0 + 1);
  await b.key("ArrowLeft");
  check("and left back", await b.until(carSel, c0), c0);
  await b.key("ArrowDown");
  check("down still moves it too", await b.until(carSel, c0 + 1), c0 + 1);
  await b.key("ArrowUp");
  await b.until(carSel, c0);
  check("the legend says left and right", await b.ev(`[...document.querySelectorAll("#help .hk")].some(n => n.textContent === "↑↓←→")`), true);
  const carMid = await b.ev(`(() => { const r = document.getElementById("view").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await b.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: carMid.x, y: carMid.y, deltaX: 100, deltaY: 0 });
  check("a sideways scroll turns it", await b.until(carSel, c0 + 1), c0 + 1);
  await b.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: carMid.x, y: carMid.y, deltaX: -100, deltaY: 0 });
  check("and the other way back", await b.until(carSel, c0), c0);
  await b.ev(`window.__padWas = navigator.getGamepads; window.__pad = { id: "stand-in", mapping: "standard", connected: true, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }; navigator.getGamepads = () => [window.__pad]`);
  try {
    await b.ev(`window.__pad.buttons[15].pressed = true`);       // the cross, right
    const padGot = await b.until(carSel, c0 + 1);
    await b.ev(`window.__pad.buttons[15].pressed = false`);
    check("the pad's cross turns it right", padGot, c0 + 1);
    await b.ev(`window.__pad.buttons[14].pressed = true`);       // and left
    const padBack = await b.until(carSel, c0);
    await b.ev(`window.__pad.buttons[14].pressed = false`);
    check("and left back", padBack, c0);
  } finally {
    await b.ev(`navigator.getGamepads = window.__padWas`);
  }

  /* Scrolled fast, the cards must not bunch up or pop out of sight mid slide
     (carouselSpin paces every near card's slide together). A watcher rides
     requestAnimationFrame through 12 quick steps and keeps the worst gap and
     any card gone between frames. Motion is switched on: under the suite's
     reduced motion (lib.js) the cards jump and can never bunch. */
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  let spy;
  try {
    for (let i = 0; i < 6; i++) { await b.key("ArrowDown"); }   // cards on both sides to measure
    await b.settled();
    await b.ev(`(() => { const S = { rest: 0, gap: 9e9, frames: 0, pops: 0, seen: new Map() }; window.__carSpy = S;
      const W = innerWidth;
      const look = () => { const box = document.querySelector(".gcarousel"); if (!box) { return null; }
        return [...box.querySelectorAll(".gcard")].map((n) => { if (n.hidden) { return { n, on: false, gone: true }; }
          const r = n.getBoundingClientRect(), o = parseFloat(getComputedStyle(n).opacity);
          return { n, x: r.left + r.width / 2, on: r.width > 0 && r.right > 0 && r.left < W && o > 0.1, gone: false }; }); };
      const gapOf = (cards) => { const xs = cards.filter((c) => c.on).map((c) => c.x).sort((a, c) => a - c); let g = 9e9;
        for (let i = 1; i < xs.length; i++) { g = Math.min(g, xs[i] - xs[i - 1]); } return g; };
      const first = look(); S.rest = gapOf(first); first.forEach((c) => S.seen.set(c.n, c.on));
      const tick = () => { const cards = look();
        if (cards) { S.frames++; S.gap = Math.min(S.gap, gapOf(cards));
          cards.forEach((c) => { if (c.gone && S.seen.get(c.n)) { S.pops++; } S.seen.set(c.n, c.on); }); }
        if (!S.stop) { requestAnimationFrame(tick); } };
      requestAnimationFrame(tick); })()`);
    for (let i = 0; i < 12; i++) { await b.key("ArrowDown"); await sleep(25); }
    await b.settled();
    spy = await b.ev(`(() => { const S = window.__carSpy; S.stop = true; return { rest: Math.round(S.rest), gap: Math.round(S.gap), frames: S.frames, pops: S.pops }; })()`);
  } finally {
    await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  }
  check("spun fast, the carousel's cards stay at least half their resting gap apart",
        spy.frames > 10 && spy.rest > 100 && spy.gap >= spy.rest / 2 ? true : spy, true);
  check("and no card on screen vanishes mid slide", spy.pops, 0);
  await b.setView("wheel");

  await b.key("Escape");
  check("Esc goes back to the consoles", await b.until(`!document.getElementById("syswall").hidden`, true, 6000));
  await b.settled();

  // Grid or list chosen on the consoles screen opens the whole library in it,
  // rather than refusing until a console is picked.
  await b.setView("grid");
  await b.waitFor(`document.querySelectorAll("#view .tile").length > 0 && /^(\\d+) of \\1$/.test(document.getElementById("count").textContent.trim())`, 8000);
  await b.settled();
  check("grid on the wall opens every platform", await b.ev(`(() => ({ wall: document.getElementById("syswall").hidden, platform: document.getElementById("platform").value, view: document.getElementById("view").className.split(" ")[0] }))()`),
        { wall: true, platform: "", view: "grid" });
  // "N of N": nothing filtered out.
  check("and shows the whole library", await b.ev(`document.getElementById("count").textContent`).then((t) => { const m = /^(\d+) of (\d+)$/.exec(t.trim()); return !!m && m[1] === m[2] && Number(m[1]) > 100; }));
  check("no strip telling you to pick a system first", await b.ev(`document.getElementById("strip").hidden || !/pick a system/.test(document.getElementById("strip").textContent)`));
  check("the back arrow is there to go back", await b.ev(`!document.getElementById("btn-systems").hidden`));
  await b.key("Escape");
  check("Esc from there goes back to the consoles", await b.until(`!document.getElementById("syswall").hidden`, true, 6000));
  await b.settled();
  await b.setView("wheel");

  /* The wheel style of the consoles screen stands on the same measured middle
     as the gallery, not a fixed guess at its height, which a strip coming
     and going above it would move. Checked bare, then with a strip put up
     the way the startup news check puts up its warning. */
  const WHEEL = `(() => {
    const wall = document.getElementById("syswall");
    if (wall.hidden || !wall.classList.contains("sw-wheel")) { return { no: "no wheel" }; }
    let above = 0;
    ["header.top", ".status", "#guardrail", "#toolbar"].forEach((s) => {
      const n = document.querySelector(s);
      if (n && n.offsetHeight) { above = Math.max(above, n.getBoundingClientRect().bottom); }
    });
    const helpTop = document.getElementById("help").getBoundingClientRect().top;
    const mid = (above + helpTop) / 2;
    const sel = wall.querySelector(".switem.sel"), info = wall.querySelector(".sysinfo");
    const r = sel.getBoundingClientRect(), ir = info ? info.getBoundingClientRect() : null;
    return { rim: Math.round(r.top + r.height / 2 - mid),
             info: ir ? Math.round(ir.top + ir.height / 2 - mid) : 0,
             past: Math.round(wall.getBoundingClientRect().bottom - helpTop) };
  })()`;
  const bare = await b.ev(WHEEL);
  check("wheel: the chosen console rides the middle", Math.abs(bare.rim) <= 2, true);
  // The block under it is the picture, the name and the count; a two-line name reaches a little lower.
  check("wheel: the console presented stands on it too", Math.abs(bare.info) <= 16, true);
  check("wheel: the wall stops at the legend", bare.past <= 1, true);
  await b.ev(`(() => { const d = document.createElement("div"); d.id = "xs-test-strip"; d.style.height = "72px"; document.getElementById("guardrail").appendChild(d); })()`);
  await b.settled();
  const strip = await b.ev(WHEEL);
  await b.ev(`document.getElementById("xs-test-strip").remove()`);
  check("wheel: a strip above moves the middle with it", Math.abs(strip.rim) <= 2, true);
  check("wheel: and the wall still stops at the legend", strip.past <= 1, true);
  await b.settled();

  /* A fast run through the games cut short by Esc, then a console again: the
     info panel's words come back. A settle timer shared with the consoles
     screen would cancel the panel's last paint and leave it .holding. Six
     notches then Esc lands inside the 190ms the words wait. */
  await b.openPlatform("Nintendo 64");
  for (let i = 0; i < 6; i++) { await b.key("ArrowDown"); }
  await b.key("Escape");
  await b.waitFor(`!document.getElementById("syswall").hidden`, 5000);
  await b.settled();
  await b.enterConsole();
  check("a fast run cut short by Esc leaves the info panel's words showing",
        await b.until(`(h => !!h && !h.hidden && !h.classList.contains("holding"))(document.getElementById("hero"))`, true, 2000), true);
  await b.key("Escape");
  await b.waitFor(`!document.getElementById("syswall").hidden`, 5000);
  await b.settled();

  /* A game with several versions on one console is one card: a stack and a
     count on its art, a box saying what is in it on pointing, and Play asks
     which; Esc starts nothing. Found on whatever this copy holds. */
  const multiCard = ((await api("api/library.php")).games || []).find((g) => (g.versions || []).length > 1);
  if (multiCard) {
    await b.setView("grid");
    await b.waitFor(`document.querySelectorAll("#view .tile").length > 0`, 8000);
    await redraw(b, `(() => { const q = document.getElementById("q"); q.value = ${JSON.stringify(multiCard.title)}; q.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    const tileAt = `[...document.querySelectorAll("#view .tile")].findIndex(t => !!t.querySelector(".vbadge"))`;
    check("a card with several versions wears the stack", await b.ev(tileAt) >= 0);
    check("with how many", await b.ev(`(document.querySelector("#view .tile .vbadge .vb-n") || {}).textContent`), String(multiCard.versions.length));
    await b.ev(`document.querySelector("#view .tile .vbadge").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))`);
    check("pointing at it says what is inside", await b.ev(`(t => !!t && !t.hidden && /Contains [0-9]+ versions/.test(t.textContent) && /Play asks which one/.test(t.textContent))(document.querySelector(".vtip"))`));
    await b.ev(`document.querySelector("#view .tile .vbadge").dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }))`);
    for (let i = await b.ev(tileAt); i > 0; i--) { await b.key("ArrowRight"); }
    await b.settled();
    /* Enter only on the proven card: the selection may not start at tile 0.
       lib.js's fuse makes every test press dry, but a test that presses
       Play blind is still wrong. */
    const onCard = await b.ev(`!!document.querySelector("#view .tile.sel .vbadge")`);
    check("the walk stands on the stacked card before pressing Play", onCard);
    if (onCard) {
      await b.key("Enter");
      check("Play asks which version", await b.until(`/which version/.test((document.querySelector(".ctx .ctx-title") || {}).textContent || "")`, true, 3000), true);
      check("offering each of them", await b.ev(`document.querySelectorAll(".ctx .ctx-item").length`), multiCard.versions.length);
      await b.key("Escape");
      check("and Esc starts nothing", await b.until(`!document.querySelector(".ctx") && !/starting/.test(document.getElementById("strip").textContent)`, true, 2000), true);
    }
    await redraw(b, `(() => { const q = document.getElementById("q"); q.value = ""; q.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await b.key("Escape");
    await b.waitFor(`!document.getElementById("syswall").hidden`, 5000);
    await b.setView("wheel");
    await b.settled();
  } else {
    console.log("    (no game here has two versions on one console; the stack checks step aside)");
  }

  // the gallery style of the consoles screen
  await b.ev(`fetch("api/settings.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ view: { systemsStyle: "carousel" } }) })`);
  await b.goto(undefined, { keepView: true });      // the carousel style was just set on purpose
  check("gallery style draws cards", await b.ev(`document.querySelectorAll("#syswall .syscard").length`) > 10);
  check("gallery: no panel behind the console", await b.ev(`getComputedStyle(document.querySelector("#syswall .syscard")).backgroundColor`) === "rgba(0, 0, 0, 0)");
  /* A console with a name logo and no console picture shows the logo, as
     the wheel does, rather than a game's box. The console is found by asking
     the server which ones answer that way; if every console has a picture,
     the check steps aside and says so. */
  const logoOnly = await b.ev(`(async () => {
    for (const c of document.querySelectorAll("#syswall .syscard:not(.coll)")) {
      const name = c.querySelector(".sysname").textContent;
      const u = (k) => "api/image.php?platform=" + encodeURIComponent(name) + (k ? "&kind=" + k : "");
      if (!(await fetch(u("device"))).ok && !(await fetch(u(""))).ok && (await fetch(u("clearlogo"))).ok) { return name; }
    }
    return null;
  })()`);
  if (logoOnly) {
    const card = `[...document.querySelectorAll("#syswall .syscard")].find(c => c.querySelector(".sysname").textContent === ${JSON.stringify(logoOnly)})`;
    // Cards far from the chosen one do not load their pictures, so turn to it.
    const steps = await b.ev(`(() => { const all = [...document.querySelectorAll("#syswall .syscard")]; return all.indexOf(${card}) - all.findIndex(x => x.classList.contains("sel")); })()`);
    for (let i = 0; i < Math.abs(steps); i++) { await b.key(steps > 0 ? "ArrowRight" : "ArrowLeft"); }
    await b.until(`${card}.classList.contains("sel")`, true, 3000);
    check("gallery: a console with only a logo (" + logoOnly + ") shows the logo, not a game's box", await b.until(`(i => !!i && /kind=clearlogo/.test(i.src) && i.complete && i.naturalWidth > 0)(${card}.querySelector("img.sysbanner"))`, true, 6000), true);
  } else {
    console.log("    (every console has a picture of its own; the logo-only gallery check steps aside)");
  }

  /* The band and the cards sit halfway between the lowest bar above and the
     button legend below, whether or not the ROM warning is up: measured, not
     a fixed guess at the chrome's height. Two pixels of slack for rounding. */
  const BAND = `(() => {
    const wall = document.getElementById("syswall"), view = document.getElementById("view");
    const host = (wall && !wall.hidden && !wall.classList.contains("sw-wheel")) ? wall
               : (view && view.classList.contains("gcarousel")) ? view : null;
    if (!host) { return { no: "no stage" }; }
    const cs = getComputedStyle(host, "::before"), hb = host.getBoundingClientRect();
    const top = hb.top + parseFloat(cs.top) + parseFloat(cs.marginTop || 0), h = parseFloat(cs.height);
    let above = 0;
    ["header.top", ".status", "#guardrail", "#toolbar"].forEach((s) => {
      const n = document.querySelector(s);
      if (n && n.offsetHeight) { above = Math.max(above, n.getBoundingClientRect().bottom); }
    });
    const helpTop = document.getElementById("help").getBoundingClientRect().top;
    const card = host.querySelector(".syscard.sel, .gcard.sel");   // inside THIS stage: the hidden wall keeps a .sel too
    return { off: Math.round(top + h / 2 - (above + helpTop) / 2), lines: Math.round(h),
             cardOff: card ? Math.round(card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2 - (top + h / 2)) : 0,
             full: Math.round(parseFloat(cs.width)) >= Math.round(document.documentElement.clientWidth),
             scrolls: document.documentElement.scrollHeight > innerHeight + 1 };
  })()`;
  const gal = await b.ev(BAND);
  check("gallery band is centred between the bars", Math.abs(gal.off) <= 2, true);
  check("gallery cards ride the same middle", Math.abs(gal.cardOff) <= 2, true);
  check("gallery band spans the window", gal.full && !gal.scrolls);

  await b.setView("carousel");
  await b.openPlatform("Nintendo 64");
  const car = await b.ev(BAND);
  check("carousel band is centred between the bars", Math.abs(car.off) <= 2, true);
  check("carousel cards ride the same middle", Math.abs(car.cardOff) <= 2, true);
  check("carousel page does not scroll", !car.scrolls);

  await b.ev(`fetch("api/settings.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ view: { systemsStyle: "wheel" } }) })`);

  /* An empty Recently added stands greyed on the rim wearing its reason, and
     refuses to open with the reason on the strip. Only checkable while it is
     empty; otherwise these step aside (the api group covers both sides). */
  const cols = (await api("api/library.php")).collections || [];
  const added = cols.find((c) => c.key === "@added");
  if (added && added.count === 0) {
    await b.goto();
    if (await b.ev(`!document.getElementById("syswall").hidden`)) {
      /* Walk to it by name: a position on the rim moves when a collection is
         added. Position is not identity. */
      const where = await b.ev(`(() => {
        const all = [...document.querySelectorAll("#syswall .switem, #syswall .syscard")];
        const names = all.map(x => ((x.querySelector("img") || {}).alt || "") + "|" + x.textContent);
        return { at: all.findIndex(x => x.classList.contains("sel")), want: names.findIndex(t => /Recently added/.test(t)) };
      })()`);
      check("Recently added is on the rim to be found", where.want >= 0);
      const steps = where.want - where.at;
      for (let i = 0; i < Math.abs(steps); i++) { await b.key(steps > 0 ? "ArrowRight" : "ArrowLeft"); }
      check("an empty Recently added stands greyed on the rim", await b.until(`!!document.querySelector(".switem.sel.off, .syscard.sel.off")`));
      await b.settled();
      check("wearing its reason", await b.ev(`(document.querySelector(".sysinfo .syscount, .syscard.sel .syscount") || {}).textContent || ""`).then((t) => /30 days/.test(t)));
      await b.key("Enter");
      check("Enter stays on the wall and explains", await b.until(`!document.getElementById("syswall").hidden && /30 days/.test(document.getElementById("strip").textContent)`));
      check("and the dropdown lists it unchoosable", await b.ev(`(o => !!o && o.disabled)([...document.getElementById("platform").options].find(o => o.value === "@added"))`));
    }
  } else {
    console.log("    (Recently added is not empty right now; the greyed-rim checks step aside)");
  }

  /* Two players or more: on the rim like any collection, and opening it
     really does filter. The count to expect is asked of the API, not carried
     as a number that goes stale. */
  const couch = cols.find((c) => c.key === "@players");
  if (couch && couch.count > 0) {
    await b.goto();
    check("Two players or more rides the rim", await b.ev(`[...document.querySelectorAll("#syswall .coll")].some(n => /Two players/.test(((n.querySelector("img") || {}).alt || "") + n.textContent))`));
    await b.openPlatform("Two players or more");
    check("and opens like a console", await b.ev(`document.getElementById("platform").value`), "@players");
    // The strip reads "<shown> of <the whole library>", so the collection's
    // size is the first number; the second stays the same whatever is filtered.
    check("holding what the server counted", await b.ev(`document.getElementById("count").textContent`).then((t) => {
      const m = /^(\d+) of (\d+)$/.exec(t.trim());
      return !!m && Number(m[1]) === couch.count && Number(m[2]) > couch.count;
    }));
  }

  /* Recently added looks as far back as its dropdown says, and the dropdown
     is up only inside it. Only checkable while something arrived this month. */
  if (added && added.count > 0) {
    await b.goto();
    const ofAdded = async (k) => ((await api("api/library.php?added=" + k)).collections.find((c) => c.key === "@added") || {}).count;
    const shownNow = `parseInt(document.getElementById("count").textContent, 10)`;
    try {
      await b.openPlatform("Two players or more");
      check("outside Recently added the bar offers no stretch", await b.ev(`document.getElementById("added").hidden`));
      await b.openPlatform("Recently added");
      check("inside it the bar offers how far back it looks", await b.until(`!document.getElementById("added").hidden && document.getElementById("added").value`, "month"), "month");
      check("its choices run from Today to Past year, Past 3 days among them",
            await b.ev(`[...document.getElementById("added").options].map(o => o.text)`), ["Today", "Past 3 days", "Past week", "Past 2 weeks", "Past month", "Past year"]);
      check("holding the month", await b.until(shownNow, added.count), added.count);
      const today = await ofAdded("today");
      await b.ev(`(s => { s.value = "today"; s.dispatchEvent(new Event("change")); })(document.getElementById("added"))`);
      check("choosing Today shows only today's", await b.until(shownNow, today), today);
      check("and the choice is kept", await apiUntil(async () => (await api("api/library.php")).addedSince === (await api("api/library.php?added=today")).addedSince));
      check("the dropdown stays up when that empties the list", await b.ev(`!document.getElementById("added").hidden`));
      /* On the consoles screen the collection's own menu offers the same
         choices: the only way to an empty one, which cannot be opened. */
      await b.key("Escape");
      await b.waitFor(`!document.getElementById("syswall").hidden && document.querySelectorAll("#syswall .sel").length > 0`, 5000);
      await b.settled();
      await b.ev(`document.querySelector("#syswall .sel").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }))`);
      check("its menu on the consoles screen marks the stretch chosen",
            await b.until(`[...document.querySelectorAll(".ctx-item.on .ctx-label")].map(n => n.textContent).filter(t => /^Added/.test(t))`, ["Added today"]), ["Added today"]);
      check("and offers the past 3 days there too", await b.ev(`[...document.querySelectorAll(".ctx-item .ctx-label")].some(n => n.textContent === "Added in the past 3 days")`));
      await b.menuItem(/^Added in the past month$/);
      check("and choosing there counts the rim again", await b.until(`(document.querySelector(".sysinfo .syscount, .syscard.sel .syscount") || {}).textContent || ""`, added.count + " games"), added.count + " games");
    } finally {
      await api("api/settings.php", { view: { addedPeriod: "month" } });
    }
  }

  /* Recently changed: the same dropdown, holding its own stretch. The run
     writes its own record (data\changed.json, includes\changed.php) so there
     is something in it, and puts the copy's back. */
  {
    const chF = path.join(DATA, "changed.json");
    const chWas = fs.existsSync(chF) ? fs.readFileSync(chF) : null;
    const two = (await api("api/library.php")).games.filter((x) => !x.versions).slice(0, 2);
    const tenAgo = new Date();
    tenAgo.setDate(tenAgo.getDate() - 10);
    fs.writeFileSync(chF, JSON.stringify({ [two[0].id]: { at: new Date().toLocaleDateString("sv") + " 00:00:00", what: "video" },
                                           [two[1].id]: { at: tenAgo.toLocaleDateString("sv") + " 00:00:00", what: "box" } }));
    const shown = `parseInt(document.getElementById("count").textContent, 10)`;
    try {
      await b.goto();
      await b.openPlatform("Recently changed");
      check("inside Recently changed the bar offers its own stretch: the week",
            await b.until(`(s => !s.hidden && [s.value, s.title])(document.getElementById("added"))`, ["week", "How far back Recently changed looks"]),
            ["week", "How far back Recently changed looks"]);
      check("holding what changed this week", await b.until(shown, 1), 1);
      await b.ev(`(s => { s.value = "twoweeks"; s.dispatchEvent(new Event("change")); })(document.getElementById("added"))`);
      check("the past 2 weeks shows what changed ten days ago too", await b.until(shown, 2), 2);
      check("and the choice is kept as its own, Recently added's as it was",
            await apiUntil(async () => { const v = (await api("api/settings.php")).settings.view; return v.changedPeriod === "twoweeks" && v.addedPeriod === "month"; }));
      await b.key("Escape");
      await b.waitFor(`!document.getElementById("syswall").hidden && document.querySelectorAll("#syswall .sel").length > 0`, 5000);
      await b.settled();
      await b.ev(`document.querySelector("#syswall .sel").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }))`);
      check("its menu on the consoles screen marks its own stretch",
            await b.until(`[...document.querySelectorAll(".ctx-item.on .ctx-label")].map(n => n.textContent).filter(t => /^Changed/.test(t))`, ["Changed in the past 2 weeks"]),
            ["Changed in the past 2 weeks"]);
      await b.menuItem(/^Changed in the past week$/);
      check("and choosing there counts the rim again", await b.until(`(document.querySelector(".sysinfo .syscount, .syscard.sel .syscount") || {}).textContent || ""`, "1 game"), "1 game");
    } finally {
      await api("api/settings.php", { view: { changedPeriod: "week" } });
      if (chWas) { fs.writeFileSync(chF, chWas); } else { fs.rmSync(chF, { force: true }); }
    }
  }

  /* ---- the dropdown names what is on screen -----------------------------
     With Game view on List and Systems first on, the dropdown must not say
     List over the consoles wheel: List and Grid open on every game, and on
     the consoles screen the dropdown names that screen's shape. view.* is in
     the Guard; this puts the wheel back at the end too. */
  const shown = `({ dropdown: document.getElementById("viewsel").value,
    wall: !document.getElementById("syswall").hidden,
    list: document.getElementById("view").classList.contains("list") && !document.getElementById("main").hidden,
    rows: document.querySelectorAll("#view .row").length,
    platform: document.getElementById("platform").value })`;
  const total = (await api("api/library.php")).games.length;     // the rows a list of everything draws
  try {
    await api("api/settings.php", { view: { default: "list", systemsFirst: true, systemsStyle: "carousel" } });
    const page = await (await fetch(BASE + "/")).text();
    check("the page is sent with List chosen, because List is what opens",
          (page.match(/<option value="([a-z]+)" selected>/) || [])[1], "list");
    check("and the dropdown cannot be restored to a stale view by the browser",
          /<select id="viewsel"[^>]*autocomplete="off"/.test(page));
    await b.goto(undefined, { keepView: true });
    const s1 = await b.ev(shown);
    check("List with Systems first opens on the list, not the consoles", !s1.wall && s1.list, true);
    check("of every game", s1.platform === "" && s1.rows === total, true);
    check("under a dropdown that says List", s1.dropdown, "list");
    check("with the consoles one press away", await b.ev(`!document.getElementById("btn-systems").hidden`));

    await b.key("Escape");
    await b.waitFor(`!document.getElementById("syswall").hidden`, 5000);
    const s2 = await b.ev(shown);
    check("Esc goes to the consoles", s2.wall, true);
    // The list of consoles must be built on this road too, which never went in.
    check("with every console on it, though it was never entered",
          await b.ev(`document.querySelectorAll("#syswall .syscard").length`), (await api("api/library.php")).collections.length + Object.keys((await api("api/library.php")).platforms).length);
    check("and the dropdown names the consoles' shape, not the list", s2.dropdown, "carousel");
    check("while the legend says what a console opens into",
          await b.ev(`[...document.querySelectorAll("#help .hl")].map(x => x.textContent).join("|")`).then((t) => /open in list/.test(t)));
    // A panel closed over the consoles leaves the consoles' legend behind,
    // not the browsing keys ("Enter play").
    await b.clickSel("#btn-settings");
    await b.waitFor(`!document.getElementById("settings").hidden`, 5000);
    for (let i = 0; i < 3 && !(await b.ev(`document.getElementById("settings").hidden`)); i++) { await b.key("Escape"); await sleep(200); }
    check("closing Settings over the consoles keeps the consoles' legend",
          await b.ev(`[...document.querySelectorAll("#help .hl")].map(x => x.textContent).join("|")`).then((t) => /open in list/.test(t) && !/\bplay\b/.test(t)));

    await b.openPlatform("Nintendo 64");
    const s3 = await b.ev(shown);
    check("a console opens in the list", !s3.wall && s3.list && s3.platform, "Nintendo 64");
    check("and the dropdown says List again", s3.dropdown, "list");

    /* What stands on screen in the instant after a switch, before the new
       rows come back, read in the same breath as the change: the old list
       must not be uncovered for the length of the request. */
    const flip = (v) => b.ev(`(() => { const s = document.getElementById("viewsel"); s.value = ${JSON.stringify(v)};
      s.dispatchEvent(new Event("change", { bubbles: true })); const w = document.getElementById("view");
      return { rows: w.querySelectorAll(".row").length, tiles: w.querySelectorAll(".tile").length, pending: w.classList.contains("pending") }; })()`);
    await b.key("Escape");
    await b.waitFor(`!document.getElementById("syswall").hidden`, 5000);
    const f1 = await flip("grid");
    check("choosing Grid on the consoles never uncovers the list drawn before", f1.rows, 0);
    check("it says loading until the grid arrives", f1.pending, true);
    check("and then the grid is there", await b.waitFor(`document.querySelectorAll("#view .tile").length > 0 && !document.getElementById("view").classList.contains("pending")`, 8000));
    const headers0 = !!(await api("api/settings.php")).settings.view.groupHeaders;
    await api("api/settings.php", { view: { groupHeaders: true } });
    try {
      await b.goto(undefined, { keepView: true });     // Grid is the saved view now: it opens on every game
      await b.waitFor(`document.querySelectorAll("#view .tile").length > 0`, 8000);
      const f2 = await flip("list");
      check("with headers on, a switch inside draws the new view at once", f2.rows > 0 && f2.tiles, 0);
      await b.waitFor(`document.querySelectorAll("#view .ghead").length > 0`, 8000);
    } finally {
      await api("api/settings.php", { view: { groupHeaders: headers0 } });
    }

    // The two shapes the consoles screen does have still open on it.
    await api("api/settings.php", { view: { default: "carousel", systemsFirst: true, systemsStyle: "carousel" } });
    const page2 = await (await fetch(BASE + "/")).text();
    check("Carousel is sent chosen when the consoles open as a carousel",
          (page2.match(/<option value="([a-z]+)" selected>/) || [])[1], "carousel");
    await b.goto(undefined, { keepView: true });
    const s4 = await b.ev(shown);
    check("Carousel with Systems first still opens on the consoles", s4.wall && s4.dropdown, "carousel");
    check("where Enter opens a console as it is shown",
          await b.ev(`[...document.querySelectorAll("#help .hl")].map(x => x.textContent).join("|")`).then((t) => /open system/.test(t) && !/open in/.test(t)));

    // Grid follows List's rule, and Systems first off shows every game in any view.
    await api("api/settings.php", { view: { default: "grid", systemsFirst: true } });
    await b.goto(undefined, { keepView: true });
    const s5 = await b.ev(`({ dropdown: document.getElementById("viewsel").value, wall: !document.getElementById("syswall").hidden, grid: document.getElementById("view").classList.contains("grid") })`);
    check("Grid opens on the grid, and says so", !s5.wall && s5.grid && s5.dropdown, "grid");
    await api("api/settings.php", { view: { default: "wheel", systemsFirst: false } });
    await b.goto(undefined, { keepView: true });
    const s6 = await b.ev(`({ dropdown: document.getElementById("viewsel").value, wall: !document.getElementById("syswall").hidden, wheel: document.getElementById("view").classList.contains("wheelbox") })`);
    check("with Systems first off a wheel opens on the games' wheel, and says so", !s6.wall && s6.wheel && s6.dropdown, "wheel");
  } finally {
    await api("api/settings.php", { view: { default: "wheel", systemsFirst: true, systemsStyle: "wheel" } });
  }

  /* ---- details never outlives a view change ------------------------------
     The view dropdown stays live while details is open: details, then
     Carousel, then Wheel must not leave details over the consoles wheel. */
  await b.goto();
  await b.setView("wheel");
  await b.openPlatform("Nintendo 64");
  await b.key(" ");
  check("details is up", await b.until(`!document.getElementById("details").hidden`), true);
  await b.setView("carousel");
  check("choosing another view from the dropdown puts details away", await b.until(`document.getElementById("details").hidden`), true);
  await b.setView("wheel");
  check("and the consoles come up clean, with no details over them",
    await b.until(`!document.getElementById("syswall").hidden && document.getElementById("details").hidden`), true);

  /* ---- the game under the mouse in the wheel ----
     A cyan border on the game a click would open, only while the mouse is
     in use: gone once the pointer hides, so a pad player never sees it. */
  await b.openPlatform("Nintendo 64");
  await b.settled();
  const other = await b.ev(`(n => { if (!n) return null; const r = n.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })([...document.querySelectorAll("#view .witem:not(.sel)")].find(n => !n.hidden && n.getBoundingClientRect().height > 20))`);
  const cyan = await b.ev(`getComputedStyle(document.body).getPropertyValue("--cyan").trim()`);
  const borderAt = `(n => n ? getComputedStyle(n).borderTopColor : "")(document.elementFromPoint(${other ? other.x : 0}, ${other ? other.y : 0}).closest(".witem"))`;
  const restColour = await b.ev(borderAt);
  /* What the page asks to play as the pointer arrives is kept: the Hover sound (js\sound.js).
     The snap's mute button, tried earlier, can leave Xsegon muted in this browser, so m brings the
     sound back for this check and takes it away again after. */
  const wasMuted = await b.ev(`localStorage.getItem("xs-muted") === "1"`);
  const pressM = async () => { await b.key("m"); await b.until(`document.getElementById("vol-pop").hidden`, true, 5000); };
  if (wasMuted) { await pressM(); }
  const heard = await b.ev(`(s => s.sounds !== false && s.hoverSound !== false && s.volume > 0 && localStorage.getItem("xs-muted") !== "1")(window.XSEGON.settings.sound)`);
  // No limit on it for this check: the limit is the person's own, and a low one makes a sound wait its turn.
  const rate0 = await b.ev(`(s => { const was = s.hoverRate; s.hoverRate = 30; return was; })(window.XSEGON.settings.sound)`);
  await b.ev(`(() => { window.__asked = []; const p = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.__play = p;
    HTMLMediaElement.prototype.play = function () { window.__asked.push(this.src); return p.call(this); }; })()`);
  await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: other.x, y: other.y, button: "none", buttons: 0 });
  await b.settled(400);
  const hotColour = await b.ev(borderAt);
  check("the wheel game under the mouse gets a cyan border", [hotColour !== restColour, await b.ev(`(c => { const d = document.createElement("div"); d.style.color = c; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; })(${JSON.stringify(cyan)})`) === hotColour], [true, true]);
  if (heard) {
    check("and is heard: the pointer coming onto it asks for the Hover sound, once",
      await b.ev(`window.__asked.filter(u => /api\\/sound\\.php\\?name=hover&set=/.test(u)).length`), 1);
  } else {
    console.log("    (Xsegon's sounds are off or silent in these settings; the sound under the pointer steps aside: " +
      await b.ev(`(s => "sounds " + s.sounds + ", under the pointer " + s.hoverSound + ", volume " + s.volume + ", muted " + localStorage.getItem("xs-muted"))(window.XSEGON.settings.sound)`) + ")");
  }
  await b.ev(`HTMLMediaElement.prototype.play = HTMLMediaElement.prototype.__play; window.XSEGON.settings.sound.hoverRate = ${JSON.stringify(rate0)}`);
  if (wasMuted) { await pressM(); }
  await b.ev(`document.body.classList.add("no-cursor")`);
  await b.settled(400);
  check("and loses it once the pointer hides", await b.ev(borderAt), restColour);
  await b.ev(`document.body.classList.remove("no-cursor")`);
  await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2, button: "none", buttons: 0 });

  /* ---- the scroll wheel on the game wheel ----
     Speed, Momentum and Acceleration shape it, from a gear in the wheel's
     corner or Settings. A slow scroll stays exact; a flick glides unless
     Momentum is 0; with Acceleration a hard spin counts each notch for more.
     The notches are fired in the page, 16ms apart like a real flick. */
  const wheelAt = `[...document.querySelectorAll("#view .witem")].findIndex(n => n.classList.contains("sel"))`;
  const notches = (n, gap) => b.ev(`new Promise(done => { const v = document.getElementById("view"); let i = 0;
    const f = () => { v.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true })); if (++i < ${n}) { setTimeout(f, ${gap}); } else { done(); } }; f(); })`);
  const slider = (k, v) => b.ev(`(() => { document.getElementById("wgear").click(); const i = document.querySelectorAll("#wpop input")[${k}];
    i.value = ${v}; i.dispatchEvent(new Event("input", { bubbles: true })); document.getElementById("wgear").click(); })()`);
  const momentum = (m) => slider(1, m), accel = (a) => slider(2, a);
  // Every game, for room to glide: the dropdown set the way the sidebar sets it.
  await b.ev(`(s => { s.value = ""; s.dispatchEvent(new Event("change", { bubbles: true })); })(document.getElementById("platform"))`);
  await b.waitFor(`(m => !!m && m[1] === m[2])(document.getElementById("count").textContent.match(/^(\\d+) of (\\d+)/)) && document.querySelectorAll("#view .witem").length > 40`, 8000);
  await b.settled();
  check("the game wheel has a gear in its top left corner", await b.ev(`(g => { if (!g || !g.offsetParent) return false; const r = g.getBoundingClientRect(), v = document.getElementById("view").getBoundingClientRect(); return r.left - v.left >= 0 && r.left - v.left < 40 && r.top - v.top < 30 && r.right < v.left + v.width / 2; })(document.getElementById("wgear"))`));
  await b.ev(`document.getElementById("wgear").click()`);
  check("it opens a small window with Speed, Momentum and Acceleration", await b.ev(`(p => !!p && !p.hidden && p.querySelectorAll("input[type=range]").length === 3 && p.getBoundingClientRect().width <= 320)(document.getElementById("wpop"))`));
  await b.key("Escape");
  check("Esc closes the window and nothing else", await b.ev(`document.getElementById("wpop").hidden && document.getElementById("view").classList.contains("wheelbox")`));
  await momentum(0); await accel(0);         // Momentum alone first; Acceleration below
  await sleep(1600);                         // past the stale time, so no pace carries over
  let wFrom = await b.ev(wheelAt);
  await notches(4, 300); await sleep(500);
  check("slow notches turn one game each", (await b.ev(wheelAt)) - wFrom, 4);
  wFrom = await b.ev(wheelAt);
  await notches(6, 16); await sleep(1000);
  check("at Momentum 0 a flick stops with its last notch", (await b.ev(wheelAt)) - wFrom, 6);
  await momentum(6);
  wFrom = await b.ev(wheelAt);
  await notches(6, 16); await sleep(1800);
  check("with Momentum a flick glides on after its last notch", (await b.ev(wheelAt)) - wFrom > 8);
  check("and what the window set is saved", await apiUntil(async () => (await api("api/settings.php")).settings.controller.wheelGlide === 6));
  // Acceleration: at 16ms apart, 8 notches count 1, 1, then more and more,
  // about 23 games; 300ms apart, one each.
  await momentum(0); await accel(6);
  await sleep(1600);
  wFrom = await b.ev(wheelAt);
  await notches(4, 300); await sleep(500);
  check("with Acceleration, slow notches still turn one game each", (await b.ev(wheelAt)) - wFrom, 4);
  wFrom = await b.ev(wheelAt);
  await notches(8, 16); await sleep(1000);
  check("and a hard spin counts each notch for more (8 notches, over 16 games)", (await b.ev(wheelAt)) - wFrom > 16);
  check("and the Acceleration the window set is saved", await apiUntil(async () => (await api("api/settings.php")).settings.controller.wheelAccel === 6));
  await api("api/settings.php", { controller: { wheelGlide: 4, wheelAccel: 5 } });   // the defaults again, for what follows

  /* ---- 1P / 2P on the games (view.showPlayers) ----
     Off for everyone new; on, the wheel shows it in each plate's top right
     and the carousel under the chosen game's title. */
  const plVisible = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].filter(n => getComputedStyle(n).display !== "none").map(n => n.textContent)`;
  // The copy carries the person's own choice, so say "off" first, then look.
  check("1P / 2P is off unless asked for", (await api("api/settings.php")).defaults.view.showPlayers, false);
  await api("api/settings.php", { view: { showPlayers: false } });
  await b.goto(undefined, { keepView: true });
  await b.openPlatform("Nintendo 64");
  await b.settled();
  check("and off, no game shows it", (await b.ev(plVisible("#view .witem-pl"))).length, 0);
  await api("api/settings.php", { view: { showPlayers: true } });
  await b.goto(undefined, { keepView: true });
  await b.openPlatform("Nintendo 64");
  await b.settled();
  const selPl = await b.ev(`(n => n ? { t: n.getAttribute("aria-label"), shown: getComputedStyle(n).display !== "none", top: n.getBoundingClientRect().top - n.parentNode.getBoundingClientRect().top, right: n.parentNode.getBoundingClientRect().right - n.getBoundingClientRect().right } : null)(document.querySelector("#view .witem.sel .witem-pl"))`);
  const selPlayers = await b.ev(`(async () => { const St = await import("/js/state.js"); return St.games[St.sel].players || 0; })()`);
  if (selPlayers > 0) {
    check("on, the chosen wheel game shows how many can play", selPl && [selPl.t, selPl.shown], [selPlayers === 1 ? "1 player" : selPlayers + " players", true]);
    check("in the plate's top right", !!selPl && selPl.top < 12 && selPl.right < 40, true);
  }
  /* Figures, not "1P" / "2P", on the wheel (for any language):
     one red figure alone, two green side by side, a digit from three up. */
  const marks = await b.ev(`[...document.querySelectorAll("#view .witem-pl")].filter(n => getComputedStyle(n).display !== "none").map(n => ({
      label: n.getAttribute("aria-label"), figures: n.querySelectorAll("svg circle").length, digit: (n.querySelector(".pl-n") || {}).textContent || "",
      colour: getComputedStyle(n.querySelector("svg")).fill, text: [...n.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join("") }))`);
  check("every mark is a drawing with its words in the label, no text", marks.length > 0 && marks.every((m) => /^\d+ players?$/.test(m.label) && m.text === ""), true);
  check("one player: one red figure", marks.filter((m) => m.label === "1 player").every((m) => m.figures === 1 && m.colour === "rgb(248, 113, 113)"), true);
  check("two or more: two green figures side by side", marks.filter((m) => m.label !== "1 player").every((m) => m.figures === 2 && m.colour === "rgb(52, 211, 153)"), true);
  check("and a digit from three players up", marks.every((m) => { const n = parseInt(m.label, 10); return n > 2 ? m.digit === String(n) : m.digit === ""; }), true);
  check("a game nobody gave a count shows none", await b.ev(`(async () => { const St = await import("/js/state.js"); const v = await import("/js/views.js"); return St.games.every((g, i) => !!(v.wheelNodes[i] && v.wheelNodes[i].querySelector(".witem-pl")) === (Number(g.players) > 0)); })()`), true);
  await b.setView("carousel");
  await b.openPlatform("Nintendo 64");
  await b.settled();
  const carPl = await b.ev(`(async () => { const St = await import("/js/state.js"); return St.games[St.sel].players || 0; })()`);
  if (carPl > 0) {
    const carWords = carPl === 1 ? "1 player" : carPl + " players";
    check("the carousel shows it under the chosen game's title, as figures", await b.until(`(n => n && getComputedStyle(n).display !== "none" ? n.getAttribute("aria-label") + ":" + n.querySelectorAll("svg circle").length : "")(document.querySelector("#view .gcard.sel .gcard-pl"))`, carWords + ":" + (carPl === 1 ? 1 : 2)), carWords + ":" + (carPl === 1 ? 1 : 2));
    /* Clicking the figures: a small Keep / Turn off menu, and
       the game under them is not clicked (no details opening). Turned off,
       only Settings brings them back. */
    await b.clickSel("#view .gcard.sel .gcard-pl");
    await b.waitFor(`!!document.querySelector(".ctx")`, 3000);
    check("clicking the figures asks: keep or turn off", await b.ev(`[document.querySelector(".ctx .ctx-title").textContent, ...[...document.querySelectorAll(".ctx .ctx-label")].map(n => n.textContent)].join("|")`), "Player icons|Keep|Turn off");
    check("and the game under them was not clicked", await b.ev(`!!document.querySelector("#details:not([hidden])")`), false);
    await b.menuItem(/^Keep$/);
    check("Keep keeps them", await b.ev(`document.body.classList.contains("show-players")`), true);
    await b.clickSel("#view .gcard.sel .gcard-pl");
    await b.waitFor(`!!document.querySelector(".ctx")`, 3000);
    await b.menuItem(/^Turn off$/);
    check("Turn off hides them at once", await b.ev(`getComputedStyle(document.querySelector("#view .gcard.sel .gcard-pl")).display`), "none");
    check("and saves it", await apiUntil(async () => (await api("api/settings.php")).settings.view.showPlayers === false), true);
  }
  await api("api/settings.php", { view: { showPlayers: false } });
  await b.goto(undefined, { keepView: true });
  await b.setView("wheel");

  /* ---- the rows view -------------------------------------------------------
     The chosen game across the top, rows of box art under it. Nothing runs
     off the screen, and where there is more to scroll to a bar says so.
     Chosen on the consoles screen it opens every game, like List and Grid. */
  await b.setView("rows");
  await b.waitFor(`document.querySelectorAll("#view .rrow").length > 0 && !!document.querySelector("#view .rcard.sel")`, 5000);
  await b.settled(400);
  const rv = await b.ev(`(() => { const v = document.getElementById("view").getBoundingClientRect(), h = document.getElementById("help").getBoundingClientRect();
    const list = document.querySelector(".rows-list"), band = document.querySelector(".rows-band").getBoundingClientRect();
    const tracks = [...document.querySelectorAll(".rrow-track")];
    return { bottom: v.bottom <= h.top, pageStill: document.documentElement.scrollHeight <= innerHeight + 1,
      inside: band.left >= v.left - 1 && band.right <= v.right + 1 && tracks.every(t => { const r = t.getBoundingClientRect(); return r.left >= v.left - 1 && r.right <= v.right + 1; }),
      listBar: list.scrollHeight > list.clientHeight ? list.offsetWidth - list.clientWidth : -1,
      rowMore: (t => t ? { bar: t.offsetHeight - t.clientHeight, fade: t.parentElement.classList.contains("can-l") || t.parentElement.classList.contains("can-r"),
        chevrons: t.parentElement.querySelectorAll(".rrow-more").length } : null)(tracks.find(t => t.scrollWidth > t.clientWidth)),
      legend: document.getElementById("help").textContent };
  })()`);
  check("rows: the view stops above the legend and the page does not scroll", [rv.bottom, rv.pageStill], [true, true]);
  check("nothing runs past the view's sides", rv.inside, true);
  check("more rows than fit: the rows have a bar down the side", rv.listBar > 0, true);
  /* No bar under every row: a longer row fades at its edge and carries the
     two chevrons instead. */
  check("a row longer than the screen fades at its edge, with chevrons and no bar",
    rv.rowMore && [rv.rowMore.bar, rv.rowMore.fade, rv.rowMore.chevrons], [0, true, 2]);
  check("the legend says the arrows go four ways", /↑↓←→/.test(rv.legend), true);
  // The wheel over a long row turns it sideways; on the page's empty side, or on the band, it scrolls the rows down.
  {
    const wheelAt = async (x, y) => {
      await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await b.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: 120 });
    };
    const spot = await b.ev(`(t => { if (!t) return null; t.scrollLeft = 0; document.querySelector(".rows-list").scrollTop = 0; const r = t.getBoundingClientRect();
      return { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2), i: [...document.querySelectorAll(".rrow-track")].indexOf(t) }; })
      ([...document.querySelectorAll(".rrow-track")].find(t => t.scrollWidth > t.clientWidth + 2))`);
    if (spot) {
      await wheelAt(spot.x, spot.y);
      check("the wheel over a long row turns that row sideways and leaves the rows",
            [await b.until(`document.querySelectorAll(".rrow-track")[${spot.i}].scrollLeft > 0`, true, 3000), await b.ev(`document.querySelector(".rows-list").scrollTop`)], [true, 0]);
      await b.ev(`document.querySelectorAll(".rrow-track")[${spot.i}].scrollLeft = 0`);
    }
    const side = await b.ev(`(() => { const v = document.getElementById("view").getBoundingClientRect(), x = Math.max(2, Math.round(v.left - 12)), y = Math.round(v.bottom - 40);
      const n = document.elementFromPoint(x, y); return { x, y, empty: n === document.body || n === document.documentElement || n.classList.contains("wrap") }; })()`);
    await wheelAt(side.x, side.y);
    check("the wheel on the page's empty side scrolls the rows down",
          [side.empty, await b.until(`document.querySelector(".rows-list").scrollTop > 0`, true, 3000)], [true, true]);
    const band = await b.ev(`(r => { document.querySelector(".rows-list").scrollTop = 0; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })
      (document.querySelector(".rows-band").getBoundingClientRect())`);
    await wheelAt(band.x, band.y);
    check("and so does the wheel on the band over them", await b.until(`document.querySelector(".rows-list").scrollTop > 0`, true, 3000), true);
    await b.ev(`document.querySelector(".rows-list").scrollTop = 0`);
  }
  /* Everything else holds only what no row above shows, or it reads as a
     second copy of the library. Every game is still in some row. */
  const cover = await b.ev(`(async () => { const St = await import("/js/state.js");
    const rows = [...document.querySelectorAll(".rrow")], ids = (r) => [...r.querySelectorAll(".rcard")].map(c => c.dataset.id);
    const rest = rows.find(r => r.dataset.key === "rest"), above = new Set(rows.filter(r => r !== rest).flatMap(ids));
    const all = new Set(rows.flatMap(ids));
    return { reach: St.games.every(g => all.has(g.id)), restRepeats: rest ? ids(rest).filter(t => above.has(t)).length : 0,
      restLast: !rest || rows[rows.length - 1] === rest, restCount: rest ? rest.querySelector(".rrow-n").textContent === String(ids(rest).length) : true }; })()`);
  check("every game is in some row, so none is out of reach", cover.reach, true);
  check("Everything else is last and repeats nothing shown above it", [cover.restLast, cover.restRepeats, cover.restCount], [true, 0, true]);
  // Where the selection is: row, place, the game, the band's title.
  const at = `(async () => { const St = await import("/js/state.js"); const rows = [...document.querySelectorAll(".rrow")];
    const r = rows.findIndex(x => x.classList.contains("cur")); const cards = r < 0 ? [] : [...rows[r].querySelectorAll(".rcard")];
    return { r, c: cards.findIndex(x => x.classList.contains("sel")), n: cards.length, sel: St.games[St.sel].title, card: (n => !n ? undefined : n.dataset.ownTitle !== undefined ? n.dataset.ownTitle : n.title)(document.querySelector(".rcard.sel")),
      band: document.querySelector(".rows-title").textContent }; })()`;
  let p = await b.ev(at);
  check("it opens on the first card of the first row, and that is the chosen game", [p.r, p.c, p.card === p.sel], [0, 0, true]);
  await b.key("ArrowRight");
  await b.settled(400);
  p = await b.ev(at);
  check("right moves along the row, and the band follows", [p.r, p.c, p.card === p.sel, p.band === p.sel], [0, Math.min(1, p.n - 1), true, true]);
  await b.key("ArrowDown");
  await b.settled(300);
  p = await b.ev(at);
  check("down goes to the next row", p.r, 1);
  await b.key("ArrowUp");
  await b.settled(300);
  p = await b.ev(at);
  check("and up comes back to where that row was left", [p.r, p.c], [0, Math.min(1, p.n - 1)]);
  // End of a long row: the card is scrolled to, whole, inside its row.
  await b.ev(`(n => n.scrollTop = 0)(document.querySelector(".rows-list"))`);
  const longRow = await b.ev(`[...document.querySelectorAll(".rrow")].findIndex(r => (t => t.scrollWidth > t.clientWidth)(r.querySelector(".rrow-track")))`);
  for (let i = 0; i < longRow; i++) { await b.key("ArrowDown"); }
  await b.key("End");
  await b.settled(400);
  const endSeen = await b.ev(`(() => { const c = document.querySelector(".rcard.sel"), t = c.parentNode, l = document.querySelector(".rows-list");
    const cr = c.getBoundingClientRect(), tr = t.getBoundingClientRect(), lr = l.getBoundingClientRect();
    return { last: c === t.lastElementChild, scrolled: t.scrollLeft > 0, whole: cr.left >= tr.left - 1 && cr.right <= tr.right + 1 && cr.top >= lr.top - 1 && cr.bottom <= lr.bottom + 1 }; })()`);
  check("End goes to the row's last card, scrolled to and whole on screen", endSeen, { last: true, scrolled: true, whole: true });
  // The mouse: a click chooses the card, a second click opens details.
  await b.ev(`(n => n.scrollLeft = 0)(document.querySelector(".rrow.cur .rrow-track"))`);
  await b.clickSel(".rrow.cur .rcard:nth-child(2)");
  await b.settled(300);
  p = await b.ev(at);
  check("a click chooses that card, and details stays shut", [p.c, await b.ev(`document.getElementById("details").hidden`)], [1, true]);
  await b.clickSel(".rrow.cur .rcard.sel");
  check("clicking the chosen card opens its details", await b.until(`!document.getElementById("details").hidden`, true), true);
  await b.key("Escape");
  await b.settled(300);
  await b.key("g");
  await b.waitFor(`document.getElementById("view").classList.contains("list")`, 5000);
  check("G goes on from Rows to List", await b.ev(`document.getElementById("viewsel").value`), "list");
  await b.setView("rows");
  check("and coming back starts at the top left again", (await b.ev(at)).r + ":" + (await b.ev(at)).c, "0:0");
  /* The gear in the band's top right corner: one slider, the grid's and the
     shelf's window, changes the rows' picture size. */
  {
    const artH = `Math.round(document.querySelector("#view .rcard :is(.rcard-art, .rcard-noart)").getBoundingClientRect().height)`;
    const fits = `(() => { const t = document.querySelector(".rrow.cur .rrow-track"), c = t.firstElementChild; return Math.max(1, Math.floor((t.clientWidth + 12) / (c.offsetWidth + 12))); })()`;
    const whole = `(() => { const c = document.querySelector(".rcard.sel").getBoundingClientRect(), l = document.querySelector(".rows-list").getBoundingClientRect();
      return c.top >= l.top - 1 && c.bottom <= l.bottom + 1; })()`;
    const usual = await b.ev(artH), fits0 = await b.ev(fits);
    check("the rows' band has a gear in its top right corner: a cog, no word",
          await b.ev(`(g => { if (!g) return null; const r = g.getBoundingClientRect(), s = document.querySelector(".rows-band").getBoundingClientRect();
            return [r.width >= 24 && r.width <= 40, r.right <= s.right && r.right > s.right - 24, r.top >= s.top && r.top < s.top + 24, !!g.querySelector("svg"), g.textContent.trim()]; })(document.getElementById("vsize"))`),
          [true, true, true, true, ""]);
    check("and a row of the usual size stands whole in the rows' space", await b.ev(whole), true);
    await b.clickSel("#vsize");
    check("it opens the size window on Picture size, one slider, at the usual size",
          await b.until(`(p => p ? [p.querySelector(".wpop-head").textContent, p.querySelector("input").value, p.querySelectorAll("input[type=range]").length, p.querySelector(".wpop-hint").textContent] : null)(document.getElementById("vsize-pop"))`,
            ["Picture size", "100", 1, "As Xsegon comes. " + fits0 + " across."]), ["Picture size", "100", 1, "As Xsegon comes. " + fits0 + " across."]);
    await slideTo(50);
    const half = await b.ev(artH), fitsHalf = await b.ev(fits);
    check("the usual size is twice the size the pictures had: half of it is the old 15% of the screen's height",
          [Math.abs(usual - 2 * half) <= 2, Math.abs(half - await b.ev(`Math.round(Math.min(170, Math.max(96, innerHeight * .15)))`)) <= 1], [true, true]);
    check("smaller pictures put more across, at once, and the window says how many",
          [fitsHalf > fits0, await b.ev(`document.querySelector("#vsize-pop .wpop-hint").textContent`)], [true, fitsHalf + " across."]);
    check("the size is saved once it rests", await apiUntil(async () => (await api("api/settings.php")).settings.view.rowsSize === 50), true);
    await slideTo(150);
    check("at its largest a row still stands whole, with the chosen card in sight", [await b.ev(artH) > usual, await b.ev(whole)], [true, true]);
    await b.ev(`document.querySelector("#vsize-pop .vsize-reset").click()`);
    check("its button puts the usual size back", await b.until(artH, usual), usual);
    check("saved as that, and the grid's and the shelf's sizes are their own, untouched",
          await apiUntil(async () => (({ rowsSize, gridSize, shelfSize }) => rowsSize === 100 && gridSize === 100 && shelfSize === 100)((await api("api/settings.php")).settings.view)), true);
    await b.key("Escape");
    check("Esc closes the window and leaves the rows", await b.until(`!document.getElementById("vsize-pop") && document.getElementById("view").classList.contains("rowsview")`, true), true);
  }
  check("the settings know the view", Object.keys((await api("api/settings.php")).schema.view.default.options).includes("rows"), true);

  /* ---- disc sets ------------------------------------------------------------
     A mark for a set that plays whole and a warning, wearing its disc's
     number, for one that can only play one disc. On for everyone, including
     Badges choices saved before these existed. */
  const dm = await b.ev(`(async () => { const U = await import("/js/util.js");
    const one = U.badgesEl({ discs: { set: false, disc: 2, onDisk: 1 } }).querySelector(".b-onedisc");
    const set = U.badgesEl({ discs: { set: true, n: 3 } }).querySelector(".b-discs");
    const none = U.badgesEl({ discs: null });
    return { one: one && [one.textContent, /^Disc 2 of a set, no playlist/.test(one.title), /not in its folder/.test(one.title)],
      set: set && [set.textContent, set.title], none: !none.querySelector(".b-discs, .b-onedisc"),
      short: [U.discShort({ discs: { set: true, n: 3 } }), U.discShort({ discs: { set: false, disc: 1, onDisk: 2 } })],
      fix: /Scan for Games can build one/.test(U.discWords({ discs: { set: false, disc: 1, onDisk: 2 } })),
      on: ["badge-discs", "badge-onedisc"].every(c => document.body.classList.contains(c)) }; })()`);
  check("discs: one disc of a set wears its number, with the sentence on hover", dm.one, ["②", true, true]);
  check("a whole set wears the disc mark and says how many", dm.set, ["◎", "3 discs, as a playlist: change disc in the emulator"]);
  check("any other game wears neither", dm.none, true);
  check("the short words for the panels", dm.short, ["3 discs · playlist", "Disc 1 only · no playlist"]);
  check("and with the rest of the set beside it, the way to fix it", dm.fix, true);
  check("both marks are on, even for a Badges choice saved before they existed", dm.on, true);
  const discGame = await b.ev(`(async () => { const St = await import("/js/state.js"); return St.games.findIndex(g => g.discs && !g.discs.set); })()`);
  if (discGame >= 0) {
    await b.setView("list");
    await b.ev(`(async () => { const St = await import("/js/state.js"); const V = await import("/js/views.js"); const i = St.games.findIndex(g => g.discs && !g.discs.set); St.setSel(i); V.render(); })()`);
    await b.settled(300);
    check("the info panel says it before Play is pressed", await b.ev(`(p => p ? [p.classList.contains("warn"), /only · no playlist$/.test(p.textContent)] : null)(document.querySelector("#hero .pill.disc"))`), [true, true]);
  }
  await b.goto();
  await b.setView("wheel");

  /* ---- the screensaver: only games whose picture actually arrives -------
     hasArt says there is a box, not that the picture loads. A slide goes up
     only once its picture has loaded; with nothing to show the screensaver
     does not come up. Started by setting its wait to nothing and asking
     whether the page is idle, as the ten second tick does. */
  const idleNow = (everySec) => b.ev(`(async () => { const St = await import("/js/state.js"), Ss = await import("/js/status.js");
    St.S.screensaver = { enabled: true, afterMin: 0.0001, everySec: ${everySec} }; await new Promise(r => setTimeout(r, 30)); Ss.checkIdle(); })()`);
  const saverUp = `(s => !s.hidden && (i => !!i && i.complete && i.naturalWidth > 0)(s.querySelector("img.saver-art")))(document.getElementById("saver"))`;
  const wake = () => b.ev(`import("/js/status.js").then(m => m.touch())`);
  await b.goto();
  await idleNow(60);
  check("the screensaver comes up on a picture that has loaded", await b.waitFor(saverUp, 8000));
  await wake();
  check("and goes at a touch", await b.ev(`document.getElementById("saver").hidden`));

  // Four games with a box: three whose picture is not there, one that is.
  // Slides every 0.3s, so the next slide has only the three to try first.
  await b.goto();
  const good = await b.ev(`(async () => { const St = await import("/js/state.js"); const art = St.games.filter(g => g.hasArt);
    art.forEach((g, i) => { if (i >= 4) { g.hasArt = false; } else if (i > 0) { g.imgFull = Object.assign({}, g.imgFull, { box: "/files/no-such-picture-" + i + ".jpg" }); } });
    return art.slice(0, 4).map(g => g.title); })()`);
  await idleNow(0.3);
  check("a game whose picture will not load is never a slide", await b.waitFor(`${saverUp} && document.querySelector("#saver .saver-title").textContent === ${JSON.stringify(good[0])}`, 8000));
  await sleep(1500);
  check("the slides go on, on the one picture there is", await b.ev(`${saverUp} && document.querySelector("#saver .saver-title").textContent === ${JSON.stringify(good[0])}`));
  await b.ev(`import("/js/log.js").then(m => m.flushLog())`);
  let saverLog = "";
  await apiUntil(async () => { saverLog = (await api("api/log.php?tail=200")).lines.join("\n"); return good.slice(1).every((t) => saverLog.includes("SAVR no picture, skipped " + t)); });
  check("each one passed over is in the log", good.slice(1).every((t) => saverLog.includes("SAVR no picture, skipped " + t)));
  await wake();

  // None whose picture loads: it does not come up, and nothing flickers.
  await b.goto();
  await b.ev(`(async () => { const St = await import("/js/state.js"); St.games.forEach((g, i) => { g.imgFull = Object.assign({}, g.imgFull, { box: "/files/no-such-picture-" + i + ".jpg" }); }); })()`);
  await idleNow(0.3);
  await sleep(1500);
  check("with no picture to show, the screensaver does not come up", await b.ev(`document.getElementById("saver").hidden`));
  await b.ev(`import("/js/status.js").then(m => m.checkIdle())`); await sleep(500);
  check("and asking again does not bring up an empty one", await b.ev(`document.getElementById("saver").hidden`));
  await b.ev(`(async () => { const St = await import("/js/state.js"); St.games.forEach(g => { g.hasArt = false; }); (await import("/js/status.js")).checkIdle(); })()`);
  await sleep(300);
  check("nor when no game has a box at all", await b.ev(`document.getElementById("saver").hidden`));
  await b.goto();                        // the games as the server has them again
};
