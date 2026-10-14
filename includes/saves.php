<?php
/**
 * Xsegon - a game's saves, read only: what the Saves tab of details shows.
 *
 * Three places are looked in, and nothing is written in any of them:
 *
 *   RetroArch's save states    <states>\<core>\<game>.state, .state1 ..  with
 *                              the picture beside each (includes\states.php)
 *   RetroArch's in-game save   <saves>\<core>\<game>.srm and its kin, found by
 *                              the same kind of settings the states have
 *   beside the game's file     a save or a state named for the game, in the
 *                              game's own folder. RetroArch loads those only
 *                              when its settings keep saves beside the content.
 *
 * A save of the same game under another core's folder is listed too, since
 * that is the usual answer to "where did my save go".
 *
 * A PCSX2 game: its save states, sstates\<SERIAL> (<CRC>).<NN>.p2s, by the
 * game's code (includes\emucheats.php), and its memory cards, which every
 * PS2 game shares.
 */
declare(strict_types=1);

require_once __DIR__ . '/states.php';
require_once __DIR__ . '/emucheats.php';

/** The endings a save beside a game's file wears. A saves folder of its own needs no list. */
const XS_SAVE_ENDINGS = ['srm', 'sav', 'eep', 'sra', 'fla', 'mpk', 'mcr', 'mcd', 'dsv', 'rtc', 'bkr', 'ldci'];

/**
 * The folder RetroArch keeps this game's in-game save in, as its runloop
 * makes it: beside the content when told to, else the saves folder with a
 * folder for the content's folder and then one for the core, each when on.
 */
function ra_saves_dir(array $game, array $flags): ?string
{
    $launch = $game['launch'] ?? [];
    if (($launch['kind'] ?? '') !== 'retroarch' || empty($launch['exe'])) {
        return null;
    }
    $rom = (string) ($launch['rom'] ?? '');
    if (($flags['savefiles_in_content_dir'] ?? false) === true && $rom !== '') {
        return dirname($rom);
    }
    $raDir = dirname((string) $launch['exe']);
    $dir   = ra_resolve_dir($raDir, (string) ($flags['savefile_directory'] ?? ''), 'saves');
    if (($flags['sort_savefiles_by_content_enable'] ?? false) === true && $rom !== '') {
        $dir .= DIRECTORY_SEPARATOR . basename(dirname($rom));
    }
    if (($flags['sort_savefiles_enable'] ?? false) === true) {
        $core = ra_core_name($raDir, (string) ($launch['args'] ?? ''), $flags);
        if ($core === null) {
            return null;
        }
        $dir .= DIRECTORY_SEPARATOR . $core;
    }
    return $dir;
}

/** The names a game's saves are made from: the file that starts, and the game's own file when a playlist starts it. */
function xs_save_bases(array $game): array
{
    $out = [];
    foreach ([(string) ($game['launch']['rom'] ?? ''), (string) ($game['romPath'] ?? '')] as $rom) {
        $base = pathinfo(str_replace('/', DIRECTORY_SEPARATOR, $rom), PATHINFO_FILENAME);
        if ($base !== '') {
            $out[strtolower($base)] = $base;
        }
    }
    return array_values($out);
}

/**
 * The saves and states of these names in one folder, as rows:
 *   kind 'save' | 'state', file, path, at, when, size, and for a state its
 *   slot and whether it is RetroArch's own save on closing (auto).
 * $any: the folder holds saves only, so any ending that is not a state's is one.
 */
function xs_saves_in(string $dir, array $bases, bool $any): array
{
    if ($dir === '' || !$bases || !is_dir($dir)) {
        return [];
    }
    $names = implode('|', array_map(static fn (string $b): string => preg_quote($b, '/'), $bases));
    $state = '/^(?:' . $names . ')\.state(\d{1,3})?(\.auto)?$/i';
    $save  = '/^(?:' . $names . ')\.(' . ($any ? '(?!state)[a-z0-9]{1,6}|\d\.mc[rd]' : implode('|', XS_SAVE_ENDINGS) . '|\d\.mc[rd]') . ')$/i';
    $rows  = [];
    foreach (@scandir($dir) ?: [] as $f) {
        $isState = preg_match($state, $f, $m) === 1;
        if (!$isState && preg_match($save, $f) !== 1) {
            continue;
        }
        $path = $dir . DIRECTORY_SEPARATOR . $f;
        if (!is_file($path)) {
            continue;
        }
        $at  = filemtime($path) ?: 0;
        $row = ['kind' => $isState ? 'state' : 'save', 'file' => $f, 'path' => $path,
                'at' => $at, 'when' => date('c', $at), 'size' => filesize($path) ?: 0];
        if ($isState) {
            $row['slot'] = (int) ($m[1] ?? 0);
            $row['auto'] = ($m[2] ?? '') !== '';
        }
        $rows[] = $row;
    }
    usort($rows, static fn (array $a, array $b): int => $b['at'] <=> $a['at']);
    return $rows;
}

