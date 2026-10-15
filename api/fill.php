<?php
/**
 * /api/fill.php - the Games Database pass: what a scanned game IS, filled in.
 *
 *   GET  ?scope=scanned      every game the scanner found, each with the
 *                            database's best guess for it and how sure it is
 *   GET  ?scope=unmatched    every imported game LaunchBox never matched
 *   POST {"id", "dbId", "metadata": true, "pictures": ["box","logo","shot","fanart"], "dry": false}
 *                            remember the match, fill the EMPTY fields from
 *                            the database, download the pictures for the
 *                            slots that have none; say what was done per
 *                            field and per slot. dry does everything but the
 *                            downloads and says what it would have fetched.
 *
 * A scanned game has only a title from its file name; this asks the database
 * (bin\gamesdb.php) for every scanned game, selecting the answer when it is sure.
 *
 * Whatever the page asks, only an EMPTY field is filled and only an EMPTY slot
 * gets a picture. Both are overlays in data\, so reset works as it always has.
 *
 * The pass as a job in the background (bin\fill.php), which the page starts
 * and watches:
 *
 *   GET  ?job=1              the job in a few numbers, or null
 *   GET  ?job=rows           and what its look found: every scanned game
 *                            with its match and whose decision it is
 *   GET  ?list=1             every scanned game as it stands, nothing looked
 *                            up: the pictures it has, whether it was matched
 *   POST {"job": "start", "mode": "look" | "all" | "picked", "ids": ["id"],
 *         "picks": [{"id", "dbId"}], "pictures": true, "complete": false, "dry": false}
 *                            look: look every scanned game up, fill nothing;
 *                            with ids, only those games
 *                            all: look them up and fill the ones it is sure of
 *                            picked: fill these
 *   POST {"job": "stop"}     stop after the game in hand; what is filled stays
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/fill.php';

// ---- the job, answered before the library is read: the bar asks every second or two ----
$isPost = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
if (!$isPost && isset($_GET['job'])) {
    $job = xs_fill_job();
    // A worker found gone is written down here, once, so the light status
    // poll (which reads the file as it stands) stops calling it running.
    if (!empty($job['dead'])) {
        unset($job['dead']);
        xs_write_json(xs_fill_job_path(), $job);
        xs_log('FILL', 'the worker is gone at ' . (int) ($job['done'] ?? 0) . ' of ' . (int) ($job['total'] ?? 0) . '; what it filled is kept');
    }
    $out = ['ok' => true, 'job' => xs_fill_job_light($job)];
    if ($_GET['job'] === 'rows') {
        $rows = xs_read_json(xs_fill_rows_path(), null);
        $out['rows']   = is_array($rows) ? ($rows['rows'] ?? []) : [];
        $out['source'] = is_array($rows) ? (string) ($rows['source'] ?? 'gamesdb') : xs_details_from();
        $out['lookedAt'] = is_array($rows) ? (int) ($rows['at'] ?? 0) : 0;
        $out['part'] = is_array($rows) && !empty($rows['part']);   // a look at chosen games only
    }
    xs_json($out);
}
$jobBody = $isPost ? xs_body() : [];
if ($isPost && isset($jobBody['job'])) {
    xs_local_origin_only();
    $what = (string) $jobBody['job'];
    if ($what === 'stop') {
        $running = xs_fill_running();
        if ($running) {
            @touch(xs_fill_stop_path());
            xs_log('FILL', 'asked to stop after the game in hand');
        }
        xs_json(['ok' => true, 'stopping' => $running]);
    }
    if ($what !== 'start') {
        xs_fail('job must be start or stop', 400);
    }
    $mode = (string) ($jobBody['mode'] ?? '');
    if (!in_array($mode, ['look', 'all', 'picked'], true)) {
        xs_fail('mode must be look, all or picked', 400);
    }
    $now = xs_fill_job();
    if (($now['state'] ?? '') === 'running') {
        xs_fail(($now['mode'] ?? '') === 'look' ? 'the games are still being looked up; try again in a moment'
                                                : 'Get Pictures is already running: the bar at the bottom shows how far it is', 409);
    }
    $picks = [];
    if ($mode === 'picked') {
        foreach ((array) ($jobBody['picks'] ?? []) as $p) {
            $pid = trim((string) ($p['id'] ?? ''));
            $to  = trim((string) ($p['dbId'] ?? ''));
            if (xs_game_id_ok($pid) && $to !== '' && $to !== '0' && strlen($to) < 300) {
                $picks[] = ['id' => $pid, 'dbId' => $to];
            }
        }
        if (!$picks) {
            xs_fail('nothing is selected', 400);
        }
    }
    // A look at the games chosen on the screen, not every scanned game.
    $only = [];
    if ($mode === 'look' && is_array($jobBody['ids'] ?? null)) {
        foreach ($jobBody['ids'] as $one) {
            if (is_string($one) && xs_game_id_ok($one)) {
                $only[$one] = true;
            }
        }
        if (!$only) {
            xs_fail('nothing is selected', 400);
        }
    }
    $job = ['mode' => $mode, 'picks' => $picks, 'only' => array_keys($only),
            'pictures_wanted' => !array_key_exists('pictures', $jobBody) || !empty($jobBody['pictures']),
            'complete' => !empty($jobBody['complete']), 'dry' => !empty($jobBody['dry'])];
    if (!xs_fill_start($job, $why)) {
        xs_fail((string) $why, 500);
    }
    xs_log('FILL', 'started in the background: ' . ($mode === 'picked' ? count($picks) . ' selected games' : ($mode === 'all' ? 'every game it is sure of'
        : ($only ? 'a look at ' . count($only) . ' chosen games' : 'a look only')))
        . ($job['pictures_wanted'] ? '' : ', no pictures') . ($job['dry'] ? ' (dry)' : ''));
    xs_json(['ok' => true, 'started' => true, 'job' => xs_fill_job_light()]);
}

$lib   = xs_library();
$games = $lib['games'] ?? [];

$byId = [];
foreach ($games as $g) {
    $byId[$g['id']] = $g;
}

/* ---- the scanned games as they stand, nothing looked up ------
   What Get Specific Pictures opens on, from the library alone so the screen
   is up at once; a look goes to the games chosen there. */
