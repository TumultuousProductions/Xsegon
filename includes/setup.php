<?php
/**
 * Xsegon - getting a new person up and going: RetroArch, its cores and the
 * setting-up run.
 *
 *   Is there a RetroArch here already?   xs_ra_find(). If so, Get RetroArch
 *                                        is never offered: two copies confuse.
 *   What would Get RetroArch fetch?      xs_setup_source(), one pinned version
 *                                        with its SHA-256: a changed file is refused.
 *   Which consoles are missing a core?   xs_setup_cores().
 *
 * The fetches run in bin\setup.ps1 in the background (200 MB does not fit in
 * one request). Xsegon's own RetroArch gets a small retroarch.cfg; a person's
 * own only gains missing cores after a yes; one in an imported library's folder is never written to.
 * Downloads come from libretro, no mirror.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/emulators.php';
require_once __DIR__ . '/retroarch.php';
require_once __DIR__ . '/steam.php';      // xs_steam_root, for Steam's copy of RetroArch

/* The one RetroArch Xsegon fetches, pinned because "latest" is untested.
   Moving to a newer one is these three lines, after downloading, hashing and running it. */
const XS_RA_VERSION = '1.22.2';
const XS_RA_BYTES   = 202509078;
const XS_RA_SHA256  = 'b2139b1d0f9d4526dc6b5ce23cbb3efdc766096fa6f2c3df016818b486ac6372';

/** Xsegon's own RetroArch in the emulator table. */
const XS_RA_KEY = 'retroarch-xsegon';

/** Where Get RetroArch's download comes from, and what it must hash to. */
function xs_setup_source(): array
{
    /* The test runner points this at a small archive, so the whole pipeline
       runs offline. Only honoured next to XSEGON_DATA, which only tests set. */
    $test = getenv('XSEGON_SETUP_SOURCE');
    if (is_string($test) && $test !== '' && getenv('XSEGON_DATA')) {
        return [
            'version' => 'test',
            'url'     => 'file:///' . str_replace('\\', '/', $test),
            'sha256'  => strtolower((string) getenv('XSEGON_SETUP_SHA')),
            'bytes'   => is_file($test) ? (int) filesize($test) : 0,
            // XSEGON_SETUP_CARRIED: the test's archive stands for one the package carries
            'local'   => getenv('XSEGON_SETUP_CARRIED') && is_file($test) ? $test : '',
        ];
    }
    // A package carries the pinned archive (tools\get-retroarch.js): unpacked from there, nothing downloaded.
    $carried = XS_ROOT . DIRECTORY_SEPARATOR . 'runtime' . DIRECTORY_SEPARATOR . 'RetroArch' . DIRECTORY_SEPARATOR . 'RetroArch.7z';
    return [
        'version' => XS_RA_VERSION,
        'url'     => 'https://buildbot.libretro.com/stable/' . XS_RA_VERSION . '/windows/x86_64/RetroArch.7z',
        'sha256'  => XS_RA_SHA256,
        'bytes'   => XS_RA_BYTES,
        'local'   => is_file($carried) && filesize($carried) === XS_RA_BYTES ? $carried : '',
    ];
}

/** Where cores come from: the same place RetroArch's own Online Updater uses. */
function xs_setup_cores_base(): string
{
    $test = getenv('XSEGON_SETUP_CORES');
    if (is_string($test) && $test !== '' && getenv('XSEGON_DATA')) {
        return rtrim($test, '/\\') . '/';
    }
    return 'https://buildbot.libretro.com/nightly/windows/x86_64/latest/';
}

function xs_own_ra_dir(): string
{
    return xs_data_path('emulators' . DIRECTORY_SEPARATOR . 'RetroArch');
}

function xs_own_ra_exe(): string
{
    return xs_own_ra_dir() . DIRECTORY_SEPARATOR . 'retroarch.exe';
}

function xs_setup_job_path(): string
{
    return xs_data_path('setup-job.json');
}

/**
 * The usual places a person's own RetroArch lives: the installer's default,
 * Program Files, and Steam's copy. Tests replace the list (XSEGON_SETUP_PLACES).
 */
function xs_ra_places(): array
{
    $test = getenv('XSEGON_SETUP_PLACES');
    if (is_string($test) && getenv('XSEGON_DATA')) {
        return array_values(array_filter(explode(';', $test)));
    }
    $out = ['C:\\RetroArch-Win64', 'C:\\RetroArch'];
    foreach (['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'] as $env) {
        $base = getenv($env);
        if (is_string($base) && $base !== '') {
            $out[] = $base . '\\RetroArch';
            $out[] = $base . '\\RetroArch-Win64';
            if ($env === 'LOCALAPPDATA') {
                $out[] = $base . '\\Programs\\RetroArch';
            }
        }
    }
    if (function_exists('xs_steam_root')) {
        $steam = xs_steam_root();
        if ($steam !== '') {
            $out[] = $steam . '\\steamapps\\common\\RetroArch';
        }
    }
    return $out;
}

/** retroarch.exe beside this program (a wrapper .bat counts), or null. */
function xs_ra_beside(string $exe): ?string
{
    if ($exe === '') {
        return null;
    }
    $ra = dirname($exe) . DIRECTORY_SEPARATOR . 'retroarch.exe';
    return is_file($ra) ? $ra : null;
}

