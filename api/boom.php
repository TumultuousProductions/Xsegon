<?php
/**
 * /api/boom.php - throws on purpose, so the tests can prove that nothing
 * fails without a trace: an exception nobody catches must still answer JSON
 * and put itself in the day log (includes\boot.php, set_exception_handler).
 *
 * Only the test server's copy throws (XSEGON_DATA set); a real Xsegon
 * refuses, so no page and no visitor can set it off.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/boot.php';

if (!xs_test_copy()) {
    xs_fail('only the test copy throws on purpose', 403);
}

// ?busy=N: hold the main server for N seconds (at most 5), so the tests can
// prove the fast lane answers meanwhile. &steps=N reports progress in N steps
// (xs_step), which the tests read back through the fast lane.
if (isset($_GET['busy'])) {
    $hold  = min(5.0, max(0.0, (float) $_GET['busy']));
    $steps = max(0, min(50, (int) ($_GET['steps'] ?? 0)));
    for ($i = 0; $i < $steps; $i++) {
        xs_step('Counting on purpose', $i, $steps);
        usleep((int) ($hold / $steps * 1000000));
    }
    if ($steps === 0) {
        usleep((int) ($hold * 1000000));
    }
    xs_json(['ok' => true, 'busy' => true]);
}

// ?warn=1: a warning and then a plain answer. The warning belongs in the log, never in the answer.
if (isset($_GET['warn'])) {
    trigger_error('a stand-in warning, raised on purpose', E_USER_WARNING);
    xs_json(['ok' => true, 'warned' => true]);
}

// ?fatal=1: a request out of time, the fault PHP ends a request on that nothing can catch.
if (isset($_GET['fatal'])) {
    set_time_limit(1);
    for (;;) {
        usleep(10000);
    }
}

// ?parse=1: read a file the test wrote into the data folder, with a syntax error in it as a half-made edit leaves one.
if (isset($_GET['parse'])) {
    require xs_data_path('boom-parse.php');
    xs_json(['ok' => true, 'read' => true]);
}

function xs_boom_deep(): void
{
    throw new RuntimeException('a stand-in fault, thrown on purpose');
}

xs_boom_deep();