if (!$isPost && ($_GET['list'] ?? '') === '1') {
    $from  = xs_details_from();
    $slots = XS_FILL_SLOTS;
    $links = [];
    if ($from === 'libretro') {
        require_once __DIR__ . '/../includes/libretro.php';
        $slots = array_values(array_intersect(XS_FILL_SLOTS, array_keys(XS_LR_KINDS)));
        $links = xs_overrides();
    }
    $rows = [];
    foreach (xs_fill_scope($games) as $g) {
        $art = [];
        foreach ($slots as $k) {
            $art[$k] = ($g['art'][$k] ?? null) !== null;
        }
        $rows[] = ['id' => $g['id'], 'title' => $g['title'], 'platform' => $g['platform'], 'art' => $art,
                   'linked' => $from === 'libretro' ? (string) ($links[$g['id']]['lrName'] ?? '') !== '' : (int) ($g['dbId'] ?? 0) > 0];
    }
    xs_json(['ok' => true, 'source' => $from, 'slots' => $slots, 'games' => $rows]);
}

/* libretro is asked instead of the shipped Games Database when Settings say
   so or that copy is not here: the same answer, with a libretro name for an id. */
if (xs_details_from() === 'libretro') {
    require __DIR__ . '/../includes/fill-libretro.php';
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $scope = (string) ($_GET['scope'] ?? 'scanned');
    $rows = xs_fill_scope($games, $scope);
    /* Sliced by offset and limit: one match of the whole library holds this
       one-request-at-a-time server too long. Without limit the whole list
       comes back. count is the TOTAL in scope; sure counts the slice. */
    $total  = count($rows);
    $offset = max(0, (int) ($_GET['offset'] ?? 0));
    $limit  = max(0, (int) ($_GET['limit'] ?? 0));
    if ($offset > 0 || $limit > 0) {
        $rows = array_slice($rows, $offset, $limit > 0 ? $limit : null);
    }
    $t0 = microtime(true);
    $out = xs_fill_rows_gamesdb($rows, $err);
    if ($out === null) {
        xs_log('FILL', 'match ' . $scope . ' offset ' . $offset . ' FAILED: ' . $err);
        xs_fail((string) $err, 502);
    }
    xs_log('FILL', 'match ' . $scope . ' offset ' . $offset . ': ' . count($rows) . ' of ' . $total
        . ' in ' . (int) round((microtime(true) - $t0) * 1000) . 'ms');
    // Whose decision each one is (state), as far as this slice can see: the
    // look a job makes sorts the whole list at once.
    $out = xs_fill_sort($out);
    xs_json(['ok' => true, 'scope' => $scope, 'count' => $total, 'offset' => $offset,
             'returned' => count($out), 'sure' => xs_fill_sure($out), 'games' => $out]);
}

xs_local_origin_only();

$body = $jobBody;
$id   = trim((string) ($body['id'] ?? ''));
if (!xs_game_id_ok($id) || !isset($byId[$id])) {
    xs_fail('unknown game', 404);
}
$game = $byId[$id];
if (!empty($game['local'])) {
    xs_fail('a game of your own has its own form: right-click > Edit Game', 409);
}
$dbId = (int) ($body['dbId'] ?? ($game['dbId'] ?? 0));
if ($dbId <= 0) {
    xs_fail('which database game? dbId is needed (search first)', 400);
}
$dry = !empty($body['dry']);
$wantMeta = !array_key_exists('metadata', $body) || !empty($body['metadata']);
$wantPics = $body['pictures'] ?? [];
if (!is_array($wantPics)) {
    xs_fail('pictures must be a list of slots', 400);
}
$kinds = xs_own_art_kinds();
foreach ($wantPics as $k) {
    if (!isset($kinds[(string) $k])) {
        xs_fail('no such picture slot: ' . (string) $k . ' (have ' . implode(', ', array_keys($kinds)) . ')', 400);
    }
}

