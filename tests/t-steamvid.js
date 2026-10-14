/* Pictures & Videos > Steam trailers (includes\steamvid.php, bin\steamvid.ps1).
 *
 * Against stand-ins for Steam's store API and video server that
 * tests\sandbox.js points the test server at: this group writes one answer
 * per app and one small "trailer" per movie, so each way a game can end is
 * walked for real through the background fetcher: saved, no trailer on
 * Steam, stream only (ffmpeg is switched off on the test server), and a
 * failed ask. Nothing is fetched from Steam. Against --live only the
 * read-only first check runs.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { api, sleep, Guard } = require("./lib");

module.exports = async function (b, check) {
  const lib = require("./lib");
  const DATA = lib.DATA, BASE = lib.BASE;
  const first = await api("api/steamvid.php");
  check("the Steam trailers list answers, one row per Steam game", first.ok && first.games.length > 0 && first.games.every((g) => /^\d+$/.test(g.appid)), true);
  const steamFx = path.join(DATA, "fixtures", "steam");
  if (!fs.existsSync(steamFx)) {
    check("(live server: the fetch half is left to the test server)", true);
    return;
  }
  check("every game without a video counted", first.missing, first.games.filter((g) => !g.has).length);
  check("the test server has no ffmpeg, as told", first.ffmpeg, false);

  const vdir = path.join(DATA, "videos-steam");
  const own = path.join(DATA, "video-own");
  const guard = new Guard(["steamvid-job.json"]);
  const free = first.games.filter((g) => !g.has);
  const [A, B, C, D] = free;
  let ownMade = null;
  try {
    const write = (appid, obj) => fs.writeFileSync(path.join(steamFx, "api", appid + ".json"), JSON.stringify({ [appid]: obj }));
    write(A.appid, { success: true, data: { movies: [{ id: 900001, name: "not this one" }, { id: 900002, name: "Launch Trailer", highlight: true }] } });
    fs.writeFileSync(path.join(steamFx, "cdn", "900002.mp4"), "stand-in trailer bytes\r\n");
    fs.writeFileSync(path.join(steamFx, "cdn", "900001.mp4"), "the wrong trailer\r\n");
    write(B.appid, { success: true, data: {} });
    write(C.appid, { success: true, data: { movies: [{ id: 900003, highlight: true, hls_h264: "http://127.0.0.1:9/none.m3u8" }] } });
    // D has no answer at all: the ask fails.

    const dry = await api("api/steamvid.php", { ids: [A.id, B.id, C.id, D.id, "not-a-steam-game"], dry: true });
    check("a dry run plans only Steam games without a video", dry.ok && dry.plan.games.map((g) => g.id), [A.id, B.id, C.id, D.id]);
    check("and starts nothing", fs.existsSync(path.join(DATA, "steamvid-job.json")), false);
    const go = await api("api/steamvid.php", { ids: [A.id, B.id, C.id, D.id] });
    check("fetching starts in the background", [go.ok, go.count], [true, 4]);
    let st = null;
    for (const end = Date.now() + 30000; Date.now() < end;) {
      st = await api("api/steamvid.php");
      if (st.job && st.job.state !== "running") { break; }
      await sleep(200);
    }
    const states = Object.fromEntries(((st.job && st.job.games) || []).map((g) => [g.id, g.state]));
    check("and finishes", st.job && st.job.state, "done");
    check("a game with a trailer gets it saved", states[A.id], "done");
    check("the highlighted trailer, not just the first", fs.existsSync(path.join(vdir, A.id + ".mp4")) && fs.readFileSync(path.join(vdir, A.id + ".mp4"), "utf8").startsWith("stand-in trailer"), true);
    check("a game with none on Steam is said, not failed", states[B.id], "none");
    check("one Steam only streams is marked as needing ffmpeg", states[C.id], "stream");
    check("a failed ask is its own answer", states[D.id], "failed");
    check("nothing half-downloaded is left", fs.readdirSync(vdir).filter((f) => !f.endsWith(".mp4")), []);
    const rowA = st.games.find((g) => g.id === A.id);
    check("the saved trailer is now that game's video", [rowA.has, rowA.trailer], [true, true]);
    check("and one fewer is missing", st.missing, first.missing - 1);
    const served = await fetch(BASE + "/api/video.php?id=" + encodeURIComponent(A.id));
    check("it plays as the game's video snap", [served.status, (served.headers.get("content-type") || "").split(";")[0]], [200, "video/mp4"]);
    /* The address hover actually plays: the library row's videoUrl, a plain
       /files/ address that router.php must allow. api/video.php working
       above does not prove it. */
    const libAll = await api("api/library.php");
    const libA = libAll.games.find((g) => g.id === A.id);
    check("the library says that game has a video now", libA && libA.hasVideo, true);
    const hover = libA && libA.videoUrl ? await fetch(BASE + "/" + libA.videoUrl, { headers: { Range: "bytes=0-9" } }) : { status: 0, headers: new Map() };
    check("and the address hover plays from answers with the video", [hover.status, (hover.headers.get("content-type") || "").split(";")[0]], [206, "video/mp4"]);
    const again = await api("api/steamvid.php", { ids: [A.id] });
    check("a game that has a video is never fetched again", again.ok, false);

    fs.mkdirSync(own, { recursive: true });
    ownMade = path.join(own, A.id + ".mp4");
    fs.writeFileSync(ownMade, "a video chosen by hand\r\n");
    const withOwn = await api("api/steamvid.php");
    check("a video you chose wins over the trailer", withOwn.games.find((g) => g.id === A.id).trailer, false);
    fs.rmSync(ownMade, { force: true });
    ownMade = null;

    /* ---- the screen ---- */
    await b.goto();
    await b.setView("grid");
    await b.openBar("media");
    await b.menuItem(/Steam trailers/);
    const title = `(document.querySelector("#editor .panel-title") || {}).textContent || ""`;
    check("Pictures & Videos > Steam trailers opens the list", await b.until(title, "STEAM TRAILERS"), "STEAM TRAILERS");
    await b.until(`document.querySelectorAll("#editor .sv-row").length`, first.games.length);
    const rowOf = (id) => `[...document.querySelectorAll("#editor .sv-row")].find(r => r.querySelector("input").value === ${JSON.stringify(id)})`;
    check("a game with its trailer saved says so and cannot be selected", await b.ev(`(r => [r.querySelector(".sv-state").textContent, r.querySelector("input").disabled])(${rowOf(A.id)})`), ["trailer saved", true]);
    check("the last run's answers are shown on the rest", await b.ev(`${rowOf(B.id)}.querySelector(".sv-state").textContent`), "no trailer on Steam");
    await b.ev(`[...document.querySelectorAll("#editor .sv-bar button")].find(x => /Fetch/.test(x.textContent)).click()`);
    const ask = `(document.querySelector(".setup-confirm h2") || {}).textContent || ""`;
    check("Fetch asks first, saying how many", await b.until(`/^Fetch \\d+ trailers\\?$/.test(${ask})`), true);
    check("with how big, from where and into which folder", await b.ev(`(() => { const t = document.querySelector(".setup-confirm").textContent; return /GB/.test(t) && /store\\.steampowered\\.com/.test(t) && t.includes(${JSON.stringify(vdir)}); })()`), true);
    const jobBefore = fs.readFileSync(path.join(DATA, "steamvid-job.json"), "utf8");
    await b.key("Escape");
    check("Esc says no and starts nothing", await b.until(`!document.querySelector(".setup-confirm")`) && fs.readFileSync(path.join(DATA, "steamvid-job.json"), "utf8") === jobBefore, true);
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`);
  } finally {
    if (ownMade) { fs.rmSync(ownMade, { force: true }); }
    fs.rmSync(vdir, { recursive: true, force: true });
    for (const d of ["api", "cdn"]) { for (const f of fs.readdirSync(path.join(steamFx, d))) { fs.rmSync(path.join(steamFx, d, f), { force: true }); } }
    guard.restore();
  }
};
