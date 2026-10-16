<?php
/**
 * Xsegon - a game's texture pack: where its emulator loads one from, the one there
 * now, the packs listed for the game, and putting one in place from a .zip, a .7z,
 * a folder, or a pack's own download (the work is bin\texpacks.php's).
 *
 *   PS2       PCSX2          textures\<SERIAL>\replacements, gamesettings\<SERIAL>_<CRC>.ini
 *   GC, Wii   Dolphin        Load\Textures\<GAMEID>, GameSettings\<GAMEID>.ini
 *   N64       RetroArch's    system\Mupen64plus\hires_texture\<CARTRIDGE NAME> (or an
 *             Mupen64Plus-   .hts in its cache folder), config\Mupen64Plus-Next\<game>.opt
 *             Next core
 *
 * The emulator's switch is turned on for the one game and put back as it was on
 * Remove. What Xsegon put in place is kept in data\texpacks.json, by game. The packs
 * listed are includes\texpacks\list.json, built by tools\build-texpacks.js.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/emulators.php';
require_once __DIR__ . '/texpacks-files.php';

/** The consoles whose games have the tab, in the library's lower-case names, and the emulator each is for. */
const XS_TP_CONSOLES = ['sony playstation 2' => 'pcsx2', 'nintendo gamecube' => 'dolphin', 'nintendo wii' => 'dolphin', 'nintendo 64' => 'mupen'];

/** The only places a pack is fetched from by Xsegon itself: each pack's own download. */
const XS_TP_HOSTS = ['files.emulationking.com', 'evilgames.eu', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];

function xs_tp_job_path(): string
{
    return xs_data_path('texpacks-job.json');
}

function xs_tp_stop_path(): string
{
    return xs_data_path('texpacks-stop');
}

function xs_tp_record_path(): string
{
    return xs_data_path('texpacks.json');
}

function xs_tp_has_tab(array $game): bool
{
    return isset(XS_TP_CONSOLES[strtolower((string) ($game['platform'] ?? ''))]) && empty($game['launch']['local']) && empty($game['steam']);
}

/**
 * Where a pack for this game goes and what turns it on, or null with $why in words:
 *   ['emu', 'emulator', 'exe', 'home', 'key', 'keyWords', 'base', 'into', 'file',
 *    'switch' => ['kind' => 'ini'|'opt', 'file', ...], 'global', 'setWords']
 */
function xs_tp_target(array $game, ?string &$why = null): ?array
{
    $why = null;
    $emu = XS_TP_CONSOLES[strtolower((string) ($game['platform'] ?? ''))] ?? null;
    if ($emu === null) {
        $why = 'texture packs are for PlayStation 2, GameCube, Wii and N64 games for now';
        return null;
    }
    $launch = $game['launch'] ?? null;
    if (!is_array($launch) || !empty($launch['local']) || ($launch['exe'] ?? '') === '') {
        $why = 'no emulator is set to start this game';
        return null;
    }
    $s = xs_settings();
    $launch = xs_emu_repoint($launch, xs_emulators(xs_norm_path((string) ($s['paths']['launchbox'] ?? ''))), (string) ($game['platform'] ?? ''));
    $exe = (string) $launch['exe'];
    $rom = (string) ($launch['rom'] ?? '');
    // PCSX2 knows its game from its own list; the others read the game's file.
    if ($emu !== 'pcsx2' && !is_file($rom)) {
        require_once __DIR__ . '/drives.php';
        $stuck = xs_drive_stuck($rom);
        $why = $stuck !== null ? 'the drive ' . $stuck . ' is not answering, and the game\'s file is read to know where its pack goes'
             : 'the game\'s file is not on this PC now (' . $rom . '): is its drive plugged in?';
        return null;
    }
    if ($emu === 'pcsx2') {
        if (!preg_match('/^pcsx2[^\\\\\/]*\.exe$/i', basename($exe))) {
            $why = 'this game does not start on PCSX2 itself, and a pack goes where PCSX2 loads it. A game set to run on RetroArch\'s PCSX2 core gets texture packs later';
            return null;
        }
        return xs_tp_pcsx2($exe, $rom, $why);
    }
    if ($emu === 'dolphin') {
        if (!preg_match('/^dolphin[^\\\\\/]*\.exe$/i', basename($exe))) {
            $why = 'this game does not start on Dolphin itself, and a pack goes where Dolphin loads it';
            return null;
        }
        return xs_tp_dolphin($exe, $rom, $why);
    }
    return xs_tp_mupen($launch, $rom, $why);
}

