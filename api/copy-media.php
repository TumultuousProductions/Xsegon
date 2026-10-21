<?php
/**
 * A game's pictures and video, copied from another game (the Media tab).
 *
 *   GET  /api/copy-media.php?id=<id>&find=<words>       the games to copy from
 *   GET  /api/copy-media.php?id=<id>&from=<other id>    what each has, kind by kind
 *   POST /api/copy-media.php?id=<id>&from=<other id>&kind=box|...|video|all
 *
 * includes\copymedia.php has where a copy lands and what it may be read from.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/copymedia.php';

$id = xs_id_or_fail($_GET['id'] ?? '');

// HEAD reads too: it arrives from other sites with no Origin header, so it
// must never reach the writes below, which take everything from the query.
$reading = in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true);
if ($reading && !isset($_GET['from'])) {
    $list = xs_cm_list($id, trim((string) ($_GET['find'] ?? '')));
    if (!$list['ok']) {
        xs_fail($list['error'], 404);
    }
    xs_json($list);
}

$fromId = xs_id_or_fail($_GET['from'] ?? '');
if ($fromId === $id) {
    xs_fail('a game cannot copy from itself', 400);
}
$s    = xs_settings();
$to   = xs_game_or_404($id);
$from = xs_game_or_404($fromId, 'the game to copy from is no longer in the library');
$rows = xs_cm_rows($s, $to, $from);
$who  = ['id' => $fromId, 'title' => $from['title'], 'variant' => $from['variant'] ?? null, 'platform' => $from['platform']];

if ($reading) {
    xs_json(['ok' => true, 'id' => $id, 'title' => $to['title'], 'from' => $who, 'rows' => $rows]);
}

xs_local_origin_only();

$kinds = xs_cm_kinds();
$kind  = (string) ($_GET['kind'] ?? '');
if ($kind !== 'all' && !isset($kinds[$kind])) {
    xs_fail('kind must be all or one of: ' . implode(', ', array_keys($kinds)), 400);
}

// All: whatever the other game has that this one does not show already.
$want = [];
foreach ($rows as $r) {
    if (($kind === 'all' || $r['kind'] === $kind) && $r['from'] !== null && !$r['same']) {
        $want[] = $r['kind'];
    }
}
if ($kind !== 'all' && !$want) {
    $r = array_values(array_filter($rows, static fn(array $x): bool => $x['kind'] === $kind))[0];
    xs_fail($r['from'] === null ? $from['title'] . ' has no ' . strtolower($kinds[$kind]) . ' to copy'
                                : 'this game already shows that ' . strtolower($kinds[$kind]), 409);
}

// What the page puts on the game's row, so every view shows the copy without reading the library again.
$patch  = ['img' => [], 'imgFull' => []];
$copied = [];
$failed = [];
foreach ($want as $k) {
    $path = $k === 'video' ? xs_cm_copy_video($s, $to, $from, $why) : xs_cm_copy_art($to, $from, $k, $why);
    if ($path === null) {
        $failed[] = ['kind' => $k, 'why' => $why];
        xs_log('ART', $to['title'] . ': ' . $k . ' not copied from ' . $from['title'] . ' (' . $why . ')');
        continue;
    }
    $copied[] = $k;
    $rev = (int) @filemtime($path);
    xs_art_from_set($id, $k, 'copy', $rev, (string) $from['title']);
    foreach ($rows as &$r) {
        if ($r['kind'] === $k) {
            $r['to']   = xs_cm_url($id, $k, $path);
            $r['same'] = true;
        }
    }
    unset($r);
    if ($k === 'video') {
        $patch['hasVideo'] = true;
        $patch['videoRev'] = $rev;
        $patch['videoUrl'] = media_url($path, $rev);
    } else {
        // No thumbnail yet: the full picture is the tile's too, as api\library.php does it.
        $patch['img'][$k] = $patch['imgFull'][$k] = media_url($path, $rev);
        $patch[['box' => 'hasArt', 'box3d' => 'hasBox3d', 'logo' => 'hasLogo', 'shot' => 'hasShot', 'fanart' => 'hasFanart'][$k]] = true;
        $patch['artRev'] = max((int) ($patch['artRev'] ?? $to['artRev'] ?? 0), $rev);
        $patch['edited'] = true;
    }
    xs_log('ART', $to['title'] . ': ' . $k . ' copied from ' . $from['title']
           . ($k === 'video' ? ' (' . round(filesize($path) / 1048576, 1) . ' MB)' : ''));
}

xs_json(['ok' => $copied !== [] || $failed === [], 'id' => $id, 'title' => $to['title'], 'from' => $who, 'rows' => $rows,
         'copied' => $copied, 'failed' => $failed, 'patch' => $patch,
         'error' => $copied === [] && $failed !== [] ? $failed[0]['why'] : null]);
