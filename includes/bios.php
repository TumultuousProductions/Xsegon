<?php
/**
 * The BIOS check: which consoles here need a BIOS file beside the emulator, which
 * files, and whether they are in place and genuine.
 *
 * The need follows the core, not the console, so the table is keyed by core, with the
 * sums libretro-database's System.dat publishes. Checking is all this does: BIOS files
 * are copyrighted and never fetched; for PS3 firmware the person is pointed to Sony's free download.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/emulators.php';
require_once __DIR__ . '/retroarch.php';
require_once __DIR__ . '/import.php';

/**
 * Per core: required or optional, why, and the files with libretro's MD5s. md5 null is
 * only looked for (many real dumps); a list means any of several. 'when' limits an entry
 * to consoles whose name holds that word (Sega CD, not Genesis). 'region' and 'anyRegion'
 * serve one game's lack (includes\bioshelp.php). A core's .info "required" overrules this.
 */
function xs_bios_needs(): array
{
    $psx = [
        ['file' => 'scph5500.bin', 'md5' => '8dd7d5296a650fac7319bce665a6a53c', 'size' => 524288, 'note' => 'for Japan discs', 'region' => ['jp']],
        ['file' => 'scph5501.bin', 'md5' => '490f666e1afb15b7362b406ed1cea246', 'size' => 524288, 'note' => 'for USA discs', 'region' => ['us']],
        ['file' => 'scph5502.bin', 'md5' => '32736f17079d0b2b7024407c39bd3050', 'size' => 524288, 'note' => 'for Europe discs', 'region' => ['eu']],
    ];
    $saturn = [
        ['file' => 'sega_101.bin', 'md5' => '85ec9ca47d8f6807718151cbcca8b964', 'size' => 524288, 'note' => 'for Japan discs', 'region' => ['jp']],
        ['file' => 'mpr-17933.bin', 'md5' => '3240872c70984b6cbfda1586cab68dbe', 'size' => 524288, 'note' => 'for USA and Europe discs', 'region' => ['us', 'eu']],
    ];
    // Kronos and the Yabause family take any region's Saturn BIOS, renamed.
    $saturnAny = ['af5828fdff51384f99b3c4926be27762', '85ec9ca47d8f6807718151cbcca8b964', '3240872c70984b6cbfda1586cab68dbe'];
    $saturnOne = static fn(string $at): array => [['file' => $at, 'md5' => $saturnAny, 'size' => 524288,
        'note' => 'any real Saturn BIOS (sega_101.bin or mpr-17933.bin), renamed to this']];
    $ds = [
        ['file' => 'bios7.bin', 'md5' => 'df692a80a5b1bc90728bc3dfc76cd948', 'size' => 16384, 'note' => null],
        ['file' => 'bios9.bin', 'md5' => 'a392174eb3e572fed6447e956bde4b25', 'size' => 4096, 'note' => null],
        ['file' => 'firmware.bin', 'md5' => null, 'size' => null, 'note' => 'any real DS firmware dump'],
    ];
    $segacd = [
        ['file' => 'bios_CD_U.bin', 'md5' => '2efd74e3232ff260e371b99f84024f7f', 'size' => 131072, 'note' => 'for USA discs', 'region' => ['us']],
        ['file' => 'bios_CD_E.bin', 'md5' => 'e66fa1dc5820d254611fdcdba0662372', 'size' => 131072, 'note' => 'for Europe discs', 'region' => ['eu']],
        ['file' => 'bios_CD_J.bin', 'md5' => '278a9397d192149e84e820ac621a8edd', 'size' => 131072, 'note' => 'for Japan discs', 'region' => ['jp']],
    ];
    $requiredDisc = 'this core does not start a disc without its region\'s BIOS';
    $ownSaturn = 'this core emulates the BIOS itself; the real one helps the few games that notice';
    return xs_bios_test_sums([
        'mednafen_psx'    => ['need' => 'required', 'why' => $requiredDisc, 'files' => $psx],
        'mednafen_psx_hw' => ['need' => 'required', 'why' => $requiredDisc, 'files' => $psx],
        // These two start a disc on another region's BIOS when its own is not there.
        'swanstation'     => ['need' => 'required', 'why' => $requiredDisc, 'files' => $psx, 'anyRegion' => true],
        'duckstation'     => ['need' => 'required', 'why' => $requiredDisc, 'files' => $psx, 'anyRegion' => true],
        'pcsx_rearmed'    => ['need' => 'optional', 'why' => 'this core can pretend a BIOS, but games misbehave on it; the real file is better', 'files' => $psx],
        'mednafen_saturn' => ['need' => 'required', 'why' => $requiredDisc, 'files' => $saturn],
        'kronos'          => ['need' => 'required', 'why' => 'this core does not start a Saturn game without a Saturn BIOS', 'files' => $saturnOne('kronos/saturn_bios.bin')],
        'yabasanshiro'    => ['need' => 'required', 'why' => 'this core does not start a Saturn game without a Saturn BIOS', 'files' => $saturnOne('saturn_bios.bin')],
        'yabause'         => ['need' => 'optional', 'why' => $ownSaturn, 'files' => $saturnOne('saturn_bios.bin')],
        'flycast'         => ['need' => 'optional', 'why' => 'this core emulates it; a few games want the real one',
                              'files' => [['file' => 'dc/dc_boot.bin', 'md5' => 'e10c53c2f8b90bab96ead2d368858623', 'size' => 2097152, 'note' => null]]],
        'melonds'         => ['need' => 'optional', 'why' => 'this core has a stand-in BIOS that boots most games; the real files fix the rest', 'files' => $ds],
        'mgba'            => ['need' => 'optional', 'why' => 'the built-in stand-in works; the real one fixes a few picky games',
                              'files' => [['file' => 'gba_bios.bin', 'md5' => 'a860e8c0b6d573d191e4ec7db1b1e4f6', 'size' => 16384, 'note' => null]]],
        'gambatte'        => ['need' => 'optional', 'why' => 'the real boot logo, nothing more',
                              'files' => [['file' => 'gb_bios.bin', 'md5' => '32fbbd84168d3482956eb3c5051637f5', 'size' => 256, 'note' => 'Game Boy'],
                                          ['file' => 'gbc_bios.bin', 'md5' => 'dbfce9db9deaa2567f6a84fde55f9680', 'size' => 2304, 'note' => 'Game Boy Color']]],
        'mesen'           => ['need' => 'optional', 'why' => 'only Famicom Disk System games want it',
                              'files' => [['file' => 'disksys.rom', 'md5' => 'ca30b50f880eb660a320674ed365ef7a', 'size' => 8192, 'note' => null]]],
        'prosystem'       => ['need' => 'optional', 'why' => 'most games run without it',
                              'files' => [['file' => '7800 BIOS (U).rom', 'md5' => '0763f1ffb006ddbe32e52d497ee848ae', 'size' => 4096, 'note' => null]]],
        // Not a BIOS: PPSSPP's free font file. Its info file says required, but games
        // boot without it, so 'keep' stops that word overruling this entry.
        'ppsspp'          => ['need' => 'optional', 'keep' => true,
                              'why' => 'not a BIOS: PPSSPP\'s own font for its save dialogs, free from RetroArch (Online Updater > Core System Files); games boot without it',
                              'files' => [['file' => 'PPSSPP/ppge_atlas.zim', 'md5' => null, 'size' => null, 'note' => null]]],
        'genesis_plus_gx' => ['need' => 'required', 'why' => $requiredDisc, 'when' => 'sega cd', 'files' => $segacd],
        'picodrive'       => ['need' => 'required', 'why' => $requiredDisc, 'when' => 'sega cd', 'files' => $segacd],
    ]);
}

