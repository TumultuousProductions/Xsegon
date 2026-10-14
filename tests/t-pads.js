/* Any controller's own button names (js/padkind.js, js/padfound.js).
 *
 * Xsegon hears a pad by where a button sits; the names shown follow the pad
 * in use. A notice says which kind was found, once, with a Change button.
 *
 * The pads are stand-ins (headless Chrome has none), each with the name a
 * browser gives the real one. That proves what Xsegon does with the name,
 * not that a real pad says it: the log line checked is what a report shows.
 */
"use strict";
const fs = require("fs");
const { api, apiUntil, sleep } = require("./lib");

const IDS = {
  xbox: "Xbox 360 Controller (XInput STANDARD GAMEPAD)",
  ps5: "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)",
  ps4: "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)",
  nintendo: "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)",
  other: "Generic USB Joystick (Vendor: 0079 Product: 0006)",
};
// Each legend key: its name (a drawn key's is its title), what it does, whether it is drawn.
const LEGEND = `[...document.querySelectorAll("#help .hitem")].map((n) => { const k = n.querySelector(".hk"); return [k.title || k.textContent, n.querySelector(".hl").textContent, !!k.querySelector("svg")]; })`;
const keyFor = (does) => `(h => h.find((x) => x[1] === ${JSON.stringify(does)}) || null)(${LEGEND})`;
const NOTICE = `(t => t ? [t.querySelector("strong").textContent, [...t.querySelectorAll(".toast-line:not(.toast-go)")].map((p) => p.textContent), (t.querySelector(".toast-go button") || {}).textContent || null] : null)([...document.querySelectorAll("#toasts .toast:not(.toast-saved):not(.going)")].find((t) => /controller found/i.test(t.textContent)))`;
const NAMES_ROW = `document.querySelector('#settings select[data-group="controller"][data-key="buttonNames"]')`;
const choose = (v) => `(s => { s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event("change", { bubbles: true })); return s.value; })(${NAMES_ROW})`;

