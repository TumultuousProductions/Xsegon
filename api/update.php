<?php
/**
 * /api/update.php - a new version of Xsegon, for the mailbox's Update now and
 * Settings > Window > New versions (js\updaterow.js).
 *
 *   GET                       this version, one waiting or out, one being got
 *                             ready, one to go back to, a press waiting for the
 *                             next start, the last look for a newer one, and
 *                             whether new versions download by themselves
 *                             (includes\update.php xs_update_state)
 *   POST {"action":"get"}     Update now with nothing downloaded yet: the newer
 *                             version is got ready in the background; the page
 *                             follows it and presses update when it is
 *   POST {"action":"update"}  Update now: a backup of the data, then the press
 *                             written down; start.ps1 puts it in place with no
 *                             server running, at once when it opened Xsegon out of
 *                             sight (restarts), else at the next start
 *   POST {"action":"back"}    Go back to the version before, the same way
 *
 * Nothing of Xsegon's own files changes here.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/boot.php';
require_once __DIR__ . '/../includes/update.php';
require_once __DIR__ . '/../includes/newversion.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    xs_local_origin_only();
    $what = (string) (xs_body()['action'] ?? '');
    if ($what !== 'update' && $what !== 'back' && $what !== 'get') {
        xs_fail('unknown action', 400);
    }
    $why = $what === 'get' ? xs_update_get_now() : xs_update_press($what);
    if ($why !== null) {
        xs_fail($why, 409);
    }
    xs_json(['ok' => true] + xs_update_state());
}

$look = xs_read_json(xs_newversion_path(), []);
xs_json(['ok' => true, 'on' => xs_newversion_on(), 'get' => xs_newversion_get(), 'release' => xs_newversion_have() !== null,
         'look' => is_array($look) ? array_intersect_key($look, array_flip(['at', 'newest', 'newer', 'error', 'page'])) : []] + xs_update_state());
