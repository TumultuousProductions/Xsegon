<?php
/**
 * Xsegon - a picture copy in data\media, read where one is present.
 *
 *     data\media\<Platform>\<game id>-<kind>.<ext>     kind: box logo shot fanart video
 *
 * NOTHING FILLS THIS FOLDER. Xsegon copies nothing into it; a copy that is
 * there is the person's own and is shown from here. Nothing in it is made or
 * replaced, and one thing deletes: Clear video or Clear all, pressed on a
 * game, deletes that game's video (big, and another is a fetch away; its
 * pictures are only hidden). Never in a media folder outside Xsegon's data
 * folder (paths.mediaDir): video_may_delete, includes\video.php.
 *
 * Filed by game id, so a picture's address never needs the library read.
 *
 * Ranking, best first:  an image replaced in Xsegon (data\art)
 *                       the copy (data\media)
 */
declare(strict_types=1);

require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/overrides.php';
require_once __DIR__ . '/video.php';

/** Where the copy lives: data\media, or the folder a settings file names (paths.mediaDir, which no screen sets any more). */
function media_dir(): string
{
    /* Worked out once per request: media_url() asks on every picture, and
       xs_settings() reads settings.json from the disk each time, which made
       up most of a library read. */
    static $dir = null;
    if ($dir === null) {
        $custom = trim((string) (xs_settings()['paths']['mediaDir'] ?? ''));
        $dir = $custom !== '' ? xs_norm_path($custom) : xs_data_path('media');
    }
    return $dir;
}

/** What the last copy wrote of itself. Its age is the revision in a copied picture's address (api\library.php). */
function media_receipt_path(): string
{
    return xs_data_path('media-copy.json');
}

/** [game id => [kind => absolute path]], one walk of data\media per request. */
function media_index(): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $cache = [];
    $root  = media_dir();
    foreach (@scandir($root) ?: [] as $pf) {
        $dir = $root . DIRECTORY_SEPARATOR . $pf;
        if ($pf === '.' || $pf === '..' || !is_dir($dir)) {
            continue;
        }
        foreach (@scandir($dir) ?: [] as $f) {
            if (preg_match('/^([A-Za-z0-9\-]{1,64})-(box|box3d|logo|shot|fanart|video)\.(png|jpe?g|webp|gif|mp4|m4v|webm)$/i', $f, $m)) {
                $cache[$m[1]][strtolower($m[2])] = $dir . DIRECTORY_SEPARATOR . $f;
            }
        }
    }
    return $cache;
}

/**
 * Point each game's art at the copy where there is one. Runs BEFORE the
 * replaced-image overlay, so an image replaced in Xsegon still outranks it.
 */
function xs_apply_media_copy(array $games): array
{
    $index = media_index();
    if (!$index) {
        return $games;
    }
    foreach ($games as &$g) {
        foreach ($index[$g['id']] ?? [] as $kind => $path) {
            if ($kind !== 'video' && array_key_exists($kind, $g['art'] ?? [])) {
                $g['art'][$kind] = $path;
            }
        }
    }
    unset($g);
    return $games;
}

/**
 * The address of a file inside data\, as the router serves it: /files/<path
 * under data>?v=<age>. The age makes a changed file a new address, which is
 * what lets the router tell the browser to keep it for a year.
 */
function media_url(string $absPath, int $rev = 0): ?string
{
    // The copy first: its folder can be anywhere, and is always /files/media.
    $copy = rtrim(media_dir(), '\\/') . DIRECTORY_SEPARATOR;
    $base = rtrim(xs_data_path(''), '\\/') . DIRECTORY_SEPARATOR;
    if (strncasecmp($absPath, $copy, strlen($copy)) === 0) {
        $rel = 'media/' . str_replace('\\', '/', substr($absPath, strlen($copy)));
    } elseif (strncasecmp($absPath, $base, strlen($base)) === 0) {
        $rel = str_replace('\\', '/', substr($absPath, strlen($base)));
    } else {
        return null;                     // not under data\: no plain address
    }
    $parts = array_map('rawurlencode', explode('/', $rel));
    return 'files/' . implode('/', $parts) . ($rev ? '?v=' . $rev : '');
}
