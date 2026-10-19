/*  Xsegon updating itself (roadmap BD4): got ready in the background, put in
    place by the start script with no server running, and taken out again.

    Everything happens on copies under tests\out\update, never this folder:
    two releases are made from the files here (0.15 and 0.16, signed with a key
    of the test's own by tools\update-release.js), served by a stand-in GitHub
    in this process. A copy of 0.15 with a person's data, a private\ folder, a
    theme of their own and a change to a shipped stylesheet is updated: the
    daily look says 0.16 is out and downloads nothing, Update now gets it ready
    (bin\update.php: the signed list, the zip, every file, a trial start), then
    presses (a backup, then go.json), and bin\update-start.ps1 makes the switch
    as start.ps1 would. Then Go back, and on copies where new versions download
    by themselves: the power going halfway, and releases that are damaged,
    signed by another key, or will not start. start.ps1 itself is not run here:
    a fresh copy's first start makes a Games folder on the PC. Last, the Update
    now window on the run's page, against a stand-in answer.                   */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { api, ROOT, OUT, Guard, sleep } = require("./lib");
const ur = require("../tools/update-release");

const TAKE = ["api", "bin", "css", "doc/CHANGELOG.md", "img", "includes", "js", "phone", "sounds", "themes",
  "index.php", "play.php", "router.php", "router-fast.php", "router-phone.php", "start.ps1", "LICENSE", "THIRD-PARTY.txt"];
const run = (exe, args, env, cwd) => new Promise((done) => execFile(exe, args, { env: Object.assign({}, process.env, env || {}), cwd, windowsHide: true, encoding: "utf8", timeout: 120000 },
  (e, out, err) => done({ code: e ? (e.code || 1) : 0, out: String(out || ""), err: String(err || "") })));
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
function walk(dir, rel, out) {
  if (!fs.existsSync(dir)) { return out; }
  for (const n of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, n), r = rel ? rel + "/" + n : n;
    if (fs.statSync(p).isDirectory()) { walk(p, r, out); } else { out.push(r); }
  }
  return out;
}
/** Every file of a copy but its data, by checksum. */
const prints = (dir) => { const m = {}; for (const r of walk(dir, "", [])) { if (!r.startsWith("data/")) { m[r] = sha(path.join(dir, r)); } } return m; };
/** The person's own data: what the steps themselves write (the mailbox, the last look, the log, a backup, the updater's folder) left out. */
const mine = (dir) => { const m = {}; for (const r of walk(path.join(dir, "data"), "data", [])) { if (!/^data\/(update|log|backups)\/|^data\/(messages|newversion)\.json$/.test(r)) { m[r] = sha(path.join(dir, r)); } } return m; };
const differ = (a, b) => Object.keys(a).filter((k) => a[k] !== b[k]).concat(Object.keys(b).filter((k) => !(k in a)));

