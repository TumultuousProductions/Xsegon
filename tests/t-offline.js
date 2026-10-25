/* When the server stops answering.
 *
 * The kiosk window has no title bar, address bar or tabs, so a page that
 * freezes silently has no way out: a failed poll must put up a screen.
 *
 * Chrome blocks api/status.php, so the page's own fetch really fails as if
 * php.exe had gone. Nothing is stopped and the suite's server is untouched.
 * Close Xsegon is the way out, by keys and the pad, and it closes a real
 * window: a second one opened straight onto the page.
 *
 * It also checks start.ps1 refusing a second server: a second `php -S` on a
 * taken port does not fail on Windows, it takes the listening socket and
 * leaves two servers on one data folder.
 */
"use strict";
const path = require("path");
const { execFileSync } = require("child_process");
const { api, BASE, ROOT, sleep, apiUntil } = require("./lib");

const visible = `!document.getElementById("offline").hidden`;
const text = `(document.getElementById("offline").textContent || "")`;

/* How many processes are listening on Xsegon's port. Counting php.exe would
   be flaky: Xsegon's own jobs start short-lived ones. */
function listeners() {
  const port = new URL(BASE).port || "80";
  const out = execFileSync("powershell", ["-NoProfile", "-Command",
    "(Get-NetTCPConnection -LocalPort " + port + " -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count"],
    { encoding: "utf8" });
  return Number(out.trim());
}

