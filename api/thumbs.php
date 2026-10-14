<?php
/**
 * POST /api/thumbs.php - build the thumbnail cache.
 *
 * Detached, like a game launch: scaling hundreds of images takes a while, and
 * this single-threaded server would freeze every other request meanwhile.
 *
 * The builder writes how far it is into data\thumbs-job-<kind>.json, which
 * the bar in the corner reads (includes\jobs.php), and data\thumbs-<kind>.json
 * when it is done, which api\status.php reports.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/jobs.php';

xs_post_only();

$body   = xs_body();
$kind   = preg_replace('/[^a-z0-9]/', '', strtolower((string) ($body['kind'] ?? 'box'))) ?: 'box';
if (!array_key_exists($kind, xs_own_art_kinds())) {
    xs_fail('unknown kind of art', 400);
}
$width  = max(120, min(900, (int) ($body['width'] ?? 400)));
$force  = !empty($body['force']);

$script = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'thumbs.ps1';

/* The games and their pictures, handed to the builder as a file: one game a
   line, its ID, the picture, its title, tabs between. Only the merged read
   knows a scanned game, a game of your own, a replaced picture and one taken
   off; data\library.json alone usually does not exist. */
$lines = [];
foreach (xs_library()['games'] ?? [] as $g) {
    $src = $g['art'][$kind] ?? null;
    if (is_string($src) && $src !== '' && is_file($src)) {
        $lines[] = $g['id'] . "\t" . $src . "\t" . preg_replace('/\s+/u', ' ', (string) ($g['title'] ?? ''));
    }
}
// dry: how many pictures a build would look at, and nothing started.
if (!empty($body['dry'])) {
    xs_json(['ok' => true, 'started' => false, 'kind' => $kind, 'width' => $width, 'games' => count($lines)]);
}
// One builder a kind: a second would write the same small copies and the same count.
$job = xs_thumbs_job_path($kind);
if (xs_thumbs_job_alive(xs_read_json($job, null), $job)) {
    xs_fail('those thumbnails are being built already', 409);
}
$list = xs_data_path('thumbs-list-' . $kind . '.txt');
if (@file_put_contents($list, implode("\n", $lines)) === false) {
    xs_fail('could not write the list of pictures to build from', 500);
}
xs_write_json($job, ['kind' => $kind, 'state' => 'running', 'started' => time(), 'done' => 0, 'total' => count($lines)]);

xs_log('THM', 'build ' . $kind . ' ' . $width . 'px' . ($force ? ' force' : '') . ', ' . count($lines) . ' pictures');
if (!xs_spawn_ps(xs_ps_call($script, ['Kind' => $kind, 'Width' => $width, 'List' => $list, 'Job' => $job, 'Force' => $force]))) {
    @unlink($job);
    xs_fail('could not start the thumbnail builder', 500);
}

xs_json([
    'ok'      => true,
    'started' => true,
    'kind'    => $kind,
    'width'   => $width,
    'games'   => count($lines),
    'note'    => 'building in the background - watch the status strip',
]);