module.exports = async function (b, check) {
  const before = (await api("api/settings.php")).settings.controller;
  let sideWas;
  const pad = (id, mapping) => b.ev(`window.__pdWas = window.__pdWas || navigator.getGamepads; window.__pdPad = { id: ${JSON.stringify(id)}, mapping: ${JSON.stringify(mapping === undefined ? "standard" : mapping)}, connected: true, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }; navigator.getGamepads = () => [window.__pdPad]`);
  const tap = async (n) => { await b.ev(`window.__pdPad.buttons[${n}].pressed = true`); await sleep(180); await b.ev(`window.__pdPad.buttons[${n}].pressed = false`); await sleep(180); };
  // Esc on a row only steps back to the categories: closed the way the Close button does.
  const shut = async () => { await b.ev(`import("/js/settings-ui.js").then((m) => m.closeSettings())`); await b.until(`document.getElementById("settings").hidden`, true, 3000); };
  const names = async () => (await api("api/settings.php")).settings.controller.buttonNames;
  try {
    // The dead zone as it comes: the stick checks below are written against it.
    await api("api/settings.php", { controller: { enabled: true, confirmButton: "a", buttonNames: "auto", deadzone: 0.35 } });
    await b.goto();
    await b.ev(`localStorage.removeItem("xs-pad-told")`);      // an earlier group's stand-in has been said already
    await b.goto();
    check("(the consoles screen is up)", await b.ev(`!document.getElementById("syswall").hidden`), true);

    /* ---- which kind a pad's name says it is ---------------------------------- */
    const said = [IDS.xbox, "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)", IDS.ps5, IDS.ps4,
                  "PLAYSTATION(R)3 Controller (STANDARD GAMEPAD Vendor: 054c Product: 0268)", "054c-0ce6-DualSense Wireless Controller",
                  IDS.nintendo, "057e-2009-Pro Controller", IDS.other, "stand-in", ""];
    check("a pad's kind is read off the name the browser gives it, the maker's number first",
          await b.ev(`import("/js/padkind.js").then((m) => ${JSON.stringify(said)}.map(m.padKindOf))`),
          ["xbox", "xbox", "playstation", "playstation", "playstation", "playstation", "nintendo", "nintendo", "", "", ""]);
    check("Automatic is how the setting comes, with the four kinds to choose",
          await api("api/settings.php").then((r) => [r.defaults.controller.buttonNames, Object.keys(r.schema.controller.buttonNames.options)]),
          ["auto", ["auto", "xbox", "playstation", "nintendo", "position"]]);

    /* ---- a PlayStation pad: its shapes, and the notice ------------------------ */
    await pad(IDS.ps5);
    await tap(15);
    check("a PlayStation pad's press puts its shapes in the legend, drawn", await b.until(keyFor("open system"), ["Cross", "open system", true], 3000), ["Cross", "open system", true]);
    check("Triangle where Y was", await b.ev(keyFor("menu")), ["Triangle", "menu", true]);
    check("and a notice in the corner says what was found, with a Change button",
          await b.until(NOTICE, ["PlayStation controller found", ["Xsegon shows PlayStation button names."], "Change"], 3000),
          ["PlayStation controller found", ["Xsegon shows PlayStation button names."], "Change"]);
    check("the log has the pad as the browser named it, and what it was read as",
          await apiUntil(async () => ((await api("api/log.php?tail=200")).lines || []).some((l) => /PAD\s+seen: DualSense Wireless Controller .* \| layout standard \| 17 buttons, 4 axes \| read as playstation/.test(l)), 6000), true);

    /* ---- Start on the pad is the notice's Change ------------------------------ */
    await tap(9);
    check("Start, while the notice is up, opens Settings on Button names",
          await b.until(`(s => !s.hidden && !!s.querySelector('.opt.at select[data-key="buttonNames"]'))(document.getElementById("settings"))`, true, 5000), true);
    check("on Xsegon Controls, and the notice is put away",
          await b.ev(`[(document.querySelector("#settings .set-tab.on .tab-label") || {}).textContent, ${NOTICE}]`), ["Xsegon Controls", null]);
    check("the legend of Settings is in the pad's names too", await b.ev(keyFor("open")), ["Cross", "open", true]);

    /* ---- the setting overrules the pad, names only ---------------------------- */
    await b.ev(choose("nintendo"));
    check("Nintendo chosen: the legend changes where it is chosen, B to open and A to go back",
          await b.until(`[${keyFor("open")}, ${keyFor("back")}]`, [["B", "open", false], ["A", "back", false]], 4000), [["B", "open", false], ["A", "back", false]]);
    check("and it is kept", await apiUntil(async () => (await names()) === "nintendo"), true);
    await b.ev(choose("position"));
    check("By position: a mark for the place, drawn", await b.until(keyFor("open"), ["Bottom button", "open", true], 4000), ["Bottom button", "open", true]);
    await b.ev(choose("xbox"));
    check("Xbox: the letters there were", await b.until(`[${keyFor("open")}, ${keyFor("back")}]`, [["A", "open", false], ["B", "back", false]], 4000), [["A", "open", false], ["B", "back", false]]);
    await apiUntil(async () => (await names()) === "xbox");
    await shut();
    await b.goto();                                          // a changed setting draws the page again: a new page, a new stand-in
    await pad(IDS.ps5);
    await tap(15);
    check("with Xbox chosen, the PlayStation pad's press leaves Xbox letters", await b.until(keyFor("open system"), ["A", "open system", false], 3000), ["A", "open system", false]);
    await sleep(300);
    check("and says nothing: the names are the person's own choice", await b.ev(NOTICE), null);
    check("no button does anything else for it: the bottom one still opens a console",
          [await tap(0), await b.until(`document.getElementById("syswall").hidden`, true, 4000)][1], true);
    await b.settled();
    check("inside a console the shoulders are named as well", await b.until(keyFor("jump"), ["LB RB", "jump", false], 3000), ["LB RB", "jump", false]);

    /* ---- Automatic again: another kind is said, the same kind is not ---------- */
    await api("api/settings.php", { controller: { buttonNames: "auto" } });
    await b.goto();
    await pad(IDS.ps4);
    await tap(15);
    check("after a new start the same kind of pad is not said again", [await b.until(keyFor("open system"), ["Cross", "open system", true], 3000), await b.ev(NOTICE)], [["Cross", "open system", true], null]);
    await pad(IDS.xbox);
    await tap(15);
    check("an Xbox pad is another kind: its letters, and its notice",
          [await b.until(keyFor("open system"), ["A", "open system", false], 3000), await b.until(NOTICE, ["Xbox controller found", ["Xsegon shows Xbox button names."], "Change"], 3000)],
          [["A", "open system", false], ["Xbox controller found", ["Xsegon shows Xbox button names."], "Change"]]);
    await b.ev(`[...document.querySelectorAll("#toasts .toast-go button")].find((x) => x.textContent === "Change").click()`);
    check("its Change button opens Settings on Button names",
          await b.until(`(s => !s.hidden && !!s.querySelector('.opt.at select[data-key="buttonNames"]'))(document.getElementById("settings"))`, true, 5000), true);
    await shut();

    /* ---- a pad Xsegon does not know, out of the usual layout ------------------ */
    await pad(IDS.other, "");
    await tap(15);
    check("a pad it does not know keeps Xbox letters, and the notice says so and that its layout is not the usual one",
          [await b.until(keyFor("open system"), ["A", "open system", false], 3000), await b.until(NOTICE)],
          [["A", "open system", false], ["Controller found", ["Not one Xsegon knows: it shows Xbox button names.", "It is not in the usual layout: buttons may sit elsewhere."], "Change"]]);
    await b.ev(`document.querySelectorAll("#toasts .toast").forEach((n) => n.remove())`);

    /* ---- with Confirm with on B, the names follow the buttons ----------------- */
    await api("api/settings.php", { controller: { confirmButton: "b" } });
    await b.goto();
    await pad(IDS.ps5);
    await tap(15);
    check("Confirm with on B: Circle is what opens", await b.until(keyFor("open system"), ["Circle", "open system", true], 3000), ["Circle", "open system", true]);
    await b.ev(`document.querySelectorAll("#toasts .toast").forEach((n) => n.remove())`);
    await tap(1);
    check("and it does", await b.until(`document.getElementById("syswall").hidden`, true, 4000), true);
    await b.settled();
    check("a PlayStation pad's shoulders are L1 and R1, and Cross is back", await b.until(`[${keyFor("jump")}, (${keyFor("back to systems")} || [])[0]]`, [["L1 R1", "jump", false], "Cross"], 3000), [["L1 R1", "jump", false], "Cross"]);

    /* ---- the controller check: a picture that lights as you press ------------- */
    await api("api/settings.php", { controller: { confirmButton: "a" } });
    await b.goto();
    const several = (list) => b.ev(`window.__pdWas = window.__pdWas || navigator.getGamepads; window.__pdPads = ${JSON.stringify(list)}.map((p) => ({ id: p[0], mapping: p[1], connected: true, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: p[2] }, () => ({ pressed: false, value: 0 })) })); navigator.getGamepads = () => window.__pdPads`);
    const hold = (at, n, on, value) => b.ev(`(bt => { bt.pressed = ${!!on}; bt.value = ${on ? (value === undefined ? 1 : value) : 0}; })(window.__pdPads[${at}].buttons[${n}])`);
    const LIT = `[...document.querySelectorAll("#editor .padpic .pp-b.on")].map((g) => Number(g.dataset.b)).sort((x, y) => x - y)`;
    const SHOWN = `[document.querySelector("#editor .pp-name").textContent, document.querySelector("#editor .pp-name + .mt-note").textContent, document.querySelector("#editor .padpic").dataset.layout]`;
    const CHIPS = `[...document.querySelectorAll("#editor .pp-chip")].map((c) => [c.textContent, c.classList.contains("on")])`;
    const openCheck = async () => {
      await b.ev(`import("/js/settings-ui.js").then((m) => m.openSettingAt("controller", "buttonNames"))`);
      await b.until(`!document.getElementById("settings").hidden`, true, 5000);
      await b.ev(`(x => { x.closest(".opt").dispatchEvent(new MouseEvent("mousemove", { bubbles: true })); x.click(); })([...document.querySelectorAll("#settings .opt button")].find((x) => x.textContent === "Check a controller..."))`);
      return b.until(`[(document.querySelector("#editor .panel-title") || {}).textContent, document.getElementById("settings").hidden, !!document.querySelector("#editor .padpic")]`, ["CONTROLLER CHECK", true, true], 4000);
    };
    await several([[IDS.ps5, "standard", 18], [IDS.xbox, "standard", 17]]);
    await b.ev(`window.__pdPads[0].vibrationActuator = { type: "dual-rumble", playEffect: (kind, how) => { window.__pdShook = [kind, how.duration]; return Promise.resolve("complete"); } }`);
    const FACT = (k) => `(r => r ? r.querySelector(".pi-v").firstChild.textContent : null)([...document.querySelectorAll("#editor .pi-row")].find((r) => r.querySelector(".pi-k").textContent === ${JSON.stringify(k)}))`;
    check("Xsegon Controls > Controller check opens a picture of a controller, in place of Settings", await openCheck(), ["CONTROLLER CHECK", true, true]);
    check("the first controller is in it under the browser's name for it, with what it was read as, its sticks side by side",
          await b.until(SHOWN, [IDS.ps5, "Read as PlayStation. In the usual layout.", "level"], 3000), [IDS.ps5, "Read as PlayStation. In the usual layout.", "level"]);
    check("every controller found is listed, the one in the picture marked", await b.until(CHIPS, [["Controller 1: PlayStation", true], ["Controller 2: Xbox", false]], 3000), [["Controller 1: PlayStation", true], ["Controller 2: Xbox", false]]);
    check("the picture is an outline of the pad with its parts laid over it",
          await b.ev(`[document.querySelectorAll("#editor .padpic [data-b]").length, document.querySelectorAll("#editor .padpic .pp-body path").length]`), [16, 1]);
    check("beside the picture stand three boxes under headings: what is known of the controller, what it sends by number, then its sticks and triggers",
          await b.ev(`[[...document.querySelectorAll("#editor .pj-sect .pj-head")].map((h) => h.textContent), document.querySelectorAll("#editor .pj-sect .pp-n").length]`), [["This controller", "What it sends", "Sticks and triggers"], 18]);
    // The lines of This controller in their order, each with whether it is out of sight.
    const KNOWN = `[...document.querySelector("#editor .pj-sect").querySelectorAll(".pi-row")].map((r) => [r.querySelector(".pi-k").textContent, r.hidden])`;
    const MORE = `[...document.querySelectorAll("#editor .pi-row")].find((r) => r.querySelector(".pi-k").textContent === "More")`;
    check("the lines looked at most are in sight, its port second; the rest are behind More, which names them",
          await b.ev(`[${KNOWN}, ${FACT("More")}, ${MORE}.querySelector("button").textContent]`),
          [[["Name", false], ["Port", false], ["Model", false], ["In games", false], ["More", false], ["Maker", true], ["Handed over by", true], ["Layout", true], ["It sends", true], ["Rumble", true]],
           "Maker, Handed over by, Layout, It sends, Rumble", "Show"]);
    check("what is known is read off the name the browser gives: its own name, its model by its numbers, its maker, how it is handed over",
          await b.ev(`[${FACT("Name")}, ${FACT("Model")}, ${FACT("Maker")}, ${FACT("Handed over by")}]`),
          ["DualSense Wireless Controller", "DualSense (PlayStation 5), by the numbers it gives", "Sony (054c), product 0ce6", "The browser, reading the controller itself"]);
    check("with its port, its layout and what it sends", await b.ev(`[${FACT("Port")}, ${FACT("Layout")}, ${FACT("It sends")}]`),
          ["1, as the browser has it. A game numbers its players itself.", "The usual one: every button is where Xsegon looks for it", "18 buttons and 4 stick directions, a touchpad press among them"]);
    await b.ev(`${MORE}.querySelector("button").click()`);
    check("Show puts the rest in sight, and the button then hides them",
          await b.ev(`[${KNOWN}.filter((r) => r[1]).length, ${MORE}.querySelector("button").textContent]`), [0, "Hide"]);
    await b.ev(`[...document.querySelectorAll("#editor .pi-row")].find((r) => r.querySelector(".pi-k").textContent === "Rumble").querySelector("button").click()`);
    check("a controller that can shake says so, and Test shakes it for half a second", await b.until(`[${FACT("Rumble")}, window.__pdShook || null]`, ["Two motors", ["dual-rumble", 500]], 2000), ["Two motors", ["dual-rumble", 500]]);
    await hold(0, 0, true); await hold(0, 12, true); await hold(0, 17, true);
    check("what is held lights where it sits: the bottom button, up on the cross, the touchpad", await b.until(LIT, [0, 12, 17], 2000), [0, 12, 17]);
    check("the bottom button wears PlayStation's cross", await b.ev(`(g => [g.querySelector("title").textContent, !!g.querySelector(".pp-m")])(document.querySelector('#editor .padpic [data-b="0"]'))`), ["Cross", true]);
    check("and the same three light by their numbers under it", await b.ev(`[...document.querySelectorAll("#editor .pp-n.on")].map((n) => n.textContent)`), ["0", "12", "17"]);
    await hold(0, 0, false); await hold(0, 12, false); await hold(0, 17, false);
    await hold(0, 7, true, 0.5);
    await b.ev(`window.__pdPads[0].axes = [1, -1, 0, 0.5]`);
    check("a trigger fills as far as it is pulled, and each stick's knob goes where the stick does",
          await b.until(`[document.querySelector('#editor [data-pull="7"]').getAttribute("height"), document.querySelector('#editor [data-axis="0"]').getAttribute("transform"), document.querySelector('#editor [data-axis="2"]').getAttribute("transform")]`, ["12", "translate(10.0 -10.0)", "translate(0.0 5.0)"], 2000),
          ["12", "translate(10.0 -10.0)", "translate(0.0 5.0)"]);
    const MOVING = `[${FACT("Left stick")}, ${FACT("Right stick")}].map((t) => String(t).replace(/dead zone .[0-9.]+./, "dead zone (n)")).concat([${FACT("Triggers")}, ${FACT("New readings")}])`;
    const moved = ["1.41 from its centre, past the dead zone (n). Reached: left 0%, right 100%, up 100%, down 0%", "0.50 from its centre, past the dead zone (n). Reached: left 0%, right 0%, up 0%, down 50%",
                   "Left 0.00, right 0.50. Seen part way: they tell how far they are pulled", "Not told by this browser"];
    check("the sticks and triggers say how they stand: how far off centre against the dead zone, how far each has reached, a trigger seen part way", await b.until(MOVING, moved, 2000), moved);
    await hold(0, 7, false);
    await b.ev(`window.__pdPads[0].axes = [0, 0, 0, 0]`);
    await hold(0, 1, true); await sleep(300); await hold(0, 1, false); await sleep(200);
    check("the pad drives nothing else while it is open: the button that backs out does not close it", await b.ev(`[document.getElementById("editor").hidden, !!document.querySelector("#editor .padpic")]`), [false, true]);
    await hold(1, 3, true);
    check("the other controller's press puts it in the picture: its sticks apart, its top button a Y",
          await b.until(`[${SHOWN}, (document.querySelector('#editor .padpic [data-b="3"] text') || {}).textContent, ${LIT}, ${CHIPS}[1]]`, [[IDS.xbox, "Read as Xbox. In the usual layout.", "offset"], "Y", [3], ["Controller 2: Xbox", true]], 3000),
          [[IDS.xbox, "Read as Xbox. In the usual layout.", "offset"], "Y", [3], ["Controller 2: Xbox", true]]);
    check("an Xbox controller handed over by XInput says so, and that its model cannot be told",
          await b.ev(`[${FACT("Name")}, String(${FACT("Model")}).indexOf("Not told. Windows hands every Xbox-compatible controller over the same way") === 0, ${FACT("Maker")}, ${FACT("Handed over by")}, ${FACT("Rumble")}]`),
          ["Xbox 360 Controller", true, "Not told", "XInput, Windows' own way for Xbox controllers", "None the browser can reach"]);
    check("the rest stays in sight, as chosen, when another controller takes the picture", await b.ev(`[${KNOWN}.filter((r) => r[1]).length, ${MORE}.querySelector("button").textContent]`), [0, "Hide"]);
    await hold(1, 3, false);
    check("the log says which controller the check showed, which one of how many, and its port",
          await apiUntil(async () => ((await api("api/log.php?tail=200")).lines || []).some((l) => /PAD\s+check: showing Xbox 360 Controller .*read as xbox, names xbox, as Controller 2 of 2, port 2/.test(l)), 6000), true);
    await hold(1, 0, true); await hold(1, 9, true);
    check("Start held for a second leaves, and Settings stands there again with the bar where it was",
          await b.until(`[document.getElementById("editor").hidden, document.getElementById("settings").hidden, (document.querySelector("#settings .opt.at label") || { firstChild: {} }).firstChild.textContent]`, [true, false, "Controller check"], 4000),
          [true, false, "Controller check"]);
    await hold(1, 9, false);
    await sleep(400);
    check("a button still held on the way out is not a press in Settings: the row under the bar does not open the check again", await b.ev(`[document.getElementById("editor").hidden, document.getElementById("settings").hidden]`), [true, false]);
    await hold(1, 0, false); await sleep(200);
    await hold(1, 0, true); await sleep(180); await hold(1, 0, false);
    check("let go and pressed again, it is a press: the row opens the check again",
          await b.until(`[(document.querySelector("#editor .panel-title") || {}).textContent, document.getElementById("settings").hidden]`, ["CONTROLLER CHECK", true], 4000), ["CONTROLLER CHECK", true]);
    await b.key("Escape");
    check("and Esc closes it back onto Settings as well", await b.until(`[document.getElementById("editor").hidden, document.getElementById("settings").hidden]`, [true, false], 3000), [true, false]);

    /* A controller that goes: the one left must not stay "Controller 2". The
       chips count the ones still on, and with none left it says so. */
    await b.goto();
    await several([[IDS.ps5, "standard", 18], [IDS.xbox, "standard", 17]]);
    await openCheck();
    await b.until(CHIPS, [["Controller 1: PlayStation", true], ["Controller 2: Xbox", false]], 3000);
    await b.ev(`window.__pdPads[0] = null`);
    const left = [[["Controller 1: Xbox", true]], IDS.xbox, "2, as the browser has it. A game numbers its players itself."];
    check("the first of two switched off: the other is Controller 1 now and takes the picture, its port still 2",
          await b.until(`[${CHIPS}, ${SHOWN}[0], ${FACT("Port")}]`, left, 3000), left);
    check("the log has the one that went, and the one shown in its place as Controller 1 of 1 on port 2",
          await apiUntil(async () => { const lines = (await api("api/log.php?tail=200")).lines || [];
            return lines.some((l) => /PAD\s+check: DualSense Wireless Controller .* is gone from the browser's list/.test(l) && !/no other controller/.test(l))
                && lines.some((l) => /PAD\s+check: showing Xbox 360 Controller .*as Controller 1 of 1, port 2/.test(l)); }, 6000), true);
    await b.ev(`window.__pdPads[1] = null`);
    const none = ["That controller is gone: switched off, unplugged or out of reach.", 0, ["Nothing to tell until a controller has pressed a button."], 0, 0];
    check("the last one switched off: the picture says it is gone, and the boxes are as empty as at an opening",
          await b.until(`[document.querySelector("#editor .pp-name").textContent, document.querySelectorAll("#editor .pp-chip").length, [...document.querySelectorAll("#editor .pi-list .mt-note")].map((p) => p.textContent),
                         document.querySelectorAll("#editor .pi-row").length, document.querySelectorAll("#editor .pp-n").length]`, none, 3000), none);
    await several([[IDS.xbox, "standard", 17]]);
    check("switched on again, it is back in the picture as Controller 1", await b.until(`[${SHOWN}[0], ${CHIPS}]`, [IDS.xbox, [["Controller 1: Xbox", true]]], 3000), [IDS.xbox, [["Controller 1: Xbox", true]]]);
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`, true, 3000);

    await b.goto();
    await several([[IDS.other, "", 12]]);
    await openCheck();
    await hold(0, 2, true);
    check("a pad Xsegon does not know, out of the usual layout, says so and still lights by number",
          await b.until(`[${SHOWN}[1], [...document.querySelectorAll("#editor .pp-n")].length, [...document.querySelectorAll("#editor .pp-n.on")].map((n) => n.textContent)]`,
                        ["Not a kind Xsegon knows: Xbox names are shown. Not in the usual layout: a button may light somewhere other than where you pressed. Its numbers are under What it sends.", 12, ["2"]], 3000),
          ["Not a kind Xsegon knows: Xbox names are shown. Not in the usual layout: a button may light somewhere other than where you pressed. Its numbers are under What it sends.", 12, ["2"]]);
    await hold(0, 2, false);
    await b.key("Escape");
    check("Esc closes it", await b.until(`document.getElementById("editor").hidden`, true, 3000), true);
    // The same window from the heading of its section in Settings.
    const HEAD = `document.querySelector('#settings .set-sect[data-sect="Xsegon (Gamepad)"] .sect-head')`;
    await b.ev(`import("/js/settings-ui.js").then((m) => m.openSettingAt("controller", "buttonNames"))`);
    await b.until(`!document.getElementById("settings").hidden`, true, 5000);
    check("the Gamepad section's heading has View controller at its right end",
          await b.ev(`(h => { const g = h.querySelector(".sect-go"), at = g.getBoundingClientRect(); return [g.textContent, at.left > h.querySelector(".sect-name").getBoundingClientRect().left, h.getBoundingClientRect().right - at.right < 30]; })(${HEAD})`),
          ["View controller", true, true]);
    check("the RetroArch (Gamepad) heading has the same button",
          await b.ev(`(g => g ? g.textContent : null)(document.querySelector('#settings .set-sect[data-sect="RetroArch (Gamepad)"] .sect-head .sect-go'))`), "View controller");
    await b.ev(`${HEAD}.querySelector(".sect-go").click()`);
    check("it opens the same picture, and the press does not fold the section",
          await b.until(`[(document.querySelector("#editor .panel-title") || {}).textContent, document.getElementById("settings").hidden, ${HEAD}.parentNode.classList.contains("shut")]`, ["CONTROLLER CHECK", true, false], 4000),
          ["CONTROLLER CHECK", true, false]);
    await b.ev(`(() => { window.__pdNow = Date.now; const real = Date.now; Date.now = () => real() + 61000; })()`);
    check("with nothing pressed for a minute it closes by itself, onto Settings", await b.until(`[document.getElementById("editor").hidden, document.getElementById("settings").hidden]`, [true, false], 3000), [true, false]);
    await b.ev(`Date.now = window.__pdNow`);

    /* ---- Xsegon's buttons: the same picture over what each button does -------- */
    await api("api/settings.php", { controller: { confirmButton: "a", buttonNames: "auto", padJobs: {} } });
    await b.goto();
    await several([[IDS.ps5, "standard", 18], [IDS.xbox, "standard", 17]]);
    const press = async (at, n) => { await hold(at, n, true); await sleep(160); await hold(at, n, false); await sleep(160); };
    const LINES = `[...document.querySelectorAll("#editor .pj-row")].map((r) => [r.querySelector(".pj-job").textContent, r.querySelector(".pj-on").textContent, r.classList.contains("at"), r.classList.contains("catching")])`;
    const PICKED = `[...document.querySelectorAll("#editor .padpic .pick")].map((g) => g.dataset.b || g.dataset.mark)`;
    const ON_CLOSE = `document.querySelector("#editor .set-head .primary").classList.contains("pj-at")`;
    const kept = async () => (await api("api/settings.php")).settings.controller.padJobs;
    const openButtons = async () => {
      await b.ev(`import("/js/settings-ui.js").then((m) => m.openSettingAt("controller", "buttonNames"))`);
      await b.until(`!document.getElementById("settings").hidden`, true, 5000);
      await b.ev(`[...document.querySelectorAll("#settings .opt button")].find((x) => x.textContent === "Set buttons...").click()`);
      return b.until(`[(document.querySelector("#editor .panel-title") || {}).textContent, !!document.querySelector("#editor .padpic"), document.querySelectorAll("#editor .pj-row").length]`, ["XSEGON'S BUTTONS", true, 8], 4000);
    };
    check("Xsegon Controls > Xsegon's buttons opens the picture beside a line for each of the seven jobs and one to put them back", await openButtons(), ["XSEGON'S BUTTONS", true, 8]);
    check("the jobs are those of the controller in the picture, in its names",
          await b.until(`[document.querySelector("#editor .pp-whose").textContent, ${LINES}.slice(0, 2).map((r) => r.slice(0, 2))]`, ["Buttons for PlayStation controllers, as they come.", [["Play, open, yes", "Cross"], ["Back", "Circle"]]], 3000),
          ["Buttons for PlayStation controllers, as they come.", [["Play, open, yes", "Cross"], ["Back", "Circle"]]]);
    check("the lines stand in sections with headings, like a page of Settings",
          await b.ev(`[...document.querySelectorAll("#editor .pj-sect")].map((s) => [s.querySelector(".pj-head").textContent, s.querySelectorAll(".pj-row").length])`),
          [["Choosing", 2], ["On a game", 2], ["Getting around", 3], ["Putting them back", 1]]);
    check("each line is an icon, its words and what it does, and a small button at the right: no button the width of the panel",
          await b.ev(`[...document.querySelectorAll("#editor .pj-row")].every((r) => r.tagName === "DIV" && !!r.querySelector(".opt-ico svg") && r.querySelector(".pj-hint").textContent.length > 10 && (s => s.width > 60 && s.width < r.getBoundingClientRect().width / 2)(r.querySelector("button.pj-set").getBoundingClientRect()))`), true);
    check("a PlayStation button wears its shape on its line as well", await b.ev(`[...document.querySelectorAll("#editor .pj-row .pj-on")].map((n) => !!n.querySelector("svg.pj-key"))`), [true, true, true, true, false, false, false, false]);
    check("the picture stands beside the lines, not over them",
          await b.ev(`(() => { const p = document.querySelector("#editor .padpic").getBoundingClientRect(), s = document.querySelector("#editor .pj-sects").getBoundingClientRect(); return p.right <= s.left && p.top < s.bottom && p.bottom > s.top; })()`), true);
    check("opened with the mouse, nothing in the lines is lit: no line under the bar, no button marked on the picture, no ring on Close",
          await b.ev(`[${LINES}.some((r) => r[2]), ${PICKED}, ${ON_CLOSE}]`), [false, [], false]);
    await press(0, 13);
    check("down on the cross puts the bar on the first line, and the picture marks the button it is on", await b.until(`[${LINES}[0][2], ${PICKED}]`, [true, ["0"]], 2000), [true, ["0"]]);
    await press(0, 13);
    check("down again moves the bar, and the mark with it", await b.until(`[${LINES}[1][2], ${PICKED}]`, [true, ["1"]], 2000), [true, ["1"]]);
    await press(0, 0);
    check("the button that says yes starts that line listening", await b.until(`${LINES}[1]`, ["Back", "Press a button...", true, true], 2000), ["Back", "Press a button...", true, true]);
    await press(0, 12);
    check("the cross cannot take a job, and the line goes on listening",
          await b.until(`[document.querySelector("#editor .pj-told").textContent, ${LINES}[1][3]]`, ["The cross always moves in Xsegon, so it cannot take a job: press another button.", true], 2000),
          ["The cross always moves in Xsegon, so it cannot take a job: press another button.", true]);
    await press(0, 3);
    check("the next button is its button, and the job that button had takes the one left free",
          await b.until(`${LINES}.slice(0, 4).map((r) => r[1])`, ["Cross", "Triangle", "Square", "Circle"], 4000), ["Cross", "Triangle", "Square", "Circle"]);
    check("it is kept, for PlayStation controllers and no others",
          await apiUntil(async () => JSON.stringify(await kept()) === JSON.stringify({ playstation: { confirm: 0, back: 3, details: 2, menu: 1, pageUp: 4, pageDown: 5, top: 8 } })), true);
    check("and said: whose they are, and what moved",
          await b.until(`[document.querySelector("#editor .pp-whose").textContent, document.querySelector("#editor .pj-told").textContent]`, ["Buttons for PlayStation controllers, set by you.", "Back is on Triangle now. Menu took the button it left, so nothing is without one."], 3000),
          ["Buttons for PlayStation controllers, set by you.", "Back is on Triangle now. Menu took the button it left, so nothing is without one."]);
    check("the log has the change", await apiUntil(async () => ((await api("api/log.php?tail=200")).lines || []).some((l) => /PAD\s+buttons: playstation back = 3, menu takes the one it left/.test(l)), 6000), true);
    await press(0, 1);
    await sleep(200);
    check("the button that used to go back no longer closes the window", await b.ev(`document.getElementById("editor").hidden`), false);
    await press(0, 3);
    check("the one that goes back now does, onto Settings", await b.until(`[document.getElementById("editor").hidden, document.getElementById("settings").hidden]`, [true, false], 3000), [true, false]);
    await shut();
    await press(0, 15);
    check("on the consoles screen the legend follows: Circle is the menu now", await b.until(keyFor("menu"), ["Circle", "menu", true], 3000), ["Circle", "menu", true]);
    await b.ev(`document.querySelectorAll("#toasts .toast").forEach((n) => n.remove())`);
    await press(0, 1);
    check("and Circle opens it", await b.until(`!!document.querySelector(".ctx")`, true, 3000), true);
    await press(0, 3);
    check("Triangle, which goes back, puts it away", await b.until(`!document.querySelector(".ctx")`, true, 3000), true);
    await press(1, 15);
    check("the Xbox controller beside it keeps the standard buttons: Y is still its menu", await b.until(keyFor("menu"), ["Y", "menu", false], 3000), ["Y", "menu", false]);
    await b.ev(`document.querySelectorAll("#toasts .toast").forEach((n) => n.remove())`);

    await openButtons();
    await b.until(`document.querySelector("#editor .pp-whose").textContent`, "Buttons for PlayStation controllers, set by you.", 3000);
    check("opened with a controller in use, the bar is drawn where it starts, on Close, and no line wears it", await b.ev(`[${ON_CLOSE}, ${LINES}.some((r) => r[2])]`), [true, false]);
    await b.ev(`document.querySelector("#editor .pj-std .pj-set").click()`);
    check("Standard layout's Put back puts them back, and that is kept",
          [await b.until(`${LINES}.slice(0, 4).map((r) => r[1])`, ["Cross", "Circle", "Square", "Triangle"], 4000), await apiUntil(async () => Object.keys(await kept()).length === 0)],
          [["Cross", "Circle", "Square", "Triangle"], true]);
    await b.ev(`document.querySelector('#editor .pj-row[data-job="details"] .pj-set').click()`);
    check("a click on a line's button starts it listening too", await b.until(`${LINES}[2]`, ["Details", "Press a button...", true, true], 2000), ["Details", "Press a button...", true, true]);
    await b.key("Escape");
    check("Esc ends the listening and leaves the window open", await b.until(`[${LINES}[2][1], document.getElementById("editor").hidden]`, ["Square", false], 2000), ["Square", false]);
    await b.ev(`document.querySelector('#editor .pj-row[data-job="menu"]').dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))`);
    check("the bar follows the pointer over the lines", await b.until(`${LINES}.map((r) => r[2])`, [false, false, false, true, false, false, false, false], 2000), [false, false, false, true, false, false, false, false]);
    await b.ev(`document.querySelector("#editor .pj-sects").dispatchEvent(new MouseEvent("mouseleave"))`);
    check("and leaves them when the pointer does: back on Close, nothing marked on the picture", await b.until(`[${LINES}.some((r) => r[2]), ${PICKED}, ${ON_CLOSE}]`, [false, [], true], 2000), [false, [], true]);
    await press(0, 0);
    check("with the bar on Close, the button that says yes closes the window, onto Settings", await b.until(`[document.getElementById("editor").hidden, document.getElementById("settings").hidden]`, [true, false], 3000), [true, false]);
    await shut();

    /* ---- the round X > Controller..., and from one window to the other -------- */
    await b.setView("grid");
    await b.openBar("xsegon");
    await b.menuItem(/^Controller\.\.\.$/);
    check("the round X > Controller... opens the controller check",
          await b.until(`[(document.querySelector("#editor .panel-title") || {}).textContent, !!document.querySelector("#editor .padpic")]`, ["CONTROLLER CHECK", true], 4000), ["CONTROLLER CHECK", true]);
    const headButton = (words) => `[...document.querySelectorAll("#editor .set-head button")].find((x) => x.textContent === ${JSON.stringify(words)}).click()`;
    await b.ev(headButton("Set buttons..."));
    check("its Set buttons... turns the window to Xsegon's buttons",
          await b.until(`[(document.querySelector("#editor .panel-title") || {}).textContent, document.querySelectorAll("#editor .pj-row").length]`, ["XSEGON'S BUTTONS", 8], 4000), ["XSEGON'S BUTTONS", 8]);
    await b.ev(headButton("Check a controller..."));
    check("and Check a controller... turns it back",
          await b.until(`[(document.querySelector("#editor .panel-title") || {}).textContent, document.querySelectorAll("#editor .pj-row").length, document.querySelectorAll("#editor .pp-n").length > 0]`, ["CONTROLLER CHECK", 0, true], 4000), ["CONTROLLER CHECK", 0, true]);
    await b.key("Escape");
    check("Esc closes it", await b.until(`document.getElementById("editor").hidden`, true, 3000), true);

    /* ---- the top of the screen by controller (js/padtop.js) -------------------- */
    sideWas = (await api("api/settings.php")).settings.view.sidebar;
    await api("api/settings.php", { view: { sidebar: true } });
    await b.goto();
    await several([[IDS.xbox, "standard", 17]]);
    const AT = `(n => n ? (n.id || n.dataset.menu || (n.classList.contains("sb-item") ? "side:" + n.dataset.key : n.className)) : null)(document.querySelector(".pad-at"))`;
    await press(0, 15);
    check("the legend names the button that goes up to the top menus", await b.until(keyFor("top menus"), ["View", "top menus", false], 3000), ["View", "top menus", false]);
    await press(0, 8);
    check("on the consoles screen that button puts the bar on Settings, and the legend says how to come back",
          await b.until(`[${AT}, (${keyFor("back to the games")} || [])[0]]`, ["btn-settings", "B"], 3000), ["btn-settings", "B"]);
    await press(0, 14);
    check("left moves it along the masthead, to the view picker", await b.until(AT, "viewsel", 2000), "viewsel");
    // On a wheel the wordmark is the round X (js/menus.js): the masthead's first stop, and yes opens its menu.
    const walk = async (button, to) => { for (let i = 0; i < 8 && (await b.ev(AT)) !== to; i++) { await press(0, button); } return b.until(AT, to, 2000); };
    check("further left, the bar ends on the wordmark", await walk(14, "brand-logo"), "brand-logo");
    await press(0, 0);
    check("yes there opens the round X's menu with the bar on the first entry, and lights the wordmark",
          await b.until(`[(document.querySelector(".ctx-item.at .ctx-label") || {}).textContent, document.getElementById("brand-logo").classList.contains("open")]`, ["Settings...", true], 3000), ["Settings...", true]);
    await press(0, 1);
    check("the button that goes back puts it away and leaves the bar on the wordmark", await b.until(`[!!document.querySelector(".ctx"), ${AT}]`, [false, "brand-logo"], 3000), [false, "brand-logo"]);
    check("(and right walks back to the view picker)", await walk(15, "viewsel"), "viewsel");
    await press(0, 0);
    check("the button that says yes opens the picker as a menu of Xsegon's own, standing on the view in use",
          await b.until(`[[...document.querySelectorAll(".ctx .ctx-label")].map((n) => n.textContent), (document.querySelector(".ctx-item.at .ctx-label") || {}).textContent]`, [["List", "Grid", "Shelf", "Wheel", "Carousel", "Rows"], "Wheel"], 3000),
          [["List", "Grid", "Shelf", "Wheel", "Carousel", "Rows"], "Wheel"]);
    await press(0, 12); await press(0, 12);
    await press(0, 0);
    check("a choice made there is taken (Grid), and the bar goes back to the games",
          await b.until(`[document.getElementById("viewsel").value, document.getElementById("view").classList.contains("grid"), ${AT}]`, ["grid", true, null], 6000), ["grid", true, null]);
    await b.settled();
    await press(0, 8);
    check("with the menu bar up the bar starts on the round X", await b.until(AT, "xsegon", 3000), "xsegon");
    await press(0, 0);
    check("yes opens its menu with the bar on the first entry", await b.until(`(document.querySelector(".ctx-item.at .ctx-label") || {}).textContent`, "Settings...", 3000), "Settings...");
    await press(0, 15);
    check("right, in a menu of the bar, opens the menu beside it and takes the bar along",
          await b.until(`[(document.querySelector("#mb button.open") || { dataset: {} }).dataset.menu, ${AT}, (document.querySelector(".ctx-item.at .ctx-label") || {}).textContent]`, ["games", "games", "Add Games..."], 3000),
          ["games", "games", "Add Games..."]);
    await press(0, 1);
    check("the button that goes back puts the menu away and leaves the bar where it was", await b.until(`[!!document.querySelector(".ctx"), ${AT}]`, [false, "games"], 3000), [false, "games"]);
    await press(0, 12);
    check("up goes to the masthead's buttons", await b.until(`!!document.querySelector("header.top .pad-at")`, true, 2000), true);
    await press(0, 13);
    check("down comes back to the bar", await b.until(`!!document.querySelector("#toolbar .pad-at")`, true, 2000), true);
    await press(0, 8);
    check("the same button again gives the bar back to the games", await b.until(AT, null, 2000), null);
    await press(0, 8);
    await b.until(AT, "xsegon", 3000);
    await press(0, 13);
    check("down from the round X goes into the list of consoles at the side, on the one showing", await b.until(AT, "side:", 3000), "side:");
    await press(0, 13);
    await sleep(200);
    const picked = await b.ev(`(n => n ? n.dataset.key : null)(document.querySelector(".sb-item.pad-at"))`);
    check("down again steps to the first console", typeof picked === "string" && picked.length > 0, true);
    await press(0, 0);
    check("yes there chooses that console, and the bar goes back to its games",
          await b.until(`[document.getElementById("platform").value, ${AT}]`, [picked, null], 6000), [picked, null]);
    await b.settled();
    await press(0, 8);
    await b.until(AT, "xsegon", 3000);
    await press(0, 1);
    check("the button that goes back returns to the games, and the legend with it", await b.until(`[${AT}, (${keyFor("top menus")} || [])[0]]`, [null, "View"], 3000), [null, "View"]);
    check("the log has the walk", await apiUntil(async () => ((await api("api/log.php?tail=300")).lines || []).some((l) => /PAD\s+top: press viewsel/.test(l)), 6000), true);

    /* ---- a window by controller (js/padwin.js) ---------------------------------
       First a stand-in window in the page's own frame, so what is in it is
       known; then the log's window and the mailbox as they are. */
    const WAT = `(n => n ? (n.id || n.textContent.trim() || n.tagName) : null)(document.querySelector("#editor .pad-at, #mailbox .pad-at"))`;
    await b.ev(`(async () => { const E = await import("/js/editors.js"), St = await import("/js/state.js");
      const mk = (tag, id, words, css) => { const n = document.createElement(tag); n.id = id; if (words) { n.textContent = words; } if (css) { n.style.cssText = css; } return n; };
      const inner = E.toolFrame("PAD WINDOW");
      const r1 = mk("div", "pw-r1", "", "display:flex;gap:12px;align-items:center");
      const one = mk("button", "pw-one", "One", "width:80px"); one.onclick = () => { window.__pwOne = (window.__pwOne || 0) + 1; };
      const sw = mk("input", "pw-sw"); sw.type = "checkbox";
      const dd = mk("select", "pw-dd", "", "width:100px"); ["Red", "Green", "Blue"].forEach((c) => { const o = document.createElement("option"); o.value = c.toLowerCase(); o.textContent = c; dd.appendChild(o); });
      r1.append(one, sw, dd);
      const r2 = mk("div", "pw-r2", "", "display:flex;gap:12px;align-items:center;margin-top:12px");
      const tx = mk("input", "pw-box", "", "width:120px;flex:none"); tx.type = "text";
      const sl = mk("input", "pw-sl", "", "width:120px;flex:none"); sl.type = "range"; sl.min = 0; sl.max = 10; sl.value = 5;
      r2.append(tx, sl);
      const rows = mk("div", "pw-list", "", "height:90px;overflow-y:auto;margin-top:12px");
      for (let i = 1; i <= 6; i++) { rows.appendChild(mk("button", "pw-row" + i, "Row " + i, "display:block;height:28px;margin:2px 0")); }
      inner.append(r1, r2, rows, mk("div", "pw-tall", "a long text", "height:3000px"), mk("button", "pw-last", "Last"));
      St.$editor.appendChild(inner); St.$editor.hidden = false; return true; })()`);
    await sleep(300);
    check("a window opens with nothing lit: the bar waits for the controller to move", await b.ev(WAT), null);
    await press(0, 13);
    check("the first move lights the first thing under the window's heading, and moves nowhere yet", await b.until(WAT, "pw-one", 3000), "pw-one");
    await press(0, 15);
    await press(0, 0);
    check("right steps along the row, and the button that says yes sets a switch", await b.until(`[${WAT}, document.getElementById("pw-sw").checked]`, ["pw-sw", true], 3000), ["pw-sw", true]);
    await press(0, 15);
    await press(0, 0);
    check("a dropdown opens as a menu of Xsegon's own, standing on the choice in use",
          await b.until(`[[...document.querySelectorAll(".ctx .ctx-label")].map((n) => n.textContent), (document.querySelector(".ctx-item.at .ctx-label") || {}).textContent]`, [["Red", "Green", "Blue"], "Red"], 3000),
          [["Red", "Green", "Blue"], "Red"]);
    await press(0, 13);
    await press(0, 0);
    check("a choice made there is taken, and the bar is still on the dropdown", await b.until(`[document.getElementById("pw-dd").value, !!document.querySelector(".ctx"), ${WAT}]`, ["green", false, "pw-dd"], 3000), ["green", false, "pw-dd"]);
    await press(0, 14); await press(0, 14);
    await press(0, 0);
    check("left walks back along the row, and yes presses a button once", await b.until(`[${WAT}, window.__pwOne || 0]`, ["pw-one", 1], 3000), ["pw-one", 1]);
    await press(0, 13);
    await press(0, 0);
    check("down goes to the row under it, and yes in a box for typing gives it the caret", await b.until(`[${WAT}, document.activeElement.id]`, ["pw-box", "pw-box"], 3000), ["pw-box", "pw-box"]);
    await press(0, 1);
    check("the button that goes back leaves the box, and the window stays", await b.until(`[document.activeElement.id === "pw-box", document.getElementById("editor").hidden, ${WAT}]`, [false, false, "pw-box"], 3000), [false, false, "pw-box"]);
    await press(0, 15);
    await press(0, 15);
    check("on a slider, right moves the slider and not the bar", await b.until(`[${WAT}, document.getElementById("pw-sl").value]`, ["pw-sl", "6"], 3000), ["pw-sl", "6"]);
    await press(0, 13); await press(0, 13); await press(0, 13); await press(0, 13);
    check("down walks into a list that scrolls by itself, and the list scrolls to keep the bar in sight",
          await b.until(`[${WAT}, document.getElementById("pw-list").scrollTop > 0]`, ["pw-row4", true], 3000), ["pw-row4", true]);
    await press(0, 5); await press(0, 5);
    await press(0, 4);
    check("RB and LB step through everything in order", await b.until(WAT, "pw-row5", 3000), "pw-row5");
    await press(0, 5);
    await press(0, 13);
    check("with a long text before the next thing, down scrolls the window and the bar stays where it is",
          await b.until(`[${WAT}, document.getElementById("editor").scrollTop > 0]`, ["pw-row6", true], 3000), ["pw-row6", true]);
    const rolledFrom = await b.ev(`document.getElementById("editor").scrollTop`);
    await b.ev(`window.__pdPads[0].axes = [0, 0, 0, 1]`);
    await sleep(400);
    await b.ev(`window.__pdPads[0].axes = [0, 0, 0, 0]`);
    check("the right stick scrolls the window", (await b.ev(`document.getElementById("editor").scrollTop`)) > rolledFrom + 60, true);
    await press(0, 1);
    check("the button that goes back closes the window, and nothing is left lit", await b.until(`[document.getElementById("editor").hidden, document.querySelectorAll(".pad-at").length]`, [true, 0], 3000), [true, 0]);
    check("the log has the walk through the window", await apiUntil(async () => ((await api("api/log.php?tail=300")).lines || []).some((l) => /PAD\s+window: press pw-one/.test(l)), 6000), true);

    await b.ev(`import("/js/tools.js").then((m) => { m.openLogViewer(); return true; })`);
    await b.until(`(document.querySelector("#editor .panel-title") || {}).textContent`, "THE LOG", 5000);
    await press(0, 13);
    check("the log's own window: the first move lights its filter box", await b.until(WAT, "INPUT", 3000), "INPUT");
    await press(0, 15);
    await b.until(WAT, "More", 3000);
    await b.ev(`document.querySelector("#editor .pad-at").dataset.was = "1"`);
    await press(0, 0);
    check("More pressed there draws the window again, and the bar is back on the new More",
          await b.until(`(n => n ? [n.textContent, n.dataset.was || null] : null)(document.querySelector("#editor .pad-at"))`, ["More", null], 6000), ["More", null]);
    await b.key("Tab");
    check("a key pressed takes the bar off: the keyboard has the window", await b.until(WAT, null, 3000), null);
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`, true, 3000);
    await b.ev(`import("/js/news.js").then((m) => m.openMail())`);
    await b.until(`!!document.querySelector("#mailbox:not([hidden]) .mail-head .primary")`, true, 5000);
    await sleep(400);
    await press(0, 13);
    check("the mailbox is walked the same way", await b.until(`!!document.querySelector("#mailbox .pad-at")`, true, 3000), true);
    await press(0, 1);
    check("and the button that goes back closes it", await b.until(`[document.getElementById("mailbox").hidden, document.querySelectorAll(".pad-at").length]`, [true, 0], 3000), [true, 0]);

    await api("api/settings.php", { controller: { padJobs: { playstation: { confirm: 0, back: 0, details: 2, menu: 3, pageUp: 4, pageDown: 5 } } } });
    await b.goto();
    await several([[IDS.ps5, "standard", 18]]);
    await press(0, 15);
    check("a kept set of buttons that is not whole (two jobs on one button) is not used", await b.until(`[(${keyFor("open system")} || [])[0], (${keyFor("menu")} || [])[0]]`, ["Cross", "Triangle"], 3000), ["Cross", "Triangle"]);

    /* ---- watching for a ghost (js/padghost.js): the log, and nothing else ----
       Another program can make one press arrive twice: keys sent beside its
       buttons (Steam's Desktop Layout), or a made-up pad beside the real one
       (DS4Windows). Xsegon only logs it. Button 11 does nothing here. */
    const logTail = async () => {
      await b.ev(`import("/js/log.js").then((m) => { m.flushLog(); })`);
      await sleep(300);
      return (await api("api/log.php?tail=300")).lines || [];
    };
    await several([[IDS.xbox, "standard", 17]]);
    await sleep(250);                                        // looked at once with nothing held
    const logWas = await logTail(), lastWas = logWas[logWas.length - 1];
    // The ghost lines written from here on: an earlier run's are not this one's.
    const ghosts = async () => { const all = await logTail(), at = all.lastIndexOf(lastWas); return (at < 0 ? all : all.slice(at + 1)).filter((l) => /PAD\s+ghost /.test(l)); };
    await press(0, 11);
    check("a press with no key near it and no second pad writes nothing", (await ghosts()).length, 0);
    // The pad goes down in the instant the key arrives, as it does when another program sends the key.
    await b.ev(`document.addEventListener("keydown", () => { window.__pdPads[0].buttons[11].pressed = true; }, { once: true, capture: true })`);
    await b.key("Shift");
    check("a key in the same instant as a press on the pad is written to the log",
          await apiUntil(async () => (await ghosts()).some((l) => /ghost key: Shift came \d+ ms before button 11 was seen held on controller 0/.test(l)), 6000), true);
    await hold(0, 11, false);
    await several([[IDS.ps4, "standard", 18], [IDS.xbox, "standard", 17]]);
    await sleep(250);
    await b.ev(`window.__pdPads[0].buttons[11].pressed = window.__pdPads[1].buttons[11].pressed = true`);
    check("two pads pressing the same button together are written as one controller shown twice, by name",
          await apiUntil(async () => (await ghosts()).some((l) => /ghost twin: controllers 0 and 1 both pressed button 11/.test(l) && l.includes(IDS.ps4) && l.includes(IDS.xbox)), 6000), true);
    await b.ev(`window.__pdPads[0].buttons[11].pressed = window.__pdPads[1].buttons[11].pressed = false`);

    /* ---- a pad the browser does not know, read from the shared list --------
       The list SDL programs share (includes/padlist) says which button is
       which by maker and product numbers. The stand-in has the list's first
       Windows line's numbers, handed over raw. */
    const boxed = await api("api/padlist.php?vendor=0f30&product=010a");
    check("the shared list answers for a pad it has: its name, and which of its buttons is the bottom one",
          [boxed.ok, boxed.found, boxed.name, JSON.stringify((boxed.parts || {}).a)], [true, true, "3 In 1 Conversion Box", '["b",2]']);
    check("a pad it does not have is said so, and numbers that are not numbers are refused",
          [(await api("api/padlist.php?vendor=ffff&product=ffff")).found, (await api("api/padlist.php?vendor=zz&product=1")).ok], [false, false]);
    check("the setting that uses it comes switched on", (await api("api/settings.php")).defaults.controller.sharedPadList, true);
    const NOW = (what) => `import("/js/padlist.js").then((m) => (p => ${what})(m.padsNow()[0]))`;
    await several([["USB Gamepad (Vendor: 0f30 Product: 010a)", "", 12]]);
    check("a raw pad the list has is given to Xsegon in the usual layout, under the list's name",
          await b.until(NOW(`[p.mapping, p.listed || null, p.buttons.length]`), ["standard", "3 In 1 Conversion Box", 17], 6000), ["standard", "3 In 1 Conversion Box", 17]);
    await hold(0, 2, true);
    check("its button 2 is the bottom face button, as the list says", await b.until(NOW(`[p.buttons[0].pressed, p.buttons[2].pressed]`), [true, false], 3000), [true, false]);
    await hold(0, 2, false);
    await several([[IDS.xbox, "standard", 17]]);
    check("a pad the browser knows is passed on untouched", await b.ev(`import("/js/padlist.js").then((m) => m.padsNow()[0] === window.__pdPads[0])`), true);

    /* ---- a controller wrong inside a game: the window that says what to do ----
       Xsegon does not teach RetroArch a controller; it says how RetroArch
       is taught, in RetroArch's words, and opens RetroArch on that page. */
    const binds = await api("api/retroarch.php", { page: "binds", dry: true });
    check("RetroArch can be asked to open on RetroPad Binds", [binds.ok, binds.where || (binds.jump || {}).where || null], [true, "Settings > Input > RetroPad Binds"]);
    await b.ev(`import("/js/padhelp.js").then((m) => m.openPadGameHelp())`);
    check("the window says the steps, and which way RetroArch reads controllers",
          await b.until(`[(document.querySelector("#editor .panel-title") || {}).textContent, document.querySelectorAll("#editor .pj-sect").length, [...document.querySelectorAll("#editor .pi-k")].filter((k) => /^Step /.test(k.textContent)).length,
                          [...document.querySelectorAll("#editor .set-head button")].map((x) => x.textContent).join("|"), /reading/.test(document.querySelector("#editor").textContent)]`,
                        ["A CONTROLLER IN GAMES", 2, 5, "Open RetroArch|Close (esc)", false], 8000),
          ["A CONTROLLER IN GAMES", 2, 5, "Open RetroArch|Close (esc)", false]);
    await b.key("Escape");
    check("and Esc closes it", await b.until(`document.getElementById("editor").hidden`, true, 3000), true);

    /* ---- found or not, written down for whoever reads a report ----------------
       A page hears a controller only once it presses, so the log gets what
       Windows lists, what the picture found as it closes, and which pressed
       as the page leaves. Each is counted before and after, since a line
       already in the day log proves nothing. */
    const TEST_PAD = "Xsegon Test Pad 7 (Vendor: 1a2b Product: 3c4d)";
    // Counted over the whole day log on the disk: in a tail of it, old lines slide out as new ones come.
    const dayLog = (await api("api/log.php?tail=1")).file;
    const count = async (re) => (fs.existsSync(dayLog) ? fs.readFileSync(dayLog, "utf8").split("\n") : []).filter((l) => re.test(l)).length;
    const grows = async (re, was) => {
      await b.ev(`import("/js/log.js").then((m) => { m.flushLog(); })`);
      return !!(await apiUntil(async () => (await count(re)) > was, 6000));
    };
    const openPic = async () => {
      await b.ev(`import("/js/padcheck.js").then((m) => m.openPadCheck())`);
      return b.until(`(document.querySelector("#editor .panel-title") || {}).textContent`, "CONTROLLER CHECK", 4000);
    };
    const shutPic = async () => { await b.key("Escape"); return b.until(`document.getElementById("editor").hidden`, true, 3000); };
    const leave = () => b.ev(`window.dispatchEvent(new Event("pagehide"))`);
    const WINDOWS = / S PAD\s+Windows (lists|could not be asked) .*\(as the page opened\)$/;
    const NO_PAD = / P PAD\s+check: closed after \d+ s: no controller pressed a button, 2 keyboard keys pressed; Windows (lists|could not be asked) /;
    const SHOWED = / P PAD\s+check: closed after \d+ s: showed Xsegon Test Pad 7 \(Vendor: 1a2b Product: 3c4d\), 0 keyboard keys pressed/;
    const LEFT_ONE = / P PAD\s+1 controller pressed a button while this page was open: Xsegon Test Pad 7 \(Vendor: 1a2b Product: 3c4d\) \(\d+ min\)/;
    const LEFT_NONE = / P PAD\s+no controller pressed a button while this page was open \(\d+ min\)/;

    let was = await count(WINDOWS);
    await b.goto();
    await b.ev(`window.__pdWas = window.__pdWas || navigator.getGamepads; navigator.getGamepads = () => []`);
    check("as a page opens, the log gets what Windows lists as plugged in", await grows(WINDOWS, was), true);
    was = await count(NO_PAD);
    check("(the controller picture opens with no controller)", await openPic(), "CONTROLLER CHECK");
    check("the picture says from the start that keyboard keys light nothing in it",
          await b.ev(`/Keyboard keys light nothing here\\.$/.test(document.querySelector("#editor .pp-name + .mt-note").textContent)`), true);
    await b.key("z");
    check("a keyboard key pressed in it is answered in words, with where a game's keys are set",
          await b.until(`document.querySelector("#editor .pj-told").textContent`, "That was a key on the keyboard. This picture lights for a controller's buttons only. The keys a game takes from the keyboard are in Settings > RetroArch + Emulator Controls > RetroArch (Keyboard).", 2000),
          "That was a key on the keyboard. This picture lights for a controller's buttons only. The keys a game takes from the keyboard are in Settings > RetroArch + Emulator Controls > RetroArch (Keyboard).");
    await b.key("x");
    await sleep(800);                                          // Windows' answer is in by then
    await shutPic();
    check("closed with no controller, the picture says so in the log, with the keyboard keys pressed in it and Windows' own list", await grows(NO_PAD, was), true);
    was = await count(LEFT_NONE);
    await leave();
    check("and as the page leaves, the log says no controller pressed a button", await grows(LEFT_NONE, was), true);

    /* Under the picture, until a controller presses: what Windows lists. The
       list is a stand-in here, so each answer is seen whatever is plugged in. */
    const windowsSaid = (answer) => b.ev(`(() => { window.__ppReal = window.__ppReal || window.fetch; const said = ${JSON.stringify(JSON.stringify(answer))};
      window.fetch = function (u, o) { return String(u).indexOf("api/pad-plugged.php?for=check") >= 0 ? Promise.resolve(new Response(said)) : window.__ppReal.call(window, u, o); }; })()`);
    const UNDER = `[document.querySelector("#editor .pp-name").textContent, document.querySelector("#editor .pp-name + .mt-note").textContent]`;
    const KEYS = " Keyboard keys light nothing here.";
    await b.goto();
    await b.ev(`window.__pdWas = window.__pdWas || navigator.getGamepads; navigator.getGamepads = () => []`);
    await windowsSaid({ ok: true, asked: true, pads: [], words: "Windows lists no game controller plugged in" });
    await openPic();
    check("with none in Windows' list the picture says no controller is detected, and what to do",
          await b.until(UNDER, ["No controller detected.", "Plug one in or switch it on, then press a button on it with Xsegon in front." + KEYS], 3000),
          ["No controller detected.", "Plug one in or switch it on, then press a button on it with Xsegon in front." + KEYS]);
    await shutPic();
    await windowsSaid({ ok: true, asked: true, words: "", pads: [{ vendor: "045e", product: "0b13", xbox: true, name: "Xbox Series X Controller" }] });
    await openPic();
    check("with one in the list it names the controller and asks for a press",
          await b.until(UNDER, ["Windows sees a controller: Xbox Series X Controller.", "Press a button on it with Xsegon in front and it shows here." + KEYS], 3000),
          ["Windows sees a controller: Xbox Series X Controller.", "Press a button on it with Xsegon in front and it shows here." + KEYS]);
    await shutPic();
    await windowsSaid({ ok: true, asked: true, words: "", pads: [{ vendor: "045e", product: "0b13", xbox: true, name: "Xbox Series X Controller" }, { vendor: "045e", product: "0b13", xbox: true, name: "Xbox Series X Controller" },
      { vendor: "1a2b", product: "3c4d", xbox: false, name: "" }, { vendor: "0e6f", product: "0001", xbox: true, name: "" }] });
    await openPic();
    check("two of one model are counted and named once with how many, and one with no name on record is said by its numbers or as an Xbox controller",
          await b.until(UNDER, ["Windows sees 4 controllers: Xbox Series X Controller (2), one with no name on record (1a2b:3c4d), an Xbox controller.", "Press a button on one with Xsegon in front and it shows here." + KEYS], 3000),
          ["Windows sees 4 controllers: Xbox Series X Controller (2), one with no name on record (1a2b:3c4d), an Xbox controller.", "Press a button on one with Xsegon in front and it shows here." + KEYS]);
    await shutPic();
    await windowsSaid({ ok: true, asked: false, pads: [], words: "Windows could not be asked which game controllers are plugged in (this PHP cannot ask Windows)" });
    await openPic();
    await sleep(500);
    check("where Windows could not be asked the words stay as they were", await b.ev(UNDER),
          ["Press any button on a controller.", "A controller shows up here once one of its buttons has been pressed with Xsegon in front." + KEYS]);
    await shutPic();
    await windowsSaid({ ok: true, asked: true, pads: [], words: "Windows lists no game controller plugged in" });
    await pad(TEST_PAD);
    await tap(0);
    await openPic();
    await sleep(500);
    check("and a controller that has pressed is shown, whatever Windows listed", await b.ev(`${UNDER}[0]`), TEST_PAD);
    await shutPic();
    await b.ev(`if (window.__ppReal) { window.fetch = window.__ppReal; }`);

    await b.goto();
    await pad(TEST_PAD);
    await tap(0);
    was = await count(SHOWED);
    await openPic();
    check("(the stand-in controller is in the picture)", await b.until(`document.querySelector("#editor .pp-name").textContent`, TEST_PAD, 3000), TEST_PAD);
    await shutPic();
    check("closed with a controller in it, the picture names that controller in the log", await grows(SHOWED, was), true);
    was = await count(LEFT_ONE);
    await leave();
    check("and as the page leaves, the log names the controller that pressed a button", await grows(LEFT_ONE, was), true);

    const logWasOn = ((await api("api/settings.php")).settings.debug || {}).logging !== false;
    const logFile = (await api("api/log.php?tail=20")).file;
    try {
      await api("api/settings.php", { debug: { logging: false } });
      await b.goto();
      await sleep(700);
      const mark = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
      const asks = `performance.getEntriesByType("resource").filter((e) => e.name.indexOf("pad-plugged.php") >= 0).map((e) => e.name.split("for=")[1])`;
      check("with logging off a page does not ask Windows as it opens: that ask is for a log line alone", await b.ev(asks), []);
      await openPic();
      await b.key("z");
      await sleep(500);
      await shutPic();
      await leave();
      await sleep(1200);
      check("the picture still asks, once, for the words under it", await b.ev(asks), ["check"]);
      check("and not one of these lines reaches the day log",
            (fs.existsSync(logFile) ? fs.readFileSync(logFile).subarray(mark).toString("utf8") : "").split("\n").filter((l) => /^\d\d:\d\d:\d\d\.\d{3} (P |S (PAD|REQ)\b)/.test(l)), []);
    } finally {
      await api("api/settings.php", { debug: { logging: logWasOn } });
      await b.goto();
    }
  } finally {
    await b.ev(`if (window.__pdWas) { navigator.getGamepads = window.__pdWas; }`);
    await b.key("Shift");                                    // the legend goes back to the keys
    await api("api/settings.php", { controller: { enabled: before.enabled !== false, confirmButton: before.confirmButton === "b" ? "b" : "a", buttonNames: before.buttonNames || "auto", padJobs: before.padJobs || {},
                                                  deadzone: before.deadzone || 0.35 },
                                    view: Object.assign({ default: "wheel", systemsFirst: true, systemsStyle: "wheel" }, sideWas === undefined ? {} : { sidebar: sideWas }) });
  }
};