function xs_tp_pcsx2(string $exe, string $rom, ?string &$why): ?array
{
    $home = xs_pcsx2_home($exe);
    if ($home === null) {
        $why = 'the folder PCSX2 keeps its settings in was not found, beside ' . $exe . ' or in Documents\\PCSX2';
        return null;
    }
    $ini  = xs_pcsx2_ini($home . '\\inis\\PCSX2.ini');
    $code = xs_pcsx2_code(xs_pcsx2_folder($ini, $home, 'Cache', 'cache') . '\\gamelist.cache', $rom);
    if ($code === null) {
        $why = 'PCSX2 has not listed this game yet, so its disc ID is not known. Open PCSX2 once with this game in its list and look here again';
        return null;
    }
    [$serial, $crc] = $code;
    // The serial names a folder: one that is not a plain name is not used as one.
    if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9_.-]{2,30}$/', $serial) || str_contains($serial, '..')) {
        $why = 'PCSX2 lists this game under an ID that cannot name a folder (' . mb_substr($serial, 0, 40) . ')';
        return null;
    }
    $tex = xs_pcsx2_folder($ini, $home, 'Textures', 'textures');
    return ['emu' => 'pcsx2', 'emulator' => 'PCSX2', 'exe' => $exe, 'home' => $home, 'key' => $serial,
            'keyWords' => 'its textures folder for ' . $serial . ', your disc\'s own ID',
            'base' => $tex, 'into' => $tex . '\\' . $serial . '\\replacements', 'file' => null, 'dir' => $tex . '\\' . $serial,
            'switch' => ['kind' => 'ini', 'file' => $home . '\\gamesettings\\' . $serial . '_' . $crc . '.ini',
                         'section' => 'EmuCore/GS', 'key' => 'LoadTextureReplacements', 'on' => 'true'],
            'global' => strtolower(trim((string) (($ini['EmuCore/GS']['LoadTextureReplacements'] ?? [])[0] ?? ''))) === 'true',
            'setWords' => 'PCSX2\'s Load Textures'];
}

/** Dolphin keeps its settings in User beside it when portable, else in the Windows user's own folders. */
function xs_tp_dolphin(string $exe, string $rom, ?string &$why): ?array
{
    $dir  = dirname($exe);
    $home = null;
    if (is_file($dir . '\\portable.txt')) {
        $home = $dir . '\\User';
    } else {
        foreach ([(string) getenv('APPDATA') . '\\Dolphin Emulator', (string) getenv('USERPROFILE') . '\\Documents\\Dolphin Emulator'] as $d) {
            if (is_dir($d . '\\Config')) {
                $home = $d;
                break;
            }
        }
    }
    if ($home === null || !is_dir($home)) {
        $why = 'the folder Dolphin keeps its settings in was not found, beside ' . $exe . ' or in your user folders';
        return null;
    }
    require_once __DIR__ . '/fanprojects.php';
    $ids = xs_fan_disc_ids($rom);
    $id  = $ids['ids'][0] ?? '';
    if (!preg_match('/^[A-Z0-9]{6}$/', $id)) {
        $why = 'the game\'s disc ID could not be read from its file (Xsegon reads .iso, .gcm, .ciso, .rvz, .wia and .wbfs)';
        return null;
    }
    $gfx = xs_pcsx2_ini($home . '\\Config\\GFX.ini');
    $tex = $home . '\\Load\\Textures';
    return ['emu' => 'dolphin', 'emulator' => 'Dolphin', 'exe' => $exe, 'home' => $home, 'key' => $id,
            'keyWords' => 'its Load\\Textures folder for ' . $id . ', your disc\'s own ID',
            'base' => $tex, 'into' => $tex . '\\' . $id, 'file' => null, 'dir' => $tex . '\\' . $id,
            'switch' => ['kind' => 'ini', 'file' => $home . '\\GameSettings\\' . $id . '.ini',
                         'section' => 'Video_Settings', 'key' => 'HiresTextures', 'on' => 'True'],
            'global' => strtolower(trim((string) (($gfx['Settings']['HiresTextures'] ?? [])[0] ?? ''))) === 'true',
            'setWords' => 'Dolphin\'s Load Custom Textures'];
}

