<?php
/**
 * Xsegon's own emulator table (data\emulators.json): where each emulator is and which
 * core runs which console, so choosing a core does not need LaunchBox. Seeded from
 * LaunchBox's Emulators.xml; deleting the file reads LaunchBox again.
 *
 * One entry per (emulator, console) pair, and the args belong to the pair, as in
 * LaunchBox: a game that names its own emulator gets that emulator's line, not the
 * console default's (with, say, its shader).
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/launchbox.php';

/** Where the table lives. */
function xs_emulators_path(): string
{
    return xs_data_path('emulators.json');
}

/**
 * An absolute path with every ".." folded away: LaunchBox's relative paths with ".." mean
 * the right folder only while LaunchBox stays put. realpath() first; folded by hand otherwise.
 */
function xs_abs_path(string $path): string
{
    if ($path === '') {
        return '';
    }
    $real = @realpath($path);
    if (is_string($real) && $real !== '') {
        return $real;
    }
    $path  = str_replace('/', DIRECTORY_SEPARATOR, $path);
    $parts = explode(DIRECTORY_SEPARATOR, $path);
    $out   = [];
    foreach ($parts as $p) {
        if ($p === '.' || $p === '') {
            if ($out === [] && $p === '') { $out[] = ''; }   // keep a UNC lead
            continue;
        }
        if ($p === '..' && $out && end($out) !== '..') {
            array_pop($out);
            continue;
        }
        $out[] = $p;
    }
    return implode(DIRECTORY_SEPARATOR, $out);
}

/** A stable key for a program, from its file name: "dolphin", "rpcs3". */
function xs_emu_key(string $exe): string
{
    $base = basename(str_replace('\\', '/', $exe));
    $base = preg_replace('/\.(exe|bat|cmd|lnk)$/i', '', $base) ?? $base;
    $key  = strtolower(preg_replace('/[^A-Za-z0-9]+/', '-', $base) ?? $base);
    return trim($key, '-') ?: 'emulator';
}

/**
 * Build the table from LaunchBox. Every ApplicationPath is made absolute now, so the
 * stored table means the same after LaunchBox is gone.
 */
function xs_emulators_seed(string $root): array
{
    $lb       = lb_emulators($root);
    $programs = [];
    $byId     = [];                     // LaunchBox emulator id => program key

    foreach ($lb['byId'] as $id => $e) {
        $exe = xs_abs_path(xs_resolve($root, $e['path']));
        if ($exe === '') {
            continue;                   // "<< Emulator Not Assigned >>" has no path
        }
        $key = xs_emu_key($exe);
        // Several LaunchBox entries share one program (RetroArch's): the shortest title is kept.
        if (!isset($programs[$key])) {
            $programs[$key] = [
                'name'     => $e['title'],
                'exe'      => $exe,
                'args'     => $e['commandLine'],
                'noQuotes' => (bool) $e['noQuotes'],
            ];
        } elseif (mb_strlen($e['title']) < mb_strlen($programs[$key]['name'])) {
            $programs[$key]['name'] = $e['title'];
        }
        $byId[$id] = $key;
    }

    $platforms = [];
    foreach ($lb['byPlatform'] as $platformKey => $entries) {
        foreach ($entries as $id => $info) {
            if (!isset($byId[$id])) {
                continue;
            }
            $prog = $programs[$byId[$id]];
            $args = $info['commandLine'] !== '' ? $info['commandLine'] : $prog['args'];
            $load = lb_core_load($args);
            $platforms[$platformKey]['options'][] = [
                'program'    => $byId[$id],
                'emulator'   => $lb['byId'][$id]['title'],
                'emulatorId' => $id,
                'args'       => $args,
                'core'       => $load !== null ? lb_core_name($load) : null,
                'load'       => $load,
                'default'    => !empty($info['default']),
            ];
        }
    }
    ksort($platforms);

    return [
        'made'      => date('c'),
        'from'      => 'LaunchBox ' . $root,
        'programs'  => $programs,
        'platforms' => $platforms,
    ];
}

