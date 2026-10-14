<?php
/**
 * Xsegon - which emulator one game starts in, kept as an overlay.
 *
 * A console's games start in the emulator in use for it. A game that runs
 * better in another one is remembered in data\emu-choice.json, game id =>
 * the program's key in the table, and laid over the game as the library is
 * read. A choice naming a program the console no longer has is ignored.
 */
declare(strict_types=1);

require_once __DIR__ . '/emulators.php';

/** Where the choices live. */
function xs_emuset_path(): string
{
    return xs_data_path('emu-choice.json');
}

/** Every choice, as [game id => program key]. */
function xs_emuset_read(): array
{
    $raw = xs_read_json(xs_emuset_path(), []);
    $out = [];
    foreach (is_array($raw) ? $raw : [] as $id => $key) {
        if (is_string($id) && is_string($key) && $id !== '' && $key !== '') {
            $out[$id] = $key;
        }
    }
    return $out;
}

/** Remember a choice, or forget it when $key is null. */
function xs_emuset_set(string $id, ?string $key, ?string &$why = null): bool
{
    $all = xs_emuset_read();
    if ($key === null || $key === '') {
        unset($all[$id]);
    } else {
        $all[$id] = $key;
    }
    return xs_write_json(xs_emuset_path(), $all, $why);
}

/** The option a program has for one console: the one in use, else the one before it, else its first. */
function xs_emuset_option(array $table, string $platform, string $key): ?array
{
    $entry = $table['platforms'][strtolower($platform)] ?? [];
    $mine  = array_values(array_filter($entry['options'] ?? [], static fn ($o) => ($o['program'] ?? '') === $key));
    if (!$mine || !isset($table['programs'][$key])) {
        return null;
    }
    $before = (string) ($entry['before'] ?? '');
    foreach ($mine as $o) {
        if (!empty($o['default'])) {
            return $o;
        }
    }
    foreach ($mine as $o) {
        if ($before !== '' && ($o['emulatorId'] ?? '') === $before) {
            return $o;
        }
    }
    return $mine[0];
}

/** The emulators a console has, one row a program, the one in use marked. */
function xs_emuset_rows(array $table, string $platform): array
{
    $usual = xs_emu_option($table, $platform);
    $rows  = [];
    foreach (xs_emu_options($table, $platform) as $o) {
        $key = (string) ($o['program'] ?? '');
        if ($key === '' || isset($rows[$key]) || !isset($table['programs'][$key])) {
            continue;
        }
        $exe = (string) ($table['programs'][$key]['exe'] ?? '');
        $rows[$key] = [
            'program' => $key,
            'name'    => (string) ($table['programs'][$key]['name'] ?? $key),
            // Two builds of one emulator are told apart by where they are.
            'folder'  => basename(dirname(str_replace('\\', '/', $exe))),
            'there'   => is_file($exe),
            'usual'   => $usual !== null && ($usual['program'] ?? '') === $key,
        ];
    }
    return array_values($rows);
}

/** The launch for one game's file in the emulator an option names, or null with $why. */
function xs_emuset_command(array $table, array $opt, string $rom, ?string &$why = null): ?array
{
    $key  = (string) ($opt['program'] ?? '');
    $prog = $table['programs'][$key] ?? null;
    $name = (string) ($prog['name'] ?? $opt['emulator'] ?? 'the emulator');
    if ($prog === null || !is_file((string) ($prog['exe'] ?? ''))) {
        $why = $name . ', chosen for this game, is not where the table says (Set Emulator chooses another)';
        return null;
    }
    $quoted = !empty($prog['noQuotes']) ? $rom : '"' . $rom . '"';
    $args   = trim((string) ($opt['args'] ?? '') . ' ' . $quoted);
    return [
        'exe'     => (string) $prog['exe'],
        'args'    => $args,
        'rom'     => $rom,
        'kind'    => empty($opt['own']) && str_contains(strtolower($args), '-l ') ? 'retroarch' : 'emulator',
        'via'     => $name . ' (your choice)',
        'program' => $key,
    ];
}

/**
 * Lay the choices over the library. The game's own file is kept; only what
 * starts it changes. A game whose file is gone stays as it is.
 */
function xs_apply_emu_choice(array $lib): array
{
    $all = xs_emuset_read();
    if (!$all || empty($lib['games'])) {
        return $lib;
    }
    $s     = xs_settings();
    $table = xs_emulators(xs_norm_path((string) ($s['paths']['launchbox'] ?? '')));
    foreach ($lib['games'] as $i => $g) {
        $key = $all[(string) ($g['id'] ?? '')] ?? null;
        if ($key === null || !empty($g['local']) || str_starts_with((string) ($g['launchError'] ?? ''), 'the file is not there')) {
            continue;
        }
        $opt = xs_emuset_option($table, (string) ($g['platform'] ?? ''), $key);
        // In use for the console already: nothing to change.
        if ($opt === null || !empty($opt['default'])) {
            continue;
        }
        $rom = (string) ($g['launch']['rom'] ?? '');
        if ($rom === '') {
            $rom = xs_rom_real_path((string) ($g['romPath'] ?? ''), $s);
        }
        if ($rom === '') {
            continue;
        }
        $why = null;
        $cmd = xs_emuset_command($table, $opt, $rom, $why);
        $lib['games'][$i]['launch']      = $cmd;
        $lib['games'][$i]['launchError'] = $cmd === null ? $why : null;
        $lib['games'][$i]['emuChoice']   = $key;
    }
    return $lib;
}

/**
 * Make a program the one a console's games start in, among those it has.
 * Returns the name of what was in use before, '' when it already was, or
 * null when the console does not have it.
 */
function xs_emuset_usual(array &$table, string $platform, string $key): ?string
{
    $pk   = strtolower($platform);
    $want = xs_emuset_option($table, $platform, $key);
    if ($want === null) {
        return null;
    }
    $now = xs_emu_option($table, $platform);
    if ($now !== null && ($now['program'] ?? '') === $key) {
        return '';
    }
    $done = false;
    foreach ($table['platforms'][$pk]['options'] as $i => $o) {
        $is = !$done && ($o['program'] ?? '') === $key && ($o['emulatorId'] ?? '') === ($want['emulatorId'] ?? '');
        $table['platforms'][$pk]['options'][$i]['default'] = $is;
        $done = $done || $is;
    }
    if ($now !== null) {
        $table['platforms'][$pk]['before'] = (string) ($now['emulatorId'] ?? '');
    }
    return (string) ($table['programs'][(string) ($now['program'] ?? '')]['name'] ?? $now['emulator'] ?? 'nothing');
}
