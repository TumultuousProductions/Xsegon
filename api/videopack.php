<?php
/**
 * /api/videopack.php - videos for the games here from a package made on another PC (includes\videopack.php).
 *
 *   GET                      the job at work, or how the last ended
 *   GET  ?need=1             how many games here have no video, and the list's file name
 *   GET  ?export=1           that list, as a file
 *   POST {"take": "<package>"}                   put a package's videos onto the games here
 *   POST {"stop": true}                          stop after the file in hand
 *
 * The long steps are bin\videopack.php's; this starts them and says how far they are.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/videopack.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    xs_local_origin_only();
    $body = xs_body();
    $why  = null;
    if (!empty($body['stop'])) {
        $running = (xs_vp_job()['state'] ?? '') === 'running';
        if ($running) {
            @touch(xs_vp_stop_path());
            xs_log('VPK', 'asked to stop after the file in hand');
        }
        xs_json(['ok' => true, 'stopping' => $running]);
    }
    if (!xs_vp_start_import((string) ($body['take'] ?? ''), $why)) {
        xs_fail((string) $why, 409);
    }
    xs_json(['ok' => true, 'started' => true, 'job' => xs_vp_job()]);
}

if (!empty($_GET['need']) || !empty($_GET['export'])) {
    $rows = xs_vp_need(xs_settings(), xs_library());
    if (empty($_GET['export'])) {
        xs_json(['ok' => true, 'need' => count($rows), 'name' => xs_vp_list_name()]);
    }
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . xs_vp_list_name() . '"');
    header('Cache-Control: no-store');
    xs_log('VPK', 'exported the ' . count($rows) . ' games with no video as ' . xs_vp_list_name());
    echo json_encode(xs_vp_list_doc($rows), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}

xs_json(['ok' => true, 'job' => xs_vp_job()]);
