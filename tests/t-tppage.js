/* Tumultuous Productions' page (roadmap BS, js/tppage.js, api/tumultuous.php): its
   card, last on the consoles screen, opens it; its two tabs and their keys; the code
   for a phone only when asked for; addresses come only from the shipped page, and a
   test copy opens none; Tell me when it's out is kept, and said once in the mailbox
   when a release marks the game out (a stand-in page, XSEGON_TP_PAGE); Settings >
   View puts the card away. Pictures of both tabs go to tests\out. */

"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { api, BASE, DATA, ROOT, Guard } = require("./lib");

function php() {
  for (const c of [process.env.XSEGON_PHP, path.join(ROOT, "..", "php-8.5.12-nts-Win32-vs17-x64", "php.exe")]) {
    if (c && fs.existsSync(c)) { return c; }
  }
  return "php";
}

module.exports = async function (b, check) {
  const kept = new Guard(["tumultuous.json", "messages.json", "settings.json"]);
  const stand = path.join(DATA, "tp-page-out.json");
  try {
    fs.rmSync(path.join(DATA, "tumultuous.json"), { force: true });

    /* ---- the page's words and its addresses ------------------------------- */
    const r = await api("api/tumultuous.php");
    const pg = r.page || {}, paid = ((pg.help || {}).paid || [])[0] || {};
    check("tumultuous: the page reads, named, with its address, the two games and $35 an hour, nothing asked of yet",
      [r.ok, pg.name, pg.mail, ((pg.games || {}).list || []).map((g) => g.id), paid.amount + paid.per, Object.keys(r.tell || {}).length],
      [true, "Tumultuous Productions", "help@tumultuousproductions.site", ["yami", "aom"], "$35/hr", 0]);
    const safe = ((pg.help || {}).safe || []).map((s) => s.title);
    check("  Staying safe says it only writes back, and no games, BIOS files or keys",
      [safe.includes("I only write back"), safe.includes("No games, BIOS files or keys"), safe.includes("I never write first")], [true, true, false]);
    const mail = await api("api/tumultuous.php", { open: "mail" });
    check("Write to me: an email to that address with this copy's version in it, and a test copy opens nothing",
      [mail.ok, mail.dry, /^mailto:help@tumultuousproductions\.site\?subject=Xsegon%20help&body=Version%3A%20Xsegon%20/.test(mail.url || "")], [true, true, true]);
    const watch = await api("api/tumultuous.php", { open: "watch:yami" });
    const link = await api("api/tumultuous.php", { open: "link:1" });
    check("a trailer and a link: the shipped page's own https addresses", [watch.url, watch.dry, link.url], ["https://tumultuousproductions.site", true, "https://discord.gg/E5uBYzEasu"]);
    const refused = [];
    for (const o of ["https://example.com", "link:9", "watch:nobody", "site:aom", ""]) { refused.push((await api("api/tumultuous.php", { open: o })).ok); }
    check("nothing else opens: an address in the request, a link or a game not on the page, a game with no site", refused, [false, false, false, false, false]);

    /* ---- tell me when it's out --------------------------------------------- */
    const t1 = await api("api/tumultuous.php", { tell: "yami", on: true });
    const file1 = JSON.parse(fs.readFileSync(path.join(DATA, "tumultuous.json"), "utf8"));
    check("Tell me when it's out: kept for Yami in data\\tumultuous.json", [t1.ok, (t1.tell || {}).yami, file1.tell.yami], [true, "asked", "asked"]);
    check("  and refused for a game not on the page", (await api("api/tumultuous.php", { tell: "nobody", on: true })).ok, false);
    // A release that marks Yami out: a stand-in page, which only a test copy reads.
    const out = JSON.parse(fs.readFileSync(path.join(ROOT, "includes", "tumultuous", "page.json"), "utf8"));
    out.games.list[0].out = true;
    out.games.list[0].outText = "It is on its page.";
    fs.writeFileSync(stand, JSON.stringify(out));
    const tell = () => String(execFileSync(php(), ["-r", "require 'includes/boot.php'; require 'includes/tumultuous.php'; echo xs_tp_tell();"],
      { cwd: ROOT, env: Object.assign({}, process.env, { XSEGON_DATA: DATA, XSEGON_TP_PAGE: stand }), encoding: "utf8", windowsHide: true })).trim();
    const said1 = tell(), said2 = tell();
    const msgs = JSON.parse(fs.readFileSync(path.join(DATA, "messages.json"), "utf8"));
    const m = msgs.find((x) => x.id === "msg-tp-yami") || {};
    check("a release that marks Yami out: the mailbox says so once, with the page's button, and nothing of the game not asked of",
      [said1, said2, m.title, m.opens, /You asked Xsegon to say when Yami came out\. It is on its page\./.test(m.body || ""), msgs.some((x) => x.id === "msg-tp-aom")],
      ["1", "0", "Yami is out", ["tumultuous"], true, false]);
    fs.rmSync(stand, { force: true });
    await api("api/tumultuous.php", { tell: "yami", on: false });
    fs.rmSync(path.join(DATA, "tumultuous.json"), { force: true });

    /* ---- the card and the page --------------------------------------------- */
    await api("api/settings.php", { view: { showTumultuous: true, systemsFirst: true, default: "wheel", systemsStyle: "wheel" } });
    await b.goto(BASE + "/");
    await b.waitFor(`!document.getElementById("syswall").hidden && document.querySelectorAll("#syswall .sel").length > 0`, 10000);
    await b.key("End");
    await b.settled();
    check("the last card on the consoles screen is Tumultuous Productions",
      await b.until(`((document.querySelector("#syswall .sel") || {}).textContent || "").includes("Tumultuous Productions")`, true, 3000), true);
    await b.key("Enter");
    // A press where the person would press: the page scrolls in a box of its own, so the button is brought to the middle first.
    const press = async (sel) => {
      await b.ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: "center", behavior: "instant" })`);
      await b.clickSel(sel);
    };
    const up = `!!document.getElementById("tppage") && !document.getElementById("tppage").hidden`;
    check("Enter opens its page in place of the consoles", [await b.waitFor(up, 10000), await b.ev(`document.getElementById("syswall").hidden`)], [true, true]);
    const banner = `((document.querySelector("#tppage .tp-tab:not([hidden]) .tp-banner h1") || {}).textContent || "")`;
    check("  on the Help tab, with the four parts and the legend's keys",
      [await b.until(banner, "Help with Xsegon", 8000), await b.ev(`["tp-fix", "tp-ask", "tp-paid", "tp-safe"].every((id) => !!document.getElementById(id))`),
       await b.ev(`document.getElementById("help").textContent.includes("Help, My games")`)], ["Help with Xsegon", true, true]);
    check("  the price as $35 an hour, and payment agreed in writing first",
      await b.ev(`[document.querySelector("#tp-paid .tp-rate .tp-amount").textContent, /agree on it in writing before we start/.test(document.querySelector("#tp-paid .tp-steps").textContent)]`), ["$35/hr", true]);
    check("the code for a phone stays hidden until asked for", await b.ev(`document.querySelector("#tppage .tp-qr").hidden`), true);
    await b.shot("tppage-help");
    await press(`#tppage [data-do="qr"]`);
    check("  asked for: a square that holds only the address, and says so",
      await b.ev(`(() => { const q = document.querySelector("#tppage .tp-qr"); return [q.hidden, !!q.querySelector("svg path"), /Only my email address, help@tumultuousproductions\\.site, nothing else/.test(q.textContent),
        document.querySelector('#tppage [data-do="qr"]').textContent]; })()`), [false, true, true, "Hide the code"]);
    await press(`#tppage .tp-email [data-do="mail"]`);
    check("Write to me on a test copy says what it would open, and opens nothing",
      await b.until(`document.getElementById("strip").textContent.includes("A test copy opens nothing: it would open an email to help@tumultuousproductions.site")`, true, 5000), true);

    await b.key("e");
    check("E is My games: Yami and Arena of Might, each with Tell me when it's out",
      [await b.until(banner, "My games", 4000), await b.ev(`[...document.querySelectorAll("#tppage .tp-tab:not([hidden]) .tp-game h2")].map((h) => h.textContent)`),
       await b.ev(`document.querySelectorAll('#tppage [data-do^="tell:"]').length`)], ["My games", ["Yami", "Arena of Might"], 2]);
    check("  at the top of the tab, not where Help was left",
      await b.ev(`document.querySelector("#tppage .tp-scroll").scrollTop`), 0);
    const pics = [];
    for (const g of out.games.list) {
      const res = await fetch(BASE + "/" + g.picture);
      pics.push(res.status + " " + res.headers.get("content-type"));
    }
    check("  each trailer's picture is served", pics, ["200 image/jpeg", "200 image/jpeg"]);
    await b.shot("tppage-games");
    await press(`#tppage [data-do="tell:yami"]`);
    check("  pressed, it is kept and the button says so",
      [await b.until(`(document.querySelector('#tppage [data-do="tell:yami"]') || {}).textContent || ""`, "✓ Xsegon will tell you", 5000),
       (JSON.parse(fs.readFileSync(path.join(DATA, "tumultuous.json"), "utf8")).tell || {}).yami], ["✓ Xsegon will tell you", "asked"]);
    await press(`#tppage [data-do="tell:yami"]`);
    check("  pressed again, it is let go", await b.until(`(document.querySelector('#tppage [data-do="tell:yami"]') || {}).textContent || ""`, "🔔 Tell me when it's out", 5000), "🔔 Tell me when it's out");
    await b.key("q");
    await b.key("ArrowDown");
    await b.key("ArrowDown");
    check("Q is Help again, and the arrows walk its buttons", [await b.until(banner, "Help with Xsegon", 4000), await b.ev(`document.querySelectorAll("#tppage .tp-at").length`)], ["Help with Xsegon", 1]);
    await b.key("Escape");
    check("Esc goes back to the consoles", await b.waitFor(`document.getElementById("tppage").hidden && !document.getElementById("syswall").hidden`, 5000), true);

    /* ---- put away from Settings --------------------------------------------- */
    await api("api/settings.php", { view: { showTumultuous: false } });
    await b.goto(BASE + "/");
    await b.waitFor(`!document.getElementById("syswall").hidden && document.querySelectorAll("#syswall .sel").length > 0`, 10000);
    await b.key("End");
    await b.settled();
    check("Settings > View put the card away: the last card is Fan projects again",
      await b.until(`((document.querySelector("#syswall .sel") || {}).textContent || "").includes("Fan projects")`, true, 3000), true);
  } finally {
    fs.rmSync(stand, { force: true });
    kept.restore();
  }
};
