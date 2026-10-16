/* Getting a new person up and going (includes\setup.php).
 *
 * The first rule: none of this may show for someone who already has
 * RetroArch. So the group starts with the copy as it is and proves every
 * offer is hidden and refused by the server.
 *
 * Then, on the run's own copy of data\ only, RetroArch is taken out of the
 * copy's emulator table, and the offers are walked against the stand-in
 * download site tests\sandbox.js builds. Nothing real is downloaded or run.
 * Against --live only the read-only half runs (get.version is "test" only
 * beside the stand-ins).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, sleep, Guard, romDrive } = require("./lib");

const FIX_CORES = ["mesen", "snes9x", "mupen64plus_next", "gambatte", "mgba", "genesis_plus_gx", "pcsx_rearmed"];
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));

async function jobEnds(ms = 30000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    const st = await api("api/setup.php");
    if (st.job && st.job.state !== "running") { return st; }
    await sleep(150);
  }
  return api("api/setup.php");
}

module.exports = async function (b, check) {
  const DATA = require("./lib").DATA;
  const first = await api("api/setup.php");
  check("the setup state answers", first.ok, true);

  /* ---- someone who has RetroArch sees nothing ---- */
  check("RetroArch here is found in the emulator table", [first.retroarch.have, first.retroarch.where], [true, "table"]);
  check("so Get RetroArch is hidden", first.canGet, false);
  check("and so is Use the one you have", first.canUse, false);
  /* Whether the table's RetroArch counts as LaunchBox's is decided as the
     server does (xs_in_launchbox): under the set path, or under any folder
     holding LaunchBox.exe, since the path may be blank. Probe the same way. */
  const cfg0 = readJson(path.join(DATA, "settings.json"));
  const lbRoot0 = String((cfg0.paths || {}).launchbox || "").toLowerCase();
  const tbl0 = readJson(path.join(DATA, "emulators.json"));
  const ra0 = Object.values(tbl0.programs).find((p) => /retroarch/i.test(String(p.exe || "")));
  const lbOwned0 = (() => {
    const exe = ra0 ? String(ra0.exe) : "";
    if (!exe) { return false; }
    if (lbRoot0 !== "" && exe.toLowerCase().startsWith(lbRoot0)) { return true; }
    let d = path.dirname(exe);
    for (let i = 0; i < 12; i++) {
      const up = path.dirname(d);
      if (up === d) { break; }
      d = up;
      if (fs.existsSync(path.join(d, "LaunchBox.exe"))) { return true; }
    }
    return false;
  })();
  check("RetroArch counts as LaunchBox's when it really is, whatever the setting", first.retroarch.launchbox, lbOwned0);
  const again = await api("api/setup.php", { get: "retroarch", dry: true });
  check("and the server refuses a second copy even when asked", [again.ok, /already here/.test(again.error || "")], [false, true]);
  check("no missing cores are offered on a machine that has them all", first.cores.length, 0);

  if (first.get.version !== "test") {
    check("(live server: the download half is left to the test server)", true);
    return;
  }

  const libPath = path.join(DATA, "library.json");
  const tablePath = path.join(DATA, "emulators.json");
  const ownDir = path.join(DATA, "emulators");
  const placeDir = path.join(DATA, "places", "RetroArch");
  const guard = new Guard(["library.json", "emulators.json", "setup-job.json", "setup.json", "settings.json", "scanned-games.json", "pick-folder.json"]);
  const origTable = readJson(tablePath);
  /* A scanned game's launch is built at read time from the table, so
     stripping the table is the whole job. The rewrite below only matters
     for a copy with imported games and stored commands. */
  const origLib = fs.existsSync(libPath) ? readJson(libPath) : null;

  /* RetroArch, taken out of the copy: the library's launch commands point
     nowhere, and the table forgets every program with a retroarch.exe beside
     it, with the consoles only they ran. */
  const hasRa = (exe) => fs.existsSync(path.join(path.dirname(exe || ""), "retroarch.exe"));
  const stripped = JSON.parse(JSON.stringify(origTable));
  for (const [k, p] of Object.entries(stripped.programs)) { if (hasRa(p.exe)) { delete stripped.programs[k]; } }
  for (const [k, e] of Object.entries(stripped.platforms)) {
    e.options = e.options.filter((o) => stripped.programs[o.program]);
    if (!e.options.length) { delete stripped.platforms[k]; }
  }
  const strip = () => fs.writeFileSync(tablePath, JSON.stringify(stripped, null, 2));
  try {
    if (origLib) {
      const lib = JSON.parse(JSON.stringify(origLib));
      for (const g of lib.games) { if (g.launch && g.launch.kind === "retroarch") { g.launch.exe = "C:\\NoSuchFolder\\retroarch_wrapper.bat"; } }
      fs.writeFileSync(libPath, JSON.stringify(lib));
    }
    strip();

    /* ---- one the person installed themselves ---- */
    fs.mkdirSync(placeDir, { recursive: true });
    fs.writeFileSync(path.join(placeDir, "retroarch.exe"), "stand-in\r\n");
    const placed = await api("api/setup.php");
    check("a RetroArch in the usual places is found", [placed.retroarch.have, placed.retroarch.where, placed.retroarch.inTable], [true, "place", false]);
    check("so Get RetroArch stays hidden", placed.canGet, false);
    check("and Use the one you have is offered instead", placed.canUse, true);
    const useDry = await api("api/setup.php", { use: true, dry: true });
    check("a dry use names it and changes nothing", [useDry.ok, useDry.exe, readJson(tablePath).programs.retroarch], [true, path.join(placeDir, "retroarch.exe"), undefined]);
    const used = await api("api/setup.php", { use: true });
    const t1 = readJson(tablePath);
    check("using it writes it into the emulator table", used.ok && t1.programs[used.key] && t1.programs[used.key].exe, path.join(placeDir, "retroarch.exe"));
    check("and the consoles with nothing set up play through it", used.filled.includes("Nintendo 64") && t1.platforms["nintendo 64"].options[0].program, used.key);
    check("a console that has its own emulator keeps it", t1.platforms["nintendo gamecube"].options[0].program, origTable.platforms["nintendo gamecube"].options[0].program);
    check("its settings are left alone: no retroarch.cfg is written beside it", fs.existsSync(path.join(placeDir, "retroarch.cfg")), false);
    const usedTwice = await api("api/setup.php", { use: true });
    check("and it is not used twice", usedTwice.ok, false);
    fs.rmSync(placeDir, { recursive: true, force: true });
    strip();

    /* ---- nobody has RetroArch: the first-run question ---- */
    const none = await api("api/setup.php");
    check("with no RetroArch anywhere, Get RetroArch is offered", [none.retroarch.have, none.canGet, none.canUse], [false, true, false]);
    check("naming the pinned version's download and where it goes", [none.get.url.startsWith("file:///"), none.get.dest], [true, path.join(ownDir, "RetroArch")]);
    check("and what Xsegon sets in its own copy", none.get.sets.map((s) => s.key + "=" + s.value).join(","),
      "network_cmd_enable=true,network_cmd_port=55355,quit_press_twice=false,savestate_thumbnail_enable=true,sort_savestates_enable=false,sort_savestates_by_content_enable=false");
    const dry = await api("api/setup.php", { get: "retroarch", dry: true });
    check("a dry run plans it and starts nothing", [dry.ok, dry.plan.kind, fs.existsSync(path.join(DATA, "setup-job.json"))], [true, "retroarch", false]);

    const askTitle = `(document.querySelector(".setup-confirm h2") || {}).textContent || ""`;
    const askButtons = `[...document.querySelectorAll(".setup-confirm .confirm-bar button")].map(x => x.textContent)`;
    /* ---- the first-run guide opens by itself, once ---- */
    const guideTitle = `(document.querySelector("#editor .panel-title") || {}).textContent || ""`;
    const stepsNow = `[...document.querySelectorAll("#editor .gd-step")].map(s => s.querySelector(".gd-mark").textContent + " " + s.querySelector(".gd-title").textContent + " " + (s.classList.contains("done") ? "done" : "todo"))`;
    await b.goto();
    /* The first start opens the setup window while Set it all up is on offer
       (js\setupwin.js): the folder, a switch a part, one press. The copy has new
       games by themselves off (tests\sandbox.js), and its switch starts as the setting stands. */
    const suNow = `(w => !!w && [w.querySelector(".panel-title").textContent,
      [...w.querySelectorAll(".su-bar button")].map(x => x.textContent + (x.classList.contains("primary") ? "*" : "")).join("|"),
      [...w.querySelectorAll(".opt[data-key]")].filter(r => !r.hidden).map(r => r.dataset.key + (r.querySelector(".tgl").checked ? ":on" : ":off")).join(" ")])(document.querySelector("#editor .su-inner"))`;
    const suFirst = ["SET EVERYTHING UP", "Set it up|Set up by hand", "pictures:on self:off videos:on cheats:on runs:off"];
    check("with no RetroArch, the first start opens the setup window: every part on but the games check, neither press lit",
          await b.until(suNow, suFirst, 10000), suFirst);
    const suNotes = `[...document.querySelectorAll("#editor .su-inner .opt")].filter(r => !r.hidden).map(r => (r.querySelector(".su-note") || {}).textContent || "")`;
    check("saying what each takes: RetroArch's download, the videos and the cheat lists in MB or GB, the games check in time",
          await b.until(`(n => [/^\\d+ MB$/.test(n[1]), /^about [\\d.]+ (MB|GB)$/.test(n[4]), /^\\d+ MB$/.test(n[5]), /^(about [\\d.]+ (minutes?|hours)|under a minute)$/.test(n[6])])(${suNotes})`,
            [true, true, true, true], 8000), [true, true, true, true]);
    check("and the games it found, with a way to another folder",
          await b.until(`(w => !!w && /games? in your library/.test(w.querySelector(".link-row label").textContent) && w.querySelector(".link-row button").textContent)(document.querySelector("#editor .su-inner"))`,
            "Another folder...", 10000), "Another folder...");
    await b.ev(`[...document.querySelectorAll("#editor .su-bar button")].find(x => x.textContent === "Set up by hand").click()`);
    check("Set up by hand opens the getting started guide in its place", await b.until(guideTitle, "GETTING STARTED", 8000), "GETTING STARTED");
    /* The fifth step (Names and pictures) depends on the copy's library, not
       the fixture, so only what the fixture controls is asserted. */
    // "Your games folder" is done only with the ROM drive in; out, it
    // reads todo, and only that step's state steps aside.
    const drive = await romDrive();
    const folderStep = drive.up ? "Your games folder done" : "Your games folder";
    if (!drive.up) { console.log("    (the ROM drive " + (drive.root || "(none set)") + " is not there; the games folder step is not expected to be done)"); }
    check("five steps, RetroArch and its cores waiting", await b.until(
      `${stepsNow}.length === 5 && /^1 RetroArch todo$/.test(${stepsNow}[0]) && /${folderStep}/.test(${stepsNow}[1]) && /Find your games done/.test(${stepsNow}[2]) && /Cores for your consoles todo/.test(${stepsNow}[3]) && /Names and pictures/.test(${stepsNow}[4])`,
      true, 8000), true);
    check("the first thing to do has the keyboard", await b.ev(`document.activeElement && document.activeElement.textContent`), "Get RetroArch...");
    await b.ev(`document.activeElement.click()`);
    check("Get RetroArch asks first", await b.until(askTitle, "Get RetroArch?"), "Get RetroArch?");
    check("with Cancel and Download", await b.ev(askButtons), ["Cancel", "Download RetroArch"]);
    check("saying how big, from where and into which folder", await b.ev(`(() => { const t = document.querySelector(".setup-confirm").textContent; return /MB download/.test(t) && /From: file:/.test(t) && /Into: /.test(t); })()`), true);
    await b.key("Escape");
    check("Esc on the window says no and leaves the guide up", await b.until(`!document.querySelector(".setup-confirm") && !document.getElementById("editor").hidden`), true);
    check("and fetches nothing", fs.existsSync(path.join(DATA, "setup-job.json")), false);
    await b.key("Escape");
    check("Esc again closes the guide", await b.until(`document.getElementById("editor").hidden`), true);
    check("it is remembered as shown", (await api("api/setup.php")).guide.shown, true);
    /* While RetroArch downloads, the guide says not to wait for it. Faked
       with this runner's own process id, so nothing is fetched. */
    const setupJobFile = path.join(DATA, "setup-job.json");
    fs.writeFileSync(setupJobFile, JSON.stringify({ kind: "retroarch", state: "running", step: "download", pid: process.pid,
      started: Math.floor(Date.now() / 1000), version: "test", total: 200 * 1048576, bytes: 0 }));
    await b.setView("grid");
    await b.openBar("help");
    await b.menuItem(/Getting started/);
    check("while RetroArch downloads, step 1 says to go on without waiting",
          await b.until(`(s => !!s && /downloading RetroArch/.test(s.textContent) && /No need to wait for it to finish: go on to the next step\\./.test(s.textContent))(document.querySelector("#editor .gd-step"))`, true, 8000), true);
    check("with a real bar under the words, not a number alone",
          await b.ev(`(s => !!s && !!s.querySelector(".gd-prog .fb-fill"))(document.querySelector("#editor .gd-step"))`), true);
    // Unpacking cannot be measured: the bar is a short piece that travels, never a full one standing still.
    fs.writeFileSync(setupJobFile, JSON.stringify({ kind: "retroarch", state: "running", step: "unpack", pid: process.pid,
      started: Math.floor(Date.now() / 1000), version: "test", total: 200 * 1048576, bytes: 200 * 1048576 }));
    check("while it unpacks the bar is a short piece that travels, not a full bar standing still",
          await b.until(`(s => { const t = s && s.querySelector(".gd-prog.wait"), f = t && t.firstChild; if (!f || !/unpacking/.test(s.textContent)) { return null; }
            const part = f.getBoundingClientRect().width / t.getBoundingClientRect().width;
            return [getComputedStyle(f).animationName, part > 0.2 && part < 0.4]; })(document.querySelector("#editor .gd-step"))`,
            ["xs-prog-wait", true], 8000), ["xs-prog-wait", true]);
    // 7zr says how far it is, into a file of its own: then that is the bar and the words.
    const unpackSays = path.join(DATA, "setup-unpack.txt");
    fs.writeFileSync(unpackSays, "\r  0%\r    \r 62% 9100 - RetroArch-Win64\\info\\some.info\r");
    fs.writeFileSync(setupJobFile, JSON.stringify({ kind: "retroarch", state: "running", step: "unpack", pid: process.pid,
      started: Math.floor(Date.now() / 1000), version: "test", total: 200 * 1048576, bytes: 200 * 1048576, prog: unpackSays }));
    check("and when the unpacker says how far it is, the bar is that and the words say it",
          await b.until(`(s => { const t = s && s.querySelector(".gd-prog"); return t && /unpacking: 62%/.test(s.textContent) ? [t.classList.contains("wait"), t.firstChild.style.width] : null; })(document.querySelector("#editor .gd-step"))`,
            [false, "62%"], 8000), [false, "62%"]);
    fs.rmSync(unpackSays, { force: true });
    fs.writeFileSync(setupJobFile, JSON.stringify({ kind: "retroarch", state: "running", step: "download", pid: process.pid,
      started: Math.floor(Date.now() / 1000), version: "test", total: 200 * 1048576, bytes: 0 }));
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`);
    check("and the corner carries the download once the guide is away",
          await b.until(`(n => !!n && !n.hidden && /downloading RetroArch/.test(n.textContent))(document.querySelector(".setup-bar"))`, true, 8000), true);
    fs.rmSync(setupJobFile, { force: true });
    await b.goto();
    await b.settled(1500);
    check("so the next start stays quiet", await b.ev(`document.getElementById("editor").hidden && !document.querySelector(".setup-confirm")`), true);

    /* ---- a game with no emulator offers RetroArch (roadmap AV11) ----
       Its words name the press and raOffer says which: Set it all up while the
       setup was never used, Get RetroArch after it, none while RetroArch comes. */
    {
      const sjAv = path.join(DATA, "setup.json"), jobAv = path.join(DATA, "setup-job.json");
      const sjAvWas = fs.existsSync(sjAv) ? fs.readFileSync(sjAv) : null;
      const setAuto = (on) => { const j = fs.existsSync(sjAv) ? readJson(sjAv) : {}; if (on) { j.auto = true; } else { delete j.auto; } fs.writeFileSync(sjAv, JSON.stringify(j)); };
      const allRows = async () => (await api("api/library.php?sort=title&grouped=0&versions=all&lot=20000")).games || [];
      const offered = (rows) => rows.filter((g) => !g.playable && g.raOffer);
      try {
        setAuto(false);
        const rows0 = await allRows();
        const skip0 = offered(rows0);
        if (!skip0.length) {
          console.log("    (no scanned game on a console RetroArch plays is in this copy: the ROM drive may be out; the offer rests)");
        } else {
          check("with the setup never used, a game RetroArch plays offers Set it all up, in its words",
                skip0.every((g) => g.raOffer === "setup" && /^no emulator set up for .+ yet: Set it all up gets RetroArch, which plays it$/.test(g.why)), true);
          check("and none on such a console still sends a person to Add an emulator",
                rows0.filter((g) => !g.playable && /Add an emulator gives it one/.test(g.why || "") && skip0.some((x) => x.platform === g.platform)).length, 0);
          // A console whose games all wait on RetroArch: the game the panel shows is one of them.
          const plat = [...new Set(skip0.map((g) => g.platform))].find((p) => rows0.filter((g) => g.platform === p && !g.local).every((g) => g.raOffer === "setup"));
          if (plat) {
            const heroBtn = `(x => x ? [x.textContent, x.disabled] : null)(document.querySelector("#hero .bar button.primary"))`;
            await api("api/settings.php", { view: { heroPanel: true } });
            await b.goto();
            await b.openPlatform(plat);
            const heroSays = await b.until(heroBtn, ["Set it all up...", false], 8000);
            check("the game panel's Play is the press: Set it all up...", heroSays, ["Set it all up...", false]);
            // Enter only on proof the game cannot start: on a playable one it would play.
            if (JSON.stringify(heroSays) === JSON.stringify(["Set it all up...", false])) {
              await b.ev(`document.querySelector("#hero .bar button.primary").click()`);
              check("and it opens the setup window", await b.until(`document.getElementById("editor").dataset.tool === "setup" && !document.getElementById("editor").hidden`, true, 10000), true);
              await b.key("Escape");
              await b.until(`document.getElementById("editor").hidden`);
              await b.key("Enter");
              check("Enter on it opens a small window with the press, in place of a red line",
                    await b.until(`[${askTitle}, ${askButtons}]`, ["No emulator yet", ["Not now", "Set it all up..."]], 8000), ["No emulator yet", ["Not now", "Set it all up..."]]);
              await b.key("Escape");
              await b.until(`!document.querySelector(".setup-confirm")`);
            }
            await api("api/settings.php", { view: { heroPanel: cfg0.view.heroPanel !== false } });
          } else { console.log("    (no console here has all its games waiting on RetroArch; the panel's press rests)"); }
          const emu = await api("api/emuset.php?id=" + encodeURIComponent(skip0[0].id));
          check("Set Emulator offers it too", [emu.raOffer, / yet: Set it all up gets RetroArch/.test(emu.why || "")], ["setup", true]);
          const ctl = await api("api/controls.php?id=" + encodeURIComponent(skip0[0].id));
          check("and so does Controls", [ctl.raOffer, / yet: Set it all up gets RetroArch/.test((ctl.source || {}).note || "")], ["setup", true]);
          // Being set up: faked with this runner's own process id, so nothing is fetched.
          fs.writeFileSync(jobAv, JSON.stringify({ kind: "retroarch", state: "running", step: "unpack", pid: process.pid,
            started: Math.floor(Date.now() / 1000), version: "test", total: 1, bytes: 1 }));
          const coming = offered(await allRows());
          check("while RetroArch is being set up, the same games say it comes, with no press",
                coming.length === skip0.length && coming.every((g) => g.raOffer === "coming" && g.why === "RetroArch is being set up: this game plays once it is in"), true);
          fs.rmSync(jobAv, { force: true });
          setAuto(true);
          const got = offered(await allRows());
          check("with the setup used and RetroArch not here, Get RetroArch",
                got.length === skip0.length && got.every((g) => g.raOffer === "get" && / yet: Get RetroArch sets up RetroArch, which plays it$/.test(g.why)), true);
        }
      } finally {
        if (sjAvWas) { fs.writeFileSync(sjAv, sjAvWas); } else { fs.rmSync(sjAv, { force: true }); }
        fs.rmSync(jobAv, { force: true });
      }
    }

    /* ---- Wheel, Carousel and the consoles screen wait for an emulator (roadmap AV13) ----
       A copy with no emulator on this PC and no game that can start: the copy's
       own games and stored launches are set aside for it, and put back. */
    {
      const ownF = path.join(DATA, "local-games.json");
      const kept = {};
      for (const f of [tablePath, libPath, ownF]) { kept[f] = fs.existsSync(f) ? fs.readFileSync(f) : null; }
      const optsOf = `[...document.getElementById("viewsel").options].filter(o => o.value === "wheel" || o.value === "carousel").map(o => o.textContent + (o.disabled ? ":greyed" : ""))`;
      try {
        fs.writeFileSync(tablePath, JSON.stringify({ programs: {}, platforms: {} }));
        if (origLib) { const l = JSON.parse(JSON.stringify(origLib)); for (const g of l.games) { g.launch = null; } fs.writeFileSync(libPath, JSON.stringify(l)); }
        fs.rmSync(ownF, { force: true });
        check("with no emulator on this PC and no game that starts, the library says they wait", (await api("api/library.php?sort=title&grouped=0")).viewsLocked, true);
        await b.goto();             // it asks for the wheel with Systems first, as every goto does
        check("a copy whose view is Wheel opens on List meanwhile", await b.until(`[document.getElementById("viewsel").value, document.getElementById("syswall").hidden]`, ["list", true], 10000), ["list", true]);
        check("and the dropdown greys Wheel and Carousel, saying why", await b.ev(optsOf), ["Wheel (once RetroArch is in):greyed", "Carousel (once RetroArch is in):greyed"]);
        check("the legend has no way back to the consoles screen", await b.ev(`/back to systems/.test(document.getElementById("help").textContent)`), false);
        await b.ev(`document.activeElement && document.activeElement.blur()`);
        await b.key("Escape");
        check("Esc keeps the list and says why", await b.until(`[document.getElementById("syswall").hidden, /open once RetroArch is in/.test((document.querySelector("#strip") || {}).textContent || "")]`, [true, true], 5000), [true, true]);
        await b.setView("shelf");
        await b.key("g");
        check("G goes past them: Shelf, then Rows", await b.until(`document.getElementById("viewsel").value`, "rows", 5000), "rows");
      } finally {
        for (const f of Object.keys(kept)) { if (kept[f]) { fs.writeFileSync(f, kept[f]); } else { fs.rmSync(f, { force: true }); } }
      }
      check("with an emulator back on this PC they wait no more", (await api("api/library.php?sort=title&grouped=0")).viewsLocked, false);
      await b.goto();
      check("and the dropdown offers them again", await b.ev(optsOf), ["Wheel", "Carousel"]);
    }

    /* ---- the one yes, from the page: the guide's Set it all up opens the window ----
       All off, then the games check alone: one press starts everything, and
       nothing is asked after it. The pictures pass is blocked by a faked
       running one; everything fetched is taken back out, so the road below
       starts from nothing. Videos and the cheat lists stay off: a test fetches neither. */
    const suPress = (key) => b.ev(`document.querySelector('#editor .su-inner .opt[data-key="${key}"]').click()`);
    const suButton = (label) => b.ev(`[...document.querySelectorAll("#editor .su-inner button")].find(x => x.textContent === ${JSON.stringify(label)}).click()`);
    const suKeys = `(w => !!w && [...w.querySelectorAll(".opt[data-key]")].filter(r => !r.hidden).map(r => r.dataset.key + (r.querySelector(".tgl").checked ? ":on" : ":off")).join(" "))(document.querySelector("#editor .su-inner"))`;
    {
      const fillJobF = path.join(DATA, "fill-job.json");
      const fillW = fs.existsSync(fillJobF) ? fs.readFileSync(fillJobF) : null;
      fs.writeFileSync(fillJobF, JSON.stringify({ state: "running", mode: "all", pid: process.pid, started: Math.floor(Date.now() / 1000) }));
      await b.goto();
      await b.setView("grid");
      await b.openBar("help");
      await b.menuItem(/Getting started/);
      await b.until(guideTitle, "GETTING STARTED");
      // until: the steps are drawn when the server answers, which can be after the title is up
      check("the guide opens with the one yes above the steps, saying what it downloads and from where",
            await b.until(`(n => !!n && /set all of this up for you/.test(n.textContent) && /It downloads RetroArch \\S+ \\(\\d+ MB\\) from file:/.test(n.textContent)
              && /BIOS files and games are never downloaded/.test(n.textContent))(document.querySelector("#editor .gd-lead"))`, true, 8000), true);
      const sjPage = path.join(DATA, "setup.json");
      await b.ev(`[...document.querySelectorAll("#editor .gd-lead button")].find(x => /Set it all up/.test(x.textContent)).click()`);
      check("its press opens the setup window in the guide's place", await b.until(suNow, suFirst, 10000), suFirst);
      await suButton("All off");
      check("All off switches every part off", await b.until(suKeys, "pictures:off self:off videos:off cheats:off runs:off", 3000), "pictures:off self:off videos:off cheats:off runs:off");
      await suPress("runs");
      check("and a press on a row switches that one", await b.until(suKeys, "pictures:off self:off videos:off cheats:off runs:on", 3000), "pictures:off self:off videos:off cheats:off runs:on");
      await suButton("Set it up");
      for (const end = Date.now() + 8000; Date.now() < end && !(readJson(sjPage).auto && fs.existsSync(path.join(DATA, "setup-job.json")));) { await sleep(100); }
      const sj1 = readJson(sjPage);
      check("Set it up is the yes: the window goes and everything starts, with what was switched on",
            [await b.ev(`document.getElementById("editor").hidden`), !!sj1.auto, fs.existsSync(path.join(DATA, "setup-job.json")), !!sj1.runsWanted, !!sj1.videosWanted, !!sj1.noPictures, !!sj1.runsAsk],
            [true, true, true, true, false, true, false]);
      const slRows = `[...document.querySelectorAll(".setup-list .sl-row")]`;
      check("and one list in the corner carries the whole plan: a line and a bar for each part",
            await b.until(`(n => !!n && !n.hidden && !!n.closest("#corner-bars") && ${slRows}.map(r => r.dataset.part + (r.querySelector(".fb-track") ? "+bar" : "")).join(" "))(document.querySelector(".setup-list"))`,
              "games+bar retroarch+bar cores+bar fill+bar runs+bar", 8000), "games+bar retroarch+bar cores+bar fill+bar runs+bar");
      check("the separate corner bars stand down while it is up",
            await b.ev(`[...document.querySelectorAll("#corner-bars > .fill-bar")].every(n => getComputedStyle(n).display === "none")`), true);
      check("the Runs check waits last on it, saying how long it will take, with Skip",
            await b.until(`(r => !!r && r.classList.contains("waiting") && /^last: (about [\\d.]+ (minutes?|hours)|under a minute) for \\d+ games?$/.test(r.querySelector(".sl-line").textContent) && !r.querySelector(".sl-btn").hidden)(document.querySelector('.setup-list .sl-row[data-part="runs"]'))`, true, 8000), true);
      await sleep(2500);
      check("nothing is asked after the press", await b.ev(`!document.querySelector(".confirm-wrap")`), true);
      const chainEnd = await jobEnds(120000);
      check("RetroArch arrives and chains the cores, no window, no guide",
            [chainEnd.job.kind, chainEnd.job.state, chainEnd.auto, await b.ev(`document.getElementById("editor").hidden && !document.querySelector(".setup-confirm")`)],
            ["cores", "done", true, true]);
      await api("api/setup.php", { auto: false });
      if (fillW) { fs.writeFileSync(fillJobF, fillW); } else { fs.rmSync(fillJobF, { force: true }); }
      fs.rmSync(path.join(DATA, "setup-job.json"), { force: true });
      fs.rmSync(ownDir, { recursive: true, force: true });
      strip();
      await b.goto();
      await b.settled(1500);
    }

    /* ---- the first start's window: what is switched is what is done ----
       This copy has its games scanned already, so the folder row names them and
       nothing is looked for. Names and pictures switched off goes with the yes,
       no pass starts and its line says so; new games by themselves switched on
       is kept in the settings (and put back off at once: the copy never looks). */
    {
      const sjF = path.join(DATA, "setup.json");
      const fillJobF = path.join(DATA, "fill-job.json");
      const fillW = fs.existsSync(fillJobF) ? fs.readFileSync(fillJobF) : null;
      fs.rmSync(fillJobF, { force: true });
      // The page the last block left opens its own window once the offers answer, marking the guide shown first: that lands before setup.json is written.
      await b.until(`!!document.querySelector("#editor .su-inner")`, true, 5000);
      const sjWas = readJson(sjF);
      delete sjWas.shownGuide;
      delete sjWas.auto;
      fs.writeFileSync(sjF, JSON.stringify(sjWas));
      await b.goto();
      await b.until(suNow, suFirst, 10000);
      await suButton("All off");
      await suPress("self");
      check("the first start's window: All off, then new games by themselves on",
            await b.until(suKeys, "pictures:off self:on videos:off cheats:off runs:off", 3000), "pictures:off self:on videos:off cheats:off runs:off");
      await suButton("Set it up");
      let keptOn = null;
      for (const end = Date.now() + 5000; Date.now() < end && keptOn !== true;) { keptOn = (await api("api/settings.php")).settings.library.addNewGames; if (keptOn !== true) { await sleep(100); } }
      await api("api/settings.php", { library: { addNewGames: false } });
      await b.ev(`window.XSEGON.settings.library = Object.assign({}, window.XSEGON.settings.library, { addNewGames: false })`);
      check("new games by themselves, switched on, is kept in the settings", keptOn, true);
      for (const end = Date.now() + 8000; Date.now() < end && !(readJson(sjF).auto && fs.existsSync(path.join(DATA, "setup-job.json")));) { await sleep(100); }
      check("everything starts, with names and pictures left out as switched", [!!readJson(sjF).auto, fs.existsSync(path.join(DATA, "setup-job.json")), !!readJson(sjF).noPictures], [true, true, true]);
      check("so the Setting up list says they were left out, and no pass starts",
            [await b.until(`(r => !!r && r.querySelector(".sl-line").textContent)(document.querySelector('.setup-list .sl-row[data-part="fill"]'))`, "left out: Pictures & Videos > Get Pictures any time", 8000),
             fs.existsSync(fillJobF)], ["left out: Pictures & Videos > Get Pictures any time", false]);
      await jobEnds(120000);
      check("and still none after RetroArch and its cores came", fs.existsSync(fillJobF), false);
      await api("api/setup.php", { auto: false });
      if (fillW) { fs.writeFileSync(fillJobF, fillW); } else { fs.rmSync(fillJobF, { force: true }); }
      fs.rmSync(path.join(DATA, "setup-job.json"), { force: true });
      fs.rmSync(ownDir, { recursive: true, force: true });
      strip();
      await b.goto();
      await b.settled(1500);
    }

    /* ---- the one yes from nothing: no games first, then games ----
       A new person: no RetroArch, no games, no games folder. The folder
       window answers with the stand-in folder, emptied first: the no-games
       window must come and no pictures pass may start. Then the game goes
       back in, and the core and the pictures pass follow by themselves. The
       page records every paint of the corner bars and the strip, so a part
       that flashed by between two reads is still seen. */
    {
      const scannedF = path.join(DATA, "scanned-games.json");
      const fillJobF = path.join(DATA, "fill-job.json");
      const keep = {};
      // (the mailbox too: a pass written as stopped below would leave it a message)
      for (const f of [scannedF, fillJobF, path.join(DATA, "settings.json"), path.join(DATA, "setup.json"), path.join(DATA, "messages.json"), path.join(DATA, "trouble-said.json")]) { keep[f] = fs.existsSync(f) ? fs.readFileSync(f) : null; }
      const questF = path.join(DATA, "fresh-roms", "snes", "Stand-in Quest (USA).sfc");
      const questAside = path.join(DATA, "stand-in-quest.aside");
      const snesCore = path.join(ownDir, "RetroArch", "cores", "snes9x_libretro.dll");
      let questId = null;
      try {
        fs.writeFileSync(scannedF, "[]");
        fs.rmSync(fillJobF, { force: true });
        fs.renameSync(questF, questAside);
        // no ROM drive set, as on a new copy (one set and away would refuse the Runs check)
        await api("api/settings.php", { paths: { romRoot: "", scanFolders: [] } });
        await b.goto();
        await b.setView("grid");
        await b.ev(`(() => {
          const seen = window.__seen = { setup: [], fill: [], strip: [], editor: false, armed: false, bars: 0, reads: [],
                                         list: { games: [], retroarch: [], cores: [], fill: [], runs: [] } };
          const add = (list, t) => { if (t && list[list.length - 1] !== t) { list.push(t); } };
          // what the page asks the setup API for with the guide away (the corner's watch, the list)
          const realFetch = window.fetch;
          window.fetch = function (u, o) {
            const m = /api\\/(setup\\.php[^#]*)/.exec(String(u));
            if (seen.armed && m && (!o || !o.method || o.method === "GET")) { seen.reads.push(m[1]); }
            // seen.slow: the list's reads arrive that much later, as on a slow PC (what they say is then old news)
            const p = realFetch.call(this, u, o);
            return seen.slow && m && /run=1/.test(m[1]) ? p.then((res) => new Promise((ok) => setTimeout(() => ok(res), seen.slow))) : p;
          };
          const look = () => {
            const s = document.querySelector(".setup-bar"), f = document.querySelector(".fill-bar:not(.setup-bar)");
            if (s && !s.hidden) { add(seen.setup, s.querySelector(".fb-line").textContent); }
            if (f && !f.hidden) { add(seen.fill, f.querySelector(".fb-line").textContent); }
            add(seen.strip, (n => n ? n.textContent : "")(document.querySelector("#strip > span:not(.who):not(.spacer)")));
            const sl = document.querySelector(".setup-list");
            if (sl && !sl.hidden) {
              sl.querySelectorAll(".sl-row").forEach((r) => add(seen.list[r.dataset.part], r.className.replace("sl-row ", "") + ": " + r.querySelector(".sl-line").textContent));
              seen.bars = Math.max(seen.bars, sl.querySelectorAll(".sl-row .fb-track").length);
            }
            if (seen.armed && !document.getElementById("editor").hidden) { seen.editor = true; }
            const asking = !!document.querySelector(".runs-ask");
            if (asking && !seen.asking) { seen.asks = (seen.asks || 0) + 1; }
            seen.asking = asking;
          };
          new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "class", "style"] });
        })()`);
        await b.openBar("help");
        await b.menuItem(/Getting started/);
        await b.until(guideTitle, "GETTING STARTED");
        /* The guide's Set it all up opens the window, with no folder known yet.
           First the folder window closed with nothing chosen (an empty answer
           file is a cancel on the test server): nothing changes and nothing is
           fetched or stored. */
        const pressLead = `[...document.querySelectorAll("#editor .gd-lead button")].find(x => /Set it all up/.test(x.textContent)).click()`;
        const folderRow = `(w => !!w && [w.querySelector(".link-row label").textContent, w.querySelector(".link-row button").textContent])(document.querySelector("#editor .su-inner"))`;
        const pickAnswer = path.join(DATA, "pick-answer.txt");
        await b.ev(pressLead);
        check("from nothing, the window says no folder is chosen yet, with the way to pick one",
              await b.until(folderRow, ["Not chosen yet", "Pick the folder..."], 10000), ["Not chosen yet", "Pick the folder..."]);
        fs.writeFileSync(pickAnswer, "");
        await suButton("Pick the folder...");
        await sleep(1500);
        check("the folder window closed with nothing chosen changes nothing, and nothing is fetched or stored",
              [await b.ev(folderRow), fs.existsSync(path.join(DATA, "setup-job.json")), !!readJson(path.join(DATA, "setup.json")).auto],
              [["Not chosen yet", "Pick the folder..."], false, false]);
        fs.rmSync(pickAnswer, { force: true });
        await suButton("Pick the folder...");
        check("a folder chosen is named in the window, with what it holds",
              await b.until(`(a => !!a && /fresh-roms: no games in it yet$/.test(a[0]))(${folderRow})`, true, 10000), true);
        // The names and pictures and the games check on, videos and the cheat lists off: a test fetches neither.
        await suButton("All off");
        await suPress("pictures");
        await suPress("runs");
        await b.until(suKeys, "pictures:on self:off videos:off cheats:off runs:on", 3000);
        await suButton("Set it up");
        check("from nothing: Set it up is the yes, the window goes and the list shows RetroArch coming",
              [await b.until(`document.getElementById("editor").hidden`, true, 8000),
               await b.until(`window.__seen.list.retroarch.some(t => /downloading|checking RetroArch|unpacking|done: ready/.test(t))`, true, 15000)], [true, true]);
        const seenAsk = await b.ev(`window.__seen`);
        check("the whole plan is up from the press, the games being looked for and every line with a bar",
              [seenAsk.list.games.includes("running: looking for your games..."), seenAsk.bars], [true, 5]);
        const dayLog = ((await api("api/log.php?tail=600")).lines || []);
        const lastOf = (re) => dayLog.map((l, i) => (re.test(l) ? i : -1)).filter((i) => i >= 0).pop();
        check("nothing is fetched before the folder is answered: the folder is added, then RetroArch is asked for",
              lastOf(/ S SCAN\s+folder added /) < lastOf(/ S SETUP\s+get RetroArch /), true);
        await b.ev(`window.__seen.armed = true`);
        const nf = `document.querySelector(".nofound")`;
        check("the folder it is given holds no games: a window says so, while RetroArch carries on",
              await b.until(`(w => !!w && /No games found yet/.test(w.textContent) && /fresh-roms/.test(w.textContent))(${nf})`, true, 15000), true);
        check("and no pictures pass starts with no games to look up", [fs.existsSync(fillJobF), await b.ev(`window.__seen.fill.length`)], [false, 0]);
        check("nor is a Runs check owed yet", !!readJson(path.join(DATA, "setup.json")).runsWanted, false);
        fs.renameSync(questAside, questF);
        const acceptedFrom = Math.floor(Date.now() / 1000);
        await b.ev(`[...document.querySelectorAll(".nofound button")].find(x => x.textContent === "Scan again").click()`);
        check("with the game put in, Scan again takes it straight in",
              await b.until(`window.__seen.strip.some(t => /^added 1 game/.test(t))`, true, 15000), true);
        await sleep(2500);
        check("with a game in, nothing is asked: the games check switched on is owed for it",
              [await b.ev(`!window.__seen.asks && !document.querySelector(".confirm-wrap")`), !!readJson(path.join(DATA, "setup.json")).runsWanted], [true, true]);
        const setupEnd = await jobEnds(120000);
        check("RetroArch's core for it follows by itself", [setupEnd.job.kind, setupEnd.job.state, fs.existsSync(snesCore)], ["cores", "done", true]);
        let fj = null;
        for (const end = Date.now() + 60000; Date.now() < end;) {
          fj = (await api("api/fill.php?job=1")).job;
          if (fj && fj.state !== "running") { break; }
          await sleep(300);
        }
        check("the pictures pass starts only once the game is in, and runs to its end",
              [fj && fj.mode, fj && fj.state, !!fj && fj.started >= acceptedFrom], ["all", "done", true]);
        await b.until(`window.__seen.strip.some(t => /^Get Pictures/.test(t)) && window.__seen.setup.some(t => /cores fetched/.test(t))`, true, 10000);
        const seen = await b.ev(`window.__seen`);
        /* Every core the chain asked for, however many: a game of the person's own on another console brings
           that console's core along. */
        const coresOk = (t) => /^(running: fetching: \d+ of \d+|done: (\d+) of \2 fetched)$/.test(t);
        if (!seen.list.cores.some(coresOk)) {
          // what it said instead, and which cores the job fetched, for whoever reads a red run
          let fetched = "";
          try { fetched = JSON.stringify((JSON.parse(fs.readFileSync(path.join(DATA, "setup-job.json"), "utf8")).cores || []).map((c) => c.core + " (" + (c.platform || c.platforms || "") + ")")); } catch (e) { fetched = "(no job file)"; }
          console.log("    (the cores line said, in turn: " + JSON.stringify(seen.list.cores) + "; the job's cores: " + fetched + ")");
        }
        check("each part had its own line on the list: the game found, RetroArch, the core, the pictures",
              [seen.list.games.includes("done: 1 game found"), seen.list.retroarch.includes("done: ready"),
               seen.list.cores.some(coresOk),
               seen.list.fill.some((t) => /^running: /.test(t)) || seen.list.fill.some((t) => /^done: 1 game, \d+ pictures?/.test(t))],
              [true, true, true, true]);
        check("and the strip said how each ended", [seen.strip.some((t) => /cores fetched/.test(t)), seen.strip.some((t) => /^Get Pictures/.test(t))], [true, true]);
        check("nothing opened over the wall on the way: no guide, no review screen", seen.editor, false);
        const libNow = await api("api/library.php?sort=title&grouped=0");
        const quest = (libNow.games || []).find((g) => /Stand-in Quest/.test(g.title || ""));
        questId = quest ? quest.id : null;
        check("the game is in the library", !!quest, true);
        /* Last, the Runs check, asked for by the page with nobody pressing
           anything. The test server answers every start with a dry run
           (api\runcheck.php, xs_test_copy), so no game is started here. */
        check("then the Runs check is asked for by itself, for the new game",
              await b.until(`window.__seen.strip.some(t => /^the Runs check would start 1 game now/.test(t))`, true, 15000), true);
        const rcLog = ((await api("api/log.php?tail=300")).lines || []).filter((l) => / S RCHK /.test(l)).join("\n");
        check("the server says so in the log, and that nothing was started", /asked for by set it all up: 1 game\(s\), a dry run on this copy: nothing started/.test(rcLog), true);
        check("and it is asked for once: nothing is owed any more", !!readJson(path.join(DATA, "setup.json")).runsWanted, false);
        check("the list had it waiting last with its length, then said how it came out",
              [(await b.ev(`window.__seen.list.runs`)).some((t) => /^waiting: last: under a minute for 1 game$/.test(t)),
               await b.until(`window.__seen.list.runs.some(t => t === "done: a test copy: nothing is started")`, true, 10000)], [true, true]);
        check("and ends saying the games are ready to play",
              await b.until(`(n => !!n && n.classList.contains("over") && n.querySelector(".sl-said").textContent)(document.querySelector(".setup-list"))`, "Ready to play", 10000), "Ready to play");
        check("every line's bar is a bar whether or not anything is in it: as wide as the list, tall enough to see, outlined",
              await b.ev(`[...document.querySelectorAll(".setup-list .sl-row .fb-track")].map(t => Math.round(t.getBoundingClientRect().height) + " " + getComputedStyle(t).borderTopStyle + " " + (t.getBoundingClientRect().width > 300))`),
              Array(5).fill("9 solid true"));
        const wholeLog = ((await api("api/log.php?tail=4000")).lines || []).join("\n");
        check("the day log has how long each step of the RetroArch fetch took",
              /RetroArch took: download \d+s, check \d+s, unpack \d+s/.test(wholeLog), true);
        /* The corner's watch must not read the whole setup state every second
           on a server that answers one request at a time: with no window
           drawing from it, it asks for the job alone. */
        const lightJob = await api("api/setup.php?job=1");
        const reads = await b.ev(`window.__seen.reads`);
        check("the corner watch asked for the job alone, never the whole state, and that answer is nothing but the job",
              [reads.includes("setup.php?job=1"), reads.filter((r) => r === "setup.php").length, lightJob.light, "job" in lightJob, "guide" in lightJob || "cores" in lightJob],
              [true, 0, true, true, false]);

        /* A pictures pass that stopped is tried once more, by itself, and the
           Runs check waits for it. A pass is faked as running so the yes starts
           none of its own, then written as its worker leaves it on a timeout. */
        const sjF = path.join(DATA, "setup.json");
        fs.writeFileSync(fillJobF, JSON.stringify({ state: "running", mode: "all", pid: process.pid, started: Math.floor(Date.now() / 1000) }));
        const again = await api("api/setup.php", { auto: true });
        const stoppedAt = Math.floor(Date.now() / 1000);
        /* While a download is still going (faked the same way) the second go
           waits, and the stop is no ending yet: no red line in the strip and
           nothing kept in Messages for a thing Xsegon is about to put right. */
        const setupJobF = path.join(DATA, "setup-job.json");
        const jobWas = fs.existsSync(setupJobF) ? fs.readFileSync(setupJobF) : null;
        fs.writeFileSync(setupJobF, JSON.stringify({ kind: "retroarch", state: "running", step: "download", pid: process.pid, started: stoppedAt, version: "1.22.2", total: 100, bytes: 0 }));
        fs.writeFileSync(fillJobF, JSON.stringify({ state: "failed", mode: "all", started: stoppedAt, finished: stoppedAt,
          error: "The games could not be looked up: the database reader did not answer within 120 seconds" }));
        const held = [(await api("api/fill.php?job=1")).job.again,
          await b.until(`window.__seen.list.fill.includes("running: stopped once: tried again when the downloads are done")`, true, 10000)];
        /* That line had a measured bar a moment ago. Its travelling piece must
           not keep that width: at 0% there is nothing to see, and at 100% the
           whole bar slides out of its track. */
        check("a line measured a moment ago and now unmeasured shows the short travelling piece, not the width it had",
              await b.ev(`(r => { const t = r.querySelector(".fb-track"), f = t.firstChild; return [t.classList.contains("wait"), f.style.width, Math.round(10 * f.getBoundingClientRect().width / t.getBoundingClientRect().width)]; })(document.querySelector('.setup-list .sl-row[data-part="fill"]'))`),
              [true, "", 3]);
        /* The same list while 7zr unpacks: its percentage is the bar, and a
           percent sign in a file's name is not taken for it. With nothing
           to read (Windows' tar unpacking) the piece travels. */
        const progF = path.join(DATA, "setup-unpack.txt");
        const raRow = `document.querySelector('.setup-list .sl-row[data-part="retroarch"]')`;
        fs.writeFileSync(progF, "  0M Scan\r    \r  0%\r    \r 47% 8200 - RetroArch-Win64\\info\\100% orange.info\r");
        fs.writeFileSync(setupJobF, JSON.stringify({ kind: "retroarch", state: "running", step: "unpack", pid: process.pid, started: stoppedAt, version: "1.22.2", total: 100, bytes: 100, prog: progF }));
        check("while 7zr unpacks, the list's RetroArch bar is the unpacker's own percentage",
              [(await api("api/setup.php?job=1")).job.unpacked,
               await b.until(`(r => { const t = r && r.querySelector(".fb-track"); return t && /^unpacking 47%/.test(r.querySelector(".sl-line").textContent) ? [r.querySelector(".sl-line").textContent, t.classList.contains("wait"), t.firstChild.style.width] : null; })(${raRow})`,
                 ["unpacking 47%: a few minutes on a slower disk", false, "47%"], 8000)],
              [47, ["unpacking 47%: a few minutes on a slower disk", false, "47%"]]);
        fs.rmSync(progF, { force: true });
        check("and with no percentage to read (Windows' tar unpacking), the piece travels",
              [(await api("api/setup.php?job=1")).job.unpacked,
               await b.until(`(r => { const t = r && r.querySelector(".fb-track"); return t && r.querySelector(".sl-line").textContent === "unpacking: a few minutes on a slower disk" ? [t.classList.contains("wait"), t.firstChild.style.width] : null; })(${raRow})`,
                 [true, ""], 8000)],
              [undefined, [true, ""]]);
        fs.writeFileSync(setupJobF, JSON.stringify({ kind: "retroarch", state: "running", step: "download", pid: process.pid, started: stoppedAt, version: "1.22.2", total: 100, bytes: 0 }));
        let pageSaid = false;
        for (const end = Date.now() + 15000; Date.now() < end && !pageSaid;) {
          pageSaid = / P FILL\s+stopped once /.test(((await api("api/log.php?tail=300")).lines || []).join("\n"));
          if (!pageSaid) { await sleep(500); }
        }
        await api("api/news.php?check=1");
        check("a pass that stopped with its second go still to come is said on the list, not as a failure: no red strip, nothing in Messages",
              [held, pageSaid, await b.ev(`window.__seen.strip.some(t => /could not be looked up/.test(t))`),
               (await api("api/news.php")).messages.some((m) => /did not answer within 120 seconds/.test(m.body || ""))],
              [[true, true], true, false, false]);
        if (jobWas === null) { fs.rmSync(setupJobF, { force: true }); } else { fs.writeFileSync(setupJobF, jobWas); }
        const owed = await api("api/running.php");
        let retried = {};
        for (const end = Date.now() + 30000; Date.now() < end;) {
          retried = readJson(sjF).run || {};
          if (retried.fillRetried) { break; }
          await api("api/setup.php?run=1");
          await sleep(300);
        }
        let fj2 = null;
        for (const end = Date.now() + 60000; Date.now() < end;) {
          fj2 = (await api("api/fill.php?job=1")).job;
          if (fj2 && fj2.state !== "running" && fj2.state !== "failed") { break; }
          await sleep(300);
        }
        const logAfter = ((await api("api/log.php?tail=600")).lines || []).join("\n");
        check("a pictures pass that stopped is tried once more by itself, and the Runs check waits for that",
              [again.ok, again.runs, owed.autoRuns, !!retried.fillRetried, fj2 && fj2.state, /is tried once more, now the downloads are done/.test(logAfter)],
              [true, true, "waiting", true, "done", true]);
        const stoppedTwice = Math.floor(Date.now() / 1000);
        fs.writeFileSync(fillJobF, JSON.stringify({ state: "failed", mode: "all", started: stoppedTwice, finished: stoppedTwice, error: "stopped again" }));
        const second = (await api("api/setup.php?run=1")).run || { fill: {} };
        check("once only: stopped a second time it is said on the list, with Try again",
              [second.fill.state, second.fill.again, await b.until(`(r => !!r && r.classList.contains("failed") && !r.querySelector(".sl-btn").hidden && r.querySelector(".sl-btn").textContent)(document.querySelector('.setup-list .sl-row[data-part="fill"]'))`, "Try again", 10000)],
              ["failed", false, "Try again"]);
        check("and that second stop is kept in Messages, as a stopped pass always was",
              (await api("api/news.php")).messages.some((m) => m.body === "stopped again"), true);
      } finally {
        await b.goto();
        await b.settled(1000);
        await api("api/setup.php", { auto: false });
        if (fs.existsSync(questAside)) { fs.renameSync(questAside, questF); }
        for (const [f, v] of Object.entries(keep)) { if (v === null) { fs.rmSync(f, { force: true }); } else { fs.writeFileSync(f, v); } }
        if (questId) {
          const art = path.join(DATA, "art");
          if (fs.existsSync(art)) { for (const n of fs.readdirSync(art)) { if (n.startsWith(questId + "-")) { fs.rmSync(path.join(art, n), { force: true }); } } }
        }
        fs.rmSync(path.join(DATA, "setup-job.json"), { force: true });
        fs.rmSync(ownDir, { recursive: true, force: true });
        strip();
        await b.goto();
        await b.settled(1500);
      }
    }

    /* ---- the Runs check's corner bar ----
       Its status faked with this runner's own process id, so nothing is
       started. The copy's own status file is put back with its old time, so
       it does not read as a check that just ran. */
    {
      const rcF = path.join(DATA, "runcheck", "status.json");
      const rcWas = fs.existsSync(rcF) ? { bytes: fs.readFileSync(rcF), st: fs.statSync(rcF) } : null;
      const rb = `document.querySelector(".runs-bar")`;
      const startedAt = new Date().toISOString();
      try {
        fs.mkdirSync(path.dirname(rcF), { recursive: true });
        fs.writeFileSync(rcF, JSON.stringify({ running: true, pid: process.pid, startedAt, total: 5, index: 2,
          current: { id: "x", title: "Stand-in Runner", platform: "Super Nintendo Entertainment System" },
          counts: { boots: 1, crashed: 0, nostart: 0, noanswer: 0 }, stopped: false, label: "every console" }));
        check("a Runs check at work has its bar in the corner, with the game it is on and Stop",
              await b.until(`(n => !!n && !n.hidden && !!n.closest("#corner-bars") && /^Runs check: game 2 of 5, Stand-in Runner$/.test(n.querySelector(".fb-line").textContent) && !n.querySelector(".fb-stop").hidden)(${rb})`, true, 10000), true);
        fs.writeFileSync(rcF, JSON.stringify({ running: false, pid: process.pid, startedAt, total: 5, index: 5, current: null,
          counts: { boots: 4, crashed: 0, nostart: 1, noanswer: 0 }, stopped: false, endedAt: new Date().toISOString(), label: "every console" }));
        check("its end is said: how many start, and where the rest are",
              await b.until(`/Runs check finished: 4 games start, 1 did not: Emulators > Runs check shows which/.test(document.getElementById("strip").textContent)`, true, 10000), true);
        check("and the bar ends green", await b.ev(`(n => n.classList.contains("ended") && n.querySelector(".fb-line").textContent)(${rb})`), "Runs check: done");
      } finally {
        if (rcWas) { fs.writeFileSync(rcF, rcWas.bytes); fs.utimesSync(rcF, rcWas.st.atime, rcWas.st.mtime); } else { fs.rmSync(rcF, { force: true }); }
      }
    }

    /* ---- Skip on the Setting up list, while the Runs check is at work ----
       The pictures pass and the check are faked with this runner's process
       id, so nothing is fetched or started. Skip must ask the check to stop
       through its stop file, and let go of what the yes owed. */
    {
      const rcDir = path.join(DATA, "runcheck");
      const rcF = path.join(rcDir, "status.json"), stopF = path.join(rcDir, "stop");
      const fillJobF = path.join(DATA, "fill-job.json"), sjF = path.join(DATA, "setup.json");
      const was = {};
      for (const f of [rcF, fillJobF, sjF]) { was[f] = fs.existsSync(f) ? { bytes: fs.readFileSync(f), st: fs.statSync(f) } : null; }
      const runsRow = `document.querySelector('.setup-list .sl-row[data-part="runs"]')`;
      const startedAt = new Date().toISOString();
      try {
        fs.writeFileSync(fillJobF, JSON.stringify({ state: "running", mode: "all", pid: process.pid, started: Math.floor(Date.now() / 1000) }));
        fs.mkdirSync(rcDir, { recursive: true });
        fs.rmSync(stopF, { force: true });
        fs.writeFileSync(rcF, JSON.stringify({ running: true, pid: process.pid, startedAt, total: 5, index: 2,
          current: { id: "x", title: "Stand-in Runner", platform: "Super Nintendo Entertainment System" },
          counts: { boots: 1, crashed: 0, nostart: 0, noanswer: 0 }, stopped: false, label: "every console" }));
        const yes = await api("api/setup.php", { auto: true });
        check("a Runs check at work is a line on the list, with the game it is on and Skip",
              [yes.ok, yes.started, await b.until(`(r => !!r && r.classList.contains("running") && r.querySelector(".sl-line").textContent === "game 2 of 5, Stand-in Runner" && !r.querySelector(".sl-btn").hidden && r.querySelector(".sl-btn").textContent)(${runsRow})`, "Skip", 15000)],
              [true, null, "Skip"]);
        await b.ev(`${runsRow}.querySelector(".sl-btn").click()`);
        let sj = {};
        for (const end = Date.now() + 8000; Date.now() < end && !(fs.existsSync(stopF) && sj.runsSkip);) { sj = readJson(sjF); await sleep(150); }
        check("Skip asks the check to stop after the game on screen, and none is owed after it",
              [fs.existsSync(stopF), !!sj.runsSkip, !!sj.runsWanted], [true, true, false]);
        fs.writeFileSync(rcF, JSON.stringify({ running: false, pid: process.pid, startedAt, total: 5, index: 2, current: null,
          counts: { boots: 2, crashed: 0, nostart: 0, noanswer: 0 }, stopped: true, endedAt: new Date().toISOString(), label: "every console" }));
        check("and the line says where it stopped and how to carry on",
              await b.until(`(r => !!r && r.classList.contains("stopped") && r.querySelector(".sl-btn").hidden && r.querySelector(".sl-line").textContent)(${runsRow})`,
                "stopped at game 2 of 5: Emulators > Runs check carries on from there", 10000),
              "stopped at game 2 of 5: Emulators > Runs check carries on from there");
      } finally {
        fs.rmSync(stopF, { force: true });
        await api("api/setup.php", { auto: false });
        for (const [f, v] of Object.entries(was)) {
          if (v) { fs.writeFileSync(f, v.bytes); fs.utimesSync(f, v.st.atime, v.st.mtime); } else { fs.rmSync(f, { force: true }); }
        }
        await b.goto();
        await b.settled(1000);
      }
    }

    /* ---- the empty screen while Set it all up asks for the folder ----
       A new copy's wall is the No games yet box, whose buttons read as more
       to do. While the folder is asked it says only that. Drawn here by
       hand: this copy's library is never empty. */
    {
      const ng = `document.getElementById("ng-test")`;
      await b.ev(`import("/js/nogames.js").then((m) => { const n = m.noGamesBox(null, () => {}); n.id = "ng-test"; document.body.appendChild(n); m.noGamesAsking(true); })`);
      check("while the folder is asked the empty screen says Setting up, the one thing to do, and shows no buttons",
            await b.until(`(n => !!n && [n.querySelector(".nogames-title").textContent, /^Choose the folder your games are in, in the window that opened\\./.test(n.querySelector(".nogames-where").textContent), getComputedStyle(n.querySelector(".nogames-btns")).display])(${ng})`,
              ["Setting up", true, "none"], 5000), ["Setting up", true, "none"]);
      await b.ev(`import("/js/nogames.js").then((m) => m.noGamesAsking(false))`);
      check("and it is No games yet again, with its buttons, once that is over",
            await b.until(`(n => [n.querySelector(".nogames-title").textContent, getComputedStyle(n.querySelector(".nogames-btns")).display !== "none", [...n.querySelectorAll(".nogames-btns button")].slice(0, 2).map(x => x.textContent).join("|")])(${ng})`,
              ["No games yet", true, "Scan for Games|Getting started"], 5000), ["No games yet", true, "Scan for Games|Getting started"]);
      await b.ev(`${ng}.remove()`);
    }

    /* ---- when the one yes finds no games: a window that says why ----
       Shown with a scan answer made up here, so nothing is scanned; Open the
       Games folder is never pressed (it would open Explorer). */
    {
      const nf = `document.querySelector(".nofound")`;
      const nfButtons = `[...document.querySelectorAll(".nofound .confirm-bar button")].map(x => x.textContent)`;
      await b.ev(`(window.__nf = { rescans: 0, picks: 0 }, import("/js/nofound.js").then((m) => m.noGamesFound(
        { folder: "D:\\\\Downloads\\\\Stuff", own: true, scan: { new: [], unsure: [{ folder: "D:\\\\Downloads\\\\Stuff", n: 12, kinds: "12 .bin" }],
          unknown: [{ folder: "D:\\\\Downloads\\\\Stuff\\\\Misc", items: 3 }], archives: [] } },
        { pick: () => window.__nf.picks++, rescan: () => window.__nf.rescans++ })))`);
      check("a folder with no games says so, and why, from what the scan saw",
            await b.until(`(w => !!w && /No games found yet/.test(w.textContent) && /D:.Downloads.Stuff and found no games/.test(w.textContent)
              && /12 files whose console Xsegon could not tell \\(12 \\.bin\\)/.test(w.textContent) && /"Misc"/.test(w.textContent))(${nf})`, true, 5000), true);
      check("with a press for each way on, choosing another folder first",
            [await b.ev(nfButtons), await b.ev(`document.activeElement && document.activeElement.textContent`)],
            [["Not now", "Open the Games folder", "Scan again", "Choose another folder..."], "Choose another folder..."]);
      await b.ev(`[...document.querySelectorAll(".nofound button")].find(x => x.textContent === "Scan again").click()`);
      check("Scan again closes it and looks again", [await b.ev(`!${nf}`), await b.ev(`window.__nf.rescans`)], [true, 1]);
      await b.ev(`import("/js/nofound.js").then((m) => m.noGamesFound({ folder: "", own: false }, { pick: () => window.__nf.picks++ }))`);
      check("with no folder chosen it offers to choose one, and nothing else to look at",
            await b.until(`(w => !!w && /No games folder yet/.test(w.textContent) && ${nfButtons}.join("|") === "Not now|Choose a folder...")(${nf})`, true, 5000), true);
      await b.key("Escape");
      check("and Esc leaves it for now", [await b.ev(`!${nf}`), await b.ev(`window.__nf.picks`)], [true, 0]);
    }

    /* ---- Settings > Emulators keeps it ---- */
    await b.clickSel("#btn-settings");
    await b.waitFor(`!document.getElementById("settings").hidden`);
    await b.ev(`(() => { const t = [...document.querySelectorAll("#settings .set-tab")].find(x => x.textContent.includes("Emulators")); t.click(); })()`);
    const rowLabels = `[...document.querySelectorAll("#settings .setup-rows .opt label")].map(l => l.firstChild.textContent)`;
    check("Settings > Emulators offers Get RetroArch", await b.until(`${rowLabels}.join("|")`, "Get RetroArch"), "Get RetroArch");
    await b.ev(`document.querySelector("#settings .setup-rows .opt button").click()`);
    check("which asks first", await b.until(askTitle, "Get RetroArch?"), "Get RetroArch?");
    check("with Cancel rather than Not now there", await b.ev(askButtons), ["Cancel", "Download RetroArch"]);
    await b.key("Escape");
    check("Esc says no and starts nothing", await b.until(`!document.querySelector(".setup-confirm")`) && !fs.existsSync(path.join(DATA, "setup-job.json")), true);

    /* ---- the download, end to end on the stand-ins ---- */
    await b.ev(`document.querySelector("#settings .setup-rows .opt button").click()`);
    await b.until(askTitle, "Get RetroArch?");
    await b.ev(`[...document.querySelectorAll(".setup-confirm button")].find(x => x.textContent === "Download RetroArch").click()`);
    const done = await jobEnds();
    check("Download fetches it in the background, and it finishes", [done.job && done.job.kind, done.job && done.job.state, done.job && done.job.error], ["retroarch", "done", undefined]);
    const exe = path.join(ownDir, "RetroArch", "retroarch.exe");
    check("RetroArch is unpacked into Xsegon's own folder", fs.existsSync(exe), true);
    check("with nothing left behind", fs.readdirSync(ownDir).sort(), ["RetroArch"]);
    const sevenHere = fs.existsSync(path.join(require("./lib").ROOT, "bin", "7zr.exe"));
    if (sevenHere) {
      check("by 7-Zip's 7zr, the unpacker that says how far it is, and the file it said it in is gone",
            [done.job && done.job.unpackedWith, fs.existsSync(path.join(DATA, "setup-unpack.txt"))], ["7zr", false]);
    }

    /* ---- the two roads of the unpack ----
       7zr goes first (it says how far it is), Windows' tar is the fallback.
       bin\setup.ps1 runs by itself on its own job files, with a program that
       always fails standing in for one unpacker or the other. 7zr.exe is not
       in git (tools\get-7zr.js fetches it), so without it the first is not checked. */
    {
      const ROOT = require("./lib").ROOT;
      const { execFileSync } = require("child_process");
      const seven = path.join(ROOT, "bin", "7zr.exe");
      const failing = path.join(process.env.SystemRoot || "C:/Windows", "System32", "where.exe");   // fails on an unpacker's arguments
      const fx7 = path.join(DATA, "fixtures", "RetroArch.7z");
      const road = path.join(DATA, "second-road");
      const runJob = (sevenzip, tar) => {
        fs.rmSync(road, { recursive: true, force: true });
        fs.mkdirSync(road, { recursive: true });
        const jobFile = path.join(road, "job.json");
        fs.writeFileSync(jobFile, JSON.stringify(Object.assign({
          kind: "retroarch", state: "running", step: "start", started: Math.floor(Date.now() / 1000),
          url: "file:///" + fx7.split(path.sep).join("/"),
          sha256: require("crypto").createHash("sha256").update(fs.readFileSync(fx7)).digest("hex"),
          part: path.join(road, "RetroArch.download"), stage: path.join(road, "unpacking"), dest: path.join(road, "RetroArch"),
          prog: path.join(road, "unpack.txt"), sevenzip: sevenzip,
        }, tar ? { tar: tar } : {})));
        try {
          execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "bin", "setup.ps1"), "-Job", jobFile],
                       { windowsHide: true, timeout: 60000, stdio: "ignore" });
        } catch (e) { /* a failed job exits 1; the job file says why */ }
        return readJson(jobFile);
      };
      const unpacked = () => fs.existsSync(path.join(road, "RetroArch", "retroarch.exe"));
      if (sevenHere) {
        const j7 = runJob(seven, failing);
        check("7-Zip's 7zr unpacks RetroArch first, and Windows' tar is never asked",
              [j7.state, j7.unpackedWith, j7.detail, unpacked()], ["done", "7zr", undefined, true]);
        check("with its percentage file cleared away with the rest", fs.readdirSync(road).sort(), ["RetroArch", "job.json"]);
      } else { console.log("    (no bin\\7zr.exe here: node tools\\get-7zr.js fetches it; the first road itself is not checked)"); }
      const jt = runJob(failing);
      check("when 7zr cannot unpack it, Windows' tar does, and what 7zr said is kept for the log",
            [jt.state, jt.unpackedWith, /^7zr exit -?\d+, said: /.test(jt.detail || ""), unpacked()], ["done", "tar", true, true]);
      const jn = runJob("");
      check("with no 7zr there, tar unpacks it as it always did",
            [jn.state, jn.unpackedWith, jn.detail, unpacked()], ["done", "tar", "there is no bin\\7zr.exe", true]);
      const j0 = runJob(failing, failing);
      check("with neither able to, the failure says so, with the words of both",
            [j0.state, /would not unpack/.test(j0.error || ""), /^7zr exit -?\d+, said: .*; then tar exit \d+, said: /.test(j0.detail || "")],
            ["failed", true, true]);

      /* The copy a package carries (runtime\RetroArch, tools\get-retroarch.js): nothing is
         downloaded (the address goes nowhere), the same hash check, and the carried file kept. */
      const carriedJob = (sha) => {
        fs.rmSync(road, { recursive: true, force: true });
        fs.mkdirSync(road, { recursive: true });
        const carried = path.join(road, "carried.7z");
        fs.copyFileSync(fx7, carried);
        const jobFile = path.join(road, "job.json");
        fs.writeFileSync(jobFile, JSON.stringify({
          kind: "retroarch", state: "running", step: "start", started: Math.floor(Date.now() / 1000),
          url: "file:///" + path.join(road, "no-such-download.7z").split(path.sep).join("/"), local: carried, sha256: sha,
          part: path.join(road, "RetroArch.download"), stage: path.join(road, "unpacking"), dest: path.join(road, "RetroArch"),
          prog: path.join(road, "unpack.txt"), sevenzip: sevenHere ? seven : "",
        }));
        try {
          execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "bin", "setup.ps1"), "-Job", jobFile],
                       { windowsHide: true, timeout: 60000, stdio: "ignore" });
        } catch (e) { /* a failed job exits 1; the job file says why */ }
        return [readJson(jobFile), fs.existsSync(carried)];
      };
      const [jc, keptC] = carriedJob(require("crypto").createHash("sha256").update(fs.readFileSync(fx7)).digest("hex"));
      check("a RetroArch the package carries is unpacked with nothing downloaded, checked first and kept",
            [jc.state, "tDownload" in jc, "tCheck" in jc, unpacked(), keptC], ["done", false, true, true, true]);
      const [jb, keptB] = carriedJob("0".repeat(64));
      check("and one that is not the tested file is refused in words, and left where it is",
            [jb.state, /came with Xsegon is not the one it was tested with/.test(jb.error || ""), unpacked(), keptB], ["failed", true, false, true]);
      fs.rmSync(road, { recursive: true, force: true });
    }
    const cfg = fs.existsSync(path.join(ownDir, "RetroArch", "retroarch.cfg")) ? fs.readFileSync(path.join(ownDir, "RetroArch", "retroarch.cfg"), "utf8") : "";
    check("its retroarch.cfg is written before it first runs", ['network_cmd_enable = "true"', 'network_cmd_port = "55355"', 'quit_press_twice = "false"'].every((l) => cfg.includes(l)), true);
    const t2 = readJson(tablePath);
    check("it joins the emulator table as Xsegon's own", t2.programs["retroarch-xsegon"] && t2.programs["retroarch-xsegon"].exe, exe);
    check("the consoles with nothing set up play through it", t2.platforms["nintendo 64"].options[0].args, '-L "cores\\mupen64plus_next_libretro.dll" -f');
    check("a console with its own emulator keeps it", t2.platforms["nintendo gamecube"].options[0].program, origTable.platforms["nintendo gamecube"].options[0].program);
    check("the missing cores are offered straight after", await b.until(askTitle, "Get the missing cores?", 8000), "Get the missing cores?");
    check("every one selected", await b.ev(`[...document.querySelectorAll(".setup-confirm .confirm-pick input")].every(x => x.checked) && document.querySelectorAll(".setup-confirm .confirm-pick input").length > 0`), true);
    await b.ev(`[...document.querySelectorAll(".setup-confirm button")].find(x => x.textContent === "Not now").click()`);
    await b.until(`!document.querySelector(".setup-confirm")`);

    const after = await api("api/setup.php");
    check("now RetroArch is here, Xsegon's own", [after.retroarch.have, after.retroarch.own, after.retroarch.inTable], [true, true, true]);
    check("and Get RetroArch is hidden again", after.canGet, false);
    const twice = await api("api/setup.php", { get: "retroarch" });
    check("a second Get is refused", [twice.ok, /already here/.test(twice.error || "")], [false, true]);

    /* ---- cores: only the missing ones ---- */
    check("every console with games is missing its core in a fresh RetroArch", after.cores.length > 3 && after.cores.every((c) => c.may && c.dir === path.join(ownDir, "RetroArch", "cores")), true);
    const have = after.cores.filter((c, i, a) => FIX_CORES.includes(c.core) && a.findIndex((x) => x.core === c.core) === i).slice(0, 2);
    const lost = after.cores.find((c) => !FIX_CORES.includes(c.core));
    const pick = have.map((c) => c.platform).concat(lost ? [lost.platform] : []);
    const cDry = await api("api/setup.php", { cores: pick, dry: true });
    check("a dry run plans just those", cDry.ok && cDry.plan.cores.map((c) => c.platform).sort(), pick.slice().sort());
    const cGo = await api("api/setup.php", { cores: pick });
    check("fetching them starts", cGo.ok, true);
    const cDone = await jobEnds();
    const states = Object.fromEntries((cDone.job.cores || []).map((c) => [c.core, c.state]));
    check("the cores that exist arrive", have.every((c) => states[c.core] === "done" && fs.existsSync(c.file)), true);
    if (lost) { check("one that could not be fetched is said, not hidden", states[lost.core], "failed"); }
    check("the fetched ones are no longer offered", cDone.cores.some((c) => have.some((h) => h.core === c.core)), false);
    const cAgain = await api("api/setup.php", { cores: have.map((c) => c.platform) });
    check("and asking for them again is refused", [cAgain.ok, /none of those/.test(cAgain.error || "") || cAgain.error], [false, true]);

    /* ---- the one yes: set it all up ----
       The chain is server side, so it is driven through the API. The
       pictures pass is only proven skipped while one runs (a real pass over
       the whole library would take minutes). */
    check("set it all up starts off", (await api("api/setup.php")).auto, false);
    const setupJsonFile = path.join(DATA, "setup.json");
    const flag = (on) => { const j = fs.existsSync(setupJsonFile) ? readJson(setupJsonFile) : {}; j.auto = on; fs.writeFileSync(setupJsonFile, JSON.stringify(j)); };
    /* The RetroArch done handler chains the cores when the one yes is
       given: a finished, not yet applied job stands in for a download's
       end, and the job file must become the cores job in the same read. */
    flag(true);
    fs.writeFileSync(path.join(DATA, "setup-job.json"), JSON.stringify({ kind: "retroarch", state: "done", started: Math.floor(Date.now() / 1000), version: "test" }));
    const chained = await api("api/setup.php");
    check("with the one yes, a finished RetroArch job becomes the cores job in place", [chained.job.kind, chained.job.state], ["cores", "running"]);
    const chainDone = await jobEnds(120000);
    check("and every fetchable core arrives without a window", [chainDone.job.kind, chainDone.job.state, chainDone.cores.some((c) => FIX_CORES.includes(c.core))], ["cores", "done", false]);

    /* ---- Play before the cores: said, never spawned into exit code 1 ----
       Dry answers carry the fact (coreMissing) and are not refused, so
       nothing that reads launches breaks; the refusal itself is the e2e
       group's, which may really launch. */
    const stMiss = await api("api/setup.php");
    const missRow = stMiss.cores.find((c) => c.may && c.games > 0);
    const libNow = await api("api/library.php?sort=title&grouped=0");
    const missGame = missRow && (libNow.games || []).find((g) => g.platform === missRow.platform && !g.local);
    if (missGame) {
      const dMiss = await api("api/launch.php", { id: missGame.id, dry: true });
      check("a dry launch says when the core file is missing", [dMiss.ok, dMiss.coreMissing], [true, true]);
    } else { console.log("    (every console with games has its core now; the coreMissing flag rests)"); }
    const okGame = (libNow.games || []).find((g) => g.platform === have[0].platform && !g.local);
    if (okGame) {
      const dOk = await api("api/launch.php", { id: okGame.id, dry: true });
      check("and stays quiet when it is on disk", [dOk.ok, dOk.coreMissing], [true, false]);
    }

    /* ---- the consent POST does what is already possible ---- */
    flag(false);
    check("the flag can be put back by hand", (await api("api/setup.php")).auto, false);
    const fillJobFile = path.join(DATA, "fill-job.json");
    const fillWas = fs.existsSync(fillJobFile) ? fs.readFileSync(fillJobFile) : null;
    // a pictures pass is "running" (this runner's own process id), so the
    // one yes must skip it rather than start a second
    fs.writeFileSync(fillJobFile, JSON.stringify({ state: "running", mode: "all", pid: process.pid, started: Math.floor(Date.now() / 1000) }));
    const yes = await api("api/setup.php", { auto: true });
    /* The run the yes begins, as the Setting up list reads it. Asked while
       the faked pass still stands, so no real one starts here either. */
    const run1 = (await api("api/setup.php?run=1")).run || {};
    check("the yes begins a run the list can read: RetroArch here, the pass at work, the Runs check owed last with its length",
          [yes.runs, (run1.retroarch || {}).state, (run1.fill || {}).state, (run1.runs || {}).state, (run1.runs || {}).secs === run1.games * 25 && run1.games > 0, run1.over],
          [true, "done", "running", "waiting", true, false]);
    check("and the light poll says a run is on, so any page brings the list up", (await api("api/running.php")).setupRun, true);
    const skipped = await api("api/setup.php", { runs: false });
    const sjSkip = readJson(setupJsonFile);
    check("Skip, or Later, lets the owed Runs check go: none is owed, and the list says so",
          [skipped.ok, ((skipped.run || {}).runs || {}).state, !!sjSkip.runsSkip, !!sjSkip.runsWanted, (await api("api/running.php")).autoRuns === undefined],
          [true, "skipped", true, false, true]);
    const wanted = await api("api/setup.php", { runs: true });
    check("answered yes, it is owed again, last", [wanted.ok, ((wanted.run || {}).runs || {}).state, !!readJson(setupJsonFile).runsSkip, !!readJson(setupJsonFile).runsWanted],
          [true, "waiting", false, true]);
    const yesAsk = await api("api/setup.php", { auto: true, runs: "ask" });
    const pending = (await api("api/setup.php?run=1")).run || {};
    check("the yes given with the question still to ask owes none until it is answered",
          [yesAsk.ok, yesAsk.runs, !!readJson(setupJsonFile).runsAsk, (pending.runs || {}).state, (pending.runs || {}).for, pending.over, (await api("api/running.php")).autoRuns === undefined],
          [true, false, true, "waiting", "answer", false, true]);
    const later = await api("api/setup.php", { runs: false });
    check("and Later settles it: asked no more, nothing owed", [((later.run || {}).runs || {}).state, !!readJson(setupJsonFile).runsAsk, !!readJson(setupJsonFile).runsWanted],
          ["skipped", false, false]);
    const yesSkip = await api("api/setup.php", { auto: true, runs: false });
    check("the yes given with the check skipped owes none", [yesSkip.ok, yesSkip.runs, !!readJson(setupJsonFile).runsSkip], [true, false, true]);
    const yesAgain = await api("api/setup.php", { auto: true });
    check("and given again without that, the check is owed as before", [yesAgain.runs, !!readJson(setupJsonFile).runsSkip], [true, false]);
    if (fillWas) { fs.writeFileSync(fillJobFile, fillWas); } else { fs.rmSync(fillJobFile, { force: true }); }
    check("the one yes is stored and starts the missing cores at once", [yes.ok, yes.auto, yes.started],
          [true, true, chainDone.cores.some((c) => c.may) ? "cores" : null]);
    check("but never a second pictures pass over one running", yes.fill, false);
    await jobEnds(120000);

    /* ---- Getting started and the Runs check, one at a time ----
       Each side faked with a live process id (this runner's), so no download
       and no check really starts. The check is asked with a wait it refuses
       anyway: with the guard missing, still nothing would launch. */
    const setupJob = path.join(DATA, "setup-job.json"), rcStatus = path.join(DATA, "runcheck", "status.json");
    const setupWas = fs.readFileSync(setupJob);
    fs.writeFileSync(setupJob, JSON.stringify({ kind: "cores", state: "running", pid: process.pid, started: Math.floor(Date.now() / 1000), cores: [] }));
    const rcUnder = await api("api/runcheck.php", { action: "start", wait: 1 });
    check("the Runs check does not start while Getting started fetches cores, and says why",
          [rcUnder.ok, /Getting started is still downloading/.test(rcUnder.error || "")], [false, true]);
    fs.writeFileSync(setupJob, setupWas);
    const rcWas = fs.existsSync(rcStatus) ? fs.readFileSync(rcStatus) : null;
    fs.mkdirSync(path.dirname(rcStatus), { recursive: true });
    fs.writeFileSync(rcStatus, JSON.stringify({ running: true, pid: process.pid, index: 1, total: 2 }));
    const coresUnder = await api("api/setup.php", { cores: have.map((c) => c.platform) });
    check("and no cores are fetched while the Runs check is going",
          [coresUnder.ok, /Runs check is still going/.test(coresUnder.error || "")], [false, true]);
    if (rcWas) { fs.writeFileSync(rcStatus, rcWas); } else { fs.rmSync(rcStatus, { force: true }); }

    /* ---- the guide's folder and scan steps, from Help ---- */
    await api("api/settings.php", { paths: { romRoot: "C:\\NoRomsHere", scanFolders: [] } });
    await b.goto();
    await b.setView("grid");
    await b.openBar("help");
    await b.menuItem(/Getting started/);
    check("Help > Getting started opens the guide any time", await b.until(guideTitle, "GETTING STARTED"), "GETTING STARTED");
    check("RetroArch checked off now, the games folder not", await b.until(`${stepsNow}.slice(0, 2).join("|")`, "\u2713 RetroArch done|2 Your games folder todo"), "\u2713 RetroArch done|2 Your games folder todo");
    check("so Scan waits for a folder", await b.ev(`[...document.querySelectorAll("#editor .gd-step")][2].querySelector("button").disabled`), true);
    await b.ev(`[...document.querySelectorAll("#editor .gd-step button")].find(x => x.textContent === "Choose a folder...").click()`);
    const roms = path.join(DATA, "fresh-roms");
    check("choosing a folder adds it to where games are looked for", await b.until(`${stepsNow}[1]`, "\u2713 Your games folder done", 8000), "\u2713 Your games folder done");
    check("and the step says which", await b.ev(`[...document.querySelectorAll("#editor .gd-text")][1].textContent`), "Looking in " + roms);
    check("it is kept in the settings Scan for Games reads", (await api("api/settings.php")).settings.paths.scanFolders, [roms]);
    await b.ev(`[...document.querySelectorAll("#editor .gd-step button")].find(x => x.textContent === "Scan for games...").click()`);
    check("Scan for games opens the scan", await b.until(`!!document.querySelector("#editor .sc-folders")`, true, 8000), true);
    check("which finds the game in that folder", await b.until(`document.getElementById("editor").textContent.includes("Stand-in Quest")`, true, 8000), true);
    /* Back closes nothing, so the scan's own library read never runs: the
       guide must read it when it closes, or the page does not know the games
       just found. The page's list is a new one after every read. */
    await b.ev(`import("./js/state.js").then(m => { window.__gamesBefore = m.games; })`);
    await b.ev(`[...document.querySelectorAll("#editor .set-head button")].find(x => /Back/.test(x.textContent)).click()`);
    check("and its Back returns to the guide", await b.until(guideTitle, "GETTING STARTED"), "GETTING STARTED");
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`);
    check("closing the guide after a step reads the library again", await b.until(`import("./js/state.js").then(m => m.games !== window.__gamesBefore)`, true, 8000), true);

    /* ---- the one yes at the scan: accepting games starts the fetches ----
       The scan is when the consoles become known (a scan during the download
       must still fetch their cores), so the accept starts the missing cores
       and the pictures pass while the flag from above is on. */
    const offer2 = await api("api/scan.php");
    const quest = (offer2.new || []).find((g) => /Stand-in Quest/.test(g.title || ""));
    check("the stand-in game is offered to accept", !!quest, true);
    if (quest) {
      const fillJobFile2 = path.join(DATA, "fill-job.json");
      const fillWas2 = fs.existsSync(fillJobFile2) ? fs.readFileSync(fillJobFile2) : null;
      fs.writeFileSync(fillJobFile2, JSON.stringify({ state: "running", mode: "all", pid: process.pid, started: Math.floor(Date.now() / 1000) }));
      // its console's core is taken back out, so the accept has something to fetch
      const snesCore = path.join(ownDir, "RetroArch", "cores", "snes9x_libretro.dll");
      fs.rmSync(snesCore, { force: true });
      const acc = await api("api/scan.php", { action: "accept", games: [quest] });
      if (fillWas2) { fs.writeFileSync(fillJobFile2, fillWas2); } else { fs.rmSync(fillJobFile2, { force: true }); }
      check("accepting it fetches the missing cores by itself", [acc.ok, ((acc.auto || {}).cores || []).includes(quest.platform)], [true, true]);
      check("but never a second pictures pass over one running", (acc.auto || {}).fill, false);
      await jobEnds(120000);
      check("and the core arrives without a window", fs.existsSync(snesCore), true);
    }
    const offR = await api("api/setup.php", { auto: false });
    check("turned off, the scan is back to the buttons", [offR.ok, offR.auto, (await api("api/setup.php")).auto], [true, false, false]);

    /* ---- step 5, Names and pictures: two buttons, and a finished pass
       closes it. How many games are bare is the copy's library, so the
       buttons are checked only while the step has work to do. */
    const step5 = `(s => ({ state: s.classList.contains("done") ? "done" : "todo", buttons: [...s.querySelectorAll("button")].map(x => x.textContent), text: s.querySelector(".gd-text").textContent }))([...document.querySelectorAll("#editor .gd-step")][4])`;
    const guideAgain = async () => { await b.openBar("help"); await b.menuItem(/Getting started/); await b.until(guideTitle, "GETTING STARTED"); await b.until(`document.querySelectorAll("#editor .gd-step").length`, 5, 8000); };
    const g5 = (await api("api/setup.php")).guide;
    await guideAgain();
    if (g5.bare - g5.left > 0) {
      check("step 5 offers Get Pictures and Get Specific Pictures, side by side", (await b.ev(step5)).buttons, ["Get Pictures", "Get Specific Pictures..."]);
    } else { console.log("    (no scanned game is waiting to be looked up here; step 5's two buttons step aside)"); }
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`);
    check("a finished Fill in pass is remembered", (await api("api/setup.php", { asked: "fill" })).ok, true);
    const g5b = (await api("api/setup.php")).guide;
    check("and the games it left bare no longer count as work to do", [g5b.bare, g5b.left], [g5.bare, g5.bare]);
    await guideAgain();
    const s5 = await b.ev(step5);
    check("so step 5 reads done, " + (g5.bare ? "says how many were left, and keeps Get Specific Pictures" : "with nothing left to choose"),
          [s5.state, s5.buttons, g5.bare ? /had no sure match/.test(s5.text) : true], ["done", g5.bare ? ["Get Specific Pictures..."] : [], true]);
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`);

    /* ---- the pictures hint under Pictures & Videos ----
       A note with an arrow at the button, three seconds and gone: only while
       scanned games wait, once a visit, three times in all until a pass has run. */
    const hintUp = `!!document.querySelector(".art-hint")`;
    const sj = path.join(DATA, "setup.json");
    await b.goto();
    await b.setView("grid");
    await sleep(2500);
    check("with a Fill in pass finished, no hint comes under Pictures & Videos", await b.ev(hintUp), false);
    if (g5.bare > 0) {
      const forget = (o) => { const j = readJson(sj); delete j.fillLeft; Object.assign(j, o); fs.writeFileSync(sj, JSON.stringify(j)); };
      forget({ hintShown: 0 });
      await b.goto();
      await b.setView("grid");
      check("with games waiting, the hint comes once the menu bar is up", await b.until(hintUp, true, 8000), true);
      const at = await b.ev(`(() => { const n = document.querySelector(".art-hint"), h = n.getBoundingClientRect(), a = n.querySelector(".art-hint-arrow").getBoundingClientRect(), t = document.querySelector('#mb [data-menu="media"]').getBoundingClientRect(); return { below: h.top >= t.bottom && h.top - t.bottom < 30, arrow: Math.abs((a.left + a.width / 2) - (t.left + t.width / 2)) < 8, text: n.textContent, pointer: getComputedStyle(n).pointerEvents }; })()`);
      check("just under Pictures & Videos, its arrow on the button, saying where the pictures come from",
            [at.below, at.arrow, /^Pictures & Videos > Get Pictures adds box art and names to [0-9]+ games?$/.test(at.text)], [true, true, true]);
      check("it takes no pointer, so it is never in the way of what is under it", at.pointer, "none");
      check("and it goes by itself in about three seconds", await b.until(hintUp, false, 6000), false);
      await b.setView("list");
      await sleep(1500);
      check("not coming back in the same visit", await b.ev(hintUp), false);
      check("the showing was counted", (await api("api/setup.php?guide=1")).guide.hinted, 1);
      forget({ hintShown: 3 });
      await b.goto();
      await b.setView("grid");
      await sleep(2500);
      check("after three showings it stays quiet", await b.ev(hintUp), false);
      await api("api/setup.php", { asked: "fill" });        // as the checks above left it
      check("and a finished Fill in pass starts the count again", (await api("api/setup.php?guide=1")).guide.hinted, 0);
    } else { console.log("    (no scanned game is waiting to be looked up here; the pictures hint has nothing to say and steps aside)"); }

    /* ---- What's new: the changelog, in the app ---- */
    const md = fs.readFileSync(path.join(require("./lib").ROOT, "doc", "CHANGELOG.md"), "utf8");
    const cl = await api("api/changelog.php");
    check("What's new reads the changelog, newest day first", cl.ok && cl.newest, (/^##\s+(\d{4}-\d{2}-\d{2})/m.exec(md) || [])[1]);
    check("every day in it, each with its entries", cl.days.length === (md.match(/^##\s+\d{4}-\d{2}-\d{2}/gm) || []).length && cl.days.every((d) => d.items.length > 0), true);
    check("an entry that runs over several lines is one entry", cl.days.every((d) => d.items.every((t) => !/^\s|\n/.test(t))), true);
    check("a day that is not a date is refused", (await api("api/changelog.php", { seen: "yesterday" })).ok, false);
    const toastUp = `[...document.querySelectorAll("#toasts .toast strong")].map(n => n.textContent).includes("Xsegon has changed")`;
    const setupJson = path.join(DATA, "setup.json");
    const withSeen = (o) => { const j = fs.existsSync(setupJson) ? readJson(setupJson) : {}; delete j.seenChangelog; delete j.toldChangelog; Object.assign(j, o); fs.writeFileSync(setupJson, JSON.stringify(j)); };
    withSeen({});
    await b.goto();
    let seenNow = null;
    for (let i = 0; i < 80 && seenNow !== cl.newest; i++) { seenNow = (await api("api/changelog.php")).seen; if (seenNow !== cl.newest) { await sleep(100); } }
    check("their first start is quietly marked as seen", seenNow, cl.newest);
    check("someone brand new gets no note: everything is new to them", await b.ev(toastUp), false);
    withSeen({ seenChangelog: "2026-09-20" });
    await b.goto();
    check("after an update, a note in the corner says Xsegon has changed", await b.until(toastUp, true, 8000), true);
    check("once: the next start says nothing", (await api("api/changelog.php")).told, cl.newest);
    await b.ev(`[...document.querySelectorAll("#toasts .toast")].find(t => /Xsegon has changed/.test(t.textContent)).querySelector(".toast-line").click()`);
    check("pressing it opens What's new", await b.until(guideTitle, "WHAT'S NEW"), "WHAT'S NEW");
    await b.until(`document.querySelectorAll("#editor .wn-day").length`, Math.min(3, cl.days.length));
    check("with the latest three days, the newer ones marked", await b.ev(`[...document.querySelectorAll("#editor .wn-day")].map(d => d.classList.contains("fresh"))`), cl.days.slice(0, 3).map((d) => d.date > "2026-09-20"));
    check("bold is drawn bold, never shown as stars", await b.ev(`!!document.querySelector("#editor .wn-item strong") && !document.getElementById("editor").textContent.includes("**")`), true);
    await b.ev(`document.querySelector("#editor .wn-older").click()`);
    check("and older days a press away", await b.ev(`document.querySelectorAll("#editor .wn-day").length`), Math.min(8, cl.days.length));
    let seenAfter = null;
    for (let i = 0; i < 80 && seenAfter !== cl.newest; i++) { seenAfter = (await api("api/changelog.php")).seen; if (seenAfter !== cl.newest) { await sleep(100); } }
    check("opening it marks everything seen", seenAfter, cl.newest);
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`);
    await b.goto();
    await b.settled(1500);
    check("so the next start is quiet", await b.ev(toastUp), false);
    await b.setView("grid");
    await b.openBar("help");
    await b.menuItem(/What's new/);
    check("Help > What's new opens it any time", await b.until(guideTitle, "WHAT'S NEW"), "WHAT'S NEW");
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`);

    /* ---- never into LaunchBox's folder ----
       A LaunchBox of the test's own with a RetroArch in it. The real
       RetroArch may or may not be LaunchBox's, so nothing below asks which. */
    const lbDir = path.join(DATA, "fixtures", "lb-setup");
    const lbRa = path.join(lbDir, "Emulators", "RetroArch");
    fs.mkdirSync(path.join(lbRa, "cores"), { recursive: true });
    fs.writeFileSync(path.join(lbDir, "LaunchBox.exe"), "");
    fs.writeFileSync(path.join(lbRa, "retroarch.exe"), "stand-in\r\n");
    const lbTable = JSON.parse(JSON.stringify(origTable));
    const realKey = Object.keys(lbTable.programs).find((k) => hasRa(lbTable.programs[k].exe));
    const lbKey = realKey || "retroarch-standin";
    const missingCore = [{ program: lbKey, emulator: "RetroArch", emulatorId: "x", args: '-L "cores\\zz_missing_libretro.dll" -f', core: "zz_missing", load: "cores\\zz_missing_libretro.dll", default: true }];
    lbTable.programs[lbKey] = Object.assign({ name: "RetroArch", args: "", noQuotes: false }, lbTable.programs[lbKey], { exe: path.join(lbRa, "retroarch.exe") });
    lbTable.platforms["nintendo 64"].options = missingCore;
    fs.writeFileSync(tablePath, JSON.stringify(lbTable, null, 2));
    // With no library.json there is nothing to put back: writing the
    // literal null breaks the next answer.
    if (origLib) { fs.writeFileSync(libPath, JSON.stringify(origLib)); }
    const lbSt = await api("api/setup.php");
    const lbRow = lbSt.cores.find((c) => c.platform === "Nintendo 64");
    check("a core missing from LaunchBox's RetroArch is named", lbRow && lbRow.core, "zz_missing");
    check("but marked as not Xsegon's to fetch", lbRow && lbRow.may, false);
    const lbGo = await api("api/setup.php", { cores: ["Nintendo 64"] });
    check("and the server refuses to write into LaunchBox's folder", [lbGo.ok, /a folder Xsegon never writes to/.test(lbGo.error || "") || lbGo.error], [false, true]);
    check("pointing at RetroArch's own Online Updater", /Online Updater/.test(lbGo.error || ""), true);

    /* ---- and never into a real emulator's folder from a test ----
       The same made-up core, on the real RetroArch, whoever's folder it is
       in: LaunchBox's folder rule alone does not guard one outside it. */
    if (realKey) {
      const realTable = JSON.parse(JSON.stringify(origTable));
      realTable.platforms["nintendo 64"].options = missingCore;
      fs.writeFileSync(tablePath, JSON.stringify(realTable, null, 2));
      const jobFile = path.join(DATA, "setup-job.json");
      const jobOf = () => (fs.existsSync(jobFile) ? fs.readFileSync(jobFile, "utf8") : null);
      const jobWas = jobOf();           // an earlier step's finished job may still be on record
      const realGo = await api("api/setup.php", { cores: ["Nintendo 64"] });
      check("a test never fetches a core into this PC's real RetroArch: refused, and no job started",
        [realGo.ok, /a folder Xsegon never writes to|a test copy never writes into a real emulator's folder/.test(realGo.error || ""), jobOf() === jobWas],
        [false, true, true]);
    }
  } finally {
    fs.rmSync(path.join(DATA, "fixtures", "lb-setup"), { recursive: true, force: true });
    await b.ev(`document.querySelectorAll(".setup-confirm").forEach(n => n.remove())`).catch(() => {});
    if (await b.ev(`!document.getElementById("settings").hidden`).catch(() => false)) { await b.key("Escape"); await b.key("Escape"); }
    guard.restore();
    fs.rmSync(ownDir, { recursive: true, force: true });
    fs.rmSync(placeDir, { recursive: true, force: true });
  }
};
