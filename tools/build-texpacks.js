/*  The texture packs listed in a game's details (includes\texpacks.php), built
    from the Texture Packs Archive, the community list kept by Sad Origami.

        node tools\build-texpacks.js                 the sheet as it is online now
        node tools\build-texpacks.js --sheet x.xlsx  a copy of it already downloaded

    Writes includes\texpacks\list.json, which ships with Xsegon: a person's PC
    asks nobody for it. Run before a release. The consoles are the ones whose
    emulator here loads packs. Anyone on the sheet's own Blacklist tab is left
    out. A pack whose page is emulationking.com, evilgames.eu or a GitHub
    project gets its own download and size, asked of that page here, so Xsegon
    can fetch it with one press; every other pack is opened at its page.    */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const SHEET = "1sif8FeRGJRbytK8wFRXgF6Hke9V6GUFs";
const OUT = path.join(__dirname, "..", "includes", "texpacks", "list.json");
const TABS = { PS2: "sony playstation 2", GC: "nintendo gamecube", Wii: "nintendo wii", N64: "nintendo 64" };
const UA = { "User-Agent": "Xsegon texture pack list builder" };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- the .xlsx: a .zip of XML ------------------------------------------------- */
function unzip(buf) {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) { end--; }
  if (end < 0) { throw new Error("not a .zip"); }
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10), packed = buf.readUInt32LE(at + 20);
    const nlen = buf.readUInt16LE(at + 28), xlen = buf.readUInt16LE(at + 30), clen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42), name = buf.toString("utf8", at + 46, at + 46 + nlen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + packed);
    files[name] = method === 8 ? zlib.inflateRawSync(raw).toString("utf8") : raw.toString("utf8");
    at += 46 + nlen + xlen + clen;
  }
  return files;
}
const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");
const texts = (xml) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join("");

function sheets(files) {
  const shared = [...(files["xl/sharedStrings.xml"] || "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const rels = {};
  for (const m of (files["xl/_rels/workbook.xml.rels"] || "").matchAll(/<Relationship [^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0]), to = /Target="([^"]+)"/.exec(m[0]);
    if (id && to) { rels[id[1]] = to[1].replace(/^\//, "").replace(/^(?!xl\/)/, "xl/"); }
  }
  const out = {};
  for (const m of files["xl/workbook.xml"].matchAll(/<sheet [^>]*>/g)) {
    const name = unxml(/name="([^"]+)"/.exec(m[0])[1]), file = rels[/r:id="([^"]+)"/.exec(m[0])[1]];
    const xml = files[file] || "", relFile = files[file.replace("worksheets/", "worksheets/_rels/") + ".rels"] || "";
    const targets = {};
    for (const r of relFile.matchAll(/<Relationship [^>]*>/g)) {
      const id = /Id="([^"]+)"/.exec(r[0]), to = /Target="([^"]+)"/.exec(r[0]);
      if (id && to) { targets[id[1]] = unxml(to[1]); }
    }
    const links = {};
    for (const h of xml.matchAll(/<hyperlink [^>]*>/g)) {
      const ref = /ref="([A-Z]+\d+)"/.exec(h[0]), id = /r:id="([^"]+)"/.exec(h[0]);
      if (ref && id && targets[id[1]]) { links[ref[1]] = targets[id[1]]; }
    }
    const rows = [];
    for (const r of xml.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
      const row = {};
      for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+)(\d+)"/.exec(c[1]);
        if (!ref) { continue; }
        const type = (/t="([^"]+)"/.exec(c[1]) || [])[1], body = c[2] || "";
        const v = (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1];
        let value = type === "s" && v !== undefined ? shared[+v] : type === "inlineStr" ? texts(body) : v !== undefined ? unxml(v) : "";
        let url = links[ref[1] + ref[2]] || null;
        const f = (/<f>([\s\S]*?)<\/f>/.exec(body) || [])[1];
        if (!url && f && /HYPERLINK/i.test(f)) { url = ((/"(https?:\/\/[^"]+)"/.exec(unxml(f))) || [])[1] || null; }
        row[ref[1]] = { v: String(value || "").trim(), u: url };
      }
      rows.push(row);
    }
    out[name] = rows;
  }
  return out;
}

/* ---- each pack's own download, where its page gives one -------------------------- */
async function page(url) {
  await pause(250);
  const r = await fetch(url, { headers: UA, redirect: "follow" });
  return r.ok ? r.text() : "";
}
async function sizeOf(url) {
  await pause(250);
  const r = await fetch(url, { method: "HEAD", headers: UA, redirect: "follow" });
  return r.ok ? Number(r.headers.get("content-length") || 0) : 0;
}
const title = (html, cut) => unxml(((/<title>([^<]*)<\/title>/i.exec(html) || [])[1] || "").replace(cut, "").trim());

