<?php
/**
 * Xsegon - which games' pictures, video or details changed lately, for the
 * Recently changed collection (api\library.php).
 *
 *   data\changed.json:  { "<game id>": {"at": "2026-10-15 17:02:11", "what": "video"} }
 *
 * Written by whatever saves a picture, a video or an edit for a game, never
 * worked out by looking at the files, so a library read stays one small file
 * at 40,000 games. "what" is the last thing that changed: a picture's kind
 * (box, logo...), video or details. A note over a year old goes at a write.
 */
declare(strict_types=1);

function xs_changed_path(): string
{
    return xs_data_path('changed.json');
}

/** [game id => ['at' => 'Y-m-d H:i:s', 'what' => ...]] */
function xs_changed(): array
{
    $c = xs_read_json(xs_changed_path(), []);
    return is_array($c) ? $c : [];
}

/**
 * These games changed now. A request writes at its end, before php -S closes
 * its answer; a worker every 30 seconds and at its end. So a Steam import or
 * a pass saving thousands of pictures writes the file a few times, not once a picture.
 */
function xs_changed_note(array $ids, string $what): void
{
    foreach ($ids as $id) {
        xs_changed_hold((string) $id, $what, time());
    }
    if (time() - ($GLOBALS['xs_changed_wrote'] ?? time()) >= 30) {
        xs_changed_flush();
    }
}

/** One note held for the next write; of two for one game, the newer. */
function xs_changed_hold(string $id, string $what, int $at): void
{
    if (!isset($GLOBALS['xs_changed_wrote'])) {
        $GLOBALS['xs_changed_held']  = [];
        $GLOBALS['xs_changed_wrote'] = time();
        register_shutdown_function('xs_changed_flush');
    }
    $row = ['at' => date('Y-m-d H:i:s', $at), 'what' => $what];
    if ($id !== '' && $row['at'] >= (string) ($GLOBALS['xs_changed_held'][$id]['at'] ?? '')) {
        $GLOBALS['xs_changed_held'][$id] = $row;
    }
}