/** Is this path inside an imported library's folder, which Xsegon never writes to. */
function xs_in_launchbox(string $path): bool
{
    if ($path === '') {
        return false;
    }
    $root = xs_norm_path((string) (xs_settings()['paths']['launchbox'] ?? ''));
    if ($root !== '') {
        $root = rtrim($root, '\\/') . DIRECTORY_SEPARATOR;
        if (strncasecmp(xs_abs_path($path), $root, strlen($root)) === 0) {
            return true;
        }
    }
    /* The setting can be blank while emulators still run from LaunchBox's
       folder, so any ancestor holding LaunchBox.exe counts too: otherwise a
       core fetch could write into LaunchBox's RetroArch. */
    $dir = xs_abs_path($path);
    for ($i = 0; $i < 12; $i++) {
        $up = dirname($dir);
        if ($up === $dir) {
            break;
        }
        $dir = $up;
        if (is_file($dir . DIRECTORY_SEPARATOR . 'LaunchBox.exe')) {
            return true;
        }
    }
    return false;
}

/**
 * Is there a RetroArch here already, and where. In this order, first answer
 * wins: the emulator table (what launches today), Xsegon's own folder, the
 * library's launch commands, then the usual install places.
 *
 *   have      a retroarch.exe exists somewhere
 *   inTable   the emulator table already runs it
 *   own       it is the copy Xsegon fetched
 *   launchbox it lives in an imported library's folder (read only)
 */
function xs_ra_find(array $table, array $library): array
{
    $hit = static fn (string $exe, string $where, ?string $key) => [
        'have'      => true,
        'exe'       => $exe,
        'where'     => $where,
        'key'       => $key,
        'inTable'   => $key !== null,
        'own'       => strcasecmp(xs_abs_path($exe), xs_abs_path(xs_own_ra_exe())) === 0,
        'launchbox' => xs_in_launchbox($exe),
    ];

    // The one the table points at, busiest first when there are several.
    $uses = [];
    foreach ($table['platforms'] ?? [] as $entry) {
        foreach ($entry['options'] ?? [] as $o) {
            $uses[$o['program'] ?? ''] = ($uses[$o['program'] ?? ''] ?? 0) + 1;
        }
    }
    $keys = array_keys($table['programs'] ?? []);
    usort($keys, static fn ($a, $b) => ($uses[$b] ?? 0) <=> ($uses[$a] ?? 0));
    foreach ($keys as $key) {
        $ra = xs_ra_beside((string) ($table['programs'][$key]['exe'] ?? ''));
        if ($ra !== null) {
            return $hit($ra, 'table', $key);
        }
    }
    if (is_file(xs_own_ra_exe())) {
        return $hit(xs_own_ra_exe(), 'own', null);
    }
    $lib = ra_exe_from_library($library);
    if ($lib !== null) {
        return $hit($lib, 'library', null);
    }
    foreach (xs_ra_places() as $dir) {
        $ra = rtrim($dir, '\\/') . DIRECTORY_SEPARATOR . 'retroarch.exe';
        if (is_file($ra)) {
            return $hit($ra, 'place', null);
        }
    }
    return ['have' => false, 'exe' => null, 'where' => null, 'key' => null,
            'inTable' => false, 'own' => false, 'launchbox' => false];
}

/**
 * The core each console gets when Xsegon sets RetroArch up for someone who
 * has nothing; a console with an emulator already keeps it. PCSX ReARMed for
 * the PlayStation because it plays without a BIOS file. Each name must exist
 * on libretro's buildbot.
 */
function xs_setup_default_cores(): array
{
    return [
        '3DO Interactive Multiplayer'   => 'opera',
        'Amstrad CPC'                   => 'cap32',
        'Arcade'                        => 'fbneo',
        'Atari 2600'                    => 'stella',
        'Atari 5200'                    => 'a5200',
        'Atari 7800'                    => 'prosystem',
        'Atari Jaguar'                  => 'virtualjaguar',
        'Atari Lynx'                    => 'handy',
        'ColecoVision'                  => 'gearcoleco',
        'Commodore 64'                  => 'vice_x64',
        'Commodore Amiga'               => 'puae',
        'Fairchild Channel F'           => 'freechaf',
        'GCE Vectrex'                   => 'vecx',
        'Magnavox Odyssey 2'            => 'o2em',
        'Mattel Intellivision'          => 'freeintv',
        'Microsoft MSX'                 => 'fmsx',
        'NEC TurboGrafx-16'             => 'mednafen_pce_fast',
        'NEC TurboGrafx-CD'             => 'mednafen_pce_fast',
        'Nintendo 64'                   => 'mupen64plus_next',
        'Nintendo DS'                   => 'melondsds',
        'Nintendo Entertainment System' => 'mesen',
        'Nintendo Famicom Disk System'  => 'nestopia',
        'Nintendo Game Boy'             => 'gambatte',
        'Nintendo Game Boy Color'       => 'gambatte',
        'Nintendo Game Boy Advance'     => 'mgba',
        'Nintendo Pokemon Mini'         => 'pokemini',
        'Nintendo Virtual Boy'          => 'mednafen_vb',
        'Sega 32X'                      => 'picodrive',
        'Sega CD'                       => 'genesis_plus_gx',
        'Sega Dreamcast'                => 'flycast',
        'Sega Game Gear'                => 'genesis_plus_gx',
        'Sega Genesis'                  => 'genesis_plus_gx',
        'Sega Master System'            => 'genesis_plus_gx',
        'Sega Saturn'                   => 'mednafen_saturn',
        'Sinclair ZX Spectrum'          => 'fuse',
        'SNK Neo Geo AES'               => 'fbneo',
        'SNK Neo Geo MVS'               => 'fbneo',
        'SNK Neo Geo Pocket'            => 'mednafen_ngp',
        'SNK Neo Geo Pocket Color'      => 'mednafen_ngp',
        'Sony Playstation'              => 'pcsx_rearmed',
        'Sony PSP'                      => 'ppsspp',
        'Super Nintendo Entertainment System' => 'snes9x',
        'WonderSwan'                    => 'mednafen_wswan',
        'WonderSwan Color'              => 'mednafen_wswan',
    ];
}

