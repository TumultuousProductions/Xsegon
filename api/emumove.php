<?php
/**
 * /api/emumove.php - emulators moved out of LaunchBox's folder (includes\emumove.php).
 *
 *   GET                      the emulators that sit inside LaunchBox, where
 *                            their copies would go, the copy at work or how
 *                            the last one ended, and what was moved before
 *   GET  ?dest=<folder>      the same, for another folder to copy into
 *   GET  ?sizes=1            how big each one is (slow, so asked after the list)
 *   POST {"start": ["<program key>", ...], "dest": "<folder>"}   copy them
 *   POST {"stop": true}      stop after the file in hand; a half-made copy
 *                            is taken away
 *   POST {"back": "<program key>"}   LaunchBox's own copy again
 *
 * LaunchBox's folder is read and never written. The copy is made by
 * bin\emumove.php; this only starts it and says how far it is.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/emumove.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    xs_local_origin_only();
    $body = xs_body();
    $why  = null;
    if (!empty($body['stop'])) {
        $running = (xs_emumove_job()['state'] ?? '') === 'running';
        if ($running) {
            @touch(xs_emumove_stop_path());
            xs_log('EMUM', 'asked to stop after the file in hand');
        }
        xs_json(['ok' => true, 'stopping' => $running]);
    }
    if (isset($body['back'])) {
        if (!xs_emumove_back((string) $body['back'], $why)) {
            xs_fail((string) $why, 409);
        }
        xs_json(['ok' => true]);
    }
    $keys = is_array($body['start'] ?? null) ? array_values(array_filter($body['start'], 'is_string')) : [];
    if (!xs_emumove_start($keys, (string) ($body['dest'] ?? ''), $why)) {
        xs_fail((string) $why, 409);
    }
    xs_json(['ok' => true, 'started' => true, 'job' => xs_emumove_job()]);
}

$table = xs_emulators();
$dest  = trim((string) ($_GET['dest'] ?? ''));
$dest  = $dest !== '' ? rtrim(xs_norm_path($dest), '\\') : xs_emumove_default_dest($table);
$rows  = xs_emumove_rows($table, $dest);

if (!empty($_GET['sizes'])) {
    $sizes = [];
    foreach ($rows as $r) {
        $tree = $r['folder'] !== '' ? xs_emumove_tree($r['folder']) : null;
        $sizes[$r['keys'][0]] = $tree === null ? null : ['bytes' => array_sum($tree['files']), 'files' => count($tree['files'])];
    }
    xs_json(['ok' => true, 'sizes' => $sizes, 'free' => (float) @disk_free_space(is_dir($dest) ? $dest : dirname($dest))]);
}

$moved = [];
foreach (xs_emumove_moved() as $key => $m) {
    $now = (string) ($table['programs'][$key]['exe'] ?? '');
    // Only while the table still points at the copy: pointed elsewhere since, it is not this tool's to undo.
    if ($now !== '' && strtolower($now) === strtolower((string) $m['to'])) {
        $moved[] = ['key' => (string) $key, 'name' => (string) ($table['programs'][$key]['name'] ?? $key),
                    'from' => (string) $m['fromFolder'], 'to' => (string) $m['toFolder'], 'at' => (string) $m['at'],
                    'back' => is_file((string) $m['from'])];
    }
}
xs_json(['ok' => true, 'rows' => $rows, 'dest' => $dest, 'destInside' => xs_in_launchbox($dest . '\\x'),
         'job' => xs_emumove_job(), 'moved' => $moved, 'running' => xs_game_running() !== null]);
