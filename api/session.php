<?php
/**
 * POST /api/session.php  {"id": "<game id>", "seconds": 123}
 *
 * A play session the PAGE timed, for a game the launcher never saw: a web
 * game (includes\local.php, "url") is opened by the browser and played until
 * you come back, so only the page knows how long. Written to the same
 * sessions.jsonl the launcher writes, in the same shape, so Recently played,
 * Most played and the details panel need nothing new.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';

xs_post_only();
xs_local_origin_only();

$body = xs_body();
$id = xs_id_or_fail($body['id'] ?? '');
$seconds = (int) ($body['seconds'] ?? 0);
if ($seconds < 1 || $seconds > 86400) {
    xs_fail('seconds must be between 1 and a day', 400);
}
$game = xs_game_or_404($id);
$end = time();
xs_append_jsonl(xs_sessions_path(), [
    'at'       => date('c', $end - $seconds),
    'endedAt'  => date('c', $end),
    'gameId'   => $id,
    'title'    => $game['title'],
    'platform' => $game['platform'],
    'seconds'  => $seconds,
    'exitCode' => 0,
    'source'   => 'page',
]);
xs_log('SESS', $game['title'] . ' ' . $seconds . 's (page)');
xs_json(['ok' => true, 'seconds' => $seconds]);
