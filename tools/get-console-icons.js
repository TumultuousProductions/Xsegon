/*  Xsegon's own console icons: RetroArch's, fetched into img\consoles.
    Run from the Xsegon folder:

        node tools\get-console-icons.js                  the pinned version
        node tools\get-console-icons.js --commit <sha>   another one
        node tools\get-console-icons.js --theme flatux   another of
                                                         RetroArch's themes
                                                         (no swaps then)

    LaunchBox's platform icons may not ship, so these are RetroArch's menu
    icons from libretro's retroarch-assets, CC-BY 4.0 (shippable with a
    credit), taken unchanged at the pinned commit. The default theme is
    "retrosystem", with the PSP swapped from "daite" (SWAPS). A console a theme
    has no icon for keeps its glyph. dot-art is never taken: most of its icons
    are a third party's.

    The consoles are those in xs_lr_system (includes\libretro.php), whose
    libretro names are also the icons' names; api\image.php uses the same map.
    Writes img\consoles\<libretro name>.png, sources.json (each file's SHA-256,
    checked by tools\make-test-copy.js) and ABOUT.txt (the credit).
    A picture in data\platform-art comes before these.                      */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "img", "consoles");
const REPO = "libretro/retroarch-assets";
const PINNED = "d9f969054dc7fbb6fa89519036d2b971e0855b51";
const at = process.argv.indexOf("--commit");
const COMMIT = at > 0 ? String(process.argv[at + 1] || "") : PINNED;
if (!/^[0-9a-f]{40}$/.test(COMMIT)) { console.log("--commit wants a full 40-character commit"); process.exit(2); }
const tAt = process.argv.indexOf("--theme");
const THEME_NAME = tAt > 0 ? String(process.argv[tAt + 1] || "") : "retrosystem";
if (!/^[a-z-]+$/.test(THEME_NAME) || THEME_NAME === "dot-art") { console.log("--theme wants one of RetroArch's XMB themes, and not dot-art"); process.exit(2); }
const THEME = "xmb/" + THEME_NAME + "/png";
// A console whose icon is taken from elsewhere: libretro's name => the
// theme and file to take instead, for the default theme only. Each one
// looked at first; a missing one stops the run rather than going quiet.
const SWAPS = {
  retrosystem: { "Sony - PlayStation Portable": { theme: "daite", file: "Sony - PlayStation Portable" } },
}[THEME_NAME] || {};

