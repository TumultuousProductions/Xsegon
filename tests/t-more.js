/*  The rest of a long list (js\more.js, api\library.php from and lot).
 *  A list opens on its first lot (Settings > View > Games shown at once) and
 *  the rest is added as it goes. The first lot is set to 100 here: the same
 *  road a list of 40,000 takes past 2,000. Nothing is written but the
 *  settings and one hidden game, which the Guard puts back.
 */
"use strict";
const { api, BASE, Guard, sleep } = require("./lib");

module.exports = async function (b, check) {
  const kept = new Guard(["settings.json", "hidden.json"]);
  const S = (expr) => `import("/js/state.js").then((S) => (${expr}))`;
  const V = (expr) => `import("/js/views.js").then((V) => (${expr}))`;
  const id = (g) => g.id;
  const LOT = 100;
  const Q = "grouped=1&sort=title&reverse=0";
  /* The page's own MORE lines written since a moment (a line's stamp is the
     local time of day), asked for until one fits `re` or the wait is over.
     The page sends its lines in batches, so it is told to send them now. */
  const stamp = () => { const d = new Date(), p = (n, w) => String(n).padStart(w, "0"); return p(d.getHours(), 2) + ":" + p(d.getMinutes(), 2) + ":" + p(d.getSeconds(), 2) + "." + p(d.getMilliseconds(), 3); };
  const moreSince = async (since, re, ms = 5000) => {
    for (const end = Date.now() + ms; ;) {
      try { await b.ev(`import("/js/log.js").then((m) => { m.flushLog(); })`); } catch (e) { /* between two pages */ }
      const got = ((await api("api/log.php?tail=5000")).lines || []).filter((l) => / P MORE /.test(l) && l.slice(0, 12) >= since);
      if (!re || got.some((l) => re.test(l)) || Date.now() > end) { return got; }
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  try {
    await api("api/settings.php", { view: { pageSize: 2000, groupHeaders: true, sort: "title", sortReverse: false } });
    const whole = await api("api/library.php?" + Q);
    const total = whole.count;
    if (total < 3 * LOT || total > 2000) {
      check("(needs a library of 300 to 2,000 games to cut into lots: this one has " + total + ")", true, true);
      return;
    }

    /* ---- the server: any stretch of a list ----------------------------- */
    const first = await api("api/library.php?" + Q + "&from=0&lot=" + LOT);
    const next = await api("api/library.php?" + Q + "&from=" + LOT + "&lot=150");
    const past = await api("api/library.php?" + Q + "&from=" + (total + 50) + "&lot=" + LOT);
    check("the server hands out a list in lots: any stretch of it, in the list's own order, and nothing past its end",
      [first.games.map(id), next.games.map(id), past.games.length, first.count, next.from],
      [whole.games.slice(0, LOT).map(id), whole.games.slice(LOT, LOT + 150).map(id), 0, total, LOT]);
    const byYear = await api("api/library.php?grouped=1&sort=year&reverse=0&from=0&lot=20000");
    check("every lot carries the mark of which list it is, and another order is another list",
      [typeof whole.sig, first.sig === whole.sig, next.sig === whole.sig, byYear.sig === whole.sig], ["string", true, true, false]);
    check("a random order is made new at every read: it carries no mark, so it has no rest to ask for",
      (await api("api/library.php?grouped=0&sort=random")).sig, null);

    /* ---- the page: opens on the first lot, ends with every game ---------- */
    // Every game on one wheel, list or grid: with the consoles first, the wheel would open on the consoles.
    await api("api/settings.php", { view: { default: "list", systemsFirst: false, pageSize: LOT } });
    const t0 = stamp();
    await b.goto(BASE + "/", { keepView: true });
    check("a list longer than its first lot ends with every game in the page",
      await b.until(S(`S.games.length`), total, 20000), total);
    const allIn = new RegExp(" all " + total + " games are in, in [0-9.]+s, \\d+ reads? of the server");
    const said = await moreSince(t0, allIn);
    check("and the log says how it went: the first lot at once, the rest read from the server in lots",
      [said.some((l) => new RegExp(" a list of " + total + ": the first " + LOT + " are in, the rest is added as it goes").test(l)), said.some((l) => allIn.test(l))], [true, true]);
    check("in the server's order, with a node for each game",
      [await b.ev(S(`S.games.map((g) => g.id)`)), await b.ev(V(`V.flatNodes.length`)), await b.ev(`document.querySelectorAll("#view .row").length`)],
      [whole.games.map(id), total, total]);
    /* A header says how many games in the whole list carry its label, as it
       does for a list that came at once: a label can stand in two places
       (titles that begin with a sign sort after Z, under a second "0-9"). */
    const heads = await b.ev(`(() => { const out = []; let cur = null; for (const n of document.querySelectorAll("#view > .ghead, #view > .row")) {
      if (n.classList.contains("ghead")) { cur = { label: n.querySelector(".ghead-name").textContent, says: Number(n.querySelector(".ghead-n").textContent), has: 0 }; out.push(cur); } else if (cur) { cur.has++; } } return out; })()`);
    const carry = {};
    for (const g of whole.games) { carry[g.group] = (carry[g.group] || 0) + 1; }
    check("each header counts every game that carries its label, the ones added later too, and every game stands under one",
      [heads.length > 3, heads.filter((h) => h.says !== carry[h.label]).map((h) => h.label + " says " + h.says), heads.reduce((n, h) => n + h.has, 0)], [true, [], total]);
    check("the bar in the corner says it is done",
      await b.until(`((document.querySelector('#corner-bars [data-job="more"] .fb-line') || {}).textContent || "")`, "Loading the rest of your games: done", 4000),
      "Loading the rest of your games: done");

    /* ---- the person goes first ----------------------------------------- */
    const hold = () => b.ev(`(() => { clearInterval(window.__xsHold); window.__xsHold = setInterval(() => window.dispatchEvent(new Event("pointermove")), 40); window.dispatchEvent(new Event("pointermove")); })()`);
    const letGo = () => b.ev(`clearInterval(window.__xsHold)`);
    const sortBy = (v) => b.ev(`(() => { const s = document.getElementById("sort"); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await hold();
    await sortBy("year");
    await b.until(S(`S.games.length === ${LOT} && S.games[0].id === ${JSON.stringify(byYear.games[0].id)}`), true, 8000);
    await b.key("ArrowDown"); await b.key("ArrowDown"); await b.key("ArrowDown");
    await sleep(700);                     // nothing is to happen: there is nothing to wait for but the time
    check("while the pointer moves nothing is added: the first lot stands, a node for each, and the keys walk it",
      [await b.ev(S(`S.games.length`)), await b.ev(V(`V.flatNodes.length`)), await b.ev(S(`S.sel`)), await b.ev(S(`S.games[S.sel].id`))],
      [LOT, LOT, 3, byYear.games[3].id]);
    await letGo();
    check("left alone, the rest comes in, and the place is kept: the same game chosen, the list in its new order",
      [await b.until(S(`S.games.length`), total, 20000), await b.ev(S(`S.sel`)), await b.ev(S(`S.games[S.sel].id`)),
       await b.ev(`(n => !!n && n.classList.contains("sel"))(document.querySelectorAll("#view .row")[3])`), await b.ev(S(`S.games.map((g) => g.id)`))],
      [total, 3, byYear.games[3].id, true, byYear.games.map(id)]);

    /* ---- a list that changes on the way is read again -------------------- */
    await hold();
    await sortBy("title");
    await b.until(S(`S.games.length === ${LOT} && S.games[0].id === ${JSON.stringify(whole.games[0].id)}`), true, 8000);
    const gone = whole.games[total - 5];
    const t1 = stamp();
    await api("api/hide.php", { id: gone.id, hide: true });
    await letGo();
    const changed = / the list changed while its rest was being added /;
    check("a game hidden while the rest was on its way: the list is read again from the top, and ends without it",
      [await b.until(S(`S.games.length`), total - 1, 25000), await b.ev(S(`S.games.some((g) => g.id === ${JSON.stringify(gone.id)})`)),
       (await moreSince(t1, changed)).some((l) => changed.test(l))], [total - 1, false, true]);
    await api("api/hide.php", { id: gone.id, hide: false });
    await sortBy("title");
    await b.until(S(`S.games.length`), total, 25000);

    /* ---- another view starts from the first lot, and ends whole ----------- */
    const t2 = stamp();
    await b.setView("wheel");
    const plates = await b.until(V(`(V.wheelNodes || []).length`), total, 20000);
    const local = / all \d+ games are in, in [0-9.]+s, with no read of the server/;
    const wheelSaid = await moreSince(t2, local);
    check("the wheel makes its plates for the first lot and gets the rest the same way, with no read of the server",
      [plates, await b.ev(S(`S.games.length`)),
       wheelSaid.some((l) => new RegExp(" the view is drawn again with " + LOT + " games, and " + (total - LOT) + " go back ").test(l)),
       wheelSaid.some((l) => local.test(l))], [total, total, true, true]);
    await b.setView("grid");
    check("the grid ends with a tile for every game", [await b.until(`document.querySelectorAll("#view .tile").length`, total, 25000), await b.ev(S(`S.games.length`))], [total, total]);
    await b.setView("carousel");
    check("the carousel ends with a card for every game", await b.until(V(`(V.carNodes || []).length`), total, 20000), total);
    await b.setView("rows");
    check("the rows view draws its rows again once all are in: every game is in a row",
      await b.until(`new Set([...document.querySelectorAll("#view .rcard")].map((n) => n.dataset.id)).size`, total, 25000), total);

    /* ---- a random order says how many it shows --------------------------- */
    await b.setView("list");
    await sortBy("random");
    check("a random order has no rest: the first lot is shown, and the count says so",
      [await b.until(`document.getElementById("count").textContent`, LOT + " shown of " + total, 8000), await b.ev(S(`S.games.length`))],
      [LOT + " shown of " + total, LOT]);
    const tLast = stamp();
    await sortBy("title");
    await b.until(S(`S.games.length`), total, 20000);
    // Its last line is waited for in the log itself: the page writes it a moment after the last game is in,
    // and a late line would be counted against the next part.
    await moreSince(tLast, allIn, 8000);

    /* ---- a list no longer than its first lot is not touched --------------- */
    await api("api/settings.php", { view: { pageSize: 2000 } });
    /* The copy kept from the last opening (js\bootcopy.js) is the first 100 of
       this list, and drawn at once it rightly starts on its rest, a MORE line
       that is no fault. The check is about a short list, so nothing is kept. */
    await b.ev(`caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))`);
    await sleep(60);                      // the stamp below is after the last line of the page that is leaving
    const t3 = stamp();
    await b.goto(BASE + "/", { keepView: true });
    await b.until(S(`S.games.length`), total, 10000);
    await b.setView("grid");
    await b.setView("wheel");
    await sleep(400);                     // nothing is to happen: there is nothing to wait for but the time
    check("with the first lot back at 2,000 the whole list comes at once, and nothing is cut, asked for or added later",
      [await b.ev(S(`S.games.length`)), (await moreSince(t3, null)).length, await b.ev(`(document.querySelector('#corner-bars [data-job="more"]') || { hidden: true }).hidden`)],
      [total, 0, true]);
  } finally {
    try { await b.ev(`clearInterval(window.__xsHold)`); } catch (e) { /* no page */ }
    kept.restore();
  }
};
