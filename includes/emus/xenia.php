<?php
/**
 * Xenia Canary (Xbox 360). Portable by default on Windows: everything beside the program.
 * No per-button file: the [HID] hid setting picks how pads are read, and an Xbox pad is the 360 pad.
 */
declare(strict_types=1);

return [
    'name'     => 'Xenia',
    'exes'     => ['xenia_canary', 'xenia'],
    'consoles' => ['microsoft xbox 360'],
    'home'     => static fn(string $dir): string => $dir,
    'controls' => static function (string $home, string $platform): array {
        $file = '';
        foreach (['xenia-canary.config.toml', 'xenia.config.toml'] as $f) {
            if (is_file($home . DIRECTORY_SEPARATOR . $f)) {
                $file = $home . DIRECTORY_SEPARATOR . $f;
                break;
            }
        }
        if ($file === '') {
            return ['rows' => [], 'source' => ['file' => null, 'read' => false,
                    'note' => 'Xenia has written no settings file yet; it reads an Xbox pad as the 360 pad, button for button.']];
        }
        if (xs_emus_unreadable($file)) {
            return xs_emus_unread_controls('Xenia', $file);
        }
        $hid = strtolower((string) (xs_emus_toml_value($file, 'HID', 'hid') ?? 'any'));
        // "any" tries SDL first, as Canary's own start-up does (app\xenia_main.cc).
        $how = ['any' => 'SDL', 'sdl' => 'SDL', 'xinput' => 'XInput', 'keyboard' => 'the keyboard only', 'winkey' => 'the keyboard only', 'nop' => 'nothing'][$hid] ?? $hid;
        $rows = [['name' => 'Pads read through', 'value' => $how . ' (hid = "' . $hid . '")']];
        $note = in_array($hid, ['any', 'sdl', 'xinput'], true)
            ? 'Xenia has no button screen: an Xbox pad is the Xbox 360 pad, button for button, and pads are players 1 to 4 in the order they were plugged in.'
            : 'Xenia reads no pad with this setting; hid in its settings file changes that.';
        return ['rows' => $rows, 'source' => ['file' => $file, 'read' => true, 'note' => $note]];
    },
    'leave'    => 'xsegon',
    'setupNone' => 'Xenia reads an Xbox pad as the Xbox 360 pad, button for button, players 1 to 4 in the order the pads were plugged in.',
];
