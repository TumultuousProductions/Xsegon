<?php
/**
 * /api/emuset.php - which emulator a game starts in (includes\emuset.php).
 *
 *   GET  ?id=<game id>                 the emulators this game's console has,
 *                                      the one in use and the one chosen
 *   POST {"id", "program"}             this game starts in that one
 *   POST {"id", "clear": true}         back to the one its console uses
 *   POST {"id", "program", "every": true}
 *                                      every game of its console starts in it
 *
 * The choices are the emulators already in the table for that console;
 * Emulators > Add an emulator puts another one there.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/emuset.php';
require_once __DIR__ . '/../includes/emuadd.php';

$s = xs_settings();

function xs_emuset_find_game(string $id, array $lib): array
{
    foreach ($lib['games'] ?? [] as $g) {
        if ($g['id'] === $id) {
            return $g;
        }
    }
    xs_fail('unknown game', 404);
}

$table = xs_emulators(xs_norm_path((string) $s['paths']['launchbox']));

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    $id = trim((string) ($_GET['id'] ?? ''));
    if ($id === '') {
        xs_fail('no game id');
    }
    // Read once: the game is found in it and its console's games counted from it.
    $lib  = xs_library();
    $game = xs_emuset_find_game($id, $lib);
    if (!empty($game['local'])) {
        xs_json(['ok' => true, 'id' => $id, 'rows' => [], 'chosen' => null, 'usual' => null,
                 'why' => 'a game of your own starts its own program']);
    }
    $platform = (string) $game['platform'];
    $rows = xs_emuset_rows($table, $platform);
    $usual = null;
    foreach ($rows as $i => $r) {
        $rows[$i]['retroarch'] = xs_emu_is_retroarch($table, $r['program']);
        $usual = $r['usual'] ? $r['program'] : $usual;
    }
    // A choice the console no longer has is not in force, so it is not said.
    $chosen = xs_emuset_read()[$id] ?? null;
    if ($chosen !== null && !in_array($chosen, array_column($rows, 'program'), true)) {
        $chosen = null;
    }
    $why = null;
    if (!$rows) {
        $why = $platform . ' has no emulator yet: Emulators > Add an emulator gives it one';
    } elseif (count($rows) === 1) {
        $why = $platform . ' has one emulator, ' . $rows[0]['name']
             . '. Emulators > Add an emulator adds another, and both are offered here.';
    }
    $counts = xs_emu_game_counts($lib);
    xs_json(['ok' => true, 'id' => $id, 'platform' => $platform, 'games' => $counts[strtolower($platform)] ?? 0,
             'rows' => $rows, 'chosen' => $chosen, 'usual' => $usual, 'why' => $why]);
}

xs_local_origin_only();
$body = xs_body();
$id   = xs_id_or_fail($body['id'] ?? '');
$game = xs_game_or_404($id);
if (!empty($game['local'])) {
    xs_fail('a game of your own starts its own program', 409);
}
$platform = (string) $game['platform'];

if (!empty($body['clear'])) {
    if (!xs_emuset_set($id, null, $why)) {
        xs_fail((string) $why, 500);
    }
    xs_log('EMU', $game['title'] . ' starts in its console\'s emulator again');
    xs_json(['ok' => true, 'id' => $id, 'chosen' => null]);
}

// Only an emulator this console has, and one that is on the disk.
$key = trim((string) ($body['program'] ?? ''));
$row = null;
foreach (xs_emuset_rows($table, $platform) as $r) {
    if ($r['program'] === $key) {
        $row = $r;
    }
}
if ($row === null) {
    xs_fail('that emulator is not one ' . $platform . ' has', 409);
}
if (!$row['there']) {
    xs_fail($row['name'] . ' is not where the table says: Settings > Emulators points it at its file', 409);
}

if (!empty($body['every'])) {
    unset($table['mine']);
    $from = xs_emuset_usual($table, $platform, $key);
    if ($from === null) {
        xs_fail('that emulator is not one ' . $platform . ' has', 409);
    }
    if ($from !== '' && !xs_emulators_write($table, $why)) {
        xs_fail((string) $why, 500);
    }
    if ($from !== '') {
        xs_log('EMU', $platform . ' games start in ' . $row['name'] . ' (' . $key . ') now, in place of ' . $from);
    }
    xs_json(['ok' => true, 'platform' => $platform, 'usual' => $key, 'name' => $row['name'], 'was' => $from]);
}

if (!xs_emuset_set($id, $key, $why)) {
    xs_fail((string) $why, 500);
}
xs_log('EMU', $game['title'] . ' starts in ' . $row['name'] . ' (' . $key . ')' . ($row['usual'] ? ', which its console uses anyway' : ''));
xs_json(['ok' => true, 'id' => $id, 'chosen' => $key, 'name' => $row['name']]);
