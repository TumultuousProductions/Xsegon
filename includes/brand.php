<?php
/**
 * Xsegon - your name and your logo on it (roadmap BB1): Settings > Feel > Your
 * name and logo. The picture stands where the wordmark is, the name on the
 * window's title, a game window's and the phone's. Xsegon's own name stays in
 * Help > About, Messages, Report a problem and the log.
 *
 *     data\brand\logo.png (or .jpg, .webp, .gif)   the picture, api\brand.php
 *     feel.brandName                               the name, a setting
 *
 * In data\, so no update touches it and every Backup carries it.
 */
declare(strict_types=1);
require_once __DIR__ . '/settings.php';

const XS_BRAND_EXTS = ['png', 'jpg', 'webp', 'gif'];
const XS_BRAND_TYPES = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'webp' => 'image/webp', 'gif' => 'image/gif'];

function xs_brand_dir(): string
{
    return xs_data_path('brand');
}

/** The picture, or null: logo.png, .jpg, .webp or .gif, the newer if two stand. */
function xs_brand_file(): ?string
{
    return xs_slot_file(xs_brand_dir() . DIRECTORY_SEPARATOR . 'logo', XS_BRAND_EXTS);
}

/**
 * What the page, a game window and the phone show. name is '' when none was
 * typed; title is what a window's title says. square: about as wide as tall,
 * so the picture can be the small icon on the tab and the taskbar too.
 */
function xs_brand(?array $s = null): array
{
    $s ??= xs_settings();
    // One line, and short enough for a window's title. No double quote: a window is asked for by its title, which may hold none (api\window.php).
    $name = mb_substr(trim(preg_replace('/\s+/u', ' ', str_replace('"', "'", (string) ($s['feel']['brandName'] ?? ''))) ?? ''), 0, 60);
    $file = xs_brand_file();
    $w = $h = 0;
    if ($file !== null) {
        $info = @getimagesize($file);
        [$w, $h] = $info !== false ? [(int) $info[0], (int) $info[1]] : [0, 0];
    }
    $has = $file !== null && $w > 0 && $h > 0;
    return [
        'name'   => $name,
        'title'  => $name !== '' ? $name : 'Xsegon',
        'own'    => $has || $name !== '',
        'has'    => $has,
        'rev'    => $has ? (int) @filemtime($file) : 0,
        'width'  => $w,
        'height' => $h,
        'square' => $has && $w / $h >= 0.8 && $w / $h <= 1.25,
    ];
}

/** Where the page asks for the picture: rev moves when it changes, so no old copy is shown. */
function xs_brand_url(array $b): string
{
    return '/api/brand.php?img=1&v=' . $b['rev'];
}