/** Offered selected when there are no games yet to say which consoles matter. */
function xs_setup_popular(): array
{
    return ['Nintendo Entertainment System', 'Super Nintendo Entertainment System', 'Nintendo 64',
            'Nintendo Game Boy', 'Nintendo Game Boy Color', 'Nintendo Game Boy Advance',
            'Sega Genesis', 'Sony Playstation'];
}

/**
 * What Xsegon writes into ITS OWN RetroArch before the first run, and only
 * if that folder has no retroarch.cfg yet. Every other setting is
 * RetroArch's default. Never written anywhere else.
 */
function xs_setup_preset(): array
{
    return [
        'network_cmd_enable'         => ['true',  'so Xsegon can load a save you pick, and quit a game'],
        'network_cmd_port'           => ['55355', "RetroArch's usual port for that"],
        'quit_press_twice'           => ['false', 'one press of quit comes back to Xsegon'],
        'savestate_thumbnail_enable' => ['true',  'each save gets a picture, which the save list shows'],
        // Said outright so the save list (includes\states.php) and RetroArch agree where saves go.
        'sort_savestates_enable'            => ['false', 'saves go straight in the states folder'],
        'sort_savestates_by_content_enable' => ['false', 'not in a folder per console'],
    ];
}

/**
 * Put a RetroArch in the emulator table and give every console that has
 * nothing set up a default core on it. An emulator someone already chose
 * for a console is never replaced.
 */
function xs_setup_register(string $exe, bool $own, ?string &$why = null): array
{
    $table = xs_read_json(xs_emulators_path(), null);
    if (!is_array($table) || !isset($table['programs'])) {
        $table = ['made' => date('c'), 'from' => 'Xsegon', 'programs' => [], 'platforms' => []];
    }
    unset($table['mine']);
    $key = $own ? XS_RA_KEY : xs_emu_key($exe);
    if (isset($table['programs'][$key]) && strcasecmp((string) $table['programs'][$key]['exe'], $exe) !== 0) {
        $key .= '-2';
    }
    $table['programs'][$key] = [
        'name'     => $own ? 'RetroArch (Xsegon)' : 'RetroArch',
        'exe'      => $exe,
        'args'     => '',
        'noQuotes' => false,
    ];
    $filled = [];
    foreach (xs_setup_default_cores() as $platform => $core) {
        $pk = strtolower($platform);
        if (!empty($table['platforms'][$pk]['options'])) {
            continue;
        }
        $load = 'cores\\' . $core . '_libretro.dll';
        $table['platforms'][$pk]['options'] = [[
            'program'    => $key,
            'emulator'   => 'RetroArch',
            'emulatorId' => 'xsegon-' . $key,
            'args'       => '-L "' . $load . '" -f',
            'core'       => $core,
            'load'       => $load,
            'default'    => true,
        ]];
        $filled[] = $platform;
    }
    ksort($table['platforms']);
    if (!xs_emulators_write($table, $why)) {
        return ['ok' => false, 'key' => $key, 'filled' => []];
    }
    return ['ok' => true, 'key' => $key, 'filled' => $filled];
}

/** Write Xsegon's small retroarch.cfg, only where none exists yet. */
/** 'wrote', 'exists', or 'failed': a failed write must not be logged as "had its own cfg". */
function xs_setup_write_preset(string $dir): string
{
    $cfg = $dir . DIRECTORY_SEPARATOR . 'retroarch.cfg';
    if (is_file($cfg)) {
        return 'exists';
    }
    $lines = ['# Written by Xsegon before this RetroArch first ran. Everything else is',
              "# RetroArch's own default, and RetroArch keeps this file from here on."];
    foreach (xs_setup_preset() as $k => [$v, $why]) {
        $lines[] = $k . ' = "' . $v . '"';
    }
    if (@file_put_contents($cfg, implode("\r\n", $lines) . "\r\n") === false) {
        xs_log('SETUP', 'the preset could not be written to ' . $cfg . ' (' . xs_file_error_reason() . ')');
        return 'failed';
    }
    return 'wrote';
}

/** How far RetroArch's unpack is, 0 to 100, or null when nothing says (xs_7zr_percent). */
function xs_setup_unpacked(array $job): ?int
{
    return xs_7zr_percent((string) ($job['prog'] ?? ''));
}

/** The background job, as the page sees it. Finishes a completed fetch. */
function xs_setup_job(): ?array

