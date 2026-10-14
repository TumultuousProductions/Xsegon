<?php
/**
 * An emulator of your own in the table (includes\emulators.php): what Xsegon
 * can say about a program from its file name, the consoles it can be given,
 * and putting one in, changing it and taking it out.
 *
 * A console's games start in the emulator selected for it, so adding one for
 * a console that has one already takes over, and taking it out again hands
 * the console back to what ran it before.
 */
declare(strict_types=1);

require_once __DIR__ . '/emulators.php';
require_once __DIR__ . '/scan.php';
require_once __DIR__ . '/setup.php';

/**
 * The common emulators, known by file name. The options are the usual ones
 * and only a start: an emulator's own versions change them, so they are
 * shown to the person and stay theirs to change.
 */
function xs_emu_known(): array
{
    return [
        ['is' => '/^dolphin(qt2?|wx|-x64|-emu)?$/', 'name' => 'Dolphin',    'args' => '-b -e',                  'consoles' => ['Nintendo GameCube', 'Nintendo Wii']],
        ['is' => '/^pcsx2-qt/',               'name' => 'PCSX2',       'args' => '-fullscreen -nogui',     'consoles' => ['Sony Playstation 2']],
        ['is' => '/^pcsx2$/',                 'name' => 'PCSX2',       'args' => '--fullscreen --nogui',   'consoles' => ['Sony Playstation 2']],
        ['is' => '/^rpcs3$/',                 'name' => 'RPCS3',       'args' => '--no-gui',               'consoles' => ['Sony Playstation 3']],
        ['is' => '/^cemu$/',                  'name' => 'Cemu',        'args' => '-f -g',                  'consoles' => ['Wii U']],
        ['is' => '/^xemu$/',                  'name' => 'xemu',        'args' => '-full-screen -dvd_path', 'consoles' => ['Microsoft Xbox']],
        ['is' => '/^xenia/',                  'name' => 'Xenia',       'args' => '',                       'consoles' => ['Microsoft Xbox 360']],
        ['is' => '/^duckstation/',            'name' => 'DuckStation', 'args' => '-batch -fullscreen',     'consoles' => ['Sony Playstation']],
        ['is' => '/^ppssppwindows/',          'name' => 'PPSSPP',      'args' => '',                       'consoles' => ['Sony PSP']],
        ['is' => '/^mame(64)?$/',             'name' => 'MAME',        'args' => '',                       'consoles' => ['Arcade']],
        ['is' => '/^ryujinx/',                'name' => 'Ryujinx',     'args' => '',                       'consoles' => ['Nintendo Switch']],
        ['is' => '/^(yuzu|suyu|eden|sudachi|citron)$/', 'name' => '',  'args' => '-f -g',                  'consoles' => ['Nintendo Switch']],
        ['is' => '/^(citra|citra-qt|lime3ds|azahar)$/', 'name' => '',  'args' => '',                       'consoles' => ['Nintendo 3DS']],
        ['is' => '/^melonds$/',               'name' => 'melonDS',     'args' => '',                       'consoles' => ['Nintendo DS']],
        ['is' => '/^mgba$/',                  'name' => 'mGBA',        'args' => '-f',                     'consoles' => ['Nintendo Game Boy Advance', 'Nintendo Game Boy', 'Nintendo Game Boy Color']],
        ['is' => '/^project64$/',             'name' => 'Project64',   'args' => '',                       'consoles' => ['Nintendo 64']],
        ['is' => '/^snes9x/',                 'name' => 'Snes9x',      'args' => '',                       'consoles' => ['Super Nintendo Entertainment System']],
        ['is' => '/^flycast$/',               'name' => 'Flycast',     'args' => '',                       'consoles' => ['Sega Dreamcast']],
        ['is' => '/^redream$/',               'name' => 'redream',     'args' => '',                       'consoles' => ['Sega Dreamcast']],
    ];
}

/** A program's file name without its ending, in small letters. */
function xs_emu_base(string $exe): string
{
    $base = basename(str_replace('\\', '/', $exe));
    return strtolower((string) preg_replace('/\.(exe|bat|cmd|com)$/i', '', $base));
}

/** The same, as the file itself is written: what an unknown program is called to begin with. */
function xs_emu_file_name(string $exe): string
{
    $base = basename(str_replace('\\', '/', $exe));
    return (string) preg_replace('/\.(exe|bat|cmd|com)$/i', '', $base);
}

