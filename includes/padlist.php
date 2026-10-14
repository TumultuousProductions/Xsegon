<?php
/**
 * Controllers by their maker and product numbers, from the list that SDL
 * programs share (includes\padlist\gamecontrollerdb.txt, zlib licence, its
 * licence beside it; fetched by tools\get-controller-list.js). For a pad the
 * browser hands over in its own button order, the list says which button is
 * which (js\padlist.js). Nothing here reaches a game.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';

/** The parts of the usual layout a line may name, in the list's own words. */
const XS_PADLIST_PARTS = ['a', 'b', 'x', 'y', 'leftshoulder', 'rightshoulder', 'lefttrigger', 'righttrigger',
                          'back', 'start', 'leftstick', 'rightstick', 'dpup', 'dpdown', 'dpleft', 'dpright', 'guide',
                          'leftx', 'lefty', 'rightx', 'righty'];

/**
 * One line of the list as its name and parts. A part is a button ['b', n], a
 * direction of a hat ['h', hat, bit] (1 up, 2 right, 4 down, 8 left) or an
 * axis ['a', n, half, turned]: half is '+' or '-' when only that side counts,
 * turned when the list marks the axis as running the other way.
 */
function xs_padlist_parse(string $line): ?array
{
    $f = explode(',', trim($line));
    if (count($f) < 3) {
        return null;
    }
    $parts = [];
    foreach (array_slice($f, 2) as $pair) {
        $kv = explode(':', $pair, 2);
        if (count($kv) !== 2 || !in_array($kv[0], XS_PADLIST_PARTS, true)) {
            continue;
        }
        if (preg_match('/^b(\d+)$/', $kv[1], $m)) {
            $parts[$kv[0]] = ['b', (int) $m[1]];
        } elseif (preg_match('/^h(\d+)\.(\d+)$/', $kv[1], $m)) {
            $parts[$kv[0]] = ['h', (int) $m[1], (int) $m[2]];
        } elseif (preg_match('/^([+-]?)a(\d+)(~?)$/', $kv[1], $m)) {
            $parts[$kv[0]] = ['a', (int) $m[2], $m[1], $m[3] === '~'];
        }
    }
    return $parts ? ['name' => $f[1], 'parts' => $parts] : null;
}

/**
 * The Windows line for a maker and a product, four hex digits each, or null.
 * A line's id carries the two numbers low byte first at fixed places: after
 * its first eight digits come the maker, four zeros, the product, four zeros.
 */
function xs_padlist_find(string $vendor, string $product, ?string $file = null): ?array
{
    $fh = @fopen($file ?? XS_ROOT . '/includes/padlist/gamecontrollerdb.txt', 'r');
    if ($fh === false) {
        return null;
    }
    $swap  = static fn(string $h): string => substr($h, 2, 2) . substr($h, 0, 2);
    $want  = $swap(strtolower($vendor)) . '0000' . $swap(strtolower($product)) . '0000';
    $found = null;
    while (($line = fgets($fh)) !== false) {
        if (strlen($line) < 40 || $line[0] === '#' || substr($line, 8, 16) !== $want || strpos($line, 'platform:Windows') === false) {
            continue;
        }
        $found = xs_padlist_parse($line);
        if ($found !== null) {
            break;
        }
    }
    fclose($fh);
    return $found;
}
