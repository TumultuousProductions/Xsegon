<?php
/**
 * Xsegon - reading RetroArch's own config.
 *
 * READ ONLY, so the UI can tell you WHY a feature is unavailable instead of
 * offering a button that quietly does nothing:
 *
 *     network_cmd_enable  = "false"   -> no `retroarch --command QUIT`
 *     savestate_auto_save = "false"   -> nothing to resume from
 *     savestate_auto_load = "false"   -> nothing resumed on start
 *
 * Turning them on is a change to YOUR RetroArch, so Xsegon reports and
 * recommends rather than editing. One thing is written (ra_cfg_repair): a line
 * that stops RetroArch working through no choice of yours, in a RetroArch of
 * your own, with the file as it was kept first.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';

/** Find retroarch.cfg beside the emulator we were told to launch. */
function ra_config_path(string $exe): ?string
{
    if ($exe === '') {
        return null;
    }
    $dir = dirname($exe);
    $cfg = $dir . DIRECTORY_SEPARATOR . 'retroarch.cfg';
    return is_file($cfg) ? $cfg : null;
}

/** The handful of keys worth knowing about, by line regex rather than a full config reader. */
function ra_flags(?string $cfgPath): array
{
    $keys = ['network_cmd_enable', 'network_cmd_port', 'savestate_auto_save',
             'savestate_auto_load', 'savestate_auto_index', 'quit_press_twice',
             'pause_nonactive', 'video_fullscreen', 'config_save_on_exit',
             // where the save states live and what loads one (includes\states.php)
             'savestate_directory', 'savestates_in_content_dir', 'sort_savestates_enable',
             'sort_savestates_by_content_enable', 'savestate_thumbnail_enable',
             'libretro_info_path', 'input_load_state',
             // and the in-game saves, for the Saves tab of details (includes\saves.php)
             'savefile_directory', 'savefiles_in_content_dir', 'sort_savefiles_enable',
             'sort_savefiles_by_content_enable',
             // where the BIOS files live (includes\bios.php)
             'system_directory',
             // where RetroArch's own cheat database is (includes\cheats.php)
             'cheat_database_path',
             // where its remaps are, copied in beside yours (includes\padmap.php)
             'input_remapping_directory'];

    $out = ['found' => false, 'path' => $cfgPath];
    foreach ($keys as $k) {
        $out[$k] = null;
    }
    if ($cfgPath === null || !is_file($cfgPath)) {
        return $out;
    }

    $raw = file_get_contents($cfgPath);
    if ($raw === false) {
        return $out;
    }
    $out['found'] = true;

    foreach ($keys as $k) {
        if (preg_match('/^' . preg_quote($k, '/') . '\s*=\s*"?([^"\r\n]*)"?/m', $raw, $m)) {
            $v = trim($m[1]);
            $out[$k] = ($v === 'true') ? true : (($v === 'false') ? false : $v);
        }
    }
    return $out;
}

/** The RetroArch executable behind the wrapper LaunchBox points at. */
function ra_exe_from_library(array $library): ?string
{
    foreach ($library['games'] ?? [] as $g) {
        if (!empty($g['launch']['exe']) && ($g['launch']['kind'] ?? '') === 'retroarch') {
            $dir = dirname($g['launch']['exe']);
            $exe = $dir . DIRECTORY_SEPARATOR . 'retroarch.exe';
            return is_file($exe) ? $exe : null;
        }
    }
    return null;
}

/** Where RetroArch writes its own log, for a start that follows a failed one. */
function ra_retry_log_path(): string
{
    return xs_data_path('log' . DIRECTORY_SEPARATOR . 'retroarch-last.log');
}

/**
 * The options that make RetroArch write its own log, for a game whose last
 * start ended at once (the launcher's note of it is data\last-error.json):
 * "exited with code 1" says that it failed and never why, and RetroArch
 * knows why. '' for every other start, which is left exactly as it was.
 */
