// Edit Metadata, Change Pictures (use no picture, Find online), Add Video state.
"use strict";
const { sleep, api, apiUntil } = require("./lib");

module.exports = async function (b, check) {
  await b.goto();
  await b.setView("grid");
  await b.openPlatform("Nintendo 64");
  const id = await b.ev(`(async () => { const j = await (await fetch("api/library.php?platform=Nintendo%2064")).json(); return j.games[0].id; })()`);

  // metadata: edit, see it, reset
  await b.contextMenu("#view .tile.sel");
  await b.menuItem(/Edit Metadata/);
  check("editor opens", await b.until(`(document.querySelector("#editor .panel-title") || {}).textContent`, "EDIT METADATA", 6000), "EDIT METADATA");
  await b.settled();
  const dev0 = await b.ev(`[...document.querySelectorAll("#editor .ed-row")].find(r => r.querySelector("label").firstChild.textContent === "Developer").querySelector("input").value`);
  await b.ev(`(() => { const i = [...document.querySelectorAll("#editor .ed-row")].find(r => r.querySelector("label").firstChild.textContent === "Developer").querySelector("input"); i.value = "Xsegon Test Studio"; i.dispatchEvent(new Event("input")); })()`);
  await b.ev(`[...document.querySelectorAll("#editor .set-foot button")].find(x => x.textContent === "Save").click()`);
  await b.until(`document.getElementById("editor").hidden`, true, 6000);
  let row;
  await apiUntil(async () => { row = await api("api/library.php?platform=Nintendo%2064"); return (row.games.find((g) => g.id === id) || {}).developer === "Xsegon Test Studio"; }, 6000);
  check("edit saved as an overlay", row.games.find((g) => g.id === id).developer, "Xsegon Test Studio");
  check("edited flag set", row.games.find((g) => g.id === id).edited, true);
  const r = await api("api/edit.php", { id, reset: ["developer"] });
  check("field reset", r.ok);
  const back = await api("api/library.php?platform=Nintendo%2064");
  /* A scanned game's metadata IS the override, so resetting a field goes to
     what the scan found: empty. An imported game resets to LaunchBox's value. */
  const origin = (await api("api/game.php?id=" + encodeURIComponent(id))).game.origin;
  check("developer back to its origin's value", back.games.find((g) => g.id === id).developer, origin === "scanned" ? "" : dev0);

  // Players is in Edit Metadata too, so any game's count can be changed.
  const pl0 = back.games.find((g) => g.id === id).players;
  await b.contextMenu("#view .tile.sel");
  await b.menuItem(/Edit Metadata/);
  await b.until(`(document.querySelector("#editor .panel-title") || {}).textContent`, "EDIT METADATA", 6000);
  const plInput = `[...document.querySelectorAll("#editor .ed-row")].find(r => r.querySelector("label").firstChild.textContent === "Players").querySelector("input")`;
  check("Edit Metadata has a Players box, whole numbers 1 to 64", await b.ev(`(i => i ? [i.type, i.min, i.max, i.step] : null)(${plInput})`), ["number", "1", "64", "1"]);
  check("showing LaunchBox's count, or blank when it has none", await b.ev(`${plInput}.value`), pl0 ? String(pl0) : "");
  const newPl = pl0 === 3 ? 5 : 3;
  await b.ev(`(i => { i.value = "${newPl}"; i.dispatchEvent(new Event("input")); })(${plInput})`);
  await b.ev(`[...document.querySelectorAll("#editor .set-foot button")].find(x => x.textContent === "Save").click()`);
  await b.until(`document.getElementById("editor").hidden`, true, 6000);
  let plRow;
  await apiUntil(async () => { plRow = (await api("api/library.php?platform=Nintendo%2064")).games.find((g) => g.id === id); return plRow.players === newPl; }, 6000);
  check("a changed player count is saved and used", plRow.players, newPl);
  check("a count that is not a whole number from 1 to 64 is refused", [(await api("api/edit.php", { id, set: { players: 0 } })).ok, (await api("api/edit.php", { id, set: { players: 2.5 } })).ok, (await api("api/edit.php", { id, set: { players: 65 } })).ok], [false, false, false]);
  await api("api/edit.php", { id, reset: ["players"] });
  // Same shape as the developer reset above: a scanned game's count came in
  // as an override, so resetting goes to the scanner's zero.
  check("and reset goes back to its origin's count", (await api("api/library.php?platform=Nintendo%2064")).games.find((g) => g.id === id).players, origin === "scanned" ? 0 : pl0);

  // pictures: use no picture, then use it again
  await b.contextMenu("#view .tile.sel");
  await b.menuItem(/Change Pictures/);
  check("pictures dialog opens", await b.until(`(document.querySelector("#editor .panel-title") || {}).textContent`, "CHANGE PICTURES", 6000), "CHANGE PICTURES");
  await b.until(`document.querySelectorAll("#editor .art-slot").length`, 5);
  await b.settled();
  check("five slots", await b.ev(`document.querySelectorAll("#editor .art-slot").length`), 5);
  check("one of them is the 3D box", await b.ev(`[...document.querySelectorAll("#editor .art-slot")].some(s => /3D box/.test(s.textContent))`));
  const logoBtn = `[...document.querySelectorAll("#editor .art-slot")].find(s => /Clear logo/.test(s.textContent)).querySelector("button:last-child")`;
  const hadLogo = await b.ev(`/Use no picture/.test(${logoBtn}.textContent)`);
  if (hadLogo) {
    await b.ev(logoBtn + ".click()");
    check("use no picture: slot says hidden", await b.until(`/hidden/.test([...document.querySelectorAll("#editor .art-slot")].find(s => /Clear logo/.test(s.textContent)).querySelector(".art-state").textContent)`));
    await b.ev(logoBtn + ".click()");
    // The whole of it: a hidden slot says "hidden: the original is not used", which must not pass for being back.
    check("use it again: slot says the original", await b.until(`/^the original$/.test([...document.querySelectorAll("#editor .art-slot")].find(s => /Clear logo/.test(s.textContent)).querySelector(".art-state").textContent)`));
  } else {
    check("logo slot present (no LaunchBox logo to hide)", true);
  }

  // Find online: the database answers for a matched game; no download here
  await b.ev(`[...document.querySelectorAll("#editor .art-slot")].find(s => /Box art/.test(s.textContent)).querySelector("button:nth-child(2)").click()`);
  // the database's answer, or the search box when it has none. The wait is long because the
  // first ask in a fresh copy sets the database up from the one that ships.
  await b.until(`document.querySelectorAll("#editor .pk-cell").length > 0 || !!document.querySelector("#editor .pk-search")`, true, 20000);
  const cells = await b.ev(`document.querySelectorAll("#editor .pk-cell").length`);
  const searching = await b.ev(`!!document.querySelector("#editor .pk-search")`);
  check("Find online shows pictures or a search", cells > 0 || searching);
  if (cells > 0) {
    check("first offer is a box, best region", await b.ev(`/Box|Cart|Fanart/.test(document.querySelector("#editor .pk-cap").textContent)`));
  }
  await b.key("Escape");
  check("Esc closes the dialog", await b.until(`document.getElementById("editor").hidden`));

  // video state answers
  const v = await api("api/video-own.php?id=" + id);
  check("video state answers", v.ok && typeof v.has === "boolean");

  /* A platform's own pictures: right-click a console on the wall.
     Always a made-up platform: this store holds pictures put there by hand,
     and a test that resets a real platform DELETES one. */
  const BASE = require("./lib").BASE;           // the run's own server (tests\sandbox.js)
  const PLAT = "Xsegon Test Console";
  const q = "platform=" + encodeURIComponent(PLAT);
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000200000002008060000007377f8" +
    "ca0000001c4944415478da63fc0fc4808ea38080d10c0c8c4c0c0c0c8b8181e18a" +
    "3f00e6d5073f4b2e8c4d0000000049454e44ae426082", "hex");
  const send = async (url, body, method) => {
    const r = await fetch(BASE + url, { method: method || "POST", headers: { Origin: BASE, "Content-Type": "application/octet-stream" }, body });
    return r.json();
  };
  const state = async (p) => (await (await fetch(BASE + "/api/platform-art.php?platform=" + encodeURIComponent(p), { headers: { Origin: BASE } })).json());

  const fresh = await state(PLAT);
  check("a platform with no pictures says so", fresh.ok && fresh.kinds.device.has === false && fresh.kinds.device.mine === false);
  check("it offers a logo and a console", Object.keys(fresh.kinds).join(","), "clearlogo,device");

  const up = await send("/api/platform-art.php?" + q + "&kind=device&part=0&of=1", png);
  check("a picture can be given to a platform of your own", up.ok && up.mine === true && up.width === 32);
  const served = await fetch(BASE + "/api/image.php?" + q + "&kind=device", { headers: { Origin: BASE } });
  const bytes = Buffer.from(await served.arrayBuffer());
  check("and the screen is served exactly that picture", served.status === 200 && bytes.equals(png));
  // it has no ?v= in its address, so it must be revalidated or the wall would
  // show the old one for a day
  check("a platform picture revalidates", /must-revalidate/.test(served.headers.get("cache-control")));
  const again = await fetch(BASE + "/api/image.php?" + q + "&kind=device", { headers: { Origin: BASE, "If-None-Match": served.headers.get("etag") } });
  check("and costs a 304 when it has not changed", again.status, 304);

  // Two endings standing for one slot, as when an old one could not be removed: the newer is the picture.
  const fsx = require("fs"), pathx = require("path"), artDir = pathx.join(require("./lib").DATA, "platform-art");
  const minePng = fsx.readdirSync(artDir).map((f) => pathx.join(artDir, f)).find((f) => /-device\.png$/.test(f) && Date.now() - fsx.statSync(f).mtimeMs < 60000);
  const hourAgo = new Date(Date.now() - 3600000);
  fsx.utimesSync(minePng, hourAgo, hourAgo);
  const newerJpg = minePng.replace(/\.png$/, ".jpg");
  fsx.writeFileSync(newerJpg, "a newer picture under another ending");
  check("of two endings standing for one slot, the newer is the one read",
    (await state(PLAT)).kinds.device.rev, Math.floor(fsx.statSync(newerJpg).mtimeMs / 1000));
  const up2 = await send("/api/platform-art.php?" + q + "&kind=device&part=0&of=1", png);
  check("a replacement goes in first and the slot's other endings go after: one file stands, the new one",
    [up2.ok, fsx.existsSync(newerJpg), fsx.existsSync(minePng), (await state(PLAT)).kinds.device.rev === up2.rev], [true, false, true, true]);

  const reset = await send("/api/platform-art.php?" + q + "&kind=device&reset=1", null);
  check("reset takes it away again", reset.ok && reset.mine === false);
  check("and nothing is served for it", (await fetch(BASE + "/api/image.php?" + q + "&kind=device", { headers: { Origin: BASE } })).status, 404);

  check("a kind that is not a kind is refused", (await send("/api/platform-art.php?" + q + "&kind=nope&part=0&of=1", png)).ok === false);
  check("a file that is not a picture is refused", (await send("/api/platform-art.php?" + q + "&kind=device&part=0&of=1", Buffer.from("not a picture"))).ok === false);
  check("no platform is refused", (await send("/api/platform-art.php?platform=&kind=device&part=0&of=1", png)).ok === false);

  // the way in: right-click a console
  await b.goto();
  await b.ev(`document.querySelector("#syswall .switem, #syswall .syscard").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 500, clientY: 400 }))`);
  await b.waitFor(`!!document.querySelector(".ctx")`, 3000); await b.settled();
  const entries = await b.ev(`[...document.querySelectorAll(".ctx-item")].map(n => n.textContent)`);
  check("right-clicking a console offers its pictures", entries.some((t) => /Change Pictures/.test(t)) && entries.some((t) => /^.?Open /.test(t)));
  await b.ev(`[...document.querySelectorAll(".ctx-item")].find(n => /Change Pictures/.test(n.textContent)).click()`);
  await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "CONSOLE PICTURES"`);
  check("the console pictures dialog opens", await b.ev(`(document.querySelector("#editor .panel-title") || {}).textContent`), "CONSOLE PICTURES");
  check("two slots, named", await b.ev(`[...document.querySelectorAll("#editor .art-slot .art-name")].map(n => n.textContent).join(",")`), "Logo,The console");
  check("each says where its picture comes from", await b.ev(`[...document.querySelectorAll("#editor .art-state")].every(n => /in Xsegon|from LaunchBox|no picture/.test(n.textContent))`));
  await b.key("Escape");
  check("Esc closes it", await b.until(`document.getElementById("editor").hidden`));

  const left = await state(PLAT);
  check("the test left no pictures behind", left.kinds.device.mine === false && left.kinds.clearlogo.mine === false);

  /* ---- a left click on what a game is missing offers to add it (js\missing.js) ----
     A game made here with no picture and no video. The offer is the two
     entries the right-click menu has; a game's own tile keeps its clicks. */
  const bare = await api("api/local.php", { set: { title: "Xsbare Scratch", platform: "Nintendo 64", url: BASE + "/" } }, "POST");
  try {
    const choose = `(async () => { const S = await import("/js/state.js"), V = await import("/js/views.js");
      const i = S.games.findIndex(g => g.id === ${JSON.stringify(bare.game.id)}); if (i < 0) { return false; } S.setSel(i); V.render(); return true; })()`;
    const menu = `[...document.querySelectorAll(".ctx .ctx-label")].map(n => n.textContent)`;
    const editorTitle = `(document.querySelector("#editor .panel-title") || {}).textContent`;
    const closeEditor = async () => { await b.key("Escape"); await b.until(`document.getElementById("editor").hidden`, true, 6000); };
    await b.goto();
    await b.setView("list");
    await b.openPlatform("Nintendo 64");
    check("the game with nothing is on the shelf", await b.ev(choose), true);
    await b.settled();

    check("the info panel's NO ART stand-in says it can be clicked",
      await b.ev(`(n => [!!n && !n.hidden, n.classList.contains("can-add"), getComputedStyle(n, "::after").content, n.title])(document.querySelector("#hero .hero-noart"))`),
      [true, true, '"click to add"', "No picture for this game. Click to add one."]);
    await b.clickSel("#hero .hero-noart");
    check("a left click on it offers the pictures and the video, under the game's name",
      [await b.until(menu, ["Change Pictures...", "Add Video..."], 4000), await b.ev(`(document.querySelector(".ctx .ctx-title") || {}).textContent`)],
      [["Change Pictures...", "Add Video..."], "Xsbare Scratch"]);
    await b.menuItem(/Change Pictures/);
    check("and Change Pictures opens from there", await b.until(editorTitle, "CHANGE PICTURES", 6000), "CHANGE PICTURES");
    await closeEditor();

    await b.clickSel("#hero .pill.novid-pill");
    check("a left click on the no video pill offers the video first", await b.until(menu, ["Add Video...", "Change Pictures..."], 4000), ["Add Video...", "Change Pictures..."]);
    await b.menuItem(/Add Video/);
    check("and Add Video opens from there", await b.until(editorTitle, "ADD VIDEO", 6000), "ADD VIDEO");
    await closeEditor();

    await b.clickSel("#hero .hero-novid");
    check("the no-video mark on the picture's corner takes the click too", await b.until(menu, ["Add Video...", "Change Pictures..."], 4000), ["Add Video...", "Change Pictures..."]);
    await b.key("Escape");
    await b.until(`!document.querySelector(".ctx")`, true, 3000);

    // The tile itself: one click chooses, a click on the chosen one opens Details.
    await b.setView("grid");
    await b.ev(choose);
    await b.settled();
    check("a NO ART tile is not a button: its stand-in takes no click of its own",
      await b.ev(`(n => [!!n, !!n && n.classList.contains("can-add")])(document.querySelector("#view .tile.sel .noart"))`), [true, false]);
    await b.clickSel("#view .tile.sel .noart");
    check("so a click on the chosen tile still opens Details, with no menu",
      [await b.until(`!document.getElementById("details").hidden`, true, 6000), await b.ev(`!!document.querySelector(".ctx")`)], [true, false]);
    check("Details stands a NO ART where the cover would be, and says no video, both to click",
      await b.ev(`[!!document.querySelector("#details .cover-noart.can-add"), !!document.querySelector("#details .dlacks .novid-pill.can-add"), !!document.querySelector("#details .cover")]`),
      [true, true, false]);
    await b.clickSel("#details .cover-noart");
    check("a click on it offers the same two", await b.until(menu, ["Change Pictures...", "Add Video..."], 4000), ["Change Pictures...", "Add Video..."]);
    await b.menuItem(/Change Pictures/);
    check("and the pictures open over Details", await b.until(editorTitle, "CHANGE PICTURES", 6000), "CHANGE PICTURES");
    await closeEditor();
    check("closing them leaves Details where it was", await b.ev(`!document.getElementById("details").hidden`), true);
    await b.key("Escape");
    await b.until(`document.getElementById("details").hidden`, true, 6000);

    await b.setView("rows");
    check("the Rows view's big picture has the same stand-in",
      await b.ev(`(n => !!n && n.classList.contains("can-add"))(document.querySelector("#view .rows-pic .hero-noart"))`), true);
    await b.setView("grid");               // the view this group found, for the groups after it
  } finally {
    await api("api/local.php", { id: bare.game.id, remove: true }, "POST");
  }
};
