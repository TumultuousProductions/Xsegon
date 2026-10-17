// Xsegon tests - the harness.
//
// Drives the real page in a headless Chrome over the DevTools protocol, with
// nothing installed: Node's own fetch and WebSocket, and the Chrome already
// on the machine. run.js has the how and why; this file is the toolkit each
// test file gets.
"use strict";
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

/* Where the run points. The live Xsegon until run.js has started its own
   server on a copy of data\ (tests\sandbox.js) and called useTarget(); a
   group loads after that and reads the new values when it requires this. */
let BASE = process.env.XSEGON_URL || "http://127.0.0.1:8099";
const ROOT = path.join(__dirname, "..");
let DATA = process.env.XSEGON_DATA || path.join(ROOT, "data");
function useTarget(url, data) {
  BASE = url; DATA = data;
  module.exports.BASE = url; module.exports.DATA = data;
}
const OUT = path.join(__dirname, "out");

/* Every fixed wait in the suite goes through here, and is counted by the
   line that asked for it. Waiting, not checking, is where the run time goes,
   so the bill is printed with the results and written to
   tests\out\sleeps.json: a lazy sleep added later shows up in every run. */
const sleepBill = { total: 0, sites: {} };
const sleep = (ms) => {
  const at = ((new Error().stack || "").split("\n")[2] || "").replace(/^\s*at\s+/, "").replace(/.*[\\/](tests[\\/])/, "$1");
  sleepBill.total += ms;
  sleepBill.sites[at] = (sleepBill.sites[at] || 0) + ms;
  return new Promise((r) => setTimeout(r, ms));
};
/* The gap between two looks while waiting FOR something (waitFor, until,
   settled). Not billed: that time is the page being slow, not the suite
   being lazy. Short, because a look is a cheap round trip and every wait
   overshoots by half a gap on average. */
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
/* XS_WAITS=1 prints every wait (waitFor, until) that took over a second,
   with the line that asked: how a wait that always runs out its time, and
   so costs as much as the sleep it replaced, is found. */
const noteWait = (t0, what) => {
  const ms = Date.now() - t0;
  if (!process.env.XS_WAITS || ms < 1000) { return; }
  const at = ((new Error().stack || "").split("\n")[3] || "").replace(/^\s*at\s+/, "").replace(/.*[\\/](tests[\\/])/, "$1");
  console.log("       wait " + (ms / 1000).toFixed(1) + "s  " + at + "  " + String(what).replace(/\s+/g, " ").slice(0, 90));
};

/* Which windows are up, and the rules for which may be up together.
   SCREENS is what is showing; SCREEN_RULES is the list of rules broken right
   now, empty when all is well. The Browser checks the rules after every page
   load, view change, console opened and menu press in every group
   (screenCheck), and the screens group walks every window against SCREENS. */
const SCREENS = `(() => {
  // Really on screen: a box drawn, which a hidden parent takes away too
  // (the back arrow lives in the bar, the sidebar in the games view).
  const shown = (n) => !!n && !n.hidden && n.getClientRects().length > 0;
  const up = (id) => shown(document.getElementById(id));
  const many = (sel) => [...document.querySelectorAll(sel)].filter(shown).length;
  return { wall: up("syswall"), main: up("main"), toolbar: up("toolbar"), details: up("details"), fanpage: up("fanpage"), extpage: up("extpage"),
           settings: up("settings"), editor: up("editor"), saver: up("saver"), offline: up("offline"),
           mailbox: up("mailbox"), sidebar: up("sidebar"), consolesBtn: up("btn-systems"),
           menus: many(".ctx:not(.ctx-sub)"), picker: many(".lcols"), confirms: many(".confirm-wrap") };   // a group's box is part of its menu
})()`;
// The Filter by window is up (js\filterwin.js).
const FILTERS_UP = `(document.querySelector("#editor:not([hidden]) .flt-inner .panel-title") || {}).textContent === "FILTER BY"`;
const SCREEN_RULES = `(() => {
  if (!document.getElementById("syswall")) { return []; }        // not the app's page (play.php)
  const s = ${SCREENS}, bad = [];
  if (s.wall && s.main) { bad.push("the consoles screen and the games both showing"); }
  if (s.details && s.wall) { bad.push("details standing over the consoles screen"); }
  if (s.details && s.main) { bad.push("details and the games view both showing"); }
  if (s.settings && s.editor) { bad.push("Settings and an editor open at once"); }
  if (s.menus > 1) { bad.push(s.menus + " menus open at once"); }
  if (s.confirms > 1) { bad.push(s.confirms + " questions open at once"); }
  if (s.toolbar && !s.main) { bad.push("the menu bar without the games view under it"); }
  if (s.sidebar && !s.main) { bad.push("the platform sidebar without the games view"); }
  if (s.picker && !s.main) { bad.push("the column picker without the list"); }
  if (s.consolesBtn && s.wall) { bad.push("the back arrow on the consoles screen"); }
  if (s.fanpage && (s.wall || s.main)) { bad.push("the Fan projects page and another screen both showing"); }
  if (s.extpage && (s.wall || s.main || s.fanpage)) { bad.push("the Extensions page and another screen both showing"); }
  if (!s.wall && !s.main && !s.details && !s.fanpage && !s.extpage && document.getElementById("count").textContent !== "") { bad.push("nothing on screen: no consoles, no games, no details"); }
  return bad;
})()`;

