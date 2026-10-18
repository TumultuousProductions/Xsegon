/*  Xsegon - each cartridge release a fan project names, given its size and CRC32
    (includes\fanprojects\projects.json), so the page finds a copy whose title
    does not match: a .zip by the CRC32 in its own listing, a small file read whole.

        node tools\fan-sums.js

    The sizes and CRC32s come from libretro's No-Intro lists, the ones the file
    check reads. Only the match lines change ("size" and "crc" put in after
    "name"); the rest of the file is left as it is written. Run again after
    adding projects. A release the list does not have is named, and left alone. */
"use strict";
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "includes", "fanprojects", "projects.json");
const BASE = "https://raw.githubusercontent.com/libretro/libretro-database/master/metadat/no-intro/";
// Xsegon's console names to libretro's, as includes\libretro.php has them, for the consoles the file check reads.
const SYS = {
  "Nintendo Entertainment System": "Nintendo - Nintendo Entertainment System",
  "Super Nintendo Entertainment System": "Nintendo - Super Nintendo Entertainment System",
  "Nintendo 64": "Nintendo - Nintendo 64", "Nintendo Game Boy": "Nintendo - Game Boy",
  "Nintendo Game Boy Color": "Nintendo - Game Boy Color", "Nintendo Game Boy Advance": "Nintendo - Game Boy Advance",
  "Nintendo DS": "Nintendo - Nintendo DS", "Sega Genesis": "Sega - Mega Drive - Genesis", "Sega 32X": "Sega - 32X",
};

async function main() {
  let text = fs.readFileSync(FILE, "utf8");
  const wanted = {};
  for (const p of JSON.parse(text).projects) {
    for (const m of p.base.match) {
      if (m.name && SYS[m.console]) { (wanted[m.console] = wanted[m.console] || new Set()).add(m.name); }
    }
  }
  let put = 0;
  const missing = [];
  for (const [console_, names] of Object.entries(wanted)) {
    const r = await fetch(BASE + encodeURIComponent(SYS[console_]) + ".dat");
    if (!r.ok) { throw new Error(SYS[console_] + ".dat: HTTP " + r.status); }
    const dat = await r.text();
    const sums = {};
    for (const m of dat.matchAll(/rom \( name "((?:[^"\\]|\\.)*)" size (\d+) crc ([0-9A-Fa-f]{8})/g)) {
      sums[m[1].replace(/\.[A-Za-z0-9]{2,4}$/, "")] = { size: Number(m[2]), crc: m[3].toLowerCase() };
    }
    for (const name of names) {
      const s = sums[name];
      if (!s) { missing.push(console_ + ": " + name); continue; }
      // The line as written, with or without the two from an earlier run.
      const esc = JSON.stringify(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp('("console": ' + JSON.stringify(console_).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ', "name": ' + esc + ',)( "size": \\d+, "crc": "[0-9a-f]{8}",)?', "g");
      text = text.replace(re, (all, head) => { put++; return head + ' "size": ' + s.size + ', "crc": "' + s.crc + '",'; });
    }
  }
  JSON.parse(text);                          // still whole before it is written
  fs.writeFileSync(FILE + ".tmp", text);
  fs.renameSync(FILE + ".tmp", FILE);
  console.log("sizes and CRC32s on " + put + " match lines");
  if (missing.length) { console.log("not in libretro's lists, left alone:\n  " + missing.join("\n  ")); }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
