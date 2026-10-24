import { brandRows } from "./brand.js";
import { confirmWindow } from "./confirm.js";
import { paintDeletedList, paintHiddenList } from "./editors.js";
import { gamesdbRow } from "./gamesdbrow.js";
import { paintHelp, paintHelpHere } from "./help.js";
import { iconEl } from "./icons.js";
import { jobsWatch } from "./jobbars.js";
import { showStrip } from "./launch.js";
import { runImport } from "./lbimport.js";
import { L, api, bug, logWarn, postJson, shapeOf } from "./log.js";
import { ownSoundsPage } from "./ownsounds.js";
import { openPadButtons, openPadCheck } from "./padcheck.js";
import { openPadGameHelp } from "./padhelp.js";
import { cancelKeyWait, padKeysPage } from "./padkeys.js";
import { cancelPadWait, padMapPage } from "./padmap.js";
import { cancelHotkeyWait, hotkeysPage } from "./rahotkeys.js";
import { saveSetting } from "./savednote.js";
import { browseOnly } from "./scan.js";
import { emulatorsPage } from "./settings-emu.js";
import { SET_ROWS, foldSect, setBarTo, setFind, setGo, setPaint } from "./settings-nav.js";
import { holdRedraw, noteAllSaved, redrawIfClear, saveWaiting } from "./settings-save.js";
import { armTips, hideTip } from "./settings-tips.js";
import { armBrowse, stopVideo } from "./snap.js";
import { SND, hearHoverRate, setVolume, sound } from "./sound.js";
import { $body, $settings, S, hasLaunchBox, launchBoxOff, setSel } from "./state.js";
import { openBackupTool, openLogViewer, openReportTool } from "./tools.js";
import { setSettingOpener, updateRow } from "./updaterow.js";
import { el } from "./util.js";
import { row } from "./views.js";
import { gridImage, smallCopies, thumbsBy } from "./viewset.js";

// Update now's warning on keeping an older PHP leads to its switch here.
setSettingOpener(openSettingAt);

// ---------- settings ----------
// Rendered from the API's defaults, so a toggle added in
// includes\settings.php appears here without this file changing.

/* The two brightness sliders, as a percent. index.php sets the saved ones
   on body; this is a slider trying one out. textBrightness is the brightest
   whites (css: --tb), brightness the black veil over everything (--dim). */
function setBrightness(key, pct) {
  if (key === "brightness") {
    var all = Math.max(40, Math.min(100, Number(pct) || 100));
    document.body.style.setProperty("--dim", String(Math.round(100 - all) / 100));
    return;
  }
  var n = Math.max(60, Math.min(100, Number(pct) || 100));
  document.body.style.setProperty("--tb", String(n / 100));
}
function savedFeel(key) {
  return S.feel && S.feel[key] !== undefined ? S.feel[key] : 100;
}
/* The menu text size, in pixels, tried out the same way: the row names are
   drawn at 16 times --fs, so --fs is the size over 16 (index.php sets the
   saved one). */
function setTextSize(px) {
  var n = Math.max(12, Math.min(28, Number(px) || 19));
  document.body.style.setProperty("--fs", String(Math.round(n / 16 * 10000) / 10000));
}
// The window is sized by the text size too, and that slider sits at its edge: held at the size it
// has while the slider is held, or the knob leaves the pointer and the size flips end to end.
function holdWindow(on) {
  var inner = $settings.querySelector(".set-inner"), r = inner && inner.getBoundingClientRect();
  if (!inner) { return; }
  inner.style.width = on ? r.width + "px" : "";
  inner.style.height = on ? r.height + "px" : "";
}

