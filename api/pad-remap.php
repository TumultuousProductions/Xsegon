<?php
/**
 * /api/pad-remap.php - your buttons per console, for RetroArch.
 *
 *   GET                        the consoles that can have them: those in the
 *                              library that RetroArch runs and whose buttons
 *                              Xsegon knows (includes\padmap.php), each with
 *                              its buttons and the ones you moved
 *   POST {platform, map}       keep a console's buttons; map is
 *                              {pressed: sent} in RetroPad names, the moved
 *                              ones only, and {} is the standard layout again
 *   POST {platform, player, map}   the same for player 2, 3 or 4 alone:
 *                              a map, {} too, is that player's own; null
 *                              puts them back with player 1
 *
 * The file RetroArch reads is written at launch, not here (api\launch.php).
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/scan.php';
require_once __DIR__ . '/../includes/padmap.php';

$layouts = xs_pad_layouts();

/** The console's own name as the library spells it, keyed by lower case. */
$names = [];
foreach (xs_library()['games'] ?? [] as $g) {
    $p = (string) ($g['platform'] ?? '');
    if ($p !== '') {
        $names[mb_strtolower($p)] = $p;
    }
}

/** Does RetroArch run this console, as the emulator table has it? */
$viaRetroArch = static function (string $platform): bool {
    $cmd = xs_scan_command($platform, 'pad-probe');
    return !isset($cmd['error']) && ($cmd['kind'] ?? '') === 'retroarch';
};

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $maps = xs_pad_maps();
    $out = [];
    foreach ($layouts as $key => $buttons) {
        if (!isset($names[$key]) || !$viaRetroArch($names[$key])) {
            continue;
        }
        $out[] = ['platform' => $names[$key],
                  'buttons'  => array_map(static fn($b) => ['name' => $b[0], 'sends' => $b[1]], $buttons),
                  'map'      => (object) ($maps[$key] ?? []),
                  // players 2 to 4 with their own buttons; the rest have player 1's, the map above
                  'players'  => (object) array_map(static fn($m) => (object) $m, xs_pad_players($key)),
                  'note'     => xs_pad_notes()[$key] ?? null];
    }
    usort($out, static fn($a, $b) => strcasecmp($a['platform'], $b['platform']));
    xs_json(['ok' => true, 'consoles' => $out, 'ids' => XS_PAD_IDS, 'most' => XS_PAD_PLAYERS]);
}

$body     = xs_body();
$platform = trim((string) ($body['platform'] ?? ''));
$map      = $body['map'] ?? null;
$player   = $body['player'] ?? 1;
$key      = mb_strtolower($platform);

if (!isset($layouts[$key])) {
    xs_fail('Xsegon does not know ' . ($platform !== '' ? $platform : 'that console') . '\'s buttons yet', 400);
}
if (!is_int($player) || $player < 1 || $player > XS_PAD_PLAYERS) {
    xs_fail('player must be a number from 1 to ' . XS_PAD_PLAYERS, 400);
}
$follow = $player > 1 && array_key_exists('map', $body) && $map === null;       // back with player 1
if (!$follow) {
    if (!is_array($map)) {
        xs_fail('map must be a set of pressed => sent buttons', 400);
    }
    $why = null;
    if (!xs_pad_valid($map, $why)) {
        xs_fail((string) $why, 400);
    }
}

$said = [];
foreach ($follow ? [] : $map as $from => $to) {
    $said[] = $from . '>' . $to;
}
$name = $names[$key] ?? $platform;

if ($player > 1) {
    $all = xs_pad_player_maps();
    $mine = is_array($all[$key] ?? null) ? $all[$key] : [];
    if ($follow) {
        unset($mine[$player]);
    } else {
        $mine[$player] = $map;                  // an empty one is kept: the standard layout on purpose
    }
    if ($mine) {
        $all[$key] = $mine;
    } else {
        unset($all[$key]);
    }
    xs_write_or_fail(xs_data_path('player-remaps.json'), $all);
    xs_log('PADS', $name . ' player ' . $player . ': '
        . ($follow ? 'the same as player 1 again' : ($said ? implode(' ', $said) : 'standard layout') . ', their own'));
    xs_json(['ok' => true, 'platform' => $name, 'player' => $player, 'own' => !$follow, 'map' => $follow ? null : (object) $map]);
}

$path = xs_data_path('pad-remaps.json');
$all  = xs_pad_maps();
if ($map) {
    $all[$key] = $map;
} else {
    unset($all[$key]);
}
xs_write_or_fail($path, $all);

xs_log('PADS', $name . ': ' . ($said ? implode(' ', $said) : 'standard layout'));
xs_json(['ok' => true, 'platform' => $name, 'map' => (object) $map]);
