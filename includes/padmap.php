<?php
/**
 * Your buttons, per console, for the games RetroArch runs. Set in Settings by
 * pressing the pad button you want (js\padmap.js), kept in
 * data\pad-remaps.json, and handed to RetroArch at each launch
 * (api\launch.php). Per GAME too: one game's own buttons over its console's
 * (js\gamebtns.js, data\game-remaps.json), written under the ROM's own name,
 * which is how RetroArch scopes a remap to a game.
 *
 *   - As a RetroArch REMAP, RetroPad button to RetroPad button, the way its
 *     Quick Menu > Controls saves one: "input_player1_btn_<pressed> = <id the
 *     game gets>". A pad's raw button numbers depend on the driver; a remap
 *     holds on any of them.
 *   - Written in Xsegon's OWN folder, data\ra-remaps\<core>\<core>.rmp, with
 *     RetroArch pointed there for that run by --appendconfig and saving on
 *     exit off, so the pointing cannot outlive the game (includes\cheats.php).
 *   - Rewritten at every launch, so two consoles on one core each keep their
 *     own buttons. Your RetroArch remaps for that core are copied in first
 *     (read, never changed), so a game's own remap still wins.
 *
 * A console's buttons are kept as a swap of RetroPad buttons, so no two pad
 * buttons send the same thing and none goes dead. Only the moved pairs are
 * stored; none at all is the standard layout, and nothing is written.
 *
 * Per PLAYER: the console's buttons are player 1's, and players 2 to 4 have
 * the same until given their own (data\player-remaps.json), written under
 * that player's port. A game's own buttons stay every player's.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/retroarch.php';

/** RetroArch's sixteen RetroPad buttons, in its own id order: a remap names what a button sends by these numbers. */
const XS_PAD_IDS = ['b', 'y', 'select', 'start', 'up', 'down', 'left', 'right',
                    'a', 'x', 'l', 'r', 'l2', 'r2', 'l3', 'r3'];

/** How many players can have buttons: the ports a remap is written for. */
const XS_PAD_PLAYERS = 4;

/**
 * Each console's own buttons, and the RetroPad button its core reads each
 * one from, keyed by console in lower case. Each table is the core's own,
 * checked against libretro's page for it and, where the two disagreed, the
 * core's source. Only buttons: the N64's C buttons are on the right stick
 * (xs_pad_notes), which a button remap cannot move.
 */
