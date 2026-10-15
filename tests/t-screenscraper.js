/* Pictures & Videos > ScreenScraper videos (includes\screenscraper.php, bin\screenscraper.ps1).
 *
 * Against a stand-in for ScreenScraper's API served from this process, on the
 * port tests\sandbox.js told the test server about. It checks logins the way
 * the real one does (a 403 naming which pair was wrong) and writes down every
 * question. Each way a game can end is fetched through the background worker.
 * Nothing is asked of ScreenScraper. Against --live only the read-only first
 * check runs, and the person's own logins are never read.
 */
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");
const { api, sleep, Guard } = require("./lib");

const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
// Every character that could break an address or a curl config line.
const LOGIN = { devid: "StandInDev77", devpassword: 'dev "p&ss\\w+rd% $1', user: "Test Member", password: "m&mber=p@ss #2" };
// Xsegon's own developer ID as the website serves it, and the one it is swapped for.
const SHARED = { devid: "XsegonOwnDev1", devpassword: 'own "s&cr\\t+% $9' };
const SHARED2 = { devid: "XsegonOwnDev2", devpassword: "swapped=p@ss #3" };
// An mp4's first bytes: a box length, then "ftyp".
const mp4 = (words) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(12), Buffer.from(words)]);

module.exports = async function (b, check) {
  const lib = require("./lib");
  const DATA = lib.DATA, BASE = lib.BASE;
  const first = await api("api/screenscraper.php");
  check("the list answers, and the account by name only (a password is yes or no)",
    first.ok && Array.isArray(first.games) && typeof first.account.devpassword === "boolean" && typeof first.account.password === "boolean", true);
  const fx = path.join(DATA, "fixtures", "ss");
  if (!fs.existsSync(fx)) {
    check("(live server: the fetch half is left to the test server)", true);
    return;
  }
  check("the test copy starts with no logins: the real ones are never copied", [first.account.ready, fs.existsSync(path.join(DATA, "screenscraper.json"))], [false, false]);
  check("every game listed has no video", first.games.every((g) => !g.has) && first.missing === first.games.length, true);
  const libAll = await api("api/library.php");
  const shown = new Map(libAll.games.map((g) => [g.id, g]));
  check("and the library agrees", first.games.filter((g) => shown.has(g.id) && shown.get(g.id).hasVideo).map((g) => g.title), []);

  // Six games on consoles ScreenScraper knows, no two of one name on one
  // console (the stand-in files its answers by console and name).
  const seen = new Set(), free = [];
  for (const g of first.games) {
    const k = g.system + "-" + key(g.title);
    if (g.system > 0 && !g.has && key(g.title) && !seen.has(k)) { seen.add(k); free.push(g); }
  }
  const withRom = free.filter((g) => g.rom && key(g.rom) !== key(g.title)).slice(0, 3);
  const rest = free.filter((g) => !withRom.includes(g)).slice(0, 3);
  if (withRom.length < 3 || rest.length < 3) {
    check("(fewer than six games without a video on this machine: the fetch half steps aside)", true);
    return;
  }
  const [B, C, F] = withRom, [A, D, E] = rest;

  // ---- the stand-in ----
  const asked = [];
  const say = { search: {}, rom: {}, media: {}, refuse: null, shared: null };
  let siteAsked = 0;
  const quota = { requeststoday: "12", maxrequestsperday: "20000", maxthreads: "1", id: LOGIN.user };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const q = Object.fromEntries(u.searchParams);
    asked.push({ path: u.pathname, q });
    const send = (code, body, type) => { res.writeHead(code, { "Content-Type": type || "text/plain; charset=utf-8" }); res.end(body); };
    // The website's copy of Xsegon's own developer ID, not ScreenScraper's.
    if (u.pathname === "/shared.json") {
      siteAsked++;
      return say.shared ? send(200, say.shared, "application/json") : send(404, "Not Found");
    }
    if (say.refuse) { return send(say.refuse.status, say.refuse.body); }
    if (u.pathname.startsWith("/media/")) {
      const m = say.media[path.basename(u.pathname)];
      return m ? send(200, m, Buffer.isBuffer(m) ? "video/mp4" : "text/plain") : send(404, "NOMEDIA");
    }
    if (![LOGIN, SHARED, SHARED2].some((d) => q.devid === d.devid && q.devpassword === d.devpassword)) {
      return send(403, "Erreur de login : Vérifier vos identifiants développeur !");
    }
    if (q.ssid !== LOGIN.user || q.sspassword !== LOGIN.password) { return send(403, "Erreur de login : Vérifier les identifiants utilisateurs !"); }
    const json = (response) => send(200, JSON.stringify({ header: { success: "true" }, response: Object.assign({ ssuser: quota }, response) }), "application/json");
    if (u.pathname === "/ssuserInfos.php") { return json({}); }
    if (u.pathname === "/jeuRecherche.php") {
      const jeux = say.search[q.systemeid + "-" + key(q.recherche)];
      return jeux ? json({ jeux }) : send(404, "Erreur : Jeu non trouvé !");
    }
    if (u.pathname === "/jeuInfos.php") {
      const jeu = say.rom[q.systemeid + "-" + key(q.romnom)];
      return jeu ? json({ jeu }) : send(404, "Erreur : Rom/Iso/Dossier non trouvée !");
    }
    send(400, "Erreur");
  });
  const port = Number(fs.readFileSync(path.join(fx, "port.txt"), "utf8"));
  await new Promise((ok, no) => { server.once("error", no); server.listen(port, "127.0.0.1", ok); });
  // As ScreenScraper hands an address back: the developer's login in it, the member's left blank.
  const media = (name) => "http://127.0.0.1:" + port + "/media/" + name + "?devid=x&devpassword=y&softname=z&ssid=&sspassword=&media=video";
  const named = (g, medias) => ({ id: "1", noms: [{ region: "jp", text: "Some Other Name" }, { region: "us", text: g.title.toUpperCase().replace(/[^A-Z0-9]+/g, " - ") }], medias });
  const video = (name, type) => ({ type: type || "video", url: media(name), format: "mp4" });

  say.media["a-norm.mp4"] = mp4("the normalised snap");
  say.media["a-plain.mp4"] = mp4("the plain snap");
  say.media["wrong.mp4"] = mp4("another game's snap");
  say.media["b.mp4"] = mp4("found by its ROM");
  say.media["e.mp4"] = "NOMEDIA";
  // A: two answers, the first another game entirely; its own has both kinds of video.
  say.search[A.system + "-" + key(A.title)] = [
    { id: "9", noms: [{ region: "us", text: A.title + " Championship Edition II" }], medias: [video("wrong.mp4")] },
    named(A, [{ type: "ss", url: media("shot.png"), format: "png" }, video("a-plain.mp4"), video("a-norm.mp4", "video-normalized")]),
  ];
  // B: the name finds nothing; its ROM's name does, and the answer is the same game.
  say.rom[B.system + "-" + key(B.rom)] = named(B, [video("b.mp4")]);
  // C: an empty answer the way ScreenScraper gives one, and nothing by ROM either.
  say.search[C.system + "-" + key(C.title)] = [{}];
  // D: the game is there, with pictures and no video.
  say.search[D.system + "-" + key(D.title)] = [named(D, [{ type: "ss", url: media("shot.png"), format: "png" }])];
  // E: a video is listed, and what comes down is not one.
  say.search[E.system + "-" + key(E.title)] = [named(E, [video("e.mp4")])];
  // F: its ROM's name answers with some other game, video and all.
  say.rom[F.system + "-" + key(F.rom)] = { id: "7", noms: [{ region: "us", text: "A Different Game Altogether" }], medias: [video("wrong.mp4")] };

  const vdir = path.join(DATA, "videos-screenscraper");
  const own = path.join(DATA, "video-own");
  const jobFile = path.join(DATA, "screenscraper-job.json");
  const guard = new Guard(["screenscraper-job.json", "screenscraper.json", "screenscraper-shared.dat"]);
  const ids = [A, B, C, D, E, F].map((g) => g.id);
  let ownMade = null;
  const finished = async () => {
    let st = null;
    for (const end = Date.now() + 60000; Date.now() < end;) {
      st = await api("api/screenscraper.php");
      if (st.job && st.job.state !== "running") { break; }
      await sleep(200);
    }
    return st;
  };
  try {
    // ---- the logins ----
    const early = await api("api/screenscraper.php", { ids });
    check("a fetch with no logins is refused, saying so", [early.ok, /logins/.test(early.error || "")], [false, true]);
    const badDev = await api("api/screenscraper.php", { account: Object.assign({}, LOGIN, { devpassword: "wrong" }) });
    check("a wrong developer password is said to be that", [badDev.ok, badDev.check.ok, /developer ID/.test(badDev.check.error)], [true, false, true]);
    const badUser = await api("api/screenscraper.php", { account: Object.assign({}, LOGIN, { password: "wrong" }) });
    check("and a wrong member password to be that", [badUser.check.ok, /member name/.test(badUser.check.error)], [false, true]);
    const good = await api("api/screenscraper.php", { account: LOGIN });
    check("the right ones are accepted, with today's count", [good.check.ok, good.check.today, good.check.max, good.account.ready], [true, 12, 20000, true]);
    const leak = (text) => text.includes(LOGIN.devpassword) || text.includes(LOGIN.password)
      || text.includes(JSON.stringify(LOGIN.devpassword).slice(1, -1)) || text.includes(encodeURIComponent(LOGIN.password));
    check("the answer never carries a password", leak(JSON.stringify(good)) || leak(JSON.stringify(await api("api/screenscraper.php"))), false);
    const kept = await api("api/screenscraper.php", { account: { devid: LOGIN.devid, devpassword: "", user: LOGIN.user, password: "" } });
    check("an empty password box keeps the stored password", kept.check.ok, true);
    check("softname says who is asking", asked.filter((a) => a.path === "/ssuserInfos.php").every((a) => a.q.softname === "Xsegon" && a.q.output === "json"), true);

    // ---- the plan ----
    const dry = await api("api/screenscraper.php", { ids: ids.concat(["not-a-game"]), dry: true });
    check("a dry run plans only games without a video", dry.ok && dry.plan.games.map((g) => g.id).sort(), ids.slice().sort());
    check("holds no login", leak(JSON.stringify(dry)) || JSON.stringify(dry).includes(LOGIN.devid), false);
    check("and starts nothing", fs.existsSync(jobFile), false);

    // ---- the fetch ----
    asked.length = 0;
    const go = await api("api/screenscraper.php", { ids });
    check("fetching starts in the background", [go.ok, go.count], [true, 6]);
    const st = await finished();
    const states = Object.fromEntries(((st.job && st.job.games) || []).map((g) => [g.id, g.state]));
    check("and finishes", st.job && st.job.state, "done");
    check("a game found by its name is saved", states[A.id], "done");
    const fileA = path.join(vdir, A.id + ".mp4");
    check("the normalised video, and not the other game's", fs.existsSync(fileA) && fs.readFileSync(fileA).toString("latin1").endsWith("the normalised snap"), true);
    check("a game found only by its ROM's name is saved", [states[B.id], fs.existsSync(path.join(vdir, B.id + ".mp4"))], ["done", true]);
    check("one ScreenScraper does not have is said, not failed", states[C.id], "none");
    check("one it has with no video is its own answer", states[D.id], "novideo");
    check("a download that is not a video is failed and not kept", [states[E.id], fs.existsSync(path.join(vdir, E.id + ".mp4"))], ["failed", false]);
    check("a ROM-name answer for another game is turned away", [states[F.id], fs.existsSync(path.join(vdir, F.id + ".mp4"))], ["none", false]);
    check("nothing half-downloaded is left", fs.readdirSync(vdir).filter((f) => !f.endsWith(".mp4")), []);
    const byName = asked.find((a) => a.path === "/jeuRecherche.php" && a.q.recherche === A.title);
    check("the game's name arrives whole, with its console's number", byName && byName.q.systemeid, String(A.system));
    const byRom = asked.find((a) => a.path === "/jeuInfos.php" && a.q.romnom === B.rom);
    check("and so does a ROM's file name", byRom && [byRom.q.systemeid, byRom.q.romtype], [String(B.system), "rom"]);
    check("every question carries both logins, exactly as typed",
      asked.filter((a) => !a.path.startsWith("/media/")).every((a) => a.q.devpassword === LOGIN.devpassword && a.q.sspassword === LOGIN.password), true);
    const down = asked.find((a) => a.path === "/media/a-norm.mp4");
    check("the download is made as the member", down && [down.q.ssid, down.q.sspassword], [LOGIN.user, LOGIN.password]);
    check("the other game's video was never asked for", asked.some((a) => a.path === "/media/wrong.mp4"), false);
    check("the day's count is passed on", [st.job.used, st.job.allowed], [12, 20000]);
    const logs = fs.readdirSync(path.join(DATA, "log")).map((f) => fs.readFileSync(path.join(DATA, "log", f), "utf8")).join("\n");
    check("no password in the job file or the log", leak(fs.readFileSync(jobFile, "utf8")) || leak(logs), false);
    check("and the log says how it went", /SSCR snaps: 2 saved, 2 not on ScreenScraper, 1 there with no video, 1 failed/.test(logs), true);

    const tried = (g) => (st.games.find((x) => x.id === g.id) || {}).tried;
    check("one ScreenScraper does not have, or has no video of, is kept apart; a failed one is not",
      [tried(C), tried(D), tried(E), tried(F)], ["none", "novideo", "", "none"]);
    const keptApart = await api("api/screenscraper.php", { ids: [D.id], dry: true });
    check("one kept apart can still be asked for again", keptApart.ok && keptApart.plan.games.map((g) => g.id), [D.id]);
    const rowA = st.games.find((g) => g.id === A.id);
    check("the saved snap is now that game's video", rowA && rowA.has, true);
    check("and two fewer are missing", st.missing, first.missing - 2);
    const served = await fetch(BASE + "/api/video.php?id=" + encodeURIComponent(A.id));
    check("it plays as the game's video snap", [served.status, (served.headers.get("content-type") || "").split(";")[0]], [200, "video/mp4"]);
    const libA = (await api("api/library.php")).games.find((g) => g.id === A.id);
    if (libA) {
      const hover = libA.videoUrl ? await fetch(BASE + "/" + libA.videoUrl, { headers: { Range: "bytes=0-9" } }) : { status: 0, headers: new Map() };
      check("and the address hover plays from answers with the video", [libA.hasVideo, hover.status, (hover.headers.get("content-type") || "").split(";")[0]], [true, 206, "video/mp4"]);
    }
    const again = await api("api/screenscraper.php", { ids: [A.id] });
    check("a game that has a video is never fetched again", again.ok, false);

    fs.mkdirSync(own, { recursive: true });
    ownMade = path.join(own, B.id + ".mp4");
    fs.writeFileSync(ownMade, "a video chosen by hand\r\n");
    const withOwn = await api("api/screenscraper.php");
    check("a video you chose wins, and its game leaves this list", withOwn.games.some((g) => g.id === B.id), false);
    fs.rmSync(ownMade, { force: true });
    ownMade = null;

    // ---- versions of one game share a name: asked once, the snap copied ----
    const taken = new Set([A, B, C, D, E, F].map((g) => g.system + "-" + key(g.title)));
    const sameName = {};
    for (const g of first.games) {
      const k = g.system + "-" + key(g.title);
      if (g.system > 0 && key(g.title) && !taken.has(k)) { (sameName[k] = sameName[k] || []).push(g); }
    }
    const twins = (Object.values(sameName).find((v) => v.length > 1) || []).slice(0, 2);
    if (twins.length === 2) {
      say.media["t.mp4"] = mp4("one snap for both versions");
      say.search[twins[0].system + "-" + key(twins[0].title)] = [named(twins[0], [video("t.mp4")])];
      asked.length = 0;
      await api("api/screenscraper.php", { ids: twins.map((g) => g.id) });
      const both = await finished();
      const files = twins.map((g) => path.join(vdir, g.id + ".mp4"));
      check("two versions of one game are both saved", both.job.games.map((g) => g.state), ["done", "done"]);
      check("with the same snap", files.every((f) => fs.existsSync(f)) && fs.readFileSync(files[0]).equals(fs.readFileSync(files[1])), true);
      check("and ScreenScraper asked once, not twice", [asked.filter((a) => a.path === "/jeuRecherche.php").length, asked.filter((a) => a.path === "/media/t.mp4").length], [1, 1]);
    } else {
      check("(no two versions of one game without a video here: the shared snap steps aside)", true);
    }

    // ---- not found by its name nor its file: its name as a file name (as ES-DE asks), then one word of it (roadmap AO) ----
    const longest = (t) => String(t).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !["the", "and"].includes(w.toLowerCase()))
      .reduce((best, w) => (w.length > best.length ? w : best), "");
    const used = new Set([A, B, C, D, E, F].concat(twins).map((g) => g.id));
    const spare = free.filter((g) => !used.has(g.id));
    const G = spare.find((g) => (!g.rom || key(g.rom) !== key(g.title)) && !say.rom[g.system + "-" + key(g.title)]);
    const H = spare.find((g) => g !== G && key(longest(g.title)) && key(longest(g.title)) !== key(g.title) && !say.search[g.system + "-" + key(longest(g.title))]
      && new Set(g.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !["the", "a", "an", "and"].includes(w))).size >= 2);
    if (!G || !H) {
      check("(not two more games without a video here: the last two ways step aside)", true);
    } else {
      say.media["g.mp4"] = mp4("found by its name as a file name");
      say.media["h.mp4"] = mp4("found by one word");
      say.rom[G.system + "-" + key(G.title)] = named(G, [video("g.mp4")]);
      const word = longest(H.title);
      // Its own page has its words in another order; the first answer only shares the word.
      say.search[H.system + "-" + key(word)] = [
        { id: "8", noms: [{ region: "us", text: word + " Deluxe Edition" }], medias: [video("wrong.mp4")] },
        { id: "6", noms: [{ region: "us", text: H.title.split(/\s+/).reverse().join(" ") }], medias: [video("h.mp4")] },
      ];
      asked.length = 0;
      await api("api/screenscraper.php", { ids: [G.id, H.id] });
      const late = await finished();
      const row = (g) => ((late.job && late.job.games) || []).find((x) => x.id === g.id) || {};
      check("a game its name and file name do not find is found by its name as a file name, as ES-DE asks",
        [row(G).state, row(G).by, asked.some((a) => a.path === "/jeuInfos.php" && a.q.romnom === G.title && a.q.systemeid === String(G.system))],
        ["done", "title as a file name", true]);
      check("and one only a word of its name finds, its words in another order, by its longest word",
        [row(H).state, row(H).by, asked.some((a) => a.path === "/jeuRecherche.php" && a.q.recherche === word)], ["done", "one word", true]);
      check("the snaps are theirs, and the game that only shares the word is turned away",
        [fs.readFileSync(path.join(vdir, G.id + ".mp4")).toString("latin1").endsWith("found by its name as a file name"),
         fs.readFileSync(path.join(vdir, H.id + ".mp4")).toString("latin1").endsWith("found by one word"),
         asked.some((a) => a.path === "/media/wrong.mp4")], [true, true, false]);
      const logsLate = fs.readdirSync(path.join(DATA, "log")).map((f) => fs.readFileSync(path.join(DATA, "log", f), "utf8")).join("\n");
      check("the log says how each was found", /SSCR snaps: 2 saved, 0 not on ScreenScraper, 0 there with no video, 0 failed; found by (title as a file name 1, one word 1|one word 1, title as a file name 1)/.test(logsLate), true);
    }

    // ---- a reason that would be the same for every game ends the run ----
    say.refuse = { status: 430, body: "Votre quota de scrape est dépassé pour aujourd'hui !" };
    await api("api/screenscraper.php", { ids: [C.id, D.id] });
    const spent = await finished();
    check("a spent quota stops the run and says so", [spent.job.state, /quota/.test(spent.job.error || "")], ["failed", true]);
    check("with the games it did not reach still waiting", spent.job.games.map((g) => g.state), ["waiting", "waiting"]);
    say.refuse = { status: 403, body: "Erreur de login : Vérifier vos identifiants développeur !" };
    await api("api/screenscraper.php", { ids: [C.id] });
    const refused = await finished();
    check("a login refused half way stops it the same way, naming which", [refused.job.state, /developer ID/.test(refused.job.error || "")], ["failed", true]);
    say.refuse = null;

    /* ---- the screen ---- */
    await b.goto();
    await b.setView("grid");
    await b.openBar("media");
    await b.menuItem(/ScreenScraper videos/);
    const title = `(document.querySelector("#editor .panel-title") || {}).textContent || ""`;
    check("Pictures & Videos > ScreenScraper videos opens the list", await b.until(title, "SCREENSCRAPER VIDEOS"), "SCREENSCRAPER VIDEOS");
    const listNow = await api("api/screenscraper.php");
    const lacking = listNow.games.filter((g) => !g.has).map((g) => g.id).sort().join(",");
    check("only the games with no video are listed", await b.until(`[...document.querySelectorAll("#editor .sv-row input")].map(x => x.value).sort().join(",")`, lacking), lacking);
    const rowOf = (id) => `[...document.querySelectorAll("#editor .sv-row")].find(r => r.querySelector("input").value === ${JSON.stringify(id)})`;
    check("a game with its snap saved is not listed at all", await b.ev(`[!${rowOf(A.id)}, !${rowOf(B.id)}]`), [true, true]);
    const where = (id) => `(r => !r ? "gone" : (t => !t ? "main" : t.hidden ? "apart, folded" : "apart")(r.closest(".st-tried")))(${rowOf(id)})`;
    check("those ScreenScraper found no video for are listed apart, folded away and not selected; a failed one stays on the main list",
      await b.ev(`[${where(C.id)}, ${where(D.id)}, ${where(F.id)}, ${where(E.id)}, ${rowOf(D.id)}.querySelector("input").checked]`),
      ["apart, folded", "apart, folded", "apart, folded", "main", false]);
    const dayOf = (g) => b.ev(`new Date(${(listNow.games.find((x) => x.id === g.id) || {}).triedAt || 0} * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })`);
    check("each says why, and the day it was asked",
      await b.ev(`[${rowOf(D.id)}, ${rowOf(F.id)}].map(r => r.querySelector(".sv-state").textContent)`),
      ["ScreenScraper has no video of it, asked " + await dayOf(D), "not found on ScreenScraper, asked " + await dayOf(F)]);
    await b.ev(`document.querySelector("#editor .st-apart-head button").click()`);
    check("Show unfolds them", await b.ev(where(D.id)), "apart");
    check("the stored login is named, its password never shown, and no developer ID", await b.ev(`(() => { const t = document.querySelector("#editor .ss-acct").textContent; return [t.includes(${JSON.stringify(LOGIN.user)}), t.includes(${JSON.stringify(LOGIN.devid)}), t.includes(${JSON.stringify(LOGIN.password)}), !!document.querySelector("#editor .ss-form")]; })()`), [true, false, false, false]);
    check("a run that stopped says why", await b.ev(`/stopped: ScreenScraper refused the developer ID/.test(document.querySelector("#editor .group-help").textContent)`), true);
    check("selecting one console selects only its games, and none kept apart", await b.ev(`(() => {
      const s = document.querySelector("#editor .ss-pick"), want = ${JSON.stringify("p:" + E.platform)};
      s.value = want; s.dispatchEvent(new Event("change"));
      const on = [...document.querySelectorAll("#editor .sv-row input:checked")];
      return on.length > 0 && on.every(i => "p:" + i.dataset.platform === want && !i.closest(".st-tried")) && /^Fetch \\d+ snaps?\\.\\.\\.$/.test(document.querySelector("#editor .ss-bar button").textContent);
    })()`), true);
    await b.ev(`document.querySelector("#editor .ss-bar button").click()`);
    const ask = `(document.querySelector(".setup-confirm h2") || {}).textContent || ""`;
    check("Fetch asks first, saying how many", await b.until(`/^Fetch \\d+ snaps?\\?$/.test(${ask})`), true);
    check("with from where, as whom and into which folder", await b.ev(`(() => { const t = document.querySelector(".setup-confirm").textContent; return /screenscraper\\.fr/.test(t) && t.includes(${JSON.stringify(LOGIN.user)}) && t.includes(${JSON.stringify(vdir)}); })()`), true);
    const jobBefore = fs.readFileSync(jobFile, "utf8");
    await b.key("Escape");
    check("Esc says no and starts nothing", await b.until(`!document.querySelector(".setup-confirm")`) && fs.readFileSync(jobFile, "utf8") === jobBefore, true);
    await b.ev(`[...document.querySelectorAll("#editor .ss-btns button")].find(x => /Change/.test(x.textContent)).click()`);
    check("Change shows the member's two boxes only, the password hidden and empty", await b.ev(`[...document.querySelectorAll("#editor .ss-form input")].map(i => i.type + ":" + i.value)`),
      ["text:" + LOGIN.user, "password:"]);
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`);

    // ---- Xsegon's own developer ID, from the website ----
    check("with a developer ID of your own, the website is never asked", siteAsked, 0);
    const phpExe = ((await api("api/status.php")).build || {}).phpExe;
    const siteFile = (dev) => require("child_process").execFileSync(phpExe, [path.join(__dirname, "ss-seal.php")], { input: JSON.stringify(dev), encoding: "utf8" });
    const keptFile = path.join(DATA, "screenscraper-shared.dat");
    const told = (text, d) => text.includes(d.devid) || text.includes(d.devpassword)
      || text.includes(encodeURIComponent(d.devpassword)) || text.includes(JSON.stringify(d.devpassword).slice(1, -1));
    const lastWho = () => asked.filter((a) => a.path === "/ssuserInfos.php").pop() || { q: {} };
    // The developer ID box emptied: its stored password stays, so only the ID decides.
    const memberOnly = { devid: "", devpassword: "", user: LOGIN.user, password: "" };

    const none = await api("api/screenscraper.php", { account: memberOnly });
    check("a member login alone, with the website down and nothing kept, says why", [none.check.ok, /could not be fetched.*none is kept/.test(none.check.error || ""), none.account.ready], [false, true, false]);
    say.shared = siteFile(SHARED);
    asked.length = 0;
    const fromSite = await api("api/screenscraper.php", { check: true });
    check("with the website up, Xsegon's own developer ID is fetched and accepted", [fromSite.check.ok, fromSite.account.shared, fromSite.account.ready], [true, true, true]);
    check("the question goes out with it exactly, and the member's own login", [lastWho().q.devid, lastWho().q.devpassword, lastWho().q.ssid, lastWho().q.softname], [SHARED.devid, SHARED.devpassword, LOGIN.user, "Xsegon"]);
    check("the page is never told it", told(JSON.stringify(fromSite), SHARED) || told(JSON.stringify(await api("api/screenscraper.php")), SHARED), false);
    const keptText = fs.existsSync(keptFile) ? fs.readFileSync(keptFile, "utf8") : "";
    check("the kept copy holds it sealed, not as text", [keptText.length > 60, told(keptText, SHARED)], [true, false]);
    say.shared = null;
    const offline = await api("api/screenscraper.php", { check: true });
    check("with the website down, the kept copy is used", [offline.check.ok, offline.account.shared, lastWho().q.devid], [true, true, SHARED.devid]);
    say.shared = siteFile(SHARED2);
    const swapped = await api("api/screenscraper.php", { check: true });
    check("a new one on the website is used at the next check", [swapped.check.ok, lastWho().q.devid, lastWho().q.devpassword], [true, SHARED2.devid, SHARED2.devpassword]);

    // The fetcher opens the kept copy itself.
    say.media["c.mp4"] = mp4("fetched with Xsegon's own developer ID");
    say.search[C.system + "-" + key(C.title)] = [named(C, [video("c.mp4")])];
    asked.length = 0;
    await api("api/screenscraper.php", { ids: [C.id] });
    const viaShared = await finished();
    check("a fetch with Xsegon's own developer ID saves the snap", [viaShared.job.state, viaShared.job.games.map((g) => g.state), fs.existsSync(path.join(vdir, C.id + ".mp4"))], ["done", ["done"], true]);
    const searched = asked.filter((a) => a.path === "/jeuRecherche.php");
    check("its questions carry the kept one, exactly", searched.length > 0 && searched.every((a) => a.q.devid === SHARED2.devid && a.q.devpassword === SHARED2.devpassword), true);
    const logsNow = fs.readdirSync(path.join(DATA, "log")).map((f) => fs.readFileSync(path.join(DATA, "log", f), "utf8")).join("\n");
    check("neither shared one is in the job file or the log", [SHARED, SHARED2].some((d) => told(fs.readFileSync(jobFile, "utf8"), d) || told(logsNow, d)), false);
    check("the log says where it came from", /SSCR Xsegon's own developer ID fetched from the website \(a new one\)/.test(logsNow) && /SSCR Xsegon's own developer ID: the website gave none \(it answered 404\); the kept copy is used/.test(logsNow), true);

    await b.goto();
    await b.setView("grid");
    await b.openBar("media");
    await b.menuItem(/ScreenScraper videos/);
    await b.until(title, "SCREENSCRAPER VIDEOS");
    check("with Xsegon's own developer ID the window names only the member, never the ID",
      await b.until(`(document.querySelector("#editor .ss-who") || {}).textContent === "ScreenScraper login stored: member " + ${JSON.stringify(LOGIN.user)} + "."`) &&
      await b.ev(`!/developer/i.test(document.querySelector("#editor .ss-acct").textContent)`), true);
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`);

    // A kept copy made on another computer, or changed, does not open.
    fs.writeFileSync(keptFile, JSON.stringify({ v: 1, sealed: Buffer.alloc(80, 7).toString("base64") }));
    say.shared = null;
    const foreign = await api("api/screenscraper.php", { check: true });
    check("a kept copy that does not open here is not used", [foreign.check.ok, foreign.account.shared, /none is kept/.test(foreign.check.error || "")], [false, false, true]);
    say.shared = siteFile(SHARED);
    const before = siteAsked;
    asked.length = 0;
    const mine = await api("api/screenscraper.php", { account: LOGIN });
    check("a developer ID of your own wins, and the website is not asked", [mine.check.ok, mine.account.shared, lastWho().q.devid, siteAsked - before], [true, false, LOGIN.devid, 0]);

    const gone = await api("api/screenscraper.php", { forget: true });
    check("Forget deletes the stored logins", [gone.ok, gone.account.ready, fs.existsSync(path.join(DATA, "screenscraper.json"))], [true, false, false]);
  } finally {
    if (ownMade) { fs.rmSync(ownMade, { force: true }); }
    fs.rmSync(vdir, { recursive: true, force: true });
    if (server.closeAllConnections) { server.closeAllConnections(); }
    await new Promise((r) => server.close(r));
    guard.restore();
  }
};
