// ---------- settings: Achievements, on the Emulators page ----------
/*  RetroAchievements (api\achievements.php). RetroArch earns them, signed in
    through its own Settings > Achievements: this says how far that is and
    opens RetroArch for it. The site key lets Xsegon read what was earned; it
    is kept on this PC only, and nothing here ever shows it again.          */

import { iconEl } from "./icons.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { sound } from "./sound.js";
import { el } from "./util.js";

// What RetroArch's sign-in says, by the next step the person takes (includes\achievements.php). The tab says it too (js\achtab.js).
export function signInWords(ra) {
  if (ra.step === "none") { return "No RetroArch found yet. Achievements are earned in RetroArch, so Settings > Emulators gets it first."; }
  if (ra.step === "signin") {
    return "Not signed in yet. In RetroArch: Settings > Achievements, switch Achievements on, type your RetroAchievements name and password, " +
           "and leave Hardcore Mode on. Then load any game there once and close RetroArch.";
  }
  if (ra.step === "finish") {
    return "Your password is in RetroArch's settings, but it has not signed in yet. Load any game in RetroArch by itself once, then close it: " +
           "it then keeps a sign-in of its own in place of your password.";
  }
  if (ra.step === "off") { return "Signed in as " + ra.name + ", but Achievements is switched off in RetroArch's Settings > Achievements."; }
  return "Signed in as " + ra.name + ", hardcore " + (ra.hardcore ? "on" : "off") + ". Every RetroArch game earns them.";
}

function settingRow(icon, label) {
  var r = el("div", "opt ach-row");
  r.appendChild(iconEl("opt-ico", icon));
  var l = el("label", null, label);
  var hint = el("span", "hint");
  l.appendChild(hint);
  r.appendChild(l);
  var side = el("span", "ach-ctl");
  r.appendChild(side);
  r.dataset.find = label.toLowerCase() + " achievements retroachievements";
  return { row: r, hint: hint, side: side };
}

function button(words, fn, primary) {
  var b = el("button", primary ? "primary" : null, words);
  b.addEventListener("click", fn);
  return b;
}

export function achievementsPart(sect) {
  var signIn = settingRow("shield", "RetroArch's sign-in");
  var key = settingRow("pencil", "Your RetroAchievements key");
  var acct = settingRow("refresh", "What RetroAchievements says");
  signIn.row.dataset.land = "achievements";    // the Achievements tab's Sign in or out lands here
  [signIn, key, acct].forEach(function (r) { sect.appendChild(r.row); });
  var said = null;      // the server's last word, kept on the account row until the next paint

  function paint(res) {
    if (!res || !res.ok) { signIn.hint.textContent = "could not read RetroArch's sign-in"; return; }
    var ra = res.ra;
    signIn.hint.textContent = signInWords(ra);
    signIn.hint.className = "hint" + (ra.step === "ready" ? " ok" : "");
    signIn.side.textContent = "";
    if (ra.step !== "none") {
      signIn.side.appendChild(button("Open RetroArch", function () {
        api("api/retroarch.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(function (r) {
          showStrip(r.ok ? "RetroArch is opening: Settings > Achievements" : ("could not open RetroArch: " + (r.error || "")), !r.ok);
        });
      }));
    }

    key.side.textContent = "";
    if (res.key) {
      key.hint.textContent = "Kept on this PC only. A copy of Xsegon's data folder on another PC does not carry it.";
      key.side.appendChild(button("Forget it", function () {
        postJson("api/achievements.php", { forget: true }).then(function (out) {
          if (!out.ok) { showStrip(out.error || "the key was not forgotten", true); return; }
          L("ACH", "key forgotten");
          sound("back");
          said = null;
          paint(out);
        });
      }));
    } else {
      key.hint.textContent = (res.keyElsewhere ? "The key kept here was put in on another PC and does not open on this one. " : "") +
        "Lets Xsegon read what you have earned. On retroachievements.org: your name, Settings, Keys, then copy the whole Web API Key.";
      var box = el("input");
      box.type = "password";
      box.placeholder = "paste your key";
      box.autocomplete = "off";
      box.spellcheck = false;
      var save = button("Save", function () {
        var v = box.value.trim();
        if (!v) { box.focus(); return; }
        save.disabled = true;
        acct.hint.textContent = "asking RetroAchievements...";
        postJson("api/achievements.php", { key: v }).then(function (out) {
          save.disabled = false;
          if (!out.ok) { said = { bad: true, words: out.error || "the key was not kept" }; paintSaid(); sound("back"); return; }
          L("ACH", "key kept" + (out.checked ? ", the site took it" : ", not checked"));
          sound("ok");
          said = out.checked ? { words: "✓ Kept, and RetroAchievements knows you." } : { words: "✓ Kept. Not checked yet: " + out.why + "." };
          paint(out);
        });
      }, true);
      box.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); save.click(); } });
      key.side.appendChild(box);
      key.side.appendChild(save);
      key.side.appendChild(button("Get my key", function () {
        postJson("api/achievements.php", { open: "keys" }).then(function (r) {
          showStrip(r.ok ? "Opened retroachievements.org/settings in your browser: Keys is near the bottom" : ("the page did not open: " + (r.error || "")), !r.ok);
        });
      }));
    }

    acct.row.hidden = !res.key && !said;
    acct.side.textContent = "";
    if (res.key) {
      acct.side.appendChild(button("Check again", function () {
        acct.hint.textContent = "asking RetroAchievements...";
        postJson("api/achievements.php", { check: true }).then(function (out) {
          if (!out.ok) { said = { bad: true, words: out.error || "no answer" }; paintSaid(); return; }
          said = { words: "✓ Checked just now." };
          paint(out);
        });
      }));
    }
    paintSaid(res.user);
  }

  // The account row: the last answer the site gave, then what the last press got.
  function paintSaid(user) {
    var u = user || acct.user;
    acct.user = u;
    var words = u ? u.name + ": " + u.points + " points in hardcore" + (u.softPoints ? ", " + u.softPoints + " in softcore" : "") +
                    (u.playing ? ". Last seen: " + u.playing : "") + "." : "";
    acct.hint.textContent = [said ? said.words : "", words].filter(Boolean).join(" ");
    acct.hint.className = "hint" + (said && said.bad ? " bad" : said ? " ok" : "");
    if (said && said.bad) { acct.row.hidden = false; }
  }

  api("api/achievements.php").then(paint);
}
