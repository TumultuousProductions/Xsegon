// The phone page: its own small server, the square's code, what a phone may
// and may not ask, the playing game's page (BA6, AB2), and the Connect a phone
// window. On a test copy the phone page opens on 127.0.0.1 and Windows is
// asked nothing.
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");
const lib = require("./lib");
const { makePdf } = require("./t-reader");
const { api, apiUntil, sleep } = lib;
const MAP_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// One request to the phone page's port, with the headers said outright: a browser's own rules are what is being tried.
function ask(port, where, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const body = opts.body ? JSON.stringify(opts.body) : null;
    const headers = Object.assign({ Host: opts.host || "127.0.0.1:" + port }, opts.headers || {});
    if (body) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(body); }
    if (opts.cookie) { headers.Cookie = opts.cookie; }
    const req = http.request({ host: "127.0.0.1", port, path: where, method: opts.method || (body ? "POST" : "GET"), headers }, (res) => {
      const parts = [];
      res.on("data", (c) => parts.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(parts);
        let json = null;
        try { json = JSON.parse(raw.toString("utf8")); } catch (e) { /* a page or a picture */ }
        resolve({ status: res.statusCode, json: json || {}, raw, headers: res.headers, cookie: (res.headers["set-cookie"] || [])[0] || "" });
      });
    });
    req.on("error", () => resolve({ status: 0, json: {}, raw: Buffer.alloc(0), headers: {}, cookie: "" }));
    if (body) { req.write(body); }
    req.end();
  });
}