// The consoles, read out of xs_lr_system's map: every 'Xsegon name' =>
// 'libretro name' pair between the function's head and its return.
const src = fs.readFileSync(path.join(ROOT, "includes", "libretro.php"), "utf8");
const body = (src.split("function xs_lr_system(")[1] || "").split("return $map")[0];
const pairs = [...body.matchAll(/'((?:[^'\\]|\\.)*)'\s*=>\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => [m[1], m[2]]);
if (pairs.length < 20) { console.log("STOP: found only " + pairs.length + " consoles in xs_lr_system (includes\\libretro.php); has it moved?"); process.exit(1); }
// A console that map has no name for, by RetroArch's own name for its icon
// (api\image.php knows it by the same).
const EXTRA = ["Nintendo - Switch"];
const systems = [...new Set(pairs.map((p) => p[1]).concat(EXTRA))].sort();

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const files = {};
  const none = [];
  const aliased = [];
  for (const sys of systems) {
    const swap = SWAPS[sys];
    const where = swap ? "xmb/" + swap.theme + "/png/" + swap.file : THEME + "/" + sys;
    const url = "https://raw.githubusercontent.com/" + REPO + "/" + COMMIT + "/" + where.split("/").map(encodeURIComponent).join("/") + ".png";
    const r = await fetch(url, { headers: { "User-Agent": "Xsegon" } });
    if (r.status === 404 && !swap) { none.push(sys); continue; }
    if (!r.ok) { console.log("STOP: " + url + " answered " + r.status); process.exit(1); }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 100 || buf.toString("latin1", 1, 4) !== "PNG") { console.log("STOP: " + sys + ".png is not a PNG"); process.exit(1); }
    if (swap) { aliased.push(sys + " is " + where + ".png"); }
    fs.writeFileSync(path.join(OUT, sys + ".png"), buf);
    files[sys + ".png"] = Object.assign({ sha256: crypto.createHash("sha256").update(buf).digest("hex"), bytes: buf.length }, swap ? { from: where + ".png" } : {});
    console.log("  " + sys + ".png  " + buf.length + " bytes" + (swap ? "  (" + where + ".png)" : ""));
  }
  // A console the theme has no icon for keeps its glyph, so an icon left
  // from an earlier run (another theme's) goes: the folder holds this run's
  // files and nothing else.
  const gone = fs.readdirSync(OUT).filter((n) => /\.png$/i.test(n) && !files[n]);
  for (const n of gone) { fs.rmSync(path.join(OUT, n)); }
  fs.writeFileSync(path.join(OUT, "sources.json"), JSON.stringify({
    source: "https://github.com/" + REPO + "/tree/" + COMMIT + "/" + THEME,
    commit: COMMIT,
    theme: THEME_NAME,
    licence: "CC-BY-4.0",
    files,
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(OUT, "ABOUT.txt"), [
    "Xsegon's console icons",
    "======================",
    "",
    "The icons the platform sidebar and the console picker show for each",
    "console, and the wheel and the carousel where a console has no other",
    "picture, when you have not chosen one yourself.",
    "",
    "Where they come from",
    "--------------------",
    "RetroArch's menu icons, the XMB \"" + THEME_NAME + "\" theme, by the libretro team",
    "and contributors: https://github.com/" + REPO,
    "Taken unchanged from commit " + COMMIT + ",",
    THEME + ", and used under the Creative Commons Attribution 4.0 International",
    "licence: https://creativecommons.org/licenses/by/4.0/",
    "",
    "They are not covered by Xsegon's MIT licence (the LICENSE file at the top",
    "of Xsegon). Under CC-BY 4.0 you may share and change them, also",
    "commercially, as long as you credit them as above. The consoles' names",
    "and logos are trademarks of their owners; the licence covers the",
    "drawings only.",
    "",
    "sources.json lists each file with its SHA-256, as fetched by",
    "tools\\get-console-icons.js." + (aliased.length ? (aliased.length === 1 ? " This one comes" : " These come") + " from another of the same" : ""),
  ].concat(aliased.length ? ["repository's themes, under the same licence, saved under the console's name:"] : [], [
  ]).concat(aliased.map((a) => "    " + a), [
    "",
    "The All games picture",
    "---------------------",
    "img\\all-games.png, which the console picker and the sidebar show for All",
    "games, is made from three of these icons laid over each other, two of them",
    "tilted, by tools\\make-all-games-icon.ps1 (which names the three). It is a",
    "changed copy of their drawings, under the same licence and credit.",
    "",
    "A picture of your own",
    "---------------------",
    "Right-click a console > Change Pictures, or put a file named",
    "<console>-icon.png in Xsegon\\data\\platform-art. Yours comes first, and",
    "these files are never changed by it.",
    "",
  ]).join("\r\n"));
  console.log(Object.keys(files).length + " icons in img\\consoles from " + REPO + " at " + COMMIT.slice(0, 7) + ", theme " + THEME_NAME +
    (aliased.length ? "\ntaken from another theme: " + aliased.join(", ") : "") +
    (none.length ? "\nno icon in the theme for: " + none.join(", ") + " (those keep their glyph)" : "") +
    (gone.length ? "\ntaken out, from an earlier run: " + gone.join(", ") : "") +
    "\nthe All games picture is made from these: run tools\\make-all-games-icon.ps1 to make it again");
})().catch((e) => { console.log("STOP: " + e.message); process.exit(1); });