async function directOf(url, console_) {
  let host = "";
  try { host = new URL(url).host.replace(/^www\./, ""); } catch (e) { return null; }
  if (host === "emulationking.com") {
    const html = await page(url);
    const file = (/https:\/\/files\.emulationking\.com\/[^"'\s>]+\.(?:zip|7z)/i.exec(html) || [])[0];
    return file ? { url: file, bytes: await sizeOf(file), name: title(html, / - Emulation King$/) } : null;
  }
  if (host === "evilgames.eu") {
    const html = await page(url);
    const files = [...html.matchAll(/href="([^"]+\.(?:zip|7z))"/g)].map((m) => new URL(m[1], url).href);
    const want = console_ === "nintendo 64" ? [/gliden64-png-hd\.zip$/, /gliden64-hts-hd\.7z$/, /gliden64/] : [/dolphin-png-hd\.zip$/, /dolphin-png/, /dolphin/];
    for (const w of want) {
      const f = files.find((x) => w.test(x));
      if (f) { return { url: f, bytes: await sizeOf(f), name: title(html, /\s*[|-].*$/) }; }
    }
    return null;
  }
  const gh = /^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/.exec(url);
  if (gh) {
    await pause(250);
    const r = await fetch("https://api.github.com/repos/" + gh[1] + "/" + gh[2].replace(/\.git$/, "") + "/releases/latest", { headers: Object.assign({ Accept: "application/vnd.github+json" }, UA) });
    if (!r.ok) { return null; }
    const rel = await r.json();
    const asset = (rel.assets || []).filter((a) => /\.(zip|7z)$/i.test(a.name)).sort((a, b) => b.size - a.size)[0];
    return asset ? { url: asset.browser_download_url, bytes: asset.size, name: rel.name || gh[2] } : null;
  }
  return null;
}

/* ---- the rows, as includes\texpacks.php reads them --------------------------------- */
const pay = (s) => /^(n\/a|)$/i.test(s) ? "free" : /paywall|patreon|buymeacoffee|ko-?fi/i.test(s) ? "paid" : /ads/i.test(s) ? "ads" : "account";
const status = (s) => /^complete/i.test(s) ? "Complete" : /partial/i.test(s) ? "Part of the game" : /progress|incomplete/i.test(s) ? "Not finished" : "";
const kind = (s) => /handcrafted/i.test(s) ? "hand" : /ai\s*upscale/i.test(s) ? "ai" : /mixed/i.test(s) ? "mixed" : "";
const bytes = (s) => { const m = /([\d.]+)\s*(GB|MB|KB)/i.exec(s || ""); return m ? Math.round(+m[1] * { GB: 1073741824, MB: 1048576, KB: 1024 }[m[2].toUpperCase()]) : 0; };
const https = (u) => (u && /^https:\/\/[^\s"]+$/.test(u) ? u : "");

(async function () {
  const at = process.argv.indexOf("--sheet");
  let buf;
  if (at > 0) {
    buf = fs.readFileSync(process.argv[at + 1]);
  } else {
    const r = await fetch("https://docs.google.com/spreadsheets/d/" + SHEET + "/export?format=xlsx", { headers: UA, redirect: "follow" });
    if (!r.ok) { throw new Error("the sheet did not come: " + r.status); }
    buf = Buffer.from(await r.arrayBuffer());
  }
  const all = sheets(unzip(buf));
  const banned = new Set((all.Blacklist || []).map((r) => (r.B || {}).v || "").filter((n) => n && n !== "Author").map((n) => n.toLowerCase()));
  const out = { made: new Date().toISOString().slice(0, 10), from: "Texture Packs Archive, kept by Sad Origami: https://docs.google.com/spreadsheets/d/" + SHEET, consoles: {} };
  let direct = 0, left = 0;
  for (const [tab, console_] of Object.entries(TABS)) {
    const rows = all[tab] || [];
    if (!rows.length) { throw new Error("the sheet has no " + tab + " tab: its layout changed"); }
    const col = {};
    for (const [c, cell] of Object.entries(rows[0])) { col[cell.v.trim()] = c; }
    for (const need of ["Game Title", "Download", "Region", "Size", "Restriction", "Status", "Type", "Pack Author"]) {
      if (!col[need]) { throw new Error("the " + tab + " tab has no " + need + " column: its layout changed"); }
    }
    const cell = (r, name) => r[col[name]] || { v: "", u: null };
    const list = [];
    for (const r of rows.slice(1)) {
      const t = cell(r, "Game Title").v, by = cell(r, "Pack Author").v, link = https(cell(r, "Download").u);
      if (!t || (!link)) { continue; }
      if (banned.has(by.toLowerCase())) { left++; continue; }
      const get = await directOf(link, console_).catch(() => null);
      if (get) { direct++; }
      const region = cell(r, "Region").v;
      list.push({
        k: crypto.createHash("sha1").update(console_ + "|" + t + "|" + by + "|" + link).digest("hex").slice(0, 12),
        t, name: get && get.name ? get.name : "", by, kind: kind(cell(r, "Type").v), st: status(cell(r, "Status").v),
        r: /^(NTSC-U|PAL|NTSC-J)$/.test(region) ? region : "", bytes: get && get.bytes ? get.bytes : bytes(cell(r, "Size").v),
        pay: pay(cell(r, "Restriction").v), page: link, where: new URL(link).host.replace(/^www\./, ""),
        tip: https(cell(r, "Tip the Author").u), get: get ? { url: get.url, bytes: get.bytes, name: get.name } : null,
      });
    }
    list.sort((a, b) => a.t.localeCompare(b.t) || a.by.localeCompare(b.by));
    out.consoles[console_] = list;
    console.log(tab + ": " + list.length + " packs");
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
  console.log("wrote " + OUT + ": " + direct + " with a download of their own, " + left + " left out (on the sheet's blacklist)");
})().catch((e) => { console.error("!! " + e.message); process.exit(1); });