function chromePath() {
  const c = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].find((p) => fs.existsSync(p));
  if (!c) { throw new Error("no Chrome or Edge found"); }
  return c;
}

// Even: the odd port above a run's server is its fast lane's (sandbox.js), and a browser must never sit on one.
function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p % 2 ? freePort() : p)); });
  });
}

/** The API, from outside the page (the Origin header is what the guard wants). */
async function api(pathname, body, method) {
  const r = await fetch(BASE + "/" + pathname, {
    method: method || (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch (e) { return { ok: false, error: "not JSON: " + text.slice(0, 120), status: r.status }; }
}

/* Is the ROM drive there? Some checks are about games whose FILE is missing,
   and with the whole ROM folder unplugged Xsegon rightly refuses to call every
   game missing; those checks then step aside with a line saying so. Read from
   Settings > Paths > ROM folder, on the test copy. */
let romDriveSeen = null;
async function romDrive() {
  if (romDriveSeen) { return romDriveSeen; }
  const s = await api("api/settings.php");
  const root = (((s && s.settings) || {}).paths || {}).romRoot || "";
  romDriveSeen = { root, up: root !== "" && fs.existsSync(root) };
  return romDriveSeen;
}

/** One browser for the whole run. */
class Browser {
  async start() {
    this.port = await freePort();
    this.profile = path.join(OUT, "profile-" + process.pid);
    fs.rmSync(this.profile, { recursive: true, force: true });
    /* Profiles of runs that are gone: Chrome can still hold files when a
       run removes its own, and a stopped run never tries. Only dead runs'
       ones, never a live run's. */
    for (const name of fs.readdirSync(OUT)) {
      const m = /^profile-(\d+)$/.exec(name);
      if (!m || Number(m[1]) === process.pid) { continue; }
      try { process.kill(Number(m[1]), 0); continue; } catch (e) { if (e.code === "EPERM") { continue; } }
      try { fs.rmSync(path.join(OUT, name), { recursive: true, force: true, maxRetries: 3 }); } catch (e) { /* still held: next run */ }
    }
    this.proc = spawn(chromePath(), [
      "--headless=new", "--remote-debugging-port=" + this.port, "--user-data-dir=" + this.profile,
      "--window-size=1920,1200", "--mute-audio", "--autoplay-policy=no-user-gesture-required", "about:blank",
    ], { stdio: "ignore" });
    let targets;
    for (let i = 0; i < 60; i++) {
      try { targets = await (await fetch("http://127.0.0.1:" + this.port + "/json")).json(); break; } catch (e) { await sleep(250); }
    }
    if (!targets) { throw new Error("Chrome did not answer on its debug port"); }
    this.ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((r) => (this.ws.onopen = r));
    this.id = 0; this.pending = {}; this.errors = []; this.dialogs = []; this.screenFaults = [];
    /* The browser's own console, kept for the failure report and NOT turned
       into failures: a module that cannot be fetched stops the page cold and
       throws nothing, so it never reaches `errors`. Kept out of the checks
       because some 404s are by design (a console with no icon in the pack). */
    this.consoleLog = [];
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.pending[d.id]) { this.pending[d.id](d); delete this.pending[d.id]; return; }
      if (d.method === "Log.entryAdded" && /error|warning/.test(d.params.entry.level)) {
        this.consoleLog.push(new Date().toISOString().slice(11, 23) + " " + d.params.entry.level + ": " +
          d.params.entry.text.slice(0, 200) + (d.params.entry.url ? " (" + d.params.entry.url.replace(BASE, "") + ")" : ""));
        if (this.consoleLog.length > 40) { this.consoleLog.shift(); }
      }
      /* A fault the page caught itself (log.js, bug()) throws nothing, so it
         is read off the console instead: "[xs BUG]" is always a failure. */
      if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
        const text = (d.params.args || []).map((a) => a.value !== undefined ? String(a.value) : "").join(" ");
        if (text.indexOf("[xs BUG]") === 0) { this.errors.push(text.slice(0, 400)); }
      }
      if (d.method === "Runtime.exceptionThrown") {
        // the error's own words first: the whole report, cut short, can stop
        // before the part that says what it was
        const x = d.params.exceptionDetails || {};
        this.errors.push(((x.exception && x.exception.description) || x.text || "") + " | " + JSON.stringify(x).slice(0, 200));
      }
      if (d.method === "Page.javascriptDialogOpening") { this.dialogs.push(d.params.message); this.send("Page.handleJavaScriptDialog", { accept: true }); }
    };
    await this.send("Runtime.enable"); await this.send("Page.enable"); await this.send("Log.enable");
    /* The page may never start a real emulator from a test: the sandbox
       protects the DATA, but its copied library points at the real ROMs and
       emulators. So every page launch (Enter on a game) carries dry: true, and
       the server answers with the command it WOULD have run, so the flows keep
       their meaning and nothing opens. Node-side calls say dry themselves.
       Injected on every navigation, so no goto() can shed it. */
    await this.send("Page.addScriptToEvaluateOnNewDocument", { source:
      '(() => { const real = window.fetch; window.fetch = function (u, o) { try {' +
      ' if (String(u).indexOf("api/launch.php") !== -1 && o && typeof o.body === "string") {' +
      ' const b = JSON.parse(o.body); if (!b.dry) { b.dry = true; o = Object.assign({}, o, { body: JSON.stringify(b) }); } }' +
      ' } catch (e) { /* not a JSON launch: let it pass */ }' +
      ' return real.call(this, u, o); }; })();' });
    /* The suite reads the same answer on every machine, whatever its Windows
       "Animation effects" switch says: headless Chrome hands that switch to
       the page as prefers-reduced-motion, and the stylesheet changes under it
       (.row.sel steps forward, entrance animations run full length), so
       reduce is pinned. */
    await this.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  }
  send(method, params = {}) {
    return new Promise((r) => { const i = ++this.id; this.pending[i] = r; this.ws.send(JSON.stringify({ id: i, method, params })); });
  }
  /** Evaluate in the page; promises are awaited; the value comes back. */
  async ev(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) { throw new Error("in page: " + (r.result.exceptionDetails.exception || {}).description); }
    return r.result.result.value;
  }
  /** Navigate, and wait for the app to be up rather than for a clock.
   *
   *  The old document is marked before leaving so the wait cannot be
   *  satisfied by the page we are leaving; the new one is ready when the
   *  toolbar's count has been written (after the first library load and
   *  render), or, with no count (play.php), when it has loaded. Never throws:
   *  a navigation is the one moment the page has no context to evaluate in. */
  async goto(url, opts) {
    const target = url || BASE + "/";
    /* The app's own page opens the way every test was written against it:
       Systems first, on a wheel. List and Grid open on every game, and
       setView("grid") SAVES Grid, so a test pressing Enter after the next goto
       expecting a console would launch a game. keepView is for a test that
       set the view on purpose just before. */
    if (!(opts && opts.keepView) && new URL(target).pathname === "/") {
      await api("api/settings.php", { view: { default: "wheel", systemsFirst: true, systemsStyle: "wheel" } });
    }
    try { await this.ev(`window.__xsLeaving = true`); } catch (e) { /* no page yet */ }
    await this.send("Page.navigate", { url: target });
    await this.waitQuiet(`!window.__xsLeaving && document.readyState === "complete"`, 10000);
    await this.waitQuiet(`!document.getElementById("count") || document.getElementById("count").textContent !== ""`, 10000);
    // A start drawn from the copy kept last time (js/bootcopy.js) is not read
    // until the fresh library has been dealt with: it may be about to change.
    await this.waitQuiet(`!window.XSEGON || window.XSEGON.libraryFresh !== false`, 10000);
    await this.settled();                 // the arrive and settle animations (220ms)
    await this.screenCheck("after opening " + target.replace(BASE, ""));
  }
  /** The window rules (SCREEN_RULES), checked where the page has settled.
      A broken rule is kept with what had just been done, and the runner
      fails the group on it: "windows open only when they should". */
  async screenCheck(when) {
    let bad = [];
    try { bad = await this.ev(SCREEN_RULES); } catch (e) { return; }
    for (const b of bad || []) {
      const line = b + " (" + when + ")";
      if (this.screenFaults.indexOf(line) < 0) { this.screenFaults.push(line); }
    }
  }
  /** waitFor that treats "no page to ask" as "not yet". */
  async waitQuiet(expression, ms) {
    const until = Date.now() + ms;
    for (;;) {
      let v = false;
      try { v = await this.ev(expression); } catch (e) { v = false; }
      if (v) { return true; }
      if (Date.now() > until) { return false; }
      await tick(30);
    }
  }
  /** Until the page has stopped moving: two frames for whatever the last
      press set going, then no CSS animation or transition still running
      (endless ones, a spinner or a pulse, do not count) and nothing held by
      the fast-scroll hysteresis (views.js, settle: .holding, 190ms).
      Capped, because a page that never stops must not stop the run. */
  async settled(ms = 1000) {
    const until = Date.now() + ms;
    try { await this.ev(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`); } catch (e) { /* no page */ }
    for (;;) {
      let busy = false;
      try {
        busy = await this.ev(`!!document.querySelector(".holding") || document.getAnimations().some((a) => a.playState === "running" && a.effect && a.effect.getComputedTiming().iterations !== Infinity)`);
      } catch (e) { busy = false; }
      if (!busy || Date.now() > until) { return; }
      await tick(30);
    }
  }
  async key(k) {
    const VK = { Enter: 13, Escape: 27, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, " ": 32, e: 69, c: 67, g: 71, PageDown: 34, PageUp: 33 };
    for (const type of ["keyDown", "keyUp"]) {
      await this.send("Input.dispatchKeyEvent", { type, key: k, code: k, windowsVirtualKeyCode: VK[k] || 0, text: k.length === 1 ? k : undefined });
    }
  }
  async click(x, y) {
    for (const type of ["mousePressed", "mouseReleased"]) { await this.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); }
  }
  /** Hold the button down at one point and let go at another, the way a
      selection that runs past the edge of a panel does. */
  async drag(x1, y1, x2, y2) {
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: x1, y: y1, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x2, y: y2, button: "left", buttons: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x2, y: y2, button: "left", clickCount: 1 });
  }
  /** Drag an element sideways by dx, in steps, the way a hand does.
   *
   *  One jump from press to release is enough for a drag that only reads
   *  where it ended. A column resize follows the pointer, so it needs
   *  moves in between, and they must land while the button is down.
   */
  async dragBy(sel, dx) {
    const p = await this.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
      if (!e) { return null; } const r = e.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (!p) { throw new Error("nothing to drag at " + sel); }
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "none", buttons: 0 });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 6; i++) {
      await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x + Math.round(dx * i / 6), y: p.y, button: "left", buttons: 1 });
      await sleep(30);
    }
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x + dx, y: p.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(500);
  }
  /** Two presses in the same place, for a grip that resets on the second. */
  async doubleClickSel(sel) {
    const p = await this.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
      if (!e) { return null; } const r = e.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (!p) { throw new Error("nothing to press at " + sel); }
    for (const clickCount of [1, 2]) {
      await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", buttons: 1, clickCount });
      await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", buttons: 0, clickCount });
    }
    await sleep(600);
  }
  /** The two halves apart, for what happens between them. */
  async moveTo(x, y) { await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 }); }
  async pressAt(x, y) { await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); }
  async releaseAt(x, y) { await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); }
  /** Click the centre of the first element the selector finds. */
  async clickSel(sel) {
    const r = await this.ev(`(r => r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null)((document.querySelector(${JSON.stringify(sel)}) || {}).getBoundingClientRect && document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`);
    if (!r) { throw new Error("nothing matches " + sel); }
    await this.click(r.x, r.y);
  }
  /** Right-click a game node: dispatched, because a rotated rim's centre can be off screen. */
  async contextMenu(sel) {
    await this.ev(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 700, clientY: 450 }))`);
    await this.waitFor(`!!document.querySelector(".ctx")`, 3000);     // the menu is up
  }
  /** Press a menu entry. The press closes the menu it is on, so that is what
      is waited for; the entry's own work is the test's to wait on. A group's
      row (Emulation) closes nothing: its box opens beside it, and that is
      waited for. */
  async menuItem(re) {
    const ok = await this.ev(`(n => { if (!n) return false; if (n.classList.contains("has-sub")) { n.click(); return "group"; } document.querySelector(".ctx").__pressed = true; n.click(); return true; })([...document.querySelectorAll(".ctx-item")].find(n => ${re}.test((n.querySelector(".ctx-label") || n).textContent)))`);
    if (!ok) { throw new Error("no menu entry matching " + re); }
    if (ok === "group") { await this.waitFor(`!!document.querySelector(".ctx.ctx-sub .ctx-item")`, 3000); await this.settled(); return; }
    await this.waitFor(`(c => !c || !c.__pressed)(document.querySelector(".ctx"))`, 3000);
    await this.settled();
    await this.screenCheck("after the menu entry " + re);
  }
  /** A menu entry that may be one level down.
   *
   *  The game menu folds two groups (Emulation, Show in Explorer). This
   *  clicks the entry wherever it is: on the top level if it is there,
   *  otherwise it opens the named group's box first, so tests say what they
   *  mean ("pick Set Core") instead of encoding the menu's shape.
   */
  async menuDeep(re, groupRe) {
    const here = `[...document.querySelectorAll(".ctx-item")].find(n => ${re}.test((n.querySelector(".ctx-label") || n).textContent))`;
    if (await this.ev(`!!(${here})`)) { return this.menuItem(re); }
    if (!groupRe) { throw new Error("no menu entry matching " + re); }
    await this.menuItem(groupRe);
    return this.menuItem(re);
  }
  /** The + button, then the by-hand road out of its chooser.
   *
   *  + asks which kind of adding first. Tests that want the form say so here
   *  rather than each one knowing the chooser is in the way.
   */
  async addByHand() {
    await this.clickSel("#btn-add");
    await this.waitFor(`(document.querySelector("#editor .panel-title") || {}).textContent === "ADD GAMES"`, 8000);
    await this.ev(`[...document.querySelectorAll("#editor .add-big")].find(x => /by hand/.test(x.textContent)).click()`);
    await this.waitFor(`/ADD A GAME OF YOUR OWN/.test((document.querySelector("#editor .panel-title") || {}).textContent || "")`, 8000);
    await this.settled();
  }
  async openBar(menu) {
    await this.clickSel('#mb [data-menu="' + menu + '"]');
    await this.waitFor(`!!document.querySelector(".ctx")`, 3000);
  }
  /** The Filter by window (js\filterwin.js), from the funnel in the search box. */
  async openFilters() {
    await this.clickSel("#btn-filter");
    await this.waitFor(FILTERS_UP, 3000);
    await this.settled();
  }
  /** Press a row of the Filter by window, by its name. The row is what is pressed: its switch only shows how it stands. */
  async filterRow(name) {
    const ok = await this.ev(`(n => { if (!n) { return false; } n.click(); return true; })([...document.querySelectorAll("#editor .flt-inner .opt")].find(n => n.querySelector("label").firstChild.textContent === ${JSON.stringify(name)}))`);
    if (!ok) { throw new Error("no row of the Filter by window named " + name); }
    await this.settled();
  }
  /** Select or deselect one of your tags in the Filter by window: on its own button, or in the list of the
      rest where six others have more games. Answers where it was and the count it showed; the list is put away. */
  async filterTag(name) {
    const own = `[...document.querySelectorAll("#editor .flt-inner .flt-tag[data-tag]")].find(n => n.dataset.tag === ${JSON.stringify(name)})`;
    if (await this.ev(`!!(${own})`)) {
      const n = await this.ev(`(b => { const n = b.querySelector(".flt-tag-n").textContent; b.click(); return n; })(${own})`);
      await this.settled();
      return { where: "button", count: n };
    }
    if (!(await this.ev(`(b => { if (!b) { return false; } b.click(); return true; })(document.querySelector("#editor .flt-inner .flt-more"))`))) { throw new Error("the Filter by window has no tag named " + name); }
    await this.waitFor(`(document.querySelector(".ctx .ctx-title") || {}).textContent === "More of your tags"`, 3000);
    const n = await this.ev(`(r => r ? (r.querySelector(".ctx-hint") || {}).textContent : null)([...document.querySelectorAll(".ctx-item")].find(x => x.querySelector(".ctx-label").textContent === ${JSON.stringify(name)}))`);
    await this.menuItem(new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
    await this.key("Escape");                // the list stays up while you select: put away, the window is left
    await this.waitFor(`!document.querySelector(".ctx")`, 3000);
    return { where: "list", count: n };
  }
  /** Wait for something in the page to become true. For anything that waits on
      a request: this server answers one at a time, so a fixed sleep that is
      long enough alone can be too short in a full run. */
  async waitFor(expression, ms = 8000) {
    const until = Date.now() + ms, t0 = Date.now();
    for (;;) {
      if (await this.ev(expression)) { noteWait(t0, expression); return true; }
      if (Date.now() > until) { noteWait(t0, "RAN OUT: " + expression); return false; }
      await tick(30);
    }
  }
  /** The value of `expression` once it is what the check wants, or what it
      still was when the time ran out. For the check straight after a press:
      `check(name, await b.until(expr, want), want)` goes on the moment the
      page gets there, where a fixed sleep always paid its full length, and a
      check that would fail still fails, with the real value, just later.
      NOT for "nothing changed" checks: those have nothing to wait for and
      keep their sleep. With no `want`, any truthy value will do. */
  async until(expression, want, ms = 4000) {
    const until = Date.now() + ms, t0 = Date.now();
    const good = (v) => want === undefined ? !!v : JSON.stringify(v) === JSON.stringify(want);
    for (;;) {
      let v;
      try { v = await this.ev(expression); } catch (e) { v = undefined; }
      if (good(v)) { noteWait(t0, expression); return v; }
      if (Date.now() > until) { noteWait(t0, "RAN OUT: " + expression); return v; }
      await tick(30);
    }
  }
  /** Choose a view, and wait for it to be drawn: the view box wears the
      view's class once render() has run. On the consoles screen choosing a
      view goes back to the wall instead, so that counts as done too. */
  async setView(v) {
    await this.ev(`(() => { const s = document.getElementById("viewsel"); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    const cls = { list: "list", grid: "grid", wheel: "wheelbox", carousel: "gcarousel", rows: "rowsview" }[v] || v;
    await this.waitFor(`document.getElementById("viewsel").value === ${JSON.stringify(v)} && (!document.getElementById("syswall").hidden || document.getElementById("view").classList.contains(${JSON.stringify(cls)}))`, 5000);
    await this.settled();                 // xs-settle, 220ms
    await this.screenCheck("after choosing the view " + v);
  }
  /** Enter on the consoles screen: the chosen console opens, and this waits
      for it to be up. */
  async enterConsole() {
    await this.key("Enter");
    await this.waitFor(`document.getElementById("syswall").hidden && !document.getElementById("main").hidden && !!document.querySelector("#view > *") && document.getElementById("count").textContent !== ""`, 10000);
    await this.settled();
    await this.screenCheck("after Enter on a console");
  }
  /** From the consoles screen, open a platform by name. */
  async openPlatform(name) {
    // Choosing grid or list on the wall opens the whole library, so the
    // wall may not be up: go back to it first, the way you would.
    if (await this.ev(`document.getElementById("syswall").hidden`)) {
      await this.key("Escape");
      await this.waitFor(`!document.getElementById("syswall").hidden && document.querySelectorAll("#syswall .sel").length > 0`, 5000);
      await this.settled();                // the wall's arrival, before its positions are read
    }
    /* Walk from wherever the rim is now to the target, then Enter. The
       presses go in one after another and the rim is then waited for: every
       press moves the rim by one as it arrives, and a press the page dropped
       is made up by a second pass rather than a longer sleep. */
    const pos = `(() => { const all = [...document.querySelectorAll("#syswall .switem, #syswall .syscard")]; const names = all.map(x => ((x.querySelector("img")||{}).alt || "") + "|" + x.textContent); return { at: all.findIndex(x => x.classList.contains("sel")), want: names.findIndex(t => t.includes(${JSON.stringify(name)})) }; })()`;
    let q = await this.ev(pos);
    if (q.want < 0) { throw new Error("no console called " + name); }
    for (let pass = 0; pass < 3 && q.at !== q.want; pass++) {
      const steps = q.want - q.at;
      for (let i = 0; i < Math.abs(steps); i++) { await this.key(steps > 0 ? "ArrowRight" : "ArrowLeft"); }
      await this.waitFor(`(p => p.at === p.want)(${pos})`, 1500);
      q = await this.ev(pos);
    }
    if (q.at !== q.want) { throw new Error("rim landed on " + q.at + ", wanted " + q.want); }
    await this.settled();
    // Enter asks for that platform's games. The view's first child is marked
    // before the press so the wait cannot be met by what was drawn before;
    // render() rebuilds the children, so a fresh first child IS the answer.
    await this.ev(`(n => { if (n) { n.__old = true; } })(document.querySelector("#view > *"))`);
    await this.key("Enter");
    // A collection's value is its key (@players), so its words count too:
    // the value alone never matches its name.
    await this.waitFor(`(s => s.value === ${JSON.stringify(name)} || ((s.selectedOptions[0] || {}).textContent || "").indexOf(${JSON.stringify(name)}) >= 0)(document.getElementById("platform")) && !document.getElementById("main").hidden && (n => !!n && !n.__old)(document.querySelector("#view > *"))`, 10000);
    await this.settled();
    await this.screenCheck("after opening the console " + name);
  }
  async shot(name) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(r.result.data, "base64"));
  }
  async stop() {
    try { this.ws.close(); } catch (e) { /* gone */ }
    try { this.proc.kill(); } catch (e) { /* gone */ }
    await sleep(500);
    try { fs.rmSync(this.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { /* the next run sweeps it */ }
  }
}

/** Snapshot the data files a run may touch; put them back afterwards. */
class Guard {
  constructor(names) { this.saved = {}; for (const n of names) { const p = path.join(DATA, n); this.saved[n] = fs.existsSync(p) ? fs.readFileSync(p) : null; } }
  /* Each file on its own: this is the last thing that runs, and one that
     throws must not take the rest of the restore with it. The writes group
     puts a FOLDER where a data file belongs, so that is survived too. */
  restore() {
    const failed = [];
    for (const n of Object.keys(this.saved)) {
      const p = path.join(DATA, n);
      try {
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) { fs.rmSync(p, { recursive: true, force: true }); }
        fs.rmSync(p + ".tmp", { force: true });
        if (this.saved[n] === null) { fs.rmSync(p, { force: true }); } else { fs.writeFileSync(p, this.saved[n]); }
      } catch (e) { failed.push(n + " (" + e.code + ")"); }
    }
    if (failed.length) { console.log("!! could not put back: " + failed.join(", ")); }
    return failed;
  }
}

/** The check itself: every test is a list of these. */
function makeCheck(report) {
  return function check(name, got, want) {
    const ok = want === undefined ? !!got : JSON.stringify(got) === JSON.stringify(want);
    report.push({ name, ok, got: ok ? undefined : got, want: ok ? undefined : want });
    return ok;
  };
}

/* Ask again every 60 ms until fn() answers something truthy, or ms runs out
   (then its last answer). For the server's side of a change the page made. */
async function apiUntil(fn, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v || Date.now() > end) { return v; } await new Promise((r) => setTimeout(r, 60)); }
}

module.exports = { BASE, ROOT, DATA, OUT, SCREENS, SCREEN_RULES, FILTERS_UP, sleep, sleepBill, api, apiUntil, romDrive, Browser, Guard, makeCheck, useTarget };
