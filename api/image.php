<?php
/**
 * GET /api/image.php?id=<game id>&kind=box[&size=full]
 *
 *      /api/image.php?platform=<name>&kind=icon|device|clearlogo[&v=<rev>]
 *
 * Thumbnail first, always (bin\thumbs.ps1 builds them, far smaller than the
 * originals); size=full is for the details panel.
 *
 * Anything outside Xsegon's own art and its media copy is refused: one
 * realpath, so a bug here can never become "read any file on the disk".
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';

$id   = trim((string) ($_GET['id'] ?? ''));
$kind = preg_replace('/[^a-z0-9]/', '', strtolower((string) ($_GET['kind'] ?? 'box'))) ?: 'box';   // box3d has a digit
$full = ($_GET['size'] ?? '') === 'full';
$platform = trim((string) ($_GET['platform'] ?? ''));

$types = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
          'webp' => 'image/webp', 'gif' => 'image/gif'];

/**
 * $cache: how long the browser may keep it. A game's art changes only with a
 * new address, so a day; a platform's is set by XS_PLATFORM_CACHE below.
 */
function xs_serve(string $path, array $types, string $cache = 'private, max-age=86400'): void
{
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
    header('Cache-Control: ' . $cache);
    $tag = '"' . dechex((int) @filemtime($path)) . '-' . dechex((int) @filesize($path)) . '"';
    header('ETag: ' . $tag);
    if (trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $tag) {
        http_response_code(304);
        exit;
    }
    header('Content-Length: ' . filesize($path));
    readfile($path);
    exit;
}

/** Serve the console's icon that ships with Xsegon, if it has one: RetroArch's
    own (img\consoles, CC-BY 4.0, tools\get-console-icons.js), by libretro's
    name for the console. Also the device picture of a console with no photo. */
function xs_platform_builtin_icon(string $platform, array $types): void
{
    // A console libretro has no name for, under RetroArch's own name for its icon.
    static $more = ['Nintendo Switch' => 'Nintendo - Switch'];
    // Arcade wears MAME's cabinet, as it wears MAME's name logo.
    xs_platform_builtin(strcasecmp($platform, 'Arcade') === 0 ? 'MAME' : $platform, 'consoles', 'png', $types, $more[$platform] ?? null);
    // One RetroArch draws no icon for: its own mark, kept with the name logos.
    static $marks = ['Steam' => 'Steam (icon)'];
    if (isset($marks[$platform])) {
        xs_platform_builtin($platform, 'console-logos', 'png', $types, $marks[$platform]);
    }
}

/** The console's own picture that ships with Xsegon (kind=device): its photo
    (img\console-photos, public domain, tools\get-console-photos.php), else its icon. */
function xs_platform_builtin_device(string $platform, array $types): void
{
    xs_platform_builtin($platform, 'console-photos', 'webp', $types);
    xs_platform_builtin_icon($platform, $types);
}

/** The console's name logo that ships with Xsegon (kind=clearlogo: the
    wheel's rim): wordmarks marked public domain or CC0 on Wikimedia Commons
    (img\console-logos, tools\get-console-logos.php). */
function xs_platform_builtin_logo(string $platform, array $types): void
{
    // A console libretro has no name for, under the name the tool gave its file.
    static $more = ['Nintendo Switch' => 'Nintendo - Nintendo Switch'];
    xs_platform_builtin($platform, 'console-logos', 'png', $types, $more[$platform] ?? null);
}

/** Serve img\<folder>\<libretro name>.<ext> for this console, if there is
    one. $named: the file's name, for a console libretro has none for. */
function xs_platform_builtin(string $platform, string $folder, string $ext, array $types, ?string $named = null): void
{
    require_once __DIR__ . '/../includes/libretro.php';
    $sys = xs_lr_system($platform) ?? $named;
    $dir = realpath(XS_ROOT . DIRECTORY_SEPARATOR . 'img' . DIRECTORY_SEPARATOR . $folder);
    if ($sys === null || $dir === false) {
        return;
    }
    $real = realpath($dir . DIRECTORY_SEPARATOR . $sys . '.' . $ext);
    if ($real !== false && xs_inside($real, $dir)) {
        xs_serve($real, $types, XS_PLATFORM_CACHE);
    }
}

/* Every platform picture goes out this way. With a version in the address
   (v=, platformArtRev from api\library.php) the browser keeps it a year;
   without, it revalidates, a PHP round trip per picture on every start. */
define('XS_PLATFORM_CACHE', isset($_GET['v']) ? 'private, max-age=31536000, immutable'
                                              : 'private, max-age=0, must-revalidate');

