/* RetroAchievements (includes\achievements.php, api\achievements.php, js\achsettings.js,
 * js\hardcoreask.js; roadmap AX).
 *
 * RetroArch's sign-in is played by data\fixtures\ra-cheevos.json (a test copy reads
 * nothing else), the site by a stand-in served from this process whose address is
 * written to data\fixtures\ra-api.txt; it refuses a wrong key with a 401 and an
 * unknown name with a 404, as the real one does. Nothing is asked of the real site.
 * The starts are dry runs.
 */
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");
const { api } = require("./lib");

const KEY = "StandInKey0123456789abcdefABCDEF";
const NAME = "StandInPlayer";
const PASSWORD = "pa55 word&secret";
const TOKEN = "tok3nStandIn99";

module.exports = async function (b, check) {
  const DATA = require("./lib").DATA;
  const fx = path.join(DATA, "fixtures");
  if (!fs.existsSync(fx)) {
    check("(live server: the achievements group needs a test copy)", true);
    return;
  }
  const cheevos = path.join(fx, "ra-cheevos.json"), apiFile = path.join(fx, "ra-api.txt"), kept = path.join(DATA, "achievements.json");
  const signIn = (k) => fs.writeFileSync(cheevos, JSON.stringify(Object.assign({ cheevos_enable: "true", cheevos_username: NAME, cheevos_hardcore_mode_enable: "true",
                                                                                 cheevos_password: "", cheevos_token: TOKEN }, k)));
  const clear = () => [cheevos, apiFile, kept].forEach((f) => fs.rmSync(f, { force: true }));
  clear();

  // ---- the stand-in site ----
  const asked = [];
  // What the stand-in answers for a console's games and for one game; infoDown plays the site not answering.
  const say = { list: [], info: null, infoDown: false };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const q = Object.fromEntries(u.searchParams);
    asked.push({ path: u.pathname, u: q.u, g: q.g, agent: req.headers["user-agent"] || "" });
    const send = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    // A badge's picture needs no key: a PNG's first bytes and its name.
    if (u.pathname.startsWith("/Badge/")) {
      res.writeHead(200, { "Content-Type": "image/png" });
      return res.end(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(path.basename(u.pathname))]));
    }
    if (q.y !== KEY) { return send(401, { message: "Unauthenticated.", errors: [{ status: "401", code: "unauthorized", title: "Unauthenticated." }] }); }
    if (u.pathname === "/API_GetUserProfile.php") {
      return q.u === NAME ? send(200, { User: NAME, TotalPoints: 1240, TotalSoftcorePoints: 35, RichPresenceMsg: "World 1-2", LastGameID: 1446 }) : send(404, []);
    }
    if (u.pathname === "/API_GetGameList.php") { return send(200, say.list); }
    if (u.pathname === "/API_GetGameInfoAndUserProgress.php") { return say.infoDown ? send(503, { message: "down" }) : send(200, say.info); }
    send(404, []);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  try {
    // ---- RetroArch's sign-in, as yes or no words ----
    let st = await api("api/achievements.php");
    check("a test copy with no sign-in written reads as not signed in", [st.ok, st.ra.step, st.ra.hardcoreOn, st.key, st.user], [true, "signin", false, false, null]);
    signIn({ cheevos_password: PASSWORD, cheevos_token: "" });
    st = await api("api/achievements.php");
    check("a password and no token: one game in RetroArch by itself is the next step", [st.ra.step, st.ra.password, st.ra.token, st.ra.name], ["finish", true, false, NAME]);
    check("and the password itself is never in the answer", JSON.stringify(st).includes(PASSWORD), false);
    signIn({});
    st = await api("api/achievements.php");
    check("a token: ready, with hardcore", [st.ra.step, st.ra.token, st.ra.hardcore, st.ra.hardcoreOn], ["ready", true, true, true]);
    check("and the token is never in the answer", JSON.stringify(st).includes(TOKEN), false);
    signIn({ cheevos_enable: "false" });
    check("signed in with achievements switched off says so", (await api("api/achievements.php")).ra.step, "off");
    signIn({ cheevos_hardcore_mode_enable: undefined });
    check("a file without the hardcore line plays hardcore, as RetroArch does", (await api("api/achievements.php")).ra.hardcoreOn, true);
    signIn({});

    // ---- the key ----
    check("a key that is not one is refused before anything is asked", [(await api("api/achievements.php", { key: "short!" })).ok, asked.length], [false, 0]);
    const unchecked = await api("api/achievements.php", { key: KEY });
    check("with no site to ask, a key is kept unchecked and the real site is never asked", [unchecked.ok, unchecked.kept, unchecked.checked, unchecked.key, asked.length], [true, true, false, true, 0]);
    check("forget drops it", [(await api("api/achievements.php", { forget: true })).key, fs.existsSync(kept)], [false, false]);

    fs.writeFileSync(apiFile, "http://127.0.0.1:" + server.address().port + "/");
    const wrong = await api("api/achievements.php", { key: "WrongKey0123456789abcdefABCDEFgh" });
    check("a key the site refuses is said in its words and not kept", [wrong.ok, /did not take that key/.test(wrong.error || ""), fs.existsSync(kept)], [false, true, false]);
    const right = await api("api/achievements.php", { key: KEY });
    check("the right key is kept and the site knows the name", [right.ok, right.checked, right.key, right.user && right.user.name, right.user && right.user.points], [true, true, true, NAME, 1240]);
    check("it asked for the name RetroArch is signed in with", asked[asked.length - 1].u, NAME);
    check("and said who is asking", /^Xsegon/.test(asked[asked.length - 1].agent), true);
    check("the key is sealed in the file, never written as it is", fs.readFileSync(kept, "utf8").includes(KEY), false);
    check("and never comes back from the server", JSON.stringify(await api("api/achievements.php")).includes(KEY), false);
    const n = asked.length;
    const again = await api("api/achievements.php", { check: true });
    check("Check again asks the site once more", [again.ok, again.user.softPoints, asked.length], [true, 35, n + 1]);
    signIn({ cheevos_username: "NobodyHere" });
    const nobody = await api("api/achievements.php", { check: true });
    check("a name the site does not know is said as that", [nobody.ok, /has no member called NobodyHere/.test(nobody.error || "")], [false, true]);
    signIn({});
    const logDir = path.join(DATA, "log");
    const logs = fs.existsSync(logDir) ? fs.readdirSync(logDir).map((f) => fs.readFileSync(path.join(logDir, f), "utf8")).join("\n") : "";
    check("the log says what was asked", /ACH .*asked GetUserProfile: HTTP 200/.test(logs), true);
    check("and never the key, the password or the token", [logs.includes(KEY), logs.includes(PASSWORD), logs.includes(TOKEN)], [false, false, false]);
    check("Get my key opens nothing in a test copy", await api("api/achievements.php", { open: "keys" }), { ok: true, url: "https://retroachievements.org/settings", dry: true });

    // ---- the page: Settings > Emulators > Achievements ----
    signIn({ cheevos_password: PASSWORD, cheevos_token: "" });
    await b.goto();
    await b.ev(`import("/js/settings-ui.js").then(m => m.openSettings("emulators"))`);
    const sect = `document.querySelector('#settings .set-page[data-group=emulators] .set-sect[data-sect="Achievements"]')`;
    check("Emulators has an Achievements section", await b.waitFor(`!!${sect} && ${sect}.querySelectorAll(".opt").length === 3`, 5000), true);
    check("its rows say what they hold", await b.ev(`[...${sect}.querySelectorAll(".opt label")].map(l => l.firstChild.textContent).join("|")`),
      "RetroArch's sign-in|Your RetroAchievements key|What RetroAchievements says");
    check("the sign-in row gives the step that is left", await b.until(`/Load any game in RetroArch by itself once/.test(${sect}.querySelector(".opt").textContent)`, true), true);
    check("with RetroArch one press away", await b.ev(`[...${sect}.querySelectorAll(".opt")][0].querySelector("button").textContent`), "Open RetroArch");
    check("the key row says it is kept, and offers to forget it", await b.ev(`[...${sect}.querySelectorAll(".opt")][1].querySelector("button").textContent`), "Forget it");
    check("the key is nowhere on the page", await b.ev(`document.documentElement.outerHTML.includes(${JSON.stringify(KEY)})`), false);
    check("the account row says what the site said", await b.ev(`/StandInPlayer: 1240 points in hardcore, 35 in softcore/.test([...${sect}.querySelectorAll(".opt")][2].textContent)`), true);

    // ---- hardcore before a start ----
    const lib = (await api("api/library.php")).games || [];
    let game = null;
    for (const g of lib.filter((x) => x.playable && !x.local && !x.steam).slice(0, 40)) {
      const d = await api("api/launch.php", { id: g.id, dry: true });
      if (d.ok && d.dry && Array.isArray(d.append) && /--appendconfig/.test(d.args || "") && !d.cheats) { game = g; break; }
    }
    if (!game) {
      check("(no RetroArch game without cheats here: the start checks step aside)", true);
    } else {
      signIn({});
      const ask = await api("api/launch.php", { id: game.id, slot: 0, dry: true, stateLoad: "session" });
      check("signed in with hardcore, a start from a save asks first", [ask.ok, ask.ask, ask.why, ask.slot, ask.dry], [true, "hardcore", "state", 0, undefined]);
      const soft = await api("api/launch.php", { id: game.id, slot: 0, dry: true, stateLoad: "session", hardcore: "soft" });
      check("softcore this time is one line for that run, never written back",
        [soft.ok, soft.dry, soft.append.includes('cheevos_hardcore_mode_enable = "false"'), soft.append.includes('config_save_on_exit = "false"')], [true, true, true, true]);
      const fresh = await api("api/launch.php", { id: game.id, dry: true });
      check("a fresh start with no cheats is not asked, and stays hardcore", [fresh.ok, fresh.dry, fresh.append.includes('cheevos_hardcore_mode_enable = "false"')], [true, true, false]);
      signIn({ cheevos_hardcore_mode_enable: "false" });
      check("with hardcore off nothing is asked", (await api("api/launch.php", { id: game.id, slot: 0, dry: true, stateLoad: "session" })).dry, true);
      fs.rmSync(cheevos, { force: true });
      check("and not signed in, nothing is asked", (await api("api/launch.php", { id: game.id, slot: 0, dry: true, stateLoad: "session" })).dry, true);
    }

    const cheatsFile = path.join(DATA, "cheats.json");
    const withCheats = fs.existsSync(cheatsFile) ? Object.entries(JSON.parse(fs.readFileSync(cheatsFile, "utf8"))).find(([, p]) => (p.on || []).length) : null;
    const cheatGame = withCheats && lib.find((g) => g.id === withCheats[0] && g.playable);
    if (!cheatGame) {
      check("(no playable game with cheats selected in this copy: the cheats checks step aside)", true);
    } else {
      signIn({});
      const ask = await api("api/launch.php", { id: cheatGame.id, dry: true });
      check("cheats selected with hardcore asks first", [ask.ask, ask.why], ["hardcore", "cheats"]);
      const without = await api("api/launch.php", { id: cheatGame.id, dry: true, hardcore: "nocheats" });
      check("without cheats: none applied, hardcore kept", [without.dry, without.cheats, without.append.includes('cheevos_hardcore_mode_enable = "false"')], [true, null, false]);
      const withThem = await api("api/launch.php", { id: cheatGame.id, dry: true, hardcore: "soft" });
      check("with them: applied, softcore for that run", [withThem.dry, !!withThem.cheats, withThem.append.includes('cheevos_hardcore_mode_enable = "false"')], [true, true, true]);
    }

    // ---- a game's Achievements tab ----
    // A disc console's sets are matched the site's own way, not yet here: the checks below take a cartridge.
    const LATER = /^(Sony Playstation( 2)?|Sony PSP|Sega CD|Sega Saturn|Sega Dreamcast|Nintendo GameCube|Nintendo DS|NEC TurboGrafx-(16|CD)|3DO Interactive Multiplayer|SNK Neo Geo CD|Microsoft MSX)$/;
    const tabGame = lib.find((x) => x.ach && x.playable && !x.local && !LATER.test(x.platform));
    check("a RetroArch game on a console the site has gets the tab, a game of your own does not",
      [!!tabGame, lib.filter((x) => x.local || x.steam).every((x) => !x.ach)], [true, true]);
    if (tabGame) {
      const tab = () => api("api/achievements.php?game=" + encodeURIComponent(tabGame.id));
      fs.rmSync(cheevos, { force: true });
      let t = await tab();
      check("not signed in, the tab answers with the step that is left", [t.ok, t.state, t.ra && t.ra.step], [true, "setup", "signin"]);
      signIn({});
      const laterGame = lib.find((x) => x.ach && LATER.test(x.platform));
      if (laterGame) {
        const l = await api("api/achievements.php?game=" + encodeURIComponent(laterGame.id));
        check("a disc console's game says Xsegon does not match its files yet", [l.state, l.why.includes(laterGame.platform)], ["later", true]);
      }
      say.list = [{ ID: 901, Title: tabGame.title, Hashes: ["00000000000000000000000000000000"] }];
      t = await tab();
      if (t.state === "unread") {
        check("(the game's file is not on this PC: the tab's checks step aside) " + t.why, true);
      } else {
        check("a file on no list of the site: no set, naming the set of that name made for another release", [t.state, t.alike], ["noset", [tabGame.title]]);
        const files = JSON.parse(fs.readFileSync(path.join(DATA, "achievements", "files.json"), "utf8"));
        const md5 = (files[tabGame.id] || {}).md5 || "";
        check("its checksum is kept, by its file", /^[0-9a-f]{32}$/.test(md5), true);
        // The list is kept a week: taken away so the next look asks again.
        fs.readdirSync(path.join(DATA, "achievements")).filter((f) => /^list-\d+\.json$/.test(f)).forEach((f) => fs.rmSync(path.join(DATA, "achievements", f)));
        say.list = [{ ID: 900, Title: "Stand-in Set", Hashes: [md5.toUpperCase()] }, { ID: 901, Title: "Stand-in Parent", Hashes: [] }];
        const ach = (id, title, points, badge, awarded, order, type, when) => ({ ID: id, Title: title, Description: title + ", the stand-in", Points: points, BadgeName: badge,
          NumAwarded: awarded, DisplayOrder: order, Type: type, DateEarned: when, DateEarnedHardcore: when });
        say.info = { ID: 900, Title: "Stand-in Set", ConsoleName: "Stand-in", ParentGameID: null, NumDistinctPlayers: 200,
                     Achievements: { 3: ach(3, "The End", 25, "333", 30, 3, "win_condition", null), 1: ach(1, "First", 5, "111", 150, 1, null, "2026-10-17 08:38:09"),
                                     2: ach(2, "Don't Miss", 10, "222", 3, 2, "missable", null) } };
        const before = asked.length;
        t = await tab();
        check("the file's checksum found on the site's list opens its set: every achievement in order, the earned one dated in UTC",
          [t.state, t.set.title, t.total, t.earned, t.points, t.pointsEarned, t.achievements.map((a) => [a.id, a.earned, a.hard, a.share, a.kind])],
          ["ok", "Stand-in Set", 3, 1, 40, 5, [[1, "2026-10-17T08:38:09Z", true, 75, ""], [2, null, false, 1.5, "missable"], [3, null, false, 15, "win_condition"]]]);
        check("asked for that set, for the name RetroArch is signed in with", asked.slice(before).filter((a) => /GetGameInfo/.test(a.path)).map((a) => [a.g, a.u]), [["900", NAME]]);
        check("and the answer names who is signed in, for the tab's Sign in or out", t.who, NAME);
        say.info.ParentGameID = 901;
        check("a side set says which game it belongs to", (await tab()).set.parent, { id: 901, title: "Stand-in Parent" });
        say.info.ParentGameID = null;
        say.infoDown = true;
        t = await tab();
        check("with no answer, the last one shows, saying when it was and why", [t.state, typeof t.asOf, /503/.test(t.why || ""), t.total], ["ok", "string", true, 3]);
        say.infoDown = false;

        const BASE = require("./lib").BASE;
        const pic = await fetch(BASE + "/api/achievements.php?badge=111");
        const body = Buffer.from(await pic.arrayBuffer());
        check("a badge's picture is served as a PNG, and kept", [pic.status, pic.headers.get("content-type"), body.slice(1, 4).toString(), fs.existsSync(path.join(DATA, "achievements", "badges", "111.png"))],
          [200, "image/png", "PNG", true]);
        await fetch(BASE + "/api/achievements.php?badge=222&grey=1");
        check("its grey copy is the site's _lock picture", [asked.some((a) => a.path === "/Badge/222_lock.png"), fs.existsSync(path.join(DATA, "achievements", "badges", "222_lock.png"))], [true, true]);
        check("a name that is not a badge's is refused", (await fetch(BASE + "/api/achievements.php?badge=..%2Fx")).status, 404);
        const other = lib.find((x) => !x.ach && x.playable);
        if (other) { check("a game without the tab is refused", (await api("api/achievements.php?game=" + encodeURIComponent(other.id))).ok, false); }

        // ---- the tab on the page ----
        await b.goto();
        await b.setView("list");
        await b.openPlatform(tabGame.platform);
        await b.ev(`import("/js/state.js").then((S) => { const i = S.games.findIndex((x) => x.id === ${JSON.stringify(tabGame.id)}); if (i >= 0) { S.setSel(i); } })`);
        await b.key("i");
        await b.waitFor(`!document.getElementById("details").hidden && !!document.querySelector("#details .dtabs")`, 8000);
        const TABS = `[...document.querySelectorAll("#details .dtabs .dtab")].map((x) => x.textContent)`;
        check("details has an Achievements tab, right after Hacks", await b.ev(`(t => t[t.indexOf("Hacks") + 1])(${TABS})`), "Achievements");
        await b.clickSel(`#details .dtab[data-tab="achievements"]`);
        const ROWS = `[...document.querySelectorAll("#details .dtab-pane.is-achievements .ach-item")]`;
        check("it shows how many are earned, and every achievement under a row that chooses what shows",
          [await b.until(`${ROWS}.length`, 3, 8000), await b.ev(`document.querySelector("#details .ach-top b").textContent`), await b.ev(`document.querySelector("#details .ach-show .cr-name").textContent`)],
          [3, "1 of 3 earned", "Show: All"]);
        check("the earned one in colour, the rest in their grey copy",
          await b.ev(`${ROWS}.map((r) => [r.querySelector(".cr-name").textContent, /grey=1/.test(r.querySelector("img").getAttribute("src"))])`),
          [["First", false], ["Don't Miss", true], ["The End", true]]);
        check("one that can be missed says so, the rarest wears its ring",
          await b.ev(`(r => [r.querySelector(".ach-why").textContent, r.querySelector(".ach-badge").classList.contains("rarest")])(${ROWS}[1])`),
          ["Can be missed: Don't Miss, the stand-in", true]);
        await b.ev(`document.querySelector("#details .ach-show").click()`);
        check("the first row, pressed, shows the earned ones", [await b.until(`document.querySelector("#details .ach-show .cr-name").textContent`, "Show: Earned"), await b.ev(`${ROWS}.length`)], ["Show: Earned", 1]);
        await b.ev(`document.querySelector("#details .ach-show").click()`);
        check("at the top, above the count, Sign in or out names who is signed in",
          await b.ev(`(r => !!r && [r.querySelector(".cr-name").textContent, r.querySelector(".cr-tag").textContent.startsWith("signed in as ${NAME}"),
                       r.getBoundingClientRect().bottom <= document.querySelector("#details .ach-top").getBoundingClientRect().top])(document.querySelector("#details .is-achievements .ach-sign"))`),
          ["Sign in or out", true, true]);
        check("Sign in or out's box is one row high, not stretched over the free room",
          await b.ev(`(r => r.parentElement.getBoundingClientRect().height - r.getBoundingClientRect().height <= 2)(document.querySelector("#details .is-achievements .ach-sign"))`), true);

        // Forty on the user's own page size: the list scrolls with its bar drawn, and ends above the strip.
        const many = {};
        for (let i = 1; i <= 40; i++) { many[i] = ach(i, "Number " + i, 5, "111", 50, i, null, i === 1 ? "2026-10-17 08:38:09" : null); }
        say.info.Achievements = many;
        await b.send("Emulation.setDeviceMetricsOverride", { width: 1536, height: 960, deviceScaleFactor: 1.25, mobile: false });
        try {
          await b.clickSel(`#details .dtab[data-tab="hacks"]`);
          await b.clickSel(`#details .dtab[data-tab="achievements"]`);
          await b.until(`${ROWS}.length`, 40, 8000);
          check("forty on a 1536 x 960 page: the list scrolls, its bar drawn at the right, its end above the strip",
            await b.ev(`(l => [l.scrollHeight > l.clientHeight, l.offsetWidth - l.clientWidth >= 10,
                         l.getBoundingClientRect().bottom <= innerHeight - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--strip-h")) || 0)])(document.querySelector("#details .ach-list"))`),
            [true, true, true]);
        } finally {
          await b.send("Emulation.clearDeviceMetricsOverride");
        }
        await b.ev(`document.querySelector("#details .ach-sign").click()`);
        check("Sign in or out, pressed, opens Settings > Emulators with the bar on RetroArch's sign-in",
          await b.until(`(r => !document.getElementById("settings").hidden && !!r && r.dataset.land === "achievements")(document.querySelector("#settings .opt.at"))`, true, 8000), true);
        await b.key("Escape");                 // out of Settings
        await b.until(`document.getElementById("settings").hidden`, true, 4000);
        // Out of the list and out of details, as far as each is still up.
        for (let i = 0; i < 2 && !(await b.ev(`document.getElementById("details").hidden`)); i++) { await b.key("Escape"); }
        await b.until(`document.getElementById("details").hidden`, true, 6000);
      }
    }
  } finally {
    await api("api/achievements.php", { forget: true });
    clear();
    server.close();
  }
};
