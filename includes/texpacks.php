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
 * A game may hold several packs, each in a folder of its own inside the game's (the
 * emulators read every folder under it); an N64 .hts or .htc pack is loaded alone.
 * The emulator's switch is turned on for the one game and put back as it was when
 * its last pack is uninstalled. What Xsegon put in place is kept in
 * data\texpacks.json, by game. The packs listed are includes\texpacks\list.json,
 * built by tools\build-texpacks.js.
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
 *   ['emu', 'emulator', 'exe', 'home', 'key', 'keyWords', 'base', 'into', 'file', 'cache',
 *    'switch' => ['kind' => 'ini'|'opt', 'file', ...], 'global', 'setWords']
 * 'file' is where an N64 .hts pack goes; 'cache' is the N64 core's own .htc, which it
 * makes from the packs at a start and reads in their place after.
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
            'base' => $tex, 'into' => $tex . '\\' . $serial . '\\replacements', 'file' => null, 'cache' => null, 'dir' => $tex . '\\' . $serial,
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
            'base' => $tex, 'into' => $tex . '\\' . $id, 'file' => null, 'cache' => null, 'dir' => $tex . '\\' . $id,
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
            'cache' => $sys . '\\cache\\' . $name . '_HIRESTEXTURES.htc', 'dir' => $sys . '\\hires_texture\\' . $name, 'switch' => $sw,
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
    return is_array($rec) && ($rec['emu'] ?? 'pcsx2') === $t['emu'] && strcasecmp((string) ($rec['key'] ?? $rec['serial'] ?? ''), $t['key']) === 0 ? xs_tp_rec_norm($rec) : null;
}

/**
 * A game's record as a list of packs: ['emu', 'key', 'setting', 'cache', 'packs' => [
 * ['id', 'from', 'path', 'k' (the listed pack's key, when got from the list), 'at',
 *  'kind' => 'folder'|'file'|'loose', 'when', 'files', 'bytes', 'for']]].
 * A record from when a game held one pack is read as that one, its files loose in the game's folder.
 */
function xs_tp_rec_norm(array $rec): array
{
    if (is_array($rec['packs'] ?? null)) {
        return $rec;
    }
    $at   = (string) ($rec['into'] ?? '');
    $key  = (string) ($rec['key'] ?? $rec['serial'] ?? '');
    $file = (bool) preg_match('/\.ht[sc]$/i', $at);
    $cache = null;
    if (($rec['emu'] ?? '') === 'mupen' && $at !== '') {
        $cache = ($file ? dirname($at) : dirname($at, 2) . '\\cache') . '\\' . $key . '_HIRESTEXTURES.htc';
    }
    return ['emu' => (string) ($rec['emu'] ?? 'pcsx2'), 'key' => $key, 'setting' => $rec['setting'] ?? null, 'cache' => $cache,
            'packs' => $at === '' ? [] : [['id' => xs_tp_pack_id($at, (int) ($rec['when'] ?? 0)), 'from' => (string) ($rec['from'] ?? ''),
                'path' => (string) ($rec['path'] ?? ''), 'at' => $at, 'kind' => $file ? 'file' : 'loose', 'when' => (int) ($rec['when'] ?? 0),
                'files' => (int) ($rec['files'] ?? 0), 'bytes' => (int) ($rec['bytes'] ?? 0), 'for' => $rec['for'] ?? null]]];
}

/** A pack's name in the tab and the api: where it is and when it came. */
function xs_tp_pack_id(string $at, int $when): string
{
    return substr(md5(strtolower($at) . '|' . $when), 0, 10);
}

/** A pack is there: its own folder or file, or for one from before, files loose in the game's folder. */
function xs_tp_pack_there(array $p, array $loose): bool
{
    return ($p['kind'] ?? '') === 'folder' ? is_dir((string) $p['at']) : (($p['kind'] ?? '') === 'file' ? is_file((string) $p['at']) : $loose !== []);
}

