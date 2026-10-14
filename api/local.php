<?php
/**
 * /api/local.php - your own games (includes\local.php).
 *
 *   GET                       every entry, plus the platform names on offer
 *   GET  ?id=<xs-id>          one entry
 *   POST {"set": {...}}                add one; the answer carries its new id
 *   POST {"id": "xs-..", "set": {...}} change one (the whole entry is replaced)
 *   POST {"id": "xs-..", "remove": true}
 *
 * Everything lands in data\local-games.json. Pictures, favourites and play
 * history live where they do for any game, keyed by its id; removing the
 * entry leaves them, and the id is never reused.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $entries = xs_local_read();
    $id = trim((string) ($_GET['id'] ?? ''));
    if ($id !== '') {
        foreach ($entries as $e) {
            if (($e['id'] ?? '') === $id) {
                xs_json(['ok' => true, 'game' => $e]);
            }
        }
        xs_fail('unknown game', 404);
    }
    /* The merged read, not library.json, which usually does not exist. */
    $platforms = array_keys(xs_library()['platforms'] ?? []);
    foreach ($entries as $e) {
        // xs_local_platform, so a blank one offers Unknown in the list too
        $p = xs_local_platform($e);
        if (!in_array($p, $platforms, true)) {
            $platforms[] = $p;
        }
    }
    sort($platforms, SORT_NATURAL | SORT_FLAG_CASE);
    xs_json(['ok' => true, 'games' => $entries, 'platforms' => $platforms,
             'unknown' => XS_LOCAL_UNKNOWN,     // what a blank platform is filed under
             'fields' => array_keys(xs_local_fields())]);
}

xs_local_origin_only();
$body = xs_body();
$id   = trim((string) ($body['id'] ?? ''));
if ($id !== '' && !preg_match('/^xs-[0-9a-f]{12}$/', $id)) {
    xs_fail('bad id', 400);
}

$entries = xs_local_read();
$at = -1;
foreach ($entries as $i => $e) {
    if ($id !== '' && ($e['id'] ?? '') === $id) {
        $at = $i;
    }
}
if ($id !== '' && $at < 0) {
    xs_fail('unknown game', 404);
}

if (!empty($body['remove'])) {
    if ($id === '') {
        xs_fail('which game?', 400);
    }
    $gone = $entries[$at];
    array_splice($entries, $at, 1);
    if (!xs_local_write($entries, $why)) {
        xs_fail((string) $why, 500);
    }
    // You took it out: not "a game is no longer in the library" tomorrow.
    require_once __DIR__ . '/../includes/news.php';
    xs_news_forget([$id]);
    xs_log('OWN', 'remove ' . $id . ' ' . ($gone['title'] ?? ''));
    xs_json(['ok' => true, 'removed' => $gone['title'] ?? $id]);
}

$set = $body['set'] ?? null;
if (!is_array($set)) {
    xs_fail('nothing to save', 400);
}
// The whole entry is replaced, and the form does not send what it does not
// show: which Steam app a game is, and its folder. Kept from the entry.
if ($at >= 0) {
    foreach (xs_local_kept_fields() as $k) {
        if (!array_key_exists($k, $set) && isset($entries[$at][$k])) {
            $set[$k] = $entries[$at][$k];
        }
    }
}
$clean = xs_local_clean($set, $id !== '' ? $id : null);
if (is_string($clean)) {
    xs_fail($clean, 422);
}
if ($at >= 0) {
    // An edit keeps the original added day; the game did not arrive twice.
    $clean['added'] = (string) ($entries[$at]['added'] ?? '');
    $entries[$at] = $clean;
} else {
    $clean['added'] = date('Y-m-d');
    $entries[] = $clean;
}
if (!xs_local_write($entries, $why)) {
    xs_fail((string) $why, 500);
}
// The answer says where it actually landed, which for a blank platform is
// Unknown; the page opens that platform straight afterwards.
$filed = xs_local_platform($clean);
xs_log('OWN', ($at < 0 ? 'add ' : 'edit ') . $clean['id'] . ' ' . $clean['title'] . ' [' . $filed . ']');
xs_json(['ok' => true, 'game' => ['platform' => $filed] + $clean, 'added' => $at < 0,
         'filedUnder' => $filed, 'noPlatform' => empty($clean['platform'])]);
