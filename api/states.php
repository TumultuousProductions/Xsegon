<?php
/**
 * GET /api/states.php?id=<game id>          the game's save states, newest first
 * GET /api/states.php?id=<game id>&shot=N   the screenshot RetroArch keeps beside slot N
 *
 * Read only, out of RetroArch's own states folder (includes\states.php). The
 * page asks on every launch of a RetroArch game and shows the picker only
 * when there is something to pick.
 *
 * The picture is served here because /files/ opens onto data\ only. It is one
 * fixed name inside the folder the config named, never a path from the request.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/states.php';

$id = xs_id_or_fail($_GET['id'] ?? '');

$game = xs_game_or_404($id);

if (isset($_GET['shot'])) {
    $slot = (string) $_GET['shot'];
    if (!ctype_digit($slot) || (int) $slot > 999) {
        xs_fail('bad slot', 400);
    }
    $png = ra_state_shot($game, (int) $slot);
    if ($png === null) {
        http_response_code(404);
        exit;
    }
    $tag = '"' . dechex(filemtime($png) ?: 0) . '-' . dechex(filesize($png) ?: 0) . '"';
    header('Content-Type: image/png');
    header('Cache-Control: private, max-age=3600');
    header('ETag: ' . $tag);
    if (trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $tag) {
        http_response_code(304);
        exit;
    }
    header('Content-Length: ' . (string) filesize($png));
    readfile($png);
    exit;
}

$st = ra_states_for($game);
xs_json(['ok' => true, 'id' => $id, 'title' => $game['title'], 'states' => $st['states'],
         'auto' => $st['auto'], 'hotkey' => $st['hotkey'], 'sends' => $st['sends'], 'mode' => $st['mode'] ?? null]);
