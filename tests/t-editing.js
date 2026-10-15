// Edit Metadata, Change Pictures (use no picture, Find online), Add Video state, the Media tab, Clear video and Clear all.
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

    /* ---- the Media tab: this game's own pictures and video, and another game's copied onto it (roadmap AM1, AM2) ----
       Onto the scratch game alone: a copy drops that game's thumbnails, and the test copy's data\thumbs is the real folder. */
    const cm = (q, method) => api("api/copy-media.php?id=" + encodeURIComponent(bare.game.id) + q, null, method);
    const key = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const list = await cm("");
    const firstOther = list.ok ? list.games.findIndex((x) => !x.same) : -1;
    check("Media: the games to copy from, this console's first, never the game itself, each with something to copy",
      [list.ok, list.games.length > 0, firstOther < 0 || list.games.slice(firstOther).every((x) => !x.same),
       list.games.every((x) => x.id !== bare.game.id), list.games.every((x) => x.has.length > 0)],
      [true, true, true, true, true]);
    const at = list.games.findIndex((x) => x.has.includes("box"));
    if (at < 0) {
      check("Media: no game in the test copy has box art to copy, so nothing more is checked", true);
    } else {
      const donor = list.games[at];
      const word = donor.title.split(/\s+/)[0];
      const found = await cm("&find=" + encodeURIComponent(word));
      check("the find box narrows by name", found.ok && found.games.length > 0
        && found.games.every((x) => key(x.title + " " + (x.variant || "")).includes(key(word))), true);
      const q = "&from=" + encodeURIComponent(donor.id);
      const boxRow = (r) => r.rows.find((x) => x.kind === "box");
      const before = await cm(q);
      check("a game picked shows its five pictures and its video beside this game's, which has none",
        [before.ok, before.rows.map((x) => x.kind).join(","), !!boxRow(before).from, boxRow(before).to],
        [true, "box,box3d,logo,shot,fanart,video", true, null]);
      await cm(q + "&kind=box");
      check("a read never copies, whatever it names", boxRow(await cm(q)).to, null);
      const put = await cm(q + "&kind=box", "POST");
      check("a press copies the box art, and says so", [put.ok, put.copied, boxRow(put).same, !!put.patch.imgFull.box, put.patch.hasArt],
        [true, ["box"], true, true, true]);
      let mine;
      await apiUntil(async () => { mine = (await api("api/library.php?platform=Nintendo%2064")).games.find((x) => x.id === bare.game.id); return mine && mine.hasArt; }, 6000);
      check("the library has it as the game's own picture", [!!mine && mine.hasArt, (await api("api/art.php?id=" + bare.game.id)).kinds.box.replaced], [true, true]);
      const again = await cm(q + "&kind=box", "POST");
      check("the same picture again is refused, with why", [again.ok, /already shows/.test(again.error || "")], [false, true]);
      check("a game cannot copy from itself", (await api("api/copy-media.php?id=" + bare.game.id + "&from=" + bare.game.id, null, "POST")).ok, false);
      check("a kind that is not a kind is refused", (await cm(q + "&kind=nope", "POST")).ok, false);
      const rest = before.rows.filter((x) => x.from && x.kind !== "box").map((x) => x.kind);
      const all = await cm(q + "&kind=all", "POST");
      check("Copy all it has copies the rest, the box art not twice", [all.ok, all.copied, all.rows.filter((x) => x.from).every((x) => x.same)], [true, rest, true]);

      // The tab: second, right after About; a press that would replace a picture asks first.
      check("the scratch game is on the shelf again", await b.ev(choose), true);
      await b.ev(`(async () => (await import("/js/details.js")).openDetails())()`);
      await b.until(`!document.getElementById("details").hidden`, true, 6000);
      check("Media is the second tab", await b.until(`[...document.querySelectorAll("#details .dtab")].map(n => n.dataset.tab).slice(0, 2).join(",")`, "about,media", 6000), "about,media");
      await b.ev(`document.querySelector('#details .dtab[data-tab="media"]').click()`);
      const ownRows = `[...document.querySelectorAll("#details .md-own .cr-row")].map(n => n.dataset.kind || (n.className.match(/md-(copy|clear)/) || [])[1]).join(",")`;
      check("it opens on this game's own media: a row a picture, the video, Copy from another game and Clear all",
        await b.until(ownRows, "box,box3d,logo,shot,fanart,video,copy,clear", 8000), "box,box3d,logo,shot,fanart,video,copy,clear");
      const own = await api("api/art.php?id=" + bare.game.id);
      check("each picture says how it stands, as Change Pictures does, and the video only where its file is",
        await b.ev(`[document.querySelector('#details .md-kind[data-kind="box"] .sv-sub').textContent, document.querySelector("#details .md-video .md-path").textContent, !document.querySelector("#details .md-video video, #details .md-video img")]`),
        ["replaced in Xsegon", own.video.has ? own.video.path : "none", true]);
      if (own.video.has) {
        await b.ev(`document.querySelector("#details .md-video").click()`);
        check("a press on the video asks before clearing it", await b.until(`(document.querySelector(".confirm h2") || {}).textContent || ""`, "Clear the video of " + own.title + "?", 4000), "Clear the video of " + own.title + "?");
        await b.ev(`[...document.querySelectorAll(".confirm-bar button")].find(x => x.textContent === "Cancel").click()`);
        check("and Cancel keeps it", (await api("api/art.php?id=" + bare.game.id)).video.has, true);
      }
      await b.ev(`document.querySelector('#details .md-kind[data-kind="box"]').click()`);
      const menuNow = `[...document.querySelectorAll(".ctx .ctx-item")].map(n => n.querySelector(".ctx-label").textContent).join("|")`;
      const wantMenu = ["Replace..."].concat(await b.ev(`!!(window.XSEGON && window.XSEGON.gamesdb)`) ? ["Find online..."] : [], ["Remove"]).join("|");
      check("a press on a picture opens the buttons Change Pictures has for it", await b.until(menuNow, wantMenu, 4000), wantMenu);
      await b.ev(`(async () => (await import("/js/menus.js")).closeGameMenu())()`);
      await b.until(`!document.querySelector(".ctx")`, true, 4000);
      if (await b.ev(`!!(window.XSEGON && window.XSEGON.gamesdb)`)) {
        // Find online in the tab: its presses are the tab's list, so Enter picks there and never plays (roadmap AR13).
        await b.ev(`document.querySelector("#details .dtab-pane").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
        await b.ev(`document.querySelector('#details .md-kind[data-kind="box"]').click()`);
        await b.until(`!!document.querySelector(".ctx")`, true, 4000);
        await b.ev(`[...document.querySelectorAll(".ctx .ctx-item")].find(n => n.querySelector(".ctx-label").textContent === "Find online...").click()`);
        await b.until(`!!document.querySelector("#details .pk .pk-head button")`, true, 8000);
        await b.ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
        check("Find online in the tab: Enter presses its Back, not Play",
          await b.until(`!document.getElementById("details").hidden && !document.querySelector("#details .pk") && !!document.querySelector('#details .md-own .md-kind[data-kind="box"]')`, true, 6000), true);
      }
      await b.ev(`document.querySelector("#details .md-copy").click()`);
      check("Copy from another game opens the games, with a find box and a way back",
        await b.until(`document.querySelectorAll("#details .md-game").length > ${at} && !!document.querySelector("#details .md-tab .ch-find input") && !!document.querySelector("#details .md-home")`, true, 8000), true);
      await b.ev(`document.querySelectorAll("#details .md-game")[${at}].click()`);
      const kindsShown = `[...document.querySelectorAll("#details .md-kinds .cr-row")].map(n => n.dataset.kind || (n.className.match(/md-(back|all)/) || [])[1]).join(",")`;
      check("a game pressed shows Back, Copy all, and a row a kind", await b.until(kindsShown, "back,all,box,box3d,logo,shot,fanart,video", 8000), "back,all,box,box3d,logo,shot,fanart,video");
      check("the copied box art reads as the same", await b.ev(`document.querySelector('#details .md-kind[data-kind="box"]').classList.contains("on")`), true);
      const other = list.games.findIndex((x) => x.id !== donor.id && x.has.includes("box"));
      if (other >= 0) {
        await b.ev(`document.querySelector("#details .md-back").click()`);
        await b.until(`document.querySelectorAll("#details .md-game").length > ${other}`, true, 8000);
        await b.ev(`document.querySelectorAll("#details .md-game")[${other}].click()`);
        await b.until(`!!document.querySelector('#details .md-kind[data-kind="box"]')`, true, 8000);
        if (await b.ev(`!document.querySelector('#details .md-kind[data-kind="box"]').classList.contains("on")`)) {
          await b.ev(`document.querySelector('#details .md-kind[data-kind="box"]').click()`);
          const asked = `(w => w ? [w.querySelector("h2").textContent, w.querySelectorAll(".md-pair .md-shot").length] : null)(document.querySelector(".confirm"))`;
          check("a copy that would replace a picture asks first, showing both", await b.until(asked, ["This replaces its box art", 2], 4000), ["This replaces its box art", 2]);
          await b.ev(`[...document.querySelectorAll(".confirm-bar button")].find(x => x.textContent === "Cancel").click()`);
          check("and Cancel copies nothing", boxRow(await cm(q)).same, true);
        }
      }
      // Back through the games to this game's own media, and a picture's button pressed there.
      await b.ev(`document.querySelector("#details .md-back").click()`);
      await b.until(`!!document.querySelector("#details .md-home")`, true, 8000);
      await b.ev(`document.querySelector("#details .md-home").click()`);
      await b.until(`!!document.querySelector('#details .md-own .md-kind[data-kind="box"]')`, true, 8000);
      await b.ev(`document.querySelector('#details .md-kind[data-kind="box"]').click()`);
      await b.until(`!!document.querySelector(".ctx")`, true, 4000);
      await b.ev(`[...document.querySelectorAll(".ctx .ctx-item")].find(n => n.querySelector(".ctx-label").textContent === "Remove").click()`);
      check("Remove there takes the copied box art away, and the row says so",
        [await b.until(`(document.querySelector('#details .md-kind[data-kind="box"] .sv-sub') || {}).textContent`, "no image", 8000),
         (await api("api/art.php?id=" + bare.game.id)).kinds.box.replaced], ["no image", false]);
      // Details' cover follows, both ways, with no broken picture between (roadmap AR14).
      const coverIs = `document.querySelector("#details .dleft img.cover") ? "cover" : document.querySelector("#details .dleft .cover-noart.can-add") ? "NO ART" : "none"`;
      check("and the cover beside it is NO ART again, not a broken picture", await b.until(coverIs, "NO ART", 6000), "NO ART");
      await b.ev(`document.querySelector("#details .md-copy").click()`);
      await b.until(`document.querySelectorAll("#details .md-game").length > ${at}`, true, 8000);
      await b.ev(`document.querySelectorAll("#details .md-game")[${at}].click()`);
      await b.until(`!!document.querySelector('#details .md-kind[data-kind="box"]')`, true, 8000);
      await b.ev(`document.querySelector('#details .md-kind[data-kind="box"]').click()`);
      check("a box art copied in then stands where NO ART was", await b.until(coverIs, "cover", 8000), "cover");
      await b.ev(`(async () => (await import("/js/details.js")).closeDetails())()`);
    }
  } finally {
    // What the Media checks copied, taken away again before the game goes.
    for (const k of ["box", "box3d", "logo", "shot", "fanart"]) { await api("api/art.php?id=" + bare.game.id + "&kind=" + k + "&reset=1", null, "POST"); }
    await api("api/video-own.php?id=" + bare.game.id + "&reset=1", null, "POST");
    await api("api/local.php", { id: bare.game.id, remove: true }, "POST");
  }

  /* ---- Clear video, and Clear all in Change Pictures (roadmap AN6) ----
     On a game made here alone: Clear deletes files, and the test copy's data\media is the real folder. */
  const wiped = await api("api/local.php", { set: { title: "Xsclear Scratch", platform: "Nintendo 64", url: BASE + "/" } }, "POST");
  const cq = "?id=" + encodeURIComponent(wiped.game.id);
  try {
    const mp4 = Buffer.concat([Buffer.from("00000018667479706d703432", "hex"), Buffer.alloc(8192)]);
    check("a video of its own goes in", (await send("/api/video-own.php" + cq + "&part=0&of=1", mp4)).ok, true);
    const had = await api("api/video-own.php" + cq);
    check("the video window says where it comes from and what Clear video deletes", [had.has, had.from, had.files, had.shared], [true, "own", 1, []]);
    const gone = await send("/api/video-own.php" + cq + "&clear=1", null);
    check("Clear video deletes it", [gone.ok, gone.gone, (await api("api/video-own.php" + cq)).has], [true, 1, false]);

    // A media folder a settings file names outside Xsegon's data folder (paths.mediaDir) is never deleted in.
    const mediaWas = (await api("api/settings.php")).settings.paths.mediaDir;
    const outside = pathx.join(require("os").tmpdir(), "xs-media-outside-" + process.pid);
    const outVideo = pathx.join(outside, "Nintendo 64", wiped.game.id + "-video.mp4");
    fsx.mkdirSync(pathx.dirname(outVideo), { recursive: true });
    fsx.writeFileSync(outVideo, mp4);
    try {
      await api("api/settings.php", { paths: { mediaDir: outside } });
      const fromOut = await api("api/video-own.php" + cq);
      const kept = await send("/api/video-own.php" + cq + "&clear=1", null);
      check("a video in a media folder outside Xsegon's data folder is never deleted: Clear video says why, and the file stays",
        [fromOut.from, kept.ok, /outside Xsegon's own data folder/.test(kept.error || ""), fsx.existsSync(outVideo)], ["media", false, true, true]);
    } finally {
      await api("api/settings.php", { paths: { mediaDir: mediaWas } });
      fsx.rmSync(outside, { recursive: true, force: true });
    }

    check("a box art and a video go in again",
      [(await send("/api/art.php" + cq + "&kind=box&part=0&of=1", png)).ok, (await send("/api/video-own.php" + cq + "&part=0&of=1", mp4)).ok], [true, true]);
    const pics = await api("api/art.php" + cq);
    check("Change Pictures has the video too, for Clear all", [pics.kinds.box.replaced, pics.video.has, pics.video.files], [true, true, 1]);

    await b.goto();
    await b.openPlatform("Nintendo 64");
    const open = (fn) => `(async () => { const S = await import("/js/state.js"), A = await import("/js/art-editors.js");
      const g = S.games.find(x => x.id === ${JSON.stringify(wiped.game.id)}); if (!g) { return false; } A.${fn}(g); return true; })()`;
    const title = `(document.querySelector("#editor .panel-title") || {}).textContent`;
    const asked = `(w => w ? [w.querySelector("h2").textContent, w.textContent] : null)(document.querySelector(".confirm"))`;
    const press = (label) => b.ev(`[...document.querySelectorAll(".confirm-bar button")].find(x => x.textContent === ${JSON.stringify(label)}).click()`);
    check("the scratch game is on the shelf, and Change Pictures opens on it", [await b.ev(open("openArtEditor")), await b.until(title, "CHANGE PICTURES", 6000)], [true, "CHANGE PICTURES"]);
    const clearAll = `[...document.querySelectorAll("#editor .art-clear button")].find(x => x.textContent === "Clear all...")`;
    check("it has Clear all", await b.until(`!!${clearAll}`, true, 6000), true);
    await b.ev(clearAll + ".click()");
    await b.until(`!!document.querySelector(".confirm")`, true, 4000);
    const words = await b.ev(asked);
    check("which asks first, saying what is deleted",
      [words[0], /1 picture stored in Xsegon is deleted\./.test(words[1]), /The video is deleted: /.test(words[1]), /may fetch a new one/.test(words[1])],
      ["Clear all of Xsclear Scratch?", true, true, true]);
    await press("Cancel");
    check("Cancel clears nothing", [(await api("api/art.php" + cq)).kinds.box.replaced, (await api("api/video-own.php" + cq)).has], [true, true]);
    await b.ev(clearAll + ".click()");
    await b.until(`!!document.querySelector(".confirm")`, true, 4000);
    await press("Clear all");
    check("Clear all leaves every slot with no image, and no Clear all to press",
      await b.until(`[...document.querySelectorAll("#editor .art-slot .art-state")].every(n => n.textContent === "no image") && !document.querySelector("#editor .art-clear")`, true, 6000), true);
    const after = await api("api/art.php" + cq);
    check("the box art and the video are deleted", [after.kinds.box.replaced, after.kinds.box.has, after.video.has], [false, false, false]);
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`, true, 6000);

    check("a video goes in once more", (await send("/api/video-own.php" + cq + "&part=0&of=1", mp4)).ok, true);
    check("the video window opens on it", [await b.ev(open("openVideoEditor")), await b.until(title, "REPLACE VIDEO", 6000)], [true, "REPLACE VIDEO"]);
    const wipe = `[...document.querySelectorAll("#editor .art-btns button")].find(x => x.textContent === "Clear video...")`;
    check("with Clear video beside Replace", await b.until(`!!${wipe}`, true, 6000), true);
    await b.ev(wipe + ".click()");
    await b.until(`!!document.querySelector(".confirm")`, true, 4000);
    check("which asks first, naming the file", (await b.ev(asked))[0], "Clear the video of Xsclear Scratch?");
    await press("Clear video");
    check("and leaves the game with no video", await b.until(`(document.querySelector("#editor .art-state") || {}).textContent`, "this game has no video yet", 6000), "this game has no video yet");
    check("the server says so too", (await api("api/video-own.php" + cq)).has, false);
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`, true, 6000);
  } finally {
    await send("/api/art.php" + cq + "&kind=box&reset=1", null);
    await send("/api/video-own.php" + cq + "&reset=1", null);
    await api("api/local.php", { id: wiped.game.id, remove: true }, "POST");
  }
};
