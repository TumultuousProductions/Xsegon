<?php
/**
 * GET /api/sounds.php - the sound packs on this PC: which are in Xsegon's own
 * folder, and which ship with Xsegon (includes\sounds.php). Nothing here copies a pack.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/sounds.php';

$s = xs_settings();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    xs_local_origin_only();
    xs_fail('unknown action', 400);
}

$own = xs_sound_packs_own();
$packs = [];
$dirs = xs_sound_pack_dirs($s);
$builtinAt = xs_sounds_builtin_pack();
$builtins = xs_sounds_builtin_packs();
foreach ($dirs as $name => $dir) {
    if ($dir === xs_own_dir()) {
        continue;                       // your own sounds are not a pack
    }
    $w = xs_sounds_weigh($dir);
    $packs[] = [
        'name'  => $name,
        'mine'  => in_array($name, $own, true),
        // a set that ships with Xsegon (sounds\Xsegon, sounds\Xsegon 2),
        // when nothing of the same name in data\sounds stands in front of it
        'builtin' => ($builtins[$name] ?? null) === $dir,
        'files' => $w['files'],
        'bytes' => $w['bytes'],
    ];
}

xs_json([
    'ok'        => true,
    'folder'    => xs_sounds_dir(),
    'packs'     => $packs,
    'mine'      => count($own),
    'using'     => (string) $s['sound']['soundSet'],
    // The chosen set is not on this PC, so the built-in one plays in its
    // place (api\sound.php); null when the chosen set is here.
    'standIn'   => !isset($dirs[(string) $s['sound']['soundSet']]) && $builtinAt !== '' ? XS_SOUND_BUILTIN : null,
]);
