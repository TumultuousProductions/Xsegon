/*  Emulators > BIOS check (includes\bios.php, api\bios.php) and BIOS help
 *  (includes\bioshelp.php): your own files put in place from a folder, what
 *  one game lacks said when it fails to start, and the automatic Runs check
 *  leaving such games out with a message.
 *  Against a stand-in system folder (XSEGON_RA_SYSTEM, starts empty) and
 *  stand-in checksums (XSEGON_BIOS_SUMS), so a "genuine" file is made here. */
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { api, DATA, ROOT, Guard, romDrive } = require("./lib");

module.exports = async function (b, check) {
  const sys = path.join(DATA, "fixtures", "ra-system");
  if (!fs.existsSync(sys)) {
    check("bios: runs only on the test server's own copy", true, true);
    return;
  }
  const sumsFile = path.join(DATA, "fixtures", "bios-sums.json");
  const mine = path.join(DATA, "my-bios"), answer = path.join(DATA, "pick-answer.txt");
  const marker = path.join(DATA, "fixtures", "LaunchBox.exe");
  const emptySys = () => { for (const n of fs.readdirSync(sys)) { fs.rmSync(path.join(sys, n), { recursive: true, force: true }); } };
  const psxOf = (r) => (r.consoles || []).find((c) => c.platform === "Sony Playstation") || { files: [] };
  const fileOf = (r, name) => psxOf(r).files.find((f) => f.file === name) || {};
  const kept = new Guard(["messages.json", "setup.json"]);

  try {
    /* ---- the answer itself ---------------------------------------------- */
    let r = await api("api/bios.php");
    check("the check answers: consoles with files, consoles with their own programs, consoles needing nothing",
      [r.ok, Array.isArray(r.consoles), Array.isArray(r.outside), r.fine.length > 0], [true, true, true, true]);

    const psx = (r.consoles || []).find((c) => c.platform === "Sony Playstation");
    check("the PlayStation's files are named with their regions, all missing from an empty folder",
      [!!psx, psx && psx.need, psx && psx.files.map((f) => f.file + " " + f.status).join(", "),
       psx && /USA discs/.test((psx.files.find((f) => f.file === "scph5501.bin") || {}).note || "")],
      [true, "required", "scph5500.bin missing, scph5501.bin missing, scph5502.bin missing", true]);
    check("and they go in the folder the server was told about", psx && psx.dir, sys);

    // Kronos's info file says its BIOS is required: called optional, Saturn games fail to start.
    const saturn = (r.consoles || []).find((c) => c.platform === "Sega Saturn");
    check("the Saturn on Kronos needs its BIOS, under Kronos's own name for it, as its info file says",
      [saturn && saturn.core, saturn && saturn.need, saturn && saturn.files.map((f) => f.file).join(",")],
      ["kronos", "required", "kronos/saturn_bios.bin"]);
    const psp = (r.consoles || []).find((c) => c.platform === "Sony PSP");
    check("PPSSPP's font file is not taken for a BIOS: optional, and said to be free",
      [psp && psp.need, psp && /not a BIOS/.test(psp.why || "")], ["optional", true]);

    check("consoles that need nothing say so once, not file by file",
      ["Super Nintendo Entertainment System", "Nintendo 64"].every((p) => r.fine.includes(p)), true);

    const ps3 = (r.outside || []).find((o) => o.platform === "Sony Playstation 3");
    check("the PlayStation 3 is the one whose BIOS is a legal download, and its line says from where",
      ps3 && /Sony/.test(ps3.note) && /free download/.test(ps3.note), true);

    /* ---- a wrong file is caught, not believed ---------------------------- */
    fs.writeFileSync(path.join(sys, "scph5501.bin"), "not a BIOS, and not even the right size");
    r = await api("api/bios.php");
    check("a file of the wrong size is WRONG without being read", fileOf(r, "scph5501.bin").status, "wrong");

    fs.writeFileSync(path.join(sys, "scph5501.bin"), Buffer.alloc(524288, 7));
    r = await api("api/bios.php");
    check("one of the right size but the wrong content is caught by its checksum", fileOf(r, "scph5501.bin").status, "wrong");

    /* ---- what ONE game lacks, and the words a failed start carries -------
       Asked by console, core and file name. A region's file counts when the
       name says that region; a name that says none is content with any. */
    const lack = async (platform, name, core) => api("api/bios.php?platform=" + encodeURIComponent(platform) +
      "&name=" + encodeURIComponent(name) + (core ? "&core=" + core : ""));
    const names = (a) => (a.lack ? a.lack.files.map((f) => f.file).join(",") : null);
    emptySys();
    let a = await lack("Sony Playstation", "Tomba! (Japan).chd", "mednafen_psx");
    check("a Japan disc on a strict core lacks Japan's file alone, and the words name it and the screen to open",
      [names(a), a.hint], ["scph5500.bin", "Its BIOS file scph5500.bin is missing: Emulators > BIOS check"]);
    a = await lack("Sony Playstation", "Tomba!.chd", "mednafen_psx");
    check("a name that says no region lacks them all, as one of",
      [names(a), a.lack && a.lack.anyOf, a.hint],
      ["scph5500.bin,scph5501.bin,scph5502.bin", true,
       "None of its BIOS files is in place (scph5500.bin, scph5501.bin or scph5502.bin): Emulators > BIOS check"]);
    a = await lack("Sega Genesis", "Sonic (USA).md", "genesis_plus_gx");
    const cd = await lack("Sega CD", "Sonic CD (USA).chd", "genesis_plus_gx");
    check("the Sega CD files count on the Sega CD, not on the Genesis the same core runs",
      [a.lack, names(cd)], [null, "bios_CD_U.bin"]);

    // A "genuine" USA file: the server is told its checksum is the real one.
    const usa = Buffer.from("a stand-in for the USA PlayStation BIOS, known to this test server by its checksum");
    fs.writeFileSync(sumsFile, JSON.stringify({ "scph5501.bin": [crypto.createHash("md5").update(usa).digest("hex"), usa.length] }));
    fs.writeFileSync(path.join(sys, "scph5501.bin"), usa);
    const got = [];
    for (const [name, core] of [["Tomba! (USA).chd", "mednafen_psx"], ["Tomba! (U) [!].bin", "mednafen_psx"], ["Tomba!.chd", "mednafen_psx"],
                                ["Tomba! (Japan).chd", "mednafen_psx"], ["Tomba! (Japan).chd", "swanstation"]]) {
      got.push(names(await lack("Sony Playstation", name, core)));
    }
    check("with the USA file in place: a USA disc, an old (U) name and a name with no region lack nothing, a Japan disc still lacks Japan's, " +
          "and a core that makes do with another region's lacks nothing",
      got, [null, null, null, "scph5500.bin", null]);
    fs.writeFileSync(path.join(sys, "scph5501.bin"), Buffer.alloc(usa.length, 7));
    a = await lack("Sony Playstation", "Tomba! (USA).chd", "mednafen_psx");
    check("a file that is there but not the real one is said as that",
      a.hint, "Its BIOS file scph5501.bin is there but is not the real one: Emulators > BIOS check");

    /* ---- a launch carries the words, and never refuses over them --------- */
    emptySys();
    const lib = await api("api/library.php");
    const first = (p) => (lib.games || []).find((g) => g.platform === p && !g.missing);
    const ps = first("Sony Playstation"), snes = first("Super Nintendo Entertainment System");
    if (ps && snes) {
      const dp = await api("api/launch.php", { id: ps.id, dry: true });
      const ds = await api("api/launch.php", { id: snes.id, dry: true });
      check("a PlayStation game with no BIOS in place still launches, and the launcher is handed the words for a failed start",
        [dp.ok, /BIOS file/.test(dp.failHint || ""), /-FailHint '/.test(dp.command || "")], [true, true, true]);
      check("a game that needs no BIOS carries none", [ds.ok, ds.failHint, /-FailHint/.test(ds.command || "")], [true, null, false]);
    } else {
      check("a launch carries the words (skipped: no PlayStation and SNES game on this copy)", true, true);
    }

    // The launcher itself, with cmd.exe standing in for an emulator that exits with an error.
    {
      const room = fs.mkdtempSync(path.join(os.tmpdir(), "xs-bios-"));
      try {
        fs.mkdirSync(path.join(room, "data"));
        const run = (extra) => new Promise((res) => execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
          path.join(ROOT, "bin", "launch.ps1"), "-Exe", path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"),
          "-Arguments", "/c exit 3", "-Title", "bios probe", "-GameId", "bios-probe", "-Platform", "Probe",
          "-DataDir", path.join(room, "data"), "-PlayedFor", "30"].concat(extra), { windowsHide: true }, () => res()));
        const said = () => JSON.parse(fs.readFileSync(path.join(room, "data", "last-error.json"), "utf8").replace(/^\uFEFF/, "")).error;
        await run(["-FailHint", "Its BIOS file x.bin is missing: Emulators > BIOS check"]);
        const withHint = said();
        await run([]);
        check("a start that fails says the BIOS words after its own, and one with nothing known says only its own",
          [/^exited with code 3 after \d+s\. Its BIOS file x\.bin is missing: Emulators > BIOS check$/.test(withHint),
           /^exited with code 3 after \d+s$/.test(said())], [true, true]);
      } finally {
        fs.rmSync(room, { recursive: true, force: true });
      }
    }

    /* ---- your own files, put in place from a folder ----------------------
       The "genuine" USA file and another PlayStation BIOS (known by content),
       a DS firmware and an arcade set (known by name), and files that are none. */
    fs.mkdirSync(path.join(mine, "dumps"), { recursive: true });
    const other = Buffer.alloc(524288, 1);
    other.write("Sony Computer Entertainment Inc.", 0x108, "latin1");
    other.write("System ROM Version 4.1 12/16/97 A", 0x7ff32, "latin1");
    fs.writeFileSync(path.join(mine, "dumps", "my playstation (usa) dump.bin"), usa);
    fs.writeFileSync(path.join(mine, "dumps", "ps one.rom"), other);
    fs.writeFileSync(path.join(mine, "firmware.bin"), "a DS firmware stand-in");
    fs.writeFileSync(path.join(mine, "neogeo.zip"), "an arcade set stand-in");
    fs.writeFileSync(path.join(mine, "readme.txt"), "not a BIOS");
    fs.writeFileSync(path.join(mine, "gba_bios.bin"), "named like the GBA's BIOS, and not it");
    const before = fs.readdirSync(path.join(mine, "dumps")).length;

    let look = await api("api/bios.php", { action: "look", folder: mine });
    check("a look at the folder knows four of the six, each with where it would go, and writes nothing",
      [look.ok, look.found, look.unknown, look.todo, look.byHand,
       (look.rows || []).map((x) => x.file + " " + x.state).join(", "), fs.readdirSync(sys).length],
      [true, 4, 1, 4, 0, "firmware.bin place, neogeo.zip place, scph1001.bin place, scph5501.bin place", 0]);
    check("a file named like a BIOS that is not the real one is named as that, and is not among the copies",
      [look.notReal, (look.rows || []).some((x) => /gba_bios/.test(x.file))], [["gba_bios.bin"], false]);
    check("a file is known by its checksum whatever it is called, and goes under the name the emulator wants",
      (look.rows || []).filter((x) => x.file === "scph5501.bin").map((x) => [path.basename(x.from), x.to, x.writable])[0],
      ["my playstation (usa) dump.bin", path.join(sys, "scph5501.bin"), true]);

    let put = await api("api/bios.php", { action: "place", folder: mine });
    r = await api("api/bios.php");
    check("putting them in place copies all four, and the check then finds the USA file here and genuine",
      [put.ok, (put.placed || []).join(","), fs.readFileSync(path.join(sys, "scph5501.bin")).equals(usa),
       fs.existsSync(path.join(sys, "scph1001.bin")), fs.existsSync(path.join(sys, "firmware.bin")), fs.existsSync(path.join(sys, "neogeo.zip")),
       fileOf(r, "scph5501.bin").status],
      [true, "firmware.bin,neogeo.zip,scph1001.bin,scph5501.bin", true, true, true, true, "ok"]);
    check("the person's own files are where they were", fs.readdirSync(path.join(mine, "dumps")).length, before);
    put = await api("api/bios.php", { action: "place", folder: mine });
    check("asked again, there is nothing left to copy",
      [put.ok, (put.placed || []).length, put.todo, (put.rows || []).every((x) => x.state === "there")], [true, 0, 0, true]);

    const wrong = Buffer.alloc(usa.length, 9);
    fs.writeFileSync(path.join(sys, "scph5501.bin"), wrong);
    look = await api("api/bios.php", { action: "look", folder: mine });
    put = await api("api/bios.php", { action: "place", folder: mine });
    check("a file in place that is not the real one is replaced by the real one, and kept beside it under a name that says so",
      [(look.rows || []).filter((x) => x.file === "scph5501.bin").map((x) => x.state)[0], (put.placed || []).join(","),
       fs.readFileSync(path.join(sys, "scph5501.bin")).equals(usa), fs.readFileSync(path.join(sys, "scph5501.bin.not-genuine")).equals(wrong)],
      ["replace", "scph5501.bin", true, true]);

    // A folder inside LaunchBox is never written to.
    emptySys();
    fs.writeFileSync(marker, "");
    try {
      look = await api("api/bios.php", { action: "look", folder: mine });
      put = await api("api/bios.php", { action: "place", folder: mine });
      check("a BIOS folder inside LaunchBox is never written to: the copies are named for the person to make",
        [look.todo, look.byHand, (look.rows || []).every((x) => x.writable === false), (put.placed || []).length, fs.readdirSync(sys).length],
        [0, 4, true, 0, 0]);
    } finally {
      fs.rmSync(marker, { force: true });
    }
    const none = await api("api/bios.php", { action: "look", folder: path.join(mine, "nowhere") });
    check("a folder that is not there is refused with words", [none.ok, /there is no folder at/.test(none.error || "")], [false, true]);

    /* ---- on screen ------------------------------------------------------- */
    fs.writeFileSync(path.join(sys, "scph5502.bin"), Buffer.alloc(524288, 7));       // a wrong one, to be called out
    fs.writeFileSync(answer, mine);
    await b.goto();
    await b.ev(`(async () => { const T = await import("/js/bios.js"); T.openBiosCheck(); })()`);
    await b.until(`!!document.querySelector("#editor .rp-verdict")`);
    await b.settled();
    const screen = await b.ev(`(() => {
      const inner = document.querySelector("#editor .panel-inner");
      const first = document.querySelector("#editor .rp-check.bad .rp-label");
      return {
        title: document.querySelector("#editor .panel-title").textContent,
        copyright: /copyrighted, so Xsegon never downloads one/.test(inner.innerText),
        verdict: document.querySelector("#editor .rp-verdict").textContent,
        wrongLine: first ? first.textContent : "",
        folderShown: inner.innerText.indexOf(${JSON.stringify(sys)}) >= 0,
        fine: /No BIOS at all is needed for/.test(inner.innerText),
      };
    })()`);
    check("the screen: its name, the never-downloads words, the wrong file called out, the folder named, the fine list",
      [screen.title, screen.copyright, /not what (it says it is|they say they are)/.test(screen.verdict),
       /scph5502\.bin/.test(screen.wrongLine), screen.folderShown, screen.fine],
      ["BIOS CHECK", true, true, true, true, true]);

    const btn = (re) => `[...document.querySelectorAll("#editor button")].find(x => ${re}.test(x.textContent))`;
    check("it offers to put your own files in place, saying they are known by checksum and that yours stay where they are",
      await b.ev(`(i => [!!${btn("/^Choose folder\\.\\.\\.$/")}, /knows each real one by its checksum/.test(i), /Your files stay where they are, and nothing is downloaded/.test(i)])(document.querySelector("#editor .panel-inner").innerText)`),
      [true, true, true]);
    await b.ev(`${btn("/^Choose folder\\.\\.\\.$/")}.click()`);
    await b.until(`document.querySelectorAll("#editor .bios-found .rp-check").length`, 4, 15000);
    check("choosing a folder lists what was known there as ready, names the one that is not real, counts the rest, and offers the copy by its number",
      await b.ev(`[[...document.querySelectorAll("#editor .bios-found .rp-state")].map(x => x.textContent).join(","),
                   /Not copied: gba_bios\\.bin is named like a BIOS file but is not the real one/.test(document.querySelector("#editor .bios-rest").textContent),
                   /1 other file there is not one an emulator here uses, and was left alone/.test(document.querySelector("#editor .bios-rest").textContent),
                   !!${btn("/^Put 4 files in place$/")}]`),
      ["READY,READY,READY,READY", true, true, true]);
    await b.ev(`${btn("/^Put 4 files in place$/")}.click()`);
    await b.until(`[...document.querySelectorAll("#editor .bios-found .rp-state")].map(x => x.textContent).join(",")`, "HERE,HERE,HERE,HERE", 15000);
    check("pressing it copies them: every line reads as here, the strip says so, the console's own line turns OK and the button is gone",
      await b.ev(`[/4 BIOS files put in place/.test(document.getElementById("strip").textContent),
                   [...document.querySelectorAll("#editor .rp-check.ok .rp-label")].some(x => /^scph5501\\.bin/.test(x.textContent) && !x.closest(".bios-found")),
                   !${btn("/^Put /")}]`),
      [true, true, true]);
    check("and the files are really there", [fs.readFileSync(path.join(sys, "scph5501.bin")).equals(usa), fs.existsSync(path.join(sys, "neogeo.zip"))], [true, true]);
    await b.ev(`import("/js/editors.js").then((m) => m.closeEditor())`);
    fs.rmSync(answer, { force: true });

    /* ---- the automatic Runs check leaves such games out, with a message ---
       Always a dry run on the test copy: nothing is started. */
    const drive = await romDrive();
    if (!drive.up) {
      check("the automatic Runs check and its message (skipped: the ROM drive is away)", true, true);
    } else {
      emptySys();
      await api("api/news.php", { action: "clear" });
      // The list is said only when it changes, and the runcheck group may have said it:
      // forgotten here, put back at the end.
      const setupFile = path.join(DATA, "setup.json");
      const told = fs.existsSync(setupFile) ? JSON.parse(fs.readFileSync(setupFile, "utf8")) : {};
      delete told.biosTold;
      fs.writeFileSync(setupFile, JSON.stringify(told));
      const retro = (plan) => (plan || []).filter((x) => x.mode !== "emu");
      const on = (plan, p) => retro(plan).filter((x) => x.platform === p).length;
      const all = await api("api/runcheck.php", { action: "start", dry: true, skipDone: false });
      let auto = await api("api/runcheck.php", { action: "start", auto: true, skipDone: false });
      const outOf = (res, p) => ((res.bios || []).find((o) => o.platform === p) || { games: 0, files: [] });
      const leftOut = (res) => (res.bios || []).reduce((n, o) => n + o.games, 0);
      check("with no BIOS in place the automatic check leaves the Saturn and PlayStation games out and keeps the rest",
        [auto.ok, auto.dry, outOf(auto, "Sega Saturn").games > 0, outOf(auto, "Sony Playstation").games > 0,
         on(auto.plan, "Sega Saturn") + outOf(auto, "Sega Saturn").games === on(all.plan, "Sega Saturn"),
         retro(auto.plan).length + leftOut(auto) === retro(all.plan).length,
         on(auto.plan, "Super Nintendo Entertainment System") === on(all.plan, "Super Nintendo Entertainment System")],
        [true, true, true, true, true, true, true]);
      check("a check asked for by hand leaves nothing out", [all.ok, (all.bios || []).length], [true, 0]);
      const said = async () => ((await api("api/news.php")).messages || []).filter((m) => m.kind === "bios");
      let mail = await said();
      const top = mail[0] || {};
      check("and one message names the consoles and their files, with the way to the screen that sees to them",
        [mail.length, top.open, /^BIOS files are needed for /.test(top.title || ""),
         (top.items || []).some((l) => /^Sega Saturn: \d+ games?, wanting kronos\/saturn_bios\.bin/.test(l)),
         (top.items || []).some((l) => /^Sony Playstation: /.test(l)), /never downloads one/.test(top.body || "")],
        [1, "bios", true, true, true, true]);
      auto = await api("api/runcheck.php", { action: "start", auto: true, skipDone: false });
      check("asked again with nothing changed, the same thing is not said twice", (await said()).length, 1);

      const outBefore = outOf(auto, "Sony Playstation").games;
      fs.writeFileSync(path.join(sys, "scph5501.bin"), usa);
      auto = await api("api/runcheck.php", { action: "start", auto: true, skipDone: false });
      mail = await said();
      check("with one PlayStation BIOS in place its games are checked, and a new message says what is still wanted",
        [outOf(auto, "Sony Playstation").games < outBefore, on(auto.plan, "Sony Playstation") > 0, mail.length,
         ((mail[0] || {}).items || []).some((l) => /^Sega Saturn: /.test(l))],
        [true, true, 2, true]);

      await b.goto();
      await b.ev(`import("/js/news.js").then((m) => m.openMail())`);
      await b.until(`!!document.querySelector(".mail-row .mail-show")`, true, 8000);
      check("the message has a button that opens the BIOS check",
        await b.ev(`document.querySelector(".mail-row .mail-show").textContent`), "Open the BIOS check");
      await b.ev(`document.querySelector(".mail-row .mail-show").click()`);
      check("and it does", await b.until(`(t => !!t && t.textContent)(document.querySelector("#editor .panel-title"))`, "BIOS CHECK", 8000), "BIOS CHECK");
      await b.ev(`import("/js/editors.js").then((m) => m.closeEditor())`);
    }
  } finally {
    kept.restore();
    emptySys();
    fs.rmSync(marker, { force: true });
    fs.rmSync(sumsFile, { force: true });
    fs.rmSync(answer, { force: true });
    fs.rmSync(mine, { recursive: true, force: true });
  }
};
