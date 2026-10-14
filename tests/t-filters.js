/* Filter by: the funnel at the right end of the search box opens a window of
 * its own (js\filterwin.js): sections that fold, a row to each filter, what is
 * on along the top. The filters stack and narrow whatever is open.
 *
 *   - one rule each: over every game a filter is exactly its collection, and
 *     over a console exactly the number the consoles screen shows for it;
 *   - Ready to play means can start NOW, so with the ROM drive out it leaves
 *     that drive's games out even though the file sweep stands down;
 *   - every way in: 2 and F (in the window too), View > Filter by..., and the
 *     console's own menu on the consoles screen (the pad's Y);
 *   - Esc from inside comes back to the console you were in, although the
 *     filter changed which consoles are on the rim;
 *   - it is not kept: a fresh start shows every game.
 *
 * Nothing is written by the filters themselves. The view the checks change
 * on the way is in settings.json, which the Guard puts back.
 */
"use strict";
const { api, sleep, FILTERS_UP } = require("./lib");

// The rows in the order the window shows them, the left column and then the right.
const NAMES = ["Favourites only", "Two players or more", "Never played", "Cheats on", "Your rating at least", "Not rated by you",
               "Ready to play", "Missing art", "Has a manual", "Hacks"];
const HEADS = ["Play", "Ratings", "Files and pictures", "Hacks", "Your tags"];

