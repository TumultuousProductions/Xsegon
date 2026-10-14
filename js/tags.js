/*  Tags of your own: short labels on any game, which Filter by narrows to. The
    server keeps them (api\tags.php); this is the Tags list on a game's
    right-click menu, the box for a new one, and keeping the rows in step.
    Every tag is a switch and the list stays up while you select, so three tags
    are three presses, on the keyboard or the pad. */

import { closeEditor, reloadKeeping, setEditorOnClose, toolFrame } from "./editors.js";
import { paintHero } from "./hero.js";
import { showStrip } from "./launch.js";
import { filters, setTagsAll, tagsAll } from "./library.js";
import { L, postJson } from "./log.js";
import { $ctx, ctxFocus, popupMenu } from "./menus.js";
import { sound } from "./sound.js";
import { $editor, $q, games, hasLaunchBox, sel } from "./state.js";
import { el } from "./util.js";

function hasTag(g, name) {
  var key = name.toLowerCase();
  return (g.tags || []).some(function (t) { return t.toLowerCase() === key; });
}

/* The Tags list for one game, at x, y (where its right-click menu was).
   at: the row to stand on, when it is drawn again after a press. done: told
   each change the server took (the runs check repaints its tile). */
export function openTagMenu(g, x, y, at, done) {
  var entries = tagsAll.map(function (t, i) {
    return { icon: "tag", label: t.name, hint: String(t.count), checked: hasTag(g, t.name),
             run: function () {
               var on = !hasTag(g, t.name);
               note(g, t.name, on);          // drawn again at once, selected or not
               openTagMenu(g, x, y, i, done);
               save(g, t.name, on, x, y, done);    // then told to the server
             } };
  });
  if (entries.length) { entries.push({ rule: true }); }
  entries.push({ icon: "plus", label: "New tag...", run: function () { openNewTag(g, x, y, done); } });
  popupMenu(entries, x, y, "Tags: " + g.title);
  $ctx.dataset.menu = "tags";
  if (at) { ctxFocus(at); }
}

/* The change, on the page, before the server has answered: the game's tags
   and the counts beside every tag. A tag whose last game lets go of it stays
   in the list at 0 until the next read, so it can be selected straight back. */
function note(g, name, on) {
  var key = name.toLowerCase();
  var list = (g.tags || []).filter(function (t) { return t.toLowerCase() !== key; });
  var known = null;
  tagsAll.forEach(function (t) { if (t.name.toLowerCase() === key) { known = t; } });
  if (on) { list.push(known ? known.name : name); }
  list.sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }); });
  apply(g, list);
  var all = tagsAll.map(function (t) {
    return t.name.toLowerCase() === key ? { name: t.name, count: Math.max(0, t.count + (on ? 1 : -1)) } : t;
  });
  if (!known && on) {
    all.push({ name: name, count: 1 });
    all.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }); });
  }
  setTagsAll(all);
}

// Every row for this game (the object the menu was opened on can be an
// older copy than the one on screen), and the info panel if it is showing it.
function apply(g, list) {
  g.tags = list;
  games.forEach(function (x) { if (x.id === g.id) { x.tags = list.slice(); } });
  if (games[sel] && games[sel].id === g.id) { paintHero(games[sel]); }
}

/* To the server. Its answer is the truth: the game's tags as filed (in the
   spelling the tag already had) and every tag's count. A refusal undoes the
   change on the page and says why. A filter by tag, or a search, can change
   which games are listed, so then the rows are read again; and "needs fix",
   which is the NEEDS FIX mark itself, redraws every card. */
function save(g, name, on, x, y, done) {
  var body = { id: g.id };
  body[on ? "add" : "remove"] = name;
  return postJson("api/tags.php", body).then(function (r) {
    if (!r.ok) {
      note(g, name, !on);
      showStrip("Tag not saved: " + (r.error || "the server said no"), true);
      if ($ctx && $ctx.dataset.menu === "tags") { openTagMenu(g, x, y, undefined, done); }
      return r;
    }
    apply(g, r.tags);
    setTagsAll(r.all);
    if (filters.tags.length || $q.value.trim() || name.toLowerCase() === "needs fix") { reloadKeeping(g.id); }
    if (done) { done(r); }
    return r;
  });
}

/* A new tag: a name and nothing else, put on this game at once. Esc, or
   Cancel, goes back without one. */
export function openNewTag(g, x, y, done) {
  L("ED", "new tag for " + g.title);
  setEditorOnClose(null);
  $editor.textContent = "";
  $editor.dataset.tool = "tag";

  var inner = toolFrame("NEW TAG", { close: "Cancel (esc)", keep: true });
  inner.appendChild(el("p", "group-help", "For " + g.title + ". A tag is yours: kept in Xsegon" + (hasLaunchBox ? " and never written into the imported library" : "") +
    ". Once a game carries it, Filter by (the funnel in the search box) lists it."));

  var rowEl = el("div", "opt ed-row");
  var label = el("label");
  label.appendChild(document.createTextNode("Name"));
  label.appendChild(el("span", "hint", "up to 24 characters"));
  var input = el("input");
  input.type = "text";
  input.maxLength = 24;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.placeholder = "Couch, Kids, Finish this...";
  rowEl.appendChild(label);
  rowEl.appendChild(input);
  inner.appendChild(rowEl);

  var foot = el("div", "set-foot");
  var add = el("button", "primary", "Add the tag");
  var err = el("span", "ed-err");
  function go() {
    var name = input.value.trim().replace(/\s+/g, " ");
    if (!name) { err.textContent = "a tag needs a name"; return; }
    if (hasTag(g, name)) { closeEditor(); openTagMenu(g, x, y, undefined, done); return; }
    add.disabled = true;
    note(g, name, true);                 // as a click does, so a refusal undoes it evenly
    save(g, name, true, x, y, done).then(function (r) {
      add.disabled = false;
      if (!r.ok) { err.textContent = r.error || "not saved"; return; }
      closeEditor();
      openTagMenu(g, x, y, undefined, done);
    });
  }
  add.addEventListener("click", go);
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } });
  foot.appendChild(add);
  foot.appendChild(err);
  inner.appendChild(foot);

  $editor.appendChild(inner);
  $editor.hidden = false;
  sound("select");
  setTimeout(function () { input.focus(); }, 30);
}