{
    $job = xs_read_json(xs_setup_job_path(), null);
    if (!is_array($job)) {
        return null;
    }
    // A job whose worker died would say "running" forever and block the button.
    // Two hours is far past a slow 200 MB download.
    if (($dead = xs_job_dead($job, xs_setup_job_path())) !== null) {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped part way (' . $dead . '); try again';
        xs_write_json(xs_setup_job_path(), $job);
        xs_log('SETUP', 'job ' . ($job['kind'] ?? '?') . ' stopped: ' . $dead . '; marked failed');
    }
    if (($job['state'] ?? '') === 'running' && time() - (int) ($job['started'] ?? 0) > 7200) {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped answering; try again';
        xs_write_json(xs_setup_job_path(), $job);
        xs_log('SETUP', 'job ' . ($job['kind'] ?? '?') . ' timed out');
    }
    if (($job['state'] ?? '') === 'running' && !empty($job['part']) && is_file($job['part'])) {
        $job['bytes'] = (int) filesize($job['part']);
    }
    // Unpacking: how far 7zr says it is, when it is the one unpacking.
    if (($job['state'] ?? '') === 'running' && ($job['step'] ?? '') === 'unpack' && ($pct = xs_setup_unpacked($job)) !== null) {
        $job['unpacked'] = $pct;
    }
    if (($job['kind'] ?? '') === 'retroarch' && ($job['state'] ?? '') === 'done' && empty($job['applied'])) {
        $dir = xs_own_ra_dir();
        $wrote = xs_setup_write_preset($dir);
        $reg = xs_setup_register(xs_own_ra_exe(), true, $why);
        $job['applied'] = true;
        $job['preset']  = $wrote;
        $job['filled']  = $reg['filled'];
        if (!$reg['ok']) {
            $job['state'] = 'failed';
            $job['error'] = 'RetroArch arrived but the emulator table could not be written: ' . $why;
        }
        xs_write_json(xs_setup_job_path(), $job);
        xs_log('SETUP', 'RetroArch ' . ($job['version'] ?? '') . ' ready at ' . $dir
            . ($wrote === 'wrote' ? ', preset written' : ($wrote === 'exists' ? ', had its own cfg' : ', PRESET FAILED (no quit button or save-state loading until it is written)'))
            . ', ' . count($reg['filled']) . ' consoles given a core');
        // How long each step took (bin\setup.ps1 stamps them): a slow line or a slow disk.
        $took = static fn (string $a, string $b): string
            => isset($job[$a], $job[$b]) ? max(0, (int) $job[$b] - (int) $job[$a]) . 's' : '?';
        xs_log('SETUP', 'RetroArch took: download ' . $took('tDownload', 'tCheck') . ', check ' . $took('tCheck', 'tUnpack')
            . ', unpack ' . $took('tUnpack', 'ended'));
        // Windows' tar unpacked it, with no percentage: logged with why 7zr was not used.
        if (($job['unpackedWith'] ?? '') === 'tar') {
            xs_log('SETUP', 'RetroArch was unpacked by Windows\' tar, with no percentage to show: 7zr was not the one');
            foreach (mb_str_split(trim((string) ($job['detail'] ?? '')), 360) as $i => $piece) {
                xs_log('SETUP', 'job retroarch' . ($i === 0 ? ' 7zr: ' : ' 7zr, more: ') . $piece);
            }
        }
        /* Under the one yes (xs_setup_auto) the cores follow RetroArch for the
           consoles already scanned: the job file becomes the cores job. With
           nothing scanned the scan's accept starts them (api\scan.php). */
        if (($job['state'] ?? '') === 'done' && xs_setup_auto()) {
            $cerr = null;
            $next = xs_setup_chain_cores($cerr);
            if ($next !== null) {
                return $next;
            }
            if ($cerr !== null) {
                xs_log('SETUP', 'cores did not follow by themselves: ' . $cerr);
            }
        }
    }
    if (($job['kind'] ?? '') === 'cores' && ($job['state'] ?? '') === 'done' && empty($job['logged'])) {
        $job['logged'] = true;
        xs_write_json(xs_setup_job_path(), $job);
        $got = count(array_filter($job['cores'] ?? [], static fn ($c) => ($c['state'] ?? '') === 'done'));
        xs_log('SETUP', 'cores: ' . $got . ' of ' . count($job['cores'] ?? []) . ' fetched into ' . ($job['dest'] ?? ''));
    }
    // A failed fetch is logged once, whatever failed it, not only the timeout above.
    if (($job['state'] ?? '') === 'failed' && empty($job['failLogged'])) {
        $job['failLogged'] = true;
        xs_write_json(xs_setup_job_path(), $job);
        xs_log('SETUP', 'job ' . ($job['kind'] ?? '?') . ' failed: ' . ($job['error'] ?? '(no reason written)'));
        // The program's own words (bin\setup.ps1, Fail's $detail), in pieces:
        // a log line is cut at 400 characters.
        foreach (mb_str_split(trim((string) ($job['detail'] ?? '')), 360) as $i => $piece) {
            xs_log('SETUP', 'job ' . ($job['kind'] ?? '?') . ($i === 0 ? ' why: ' : ' why, more: ') . $piece);
        }
    }
    return $job;
}

/** True while a fetch is under way. */
function xs_setup_busy(?array $job): bool
{
    return is_array($job) && ($job['state'] ?? '') === 'running';
}

/** Start bin\setup.ps1 on a job file already written. */
function xs_setup_start(): bool
{
    $script = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'setup.ps1';
    return xs_spawn_ps(xs_ps_call($script, ['Job' => xs_setup_job_path()]));
}

/** The one yes from Getting started: everything fetched by itself. */
function xs_setup_auto(): bool
{
    $asked = xs_read_json(xs_data_path('setup.json'), []);
    return is_array($asked) && !empty($asked['auto']);
}

/** Names and pictures were switched off in the setup window: no pass starts by itself. */
function xs_setup_pictures_off(): bool
{
    $asked = xs_read_json(xs_data_path('setup.json'), []);
    return is_array($asked) && !empty($asked['noPictures']);
}

/* The Runs check the one yes owes its games. Set by the yes and the scan's
   accept; api\running.php says when it may start, api\runcheck.php clears it. */
