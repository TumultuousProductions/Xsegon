<?php
/**
 * Xsegon - the Fill in worker: names, details and pictures for scanned games,
 * in the background.
 *
 *   php bin\fill.php --server=http://127.0.0.1:8099
 *
 * Started and left by api\fill.php (includes\fill.php, xs_fill_start, which
 * also says why this is a process of its own and what it may write). What to
 * do is in data\fill-job.json; how far it is goes back into that file, which
 * the page's bar reads.
 *
 *     prepare   unpack the Games Database, when it has not been yet
 *     look      what each scanned game is (modes "look" and "all")
 *     first     each game's name and details, then its box: the library
 *               looks right as soon as this is through
 *     rest      the logo, the screenshot and the background
 *
 * Names and details are written by the main server, asked one game at a
 * time over --server; pictures are stored from here into data\art. A slot
 * with a picture, or emptied on purpose ("use no picture"), is left alone.
 * data\fill-stop, touched by the page's Stop, ends the run after the game in
 * hand.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/fill.php';
require_once __DIR__ . '/../includes/scan.php';
require_once __DIR__ . '/../includes/deleted.php';

$server = '';
foreach ($argv as $a) {
    if (str_starts_with($a, '--server=')) {
        $server = rtrim(substr($a, 9), '/');
    }
}

$job = xs_read_json(xs_fill_job_path(), null);
if (!is_array($job) || ($job['state'] ?? '') !== 'running' || !empty($job['pid'])) {
    fwrite(STDERR, "no job waiting in data\\fill-job.json\n");
    exit(1);
}
$job['pid'] = getmypid();

$save = static function () use (&$job): void {
    $job['beat'] = time();
    xs_write_json(xs_fill_job_path(), $job);
};
$end = static function (string $state, string $error = '') use (&$job, $save): void {
    $job['state'] = $state;
    $job['finished'] = time();
    if ($error !== '') {
        $job['error'] = $error;
    }
    $save();
    @unlink(xs_fill_stop_path());
    exit($state === 'failed' ? 1 : 0);
};
$stopped = static fn (): bool => is_file(xs_fill_stop_path());

/** Ask the main server, which is the one that writes names and details. */
$ask = static function (string $path, array $body) use ($server): array {
    $ctx = stream_context_create(['http' => [
        'method' => 'POST', 'header' => "Content-Type: application/json\r\n", 'content' => json_encode($body),
        'timeout' => 120, 'ignore_errors' => true,
    ]]);
    $last = 'Xsegon did not answer';
    // It answers one request at a time and may be on something long.
    for ($try = 0; $try < 3; $try++) {
        $raw = @file_get_contents($server . '/' . $path, false, $ctx);
        $j = is_string($raw) ? json_decode($raw, true) : null;
        if (is_array($j)) {
            return $j;
        }
        sleep(2);
    }
    return ['ok' => false, 'error' => $last];
};

set_time_limit(0);
$mode   = (string) ($job['mode'] ?? '');
$dry    = !empty($job['dry']);
$source = xs_details_from();
if ($source === 'libretro') {
    require_once __DIR__ . '/../includes/libretro.php';
}
$job['source'] = $source;
$save();

