<?php
/**
 * Xsegon - videos for the arcade games that have none, from the Arcade Database.
 *
 * Part of Pictures & Videos > Videos from online archives: with an arcade console
 * chosen, this runs first and then starts the rest of that fetch (includes\archivevid.php).
 *
 * The Arcade Database (adb.arcadeitalia.net, by motoschifo) is asked by MAME's name
 * for a game. One ask and one file at a time, as its makers ask of a program.
 * A video is filed as data\videos\<Console>\<Title>; nothing of its answers is kept.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/archivevid.php';

/** How the source is named wherever its videos are spoken of: its makers ask for that. */
const XS_AD_NAME = 'the Arcade Database (adb.arcadeitalia.net)';

function xs_ad_job_path(): string
{
    return xs_data_path('arcadevid-job.json');
}

function xs_ad_stop_path(): string
{
    return xs_data_path('arcadevid-stop');
}

/** The job as its worker left it, or null; a worker that is gone is said. */
function xs_ad_job(): ?array
{
    $job = xs_read_json(xs_ad_job_path(), null);
    if (!is_array($job)) {
        return null;
    }
    $dead = xs_job_dead($job, xs_ad_job_path());
    if ($dead !== null) {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped before it finished: ' . $dead;
    }
    return $job;
}

/**
 * Where the worker asks. XSEGON_ARCADEDB points a test at stand-ins, honoured only
 * on a test copy; 'base' is where a video's address must start to be fetched.
 */
function xs_ad_source(): array
{
    $test = getenv('XSEGON_ARCADEDB');
    if (is_string($test) && $test !== '' && xs_test_copy()) {
        $base = rtrim($test, '/');
        return ['ask' => $base . '/query_mame/{name}.json', 'left' => $base . '/download_status.json', 'base' => $base . '/', 'real' => false];
    }
    $base = 'https://adb.arcadeitalia.net/';
    return ['ask' => $base . 'service_scraper.php?ajax=query_mame&game_name={name}', 'left' => $base . 'service_scraper.php?ajax=download_status',
            'base' => $base, 'real' => true];
}

/** Whether a console's games are arcade games, which is what the Arcade Database knows. */
function xs_ad_is_arcade(string $platform): bool
{
    return (xs_vm_console($platform)['name'] ?? '') === 'Arcade';
}

/** The name MAME gives a game, from its file's name (sf2.zip is sf2). Null for a file not named that way. */
function xs_ad_name(string $file): ?string
{
    $stem = strtolower(pathinfo(str_replace('\\', '/', $file), PATHINFO_FILENAME));
    return preg_match('/^[a-z0-9][a-z0-9_]{0,31}$/', $stem) === 1 ? $stem : null;
}

/**
 * The arcade games here that have no video, on these consoles or on all when none is named:
 * [id, title, platform, file, 'name' => MAME's or null].
 */
function xs_ad_need(array $s, array $library, array $platforms = []): array
{
    $only  = array_flip(array_map('strval', $platforms));
    $games = [];
    // One looked for before with nothing found anywhere is left out until Look again (includes\archivevid.php).
    foreach (xs_av_unlooked(xs_vp_need($s, $library)) as $g) {
        if (xs_ad_is_arcade($g['platform']) && (!$only || isset($only[$g['platform']]))) {
            $games[] = $g + ['name' => xs_ad_name($g['file'])];
        }
    }
    return $games;
}

/** What the Arcade Database said of one game. Null when it is no such answer. ['known', 'parent', 'video' => its address or '']. */
function xs_ad_answer(string $json): ?array
{
    $doc = json_decode(xs_strip_bom($json), true);
    if (!is_array($doc) || !is_array($doc['result'] ?? null)) {
        return null;
    }
    $row = $doc['result'][0] ?? null;
    if (!is_array($row)) {
        return ['known' => false, 'parent' => '', 'video' => ''];
    }
    $url = $row['url_video_shortplay'] ?? '';
    // Only an address of the Arcade Database's own is ever fetched.
    return ['known' => true, 'parent' => (string) (xs_ad_name((string) ($row['cloneof'] ?? '')) ?? ''),
            'video' => is_string($url) && str_starts_with($url, xs_ad_source()['base']) ? $url : ''];
}

