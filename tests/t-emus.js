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
    // With what is no input name (True, a function, a "$" name) and a key of digits alone, none of them judged.
    put("dolphin/User/Config/GCPadNew.ini", "[GCPad1]\r\nDevice = XInput/0/Gamepad\r\nButtons/A = `Button A`\r\nTriggers/R = `Button BACK`\r\nMain Stick/Modifier = `Thumb L`\r\n"
      + "Options/Always Connected = True\r\nButtons/X = toggle(`Button X`) & $held\r\nButtons/Y = `Button Y` | `Button B`\r\n5 = `Button A`\r\n");
    put("dolphin/User/Config/WiimoteNew.ini", "[Wiimote1]\r\nDevice = XInput/0/Gamepad\r\nButtons/A = `Button A`\r\nIRPassthrough/Object 1 X = `IR Object 1 X`\r\nNunchuk/Shake/X = `Click 2`\r\n");
    const gc = probe(path.join(fx, "dolphin", "Dolphin.exe"), "Nintendo GameCube");
    check("emus: Dolphin portable keeps its settings in User beside it", gc.home, path.join(fx, "dolphin", "User"));
    check("emus: Dolphin's Button BACK is said to do nothing", /Button BACK/.test((gc.controls.rows.find((r) => r.name === "Triggers/R") || {}).flag || ""), true);
    check("emus: Dolphin's Button A and Thumb L are inputs the pad has", gc.controls.rows.filter((r) => r.flag).map((r) => r.name).join(","), "Triggers/R");
    check("emus: the binding is shown without Dolphin's backticks", (gc.controls.rows.find((r) => r.name === "Buttons/A") || {}).value, "Button A");
    check("emus: a binding of two inputs shows both names, every backtick out", (gc.controls.rows.find((r) => r.name === "Buttons/Y") || {}).value, "Button Y | Button B");
    check("emus: a key of digits alone is read, not a fault", (gc.controls.rows.find((r) => r.name === "5") || {}).value, "Button A");
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
    put("xemu/xemu.toml", "[input]\ngamepad_mappings = [{ gamepad_id = 'x', controller_mapping = { a = 1 } }]\n[input.bindings]\nport1 = '" + XBOX + "' # my pad\n");
    const xemu = probe(path.join(fx, "xemu", "xemu.exe"), "Microsoft Xbox");
    check("emus: xemu's ports are read", (xemu.controls.rows[0] || {}).name, "port1");
    check("emus: a comment after the value is not part of it", (xemu.controls.rows[0] || {}).value, XBOX);
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
    check("emus: its words say to let go before 5 seconds, and what a second hold does", /let go[\s\S]*again a few seconds later ends it[\s\S]*5 seconds or more does nothing/.test(ps2.leave.words), true);
    // A letter of another alphabet at a value's end stays whole (only a byte order mark at the file's start is taken off).
    put("pcsx2u/portable.ini", "");
    put("pcsx2u/inis/PCSX2.ini", "﻿[Pad1]\r\nType = DualShock2\r\nCross = Keyboard/л\r\n");
    check("emus: a value ending in another alphabet's letter reads whole", ((probe(path.join(fx, "pcsx2u", "pcsx2-qt.exe")).controls.rows || []).find((r) => r.name === "Cross") || {}).value, "Keyboard/л");
    put("pcsx2n/portable.ini", "");
    put("pcsx2n/inis/PCSX2.ini", "[UI]\r\nConfirmShutdown = false\r\n");
    check("emus: a settings file with no first pad says so", /no first pad/.test(probe(path.join(fx, "pcsx2n", "pcsx2-qt.exe")).controls.source.note), true);
    put("rpcs3n/config/input_configs/global/Default.yml", "Player 1 Input:\n  Handler: SDL\n  Device: XInput Controller 1\n  Config:\n    Cross: South\n    PS Button: None\n");
    check("emus: RPCS3 with its PS button on no press says the keyboard reaches its menu", /on no press of your pad/.test(probe(path.join(fx, "rpcs3n", "rpcs3.exe")).leave.words), true);
    put("edenh/user/config/qt-config.ini", "[Controls]\r\nplayer_0_button_home=[empty]\r\nplayer_0_button_minus=" + sdl("button:6") + "\r\n[UI]\r\n");
    check("emus: Eden with Home on no button says so, not a press that does nothing", /Home is on no button of your pad/.test(probe(path.join(fx, "edenh", "eden.exe")).leave.words), true);
    fs.mkdirSync(path.join(fx, "edenx", "user"), { recursive: true });
    check("emus: Eden with no settings file yet says so", /no settings file yet/.test(probe(path.join(fx, "edenx", "eden.exe")).leave.words), true);
    put("none/portable.ini", "");
    check("emus: a folder with no settings file says where it looks", /not there/.test(probe(path.join(fx, "none", "pcsx2-qt.exe")).controls.source.note), true);

    /* Set up (CA15): Xsegon's own profiles, a game's own file at its first start and never twice,
       nothing at a dry start, and Put back leaving every file as it was. XSEGON_DATA is the
       group's own data folder, so the record and the kept copies never reach data\. */
    const data = path.join(fx, "data");
    fs.mkdirSync(data, { recursive: true });
    const round = (exe, rom, title, platform, args) => JSON.parse(execFileSync(phpExe,
      [path.join(ROOT, "tests", "emus-probe.php"), "--round", exe, rom, title, platform, args || ""],
      { encoding: "utf8", env: Object.assign({}, process.env, { XSEGON_DATA: data }) }));
    // Every file and folder, so a folder Set up made and Put back left behind is told too.
    const tree = (dir) => {
      const out = {};
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((f) => {
        const p = path.join(d, f.name);
        if (f.isDirectory()) { out[path.relative(dir, p) + "\\"] = "(folder)"; walk(p); } else { out[path.relative(dir, p)] = fs.readFileSync(p, "utf8"); }
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
    const rr = round(path.join(fx, "rpcs3", "rpcs3.exe"), "E:\\ps3\\EBOOT.BIN", "Heavenly Sword", "Sony Playstation 3", "--no-gui");
    const yml = Object.values(rr.own)[0] || "";
    check("emus: RPCS3's Xsegon file has players 1 to 4 on pads 1 to 4", (yml.match(/Device: XInput Controller \d/g) || []).join(","), "Device: XInput Controller 1,Device: XInput Controller 2,Device: XInput Controller 3,Device: XInput Controller 4");
    check("emus: RPCS3's starts are handed it", rr.first.args, "--input-config Xsegon");
    check("emus: Put back leaves RPCS3's folder exactly as it was", JSON.stringify(tree(path.join(fx, "rpcs3"))), JSON.stringify(rBefore));
    check("emus: the setup's record is in the group's own data folder", fs.existsSync(path.join(data, "emu-setup.json")), true);
    check("emus: each round's Set up and Put back said yes", [dr.on, dr.off, cr.on, cr.off, rr.on, rr.off], [true, true, true, true, true, true]);

    /* The once-over (CA26): the same steps one at a time, the folders changed between them as a
       person or an emulator would, each time with what Xsegon must then do or leave alone. */
    const step = (...a) => JSON.parse(execFileSync(phpExe, [path.join(ROOT, "tests", "emus-probe.php"), ...a],
      { encoding: "utf8", env: Object.assign({}, process.env, { XSEGON_DATA: data }) }));
    const dx = path.join(fx, "dolphin", "Dolphin.exe");
    const dGame = path.join(fx, "dolphin", "User", "GameSettings", "GM4E01.ini");
    const dP1 = path.join(fx, "dolphin", "User", "Config", "Profiles", "GCPad", "Xsegon Player 1.ini");
    const mkdd = (platform, args) => step("--start", dx, disc, "Mario Kart Double Dash", platform || "Nintendo GameCube", args || "", "1");
    const sNoGui = step("--on", path.join(fx, "rpcs3", "rpcs3.exe"));
    const sNoGuiStart = step("--start", path.join(fx, "rpcs3", "rpcs3.exe"), "E:\\ps3\\EBOOT.BIN", "Heavenly Sword", "Sony Playstation 3", "", "1");
    check("emus: RPCS3 started without --no-gui is handed nothing, and says why", [sNoGui.ok, sNoGuiStart.args, /--no-gui/.test(sNoGuiStart.said)], [true, "", true]);
    step("--off", path.join(fx, "rpcs3", "rpcs3.exe"));

    // A game's file that cannot be put back: the profiles stay and it stays set up, as a game naming a missing one would stop.
    step("--on", dx);
    mkdd();
    fs.chmodSync(dGame, 0o444);
    const stuck = step("--off", dx);
    check("emus: a game file that cannot be put back keeps the profiles and the setup", [stuck.ok, stuck.rec.on, fs.existsSync(dP1)], [false, true, true]);
    check("emus: and says which file, and to press Put back again", /GM4E01\.ini[\s\S]*Put back again/.test(stuck.why || ""), true);
    fs.chmodSync(dGame, 0o666);
    check("emus: Put back again once it is free", step("--off", dx).ok, true);
    check("emus: Dolphin's folder is then exactly as it was", JSON.stringify(tree(path.join(fx, "dolphin"))), JSON.stringify(dBefore));

    // The same disc started as a GameCube and as a Wii game: Put back takes both writes' lines.
    step("--on", dx);
    mkdd();
    mkdd("Nintendo Wii");
    check("emus: a second start as a Wii game adds its own lines", /PadProfile1 = Xsegon Player 1[\s\S]*WiimoteProfile1 = Xsegon Player 1/.test(fs.readFileSync(dGame, "utf8")), true);
    step("--off", dx);
    check("emus: Put back after both takes every line, the file Xsegon made gone", fs.existsSync(dGame), false);

    // Another Dolphin than the one set up, a profile taken away by hand, a game's file deleted by hand.
    put("dolphin2/portable.txt", "");
    fs.mkdirSync(path.join(fx, "dolphin2", "User", "GameSettings"), { recursive: true });
    step("--on", dx);
    const other = step("--start", path.join(fx, "dolphin2", "Dolphin.exe"), disc, "Mario Kart Double Dash", "Nintendo GameCube", "", "1");
    check("emus: another Dolphin's start gets nothing, and says why", [/nothing handed over: set up for the Dolphin/.test(other.said), fs.existsSync(path.join(fx, "dolphin2", "User", "GameSettings", "GM4E01.ini"))], [true, false]);
    mkdd();
    fs.rmSync(dGame);
    check("emus: a game's file deleted by hand is written again at its next start", [mkdd().said, fs.existsSync(dGame)], ["game lines written in GM4E01.ini", true]);
    step("--off", dx);
    step("--on", dx);
    fs.rmSync(dP1);
    const goneP = mkdd();
    check("emus: with a profile taken away by hand, a start writes nothing and says so", [/Xsegon Player 1\.ini is gone/.test(goneP.said), fs.existsSync(dGame)], [true, false]);
    check("emus: Put back still takes the rest away", [step("--off", dx).ok, JSON.stringify(tree(path.join(fx, "dolphin")))], [true, JSON.stringify(dBefore)]);

    // A profile the person changed in Dolphin: Put back leaves it, and Set up again uses it as it is.
    step("--on", dx);
    fs.appendFileSync(dP1, "Buttons/Z = `Button X`\r\n");
    const offMine = step("--off", dx);
    check("emus: Put back leaves a profile changed in Dolphin, and names it", [offMine.ok, fs.existsSync(dP1), /Xsegon Player 1/.test(offMine.said || "")], [true, true, true]);
    const onMine = step("--on", dx);
    check("emus: Set up again uses it as left: not refused, not written over", [onMine.ok, /used as you left it/.test(onMine.said || ""), /Button X/.test(fs.readFileSync(dP1, "utf8"))], [true, true, true]);
    step("--off", dx);
    fs.rmSync(path.join(fx, "dolphin", "User", "Config", "Profiles"), { recursive: true, force: true });

    // A record that will not read, and Dolphin inside LaunchBox's folder: nothing written either way.
    const recFile = path.join(data, "emu-setup.json");
    const recWas = fs.readFileSync(recFile, "utf8");
    fs.writeFileSync(recFile, "{ broken");
    const dmg = step("--on", dx);
    check("emus: with its record unreadable, Set up writes nothing and leaves the record", [dmg.ok, /would not read/.test(dmg.why || ""), fs.readFileSync(recFile, "utf8"), fs.existsSync(path.join(fx, "dolphin", "User", "Config", "Profiles"))], [false, true, "{ broken", false]);
    fs.writeFileSync(recFile, recWas);
    put("lb/LaunchBox.exe", "");
    put("lb/Emulators/Dolphin/portable.txt", "");
    fs.mkdirSync(path.join(fx, "lb", "Emulators", "Dolphin", "User", "Config"), { recursive: true });
    const lbx = path.join(fx, "lb", "Emulators", "Dolphin", "Dolphin.exe");
    const lbOn = step("--on", lbx);
    check("emus: a Dolphin inside LaunchBox's folder is never written", [lbOn.ok, /LaunchBox/.test(lbOn.why || ""), fs.existsSync(path.join(fx, "lb", "Emulators", "Dolphin", "User", "Config", "Profiles"))], [false, true, false]);

    // Cemu: the profile Cemu ships changed after Set up (an update): the game's file Xsegon made still goes.
    const cx = path.join(fx, "cemu", "Cemu.exe");
    const cShipped = path.join(fx, "cemu", "gameProfiles", "default", "000500001010ec00.ini");
    const cShippedWas = fs.readFileSync(cShipped, "utf8");
    step("--on", cx);
    step("--start", cx, "E:\\wii U\\Mario Kart 8 (USA) (En,Fr,Es).wux", "Mario Kart 8", "Wii U", "", "1");
    fs.writeFileSync(cShipped, cShippedWas + "[CPU]\nthreadQuantum = 45000\n");
    step("--off", cx);
    check("emus: Put back takes Cemu's game profile Xsegon made, though the shipped one changed since", fs.existsSync(path.join(fx, "cemu", "gameProfiles", "000500001010ec00.ini")), false);
    fs.writeFileSync(cShipped, cShippedWas);

    /* A Wii U game's graphic packs (CA18): the ones for its title ID, on as settings.xml says,
       and one written after Cemu's download said to be the person's own, which the next download deletes. */
    const dl = path.join(fx, "cemu", "graphicPacks", "downloadedGraphicPacks");
    put("cemu/graphicPacks/downloadedGraphicPacks/version.txt", "Cemu Graphic Packs: v970");
    put("cemu/graphicPacks/downloadedGraphicPacks/MarioKart8/Graphics/rules.txt", "[Definition]\ntitleIds = 000500001010EC00,000500001010ED00\nname = Graphic Options\npath = \"Mario Kart 8/Graphics\"\n\n[Preset]\nname = 1080p\n");
    put("cemu/graphicPacks/downloadedGraphicPacks/MarioKart8/Mods/Mine/rules.txt", "[Definition]\ntitleIds = 000500001010EC00\nname = Mine\npath = \"Mario Kart 8/Mods/Mine\"\n");
    put("cemu/graphicPacks/downloadedGraphicPacks/Other/rules.txt", "[Definition]\ntitleIds = 0005000010199999\nname = Another game's\npath = \"Other/Graphics\"\n");
    const old = new Date(Date.now() - 3600 * 1000);
    ["version.txt", "MarioKart8/Graphics/rules.txt", "MarioKart8/Mods/X/rules.txt", "Other/rules.txt"].forEach((f) => fs.utimesSync(path.join(dl, f), old, old));
    put("cemu/settings.xml", "<content><GraphicPack><Entry filename=\"graphicPacks/downloadedGraphicPacks/MarioKart8/Graphics/rules.txt\"/>"
      + "<Entry filename=\"graphicPacks/downloadedGraphicPacks/MarioKart8/Mods/X/rules.txt\" disabled=\"true\"/></GraphicPack></content>");
    const gp = JSON.parse(execFileSync(phpExe, [path.join(ROOT, "tests", "emus-probe.php"), "--packs", path.join(fx, "cemu", "Cemu.exe"), "Mario Kart 8", "Mario Kart 8 (USA).wux"], { encoding: "utf8" })).got || { packs: [] };
    const pk = (n) => gp.packs.find((p) => p.name === n) || {};
    check("emus: the packs for the game's title ID alone", gp.packs.map((p) => p.name).sort().join(","), "Graphic Options,Mine,X");
    check("emus: a preset's name is not taken for the pack's", pk("Graphic Options").kind, "Graphics");
    check("emus: a pack settings.xml switches on reads on", pk("Graphic Options").on, true);
    check("emus: one it switches off reads off", pk("X").on, false);
    check("emus: a pack written after the download is the person's own, said to be at risk", pk("Mine").late && pk("Mine").own, true);
    check("emus: the downloaded ones are not", !!(pk("Graphic Options").late || pk("X").late), false);
    check("emus: the set on the PC is named", gp.set, "Cemu Graphic Packs: v970");
    // A titleIds line ending in a comment still names its game; an unpacked game's own meta.xml gives its ID.
    put("cemu/graphicPacks/Commented/rules.txt", "[Definition]\ntitleIds = 000500001010EC00 # USA\nname = Commented\npath = \"Mario Kart 8/Mods/Commented\"\n");
    put("wiiu/MK8 dump/code/Turbo.rpx", "");
    put("wiiu/MK8 dump/meta/meta.xml", "<?xml version=\"1.0\"?><menu><title_id type=\"hexBinary\" length=\"8\">000500001010EC00</title_id></menu>");
    const gp2 = JSON.parse(execFileSync(phpExe, [path.join(ROOT, "tests", "emus-probe.php"), "--packs", path.join(fx, "cemu", "Cemu.exe"), "A name no pack has",
      path.join(fx, "wiiu", "MK8 dump", "code", "Turbo.rpx")], { encoding: "utf8" }));
    check("emus: an unpacked game's ID is read from its meta.xml, whatever its name", (gp2.got || {}).titleId, "000500001010ec00");
    check("emus: a pack whose titleIds line ends in a comment is listed", ((gp2.got || {}).packs || []).some((p) => p.name === "Commented"), true);

    /* Dolphin's patches and codes (CA19): read from its shipped INIs (the three-letter one and the
       ID's) and the game's own, switched in the game's own as its Properties window writes them. */
    put("dolphin/Sys/GameSettings/GM4.ini", "[OnFrame]\r\n$Shared fix\r\n0x80001234:dword:0x60000000\r\n[OnFrame_Enabled]\r\n$Shared fix\r\n");
    put("dolphin/Sys/GameSettings/GM4E01.ini", "# GM4E01 - Mario Kart: Double Dash!!\r\n[Gecko]\r\n$16:9 Widescreen [Ralf]\r\n04000000 00000000\r\n*Wider picture\r\n[ActionReplay]\r\n$Everything Unlocked\r\n023BC1C0 0003FFFF\r\n");
    const dexe = path.join(fx, "dolphin", "Dolphin.exe");
    const codes = (...a) => JSON.parse(execFileSync(phpExe, [path.join(ROOT, "tests", "emus-probe.php"), ...a],
      { encoding: "utf8", env: Object.assign({}, process.env, { XSEGON_DATA: data }) }));
    const userIni = path.join(fx, "dolphin", "User", "GameSettings", "GM4E01.ini");
    const c0 = codes("--codes", dexe, disc);
    const cn = (r, n) => ((r.codes || {}).list || []).find((c) => c.name === n) || {};
    check("emus: Dolphin's patches and codes from both shipped files", ((c0.codes || {}).list || []).map((c) => c.name).join(","), "$Shared fix,$16:9 Widescreen,$Everything Unlocked");
    check("emus: a patch Dolphin ships on reads on", cn(c0, "$Shared fix").on, true);
    check("emus: a Gecko code's author and note are read", cn(c0, "$16:9 Widescreen").author + " / " + cn(c0, "$16:9 Widescreen").desc, "Ralf / Wider picture");
    check("emus: with no code on, the start gets no cheats switch", c0.launch, "");
    const c1 = codes("--code", dexe, disc, "Gecko", "$16:9 Widescreen", "1");
    check("emus: a code switched on is on", cn(c1, "$16:9 Widescreen").on, true);
    check("emus: it is written as Dolphin writes it", fs.readFileSync(userIni, "utf8").replace(/\r/g, ""), "[Gecko_Enabled]\n$16:9 Widescreen\n");
    check("emus: with a code on, that start turns cheats on, for itself only", c1.launch, "-C Dolphin.Core.EnableCheats=True");
    const c2 = codes("--code", dexe, disc, "OnFrame", "$Shared fix", "0");
    check("emus: a patch Dolphin ships on, switched off, goes in the disabled list", cn(c2, "$Shared fix").on === false && /\[OnFrame_Disabled\]\r?\n\$Shared fix/.test(fs.readFileSync(userIni, "utf8")), true);
    codes("--code", dexe, disc, "OnFrame", "$Shared fix", "1");
    codes("--code", dexe, disc, "Gecko", "$16:9 Widescreen", "0");
    check("emus: both switched back, the game's own file is gone, as before", fs.existsSync(userIni), false);
    check("emus: a name that is not a code is refused", codes("--code", dexe, disc, "Gecko", "no dollar", "1").ok, false);
    check("emus: a name with a line break in it is refused, nothing written", [codes("--code", dexe, disc, "Gecko", "$16:9 Widescreen\r\n[Core]\r\nCPUCore = 0", "1").ok, fs.existsSync(userIni)], [false, false]);
    check("emus: a code this game does not have is refused", codes("--code", dexe, disc, "Gecko", "$Not one of its codes", "1").ok, false);
    // The disc's revision file (GM4E01r0.ini here), and brackets that are an Action Replay name's own, as Dolphin writes them.
    put("dolphin/Sys/GameSettings/GM4E01r0.ini", "[ActionReplay]\r\n$60 FPS [Nerdzilla]\r\n04000000 00000000\r\n[ActionReplay_Enabled]\r\n$60 FPS [Nerdzilla]\r\n");
    const c3 = codes("--codes", dexe, disc);
    check("emus: the revision's own file is read, its code on as shipped, its brackets kept", [cn(c3, "$60 FPS [Nerdzilla]").on, cn(c3, "$60 FPS [Nerdzilla]").author], [true, ""]);
    codes("--code", dexe, disc, "ActionReplay", "$60 FPS [Nerdzilla]", "0");
    check("emus: switched off, the whole name goes in the disabled list", /\[ActionReplay_Disabled\]\r?\n\$60 FPS \[Nerdzilla\]/.test(fs.readFileSync(userIni, "utf8")), true);
    codes("--code", dexe, disc, "ActionReplay", "$60 FPS [Nerdzilla]", "1");
    check("emus: and back on, the game's own file gone again", fs.existsSync(userIni), false);
    // A byte order mark before the section: the line is found and taken out.
    fs.writeFileSync(userIni, "﻿[Gecko_Enabled]\r\n$16:9 Widescreen\r\n");
    codes("--code", dexe, disc, "Gecko", "$16:9 Widescreen", "0");
    check("emus: a file starting with a byte order mark is switched too", fs.existsSync(userIni) ? fs.readFileSync(userIni, "utf8") : "(gone)", "(gone)");
    // Two switches in one second keep two copies: the one from before the first is never written over.
    const kept = () => fs.existsSync(path.join(data, "emu-kept")) ? fs.readdirSync(path.join(data, "emu-kept")).filter((f) => f.startsWith("GM4E01.")).length : 0;
    codes("--code", dexe, disc, "Gecko", "$16:9 Widescreen", "1");
    const k0 = kept();
    codes("--code", dexe, disc, "ActionReplay", "$Everything Unlocked", "1");
    codes("--code", dexe, disc, "ActionReplay", "$Everything Unlocked", "0");
    check("emus: each switch keeps a copy of its own, none written over", kept() - k0, 2);
    codes("--code", dexe, disc, "Gecko", "$16:9 Widescreen", "0");
    put("lb/Emulators/Dolphin/Sys/GameSettings/GM4E01.ini", "[Gecko]\r\n$16:9 Widescreen [Ralf]\r\n04000000 00000000\r\n");
    check("emus: a code switch in LaunchBox's Dolphin is refused", [codes("--code", lbx, disc, "Gecko", "$16:9 Widescreen", "1").ok,
      fs.existsSync(path.join(fx, "lb", "Emulators", "Dolphin", "User", "GameSettings", "GM4E01.ini"))], [false, false]);

    /* PCSX2's patches and cheats (CA20): the game's file pulled out of a patches.zip by Windows' tar,
       the cheats as PCSX2's own list has them, a patch switched on and off in the game's own file. */
    const { pcsx2Fixture } = require("./t-cheats");
    const p2 = path.join(fx, "pcsx2b");
    const p2rom = "Z:\\ps2\\A Game (USA).iso";
    pcsx2Fixture(p2, p2rom, { global: true, own: true });
    fs.mkdirSync(path.join(p2, "resources"), { recursive: true });
    fs.writeFileSync(path.join(fx, "SLUS-99999_ABCD1234.pnach"), "gametitle=A Game\n\n[Widescreen 16:9]\ngsaspectratio=16:9\nauthor=nemesis2000\npatch=1,EE,0032b448,word,3c013f40\n\n[No-Interlacing]\nauthor=asasega\npatch=1,EE,00100000,word,00000000\n");
    execFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-a", "-cf", path.join(p2, "resources", "patches.zip"), "-C", fx, "SLUS-99999_ABCD1234.pnach"]);
    const p2exe = path.join(p2, "pcsx2-qt.exe");
    const p2ini = path.join(p2, "gamesettings", "SLUS-99999_ABCD1234.ini");
    const p2was = fs.readFileSync(p2ini, "utf8");
    const q0 = codes("--codes", p2exe, p2rom);
    const q = (r, n) => ((r.codes || {}).list || []).find((c) => c.name === n) || {};
    check("emus: PCSX2's patches from its zip and its cheats", ((q0.codes || {}).list || []).map((c) => c.kind + ":" + c.name).join(","),
      "patch:Widescreen 16:9,patch:No-Interlacing,cheat:Infinite Health,cheat:All Stages,cheat:Max Money");
    check("emus: a patch's author is read, and it is off", [q(q0, "Widescreen 16:9").author, q(q0, "Widescreen 16:9").on], ["nemesis2000", false]);
    const q1 = codes("--code", p2exe, p2rom, "Patches", "Widescreen 16:9", "1");
    check("emus: switched on, in the game's own file as PCSX2 writes it", [q(q1, "Widescreen 16:9").on, /\[Patches\]\r?\nEnable = Widescreen 16:9/.test(fs.readFileSync(p2ini, "utf8"))], [true, true]);
    codes("--code", p2exe, p2rom, "Patches", "Widescreen 16:9", "0");
    check("emus: switched off again, the game's file reads as it did", fs.readFileSync(p2ini, "utf8"), p2was);
    check("emus: a PCSX2 name with a line break in it is refused", codes("--code", p2exe, p2rom, "Cheats", "Max\nMoney", "1").ok, false);

    /* The held Xbox button's helper (CA14, bin\padleave.ps1), on two stand-in emulators of one name in
       two folders (tests\fake-emulator.cs): a pretended hold let go closes this launch's, never the
       other folder's; one held past a pad's switch-off time closes nothing; it ends with the game.
       The stand-ins are this test's own, stopped by their own process. */
    const { execFile, spawn } = require("child_process");
    const ps = (args, ms) => new Promise((resolve) => execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args],
      { windowsHide: true, timeout: ms || 60000 }, (e, out) => resolve(String(out || ""))));
    const leave = path.join(ROOT, "bin", "padleave.ps1");
    check("emus: the helper builds and hears XInput, closing nothing (-Probe)", /pad\(s\); Xbox button (up|held)|XInput would not answer/.test(await ps(["-File", leave, "-Probe", "1"])), true);
    const pl = path.join(fx, "pl");
    const fakeA = path.join(pl, "a", "xsfake-emu.exe");
    const fakeB = path.join(pl, "b", "xsfake-emu.exe");
    fs.mkdirSync(path.dirname(fakeA), { recursive: true });
    fs.mkdirSync(path.dirname(fakeB), { recursive: true });
    await ps(["-Command", "Add-Type -OutputAssembly '" + fakeA + "' -OutputType WindowsApplication -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition ([IO.File]::ReadAllText('"
      + path.join(ROOT, "tests", "fake-emulator.cs") + "'))"], 90000);
    check("(the stand-in emulator was built)", fs.existsSync(fakeA), true);
    if (fs.existsSync(fakeA)) {
      fs.copyFileSync(fakeA, fakeB);
      const pdata = path.join(pl, "data");
      fs.mkdirSync(pdata, { recursive: true });
      const mark = (id) => fs.writeFileSync(path.join(pdata, "running.json"), JSON.stringify({ gameId: id, launcherPid: process.pid }));
      const alive = (p) => p.exitCode === null && p.signalCode === null;
      const until = async (fn, ms) => {
        for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 200))) { if (fn()) { return true; } }
        return fn();
      };
      const helper = (pretend) => new Promise((resolve) => execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", leave, "-Exe", fakeA,
        "-GameId", "g1", "-DataDir", pdata, "-HoldSeconds", "2", "-MaxHoldSeconds", "5", "-Pretend", String(pretend), "-Log"], { windowsHide: true, timeout: 60000 }, () => resolve()));
      const logText = () => { try { return fs.readdirSync(path.join(pdata, "log")).map((f) => fs.readFileSync(path.join(pdata, "log", f), "utf8")).join(""); } catch (e) { return ""; } };
      const fakes = [];
      const fake = (exe, name) => { const p = spawn(exe, ["quiet", path.join(pl, name + ".log")], { stdio: "ignore" }); fakes.push(p); return p; };
      try {
        const a = fake(fakeA, "a");
        const b = fake(fakeB, "b");
        await new Promise((r) => setTimeout(r, 1500));     // their windows up
        mark("g1");
        const run1 = helper(2.6);
        check("emus: a hold let go after 2.6 s closes this launch's emulator", await until(() => !alive(a), 30000), true);
        check("emus: the same program in another folder is left running", alive(b), true);
        mark("another game");
        await run1;
        check("emus: the helper says what it did, and ends with the game",
          [/asked 1 window\(s\) of xsfake-emu\.exe to close/.test(logText()), /stopped for g1: the game ended/.test(logText())], [true, true]);
        const a2 = fake(fakeA, "a2");
        await new Promise((r) => setTimeout(r, 1500));
        mark("g1");
        const run2 = helper(6.5);
        await until(() => /held 5 s or more/.test(logText()), 30000);
        await new Promise((r) => setTimeout(r, 2500));     // past the let-go at 6.5 s
        check("emus: a hold of 5 seconds or more closes nothing, and says why", [alive(a2), /held 5 s or more: taken as a pad being switched off/.test(logText())], [true, true]);
        mark("another game");
        await run2;
      } finally {
        fakes.forEach((p) => { if (alive(p)) { p.kill(); } });
        await until(() => fakes.every((p) => !alive(p)), 5000);
      }
    }
  } finally {
    fs.rmSync(fx, { recursive: true, force: true });
  }
};
