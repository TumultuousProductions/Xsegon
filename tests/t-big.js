/*  A library of 40,000 made-up games (empty files in the temp folder, added to
    the test copy's scanned-games.json and removed after): does Xsegon open,
    answer for and draw it. Timings are printed; limits are wide for a slow PC.
    Not part of a full run: node tests\run.js big  (another size: set XS_BIG=10000) */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const lib = require("./lib");
const { api, DATA, Guard, sleep } = lib;

const N = Math.max(1000, Number(process.env.XS_BIG) || 40000);
const ROMS = path.join(os.tmpdir(), "xs-big-roms");

module.exports = async function (b, check) {
  if (!fs.existsSync(path.join(DATA, "fixtures"))) {
    check("big: runs only on the test server's own copy", true, true);
    return;
  }
  const kept = new Guard(["scanned-games.json", "settings.json"]);
  const said = (what, ms, more) => console.log("    (" + what + ": " + (ms / 1000).toFixed(2) + " s" + (more ? ", " + more : "") + ")");
  const read = async (pathname) => {
    const t0 = Date.now();
    let r = null, bytes = 0, why = "";
    try {
      const res = await fetch(lib.BASE + "/" + pathname, { headers: { Origin: lib.BASE } });
      const text = await res.text();
      bytes = text.length;
      try { r = JSON.parse(text); } catch (e) { why = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140); }
    } catch (e) { why = String(e.message || e); }
    return { r: r || {}, ms: Date.now() - t0, mb: (bytes / 1048576).toFixed(1) + " MB", why: why };
  };

  try {
    /* ---- the made-up library ------------------------------------------------- */
    const before = (await read("api/library.php")).r;
    const titles = (before.games || []).map((g) => g.title);
    const consoles = Object.keys(before.platforms || {}).filter((p) => p && p !== "Windows" && p !== "Steam");
    if (titles.length < 20 || consoles.length < 3) {
      check("(too few games or consoles in this copy to make a library from: the group steps aside)", true);
      return;
    }
    // A real collection's shape: a few large consoles and many small. The largest holds about a quarter.
    const weights = consoles.map((p, i) => 1 / Math.pow(i + 1, 1.05)), sum = weights.reduce((a, c) => a + c, 0);
    const made = [], counts = {};
    let acc = 0;
    fs.rmSync(ROMS, { recursive: true, force: true });
    const t0 = Date.now();
    consoles.forEach((p, i) => {
      acc += weights[i] / sum;
      const upto = i === consoles.length - 1 ? N : Math.round(acc * N);
      const dir = path.join(ROMS, "c" + i);
      fs.mkdirSync(dir, { recursive: true });
      while (made.length < upto) {
        const k = made.length;
        const title = titles[k % titles.length] + " " + (Math.floor(k / titles.length) + 2);
        const file = path.join(dir, title.replace(/[<>:"\/\\|?*]/g, "") + " (" + k + ").zip");
        fs.closeSync(fs.openSync(file, "w"));
        made.push({ id: "xs-scan-" + crypto.createHash("sha1").update(p + "|" + k).digest("hex").slice(0, 12), title: title, platform: p, rom: file, added: "2026-10-01T12:00:00+00:00" });
        counts[p] = (counts[p] || 0) + 1;
      }
    });
    const real = JSON.parse(fs.readFileSync(path.join(DATA, "scanned-games.json"), "utf8"));
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), JSON.stringify(real.concat(made)));
    said(N + " made-up games and their files", Date.now() - t0, "on " + consoles.length + " consoles");
    const big = Object.keys(counts).sort((x, y) => counts[y] - counts[x])[0];

    /* ---- the server answers for it, with PHP's own settings as they come ------- */
    await api("api/settings.php", { view: { default: "list", systemsFirst: false, sort: "title", sortReverse: false, groupHeaders: false, sidebar: false },
      video: { inBrowse: false, inDetails: false }, feel: { openFromLast: false } });
    let x = await read("api/library.php?sort=title&grouped=0");
    said("the list of every game", x.ms, x.mb + ", " + x.r.count + " games" + (x.why ? ", said: " + x.why : ""));
    // Versions of one game share a card, so the count is a little under the files made.
    check("a library of " + N + " games is read whole: the list of every game answers", [x.r.ok === true, x.r.count > N * 0.85, x.ms < 20000], [true, true, true]);
    check("and it says how many games there are in all", x.r.total > N * 0.85, true);
    const sentAll = (x.r.games || []).length;
    x = await read("api/library.php?sort=title&grouped=0&platform=" + encodeURIComponent(big));
    said("its largest console, " + big, x.ms, x.r.count + " games");
    check("its largest console answers", [x.r.ok === true, x.r.count > counts[big] * 0.85, x.ms < 20000], [true, true, true]);
    x = await read("api/library.php?sort=title&grouped=0&q=" + encodeURIComponent(titles[0].split(" ")[0]));
    said("a search", x.ms, x.r.count + " found");
    check("a search answers and finds games", [x.r.ok === true, x.r.count > 0, x.ms < 20000], [true, true, true]);
    x = await read("api/notes.php?id=" + made[N - 1].id);
    said("one game", x.ms);
    check("one game of them is read by itself, quickly", [x.r.ok === true, x.ms < 3000], [true, true]);
    x = await read("api/status.php");
    said("the status read", x.ms);
    check("the status read the page makes every few seconds answers", [x.r.ok === true, x.ms < 10000], [true, true]);
    x = await read("api/game.php?id=" + made[0].id);
    check("a made-up game's details answer", x.r.ok, true);

    /* ---- the page opens it ---------------------------------------------------- */
    const up = Date.now();
    await b.goto(null, { keepView: true });
    const drawn = await b.waitFor(`document.querySelectorAll("#view .row").length > 5`, 120000);
    said("the page, to its list drawn", Date.now() - up);
    check("the page opens on the list of every game", drawn, true);
    await sleep(500);
    const rows = await b.ev(`document.querySelectorAll("#view .row").length`);
    const count = await b.ev(`document.getElementById("count").textContent`);
    console.log("    (the page drew " + rows + " rows of the " + sentAll + " sent; its count reads \"" + count + "\")");
    check("the rows the server sent are all drawn", rows, sentAll);
    check("the count names every game of the library", Number(String(count).split(" of ")[1]) > N * 0.85, true);
    const step = await b.ev(`(() => { const at = () => [...document.querySelectorAll("#view .row")].findIndex((r) => r.classList.contains("sel"));
      const was = at(), t = performance.now();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      return JSON.stringify([was, at(), Math.round(performance.now() - t)]); })()`);
    const [was, now, ms] = JSON.parse(step);
    console.log("    (one step down the list: " + ms + " ms)");
    check("a step down moves the bar one game on", now - was, 1);
    await b.key("i");
    check("and that game's details open", await b.waitFor(`!document.getElementById("details").hidden`, 10000), true);
    await b.key("Escape");
    await sleep(300);
  } finally {
    kept.restore();
    fs.rmSync(ROMS, { recursive: true, force: true });
  }
};
