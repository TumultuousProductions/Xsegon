<?php
/**
 * PCSX2 (PlayStation 2). Portable with portable.ini or portable.txt beside it, else in Documents\PCSX2.
 * Bindings are inis\PCSX2.ini's [Pad1]: "SDL-0/FaceSouth", the number being SDL's for that pad today.
 */
declare(strict_types=1);

/** A game's serial and code as PCSX2 lists it ([serial, crc]), from its game list cache; null with $why. */
function xs_pcsx2_game_code(string $home, string $rom, ?string &$why = null): ?array
{
    require_once __DIR__ . '/../emucheats.php';
    $ini = xs_pcsx2_ini($home . '\\inis\\PCSX2.ini');
    $code = xs_pcsx2_code(xs_pcsx2_folder($ini, $home, 'Cache', 'cache') . '\\gamelist.cache', $rom);
    if ($code === null) {
        $why = 'PCSX2 has not listed this game yet, so its code is not known. Open PCSX2 once with this game in its list and look here again';
    }
    return $code;
}

/** The patches PCSX2 has for a game: the one file for it in its patches.zip (read by Windows' tar) and its own patches folder's. */
function xs_pcsx2_patches(string $exe, string $home, string $serial, string $crc): array
{
    require_once __DIR__ . '/../unpack.php';
    $out = [];
    $name = $serial . '_' . $crc . '.pnach';
    $zip = dirname($exe) . '\\resources\\patches.zip';
    $tar = xs_unpack_tar();
    if (is_file($zip) && $tar !== '' && ($run = xs_unpack_run([$tar, '-xOf', $zip, $name])) !== null) {
        $text = (string) stream_get_contents($run[1]);
        fclose($run[1]);
        proc_close($run[0]);
        if ($text !== '') {
            $tmp = tempnam(sys_get_temp_dir(), 'xsp');
            file_put_contents($tmp, $text);
            foreach (xs_pcsx2_pnach($tmp) as $sec) {
                $out[] = $sec + ['yours' => false];
            }
            @unlink($tmp);
        }
    }
    $own = xs_pcsx2_folder(xs_pcsx2_ini($home . '\\inis\\PCSX2.ini'), $home, 'Patches', 'patches');
    foreach ([$own . '\\' . $name, $own . '\\' . $crc . '.pnach'] as $f) {
        foreach (is_file($f) ? xs_pcsx2_pnach($f) : [] as $sec) {
            $out[] = $sec + ['yours' => true];
        }
    }
    // A section with no name always applies: no switch of its own, so not listed.
    return array_values(array_filter($out, static fn(array $s): bool => $s['name'] !== ''));
}

