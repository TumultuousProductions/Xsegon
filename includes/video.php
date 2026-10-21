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
    $index = [];
    foreach (video_roots($s) as $root) {
        foreach (@scandir($root) ?: [] as $platformDir) {
            $pPath = $root . DIRECTORY_SEPARATOR . $platformDir;
            if ($platformDir === '.' || $platformDir === '..' || !is_dir($pPath)) {
                continue;
            }
            $pKey = art_key($platformDir);
            $index[$pKey] ??= [];
            video_take_folder($pPath, $index[$pKey]);
        }
    }
    return $cache = $index;
}

/**
 * One console folder's videos into $into [titleKey => path]. First one found
 * wins: roots are walked best first, and a file directly in the platform
 * folder is walked before its subfolders.
 */
function video_take_folder(string $pPath, array &$into): void
{
    $types = video_types();
    $take = static function (string $dir) use (&$into, $types): void {
        foreach (@scandir($dir) ?: [] as $f) {
            $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
            if (!isset($types[$ext])) {
                continue;
            }
            $key = art_key_from_filename($f);
            if ($key !== '' && !isset($into[$key])) {
                $into[$key] = $dir . DIRECTORY_SEPARATOR . $f;
            }
        }
    };
    $take($pPath);
    foreach (@scandir($pPath) ?: [] as $sub) {
        $subPath = $pPath . DIRECTORY_SEPARATOR . $sub;
        if ($sub !== '.' && $sub !== '..' && is_dir($subPath)) {
            $take($subPath);
        }
    }
}

