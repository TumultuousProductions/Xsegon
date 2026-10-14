/*  The rest of a long list. The server sends the first lot at once
    (view.pageSize); where the list is longer, the rest is asked for and added
    in small pieces between the person's presses, until every game is there.

    A game and its node are added together, so the views' own rule holds at
    every moment: as many nodes as games. Nothing is added just after a press
    or while a game runs. Nothing is kept: each piece is read when wanted, and
    a list that changed meanwhile is read again from the top. A view drawn
    again makes nodes for the first lot and up to the chosen game; the others
    come back piece by piece with no read of the server.                  */

import { jobBar, jobBarHide } from "./jobbars.js";
import { showStrip } from "./launch.js";
import { L, api } from "./log.js";
import { gameRunning } from "./snap.js";
import { S, games, sel } from "./state.js";

var REST_MS = 250;            // after a press, how long nothing is added
var ASK_MS = 1100;            // and how long before the server is asked
var PIECE_MS = 8;             // how long one piece may take, and
var GAP_MS = 24;              // the room left between two of them
var BAR_KEY = "more";

// The list being added to: what the server calls it, and the games read but not yet in the page (from `at` on).
var coming = null;
var adder;                    // undefined: no view to add to; null: the games alone; else the view's own add(game, number)
var whenIn = null;            // for a view that draws everything again once the whole list is in
var pieceT = 0, touched = 0, selWas = -1, barAt = 0;

["keydown", "wheel", "pointerdown", "pointermove", "touchstart"].forEach(function (name) {
  window.addEventListener(name, function () { touched = Date.now(); }, { capture: true, passive: true });
});

function firstLot() { return Math.max(25, Number(S.view && S.view.pageSize) || 2000); }
function thousands(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function heldBack(c) { return c.held.length - c.at; }

/* A list has just arrived (js\library.js, took): its first lot is in the
   page. `query` is what was asked, `again` reads the list from the top. */
export function moreBegin(query, data, again) {
  clearTimeout(pieceT);
  pieceT = 0;
  if (coming && !coming.done) { jobBarHide(BAR_KEY); }
  coming = null;
  adder = undefined;            // the view that was being added to held the list before: the next build says where
  whenIn = null;
  var here = data && data.games ? data.games.length : 0;
  if (!query || !data || typeof data.sig !== "string" || !(data.count > here)) { return; }
  coming = { query: query, sig: data.sig, total: data.count, got: here, held: [], at: 0, asking: false, tries: 0,
             began: Date.now(), reads: 0, again: again, done: false, failed: "" };
  L("MORE", "a list of " + data.count + ": the first " + here + " are in, the rest is added as it goes");
  step(0);
}

/* A view is about to make a node for every game it holds: it makes them for
   the first lot and as far as the chosen game, and the games after those
   are put back to be added piece by piece. A list no longer than the first
   lot is left exactly as it is. */
export function moreCut() {
  var keep = Math.max(firstLot(), sel + 1);
  if (games.length <= keep) { return; }
  var whole = games.length, back = games.splice(keep);
  if (!coming) {
    coming = { query: null, sig: null, total: whole, got: whole, held: back, at: 0, asking: false, tries: 0,
               began: Date.now(), reads: 0, again: null, done: false, failed: "" };
  } else {
    coming.held = back.concat(coming.at ? coming.held.slice(coming.at) : coming.held);
    coming.at = 0;
    if (coming.done) { coming.done = false; coming.began = Date.now(); coming.reads = 0; }
  }
  L("MORE", "the view is drawn again with " + keep + " games, and " + back.length + " go back to be added as it goes");
}

/* The view on screen is built: add(game, number) makes one more node in it,
   or null where a view holds the games alone and draws them all again at
   the end (done). Called on every build, so the adding follows the view. */
export function moreFill(add, done) {
  adder = add;
  whenIn = done || null;
  selWas = sel;
  step(0);
}

// No view to add to (it was cleared for another list): the adding waits.
export function moreHold() {
  adder = undefined;
  whenIn = null;
}

function step(ms) {
  if (pieceT || !coming || coming.done || adder === undefined) { return; }
  pieceT = setTimeout(piece, ms);
}

function piece() {
  pieceT = 0;
  var c = coming;
  if (!c || c.done || adder === undefined) { return; }
  var now = Date.now();
  if (sel !== selWas) { selWas = sel; touched = now; }      // the pad and the keys' own moves
  if (gameRunning) { step(1000); return; }
  if (now - touched < REST_MS) { step(100); return; }

  var t0 = performance.now(), added = 0;
  while (c.at < c.held.length && (adder === null || performance.now() - t0 < PIECE_MS)) {
    var g = c.held[c.at++];
    games.push(g);
    if (adder) { adder(g, games.length - 1); }
    added++;
  }
  if (c.at >= c.held.length) { c.held = []; c.at = 0; }
  if (added) { bar(c, false); }

  if (!c.asking && c.query !== null && c.got < c.total && heldBack(c) < firstLot() && now - touched >= ASK_MS) { ask(c); }
  if (c.got >= c.total && heldBack(c) === 0 && !c.asking) { allIn(c); return; }
  step(added ? GAP_MS : 150);
}

function ask(c) {
  c.asking = true;
  c.reads++;
  api("api/library.php?" + c.query + "&from=" + c.got + "&lot=" + Math.min(20000, firstLot() * 2)).then(function (r) {
    if (coming !== c) { return; }                            // another list has come since
    c.asking = false;
    if (!r || !r.ok) {
      c.tries++;
      if (c.tries < 3) { step(2000); return; }
      c.failed = (r && r.error) || "the server did not answer";
      c.total = c.got;                                       // what is here is all there will be, and it is said
      step(0);
      return;
    }
    if (r.sig !== c.sig || r.count !== c.total) {
      L("MORE", "the list changed while its rest was being added (" + c.total + " games, now " + r.count + "): read again from the top");
      jobBarHide(BAR_KEY);
      coming = null;
      if (c.again) { c.again(); }
      return;
    }
    var rows = r.games || [];
    c.tries = 0;
    if (!rows.length) { c.total = c.got; step(0); return; }  // the server has no more than this
    c.held = (c.at ? c.held.slice(c.at) : c.held).concat(rows);
    c.at = 0;
    c.got += rows.length;
    step(0);
  });
}

function bar(c, over) {
  if (!over && Date.now() - barAt < 200) { return; }
  barAt = Date.now();
  jobBar({ key: BAR_KEY, name: "Loading the rest of your games", started: c.began, stop: false,
           state: over ? (c.failed ? "stopped" : "done") : "running",
           line: thousands(games.length) + " of " + thousands(c.total), frac: c.total ? games.length / c.total : null });
}

function allIn(c) {
  c.done = true;
  var took = ((Date.now() - c.began) / 1000).toFixed(1) + "s";
  if (c.failed) {
    L("MORE", "the rest could not be read after three tries (" + c.failed + "): " + games.length + " games are in, in " + took);
    showStrip("the rest of the games could not be read: " + c.failed + ". " + thousands(games.length) + " are shown.", true);
  } else {
    L("MORE", "all " + games.length + " games are in, in " + took + (c.reads ? ", " + c.reads + (c.reads === 1 ? " read" : " reads") + " of the server" : ", with no read of the server"));
  }
  bar(c, true);
  var then = whenIn;
  whenIn = null;
  if (then) { then(); }
}