return [
    'name'     => 'PCSX2',
    'exes'     => ['pcsx2-qt', 'pcsx2'],
    'consoles' => ['sony playstation 2'],
    'home'     => static fn(string $dir): string =>
        is_file($dir . '\\portable.ini') || is_file($dir . '\\portable.txt') ? $dir : xs_emus_docs('PCSX2'),
    'controls' => static function (string $home, string $platform): array {
        $file = $home . DIRECTORY_SEPARATOR . 'inis' . DIRECTORY_SEPARATOR . 'PCSX2.ini';
        if (!is_file($file)) {
            return ['rows' => [], 'source' => ['file' => null, 'read' => false,
                    'note' => 'PCSX2 keeps its bindings in inis\\PCSX2.ini, which is not there; Settings > Controllers has them.']];
        }
        $rows = [];
        foreach (xs_emus_ini_section($file, 'Pad1') as $k => $v) {
            // Bindings look like "SDL-0/FaceNorth"; the rest of the section is tuning numbers.
            if ($k === 'Type' || str_contains($v, '/')) {
                $rows[] = ['name' => $k, 'value' => $v];
            }
        }
        return ['rows' => $rows, 'source' => ['file' => $file, 'read' => true,
                'note' => 'PCSX2\'s own words: DualShock button on the left, the pad input it listens to on the right.']];
    },
    'leave'    => 'xsegon',
    // The Cheats tab (roadmap CA20): PCSX2's patches and cheats for the game, switched in its own gamesettings file.
    'codes'    => static function (string $home, string $exe, array $game, string $rom, ?string &$why): ?array {
        $code = xs_pcsx2_game_code($home, $rom, $why);
        if ($code === null) {
            return null;
        }
        [$serial, $crc] = $code;
        $ini = xs_pcsx2_ini($home . '\\inis\\PCSX2.ini');
        $own = xs_pcsx2_ini($home . '\\gamesettings\\' . $serial . '_' . $crc . '.ini');
        $flag = static fn(string $k): bool => strtolower(trim((string) (($own['EmuCore'][$k] ?? $ini['EmuCore'][$k] ?? ['false'])[0]))) === 'true';
        $en = array_fill_keys(array_map('trim', $own['Patches']['Enable'] ?? []), true);
        $dis = array_fill_keys(array_map('trim', $own['Patches']['Disable'] ?? []), true);
        // PCSX2's two switches for every game add these two names (pcsx2\Patch.cpp).
        if ($flag('EnableWideScreenPatches')) {
            $en['Widescreen 16:9'] = true;
        }
        if ($flag('EnableNoInterlacingPatches')) {
            $en['No-Interlacing'] = true;
        }
        $list = [];
        foreach (xs_pcsx2_patches($exe, $home, $serial, $crc) as $p) {
            $list[] = ['name' => $p['name'], 'section' => 'Patches', 'kind' => 'patch', 'author' => $p['author'], 'desc' => $p['desc'],
                       'on' => isset($en[$p['name']]) && !isset($dis[$p['name']]), 'yours' => $p['yours']];
        }
        $cheats = xs_pcsx2_cheats($exe, $rom);
        foreach ($cheats['cheats'] as $c) {
            if (!str_starts_with($c['name'], 'Cheats with no name')) {
                $list[] = ['name' => $c['name'], 'section' => 'Cheats', 'kind' => 'cheat', 'author' => $c['author'], 'desc' => $c['desc'],
                           'on' => $c['on'], 'copies' => $c['copies']];
            }
        }
        // With nothing to list, PCSX2's own reason (no cheat file, and the one that would be).
        return ['file' => 'gamesettings\\' . $serial . '_' . $crc . '.ini', 'list' => $list, 'enabled' => $cheats['enabled'], 'why' => $list ? null : $cheats['why']];
    },
    'codeSwitch' => static function (string $home, string $exe, array $game, string $rom, string $sec, string $name, bool $on, ?string &$why): bool {
        if (!in_array($sec, ['Patches', 'Cheats'], true) || trim($name) === '' || preg_match('/[\r\n=]/', $name)) {
            $why = 'no such patch or cheat';
            return false;
        }
        require_once __DIR__ . '/../emusetup.php';
        if (xs_tp_open($exe)) {
            $why = 'PCSX2 is open; close it first, as it writes a game\'s settings again when it closes';
            return false;
        }
        $code = xs_pcsx2_game_code($home, $rom, $why);
        if ($code === null) {
            return false;
        }
        $file = $home . '\\gamesettings\\' . $code[0] . '_' . $code[1] . '.ini';
        $raw = is_file($file) ? (string) @file_get_contents($file) : '';
        $eol = str_contains($raw, "\r\n") || $raw === '' ? "\r\n" : "\n";
        $lines = $raw === '' ? [] : preg_split('/\r?\n/', rtrim($raw, "\r\n"));
        $own = xs_pcsx2_ini($file);
        $lines = xs_es_list_line($lines, $sec, ($on ? 'Disable' : 'Enable') . ' = ' . $name, false);
        // Off, a patch one of PCSX2's switches for every game brings (and that switch is on) is named in Disable; else the Enable line goes.
        $flag = ['Widescreen 16:9' => 'EnableWideScreenPatches', 'No-Interlacing' => 'EnableNoInterlacingPatches'][$name] ?? '';
        $ini = xs_pcsx2_ini($home . '\\inis\\PCSX2.ini');
        $global = $sec === 'Patches' && !$on && $flag !== ''
               && strtolower(trim((string) (($own['EmuCore'][$flag] ?? $ini['EmuCore'][$flag] ?? ['false'])[0]))) === 'true';
        $lines = xs_es_list_line($lines, $sec, ($on ? 'Enable' : 'Disable') . ' = ' . $name, $on || $global);
        if ($sec === 'Cheats' && $on && strtolower(trim((string) (($own['EmuCore']['EnableCheats'] ?? [''])[0]))) !== 'true') {
            // A cheat runs only with cheats on: on for this game in its own file, PCSX2.ini untouched.
            $lines = xs_es_list_line($lines, 'EmuCore', 'EnableCheats = false', false);
            $lines = xs_es_list_line($lines, 'EmuCore', 'EnableCheats = true', true);
        }
        return xs_es_lines_put($file, $lines, $eol, $why);
    },
    'setupLater' => 'Not yet: PCSX2 names a pad by SDL\'s number for it that day (SDL-0 one day, SDL-3 another), so a profile written once could point at the wrong pad. Your own bindings in PCSX2 are what its games use.',
];
