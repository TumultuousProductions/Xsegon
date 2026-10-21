<?php
/**
 * /api/steamvid.php - Steam trailers as video snaps (includes\steamvid.php).
 *
 *   GET                      every Steam game, whether it has a video or got
 *                            no trailer before, the job if one is running,
 *                            and whether ffmpeg is here
 *   POST {"ids": [...]}      fetch trailers for these games, in the background
 *   POST {..., "dry": true}  the plan, nothing started
 *
 * A game that already has a video (video_for_game, includes\video.php) is
 * never in a job, whatever the page sends.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/steamvid.php';

$s   = xs_settings();
$lib = xs_library();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $job  = xs_steamvid_job();          // first: an ended fetch's games with no trailer are kept apart before the rows are read
    $rows = xs_steamvid_games($s, $lib);
    xs_json([
        'ok'      => true,
        'games'   => $rows,
        'missing' => count(array_filter($rows, static fn ($r) => !$r['has'])),
        'ffmpeg'  => xs_ffmpeg() !== '',
        'dir'     => xs_steamvid_dir(),
        'job'     => $job,
    ]);
}

xs_local_origin_only();
$body = xs_body();
$job  = xs_steamvid_job();
if (is_array($job) && ($job['state'] ?? '') === 'running' && empty($body['dry'])) {
    xs_fail('trailers are already being fetched; that has to finish first', 409);
}
$plan = xs_steamvid_plan($s, $lib, (array) ($body['ids'] ?? []));
if ($plan === null) {
    xs_fail('none of those is a Steam game without a video', 409);
}
if (!empty($body['dry'])) {
    xs_json(['ok' => true, 'dry' => true, 'plan' => $plan]);
}
if (!xs_steamvid_start($plan, $why)) {
    xs_fail((string) $why, 500);
}
xs_json(['ok' => true, 'started' => true, 'count' => count($plan['games'])]);
