<?php
/**
 * libretro's pictures and game details, where filling uses libretro or the database has no picture. The
 * same sources RetroArch itself reads:
 *
 *   https://thumbnails.libretro.com/<system>/Named_Boxarts|Named_Snaps|
 *       Named_Titles|Named_Logos/<name>.png   box art, a screenshot, the
 *       title screen and a clear logo, where they have one
 *   libretro-database metadat/<field>/<system>.dat  genre, release year,
 *       developer, publisher and players, one small text file each
 *
 * both keyed by the standard (No-Intro and Redump) name of each game. The
 * index pages and detail files are kept in data\libretro for 30 days; a
 * game's own pictures go into data\art like any picture chosen in Xsegon.
 *
 * The tests point it at stand-ins (XSEGON_LIBRETRO_THUMBS and _META, honoured
 * only beside XSEGON_DATA), so nothing in a test run reaches libretro.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/overrides.php';

const XS_LR_KEEP_DAYS = 30;
// Xsegon's picture slot => libretro's folder. libretro has no fanart, so the title screen stands in.
const XS_LR_KINDS = ['box' => 'Named_Boxarts', 'shot' => 'Named_Snaps', 'logo' => 'Named_Logos', 'fanart' => 'Named_Titles'];
const XS_LR_FIELDS = ['genre' => 'genre', 'releaseyear' => 'releaseyear', 'developer' => 'developer',
                      'publisher' => 'publisher', 'maxusers' => 'users'];

function xs_lr_base(string $what): string
{
    $test = getenv($what === 'thumbs' ? 'XSEGON_LIBRETRO_THUMBS' : 'XSEGON_LIBRETRO_META');
    if (is_string($test) && $test !== '' && getenv('XSEGON_DATA')) {
        return rtrim($test, '/');
    }
    return $what === 'thumbs' ? 'https://thumbnails.libretro.com'
                              : 'https://raw.githubusercontent.com/libretro/libretro-database/master/metadat';
}

/** Xsegon's console name => libretro's, or null. */
function xs_lr_system(string $platform): ?string
{
    static $map = [
        'Atari 2600' => 'Atari - 2600', 'Atari 5200' => 'Atari - 5200', 'Atari 7800' => 'Atari - 7800',
        'Atari Jaguar' => 'Atari - Jaguar', 'Atari Lynx' => 'Atari - Lynx',
        'Nintendo 64' => 'Nintendo - Nintendo 64', 'Nintendo Entertainment System' => 'Nintendo - Nintendo Entertainment System',
        'Super Nintendo Entertainment System' => 'Nintendo - Super Nintendo Entertainment System',
        'Nintendo Game Boy' => 'Nintendo - Game Boy', 'Nintendo Game Boy Color' => 'Nintendo - Game Boy Color',
        'Nintendo Game Boy Advance' => 'Nintendo - Game Boy Advance', 'Nintendo GameCube' => 'Nintendo - GameCube',
        'Nintendo Wii' => 'Nintendo - Wii', 'Wii U' => 'Nintendo - Wii U', 'Nintendo Wii U' => 'Nintendo - Wii U',
        'Nintendo DS' => 'Nintendo - Nintendo DS', 'Nintendo 3DS' => 'Nintendo - Nintendo 3DS',
        'Nintendo Virtual Boy' => 'Nintendo - Virtual Boy', 'Nintendo Famicom Disk System' => 'Nintendo - Family Computer Disk System',
        'Sega Genesis' => 'Sega - Mega Drive - Genesis', 'Sega Mega Drive' => 'Sega - Mega Drive - Genesis',
        'Sega 32X' => 'Sega - 32X', 'Sega CD' => 'Sega - Mega-CD - Sega CD', 'Sega Saturn' => 'Sega - Saturn',
        'Sega Dreamcast' => 'Sega - Dreamcast', 'Sega Master System' => 'Sega - Master System - Mark III',
        'Sega Game Gear' => 'Sega - Game Gear', 'Sega SG-1000' => 'Sega - SG-1000',
        'Sony Playstation' => 'Sony - PlayStation', 'Sony Playstation 2' => 'Sony - PlayStation 2',
        'Sony Playstation 3' => 'Sony - PlayStation 3', 'Sony PSP' => 'Sony - PlayStation Portable',
        'Sony Playstation Vita' => 'Sony - PlayStation Vita',
        'Microsoft Xbox' => 'Microsoft - Xbox', 'Microsoft Xbox 360' => 'Microsoft - Xbox 360',
        'NEC TurboGrafx-16' => 'NEC - PC Engine - TurboGrafx 16', 'NEC TurboGrafx-CD' => 'NEC - PC Engine CD - TurboGrafx-CD',
        'SNK Neo Geo MVS' => 'SNK - Neo Geo', 'SNK Neo Geo AES' => 'SNK - Neo Geo', 'SNK Neo Geo CD' => 'SNK - Neo Geo CD',
        'SNK Neo Geo Pocket' => 'SNK - Neo Geo Pocket', 'SNK Neo Geo Pocket Color' => 'SNK - Neo Geo Pocket Color',
        '3DO Interactive Multiplayer' => 'The 3DO Company - 3DO', 'ColecoVision' => 'Coleco - ColecoVision',
        'Mattel Intellivision' => 'Mattel - Intellivision', 'GCE Vectrex' => 'GCE - Vectrex',
        'Fairchild Channel F' => 'Fairchild - Channel F', 'Bandai WonderSwan' => 'Bandai - WonderSwan',
        'Bandai WonderSwan Color' => 'Bandai - WonderSwan Color', 'Commodore 64' => 'Commodore - 64',
        // The scanner and the rom reader name these without Bandai
        // (includes\scan.php, includes\romid.php).
        'WonderSwan' => 'Bandai - WonderSwan', 'WonderSwan Color' => 'Bandai - WonderSwan Color',
        'Commodore Amiga' => 'Commodore - Amiga', 'Microsoft MSX' => 'Microsoft - MSX', 'Microsoft MSX2' => 'Microsoft - MSX2',
        'Arcade' => 'FBNeo - Arcade Games', 'MAME' => 'MAME',
    ];
    return $map[$platform] ?? null;
}