/** One console's videos by name, read from the disk now: for a fetch that has been at work for minutes. */
function video_console_now(array $s, string $platform): array
{
    $want = art_key($platform);
    $out  = [];
    foreach (video_roots($s) as $root) {
        foreach (@scandir($root) ?: [] as $platformDir) {
            $pPath = $root . DIRECTORY_SEPARATOR . $platformDir;
            if ($platformDir !== '.' && $platformDir !== '..' && art_key($platformDir) === $want && is_dir($pPath)) {
                video_take_folder($pPath, $out);
            }
        }
    }
    return $out;
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

/**
 * A whole video file made a game's own (data\video-own\<id>.<ext>), moved from $tmp: an upload's last
 * piece, or one fetched for the Media tab's compare. Read by its first bytes, never by the name it came
 * under: an MP4 has "ftyp" at offset 4, a WebM the EBML number. The path, or null with $why and the
 * status to answer with; $tmp is gone either way.
 */
function video_own_store(string $id, string $tmp, ?string &$why = null, ?int &$code = null): ?string
{
    $code = 500;
    $why  = null;
    $head = (string) @file_get_contents($tmp, false, null, 0, 16);
    $ext  = null;
    if (strlen($head) >= 12 && substr($head, 4, 4) === 'ftyp') {
        $ext = 'mp4';
    } elseif (substr($head, 0, 4) === "\x1A\x45\xDF\xA3") {
        $ext = 'webm';
    }
    if ($ext === null) {
        @unlink($tmp);
        $what = substr($head, 0, 4) === 'RIFF' ? 'That file is an AVI, which a browser cannot play.'
              : (substr($head, 0, 3) === 'FLV' ? 'That file is an FLV, which a browser cannot play.'
              : 'That file is not a video a browser can play.');
        $why  = $what . ' Use an MP4 (H.264) or WebM.';
        $code = 415;
        return null;
    }
    $final = xs_put_file($tmp, video_own_dir() . DIRECTORY_SEPARATOR . $id, $ext, array_keys(video_types()), $held);
    if ($final === null) {
        @unlink($tmp);
        $why  = 'could not store the video (' . $held . '): the one before it is still there';
        $code = 500;
        return null;
    }
    xs_changed_note([$id], 'video');
    return $final;
}

/** Every folder a served video may live in. */
function video_allowed_roots(array $s): array
{
    return array_merge(video_roots($s), [video_own_dir(), media_dir(), xs_steamvid_dir(), xs_ss_dir()]);
}

/** Whether a realpath()'d file is inside one of video_allowed_roots. */
function video_in_allowed_root(array $s, string $real): bool
{
    foreach (video_allowed_roots($s) as $root) {
        $r = realpath($root);
        if ($r !== false && xs_inside($real, $r)) {
            return true;
        }
    }
    return false;
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

// ---- Clear video: every video a game could play, deleted --------------------

/**
 * Every video file this game could play, in video_for_game's order:
 * [['from' => own|media|steam|name|screenscraper, 'path']]. By name, every
 * file under its title or its ROM's name, subfolders too: one cleared alone
 * would only bring the next to the front.
 */
function video_layers(array $s, array $game): array
{
    $id    = (string) $game['id'];
    $exts  = array_keys(video_types());
    $found = [];
    $add   = static function (string $from, string $path) use (&$found): void {
        clearstatcache(true, $path);
        if (is_file($path) && !isset($found[mb_strtolower($path)])) {
            $found[mb_strtolower($path)] = ['from' => $from, 'path' => $path];
        }
    };
    foreach ($exts as $e) {
        $add('own', video_own_dir() . DIRECTORY_SEPARATOR . $id . '.' . $e);
    }
    $media = media_index()[$id]['video'] ?? null;
    if ($media !== null) {
        foreach ($exts as $e) {
            $add('media', dirname($media) . DIRECTORY_SEPARATOR . $id . '-video.' . $e);
        }
    }
    $add('steam', xs_steamvid_dir() . DIRECTORY_SEPARATOR . $id . '.mp4');
    $keys = array_values(array_filter([(string) ($game['sourceKey'] ?? $game['key'] ?? ''),
        art_key(pathinfo(str_replace('\\', '/', (string) ($game['romPath'] ?? '')), PATHINFO_FILENAME))]));
    $want = art_key((string) $game['platform']);
    foreach ($keys ? video_roots($s) : [] as $root) {
        foreach (@scandir($root) ?: [] as $platformDir) {
            $pPath = $root . DIRECTORY_SEPARATOR . $platformDir;
            if ($platformDir === '.' || $platformDir === '..' || art_key($platformDir) !== $want || !is_dir($pPath)) {
                continue;
            }
            $dirs = [$pPath];
            foreach (@scandir($pPath) ?: [] as $sub) {
                if ($sub !== '.' && $sub !== '..' && is_dir($pPath . DIRECTORY_SEPARATOR . $sub)) {
                    $dirs[] = $pPath . DIRECTORY_SEPARATOR . $sub;
                }
            }
            foreach ($dirs as $dir) {
                foreach (@scandir($dir) ?: [] as $f) {
                    if (isset(video_types()[strtolower(pathinfo($f, PATHINFO_EXTENSION))])
                        && in_array(art_key_from_filename($f), $keys, true)) {
                        $add('name', $dir . DIRECTORY_SEPARATOR . $f);
                    }
                }
            }
        }
    }
    $add('screenscraper', xs_ss_dir() . DIRECTORY_SEPARATOR . $id . '.mp4');
    return array_values($found);
}

/** Where the video this game plays came from: own, media, steam, name or screenscraper; null for none. */
function video_from(array $s, array $game, ?array $layers = null): ?string
{
    $now = video_for_game($s, $game);
    if ($now === null) {
        return null;
    }
    foreach ($layers ?? video_layers($s, $game) as $l) {
        if (strcasecmp($l['path'], $now) === 0) {
            return $l['from'];
        }
    }
    return 'name';
}

/** Other games on the console that play one of these files now, each as "Title (its file)": a file found by name can serve two versions. */
function video_shared_with(array $s, array $game, array $layers): array
{
    $mine = [];
    foreach ($layers as $l) {
        if ($l['from'] === 'name') {
            $mine[mb_strtolower($l['path'])] = true;
        }
    }
    if (!$mine) {
        return [];
    }
    $want = art_key((string) $game['platform']);
    $out  = [];
    foreach (xs_library()['games'] ?? [] as $g) {
        if ((string) $g['id'] === (string) $game['id'] || art_key((string) $g['platform']) !== $want) {
            continue;
        }
        $v = video_for_game($s, $g);
        if ($v !== null && isset($mine[mb_strtolower($v)])) {
            $rom   = basename(str_replace('\\', '/', (string) ($g['romPath'] ?? '')));
            $out[] = (string) $g['title'] . ($rom !== '' ? ' (' . $rom . ')' : '');
        }
    }
    return $out;
}

/** Null when this file may be deleted: inside Xsegon's own video folders, and on a test copy not behind a link to the real data. */
function video_may_delete(array $s, string $path): ?string
{
    $real = realpath($path);
    if ($real === false) {
        return null;
    }
    $inside = static fn (string $file, string $dir): bool => ($dir = realpath($dir)) !== false && xs_inside($file, $dir);
    // The media copy is deleted in only when it is data\media, not a folder paths.mediaDir names elsewhere (includes\media.php).
    if ($inside($real, media_dir()) && !xs_inside(media_dir(), xs_data_dir())) {
        return basename($path) . ' is in a media folder outside Xsegon\'s own data folder, so it is not deleted';
    }
    if (xs_test_copy() && !$inside($real, xs_data_dir())) {
        return basename($path) . ' is in a folder this test copy shares with the real Xsegon, so it is not deleted';
    }
    if (video_in_allowed_root($s, $real)) {
        return null;
    }
    return basename($path) . ' is outside Xsegon\'s own video folders, so it is not deleted';
}

/**
 * Clear video: every file video_layers finds, deleted, or none when one may
 * not be. ['gone' => paths deleted, 'why' => null, or why a video still plays].
 */
function video_clear(array $s, array $game): array
{
    $layers = video_layers($s, $game);
    foreach ($layers as $l) {
        $why = video_may_delete($s, $l['path']);
        if ($why !== null) {
            return ['gone' => [], 'why' => $why];
        }
    }
    $gone = [];
    foreach ($layers as $l) {
        // The page stops the player first, but the request that served it can hold the file a moment longer.
        for ($try = 0; $try < 8; $try++) {
            if (@unlink($l['path']) || !is_file($l['path'])) {
                break;
            }
            usleep(200000);
            clearstatcache(true, $l['path']);
        }
        clearstatcache(true, $l['path']);
        if (is_file($l['path'])) {
            return ['gone' => $gone, 'why' => basename($l['path']) . ' could not be deleted (' . xs_file_error_reason() . ')'];
        }
        $gone[] = $l['path'];
    }
    return ['gone' => $gone, 'why' => null];
}
