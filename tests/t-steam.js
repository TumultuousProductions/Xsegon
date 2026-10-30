/* Games > Add Steam games.
 *
 * Tested against a fixture Steam, never the real one: a temp folder laid out
 * as Steam lays itself out, with an appinfo.vdf written here in Steam's own
 * binary format (29). paths.steam is pointed at it through the settings API;
 * settings.json and local-games.json are in the Guard, and the pictures this
 * makes in data\art are deleted at the end.
 *
 * The last part runs bin\launch.ps1 for real: a stand-in steam.exe (cmd.exe)
 * starts a stand-in game (ping.exe in the game's folder) and exits at once,
 * as steam.exe does with Steam open, so the launcher must follow the folder.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { api, DATA, ROOT, sleep } = require("./lib");

const FIX = path.join(os.tmpdir(), "xs-steam-fixture");
const GAME = path.join(FIX, "steamapps", "common", "XsSteamGame");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

/* Steam's binary KeyValues, format 29: every key name is an index into one
   table of strings at the end of the file. */
function appinfo(apps) {
  const strings = [], index = new Map();
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
  const key = (k) => { if (!index.has(k)) { index.set(k, strings.length); strings.push(k); } return u32(index.get(k)); };
  function kv(obj) {
    const out = [];
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object") { out.push(Buffer.from([0x00]), key(k), kv(v), Buffer.from([0x08])); }
      else if (typeof v === "number") { const b = Buffer.alloc(4); b.writeInt32LE(v); out.push(Buffer.from([0x02]), key(k), b); }
      else { out.push(Buffer.from([0x01]), key(k), Buffer.from(String(v) + "\0", "utf8")); }
    }
    return Buffer.concat(out);
  }
  const entries = apps.map((a) => {
    const body = Buffer.concat([kv({ appinfo: a.info }), Buffer.from([0x08])]);
    const head = Buffer.alloc(60);                // state, updated, token, two hashes, change number
    return Buffer.concat([u32(a.id), u32(head.length + body.length), head, body]);
  });
  const all = Buffer.concat([...entries, u32(0)]);
  const header = Buffer.alloc(16);
  header.writeUInt32LE(0x07564429, 0);
  header.writeUInt32LE(1, 4);
  header.writeBigInt64LE(BigInt(16 + all.length), 8);
  const table = Buffer.concat([u32(strings.length), ...strings.map((s) => Buffer.from(s + "\0", "utf8"))]);
  return Buffer.concat([header, all, table]);
}

function buildFixture() {
  fs.rmSync(FIX, { recursive: true, force: true });
  const put = (rel, body) => {
    const p = path.join(FIX, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body === undefined ? "x" : body);
  };
  const esc = (p) => p.replace(/\\/g, "\\\\");
  const jpg = fs.readFileSync(path.join(ROOT, "doc", "img", "list-table.jpg"));
  fs.mkdirSync(FIX, { recursive: true });
  fs.copyFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"), path.join(FIX, "steam.exe"));
  put("steamapps/libraryfolders.vdf", `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${esc(FIX)}"\n\t}\n}\n`);
  const manifest = (id, name, dir) => put(`steamapps/appmanifest_${id}.acf`,
    `"AppState"\n{\n\t"appid"\t\t"${id}"\n\t"name"\t\t"${name}"\n\t"installdir"\t\t"${dir}"\n\t"StateFlags"\t\t"4"\n}\n`);
  manifest(990001, "Xsegon Steam Test\u2122", "XsSteamGame");
  manifest(990002, "Xsegon Steam Demo", "XsSteamDemo");
  manifest(990003, "Xsegon Steam Tool", "XsSteamTool");
  manifest(990004, "Xsegon Steam Gone", "XsSteamGone");        // listed, folder not there
  fs.mkdirSync(GAME, { recursive: true });
  fs.copyFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "PING.EXE"), path.join(GAME, "XsSteamGame.exe"));
  put("steamapps/common/XsSteamDemo/Demo.exe");
  put("steamapps/common/XsSteamTool/Tool.exe");
  put("appcache/librarycache/990001/library_600x900.jpg", jpg);
  put("appcache/librarycache/990001/logo.png", PNG);
  put("appcache/librarycache/990001/library_hero.jpg", jpg);
  put("userdata/123/760/remote/990001/screenshots/20260926_1.jpg", jpg);
  const launch = (exe) => ({ "0": { executable: exe, type: "default", config: { oslist: "windows" } } });
  put("appcache/appinfo.vdf", appinfo([
    { id: 990001, info: { appid: 990001, common: { name: "Xsegon Steam Test", type: "Game", steam_release_date: 1700000000 },
                          extended: { developer: "Xs Dev", publisher: "Xs Pub" }, config: { installdir: "XsSteamGame", launch: launch("XsSteamGame.exe") } } },
    { id: 990002, info: { appid: 990002, common: { name: "Xsegon Steam Demo", type: "Demo" }, config: { installdir: "XsSteamDemo", launch: launch("Demo.exe") } } },
    { id: 990003, info: { appid: 990003, common: { name: "Xsegon Steam Tool", type: "Tool" }, config: { installdir: "XsSteamTool", launch: launch("steam://open/tools") } } },
  ]));
}

