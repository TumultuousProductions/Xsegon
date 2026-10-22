<?php
/**
 * Xsegon - Steam trailers as video snaps, from each game's store page. Some
 * are a plain mp4 on Steam's video server; newer ones only a stream (HLS),
 * whose pieces Xsegon joins into one file itself (bin\streamsave.php).
 *
 * Each trailer is saved as data\videos-steam\<game id>.mp4 and found after a
 * video you chose and after the copy in data\media, so it only fills a gap. Left out of
 * backups. Nothing here ships: each person fetches their own, for games they have.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/video.php';

function xs_steamvid_dir(): string
{
    return xs_data_path('videos-steam');
}

function xs_steamvid_job_path(): string
{
    return xs_data_path('steamvid-job.json');
}

/** The trailer saved for this game, or null. */
function xs_steamvid_for(string $id): ?string
{
    static $index = null;
    if ($index === null) {
        $index = [];
        foreach (@scandir(xs_steamvid_dir()) ?: [] as $f) {
            if (strtolower(pathinfo($f, PATHINFO_EXTENSION)) === 'mp4') {
                $index[pathinfo($f, PATHINFO_FILENAME)] = xs_steamvid_dir() . DIRECTORY_SEPARATOR . $f;
            }
        }
    }
    return $index[$id] ?? null;
}

/**
 * Where the worker asks: Steam's store API and its video server. Tests point
 * both at stand-ins (XSEGON_STEAMVID_*), honoured only beside XSEGON_DATA.
 */
function xs_steamvid_sources(): array
{
    $api = getenv('XSEGON_STEAMVID_API');
    $cdn = getenv('XSEGON_STEAMVID_CDN');
    if (is_string($api) && $api !== '' && is_string($cdn) && $cdn !== '' && getenv('XSEGON_DATA')) {
        return ['api' => $api, 'cdn' => $cdn];
    }
    return [
        'api' => 'https://store.steampowered.com/api/appdetails?appids={appid}&filters=movies',
        'cdn' => 'https://cdn.akamai.steamstatic.com/steam/apps/{movie}/movie_max.mp4',
    ];
}

/** What joins a trailer Steam only streams into one file: this PHP and bin\streamsave.php. */
function xs_steamvid_saver(): array
{
    return [xs_php_exe(), XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'streamsave.php'];
}

/** The games a fetch found no trailer for: {"from": that fetch's start, "games": {id: {at, why}}}. */
function xs_steamvid_none_path(): string
{
    return xs_data_path('steamvid-none.json');
}

/** The games Steam had no trailer for. One kept as "stream only" by a copy that had no way to save streams is asked again. */
function xs_steamvid_none(): array
{
    $none  = xs_read_json(xs_steamvid_none_path(), []);
    $games = is_array($none) && is_array($none['games'] ?? null) ? $none['games'] : [];
    return array_filter($games, static fn ($g): bool => !is_array($g) || ($g['why'] ?? '') !== 'stream');
}

/**
 * Keeps, once per ended fetch, the games Steam had no trailer for, so the list
 * shows them apart. One saved since is let go; a failed ask changes nothing.
 */
function xs_steamvid_keep_none(array $job): void
{
    $file    = xs_read_json(xs_steamvid_none_path(), []);
    $started = (int) ($job['started'] ?? 0);
    if (is_array($file) && isset($file['from']) && (int) $file['from'] === $started) {
        return;
    }
    $games = xs_steamvid_none();
    $kept  = 0;
    foreach ($job['games'] ?? [] as $g) {
        $id    = (string) ($g['id'] ?? '');
        $state = (string) ($g['state'] ?? '');
        if ($id !== '' && $state === 'none') {
            $games[$id] = ['at' => (int) ($job['ended'] ?? time()), 'why' => $state];
            $kept++;
        } elseif ($id !== '' && $state === 'done') {
            unset($games[$id]);
        }
    }
    if (!$games && !is_file(xs_steamvid_none_path())) {
        return;
    }
    xs_write_json(xs_steamvid_none_path(), ['from' => $started, 'games' => $games]);
    if ($kept) {
        xs_log('STEAMV', $kept . ' with no trailer kept apart, ' . count($games) . ' in all');
    }
}

/**
 * Every Steam game, with whether it has a video already and from where.
 * A game with any video is left alone, wherever it came from
 * (video_for_game). One with none that a fetch found no trailer for says so in 'tried', and when in 'triedAt'.
 */
