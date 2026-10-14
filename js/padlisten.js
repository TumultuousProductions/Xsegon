/*  One "Press a button..." at a time. A page hears a controller press through
    one slot (js\input.js catchPadButton) that several kinds of row ask for.
    A new listen ends the one before it properly (its row, timer and key listen),
    and a listen lets go of the slot only while it is still its own. */

import { catchPadButton, stopPadCatch } from "./input.js";
import { L } from "./log.js";

var holder = null;          // the listen that has the slot: { end, what, over }

// A row that cannot be put back must not stop the listen that takes over from it.
function putBack(was) {
  was.over = true;
  try {
    if (typeof was.end === "function") { was.end(); }
  } catch (e) {
    L("PADS", "listen: " + was.what + " could not be put back: " + ((e && e.message) || e));
  }
}

/*  Take the slot for one press. cb(k) gets the browser's button number;
    end() puts the taker's own row back when another listen takes over;
    `what` names it in the log. Gives back what padListenEnd wants. */
export function padListen(cb, end, what) {
  var was = holder;
  holder = null;
  if (was) {
    L("PADS", "listen: " + what + " takes over from " + was.what);
    putBack(was);
  }
  var mine = { end: end, what: String(what || "a listen"), over: false };
  if (typeof cb !== "function") {
    L("PADS", "listen: " + mine.what + " was given nothing to tell of a press, so it is not started");
    mine.over = true;
    return mine;
  }
  holder = mine;
  catchPadButton(function (k) {
    if (holder === mine) { holder = null; }
    mine.over = true;
    cb(k);
  });
  return mine;
}

/*  Let go of the slot. Only a listen that still has it does: one that was
    taken over, or that heard its press, has nothing left to let go of. */
export function padListenEnd(mine) {
  if (!mine || mine.over) { return; }
  mine.over = true;
  if (holder !== mine) {
    // Not reached while every taker goes through padListen: logged in case.
    L("PADS", "listen: " + mine.what + " ended without the slot (" + (holder ? holder.what + " has it" : "nobody has it") + "), which is left as it is");
    return;
  }
  holder = null;
  stopPadCatch();
}

/*  End whichever listen has the slot, its row put back: for a screen that is going away. */
export function padListenStop() {
  var was = holder;
  holder = null;
  if (was) {
    L("PADS", "listen: " + was.what + " ended with its screen");
    putBack(was);
  }
  stopPadCatch();
}