/** The known emulator a program is, or null. */
function xs_emu_known_for(string $exe): ?array
{
    $base = xs_emu_base($exe);
    foreach (xs_emu_known() as $k) {
        if (preg_match($k['is'], $base)) {
            if ($k['name'] === '') {
                $k['name'] = xs_emu_file_name($exe);
            }
            return $k;
        }
    }
    return null;
}

/** RetroArch is set up by Getting started, console by console, not here. */
function xs_emu_is_retroarch(array $table, string $key, string $exe = ''): bool
{
    $exe = $exe !== '' ? $exe : (string) ($table['programs'][$key]['exe'] ?? '');
    if (str_starts_with(xs_emu_base($exe), 'retroarch')) {
        return true;
    }
    foreach ($table['platforms'] ?? [] as $entry) {
        foreach ($entry['options'] ?? [] as $o) {
            if ($key !== '' && ($o['program'] ?? '') === $key && (($o['load'] ?? '') !== '' || ($o['core'] ?? '') !== '')) {
                return true;
            }
        }
    }
    return false;
}

/** Every console a game can be filed under, small letters => the name shown. */
function xs_emu_console_names(array $lib = []): array
{
    $names = [];
    $add = static function (string $n) use (&$names): void {
        if ($n !== '') {
            $names[strtolower($n)] ??= $n;
        }
    };
    foreach (xs_scan_platforms() as $n) {
        $add($n);
    }
    foreach (array_keys(xs_setup_default_cores()) as $n) {
        $add((string) $n);
    }
    foreach (xs_emu_known() as $k) {
        foreach ($k['consoles'] as $n) {
            $add($n);
        }
    }
    foreach ($lib['games'] ?? [] as $g) {
        if (empty($g['local'])) {
            $add((string) ($g['platform'] ?? ''));
        }
    }
    return $names;
}

/** The folder name Scan for Games reads as this console, or null when it has none. */
function xs_emu_folder_for(string $console): ?string
{
    foreach ([xs_scan_folder_names(), xs_scan_platforms()] as $list) {
        $short = array_search($console, $list, true);
        if ($short !== false) {
            return (string) $short;
        }
    }
    return null;
}

/** What starts a console's games now, as words: "RetroArch (mgba)", or null. */
function xs_emu_now(array $table, string $console): ?array
{
    $o = xs_emu_option($table, $console);
    if ($o === null) {
        return null;
    }
    $key  = (string) ($o['program'] ?? '');
    $name = (string) ($table['programs'][$key]['name'] ?? $o['emulator'] ?? 'an emulator');
    $core = (string) ($o['core'] ?? '');
    return ['key' => $key, 'name' => $name . ($core !== '' ? ' (' . $core . ')' : '')];
}

/** How many games each console has, by its name in small letters. */
function xs_emu_game_counts(array $lib): array
{
    $n = [];
    foreach ($lib['games'] ?? [] as $g) {
        if (empty($g['local'])) {
            $k = strtolower((string) ($g['platform'] ?? ''));
            $n[$k] = ($n[$k] ?? 0) + 1;
        }
    }
    return $n;
}

/**
 * What the screen shows once a program is chosen, or for one in the table
 * ($key): its name, the usual options, and every console with what starts
 * it now. A console is "on" when its games start in this program.
 */
