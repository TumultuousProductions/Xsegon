<?php
/**
 * PCSX2 (PlayStation 2). Portable with portable.ini or portable.txt beside it, else in Documents\PCSX2.
 * Bindings are inis\PCSX2.ini's [Pad1]: "SDL-0/FaceSouth", the number being SDL's for that pad today.
 */
declare(strict_types=1);

return [
    'name'     => 'PCSX2',
    'exes'     => ['pcsx2-qt', 'pcsx2'],
    'consoles' => ['sony playstation 2'],
    'home'     => static fn(string $dir): string =>
        is_file($dir . '\\portable.ini') || is_file($dir . '\\portable.txt') ? $dir : xs_emus_docs('PCSX2'),
    'controls' => static function (string $home, string $platform): array {
        $file = $home . DIRECTORY_SEPARATOR . 'inis' . DIRECTORY_SEPARATOR . 'PCSX2.ini';
        if (!is_file($file)) {
            return ['rows' => [], 'source' => ['file' => null, 'read' => false,
                    'note' => 'PCSX2 keeps its bindings in inis\\PCSX2.ini, which is not there; Settings > Controllers has them.']];
        }
        $rows = [];
        foreach (xs_emus_ini_section($file, 'Pad1') as $k => $v) {
            // Bindings look like "SDL-0/FaceNorth"; the rest of the section is tuning numbers.
            if ($k === 'Type' || str_contains($v, '/')) {
                $rows[] = ['name' => $k, 'value' => $v];
            }
        }
        return ['rows' => $rows, 'source' => ['file' => $file, 'read' => true,
                'note' => 'PCSX2\'s own words: DualShock button on the left, the pad input it listens to on the right.']];
    },
    'leave'    => 'xsegon',
    'setupLater' => 'Not yet: PCSX2 names a pad by SDL\'s number for it that day (SDL-0 one day, SDL-3 another), so a profile written once could point at the wrong pad. Your own bindings in PCSX2 are what its games use.',
];
