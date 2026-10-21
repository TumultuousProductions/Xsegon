<?php
/**
 * Xsegon - videos for the games here from a package made on another PC (the Get Media window).
 *
 *   Export Games with No videos    a small list of the games here that have none, to send
 *   Import Xsegon Video Package    a package made from that list: its videos onto those games
 *
 * The package is made elsewhere. An imported video is filed as
 * data\videos\<Console>\<Title>, where a video is found by name, and only for
 * a game that still has none.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/art.php';
require_once __DIR__ . '/videomatch.php';
require_once __DIR__ . '/zipstore.php';

const XS_VP_LIST     = 'games-with-no-videos';
const XS_VP_PACKAGE  = 'video-package';
const XS_VP_MANIFEST = 'xsegon-video-package.json';

function xs_vp_job_path(): string
{
    return xs_data_path('videopack-job.json');
}

function xs_vp_stop_path(): string
{
    return xs_data_path('videopack-stop');
}

/** The job as its worker left it, or null; a worker that is gone is said. */
function xs_vp_job(): ?array
{
    $job = xs_read_json(xs_vp_job_path(), null);
    if (!is_array($job)) {
        return null;
    }
    $dead = xs_job_dead($job, xs_vp_job_path());
    if ($dead !== null) {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped before it finished: ' . $dead;
    }
    return $job;
}

/** A name with nothing in it Windows refuses in a file's name. */
function xs_vp_safe(string $name): string
{
    $name = (string) preg_replace('/[<>:"\/\\\\|?*\x00-\x1f]/', '_', $name);
    return rtrim(mb_substr(trim($name), 0, 90, 'UTF-8'), '. ');
}

// ---- the list a PC exports ---------------------------------------------------

/** Every game here that has no video: id, title, platform and its file's name. */
function xs_vp_need(array $s, array $library): array
{
    require_once __DIR__ . '/video.php';
    $rows = [];
    foreach ($library['games'] ?? [] as $g) {
        if (video_for_game($s, $g) !== null) {
            continue;
        }
        $rows[] = ['id' => (string) $g['id'], 'title' => (string) $g['title'], 'platform' => (string) $g['platform'],
                   'file' => basename(str_replace('\\', '/', (string) ($g['romPath'] ?? '')))];
    }
    usort($rows, static fn ($a, $b) => strcasecmp($a['platform'], $b['platform']) ?: strcasecmp($a['title'], $b['title']));
    return $rows;
}

/** The list's file name: the day only, and nothing of the computer it comes from. */
function xs_vp_list_name(): string
{
    return 'xsegon-no-videos-' . date('Y-m-d') . '.json';
}

function xs_vp_list_doc(array $rows): array
{
    return ['xsegon' => XS_VP_LIST, 'version' => 1, 'made' => date('c'),
            'note' => 'Games with no video, listed by Xsegon. A video package made from this list goes in with Get Media > Import Xsegon Video Package.',
            'games' => $rows];
}

// ---- starting the jobs ---------------------------------------------------

/** bin\videopack.php, started for the job just written. */
function xs_vp_spawn(array $job, ?string &$why = null): bool
{
    @unlink(xs_vp_stop_path());
    if (!xs_write_json(xs_vp_job_path(), $job, $why)) {
        return false;
    }
    $cmd = [xs_php_exe(), '-d', 'display_errors=0', '-d', 'date.timezone=' . date_default_timezone_get(),
            XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'videopack.php'];
    $h = @popen('start /B "" ' . implode(' ', array_map(static fn ($a) => '"' . $a . '"', $cmd)) . ' > NUL 2>&1', 'r');
    if ($h === false) {
        $why = 'it could not be started';
        xs_write_json(xs_vp_job_path(), ['state' => 'failed', 'error' => $why] + $job);
        return false;
    }
    pclose($h);
    return true;
}

function xs_vp_busy(?string &$why): bool
{
    if ((xs_vp_job()['state'] ?? '') === 'running') {
        $why = 'a video package is being worked on already: that has to finish first';
        return true;
    }
    return false;
}

/** What a package says of itself: ['dir' => its files, 'doc' => its list of games], or null with why. */
function xs_vp_package_read(string $package, ?string &$why = null): ?array
{
    $why = null;
    if (!is_file($package)) {
        $why = 'that file is not there';
        return null;
    }
    $dir = xs_zs_list($package);
    $raw = $dir !== null && isset($dir[XS_VP_MANIFEST]) ? xs_zs_bytes($package, $dir[XS_VP_MANIFEST]) : null;
    $doc = $raw !== null ? json_decode(xs_strip_bom($raw), true) : null;
    if (!is_array($doc) || ($doc['xsegon'] ?? '') !== XS_VP_PACKAGE || !is_array($doc['games'] ?? null)) {
        $why = $dir === null ? 'that file is not a .zip that can be read' : 'that .zip is not an Xsegon video package';
        return null;
    }
    return ['dir' => $dir, 'doc' => $doc];
}

/** Put a package's videos onto the games here that have none. */
function xs_vp_start_import(string $package, ?string &$why = null): bool
{
    $why = null;
    if (xs_vp_busy($why)) {
        return false;
    }
    $pkg = xs_vp_package_read($package, $why);
    if ($pkg === null) {
        return false;
    }
    $job = ['kind' => 'import', 'state' => 'running', 'phase' => 'starting', 'started' => time(), 'package' => $package,
            'games' => count($pkg['doc']['games']), 'at' => 0, 'added' => 0, 'bytes' => 0, 'total' => 0, 'said' => ''];
    if (!xs_vp_spawn($job, $why)) {
        return false;
    }
    xs_log('VPK', 'asked to import ' . basename($package) . ' (' . count($pkg['doc']['games']) . ' videos)');
    return true;
}

