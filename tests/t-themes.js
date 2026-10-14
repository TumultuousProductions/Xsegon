/* Themes.
 *
 * A theme is a small file of values in themes\, read and checked by the
 * server alone (includes\themes.php), and worn by the page as the
 * stylesheet's own names on <html>. The house look is the stylesheet itself:
 * no file, always first in the list, and what any failure falls back to.
 *
 * Held here: colours a theme can reach; the server hands out only numbers;
 * the house look one press away; Dark reads in every view; a family is a
 * folder; and what a look wears by name is a word the stylesheet draws.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./lib");
const { api, ROOT } = lib;

// A colour that is the same in every theme, so it may be written as numbers.
const SAME_EVERYWHERE = ["0,0,0", "255,255,255", "248,113,113", "251,191,36", "52,211,153", "255,90,90", "255,190,80", "250,204,21"];
/* And the few left written in on purpose, with how many times each stands:
   the collections' pink, the grey of something switched off, the stamp over a
   picture, a spark on the wheel, the bed under a manual, and what High
   contrast and a magenta accent fall back to. */
const LEFT = { "236,72,153": 2, "148,163,184": 1, "10,12,18": 1, "224,252,255": 2,
               "#e8feff": 1, "#2a2d33": 1, "#e879f9": 1, "#22d3ee": 1, "#02050a": 1, "#000814": 1, "#14233c": 1, "#1d3052": 1 };

// Every background and edge on screen that is still navy: dark, and bluer than it is red.
const NAVY = `(() => {
  const bad = [], seen = new Set();
  const navy = (s) => [...String(s).matchAll(/rgba?\\((\\d+), (\\d+), (\\d+)(?:, ([\\d.]+))?\\)/g)].some((m) => {
    const r = +m[1], g = +m[2], b = +m[3], a = m[4] === undefined ? 1 : +m[4];
    return a > 0.05 && Math.max(r, g, b) < 90 && b - r >= 10;
  });
  for (const n of document.querySelectorAll("body *")) {
    if (!n.getClientRects().length) { continue; }
    const cs = getComputedStyle(n);
    for (const p of ["background-color", "background-image", "border-top-color", "border-left-color"]) {
      const v = cs.getPropertyValue(p);
      if (!navy(v)) { continue; }
      const k = n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + (typeof n.className === "string" && n.className ? "." + n.className.trim().split(/\\s+/).join(".") : "") + " " + p;
      if (!seen.has(k)) { seen.add(k); bad.push((k + " " + v).slice(0, 140)); }
    }
  }
  return bad.slice(0, 6);
})()`;
const WORN = `(() => { const r = document.documentElement, c = getComputedStyle(document.body);
  return { theme: r.dataset.theme, set: [...r.style], ground: c.backgroundColor,
           accent: c.getPropertyValue("--cyan-rgb").trim(), glowOff: document.body.classList.contains("no-glow"),
           linesOff: document.body.classList.contains("no-scanlines"),
           accentClass: [...document.body.classList].filter((x) => /^accent-/.test(x)).join(" ") }; })()`;
const X_ROWS = `[...document.querySelectorAll(".ctx .ctx-item")].map((n) => [(n.querySelector(".ctx-label") || n).textContent, n.classList.contains("on")])`;

