<?php
/**
 * /api/backup.php - back up and restore the things only you have.
 *
 *   GET                                  health: what is precious, what is
 *                                        held, how old the newest one is
 *   POST {"action":"make"}               write one now
 *   POST {"action":"export","dir":..}    write one into a folder you chose
 *   POST {"action":"import","file":..}   take one in from anywhere: copied
 *                                        into the backup folder and listed,
 *                                        nothing is put back
 *   POST {"action":"inspect","name":..}  what is in it, and what it would
 *                                        land on if it were restored
 *   POST {"action":"restore","name":..,  put chosen parts back. A copy of
 *         "parts":["art",...]}           what is there now is taken first
 *   POST {"action":"remove","name":..}   throw one away
 *
 * Making and restoring run in the request, asking for more time file by file
 * so gigabytes are not ended at PHP's limit; the waiting window shows a bar.
 * A fault of the disk's or Xsegon's own is answered with "report".
 *
 * includes\backup.php says what counts as precious and why.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/backup.php';
require_once __DIR__ . '/../includes/fill.php';
require_once __DIR__ . '/../includes/runcheck.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method !== 'POST') {
    xs_json(['ok' => true] + xs_backup_health());
}

xs_local_origin_only();
$body   = xs_body();
$action = (string) ($body['action'] ?? '');
$name   = (string) ($body['name'] ?? '');

try {
    if ($action === 'make') {
        $res = xs_backup_make();
        xs_json(['ok' => true, 'made' => $res] + xs_backup_health());
    }

    if ($action === 'export') {
        $res = xs_backup_export((string) ($body['dir'] ?? ''));
        xs_json(['ok' => true, 'made' => $res] + xs_backup_health());
    }

    if ($action === 'import') {
        $res = xs_backup_import((string) ($body['file'] ?? ''));
        xs_json(['ok' => true, 'imported' => $res] + xs_backup_health());
    }

    if ($action === 'inspect') {
        xs_json(['ok' => true, 'backup' => xs_backup_inspect($name)]);
    }

    if ($action === 'restore') {
        $parts = $body['parts'] ?? [];
        if (!is_array($parts)) {
            xs_fail('parts must be a list', 400);
        }
        /* Not under a job that writes what a restore puts back: Get Pictures
           stores pictures, the Runs check puts the play history back as it was
           when it ends, a game adds to it. */
        $fill = xs_fill_job();
        if (($fill['state'] ?? '') === 'running' && ($fill['mode'] ?? '') !== 'look') {
            xs_fail('Not restored: Get Pictures is still at work. Let it finish, or press Stop on its bar in the corner, then restore.', 409);
        }
        if (xs_runcheck_active()) {
            xs_fail('Not restored: the Runs check is still going, and when it ends it puts the play history back as it found it. Let it finish or stop it, then restore.', 409);
        }
        if (($game = xs_game_running(true)) !== null) {
            xs_fail('Not restored: ' . ($game['title'] ?? 'a game') . ' is running. Quit it first, then restore.', 409);
        }
        $res = xs_backup_restore($name, array_map('strval', $parts));
        xs_json(['ok' => true, 'restored' => $res] + xs_backup_health());
    }

    if ($action === 'remove') {
        xs_backup_remove($name);
        xs_json(['ok' => true] + xs_backup_health());
    }
} catch (Throwable $e) {
    xs_log('BAK', 'failed: ' . $e->getMessage());
    if ($e->getCode() === XS_BACKUP_FAULT) {
        xs_log('FAIL', '400 ' . $e->getMessage() . ' (backup.php)');
        xs_json(['ok' => false, 'error' => $e->getMessage(), 'report' => true], 400);
    }
    xs_fail($e->getMessage(), 400);
}

xs_fail('unknown action', 400);
