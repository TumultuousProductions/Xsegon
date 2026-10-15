<?php
/**
 * Replace one of a game's images, or take the replacement away.
 *
 *   GET  /api/art.php?id=<id>                       what each kind is right now
 *   POST /api/art.php?id=<id>&kind=box&part=0&of=3  body = raw bytes of that piece
 *   POST /api/art.php?id=<id>&kind=box&reset=1      delete the replacement
 *   POST /api/art.php?id=<id>&clear=1               Clear all: every picture and the video
 *
 * The replacement is a file in data\art; the original is never touched
 * (includes\overrides.php has the arrangement). Clear all deletes the
 * replacements, hides the originals ("Use no picture") and deletes the video
 * (video_clear, includes\video.php).
 *
 * Pieces, because PHP's upload and POST limits are smaller than a fanart image.
 * Nothing is trusted until the last piece: only a file that decodes as an image,
 * under its real type, is given a name the rest of Xsegon will read.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/video.php';

const XS_ART_MAX = 40 * 1024 * 1024;

$id = xs_id_or_fail($_GET['id'] ?? '');
$game = xs_game_or_404($id);

$kinds  = xs_own_art_kinds();
$hidden = xs_art_hidden();

// HEAD reads too: it arrives from other sites with no Origin header, so it
// must never reach the writes below, which take everything from the query.
if (in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
    $out = [];
    foreach ($kinds as $kind => $label) {
        $out[$kind] = [
            'label'    => $label,
            'has'      => !empty($game['art'][$kind]),
            'replaced' => array_key_exists($kind, $game['artSource'] ?? []),
            'hadOne'   => !empty($game['artSource'][$kind] ?? null),   // it had a picture before the replacement
            // "Use no picture": the file is on disk but Xsegon is told not
            // to show it (includes\overrides.php, data\art-hidden.json).
            'hidden'   => in_array($kind, (array) ($hidden[$id] ?? []), true),
        ];
    }
    // The video too, for Clear all's window: what it deletes, and who else plays the same file.
    $s      = xs_settings();
    $layers = video_layers($s, $game);
    $now    = video_for_game($s, $game);
    $video  = ['has' => $now !== null, 'file' => $now !== null ? basename($now) : null, 'path' => $now, 'files' => count($layers),
               'shared' => $now !== null ? video_shared_with($s, $game, $layers) : []];
    xs_json(['ok' => true, 'id' => $id, 'title' => $game['title'], 'rev' => $game['artRev'] ?? 0, 'kinds' => $out, 'video' => $video]);
}

xs_local_origin_only();

// Clear all: each replacement deleted, each original hidden, then the video.
if (($_GET['clear'] ?? '') === '1') {
    $dir  = xs_own_art_dir();
    $exts = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
    $list = (array) ($hidden[$id] ?? []);
    $deleted = 0;
    $hid     = 0;
    foreach (array_keys($kinds) as $kind) {
        $replaced = array_key_exists($kind, $game['artSource'] ?? []);
        $original = $replaced ? !empty($game['artSource'][$kind]) : !empty($game['art'][$kind]);
        if ($replaced) {
            foreach ($exts as $e) {
                @unlink($dir . DIRECTORY_SEPARATOR . $id . '-' . $kind . '.' . $e);
            }
            foreach ($exts as $e) {
                if (is_file($dir . DIRECTORY_SEPARATOR . $id . '-' . $kind . '.' . $e)) {
                    xs_fail('the ' . strtolower($kinds[$kind]) . ' could not be deleted (' . xs_file_error_reason() . '): nothing else was cleared after it', 500);
                }
            }
            $deleted++;
        }
        if ($original && !in_array($kind, $list, true)) {
            $list[] = $kind;
            $hid++;
        }
        foreach (['.jpg', '.png'] as $e) {
            @unlink(xs_data_path('thumbs' . DIRECTORY_SEPARATOR . $kind . DIRECTORY_SEPARATOR . $id . $e));
        }
    }
    if ($list) {
        $hidden[$id] = $list;
    }
    xs_write_or_fail(xs_data_path('art-hidden.json'), $hidden ?: new stdClass());
    $s = xs_settings();
    $shared = video_shared_with($s, $game, video_layers($s, $game));
    $r = video_clear($s, $game);
    xs_log('ART', $game['title'] . ': Clear all, ' . $deleted . ' pictures deleted, ' . $hid . ' originals hidden, '
        . count($r['gone']) . ' videos deleted' . ($shared ? ' (' . implode(', ', $shared) . ' played it too)' : '')
        . ($r['why'] !== null ? '; the video stays: ' . $r['why'] : ''));
    if ($r['why'] !== null) {
        xs_fail('the pictures were cleared, but the video could not be: ' . $r['why'], 500);
    }
    xs_json(['ok' => true, 'id' => $id, 'deleted' => $deleted, 'hidden' => $hid, 'videos' => count($r['gone']), 'shared' => $shared]);
}

$kind = (string) ($_GET['kind'] ?? '');
if (!isset($kinds[$kind])) {
    xs_fail('kind must be one of: ' . implode(', ', array_keys($kinds)), 400);
}

$dir = xs_own_art_dir();
if (!is_dir($dir) && !@mkdir($dir, 0777, true)) {
    xs_fail('could not create data\art', 500);
}
$stem = $dir . DIRECTORY_SEPARATOR . $id . '-' . $kind;
$tmp  = $dir . DIRECTORY_SEPARATOR . '.upload-' . $id . '-' . $kind . '.part';

// The old thumbnail is a picture of the old image. Drop it; the full image is
// served until "Build thumbs" is next run, which knows about data\art too.
$dropThumb = static function () use ($id, $kind): void {
    foreach (['.jpg', '.png'] as $e) {       // .png: a clear logo's thumbnail
        @unlink(xs_data_path('thumbs' . DIRECTORY_SEPARATOR . $kind . DIRECTORY_SEPARATOR . $id . $e));
    }
};
$dropOwn = static function () use ($stem): void {
    foreach (['png', 'jpg', 'jpeg', 'webp', 'gif'] as $e) {
        @unlink($stem . '.' . $e);
    }
};

// hide=1 / hide=0: use no picture for this kind, or use it again. The picture
// itself is never touched; only the note that says not to show it. A replaced
// image (data\art) outranks the note, so hiding is for the original picture.
if (isset($_GET['hide'])) {
    $list = array_values(array_diff((array) ($hidden[$id] ?? []), [$kind]));
    if ($_GET['hide'] === '1') {
        $list[] = $kind;
    }
    if ($list) {
        $hidden[$id] = $list;
    } else {
        unset($hidden[$id]);
    }
    xs_write_or_fail(xs_data_path('art-hidden.json'), $hidden ?: new stdClass());
    $dropThumb();
    xs_log('ART', $game['title'] . ': ' . $kind . ($_GET['hide'] === '1' ? ' not used' : ' used again'));
    xs_json(['ok' => true, 'id' => $id, 'kind' => $kind, 'hidden' => $_GET['hide'] === '1']);
}

if (($_GET['reset'] ?? '') === '1') {
    $dropOwn();
    $dropThumb();
    @unlink($tmp);
    // Checked after, not assumed: a file something still holds (a virus
    // scanner, a sync tool) stays on disk and keeps winning every read.
    foreach (['png', 'jpg', 'jpeg', 'webp', 'gif'] as $e) {
        if (is_file($stem . '.' . $e)) {
            xs_fail('the replacement could not be removed (' . xs_file_error_reason() . '): it still shows', 500);
        }
    }
    xs_log('ART', $game['title'] . ': ' . $kind . ' back to the original');
    xs_json(['ok' => true, 'id' => $id, 'kind' => $kind, 'replaced' => false]);
}

xs_upload_piece($tmp, XS_ART_MAX, 'image is larger than 40 MB');

// ---- last piece: is it really an image? --------------------------------
$info = @getimagesize($tmp);
$exts = [IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg', IMAGETYPE_WEBP => 'webp', IMAGETYPE_GIF => 'gif'];
if ($info === false || !isset($exts[$info[2]]) || $info[0] < 1 || $info[1] < 1) {
    @unlink($tmp);
    xs_fail('that file is not a PNG, JPEG, WebP or GIF image', 415);
}

// The extension comes from what the bytes ARE, never from the name it was
// uploaded under.
$final = xs_put_file($tmp, $stem, $exts[$info[2]], ['png', 'jpg', 'jpeg', 'webp', 'gif'], $held);
if ($final === null) {
    xs_fail('could not store the image (' . $held . '): the one before it is still there', 500);
}
$dropThumb();
xs_changed_note([$id], $kind);
xs_log('ART', $game['title'] . ': ' . $kind . ' replaced (' . $info[0] . 'x' . $info[1] . ')');

xs_json(['ok' => true, 'id' => $id, 'kind' => $kind, 'replaced' => true,
         'width' => $info[0], 'height' => $info[1], 'rev' => (int) filemtime($final)]);
