<?php
/**
 * POST /api/window.php  {"op": "minimize" | "close" | "restart" | "fit"}
 *
 * A page can neither minimise its window nor close one it did not open, and
 * the kiosk window has no title bar, so bin\window.ps1 does it from outside.
 *
 * Same Origin rule as api\open.php: any site can aim a POST at 127.0.0.1.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';

$origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
if ($origin !== '') {
    $host = strtolower((string) parse_url($origin, PHP_URL_HOST));
    if (!in_array($host, ['127.0.0.1', 'localhost', '[::1]', '::1'], true)) {
        xs_fail('only pages on this machine may do that', 403);
    }
}

xs_post_only();

$body = xs_body();
$op = (string) ($body['op'] ?? '');
if (!in_array($op, ['minimize', 'close', 'restart', 'fit'], true)) {
    xs_fail('op must be minimize, close, restart or fit', 400);
}

// Fit: the page saw its screen change (a TV plugged in, or taken away). How
// large everything is drawn is the browser's from its start, so bin\open.ps1
// -Fit opens the window again, and only when its scale is not this screen's.
// Held while a game is on: the page asks again when it is next shown.
if ($op === 'fit') {
    if (xs_test_copy()) {
        xs_json(['ok' => true, 'op' => $op, 'dry' => true]);
    }
    if (is_file(xs_data_path('running.json'))) {
        xs_json(['ok' => true, 'op' => $op, 'held' => true]);
    }
    // The window opens on the main server's port; the fast lane, where this may be answered, is one above.
    $port = (int) ($_SERVER['SERVER_PORT'] ?? 8099) - (xs_fast_lane() ? 1 : 0);
    $open = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'open.ps1';
    if (!xs_spawn_ps(xs_ps_call($open, ['Port' => $port, 'Fit' => true]), ['hidden' => true])) {
        xs_fail('could not look at the window', 500);
    }
    xs_log('WIN', 'the page saw its screen change: asked whether the window still fits it');
    xs_json(['ok' => true, 'op' => $op]);
}

// Restart: the page's start-up watchdog (index.php) asks for this when the
// page's code would not start even after a reload. The window is closed and
// opened again by bin\open.ps1 -Restart, which also starts its watchdog.
if ($op === 'restart') {
    if (xs_test_copy()) {
        xs_json(['ok' => true, 'op' => $op, 'dry' => true]);
    }
    $open = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'open.ps1';
    if (!xs_spawn_ps(xs_ps_call($open, ['Port' => (int) ($_SERVER['SERVER_PORT'] ?? 8099), 'Restart' => true, 'Why' => 'the page asked: its code would not start']), ['hidden' => true])) {
        xs_fail('could not restart the window', 500);
    }
    xs_log('WDOG', 'restart of the app window asked by the page (its code would not start)');
    xs_json(['ok' => true, 'op' => $op]);
}

// A window by name: play.php's own X and minimise, which must act on the game
// window rather than on the wall behind it. Only ever a window of Xsegon's own
// browser; the title is matched, never a handle from the request.
$title = trim((string) ($body['title'] ?? ''));
if ($title !== '' && (mb_strlen($title) > 300 || preg_match('/[\r\n\t"]/', $title))) {
    xs_fail('bad window title', 400);
}

// The test server never touches a real window: with no title this op is
// "the app window", which is the person's own Xsegon (xs_test_copy).
if (xs_test_copy()) {
    xs_json(['ok' => true, 'op' => $op, 'title' => $title !== '' ? $title : null, 'dry' => true]);
}

// In a millisecond when it can be (includes\wincontrol.php). Closing the app
// window still goes on to window.ps1 below as well: it waits for the browser
// to finish and forces it only if it hangs, which a message alone cannot do.
require_once XS_ROOT . '/includes/wincontrol.php';
$quick = xs_window_fast($op, $title);
if ($quick && !($op === 'close' && $title === '')) {
    xs_log('WIN', $op . ($title !== '' ? ' "' . $title . '"' : ' (the app window)') . ', quick');
    xs_json(['ok' => true, 'op' => $op, 'title' => $title !== '' ? $title : null, 'quick' => true]);
}

$script = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'window.ps1';
if (!xs_spawn_ps(xs_ps_call($script, ['Op' => $op, 'Title' => $title !== '' ? $title : null]), ['hidden' => true])) {
    xs_fail('could not reach the window', 500);
}

// "asked", not done: the detached start throws the script's answer away, so
// this line must not read as proof the window obeyed.
xs_log('WIN', $op . ($title !== '' ? ' "' . $title . '"' : ' (the app window)') . ($quick ? ', quick' : ' asked'));
xs_json(['ok' => true, 'op' => $op, 'title' => $title !== '' ? $title : null, 'quick' => $quick]);