function xs_pad_layouts(): array
{
    $dpad = [['Up', 'up'], ['Down', 'down'], ['Left', 'left'], ['Right', 'right']];
    $nes  = array_merge([['A', 'a'], ['B', 'b'], ['Select', 'select'], ['Start', 'start']], $dpad);
    $gen  = array_merge([['A', 'y'], ['B', 'b'], ['C', 'a'], ['X', 'l'], ['Y', 'x'], ['Z', 'r'],
                         ['Mode', 'select'], ['Start', 'start']], $dpad);
    $psp  = array_merge([['Cross', 'b'], ['Circle', 'a'], ['Square', 'y'], ['Triangle', 'x'], ['L', 'l'], ['R', 'r'],
                         ['Select', 'select'], ['Start', 'start']], $dpad);
    return [
        'atari 2600'                          => array_merge([['Fire', 'b'], ['Reset', 'start'], ['Select', 'select'],
                                                  ['Left difficulty A', 'l'], ['Left difficulty B', 'l2'],
                                                  ['Right difficulty A', 'r'], ['Right difficulty B', 'r2'],
                                                  ['Colour', 'l3'], ['Black and white', 'r3']], $dpad),
        'atari 7800'                          => array_merge([['1', 'b'], ['2', 'a'], ['Reset', 'x'], ['Select', 'select'],
                                                  ['Pause', 'start'], ['Left difficulty', 'l'], ['Right difficulty', 'r']], $dpad),
        'nintendo 64'                         => array_merge([['A', 'b'], ['B', 'y'], ['Z', 'l2'], ['L', 'l'], ['R', 'r'],
                                                  ['Start', 'start']], $dpad),
        'nintendo ds'                         => array_merge([['A', 'a'], ['B', 'b'], ['X', 'x'], ['Y', 'y'], ['L', 'l'], ['R', 'r'],
                                                  ['Select', 'select'], ['Start', 'start'], ['Microphone', 'l2'],
                                                  ['Next screen layout', 'r2'], ['Close the lid', 'l3']], $dpad),
        'sega 32x'                            => $gen,
        'sega dreamcast'                      => array_merge([['A', 'b'], ['B', 'a'], ['X', 'y'], ['Y', 'x'],
                                                  /* L2/R2, not L/R: Flycast reads the analog triggers from RetroPad
                                                     L2/R2 unless its Digital Triggers option is on, off as it comes. */
                                                  ['L trigger', 'l2'], ['R trigger', 'r2'], ['Start', 'start']], $dpad),
        'sega saturn'                         => array_merge([['A', 'b'], ['B', 'a'], ['C', 'r'], ['X', 'y'], ['Y', 'x'], ['Z', 'l'],
                                                  ['L', 'l2'], ['R', 'r2'], ['Start', 'start']], $dpad),
        'sony psp'                            => $psp,
        'sony playstation portable'           => $psp,
        'nintendo entertainment system'       => $nes,
        'nintendo famicom disk system'        => $nes,
        'super nintendo entertainment system' => array_merge([['A', 'a'], ['B', 'b'], ['X', 'x'], ['Y', 'y'],
                                                  ['L', 'l'], ['R', 'r'], ['Select', 'select'], ['Start', 'start']], $dpad),
        'nintendo game boy'                   => $nes,
        'nintendo game boy color'             => $nes,
        'nintendo game boy advance'           => array_merge([['A', 'a'], ['B', 'b'], ['L', 'l'], ['R', 'r'],
                                                  ['Select', 'select'], ['Start', 'start']], $dpad),
        'sega genesis'                        => $gen,
        'sega mega drive'                     => $gen,
        'sega cd'                             => $gen,
        'sega master system'                  => array_merge([['1', 'b'], ['2', 'a'], ['Pause', 'start']], $dpad),
        'sega game gear'                      => array_merge([['1', 'b'], ['2', 'a'], ['Start', 'start']], $dpad),
        'sony playstation'                    => array_merge([['Cross', 'b'], ['Circle', 'a'], ['Square', 'y'],
                                                  ['Triangle', 'x'], ['L1', 'l'], ['R1', 'r'], ['L2', 'l2'], ['R2', 'r2'],
                                                  ['L3', 'l3'], ['R3', 'r3'], ['Select', 'select'], ['Start', 'start']], $dpad),
    ];
}

/** What a console's list has to say about the buttons it cannot offer. */
function xs_pad_notes(): array
{
    return [
        'nintendo 64' => 'The C buttons are on the right stick in RetroArch, which is not set here yet; the rest are.',
    ];
}

/** Every console's buttons you set: console (lower case) => [pressed => sent], the moved ones only. */
function xs_pad_maps(): array
{
    $all = xs_read_json(xs_data_path('pad-remaps.json'), []);
    return is_array($all) ? $all : [];
}

/**
 * Players 2 to 4 with buttons of their own: console (lower case) => [player
 * => [pressed => sent]]. A player not in it has player 1's; one kept empty
 * has the standard layout on purpose, whatever player 1 has.
 */
function xs_pad_player_maps(): array
{
    $all = xs_read_json(xs_data_path('player-remaps.json'), []);
    return is_array($all) ? $all : [];
}

/**
 * One console's players with their own buttons: [2 => map, ...]. A set that
 * is not a swap (a file edited by hand) is left out and its player named in
 * $bad, so that player has player 1's and a launch is never stopped by it.
 */
function xs_pad_players(string $key, ?array &$bad = null): array
{
    $bad  = [];
    $out  = [];
    $kept = xs_pad_player_maps()[$key] ?? [];
    foreach (is_array($kept) ? $kept : [] as $n => $m) {
        $n = (int) $n;
        if ($n < 2 || $n > XS_PAD_PLAYERS) {
            continue;
        }
        if (!is_array($m) || !xs_pad_valid($m)) {
            $bad[] = $n;
            continue;
        }
        $out[$n] = $m;
    }
    ksort($out);
    return $out;
}

/**
 * One game's own buttons: game id => [pressed => sent], the moved ones only.
 * RetroArch reads a game's remap INSTEAD of the core's, not on top of it, so
 * a game's map here is complete on its own.
 */
function xs_game_maps(): array
{
    $all = xs_read_json(xs_data_path('game-remaps.json'), []);
    return is_array($all) ? $all : [];
}

