<?php
/**
 * /api/hide.php - games told not to show (includes\overrides.php).
 *
 *   GET                                 what is hidden: [{id, title, platform}]
 *   POST {"id": "...", "hide": true}    take it off every view
 *   POST {"id": "...", "hide": false}   show it again
 *
 * An overlay in data\hidden.json, never a change to the imported library. A hidden
 * game keeps its pictures, favourite and history; only the listing goes.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';

$path = xs_data_path('hidden.json');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    $out = [];
    foreach (xs_hidden_games() as $id => $note) {
        $out[] = ['id' => (string) $id, 'title' => (string) ($note['title'] ?? $note), 'platform' => (string) ($note['platform'] ?? '')];
    }
    xs_json(['ok' => true, 'hidden' => $out]);
}

xs_local_origin_only();
$body = xs_body();
$id = xs_id_or_fail($body['id'] ?? '');
$hidden = xs_hidden_games();

if (empty($body['hide'])) {
    $was = $hidden[$id] ?? null;
    unset($hidden[$id]);
    xs_log('HIDE', 'show ' . (string) ($was['title'] ?? $id));
    xs_write_or_fail($path, $hidden ?: new stdClass());
    xs_json(['ok' => true, 'id' => $id, 'hidden' => false, 'title' => (string) ($was['title'] ?? $was ?? '')]);
}

// The game has to exist, and its name is kept so the Settings list can say
// what each hidden id is without reading the whole library back.
$game = xs_game_or_404($id);
xs_log('HIDE', 'hide ' . $game['title']);
$hidden[$id] = ['title' => $game['title'], 'platform' => $game['platform']];
xs_write_or_fail($path, $hidden);
xs_json(['ok' => true, 'id' => $id, 'hidden' => true, 'title' => $game['title']]);
