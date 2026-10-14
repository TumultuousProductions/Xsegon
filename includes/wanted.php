<?php
/**
 * Xsegon - the wanted list (Games > Games you do not have): games you do not
 * have, starred to look for and exported as a list.
 *
 * The known db is the Games Database Xsegon already carries (bin\gamesdb.php,
 * commands "platforms" and "list"). A star is kept in data\wanted.json,
 * keyed by the database's own number for the game, with enough beside it
 * (title, console, year) for the list to be read and exported without the
 * database. It is a file of yours: backed up with your favourites, and never
 * saved over when it will not read (includes\boot.php, XS_YOURS_JSON).
 *
 * Nothing here downloads, links to or finds a game. It is a shopping list.
 */
declare(strict_types=1);

require_once __DIR__ . '/import.php';
require_once __DIR__ . '/gamesdb.php';

function xs_wanted_path(): string
{
    return xs_data_path('wanted.json');
}

/** database id => ['title', 'platform', 'year', 'at'] */
function xs_wanted_read(): array
{
    $w = xs_read_json(xs_wanted_path(), []);
    return is_array($w) ? $w : [];
}

/** The library's name for a console is the database's, but for these. */
function xs_wanted_library_names(string $dbPlatform): array
{
    return $dbPlatform === 'Windows' ? ['Windows', 'Steam'] : [$dbPlatform];
}

/**
 * The games you have for a console, as the reader wants them: their titles
 * and the database numbers the library holds. Hidden and deleted games are
 * not in the library, so a game you deleted reads as one you do not have.
 */
function xs_wanted_have(string $dbPlatform): array
{
    $names = xs_wanted_library_names($dbPlatform);
    $titles = [];
    $ids = [];
    foreach (xs_library()['games'] ?? [] as $g) {
        if (!in_array((string) ($g['platform'] ?? ''), $names, true)) {
            continue;
        }
        $titles[] = (string) ($g['title'] ?? '');
        if (!empty($g['dbId'])) {
            $ids[] = (int) $g['dbId'];
        }
    }
    return ['titles' => $titles, 'dbIds' => $ids];
}

/** Every game on record for a console, each marked have or not. */
function xs_wanted_list(string $dbPlatform): array
{
    $tmp = tempnam(sys_get_temp_dir(), 'xsw');
    if ($tmp === false || @file_put_contents($tmp, json_encode(xs_wanted_have($dbPlatform))) === false) {
        return ['ok' => false, 'error' => 'could not hand the reader the list of games you have'];
    }
    try {
        return xs_gamesdb(['list', $dbPlatform, $tmp], 30);
    } finally {
        @unlink($tmp);
    }
}

/** The starred games as rows, by console then title. */
function xs_wanted_rows(string $platform = ''): array
{
    $rows = [];
    foreach (xs_wanted_read() as $id => $w) {
        if (!is_array($w) || ($platform !== '' && ($w['platform'] ?? '') !== $platform)) {
            continue;
        }
        $rows[] = ['id' => (int) $id, 'title' => (string) ($w['title'] ?? ''), 'platform' => (string) ($w['platform'] ?? ''),
                   'year' => (string) ($w['year'] ?? ''), 'at' => (string) ($w['at'] ?? '')];
    }
    usort($rows, static fn ($a, $b) => [strtolower($a['platform']), strtolower($a['title'])] <=> [strtolower($b['platform']), strtolower($b['title'])]);
    return $rows;
}

/** One cell of a CSV line: quoted, and never read by a spreadsheet as a formula. */
function xs_wanted_csv(string $v): string
{
    if ($v !== '' && strpbrk($v[0], '=+-@') !== false) {
        $v = "'" . $v;
    }
    return '"' . str_replace('"', '""', $v) . '"';
}