/**
 * The game with the launch it will really be started by: its emulator where
 * the table has it today, and its own core when it was given one. The core
 * names the folder its saves are in, so reading and writing both ask this.
 */
function xs_saves_effective(array $game): array
{
    $launch = $game['launch'] ?? null;
    if (!is_array($launch) || !empty($launch['local']) || !empty($game['local'])) {
        return $game;
    }
    require_once __DIR__ . '/cores.php';
    require_once __DIR__ . '/emulators.php';
    $lb = xs_norm_path((string) (xs_settings()['paths']['launchbox'] ?? ''));
    $launch = xs_emu_repoint($launch, xs_emulators($lb), (string) ($game['platform'] ?? ''));
    [$launch] = xs_core_apply($launch, (string) ($game['id'] ?? ''), (string) ($game['platform'] ?? ''), $lb);
    $game['launch'] = $launch;
    return $game;
}

/**
 * Everything the Saves tab shows for one game:
 *   ['groups' => [['key', 'title', 'help', 'where', 'rows' => [...]], ...],
 *    'count' => int, 'none' => words when there is nothing to list,
 *    'hotkey', 'sends', 'mode' as the state picker has them]
 * A row: key, kind (state | save | card), name, file, path, at, when, size,
 * and, where they apply, slot, shot (the picture's time), play (one press
 * starts the game from it), core (the other core it is kept for) and own
 * (RetroArch's own of the same kind: ['when', 'newer' => bool]).
 */
