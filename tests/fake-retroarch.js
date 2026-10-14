/*  A stand-in RetroArch for the runs check's tests (tests\t-runcheck.js).

        node fake-retroarch.js <port> <mode> <screenshot folder> <log folder>

    It answers RetroArch's network commands the way the real one does
    (GET_STATUS, SCREENSHOT, QUIT) and behaves as <mode> says:

      play     playing after a moment; a screenshot is a picture; QUIT ends it
      blank    the same, but the screenshot is all black
      menu     the same, but the screenshot is blue like the PlayStation's
               own menu (where its BIOS goes when a disc does not start)
      crash    playing, then gone by itself with an error code
      nostart  answers, never plays (a game that sits in RetroArch's menu)
      exit     writes RetroArch's error for a missing BIOS and closes at once
      silent   never answers at all
      cold     deaf the first time it is started on its port, playing after
               (RetroArch's first start on a PC, slower than the check waits)

    Nothing real is started, and it writes only into the two folders given. */
"use strict";
const fs = require("fs");
const path = require("path");
const dgram = require("dgram");

const [port, mode, shotDir, logDir] = process.argv.slice(2);
const PNG = {
  play: "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAAEnQAABJ0Ad5mH3gAAAH1SURBVDhPFczBFEUhAADRhxBCCCGEEEIIIYQQQgghtJxlCCFkMP/8C3C/78PwYfwwfZg/LB/WD9uH/cPx4fxwfbg/PB/eD9+H3xcwBIwBU8AcsASsAVvAHnAEnAFXwB3wBLwBX/gHEUPEGDFFzBFLxBqxRewRR8QZcUXcEU/EG/HFf5AwJIwJU8KcsCSsCVvCnnAknAlXwp3wJLwJX/oHGUPGmDFlzBlLxpqxZewZR8aZcWXcGU/Gm/Hlf1AwFIwFU8FcsBSsBVvBXnAUnAVXwV3wFLwFX/kHFUPFWDFVzBVLxVqxVewVR8VZcVXcFU/FW/HVf9AwNIwNU8PcsDSsDVvD3nA0nA1Xw93wNLwNX/sHHUPH2DF1zB1Lx9qxdewdR8fZcXXcHU/H2/H1fzAwDIwD08A8sAysA9vAPnAMnAPXwD3wDLwD3/gHE8PEODFNzBPLxDqxTewTx8Q5cU3cE8/EO/HNf7AwLIwL08K8sCysC9vCvnAsnAvXwr3wLLwL3/oHG8PGuDFtzBvLxrqxbewbx8a5cW3cG8/Gu/Htf3AwHIwH08F8sBysB9vBfnAcnAfXwX3wHLwH3/kHF8PFeDFdzBfLxXqxXewXx8V5cV3cF8/Fe/Hdf/AwPIwP08P8sDysD9vD/nA8nA/Xw/3wPLwP38Mfctm3H7PXMlMAAAAASUVORK5CYII=",
  blank: "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAAEnQAABJ0Ad5mH3gAAAAzSURBVDhPpcihEQAwEASh67/pTwGrmAgM23afEiqhEiqhEiqhEiqhEiqhEiqhEiqhEuQBm8z/Adxo4dwAAAAASUVORK5CYII=",
  menu: "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGMQEXFDRjZul/AjhlENoxqGrwYAkxsMMLlh4usAAAAASUVORK5CYII=",
};

function raLog(line) {
  try { fs.appendFileSync(path.join(logDir, "retroarch.log"), line + "\n"); } catch (e) { /* no folder: no log */ }
}

if (mode === "exit") {
  raLog("[INFO] [Content]: Loading content file...");
  raLog("[ERROR] Firmware missing: scph5501.bin");
  process.exit(1);
}
const coldSeen = path.join(logDir, "cold-" + port);
if (mode === "silent" || (mode === "cold" && !fs.existsSync(coldSeen))) {
  if (mode === "cold") { fs.writeFileSync(coldSeen, ""); }
  setInterval(() => {}, 1000);           // alive, deaf
  return;
}

const t0 = Date.now();
const playing = () => (mode === "nostart" ? false : Date.now() - t0 > 600);
const s = dgram.createSocket("udp4");
s.on("message", (m, r) => {
  const cmd = String(m).trim();
  if (/^GET_STATUS/.test(cmd)) {
    const st = playing() ? "GET_STATUS PLAYING test_system,Fake Game,crc32=00000000" : "GET_STATUS CONTENTLESS";
    s.send(st + "\n", r.port, r.address);
  } else if (cmd === "SCREENSHOT" && playing()) {
    fs.writeFileSync(path.join(shotDir, "Fake Game-260928-120000.png"), Buffer.from(PNG[mode] || PNG.play, "base64"));
  } else if (cmd === "QUIT") {
    process.exit(0);
  }
});
s.bind(+port, "127.0.0.1");
if (mode === "crash") {
  setTimeout(() => { raLog("[ERROR] [Core]: the core stopped"); process.exit(3); }, 1500);
}
