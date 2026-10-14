/*  What the browser tells of a controller: name, maker and model, how Windows
    hands it over, and how its sticks and triggers behave now. A line that
    cannot be known says so. Nothing here touches the page (js\padcheck.js shows it). */

var MAKERS = {
  "045e": "Microsoft", "054c": "Sony", "057e": "Nintendo", "28de": "Valve", "2dc8": "8BitDo", "046d": "Logitech",
  "0f0d": "Hori", "0e6f": "PDP", "20d6": "PowerA", "24c6": "PowerA", "1532": "Razer", "0738": "Mad Catz"
};
// maker:product, the two numbers a controller gives of itself
var MODELS = {
  "045e:028e": "Xbox 360 controller",
  "045e:028f": "Xbox 360 wireless controller",
  "045e:02d1": "Xbox One controller",
  "045e:02dd": "Xbox One controller (2015)",
  "045e:02e3": "Xbox Elite controller",
  "045e:02ea": "Xbox One S controller",
  "045e:02fd": "Xbox One S controller, on Bluetooth",
  "045e:0b00": "Xbox Elite Series 2 controller",
  "045e:0b05": "Xbox Elite Series 2 controller, on Bluetooth",
  "045e:0b12": "Xbox Series X|S controller",
  "045e:0b13": "Xbox Series X|S controller, on Bluetooth",
  "054c:0268": "DualShock 3 (PlayStation 3)",
  "054c:05c4": "DualShock 4 (PlayStation 4, first model)",
  "054c:09cc": "DualShock 4 (PlayStation 4, second model)",
  "054c:0ba0": "DualShock 4, on Sony's USB wireless adaptor",
  "054c:0ce6": "DualSense (PlayStation 5)",
  "054c:0df2": "DualSense Edge (PlayStation 5)",
  "057e:2006": "Joy-Con, left",
  "057e:2007": "Joy-Con, right",
  "057e:2009": "Switch Pro Controller",
  "046d:c216": "Logitech F310, switched to D",
  "046d:c218": "Logitech F510, switched to D",
  "046d:c219": "Logitech F710, switched to D"
};

// A browser's name for a pad, taken apart: name, maker and product numbers, and whether it came through XInput.
export function padParts(id) {
  var said = String(id || "");
  var m = /vendor:\s*([0-9a-f]{4})\s+product:\s*([0-9a-f]{4})/i.exec(said) || /^([0-9a-f]{4})-([0-9a-f]{4})-/i.exec(said);
  var name = said.replace(/\s*\((?:[^()]*STANDARD GAMEPAD[^()]*|Vendor:[^()]*)\)\s*$/i, "").replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, "").trim();
  return { name: name || "It gives no name", maker: m ? m[1].toLowerCase() : "", product: m ? m[2].toLowerCase() : "", xinput: /xinput/i.test(said) };
}

/* The fixed lines for a pad: icon, label, value; a fourth part hides the line
   until asked for. `at` is its place in the browser's list, shown as the port. */
export function padFacts(pad, at) {
  var p = padParts(pad.id), model = MODELS[p.maker + ":" + p.product];
  var shake = pad.vibrationActuator && pad.vibrationActuator.type;
  return [
    ["tag", "Name", p.name],
    ["hash", "Port", (at + 1) + ", as the browser has it. A game numbers its players itself."],
    ["gamepad", "Model", model ? model + ", by the numbers it gives"
      : p.xinput ? "Not told. Windows hands every Xbox-compatible controller over the same way (XInput), so an Xbox 360, One or Series pad all read alike here."
      : p.maker ? "Not one on Xsegon's list. Its numbers are on the next line."
      : "Not told: it gives no numbers of its own."],
    // In sight only where it is all that tells the controller: numbers given, and no model known by them.
    ["library", "Maker", p.maker ? (MAKERS[p.maker] || "Not on Xsegon's list") + " (" + p.maker + "), product " + p.product : "Not told", !!model || !p.maker],
    ["window", "Handed over by", p.xinput ? "XInput, Windows' own way for Xbox controllers" : p.maker ? "The browser, reading the controller itself" : "The browser, with no numbers", true],
    ["grid", "Layout", pad.listed ? "From the shared controller list, as " + pad.listed
      : pad.mapping === "standard" ? "The usual one: every button is where Xsegon looks for it" : "Its own: a button may sit somewhere else", true],
    ["lines", "It sends", pad.buttons.length + " buttons and " + pad.axes.length + " stick directions" + (pad.buttons.length > 17 ? ", a touchpad press among them" : ""), true],
    ["bolt", "Rumble", shake === "dual-rumble" ? "Two motors" : shake ? "Yes (" + shake + ")" : "None the browser can reach", true]
  ];
}

// A fresh count for a pad just put in the picture.
export function padStatsNew() {
  return { reach: [[0, 0, 0, 0], [0, 0, 0, 0]], part: [false, false], stamp: null, n: 0, since: 0, rate: 0, best: 0 };
}

/* One look at the pad: each stick's reach, whether a trigger was seen part
   way, and how many new readings came in the last second. */
export function padMeasure(st, pad, now) {
  [0, 1].forEach(function (s) {
    var x = pad.axes[s * 2] || 0, y = pad.axes[s * 2 + 1] || 0, r = st.reach[s];
    r[0] = Math.min(r[0], x); r[1] = Math.max(r[1], x); r[2] = Math.min(r[2], y); r[3] = Math.max(r[3], y);
    var t = pad.buttons[6 + s], v = t ? (t.value || 0) : 0;
    if (v > 0.05 && v < 0.95) { st.part[s] = true; }
  });
  if (typeof pad.timestamp !== "number") { st.rate = -1; return; }
  if (pad.timestamp !== st.stamp) { st.stamp = pad.timestamp; st.n++; }
  if (now - st.since >= 1000) { st.rate = st.n; st.best = Math.max(st.best, st.n); st.n = 0; st.since = now; }
}

function pct(v) { return Math.round(Math.min(1, Math.abs(v)) * 100) + "%"; }

/* The lines that move, as words. `dz` is the dead zone in Settings: a stick
   resting inside it moves nothing in Xsegon, one resting outside it drifts. */
export function padStatWords(st, pad, dz) {
  var stick = function (s) {
    var x = pad.axes[s * 2] || 0, y = pad.axes[s * 2 + 1] || 0, off = Math.sqrt(x * x + y * y), r = st.reach[s];
    return off.toFixed(2) + " from its centre, " + (off <= dz ? "inside" : "past") + " the dead zone (" + dz + "). Reached: left " + pct(r[0]) + ", right " + pct(r[1]) + ", up " + pct(r[2]) + ", down " + pct(r[3]);
  };
  var pull = function (s) { var t = pad.buttons[6 + s]; return (t ? (t.value || (t.pressed ? 1 : 0)) : 0).toFixed(2); };
  return [
    ["pointer", "Left stick", stick(0)],
    ["pointer", "Right stick", stick(1)],
    ["slider", "Triggers", "Left " + pull(0) + ", right " + pull(1) + ". " + (st.part[0] || st.part[1] ? "Seen part way: they tell how far they are pulled" : "Not seen part way yet: pull one slowly")],
    ["refresh", "New readings", st.rate < 0 ? "Not told by this browser"
      : st.best ? (st.rate ? st.rate + " a second now, " : "None now (nothing is moving), ") + st.best + " at most, as the browser passes them on"
      : "None yet: move a stick"]
  ];
}