function xs_saves_for(array $game): array
{
    $game   = xs_saves_effective($game);
    $out    = ['groups' => [], 'count' => 0, 'none' => null, 'hotkey' => 'F4', 'sends' => false, 'mode' => 'ask'];
    $launch = is_array($game['launch'] ?? null) ? $game['launch'] : [];
    $kind   = (string) ($launch['kind'] ?? '');
    $via    = (string) ($launch['via'] ?? '') ?: 'its emulator';
    $bases  = xs_save_bases($game);
    $romDir = ($game['romPath'] ?? '') !== '' ? dirname(xs_norm_path((string) $game['romPath'])) : '';
    $listed = [];                 // paths already in a group, so no file is shown twice
    $ownSaveAt  = null;           // RetroArch's own in-game save, for the ones beside the game to be held against
    $cannot = null;               // why Xsegon may not put a save where RetroArch loads it, when it may not
    $canUse = xs_saves_can_write($game, $cannot);
    $ownStateAt = [];             // and its own states, by slot
    $group = static function (string $key, string $title, string $help, string $where, array $rows) use (&$out, &$listed): void {
        if (!$rows) {
            return;
        }
        foreach ($rows as $i => &$r) {
            $r['key'] ??= $key . ':' . $i;
            $listed[strtolower($r['path'])] = true;
        }
        unset($r);
        $out['groups'][] = ['key' => $key, 'title' => $title, 'help' => $help, 'where' => $where, 'rows' => array_values($rows)];
    };

    if (!empty($game['local']) || !empty($launch['local'])) {
        $out['none'] = 'This game keeps its own saves; Xsegon does not look for them';
        return $out;
    }

    if ($kind === 'retroarch' && !empty($launch['exe'])) {
        $flags = ra_flags(ra_config_path((string) $launch['exe']));
        $st    = ra_states_for($game);
        $out['hotkey'] = $st['hotkey'];
        $out['sends']  = $st['sends'];
        $out['mode']   = $st['mode'] ?? 'ask';
        $sdir = ra_states_dir($game, $flags);
        $vdir = ra_saves_dir($game, $flags);

        $rows = [];
        foreach ($st['states'] as $s) {
            $ownStateAt[(int) $s['slot']] = (int) $s['at'];
            $rows[] = ['key' => 'state:' . $s['slot'], 'kind' => 'state', 'name' => 'Slot ' . $s['slot'], 'file' => $s['file'],
                       'path' => $st['dir'] . DIRECTORY_SEPARATOR . $s['file'], 'at' => $s['at'], 'when' => $s['when'],
                       'size' => $s['size'], 'slot' => (int) $s['slot'], 'shot' => $s['shot'], 'play' => true];
        }
        if ($sdir !== null) {
            foreach (xs_saves_in($sdir, $bases, false) as $r) {
                if ($r['kind'] === 'state' && !empty($r['auto'])) {
                    $rows[] = ['key' => 'auto', 'name' => 'RetroArch\'s save on closing',
                               'loads' => ($flags['savestate_auto_load'] ?? false) === true] + $r;
                }
            }
        }
        $group('states', 'Save states', $out['sends']
            ? 'RetroArch\'s own, newest first. One press starts the game from it.'
            : 'RetroArch\'s own, newest first. One press starts the game on its slot; ' . $out['hotkey'] . ' loads it.',
            (string) $sdir, $rows);

        $rows = [];
        if ($vdir !== null) {
            foreach (xs_saves_in($vdir, $bases, strtolower($vdir) !== strtolower($romDir)) as $r) {
                if ($r['kind'] === 'save') {
                    $ownSaveAt = max((int) $ownSaveAt, (int) $r['at']);
                    $rows[] = ['name' => 'In-game save'] + $r;
                }
            }
        }
        $group('saves', 'In-game save', 'What the game itself saved, to its cartridge or memory card. It loads by itself when the game starts.',
            (string) $vdir, $rows);

        // The same game's saves and states under another core's folder: RetroArch does not read across cores.
        $rows = [];
        foreach ([[$sdir, 'sort_savestates_enable', 'savestates_in_content_dir'], [$vdir, 'sort_savefiles_enable', 'savefiles_in_content_dir']] as [$dir, $sorted, $beside]) {
            if ($dir === null || ($flags[$sorted] ?? false) !== true || ($flags[$beside] ?? false) === true) {
                continue;
            }
            $root = dirname($dir);
            foreach (@scandir($root) ?: [] as $core) {
                $other = $root . DIRECTORY_SEPARATOR . $core;
                if ($core === '.' || $core === '..' || strtolower($other) === strtolower($dir) || !is_dir($other)) {
                    continue;
                }
                foreach (xs_saves_in($other, $bases, true) as $r) {
                    $rows[] = ['name' => $r['kind'] === 'state' ? 'Save state' . (empty($r['auto']) ? ', slot ' . $r['slot'] : ' on closing') : 'In-game save',
                               'core' => $core, 'use' => $canUse && $r['kind'] === 'save'] + $r;   // a state is one core's alone
                }
            }
        }
        $core = ra_core_name(dirname((string) $launch['exe']), (string) ($launch['args'] ?? ''), $flags);
        $group('other', 'Kept for another core',
            'Made while this game ran in another core. ' . ($core !== null ? $core : 'The core it starts in now') . ' does not read them.',
            '', $rows);
    } elseif (($pcsx2 = xs_pcsx2_game($game)) !== null) {
        [$exe, $rom] = $pcsx2;
        $home = xs_pcsx2_home($exe);
        if ($home !== null) {
            $ini    = xs_pcsx2_ini($home . '\\inis\\PCSX2.ini');
            $folder = static function (string $key, string $default) use ($ini, $home): string {
                $v = trim((string) (($ini['Folders'][$key] ?? [])[0] ?? '')) ?: $default;
                return preg_match('/^([A-Za-z]:|\\\\\\\\)/', $v) ? $v : $home . '\\' . $v;
            };
            $code = xs_pcsx2_code($folder('Cache', 'cache') . '\\gamelist.cache', $rom);
            $rows = [];
            $sdir = $folder('Savestates', 'sstates');
            if ($code !== null) {
                $re = '/^' . preg_quote($code[0] . ' (' . $code[1] . ')', '/') . '\.(\d{1,3}|resume)\.p2s$/i';
                foreach (@scandir($sdir) ?: [] as $f) {
                    if (preg_match($re, $f, $m) !== 1 || !is_file($sdir . '\\' . $f)) {
                        continue;
                    }
                    $at = filemtime($sdir . '\\' . $f) ?: 0;
                    $rows[] = ['kind' => 'state', 'name' => ctype_digit($m[1]) ? 'Slot ' . (int) $m[1] : 'PCSX2\'s save on closing',
                               'file' => $f, 'path' => $sdir . '\\' . $f, 'at' => $at, 'when' => date('c', $at),
                               'size' => filesize($sdir . '\\' . $f) ?: 0];
                }
                usort($rows, static fn (array $a, array $b): int => $b['at'] <=> $a['at']);
            }
            $group('states', 'Save states', 'PCSX2\'s own, newest first. They are loaded in PCSX2, from its Load State menu.', $sdir, $rows);

            // The cards the game's own settings name, else the ones PCSX2 has in for every game.
            $own  = $code !== null ? xs_pcsx2_ini($home . '\\gamesettings\\' . $code[0] . '_' . $code[1] . '.ini') : [];
            $mdir = $folder('MemoryCards', 'memcards');
            $rows = [];
            foreach ([1, 2] as $n) {
                $on   = strtolower(trim((string) (($own['MemoryCards']['Slot' . $n . '_Enable'] ?? $ini['MemoryCards']['Slot' . $n . '_Enable'] ?? ['true'])[0])));
                $name = trim((string) (($own['MemoryCards']['Slot' . $n . '_Filename'] ?? $ini['MemoryCards']['Slot' . $n . '_Filename'] ?? ['Mcd00' . $n . '.ps2'])[0]));
                $path = $mdir . '\\' . $name;
                if ($on !== 'true' || $name === '' || !file_exists($path)) {
                    continue;
                }
                $at = filemtime($path) ?: 0;
                $rows[] = ['kind' => 'card', 'name' => 'Memory card ' . $n, 'file' => $name, 'path' => $path, 'at' => $at,
                           'when' => date('c', $at), 'size' => is_file($path) ? (filesize($path) ?: 0) : 0];
            }
            $group('cards', 'Memory cards', 'A PS2 game saves onto PCSX2\'s memory cards, which every PS2 game shares. The date is the last time any game wrote to one.',
                $mdir, $rows);
            if ($code === null) {
                $out['none'] = 'PCSX2 has not listed this game yet, so its save states cannot be told from other games\'. '
                             . 'Open PCSX2 once with this game in its list and look here again';
            } elseif (!$out['groups'] || $out['groups'][0]['key'] !== 'states') {
                $out['none'] = 'PCSX2 has no save state for this game yet';
            }
        }
    }

    // Beside the game's file, whatever starts it. Not the ones RetroArch itself keeps there.
    $rows = [];
    foreach (xs_saves_in($romDir, $bases, false) as $r) {
        if (isset($listed[strtolower($r['path'])])) {
            continue;
        }
        if ($r['kind'] === 'state') {
            $r['name'] = empty($r['auto']) ? 'Save state, slot ' . $r['slot'] : 'Save state on closing';
            $ownAt = empty($r['auto']) ? ($ownStateAt[(int) $r['slot']] ?? null) : null;
        } else {
            $r['name'] = 'In-game save';
            $ownAt = $ownSaveAt;
        }
        if ($kind === 'retroarch') {
            // The same date is the same save: one Xsegon put there, or RetroArch keeping its saves here.
            $r['own'] = $ownAt ? ['when' => date('c', (int) $ownAt), 'newer' => (int) $ownAt >= (int) $r['at'], 'same' => (int) $ownAt === (int) $r['at']] : null;
            $r['use'] = $canUse && empty($r['auto']) && empty($r['own']['same']);
        }
        $rows[] = $r;
    }
    $group('beside', 'Beside the game\'s file', $kind === 'retroarch'
        ? 'Kept in the game\'s own folder, by an earlier setup. RetroArch does not load these from there: it keeps this game\'s saves in its own folders.'
          . ($canUse ? ' A press puts one where RetroArch loads it; the one beside the game stays as it is.' : '')
        : 'Kept in the game\'s own folder. A .state or a .srm is RetroArch\'s kind of save, which ' . $via . ' does not load.',
        $romDir, $rows);

    foreach ($out['groups'] as $g) {
        foreach ($g['rows'] as $r) {
            $out['count'] += $r['kind'] === 'card' ? 0 : 1;
        }
    }
    $out['canUse'] = $canUse;
    $out['cannot'] = $kind === 'retroarch' ? $cannot : null;
    // What a press replaced, kept in Xsegon's own data: listed last, and not counted as the game's saves.
    $rows = [];
    $keptDir = xs_saves_kept_dir((string) ($game['id'] ?? ''));
    foreach (is_dir($keptDir) ? (@scandir($keptDir) ?: []) : [] as $f) {
        if (is_file($keptDir . DIRECTORY_SEPARATOR . $f)) {
            $at = filemtime($keptDir . DIRECTORY_SEPARATOR . $f) ?: 0;
            $rows[] = ['kind' => 'card', 'name' => 'Kept copy', 'file' => $f, 'path' => $keptDir . DIRECTORY_SEPARATOR . $f,
                       'at' => $at, 'when' => date('c', $at), 'size' => filesize($keptDir . DIRECTORY_SEPARATOR . $f) ?: 0];
        }
    }
    $group('kept', 'Kept copies', 'What RetroArch had when a save was put in its place. Xsegon keeps them; nothing loads them from here.', $keptDir, array_reverse($rows));
    if (!$out['groups'] && $out['none'] === null) {
        if ($kind === 'retroarch') {
            $out['none'] = 'Nothing is saved for this game yet. A save state made in RetroArch shows here with its picture, and so does the game\'s own save';
        } elseif (!$launch) {
            $out['none'] = 'This game has no emulator yet, and no save beside its file';
        } else {
            $out['none'] = 'Xsegon reads the saves of RetroArch and PCSX2 games, and any save kept beside a game\'s file. '
                         . 'This one starts in ' . $via . ' and has none beside it';
        }
    }
    return $out;
}

