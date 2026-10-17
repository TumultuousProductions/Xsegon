/*  The corner bars of the background jobs (api\jobs.php, js\jobbars.js):
    a long job shows as a bar in the bottom corner, several at once.
    No job is really started: the job files are written by hand, running and
    then ended, with this test's own pid so the server takes the worker for alive. */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, DATA, BASE, Guard, sleep } = require("./lib");

// Every kind of job the server's list reads (xs_jobs_files), so one added later is in the all-at-once check too.
const KINDS = [...fs.readFileSync(path.join(__dirname, "..", "includes", "jobs.php"), "utf8")
  .matchAll(/'(\w+)'\s*=>\s*xs_data_path\('([\w-]+\.json)'\)/g)].map((m) => ({ key: m[1], file: m[2] }));
const FILES = [...new Set(["steamvid-job.json", "screenscraper-job.json", "emumove-job.json", "unpack-job.json",
  "thumbs-job-box.json", "thumbs-job-logo.json", "thumbs-job-box3d.json", "thumbs-job-shot.json", "thumbs-job-fanart.json",
  ...KINDS.map((k) => k.file)])];
const now = () => Math.floor(Date.now() / 1000);
const put = (name, value) => fs.writeFileSync(path.join(DATA, name), JSON.stringify(value));
const BARS = `[...document.querySelectorAll("#corner-bars .job-bar")].filter((b) => !b.hidden)`;
const barOf = (key) => `${BARS}.find((b) => b.dataset.job === ${JSON.stringify(key)})`;
const strip = `(document.getElementById("strip") || {}).textContent || ""`;

