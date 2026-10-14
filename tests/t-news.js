/* What changed while you were away, and the mailbox it is kept in.
 * The feature compares against a remembered snapshot, so the test WRITES one:
 * a real game left out (read as added) and two that do not exist (read as
 * gone). library-seen.json and messages.json are in run.js's protected list,
 * so a crash cannot leave the real snapshot standing on a test fixture.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, BASE, DATA, sleep, romDrive } = require("./lib");

const SEEN = path.join(DATA, "library-seen.json");
const MSGS = path.join(DATA, "messages.json");

module.exports = async function (b, check) {
  /* The missing-file half below needs a game whose file is gone, so one is
     made in the run's copy: a scanned row whose ROM does not exist, put back
     in the finally. */
  const SCANNED = path.join(DATA, "scanned-games.json");
  const scanWas = fs.existsSync(SCANNED) ? fs.readFileSync(SCANNED) : null;
  const injected = { id: "xs-scan-newsgone0000", title: "Xsfix Gone", platform: "Nintendo 64",
                     rom: path.join(DATA, "no-such-folder", "Xsfix Gone (USA).z64"), added: new Date().toISOString() };
  const scanRows = scanWas ? JSON.parse(scanWas) : [];
  fs.writeFileSync(SCANNED, JSON.stringify(scanRows.concat([injected])));
  try {
  /* ---- the first look says nothing ------------------------------------- */
  fs.rmSync(SEEN, { force: true });
  fs.writeFileSync(MSGS, "[]");
  const first = await api("api/news.php?check=1");
  check("with nothing remembered it announces nothing", first.first === true && first.added.length === 0 && first.gone.length === 0);
  check("but it remembers the library for next time", fs.existsSync(SEEN));
  /* Nothing about arrivals or departures, because there is no before. A
     missing FILE is different: it is a standing fact about right now, not
     history, so it is reported on the first look like any other. */
  check("and says nothing about comings and goings either",
        (await api("api/news.php")).messages.some((m) => m.kind === "added" || m.kind === "gone"), false);

  /* ---- the sweep -------------------------------------------------------- */
  // The sweep is cheap enough to run at every startup. The check asserts it
  // looked at every game rather than trusting the number.
  /* versions=all: the sweep walks files and the snapshot remembers ids, so
     both halves below want every game. The rolled-up cards hide the extra
     versions' ids, and those read back as phantom arrivals. */
  const lib = await api("api/library.php?versions=all");
  const swept = await api("api/news.php?check=1&dry=1");
  /* Your own games are never swept (a Steam game or a web address has no
     ROM file), so the count to match is the rest. With the ROM drive out the
     sweep rightly does nothing, and that is said rather than failed. */
  const sweepable = lib.games.filter((g) => !g.local).length;
  if (swept.driveOff) {
    check("(the ROM drive is not plugged in, so the sweep rightly skipped; plug it in to test it)", swept.swept, 0);
  } else {
    check("the sweep looks at the whole library", swept.swept > sweepable - 20 && swept.swept <= sweepable + 5 ? true : [swept.swept, sweepable], true);
  }
  check("and is fast enough to do on every startup", swept.sweepMs < 3000);
  check("it is a setting, and the setting is read",
        (await api("api/settings.php")).settings.launch.sweepFiles, true);

  /* ---- added and gone --------------------------------------------------- */
  const games = lib.games.filter((g) => !g.hidden);
  const snap = { at: new Date().toISOString(), games: {} };
  games.slice(2).forEach((g) => { snap.games[g.id] = g.title + "  (" + g.platform + ")"; });
  snap.games["xs-test-gone-1"] = "Phantom Racer  (Sega Saturn)";
  snap.games["xs-test-gone-2"] = "Ghost Story  (Sony Playstation)";
  /* And one game you hid and one you deleted from Xsegon, from this copy's
     own lists: you took those out, so they are not "no longer in the
     library" news. The gone check below still wants exactly the two phantoms. */
  const readList = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); } catch (e) { return d; } };
  const hidId = Object.keys(readList("hidden.json", {}))[0] || null;
  const delRow = readList("deleted.json", [])[0] || null;
  if (hidId) { snap.games[hidId] = "A game you hid  (Somewhere)"; }
  if (delRow) { snap.games[delRow.id] = "A game you deleted  (Somewhere)"; }
  fs.writeFileSync(SEEN, JSON.stringify(snap));
  fs.writeFileSync(MSGS, "[]");

  const res = await api("api/news.php?check=1");
  check("two games left out of the snapshot read as added", res.added.length, 2);
  check("two names not in the library read as gone", res.gone.map((g) => g.line).sort(),
        ["Ghost Story  (Sony Playstation)", "Phantom Racer  (Sega Saturn)"]);
  const box = await api("api/news.php");
  check("each one is announced in the mailbox",
        ["added", "gone"].every((k) => box.messages.some((m) => m.kind === k)));
  check("and the dot has something to show", box.unread, box.messages.length);
  if (hidId || delRow) {
    const kept = JSON.parse(fs.readFileSync(SEEN, "utf8")).games;
    check("what you took out stays remembered, so bringing it back is not news either",
          [hidId, delRow && delRow.id].filter(Boolean).every((id) => id in kept), true);
  } else {
    console.log("    (nothing hidden or deleted in this copy; the took-it-out-yourself checks step aside)");
  }
  const boxSize = box.messages.length;

  // The snapshot has to move forward, or the same news is announced for ever.
  const again = await api("api/news.php?check=1");
  check("asking again says nothing new", again.added.length === 0 && again.gone.length === 0);
  check("and does not pile up more messages", (await api("api/news.php")).messages.length, boxSize);
  /* Missing files are a standing condition, not an event: without keying the
     message to the SET, the mailbox would grow one identical message per startup. */
  await api("api/news.php?check=1");
  await api("api/news.php?check=1");
  check("and three more startups do not either", (await api("api/news.php")).messages.length, boxSize);

  /* What you did yourself is not news: a game accepted in Scan for Games or
     added with + is known from that moment, and taken back out by you it is
     not "no longer in the library" either. */
  const romKnown = path.join(DATA, "xsfix-known.z64");
  fs.writeFileSync(romKnown, "x");
  let ownId = null;
  try {
    const acc = await api("api/scan.php", { action: "accept", games: [{ id: "xs-scan-newsknown000", title: "Xsfix Known Scan", platform: "Nintendo 64", rom: romKnown }] });
    const own = await api("api/local.php", { set: { title: "Xsfix Known Own", platform: "Nintendo 64", url: BASE + "/" } });
    ownId = own.ok ? own.game.id : null;
    const inLib = ((await api("api/library.php?q=" + encodeURIComponent("Xsfix Known"))).games || []).filter((g) => /^Xsfix Known (Scan|Own)$/.test(g.title)).length;
    const mine = await api("api/news.php?check=1");
    check("a game you scanned in and one you added yourself are in the library, and are not announced",
          [acc.added, own.ok, inLib, mine.added.length], [1, true, 2, 0]);
    await api("api/scan.php", { action: "remove", id: "xs-scan-newsknown000" });
    if (ownId) { await api("api/local.php", { id: ownId, remove: true }); ownId = null; }
    const took = await api("api/news.php?check=1");
    check("and taking them back out yourself is not news either", took.gone.length, 0);
    check("so the mailbox holds nothing more for any of it", (await api("api/news.php")).messages.length, boxSize);
  } finally {
    if (ownId) { await api("api/local.php", { id: ownId, remove: true }); }
    fs.rmSync(romKnown, { force: true });
  }

  /* ---- a game whose FILE has gone --------------------------------------- */
  // Not invented: these are the ones the real sweep finds.
  check("games whose file is missing are named, with the platform",
        res.missing.every((m) => /\(.+\)$/.test(m.line) && m.rom));
  check("a missing file does not remove the game from the library",
        (await api("api/library.php?versions=all")).games.length, lib.games.length);

  /* ---- the mailbox ------------------------------------------------------ */
  check("reading marks them read", (await api("api/news.php", { action: "read" })).unread, 0);
  check("and they stay in the mailbox after reading", (await api("api/news.php")).messages.length, boxSize);
  check("clearing empties it", (await api("api/news.php", { action: "clear" })).messages.length, 0);
  check("a made-up action is refused", (await api("api/news.php", { action: "nope" })).ok, false);

  /* ---- the three voices on the page ------------------------------------- */
  fs.writeFileSync(SEEN, JSON.stringify(snap));
  fs.writeFileSync(MSGS, "[]");
  await b.goto(BASE + "/");
  // The check goes last on the page on purpose (this server answers one
  // request at a time), so it is waited for, never slept on.
  check("the amber strip comes up for what has gone",
        await b.waitFor(`!!document.querySelector("#guard-news .guardrail")`, 20000));
  const strip = await b.ev(`document.querySelector("#guard-news .guardrail").textContent`);
  check("it says how many, and that nothing was deleted",
        /no longer listed|potential missing game/.test(strip) && /Nothing has been deleted/.test(strip));
  /* It must NAME NOBODY: the strip is on a screen anyone in the room can see,
     and the titles belong in the mailbox, opened on purpose. The check uses
     the real titles, so a change that starts printing them fails here. */
  const names = (res.missing.concat(res.gone)).map((r) => r.line.split("  (")[0]);
  check("and it names none of the games", names.some((n) => strip.includes(n)), false);
  check("it offers a way to read the rest, and a way to put it away",
        await b.ev(`[...document.querySelectorAll("#guard-news button")].map(x => x.textContent)`),
        ["Show", "Clear"]);
  check("it is amber, not the drive's red", await b.ev(`document.querySelector("#guard-news .guardrail").classList.contains("amber")`));
  check("the ROM drive warning still has its own place, untouched",
        await b.ev(`!!document.getElementById("guard-rom")`));

  check("what arrived is a toast instead, bottom right", await b.waitFor(`!!document.querySelector(".toast")`, 8000));
  check("and it names them", await b.ev(`/added/.test(document.querySelector(".toast").textContent)`));
  check("the toast sits at the bottom of the screen, out of the way", await b.ev(`(() => {
    const r = document.querySelector(".toast").getBoundingClientRect();
    return r.top > innerHeight / 2 && r.right > innerWidth / 2; })()`));

  check("the mailbox wears a dot", await b.waitFor(`!document.getElementById("mail-dot").hidden`, 8000));
  await b.ev(`document.getElementById("btn-mail").click()`);
  check("and opens on the messages", await b.waitFor(`document.querySelectorAll("#mailbox .mail-row").length === ${boxSize}`, 8000));
  check("opening it puts the dot out", await b.waitFor(`document.getElementById("mail-dot").hidden`, 8000));
  /* ---- the missing message, and the list it opens ----------------------- */
  // Only with the ROM drive in: with the whole folder unplugged Xsegon says
  // so once instead of calling every game missing.
  const drive = await romDrive();
  if (!drive.up) {
    console.log("    (the ROM drive " + (drive.root || "(none set)") + " is not there; the missing-files mailbox checks step aside)");
  } else {
  check("a missing-files message is in the mailbox",
        await b.ev(`[...document.querySelectorAll("#mailbox .mail-row")].some(r => r.classList.contains("missing"))`));
  check("and it does name them, where you went looking for them",
        await b.ev(`/Xsfix Gone/.test(document.querySelector("#mailbox").textContent)`));
  check("with a way to see exactly those games",
        await b.ev(`!!document.querySelector("#mailbox .mail-show")`));
  await b.ev(`document.querySelector("#mailbox .mail-show").click()`);
  check("which opens them as one list",
        await b.waitFor(`document.getElementById("platform").value === "@missing" &&
                         document.getElementById("view").className.split(" ")[0] === "list" &&
                         document.querySelectorAll("#view .row").length > 0`, 12000));
  check("holding only the missing ones",
        await b.ev(`document.querySelectorAll("#view .row").length`), res.missing.length);
  check("every one of them struck through as unplayable",
        await b.ev(`[...document.querySelectorAll("#view .row")].every(r => r.classList.contains("dead"))`));
  // The collection is server-side, so it is the same answer from any door.
  const coll = await api("api/library.php?platform=%40missing");
  check("and the collection answers the same from the API", coll.count, res.missing.length);
  }

  /* ---- Clear: gone from the screen, kept in the mailbox ----------------- */
  // Missing files are what bring the strip back on every start, so this too
  // needs the drive in; with it out only the one-time "gone" news exists.
  if (drive.up) {
  await b.goto(BASE + "/");
  await b.waitFor(`!!document.querySelector("#guard-news .guardrail")`, 20000);
  await b.ev(`[...document.querySelectorAll("#guard-news button")].find(x => x.textContent === "Clear").click()`);
  check("Clear puts the warning away", await b.waitFor(`!document.querySelector("#guard-news .guardrail")`, 6000));
  check("and counts as having read it", await b.waitFor(`document.getElementById("mail-dot").hidden`, 6000));
  check("but the message is still in the mailbox", (await api("api/news.php")).messages.length > 0);
  await b.goto(BASE + "/");
  /* Nothing to wait FOR here: the check is that the warning does not come
     back. What can be waited for is the start's own news check answering
     (its response in the page's resource list), and then its painting. */
  await b.waitFor(`performance.getEntriesByType("resource").some((e) => e.name.indexOf("news.php?check=1") >= 0 && e.responseEnd > 0)`, 15000);
  await sleep(500);
  check("and it stays put away on the next start",
        await b.ev(`!document.querySelector("#guard-news .guardrail")`));
  await b.ev(`localStorage.removeItem("xs-missing-cleared")`);
  }

  /* ---- trouble goes into the mailbox, and the strip says it once ----------
     An error is kept in the mailbox, one message per game, each deletable,
     errors and news seen apart. The files are written here as bin\launch.ps1
     and a worker leave them; no game is started. */
  const ERR = path.join(DATA, "last-error.json"), SAID = path.join(DATA, "trouble-said.json");
  const RESULTS = path.join(DATA, "launch-results.json"), FILLJOB = path.join(DATA, "fill-job.json");
  const keepOf = (f) => (fs.existsSync(f) ? fs.readFileSync(f) : null);
  const putBack = (f, kept) => { if (kept === null) { fs.rmSync(f, { force: true }); } else { fs.writeFileSync(f, kept); } };
  const troubleWas = [ERR, SAID, RESULTS, FILLJOB].map((f) => [f, keepOf(f)]);
  const FAILS = "xs-news-fail0001";
  const isoIn = (ms) => new Date(Date.now() + ms).toISOString();
  const writeErr = (at, error) => fs.writeFileSync(ERR, JSON.stringify({ at, gameId: FAILS, title: "Xsfix Fails", platform: "Nintendo 64", error }));
  const mail = async () => api("api/news.php");
  try {
    fs.rmSync(ERR, { force: true });
    fs.rmSync(FILLJOB, { force: true });
    await mail();                              // whatever stands in this copy is said first
    fs.writeFileSync(MSGS, "[]");
    writeErr(isoIn(-4000), "exited with code 1 after 2s");
    let box2 = await mail();
    const m1 = box2.messages[0] || {};
    check("a failed launch is kept in the mailbox as an error, named for its game",
          [box2.messages.length, m1.level, m1.kind, m1.title, m1.body, m1.read, box2.unread],
          [1, "error", "launch", "Xsfix Fails did not start", "Nintendo 64: exited with code 1 after 2s", false, 1]);
    check("asking again does not say it twice", (await mail()).messages.length, 1);
    check("the status poll carries how many are unread, for the dot", ((await api("api/status.php")).mail || {}).unread, 1);
    await api("api/news.php", { action: "read" });
    writeErr(isoIn(-3000), "exited with code 1 after 1s");
    box2 = await mail();
    check("the same game failing again is the same message: the newest reason, counted, unread again",
          [box2.messages.length, box2.messages[0].body, box2.messages[0].times, box2.messages[0].read],
          [1, "Nintendo 64: exited with code 1 after 1s", 2, false]);
    check("the strip's Clear marks that game's message read",
          [(await api("api/news.php", { action: "read", key: "launch:" + FAILS })).unread, (await mail()).messages[0].read], [0, true]);
    const del = await api("api/news.php", { action: "delete", id: box2.messages[0].id });
    check("a message can be deleted by itself", [del.ok, del.messages.length], [true, 0]);
    check("and the next look does not write it again, though the failure still stands", (await mail()).messages.length, 0);
    check("deleting one that is not there is refused", (await api("api/news.php", { action: "delete", id: "msg-nope" })).ok, false);
    writeErr(isoIn(-2000), "exited with code 1 after 1s");
    await mail();
    const resNow = troubleWas[2][1] ? JSON.parse(troubleWas[2][1].toString("utf8").trim()) : {};
    fs.writeFileSync(RESULTS, JSON.stringify(Object.assign({}, resNow, { [FAILS]: { ok: true, at: isoIn(0), title: "Xsfix Fails", why: "" } })));
    box2 = await mail();
    check("a game that has started fine since marks its own failure read", [box2.messages.length, box2.messages[0].read], [1, true]);
    fs.writeFileSync(MSGS, "[]");
    writeErr(isoIn(-5 * 86400000), "exited with code 1 after 1s");
    check("a failure found days after it happened is not news", (await mail()).messages.length, 0);
    fs.rmSync(ERR, { force: true });
    const nowSec = Math.floor(Date.now() / 1000);
    fs.writeFileSync(FILLJOB, JSON.stringify({ state: "failed", mode: "all", started: nowSec - 60, finished: nowSec - 5, error: "Get Pictures stopped on an error: a test" }));
    box2 = await mail();
    check("a background job that stopped is kept too, in its own words",
          [box2.messages.length, (box2.messages[0] || {}).level, (box2.messages[0] || {}).kind, (box2.messages[0] || {}).title, (box2.messages[0] || {}).body],
          [1, "error", "job", "Get Pictures stopped before it finished", "Get Pictures stopped on an error: a test"]);
    check("once, however often the mailbox is read", (await mail()).messages.length, 1);
    fs.rmSync(FILLJOB, { force: true });
    const two = () => fs.writeFileSync(MSGS, JSON.stringify([
      { id: "msg-news", at: isoIn(-60000), kind: "added", title: "A game was added", body: "Found in your library.", read: false },
      { id: "msg-err1", at: isoIn(-50000), kind: "launch", level: "error", key: "launch:a", stamp: "a", times: 3, title: "Xsfix One did not start", body: "Nintendo 64: exited with code 1 after 1s", read: false },
      { id: "msg-err2", at: isoIn(-40000), kind: "job", level: "error", key: "job:x", stamp: "x", times: 1, title: "A download stopped before it finished", body: "it stopped part way", read: true }]));
    two();
    check("clearing the errors leaves the news", (await api("api/news.php", { action: "clear", level: "error" })).messages.map((m) => m.id), ["msg-news"]);
    two();
    check("clearing the info leaves the errors", (await api("api/news.php", { action: "clear", level: "info" })).messages.map((m) => m.id), ["msg-err1", "msg-err2"]);
    check("a level nobody has is refused", (await api("api/news.php", { action: "clear", level: "nope" })).ok, false);

    /* On the page: All, Errors and Info over the list, and a delete on each
       message. */
    two();
    await b.goto(BASE + "/");
    check("the dot counts the unread ones, errors among them", await b.until(`(d => !d.hidden && d.textContent)(document.getElementById("mail-dot"))`, "2", 20000), "2");
    await b.ev(`document.getElementById("btn-mail").click()`);
    const rowsNow = `[...document.querySelectorAll("#mailbox .mail-row")]`;
    const chip = (show) => `document.querySelector('#mailbox .mail-chip[data-show="${show}"]')`;
    check("the mailbox opens on every message, with All, Errors and Info over them, each counted",
          [await b.until(`${rowsNow}.length`, 3, 8000), await b.ev(`[...document.querySelectorAll("#mailbox .mail-chip")].map(c => c.textContent.replace(/\\s+/g, " "))`)],
          [3, ["All 3", "Errors 2", "Info 1"]]);
    check("a failure that repeated says how often", await b.ev(`/3 times/.test(${rowsNow}.find(r => /Xsfix One/.test(r.textContent)).querySelector(".mail-when").textContent)`), true);
    await b.ev(`${chip("error")}.click()`);
    check("Errors shows the errors only, and Clear says it is for those",
          await b.ev(`[${rowsNow}.length, ${rowsNow}.every(r => r.classList.contains("error")), document.querySelector("#mailbox .mail-clear").textContent]`), [2, true, "Clear errors"]);
    await b.ev(`${rowsNow}.find(r => /Xsfix One/.test(r.textContent)).querySelector(".mail-x").click()`);
    check("the cross on a message deletes that one message", [await b.until(`${rowsNow}.length`, 1, 8000), (await mail()).messages.map((m) => m.id)], [1, ["msg-news", "msg-err2"]]);
    await b.ev(`${chip("info")}.click()`);
    check("Info shows the rest", await b.ev(`[${rowsNow}.length, ${rowsNow}.some(r => r.classList.contains("error")), /A game was added/.test(${rowsNow}[0].textContent)]`), [1, false, true]);
    await b.ev(`${chip("all")}.click()`);
    check("and All shows both again", await b.ev(`${rowsNow}.length`), 2);
    await b.key("Escape");

    /* The strip: an old failure is the mailbox's alone, a new one is said
       once. The poll is asked for by hand, so nothing waits on its clock. */
    const strip = `document.getElementById("strip")`;
    const poll = async () => { await b.ev(`import("/js/status.js").then((m) => { m.pollStatus(); })`); await sleep(700); };
    fs.writeFileSync(MSGS, "[]");
    putBack(RESULTS, troubleWas[2][1]);        // no good launch on record: that would read it
    writeErr(isoIn(-90000), "exited with code 2 after 1s");
    await b.goto(BASE + "/");
    check("a failure from before the page opened lights the dot", await b.until(`(d => !d.hidden && d.textContent)(document.getElementById("mail-dot"))`, "1", 20000), "1");
    await poll();
    check("and is not said on the strip", await b.ev(`(s => s.hidden || !/Xsfix Fails/.test(s.textContent))(${strip})`), true);
    writeErr(isoIn(0), "exited with code 9 after 1s");
    await poll();
    check("one that happens while the page is open is said on the strip",
          await b.until(`(s => !s.hidden && s.classList.contains("err") && /Xsfix Fails: exited with code 9 after 1s/.test(s.textContent))(${strip})`, true, 10000), true);
    await b.ev(`import("/js/launch.js").then((m) => { m.showStrip("something newer", false); })`);
    await poll();
    await poll();
    check("once: the poll does not put it back over what came after", await b.ev(`(s => s.textContent.includes("something newer") && !s.classList.contains("err"))(${strip})`), true);
    writeErr(isoIn(0), "exited with code 3 after 1s");
    await poll();
    await b.until(`(s => !s.hidden && /exited with code 3/.test(s.textContent))(${strip})`, true, 10000);
    check("the newest failure is in the mailbox, unread", [((await mail()).messages[0] || {}).body, ((await mail()).messages[0] || {}).read], ["Nintendo 64: exited with code 3 after 1s", false]);
    await b.ev(`[...${strip}.querySelectorAll("button")].find(x => x.textContent === "Clear").click()`);
    check("Clear on the strip puts it away and marks its message read: the dot goes out",
          [await b.until(`${strip}.hidden`, true, 6000), await b.until(`document.getElementById("mail-dot").hidden`, true, 8000), ((await mail()).messages[0] || {}).read], [true, true, true]);
  } finally {
    troubleWas.forEach(([f, kept]) => putBack(f, kept));
  }

  fs.rmSync(SEEN, { force: true });
  fs.rmSync(MSGS, { force: true });
  } finally {
    if (scanWas === null) { fs.rmSync(SCANNED, { force: true }); } else { fs.writeFileSync(SCANNED, scanWas); }
  }
};
