<?php
/**
 * Xsegon - RetroArch's save states, read only.
 *
 * Before a launch the page asks which states exist for the game, shows them
 * with the screenshot RetroArch keeps beside each one, and the launch tells
 * RetroArch which slot to sit on (api\launch.php). Nothing here writes: the
 * states are the person's and RetroArch's.
 *
 * Where RetroArch keeps them is four settings in retroarch.cfg, read the same
 * way includes\retroarch.php reads its other flags:
 *
 *     savestate_directory = ":\states"       ":" means beside retroarch.exe
 *     savestates_in_content_dir = "false"    true: next to the ROM instead
 *     sort_savestates_enable = "true"        a folder per core, named from info\
 *     sort_savestates_by_content_enable      then a folder per content folder
 *
 * and the files are <rom name>.state (slot 0), .state1 .. .state999, with
 * .state<N>.png beside each when savestate_thumbnail_enable is on.
 * <rom name>.state.auto is RetroArch's own exit save, which only
 * savestate_auto_load can bring back, so it is reported but not offered.
 *
 * The launch sets a slot rather than loading the state outright: --entryslot
 * needs a <name>.state<N>.entry file, which would mean writing beside the saves.
 * So the launch appends state_slot = "N" to the config for that run, and one
 * press of the load hotkey brings the state in; with network commands on,
 * bin\launch.ps1 sends that press itself.
 */
declare(strict_types=1);

require_once __DIR__ . '/retroarch.php';
require_once __DIR__ . '/settings.php';

/** The core's display name, which is the folder RetroArch sorts its states into. */
function ra_core_name(string $raDir, string $args, array $flags): ?string
{
    if (!preg_match('/-L\s+"([^"]+)"|-L\s+(\S+)/', $args, $m)) {
        return null;
    }
    $core = pathinfo(str_replace('/', DIRECTORY_SEPARATOR, $m[1] !== '' ? $m[1] : $m[2]), PATHINFO_FILENAME);
    $info = ra_resolve_dir($raDir, (string) ($flags['libretro_info_path'] ?? ''), 'info')
          . DIRECTORY_SEPARATOR . $core . '.info';
    if (!is_file($info)) {
        return null;
    }
    $raw = file_get_contents($info);
    if ($raw !== false && preg_match('/^corename\s*=\s*"([^"\r\n]*)"/m', $raw, $c)) {
        return trim($c[1]);
    }
    return null;
}

/** A retroarch.cfg folder value: ":\x" is beside the exe, "" is the default. */
function ra_resolve_dir(string $raDir, string $value, string $default): string
{
    $value = trim($value);
    if ($value === '' || $value === 'default') {
        return $raDir . DIRECTORY_SEPARATOR . $default;
    }
    if (str_starts_with($value, ':')) {
        return $raDir . xs_norm_path(substr($value, 1));
    }
    return xs_norm_path($value);
}

/**
 * The folder RetroArch reads and writes this game's states in. Null when the
 * game is not a RetroArch game, or its core has no info file to name the
 * folder from (a state found anywhere else would not be the one RetroArch
 * loads, so guessing helps nobody).
 */
function ra_states_dir(array $game, array $flags): ?string
{
    $launch = $game['launch'] ?? [];
    if (($launch['kind'] ?? '') !== 'retroarch' || empty($launch['exe'])) {
        return null;
    }
    $raDir = dirname($launch['exe']);
    $rom   = (string) ($launch['rom'] ?? '');

    if (($flags['savestates_in_content_dir'] ?? false) === true && $rom !== '') {
        $dir = dirname($rom);
    } else {
        $dir = ra_resolve_dir($raDir, (string) ($flags['savestate_directory'] ?? ''), 'states');
    }
    if (($flags['sort_savestates_enable'] ?? false) === true) {
        $core = ra_core_name($raDir, (string) ($launch['args'] ?? ''), $flags);
        if ($core === null) {
            return null;
        }
        $dir .= DIRECTORY_SEPARATOR . $core;
    }
    if (($flags['sort_savestates_by_content_enable'] ?? false) === true && $rom !== '') {
        $dir .= DIRECTORY_SEPARATOR . basename(dirname($rom));
    }
    return $dir;
}

