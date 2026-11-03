<?php
/**
 * /api/emupacks.php?id=<game> - the packs a standalone emulator has for one game, read only
 * (each emulator's file in includes\emus\ says how, under 'packs'). Cemu's graphic packs
 * first (roadmap CA18): which fit the game and which are on, switched in Cemu itself.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/emus.php';

$game = xs_game_or_404(xs_id_or_fail($_GET['id'] ?? ''));
$open = xs_emu_alone($game);                      // the program as the table has it today
if (isset($open['error'])) {
    xs_json(['ok' => true, 'has' => false, 'why' => $open['error']]);
}
$e = xs_emu_of((string) $open['exe']);
if ($e === null || !isset($e['packs'])) {
    xs_json(['ok' => true, 'has' => false, 'why' => $open['name'] . ' has no packs Xsegon reads']);
}
$why = null;
$got = ($e['packs'])(xs_emu_home($e, (string) $open['exe']), (string) $open['exe'], $game, (string) ($game['launch']['rom'] ?? ''), $why);
xs_log('PACK', $game['title'] . ' in ' . $e['name'] . ': ' . ($got === null ? 'none read: ' . $why : count($got['packs']) . ' pack(s), title ' . $got['titleId']));
xs_json(['ok' => true, 'has' => $got !== null, 'emu' => $e['name'], 'why' => $why] + ($got ?? []));
