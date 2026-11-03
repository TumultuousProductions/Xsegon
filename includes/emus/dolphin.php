<?php
/**
 * Dolphin (GameCube, Wii). Portable with portable.txt (User\ beside it), else Documents or AppData.
 * Bindings: User\Config\GCPadNew.ini and WiimoteNew.ini, "Group/Control = expression" under
 * a device such as XInput/0/Gamepad; an input the device does not have binds nothing.
 */
declare(strict_types=1);

// The inputs Dolphin gives an XInput pad (InputCommon\ControllerInterface\XInput\XInput.cpp).
const XS_DOLPHIN_XINPUT = ['Button A', 'Button B', 'Button X', 'Button Y', 'Pad N', 'Pad S', 'Pad W', 'Pad E',
    'Start', 'Back', 'Shoulder L', 'Shoulder R', 'Guide', 'Thumb L', 'Thumb R', 'Trigger L', 'Trigger R',
    'Left X-', 'Left X+', 'Left Y-', 'Left Y+', 'Right X-', 'Right X+', 'Right Y-', 'Right Y+',
    'Motor L', 'Motor R', 'Battery'];

/** The inputs of an expression that the pad named in Device does not have. Another device's (qualified) are not judged. */
function xs_dolphin_missing(string $expr): array
{
    $out = [];
    preg_match_all('/`([^`]*)`|([A-Za-z][A-Za-z0-9_]*)/', $expr, $m, PREG_SET_ORDER);
    foreach ($m as $t) {
        $name = $t[1] !== '' ? $t[1] : ($t[2] ?? '');
        if ($name === '' || str_contains($name, ':')) {
            continue;
        }
        if (!in_array($name, XS_DOLPHIN_XINPUT, true)) {
            $out[] = $name;
        }
    }
    return array_values(array_unique($out));
}

// A GameCube pad on an Xbox pad as Dolphin itself ships it (Sys\Profiles\GCPad\SDL Gamepad.ini, 2512).
const XS_DOLPHIN_GCPAD = ['Buttons/A' => '`Button A`', 'Buttons/B' => '`Button B`', 'Buttons/X' => '`Button X`', 'Buttons/Y' => '`Button Y`',
    'Buttons/Z' => '`Shoulder R`', 'Buttons/Start' => '`Start`',
    'Main Stick/Up' => '`Left Y+`', 'Main Stick/Down' => '`Left Y-`', 'Main Stick/Left' => '`Left X-`', 'Main Stick/Right' => '`Left X+`',
    'C-Stick/Up' => '`Right Y+`', 'C-Stick/Down' => '`Right Y-`', 'C-Stick/Left' => '`Right X-`', 'C-Stick/Right' => '`Right X+`',
    'Triggers/L' => '`Trigger L`', 'Triggers/R' => '`Trigger R`', 'Triggers/L-Analog' => '`Trigger L`', 'Triggers/R-Analog' => '`Trigger R`',
    'D-Pad/Up' => '`Pad N`', 'D-Pad/Down' => '`Pad S`', 'D-Pad/Left' => '`Pad W`', 'D-Pad/Right' => '`Pad E`', 'Rumble/Motor' => '`Motor L` | `Motor R`'];

// A Wii Remote and Nunchuk on an Xbox pad, for a Dolphin that has none set: the pointer on the right stick.
const XS_DOLPHIN_WIIMOTE = ['Buttons/A' => '`Button A`', 'Buttons/B' => '`Button B`', 'Buttons/1' => '`Button Y`', 'Buttons/2' => '`Button X`',
    'Buttons/-' => '`Back`', 'Buttons/+' => '`Start`', 'Buttons/Home' => '`Guide`',
    'D-Pad/Up' => '`Pad N`', 'D-Pad/Down' => '`Pad S`', 'D-Pad/Left' => '`Pad W`', 'D-Pad/Right' => '`Pad E`',
    'IR/Up' => '`Right Y+`', 'IR/Down' => '`Right Y-`', 'IR/Left' => '`Right X-`', 'IR/Right' => '`Right X+`',
    'Shake/X' => '`Shoulder R`', 'Shake/Y' => '`Shoulder R`', 'Shake/Z' => '`Shoulder R`', 'Extension' => 'Nunchuk',
    'Nunchuk/Buttons/C' => '`Shoulder L`', 'Nunchuk/Buttons/Z' => '`Trigger L`',
    'Nunchuk/Stick/Up' => '`Left Y+`', 'Nunchuk/Stick/Down' => '`Left Y-`', 'Nunchuk/Stick/Left' => '`Left X-`', 'Nunchuk/Stick/Right' => '`Left X+`'];

// Names an older Dolphin or a hand wrote that this one does not know, as it names the same input.
const XS_DOLPHIN_RENAME = ['Button BACK' => 'Back', 'Button START' => 'Start', 'Button GUIDE' => 'Guide'];

/** A profile file: [Profile], the pad as Device, then the bindings written as given (Dolphin's backticks in them). */
function xs_dolphin_profile(int $pad, array $bind): string
{
    $out = ['[Profile]', 'Device = XInput/' . $pad . '/Gamepad'];
    foreach ($bind as $k => $v) {
        $out[] = $k . ' = ' . $v;
    }
    return implode("\r\n", $out) . "\r\n";
}