// how: "stay" when another window opens in its place, which draws the page again when it closes.
export function closeSettings(how) {
  /* A button or key listen must not outlive its screen, or it takes the next
     press on the games screen as the answer. cancelPadWait also clears the
     shared pad-catch slot, which ends a hotkey or turbo wait. */
  cancelPadWait();
  cancelKeyWait();
  cancelHotkeyWait();
  saveWaiting();                           // a box still being typed in, a slider not yet at rest
  // the sliders that show themselves stand at what was saved
  setBrightness("textBrightness", savedFeel("textBrightness"));
  setBrightness("brightness", savedFeel("brightness"));
  setTextSize(S.feel && S.feel.textSize);
  hideTip();
  $settings.hidden = true;
  setUI = null;
  armBrowse();
  sound("back");
  paintHelpHere();                         // the consoles' legend over the consoles, not "Enter play"
  if (how !== "stay") { redrawIfClear(); }
}

// Out of Settings into a window and back: what is waiting is saved first, and Settings stands where it was once that window closes.
function awayFor(open) {
  saveWaiting();
  $settings.hidden = true;
  open(function (gone) {
    if (!setUI) { return; }
    if (gone) { closeSettings(); return; }   // a backup was put back: what Settings showed may no longer be so
    $settings.hidden = false;
    paintHelp("settings");
  });
}

// View controller, at the right of a gamepad section's heading: the picture that lights as you press (js\padcheck.js).
function seeController(box) {
  var see = el("button", "sect-go", "View controller");
  see.title = "A picture of your controller that lights up as you press.";
  see.addEventListener("click", function (e) { e.stopPropagation(); awayFor(openPadCheck); });
  box.querySelector(".sect-head").appendChild(see);
}

/* The settings screen while it is open: which category, which row the bar is
   on, and whether the bar is in the categories or the page. The keyboard, pad
   and mouse all write to it, so the bar is always in one place. */
export var setUI = null;

// An icon for each category: words all in the same grey read as a list, not a menu. Names in ICONS.
var SET_ICONS = {
  paths: "folder", library: "library", view: "grid", launch: "play", feel: "sparkle",
  sound: "note", video: "film", controller: "pointer", gamecontrols: "gamepad", window: "window", screensaver: "moon", debug: "bug",
  emulators: "disc"
};
// And one per row, taken from the kind of control it turned out to be.
export var ROW_ICONS = {
  bool: "toggle", enum: "chevrons", range: "slider", number: "hash",
  path: "folder", list: "lines", text: "pencil", action: "bolt"
};

/* Shaped like a console menu: categories down the left, one page at a time on
   the right. Everything renders from the schema, so a setting added in
   includes\settings.php appears here for free. */
// The bar onto one setting's row of the page that is showing; a row with no setting of its own is named by data-land.
function barOnSetting(group, key) {
  var input = setUI && setUI.pages[group] && setUI.pages[group].querySelector('[data-group="' + group + '"][data-key="' + key + '"], .opt[data-land="' + key + '"]');
  var optRow = input && input.closest(".opt");
  if (optRow) { setBarTo("page", optRow); setPaint(); }
}

// Settings with the bar on one setting: opened there, or moved there when it is open already.
export function openSettingAt(group, key) {
  if ($settings.hidden) { openSettings(group, key); return; }
  if (setUI && setUI.tabs[group]) { setGo("nav", group); barOnSetting(group, key); }
}

// at: the category to open on (a schema group, "emulators"); the first one otherwise. key: a setting of it to land on.
export function openSettings(at, key) {
  if (!$settings.hidden) { closeSettings(); return; }
  if (typeof at !== "string") { at = ""; }   // a button's click passes its event
  L("NAV", "settings" + (at ? " at " + at : ""));
  holdRedraw(true);                          // on its way open: no drawing the page again under it
  api("api/settings.php").then(function (res) {
    holdRedraw(false);
    if (!res || !res.ok || !res.defaults || !res.settings) {
      showStrip("Settings could not be read: " + ((res && res.error) || "the server gave no settings") + ". It is in the log.", true);
      return;
    }
    try {
      paintSettings(res);
      if (at && setUI && setUI.tabs[at]) { setGo("nav", at); if (typeof key === "string") { barOnSetting(at, key); } }
    }
    catch (e) {
      // Half a screen is worse than none: hide it, say so, keep the details.
      $settings.hidden = true;
      setUI = null;
      bug("settings screen", e, "groups " + Object.keys(res.defaults).join(","));
    }
  });
}

