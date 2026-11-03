<?php
/**
 * Eden (Switch, a yuzu fork). Portable with a user\ folder beside it, else %APPDATA%\eden.
 * Bindings: config\qt-config.ini [Controls], player_0_button_a="engine:sdl,port:0,guid:...,button:1".
 * Only player lines are read from that file: its [WebService] holds the person's token.
 */
declare(strict_types=1);

// An Xbox pad's buttons as SDL numbers them for Eden (Microsoft's 045e in the guid).
const XS_EDEN_XBOX = [0 => 'A', 1 => 'B', 2 => 'X', 3 => 'Y', 4 => 'LB', 5 => 'RB', 6 => 'Back', 7 => 'Start',
    8 => 'Left stick press', 9 => 'Right stick press', 10 => 'Xbox button'];

// Settings::ControllerType's order, as player_N_type numbers it.
const XS_EDEN_TYPES = ['Pro Controller', 'Joy-Con pair', 'Left Joy-Con', 'Right Joy-Con', 'Handheld', 'GameCube controller',
    'Poké Ball Plus', 'NES controller', 'SNES controller', 'N64 controller', 'Sega Genesis controller'];

/** A binding in plain words: "B" for an Xbox pad's button 1, "D-pad up", "LT"; the raw text where it cannot tell. */
function xs_eden_input(string $v): string
{
    if ($v === '' || $v === '[empty]') {
        return 'not set';
    }
    $f = [];
    foreach (explode(',', trim($v, '"')) as $part) {
        $kv = explode(':', $part, 2);
        $f[$kv[0]] = $kv[1] ?? '';
    }
    $xbox = str_contains(strtolower($f['guid'] ?? ''), '5e040000');
    if (($f['engine'] ?? '') === 'keyboard') {
        return 'key ' . ($f['code'] ?? '?');
    }
    if (isset($f['button'])) {
        return $xbox ? (XS_EDEN_XBOX[(int) $f['button']] ?? 'button ' . $f['button']) : 'button ' . $f['button'];
    }
    if (isset($f['hat'])) {
        return 'D-pad ' . ($f['direction'] ?? '');
    }
    if (isset($f['axis'])) {
        return $xbox && in_array($f['axis'], ['2', '5'], true) ? ($f['axis'] === '2' ? 'LT' : 'RT') : 'axis ' . $f['axis'];
    }
    if (isset($f['axis_x'])) {
        return $xbox ? ($f['axis_x'] === '0' ? 'Left stick' : 'Right stick') : 'stick on axes ' . $f['axis_x'] . ' and ' . ($f['axis_y'] ?? '?');
    }
    return trim($v, '"');
}

/** The person's player 1 inputs for Home, Minus and Plus, for saying a shortcut in their pad's words; $unset gets the ones on no button. */
function xs_eden_pad_words(string $file, string $seq, ?array &$unset = null): string
{
    $c = xs_emus_ini_section($file, 'Controls');
    $words = [];
    $unset = [];
    foreach (explode('+', $seq) as $b) {
        $k = 'player_0_button_' . strtolower($b);
        $w = isset($c[$k]) ? xs_eden_input((string) $c[$k]) : '';
        if ($w === 'not set') {
            $unset[] = $b;
        }
        $words[] = $w !== '' && $w !== 'not set' ? $w : $b;
    }
    return implode(' and ', $words);
}

