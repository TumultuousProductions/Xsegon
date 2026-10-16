<?php
/**
 * GET  /api/texpacks.php?id=<game id>   where the game's texture pack goes, the one
 *                                       there now, whether its emulator loads it, and
 *                                       the packs listed for the game
 * POST {"id": "...", "from": "<file or folder>", "replace": false}
 *                                       put a pack in place, in the background. With
 *                                       one there already the answer is
 *                                       {"needs": "replace", "installed": {...}} and
 *                                       nothing is done until "replace": true
 * POST {"id": "...", "get": "<listed pack>", "replace": false}
 *                                       the same, from that pack's own download
 * POST {"id": "...", "open": "<listed pack>", "which": "page" | "tip"}
 *                                       that pack's page, or its maker's tip page, in the browser
 * POST {"id": "...", "remove": true}    take the game's pack away, in the background
 * POST {"stop": true}                   stop the one at work, nothing put in place
 *
 * A file or folder is one the person chose in Windows' own window (api\pick-folder.php);
 * a listed pack is named by its key, and its addresses come from the list alone.
 * Only an emulator Xsegon may write to is written to (includes\texpacks.php).
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/texpacks.php';

$isPost = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
$body   = $isPost ? xs_body() : [];

if ($isPost && !empty($body['stop'])) {
    xs_local_origin_only();
    if ((xs_tp_job()['state'] ?? '') === 'running') {
        @touch(xs_tp_stop_path());
        xs_log('TPAK', 'asked to stop: nothing is put in place');
    }
    xs_json(['ok' => true, 'stopping' => true]);
}

$id   = xs_id_or_fail($isPost ? ($body['id'] ?? '') : ($_GET['id'] ?? ''));
$game = xs_game_or_404($id);

if ($isPost) {
    xs_local_origin_only();
    $key = (string) ($body['open'] ?? $body['get'] ?? '');
    if ($key !== '' && !preg_match('/^[a-f0-9]{12}$/', $key)) {
        xs_fail('which pack is not said', 400);
    }
    if (isset($body['open'])) {
        $which = ($body['which'] ?? 'page') === 'tip' ? 'tip' : 'page';
        $url = (string) ((xs_tp_row($game, $key) ?? [])[$which] ?? '');
        if (!xs_tp_url_ok($url)) {
            xs_fail('that pack has no ' . ($which === 'tip' ? 'tip page' : 'page') . ' to open', 404);
        }
        if (xs_test_copy() || !empty($body['dry'])) {
            xs_json(['ok' => true, 'url' => $url, 'dry' => true]);
        }
        if (!xs_tp_open_url($url)) {
            xs_log('TPAK', 'could not open ' . $url);
            xs_fail('Windows did not open the page', 500);
        }
        xs_log('TPAK', 'opened the ' . $which . ' of a pack for ' . $game['title'] . ': ' . $url);
        xs_json(['ok' => true, 'url' => $url]);
    }
    if (xs_game_running() !== null) {
        xs_fail('a game is running: texture packs are left alone until it is closed', 409);
    }
    $remove = !empty($body['remove']);
    $get    = isset($body['get']) ? $key : null;
    $from   = $remove || $get !== null ? null : (string) ($body['from'] ?? '');
    if (!$remove && $get === null && $from === '') {
        xs_fail('which file or folder is not said', 400);
    }
    $why = null;
    $ask = null;
    if (!xs_tp_start($game, $from, $get, !empty($body['replace']), $why, $ask)) {
        if ($why === null && $ask !== null) {
            xs_json(['ok' => true, 'needs' => 'replace', 'installed' => $ask]);
        }
        xs_fail((string) $why, 409);
    }
    xs_json(['ok' => true, 'started' => true]);
}

$state = xs_tp_state($game);
xs_log('TPAK', 'looked at for ' . $game['title'] . ': ' . ($state['can'] ? $state['emulator'] . ', ' . $state['key'] . ', '
    . ($state['installed'] ? $state['installed']['files'] . ' files there' : 'none there') . ', loads ' . ($state['loads'] ? 'on' : 'off')
    : (string) $state['why']) . ', ' . count($state['found']) . ' listed');
xs_json($state);