/** The file behind one row of xs_saves_for(), by the row's key; null when there is no such row now. */
function xs_save_path(array $game, string $key): ?string
{
    foreach (xs_saves_for($game)['groups'] as $g) {
        foreach ($g['rows'] as $r) {
            if ($r['key'] === $key) {
                return (string) $r['path'];
            }
        }
    }
    return null;
}

/* ---- a save put where RetroArch loads it -----------------------------------
 *
 * Only into a RetroArch that is the person's own: one inside an imported
 * library's folder is read and never written (xs_in_launchbox). A save is copied,
 * never moved, with its date kept, so the one beside the game stays what it
 * was. Whatever RetroArch had in that place is copied into Xsegon's own
 * data first (data\saves-kept\<game id>), so nothing is ever lost to a press.
 */

/** Whether Xsegon may put a save into this game's RetroArch; $why says why not. */
function xs_saves_can_write(array $game, ?string &$why = null): bool
{
    $why    = null;
    $game   = xs_saves_effective($game);
    $launch = is_array($game['launch'] ?? null) ? $game['launch'] : [];
    if (($launch['kind'] ?? '') !== 'retroarch' || empty($launch['exe'])) {
        $why = 'only a RetroArch game has a place Xsegon knows to put a save';
        return false;
    }
    require_once __DIR__ . '/emumove.php';
    if (xs_in_launchbox((string) $launch['exe'])) {
        $why = 'this RetroArch is inside a folder Xsegon never writes to: '
             . 'Emulators > Move out of LaunchBox gives it a folder of your own';
        return false;
    }
    if (xs_test_keep_out((string) $launch['exe'])) {
        $why = 'a test copy never writes into a real emulator\'s folder';
        return false;
    }
    return true;
}