return [
    'name'     => 'Eden',
    'exes'     => ['eden'],
    'consoles' => ['nintendo switch'],
    'home'     => static fn(string $dir): string => is_dir($dir . '\\user') ? $dir . '\\user' : xs_emus_appdata('eden'),
    'controls' => static function (string $home, string $platform): array {
        $file = $home . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'qt-config.ini';
        if (!is_file($file)) {
            return ['rows' => [], 'source' => ['file' => null, 'read' => false,
                    'note' => 'Eden keeps its bindings in ' . $file . ', which is not there; Emulation > Configure > Controls in Eden sets them.']];
        }
        if (xs_emus_unreadable($file)) {
            return xs_emus_unread_controls('Eden', $file);
        }
        if (!xs_emus_ini_has($file, 'Controls')) {
            return ['rows' => [], 'source' => ['file' => $file, 'read' => true,
                    'note' => 'Eden\'s settings have no controls yet; Emulation > Configure > Controls in Eden sets them.']];
        }
        $c = xs_emus_ini_section($file, 'Controls');
        $type = (int) ($c['player_0_type'] ?? 0);
        $rows = [['name' => 'Player 1', 'value' => (XS_EDEN_TYPES[$type] ?? 'type ' . $type)
                  . (strtolower((string) ($c['player_0_connected'] ?? 'true')) === 'true' ? '' : ', not connected')]];
        foreach (['a' => 'A', 'b' => 'B', 'x' => 'X', 'y' => 'Y', 'l' => 'L', 'r' => 'R', 'zl' => 'ZL', 'zr' => 'ZR',
                  'plus' => 'Plus', 'minus' => 'Minus', 'home' => 'Home', 'dup' => 'D-pad up', 'ddown' => 'D-pad down',
                  'dleft' => 'D-pad left', 'dright' => 'D-pad right', 'lstick' => 'Left stick press', 'rstick' => 'Right stick press'] as $k => $label) {
            if (array_key_exists('player_0_button_' . $k, $c)) {
                $w = xs_eden_input((string) $c['player_0_button_' . $k]);
                $rows[] = ['name' => $label, 'value' => $w] + ($w === 'not set' ? ['unset' => true] : []);
            }
        }
        foreach (['lstick' => 'Left stick', 'rstick' => 'Right stick'] as $k => $label) {
            if (isset($c['player_0_' . $k])) {
                $rows[] = ['name' => $label, 'value' => xs_eden_input((string) $c['player_0_' . $k])];
            }
        }
        for ($n = 1; $n < 8; $n++) {
            if (strtolower((string) ($c['player_' . $n . '_connected'] ?? 'false')) === 'true') {
                $t = (int) ($c['player_' . $n . '_type'] ?? 0);
                $a = xs_eden_input((string) ($c['player_' . $n . '_button_a'] ?? ''));
                $rows[] = ['name' => 'Player ' . ($n + 1), 'value' => (XS_EDEN_TYPES[$t] ?? 'type ' . $t) . ($a === 'not set' ? ', A on no button' : ', ' . $a . ' for A')];
            }
        }
        return ['rows' => $rows, 'source' => ['file' => $file, 'read' => true,
                'note' => 'Eden\'s own words, read from its player lines: the Switch control on the left, the pad input on the right. A Switch A on an Xbox pad\'s B is the Switch\'s place for it.']];
    },
    'setupLater' => 'Not yet: Eden takes a game\'s own controls only through a profile it loads by name, which is not proven here yet. Your own bindings in Eden are what its games use.',
    'leave'    => static function (string $home): string {
        $file = $home . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'qt-config.ini';
        if (!is_file($file)) {
            return 'Eden has no settings file yet (' . $file . '); as it comes, Home+Minus on player 1\'s controller closes Eden, once a controller is set in its Controls.';
        }
        $ui   = xs_emus_ini_section($file, 'UI');
        $exit = (string) ($ui['Shortcuts\\Main%20Window\\Exit%20Eden\\Controller_KeySeq'] ?? 'Home+Minus');
        $stop = (string) ($ui['Shortcuts\\Main%20Window\\Stop%20Emulation\\Controller_KeySeq'] ?? 'L+Plus+Minus');
        $unset = [];
        $pad = $exit !== '' ? xs_eden_pad_words($file, $exit, $unset) : '';
        $words = ($exit === '' ? 'No pad press closes Eden'
                 : ($unset ? $exit . ' closes Eden, but ' . implode(' and ', $unset) . (count($unset) === 1 ? ' is' : ' are') . ' on no button of your pad, so it is reached from the keyboard'
                           : $exit . ' closes Eden (on your pad: ' . $pad . ')'))
               . ($stop !== '' ? '; ' . $stop . ' stops the game and leaves Eden open' : '') . '.';
        // confirmStop: 0 asks always, 1 asks by game, 2 never (src\qt_common\uisettings.h).
        if ((string) ($ui['confirmStop'] ?? '0') !== '2') {
            $words .= ' Eden then asks "Are you sure you want to close Eden?", unless Confirm before stopping emulation is set to Never ask in Eden\'s General settings.';
        }
        return $words;
    },
];
