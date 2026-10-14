// The server, from outside the page: shape of the answers and the guards.
"use strict";
const { api, BASE, DATA } = require("./lib");
const fs = require("fs");
const path = require("path");
const net = require("net");

/** The status code for a request sent exactly as written, no tidying. */
function rawStatus(pathname, host) {
  const u = new URL(BASE);
  const CRLF = String.fromCharCode(13, 10);
  return new Promise((resolve) => {
    let buf = "";
    const done = () => resolve(Number((buf.match(/^HTTP\/1\.[01] (\d{3})/) || [])[1]) || 0);
    const sock = net.connect(Number(u.port) || 80, u.hostname, () => {
      sock.write("GET " + pathname + " HTTP/1.1" + CRLF + "Host: " + (host || u.host) + CRLF + "Connection: close" + CRLF + CRLF);
    });
    sock.on("data", (d) => { buf += d.toString("latin1"); if (buf.includes(CRLF)) { sock.destroy(); done(); } });
    sock.on("error", () => resolve(0));
    sock.on("close", done);
  });
}

module.exports = async function (b, check) {
  const groupBegan = Date.now();
  const st = await api("api/status.php");
  check("status answers", st.ok);
  /* Present means a path is set and the folder is there: the truth to assert
     is agreement with settings, not LaunchBox's presence. */
  const cfgLb = ((await api("api/settings.php")).settings.paths.launchbox || "");
  check("status tells the truth about LaunchBox", !!(st.checks && st.checks.launchbox && st.checks.launchbox.present), cfgLb !== "" && fs.existsSync(cfgLb));
  check("status lists thumbnail caches", st.thumbsBy && typeof st.thumbsBy.box === "boolean");
  /* Build thumbnails works from the games Xsegon shows, not from LaunchBox's
     import (there may be no library.json). dry counts and starts nothing. */
  const th = await api("api/thumbs.php", { kind: "box", dry: true });
  check("Build thumbnails finds the pictures to work from", th.ok === true && th.started === false && th.games > 100);

  /* One game read alone (xs_game, includes\import.php) asks the disk about
     that game only, and must still be the row the whole library has. */
  {
    const out = require("child_process").execFileSync((st.build || {}).phpExe, [path.join(__dirname, "game-probe.php"), "20"],
      { encoding: "utf8", env: Object.assign({}, process.env, { XSEGON_DATA: DATA }), windowsHide: true });
    const one = JSON.parse(out.slice(out.lastIndexOf("{")));
    check("a game read alone is the row the library has, for every twentieth game and each kind",
      [one.asked > 20, one.kinds > 1, one.differ, one.none], [true, true, [], null]);
    const gone = await fetch(BASE + "/api/states.php?id=xs-scan-ffffffffffff");
    check("and an id that is no game is still told so", [gone.status, (await gone.json()).error], [404, "unknown game"]);
  }

  /* The openings every endpoint shares (includes\boot.php): POST only, the
     id's shape, and a save that fails says why. Quit is not asked: a GET it
     took would end this run's server. */
  {
    const said = async (r) => r.status + " " + ((await r.json().catch(() => ({}))).error || "");
    const post = (e, body) => fetch(BASE + "/api/" + e + ".php", { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify(body) });
    const wrong = [];
    for (const e of ["edit", "emuopen", "favourite", "import", "launch", "my-rating", "open-game", "open", "retroarch", "reveal", "select-version", "session", "thumbs", "window"]) {
      const got = await said(await fetch(BASE + "/api/" + e + ".php"));
      if (got !== "405 POST only") { wrong.push(e + ": " + got); }
    }
    check("every endpoint that takes a POST only refuses a GET, and says so", wrong, []);
    const loose = [];
    for (const e of ["art", "game", "gamesdb", "states", "video-own", "notes", "saves"]) {
      for (const q of ["", "?id=..%2Fx", "?id=" + "a".repeat(65)]) {
        const got = await said(await fetch(BASE + "/api/" + e + ".php" + q));
        if (got !== "400 bad id") { loose.push("GET " + e + q.slice(0, 12) + ": " + got); }
      }
    }
    for (const e of ["cheats", "cores", "edit", "emuopen", "emuset", "hide", "tags", "favourite", "my-rating", "select-version", "session", "notes", "saves"]) {
      for (const id of [undefined, "../x", "a".repeat(65)]) {
        const got = await said(await post(e, { id, fav: true, stars: 3, seconds: 5, hide: true, add: "x", text: "x" }));
        if (got !== "400 bad id") { loose.push("POST " + e + " " + String(id).slice(0, 8) + ": " + got); }
      }
    }
    check("an id that is missing, misshapen or too long is refused by every endpoint that takes one", loose, []);
    // a folder where the save's working copy goes: the write fails, the note file is untouched
    const inTheWay = path.join(DATA, "notes.json.tmp");
    fs.mkdirSync(inTheWay);
    try {
      const got = await said(await post("notes", { id: "xs-scan-ffffffffffff", text: "" }));
      check("a save that cannot reach the disk answers 500 with the endpoint's words and the reason",
        [got.slice(0, 4), /^500 the note could not be kept: Could not save notes\.json\. .*notes\.json is untouched/.test(got)], ["500 ", true]);
    } finally {
      fs.rmSync(inTheWay, { recursive: true, force: true });
    }
  }

  /* Open RetroArch with no game: the exe the library's launches use. dry
     answers with the path and starts nothing. The data folder the same way, through reveal. */
  const ra = await api("api/retroarch.php", { dry: true });
  check("Open RetroArch knows the exe", ra.ok === true && /retroarch\.exe$/i.test(ra.exe || ""));
  check("and is POST only", (await api("api/retroarch.php")).ok, false);
  const df = await api("api/reveal.php", { what: "data", dry: true });
  // the server's own data folder: the run's copy (tests\sandbox.js), or data\ itself
  check("the data folder can be opened, and is Xsegon's own", df.ok === true && require("path").resolve(df.folder || "") === require("path").resolve(require("./lib").DATA));
  check("the status says nothing of a wiki: that is the maker's own part, in private\\", st.wiki, undefined);
  // The Games Database pass answers for either scope on any library.
  check("the pass answers for scanned games", Array.isArray((await api("api/fill.php?scope=scanned")).games));
  check("and for imported games LaunchBox never matched", Array.isArray((await api("api/fill.php?scope=unmatched")).games));

  const lib = await api("api/library.php");
  check("library answers", lib.ok);
  check("library has games", lib.games.length > 100);

  /* A game that does not run in RetroArch names its emulator in its row, and its menu's Open <emulator>
     (api\emuopen.php) opens that one with no game, never RetroArch. One game of each kind is taken from the library. */
  check("every row names the emulator of its own that the game runs in, or none, and never RetroArch",
    lib.games.filter((g) => !(g.emu === null || (typeof g.emu === "string" && g.emu !== "" && !/retroarch/i.test(g.emu)))).map((g) => g.title + ": " + g.emu), []);
  const emuGame = lib.games.find((g) => g.emu && g.playable);
  const raGame = lib.games.find((g) => !g.emu && g.playable && !g.local);
  if (emuGame) {
    const eo = await api("api/emuopen.php", { id: emuGame.id, dry: true });
    check("opening a game's own emulator names it as the row does, finds its program and its folder, and starts nothing here",
      [eo.ok, eo.dry, eo.name, /\.exe$/i.test(eo.exe || ""), path.resolve(eo.dir || "") === path.dirname(path.resolve(eo.exe || "x"))], [true, true, emuGame.emu, true, true]);
  } else {
    check("no game here runs in an emulator of its own, so there is none to open", true);
  }
  if (raGame) {
    const no = await api("api/emuopen.php", { id: raGame.id });
    check("a game with no emulator of its own to open is refused, in words", [no.ok, /Open RetroArch|started by a script/.test(no.error || "")], [false, true]);
  }

  /* Controls, read only: the answer's shape, and sixteen RetroPad rows when the
     RetroArch cfg is readable. The exact keys are the machine's own and are not pinned. */
  const ctl = await api("api/controls.php?platform=Super%20Nintendo%20Entertainment%20System");
  check("controls answer for a console", ctl.ok === true && Array.isArray(ctl.rows) && typeof ctl.via, "string");
  check("a readable RetroArch cfg gives all sixteen RetroPad rows, or says why not",
        ctl.source && ctl.source.read ? ctl.rows.length : ctl.source.note.length > 0, ctl.source && ctl.source.read ? 16 : ctl.source.note.length);
  const ctlBad = await fetch(BASE + "/api/controls.php?id=xs-scan-nope");
  check("controls for an unknown game refuse", ctlBad.status, 404);
  check("library has platforms", Object.keys(lib.platforms).length >= 10);
  check("library sends collections", Array.isArray(lib.collections) && lib.collections.some((c) => c.key === "@favourites"));
  check("every row says whether the scanner found it", lib.games.every((g) => typeof g.scanned === "boolean"));
  /* Console pictures are kept by the browser under a version: with v= they keep
     for a year, misses included; without it they are checked every time. */
  check("the library sends the console pictures' version", Number.isInteger(lib.platformArtRev) && lib.platformArtRev > 0);
  const pic = await fetch(BASE + "/api/image.php?platform=Nintendo%2064&kind=clearlogo&v=" + lib.platformArtRev);
  check("a console picture with a version is kept for a year", pic.status === 200 && /max-age=31536000/.test(pic.headers.get("cache-control") || ""));
  const miss = await fetch(BASE + "/api/image.php?platform=%40nothing-here&kind=device&v=" + lib.platformArtRev);
  check("and so is a miss, so it is not asked about on every visit", miss.status === 404 && /max-age=31536000/.test(miss.headers.get("cache-control") || ""));
  const bare = await fetch(BASE + "/api/image.php?platform=Nintendo%2064&kind=clearlogo");
  check("without a version it is still checked every time", /max-age=0/.test(bare.headers.get("cache-control") || ""));

  /* Recently added: a scratch game of your own is stamped with today
     (local-games.json is put back by the runner). Collections must stay an
     array: an empty one filtered out leaves holes, and the list goes out as an object. */
  // What was recent before the scratch game: the empty case below can only be
  // checked when there was nothing.
  const addedBefore = ((await api("api/library.php")).collections || []).find((c) => c.key === "@added");
  const recentBefore = addedBefore ? addedBefore.count : 0;
  const scratch = await api("api/local.php", { set: { title: "Xsegon Added Scratch", url: BASE + "/" } }, "POST");
  check("a new game of your own is stamped with today", scratch.ok && scratch.game && typeof scratch.game.id === "string");
  const withAdded = await api("api/library.php");
  check("collections stay an array around an empty one", Array.isArray(withAdded.collections));
  const addedCol = withAdded.collections.find((c) => c.key === "@added");
  check("Recently added counts what is recent", !!addedCol && addedCol.count >= 1 && !addedCol.note);
  const inside = await api("api/library.php?platform=%40added");
  check("and holds the newcomer, newest first", inside.ok && inside.games.length >= 1 && inside.games.some((g) => g.title === "Xsegon Added Scratch"));
  check("rows carry the day they arrived", inside.games.every((g) => !g.addedAt || /^\d{4}-\d{2}-\d{2}$/.test(g.addedAt)));
  /* How far back it looks is a choice (view.addedPeriod, ?added= for one
     read): a library scanned in one day makes the last 30 days every game. */
  const stretch = {};
  const STRETCHES = ["today", "threedays", "week", "twoweeks", "month", "year"];
  for (const k of STRETCHES.concat("nonsense")) {
    const got = await api("api/library.php?added=" + k);
    stretch[k] = { n: (got.collections.find((c) => c.key === "@added") || {}).count, since: got.addedSince };
  }
  check("today holds what arrived today", stretch.today.n >= 1 && stretch.today.since === new Date().toLocaleDateString("sv"));
  check("a shorter stretch never holds more", STRETCHES.every((k, i, all) => i === 0 || stretch[all[i - 1]].n <= stretch[k].n));
  check("and never starts earlier", STRETCHES.every((k, i, all) => i === 0 || stretch[all[i - 1]].since > stretch[k].since));
  const ago = new Date(); ago.setDate(ago.getDate() - 3);
  check("the past 3 days starts three days back", stretch.threedays.since, ago.toLocaleDateString("sv"));
  check("and the settings offer every stretch the server counts", Object.keys((await api("api/settings.php")).schema.view.addedPeriod.options), STRETCHES);
  check("a word that is no choice reads as the month", stretch.nonsense.since, stretch.month.since);
  check("with no word it is the saved choice", withAdded.addedSince, stretch.month.since);
  const kept = await api("api/settings.php", { view: { addedPeriod: "week" } });
  check("the choice is kept", kept.ok !== false && (await api("api/library.php")).addedSince === stretch.week.since);
  await api("api/settings.php", { view: { addedPeriod: "nonsense" } });
  check("and only a real choice is", (await api("api/library.php")).addedSince, stretch.week.since);
  await api("api/settings.php", { view: { addedPeriod: "month" } });
  await api("api/local.php", { id: scratch.game.id, remove: true }, "POST");
  const after = await api("api/library.php");
  /* Empty, it stays on the list, marked, carrying its reason: a collection that
     quietly vanished with time reads as breakage, not as a rule. */
  const gone = after.collections.find((c) => c.key === "@added");
  if (recentBefore === 0) {
    check("empty, Recently added stays and says why", !!gone && gone.count === 0 && /30 days/.test(gone.note || ""));
  } else {
    // Something real arrived in the last 30 days, so it is not empty.
    check("with the scratch game gone, Recently added is back to what was there", !!gone && gone.count === recentBefore);
  }
  check("the other collections still hide when empty", after.collections.every((c) => c.count > 0 || c.key === "@added"));

  /* Two players or more: MaxPlayers of 2 or more, or a PlayMode saying
     Multiplayer or Cooperative where the number is blank. The count shown is
     computed in another pass from the set the collection opens, so both are held. */
  const playersCol = lib.collections.find((c) => c.key === "@players");
  check("Two players or more is a collection", !!playersCol && playersCol.count > 0);
  check("rows carry how many can play", lib.games.every((x) => typeof x.players === "number"));
  const couch = await api("api/library.php?platform=%40players");
  // Whichever half of the rule let a game in, the number on the rim is the set that opens.
  check("its count is the set it opens", couch.ok && couch.games.length, playersCol.count);
  // Rows do not carry the play mode, so a member seats two or has no number:
  // asserting players >= 2 for all fails on any library where the fallback fires.
  const twoUp = lib.games.filter((x) => x.players >= 2).length;
  check("it holds at least every game that seats two", playersCol.count >= twoUp);
  check("and nothing that says one", !couch.games.some((x) => x.players === 1));
  check("every member seats two or left the number blank",
    couch.games.every((x) => x.players >= 2 || x.players === 0));

  /* A game of your own has a player count only if one is typed in its Players
     box: blank keeps it out rather than guess. */
  const solo = await api("api/local.php", { set: { title: "Xsegon Solo Scratch", url: BASE + "/" } }, "POST");
  const duo = await api("api/local.php", { set: { title: "Xsegon Couch Scratch", url: BASE + "/", players: 2 } }, "POST");
  const withOwn = await api("api/library.php?platform=%40players");
  check("your own game joins it when you say two", withOwn.games.some((x) => x.title === "Xsegon Couch Scratch"));
  check("and stays out while nobody has said", !withOwn.games.some((x) => x.title === "Xsegon Solo Scratch"));
  const badCount = await api("api/local.php", { id: duo.game.id, set: { title: "Xsegon Couch Scratch", url: BASE + "/", players: 999 } }, "POST");
  check("a nonsense player count is refused", badCount.ok === false && /players/.test(badCount.error || ""));
  await api("api/local.php", { id: solo.game.id, remove: true }, "POST");
  await api("api/local.php", { id: duo.game.id, remove: true }, "POST");
  check("collections are still an array afterwards", Array.isArray((await api("api/library.php")).collections));

  const g = lib.games[0];
  for (const f of ["id", "title", "platform", "hasArt", "hasLogo", "hasVideo", "playable", "local", "favourite"]) {
    check("row carries " + f, g[f] !== undefined);
  }
  check("rows carry plain picture addresses", lib.games.some((x) => x.img && x.img.box && x.img.box.startsWith("files/")));

  const fav = await api("api/library.php?platform=%40favourites");
  check("favourites collection: all favourites", fav.ok && fav.games.length > 0 && fav.games.every((x) => x.favourite));
  const un = await api("api/library.php?platform=%40unplayed");
  check("never played collection: none played", un.ok && un.games.every((x) => !x.plays));

  const sorted = await api("api/library.php?platform=Nintendo%2064&sort=developer&grouped=1");
  check("developer sort sends groups", sorted.ok && sorted.games.some((x) => x.group));
  const rev = await api("api/library.php?platform=Nintendo%2064&sort=title&reverse=1");
  check("reverse flips the order", rev.ok && rev.games[0].sortTitle.localeCompare(rev.games[rev.games.length - 1].sortTitle) > 0);
  const fwd = await api("api/library.php?platform=Nintendo%2064&sort=title&reverse=0");
  check("and reverse=0 runs A to Z", fwd.ok && fwd.games[0].sortTitle.localeCompare(fwd.games[fwd.games.length - 1].sortTitle) < 0);
  // Number sorts run both ways; with no rating or never played, last either way. Favourites lead, so left out,
  // except from your own stars, which favourites do not lead. Five games get stars for it, and are put back.
  const everyGame = (await api("api/library.php?grouped=0")).games;
  const mine = everyGame.filter((x) => !x.favourite).slice(0, 3).concat(everyGame.filter((x) => x.favourite).slice(0, 2));
  for (const [i, x] of mine.entries()) { await api("api/my-rating.php", { id: x.id, stars: [5, 2, 4, 0, 3][i] }); }
  for (const [sort, k, blanksLast] of [["plays", "plays", false], ["playtime", "seconds", false], ["rating", "rating", true], ["myrating", "myRating", true], ["recent", "lastPlayed", true],
                                       ["players", "players", true], ["cheats", "cheats", true], ["added", "addedAt", true]]) {
    for (const reverse of [0, 1]) {
      const r = await api("api/library.php?sort=" + sort + "&reverse=" + reverse);
      const vals = r.games.filter((x) => sort === "myrating" || !x.favourite).map((x) => x[k] || 0);
      const firstBlank = blanksLast ? vals.indexOf(0) : -1;
      const some = firstBlank < 0 ? vals : vals.slice(0, firstBlank);
      const up = reverse === 1;
      check(sort + (up ? " smallest" : " largest") + " first" + (blanksLast ? ", the ones with none last" : ""),
            [some.every((v, i) => i === 0 || (up ? some[i - 1] <= v : some[i - 1] >= v)),
             firstBlank < 0 || vals.slice(firstBlank).every((v) => v === 0)], [true, true]);
    }
  }
  const ranked = (await api("api/library.php?sort=myrating&reverse=0&grouped=1")).games;
  check("sorted by your rating, your five stars lead, an unrated favourite waits with the unrated, and no Favourites header heads it",
        [ranked[0].myRating, mine.length < 5 || ranked.findIndex((x) => x.id === mine[3].id) > ranked.findIndex((x) => x.id === mine[1].id), ranked.some((x) => /Favourites/.test(x.group || ""))], [5, true, false]);
  for (const x of mine) { await api("api/my-rating.php", { id: x.id, stars: x.myRating || 0 }); }

  /* The list's other columns sort too, by what their cells say (favourites left
     out). A text order is held by its shape, not by a collation of this file's
     own: each value in one run, reverse turns the runs round, blanks last both ways. */
  const runsOf = (vals) => vals.filter((v, i) => i === 0 || v !== vals[i - 1]);
  const TEXT = { tags: (x) => (x.tags || []).join(" · "), needsfix: (x) => x.needsFix || "", file: (x) => x.file || "",
                 source: (x) => x.steam ? "Steam" : x.local ? "Your own" : x.scanned ? "Scanned" : "LaunchBox" };
  for (const [sort, text] of Object.entries(TEXT)) {
    const both = [];
    for (const reverse of [0, 1]) {
      const vals = (await api("api/library.php?sort=" + sort + "&reverse=" + reverse)).games.filter((x) => !x.favourite).map((x) => text(x).trim().toLowerCase());
      const blank = vals.indexOf(""), said = blank < 0 ? vals : vals.slice(0, blank);
      both.push({ runs: runsOf(said), blanksLast: vals.slice(said.length).every((v) => v === "") });
    }
    check(sort + " sorts by what its column says: each value in one run, turned round by reverse, blanks last both ways",
          [new Set(both[0].runs).size === both[0].runs.length, both[0].runs.join("|") === both[1].runs.slice().reverse().join("|"), both[0].blanksLast && both[1].blanksLast], [true, true, true]);
  }
  const lacking = (x) => ["hasArt", "hasBox3d", "hasLogo", "hasShot", "hasFanart", "hasVideo"].filter((k) => !x[k]).length;
  const runsEither = (v, up) => v.every((n, i) => i === 0 || (up ? v[i - 1] <= n : v[i - 1] >= n));
  // Documents, Hack and Discs: the games with something to say first, most first, and the rest last both ways.
  const SAID = { docs: (x) => x.docs ? 1 : 0, hack: (x) => x.hack === "yes" ? 2 : x.hack === "ask" ? 1 : 0,
                 discs: (x) => x.discs ? (x.discs.set ? x.discs.n : 1) : 0 };
  for (const [sort, said] of Object.entries(SAID)) {
    const both = [];
    for (const reverse of [0, 1]) {
      const v = (await api("api/library.php?versions=all&sort=" + sort + "&reverse=" + reverse)).games.filter((x) => !x.favourite).map(said);
      const none = v.indexOf(0), has = none < 0 ? v : v.slice(0, none);
      both.push(runsEither(has, reverse === 1) && v.slice(has.length).every((n) => n === 0));
    }
    check(sort + " sorts by what its column says: most first, turned round by reverse, the games with nothing to say last both ways", both, [true, true]);
  }
  for (const reverse of [0, 1]) {
    const m = (await api("api/library.php?sort=missing&reverse=" + reverse)).games.filter((x) => !x.favourite).map(lacking);
    const none = m.indexOf(0), has = none < 0 ? m : m.slice(0, none);
    check("missing sorts " + (reverse ? "least" : "most") + " missing first, the games that lack nothing last",
          [runsEither(has, reverse === 1), m.slice(has.length).every((n) => n === 0)], [true, true]);
    const ready = (await api("api/library.php?sort=ready&reverse=" + reverse)).games.filter((x) => !x.favourite).map((x) => x.ready ? 1 : 0);
    check("ready sorts " + (reverse ? "the ready" : "what cannot start") + " first", runsEither(ready, reverse === 0));
    const favs = (await api("api/library.php?sort=favourite&reverse=" + reverse)).games.map((x) => x.favourite ? 1 : 0);
    check("favourite sorts the favourites " + (reverse ? "last" : "first") + ", whatever Favourites first says", runsEither(favs, reverse === 1));
  }
  const sortKept = await api("api/settings.php", { view: { sort: "missing" } });
  check("a column's sort can be kept as the order", sortKept.settings.view.sort, "missing");
  await api("api/settings.php", { view: { sort: "title" } });

  // guards: actions need a local origin
  const r = await fetch(BASE + "/api/hide.php", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://evil.example" }, body: JSON.stringify({ id: g.id, hide: true }) });
  check("foreign origin is refused", r.status === 403 || (await r.json()).ok === false);
  // Every POST is checked in boot.php, not only by endpoints that remember to ask.
  for (const [ep, body] of [["launch", { id: g.id, dry: true }], ["favourite", { id: g.id, on: true }], ["edit", { id: g.id, set: { developer: "x" } }],
                            ["import", {}], ["settings", { view: { sort: "title" } }], ["tags", { id: g.id, tags: ["x"] }]]) {
    const f = await fetch(BASE + "/api/" + ep + ".php", { method: "POST", headers: { "Content-Type": "text/plain", Origin: "http://evil.example" }, body: JSON.stringify(body) });
    check("a foreign page cannot POST to " + ep + ".php", f.status, 403);
  }
  check("and a local page still can", (await api("api/launch.php", { id: g.id, dry: true })).ok, true);

  /* One game at a time: a second launch would share the first's temp files.
     Refused while the launcher is alive or pending; a file from a launcher that
     has gone is cleared and never blocks. running.json is written by hand here. */
  const runFile = path.join(DATA, "running.json");
  const writeRun = (o) => fs.writeFileSync(runFile, JSON.stringify(Object.assign({ gameId: "xs-busy", title: "Xsegon Busy Test", platform: "Test", startedAt: new Date().toISOString() }, o)));
  try {
    writeRun({ launcherPid: process.pid });                       // a process that is certainly alive
    const busy = await api("api/launch.php", { id: g.id, dry: true });
    check("a launch while a game runs is refused, and says which game", [busy.ok, /Xsegon Busy Test is still running: quit it first/.test(busy.error || "")], [false, true]);
    writeRun({ pending: true });
    check("and in the second before the launcher is up", (await api("api/launch.php", { id: g.id, dry: true })).ok, false);
    writeRun({ launcherPid: 999999 });                            // no such process
    check("a file left by a launcher that has gone does not block", (await api("api/launch.php", { id: g.id, dry: true })).ok, true);
    check("and is cleared", fs.existsSync(runFile), false);
    writeRun({ pending: true });
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(runFile, old, old);
    check("a launcher that never started is let go by the status poll", (await api("api/running.php")).running, null);
    check("and its file cleared", fs.existsSync(runFile), false);
    /* The poll asks Windows too, once a minute, so a launcher that died does
       not leave "playing X" up until the next Play. */
    writeRun({ launcherPid: 999999 });
    check("a game whose launcher has gone is still shown for its first minute (Windows is not asked every 4 seconds)", !!(await api("api/running.php")).running, true);
    fs.utimesSync(runFile, old, old);
    check("a minute on, the poll asks Windows and lets it go", (await api("api/running.php")).running, null);
    check("and clears its file", fs.existsSync(runFile), false);
    writeRun({ launcherPid: process.pid });
    fs.utimesSync(runFile, old, old);
    check("one whose launcher is alive stays, however long it has run", ((await api("api/running.php")).running || {}).title, "Xsegon Busy Test");
    check("and Windows is not asked again for another minute", Date.now() - fs.statSync(runFile).mtimeMs < 30000, true);

    /* A game that is not RetroArch: Stop game must not ask RetroArch to quit,
       and its play time must be read again when it ends. */
    const sessFile = path.join(DATA, "sessions.jsonl");
    const sessWas = fs.existsSync(sessFile) ? fs.readFileSync(sessFile) : null;
    try {
      writeRun({ launcherPid: process.pid, kind: "other", gameId: g.id, title: g.title });
      const q = await api("api/quit.php", {});
      check("Stop game for a game that is not RetroArch is refused, and says how to quit it", [q.ok, /is not a RetroArch game.*quit it from inside the game/.test(q.error || "")], [false, true]);
      await b.goto();
      check("the page says to quit the game itself, and offers no Stop game button",
        await b.until(`(() => { const s = document.getElementById("strip"); return !s.hidden && /quit the game to come back/.test(s.textContent) && ![...s.querySelectorAll("button")].some((x) => /Stop game/.test(x.textContent)); })()`, true, 15000), true);
      const was = (await api("api/game.php?id=" + encodeURIComponent(g.id))).game;
      const iso = new Date().toISOString();
      fs.appendFileSync(sessFile, JSON.stringify({ at: iso, endedAt: iso, gameId: g.id, title: g.title, platform: g.platform, seconds: 77, exitCode: 0, source: "xsegon" }) + "\n");
      fs.rmSync(runFile, { force: true });
      const now = (await api("api/game.php?id=" + encodeURIComponent(g.id))).game;
      check("a game's details carry its play time, counted fresh", [now.seconds - was.seconds, now.plays - was.plays], [77, 1]);
      let readAgain = false;
      for (const end = Date.now() + 20000; Date.now() < end && !readAgain;) {
        const t = await api("api/log.php?tail=200");
        readAgain = (t.lines || []).some((l) => l.includes("P LNCH play time read again: " + now.plays + " play(s), " + now.seconds + "s"));
        if (!readAgain) { await new Promise((r) => setTimeout(r, 300)); }
      }
      check("and when the game ends, the page reads its play time again", readAgain, true);

      /* NEEDS FIX on the card follows the launch that just ended, with no reload.
         The launcher's files are written by hand, and the page's poll is asked at once. */
      const lrFile = path.join(DATA, "launch-results.json");
      const lrWas = fs.existsSync(lrFile) ? fs.readFileSync(lrFile) : null;
      try {
        const lrAll = (() => { try { return JSON.parse(String(lrWas || "{}").replace(/^﻿/, "")); } catch (e) { return {}; } })();
        const went = (ok) => fs.writeFileSync(lrFile, JSON.stringify(Object.assign({}, lrAll,
          { [g.id]: { ok, at: new Date().toISOString(), title: g.title, why: ok ? "" : "the test's own failure" } })));
        const WHY = "the last launch failed: the test's own failure";
        const poll = () => b.ev(`import("/js/status.js").then((m) => { m.pollStatus(); return true; })`);
        const card = `(async () => { const S = await import("/js/state.js"); let x = null;
          S.games.forEach((y) => [y].concat(y.versions || []).forEach((v) => { if (!x && v.id === ${JSON.stringify(g.id)}) { x = v; } }));
          return [x ? x.needsFix || "" : "not listed", [...document.querySelectorAll("#view .needsfix")].some((n) => n.title.includes(${JSON.stringify(WHY)}))]; })()`;
        const played = async (ok) => {
          writeRun({ launcherPid: process.pid, kind: "other", gameId: g.id, title: g.title });
          await poll();
          await b.until(`(() => { const s = document.getElementById("strip"); return !s.hidden && s.dataset.kind === "running"; })()`, true, 8000);
          went(ok);
          fs.rmSync(runFile, { force: true });
          await poll();
        };
        went(true);
        await b.openPlatform(g.platform);
        await b.ev(`import("/js/editors.js").then((m) => m.reloadKeeping(${JSON.stringify(g.id)})).then(() => true)`);
        check("(the game is on screen, with no NEEDS FIX)", await b.until(card, ["", false], 6000), ["", false]);
        await played(false);
        check("a launch that fails puts NEEDS FIX on its card by itself", await b.until(card, [WHY, true], 10000), [WHY, true]);
        check("and the game says so when asked for alone", (await api("api/game.php?id=" + encodeURIComponent(g.id))).game.needsFix, WHY);
        await played(true);
        check("a good play takes NEEDS FIX off its card by itself, with no reload", await b.until(card, ["", false], 10000), ["", false]);
        const fixLog = ((await api("api/log.php?tail=300")).lines || []).join("\n");
        check("and the log says both", [/P FIX .*NEEDS FIX put on after that launch/.test(fixLog), /P FIX .*NEEDS FIX taken off after that play/.test(fixLog)], [true, true]);
      } finally {
        if (lrWas === null) { fs.rmSync(lrFile, { force: true }); } else { fs.writeFileSync(lrFile, lrWas); }
      }
    } finally {
      if (sessWas === null) { fs.rmSync(sessFile, { force: true }); } else { fs.writeFileSync(sessFile, sessWas); }
    }
  } finally {
    fs.rmSync(runFile, { force: true });
  }

  // Favourites and settings changes leave a trace in the log.
  await api("api/favourite.php", { id: g.id, fav: true });
  await api("api/favourite.php", { id: g.id, fav: false });
  const sortWas = ((await api("api/settings.php")).settings.view || {}).sort;
  await api("api/settings.php", { view: { sort: sortWas === "year" ? "title" : "year" } });
  await api("api/settings.php", { view: { sort: sortWas } });
  const logTail = ((await api("api/log.php?tail=60")).lines || []).join("\n");
  check("starring and unstarring are in the log", logTail.includes(" FAV  " + g.id + " starred") && logTail.includes(" FAV  " + g.id + " unstarred"), true);
  check("a settings save says which setting, from what to what", /SET  view\.sort "\w+" -> "\w+"/.test(logTail), true);

  // the files door: only media, only inside data
  const okFile = await fetch(BASE + "/" + g.img.box);
  check("files door serves a thumbnail", okFile.status === 200 && (okFile.headers.get("content-type") || "").startsWith("image/"));
  check("files door sends long caching", (okFile.headers.get("cache-control") || "").includes("max-age=31536000"));
  // Sent as raw bytes on a socket: fetch() tidies ".." and "%2e%2e" away
  // before sending, and the point is what the server does with them.
  for (const bad of ["files/thumbs/../settings.json", "files/thumbs/%2e%2e/settings.json", "files/thumbs/..%2Fsettings.json",
                     "files/thumbs/box/..%5C..%5Csettings.json", "files/media/x.php", "files/settings.json", "data/settings.json", "files/nope/a.png"]) {
    check("files door refuses " + bad, await rawStatus("/" + bad), 404);
  }
  const range = await fetch(BASE + "/" + g.img.box, { headers: { Range: "bytes=0-99" } });
  check("files door answers Range", range.status === 206 && (range.headers.get("content-length") === "100"));

  /* Only the page's own code is served: Windows drops a trailing dot, so
     /data./settings.json is data, and /bin/import.php would run an import. */
  for (const bad of ["data./settings.json", "DATA./settings.json", "includes/boot.php", "bin/import.php", "doc/CHANGELOG.md",
                     "tests/lib.js", "tools/make-test-copy.js", "start.ps1", "router.php", "README.md"]) {
    check("not served: /" + bad, await rawStatus("/" + bad), 404);
  }
  for (const good of ["js/main.js", "css/xsegon.css", "api/status.php", "index.php", "img/xsegon-32.png", "img/xsegon-192.png"]) {
    check("served: /" + good, await rawStatus("/" + good), 200);
  }
  const favicon = await fetch(BASE + "/favicon.ico");
  const favBytes = Buffer.from(await favicon.arrayBuffer());
  check("favicon.ico is Xsegon's own icon, not the whole page", [favicon.status, favicon.headers.get("content-type"), favBytes.readUInt16LE(2), favBytes.readUInt16LE(4) >= 5], [200, "image/x-icon", 1, true]);
  check("a page that rebinds its own name to this machine is refused (Host)", await rawStatus("/api/status.php", "evil.example"), 403);
  check("localhost by name still works", await rawStatus("/api/status.php", "localhost:" + new URL(BASE).port), 200);

  /* A video answer is at most 2 MB: an open-ended "bytes=0-" would hold this
     one-at-a-time server for a whole transfer. */
  const capDir = path.join(DATA, "videos-steam");
  const capFile = path.join(capDir, "xs-range-cap-test.mp4");
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(capFile, Buffer.alloc(3 * 1024 * 1024));
  try {
    const big = await fetch(BASE + "/files/videos-steam/xs-range-cap-test.mp4", { headers: { Range: "bytes=0-" } });
    await big.arrayBuffer();
    check("an open-ended range gets 2 MB, and says how big the file is", [big.status, big.headers.get("content-length"), big.headers.get("content-range")],
          [206, String(2 * 1024 * 1024), "bytes 0-2097151/3145728"]);
    const rest = await fetch(BASE + "/files/videos-steam/xs-range-cap-test.mp4", { headers: { Range: "bytes=2097152-" } });
    check("and the next piece is the rest", [rest.status, (await rest.arrayBuffer()).byteLength, rest.headers.get("content-range")],
          [206, 1024 * 1024, "bytes 2097152-3145727/3145728"]);
  } finally {
    fs.rmSync(capFile, { force: true });
  }

  /* No two games on one console read the same: a same-named set carries the
     words of its file names that differ (variant). Checked with every file its
     own row (versions=all): rolled up, a card wears no variant of its own. */
  const whole = (await api("api/library.php?versions=all")).games || [];
  const named = {};
  whole.forEach((g) => { const k = g.platform + "|" + g.title + (g.variant ? "  (" + g.variant + ")" : ""); named[k] = (named[k] || 0) + 1; });
  check("no two games on one console read the same", Object.keys(named).filter((k) => named[k] > 1), []);
  /* A "(Track N).bin" is one track of a disc, never a game: the assembly
     drops any that an older scan let in. */
  check("no lone disc track passes for a game", whole.filter((g) => /\(\s*Track\s*\d+\s*\)\.bin$/i.test(g.file || "")).map((g) => g.title), []);

  /* And rolled up, as the page asks by default: one card per game on a console,
     carrying every version. Worked out from the flat list, so it holds for any library. */
  const sets = {};
  whole.forEach((g) => { const k = (g.platform + "|" + g.title.trim()).toLowerCase(); (sets[k] = sets[k] || []).push(g); });
  const multi = Object.values(sets).filter((v) => v.length > 1);
  const cards = (await api("api/library.php")).games || [];
  check("versions of one game share one card", cards.length, whole.length - multi.reduce((a, v) => a + v.length - 1, 0));
  if (multi.length) {
    const set = multi[0];
    const card = cards.find((c) => (c.versions || []).some((v) => v.id === set[0].id)) || {};
    check("and the card carries every version", (card.versions || []).map((v) => v.id).sort(), set.map((g) => g.id).sort());
    check("each with the words that tell it apart, the card with none of its own",
          [card.variant, (card.versions || []).every((v) => !!(v.variant || v.file))], [null, true]);
    check("the one played last first", (card.versions || []).map((v) => v.lastPlayed || ""),
          (card.versions || []).map((v) => v.lastPlayed || "").sort().reverse());
    check("its plays are the versions' together", card.plays, set.reduce((a, g) => a + (g.plays || 0), 0));
    /* A version selected in details > Versions (api\select-version.php) rides
       its card as chosen, and Play starts it without asking. Put back after. */
    const had = card.chosen || null;
    const pick = set[0];
    const kept = await api("api/select-version.php", { id: pick.id, selected: true });
    const withPick = ((await api("api/library.php")).games || []).find((c) => (c.versions || []).some((v) => v.id === pick.id)) || {};
    check("a selected version is kept at the press and rides the card as chosen", [kept.ok, withPick.chosen], [true, pick.id]);
    const off = await api("api/select-version.php", { id: pick.id, selected: false });
    const noPick = ((await api("api/library.php")).games || []).find((c) => (c.versions || []).some((v) => v.id === pick.id)) || {};
    check("deselected, the card carries no chosen version and Play asks again", [off.ok, noPick.chosen === undefined], [true, true]);
    if (had) { await api("api/select-version.php", { id: had, selected: true }); }
  } else {
    console.log("    (no game here has two versions on one console; the roll-up checks step aside)");
  }
  const settings = await api("api/settings.php");
  check("settings answer", settings.ok !== false && (settings.settings || settings).view);

  const snd = await api("api/sounds.php");
  check("the sound packs are listed", snd.ok && snd.packs.length > 0);
  check("with which ones are Xsegon's own", snd.packs.every((p) => typeof p.mine === "boolean"));
  check("and nothing copies LaunchBox's packs in: the request that did is refused", (await api("api/sounds.php", { action: "copy" })).ok, false);
  /* "Xsegon" (Ovani's, Ok included) is the set a new copy starts on and plays
     for a set not on this PC; a set that is here answers as itself. */
  const builtIns = snd.packs.filter((p) => p.builtin).map((p) => [p.name, p.mine, p.files]);
  check("the built-in sets are listed, marked, and not ones you copied", builtIns, [["Xsegon", false, 6], ["Xsegon 2", false, 4]]);
  const shipped = (set, file) => fs.readFileSync(path.join(__dirname, "..", "sounds", set, file));
  for (const name of ["Move", "Hover", "Select", "Back", "Ok"]) {
    const r = await fetch(BASE + "/api/sound.php?name=" + name.toLowerCase() + "&set=NoSuchPackHere");
    const body = Buffer.from(await r.arrayBuffer());
    check("a set that is not on this PC plays the built-in " + name, [r.status, r.headers.get("x-xsegon-sound-set"), r.headers.get("content-type"), body.equals(shipped("Xsegon", name + ".wav"))], [200, "Xsegon", "audio/wav", true]);
  }
  for (const [name, file, type] of [["move", "Move.ogg", "audio/ogg"], ["select", "Select.wav", "audio/wav"], ["back", "Back.wav", "audio/wav"], ["ok", "Ok.wav", "audio/wav"]]) {
    const r = await fetch(BASE + "/api/sound.php?name=" + name + "&set=" + encodeURIComponent("Xsegon 2"));
    const body = Buffer.from(await r.arrayBuffer());
    check("Xsegon 2 answers its own " + file, [r.status, r.headers.get("x-xsegon-sound-set"), r.headers.get("content-type"), body.equals(shipped("Xsegon 2", file))], [200, "Xsegon 2", type, true]);
  }
  check("a sound a set here has none of is silent, not another set's", (await fetch(BASE + "/api/sound.php?name=startup&set=" + encodeURIComponent("Xsegon 2"))).status, 404);
  /* Hover is Xsegon's own sound, so it is the one sound a set that is here borrows from the built-in.
     The Shelf asks for Move in its place (&or=move), and gets the Hover while there is a built-in one. */
  {
    const hover = (more) => fetch(BASE + "/api/sound.php?name=hover" + more + "&set=" + encodeURIComponent("Xsegon 2"));
    const plain = await hover(""), or = await hover("&or=move"), built = shipped("Xsegon", "Hover.wav");
    check("a set with no Hover of its own plays the built-in one, where the Shelf asks as well",
          [plain.status, Buffer.from(await plain.arrayBuffer()).equals(built), Buffer.from(await or.arrayBuffer()).equals(built)], [200, true, true]);
  }
  // Ok is how a finished fetch sounds: a pack with no Ok file plays its Select instead.
  {
    const pack = snd.packs.find((p) => !p.builtin && p.files > 0);
    if (pack) {
      const ask = (name) => fetch(BASE + "/api/sound.php?name=" + name + "&set=" + encodeURIComponent(pack.name));
      const ok = await ask("ok");
      const okBody = Buffer.from(await ok.arrayBuffer());
      const sel = await ask("select");
      const selBody = Buffer.from(await sel.arrayBuffer());
      // a Select with variants is a random pick each time, so only the answer is compared
      const random = sel.headers.get("cache-control") === "no-store";
      check("ok with no Ok file plays the pack's Select instead of silence (" + pack.name + ")",
            [ok.status, random || okBody.equals(selBody)], [200, true]);
    } else {
      console.log("    (no sound pack here but the built-in ones: the Ok stand-in check steps aside)");
    }
  }
  // Asked about again on each page load, so a changed sound is heard at once: same file 304, another the file.
  {
    const r = await fetch(BASE + "/api/sound.php?name=move&set=Xsegon");
    await r.arrayBuffer();
    const tag = r.headers.get("etag");
    check("a sound is sent to be checked again before use", [r.headers.get("cache-control"), /^"[0-9a-f]{16}"$/.test(tag || "")], ["private, no-cache", true]);
    const again = await fetch(BASE + "/api/sound.php?name=move&set=Xsegon", { headers: { "If-None-Match": tag } });
    check("and the same file again is a 304, with nothing sent", [again.status, (await again.arrayBuffer()).byteLength], [304, 0]);
    const old = await fetch(BASE + "/api/sound.php?name=move&set=Xsegon", { headers: { "If-None-Match": "\"0000000000000000\"" } });
    check("but one the browser has another of comes whole", [old.status, Buffer.from(await old.arrayBuffer()).equals(shipped("Xsegon", "Move.wav"))], [200, true]);
  }
  const here = snd.packs.find((p) => p.name === snd.using && !p.builtin) || snd.packs.find((p) => p.mine);
  if (here) {
    const r = await fetch(BASE + "/api/sound.php?name=move&set=" + encodeURIComponent(here.name));
    const body = Buffer.from(await r.arrayBuffer());
    check("a set that is here answers as itself, never as the built-in", [r.status, r.headers.get("x-xsegon-sound-set"), body.equals(shipped("Xsegon", "Move.wav"))], [200, here.name, false]);
    check("and choosing it is not a stand-in", snd.using === here.name ? snd.standIn : null, null);
  } else {
    console.log("    (no sound pack but the built-in one here; the answers-as-itself check steps aside)");
  }
  check("an unknown sound is still refused", (await fetch(BASE + "/api/sound.php?name=nope&set=NoSuchPackHere")).status, 404);

  /* ---- with LaunchBox gone ----
     A LaunchBox path to no folder is how a moved or uninstalled LaunchBox looks,
     and everything Xsegon copied must carry on. The path is put back after. */
  const lbPath = (settings.settings || settings).paths.launchbox;
  try {
    await api("api/settings.php", { paths: { launchbox: "C:\\NoSuchLaunchBox" } });
    const gone = await api("api/status.php");
    check("LaunchBox can be missing", gone.checks.launchbox.present, false);
    check("and the library is still there", gone.counts.games > 100);

    const lib2 = await api("api/library.php");
    const one = lib2.games.find((x) => x.hasVideo) || lib2.games[0];
    const thumb = await fetch(BASE + "/" + one.img.box);
    check("thumbnails still serve", thumb.status === 200);
    const full = await fetch(BASE + "/api/image.php?id=" + encodeURIComponent(one.id) + "&kind=box&size=full");
    check("full-size pictures still serve, from the copy", full.status === 200 && (full.headers.get("content-type") || "").startsWith("image/"));
    const vid = await fetch(BASE + "/api/video.php?id=" + encodeURIComponent(one.id));
    check("snaps still play, from the copy", vid.status === 200 && (vid.headers.get("content-type") || "").startsWith("video/"));
    // Let go of: a video left unread holds this one-at-a-time server ten seconds.
    try { await vid.body.cancel(); } catch (e) { /* nothing was coming */ }
    const wav = await fetch(BASE + "/api/sound.php?name=move");
    check("sounds still play, from Xsegon's own packs", wav.status === 200 && /^audio\/(wav|ogg|mpeg)$/.test(wav.headers.get("content-type") || ""));
    const sets = await api("api/settings.php");
    check("and the packs are still on offer", Object.keys(sets.schema.sound.soundSet.options).length > 0);
    const db = await api("api/gamesdb.php?id=" + encodeURIComponent(one.id) + "&what=images");
    check("the games database still answers, from data\\gamesdb.sqlite", db.ok === true);
    const plat = await fetch(BASE + "/api/image.php?platform=" + encodeURIComponent(lib2.games[0].platform) + "&kind=clearlogo");
    check("a console picture still serves", plat.status === 200 || plat.status === 404);

    /* Console icons with no LaunchBox: RetroArch's, shipped in img\consoles, for
       a console with no icon of your own; yours still first; a console with no
       libretro name gets the 404 that draws the glyph. */
    const icons = path.join(__dirname, "..", "img", "consoles");
    const fetched = JSON.parse(fs.readFileSync(path.join(icons, "sources.json"), "utf8"));
    const sum = (f) => require("crypto").createHash("sha256").update(fs.readFileSync(f)).digest("hex");
    check("the console icons that ship are the ones fetched, with their credit beside them",
          [fs.readdirSync(icons).filter((n) => /\.png$/i.test(n) && !(fetched.files[n] && sum(path.join(icons, n)) === fetched.files[n].sha256)),
           fs.existsSync(path.join(icons, "ABOUT.txt")), fetched.licence], [[], true, "CC-BY-4.0"]);
    const lrSrc = fs.readFileSync(path.join(__dirname, "..", "includes", "libretro.php"), "utf8");
    const named = [...((lrSrc.split("function xs_lr_system(")[1] || "").split("return $map")[0]).matchAll(/'([^']*)'\s*=>\s*'([^']*)'/g)].map((m) => [m[1], m[2]]);
    const artDir = path.join(require("./lib").DATA, "platform-art");
    const ownIcons = fs.existsSync(artDir) ? fs.readdirSync(artDir).filter((n) => /-icon\.[a-z]+$/i.test(n)) : [];
    const key = (p) => p.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const mineToo = (p) => ownIcons.some((n) => n.toLowerCase().startsWith(key(p) + "-icon."));
    // Arcade is left out of these: it wears MAME's pictures, checked below.
    const bare = named.find(([p, sys]) => p !== "Arcade" && !mineToo(p) && fetched.files[sys + ".png"]);
    if (bare) {
      const r = await fetch(BASE + "/api/image.php?platform=" + encodeURIComponent(bare[0]) + "&kind=icon");
      check("a console with no icon of its own gets RetroArch's (" + bare[0] + ")",
            [r.status, r.headers.get("content-type"), Buffer.from(await r.arrayBuffer()).equals(fs.readFileSync(path.join(icons, bare[1] + ".png")))], [200, "image/png", true]);
    }
    const kept = named.find(([p]) => mineToo(p));
    if (kept) {
      const r = await fetch(BASE + "/api/image.php?platform=" + encodeURIComponent(kept[0]) + "&kind=icon");
      const body = Buffer.from(await r.arrayBuffer());
      check("one with an icon of its own keeps it (" + kept[0] + ")",
            [r.status, body.equals(fs.readFileSync(path.join(artDir, ownIcons.find((n) => n.toLowerCase().startsWith(key(kept[0]) + "-icon."))))),
             fetched.files[kept[1] + ".png"] ? body.equals(fs.readFileSync(path.join(icons, kept[1] + ".png"))) : false], [200, true, false]);
    } else {
      console.log("    (no console here has an icon of its own; the keeps-its-own check steps aside)");
    }
    /* The console's picture (the wheel's middle, the carousel's card) for a
       console with none of its own: its photo that ships with Xsegon
       (img\console-photos, public domain), else its icon. */
    const photos = path.join(__dirname, "..", "img", "console-photos");
    const shot = JSON.parse(fs.readFileSync(path.join(photos, "sources.json"), "utf8"));
    check("the console photos that ship are the ones fetched, public domain or CC0, and no credit file",
          [fs.readdirSync(photos).filter((n) => n !== "sources.json" && !(shot.files[n] && sum(path.join(photos, n)) === shot.files[n].sha256)),
           Object.values(shot.files).every((f) => f.licence === "Public domain" || f.licence === "CC0"), fs.existsSync(path.join(photos, "ABOUT.txt"))], [[], true, false]);
    const ownDevices = fs.existsSync(artDir) ? fs.readdirSync(artDir).filter((n) => /-device\.[a-z]+$/i.test(n)) : [];
    const hasOwnDevice = (p) => ownDevices.some((n) => n.toLowerCase().startsWith(key(p) + "-device."));
    const photoOnly = named.find(([p, sys]) => !hasOwnDevice(p) && shot.files[sys + ".webp"]);
    if (photoOnly) {
      const r = await fetch(BASE + "/api/image.php?platform=" + encodeURIComponent(photoOnly[0]) + "&kind=device");
      check("a console with no picture of its own shows its photo (" + photoOnly[0] + ")",
            [r.status, r.headers.get("content-type"), Buffer.from(await r.arrayBuffer()).equals(fs.readFileSync(path.join(photos, photoOnly[1] + ".webp")))], [200, "image/webp", true]);
    }
    const iconOnly = named.find(([p, sys]) => p !== "Arcade" && !hasOwnDevice(p) && !shot.files[sys + ".webp"] && fetched.files[sys + ".png"]);
    if (iconOnly) {
      const r = await fetch(BASE + "/api/image.php?platform=" + encodeURIComponent(iconOnly[0]) + "&kind=device");
      check("and one with no photo either shows its icon (" + iconOnly[0] + ")",
            [r.status, Buffer.from(await r.arrayBuffer()).equals(fs.readFileSync(path.join(icons, iconOnly[1] + ".png")))], [200, true]);
    }
    if (!mineToo("Arcade") && !hasOwnDevice("Arcade")) {
      const mame = fs.readFileSync(path.join(icons, "MAME.png"));
      const got = [];
      for (const kind of ["icon", "device"]) { got.push(Buffer.from(await (await fetch(BASE + "/api/image.php?platform=Arcade&kind=" + kind)).arrayBuffer()).equals(mame)); }
      check("Arcade wears MAME's cabinet as its icon and its picture", got, [true, true]);
    }
    /* Two that libretro has no name for: the Switch has RetroArch's own icon,
       and Steam, which RetroArch draws none for, its own mark from the name logos' folder. */
    const iconOf = async (p) => { const r = await fetch(BASE + "/api/image.php?platform=" + encodeURIComponent(p) + "&kind=icon"); return [r.status, Buffer.from(await r.arrayBuffer())]; };
    if (!mineToo("Nintendo Switch")) {
      const [status, body] = await iconOf("Nintendo Switch");
      check("Nintendo Switch, which libretro has no name for, has RetroArch's icon",
            [status, body.equals(fs.readFileSync(path.join(icons, "Nintendo - Switch.png"))), !!fetched.files["Nintendo - Switch.png"]], [200, true, true]);
    }
    if (!mineToo("Steam")) {
      const [status, body] = await iconOf("Steam");
      const marks = path.join(__dirname, "..", "img", "console-logos");
      check("Steam, which RetroArch has no icon for, has its own mark, said to be Valve's",
            [status, body.equals(fs.readFileSync(path.join(marks, "Steam (icon).png"))),
             (JSON.parse(fs.readFileSync(path.join(marks, "sources.json"), "utf8")).files["Steam (icon).png"] || {}).trademarkOf], [200, true, "Valve"]);
    }
    check("a console with no libretro name still 404s, for the glyph",
          (await fetch(BASE + "/api/image.php?platform=" + encodeURIComponent("No Such Console 9") + "&kind=icon")).status, 404);

    /* The console's name logo on the wheel's rim, for a console with none of
       its own: the one that ships (img\console-logos, public domain or CC0 on
       Commons). Yours still first; "Xsegon's own" puts the shipped one in front. */
    const logos = path.join(__dirname, "..", "img", "console-logos");
    const mark = JSON.parse(fs.readFileSync(path.join(logos, "sources.json"), "utf8"));
    check("the console logos that ship are the ones fetched, public domain or CC0, and say they are still trademarks",
          [fs.readdirSync(logos).filter((n) => n !== "sources.json" && n !== "ABOUT.txt" && !(mark.files[n] && sum(path.join(logos, n)) === mark.files[n].sha256)),
           Object.values(mark.files).every((f) => f.licence === "Public domain" || f.licence === "CC0"),
           /trademark/i.test(fs.readFileSync(path.join(logos, "ABOUT.txt"), "utf8"))], [[], true, true]);
    const aboutLogos = fs.readFileSync(path.join(logos, "ABOUT.txt"), "utf8");
    check("and every one names whose trademark it is and its page on Commons, in sources.json and in ABOUT.txt",
          Object.entries(mark.files).filter(([n, f]) => !(f.trademarkOf && /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(f.page || "") &&
            aboutLogos.includes(n.replace(/\.png$/, "") + "\r\n    A trademark of " + f.trademarkOf + ".\r\n    " + f.page))).map(([n]) => n), []);
    const ownLogos = fs.existsSync(artDir) ? fs.readdirSync(artDir).filter((n) => /-clearlogo\.[a-z]+$/i.test(n)) : [];
    const hasOwnLogo = (p) => ownLogos.some((n) => n.toLowerCase().startsWith(key(p) + "-clearlogo."));
    const logoOf = async (p) => { const r = await fetch(BASE + "/api/image.php?platform=" + encodeURIComponent(p) + "&kind=clearlogo"); return [r.status, r.headers.get("content-type"), Buffer.from(await r.arrayBuffer())]; };
    const logoOnly = named.find(([p, sys]) => !hasOwnLogo(p) && mark.files[sys + ".png"]);
    if (logoOnly) {
      const [status, type, body] = await logoOf(logoOnly[0]);
      check("a console with no name logo of its own gets the one that ships (" + logoOnly[0] + ")",
            [status, type, body.equals(fs.readFileSync(path.join(logos, logoOnly[1] + ".png")))], [200, "image/png", true]);
    } else {
      console.log("    (every console here has a name logo of its own; the gets-the-shipped-one check steps aside)");
    }
    if (!hasOwnLogo("Nintendo Switch")) {
      const [status, , body] = await logoOf("Nintendo Switch");
      check("Nintendo Switch, which libretro has no name for, has its logo too",
            [status, body.equals(fs.readFileSync(path.join(logos, "Nintendo - Nintendo Switch.png")))], [200, true]);
    }
    if (!hasOwnLogo("Arcade")) {
      const [status, , body] = await logoOf("Arcade");
      check("Arcade wears the MAME logo, the same picture MAME does, and its entry says what starts it",
            [status, body.equals(fs.readFileSync(path.join(logos, "MAME.png"))), /FinalBurn Neo/.test((mark.files["FBNeo - Arcade Games.png"] || {}).note || "")], [200, true, true]);
    }
    const ownLogo = named.find(([p, sys]) => hasOwnLogo(p) && mark.files[sys + ".png"]);
    if (ownLogo) {
      const mine = fs.readFileSync(path.join(artDir, ownLogos.find((n) => n.toLowerCase().startsWith(key(ownLogo[0]) + "-clearlogo."))));
      const shipped = fs.readFileSync(path.join(logos, ownLogo[1] + ".png"));
      check("one with a name logo of its own keeps it (" + ownLogo[0] + ")", (await logoOf(ownLogo[0]))[2].equals(mine), true);
      try {
        await api("api/settings.php", { view: { consoleArt: "xsegon" } });
        check("Xsegon's own puts the shipped name logo in front of it", (await logoOf(ownLogo[0]))[2].equals(shipped), true);
      } finally {
        await api("api/settings.php", { view: { consoleArt: "yours" } });
      }
      check("and Yours first brings it back", (await logoOf(ownLogo[0]))[2].equals(mine), true);
    }
    check("a console with no name logo anywhere still 404s, for its name in words",
          (await fetch(BASE + "/api/image.php?platform=" + encodeURIComponent("No Such Console 9") + "&kind=clearlogo")).status, 404);

    /* Settings > Views > Console pictures, "Xsegon's own": the shipped pictures
       go in front of yours, which are untouched, and "Yours first" brings them
       back. The pictures' version changes both ways, so the browser asks again. */
    const ownBoth = named.find(([p, sys]) => mineToo(p) && hasOwnDevice(p) && fetched.files[sys + ".png"] && shot.files[sys + ".webp"]);
    if (ownBoth) {
      const q = (k) => BASE + "/api/image.php?platform=" + encodeURIComponent(ownBoth[0]) + "&kind=" + k;
      const ownIconFile = path.join(artDir, ownIcons.find((n) => n.toLowerCase().startsWith(key(ownBoth[0]) + "-icon.")));
      const ownDeviceFile = path.join(artDir, ownDevices.find((n) => n.toLowerCase().startsWith(key(ownBoth[0]) + "-device.")));
      const before = fs.readdirSync(artDir).map((n) => n + ":" + sum(path.join(artDir, n))).join("|");
      const revYours = (await api("api/library.php")).platformArtRev;
      try {
        await api("api/settings.php", { view: { consoleArt: "xsegon" } });
        const icon = Buffer.from(await (await fetch(q("icon"))).arrayBuffer());
        const dev = Buffer.from(await (await fetch(q("device"))).arrayBuffer());
        check("Xsegon's own: the icon and photo that ship, in front of this copy's own (" + ownBoth[0] + ")",
              [icon.equals(fs.readFileSync(path.join(icons, ownBoth[1] + ".png"))), dev.equals(fs.readFileSync(path.join(photos, ownBoth[1] + ".webp")))], [true, true]);
        const revXsegon = (await api("api/library.php")).platformArtRev;
        check("and the pictures get new addresses", [revXsegon !== revYours, revXsegon === -revYours], [true, true]);
      } finally {
        await api("api/settings.php", { view: { consoleArt: "yours" } });
      }
      const icon = Buffer.from(await (await fetch(q("icon"))).arrayBuffer());
      const dev = Buffer.from(await (await fetch(q("device"))).arrayBuffer());
      check("Yours first brings this copy's own back, every file of it untouched",
            [icon.equals(fs.readFileSync(ownIconFile)), dev.equals(fs.readFileSync(ownDeviceFile)),
             fs.readdirSync(artDir).map((n) => n + ":" + sum(path.join(artDir, n))).join("|") === before,
             (await api("api/library.php")).platformArtRev === revYours], [true, true, true, true]);
    } else {
      console.log("    (no console here has both an icon and a picture of its own; the Console pictures checks step aside)");
    }

    /* All games: the picture that ships (img\all-games.png) is the last
       answer, so a copy with none of its own and no LaunchBox has one. */
    const allQ = BASE + "/api/image.php?platform=" + encodeURIComponent("@all") + "&kind=icon";
    const allGot = async () => { const r = await fetch(allQ); return [r.status, Buffer.from(await r.arrayBuffer())]; };
    const shippedAll = fs.readFileSync(path.join(__dirname, "..", "img", "all-games.png"));
    const ownAll = fs.readdirSync(artDir).filter((n) => /^all-icon\.(png|jpe?g|webp|gif)$/i.test(n));
    if (ownAll.length) {
      check("All games wears this copy's own picture where it has one", (await allGot())[1].equals(fs.readFileSync(path.join(artDir, ownAll[0]))), true);
      try {
        await api("api/settings.php", { view: { consoleArt: "xsegon" } });
        check("Xsegon's own puts the All games picture that ships in front of it", (await allGot())[1].equals(shippedAll), true);
      } finally {
        await api("api/settings.php", { view: { consoleArt: "yours" } });
      }
    }
    ownAll.forEach((n) => fs.renameSync(path.join(artDir, n), path.join(artDir, n + ".aside")));
    try {
      const [status, body] = await allGot();
      check("a copy with no All games picture of its own and no LaunchBox gets the one that ships", [status, body.equals(shippedAll)], [200, true]);
    } finally {
      ownAll.forEach((n) => fs.renameSync(path.join(artDir, n + ".aside"), path.join(artDir, n)));
    }
  } finally {
    await api("api/settings.php", { paths: { launchbox: lbPath } });
  }
  const back = await api("api/status.php");
  check("the LaunchBox path is put back as it was", back.checks.launchbox.present, lbPath !== "" && fs.existsSync(lbPath));

  /* The import is proved against a real LaunchBox when this machine has one,
     into the run's own copy, which is put back to no library.json after.
     A machine with no LaunchBox says so and skips. */
  const lbReal = lbPath !== "" ? lbPath : path.join(process.env.USERPROFILE || "", "LaunchBox");
  if (fs.existsSync(path.join(lbReal, "Data", "Platforms.xml"))) {
    const hadLib = fs.existsSync(path.join(DATA, "library.json"));
    try {
      // Games > Bring in a LaunchBox library: the folder is chosen, checked, read and kept.
      await api("api/settings.php", { paths: { launchbox: "" } });
      const notLb = await api("api/import.php", { folder: DATA });
      check("a folder that is not LaunchBox's is refused in words, and nothing is kept",
        [notLb.ok, /not a LaunchBox folder/.test(notLb.error || ""), (await api("api/settings.php")).settings.paths.launchbox], [false, true, ""]);
      const pull = await api("api/import.php", { folder: lbReal });
      check("a pull imports the games", pull.ok && pull.games > 100);
      check("and keeps the folder it was brought in from, for Re-read LaunchBox", (await api("api/settings.php")).settings.paths.launchbox, lbReal);
      check("and copies nothing of LaunchBox's: its answer names no copy", "copies" in pull, false);
      check("read again from the folder kept", (await api("api/import.php", {}, "POST")).ok, true);
    } finally {
      await api("api/settings.php", { paths: { launchbox: lbPath } });
      if (!hadLib) { fs.rmSync(path.join(DATA, "library.json"), { force: true }); }
    }
  } else {
    check("(no LaunchBox on this machine: the import wiring is left to one that has it)", true);
  }
  const on = await api("api/settings.php");
  check("the setting that copied LaunchBox's files across after a pull is gone", "copyAfterImport" in on.defaults.library, false);

  /* Nothing fails without a trace: api\boom.php (test copy only) throws an
     uncaught exception; the page must still get JSON, and the day log the trace. */
  const boomRes = await fetch(BASE + "/api/boom.php");
  const boom = await boomRes.json().catch(() => null);
  check("an uncaught server fault still answers JSON, as a 500 that says what and where to look",
    [boomRes.status, boom && boom.ok, /stand-in fault/.test((boom || {}).error || ""), /the log has the details/.test((boom || {}).error || "")],
    [500, false, true, true]);
  // The log is named by the local day, which is not the UTC one every evening.
  const t = new Date(), day = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
  const dayLog = fs.readFileSync(path.join(DATA, "log", day + ".log"), "utf8");
  check("and the log carries the exception, its place, and the walk to it",
    [/PHPE uncaught RuntimeException: a stand-in fault.*boom\.php:\d+/.test(dayLog), /PHPE   #0 boom\.php:\d+ xs_boom_deep/.test(dayLog)],
    [true, true]);

  /* A warning stays out of the answer, and a fault that ends a request is
     kept for the mailbox: one message a place in the code, counted. Only the
     last fault is left for the mailbox, so it is read after each. */
  {
    /* The faults this test raises are all in api\boom.php; any other kept since
       the group began is a real one, and is named. Older ones came with the copied data. */
    const kept = async () => (await api("api/news.php")).messages.filter((m) => m.kind === "fault");
    const faults = async () => (await kept()).filter((m) => /^While answering boom\.php: /.test(m.body || ""));
    const logNow = () => fs.readFileSync(path.join(DATA, "log", day + ".log"), "utf8");
    check("no fault but the ones raised on purpose has been kept since the group began: nothing in it died by itself",
      (await kept()).filter((m) => !/^While answering boom\.php: /.test(m.body || "") && Date.parse(m.at) >= groupBegan - 2000).map((m) => m.body), []);
    const thrown = await faults();
    check("the fault thrown above is in the mailbox as an error, unread, saying what and where",
      [thrown.length, (thrown[0] || {}).level, (thrown[0] || {}).read, /^While answering boom\.php: a stand-in fault, thrown on purpose \(boom\.php:\d+\)\./.test((thrown[0] || {}).body || "")],
      [1, "error", false, true]);
    const warnRes = await fetch(BASE + "/api/boom.php?warn=1");
    const warned = await warnRes.json().catch(() => null);
    check("a warning never reaches the answer: it is whole, and the warning is in the log",
      [warnRes.status, warned && warned.warned, /PHPE a stand-in warning, raised on purpose at boom\.php:\d+/.test(logNow())], [200, true, true]);
    check("and a warning is not for the mailbox", (await faults()).length, 1);
    const fatalRes = await fetch(BASE + "/api/boom.php?fatal=1");
    const fatal = await fatalRes.json().catch(() => null);
    check("a request out of time answers in words too, as a 500, and the log has it",
      [fatalRes.status, fatal && fatal.ok, /Maximum execution time/.test((fatal || {}).error || ""), /PHPE fatal: Maximum execution time/.test(logNow())],
      [500, false, true, true]);
    check("and it is a second message, for its own place", (await faults()).map((m) => m.times), [1, 1]);
    await fetch(BASE + "/api/boom.php");
    const both = await faults();
    check("the same fault again is the same message, counted and newest first",
      [both.length, /stand-in fault/.test((both[0] || {}).body || ""), (both[0] || {}).times, (both[1] || {}).times], [2, true, 2, 1]);
    for (const m of both) { await api("api/news.php", { action: "delete", id: m.id }); }
    check("deleted, they are not written again by the next look", (await faults()).length, 0);
  }

  /* The window never stays stuck: the app window's status poll is its heartbeat,
     which bin\watchdog.ps1 watches, and a page that will not start asks for a restart. */
  const beat = path.join(DATA, "heartbeat");
  fs.rmSync(beat, { force: true });
  await api("api/running.php");
  const plainPoll = fs.existsSync(beat);
  await api("api/running.php?beat=1");
  check("only the app window's poll is a heartbeat, and it touches data\\heartbeat", [plainPoll, fs.existsSync(beat)], [false, true]);
  const restart = await api("api/window.php", { op: "restart" });
  check("a restart of the window can be asked for, and never happens from the test server", [restart.ok, restart.dry], [true, true]);
  // The window follows its screen (a TV plugged in): the page asks, and bin\open.ps1 -Fit decides.
  const fit = await api("api/window.php", { op: "fit" });
  const noOp = await api("api/window.php", { op: "maximize" });
  check("so can a look at whether the window still fits its screen, with the same lock, and any other word is refused",
    [fit.ok, fit.dry, noOp.ok, noOp.error], [true, true, false, "op must be minimize, close, restart or fit"]);
  /* The fast lane: a second server on the port above, started by the page load,
     for the reads a person waits on. It must be this folder's, refuse everything
     not on its list, say whether the main server is there, and never change data\. */
  await fetch(BASE + "/");
  const lanePort = Number(new URL(BASE).port) + 1, LANE = "http://127.0.0.1:" + lanePort;
  let laneId = null;
  for (let i = 0; i < 40 && !laneId; i++) {
    try { const a = await (await fetch(LANE + "/api/lane.php")).json(); if (a.lane === "fast") { laneId = a.id; } } catch (e) { await new Promise((r) => setTimeout(r, 250)); }
  }
  const mainLane = await api("api/lane.php");
  check("the page load starts the fast lane on the port above, and it is this folder's", [!!laneId, laneId === mainLane.id, mainLane.lane], [true, true, "main"]);
  if (laneId) {
    const refused = await fetch(LANE + "/api/settings.php");
    const refusedPost = await fetch(LANE + "/api/edit.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    check("it refuses everything that is not one of its reads", [refused.status, refusedPost.status], [404, 404]);
    const ran = await (await fetch(LANE + "/api/running.php")).json();
    check("and says whether the main server is there", [ran.ok, ran.mainUp], [true, true]);
    // Every file in data\ before and after its reads: none may change but
    // the log and the heartbeat (a touch, which is the poll's whole point).
    const stampAll = () => {
      const out = {};
      const walk = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, n.name);
        if (n.isDirectory()) { if (!/^(log|thumbs|media|browser-profile|art|runcheck|gamesdb-update)$/.test(n.name)) { walk(p); } }
        else if (!/^(heartbeat|main-busy|fastlane\.json)$/.test(n.name)) { out[p] = fs.statSync(p).mtimeMs + ":" + fs.statSync(p).size; }
      } };
      walk(DATA);
      return out;
    };
    // Caches gone first, so the fast lane meets them out of date as it does in use:
    // a read rebuilding rom-check.json is a write, missed while the main server keeps it fresh.
    const someId = ((await api("api/library.php?limit=1")).games[0] || {}).id;   // asked of the main server, before the snapshot
    fs.rmSync(path.join(DATA, "rom-check.json"), { force: true });
    const logBefore = fs.readFileSync(path.join(DATA, "log", day + ".log"), "utf8").length;
    const before = stampAll();
    // The small reads it took over (the hidden list, What's new, a game's save states) are among them.
    const smallReads = ["/api/hide.php", "/api/changelog.php", "/api/states.php?id=" + encodeURIComponent(someId)];
    const laneSaid = {};
    for (const u of ["/api/library.php", "/api/library.php?sort=platform", "/api/game.php?id=" + encodeURIComponent(someId), "/api/running.php?beat=1", "/api/lane.php"].concat(smallReads)) {
      const res = await fetch(LANE + u);
      if (res.status >= 500) { check("fast lane read " + u + " answered", res.status, 200); }
      if (smallReads.includes(u)) { laneSaid[u] = res.status === 200 ? await res.json() : res.status; }
    }
    const after = stampAll();
    const changed = Object.keys(after).filter((k) => before[k] !== after[k]).concat(Object.keys(before).filter((k) => !(k in after)));
    check("and its reads change no file in data\\", changed.map((f) => path.relative(DATA, f)), []);
    const laneRefusals = fs.readFileSync(path.join(DATA, "log", day + ".log"), "utf8").slice(logBefore)
      .split("\n").filter((l) => /WRIT .*the fast lane never writes/.test(l));
    check("nor even try to: no save refused on its side", laneRefusals, []);
    // Asked of the main server only now: its own reads may write (rom-check.json), which the count above must not see.
    const mainSaid = {};
    for (const u of smallReads) { mainSaid[u] = await api(u.slice(1)); }
    check("the hidden list, What's new and a game's save states read the same from it as from the main server", laneSaid, mainSaid);

    // Its whole job: with the main server held busy for 3 seconds (boom.php?busy, test
    // copy only), a library read through the fast lane answers at once; the main one waits.
    const t0 = Date.now();
    const busy = fetch(BASE + "/api/boom.php?busy=3").then(() => Date.now() - t0);
    await new Promise((r) => setTimeout(r, 200));        // the main server is in the middle of it
    const tf = Date.now();
    const fastRes = await fetch(LANE + "/api/library.php?limit=1");
    const fastMs = Date.now() - tf;
    const tm = Date.now();
    const mainWait = fetch(BASE + "/api/library.php?limit=1").then(() => Date.now() - tm);
    const [busyMs, mainMs] = await Promise.all([busy, mainWait]);
    /* How far the main server is through what it is on: it writes that down as it works and the fast lane
       reads it out for a window's bar. Held two seconds in ten steps; nothing is left after the request. */
    const idle = await (await fetch(LANE + "/api/step.php")).json();
    const stepping = fetch(BASE + "/api/boom.php?busy=2&steps=10").then(() => true);
    const seen = [];
    for (let i = 0; i < 60 && seen.length < 3; i++) {
      await new Promise((r) => setTimeout(r, 150));
      const s = (await (await fetch(LANE + "/api/step.php")).json()).step;
      if (s && !seen.some((x) => x.done === s.done)) { seen.push(s); }
    }
    await stepping;
    const gone = await (await fetch(LANE + "/api/step.php")).json();
    check("the fast lane says how far the main server is through a long request, as it goes, and nothing once it is over",
      [idle.step, seen.length >= 3, seen.every((s) => s.what === "Counting on purpose" && s.total === 10), seen.map((s) => s.done).join(",") === seen.map((s) => s.done).sort((x, y) => x - y).join(","),
       gone.step, fs.existsSync(path.join(DATA, "main-step"))],
      [null, true, true, true, null, false]);
    /* Nothing is cached yet: every answer says no-store, from the main server and the fast lane alike,
       so a browser never hands back an old one; the deleted group proves the server asks the disk afresh. */
    const keptBy = [];
    for (const u of ["api/library.php?limit=1", "api/running.php", "api/settings.php", "api/step.php", "api/jobs.php", "api/gamesdb-update.php", "api/scan.php?folders=1", "api/status.php"]) {
      const r = await fetch(BASE + "/" + u);
      if (r.headers.get("cache-control") !== "no-store") { keptBy.push("main " + u + ": " + r.headers.get("cache-control")); }
    }
    for (const u of ["api/library.php?limit=1", "api/running.php", "api/step.php", "api/game.php?id=" + encodeURIComponent(someId)]) {
      const r = await fetch(LANE + "/" + u);
      if (r.headers.get("cache-control") !== "no-store") { keptBy.push("lane " + u + ": " + r.headers.get("cache-control")); }
    }
    check("no answer may be kept by a browser: every read says no-store, on the main server and on the fast lane", keptBy, []);
    check("with the main server busy for 3s, the fast lane still answers a read at once, and the main server makes it wait",
      [fastRes.status, fastMs < 1500, fastMs < busyMs - 1000, mainMs > 1500],
      [200, true, true, true]);

    /* The main server stuck on one request goes unnoticed while the lane answers
       the poll: so it says what it is on (data/main-busy), and the lane passes on how long. */
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const stuck = fetch(BASE + "/api/boom.php?busy=5");
    await wait(3900);
    const mid = await (await fetch(LANE + "/api/running.php")).json();
    await stuck;
    await wait(400);
    const aft = await (await fetch(LANE + "/api/running.php")).json();
    check("the fast lane says what the main server has been on, and for how long", [(mid.mainBusy || {}).what, (mid.mainBusy || {}).sec >= 3], ["boom.php", true]);
    check("and nothing once it has answered", aft.mainBusy, null);

    /* The lane's minder ends a main server stuck on the same request for -HungSec
       (six seconds here), the lane with it. A stand-in main server, port and data
       folder of its own: nothing of this test server's is touched. */
    const os = require("os"), cp = require("child_process");
    const hungData = fs.mkdtempSync(path.join(os.tmpdir(), "xs-hung-"));
    const standIn = cp.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true });
    try {
      const exe = ((await api("api/status.php")).build || {}).phpExe;
      const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
      fs.writeFileSync(path.join(hungData, "main-busy"), Math.floor(Date.now() / 1000) + "|" + standIn.pid + "|/api/stuck.php");
      await new Promise((res) => cp.execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "..", "bin", "fastlane.ps1"),
        "-Php", exe, "-Port", String(port), "-MainPid", String(standIn.pid), "-HungSec", "6"],
        { env: Object.assign({}, process.env, { XSEGON_DATA: hungData }), timeout: 60000, windowsHide: true }, () => res()));
      await wait(500);
      let alive = true;
      try { process.kill(standIn.pid, 0); } catch (e) { alive = false; }
      const hungLog = fs.existsSync(path.join(hungData, "log")) ? fs.readdirSync(path.join(hungData, "log")).map((f) => fs.readFileSync(path.join(hungData, "log", f), "utf8")).join("") : "";
      const laneLeft = await new Promise((res) => { const c = net.connect(port, "127.0.0.1"); c.on("connect", () => { c.destroy(); res(true); }); c.on("error", () => res(false)); });
      check("a main server stuck on one request is ended by the lane's minder, and the lane with it", [alive, laneLeft], [false, false]);
      check("and the log says what it was stuck on", /LANE the main server has been on .api.stuck[.]php for \d+ minutes and is not coming back: ending it/.test(hungLog), true);
    } finally {
      try { standIn.kill(); } catch (e) { /* already gone */ }
      fs.rmSync(hungData, { recursive: true, force: true });
    }

    /* A fast lane left behind by a main server that has gone is ended by the next
       page load, which starts its own. Last, since it swaps the lane used above. */
    const flFile = path.join(DATA, "fastlane.json");
    const flWas = fs.readFileSync(flFile, "utf8");
    const pidBefore = (await (await fetch(LANE + "/api/lane.php")).json()).pid;
    fs.writeFileSync(flFile, JSON.stringify(Object.assign(JSON.parse(flWas), { mainPid: 999999 })));
    await fetch(BASE + "/");
    let pidAfter = null;
    for (let i = 0; i < 60 && !pidAfter; i++) {
      try { const a = await (await fetch(LANE + "/api/lane.php")).json(); if (a.lane === "fast" && a.pid !== pidBefore) { pidAfter = a.pid; } } catch (e) { /* between lanes */ }
      if (!pidAfter) { await wait(250); }
    }
    check("a fast lane left by an earlier main server is ended, and a new one started", !!pidAfter, true);
    const day2 = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    check("and the log says so", /LANE a fast lane left by an earlier main server \(process 999999\) was still running/.test(fs.readFileSync(path.join(DATA, "log", day2 + ".log"), "utf8")), true);
    check("the new one is noted as this main server's", JSON.parse(fs.readFileSync(flFile, "utf8")).mainPid !== 999999, true);
  }

  /* A background job whose worker has gone is failed at once: the worker writes
     its process id into the job, and Windows is asked. */
  const jobFile = path.join(DATA, "setup-job.json");
  const jobWas = fs.existsSync(jobFile) ? fs.readFileSync(jobFile) : null;
  const longAgo = new Date(Date.now() - 120000);
  const putJob = (o, aged) => { fs.writeFileSync(jobFile, JSON.stringify(Object.assign({ state: "running", kind: "retroarch", started: Math.floor(Date.now() / 1000) }, o))); if (aged) { fs.utimesSync(jobFile, longAgo, longAgo); } };
  try {
    putJob({ pid: process.pid }, true);
    check("a job whose worker is alive is running, however quiet", ((await api("api/setup.php")).job || {}).state, "running");
    putJob({ pid: 999999 }, true);
    const deadJob = (await api("api/setup.php")).job || {};
    check("one whose worker has gone is failed at once, and says why", [deadJob.state, /its worker [(]process 999999[)] is gone/.test(deadJob.error || "")], ["failed", true]);
    putJob({}, false);
    check("one just written, its worker not up yet, is running", ((await api("api/setup.php")).job || {}).state, "running");
    putJob({}, true);
    const neverJob = (await api("api/setup.php")).job || {};
    check("one whose worker never started is failed a minute on", [neverJob.state, /its worker never started/.test(neverJob.error || "")], ["failed", true]);
  } finally {
    if (jobWas === null) { fs.rmSync(jobFile, { force: true }); } else { fs.writeFileSync(jobFile, jobWas); }
  }

  /* Windows reuses a finished process's number, so a live number alone can keep
     a dead job running: the process must also be created by the time the job was,
     asked through FFI; without FFI, alive is alive. Checked on the function itself. */
  {
    const { spawn, execFileSync } = require("child_process");
    const phpExe = (st.build || {}).phpExe;
    const probeFile = path.join(__dirname, "pid-probe.php");
    const probe = (flags, pid, since) => {
      const out = execFileSync(phpExe, flags.concat([probeFile, String(pid), String(since)]),
        { encoding: "utf8", env: Object.assign({}, process.env, { XSEGON_DATA: DATA }), windowsHide: true });
      return JSON.parse(out.slice(out.lastIndexOf("{")));
    };
    const napper = spawn(phpExe, ["-r", "sleep(40);"], { stdio: "ignore", windowsHide: true });
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      let plain = null;
      for (const end = Date.now() + 8000; Date.now() < end;) {
        plain = probe([], napper.pid, nowSec);
        if (plain.alive) { break; }
      }
      check("a process that is alive, kept for something started just now, counts as its worker", plain.alive, true);
      const hasFfi = plain.ffi || fs.existsSync(path.join(path.dirname(phpExe), "ext", "php_ffi.dll"));
      if (!plain.ffi) {
        const blind = probe([], napper.pid, nowSec - 3600);
        check("without FFI Windows cannot be asked when it was created, so nothing changes: still alive", [blind.born, blind.alive], [null, true]);
      }
      if (!hasFfi) {
        console.log("    (this PHP has no FFI; the created-later checks step aside)");
      } else {
        const flags = plain.ffi ? [] : ["-d", "extension=ffi", "-d", "ffi.enable=1"];
        const mine = probe(flags, napper.pid, nowSec);
        check("with FFI, Windows says when the process was created", [mine.ffi, Math.abs((mine.born || 0) - nowSec) < 30, mine.alive], [true, true, true]);
        check("one created an hour after what it was kept for is another program with the same number: not the worker",
              probe(flags, napper.pid, nowSec - 3600).alive, false);
        check("with no start time to compare, alive is alive, as before", probe(flags, napper.pid, 0).alive, true);
        const none = probe(flags, 999999, nowSec);
        check("and no such process is still no", [none.born, none.alive], [null, false]);
      }
    } finally {
      try { napper.kill(); } catch (e) { /* already gone */ }
    }
  }

  const idx = await (await fetch(BASE + "/")).text();
  check("the page carries its start-up watchdog, and the code says when it has started",
    [/the page's code has not started after /.test(idx) && /var WAIT = 45000;/.test(idx), /op: "restart"/.test(idx),
     /window\.XSEGON\.booted = true/.test(fs.readFileSync(path.join(__dirname, "..", "js", "main.js"), "utf8"))], [true, true, true]);

  /* A name or folder outside plain ASCII: a .bat written in one code page and
     read by cmd in another mangles it. The real launcher runs with cmd.exe as the
     emulator, copying the "game": the copy is there only if the name arrived whole. */
  {
    const os2 = require("os"), cp2 = require("child_process");
    const room = fs.mkdtempSync(path.join(os2.tmpdir(), "xs-names-"));
    try {
      const games = path.join(room, "More Roms 100% \u00e9t\u00e9");
      fs.mkdirSync(games); fs.mkdirSync(path.join(room, "data"));
      const arrived = [];
      for (const name of ["b\u00f6bl-1.2.nes", "\u30bc\u30eb\u30c0 (Japan).sfc"]) {
        const rom = path.join(games, name), out = path.join(room, "copied-" + arrived.length + ".out");
        fs.writeFileSync(rom, "x");
        await new Promise((res) => cp2.execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
          path.join(__dirname, "..", "bin", "launch.ps1"), "-Exe", path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"),
          "-Arguments", '/c copy /y "' + rom + '" "' + out + '" >nul', "-Title", "names probe", "-GameId", "names-probe", "-Platform", "Probe",
          "-DataDir", path.join(room, "data"), "-RomPath", rom, "-PlayedFor", "0"], { windowsHide: true }, () => res()));
        arrived.push(fs.existsSync(out));
      }
      const bat = fs.readFileSync(path.join(room, "data", "last-launch.bat"));
      check("the launcher hands a name with accents, and one in Japanese, to the program as it is on the disk", arrived, [true, true]);
      check("its .bat is UTF-8 with no mark at the top, and tells cmd so before the first path",
        [bat.slice(0, 9).toString("latin1"), /^@echo off\r\nchcp 65001 >nul\r\n/.test(bat.toString("utf8")), bat.toString("utf8").includes("\u30bc\u30eb\u30c0 (Japan).sfc")],
        ["@echo off", true, true]);
    } finally {
      fs.rmSync(room, { recursive: true, force: true });
    }
  }
};