/**
 * One game's own buttons, three answers and the difference matters: null
 * when it follows its console; [] when it is kept as the STANDARD layout on
 * purpose, whatever its console has; or its moved buttons. An entry that is
 * not a set of swaps counts as none, so a launch is never stopped by it.
 */
function xs_game_map(string $id): ?array
{
    $all = xs_game_maps();
    if (!array_key_exists($id, $all)) {
        return null;
    }
    $m = $all[$id];
    return is_array($m) && xs_pad_valid($m) ? $m : null;
}

/**
 * Is this a set of buttons RetroArch can take: RetroPad names on both sides,
 * nothing mapped to itself, and a swap (the buttons moved are exactly the
 * buttons taken), so no two send the same thing and none is left dead.
 */
function xs_pad_valid(array $map, ?string &$why = null): bool
{
    foreach ($map as $from => $to) {
        if (!in_array($from, XS_PAD_IDS, true) || !is_string($to) || !in_array($to, XS_PAD_IDS, true)) {
            $why = 'not a RetroPad button: ' . $from . ' => ' . (is_string($to) ? $to : gettype($to));
            return false;
        }
        if ($from === $to) {
            $why = $from . ' is mapped to itself, which is the standard and is not stored';
            return false;
        }
    }
    $sent = array_values($map);
    if (count(array_unique($sent)) !== count($sent)) {
        $why = 'two buttons would send the same thing';
        return false;
    }
    $moved = array_keys($map);
    sort($moved);
    sort($sent);
    if ($moved !== $sent) {
        $why = 'every button that moves must take another\'s place, or one goes dead';
        return false;
    }
    return true;
}

/** A game's remap file is named after its content: the ROM's own base name, as RetroArch names one. */
function xs_pad_game_base(string $rom): string
{
    return $rom !== '' ? pathinfo(str_replace('\\', '/', $rom), PATHINFO_FILENAME) : '';
}

/**
 * The remap lines RetroArch reads for one map, every player's pad the same
 * but for the players in $players, who have their own ([2 => map, ...]).
 * $whole writes all sixteen buttons, the unmoved ones as themselves, for a
 * game's file, which RetroArch reads INSTEAD of the core's. Nothing moved for
 * anyone is no lines at all.
 */
function xs_pad_lines(array $map, bool $whole = false, array $players = []): string
{
    $lines = [];
    for ($port = 1; $port <= XS_PAD_PLAYERS; $port++) {
        $mine = $players[$port] ?? $map;
        foreach ($whole ? XS_PAD_IDS : array_keys($mine) as $from) {
            $lines[] = 'input_player' . $port . '_btn_' . $from . ' = "' . array_search($mine[$from] ?? $from, XS_PAD_IDS, true) . '"';
        }
    }
    return $lines ? implode("\n", $lines) . "\n" : '';
}

/**
 * Stage this console's buttons, and this game's own, for one RetroArch
 * launch: the core's remap folder remade, your RetroArch remaps for that core
 * copied in, the console's written as the core's, the game's under the ROM's
 * name. A game map set in Xsegon takes the place of one made in RetroArch.
 * Returns the folder to point RetroArch at, or null and why (the game still
 * launches, with RetroArch's own buttons). $players: xs_pad_players().
 */
