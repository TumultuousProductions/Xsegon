<?php
/**
 * /api/ownsounds.php - your own sounds (includes\ownsounds.php).
 *
 *   GET                                      the rules, and each sound's file or none
 *   GET  ?staged=move                        the chosen file, for the page to measure
 *   POST {"action":"stage", "name", "path"}  copy a chosen file in to be measured
 *   POST {"action":"keep", "name", "seconds", "from"}  it fits: make it the sound
 *   POST {"action":"discard", "name", "why"} it does not: throw it away, say why
 *   POST {"action":"remove", "name"}         back to the built-in one
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/ownsounds.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $staged = strtolower((string) ($_GET['staged'] ?? ''));
    if ($staged === '') {
        xs_json(['ok' => true] + xs_own_state());
    }
    $file = isset(XS_OWN_NAMES[$staged]) ? (xs_own_files(xs_own_stage_dir(), $staged)[0] ?? null) : null;
    if ($file === null) {
        http_response_code(404);
        exit;
    }
    header('Cache-Control: no-store');
    header('Content-Type: ' . XS_SOUND_TYPES[strtolower(pathinfo($file, PATHINFO_EXTENSION))]);
    header('Content-Length: ' . filesize($file));
    readfile($file);
    exit;
}

xs_local_origin_only();
$body = xs_body();
$action = (string) ($body['action'] ?? '');
$name = strtolower((string) ($body['name'] ?? ''));
if (!isset(XS_OWN_NAMES[$name])) {
    xs_fail('say which sound: move, hover, select, back or ok');
}
$label = XS_OWN_NAMES[$name];

if ($action === 'stage') {
    $path = xs_norm_path(trim((string) ($body['path'] ?? '')));
    $why = null;
    if (xs_own_stage($name, $path, $why) === null) {
        xs_log('SND', 'your own ' . $label . ' refused: ' . $why . ' (' . $path . ')');
        xs_fail($label . ' not changed: ' . $why, 409);
    }
    xs_json(['ok' => true, 'url' => 'api/ownsounds.php?staged=' . $name . '&v=' . time()]);
}

if ($action === 'keep') {
    $from = mb_substr((string) ($body['from'] ?? ''), 0, 400);
    $why = null;
    if (!xs_own_keep($name, (float) ($body['seconds'] ?? 0), $from, $why)) {
        xs_log('SND', 'your own ' . $label . ' refused: ' . $why);
        xs_fail($label . ' not changed: ' . $why, 409);
    }
    xs_log('SND', 'your own ' . $label . ' is ' . $from . ' (' . round((float) $body['seconds'], 2) . 's)');
    xs_json(['ok' => true] + xs_own_state());
}

if ($action === 'discard') {
    foreach (xs_own_files(xs_own_stage_dir(), $name) as $f) {
        @unlink($f);
    }
    xs_log('SND', 'your own ' . $label . ' refused: ' . mb_substr((string) ($body['why'] ?? ''), 0, 200));
    xs_json(['ok' => true]);
}

if ($action === 'remove') {
    xs_own_remove($name);
    xs_log('SND', 'your own ' . $label . ' removed: ' . ($name === 'hover' ? 'the sound set\'s own plays, or the built-in one' : 'the built-in one plays'));
    xs_json(['ok' => true] + xs_own_state());
}

xs_fail('say stage, keep, discard or remove');
