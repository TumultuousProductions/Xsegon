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
    'setup'    => [
        'words' => 'Xsegon writes an input file of its own, Xsegon, with your own player 1 copied to players 2, 3 and 4, each on the next Xbox pad, and hands it to RPCS3 at each launch with --input-config. RPCS3\'s own Default stays as it is.',
        'own'   => static function (string $home, string $exe, ?string &$why): ?array {
            $file = $home . '\\config\\input_configs\\global\\Default.yml';
            $text = (string) @file_get_contents($file);
            // The blocks, "Player N Input:" to the next; player 1's pad copied to 2 to 4.
            $parts = preg_split('/^(?=Player \d Input:)/m', $text) ?: [];
            $blocks = [];
            foreach ($parts as $p) {
                if (preg_match('/^Player (\d) Input:/', $p, $m)) {
                    $blocks[(int) $m[1]] = rtrim($p, "\r\n") . "\n";
                }
            }
            $one = $blocks[1] ?? '';
            if ($one === '') {
                $why = 'RPCS3 has no input settings yet (' . $file . '): open its Pads window once first';
                return null;
            }
            if (!preg_match('/^\s{2}Handler:\s*(SDL|XInput)\s*$/mi', $one) || !preg_match('/^\s{2}Device:\s*XInput Controller \d+\s*$/mi', $one)) {
                $why = 'RPCS3\'s player 1 is not on an Xbox pad through SDL; set the pad once in its Pads window, and Xsegon copies it to players 2 to 4';
                return null;
            }
            $out = '';
            for ($n = 1; $n <= 7; $n++) {
                if ($n <= 4) {
                    $b = (string) preg_replace('/^Player 1 Input:/', 'Player ' . $n . ' Input:', $one);
                    $out .= (string) preg_replace('/^(\s{2}Device:\s*XInput Controller )\d+/mi', '${1}' . $n, $b);
                } elseif (isset($blocks[$n])) {
                    $out .= $blocks[$n];
                }
            }
            return [$home . '\\config\\input_configs\\global\\Xsegon.yml' => $out];
        },
        // Read only with --no-gui, which Xsegon's launches of RPCS3 carry.
        'args'  => static fn(string $home, string $exe): string => '--input-config Xsegon',
    ],
    'leave'    => static function (string $home): string {
        $p1 = xs_rpcs3_player1($home . '\\config\\input_configs\\global\\Default.yml');
        $ps = (string) ($p1['PS Button'] ?? '');
        $on = $ps === 'Guide' ? 'the Xbox button' : ($ps !== '' ? $ps : 'the PS button');
        return 'Press ' . $on . ' (the PS button) for RPCS3\'s home menu, then Exit Game there.';
    },
];
