<?php
/**
 * api\fill.php when filling uses libretro (Settings say so, or the database cannot be read): the same three questions, asked
 * of libretro (includes\libretro.php). Included by api\fill.php, which has
 * read the library into $games and $byId.
 *
 *   GET  ?scope=scanned         every scanned game with libretro's best match
 *   GET  ?id=<game>&search=<q>  that game's console searched, for Change...
 *   POST {"id", "dbId": <libretro name>, "metadata", "pictures", "dry"}
 *
 * As in the Games Database pass, only an empty field or picture slot is filled; also a
 * scanned game's file-name title becomes the proper name unless you edited it.
 */
declare(strict_types=1);

require_once __DIR__ . '/libretro.php';

/** @var array $games @var array $byId */
$indexes = [];
$tables = [];
$lrIndex = static function (string $sys) use (&$indexes): ?array {
    if (!array_key_exists($sys, $indexes)) {
        $indexes[$sys] = xs_lr_index($sys, $why);
    }
    return $indexes[$sys];
};

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    // ---- a search, for the row's Change... ---------------------------------
    if (isset($_GET['search'])) {
        $g = $byId[(string) ($_GET['id'] ?? '')] ?? null;
        $sys = $g !== null ? xs_lr_system((string) $g['platform']) : null;
        if ($sys === null) {
            xs_fail($g === null ? 'unknown game' : 'libretro has no list for ' . $g['platform'], 404);
        }
        $idx = $lrIndex($sys);
        if ($idx === null) {
            xs_fail('libretro could not be reached (no internet?)', 502);
        }
        $out = [];
        foreach (xs_lr_search(xs_lr_names($idx), (string) $_GET['search']) as $n) {
            $out[] = ['id' => $n, 'title' => $n, 'platform' => $g['platform']];
        }
        xs_json(['ok' => true, 'source' => 'libretro', 'results' => $out]);
    }

    // ---- every scanned game, with its best match ---------------------------
    /* Served in slices (offset, limit) like api\fill.php, so this one-at-a-time server
       keeps answering and each chunk fetches only its consoles' lists. No limit: all. */
    $rows = [];
    foreach ($games as $g) {
        if (!empty($g['scanned'])) {
            $rows[] = $g;
        }
    }
    $total  = count($rows);
    $offset = max(0, (int) ($_GET['offset'] ?? 0));
    $limit  = max(0, (int) ($_GET['limit'] ?? 0));
    if ($offset > 0 || $limit > 0) {
        $rows = array_slice($rows, $offset, $limit > 0 ? $limit : null);
    }
    // The matching itself is includes\fill.php's, shared with the worker.
    $out = xs_fill_sort(xs_fill_rows_libretro($rows, $offline));
    $sure = xs_fill_sure($out);
    if ($offline && $sure === 0 && $out) {
        xs_fail('libretro could not be reached, so there is nothing to match against yet (no internet?)', 502);
    }
    xs_json(['ok' => true, 'scope' => 'scanned', 'source' => 'libretro', 'count' => $total,
             'offset' => $offset, 'returned' => count($out), 'sure' => $sure, 'games' => $out]);
}

// ---- fill one game ----------------------------------------------------------
xs_local_origin_only();
$body = xs_body();
$id   = trim((string) ($body['id'] ?? ''));
if (!xs_game_id_ok($id) || !isset($byId[$id])) {
    xs_fail('unknown game', 404);
}
$game = $byId[$id];
if (!empty($game['local'])) {
    xs_fail('a game of your own has its own form: right-click > Edit Game', 409);
}
$sys = xs_lr_system((string) $game['platform']);
if ($sys === null) {
    xs_fail('libretro has no list for ' . $game['platform'], 404);
}
$idx = $lrIndex($sys);
if ($idx === null) {
    xs_fail('libretro could not be reached (no internet?)', 502);
}
$name = (string) ($body['dbId'] ?? '');
if ($name === '' || !in_array($name, xs_lr_names($idx), true)) {
    xs_fail('which game? that is not a name on libretro\'s list for ' . $game['platform'], 400);
}
$dry = !empty($body['dry']);
$wantMeta = !array_key_exists('metadata', $body) || !empty($body['metadata']);
$wantPics = $body['pictures'] ?? [];
if (!is_array($wantPics)) {
    xs_fail('pictures must be a list of slots', 400);
}

$all  = xs_overrides();
$mine = is_array($all[$id] ?? null) ? $all[$id] : [];
$filled = [];
$kept = [];
if (!$dry) {
    $mine['lrName'] = $name;                     // the match, remembered
}
if ($wantMeta) {
    $details = xs_lr_details($sys, $name);
    // A scanned game's title is replaced unless you changed it or another game here already
    // is this entry (xs_fill_entry_taken).
    $links = [];
    foreach ($all as $oid => $o) {
        $links[$oid] = (string) ($o['lrName'] ?? '');
    }
    $taken = xs_fill_entry_taken($games, $game, $links, $name);
    if (!empty($game['scanned']) && !array_key_exists('title', $mine) && $taken === null) {
        $details = ['title' => xs_lr_display($name)] + $details;
    }
    foreach ($details as $f => $v) {
        $have = $f === 'title' ? '' : ($game[$f] ?? null);
        if ($have !== null && $have !== '' && !($f === 'players' && (int) $have === 0)) {
            $kept[] = $f;
            continue;
        }
        $clean = xs_override_clean($f, $v, $err);
        if ($err !== null || $clean === null) {
            continue;
        }
        $mine[$f] = $clean;
        $filled[] = $f;
    }
}
if (!$dry && ($filled || ($all[$id]['lrName'] ?? null) !== $name)) {
    $all[$id] = $mine;
    if (!xs_write_json(xs_overrides_path(), $all, $why)) {
        xs_fail((string) $why, 500);
    }
    if ($filled) {
        xs_changed_note([$id], 'details');
    }
}

$pictures = [];
foreach ($wantPics as $kind) {
    $kind = (string) $kind;
    if (!isset(XS_LR_KINDS[$kind])) {
        continue;
    }
    if (($game['art'][$kind] ?? null) !== null) {
        $pictures[$kind] = 'already has one';
        continue;
    }
    $got = xs_lr_fetch($id, $kind, $sys, $idx, $name, $why, $dry);
    $pictures[$kind] = $got === null ? ($why === 'none on record' ? 'none on record' : 'failed: ' . $why)
                                     : ($dry ? 'would fetch ' . $got['url'] : 'stored');
}

$stored = array_keys(array_filter($pictures, static fn($v) => $v === 'stored'));
xs_log('LR', 'fill ' . $game['title'] . ' -> ' . $name . ': ' . ($filled ? implode(',', $filled) : 'no fields')
    . ($pictures ? '; ' . ($stored ? implode(',', $stored) . ' stored' : 'no new pictures') : '')
    . ($dry ? ' (dry)' : ''));
xs_json(['ok' => true, 'id' => $id, 'dbId' => $name, 'title' => xs_lr_display($name), 'source' => 'libretro',
         'filled' => $filled, 'kept' => $kept, 'pictures' => $pictures, 'dry' => $dry]);
