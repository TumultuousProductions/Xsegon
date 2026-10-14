/*  The import lines at the head of every file in js\, worked out from the code
    rather than by hand.

        node tools\js-imports.js          say what is wrong, change nothing
        node tools\js-imports.js --fix    write the heads

    The page is a set of ES modules (js\main.js loads the rest). A missing
    import makes the browser refuse the whole module, found only on the screen
    that needs the name; an unused one is noise.

    Comments and strings are blanked first, so a name in prose is not a call,
    and an object key ({ headers: ... }) is not a reference. A name a file
    also defines locally inside a function keeps its import: the local wins
    where it stands.                                                        */
"use strict";
const fs = require("fs");
const path = require("path");
const JS = path.join(__dirname, "..", "js");
const FIX = process.argv.includes("--fix");

function stripped(text) {
  let out = "", i = 0, n = text.length, prev = "";
  while (i < n) {
    const c = text[i], d = text[i + 1];
    if (c === "/" && d === "/") { while (i < n && text[i] !== "\n") { out += " "; i++; } continue; }
    if (c === "/" && d === "*") { while (i < n && !(text[i] === "*" && text[i + 1] === "/")) { out += text[i] === "\n" ? "\n" : " "; i++; } out += "  "; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; out += " "; i++;
      while (i < n && text[i] !== q) { if (text[i] === "\\") { out += " "; i++; } out += text[i] === "\n" ? "\n" : " "; i++; }
      out += " "; i++; continue;
    }
    if (c === "/" && /[(,=:[!&|?{};+\-*%~^]/.test(prev)) {        // a regular expression, not a divide
      out += " "; i++;
      while (i < n && text[i] !== "/" && text[i] !== "\n") { if (text[i] === "\\") { out += " "; i++; } out += " "; i++; }
      out += " "; i++; continue;
    }
    if (!/\s/.test(c)) prev = c;
    out += c; i++;
  }
  return out;
}

const files = fs.readdirSync(JS).filter((f) => f.endsWith(".js")).sort();
const src = {}, code = {}, owns = {}, exported = {};
for (const f of files) {
  src[f] = fs.readFileSync(path.join(JS, f), "utf8").replace(/\r\n/g, "\n");
  code[f] = stripped(src[f]);
  owns[f] = new Set();
  for (const line of code[f].split("\n")) {
    const m = line.match(/^(export )?(?:function|var|let|const)\s+([A-Za-z_$][\w$]*)/);
    if (!m) continue;
    owns[f].add(m[2]);
    if (m[1]) {
      if (exported[m[2]]) { console.log("!! " + m[2] + " is exported by both " + exported[m[2]] + " and " + f); process.exitCode = 1; }
      exported[m[2]] = f;
    }
  }
}

let problems = 0;
for (const f of files) {
  const body = code[f].split("\n").filter((l) => !/^import /.test(l)).join("\n");
  const need = {};
  for (const name of Object.keys(exported)) {
    const from = exported[name];
    if (from === f || owns[f].has(name)) continue;
    const n = name.replace(/\$/g, "\\$");
    // the name of a key in an object ({ headers: ... }) is not a use of it
    const cleaned = body.replace(new RegExp("([{,]\\s*)" + n + "(\\s*:)", "g"), "$1 $2");
    if (!new RegExp("(^|[^\\w$.])" + n + "(?![\\w$])").test(cleaned)) continue;
    (need[from] = need[from] || new Set()).add(name);
  }
  const want = Object.keys(need).sort().map((from) =>
    "import { " + [...need[from]].sort().join(", ") + ' } from "./' + from + '";');
  const have = src[f].split("\n").filter((l) => /^import /.test(l));

  if (have.join("\n") !== want.join("\n")) {
    problems++;
    const wantSet = new Set(want), haveSet = new Set(have);
    for (const l of want) { if (!haveSet.has(l)) console.log((FIX ? "   " : "!! ") + f + "  + " + l); }
    for (const l of have) { if (!wantSet.has(l)) console.log((FIX ? "   " : "!! ") + f + "  - " + l); }
    if (FIX) {
      let lines = src[f].split("\n").filter((l) => !/^import /.test(l));
      // after the file's own opening comment, before everything else
      let at = 0;
      if (/^\/\*/.test(lines[0])) { while (at < lines.length && !/\*\//.test(lines[at])) at++; at++; }
      else { while (at < lines.length && /^\/\//.test(lines[at])) at++; }
      let end = at;
      while (end < lines.length && lines[end].trim() === "") end++;
      const head = want.length ? want.concat([""]) : [];
      // One blank line under the opening comment, however many were there,
      // so a fix never adds a line.
      lines = lines.slice(0, at).concat(at > 0 ? [""] : [], head, lines.slice(end));
      while (lines.length && lines[lines.length - 1] === "") lines.pop();
      fs.writeFileSync(path.join(JS, f), lines.join("\n") + "\n", "utf8");
    }
  }
}
console.log(problems === 0 ? "imports ok: " + files.length + " files"
  : (FIX ? "fixed " + problems + " files" : problems + " files have the wrong head (run with --fix)"));
if (!FIX && problems) process.exitCode = 1;
