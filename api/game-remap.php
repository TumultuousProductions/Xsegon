<?php
/**
 * /api/game-remap.php - one game's own buttons and turbo, over its console's.
 *
 *   GET ?id=<game>       that game's buttons: the console's layout, the
 *                        console's map (what the game starts from), the
 *                        game's own map and whether it HAS one (own), whether
 *                        a game remap made in RetroArch itself exists (yours
 *                        takes its place at launch, and the screen says so),
 *                        and the game's own turbo choice beside the words of
 *                        the one it would otherwise follow
 *   POST {id, map?, turbo?}  keep a game's buttons and its turbo. map is
 *                        {pressed: sent} in RetroPad names, the moved ones
 *                        only; {} keeps the game STANDARD on purpose,
 *                        whatever its console's buttons are; null takes the
 *                        game's own away, so it follows its console again.
 *                        turbo is {set: "off"} or {set: "on", mode, bind,
 *                        period} (includes\rahotkeys.php), and null means
 *                        the same as everywhere again
 *
 * RetroArch reads a game's remap INSTEAD of the core's, so the map kept here
 * is the whole picture, stored against the standard layout. The file
 * RetroArch reads is written at launch (includes\padmap.php).
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/padmap.php';
require_once __DIR__ . '/../includes/retroarch.php';
require_once __DIR__ . '/../includes/rahotkeys.php';

/** The game, its console's layout, and why not when there is none. */
function xs_game_remap_find(string $id, ?array &$game, ?array &$buttons, ?string &$why): bool
{
    $game = xs_game($id);
    if ($game === null) {
        $why = 'unknown game';
        return false;
    }
    if (($game['launch']['kind'] ?? '') !== 'retroarch') {
        $why = 'only a RetroArch game\'s buttons can be set here';
        return false;
    }
    $buttons = xs_pad_layouts()[mb_strtolower((string) $game['platform'])] ?? null;
    if ($buttons === null) {
        $why = 'Xsegon does not know ' . $game['platform'] . '\'s buttons yet';
        return false;
    }
    return true;
}

/** Does a game remap made in RetroArch itself exist for this game? */
function xs_game_remap_theirs(array $game): bool
{
    $launch = $game['launch'];
    $exe    = (string) ($launch['exe'] ?? '');
    $raDir  = dirname($exe);
    if (!preg_match('/-L\s+"?([^"]+_libretro\.dll)"?/i', (string) ($launch['args'] ?? ''), $cm)) {
        return false;
    }
    $stem = strtolower((string) preg_replace('/[^a-z0-9]+/i', '', basename($cm[1], '_libretro.dll')));
    $base = xs_pad_game_base((string) ($launch['rom'] ?? ''));
    if ($base === '') {
        return false;
    }
    $root = $raDir . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'remaps';
    foreach (@scandir($root) ?: [] as $d) {
        if ($d !== '.' && $d !== '..' && is_dir($root . DIRECTORY_SEPARATOR . $d)
            && strtolower((string) preg_replace('/[^a-z0-9]+/i', '', $d)) === $stem) {
            return is_file($root . DIRECTORY_SEPARATOR . $d . DIRECTORY_SEPARATOR . $base . '.rmp');
        }
    }
    return false;
}

/** The game's own turbo as kept, or null. */
function xs_game_remap_turbo(string $id): ?array
{
    $t = xs_game_hotkeys()[$id]['turbo'] ?? null;
    return is_array($t) && xs_ra_turbo_valid($t) ? $t : null;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $id = trim((string) ($_GET['id'] ?? ''));
    $game = null;
    $buttons = null;
    $why = null;
    if (!xs_game_remap_find($id, $game, $buttons, $why)) {
        xs_fail((string) $why, $why === 'unknown game' ? 404 : 409);
    }
    $own    = xs_game_map($id);
    $global = xs_ra_turbo_choice();
    xs_json(['ok' => true, 'id' => $id, 'title' => $game['title'], 'platform' => $game['platform'],
             'buttons' => array_map(static fn($b) => ['name' => $b[0], 'sends' => $b[1]], $buttons),
             'ids'     => XS_PAD_IDS,
             'pad'     => xs_ra_retropad_names(),
             'console' => (object) (xs_pad_maps()[mb_strtolower((string) $game['platform'])] ?? []),
             // own: it has buttons of its own; map {} with own true is the
             // standard layout kept on purpose
             'own'     => $own !== null,
             'map'     => (object) ($own ?? []),
             'theirs'  => xs_game_remap_theirs($game),
             // the game's own turbo, and what it follows with none of its own
             'turbo'   => xs_game_remap_turbo($id),
             'everywhere' => $global !== null ? xs_ra_turbo_choice_words($global) : 'RetroArch\'s own setting']);
}

$body = xs_body();
$id   = trim((string) ($body['id'] ?? ''));
$game = null;
$buttons = null;
$why = null;
if (!xs_game_remap_find($id, $game, $buttons, $why)) {
    xs_fail((string) $why, $why === 'unknown game' ? 404 : 409);
}
if (!array_key_exists('map', $body) && !array_key_exists('turbo', $body)) {
    xs_fail('nothing to change: send map or turbo', 400);
}

// Both checked before either is written, so a refusal changes nothing.
$map = null;
if (array_key_exists('map', $body)) {
    $map = $body['map'];
    if ($map !== null && !is_array($map)) {
        xs_fail('map must be a set of pressed => sent buttons, or null for the console\'s', 400);
    }
    if ($map !== null && !xs_pad_valid($map, $why)) {
        xs_fail((string) $why, 400);
    }
}
$turbo = null;
if (array_key_exists('turbo', $body)) {
    $turbo = $body['turbo'];
    if ($turbo !== null && (!is_array($turbo) || !xs_ra_turbo_valid($turbo, $why))) {
        xs_fail((string) ($why ?: 'not a turbo choice this page knows'), 400);
    }
}

if (array_key_exists('map', $body)) {
    $all = xs_game_maps();
    if ($map === null) {
        unset($all[$id]);
    } else {
        $all[$id] = $map;
    }
    xs_write_or_fail(xs_data_path('game-remaps.json'), $all);
    $said = [];
    foreach ($map ?? [] as $from => $to) {
        $said[] = $from . '>' . $to;
    }
    xs_log('PADS', 'game ' . $game['title'] . ': ' . ($map === null ? 'back to the console\'s'
        : ($said ? implode(' ', $said) : 'the standard layout, whatever the console\'s')));
}

if (array_key_exists('turbo', $body)) {
    $all = xs_game_hotkeys();
    if ($turbo === null) {
        unset($all[$id]['turbo']);
        if (empty($all[$id])) {
            unset($all[$id]);
        }
    } else {
        $kept = ['set' => $turbo['set']];
        if ($turbo['set'] === 'on') {
            $kept['mode']   = (int) $turbo['mode'];
            $kept['bind']   = isset($turbo['bind']) ? (int) $turbo['bind'] : null;
            $kept['period'] = isset($turbo['period']) ? (int) $turbo['period'] : null;
        }
        $all[$id]['turbo'] = $kept;
    }
    xs_write_or_fail(xs_data_path('game-hotkeys.json'), $all);
    xs_log('HOTK', 'game ' . $game['title'] . ': turbo=' . ($turbo === null ? 'as everywhere' : xs_ra_turbo_choice_words($turbo)));
}

$own = xs_game_map($id);
xs_json(['ok' => true, 'id' => $id, 'own' => $own !== null, 'map' => (object) ($own ?? []),
         'turbo' => xs_game_remap_turbo($id)]);
