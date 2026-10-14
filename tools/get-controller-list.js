/* Fetch the controller list SDL programs share, for controllers the browser
 * does not know (includes\padlist.php, js\padlist.js).
 *
 *     node tools\get-controller-list.js
 *
 * Takes gamecontrollerdb.txt and its licence (zlib) from
 * github.com/mdqinc/SDL_GameControllerDB as they are, into includes\padlist\.
 * The file is kept whole and unchanged: the licence asks that a changed copy
 * be marked as one. Run it again whenever a newer list is wanted; nothing
 * else needs doing, the list is read as it is asked for.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const FROM = "https://raw.githubusercontent.com/mdqinc/SDL_GameControllerDB/master/";
const TO = path.join(__dirname, "..", "includes", "padlist");
const FILES = [["gamecontrollerdb.txt", "gamecontrollerdb.txt"], ["LICENSE", "LICENSE.txt"]];

(async () => {
  fs.mkdirSync(TO, { recursive: true });
  for (const [name, as] of FILES) {
    const res = await fetch(FROM + name);
    if (!res.ok) { throw new Error(name + ": the server answered " + res.status); }
    const text = await res.text();
    if (name === "gamecontrollerdb.txt" && !text.includes("platform:Windows")) { throw new Error("that is not the list: no Windows lines in it"); }
    fs.writeFileSync(path.join(TO, as), text);
    console.log(as + ": " + text.length + " bytes" + (name === "gamecontrollerdb.txt" ? ", " + (text.match(/platform:Windows/g) || []).length + " Windows controllers" : ""));
  }
})().catch((e) => { console.error("not fetched: " + e.message); process.exit(1); });
