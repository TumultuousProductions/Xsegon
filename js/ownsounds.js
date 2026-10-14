/*  Settings > Sound > Your own sounds: a row per sound with Choose file...,
    Play and Remove, the rules written beside each (includes\ownsounds.php).
    A chosen file is measured here, where it will play, before it is kept. */

import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { saveSetting } from "./savednote.js";
import { pickWindowsFolder } from "./scan.js";
import { noteSaved } from "./settings-save.js";
import { SND, forgetSounds, sound } from "./sound.js";
import { el } from "./util.js";

function post(body) {
  return postJson("api/ownsounds.php", body);
}

function seconds(n) { return (Math.round(n * 100) / 100) + (n === 1 ? " second" : " seconds"); }

// What plays for a sound you have not chosen. Hover is not tied to the set: the set's own comes first.
function unchosen(name) { return name === "hover" ? "the sound set's own plays, or the built-in one" : "the built-in one plays"; }

/* How long a file plays, as the browser that will play it hears it, or null
   when it cannot play it at all. */
function measure(url) {
  return new Promise(function (resolve) {
    var a = new Audio(), done = false;
    function end(v) { if (!done) { done = true; resolve(v); } }
    a.preload = "metadata";
    a.addEventListener("loadedmetadata", function () { end(isFinite(a.duration) && a.duration > 0 ? a.duration : null); });
    a.addEventListener("error", function () { end(null); });
    setTimeout(function () { end(null); }, 8000);
    a.src = url;
  });
}

/* The first sound you choose switches the set to yours, saved at once, so
   what you chose is what you hear. */
function useOwnSet(set) {
  if (SND.soundSet === set) { return false; }
  SND.soundSet = set;
  saveSetting({ sound: { soundSet: set } }, "The sound set");
  var picker = document.querySelector('#settings select[data-group="sound"][data-key="soundSet"]');
  if (picker) {
    if (![].some.call(picker.options, function (o) { return o.value === set; })) {
      var o = el("option", null, set);
      o.value = set;
      picker.appendChild(o);
    }
    picker.value = set;
    noteSaved(picker);
  }
  return true;
}

export function ownSoundsPage(box, actionRow) {
  var rules = el("p", "group-help own-rules", "reading...");
  box.appendChild(rules);
  var st = null, rows = {};

  function paint() {
    rules.textContent = "One file per sound, copied into Xsegon: a .wav, .ogg or .mp3 of up to " + Math.round(st.maxBytes / 1048576) +
      " MB, no longer than the length beside it. A sound you leave empty plays the built-in one. They play while Sound set is " +
      st.set + ", which choosing one sets for you. Hover, the sound under the pointer, is the exception: yours plays under every set. " +
      "In the window that opens, a path you copied can be pasted into File name.";
    Object.keys(st.labels).forEach(function (name) {
      var r = rows[name], mine = st.sounds[name];
      r.hint.textContent = "Up to " + seconds(st.limits[name]) + ". " +
        (mine ? "Yours: " + mine.file + ", " + seconds(mine.seconds) + "." : "Not chosen: " + unchosen(name) + ".");
      r.remove.disabled = !mine;
    });
  }

  function choose(name) {
    var label = st.labels[name], limit = st.limits[name];
    pickWindowsFolder("Choose your " + label + " sound (.wav, .ogg or .mp3)", { kind: "file", types: "sounds" }).then(function (path) {
      if (!path) { return; }
      post({ action: "stage", name: name, path: path }).then(function (r) {
        if (!r.ok) { sound("back"); showStrip(r.error || label + " not changed", true); return; }
        measure(r.url).then(function (d) {
          var why = d === null ? "Xsegon could not play it"
            : d > limit + 0.02 ? seconds(d) + ": " + label + " can be up to " + seconds(limit) : null;
          if (why) {
            post({ action: "discard", name: name, why: why });
            sound("back");
            showStrip(label + " not changed: " + why, true);
            return;
          }
          post({ action: "keep", name: name, seconds: d, from: path }).then(function (k) {
            if (!k.ok) { sound("back"); showStrip(k.error || label + " not changed", true); return; }
            st = k;
            paint();
            forgetSounds(st.set);
            // Hover plays under the set you already have, so choosing it changes no other sound.
            var switched = name !== "hover" && useOwnSet(st.set);
            L("SND", "your own " + label + ": " + path);
            sound(name, st.set);
            showStrip(label + " is yours now (" + seconds(d) + ")" + (switched ? ", and Sound set is " + st.set : ""), false);
          });
        });
      });
    });
  }

  function remove(name) {
    post({ action: "remove", name: name }).then(function (r) {
      if (!r.ok) { showStrip(r.error || "it could not be removed", true); return; }
      st = r;
      paint();
      forgetSounds(st.set);
      sound("back");
      showStrip(st.labels[name] + " is no longer yours: " + unchosen(name), false);
    });
  }

  api("api/ownsounds.php").then(function (r) {
    if (!r.ok) { rules.textContent = "Your own sounds could not be read: " + (r.error || ""); return; }
    st = r;
    Object.keys(st.labels).forEach(function (name) {
      var line = actionRow(st.labels[name], "", "Choose file...", function () { choose(name); });
      line.classList.add("own-snd");
      line.dataset.sound = name;
      var play = el("button", null, "Play");
      play.type = "button";
      play.addEventListener("click", function () { sound(name, st.set); });
      var rm = el("button", null, "Remove");
      rm.type = "button";
      rm.addEventListener("click", function () { remove(name); });
      line.appendChild(play);
      line.appendChild(rm);
      rows[name] = { hint: line.querySelector(".hint"), remove: rm };
      box.appendChild(line);
    });
    paint();
  });
}
