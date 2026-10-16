<?php
/**
 * /api/controls.php - what the emulator will listen to, read only.
 *
 *   GET ?id=<game>          that game's bindings, through its own launch
 *   GET ?platform=<name>    the console's default program from the table
 *   GET ?hotkeys=1          RetroArch's hotkeys alone
 *
 * Nothing here writes anything. A format this cannot read is said to be
 * unreadable, with its path: "no controls" and "controls this page cannot
 * parse" are different answers.
 *
 * The answer is rows of {name, value}: for RetroArch the RetroPad button and
 * its keyboard key, for the other emulators whatever their own file says.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/scan.php';
require_once __DIR__ . '/../includes/retroarch.php';
require_once __DIR__ . '/../includes/rahotkeys.php';

/* RetroArch's sixteen RetroPad slots, in RetroArch's own id order (0 to 15):
 * the order matters because a remap file names buttons by these numbers. */
function xs_retropad(): array
{
    return [
        'b' => 'B (bottom)', 'y' => 'Y (left)', 'select' => 'Select', 'start' => 'Start',
        'up' => 'D-pad up', 'down' => 'D-pad down', 'left' => 'D-pad left', 'right' => 'D-pad right',
        'a' => 'A (right)', 'x' => 'X (top)', 'l' => 'L', 'r' => 'R',
        'l2' => 'L2', 'r2' => 'R2', 'l3' => 'L3 (left stick press)', 'r3' => 'R3 (right stick press)',
    ];
}

/** The exe a .bat wrapper stands in front of, exactly as the runs check resolves it. */
function xs_controls_real_exe(string $exe): string
{
    if (preg_match('/\.(bat|cmd)$/i', $exe)) {
        $ra = dirname($exe) . DIRECTORY_SEPARATOR . 'retroarch.exe';
        if (is_file($ra)) {
            return $ra;
        }
    }
    return $exe;
}

