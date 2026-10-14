// The log: the page writes what it does, the server writes what it did,
// errors land at once, and the viewer shows it.
"use strict";
const { sleep, api } = require("./lib");

module.exports = async function (b, check) {
  const mark = "XSTEST-" + Date.now();
  await b.goto();
  await b.setView("grid");
  await b.openPlatform("Nintendo 64");
  await b.key("ArrowRight"); await b.settled();
  await b.clickSel("#btn-contrast"); await b.until(`document.body.classList.contains("high-contrast")`, true);
  await b.clickSel("#btn-contrast"); await b.until(`document.body.classList.contains("high-contrast")`, false);
  await b.contextMenu("#view .tile.sel");
  await b.menuItem(/Details/); await b.until(`!document.getElementById("details").hidden`); await b.settled();
  await b.key("Escape"); await b.until(`document.getElementById("details").hidden`);
  // a deliberate page error, and a deliberate failed request
  await b.ev(`setTimeout(function () { throw new Error(${JSON.stringify(mark)}); }, 0)`);
  await b.ev(`fetch("api/hide.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "nope", hide: true }) })`);
  /* The fault is sent at once with every line queued before it, so the log
     is read as soon as both it and the refused request are in. */
  let tail = { ok: false, lines: [] };
  for (const end = Date.now() + 6000; Date.now() < end;) {
    tail = await api("api/log.php?tail=400");
    const all = (tail.lines || []).join("\n");
    if (all.indexOf(mark) >= 0 && / S REQ\s+POST \/api\/hide\.php/.test(all)) { break; }
    await new Promise((r) => setTimeout(r, 80));
  }
  check("log endpoint answers", tail.ok && Array.isArray(tail.lines));
  const lines = tail.lines;
  const has = (re) => lines.some((l) => re.test(l));
  check("every line is stamped", lines.every((l) => /^\d\d:\d\d:\d\d\.\d{3} [PS] [A-Z]{2,4}\s/.test(l)));
  check("BOOT logged", has(/ P BOOT page /));
  check("and it names the browser with its version, the screen and its scale", has(/ P BOOT page .* browser=\S.* \d+ screen=\d+x\d+ scale=\d+%/));
  check("NAV: opening a platform", has(/ P NAV\s+open Nintendo 64 as grid/));
  check("KEY: a key with where it landed", has(/ P KEY\s+ArrowRight grid \d+\/\d+/));
  check("SEL: the game rested on", has(/ P SEL\s+\d+\/\d+ .+\[Nintendo 64\]/));
  check("CLK: a button by id", has(/ P CLK\s+btn-contrast/));
  check("SET: contrast toggled", has(/ P SET\s+contrast (on|off)/));
  check("MNU: menu opened and entry run", has(/ P MNU\s+open /) && has(/ P MNU\s+run Details/));
  check("NAV: details", has(/ P NAV\s+details /));
  check("API: a request with its time", has(/ P API\s+GET library\.php\?.* \d+ms/));
  // thrown from the test's own snippet, so the file is blank; a real one names the module
  // a fault in the page's code is a BUG line (log.js, bug())
  check("BUG: a page error, at once, with line and column", has(new RegExp(" P BUG\\s+uncaught: " + mark + " @ .* \\| at [^ ]*:\\d+:\\d+")));
  // that error was on purpose: take it out of the harness's own count
  b.errors = b.errors.filter(function (e) { return e.indexOf("XSTEST-") < 0; });
  check("FAIL: the server refused a bad request", has(/ S FAIL 404 unknown game \(hide\.php\)/));
  check("REQ: the server timed it", has(/ S REQ\s+POST \/api\/hide\.php \d+ms 404/));
  check("status polls are quiet", !has(/ S REQ\s+GET \/api\/status\.php/));
  // the page and the server must stamp with the same clock: a server on UTC
  // and a page on local time are hours apart
  const hourOf = (re) => { const l = lines.filter((x) => re.test(x)).pop(); return l ? Number(l.slice(0, 2)) : -1; };
  const hp = hourOf(/ P /), hs = hourOf(/ S REQ/);
  check("page and server agree on the hour", hp >= 0 && hs >= 0 && Math.abs(hp - hs) <= 1, true);

  // the viewer
  await b.key("l");
  check("L opens the viewer", await b.until(`(document.querySelector("#editor .panel-title") || {}).textContent`, "THE LOG", 6000), "THE LOG");
  await b.until(`document.querySelectorAll("#editor .lg-row").length > 20`, true, 6000);
  const rows = await b.ev(`document.querySelectorAll("#editor .lg-row").length`);
  check("viewer shows lines", rows > 20);
  await b.ev(`(() => { const q = document.querySelector("#editor .lg-bar input"); q.value = "ERR"; q.dispatchEvent(new Event("input")); })()`); await sleep(200);
  // The filter shows every trouble line and any line holding the letters typed: a game named Terraria is let in too.
  check("filter narrows to errors", await b.ev(`[...document.querySelectorAll("#editor .lg-row")].every(r => /BUG|WARN|FAIL|PHPE|WRIT/.test(r.textContent) || /err/i.test(r.textContent))`) && await b.ev(`document.querySelectorAll("#editor .lg-row").length`) < rows);
  await b.key("Escape");
  check("Esc closes the viewer", await b.until(`document.getElementById("editor").hidden`));

  const days = await api("api/log.php?days=1");
  check("days listed", days.ok && days.days.some((d) => /^\d{4}-\d\d-\d\d$/.test(d.day)));

  /* The fast lane: the page's reads go there when it answers,
     and to the main server at once when it does not, with a LANE line. */
  check("the page's reads use the fast lane when it answers", await b.ev(`(async () => {
    const M = await import("/js/log.js");
    for (let i = 0; i < 40; i++) {
      const r = await fetch(window.XSEGON.fastLane + "/api/lane.php").then((x) => x.json()).catch(() => null);
      if (r && r.lane === "fast") { break; }
      await new Promise((r) => setTimeout(r, 250));
    }
    const res = await M.api("api/library.php?limit=1");
    return [!!window.XSEGON.fastLane, res.ok];
  })()`), [true, true]);
  // The page sends its lines in batches: read until they are in, or 6s.
  const logSays = async (re) => {
    for (const end = Date.now() + 6000; Date.now() < end;) {
      const t = await api("api/log.php?tail=400");
      if ((t.lines || []).some((l) => re.test(l))) { return true; }
      await sleep(150);
    }
    return false;
  };
  check("and the log marks them as the fast lane's",
    [await logSays(/P API\s+GET library\.php\?limit=1 \d+ms fast/), await logSays(/ S REQ\s+GET \/api\/library\.php\?limit=1 \d+ms 200 fast/)], [true, true]);
  check("a fast lane that does not answer: the same read from the main server, at once, and said", await b.ev(`(async () => {
    const M = await import("/js/log.js");
    const real = window.XSEGON.fastLane;
    window.XSEGON.fastLane = "http://127.0.0.1:9";            // nothing listens there
    try { const res = await M.api("api/game.php?id=nope"); return [res.error || "", res.ok]; }
    finally { window.XSEGON.fastLane = real; }
  })()`), ["unknown game", false]);
  check("with a LANE line saying the main server takes over", await logSays(/P LANE the fast lane did not answer .*the main server takes everything, and it is tried again every 10s/), true);

  /* Tried again every 10s, ten misses in a row at most, with one line for
     the first miss and one for the last, never a line a try. The wait is cut
     to nothing here; logTuning also starts the count of misses from none. */
  const laneMark = "XSLANE-" + Date.now();
  const tries = await b.ev(`(async () => {
    const M = await import("/js/log.js");
    const real = window.XSEGON.fastLane, realFetch = window.fetch;
    let n = 0;
    window.fetch = (u, o) => { if (String(u).indexOf("127.0.0.1:9/") >= 0) { n++; } return realFetch(u, o); };
    M.logTuning(0, 300000);
    M.L("TST", ${JSON.stringify(laneMark)});
    window.XSEGON.fastLane = "http://127.0.0.1:9";
    try {
      for (let i = 0; i < 14; i++) { await M.api("api/game.php?id=nope"); }
      return n;
    } finally { window.XSEGON.fastLane = real; window.fetch = realFetch; M.flushLog(); }
  })()`);
  const laneLines = async () => {
    for (const end = Date.now() + 6000; Date.now() < end;) {
      const t = (await api("api/log.php?tail=600")).lines || [];
      const at = t.findIndex((l) => l.indexOf(laneMark) >= 0);
      const after = at >= 0 ? t.slice(at + 1).filter((l) => / P LANE /.test(l)) : [];
      if (after.length >= 2) { return after; }
      await sleep(150);
    }
    return [];
  };
  const ll = await laneLines();
  check("a fast lane that keeps missing is tried ten times and then left alone", tries, 10);
  check("with one line for the first miss and one for the tenth, and none between",
        [ll.length, /did not answer .*tried again every 10s/.test(ll[0] || ""), /10 times in a row; the main server takes everything from now on/.test(ll[1] || "")],
        [2, true, true]);
  /* "1 miss" or "2 misses": the page's own status poll can land in the few
     milliseconds the lane is pointed away here, and is then a miss of its own. */
  check("one that answers again after a miss says so", await b.ev(`(async () => {
    const M = await import("/js/log.js");
    const real = window.XSEGON.fastLane;
    M.logTuning(0, 300000);
    window.XSEGON.fastLane = "http://127.0.0.1:9";
    try { await M.api("api/game.php?id=nope"); } finally { window.XSEGON.fastLane = real; }
    const res = await M.api("api/library.php?limit=1");
    M.logTuning(10000, 300000);
    M.flushLog();
    return res.ok;
  })()`) && await logSays(/ P LANE\s+the fast lane answers, after (1 miss|2 misses)/), true);

  /* The routine checks (the still-alive poll, the folder window's wait) are
     counted onto the next line as [*N], not a line each. A page left alone
     says LIVE now and then; the wait for that is cut to nothing here. */
  const fold = "XSFOLD-" + Date.now();
  await b.ev(`(async () => {
    const M = await import("/js/log.js");
    M.L("TST", ${JSON.stringify(fold)} + " before");
    for (let i = 0; i < 3; i++) { await M.api("api/running.php?beat=1"); }
    await M.api("api/pick-folder.php");
    M.L("TST", ${JSON.stringify(fold)} + " after");
    M.flushLog();
  })()`);
  let between = null, after = "";
  for (const end = Date.now() + 6000; Date.now() < end && !after;) {
    const t = (await api("api/log.php?tail=600")).lines || [];
    const i0 = t.findIndex((l) => l.indexOf(fold + " before") >= 0), i1 = t.findIndex((l) => l.indexOf(fold + " after") >= 0);
    if (i0 >= 0 && i1 > i0) { between = t.slice(i0 + 1, i1); after = t[i1]; } else { await sleep(150); }
  }
  // Summed over every line from the first to "after": another line written
  // in between (the page is alive) takes the count so far with it.
  const n = (between || []).concat([after]).reduce((s, l) => s + Number((/ \[\*(\d+)\]$/.exec(l) || [0, 0])[1]), 0);
  check("routine checks are counted onto the next line as [*N], not written a line each",
        [/ \[\*\d+\]$/.test(after), n >= 4, (between || []).some((l) => / P API\s+GET (running|pick-folder)\.php/.test(l))], [true, true, false]);
  await b.ev(`(async () => {
    const M = await import("/js/log.js");
    M.logTuning(10000, 1);
    await new Promise((r) => setTimeout(r, 20));
    await M.api("api/running.php?beat=1");
    M.logTuning(10000, 300000);
    M.flushLog();
  })()`);
  check("a page left alone still says it is alive, with the count", await logSays(/ P LIVE\s+still here \[\*\d+\]$/), true);
  await api("api/pick-folder.php");
  const srv = (await api("api/log.php?tail=200")).lines || [];
  check("and on the server, the folder window's wait is quiet too",
        srv.some((l) => / S REQ\s+GET \/api\/pick-folder\.php/.test(l)), false);

  /* "working...": a request you started that takes over 0.4s
     says so until it answers; a quick one and a background poll never do.
     fetch is slowed on purpose here, for these three requests only. */
  check("a slow request of yours shows working..., and it goes when the answer comes", await b.ev(`(async () => {
    const M = await import("/js/log.js");
    const real = window.fetch;
    const slow = (ms) => { window.fetch = (u, o) => new Promise((r) => setTimeout(r, ms)).then(() => real(u, o)); };
    const on = () => document.body.classList.contains("busy") && !!document.querySelector(".busy-mark.on");
    try {
      slow(900); M.heardInput(); const p = M.api("api/hide.php");
      await new Promise((r) => setTimeout(r, 600)); const during = on();
      await p; const after = on();
      slow(100); M.heardInput(); await M.api("api/hide.php"); await new Promise((r) => setTimeout(r, 450)); const quick = on();
      slow(900); M.heardInput(); const q = M.api("api/running.php"); await new Promise((r) => setTimeout(r, 600)); const poll = on(); await q;
      return [during, after, quick, poll];
    } finally { window.fetch = real; }
  })()`), [true, false, false, false]);

  /* The browser allows 64 KiB of fetch(keepalive) in flight, and a batch whose
     answer nobody reads stays in flight for good, so later batches are dropped
     in silence: more than 64 KiB in many small batches, and the last must arrive. */
  const big = "XSBIG-" + Date.now();
  await b.ev(`(async () => {
    const M = await import("/js/log.js");
    const pad = "x".repeat(200);
    for (let i = 0; i < 80; i++) {
      for (let k = 0; k < 5; k++) { M.L("TST", ${JSON.stringify(big)} + " " + i + "." + k + " " + pad); }
      M.flushLog();
      await new Promise((r) => setTimeout(r, 15));
    }
  })()`);
  let got = 0, lastIn = false;
  for (const end = Date.now() + 8000; Date.now() < end;) {
    const t = await api("api/log.php?tail=5000");
    const mine = (t.lines || []).filter((l) => l.indexOf(big) >= 0);
    got = mine.length;
    lastIn = mine.some((l) => l.indexOf(big + " 79.4 ") >= 0);
    if (got >= 400 && lastIn) { break; }
    await sleep(150);
  }
  check("the page's log keeps arriving past 64 KB: all 400 lines of 100 KB, the last one too", [got, lastIn], [400, true]);

  /* A batch that could not be sent is kept and sent again, and the log says
     so: a hole in it is named, never silent. The page's own fetch is made to
     fail for the log alone, twice, then put back. */
  const late = "XSLATE-" + Date.now();
  await b.ev(`(async () => {
    const M = await import("/js/log.js");
    const real = window.fetch;
    window.fetch = (u, o) => String(u).indexOf("api/log.php") >= 0 && o && o.method === "POST"
      ? Promise.reject(new TypeError("made to fail by the test")) : real(u, o);
    try {
      M.L("TST", ${JSON.stringify(late)} + " one"); M.flushLog();
      await new Promise((r) => setTimeout(r, 80));
      M.L("TST", ${JSON.stringify(late)} + " two"); M.flushLog();
      await new Promise((r) => setTimeout(r, 80));
    } finally { window.fetch = real; }
    M.flushLog();
  })()`);
  check("lines that could not be sent arrive once sending works again, in order",
        [await logSays(new RegExp(" P TST\\s+" + late + " one")), await logSays(new RegExp(" P TST\\s+" + late + " two")),
         await (async () => { const t = await api("api/log.php?tail=400"); const l = (t.lines || []).filter((x) => x.indexOf(late) >= 0).map((x) => x.replace(/ \[\*\d+\]$/, "").slice(-3)); return l.join(","); })()],
        [true, true, "one,two"]);
  check("and the log says they were late, how many sends failed and why",
        await logSays(/ P LOG\s+sent late: \d+ lines waited through 2 failed sends since \d\d:\d\d:\d\d\.\d{3} \(made to fail by the test\)/), true);
};