/** How many files it will still give today, from its own answer; null when that is no such answer. */
function xs_ad_left(string $json): ?int
{
    $doc = json_decode(xs_strip_bom($json), true);
    $res = is_array($doc) ? ($doc['result'] ?? null) : null;
    if (!is_array($res) || !isset($res['download_limit_files'])) {
        return null;
    }
    return (int) ($res['download_limit_bytes'] ?? 1) > 0 ? max(0, (int) $res['download_limit_files']) : 0;
}

/**
 * Fetch a video for each arcade game that has none. With $then, the online
 * archives' fetch waits on this one and is started when it ends, however it ends.
 */
function xs_ad_start(array $platforms = [], bool $then = false, ?string &$why = null): bool
{
    $why = null;
    if ((xs_ad_job()['state'] ?? '') === 'running') {
        $why = 'videos are being fetched from the Arcade Database already: that has to finish first';
        return false;
    }
    if (xs_curl_exe() === '') {
        $why = 'Windows\' own curl.exe is not on this PC (it comes with Windows 10 from 2018 on), and that is what fetches the videos';
        return false;
    }
    $named = count(array_filter(xs_ad_need(xs_settings(), xs_library(), $platforms), static fn ($g) => $g['name'] !== null));
    if ($named === 0) {
        $why = 'no arcade game with no video has a file named the way MAME names a game (sf2.zip), so there is none to ask about';
        return false;
    }
    $job = ['state' => 'running', 'phase' => 'starting', 'started' => time(), 'platforms' => array_values($platforms), 'then' => $then,
            'games' => $named, 'at' => 0, 'now' => '', 'added' => 0, 'bytes' => 0, 'said' => ''];
    @unlink(xs_ad_stop_path());
    if (!xs_write_json(xs_ad_job_path(), $job, $why)) {
        return false;
    }
    if (!xs_spawn_worker('arcadevid.php')) {
        $why = 'it could not be started';
        xs_write_json(xs_ad_job_path(), ['state' => 'failed', 'error' => $why] + $job);
        return false;
    }
    xs_log('ARCD', 'asked to fetch videos from the Arcade Database for ' . $named . ' arcade games'
        . ($then ? ', before the online archives are asked for the rest' : ''));
    return true;
}

/**
 * Called by xs_av_start with its job written, before its worker starts. True when the
 * Arcade Database goes first and its worker starts that one; false leaves it to the caller.
 */
function xs_ad_first(array $platforms): bool
{
    $arcade = array_values(array_filter(array_map('strval', $platforms), 'xs_ad_is_arcade'));
    if (!$arcade) {
        return false;
    }
    $why = null;
    if (xs_ad_start($arcade, true, $why)) {
        return true;
    }
    xs_log('ARCD', 'the Arcade Database is not asked first: ' . $why);
    return false;
}

/** The worker of the fetch from the online archives, started for a job that is waiting on this one. */
function xs_ad_hand_on(): void
{
    $theirs = xs_read_json(xs_av_job_path(), null);
    if (!is_array($theirs) || ($theirs['state'] ?? '') !== 'running' || !empty($theirs['pid'])) {
        xs_log('ARCD', 'the fetch from the online archives was not waiting any more, so it was not started');
        return;
    }
    // The worker starts long after its job was written: marked, or xs_job_dead takes it for another program.
    xs_write_json(xs_av_job_path(), ['handed' => time()] + $theirs);
    if (!xs_spawn_worker('archivevid.php')) {
        xs_write_json(xs_av_job_path(), ['state' => 'failed', 'error' => 'it could not be started after the Arcade Database\'s part'] + $theirs);
        xs_log('ARCD', 'the fetch from the online archives could not be started after this one');
        return;
    }
    xs_log('ARCD', 'the fetch from the online archives is started for the rest');
}