function kindOf(v) {
  return v === null ? "null" : Array.isArray(v) ? "list" : typeof v === "object" ? "set" : typeof v;
}

function paintSettings(res) {
  $settings.textContent = "";
  var inner = el("div", "panel-inner set-inner");

  var head = el("div", "set-head");
  head.appendChild(el("h1", "panel-title", "SETTINGS"));

  // Find a setting: too many categories to hunt through by eye.
  var find = el("div", "set-find");
  find.appendChild(iconEl("find-ico", "search"));
  var findBox = el("input");
  findBox.type = "text";
  findBox.placeholder = "find a setting";
  findBox.spellcheck = false;
  find.appendChild(findBox);
  head.appendChild(find);

  var closeX = el("button", null, "Close (esc)");
  closeX.addEventListener("click", closeSettings);
  head.appendChild(closeX);
  inner.appendChild(head);

  var shell = el("div", "set-shell");
  var nav = el("nav", "set-nav");
  var bodyEl = el("div", "set-body");
  var schema = res.schema || {};
  var tabs = {}, pages = {};

  Object.keys(res.defaults).forEach(function (group, gi) {
    var g = schema[group] || {};

    var tab = el("button", "set-tab" + (gi === 0 ? " on" : ""));
    tab.appendChild(iconEl("tab-ico", SET_ICONS[group]));
    /* A long name says where it breaks (schema: _tab), and is set a size
       smaller so each line fits on one. The space stays in the words read out. */
    var tabLabel = el("span", "tab-label");
    if (g._tab) {
      tab.classList.add("tab-two");
      g._tab.split("\n").forEach(function (t, i, all) { tabLabel.appendChild(el("span", "tl", t + (i < all.length - 1 ? " " : ""))); });
    } else {
      tabLabel.textContent = g._label || group;
    }
    tab.appendChild(tabLabel);
    tab.appendChild(el("span", "tab-more", "›"));
    tab.addEventListener("click", function () { sound("move"); setGo("nav", group); });
    tab.addEventListener("mousemove", function () { setBarTo("nav", group); });
    tabs[group] = tab;
    nav.appendChild(tab);

    var page = el("div", "set-page");
    page.hidden = gi !== 0;
    page.appendChild(el("h2", null, g._label || group));
    var gHelp = !hasLaunchBox && g._helpNoLb ? g._helpNoLb : g._help;
    if (gHelp) { page.appendChild(el("p", "group-help", gHelp)); }
    // The category's own words, for its tab's tooltip: what is behind the
    // tab, read before opening it.
    if (gHelp) { tab.dataset.tip = gHelp; }

    /* A page comes in sections (schema: section), each a bordered box with a
       heading that folds it, so where one group ends is clear. Folding is never
       saved. A row with no section goes in an unnamed box that does not fold. */
    var partOf = {};
    function part(name) {
      if (!partOf[name]) {
        var box = el("div", "set-sect");
        box.dataset.sect = name;
        if (name) { box.appendChild(sectHead(box, name)); }
        partOf[name] = box;
        page.appendChild(box);
      }
      return partOf[name];
    }
    /* The way to the controls inside games, at the top of Xsegon Controls. A row
       of its own, so the pad and keys reach it, but only its button lights up:
       the row itself does nothing when pressed (link-row, css). */
    if (group === "controller") {
      var across = actionRow("Looking for the controls inside your games?",
        "Your buttons and keys in games, and RetroArch's hotkeys for quitting, pausing, saving and turbo, are on RetroArch + Emulator Controls.",
        "Go there ›", function () { sound("move"); setGo("nav", "gamecontrols"); setPaint(); });
      across.classList.add("link-row");
      part("").appendChild(across);
    }
    Object.keys(res.defaults[group]).forEach(function (key) {
      var meta = g[key] || {};
      // Only a LaunchBox library has it (schema: lb), or it needs other words without one.
      if ((meta.lb === "hide" && !hasLaunchBox) || (meta.lb === "off" && launchBoxOff)) { return; }
      if (!hasLaunchBox && meta.helpNoLb) { meta = Object.assign({}, meta, { help: meta.helpNoLb }); }
      var v0 = (res.settings[group] || {})[key], d0 = res.defaults[group][key];
      /* A set of named values (the list's column widths, the badge switches) has
         no row that could show it, and drawing one as a list stops the screen
         opening. The schema says so (type "set"); the shape test catches one it forgets. */
      if (meta.type === "set" || kindOf(v0) === "set" || kindOf(d0) === "set") { return; }
      // A saved value of a different kind from its default is how that breaks,
      // so it is logged even when the row copes.
      if (v0 !== undefined && kindOf(v0) !== kindOf(d0) && !(kindOf(d0) === "string" && v0 === null)) {
        logWarn("setting " + group + "." + key + " is a " + kindOf(v0) + ", its default a " + kindOf(d0) + ": " + shapeOf(v0));
      }
      // One row that cannot be drawn costs that row, never the screen.
      var rowEl;
      try { rowEl = optionRow(group, key, v0, d0, meta); }
      catch (e) {
        bug("settings row " + group + "." + key, e, "value " + shapeOf(v0) + ", default " + shapeOf(d0));
        rowEl = el("div", "opt opt-broken");
        rowEl.appendChild(iconEl("opt-ico", "bug"));
        var l = el("label");
        l.appendChild(document.createTextNode(meta.label || key));
        l.appendChild(el("span", "hint", "This setting could not be shown, and is left as it was. The details are in the log."));
        rowEl.appendChild(l);
      }
      part(meta.section || "").appendChild(rowEl);
    });
    if (group === "controller") {   // a picture that lights as you press (js\padcheck.js)
      part("Xsegon (Gamepad)").appendChild(actionRow("Xsegon's buttons",
        "What each controller button does in Xsegon's own screens, set on a picture of the controller: choose a job, then press the button you want for it. Kept for each kind of controller. Games keep their own buttons.",
        "Set buttons...", function () { awayFor(openPadButtons); }));
      part("Xsegon (Gamepad)").appendChild(actionRow("Controller check",
        "A picture of your controller that lights up as you press: which controller Xsegon found, what it was read as, and whether each button, trigger and stick arrives where it should.",
        "Check a controller...", function () { awayFor(openPadCheck); }));
      seeController(part("Xsegon (Gamepad)"));
    }
    if (group === "gamecontrols") { padMapPage(part("RetroArch (Gamepad)"), function () { awayFor(openPadGameHelp); }); seeController(part("RetroArch (Gamepad)")); }   // your buttons per console (js\padmap.js)
    if (group === "gamecontrols") { padKeysPage(part("RetroArch (Keyboard)")); }   // your keys per console (js\padkeys.js)
    if (group === "gamecontrols") { hotkeysPage(part("RetroArch (Hotkeys and turbo)")); }   // how to leave, pause, turbo (js\rahotkeys.js)
    // Import and Thumbs are library chores done once in a while, so they live
    // on the Library page rather than in the masthead.
    if (group === "debug") {
      part("Logging").appendChild(actionRow("The log",
        "Every action and request today, page and server.", "Show the log", function () { awayFor(openLogViewer); }));
      part("Getting help").appendChild(actionRow("Something is wrong",
        "Runs every check Xsegon knows how to run, worst first, and gathers the log and your settings into one zip small enough to send.",
        "Report a problem...", function () { awayFor(openReportTool); }));
    }
    // Which version this is, what is waiting, and Go back (js\updaterow.js).
    if (group === "window") { updateRow(part("New versions")); }
    // Your picture and the way back to Xsegon's, under Your name (js\brand.js).
    if (group === "feel") { brandRows(part("Your name and logo"), actionRow); }
    // A stylesheet of your own, in a folder updates never touch (includes\custom.php).
    if (group === "feel") {
      part("Your own look").appendChild(actionRow("Your own stylesheet",
        "custom\\style.css in Xsegon's folder, read after Xsegon's own, so what you write there wins. Updates never touch that folder and no download carries it. The first press makes it, with a few lines saying what to do; save it and press F5 to see a change. High contrast leaves it out.",
        "Open my folder", function () {
          postJson("api/reveal.php", { what: "custom" }).then(function (r) {
            if (!r || !r.ok) { showStrip("Your own folder could not be opened: " + ((r && r.error) || "no answer"), true); }
          });
        }));
    }
    // Which sound packs are on this PC, beside the setting that chooses one.
    if (group === "sound") { soundsRow(part("In the app")); ownSoundsPage(part("Your own sounds"), actionRow); }   // js\ownsounds.js
    if (group === "emulators") { emulatorsPage(part, actionRow); }   // js\settings-emu.js
    if (group === "library") {
      if (hasLaunchBox) {
        part("Importing from LaunchBox").appendChild(actionRow("Re-read LaunchBox",
          "Import the library again now, without waiting for a restart.", "Import", function () { runImport(); }));
      }
      paintHiddenList(part("Which games"));
      paintDeletedList(part("Which games"));
      var pics = part("Names, details and pictures");
      gamesdbRow(pics, actionRow);   // js\gamesdbrow.js
      pics.appendChild(actionRow("Thumbnail cache",
        "Build the small box-art images the grid and wheel load.", "Build thumbs", runThumbs));
      // Last on the page and the only one that protects rather than builds:
      // everything above can be made again, and none of this can.
      part("Keeping it safe").appendChild(actionRow("Backup",
        "The pictures you replaced, your edits, favourites, your own games and every play recorded. A plain zip that opens in Explorer, so it can be put back with or without Xsegon.",
        "Back up...", function () { awayFor(openBackupTool); }));
    }
    // The sections in the page's own order, when it gives one.
    (g._sections || []).forEach(function (name) { if (partOf[name]) { page.appendChild(partOf[name]); } });
    page.dataset.group = group;
    pages[group] = page;
    bodyEl.appendChild(page);
  });

  shell.appendChild(nav);
  shell.appendChild(bodyEl);
  inner.appendChild(shell);

  // Every row answers to the pointer as well, so the bar is wherever you
  // last were, whichever hand you used.
  bodyEl.querySelectorAll(SET_ROWS).forEach(function (row) {
    row.addEventListener("mousemove", function () { setBarTo("page", row); });
  });
  armTips(inner);

  var findWait;
  findBox.addEventListener("input", function () {
    clearTimeout(findWait);
    findWait = setTimeout(function () { setFind(findBox.value); }, 120);
  });

  var foot = el("div", "set-foot");
  var reset = el("button", null, "Reset to defaults");
  // Asks first, keeps your folders, and keeps a copy of what it replaced (api\settings.php).
  reset.addEventListener("click", function () {
    confirmWindow("Reset settings to their defaults?", function (box) {
      box.appendChild(el("p", null, "Every setting goes back to how Xsegon comes: views, sound, video, controls, the look, launching."));
      box.appendChild(el("p", "confirm-safe", "Your folders (Settings > Paths) are kept, so your games are still found. Your games, stars, edits and pictures are not settings and are not touched."));
      box.appendChild(el("p", "confirm-note", "A copy of your current settings is kept in data\\safety first, so this can be undone."));
    }, { label: "Reset settings", run: function () {
      L("SET", "reset to defaults");
      api("api/settings.php?reset=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(function (r) {
        if (!r.ok) { showStrip("not reset: " + (r.error || ""), true); return; }
        location.reload();
      });
    } }, "Keep my settings");
  });
  foot.appendChild(reset);
  foot.appendChild(el("span", "spacer"));
  // No Save: each row saves itself, and this line says which did last (js\settings-save.js).
  foot.appendChild(el("span", "group-help set-saved", "Every change is saved as you make it."));
  inner.appendChild(foot);

  $settings.appendChild(inner);
  $settings.hidden = false;
  noteAllSaved();                            // what the server holds, to tell a change from it
  setUI = {
    order: Object.keys(res.defaults),
    tabs: tabs, pages: pages, nav: nav, body: bodyEl, find: findBox,
    group: Object.keys(res.defaults)[0],
    navAt: Object.keys(res.defaults)[0],
    where: "nav",
    row: null,
    finding: false
  };
  setPaint();
  stopVideo();
  sound("select");
  paintHelp("settings");
}