function xs_lr_dir(): string
{
    return xs_data_path('libretro');
}

/** One address, or null with $why. A file:// address is read as a file (the tests). */
function xs_lr_get(string $url, ?string &$why = null, int $timeout = 30): ?string
{
    $why = null;
    if (str_starts_with($url, 'file:///')) {
        // These are built with the names encoded (spaces as %20), as the web addresses are.
        $got = @file_get_contents(rawurldecode(substr($url, 8)));
        if ($got === false) {
            $why = 'not there: ' . rawurldecode(substr($url, 8));
            return null;
        }
        return $got;
    }
    $ctx = stream_context_create(['http' => ['timeout' => $timeout, 'user_agent' => 'Xsegon'], 'ssl' => ['verify_peer' => true]]);
    /* The stream's timeout is the real limit: PHP's own clock can kill a
       request mid download, before the cache is written, so every retry
       starts cold. Only a request that already has a limit gets it
       extended; a worker with none (bin\fill.php) must not be given one. */
    if ((int) ini_get('max_execution_time') > 0) {
        set_time_limit($timeout + 15);
    }
    $got = @file_get_contents($url, false, $ctx);
    if ($got === false) {
        $why = 'could not reach ' . (parse_url($url, PHP_URL_HOST) ?: 'libretro');
        return null;
    }
    return $got;
}

function xs_lr_cache_name(string $sys, string $what): string
{
    return xs_lr_dir() . DIRECTORY_SEPARATOR . preg_replace('/[^A-Za-z0-9 \-]+/', '_', $sys) . '.' . $what . '.json';
}

/** A cached answer while it is fresh; a stale one only when libretro cannot be reached. */
function xs_lr_cached(string $file, callable $fetch, ?string &$why = null): ?array
{
    $why = null;
    $have = is_file($file) ? xs_read_json($file, null) : null;
    if (is_array($have) && time() - (int) ($have['at'] ?? 0) < XS_LR_KEEP_DAYS * 86400) {
        return $have;
    }
    $fresh = $fetch($why);
    if ($fresh === null) {
        return is_array($have) ? $have : null;       // offline: last month's list beats none
    }
    $fresh['at'] = time();
    if (!is_dir(xs_lr_dir())) {
        @mkdir(xs_lr_dir(), 0777, true);
    }
    xs_write_json($file, $fresh, $w2);
    return $fresh;
}

/** The picture names libretro has for one console, per kind. */
function xs_lr_index(string $sys, ?string &$why = null): ?array
{
    return xs_lr_cached(xs_lr_cache_name($sys, 'pictures'), static function (?string &$why) use ($sys): ?array {
        $out = ['kinds' => []];
        $base = xs_lr_base('thumbs') . '/' . rawurlencode($sys) . '/';
        $any = false;
        foreach (XS_LR_KINDS as $folder) {
            $url = $base . $folder . '/' . (str_starts_with($base, 'file:') ? 'index.html' : '');
            $html = xs_lr_get($url, $w);
            $names = [];
            if ($html !== null) {
                $any = true;
                preg_match_all('/href="([^"?\/][^"]*\.png)"/', $html, $m);
                foreach ($m[1] as $h) {
                    $names[] = substr(rawurldecode(html_entity_decode($h, ENT_QUOTES)), 0, -4);
                }
            }
            $out['kinds'][$folder] = $names;
        }
        if (!$any) {
            $why = 'libretro could not be reached for ' . $sys . ' (no internet?)';
            return null;
        }
        return $out;
    }, $why);
}

