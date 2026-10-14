/* When the server stops answering.
 *
 * The kiosk window has no title bar, address bar or tabs, so a page that
 * freezes silently has no way out: a failed poll must put up a screen.
 *
 * Chrome blocks api/status.php, so the page's own fetch really fails as if
 * php.exe had gone. Nothing is stopped and the suite's server is untouched.
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