module.exports = async function (b, check) {
  await b.goto(BASE + "/");
  check("the offline screen is not up when all is well", await b.ev(visible), false);

  await b.send("Network.enable");
  await b.send("Network.setBlockedURLs", { urls: ["*api/status.php*", "*api/running.php*"] });   // the full status and the light one

  /* One miss must say nothing: this server answers one request at a time, so
     a poll can be lost while a long media copy runs. */
  await sleep(5000);
  check("one lost poll is not treated as the server going away", await b.ev(visible), false);

  check("three in a row is", await b.waitFor(visible, 20000));

  const said = await b.ev(text);
  check("it says what cannot be reached", said.includes(BASE.replace(/^https?:\/\//, "")));
  check("and that nothing has been lost", /Nothing has been lost/.test(said));
  check("it lists the causes, the first being the window that started it",
    /The window that started it was closed/.test(said));
  check("it names start.ps1 for the case where it was never started", /start\.ps1/.test(said));
  check("it says it is still trying", /Trying again in \d+s/.test(said));
  check("it says the screen clears itself", /goes on its own/.test(said));
  check("there is a button to try now", await b.ev(`!!document.querySelector("#offline button")`));
  check("and the body is marked, so nothing behind it carries on",
    await b.ev(`document.body.classList.contains("offline-now")`));

  /* It must sit over everything, the screensaver included: that comes up
     when nobody is at the machine, when the server is most likely gone. */
  check("it is above every other layer",
    await b.ev(`Number(getComputedStyle(document.getElementById("offline")).zIndex)`) >= 200);

  /* ---- a way out: Close Xsegon, by keys and by the pad ------------------- */
  check("Close Xsegon beside it, so nobody is stuck on this screen",
    await b.ev(`[...document.querySelectorAll("#offline .off-btns button")].map((x) => x.textContent)`), ["Try again now", "Close Xsegon"]);
  const focused = `(document.activeElement || {}).textContent`;
  const wall = `((document.querySelector("#syswall .sel") || {}).textContent || "")`;
  const wallWas = await b.ev(wall);
  await b.key("ArrowRight");
  check("the arrows walk its buttons, and the consoles behind it do not move", [await b.ev(focused), await b.ev(wall)], ["Close Xsegon", wallWas]);
  await b.key("ArrowLeft");
  check("  and back", await b.ev(focused), "Try again now");
  // The page's own close is kept from closing the suite's page; a second window below closes for real.
  await b.ev(`window.__xsClosed = 0; window.close = () => { window.__xsClosed++; }`);
  await b.ev(`window.__ofWas = navigator.getGamepads; window.__ofPad = { id: "stand-in", mapping: "standard", connected: true, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }; navigator.getGamepads = () => [window.__ofPad]`);
  const tap = async (n) => { await b.ev(`window.__ofPad.buttons[${n}].pressed = true`); await sleep(200); await b.ev(`window.__ofPad.buttons[${n}].pressed = false`); await sleep(200); };
  try {
    await tap(15);
    check("the pad's cross walks them too", await b.ev(focused), "Close Xsegon");
    await tap(1);
    check("  B has nothing to go back to: the screen stays", [await b.ev(visible), await b.ev(`window.__xsClosed`)], [true, 0]);
    await tap(0);
    check("  A on Close Xsegon closes the window", await b.ev(`window.__xsClosed`), 1);
  } finally {
    await b.ev(`navigator.getGamepads = window.__ofWas`);
  }
  check("a window that would not close itself says to press Alt+F4",
    await b.until(`!document.querySelector("#offline .off-stayed").hidden`, true, 3000), true);

  // Pressing the button while it is still down must not break anything.
  await b.ev(`document.querySelector("#offline button").click()`);
  await b.until(`/tried \\d+ time/.test(${text})`, true, 4000);
  check("trying again by hand while it is still down keeps the screen", await b.ev(visible));
  check("and counts the attempt", /tried \d+ time/.test(await b.ev(text)));

  /* ---- and it clears itself the moment the server is back --------------- */
  await b.send("Network.setBlockedURLs", { urls: [] });
  check("the screen goes on its own when the server answers", await b.waitFor(`!(${visible})`, 20000));
  check("the mark on the body goes with it",
    await b.ev(`document.body.classList.contains("offline-now")`), false);

  // The page must be usable again, not merely unblocked.
  check("and the page works again", await b.waitFor(`document.querySelectorAll("#status .stat").length > 3`, 8000));

  // The lines it buffered while the server was gone reach the log afterwards.
  await b.ev(`window.dispatchEvent(new Event("blur"))`);
  let lines = "";
  await apiUntil(async () => { lines = ((await api("api/log.php?tail=200")).lines || []).join("\n"); return / P SRV  lost: /.test(lines) && / P SRV  back after \d+ tr/.test(lines); });
  check("losing the server is in the log", / P SRV  lost: /.test(lines));
  check("and so is getting it back", / P SRV  back after \d+ tr/.test(lines));

  /* ---- Close Xsegon closes a real window --------------------------------- */
  /* A second window opened straight onto the page, as bin\open.ps1 opens
     Xsegon's (a browser lets a page close only such a window), with the
     server blocked for it alone; the suite's own page carries on. */
  const debug = "http://127.0.0.1:" + b.port + "/json";
  const tab = await (await fetch(debug + "/new?" + BASE + "/", { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let n = 0;
  const waiting = {};
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting[d.id]) { waiting[d.id](d); delete waiting[d.id]; } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++n; waiting[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const there = async (expr) => ((((await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result || {}).result || {}).value);
  try {
    await send("Network.enable");
    await send("Network.setBlockedURLs", { urls: ["*api/status.php*", "*api/running.php*"] });
    let up = false;
    for (let i = 0; i < 50 && !up; i++) { await sleep(500); up = await there(visible); }
    check("a window of its own, its server gone: the offline screen", up, true);
    await there(`[...document.querySelectorAll("#offline .off-btns button")].find((x) => x.textContent === "Close Xsegon").click()`);
    let gone = false;
    for (let i = 0; i < 20 && !gone; i++) { await sleep(250); gone = !(await (await fetch(debug + "/list")).json()).some((t) => t.id === tab.id); }
    check("  Close Xsegon closes that window", gone, true);
  } finally {
    try { ws.close(); } catch (e) { /* closed with its window */ }
    if ((await (await fetch(debug + "/list")).json()).some((t) => t.id === tab.id)) { await fetch(debug + "/close/" + tab.id); }
  }

  /* ---- start.ps1 will not start a second server ------------------------- */
  check("one server is listening, as there should be", listeners(), 1);
  const out = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass",
    // on the run's own port: the default would start a server on the real data folder
    "-File", path.join(ROOT, "start.ps1"), "-NoBrowser", "-Port", new URL(BASE).port], { encoding: "utf8" });
  check("start.ps1 sees the one that is already running", /ALREADY RUNNING/.test(out));
  check("and says why it will not start another", /two servers on one data folder/.test(out));
  await sleep(800);
  check("it started no second one", listeners(), 1);
  check("and the server the rest of the suite needs is untouched", (await api("api/status.php")).ok);
};
