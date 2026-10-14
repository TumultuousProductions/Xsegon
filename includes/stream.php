<?php
/**
 * One file sent with HTTP ranges, for videos: the router's /files/ door and
 * api\video.php. It needs nothing else from the app, so the router can load it
 * without paying for the rest (the reason that door exists).
 */
declare(strict_types=1);

/* The most one range answer sends. Chrome asks for "bytes=0-" and reads at its
   own pace, so an open-ended answer holds this one-request-at-a-time server for
   the whole transfer, and every other request waits. The browser asks for the next piece itself. */
const XS_RANGE_MAX = 2 * 1024 * 1024;

function xs_stream_file(string $real, string $mime, string $cacheControl): void
{
    $size  = (int) filesize($real);
    $start = 0;
    $end   = $size - 1;

    header('Content-Type: ' . $mime);
    header('Accept-Ranges: bytes');
    header('Cache-Control: ' . $cacheControl);

    if (isset($_SERVER['HTTP_RANGE']) && preg_match('/^bytes=(\d*)-(\d*)$/', trim($_SERVER['HTTP_RANGE']), $r)
        && ($r[1] !== '' || $r[2] !== '')) {
        if ($r[1] === '') {                           // "-500": the last 500 bytes
            $start = max(0, $size - (int) $r[2]);
        } else {
            $start = (int) $r[1];
            if ($r[2] !== '') {
                $end = min($end, (int) $r[2]);
            }
        }
        if ($start > $end || $start >= $size) {
            http_response_code(416);
            header('Content-Range: bytes */' . $size);
            return;
        }
        $end = min($end, $start + XS_RANGE_MAX - 1);
        http_response_code(206);
        header('Content-Range: bytes ' . $start . '-' . $end . '/' . $size);
    }

    $length = $end - $start + 1;
    header('Content-Length: ' . $length);
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') {
        return;
    }

    // In pieces, and stopped the moment the browser hangs up: moving the
    // wheel on abandons the snap, and a transfer nobody is listening to would
    // hold every other request behind it.
    ignore_user_abort(false);
    $fh = fopen($real, 'rb');
    if ($fh === false) {
        http_response_code(500);
        return;
    }
    fseek($fh, $start);
    while ($length > 0 && !feof($fh) && !connection_aborted()) {
        $chunk = fread($fh, (int) min(262144, $length));
        if ($chunk === false || $chunk === '') {
            break;
        }
        echo $chunk;
        flush();
        $length -= strlen($chunk);
    }
    fclose($fh);
}