function xs_pad_stage(array $launch, array $map, ?array $gameMap = null, ?string &$why = null, array $players = []): ?string
{
    $coreLines = xs_pad_lines($map, false, $players);
    require_once __DIR__ . '/states.php';
    $exe   = (string) ($launch['exe'] ?? '');
    $raDir = dirname($exe);
    $flags = ra_flags(ra_config_path($exe));
    $core  = ra_core_name($raDir, (string) ($launch['args'] ?? ''), $flags);
    if ($core === null) {
        $why = 'the core has no info file, so RetroArch\'s remap folder for it cannot be named';
        return null;
    }
    $base = xs_pad_game_base((string) ($launch['rom'] ?? ''));
    if ($gameMap !== null && $base === '') {
        $why = 'this game has no ROM file to name its remap after';
        if ($coreLines === '') {
            return null;
        }
        $gameMap = null;                    // the console's buttons still apply
    }
    $root = xs_data_path('ra-remaps');
    $dir  = $root . DIRECTORY_SEPARATOR . $core;
    if (!is_dir($dir) && !@mkdir($dir, 0777, true)) {
        $why = 'could not make ' . $dir;
        return null;
    }
    // Built, not yours: last launch's files go, this launch's are made again.
    foreach (xs_glob($dir, '*.rmp') as $old) {
        @unlink($old);
    }
    $theirs = ra_resolve_dir($raDir, (string) ($flags['input_remapping_directory'] ?? ''),
                             'config' . DIRECTORY_SEPARATOR . 'remaps') . DIRECTORY_SEPARATOR . $core;
    foreach (xs_glob($theirs, '*.rmp') as $f) {
        if (strcasecmp(basename($f), $core . '.rmp') === 0) {
            continue;                       // the core's own: the console's takes its place
        }
        if ($gameMap !== null && strcasecmp(basename($f), $base . '.rmp') === 0) {
            continue;                       // this game's own: yours takes its place
        }
        @copy($f, $dir . DIRECTORY_SEPARATOR . basename($f));
    }
    if ($coreLines !== '') {
        if (file_put_contents($dir . DIRECTORY_SEPARATOR . $core . '.rmp', $coreLines) === false) {
            $why = 'could not write the console\'s remap in ' . $dir;
            return null;
        }
    }
    if ($gameMap !== null) {
        if (file_put_contents($dir . DIRECTORY_SEPARATOR . $base . '.rmp', xs_pad_lines($gameMap, true)) === false) {
            $why = 'could not write the game\'s remap in ' . $dir;
            return null;
        }
    }
    return $root;
}

// ---- your keys, per console -----------------------------------------------
//
// The keyboard half of the buttons above, kept in data\pad-keys.json and
// appended for the run; RetroArch's own settings file is never changed.
// A key is kept against the CONSOLE button it should press, and at launch it
// goes on whichever RetroPad button sends that console button now, since the
// console's remap applies to keys as it does to the pad.

/** RetroArch's player 1 keys when its settings file does not say: its own defaults. */
const XS_RA_KEY_DEFAULTS = ['b' => 'z', 'y' => 'a', 'select' => 'rshift', 'start' => 'enter',
                            'up' => 'up', 'down' => 'down', 'left' => 'left', 'right' => 'right',
                            'a' => 'x', 'x' => 's', 'l' => 'q', 'r' => 'w',
                            'l2' => 'nul', 'r2' => 'nul', 'l3' => 'nul', 'r3' => 'nul'];

/**
 * Every key name RetroArch reads in a bind (its own key map), less the ones
 * a PC keyboard here cannot press. Two names for one key go to one.
 */
function xs_ra_key_names(): array
{
    static $all = null;
    if ($all === null) {
        $all = ['space', 'enter', 'kp_enter', 'tab', 'backspace', 'escape', 'shift', 'rshift', 'ctrl', 'rctrl', 'alt', 'ralt',
                'up', 'down', 'left', 'right', 'insert', 'del', 'home', 'end', 'pageup', 'pagedown',
                'minus', 'equals', 'leftbracket', 'rightbracket', 'backslash', 'semicolon', 'quote', 'comma', 'period', 'slash',
                'tilde', 'add', 'subtract', 'multiply', 'divide', 'kp_period', 'capslock'];
        foreach (range('a', 'z') as $c) {
            $all[] = $c;
        }
        for ($i = 0; $i <= 9; $i++) {
            $all[] = 'num' . $i;
            $all[] = 'keypad' . $i;
        }
        for ($i = 1; $i <= 12; $i++) {
            $all[] = 'f' . $i;
        }
    }
    return $all;
}

function xs_ra_key_norm(string $k): string
{
    $k = strtolower(trim($k));
    return ['backquote' => 'tilde', 'kp_plus' => 'add', 'kp_minus' => 'subtract'][$k] ?? $k;
}

/** Every console's keys you set: console (lower case) => [console button's RetroPad name => key]. */
function xs_pad_keys(): array
{
    $all = xs_read_json(xs_data_path('pad-keys.json'), []);
    return is_array($all) ? $all : [];
}

// ---- one set of keys for every console -------------------------------------
//
// "Every console" is one set of keys on RetroArch's sixteen buttons, over
// RetroArch's keys and under a console's own. Only for the consoles the
// picker lists, so a computer that reads the keyboard itself is never given them.

/** Where Every console's keys are kept in data\pad-keys.json: no console has this name. */
const XS_PAD_EVERY = '@every';