/* A section's heading: a fold, its name, and while folded how many rows it holds.
   The bar lands on it like any row: A folds and unfolds it, left folds, right
   unfolds (js\settings-nav.js). */
function sectHead(box, name) {
  var head = el("div", "sect-head");
  head.setAttribute("role", "button");
  head.setAttribute("aria-expanded", "true");
  head.appendChild(iconEl("sect-caret", "caret"));
  head.appendChild(el("span", "sect-name", name));
  head.appendChild(el("span", "sect-count"));
  head.addEventListener("click", function () {
    foldSect(box, !box.classList.contains("shut"));
    sound("move");
    setPaint();
  });
  return head;
}

/* One row of the settings screen. Driven by the server's schema, so a setting
 * with a known set of answers gets a dropdown instead of a text box. The hint
 * never runs defaults through JSON.stringify, which doubles a path's backslashes. */
function optionRow(group, key, value, def, meta) {
  var rowEl = el("div", "opt");

  var type = meta.type || (typeof def === "boolean" ? "bool"
                        : typeof def === "number" ? "number"
                        : Array.isArray(def) ? "list" : "text");

  // The icon comes from the kind of control, so a setting added tomorrow
  // gets one without anybody choosing it.
  rowEl.appendChild(iconEl("opt-ico", ROW_ICONS[type]));

  var label = el("label");
  var words = meta.label || key;
  var help = meta.help || ("default: " + prettyDefault(def));
  label.appendChild(document.createTextNode(words));
  label.appendChild(el("span", "hint", help));
  rowEl.appendChild(label);
  // What "find a setting" searches: what you can see, plus the key itself,
  // because someone who knows the file will type the key.
  rowEl.dataset.find = (words + " " + help + " " + group + " " + key).toLowerCase();
  // What the row's tooltip adds: the default (as its dropdown names it) and the
  // key it is saved under, for anyone reading data\settings.json.
  rowEl.dataset.tipDefault = type === "enum" && meta.options && meta.options[String(def)] !== undefined
    ? meta.options[String(def)] : prettyDefault(def) + (meta.unit ? " " + meta.unit : "");
  rowEl.dataset.tipKey = group + "." + key;

  var input;

  if (type === "enum" && meta.options) {
    input = el("select");
    var kin = meta.groups || {}, boxes = {};     // choices that belong together (a family of themes) stand under one heading
    Object.keys(meta.options).forEach(function (v) {
      var o = el("option", null, meta.options[v]);
      o.value = v;
      if (String(value) === v) { o.selected = true; }
      if (kin[v] && !boxes[kin[v]]) { boxes[kin[v]] = input.appendChild(el("optgroup")); boxes[kin[v]].label = kin[v]; }
      (kin[v] ? boxes[kin[v]] : input).appendChild(o);
    });
  } else if (type === "bool") {
    input = el("input", "tgl");     // dressed as a switch by the CSS
    input.type = "checkbox";
    input.checked = !!value;
  } else if (type === "number") {
    input = el("input");
    input.type = "number";
    input.step = meta.step || (Number.isInteger(def) ? 1 : 0.05);
    if (meta.min !== undefined) { input.min = meta.min; }
    if (meta.max !== undefined) { input.max = meta.max; }
    input.value = value;
  } else if (type === "range") {
    // A slider with its number beside it, for a level rather than a count.
    var wrap = el("span", "set-range");
    input = el("input");
    input.type = "range";
    input.min = meta.min !== undefined ? meta.min : 0;
    input.max = meta.max !== undefined ? meta.max : 100;
    input.step = meta.step || 1;
    input.value = value;
    // The number, and what it counts when the schema says (the text size's px).
    // A slider whose far right is no number at all says that there (meta.top).
    var unit = meta.unit ? " " + meta.unit : "";
    var said = function (v) { return meta.top && Number(v) >= Number(input.max) ? meta.top : v + unit; };
    var readout = el("span", "set-range-n", said(value));
    // Room for its longest words, so the slider does not move under the hand.
    var widest = Math.max((input.max + unit).length, String(meta.top || "").length);
    if (widest > 5) { readout.style.minWidth = (widest + 1) + "ch"; }
    input.addEventListener("input", function () { readout.textContent = said(input.value); });
    // The limit on the sound under the pointer is heard where it is set.
    if (group === "sound" && key === "hoverRate") {
      input.addEventListener("change", function () { hearHoverRate(Number(input.value)); });
    }
    // The brightness sliders show themselves while they move, and are
    // saved where they come to rest (js\settings-save.js).
    if (group === "feel" && (key === "textBrightness" || key === "brightness")) {
      input.addEventListener("input", function () { setBrightness(key, Number(input.value)); });
    }
    // So does the text size, and everything above the slider grows or
    // shrinks with it, so its row is kept in sight while it moves.
    if (group === "feel" && key === "textSize") {
      input.addEventListener("input", function () {
        setTextSize(Number(input.value));
        rowEl.scrollIntoView({ block: "nearest" });
      });
      // From the press to the letting go, wherever the pointer is by then: the window takes its new size there.
      input.addEventListener("pointerdown", function () {
        holdWindow(true);
        var free = function () {
          ["pointerup", "pointercancel"].forEach(function (e) { window.removeEventListener(e, free, true); });
          holdWindow(false);
          rowEl.scrollIntoView({ block: "nearest" });
        };
        ["pointerup", "pointercancel"].forEach(function (e) { window.addEventListener(e, free, true); });
      });
    }
    wrap.appendChild(input);
    wrap.appendChild(readout);
    input.dataset.group = group;
    input.dataset.key = key;
    rowEl.appendChild(wrap);
    return rowEl;
  } else if (type === "list") {
    input = el("input");
    input.type = "text";
    input.value = Array.isArray(value) ? value.join(", ") : "";
    input.placeholder = "blank = all";
    input.dataset.list = "1";
  } else {
    input = el("input");
    input.type = "text";
    input.value = value === null ? "" : value;
    if (type === "path") { input.spellcheck = false; input.className = "path"; }
  }

  input.dataset.group = group;
  input.dataset.key = key;
  // Picking a sound set plays it there and then: choosing sounds by name
  // and finding out after the page is drawn again is no way to choose sounds.
  if (group === "sound" && key === "soundSet") {
    input.addEventListener("change", function () { sound("select", input.value); });
    input.addEventListener("input", function () { SND.soundSet = input.value; });   // in use at once, and put back with a refused save
  }
  // Xsegon's volume is heard as it moves, and the corner's bar follows: no page drawn again for it.
  if (group === "sound" && key === "volume") {
    input.addEventListener("input", function () { setVolume(Number(input.value), false, false); });
    input.addEventListener("change", function () { sound("move"); });
  }
  if (group === "sound" && key === "backSound") {
    // Audition exactly what Back will now play.
    input.addEventListener("change", function () {
      var setSel = $settings.querySelector('[data-key="soundSet"]');
      var cur = (setSel && setSel.value) || SND.soundSet;
      if (input.value === "select") { sound("select", cur); }
      else { sound("back", input.value || cur); }
    });
  }
  // A folder is chosen in the Windows window, never typed (js/scan.js).
  rowEl.appendChild(type === "path" ? browseOnly(input, { kind: "folder", title: "Choose the " + String(meta.label || "folder").toLowerCase(), clear: true }) : input);
  return rowEl;
}

