<?php
/**
 * /api/emusetup.php - the standalone emulators in Settings > RetroArch + Emulator Controls
 * (includes\emus.php, includes\emusetup.php).
 *
 *   GET                        each emulator the table starts games in: how a game in it is
 *                              left, what Set up writes or why it needs none, whether it is on
 *   POST {"key", "on": true}   Set up: its own Xsegon profiles written
 *   POST {"key", "on": false}  Put back: every line and profile Xsegon wrote taken away
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/emusetup.php';

$programs = xs_es_programs();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    $rows = [];
    // The most played first, as the user's order for this work has them (roadmap CA2).
    foreach (['cemu', 'eden', 'dolphin', 'xenia', 'rpcs3', 'pcsx2', 'xemu'] as $key) {
        $e = xs_emus()[$key] ?? null;
        if ($e === null || !isset($programs[$key])) {
            continue;
        }
        $exe = $programs[$key];
        $home = xs_emu_home($e, $exe);
        $rec = xs_es_rec($key);
        $rows[] = ['key' => $key, 'name' => $e['name'], 'exe' => $exe, 'home' => $home,
                   'leave' => xs_emu_leave($e, $home),
                   'canSetUp' => !empty($e['setup']),
                   'words' => !empty($e['setup']) ? $e['setup']['words'] : ($e['setupNone'] ?? $e['setupLater'] ?? ''),
                   'later' => empty($e['setup']) && isset($e['setupLater']),
                   'on' => !empty($rec['on']), 'at' => $rec['at'] ?? null, 'games' => count((array) $rec['games'])];
    }
    xs_json(['ok' => true, 'emus' => $rows]);
}

xs_local_origin_only();
$body = xs_body();
$key = (string) ($body['key'] ?? '');
$e = xs_emus()[$key] ?? null;
if ($e === null || !isset($programs[$key])) {
    xs_fail('no emulator ' . $key . ' starts games here', 404);
}
$why = null;
$ok = !empty($body['on']) ? xs_es_on($e, $programs[$key], $why) : xs_es_off($e, $programs[$key], $why);
if (!$ok) {
    xs_fail((string) ($why ?? 'it could not be done'), 409);
}
$rec = xs_es_rec($key);
xs_json(['ok' => true, 'key' => $key, 'on' => !empty($rec['on']), 'games' => count((array) $rec['games'])]);
