import { L, api } from "./log.js";
import { motionWear } from "./motion.js";
import { rainWear } from "./rain.js";
import { saveSetting } from "./savednote.js";
import { snowWear } from "./snow.js";
import { sound } from "./sound.js";
import { $body, S } from "./state.js";

/*  The look (includes\themes.php): which theme the page wears, and the
    switch to another. A theme is values the server made from a small file;
    this puts them on the page and takes the last one's off. The house look
    is no values at all, so going back to it has nothing that can fail. */

var T = (window.XSEGON && window.XSEGON.theme) || {};
var worn = Object.keys(T.vars || {});            // the names index.php wrote, to take off again
export var themeId = T.id || "xsegon";

// [{ id, name, family }], the house look first; a family is a folder of themes, listed together.
export function themeList() {
  return T.list && T.list.length ? T.list : [{ id: "xsegon", name: "Xsegon", family: "" }];
}

// A theme's values onto the page, and the body's classes to match what the look has.
function wear(t) {
  var root = document.documentElement, feel = S.feel || {}, has = t.has || {};
  worn.forEach(function (k) { root.style.removeProperty(k); });
  worn = [];
  Object.keys(t.vars || {}).forEach(function (k) {
    if (!/^--[a-z0-9-]+$/.test(k)) { return; }
    root.style.setProperty(k, String(t.vars[k]));
    worn.push(k);
  });
  root.dataset.theme = t.id;
  // What it wears by name (a texture, what its panels are made of): a look without one takes the last one's off.
  var wears = t.wears || {};
  Object.keys(wears).forEach(function (k) {
    if (!/^[a-z]+$/.test(k)) { return; }
    if (/^[a-z0-9-]+$/.test(wears[k])) { root.dataset[k] = wears[k]; } else { delete root.dataset[k]; }
  });
  // What a look does not have is off whatever the switches say; the switches only take away.
  $body.classList.toggle("no-glow", feel.glow === false || has.glow === false);
  $body.classList.toggle("no-scanlines", feel.scanlines === false || has.scanlines === false);
  // The accent is the house look's own: a theme brings its highlight, and the choice waits.
  ["magenta", "amber", "green"].forEach(function (a) { $body.classList.toggle("accent-" + a, !!t.house && feel.accent === a); });
  themeId = t.id;
  rainWear();                                    // a texture a script draws goes up or comes down with the theme
  snowWear();
  motionWear();                                  // and whatever else of it moves by itself
}

/* The theme the settings now hold, put on. Asked for once the save is in, so
   a look on screen is one that was kept. A theme that cannot be used comes
   back as the house look, and that is said. */
export function wearTheme(id) {
  return api("api/theme.php?id=" + encodeURIComponent(id)).then(function (r) {
    if (!r || !r.ok || !r.theme) {
      L("ERR", "theme " + id + " could not be read: " + ((r && r.error) || "no answer"));
      return false;
    }
    wear(r.theme);
    L("SET", "theme " + r.theme.id + (r.theme.id !== id ? ", asked for " + id + ": " + (r.theme.why || "not usable") : ""));
    return r.theme.id === id;
  });
}

// From the round X: saved first, then worn.
export function setTheme(id) {
  if (id === themeId) { return; }
  var name = (themeList().filter(function (t) { return t.id === id; })[0] || {}).name || id;
  sound("select");
  saveSetting({ feel: { theme: id } }, "Theme", name + " theme").then(function (ok) {
    if (!ok) { return; }
    S.feel = S.feel || {};
    S.feel.theme = id;
    wearTheme(id);
  });
}