/** RetroArch's Mupen64Plus-Next core: the pack under the cartridge's own name, the switch in the game's options file. */
function xs_tp_mupen(array $launch, string $rom, ?string &$why): ?array
{
    require_once __DIR__ . '/states.php';
    $exe = (string) $launch['exe'];
    $ra  = dirname($exe);
    $cfg = ra_config_path($exe);
    if (($launch['kind'] ?? '') !== 'retroarch' || $cfg === null) {
        $why = 'this game does not start on RetroArch, and N64 packs go where RetroArch\'s Mupen64Plus-Next core loads them';
        return null;
    }
    $keys = ra_cfg_keys($cfg, ['system_directory', 'rgui_config_directory', 'core_options_path', 'game_specific_options', 'global_core_options', 'libretro_info_path']);
    $core = ra_core_name($ra, (string) ($launch['args'] ?? ''), $keys);
    if ($core !== 'Mupen64Plus-Next') {
        $why = 'this game runs on RetroArch\'s ' . ($core ?? 'own') . ' core, which loads no texture packs. Mupen64Plus-Next does: choose it for the game to use one';
        return null;
    }
    $name = xs_tp_n64_name($rom, $why);
    if ($name === null) {
        return null;
    }
    $sys  = ra_resolve_dir($ra, (string) ($keys['system_directory'] ?? ''), 'system') . '\\Mupen64plus';
    $conf = ra_resolve_dir($ra, (string) ($keys['rgui_config_directory'] ?? ''), 'config') . '\\' . $core;
    // The core's options as RetroArch reads them now: its shared file, or the core's own when that is the setting.
    $from = trim((string) ($keys['core_options_path'] ?? '')) !== '' ? ra_resolve_dir($ra, (string) $keys['core_options_path'], '')
          : dirname($cfg) . '\\retroarch-core-options.cfg';
    if (strtolower((string) ($keys['global_core_options'] ?? 'true')) === 'false' && is_file($conf . '\\' . $core . '.opt')) {
        $from = $conf . '\\' . $core . '.opt';
    }
    $base = pathinfo(str_replace('\\', '/', $rom), PATHINFO_FILENAME);
    $sw   = ['kind' => 'opt', 'file' => $conf . '\\' . $base . '.opt', 'from' => $from, 'prefix' => 'mupen64plus-',
             'keys' => ['mupen64plus-txHiresEnable' => 'True'], 'hts' => ['mupen64plus-EnableEnhancedHighResStorage' => 'True'],
             'perGame' => strtolower((string) ($keys['game_specific_options'] ?? 'true')) === 'true'];
    return ['emu' => 'mupen', 'emulator' => 'RetroArch', 'exe' => $ra . '\\retroarch.exe', 'home' => $ra, 'key' => $name,
            'keyWords' => 'its hi-res texture folder for ' . $name . ', the name inside your cartridge',
            'base' => $sys, 'into' => $sys . '\\hires_texture\\' . $name, 'file' => $sys . '\\cache\\' . $name . '_HIRESTEXTURES.hts',
            'dir' => $sys . '\\hires_texture\\' . $name, 'switch' => $sw,
            'global' => strtolower(xs_tp_opt_keys($from, ['mupen64plus-txHiresEnable'])['mupen64plus-txHiresEnable'] ?? '') === 'true',
            'setWords' => 'the Mupen64Plus-Next core\'s hi-res textures'];
}

/** What Xsegon put in place for each game, by its id. */
function xs_tp_records(): array
{
    $r = xs_read_json(xs_tp_record_path(), []);
    return is_array($r) ? $r : [];
}

