<?php
/**
 * POST /api/retroarch.php  - open RetroArch with no game, and, asked with
 * {"page": "hotkeys"|"turbo"|"binds"}, walked to that page.
 *      {"fix": true | "look"}  put right (or only look at) its settings, no window
 *
 * The exe is the one the library's RetroArch launches use (includes\retroarch.php).
 *
 * The jump is PINNED (ra_jump_check reads every condition: 1.22.2, ozone,
 * Settings shown, network commands already on) and the walk is a detached
 * script sending menu presses over those commands (bin\ra-jump.ps1): nothing
 * of RetroArch's is written. Where a condition fails, it opens plain and says why.
 *
 * Detached, like a game. {"dry": true} answers with the exe and the jump's
 * plan and starts nothing.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/retroarch.php';

xs_post_only();
xs_local_origin_only();

$caps = ra_capabilities(xs_library());
if ($caps['exe'] === null) {
    xs_fail('could not find retroarch.exe next to the emulator the library uses', 409);
}

$body = xs_body();

/* {"fix": true} puts right the settings lines that stop RetroArch working here
 * (a command port Windows has set aside, a temp folder it cannot find), as
 * every start does; "look" only says what it would do. */
if (isset($body['fix'])) {
    $look = $body['fix'] === 'look';
    $fix  = ra_cfg_repair($caps['exe'], $look,
        xs_test_copy() && is_array($body['assumeAside'] ?? null) ? $body['assumeAside'] : null,
        xs_test_copy() && !empty($body['assumeNoHome']) ? '' : null);
    xs_json(['ok' => true, 'exe' => $caps['exe'], 'looked' => $look] + $fix);
}

$page = trim((string) ($body['page'] ?? ''));

/* The routes, read off RetroArch 1.22.2's own ozone menu: into Settings, down
 * to Input, then down its page to the one asked for. OK is MENU_A, or MENU_B
 * when RetroArch swaps its confirm button, which ra_jump_check reads. */
$routes = [
    'hotkeys' => ['where' => 'Settings > Input > Hotkeys',
                  'route' => 'LEFT DOWN RIGHT DOWN DOWN DOWN OK DOWN DOWN OK'],
    'turbo'   => ['where' => 'Settings > Input > Turbo Fire',
                  'route' => 'LEFT DOWN RIGHT DOWN DOWN DOWN OK DOWN OK'],
    // The first row of the Input page in that same walk: where a controller is taught to RetroArch (js\padhelp.js).
    'binds'   => ['where' => 'Settings > Input > RetroPad Binds',
                  'route' => 'LEFT DOWN RIGHT DOWN DOWN DOWN OK OK'],
];
$jump = null;
if ($page !== '') {
    if (!isset($routes[$page])) {
        xs_fail('no route to that page; this knows ' . implode(' and ', array_keys($routes)), 400);
    }
    $jump = ra_jump_check($caps) + $routes[$page];
}

if (!empty($body['dry']) || xs_test_copy()) {       // never a window from the test server
    xs_json(['ok' => true, 'exe' => $caps['exe'], 'dry' => true,
             'jump' => $jump !== null && $jump['ok'], 'where' => $jump['where'] ?? null,
             'route' => $jump !== null && $jump['ok'] ? $jump['route'] : null,
             'note' => $jump['why'] ?? null]);
}

/* The route is only true of a RetroArch fresh from its start. One that is
 * open already holds the network port, so the presses would land in it,
 * wherever its menu (or its game) is. Asked here, after the dry answer, so a
 * test never runs a tasklist. */
if ($jump !== null && $jump['ok'] && ra_is_running()) {
    $jump['ok']  = false;
    $jump['why'] = 'a RetroArch is open already, and the walk would press its menu wherever it is';
}

/* When it is closed again, and how long it was open, goes in the log
 * (bin\ra-watch.ps1). That line is the watcher's whole job, so with logging
 * off it is not started. */
$watch = static function () use ($caps): void {
    if (!xs_log_enabled()) {
        return;
    }
    xs_spawn_ps(xs_ps_call(XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'ra-watch.ps1', [
        'Exe' => $caps['exe'], 'Since' => (string) time(), 'DataDir' => xs_data_dir(), 'Log' => true,
    ]), ['hidden' => true]);
};

if ($jump !== null && $jump['ok']) {
    $command = xs_ps_call(XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'ra-jump.ps1', [
        'Exe'     => $caps['exe'],
        'NetPort' => $jump['port'],
        'Route'   => $jump['route'],
        'Ok'      => $jump['okBtn'],
        'DataDir' => xs_data_dir(),
        'Log'     => xs_log_enabled(),
    ]);
    if (!xs_spawn_ps($command)) {
        xs_fail('could not start the walk to ' . $jump['where'], 500);
    }
    xs_log('RA', 'opened and walked to ' . $jump['where'] . ' (jump, OK=' . $jump['okBtn'] . ')');
    $watch();
    xs_json(['ok' => true, 'exe' => $caps['exe'], 'jump' => true, 'where' => $jump['where']]);
}

$handle = popen('start "" "' . str_replace('"', '', $caps['exe']) . '"', 'r');
if ($handle === false) {
    xs_fail('could not start RetroArch', 500);
}
pclose($handle);

xs_log('RA', 'opened with no game: ' . $caps['exe']
       . ($jump !== null ? ' (no jump: ' . $jump['why'] . ')' : ''));
$watch();
xs_json(['ok' => true, 'exe' => $caps['exe'], 'jump' => false, 'note' => $jump['why'] ?? null]);
