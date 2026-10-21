/*  Your name and your logo on it (roadmap BB1, includes\brand.php): Settings >
 *  Feel > Your name and logo, and the screen following a change at once. Your
 *  picture stands where the wordmark is and keeps its job as the menu button;
 *  your name is the window's title. Xsegon's own name stays in Help > About
 *  (js\about.js), Messages, Report a problem and the log.
 */

import { uploadPieces } from "./art-editors.js";
import { L, postJson } from "./log.js";
import { noteSaved } from "./settings-save.js";
import { sound } from "./sound.js";
import { $logo, S } from "./state.js";
import { el } from "./util.js";

var NONE = { name: "", title: "Xsegon", own: false, has: false, rev: 0, width: 0, height: 0, square: false };

export function brandNow() { return window.XSEGON.brand || NONE; }

function picUrl(b) { return "/api/brand.php?img=1&v=" + b.rev; }

/* The tip under the wheel (js\logotip.js) names Xsegon only on Xsegon's own look. */
export function logoTipWords() {
  return (brandNow().own ? "Press the logo" : "Press the Xsegon logo") + " for the menus: Games, Get Media, Emulators and Help";
}

/* The wordmark's place, the title, the tab and taskbar icon and the tip, as index.php draws them. */
export function applyBrand(b) {
  window.XSEGON.brand = b;
  $logo.textContent = "";
  if (b.has) {
    var pic = el("img", "brand-own");
    pic.src = picUrl(b);
    pic.alt = b.name || "Your logo";
    $logo.appendChild(pic);
  } else if (b.name) {
    $logo.appendChild(el("span", "brand-name", b.name));
  } else {
    var mark = el("img");
    mark.src = "/img/xsegon-wordmark.png";
    mark.alt = "Xsegon";
    mark.width = 145;
    mark.height = 26;
    $logo.appendChild(mark);
  }
  document.title = b.title;
  // Yours as the icon only when about square: a wide one is unreadable that small.
  document.querySelectorAll('link[rel="icon"]').forEach(function (n) { n.remove(); });
  (b.square ? [[picUrl(b), ""]] : [["/img/xsegon-32.png", "32x32"], ["/img/xsegon-192.png", "192x192"]]).forEach(function (i) {
    var link = document.createElement("link");
    link.rel = "icon";
    link.href = i[0];
    if (i[1]) { link.type = "image/png"; link.setAttribute("sizes", i[1]); }
    document.head.appendChild(link);
  });
  var tip = document.querySelector(".logo-tip-words");
  if (tip) { tip.textContent = logoTipWords(); }
}

function named(name) {
  var b = brandNow(), n = name.trim().replace(/\s+/g, " ").slice(0, 60);
  return Object.assign({}, b, { name: n, title: n || "Xsegon", own: b.has || n !== "" });
}

function picWords(b) {
  return b.has ? b.width + " by " + b.height + " at the top left, where the Xsegon wordmark was" + (b.square ? ", and the icon on the tab and the taskbar." : ". A square picture would be the tab and taskbar icon too.")
               : "None: the Xsegon wordmark is at the top left. A PNG, JPEG, WebP or GIF; a PNG keeps its see-through parts. A square picture is the tab and taskbar icon too.";
}

/* Settings > Feel > Your name and logo. The name is the setting's own row above these; it shows as you type. */
export function brandRows(page, actionRow) {
  var nameBox = page.querySelector('input[data-group="feel"][data-key="brandName"]');
  if (nameBox) {
    nameBox.maxLength = 60;
    nameBox.placeholder = "Xsegon";
    nameBox.addEventListener("input", function () { applyBrand(named(nameBox.value)); });
  }

  var file = el("input");
  file.id = "brand-file";
  file.type = "file";
  file.accept = "image/png,image/jpeg,image/webp,image/gif";
  file.hidden = true;
  var picRow = actionRow("Your picture", picWords(brandNow()), "Choose a picture...", function () { file.click(); });
  var hint = picRow.querySelector(".hint");
  // The picture as it stands at the top left, on the top bar's own ground.
  var look = el("span", "brand-look");
  function paintLook() {
    var b = brandNow();
    look.textContent = "";
    look.hidden = !b.has;
    if (b.has) { var p = el("img"); p.src = picUrl(b); p.alt = ""; look.appendChild(p); }
    hint.textContent = picWords(b);
    hint.classList.remove("bad");
  }
  picRow.insertBefore(look, picRow.querySelector("button"));
  picRow.appendChild(file);
  paintLook();
  file.addEventListener("change", function () {
    var f = file.files[0];
    file.value = "";
    if (!f) { return; }
    L("SET", "your logo: " + f.name + " chosen, " + Math.round(f.size / 1024) + " KB");
    uploadPieces("api/brand.php?logo=1", f, function (t) { hint.textContent = t; }).then(function (r) {
      delete r.ok;
      applyBrand(r);
      paintLook();
      sound("select");
    }).catch(function (e) {
      hint.textContent = e.message;
      hint.classList.add("bad");
      sound("back");
    });
  });
  page.appendChild(picRow);

  page.appendChild(actionRow("Xsegon's own",
    "The Xsegon wordmark and the name Xsegon back. Your picture is deleted from Xsegon's data folder and your name emptied.",
    "Use Xsegon's", function () {
      postJson("api/brand.php?reset=1", {}).then(function (r) {
        if (!r || !r.ok) { hint.textContent = (r && r.error) || "no answer from the PC"; hint.classList.add("bad"); sound("back"); return; }
        delete r.ok;
        applyBrand(r);
        if (S.feel) { S.feel.brandName = ""; }
        if (nameBox) { nameBox.value = ""; noteSaved(nameBox); }
        paintLook();
        sound("select");
      });
    }));
}
