<?php
/**
 * RPCS3 (PlayStation 3). Everything beside the program.
 * Bindings: config\input_configs\global\Default.yml, a "Player 1 Input: > Config:" block of "Key: Value".
 */
declare(strict_types=1);

/** The "Key: Value" lines of player 1's Config block in an RPCS3 input file. */
function xs_rpcs3_player1(string $file): array
{
    $out = [];
    $in = false;
    foreach (@file($file, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        if (preg_match('/^\s{2}Config:\s*$/', $line)) {
            $in = true;
            continue;
        }
        if ($in && preg_match('/^\s{4}([^:]+):\s*(.+)$/', $line, $m)) {
            $out[trim($m[1])] = trim($m[2], ' "');
            continue;
        }
        if ($in && !preg_match('/^\s{4,}/', $line)) {
            break;
        }
    }
    return $out;
}

return [
    'name'     => 'RPCS3',
    'exes'     => ['rpcs3'],
    'consoles' => ['sony playstation 3'],
    'home'     => static fn(string $dir): string => $dir,
    'controls' => static function (string $home, string $platform): array {
        $file = $home . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'input_configs'
              . DIRECTORY_SEPARATOR . 'global' . DIRECTORY_SEPARATOR . 'Default.yml';
        if (!is_file($file)) {
            return ['rows' => [], 'source' => ['file' => null, 'read' => false,
                    'note' => 'RPCS3 keeps its bindings under config\\input_configs; Pads in its own window has them.']];
        }
        $rows = [];
        foreach (xs_rpcs3_player1($file) as $k => $v) {
            if ($v !== '' && !is_numeric($v)) {
                $rows[] = ['name' => $k, 'value' => $v];
            }
        }
        return ['rows' => $rows, 'source' => ['file' => $file, 'read' => true,
                'note' => 'RPCS3\'s own words: PS3 control on the left, the pad input on the right.']];
    },
    'leave'    => static function (string $home): string {
        $p1 = xs_rpcs3_player1($home . '\\config\\input_configs\\global\\Default.yml');
        $ps = (string) ($p1['PS Button'] ?? '');
        $on = $ps === 'Guide' ? 'the Xbox button' : ($ps !== '' ? $ps : 'the PS button');
        return 'Press ' . $on . ' (the PS button) for RPCS3\'s home menu, then Exit Game there.';
    },
];
