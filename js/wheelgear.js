/*  The gear in the game wheel's top left corner, and the small window it
    opens: the scroll wheel's Speed, Momentum and Acceleration, right where you
    feel them. The same settings are in Settings > Xsegon Controls > Xsegon
    (Mouse and keyboard); js\wheelscroll.js describes what they do. A slider
    changes the wheel at once and is saved once you stop. Esc here closes only the window. */

import { iconEl } from "./icons.js";
import { L } from "./log.js";
import { saveSetting } from "./savednote.js";
import { openSettings } from "./settings-ui.js";
import { $main, $settings, S } from "./state.js";
import { el } from "./util.js";
import { wheelAccel, wheelBoost, wheelGlide, wheelSpeed } from "./wheelscroll.js";

var gear = null, pop = null, saveTimer = null;

var FIELDS = [
  { key: "wheelSpeed", label: "Speed", dflt: 5, min: 1, max: 10,
    say: function () { var g = wheelSpeed(); return g === 1 ? "One game a notch." : (g < 1 ? "About a game every " + Math.round(1 / g * 10) / 10 + " notches." : g + " games a notch."); } },
  { key: "wheelGlide", label: "Momentum", dflt: 4, min: 0, max: 10,
    say: function () { var m = wheelGlide(); return !m ? "Off: it stops when you stop." : m < 4 ? "A quick flick glides a little." : m < 8 ? "A quick flick glides on and slows." : "A quick flick glides a long way."; } },
  { key: "wheelAccel", label: "Accel", dflt: 5, min: 0, max: 10,
    say: function () { var a = wheelAccel(); return !a ? "Off: a notch is always the same." : "A hard spin counts a notch up to " + Math.round(wheelBoost(1e9) * 10) / 10 + " times; a slow one, once."; } }
];

function value(f) {
  var v = S.controller ? S.controller[f.key] : undefined;
  return typeof v === "number" ? v : f.dflt;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    saveTimer = null;
    var c = { wheelSpeed: value(FIELDS[0]), wheelGlide: value(FIELDS[1]), wheelAccel: value(FIELDS[2]) };
    L("SET", "scroll wheel speed " + c.wheelSpeed + ", momentum " + c.wheelGlide + ", acceleration " + c.wheelAccel + " (the wheel's gear)");
    saveSetting({ controller: c }, "The scroll wheel's feel");
  }, 350);
}

function build() {
  pop = el("div", "wpop");
  pop.id = "wpop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Scrolling");
  pop.hidden = true;
  pop.appendChild(el("div", "wpop-head", "Scrolling"));
  FIELDS.forEach(function (f) {
    var line = el("label", "wpop-row");
    line.appendChild(el("span", "wpop-k", f.label));
    var input = el("input");
    input.type = "range";
    input.min = f.min; input.max = f.max; input.step = 1;
    input.dataset.key = f.key;
    var n = el("span", "wpop-n");
    var hint = el("p", "wpop-hint");
    input.addEventListener("input", function () {
      if (!S.controller) { S.controller = {}; }
      S.controller[f.key] = Number(input.value);   // the wheel reads it from here, at once
      n.textContent = input.value;
      hint.textContent = f.say();
      save();
    });
    line.appendChild(input);
    line.appendChild(n);
    pop.appendChild(line);
    pop.appendChild(hint);
  });
  var more = el("button", "wpop-more", "More in Settings");
  more.type = "button";
  more.addEventListener("click", function () { close(); openControls(); });
  pop.appendChild(more);
  // Its own keys: the arrows move a slider, not the wheel behind it.
  pop.addEventListener("keydown", function (e) { if (e.key !== "Escape") { e.stopPropagation(); } });
  $main.appendChild(pop);
}

function paint() {
  pop.querySelectorAll("input[type=range]").forEach(function (input) {
    var f = FIELDS.find(function (x) { return x.key === input.dataset.key; });
    input.value = value(f);
    input.nextElementSibling.textContent = input.value;
    input.parentNode.nextElementSibling.textContent = f.say();
  });
}

function onKeyWhileOpen(e) {
  if (e.key !== "Escape") { return; }
  e.preventDefault();
  e.stopPropagation();
  close();
  gear.focus();
}
function onPressWhileOpen(e) {
  if (pop.contains(e.target) || gear.contains(e.target)) { return; }
  close();
}

function open() {
  if (!pop) { build(); }
  paint();
  pop.hidden = false;
  gear.classList.add("on");
  gear.setAttribute("aria-expanded", "true");
  document.addEventListener("keydown", onKeyWhileOpen, true);
  document.addEventListener("pointerdown", onPressWhileOpen, true);
  pop.querySelector("input").focus();
}

function close() {
  if (!pop || pop.hidden) { return; }
  pop.hidden = true;
  gear.classList.remove("on");
  gear.setAttribute("aria-expanded", "false");
  document.removeEventListener("keydown", onKeyWhileOpen, true);
  document.removeEventListener("pointerdown", onPressWhileOpen, true);
}

/* Settings, opened on the page these three live on: Controls, scrolled to
   its Mouse and keyboard section. The screen is drawn after a read, so it
   waits for it, a second at most. */
function openControls() {
  if ($settings.hidden) { openSettings(); }
  var tries = 60;
  (function find() {
    var tab = [].find.call(document.querySelectorAll("#settings .set-tab"), function (t) { return /^controls$/i.test(t.textContent.replace("›", "").trim()); });
    if (!tab) { if (--tries > 0) { requestAnimationFrame(find); } return; }
    tab.click();
    var sect = document.querySelector('#settings .set-page[data-group="controller"] .set-sect[data-sect="Xsegon (Mouse and keyboard)"]');
    if (sect) { sect.scrollIntoView({ block: "start" }); }
  })();
}

export function wireWheelGear() {
  gear = el("button", "wgear");
  gear.type = "button";
  gear.id = "wgear";
  gear.title = "Scrolling: speed, momentum and acceleration";
  gear.setAttribute("aria-label", "Scroll settings");
  gear.setAttribute("aria-haspopup", "dialog");
  gear.setAttribute("aria-expanded", "false");
  gear.appendChild(iconEl("wgear-ico", "gear"));
  gear.addEventListener("click", function () { if (pop && !pop.hidden) { close(); } else { open(); } });
  $main.appendChild(gear);
}
