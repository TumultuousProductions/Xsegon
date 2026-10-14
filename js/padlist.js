/*  Controllers the browser does not know, read from the shared list.
    A pad in its own button order is looked up by maker and product in the list
    SDL programs share (includes\padlist) and handed on in the usual layout;
    others pass untouched. Xsegon's own screens only: RetroArch reads a pad itself.
    The buttons, cross and left stick are where the list says; the other stick
    and analogue triggers are a best guess (axisPlace). */

import { L, api } from "./log.js";
import { padParts } from "./padfacts.js";
import { S } from "./state.js";

var BUTTONS = ["a", "b", "x", "y", "leftshoulder", "rightshoulder", "lefttrigger", "righttrigger", "back", "start",
               "leftstick", "rightstick", "dpup", "dpdown", "dpleft", "dpright", "guide"];
var STICKS = ["leftx", "lefty", "rightx", "righty"];
var HAT_AT = 9;               // where Chrome and Edge put a raw pad's cross, as one number
var HAT_WAYS = [1, 3, 2, 6, 4, 12, 8, 9];   // that number's eight places as the list's bits: 1 up, 2 right, 4 down, 8 left
var lines = {};               // a pad's name: its line, "asking" while the server is asked, null when the list has none

// The cross of a raw pad: up is -1, then clockwise in sevenths to 1, and past 1 is at rest.
function hatBits(p) {
  var v = p.axes && p.axes.length > HAT_AT ? p.axes[HAT_AT] : 2;
  return v >= -1.01 && v <= 1.01 ? HAT_WAYS[Math.round((v + 1) * 3.5)] : 0;
}

/* The list counts only the axes a pad has; the browser keeps a place for each
   kind either way. Past the first two, a pad with four is taken as the common
   kind whose second stick is in the third and sixth places. */
function axisPlace(n, line, len) { return n < 2 || len < 6 || line.most > 3 ? n : [0, 1, 2, 5][n]; }

function axisOf(p, part, line) {
  return (p.axes[axisPlace(part[1], line, p.axes.length)] || 0) * (part[3] ? -1 : 1);
}

// How far a part is pressed, 0 to 1: a button, a way of the cross, or an axis (a whole one rests at -1).
function pressOf(p, part, line, hat) {
  if (!part) { return 0; }
  if (part[0] === "b") { var bt = p.buttons[part[1]]; return bt ? (bt.pressed ? 1 : bt.value || 0) : 0; }
  if (part[0] === "h") { return hat & part[2] ? 1 : 0; }
  var v = axisOf(p, part, line);
  return part[2] === "+" ? Math.max(0, v) : part[2] === "-" ? Math.max(0, -v) : (v + 1) / 2;
}

// The pad as the rest of Xsegon expects one, with the raw pad and the list's name for it beside.
function usual(p, line) {
  var hat = hatBits(p);
  return {
    id: p.id, index: p.index, connected: p.connected, mapping: "standard", timestamp: p.timestamp,
    vibrationActuator: p.vibrationActuator, listed: line.name, raw: p,
    buttons: BUTTONS.map(function (name) { var v = pressOf(p, line.parts[name], line, hat); return { pressed: v > 0.5, value: v }; }),
    axes: STICKS.map(function (name) { var part = line.parts[name]; return part && part[0] === "a" ? axisOf(p, part, line) : 0; })
  };
}

function ask(p) {
  var who = padParts(p.id);
  if (!who.maker || !who.product) {
    lines[p.id] = null;
    L("PAD", "list: " + p.id + " gives no numbers to look it up by");
    return;
  }
  lines[p.id] = "asking";
  api("api/padlist.php?vendor=" + who.maker + "&product=" + who.product).then(function (r) {
    if (!r || !r.ok || !r.found) {
      lines[p.id] = null;
      L("PAD", "list: " + who.maker + ":" + who.product + (r && r.ok ? " is not in the shared list" : " could not be looked up: " + ((r && r.error) || "no answer")));
      return;
    }
    var most = 0;
    Object.keys(r.parts).forEach(function (k) { if (r.parts[k][0] === "a") { most = Math.max(most, r.parts[k][1]); } });
    lines[p.id] = { name: r.name, parts: r.parts, most: most };
    L("PAD", "list: " + p.id + " is read as " + r.name + ", from the shared list");
  });
}

/* Every pad the browser has, in its own places, unknown ones in the usual layout
   where the list has them. Settings > Use the shared controller list turns it off. */
export function padsNow() {
  var raw = navigator.getGamepads ? navigator.getGamepads() : [];
  if (S.controller && S.controller.sharedPadList === false) { return raw; }
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var p = raw[i], odd = !!(p && p.mapping !== "standard" && p.buttons && p.buttons.length);
    if (odd && lines[p.id] === undefined) { ask(p); }
    out.push(odd && lines[p.id] && lines[p.id] !== "asking" ? usual(p, lines[p.id]) : p);
  }
  return out;
}