/**
 * How a picked save gets loaded:
 *   network  RetroArch's network commands are on: Xsegon sends the load.
 *   session  they are off and the person chose to have Xsegon switch them on
 *            for its own launches (api\launch.php, one run at a time).
 *   key      they are off and the person loads it with RetroArch's key.
 *   ask      they are off and nobody has chosen yet: the page asks, once.
 * $choice is a one-off answer from the page, in place of the setting.
 */
function xs_state_load_mode(array $flags, ?string $choice = null): string
{
    if ($flags['network_cmd_enable'] === true) {
        return 'network';
    }
    $s    = xs_settings();
    $mode = $choice ?? (string) ($s['launch']['stateLoad'] ?? 'ask');
    return in_array($mode, ['session', 'key'], true) ? $mode : 'ask';
}

/**
 * What the picker shows: every slot with a state, newest first, plus what
 * happens after the pick (a hotkey to press, or a press Xsegon sends).
 */
function ra_states_for(array $game): array
{
    $none = ['states' => [], 'auto' => false, 'dir' => null, 'hotkey' => 'F4', 'sends' => false];
    $launch = $game['launch'] ?? [];
    if (($launch['kind'] ?? '') !== 'retroarch' || empty($launch['exe'])) {
        return $none;
    }
    $flags = ra_flags(ra_config_path($launch['exe']));
    $dir   = ra_states_dir($game, $flags);
    $none['hotkey'] = strtoupper((string) ($flags['input_load_state'] ?: 'F4'));
    // Whether Xsegon loads the pick itself (xs_state_load_mode). The hotkey
    // stays in the answer as the way to load it again by hand.
    $none['mode']   = xs_state_load_mode($flags);
    $none['sends']  = in_array($none['mode'], ['network', 'session'], true);
    if ($dir === null || !is_dir($dir)) {
        return $none;
    }
    $base  = pathinfo((string) ($launch['rom'] ?? ''), PATHINFO_FILENAME);
    if ($base === '') {
        return $none;
    }
    $re    = '/^' . preg_quote($base, '/') . '\.state(\d{1,3})?(\.auto)?(\.png)?$/i';
    $found = [];
    $shots = [];
    $auto  = false;
    foreach (scandir($dir) ?: [] as $f) {
        if (!preg_match($re, $f, $m)) {
            continue;
        }
        if (($m[2] ?? '') !== '') {
            $auto = $auto || ($m[3] ?? '') === '';
            continue;
        }
        $slot = (int) ($m[1] ?? 0);
        if (($m[3] ?? '') !== '') {
            $shots[$slot] = filemtime($dir . DIRECTORY_SEPARATOR . $f) ?: 0;
            continue;
        }
        $path = $dir . DIRECTORY_SEPARATOR . $f;
        $found[$slot] = ['slot' => $slot, 'file' => $f, 'at' => filemtime($path) ?: 0, 'size' => filesize($path) ?: 0];
    }
    foreach ($found as $slot => &$st) {
        $st['when'] = date('c', $st['at']);
        $st['shot'] = isset($shots[$slot]) ? $shots[$slot] : null;   // the picture's time, for the address
    }
    unset($st);
    usort($found, static fn($a, $b) => $b['at'] <=> $a['at']);

    return ['states' => array_values($found), 'auto' => $auto, 'dir' => $dir,
            'hotkey' => $none['hotkey'], 'sends' => $none['sends'], 'mode' => $none['mode']];
}

/** The screenshot RetroArch saved beside a slot, or null. */
function ra_state_shot(array $game, int $slot): ?string
{
    $launch = $game['launch'] ?? [];
    if (($launch['kind'] ?? '') !== 'retroarch' || empty($launch['exe'])) {
        return null;
    }
    $dir = ra_states_dir($game, ra_flags(ra_config_path($launch['exe'])));
    if ($dir === null) {
        return null;
    }
    $base = pathinfo((string) ($launch['rom'] ?? ''), PATHINFO_FILENAME);
    $png  = $dir . DIRECTORY_SEPARATOR . $base . '.state' . ($slot === 0 ? '' : (string) $slot) . '.png';
    return is_file($png) ? $png : null;
}
