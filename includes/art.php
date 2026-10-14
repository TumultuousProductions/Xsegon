<?php
/**
 * Xsegon - the names pictures and videos are found by.
 *
 * Matching is done on a stripped key: everything that is not a letter or a
 * digit is taken out of both sides, so "Demon_s Crest" and "Demon's Crest"
 * become the same string, whatever escaping rule a tool used for the file name.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';

/** The picture slots a game has: box art, its 3D box, clear logo, screenshot, fanart. */
function art_types(): array
{
    return ['box' => [], 'box3d' => [], 'logo' => [], 'shot' => [], 'fanart' => []];
}

/** "Demon's Crest" and "Demon_s Crest" both become "demonscrest". */
function art_key(string $s): string
{
    $s = strtolower($s);
    $s = preg_replace('/[^a-z0-9]+/', '', $s);
    return $s ?? '';
}

/**
 * Strip a "-01" index at the end of a file name. A name carrying a game ID
 * (Title.6b22d922-...-01.jpg) is keyed "id:<id>" rather than by its title.
 */
function art_key_from_filename(string $file): string
{
    $base = pathinfo($file, PATHINFO_FILENAME);
    $base = preg_replace('/-\d{1,3}$/', '', $base);
    if (preg_match('/\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i', (string) $base, $m)) {
        return 'id:' . strtolower($m[1]);
    }
    return art_key((string) $base);
}
