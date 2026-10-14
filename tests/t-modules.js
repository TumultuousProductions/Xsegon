/* The shape of js\: the rules that keep the modules behaving like one file.
   Three are not style. A missing or stale import head refuses the whole
   module in the browser. A listener put up while a module is evaluated runs
   in import order, so the keys could end up behind the idle clock. And an
   import of the entry loads a second copy of it, since the page asks for it
   with a ?v= on the address. No browser needed; it reads the files. */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { api } = require("./lib");
const ROOT = path.join(__dirname, "..");
const JS = path.join(ROOT, "js");

/** Code with comments and the insides of strings blanked out. */
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
    if (c === "/" && /[(,=:[!&|?{};+\-*%~^]/.test(prev)) {
      out += " "; i++;
      while (i < n && text[i] !== "/" && text[i] !== "\n") { if (text[i] === "\\") { out += " "; i++; } out += " "; i++; }
      out += " "; i++; continue;
    }
    if (!/\s/.test(c)) prev = c;
    out += c; i++;
  }
  return out;
}

module.exports = async function (b, check) {
  const files = fs.readdirSync(JS).filter((f) => f.endsWith(".js")).sort();
  check("js\\ is a set of modules", files.length > 10 && files.includes("main.js"));

  const text = {}, code = {};
  for (const f of files) {
    text[f] = fs.readFileSync(path.join(JS, f), "utf8");
    code[f] = stripped(text[f]);
  }
  /** What a file imports, read from its import lines alone. */
  const imported = (f) => (text[f] || "").split(/\r?\n/)
    .map((l) => (l.match(/^import [^"]*"\.\/([\w.-]+\.js)";$/) || [])[1])
    .filter(Boolean);

  // 1. the heads say what the code needs, no more and no less
  let head = "";
  try {
    head = execFileSync(process.execPath, [path.join(ROOT, "tools", "js-imports.js")], { encoding: "utf8" });
  } catch (e) {
    head = (e.stdout || "") + (e.stderr || "");
  }
  check("every import head matches the code", /^imports ok/m.test(head) ? true : head.trim().split("\n").slice(0, 4).join(" | "), true);

  // 2. nothing imports the entry
  const importsMain = files.filter((f) => imported(f).includes("main.js"));
  check("nothing imports the entry", importsMain.length ? importsMain.join(", ") : true, true);

  // 3. every file is reachable from the entry
  const seen = new Set(["main.js"]), queue = ["main.js"];
  while (queue.length) {
    for (const name of imported(queue.pop())) {
      if (!seen.has(name)) { seen.add(name); queue.push(name); }
    }
  }
  const orphans = files.filter((f) => !seen.has(f));
  check("every file is reached from the entry", orphans.length ? orphans.join(", ") : true, true);

  // 4. nothing but the entry does anything while it is being evaluated:
  //    listeners and timers wait in an init() that main.js calls in order
  const early = [];
  for (const f of files) {
    if (f === "main.js") { continue; }
    let depth = 0;
    code[f].split("\n").forEach((line, i) => {
      const before = depth;
      for (const ch of line) { if ("([{".includes(ch)) depth++; if (")]}".includes(ch)) depth--; }
      if (before !== 0) { return; }
      const t = line.trim();
      if (!t || /^(import|export|var|let|const|function)\b/.test(t) || /^[})\];]/.test(t)) { return; }
      if (/addEventListener|setInterval|setTimeout|requestAnimationFrame/.test(t)) { early.push(f + ":" + (i + 1)); }
    });
  }
  check("no module puts up a listener while it loads", early.length ? early.join(", ") : true, true);

  // 5. a value another file owns is changed through its setter, never assigned
  //    (the browser would throw, but this says which line before it does)
  const owned = {};
  for (const f of files) {
    for (const m of code[f].matchAll(/^export (?:var|let)\s+([A-Za-z_$][\w$]*)/gm)) { owned[m[1]] = f; }
  }
  const stolen = [];
  for (const f of files) {
    for (const name of Object.keys(owned)) {
      if (owned[name] === f || !imported(f).includes(owned[name])) { continue; }
      const n = name.replace(/\$/g, "\\$");
      const writes = new RegExp("(^|[^\\w$.])" + n + "\\s*(=[^=>]|\\+\\+|--|\\+=|-=)", "m");
      const local = new RegExp("(var|let|const|function)\\s+" + n + "\\b");   // a local may shadow it
      if (writes.test(code[f]) && !local.test(code[f])) { stolen.push(f + " writes " + name); }
    }
  }
  check("another file's value is only changed through its setter", stolen.length ? stolen.join(", ") : true, true);

  // 6. the page carries its scripts inside it, with the entry as a module for
  //    the way back, and loads nothing else
  const page = fs.readFileSync(path.join(ROOT, "index.php"), "utf8");
  check("the page's scripts ride inside it as text", /<script type="application\/json" id="xs-pack">/.test(page));
  check("and js\\main.js as a module is the way back", /s\.type = "module";\s*s\.src = "js\/main\.js\?v=/.test(page));
  check("and no second script beside it", (page.match(/<script src=/g) || []).length === 0);
  /* The page's loader writes "./x.js" out in full, and knows the one form
     tools\js-imports.js writes. An import in any other form would reach the
     browser unrewritten and stop the page. */
  const odd = files.filter((f) => {
    const all = (code[f].match(/^import\b/gm) || []).length + (code[f].match(/^export\b[^\n]*\bfrom\b/gm) || []).length;
    return all !== (text[f].match(/^import\s+\{[^}]*\}\s+from\s+"\.\/[^"]+";/gm) || []).length;
  });
  check("every import is in the one form the page's loader rewrites", odd.length ? odd.join(", ") : true, true);

  // 7. no file grows back into one big file
  const big = files.filter((f) => text[f].split("\n").length > 700);
  check("no file is over 700 lines", big.length ? big.join(", ") : true, true);

  /* 8. the server's side of rule 5: no PHP function declared in two files.
     PHP stops dead on the second one ("Cannot redeclare"), but only in a
     request that loads both, and a real launch is the one request no test makes. */
  const where = {};
  for (const dir of ["includes", "api", "bin"]) {
    for (const f of fs.readdirSync(path.join(ROOT, dir)).filter((n) => n.endsWith(".php"))) {
      for (const m of fs.readFileSync(path.join(ROOT, dir, f), "utf8").matchAll(/^function\s+([A-Za-z0-9_]+)\s*\(/gm)) {
        (where[m[1].toLowerCase()] = where[m[1].toLowerCase()] || []).push(dir + "\\" + f);
      }
    }
  }
  const twice = Object.keys(where).filter((n) => where[n].length > 1 && where[n].some((f) => f.startsWith("includes")))
    .map((n) => n + " (" + where[n].join(", ") + ")");
  check("no PHP function is declared in two files", twice.length ? twice.join("; ") : true, true);

  /* 9. every PHP file and every PowerShell script parses. Read, never run:
     a script that opens a window and the branch that starts a real game
     are code no group can run. */
  const found = { php: [], ps1: [] };
  (function walk(dir) {
    for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
      if (n.isDirectory()) {
        if (!/^(\..*|data|runtime|doc|img|sounds|gamesdb|Games|Microsoft|node_modules|out)$/i.test(n.name)) { walk(path.join(dir, n.name)); }
        continue;
      }
      const kind = path.extname(n.name).slice(1).toLowerCase();
      if (found[kind]) { found[kind].push(path.join(dir, n.name)); }
    }
  })(ROOT);
  const short = (l) => l.split(ROOT + path.sep).join("").split(ROOT.replace(/\\/g, "/") + "/").join("");

  const phpExe = ((await api("api/status.php")).build || {}).phpExe;
  const badPhp = [];
  for (let i = 0; i < found.php.length; i += 40) {             // 40 at a time: a command line has a limit
    let out = "";
    try {
      out = execFileSync(phpExe, ["-l"].concat(found.php.slice(i, i + 40)), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch (e) {
      out = e.stdout ? String(e.stdout) : "Parse error: php -l could not be run (" + String(e.message || e).split("\n")[0] + ")";
    }
    for (const l of out.split(/\r?\n/)) { if (/^(Parse|Fatal) error/.test(l)) { badPhp.push(short(l)); } }
  }
  check("every PHP file parses", found.php.length > 50 ? (badPhp.length ? badPhp.slice(0, 3).join(" | ") : true) : "only " + found.php.length + " found", true);

  const ask = "$bad = @(); foreach ($f in $env:XS_PARSE.Split('|')) { $t = $null; $e = $null; "
    + "[void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$t, [ref]$e); "
    + "if ($e.Count) { $bad += ((Split-Path $f -Leaf) + ' line ' + $e[0].Extent.StartLineNumber + ': ' + $e[0].Message) } }; $bad -join [char]10";
  let said = "";
  try {
    said = execFileSync("powershell.exe", ["-NoProfile", "-Command", ask],
      { encoding: "utf8", env: Object.assign({}, process.env, { XS_PARSE: found.ps1.join("|") }) });
  } catch (e) {
    said = "PowerShell could not be asked (" + String(e.message || e).split("\n")[0] + ")";
  }
  const badPs = said.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  check("every PowerShell script parses", found.ps1.length > 5 ? (badPs.length ? badPs.slice(0, 3).join(" | ") : true) : "only " + found.ps1.length + " found", true);
};