module.exports = async function (b, check) {
  const before = (await api("api/settings.php")).settings;
  const keep = { feel: { theme: before.feel.theme, accent: before.feel.accent, glow: before.feel.glow,
                         scanlines: before.feel.scanlines, highContrast: before.feel.highContrast } };
  try {
    /* ---- the stylesheet: its colours where a theme can reach them ---------- */
    const css = fs.readFileSync(path.join(ROOT, "css", "xsegon.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
    const rootEnd = css.indexOf("}", css.indexOf(":root {"));
    const head = css.slice(0, rootEnd), rest = css.slice(rootEnd);
    const raw = fs.readFileSync(path.join(ROOT, "css", "xsegon.css"), "utf8");
    const block = (/\/\* tones \*\/([\s\S]*?)\/\* tones end \*\//.exec(raw) || [])[1] || "";
    const tones = [...block.matchAll(/--([a-z0-9-]+)-rgb:\s*\d+,\s*\d+,\s*\d+;/g)].map((m) => m[1]);
    check("the stylesheet names its navy tones in one marked block", tones.length >= 14, true);
    const declared = new Set([...head.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...rest.matchAll(/var\((--[a-z0-9-]+-rgb)\)/g)].map((m) => m[1]));
    check("every tone a rule mixes from is one the stylesheet declares", [...used].filter((v) => !declared.has(v)), []);
    const lineOf = (i) => css.slice(0, i).split("\n").length;
    const count = {}, firstAt = {};
    for (const m of rest.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
      const k = m[1] + "," + m[2] + "," + m[3];
      count[k] = (count[k] || 0) + 1; firstAt[k] = firstAt[k] || lineOf(rootEnd + m.index);
    }
    // not followed by a rule's opening brace: that would be an id in a selector
    for (const m of rest.matchAll(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b(?![^{};]*\{)/g)) {
      const k = "#" + m[1].toLowerCase();
      if (["#000", "#000000", "#fff", "#ffffff"].includes(k)) { continue; }
      count[k] = (count[k] || 0) + 1; firstAt[k] = firstAt[k] || lineOf(rootEnd + m.index);
    }
    const strays = Object.keys(count).filter((k) => !SAME_EVERYWHERE.includes(k) && count[k] > (LEFT[k] || 0))
      .map((k) => k + " (" + count[k] + " times, first at line " + firstAt[k] + ")");
    // A stray is fixed by mixing from a tone in :root, or, when it really is the same in every theme, by naming it at the head of this file.
    check("no colour a theme should change is written as numbers", strays, []);
    check("and no rule names a theme: the stylesheet knows values, never who set them", /data-theme|\.theme-/.test(css), false);
    // Without it a test build lists the house look and nothing else.
    check("a test build carries the themes folder", /const TAKE = \[[^\]]*"themes"/.test(fs.readFileSync(path.join(ROOT, "tools", "make-test-copy.js"), "utf8")), true);

    /* ---- the server: a list, values made of numbers, and the sums ---------- */
    const got = await api("api/theme.php");
    check("the house look is first in the list, and Dark is in it", [got.list[0], got.list.some((t) => t.id === "dark" && t.name === "Dark" && t.family === "")], [{ id: "xsegon", name: "Xsegon", family: "" }, true]);
    const dark = await api("api/theme.php?id=dark");
    const vars = dark.theme.vars || {};
    const VALUE = /^(\d{1,3}|\d{1,3}, \d{1,3}, \d{1,3}|rgb\(\d{1,3}, \d{1,3}, \d{1,3}\))$/;
    check("Dark comes as values under the stylesheet's own names", [dark.theme.id, dark.theme.house, Object.keys(vars).length > 20], ["dark", false, true]);
    check("every one a plain name and a plain number", Object.keys(vars).filter((k) => !/^--[a-z0-9-]+$/.test(k) || !VALUE.test(vars[k])), []);
    check("every navy tone has its own value in it", tones.filter((t) => !(("--" + t + "-rgb") in vars)), []);
    check("it has no glow and no scanlines", dark.theme.has, { glow: false, scanlines: false });
    const s = dark.sums || {};
    const under = (min, names) => names.filter((n) => !(s[n] >= min)).map((n) => n + " " + s[n]);
    check("its words read on every surface (7 to 1 and over)", under(7, ["words on ground", "words on panel", "words on panelRaised"]), []);
    check("its greyer words and its highlight read too (4.5 and over)",
          under(4.5, ["wordsSecond on ground", "wordsSecond on panel", "wordsSecond on panelRaised", "wordsThird on ground", "wordsThird on panel",
                      "highlight on ground", "highlight on panel", "ground on highlight", "white on the selection bar"]), []);
    check("and pushed, for a TV across a room, it reads further",
          under(7, ["pushed: white on ground", "pushed: white on panel", "pushed: white on panelRaised",
                    "pushed: wordsSecond on ground", "pushed: wordsSecond on panel", "pushed: wordsSecond on panelRaised", "pushed: wordsThird on panel"]), []);
    const houseSums = (await api("api/theme.php?id=xsegon")).sums || {};
    check("it is calmer than the house look, which is what it is for", s["words on ground"] < houseSums["words on ground"], true);
    // Whatever else is in the themes folder is held to the same sums: a theme that ships has to read.
    for (const t of got.list.filter((x) => x.id !== "xsegon" && x.id !== "dark")) {
      const o = (await api("api/theme.php?id=" + encodeURIComponent(t.id))).sums || {};
      const weak = Object.keys(o).filter((n) => !(o[n] >= (/^words on |^pushed: /.test(n) ? 7 : 4.5))).map((n) => n + " " + o[n]);
      check("the theme " + t.name + " reads too, plain and pushed", [Object.keys(o).length > 10, weak], [true, []]);
    }
    // What a look wears by name is drawn by the stylesheet and only named by a theme: the two lists have to be the same one.
    const drawnAs = (dial) => [...new Set([...css.matchAll(new RegExp('html\\[data-' + dial + '="([a-z0-9-]+)"\\]', "g"))].map((m) => m[1]))];
    check("every name a theme may wear is one the stylesheet draws, and no other",
          Object.keys(got.dials).map((d) => d + ": " + got.dials[d].filter((w) => !drawnAs(d).includes(w)).concat(drawnAs(d).filter((w) => !got.dials[d].includes(w))).join(" "))
            .filter((line) => !/: $/.test(line)), []);
    check("a theme may name a texture, what its panels and its corners are and a mark", Object.keys(got.dials), ["texture", "surface", "corner", "mark"]);
    const BARE = { texture: "", surface: "", corner: "", mark: "" };
    const red = await api("api/theme.php?id=" + encodeURIComponent("carbon/red"));
    const rv = red.theme.vars || {};
    check("Dark red is in the list as one of the Carbon family, with its texture named and how strong",
          [got.list.some((t) => t.id === "carbon/red" && t.name === "Dark red" && t.family === "Carbon"), red.theme.wears, /^\d{1,3}$/.test(rv["--texture-strength"] || "")],
          [true, Object.assign({}, BARE, { texture: "carbon" }), true]);
    check("and Dark wears nothing by name", [dark.theme.wears, "--texture-strength" in vars], [BARE, false]);
    for (const tex of [{ kind: "lava" }, { kind: 'carbon"]{}', strength: 5 }, { kind: "carbon", strength: 250 }, "carbon"]) {
      const r = await api("api/theme.php?check=1", { theme: { format: 1, name: "T", texture: tex } });
      check("a texture Xsegon does not draw (" + JSON.stringify(tex) + ") is left out, and that is said",
            [r.usable, ((r.theme || {}).wears || {}).texture, Object.keys((r.theme || {}).vars || { x: 1 }).length, (r.notes || []).length], [true, "", 0, 1]);
    }
    for (const [dial, word] of [["surface", "lava"], ["surface", 'sheer"]{}'], ["corner", "bevel"], ["mark", 12], ["mark", "skull"]]) {
      const r = await api("api/theme.php?check=1", { theme: { format: 1, name: "T", [dial]: word } });
      check("a " + dial + " Xsegon does not draw (" + JSON.stringify(word) + ") is left out, and that is said",
            [r.usable, ((r.theme || {}).wears || {})[dial], (r.notes || []).length], [true, "", 1]);
    }
    // A file made for an Xsegon that drew other things (a font, glass panels, an aurora) is used without them.
    const older = await api("api/theme.php?check=1", { theme: { format: 1, name: "T", font: "sans", surface: "glass", texture: { kind: "aurora", strength: 85 } } });
    check("a theme that names things this Xsegon does not draw is still used, bare, and each is said",
          [older.usable, (older.theme || {}).wears, (older.notes || []).length], [true, BARE, 3]);
    for (const id of ["nope", "../dark", "DARK", "dark.json", "carbon/nope", "carbon/../dark", "carbon/red/x", "/red"]) {
      const r = await api("api/theme.php?id=" + encodeURIComponent(id));
      check("asked for " + JSON.stringify(id) + ", the answer is the house look and why", [r.theme.id, r.theme.house, typeof r.theme.why === "string" && r.theme.why.length > 0, Object.keys(r.theme.vars).length], ["xsegon", true, true, 0]);
    }
    const hostile = await api("api/theme.php?check=1", { theme: { format: 1, name: "<script>x</script> Loud", code: "x",
      colours: { ground: "red; background:url(x)", panel: "#12", words: "#fff", evil: "#000000", highlight: "#4DAAFC" },
      has: { glow: "no", scanlines: false, lasers: true }, highContrast: "yes" } });
    const hv = (hostile.theme || {}).vars || {};
    check("a theme with things in it that are not colours keeps only its colours", [hostile.usable, Object.keys(hv).sort().join(" ")],
          [true, "--cyan-rgb --glint-rgb --ink-b --ink-g --ink-r"]);
    check("and what was left out is said, piece by piece", (hostile.notes || []).length, 7);
    check("its name is letters only", /^[A-Za-z ]+$/.test((hostile.theme || {}).name || ""), true);
    check("and nothing but numbers comes back", Object.keys(hv).filter((k) => !VALUE.test(hv[k])), []);
    for (const notOne of [null, "x", [1, 2], { format: 2 }, { format: "1" }]) {
      check("not a theme at all (" + JSON.stringify(notOne) + ") is refused whole", (await api("api/theme.php?check=1", { theme: notOne })).usable, false);
    }
    await api("api/settings.php", { feel: { theme: "xsegon" } });
    check("a theme that is not there cannot be saved", (await api("api/settings.php", { feel: { theme: "nope" } })).settings.feel.theme, "xsegon");

    /* ---- the page: the house look as it was, and one press from Dark ------- */
    await api("api/settings.php", { feel: { theme: "xsegon", accent: "amber", glow: true, scanlines: true, highContrast: false } });
    await b.goto();
    await b.enterConsole();
    await b.setView("list");
    const house = await b.ev(WORN);
    // The page keeps sizes of its own on <html> (--top-h and the like): what is looked for is a theme's names.
    const themed = (w) => w.set.filter((k) => k in vars);
    check("under the house look the page carries no theme's values at all", [house.theme, themed(house)], ["xsegon", []]);
    check("and wears what the settings say: the chosen accent, glow and scanlines", [house.accentClass, house.accent, house.glowOff, house.linesOff], ["accent-amber", "251, 191, 36", false, false]);
    await b.openBar("xsegon");
    const rows = await b.ev(X_ROWS);
    const alone = got.list.filter((t) => !t.family), families = [...new Set(got.list.filter((t) => t.family).map((t) => t.family))];
    check("the round X lists the themes under the backup, a family as one folder, the one in use marked",
          rows.slice(0, 4 + alone.length + families.length).map((r) => r[0] + (r[1] ? " *" : "")),
          ["Settings...", "Controller...", "Back up what you made...", "Connect a phone..."].concat(alone.map((t) => t.name + " theme" + (t.id === "xsegon" ? " *" : "")), families.map((f) => f + " themes")));
    check("they stand under a heading, Themes, below the line: after Connect a phone and before the first theme, and not a row to press",
          await b.ev(`(h => h.length === 1 ? [h[0].textContent, h[0].previousElementSibling.className, h[0].previousElementSibling.previousElementSibling.querySelector(".ctx-label").textContent,
                       h[0].nextElementSibling.querySelector(".ctx-label").textContent, h[0].classList.contains("ctx-item")] : h.length)([...document.querySelectorAll(".ctx .ctx-head")])`),
          ["Themes", "ctx-rule", "Connect a phone...", alone[0].name + " theme", false]);
    check("the heading wears a band of the highlight with a line above it, which a row does not",
          [await b.ev(`(s => [s.backgroundColor !== "rgba(0, 0, 0, 0)", s.borderTopWidth])(getComputedStyle(document.querySelector(".ctx > .ctx-head")))`),
           await b.ev(`getComputedStyle(document.querySelector(".ctx > .ctx-item:not(.at):not(.has-sub)")).backgroundColor`)],
          [[true, "1px"], "rgba(0, 0, 0, 0)"]);
    await b.menuItem(/^Dark theme$/);
    await b.until(WORN + ".theme", "dark", 6000);
    const worn = await b.ev(WORN);
    // Dark's colours are read from what the server hands out, so a shade changed in dark.json is not a red check here.
    check("pressing Dark puts it on there and then", [worn.theme, worn.ground, worn.accent, themed(worn).length], ["dark", vars["--ground"], vars["--cyan-rgb"], Object.keys(vars).length]);
    check("with no glow and no scanlines, and the accent waiting", [worn.glowOff, worn.linesOff, worn.accentClass], [true, true, ""]);
    check("and it is saved", (await lib.apiUntil(async () => { const f = (await api("api/settings.php")).settings.feel; return f.theme === "dark" ? f : null; }) || {}).theme, "dark");
    check("the accent, glow and scanlines choices are kept as they were",
          (({ accent, glow, scanlines }) => [accent, glow, scanlines])((await api("api/settings.php")).settings.feel), ["amber", true, true]);
    const page = await (await fetch(lib.BASE + "/", { headers: { Origin: lib.BASE } })).text();
    check("opened again, the page arrives already wearing it", page.indexOf('<html lang="en" data-theme="dark" style="--ground: ' + vars["--ground"] + ";") !== -1, true);
    // The x that clears the filters: its own red whatever the highlight is, and black under the carbon weave, whose looks are red all over.
    // Its ground, and whether its cross is a light grey or white (the brightness of words is a setting).
    const xMark = `(s => [s.backgroundColor, (c => c.length >= 3 && c[0] === c[1] && c[1] === c[2] && +c[0] >= 150)(s.color.match(/[\\d.]+/g) || [])])(getComputedStyle(document.getElementById("btn-filter-clear")))`;
    check("under Dark the x that clears the filters is a held-back red with a white cross, not the highlight's colour", await b.ev(xMark), ["rgb(176, 72, 72)", true]);
    await b.ev(`import("/js/themes.js").then((m) => m.setTheme("carbon/red"))`);
    await b.until(`document.documentElement.dataset.texture || ""`, "carbon", 6000);
    check("under a Carbon look it is black", await b.ev(xMark), ["rgb(0, 0, 0)", true]);
    // Every other theme that ships: black under Synthwave and Dracula as well, red under the rest.
    const blackUnder = ["neon/synthwave", "dracula/classic", "dracula/blacker"], seen = {}, wanted = {};
    for (const t of got.list.filter((x) => x.id !== "xsegon" && x.id !== "dark" && x.family !== "Carbon")) {
      await b.ev(`import("/js/themes.js").then((m) => m.setTheme(${JSON.stringify(t.id)}))`);
      await b.until(WORN + ".theme", t.id, 6000);
      seen[t.id] = (await b.ev(xMark))[0];
      wanted[t.id] = blackUnder.includes(t.id) ? "rgb(0, 0, 0)" : "rgb(176, 72, 72)";
    }
    check("black under Synthwave and both Dracula looks too, and red under every other theme", seen, wanted);
    check("(those three are among the themes tried)", blackUnder.filter((id) => !(id in seen)), []);
    await b.ev(`import("/js/themes.js").then((m) => m.setTheme("dark"))`);
    await b.until(WORN + ".theme", "dark", 6000);
    await lib.apiUntil(async () => ((await api("api/settings.php")).settings.feel.theme === "dark" ? true : null));

    /* ---- Dark in every view: nothing navy left, and the windows keep their rules */
    const leftNavy = {};
    const look = async (name) => { await b.settled(); const bad = await b.ev(NAVY); if (bad.length) { leftNavy[name] = bad; } };
    await b.goto(lib.BASE + "/", { keepView: false });
    check("a reload keeps Dark", (await b.ev(WORN)).theme, "dark");
    await look("the consoles screen");
    await b.enterConsole(); await look("wheel");
    for (const v of ["list", "grid", "shelf", "carousel", "rows"]) { await b.setView(v); await look(v); }
    await b.setView("list");
    await b.contextMenu("#view .row.sel"); await look("a game's menu"); await b.key("Escape"); await b.settled();
    await b.clickSel("#btn-filter"); await b.waitFor(`!!document.querySelector(".ctx")`, 3000); await look("Filter by"); await b.key("Escape"); await b.settled();
    await b.key(" "); await b.waitFor(`!document.getElementById("details").hidden`, 6000); await look("details");
    await b.key("Escape"); await b.waitFor(`document.getElementById("details").hidden`, 4000);
    await b.key("c");
    await b.waitFor(`document.body.classList.contains("high-contrast")`, 3000);
    check("High contrast pushes Dark, and does not turn it navy", [(await b.ev(WORN)).ground, vars["--hc-ground"] !== vars["--ground"]], [vars["--hc-ground"], true]);
    await look("list, high contrast");
    await b.key("c");
    await b.waitFor(`!document.body.classList.contains("high-contrast")`, 3000);
    await b.openBar("xsegon"); await b.menuItem(/^Settings/);
    await b.waitFor(`!document.getElementById("settings").hidden && !!document.querySelector('#settings [data-key="theme"]')`, 6000);
    await look("Settings");
    check("under Dark no background or edge is still navy, in any view", leftNavy, {});

    /* ---- the way back: the Theme row, where you are standing --------------- */
    const row = `document.querySelector('#settings [data-key="theme"]')`;
    check("Settings > Feel has a Theme row with the same choices", await b.ev(`[...${row}.options].map((o) => o.value + "=" + o.textContent)`), got.list.map((t) => t.id + "=" + t.name));
    check("a family's themes standing under its name", await b.ev(`[...${row}.querySelectorAll("optgroup")].map((g) => g.label + " " + g.children.length)`),
          families.map((f) => f + " " + got.list.filter((t) => t.family === f).length));
    check("standing at Dark", await b.ev(`${row}.value`), "dark");
    await b.ev(`(n => { n.value = "xsegon"; n.dispatchEvent(new Event("change", { bubbles: true })); })(${row})`);
    await b.until(WORN + ".theme", "xsegon", 6000);
    const back = await b.ev(WORN);
    check("choosing Xsegon there brings the house look back while Settings is still open", [back.theme, themed(back), back.ground], ["xsegon", [], "rgb(6, 13, 28)"]);
    check("with the accent, glow and scanlines that were waiting", [back.accentClass, back.accent, back.glowOff, back.linesOff], ["accent-amber", "251, 191, 36", false, false]);
    await b.key("Escape");
    await b.waitFor(`document.getElementById("settings").hidden`, 4000);
    await b.waitQuiet(`!window.__xsLeaving && document.readyState === "complete" && document.getElementById("count").textContent !== ""`, 10000);

    /* ---- a family and its texture: Carbon's folder, Dark red's weave, and off again */
    const wearing = (drawn) => `(() => { const r = document.documentElement, d = r.dataset;
      return { texture: d.texture || "", surface: d.surface || "", corner: d.corner || "", mark: d.mark || "",
               strength: r.style.getPropertyValue("--texture-strength"),
               ground: getComputedStyle(document.body).backgroundImage.indexOf("${drawn}") !== -1,
               art: getComputedStyle(document.querySelector(".backdrop"), "::before").backgroundImage.indexOf("${drawn}") !== -1 }; })()`;
    const NONE = Object.assign({}, BARE, { strength: "", ground: false, art: false });
    check("the house look wears nothing by name", await b.ev(wearing("conic-gradient")), NONE);
    await b.openBar("xsegon");
    await b.menuItem(/^Carbon themes$/);
    check("the Carbon folder opens on its themes, in a box beside its row, the round X's menu still up",
          [await b.ev(`[...document.querySelectorAll(".ctx.ctx-sub .ctx-item")].map((n) => (n.querySelector(".ctx-label") || n).textContent)`),
           await b.ev(`document.querySelector(".ctx-item.has-sub.open .ctx-label").textContent`)],
          [got.list.filter((t) => t.family === "Carbon").map((t) => t.name + " theme"), "Carbon themes"]);
    await b.menuItem(/^Dark red theme$/);
    await b.until(WORN + ".theme", "carbon/red", 6000);
    check("pressing Dark red there lays its weave on the ground and over the dimmed art", await b.ev(wearing("conic-gradient")),
          Object.assign({}, NONE, { texture: "carbon", strength: rv["--texture-strength"], ground: true, art: true }));
    await b.openBar("xsegon");
    check("and the folder wears the mark now", (await b.ev(X_ROWS)).filter((r) => r[1]).map((r) => r[0]), ["Carbon themes"]);
    await b.key("Escape"); await b.settled();
    await b.key("c");
    await b.waitFor(`document.body.classList.contains("high-contrast")`, 3000);
    check("High contrast takes the weave off", (await b.ev(wearing("conic-gradient"))).ground, false);
    await b.key("c");
    await b.waitFor(`!document.body.classList.contains("high-contrast")`, 3000);
    const redPage = await (await fetch(lib.BASE + "/", { headers: { Origin: lib.BASE } })).text();
    check("opened again, the page arrives with the weave named", redPage.indexOf('<html lang="en" data-theme="carbon/red" data-texture="carbon" style="') !== -1, true);

    await b.openBar("xsegon");
    await b.menuItem(/^Dark theme$/);
    await b.until(WORN + ".theme", "dark", 6000);
    check("and going to Dark takes the weave off there and then", await b.ev(wearing("conic-gradient")), NONE);

    /* ---- a mark: Dracula's quilt under the panels and its bat by the wordmark */
    // The bat is a shape cut out of a box after the wordmark; the status button stands after it only while it is there.
    const MARK = `(() => { const cs = getComputedStyle(document.querySelector(".brand"), "::after");
      const gap = document.querySelector(".brand .infobtn").getBoundingClientRect().left - document.querySelector(".brand-logo").getBoundingClientRect().right;
      return { drawn: cs.content !== "none" && /^path\\(/.test(cs.clipPath), wide: parseFloat(cs.width) || 0, room: gap >= 34 }; })()`;
    const NO_MARK = { drawn: false, wide: 0, room: false };
    check("under Dark nothing stands beside the wordmark", await b.ev(MARK), NO_MARK);
    const drac = await api("api/theme.php?id=" + encodeURIComponent("dracula/classic"));
    const dv = drac.theme.vars || {};
    check("Dracula is one of a family of its own, naming a quilt and a bat",
          [got.list.filter((t) => t.family === "Dracula").map((t) => t.id + "=" + t.name), drac.theme.wears],
          [["dracula/classic=Dracula", "dracula/blacker=Dracula blacker"], Object.assign({}, BARE, { texture: "quilt", mark: "bat" })]);
    await b.openBar("xsegon");
    await b.menuItem(/^Dracula themes$/);
    await b.menuItem(/^Dracula theme$/);
    await b.until(WORN + ".theme", "dracula/classic", 6000);
    check("pressing Dracula lays its quilt on the ground and over the dimmed art", await b.ev(wearing("linear-gradient")),
          Object.assign({}, NONE, { texture: "quilt", mark: "bat", strength: dv["--texture-strength"], ground: true, art: true }));
    check("and puts its bat between the wordmark and the status button", await b.ev(MARK), { drawn: true, wide: 34, room: true });
    await b.key("c");
    await b.waitFor(`document.body.classList.contains("high-contrast")`, 3000);
    check("High contrast takes the quilt off and leaves the bat", [(await b.ev(wearing("linear-gradient"))).ground, (await b.ev(MARK)).drawn], [false, true]);
    await b.key("c");
    await b.waitFor(`!document.body.classList.contains("high-contrast")`, 3000);
    const dracPage = await (await fetch(lib.BASE + "/", { headers: { Origin: lib.BASE } })).text();
    check("opened again, the page arrives with the quilt and the bat named",
          dracPage.indexOf('<html lang="en" data-theme="dracula/classic" data-texture="quilt" data-mark="bat" style="') !== -1, true);
    await b.openBar("xsegon");
    await b.menuItem(/^Dark theme$/);
    await b.until(WORN + ".theme", "dark", 6000);
    check("and going to Dark takes the quilt and the bat away", [await b.ev(wearing("linear-gradient")), await b.ev(MARK)], [NONE, NO_MARK]);

    /* ---- Synthwave's floor, and Matrix's rain: the one texture a script draws */
    /* The rain is a canvas js\rain.js puts between the art and the panels. It
       falls by itself, which only it and the snow do, and rests with
       Animations off and under High contrast; the canvas says "falling"
       while it falls, which is what is watched. Matrix's panels are thinner
       too (sheer), so the rain is seen through them. */
    const RAIN = `(() => { const c = document.querySelector("canvas.rain"); if (!c) { return { there: false }; }
      const cs = getComputedStyle(c), px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let ink = 0; for (let i = 3; i < px.length; i += 4) { if (px[i]) { ink++; } }
      return { there: true, shown: cs.display !== "none", fixed: cs.position === "fixed",
               under: +cs.zIndex < +getComputedStyle(document.querySelector(".wrap")).zIndex, drawn: ink > 500, falling: c.dataset.falling === "1" }; })()`;
    const RAIN_PIC = `(() => { const u = document.querySelector("canvas.rain").toDataURL(); let x = 0;
      for (let i = 0; i < u.length; i += 7) { x = (x * 31 + u.charCodeAt(i)) | 0; } return u.length + ":" + x; })()`;
    const FALLING = `(document.querySelector("canvas.rain") || { dataset: {} }).dataset.falling === "1"`;
    // How solid the list and a game's details are: the last number of their background, 1 when it has none.
    const THICK = `[".list", ".details"].map((sel) => { const p = (/rgba?\\(([^)]+)\\)/.exec(getComputedStyle(document.querySelector(sel)).backgroundColor) || ["", ""])[1].split(",");
      return p.length === 4 ? +p[3] : 1; })`;
    const syn = await api("api/theme.php?id=" + encodeURIComponent("neon/synthwave"));
    const mat = await api("api/theme.php?id=" + encodeURIComponent("neon/matrix"));
    check("Synthwave names a horizon, Matrix the rain and sheer panels, the two standing together under Neon",
          [syn.theme.wears, mat.theme.wears, got.list.filter((t) => t.id === "neon/synthwave" || t.id === "neon/matrix").map((t) => t.name + "/" + t.family).sort()],
          [Object.assign({}, BARE, { texture: "horizon" }), Object.assign({}, BARE, { texture: "rain", surface: "sheer" }), ["Matrix/Neon", "Synthwave/Neon"]]);
    await b.openBar("xsegon");
    await b.menuItem(/^Neon themes$/);
    await b.menuItem(/^Synthwave theme$/);
    await b.until(WORN + ".theme", "neon/synthwave", 6000);
    check("pressing Synthwave lays its floor and horizon on the ground and over the dimmed art", await b.ev(wearing("radial-gradient")),
          Object.assign({}, NONE, { texture: "horizon", strength: (syn.theme.vars || {})["--texture-strength"], ground: true, art: true }));
    check("with no rain on the page, and the panels as thick as the house's", [await b.ev(RAIN), await b.ev(THICK)], [{ there: false }, [0.82, 0.82]]);
    await b.openBar("xsegon");
    await b.menuItem(/^Neon themes$/);
    await b.menuItem(/^Matrix theme$/);
    await b.until(WORN + ".theme", "neon/matrix", 6000);
    await b.waitFor(FALLING, 4000);
    check("pressing Matrix puts its rain up between the art and the panels, drawn and falling", await b.ev(RAIN),
          { there: true, shown: true, fixed: true, under: true, drawn: true, falling: true });
    check("as strong as the theme says", await b.ev(`getComputedStyle(document.querySelector("canvas.rain")).opacity`), String(+(mat.theme.vars || {})["--texture-strength"] / 100));
    check("over a ground darkened and dotted for it", await b.ev(wearing("radial-gradient")),
          Object.assign({}, NONE, { texture: "rain", surface: "sheer", strength: (mat.theme.vars || {})["--texture-strength"], ground: true, art: true }));
    check("and thins the panels so it is seen through them: the list by half, a game's details less", await b.ev(THICK), [0.5, 0.7]);
    const first = await b.ev(RAIN_PIC);
    check("it falls by itself, with nobody moving", await b.waitFor(`${RAIN_PIC} !== ${JSON.stringify(first)}`, 4000), true);
    await b.ev(`document.body.classList.add("no-anim"), true`);
    await b.waitFor(`!(${FALLING})`, 3000);
    const still = await b.ev(RAIN_PIC);
    await b.settled();
    check("with Animations off it rests where it stands", [await b.ev(FALLING), (await b.ev(RAIN_PIC)) === still], [false, true]);
    await b.ev(`document.body.classList.remove("no-anim"), true`);
    check("and falls again by itself when they are switched back on", await b.waitFor(FALLING, 3000), true);
    await b.key("c");
    await b.waitFor(`document.body.classList.contains("high-contrast")`, 3000);
    await b.waitFor(`!(${FALLING})`, 3000);
    check("High contrast takes the rain off, stops it, and makes the panels solid", [(({ shown, falling }) => [shown, falling])(await b.ev(RAIN)), await b.ev(THICK)], [[false, false], [1, 1]]);
    await b.key("c");
    await b.waitFor(`!document.body.classList.contains("high-contrast")`, 3000);
    check("and it falls again when High contrast goes", await b.waitFor(FALLING, 3000), true);
    // Where games are read, a shade of black stands between the rain and them: four places and no other.
    // How dark the shade is belongs to the stylesheet (--rain-shade): what is checked is that these places wear that one.
    const SHADED = (sel, prop, pseudo) => `(() => { const n = document.querySelector(${JSON.stringify(sel)});
      const a = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rain-shade"));
      return !!n && a > 0 && getComputedStyle(n, ${JSON.stringify(pseudo || null)})[${JSON.stringify(prop)}].indexOf("rgba(0, 0, 0, " + a + ")") !== -1; })()`;
    check("a shade of black stands between the rain and the list, and not behind the info panel",
          [await b.ev(SHADED(".list", "backgroundImage")), await b.ev(SHADED(".hero", "backgroundImage")), await b.ev(SHADED(".hero", "backgroundColor"))], [true, false, false]);
    await b.setView("grid");
    check("behind the grid", await b.ev(SHADED(".main .grid", "backgroundColor")), true);
    await b.setView("carousel");
    // Carousel is the consoles' gallery or the games' own, whichever is up: both wear the band.
    check("in the band the carousel turns in", await b.ev(SHADED("#syswall:not([hidden]), .gcarousel", "backgroundColor", "::before")), true);
    await b.setView("rows");
    await b.waitFor(`!!document.querySelector(".rows-list")`, 4000);
    check("and behind the rows, not behind the chosen game above them",
          [await b.ev(SHADED(".rows-list", "backgroundColor")), await b.ev(SHADED(".rows-band", "backgroundColor"))], [true, false]);
    await b.setView("list");
    const rainPage = await (await fetch(lib.BASE + "/", { headers: { Origin: lib.BASE } })).text();
    check("opened again, the page arrives with the rain and the sheer panels named",
          rainPage.indexOf('<html lang="en" data-theme="neon/matrix" data-texture="rain" data-surface="sheer" style="') !== -1, true);
    await b.openBar("xsegon");
    await b.menuItem(/^Dark theme$/);
    await b.until(WORN + ".theme", "dark", 6000);
    check("and going to Dark takes the rain down, the shade off, and thickens the panels again",
          [await b.ev(RAIN), await b.ev(wearing("radial-gradient")), await b.ev(THICK), await b.ev(SHADED(".list", "backgroundImage"))], [{ there: false }, NONE, [0.82, 0.82], false]);

    /* ---- Winter: snow falling behind panes of glass with round corners ------- */
    /* The snow is a canvas js\snow.js puts where the rain's goes, resting when
       the rain does. The panels are panes (gloss) and the corners round. How
       thin, how white and how round belong to the stylesheet: what is checked
       is that the page wears its numbers. */
    const SNOW = RAIN.replace("canvas.rain", "canvas.snow"), SNOW_PIC = RAIN_PIC.replace("canvas.rain", "canvas.snow"), SNOWING = FALLING.replace("canvas.rain", "canvas.snow");
    const PANE = `(() => { const pane = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gloss-pane"));
      const of = (sel) => { const cs = getComputedStyle(document.querySelector(sel)); const p = (/rgba?\\(([^)]+)\\)/.exec(cs.backgroundColor) || ["", ""])[1].split(",");
        return { thick: p.length === 4 ? +p[3] : 1, light: cs.backgroundImage.indexOf("linear-gradient(rgba(255, 255, 255") === 0 }; };
      const list = of(".list"), hero = of(".hero"), top = of("header.top"), foot = of(".help");
      return { pane: pane > 0 && pane < 0.82, list: list.thick === pane && list.light, hero: hero.thick === pane && hero.light,
               bars: top.light && foot.light, footSolid: foot.thick > 0.8 }; })()`;
    const CORNERS = `(() => { const cs = getComputedStyle(document.querySelector(".list")), r = getComputedStyle(document.documentElement);
      return { round: cs.borderTopLeftRadius !== "0px" && cs.borderTopLeftRadius === r.getPropertyValue("--round").trim(), cut: cs.clipPath !== "none",
               button: getComputedStyle(document.getElementById("btn-settings")).borderTopLeftRadius === r.getPropertyValue("--round-small").trim() }; })()`;
    const HELP_LIGHT = `getComputedStyle(document.querySelector(".help")).backgroundImage`;
    const win = await api("api/theme.php?id=" + encodeURIComponent("nature/winter"));
    const WINTER = Object.assign({}, BARE, { texture: "snow", surface: "gloss", corner: "round" });
    check("Winter names the snow, panes of glass and round corners, and is one of the Nature family",
          [win.theme.wears, got.list.some((t) => t.id === "nature/winter" && t.name === "Winter" && t.family === "Nature")], [WINTER, true]);
    check("under Dark the corners are the house's cut ones", (({ round, cut }) => [round, cut])(await b.ev(CORNERS)), [false, true]);
    await b.openBar("xsegon");
    await b.menuItem(/^Nature themes$/);
    await b.menuItem(/^Winter theme$/);
    await b.until(WORN + ".theme", "nature/winter", 6000);
    await b.waitFor(SNOWING, 4000);
    check("pressing Winter puts its snow up between the art and the panels, drawn and falling, with no rain", [await b.ev(SNOW), await b.ev(RAIN)],
          [{ there: true, shown: true, fixed: true, under: true, drawn: true, falling: true }, { there: false }]);
    check("as strong as the theme says", await b.ev(`getComputedStyle(document.querySelector("canvas.snow")).opacity`), String(+(win.theme.vars || {})["--texture-strength"] / 100));
    const firstSnow = await b.ev(SNOW_PIC);
    check("it falls by itself, with nobody moving", await b.waitFor(`${SNOW_PIC} !== ${JSON.stringify(firstSnow)}`, 4000), true);
    await b.ev(`document.body.classList.add("no-anim"), true`);
    await b.waitFor(`!(${SNOWING})`, 3000);
    const stillSnow = await b.ev(SNOW_PIC);
    await b.settled();
    check("with Animations off it rests where it stands", [await b.ev(SNOWING), (await b.ev(SNOW_PIC)) === stillSnow], [false, true]);
    await b.ev(`document.body.classList.remove("no-anim"), true`);
    check("and falls again by itself when they are switched back on", await b.waitFor(SNOWING, 3000), true);
    check("its panels are panes a little thinner than the house's with a light at the top, and the bars get the light and stay solid", await b.ev(PANE),
          { pane: true, list: true, hero: true, bars: true, footSolid: true });
    check("its corners are round in place of the cut, the panels by one number and the buttons by a smaller", await b.ev(CORNERS), { round: true, cut: false, button: true });
    check("the art behind is turned down for it", await b.ev(`(() => { const i = document.querySelector(".backdrop img.on"); return !i || +getComputedStyle(i).opacity < 0.38; })()`), true);
    await b.key("c");
    await b.waitFor(`document.body.classList.contains("high-contrast")`, 3000);
    await b.waitFor(`!(${SNOWING})`, 3000);
    check("High contrast takes the snow and the light off, stops it and makes the panels solid, and the corners stay round",
          [(({ shown, falling }) => [shown, falling])(await b.ev(SNOW)), await b.ev(THICK), await b.ev(HELP_LIGHT), (await b.ev(CORNERS)).round], [[false, false], [1, 1], "none", true]);
    await b.key("c");
    await b.waitFor(`!document.body.classList.contains("high-contrast")`, 3000);
    check("and it falls again when High contrast goes", await b.waitFor(SNOWING, 3000), true);
    const winPage = await (await fetch(lib.BASE + "/", { headers: { Origin: lib.BASE } })).text();
    check("opened again, the page arrives with the snow, the panes and the round corners named",
          winPage.indexOf('<html lang="en" data-theme="nature/winter" data-texture="snow" data-surface="gloss" data-corner="round" style="') !== -1, true);
    await b.openBar("xsegon");
    await b.menuItem(/^Dark theme$/);
    await b.until(WORN + ".theme", "dark", 6000);
    check("and going to Dark takes the snow down and the light off, thickens the panels and cuts the corners again",
          [await b.ev(SNOW), await b.ev(THICK), await b.ev(HELP_LIGHT), (({ round, cut }) => [round, cut])(await b.ev(CORNERS))], [{ there: false }, [0.82, 0.82], "none", [false, true]]);
    await api("api/settings.php", { feel: { theme: "nature/winter" } });
    await b.goto();
    await b.waitFor(SNOWING, 6000);
    check("a page opened on Winter has its snow up and falling with no press", (({ there, shown, drawn, falling }) => [there, shown, drawn, falling])(await b.ev(SNOW)), [true, true, true, true]);

    await api("api/settings.php", { feel: { theme: "neon/matrix" } });
    await b.goto();
    await b.waitFor(FALLING, 6000);
    check("a page opened on Matrix has its rain up and falling with no press", (({ there, shown, drawn, falling }) => [there, shown, drawn, falling])(await b.ev(RAIN)), [true, true, true, true]);
    /* ---- what else moves: a floor, stars, bubbles, a storm, embers and bats -- */
    /* js\motion.js draws them on a canvas behind the panels, and the bats on
       one in front of the games and under the bars. A canvas says "moving"
       while its clock runs. High contrast is put on here as the body's class,
       which is all the canvas and its clock read. */
    const MOTION = (where, least) => `(() => { const c = document.querySelector("canvas.motion.${where}"); if (!c) { return { there: false }; }
      const cs = getComputedStyle(c), px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let ink = 0; for (let i = 3; i < px.length; i += 4) { if (px[i]) { ink++; } }
      return { there: true, shown: cs.display !== "none", overGames: +cs.zIndex > +getComputedStyle(document.querySelector(".wrap")).zIndex,
               underBars: +cs.zIndex < +getComputedStyle(document.querySelector(".help")).zIndex,
               asTexture: c.classList.contains("as-texture"), drawn: ink > ${least}, moving: c.dataset.moving === "1" }; })()`;
    const MOVING = (where) => `(document.querySelector("canvas.motion.${where}") || { dataset: {} }).dataset.moving === "1"`;
    const MOTION_PIC = (where) => RAIN_PIC.replace("canvas.rain", "canvas.motion." + where);
    const BEHIND = { there: true, shown: true, overGames: false, underBars: true, asTexture: true, drawn: true, moving: true };
    const wearNow = async (id) => { await b.ev(`import("/js/themes.js").then((m) => m.setTheme(${JSON.stringify(id)}))`); await b.until(WORN + ".theme", id, 6000); };
    const kinOf = (f) => got.list.filter((t) => t.family === f).map((t) => t.id + "=" + t.name);
    check("Space is a family of two, one with trees", kinOf("Space"), ["space/stars=Space", "space/trees=Space with trees"]);
    check("Nature holds Deep sea, Storm and Winter, and Neon holds Matrix and Synthwave", [kinOf("Nature"), kinOf("Neon")],
          [["nature/deep-sea=Deep sea", "nature/storm=Storm", "nature/winter=Winter"], ["neon/matrix=Matrix", "neon/synthwave=Synthwave"]]);
    for (const [id, texture] of [["space/stars", "stars"], ["space/trees", "stars-trees"], ["nature/deep-sea", "bubbles"], ["nature/storm", "storm"]]) {
      await wearNow(id);
      await b.waitFor(MOVING("behind"), 4000);
      const firstPic = await b.ev(MOTION_PIC("behind"));
      check("the theme " + id + " names " + texture + " and sheer panels, and its canvas is up behind the panels, drawn and moving by itself, with none in front",
            [(await api("api/theme.php?id=" + encodeURIComponent(id))).theme.wears, await b.ev(MOTION("behind", 500)), await b.ev(MOTION("front", 0)),
             await b.waitFor(`${MOTION_PIC("behind")} !== ${JSON.stringify(firstPic)}`, 4000)],
            [Object.assign({}, BARE, { texture, surface: "sheer" }), BEHIND, { there: false }, true]);
    }
    await wearNow("neon/synthwave");
    await b.waitFor(MOVING("behind"), 4000);
    const FLOOR = `[document.documentElement.dataset.floor || "", getComputedStyle(document.documentElement).getPropertyValue("--horizon-bars").trim()]`;
    check("under Synthwave the floor's lines across are the canvas's, and the stylesheet leaves its own out", [await b.ev(FLOOR), await b.ev(MOTION("behind", 500))], [["rolls", "none"], BEHIND]);
    const firstFloor = await b.ev(MOTION_PIC("behind"));
    check("the floor rolls by itself", await b.waitFor(`${MOTION_PIC("behind")} !== ${JSON.stringify(firstFloor)}`, 4000), true);
    await b.ev(`document.body.classList.add("no-anim"), true`);
    await b.waitFor(`!(${MOVING("behind")})`, 3000);
    const stillFloor = await b.ev(MOTION_PIC("behind"));
    await b.settled();
    check("with Animations off it rests where it stands", [await b.ev(MOVING("behind")), (await b.ev(MOTION_PIC("behind"))) === stillFloor], [false, true]);
    await b.ev(`document.body.classList.remove("no-anim"), true`);
    check("and rolls again by itself when they are switched back on", await b.waitFor(MOVING("behind"), 3000), true);
    await b.ev(`document.body.classList.add("high-contrast"), true`);
    await b.waitFor(`!(${MOVING("behind")})`, 3000);
    check("High contrast takes the canvas off and stops it", (({ shown, moving }) => [shown, moving])(await b.ev(MOTION("behind", 500))), [false, false]);
    await b.ev(`document.body.classList.remove("high-contrast"), true`);
    check("and it moves again when High contrast goes", await b.waitFor(MOVING("behind"), 3000), true);
    await wearNow("carbon/red");
    await b.waitFor(MOVING("behind"), 4000);
    check("a Carbon look has its embers behind the panels, not weakened with the weave, and the floor's word is gone",
          [await b.ev(MOTION("behind", 40)), await b.ev(MOTION("front", 0)), (await b.ev(FLOOR))[0]], [Object.assign({}, BEHIND, { asTexture: false }), { there: false }, ""]);
    await wearNow("dracula/classic");
    await b.waitFor(MOVING("front"), 4000);
    await b.ev(`import("/js/motion-bats.js").then((m) => m.batSend())`);
    check("under Dracula a bat crosses in front of the games and under the bars, on a canvas of its own",
          [await b.waitFor(`(${MOTION("front", 200)}).drawn`, 9000), (({ there, shown, overGames, underBars, asTexture, moving }) => [there, shown, overGames, underBars, asTexture, moving])(await b.ev(MOTION("front", 200))),
           await b.ev(MOTION("behind", 0))],
          [true, [true, true, true, true, false, true], { there: false }]);
    await b.ev(`document.body.classList.add("no-anim"), true`);
    await b.waitFor(`!(${MOVING("front")})`, 3000);
    check("with Animations off no bat is left hanging in the air", (({ drawn, moving }) => [drawn, moving])(await b.ev(MOTION("front", 0))), [false, false]);
    await b.ev(`document.body.classList.remove("no-anim"), true`);
    await wearNow("dark");
    check("and going to Dark takes every one of them down", await b.ev(`[document.querySelectorAll("canvas.motion").length, document.documentElement.dataset.floor || ""]`), [0, ""]);
    await api("api/settings.php", { feel: { theme: "xsegon" } });

    /* ---- a theme saved under the name it had before it moved into a folder -- */
    const fileNow = path.join(lib.DATA, "settings.json");
    const savedOld = JSON.parse(fs.readFileSync(fileNow, "utf8"));
    savedOld.feel = Object.assign({}, savedOld.feel, { theme: "winter" });
    fs.writeFileSync(fileNow, JSON.stringify(savedOld, null, 2));
    const movedPage = await (await fetch(lib.BASE + "/", { headers: { Origin: lib.BASE } })).text();
    check("a copy that saved Winter before it moved under Nature still opens on Winter",
          [(await api("api/settings.php")).settings.feel.theme, movedPage.indexOf('<html lang="en" data-theme="nature/winter" ') !== -1], ["nature/winter", true]);

    /* ---- a theme that has gone: the house look, and it says so in the log -- */
    const file = path.join(lib.DATA, "settings.json");
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    stored.feel = Object.assign({}, stored.feel, { theme: "gone" });
    fs.writeFileSync(file, JSON.stringify(stored, null, 2));
    await b.goto();
    const gone = await b.ev(WORN);
    check("a saved theme whose file has gone opens as the house look", [gone.theme, themed(gone), gone.ground], ["xsegon", [], "rgb(6, 13, 28)"]);
    const day = await api("api/log.php?tail=300");
    check("and the log says which theme, and why", /theme gone is not used, the Xsegon look is shown/.test(JSON.stringify(day)), true);
    await api("api/settings.php", { feel: { theme: "xsegon" } });
  } finally {
    await api("api/settings.php", keep);
  }
};
