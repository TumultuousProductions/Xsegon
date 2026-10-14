<?php
/**
 * POST /api/open-game.php  {"id": "xs-..."} - a web game, in its own window.
 *
 * The kiosk window cannot open a second window itself, and navigating would
 * leave no way back, so bin\open-game.ps1 opens it from outside.
 *
 * Only the id travels, looked up in data\local-games.json: no address from
 * the request ever reaches the browser.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';

xs_local_origin_only();

xs_post_only();

$id = trim((string) (xs_body()['id'] ?? ''));
if (!preg_match('/^xs-[0-9a-f]{12}$/', $id)) {
    xs_fail('a game of your own is asked for by its id', 400);
}

$game = null;
foreach (xs_local_read() as $e) {
    if (($e['id'] ?? '') === $id && !empty($e['url'])) {
        $game = $e;
        break;
    }
}
if ($game === null) {
    xs_fail('that is not one of your games with a web address', 404);
}

$script = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'open-game.ps1';
$port   = (int) ($_SERVER['SERVER_PORT'] ?? 8099);


// Never a window from the test server (xs_test_copy).
if (xs_test_copy()) {
    xs_json(['ok' => true, 'opening' => $game['title'], 'window' => $game['title'] . ' - Xsegon', 'dry' => true]);
}
// Detached: this server answers one request at a time and must not wait for
// a browser window to appear.
if (!xs_spawn_ps(xs_ps_call($script, ['Id' => $id, 'Port' => $port]), ['hidden' => true])) {
    xs_fail('could not open the window', 500);
}

xs_log('LNCH', $game['title'] . ' window play.php id=' . $id);
xs_json(['ok' => true, 'opening' => $game['title'],
         'window' => $game['title'] . ' - Xsegon']);
