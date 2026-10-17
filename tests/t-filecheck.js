/*  The file check (includes\filecheck.php, api\filecheck.php, js\filecheck.js):
    what a game's file really is, by its checksum.

    Against stand-in lists in the folder the test server reads libretro's from
    (XSEGON_LIBRETRO_META) and stand-in game files made here, so nothing
    reaches libretro and no real game is read. LaunchBox is switched off and
    the scanned list is these games alone for the length of it. */
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { api, DATA, ROOT, Guard, sleep } = require("./lib");

const TAR = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
const NES = "Nintendo - Nintendo Entertainment System", SNES = "Nintendo - Super Nintendo Entertainment System", N64 = "Nintendo - Nintendo 64";
const sum = (algo, b) => crypto.createHash(algo).update(b).digest("hex").toUpperCase();
function bytes(seed, n) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) { b[i] = (i * 31 + seed * 7 + (i >> 8)) & 255; }
  return b;
}
function list(fx, sys, roms) {
  const dir = path.join(fx, "meta", "no-intro");
  fs.mkdirSync(dir, { recursive: true });
  const out = ["clrmamepro (", "\tname \"" + sys + "\"", ")", ""];
  for (const [name, b, serial] of roms) {
    out.push("game (", "\tname \"" + name.replace(/\.[a-z0-9]+$/, "") + "\"",
      "\trom ( name \"" + name + "\" size " + b.length + " crc 00000000 md5 " + sum("md5", b) + " sha1 " + sum("sha1", b) + (serial ? " serial \"" + serial + "\"" : "") + " )", ")");
  }
  fs.writeFileSync(path.join(dir, sys + ".dat"), out.join("\n") + "\n");
}