function xs_steamvid_games(array $s, array $library): array
{
    $rows = [];
    $none = xs_steamvid_none();
    foreach ($library['games'] ?? [] as $g) {
        $appid = (string) ($g['launch']['steam']['id'] ?? '');
        if ($appid === '' || !ctype_digit($appid)) {
            continue;
        }
        $video = video_for_game($s, $g);
        $tried = $video === null ? ($none[(string) $g['id']] ?? null) : null;
        $rows[] = [
            'id'      => (string) $g['id'],
            'title'   => (string) $g['title'],
            'appid'   => $appid,
            'has'     => $video !== null,
            'trailer' => $video !== null && xs_steamvid_for((string) $g['id']) === $video,
            'tried'   => is_array($tried) ? (string) ($tried['why'] ?? 'none') : '',
            'triedAt' => is_array($tried) ? (int) ($tried['at'] ?? 0) : 0,
        ];
    }
    usort($rows, static fn ($a, $b) => strcasecmp($a['title'], $b['title']));
    return $rows;
}

/** The job as the page sees it. */
function xs_steamvid_job(): ?array
{
    // Settled: a read at the moment the fetcher saves would let the window lose its fetch.
    $job = xs_read_json_settled(xs_steamvid_job_path(), null);
    if (!is_array($job)) {
        return null;
    }
    // A worker that died would leave "running" for ever. One alive is at work however long a large fetch takes.
    if (($dead = xs_job_dead($job, xs_steamvid_job_path())) !== null) {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped part way (' . $dead . '); start it again and it carries on where it stopped';
        $job['failLogged'] = true;
        xs_write_json(xs_steamvid_job_path(), $job);
        xs_log('STEAMV', 'the trailer fetch stopped: ' . $dead . '; marked failed');
    }
    // A fetch that failed outright is logged once, not only in the job file.
    if (($job['state'] ?? '') === 'failed' && empty($job['failLogged'])) {
        $job['failLogged'] = true;
        xs_write_json(xs_steamvid_job_path(), $job);
        xs_log('STEAMV', 'trailers failed: ' . ($job['error'] ?? '(no reason written)'));
    }
    if (($job['state'] ?? '') === 'done' && empty($job['logged'])) {
        $count = array_count_values(array_map(static fn ($g) => (string) ($g['state'] ?? ''), $job['games'] ?? []));
        xs_log('STEAMV', 'trailers: ' . ($count['done'] ?? 0) . ' saved, ' . ($count['none'] ?? 0) . ' with none on Steam, '
            . ($count['failed'] ?? 0) . ' failed');
        $job['logged'] = true;
        xs_write_json(xs_steamvid_job_path(), $job);
    }
    if (in_array($job['state'] ?? '', ['done', 'failed'], true)) {
        xs_steamvid_keep_none($job);
    }
    return $job;
}

/**
 * The fetch for these Steam games with no video, as its job file holds it (null: every one no fetch found
 * none for before), or null when none of them is one.
 */
function xs_steamvid_plan(array $s, array $library, ?array $ids): ?array
{
    $want = $ids === null ? null : array_flip(array_map('strval', $ids));
    $pick = array_values(array_filter(xs_steamvid_games($s, $library),
        static fn ($r) => !$r['has'] && ($want === null ? $r['tried'] === '' : isset($want[$r['id']]))));
    if (!$pick) {
        return null;
    }
    $src = xs_steamvid_sources();
    return [
        'state'   => 'running',
        'started' => time(),
        'dir'     => xs_steamvid_dir(),
        'api'     => $src['api'],
        'cdn'     => $src['cdn'],
        'saver'   => xs_steamvid_saver(),
        'games'   => array_map(static fn ($r) => ['id' => $r['id'], 'title' => $r['title'], 'appid' => $r['appid'], 'state' => 'waiting'], $pick),
    ];
}

/** Write the job and start the fetcher. False with $why. */
function xs_steamvid_start(array $plan, ?string &$why = null): bool
{
    $why = null;
    if (!xs_write_json(xs_steamvid_job_path(), $plan, $why)) {
        return false;
    }
    $script = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'steamvid.ps1';
    if (!xs_spawn_ps(xs_ps_call($script, ['Job' => xs_steamvid_job_path()]))) {
        $why = 'the trailer fetcher could not be started';
        return false;
    }
    xs_log('STEAMV', 'fetch asked for ' . count($plan['games']) . ' trailers');
    return true;
}