/** name => ['genre','releaseyear','developer','publisher','users'] for one console. */
function xs_lr_meta(string $sys): array
{
    $got = xs_lr_cached(xs_lr_cache_name($sys, 'details'), static function (?string &$why) use ($sys): ?array {
        $games = [];
        $any = false;
        foreach (XS_LR_FIELDS as $folder => $field) {
            $dat = xs_lr_get(xs_lr_base('meta') . '/' . $folder . '/' . rawurlencode($sys) . '.dat', $w);
            if ($dat === null) {
                continue;
            }
            $any = true;
            // game ( comment "Name (USA)" genre "Sports" rom ( crc ... ) )
            preg_match_all('/game \(\s*(?:name|comment) "((?:[^"\\\\]|\\\\.)*)"\s*' . preg_quote($field, '/') . ' "?([^"\n]*)"?/', $dat, $m, PREG_SET_ORDER);
            foreach ($m as $row) {
                $v = trim($row[2]);
                if ($v !== '') {
                    $games[$row[1]][$field] = $v;
                }
            }
        }
        return $any ? ['games' => $games] : null;
    }, $why);
    // The log tells "could not fetch" from "libretro has no data", which read the same on screen.
    if ($got === null) {
        xs_log('LR', $sys . ': details could not be fetched and there is no cached copy'
            . ($why !== null ? ' (' . $why . ')' : ''));
    }
    return $got['games'] ?? [];
}

// ---- matching ----------------------------------------------------------------

/** Words only: lower case, & as and, apostrophes gone, the rest spaces. */
function xs_lr_words(string $s): string
{
    $s = mb_strtolower($s);
    $s = str_replace(['&', "'", "\u{2019}"], [' and ', '', ''], $s);
    return trim((string) preg_replace('/[^a-z0-9]+/', ' ', $s));
}

/** "Legend of Zelda, The - X" and "The Legend of Zelda - X" read the same. */
function xs_lr_title_words(string $s): string
{
    return xs_lr_words((string) preg_replace('/^(.*?), (The|A|An)\b/i', '$2 $1', $s));
}

function xs_lr_title_part(string $name): string
{
    return trim((string) preg_replace('/\s*[\(\[].*$/', '', $name));
}

/** USA first, then World, Europe, anything, Japan. */
function xs_lr_region_rank(string $name): int
{
    if (preg_match('/\((?:[^)]*, )?USA\b/', $name)) {
        return 4;
    }
    if (str_contains($name, '(World')) {
        return 3;
    }
    if (preg_match('/\((?:[^)]*, )?Europe\b/', $name)) {
        return 2;
    }
    return str_contains($name, '(Japan') ? 0 : 1;
}

/** The title a person reads: "Legend of Zelda, The - Oracle of Ages (USA)" is "The Legend of Zelda: Oracle of Ages". */
function xs_lr_display(string $name): string
{
    $t = xs_lr_title_part($name);
    $t = (string) preg_replace('/^(.*?), (The|A|An)( - |$)/', '$2 $1$3', $t);
    return (string) preg_replace('/ - /', ': ', $t, 1);
}

/** Lookup tables for one console's names, built once per request. */
function xs_lr_tables(array $names): array
{
    $t = ['exact' => array_flip($names), 'words' => [], 'titles' => []];
    foreach ($names as $n) {
        $t['words'][xs_lr_words($n)] ??= $n;
        $t['titles'][xs_lr_title_words(xs_lr_title_part($n))][] = $n;
    }
    return $t;
}

function xs_lr_best(array $cands): string
{
    usort($cands, static fn($a, $b) => xs_lr_region_rank($b) <=> xs_lr_region_rank($a) ?: strlen($a) <=> strlen($b));
    return $cands[0];
}

/**
 * The libretro name for a game, and how sure: the file name exactly (sure),
 * the same words (sure), a libretro title the file name starts with
 * (likely), or the game's own title (a guess). null when none of them.
 */