/** RetroArch's own buttons as a console's are listed: [name, RetroPad button]. */
function xs_pad_every_layout(): array
{
    return [['A', 'a'], ['B', 'b'], ['X', 'x'], ['Y', 'y'], ['L', 'l'], ['R', 'r'], ['L2', 'l2'], ['R2', 'r2'],
            ['L3', 'l3'], ['R3', 'r3'], ['Select', 'select'], ['Start', 'start'],
            ['Up', 'up'], ['Down', 'down'], ['Left', 'left'], ['Right', 'right']];
}

/** Every console's keys as kept: [RetroPad button => key], the ones that differ from RetroArch's own. */
function xs_pad_every_keys(): array
{
    $every = xs_pad_keys()[XS_PAD_EVERY] ?? [];
    return is_array($every) ? $every : [];
}

/**
 * RetroArch's own keys with Every console's laid over them: what a console's
 * buttons start from. A button RetroArch had on a key that went to another
 * has none, so no key presses two things.
 */
function xs_pad_every_binds(array $binds, array $every): array
{
    $given = [];
    foreach ($every as $p => $k) {
        if (isset($binds[$p])) {
            $given[(string) $p] = xs_ra_key_norm((string) $k);
        }
    }
    $out = $binds;
    foreach ($binds as $p => $k) {
        if (isset($given[$p])) {
            $out[$p] = $given[$p];
        } elseif ($k !== 'nul' && in_array($k, $given, true)) {
            $out[$p] = 'nul';
        }
    }
    return $out;
}

/**
 * Would Every console's keys, set to $every where they were $everyWas, leave
 * a console's own keys sharing a key with a button beside them? Null when
 * not, or the console (lower case) and why. Only a console with keys of its
 * own can.
 */
function xs_pad_every_clash(array $every, array $everyWas, array $binds, array $hot): ?array
{
    $base    = xs_pad_every_binds($binds, $every);
    $was     = xs_pad_every_binds($binds, $everyWas);
    $layouts = xs_pad_layouts();
    $maps    = xs_pad_maps();
    foreach (xs_pad_keys() as $key => $own) {
        if ($key === XS_PAD_EVERY || !isset($layouts[$key]) || !is_array($own) || !$own) {
            continue;
        }
        $map = $maps[$key] ?? [];
        $map = is_array($map) && xs_pad_valid($map) ? $map : [];
        // One whose keys are already refused (a hotkey moved in RetroArch since) is not this change's doing.
        if (!xs_pad_keys_valid($own, $layouts[$key], $map, $was, $hot)) {
            continue;
        }
        $why = null;
        if (!xs_pad_keys_valid($own, $layouts[$key], $map, $base, $hot, $why)) {
            return ['console' => (string) $key, 'why' => (string) $why];
        }
    }
    return null;
}

/** RetroArch's own key on each RetroPad button for player 1, from its settings file as read (xs_ra_read_keys). */
function xs_ra_key_binds(array $raKeys): array
{
    $out = [];
    foreach (XS_PAD_IDS as $p) {
        $out[$p] = xs_ra_key_norm((string) ($raKeys['input_player1_' . $p] ?? XS_RA_KEY_DEFAULTS[$p]));
    }
    return $out;
}

/**
 * The keys RetroArch keeps for its own hotkeys, key => what it does, which
 * are not offered as buttons: Esc would both quit and press A. With Hotkey
 * Enable on a key, every other hotkey waits for it to be held, so only that
 * one key is kept back. A hotkey the file has no line for is on RetroArch's
 * own default key: a RetroArch that has never closed has no lines at all.
 */
function xs_ra_hotkey_keys(array $raKeys): array
{
    require_once __DIR__ . '/rahotkeys.php';
    $out = [];
    $gate = xs_ra_key_norm(xs_ra_hotkey_key($raKeys, 'enable_hotkey'));
    foreach (xs_ra_hotkey_table() as $id => [$name]) {
        $k = xs_ra_key_norm(xs_ra_hotkey_key($raKeys, $id));
        if ($k === '' || $k === 'nul' || ($gate !== '' && $gate !== 'nul' && $id !== 'enable_hotkey')) {
            continue;
        }
        $out[$k] = $name;
    }
    return $out;
}

/** The RetroPad button that sends this console button under a set of swaps: the one moved onto it, or itself. */
function xs_pad_pressed_for(array $map, string $sends): string
{
    foreach ($map as $p => $s) {
        if ($s === $sends) {
            return (string) $p;
        }
    }
    return $sends;
}

