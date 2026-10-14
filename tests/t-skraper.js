/*  The Skraper route on the ScreenScraper videos window (includes\skraper.php,
    bin\skraper.php, api\skraper.php, js\skraper.js).

    Against the stand-in helper tests\sandbox.js wrote (XSEGON_SKRAPER): the
    same modes and closing words as the real stage.js, in a folder of this
    copy's own. The real helper, the real Skraper and the real settings are
    never touched, and on a test copy Skraper is never opened. */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, DATA, Guard, sleep } = require("./lib");

module.exports = async function (b, check) {
  const HELPER = path.join(DATA, "fixtures", "skraper-helper");
  if (!fs.existsSync(HELPER)) {
    check("skraper: runs only on the test server's own copy", true, true);
    return;
  }
  const kept = new Guard(["skraper-job.json"]);
  const HOLD = path.join(HELPER, "hold");
  const OPEN = path.join(HELPER, "skraper-open");
  const jobFile = path.join(DATA, "skraper-job.json");
  const idle = async (ms = 20000) => {
    for (const end = Date.now() + ms; Date.now() < end;) {
      const st = await api("api/skraper.php");
      if (!st.job || st.job.state !== "running") { return st; }
      await sleep(250);
    }
    return await api("api/skraper.php");
  };

  try {
    fs.rmSync(jobFile, { force: true });
    fs.rmSync(path.join(HELPER, "stage"), { recursive: true, force: true });
    fs.rmSync(path.join(HELPER, "pick.json"), { force: true });
    fs.rmSync(HOLD, { force: true });
    fs.rmSync(OPEN, { force: true });

    /* ---- the API ---------------------------------------------------------- */
    let r = await api("api/skraper.php");
    check("the helper is here on the test copy, Skraper reads as closed, and no step has run",
      [r.ok, r.here, r.skraper, r.job || null], [true, true, "closed", null]);
    check("staging with nothing selected is refused", [(r = await api("api/skraper.php", { mode: "stage", ids: [] })).ok, r.error], [false, "no games are selected"]);
    check("and so is a step the window has no business with", (await api("api/skraper.php", { mode: "extras" })).error, "no such step");

    /* ---- the window ------------------------------------------------------- */
    await b.goto();
    await b.setView("grid");
    await b.openBar("media");
    await b.menuItem(/ScreenScraper videos/);
    const title = `(document.querySelector("#editor .panel-title") || {}).textContent || ""`;
    await b.waitFor(`${title} === "SCREENSCRAPER VIDEOS"`, 10000);
    const stageBtn = `[...document.querySelectorAll("#editor .ss-bar button")].find(x => /for Skraper/.test(x.textContent))`;
    check("beside Fetch stands Stage for Skraper, counting the same selection",
      await b.until(`(b => b ? /^Stage \\d+ for Skraper\\.\\.\\.$/.test(b.textContent) : null)(${stageBtn})`, true, 8000), true);
    // Two games picked by hand: the count follows, and only those two are staged.
    const two = await b.ev(`(() => {
      document.querySelectorAll("#editor .sv-row input").forEach(i => { if (i.checked) { i.checked = false; i.dispatchEvent(new Event("change")); } });
      const on = [...document.querySelectorAll("#editor .sv-row input")].filter(i => !i.disabled).slice(0, 2);
      on.forEach(i => { i.checked = true; i.dispatchEvent(new Event("change")); });
      return on.map(i => i.value);
    })()`);
    check("two games selected by hand put 2 on both buttons", [two.length, await b.ev(`${stageBtn}.textContent`)], [2, "Stage 2 for Skraper..."]);
    await b.ev(`${stageBtn}.click()`);
    check("Stage asks first: the stand-ins, the backup, and that Start in Skraper is the person's press",
      await b.until(`(t => /Stage 2 games for Skraper\\?/.test(t) && /backup kept first/.test(t) && /press Start in it/.test(t) && /No logins go into Xsegon/.test(t))(document.querySelector(".setup-confirm") ? document.querySelector(".setup-confirm").textContent : "")`, true, 8000), true);
    await b.ev(`[...document.querySelectorAll(".setup-confirm button")].find(x => x.textContent === "Stage").click()`);
    for (const end = Date.now() + 8000; !fs.existsSync(jobFile) && Date.now() < end;) { await sleep(100); }
    let st = await idle();
    check("the step ran in the background and ended well", [st.job.mode, st.job.state], ["build", "done"]);
    check("the helper staged only the two picked games, and the picked list is consumed",
      [st.job.said.includes("staged only the 2 games picked in Xsegon"), fs.existsSync(path.join(HELPER, "pick.json")),
       fs.readdirSync(path.join(HELPER, "stage"), { recursive: true }).filter((f) => /\.iso$/.test(String(f))).length],
      [true, false, 2]);
    check("on a test copy Skraper itself is never opened, and the window says to open it",
      [st.job.opened, /not opened on a test copy/.test(st.job.openNote || ""),
       await b.until(`/Open Skraper, choose ALL SYSTEMS in it and press Start\\. When Skraper is closed, Xsegon reads what arrived by itself/.test((document.querySelector("#editor .sk-area .mt-note") || {}).textContent || "")`, true, 8000)],
      [false, true, true]);
    check("the helper's own words are shown", await b.ev(`/stand-ins for/.test((document.querySelector("#editor .sk-said") || {}).textContent || "")`), true);

    /* ---- Skraper is followed until it closes -------------------------------- */
    const helperSays = `((document.querySelector("#editor .sk-area .mt-note") || {}).textContent || "")`;
    const stepDone = async (mode, after, ms = 25000) => {   // a step of that kind started after that second, and ended
      for (const end = Date.now() + ms; Date.now() < end;) {
        const s = await api("api/skraper.php");
        if (s.job && s.job.mode === mode && s.job.state !== "running" && s.job.started > after) { return s; }
        await sleep(250);
      }
      return await api("api/skraper.php");
    };
    fs.writeFileSync(OPEN, "");                        // Skraper is seen open...
    await sleep(4500);
    await b.ev(`[...document.querySelectorAll("#editor .sk-area .ss-btns button")].find(x => /Check what arrived/.test(x.textContent)).click()`);
    check("a check pressed while Skraper works says what came so far, and that its closing is still waited for",
      await b.until(`/^That is what Skraper fetched so far\\..*When Skraper is closed, Xsegon reads what arrived by itself/.test(${helperSays})`, true, 15000), true);
    st = await idle();
    const pressed = st.job.started;
    await sleep(1200);                                 // the next step starts in a later second
    fs.rmSync(OPEN, { force: true });                  // ...and then closed
    st = await stepDone("check", pressed);
    check("that press did not end the following: seen closed, what arrived is read again by itself",
      [st.job.mode, st.job.state, st.job.started > pressed], ["check", "done", true]);
    check("and the check's words carry the counts and the LaunchBox line",
      [/in all/.test(st.job.said), /LaunchBox Data\\Platforms: exactly as it was/.test(st.job.said)], [true, true]);
    check("after that nothing more is waited for",
      await b.until(`/^That is what Skraper fetched so far\\. A video that arrived plays on its game right away\\.$/.test(${helperSays})`, true, 8000), true);

    /* ---- and with the window closed ----------------------------------------- */
    const again = st.job.started;
    await sleep(1200);
    await b.ev(`${stageBtn}.click()`);
    await b.until(`!!document.querySelector(".setup-confirm")`, true, 8000);
    await b.ev(`[...document.querySelectorAll(".setup-confirm button")].find(x => x.textContent === "Stage").click()`);
    st = await stepDone("build", again);
    fs.writeFileSync(OPEN, "");
    await sleep(4500);
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`, true, 5000);
    fs.rmSync(OPEN, { force: true });
    check("with the window closed Skraper is still followed: its closing is read, and the strip says so",
      [st.job.state, await b.waitFor(`/Skraper has closed and what it fetched is read/.test((s => s.hidden ? "" : s.textContent)(document.getElementById("strip")))`, 25000),
       (await stepDone("check", st.job.started - 1)).job.mode], ["done", true, "check"]);
    await b.openBar("media");
    await b.menuItem(/ScreenScraper videos/);
    await b.waitFor(`${title} === "SCREENSCRAPER VIDEOS"`, 10000);

    /* ---- the second go ------------------------------------------------------ */
    const areaBtn = (re) => `[...document.querySelectorAll("#editor .sk-area .ss-btns button")].find(x => ${re}.test(x.textContent))`;
    const NOTHING = path.join(HELPER, "nothing-left");
    await b.until(`!!${areaBtn("/Second go/")}`, true, 10000);
    let mark = (await api("api/skraper.php")).job.started;
    await sleep(1200);
    await b.ev(`${areaBtn("/Second go/")}.click()`);
    check("Second go asks first: names ScreenScraper knows, hacks wearing their own game's video, and no game renamed",
      await b.until(`(t => /A second go for the games Skraper missed\\?/.test(t) && /No game of yours is renamed/.test(t) && /gets a copy of it at once/.test(t))((document.querySelector(".setup-confirm") || {}).textContent || "")`, true, 8000), true);
    await b.ev(`[...document.querySelectorAll(".setup-confirm button")].find(x => /Stage the second go/.test(x.textContent)).click()`);
    st = await stepDone("retry", mark);
    check("it is staged by the helper's own second-go step, and the window says what to press",
      [st.job.state, st.job.staged, await b.until(`/^The second go is staged.*choose ALL SYSTEMS in it and press Start\\. When Skraper is closed, Xsegon gives the videos the names it looks for by itself/.test(${helperSays})`, true, 8000)],
      ["done", true, true]);
    fs.writeFileSync(OPEN, "");
    await sleep(4500);
    fs.rmSync(OPEN, { force: true });
    st = await stepDone("tidy", st.job.started - 1);
    check("Skraper seen closed, the second go is filed by itself",
      [st.job.mode, st.job.state, await b.until(`/^What Skraper fetched is read and filed/.test(${helperSays})`, true, 10000)], ["tidy", "done", true]);
    // With nothing left to ask Skraper for, nothing is opened and nothing is waited for.
    fs.writeFileSync(NOTHING, "");
    mark = st.job.started;
    await sleep(1200);
    await b.ev(`${areaBtn("/Second go/")}.click()`);
    await b.until(`!!document.querySelector(".setup-confirm")`, true, 8000);
    await b.ev(`[...document.querySelectorAll(".setup-confirm button")].find(x => /Stage the second go/.test(x.textContent)).click()`);
    st = await stepDone("retry", mark);
    check("a second go with only copies to make stages nothing, opens nothing and waits for nothing",
      [st.job.staged, "opened" in st.job, await b.until(`/^The second go had nothing left to ask Skraper for/.test(${helperSays})`, true, 8000), /given a copy/.test(st.job.said)],
      [false, false, true, true]);
    fs.rmSync(NOTHING, { force: true });

    /* ---- a game staged under another name is filed by the check ------------- */
    // The helper's own list of videos that wait for their names: with it, and Skraper closed, a check is the filing step.
    const WAITS = path.join(HELPER, "second-go.json");
    fs.writeFileSync(WAITS, JSON.stringify(["a video under an asked name"]));
    fs.writeFileSync(OPEN, "");
    mark = (await api("api/skraper.php")).job.started;
    await sleep(1200);
    await api("api/skraper.php", { mode: "check" });
    st = await stepDone("check", mark);
    const whileOpen = st.job.mode;
    fs.rmSync(OPEN, { force: true });
    mark = st.job.started;
    await sleep(1200);
    await api("api/skraper.php", { mode: "check" });
    st = await stepDone("tidy", mark);
    check("with videos waiting for their names, a check files them once Skraper is closed, and stays a look while it is open",
      [whileOpen, st.job.mode, st.job.state, fs.existsSync(WAITS)], ["check", "tidy", "done", false]);

    /* ---- one step at a time, and the settings put back --------------------- */
    fs.writeFileSync(HOLD, "");
    await api("api/skraper.php", { mode: "check" });
    r = await api("api/skraper.php", { mode: "stage", ids: two });
    check("while a step runs another is refused", [r.ok, r.error], [false, "a step is already running; wait for it"]);
    fs.rmSync(HOLD, { force: true });
    await idle();
    await b.until(`!![...document.querySelectorAll("#editor .sk-area .ss-btns button")].find(x => /settings back/.test(x.textContent))`, true, 10000);
    await b.ev(`[...document.querySelectorAll("#editor .sk-area .ss-btns button")].find(x => /settings back/.test(x.textContent)).click()`);
    await b.until(`/Put Skraper's settings back\\?/.test((document.querySelector(".setup-confirm") || {}).textContent || "")`, true, 8000);
    await b.ev(`[...document.querySelectorAll(".setup-confirm button")].find(x => /Put them back/.test(x.textContent)).click()`);
    for (const end = Date.now() + 10000; Date.now() < end;) {
      st = await api("api/skraper.php");
      if (st.job && st.job.mode === "restore" && st.job.state !== "running") { break; }
      await sleep(250);
    }
    check("Put Skraper's settings back runs the helper's restore", [st.job.mode, st.job.state, /back as they were/.test(st.job.said)], ["restore", "done", true]);
    await b.key("Escape");
    await sleep(300);

    const log = ((await api("api/log.php?tail=200")).lines || []).join("\n");
    check("the log has the asks and the endings", [/SKRP.*asked for build with 2 games picked/.test(log), /SKRP.*build: done/.test(log), /SKRP.*check: done/.test(log)], [true, true, true]);
  } finally {
    fs.rmSync(HOLD, { force: true });
    fs.rmSync(OPEN, { force: true });
    fs.rmSync(path.join(HELPER, "nothing-left"), { force: true });
    fs.rmSync(path.join(HELPER, "second-go.json"), { force: true });
    await idle();
    fs.rmSync(path.join(HELPER, "stage"), { recursive: true, force: true });
    fs.rmSync(path.join(HELPER, "pick.json"), { force: true });
    kept.restore();
  }
};