function ra_retry_log_args(string $id): string
{
    $err = xs_read_json(xs_data_path('last-error.json'), null);
    if (!is_array($err) || $id === '' || ($err['gameId'] ?? '') !== $id
        || preg_match('/exited with code -?\d+ after \d{1,2}s/', (string) ($err['error'] ?? '')) !== 1) {
        return '';
    }
    return '--verbose --log-file="' . ra_retry_log_path() . '"';
}

/**
 * The file endings a core says it reads, from its info file in RetroArch's
 * info folder: [] when there is no info file. A core that lists an archive's
 * ending opens the archive itself, and RetroArch unpacks nothing for it.
 */
function ra_core_endings(string $exe, string $args, array $flags): array
{
    if (!preg_match('/-L\s+"([^"]+)"|-L\s+(\S+)/', $args, $m)) {
        return [];
    }
    $core = pathinfo(str_replace('/', DIRECTORY_SEPARATOR, $m[1] !== '' ? $m[1] : $m[2]), PATHINFO_FILENAME);
    $dir  = trim((string) ($flags['libretro_info_path'] ?? ''));
    if ($dir === '' || $dir === 'default') {
        $dir = dirname($exe) . DIRECTORY_SEPARATOR . 'info';
    } elseif ($dir[0] === ':') {
        $dir = dirname($exe) . xs_norm_path(substr($dir, 1));
    }
    $raw = @file_get_contents(xs_norm_path($dir) . DIRECTORY_SEPARATOR . $core . '.info');
    if ($raw === false || !preg_match('/^supported_extensions\s*=\s*"([^"\r\n]*)"/m', $raw, $x)) {
        return [];
    }
    return array_values(array_filter(array_map('strtolower', explode('|', $x[1])), 'strlen'));
}

/**
 * RetroArch unpacks an archive into its temp folder (cache_directory) for a
 * core that wants a plain file, and the start ends at once where that folder
 * is not found. One written "~\..." is found only where HOME is set, which
 * Windows does not do. Answers the folder to name for the run, ['set' => as
 * written, 'use' => a folder that is there], or null where RetroArch finds
 * its own or has none set (it then unpacks beside the game). $home stands in
 * for the HOME variable, for the tests.
 */
function ra_temp_dir_fix(?string $cfg, string $exe, ?string $home = null): ?array
{
    $set = trim(ra_cfg_keys($cfg, ['cache_directory'])['cache_directory'] ?? '');
    if ($set === '' || $set === 'default') {
        return null;
    }
    $home ??= (string) getenv('HOME');
    $rest   = ltrim(substr($set, 1), '\\/');
    if ($set[0] === '~') {
        $asRead = $home !== '' ? xs_norm_path($home) . DIRECTORY_SEPARATOR . $rest : '';
    } elseif ($set[0] === ':') {
        $asRead = dirname($exe) . DIRECTORY_SEPARATOR . $rest;
    } else {
        $asRead = $set;
    }
    if ($asRead !== '' && is_dir($asRead)) {
        return null;
    }
    // What "~" meant when RetroArch wrote it, else Windows' own temp folder.
    $profile = (string) getenv('USERPROFILE');
    $meant   = ($set[0] === '~' && $profile !== '') ? xs_norm_path($profile) . DIRECTORY_SEPARATOR . $rest : '';
    foreach ([$meant, sys_get_temp_dir()] as $dir) {
        if ($dir !== '' && is_dir($dir)) {
            return ['set' => $set, 'use' => xs_norm_path($dir)];
        }
    }
    return null;
}

/* ---- two lines of RetroArch's settings, put right ---------------------------
 * Windows sets blocks of ports aside at each restart, and RetroArch's command
 * port can land in one: RetroArch is then refused it and answers nothing. A
 * temp folder written "~\..." is one RetroArch cannot find on Windows. In a
 * RetroArch of your own that is not open, Xsegon puts the line right and keeps
 * the file as it was; anywhere else the launch gives the value for one run.
 * No port is written down here: the one used is found on the PC each time.
 */

/** The blocks of UDP ports Windows has set aside right now: [[first, last], ...]. */
function ra_ports_aside(): array
{
    $said = (string) @shell_exec('netsh int ipv4 show excludedportrange protocol=udp 2>NUL');
    preg_match_all('/^\s*(\d+)\s+(\d+)/m', $said, $m, PREG_SET_ORDER);
    return array_map(static fn(array $r): array => [(int) $r[1], (int) $r[2]], $m);
}

