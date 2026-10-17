/*  Names and pictures from libretro, for a library with no LaunchBox
    (includes\libretro.php, includes\fill-libretro.php).
    Nothing reaches libretro: the test server reads a folder of stand-ins laid
    out like libretro's servers (tests\sandbox.js, XSEGON_LIBRETRO_THUMBS and
    _META), which this group fills. Every file it writes is put back. */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, DATA, ROOT, sleep } = require("./lib");

const SYS = "Nintendo - Nintendo 64";
const NAMES = {
  mario: "Super Mario 64 (USA)",
  zelda: "Legend of Zelda, The - Ocarina of Time (USA)",
  zeldaEu: "Legend of Zelda, The - Ocarina of Time (Europe)",
  kart: "Mario Kart 64 (USA)",
  wave: "Wave Race 64 (USA)",
  fzero: "F-Zero X (USA)",
};
// Which of libretro's folders has a picture for which game.
const HAS = {
  Named_Boxarts: Object.values(NAMES),
  Named_Snaps: [NAMES.mario, NAMES.zelda, NAMES.kart],
  Named_Titles: [NAMES.mario],
  Named_Logos: [NAMES.mario],
};
const META = {
  genre: [["genre", NAMES.mario, "\"Platform\""], ["genre", NAMES.zelda, "\"Action\""]],
  releaseyear: [["releaseyear", NAMES.mario, "\"1996\""], ["releaseyear", NAMES.zelda, "\"1998\""]],
  developer: [["developer", NAMES.mario, "\"Nintendo EAD\""]],
  publisher: [["publisher", NAMES.mario, "\"Nintendo\""]],
  maxusers: [["users", NAMES.mario, "1"], ["users", NAMES.kart, "4"]],
};