function xs_setup_runs_want(bool $on): void
{
    $asked = xs_read_json(xs_data_path('setup.json'), []);
    $asked = is_array($asked) ? $asked : [];
    // Skipped at the yes, or on the list: none is owed, now or by a later scan.
    if ($on && !empty($asked['runsSkip'])) {
        return;
    }
    if (!empty($asked['runsWanted']) === $on) {
        return;
    }
    $asked['runsWanted'] = $on;
    xs_write_json(xs_data_path('setup.json'), $asked);
    xs_log('SETUP', $on ? 'the runs check is owed: it starts when the downloads and pictures are done' : 'the runs check is no longer owed');
}

/* ---- a setting-up run: what the Setting up list shows -------------------
   From the yes (or a scan under it) until every part has ended. The record
   is setup.json's "run"; the parts are read off the jobs' own files, so a
   page opened half way shows the same list. */

const XS_RUN_GAME_SECS = 25;       // what the Runs check spends on one game, start to close
const XS_RUN_LINGER    = 30;       // a finished run stays on the list this long

/** Begin a run, unless one is under way. */
function xs_setup_run_begin(string $by, bool $haveRa): void
{
    $asked = xs_read_json(xs_data_path('setup.json'), []);
    $asked = is_array($asked) ? $asked : [];
    if (is_array($asked['run'] ?? null) && empty($asked['run']['ended'])) {
        return;
    }
    $asked['run'] = ['started' => time(), 'by' => $by, 'ra' => $haveRa ? 'have' : 'get'];
    xs_write_json(xs_data_path('setup.json'), $asked);
    xs_log('SETUP', 'setting up begins (' . $by . '): RetroArch ' . ($haveRa ? 'is here' : 'to fetch'));
}

/** Note something on the run under way; nothing when there is none. */
function xs_setup_run_set(array $patch): void
{
    $asked = xs_read_json(xs_data_path('setup.json'), []);
    if (!is_array($asked) || !is_array($asked['run'] ?? null) || !empty($asked['run']['ended'])) {
        return;
    }
    $asked['run'] = $patch + $asked['run'];
    xs_write_json(xs_data_path('setup.json'), $asked);
}

/**
 * The run as the list draws it: RetroArch, its cores, the names and
 * pictures, and the Runs check, each with a state (waiting, running, done,
 * failed, stopped, skipped) and its numbers. Null when no run is on.
 * Finishes a completed download and tries a failed pictures pass once more
 * when the downloads are out of its way, as whoever asks the setup API does.
 */
