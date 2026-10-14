<?php
/**
 * /api/gamesdb-update.php - updates of the Games Database, for Settings >
 * Library (js\settings-ui.js).
 *
 *   GET                       which copy is in use, when it was built, whether
 *                             updates are automatic or manual, and what the
 *                             last check found (includes\gamesdb.php
 *                             xs_gamesdb_status)
 *   POST {"action":"check"}   Check now: start bin\gamesdb-update.php in the
 *                             background, whatever the day or the setting.
 *                             The screen asks GET again to see how it went.
 *
 * Nothing is checked while filling uses libretro or this PHP cannot read the database.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/gamesdb.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    xs_local_origin_only();
    $body = xs_body();
    if (($body['action'] ?? '') !== 'check') {
        xs_fail('unknown action', 400);
    }
    if (!xs_gamesdb_updates_apply()) {
        xs_fail('there is nothing to check: filling uses libretro, or nothing here can read the database', 409);
    }
    $st = xs_gamesdb_status();
    if ($st['running']) {
        xs_json(['ok' => true, 'started' => false, 'status' => $st]);
    }
    if (!xs_gamesdb_update_start(false)) {
        xs_fail('the check could not be started', 500);
    }
    xs_json(['ok' => true, 'started' => true]);
}

xs_json(['ok' => true] + xs_gamesdb_status());
