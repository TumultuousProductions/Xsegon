<?php
/**
 * /api/arcadevid.php - the Arcade Database's part of Videos from online archives (includes\arcadevid.php).
 *
 *   GET                   how many arcade games have no video, how many of those can be asked
 *                         about, and its fetch at work or how the last ended
 *   POST {"stop": true}   stop its part, keeping the videos that have come
 *
 * It has no start of its own: api\archivevid.php starts it, with the rest of that fetch.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/arcadevid.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    xs_local_origin_only();
    $body = xs_body();
    if (empty($body['stop'])) {
        xs_fail('the Arcade Database is asked as part of Pictures & Videos > Videos from online archives: start it there', 400);
    }
    $running = (xs_ad_job()['state'] ?? '') === 'running';
    if ($running) {
        @touch(xs_ad_stop_path());
        xs_log('ARCD', 'asked to stop, keeping the videos that have come');
    }
    xs_json(['ok' => true, 'stopping' => $running]);
}

$games = xs_ad_need(xs_settings(), xs_library());
$named = count(array_filter($games, static fn ($g) => $g['name'] !== null));
xs_json(['ok' => true, 'need' => count($games), 'named' => $named, 'unnamed' => count($games) - $named,
         'curl' => xs_curl_exe() !== '', 'job' => xs_ad_job()]);
