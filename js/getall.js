/*  Get Media > Get Everything (roadmap BL2, includes\getall.php): one press that fetches
 *  what the games lack from every source at once, each with its bar in the corner. With a
 *  ScreenScraper account, each kind has where it comes from beside it, kept the moment it is
 *  chosen (library.getPictures, getVideos, getManuals); without one, the free sources alone.
 *  Laid out as Get Media is, so the keys and a controller walk it the same way.
 */

import { closeEditor, toolFrame } from "./editors.js";
import { fillWatch } from "./fillbar.js";
import { iconEl } from "./icons.js";
import { jobsWatch } from "./jobbars.js";
import { showStrip } from "./launch.js";
import { L, api, postJson } from "./log.js";
import { saveSetting } from "./savednote.js";
import { openScreenScraper } from "./screenscraper.js";
import { stopVideo } from "./snap.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { el, plural } from "./util.js";

// Each kind: its setting, what the free sources are (its tooltip), and what is missing.
var KINDS = [
  { kind: "pictures", key: "getPictures", label: "Pictures", icon: "wand",
    free: function (r) { return "Free: Get Pictures, from " + (r.pictures === "libretro" ? "libretro" : "the LaunchBox Games Database") + ". ScreenScraper brings covers."; },
    lack: function (n) { return n.noCover ? plural(n.noCover, "game", "games") + " with no cover" : "every game has a cover"; } },
  { kind: "videos", key: "getVideos", label: "Videos", icon: "film",
    free: function () { return "Free: Steam trailers, and Videos from online archives (the Arcade Database for arcade games)."; },
    lack: function (n) { return n.noVideo ? plural(n.noVideo, "game", "games") + " with no video" : "every game has a video"; } },
  { kind: "manuals", key: "getManuals", label: "Manuals", icon: "book",
    free: function () { return "Free: Manuals from online archives."; },
    lack: function (n) { return n.noManual ? plural(n.noManual, "game", "games") + " with no manual" : "every game has a manual"; } }
];
var WAYS = [["free-ss", "Free sources, then ScreenScraper"], ["free", "Free sources only"], ["ss", "ScreenScraper only"]];

function sect(body, name) {
  var box = body.appendChild(el("div", "set-sect")), head = box.appendChild(el("div", "sect-head"));
  head.appendChild(el("span", "sect-name", name));
  return box;
}

function line(box, icon, label, tip) {
  var n = box.appendChild(el("div", "opt link-row")), right = el("span", "su-right");
  if (tip) { n.title = tip; }
  n.appendChild(iconEl("opt-ico", icon));
  n.appendChild(el("label", null, label));
  n.appendChild(right);
  return right;
}

// Where one kind comes from: a choice with an account, kept at the press; the free sources without one.
function kindRow(box, k, res, counts) {
  var right = line(box, k.icon, k.label, k.free(res));
  right.appendChild(el("span", "su-note", counts ? k.lack(counts) : ""));
  if (!res.account) { right.appendChild(el("span", "su-note", "free sources")); return; }
  var choice = right.appendChild(el("select"));
  WAYS.forEach(function (w) {
    var o = choice.appendChild(el("option", null, w[1]));
    o.value = w[0];
    if (res.ways[k.kind] === w[0]) { o.selected = true; }
  });
  choice.addEventListener("change", function () {
    var patch = { library: {} };
    patch.library[k.key] = choice.value;
    L("ED", "get everything missing: " + k.kind + " from " + choice.value);
    saveSetting(patch, k.label + " from");
  });
}

function start() {
  postJson("api/getall.php", { start: true }).then(function (r) {
    if (!r.ok) { showStrip(r.error || "it could not be started", true); return; }
    var job = r.job, parts = job.parts.concat(job.ss ? [job.ss] : []);
    L("ED", "get everything missing started: " + parts.map(function (p) { return p.key + " " + p.state; }).join(", "));
    sound("ok");
    showStrip("fetching everything missing in the background: each source has its bar in the corner" +
      (job.ss && job.ss.state === "waiting" ? ", and ScreenScraper starts once the free sources are through" : ""), false);
    closeEditor();
    jobsWatch("getall");
    parts.forEach(function (p) {
      if (p.state !== "started" && p.state !== "running") { return; }
      if (p.key === "fill") { fillWatch(); } else { jobsWatch(p.key); }
    });
  });
}

function paint(inner, res, counts) {
  var body = inner.appendChild(el("div", "set-body")), atWork = !!res.job && res.job.state === "running";
  // A few short lines, not one block.
  var help = body.appendChild(el("ul", "ga-help"));
  (atWork ? ["It is at work: each source's bar in the corner shows how far it is.", "Get everything missing's own bar has Stop."]
    : ["Every source at once, in the background, with a bar for each in the corner.", "Nothing you have is replaced.",
       res.account ? "Free sources, then ScreenScraper asks ScreenScraper only for what the free ones could not find, which keeps your daily allowance."
                   : "Sign in to ScreenScraper to fetch from it too."]).forEach(function (w) { help.appendChild(el("li", null, w)); });
  var what = sect(body, "What comes, and from where");
  KINDS.forEach(function (k) { kindRow(what, k, res, counts); });
  var acc = sect(body, "ScreenScraper");
  var right = line(acc, "gear", res.account ? "Signed in as " + res.user : "Not signed in",
    "ScreenScraper counts each ask against your account's daily allowance. Its window has the sign-in.");
  right.appendChild(el("span", "su-note", res.account ? "" : "free sources only"));
  var open = right.appendChild(el("button", null, res.account ? "Open..." : "Sign in..."));
  open.type = "button";
  open.addEventListener("click", function () { L("ED", "get everything missing > ScreenScraper"); sound("select"); closeEditor(true); openScreenScraper(); });
  var go = line(sect(body, "Start"), "download", "Fetch everything missing", "The window closes; each source shows its own bar in the corner.");
  var btn = go.appendChild(el("button", null, "Start"));
  btn.type = "button";
  btn.disabled = atWork;
  btn.addEventListener("click", start);
}

export function openGetAll() {
  L("ED", "get everything missing");
  stopVideo();
  Promise.all([api("api/getall.php"), api("api/getmedia.php")]).then(function (got) {
    var res = got[0], counts = got[1] && got[1].ok ? got[1] : null;
    if (!res.ok) { showStrip(res.error || "could not ask what is missing", true); return; }
    var inner = toolFrame("GET EVERYTHING MISSING", { base: "set-inner", cls: "gm-inner" });
    paint(inner, res, counts);
    $editor.textContent = "";
    $editor.appendChild(inner);
    $editor.hidden = false;
    L("ED", "get everything missing: account " + (res.account ? "yes" : "no") + ", ways " + JSON.stringify(res.ways) + (res.job ? ", job " + res.job.state : ""));
  });
}