// ---- the match, remembered -----------------------------------------------
if ((int) ($game['dbId'] ?? 0) !== $dbId) {
    if (!xs_gamesdb_link($id, $dbId, $why)) {
        xs_fail((string) $why, 500);
    }
}

// ---- the empty fields ----------------------------------------------------
$filled = [];
$kept   = [];
$dbTitle = '';
if ($wantMeta) {
    $r = xs_gamesdb(['game', (string) $dbId]);
    if (empty($r['ok'])) {
        xs_fail((string) ($r['error'] ?? 'the database did not answer'), 502);
    }
    $db = $r['game'];
    $dbTitle = (string) ($db['title'] ?? '');
    $all  = xs_overrides();
    $mine = is_array($all[$id] ?? null) ? $all[$id] : [];
    /* The title too, for a scanned game: its title is its file name, so it
       takes the database's proper one unless you renamed it. */
    $fields = ['developer', 'publisher', 'genre', 'released', 'rating', 'notes', 'players'];
    /* Not when another game on this console already is this entry: both would
       end up with one name (xs_fill_entry_taken). The rest is still filled. */
    $links = [];
    foreach ($games as $o) {
        $links[$o['id']] = (string) ($o['dbId'] ?? '');
    }
    $taken = xs_fill_entry_taken($games, $game, $links, (string) $dbId);
    if (!empty($game['scanned']) && !array_key_exists('title', $mine) && $dbTitle !== '' && $dbTitle !== (string) ($game['title'] ?? '')) {
        if ($taken === null) {
            array_unshift($fields, 'title');
        } else {
            xs_log('DB', 'fill ' . $game['title'] . ': its name is kept, since "' . $taken . '" already is #' . $dbId . ' ' . $dbTitle);
        }
    }
    foreach ($fields as $f) {
        $have = $f === 'title' ? '' : ($game[$f] ?? null);
        /* 0 players is "nobody said", the way a 0 rating is: the scanner
           writes 0, and read as a value it would never be filled. */
        $isEmpty = $have === null || $have === '' || ($f === 'rating' && (float) $have === 0.0)
                || ($f === 'players' && (int) $have === 0);
        $v = $db[$f] ?? null;
        if ($v === null || $v === '' || ($f === 'rating' && (float) $v === 0.0) || ($f === 'players' && (int) $v === 0)) {
            continue;                                   // nothing on record either
        }
        if (!$isEmpty) {
            $kept[] = $f;                               // yours, or the scanner's: left alone
            continue;
        }
        $clean = xs_override_clean($f, $v, $err);
        if ($err !== null || $clean === null) {
            continue;                                   // a value the dialog would refuse
        }
        $mine[$f] = $clean;
        $filled[] = $f;
    }
    if ($filled) {
        $all[$id] = $mine;
        xs_write_or_fail(xs_overrides_path(), $all);
        xs_changed_note([$id], 'details');
    }
}

// ---- the empty slots -----------------------------------------------------
$pictures = [];
if ($wantPics) {
    $imgs = null;
    foreach ($wantPics as $kind) {
        $kind = (string) $kind;
        if (($game['art'][$kind] ?? null) !== null) {
            $pictures[$kind] = 'already has one';
            continue;
        }
        if ($imgs === null) {
            $imgs = xs_gamesdb(['images', (string) $dbId]);
            if (empty($imgs['ok'])) {
                xs_fail((string) ($imgs['error'] ?? 'the database did not answer'), 502);
            }
        }
        $best = $imgs['slots'][$kind][0] ?? null;
        if ($best === null) {
            $pictures[$kind] = 'none on record';
            continue;
        }
        $got = xs_gamesdb_fetch($id, $kind, (string) $best['file'], $why, $dry);
        $pictures[$kind] = $got === null ? 'failed: ' . $why : ($dry ? 'would fetch ' . $got['url'] : 'stored');
    }
}

// A fill that found everything in place says so.
$stored = array_keys(array_filter($pictures, static fn($v) => $v === 'stored'));
xs_log('DB', 'fill ' . $game['title'] . ' -> #' . $dbId . ($dbTitle !== '' ? ' ' . $dbTitle : '')
    . ': ' . ($filled ? implode(',', $filled) : 'no fields')
    . ($pictures ? '; ' . ($stored ? implode(',', $stored) . ' stored' : 'no new pictures') : '')
    . ($dry ? ' (dry)' : ''));
xs_json(['ok' => true, 'id' => $id, 'dbId' => $dbId, 'title' => $dbTitle, 'nameKeptFor' => $taken ?? null,
         'filled' => $filled, 'kept' => $kept, 'pictures' => $pictures, 'dry' => $dry]);