function xs_setup_run_view(): ?array
{
    $asked = xs_read_json(xs_data_path('setup.json'), []);
    $run = is_array($asked) && is_array($asked['run'] ?? null) ? $asked['run'] : null;
    if ($run === null || (!empty($run['ended']) && time() - (int) $run['ended'] > XS_RUN_LINGER)) {
        return null;
    }
    require_once __DIR__ . '/scan.php';
    require_once __DIR__ . '/fill.php';
    $since = (int) ($run['started'] ?? 0) - 5;
    $games = count(xs_scan_read());
    $job   = xs_setup_job();
    $mine  = is_array($job) && (int) ($job['started'] ?? 0) >= $since;
    $kind  = $mine ? (string) ($job['kind'] ?? '') : '';

    // RetroArch: this run's download, or the one that was here at the yes.
    if ($kind === 'retroarch') {
        $ra = ['state' => (string) ($job['state'] ?? 'running'), 'step' => (string) ($job['step'] ?? ''),
               'bytes' => (int) ($job['bytes'] ?? 0), 'total' => (int) ($job['total'] ?? 0),
               'unpacked' => isset($job['unpacked']) ? (int) $job['unpacked'] : null,
               'version' => (string) ($job['version'] ?? ''), 'error' => (string) ($job['error'] ?? '')];
    } elseif ($kind === 'cores' || ($run['ra'] ?? '') === 'have' || is_file(xs_own_ra_exe())) {
        $ra = ['state' => 'done', 'had' => ($run['ra'] ?? '') === 'have'];
    } elseif (is_array($job) && ($job['kind'] ?? '') === 'retroarch' && ($job['state'] ?? '') === 'failed') {
        $ra = ['state' => 'failed', 'error' => (string) ($job['error'] ?? '')];      // an earlier fetch that stopped
    } else {
        $ra = time() - (int) ($run['started'] ?? 0) > 15
            ? ['state' => 'failed', 'error' => 'it is not here: Help > Getting started fetches it'] : ['state' => 'waiting'];
    }

    // Its cores follow it, for the consoles the scanned games are for.
    if ($kind === 'cores') {
        $all = (array) ($job['cores'] ?? []);
        $got = count(array_filter($all, static fn ($c) => ($c['state'] ?? '') === 'done'));
        $bad = count(array_filter($all, static fn ($c) => ($c['state'] ?? '') === 'failed'));
        $moved = count(array_filter($all, static fn ($c) => ($c['state'] ?? '') !== 'waiting'));
        $cores = ['state' => (string) ($job['state'] ?? 'running'), 'got' => $got, 'bad' => $bad, 'moved' => $moved,
                  'all' => count($all), 'error' => (string) ($job['error'] ?? '')];
    } elseif ($ra['state'] !== 'done') {
        $cores = ['state' => $ra['state'] === 'failed' ? 'stopped' : 'waiting', 'for' => 'retroarch'];
    } else {
        $cores = $games ? ['state' => 'done', 'all' => 0] : ['state' => 'waiting', 'for' => 'games'];
    }

    // Names and pictures: this run's pass, or one already at work.
    $fj = xs_fill_job();
    $fmine = is_array($fj) && ($fj['mode'] ?? '') !== 'look'
        && ((int) ($fj['started'] ?? 0) >= $since || ($fj['state'] ?? '') === 'running');
    $downloading = xs_setup_busy($job);
    if ($fmine && ($fj['state'] ?? '') === 'failed' && empty($run['fillRetried']) && empty($run['ended'])
        && !$downloading && !xs_fast_lane()) {
        // Once more, now nothing else is working the disk: beside the unpack a slow PC can run out of time.
        xs_setup_run_set(['fillRetried' => true]);
        xs_log('FILL', 'the pass that stopped (' . (string) ($fj['error'] ?? '') . ') is tried once more, now the downloads are done');
        if (xs_fill_start(['mode' => 'all', 'picks' => [], 'pictures_wanted' => true, 'complete' => false, 'dry' => false])) {
            $fj = xs_fill_job();
        }
    }
    if ($fmine) {
        $fill = (array) xs_fill_job_light($fj);          // "again": one more try is owed
    } elseif (!empty($asked['noPictures'])) {
        $fill = ['state' => 'skipped'];                   // switched off in the setup window
    } else {
        $fill = $games ? ['state' => 'done', 'none' => true] : ['state' => 'waiting', 'for' => 'games'];
    }

    // The Runs check, last: skipped, at work, ended, or owed.
    $rcFile = xs_data_path('runcheck') . DIRECTORY_SEPARATOR . 'status.json';
    $rc = xs_read_json($rcFile, null);
    $rcOn = is_array($rc) && (!empty($rc['running']) || !empty($rc['starting']));
    // A status not written for two minutes is a runner that died (api\running.php).
    $rcDead = $rcOn && time() - (int) @filemtime($rcFile) >= 120;
    if ($rcOn && !$rcDead) {
        $runs = ['state' => 'running', 'index' => (int) ($rc['index'] ?? 0), 'total' => (int) ($rc['total'] ?? 0),
                 'title' => (string) (($rc['current'] ?? [])['title'] ?? '')];
    } elseif (is_array($rc) && (int) strtotime((string) ($rc['startedAt'] ?? '')) >= $since) {
        $runs = ['state' => $rcDead || !empty($rc['stopped']) ? 'stopped' : 'done', 'index' => (int) ($rc['index'] ?? 0),
                 'total' => (int) ($rc['total'] ?? 0), 'counts' => $rc['counts'] ?? null,
                 'why' => $rcDead ? 'it stopped answering' : ($rc['why'] ?? null)];
    } elseif (!empty($asked['runsSkip'])) {
        // not owed: left for later, or the question has not been answered yet
        $runs = !empty($asked['runsAsk']) ? ['state' => 'waiting', 'for' => $games ? 'answer' : 'games'] : ['state' => 'skipped'];
    } elseif (!empty($asked['runsWanted'])) {
        $runs = ['state' => 'waiting', 'for' => 'rest'];
    } elseif (!empty($run['runs'])) {
        $runs = ['state' => 'done', 'note' => (string) $run['runs']];
    } else {
        $runs = $games ? ['state' => 'done', 'note' => 'none'] : ['state' => 'waiting', 'for' => 'games'];
    }
    $runs['games'] = $games;
    $runs['secs']  = $games * XS_RUN_GAME_SECS;

    $live = static fn (array $p): bool => in_array($p['state'], ['running', 'waiting'], true);

    // The cheat lists and the videos, where the answer asked for them: a line each, off the fetch's own file.
    require_once __DIR__ . '/cheatlists.php';
    $part = static fn (array $j, array $keys): array
        => ['state' => in_array($j['state'] ?? '', ['running', 'done', 'stopped'], true) ? (string) $j['state'] : 'failed']
           + array_intersect_key($j, array_flip($keys));
    $cj = xs_cl_job();
    $cheats = is_array($cj) && (int) ($cj['started'] ?? 0) >= $since
        ? $part($cj, ['phase', 'bytes', 'total', 'at', 'files', 'error']) : ['state' => 'skipped'];
    $vPath = xs_data_path('archivevid-job.json');
    $vj = xs_read_json($vPath, null);
    if (is_array($vj) && ($vDead = xs_job_dead($vj, $vPath)) !== null) {
        $vj = ['state' => 'failed', 'error' => 'it stopped before it finished: ' . $vDead] + $vj;
    }
    // Stop on a fetch of this run is a Stop of the videos owed too: none is started behind it.
    if (!empty($asked['videosWanted']) && is_array($vj) && ($vj['state'] ?? '') === 'stopped'
        && (int) ($vj['started'] ?? 0) >= $since && !xs_fast_lane()) {
        $kept = xs_read_json(xs_data_path('setup.json'), []);
        $kept = is_array($kept) ? $kept : [];
        unset($kept['videosWanted'], $asked['videosWanted']);
        xs_write_json(xs_data_path('setup.json'), $kept);
        xs_log('SETUP', 'videos were asked for, and a video fetch of this run was stopped: none is started behind it');
    }
    if (!empty($asked['videosWanted'])) {
        // Owed since the answer, and started once the names are in: a video is found by its game's name.
        // A fetch at work already (one started by hand) is waited out first, so what is owed is still started.
        $videos = is_array($vj) && ($vj['state'] ?? '') === 'running' ? ['state' => 'waiting', 'for' => 'fetch']
            : ($live($fill) || !empty($fill['again']) || $games === 0 || xs_fast_lane()
                ? ['state' => 'waiting', 'for' => 'fill'] : xs_setup_run_videos());
    } elseif (is_array($vj) && (int) ($vj['started'] ?? 0) >= $since) {
        $videos = $part($vj, ['phase', 'sets', 'setsAt', 'games', 'at', 'found', 'added', 'bytes', 'total', 'cuts', 'cutAt', 'error']);
        // Its worker starts when the Arcade Database's part is through: until then that part is what is at work.
        $aj = $videos['state'] === 'running' && empty($vj['pid']) ? xs_read_json(xs_data_path('arcadevid-job.json'), null) : null;
        if (is_array($aj) && ($aj['state'] ?? '') === 'running' && !empty($aj['then'])) {
            $videos = ['phase' => 'arcade', 'at' => (int) ($aj['at'] ?? 0), 'games' => (int) ($aj['games'] ?? 0)] + $videos;
        }
    } elseif (!empty($run['videos'])) {
        $videos = $run['videos'] === 'none' ? ['state' => 'done', 'note' => 'none'] : ['state' => 'failed', 'error' => (string) $run['videos']];
    } else {
        $videos = ['state' => 'skipped'];
    }

    $over = !$live($ra) && !$live($cores) && !$live($fill) && empty($fill['again']) && !$live($runs) && !$live($cheats) && !$live($videos);
    // With no games nothing more can come until a scan brings some (which
    // begins a run of its own): over once RetroArch has settled.
    if ($games === 0 && !$live($ra) && time() - (int) ($run['started'] ?? 0) > 20) {
        $over = true;
    }
    if ($over && empty($run['ended']) && !xs_fast_lane()) {
        $run['ended'] = time();
        xs_setup_run_set(['ended' => $run['ended']]);
        xs_log('SETUP', 'setting up is over: RetroArch ' . $ra['state'] . ', cores ' . $cores['state']
            . ', pictures ' . ($fill['state'] ?? '?') . ', cheat lists ' . $cheats['state'] . ', videos ' . $videos['state']
            . ', runs check ' . $runs['state'] . ', ' . $games . ' game(s)');
        // With the games in: once, that they can have videos and cheats (includes\tips.php).
        require_once __DIR__ . '/tips.php';
        xs_tips_tell('setting up ended');
    }
    return [
        'started' => (int) ($run['started'] ?? 0), 'ended' => (int) ($run['ended'] ?? 0), 'over' => $over,
        'games' => $games, 'ready' => $games > 0 && $ra['state'] === 'done' && $cores['state'] === 'done',
        'retroarch' => $ra, 'cores' => $cores, 'fill' => $fill, 'cheats' => $cheats, 'videos' => $videos, 'runs' => $runs,
    ];
}

