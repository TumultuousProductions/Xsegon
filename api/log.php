<?php
/**
 * /api/log.php - the page's half of the log (includes\boot.php has the format).
 *
 *   POST {"lines": [[stamp, code, msg], ...]}   the page's buffered lines, appended as "P"
 *   GET  ?tail=300[&day=YYYY-MM-DD]             the last lines of a day, for the viewer
 *   GET  ?days=1                                which days have a log
 *
 * The page keeps its own stamps (the moment it happened, not the moment the
 * batch arrived), so the two halves interleave truthfully.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/boot.php';
require_once __DIR__ . '/../includes/version.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'POST') {
    xs_local_origin_only();
    $body = xs_body();
    $lines = $body['lines'] ?? [];
    if (!is_array($lines)) {
        xs_fail('lines must be a list', 400);
    }
    $n = 0;
    foreach (array_slice($lines, 0, 500) as $l) {
        if (!is_array($l) || count($l) < 2) {
            continue;
        }
        $stamp = preg_match('/^\d\d:\d\d:\d\d\.\d{3}$/', (string) $l[0]) ? (string) $l[0] : null;
        $code  = preg_replace('/[^A-Z0-9]/', '', strtoupper((string) $l[1]));
        if ($code === '') {
            continue;
        }
        xs_log(substr($code, 0, 4), (string) ($l[2] ?? ''), 'P', $stamp);
        $n++;
    }
    xs_json(['ok' => true, 'written' => $n]);
}

$dir = xs_data_path('log');
if (!empty($_GET['days'])) {
    $days = [];
    foreach (@scandir($dir) ?: [] as $f) {
        if (preg_match('/^(\d{4}-\d\d-\d\d)\.log$/', $f, $m)) {
            $days[] = ['day' => $m[1], 'bytes' => (int) @filesize($dir . DIRECTORY_SEPARATOR . $f)];
        }
    }
    xs_json(['ok' => true, 'days' => $days, 'enabled' => xs_log_enabled()]);
}

$day  = preg_match('/^\d{4}-\d\d-\d\d$/', (string) ($_GET['day'] ?? '')) ? $_GET['day'] : date('Y-m-d');
$tail = max(20, min(5000, (int) ($_GET['tail'] ?? 300)));
$path = $dir . DIRECTORY_SEPARATOR . $day . '.log';
$out  = [];
if (is_file($path)) {
    // The end of the file only: a day can be megabytes.
    $size = (int) filesize($path);
    $fh   = fopen($path, 'rb');
    if ($fh !== false) {
        $want = min($size, $tail * 160);
        fseek($fh, $size - $want);
        $chunk = (string) stream_get_contents($fh);
        fclose($fh);
        $all = explode("\n", $chunk);
        if ($want < $size) {
            array_shift($all);           // a partial first line
        }
        $out = array_values(array_filter($all, static fn($l) => $l !== ''));
        $out = array_slice($out, -$tail);
    }
}
// The build goes out with the log, so a copied report carries its version.
xs_json(['ok' => true, 'day' => $day, 'lines' => $out, 'file' => $path,
         'enabled' => xs_log_enabled(), 'build' => xs_version_line()]);