/** The range Windows picks those blocks from, as it says itself: [first, last]. */
function ra_ports_dynamic(): array
{
    $said = (string) @shell_exec('netsh int ipv4 show dynamicport udp 2>NUL');
    if (preg_match_all('/:\s*(\d+)\s*$/m', $said, $m) >= 2 && (int) $m[1][0] > 0 && (int) $m[1][1] > 0) {
        return [(int) $m[1][0], (int) $m[1][0] + (int) $m[1][1] - 1];
    }
    return [49152, 65535];      // Windows' own, where it would not say
}

/**
 * Can RetroArch open this UDP port? 'open', 'aside' (in a block Windows has
 * set aside: no program gets it), or 'held' (refused for another reason).
 * Asked by opening it for a moment, on this PC only. $aside stands in for
 * Windows' list, for the tests.
 */
function ra_port_state(int $port, ?array $aside = null): string
{
    $in = static function (array $blocks) use ($port): bool {
        foreach ($blocks as $b) {
            if ($port >= (int) ($b[0] ?? 0) && $port <= (int) ($b[1] ?? -1)) {
                return true;
            }
        }
        return false;
    };
    if ($port < 1 || $port > 65535) {
        return 'held';
    }
    if ($aside !== null && $in($aside)) {
        return 'aside';
    }
    $errno = 0;
    $errstr = '';
    $s = @stream_socket_server('udp://127.0.0.1:' . $port, $errno, $errstr, STREAM_SERVER_BIND);
    if ($s !== false) {
        fclose($s);
        return 'open';
    }
    return $in($aside ?? ra_ports_aside()) ? 'aside' : 'held';
}

/**
 * A port RetroArch can open and Windows cannot set aside later: outside the
 * range it picks from, as near the one RetroArch had as ten thousand lower,
 * and the first from there that opens. Null when none of 200 does.
 */
function ra_free_port(int $like, ?array $aside = null): ?int
{
    [$lo, $hi] = ra_ports_dynamic();
    $outside   = static fn(int $p): bool => $p > 1024 && $p <= 65535 && ($p < $lo || $p > $hi);
    for ($from = $like; $from > 1024 && !$outside($from); $from -= 10000) {
        // down past the range, ten thousand at a time
    }
    if (!$outside($from)) {
        $from = $hi + 1;
    }
    for ($p = $from, $n = 0; $n < 200; $p++, $n++) {
        if ($outside($p) && ra_port_state($p, $aside) === 'open') {
            return $p;
        }
    }
    return null;
}

/**
 * May Xsegon write this retroarch.cfg? Not one inside an imported library's folder
 * (read only to Xsegon), not while a RetroArch is open (it writes the whole
 * file again on its way out), and never a real one from a test copy.
 */
function ra_cfg_can_set(?string $cfg, ?string &$why = null): bool
{
    $why = null;
    if ($cfg === null || !is_file($cfg)) {
        $why = 'RetroArch has no settings file there';
        return false;
    }
    require_once __DIR__ . '/setup.php';
    if (xs_in_launchbox($cfg)) {
        $why = 'this RetroArch is inside a folder Xsegon only reads';
        return false;
    }
    if (xs_test_copy() && stripos(xs_abs_path($cfg), xs_abs_path(xs_data_dir()) . DIRECTORY_SEPARATOR) !== 0) {
        $why = 'a test copy never writes a real RetroArch\'s settings';
        return false;
    }
    if (!is_writable($cfg)) {
        $why = 'its settings file cannot be written';
        return false;
    }
    if (ra_open_from(dirname($cfg))) {
        $why = 'a RetroArch is open, and it writes its settings again when it closes';
        return false;
    }
    return true;
}

/**
 * Is a RetroArch from this folder open? One from another folder writes its
 * own settings, not these. Windows is asked for the paths only when some
 * RetroArch is open at all, and one that will not say where it is from is
 * taken as this one.
 */
