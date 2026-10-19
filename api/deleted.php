<?php
/**
 * /api/deleted.php - games taken out of the library on purpose.
 *
 *   GET                              what has been taken out, oldest first
 *   GET  ?missing=1                  every game whose file is not on the
 *                                    disk: what the tidy-up screen offers
 *   POST {"action":"delete","ids":[...],"confirm":"<n>"}
 *                                    take them out. `confirm` must equal the
 *                                    number of ids
 *   POST {"action":"restore","id"}   put one back
 *
 * NOTHING HERE TOUCHES A FILE ON THE DISK. See includes\deleted.php.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/deleted.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method !== 'POST') {
    if (($_GET['missing'] ?? '') === '1') {
        $s    = xs_settings();
        $root = xs_norm_path((string) ($s['paths']['romRoot'] ?? ''));
        if ($root !== '' && !is_dir($root)) {
            // Every game would look missing. Refuse rather than offer to
            // delete the whole library because a drive is unplugged.
            xs_json(['ok' => false, 'driveOff' => true,
                     'error' => $root . ' is not there. Plug the ROM drive in first: with it unplugged every game looks missing.'], 409);
        }
        $rows = [];
        $away = [];
        foreach (xs_library()['games'] ?? [] as $g) {
            if (!empty($g['local'])) {
                continue;
            }
            $rom = (string) ($g['romPath'] ?? '');
            if ($rom === '' || is_file($full = xs_rom_real_path($rom, $s))) {
                continue;
            }
            // The same refusal per folder: games on an unplugged second drive
            // are away, not missing, and only counted.
            if (($home = xs_rom_away($full, $s)) !== null) {
                $away[$home] = ($away[$home] ?? 0) + 1;
                continue;
            }
            $rows[] = ['id' => (string) $g['id'], 'title' => (string) $g['title'],
                       'platform' => (string) $g['platform'], 'rom' => $rom,
                       'favourite' => !empty($g['favourite']), 'plays' => (int) ($g['plays'] ?? 0)];
        }
        usort($rows, static fn($a, $b) => [$a['platform'], $a['title']] <=> [$b['platform'], $b['title']]);
        $awayRows = [];
        foreach ($away as $home => $n) {
            $awayRows[] = ['folder' => (string) $home, 'games' => $n];
        }
        xs_json(['ok' => true, 'missing' => $rows, 'away' => $awayRows, 'deleted' => count(xs_deleted())]);
    }
    xs_json(['ok' => true, 'deleted' => xs_deleted()]);
}

xs_local_origin_only();
$body   = xs_body();
$action = (string) ($body['action'] ?? '');

if ($action === 'delete') {
    $ids = $body['ids'] ?? [];
    if (!is_array($ids) || !$ids) {
        xs_fail('nothing to delete', 400);
    }
    /* The caller says how many it means and the number must match, so a
       request built by accident cannot empty a library. Checked here: a
       confirmation that only exists in the page is not one. */
    if ((string) ($body['confirm'] ?? '') !== (string) count($ids)) {
        xs_fail('this asks to delete ' . count($ids) . ' games and was not confirmed for that number', 409);
    }

    $byId = [];
    foreach (xs_library()['games'] ?? [] as $g) {
        $byId[(string) $g['id']] = $g;
    }
    $picks = [];
    foreach ($ids as $id) {
        if (isset($byId[(string) $id])) {
            $picks[] = $byId[(string) $id];
        }
    }
    if (!$picks) {
        xs_fail('none of those games are in the library', 404);
    }
    $n = xs_delete_games($picks, $why);
    if ($n === false) {
        xs_fail((string) $why, 500);
    }
    xs_log('DEL', 'deleted ' . $n . ' of ' . count($ids) . ' asked: '
        . implode(', ', array_map(static fn($g) => (string) $g['title'], array_slice($picks, 0, 6)))
        . (count($picks) > 6 ? ' and more' : ''));
    xs_json(['ok' => true, 'deleted' => $n]);
}

if ($action === 'restore') {
    $id = (string) ($body['id'] ?? '');
    // What it was, for the log: the entry goes with the restore.
    $was = array_values(array_filter(xs_deleted(), static fn($d) => (string) ($d['id'] ?? '') === $id))[0] ?? [];
    if (!xs_undelete($id, $why)) {
        // Not there is a 404; there but not written back is the disk's fault.
        xs_fail((string) $why, $why === 'nothing deleted with that id' ? 404 : 500);
    }
    // Its file as the missing list reads it: there, on a drive that is away right now, or gone.
    $rom   = (string) ($was['rom'] ?? '');
    $where = '';
    if ($rom !== '') {
        $s     = xs_settings();
        $full  = xs_rom_real_path($rom, $s);
        $away  = is_file($full) ? null : xs_rom_away($full, $s);
        $where = ', ' . $rom . (is_file($full) ? '' : ($away !== null ? ' (' . $away . ' is not there right now)' : ' (its file is not there: it comes back missing)'));
    }
    xs_log('DEL', 'restored ' . $id . ': ' . (string) ($was['title'] ?? '?') . ' (' . (string) ($was['platform'] ?? '?') . ')'
        . ', deleted ' . substr((string) ($was['at'] ?? '?'), 0, 10) . $where . ', ' . count(xs_deleted()) . ' still deleted');
    xs_json(['ok' => true]);
}

xs_fail('unknown action', 400);