module.exports = async function (b, check) {
  const kept = new Guard(FILES);
  const stopFile = path.join(DATA, "emumove-stop");
  const row = (res, key) => (res.jobs || []).find((j) => j.key === key) || null;
  try {
    for (const f of FILES) { fs.rmSync(path.join(DATA, f), { force: true }); }
    fs.rmSync(stopFile, { force: true });

    /* ---- the server's one answer ----------------------------------------- */
    check("with no job at work there is nothing to show, and the status look says nothing of jobs",
      [(await api("api/jobs.php")).jobs, "jobs" in (await api("api/running.php"))], [[], false]);

    /* Each kind's block reads its own file in one function: a block that spoils a name the next one
       reads costs the whole list its answer, and only shows with both at work. */
    for (const k of KINDS) { put(k.file, { state: "running", phase: "starting", started: now(), pid: process.pid, games: [] }); }
    const allRes = await fetch(BASE + "/api/jobs.php");
    const all = await allRes.json().catch(() => ({}));
    check("with every kind of job at work at once, the list still answers, with a row for each",
      [KINDS.length >= 10, allRes.status, (all.jobs || []).map((j) => j.key).sort()], [true, 200, KINDS.map((k) => k.key).sort()]);
    for (const k of KINDS) { fs.rmSync(path.join(DATA, k.file), { force: true }); }

    /* An old ending whose file was only written again (a restore, a copied data folder) is not news:
       only a run a page saw at work, or started itself, is announced. */
    put("emumove-job.json", { state: "done", phase: "end", started: now() - 86400, at: 0, items: [], bytes: 1, total: 1, said: "An old move that was said long ago" });
    await b.goto();
    const readIt = await b.until(`!!document.querySelector('#corner-bars .job-bar[data-job="emumove"]')`, true, 12000);
    await sleep(4000);            // two more reads, which is when an ending is said
    check("a job file that was only written again does not bring an old ending back",
      [readIt, await b.ev(`/An old move/.test(${strip})`), await b.ev(`${BARS}.length`)], [true, false, 0]);

    const t0 = now();
    put("steamvid-job.json", { state: "running", started: t0, pid: process.pid, games: [
      { id: "a", title: "A", appid: 1, state: "done" }, { id: "b", title: "B", appid: 2, state: "none" },
      { id: "c", title: "C", appid: 3, state: "fetching" }, { id: "d", title: "D", appid: 4, state: "waiting" }] });
    put("emumove-job.json", { state: "running", phase: "copying", started: t0, pid: process.pid, dest: "X:\\Emulators", at: 0,
      items: [{ key: "ra", name: "RetroArch", state: "copying" }], bytes: 536870912, total: 2147483648, said: "" });
    put("screenscraper-job.json", { state: "running", started: t0, pid: process.pid, games: [
      { id: "a", title: "A", state: "done" }, { id: "b", title: "B", state: "waiting" }, { id: "c", title: "C", state: "waiting" }, { id: "d", title: "D", state: "waiting" }] });
    const three = await api("api/jobs.php");
    check("every job at work is one row: its name, a line, how far along, and whether it can be stopped",
      [(three.jobs || []).map((j) => j.key).sort(),
       (({ name, state, line, frac, stop }) => [name, state, line, frac, stop])(row(three, "steamvid") || {}),
       (({ name, line, frac, stop }) => [name, line, frac, stop])(row(three, "emumove") || {}),
       (({ name, line, frac, stop }) => [name, line, frac, stop])(row(three, "screenscraper") || {})],
      [["emumove", "screenscraper", "steamvid"],
       ["Steam trailers", "running", "2 of 4 games, 1 trailer saved", 0.5, false],
       ["Move out of LaunchBox", "copying RetroArch: 512 MB of 2 GB", 0.25, true],
       ["ScreenScraper videos", "1 of 4 games, 1 video saved", 0.25, false]]);
    check("and the status look says a job is at work, so any page brings the bars up", (await api("api/running.php")).jobs, true);

    /* ---- the bars: one each, stacked in the corner ------------------------ */
    await b.goto();
    check("a page opened meanwhile shows a bar for each job at once, in the corner box",
      await b.until(`${BARS}.map((x) => x.dataset.job).sort().join(",")`, "emumove,screenscraper,steamvid", 12000), "emumove,screenscraper,steamvid");
    check("each bar says its job and how far it is, with its track filled as far",
      await b.ev(`(() => { const of = (k) => { const x = ${BARS}.find((y) => y.dataset.job === k); return [x.querySelector(".fb-line").textContent, x.querySelector(".fb-fill").style.width]; };
        return [of("steamvid"), of("emumove"), of("screenscraper")]; })()`),
      [["Steam trailers: 2 of 4 games, 1 trailer saved", "50%"], ["Move out of LaunchBox: copying RetroArch: 512 MB of 2 GB", "25%"], ["ScreenScraper videos: 1 of 4 games, 1 video saved", "25%"]]);
    check("Stop is only on a job that can be stopped",
      await b.ev(`["steamvid", "emumove", "screenscraper"].map((k) => !${BARS}.find((y) => y.dataset.job === k).querySelector(".fb-stop").hidden)`), [false, true, false]);
    await b.shot("corner-job-bars");

    /* A job with nothing to measure yet shows a travelling piece, not an empty track. */
    put("emumove-job.json", { state: "running", phase: "measuring", started: t0, pid: process.pid, at: 0, items: [{ key: "ra", name: "RetroArch" }], bytes: 0, total: 0, said: "" });
    check("a job with nothing to measure yet says what it is doing, and its track waits",
      await b.until(`(x => !!x && x.querySelector(".fb-line").textContent + "|" + x.querySelector(".fb-track").classList.contains("wait"))(${barOf("emumove")})`,
        "Move out of LaunchBox: measuring the folders|true", 8000),
      "Move out of LaunchBox: measuring the folders|true");

    /* ---- Stop, from the corner -------------------------------------------- */
    await b.ev(`${barOf("emumove")}.querySelector(".fb-stop").click()`);
    let asked = false;
    for (let i = 0; i < 40 && !asked; i++) { asked = fs.existsSync(stopFile); if (!asked) { await sleep(100); } }
    check("Stop on a bar asks that job to stop, the way its own window does", asked, true);
    const noStop = await fetch(BASE + "/api/jobs.php", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ stop: "steamvid" }) });
    check("a job with no way to stop is refused in words", [noStop.status, /cannot be stopped/.test(((await noStop.json()) || {}).error || "")], [400, true]);

    /* ---- an ending: said once on the strip, and the bar goes --------------- */
    put("emumove-job.json", { state: "done", phase: "end", started: t0, at: 0, items: [{ key: "ra", name: "RetroArch", state: "done" }],
      bytes: 100, total: 100, said: "RetroArch now starts from X:\\Emulators\\RetroArch" });
    check("when a job ends the strip says how, without a window open to say it",
      await b.until(`/RetroArch now starts from X:/.test(${strip})`, true, 12000), true);
    check("and its bar says done", await b.until(`(x => (x ? x.querySelector(".fb-line").textContent : ""))(${barOf("emumove")})`, "Move out of LaunchBox: done", 6000),
      "Move out of LaunchBox: done");
    const saidFor = await b.ev(`Number(localStorage.getItem("xs-job-said-emumove") || 0)`);
    check("the ending is marked as said for that run, so no other page says it again", saidFor, t0);
    check("the other jobs are still at work beside it", await b.ev(`["steamvid", "screenscraper"].every((k) => !!${BARS}.find((y) => y.dataset.job === k))`), true);

    /* A job that failed says why, as trouble. */
    put("steamvid-job.json", { state: "failed", started: t0, error: "Steam would not answer", games: [{ id: "a", state: "done" }, { id: "b", state: "waiting" }] });
    check("a job that stopped says why", await b.until(`/trailers stopped: Steam would not answer/.test(${strip})`, true, 12000), true);

    /* ---- gone: nothing is left in the corner ------------------------------- */
    put("screenscraper-job.json", { state: "done", started: t0, games: ["a", "b", "c", "d"].map((id) => ({ id, state: id === "d" ? "none" : "done" })) });
    check("a job that finished says how many it saved",
      await b.until(`/3 snaps saved from ScreenScraper/.test(${strip})`, true, 12000), true);
    check("and with every job over, each bar leaves the corner after a moment",
      await b.until(`${BARS}.length`, 0, 12000), 0);

    /* ---- a thumbnail build: a builder for each kind of picture, one bar ----
       The builder writes how far it is, the corner shows it, and the ending is said. */
    const t1 = now();
    put("thumbs-job-box.json", { kind: "box", state: "running", started: t1, done: 120, total: 400, built: 100, failed: 0 });
    put("thumbs-job-logo.json", { kind: "logo", state: "running", started: t1, done: 80, total: 400, built: 80, failed: 0 });
    const th = row(await api("api/jobs.php"), "thumbs") || {};
    check("a thumbnail build is one row for all its kinds of picture, counted together",
      [th.name, th.state, th.line, th.frac, th.stop, th.started], ["Thumbnails", "running", "200 of 800 pictures", 0.25, false, t1]);
    const twice = await fetch(BASE + "/api/thumbs.php", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ kind: "box", width: 400 }) });
    check("a second build of a kind that is being built is refused, and starts nothing",
      [twice.status, /being built already/.test(((await twice.json()) || {}).error || ""), JSON.parse(fs.readFileSync(path.join(DATA, "thumbs-job-box.json"), "utf8")).done], [409, true, 120]);
    await b.goto();
    check("the page shows it as a bar in the corner, with how far it is",
      await b.until(`(x => (x ? x.querySelector(".fb-line").textContent + "|" + x.querySelector(".fb-fill").style.width : ""))(${barOf("thumbs")})`, "Thumbnails: 200 of 800 pictures|25%", 15000),
      "Thumbnails: 200 of 800 pictures|25%");
    put("thumbs-job-box.json", { kind: "box", state: "done", started: t1, done: 400, total: 400, built: 300, failed: 0 });
    put("thumbs-job-logo.json", { kind: "logo", state: "done", started: t1, done: 400, total: 400, built: 250, failed: 2 });
    check("and says when it is done: how many were made, how many were there already, how many could not be read",
      await b.until(`/Thumbnails are built: 550 new, 248 already there, 2 pictures could not be read/.test(${strip})`, true, 12000), true);

    /* A builder that says running and has gone quiet died: said as that, once, and written to the log. */
    put("thumbs-job-logo.json", { kind: "logo", state: "running", started: t1 + 5, done: 7, total: 400, built: 7, failed: 0 });
    const quiet = new Date(Date.now() - 100000);
    fs.utimesSync(path.join(DATA, "thumbs-job-logo.json"), quiet, quiet);
    const dead = row(await api("api/jobs.php"), "thumbs") || {};
    const logDir = path.join(DATA, "log");
    const logged = fs.readdirSync(logDir).filter((f) => f.endsWith(".log")).map((f) => fs.readFileSync(path.join(logDir, f), "utf8")).join("");
    check("a builder that went quiet is told as stopped, in the answer, in its file and in the log",
      [dead.state, dead.said, JSON.parse(fs.readFileSync(path.join(DATA, "thumbs-job-logo.json"), "utf8")).state, / S THM +the logo build went quiet at 7 of 400 and is taken as stopped/.test(logged)],
      ["failed", "The thumbnail build stopped: the builder stopped without a word", "failed", true]);

    /* The builder itself, on a folder of its own with three small pictures: it keeps the file it was given. */
    const own = fs.mkdtempSync(path.join(require("os").tmpdir(), "xsegon-thumbs-"));
    try {
      const pics = fs.readdirSync(path.join(__dirname, "..", "img", "consoles")).filter((f) => f.endsWith(".png")).slice(0, 3);
      const list = path.join(own, "list.txt"), job = path.join(own, "thumbs-job-box.json");
      fs.writeFileSync(list, pics.map((f, i) => "pic" + i + "\t" + path.join(__dirname, "..", "img", "consoles", f) + "\tPicture " + i).join("\n"));
      fs.writeFileSync(job, JSON.stringify({ kind: "box", state: "running", started: 12345, done: 0, total: 3 }));
      require("child_process").execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "..", "bin", "thumbs.ps1"),
        "-Kind", "box", "-Width", "160", "-List", list, "-Job", job], { env: Object.assign({}, process.env, { XSEGON_DATA: own }), stdio: "ignore", timeout: 60000 });
      const end = JSON.parse(fs.readFileSync(job, "utf8"));
      check("the real builder keeps its file: the run it was started as, every picture counted, and done at the end",
        [end.state, end.started, end.done, end.total, end.built, end.failed, fs.readdirSync(path.join(own, "thumbs", "box")).length], ["done", 12345, 3, 3, 3, 0, 3]);
    } finally {
      fs.rmSync(own, { recursive: true, force: true });
    }

    /* ---- a wait inside one request: Scan, Add Steam games, Back up, Make a report ----
       The window that asked draws a bar from what the main server is on, read out by the fast lane.
       The scan is held behind two seconds of stand-in work that counts (api\boom.php, test copy only). */
    await b.goto();
    await b.ev(`(() => { window.__realFetch = window.__realFetch || window.fetch; window.fetch = function (u, o) {
      if (String(u).endsWith("api/scan.php") && !(o && o.method === "POST")) { return window.__realFetch("api/boom.php?busy=2&steps=10").then(() => window.__realFetch(u, o)); }
      return window.__realFetch.apply(this, arguments); }; })()`);
    await b.ev(`import("/js/scan.js").then(m => m.openScanTool())`);     // the consoles screen has no Games menu
    const waitBar =`(x => (x ? [x.querySelector(".wb-line").textContent, x.classList.contains("wait"), x.querySelector(".mt-fill").style.width] : null))(document.querySelector("#editor .wait-bar"))`;
    check("a wait inside one request shows a bar in the window that asked: what the server is on, and how far",
      await b.until(`(v => !!v && /^Counting on purpose: [1-9] of 10$/.test(v[0]) && v[1] === false && /^[1-9]0%$/.test(v[2]))(${waitBar})`, true, 6000), true);
    await b.shot("wait-bar-in-a-window");
    check("and the bar goes when the answer is in",
      await b.until(`!document.querySelector("#editor .wait-bar") && !/Walking the ROM folders/.test(document.getElementById("editor").textContent)`, true, 20000), true);
    await b.ev(`window.fetch = window.__realFetch`);
    await b.key("Escape");
    check("no script errors through any of it", await b.ev(`(window.__errs || []).length`), 0);
  } finally {
    fs.rmSync(stopFile, { force: true });
    kept.restore();
  }
};
