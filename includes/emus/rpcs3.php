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
                    'note' => 'RPCS3 keeps its bindings in ' . $file . ', which is not there; Pads in its own window has them.']];
        }
        if (xs_emus_unreadable($file)) {
            return xs_emus_unread_controls('RPCS3', $file);
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
        'words' => 'Xsegon writes an input file of its own, Xsegon, with your own player 1 copied to players 2, 3 and 4, each on the next Xbox pad, and hands it to RPCS3 at each launch. RPCS3\'s own Default stays as it is.',
        'own'   => static function (string $home, string $exe, ?string &$why): ?array {
            $file = $home . '\\config\\input_configs\\global\\Default.yml';
            if (xs_emus_unreadable($file)) {
                $why = 'RPCS3\'s input settings (' . $file . ') would not read just now; nothing was written';
                return null;
            }
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
        // RPCS3 takes --input-config only beside --no-gui and stops otherwise (rpcs3\main.cpp): none without it.
        'args'  => static function (string $home, string $exe, string $args, ?string &$why): string {
            if (!preg_match('/(^|\s)--no-gui(\s|$)/', $args)) {
                $why = 'Xsegon\'s input file not handed over: RPCS3 reads it only when it starts without its window (--no-gui), which this launch does not have';
                return '';
            }
            return '--input-config Xsegon';
        },
    ],
    'leave'    => static function (string $home): string {
        $file = $home . '\\config\\input_configs\\global\\Default.yml';
        if (!is_file($file)) {
            return 'RPCS3 has no pad set yet (Pads in its window sets one); on a pad, the PS button opens its home menu, with Exit Game there.';
        }
        $ps = (string) (xs_rpcs3_player1($file)['PS Button'] ?? '');
        if ($ps === '' || strcasecmp($ps, 'None') === 0) {
            return 'RPCS3\'s PS button is on no press of your pad, so its home menu, with Exit Game, is reached from the keyboard; Pads in its window sets it.';
        }
        return 'Press ' . ($ps === 'Guide' ? 'the Xbox button' : $ps) . ' (the PS button) for RPCS3\'s home menu, then Exit Game there.';
    },
];