module.exports = async function (b, check) {
  const phpExe = ((await api("api/status.php")).build || {}).phpExe;
  const home = path.join(OUT, "update");
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  const keyOf = (name) => { const k = path.join(home, "keys", name + ".pem"); ur.newKey(k, k + ".pub"); return k; };
  const key = keyOf("ours"), other = keyOf("someone-else");

  /* ---- two releases of the files here, and three that go wrong --------- */
  const pkg = (name, version, signWith, change) => {
    const app = path.join(home, "pkg", name, "Xsegon");
    for (const t of TAKE) { if (fs.existsSync(path.join(ROOT, t))) { fs.cpSync(path.join(ROOT, t), path.join(app, t), { recursive: true }); } }
    fs.copyFileSync(key + ".pub", path.join(app, "includes", "update-key.pem"));   // every copy trusts our key
    if (change) { change(app); }
    if (signWith !== key) {
      // Another's key: the package must carry its public half to be made at all, then gets ours back.
      fs.copyFileSync(signWith + ".pub", path.join(app, "includes", "update-key.pem"));
      const made = ur.makeUpdate({ app, version, key: signWith, out: path.join(home, "dl", name) });
      fs.copyFileSync(key + ".pub", path.join(app, "includes", "update-key.pem"));
      return Object.assign({ app }, made);
    }
    return Object.assign({ app }, ur.makeUpdate({ app, version, key, out: path.join(home, "dl", name) }));
  };
  const old = pkg("old", "0.15", key, (app) => fs.writeFileSync(path.join(app, "img", "only-in-0.15.txt"), "gone in 0.16\n"));
  const good = pkg("good", "0.16", key, (app) => fs.writeFileSync(path.join(app, "img", "new-in-0.16.txt"), "new\n"));
  const broken = pkg("broken", "0.16", key, (app) => fs.writeFileSync(path.join(app, "api", "status.php"), "<?php\nthis_release_is_broken_on_purpose();\n"));
  const forged = pkg("forged", "0.16", other, null);
  fs.cpSync(path.join(home, "dl", "good"), path.join(home, "dl", "damaged"), { recursive: true });
  const dz = path.join(home, "dl", "damaged", "Xsegon-update-0.16.zip");
  const bytes = fs.readFileSync(dz); bytes[bytes.length >> 1] ^= 0xff; fs.writeFileSync(dz, bytes);
  check("a release lists Xsegon's own files with its version, and the big parts not at all",
    [good.files > 400, /"version": "0\.16"/.test(fs.readFileSync(path.join(good.app, "RELEASE.json"), "utf8")),
     Object.keys(JSON.parse(fs.readFileSync(path.join(good.app, "RELEASE.json"), "utf8")).files).some((p) => /^(runtime|gamesdb|data)\//.test(p))],
    [true, true, false]);

  // The stand-in GitHub: the releases list names whichever release the test serves now.
  let serving = "good";
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url);
    if (u === "/releases") {
      const base = "http://127.0.0.1:" + server.address().port + "/dl/" + serving + "/";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([{ tag_name: "v0.16", html_url: "https://github.com/TumultuousProductions/Xsegon/releases/tag/v0.16", draft: false, prerelease: false,
        body: "Faster lists", assets: ["zip", "json", "sig"].map((x) => ({ name: "Xsegon-update-0.16." + x, browser_download_url: base + "Xsegon-update-0.16." + x,
          size: fs.statSync(path.join(home, "dl", serving, "Xsegon-update-0.16." + x)).size })) }]));
      return;
    }
    const f = path.join(home, u.replace(/^\/+/, ""));
    if (u.startsWith("/dl/") && fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200); res.end(fs.readFileSync(f)); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const releases = "http://127.0.0.1:" + server.address().port + "/releases";

  /** A copy of 0.15 as a person has it after a while. auto: new versions download by themselves. */
  const install = (name, auto) => {
    const copy = path.join(home, "copies", name, "Xsegon");
    fs.cpSync(old.app, copy, { recursive: true });
    fs.mkdirSync(path.join(copy, "data"), { recursive: true });
    fs.writeFileSync(path.join(copy, "data", "settings.json"), JSON.stringify({ window: { tellNewVersions: true, getNewVersions: !!auto } }));
    fs.writeFileSync(path.join(copy, "data", "favourites.json"), JSON.stringify(["snes-zelda3"]));
    fs.mkdirSync(path.join(copy, "private"), { recursive: true });
    fs.writeFileSync(path.join(copy, "private", "notes.txt"), "mine\n");
    fs.writeFileSync(path.join(copy, "themes", "my-own.json"), "{\"name\": \"My own\"}\n");
    fs.appendFileSync(path.join(copy, "css", "xsegon.css"), "\n/* my own change */\n");
    return copy;
  };
  const env = (copy) => ({ XSEGON_DATA: path.join(copy, "data"), XSEGON_NEWVERSION_URL: releases });
  const upFile = (copy, n) => path.join(copy, "data", "update", n);
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } };
  const message = (copy) => (readJson(path.join(copy, "data", "messages.json")) || []).find((m) => m.id === "msg-newversion") || null;
  /** The daily look: what it found. */
  const look = async (copy) => JSON.parse((await run(phpExe, [path.join(copy, "bin", "newversion.php")], env(copy), copy)).out || "{}");
  /** However long getting it ready takes in the background. */
  const waitFetch = async (copy) => {
    for (let i = 0; i < 240; i++) {
      const job = readJson(upFile(copy, "fetch.json"));
      if (job && job.state !== "running") { return job; }
      await sleep(250);
    }
    return readJson(upFile(copy, "fetch.json"));
  };
  const lookAndWait = async (copy) => { await look(copy); return waitFetch(copy); };
  const ps = (copy, call) => run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
    ". '" + path.join(copy, "bin", "update-start.ps1") + "'; " + call + " '" + copy + "' '" + phpExe + "'"], {}, copy);
  const php = (copy, code) => run(phpExe, ["-r", "require 'includes/boot.php'; require 'includes/update.php'; " + code], { XSEGON_DATA: path.join(copy, "data") }, copy);

  try {
    /* ---- a good update -------------------------------------------------- */
    let c = install("good");
    const before = prints(c), data0 = mine(c);
    await look(c);
    let m = message(c);
    const zipMb = Math.round(fs.statSync(path.join(home, "dl", "good", "Xsegon-update-0.16.zip")).size / 1048576 * 10) / 10;
    check("the daily look says 0.16 is out, once, with Update now and its page, and downloads nothing by itself",
      [m && m.title, m && m.opens, ((m || {}).body || "").indexOf("Update now asks first, then downloads it (" + zipMb + " MB)") >= 0, fs.existsSync(path.join(c, "data", "update"))],
      ["Xsegon 0.16 is out", ["updatenow", "newversion"], true, false]);
    let r = await php(c, "$s = xs_update_state(); echo json_encode([$s['out'], $s['ready'], xs_update_get_now(), xs_update_state()['fetch']['by'] ?? null]);");
    check("Update now finds it out and not downloaded, and gets it ready first", JSON.parse(r.out || "[]"), [{ version: "0.16", mb: zipMb }, null, null, "press"]);
    let job = await waitFetch(c);
    m = message(c);
    check("in the background: its signed list, the download to the last byte, every file checked, a trial start",
      [job && job.state, job && job.why, job && job.step, job && job.size > 0 && job.got === job.size], ["done", "", "try", true]);
    check("the mailbox says it is ready, once, with Update now and its page",
      [m && m.title, m && m.opens, m && m.items, /^This is 0\.15\./.test((m || {}).body || "")], ["Xsegon 0.16 is ready", ["updatenow", "newversion"], ["Faster lists"], true]);
    check("and nothing of the copy in use, or its data, has changed by one byte", [differ(before, prints(c)).length, differ(data0, mine(c)).length], [0, 0]);
    check("the new copy waits whole, with the switcher beside it",
      [(readJson(upFile(c, "ready.json")) || {}).version, fs.existsSync(upFile(c, "next") + "/img/new-in-0.16.txt"), fs.existsSync(upFile(c, "updater.php"))], ["0.16", true, true]);

    r = await run(phpExe, ["-r", "require 'includes/boot.php'; require 'includes/custom.php'; echo json_encode(xs_release_changes());"], { XSEGON_DATA: path.join(c, "data") }, c);
    const rc = JSON.parse(r.out || "{}");
    check("a report can say which of Xsegon's files the person changed from the release", [rc.version, rc.changed, rc.missing], ["0.15", ["css/xsegon.css"], []]);
    r = await php(c, "echo json_encode([xs_update_press('update'), xs_update_state()]);");
    let said = JSON.parse(r.out || "[null, {}]");
    check("Update now takes a backup and writes the press down for the next start",
      [said[0], said[1].going, (readJson(upFile(c, "go.json")) || {}).to, walk(path.join(c, "data", "backups"), "", []).some((n) => /^xsegon-\d{4}-.*\.zip$/.test(n))],
      [null, "update", "0.16", true]);
    const dataPress = mine(c);
    r = await ps(c, "Invoke-XsegonUpdate");
    const after = prints(c);
    const list = JSON.parse(fs.readFileSync(path.join(good.app, "RELEASE.json"), "utf8")).files;
    const wrong = Object.keys(list).filter((p) => after[p] !== list[p].sha256);
    check("the start script puts 0.16 in place: every one of its files, byte for byte", [r.out.trim(), wrong.length], ["switched", 0]);
    check("the file 0.16 no longer has is gone, and the one it adds is there",
      [fs.existsSync(path.join(c, "img", "only-in-0.15.txt")), fs.existsSync(path.join(c, "img", "new-in-0.16.txt"))], [false, true]);
    check("the person's data, private folder and own theme are untouched",
      [differ(dataPress, mine(c)).length, after["private/notes.txt"] === before["private/notes.txt"], after["themes/my-own.json"] === before["themes/my-own.json"]], [0, true, true]);
    const sw = readJson(upFile(c, "switch.json")) || {};
    check("their change to a shipped file is kept aside and named",
      [sw.kept, /my own change/.test(fs.readFileSync(upFile(c, "previous") + "/css/xsegon.css", "utf8"))], [["css/xsegon.css"], true]);
    check("the press is used up, the first start is marked, and the ready message is gone",
      [fs.existsSync(upFile(c, "go.json")), fs.existsSync(upFile(c, "first-start.json")), message(c)], [false, true, null]);
    check("the copy now says it is 0.16", JSON.parse((await run(phpExe, ["-r", "require 'includes/version.php'; echo json_encode(xs_release());"], {}, c)).out), "0.16");
    const logText = walk(path.join(c, "data", "log"), "", []).map((f) => fs.readFileSync(path.join(c, "data", "log", f), "utf8")).join("");
    check("the log says each step", [/UPD .*getting 0\.16 ready as Update now was pressed/.test(logText), /UPD .*0\.16 is ready/.test(logText),
      /UPD .*Update now: 0\.16/.test(logText), /UPD  put 0\.16 in place of 0\.15/.test(logText)], [true, true, true, true]);

    /* ---- it would not start: back by itself ------------------------------ */
    r = await ps(c, "Undo-XsegonUpdate");
    check("when it does not answer at its first start, the version before is put back byte for byte", [r.out.trim(), differ(before, prints(c)).length], ["True", 0]);
    const back = (readJson(path.join(c, "data", "messages.json")) || []).find((x) => x.id === "msg-update-back") || {};
    check("and the mailbox says so, and that nothing was lost", [back.title, /Nothing was lost/.test(back.body || "")], ["Xsegon 0.16 did not start on this PC", true]);
    check("0.16 is not got ready again by itself", (readJson(upFile(c, "skipped.json")) || {}).version, "0.16");

    /* ---- the power goes halfway ----------------------------------------- */
    c = install("cut", true);
    const cut0 = prints(c);
    job = await lookAndWait(c);
    check("where new versions download by themselves, the daily look gets it ready with no press, and the message says it is ready",
      [job && job.state, job && job.by, (message(c) || {}).title], ["done", "look", "Xsegon 0.16 is ready"]);
    // An odd count: it stops between moving an old file aside and the new one in, so a file is missing.
    r = await run(phpExe, [upFile(c, "updater.php"), "switch", "--stop-after=201"], {}, c);
    check("a switch stopped dead halfway leaves a mixed copy", [r.code, differ(cut0, prints(c)).length > 0], [3, true]);
    r = await ps(c, "Invoke-XsegonUpdate");
    check("the next start puts it back byte for byte, before anything else", [r.out.trim(), differ(cut0, prints(c)).length, fs.existsSync(upFile(c, "switch.json"))], ["", 0, false]);
    await php(c, "xs_update_press('update');");
    r = await ps(c, "Invoke-XsegonUpdate");
    check("and Update now still works afterwards, with no new download", [r.out.trim(), JSON.parse((await run(phpExe, ["-r", "require 'includes/version.php'; echo json_encode(xs_release());"], {}, c)).out)], ["switched", "0.16"]);

    /* ---- releases that must never be put in place ------------------------ */
    for (const [name, why] of [["damaged", /arrived damaged/], ["forged", /not signed with Xsegon's key/], ["broken", /did not start when tried on its own: it answered with an error/]]) {
      serving = name;
      c = install(name, true);
      const p0 = prints(c), d0 = mine(c);
      job = await lookAndWait(c);
      m = message(c);
      check("a release " + ({ damaged: "damaged on the way", forged: "signed with another key", broken: "that will not start" })[name] + " is never got ready",
        [job && job.state, why.test((job && job.why) || ""), fs.existsSync(upFile(c, "next")), fs.existsSync(upFile(c, "ready.json"))], ["failed", true, false, false]);
      check("  the copy and its data are as they were, and the message still says it is out, with Update now and its page",
        [differ(p0, prints(c)).length, differ(d0, mine(c)).length, m && m.title, m && m.opens], [0, 0, "Xsegon 0.16 is out", ["updatenow", "newversion"]]);
      if (name === "damaged") {
        const again = await look(c);
        check("  the next daily look does not download it again by itself; Update now would", [again.getting, (readJson(upFile(c, "fetch.json")) || {}).state], [false, "failed"]);
      }
    }
    serving = "good";

    /* ---- a look of the person's own (includes\custom.php) ---------------- */
    const own = path.join(home, "own");
    fs.mkdirSync(path.join(own, "includes"), { recursive: true });
    r = await run(phpExe, ["-r", "define('XS_ROOT', $argv[1]); require $argv[2]; echo json_encode([xs_custom_state(), xs_custom_make(), xs_custom_state()]);",
      own, path.join(ROOT, "includes", "custom.php")], {}, own);
    const looks = JSON.parse(r.out || "[{},null,{}]");
    check("your own folder is made the first time, with a stylesheet saying what to do, and is never a release's",
      [looks[0].css, looks[1], looks[2].css, looks[2].starter, /Updates never touch this folder/.test(fs.readFileSync(path.join(own, "custom", "style.css"), "utf8")),
       Object.keys(JSON.parse(fs.readFileSync(path.join(good.app, "RELEASE.json"), "utf8")).files).some((p) => /^custom\//.test(p))],
      [false, null, true, true, true, false]);
    const hadOwn = fs.existsSync(path.join(ROOT, "custom"));
    const opened = await api("api/reveal.php", { what: "custom" });
    check("Open my folder on a test copy opens nothing and makes nothing beside index.php",
      [opened.ok, opened.dry, fs.existsSync(path.join(ROOT, "custom")) === hadOwn], [true, true, true]);

    /* ---- what may not press -------------------------------------------- */
    const refused = await api("api/update.php", { action: "update" });
    check("a git checkout never updates itself this way", [refused.ok, /git checkout/.test(refused.error || "")], [false, true]);
    const st = await api("api/update.php");
    check("and says what it is", [st.ok, st.release, st.cannot, st.ready, st.out], [true, false, "a git checkout", null, null]);
    const notGot = await api("api/update.php", { action: "get" });
    check("nor downloads one", [notGot.ok, /git checkout/.test(notGot.error || "")], [false, true]);

    /* ---- the Update now window, against a stand-in answer --------------- */
    const keep = new Guard(["settings.json"]);
    try {
      await api("api/settings.php", { window: { getNewVersions: false } });
      await b.goto();
      // api\update.php answers as a release's copy would: 0.16 out, then downloading, then ready. Every other ask is the real server's.
      await b.ev(`(() => {
        const real = window.fetch;
        window.__upd = { real: real, posts: [], reads: 0 };
        const answer = (o) => Promise.resolve(new Response(JSON.stringify(Object.assign({ ok: true, have: "0.15", release: true, on: true, get: false, cannot: null,
          going: null, back: null, kept: [], restarts: false }, o)), { headers: { "Content-Type": "application/json" } }));
        const out = { version: "0.16", mb: 7.1 };
        window.fetch = (u, o) => {
          if (String(u).indexOf("api/update.php") < 0) { return real(u, o); }
          if (o && o.method === "POST") {
            const a = JSON.parse(o.body).action;
            window.__upd.posts.push(a);
            return answer(a === "get" ? { out: out, ready: null, fetch: { alive: true, state: "running", version: "0.16", step: "list" } } : { ready: "0.16", out: null });
          }
          const n = ++window.__upd.reads;
          if (n === 1) { return answer({ out: out, ready: null, fetch: null }); }
          if (n === 2) { return answer({ out: out, ready: null, fetch: { alive: true, state: "running", version: "0.16", step: "download", got: 3145728, size: 7340032 } }); }
          return answer({ ready: "0.16", out: null, fetch: { alive: false, state: "done", version: "0.16" } });
        };
      })()`);
      await b.ev(`import("/js/updaterow.js").then((m) => { m.pressUpdate("update"); })`);
      await b.until(`!!document.querySelector(".confirm h2")`, true, 5000);
      check("Update now asks first: what happens, and whether the next versions download by themselves, not selected",
        await b.ev(`(() => { const box = document.querySelector(".confirm"), t = box.querySelector("input[type=checkbox]");
          return [box.querySelector("h2").textContent, box.textContent.indexOf("downloads it first (7.1 MB)") >= 0, !!t && t.checked,
                  [...box.querySelectorAll(".confirm-bar button")].map((x) => x.textContent), window.__upd.posts]; })()`),
        ["Update to Xsegon 0.16?", true, false, ["Not now", "Update now"], []]);
      await b.ev(`document.querySelector(".confirm input[type=checkbox]").click()`);
      let kept = false;
      for (let i = 0; i < 40 && !kept; i++) { await sleep(100); kept = (((await api("api/settings.php")).settings || {}).window || {}).getNewVersions === true; }
      check("selecting it is kept at once, with nothing downloaded yet", [kept, await b.ev(`window.__upd.posts`)], [true, []]);
      await b.ev(`[...document.querySelectorAll(".confirm-bar button")].find((x) => x.textContent === "Update now").click()`);
      const line = `(document.querySelector('.job-bar[data-job="update"] .fb-line') || {}).textContent || ""`;
      check("pressed, it downloads with a bar in the corner", await b.until(line, "Xsegon 0.16: downloading, 3.0 of 7.0 MB", 6000), "Xsegon 0.16: downloading, 3.0 of 7.0 MB");
      const strip = `document.getElementById("strip").textContent.indexOf("0.16 goes in place the next time Xsegon starts") >= 0`;
      check("and once it is ready, Update now is pressed for them: a backup, then the switch at the next start",
        [await b.until(strip, true, 8000), await b.ev(`window.__upd.posts`), await b.ev(line)], [true, ["get", "update"], "Xsegon 0.16: done"]);
      await b.ev(`window.fetch = window.__upd.real`);
    } finally {
      keep.restore();
    }
  } finally {
    server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
};
