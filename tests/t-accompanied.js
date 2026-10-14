/*  Files that go with a game and are not played (includes\accompanied.php,
    api\accompanied.php): an install or bonus disc is suggested from its name
    and told once in the mailbox; said, it leaves the lists for its game's
    tab, and taken back it returns.
    Against a games folder made here (paths.romRoot pointed at it and put
    back); nothing is started. */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { api, DATA, Guard } = require("./lib");

const FIX = path.join(os.tmpdir(), "xs-accompanied-fixture");
const X360 = "Microsoft Xbox 360";
const put = (rel) => {
  const p = path.join(FIX, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "x");
  return p;
};

module.exports = async function (b, check) {
  if (!fs.existsSync(path.join(DATA, "fixtures"))) {
    check("accompanied: runs only on the test server's own copy", true, true);
    return;
  }
  const kept = new Guard(["scanned-games.json", "messages.json", "library-seen.json", "accompanied.json", "accompanied-told.json"]);
  const before = (await api("api/settings.php")).settings.paths;
  fs.rmSync(FIX, { recursive: true, force: true });
  const disc1 = put("systems/xbox360/Xac Alone (USA) (Installation Disc)/Xac Alone (USA) (Disc 1) (Installation Disc).iso");
  const disc2 = put("systems/xbox360/Xac Alone (USA)/Xac Alone (USA) (Disc 2).iso");
  const bonus = put("systems/xbox360/Xac Fight - Limited Edition Bonus Disc (USA).iso");
  const fight = put("systems/xbox360/Xac Fight (USA).iso");
  const plain = put("systems/xbox360/Xac Plain (USA).iso");
  const all = async () => (await api("api/library.php?versions=all")).games || [];
  const byRom = (games, rom) => games.find((g) => g.file === path.basename(rom)) || null;

  try {
    await api("api/settings.php", { paths: { romRoot: FIX, scanFolders: [] } });
    fs.writeFileSync(path.join(DATA, "scanned-games.json"), "[]");
    for (const f of ["accompanied.json", "accompanied-told.json"]) { fs.rmSync(path.join(DATA, f), { force: true }); }

    let r = await api("api/scan.php");
    const mine = r.new.filter((g) => g.platform === X360 && /Xac /.test(g.title));
    r = await api("api/scan.php", { action: "accept", games: mine });
    check("five stand-in Xbox 360 files are taken in", [r.ok, r.added], [true, 5]);
    let games = await all();
    const id = (rom) => (byRom(games, rom) || {}).id;
    const [d1, d2, bo, fi] = [id(disc1), id(disc2), id(bonus), id(fight)];
    const count0 = (await api("api/library.php?versions=all")).platforms?.[X360] ?? null;

    /* ---- suggested, told once, nothing changed ---------------------------- */
    r = await api("api/accompanied.php?settle=1");
    const sug = Object.fromEntries((r.files || []).map((f) => [f.id, f]));
    check("the install disc and the bonus disc are suggested, each with its game; the others are not",
      [Object.keys(sug).sort(), sug[d1]?.kind, sug[d1]?.suggest?.id, sug[bo]?.kind, sug[bo]?.suggest?.id],
      [[d1, bo].sort(), "install", d2, "bonus", fi]);
    fs.writeFileSync(path.join(DATA, "messages.json"), "[]");
    await api("api/news.php?check=1");
    let msgs = (await api("api/news.php")).messages || [];
    const told = msgs.filter((m) => (m.opens || []).includes("accompanied"));
    check("the mailbox names both in one message, with the button to the window", [told.length, told[0]?.n], [1, 2]);
    await api("api/news.php?check=1");
    msgs = (await api("api/news.php")).messages || [];
    check("and only once", msgs.filter((m) => (m.opens || []).includes("accompanied")).length, 1);
    games = await all();
    check("before anything is said, the install disc is a game in its list that plays", [!!byRom(games, disc1), byRom(games, disc1)?.playable], [true, true]);

    /* ---- said: it leaves the lists for its game's tab ---------------------- */
    r = await api("api/accompanied.php", { id: d1, with: "xs-nope-000" });
    check("a game that is not in the library is refused", r.ok, false);
    r = await api("api/accompanied.php", { id: d1, with: d1 });
    check("and so is the file itself", r.ok, false);
    r = await api("api/accompanied.php", { id: d1, with: d2, tab: d1 });
    check("said: the install disc goes with disc 2", [r.ok, r.said?.is, r.said?.with, r.said?.kind], [true, "with", d2, "install"]);
    games = await all();
    const home = byRom(games, disc2) || {};
    check("it leaves the lists, and disc 2 holds it with the multi-disc mark",
      [!!byRom(games, disc1), home.accompanied, home.discs], [false, 1, { set: true, n: 2, acc: 1 }]);
    const count1 = (await api("api/library.php?versions=all")).platforms?.[X360] ?? null;
    if (count0 !== null) { check("the console's count is one fewer", count1, count0 - 1); }
    r = await api("api/accompanied.php?id=" + d2);
    check("disc 2's Accompanied files tab lists it", (r.files || []).map((f) => [f.id, f.words]), [[d1, "Install disc"]]);
    check("no game page and no start for it", [(await api("api/game.php?id=" + d1)).ok, (await api("api/launch.php", { id: d1, dry: true })).ok], [false, false]);
    r = await api("api/scan.php");
    check("the scan knows it and does not offer it back", r.new.filter((g) => g.rom === disc1).length, 0);
    r = await api("api/accompanied.php", { id: d2, with: fi });
    check("a game holding a file cannot itself go with another", r.ok, false);
    r = await api("api/accompanied.php", { id: bo, with: d1 });
    check("nor can a file go with a file in a tab", r.ok, false);
    fs.writeFileSync(path.join(DATA, "messages.json"), "[]");
    await api("api/news.php?check=1");
    msgs = (await api("api/news.php")).messages || [];
    check("its leaving is not news: you did it", msgs.filter((m) => /no longer/i.test((m.title || "") + (m.body || ""))).length, 0);

    /* ---- taken back from disc 2's tab --------------------------------------- */
    r = await api("api/accompanied.php", { id: d1, unsettle: true, tab: d2 });
    check("taken back from disc 2's tab: the answer is disc 2's tab, empty", [r.ok, (r.state?.files || []).length], [true, 0]);
    games = await all();
    check("it is back in its list as a game that plays, and disc 2 has its own mark again",
      [byRom(games, disc1)?.playable, byRom(games, disc2)?.accompanied, byRom(games, disc2)?.discs?.acc], [true, 0, undefined]);
    await api("api/news.php?check=1");
    msgs = (await api("api/news.php")).messages || [];
    check("its coming back is not news either", msgs.filter((m) => /arrived|added/i.test(m.title || "")).length, 0);

    /* ---- a game that is not in the library, and a game of its own ----------- */
    r = await api("api/accompanied.php", { id: bo, with: "" });
    games = await all();
    const left = byRom(games, bonus) || {};
    check("a bonus disc whose game is not here stays in its list, Play greyed, saying why",
      [r.ok, !!byRom(games, bonus), left.playable, left.accompanies?.kind, /not played/.test(left.why || "")], [true, true, false, "bonus", true]);
    check("and is not started", (await api("api/launch.php", { id: bo, dry: true })).ok, false);
    r = await api("api/accompanied.php", { id: d1, not: true });
    check("said to be a game of its own, the install disc is not suggested again",
      [r.ok, ((await api("api/accompanied.php?settle=1")).files || []).map((f) => f.id)], [true, []]);
    void plain;
  } finally {
    await api("api/settings.php", { paths: { romRoot: before.romRoot, scanFolders: before.scanFolders || [] } });
    kept.restore();
    fs.rmSync(FIX, { recursive: true, force: true });
  }
};
