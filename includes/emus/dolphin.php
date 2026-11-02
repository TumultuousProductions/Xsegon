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
];