/** The videos the answer asked for, started now the names are in: what the list says of them. */
function xs_setup_run_videos(): array
{
    require_once __DIR__ . '/import.php';
    require_once __DIR__ . '/archivevid.php';
    $asked = xs_read_json(xs_data_path('setup.json'), []);
    $asked = is_array($asked) ? $asked : [];
    unset($asked['videosWanted']);              // owed once: a start that fails is said, not tried at every look
    xs_write_json(xs_data_path('setup.json'), $asked);
    $platforms = [];
    $cutter = xs_av_ffmpeg() !== [];            // a console playthroughs alone serve needs the cutter, as in the fetch's own window
    foreach (xs_av_need(xs_settings(), xs_library()) as $row) {
        if (($row['sets'] > 0 || ($row['wol'] && $cutter)) && $row['need'] > 0) {
            $platforms[] = $row['platform'];
        }
    }
    if (!$platforms) {
        xs_setup_run_set(['videos' => 'none']);
        xs_log('SETUP', 'videos were asked for, and no game lacks one on a console the online archives have videos for');
        return ['state' => 'done', 'note' => 'none'];
    }
    $why = null;
    if (!xs_av_start($platforms, $why)) {
        xs_setup_run_set(['videos' => (string) $why]);
        xs_log('SETUP', 'videos were asked for and could not be started: ' . $why);
        return ['state' => 'failed', 'error' => (string) $why];
    }
    xs_log('SETUP', 'videos start by themselves, now the names are in: ' . count($platforms) . ' consoles');
    return ['state' => 'running', 'phase' => 'starting'];
}

/**
 * The Get RetroArch job: checked and planned, and when $start also written
 * and handed to bin\setup.ps1. The caller has made sure no RetroArch is
 * here. Returns the plan, or null with $err saying why not.
 */
