<?php
// Used by tests\t-emus.js: what includes\emus\ reads for one emulator program, nothing written.
//   php emus-probe.php <exe> [<platform>]     its home, controls and way out
//   php emus-probe.php --keys                 every emulator file's key and program names
declare(strict_types=1);
require __DIR__ . '/../includes/boot.php';
require __DIR__ . '/../includes/emus.php';
if (($argv[1] ?? '') === '--keys') {
    echo json_encode(array_map(static fn(array $e): array => $e['exes'], xs_emus()));
    exit;
}
$exe = (string) ($argv[1] ?? '');
$e = xs_emu_of($exe);
if ($e === null) {
    echo json_encode(['known' => false]);
    exit;
}
$home = xs_emu_home($e, $exe);
echo json_encode(['known' => true, 'key' => $e['key'], 'name' => $e['name'], 'home' => $home,
                  'controls' => ($e['controls'])($home, (string) ($argv[2] ?? '')), 'leave' => xs_emu_leave($e, $home)],
                 JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
