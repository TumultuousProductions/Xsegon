<?php
/**
 * A platform's pictures: the logo on the rim and the console itself.
 *
 *   GET  /api/platform-art.php?platform=<name>
 *   POST /api/platform-art.php?platform=<name>&kind=device&part=0&of=2   body = bytes
 *   POST /api/platform-art.php?platform=<name>&kind=device&reset=1
 *
 * Yours land in data\platform-art and outrank the ones that ship with Xsegon
 * (includes\platform-art.php); reset deletes yours and the shipped one is back.
 * Works for a platform of your own and for a collection (@favourites) too.
 *
 * In pieces like api\art.php, for PHP's upload limit; nothing is trusted until
 * the bytes decode as a real image.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/platform-art.php';

const XS_PLATFORM_ART_MAX = 40 * 1024 * 1024;

$platform = trim((string) ($_GET['platform'] ?? ''));
// The same shape api\image.php accepts, "@" and all.
if ($platform === '' || !preg_match('/^@?[\w .\'()&+\-]{1,80}$/u', $platform)) {
    xs_fail('which platform?', 400);
}
$key = art_key($platform);
if ($key === '') {
    xs_fail('that platform name has nothing to file a picture under', 400);
}

$kinds = xs_platform_art_kinds();

// HEAD reads too: it arrives from other sites with no Origin header, so it
// must never reach the writes below, which take everything from the query.
if (in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
    $out = [];
    foreach ($kinds as $kind => $label) {
        $own = xs_platform_art_own($platform, $kind);
        $out[$kind] = [
            'label' => $label,
            'mine'  => $own !== null,
            'has'   => $own !== null,
            // The address the screen itself uses, so what the dialog shows is
            // what the wall shows. rev moves when yours changes.
            'rev'   => $own !== null ? (int) filemtime($own) : 0,
        ];
    }
    xs_json(['ok' => true, 'platform' => $platform, 'key' => $key, 'kinds' => $out]);
}

xs_local_origin_only();

$kind = (string) ($_GET['kind'] ?? '');
if (!isset($kinds[$kind])) {
    xs_fail('kind must be one of: ' . implode(', ', array_keys($kinds)), 400);
}

$dir = xs_platform_art_dir();
if (!is_dir($dir) && !@mkdir($dir, 0777, true)) {
    xs_fail('could not create data\platform-art', 500);
}
$stem = $dir . DIRECTORY_SEPARATOR . $key . '-' . $kind;
$tmp  = $dir . DIRECTORY_SEPARATOR . '.upload-' . $key . '-' . $kind . '.part';

$dropOwn = static function () use ($stem): void {
    foreach (xs_platform_art_exts() as $e) {
        @unlink($stem . '.' . $e);
    }
};

if (($_GET['reset'] ?? '') === '1') {
    $had = xs_platform_art_own($platform, $kind) !== null;
    $dropOwn();
    @unlink($tmp);
    // Checked, not assumed, as in api\art.php.
    if (xs_platform_art_own($platform, $kind) !== null) {
        xs_fail('the picture could not be removed (' . xs_file_error_reason() . '): it still shows', 500);
    }
    xs_log('PART', 'reset ' . $platform . ' ' . $kind . ($had ? '' : ' (there was none)'));
    xs_json(['ok' => true, 'platform' => $platform, 'kind' => $kind, 'mine' => false]);
}

xs_upload_piece($tmp, XS_PLATFORM_ART_MAX, 'image is larger than 40 MB');

$info = @getimagesize($tmp);
$exts = [IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg', IMAGETYPE_WEBP => 'webp', IMAGETYPE_GIF => 'gif'];
if ($info === false || !isset($exts[$info[2]]) || $info[0] < 1 || $info[1] < 1) {
    @unlink($tmp);
    xs_fail('that file is not a PNG, JPEG, WebP or GIF image', 415);
}

// The name follows what the bytes ARE, never what they were uploaded as. A
// console and a logo both want their transparency, so a PNG stays a PNG.
$final = xs_put_file($tmp, $stem, $exts[$info[2]], xs_platform_art_exts(), $held);
if ($final === null) {
    xs_fail('could not store the image (' . $held . '): the one before it is still there', 500);
}

xs_log('PART', 'set ' . $platform . ' ' . $kind . ' ' . $info[0] . 'x' . $info[1]);
xs_json(['ok' => true, 'platform' => $platform, 'kind' => $kind, 'mine' => true,
         'width' => $info[0], 'height' => $info[1], 'rev' => (int) filemtime($final)]);