function xs_emu_look(array $table, array $lib, string $exe, string $key = ''): array
{
    $editing = $key !== '' && isset($table['programs'][$key]);
    if ($editing) {
        $exe = (string) $table['programs'][$key]['exe'];
    }
    $known = xs_emu_known_for($exe);
    $name  = $editing ? (string) $table['programs'][$key]['name']
                      : ($known['name'] ?? xs_emu_file_name($exe));
    $args  = $editing ? (string) ($table['programs'][$key]['args'] ?? '') : (string) ($known['args'] ?? '');

    $same = null;
    $alike = null;
    if (!$editing) {
        foreach ($table['programs'] ?? [] as $k => $p) {
            if (strcasecmp((string) $p['exe'], $exe) === 0) {
                $same = (string) $k;
            } elseif (xs_emu_base((string) $p['exe']) === xs_emu_base($exe) && !xs_emu_is_retroarch($table, (string) $k)) {
                $alike = ['key' => (string) $k, 'name' => (string) $p['name'], 'exe' => (string) $p['exe']];
            }
        }
    }

    if ($alike !== null && strcasecmp($alike['name'], $name) === 0) {
        $name .= ' 2';                       // two of one emulator need telling apart
    }
    $counts  = xs_emu_game_counts($lib);
    $suggest = array_map('strtolower', $known['consoles'] ?? []);
    $rows = [];
    foreach (xs_emu_console_names($lib) as $low => $shown) {
        $now  = xs_emu_now($table, $shown);
        $mine = $editing && $now !== null && $now['key'] === $key;
        if ($mine) {
            // the options this console's games start with are the ones shown
            foreach (xs_emu_options($table, $shown) as $o) {
                if (($o['program'] ?? '') === $key) {
                    $args = (string) ($o['args'] ?? $args);
                }
            }
        }
        $rows[] = [
            'name'   => $shown,
            'games'  => $counts[$low] ?? 0,
            'now'    => $now === null || $mine ? null : $now['name'],
            'on'     => $editing ? $mine : in_array($low, $suggest, true),
            'mine'   => $mine,
            'folder' => xs_emu_folder_for($shown),
        ];
    }
    // What it plays first, then the consoles with games and nothing to start them.
    usort($rows, static fn ($a, $b) => [$b['on'], $b['games'] > 0 && $b['now'] === null, $b['games']]
                                   <=> [$a['on'], $a['games'] > 0 && $a['now'] === null, $a['games']]
                                   ?: strcmp($a['name'], $b['name']));
    return [
        'exe'       => $exe,
        'file'      => basename(str_replace('\\', '/', $exe)),
        'key'       => $editing ? $key : null,
        'known'     => $known !== null,
        'retroarch' => xs_emu_is_retroarch($table, $editing ? $key : '', $exe),
        'name'      => $name,
        'args'      => $args,
        'same'      => $same,
        'alike'     => $alike,
        'consoles'  => $rows,
    ];
}

/** Take a program's option off one console; what ran it before runs it again. */
function xs_emu_take_out(array &$table, string $pk, string $key): void
{
    $entry = $table['platforms'][$pk] ?? null;
    if (!is_array($entry)) {
        return;
    }
    $rest = [];
    $wasDefault = false;
    foreach ($entry['options'] ?? [] as $o) {
        if (($o['program'] ?? '') === $key) {
            $wasDefault = $wasDefault || !empty($o['default']);
            continue;
        }
        $rest[] = $o;
    }
    if (!$rest) {
        unset($table['platforms'][$pk]);
        return;
    }
    if ($wasDefault) {
        $back = (string) ($entry['before'] ?? '');
        $at = 0;
        foreach ($rest as $i => $o) {
            if ($back !== '' && ($o['emulatorId'] ?? '') === $back) {
                $at = $i;
            }
        }
        foreach ($rest as $i => $o) {
            $rest[$i]['default'] = $i === $at;
        }
        unset($entry['before']);
    }
    $entry['options'] = $rest;
    $table['platforms'][$pk] = $entry;
}

/** Make a program the one a console's games start in. Returns what it took over from, or null. */
function xs_emu_give(array &$table, string $pk, string $key, string $name, string $args): ?string
{
    $entry = $table['platforms'][$pk] ?? ['options' => []];
    $mine  = ['program' => $key, 'emulator' => $name, 'emulatorId' => 'xsegon-' . $key, 'args' => $args,
              'core' => null, 'load' => null, 'default' => true, 'own' => true];
    $prev  = null;
    $found = false;
    $out   = [];
    foreach ($entry['options'] ?? [] as $o) {
        if (($o['program'] ?? '') === $key) {
            if (!$found) {
                $out[] = ['emulatorId' => (string) ($o['emulatorId'] ?? $mine['emulatorId'])] + $mine;
            }
            $found = true;
            continue;
        }
        if (!empty($o['default'])) {
            $prev = $o;
        }
        $o['default'] = false;
        $out[] = $o;
    }
    if (!$found) {
        $out[] = $mine;
    }
    if ($prev === null && count($out) === 2 && !$found) {
        $prev = $out[0];                     // the only one there was, used without being marked
    }
    if ($prev !== null) {
        $entry['before'] = (string) ($prev['emulatorId'] ?? '');
    }
    $entry['options'] = $out;
    $table['platforms'][$pk] = $entry;
    if ($prev === null) {
        return null;
    }
    $core = (string) ($prev['core'] ?? '');
    return (string) ($table['programs'][(string) ($prev['program'] ?? '')]['name'] ?? $prev['emulator'] ?? 'another emulator')
         . ($core !== '' ? ' (' . $core . ')' : '');
}

/**
 * Add an emulator, or change one. $in: exe, name, args, consoles (names),
 * and key when one in the table is being changed. Returns what was done,
 * or null with $why.
 */
