<?php
/**
 * GET /api/video.php?id=<game id>
 *
 * The video snap for one game, from Xsegon's own data\videos
 * (includes\video.php has where and why).
 *
 * Range requests are answered properly: Chrome asks for the tail of an mp4
 * first when the index is at the end, and without 206 it refuses to play or
 * pulls the whole file before the first frame.
 *
 * The same guard as the art: the resolved path must sit inside one of the
 * video roots, so a bug in matching can never become "read any file".
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/video.php';

$id = trim((string) ($_GET['id'] ?? ''));
if ($id === '' || !xs_game_id_ok($id)) {
    http_response_code(400);
    exit;
}

$s    = xs_settings();
$game = xs_game($id);
if ($game === null) {
    http_response_code(404);
    exit;
}

$path = video_for_game($s, $game);
$real = $path === null ? false : realpath($path);

if ($real === false || !video_in_allowed_root($s, $real)) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../includes/stream.php';
$ext = strtolower(pathinfo($real, PATHINFO_EXTENSION));
xs_stream_file($real, video_types()[$ext] ?? 'application/octet-stream', 'private, max-age=86400');