// A settings row that DOES something rather than storing something.
function actionRow(label, help, caption, fn) {
  var rowEl = el("div", "opt");
  rowEl.appendChild(iconEl("opt-ico", ROW_ICONS.action));
  var l = el("label");
  l.appendChild(document.createTextNode(label));
  l.appendChild(el("span", "hint", help));
  rowEl.appendChild(l);
  rowEl.dataset.find = (label + " " + help + " " + caption).toLowerCase();
  var b = el("button", null, caption);
  b.addEventListener("click", fn);
  rowEl.appendChild(b);
  return rowEl;
}

/* Sound packs: what is on this PC. A pack of your own is a folder you make in data\sounds. */
function soundsRow(page) {
  var row = el("div", "opt");
  row.appendChild(iconEl("opt-ico", ROW_ICONS.action));
  var l = el("label");
  l.appendChild(document.createTextNode("Sound packs"));
  var hint = el("span", "hint", "reading...");
  l.appendChild(hint);
  row.appendChild(l);
  row.dataset.find = "sound packs";
  page.appendChild(row);
  /* The sets that ship with Xsegon (sounds\Xsegon, sounds\Xsegon 2) are
     counted apart: they are not packs in anyone's folder. */
  function paint() {
    api("api/sounds.php").then(function (r) {
      if (!r.ok) { hint.textContent = "could not read the packs"; return; }
      var packs = r.packs.filter(function (p) { return !p.builtin; });
      var builtins = r.packs.length - packs.length;
      var builtin = builtins > 0;
      var own = "A pack of your own is a folder in data\\sounds holding Move, Select and Back, each a .wav, .ogg or .mp3.";
      if (!packs.length) {
        hint.textContent = (builtin ? "No sound packs of your own yet, so Xsegon's built-in set plays. "
                                    : "No sound packs on this PC, so the interface is silent. ") + own;
        return;
      }
      hint.textContent = packs.length + (packs.length === 1 ? " pack" : " packs") + " of your own, in Xsegon's own folder. " +
        (builtins > 1 ? "Xsegon's built-in sets are on the list too. " : builtin ? "Xsegon's built-in set is on the list too. " : "") +
        (r.standIn ? "The set chosen (" + r.using + ") is not on this PC, so the built-in set plays in its place." : "");
    });
  }
  paint();
}

