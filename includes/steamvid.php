<?php
/**
 * Xsegon - Steam trailers as video snaps, from each game's store page. Most
 * are a plain mp4 on Steam's video server; some only a stream (HLS), which
 * ffmpeg can save when it is on the computer.
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

/** ffmpeg, for the trailers Steam only streams. '' when there is none. */
function xs_ffmpeg(): string
{
    $test = getenv('XSEGON_FFMPEG');
    if (is_string($test) && getenv('XSEGON_DATA')) {
        return $test !== '' && is_file($test) ? $test : '';
    }
    // The one a download carries first, as the playthrough cutter looks (xs_av_ffmpeg).
    $own = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'ffmpeg.exe';
    if (is_file($own)) {
        return $own;
    }
    $out = @shell_exec('where ffmpeg 2>NUL');
    if (is_string($out)) {
        foreach (preg_split('/\r?\n/', trim($out)) as $line) {
            if ($line !== '' && is_file($line)) {
                return $line;
            }
        }
    }
    foreach (['C:\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe'] as $p) {
        if (is_file($p)) {
            return $p;
        }
    }
    return '';
}

/** The games a fetch found no trailer for: {"from": that fetch's start, "games": {id: {at, why}}}. */
function xs_steamvid_none_path(): string
{
    return xs_data_path('steamvid-none.json');
}

function xs_steamvid_none(): array
{
    $none = xs_read_json(xs_steamvid_none_path(), []);
    return is_array($none) && is_array($none['games'] ?? null) ? $none['games'] : [];
}

/**
 * Keeps, once per ended fetch, the games Steam had no trailer for or only
 * streams, so the list shows them apart. One saved since is let go; a failed ask changes nothing.
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
        if ($id !== '' && ($state === 'none' || $state === 'stream')) {
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
            . ($count['stream'] ?? 0) . ' stream only, ' . ($count['failed'] ?? 0) . ' failed');
        $job['logged'] = true;
        xs_write_json(xs_steamvid_job_path(), $job);
    }
    if (in_array($job['state'] ?? '', ['done', 'failed'], true)) {
        xs_steamvid_keep_none($job);
    }
    return $job;
}
