<?php
/**
 * Xsegon - a platform's own pictures.
 *
 *     data\platform-art\<key>-<kind>.<ext>     kind: clearlogo | device
 *
 * The consoles screen shows two pictures per platform: the name logo that
 * rides the rim, and the console itself standing in the middle. Xsegon ships
 * its own (img\), and keeps this store for the ones you choose yourself: a
 * picture here outranks the shipped one, and taking it out brings that back.
 *
 * The key is the platform's name with everything but letters and digits taken
 * out (art_key), so "Nintendo 64" and a collection's "@favourites" both
 * become plain file names.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/art.php';

function xs_platform_art_kinds(): array
{
    return [
        'clearlogo' => 'Logo',          // the name, on the rim
        'device'    => 'The console',   // the machine itself, centre stage
    ];
}

function xs_platform_art_dir(): string
{
    return xs_data_path('platform-art');
}

/** The extensions a picture may be stored under, best first. */
function xs_platform_art_exts(): array
{
    return ['png', 'jpg', 'jpeg', 'webp', 'gif'];
}

/** Xsegon's own picture for this platform and kind, or null. */
function xs_platform_art_own(string $platform, string $kind): ?string
{
    return xs_slot_file(xs_platform_art_dir() . DIRECTORY_SEPARATOR . art_key($platform) . '-' . $kind, xs_platform_art_exts());
}

/**
 * A number that moves whenever any console's picture might have: the newest
 * time among the shipped pictures' folders and Xsegon's own store. It goes in
 * the pictures' addresses (v=), so the browser can keep each for a year and
 * still fetch a new one the moment it is chosen. The store's files are
 * stat'd one by one, which catches a picture replaced under the same name.
 */
function xs_platform_art_rev(array $s): int
{
    $rev = 0;
    $seen = static function (string $p) use (&$rev): void {
        $t = @filemtime($p);
        if ($t !== false && $t > $rev) {
            $rev = $t;
        }
    };
    // Each shipped folder, and its sources.json, which the fetching tool rewrites on each change.
    foreach (['consoles', 'console-photos', 'console-logos'] as $folder) {
        $builtin = XS_ROOT . DIRECTORY_SEPARATOR . 'img' . DIRECTORY_SEPARATOR . $folder;
        $seen($builtin);
        $seen($builtin . DIRECTORY_SEPARATOR . 'sources.json');
    }
    // And the file that says which of them a console wears (Arcade wears MAME's).
    $seen(XS_ROOT . DIRECTORY_SEPARATOR . 'api' . DIRECTORY_SEPARATOR . 'image.php');
    // The All games picture that ships, made from three of those icons.
    $seen(XS_ROOT . DIRECTORY_SEPARATOR . 'img' . DIRECTORY_SEPARATOR . 'all-games.png');
    $own = xs_platform_art_dir();
    $seen($own);
    foreach (@scandir($own) ?: [] as $f) {
        if ($f !== '.' && $f !== '..') {
            $seen($own . DIRECTORY_SEPARATOR . $f);
        }
    }
    // Console pictures set to "Xsegon's own" changes no file, so it makes the number negative:
    // switching gives every picture a new address, and switching back the old ones again.
    return ($s['view']['consoleArt'] ?? 'yours') === 'xsegon' ? -$rev : $rev;
}