module.exports = async function (b, check) {
  if (process.argv.includes("--live")) {
    console.log("    (not run on the real Xsegon: it would open the phone page on the home network)");
    return;
  }
  const staysWas = (await api("api/settings.php")).settings.window.phoneStays;
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const docsDir = path.join(lib.DATA, "documents"), placesFile = path.join(lib.DATA, "manual-places.json");
  let docsMade = null, ranStandIn = false, phoneSized = false, placesWas;
  try {
    // The copy starts from the real data: whatever stood there, the checks start from closed and nobody let in.
    await api("api/settings.php", { window: { phoneStays: "on" } });
    await api("api/phone.php", { op: "off" });
    await api("api/phone.php", { op: "forget" });
    let st = await apiUntil(async () => { const s = await api("api/phone.php"); return s.up ? null : s; }, 8000);
    check("switched off, the phone page is closed and nobody is let in", [!!st && st.ok, st && st.on, st && st.phones.length], [true, false, 0]);
    check("how long it stays open comes set to: until I switch it off",
          await api("api/settings.php").then((r) => [r.defaults.window.phoneStays, Object.keys(r.schema.window.phoneStays.options)]), ["on", ["on", "close", "idle"]]);
    check("closed, the Connect a phone window is given no link to draw", (await api("api/phone.php?square=1")).link === undefined, true);

    st = await api("api/phone.php", { op: "on" });
    check("the switch is kept at the press", st.on, true);
    st = await apiUntil(async () => { const s = await api("api/phone.php"); return s.up ? s : null; }, 20000);
    check("switched on, the phone page comes up, in a test on this PC's own address", [!!st, st && st.address, !!st && st.port > 0], [true, "127.0.0.1", true]);
    if (!st) {
      // What stood in the way, for whoever reads the red line: the state, the port's own answer, the log.
      const now = await api("api/phone.php");
      console.log("    the state: " + JSON.stringify(now));
      console.log("    its port says: " + JSON.stringify(await ask(now.port, "/p/hello").then((r) => [r.status, r.json])));
      console.log("    the log: " + ((await api("api/log.php?tail=400")).lines || []).filter((l) => /PHONE|SPWN/.test(l)).slice(-8).join(" || "));
      return;
    }
    let port = st.port;                         // a new one after Disconnect and Switch on, below
    const own = { Origin: "http://127.0.0.1:" + port, "X-Xsegon-Phone": "1" };

    const hello = await ask(port, "/p/hello");
    check("it says it is Xsegon's phone page", [hello.status, hello.json.lane], [200, "phone"]);
    const page = await ask(port, "/");
    check("its one page is the phone page, which may load nothing from anywhere else",
          [page.status, /<title>Xsegon<\/title>/.test(page.raw.toString("utf8")), /default-src 'none'/.test(page.headers["content-security-policy"] || "")], [200, true, true]);

    /* ---- what nobody gets without a key, or by another road ---------------- */
    const shut = [];
    for (const p of ["/p/me", "/p/list", "/p/art?id=x", "/p/now"]) { shut.push((await ask(port, p)).status); }
    check("with no key, nothing of the library is told", shut, [401, 401, 401, 401]);
    check("and no game is started", (await ask(port, "/p/play", { body: { id: "x" }, headers: own })).status, 401);
    const gone = [];
    for (const p of ["/api/settings.php", "/api/launch.php", "/api/local.php", "/api/phone.php", "/index.php", "/router.php", "/data/settings.json",
                     "/includes/phone.php", "/phone/index.html", "/p/../api/settings.php", "/p/list/../../api/log.php"]) { gone.push((await ask(port, p)).status); }
    check("none of the main server's jobs or files exists on this port", gone, gone.map(() => 404));
    check("asked under another name, it answers nothing", (await ask(port, "/p/hello", { host: "xsegon.example:" + port })).status, 404);
    check("a change with no word that this page sent it is refused",
          (await ask(port, "/p/join", { body: { code: "0".repeat(16) }, headers: { Origin: own.Origin } })).status, 403);
    check("and so is one from another site's page",
          (await ask(port, "/p/join", { body: { code: "0".repeat(16) }, headers: { Origin: "http://xsegon.example", "X-Xsegon-Phone": "1" } })).status, 403);
    check("a read asked as a change is not one of its jobs", (await ask(port, "/p/list", { method: "POST", headers: own })).status, 404);

    /* ---- the square's code ------------------------------------------------- */
    const link = (await api("api/phone.php?square=1")).link || "";
    const code = (/\/\?c=([0-9a-f]{16})$/.exec(link) || [])[1] || "";
    check("the Connect a phone window's link is the phone page's address and a code of sixteen", [link.startsWith("http://127.0.0.1:" + port + "/?c="), code.length], [true, 16]);
    const notIt = code.replace(/./g, (c) => (c === "0" ? "1" : "0"));
    const wrong = await ask(port, "/p/join", { body: { code: notIt }, headers: own });
    check("a code that is not the square's lets nobody in", [wrong.status, wrong.cookie], [403, ""]);
    const join = await ask(port, "/p/join", { body: { code }, headers: Object.assign({ "User-Agent": IPHONE }, own) });
    const cookie = join.cookie.split(";")[0];
    if (join.status !== 200) {
      console.log("    the wrong code was answered: " + JSON.stringify([wrong.status, wrong.json]) + ", the right one: " + JSON.stringify([join.status, join.json]));
      console.log("    the log: " + ((await api("api/log.php?tail=400")).lines || []).filter((l) => /PHONE|FAIL|WRIT/.test(l)).slice(-8).join(" || "));
    }
    check("the square's code lets the phone in, its key in a cookie no script can read and no other site can send",
          [join.status, /^xsp=[0-9a-f]{64}$/.test(cookie), /httponly/i.test(join.cookie), /samesite=strict/i.test(join.cookie)], [200, true, true, true]);
    check("a square works once", (await ask(port, "/p/join", { body: { code }, headers: own })).status, 403);
    const me = await ask(port, "/p/me", { cookie });
    check("the phone is known by what it is", [me.status, me.json.name], [200, "iPhone, Safari 18"]);
    st = await api("api/phone.php");
    check("and the Connect a phone window lists it", st.phones.map((p) => p.name), ["iPhone, Safari 18"]);
    check("its key is kept as a sum, never as itself", fs.readFileSync(path.join(lib.DATA, "phone.json"), "utf8").includes(cookie.slice(4)), false);
    const next = (/\/\?c=([0-9a-f]{16})$/.exec((await api("api/phone.php?square=1")).link || "") || [])[1] || "";
    for (let i = 0; i < 5; i++) { await ask(port, "/p/join", { body: { code: notIt }, headers: own }); }
    check("five wrong codes and the square is spent, for the right code too", (await ask(port, "/p/join", { body: { code: next }, headers: own })).status, 403);

    /* ---- what a phone that was let in is told ------------------------------ */
    const list = await ask(port, "/p/list", { cookie });
    const games = list.json.games || [];
    check("the list: six things a game and nothing else of yours",
          [list.status, list.json.ok, games.length > 0, Object.keys(games[0] || {}).sort().join()], [200, true, true, "hasArt,hasLogo,id,platform,playable,title"]);
    check("200 at a time at the most, with how many there are in all and the consoles",
          [games.length <= 200, list.json.count >= games.length, (list.json.consoles || []).length > 0], [true, true, true]);
    const word = ((games[0] || {}).title || "").split(/\s+/).filter((w) => w.length > 3)[0] || (games[0] || {}).title || "a";
    const found = await ask(port, "/p/list?q=" + encodeURIComponent(word), { cookie });
    check("typed words narrow it", [found.json.count >= 1, found.json.count <= list.json.count], [true, true]);
    check("a list that says what you play (recently played) is not handed out: every game comes instead",
          (await ask(port, "/p/list?platform=" + encodeURIComponent("@recent"), { cookie })).json.count, list.json.count);
    const boxed = games.find((g) => g.hasArt);
    if (boxed) {
      const art = await ask(port, "/p/art?id=" + encodeURIComponent(boxed.id), { cookie });
      check("a game's box comes as a picture", [art.status, /^image\//.test(art.headers["content-type"] || ""), art.raw.length > 500], [200, true, true]);
      const bigArt = await ask(port, "/p/art?id=" + encodeURIComponent(boxed.id) + "&big=1", { cookie });
      check("and at its own size, for the large cover in the middle of Covers",
            [bigArt.status, /^image\//.test(bigArt.headers["content-type"] || ""), bigArt.raw.length >= art.raw.length], [200, true, true]);
    } else { console.log("    (no game on the first page has a box: the picture check steps aside)"); }
    const logoed = games.find((g) => g.hasLogo);
    if (logoed) {
      const lg = await ask(port, "/p/art?id=" + encodeURIComponent(logoed.id) + "&kind=logo", { cookie });
      check("a game's Clear Logo comes as a picture too, for the Wheel's plates", [lg.status, /^image\//.test(lg.headers["content-type"] || "")], [200, true]);
    } else { console.log("    (no game on the first page has a Clear Logo: the logo check steps aside)"); }
    const tick = await ask(port, "/p/sound", { cookie });
    check("the Wheel's click: the PC's Move sound", [tick.status, /^audio\//.test(tick.headers["content-type"] || "")], [200, true]);
    check("and not for a phone that was never let in", (await ask(port, "/p/sound", {})).status, 401);
    check("a picture asked for by a path is refused", (await ask(port, "/p/art?id=" + encodeURIComponent("..\\..\\settings.json"), { cookie })).status, 404);
    const now = await ask(port, "/p/now", { cookie });
    check("what plays on the TV: nothing", [now.status, now.json.running], [200, null]);

    /* ---- Play --------------------------------------------------------------- */
    const ready = games.find((g) => g.playable);
    if (ready) {
      const play = await ask(port, "/p/play", { body: { id: ready.id }, headers: own, cookie });
      check("Play is handed to the main server (which starts nothing for a test)", [play.status, play.json.ok], [200, true]);
      check("with the key but not sent by the page itself, Play is refused",
            (await ask(port, "/p/play", { body: { id: ready.id }, headers: { Origin: own.Origin }, cookie })).status, 403);
    } else { console.log("    (no game on the first page can start: the Play checks step aside)"); }
    const none = await ask(port, "/p/play", { body: { id: "no-such-game" }, headers: own, cookie });
    check("a game that is not in the library is refused, in the main server's words", [none.json.ok, typeof none.json.error], [false, "string"]);
    check("the log has the phone let in, a play asked for and a refusal",
          await apiUntil(async () => {
            const lines = ((await api("api/log.php?tail=800")).lines || []).filter((l) => /PHONE/.test(l));
            return ["let in: iPhone, Safari 18", "play no-such-game asked by iPhone, Safari 18", "refused GET /api/settings.php"].every((w) => lines.some((l) => l.includes(w)));
          }, 6000), true);

    /* ---- the playing game's page (BA6, AB2) ---------------------------------------- */
    // A game stands in as playing (running.json, as api\launch.php writes it at a press) with a manual and a map of the test's own.
    const g0 = games[0], g1 = games[1];
    const runFile = path.join(lib.DATA, "running.json");
    const standIn = () => fs.writeFileSync(runFile, JSON.stringify({ gameId: g0.id, title: g0.title, platform: g0.platform, pending: true, startedAt: new Date().toISOString() }));
    if (g0 && !fs.existsSync(docsDir)) {
      docsMade = docsDir;
      placesWas = fs.existsSync(placesFile) ? fs.readFileSync(placesFile) : null;
      fs.mkdirSync(path.join(docsDir, g0.id), { recursive: true });
      fs.writeFileSync(path.join(docsDir, g0.id, "Manual.pdf"), makePdf(12, 400, 560));
      fs.writeFileSync(path.join(docsDir, g0.id, "Map.png"), Buffer.from(MAP_PNG, "base64"));
      await api("api/manual-place.php", { id: g0.id, doc: "Manual.pdf", page: 1, marks: [], one: false });
      standIn();
      ranStandIn = true;
      const playing = (await ask(port, "/p/now", { cookie })).json.running || {};
      check("a game playing on the TV is named by its id, so its page can open", [playing.id, playing.title], [g0.id, g0.title]);
      const pg = await ask(port, "/p/game?id=" + encodeURIComponent(g0.id), { cookie });
      check("its page: the manual first, then the map, each fetched through the phone page, the manual on page 1",
            [pg.status, (pg.json.docs || []).map((d) => [d.label, d.kind, /^\/p\/doc\?id=/.test(d.url), d.page])], [200, [["Manual", "pdf", true, 1], ["Map", "image", true, null]]]);
      const man = (pg.json.docs || [])[0] || { url: "/p/doc" };
      const piece = await ask(port, man.url, { cookie, headers: { Range: "bytes=0-99" } });
      check("the manual comes as a PDF, in pieces", [piece.status, piece.headers["content-type"], piece.raw.length, piece.raw.slice(0, 5).toString()], [206, "application/pdf", 100, "%PDF-"]);
      const refused = [];
      for (const f of ["..\\..\\settings.json", "../../settings.json", "Manual.pdf.txt", ""]) {
        refused.push((await ask(port, "/p/doc?id=" + encodeURIComponent(g0.id) + "&file=" + encodeURIComponent(f), { cookie })).status);
      }
      check("a file the game's documents do not name is refused, a way out of the folder too", refused, [404, 404, 404, 404]);
      check("and so is another game's manual", (await ask(port, "/p/doc?id=" + encodeURIComponent((g1 || {}).id || "x") + "&file=Manual.pdf", { cookie })).status, 404);
      check("with no key, neither the page nor its manual is told",
            [(await ask(port, "/p/game?id=" + encodeURIComponent(g0.id))).status, (await ask(port, man.url)).status], [401, 401]);
      const pdfJs = await ask(port, "/js/vendor/pdf-6.4.299/pdf.min.js", { cookie });
      check("the booklet's libraries and the phone's reader come from the phone page itself, to a phone let in",
            [pdfJs.status, (pdfJs.headers["content-type"] || "").split(";")[0], (await ask(port, "/js/vendor/pdf-6.4.299/pdf.min.js")).status,
             (await ask(port, "/reader.js", { cookie })).status, (await ask(port, "/js/vendor/pdf-6.4.299/LICENSE", { cookie })).status],
            [200, "text/javascript", 401, 200, 404]);
      const csp = page.headers["content-security-policy"] || "";
      check("the page may run scripts and the booklet's worker from itself, and still load nothing from anywhere else",
            [/script-src 'self' 'unsafe-inline';/.test(csp), /worker-src 'self';/.test(csp), /connect-src 'self';/.test(csp), /https?:/.test(csp)], [true, true, true, false]);
      const btn = await ask(port, "/p/buttons?id=" + encodeURIComponent(g0.id), { cookie });
      check("its buttons: what a player needs, with no folder of this PC's in them",
            [btn.status, btn.json.ok, Array.isArray(btn.json.hotkeys), Array.isArray(btn.json.swaps), /[A-Za-z]:\\\\/.test(btn.raw.toString("utf8"))], [200, true, true, true, false]);
      const ch = await ask(port, "/p/cheats?id=" + encodeURIComponent(g0.id), { cookie });
      check("its cheats: the ones on, by their words", [ch.status, ch.json.ok, Array.isArray(ch.json.on)], [200, true, true]);
      await api("api/manual-place.php", { id: g0.id, doc: "Manual.pdf", page: 2, marks: [5], one: false });
      const kept = await ask(port, "/p/place", { body: { id: g0.id, doc: "Manual.pdf", page: 7 }, headers: own, cookie });
      const there = await api("api/manual-place.php?id=" + encodeURIComponent(g0.id) + "&doc=Manual.pdf");
      check("the page reached on the phone is kept by the PC, the bookmarks left as they were", [kept.status, kept.json.ok, there.page, there.marks], [200, true, 7, [5]]);
      check("not sent by the page itself, it is refused", (await ask(port, "/p/place", { body: { id: g0.id, doc: "Manual.pdf", page: 3 }, headers: { Origin: own.Origin }, cookie })).status, 403);
      check("and the phone is told that page next time", ((await ask(port, "/p/game?id=" + encodeURIComponent(g0.id), { cookie })).json.docs || [{}])[0].page, 7);
      await api("api/manual-place.php", { id: g0.id, doc: "Manual.pdf", page: 1, marks: [], one: false });
      check("Disconnect not sent by the page itself is refused", (await ask(port, "/p/off", { body: {}, headers: { Origin: own.Origin }, cookie })).status, 403);

      if (b) {
        // The phone page itself, at a phone's size, with the key the test phone was given: no second phone is let in.
        await b.send("Network.setCookie", { name: "xsp", value: cookie.slice(4), domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Strict" });
        await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        phoneSized = true;

        // ---- your games in pictures (AB4): List, Grid, Covers, with nothing playing ----------
        fs.rmSync(runFile, { force: true });
        const openPhone = async () => {
          await b.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" });
          await b.until(`document.querySelectorAll("#list li, #c-row .cover").length > 0`, true, 10000);
        };
        await openPhone();
        await b.ev(`localStorage.removeItem("xsLook")`);         // a first visit, as the next check assumes
        await openPhone();
        const LOOKS = `[...document.querySelectorAll("#looks button")].map((x) => x.textContent + (x.classList.contains("on") ? " (on)" : ""))`;
        check("above your games: List, Grid, Covers and Wheel, List as it comes", await b.ev(LOOKS), ["List (on)", "Grid", "Covers", "Wheel"]);
        await b.clickSel('#looks button[data-look="grid"]');
        const arty = games.slice(0, 12).some((g) => g.hasArt);
        check("Grid: box art three across, each with its name under it",
              await b.until(`(l => [l.className, getComputedStyle(l).gridTemplateColumns.split(" ").length, [...l.children].slice(0, 12).every((li) => li.querySelector(".t").textContent.length > 0),
                ${arty} ? [...l.querySelectorAll("img.art")].slice(0, 12).some((i) => i.complete && i.naturalWidth > 0) : true])(document.getElementById("list"))`, ["grid", 3, true, true], 8000),
              ["grid", 3, true, true]);
        await openPhone();
        check("kept on this phone: opened again, it is Grid", await b.ev(`[${LOOKS}, document.getElementById("list").className]`), [["List", "Grid (on)", "Covers", "Wheel"], "grid"]);
        await b.clickSel('#looks button[data-look="covers"]');
        const MID = `[[...document.getElementById("c-row").children].indexOf(document.querySelector(".cover.mid")), document.getElementById("c-title").textContent]`;
        check("Covers: the first game large in the middle, its name under it", await b.until(MID, [0, games[0].title], 6000), [0, games[0].title]);
        check("with its console and where it is, of how many", await b.ev(`document.getElementById("c-sub").textContent`), games[0].platform + " · 1 of " + list.json.count);
        await b.ev(`(r => { const k = r.children[2]; r.scrollLeft = k.offsetLeft + k.offsetWidth / 2 - r.clientWidth / 2; })(document.getElementById("c-row"))`);
        check("a swipe brings the next ones to the middle", await b.until(MID, [2, games[2].title], 4000), [2, games[2].title]);
        if (games[2].hasArt) {
          check("the one in the middle is drawn at its own size",
                await b.until(`(i => !!i && /&big=1$/.test(i.src) && i.naturalWidth > 0)(document.querySelector(".cover.mid img"))`, true, 8000), true);
        }
        await b.clickSel(".cover.mid");
        check("a tap on it opens its sheet, with Play on the TV",
              await b.until(`[document.getElementById("sheet").className, document.getElementById("s-title").textContent]`, ["on", games[2].title], 3000), ["on", games[2].title]);
        await b.clickSel("#s-shut");
        const typeIn = (w) => b.ev(`(q => { q.value = ${JSON.stringify(w)}; q.dispatchEvent(new Event("input", { bubbles: true })); })(document.getElementById("q"))`);
        await typeIn(word);
        check("typed words narrow the covers too", await b.until(`document.getElementById("c-row").children.length`, Math.min(found.json.count, 200), 5000), Math.min(found.json.count, 200));
        await typeIn("");
        await b.until(`document.getElementById("c-row").children.length`, games.length, 5000);
        await b.clickSel('#looks button[data-look="wheel"]');
        const WSEL = `[[...document.querySelectorAll("#w-plates .wp")].indexOf(document.querySelector(".wp.sel")), document.getElementById("w-title").textContent]`;
        check("Wheel: the first game's plate chosen, larger, its name under the wheel", await b.until(WSEL, [0, games[0].title], 6000), [0, games[0].title]);
        check("the chosen plate level, the ones after it turned down the curve",
              await b.ev(`(p => [p[0].style.transform, p[1].style.transform, p[2].style.transform])([...document.querySelectorAll("#w-plates .wp")])`),
              ["translateY(-50%) rotate(0deg)", "translateY(-50%) rotate(-12deg)", "translateY(-50%) rotate(-21deg)"]);    // as the browser writes them back
        if (games[0].hasArt) {
          check("with the chosen game's box art beside it",
                await b.until(`(a => !a.hidden && a.dataset.id === ${JSON.stringify(games[0].id)} && a.complete && a.naturalWidth > 0)(document.getElementById("w-art"))`, true, 6000), true);
        }
        if (games.slice(0, 8).some((g) => g.hasLogo)) {
          check("the plates near it wear their Clear Logos", await b.until(`[...document.querySelectorAll("#w-plates .wp img")].some((i) => i.complete && i.naturalWidth > 0)`, true, 8000), true);
        }
        await b.ev(`document.getElementById("wheel").scrollTop = 3 * 28`);
        check("the plates that turned away are gone, not left faint where they went",
              await b.ev(`[...document.querySelectorAll("#w-plates .wp")].filter((p) => getComputedStyle(p).display !== "none").length <= 11`), true);
        check("a swipe turns the wheel: the fourth game chosen, named, and where it is of how many",
              await b.until(`[${WSEL}, document.getElementById("w-sub").textContent]`, [[3, games[3].title], games[3].platform + " · 4 of " + list.json.count], 4000),
              [[3, games[3].title], games[3].platform + " · 4 of " + list.json.count]);
        await b.clickSel(".wp.sel");
        check("a tap on the chosen plate opens its sheet, with Play on the TV",
              await b.until(`[document.getElementById("sheet").className, document.getElementById("s-title").textContent]`, ["on", games[3].title], 3000), ["on", games[3].title]);
        await b.clickSel("#s-shut");
        await b.clickSel('#looks button[data-look="list"]');
        await b.until(`document.querySelectorAll("#list li").length === ${games.length}`, true, 6000);

        standIn();
        await b.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/" });
        const GAME = `[document.body.classList.contains("in-game"), (document.getElementById("g-title") || {}).textContent, [...document.querySelectorAll("#g-tabs button")].map((t) => t.textContent)]`;
        check("with a game playing, the phone page opens its page by itself: Manual, Maps, Buttons, Cheats",
              await b.until(GAME, [true, g0.title, ["Manual", "Maps", "Buttons", "Cheats"]], 15000), [true, g0.title, ["Manual", "Maps", "Buttons", "Cheats"]]);
        const BK = `(x => x && x.dataset.pages ? [+x.dataset.page, +x.dataset.pages, (document.querySelector(".bk-folio") || {}).textContent] : null)(document.querySelector("#g-body .bk"))`;
        const RED = `(c => c && c.width ? Math.round(c.getContext("2d").getImageData(c.width >> 1, c.height >> 2, 1, 1).data[0] / 7) - 1 : -1)((document.querySelectorAll(".bk-page")[0] || {}).querySelector && document.querySelectorAll(".bk-page")[0].querySelector("canvas"))`;
        check("the manual opens as a booklet on its page, drawn", await b.until(`[${BK}, ${RED}]`, [[1, 12, "Page 1 of 12"], 0], 15000), [[1, 12, "Page 1 of 12"], 0]);
        await b.clickSel(".bk-hot.next");
        check("a tap on the right side turns the page", await b.until(BK, [2, 12, "Page 2 of 12"], 5000), [2, 12, "Page 2 of 12"]);
        check("and the PC keeps it, so the TV's reader opens there too",
              await apiUntil(async () => (await api("api/manual-place.php?id=" + encodeURIComponent(g0.id) + "&doc=Manual.pdf")).page === 2, 6000), true);
        await sleep(800);
        await b.clickSel(".bk-hot.prev");
        check("a tap on the left side turns back", await b.until(BK, [1, 12, "Page 1 of 12"], 5000), [1, 12, "Page 1 of 12"]);
        await b.clickSel('#g-tabs button[data-tab="maps"]');
        check("Maps shows the game's map", await b.until(`(i => !!i && i.complete && i.naturalWidth > 0)(document.querySelector(".maps img"))`, true, 6000), true);
        await b.clickSel('#g-tabs button[data-tab="buttons"]');
        check("Buttons says what Xsegon knows, and that the manual has the rest", await b.until(`/in its manual/.test(document.getElementById("g-body").textContent)`, true, 8000), true);
        await b.clickSel('#g-tabs button[data-tab="cheats"]');
        check("Cheats says which are on, chosen on the TV", await b.until(`/Cheats tab on the TV/.test(document.getElementById("g-body").textContent)`, true, 8000), true);
        standIn();
        await b.clickSel("#g-back");
        const away = await b.until(`document.body.classList.contains("in-game")`, false, 3000);
        await sleep(5600);                     // a look at what plays has come and gone
        check("Library puts the page away, and it stays away while the same game plays", [away, await b.ev(`document.body.classList.contains("in-game")`)], [false, false]);
        standIn();
        await b.clickSel("#now");
        check("the line saying what plays opens it again", await b.until(`document.body.classList.contains("in-game")`, true, 6000), true);
        fs.rmSync(runFile, { force: true });
        check("when the game ends, its page goes and the list is back",
              await b.until(`[document.body.classList.contains("in-game"), document.querySelectorAll("#list li").length > 0]`, [false, true], 9000), [false, true]);
        // Disconnect, at the top of every screen: asked once, since coming back takes the TV.
        await b.clickSel("#disc");
        check("Disconnect at the top asks first, saying the phone stays let in",
              await b.until(`(s => s.classList.contains("on") && /stays let in/.test(s.textContent))(document.getElementById("dsheet"))`, true, 3000), true);
        await b.clickSel("#d-no");
        check("Cancel leaves it as it was", [await b.until(`document.getElementById("dsheet").className`, "", 2000), (await api("api/phone.php")).on], ["", true]);
        await b.clickSel("#disc");
        await b.clickSel("#d-yes");
        check("Switch off there: the phone says it is disconnected and how to come back",
              await b.until(`/^Disconnected/.test(document.getElementById("said").textContent) && !document.getElementById("again").hidden && document.getElementById("disc").hidden`, true, 6000), true);
        await b.send("Emulation.clearDeviceMetricsOverride");
        await b.send("Network.deleteCookies", { name: "xsp", domain: "127.0.0.1" });
        phoneSized = false;
      } else {
        check("Disconnect from the phone is answered", (await ask(port, "/p/off", { body: {}, headers: own, cookie })).json.ok, true);
      }
      check("the PC's switch is then off and the phone page closes, the log naming the phone",
            await apiUntil(async () => {
              const s = await api("api/phone.php");
              const lines = ((await api("api/log.php?tail=400")).lines || []).filter((l) => /PHONE/.test(l));
              return !s.on && !s.up && lines.some((l) => l.includes("switched off from the phone (iPhone, Safari 18)"));
            }, 10000), true);
      await api("api/phone.php", { op: "on" });
      const back = await apiUntil(async () => { const s = await api("api/phone.php"); return s.up ? s : null; }, 20000);
      port = back ? back.port : port;
      own.Origin = "http://127.0.0.1:" + port;
      check("switched on again on the TV, the same phone is in with no square", (await ask(port, "/p/me", { cookie })).json.name, "iPhone, Safari 18");
      fs.rmSync(runFile, { force: true });
    } else { console.log("    (this data folder already holds documents: the playing game's page steps aside)"); }

    /* ---- the Connect a phone window --------------------------------------------------- */
    if (b) {
      await b.goto();
      await b.setView("grid");
      check("the top row shows the phone mark while the page is open", await b.until(`document.getElementById("phone-mark").hidden`, false, 6000), false);
      // Windows' answer and its shield question are stood in for: a test asks Windows nothing.
      const NO = { kind: "Public", open: false, why: "Windows has no yes for the phone page on Public networks" };
      const YES = { kind: "Public", open: true, why: "Windows lets phones reach the phone page on Public networks" };
      const windowsSays = (w) => b.ev(`(() => { window.__phWin = ${JSON.stringify(w)}; if (window.__phReal) { return; } window.__phReal = window.fetch; window.__phAsked = 0;
        window.fetch = function (u, o) {
          const say = (body) => Promise.resolve(new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }));
          if (String(u).indexOf("api/phone.php?windows=1") >= 0) { return say({ ok: true, windows: window.__phWin }); }
          if (String(u).indexOf("api/phone.php") >= 0 && o && o.method === "POST" && /"allow"/.test(String(o.body))) { window.__phAsked++; return say({ ok: true, asked: true }); }
          return window.__phReal.apply(this, arguments); }; })()`);
      const LINES = `[...document.querySelectorAll("#editor .pj-row")].slice(0, 2).map(r => [r.querySelector(".pj-job").textContent, (r.querySelector(".pj-set") || {}).textContent || null])`;
      await windowsSays(NO);
      await b.openBar("xsegon");
      await b.menuItem(/^Connect a phone\.\.\.$/);
      check("the round X's menu has Connect a phone..., which opens its window", await b.until(`(document.querySelector("#editor .panel-title") || {}).textContent`, "CONNECT A PHONE", 8000), "CONNECT A PHONE");
      check("while Windows shuts phones out no square is offered: the line has Ask Windows, and the words say the square comes after",
            await b.until(`[${LINES}, !!document.querySelector("#editor .ph-square"), /Windows is shutting phones out/.test((document.querySelector("#editor .ph-wait") || {}).textContent || "")]`,
                          [[["Phone page", "Switch off"], ["What Windows allows", "Ask Windows"]], false, true], 12000),
            [[["Phone page", "Switch off"], ["What Windows allows", "Ask Windows"]], false, true]);
      await b.ev(`[...document.querySelectorAll("#editor .pj-set")].find(x => x.textContent === "Ask Windows").click()`);
      check("Ask Windows asks", await b.until(`window.__phAsked`, 1, 4000), 1);
      await windowsSays(YES);
      check("once Windows says yes, the square comes by itself: 29 cells, black on white",
            await b.until(`(s => s ? [s.dataset.cells, s.querySelector("rect").getAttribute("fill"), s.querySelector("path").getAttribute("fill"), s.querySelector("path").getAttribute("d").length > 500] : null)(document.querySelector("#editor .ph-square"))`,
                          ["29", "#fff", "#000", true], 20000), ["29", "#fff", "#000", true]);
      check("and the Windows line has nothing left to press", await b.ev(LINES), [["Phone page", "Switch off"], ["What Windows allows", null]]);
      check("and the phone let in, with Remove",
            await b.ev(`[...document.querySelectorAll("#editor .pj-row")].slice(2).map(r => [r.querySelector(".pj-job").textContent, r.querySelector(".pj-set").textContent])`), [["iPhone, Safari 18", "Remove"]]);
      await b.ev(`[...document.querySelectorAll("#editor .pj-set")].find(x => x.textContent === "Remove").click()`);
      check("Remove takes it off the list, and the phone is shut out at its next question",
            [await b.until(`!!document.querySelector("#editor .ph-none")`, true, 6000), (await ask(port, "/p/me", { cookie })).status], [true, 401]);
      await b.ev(`document.querySelector("#editor .pj-row .pj-set").click()`);
      check("Switch off: the square goes, the mark goes, the line says Switch on",
            await b.until(`[!!document.querySelector("#editor .ph-square"), document.getElementById("phone-mark").hidden, document.querySelector("#editor .pj-row .pj-set").textContent]`, [false, true, "Switch on"], 8000),
            [false, true, "Switch on"]);
      await windowsSays(NO);
      await b.ev(`document.querySelector("#editor .pj-row .pj-set").click()`);
      check("switched on with Windows saying no, its question is brought up at once, with no button to find", await b.until(`window.__phAsked`, 2, 8000), 2);
      await b.until(`document.querySelector("#editor .pj-row .pj-set").textContent`, "Switch off", 6000);
      await b.ev(`document.querySelector("#editor .pj-row .pj-set").click()`);
      await b.until(`document.querySelector("#editor .pj-row .pj-set").textContent`, "Switch on", 6000);
      await b.ev(`window.fetch = window.__phReal; window.__phReal = null`);
      await b.key("Escape");
      await b.until(`document.getElementById("editor").hidden`);
    } else {
      check("removed, the phone is shut out at its next question",
            [(await api("api/phone.php", { op: "forget", id: st.phones[0].id })).forgot, (await ask(port, "/p/me", { cookie })).status], [1, 401]);
      await api("api/phone.php", { op: "off" });
    }
    check("switched off, nothing answers on its port any more, also after an on and an off pressed close together",
          await apiUntil(async () => (await ask(port, "/p/hello")).status === 0 && (await ask(port + 1, "/p/hello")).json.lane !== "phone" && !(await api("api/phone.php")).up, 12000), true);
  } finally {
    if (phoneSized && b) {
      await b.send("Emulation.clearDeviceMetricsOverride");
      await b.send("Network.deleteCookies", { name: "xsp", domain: "127.0.0.1" });
    }
    if (ranStandIn) { fs.rmSync(path.join(lib.DATA, "running.json"), { force: true }); }
    if (docsMade) {
      fs.rmSync(docsMade, { recursive: true, force: true });
      // The places the phone's booklet kept are put back as they were, for the groups after this one.
      if (placesWas) { fs.writeFileSync(placesFile, placesWas); } else { fs.rmSync(placesFile, { force: true }); }
    }
    await api("api/phone.php", { op: "off" });
    await api("api/settings.php", { window: { phoneStays: staysWas || "on" } });
  }
};
