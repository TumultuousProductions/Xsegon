<?php
// Used by tests\t-emus.js: what includes\emus\ reads for one emulator program, nothing written.
//   php emus-probe.php <exe> [<platform>]     its home, controls and way out
//   php emus-probe.php --keys                 every emulator file's key and program names
//   php emus-probe.php --packs <exe> <title> <rom>      a game's graphic packs, read only
//   php emus-probe.php --codes <exe> <rom>              a game's patches and codes, read only
//   php emus-probe.php --code <exe> <rom> <section> <$Name> <1|0>   one switched (XSEGON_DATA set)
//   php emus-probe.php --round <exe> <rom> <title> <platform>
//                       Set up, a dry start, two starts and Put back, in stand-in folders only:
//                       XSEGON_DATA must name the test's own data folder
declare(strict_types=1);
require __DIR__ . '/../includes/boot.php';
require __DIR__ . '/../includes/emus.php';
if (($argv[1] ?? '') === '--keys') {
    echo json_encode(array_map(static fn(array $e): array => $e['exes'], xs_emus()));
    exit;
}
if (($argv[1] ?? '') === '--codes' || ($argv[1] ?? '') === '--code') {
    // --codes <exe> <rom>: a game's patches and codes; --code <exe> <rom> <section> <$Name> <1|0>: one switched.
    // Switching writes the stand-in's game INI and keeps a copy in XSEGON_DATA, which must be set.
    [, $mode, $exe, $rom] = $argv;
    $e = xs_emu_of($exe);
    $home = xs_emu_home($e, $exe);
    $why = null;
    $ok = null;
    if ($mode === '--code') {
        if ((string) getenv('XSEGON_DATA') === '') {
            exit('{"error":"XSEGON_DATA is not set"}');
        }
        $ok = ($e['codeSwitch'])($home, $exe, [], $rom, $argv[4], $argv[5], $argv[6] === '1', $why);
    }
    echo json_encode(['ok' => $ok, 'why' => $why, 'codes' => ($e['codes'])($home, $exe, [], $rom, $why),
                      'launch' => isset($e['launch']) ? ($e['launch'])($home, $exe, [], $rom) : ''], JSON_UNESCAPED_SLASHES);
    exit;
}
if (($argv[1] ?? '') === '--packs') {
    [, , $exe, $title, $rom] = $argv;
    $e = xs_emu_of($exe);
    $why = null;
    $got = ($e['packs'])(xs_emu_home($e, $exe), $exe, ['title' => $title], $rom, $why);
    echo json_encode(['got' => $got, 'why' => $why], JSON_UNESCAPED_SLASHES);
    exit;
}
if (($argv[1] ?? '') === '--round') {
    if ((string) getenv('XSEGON_DATA') === '') {
        exit('{"error":"XSEGON_DATA is not set"}');
    }
    require __DIR__ . '/../includes/emusetup.php';
    [, , $exe, $rom, $title, $platform] = $argv;
    $e = xs_emu_of($exe);
    $game = ['title' => $title, 'platform' => $platform];
    $launch = ['exe' => $exe, 'rom' => $rom, 'kind' => 'emulator'];
    $out = [];
    $why = null;
    $out['on'] = xs_es_on($e, $exe, $why);
    $out['onWhy'] = $why;
    $texts = static function (array $paths): array {
        $t = [];
        foreach ($paths as $p) {
            $t[$p] = (string) @file_get_contents($p);
        }
        return $t;
    };
    $out['own'] = $texts(array_keys(xs_es_rec($e['key'])['own']));
    $out['dry'] = xs_es_for_launch($game, $launch, false);
    $out['dryGames'] = count(xs_es_rec($e['key'])['games']);
    $out['first'] = xs_es_for_launch($game, $launch);
    $out['second'] = xs_es_for_launch($game, $launch);
    $out['games'] = $texts(array_keys(xs_es_rec($e['key'])['games']));
    $why = null;
    $out['off'] = xs_es_off($e, $exe, $why);
    $out['offWhy'] = $why;
    echo json_encode($out, JSON_UNESCAPED_SLASHES);
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