/**
 * A test's stand-in sums (XSEGON_BIOS_SUMS: name => [md5, size]), so no real BIOS is
 * needed near the repo. Honoured only beside XSEGON_DATA.
 */
function xs_bios_test_sums(array $needs): array
{
    $file = getenv('XSEGON_BIOS_SUMS');
    if (!is_string($file) || $file === '' || !getenv('XSEGON_DATA') || !is_file($file)) {
        return $needs;
    }
    $sums = json_decode((string) @file_get_contents($file), true);
    if (!is_array($sums)) {
        return $needs;
    }
    foreach ($needs as $core => $need) {
        foreach ($need['files'] as $i => $f) {
            if (isset($sums[$f['file']][0], $sums[$f['file']][1])) {
                $needs[$core]['files'][$i]['md5'] = (string) $sums[$f['file']][0];
                $needs[$core]['files'][$i]['size'] = (int) $sums[$f['file']][1];
            }
        }
    }
    return $needs;
}

/** One line for a console run by its own program rather than a core, or null when it needs no BIOS. */
function xs_bios_outside_note(string $exe, string $called = ''): ?string
{
    $name = strtolower(basename($exe));
    if (str_contains($name, 'pcsx2')) {
        return 'PCSX2 keeps its own BIOS, set inside PCSX2 (Settings > BIOS): one PS2 BIOS file, from your own PS2.';
    }
    if (str_contains($name, 'xemu')) {
        return 'Xemu needs an MCPX boot ROM, a flash ROM and an EEPROM from your own Xbox, set inside Xemu.';
    }
    if (str_contains($name, 'rpcs3')) {
        return 'RPCS3 uses Sony\'s PS3 firmware (PS3UPDAT.PUP), a free download from Sony\'s own site: the one BIOS anyone hands out legally.';
    }
    if (preg_match('/dolphin|cemu|xenia|retroarch/', $name)) {
        return null;                        // these need nothing, and a core is checked by its own files
    }
    // Any other program answers for itself: saying "no BIOS needed" would be a guess.
    return ($called !== '' ? $called : 'This emulator') . ' is a program of its own: a BIOS it needs is kept and asked for inside it, and is not checked here.';
}