/** What lies in the game's folder outside the packs in folders of their own: a pack from before, or one put there by hand. */
function xs_tp_loose(array $t, ?array $rec): array
{
    $own = [];
    foreach ((array) ($rec['packs'] ?? []) as $p) {
        if (($p['kind'] ?? '') === 'folder') {
            $own[strtolower(basename((string) $p['at']))] = true;
        }
    }
    $out = [];
    foreach (is_dir($t['into']) ? (@scandir($t['into']) ?: []) : [] as $n) {
        if ($n[0] !== '.' && !isset($own[strtolower($n)])) {   // the N64 core skips a name starting with a dot
            $out[] = $t['into'] . '\\' . $n;
        }
    }
    return $out;
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

/**
 * The packs there now, in the order they came: Xsegon's counted once at the install,
 * by the record; then what was put there by hand, counted now, as one ('id' 'hand').
 * Each with 'paths', what goes when it is uninstalled.
 */
function xs_tp_packs(array $t, ?array $rec): array
{
    $loose = xs_tp_loose($t, $rec);
    $out = [];
    $owned = false;                                      // the loose files are a pack from before
    $files = [];
    foreach ((array) ($rec['packs'] ?? []) as $p) {
        if (!xs_tp_pack_there($p, $loose)) {
            continue;
        }
        $owned = $owned || $p['kind'] === 'loose';
        $files[] = strtolower((string) $p['at']);
        $out[] = ['id' => (string) $p['id'], 'from' => (string) $p['from'], 'files' => (int) $p['files'], 'bytes' => (int) $p['bytes'], 'whole' => true,
                  'when' => (int) $p['when'], 'mine' => true, 'file' => $p['kind'] === 'file', 'for' => $p['for'] ?? null,
                  'k' => (string) ($p['k'] ?? ''), 'path' => (string) ($p['path'] ?? ''), 'paths' => $p['kind'] === 'loose' ? $loose : [(string) $p['at']]];
    }
    $hand = $owned ? [] : $loose;
    if ($t['file'] !== null && is_file($t['file']) && !in_array(strtolower($t['file']), $files, true)) {
        $hand[] = $t['file'];
    }
    if ($hand) {
        $n = ['files' => 0, 'bytes' => 0, 'whole' => true];
        foreach ($hand as $h) {
            $c = is_dir($h) ? xs_tp_count($h, max(1, 100000 - $n['files'])) : ['files' => 1, 'bytes' => (int) @filesize($h), 'whole' => true];
            $n = ['files' => $n['files'] + $c['files'], 'bytes' => $n['bytes'] + $c['bytes'], 'whole' => $n['whole'] && $c['whole']];
        }
        $out[] = $n + ['id' => 'hand', 'from' => '', 'when' => 0, 'mine' => false, 'file' => $hand === [$t['file']], 'for' => null,
                       'k' => '', 'path' => '', 'paths' => $hand];
    }
    return $out;
}

/** The packs as the page has them: what goes on an uninstall, and where a pack came from, are the server's alone. */
function xs_tp_packs_said(array $packs): array
{
    return array_map(static fn (array $p): array => array_diff_key($p, ['paths' => true, 'path' => true, 'k' => true]), $packs);
}

/**
 * Which listed pack each pack there is, so the list's own row shows it installed:
 * by the listed pack's key it was got by, else by its download (the address, its file's
 * name, or that name unpacked into a folder). Rows get 'pack' (the id there, or
 * null), packs get 'listed' (the row's key, or null); the download addresses go.
 */
function xs_tp_match(array $found, array $packs): array
{
    $file = static fn (string $p): string => strtolower(basename(str_replace('\\', '/', $p)));
    foreach ($packs as $i => $p) {
        $packs[$i]['listed'] = null;
        foreach ($found as $j => $f) {
            if (isset($found[$j]['pack'])) {
                continue;
            }
            $url  = (string) ($f['url'] ?? '');
            $name = $url !== '' ? $file((string) parse_url($url, PHP_URL_PATH)) : '';
            $stem = (string) preg_replace('/\.(zip|7z)$/', '', $name);
            $mine = $file((string) $p['path']);
            if (($p['k'] !== '' && $p['k'] === $f['k'])
                || ($name !== '' && $mine !== '' && ($mine === $name || (strlen($stem) >= 8 && $mine === $stem)))) {
                $found[$j]['pack'] = $p['id'];
                $packs[$i]['listed'] = $f['k'];
                break;
            }
        }
    }
    foreach ($found as $j => $f) {
        $found[$j] = array_diff_key($f, ['url' => true]) + ['pack' => null];
    }
    return [$found, $packs];
}

/**
 * The N64 core reads every pack whole at the start after one comes or goes, and makes
 * its .htc of them: until it has, RetroArch's window does not answer. The bytes it
 * reads then, or 0 when its .htc is made already or there is nothing to read.
 */
function xs_tp_reads_first(?array $rec): int
{
    if ($rec === null || ($rec['emu'] ?? '') !== 'mupen' || (string) ($rec['cache'] ?? '') === '' || is_file((string) $rec['cache'])) {
        return 0;
    }
    $bytes = 0;
    foreach ((array) ($rec['packs'] ?? []) as $p) {
        $at = (string) ($p['at'] ?? '');
        if (($p['kind'] ?? '') !== 'file' && $at !== '' && is_dir($at)) {
            $bytes += (int) ($p['bytes'] ?? 0);
        }
    }
    return $bytes;
}

/** As xs_tp_reads_first(), by the game's id, for a start: one small file read, no folder walked. */
function xs_tp_reads_first_for(string $id): int
{
    $rec = xs_tp_records()[$id] ?? null;
    return is_array($rec) ? xs_tp_reads_first(xs_tp_rec_norm($rec)) : 0;
}

/** Can a pack sit beside the ones there? Not an N64 .hts or .htc: the core loads one of those alone. */
function xs_tp_beside_ok(array $t, array $packs, ?array $src): bool
{
    if ($t['emu'] !== 'mupen') {
        return true;
    }
    foreach ($packs as $p) {
        if (!empty($p['file'])) {
            return false;
        }
    }
    return ($src['kind'] ?? '') !== 'file';
}

/** What the tab shows: where a pack goes, the one there now, whether it loads, and the packs listed for the game. */
function xs_tp_state(array $game): array
{
    $why = null;
    $t = xs_tp_target($game, $why);
    $job = xs_tp_job();
    // Only what the tab's own bar needs, of the work at hand for this game.
    $mine = is_array($job) && ($job['id'] ?? '') === (string) $game['id'] && ($job['state'] ?? '') === 'running'
        ? ['action' => (string) ($job['action'] ?? ''), 'phase' => (string) ($job['phase'] ?? ''), 'bytes' => (int) ($job['bytes'] ?? 0),
           'total' => (int) ($job['total'] ?? 0), 'at' => (int) ($job['at'] ?? 0), 'files' => (int) ($job['files'] ?? 0),
           'name' => (string) (($job['source']['title'] ?? '') !== '' ? $job['source']['title'] : ($job['source']['name'] ?? ''))] : null;
    $found = xs_tp_found($game, $t['key'] ?? null);
    if ($t === null) {
        return ['ok' => true, 'can' => false, 'why' => $why, 'emulator' => null, 'job' => $mine, 'found' => xs_tp_match($found, [])[0]];
    }
    $own = xs_tp_switch_now($t['switch']);
    $rec = xs_tp_record_for($game, $t);
    [$found, $packs] = xs_tp_match($found, xs_tp_packs($t, $rec));
    $file = null;
    foreach ($packs as $p) {
        $file = $file ?? (!empty($p['file']) && !is_dir($t['into']) ? $p['paths'][0] : null);   // an N64 .hts or .htc, in the core's cache folder
    }
    return ['ok' => true, 'can' => true, 'why' => null, 'emulator' => $t['emulator'], 'key' => $t['key'], 'where' => $t['keyWords'],
            'folder' => $file ?? $t['into'], 'packs' => xs_tp_packs_said($packs), 'readsFirst' => xs_tp_reads_first($rec),
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
 * Start putting a pack in place for a game, or uninstalling one of its packs.
 * $want: 'from' (a file or folder chosen) or 'get' (a listed pack's own download),
 * with 'how' => 'beside' | 'replace' once the person has said; or 'remove' => a
 * pack's id ('' for the game's only one). With packs there and no 'how', $ask is
 * filled with them and whether one more can go beside them, and false comes back
 * with no $why.
 */
function xs_tp_start(array $game, array $want, ?string &$why = null, ?array &$ask = null): bool
{
    $why = null;
    $ask = null;
    if ((xs_tp_job()['state'] ?? '') === 'running') {
        $why = 'a texture pack is being installed or uninstalled already: that has to finish first';
        return false;
    }
    $t = xs_tp_target($game, $why);
    if ($t === null || !xs_tp_can_write($t, $why)) {
        return false;
    }
    $from  = isset($want['from']) ? (string) $want['from'] : null;
    $get   = isset($want['get']) ? (string) $want['get'] : null;
    $how   = in_array($want['how'] ?? null, ['beside', 'replace'], true) ? (string) $want['how'] : null;
    $rec   = xs_tp_record_for($game, $t);
    $packs = xs_tp_packs($t, $rec);
    $drop  = null;
    $src   = null;
    if ($get !== null) {
        $row = xs_tp_row($game, $get);
        $url = (string) ($row['get']['url'] ?? '');
        if ($row === null || !xs_tp_get_ok($url)) {
            $why = 'that pack has no download Xsegon can fetch: its page has it';
            return false;
        }
        $src = ['kind' => 'url', 'url' => $url, 'path' => $url, 'name' => (string) ($row['get']['name'] ?? basename((string) parse_url($url, PHP_URL_PATH))),
                'bytes' => (int) ($row['get']['bytes'] ?? 0), 'by' => xs_tp_by($row), 'title' => (string) ($row['name'] ?? ''), 'k' => $get];
    } elseif ($from !== null) {
        $src = xs_tp_source($from, $why);
        if ($src === null) {
            return false;
        }
        if (stripos(xs_abs_path($src['path']) . DIRECTORY_SEPARATOR, xs_abs_path($t['base']) . DIRECTORY_SEPARATOR) === 0) {
            $why = 'that is inside ' . $t['emulator'] . '\'s own texture folder already';
            return false;
        }
    } elseif (!$packs) {
        $why = 'there is no texture pack for this game to uninstall';
        return false;
    } else {
        $id = (string) ($want['remove'] ?? '');
        foreach ($packs as $p) {
            if ($p['id'] === $id || ($id === '' && count($packs) === 1)) {
                $drop = $p + ['last' => count($packs) === 1];
            }
        }
        if ($drop === null) {
            $why = $id === '' ? 'this game has ' . count($packs) . ' texture packs: which one is to be uninstalled is not said' : 'that texture pack is not installed for this game now';
            return false;
        }
    }
    if ($src !== null && $packs && $how === null) {
        $ask = ['packs' => xs_tp_packs_said($packs), 'beside' => xs_tp_beside_ok($t, $packs, $src)];
        return false;
    }
    if ($src !== null && $how === 'beside' && !xs_tp_beside_ok($t, $packs, $src)) {
        $why = 'the N64 core loads an .hts or .htc pack alone, so this one cannot go beside the one there: choose Replace';
        return false;
    }
    $job = ['state' => 'running', 'phase' => 'starting', 'started' => time(), 'action' => $src !== null ? 'install' : 'remove',
            'id' => (string) $game['id'], 'title' => (string) ($game['title'] ?? ''), 'target' => $t, 'source' => $src, 'record' => $rec,
            'how' => $src === null ? '' : ($packs ? (string) $how : 'new'), 'drop' => $drop, 'beside' => count($packs),
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
    xs_log('TPAK', ($src !== null ? 'asked to put ' . $src['name'] . ' (' . $src['kind'] . ') in place'
            : 'asked to uninstall ' . ($drop['from'] !== '' ? $drop['from'] : 'the pack put there by hand') . ($drop['last'] ? ', its last' : ', ' . (count($packs) - 1) . ' staying'))
        . ' for ' . $job['title'] . ' (' . $t['emulator'] . ', ' . $t['key'] . '): ' . $t['into']
        . ($packs && $src !== null ? ($how === 'beside' ? ', beside the ' . count($packs) . ' there' : ', replacing the ' . count($packs) . ' there') : ''));
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

/**
 * A title as one key, its words run together and II to XV read as numbers, so "Soulcalibur II"
 * meets "Soul Calibur 2" and "E.O.E" meets "EOE". X and I stay letters: Mega Man X is not Mega Man 10.
 */
function xs_tp_key(string $title): string
{
    $roman = ['ii' => '2', 'iii' => '3', 'iv' => '4', 'v' => '5', 'vi' => '6', 'vii' => '7', 'viii' => '8', 'ix' => '9',
              'xi' => '11', 'xii' => '12', 'xiii' => '13', 'xiv' => '14', 'xv' => '15'];
    return implode('', array_map(static fn (string $w): string => $roman[$w] ?? $w, explode(' ', xs_tp_words($title))));
}

/** The keys a listed title answers to: "Final Fantasy X + International" is Final Fantasy X and Final Fantasy X International. */
function xs_tp_list_keys(string $t): array
{
    $parts = array_map('trim', explode(' + ', $t));
    $keys = [xs_tp_key($t)];
    if (count($parts) > 1) {
        $keys[] = xs_tp_key($parts[0]);
        foreach (array_slice($parts, 1) as $p) {
            $keys[] = xs_tp_key($parts[0] . ' ' . $p);
        }
    }
    return array_values(array_unique(array_filter($keys, 'strlen')));
}

/** The keys a game is matched by: its title's, and its file name's, which keeps the words a title was shortened from ("Mario Kart Wii"). */
function xs_tp_names(array $game): array
{
    $file = pathinfo(str_replace('\\', '/', (string) ($game['launch']['rom'] ?? $game['romPath'] ?? '')), PATHINFO_FILENAME);
    return array_values(array_unique(array_filter([xs_tp_key((string) ($game['title'] ?? '')), xs_tp_key($file)], 'strlen')));
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

/** A listed pack's maker, '' while Xsegon's own short list has not found them yet (tools\texpacks-more.json's words for that). */
function xs_tp_by(array $r): string
{
    $by = (string) ($r['by'] ?? '');
    return $by === 'WIP finding author' ? '' : $by;
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
        if (!is_array($r) || !array_intersect(xs_tp_list_keys((string) ($r['t'] ?? '')), $names)) {
            continue;
        }
        $region = (string) ($r['r'] ?? '');
        $note = isset($said[$region]) ? 'made for ' . $said[$region] . ($mine === $region ? ', as yours is' : '') : '';
        // 'from' is '' for a row of the Texture Packs Archive, 'xsegon' for one of Xsegon's own short list; 'says' is that row's word on it.
        $out[] = ['k' => (string) $r['k'], 'name' => (string) ($r['name'] ?? ''), 'by' => xs_tp_by($r), 'kind' => (string) ($r['kind'] ?? ''),
                  'status' => (string) ($r['st'] ?? ''), 'note' => $note, 'same' => $mine !== '' && $mine === $region, 'size' => (int) ($r['bytes'] ?? 0),
                  'pay' => (string) ($r['pay'] ?? 'free'), 'where' => (string) ($r['where'] ?? ''), 'tip' => ($r['tip'] ?? '') !== '',
                  'get' => xs_tp_get_ok((string) ($r['get']['url'] ?? '')), 'url' => (string) ($r['get']['url'] ?? ''),
                  'from' => (string) ($r['from'] ?? ''), 'says' => (string) ($r['says'] ?? '')];
    }
    $rank = static fn (array $r): array => [$r['kind'] === 'hand' ? 0 : ($r['kind'] === 'ai' ? 2 : 1), $r['same'] ? 0 : 1, $r['status'] === 'Complete' ? 0 : 1];
    usort($out, static fn (array $a, array $b): int => $rank($a) <=> $rank($b));
    return $out;
}

/** One listed pack for this game, by its key, as the list has it (its addresses with it). */
function xs_tp_row(array $game, string $k): ?array
{
    foreach ((array) ((xs_tp_list()['consoles'] ?? [])[strtolower((string) ($game['platform'] ?? ''))] ?? []) as $r) {
        if (is_array($r) && ($r['k'] ?? '') === $k && array_intersect(xs_tp_list_keys((string) ($r['t'] ?? '')), xs_tp_names($game))) {
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

/** A listed address opened in the default browser by cmd's start, as fan projects open theirs:
 *  rundll32's FileProtocolHandler answers as if it opened, and with Brave as the browser nothing opens. */
function xs_tp_open_url(string $url): bool
{
    if (function_exists('xs_open')) {
        return xs_open($url);
    }
    $handle = popen('start "" "' . str_replace('"', '', $url) . '"', 'r');
    if ($handle === false) {
        return false;
    }
    pclose($handle);
    return true;
}
