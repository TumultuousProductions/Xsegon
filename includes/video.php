<?php
/**
 * Xsegon - finding the video snaps.
 *
 * Xsegon's own store, by name:
 *
 *     <Xsegon>\data\videos\<Platform>\<Title>.mp4
 *     <Xsegon>\data\videos\<Platform>\<Anything>\<Title>.mp4   (one level of subfolder)
 *
 * Matching is the art matcher's: strip both sides to letters and digits and
 * compare, so "Demon_s Crest-01.mp4" finds "Demon's Crest".
 *
 * Found at request time, not at import: videos are a handful of folders, so a
 * video dropped into one shows up on the next page load with no re-import.
 *
 * Only what a browser can play: an .avi or .flv snap would be a black box
 * where the cover was.
 */
declare(strict_types=1);

require_once __DIR__ . '/art.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/media.php';
require_once __DIR__ . '/steamvid.php';       // Steam trailers, found by game id
require_once __DIR__ . '/screenscraper.php';  // ScreenScraper's snaps, the same way

function video_types(): array
{
    return ['mp4' => 'video/mp4', 'm4v' => 'video/mp4', 'webm' => 'video/webm'];
}

/** The folders searched by name. */
function video_roots(array $s): array
{
    return [xs_data_path('videos')];
}

/** [platformKey => [titleKey => absolute path]] across the roots. */
function video_index(array $s): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $types = video_types();
    $index = [];

    $take = static function (string $dir, string $pKey) use (&$index, $types): void {
        foreach (@scandir($dir) ?: [] as $f) {
            $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
            if (!isset($types[$ext])) {
                continue;
            }
            $key = art_key_from_filename($f);
            // First one found wins: roots are walked best first, and a file
            // directly in the platform folder is walked before its subfolders.
            if ($key !== '' && !isset($index[$pKey][$key])) {
                $index[$pKey][$key] = $dir . DIRECTORY_SEPARATOR . $f;
            }
        }
    };

    foreach (video_roots($s) as $root) {
        foreach (@scandir($root) ?: [] as $platformDir) {
            $pPath = $root . DIRECTORY_SEPARATOR . $platformDir;
            if ($platformDir === '.' || $platformDir === '..' || !is_dir($pPath)) {
                continue;
            }
            $pKey = art_key($platformDir);
            $take($pPath, $pKey);
            foreach (@scandir($pPath) ?: [] as $sub) {
                $subPath = $pPath . DIRECTORY_SEPARATOR . $sub;
                if ($sub !== '.' && $sub !== '..' && is_dir($subPath)) {
                    $take($subPath, $pKey);
                }
            }
        }
    }
    return $cache = $index;
}

/**
 * The video for one game, or null.
 *
 * By title first, then by the ROM file's own name
 * (what Skraper and every EmulationStation scraper write): "Fighting Force"
 * the game is "Fighting Force (v1.1).mp4" to them.
 */
function video_for(array $index, string $platform, string $titleKey, ?string $romPath = null): ?string
{
    $byPlatform = $index[art_key($platform)] ?? [];
    if (isset($byPlatform[$titleKey])) {
        return $byPlatform[$titleKey];
    }
    if ($romPath !== null && $romPath !== '') {
        $romKey = art_key(pathinfo(str_replace('\\', '/', $romPath), PATHINFO_FILENAME));
        if ($romKey !== '' && isset($byPlatform[$romKey])) {
            return $byPlatform[$romKey];
        }
    }
    return null;
}

// ---- a video chosen for ONE game, in Xsegon -------------------------------
/*
 * Replace Video in the right-click menu, filed under the game's ID:
 *
 *     data\video-own\<game id>.<ext>
 *
 * so it follows the game however it is renamed and outranks a snap found by
 * name. The file's existence is the whole record: delete it to undo.
 */

function video_own_dir(): string
{
    return xs_data_path('video-own');
}

function video_own(string $id): ?string
{
    // One folder scan per request, not three file checks per game: the library asks once per game.
    static $index = null;
    if ($index === null) {
        $index = [];
        $types = video_types();
        foreach (@scandir(video_own_dir()) ?: [] as $f) {
            $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
            if (isset($types[$ext])) {
                // Two endings for one game (an old one something held as it was replaced): the newer is the video.
                $had = $index[pathinfo($f, PATHINFO_FILENAME)] ?? null;
                if ($had !== null && (int) @filemtime($had) >= (int) @filemtime(video_own_dir() . DIRECTORY_SEPARATOR . $f)) {
                    continue;
                }
                $index[pathinfo($f, PATHINFO_FILENAME)] = video_own_dir() . DIRECTORY_SEPARATOR . $f;
            }
        }
    }
    return $index[$id] ?? null;
}

/** Every folder a served video may live in. */
function video_allowed_roots(array $s): array
{
    return array_merge(video_roots($s), [video_own_dir(), media_dir(), xs_steamvid_dir(), xs_ss_dir()]);
}

/**
 * The one question every caller asks: which video, if any, is this game's?
 * Chosen in Xsegon, then the copy in data\media (includes\media.php),
 * then whatever is found by name, then a snap fetched from ScreenScraper.
 */
function video_for_game(array $s, array $game): ?string
{
    return video_own((string) $game['id'])
        ?? (media_index()[(string) $game['id']]['video'] ?? null)
        // A Steam game's trailer (includes\steamvid.php): only a gap filled, never in front of a chosen snap.
        ?? xs_steamvid_for((string) $game['id'])
        ?? video_for(video_index($s), (string) $game['platform'],
                     (string) ($game['sourceKey'] ?? $game['key']), $game['romPath'] ?? null)
        // Last (includes\screenscraper.php): a snap dropped into a folder afterwards is the one shown.
        ?? xs_ss_for((string) $game['id']);
}
