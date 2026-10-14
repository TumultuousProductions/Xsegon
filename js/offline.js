/*  The server stopped answering.
 *
 *  The worst failure Xsegon has, worst in the kiosk window: no title bar, no
 *  address bar, nothing to click. Without this, the last good screen stands
 *  frozen with every press doing nothing.
 *
 *  Three failed polls is the signal, not one: the server answers one request
 *  at a time, so a single miss during a long job says nothing.
 *
 *  The screen keeps trying on its own, since the server usually comes back. It
 *  never offers to reload the page: a reload against a dead server lands on the
 *  browser's own error page, and from a kiosk window there is no way back.
 */
import { L, flushLog } from "./log.js";
import { $offline } from "./state.js";
import { el } from "./util.js";

var shown = false;
var tries = 0;
var next = 0;               // when the automatic retry fires, in ms
var timer = null;
var onRetry = null;         // the poll itself, handed in rather than registered
                            // at load, so this file does nothing while it loads

/* The address the page was loaded from, which is the thing that is not
   answering. Read rather than assumed, because the port is a setting and a
   test runs on a different one. */
function where() {
  return location.protocol + "//" + location.host;
}

function paint() {
  var secs = Math.max(0, Math.ceil((next - Date.now()) / 1000));
  var wait = $offline.querySelector(".off-wait");
  if (wait) {
    wait.textContent = "Trying again in " + secs + "s"
      + (tries ? "  ·  tried " + tries + (tries === 1 ? " time" : " times") + " so far" : "");
  }
}

function build() {
  $offline.textContent = "";
  var box = el("div", "off-box");
  box.appendChild(el("h1", "off-title", "XSEGON CANNOT REACH ITS OWN SERVER"));
  box.appendChild(el("p", "off-where", where() + " is not answering."));
  box.appendChild(el("p", "off-lead",
    "Nothing has been lost. Everything Xsegon knows is in files on this machine, and "
    + "this window is only the front of it. The part that reads those files has stopped."));

  var causes = el("ul", "off-causes");
  [["The window that started it was closed.", "That window IS the server. Closing it stops Xsegon."],
   ["It was never started.", "Run start.ps1 in the Xsegon folder."],
   ["Something else took the port.", "Another copy of Xsegon, or another program on " + location.port + "."],
   ["php.exe stopped or was killed.", "Windows Update and antivirus both do this."]
  ].forEach(function (c) {
    var li = el("li");
    li.appendChild(el("span", "off-cause", c[0]));
    li.appendChild(el("span", "off-fix", c[1]));
    causes.appendChild(li);
  });
  box.appendChild(causes);

  box.appendChild(el("p", "off-wait", ""));

  var btns = el("div", "off-btns");
  var now = el("button", "primary", "Try again now");
  now.addEventListener("click", function () { retry(true); });
  btns.appendChild(now);
  box.appendChild(btns);

  box.appendChild(el("p", "off-note",
    "This screen goes on its own the moment the server answers. Nothing here needs to be pressed."));
  $offline.appendChild(box);
}

function retry(byHand) {
  if (byHand) { L("SRV", "retry by hand"); }
  tries++;
  next = Date.now() + 5000;
  paint();
  if (onRetry) { onRetry(); }
}

/* Called by the poll. `ok` is whether the server answered this time; `poll`
   is the poll, so "Try again now" is the same request that is already running
   rather than a second one that could disagree with it. */
export function serverAnswered(ok, poll) {
  onRetry = poll || onRetry;
  if (ok) {
    if (shown) {
      shown = false;
      clearInterval(timer);
      timer = null;
      $offline.hidden = true;
      document.body.classList.remove("offline-now");
      L("SRV", "back after " + tries + (tries === 1 ? " try" : " tries"));
      flushLog();                     // the lines that piled up while it was gone
    }
    tries = 0;
    return;
  }
  if (shown) { return; }
  shown = true;
  tries = 0;
  next = Date.now() + 5000;
  L("SRV", "lost: " + where() + " stopped answering");
  build();
  $offline.hidden = false;
  document.body.classList.add("offline-now");
  paint();
  // One ticker doing both jobs: count down on screen, and fire the retry.
  timer = setInterval(function () {
    if (Date.now() >= next) { retry(false); } else { paint(); }
  }, 500);
  var btn = $offline.querySelector("button");
  if (btn) { btn.focus(); }
}
