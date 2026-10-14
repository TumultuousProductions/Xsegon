<?php
/**
 * /api/cores.php - which RetroArch core a game runs on (includes\cores.php).
 *
 *   GET  ?id=<game id>            the cores this game could run on, and which
 *                                 one is chosen, with why if there is no choice
 *   POST {"id": "...", "core": "snes9x"}   remember that core for this game
 *   POST {"id": "...", "clear": true}      go back to the usual core
 *
 * The choices are the cores configured for that game's platform, one row per
 * core: a core is console-specific, so the whole cores folder is no choice.
 *
 * An overlay in data\cores.json.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/cores.php';

$s = xs_settings();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    $id = trim((string) ($_GET['id'] ?? ''));
    if ($id === '') {
        xs_fail('no game id');
    }
    $game = xs_game_or_404($id);

    // A game of your own runs a program or opens an address: no core.
    if (!empty($game['local'])) {
        xs_json(['ok' => true, 'id' => $id, 'cores' => [], 'chosen' => null,
                 'why' => 'a game of your own does not run on a core']);
    }

    $table  = xs_emulators(xs_norm_path($s['paths']['launchbox']));
    $cores  = xs_emu_cores($table, (string) $game['platform']);
    // A console given an emulator of its own keeps RetroArch's cores in the
    // table, and none of them runs this game.
    if (!empty($game['launch']) && ($game['launch']['kind'] ?? '') !== 'retroarch') {
        $cores = [];
    }
    $chosen = xs_core_for($id);

    /* Three ways to have nothing to offer, each said in its own words. With
       no emulator table at all (no data\emulators.json and no LaunchBox to
       seed one), "does not run on RetroArch" would be false. */
    $why = null;
    if (!$table['programs']) {
        $why = 'Xsegon has no emulator table yet, and cannot read one from '
             . (trim((string) $s['paths']['launchbox']) ?: '(no LaunchBox path set)')
             . '. Re-read the library once and it will have one. The game still plays on the core it already has.';
    } elseif (!$cores) {
        $via = $game['launch']['via'] ?? '';
        $why = $game['platform'] . ' does not run on RetroArch'
             . ($via !== '' ? ', it runs on ' . preg_replace('/\s*\(.*$/', '', $via) : '');
    } elseif (count($cores) === 1) {
        $why = $game['platform'] . ' has one core set up, ' . $cores[0]['core'];
    }

    xs_json(['ok' => true, 'id' => $id, 'platform' => $game['platform'],
             'cores' => $cores, 'chosen' => $chosen, 'why' => $why]);
}

xs_local_origin_only();
$body = xs_body();
$id   = xs_id_or_fail($body['id'] ?? '');
$game = xs_game_or_404($id);

if (!empty($body['clear'])) {
    if (!xs_core_set($id, null, $why)) {
        xs_fail((string) $why, 500);
    }
    xs_log('CORE', 'cleared for ' . $game['title']);
    xs_json(['ok' => true, 'id' => $id, 'chosen' => null]);
}

$core = trim((string) ($body['core'] ?? ''));
if ($core === '') {
    xs_fail('no core given');
}
// Only a core this platform offers: any other could not load the ROM, and
// would look like a broken game.
$cores = xs_emu_cores(xs_emulators(xs_norm_path($s['paths']['launchbox'])), (string) $game['platform']);
$match = null;
foreach ($cores as $c) {
    if ($c['core'] === $core) {
        $match = $c;
        break;
    }
}
if ($match === null) {
    xs_fail('that core is not set up for ' . $game['platform'], 409);
}
if (!xs_core_set($id, $core, $why)) {
    xs_fail((string) $why, 500);
}
xs_log('CORE', $game['title'] . ' -> ' . $core);
xs_json(['ok' => true, 'id' => $id, 'chosen' => $core, 'was' => $match['default'] ? 'the default' : null]);
