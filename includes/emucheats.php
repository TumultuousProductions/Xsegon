<?php
/**
 * Xsegon - the cheats a standalone emulator keeps for a game, read only.
 *
 * A standalone emulator keeps its own cheats; Xsegon only shows what there is and which
 * are on (RetroArch's are switched in includes\cheats.php). PCSX2 for now.
 *
 * PCSX2 2.x keeps two files a game, both named by the game's code:
 *     cheats\<SERIAL>_<CRC>.pnach or cheats\<CRC>.pnach   a [Name] section a cheat
 *     gamesettings\<SERIAL>_<CRC>.ini                     [EmuCore] EnableCheats,
 *                                                         [Cheats] Enable = <Name>
 * Which code a game file has is in PCSX2's own list of the games it has
 * scanned, cache\gamelist.cache, so no game is opened to find out.
 *
 * Nothing here writes. An answer that cannot be read is no answer (null, or
 * a `why`), never a guess.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/emulators.php';

/**
 * The emulator's own cheats for a game:
 *   ['emulator' => 'PCSX2', 'why' => null, 'enabled' => bool, 'on' => int,
 *    'file' => 'cheats\833FE0A4.pnach', 'folder' => '<its folder>',
 *    'cheats' => [['name', 'author', 'desc', 'on', 'copies'], ...]]
 * `why` says, in words, why there is nothing to list. Null when the game's
 * emulator is not one whose cheats Xsegon reads.
 */
function xs_emucheats(array $game): ?array
{
    $pcsx2 = xs_pcsx2_game($game);
    return $pcsx2 !== null ? xs_pcsx2_cheats($pcsx2[0], $pcsx2[1]) : null;
}

/** [PCSX2's exe, the game's file] when PCSX2 is what starts this game, else null. */
function xs_pcsx2_game(array $game): ?array
{
    $launch = $game['launch'] ?? null;
    if (!is_array($launch) || !empty($launch['local']) || ($launch['kind'] ?? '') !== 'emulator') {
        return null;
    }
    $s  = xs_settings();
    $lb = xs_norm_path((string) ($s['paths']['launchbox'] ?? ''));
    $launch = xs_emu_repoint($launch, xs_emulators($lb), (string) ($game['platform'] ?? ''));
    $exe = (string) ($launch['exe'] ?? '');
    if (!preg_match('/^pcsx2[^\\\\\/]*\.exe$/i', basename($exe))) {
        return null;
    }
    return [$exe, (string) ($launch['rom'] ?? '')];
}

/** PCSX2's cheats for the game file $rom, as xs_emucheats() gives them. */
function xs_pcsx2_cheats(string $exe, string $rom): array
{
    $out = ['emulator' => 'PCSX2', 'why' => null, 'enabled' => false, 'on' => 0,
            'file' => '', 'folder' => '', 'cheats' => []];
    $home = xs_pcsx2_home($exe);
    if ($home === null) {
        $out['why'] = 'the folder PCSX2 keeps its settings in was not found';
        return $out;
    }
    $out['folder'] = $home;
    $ini     = xs_pcsx2_ini($home . '\\inis\\PCSX2.ini');
    $folder  = static function (string $key, string $default) use ($ini, $home): string {
        $v = trim((string) (($ini['Folders'][$key] ?? [])[0] ?? '')) ?: $default;
        return preg_match('/^([A-Za-z]:|\\\\\\\\)/', $v) ? $v : $home . '\\' . $v;
    };
    $code = xs_pcsx2_code($folder('Cache', 'cache') . '\\gamelist.cache', $rom);
    if ($code === null) {
        $out['why'] = 'PCSX2 has not listed this game yet, so its code is not known. '
                    . 'Open PCSX2 once with this game in its list and look here again';
        return $out;
    }
    [$serial, $crc] = $code;

    // The game's own settings: are cheats on for it, and which by name.
    $own   = xs_pcsx2_ini($home . '\\gamesettings\\' . $serial . '_' . $crc . '.ini');
    $truth = static fn (array $from): ?bool => isset($from['EmuCore']['EnableCheats'][0])
        ? strtolower(trim($from['EmuCore']['EnableCheats'][0])) === 'true' : null;
    $out['enabled'] = $truth($own) ?? $truth($ini) ?? false;
    $wanted = array_fill_keys(array_map('trim', $own['Cheats']['Enable'] ?? []), true);
    $allCrc = strtolower(trim((string) (($own['EmuCore']['ShowCheatsForAllCRCs'] ?? [])[0] ?? ''))) === 'true';

    // The cheat files PCSX2 itself reads for this game (its Patch.cpp).
    $dir   = $folder('Cheats', 'cheats');
    $files = [];
    foreach ((array) @scandir($dir) as $name) {
        if (!is_string($name) || strtolower(pathinfo($name, PATHINFO_EXTENSION)) !== 'pnach') {
            continue;
        }
        $n = strtoupper($name);
        if (str_starts_with($n, strtoupper($serial . '_' . $crc)) || str_starts_with($n, $crc)
            || ($allCrc && str_starts_with($n, strtoupper($serial) . '_'))) {
            $files[] = $name;
        }
    }
    if (!$files) {
        $out['why'] = 'PCSX2 has no cheat file for this game. One would be ' . $dir . '\\' . $crc . '.pnach';
        return $out;
    }
    sort($files, SORT_STRING | SORT_FLAG_CASE);
    $out['file'] = basename($dir) . '\\' . implode(', ', $files);

    // A name can stand over several sections; PCSX2 switches them together.
    $by = [];
    foreach ($files as $name) {
        foreach (xs_pcsx2_pnach($dir . '\\' . $name) as $sec) {
            $k = $sec['name'];
            if (!isset($by[$k])) {
                $by[$k] = ['name' => $k, 'author' => $sec['author'], 'desc' => $sec['desc'], 'on' => false, 'copies' => 0];
            }
            $by[$k]['copies']++;
            if ($by[$k]['desc'] === '' && $sec['desc'] !== '') {
                $by[$k]['desc'] = $sec['desc'];
            }
        }
    }
    foreach ($by as $k => &$c) {
        // A cheat with no name has no switch of its own: it goes with cheats being on at all.
        $c['on'] = $out['enabled'] && ($k === '' || isset($wanted[$k]));
        if ($k === '') {
            $c['name'] = 'Cheats with no name (on whenever cheats are)';
        }
    }
    unset($c);
    $list = array_values($by);
    usort($list, static fn (array $a, array $b): int => ((int) $b['on']) <=> ((int) $a['on']));   // stable: file order within each
    $out['cheats'] = $list;
    $out['on']     = count(array_filter($list, static fn (array $c): bool => $c['on']));
    return $out;
}

