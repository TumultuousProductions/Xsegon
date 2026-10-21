/* The Media tab's compare (roadmap BM): one game's pictures, video and manual from every place, side
 * by side (api\mediachoice.php, bin\mediachoice.php, js\mediacompare.js).
 * Nothing goes online: the Games Database's pictures, libretro's lists and the Internet Archive's sets
 * are the sandbox's stand-ins (tests\sandbox.js), filled here with this test's own game; ScreenScraper
 * is listed with no login stored, so it is never asked. What is used is put back, and every theme is
 * worn once over the compare, its look left in tests\out (mediatab-<theme>.png) to be seen.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { api, DATA, Guard, sleep } = require("./lib");

const FX = path.join(DATA, "fixtures");
const SNES = "Super Nintendo Entertainment System";
const LR_SYS = "Nintendo - Super Nintendo Entertainment System";
const GAME = { id: "xs-scan-mctest1", title: "Mediatab Quest", platform: SNES, rom: path.join(FX, "roms-mc", "Mediatab Quest (USA).sfc"), added: new Date().toISOString() };
// Another game, for a press sent to a compare that is not its own.
const OTHER = { id: "xs-scan-mctest2", title: "Mediatab Other", platform: SNES, rom: path.join(FX, "roms-mc", "Mediatab Other (USA).sfc"), added: new Date().toISOString() };
const PNG = fs.readFileSync(path.join(__dirname, "..", "img", "xsegon-32.png"));
const pdf = (words) => Buffer.from("%PDF-1.4\n% a stand-in manual: " + words + "\n%%EOF\n");
// Enough of an MP4 for every check Xsegon makes of one: "ftyp" at the fifth byte.
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(12), Buffer.from("a stand-in video")]);
const md5 = (b) => crypto.createHash("md5").update(b).digest("hex");

/* A set of the Internet Archive's stand-in: its list of files, and the files. bad: the names whose checksum is another's. */
function archiveSet(id, files, bad) {
  const rows = [];
  for (const [name, bytes] of Object.entries(files)) {
    const file = path.join(FX, "archive", "download", id, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    rows.push({ name, source: "original", size: String(bytes.length), md5: [].concat(bad).includes(name) ? "0".repeat(32) : md5(bytes) });
  }
  fs.mkdirSync(path.join(FX, "archive", "metadata", id), { recursive: true });
  fs.writeFileSync(path.join(FX, "archive", "metadata", id, "files"), JSON.stringify({ result: rows }));
}

function makeAll() {
  fs.mkdirSync(path.dirname(GAME.rom), { recursive: true });
  fs.writeFileSync(GAME.rom, "not a game, a stand-in");
  fs.writeFileSync(OTHER.rom, "not a game either");
  // libretro: a folder per kind, each with its index page, and the covers of two releases.
  for (const [folder, names] of [["Named_Boxarts", ["Mediatab Quest (USA)", "Mediatab Quest (Europe)"]], ["Named_Titles", ["Mediatab Quest (USA)"]], ["Named_Snaps", []], ["Named_Logos", []]]) {
    const dir = path.join(FX, "libretro", "thumbs", LR_SYS, folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), names.map((n) => '<a href="' + encodeURIComponent(n + ".png") + '">' + n + "</a>").join("\n"));
    for (const n of names) { fs.writeFileSync(path.join(dir, n + ".png"), PNG); }
  }
  fs.rmSync(path.join(DATA, "libretro", LR_SYS + ".pictures.json"), { force: true });
  archiveSet("test-mc-doc-snes", { "Mediatab Quest (USA).pdf": pdf("usa"), "Mediatab Quest (Europe).pdf": pdf("europe"), "Mediatab Quest (Japan).pdf": pdf("japan") },
             "Mediatab Quest (Japan).pdf");
  archiveSet("test-mc-vid-snes", { "Mediatab Quest (USA).mp4": MP4 });
  fs.writeFileSync(path.join(DATA, "archivedoc-sets.json"), JSON.stringify({ sets: [{ id: "test-mc-doc-snes", folder: "snes", manuals: 3, mb: 1, title: "SNES manuals" }] }));
  fs.writeFileSync(path.join(DATA, "archivevid-sets.json"), JSON.stringify({ sets: [{ id: "test-mc-vid-snes", folder: "snes", whose: "test", videos: 1, mb: 1, title: "SNES snaps" }] }));
}