/** One [Section] of a flat ini, as ordered key => value pairs. */
function xs_controls_ini_section(string $file, string $section): array
{
    $out = [];
    $in = false;
    foreach (@file($file, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        $line = trim($line);
        if (preg_match('/^\[(.+)\]$/', $line, $m)) {
            $in = strcasecmp(trim($m[1]), $section) === 0;
            continue;
        }
        if (!$in || $line === '' || $line[0] === ';' || $line[0] === '#') {
            continue;
        }
        $eq = strpos($line, '=');
        if ($eq === false) {
            continue;
        }
        $out[trim(substr($line, 0, $eq))] = trim(substr($line, $eq + 1), " \t`\"");
    }
    return $out;
}

/* ---- the hotkeys alone, for Settings > RetroArch + Emulator Controls -------------
 * As the library's RetroArch's own retroarch.cfg has them; a core's override
 * shows in a game's Controls panel. */
if (($_GET['hotkeys'] ?? '') === '1') {
    $caps = ra_capabilities(xs_library());
    if ($caps['exe'] === null || $caps['config'] === null) {
        xs_json(['ok' => true, 'hotkeys' => null,
                 'note' => 'None of your games play through RetroArch yet, so there are no hotkeys to read.']);
    }
    xs_json(['ok' => true, 'hotkeys' => xs_ra_apply_yours(xs_ra_hotkeys((string) $caps['config']))]);
}

/* ---- which launch to explain -------------------------------------------- */

$id       = trim((string) ($_GET['id'] ?? ''));
$platform = trim((string) ($_GET['platform'] ?? ''));
if ($id === '' && $platform === '') {
    xs_fail('id or platform is needed', 400);
}

$title = '';
$launch = null;
if ($id !== '') {
    $game     = xs_game_or_404($id);
    $title    = (string) $game['title'];
    $platform = (string) $game['platform'];
    $launch   = is_array($game['launch'] ?? null) ? $game['launch'] : null;
    if ($launch === null) {
        $note = (string) ($game['launchError'] ?? 'this game has no launch to explain');
        // No emulator on a console RetroArch plays: the note names the press beside it (js\raoffer.js).
        // One game read, so a RetroArch only LaunchBox's launch lines know is not looked for; the press asks again.
        $raOffer = null;
        if (str_starts_with($note, 'no emulator')) {
            require_once __DIR__ . '/../includes/setup.php';
            $raOffer = xs_setup_ra_plays($platform) ? xs_setup_ra_offer([]) : null;
            $note = xs_setup_ra_why($note, $platform, $raOffer);
        }
        xs_json(['ok' => true, 'title' => $title, 'platform' => $platform, 'via' => '',
                 'source' => ['file' => null, 'read' => false, 'note' => $note],
                 'rows' => [], 'remap' => null, 'raOffer' => $raOffer]);
    }
    // A web game or a program of your own has no emulator to ask.
    if (!empty($launch['local'])) {
        xs_json(['ok' => true, 'title' => $title, 'platform' => $platform, 'via' => 'its own program',
                 'source' => ['file' => null, 'read' => false,
                              'note' => 'a game of your own runs its own program, which listens to whatever it likes'],
                 'rows' => [], 'remap' => null]);
    }
} else {
    $cmd = xs_scan_command($platform, 'controls-probe');
    if (isset($cmd['error'])) {
        xs_fail((string) $cmd['error'], 404);
    }
    $launch = $cmd;
}

$exe  = xs_controls_real_exe((string) ($launch['exe'] ?? ''));
$args = (string) ($launch['args'] ?? '');
$via  = (string) ($launch['via'] ?? ($launch['emulator'] ?? basename($exe)));
$dir  = dirname($exe);
$name = strtolower(basename($exe));

$rows = [];
$remap = null;
$gameMap = null;        // RetroArch only: the game's own buttons set in Xsegon
$hotkeys = null;        // RetroArch only: the presses that leave, pause and save (includes\rahotkeys.php)
$source = ['file' => null, 'read' => false, 'note' => ''];

/* ---- RetroArch: the full read ------------------------------------------- */
if ($name === 'retroarch.exe' || ($launch['kind'] ?? '') === 'retroarch') {
    $via = $via !== '' ? $via : 'RetroArch';
    $cfg = ra_config_path($exe);
    if ($cfg === null) {
        $source['note'] = 'no retroarch.cfg beside ' . $exe;
    } else {
        $keys = [];
        foreach (@file($cfg, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
            if (preg_match('/^input_player1_([a-z0-9_]+)\s*=\s*"(.*)"/', trim($line), $m)) {
                $keys[$m[1]] = $m[2];
            }
        }
        foreach (xs_retropad() as $pad => $label) {
            /* The bare key is the keyboard; the _btn twin is a pad button
               bound BY HAND in RetroArch (rare: profiles from autoconfig\
               do not appear here). Both are shown when both are real. */
            $kb  = (string) ($keys[$pad] ?? '');
            $btn = (string) ($keys[$pad . '_btn'] ?? 'nul');
            $val = $kb !== '' && $kb !== 'nul' ? 'key ' . $kb : 'no key';
            if ($btn !== 'nul' && $btn !== '') {
                $val .= ', pad button ' . $btn;
            }
            $rows[] = ['name' => $label, 'value' => $val];
        }
        $source = ['file' => $cfg, 'read' => true,
                   'note' => 'The pad itself follows RetroArch\'s autoconfig profile for whatever '
                           . 'controller is plugged in, mapped to these same RetroPad buttons.'];

        /* The hotkeys: a core's or game's override file wins, as it does in
           RetroArch, and is named on the row it changed. */
        $hotkeys = xs_ra_apply_yours(xs_ra_hotkeys($cfg, xs_ra_override_files($dir, $args, (string) ($launch['rom'] ?? ''))),
                                     $id !== '' ? $id : null);

        /* A remap, if the person made one in RetroArch: per game first, then
           per core. The folder is named after the core's display name, so it
           is matched by stripped key against the -L core in the command. */
        if (preg_match('/-L\s+"?([^"]+_libretro\.dll)"?/i', $args, $cm)) {
            $stem = strtolower((string) preg_replace('/[^a-z0-9]+/i', '', basename($cm[1], '_libretro.dll')));
            $root = $dir . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'remaps';
            foreach (@scandir($root) ?: [] as $d) {
                if ($d === '.' || $d === '..' || !is_dir($root . DIRECTORY_SEPARATOR . $d)) {
                    continue;
                }
                if (strtolower((string) preg_replace('/[^a-z0-9]+/i', '', $d)) !== $stem) {
                    continue;
                }
                $rom  = (string) ($launch['rom'] ?? '');
                $base = $rom !== '' ? pathinfo(str_replace('\\', '/', $rom), PATHINFO_FILENAME) : '';
                foreach ([$base . '.rmp', $d . '.rmp'] as $f) {
                    $p = $root . DIRECTORY_SEPARATOR . $d . DIRECTORY_SEPARATOR . $f;
                    if ($f === '.rmp' || !is_file($p)) {
                        continue;
                    }
                    $ids = array_keys(xs_retropad());
                    $labels = xs_retropad();
                    $changes = [];
                    foreach (@file($p, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
                        if (preg_match('/^input_player1_btn_([a-z0-9_]+)\s*=\s*"(-?\d+)"/', trim($line), $m)) {
                            $from = $m[1];
                            $to   = (int) $m[2];
                            $natural = array_search($from, $ids, true);
                            if ($to >= 0 && $to < count($ids) && $to !== $natural && isset($labels[$from])) {
                                $changes[] = ['from' => $labels[$from], 'to' => $labels[$ids[$to]]];
                            }
                        }
                    }
                    $remap = ['file' => $p, 'changes' => $changes];
                    break 2;
                }
            }
        }

        /* The game's own buttons set in Xsegon, shown beside the remap: at an
           Xsegon launch they take a game remap's place. */
        if ($id !== '') {
            require_once __DIR__ . '/../includes/padmap.php';
            $labels = xs_retropad();
            $own = xs_game_map($id);        // null: none; []: standard on purpose
            if ($own !== null) {
                $mine = [];
                foreach ($own as $from => $to) {
                    $mine[] = ['from' => $labels[$from], 'to' => $labels[$to]];
                }
                $gameMap = ['changes' => $mine, 'standard' => $mine === [], 'over' => $remap !== null];
            }
        }
    }
}

/* ---- the other emulators: as far as each format allows ------------------ */
elseif ($name === 'dolphin.exe') {
    $file = $dir . DIRECTORY_SEPARATOR . 'User' . DIRECTORY_SEPARATOR . 'Config' . DIRECTORY_SEPARATOR
          . (stripos($platform, 'wii') !== false && stripos($platform, 'gamecube') === false
             ? 'WiimoteNew.ini' : 'GCPadNew.ini');
    $sec = basename($file) === 'WiimoteNew.ini' ? 'Wiimote1' : 'GCPad1';
    if (is_file($file)) {
        foreach (xs_controls_ini_section($file, $sec) as $k => $v) {
            if (stripos($k, 'Calibration') !== false || stripos($k, 'Dead Zone') !== false) {
                continue;
            }
            $rows[] = ['name' => $k, 'value' => $v];
        }
        $source = ['file' => $file, 'read' => true, 'note' => 'Dolphin\'s own words: the left side is the console\'s control, the right the pad or key it listens to.'];
    } else {
        $source['note'] = 'Dolphin keeps its bindings in ' . $file . ', which is not there; its Controllers screen has them.';
    }
} elseif (str_starts_with($name, 'pcsx2')) {
    $file = $dir . DIRECTORY_SEPARATOR . 'inis' . DIRECTORY_SEPARATOR . 'PCSX2.ini';
    if (is_file($file)) {
        foreach (xs_controls_ini_section($file, 'Pad1') as $k => $v) {
            // Bindings look like "SDL-3/FaceNorth"; the rest of the section
            // is tuning numbers, which are not controls.
            if ($k === 'Type' || str_contains($v, '/')) {
                $rows[] = ['name' => $k, 'value' => $v];
            }
        }
        $source = ['file' => $file, 'read' => true, 'note' => 'PCSX2\'s own words: DualShock button on the left, the pad input it listens to on the right.'];
    } else {
        $source['note'] = 'PCSX2 keeps its bindings in inis\\PCSX2.ini, which is not there; Settings > Controllers has them.';
    }
} elseif ($name === 'rpcs3.exe') {
    $file = $dir . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'input_configs'
          . DIRECTORY_SEPARATOR . 'global' . DIRECTORY_SEPARATOR . 'Default.yml';
    if (is_file($file)) {
        /* The yml is one flat "Key: Value" block under Player 1 Input >
           Config: indentation is the whole grammar read here. */
        $in = false;
        foreach (@file($file, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
            if (preg_match('/^\s{2}Config:\s*$/', $line)) {
                $in = true;
                continue;
            }
            if ($in && preg_match('/^\s{4}([^:]+):\s*(.+)$/', $line, $m)) {
                $v = trim($m[2], ' "');
                if ($v !== '' && !is_numeric($v)) {
                    $rows[] = ['name' => trim($m[1]), 'value' => $v];
                }
                continue;
            }
            if ($in && !preg_match('/^\s{4,}/', $line)) {
                break;
            }
        }
        $source = ['file' => $file, 'read' => true, 'note' => 'RPCS3\'s own words: PS3 control on the left, the pad input on the right.'];
    } else {
        $source['note'] = 'RPCS3 keeps its bindings under config\\input_configs; Pads in its own window has them.';
    }
} elseif ($name === 'xemu.exe') {
    $file = $dir . DIRECTORY_SEPARATOR . 'xemu.toml';
    $source['note'] = 'Xemu drives a standard pad by itself: the Xbox controller maps one to one, and '
                    . ($file && is_file($file) ? 'xemu.toml only records which controller sits in which port.'
                                               : 'there is no per-button file to read.');
    if (is_file($file)) {
        $source['file'] = $file;
        $source['read'] = true;
        $in = false;
        foreach (@file($file, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
            $line = trim($line);
            if (preg_match('/^\[input\.bindings\]$/i', $line)) {
                $in = true;
                continue;
            }
            if ($in && $line !== '' && $line[0] === '[') {
                break;
            }
            if ($in && preg_match('/^([^=]+)=\s*(.+)$/', $line, $m)) {
                $rows[] = ['name' => trim($m[1]), 'value' => trim($m[2], " '\"")];
            }
        }
    }
} elseif (str_starts_with($name, 'xenia')) {
    $source['note'] = 'Xenia maps XInput pads directly and keeps no per-button file: an Xbox-shaped pad is already the Xbox 360 pad.';
} elseif ($name === 'cemu.exe') {
    $prof = $dir . DIRECTORY_SEPARATOR . 'controllerProfiles';
    $found = null;
    foreach (@scandir($prof) ?: [] as $f) {
        if (preg_match('/\.xml$/i', $f)) {
            $found = $prof . DIRECTORY_SEPARATOR . $f;
            break;
        }
    }
    $source['note'] = $found !== null
        ? 'Cemu\'s profile is XML; open it to read the pairs.'
        : 'Cemu has no saved controller profile here (controllerProfiles\\ is empty); its Input settings screen has the live mapping.';
    if ($found !== null) {
        $source['file'] = $found;
    }
} else {
    $source['note'] = ($via !== '' ? $via : basename($exe)) . ' keeps its bindings in its own settings screen; nothing readable sits beside the exe.';
}

xs_json(['ok' => true, 'title' => $title, 'platform' => $platform, 'via' => $via,
         'source' => $source, 'rows' => $rows, 'remap' => $remap, 'gameMap' => $gameMap, 'hotkeys' => $hotkeys]);
