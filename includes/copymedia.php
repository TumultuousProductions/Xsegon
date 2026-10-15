<?php
/**
 * Xsegon - a game's pictures and video, copied from another game (the Media
 * tab of details, js\mediatab.js; roadmap AM1).
 *
 * The copy lands where Change Pictures and Add Video put a game's own
 * (data\art\<id>-<kind>, data\video-own\<id>), so everything that reads those
 * reads it, and Reset to the original or Remove undoes it. It is a file of its
 * own: the other game changing later changes nothing here.
 *
 * Read only from Xsegon's own folders: a path outside them is not copied.
 */
declare(strict_types=1);

require_once __DIR__ . '/import.php';
require_once __DIR__ . '/video.php';

const XS_CM_SHOWN = 200;           // games in one answer of the list; the find box narrows the rest

/** The five picture kinds and the video, in the tab's order, with their names. */
function xs_cm_kinds(): array
{
    return xs_own_art_kinds() + ['video' => 'Video'];
}

/** Is this picture in data\art or data\media? $real: by realpath, for a copy; else by its name, for the list. */
function xs_cm_art_ok(?string $path, bool $real = false): bool
{
    if ($path === null || $path === '') {
        return false;
    }
    foreach ([xs_own_art_dir(), media_dir()] as $dir) {
        if ($real) {
            $p = realpath($path);
            $d = realpath($dir);
            if ($p !== false && $d !== false && is_file($p) && xs_inside($p, $d)) {
                return true;
            }
        } elseif (strncasecmp($path, rtrim($dir, '\\/') . DIRECTORY_SEPARATOR, strlen(rtrim($dir, '\\/')) + 1) === 0) {
            return true;
        }
    }
    return false;
}

/** The video a game plays, when it is in one of the video folders Xsegon serves from. */
function xs_cm_video(array $s, array $game): ?string
{
    $path = video_for_game($s, $game);
    $real = $path === null ? false : realpath($path);
    if ($real === false || !is_file($real)) {
        return null;
    }
    return video_in_allowed_root($s, $real) ? $real : null;
}

/** [kind => absolute path] of what a game shows now, pictures and video. $own: data\art's index, for a row built without its disk. */
function xs_cm_has(array $s, array $game, ?array $own = null): array
{
    $out = [];
    foreach (array_keys(xs_own_art_kinds()) as $k) {
        $p = $own !== null ? ($own[$k] ?? $game['art'][$k] ?? null) : ($game['art'][$k] ?? null);
        if (is_string($p) && xs_cm_art_ok($p, $own === null)) {
            $out[$k] = $p;
        }
    }
    $v = xs_cm_video($s, $game);
    if ($v !== null) {
        $out['video'] = $v;
    }
    return $out;
}

/**
 * The games to copy from, for the list: this game's console first, then the
 * rest, each by title, only those with something to copy. $find narrows by
 * name as the library's search does. At most XS_CM_SHOWN come back.
 */
function xs_cm_list(string $id, string $find): array
{
    $s     = xs_settings();
    $lib   = xs_library_build($id);
    $games = $lib['games'] ?? [];
    $me    = null;
    foreach ($games as $g) {
        if ((string) $g['id'] === $id) {
            $me = $g;
            break;
        }
    }
    if ($me === null) {
        return ['ok' => false, 'error' => 'unknown game'];
    }
    $key = $find === '' ? '' : art_key($find);
    $pf  = mb_strtolower((string) $me['platform']);
    $pick = [];
    foreach ($games as $g) {
        if ((string) $g['id'] === $id) {
            continue;
        }
        if ($key !== '' && !str_contains(art_key((string) $g['title'] . ' ' . ($g['variant'] ?? '')), $key)) {
            continue;
        }
        $pick[] = $g;
    }
    usort($pick, static function (array $a, array $b) use ($pf): int {
        $sa = mb_strtolower((string) $a['platform']) === $pf ? 0 : 1;
        $sb = mb_strtolower((string) $b['platform']) === $pf ? 0 : 1;
        return $sa <=> $sb ?: strnatcasecmp((string) $a['title'], (string) $b['title'])
                           ?: strnatcasecmp((string) $a['platform'], (string) $b['platform']);
    });
    // The rows were built without their disk: data\art is read once here.
    $own  = xs_own_art_index();
    $rows = [];
    $more = false;
    foreach ($pick as $g) {
        $has = xs_cm_has($s, $g, $own[(string) $g['id']] ?? []);
        if (!$has) {
            continue;
        }
        if (count($rows) >= XS_CM_SHOWN) {
            $more = true;
            break;
        }
        $rows[] = [
            'id'       => (string) $g['id'],
            'title'    => (string) $g['title'],
            'variant'  => $g['variant'] ?? null,
            'platform' => (string) $g['platform'],
            'same'     => mb_strtolower((string) $g['platform']) === $pf,
            'has'      => array_keys($has),
        ];
    }
    return ['ok' => true, 'id' => $id, 'title' => (string) $me['title'], 'platform' => (string) $me['platform'],
            'find' => $find, 'games' => $rows, 'more' => $more];
}

