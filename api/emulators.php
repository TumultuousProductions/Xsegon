<?php
/**
 * /api/emulators.php - Xsegon's own emulator table.
 *
 *   GET                                  the programs, which consoles use each,
 *                                        and whether the file is really there
 *   POST {"program": "...", "exe": "..."} point one somewhere else
 *   POST {"reseed": true}                 read them from LaunchBox again
 *   POST {"action": "look", "exe": "..."}      what Xsegon knows about a program,
 *                                        and every console it could be given
 *                                        ("program" instead: one in the table)
 *   POST {"action": "add", "exe", "name", "args", "consoles": [...]}
 *                                        an emulator of your own
 *   POST {"action": "change", "program", "name", "args", "consoles", "exe"}
 *   POST {"action": "remove", "program"}
 *
 * Moving RetroArch is one path changed here: it finds its cores, shaders,
 * saves and states relative to its own folder.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/emulators.php';
require_once __DIR__ . '/../includes/setup.php';
require_once __DIR__ . '/../includes/emuadd.php';

$s    = xs_settings();
$root = xs_norm_path($s['paths']['launchbox']);

/** The table dressed for the screen: what each program runs, and if it exists. */
function xs_emulators_view(array $table): array
{
    $names = xs_emu_console_names();
    $uses = [];
    $plays = [];
    foreach ($table['platforms'] ?? [] as $platform => $entry) {
        foreach ($entry['options'] ?? [] as $o) {
            $key = $o['program'] ?? '';
            if ($key === '') {
                continue;
            }
            $uses[$key][$platform] = true;
        }
        // The one this console's games start in.
        $now = xs_emu_option($table, (string) $platform);
        if ($now !== null) {
            $plays[(string) ($now['program'] ?? '')][(string) $platform] = $names[(string) $platform] ?? null;
        }
    }
    $programs = [];
    foreach ($table['programs'] ?? [] as $key => $p) {
        $consoles = array_keys($uses[$key] ?? []);
        sort($consoles);
        // A console under a second spelling (an old table's "xbox") is said once, by the name shown.
        $started = array_values(array_filter($plays[$key] ?? [])) ?: array_map('ucwords', array_keys($plays[$key] ?? []));
        sort($started);
        $programs[] = [
            'key'      => $key,
            'name'     => $p['name'],
            'exe'      => $p['exe'],
            'there'    => is_file($p['exe']),
            'consoles' => $consoles,
            'plays'    => $started,
            'kind'     => xs_emu_is_retroarch($table, (string) $key) ? 'retroarch' : 'other',
        ];
    }
    // The one doing the most work first.
    usort($programs, static fn ($a, $b) => count($b['consoles']) <=> count($a['consoles'])
                                           ?: strcmp($a['name'], $b['name']));
    return $programs;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    $table = xs_emulators($root);
    $lib   = xs_library();
    // Games are counted only for the consoles you have.
    $games = xs_emu_game_counts($lib);
    $names = xs_emu_console_names($lib);
    // Consoles with games and nothing to start them: what Add an emulator is for.
    $without = [];
    foreach ($games as $low => $n) {
        if (xs_emu_option($table, (string) $low) === null) {
            $without[] = ['name' => $names[$low] ?? ucwords((string) $low), 'games' => $n];
        }
    }
    $mine = xs_read_json(xs_emulators_path(), null);
    xs_json([
        'ok'        => true,
        'mine'      => is_array($mine),
        'made'      => $table['made'] ?? null,
        'path'      => xs_emulators_path(),
        'programs'  => xs_emulators_view($table),
        'consoles'  => count($table['platforms'] ?? []),
        'yours'     => count($games),
        'without'   => $without,
        'canReseed' => $root !== '' && is_dir($root),
    ]);
}

xs_local_origin_only();
$body = xs_body();

if (!empty($body['reseed'])) {
    if ($root === '' || !is_dir($root)) {
        xs_fail('LaunchBox is not at ' . ($root ?: '(no path set)') . ', so there is nothing to read', 409);
    }
    if (!xs_emulators_write(xs_emulators_seed($root), $why)) {
        xs_fail((string) $why, 500);
    }
    xs_log('EMU', 'read again from LaunchBox');
    // The RetroArch Xsegon fetched is not in LaunchBox, so reading LaunchBox
    // again would forget it. Put it back for any console left with nothing.
    if (is_file(xs_own_ra_exe())) {
        xs_setup_register(xs_own_ra_exe(), true);
    }
    xs_json(['ok' => true, 'programs' => xs_emulators_view(xs_emulators($root))]);
}

