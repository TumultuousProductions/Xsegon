// Save states before a launch: the reader over RetroArch's folder, the
// picture, the slot handed to the launch, and the picker on the page.
//
// Reads the real states folder: the checks find a RetroArch game with a
// state rather than naming one (with no states at all the picker checks
// step aside and say so).
"use strict";
const { sleep, api } = require("./lib");

module.exports = async function (b, check) {
  const BASE = require("./lib").BASE;           // the run's own server (tests\sandbox.js)
  const all = (await api("api/library.php")).games || [];

  // a RetroArch game with a state, found by asking; the consoles likeliest
  // to have states come first so the search is short
  let withState = null, asked = 0;
  const order = all.filter((g) => g.playable && !g.local)
                   .sort((x, y) => (/Nintendo 64|Super Nintendo|Game Boy/.test(y.platform) ? 1 : 0) - (/Nintendo 64|Super Nintendo|Game Boy/.test(x.platform) ? 1 : 0));
  for (const g of order) {
    if (asked++ > 120) { break; }
    const st = await api("api/states.php?id=" + g.id);
    if (st.ok && st.states.length) { withState = { g, st }; break; }
  }
  const foreign = all.find((g) => g.playable && !g.local && /Playstation 3|Playstation 2|Xbox/.test(g.platform)) || null;
  check("states endpoint answers", asked > 0);
  check("an unknown game is refused", (await api("api/states.php?id=nope")).ok === false);
  check("a bad id is refused", (await api("api/states.php?id=../x")).ok === false);

  if (!withState) {
    console.log("    (no RetroArch game on this machine has a save state; picker checks skipped)");
    return;
  }
  const { g, st } = withState;
  const first = st.states[0];
  check("a state carries slot, time and size", Number.isInteger(first.slot) && /^\d{4}-\d\d-\d\dT/.test(first.when) && first.size > 0);
  check("newest first", st.states.every((s, i) => i === 0 || st.states[i - 1].at >= s.at));
  check("the hotkey is read from retroarch.cfg", /^[A-Z0-9]+$/.test(st.hotkey));

  // the picture beside it
  const shotOf = st.states.find((s) => s.shot !== null);
  if (shotOf) {
    const r = await fetch(BASE + "/api/states.php?id=" + g.id + "&shot=" + shotOf.slot);
    const buf = Buffer.from(await r.arrayBuffer());
    check("the screenshot streams as a PNG", r.status === 200 && r.headers.get("content-type") === "image/png" && buf.slice(1, 4).toString() === "PNG");
    const again = await fetch(BASE + "/api/states.php?id=" + g.id + "&shot=" + shotOf.slot, { headers: { "If-None-Match": r.headers.get("etag") } });
    check("and comes back 304 when unchanged", again.status === 304);
  }
  const none = await fetch(BASE + "/api/states.php?id=" + g.id + "&shot=999");
  check("a slot with no picture is a 404", none.status === 404);
  check("a bad slot is refused", (await fetch(BASE + "/api/states.php?id=" + g.id + "&shot=abc")).status === 400);

  // the launch, dry: the slot becomes one config line for that run. Keyboard keys
  // set per console (pad-keys.json) add lines of their own, so they are set aside here.
  const keysFile = require("path").join(require("./lib").DATA, "pad-keys.json");
  const keysWas = require("fs").existsSync(keysFile) ? require("fs").readFileSync(keysFile) : null;
  require("fs").writeFileSync(keysFile, "{}");
  const dry = await api("api/launch.php", { id: g.id, slot: first.slot, dry: true });
  check("a dry launch with a slot answers", dry.ok && dry.dry === true && dry.slot === first.slot);
  check("RetroArch is handed --appendconfig with the slot file", /^--appendconfig="[^"]*ra-append\.cfg" /.test(dry.args || ""));
  check("and the launcher is told the slot", /-StateSlot '\d+' -NetPort '\d+'/.test(dry.command || ""));
  const fs = require("fs"), path = require("path");
  const cfg = path.join(require("./lib").DATA, "ra-append.cfg");   // the run's own copy of data
  const cfgLines = fs.existsSync(cfg) ? fs.readFileSync(cfg, "utf8").trim().split(/\r?\n/) : [];
  check("the slot file says state_slot", cfgLines[0], 'state_slot = "' + first.slot + '"');
  /* Xsegon loads the state itself: left to a key press, a picked save
     starts the game from the beginning. The run's settings are kept out of
     retroarch.cfg. */
  /* How the save loads. With network commands on, Xsegon sends the load and
     adds nothing. Off, the person chooses once: on for Xsegon's launches, or
     their own load key. A dry run can act as if off (assumeNetOff), since
     the tests never change retroarch.cfg. */
  const readCfg = () => fs.existsSync(cfg) ? fs.readFileSync(cfg, "utf8").trim().split(/\r?\n/) : [];
  if (st.mode === "network") {
    check("with network commands on, Xsegon loads the save itself", dry.loads, "sent");
    check("and adds nothing to the run but the slot", cfgLines.some((l) => /network_cmd|config_save_on_exit/.test(l)), false);
  }
  check("the picker is told who loads it", st.sends, st.mode === "network" || st.mode === "session");
  await api("api/settings.php", { launch: { stateLoad: "ask" } });
  const askAnswer = await api("api/launch.php", { id: g.id, slot: first.slot, dry: true, assumeNetOff: true });
  check("with them off and no choice made, the launch asks instead of starting", [askAnswer.ok, askAnswer.ask, askAnswer.launched], [true, "stateLoad", null]);
  check("and says which key would load it", /^[A-Z0-9]+$/.test(askAnswer.hotkey || ""), true);
  const sess = await api("api/launch.php", { id: g.id, slot: first.slot, dry: true, assumeNetOff: true, stateLoad: "session" });
  const sessLines = readCfg();
  check("\"just for Xsegon's games\": Xsegon loads it", sess.loads, "sent");
  check("by switching network commands on for that run", sessLines.includes('network_cmd_enable = "true"') && sessLines.some((l) => /^network_cmd_port = "\d+"$/.test(l)), true);
  check("and never saving that into retroarch.cfg", sessLines.includes('config_save_on_exit = "false"'), true);
  check("on the port the launcher is told", /-NetPort '[1-9]\d*'/.test(sess.command || ""), true);
  check("no line said twice", new Set(sessLines).size, sessLines.length);
  const key = await api("api/launch.php", { id: g.id, slot: first.slot, dry: true, assumeNetOff: true, stateLoad: "key" });
  check("\"I'll press the key\": left to the key", key.loads, "hotkey");
  check("and nothing switched on", readCfg().some((l) => /network_cmd|config_save_on_exit/.test(l)), false);
  await api("api/settings.php", { launch: { stateLoad: "session" } });
  const kept = await api("api/launch.php", { id: g.id, slot: first.slot, dry: true, assumeNetOff: true });
  check("a choice kept in Settings answers every launch after", kept.loads, "sent");
  check("and Settings > Launching offers the three", Object.keys((await api("api/settings.php")).schema.launch.stateLoad.options).join(","), "ask,session,key");
  await api("api/settings.php", { launch: { stateLoad: "ask" } });
  const plain = await api("api/launch.php", { id: g.id, dry: true });
  check("a launch without a slot has no slot", plain.ok && plain.slot === null && !/appendconfig/.test(plain.args));
  if (keysWas === null) { fs.rmSync(keysFile, { force: true }); } else { fs.writeFileSync(keysFile, keysWas); }
  // the launcher asks RetroArch whether the game got going (a close is not a crash)
  check("and the launcher is given RetroArch's port only where network commands are on",
        st.mode === "network" ? plain.asks > 0 && /-NetPort '[1-9]\d*'/.test(plain.command) : plain.asks === null && !/-NetPort/.test(plain.command), true);
  check("slot 1000 is refused", (await api("api/launch.php", { id: g.id, slot: 1000, dry: true })).ok === false);
  check("a slot as text is refused", (await api("api/launch.php", { id: g.id, slot: "1", dry: true })).ok === false);
  /* A game whose last start ended at once is asked, the next time, for RetroArch's own log:
     an exit code says that it failed and never why. Every other start is as it was. */
  const errFile = path.join(require("./lib").DATA, "last-error.json");
  const errWas = fs.existsSync(errFile) ? fs.readFileSync(errFile) : null;
  fs.writeFileSync(errFile, JSON.stringify({ at: new Date().toISOString(), gameId: g.id, title: g.title, error: "exited with code 1 after 1s" }));
  const retry = await api("api/launch.php", { id: g.id, dry: true });
  check("after a start that failed at once, the next start of that game asks RetroArch for its own log",
        /(^| )--verbose --log-file="[^"]*retroarch-last\.log" /.test(retry.args || ""), true);   // after any --appendconfig of the game's own
  fs.writeFileSync(errFile, JSON.stringify({ at: new Date().toISOString(), gameId: "another-game", title: "x", error: "exited with code 1 after 1s" }));
  check("and no other game's start is touched by it", /log-file/.test((await api("api/launch.php", { id: g.id, dry: true })).args || ""), false);
  if (errWas === null) { fs.rmSync(errFile, { force: true }); } else { fs.writeFileSync(errFile, errWas); }
  if (foreign) {
    const f = await api("api/launch.php", { id: foreign.id, slot: 0, dry: true });
    check("a slot on a non-RetroArch game is refused", f.ok === false && /RetroArch/.test(f.error || ""));
  }

  // the picker on the page
  await b.goto();
  await b.setView("grid");
  await b.openPlatform(g.platform);
  await b.ev(`(() => { const q = document.getElementById("q"); q.value = ${JSON.stringify(g.title)}; q.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await b.until(`((document.querySelector("#view .tile.sel") || {}).textContent || "").indexOf(${JSON.stringify(g.title.slice(0, 12))}) >= 0`, true, 6000);
  await b.settled();
  const firstTitle = await b.ev(`(document.querySelector("#view .tile.sel") || {}).textContent || ""`);
  check("the search lands on the game", firstTitle.indexOf(g.title.slice(0, 12)) >= 0);
  // the launch itself is stubbed: this must never open RetroArch
  await b.ev(`(() => { window.__realFetch = window.fetch; window.__launches = []; window.fetch = function (u, o) {
      if (String(u).indexOf("api/launch.php") >= 0) { window.__launches.push(JSON.parse(o.body)); return Promise.resolve(new Response(JSON.stringify({ ok: true, launched: "stub", via: "stub", slot: JSON.parse(o.body).slot === undefined ? null : JSON.parse(o.body).slot, loads: "hotkey" }), { headers: { "Content-Type": "application/json" } })); }
      return window.__realFetch(u, o); }; })()`);
  // the picker follows a request (api\states.php), so wait for it rather than
  // guessing how long the server will take
  await b.key("Enter");
  await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "WHERE TO START"`);
  check("Enter opens the picker instead of launching", await b.ev(`(document.querySelector("#editor .panel-title") || {}).textContent`), "WHERE TO START");
  check("no launch was sent yet", await b.ev(`window.__launches.length`), 0);
  const cells = await b.ev(`document.querySelectorAll("#editor .st-cell").length`);
  check("a fresh start plus one tile per state", cells, st.states.length + 1);
  check("the newest save is focused first", await b.ev(`[...document.querySelectorAll("#editor .st-cell")].findIndex(c => c.classList.contains("sel"))`), 1);
  // Made narrow so the saves run past its edge, and put back: the wheel moves them sideways, with a bar under them.
  // Narrowed, the row snaps to the selected save, which can be its far end: so back to its start, two frames, then the wheel.
  check("the mouse wheel moves the saves sideways, with a bar under them",
    await b.ev(`(r => { r.style.maxWidth = "300px"; r.scrollLeft = 0;
      return new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => { const before = r.scrollLeft;
        r.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }));
        setTimeout(() => { const got = [r.scrollWidth > r.clientWidth, r.scrollLeft > before, r.offsetHeight - r.clientHeight >= 10];
          r.style.maxWidth = ""; r.scrollLeft = 0; ok(got); }, 600); }))); })(document.querySelector("#editor .st-row"))`), [true, true, true]);
  if (shotOf) {
    await b.waitFor(`[...document.querySelectorAll("#editor .st-cell img")].some(i => i.naturalWidth > 0)`, 6000);
    check("the screenshot is on the tile", await b.ev(`[...document.querySelectorAll("#editor .st-cell img")].some(i => i.naturalWidth > 0)`));
  }
  await b.shot("states-picker");
  check("the tile says how the state loads", await b.ev(`(document.querySelector("#editor .group-help") || {}).textContent || ""`).then((t) => /press [A-Z0-9]+ once the game is up|loads it once/.test(t)));
  await b.key("ArrowLeft");
  check("Left moves to the fresh start", await b.until(`document.querySelector("#editor .st-cell.sel .st-label").textContent`, "Fresh start"), "Fresh start");
  await b.key("Escape"); await sleep(400);
  check("Esc closes it and launches nothing", await b.ev(`document.getElementById("editor").hidden && window.__launches.length === 0`));

  await b.key("Enter");
  await b.waitFor(`document.querySelectorAll("#editor .st-cell").length > 0`);
  await b.key("Enter");
  await b.until(`window.__launches.length`, 1, 4000);
  await b.until(`document.getElementById("editor").hidden && /on slot/.test(document.getElementById("strip").textContent)`, true, 4000);
  const sent = await b.ev(`window.__launches`);
  check("Enter on the focused save launches with that slot", sent.length === 1 && sent[0].slot === first.slot && sent[0].id === g.id);
  check("the picker is gone", await b.ev(`document.getElementById("editor").hidden`));
  check("the strip says which slot and the key", await b.ev(`document.getElementById("strip").textContent`).then((t) => /on slot \d+, press [A-Z0-9]+ to load it/.test(t)));

  await b.key("Enter");
  await b.waitFor(`document.querySelectorAll("#editor .st-cell").length > 0`);
  await b.key("ArrowLeft");
  await b.until(`document.querySelector("#editor .st-cell.sel .st-label").textContent`, "Fresh start");
  await b.key("Enter");
  await b.until(`window.__launches.length`, 2, 4000);
  await b.until(`document.getElementById("editor").hidden`, true, 4000);
  await b.settled();
  const sent2 = await b.ev(`window.__launches`);
  check("a fresh start launches with no slot", sent2.length === 2 && sent2[1].slot === undefined);

  /* ---- the two doors that view saves without launching ----
     The right-click menu and details, as well as the ask before playing. */
  await b.contextMenu("#view .tile.sel");
  check("the right-click menu offers Save States", await b.ev(`[...document.querySelectorAll(".ctx-item")].some(n => /Save States/.test(n.textContent))`));
  await b.menuItem("/Save States/");
  await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "WHERE TO START"`);
  check("it opens the same picker, launching nothing", await b.ev(`window.__launches.length`), 2);
  await b.key("Escape"); await sleep(400);
  check("and Esc just looked", await b.ev(`document.getElementById("editor").hidden && window.__launches.length === 2`));

  await b.key("i");
  await b.waitFor(`!document.getElementById("details").hidden`);
  await b.waitFor(`document.querySelectorAll("#details .dstates .st-cell").length > 0`, 8000);
  check("details lists the saves under the game", await b.ev(`document.querySelectorAll("#details .dstates .st-cell").length`), st.states.length);
  // Under Play come the tabs, and the saves are the first thing in About.
  check("straight under Play and the tabs (the More row hidden), in the right column", await b.ev(`(n => !!n && n.classList.contains("dst-wrap") && !!n.querySelector(".dstates"))(document.querySelector("#details .dright .bar + .dtabs + .dparts[hidden] + .dtab-pane.is-about").firstElementChild)`), true);
  check("each one says its slot", await b.ev(`[...document.querySelectorAll("#details .dstates .st-label")].every(n => /^Slot \\d+$/.test(n.textContent))`));
  await b.ev(`document.querySelector("#details .dstates .st-cell").click()`);
  await b.until(`window.__launches.length`, 3, 4000);
  await b.until(`document.getElementById("details").hidden`, true, 4000);
  const sent3 = await b.ev(`window.__launches`);
  check("one press on a save plays from that slot", sent3.length === 3 && sent3[2].slot === first.slot && sent3[2].id === g.id);
  check("and details closed on the way out", await b.ev(`document.getElementById("details").hidden`));

  /* ---- the strip is contained ----
     At most three tiles, a third of the column each, and a door to the
     picker for the rest, so it never pushes over the rest. Proved with six
     invented saves. */
  await b.ev(`(() => { window.__rf2 = window.fetch; window.fetch = function (u, o) {
      if (String(u).indexOf("api/states.php") >= 0 && String(u).indexOf("shot=") < 0) {
        const states = [5,4,3,2,1,0].map(n => ({ slot: n, when: "2026-09-1" + n + "T12:00:00+00:00", size: 1000, shot: null }));
        return Promise.resolve(new Response(JSON.stringify({ ok: true, states, hotkey: "F4", sends: false, auto: false }), { headers: { "Content-Type": "application/json" } }));
      }
      return window.__rf2(u, o); }; })()`);
  await b.key("i");
  await b.waitFor(`document.querySelectorAll("#details .dstates .st-cell").length > 0`, 8000);
  check("six saves show as three and a door", await b.ev(`document.querySelectorAll("#details .dstates .st-cell").length`), 3);
  check("the door names them all", await b.ev(`(document.querySelector("#details .dst-more") || {}).textContent`), "All 6 saves...");
  check("the strip stays inside its column", await b.ev(`(s => s.scrollWidth <= s.clientWidth + 1)(document.querySelector("#details .dstates"))`));
  await b.ev(`document.querySelector("#details .dst-more").click()`);
  await b.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "WHERE TO START"`);
  check("the door opens the picker with every save", await b.ev(`document.querySelectorAll("#editor .st-cell").length`), 7);
  check("and looking launched nothing new", await b.ev(`window.__launches.length`), 3);
  await b.key("Escape"); await sleep(400);
  await b.ev(`window.fetch = window.__rf2`);

  // the log tells the story
  const tail = await api("api/log.php?tail=200");
  const lines = tail.lines || [];
  check("MNU: the picker and the pick are logged", lines.some((l) => / P MNU\s+states /.test(l)) && lines.some((l) => / P MNU\s+run slot \d+/.test(l)));
  check("LNCH: the ask names the slot", lines.some((l) => / P LNCH\s+ask .* slot \d+/.test(l)));

  await b.ev(`window.fetch = window.__realFetch`);
  await b.ev(`(() => { const q = document.getElementById("q"); q.value = ""; q.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(500);

  /* ---- the question, on the page ----
     launch.php is stubbed to ask, the way it answers with network commands
     off and no choice made. "Open RetroArch" is never pressed: it would open
     a real RetroArch on screen. */
  await b.goto();
  await b.setView("grid");
  await b.openPlatform(g.platform);
  await b.ev(`(() => { window.__asks = []; const f = window.fetch; window.__rf3 = f; window.fetch = function (u, o) {
    if (String(u).indexOf("api/launch.php") >= 0) { const bd = JSON.parse(o.body); window.__asks.push(bd);
      const r = bd.stateLoad ? { ok: true, launched: "stub", via: "stub", slot: bd.slot, loads: bd.stateLoad === "key" ? "hotkey" : "sent" }
                             : { ok: true, ask: "stateLoad", launched: null, slot: bd.slot, hotkey: "F4" };
      return Promise.resolve(new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json" } })); }
    return f.apply(window, arguments); }; })()`);
  const askTitle = `(document.querySelector("#editor .panel-title") || {}).textContent || ""`;
  const askButtons = `[...document.querySelectorAll("#editor .st-ask-bar button")].map(x => x.textContent)`;
  await b.ev(`(async () => { const St = await import("/js/state.js"), La = await import("/js/launch.js"); La.launchNow(St.games[St.sel], ${first.slot}); })()`);
  check("picking a save with network commands off asks how it should load", await b.until(askTitle, "LOADING YOUR SAVE"), "LOADING YOUR SAVE");
  check("with the three answers, the best first", await b.ev(askButtons), ["Show me how to turn it on", "Turn it on just for Xsegon's games", "I'll press F4 myself"]);
  check("and nothing started yet", await b.ev(`window.__asks.length`), 1);
  await b.ev(`[...document.querySelectorAll("#editor .st-ask-bar button")][0].click()`);
  check("Show me how gives the steps", await b.until(askTitle, "TURN ON NETWORK COMMANDS"), "TURN ON NETWORK COMMANDS");
  check("with a button that opens RetroArch, and a way to play now", await b.ev(askButtons), ["Open RetroArch", "Play now, I'll press F4", "Back"]);
  await b.ev(`[...document.querySelectorAll("#editor .st-ask-bar button")].find(x => x.textContent === "Back").click()`);
  check("Back returns to the question", await b.until(askTitle, "LOADING YOUR SAVE"), "LOADING YOUR SAVE");
  await b.key("Escape");
  check("Esc puts it away and starts nothing", await b.until(`document.getElementById("editor").hidden && window.__asks.length === 1`), true);
  await b.ev(`(async () => { const St = await import("/js/state.js"), La = await import("/js/launch.js"); La.launchNow(St.games[St.sel], ${first.slot}); })()`);
  await b.until(askTitle, "LOADING YOUR SAVE");
  await b.ev(`[...document.querySelectorAll("#editor .st-ask-bar button")].find(x => /press F4 myself/.test(x.textContent)).click()`);
  check("an answer starts the game that way", await b.until(`(a => a.length === 3 && a[2].stateLoad)(window.__asks)`, "key"), "key");
  check("and is kept, so it is not asked again", await (async () => { for (let i = 0; i < 40; i++) { if ((await api("api/settings.php")).settings.launch.stateLoad === "key") { return true; } await sleep(50); } return false; })(), true);
  await b.ev(`window.fetch = window.__rf3`);
  await api("api/settings.php", { launch: { stateLoad: "ask" } });

  /* ---- the bottom line after a game ---------------------------------------
     "playing X" must come down when the game ends: it becomes "Finished X ·
     time" for a few seconds. The launcher's running.json is written and
     removed by hand here, which is all the page ever sees of a game. */
  const DATA = require("./lib").DATA;
  const runFile = path.join(DATA, "running.json");
  const stripText = `(document.getElementById("strip").hidden ? "" : document.getElementById("strip").textContent)`;
  const play = (title) => fs.writeFileSync(runFile, JSON.stringify({ gameId: "xs-finish-test", title, platform: "Test",
                                                                      startedAt: new Date(Date.now() - 125000).toISOString() }));
  await api("api/settings.php", { launch: { showFinished: true } });
  await b.goto();
  try {
    const light = await api("api/running.php");
    check("the light status answers only what changes", [light.ok, light.light, "running" in light, "error" in light, Array.isArray(light.damaged), "counts" in light], [true, true, true, true, true, false]);
    play("Xsegon Finish Test");
    check("a running game says playing", await b.until(`/playing Xsegon Finish Test/.test(${stripText})`, true, 9000), true);
    check("and the page asks the light status for it, not the full one every time",
          await b.ev(`performance.getEntriesByType("resource").some(e => /api\\/running\\.php/.test(e.name))`), true);
    // That first notice is left to the page's own four second clock: the proof it looks by itself.
    // From here the look is asked for by hand (as tests\t-news.js does), so nothing waits on the clock.
    const look = () => b.ev(`import("/js/status.js").then((m) => { m.pollStatus(); })`);
    fs.rmSync(runFile, { force: true });
    await look();
    check("when it ends: Finished, with the time played", await b.until(`/Finished Xsegon Finish Test\\s+·\\s+2 min/.test(${stripText})`, true, 9000), true);
    check("with a close and a Don't show again", await b.ev(`[...document.querySelectorAll("#strip button")].map(x => x.textContent).join(",")`), "Don't show again,Clear");
    check("and it goes by itself", await b.until(`document.getElementById("strip").hidden`, true, 7000), true);

    // A game that ended before the poll ever saw it: "running: X" from
    // pressing Play is still taken down, 20 seconds on.
    await b.ev(`(async () => { const La = await import("/js/launch.js"); La.showStrip("running: Xsegon Quick Test  (RetroArch)", false);
                               document.getElementById("strip").dataset.kind = "running";
                               La.watchGame("Xsegon Quick Test", null, false); La.watched.game.at = Date.now() - 21000; })()`);
    await look();
    check("a game too quick for the poll is still taken down", await b.until(`/Finished Xsegon Quick Test/.test(${stripText})`, true, 9000), true);

    // Don't show again: the setting goes off, and the next game ends quietly.
    play("Xsegon Finish Test");
    await look();
    await b.until(`/playing Xsegon Finish Test/.test(${stripText})`, true, 9000);
    fs.rmSync(runFile, { force: true });
    await look();
    await b.until(`/Finished Xsegon Finish Test/.test(${stripText})`, true, 9000);
    await b.ev(`[...document.querySelectorAll("#strip button")].find(x => x.textContent === "Don't show again").click()`);
    check("Don't show again turns the setting off", await (async () => { for (let i = 0; i < 40; i++) { if ((await api("api/settings.php")).settings.launch.showFinished === false) { return true; } await sleep(50); } return false; })(), true);
    play("Xsegon Finish Test");
    await look();
    await b.until(`/playing Xsegon Finish Test/.test(${stripText})`, true, 9000);
    fs.rmSync(runFile, { force: true });
    await look();
    check("after that, the next game's end just clears the bottom line", await b.until(`document.getElementById("strip").hidden`, true, 9000), true);
    check("with no Finished", await b.ev(`/Finished/.test(document.getElementById("strip").textContent) && !document.getElementById("strip").hidden`), false);
  } finally {
    fs.rmSync(runFile, { force: true });
    await api("api/settings.php", { launch: { showFinished: true } });
  }
};
