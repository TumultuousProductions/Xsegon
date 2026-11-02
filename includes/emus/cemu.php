<?php
/**
 * Cemu (Wii U). Portable with a portable\ folder or settings.xml beside it, else %APPDATA%\Cemu.
 * Bindings: controllerProfiles\controllerN.xml, player N+1: <mapping> the Wii U control, <button> the pad's input.
 */
declare(strict_types=1);

// The GamePad's controls by mapping number (src\input\emulated\VPADController.h).
const XS_CEMU_GAMEPAD = [1 => 'A', 2 => 'B', 3 => 'X', 4 => 'Y', 5 => 'L', 6 => 'R', 7 => 'ZL', 8 => 'ZR', 9 => 'Plus', 10 => 'Minus',
    11 => 'D-pad up', 12 => 'D-pad down', 13 => 'D-pad left', 14 => 'D-pad right', 15 => 'Left stick press', 16 => 'Right stick press',
    17 => 'Left stick up', 18 => 'Left stick down', 19 => 'Left stick left', 20 => 'Left stick right',
    21 => 'Right stick up', 22 => 'Right stick down', 23 => 'Right stick left', 24 => 'Right stick right',
    25 => 'Microphone', 26 => 'Show the GamePad screen', 27 => 'Home'];

// An XInput pad's inputs by Cemu's number, read off a profile Cemu wrote for an Xbox pad.
const XS_CEMU_XINPUT = [0 => 'D-pad up', 1 => 'D-pad down', 2 => 'D-pad left', 3 => 'D-pad right', 4 => 'Start', 5 => 'Back',
    6 => 'Left stick press', 7 => 'Right stick press', 8 => 'LB', 9 => 'RB', 12 => 'A', 13 => 'B', 14 => 'X', 15 => 'Y',
    38 => 'Left stick right', 39 => 'Left stick up', 40 => 'Right stick right', 41 => 'Right stick up', 42 => 'LT', 43 => 'RT',
    44 => 'Left stick left', 45 => 'Left stick down', 46 => 'Right stick left', 47 => 'Right stick down'];

/** One profile: ['type', 'api', 'pad', 'map' => [mapping => input]]; null when it will not read. */
function xs_cemu_profile(string $file): ?array
{
    $x = @simplexml_load_file($file);
    if ($x === false || !isset($x->type)) {
        return null;
    }
    $map = [];
    foreach ($x->controller->mappings->entry ?? [] as $en) {
        $map[(int) $en->mapping] = (int) $en->button;
    }
    return ['type' => trim((string) $x->type), 'api' => trim((string) ($x->controller->api ?? '')),
            'pad' => trim((string) ($x->controller->uuid ?? '')), 'map' => $map];
}

return [
    'name'     => 'Cemu',
    'exes'     => ['cemu'],
    'consoles' => ['nintendo wii u', 'wii u'],
    'home'     => static function (string $dir): string {
        if (is_dir($dir . '\\portable')) {
            return $dir . '\\portable';
        }
        return is_file($dir . '\\settings.xml') ? $dir : xs_emus_appdata('Cemu');
    },
    'controls' => static function (string $home, string $platform): array {
        $dir  = $home . DIRECTORY_SEPARATOR . 'controllerProfiles';
        $file = $dir . DIRECTORY_SEPARATOR . 'controller0.xml';
        if (!is_file($file)) {
            return ['rows' => [], 'source' => ['file' => null, 'read' => false,
                    'note' => 'Cemu has no controller set for player 1 (' . $file . ' is not there); Options > Input settings in Cemu sets one.']];
        }
        $p = xs_cemu_profile($file);
        if ($p === null) {
            return ['rows' => [], 'source' => ['file' => $file, 'read' => false, 'note' => 'Cemu\'s player 1 profile would not read as XML.']];
        }
        $xin  = strcasecmp($p['api'], 'XInput') === 0;
        $rows = [['name' => 'Player 1', 'value' => $p['type'] . ($p['api'] !== '' ? ', ' . $p['api'] . ($xin ? ' pad ' . ((int) $p['pad'] + 1) : '') : '')]];
        for ($n = 1; $n < 8; $n++) {
            $o = xs_cemu_profile($dir . DIRECTORY_SEPARATOR . 'controller' . $n . '.xml');
            if ($o !== null) {
                $rows[] = ['name' => 'Player ' . ($n + 1), 'value' => $o['type'] . ($o['api'] !== '' ? ', ' . $o['api'] . (strcasecmp($o['api'], 'XInput') === 0 ? ' pad ' . ((int) $o['pad'] + 1) : '') : '')];
            }
        }
        $gamepad = strcasecmp($p['type'], 'Wii U GamePad') === 0;
        $unset = [];
        foreach ($gamepad ? XS_CEMU_GAMEPAD : [] as $m => $label) {
            if (isset($p['map'][$m])) {
                $b = $p['map'][$m];
                $rows[] = ['name' => $label, 'value' => $xin ? (XS_CEMU_XINPUT[$b] ?? 'input ' . $b) : 'input ' . $b];
            } else {
                $rows[] = ['name' => $label, 'value' => 'not set', 'unset' => true];
                $unset[] = $label;
            }
        }
        if (!$gamepad) {
            foreach ($p['map'] as $m => $b) {
                $rows[] = ['name' => 'Control ' . $m, 'value' => $xin ? (XS_CEMU_XINPUT[$b] ?? 'input ' . $b) : 'input ' . $b];
            }
        }
        $note = 'Cemu\'s own profiles: the Wii U control on the left, the pad input on the right.';
        if (in_array('Home', $unset, true) || in_array('Show the GamePad screen', $unset, true)) {
            $note .= ' Home and the GamePad screen are on no button, so no press on the pad reaches them.';
        }
        return ['rows' => $rows, 'source' => ['file' => $file, 'read' => true, 'note' => $note]];
    },
    'leave'    => 'xsegon',
];