module.exports = async function (b, check) {
  const fx = path.join(DATA, "fixtures", "libretro");
  if (!fs.existsSync(fx)) {
    check("filecheck: runs only on the test server's own copy (never against libretro itself)", true, true);
    return;
  }
  const kept = new Guard(["scanned-games.json", "filecheck.json"]);
  const before = (await api("api/settings.php")).settings;
  const roms = path.join(DATA, "fixtures", "filecheck-roms");
  fs.rmSync(roms, { recursive: true, force: true });
  fs.mkdirSync(path.join(roms, "nes", "Hacks"), { recursive: true });
  for (const f of fs.existsSync(path.join(DATA, "libretro")) ? fs.readdirSync(path.join(DATA, "libretro")) : []) {
    if (/\.releases\.json$/.test(f)) { fs.rmSync(path.join(DATA, "libretro", f), { force: true }); }
  }

  /* ---- the stand-in games ------------------------------------------------ */
  const std = Buffer.from([0x4E, 0x45, 0x53, 0x1A, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const old = Buffer.from([0x4E, 0x45, 0x53, 0x1A, 2, 1, 0, 0x44, 0x69, 0x73, 0x6B, 0x44, 0x75, 0x64, 0x65, 0x21]);
  const nes = (seed, head) => Buffer.concat([head || std, bytes(seed, 16384)]);
  const file = (rel, buf) => { const p = path.join(roms, rel); fs.writeFileSync(p, buf); return p; };

  const known = file("nes/Whatever It Is Called.nes", nes(1));
  const odd = file("nes/Odd Header.nes", nes(2, old));
  const made = file("nes/Made Up (U) [T+Rus Somebody].nes", nes(3));
  const hack = file("nes/Hacks/Something Else.nes", nes(4));
  const fresh = file("nes/Fresh One.nes", nes(7));
  fs.writeFileSync(path.join(roms, "Zipped (Japan).nes"), nes(5));
  fs.writeFileSync(path.join(roms, "notes.txt"), "a note that comes along\r\n");
  const zipped = path.join(roms, "nes", "Zipped Quest.zip");
  execFileSync(TAR, ["-a", "-cf", zipped, "-C", roms, "notes.txt", "Zipped (Japan).nes"], { windowsHide: true });
  fs.writeFileSync(path.join(roms, "two players.bps"), "BPS1 not a real patch");
  const patch = path.join(roms, "nes", "A Patch.zip");
  execFileSync(TAR, ["-a", "-cf", patch, "-C", roms, "notes.txt", "two players.bps"], { windowsHide: true });
  const broken = file("nes/Broken.zip", Buffer.from("this was never a zip"));
  const has7z = fs.existsSync(path.join(ROOT, "bin", "7zr.exe"));
  fs.writeFileSync(path.join(roms, "Seven (World).nes"), nes(6));
  const seven = path.join(roms, "nes", "Seven.7z");
  execFileSync(TAR, ["--format", "7zip", "-cf", seven, "-C", roms, "Seven (World).nes"], { windowsHide: true });

  // A SNES game with a copier's 512 bytes in front, and its own header saying who it is.
  const snes = bytes(8, 32768);
  snes.write("STAND IN SNES".padEnd(21), 0x7FC0, "latin1");
  snes[0x7FD5] = 0x20; snes[0x7FD9] = 0x01;
  snes.writeUInt16LE(0xEDCB, 0x7FDC); snes.writeUInt16LE(0x1234, 0x7FDE);
  const copied = file("Copied.smc", Buffer.concat([Buffer.alloc(512), snes]));
  // An N64 game kept byte-swapped (v64), its header in the standard order saying USA.
  const z64 = bytes(9, 4096);
  Buffer.from([0x80, 0x37, 0x12, 0x40]).copy(z64, 0);
  z64.write("STAND IN 64".padEnd(20), 0x20, "latin1");
  z64.write("NSIE", 0x3B, "latin1");
  const v64 = Buffer.from(z64); v64.swap16();
  const swapped = file("Swapped.v64", v64);
  // The same game changed by somebody: on no list, but still carrying its game code.
  const changed = Buffer.from(z64); changed[0x800] ^= 0xFF;
  const remix = file("Remix.z64", changed);
  const gb = file("No List.gb", bytes(10, 32768));
  const disc = file("A Disc.bin", bytes(11, 4096));

  list(fx, NES, [
    ["Stand-in Quest (USA) (Rev 1).nes", nes(1)], ["Stand-in Quest (USA) (Rev 1).unh", bytes(1, 16384)],
    ["Odd Header (Europe) (En,Fr) (Beta).nes", nes(2)], ["Odd Header (Europe) (En,Fr) (Beta).unh", bytes(2, 16384)],
    ["Zipped (Japan).nes", nes(5)], ["Seven (World).nes", nes(6)], ["Fresh One (USA, Europe).nes", nes(7)],
  ]);
  list(fx, SNES, [["Copied (USA).sfc", snes]]);
  list(fx, N64, [["Swapped (USA) (Rev 1).z64", bytes(12, 4096), "NSIE"], ["Swapped (USA).z64", z64, "NSIE"]]);

  const id = (n) => "xs-scan-fct-" + n;
  const games = [
    { id: id("known"), title: "Fct Known", platform: "Nintendo Entertainment System", rom: known },
    { id: id("odd"), title: "Fct Odd Header", platform: "Nintendo Entertainment System", rom: odd },
    { id: id("made"), title: "Fct Made Up", platform: "Nintendo Entertainment System", rom: made },
    { id: id("hack"), title: "Fct Something Else", platform: "Nintendo Entertainment System", rom: hack },
    { id: id("fresh"), title: "Fct Fresh One", platform: "Nintendo Entertainment System", rom: fresh },
    { id: id("zipped"), title: "Fct Zipped", platform: "Nintendo Entertainment System", rom: zipped },
    { id: id("patch"), title: "Fct A Patch", platform: "Nintendo Entertainment System", rom: patch },
    { id: id("broken"), title: "Fct Broken", platform: "Nintendo Entertainment System", rom: broken },
    { id: id("seven"), title: "Fct Seven", platform: "Nintendo Entertainment System", rom: seven },
    { id: id("copied"), title: "Fct Copied", platform: "Super Nintendo Entertainment System", rom: copied },
    { id: id("swapped"), title: "Fct Swapped", platform: "Nintendo 64", rom: swapped },
    { id: id("remix"), title: "Fct Remix", platform: "Nintendo 64", rom: remix },
    { id: id("gb"), title: "Fct No List", platform: "Nintendo Game Boy", rom: gb },
    { id: id("disc"), title: "Fct A Disc", platform: "Sony Playstation", rom: disc },
  ];
  const stored = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, "filecheck.json"), "utf8")); } catch (e) { return {}; } };
  // Asks until none is left: one request stops after a second or two.
  const run = async (ids) => {
    const done = {}, failed = {};
    for (let left = ids, i = 0; left.length && i < 50; i++) {
      const r = await api("api/filecheck.php", { ids: left });
      if (!r.ok) { return { ok: false, error: r.error }; }
      Object.assign(done, r.done); Object.assign(failed, r.failed);
      left = r.left || [];
    }
    return { ok: true, done, failed };
  };

  try {
    await api("api/settings.php", { paths: { launchbox: "" } });
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), JSON.stringify(games));
    fs.rmSync(path.join(DATA, "filecheck.json"), { force: true });

    /* ---- what can be checked, before anything is ------------------------- */
    let all = await api("api/filecheck.php");
    const mine = (r) => (r.games || []).filter((g) => g.id.startsWith("xs-scan-fct-"));
    check("the list is every game of a cartridge console, none checked yet, and no disc game",
      [all.ok, mine(all).length, mine(all).every((g) => g.check === null), mine(all).some((g) => g.id === id("disc"))], [true, 13, true, false]);
    check("each with the file it stands for", mine(all).find((g) => g.id === id("made")).file, "Made Up (U) [T+Rus Somebody].nes");

    /* ---- the answers ----------------------------------------------------- */
    const stamp = fs.statSync(known).mtimeMs, was = sum("sha1", fs.readFileSync(odd));
    const ids = games.map((g) => g.id).filter((x) => x !== id("fresh"));
    const r = await run(ids);
    const c = (n) => (r.done || {})[id(n)] || {};
    check("a file is known by its checksum, whatever it is called: name, region and revision",
      [c("known").kind, c("known").name, c("known").regions, c("known").revision, c("known").fix, c("known").stale],
      ["known", "Stand-in Quest (USA) (Rev 1)", ["USA"], "Rev 1", null, false]);
    check("with its checksums and size kept", [c("known").sha1, c("known").crc.length, c("known").bytes],
      [sum("sha1", nes(1)).toLowerCase(), 8, 16400]);
    check("a game whose header is not the standard one is the known game, said to be wrapped differently; languages and marks read off the name",
      [c("odd").kind, c("odd").name, c("odd").fix, c("odd").regions, c("odd").languages, c("odd").also],
      ["known", "Odd Header (Europe) (En,Fr) (Beta)", "header", ["Europe"], ["En", "Fr"], ["Beta"]]);
    check("a file on no list is not a known release, and its name says a translation", [c("made").kind, c("made").guess], ["unknown", "translation"]);
    check("one in a Hacks folder is taken for a hack", [c("hack").kind, c("hack").guess], ["unknown", "hack"]);
    check("a game inside a zip is read through it, the note beside it passed over",
      [c("zipped").kind, c("zipped").name, c("zipped").inner, c("zipped").regions], ["known", "Zipped (Japan)", "Zipped (Japan).nes", ["Japan"]]);
    check("a zip holding only a patch is a patch, not a game", c("patch").kind, "patch");
    check("a file that cannot be read says so, and why", [c("broken").kind, /zip/.test(c("broken").why || "")], ["unread", true]);
    if (has7z) {
      check("a game inside a .7z is read through bin\\7zr.exe", [c("seven").kind, c("seven").name, c("seven").regions], ["known", "Seven (World)", ["World"]]);
    } else {
      check("a .7z without bin\\7zr.exe is said as unreadable (7zr.exe is not in git)", [c("seven").kind, /7zr/.test(c("seven").why || "")], ["unread", true]);
    }
    check("a SNES game behind a copier's header is the known game, and its own header says who it is",
      [c("copied").kind, c("copied").name, c("copied").fix, (c("copied").header || {}).title, (c("copied").header || {}).region],
      ["known", "Copied (USA)", "copier", "STAND IN SNES", "USA"]);
    check("an N64 game kept byte-swapped is the known game, header read in the standard order",
      [c("swapped").kind, c("swapped").name, c("swapped").fix, (c("swapped").header || {}).title, (c("swapped").header || {}).region, (c("swapped").header || {}).code],
      ["known", "Swapped (USA)", "v64", "STAND IN 64", "USA", "NSIE"]);
    check("a changed game on no list is named for the release it was built on, by the game code it still carries (the release itself, not its revision)",
      [c("remix").kind, c("remix").base, (c("remix").header || {}).code, c("remix").guess], ["unknown", "Swapped (USA)", "NSIE", null]);
    check("a console whose list cannot be had is not checked, and says the list is why",
      [c("gb").kind, /list of known Nintendo Game Boy games could not be fetched/.test(r.failed[id("gb")] || "")], [undefined, true]);
    check("a disc console is refused in words", /cartridge consoles only/.test(r.failed[id("disc")] || ""), true);
    check("the answers are kept in data\\filecheck.json, and what was not checked is not",
      [Object.keys(stored()).sort(), "rom" in (stored()[id("known")] || {})],
      [ids.filter((x) => x !== id("gb") && x !== id("disc")).sort(), true]);
    check("no file was changed by being read", [fs.statSync(known).mtimeMs, sum("sha1", fs.readFileSync(odd))], [stamp, was]);

    /* ---- asked for again -------------------------------------------------- */
    const one = await api("api/filecheck.php?id=" + id("known"));
    check("one game's answer can be asked for", [one.ok, one.can, (one.check || {}).name], [true, true, "Stand-in Quest (USA) (Rev 1)"]);
    const dg = await api("api/filecheck.php?id=" + id("disc"));
    check("a disc game answers that it cannot be checked", [dg.ok, dg.can, dg.check], [true, false, null]);
    const full = await api("api/game.php?id=" + id("odd"));
    check("the details screen is told with the game", [((full.game || {}).fileCheck || {}).can, (((full.game || {}).fileCheck || {}).check || {}).fix], [true, "header"]);
    check("asking for nothing is refused, and an unknown game is said as that",
      [(await api("api/filecheck.php", { ids: [] })).ok, ((await api("api/filecheck.php", { ids: ["xs-scan-fct-nobody"] })).failed || {})["xs-scan-fct-nobody"]],
      [false, "unknown game"]);

    fs.appendFileSync(made, Buffer.from([1, 2, 3]));
    check("a file changed since is said to be", ((await api("api/filecheck.php?id=" + id("made"))).check || {}).stale, true);
    check("and checking it again clears that", ((await run([id("made")])).done[id("made")] || {}).stale, false);

    /* ---- in a game's details: File check, a part of More ---------------- */
    const choose = (n) => `(async () => { const S = await import("/js/state.js"), V = await import("/js/views.js");
      const i = S.games.findIndex(g => g.id === ${JSON.stringify(id(n))}); if (i < 0) { return false; } S.setSel(i); V.render(); return true; })()`;
    const TABS = `[...document.querySelectorAll("#details .dtabs .dtab")]`;
    // What is open: a part of More (File check, Notes) when More is, else the tab.
    const PARTS = `[...document.querySelectorAll("#details .dparts:not([hidden]) .dtab")]`;
    const tabOn = `(t => (t ? t.textContent : null))(${PARTS}.find((x) => x.classList.contains("on")) || ${TABS}.find((x) => x.classList.contains("on")))`;
    const legend = `[...document.querySelectorAll("#help .hitem .hl")].map((x) => x.textContent)`;
    const line = `(document.querySelector("#details .dtab-pane.is-filecheck .fc-line") || {}).textContent`;
    const goSays = `(document.querySelector("#details .dtab-pane.is-filecheck .fc-go .cr-name") || {}).textContent`;
    const fact = (k) => `(() => { const dt = [...document.querySelectorAll("#details .fc-facts dt")].find(n => n.textContent === ${JSON.stringify(k)}); return dt ? dt.nextElementSibling.textContent : null; })()`;
    const details = async (n) => {
      check("the game is on the list (" + n + ")", await b.ev(choose(n)), true);
      await b.settled();
      await b.key("i");
      await b.waitFor(`!document.getElementById("details").hidden && !!document.querySelector("#details .dtabs")`, 8000);
    };
    const back = async () => { await b.key("Escape"); await b.until(`document.getElementById("details").hidden`, true, 6000); };
    await b.goto();
    await b.setView("list");
    await b.openPlatform("Nintendo Entertainment System");

    await details("known");
    check("details has More last, after Files, and nothing of the check left under the facts",
      [await b.ev(`${TABS}.map((x) => x.textContent.replace(/ \\(\\d+\\)$/, ""))`), await b.ev(tabOn), await b.ev(`!!document.querySelector("#details .dleft .fcheck, #details .dleft .fc-line, #details .dleft .fc-go")`)],
      [["About", "Media", "Saves", "Cheats", "Hacks", "Achievements", "Files", "More"], "About", false]);
    await b.key("f");
    check("F opens it: where the game is from and that it is known, in one line",
      [await b.until(line, "USA, Rev 1  ·  a known release", 8000), await b.ev(tabOn)], ["USA, Rev 1  ·  a known release", "File check"]);
    check("under More, which is lit, with Notes beside it",
      [await b.ev(`${TABS}.find((x) => x.classList.contains("on")).textContent`), await b.ev(`${PARTS}.map((x) => x.textContent)`)], ["More", ["File check", "Notes"]]);
    check("under it the official name, the region and the revision", [await b.ev(fact("official name")), await b.ev(fact("region")), await b.ev(fact("revision"))],
      ["Stand-in Quest (USA) (Rev 1)", "USA", "Rev 1"]);
    check("with the file it read and its checksum", [await b.ev(fact("file")), await b.ev(fact("sha-1"))], ["Whatever It Is Called.nes", sum("sha1", nes(1)).toLowerCase()]);
    await b.key("f");
    check("and F again goes back to About", await b.until(tabOn, "About", 3000), "About");
    await b.clickSel(`#details .dtab[data-tab="more"]`);
    check("a click on More opens it too", [await b.until(tabOn, "File check", 3000), await b.until(line, "USA, Rev 1  ·  a known release", 3000)], ["File check", "USA, Rev 1  ·  a known release"]);
    await b.shot("filecheck-details");
    await back();

    await details("odd");
    await b.key("f");
    check("a differently wrapped game says so on the line, and in a sentence under it",
      [await b.until(line, "Europe  ·  a known release, wrapped differently", 8000), await b.ev(`/header is not the standard one/.test((document.querySelector("#details .fc-facts .fc-note") || {}).textContent || "")`), await b.ev(fact("languages")), await b.ev(fact("also marked"))],
      ["Europe  ·  a known release, wrapped differently", true, "En, Fr", "Beta"]);
    await back();

    await details("made");
    await b.key("f");
    check("a file on no list is marked on its line, with what its name suggests",
      [await b.until(line, "not a known release  ·  a translation, by its name", 8000), await b.ev(`document.querySelector("#details .fc-line").classList.contains("odd")`)], ["not a known release  ·  a translation, by its name", true]);
    await back();

    await details("fresh");
    await b.key("f");
    check("a game not checked yet says so, and offers to check this file", [await b.until(line, "not checked yet", 8000), await b.ev(goSays)], ["not checked yet", "Check this file"]);
    const launches = (await b.ev(`(window.__launches || []).length`)) || 0;
    await b.key("ArrowDown");
    check("Down goes onto that row, and the legend says what a press there does",
      [await b.until(`document.querySelector("#details .dtab-pane").classList.contains("in")`, true, 3000), await b.until(`${legend}.includes("check this file")`, true, 3000)], [true, true]);
    await b.key("Enter");
    check("and Enter there checks it, there and then, and starts no game",
      [await b.until(line, "USA, Europe  ·  a known release", 8000), await b.ev(`(window.__launches || []).length`), await b.ev(`document.getElementById("details").hidden`)],
      ["USA, Europe  ·  a known release", launches, false]);
    check("the answer kept, and offered to check again", [(stored()[id("fresh")] || {}).name, await b.ev(goSays)], ["Fresh One (USA, Europe)", "Check again"]);
    await b.clickSel(`#details .dtab[data-tab="about"]`);
    await b.until(tabOn, "About", 3000);
    await b.key("f");
    check("coming back to the tab shows that answer, not the one details opened with", await b.until(line, "USA, Europe  ·  a known release", 6000), "USA, Europe  ·  a known release");
    await back();

    /* ---- Games > Check game files ---------------------------------------- */
    const forget = stored(); delete forget[id("fresh")];
    fs.writeFileSync(path.join(DATA, "filecheck.json"), JSON.stringify(forget));
    const title = `(document.querySelector("#editor .panel-title") || {}).textContent`;
    const tops = `[...document.querySelectorAll("#editor .panel-inner > .fc-sec")]`;
    await b.openBar("games");
    await b.menuItem(/Check game files/);
    check("Games opens the check of every file", await b.until(title, "CHECK GAME FILES", 10000), "CHECK GAME FILES");
    check("one line per console, every one closed, the console with the most games first",
      [await b.ev(`${tops}.length`), await b.ev(`${tops}.every(d => !d.open)`), await b.ev(`/^Nintendo Entertainment System/.test(${tops}[0].querySelector("summary").textContent)`)], [4, true, true]);
    check("the line says what is in it, and how many games",
      [await b.ev(`${tops}[0].querySelector("summary").firstChild.textContent`), await b.ev(`${tops}[0].querySelector("summary .fc-n").textContent`)],
      ["Nintendo Entertainment System  ·  " + (has7z ? "2 USA" : "1 USA") + "  ·  2 other regions  ·  2 not known  ·  1 patch  ·  " + (has7z ? "1 unread" : "2 unread") + "  ·  1 not checked", "9"]);
    check("and above them, how many are checked and how many are not", await b.ev(`(document.querySelector("#editor .rp-verdict") || {}).textContent`), "11 files checked, 2 not yet.");
    await b.ev(`${tops}[0].querySelector("summary").click()`);
    const kinds = `[...${tops}[0].querySelectorAll(":scope > .fc-sec > summary")].map(s => s.firstChild.textContent)`;
    check("opened, a console lists its kinds, the ones to look at first, each closed",
      [await b.until(`${kinds}.length`, 6, 3000), await b.ev(kinds), await b.ev(`[...${tops}[0].querySelectorAll(":scope > .fc-sec")].every(d => !d.open)`)],
      [6, ["Not a known release", "A patch, not a game", "Could not be read", "Known releases from other regions", "Known USA releases", "Not checked yet"], true]);
    await b.ev(`${tops}[0].querySelector(":scope > .fc-sec > summary").click()`);
    check("and a kind lists its games with what each is",
      await b.until(`[...${tops}[0].querySelectorAll(".fc-row")].map(n => n.querySelector(".fc-t").textContent + " | " + n.querySelector(".fc-w").textContent).sort()`,
        ["Fct Made Up | a translation, by its name", "Fct Something Else | a hack, by its name"], 3000),
      ["Fct Made Up | a translation, by its name", "Fct Something Else | a hack, by its name"]);
    await b.shot("filecheck-window");

    check("the button says how many are left", await b.ev(`(document.querySelector("#editor .fc-acts button") || {}).textContent`), "Check 2 files");
    await b.ev(`document.querySelector("#editor .fc-acts button").click()`);
    /* The press closes the window by itself and the check goes on as a bar in the corner. */
    check("pressing it closes the window by itself", await b.until(`document.getElementById("editor").hidden`, true, 6000), true);
    check("the check goes on and says how it went, the one with no list named with its reason, and where to see what each is",
      await b.waitFor(`/1 file checked, 1 not: the list of known Nintendo Game Boy games could not be fetched.*Games > Check game files shows what each is/.test((s => s.hidden ? "" : s.textContent)(document.getElementById("strip")))`, 15000), true);
    check("its bar in the corner says it is done",
      await b.until(`(x => (x && !x.hidden ? x.querySelector(".fb-line").textContent : ""))(document.querySelector('#corner-bars .job-bar[data-job="filecheck"]'))`, "Check game files: done", 5000),
      "Check game files: done");
    check("and the file is in the answers", (stored()[id("fresh")] || {}).kind, "known");
    await b.openBar("games");
    await b.menuItem(/Check game files/);
    check("opened again, the count above has followed",
      await b.until(`(document.querySelector("#editor .rp-verdict") || {}).textContent`, "12 files checked, 1 not yet.", 8000), "12 files checked, 1 not yet.");
    await b.key("Escape");
    await sleep(400);
    check("Escape closes it", await b.ev(`document.getElementById("editor").hidden`), true);
  } finally {
    await api("api/settings.php", { paths: { launchbox: before.paths.launchbox } });
    kept.restore();
    fs.rmSync(roms, { recursive: true, force: true });
  }
};
