/*  Games > Games you do not have: the wanted list.
 *
 *  Every game the Games Database has for a console, without the ones in your
 *  library. A star puts a game on your wanted list (data\wanted.json, kept in
 *  a backup); Export writes the starred ones to a file a spreadsheet opens.
 *  A shopping list and nothing more: nothing here downloads a game, links to
 *  one or says where to find one. A console can have thousands of games on
 *  record, so rows are drawn a couple of hundred at a time as they come into view.
 */

import { setEditorOnClose, toolFrame } from "./editors.js";
import { pick, showStrip } from "./launch.js";
import { load } from "./library.js";
import { L, api, postJson } from "./log.js";
import { sound } from "./sound.js";
import { $editor } from "./state.js";
import { el, stars } from "./util.js";

var CHUNK = 200;
var KEEP = "xs-wanted-console";

export function openWantedTool() {
  L("ED", "games you do not have");
  var consoles = [], console_ = "", all = [], wanted = {};
  var show = { q: "", sort: "title", starred: false, have: false, extras: false };
  var rowsBox = null, countLine = null, moreBtn = null, drawn = 0, list = [], watcher = null;

  function remember(name) { try { localStorage.setItem(KEEP, name); } catch (e) { /* private window */ } }
  function remembered() { try { return localStorage.getItem(KEEP) || ""; } catch (e) { return ""; } }

  function shell() {
    var inner = toolFrame("GAMES YOU DO NOT HAVE");
    $editor.appendChild(inner);
    $editor.hidden = false;
    return inner;
  }

  /* What is listed: a released game unless the extras are asked for, not one
     you have unless asked, matching what is typed, starred only if asked. */
  function narrowed() {
    var q = show.q.toLowerCase();
    var out = all.filter(function (g) {
      if (show.starred && !wanted[g.id]) { return false; }
      if (!show.have && g.have) { return false; }
      if (!show.extras && g.type && g.type !== "Released") { return false; }
      return !q || g.title.toLowerCase().indexOf(q) >= 0;
    });
    if (show.sort === "rating") { out.sort(function (a, b) { return b.rating - a.rating || b.votes - a.votes || a.title.localeCompare(b.title); }); }
    else if (show.sort === "year") { out.sort(function (a, b) { return (a.year || "9999").localeCompare(b.year || "9999") || a.title.localeCompare(b.title); }); }
    return out;
  }

  function star(g, btn, rowEl) {
    var want = !wanted[g.id];
    wanted[g.id] = want;                         // at once; put back if the save fails
    paintStar(g, btn, rowEl);
    postJson("api/wanted.php", { id: g.id, want: want, title: g.title, platform: console_, year: g.year })
      .then(function (r) {
        if (r.ok) { sound("select"); paintCount(); return; }
        wanted[g.id] = !want;
        paintStar(g, btn, rowEl);
        showStrip("could not save that star: " + (r.error || "no answer"), true);
      });
  }

  function paintStar(g, btn, rowEl) {
    btn.textContent = wanted[g.id] ? "★" : "☆";
    btn.title = wanted[g.id] ? "On your wanted list. Press to take it off" : "Put it on your wanted list";
    btn.setAttribute("aria-pressed", wanted[g.id] ? "true" : "false");
    rowEl.classList.toggle("wanted", !!wanted[g.id]);
  }

  function rowFor(g) {
    var rowEl = el("div", "sc-row want-row" + (g.have ? " have" : ""));
    var btn = el("button", "want-star");
    btn.addEventListener("click", function () { star(g, btn, rowEl); });
    rowEl.appendChild(btn);
    rowEl.appendChild(el("span", "sc-title", g.title));
    var bits = [];
    if (g.year) { bits.push(g.year); }
    if (g.genres) { bits.push(g.genres.split(";").slice(0, 2).join(", ")); }
    if (g.developer) { bits.push(g.developer); }
    if (g.players > 1) { bits.push(g.players + " players"); }
    if (g.rating) { bits.push(g.rating.toFixed(1) + " of 5 (" + g.votes + (g.votes === 1 ? " vote)" : " votes)")); }
    if (g.type && g.type !== "Released") { bits.push(g.type); }
    rowEl.appendChild(el("span", "want-meta", bits.join("  ·  ")));
    if (g.have) { rowEl.appendChild(el("span", "want-have", "you have it")); }
    paintStar(g, btn, rowEl);
    return rowEl;
  }

  function drawMore() {
    if (!rowsBox) { return; }
    var end = Math.min(list.length, drawn + CHUNK);
    for (; drawn < end; drawn++) { rowsBox.appendChild(rowFor(list[drawn])); }
    moreBtn.hidden = drawn >= list.length;
  }

  function paintCount() {
    if (!countLine) { return; }
    var total = all.filter(function (g) { return show.extras || !g.type || g.type === "Released"; });
    var have = total.filter(function (g) { return g.have; }).length;
    var stars = all.filter(function (g) { return wanted[g.id]; }).length;
    countLine.textContent = list.length + " listed.  " + console_ + ": " + total.length + " on record, you have " + have +
      ", " + stars + " starred here.";
  }

  function repaint() {
    list = narrowed();
    drawn = 0;
    rowsBox.textContent = "";
    drawMore();
    paintCount();
  }

  function check(label, key) {
    var lab = el("label", "want-check");
    var c = el("input");
    c.type = "checkbox";
    c.checked = show[key];
    c.addEventListener("change", function () { show[key] = c.checked; repaint(); });
    lab.appendChild(c);
    lab.appendChild(el("span", null, label));
    return lab;
  }

  function exportAs(kind, onlyHere) {
    var a = el("a");
    a.href = "api/wanted.php?export=" + kind + (onlyHere ? "&platform=" + encodeURIComponent(console_) : "");
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    L("ED", "wanted list exported as " + kind + (onlyHere ? " (" + console_ + ")" : ""));
    showStrip("Your wanted list is saved in your Downloads folder as xsegon-wanted-" + new Date().toISOString().slice(0, 10) + "." + kind, false);
  }

  function paint() {
    var inner = shell();
    inner.appendChild(el("p", "group-help",
      "Every game on record for a console, without the ones in your library. Star the ones you want, " +
      "then export the starred ones as a list to keep outside Xsegon. This is a list only: nothing is downloaded or looked for."));

    var bar = el("div", "want-bar");
    var pick = el("select", "want-console");
    var mineOver = false;
    consoles.forEach(function (c) {
      if (!c.yours && !mineOver && consoles[0].yours) {
        mineOver = true;
        var sep = el("option", null, "(consoles you have no games for)");
        sep.disabled = true;
        pick.appendChild(sep);
      }
      var o = el("option", null, c.name + "  (" + c.games + (c.starred ? ", " + c.starred + " starred" : "") + ")");
      o.value = c.name;
      pick.appendChild(o);
    });
    pick.value = console_;
    pick.addEventListener("change", function () { load(pick.value); });
    bar.appendChild(pick);

    var find = el("input", "want-find");
    find.type = "search";
    find.placeholder = "find a game";
    find.value = show.q;
    find.addEventListener("input", function () { show.q = find.value.trim(); repaint(); });
    bar.appendChild(find);

    var sort = el("select", "want-sort");
    [["title", "By name"], ["rating", "Best rated first"], ["year", "Oldest first"]].forEach(function (s) {
      var o = el("option", null, s[1]);
      o.value = s[0];
      sort.appendChild(o);
    });
    sort.value = show.sort;
    sort.addEventListener("change", function () { show.sort = sort.value; repaint(); });
    bar.appendChild(sort);
    inner.appendChild(bar);

    var checks = el("div", "want-bar");
    checks.appendChild(check("Only starred", "starred"));
    checks.appendChild(check("Show the ones I have too", "have"));
    checks.appendChild(check("Also hacks, homebrew and unreleased", "extras"));
    inner.appendChild(checks);

    var btns = el("div", "art-btns");
    [["csv", false, "Export starred (spreadsheet)"], ["txt", false, "Export starred (plain text)"],
     ["csv", true, "Only this console (spreadsheet)"]].forEach(function (b) {
      var x = el("button", null, b[2]);
      x.addEventListener("click", function () { exportAs(b[0], b[1]); });
      btns.appendChild(x);
    });
    inner.appendChild(btns);

    countLine = el("p", "mt-note");
    inner.appendChild(countLine);
    rowsBox = el("div", "sc-rows want-rows");
    inner.appendChild(rowsBox);
    moreBtn = el("button", "want-more", "Show more");
    moreBtn.addEventListener("click", drawMore);
    inner.appendChild(moreBtn);
    if (watcher) { watcher.disconnect(); }
    if (window.IntersectionObserver) {
      watcher = new IntersectionObserver(function (seen) {
        if (seen.some(function (s) { return s.isIntersecting; })) { drawMore(); }
      }, { rootMargin: "600px" });
      watcher.observe(moreBtn);
    }
    repaint();
  }

  function load(name) {
    console_ = name;
    remember(name);
    var inner = shell();
    inner.appendChild(el("p", "mt-note", "Reading every game on record for " + name + "..."));
    return api("api/wanted.php?platform=" + encodeURIComponent(name)).then(function (res) {
      if ($editor.dataset.tool !== "wanted") { return; }
      if (!res.ok) {
        var again = shell();
        again.appendChild(el("p", "mt-note bad", res.error || "could not read the list"));
        return;
      }
      all = res.games || [];
      wanted = {};
      (res.wanted || []).forEach(function (id) { wanted[id] = true; });
      paint();
    });
  }

  $editor.dataset.tool = "wanted";
  setEditorOnClose(function () {
    if (watcher) { watcher.disconnect(); watcher = null; }
    delete $editor.dataset.tool;
  });
  var first = shell();
  first.appendChild(el("p", "mt-note", "Reading the consoles on record..."));
  api("api/wanted.php").then(function (res) {
    if ($editor.dataset.tool !== "wanted") { return; }
    if (!res.ok) {
      var bad = shell();
      bad.appendChild(el("p", "mt-note bad", res.error || "could not read the Games Database"));
      return;
    }
    consoles = res.platforms || [];
    if (!consoles.length) {
      shell().appendChild(el("p", "mt-note bad", "The Games Database has no consoles in it."));
      return;
    }
    var was = remembered();
    var start = consoles.filter(function (c) { return c.name === was; })[0] || consoles[0];
    load(start.name).then(function () { sound("select"); });
  });
}
