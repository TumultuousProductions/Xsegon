<?php
/**
 * /api/unpack.php - Unpack and add (includes\unpack.php): a disc game still
 * in its .zip or .7z, under one of the games folders.
 *
 *   GET   how the unpacking stands: the archive in hand and how far it is,
 *         the ones waiting, how the last ones ended, what was unpacked before.
 *   GET   ?look=<archive>   what is in that archive, which console's game it
 *         is, and what to do with it (includes\unpack.php, xs_unpack_plan).
 *         Reads the archive's list and the start of its disc; changes nothing.
 *   POST  {"action":"start","archive":"..","move":false,"scan":true}
 *         unpack it where it is, or (move) in its own console's folder, moved
 *         there first. One at a time: others wait their turn. Before anything
 *         is moved or written its list of files is checked, and (scan, on
 *         unless false) Windows Defender is asked about it; Defender only looks.
 *   POST  {"action":"startAll","archives":["..",".."],"scan":true}
 *         Unpack all: each one named is unpacked where it stands, one after
 *         another. The worker reads each disc first, and a game in another
 *         console's folder stays packed: nothing is moved without being asked.
 *   POST  {"action":"stop"}   end the run; what is half written is taken away.
 *
 * An archive is never changed or deleted.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/unpack.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    $archive = xs_norm_path(trim((string) ($_GET['look'] ?? '')));
    if ($archive === '') {
        xs_json(['ok' => true] + xs_unpack_status());
    }
    if (!xs_unpack_allowed($archive, $why)) {
        xs_fail((string) $why, 404);
    }
    // A big Xbox disc is read a few hundred megabytes in before it says whose it is.
    if ((int) ini_get('max_execution_time') > 0) {
        set_time_limit(180);
    }
    $t0 = microtime(true);
    $look = xs_unpack_look($archive, $why);
    if ($look === null) {
        xs_fail('could not look into it: ' . (string) $why, 409);
    }
    $plan = xs_unpack_plan($archive, $look);
    // Found unpacked already: remembered, so Scan for Games stops listing the archive.
    if ($plan['verdict'] === 'done') {
        xs_unpack_remember($archive, $look, $plan);
    }
    xs_log('UNPK', 'looked into ' . basename($archive) . ': ' . ($look['console'] ?? 'no console said') . ', ' . $plan['verdict']
        . ($plan['move'] !== null ? ' (belongs in ' . $plan['move']['dir'] . ($plan['move']['twin'] !== null ? ', a file of its name is there: ' . $plan['move']['twin'] : '') . ')' : '')
        . ', in ' . (int) round((microtime(true) - $t0) * 1000) . 'ms');
    unset($look['names']);
    xs_json(['ok' => true, 'archive' => $archive, 'look' => $look, 'plan' => $plan]);
}

$body = xs_body();
$action = (string) ($body['action'] ?? '');

if ($action === 'stop') {
    if (!xs_unpack_running()) {
        // No worker, and archives still wait their turn (theirs ended part way): Stop lets them go.
        $left = xs_unpack_waiting(true);
        if (!$left) {
            xs_fail('nothing is being unpacked', 409);
        }
        xs_unpack_drop($left);
        xs_unpack_let_go();
        xs_log('UNPK', 'told to stop with no worker at work: ' . count($left) . ' waiting let go');
        xs_json(['ok' => true] + xs_unpack_status());
    }
    @touch(xs_unpack_stop_path());
    xs_unpack_let_go();
    xs_log('UNPK', 'told to stop');
    xs_json(['ok' => true] + xs_unpack_status());
}

if ($action === 'startAll') {
    $archives = array_values(array_filter((array) ($body['archives'] ?? []), 'is_string'));
    if (!$archives) {
        xs_fail('no archives were named', 400);
    }
    $all = xs_unpack_ask_all($archives, ($body['scan'] ?? true) !== false);
    xs_log('UNPK', 'Unpack all: ' . $all['asked'] . ' asked for, of ' . count($archives) . ' named'
        . ($all['not'] ? '; not ' . basename($all['not'][0]['archive']) . ' (' . $all['not'][0]['why'] . ')'
            . (count($all['not']) > 1 ? ' and ' . (count($all['not']) - 1) . ' more' : '') : ''));
    if ($all['asked'] === 0) {
        xs_fail('none of them could be started: ' . $all['not'][0]['why'], 409);
    }
    xs_json(['ok' => true, 'asked' => $all['asked'], 'not' => $all['not']] + xs_unpack_status());
}

if ($action !== 'start') {
    xs_fail('say start, startAll or stop');
}
$archive = xs_norm_path(trim((string) ($body['archive'] ?? '')));
if (!xs_unpack_allowed($archive, $why)) {
    xs_fail((string) $why, 404);
}
$moveTo = null;
if (!empty($body['move'])) {
    // Where it belongs is worked out here, never taken from the page; the same
    // look as the plan's, so the same time a big Xbox disc needs to say whose it is.
    if ((int) ini_get('max_execution_time') > 0) {
        set_time_limit(180);
    }
    $look = xs_unpack_look($archive, $why);
    $plan = $look === null ? null : xs_unpack_plan($archive, $look);
    if ($plan === null || $plan['verdict'] !== 'wrong' || $plan['move'] === null) {
        xs_fail('that archive is not in the wrong console\'s folder, so there is nowhere to move it', 409);
    }
    if ($plan['move']['twin'] !== null) {
        xs_fail('a file of that name is already in ' . $plan['move']['dir'] . ', so it cannot be moved there', 409);
    }
    $moveTo = (string) $plan['move']['dir'];
}
if (!xs_unpack_ask($archive, $moveTo, ($body['scan'] ?? true) !== false, $why)) {
    xs_fail((string) $why, 409);
}
xs_json(['ok' => true] + xs_unpack_status());
