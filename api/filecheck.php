<?php
/**
 * /api/filecheck.php - the file check (includes\filecheck.php): what each
 * game's file really is, by checksum. Files are read and never changed.
 *
 *   GET   every game of a console that can be checked, with the answer kept
 *         for it or null. Reads no game file.
 *   GET   ?id=..   one game: whether its console can be checked, and its answer.
 *   POST  {"ids":[..]}   checks those files now, as many as fit in a second
 *         or two, and says which are left: the page asks again for the rest,
 *         so the server is never away for long.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/filecheck.php';

$games = xs_library()['games'] ?? [];

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    $id = trim((string) ($_GET['id'] ?? ''));
    if ($id !== '') {
        foreach ($games as $g) {
            if ($g['id'] === $id) {
                xs_json(['ok' => true] + xs_fc_for($g));
            }
        }
        xs_fail('unknown game', 404);
    }
    $kept = xs_fc_all();
    $rows = [];
    foreach ($games as $g) {
        if (!empty($g['local']) || !xs_fc_can((string) $g['platform'])) {
            continue;
        }
        $rows[] = ['id' => $g['id'], 'title' => $g['title'], 'platform' => $g['platform'],
                   'file' => basename(str_replace('\\', '/', (string) ($g['romPath'] ?? ''))),
                   'check' => xs_fc_view($g, $kept[$g['id']] ?? null)];
    }
    xs_json(['ok' => true, 'games' => $rows]);
}

$body = xs_body();
$ids = array_values(array_filter(array_map('strval', (array) ($body['ids'] ?? [])),
    static fn(string $id): bool => xs_game_id_ok($id)));
if (!$ids) {
    xs_fail('say which games: ids');
}
$byId = [];
foreach ($games as $g) {
    $byId[$g['id']] = $g;
}
$done = [];
$failed = [];
$left = [];
$until = microtime(true) + XS_FC_SECONDS;
foreach ($ids as $i => $id) {
    // Always one, then as many as the time allows.
    if ($i > 0 && microtime(true) > $until) {
        $left = array_slice($ids, $i);
        break;
    }
    if (!isset($byId[$id])) {
        $failed[$id] = 'unknown game';
        continue;
    }
    $rec = xs_fc_check($byId[$id], $why);
    if ($rec === null) {
        $failed[$id] = (string) $why;
        continue;
    }
    $done[$id] = xs_fc_view($byId[$id], $rec);
}
xs_json(['ok' => true, 'done' => (object) $done, 'failed' => (object) $failed, 'left' => $left]);
