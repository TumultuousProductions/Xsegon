<?php
/**
 * xemu (original Xbox). Portable with xemu.toml beside it, else %APPDATA%\xemu\xemu.
 * [input.bindings] says which pad sits in which port; [input] gamepad_mappings holds xemu's own button changes.
 */
declare(strict_types=1);

return [
    'name'     => 'xemu',
    'exes'     => ['xemu'],
    'consoles' => ['microsoft xbox', 'xbox'],
    'home'     => static fn(string $dir): string => is_file($dir . '\\xemu.toml') ? $dir : xs_emus_appdata('xemu\\xemu'),
    'controls' => static function (string $home, string $platform): array {
        $file = $home . DIRECTORY_SEPARATOR . 'xemu.toml';
        if (!is_file($file)) {
            return ['rows' => [], 'source' => ['file' => null, 'read' => false,
                    'note' => 'xemu drives a standard pad by itself, the Xbox controller one to one; there is no settings file to read yet.']];
        }
        $text = (string) @file_get_contents($file);
        $rows = [];
        $in = false;
        foreach (preg_split('/\R/', $text) ?: [] as $line) {
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
        // xemu 0.8.134 and later keep button changes per pad, as controller_mapping tables.
        $changed = preg_match_all('/controller_mapping/i', $text);
        $note = 'xemu drives a standard pad by itself: the Xbox controller maps one to one, and xemu.toml records which pad sits in which port.'
              . ($changed ? ' It also holds button changes for ' . $changed . ($changed === 1 ? ' pad' : ' pads') . ', made in xemu\'s Input settings.' : '');
        return ['rows' => $rows, 'source' => ['file' => $file, 'read' => true, 'note' => $note]];
    },
    'leave'    => static fn(string $home): string =>
        'Press the Xbox button, or Back and Start together, for xemu\'s menu, then Exit there.',
];