function ra_open_from(string $dir): bool
{
    if (!ra_is_running()) {
        return false;
    }
    $said  = (string) @shell_exec('powershell -NoProfile -NonInteractive -Command "(Get-Process retroarch -ErrorAction SilentlyContinue).Path" 2>NUL');
    $paths = array_values(array_filter(array_map('trim', preg_split('/\R/', $said) ?: []), 'strlen'));
    if (!$paths) {
        return true;
    }
    foreach ($paths as $p) {
        if (strcasecmp(xs_norm_path(dirname($p)), xs_norm_path($dir)) === 0) {
            return true;
        }
    }
    return false;
}

/**
 * Lines of a retroarch.cfg set to key = "value", every other byte as it was
 * (a key that is not there is added at the end). The file as it was is kept
 * in data\retroarch-cfg-kept first, and nothing is written without that copy.
 * Answers where the copy is, or null with $why.
 */
function ra_cfg_set(?string $cfg, array $lines, ?string &$why = null): ?string
{
    if (!ra_cfg_can_set($cfg, $why)) {
        return null;
    }
    $raw = file_get_contents($cfg);
    if ($raw === false || $raw === '') {
        $why = 'its settings file would not read';
        return null;
    }
    $eol = str_contains($raw, "\r\n") ? "\r\n" : "\n";
    $now = $raw;
    foreach ($lines as $key => $value) {
        $key   = (string) $key;
        $value = (string) $value;
        if (preg_match('/^[a-z0-9_]+$/', $key) !== 1 || preg_match('/["\r\n]/', $value) === 1) {
            $why = 'that is not a line RetroArch would read';
            return null;
        }
        $line  = $key . ' = "' . $value . '"';
        $count = 0;
        $now   = (string) preg_replace_callback('/^[ \t]*' . $key . '[ \t]*=[^\r\n]*/m', static fn(): string => $line, $now, 1, $count);
        if ($count === 0) {
            $now = rtrim($now, "\r\n") . $eol . $line . $eol;
        }
    }
    $dir = xs_data_path('retroarch-cfg-kept');
    if (!is_dir($dir) && !@mkdir($dir, 0777, true)) {
        $why = 'there is no place to keep the file as it was';
        return null;
    }
    $kept = $dir . DIRECTORY_SEPARATOR . 'retroarch.' . date('Ymd-His') . '.cfg';
    if (!@copy($cfg, $kept)) {
        $why = 'the file as it was could not be kept';
        return null;
    }
    $tmp = $cfg . '.xsegon-new';
    if (@file_put_contents($tmp, $now) !== strlen($now) || !@rename($tmp, $cfg)) {
        @unlink($tmp);
        $why = 'its settings file could not be written';
        return null;
    }
    return $kept;
}

/**
 * What stops this RetroArch working here, and what puts each right:
 * [['key', 'was', 'now', 'why'], ...], empty when nothing does. Reads only.
 * $aside and $home stand in for Windows' list and the HOME variable, for the tests.
 */
function ra_cfg_faults(string $exe, ?array $aside = null, ?string $home = null): array
{
    $cfg  = ra_config_path($exe);
    $keys = ra_cfg_keys($cfg, ['network_cmd_enable', 'network_cmd_port']);
    $out  = [];
    if (($keys['network_cmd_enable'] ?? '') === 'true') {
        $port = (int) (($keys['network_cmd_port'] ?? '') !== '' ? $keys['network_cmd_port'] : 55355);   // RetroArch's own, where the line is not there
        if (ra_port_state($port, $aside) === 'aside' && ($free = ra_free_port($port, $aside)) !== null) {
            $out[] = ['key' => 'network_cmd_port', 'was' => (string) $port, 'now' => (string) $free,
                      'why' => 'Windows has port ' . $port . ' set aside, so RetroArch cannot open it'];
        }
    }
    $temp = ra_temp_dir_fix($cfg, $exe, $home);
    if ($temp !== null) {
        $out[] = ['key' => 'cache_directory', 'was' => $temp['set'], 'now' => $temp['use'],
                  'why' => 'RetroArch cannot find its temp folder as that line names it'];
    }
    return $out;
}