/** Write the table. */
function xs_emulators_write(array $table, ?string &$why = null): bool
{
    return xs_write_json(xs_emulators_path(), $table, $why);
}

/**
 * The table to use: yours first, else LaunchBox read live. With $root '' and no file,
 * an empty table rather than an error.
 */
function xs_emulators(string $root = ''): array
{
    $mine = xs_read_json(xs_emulators_path(), null);
    if (is_array($mine) && !empty($mine['programs']) && isset($mine['platforms'])) {
        $mine['mine'] = true;
        return $mine;
    }
    if ($root !== '' && is_dir($root)) {
        $seeded = xs_emulators_seed($root);
        $seeded['mine'] = false;
        return $seeded;
    }
    return ['programs' => [], 'platforms' => [], 'mine' => false];
}

/** No emulator in the table is on this PC: a new copy before RetroArch is in. Wheel,
    Carousel and the consoles screen wait meanwhile (index.php, api\library.php): they have no menu bar. */
function xs_emu_none_here(string $root = ''): bool
{
    foreach (xs_emulators($root)['programs'] ?? [] as $p) {
        $exe = (string) ($p['exe'] ?? '');
        if ($exe !== '' && (function_exists('xs_file_seen') ? xs_file_seen($exe) : is_file($exe))) {
            return false;
        }
    }
    return true;
}

/** Every option for one console, in the order the table holds them. */
function xs_emu_options(array $table, string $platform): array
{
    return $table['platforms'][strtolower($platform)]['options'] ?? [];
}

/**
 * Which option launches this game: the one its emulator names, else the console's
 * default, else the only one. Null when the console has nothing set up.
 */
function xs_emu_option(array $table, string $platform, string $emulatorId = ''): ?array
{
    $options = xs_emu_options($table, $platform);
    if (!$options) {
        return null;
    }
    if ($emulatorId !== '') {
        foreach ($options as $o) {
            if (($o['emulatorId'] ?? '') === $emulatorId) {
                return $o;
            }
        }
    }
    foreach ($options as $o) {
        if (!empty($o['default'])) {
            return $o;
        }
    }
    return count($options) === 1 ? $options[0] : null;
}

/** The cores a console can run, one row per UNIQUE core. */
function xs_emu_cores(array $table, string $platform): array
{
    $out = [];
    foreach (xs_emu_options($table, $platform) as $o) {
        $core = $o['core'] ?? null;
        if ($core === null || $core === '') {
            continue;
        }
        if (isset($out[$core])) {
            if (!empty($o['default'])) {
                $out[$core]['default']  = true;
                $out[$core]['emulator'] = $o['emulator'];
            }
            continue;
        }
        $out[$core] = [
            'core'     => $core,
            'load'     => $o['load'],
            'emulator' => $o['emulator'],
            'default'  => !empty($o['default']),
        ];
    }
    return array_values($out);
}

/**
 * Turn a game into something runnable, from the table: the same answer as
 * lb_launch_command(). $root is only for a ROM path LaunchBox stored relative to itself.
 */
function xs_emu_launch(array $table, array $game, string $root = ''): array
{
    if (($game['romPath'] ?? '') === '') {
        return ['error' => 'no ROM path in LaunchBox'];
    }
    $rom    = xs_resolve($root, $game['romPath']);
    $option = xs_emu_option($table, (string) $game['platform'], (string) ($game['emulatorId'] ?? ''));
    if ($option === null) {
        return ['error' => 'no emulator set up for ' . $game['platform']];
    }
    $prog = $table['programs'][$option['program']] ?? null;
    if ($prog === null || ($prog['exe'] ?? '') === '') {
        return ['error' => 'emulator has no application path'];
    }

    $args   = (string) $option['args'];
    $quoted = !empty($prog['noQuotes']) ? $rom : '"' . $rom . '"';
    $usedDefault = ($game['emulatorId'] ?? '') === '' || ($option['emulatorId'] ?? '') !== $game['emulatorId'];

    return [
        'exe'  => $prog['exe'],
        'args' => trim($args . ' ' . $quoted),
        'rom'  => $rom,
        'kind' => empty($option['own']) && str_contains(strtolower($args), '-l ') ? 'retroarch' : 'emulator',
        'via'  => $option['emulator'] . ($usedDefault ? ' (platform default)' : ''),
        // So a launch can ask the table where the program is now, with no re-import.
        'program' => $option['program'],
    ];
}