/** The held notes written in, each beside or over what the file has for its game, the newer kept. */
function xs_changed_flush(): void
{
    $held = $GLOBALS['xs_changed_held'] ?? [];
    if (!$held) {
        return;
    }
    $GLOBALS['xs_changed_held']  = [];
    $GLOBALS['xs_changed_wrote'] = time();
    // The page and the workers write it, at times at once: one at a time, or a note is lost.
    $lock = @fopen(xs_changed_path() . '.lock', 'c');
    if ($lock) {
        flock($lock, LOCK_EX);
    }
    $old = date('Y-m-d H:i:s', strtotime('-1 year'));
    $all = array_filter(xs_changed(), static fn ($r): bool => is_array($r) && (string) ($r['at'] ?? '') >= $old);
    foreach ($held as $id => $row) {
        if ($row['at'] >= $old && $row['at'] >= (string) ($all[$id]['at'] ?? '')) {
            $all[$id] = $row;
        }
    }
    xs_write_json(xs_changed_path(), $all ?: new stdClass());
    if ($lock) {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

/**
 * After a fetch: each game whose video file came at or after $since, from
 * [game id => its video file or null], noted at the file's own time. A file
 * there from before (a fetch carried on) is not news. Written at once,
 * before the fetch reads as ended. Answers their ids.
 */
function xs_changed_videos(array $files, int $since): array
{
    $ids = [];
    foreach ($files as $id => $f) {
        $at = is_string($f) && $f !== '' ? (int) @filemtime($f) : 0;
        if ($at > 0 && $at >= $since) {
            xs_changed_hold((string) $id, 'video', $at);
            $ids[] = (string) $id;
        }
    }
    xs_changed_flush();
    return $ids;
}

/**
 * A fetch that brought videos says so in Messages, with the way to Recently
 * changed: the games that got one, each with its console where it has one.
 */
function xs_changed_tell(string $from, array $games, string $unit = 'video'): void
{
    if (!$games) {
        return;
    }
    require_once __DIR__ . '/news.php';
    $n = count($games);
    $lines = array_map(static fn ($g): string => (string) ($g['title'] ?? '?')
        . ((string) ($g['platform'] ?? '') !== '' ? '  (' . $g['platform'] . ')' : ''), array_values($games));
    xs_messages_add([
        'id'    => 'msg-' . bin2hex(random_bytes(6)),
        'at'    => date('c'),
        'kind'  => 'videos',
        'title' => ($n === 1 ? 'A ' . $unit . ' came' : $n . ' ' . $unit . 's came') . ' from ' . $from,
        'body'  => 'Recently changed holds ' . ($n === 1 ? 'the game that got it.' : 'the games that got them.'),
        'items' => array_slice($lines, 0, 12),
        'n'     => $n,
        'show'  => '@changed',
        'read'  => false,
    ]);
    xs_log('NEWS', 'kept in the mailbox: ' . $n . ' ' . $unit . ($n === 1 ? '' : 's') . ' from ' . $from);
}

/**
 * A ScreenScraper or Steam fetch that ended, once each: its videos noted, and
 * said in Messages. Their fetchers are PowerShell and leave only the job
 * file, so this is asked on the main server's own poll (api\status.php); the
 * fast lane never writes. Which fetch was seen to is kept apart, by its
 * start (data\changed-fetches.json): the job files stay the fetchers' own.
 */
function xs_changed_fetches(): void
{
    if (xs_fast_lane()) {
        return;
    }
    require_once __DIR__ . '/screenscraper.php';
    require_once __DIR__ . '/steamvid.php';
    require_once __DIR__ . '/news.php';
    $seenPath = xs_data_path('changed-fetches.json');
    $fetches = ['screenscraper' => [xs_ss_job_path(), xs_ss_dir(), 'ScreenScraper', 'video'],
                'steamvid'      => [xs_steamvid_job_path(), xs_steamvid_dir(), 'Steam', 'trailer']];
    foreach ($fetches as $kind => [$path, $dir, $from, $unit]) {
        $job = is_file($path) ? xs_read_json($path, null) : null;
        if (!is_array($job) || !in_array($job['state'] ?? '', ['done', 'failed'], true)) {
            continue;
        }
        $seen = xs_read_json($seenPath, []);
        $seen = is_array($seen) ? $seen : [];
        $started = (int) ($job['started'] ?? 0);
        if ((int) ($seen[$kind] ?? -1) === $started) {
            continue;
        }
        // Kept first, so a failed write is not said again at every poll.
        $seen[$kind] = $started;
        if (!xs_write_json($seenPath, $seen)) {
            continue;
        }
        // Each saves a game's video as <game id>.mp4 in its own folder (xs_ss_for, xs_steamvid_for).
        $files = [];
        $games = [];
        foreach ($job['games'] ?? [] as $g) {
            if (($g['state'] ?? '') === 'done' && (string) ($g['id'] ?? '') !== '') {
                $files[(string) $g['id']] = $dir . DIRECTORY_SEPARATOR . $g['id'] . '.mp4';
                $games[(string) $g['id']] = $g;
            }
        }
        $got = xs_changed_videos($files, $started);
        // Its last write is its end. One found ended long after (Xsegon closed meanwhile) is no news, as trouble is not.
        if ((int) @filemtime($path) >= time() - XS_TROUBLE_NEWS_DAYS * 86400) {
            xs_changed_tell($from, array_intersect_key($games, array_flip($got)), $unit);
        }
    }
}

/** The games of these consoles, from [art_key(console) => [game, ...]]. */
function xs_changed_on(array $consoles, array $platforms): array
{
    $out = [];
    foreach ($platforms as $p) {
        array_push($out, ...($consoles[art_key((string) $p)] ?? []));
    }
    return $out;
}

/**
 * The same for a fetch into data\videos, which files by name: every game on
 * those consoles, its video looked for on the disk as it is now (video_index
 * keeps what it saw when the worker started). Answers the games noted.
 */
function xs_changed_videos_by_name(array $s, array $games, int $since): array
{
    $now   = [];
    $files = [];
    foreach ($games as $g) {
        $p = art_key((string) $g['platform']);
        $now[$p] ??= video_console_now($s, (string) $g['platform']);
        $files[(string) $g['id']] = video_for([$p => $now[$p]], (string) $g['platform'],
            (string) ($g['sourceKey'] ?? $g['key']), $g['romPath'] ?? null);
    }
    $got = array_flip(xs_changed_videos($files, $since));
    return array_values(array_filter($games, static fn ($g): bool => isset($got[(string) $g['id']])));
}