function xs_tp_record_set(string $id, ?array $rec): void
{
    $all = xs_tp_records();
    if ($rec === null) {
        unset($all[$id]);
    } else {
        $all[$id] = $rec;
    }
    xs_write_json(xs_tp_record_path(), $all);
}

/** The record for this game, only while it is for the place the pack goes now. */
function xs_tp_record_for(array $game, array $t): ?array
{
    $rec = xs_tp_records()[(string) $game['id']] ?? null;
    return is_array($rec) && ($rec['emu'] ?? 'pcsx2') === $t['emu'] && strcasecmp((string) ($rec['key'] ?? $rec['serial'] ?? ''), $t['key']) === 0 ? $rec : null;
}

/** The install or removal as its worker left it, or null; a worker that is gone is said. */
function xs_tp_job(): ?array
{
    $job = xs_read_json(xs_tp_job_path(), null);
    if (!is_array($job)) {
        return null;
    }
    $dead = xs_job_dead($job, xs_tp_job_path());
    if ($dead !== null) {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped before it finished: ' . $dead;
    }
    return $job;
}

/** The pack there now: its folder and an N64 core's .hts, counted (once at the install, by the record). */
function xs_tp_there(array $t, ?array $rec): ?array
{
    $dir  = is_dir($t['into']) && (@scandir($t['into']) ?: ['.', '..']) !== ['.', '..'];
    $file = $t['file'] !== null && is_file($t['file']);
    if (!$dir && !$file) {
        return null;
    }
    if ($rec !== null) {
        return ['files' => (int) ($rec['files'] ?? 0), 'bytes' => (int) ($rec['bytes'] ?? 0), 'whole' => true,
                'from' => (string) ($rec['from'] ?? ''), 'when' => (int) ($rec['when'] ?? 0), 'mine' => true];
    }
    $n = $dir ? xs_tp_count($t['into'], 100000) : ['files' => 0, 'bytes' => 0, 'whole' => true];
    if ($file) {
        $n['files']++;
        $n['bytes'] += (int) @filesize($t['file']);
    }
    return $n + ['from' => '', 'when' => 0, 'mine' => false];
}

/** What the tab shows: where a pack goes, the one there now, whether it loads, and the packs listed for the game. */
function xs_tp_state(array $game): array
{
    $why = null;
    $t = xs_tp_target($game, $why);
    $job = xs_tp_job();
    $mine = is_array($job) && ($job['id'] ?? '') === (string) $game['id'] && ($job['state'] ?? '') === 'running' ? $job : null;
    $found = xs_tp_found($game, $t['key'] ?? null);
    if ($t === null) {
        return ['ok' => true, 'can' => false, 'why' => $why, 'emulator' => null, 'job' => $mine, 'found' => $found];
    }
    $own = xs_tp_switch_now($t['switch']);
    return ['ok' => true, 'can' => true, 'why' => null, 'emulator' => $t['emulator'], 'key' => $t['key'], 'where' => $t['keyWords'],
            'folder' => $t['file'] !== null && is_file($t['file']) ? $t['file'] : $t['into'], 'installed' => xs_tp_there($t, xs_tp_record_for($game, $t)),
            'own' => $own, 'loads' => $own ?? $t['global'], 'setWords' => $t['setWords'], 'job' => $mine, 'found' => $found];
}

/** May Xsegon write this emulator's textures and its game's settings? As ra_cfg_can_set(). */
function xs_tp_can_write(array $t, ?string &$why = null): bool
{
    $why = null;
    require_once __DIR__ . '/setup.php';
    if (xs_in_launchbox($t['home']) || xs_in_launchbox($t['base'])) {
        $why = 'this ' . $t['emulator'] . ' is inside a folder Xsegon only reads (LaunchBox\'s)';
        return false;
    }
    $data = xs_abs_path(xs_data_dir()) . DIRECTORY_SEPARATOR;
    if (xs_test_copy() && (stripos(xs_abs_path($t['base']), $data) !== 0 || stripos(xs_abs_path($t['switch']['file']), $data) !== 0)) {
        $why = 'a test copy never writes a real ' . $t['emulator'] . '\'s folders';
        return false;
    }
    if (!is_dir($t['home']) || !is_writable($t['home'])) {
        $why = $t['emulator'] . '\'s folder ' . $t['home'] . ' cannot be written';
        return false;
    }
    if (xs_tp_open($t['exe'])) {
        $why = $t['emulator'] . ' is open, and it writes its settings again when it closes: close ' . $t['emulator'] . ' first';
        return false;
    }
    return true;
}

