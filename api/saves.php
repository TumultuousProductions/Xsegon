<?php
/**
 * GET  /api/saves.php?id=<game id>   everything saved for the game, in groups:
 *                                    RetroArch's save states and in-game save,
 *                                    the ones kept for another core, the ones
 *                                    beside the game's file, and for a PCSX2
 *                                    game its states and memory cards
 * POST {"id": "...", "use": "<row key>", "replace": false}
 *                                    put that save where RetroArch loads it.
 *                                    When RetroArch has its own there the
 *                                    answer is {"needs": "replace", "own": time}
 *                                    and nothing is done until it is asked
 *                                    again with "replace": true; the one
 *                                    replaced is kept as a copy
 * POST {"id": "...", "pickup": true} every save beside the game that RetroArch
 *                                    has none of its own for, copied in
 *
 * Reading writes nothing (includes\saves.php). A state's picture is served
 * by api\states.php, and a row is shown in its folder by api\reveal.php,
 * which takes the row's key and never a path. A save is only ever put into
 * a RetroArch Xsegon may write to.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/saves.php';

$isPost = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
$body   = $isPost ? xs_body() : [];
$id     = xs_id_or_fail($isPost ? ($body['id'] ?? '') : ($_GET['id'] ?? ''));
$game = xs_game_or_404($id);

if ($isPost) {
    xs_local_origin_only();
    if (xs_game_running() !== null) {
        xs_fail('a game is running: its saves are left alone until it is closed', 409);
    }
    if (!empty($body['pickup'])) {
        xs_json(['ok' => true, 'picked' => xs_saves_pickup($game)]);
    }
    $key = (string) ($body['use'] ?? '');
    if (!preg_match('/^[a-z]{1,12}(:\d{1,4})?$/', $key)) {
        xs_fail('which save is not said', 400);
    }
    $why = null;
    $did = xs_save_use($game, $key, !empty($body['replace']), $why);
    if ($did === null) {
        xs_fail((string) $why, 409);
    }
    xs_json(['ok' => true] + $did);
}

$saves = xs_saves_for($game);
xs_log('SAVE', 'listed for ' . $game['title'] . ': ' . ($saves['groups']
    ? implode(', ', array_map(static fn (array $g): string => count($g['rows']) . ' ' . $g['key'], $saves['groups']))
    : 'nothing'));
xs_json(['ok' => true] + $saves);
