// What came in the box: a game's documents, the side of its box on the Shelf
// view, and its cartridge or disc in details.
// The test copy leaves the documents and extras folders out (tests\sandbox.js);
// this group makes its own (a tiny PDF, flat-colour pictures) for three games.
// On a data folder that already has them (--live) it steps aside: its files
// would stand in place of real ones.
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const lib = require("./lib");
const { api } = lib;

// A PNG of one colour, w by h, made here so the group needs no picture file.
function png(w, h, rgb) {
  const table = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) { c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; } table[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xFFFFFFFF; for (const x of buf) { c = table[(c ^ x) & 255] ^ (c >>> 8); } return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3)]);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PDF = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
            "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";

module.exports = async function (b, check) {
  const DATA = lib.DATA, BASE = lib.BASE;
  const docsDir = path.join(DATA, "documents"), extrasDir = path.join(DATA, "extras");
  if (fs.existsSync(docsDir) || fs.existsSync(extrasDir)) {
    console.log("    (this data folder already holds documents or extras; the group only runs on a copy without them, and steps aside)");
    return;
  }

  // Three games of the console with the most, one file each (not a card of versions).
  const all = (await api("api/library.php")).games || [];
  const count = {};
  for (const g of all) { if (!g.versions) { count[g.platform] = (count[g.platform] || 0) + 1; } }
  const platform = Object.keys(count).sort((a, c) => count[c] - count[a])[0];
  const shelf = ((await api("api/library.php?platform=" + encodeURIComponent(platform))).games || []);
  const [g1, g2, g3] = shelf.filter((g) => !g.versions);
  if (!g3) { check("three games on one console to test with", false, true); return; }

  const put = (rel, bytes) => { const p = path.join(DATA, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, bytes); };
  try {
    put("extras/spine/" + g1.id + ".png", png(20, 200, [200, 40, 40]));     // stands upright
    put("extras/spine/" + g2.id + ".png", png(200, 24, [40, 80, 200]));     // lies on its side
    put("extras/cart/" + g1.id + ".png", png(60, 40, [120, 120, 120]));
    put("extras/disc/" + g2.id + ".png", png(50, 50, [20, 20, 20]));
    put("documents/" + g1.id + "/Manual.pdf", PDF);
    put("documents/" + g1.id + "/Map 10.png", png(40, 30, [40, 160, 80]));
    put("documents/" + g1.id + "/Map 2.png", png(1600, 900, [230, 210, 150]));
    put("documents/" + g1.id + "/notes.txt", "not a document Xsegon opens");

    // ---- what the server says ----------------------------------------------
    const rows = ((await api("api/library.php?platform=" + encodeURIComponent(platform))).games || []);
    const r1 = rows.find((g) => g.id === g1.id), r2 = rows.find((g) => g.id === g2.id), r3 = rows.find((g) => g.id === g3.id);
    check("a game's row carries the side of its box, with its size", [r1.spine && r1.spine.w, r1.spine && r1.spine.h, /^files\/extras\/spine\//.test((r1.spine || {}).url || "")], [20, 200, true]);
    check("and its cartridge or its disc, said which", [(r1.medium || {}).kind, (r2.medium || {}).kind], ["cart", "disc"]);
    check("a game with neither says so", [r3.spine, r3.medium], [null, null]);
    check("and whether it has documents", [r1.docs, r2.docs], [true, false]);
    const full = (await api("api/game.php?id=" + encodeURIComponent(g1.id))).game;
    check("its documents: the manual first, the rest as a person counts, a text file left out",
      (full.documents || []).map((d) => d.label + ":" + d.kind), ["Manual:pdf", "Map 2:image", "Map 10:image"]);
    check("a game with none has an empty list", ((await api("api/game.php?id=" + encodeURIComponent(g2.id))).game.documents || []).length, 0);

    // ---- the file door -----------------------------------------------------
    const get = (rel, headers) => fetch(BASE + "/" + rel, { headers: headers || {} });
    const spineGot = await get(r1.spine.url);
    check("the door serves a spine", [spineGot.status, (spineGot.headers.get("content-type") || "").split(";")[0]], [200, "image/png"]);
    const pdfGot = await get(full.documents[0].url, { Range: "bytes=0-7" });
    check("and a manual, as a PDF, in pieces when asked", [pdfGot.status, (pdfGot.headers.get("content-type") || "").split(";")[0], await pdfGot.text()], [206, "application/pdf", "%PDF-1.4"]);
    put("thumbs-test.pdf", PDF);
    for (const bad of ["files/extras/spine/" + g1.id + ".pdf", "files/extras/index.json", "files/documents/" + g1.id + "/notes.txt",
                       "files/documents/" + g1.id + "/..%2F..%2Fsettings.json", "files/documents/..%2Fthumbs-test.pdf", "files/extras/..%2Fsettings.json"]) {
      check("the door refuses " + bad.replace(g1.id, "<id>"), (await get(bad)).status, 404);
    }
    fs.rmSync(path.join(DATA, "thumbs-test.pdf"), { force: true });

    // ---- the Shelf view ----------------------------------------------------
    await b.goto();
    await b.setView("shelf");               // on the consoles screen: opens every game in it
    await b.waitFor(`document.getElementById("view").classList.contains("shelf") && document.querySelectorAll("#view .spine").length > 0`, 10000);
    await b.ev(`(() => { const p = document.getElementById("platform"); p.value = ${JSON.stringify(platform)}; p.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    check("the shelf holds a spine for every game of the console", await b.until(`document.querySelectorAll("#view .spine").length`, rows.length, 8000), rows.length);
    await b.settled();
    check("the dropdown names it, and the settings know it",
      [await b.ev(`document.getElementById("viewsel").value`), Object.keys((await api("api/settings.php")).schema.view.default.options).includes("shelf")], ["shelf", true]);
    check("the shelf shows the menu bar, like the grid", await b.ev(`document.getElementById("toolbar").classList.contains("as-menubar")`));
    check("and the info panel beside it", await b.ev(`!document.getElementById("hero").hidden`));
    const node = (id) => `document.querySelector('#view .spine[data-id="${id}"]')`;
    const shape = (id) => `(n => { const i = n.querySelector("img"), r = n.getBoundingClientRect(), ir = i ? i.getBoundingClientRect() : null;
      return { made: n.classList.contains("made"), lying: !!i && i.classList.contains("lying"), ratio: Math.round(r.width / r.height * 100) / 100,
               inside: !ir || (ir.height > ir.width && Math.abs(ir.left - r.left) < 12 && Math.abs(ir.width - r.width) < 12 && Math.abs(ir.height - r.height) < 24),
               name: (n.querySelector(".spine-name") || {}).textContent || "" }; })(${node(id)})`;
    await b.waitFor(`[...document.querySelectorAll("#view .spine img")].every(i => i.complete)`, 6000);
    const s1 = await b.ev(shape(g1.id)), s2 = await b.ev(shape(g2.id)), s3 = await b.ev(shape(g3.id));
    check("an upright spine stands as it is, as wide as its box is thick", [s1.made, s1.lying, s1.ratio, s1.inside], [false, false, 0.1, true]);
    check("one that lies on its side is stood up, and fills its place", [s2.made, s2.lying, s2.ratio, s2.inside], [false, true, 0.12, true]);
    check("a game with no picture of its box's side gets a spine made, wearing its name", [s3.made, s3.name.indexOf(g3.title) === 0], [true, true]);
    check("every spine is the same height", await b.ev(`new Set([...document.querySelectorAll("#view .spine")].map(n => n.offsetHeight)).size`), 1);

    const selAt = `[...document.querySelectorAll("#view .spine")].findIndex(n => n.classList.contains("sel"))`;
    check("the first game is the chosen one, as in every view", await b.until(selAt, 0), 0);   // a click on it would open details
    await b.key("ArrowRight");
    check("right moves along the shelf", await b.until(selAt, 1), 1);
    await b.key("ArrowLeft");
    check("and left back", await b.until(selAt, 0), 0);
    const rowsDeep = await b.ev(`new Set([...document.querySelectorAll("#view .spine")].map(n => n.offsetTop)).size`);
    if (rowsDeep > 1) {
      await b.key("ArrowDown");
      check("down goes to the shelf below", await b.until(`(s => !!s && s.offsetTop > document.querySelector("#view .spine").offsetTop)(document.querySelector("#view .spine.sel"))`, true), true);
      await b.key("ArrowUp");
      check("and up comes back to the one above", await b.until(`(s => !!s && s.offsetTop === document.querySelector("#view .spine").offsetTop)(document.querySelector("#view .spine.sel"))`, true), true);
    } else {
      console.log("    (the console's games fit on one shelf here; up and down step aside)");
    }
    check("the legend says all four ways", await b.ev(`[...document.querySelectorAll("#help .hk")].some(n => n.textContent === "↑↓←→")`), true);
    check("the page does not scroll: the shelf scrolls in its own box", await b.ev(`document.documentElement.scrollHeight <= innerHeight`));

    // ---- details: the box's side, laid down, and the cartridge -------------
    await b.ev(`${node(g1.id)}.click()`);
    await b.until(`${node(g1.id)}.classList.contains("sel")`, true);
    await b.settled();
    await b.key(" ");
    check("details opens from the shelf", await b.until(`!document.getElementById("details").hidden && !!document.querySelector("#details .dkit")`, true, 6000), true);
    check("showing the side of the box laid down, inside its strip", await b.until(`(() => { const s = document.querySelector("#details .dspine"), i = s && s.querySelector("img");
      if (!i || !i.complete) { return false; } const r = s.getBoundingClientRect(), ir = i.getBoundingClientRect();
      return i.classList.contains("upright") && ir.width > ir.height * 3 && Math.abs(ir.left - r.left) < 4 && Math.abs(ir.width - r.width) < 6 && Math.abs(ir.top - r.top) < 4; })()`, true), true);
    check("and the cartridge", await b.ev(`(m => !!m && m.classList.contains("is-cart"))(document.querySelector("#details .dmedium"))`));
    check("both under the name and the facts", await b.ev(`(() => { const k = document.querySelector("#details .dkit");
      return ["h2", "dl"].every(s => !!(document.querySelector("#details .dleft " + s).compareDocumentPosition(k) & Node.DOCUMENT_POSITION_FOLLOWING)); })()`), true);
    check("the button names how many documents there are", await b.until(`(d => d ? d.textContent : "")(document.querySelector("#details .docbtn"))`, "Documents (3)", 6000), "Documents (3)");
    check("and the legend offers them", await b.ev(`/documents/.test(document.getElementById("help").textContent)`));

    // ---- the documents panel -----------------------------------------------
    await b.key("d");
    check("D opens the documents", await b.until(`!document.getElementById("editor").hidden && document.querySelectorAll(".doc-tab").length`, 3, 6000), 3);
    check("a tab for each, the manual first and chosen", await b.ev(`[[...document.querySelectorAll(".doc-tab")].map(t => t.textContent).join("|"), (document.querySelector(".doc-tab.on") || {}).textContent]`), ["Manual|Map 2|Map 10", "Manual"]);
    // The booklet itself is the reader group's (tests\t-reader.js); here, that a manual opens in it.
    check("the manual opens as a booklet, a page of one", await b.until(`(s => s.dataset.mode + " " + s.dataset.pages)(document.querySelector(".doc-stage"))`, "book 1", 15000), "book 1");
    await b.key("ArrowDown");
    check("down goes to the next document, a picture", await b.until(`[(document.querySelector(".doc-tab.on") || {}).textContent, (i => !!i && i.complete && i.naturalWidth)(document.querySelector(".doc-pic"))]`, ["Map 2", 1600], 6000), ["Map 2", 1600]);
    check("fitted to the panel", await b.ev(`(() => { const s = document.querySelector(".doc-stage"), i = s.querySelector("img"); return i.offsetWidth <= s.clientWidth && i.offsetHeight <= s.clientHeight && !s.classList.contains("zoomed"); })()`));
    const roomy = await b.ev(`document.querySelector(".doc-stage").clientWidth < 1600`);
    await b.key("Enter");
    check("Enter shows it at its full size", await b.until(`(() => { const s = document.querySelector(".doc-stage"), i = s.querySelector("img"); return s.classList.contains("zoomed") && i.offsetWidth === 1600; })()`, true), true);
    if (roomy) { check("opened on its middle", await b.ev(`document.querySelector(".doc-stage").scrollLeft > 0`)); }
    await b.key("Enter");
    check("and again fits it back", await b.until(`document.querySelector(".doc-stage").classList.contains("zoomed")`, false), false);
    await b.key("ArrowRight"); await b.key("ArrowRight");
    check("the last one is the end", await b.until(`(document.querySelector(".doc-tab.on") || {}).textContent`, "Map 10"), "Map 10");
    await b.ev(`document.querySelector(".doc-tab").click()`);
    check("a tab can be clicked", await b.until(`(document.querySelector(".doc-tab.on") || {}).textContent`, "Manual"), "Manual");
    await b.key("Escape");
    check("Esc goes back to details, not past it", await b.until(`[document.getElementById("editor").hidden, document.getElementById("details").hidden]`, [true, false]), [true, false]);
    await b.key("Escape");
    await b.until(`document.getElementById("details").hidden`, true);
    await b.settled();

    // ---- from the shelf itself ---------------------------------------------
    await b.contextMenu(`#view .spine[data-id="${g1.id}"]`);
    check("the game's menu offers Documents", await b.ev(`[...document.querySelectorAll(".ctx .ctx-label")].some(n => n.textContent === "Documents...")`), true);
    await b.menuItem(/^Documents/);
    check("and it opens them", await b.until(`!document.getElementById("editor").hidden && document.querySelectorAll(".doc-tab").length`, 3, 6000), 3);
    await b.key("Escape");
    await b.until(`document.getElementById("editor").hidden`, true);
    await b.contextMenu(`#view .spine[data-id="${g2.id}"]`);
    check("a game with none is not offered them", await b.ev(`[...document.querySelectorAll(".ctx .ctx-label")].some(n => n.textContent === "Documents...")`), false);
    await b.key("Escape");
    await b.until(`!document.querySelector(".ctx")`, true);
    await b.key(" ");
    await b.until(`!document.getElementById("details").hidden`, true);
    check("nor does its details show a button, though its disc is there", await b.ev(`[!!document.querySelector("#details .docbtn"), (m => !!m && m.classList.contains("is-disc"))(document.querySelector("#details .dmedium")), /documents/.test(document.getElementById("help").textContent)]`), [false, true, false]);
    await b.key("Escape");
    await b.until(`document.getElementById("details").hidden`, true);

    // ---- the shelf under the pointer, and its size -------------------------
    /* A game sounds the Hover as the pointer passes onto it (js\sound.js): plays
       are counted, and the pointer is moved for real, since only a pointer that
       changed place counts. The Shelf falls back to the set's Move; other views do not. */
    const moveTo = (x, y) => b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
    check("the settings know the switch for it",
      (({ settings, schema }) => [typeof settings.sound.hoverSound, !!schema.sound.hoverSound])(await api("api/settings.php")), ["boolean", true]);
    check("and the limit on it: a slider from 1 a second to 30, which is no limit",
      (({ schema, defaults }) => [schema.sound.hoverRate.type, schema.sound.hoverRate.min, schema.sound.hoverRate.max, schema.sound.hoverRate.top, defaults.sound.hoverRate])(await api("api/settings.php")),
      ["range", 1, 30, "no limit", 9]);
    if (await b.ev(`(s => s.sounds !== false && s.volume > 0 && localStorage.getItem("xs-muted") !== "1")(window.XSEGON.settings.sound)`)) {
      const hover0 = await b.ev(`window.XSEGON.settings.sound.hoverSound`);
      // The limit comes from the copied settings: none here, and a set one where it is tried.
      const rate0 = await b.ev(`window.XSEGON.settings.sound.hoverRate`);
      await b.ev(`(() => { window.XSEGON.settings.sound.hoverSound = true; window.XSEGON.settings.sound.hoverRate = 30; window.__plays = 0; window.__asked = []; window.__heard = []; const p = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.__play = p;
        HTMLMediaElement.prototype.play = function () { window.__plays++; window.__asked.push(this.src); window.__heard.push([this, this.volume, performance.now()]); return p.call(this); }; })()`);
      const spots = await b.ev(`[...document.querySelectorAll("#view .spine")].slice(0, 3).map(n => (r => [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)])(n.getBoundingClientRect()))`);
      // 170 ms apart: a walk, not a sweep (sooner than 120 ms after the last one is a sweep, see below)
      for (const [x, y] of spots) { await moveTo(x, y); await lib.sleep(170); }
      check("a spine ticks as the pointer comes onto it, once each", await b.until(`window.__plays`, 3), 3);
      check("each at the level Xsegon's sounds are set to", await b.ev(`window.__heard.every(h => h[1] === window.__heard[0][1]) && window.__heard[0][1] > 0`), true);
      await moveTo(spots[2][0], spots[2][1] + 6);
      await lib.sleep(170);
      check("and not again while the pointer stays on the same one", await b.ev(`window.__plays`), 3);
      /* With no limit every game of a sweep is heard, each a quarter quieter on a player of its own.
         Three games crossed in one instant, sent in the page so no clock is in it. */
      await b.ev(`window.__heard = []; [...document.querySelectorAll("#view .spine")].slice(0, 3).forEach((n, i) => { const r = n.getBoundingClientRect();
        n.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: Math.round(r.left + r.width / 2) + 1, clientY: Math.round(r.top + r.height / 2) + 1 + i })); })`);
      check("three games crossed in an instant are three sounds: none is skipped", await b.ev(`window.__plays`), 6);
      check("the first at the usual level, the ones on its heels a quarter quieter",
        await b.ev(`window.__heard.map(h => Math.round(h[1] / window.__heard[0][1] * 100))`), [100, 75, 75]);
      check("and each on a player of its own, so none cuts another off", await b.ev(`new Set(window.__heard.map(h => h[0])).size`), 3);
      /* The limit (Settings > Sound > Sounds under the pointer, at most): 5 a second is one every 200 ms.
         A game that comes too soon waits for its turn and sounds then if the pointer is still on it,
         so the game the pointer stops on is never silent. */
      const cross = (n, off, leave) => b.ev(`(() => { [...document.querySelectorAll("#view .spine")].slice(0, ${n}).forEach((n, i) => { const r = n.getBoundingClientRect();
        n.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: Math.round(r.left + r.width / 2) + ${off}, clientY: Math.round(r.top + r.height / 2) + ${off} + i })); });
        ${leave ? `document.body.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 1, clientY: 1 }));` : ""} return window.__plays; })()`);
      await lib.sleep(250);
      await b.ev(`window.XSEGON.settings.sound.hoverRate = 5; window.__heard = []`);
      check("with a limit of 5 a second, of three games crossed in an instant the first sounds at once", await cross(3, 2), 7);
      check("the one the pointer is left on sounds when its turn comes, and the one between is passed in silence", await b.until(`window.__plays`, 8), 8);
      check("a fifth of a second after the first, and at the usual level",
        await b.ev(`[window.__heard[1][2] - window.__heard[0][2] >= 190, window.__heard.map(h => Math.round(h[1] / window.__heard[0][1] * 100))]`), [true, [100, 100]]);
      await lib.sleep(250);
      const gone = await cross(2, 3, true);
      await lib.sleep(300);
      check("a game the pointer has left before its turn stays silent", [gone, await b.ev(`window.__plays`)], [9, 9]);
      await b.ev(`window.XSEGON.settings.sound.hoverRate = 30`);
      // The page reads its settings as it opens; the switch is flipped where it reads it.
      await b.ev(`window.XSEGON.settings.sound.hoverSound = false`);
      await lib.sleep(170);
      await moveTo(spots[0][0], spots[0][1]);
      await lib.sleep(80);
      check("Settings > Sound > Sound under the pointer, off, keeps it quiet", await b.ev(`window.__plays`), 9);
      check("what the shelf asks for is the Hover sound, with the set's Move in its place where it has none",
        await b.ev(`window.__asked.every(u => /api\\/sound\\.php\\?name=hover&or=move&set=/.test(u)) && window.__asked.length`), 9);
      await b.ev(`window.XSEGON.settings.sound.hoverSound = true`);
      for (const [v, game] of [["grid", ".tile"], ["list", ".row"]]) {
        await b.setView(v);
        await b.waitFor(`document.querySelectorAll("#view ${game}").length > 1`, 10000);
        await b.ev(`window.__asked = []`);
        const two = await b.ev(`[...document.querySelectorAll("#view ${game}")].slice(0, 2).map(n => (r => [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)])(n.getBoundingClientRect()))`);
        for (const [x, y] of two) { await moveTo(x, y); await lib.sleep(170); }
        check("the " + v + " sounds under the pointer too, once a game, asking for the Hover alone",
          await b.until(`window.__asked.filter(u => /api\\/sound\\.php\\?name=hover&set=/.test(u)).length`, 2), 2);
      }
      await moveTo(5, 5);
      await b.setView("shelf");
      await b.waitFor(`document.querySelectorAll("#view .spine").length > 0`, 10000);
      /* A button sounds the Hover as a game does, once as the pointer comes onto it. A menu's
         entry is one too; a greyed one, which cannot be pressed, is not. */
      const hovers = `window.__asked.filter(u => /api\\/sound\\.php\\?name=hover&set=/.test(u)).length`;
      const mid = (pick) => b.ev(`(r => [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)])((${pick}).getBoundingClientRect())`);
      await lib.sleep(200);
      await b.ev(`window.__asked = []`);
      const [sx, sy] = await mid(`document.getElementById("btn-settings")`);
      await moveTo(sx, sy);
      check("a button sounds as the pointer comes onto it, as a game does", await b.until(hovers, 1), 1);
      await moveTo(sx + 2, sy + 1);
      await lib.sleep(170);
      check("once, however the pointer moves on it", await b.ev(hovers), 1);
      const [rx, ry] = await mid(`document.querySelector('#mb [data-menu="view"]')`);
      await moveTo(rx, ry);
      check("and the next button sounds in its turn", await b.until(hovers, 2), 2);
      await b.openBar("games");
      await lib.sleep(200);
      const entries = `[...document.querySelectorAll(".ctx .ctx-item")].filter(n => n.dataset.grey || !n.classList.contains("off"))`;
      await b.ev(`window.__asked = []; (n => { n.dataset.grey = "1"; n.classList.add("off"); })(${entries}[2])`);
      const [ex, ey] = await mid(`${entries}[1]`);
      await moveTo(ex, ey);
      check("a menu's entry is a button to the ear too", await b.until(hovers, 1), 1);
      const [gx, gy] = await mid(`${entries}[2]`);
      await moveTo(gx, gy);
      await lib.sleep(170);
      check("and a greyed one, which cannot be pressed, stays silent", await b.ev(hovers), 1);
      await b.ev(`(n => { n.classList.remove("off"); delete n.dataset.grey; })(${entries}[2])`);
      await b.key("Escape");
      await b.settled();
      await b.ev(`window.XSEGON.settings.sound.hoverSound = ${JSON.stringify(hover0)}; window.XSEGON.settings.sound.hoverRate = ${JSON.stringify(rate0)}; HTMLMediaElement.prototype.play = HTMLMediaElement.prototype.__play`);
    } else {
      console.log("    (Xsegon's sounds are off or silent in these settings; the tick under the pointer steps aside)");
    }
    await moveTo(5, 5);                     // off the shelf, so nothing rests under it

    // The gear on the strip: how tall the shelf stands its games (js\viewsize.js).
    const spineH = `document.querySelector("#view .spine").offsetHeight`;
    const h0 = await b.ev(spineH);
    await b.clickSel("#vsize");
    check("the shelf's gear opens its size, at the usual one",
      await b.until(`(p => p ? [p.querySelector(".wpop-head").textContent, p.querySelector("input").value] : null)(document.getElementById("vsize-pop"))`, ["Shelf size", "100"]), ["Shelf size", "100"]);
    await b.ev(`(i => { i.value = 150; i.dispatchEvent(new Event("input", { bubbles: true })); })(document.querySelector("#vsize-pop input"))`);
    check("the slider stands the games half as tall again, at once", await b.until(`Math.round(${spineH} / ${h0} * 100)`, 150), 150);
    check("each still as wide as its box is thick", (await b.ev(shape(g1.id))).ratio, 0.1);
    check("and it is saved", await lib.apiUntil(async () => (await api("api/settings.php")).settings.view.shelfSize === 150), true);
    await b.key("Escape");
    await b.goto(undefined, { keepView: true });
    await b.waitFor(`document.querySelectorAll("#view .spine").length > 0`, 10000);
    check("the size is still there when Xsegon opens again", await b.until(`Math.round(${spineH} / ${h0} * 100)`, 150), 150);
    check("the grid's size is its own, untouched", (await api("api/settings.php")).settings.view.gridSize, 100);
    await b.clickSel("#vsize");
    await b.waitFor(`!!document.getElementById("vsize-pop")`, 3000);
    await b.ev(`document.querySelector("#vsize-pop .vsize-reset").click()`);
    check("Back to the usual size puts it back", await b.until(spineH, h0), h0);
    await lib.apiUntil(async () => (await api("api/settings.php")).settings.view.shelfSize === 100);
    await b.key("Escape");

    // ---- Image Group > Cartridge or disc -----------------------------------
    // The grid's tiles showing what each game is played from; a game with neither keeps its box.
    await b.setView("grid");
    await b.ev(`(() => { const p = document.getElementById("platform"); p.value = ${JSON.stringify(platform)}; p.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await b.until(`document.querySelectorAll("#view .tile").length`, rows.length, 8000);
    await b.settled();
    const shown = (id) => `import("/js/state.js").then((S) => { const t = document.querySelectorAll("#view .tile")[S.games.findIndex((g) => g.id === ${JSON.stringify(id)})], i = t && t.querySelector(".shot");
      return i ? [i.className.replace("shot ", ""), (i.getAttribute("src") || "").split("?")[0], Math.abs(i.offsetWidth - i.offsetHeight) <= 1] : [t ? "noart" : "no tile", "", false]; })`;
    await b.ev(`(() => { window.__thumbAsks = 0; const f = window.fetch; window.fetch = function (u) { if (/api\\/thumbs\\.php/.test(String(u))) { window.__thumbAsks++; } return f.apply(this, arguments); }; })()`);
    await b.openBar("images");
    check("Image Group offers Cartridge or disc", await b.ev(`[...document.querySelectorAll(".ctx .ctx-label")].some(n => n.textContent === "Cartridge or disc")`), true);
    await b.menuItem(/^Cartridge or disc$/);
    check("choosing it draws the grid in that shape", await b.until(`document.getElementById("view").className`, "grid grid-medium"), "grid grid-medium");
    check("a game with a cartridge shows it, whole, in a square frame", await b.ev(shown(g1.id)), ["as-medium", "files/extras/cart/" + g1.id + ".png", true]);
    check("a game with a disc shows that", await b.ev(shown(g2.id)), ["as-medium", "files/extras/disc/" + g2.id + ".png", true]);
    check("a game with neither keeps its box, or says it has no art", ["as-box", "noart"].includes((await b.ev(shown(g3.id)))[0]), true);
    check("no small copies are asked for: these pictures are shown as they come", await b.ev(`window.__thumbAsks`), 0);
    check("the choice is saved, and the settings know it",
      [await lib.apiUntil(async () => (await api("api/settings.php")).settings.view.gridImage === "medium"), Object.keys((await api("api/settings.php")).schema.view.gridImage.options).includes("medium")], [true, true]);
    check("and the builder of small copies has no such kind", (await api("api/thumbs.php", { kind: "medium", dry: true })).ok, false);
    await b.openBar("images");
    await b.menuItem(/^Box art$/);
    check("Box art puts the covers back", await b.until(`document.getElementById("view").className`, "grid grid-box"), "grid grid-box");
    await lib.apiUntil(async () => (await api("api/settings.php")).settings.view.gridImage === "box");

    // The backup says these two folders are left out, and why.
    const skipped = ((await api("api/backup.php")).skipped || []).map((s) => s.path);
    check("a backup says the documents and the extras are left out", skipped.includes("documents") && skipped.includes("extras"));
  } finally {
    fs.rmSync(docsDir, { recursive: true, force: true });
    fs.rmSync(extrasDir, { recursive: true, force: true });
    fs.rmSync(path.join(DATA, "thumbs-test.pdf"), { force: true });
    await api("api/settings.php", { view: { gridImage: "box" } });   // as every run starts (tests\run.js), whatever stopped the checks above
    await b.setView("wheel");
  }
};