/** A pack's files as the person chose them, by kind; the worker measures them. Null with $why. */
function xs_tp_source(string $from, ?string &$why = null): ?array
{
    $why  = null;
    $from = xs_norm_path(trim($from));
    if (preg_match('/^[A-Za-z]:$/', $from) || preg_match('/^\\\\\\\\[^\\\\]+\\\\[^\\\\]+$/', $from)) {
        $why = 'that is a whole drive: choose the pack\'s own folder';
        return null;
    }
    if (!preg_match('/^([A-Za-z]:\\\\|\\\\\\\\)/', $from)) {
        $why = 'that is not a file or folder on this PC';
        return null;
    }
    require_once __DIR__ . '/drives.php';
    if (($stuck = xs_drive_stuck($from)) !== null) {
        $why = 'the drive ' . $stuck . ' is not answering';
        return null;
    }
    if (is_dir($from)) {
        return ['kind' => 'folder', 'path' => $from, 'name' => basename($from)];
    }
    if (!is_file($from)) {
        $why = 'that file is not there any more';
        return null;
    }
    $end = strtolower(pathinfo($from, PATHINFO_EXTENSION));
    if ($end === 'rar') {
        $why = 'Xsegon cannot open a .rar. Unpack it with 7-Zip or WinRAR, then choose the folder it made with Install from a folder';
        return null;
    }
    if (in_array($end, ['hts', 'htc'], true)) {
        return ['kind' => 'file', 'path' => $from, 'name' => basename($from)];
    }
    if ($end !== 'zip' && $end !== '7z') {
        $why = 'a texture pack comes as a .zip or a .7z, or as a folder you unpacked';
        return null;
    }
    return ['kind' => $end, 'path' => $from, 'name' => basename($from)];
}

/**
 * Start putting a pack in place for a game (from a file or folder chosen, or one
 * of its listed packs' own download), or taking the one there away (both null).
 * A pack already there is only replaced when $replace says so; until then $ask is
 * filled with what is there and false comes back with no $why.
 */
function xs_tp_start(array $game, ?string $from, ?string $get, bool $replace, ?string &$why = null, ?array &$ask = null): bool
{
    $why = null;
    $ask = null;
    if ((xs_tp_job()['state'] ?? '') === 'running') {
        $why = 'a texture pack is being put in place or taken away already: that has to finish first';
        return false;
    }
    $t = xs_tp_target($game, $why);
    if ($t === null || !xs_tp_can_write($t, $why)) {
        return false;
    }
    $rec   = xs_tp_record_for($game, $t);
    $there = xs_tp_there($t, $rec) !== null;
    $src   = null;
    if ($get !== null) {
        $row = xs_tp_row($game, $get);
        $url = (string) ($row['get']['url'] ?? '');
        if ($row === null || !xs_tp_get_ok($url)) {
            $why = 'that pack has no download Xsegon can fetch: its page has it';
            return false;
        }
        $src = ['kind' => 'url', 'url' => $url, 'path' => $url, 'name' => (string) ($row['get']['name'] ?? basename((string) parse_url($url, PHP_URL_PATH))),
                'bytes' => (int) ($row['get']['bytes'] ?? 0), 'by' => (string) ($row['by'] ?? ''), 'title' => (string) ($row['name'] ?? '')];
    } elseif ($from !== null) {
        $src = xs_tp_source($from, $why);
        if ($src === null) {
            return false;
        }
        if (stripos(xs_abs_path($src['path']) . DIRECTORY_SEPARATOR, xs_abs_path($t['base']) . DIRECTORY_SEPARATOR) === 0) {
            $why = 'that is inside ' . $t['emulator'] . '\'s own texture folder already';
            return false;
        }
    } elseif (!$there) {
        $why = 'there is no texture pack for this game to take away';
        return false;
    }
    if ($src !== null && $there && !$replace) {
        $ask = xs_tp_there($t, $rec);
        return false;
    }
    $job = ['state' => 'running', 'phase' => 'starting', 'started' => time(), 'action' => $src !== null ? 'install' : 'remove',
            'id' => (string) $game['id'], 'title' => (string) ($game['title'] ?? ''), 'target' => $t, 'source' => $src, 'record' => $rec,
            'bytes' => 0, 'total' => 0, 'at' => 0, 'files' => 0, 'said' => ''];
    @unlink(xs_tp_stop_path());
    if (!xs_write_json(xs_tp_job_path(), $job, $why)) {
        return false;
    }
    if (!xs_spawn_worker('texpacks.php')) {
        $why = 'it could not be started';
        xs_write_json(xs_tp_job_path(), ['state' => 'failed', 'error' => $why] + $job);
        return false;
    }
    xs_log('TPAK', ($src !== null ? 'asked to put ' . $src['name'] . ' (' . $src['kind'] . ') in place' : 'asked to take the pack away')
        . ' for ' . $job['title'] . ' (' . $t['emulator'] . ', ' . $t['key'] . '): ' . $t['into'] . ($there && $src !== null ? ', replacing the one there' : ''));
    return true;
}