// ---- where an imported video goes --------------------------------------------

/**
 * The names a video can be filed under in data\videos so this game finds it,
 * best first: its title, else its ROM's name, else the key it is looked up
 * by. The next is tried when one would clash. None for a game whose name has
 * no letter or digit to look it up by.
 */
function xs_vp_stems_for(array $game): array
{
    $key = (string) ($game['sourceKey'] ?? $game['key'] ?? '');
    $rom = pathinfo(str_replace('\\', '/', (string) ($game['romPath'] ?? '')), PATHINFO_FILENAME);
    $out = [];
    foreach ([[xs_vp_safe((string) ($game['title'] ?? '')), $key], [xs_vp_safe($rom), art_key($rom)], [$key, $key]] as [$stem, $want]) {
        if ($stem !== '' && $want !== '' && art_key_from_filename($stem . '.mp4') === $want && !in_array($stem, $out, true)) {
            $out[] = $stem;
        }
    }
    return $out;
}

/**
 * Where a fetched video for this game is saved in data\videos, looked at just
 * before it is: a fetch fills a gap and never changes the video another game
 * plays. Null with $why when this game plays one already ($has), or when every
 * name it would be found by would also be found first by a game playing
 * another. $console: the library's games on its console. $index: that
 * console's videos by name (video_console_now), else read from the disk now.
 */
function xs_vp_dest_now(array $s, array $game, array $console, string $ext, ?string &$why = null,
                        ?bool &$has = null, ?array $index = null): ?string
{
    require_once __DIR__ . '/video.php';
    $why   = null;
    $has   = false;
    $index ??= video_console_now($s, (string) $game['platform']);
    $romKey = static fn (array $g): string => art_key(pathinfo(str_replace('\\', '/', (string) ($g['romPath'] ?? '')), PATHINFO_FILENAME));
    // What a game plays from above the names (chosen, the copy, a trailer), and by name or ScreenScraper below them.
    $above = static function (array $g): bool {
        $id = (string) $g['id'];
        foreach (array_keys(video_types()) as $e) {
            if (is_file(video_own_dir() . DIRECTORY_SEPARATOR . $id . '.' . $e)) {
                return true;
            }
        }
        return (media_index()[$id]['video'] ?? null) !== null || is_file(xs_steamvid_dir() . DIRECTORY_SEPARATOR . $id . '.mp4');
    };
    $below = static fn (array $g): bool => isset($index[(string) ($g['sourceKey'] ?? $g['key'] ?? '')]) || isset($index[$romKey($g)])
        || is_file(xs_ss_dir() . DIRECTORY_SEPARATOR . (string) $g['id'] . '.mp4');
    if ($above($game) || $below($game)) {
        $has = true;
        $why = 'it has a video now';
        return null;
    }
    $dir = xs_vp_safe((string) $game['platform']);
    $stems = art_key($dir) !== '' ? xs_vp_stems_for($game) : [];
    if (!$stems) {
        $why = 'its name has no letter or digit a video can be filed under';
        return null;
    }
    // The console's games by title and by ROM name, made once a run: a fetch asks for every game it plans.
    static $byName = [];
    $mk = art_key((string) $game['platform']) . '|' . count($console);
    if (!isset($byName[$mk])) {
        $byName[$mk] = ['title' => [], 'rom' => []];
        foreach ($console as $i => $g) {
            $byName[$mk]['title'][(string) ($g['sourceKey'] ?? $g['key'] ?? '')][] = $i;
            $byName[$mk]['rom'][$romKey($g)][] = $i;
        }
    }
    $clash = '';
    foreach ($stems as $stem) {
        $key  = art_key_from_filename($stem . '.' . $ext);
        $dest = xs_data_path('videos') . DIRECTORY_SEPARATOR . $dir . DIRECTORY_SEPARATOR . $stem . '.' . $ext;
        clearstatcache(true, $dest);
        if (is_file($dest)) {
            $clash = basename($dest) . ' is there already';
            continue;
        }
        // Found by this name: by its title, or by its ROM's name when nothing has its title. In the console's order.
        $finds = $byName[$mk]['title'][$key] ?? [];
        foreach ($byName[$mk]['rom'][$key] ?? [] as $i) {
            if (!isset($index[(string) ($console[$i]['sourceKey'] ?? $console[$i]['key'] ?? '')])) {
                $finds[] = $i;
            }
        }
        $finds = array_unique($finds);
        sort($finds);
        foreach ($finds as $i) {
            $g = $console[$i];
            if ((string) $g['id'] === (string) $game['id']) {
                continue;
            }
            if (!$above($g) && $below($g)) {
                $clash = (string) $g['title'] . ' (' . basename(str_replace('\\', '/', (string) ($g['romPath'] ?? ''))) . ') would play it in place of its own video';
                continue 2;
            }
        }
        return $dest;
    }
    $why = 'a video saved under its name would not be its alone: ' . $clash;
    return null;
}

/** Whether a file starts as an MP4 or a WebM does: what a browser plays. */
function xs_vp_is_video(string $file): bool
{
    $head = (string) @file_get_contents($file, false, null, 0, 16);
    return (strlen($head) >= 12 && substr($head, 4, 4) === 'ftyp') || substr($head, 0, 4) === "\x1A\x45\xDF\xA3";
}
