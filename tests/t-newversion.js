/*  A newer Xsegon, said once per version in the mailbox (includes\newversion.php,
    bin\newversion.php), and the version a release names (RELEASE.json, which
    tools\make-test-copy.js --release writes; includes\version.php xs_release).

    A release is said three days after GitHub says it was published.

    GitHub is never asked. The look runs against a stand-in served from this
    process, in a data folder of its own under tests\out (XSEGON_DATA), with
    XSEGON_TEST_RELEASE standing in for a release's own copy. The mailbox's
    button is pressed on the run's server with window.open caught, so no page
    opens.                                                                      */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { execFile, execFileSync } = require("child_process");
const { api, DATA, ROOT, OUT, Guard } = require("./lib");

const PAGE = "https://github.com/TumultuousProductions/Xsegon/releases/tag/";
const rel = (tag, more) => Object.assign({ tag_name: tag, html_url: PAGE + tag, draft: false, prerelease: false, body: "" }, more || {});

module.exports = async function (b, check) {
  const phpExe = ((await api("api/status.php")).build || {}).phpExe;
  const home = path.join(OUT, "newversion");
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });

  // The stand-in: GitHub's list of releases, as the test sets it, and how often it was asked.
  let answer = [];
  let asked = 0;
  const server = http.createServer((req, res) => {
    asked++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(answer));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port + "/releases";

  const data = path.join(home, "data");
  const mail = () => { try { return JSON.parse(fs.readFileSync(path.join(data, "messages.json"), "utf8")).filter((m) => m.id === "msg-newversion"); } catch (e) { return []; } };
  const last = () => { try { return JSON.parse(fs.readFileSync(path.join(data, "newversion.json"), "utf8")); } catch (e) { return null; } };
  // Never execFileSync here: it would hold this process, and with it the stand-in the look is asking.
  const look = (have, more) => new Promise((done, fail) => execFile(phpExe, [path.join(ROOT, "bin", "newversion.php")], {
    env: Object.assign({}, process.env, { XSEGON_DATA: data, XSEGON_NEWVERSION_URL: url, XSEGON_TEST_RELEASE: have }, more || {}),
    windowsHide: true, encoding: "utf8" }, (e, out, err) => { if (e) { fail(new Error(err || e.message)); } else { done(JSON.parse(out)); } }));
  const settings = (on) => fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ window: { tellNewVersions: on } }));

  try {
    fs.mkdirSync(data, { recursive: true });
    settings(true);

    /* ---- a newer version, said once ------------------------------------- */
    answer = [rel("gamesdb"), rel("v0.15"), rel("v0.16", { body: "## What is new\n- **Faster** lists\n- A [manual reader](https://example.com/x)\n\n" + "line\n".repeat(20) }),
              rel("v0.18", { prerelease: true }), rel("v0.19", { draft: true })];
    let r = await look("0.15");
    let m = mail();
    check("a newer release is found among the others: not a pre-release, a draft or the Games Database's own",
      [r.newest, r.newer, r.page], ["0.16", true, PAGE + "v0.16"]);
    check("and said in the mailbox once, with a button to its page and its notes as plain lines",
      [m.length, (m[0] || {}).title, (m[0] || {}).url, (m[0] || {}).opens, ((m[0] || {}).items || []).slice(0, 3), ((m[0] || {}).items || []).length, (m[0] || {}).read],
      [1, "Xsegon 0.16 is out", PAGE + "v0.16", ["newversion"], ["What is new", "Faster lists", "A manual reader"], 8, false]);
    check("the message says this copy's version, that nothing changed, how to update, and where to stop it",
      [/^This is 0\.15\./.test((m[0] || {}).body || ""), /Nothing has been downloaded or changed/.test((m[0] || {}).body || ""),
       /Replace the files/.test((m[0] || {}).body || ""), /Settings > Window > New versions/.test((m[0] || {}).body || "")],
      [true, true, true, true]);
    const logText = () => fs.readdirSync(path.join(data, "log")).map((f) => fs.readFileSync(path.join(data, "log", f), "utf8")).join("");
    check("the log says what it found", /NEWV .*this is 0\.15, the newest is 0\.16: said in the mailbox/.test(logText()));

    r = await look("0.15");
    check("looked again, the same version is not said twice", [mail().length, r.told], [1, "0.16"]);
    fs.writeFileSync(path.join(data, "messages.json"), "[]");
    await look("0.15");
    check("and a deleted message stays deleted", mail().length, 0);
    check("which the log says", /the newest is 0\.16: said before/.test(logText()));

    answer = answer.concat([rel("v0.17", { body: "Even faster" })]);
    await look("0.15");
    m = mail();
    check("the next version is said once more, in a message of its own", [m.length, (m[0] || {}).title, (m[0] || {}).items], [1, "Xsegon 0.17 is out", ["Even faster"]]);
    await look("0.15");
    answer = [rel("v0.18", { body: "Newest" })];
    await look("0.15");
    m = JSON.parse(fs.readFileSync(path.join(data, "messages.json"), "utf8")).filter((x) => x.id === "msg-newversion");
    check("one message at a time: a newer one takes the place of the last", [m.length, (m[0] || {}).title], [1, "Xsegon 0.18 is out"]);

    /* ---- three days' wait after a release comes out --------------------- */
    fs.writeFileSync(path.join(data, "messages.json"), "[]");
    const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
    answer = [rel("v0.21", { body: "Fresh", published_at: hoursAgo(2) })];
    r = await look("0.18");
    check("a release out for two hours is found, but not said until three days after it came out",
      [r.newest, r.newer, mail().length, Math.abs(Date.parse(r.waitUntil || "") - (Date.now() - 2 * 3600000 + 3 * 86400000)) < 120000],
      ["0.21", true, 0, true]);
    check("and the log says from when", /NEWV .*the newest is 0\.21: said from .*three days after it came out/.test(logText()));
    answer = [rel("v0.21", { body: "Fresh", published_at: hoursAgo(73) })];
    r = await look("0.18");
    check("three days on, it is said", [r.newer, r.waitUntil || null, (mail()[0] || {}).title], [true, null, "Xsegon 0.21 is out"]);
    answer = [rel("v0.18", { body: "Newest" })];

    /* ---- nothing to say ------------------------------------------------- */
    fs.writeFileSync(path.join(data, "messages.json"), "[]");
    r = await look("0.18");
    check("up to date: nothing said", [r.newer, mail().length], [false, 0]);
    r = await look("0.20");
    check("a copy newer than every release says nothing either", [r.newer, mail().length], [false, 0]);

    answer = [rel("v0.30", { html_url: "https://example.com/not-github" })];
    await look("0.18");
    check("a page that is not the project's own is never linked", (mail()[0] || {}).url, "https://github.com/TumultuousProductions/Xsegon/releases/latest");

    /* ---- not asked at all ------------------------------------------------ */
    const before = asked;
    settings(false);
    r = await look("0.18");
    check("switched off in Settings, GitHub is not asked", [asked - before, r.skipped], [0, "switched off in Settings"]);
    settings(true);
    r = await look("");
    check("a copy that is not a release (a checkout, a tester's copy) does not ask", [asked - before, r.skipped], [0, "not a release of Xsegon"]);
    r = JSON.parse(execFileSync(phpExe, [path.join(ROOT, "bin", "newversion.php")], {
      env: Object.assign({}, process.env, { XSEGON_DATA: data, XSEGON_NEWVERSION_URL: "", XSEGON_TEST_RELEASE: "0.18" }), windowsHide: true, encoding: "utf8" }));
    check("and a test copy never asks GitHub by itself", [asked - before, r.skipped], [0, "a test copy, which never asks GitHub by itself"]);

    /* ---- offline -------------------------------------------------------- */
    fs.writeFileSync(path.join(data, "messages.json"), "[]");
    r = await look("0.15", { XSEGON_NEWVERSION_URL: "http://127.0.0.1:9/releases" });
    check("offline: nothing said, the reason kept, and a line in the log",
      [mail().length, typeof r.error === "string" && r.error !== "", typeof (last() || {}).error, /could not look for a newer Xsegon/.test(logText())],
      [0, true, "string", true]);

    /* ---- the version a release names ------------------------------------ */
    const fake = path.join(home, "release");
    fs.mkdirSync(fake, { recursive: true });
    const code = "require $argv[1]; echo json_encode([xs_release($argv[2]), xs_release($argv[3])]);";
    fs.writeFileSync(path.join(fake, "RELEASE.json"), JSON.stringify({ app: "Xsegon", version: "0.15", made: "x", files: {} }, null, 1));
    check("a release's copy reads its version from RELEASE.json; a folder without one has none",
      JSON.parse(execFileSync(phpExe, ["-r", code, path.join(ROOT, "includes", "version.php"), fake, home], { encoding: "utf8", windowsHide: true })), ["0.15", null]);
    const st = (await api("api/status.php")).build || {};
    check("this checkout is not a release, and names the version in the code", [st.release, /^\d+\.\d+/.test(st.version || "")], [false, true]);
    check("the page's own look for a newer one starts nothing on a test copy", fs.existsSync(path.join(DATA, "newversion.json")), false);

    /* ---- Settings and the mailbox's button ------------------------------- */
    const keep = new Guard(["settings.json", "messages.json"]);
    try {
      const s = await api("api/settings.php", { window: { tellNewVersions: false } });
      check("the switch in Settings is kept", (s.settings || {}).window && s.settings.window.tellNewVersions, false);
      const defaults = ((await api("api/settings.php")).defaults || {}).window || {};
      check("and is on for a new copy, while downloading new versions by themselves is off until chosen", [defaults.tellNewVersions, defaults.getNewVersions], [true, false]);
      check("a newer PHP is offered for a new copy (unticked, in the Update now window), and Settings can stop the offer",
        [defaults.offerNewPhp, !!(((await api("api/settings.php")).schema || {}).window || {}).offerNewPhp], [true, true]);
      fs.writeFileSync(path.join(DATA, "messages.json"), JSON.stringify([{ id: "msg-newversion", at: new Date().toISOString(), kind: "info",
        title: "Xsegon 9.9 is out", body: "This is 0.15.", items: ["One"], url: PAGE + "v9.9", opens: ["newversion"], read: false }]));
      await b.goto();
      await b.ev(`window.open = (u, t, f) => { window.__opened = [u, t, f]; return null; }`);
      await b.ev(`import("/js/news.js").then((m) => m.openMail())`);
      // Its own row, found by its title: the page's load may have put another message above it.
      const btn = `([...document.querySelectorAll(".mail-row")].find((r) => /Xsegon 9\\.9 is out/.test(r.textContent)) || document).querySelector(".mail-show")`;
      await b.until(`!!${btn}`, true, 8000);
      check("the message has a button to the release's page", await b.ev(`(${btn} || {}).textContent`), "Open its page");
      await b.ev(`${btn}.click()`);
      check("which opens that page in a window of its own", await b.ev(`window.__opened`), [PAGE + "v9.9", "_blank", "noopener"]);
      await b.ev(`import("/js/news.js").then((m) => m.closeMail())`);
    } finally {
      keep.restore();
    }
  } finally {
    server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
};
