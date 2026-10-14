// The phone page: its own small server, the square's code, what a phone may
// and may not ask, and the Connect a phone window. On a test copy the phone
// page opens on 127.0.0.1 and Windows is asked nothing.
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");
const lib = require("./lib");
const { api, apiUntil } = lib;

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
    const port = st.port, own = { Origin: "http://127.0.0.1:" + port, "X-Xsegon-Phone": "1" };

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
    check("the list: five things a game and nothing else of yours",
          [list.status, list.json.ok, games.length > 0, Object.keys(games[0] || {}).sort().join()], [200, true, true, "hasArt,id,platform,playable,title"]);
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
    } else { console.log("    (no game on the first page has a box: the picture check steps aside)"); }
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
    await api("api/phone.php", { op: "off" });
    await api("api/settings.php", { window: { phoneStays: staysWas || "on" } });
  }
};