/** The person's own Wii Remote 1 as a profile's bindings, the names Dolphin does not know put right; null when none is set. */
function xs_dolphin_own_wiimote(string $home): ?array
{
    $sec = xs_emus_ini_section($home . '\\Config\\WiimoteNew.ini', 'Wiimote1', true);
    if (stripos((string) ($sec['Device'] ?? ''), 'XInput/') !== 0) {
        return null;
    }
    $out = [];
    foreach ($sec as $k => $raw) {
        if ($k === 'Device' || $k === 'Source') {
            continue;
        }
        $fix = [];
        foreach (XS_DOLPHIN_RENAME as $from => $to) {
            $fix['`' . $from . '`'] = '`' . $to . '`';
        }
        $out[$k] = strtr($raw, $fix);
    }
    return $out;
}

return [
    'name'     => 'Dolphin',
    'exes'     => ['dolphin'],
    'consoles' => ['nintendo gamecube', 'nintendo wii'],
    'home'     => static function (string $dir): string {
        if (is_file($dir . '\\portable.txt')) {
            return $dir . '\\User';
        }
        $docs = xs_emus_docs('Dolphin Emulator');
        return is_dir($docs) ? $docs : xs_emus_appdata('Dolphin Emulator');
    },
    'controls' => static function (string $home, string $platform): array {
        $wii  = stripos($platform, 'wii') !== false && stripos($platform, 'gamecube') === false;
        $file = $home . DIRECTORY_SEPARATOR . 'Config' . DIRECTORY_SEPARATOR . ($wii ? 'WiimoteNew.ini' : 'GCPadNew.ini');
        if (!is_file($file)) {
            return ['rows' => [], 'source' => ['file' => null, 'read' => false,
                    'note' => 'Dolphin keeps its bindings in ' . $file . ', which is not there; its Controllers screen has them.']];
        }
        $sec  = xs_emus_ini_section($file, $wii ? 'Wiimote1' : 'GCPad1', true);
        $pad  = stripos((string) ($sec['Device'] ?? ''), 'XInput/') === 0;
        $rows = [];
        $dead = 0;
        foreach ($sec as $k => $raw) {
            if (stripos($k, 'Calibration') !== false || stripos($k, 'Dead Zone') !== false) {
                continue;
            }
            $row = ['name' => $k, 'value' => trim($raw, '`"')];
            // Pointing, motion and shaking are a Wii Remote's own; a pad never has them, so only buttons and sticks are judged.
            $judged = $pad && $k !== 'Device' && str_contains($k, '/') && !preg_match('~(^|/)(IR|IMU|Tilt|Swing|Shake)~', $k);
            $gone = $judged ? xs_dolphin_missing($raw) : [];
            if ($gone) {
                $row['flag'] = 'Does nothing: this pad has no input named ' . implode(' or ', $gone) . ' in Dolphin.';
                $dead++;
            }
            $rows[] = $row;
        }
        $note = 'Dolphin\'s own words: the left side is the console\'s control, the right the pad or key it listens to.';
        if ($dead) {
            $note .= ' ' . $dead . ($dead === 1 ? ' binding names' : ' bindings name') . ' an input the pad does not have, so '
                   . ($dead === 1 ? 'it does' : 'they do') . ' nothing; Dolphin\'s Controllers screen sets ' . ($dead === 1 ? 'it' : 'them') . ' again.';
        }
        return ['rows' => $rows, 'source' => ['file' => $file, 'read' => true, 'note' => $note]];
    },
    'leave'    => 'xsegon',
    'setup'    => [
        'words' => 'Xsegon writes profiles of its own, Xsegon Player 1 to 4, one pad each: the GameCube pad as Dolphin ships it for an Xbox pad, and your own Wii Remote and Nunchuk with any name Dolphin does not know put right. Each game gets them in its own settings file the first time Xsegon starts it. Dolphin\'s own controller settings stay as they are.',
        'own'   => static function (string $home, string $exe, ?string &$why): ?array {
            if (!is_dir($home . '\\Config')) {
                $why = 'Dolphin has no settings folder yet (' . $home . '\\Config): open Dolphin once first';
                return null;
            }
            $wii = xs_dolphin_own_wiimote($home) ?? XS_DOLPHIN_WIIMOTE;
            $out = [];
            for ($n = 1; $n <= 4; $n++) {
                $out[$home . '\\Config\\Profiles\\GCPad\\Xsegon Player ' . $n . '.ini'] = xs_dolphin_profile($n - 1, XS_DOLPHIN_GCPAD);
                $out[$home . '\\Config\\Profiles\\Wiimote\\Xsegon Player ' . $n . '.ini'] = xs_dolphin_profile($n - 1, $wii);
            }
            return $out;
        },
        'game'  => static function (string $home, string $exe, array $game, string $rom, ?string &$why): ?array {
            require_once __DIR__ . '/../fanprojects.php';
            $ids = xs_fan_disc_ids($rom);
            $id = $ids['ids'][0] ?? '';
            if (!preg_match('/^[A-Z0-9]{6}$/', $id)) {
                $why = 'the disc\'s ID could not be read from ' . basename($rom);
                return null;
            }
            $wii = stripos((string) ($game['platform'] ?? ''), 'wii') !== false;
            $set = [];
            for ($n = 1; $n <= 4; $n++) {
                $set[($wii ? 'WiimoteProfile' : 'PadProfile') . $n] = 'Xsegon Player ' . $n;
            }
            return ['file' => $home . '\\GameSettings\\' . $id . '.ini', 'section' => 'Controls', 'set' => $set];
        },
    ],
];