/**
 * Where this PCSX2 keeps its settings: beside the exe when it is portable
 * (a portable.ini or portable.txt there), else Documents\PCSX2.
 */
function xs_pcsx2_home(string $exe): ?string
{
    $dir = dirname($exe);
    if (is_file($dir . '\\portable.ini') || is_file($dir . '\\portable.txt')) {
        return $dir;
    }
    $docs = rtrim((string) (getenv('USERPROFILE') ?: ''), '\\/') . '\\Documents\\PCSX2';
    return is_dir($docs . '\\inis') ? $docs : (is_dir($dir . '\\inis') ? $dir : null);
}

/** One of PCSX2's folders as its [Folders] names it: a relative one is under $home. */
function xs_pcsx2_folder(array $ini, string $home, string $key, string $default): string
{
    $v = trim((string) (($ini['Folders'][$key] ?? [])[0] ?? '')) ?: $default;
    return preg_match('/^([A-Za-z]:|\\\\\\\\)/', $v) ? $v : $home . '\\' . $v;
}

/**
 * A PCSX2 settings file as [section][key] => [values], a key kept as many
 * times as it is written (Enable = ... is, once a cheat). [] when unreadable.
 */
function xs_pcsx2_ini(string $file): array
{
    $out = [];
    $sec = '';
    foreach ((array) @file($file, FILE_IGNORE_NEW_LINES) as $line) {
        $line = trim((string) $line, " \t\r\n\xEF\xBB\xBF");
        if ($line === '' || $line[0] === ';' || $line[0] === '#') {
            continue;
        }
        if (preg_match('/^\[(.+)\]$/', $line, $m)) {
            $sec = $m[1];
            continue;
        }
        $at = strpos($line, '=');
        if ($at !== false) {
            $out[$sec][trim(substr($line, 0, $at))][] = trim(substr($line, $at + 1));
        }
    }
    return $out;
}

/**
 * A game file's serial and code from PCSX2's game list cache, as ['SLUS-20328', '833FE0A4'].
 * Null when not listed, or when the cache does not read whole to the last byte.
 */
function xs_pcsx2_code(string $cache, string $rom): ?array
{
    $b = @file_get_contents($cache);
    if (!is_string($b) || strlen($b) < 8 || substr($b, 0, 4) !== 'GLCE') {
        return null;
    }
    $want  = strtolower(str_replace('/', '\\', $rom));
    $o     = 8;
    $n     = strlen($b);
    $found = null;
    $str = static function () use ($b, &$o, $n): ?string {
        if ($o + 4 > $n) {
            return null;
        }
        $len = unpack('V', $b, $o)[1];
        $o += 4;
        if ($len > 4096 || $o + $len > $n) {
            return null;
        }
        $s = substr($b, $o, $len);
        $o += $len;
        return $s;
    };
    while ($o < $n) {
        // path, serial, three titles; then type, region, size, changed, code, rating
        $path = $str();
        $serial = $str();
        if ($path === null || $serial === null || $str() === null || $str() === null || $str() === null || $o + 23 > $n) {
            return null;
        }
        $crc = unpack('V', $b, $o + 18)[1];
        $o += 23;
        if ($found === null && strtolower(str_replace('/', '\\', $path)) === $want && $serial !== '' && $crc !== 0) {
            $found = [$serial, sprintf('%08X', $crc)];
        }
    }
    return $o === $n ? $found : null;
}

/** The sections of a .pnach file, in order: [['name', 'author', 'desc'], ...]. */
function xs_pcsx2_pnach(string $file): array
{
    $out = [];
    $cur = null;
    foreach ((array) @file($file, FILE_IGNORE_NEW_LINES) as $line) {
        $line = trim((string) $line, " \t\r\n\xEF\xBB\xBF");
        if ($line === '' || str_starts_with($line, '//')) {
            continue;
        }
        if (preg_match('/^\[(.*)\]$/', $line, $m)) {
            $out[] = ['name' => trim($m[1]), 'author' => '', 'desc' => ''];
            $cur = count($out) - 1;
            continue;
        }
        if (!preg_match('/^([A-Za-z]+)\s*=\s*(.*)$/', $line, $m)) {
            continue;
        }
        $key = strtolower($m[1]);
        if ($cur === null) {
            if ($key === 'patch') {                      // an old file: codes under no name at all
                $out[] = ['name' => '', 'author' => '', 'desc' => ''];
                $cur = count($out) - 1;
            }
            continue;
        }
        if ($key === 'author') {
            $out[$cur]['author'] = trim($m[2]);
        } elseif ($key === 'description') {
            $out[$cur]['desc'] = trim($m[2]);
        }
    }
    return $out;
}