function xs_lr_match(array $g, array $tables): array
{
    $file = (string) pathinfo(basename((string) ($g['romPath'] ?? '')), PATHINFO_FILENAME);
    $fileSp = str_replace('_', ' ', $file);
    if ($file !== '' && strcasecmp($file, 'EBOOT') !== 0) {
        $swapped = (string) preg_replace('/[&*\/:`<>?\\\\|"]/', '_', $fileSp);
        if (isset($tables['exact'][$swapped])) {
            return ['name' => $swapped, 'confidence' => 'sure'];
        }
        $w = xs_lr_words($fileSp);
        if (isset($tables['words'][$w])) {
            return ['name' => $tables['words'][$w], 'confidence' => 'sure'];
        }
        $tf = xs_lr_title_words($fileSp);
        $hit = null;
        $hitLen = 0;
        foreach ($tables['titles'] as $t => $list) {
            $t = (string) $t;
            if (strlen($t) > $hitLen && ($tf === $t || str_starts_with($tf, $t . ' '))) {
                $hit = $list;
                $hitLen = strlen($t);
            }
        }
        if ($hit !== null) {
            return ['name' => xs_lr_best($hit), 'confidence' => 'likely'];
        }
    }
    $tt = xs_lr_title_words((string) ($g['title'] ?? ''));
    if ($tt !== '' && isset($tables['titles'][$tt])) {
        return ['name' => xs_lr_best($tables['titles'][$tt]), 'confidence' => 'maybe'];
    }
    return ['name' => null, 'confidence' => 'none'];
}

/** Names on one console holding every word of $q, best region first, at most $max. */
function xs_lr_search(array $names, string $q, int $max = 30): array
{
    $want = array_values(array_filter(explode(' ', xs_lr_title_words($q))));
    if (!$want) {
        return [];
    }
    $hits = [];
    foreach ($names as $n) {
        $have = ' ' . xs_lr_title_words($n) . ' ';
        foreach ($want as $w) {
            if (!str_contains($have, ' ' . $w . ' ')) {
                continue 2;
            }
        }
        $hits[] = $n;
    }
    usort($hits, static fn($a, $b) => strlen(xs_lr_title_part($a)) <=> strlen(xs_lr_title_part($b)) ?: xs_lr_region_rank($b) <=> xs_lr_region_rank($a));
    return array_slice($hits, 0, $max);
}

/** Every name libretro has for a console, pictures of any kind. */
function xs_lr_names(array $index): array
{
    $all = [];
    foreach ($index['kinds'] ?? [] as $names) {
        foreach ($names as $n) {
            $all[$n] = true;
        }
    }
    return array_keys($all);
}

// ---- remembering a match, and filling from it -----------------------------

/** The libretro name chosen for a game, kept with its edits (like a Games Database match). */
function xs_lr_link(string $id, string $name, ?string &$why = null): bool
{
    $all = xs_overrides();
    $all[$id]['lrName'] = $name;
    return xs_write_json(xs_overrides_path(), $all, $why);
}

/**
 * One picture from libretro as the game's own for that slot. Only a name
 * libretro's own list has, so nothing else can be asked for. Returns what
 * was stored, or null with $why; $dry says what it would fetch.
 */
function xs_lr_fetch(string $id, string $kind, string $sys, array $index, string $name, ?string &$why = null, bool $dry = false): ?array
{
    $why = null;
    $folder = XS_LR_KINDS[$kind] ?? null;
    if ($folder === null) {
        $why = 'no such slot: ' . $kind;
        return null;
    }
    if (!in_array($name, $index['kinds'][$folder] ?? [], true)) {
        $why = 'none on record';
        return null;
    }
    $url = xs_lr_base('thumbs') . '/' . rawurlencode($sys) . '/' . $folder . '/' . rawurlencode($name . '.png');
    if ($dry) {
        return ['id' => $id, 'kind' => $kind, 'url' => $url, 'dry' => true];
    }
    $bytes = xs_lr_get($url, $why);
    if ($bytes === null || $bytes === '') {
        $why = $why ?? 'an empty picture';
        return null;
    }
    return xs_own_art_store($id, $kind, $bytes, true, $why);
}

/** Details libretro has for a name, as the edit fields they fill. */
function xs_lr_details(string $sys, string $name): array
{
    $m = xs_lr_meta($sys)[$name] ?? [];
    $out = [];
    foreach (['genre' => 'genre', 'developer' => 'developer', 'publisher' => 'publisher'] as $from => $to) {
        if (($m[$from] ?? '') !== '') {
            $out[$to] = $m[$from];
        }
    }
    if (preg_match('/^\d{4}$/', (string) ($m['releaseyear'] ?? ''))) {
        $out['released'] = $m['releaseyear'];
    }
    if ((int) ($m['users'] ?? 0) > 0) {
        $out['players'] = (int) $m['users'];
    }
    return $out;
}