/**
 * Where this RetroArch keeps its BIOS files: retroarch.cfg's system_directory (":"
 * meaning beside retroarch.exe), else the system folder beside the exe.
 */
function xs_bios_system_dir(string $exe): string
{
    // A test's stand-in folder, honoured only beside XSEGON_DATA.
    $test = getenv('XSEGON_RA_SYSTEM');
    if (is_string($test) && $test !== '' && getenv('XSEGON_DATA')) {
        return $test;
    }
    $dir = dirname($exe);
    $sys = (string) (ra_flags(ra_config_path($exe))['system_directory'] ?? '');
    if ($sys !== '' && $sys[0] === ':') {
        $sys = $dir . str_replace('/', DIRECTORY_SEPARATOR, substr($sys, 1));
    } elseif ($sys === '' || $sys === 'default') {
        $sys = $dir . DIRECTORY_SEPARATOR . 'system';
    }
    return xs_norm_path($sys);
}

/** One file looked at on disk: ok, wrong (there but not the real one), or missing. */
function xs_bios_look(string $dir, array $f): array
{
    $at = $dir . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, (string) $f['file']);
    $out = ['file' => $f['file'], 'note' => $f['note'], 'md5' => $f['md5'], 'status' => 'missing'];
    if (!is_file($at)) {
        return $out;
    }
    if ($f['md5'] === null) {
        $out['status'] = 'ok';              // presence is all that can be asked
        return $out;
    }
    // The size first refuses a wrong file without reading it; the sum catches the rest.
    $sums = (array) $f['md5'];
    $out['status'] = (filesize($at) === $f['size'] && in_array(md5_file($at), $sums, true)) ? 'ok' : 'wrong';
    return $out;
}

/**
 * The core's own word on its firmware from its .info file: [path => required?], or [].
 * The folder is retroarch.cfg's libretro_info_path (":" meaning beside the exe), else info\.
 */
