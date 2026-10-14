// A game of your own: add, see it on the consoles screen, edit, launch (web), remove.
"use strict";
// the run's own server: a web game of yours points at a page on it
const HERE = require("./lib").BASE;
const { sleep, api } = require("./lib");

/* Fill a row by its label. The platform row is a dropdown plus "New
   platform..." (NEW_PLATFORM); left alone it means Unknown. */
const FILL = (label, value) => `(() => {
  const row = [...document.querySelectorAll("#editor .ed-row")].find(r => r.querySelector("label").firstChild.textContent === ${JSON.stringify(label)});
  const i = row.querySelector("input, textarea");
  i.value = ${JSON.stringify(value)};
  i.dispatchEvent(new Event("input", { bubbles: true }));
})()`;
const NEW_PLATFORM = (name) => `(() => {
  const s = document.querySelector("#editor .plat-pick select");
  s.value = "__new";
  s.dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector("#editor .plat-pick input").value = ${JSON.stringify(name)};
})()`;
const ADD = `[...document.querySelectorAll("#editor .set-foot button")].find(x => x.textContent === "Add").click()`;

module.exports = async function (b, check) {
  await b.goto();
  check("+ in the masthead", await b.ev(`!!document.getElementById("btn-add")`));
  /* + asks which kind of adding. Both roads are checked: the chooser is the
     only way in, so a broken one takes both with it. */
  await b.clickSel("#btn-add");
  check("+ asks which kind of adding",
        await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "ADD GAMES"`, 8000));
  // The third is what Steam has installed (t-steam checks it).
  check("and offers exactly three ways, with nothing else on the screen",
        await b.ev(`[...document.querySelectorAll("#editor .add-big-title")].map(x => x.textContent)`),
        ["Add automatically from a folder", "Add one by hand", "Add your Steam games"]);
  await b.ev(`[...document.querySelectorAll("#editor .add-big")].find(x => /from a folder/.test(x.textContent)).click()`);
  check("the folder road opens the scanner",
        await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "SCAN FOR GAMES"`, 12000));
  await b.ev(`[...document.querySelectorAll("#editor button")].find(x => /Back/.test(x.textContent)).click()`);
  check("and Back comes back to the choice, rather than closing",
        await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "ADD GAMES"`, 8000));
  await b.ev(`[...document.querySelectorAll("#editor .add-big")].find(x => /by hand/.test(x.textContent)).click()`);
  check("+ opens the form", await b.waitFor(`/ADD A GAME OF YOUR OWN/.test((document.querySelector("#editor .panel-title") || {}).textContent || "")`, 8000));
  check("which has its own way back too",
        await b.ev(`[...document.querySelectorAll("#editor button")].some(x => /Back/.test(x.textContent))`));
  await b.settled();

  // the platform picker: what exists, Unknown, and a way to name a new one
  const opts = await b.ev(`[...document.querySelectorAll("#editor .plat-pick select option")].map(o => o.value)`);
  check("platform is a dropdown, Unknown first and New platform last", opts[0] === "" && opts[opts.length - 1] === "__new" && opts.length > 5);
  check("Unknown reads as not filed under a console", await b.ev(`document.querySelector("#editor .plat-pick select option").textContent`).then((t) => /Unknown/.test(t)));
  check("the name box is hidden until you ask for it", await b.ev(`document.querySelector("#editor .plat-pick input").hidden`));

  /* Players must not be a copy of Rating's box (0 to 5 in tenths): the
     browser would silently refuse eight players and accept 2.5. */
  const playersBox = await b.ev(`(() => {
    const row = [...document.querySelectorAll("#editor .ed-row")].find(r => r.querySelector("label").firstChild.textContent === "Players");
    if (!row) { return null; }
    const i = row.querySelector("input");
    return { type: i.type, min: i.min, max: i.max, step: i.step, value: i.value };
  })()`);
  check("the form has a Players box", !!playersBox && playersBox.type === "number");
  check("it counts people, not stars", playersBox.max, "64");
  check("in whole ones", playersBox.step, "1");
  check("and starts blank, because nobody has said", playersBox.value, "");
  check("Rating still has its own limits", await b.ev(`(() => {
    const row = [...document.querySelectorAll("#editor .ed-row")].find(r => r.querySelector("label").firstChild.textContent === "Rating");
    const i = row.querySelector("input");
    return i.max + "/" + i.step;
  })()`), "5/0.1");

  // a game with NO platform: allowed, and filed under Unknown
  await b.ev(FILL("Title", "Xsegon Test No Platform"));
  await b.ev(FILL("Or open this web address", HERE + "/?test=0"));
  await b.ev(ADD);
  check("a game with no platform is accepted", await b.until(`document.getElementById("editor").hidden`, true, 8000));
  await b.until(`document.getElementById("platform").value === "Unknown" && /no platform given/.test(document.getElementById("strip").textContent)`, true, 8000);
  await b.settled();
  check("and says where it went", await b.ev(`document.getElementById("strip").textContent`).then((t) => /Unknown/.test(t) && /no platform given/.test(t)));
  check("opened inside Unknown", await b.ev(`document.getElementById("platform").value`), "Unknown");
  const none = (await api("api/local.php")).games.find((g) => g.title === "Xsegon Test No Platform");
  check("stored with no platform of its own", !!none && !none.platform);
  const unk = await api("api/library.php?platform=Unknown");
  check("the library files it under Unknown, playable", unk.games.some((g) => g.title === "Xsegon Test No Platform" && g.platform === "Unknown" && g.playable));
  await api("api/local.php", { id: none.id, remove: true });

  // and one under a name of your own
  await b.goto();
  await b.addByHand();
  await b.ev(FILL("Title", "Xsegon Test Web Game"));
  await b.ev(NEW_PLATFORM("Xsegon Test Platform"));
  check("New platform opens the name box", await b.ev(`!document.querySelector("#editor .plat-pick input").hidden`));
  await b.ev(FILL("Or open this web address", HERE + "/?test=1"));
  await b.ev(ADD);
  check("added and opened inside its platform", await b.until(`document.getElementById("platform").value`, "Xsegon Test Platform", 8000), "Xsegon Test Platform");
  await b.settled();
  const all = await api("api/local.php");
  const mine = all.games.find((g) => g.title === "Xsegon Test Web Game");
  check("stored in local-games.json", !!mine);
  const lib = await api("api/library.php?platform=" + encodeURIComponent("Xsegon Test Platform"));
  check("library lists it as local and playable", lib.games.length === 1 && lib.games[0].local && lib.games[0].playable);

  // A game of your own is the one kind the metadata overlay does not own: its
  // record is the source, so the edit belongs in its own form.
  const wrongDoor = await api("api/edit.php", { id: mine.id, set: { genre: "Nope" } });
  check("the metadata overlay sends one of your own to its own form instead",
        wrongDoor.ok === false && wrongDoor.local === true && /right-click > Edit Game/.test(wrongDoor.error));
  check("and its own form is what the details say it has",
        (await api("api/game.php?id=" + encodeURIComponent(mine.id))).game.origin, "own");

  // launch answers with the address (the page opens it)
  const l = await api("api/launch.php", { id: mine.id });
  check("launch of a web game returns its address", l.ok && l.url === HERE + "/?test=1");
  const s = await api("api/session.php", { id: mine.id, seconds: 30 });
  check("a page-timed session is recorded", s.ok);
  const after = await api("api/library.php?platform=" + encodeURIComponent("Xsegon Test Platform"));
  check("play time counted", after.games[0].seconds, 30);

  /* A web game plays in play.php in a window of its own: in the kiosk window
     there is no way back (no title bar, Esc belongs to the game's page). */
  const BASE = require("./lib").BASE;           // the run's own server (tests\sandbox.js)
  await b.goto(BASE + "/play.php?id=" + mine.id);
  check("play.php frames the game itself", await b.ev(`(document.getElementById("game") || {}).src`), HERE + "/?test=1");
  check("the window is named after the game", await b.ev(`document.title`), "Xsegon Test Web Game - Xsegon");
  check("it draws a way out and a minimise", await b.ev(`!!document.getElementById("close") && !!document.getElementById("min")`));
  // shown on the way in, then out of the way until the mouse comes back.
  // Waited for: the bar sleeps 2.5s after it wakes.
  check("they fade out of the way while you play", await b.waitFor(`!document.getElementById("bar").classList.contains("awake")`, 6000));
  await b.ev(`document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))`);
  check("and come back on a mouse move", await b.until(`document.getElementById("bar").classList.contains("awake")`));
  // what those two actually ask the server for
  await b.ev(`(() => { window.__ops = []; window.fetch = function (u, o) { window.__ops.push(String(u) + " " + ((o && o.body) || "")); return Promise.resolve(new Response("{}", { headers: { "Content-Type": "application/json" } })); }; })()`);
  await b.key("Escape");
  await b.until(`/"op":"close"/.test(window.__ops.join("|"))`);
  check("Esc closes that window by name, not the wall", await b.ev(`window.__ops.join("|")`).then((t) => /api\/window\.php .*"op":"close"/.test(t) && t.indexOf("Xsegon Test Web Game - Xsegon") > 0));
  await b.ev(`window.__ops = []; document.getElementById("min").click()`);
  await b.until(`/"op":"minimize"/.test(window.__ops.join("|"))`);
  check("the minimise button names that window too", await b.ev(`window.__ops.join("|")`).then((t) => /"op":"minimize"/.test(t) && t.indexOf("Xsegon Test Web Game - Xsegon") > 0));
  check("play.php refuses an id that is not a game of yours", (await (await fetch(BASE + "/play.php?id=xs-000000000000")).status) === 404);

  const opened = await api("api/open-game.php", { id: "xs-000000000000" });
  check("and so does the endpoint that opens the window", opened.ok === false);
  const openedBad = await api("api/open-game.php", { id: "not-an-id" });
  check("an id that is not an id is refused", openedBad.ok === false);

  // back on the consoles screen the platform is there. Straight to the wall:
  // walking the rim to it proves nothing here and can land on its neighbour.
  await b.goto();
  /* Waited for: the dropdown is filled once the library has answered, so a
     read straight after the navigation fails on a busy server. */
  const hasPlatform = `[...document.querySelectorAll("#platform option")].some(o => o.value === "Xsegon Test Platform")`;
  // the rim only DRAWS what is near the selection; the dropdown holds all
  check("new platform is a console now", await b.waitFor(hasPlatform, 8000));

  // edit through the API, then remove through the menu
  const e = await api("api/local.php", { id: mine.id, set: { title: "Xsegon Test Web Game 2", platform: "Xsegon Test Platform", url: HERE + "/?test=2" } });
  check("edit saved", e.ok && e.game.title === "Xsegon Test Web Game 2");
  const bad = await api("api/local.php", { set: { title: "x", platform: "y" } });
  check("an entry with nothing to run is refused", bad.ok === false);
  const noName = await api("api/local.php", { set: { platform: "y", url: HERE + "/" } });
  check("an entry with no title is refused", noName.ok === false);
  const atSign = await api("api/local.php", { set: { title: "x", platform: "@favourites", url: HERE + "/" } });
  check("a platform named like a collection is refused", atSign.ok === false);

  // the editor opens on the platform the game is filed under
  await b.goto();
  await b.ev(`fetch("api/library.php?platform=" + encodeURIComponent("Xsegon Test Platform"))`);
  const back = await api("api/local.php?id=" + mine.id);
  check("a custom platform is kept as typed", back.game.platform, "Xsegon Test Platform");
  const rm = await api("api/local.php", { id: mine.id, remove: true });
  check("removed", rm.ok);
  const gone = await api("api/library.php?platform=" + encodeURIComponent("Xsegon Test Platform"));
  check("platform gone with it", gone.count, 0);
};