// No kind: every cache in use (the box, the grid's kind, and each kind built
// before, since those caches are read too). One kind: just that one, as the Image Group menu asks.
export function runThumbs(kind) {
  var kinds = typeof kind === "string" ? [kind] : ["box", gridImage()].concat(Object.keys(thumbsBy).filter(function (k) { return thumbsBy[k]; }))
    .filter(function (k, i, all) { return smallCopies(k) && all.indexOf(k) === i; });
  L("THM", "build asked: " + kinds.join(", "));
  Promise.all(kinds.map(function (k) {
    return api("api/thumbs.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Logos are wide and short: 400 across would leave them too few
      // pixels tall for the wheel's chosen banner.
      body: JSON.stringify({ kind: k, width: k === "logo" ? 500 : 400 })
    });
  })).then(function (all) {
    /* Nothing is said before the server has answered: a build it refused
       is not "building". One that began is the bar in the corner, which
       Settings would hide, so Settings closes for it; the bar says the end. */
    var refused = all.filter(function (r) { return !r || !r.ok; });
    if (all.length > refused.length) {
      if (!$settings.hidden) { closeSettings(); }
      jobsWatch("thumbs");
    }
    if (refused.length) {
      showStrip((refused.length < all.length ? "some thumbnails were not built: " : "the thumbnails were not built: ") + ((refused[0] && refused[0].error) || "no answer"), true);
    }
  });
}

function prettyDefault(def) {
  if (typeof def === "boolean") { return def ? "on" : "off"; }
  if (Array.isArray(def)) { return def.length ? def.join(", ") : "all"; }
  if (def === "") { return "blank"; }
  return String(def);          // never JSON.stringify: it doubles backslashes
}

/* Applies to the page first and saves afterwards, deliberately: someone
   pressing this cannot currently read the screen, so the fix has to be
   instant and must not depend on a round trip succeeding. */
export function toggleContrast() {
  L("SET", "contrast " + (!$body.classList.contains("high-contrast") ? "on" : "off"));
  var on = !$body.classList.contains("high-contrast");
  $body.classList.toggle("high-contrast", on);
  sound("select");
  saveSetting({ feel: { highContrast: on } }, "High contrast");
}
