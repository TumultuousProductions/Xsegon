// The manual reader (js\reader.js, roadmap BA1 and BA2): a PDF from a game's
// documents as a booklet that turns whole at a click, a key, the pad or the
// right stick, and opens again where it was left, with its bookmarks.
// The test copy has no documents folder (tests\sandbox.js): this group makes
// its own PDFs, whose page N is filled with red N x 7, so a pixel says which
// page is drawn. On a data folder that already has documents it steps aside.
"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./lib");
const { api, sleep } = lib;

// A PDF of n pages, w by h points, each filled with its own red and numbered;
// outline: its own contents, [title, page index] each.
function makePdf(n, w, h, outline) {
  const objs = ["", "", "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"];
  const kids = [];
  for (let i = 0; i < n; i++) {
    const draw = `${((i + 1) * 7 / 255).toFixed(4)} 0.5 0.25 rg 0 0 ${w} ${h} re f BT /F1 64 Tf 0 0 0 rg 40 40 Td (${i + 1}) Tj ET`;
    kids.push(`${objs.length + 1} 0 R`);
    objs.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${w} ${h}]/Resources<</Font<</F1 3 0 R>>>>/Contents ${objs.length + 2} 0 R>>`);
    objs.push(`<</Length ${draw.length}>>\nstream\n${draw}\nendstream`);
  }
  objs[1] = `<</Type/Pages/Kids[${kids.join(" ")}]/Count ${n}>>`;
  objs[0] = "<</Type/Catalog/Pages 2 0 R>>";
  if (outline && outline.length) {
    const root = objs.length + 1, first = root + 1, last = first + outline.length - 1;
    objs.push(`<</Type/Outlines/First ${first} 0 R/Last ${last} 0 R/Count ${outline.length}>>`);
    outline.forEach(([title, page], k) => objs.push(`<</Title(${title})/Parent ${root} 0 R${k ? `/Prev ${first + k - 1} 0 R` : ""}${first + k < last ? `/Next ${first + k + 1} 0 R` : ""}/Dest[${kids[page]}/Fit]>>`));
    objs[0] = `<</Type/Catalog/Pages 2 0 R/Outlines ${root} 0 R>>`;
  }
  let out = "%PDF-1.4\n";
  const at = objs.map((o, k) => { const here = out.length; out += `${k + 1} 0 obj\n${o}\nendobj\n`; return here; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + at.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  return out + `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
}

// What the reader shows: book or flat, the first page on show, how many, and its words.
const SHOWN = `(s => s && s.dataset.pages ? [s.dataset.mode, +s.dataset.page, +s.dataset.pages, (document.querySelector(".rd-area") || { getAttribute: () => null }).getAttribute("aria-label")] : null)(document.querySelector(".doc-stage"))`;
// The side panel's big number and the line under it, and the numbers under the pages.
const SIDE = `[(document.querySelector(".rd-big") || {}).textContent, (document.querySelector(".rd-of") || {}).textContent, [...document.querySelectorAll(".rd-folio")].map((f) => f.textContent)]`;
// Which page a drawn canvas holds, read off its red (-1: none drawn yet).
const PAGE_OF = (canvas) => `(c => { if (!c || !c.width) { return -1; } const x = c.getContext("2d").getImageData(c.width >> 1, c.height >> 2, 1, 1).data; return Math.round(x[0] / 7) - 1; })(${canvas})`;
// The book's pages on show, each as the page its canvas holds.
const ON_SHOW = `[...document.querySelectorAll(".rd-page")].map((p, i) => getComputedStyle(p).display !== "none" ? i : -1).filter((i) => i >= 0)`;

