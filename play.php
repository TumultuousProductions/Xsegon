<?php
/**
 * /play.php?id=<xs-id> - a web game of your own, in a window of its own.
 *
 * The Xsegon window is started with --kiosk (no title bar, F11 does nothing),
 * so a game shown in it would leave no way back. The game gets its own window,
 * and this page is the frame around it:
 *
 *   - Esc goes back to Xsegon, and so does a small X in the corner.
 *   - A minimise beside it, for stepping away without closing.
 *   - Both fade out of the way while you play and come back on a mouse move.
 *   - The window keeps its own title bar, so F11 and Alt+F4 work as normal.
 *   - Play time is counted here and sent to api\session.php.
 *
 * The game is in an iframe of another origin (its own port), so a key pressed
 * while the game has focus never reaches this page: that is why the X is drawn.
 *
 * Only a game already in data\local-games.json can be shown, looked up by id:
 * this page never takes an address from the request.
 */
declare(strict_types=1);

require_once __DIR__ . '/includes/import.php';

$id = trim((string) ($_GET['id'] ?? ''));
$game = null;
if (preg_match('/^xs-[0-9a-f]{12}$/', $id)) {
    foreach (xs_local_read() as $e) {
        if (($e['id'] ?? '') === $id && !empty($e['url'])) {
            $game = $e;
            break;
        }
    }
}

if ($game === null) {
    http_response_code(404);
    $title = 'Not a web game';
    $why = 'That game is not one of yours with a web address.';
} else {
    $title = (string) $game['title'];
    $why = null;
}
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title><?= htmlspecialchars($title, ENT_QUOTES) ?><?= $why === null ? ' - Xsegon' : '' ?></title>
<link rel="icon" type="image/png" sizes="32x32" href="/img/xsegon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/img/xsegon-192.png">
<link rel="apple-touch-icon" href="/img/xsegon-180.png">
<style>
  html, body { margin: 0; height: 100%; background: #000; color: #eafcff;
               font-family: Consolas, "Cascadia Mono", monospace; overflow: hidden; }
  #game { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; display: block; background: #000; }

  /* The way out: it sits over the game, so it shows fully only when the mouse moves. */
  .bar {
    position: fixed; top: 10px; right: 12px; z-index: 5;
    display: flex; gap: 8px; align-items: center;
    padding: 5px 7px;
    background: rgba(4, 9, 20, .78);
    border: 1px solid rgba(34, 211, 238, .35);
    border-radius: 999px;
    opacity: .12;
    transition: opacity .25s ease;
  }
  .bar:hover, .bar.awake { opacity: 1; }
  .bar button {
    width: 26px; height: 26px; padding: 0;
    display: flex; align-items: center; justify-content: center;
    border: 0; border-radius: 50%;
    background: transparent; color: rgba(190, 247, 255, .84);
    font: inherit; font-size: 13px; line-height: 1; cursor: pointer;
  }
  .bar button:hover { background: rgba(34, 211, 238, .18); color: #22d3ee; }
  .bar .x:hover { background: rgba(248, 113, 113, .22); color: #fca5a5; }
  .bar .tag { font-size: 10px; letter-spacing: .14em; color: rgba(190, 247, 255, .66); padding: 0 4px 0 2px; }

  /* Said once, on the way in, then gone. */
  .hint {
    position: fixed; top: 46px; right: 14px; z-index: 5;
    background: rgba(4, 9, 20, .9); border: 1px solid rgba(34, 211, 238, .3);
    padding: 7px 12px; font-size: 11.5px; letter-spacing: .08em;
    color: rgba(190, 247, 255, .84);
    transition: opacity .4s ease;
  }
  .hint b { color: #22d3ee; font-weight: 700; }
  .hint.gone { opacity: 0; pointer-events: none; }

  .oops { padding: 40px; font-size: 14px; letter-spacing: .06em; }
  .oops a { color: #22d3ee; }
</style>
</head>
<body>
<?php if ($why !== null): ?>
  <div class="oops"><?= htmlspecialchars($why, ENT_QUOTES) ?> <a href="/">Back to Xsegon</a></div>
<?php else: ?>
  <iframe id="game" src="<?= htmlspecialchars((string) $game['url'], ENT_QUOTES) ?>"
          allow="autoplay; fullscreen; gamepad; clipboard-write"></iframe>

  <div class="bar awake" id="bar">
    <span class="tag">ESC</span>
    <button type="button" id="min" title="Minimise (the game keeps running)" aria-label="Minimise">&#8211;</button>
    <button type="button" class="x" id="close" title="Back to Xsegon (Esc)" aria-label="Back to Xsegon">&#10005;</button>
  </div>
  <div class="hint" id="hint"><b>Esc</b> or the <b>&#10005;</b> goes back to Xsegon</div>

<script>
(function () {
  "use strict";
  var id = <?= json_encode($id) ?>;
  var title = <?= json_encode($title . ' - Xsegon') ?>;
  var since = Date.now();
  var bar = document.getElementById("bar");
  var hint = document.getElementById("hint");

  // Play time is counted here, the page that knows when the game opened and closed.
  // sendBeacon still arrives while the window is closing.
  var sent = false;
  function record() {
    if (sent) { return; }
    sent = true;
    var secs = Math.round((Date.now() - since) / 1000);
    if (secs < 3) { return; }
    var body = JSON.stringify({ id: id, seconds: secs });
    try {
      if (navigator.sendBeacon) { navigator.sendBeacon("api/session.php", new Blob([body], { type: "application/json" })); return; }
    } catch (e) { /* fall through */ }
    try { fetch("api/session.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }); } catch (e) { /* going anyway */ }
  }
  window.addEventListener("pagehide", record);
  window.addEventListener("beforeunload", record);

  /* Closing and minimising go through the server (api\window.php): a script may
     only close what it opened, and this window came from the command line. The
     server finds it by title, only among browsers started with Xsegon's profile. */
  function windowOp(op) {
    record();
    return fetch("api/window.php", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: op, title: title })
    }).catch(function () { /* nothing else to try */ });
  }

  document.getElementById("close").addEventListener("click", function () { windowOp("close"); });
  document.getElementById("min").addEventListener("click", function () { windowOp("minimize"); });

  // Esc works while this page has the keyboard; once the game has it, keys never reach here.
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); windowOp("close"); }
  });

  // The bar wakes on a mouse move and goes quiet again.
  var sleepAt = null;
  function wake() {
    bar.classList.add("awake");
    clearTimeout(sleepAt);
    sleepAt = setTimeout(function () { bar.classList.remove("awake"); }, 2500);
  }
  document.addEventListener("mousemove", wake);
  bar.addEventListener("mouseenter", wake);
  wake();

  setTimeout(function () { hint.classList.add("gone"); }, 5000);

  // The keyboard starts here, so Esc works before anything is clicked.
  window.focus();
})();
</script>
<?php endif; ?>
</body>
</html>
