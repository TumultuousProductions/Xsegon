<?php
/**
 * /api/fanprojects.php - the Fan projects page (includes\fanprojects.php, js\fanprojects.js).
 *
 *   GET                                       every project and where it stands for this library
 *   POST {"open": "<project id>", "which": "page" | "community"}
 *                                             that project's page opened in the default browser
 *
 * The address is never taken from the request: it comes out of the shipped list, so only
 * a listed team's own page can be opened. A test server opens nothing.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/fanprojects.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    xs_local_origin_only();
    $body = xs_body();
    $id = (string) ($body['open'] ?? '');
    $which = (string) ($body['which'] ?? 'page');
    $url = xs_fan_url($id, $which);
    if ($url === null) {
        xs_fail('no such project page to open', 404);
    }
    if (xs_test_copy() || !empty($body['dry'])) {
        xs_json(['ok' => true, 'url' => $url, 'dry' => true]);
    }
    $handle = popen('start "" "' . $url . '"', 'r');
    if ($handle === false) {
        xs_log('FAN', 'could not open ' . $url);
        xs_fail('Windows did not open the page', 500);
    }
    pclose($handle);
    xs_log('FAN', 'opened ' . $which . ' of ' . $id . ': ' . $url);
    xs_json(['ok' => true, 'url' => $url]);
}

$t = microtime(true);
$games = array_values(array_filter(xs_library()['games'] ?? [], static fn($g) => empty($g['hidden'])));
$projects = xs_fan_states($games);
$ms = (int) round((microtime(true) - $t) * 1000);
$ready = count(array_filter($projects, static fn($p) => in_array($p['base']['state'], ['fits', 'works'], true) && !$p['yours']));
$mine = count(array_filter($projects, static fn($p) => (bool) $p['yours']));
xs_log('FAN', count($projects) . ' projects: ' . $mine . ' in the library, ' . $ready . ' ready to make, in ' . $ms . 'ms');
xs_json(['ok' => true, 'projects' => $projects, 'ms' => $ms]);