module.exports = async function (b, check) {
  const DATA = lib.DATA, BASE = lib.BASE;
  const docsDir = path.join(DATA, "documents");
  if (fs.existsSync(docsDir)) {
    console.log("    (this data folder already holds documents; the group only runs on a copy without them, and steps aside)");
    return;
  }
  const games = ((await api("api/library.php")).games || []).filter((g) => !g.versions);
  const [g1, g2] = games;
  if (!g2) { check("two games to test with", false, true); return; }
  const put = (rel, bytes) => { const p = path.join(DATA, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, bytes); };
  const placesFile = path.join(DATA, "manual-places.json");
  const places = () => { try { return JSON.parse(fs.readFileSync(placesFile, "utf8")); } catch (e) { return {}; } };
  const ctrl0 = (await api("api/settings.php")).settings.controller;
  const open = (g) => b.ev(`import("/js/docs.js").then((m) => { m.openDocs(${JSON.stringify({ id: g.id, title: g.title })}); return true; })`);
  const closeAll = async () => { await b.key("Escape"); await b.until(`document.getElementById("editor").hidden`, true, 3000); };
  const turnsOf = async () => (await b.ev(`(document.querySelector(".doc-stage") || { dataset: {} }).dataset.turns || ""`)).split(",").filter(Boolean).map(Number);

  try {
    put("documents/" + g1.id + "/Manual.pdf", makePdf(32, 400, 560, [["Controls", 4], ["Secrets", 19]]));
    put("documents/" + g1.id + "/Guide.pdf", makePdf(3, 400, 560));
    put("documents/" + g2.id + "/Manual.pdf", "this is not a PDF");

    // ---- the reader's libraries, through their own door ---------------------
    const got = await fetch(BASE + "/js/vendor/pdf-6.4.299/pdf.min.js");
    check("pdf.js is served from Xsegon's own folder, as a script kept a year",
      [got.status, (got.headers.get("content-type") || "").split(";")[0], /immutable/.test(got.headers.get("cache-control") || "")], [200, "text/javascript", true]);
    const wasm = await fetch(BASE + "/js/vendor/pdf-6.4.299/openjpeg.wasm");
    check("and its picture decoders as WebAssembly", [wasm.status, wasm.headers.get("content-type")], [200, "application/wasm"]);
    for (const bad of ["js/vendor/pdf-6.4.299/LICENSE", "js/vendor/pdf-6.4.299/nothing.js"]) {
      check("the door refuses " + bad, (await fetch(BASE + "/" + bad)).status, 404);
    }
    // A way out of the folder gets the app's own page (which carries its scripts inside it), never a script.
    const out = await fetch(BASE + "/js/vendor/pdf-6.4.299/..%2F..%2Freader.js");
    check("and never hands out a file from outside the library's folder", /javascript/.test(out.headers.get("content-type") || ""), false);

    // ---- where a manual was left (api\manual-place.php) ---------------------
    const where = (g, doc) => api("api/manual-place.php?id=" + encodeURIComponent(g.id) + "&doc=" + encodeURIComponent(doc));
    check("a manual never opened is on page 1, with no bookmarks", await where(g1, "Manual.pdf").then((r) => [r.ok, r.page, r.marks, r.one]), [true, 1, [], false]);
    const kept = await api("api/manual-place.php", { id: g1.id, doc: "Manual.pdf", page: 7, marks: [12, 3, 12], one: true });
    check("its page, bookmarks and one page or two are kept, the marks in order and once each", [kept.ok, kept.page, kept.marks, kept.one], [true, 7, [3, 12], true]);
    check("and read back", await where(g1, "Manual.pdf").then((r) => [r.page, r.marks, r.one]), [7, [3, 12], true]);
    check("in data\\manual-places.json, under the game and the file", ((places()[g1.id] || {})["Manual.pdf"] || {}).page, 7);
    check("page 0 is refused", (await api("api/manual-place.php", { id: g1.id, doc: "Manual.pdf", page: 0, marks: [] })).ok, false);
    check("so are six bookmarks", (await api("api/manual-place.php", { id: g1.id, doc: "Manual.pdf", page: 2, marks: [1, 2, 3, 4, 5, 6] })).error, "a manual keeps up to 5 bookmarks");
    check("and a document the game does not have", [(await where(g2, "Guide.pdf")).ok, (await where(g1, "../settings.json")).ok], [false, false]);
    await api("api/manual-place.php", { id: g1.id, doc: "Manual.pdf", page: 1, marks: [], one: false });

    // ---- the booklet: keys -------------------------------------------------
    await b.goto();
    await open(g1);
    check("Documents opens the manual as a booklet, on its cover: page 1 of 32", await b.until(SHOWN, ["book", 1, 32, "Page 1 of 32"], 15000), ["book", 1, 32, "Page 1 of 32"]);
    check("the cover alone, drawn: the first page is the one on show", await b.until(`[${ON_SHOW}, ${PAGE_OF(`document.querySelectorAll(".rd-page")[0].querySelector("canvas")`)}]`, [[0], 0], 8000), [[0], 0]);
    check("its pages are as tall as the room beside the side panel allows",
      await b.ev(`(a => { const k = document.querySelector(".rd-book").getBoundingClientRect(), r = a.getBoundingClientRect(); return k.height >= r.height - 60 || k.width >= r.width - 40; })(document.querySelector(".rd-area"))`), true);
    check("the side panel stands left of the book, saying page 1 of 32; the cover's number under it, its left side blank",
      await b.ev(`[(s => !!s && !s.hidden && s.getBoundingClientRect().right <= document.querySelector(".rd-book").getBoundingClientRect().left)(document.querySelector(".rd-side")), ${SIDE}]`),
      [true, ["1", "page of 32", ["", "1"]]]);
    await b.key("ArrowRight");
    check("right turns the page: pages 2 and 3 face each other", await b.until(SHOWN, ["book", 2, 32, "Pages 2 and 3 of 32"], 4000), ["book", 2, 32, "Pages 2 and 3 of 32"]);
    check("the side and the numbers under the pages follow", await b.ev(SIDE), ["2 and 3", "pages of 32", ["2", "3"]]);
    check("both drawn, in their places", await b.until(`[${ON_SHOW}, ${PAGE_OF(`document.querySelectorAll(".rd-page")[1].querySelector("canvas")`)}, ${PAGE_OF(`document.querySelectorAll(".rd-page")[2].querySelector("canvas")`)}]`, [[1, 2], 1, 2], 6000), [[1, 2], 1, 2]);
    const t1 = await b.until(`(document.querySelector(".doc-stage").dataset.turns || "").length > 0`, true, 3000);
    const fps = await turnsOf();
    check("the turn ran smoothly: 55 frames a second or more (" + fps.join(", ") + ")", t1 && fps.length > 0 && Math.min(...fps) >= 55, true);
    await b.key("PageDown");
    check("Page Down turns too", await b.until(SHOWN, ["book", 4, 32, "Pages 4 and 5 of 32"], 4000), ["book", 4, 32, "Pages 4 and 5 of 32"]);
    await b.key("ArrowLeft"); await b.until(SHOWN, ["book", 2, 32, "Pages 2 and 3 of 32"], 4000);
    await b.key("ArrowLeft");
    check("and left back to the cover", await b.until(SHOWN, ["book", 1, 32, "Page 1 of 32"], 4000), ["book", 1, 32, "Page 1 of 32"]);
    await b.key("End");
    check("End goes to the last page, alone on the left as a booklet's is", await b.until(SHOWN, ["book", 32, 32, "Page 32 of 32"], 4000), ["book", 32, 32, "Page 32 of 32"]);
    await b.key("ArrowRight");
    await sleep(300);
    check("and right past it stays there", (await b.ev(SHOWN))[1], 32);
    await b.key("Home");
    await b.until(SHOWN, ["book", 1, 32, "Page 1 of 32"], 4000);

    // ---- a click turns a whole page ----------------------------------------------
    const box = await b.ev(`(r => ({ l: r.left, t: r.top, w: r.width, h: r.height }))(document.querySelector(".rd-book").getBoundingClientRect())`);
    const turnsBefore = (await turnsOf()).length;
    await b.click(box.l + box.w * 0.75, box.t + box.h * 0.5);
    check("a click on the right half turns forward, with the whole turn", await b.until(`[(${SHOWN} || [])[1], (document.querySelector(".doc-stage").dataset.turns || "").split(",").filter(Boolean).length > ${turnsBefore} || ${turnsBefore} >= 10]`, [2, true], 4000), [2, true]);
    check("and opens nothing at full size", await b.ev(`document.querySelector(".rd-zoom").hidden`), true);
    await sleep(300);
    await b.click(box.l + box.w * 0.25, box.t + box.h * 0.5);
    check("a click on the left half turns back", await b.until(`(${SHOWN} || [])[1]`, 1, 4000), 1);
    await sleep(300);

    // ---- the side panel: anywhere in one move, the manual's own contents ---------
    await b.ev(`(s => { s.value = "20"; s.dispatchEvent(new Event("input", { bubbles: true })); })(document.querySelector(".rd-scrub"))`);
    check("sliding says where letting go will open", await b.ev(SIDE + "[0]"), "Go to 20");
    await b.ev(`document.querySelector(".rd-scrub").dispatchEvent(new Event("change", { bubbles: true }))`);
    check("and letting go opens it", await b.until(SHOWN, ["book", 20, 32, "Pages 20 and 21 of 32"], 4000), ["book", 20, 32, "Pages 20 and 21 of 32"]);
    await b.clickSel(`.rd-step[aria-label="The last page (End)"]`);
    check("the last-page button goes to the end", await b.until(`(${SHOWN} || [])[1]`, 32, 4000), 32);
    check("where forward is greyed", await b.ev(`[...document.querySelectorAll(".rd-step")].map((s) => s.disabled)`), [false, false, true, true]);
    check("the PDF's own contents are listed, each with its page",
      await b.until(`[...document.querySelectorAll(".rd-tocrow")].map((r) => [r.firstChild.textContent, r.lastChild.textContent])`, [["Controls", "5"], ["Secrets", "20"]], 4000), [["Controls", "5"], ["Secrets", "20"]]);
    await b.ev(`[...document.querySelectorAll(".rd-tocrow")][0].click()`);
    check("and a press on one opens its page", await b.until(SHOWN, ["book", 4, 32, "Pages 4 and 5 of 32"], 4000), ["book", 4, 32, "Pages 4 and 5 of 32"]);
    await b.clickSel(`.rd-step[aria-label="The first page (Home)"]`);
    await b.until(SHOWN, ["book", 1, 32, "Page 1 of 32"], 4000);

    // ---- nothing follows a drag ------------------------------------------------
    const mouse = (type, x, y) => b.send("Input.dispatchMouseEvent", { type, x: Math.round(x), y: Math.round(y), button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
    const turnsNow = (await turnsOf()).length;
    await mouse("mouseMoved", box.l + box.w - 4, box.t + box.h - 4);
    await mouse("mousePressed", box.l + box.w - 4, box.t + box.h - 4);
    for (let k = 1; k <= 12; k++) { await mouse("mouseMoved", box.l + box.w - 4 - k * box.w / 15, box.t + box.h - 4 - k * 3); await sleep(16); }
    await mouse("mouseReleased", box.l + box.w * 0.15, box.t + box.h - 40);
    await sleep(900);
    check("a corner dragged across lifts nothing and turns nothing: pages turn whole", [(await b.ev(SHOWN))[1], (await turnsOf()).length], [1, turnsNow]);
    await b.key("ArrowRight");
    await b.until(SHOWN, ["book", 2, 32, "Pages 2 and 3 of 32"], 4000);
    await sleep(800);

    // ---- full size -----------------------------------------------------------
    await b.clickSel(".rd-act");
    check("Full size on the side panel shows the pages on show, drawn larger", await b.until(`(z => !!z && !z.hidden && document.querySelector(".doc-stage").classList.contains("rd-zoomed")
      && [...z.querySelectorAll("canvas")].some((c) => c.width > document.querySelector(".rd-page canvas").width))(document.querySelector(".rd-zoom"))`, true, 6000), true);
    check("both of them, the first at the top", await b.ev(`(z => [z.querySelectorAll(".rd-zpage").length, z.scrollTop])(document.querySelector(".rd-zoom"))`), [2, 0]);
    await b.key("ArrowRight");
    check("there the arrows move about the page, and turn nothing", (await b.ev(SHOWN))[1], 2);
    await b.key("Enter");
    check("Enter fits it back", await b.until(`document.querySelector(".rd-zoom").hidden`, true, 3000), true);
    await b.key("Enter");
    await b.until(`!document.querySelector(".rd-zoom").hidden`, true, 3000);
    await b.key("Escape");
    check("and Esc at full size fits it back, without leaving the manual", await b.until(`[document.querySelector(".rd-zoom").hidden, document.getElementById("editor").hidden]`, [true, false], 3000), [true, false]);

    // ---- bookmarks, and the place kept ----------------------------------------
    const markList = `[...document.querySelectorAll(".rd-markgo")].map((c) => c.textContent)`;
    await b.key("ArrowRight"); await b.until(SHOWN, ["book", 4, 32, "Pages 4 and 5 of 32"], 4000);
    await b.key("b");
    check("B bookmarks the page, listed on the side once Xsegon has kept it", await b.until(markList, ["Page 4"], 4000), ["Page 4"]);
    check("the button now says how to take it off", await b.ev(`document.querySelectorAll(".rd-act")[1].firstChild.textContent`), "Take the bookmark off");
    check("kept in the file", ((places()[g1.id] || {})["Manual.pdf"] || {}).marks, [4]);
    await b.key("End"); await b.until(SHOWN, ["book", 32, 32, "Page 32 of 32"], 4000);
    await b.clickSel(".rd-markgo");
    check("a press on the bookmark goes back to its page", await b.until(SHOWN, ["book", 4, 32, "Pages 4 and 5 of 32"], 4000), ["book", 4, 32, "Pages 4 and 5 of 32"]);
    await b.key("ArrowRight"); await b.until(SHOWN, ["book", 6, 32, "Pages 6 and 7 of 32"], 4000);
    await closeAll();
    check("closing leaves nothing of the book behind", await b.ev(`[!!document.querySelector(".stf__parent"), !!document.querySelector(".rd-side")]`), [false, false]);
    check("and keeps the page it was left on", await lib.apiUntil(async () => ((places()[g1.id] || {})["Manual.pdf"] || {}).page === 6), true);
    await open(g1);
    check("opened again, the manual is where it was left, its bookmark with it",
      await b.until(`[${SHOWN}, ${markList}]`, [["book", 6, 32, "Pages 6 and 7 of 32"], ["Page 4"]], 15000), [["book", 6, 32, "Pages 6 and 7 of 32"], ["Page 4"]]);
    await b.clickSel(".rd-markoff");
    check("the x beside a bookmark takes it off, in the file too",
      [await b.until(`${markList}.length`, 0, 4000), await lib.apiUntil(async () => (((places()[g1.id] || {})["Manual.pdf"] || {}).marks || [1]).length === 0)], [0, true]);

    // ---- one page at a time ----------------------------------------------------
    await b.clickSel(`.rd-pages button[data-v="one"]`);
    check("One shows a single page", await b.until(`[document.querySelector(".rd-book").classList.contains("is-one"), ${SHOWN}[3], ${SIDE}[2]]`, [true, "Page 6 of 32", ["6"]], 6000), [true, "Page 6 of 32", ["6"]]);
    await b.key("ArrowRight");
    check("and turns one page at a time", await b.until(`${SHOWN}[3]`, "Page 7 of 32", 4000), "Page 7 of 32");
    check("the choice is kept for this manual", await lib.apiUntil(async () => ((places()[g1.id] || {})["Manual.pdf"] || {}).one === true), true);
    await b.clickSel(`.rd-pages button[data-v="two"]`);
    check("Two side by side puts it back", await b.until(`document.querySelector(".rd-book").classList.contains("is-one")`, false, 6000), false);

    // ---- the other documents, and the browser's reader --------------------------
    await b.key("ArrowDown");
    check("down goes to the next document, a booklet of its own on its first page", await b.until(`[(document.querySelector(".doc-tab.on") || {}).textContent, ${SHOWN}]`, ["Guide", ["book", 1, 3, "Page 1 of 3"]], 15000), ["Guide", ["book", 1, 3, "Page 1 of 3"]]);
    await b.key("ArrowUp");
    await b.until(`(${SHOWN} || [])[2]`, 32, 15000);
    await b.clickSel(".rd-plain");
    check("The browser's reader opens the PDF in a frame, for searching its words", await b.until(`(f => !!f && f.tagName === "IFRAME" && !document.querySelector(".rd-side"))(document.querySelector(".doc-stage > *"))`, true, 4000), true);
    await b.key("Enter");
    check("and Enter is the booklet again", await b.until(`(${SHOWN} || [])[0]`, "book", 15000), "book");
    await closeAll();

    // ---- the pad ---------------------------------------------------------------
    await api("api/settings.php", { controller: { enabled: true, deadzone: 0.35 } });
    await api("api/manual-place.php", { id: g1.id, doc: "Manual.pdf", page: 1, marks: [], one: false });
    await b.goto();
    await b.ev(`window.__pdWas = window.__pdWas || navigator.getGamepads; window.__pdPad = { id: "Xbox Controller (STANDARD GAMEPAD Vendor: 045e Product: 02ea)", mapping: "standard", connected: true, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }; navigator.getGamepads = () => [window.__pdPad]`);
    const hold = async (n, ms) => { await b.ev(`window.__pdPad.buttons[${n}].pressed = true`); await sleep(ms); await b.ev(`window.__pdPad.buttons[${n}].pressed = false`); await sleep(200); };
    await open(g1);
    await b.until(SHOWN, ["book", 1, 32, "Page 1 of 32"], 15000);
    await b.until(`[...document.querySelectorAll(".rd-page")][0].querySelector("canvas") !== null`, true, 6000);
    await hold(5, 150);
    check("RB turns the page", await b.until(`(${SHOWN} || [])[1]`, 2, 4000), 2);
    await sleep(800);
    await hold(4, 150);
    check("LB turns it back", await b.until(`(${SHOWN} || [])[1]`, 1, 4000), 1);
    await sleep(800);
    await hold(5, 1700);
    check("RB held turns page after page", await b.until(`(${SHOWN} || [])[1] >= 4`, true, 4000), true);
    await sleep(1000);
    const before = (await b.ev(SHOWN))[1];
    await b.ev(`window.__pdPad.axes[2] = -0.5`); await sleep(180); await b.ev(`window.__pdPad.axes[2] = 0`);
    await sleep(1200);
    check("the right stick nudged a little turns nothing", (await b.ev(SHOWN))[1], before);
    await b.ev(`window.__pdPad.axes[2] = 0.9`); await sleep(200); await b.ev(`window.__pdPad.axes[2] = 0`);
    check("pushed right, it turns forward as the cross does", await b.until(`(${SHOWN} || [])[1]`, before + 2, 4000), before + 2);
    await sleep(800);
    await b.ev(`window.__pdPad.axes[2] = -0.9`); await sleep(200); await b.ev(`window.__pdPad.axes[2] = 0`);
    check("and pushed left, back", await b.until(`(${SHOWN} || [])[1]`, before, 4000), before);
    await sleep(800);
    await hold(2, 150);
    check("X bookmarks the page", await b.until(`[...document.querySelectorAll(".rd-markgo")].map((c) => c.textContent)`, ["Page " + before], 4000), ["Page " + before]);
    await hold(0, 150);
    check("A shows the page at full size", await b.until(`!document.querySelector(".rd-zoom").hidden`, true, 4000), true);
    await hold(1, 150);
    check("B fits it back first", await b.until(`[document.querySelector(".rd-zoom").hidden, document.getElementById("editor").hidden]`, [true, false], 4000), [true, false]);
    await hold(1, 150);
    check("then B leaves the documents", await b.until(`document.getElementById("editor").hidden`, true, 4000), true);
    await b.ev(`navigator.getGamepads = window.__pdWas`);

    // ---- Animations off, and a file that is not a PDF ------------------------------
    await b.ev(`document.body.classList.add("no-anim")`);
    await api("api/manual-place.php", { id: g1.id, doc: "Manual.pdf", page: 1, marks: [], one: false });
    await open(g1);
    check("with Animations off the pages are flat", await b.until(SHOWN, ["flat", 1, 32, "Page 1 of 32"], 15000), ["flat", 1, 32, "Page 1 of 32"]);
    await b.key("ArrowRight");
    check("and swap at once, drawn", await b.until(`[${SHOWN}[1], [...document.querySelectorAll(".rd-slot")].map((s) => ${PAGE_OF(`s.querySelector("canvas")`)})]`, [2, [1, 2]], 6000), [2, [1, 2]]);
    await closeAll();
    await b.ev(`document.body.classList.remove("no-anim")`);
    await open(g2);
    check("a file that is not a PDF says so, and offers the browser's reader",
      await b.until(`(f => !!f && /could not be opened here/.test(f.textContent) && !!document.querySelector(".rd-fail + button"))(document.querySelector(".rd-fail"))`, true, 15000), true);
    await closeAll();
  } finally {
    await b.ev(`if (window.__pdWas) { navigator.getGamepads = window.__pdWas; } document.body.classList.remove("no-anim")`).catch(() => {});
    await api("api/settings.php", { controller: { enabled: ctrl0.enabled !== false, deadzone: ctrl0.deadzone || 0.35 } });
    fs.rmSync(docsDir, { recursive: true, force: true });
  }
};
