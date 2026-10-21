<?php
/**
 * /api/archivedoc.php - manuals for the games with none, from the Internet Archive (includes\archivedoc.php).
 *
 *   GET                                  the consoles with games that have no manual, what the
 *                                        Archive has for each, and the fetch at work or how the last ended
 *   POST {"fetch": ["<console>", ...]}   fetch for those consoles, in the background
 *   POST {"stop": true}                  stop, keeping the manuals that have come
 *   POST {"lookAgain": true}             the games looked for before with nothing found
 *                                        are asked for again at the next Start
 *
 * The long part is bin\archivedoc.php's; this starts it and says how far it is.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/archivedoc.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    xs_local_origin_only();
    $body = xs_body();
    $why  = null;
    if (!empty($body['lookAgain'])) {
        $n = count(xs_ma_looked());
        @unlink(xs_ma_looked_path());
        xs_log('MANU', 'Look again: ' . $n . ' games looked for before with nothing found are asked for at the next Start');
        xs_json(['ok' => true, 'again' => $n]);
    }
    if (!empty($body['stop'])) {
        $running = (xs_ma_job()['state'] ?? '') === 'running';
        if ($running) {
            @touch(xs_ma_stop_path());
            xs_log('MANU', 'asked to stop, keeping the manuals that have come');
        }
        xs_json(['ok' => true, 'stopping' => $running]);
    }
    if (!xs_ma_start(is_array($body['fetch'] ?? null) ? $body['fetch'] : [], $why)) {
        xs_fail((string) $why, 409);
    }
    xs_json(['ok' => true, 'started' => true, 'job' => xs_ma_job()]);
}

$lib  = xs_library();
$rows = xs_ma_consoles($lib);
xs_json(['ok' => true, 'consoles' => $rows, 'need' => (int) array_sum(array_column($rows, 'need')),
         'looked' => xs_ma_looked_list($lib), 'curl' => xs_curl_exe() !== '', 'job' => xs_ma_job()]);