/* ---- the packs listed for a game ------------------------------------------------ */

/** The list shipped with Xsegon. A test copy may hold a stand-in of its own. */
function xs_tp_list(): array
{
    $test = xs_data_path('texpacks-list.json');
    $file = xs_test_copy() && is_file($test) ? $test : __DIR__ . DIRECTORY_SEPARATOR . 'texpacks' . DIRECTORY_SEPARATOR . 'list.json';
    $list = xs_read_json($file, []);
    return is_array($list) ? $list : [];
}

/** A title as words, so "Ratchet & Clank: Going Commando" meets "Ratchet & Clank - Going Commando". */
function xs_tp_words(string $title): string
{
    $t = (string) preg_replace('/\([^)]*\)|\[[^\]]*\]/', ' ', $title);
    $t = (string) (function_exists('iconv') ? (@iconv('UTF-8', 'ASCII//TRANSLIT', $t) ?: $t) : $t);
    $t = str_replace('&', ' and ', strtolower($t));
    $t = (string) preg_replace('/[^a-z0-9]+/', ' ', $t);
    return trim((string) preg_replace('/\s+/', ' ', (string) preg_replace('/\bthe\b/', ' ', $t)));
}

/** The names a game is matched by: its title, and its file's name, which keeps the words a title was shortened from ("Mario Kart Wii"). */
function xs_tp_names(array $game): array
{
    $file = pathinfo(str_replace('\\', '/', (string) ($game['launch']['rom'] ?? $game['romPath'] ?? '')), PATHINFO_FILENAME);
    return array_values(array_unique(array_filter([xs_tp_words((string) ($game['title'] ?? '')), xs_tp_words($file)], 'strlen')));
}

/** The release a game is, NTSC-U, PAL or NTSC-J, from its disc ID or its file's name; '' when not known. */
function xs_tp_region(array $game, ?string $key): string
{
    if ($key !== null && preg_match('/^S[CL]([UEP])[A-Z]-/', $key, $m)) {
        return ['U' => 'NTSC-U', 'E' => 'PAL', 'P' => 'NTSC-J'][$m[1]];
    }
    if ($key !== null && preg_match('/^[A-Z0-9]{3}([EPJDFSIU])[A-Z0-9]{2}$/', $key, $m)) {
        return $m[1] === 'E' ? 'NTSC-U' : ($m[1] === 'J' ? 'NTSC-J' : 'PAL');
    }
    $file = basename((string) ($game['launch']['rom'] ?? $game['romPath'] ?? ''));
    if (preg_match('/\((USA|U)\b/i', $file)) {
        return 'NTSC-U';
    }
    if (preg_match('/\((Japan|J)\b/i', $file)) {
        return 'NTSC-J';
    }
    return preg_match('/\((Europe|UK|Germany|France|Spain|Italy|Australia|E)\b/i', $file) ? 'PAL' : '';
}