function xs_setup_retroarch_job(bool $start, ?string &$err = null): ?array
{
    $err  = null;
    $src  = xs_setup_source();
    $dest = xs_own_ra_dir();
    // The download and RetroArch unpacked beside it at the peak; no download when the package carries it.
    $need = (int) ($src['bytes'] * ($src['local'] !== '' ? 3.2 : 4.2));
    $free = (int) @disk_free_space(xs_data_dir());
    if ($free > 0 && $free < $need) {
        $err = 'there is not enough room on the drive: RetroArch needs about '
            . round($need / 1048576) . ' MB and there is ' . round($free / 1048576) . ' MB free';
        return null;
    }
    $plan = [
        'kind'    => 'retroarch',
        'state'   => 'running',
        'step'    => 'start',
        'started' => time(),
        'version' => $src['version'],
        'url'     => $src['url'],
        'local'   => $src['local'],          // the archive the package carries, unpacked in place of a download
        'sha256'  => $src['sha256'],
        'total'   => $src['bytes'],
        'bytes'   => 0,
        'part'    => xs_data_path('emulators' . DIRECTORY_SEPARATOR . 'RetroArch.download'),
        'stage'   => xs_data_path('emulators' . DIRECTORY_SEPARATOR . 'unpacking'),
        'dest'    => $dest,
        // 7zr unpacks first (bin\setup.ps1): it writes its progress into 'prog' for
        // the bar; tar is the fallback. '' when it is not there (tools\get-7zr.js).
        'sevenzip' => is_file(XS_ROOT . '\\bin\\7zr.exe') ? XS_ROOT . '\\bin\\7zr.exe' : '',
        'prog'     => xs_data_path('setup-unpack.txt'),
    ];
    if (!$start) {
        return $plan;
    }
    if (!is_dir(dirname($plan['part'])) && !@mkdir(dirname($plan['part']), 0777, true)) {
        $err = 'the folder ' . dirname($plan['part']) . ' could not be made';
        return null;
    }
    if (!xs_write_json(xs_setup_job_path(), $plan, $err)) {
        return null;
    }
    xs_log('SETUP', 'get RetroArch ' . $src['version'] . ' asked, into ' . $dest . ($src['local'] !== '' ? ', from the copy the package carries' : ''));
    if (!xs_setup_start()) {
        $err = 'the downloader could not be started';
        return null;
    }
    return $plan;
}

/**
 * xs_setup_chain_cores: fetch every missing core that is Xsegon's to fetch,
 * with no window. Only consoles with games, only into the busiest folder,
 * never one Xsegon only reads. Returns the running plan; null with $err = null means nothing to fetch.
 */
/** The job that fetches these cores into their RetroArch: each core once, all waiting. */
function xs_setup_cores_plan(array $rows): array
{
    $cores = [];
    foreach ($rows as $r) {
        $cores[$r['core']] = ['core' => $r['core'], 'platform' => $r['platform'], 'state' => 'waiting'];
    }
    return [
        'kind'    => 'cores',
        'state'   => 'running',
        'step'    => 'start',
        'started' => time(),
        'base'    => xs_setup_cores_base(),
        'dest'    => $rows[0]['dir'],
        'cores'   => array_values($cores),
    ];
}

function xs_setup_chain_cores(?string &$err = null): ?array
{
    $err = null;
    require_once __DIR__ . '/import.php';
    $table = xs_emulators(xs_norm_path((string) (xs_settings()['paths']['launchbox'] ?? '')));
    $rows  = array_values(array_filter(xs_setup_cores($table, xs_library()),
        static fn ($r) => $r['may'] && empty($r['popular']) && !xs_test_keep_out($r['dir'])));
    if (!$rows) {
        return null;
    }
    $dir  = strtolower($rows[0]['dir']);          // xs_setup_cores sorts busiest first
    $rows = array_values(array_filter($rows, static fn ($r) => strtolower($r['dir']) === $dir));
    $plan = xs_setup_cores_plan($rows);
    if (!xs_write_json(xs_setup_job_path(), $plan, $err)) {
        return null;
    }
    xs_log('SETUP', 'get cores by itself: ' . implode(', ', array_column($plan['cores'], 'core')) . ' into ' . $plan['dest']);
    if (!xs_setup_start()) {
        $err = 'the downloader could not be started';
        return null;
    }
    return $plan;
}

/**
 * Where a core file for this option would be: `load` is written relative to
 * the RetroArch folder ("cores\x_libretro.dll") or as a full path.
 */
function xs_setup_core_file(string $raExe, array $option): ?string
{
    $load = (string) ($option['load'] ?? '');
    if ($load === '') {
        return null;
    }
    if (preg_match('/^[A-Za-z]:[\\\\\/]|^\\\\\\\\/', $load)) {
        return $load;
    }
    return dirname($raExe) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $load);
}

/**
 * Every console with games whose RetroArch core file is missing.
 * One row per console, with where the core would go and whether Xsegon may
 * put it there (never into a folder it only reads).
 */
function xs_setup_cores(array $table, array $library): array
{
    $counts = [];
    foreach ($library['games'] ?? [] as $g) {
        $p = (string) ($g['platform'] ?? '');
        if ($p !== '') {
            $counts[strtolower($p)] = ['name' => $p, 'n' => ($counts[strtolower($p)]['n'] ?? 0) + 1];
        }
    }
    $noGames = !$counts;
    if ($noGames) {
        foreach (xs_setup_popular() as $p) {
            $counts[strtolower($p)] = ['name' => $p, 'n' => 0];
        }
    }
    $rows = [];
    foreach ($counts as $pk => $c) {
        $option = xs_emu_option($table, $c['name']);
        if ($option === null || empty($option['core'])) {
            continue;
        }
        $ra = xs_ra_beside((string) ($table['programs'][$option['program']]['exe'] ?? ''));
        if ($ra === null) {
            continue;
        }
        $file = xs_setup_core_file($ra, $option);
        if ($file === null || is_file($file)) {
            continue;
        }
        $rows[] = [
            'platform' => $c['name'],
            'games'    => $c['n'],
            'core'     => $option['core'],
            'file'     => $file,
            'dir'      => dirname($file),
            'retroarch'=> $ra,
            'may'      => !xs_in_launchbox($file),
            'popular'  => $noGames,
        ];
    }
    usort($rows, static fn ($a, $b) => $b['games'] <=> $a['games'] ?: strcmp($a['platform'], $b['platform']));
    return $rows;
}
