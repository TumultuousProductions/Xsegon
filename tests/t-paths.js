/* A path is never typed.
 *
 * A typed example path lands on the wrong drive. Every box that holds a
 * folder or a program shows what is set and cannot be typed in: Browse opens
 * the Windows window, and Clear empties it where blank means something.
 * Checked here: Settings > Folders, the emulator table, a game of your own.
 *
 * The test server never opens a window: api/pick-folder.php answers with the
 * folder the sandbox set (XSEGON_PICK_ANSWER), as if it had been chosen.
 */
"use strict";
const { api, apiUntil, BASE, sleep } = require("./lib");

module.exports = async function (b, check) {
  const before = (await api("api/settings.php")).settings.paths;

  /* ---- the window, for a file as well as a folder ----------------------- */
  const asked = await api("api/pick-folder.php", { title: "Choose a program", kind: "file", start: "C:/Somewhere/game.exe" });
  check("paths: a window for choosing a file can be asked for", [asked.ok, asked.started], [true, true]);
  const answer = await api("api/pick-folder.php");
  check("and answers with what was chosen", [answer.state, typeof answer.path], ["done", "string"]);

  /* ---- Settings > Folders ----------------------------------------------- */
  await b.goto(BASE + "/");
  await b.ev(`import("/js/settings-ui.js").then((m) => m.openSettings())`);
  check("Settings opens", await b.waitFor(`document.querySelectorAll("#settings .opt input.path").length >= 3`, 10000));
  const boxes = await b.ev(`[...document.querySelectorAll("#settings .opt input.path")].map((i) => [i.dataset.key, i.readOnly,
    !!i.parentNode.querySelector(".path-browse"), !!i.parentNode.querySelector(".path-clear")])`);
  check("every folder in Settings is a box that cannot be typed in, with Browse and Clear beside it",
    boxes.filter((x) => !(x[1] && x[2] && x[3])), []);
  check("all of them (the LaunchBox folder only where there is a LaunchBox)", boxes.map((x) => x[0]).filter((k) => k !== "launchbox").sort(), ["backupDir", "romRoot", "steam"]);

  const box = `document.querySelector('#settings input[data-key="backupDir"]')`;
  const was = await b.ev(`${box}.value`);
  await b.ev(`${box}.parentNode.querySelector(".path-browse").click()`);
  check("Browse puts the chosen folder in the box", await b.until(`${box}.value`, answer.path, 15000), answer.path);
  check("and it is saved as it is chosen: there is no Save", await apiUntil(async () => (await api("api/settings.php")).settings.paths.backupDir === answer.path), true);
  await b.ev(`${box}.parentNode.querySelector(".path-clear").click()`);
  check("Clear empties it", await b.ev(`${box}.value`), "");
  check("and that is saved too", await apiUntil(async () => (await api("api/settings.php")).settings.paths.backupDir === ""), true);
  await b.ev(`(() => { const i = ${box}; i.value = ${JSON.stringify(was)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);

  /* ---- the emulator table ------------------------------------------------ */
  await b.ev(`[...document.querySelectorAll("#settings .set-tab")].find((t) => /Emulators/.test(t.textContent)).click()`);
  const emu = await b.waitFor(`document.querySelectorAll("#settings .emu-path input").length > 0`, 10000);
  if (emu) {
    check("every emulator's program is a box that cannot be typed in, with Browse beside it",
      await b.ev(`[...document.querySelectorAll("#settings .emu-path input")].filter((i) => !(i.readOnly && i.parentNode.querySelector(".path-browse"))).length`), 0);
  } else {
    console.log("    (no emulators in this copy; their boxes are not checked)");
  }
  // Closing saves the box as it was put back. Nothing differs from what the
  // page was drawn with, so it is not drawn again.
  await b.ev(`window.__xsStayed = true`);
  await b.ev(`[...document.querySelectorAll("#settings .set-head button")].find((x) => x.textContent === "Close (esc)").click()`);
  check("closing Settings saves the box as it was put back", await apiUntil(async () => (await api("api/settings.php")).settings.paths.backupDir === before.backupDir), true);
  await sleep(400);
  check("and the folders are as they were, on the same page", [(await api("api/settings.php")).settings.paths, await b.ev(`window.__xsStayed === true`)], [before, true]);

  /* ---- a game of your own ------------------------------------------------ */
  await b.enterConsole();
  await b.addByHand();
  const run = await b.ev(`[...document.querySelectorAll("#editor input.path")].map((i) => [i.readOnly, !!i.parentNode.querySelector(".path-browse"), !!i.parentNode.querySelector(".path-clear")])`);
  check("the program for a game of your own is chosen with Browse too, never typed", [run.length >= 1, run.every((x) => x[0] && x[1] && x[2])], [true, true]);
  await b.ev(`document.querySelector("#editor input.path").parentNode.querySelector(".path-browse").click()`);
  check("and Browse fills it in", await b.until(`document.querySelector("#editor input.path").value`, answer.path, 15000), answer.path);
  await b.key("Escape");
  await sleep(400);
};
