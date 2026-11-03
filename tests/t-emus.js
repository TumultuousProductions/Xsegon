/*  The standalone emulators, one file each (includes\emus\, roadmap CA13 and
    CA14): where each keeps its settings, its controls as its own files have
    them, and how a game in it is left with a pad. Stand-in folders made here,
    marked portable where an emulator allows it, so no real emulator's files
    are read; through tests\emus-probe.php, which writes nothing. */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { api, ROOT, OUT } = require("./lib");

const XBOX = "030000005e040000130b000009057801";

module.exports = async function (b, check) {
  const phpExe = ((await api("api/status.php")).build || {}).phpExe;
  const probe = (...a) => JSON.parse(execFileSync(phpExe, [path.join(ROOT, "tests", "emus-probe.php"), ...a], { encoding: "utf8" }));
  const fx = path.join(OUT, "emus-" + process.pid);
  fs.rmSync(fx, { recursive: true, force: true });
  const put = (rel, text) => { const f = path.join(fx, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
  try {
    const keys = probe("--keys");
    check("emus: a file each for the seven standalone emulators", Object.keys(keys).sort().join(","), "cemu,dolphin,eden,pcsx2,rpcs3,xemu,xenia");
    check("emus: RetroArch is none of them", probe(path.join(fx, "ra", "retroarch.exe")).known, false);

    // Dolphin, portable: an input the pad lacks is said to do nothing; the Wii Remote's pointing is not judged.
    put("dolphin/portable.txt", "");
    put("dolphin/User/Config/GCPadNew.ini", "[GCPad1]\r\nDevice = XInput/0/Gamepad\r\nButtons/A = `Button A`\r\nTriggers/R = `Button BACK`\r\nMain Stick/Modifier = `Thumb L`\r\n");
    put("dolphin/User/Config/WiimoteNew.ini", "[Wiimote1]\r\nDevice = XInput/0/Gamepad\r\nButtons/A = `Button A`\r\nIRPassthrough/Object 1 X = `IR Object 1 X`\r\nNunchuk/Shake/X = `Click 2`\r\n");
    const gc = probe(path.join(fx, "dolphin", "Dolphin.exe"), "Nintendo GameCube");
    check("emus: Dolphin portable keeps its settings in User beside it", gc.home, path.join(fx, "dolphin", "User"));
    check("emus: Dolphin's Button BACK is said to do nothing", /Button BACK/.test((gc.controls.rows.find((r) => r.name === "Triggers/R") || {}).flag || ""), true);
    check("emus: Dolphin's Button A and Thumb L are inputs the pad has", gc.controls.rows.filter((r) => r.flag).map((r) => r.name).join(","), "Triggers/R");
    check("emus: the binding is shown without Dolphin's backticks", (gc.controls.rows.find((r) => r.name === "Buttons/A") || {}).value, "Button A");
    const wii = probe(path.join(fx, "dolphin", "Dolphin.exe"), "Nintendo Wii");
    check("emus: a Wii game reads the Wii Remote, its pointing and shaking not judged", wii.controls.rows.filter((r) => r.flag).length, 0);
    check("emus: Dolphin is left by Xsegon's held Xbox button", gc.leave.by, "xsegon");

    // Cemu, portable by settings.xml: the GamePad's controls by name, Home and the screen on no button.
    put("cemu/settings.xml", "<content/>");
    const entry = (m, btn) => "<entry><mapping>" + m + "</mapping><button>" + btn + "</button></entry>";
    const profile = (type, pad, map) => "<?xml version=\"1.0\"?><emulated_controller><type>" + type + "</type><controller><api>XInput</api><uuid>" + pad + "</uuid><mappings>" + map + "</mappings></controller></emulated_controller>";
    put("cemu/controllerProfiles/controller0.xml", profile("Wii U GamePad", 0, entry(1, 13) + entry(2, 12) + entry(7, 42)));
    put("cemu/controllerProfiles/controller1.xml", profile("Wii U Pro Controller", 1, entry(1, 13)));
    const cemu = probe(path.join(fx, "cemu", "Cemu.exe"), "Wii U");
    const crow = (n) => (cemu.controls.rows.find((r) => r.name === n) || {});
    check("emus: Cemu with settings.xml beside it keeps everything there", cemu.home, path.join(fx, "cemu"));
    check("emus: Cemu's GamePad A on the pad's B", crow("A").value, "B");
    check("emus: Cemu's ZL on LT", crow("ZL").value, "LT");
    check("emus: Cemu's Home on no button is marked", crow("Home").unset, true);
    check("emus: Cemu says Home and the screen reach no press", /Home and the GamePad screen/.test(cemu.controls.source.note), true);
    check("emus: Cemu's player 2 is listed", crow("Player 2").value, "Wii U Pro Controller, XInput pad 2");

    // Eden, portable by user\: player lines only, the shortcut in the pad's words, the token never read out.
    const sdl = (k) => "\"engine:sdl,port:0,guid:" + XBOX + "," + k + "\"";
    put("eden/user/config/qt-config.ini", ["[Controls]", "player_0_type=0", "player_0_connected=true",
      "player_0_button_a=" + sdl("button:1"), "player_0_button_minus=" + sdl("button:6"), "player_0_button_home=" + sdl("button:10"),
      "player_0_button_zl=" + sdl("axis:2,threshold:0.500000,invert:+"), "player_0_button_screenshot=[empty]",
      "[WebService]", "eden_token=SECRET-STAND-IN", "[UI]",
      "Shortcuts\\Main%20Window\\Exit%20Eden\\Controller_KeySeq=Home+Minus",
      "Shortcuts\\Main%20Window\\Stop%20Emulation\\Controller_KeySeq=L+Plus+Minus", "confirmStop=0", ""].join("\r\n"));
    const eden = probe(path.join(fx, "eden", "eden.exe"), "Nintendo Switch");
    const erow = (n) => (eden.controls.rows.find((r) => r.name === n) || {});
    check("emus: Eden with user beside it keeps everything there", eden.home, path.join(fx, "eden", "user"));
    check("emus: Eden's Switch A on an Xbox pad's B", erow("A").value, "B");
    check("emus: Eden's ZL on LT", erow("ZL").value, "LT");
    check("emus: Eden's player 1 is a Pro Controller", erow("Player 1").value, "Pro Controller");
    check("emus: Eden is left its own way, in the pad's words", /Home\+Minus closes Eden \(on your pad: Xbox button and Back\)/.test(eden.leave.words), true);
    check("emus: Eden's close question is named", /Are you sure/.test(eden.leave.words), true);
    check("emus: Eden's token is never read out", JSON.stringify(eden).includes("SECRET-STAND-IN"), false);

    // RPCS3, xemu, Xenia, PCSX2: beside the program, each its own way out.
    put("rpcs3/config/input_configs/global/Default.yml", "Player 1 Input:\n  Handler: SDL\n  Device: XInput Controller 1\n  Config:\n    Cross: South\n    PS Button: Guide\n    Deadzone: 30\nPlayer 2 Input:\n  Handler: Null\n");
    const ps3 = probe(path.join(fx, "rpcs3", "rpcs3.exe"), "Sony Playstation 3");
    check("emus: RPCS3's player 1 rows, numbers left out", ps3.controls.rows.map((r) => r.name).join(","), "Cross,PS Button");
    check("emus: RPCS3 is left by its home menu on the Xbox button", ps3.leave.by === "own" && /the Xbox button/.test(ps3.leave.words), true);
    put("xemu/xemu.toml", "[input]\ngamepad_mappings = [{ gamepad_id = 'x', controller_mapping = { a = 1 } }]\n[input.bindings]\nport1 = '" + XBOX + "'\n");
    const xemu = probe(path.join(fx, "xemu", "xemu.exe"), "Microsoft Xbox");
    check("emus: xemu's ports are read", (xemu.controls.rows[0] || {}).name, "port1");
    check("emus: xemu's own button changes are counted", /button changes for 1 pad/.test(xemu.controls.source.note), true);
    check("emus: xemu is left by its own menu", xemu.leave.by, "own");
    put("xenia/xenia-canary.config.toml", "[HID]\nhid = \"any\"                # Input system\n");
    const x360 = probe(path.join(fx, "xenia", "xenia_canary.exe"), "Microsoft Xbox 360");
    check("emus: Xenia's hid any reads pads through SDL", (x360.controls.rows[0] || {}).value, "SDL (hid = \"any\")");
    check("emus: Xenia is left by Xsegon's held Xbox button", x360.leave.by, "xsegon");
    put("pcsx2/portable.ini", "");
    put("pcsx2/inis/PCSX2.ini", "[Pad1]\r\nType = DualShock2\r\nCross = SDL-0/FaceSouth\r\nDeadzone = 0.1\r\n");
    const ps2 = probe(path.join(fx, "pcsx2", "pcsx2-qt.exe"), "Sony Playstation 2");
    check("emus: PCSX2 portable keeps its settings beside it", ps2.home, path.join(fx, "pcsx2"));
    check("emus: PCSX2's pad rows, tuning numbers left out", ps2.controls.rows.map((r) => r.name).join(","), "Type,Cross");
    check("emus: PCSX2 is left by Xsegon's held Xbox button", ps2.leave.by, "xsegon");
    put("none/portable.ini", "");
    check("emus: a folder with no settings file says where it looks", /not there/.test(probe(path.join(fx, "none", "pcsx2-qt.exe")).controls.source.note), true);

    /* Set up (CA15): Xsegon's own profiles, a game's own file at its first start and never twice,
       nothing at a dry start, and Put back leaving every file as it was. XSEGON_DATA is the
       group's own data folder, so the record and the kept copies never reach data\. */
    const data = path.join(fx, "data");
    fs.mkdirSync(data, { recursive: true });
    const round = (exe, rom, title, platform) => JSON.parse(execFileSync(phpExe,
      [path.join(ROOT, "tests", "emus-probe.php"), "--round", exe, rom, title, platform],
      { encoding: "utf8", env: Object.assign({}, process.env, { XSEGON_DATA: data }) }));
    const tree = (dir) => {
      const out = {};
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((f) => {
        const p = path.join(d, f.name);
        if (f.isDirectory()) { walk(p); } else { out[path.relative(dir, p)] = fs.readFileSync(p, "utf8"); }
      });
      walk(dir);
      return out;
    };
    fs.mkdirSync(path.join(fx, "dolphin", "User", "GameSettings"), { recursive: true });
    const disc = path.join(fx, "GM4E01.iso");
    fs.writeFileSync(disc, Buffer.concat([Buffer.from("GM4E01"), Buffer.alloc(0x16), Buffer.from([0xC2, 0x33, 0x9F, 0x3D]), Buffer.alloc(64)]));
    const dBefore = tree(path.join(fx, "dolphin"));
    const dr = round(path.join(fx, "dolphin", "Dolphin.exe"), disc, "Mario Kart Double Dash", "Nintendo GameCube");
    const dOwn = (n) => Object.keys(dr.own).find((p) => p.endsWith(n)) || "";
    check("emus: Set up writes Dolphin's eight Xsegon profiles", Object.keys(dr.own).length, 8);
    check("emus: Dolphin's GameCube profile is the layout Dolphin ships", /Buttons\/Z = `Shoulder R`/.test(dr.own[dOwn("GCPad\\Xsegon Player 1.ini")] || ""), true);
    check("emus: player 2's profile is on the second pad", /Device = XInput\/1\/Gamepad/.test(dr.own[dOwn("GCPad\\Xsegon Player 2.ini")] || ""), true);
    check("emus: a dry start writes no game file", dr.dryGames, 0);
    check("emus: the first start names the profiles in the game's own file", /\[Controls\][\s\S]*PadProfile1 = Xsegon Player 1/.test(Object.values(dr.games)[0] || ""), true);
    check("emus: the second start writes nothing again", dr.second.said, "game lines there already");
    check("emus: Put back leaves Dolphin's folder exactly as it was", JSON.stringify(tree(path.join(fx, "dolphin"))), JSON.stringify(dBefore));

    // Cemu: the title ID by the packs' name and the shipped profile's region; the game's file starts as that profile.
    put("cemu/graphicPacks/downloadedGraphicPacks/MarioKart8/Mods/X/rules.txt", "[Definition]\ntitleIds = 000500001010EC00,000500001010ED00\nname = X\npath = \"Mario Kart 8/Mods/X\"\n");
    put("cemu/gameProfiles/default/000500001010ec00.ini", "# Mario Kart 8 (USA)\n\n[Graphics]\nGPUBufferCacheAccuracy = 1\n");
    put("cemu/gameProfiles/default/000500001010ED00.ini", "# Mario Kart 8 (EUR)\n");
    const cBefore = tree(path.join(fx, "cemu"));
    const cr = round(path.join(fx, "cemu", "Cemu.exe"), "E:\\wii U\\Mario Kart 8 (USA) (En,Fr,Es).wux", "Mario Kart 8", "Wii U");
    const cGame = Object.keys(cr.games)[0] || "";
    check("emus: Cemu's game file is named by the USA title ID", path.basename(cGame), "000500001010ec00.ini");
    check("emus: it starts as the profile Cemu ships, so its fixes stay", /^# Mario Kart 8 \(USA\)[\s\S]*GPUBufferCacheAccuracy = 1[\s\S]*\[Controller\][\s\S]*controller2 = Xsegon Player 2/.test(cr.games[cGame] || ""), true);
    check("emus: players 2 to 4 are Pro Controllers", Object.entries(cr.own).filter(([p, t]) => /Player [234]\.xml$/.test(p) && /<type>Wii U Pro Controller<\/type>/.test(t)).length, 3);
    check("emus: player 1 is the person's own GamePad", /<type>Wii U GamePad<\/type>/.test(Object.entries(cr.own).find(([p]) => /Player 1\.xml$/.test(p))[1]), true);
    check("emus: Put back leaves Cemu's folder exactly as it was", JSON.stringify(tree(path.join(fx, "cemu"))), JSON.stringify(cBefore));

    // RPCS3: its own file with player 1 copied to 2 to 4, handed over at each start; Default untouched.
    const rBefore = tree(path.join(fx, "rpcs3"));
    const rr = round(path.join(fx, "rpcs3", "rpcs3.exe"), "E:\\ps3\\EBOOT.BIN", "Heavenly Sword", "Sony Playstation 3");
    const yml = Object.values(rr.own)[0] || "";
    check("emus: RPCS3's Xsegon file has players 1 to 4 on pads 1 to 4", (yml.match(/Device: XInput Controller \d/g) || []).join(","), "Device: XInput Controller 1,Device: XInput Controller 2,Device: XInput Controller 3,Device: XInput Controller 4");
    check("emus: RPCS3's starts are handed it", rr.first.args, "--input-config Xsegon");
    check("emus: Put back leaves RPCS3's folder exactly as it was", JSON.stringify(tree(path.join(fx, "rpcs3"))), JSON.stringify(rBefore));
    check("emus: the setup's record is in the group's own data folder", fs.existsSync(path.join(data, "emu-setup.json")), true);
  } finally {
    fs.rmSync(fx, { recursive: true, force: true });
  }
};