try {
    // ---- prepare: the database, unpacked once ------------------------------
    if ($source === 'gamesdb' && xs_gamesdb_build_due()) {
        $job['phase'] = 'prepare';
        $save();
        $t0 = microtime(true);
        xs_log('FILL', 'setting up the Games Database from the copy that ships with Xsegon');
        $p = xs_gamesdb(['prepare'], 600);
        if (empty($p['ok'])) {
            $end('failed', 'The Games Database could not be set up: ' . (string) ($p['error'] ?? 'no answer'));
        }
        xs_log('FILL', 'the Games Database is ready, ' . round(microtime(true) - $t0, 1) . 's');
    }

    $lib   = xs_library();
    $games = $lib['games'] ?? [];
    $byId  = [];
    foreach ($games as $g) {
        $byId[$g['id']] = $g;
    }

    // ---- look: what each scanned game is ------------------------------------
    $todo = [];
    if ($mode === 'look' || $mode === 'all') {
        $job['phase'] = 'look';
        $scanned = xs_fill_scope($games);
        // A look for Get Specific Pictures is of the games chosen there.
        $only = $mode === 'look' ? array_flip(array_map('strval', (array) ($job['only'] ?? []))) : [];
        if ($only) {
            $scanned = array_values(array_filter($scanned, static fn (array $g): bool => isset($only[(string) $g['id']])));
        }
        $job['scanned'] = count($scanned);
        $job['looked'] = 0;
        $save();
        $t0 = microtime(true);
        $rows = [];
        $offlineAll = false;
        // In small slices: the bar has numbers to show, and no one ask comes
        // near the reader's time limit on a slow disk that is busy elsewhere.
        foreach (array_chunk($scanned, 10) as $slice) {
            if ($stopped()) {
                $end('stopped');
            }
            if ($source === 'libretro') {
                $part = xs_fill_rows_libretro($slice, $offline);
                $offlineAll = $offlineAll || $offline;
            } else {
                $part = xs_fill_rows_gamesdb($slice, $err);
                if ($part === null && !$stopped()) {
                    // Once more after a breath: whatever held the disk may have let go.
                    xs_log('FILL', 'the look stalled at ' . count($rows) . ' of ' . count($scanned) . ' (' . $err . '): that part is asked once more');
                    sleep(5);
                    $part = xs_fill_rows_gamesdb($slice, $err);
                }
                if ($part === null) {
                    xs_log('FILL', 'the look FAILED at ' . count($rows) . ' of ' . count($scanned) . ': ' . $err);
                    $end('failed', 'The games could not be looked up: ' . $err);
                }
            }
            foreach ($part as $r) {
                unset($r['match']['candidates'], $r['empty'], $r['edited']);
                $rows[] = $r;
            }
            $job['looked'] = count($rows);
            $save();
        }
        $rows = xs_fill_sort($rows);
        $n = ['ready' => 0, 'check' => 0, 'none' => 0, 'done' => 0];
        foreach ($rows as $r) {
            $n[$r['state']]++;
        }
        if ($offlineAll && $rows && $n['ready'] + $n['check'] + $n['done'] === 0) {
            $end('failed', 'libretro could not be reached, so there is nothing to match against yet (no internet?)');
        }
        xs_write_json(xs_fill_rows_path(), ['at' => time(), 'source' => $source, 'rows' => $rows, 'part' => (bool) $only]);
        $job['left'] = $n['check'] + $n['none'];
        $job['check'] = $n['check'];
        $job['none'] = $n['none'];
        // The games with a likely match, for the one message that names them when the pass is in.
        $checkRows = array_values(array_filter($rows, static fn (array $r): bool => $r['state'] === 'check'));
        xs_log('FILL', 'looked up ' . count($rows) . ' scanned games in ' . round(microtime(true) - $t0, 1) . 's: '
            . $n['ready'] . ' to fill, ' . $n['check'] . ' for a person to check, ' . $n['none'] . ' with nothing found, '
            . $n['done'] . ' filled before');
        if ($mode === 'look') {
            $end('done');
        }
        foreach ($rows as $r) {
            if ($r['state'] === 'ready') {
                $todo[] = ['id' => $r['id'], 'dbId' => (string) ($r['dbId'] ?: $r['match']['best']['id'])];
            }
        }
    } else {
        $todo = array_values(array_filter((array) ($job['picks'] ?? []), static fn ($p) => isset($byId[(string) ($p['id'] ?? '')])));
    }

    // ---- one picture, for a slot that has none --------------------------------
    $hidden = xs_art_hidden();
    $plans  = [];                        // game id => what the source has for each slot
    $lists  = [];                        // console => its libretro list, read once
    /* A game hidden, deleted or removed from the scan while the pass runs
       gets nothing more and is not counted. Asked at each game's turn and
       before each store. */
    $stillHere = static function (string $id): bool {
        if (isset(xs_hidden_games()[$id]) || isset(xs_deleted_ids()[$id])) {
            return false;
        }
        foreach (xs_scan_read() as $e) {
            if ((string) ($e['id'] ?? '') === $id) {
                return true;
            }
        }
        return false;
    };
    // Why a slot gets nothing fetched, or null when it is to be fetched.
    $skip = static function (array $game, string $kind) use ($hidden): ?string {
        $id = (string) $game['id'];
        if (($game['art'][$kind] ?? null) !== null || xs_glob(xs_own_art_dir(), $id . '-' . $kind . '.*')) {
            return 'already has one';
        }
        if (in_array($kind, (array) ($hidden[$id] ?? []), true)) {
            return 'left empty on purpose';
        }
        return null;
    };
    // Where the Games Database has a slot's picture: ['url' => it], or ['said' => why none is fetched].
    $where = static function (array $game, string $entry, string $kind) use (&$plans, $dry): array {
        $id = (string) $game['id'];
        if (!isset($plans[$id])) {
            $plans[$id] = xs_gamesdb(['images', $entry]);
        }
        if (empty($plans[$id]['ok'])) {
            return ['said' => 'failed: ' . (string) ($plans[$id]['error'] ?? 'the database did not answer')];
        }
        $file = (string) ($plans[$id]['slots'][$kind][0]['file'] ?? '');
        if ($file === '') {
            return ['said' => 'none on record'];
        }
        if (!xs_gamesdb_picture_name($file)) {
            return ['said' => 'failed: that is not a Games Database picture name'];
        }
        $url = xs_gamesdb_picture_url($file);
        return $dry ? ['said' => 'would fetch ' . $url] : ['url' => $url];
    };
    /* A downloaded picture into its slot. The slot is looked at again now the
       download is in: a picture or "use no picture" set meanwhile is kept, as
       storing replaces the slot and $hidden was read when the pass began. */
    $keep = static function (array $game, string $kind, ?string $bytes, ?string $why) use ($stillHere): string {
        $id = (string) $game['id'];
        if ($bytes === null || $bytes === '') {
            return 'failed: ' . ($why ?? 'an empty picture');
        }
        if (xs_glob(xs_own_art_dir(), $id . '-' . $kind . '.*')) {
            return 'already has one';
        }
        if (in_array($kind, (array) (xs_art_hidden()[$id] ?? []), true)) {
            return 'left empty on purpose';
        }
        if (!$stillHere($id)) {
            return 'not stored: the game was removed';
        }
        // Not lifting a "use no picture" note: there is none, or it was left alone above.
        return xs_own_art_store($id, $kind, $bytes, false, $why) === null ? 'failed: ' . $why : 'stored';
    };
    // One slot from libretro's thumbnails, fetched and stored.
    $libretro = static function (array $game, string $entry, string $kind) use (&$lists, $dry, $keep): string {
        $id = (string) $game['id'];
        if (!isset(XS_LR_KINDS[$kind])) {
            return 'none on record';             // a slot libretro has no pictures for
        }
        $sys = xs_lr_system((string) $game['platform']);
        if ($sys !== null && !array_key_exists($sys, $lists)) {
            $lists[$sys] = xs_lr_index($sys, $why);
        }
        $idx = $sys !== null ? $lists[$sys] : null;
        if ($idx === null) {
            return 'failed: libretro could not be reached';
        }
        $got = xs_lr_fetch($id, $kind, $sys, $idx, $entry, $why, true);
        if ($got === null) {
            return $why === 'none on record' ? 'none on record' : 'failed: ' . $why;
        }
        if ($dry) {
            return 'would fetch ' . $got['url'];
        }
        $bytes = xs_lr_get($got['url'], $why);
        return $keep($game, $kind, is_string($bytes) ? $bytes : null, $why);
    };
    /* When LaunchBox's picture server gives nothing, libretro's thumbnails are
       asked instead, for a game it knows by file name or the chosen name. A
       title alone is not enough, so a wrong game's picture is never taken. */
    $tables = [];
    $backup = static function (array $game, string $kind) use (&$lists, &$tables, $libretro): ?string {
        require_once __DIR__ . '/../includes/libretro.php';
        $sys = isset(XS_LR_KINDS[$kind]) ? xs_lr_system((string) $game['platform']) : null;
        if ($sys === null) {
            return null;
        }
        if (!array_key_exists($sys, $lists)) {
            $lists[$sys] = xs_lr_index($sys, $why);
        }
        if ($lists[$sys] === null) {
            return null;
        }
        $tables[$sys] ??= xs_lr_tables(xs_lr_names($lists[$sys]));
        $name = (string) (xs_overrides()[(string) $game['id']]['lrName'] ?? '');
        if ($name === '') {
            $m = xs_lr_match($game, $tables[$sys]);
            $name = in_array($m['confidence'], ['sure', 'likely'], true) ? (string) $m['name'] : '';
        }
        return $name === '' ? null : $libretro($game, $name, $kind);
    };
    /* Several slots at once, each [game, database entry, kind], answered in
       the same order. The Games Database's pictures come side by side (one at
       a time is far too slow); libretro's stay one by one. */
    $came = ['side' => 0, 'plain' => 0, 'libretro' => 0];   // how the Games Database's pictures arrived, for the log
    $pictures = static function (array $asks) use ($source, $libretro, $backup, $skip, $where, $keep, &$came): array {
        $out  = [];
        $urls = [];
        foreach ($asks as $i => [$game, $entry, $kind]) {
            if (($no = $skip($game, $kind)) !== null) {
                $out[$i] = $no;
            } elseif ($source === 'libretro') {
                $out[$i] = $libretro($game, $entry, $kind);
            } else {
                $at = $where($game, $entry, $kind);
                if (isset($at['said'])) {
                    $out[$i] = $at['said'];
                } else {
                    $urls[$i] = $at['url'];
                }
            }
        }
        $how = null;
        $got = $urls ? xs_gamesdb_pictures_get(array_values($urls), $how) : [];
        $came['side']  += (int) ($how['side'] ?? 0);
        $came['plain'] += (int) ($how['plain'] ?? 0);
        foreach ($urls as $i => $url) {
            if (($got[$url] ?? null) === null && ($fb = $backup($asks[$i][0], $asks[$i][2])) === 'stored') {
                $came['libretro']++;
                $out[$i] = $fb;
                continue;
            }
            $out[$i] = $keep($asks[$i][0], $asks[$i][2], $got[$url] ?? null, 'could not fetch that picture from images.launchbox-app.com');
        }
        ksort($out);
        return $out;
    };
    // How many games' pictures go side by side: the boxes of four, then the other three of two.
    $side = $source === 'libretro' ? 1 : 4;
    $tally = static function (array $got) use (&$job): string {
        $said = [];
        foreach ($got as $kind => $r) {
            if ($r === 'stored') {
                $job['pictures']++;
            } elseif (str_starts_with($r, 'failed')) {
                $job['picsFailed']++;
            }
            if ($r !== 'already has one') {
                $said[] = $kind . ' ' . $r;
            }
        }
        return implode('; ', $said);
    };

    // ---- first: the name, the details and the box -----------------------------
    $pics = !empty($job['pictures_wanted']);
    $job += ['fields' => 0, 'pictures' => 0, 'failed' => 0, 'picsFailed' => 0, 'failures' => [], 'picsMissing' => []];
    $again = [];                         // the pictures that did not come, as asked: [game, database entry, kind]
    $job['phase'] = 'first';
    $job['total'] = count($todo);
    $job['done'] = 0;
    $job['restDone'] = 0;
    $save();
    xs_log('FILL', 'filling ' . count($todo) . ' games' . ($pics ? ': names, details and the box first, the other pictures after' : ', no pictures') . ($dry ? ' (dry)' : ''));
    $filled = [];
    // Out of the count, as if it had never been in the pass. $counted: its name and box were done.
    $leftOut = static function (array $game, bool $counted) use (&$job, $save): void {
        $job['gone'] = (int) ($job['gone'] ?? 0) + 1;
        $job['total']--;
        if ($counted) {
            $job['done']--;
        }
        xs_log('FILL', $game['title'] . ': hidden or taken out of the library while this ran, so left out');
        $save();
    };
    // A few games at a time: their names one by one (the server writes
    // them), then their boxes together.
    foreach (array_chunk($todo, $side) as $group) {
        $boxes = [];
        $halt  = false;
        foreach ($group as $p) {
            if ($stopped()) {
                $halt = true;                // the boxes of the games already named still come
                break;
            }
            $game = $byId[$p['id']];
            if (!$stillHere((string) $p['id'])) {
                $leftOut($game, false);
                continue;
            }
            $r = $ask('api/fill.php', ['id' => $p['id'], 'dbId' => $source === 'libretro' ? $p['dbId'] : (int) $p['dbId'],
                                       'metadata' => true, 'pictures' => [], 'dry' => $dry]);
            if (empty($r['ok']) && ($r['error'] ?? '') === 'unknown game' && !$stillHere((string) $p['id'])) {
                // It went between the look above and the server's answer.
                $leftOut($game, false);
                continue;
            }
            if (empty($r['ok'])) {
                $job['failed']++;
                if (count($job['failures']) < 20) {
                    $job['failures'][] = ['title' => (string) $game['title'], 'why' => (string) ($r['error'] ?? 'no answer')];
                }
                xs_log('FILL', $game['title'] . ' FAILED: ' . (string) ($r['error'] ?? 'no answer'));
            } else {
                $job['fields'] += count((array) ($r['filled'] ?? []));
                $filled[] = $p;
                if ($pics) {
                    $boxes[] = [$game, (string) $p['dbId'], 'box'];
                }
            }
            $job['done']++;
            $save();
        }
        foreach ($pictures($boxes) as $i => $got) {
            $said = $tally(['box' => $got]);
            if (xs_fill_retry_wanted($got)) {
                $again[] = $boxes[$i];
            }
            if ($said !== '') {
                xs_log('FILL', $boxes[$i][0]['title'] . ': ' . $said);
            }
        }
        $save();
        if ($halt) {
            xs_log('FILL', 'stopped at ' . $job['done'] . ' of ' . $job['total']);
            $end('stopped');
        }
    }
    $job['firstDone'] = true;
    $save();

    // ---- rest: the other pictures ------------------------------------------------
    if ($pics) {
        $job['phase'] = 'rest';
        $save();
        // Two games' worth together: six pictures at once is what a browser asks one site for.
        foreach (array_chunk($filled, (int) ceil($side / 2)) as $group) {
            if ($stopped()) {
                xs_log('FILL', 'stopped in the other pictures, at ' . $job['restDone'] . ' of ' . count($filled));
                $end('stopped');
            }
            $asks = [];
            foreach ($group as $p) {
                $game = $byId[$p['id']];
                if (!$stillHere((string) $p['id'])) {
                    unset($plans[$p['id']]);
                    $leftOut($game, true);
                    continue;
                }
                foreach (array_diff(XS_FILL_SLOTS, ['box']) as $kind) {
                    $asks[] = [$game, (string) $p['dbId'], $kind];
                }
            }
            $per = [];                       // game id => its slots' answers, in the order asked
            foreach ($pictures($asks) as $i => $got) {
                $per[(string) $asks[$i][0]['id']][$asks[$i][2]] = $got;
                if (xs_fill_retry_wanted($got)) {
                    $again[] = $asks[$i];
                }
            }
            foreach ($group as $p) {
                if (!isset($per[(string) $p['id']])) {
                    continue;                // left out above
                }
                $said = $tally($per[(string) $p['id']]);
                if ($said !== '') {
                    xs_log('FILL', $byId[$p['id']]['title'] . ': ' . $said);
                }
                unset($plans[$p['id']]);
                $job['restDone']++;
            }
            $save();
        }
    }

    // ---- again: the pictures that did not come, each asked for once more -----------
    if ($again) {
        $job['phase'] = 'again';
        $job['againAll'] = count($again);
        $job['againAt'] = 0;
        $save();
        xs_log('FILL', count($again) . ' pictures did not come: each is asked for once more, one at a time');
        // A console's list that did not come is fetched again too, or every picture of that console fails unasked.
        $listsIn = array_filter($lists, static fn ($l): bool => $l !== null);
        if (count($listsIn) < count($lists)) {
            xs_log('FILL', (count($lists) - count($listsIn)) . ' of libretro\'s lists did not come the first time: each is fetched once more');
        }
        $lists = $listsIn;
        $twice = xs_fill_retry($again, static function (array $ask) use (&$plans, $pictures): string {
            $id = (string) $ask[0]['id'];
            if (isset($plans[$id]) && empty($plans[$id]['ok'])) {
                unset($plans[$id]);                    // the database is asked afresh where it was what failed: once a game, not once a picture
            }
            return (string) ($pictures([$ask])[0] ?? 'failed: no answer');
        }, $stopped, static function (array $ask, string $got) use (&$job, $save): void {
            $job['againAt']++;
            xs_log('FILL', $ask[0]['title'] . ': ' . $ask[2] . ' asked for once more: ' . $got);
            $save();
        });
        $job['pictures']   += $twice['came'];
        $job['picsFailed']  = max(0, $job['picsFailed'] - $twice['came'] - $twice['dropped']);
        $job['picsMissing'] = array_slice($twice['missing'], 0, 20);
        $save();
        if ($twice['stopped']) {
            xs_log('FILL', 'stopped while asking again, at ' . $job['againAt'] . ' of ' . count($again));
            $end('stopped');
        }
    }

    /* Nothing Xsegon is sure of is left, so Getting started checks its step
       off instead of counting unmatched games as work. A run of picked games
       is told so by the page (complete). */
    if (($mode === 'all' || !empty($job['complete'])) && $job['failed'] === 0 && !$dry) {
        $ask('api/setup.php', ['asked' => 'fill']);
    }
    if ($came['libretro'] > 0) {
        xs_log('FILL', 'LaunchBox\'s picture server did not give ' . $came['libretro'] . ' pictures that libretro\'s thumbnails then did');
    }
    if ($came['side'] + $came['plain'] > 0) {
        xs_log('FILL', 'the pictures came ' . $came['side'] . ' side by side and ' . $came['plain'] . ' one at a time');
    }
    xs_log('FILL', 'finished: ' . ($job['done'] - $job['failed']) . ' games, ' . $job['fields'] . ' details, ' . $job['pictures'] . ' pictures'
        . ($job['failed'] ? ', ' . $job['failed'] . ' games failed' : '') . ($job['picsFailed'] ? ', ' . $job['picsFailed'] . ' pictures could not be fetched' : ''));
    // The games left to a person, said once in the mailbox with the way to them (includes\fill.php).
    if ($mode === 'all' && !$dry) {
        xs_fill_tell($checkRows ?? []);
        $job['told'] = xs_fill_told();       // the ending names Messages only while that message is there
    }
    $end('done');
} catch (Throwable $e) {
    xs_log('FILL', 'the worker stopped on an error: ' . $e->getMessage() . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ')');
    $end('failed', 'Get Pictures stopped on an error: ' . $e->getMessage());
}