/** The address a picture or video is shown from in the tab, its age making a changed file a new one. */
function xs_cm_url(string $id, string $kind, string $path): string
{
    $v = (int) @filemtime($path);
    return $kind === 'video'
        ? 'api/video.php?id=' . rawurlencode($id) . '&v=' . $v
        : 'api/image.php?id=' . rawurlencode($id) . '&kind=' . $kind . '&v=' . $v;
}

/** Are these two files the same bytes? Read through only when their sizes agree. */
function xs_cm_same(string $a, string $b): bool
{
    if (strcasecmp($a, $b) === 0) {
        return true;
    }
    $sa = @filesize($a);
    return $sa !== false && $sa === @filesize($b) && @md5_file($a) === @md5_file($b);
}

/** One row a kind: what the other game has, what this one shows, and whether they are the same file. */
function xs_cm_rows(array $s, array $to, array $from): array
{
    $mine   = xs_cm_has($s, $to);
    $theirs = xs_cm_has($s, $from);
    $rows   = [];
    foreach (xs_cm_kinds() as $k => $label) {
        $f = $theirs[$k] ?? null;
        $t = $mine[$k] ?? null;
        $rows[] = [
            'kind'  => $k,
            'label' => $label,
            'from'  => $f !== null ? xs_cm_url((string) $from['id'], $k, $f) : null,
            'to'    => $t !== null ? xs_cm_url((string) $to['id'], $k, $t) : null,
            'same'  => $f !== null && $t !== null && xs_cm_same($f, $t),
        ];
    }
    return $rows;
}

/** Copy one picture of $from's onto $to. Returns the new file's path, or null with $why. */
function xs_cm_copy_art(array $to, array $from, string $kind, ?string &$why = null): ?string
{
    $why = null;
    $src = $from['art'][$kind] ?? null;
    if (!is_string($src) || !xs_cm_art_ok($src, true)) {
        $why = $from['title'] . ' has no ' . strtolower(xs_own_art_kinds()[$kind]) . ' Xsegon can copy';
        return null;
    }
    $bytes = @file_get_contents($src);
    if ($bytes === false || $bytes === '') {
        $why = 'its picture could not be read (' . xs_file_error_reason() . ')';
        return null;
    }
    $kept = xs_own_art_store((string) $to['id'], $kind, $bytes, true, $why);
    if ($kept === null) {
        return null;
    }
    // The ending is what the bytes are (xs_own_art_store named it so): the newest of the slot is the one.
    return xs_slot_file(xs_own_art_dir() . DIRECTORY_SEPARATOR . $to['id'] . '-' . $kind, ['png', 'jpg', 'jpeg', 'webp', 'gif']);
}

/** Copy $from's video onto $to, as Add Video keeps one. Returns the new file's path, or null with $why. */
function xs_cm_copy_video(array $s, array $to, array $from, ?string &$why = null): ?string
{
    $why = null;
    $src = xs_cm_video($s, $from);
    if ($src === null) {
        $why = $from['title'] . ' has no video Xsegon can copy';
        return null;
    }
    $ext = strtolower(pathinfo($src, PATHINFO_EXTENSION));
    if (!isset(video_types()[$ext])) {
        $why = 'its video is not an MP4 or WebM';
        return null;
    }
    $dir = video_own_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0777, true)) {
        $why = 'could not create data\video-own';
        return null;
    }
    $tmp = $dir . DIRECTORY_SEPARATOR . '.copy-' . $to['id'] . '.part';
    if (!@copy($src, $tmp)) {
        $why = 'the video could not be copied (' . xs_file_error_reason() . ')';
        @unlink($tmp);
        return null;
    }
    $final = xs_put_file($tmp, $dir . DIRECTORY_SEPARATOR . $to['id'], $ext, array_keys(video_types()), $held);
    if ($final === null) {
        $why = 'could not store the video (' . $held . '): the one before it is still there';
    }
    return $final;
}
