<?php
/**
 * Your logo (roadmap BB1, includes\brand.php).
 *
 *   GET  /api/brand.php                      what is set: name, has, rev, square
 *   GET  /api/brand.php?img=1                the picture itself
 *   POST /api/brand.php?part=0&of=2          body = bytes, in pieces as api\platform-art.php takes them
 *   POST /api/brand.php?reset=1              Use Xsegon's: the picture goes and the name is emptied
 *
 * Nothing is kept until the bytes decode as a real picture.
 */
declare(strict_types=1);
require_once __DIR__ . '/../includes/brand.php';

const XS_BRAND_MAX = 20 * 1024 * 1024;

if (in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
    if (($_GET['img'] ?? '') === '1') {
        $file = xs_brand_file();
        if ($file === null) {
            http_response_code(404);
            exit;
        }
        require_once __DIR__ . '/../includes/stream.php';
        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        // The address carries the picture's time (v=), so a new one is a new address.
        xs_stream_file($file, XS_BRAND_TYPES[$ext] ?? 'application/octet-stream', isset($_GET['v']) ? 'private, max-age=31536000, immutable' : 'no-cache');
        exit;
    }
    xs_json(['ok' => true] + xs_brand());
}

xs_local_origin_only();

$dir = xs_brand_dir();
$stem = $dir . DIRECTORY_SEPARATOR . 'logo';
$tmp = $dir . DIRECTORY_SEPARATOR . '.upload-logo.part';

if (($_GET['reset'] ?? '') === '1') {
    $had = xs_brand();
    foreach (XS_BRAND_EXTS as $e) {
        @unlink($stem . '.' . $e);
    }
    @unlink($tmp);
    // Checked, not assumed, as in api\platform-art.php.
    if (xs_brand_file() !== null) {
        xs_fail('your picture could not be removed (' . xs_file_error_reason() . '): it still shows', 500);
    }
    $s = xs_settings_save(['feel' => ['brandName' => '']], $why);
    if ($why !== null) {
        xs_fail('your picture is gone, but the name could not be emptied: ' . $why, 500);
    }
    xs_log('SET', "your name and logo: back to Xsegon's" . ($had['own'] ? ' (was ' . ($had['name'] !== '' ? '"' . $had['name'] . '"' : 'no name') . ($had['has'] ? ' and a picture' : '') . ')' : ', nothing was set'));
    xs_json(['ok' => true] + xs_brand($s));
}

if (!is_dir($dir) && !@mkdir($dir, 0777, true)) {
    xs_fail('could not make data\brand (' . xs_file_error_reason() . ')', 500);
}
xs_upload_piece($tmp, XS_BRAND_MAX, 'that picture is larger than 20 MB');

$info = @getimagesize($tmp);
$exts = [IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg', IMAGETYPE_WEBP => 'webp', IMAGETYPE_GIF => 'gif'];
if ($info === false || !isset($exts[$info[2]]) || $info[0] < 1 || $info[1] < 1) {
    @unlink($tmp);
    xs_log('SET', 'your logo: refused a file that is not a picture');
    xs_fail('that file is not a picture Xsegon can show: choose a PNG, JPEG, WebP or GIF', 415);
}

// Named for what the bytes are, never for what they were sent as; a PNG keeps its see-through parts.
$final = xs_put_file($tmp, $stem, $exts[$info[2]], XS_BRAND_EXTS, $held);
if ($final === null) {
    xs_fail('could not keep the picture (' . $held . '): the one before it still shows', 500);
}
$b = xs_brand();
xs_log('SET', 'your logo: ' . $info[0] . 'x' . $info[1] . ' ' . $exts[$info[2]] . ($b['square'] ? ', square, so the tab and taskbar icon too' : ''));
xs_json(['ok' => true] + $b);