/** Where Xsegon keeps what a press replaced, for one game. */
function xs_saves_kept_dir(string $id): string
{
    return xs_data_path('saves-kept' . DIRECTORY_SEPARATOR . preg_replace('/[^A-Za-z0-9\-]/', '', $id));
}

/**
 * Copies one row of the Saves tab (a save beside the game, or one kept for
 * another core) to where RetroArch loads it for this game.
 *   ['used' => file, 'to' => path, 'kept' => path|null]   done
 *   ['needs' => 'replace', 'own' => ISO time]              RetroArch has its own there: ask, then $replace
 * null with $why when it cannot be done.
 */
function xs_save_use(array $game, string $key, bool $replace, ?string &$why = null): ?array
{
    $game = xs_saves_effective($game);
    if (!xs_saves_can_write($game, $why)) {
        return null;
    }
    $row = null;
    foreach (xs_saves_for($game)['groups'] as $g) {
        foreach ($g['rows'] as $r) {
            if ($r['key'] === $key && in_array($g['key'], ['beside', 'other'], true)) {
                $row = $r;
            }
        }
    }
    if ($row === null || !empty($row['auto']) || ($row['kind'] === 'state' && isset($row['core']))) {
        $why = $row === null ? 'that save is not there any more' : 'that one cannot be loaded by the core this game starts in';
        return null;
    }
    $launch = $game['launch'];
    $flags  = ra_flags(ra_config_path((string) $launch['exe']));
    $dir    = $row['kind'] === 'state' ? ra_states_dir($game, $flags) : ra_saves_dir($game, $flags);
    $base   = pathinfo((string) ($launch['rom'] ?? ''), PATHINFO_FILENAME);
    if ($dir === null || $base === '') {
        $why = 'the folder RetroArch keeps this game\'s saves in could not be worked out';
        return null;
    }
    // RetroArch's name for it: the game's file name, then the save's own ending.
    $ending = $row['kind'] === 'state' ? '.state' . ($row['slot'] > 0 ? (string) $row['slot'] : '')
            : (preg_match('/(\.\d\.mc[rd]|\.[A-Za-z0-9]{1,6})$/', (string) $row['file'], $m) ? $m[1] : '');
    if ($ending === '') {
        $why = 'that file has no ending RetroArch would know it by';
        return null;
    }
    $to = $dir . DIRECTORY_SEPARATOR . $base . $ending;
    if (strtolower($to) === strtolower((string) $row['path'])) {
        $why = 'that is the save RetroArch loads already';
        return null;
    }
    $kept = null;
    if (is_file($to)) {
        if (!$replace) {
            return ['needs' => 'replace', 'own' => date('c', filemtime($to) ?: time())];
        }
        $keepDir = xs_saves_kept_dir((string) $game['id']);
        $kept = $keepDir . DIRECTORY_SEPARATOR . date('Ymd-His') . ' ' . basename($to);
        if ((!is_dir($keepDir) && !@mkdir($keepDir, 0777, true)) || !@copy($to, $kept)) {
            $why = 'the save RetroArch has now could not be kept as a copy, so it was left alone';
            return null;
        }
        @touch($kept, filemtime($to) ?: time());
    }
    if ((!is_dir($dir) && !@mkdir($dir, 0777, true)) || !@copy((string) $row['path'], $to)) {
        $why = 'the save could not be copied into ' . $dir;
        return null;
    }
    @touch($to, (int) $row['at'] ?: time());
    xs_log('SAVE', 'put ' . $row['file'] . ' where RetroArch loads it for ' . $game['title'] . ': ' . $to
        . ($kept !== null ? ' (the one it replaced is kept as ' . $kept . ')' : ' (nothing was there)'));
    return ['used' => (string) $row['file'], 'to' => $to, 'kept' => $kept];
}

