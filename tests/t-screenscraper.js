/* Get Media > ScreenScraper videos (includes\screenscraper.php, bin\screenscraper.ps1).
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
  const say = { search: {}, rom: {}, media: {}, refuse: null, shared: null, sharedOff: false };
  let siteAsked = 0;
  const sitePress = [];
  const quota = { requeststoday: "12", maxrequestsperday: "20000", maxthreads: "1", id: LOGIN.user };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const q = Object.fromEntries(u.searchParams);
    asked.push({ path: u.pathname, q });
    const send = (code, body, type) => { res.writeHead(code, { "Content-Type": type || "text/plain; charset=utf-8" }); res.end(body); };
    // The website's copy of Xsegon's own developer ID, not ScreenScraper's.
    if (u.pathname === "/shared.json") {
      siteAsked++;
      sitePress.push(q.press || "");
      // Past its daily limit the real page says "off" to a Fetch only.
      if (say.sharedOff && q.press === "fetch") { return send(200, JSON.stringify({ v: 1, off: true }), "application/json"); }
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
  const guard = new Guard(["screenscraper-job.json", "screenscraper.json", "screenscraper-shared.dat", "settings.json",
                           "scanned-games.json", "local-games.json", "archivedoc-none.json", "art-hidden.json", "getall-job.json"]);
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
    await b.getMedia(/ScreenScraper videos/);
    const title = `(document.querySelector("#editor .panel-title") || {}).textContent || ""`;
    check("Get Media > ScreenScraper videos opens the list", await b.until(title, "SCREENSCRAPER VIDEOS"), "SCREENSCRAPER VIDEOS");
    const listNow = await api("api/screenscraper.php");
    // Manuals too, when any game waits for a manual: selected at first, and kept the moment it is pressed.
    if (listNow.manuals) {
      check("Manuals too stands beside Fetch, selected, saying how many games it would bring a manual",
        await b.until(`(t => !!t && t.querySelector("input").checked && /^ Manuals too: \\d+ games? with no manual that the online archives could not fill$/.test(t.textContent))(document.querySelector("#editor .ss-manuals"))`, true), true);
      await b.ev(`document.querySelector("#editor .ss-manuals input").click()`);
      const keptOff = async () => { for (let i = 0; i < 30; i++) { if ((((await api("api/settings.php")).settings || {}).video || {}).ssManuals === false) { return true; } await sleep(100); } return false; };
      check("pressed, it is kept at once, and Fetch counts snaps alone", [await b.until(`!document.querySelector("#editor .ss-manuals input").checked`, true), await keptOff()], [true, true]);
    } else {
      check("(no game waits for a manual here: Manuals too is not looked at)", true);
    }
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
    // A game on a console ScreenScraper has no number for: its own group, last, folded at first.
    const off = listNow.games.find((g) => !g.has && !g.system);
    if (off) {
      const offAt = `(r => !r ? "gone" : (t => !t ? "main" : t.hidden ? "folded" : "shown")(r.closest(".st-nosys")))(${rowOf(off.id)})`;
      check("one on a console ScreenScraper does not have is in a group of its own, last, folded away and not selectable",
        await b.ev(`[${offAt}, !!${rowOf(off.id)}.closest(".st-apart:last-child"), ${rowOf(off.id)}.querySelector("input").disabled]`), ["folded", true, true]);
      check("its own Show unfolds it", await b.ev(`(() => { [...document.querySelectorAll("#editor .st-apart")].pop().querySelector(".st-apart-head button").click(); return ${offAt}; })()`), "shown");
    } else {
      check("(no game on a console ScreenScraper does not have here: that group is not looked at)", true);
    }
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

    // ---- manuals, with Manuals too: the Internet Archive's sets first, ScreenScraper for the rest (roadmap BK5) ----
    {
      const scanFile = path.join(DATA, "scanned-games.json"), ownFile = path.join(DATA, "local-games.json"), noneFile = path.join(DATA, "archivedoc-none.json");
      const wasScan = fs.readFileSync(scanFile), wasOwn = fs.existsSync(ownFile) ? fs.readFileSync(ownFile) : null;
      const docs = path.join(DATA, "documents");
      const X360 = "Microsoft Xbox 360", NES = "Nintendo Entertainment System";
      const mg = (n, title, platform, rom) => ({ id: "xs-scan-ssman" + n, title, platform, rom: path.join(fx, "roms-man", rom), added: new Date().toISOString() });
      const M = [mg(1, "Manual Quest One", X360, "Manual Quest One (USA).iso"),     // no set on the Archive: its manual is asked for alone
                 mg(2, "Manual Quest Two", NES, "Manual Quest Two (USA).nes"),      // the Archive has a set, not asked yet: left to it
                 mg(3, "Manual Quest Three", NES, "Manual Quest Three (USA).nes"),  // the Archive was asked and had none; here only in French
                 mg(4, "Manual Quest Four", X360, "Manual Quest Four (USA).iso"),   // what comes is not a PDF
                 mg(5, "Manual Quest Five", X360, "Manual Quest Five (USA).iso"),   // asked for its video too: one answer, both kept
                 mg(6, "Manual Quest Six", X360, "Manual Quest Six (USA).iso")];   // has a manual already
      const pdfOf = (w) => Buffer.from("%PDF-1.4\n% " + w + "\n%%EOF\n");
      const md5 = (bytes) => require("crypto").createHash("md5").update(bytes).digest("hex");
      const manualMedia = (name, region, bytes) => Object.assign({ type: "manuel", parent: "jeu", region, format: "pdf", url: media(name).replace("media=video", "media=manuel") },
        bytes ? { md5: md5(bytes) } : {});
      const manualOf = (g) => path.join(docs, g.id, "Manual.pdf");
      try {
        fs.mkdirSync(path.join(fx, "roms-man"), { recursive: true });
        for (const g of M) { fs.writeFileSync(g.rom, "not a game, a stand-in"); }
        fs.writeFileSync(scanFile, JSON.stringify(M));
        fs.writeFileSync(ownFile, "[]");
        fs.writeFileSync(noneFile, JSON.stringify({ [M[2].id]: { at: 1, why: "nothing by this name", title: M[2].title, platform: NES } }));
        fs.mkdirSync(path.dirname(manualOf(M[5])), { recursive: true });
        fs.writeFileSync(manualOf(M[5]), pdfOf("six, the person's own"));
        // The screen above may have pressed Manuals too off: it is set as this part assumes.
        await api("api/settings.php", { video: { ssManuals: true } });
        const listM = await api("api/screenscraper.php");
        const sys = (g) => ((listM.games || []).find((x) => x.id === g.id) || {}).system;
        say.media["m1-us.pdf"] = pdfOf("one, in English");
        say.media["m1-jp.pdf"] = pdfOf("one, in Japanese");
        say.media["m3-fr.pdf"] = pdfOf("three, in French");
        say.media["m4-us.pdf"] = "an error page, not a manual";
        say.media["m5-us.pdf"] = pdfOf("five, in English");
        say.media["m5.mp4"] = mp4("five's snap");
        say.search[sys(M[0]) + "-" + key(M[0].title)] = [named(M[0], [manualMedia("m1-jp.pdf", "jp"), manualMedia("m1-us.pdf", "us", say.media["m1-us.pdf"])])];
        say.search[sys(M[2]) + "-" + key(M[2].title)] = [named(M[2], [manualMedia("m3-fr.pdf", "fr")])];
        say.search[sys(M[3]) + "-" + key(M[3].title)] = [named(M[3], [manualMedia("m4-us.pdf", "us")])];
        say.search[sys(M[4]) + "-" + key(M[4].title)] = [named(M[4], [video("m5.mp4"), manualMedia("m5-us.pdf", "us", say.media["m5-us.pdf"])])];
        check("the manuals ScreenScraper may fetch: none where the Archive has a set it was not asked of, none where there is one, and Manuals too said as chosen",
          [listM.manuals, listM.manualsOn], [4, true]);
        const plan = (await api("api/screenscraper.php", { ids: [M[4].id], manuals: true, dry: true })).plan || { games: [] };
        check("a game asked for its video brings its manual in the same answer; the rest are asked for the manual alone",
          plan.games.map((g) => [g.id, g.video, g.manual]).sort(),
          [[M[0].id, false, true], [M[2].id, false, true], [M[3].id, false, true], [M[4].id, true, true]].sort());
        check("without Manuals too, no manual is asked for", ((await api("api/screenscraper.php", { ids: [M[4].id], dry: true })).plan || { games: [] }).games.map((g) => [g.id, g.manual]), [[M[4].id, false]]);
        asked.length = 0;
        const goM = await api("api/screenscraper.php", { ids: [M[4].id], manuals: true });
        check("the fetch starts, counting the snap and the manuals", [goM.ok, goM.count, goM.manuals], [true, 1, 4]);
        const endM = await finished();
        const rowM = (g) => ((endM.job && endM.job.games) || []).find((x) => x.id === g.id) || {};
        check("and ends with each game's video and manual said apart",
          [endM.job.state, [rowM(M[4]).state, rowM(M[4]).mstate], [rowM(M[0]).state, rowM(M[0]).mstate], rowM(M[2]).mstate, rowM(M[3]).mstate],
          ["done", ["done", "done"], ["manual", "done"], "other", "failed"]);
        check("the English manual is taken over another language, and each is the game's Manual.pdf, byte for byte",
          [fs.existsSync(manualOf(M[0])) && fs.readFileSync(manualOf(M[0])).equals(say.media["m1-us.pdf"]),
           fs.existsSync(manualOf(M[4])) && fs.readFileSync(manualOf(M[4])).equals(say.media["m5-us.pdf"]),
           fs.existsSync(path.join(vdir, M[4].id + ".mp4")), asked.some((a) => a.path === "/media/m1-jp.pdf")], [true, true, true, false]);
        check("one only in another language, and one that is not a PDF, leave nothing; a manual the person has is left as it is",
          [fs.existsSync(path.dirname(manualOf(M[2]))), fs.existsSync(path.dirname(manualOf(M[3]))), fs.readFileSync(manualOf(M[5])).equals(pdfOf("six, the person's own"))],
          [false, false, true]);
        const downM = asked.find((a) => a.path === "/media/m1-us.pdf");
        check("the manual is fetched as the member, and the game left to the Archive is never asked about",
          [downM && downM.q.ssid, asked.some((a) => a.path === "/jeuRecherche.php" && a.q.recherche === M[1].title)], [LOGIN.user, false]);
        const logsM = fs.readdirSync(path.join(DATA, "log")).map((f) => fs.readFileSync(path.join(DATA, "log", f), "utf8")).join("\n");
        check("the log says how the manuals went", /SSCR snaps: 1 saved, .*; manuals: 2 saved, 0 not on ScreenScraper, 0 there with no manual, 1 only in another language, 1 failed/.test(logsM), true);
        const barM = ((await api("api/jobs.php")).jobs || []).find((j) => j.key === "screenscraper") || {};
        check("the corner says the manuals too", /^1 snaps saved from ScreenScraper, and 2 manuals$/.test(barM.said || ""), true);
        check("two are left waiting for a manual", (await api("api/screenscraper.php")).manuals, 2);
      } finally {
        fs.writeFileSync(scanFile, wasScan);
        if (wasOwn === null) { fs.rmSync(ownFile, { force: true }); } else { fs.writeFileSync(ownFile, wasOwn); }
        fs.rmSync(noneFile, { force: true });
        for (const g of M) { fs.rmSync(path.join(docs, g.id), { recursive: true, force: true }); }
        fs.rmSync(path.join(fx, "roms-man"), { recursive: true, force: true });
      }
    }

    // ---- Get Media > Get Everything: one ScreenScraper pass for covers, videos and manuals (roadmap BL2) ----
    {
      const scanFile = path.join(DATA, "scanned-games.json"), ownFile = path.join(DATA, "local-games.json");
      const wasScan = fs.readFileSync(scanFile), wasOwn = fs.existsSync(ownFile) ? fs.readFileSync(ownFile) : null;
      const artDir = path.join(DATA, "art"), boxDir = path.join(DATA, "screenscraper-boxes"), docs = path.join(DATA, "documents");
      const X360 = "Microsoft Xbox 360", sys = 33;
      const cg = (n, title, rom) => ({ id: "xs-scan-ssall" + n, title, platform: X360, rom: path.join(fx, "roms-all", rom), added: new Date().toISOString() });
      const G = [cg(1, "Cover Quest One", "Cover Quest One (USA).iso"),       // a cover, a snap and a manual in one answer
                 cg(2, "Cover Quest Two", "Cover Quest Two (Japan).iso"),     // covers of two regions: the game's own is taken
                 cg(3, "Cover Quest Three", "Cover Quest Three (USA).iso"),   // has a cover of its own: not asked for one
                 cg(4, "Cover Quest Four", "Cover Quest Four (USA).iso"),     // what comes is not a picture
                 cg(5, "Cover Quest Five", "Cover Quest Five (USA).iso")];    // Use no picture on its cover: never asked for one
      const png1 = fs.readFileSync(path.join(lib.ROOT, "img", "xsegon-32.png")), png2 = fs.readFileSync(path.join(lib.ROOT, "img", "xsegon-180.png"));
      const typed = (type, name, region, format) => ({ type, region, format, url: media(name).replace("media=video", "media=" + type) });
      const boxOf = (g) => fs.readdirSync(artDir).filter((f) => f.startsWith(g.id + "-box."));
      const ownBox = path.join(artDir, G[2].id + "-box.png");
      const ga = (body) => api("api/getall.php", body);
      const setWays = (p, v, m) => api("api/settings.php", { library: { getPictures: p, getVideos: v, getManuals: m } });
      const gaUntil = async (test, ms) => { let r = null; for (const end = Date.now() + ms; Date.now() < end;) { r = await ga(); if (test(r)) { break; } await sleep(250); } return r; };
      const fakeRunning = () => fs.writeFileSync(jobFile, JSON.stringify({ state: "running", started: Math.floor(Date.now() / 1000), games: [] }));
      const fakeDone = () => fs.writeFileSync(jobFile, JSON.stringify({ state: "done", started: Math.floor(Date.now() / 1000), games: [], logged: true }));
      // A day log the server is writing at that moment can be locked for a moment: read again shortly.
      const readLog = (f) => {
        for (let i = 0; ; i++) {
          try { return fs.readFileSync(path.join(DATA, "log", f), "utf8"); } catch (e) {
            if (e.code !== "EBUSY" || i >= 20) { throw e; }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
          }
        }
      };
      const logs = () => fs.readdirSync(path.join(DATA, "log")).map(readLog).join("\n");
      try {
        fs.mkdirSync(path.join(fx, "roms-all"), { recursive: true });
        for (const g of G) { fs.writeFileSync(g.rom, "not a game, a stand-in"); }
        fs.writeFileSync(scanFile, JSON.stringify(G));
        fs.writeFileSync(ownFile, "[]");
        fs.writeFileSync(path.join(DATA, "art-hidden.json"), JSON.stringify({ [G[4].id]: ["box"] }));
        fs.mkdirSync(artDir, { recursive: true });
        fs.writeFileSync(ownBox, png2);
        Object.assign(say.media, { "c1-us.png": png1, "c2-us.png": png1, "c2-jp.png": png2, "c3-us.png": png1, "c4-us.png": "an error page, not a picture",
                                   "c5-us.png": png1, "c1.mp4": mp4("one's snap"), "c1-us.pdf": Buffer.from("%PDF-1.4\n% one\n%%EOF\n") });
        say.search[sys + "-" + key(G[0].title)] = [named(G[0], [typed("box-2D", "c1-us.png", "us", "png"), video("c1.mp4"), typed("manuel", "c1-us.pdf", "us", "pdf")])];
        say.search[sys + "-" + key(G[1].title)] = [named(G[1], [typed("box-2D", "c2-us.png", "us", "png"), typed("box-2D", "c2-jp.png", "jp", "png")])];
        say.search[sys + "-" + key(G[2].title)] = [named(G[2], [typed("box-2D", "c3-us.png", "us", "png")])];
        say.search[sys + "-" + key(G[3].title)] = [named(G[3], [typed("box-2D", "c4-us.png", "us", "png")])];
        say.search[sys + "-" + key(G[4].title)] = [named(G[4], [typed("box-2D", "c5-us.png", "us", "png")])];

        await setWays("free-ss", "free-ss", "free-ss");
        const first = await ga();
        check("Get everything missing knows the account by name, and each kind starts as the free sources, then ScreenScraper",
          [first.ok, first.account, first.user, first.ways], [true, true, LOGIN.user, { pictures: "free-ss", videos: "free-ss", manuals: "free-ss" }]);
        if (b) {
          await b.getMedia(/^Every missing cover/);
          check("Get Media opens it from its first row, a choice beside each kind and the account by name",
            await b.until(`[document.querySelector("#editor .panel-title").textContent, [...document.querySelectorAll("#editor .gm-inner select")].map(s => s.value),
                            [...document.querySelectorAll("#editor .gm-inner .opt label")].map(l => l.textContent).join("|")]`,
              ["GET EVERYTHING MISSING", ["free-ss", "free-ss", "free-ss"], "Pictures|Videos|Manuals|Signed in as " + LOGIN.user + "|Fetch everything missing"], 5000),
            ["GET EVERYTHING MISSING", ["free-ss", "free-ss", "free-ss"], "Pictures|Videos|Manuals|Signed in as " + LOGIN.user + "|Fetch everything missing"]);
          await b.ev(`(s => { s.value = "ss"; s.dispatchEvent(new Event("change")); })(document.querySelectorAll("#editor .gm-inner select")[1])`);
          const keptSs = async () => { for (let i = 0; i < 30; i++) { if ((((await api("api/settings.php")).settings || {}).library || {}).getVideos === "ss") { return true; } await sleep(100); } return false; };
          check("a choice is kept the moment it is made", await keptSs(), true);
          await b.key("Escape");
        }

        await setWays("ss", "ss", "ss");
        const allSs = await ga({ start: true, dry: true });
        check("ScreenScraper alone: no free source, one pass at once for every kind, a cover asked for only where there is none and none was left empty",
          [allSs.ok, allSs.job.parts.length, allSs.job.ss.state, allSs.job.ss.waitOn, allSs.job.ss.kinds, allSs.job.ss.games], [true, 0, "started", [], { box: true, video: true, manual: true }, 5]);
        await setWays("free-ss", "free", "free-ss");
        const after = await ga({ start: true, dry: true });
        const fillPart = (after.job.parts || []).find((p) => p.key === "fill") || {};
        check("free sources first: Get Pictures starts, and ScreenScraper waits for it, for covers and manuals only",
          [fillPart.state, after.job.ss.state, after.job.ss.waitOn, after.job.ss.kinds], ["started", "waiting", ["fill"], { box: true, video: false, manual: true }]);
        await setWays("free", "free", "free");
        check("the free sources only: no ScreenScraper", (await ga({ start: true, dry: true })).job.ss, null);

        // A real pass, ScreenScraper alone.
        await setWays("ss", "ss", "ss");
        asked.length = 0;
        const go = await ga({ start: true });
        check("Start begins the pass at once", [go.ok, go.job.ss.state], [true, "started"]);
        const end = await finished();
        const row = (g) => ((end.job && end.job.games) || []).find((x) => x.id === g.id) || {};
        check("each cover is said apart: the game's own region taken, one that is not a picture failed",
          [end.job.state, row(G[0]).bstate, row(G[1]).bstate, row(G[1]).bregion, row(G[2]).box, row(G[3]).bstate, row(G[4]).box],
          ["done", "done", "done", "jp", false, "failed", false]);
        check("and stored as each game's box byte for byte; a cover of its own, or one left empty, is never touched; nothing waits in the holding folder",
          [fs.readFileSync(path.join(artDir, G[0].id + "-box.png")).equals(png1), fs.readFileSync(path.join(artDir, G[1].id + "-box.png")).equals(png2),
           fs.readFileSync(ownBox).equals(png2), boxOf(G[3]), boxOf(G[4]), fs.existsSync(boxDir) ? fs.readdirSync(boxDir) : []],
          [true, true, true, [], [], []]);
        check("the covers of the game with one, and of the one left empty, are never fetched",
          [asked.some((a) => a.path === "/media/c3-us.png"), asked.some((a) => a.path === "/media/c5-us.png"), asked.some((a) => a.path === "/media/c2-us.png")], [false, false, false]);
        check("the same answer brought the first game's snap and manual",
          [fs.existsSync(path.join(vdir, G[0].id + ".mp4")), fs.existsSync(path.join(docs, G[0].id, "Manual.pdf"))], [true, true]);
        check("and the library shows the covers", ((await api("api/library.php")).games || []).filter((g) => g.id === G[0].id || g.id === G[1].id).map((g) => g.hasArt), [true, true]);
        const doneGa = await gaUntil((r) => r.job && r.job.state === "done", 5000);
        check("Get everything missing then ends, its bar naming what ran", [doneGa.job.state, doneGa.job.said], ["done", "ScreenScraper is through, and each bar says what came"]);
        const barSs = ((await api("api/jobs.php")).jobs || []).find((j) => j.key === "screenscraper") || {};
        check("ScreenScraper's bar counts the covers", /, 1 manual and 2 covers$/.test(barSs.said || ""), true);
        check("the log says how it went",
          [/SSCR covers: 2 stored as boxes/.test(logs()), /GALL started no free source; ScreenScraper for covers, videos and manuals: started/.test(logs()),
           /GALL ended: ScreenScraper is through/.test(logs())], [true, true, true]);

        // A fetch of its own at work already: the pass waits for it, then reads what is left.
        fakeRunning();
        const w = await ga({ start: true });
        check("with ScreenScraper fetching already, the pass waits for it", [w.ok, w.job.ss.state, w.job.ss.waitOn], [true, "waiting", ["screenscraper"]]);
        const barGa = ((await api("api/jobs.php")).jobs || []).find((j) => j.key === "getall") || {};
        check("and its bar says ScreenScraper comes after", [barGa.state, /ScreenScraper once the free sources are$/.test(barGa.line || "")], ["running", true]);
        const waiting = await gaUntil((r) => r.job && r.job.pid > 0, 8000);
        check("a worker of its own waits", [waiting.job.ss.state, waiting.job.pid > 0], ["waiting", true]);
        fakeDone();
        const goneOn = await gaUntil((r) => r.job && r.job.ss.state !== "waiting", 15000);
        check("once that fetch is through, the pass starts", goneOn.job.ss.state, "started");
        await finished();
        check("and the log says so", /GALL the free sources are through; ScreenScraper: started/.test(logs()), true);

        // Stop while it waits: ScreenScraper is never asked.
        await gaUntil((r) => r.job && r.job.state === "done", 5000);
        fakeRunning();
        const s1 = await ga({ start: true });
        const stopped = await ga({ stop: true });
        check("Stop while it waits ends it, nothing asked of ScreenScraper",
          [s1.job.ss.state, stopped.job.state, stopped.job.ss.state, stopped.job.said], ["waiting", "done", "failed", "Stopped: what came is kept"]);
        await sleep(2500);
        check("and the fetch at work is left alone", JSON.parse(fs.readFileSync(jobFile, "utf8")).games.length, 0);
        fakeDone();

        // Without an account: the free sources alone, and no choice to make.
        const accFile = path.join(DATA, "screenscraper.json"), accAway = accFile + ".away";
        fs.renameSync(accFile, accAway);
        try {
          check("with no ScreenScraper account, every kind comes from the free sources", [(await ga()).account, (await ga()).ways], [false, { pictures: "free", videos: "free", manuals: "free" }]);
          if (b) {
            await b.getMedia(/^Every missing cover/);
            check("and the window has no choice to make, and offers the sign-in",
              await b.until(`[document.querySelectorAll("#editor .gm-inner select").length, [...document.querySelectorAll("#editor .gm-inner .su-note")].filter(n => n.textContent === "free sources").length,
                              [...document.querySelectorAll("#editor .gm-inner button")].some(x => x.textContent === "Sign in...")]`, [0, 3, true], 5000), [0, 3, true]);
            await b.key("Escape");
          }
        } finally {
          fs.renameSync(accAway, accFile);
        }
      } finally {
        fs.writeFileSync(path.join(DATA, "getall-stop"), "");     // a wait left by a check that failed ends here
        fs.writeFileSync(scanFile, wasScan);
        if (wasOwn === null) { fs.rmSync(ownFile, { force: true }); } else { fs.writeFileSync(ownFile, wasOwn); }
        for (const g of G) {
          for (const f of fs.existsSync(artDir) ? boxOf(g) : []) { fs.rmSync(path.join(artDir, f), { force: true }); }
          fs.rmSync(path.join(docs, g.id), { recursive: true, force: true });
        }
        fs.rmSync(boxDir, { recursive: true, force: true });
        fs.rmSync(path.join(fx, "roms-all"), { recursive: true, force: true });
      }
    }

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
    check("a fetch with Xsegon's own developer ID saves the snap",
      [viaShared.job.state, viaShared.job.games.map((g) => g.state), fs.existsSync(path.join(vdir, C.id + ".mp4")), viaShared.job.error || ""], ["done", ["done"], true, ""]);
    const searched = asked.filter((a) => a.path === "/jeuRecherche.php");
    check("its questions carry the kept one, exactly", searched.length > 0 && searched.every((a) => a.q.devid === SHARED2.devid && a.q.devpassword === SHARED2.devpassword), true);
    const logsNow = fs.readdirSync(path.join(DATA, "log")).map((f) => fs.readFileSync(path.join(DATA, "log", f), "utf8")).join("\n");
    check("neither shared one is in the job file or the log", [SHARED, SHARED2].some((d) => told(fs.readFileSync(jobFile, "utf8"), d) || told(logsNow, d)), false);
    check("the log says where it came from", /SSCR Xsegon's own developer ID fetched from the website \(a new one\)/.test(logsNow) && /SSCR Xsegon's own developer ID: the website gave none \(it answered 404\); the kept copy is used/.test(logsNow), true);

    // The website counts only a Fetch; past its daily limit it answers "off" to one.
    check("each ask of the website says which press it was", [...new Set(sitePress)].sort(), ["check", "fetch", "save"]);
    say.sharedOff = true;
    asked.length = 0;
    const paused = await api("api/screenscraper.php", { ids: [A.id] });
    check("past the website's daily limit a Fetch is refused, kept copy or not, and says why",
      [paused.ok, /^ScreenScraper videos are paused for today; the other video sources still work$/.test(paused.error || ""), asked.filter((a) => a.path !== "/shared.json").length], [false, true, 0]);
    const stillChecks = await api("api/screenscraper.php", { check: true });
    check("Check the login is still answered then", [stillChecks.check.ok, stillChecks.account.shared], [true, true]);
    const logsPaused = fs.readdirSync(path.join(DATA, "log")).map((f) => fs.readFileSync(path.join(DATA, "log", f), "utf8")).join("\n");
    check("the log says the website paused it", /SSCR Xsegon's own developer ID: the website says fetches are paused for today/.test(logsPaused), true);
    say.sharedOff = false;

    await b.goto();
    await b.setView("grid");
    await b.getMedia(/ScreenScraper videos/);
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
