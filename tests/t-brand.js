/* Your name and your logo on it (roadmap BB1, includes\brand.php, api\brand.php,
   js\brand.js): Settings > Feel > Your name and logo, the top left, the window's
   title, the tab icon, the tip under the wheel, Help > About, and Use Xsegon's.
   The pictures are drawn in the page and handed to the file box as a pick is. */
"use strict";
const { api, apiUntil, BASE } = require("./lib");

// What stands at the top left: [tag, class, the picture's address or the letters].
const TOP_LEFT = `(c => c ? [c.tagName.toLowerCase(), c.className, c.tagName === "IMG" ? c.getAttribute("src").split("?")[0] : c.textContent] : null)(document.getElementById("brand-logo").firstElementChild)`;
const ICONS = `[...document.querySelectorAll('link[rel="icon"]')].map((n) => n.getAttribute("href").split("?")[0])`;
const WORDMARK = ["img", "", "/img/xsegon-wordmark.png"];
const XS_ICONS = ["/img/xsegon-32.png", "/img/xsegon-192.png"];
const TIP_WORDS = `import("/js/brand.js").then((m) => m.logoTipWords())`;
const NAME = "The Basement Arcade";
const NAME_BOX = `document.querySelector('#settings input[data-group="feel"][data-key="brandName"]')`;
const PIC_HINT = `[...document.querySelectorAll("#settings .opt")].find((r) => r.contains(document.getElementById("brand-file"))).querySelector(".hint")`;

// A w by h PNG drawn in the page, or a text file named .png, into the picture's file box.
const PICK = (w, h) => `(async () => {
  let f;
  if (${w} > 0) {
    const c = document.createElement("canvas"); c.width = ${w}; c.height = ${h};
    const x = c.getContext("2d"); x.fillStyle = "#e2723a"; x.fillRect(0, 0, ${w}, ${h}); x.fillStyle = "#ffffff"; x.fillRect(4, 4, ${w} - 8, ${h} / 3);
    f = new File([await new Promise((r) => c.toBlob(r, "image/png"))], "my-logo.png", { type: "image/png" });
  } else {
    f = new File(["this is not a picture"], "my-logo.png", { type: "image/png" });
  }
  const dt = new DataTransfer(); dt.items.add(f);
  const box = document.getElementById("brand-file"); box.files = dt.files; box.dispatchEvent(new Event("change"));
  return true;
})()`;