/**
 * Point a stored launch command at where its program lives today, by the program key the
 * import wrote, so a path changed in the table works at once.
 */
function xs_emu_repoint(array $launch, array $table, string $platform = ''): array
{
    $key = $launch['program'] ?? '';
    /* A launch with no program key: the console's entry is asked, where the key would
       have come from. */
    if ($key === '' && $platform !== '') {
        $option = xs_emu_option($table, $platform, (string) ($launch['emulatorId'] ?? ''));
        $key    = $option['program'] ?? '';
    }
    if ($key === '' || !isset($table['programs'][$key]['exe'])) {
        return $launch;
    }
    $now = (string) $table['programs'][$key]['exe'];
    if ($now !== '' && $now !== ($launch['exe'] ?? '')) {
        $launch['exe'] = $now;
    }
    return $launch;
}

/**
 * The name of a standalone emulator a launch runs in (Dolphin, Ryujinx). Null for
 * RetroArch, a game of your own, no launch, or a script, which opens nothing alone.
 */
function xs_emu_name(?array $launch): ?string
{
    if ($launch === null || !empty($launch['local']) || ($launch['kind'] ?? '') !== 'emulator') {
        return null;
    }
    $exe = (string) ($launch['exe'] ?? '');
    if (!preg_match('/\.exe$/i', $exe) || str_starts_with(strtolower(basename($exe)), 'retroarch')) {
        return null;
    }
    // "Ryujinx (platform default)", "Dolphin (your choice)": the name alone.
    $name = trim((string) preg_replace('/\s*\((?:platform default|your choice)\)$/', '', (string) ($launch['via'] ?? '')));
    return $name !== '' ? $name : null;
}

/**
 * What opening a game's emulator with no game starts: ['name', 'exe', 'dir'], or
 * ['error' => why]. Where the program is comes from the table, as for a launch.
 */
function xs_emu_alone(array $game): array
{
    $launch = is_array($game['launch'] ?? null) ? $game['launch'] : null;
    $name   = xs_emu_name($launch);
    if ($name === null) {
        if ($launch === null) {
            return ['error' => 'this game has nothing that starts it: ' . (string) ($game['launchError'] ?? 'no emulator is set up for it')];
        }
        if (!empty($launch['local'])) {
            return ['error' => 'a game of your own runs its own program, not an emulator'];
        }
        $ra = ($launch['kind'] ?? '') === 'retroarch' || str_starts_with(strtolower(basename((string) ($launch['exe'] ?? ''))), 'retroarch');
        return ['error' => $ra ? 'this game runs in RetroArch: Emulators > Open RetroArch opens it'
                               : 'this game is started by a script, which has nothing to open without a game'];
    }
    $s      = xs_settings();
    $launch = xs_emu_repoint($launch, xs_emulators(xs_norm_path((string) ($s['paths']['launchbox'] ?? ''))), (string) ($game['platform'] ?? ''));
    $exe    = (string) ($launch['exe'] ?? '');
    if (!xs_file_seen($exe)) {
        return ['error' => $name . ' is not where the table says (Settings > Emulators)'];
    }
    return ['name' => $name, 'exe' => $exe, 'dir' => dirname($exe)];
}

/**
 * Start a program with nothing handed to it, in the folder given (a portable
 * emulator looks for its settings there), and do not wait for it.
 */
function xs_emu_start(string $exe, string $dir): bool
{
    $handle = @popen('start "" /D "' . str_replace('"', '', $dir) . '" "' . str_replace('"', '', $exe) . '"', 'r');
    if ($handle === false) {
        return false;
    }
    pclose($handle);
    return true;
}
