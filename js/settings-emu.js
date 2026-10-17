// ---------- settings: the Emulators page ----------
// Its own file to keep js/settings-ui.js under 700 lines.

import { achievementsPart } from "./achsettings.js";
import { openEmuAdd } from "./emuadd.js";
import { iconEl } from "./icons.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { noGamesBox } from "./nogames.js";
import { raButton, raLabel } from "./raoffer.js";
import { browseOnly } from "./scan.js";
import { closeSettings, openSettings } from "./settings-ui.js";
import { openGuide, setupRows } from "./setup.js";
import { sound } from "./sound.js";
import { hasLaunchBox } from "./state.js";
import { el } from "./util.js";

/* Emulators: the table Xsegon keeps of its own, which lets a game launch with
   LaunchBox moved or gone. Built from the file rather than settings keys: which
   emulators exist is a fact about the machine. Moving one is one path changed
   here, used from the next launch with no re-import.
   actionRow is the settings screen's own button row, as js\setup.js's setupRows takes it. */
export function emulatorsPage(part, actionRow) {
  // Sections under headings that fold, as on every other page: what adds or sets one up, the ones there are, then RetroArch's achievements.
  var top = part("Add and set up"), mine = part("Your emulators");
  achievementsPart(part("Achievements"));
  var hold = top.appendChild(el("div", "setup-hold"));
  // Settings closes for the screen and opens here again when it is done.
  function openAdd(program) {
    closeSettings("stay");
    openEmuAdd({ program: program, after: function () { openSettings("emulators"); } });
  }
  var lacking = el("p", "mt-note warn emu-without");
  lacking.hidden = true;
  top.appendChild(lacking);
  var raHold = top.appendChild(el("div", "bar emu-ra"));
  raHold.hidden = true;
  top.appendChild(actionRow("Add an emulator",
    "A program of your own for a console, such as Dolphin, PCSX2 or DuckStation. Choose it, select its consoles, and their games start in it.",
    "Add...", function () { openAdd(null); }));
  var box = el("div", "emu-list");
  var note = el("p", "mt-note", "reading the table...");
  mine.appendChild(box);
  mine.appendChild(note);
  // What was saved, by program, said in its row until another page is opened:
  // the list is painted afresh after a save, which would wipe the row's word of it.
  var saved = {};

  /* Consoles with games and nothing to start them. Those RetroArch plays are said
     with its press: Set it all up beside the line, or the RetroArch row above it. */
  function paintLacking(res) {
    var without = res.without || [];
    var byRa = without.filter(function (c) { return c.ra; });
    var named = function (list) { return list.map(function (c) { return c.name + " (" + c.games + (c.games === 1 ? " game" : " games") + ")"; }).join(", "); };
    var rest = without.length > byRa.length ? " Add an emulator below for " + (byRa.length ? "the others" : without.length === 1 && without[0].games === 1 ? "it" : "them") + "." : "";
    lacking.hidden = !without.length;
    lacking.textContent = !without.length ? ""
      : byRa.length && res.raOffer === "coming" ? "RetroArch is being set up: " + named(byRa) + " play once it is in." + rest
      : byRa.length && raLabel(res.raOffer) ? "No emulator yet for " + named(without) + ". RetroArch plays " + (byRa.length === without.length ? (without.length === 1 ? "it" : "them") : byRa.map(function (c) { return c.name; }).join(", ")) +
        (res.raOffer === "setup" ? ": Set it all up gets it." : ": the RetroArch row above gets it.") + rest
      : "No emulator yet for " + named(without) + ". Add one below and " + (without.length === 1 && without[0].games === 1 ? "it becomes" : "they become") + " playable.";
    raHold.textContent = "";
    var ra = byRa.length && res.raOffer === "setup" ? raButton("setup", "Settings > Emulators", "emu-ra-btn") : null;
    raHold.hidden = !ra;
    if (ra) { raHold.appendChild(ra); }
  }

  function paint(res) {
    box.textContent = "";
    if (res.ok) { paintLacking(res); }
    if (!res.ok || !res.programs.length) {
      note.textContent = hasLaunchBox
        ? "No emulator table yet. Re-read your library once (Library > Import) and Xsegon will write one from LaunchBox."
        : "No emulators set up yet. Help > Getting started gets RetroArch and sets it up.";
      return;
    }
    res.programs.forEach(function (p) {
      var r = el("div", "emu-row" + (p.there ? "" : " bad"));
      var head = el("div", "emu-head");
      head.appendChild(iconEl("emu-ico", p.there ? "disc" : "bug"));
      head.appendChild(el("span", "emu-name", p.name));
      head.appendChild(el("span", "emu-count",
        p.consoles.length + (p.consoles.length === 1 ? " console" : " consoles")));
      r.appendChild(head);
      // RetroArch's consoles are its cores' business; one of your own says which it starts.
      if (p.kind !== "retroarch") {
        r.appendChild(el("div", "emu-plays", p.plays.length ? "Starts the games of " + p.plays.join(", ") + "."
                                                              : "No console's games start in it now."));
      }

      var input = el("input");
      // A type, or the theme passes it by: the dark field is styled as
      // input[type="text"], which a bare <input> does not match.
      input.type = "text";
      input.className = "path";
      input.spellcheck = false;
      input.value = p.exe;
      var save = el("button", null, "Save");
      var line = el("div", "emu-path");
      // The program is chosen in the Windows window, never typed, and saved
      // as soon as it is chosen (js/scan.js, browseOnly).
      line.appendChild(browseOnly(input, { kind: "file", title: "Choose the program for " + p.name, then: function () { save.click(); } }));
      line.appendChild(save);
      if (p.kind !== "retroarch") {
        var change = el("button", "emu-change", "Change...");
        change.title = "Its name, its consoles and the options it is started with, or remove it";
        change.addEventListener("click", function () { openAdd(p.key); });
        line.appendChild(change);
      }
      r.appendChild(line);

      var said = !p.there ? el("div", "emu-said bad", "this file is not there, so these games cannot launch")
               : saved[p.key] ? el("div", "emu-said ok", saved[p.key])
               : el("div", "emu-said", "");
      r.appendChild(said);

      save.addEventListener("click", function () {
        said.className = "emu-said";
        said.textContent = "saving...";
        postJson("api/emulators.php", { program: p.key, exe: input.value }).then(function (out) {
          if (!out.ok) {
            said.className = "emu-said bad";
            said.textContent = out.error || "could not save that";
            return;
          }
          L("EMU", p.key + " -> " + out.exe);
          saved[p.key] = out.was === out.exe ? "✓ Saved. It was already set to this, so nothing changed."
                                             : "✓ Saved. The next launch uses it.";
          sound("ok");
          showStrip(p.name + " now runs from " + out.exe, false);
          read();
        });
      });
      box.appendChild(r);
    });
    note.textContent = res.mine
      ? "Xsegon's own table, covering " + res.consoles + " consoles (" + res.yours +
        " of them on this machine). Moving an emulator takes effect on the next launch, with no re-import."
      : "Read live from LaunchBox. It becomes Xsegon's own the next time you import.";
    // With no games, the emulators are not what is missing: say what is.
    var had = mine.querySelector(".nogames");
    if (had) { had.remove(); }
    // Above the emulators, where it is seen first: it is what is missing.
    if (res.yours === 0) { mine.insertBefore(noGamesBox(function () { closeSettings("stay"); }, openGuide), box); }
  }

  function read() {
    api("api/emulators.php").then(paint);
  }
  read();
  // Get RetroArch, use the one you have, missing cores: only the ones that
  // apply to this machine, which for most people is none (js\setup.js).
  setupRows(hold, actionRow, read);

  if (hasLaunchBox) top.appendChild(actionRow("Read them from LaunchBox again",
    "Throws away this table and writes a fresh one from LaunchBox. Anything you changed here goes with it.",
    "Read again", function () {
      postJson("api/emulators.php", { reseed: true }).then(function (out) {
        if (!out.ok) { showStrip(out.error || "could not read LaunchBox", true); return; }
        L("EMU", "read again from LaunchBox");
        showStrip("the emulator table was read from LaunchBox again", false);
        read();
      });
    }));
}