module.exports = async function (b, check) {
  const kept = new Guard(["scanned-games.json", "archivedoc-sets.json", "archivevid-sets.json", "overrides.json", "art-from.json", "art-hidden.json", "settings.json"]);
  const id = GAME.id;
  const mc = (q) => api("api/mediachoice.php?" + q);
  const post = (body) => api("api/mediachoice.php", body);
  const answered = async (ticket, ms = 20000) => {
    let r = null;
    for (const end = Date.now() + ms; Date.now() < end;) { r = await mc("ticket=" + ticket); if (!r.ok || r.done) { break; } await sleep(150); }
    return r || {};
  };
  const cameDown = async (ticket, ref, ms = 15000) => {
    let p = null;
    for (const end = Date.now() + ms; Date.now() < end;) { p = ((await mc("ticket=" + ticket)).prep || {})[ref]; if (p && p.state !== "running") { break; } await sleep(150); }
    return p || {};
  };
  const art = async () => (await api("api/art.php?id=" + id)).kinds.box;
  const doc = (name) => path.join(DATA, "documents", id, name);
  try {
    makeAll();
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), JSON.stringify([GAME, OTHER]));
    const linked = (await api("api/gamesdb.php?id=" + id + "&link=1047", null, "POST")).ok === true;

    /* ---- which places fit the game ------------------------------------------------ */
    const fit = await mc("id=" + id + "&places=1");
    const keys = (grp) => ((fit.places || {})[grp] || []).map((p) => p.key).sort().join(",");
    check("the places that fit a SNES game: pictures from the Games Database, libretro and ScreenScraper; the video and manual from the Internet Archive and ScreenScraper",
      [fit.ok, keys("pictures"), keys("videos"), keys("manuals")], [true, "gamesdb,libretro,ss", "archive,ss", "archive,ss"]);
    check("ScreenScraper with no login stored is listed, saying what it needs",
      /needs a free ScreenScraper account/.test(((fit.places.pictures || []).find((p) => p.key === "ss") || {}).note || ""), true);
    check("a kind that is not one is refused, and so is everything a place has without naming the place",
      [(await mc("id=" + id + "&kind=nope")).ok, (await mc("id=" + id + "&kind=all")).ok], [false, false]);

    /* ---- the box art: every place asked, a picture used and put back ---------------- */
    const box = await mc("id=" + id + "&kind=box");
    check("a compare starts with a ticket, every place that fits listed for Look in", [box.ok, /^[a-f0-9]{16}$/.test(box.ticket || ""), (box.fits || []).length], [true, true, 3]);
    const got = await answered(box.ticket);
    const place = (k) => (got.places || {})[k] || {};
    check("libretro answers with both releases' covers, the game's own first",
      [place("libretro").state, (place("libretro").items || []).map((it) => it.label)], ["done", ["USA", "Europe"]]);
    check("ScreenScraper is not asked without a login", place("ss").state, "account");
    if (linked) {
      check("the Games Database answers with its covers for the game", [place("gamesdb").state, (place("gamesdb").items || []).length > 0], ["done", true]);
    } else {
      check("the Games Database copy has no game 1047 here, so its covers are not checked", true);
    }
    const lr = (place("libretro").items || [])[0] || {};
    const seen = await fetch(require("./lib").BASE + "/" + lr.view);
    check("a choice is seen from the ticket's own folder: a stand-in is never handed to the page as a file address",
      [/^api\/mediachoice\.php\?ticket=/.test(lr.view || ""), seen.status, seen.headers.get("content-type")], [true, 200, "image/png"]);
    check("a file outside the ticket is not handed out", [(await fetch(require("./lib").BASE + "/api/mediachoice.php?ticket=" + box.ticket + "&file=..%5Cjob.json")).status,
      (await fetch(require("./lib").BASE + "/api/mediachoice.php?ticket=" + box.ticket + "&file=job.json.x")).status], [404, 404]);
    const used = await post({ ticket: box.ticket, ref: lr.ref, id, use: true });
    const now = await art();
    check("Use this one makes it the game's own box art, and says it came from libretro",
      [used.ok, used.kind, now.replaced, (now.from || {}).from], [true, "box", true, "libretro"]);
    const twice = await post({ ticket: box.ticket, ref: lr.ref, id, use: true });
    check("the same choice pressed again (a double press) changes nothing, so the one before it stays to put back",
      [twice.ok, /in use already/.test(twice.error || "")], [false, true]);
    const stray = await post({ ticket: box.ticket, ref: lr.ref, id: OTHER.id, use: true });
    check("a press for another game sent to this compare is refused, and that game is left as it was",
      [stray.ok, /another game/.test(stray.error || ""), (await api("api/art.php?id=" + OTHER.id)).kinds.box.replaced], [false, true, false]);
    check("the compare's own notes are never handed out (they hold paths and addresses)",
      (await fetch(require("./lib").BASE + "/api/mediachoice.php?ticket=" + box.ticket + "&file=job.json")).status, 404);
    if (linked) {
      const db = (place("gamesdb").items || [])[0];
      const again = await post({ ticket: box.ticket, ref: db.ref, id, use: true });
      check("and another in its place, from the Games Database", [again.ok, ((await art()).from || {}).from], [true, "gamesdb"]);
      const back1 = await post({ ticket: box.ticket, id, back: "box" });
      check("Put back the one before brings back the one before that, libretro's, with its words", [back1.ok, (await art()).replaced, ((await art()).from || {}).from], [true, true, "libretro"]);
      check("and a second Put back has nothing more: it undoes the last press only",
        /nothing to put back/.test((await post({ ticket: box.ticket, id, back: "box" })).error || ""), true);
      await api("api/art.php?id=" + id + "&kind=box&reset=1", null, "POST");
    } else {
      await post({ ticket: box.ticket, id, back: "box" });
    }
    check("back at the start: no box art of its own, and no words of where one came from", [(await art()).replaced, (await art()).from], [false, null]);
    check("a choice not in the compare is refused", (await post({ ticket: box.ticket, ref: "libretro:box:Nobody", id, use: true })).ok, false);

    /* ---- Look in: a place turned off is not asked -------------------------------------- */
    await api("api/settings.php", { library: { look: { pictures: ["libretro", "gamesdb", "ss", "steam"], videos: ["steam", "arcadedb", "archive", "ss"], manuals: ["archive", "ss"], off: ["pictures:gamesdb"] } } });
    const off = await mc("id=" + id + "&kind=box");
    check("a place turned off in Look in is listed but not asked, and the order is the person's",
      [(off.places || []).map((p) => p.key).join(","), (off.fits || []).map((p) => p.key + (p.on ? "" : " off")).join(",")], ["libretro,ss", "libretro,gamesdb off,ss"]);
    await post({ ticket: off.ticket, done: true });
    await api("api/settings.php", { library: { look: { pictures: ["steam", "gamesdb", "ss", "libretro"], videos: ["steam", "arcadedb", "archive", "ss"], manuals: ["archive", "ss"], off: [] } } });

    /* ---- the manual: brought down, used, kept beside, put back ----------------------------- */
    const man = await mc("id=" + id + "&kind=manual");
    const mans = await answered(man.ticket);
    const items = ((mans.places || {}).archive || {}).items || [];
    check("the Internet Archive's set is read, and every manual of the game in it offered", items.map((it) => it.label).sort(), ["Europe", "Japan", "USA"]);
    const usa = items.find((it) => it.label === "USA") || {}, eur = items.find((it) => it.label === "Europe") || {}, jpn = items.find((it) => it.label === "Japan") || {};
    check("a manual is not handed out before it has come down", (await post({ ticket: man.ticket, ref: usa.ref, id, use: true })).ok, false);
    await post({ ticket: man.ticket, ref: usa.ref, prepare: true });
    const p1 = await cameDown(man.ticket, usa.ref);
    check("brought down into the ticket, checked against the Archive's checksum", [p1.state, /&file=got-/.test(p1.view || "")], ["done", true]);
    await post({ ticket: man.ticket, ref: jpn.ref, prepare: true });
    const p3 = await cameDown(man.ticket, jpn.ref);
    check("one that comes damaged is refused, with why", [p3.state, /checksum/.test(p3.why || "")], ["failed", true]);
    const m1 = await post({ ticket: man.ticket, ref: usa.ref, id, use: true });
    check("used, it becomes the game's Manual.pdf, the Archive's file byte for byte",
      [m1.ok, m1.doc, fs.existsSync(doc("Manual.pdf")) && fs.readFileSync(doc("Manual.pdf")).equals(pdf("usa"))], [true, "Manual.pdf", true]);
    const dup = await post({ ticket: man.ticket, ref: usa.ref, id, use: true, how: "keep" });
    check("the same manual is never kept twice: Keep both with the one it has is refused, saying which it is",
      [dup.ok, /already, as Manual\.pdf/.test(dup.error || ""), fs.readdirSync(path.join(DATA, "documents", id)).filter((f) => /\.pdf$/i.test(f)).length], [false, true, 1]);
    await post({ ticket: man.ticket, ref: eur.ref, prepare: true });
    await cameDown(man.ticket, eur.ref);
    const m2 = await post({ ticket: man.ticket, ref: eur.ref, id, use: true, how: "keep" });
    check("Keep both puts the other beside it under a name of its own", [m2.ok, m2.doc, fs.existsSync(doc("Manual.pdf"))], [true, "Manual (Europe).pdf", true]);
    const mb = await post({ ticket: man.ticket, id, back: "manual" });
    check("Put back the one before takes the kept one away again", [mb.ok, fs.existsSync(doc("Manual (Europe).pdf")), fs.existsSync(doc("Manual.pdf"))], [true, false, true]);
    check("and with nothing more to put back, says so", /nothing to put back/.test((await post({ ticket: man.ticket, id, back: "manual" })).error || ""), true);
    fs.rmSync(path.join(DATA, "documents", id), { recursive: true, force: true });

    /* ---- the video ---------------------------------------------------------------------- */
    const vid = await mc("id=" + id + "&kind=video");
    const vids = await answered(vid.ticket);
    const v = ((((vids.places || {}).archive || {}).items) || [])[0] || {};
    check("the Internet Archive's snap is offered, to be seen from where it is", [v.label, !!v.view], ["USA", true]);
    await post({ ticket: vid.ticket, ref: v.ref, prepare: true });
    await cameDown(vid.ticket, v.ref);
    const vu = await post({ ticket: vid.ticket, ref: v.ref, id, use: true });
    const va = (await api("api/art.php?id=" + id)).video;
    check("used, it is the game's own video, from the Internet Archive", [vu.ok, va.has, (va.from || {}).from], [true, true, "archive"]);
    await post({ ticket: vid.ticket, id, back: "video" });
    check("put back, the game has no video again", (await api("api/art.php?id=" + id)).video.has, false);

    /* ---- Find any: every place that is on, for the kinds the game has none of ------------------- */
    check("Find any refuses a kind that is not one, and an empty list",
      [(await mc("id=" + id + "&find=box,nope")).ok, (await mc("id=" + id + "&find=")).ok], [false, false]);
    const fa = await mc("id=" + id + "&find=box,video,manual");
    check("Find any asks every place that is on for those kinds, in one ticket",
      [fa.ok, fa.kind, (fa.places || []).map((p) => p.key).sort().join(",")], [true, "find", "archive,gamesdb,libretro,ss"]);
    const fag = await answered(fa.ticket);
    const kindsOf = (k) => [...new Set((((fag.places || {})[k] || {}).items || []).map((it) => it.kind))].sort().join(",");
    check("each place answers with the kinds asked only: libretro its covers, the Internet Archive its video and its manuals together",
      [kindsOf("libretro"), kindsOf("archive")], ["box", "manual,video"]);
    // The manuals in the order Find any tries them: the first is made damaged below, so Apply must go on to the next good one.
    const manOrder = ((((fag.places || {}).archive || {}).items) || []).filter((it) => it.kind === "manual").map((it) => it.label);
    await post({ ticket: fa.ticket, done: true });

    /* ---- nothing kept: a closed compare's folder goes ---------------------------------------- */
    for (const t of [box.ticket, man.ticket, vid.ticket]) { await post({ ticket: t, done: true }); }
    check("every closed compare's folder is gone", [box.ticket, man.ticket, vid.ticket].map((t) => fs.existsSync(path.join(DATA, "mediachoice", t))), [false, false, false]);
    check("and a closed one says so when asked", /closed/.test((await mc("ticket=" + box.ticket)).error || ""), true);

    /* ---- the tab, the compare, and every theme over it ---------------------------------------- */
    await b.goto();
    await b.openPlatform(SNES);
    const there = await b.ev(`(async () => { const S = await import("/js/state.js"), V = await import("/js/views.js");
      const i = S.games.findIndex(g => g.id === ${JSON.stringify(id)}); if (i < 0) { return false; } S.setSel(i); V.render(); return true; })()`);
    check("the test game is on the list", there, true);
    await b.settled();
    await b.key("i");
    await b.waitFor(`!document.getElementById("details").hidden && !!document.querySelector("#details .dtabs")`, 8000);
    await b.ev(`document.querySelector('#details .dtab[data-tab="media"]').click()`);
    check("the Media tab opens on a card a kind", await b.until(`[...document.querySelectorAll("#details .mt-card")].map(n => n.dataset.kind).join(",")`,
      "box,box3d,logo,shot,fanart,video,manual", 8000), "box,box3d,logo,shot,fanart,video,manual");
    check("a picture with none says so", await b.ev(`document.querySelector('#details .mt-card[data-kind="box"] .mt-from').textContent`), "none yet");
    check("Everything one place has lists the places that fit, then Another game...",
      await b.ev(`[...document.querySelectorAll("#details .mt-places button")].map(n => n.textContent).join(",")`),
      (linked ? "ScreenScraper,Games Database,libretro" : "ScreenScraper,Games Database,libretro") + ",Internet Archive,Another game...");
    await b.ev(`document.querySelector('#details .mt-card[data-kind="box"]').click()`);
    check("the box art's compare opens, libretro's covers coming into the strip",
      await b.until(`document.querySelectorAll('#details .mc-group[data-place="libretro"] .mc-cand').length`, 2, 15000), 2);
    check("the first choice is shown at once beside Now, and Look in lists the places in order",
      await b.until(`[!!document.querySelector("#details .mc-this img"), [...document.querySelectorAll("#details .mc-place .mc-pname")].map(n => n.textContent).join(",")]`,
        [true, "Games Database,ScreenScraper,libretro"], 8000), [true, "Games Database,ScreenScraper,libretro"]);
    await b.ev(`document.querySelectorAll('#details .mc-group[data-place="libretro"] .mc-cand')[1].click()`);
    check("a choice pressed is the one beside Now", await b.until(`(document.querySelector("#details .mc-this .mc-cap") || {}).textContent`, "libretro  ·  Europe", 4000), "libretro  ·  Europe");
    await b.ev(`document.querySelector("#details .mc-use").click()`);
    check("Use this one: Now is it, kept, with a way back",
      await b.until(`[(document.querySelector("#details .mc-now .mc-cap") || {}).textContent, !!document.querySelector("#details .mc-putback")]`, ["libretro", true], 8000), ["libretro", true]);
    await b.ev(`document.querySelector("#details .mc-putback").click()`);
    check("and Put back the one before brings back none", await b.until(`(document.querySelector("#details .mc-now .mc-cap") || {}).textContent`, "none yet", 8000), "none yet");
    // The keys go down the choices, and moving onto one shows it.
    await b.ev(`document.querySelector("#details .dtab-pane").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
    const themes = ((await api("api/theme.php")).list || []).map((t) => t.id);
    const wears = `(() => { const t = document.querySelector("#details .mc-tab"); if (!t) { return null; }
      const probe = document.createElement("div"); probe.style.background = "var(--panel)"; probe.style.color = "var(--cyan)"; document.body.appendChild(probe);
      const want = getComputedStyle(probe), panel = want.backgroundColor, cyan = want.color; probe.remove();
      return [getComputedStyle(t.querySelector(".mc-look")).backgroundColor === panel, getComputedStyle(t.querySelector(".mc-kind.on")).backgroundColor === cyan]; })()`;
    const wrong = [];
    for (const theme of themes) {
      await b.ev(`import("/js/themes.js").then((m) => m.setTheme(${JSON.stringify(theme)}))`);
      await b.settled();
      await sleep(300);
      const w = await b.ev(wears);
      if (!w || !w[0] || !w[1]) { wrong.push(theme + ": " + JSON.stringify(w)); }
      await b.shot("mediatab-" + theme.replace(/[^a-z0-9]+/gi, "-"));
    }
    check("every theme dresses the compare in its own panel and highlight (" + themes.length + " looks, each in tests\\out)", wrong, []);
    await b.ev(`import("/js/themes.js").then((m) => m.setTheme("xsegon"))`);
    await b.ev(`document.querySelector("#details .mc-back").click()`);
    check("All media goes back to the cards", await b.until(`!!document.querySelector('#details .mt-card[data-kind="box"]')`, true, 8000), true);

    /* ---- Find any: what is missing, the first found of each, Apply ------------------------------- */
    const MISSING = "7 missing: Box art, 3D box, Clear logo, Screenshot, Fanart / background, Video, Manual";
    check("Find any sits by the help line saying what is missing, and the box art is still lit first",
      await b.ev(`[(document.querySelector("#details .mt-top .mt-find") || {}).textContent, (document.querySelector("#details .mt-findbox .mt-dim") || {}).textContent,
        !!document.querySelector('#details .mt-card[data-kind="box"].sel')]`), ["Find any", MISSING, true]);
    const findWears = `(() => { const f = document.querySelector("#details .mt-find"); if (!f) { return null; }
      const probe = document.createElement("div"); probe.style.background = "var(--cyan)"; document.body.appendChild(probe);
      const cyan = getComputedStyle(probe).backgroundColor; probe.remove();
      return getComputedStyle(f).backgroundColor === cyan; })()`;
    const findWrong = [];
    for (const theme of themes) {
      await b.ev(`import("/js/themes.js").then((m) => m.setTheme(${JSON.stringify(theme)}))`);
      await b.settled();
      await sleep(200);
      if (await b.ev(findWears) !== true) { findWrong.push(theme); }
      await b.shot("mediatab-find-" + theme.replace(/[^a-z0-9]+/gi, "-"));
    }
    check("every theme lights Find any in its own highlight (" + themes.length + " looks, each in tests\\out as mediatab-find-<theme>)", findWrong, []);
    await b.ev(`import("/js/themes.js").then((m) => m.setTheme("xsegon"))`);
    const badMan = [manOrder[0], "Japan"];
    const goodMan = manOrder.find((l) => !badMan.includes(l)) || "";
    archiveSet("test-mc-doc-snes", { "Mediatab Quest (USA).pdf": pdf("usa"), "Mediatab Quest (Europe).pdf": pdf("europe"), "Mediatab Quest (Japan).pdf": pdf("japan") },
               badMan.map((l) => "Mediatab Quest (" + l + ").pdf"));
    await b.ev(`document.querySelector("#details .mt-find").click()`);
    check("pressed, a row for each kind missing, and Apply above them",
      await b.until(`[document.querySelectorAll("#details .md-kind").length, (document.querySelector("#details .md-all .cr-name") || {}).textContent]`, [7, "Apply"], 8000), [7, "Apply"]);
    const firstPlace = linked ? "Games Database" : "libretro";
    check("the first found for each, from the places in Look in's order: box art from " + firstPlace + ", the manual and the video from the Internet Archive",
      await b.until(`(() => { const s = (k) => ((document.querySelector('#details .md-kind[data-kind="' + k + '"] .sv-sub') || {}).textContent || "").split("  ·  ")[0];
        return [s("box"), s("manual"), s("video")]; })()`, [firstPlace, "Internet Archive", "Internet Archive"], 20000),
      [firstPlace, "Internet Archive", "Internet Archive"]);
    await b.ev(`document.querySelector("#details .md-all").click()`);
    check("Apply takes them all: each row checked off with where it came from, and nothing more to take",
      await b.until(`[document.querySelector('#details .md-kind[data-kind="box"]').classList.contains("on"),
        (document.querySelector('#details .md-kind[data-kind="manual"] .sv-sub') || {}).textContent, (document.querySelector("#details .md-all .cr-tag") || {}).textContent]`,
        [true, "applied, from Internet Archive", "nothing more to take"], 30000), [true, "applied, from Internet Archive", "nothing more to take"]);
    const after = await api("api/art.php?id=" + id);
    const docsNow = fs.existsSync(path.join(DATA, "documents", id)) ? fs.readdirSync(path.join(DATA, "documents", id)).filter((f) => /\.pdf$/i.test(f)) : [];
    check("the game has them as its own, each saying where it came from, the manual as its Manual.pdf",
      [(after.kinds.box.from || {}).from, (after.video.from || {}).from, docsNow], [linked ? "gamesdb" : "libretro", "archive", ["Manual.pdf"]]);
    check("the first manual found came damaged, so Apply went on to the next good one (" + manOrder.join(", ") + "; " + manOrder[0] + " made damaged)",
      [!!goodMan, fs.existsSync(doc("Manual.pdf")) && fs.readFileSync(doc("Manual.pdf")).equals(pdf(goodMan.toLowerCase()))], [true, true]);
    const docsRead = await b.ev(`(async () => { const L = await import("/js/log.js");
      const lane = await L.api("api/game.php?id=${id}"), main = await (await fetch("api/game.php?id=${id}")).json();
      return [lane.ok && lane.game.documents.map(d => d.file).join(","), main.ok && main.game.documents.map(d => d.file).join(",")]; })()`);
    check("the game's documents list its new manual, through the fast lane and the main server alike", docsRead, ["Manual.pdf", "Manual.pdf"]);
    await b.ev(`document.querySelector("#details .md-back").click()`);
    check("back on the cards, the box art says where it came from, the Manual card shows the manual, and neither is missing",
      await b.until(`[(document.querySelector('#details .mt-card[data-kind="box"] .mt-from') || {}).textContent,
        !!document.querySelector('#details .mt-card[data-kind="manual"] .mt-paper'),
        /Box art|Video|Manual/.test((document.querySelector("#details .mt-findbox .mt-dim") || {}).textContent || "")]`, [firstPlace, true, false], 8000), [firstPlace, true, false]);
    await b.key("Escape");
  } finally {
    for (const k of ["box", "box3d", "logo", "shot", "fanart"]) { await api("api/art.php?id=" + id + "&kind=" + k + "&reset=1", null, "POST"); }
    await api("api/video-own.php?id=" + id + "&reset=1", null, "POST");
    fs.rmSync(path.join(DATA, "documents", id), { recursive: true, force: true });
    kept.restore();
  }
};
