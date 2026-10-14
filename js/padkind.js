/*  Which kind of controller is in the hand, and what its buttons are called.
    Xsegon hears a pad by where a button sits (js\input.js); this file only
    chooses the names shown for those places. Settings > Xsegon Controls >
    Button names overrules what is read off the pad. */

import { S } from "./state.js";

/* The face buttons by place (0 bottom, 1 right, 2 left, 3 top), then buttons
   4 to 11: shoulders, triggers, the two middle ones and the stick presses. */
var KINDS = {
  xbox:        { word: "Xbox", face: ["A", "B", "X", "Y"], rest: ["LB", "RB", "LT", "RT", "View", "Menu", "LS", "RS"] },
  playstation: { word: "PlayStation", face: ["Cross", "Circle", "Square", "Triangle"], rest: ["L1", "R1", "L2", "R2", "Share", "Options", "L3", "R3"], drawn: true },
  nintendo:    { word: "Nintendo", face: ["B", "A", "Y", "X"], rest: ["L", "R", "ZL", "ZR", "Minus", "Plus", "LS", "RS"] },
  position:    { word: "", face: ["Bottom button", "Right button", "Left button", "Top button"], rest: ["L", "R", "L2", "R2", "Select", "Start", "L3", "R3"], drawn: true }
};

// PlayStation's four, drawn here in the colour of the key they sit on.
var SHAPES = [
  '<path d="M4 4l8 8M12 4l-8 8"/>',
  '<circle cx="8" cy="8" r="4.7"/>',
  '<rect x="3.5" y="3.5" width="9" height="9"/>',
  '<path d="M8 3l5.2 9H2.8z"/>'
];
// A mark for the place: the four buttons as dots, the one meant large and filled.
var DOTS = [[8, 13], [13, 8], [3, 8], [8, 3]];

function drawing(kind, n) {
  var ps = kind === "playstation";
  var inside = ps ? SHAPES[n] : DOTS.map(function (c, i) {
    return '<circle cx="' + c[0] + '" cy="' + c[1] + '"' + (i === n ? ' r="2.7" fill="currentColor" stroke="none"' : ' r="1.3"') + "/>";
  }).join("");
  var size = ps ? "1.05em" : "1.3em";
  return '<svg viewBox="0 0 16 16" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="' +
    (ps ? 2 : 1) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inside + "</svg>";
}

/* The kind a pad's name says it is, "" when unknown. The words are for a name
   with no maker's number, as an XInput pad's. */
export function padKindOf(id) {
  var said = String(id || "").toLowerCase();
  var maker = (/vendor:\s*([0-9a-f]{4})/.exec(said) || /^([0-9a-f]{4})-[0-9a-f]{4}-/.exec(said) || [])[1] || "";
  if (maker === "054c" || /dualsense|dualshock|playstation|\bps[345]\b/.test(said)) { return "playstation"; }
  if (maker === "057e" || /nintendo|joy-con/.test(said)) { return "nintendo"; }
  if (maker === "045e" || /xbox|xinput/.test(said)) { return "xbox"; }
  return "";
}

var heardKind = "";          // the kind of the pad that pressed last
var heardId = null;

// Whose names are shown now: the person's own choice, else the pad that pressed last, else Xbox's.
export function padKind() {
  var chosen = S.controller && S.controller.buttonNames;
  if (chosen && chosen !== "auto" && KINDS[chosen]) { return chosen; }
  return heardKind || "xbox";
}

// A pad pressed: true when it is another pad than the last, whose names and jobs the legend then takes.
export function padPressed(pad) {
  if (!pad || pad.id === heardId) { return false; }
  heardId = pad.id;
  heardKind = padKindOf(pad.id);
  return true;
}
// The browser's name for the pad that pressed last, null before any has.
export function padHeardId() { return heardId; }

// "Xbox", "PlayStation", "Nintendo", or "" for a kind with no maker.
export function padKindWord(kind) { return (KINDS[kind] || {}).word || ""; }

// Whose names a pad of this name gets: the person's own choice, else its kind, else Xbox's.
export function padNamesFor(id) {
  var chosen = S.controller && S.controller.buttonNames;
  if (chosen && chosen !== "auto" && KINDS[chosen]) { return chosen; }
  return padKindOf(id) || "xbox";
}

// One face button in a kind's names: what it is called, and its drawing (a 16 by 16 box) where the kind has one.
export function padFace(kind, n) {
  return { name: (KINDS[kind] || KINDS.xbox).face[n], art: kind === "playstation" ? SHAPES[n] : null };
}

// What a button of the usual layout is called on a kind of pad.
export function padButtonWord(kind, n) {
  var names = KINDS[kind] || KINDS.xbox;
  return n < 4 ? names.face[n] : names.rest[n - 4] || "button " + n;
}

var JOB_OF = { A: "confirm", B: "back", X: "details", Y: "menu", View: "top" };

/* A legend key in the names of the pad in use. `xbox` is the legend's own name
   ("A", "LB RB"), `jobs` each job's button (js\padjobs.js); other keys are left. */
export function padKeyNamed(node, xbox, jobs) {
  var kind = padKind();
  if (xbox === "LB RB") { node.textContent = padButtonWord(kind, jobs.pageUp) + " " + padButtonWord(kind, jobs.pageDown); return; }
  if (!JOB_OF[xbox]) { return; }
  var n = jobs[JOB_OF[xbox]];
  if (n > 3 || !KINDS[kind].drawn) { node.textContent = padButtonWord(kind, n); return; }
  node.innerHTML = drawing(kind, n);
  node.title = padButtonWord(kind, n);
  node.setAttribute("aria-label", padButtonWord(kind, n));
}