function stage(fx) {
  const png = fs.readFileSync(path.join(ROOT, "img", "xsegon-32.png"));
  for (const [folder, names] of Object.entries(HAS)) {
    const dir = path.join(fx, "thumbs", SYS, folder);
    fs.mkdirSync(dir, { recursive: true });
    const links = names.map((n) => '<a href="' + encodeURIComponent(n + ".png").replace(/'/g, "%27") + '">' + n + ".png</a>").join("\n");
    fs.writeFileSync(path.join(dir, "index.html"), "<html><body>\n<a href=\"?C=N;O=D\">Name</a>\n" + links + "\n</body></html>\n");
    for (const n of names) { fs.writeFileSync(path.join(dir, n + ".png"), png); }
  }
  for (const [folder, rows] of Object.entries(META)) {
    fs.mkdirSync(path.join(fx, "meta", folder), { recursive: true });
    const body = ["clrmamepro (", "\tname \"" + SYS + "\"", ")", ""]
      .concat(rows.map(([field, name, v]) => "game (\n\tcomment \"" + name + "\"\n\t" + field + " " + v + "\n\trom ( crc 00000000 )\n)\n"));
    fs.writeFileSync(path.join(fx, "meta", folder, SYS + ".dat"), body.join("\n"));
  }
}

module.exports = async function (b, check) {
  const fx = path.join(DATA, "fixtures", "libretro");
  if (!fs.existsSync(fx)) {
    check("libretro: runs only on the test server's own copy (never against libretro itself)", true, true);
    return;
  }
  stage(fx);
  const keep = {};
  for (const f of ["scanned-games.json", "overrides.json"]) {
    const p = path.join(DATA, f);
    keep[f] = fs.existsSync(p) ? fs.readFileSync(p) : null;
  }
  const before = (await api("api/settings.php")).settings;
  const lbBefore = before.paths.launchbox, fromBefore = (before.library || {}).detailsFrom || "gamesdb";
  const ids = { mario: "xs-scan-lrt-mario", zelda: "xs-scan-lrt-zelda", kart: "xs-scan-lrt-kart", wave: "xs-scan-lrt-wave", home: "xs-scan-lrt-home",
                fzero: "xs-scan-lrt-fzero" };
  const roms = path.join(DATA, "fixtures", "libretro-roms");
  const scanned = [
    { id: ids.mario, title: "Super Mario 64 (USA)", platform: "Nintendo 64", rom: path.join(roms, "Super Mario 64 (USA).z64") },
    { id: ids.zelda, title: "Legend of Zelda The Ocarina of Time USA", platform: "Nintendo 64", rom: path.join(roms, "Legend_of_Zelda_The_-_Ocarina_of_Time_USA.z64") },
    { id: ids.kart, title: "Mario Kart 64", platform: "Nintendo 64", rom: path.join(roms, "Mario Kart 64 [!].z64") },
    { id: ids.wave, title: "Wave Race 64", platform: "Nintendo 64", rom: path.join(roms, "WR64.z64") },
    { id: ids.home, title: "Homebrew Thing", platform: "Nintendo 64", rom: path.join(roms, "Homebrew Thing.z64") },
    { id: ids.fzero, title: "F-Zero X (USA)", platform: "Nintendo 64", rom: path.join(roms, "F-Zero X (USA).z64") },
  ];
  try {
    // No LaunchBox, and libretro chosen: the Games Database ships with Xsegon,
    // so without the choice it would be the one asked (t-gamesdb).
    await api("api/settings.php", { paths: { launchbox: "" }, library: { detailsFrom: "libretro" } });
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), JSON.stringify(scanned));

    /* ---- the matches, and how sure --------------------------------------- */
    const list = await api("api/fill.php?scope=scanned");
    check("libretro: chosen in Settings, Fill in scanned games asks libretro", [list.ok, list.source], [true, "libretro"]);
    const row = (id) => (list.games || []).find((g) => g.id === id) || {};
    const conf = (id) => (row(id).match || {}).confidence;
    const best = (id) => ((row(id).match || {}).best || {});
    check("the file's exact name is sure", [conf(ids.mario), best(ids.mario).id], ["sure", NAMES.mario]);
    check("the same words (underscores, no brackets) are sure, and the USA one of two",
      [conf(ids.zelda), best(ids.zelda).id], ["sure", NAMES.zelda]);
    check("a libretro title the file name starts with is probable", [conf(ids.kart), best(ids.kart).id], ["likely", NAMES.kart]);
    check("the game's own title alone is a guess", [conf(ids.wave), best(ids.wave).id], ["maybe", NAMES.wave]);
    check("and a game on no list has no match", [conf(ids.home), best(ids.home).id], ["none", undefined]);
    check("the name a person reads: The first, a colon for the subtitle, no region",
      best(ids.zelda).title, "The Legend of Zelda: Ocarina of Time");
    check("only sure ones are counted to be selected: a probable one waits for a person", [conf(ids.fzero), list.sure], ["sure", 3]);

    const search = await api("api/fill.php?id=" + ids.home + "&search=zelda ocarina");
    check("Change... searches that console's list, USA first", (search.results || []).map((r) => r.id), [NAMES.zelda, NAMES.zeldaEu]);

    /* ---- filling one ---------------------------------------------------- */
    const overridesBefore = fs.existsSync(path.join(DATA, "overrides.json")) ? fs.readFileSync(path.join(DATA, "overrides.json"), "utf8") : "";
    const dry = await api("api/fill.php", { id: ids.mario, dbId: NAMES.mario, metadata: true, pictures: ["box", "logo", "shot", "fanart"], dry: true });
    check("a dry fill says what it would fetch, and writes nothing",
      [dry.ok, /^would fetch file:/.test((dry.pictures || {}).box || ""),
       (fs.existsSync(path.join(DATA, "overrides.json")) ? fs.readFileSync(path.join(DATA, "overrides.json"), "utf8") : "") === overridesBefore],
      [true, true, true]);
    const fill = await api("api/fill.php", { id: ids.mario, dbId: NAMES.mario, metadata: true, pictures: ["box", "logo", "shot", "fanart"] });
    check("filling takes the proper name and every detail libretro has",
      (fill.filled || []).slice().sort(), ["developer", "genre", "players", "publisher", "released", "title"]);
    check("and all four pictures (the title screen as the background)", fill.pictures,
      { box: "stored", logo: "stored", shot: "stored", fanart: "stored" });
    const lib = await api("api/library.php?q=Super Mario 64");
    const mario = (lib.games || []).find((g) => g.id === ids.mario) || {};
    check("the game now reads so", [mario.title, mario.genre, mario.released, mario.developer, mario.players, mario.hasArt, mario.hasLogo],
      ["Super Mario 64", "Platform", "1996", "Nintendo EAD", 1, true, true]);
    check("the match is remembered", (JSON.parse(fs.readFileSync(path.join(DATA, "overrides.json"), "utf8"))[ids.mario] || {}).lrName, NAMES.mario);
    const again = await api("api/fill.php", { id: ids.mario, dbId: NAMES.mario, metadata: true, pictures: ["box"] });
    check("a second fill fills nothing: only empty fields and empty slots", [again.filled, (again.pictures || {}).box], [[], "already has one"]);

    const zelda = await api("api/fill.php", { id: ids.zelda, dbId: NAMES.zelda, metadata: true, pictures: ["box", "logo"] });
    check("a picture libretro does not have is said as such, not failed", [(zelda.pictures || {}).box, (zelda.pictures || {}).logo], ["stored", "none on record"]);
    check("a name that is not on the list is refused", (await api("api/fill.php", { id: ids.home, dbId: "Something Else (USA)" })).ok, false);

    const guide = (await api("api/setup.php")).guide || {};
    check("Getting started counts a libretro match as looked up", guide.bare, 4);

    /* ---- Fill in all, as a job in the background ---------------------------
       Two filled, one sure, one probable, one a guess, one on no list: the job
       fills the sure one only, since a probable match and a guess are a person's to check. */
    check("Get Pictures starts a pass in the background", (await api("api/fill.php", { job: "start", mode: "all" })).started, true);
    let job = null;
    for (const end = Date.now() + 60000; Date.now() < end;) {
      job = (await api("api/fill.php?job=1")).job;
      if (job && job.state !== "running") { break; }
      await sleep(300);
    }
    check("which looks all six up on libretro, fills the one it is sure of and leaves three for a person",
      [job.state, job.source, job.scanned, job.total, job.done, job.failed, job.left], ["done", "libretro", 6, 1, 1, 0, 3]);
    const rows = (await api("api/fill.php?job=rows")).rows || [];
    const state = (id) => (rows.find((g) => g.id === id) || {}).state;
    const why = (id) => (rows.find((g) => g.id === id) || {}).why;
    check("each game sorted by whose decision it is: filled before, ready, probable and a guess to check, nothing found",
      [state(ids.mario), state(ids.zelda), state(ids.fzero), state(ids.kart), why(ids.kart), state(ids.wave), why(ids.wave), state(ids.home)],
      ["done", "done", "ready", "check", "guess", "check", "guess", "none"]);
    const after = JSON.parse(fs.readFileSync(path.join(DATA, "overrides.json"), "utf8"));
    check("the sure one is filled and remembered, the probable one and the guess are not touched",
      [(after[ids.fzero] || {}).lrName, after[ids.kart] === undefined, after[ids.wave] === undefined], [NAMES.fzero, true, true]);
    check("its pictures stored by the worker, the box among them", [job.pictures >= 1, fs.readdirSync(path.join(DATA, "art")).some((n) => n.startsWith(ids.fzero + "-box."))], [true, true]);

    /* ---- LaunchBox's picture server giving nothing: libretro's thumbnails stand in ----
       The picture server's stand-in is taken away for one pass; libretro knows
       the game by its file's exact name, so its box comes from there instead. */
    const gdbPic = path.join(DATA, "fixtures", "gamesdb-picture.png"), away = gdbPic + ".away";
    await api("api/settings.php", { library: { detailsFrom: "gamesdb" } });
    const gl = await api("api/fill.php?scope=scanned");
    const gBest = ((((gl.games || []).find((g) => g.id === ids.mario) || {}).match || {}).best || {});
    // The Games Database's answer has no source of its own: libretro's says "libretro".
    if (gl.ok && gl.source === undefined && gBest.id && fs.existsSync(gdbPic)) {
      for (const n of fs.readdirSync(path.join(DATA, "art")).filter((n) => n.startsWith(ids.mario + "-"))) { fs.rmSync(path.join(DATA, "art", n), { force: true }); }
      fs.renameSync(gdbPic, away);
      try {
        const st = await api("api/fill.php", { job: "start", mode: "picked", picks: [{ id: ids.mario, dbId: gBest.id }], pictures: true });
        check("with LaunchBox's picture server giving nothing, Get Pictures still starts", st.started, true);
        let fj = null;
        for (const end = Date.now() + 60000; Date.now() < end;) { fj = (await api("api/fill.php?job=1")).job; if (fj && fj.state !== "running") { break; } await sleep(300); }
        check("and the box comes from libretro's thumbnails instead",
          [(fj || {}).state, fs.readdirSync(path.join(DATA, "art")).some((n) => n.startsWith(ids.mario + "-box."))], ["done", true]);
        const logs = path.join(DATA, "log");
        const said = fs.existsSync(logs) && fs.readdirSync(logs).some((n) => /LaunchBox's picture server did not give \d+ pictures that libretro's thumbnails then did/.test(fs.readFileSync(path.join(logs, n), "utf8")));
        check("and the day's log says so", said, true);
      } finally { if (fs.existsSync(away)) { fs.renameSync(away, gdbPic); } }
    } else {
      check("(no sure Games Database match for the stand-in here: the fallback is left to a copy that has one)", true);
    }
  } finally {
    await api("api/settings.php", { paths: { launchbox: lbBefore }, library: { detailsFrom: fromBefore } });
    for (const [f, bytes] of Object.entries(keep)) {
      const p = path.join(DATA, f);
      if (bytes === null) { fs.rmSync(p, { force: true }); } else { fs.writeFileSync(p, bytes); }
    }
    for (const n of fs.readdirSync(path.join(DATA, "art")).filter((n) => n.startsWith("xs-scan-lrt-"))) {
      fs.rmSync(path.join(DATA, "art", n), { force: true });
    }
  }
};
