<?php
/**
 * /api/homebrew.php - the Homebrew page (includes\homebrew.php, js\homebrew.js).
 *
 *   GET                                       every listed game and where it stands for this library
 *   GET  ?job=1                               the Get at work, or the last one, as its worker left it
 *   POST {"get": "<game id>", "ares": true}   fetch it in the background; ares: fetch ares first as well
 *   POST {"open": "<game id>", "which": "page" | "repo" | "community" | "jam"}
 *                                             that place opened in the default browser
 *
 * The address is never taken from the request: it comes out of the shipped list, so only a
 * listed team's or jam's own page can be opened. A test server opens nothing.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/homebrew.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST' && ($_GET['job'] ?? '') === '1') {
    xs_json(['ok' => true, 'job' => xs_hb_job()]);
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    xs_local_origin_only();
    $body = xs_body();
    if (isset($body['get'])) {
        if (!xs_hb_start((string) $body['get'], !empty($body['ares']), $why)) {
            xs_fail((string) $why, 409);
        }
        xs_json(['ok' => true, 'job' => xs_hb_job()]);
    }
    $id = (string) ($body['open'] ?? '');
    $which = (string) ($body['which'] ?? 'page');
    $url = xs_hb_url($id, $which);
    if ($url === null) {
        xs_fail('no such page to open', 404);
    }
    if (xs_test_copy() || !empty($body['dry'])) {
        xs_json(['ok' => true, 'url' => $url, 'dry' => true]);
    }
    $handle = popen('start "" "' . $url . '"', 'r');
    if ($handle === false) {
        xs_log('HBRW', 'could not open ' . $url);
        xs_fail('Windows did not open the page', 500);
    }
    pclose($handle);
    xs_log('HBRW', 'opened ' . $which . ' of ' . $id . ': ' . $url);
    xs_json(['ok' => true, 'url' => $url]);
}

$t = microtime(true);
$games = xs_hb_states(array_values(array_filter(xs_library()['games'] ?? [], static fn($g) => empty($g['hidden']))));
$ms = (int) round((microtime(true) - $t) * 1000);
$mine = count(array_filter($games, static fn($g) => $g['mine'] !== null));
xs_log('HBRW', count($games) . ' games listed, ' . $mine . ' in the library, in ' . $ms . 'ms');
$job = xs_hb_job();
xs_json(['ok' => true, 'games' => $games, 'ms' => $ms, 'getting' => ($job['state'] ?? '') === 'running' ? (string) ($job['game'] ?? '') : null]);