// ---- platform art, for the consoles ----------------------------------------
// GET /api/image.php?platform=<name>&kind=icon|device|clearlogo: a picture you
// chose yourself (data\platform-art), else the one that ships with Xsegon.
if ($platform !== '') {
    if (!preg_match('/^@?[\w .\'()&+\-]{1,80}$/u', $platform)) {
        http_response_code(400);
        exit;
    }
    // A miss is kept as long as a hit: the version moves when one is added.
    header('Cache-Control: ' . XS_PLATFORM_CACHE);
    $s      = xs_settings();
    // The platform sidebar's "All games" row: your own (data\platform-art\all-icon),
    // else the one that ships with Xsegon (img\all-games.png), first under "Xsegon's own".
    if ($platform === '@all' && $kind === 'icon') {
        $ours = realpath(XS_ROOT . DIRECTORY_SEPARATOR . 'img' . DIRECTORY_SEPARATOR . 'all-games.png');
        if ($ours !== false && ($s['view']['consoleArt'] ?? 'yours') === 'xsegon') {
            xs_serve($ours, $types, XS_PLATFORM_CACHE);
        }
        foreach (array_keys($types) as $e) {
            $own = xs_data_path('platform-art' . DIRECTORY_SEPARATOR . 'all-icon.' . $e);
            if (is_file($own)) {
                xs_serve($own, $types, XS_PLATFORM_CACHE);
            }
        }
        if ($ours !== false) {
            xs_serve($ours, $types, XS_PLATFORM_CACHE);
        }
        http_response_code(404);
        exit;
    }
    // A collection (@favourites, @recent, @unplayed): its icon can only be your
    // own, data\platform-art\<key>-<kind>.png ("favourites-clearlogo.png"). None
    // there means the name in text.
    if ($platform[0] === '@') {
        $ck = art_key($platform);
        foreach ([$kind, 'clearlogo', 'logo'] as $k) {
            foreach (array_keys($types) as $e) {
                $own = xs_data_path('platform-art' . DIRECTORY_SEPARATOR . $ck . '-' . $k . '.' . $e);
                if (is_file($own)) {
                    xs_serve($own, $types, XS_PLATFORM_CACHE);
                }
            }
        }
        http_response_code(404);
        exit;
    }
    // Settings > View > Console pictures, "Xsegon's own": the shipped pictures
    // go in front of yours, which are left as they are.
    if (($s['view']['consoleArt'] ?? 'yours') === 'xsegon') {
        if ($kind === 'icon') {
            xs_platform_builtin_icon($platform, $types);
        } elseif ($kind === 'device') {
            xs_platform_builtin_device($platform, $types);
        } elseif ($kind === 'clearlogo') {
            xs_platform_builtin_logo($platform, $types);
        }
    }

    // A picture you chose yourself (right-click a console > Change Pictures,
    // api\platform-art.php). "logo" is the rim's fallback for "clearlogo", so
    // it looks under both names.
    foreach (array_unique([$kind, $kind === 'logo' ? 'clearlogo' : $kind]) as $k) {
        foreach (array_keys($types) as $e) {
            $own = xs_data_path('platform-art' . DIRECTORY_SEPARATOR . art_key($platform) . '-' . $k . '.' . $e);
            if (is_file($own)) {
                xs_serve($own, $types, XS_PLATFORM_CACHE);
            }
        }
    }

    // Then the ones that ship with Xsegon. A miss 404s: the sidebar draws a
    // glyph, the wheel's rim writes the name in words.
    if ($kind === 'icon') {
        xs_platform_builtin_icon($platform, $types);
    } elseif ($kind === 'device') {
        xs_platform_builtin_device($platform, $types);
    } elseif ($kind === 'clearlogo') {
        xs_platform_builtin_logo($platform, $types);
    }
    http_response_code(404);
    exit;
}

if ($id === '' || !xs_game_id_ok($id)) {
    http_response_code(400);
    exit;
}

// ---- the cache, which is the normal path -------------------------------
if (!$full) {
    // .png is what a clear logo's thumbnail is: it has to stay transparent.
    foreach (['.jpg', '.png'] as $thumbExt) {
        $thumb = xs_data_path('thumbs' . DIRECTORY_SEPARATOR . $kind . DIRECTORY_SEPARATOR . $id . $thumbExt);
        if (is_file($thumb)) {
            xs_serve($thumb, $types);
        }
    }
}

// ---- the original, for the details panel or a cache that is not built yet
$path = xs_game($id)['art'][$kind] ?? null;

if ($path === null || !is_file($path)) {
    http_response_code(404);
    exit;
}

$real   = realpath($path);

// Two homes are allowed: Xsegon's own data\art, where an image replaced from
// the right-click menu lives (includes\overrides.php), and its media copy (includes\media.php).
$ownDir  = realpath(xs_own_art_dir());
$copyDir = realpath(media_dir());
$inOwn   = $ownDir !== false && $real !== false && xs_inside($real, $ownDir);
$inCopy  = $copyDir !== false && $real !== false && xs_inside($real, $copyDir);

if (!$inOwn && !$inCopy) {
    http_response_code(403);
    exit;
}

xs_serve($real, $types);
