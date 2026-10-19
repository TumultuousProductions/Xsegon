/*  Scan for Games: the files passed over because a game of the same name is
    in the library already (includes\scan.php, 'passed'): each is named with
    the file the library has, and can be added as another version of that game.
    And the files taken for no game at all ('junkFiles'), by ending. */

import { L, postJson } from "./log.js";
import { sound } from "./sound.js";
import { el, plural } from "./util.js";

function tailOf(p) { return String(p || "").split(/[\\\/]/).slice(-2).join("\\"); }

/* One line per ending, most first, a few names each; pointing at a line names every file. */
export function leftOutTail(inner, files) {
  if (!(files || []).length) { return; }
  var byEnd = {};
  files.forEach(function (f) {
    var name = String(f).split(/[\\\/]/).pop();
    var dot = name.lastIndexOf(".");
    var end = dot > 0 ? name.slice(dot).toLowerCase() : "with no ending";
    (byEnd[end] = byEnd[end] || []).push(String(f));
  });
  inner.appendChild(el("h2", "bk-head", "Left out as not games"));
  inner.appendChild(el("p", "mt-note", "Files no emulator of their folder's console opens, or that are no game when looked into: " +
    "saves, notes, pictures, BIOS files. One that is a game has an ending Xsegon does not take for that console."));
  var ends = Object.keys(byEnd).sort(function (a, b) { return byEnd[b].length - byEnd[a].length; });
  // A dozen lines at most: the endings past them share one, which names each on pointing.
  if (ends.length > 12) {
    var rest = ends.slice(11);
    byEnd["with other endings"] = [].concat.apply([], rest.map(function (e) { return byEnd[e]; }));
    ends = ends.slice(0, 11).concat(["with other endings"]);
  }
  ends.forEach(function (end) {
    var all = byEnd[end];
    var many = end.charAt(0) === "." ? plural(all.length, end + " file", end + " files") : plural(all.length, "file", "files") + " " + end;
    var line = el("p", "mt-note", many + ": " + all.slice(0, 3).map(tailOf).join(", ") +
      (all.length > 3 ? " and " + (all.length - 3) + " more" : ""));
    line.title = all.slice(0, 40).join("\n") + (all.length > 40 ? "\nand " + (all.length - 40) + " more" : "");
    inner.appendChild(line);
  });
}

/* whenAdded() is called when one joined the library from here. */
export function passedTail(inner, passed, whenAdded) {
  var rows = (passed || []).filter(function (p) { return p.why === "have"; });
  if (!rows.length) { return; }
  inner.appendChild(el("h2", "bk-head", "Other files of games you already have"));
  inner.appendChild(el("p", "mt-note", "Each of these is taken for a game that is in the library under another file: another version or region, " +
    "a second disc, or a second copy. That is why it is not offered as a new game. Add one and it becomes another version of that game, offered when you press Play. " +
    "A later disc of a game whose emulator reads playlists is joined to it instead, so the set plays as one game."));
  var box = el("div", "up-rows ps-rows");
  rows.forEach(function (p) {
    var node = el("div", "up-row ps-row");
    var top = el("div", "up-top");
    top.appendChild(el("span", "up-file", tailOf(p.rom)));
    var where = el("span", "up-where", p.platform + "  ·  " + p.title);
    where.title = p.rom;
    top.appendChild(where);
    // A later disc of a game that plays through a playlist is joined to it; anything else becomes a version.
    var go = el("button", "up-go", p.join ? "Join as disc " + p.disc + " of " + p.title : "Add as another version");
    go.type = "button";
    top.appendChild(go);
    node.appendChild(top);
    var says = el("p", "up-says", "The library has " + (p.has ? tailOf(p.has) : "a game of this name") + " for it." +
      (p.join ? " Joined, the two play as one game through a playlist, and the disc is changed in the emulator." : ""));
    node.appendChild(says);
    go.addEventListener("click", function () {
      go.disabled = true;
      if (p.join) {
        postJson("api/scan.php", { action: "join", rom: p.rom }).then(function (r) {
          if (!r.ok) {
            go.disabled = false;
            sound("back");
            says.className = "up-says bad";
            says.textContent = "Not joined: " + ((r && r.error) || "no answer") + ".";
            return;
          }
          L("SCAN", "joined as disc " + p.disc + ": " + p.platform + " | " + p.title + " | " + tailOf(p.rom));
          sound("select");
          go.hidden = true;
          says.className = "up-says good";
          says.textContent = "Joined: " + p.title + " now plays as " + r.discs.length + " discs through " + tailOf(r.path).split("\\").pop() + ".";
          whenAdded();
        });
        return;
      }
      postJson("api/scan.php", { action: "accept", games: [{ id: p.id, title: p.title, platform: p.platform, rom: p.rom, discs: p.discs }] }).then(function (r) {
        if (!r.ok || !(r.added > 0)) {
          go.disabled = false;
          sound("back");
          says.className = "up-says bad";
          says.textContent = "Not added: " + ((r && (r.error || (r.skipped && r.skipped[0] && r.skipped[0].why))) || "no answer") + ".";
          return;
        }
        L("SCAN", "added as another version: " + p.platform + " | " + p.title + " | " + tailOf(p.rom));
        sound("select");
        go.hidden = true;
        says.className = "up-says good";
        says.textContent = "Added as another version of " + p.title + ".";
        whenAdded();
      });
    });
    box.appendChild(node);
  });
  inner.appendChild(box);
}