module.exports = async function (b, check) {
  buildFixture();
  const made = [];                               // ids whose pictures are deleted at the end
  try {
    await api("api/settings.php", { paths: { steam: FIX } });

    /* ---- a Steam folder is one with steamapps in it ------------------------ */
    const wrong = await api("api/settings.php", { paths: { steam: path.join(FIX, "steamapps", "common") } });
    check("a Steam folder with no steamapps in it is refused, saying where Steam's usually is",
      [wrong.ok, /^that is not Steam's folder: it has no steamapps folder in it\. Steam's is usually C:\\Program Files \(x86\)\\Steam, or leave it blank/.test(wrong.error || "")],
      [false, true]);
    check("and the Steam folder stays the one it was",
      String((((await api("api/settings.php")).settings || {}).paths || {}).steam || "").toLowerCase(), FIX.toLowerCase());

    /* ---- a Steam game with nothing to start it ------------------------------
       No steam.exe in the Steam folder and no program in the game's own folder:
       refused with why, not added to fail at Play. A bare app made for this, gone again before the list. */
    const bareDir = path.join(FIX, "steamapps", "common", "XsSteamBare");
    const bareManifest = path.join(FIX, "steamapps", "appmanifest_990005.acf");
    fs.mkdirSync(bareDir, { recursive: true });
    fs.writeFileSync(path.join(bareDir, "readme.txt"), "x");
    fs.writeFileSync(bareManifest, `"AppState"\n{\n\t"appid"\t\t"990005"\n\t"name"\t\t"Xsegon Steam Bare"\n\t"installdir"\t\t"XsSteamBare"\n\t"StateFlags"\t\t"4"\n}\n`);
    fs.renameSync(path.join(FIX, "steam.exe"), path.join(FIX, "steam.exe.away"));
    try {
      const bare = await api("api/steam.php", { app: "990005" }, "POST");
      check("with no steam.exe and no program of its own, a Steam game is not added, and the answer says why",
        [bare.ok, bare.error], [false, "there is nothing to start it with: steam.exe is not in the Steam folder, and neither is a program of the game's own"]);
      check("(so it is not in the library)", ((await api("api/local.php")).games || []).some((e) => e.steamId === "990005"), false);
      const own = await api("api/steam.php", { app: "990001", dry: true }, "POST");
      check("one with a program of its own is still taken without steam.exe, to start by that program",
        [own.ok, own.direct, own.viaSteam], [true, true, false]);
    } finally {
      fs.renameSync(path.join(FIX, "steam.exe.away"), path.join(FIX, "steam.exe"));
      fs.rmSync(bareManifest, { force: true });
      fs.rmSync(bareDir, { recursive: true, force: true });
    }

    /* ---- the list ----------------------------------------------------- */
    const list = await api("api/steam.php");
    check("finds the Steam it is pointed at", list.ok && list.found && list.steam.toLowerCase() === FIX.toLowerCase());
    const app = (id) => (list.apps || []).find((a) => a.id === String(id)) || {};
    check("every installed app, four here", (list.apps || []).length, 4);
    check("Steam's name without the trade mark sign", app(990001).name, "Xsegon Steam Test");
    check("a game is a game, from Steam's own record", app(990001).kind, "game");
    check("a demo is a demo", app(990002).kind, "demo");
    check("a tool is not a game", app(990003).kind, "tool");
    check("and one whose folder has gone is not installed", app(990004).kind, "none");
    check("the pictures Steam keeps, and your screenshot", (app(990001).pictures || []).slice().sort(), ["box", "fanart", "logo", "shot"]);
    check("and it can be played without Steam: its program is where Steam's record says", app(990001).direct, true);
    check("the list does not wait for the Games Database", app(990001).db === undefined);

    // A Steam game added earlier by hand, as a game of your own.
    const mine = await api("api/local.php", { set: { title: "My Demo", platform: "Steam", genre: "Mine",
      run: path.join(FIX, "steamapps", "common", "XsSteamDemo", "Demo.exe") } }, "POST");
    check("(a game of your own in the demo's folder)", mine.ok);
    const again = await api("api/steam.php");
    const demo = (again.apps || []).find((a) => a.id === "990002") || {};
    check("is recognised by its folder, not yet linked", demo.have && demo.have.title === "My Demo" && demo.have.linked === false);

    /* ---- the screen ---------------------------------------------------- */
    await b.goto();
    await b.setView("grid");
    await b.openBar("games");
    await b.menuItem(/Add Steam games/);
    check("Games > Add Steam games opens the list",
          await b.waitFor(`document.querySelectorAll("#editor .st-app").length === 4`, 10000));
    const ticks = await b.ev(`Object.fromEntries([...document.querySelectorAll("#editor .st-app")].map(r => [r.dataset.app, (i => i.disabled ? "off" : i.checked ? "on" : "")(r.querySelector("input"))]))`);
    check("games and demos selected, the tool not, the missing one not selectable", ticks, { 990001: "on", 990002: "on", 990003: "", 990004: "off" });
    check("grouped, games first", await b.ev(`[...document.querySelectorAll("#editor .sc-head b")].map(x => x.textContent)`),
          ["Games", "Demos and playtests", "Not games", "Not installed"]);
    await b.ev(`[...document.querySelectorAll("#editor button")].find(x => x.textContent === "Add the selected games").click()`);
    /* The press closes the window by itself and a bar in the corner counts the games: the strip says the sum
       when they are in, and what each game got is in the log. */
    check("the press closes the window by itself", await b.until(`document.getElementById("editor").hidden`, true, 6000), true);
    check("and the strip says the sum when the games are in",
      await b.waitFor(`/Steam: 1 added, 1 brought up to date/.test((document.getElementById("strip") || {}).textContent || "")`, 30000));
    const dayLogs = () => fs.readdirSync(path.join(DATA, "log")).filter((f) => /^[0-9-]+[.]log$/.test(f)).map((f) => fs.readFileSync(path.join(DATA, "log", f), "utf8")).join(" ");
    let logged = "";
    for (let i = 0; i < 60 && !/steam add over: Done: 1 added, 1 brought up to date/.test(logged); i++) { await sleep(250); logged = dayLogs(); }
    check("the log says where the game's pictures came from", / P ED +steam add: .*: added, 4 from Steam/.test(logged), true);
    check("the hand-added one is linked, not added twice", / P ED +steam add: .*: linked to Steam/.test(logged), true);

    /* ---- what it made ---------------------------------------------------- */
    const entries = (await api("api/local.php")).games || [];
    const g = entries.find((e) => e.steamId === "990001") || {};
    made.push(g.id);
    check("a game of your own, filed under Steam", g.platform, "Steam");
    check("Play goes through Steam", g.run && g.run.toLowerCase().endsWith("\\steam.exe") && g.args === "-applaunch 990001");
    check("its own program kept for Play without Steam", (g.steamExe || "").toLowerCase(), path.join(GAME, "XsSteamGame.exe").toLowerCase());
    check("and the folder the launcher follows", (g.steamDir || "").toLowerCase(), GAME.toLowerCase());
    // (the day itself depends on the time zone PHP is in: 14 November 2023, 22:13 UTC)
    check("details from Steam's record where the database had none", g.developer === "Xs Dev" && g.publisher === "Xs Pub" && /^2023-11-1[45]$/.test(g.released || ""));
    const d = entries.find((e) => e.steamId === "990002") || {};
    made.push(d.id);
    check("the hand-added one keeps its name and genre", d.id === mine.game.id && d.title === "My Demo" && d.genre === "Mine");
    check("and now goes through Steam too, its program kept", /steam\.exe$/i.test(d.run || "") && /Demo\.exe$/i.test(d.steamExe || ""));
    const art = fs.readdirSync(path.join(DATA, "art")).filter((f) => f.startsWith(g.id + "-")).map((f) => f.replace(g.id + "-", "")).sort();
    check("Steam's pictures copied into data\\art", art, ["box.jpg", "fanart.jpg", "logo.png", "shot.jpg"]);
    const lib = await api("api/library.php?platform=Steam");
    const row = (lib.games || []).find((x) => x.id === g.id) || {};
    check("the page is told it is a Steam game that can go without Steam", row.steam, { id: "990001", direct: true });
    check("with its cover, logo, background and screenshot", row.hasArt && row.hasLogo && row.hasFanart && row.hasShot);

    const twice = await api("api/steam.php", { app: "990001" }, "POST");
    check("a second run brings it up to date rather than adding it again",
          twice.ok && twice.added === false && ((await api("api/local.php")).games || []).filter((e) => e.steamId === "990001").length === 1);
    check("and leaves the pictures it has alone", Object.values(twice.pictures || {}).every((v) => v === "already"));

    // The Edit Game form sends what it shows, and a save replaces the entry.
    const form = { title: "Xsegon Steam Test", platform: "Steam", run: g.run, args: g.args, steamExe: g.steamExe, genre: "Racing" };
    await api("api/local.php", { id: g.id, set: form }, "POST");
    const edited = ((await api("api/local.php")).games || []).find((e) => e.id === g.id) || {};
    check("an edit in the form keeps which Steam app it is", edited.genre === "Racing" && edited.steamId === "990001" && !!edited.steamDir);

    /* ---- starting it ------------------------------------------------------ */
    const viaSteam = await api("api/launch.php", { id: g.id, dry: true }, "POST");
    check("Play: through Steam, followed by its folder", viaSteam.ok && viaSteam.viaSteam === true && (viaSteam.follow || "").toLowerCase() === GAME.toLowerCase());
    check("with the launcher told so", / -ViaSteam\b/.test(viaSteam.command || "") && / -WatchDir '/.test(viaSteam.command || ""));
    const direct = await api("api/launch.php", { id: g.id, dry: true, direct: true }, "POST");
    check("Play without Steam: its own program", direct.ok && /XsSteamGame\.exe$/i.test(direct.exe || "") && direct.viaSteam === false);
    check("still followed by its folder, in case it hands over", !!direct.follow && !/-ViaSteam/.test(direct.command || ""));
    const notSteam = ((await api("api/local.php")).games || []).find((e) => !e.steamId);
    if (notSteam) {
      const refused = await api("api/launch.php", { id: notSteam.id, dry: true, direct: true }, "POST");
      check("a game that is not from Steam has no Play without Steam", refused.ok === false && /without Steam/.test(refused.error || ""));
    }

    // The right-click menu, on the grid, once the list has been read again (by itself: the window is closed already).
    const tileSel = `#view .tile[data-id="${g.id}"]`;
    const hasTile = await b.waitFor(`!!document.querySelector(${JSON.stringify(tileSel)}) || [...document.querySelectorAll("#view .tile")].some(t => /Xsegon Steam Test/.test(t.textContent))`, 10000);
    check("the library is read again by itself: the game is on the grid", hasTile);
    if (hasTile) {
      await b.ev(`(t => t.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 700, clientY: 450 })))([...document.querySelectorAll("#view .tile")].find(t => /Xsegon Steam Test/.test(t.textContent)))`);
      await b.waitFor(`!!document.querySelector(".ctx")`, 3000);
      check("right-click offers Play without Steam, ready to press",
            await b.ev(`[...document.querySelectorAll(".ctx-item")].some(n => /Play without Steam/.test(n.textContent) && !n.classList.contains("off"))`));
      await b.key("Escape");
    }

    /* ---- what is here already is not listed, as in Scan for Games ----------- */
    const rowsNow = `[...document.querySelectorAll("#editor .st-app")].map(r => r.dataset.app).sort()`;
    const hereLine = `(document.querySelector("#editor .st-here") || { firstChild: {} }).firstChild.textContent`;
    const pressHere = (words) => b.ev(`(x => x && x.click())([...document.querySelectorAll("#editor .st-here button")].find(x => x.textContent === ${JSON.stringify(words)}))`);
    await b.openBar("games");
    await b.menuItem(/Add Steam games/);
    check("opened again, the two that are in the library are not listed, and a line says how many that is",
          [await b.until(rowsNow, ["990003", "990004"], 10000), await b.ev(hereLine)], [["990003", "990004"], "2 are here already and not listed. "]);
    check("with no game left to add, it says so",
          await b.ev(`[...document.querySelectorAll("#editor .mt-note.good")].some(n => /Every game Steam has installed is here already/.test(n.textContent))`), true);
    await pressHere("Show them");
    check("Show them lists them after all, marked as here already and left unselected",
          [await b.until(rowsNow, ["990001", "990002", "990003", "990004"], 5000),
           await b.ev(`["990001", "990002"].map(id => (r => [/^here already/.test(r.querySelector(".fl-match").textContent), r.querySelector("input").checked])(document.querySelector('#editor .st-app[data-app="' + id + '"]')))`)],
          [["990001", "990002", "990003", "990004"], [[true, false], [true, false]]]);
    await pressHere("Hide them");
    check("and Hide them takes them off the list again", await b.until(rowsNow, ["990003", "990004"], 5000), ["990003", "990004"]);
    await b.ev(`document.querySelector("#editor .set-head button.primary").click()`);
    await sleep(400);

    /* ---- the launcher follows the game by its folder ------------------------ */
    const tmpData = path.join(os.tmpdir(), "xs-steam-launch-data");
    fs.rmSync(tmpData, { recursive: true, force: true });
    fs.mkdirSync(tmpData, { recursive: true });
    const t0 = Date.now();
    const ran = await new Promise((resolve) => {
      // -w 1000: the stand-in is a timer, about 6 seconds whether or not the PC answers its own ping.
      execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "bin", "launch.ps1"),
        "-Exe", path.join(FIX, "steam.exe"), "-Arguments", "/c start /b " + path.join(GAME, "XsSteamGame.exe") + " -n 6 -w 1000 127.0.0.1",
        "-GameId", "xs-steamfollow", "-Title", "Xsegon Steam Test", "-DataDir", tmpData, "-WatchDir", GAME, "-ViaSteam"],
        { timeout: 90000, windowsHide: true }, (err, out) => resolve({ err, out: String(out || "") }));
    });
    const took = (Date.now() - t0) / 1000;
    let session = null;
    try {
      const line = fs.readFileSync(path.join(tmpData, "sessions.jsonl"), "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/).pop();
      session = JSON.parse(line);
    } catch (e) { /* no session written */ }
    check("steam.exe is left to exit, and the game is followed until it closes",
          !!session && session.seconds >= 3 && session.seconds <= 12);
    check("then the session ends 15 seconds on, not at once and not never", !ran.err && took >= 18 && took < 60);
    check("and it is not left marked running", !fs.existsSync(path.join(tmpData, "running.json")));
    fs.rmSync(tmpData, { recursive: true, force: true });

    /* ---- a close is not a crash ---------------------------------------------
       RetroArch's cores often crash on the way out after a normal quit. An
       error code after real play is a close; one straight away is a failure.
       -PlayedFor 2 stands in for the real 10 seconds. cmd.exe is the game. */
    const cmd = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
    const runLauncher = (args, exe = cmd, playedFor = "2") => new Promise((resolve) => {
      execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "bin", "launch.ps1"),
        "-Exe", exe, "-GameId", "xs-exittest", "-Title", "Exit Test", "-DataDir", tmpData, "-PlayedFor", playedFor, "-Log"].concat(args),
        { timeout: 60000, windowsHide: true }, (err, out) => resolve({ err, out: String(out || "") }));
    });
    const lastSession = () => { try { return JSON.parse(fs.readFileSync(path.join(tmpData, "sessions.jsonl"), "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/).pop()); } catch (e) { return null; } };
    const lastError = () => { try { return JSON.parse(fs.readFileSync(path.join(tmpData, "last-error.json"), "utf8").replace(/^\uFEFF/, "")); } catch (e) { return null; } };
    fs.mkdirSync(tmpData, { recursive: true });
    await runLauncher(["-Arguments", "/c exit 7"]);
    check("an error code straight away is still a failure you are told about", /^exited with code 7 after [01]s$/.test((lastError() || {}).error || ""), true);
    await runLauncher(["-Arguments", "/c ping -n 4 127.0.0.1 >nul & exit /b 5"]);
    const played = lastSession();
    check("an error code after real play is taken as a close: no failure shown", lastError(), null);
    check("the session still counts the play and keeps the code", !!played && played.seconds >= 2 && played.exitCode === 5, true);
    const dayLog = fs.readdirSync(path.join(tmpData, "log")).map((f) => fs.readFileSync(path.join(tmpData, "log", f), "utf8")).join("");
    check("and the log says what happened", /end Exit Test \d+s exit 5 \(after \d+s of play: taken as closed, not a failure\)/.test(dayLog), true);

    /* A play that cannot be recorded does not leave the game marked as
       running: the marker goes first, the session write is tried three
       times while another program holds the file, and the log says what was not counted. */
    const sessFile = path.join(tmpData, "sessions.jsonl");
    const sessBefore = fs.readFileSync(sessFile, "utf8");
    const holder = require("child_process").spawn("powershell.exe", ["-NoProfile", "-Command",
      "$f = [System.IO.File]::Open($env:XS_HOLD, 'Open', 'ReadWrite', 'None'); 'held'; Start-Sleep 40; $f.Close()"],
      { env: Object.assign({}, process.env, { XS_HOLD: sessFile }), windowsHide: true });
    try {
      const held = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), 15000);
        holder.stdout.on("data", (d) => { if (/held/.test(String(d))) { clearTimeout(t); resolve(true); } });
      });
      check("(another program takes hold of the play history)", held, true);
      await runLauncher(["-Arguments", "/c ping -n 4 127.0.0.1 >nul"]);
      check("with the play history held, the game is still not left marked as running", fs.existsSync(path.join(tmpData, "running.json")), false);
      const heldLog = fs.readdirSync(path.join(tmpData, "log")).map((f) => fs.readFileSync(path.join(tmpData, "log", f), "utf8")).join("");
      check("the log says the play was not counted, and the launcher did not die", [/could not record this play of Exit Test in sessions[.]jsonl/.test(heldLog), /the launcher died/.test(heldLog)], [true, false]);
    } finally {
      holder.kill();
      await new Promise((r) => setTimeout(r, 600));
    }
    check("and the play history is as it was", fs.readFileSync(sessFile, "utf8"), sessBefore);

    /* Better than the clock: RetroArch is asked (GET_STATUS over its network
       commands). A stand-in RetroArch answers on a port of its own, runs a
       few seconds and exits with an error code. */
    const fakeRa = path.join(tmpData, "fake-retroarch.js");
    fs.writeFileSync(fakeRa, [
      "const [port, status, live, code] = process.argv.slice(2);",
      "const s = require('dgram').createSocket('udp4');",
      "s.on('message', (m, r) => { if (/^GET_STATUS/.test(String(m))) s.send('GET_STATUS ' + status + (status === 'PLAYING' ? ' nintendo_64,Exit Test,crc32=00000000' : '') + '\\n', r.port, r.address); });",
      "s.bind(+port, '127.0.0.1');",
      "setTimeout(() => process.exit(+code), +live);",
    ].join("\n"));
    const port = String(40000 + (process.pid % 20000));
    fs.rmSync(path.join(tmpData, "last-error.json"), { force: true });
    await runLauncher(["-NetPort", port, "-Arguments", `"${fakeRa}" ${port} PLAYING 3000 5`], process.execPath, "30");
    check("RetroArch said it was playing, then an error code: a close, even long before the clock rule", lastError(), null);
    const quick = lastSession();
    check("and that session is counted with its code", !!quick && quick.seconds < 30 && quick.exitCode === 5, true);
    const raLog = fs.readdirSync(path.join(tmpData, "log")).map((f) => fs.readFileSync(path.join(tmpData, "log", f), "utf8")).join("");
    check("the log says RetroArch was asked", /end Exit Test \d+s exit 5 \(RetroArch said it was playing: taken as closed, not a failure\)/.test(raLog), true);
    await runLauncher(["-NetPort", port, "-Arguments", `"${fakeRa}" ${port} CONTENTLESS 4000 5`], process.execPath, "2");
    check("RetroArch answered but never played: a failure, even after the clock rule's time",
          /^the game never started in RetroArch \(exited with code 5 after [3-9]s\)$/.test((lastError() || {}).error || ""), true);
    fs.rmSync(tmpData, { recursive: true, force: true });
  } finally {
    await api("api/settings.php", { paths: { steam: "" } });
    // Out of the library again, so the groups after this one do not find two
    // games added today (local-games.json is put back at the end regardless).
    for (const id of made.filter(Boolean)) {
      await api("api/local.php", { id, remove: true }, "POST");
    }
    for (const id of made.filter(Boolean)) {
      for (const f of fs.readdirSync(path.join(DATA, "art")).filter((n) => n.startsWith(id + "-"))) {
        fs.rmSync(path.join(DATA, "art", f), { force: true });
      }
    }
    fs.rmSync(FIX, { recursive: true, force: true });
  }
};