/**
 * Each of a console's buttons with its key now: RetroArch's own (through the
 * console's remap) and yours over it. [sends => ['own' => key, 'key' => key]].
 */
function xs_pad_key_view(array $layout, array $padMap, array $binds, array $mine): array
{
    $out = [];
    foreach ($layout as [$name, $sends]) {
        $own = $binds[xs_pad_pressed_for($padMap, $sends)] ?? 'nul';
        $out[$sends] = ['name' => $name, 'own' => $own, 'key' => isset($mine[$sends]) ? (string) $mine[$sends] : $own];
    }
    return $out;
}

/**
 * Is this a set of keys for that console: its own buttons, keys RetroArch
 * knows, none of its hotkeys, and no two buttons on one key once RetroArch's
 * own keys for the rest are counted in.
 */
function xs_pad_keys_valid(array $keys, array $layout, array $padMap, array $binds, array $hot, ?string &$why = null): bool
{
    require_once __DIR__ . '/rahotkeys.php';
    $buttons = [];
    foreach ($layout as [$name, $sends]) {
        $buttons[$sends] = $name;
    }
    foreach ($keys as $sends => $k) {
        if (!isset($buttons[$sends])) {
            $why = 'that console has no ' . $sends . ' button';
            return false;
        }
        if (!is_string($k)) {
            $why = 'not a key RetroArch knows: ' . gettype($k);
            return false;
        }
        if (xs_ra_key_norm($k) === 'nul') {
            // "No key": what a swap hands the other button when the one being set
            // had none. Refusing it breaks taking a key for an unbound button.
            continue;
        }
        if (!in_array(xs_ra_key_norm($k), xs_ra_key_names(), true)) {
            $why = 'not a key RetroArch knows: ' . $k;
            return false;
        }
        if (isset($hot[xs_ra_key_norm($k)])) {
            $why = xs_ra_key_words($k) . ' is RetroArch\'s key for ' . $hot[xs_ra_key_norm($k)] . ', so it cannot be a button too';
            return false;
        }
    }
    $seen = [];
    foreach (xs_pad_key_view($layout, $padMap, $binds, array_map('xs_ra_key_norm', $keys)) as $sends => $v) {
        if ($v['key'] === 'nul') {
            continue;
        }
        if (isset($seen[$v['key']])) {
            $why = $buttons[$seen[$v['key']]] . ' and ' . $v['name'] . ' would share ' . xs_ra_key_words($v['key']);
            return false;
        }
        $seen[$v['key']] = $sends;
    }
    return true;
}

/**
 * What --appendconfig tells RetroArch for one launch: each key you chose on
 * the RetroPad button that sends its console button under $padMap (the
 * console's remap, or the game's own), and any other RetroPad button that
 * RetroArch had on one of those keys let go, so no key presses two things.
 * $base is RetroArch's keys with Every console's over them
 * (xs_pad_every_binds): a button it changes and the console does not is
 * written as $base has it.
 */
function xs_pad_key_lines(array $keys, array $padMap, array $binds, ?array $base = null): array
{
    $base = $base ?? $binds;
    $set = [];
    foreach ($keys as $sends => $k) {
        $set[xs_pad_pressed_for($padMap, (string) $sends)] = xs_ra_key_norm((string) $k);
    }
    $lines = [];
    foreach (XS_PAD_IDS as $p) {
        if (isset($set[$p])) {
            $lines[] = 'input_player1_' . $p . ' = "' . $set[$p] . '"';
        } elseif (in_array($base[$p] ?? 'nul', $set, true)) {
            $lines[] = 'input_player1_' . $p . ' = "nul"';
        } elseif (($base[$p] ?? 'nul') !== ($binds[$p] ?? 'nul')) {
            $lines[] = 'input_player1_' . $p . ' = "' . $base[$p] . '"';
        }
    }
    if ($lines) {
        $lines[] = 'config_save_on_exit = "false"';
    }
    return $lines;
}

/** What --appendconfig tells RetroArch for that run: read remaps from Xsegon's folder, and write nothing back. */
function xs_pad_config_lines(string $root): array
{
    return [
        'input_remapping_directory = "' . $root . '"',
        'input_remap_binds_enable = "true"',
        'auto_remaps_enable = "true"',
        'remap_save_on_exit = "false"',
        'config_save_on_exit = "false"',
    ];
}