/* ---- an emulator of your own: look, add, change, remove ------------------ */
$action = (string) ($body['action'] ?? '');
if ($action !== '') {
    $table = xs_emulators($root);
    unset($table['mine']);
    if (empty($table['programs'])) {
        $table = ['made' => date('c'), 'from' => 'Xsegon', 'programs' => [], 'platforms' => []];
    }
    $lib = xs_library();
    $key = trim((string) ($body['program'] ?? ''));

    if ($action === 'look') {
        $exe = xs_norm_path(trim((string) ($body['exe'] ?? '')));
        if ($key !== '' && !isset($table['programs'][$key])) {
            xs_fail('no such program in the table', 404);
        }
        if ($key === '' && ($exe === '' || !is_file($exe))) {
            xs_fail($exe === '' ? 'no program chosen' : 'there is no file at ' . $exe, 409);
        }
        xs_json(['ok' => true] + xs_emu_look($table, $lib, $exe, $key));
    }

    if ($action === 'remove') {
        $name = (string) ($table['programs'][$key]['name'] ?? $key);
        $bare = xs_emu_drop($table, $key, $why);
        if ($bare === null) {
            xs_fail((string) $why, 409);
        }
        if (!xs_emulators_write($table, $why)) {
            xs_fail((string) $why, 500);
        }
        xs_log('EMU', 'removed ' . $name . ' (' . $key . ')' . ($bare ? '; left with no emulator: ' . implode(', ', $bare) : ''));
        xs_json(['ok' => true, 'removed' => $key, 'name' => $name, 'bare' => $bare]);
    }

    if ($action === 'add' || $action === 'change') {
        if ($action === 'change' && $key === '') {
            xs_fail('say which emulator to change');
        }
        $did = xs_emu_put($table, $lib, [
            'key'      => $action === 'change' ? $key : '',
            'exe'      => (string) ($body['exe'] ?? ''),
            'name'     => (string) ($body['name'] ?? ''),
            'args'     => (string) ($body['args'] ?? ''),
            'consoles' => is_array($body['consoles'] ?? null) ? $body['consoles'] : [],
        ], $why);
        if ($did === null) {
            xs_fail((string) $why, 409);
        }
        if (!xs_emulators_write($table, $why)) {
            xs_fail((string) $why, 500);
        }
        $counts = xs_emu_game_counts($lib);
        $rows = [];
        foreach ($did['consoles'] as $c) {
            $rows[] = ['name' => $c, 'games' => $counts[strtolower($c)] ?? 0, 'folder' => xs_emu_folder_for($c),
                       'took' => $did['took'][$c] ?? null];
        }
        xs_log('EMU', ($did['new'] ? 'added ' : 'changed ') . $did['name'] . ' (' . $did['key'] . ') at ' . $did['exe']
            . ' for ' . implode(', ', $did['consoles']) . '; options "' . trim((string) ($body['args'] ?? '')) . '"'
            . ($did['took'] ? '; took over ' . implode(', ', array_map(static fn ($c, $from) => $c . ' from ' . $from,
                                                                         array_keys($did['took']), $did['took'])) : '')
            . ($did['left'] ? '; no longer plays ' . implode(', ', $did['left']) : ''));
        xs_json(['ok' => true, 'program' => $did['key'], 'name' => $did['name'], 'exe' => $did['exe'],
                 'new' => $did['new'], 'rows' => $rows, 'left' => $did['left']]);
    }
    xs_fail('unknown action');
}

$key = trim((string) ($body['program'] ?? ''));
$exe = xs_norm_path(trim((string) ($body['exe'] ?? '')));
if ($key === '' || $exe === '') {
    xs_fail('say which program, and where it is');
}
$table = xs_emulators($root);
if (!isset($table['programs'][$key])) {
    xs_fail('no such program in the table', 404);
}
/* The file has to be there: a path to nothing would leave every game on that
   console unplayable with no clue why. */
if (!is_file($exe)) {
    xs_fail('there is no file at ' . $exe, 409);
}
$was = $table['programs'][$key]['exe'];
$table['programs'][$key]['exe'] = $exe;
unset($table['mine']);
if (!xs_emulators_write($table, $why)) {
    xs_fail((string) $why, 500);
}
xs_log('EMU', $key . ': ' . $was . ' -> ' . $exe);
/* No re-import needed: a launch asks the table where its program is now
   (xs_emu_repoint), so a move never depends on reading LaunchBox again. */
xs_json(['ok' => true, 'program' => $key, 'exe' => $exe, 'was' => $was]);