module.exports = async function (b, check) {
  /* ---- the server: one rule each, and they stack ------------------------ */
  const all = await api("api/library.php?grouped=0");
  const coll = (k) => all.collections.find((c) => c.key === k);
  check("with no filter on, the answer says so", all.filtered, null);
  check("and every game comes back", all.count, all.total);

  const two = await api("api/library.php?players=1&grouped=0");
  const seats = two.filtered.platforms;
  const names = Object.keys(seats);
  const sum = (o) => Object.values(o).reduce((a, n) => a + n, 0);
  check("Two players or more over every game is the collection", two.count, coll("@players").count);
  check("its counts per console add up to it", sum(seats), two.count);
  check("and never say more than a console holds", names.every((k) => all.platforms[k] >= seats[k]));
  check("it lets in nothing that says one player", !two.games.some((g) => g.players === 1));
  const unplayed = await api("api/library.php?unplayed=1&grouped=0");
  check("Never played over every game is its collection", unplayed.count, coll("@unplayed").count);
  // Not rated by you: one game is given stars for it, and put back.
  const starred = all.games.find((g) => !g.myRating);
  await api("api/my-rating.php", { id: starred.id, stars: 3 });
  const unrated = await api("api/library.php?unrated=1&grouped=0");
  check("Not rated by you lets in only the games with no stars of yours",
        [unrated.count > 0 && unrated.count < all.count, unrated.games.every((g) => !g.myRating), unrated.games.some((g) => g.id === starred.id)], [true, true, false]);
  await api("api/my-rating.php", { id: starred.id, stars: 0 });
  const favs = coll("@favourites");
  if (favs) {
    check("Favourites only over every game is the favourites", (await api("api/library.php?fav=1&grouped=0")).count, favs.count);
    const both = await api("api/library.php?players=1&fav=1&grouped=0");
    check("two filters stack: favourites for two", both.count, two.filtered.collections["@favourites"]);
    check("and every one of them is both", both.games.every((g) => g.favourite && g.players !== 1));
  }
  const ready = await api("api/library.php?ready=1&grouped=0");
  const playable = all.games.filter((g) => g.playable).length;
  check("Ready to play lets in only games that can launch", ready.games.every((g) => g.playable));
  const status = await api("api/status.php");
  if (status.checks && status.checks.romRoot && status.checks.romRoot.present === false) {
    check("with the ROM drive out, it leaves that drive's games out", ready.count < playable);
  } else {
    check("with the ROM drive in, it is every game that can launch", ready.count, playable);
  }
  // The list's Ready column reads this off each row, so it must be the filter's own answer.
  const ids = (list) => list.map((g) => g.id).sort().join();
  check("every row says whether it is ready, and those that say yes are exactly what the filter lets in",
        [all.games.every((g) => typeof g.ready === "boolean"), ids(all.games.filter((g) => g.ready)) === ids(ready.games)], [true, true]);

  /* Missing art: the games whose own row says a picture or the video is not
     there, asked with every file its own row since a card wears one version's
     pictures. A rule, never a number: the test copy leaves Xsegon's own videos out. */
  const lacksArt = (g) => !(g.hasArt && g.hasBox3d && g.hasLogo && g.hasShot && g.hasFanart && g.hasVideo);
  const files = await api("api/library.php?versions=all&grouped=0");
  const gapFiles = await api("api/library.php?missing=1&versions=all&grouped=0");
  check("Missing art lets in exactly the games whose own row says something is not there",
        [gapFiles.count > 0, gapFiles.games.every(lacksArt), ids(gapFiles.games) === ids(files.games.filter(lacksArt))], [true, true, true]);
  const gaps = await api("api/library.php?missing=1&grouped=0");
  check("as cards, every one it shows has something missing, and its counts per console add up to it",
        [gaps.games.every(lacksArt), sum(gaps.filtered.platforms)], [true, gaps.count]);
  const gapsForTwo = await api("api/library.php?missing=1&players=1&grouped=0");
  check("and it stacks: missing art, for two", [gapsForTwo.games.every((g) => lacksArt(g) && g.players !== 1), gapsForTwo.count <= Math.min(gaps.count, two.count)], [true, true]);

  /* Has a manual, Cheats on, Hacks only and Leave hacks out: each lets in
     exactly the games whose own row says so. Rules, never numbers. */
  for (const [q, name, says] of [["docs", "Has a manual", (g) => g.docs === true], ["cheats", "Cheats on", (g) => g.cheats > 0],
                                 ["hacks", "Hacks only", (g) => g.hack === "yes"], ["nohacks", "Leave hacks out", (g) => g.hack !== "yes"]]) {
    const got = await api("api/library.php?" + q + "=1&versions=all&grouped=0");
    check(name + " lets in exactly the games whose own row says so, and the answer says a filter is on",
          [ids(got.games) === ids(files.games.filter(says)), got.filtered !== null], [true, true]);
  }
  check("Hacks only and Leave hacks out together let nothing in", (await api("api/library.php?hacks=1&nohacks=1&versions=all&grouped=0")).count, 0);
  const manualsForTwo = await api("api/library.php?docs=1&players=1&versions=all&grouped=0");
  check("and they stack with the others: has a manual, for two", manualsForTwo.games.every((g) => g.docs && g.players !== 1), true);

  // The console with the most for two, and one with none if this library has one.
  const busiest = names.slice().sort((x, y) => seats[y] - seats[x])[0];
  const solo = Object.keys(all.platforms).find((k) => !seats[k]) || null;
  const one = await api("api/library.php?players=1&grouped=0&platform=" + encodeURIComponent(busiest));
  check("over a console, it is the number the consoles screen shows", one.count, seats[busiest]);
  check("and every row is that console's", one.games.every((g) => g.platform === busiest));
  const bothHere = favs ? (await api("api/library.php?players=1&fav=1&grouped=0&platform=" + encodeURIComponent(busiest))).count : 0;

  /* Your rating at least, the one filter with a value. Three of that console's
     games for two are given stars: the page walks the same three further down,
     and they are put back there. */
  const starred3 = one.games.filter((g) => !g.myRating).slice(0, 3);
  for (const [i, g] of starred3.entries()) { await api("api/my-rating.php", { id: g.id, stars: [2, 4, 5][i] }); }
  const rated = (await api("api/library.php?versions=all&grouped=0")).games;
  for (const stars of [1, 4, 5]) {
    const got = await api("api/library.php?myrating=" + stars + "&versions=all&grouped=0");
    check("your rating at least " + stars + " lets in exactly the games you gave that many stars or more",
          [got.count > 0, got.games.every((g) => g.myRating >= stars), ids(got.games) === ids(rated.filter((g) => g.myRating >= stars))], [true, true, true]);
  }
  check("a number that is no rating is taken as the nearest one, and none at all asks for nothing",
        [(await api("api/library.php?myrating=9&grouped=0")).games.every((g) => g.myRating === 5), (await api("api/library.php?myrating=0&grouped=0")).filtered], [true, null]);
  check("it stacks, and the consoles are counted under it", await api("api/library.php?myrating=4&players=1&grouped=0").then((r) => [r.games.every((g) => g.myRating >= 4 && g.players !== 1), sum(r.filtered.platforms)]), [true, (await api("api/library.php?myrating=4&players=1&grouped=0")).count]);

  /* ---- the funnel and its window, inside a console ---------------------- */
  await b.goto();
  const funnelLit = `document.getElementById("btn-filter").classList.contains("on")`;
  const funnelN = `document.querySelector("#btn-filter .qf-n").textContent`;
  const funnelSays = `document.getElementById("btn-filter").title`;
  const wheelItems = `document.querySelectorAll("#view .witem").length`;
  const labels = `[...document.querySelectorAll(".ctx-item .ctx-label")].map(n => n.textContent)`;       // a menu's entries
  // The window: something read off it, whether a row is on, what its top line says.
  const fw = (js) => `(w => ${js})(document.querySelector("#editor .flt-inner"))`;
  const shut = `document.getElementById("editor").hidden`;
  const rowNames = fw(`[...w.querySelectorAll(".opt")].map(n => n.querySelector("label").firstChild.textContent)`);
  const isOn = (key) => fw(`w.querySelector('.opt[data-key="${key}"]').getAttribute("aria-checked") === "true"`);
  const words = fw(`w.querySelector(".flt-now-w").textContent`);
  const clearUp = fw(`!w.querySelector(".set-head button").hidden`);
  const lit = fw(`[...w.querySelectorAll(".flt-star")].filter(s => !s.classList.contains("off")).length`);
  const hackSaid = fw(`[...w.querySelectorAll(".flt-ans.on")].map(n => n.textContent).join("|")`);
  await b.openPlatform(busiest);
  check("the Faves and 2+ Players buttons are gone from the bar",
        await b.ev(`!document.getElementById("btn-fav") && !document.getElementById("btn-players")`));
  check("the funnel sits inside the search box, at its right end", await b.ev(`(() => {
    const q = document.getElementById("q").getBoundingClientRect(), f = document.getElementById("btn-filter").getBoundingClientRect();
    return f.left > q.left && f.right <= q.right + 1 && q.right - f.right < 8 && f.top >= q.top - 1 && f.bottom <= q.bottom + 1; })()`));
  check("and is not lit with nothing on", await b.ev(funnelLit), false);
  const xUp = `!document.getElementById("btn-filter-clear").hidden`;
  check("nor is there an x on it to clear filters, with none to clear", await b.ev(xUp), false);
  await b.openFilters();
  check("it opens the Filter by window", await b.ev(FILTERS_UP));
  check("in five sections, each under a heading that folds", await b.ev(fw(`[...w.querySelectorAll(".set-sect")].map(s => (s.querySelector(":scope > .sect-head .sect-name") || {}).textContent)`)), HEADS);
  check("a row to each filter, in order, its name and no line of words under it", [await b.ev(rowNames), await b.ev(fw(`w.querySelectorAll(".hint").length`))], [NAMES, 0]);
  check("two columns side by side, the whole window on the screen, and nothing in it scrolls", await b.ev(fw(`(() => {
    const c = [...w.querySelectorAll(".flt-col")].map(x => x.getBoundingClientRect()), r = w.getBoundingClientRect(), body = w.querySelector(".flt-cols");
    return [c.length, c[1].left > c[0].right, r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, body.scrollHeight <= body.clientHeight + 1]; })()`)), [2, true, true, true]);
  check("F and 2 shown as their keys", await b.ev(fw(`["fav", "players"].map(k => (w.querySelector('.opt[data-key="' + k + '"] .flt-keys') || {}).textContent)`)), ["F", "2"]);
  check("with nothing on: the top says so, no Clear, Hacks on All, no star lit, and the count the list has",
        [await b.ev(words), await b.ev(clearUp), await b.ev(hackSaid), await b.ev(lit), await b.until(fw(`w.querySelector(".flt-now-n").textContent`), (await b.ev(`document.getElementById("count").textContent`)) + " games")],
        ["nothing", false, "All", 0, (await b.ev(`document.getElementById("count").textContent`)) + " games"]);
  // Your tags: small buttons, six at most and never more than two lines of them; a button after them opens the rest.
  check("your tags as buttons, six at most on no more than two lines, with a button for the rest where there are more",
        await b.ev(fw(`(() => { const t = w.querySelectorAll(".flt-tags .flt-tag[data-tag]"), more = w.querySelector(".flt-more");
          return [t.length <= 6, new Set([...w.querySelectorAll(".flt-tags > *")].map(n => n.offsetTop)).size <= 2, t.length + (more ? parseInt(more.textContent, 10) : 0)]; })()`)), [true, true, all.tags.length]);
  await b.filterRow("Two players or more");
  await b.waitFor(`${wheelItems} === ${seats[busiest]}`, 6000);
  check("a press on a row narrows the console to its games for two", await b.ev(wheelItems), seats[busiest]);
  check("and the window stays up, that row on and named at the top", [await b.ev(FILTERS_UP), await b.ev(isOn("players")), await b.ev(words)], [true, true, "2+ players"]);
  check("the funnel is lit, with how many are on", await b.ev(funnelLit) && await b.ev(funnelN), "1");
  check("and the window now offers to clear them", await b.ev(clearUp));
  check("its count follows the list's own", await b.until(fw(`w.querySelector(".flt-now-n").textContent`), (await b.ev(`document.getElementById("count").textContent`)) + " games"),
        (await b.ev(`document.getElementById("count").textContent`)) + " games");
  if (favs) {
    await b.filterRow("Favourites only");
    await b.waitFor(`${wheelItems} === ${bothHere} || (${bothHere} === 0 && !!document.querySelector("#view .empty"))`, 6000);
    check("a second one stacks: favourites for two, here", bothHere ? await b.ev(wheelItems) : 0, bothHere);
    check("the funnel says 2", await b.ev(funnelN), "2");
  }
  // A heading folds its section; folded, it says how many of its filters are on.
  await b.ev(fw(`w.querySelector(".sect-head").click()`));
  check("a press on Play's heading folds it away, saying how many of its filters are on",
        [await b.ev(fw(`w.querySelector(".set-sect").classList.contains("shut")`)), await b.ev(fw(`w.querySelector(".sect-count").textContent`)), (await b.ev(rowNames)).includes("Favourites only") && await b.ev(fw(`w.querySelector('.opt[data-key="fav"]').getClientRects().length > 0`))],
        [true, (favs ? 2 : 1) + " on", false]);
  await b.ev(fw(`w.querySelector(".sect-head").click()`));
  check("and a second press opens it", await b.ev(fw(`w.querySelector('.opt[data-key="fav"]').getClientRects().length > 0`)));
  await b.ev(fw(`w.querySelector(".set-head button").click()`));
  await b.waitFor(`${wheelItems} === ${all.platforms[busiest]}`, 6000);
  check("Clear all filters puts every one of its games back", await b.ev(wheelItems), all.platforms[busiest]);
  check("the funnel goes out, and the x on its corner with it", [await b.ev(funnelLit), await b.ev(xUp)], [false, false]);
  check("and the window is still up, without the Clear", [await b.ev(FILTERS_UP), await b.ev(clearUp), await b.ev(words)], [true, false, "nothing"]);
  /* The keys: the arrows walk the rows by where they stand, Enter presses
     the row they are on, and F and 2 are their filters' keys here as in the
     list. Nothing is lit until a key is pressed. */
  const standsOn = `(n => !n || !n.closest(".flt-inner") ? "" : n.matches(".opt") ? n.querySelector("label").firstChild.textContent : n.matches(".sect-head") ? "heading: " + n.querySelector(".sect-name").textContent : n.textContent.trim())(document.activeElement)`;
  check("nothing in the window has the keys until one is pressed", await b.ev(standsOn), "");
  await b.key("ArrowDown"); await b.key("ArrowDown");
  check("Down twice: the first heading, then the first row", await b.ev(standsOn), "Favourites only");
  await b.key("ArrowRight");
  check("Right goes to the row beside it in the other column", await b.ev(standsOn), "Ready to play");
  await b.key("ArrowLeft"); await b.key("ArrowDown");
  check("Left and then Down: back a column, and down a row", await b.ev(standsOn), "Two players or more");
  await b.key("Enter");
  await b.waitFor(`${wheelItems} === ${seats[busiest]}`, 6000);
  check("Enter turns that row on", [await b.ev(isOn("players")), await b.ev(wheelItems)], [true, seats[busiest]]);
  await b.key("2");
  await b.waitFor(`${wheelItems} === ${all.platforms[busiest]}`, 6000);
  check("and 2, its own key, takes it off again from inside the window", [await b.ev(isOn("players")), await b.ev(funnelLit)], [false, false]);
  await b.key("Escape");
  check("Esc closes the window", await b.waitFor(shut, 3000));
  await sleep(150);

  /* ---- the keys, and the dropdown's numbers ----------------------------- */
  const option = (name) => `[...document.getElementById("platform").options].find(o => o.value === ${JSON.stringify(name)})`;
  await b.key("2");
  await b.waitFor(`${wheelItems} === ${seats[busiest]}`, 6000);
  check("2 is Two players or more", await b.ev(wheelItems), seats[busiest]);
  check("the dropdown gives the same numbers", await b.ev(`${option(busiest)}.textContent.includes("(${seats[busiest]})")`));
  if (solo) { check("and a console with none cannot be picked there", await b.ev(`${option(solo)}.disabled`)); }
  check("the legend's 2 says it will show them all", await b.ev(`(h => h ? h.querySelector(".hl").textContent : "")([...document.querySelectorAll("#help .hitem")].find(h => h.querySelector(".hk").textContent === "2"))`), "show all");
  await b.key("2");
  await b.waitFor(`${wheelItems} === ${all.platforms[busiest]}`, 6000);
  check("2 again puts them back, and the dropdown's whole numbers", await b.ev(`${option(busiest)}.textContent.includes("(${all.platforms[busiest]})")`));

  /* ---- list and grid: the funnel is there too, and View has the list ---- */
  const tiles = `document.querySelectorAll("#view .tile").length`;
  await b.setView("grid");
  check("in the grid the funnel is on the bar", await b.ev(`!!document.getElementById("btn-filter").offsetParent`));
  await b.openBar("view");
  check("View has Filter by...", (await b.ev(labels)).includes("Filter by..."));
  await b.menuItem(/^Filter by\.\.\.$/);
  await b.waitFor(FILTERS_UP, 3000);
  await b.filterRow("Two players or more");
  await b.waitFor(`${tiles} === ${seats[busiest]}`, 6000);
  check("which is the same window, and narrows the grid", await b.ev(tiles), seats[busiest]);
  await b.key("Escape");
  await b.waitFor(shut, 3000);
  await b.setView("list");
  check("in the list the funnel is on the bar, still lit", await b.ev(`!!document.getElementById("btn-filter").offsetParent`) && await b.ev(funnelLit));
  check("and the list has only the games for two", await b.ev(`document.querySelectorAll("#view .row").length`), seats[busiest]);
  await b.openBar("view");
  check("View says what is on", await b.ev(`(n => n ? (n.querySelector(".ctx-hint") || {}).textContent : "")([...document.querySelectorAll(".ctx-item")].find(n => n.querySelector(".ctx-label").textContent === "Filter by..."))`), "2+ players");
  await b.key("Escape");

  /* The x on the funnel's corner: there only while a filter is on, small,
     and a press takes the filters off without opening the window. */
  {
    // How many games the list holds, from the bar's count ("12 of 754", or "200 shown of 312" while a long one loads).
    const total = `(t => Number(/shown of/.test(t) ? t.split("shown of")[1] : t.split(" of ")[0]))(document.getElementById("count").textContent)`;
    check("with a filter on, a small x sits on the funnel's top right corner, in front of what is there",
          await b.ev(`(() => { const x = document.getElementById("btn-filter-clear"), r = x.getBoundingClientRect(), f = document.getElementById("btn-filter").getBoundingClientRect();
            const mx = r.left + r.width / 2, my = r.top + r.height / 2;
            return [x.hidden, x.title, r.width >= 10 && r.width <= 16 && r.height >= 10 && r.height <= 16, Math.abs(mx - f.right) <= 2 && Math.abs(my - f.top) <= 2, document.elementFromPoint(mx, my) === x]; })()`),
          [false, "Clear the filters", true, true, true]);
    await b.ev(`document.getElementById("btn-filter-clear").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))`);
    await b.waitFor(`!(${funnelLit}) && ${total} === ${all.platforms[busiest]}`, 6000);
    check("a press on it takes every filter off and brings the games back; the x goes, and the Filter by window stays shut",
          [await b.ev(funnelLit), await b.ev(xUp), await b.ev(total), await b.ev(shut)], [false, false, all.platforms[busiest], true]);
    await b.key("2");                   // on again, for what follows
    await b.waitFor(`${funnelN} === "1" && ${total} === ${seats[busiest]}`, 6000);
  }

  // Missing art, on top of the one that is on: what the page then holds is read game by game.
  {
    const want = (await api("api/library.php?missing=1&players=1&grouped=0&platform=" + encodeURIComponent(busiest))).count;
    const rows = `document.querySelectorAll("#view .row").length`;
    await b.openFilters();
    check("opened again, the window shows what is on", [await b.ev(isOn("players")), await b.ev(words), await b.ev(clearUp)], [true, "2+ players", true]);
    await b.filterRow("Missing art");
    await b.waitFor(`${funnelN} === "2" && ${rows} === ${want}`, 6000);
    check("Missing art on top of it: the list holds only that console's games for two that lack something",
          [await b.ev(rows), await b.ev(`import("/js/state.js").then((S) => S.games.every((g) => g.players !== 1 && !(g.hasArt && g.hasBox3d && g.hasLogo && g.hasShot && g.hasFanart && g.hasVideo)))`)], [want, true]);
    check("and the funnel counts it and names it", [await b.ev(funnelN), await b.ev(funnelSays)],
          ["2", "Filtered: two players or more, missing art. Press to change"]);
    await b.filterRow("Missing art");
    await b.waitFor(`${funnelN} === "1" && ${rows} === ${seats[busiest]}`, 6000);
    check("a second press takes it off again", await b.ev(rows), seats[busiest]);
    await b.key("Escape");
    await b.waitFor(shut, 3000);
    await sleep(150);
  }

  /* Your rating at least: a row of five stars. A press on a star is that many
     and up, the same star again takes it off, a press on the row (Enter, A on
     a pad) steps it up and round to off, and it and Not rated by you let go of
     each other. The three games starred above are in this console. */
  {
    const rows = `document.querySelectorAll("#view .row").length`;
    const star = (k) => fw(`w.querySelectorAll(".flt-star")[${k - 1}].click()`);
    const four = (await api("api/library.php?players=1&myrating=4&grouped=0&platform=" + encodeURIComponent(busiest))).count;
    await b.openFilters();
    check("Your rating at least starts with no star lit", await b.ev(lit), 0);
    await b.ev(star(4));
    await b.waitFor(`${funnelN} === "2" && ${rows} === ${four} && ${lit} === 4`, 6000);
    check("a press on the fourth star keeps only the games you gave four stars or more",
          [four >= 2, await b.ev(lit), await b.ev(rows), await b.ev(`import("/js/state.js").then((S) => S.games.every((g) => g.myRating >= 4))`)], [true, 4, four, true]);
    check("the funnel counts it and names it, and so does the window, still up",
          [await b.ev(funnelSays), await b.ev(FILTERS_UP), await b.ev(words)], ["Filtered: two players or more, your rating 4+. Press to change", true, "2+ players \u00b7 your rating 4+"]);
    await b.filterRow("Your rating at least");
    await b.waitFor(`${lit} === 5`, 6000);
    check("a press on the row steps it up a star", await b.ev(lit), 5);
    await b.ev(fw(`w.querySelector('.opt[data-key="stars"]').focus()`));
    await b.key("Enter");
    await b.waitFor(`${lit} === 0 && ${funnelN} === "1"`, 6000);
    check("and after five it is off again, by Enter with the keys on the row", [await b.ev(lit), await b.ev(funnelN)], [0, "1"]);
    await b.ev(star(3));
    await b.waitFor(`${lit} === 3`, 6000);
    await b.filterRow("Not rated by you");
    await b.waitFor(`${lit} === 0`, 6000);
    check("Not rated by you lets go of it: the two together could only give an empty list",
          [await b.ev(lit), await b.ev(isOn("unrated")), await b.ev(funnelN)], [0, true, "2"]);
    await b.ev(star(1));
    await b.waitFor(`${lit} === 1`, 6000);
    check("and a star lets go of Not rated by you", [await b.ev(isOn("unrated")), await b.ev(funnelN)], [false, "2"]);
    await b.ev(star(1));
    await b.waitFor(`${lit} === 0 && ${funnelN} === "1" && ${rows} === ${seats[busiest]}`, 6000);
    check("the same star again takes it off", [await b.ev(lit), await b.ev(rows)], [0, seats[busiest]]);

    /* Hacks: one row with three answers, since Hacks only and Leave hacks out
       could never both be on. A press on an answer is that one; a press on
       the row steps to the next and round. */
    const answer = (name) => fw(`[...w.querySelectorAll(".flt-ans")].find(n => n.textContent === ${JSON.stringify(name)}).click()`);
    const hacksHere = (await api("api/library.php?players=1&hacks=1&grouped=0&platform=" + encodeURIComponent(busiest))).count;
    await b.ev(answer("Only hacks"));
    await b.waitFor(`${funnelN} === "2" && (${rows} === ${hacksHere} || (${hacksHere} === 0 && !!document.querySelector("#view .empty")))`, 6000);
    check("Hacks > Only hacks: that answer lit alone, the list cut to them, and the funnel naming it",
          [await b.ev(hackSaid), hacksHere ? await b.ev(rows) : 0, await b.ev(funnelSays)], ["Only hacks", hacksHere, "Filtered: two players or more, hacks only. Press to change"]);
    await b.ev(answer("No hacks"));
    await b.waitFor(`${funnelSays} === "Filtered: two players or more, leave hacks out. Press to change" && ${rows} === ${seats[busiest] - hacksHere}`, 6000);
    check("No hacks takes its place, one answer at a time: every game for two but those", [await b.ev(hackSaid), await b.ev(funnelN), await b.ev(rows)], ["No hacks", "2", seats[busiest] - hacksHere]);
    await b.filterRow("Hacks");
    await b.waitFor(`${funnelN} === "1" && ${rows} === ${seats[busiest]}`, 6000);
    check("and a press on the row steps it round to All", [await b.ev(hackSaid), await b.ev(rows)], ["All", seats[busiest]]);
    await b.key("Escape");
    await b.waitFor(shut, 3000);
    await sleep(150);
    for (const g of starred3) { await api("api/my-rating.php", { id: g.id, stars: 0 }); }
  }

  /* ---- the consoles screen ---------------------------------------------- */
  const consoles = `document.querySelectorAll("#syswall .switem:not(.coll)").length`;
  const chosen = `(n => n ? ((n.querySelector("img") || {}).alt || n.textContent) : "")(document.querySelector("#syswall .switem.sel"))`;
  await b.key("Escape");
  await b.waitFor(`!document.getElementById("syswall").hidden && !!document.querySelector("#syswall .switem.sel")`, 5000);
  await sleep(300);
  check("with it on, the consoles screen keeps only the consoles with something for two", await b.ev(consoles), names.length);
  if (solo) { check("so a console with none steps aside", await b.ev(`[...document.querySelectorAll("#syswall .switem")].some(n => ((n.querySelector("img") || {}).alt || n.textContent) === ${JSON.stringify(solo)})`), false); }
  check("and Esc came back to the console you were in", await b.ev(chosen), busiest);
  check("whose number says what it counts",
        await b.waitFor(`/games? \\u00b7 2\\+ players$/.test(document.querySelector(".sysinfo .syscount").textContent)`, 3000));
  await b.key("2");
  await b.waitFor(`${consoles} === ${Object.keys(all.platforms).length}`, 6000);
  check("2 on the consoles screen brings every console back", await b.ev(consoles), Object.keys(all.platforms).length);

  // The pad's way: the console's own menu (Y) has the same list.
  await b.contextMenu("#syswall .switem.sel");
  check("the console's menu offers Filter by..., the pad's way to it", (await b.ev(labels)).includes("Filter by..."));
  await b.menuItem(/^Filter by\.\.\.$/);
  await b.waitFor(FILTERS_UP, 3000);
  check("which opens the same window over the consoles", await b.ev(rowNames), NAMES);
  await b.filterRow("Two players or more");
  await b.waitFor(`${consoles} === ${names.length}`, 6000);
  check("and selecting there narrows the consoles screen", await b.ev(consoles), names.length);
  await b.key("Escape");
  await b.waitFor(shut, 3000);
  await sleep(150);

  /* ---- back to the console you were in, when the rim changed ------------ */
  // Turned on inside, a filter takes consoles off the rim, so the way back
  // must land on the console by name, not on whichever console took its old
  // place in the row. Needs a console after one the filter removes.
  await b.key("2");                     // off again: every console on the rim
  await b.waitFor(`${consoles} === ${Object.keys(all.platforms).length}`, 6000);
  const later = solo ? names.slice().sort().find((k) => k > solo) : null;
  if (later) {
    await b.openPlatform(later);
    await b.key("2");
    await b.waitFor(funnelLit, 6000);
    await b.key("Escape");
    await b.waitFor(`!document.getElementById("syswall").hidden && !!document.querySelector("#syswall .switem.sel")`, 5000);
    await sleep(300);
    check("switched on inside, Esc comes back to the console you were in", await b.ev(chosen), later);
    await b.key("2");
    await b.waitFor(`${consoles} === ${Object.keys(all.platforms).length}`, 6000);
  }

  /* ---- an empty result says which filter, and offers to clear it -------- */
  if (solo) {
    await b.openPlatform(solo);
    await b.key("2");
    await b.waitFor(`!!document.querySelector("#view .empty .empty-clear")`, 6000);
    check("a console with nothing for two says which filter emptied it",
          await b.ev(`(document.querySelector("#view .empty") || {}).textContent || ""`), "nothing here with the filter on: 2+ players Clear filters");
    await b.clickSel("#view .empty .empty-clear");
    await b.waitFor(`!document.querySelector("#view .empty")`, 6000);
    check("and its Clear filters button brings the games back", await b.ev(funnelLit), false);
  }

  /* ---- not kept -------------------------------------------------------- */
  await b.key("f");
  await b.waitFor(funnelLit, 6000);
  check("F is Favourites only", await b.ev(funnelN), "1");
  await b.goto();
  check("a fresh start has no filter on", await b.ev(funnelLit), false);
  check("and every console on the rim", await b.ev(consoles), Object.keys(all.platforms).length);
};
