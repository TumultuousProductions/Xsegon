<?php
/**
 * /api/getall.php - Get Media > Get Everything (includes\getall.php, js\getall.js).
 *
 *   GET                      whether a ScreenScraper account is stored (its name only), where each
 *                            kind comes from, where Get Pictures looks, and the job if there is one
 *   POST {"start": true}     every free source at once, and the ScreenScraper pass now or after them
 *   POST {..., "dry": true}  what would start, nothing started
 *   POST {"stop": true}      stop the wait, and the parts that can be stopped
 *
 * Where each kind comes from is a setting (library.getPictures, getVideos, getManuals), saved by the
 * window as any setting is.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/getall.php';

$s = xs_settings();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    xs_json([
        'ok'      => true,
        'account' => xs_ga_account(),
        'user'    => xs_ss_account()['user'],
        'ways'    => xs_ga_ways($s),
        'pictures'=> xs_details_from(),       // gamesdb | libretro: where Get Pictures looks
        'job'     => xs_ga_job(),
    ]);
}

xs_local_origin_only();
$body = xs_body();

if (!empty($body['stop'])) {
    xs_ga_stop();
    xs_json(['ok' => true, 'job' => xs_ga_job()]);
}

if (empty($body['start'])) {
    xs_fail('start or stop', 400);
}
$job = xs_ga_start($s, xs_library(), $why, !empty($body['dry']));
if ($job === null) {
    xs_fail((string) $why, 409);
}
xs_json(['ok' => true, 'dry' => !empty($body['dry']), 'job' => $job]);