/**
 * The packs listed for this game, handmade first, then the ones made for its own
 * release, then the finished ones; each with what to say about its release.
 */
function xs_tp_found(array $game, ?string $key): array
{
    $rows = (array) ((xs_tp_list()['consoles'] ?? [])[strtolower((string) ($game['platform'] ?? ''))] ?? []);
    $names = xs_tp_names($game);
    if (!$names || !$rows) {
        return [];
    }
    $mine = xs_tp_region($game, $key);
    $said = ['NTSC-U' => 'the USA release', 'PAL' => 'the European release (PAL)', 'NTSC-J' => 'the Japanese release'];
    $out = [];
    foreach ($rows as $r) {
        if (!is_array($r) || !in_array(xs_tp_words((string) ($r['t'] ?? '')), $names, true)) {
            continue;
        }
        $region = (string) ($r['r'] ?? '');
        $note = isset($said[$region]) ? 'made for ' . $said[$region] . ($mine === $region ? ', as yours is' : '') : '';
        $out[] = ['k' => (string) $r['k'], 'name' => (string) ($r['name'] ?? ''), 'by' => (string) ($r['by'] ?? ''), 'kind' => (string) ($r['kind'] ?? ''),
                  'status' => (string) ($r['st'] ?? ''), 'note' => $note, 'same' => $mine !== '' && $mine === $region, 'size' => (int) ($r['bytes'] ?? 0),
                  'pay' => (string) ($r['pay'] ?? 'free'), 'where' => (string) ($r['where'] ?? ''), 'tip' => ($r['tip'] ?? '') !== '',
                  'get' => xs_tp_get_ok((string) ($r['get']['url'] ?? ''))];
    }
    $rank = static fn (array $r): array => [$r['kind'] === 'hand' ? 0 : ($r['kind'] === 'ai' ? 2 : 1), $r['same'] ? 0 : 1, $r['status'] === 'Complete' ? 0 : 1];
    usort($out, static fn (array $a, array $b): int => $rank($a) <=> $rank($b));
    return $out;
}

/** One listed pack for this game, by its key, as the list has it (its addresses with it). */
function xs_tp_row(array $game, string $k): ?array
{
    foreach ((array) ((xs_tp_list()['consoles'] ?? [])[strtolower((string) ($game['platform'] ?? ''))] ?? []) as $r) {
        if (is_array($r) && ($r['k'] ?? '') === $k && in_array(xs_tp_words((string) ($r['t'] ?? '')), xs_tp_names($game), true)) {
            return $r;
        }
    }
    return null;
}

/** A download Xsegon may fetch itself: https from a pack's own host. A test copy may fetch from this PC. */
function xs_tp_get_ok(string $url): bool
{
    if (xs_test_copy() && preg_match('#^http://127\.0\.0\.1:\d+/[A-Za-z0-9._~/%-]+$#', $url)) {
        return true;
    }
    $host = strtolower((string) parse_url($url, PHP_URL_HOST));
    return strlen($url) <= 400 && preg_match('#^https://[A-Za-z0-9.-]+/[A-Za-z0-9._~/%+()-]+$#', $url) === 1 && in_array($host, XS_TP_HOSTS, true);
}

/** An address of a listed pack's that may be opened in the browser: https, no space, quote or control character. */
function xs_tp_url_ok(string $url): bool
{
    return strlen($url) <= 400 && (bool) preg_match('@^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._~/:?=#%+,;!$\'()*\@&-]*)?$@', $url);
}

/** A listed address opened in the default browser, handed to Windows with no command line between. */
function xs_tp_open_url(string $url): bool
{
    $p = @proc_open(['rundll32.exe', 'url.dll,FileProtocolHandler', $url], [0 => ['file', 'NUL', 'r'], 1 => ['file', 'NUL', 'w'], 2 => ['file', 'NUL', 'w']],
        $pipes, null, null, ['bypass_shell' => true]);
    if (!is_resource($p)) {
        return false;
    }
    proc_close($p);
    return true;
}
