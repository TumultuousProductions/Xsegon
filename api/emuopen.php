<?php
/**
 * POST /api/emuopen.php  {"id": "<game id>"} - open the emulator a game runs
 * in, with no game.
 *
 * For a game not run in RetroArch (which has api\retroarch.php): the emulator
 * open for its own settings, controllers, firmware or keys.
 *
 * The program is the game's own launch's, from the table (xs_emu_alone),
 * started detached in its own folder, where a portable emulator looks for its
 * settings. {"dry": true} answers with the program and starts nothing.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';

xs_post_only();
xs_local_origin_only();

$body = xs_body();
$id   = xs_id_or_fail($body['id'] ?? '');
$game = xs_game_or_404($id);

$open = xs_emu_alone($game);
if (isset($open['error'])) {
    xs_fail((string) $open['error'], 409);
}

if (!empty($body['dry']) || xs_test_copy()) {       // never a window from the test server
    xs_json(['ok' => true, 'dry' => true] + $open);
}

if (!xs_emu_start($open['exe'], $open['dir'])) {
    xs_fail('could not start ' . $open['name'], 500);
}

xs_log('EMU', 'opened with no game: ' . $open['name'] . ' (' . $open['exe'] . '), from ' . (string) ($game['title'] ?? $id));
xs_json(['ok' => true] + $open);
