<?php
/**
 * Give one game a video of your choosing, or take it back.
 *
 *   GET  /api/video-own.php?id=<id>                  what this game plays now, and why
 *   POST /api/video-own.php?id=<id>&part=0&of=9      body = raw bytes of that piece
 *   POST /api/video-own.php?id=<id>&reset=1          delete the chosen video
 *   POST /api/video-own.php?id=<id>&clear=1          Clear video: every video it could play, deleted (video_clear)
 *
 * Sent in pieces, as images are (api\art.php), for PHP's upload limit. Nothing
 * is given a name the player reads until the last piece is in and looked at.
 *
 * ONLY WHAT A BROWSER CAN PLAY: MP4 (H.264) and WebM. An .avi or .flv is
 * refused with a reason: it would put a black box where the cover was.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/video.php';

const XS_VIDEO_MAX = 400 * 1024 * 1024;

$id = xs_id_or_fail($_GET['id'] ?? '');
$game = xs_game_or_404($id);

$s = xs_settings();

// HEAD reads too: it arrives from other sites with no Origin header, so it
// must never reach the writes below, which take everything from the query.
if (in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
    $own    = video_own($id);
    $layers = video_layers($s, $game);
    $now    = video_for_game($s, $game);
    $under  = array_values(array_filter($layers, static fn ($l) => $l['from'] !== 'own'));
    xs_json([
        'ok'       => true,
        'id'       => $id,
        'title'    => $game['title'],
        'has'      => $now !== null,
        'replaced' => $own !== null,
        'hadOne'   => $under !== [],             // a video underneath the chosen one
        'under'    => $under[0]['from'] ?? null, // where that one comes from: media, steam, name or screenscraper
        'from'     => video_from($s, $game, $layers),
        'file'     => $now !== null ? basename($now) : null,
        'rev'      => $now !== null ? (int) @filemtime($now) : 0,
        'files'    => count($layers),            // what Clear video deletes
        'shared'   => $now !== null ? video_shared_with($s, $game, $layers) : [],
    ]);
}

xs_local_origin_only();

$dir = video_own_dir();
if (!is_dir($dir) && !@mkdir($dir, 0777, true)) {
    xs_fail('could not create data\video-own', 500);
}
$tmp = $dir . DIRECTORY_SEPARATOR . '.upload-' . $id . '.part';

$dropOwn = static function () use ($dir, $id): void {
    foreach (array_keys(video_types()) as $e) {
        @unlink($dir . DIRECTORY_SEPARATOR . $id . '.' . $e);
    }
};

if (($_GET['reset'] ?? '') === '1') {
    $dropOwn();
    @unlink($tmp);
    // Checked, not assumed: a video something still plays stays on disk and
    // keeps winning.
    foreach (array_keys(video_types()) as $e) {
        if (is_file($dir . DIRECTORY_SEPARATOR . $id . '.' . $e)) {
            xs_fail('the video could not be removed (' . xs_file_error_reason() . '): it still plays', 500);
        }
    }
    xs_log('VID', $id . ': own video removed');
    xs_json(['ok' => true, 'id' => $id, 'replaced' => false]);
}

if (($_GET['clear'] ?? '') === '1') {
    @unlink($tmp);
    $shared = video_shared_with($s, $game, video_layers($s, $game));
    $r = video_clear($s, $game);
    if ($r['why'] !== null) {
        xs_log('VID', $game['title'] . ': Clear video stopped: ' . $r['why'] . ($r['gone'] ? ' (' . count($r['gone']) . ' deleted before that)' : ''));
        xs_fail('the video could not be cleared: ' . $r['why'], 500);
    }
    xs_log('VID', $game['title'] . ': video cleared, ' . count($r['gone']) . ' deleted (' . implode(', ', array_map('basename', $r['gone'])) . ')'
        . ($shared ? '; ' . implode(', ', $shared) . ' played it too' : ''));
    xs_json(['ok' => true, 'id' => $id, 'gone' => count($r['gone']), 'shared' => $shared]);
}

xs_upload_piece($tmp, XS_VIDEO_MAX, 'video is larger than 400 MB', 400);

// ---- last piece: what is it, really? ------------------------------------
// By its first bytes, never by the name it arrived under. MP4 family: a box
// whose type is "ftyp" at offset 4. WebM / Matroska: the EBML magic number.
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
    xs_fail($what . ' Use an MP4 (H.264) or WebM.', 415);
}

$final = xs_put_file($tmp, $dir . DIRECTORY_SEPARATOR . $id, $ext, array_keys(video_types()), $held);
if ($final === null) {
    xs_fail('could not store the video (' . $held . '): the one before it is still there', 500);
}
xs_changed_note([$id], 'video');

xs_log('VID', $id . ': own video set (' . round(filesize($final) / 1048576, 1) . ' MB)');
xs_json(['ok' => true, 'id' => $id, 'replaced' => true, 'bytes' => filesize($final), 'rev' => (int) filemtime($final)]);