module.exports = async function (b, check) {
  // Set what is assumed: nothing of anyone's, and List.
  const before = (await api("api/settings.php")).settings;
  const view0 = before.view.default;
  check("Use Xsegon's answers from this PC, and nothing is set after it", await api("api/brand.php?reset=1", {}).then((r) => [r.ok, r.own, r.has, r.name]), [true, false, false, ""]);
  await api("api/settings.php", { view: { default: "list" } });

  const feel = async () => {
    if (await b.ev(`document.getElementById("settings").hidden`)) {
      await b.clickSel("#btn-settings");
      await b.waitFor(`!document.getElementById("settings").hidden`);
    }
    await b.ev(`(() => { const t = [...document.querySelectorAll("#settings .set-tab")].find((x) => x.textContent.includes("Feel")); t.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })); t.click(); })()`);
    await b.until(`[...document.querySelectorAll("#settings .set-page")].find((p) => !p.hidden).dataset.group`, "feel");
  };
  const shut = async () => { if (!(await b.ev(`document.getElementById("settings").hidden`))) { await b.key("Escape"); await b.waitFor(`document.getElementById("settings").hidden`, 3000); } };

  try {
    await b.goto();
    check("with nothing set: the Xsegon wordmark at the top left, Xsegon on the title, Xsegon's icons",
          await b.ev(`[${TOP_LEFT}, document.title, ${ICONS}]`), [WORDMARK, "Xsegon", XS_ICONS]);
    check("and the tip under the wheel names Xsegon's logo", await b.ev(TIP_WORDS), "Press the Xsegon logo for the menus: Games, Get Media, Emulators and Help");

    await feel();
    check("Settings > Feel has Your name and logo: the name, Choose a picture... and Use Xsegon's",
          await b.ev(`[!!${NAME_BOX}, [...document.querySelectorAll("#settings button")].filter((x) => /^(Choose a picture\\.\\.\\.|Use Xsegon's)$/.test(x.textContent)).map((x) => x.textContent)]`),
          [true, ["Choose a picture...", "Use Xsegon's"]]);

    // A name: in letters at the top left and on the title as it is typed, kept when the box is left.
    await b.ev(`(n => { n.value = ${JSON.stringify(NAME)}; n.dispatchEvent(new Event("input", { bubbles: true })); })(${NAME_BOX})`);
    check("a name typed shows at once: in letters at the top left, and on the window's title",
          await b.ev(`[${TOP_LEFT}, document.title]`), [["span", "brand-name", NAME], NAME]);
    await b.ev(`${NAME_BOX}.dispatchEvent(new Event("change", { bubbles: true }))`);
    check("and is kept", await apiUntil(async () => (await api("api/brand.php")).name === NAME, 5000), true);

    // A file that is not a picture: said, and nothing changes.
    await b.ev(PICK(0, 0));
    check("a file that is not a picture is refused, saying so, and nothing is kept",
          await b.until(`(h => [/not a picture/.test(h.textContent), h.classList.contains("bad")])(${PIC_HINT})`, [true, true], 6000), [true, true]);
    check("the server has no picture", (await api("api/brand.php")).has, false);

    // A wide picture: at the top left, the icons stay Xsegon's.
    await b.ev(PICK(300, 60));
    check("a wide picture is kept, 300 by 60, not square", await apiUntil(async () => { const r = await api("api/brand.php"); return r.has && [r.width, r.height, r.square]; }, 8000), [300, 60, false]);
    check("it stands at the top left at once, and the icons stay Xsegon's",
          await b.until(`[${TOP_LEFT}, ${ICONS}]`, [["img", "brand-own", "/api/brand.php"], XS_ICONS], 4000), [["img", "brand-own", "/api/brand.php"], XS_ICONS]);
    check("Settings shows it, with its size", await b.ev(`/^300 by 60 at the top left/.test(${PIC_HINT}.textContent)`), true);

    // A square one: the tab and taskbar icon too.
    await b.ev(PICK(64, 64));
    check("a square picture is the tab and taskbar icon as well",
          await b.until(`${ICONS}`, ["/api/brand.php"], 8000), ["/api/brand.php"]);
    const pic = await fetch(BASE + "/api/brand.php?img=1");
    check("the picture is served as a PNG", [pic.status, pic.headers.get("content-type")], [200, "image/png"]);
    await shut();

    // Drawn by the server as well, so a restart shows it before any script runs.
    await b.goto();
    check("opened again: your picture, your name on the title, your icon",
          await b.ev(`[${TOP_LEFT}, document.title, ${ICONS}, document.querySelector("#brand-logo img").alt]`),
          [["img", "brand-own", "/api/brand.php"], NAME, ["/api/brand.php"], NAME]);
    check("and the tip under the wheel says the logo, not Xsegon's", await b.ev(TIP_WORDS), "Press the logo for the menus: Games, Get Media, Emulators and Help");

    // Where there is no menu bar, your picture is still the menu button.
    await b.setView("wheel");
    await b.clickSel("#brand-logo");
    check("on Wheel your picture opens the menus, as the wordmark does",
          await b.waitFor(`!!document.querySelector(".ctx") && document.getElementById("brand-logo").classList.contains("as-orb")`, 3000), true);
    await b.key("Escape");
    await b.setView("list");

    // Help > About keeps Xsegon's name, whatever this copy wears.
    await b.openBar("help");
    await b.menuItem(/^About Xsegon/);
    const about = await b.ev(`(c => c ? c.innerText : "")(document.querySelector(".confirm.about"))`);
    check("Help > About names Xsegon, its version, its licence and its maker",
          [/^ABOUT XSEGON|^About Xsegon/m.test(about), /Xsegon \d+\.\d+/.test(about), /MIT licence/.test(about), /Tumultuous Productions/.test(about)], [true, true, true, true]);
    check("and says this copy wears your name, and where to change it", /wears the name The Basement Arcade: Settings > Feel > Your name and logo/.test(about), true);
    await b.key("Escape");

    // Use Xsegon's: one press back.
    await feel();
    await b.ev(`[...document.querySelectorAll("#settings button")].find((x) => x.textContent === "Use Xsegon's").click()`);
    check("Use Xsegon's puts the wordmark, the title and the icons back at once, and empties the name box",
          await b.until(`[${TOP_LEFT}, document.title, ${ICONS}, ${NAME_BOX}.value]`, [WORDMARK, "Xsegon", XS_ICONS, ""], 5000), [WORDMARK, "Xsegon", XS_ICONS, ""]);
    check("the picture is gone from the PC and the name emptied", await api("api/brand.php").then((r) => [r.own, r.has, r.name]), [false, false, ""]);
    check("and asking for it finds nothing", (await fetch(BASE + "/api/brand.php?img=1")).status, 404);
    await shut();
  } finally {
    await api("api/brand.php?reset=1", {});
    await api("api/settings.php", { feel: { brandName: before.feel.brandName || "" }, view: { default: view0 } });
  }
};