/**
 * Puts those lines right. 'how' says where: 'settings' (written into
 * retroarch.cfg, 'kept' the file as it was) or 'run' (the file may not be
 * written, 'why' says so, and a launch gives the values for one run).
 * $look only says what would be done.
 */
function ra_cfg_repair(string $exe, bool $look = false, ?array $aside = null, ?string $home = null): array
{
    $out = ['faults' => ra_cfg_faults($exe, $aside, $home), 'how' => null, 'kept' => null, 'why' => null];
    if (!$out['faults']) {
        return $out;
    }
    $cfg = ra_config_path($exe);
    $why = null;
    if ($look) {
        $out['how'] = ra_cfg_can_set($cfg, $why) ? 'settings' : 'run';
    } else {
        $out['kept'] = ra_cfg_set($cfg, array_column($out['faults'], 'now', 'key'), $why);
        $out['how']  = $out['kept'] !== null ? 'settings' : 'run';
        foreach ($out['faults'] as $f) {
            xs_log('RA', $out['kept'] !== null
                ? 'retroarch.cfg: ' . $f['key'] . ' was "' . $f['was'] . '" and is now "' . $f['now'] . '" (' . $f['why']
                  . '); the file as it was is kept as ' . $out['kept']
                : 'retroarch.cfg: ' . $f['key'] . ' "' . $f['was'] . '" is left as it is (' . (string) $why . '), though ' . $f['why']
                  . ': a start is given "' . $f['now'] . '" for that run');
        }
    }
    $out['why'] = $out['how'] === 'run' ? $why : null;
    return $out;
}

/**
 * What Xsegon can and cannot offer, given the config as it stands.
 * The UI uses this to explain itself rather than to guess.
 */
function ra_capabilities(array $library): array
{
    $exe   = ra_exe_from_library($library);
    $flags = ra_flags($exe !== null ? ra_config_path($exe) : null);

    return [
        'exe'      => $exe,
        'config'   => $flags['path'],
        'flags'    => $flags,
        'canQuit'  => $exe !== null && $flags['network_cmd_enable'] === true,
        'canResume'=> $flags['savestate_auto_save'] === true
                   && $flags['savestate_auto_load'] === true,
        // Said, or "I pressed quit and nothing happened" is a mystery from the couch.
        'quitTwice' => $flags['quit_press_twice'] === true,
    ];
}

/* ---- the pinned jump --------------------------------------------------------
 * RetroArch cannot be started on a chosen page, but a fresh one can be walked
 * there over its network commands (MENU_LEFT, MENU_DOWN, MENU_A and the rest).
 * A route is only the order of RetroArch's menus, which RetroArch may change,
 * so the jump is PINNED to one version. Offered only when every condition
 * below is READ to hold; anywhere else RetroArch opens plain and says why.
 */

/** The one RetroArch the routes were read on. */
const XS_RA_JUMP_VERSION = '1.22.2';

/**
 * The version a retroarch.exe says it is, '' when it says nothing. The exe
 * carries no Windows version stamp, but two of its strings hold it ("[INFO]
 * Version: 1.22.2", "RetroArch-WIMP/1.22.2"). Kept in data\ra-version.json
 * against the exe's path and write time, so the large read happens once.
 */
function ra_exe_version(string $exe): string
{
    if (!is_file($exe)) {
        return '';
    }
    $mtime = (int) @filemtime($exe);
    $cache = xs_data_path('ra-version.json');
    $kept  = xs_read_json($cache, []);
    if (is_array($kept) && ($kept['exe'] ?? '') === $exe && ($kept['mtime'] ?? -1) === $mtime) {
        return (string) ($kept['version'] ?? '');
    }
    $bytes   = (string) @file_get_contents($exe);
    $version = '';
    foreach (['[INFO] Version: ', 'RetroArch-WIMP/'] as $mark) {
        $at = strpos($bytes, $mark);
        if ($at !== false && preg_match('/^(\d+\.\d+\.\d+)/', substr($bytes, $at + strlen($mark), 20), $m)) {
            $version = $m[1];
            break;
        }
    }
    xs_log('RA', 'read the version off ' . $exe . ': ' . ($version !== '' ? $version : 'it does not say'));
    $why = null;
    if (!xs_write_json($cache, ['exe' => $exe, 'mtime' => $mtime, 'version' => $version], $why)) {
        // Not kept means the whole exe is read again next time: slow, and worth a line.
        xs_log('RA', 'could not keep that in ra-version.json (' . (string) $why . '), so it will be read again');
    }
    return $version;
}