/**
 * Picks up, for one game, every save beside its file that RetroArch has
 * none of its own for: copied in, nothing replaced. The files it took.
 */
function xs_saves_pickup(array $game): array
{
    if (!xs_saves_can_write($game)) {
        return [];
    }
    $took = [];
    foreach (xs_saves_for($game)['groups'] as $g) {
        if ($g['key'] !== 'beside') {
            continue;
        }
        foreach ($g['rows'] as $r) {
            if (array_key_exists('own', $r) && $r['own'] === null && empty($r['auto'])) {
                $why = null;
                $did = xs_save_use($game, (string) $r['key'], false, $why);
                if (isset($did['used'])) {
                    $took[] = $did['used'];
                }
            }
        }
    }
    return $took;
}

/** The same for every game of the library. [game title => files]. */
function xs_saves_pickup_all(): array
{
    $out = [];
    foreach (xs_library()['games'] ?? [] as $g) {
        if ((($g['launch']['kind'] ?? '') === 'retroarch') && ($took = xs_saves_pickup($g))) {
            $out[(string) $g['title'] . ' [' . $g['id'] . ']'] = $took;
        }
    }
    if ($out) {
        xs_log('SAVE', 'picked up ' . array_sum(array_map('count', $out)) . ' saves kept beside ' . count($out) . ' games');
    }
    return $out;
}
