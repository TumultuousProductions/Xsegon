<?php
/**
 * /api/report.php - gather everything needed to answer "it stopped working".
 *
 *   GET                             the checks, run now, and what a report
 *                                   would hold; plus the ones already made
 *   POST {"action":"make"}          write one
 *   POST {"action":"remove","name"} throw one away
 *   GET  ?get=<name>                send the zip to the browser
 *
 * The checks run on the GET too: often the answer is on the screen (an
 * unplugged ROM drive) before any file is made.
 *
 * includes\report.php says what goes in and what deliberately does not.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/report.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// The download. Only ever a name this code wrote, in the reports folder.
$get = (string) ($_GET['get'] ?? '');
if ($method === 'GET' && $get !== '') {
    if (!xs_report_is_name($get)) {
        xs_fail('that is not a report name', 400);
    }
    $path = xs_report_dir() . DIRECTORY_SEPARATOR . $get;
    if (!is_file($path)) {
        xs_fail('there is no report called ' . $get, 404);
    }
    header('Content-Type: application/zip');
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: attachment; filename="' . $get . '"');
    header('Cache-Control: no-store');
    readfile($path);
    exit;
}

if ($method !== 'POST') {
    $checks = xs_report_checks();
    $worst  = 'ok';
    foreach ($checks as $c) {
        if ($c['state'] === 'bad') { $worst = 'bad'; break; }
        if ($c['state'] === 'warn') { $worst = 'warn'; }
    }
    xs_json([
        'ok'      => true,
        'checks'  => $checks,
        'worst'   => $worst,
        'folder'  => xs_report_dir(),
        'reports' => xs_report_list(),
        'days'    => XS_REPORT_DAYS,
        'logging' => xs_log_enabled(),
    ]);
}

xs_local_origin_only();
$body   = xs_body();
$action = (string) ($body['action'] ?? '');

try {
    if ($action === 'make') {
        $made = xs_report_make();
        xs_json(['ok' => true, 'made' => $made, 'reports' => xs_report_list(), 'folder' => xs_report_dir()]);
    }
    if ($action === 'remove') {
        xs_report_remove((string) ($body['name'] ?? ''));
        xs_json(['ok' => true, 'reports' => xs_report_list(), 'folder' => xs_report_dir()]);
    }
} catch (Throwable $e) {
    xs_log('RPT', 'failed: ' . $e->getMessage());
    xs_fail($e->getMessage(), 400);
}

xs_fail('unknown action', 400);
