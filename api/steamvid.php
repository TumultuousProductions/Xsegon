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
$want = array_flip(array_map('strval', (array) ($body['ids'] ?? [])));
$pick = array_values(array_filter(xs_steamvid_games($s, $lib),
    static fn ($r) => !$r['has'] && isset($want[$r['id']])));
if (!$pick) {
    xs_fail('none of those is a Steam game without a video', 409);
}
$src  = xs_steamvid_sources();
$plan = [
    'state'   => 'running',
    'started' => time(),
    'dir'     => xs_steamvid_dir(),
    'api'     => $src['api'],
    'cdn'     => $src['cdn'],
    'ffmpeg'  => xs_ffmpeg(),
    'games'   => array_map(static fn ($r) => ['id' => $r['id'], 'title' => $r['title'], 'appid' => $r['appid'], 'state' => 'waiting'], $pick),
];
if (!empty($body['dry'])) {
    xs_json(['ok' => true, 'dry' => true, 'plan' => $plan]);
}
xs_write_or_fail(xs_steamvid_job_path(), $plan);
$script = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'steamvid.ps1';
if (!xs_spawn_ps(xs_ps_call($script, ['Job' => xs_steamvid_job_path()]))) {
    xs_fail('the trailer fetcher could not be started', 500);
}
xs_log('STEAMV', 'fetch asked for ' . count($pick) . ' trailers' . ($plan['ffmpeg'] !== '' ? ', ffmpeg for streams' : ', no ffmpeg'));
xs_json(['ok' => true, 'started' => true, 'count' => count($pick)]);
