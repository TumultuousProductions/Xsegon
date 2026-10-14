<?php
/**
 * /api/pad-keys.php - your keyboard keys per console, for RetroArch
 * (includes\padmap.php has the how).
 *
 *   GET                     the consoles that can have them (the same ones as
 *                           your buttons per console: in the library, run by
 *                           RetroArch, buttons known), each button with
 *                           RetroArch's own key for it and yours; and the
 *                           keys RetroArch keeps for its hotkeys
 *   POST {platform, keys}   keep a console's keys: {console button: key} in
 *                           RetroPad and RetroArch names, the ones that
 *                           differ from RetroArch's own only; {} is
 *                           RetroArch's own keys again
 *
 * Handed to RetroArch at launch, for that run (api\launch.php). RetroArch's
 * own settings file is read, never changed.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/scan.php';
require_once __DIR__ . '/../includes/retroarch.php';
require_once __DIR__ . '/../includes/rahotkeys.php';
require_once __DIR__ . '/../includes/padmap.php';

$layouts = xs_pad_layouts();
// Read once: RetroArch is found from it and the consoles are named from it.
$lib     = xs_library();
$caps    = ra_capabilities($lib);
$raKeys  = $caps['config'] !== null ? xs_ra_read_keys((string) $caps['config']) : [];
$binds   = xs_ra_key_binds($raKeys);
$hot     = xs_ra_hotkey_keys($raKeys);
$padMaps = xs_pad_maps();

/** The console's own name as the library spells it, keyed by lower case. */
$names = [];
foreach ($lib['games'] ?? [] as $g) {
    $p = (string) ($g['platform'] ?? '');
    if ($p !== '') {
        $names[mb_strtolower($p)] = $p;
    }
}

$padOf = static function (string $key) use ($padMaps): array {
    $m = $padMaps[$key] ?? [];
    return is_array($m) && xs_pad_valid($m) ? $m : [];
};

// Every console's keys: kept ones that no longer hold (a hotkey moved in RetroArch since) count as none, as at a launch.
$every = xs_pad_every_keys();
if ($every && !xs_pad_keys_valid($every, xs_pad_every_layout(), [], $binds, $hot)) {
    $every = [];
}
$base = xs_pad_every_binds($binds, $every);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $mine = xs_pad_keys();
    $out = [];
    foreach ($layouts as $key => $buttons) {
        if (!isset($names[$key])) {
            continue;
        }
        $cmd = xs_scan_command($names[$key], 'key-probe');
        if (isset($cmd['error']) || ($cmd['kind'] ?? '') !== 'retroarch') {
            continue;
        }
        // "own" is what the button has without this console's keys: Every console's key, or RetroArch's.
        $view = xs_pad_key_view($buttons, $padOf($key), $base, is_array($mine[$key] ?? null) ? $mine[$key] : []);
        $rows = [];
        foreach ($view as $sends => $v) {
            $pressed = xs_pad_pressed_for($padOf($key), (string) $sends);
            $rows[] = ['name' => $v['name'], 'sends' => $sends, 'own' => $v['own'], 'key' => $v['key'],
                       'every' => ($base[$pressed] ?? 'nul') !== ($binds[$pressed] ?? 'nul')];
        }
        $out[] = ['platform' => $names[$key], 'buttons' => $rows, 'mine' => (object) ($mine[$key] ?? []),
                  'note' => xs_pad_notes()[$key] ?? null];
    }
    usort($out, static fn ($a, $b) => strcasecmp($a['platform'], $b['platform']));
    $rows = [];
    foreach (xs_pad_key_view(xs_pad_every_layout(), [], $binds, $every) as $sends => $v) {
        $rows[] = ['name' => $v['name'], 'sends' => $sends, 'own' => $v['own'], 'key' => $v['key']];
    }
    xs_json(['ok' => true, 'consoles' => $out, 'every' => ['buttons' => $rows, 'mine' => (object) $every],
             'hot' => (object) $hot, 'read' => $caps['config'] !== null]);
}

xs_local_origin_only();
$body     = xs_body();
$platform = trim((string) ($body['platform'] ?? ''));
$keys     = $body['keys'] ?? null;
$key      = mb_strtolower($platform);
$forEvery = !empty($body['every']);

if (!$forEvery && !isset($layouts[$key])) {
    xs_fail('Xsegon does not know ' . ($platform !== '' ? $platform : 'that console') . '\'s buttons yet', 400);
}
if (!is_array($keys)) {
    xs_fail('keys must be a set of console button => key', 400);
}
$why = null;
if ($forEvery) {
    if (!xs_pad_keys_valid($keys, xs_pad_every_layout(), [], $binds, $hot, $why)) {
        xs_fail((string) $why, 400);
    }
    // A console with keys of its own must not end up with two buttons on one key because of this.
    $clash = xs_pad_every_clash(array_map(static fn ($k) => xs_ra_key_norm((string) $k), $keys), $every, $binds, $hot);
    if ($clash !== null) {
        xs_fail('On ' . ($names[$clash['console']] ?? $clash['console']) . ', which has keys of its own, ' . $clash['why']
            . '. Change that console\'s keys first, or choose another key', 400);
    }
    $key = XS_PAD_EVERY;
} elseif (!xs_pad_keys_valid($keys, $layouts[$key], $padOf($key), $base, $hot, $why)) {
    xs_fail((string) $why, 400);
}
$keep = [];
foreach ($keys as $sends => $k) {
    $keep[(string) $sends] = xs_ra_key_norm((string) $k);
}

$all = xs_pad_keys();
if ($keep) {
    $all[$key] = $keep;
} else {
    unset($all[$key]);
}
xs_write_or_fail(xs_data_path('pad-keys.json'), $all ?: new stdClass());

$said = [];
foreach ($keep as $sends => $k) {
    $said[] = $sends . '=' . $k;
}
$whose = $forEvery ? 'Every console' : ($names[$key] ?? $platform);
xs_log('PADS', $whose . ' keys: ' . ($said ? implode(' ', $said) : ($forEvery || !$every ? 'RetroArch\'s own' : 'Every console\'s')));
xs_json(['ok' => true, 'platform' => $whose, 'keys' => (object) $keep]);