function xs_bios_info_firmware(string $exe, string $core): array
{
    $dir = dirname($exe);
    $info = (string) (ra_flags(ra_config_path($exe))['libretro_info_path'] ?? '');
    if ($info !== '' && $info[0] === ':') {
        $info = $dir . str_replace('/', DIRECTORY_SEPARATOR, substr($info, 1));
    } elseif ($info === '' || $info === 'default') {
        $info = $dir . DIRECTORY_SEPARATOR . 'info';
    }
    $text = @file_get_contents(xs_norm_path($info) . DIRECTORY_SEPARATOR . $core . '_libretro.info');
    if ($text === false) {
        return [];
    }
    preg_match_all('/^firmware(\d+)_(path|opt)\s*=\s*"([^"]*)"/m', $text, $m, PREG_SET_ORDER);
    $by = [];
    foreach ($m as $row) {
        $by[(int) $row[1]][$row[2]] = $row[3];
    }
    $out = [];
    foreach ($by as $f) {
        if (isset($f['path'])) {
            $out[$f['path']] = strtolower($f['opt'] ?? 'true') === 'false';
        }
    }
    return $out;
}

/**
 * What one core wants on one console: the table's entry, with the core's
 * own info file overruling it on "required", or null when it wants nothing.
 */
function xs_bios_core_need(array $needs, string $exe, string $core, string $platform): ?array
{
    $need = $needs[$core] ?? null;
    if ($need !== null && isset($need['when']) && !str_contains(strtolower($platform), $need['when'])) {
        $need = null;                       // the same core, but not the console these files are for
    }
    // The core's own info file has the last word on "required".
    $said = xs_bios_info_firmware($exe, $core);
    if ($need !== null) {
        foreach (empty($need['keep']) ? $need['files'] : [] as $f) {
            if (!empty($said[$f['file']]) && $need['need'] !== 'required') {
                $need['need'] = 'required';
                $need['why'] = 'this core says it does not start without it';
            }
        }
    } elseif (in_array(true, $said, true)) {
        // A core the table does not know that says it needs files: looked for by name only.
        $need = ['need' => 'required', 'why' => 'this core says it does not start without it', 'files' => []];
        foreach ($said as $path => $req) {
            if ($req) {
                $need['files'][] = ['file' => $path, 'md5' => null, 'size' => null, 'note' => null];
            }
        }
    }
    return $need;
}

/**
 * The whole picture: each console with games here, through the emulator its
 * games launch with, to the files that emulator wants and their state.
 */
function xs_bios_report(): array
{
    $s = xs_settings();
    $table = xs_emulators(xs_norm_path((string) ($s['paths']['launchbox'] ?? '')));
    $needs = xs_bios_needs();

    $count = [];
    foreach (xs_library()['games'] ?? [] as $g) {
        $count[(string) $g['platform']] = ($count[(string) $g['platform']] ?? 0) + 1;
    }
    ksort($count, SORT_NATURAL | SORT_FLAG_CASE);

    $consoles = [];
    $outside = [];
    $fine = [];
    foreach ($count as $platform => $games) {
        $opt = xs_emu_option($table, $platform) ?? (xs_emu_options($table, $platform)[0] ?? null);
        if ($opt === null) {
            continue;                       // Steam, web games, your own programs: no emulator, no BIOS
        }
        $exe = (string) ($table['programs'][$opt['program'] ?? '']['exe'] ?? '');
        $core = strtolower((string) ($opt['core'] ?? ''));
        if ($core === '') {
            $note = xs_bios_outside_note($exe, (string) ($table['programs'][$opt['program'] ?? '']['name'] ?? ''));
            if ($note !== null) {
                $outside[] = ['platform' => $platform, 'games' => $games, 'note' => $note];
            } else {
                $fine[] = $platform;
            }
            continue;
        }
        $need = xs_bios_core_need($needs, $exe, $core, (string) $platform);
        if ($need === null) {
            $fine[] = $platform;
            continue;
        }
        $dir = xs_bios_system_dir($exe);
        $consoles[] = [
            'platform' => $platform,
            'games'    => $games,
            'core'     => $core,
            'need'     => $need['need'],
            'why'      => $need['why'],
            'dir'      => $dir,
            'files'    => array_map(static fn(array $f): array => xs_bios_look($dir, $f), $need['files']),
        ];
    }
    return ['consoles' => $consoles, 'outside' => $outside, 'fine' => $fine];
}