function xs_emu_put(array &$table, array $lib, array $in, ?string &$why = null): ?array
{
    $key = trim((string) ($in['key'] ?? ''));
    $exe = xs_norm_path(trim((string) ($in['exe'] ?? '')));
    if ($key !== '') {
        if (!isset($table['programs'][$key])) {
            $why = 'that emulator is not in the table any more';
            return null;
        }
        if ($exe === '') {
            $exe = (string) $table['programs'][$key]['exe'];
        }
    }
    if ($exe === '' || !is_file($exe)) {
        $why = $exe === '' ? 'choose the emulator\'s program first' : 'there is no file at ' . $exe;
        return null;
    }
    if (!preg_match('/\.(exe|bat|cmd|com)$/i', $exe)) {
        $why = basename($exe) . ' is not a program: choose the emulator\'s own .exe';
        return null;
    }
    if (xs_emu_is_retroarch($table, $key, $exe)) {
        $why = 'RetroArch is set up from Help > Getting started, which also fetches its cores';
        return null;
    }
    $known = xs_emu_known_for($exe);
    $name  = trim((string) preg_replace('/\s+/', ' ', (string) preg_replace('/[\x00-\x1F\x7F]/', ' ', (string) ($in['name'] ?? ''))));
    if ($name === '') {
        $name = $known['name'] ?? xs_emu_file_name($exe);
    }
    if (mb_strlen($name) > 60) {
        $why = 'that name is too long: 60 letters at most';
        return null;
    }
    $args = trim((string) ($in['args'] ?? ''));
    if (mb_strlen($args) > 400 || preg_match('/[\r\n&|<>^]/', $args)) {
        $why = mb_strlen($args) > 400 ? 'those options are too long: 400 letters at most'
                                      : 'the options cannot hold & | < > ^ or a line break: Windows would read them as commands';
        return null;
    }
    $names = xs_emu_console_names($lib);
    $want  = [];
    foreach ((array) ($in['consoles'] ?? []) as $c) {
        $low = strtolower(trim((string) $c));
        if (!isset($names[$low])) {
            $why = 'Xsegon has no console called ' . trim((string) $c);
            return null;
        }
        $want[$low] = $names[$low];
    }
    if (!$want) {
        $why = 'select at least one console for it to play';
        return null;
    }

    $new = $key === '';
    if ($new) {
        $base = xs_emu_key($known['name'] ?? $exe);
        $key  = $base;
        for ($i = 2; isset($table['programs'][$key]); $i++) {
            $key = $base . '-' . $i;
        }
    }
    $table['programs'][$key] = ['name' => $name, 'exe' => $exe, 'args' => $args, 'noQuotes' => false];

    // A console it played and no longer does goes back to what ran it before.
    // Only one the screen could show: an old table's second spelling is left alone.
    $left = [];
    foreach (array_keys($table['platforms'] ?? []) as $pk) {
        $pk = (string) $pk;
        $now = xs_emu_option($table, $pk);
        if (isset($names[$pk]) && !isset($want[$pk]) && $now !== null && ($now['program'] ?? '') === $key) {
            xs_emu_take_out($table, $pk, $key);
            $left[] = $names[$pk];
        }
    }
    $took = [];
    foreach ($want as $low => $shown) {
        $from = xs_emu_give($table, $low, $key, $name, $args);
        if ($from !== null) {
            $took[$shown] = $from;
        }
    }
    ksort($table['platforms']);
    return ['key' => $key, 'name' => $name, 'exe' => $exe, 'new' => $new,
            'consoles' => array_values($want), 'took' => $took, 'left' => $left];
}

/** Take an emulator out of the table. Returns the consoles left with nothing, or null with $why. */
function xs_emu_drop(array &$table, string $key, ?string &$why = null): ?array
{
    if (!isset($table['programs'][$key])) {
        $why = 'that emulator is not in the table any more';
        return null;
    }
    if (xs_emu_is_retroarch($table, $key)) {
        $why = 'RetroArch is not taken out here: its consoles would all be left with nothing';
        return null;
    }
    $names = xs_emu_console_names();
    $bare = [];
    foreach (array_keys($table['platforms'] ?? []) as $pk) {
        $pk = (string) $pk;
        xs_emu_take_out($table, $pk, $key);
        if (!isset($table['platforms'][$pk])) {
            $bare[] = $names[$pk] ?? $pk;
        }
    }
    unset($table['programs'][$key]);
    return $bare;
}