/** Is a RetroArch open right now? One tasklist, asked only when a walk is about to be sent. */
function ra_is_running(): bool
{
    $out = (string) @shell_exec('tasklist /FI "IMAGENAME eq retroarch.exe" /NH /FO CSV 2>NUL');
    return stripos($out, 'retroarch.exe') !== false;
}

/** A few named keys of one RetroArch settings file, raw: key => "value". */
function ra_cfg_keys(?string $cfg, array $names): array
{
    $out = [];
    if ($cfg === null) {
        return $out;
    }
    foreach (@file($cfg, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        if (preg_match('/^\s*([a-z0-9_]+)\s*=\s*"(.*)"\s*$/', $line, $m) && in_array($m[1], $names, true)) {
            $out[$m[1]] = $m[2];
        }
    }
    return $out;
}

/**
 * May RetroArch be walked to a page here? Answers ok, why (when not), okBtn
 * (menu_swap_ok_cancel_buttons swaps it) and port. Every condition is read:
 * the pinned version, the ozone menu with Settings shown and kiosk mode off,
 * and network commands already on, so nothing is appended that RetroArch
 * could save into its file on the way out.
 */
function ra_jump_check(array $caps): array
{
    $no = static fn(string $why) => ['ok' => false, 'why' => $why, 'okBtn' => 'A', 'port' => 55355];
    if ($caps['exe'] === null || $caps['config'] === null) {
        return $no('no RetroArch to open');
    }
    $keys = ra_cfg_keys((string) $caps['config'],
        ['menu_driver', 'content_show_settings', 'kiosk_mode_enable',
         'settings_show_drivers', 'settings_show_video', 'settings_show_audio', 'settings_show_input',
         'network_cmd_enable', 'network_cmd_port', 'menu_swap_ok_cancel_buttons']);
    $version = ra_exe_version((string) $caps['exe']);
    if ($version !== XS_RA_JUMP_VERSION) {
        return $no('the jump is only known for RetroArch ' . XS_RA_JUMP_VERSION
                 . ($version === '' ? ', and this one does not say its version' : ', and this one says ' . $version));
    }
    if (($keys['menu_driver'] ?? '') !== 'ozone') {
        return $no('the route was read on the ozone menu, and this RetroArch uses ' . (($keys['menu_driver'] ?? '') === '' ? 'another menu' : $keys['menu_driver']));
    }
    if (($keys['content_show_settings'] ?? 'true') === 'false' || ($keys['kiosk_mode_enable'] ?? 'false') === 'true') {
        return $no('this RetroArch hides its Settings menu, so there is nothing to walk to');
    }
    // Input is the fourth row of Settings only while Drivers, Video and Audio
    // stand above it: RetroArch can hide each (Settings > User Interface >
    // Menu Item Visibility), and one hidden row would send the walk elsewhere.
    foreach (['drivers', 'video', 'audio', 'input'] as $row) {
        if (($keys['settings_show_' . $row] ?? 'true') === 'false') {
            return $no('this RetroArch hides ' . ucfirst($row) . ' in its Settings menu, so the rows are not where the route was read');
        }
    }
    if (($keys['network_cmd_enable'] ?? 'false') !== 'true') {
        return $no('RetroArch\'s network commands are off, and the jump only uses what is already on (Settings > Network > Network Commands)');
    }
    return ['ok' => true, 'why' => null,
            'okBtn' => ($keys['menu_swap_ok_cancel_buttons'] ?? 'false') === 'true' ? 'B' : 'A',
            'port'  => (int) (($keys['network_cmd_port'] ?? '') !== '' ? $keys['network_cmd_port'] : 55355)];
}
