<?php
/**
 * Xsegon - what a hack is: its name, who made it and when, its story and its pictures,
 * for its own page in the Hacks tab of the game it is a hack of (js\hackpage.js). A patch
 * is no game in the library, so what is known of it is kept apart:
 *
 *   data\hack-about.json             yours: { "<about key>": { "dbId": <Games Database id> }
 *                                    or { "title", "developer", "publisher", "released", "genre",
 *                                    "players", "notes" }, both together, or "auto": true for a
 *                                    match Xsegon made (dbId 0: looked up, and none found)
 *   data\hacks\about.json            what the Games Database said of each, so a list reads no database
 *   data\hacks\art\<key>-<kind>.<ext>   box | logo | shot1 | shot2 | shot3; one put there by hand stays
 *
 * The about key is the hacked game's own checksum ("r-<crc32>") for a patch that names it (BPS,
 * UPS), so a hack moved, or remade for another release of its game, keeps its page; else its name
 * ("n-<words>"). A hack nobody said anything of is looked up in the Games Database once, and taken
 * only when a game on the same console has a name that ends in the hack's ("Puzzling" is
 * "The Legend of Zelda: Puzzling", and no other puzzle game).
 */
declare(strict_types=1);

require_once __DIR__ . '/gamesdb.php';

const XS_HACKABOUT_KINDS  = ['box', 'logo', 'shot1', 'shot2', 'shot3'];
const XS_HACKABOUT_FIELDS = ['title', 'developer', 'publisher', 'released', 'genre', 'players', 'notes'];
const XS_HACKABOUT_EXTS   = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

function xs_hackabout_path(): string
{
    return xs_data_path('hack-about.json');
}

function xs_hackabout_cache_path(): string
{
    return xs_data_path('hacks' . DIRECTORY_SEPARATOR . 'about.json');
}

function xs_hackabout_art_dir(): string
{
    return xs_data_path('hacks' . DIRECTORY_SEPARATOR . 'art');
}

/** What you said of each hack. Read once a request: a list asks for every row. */
function xs_hackabout_all(bool $again = false): array
{
    static $all = null;
    if ($all === null || $again) {
        $a = xs_read_json(xs_hackabout_path(), []);
        $all = is_array($a) ? $a : [];
    }
    return $all;
}

function xs_hackabout_cache(bool $again = false): array
{
    static $all = null;
    if ($all === null || $again) {
        $a = xs_read_json(xs_hackabout_cache_path(), []);
        $all = is_array($a) ? $a : [];
    }
    return $all;
}

/** A hack's name as the database would say it: no version at the end, nothing in brackets, no "The" in front. */
function xs_hackabout_name(string $name): string
{
    $n = trim((string) preg_replace('/\s*[\(\[][^\)\]]*[\)\]]/', '', $name));
    // "v1.2a", "v2", "1.1": a number with a v or a dot is a version; "Mario 64" keeps its 64.
    $n = trim((string) preg_replace('/\s+(v\d+(\.\d+)*[a-z]?|\d+(\.\d+)+[a-z]?)$/i', '', $n));
    return trim((string) preg_replace('/^the\s+/i', '', $n));
}

/** Words to compare: lower case, & as "and", every mark a space. */
function xs_hackabout_words(string $s): string
{
    return trim((string) preg_replace('/[^a-z0-9]+/', ' ', strtolower(str_replace('&', ' and ', $s))));
}

function xs_hackabout_key(?string $result, string $name): string
{
    if ($result !== null && preg_match('/^[0-9a-f]{8}$/', $result)) {
        return 'r-' . $result;
    }
    return 'n-' . (substr(str_replace(' ', '-', xs_hackabout_words(xs_hackabout_name($name))), 0, 60) ?: 'patch');
}

/** The fields shown: yours over the database's, each one only when it says something. */
function xs_hackabout_fields(array $said, array $db): array
{
    $out = [];
    foreach (XS_HACKABOUT_FIELDS as $f) {
        $v = $said[$f] ?? $db[$f] ?? null;
        if ($f === 'players') {
            $v = is_numeric($v) && (int) $v > 0 ? (int) $v : null;
        } else {
            $v = is_scalar($v) ? trim((string) $v) : '';
            $v = $v === '' ? null : $v;
        }
        if ($v !== null) {
            $out[$f] = $v;
        }
    }
    return $out;
}

/** The pictures kept for a key: kind => file name, a person's own and the fetched alike. */
function xs_hackabout_pics(string $key): array
{
    $out = [];
    foreach (XS_HACKABOUT_KINDS as $kind) {
        $f = xs_slot_file(xs_hackabout_art_dir() . DIRECTORY_SEPARATOR . $key . '-' . $kind, XS_HACKABOUT_EXTS);
        if ($f !== null) {
            $out[$kind] = basename($f);
        }
    }
    return $out;
}

/** A picture's address for the page, with the file's time, so a new one is fetched again. */
function xs_hackabout_pic_url(string $file): string
{
    return 'api/hacks.php?pic=' . rawurlencode($file) . '&v=' . (int) @filemtime(xs_hackabout_art_dir() . DIRECTORY_SEPARATOR . $file);
}

/** The file of a picture kept under that name, or null. The name is checked before any path is made of it. */
function xs_hackabout_pic_file(string $file): ?string
{
    if (!preg_match('/^(r-[0-9a-f]{8}|n-[a-z0-9-]{1,60})-(box|logo|shot[1-3])\.(png|jpe?g|webp|gif)$/', $file)) {
        return null;
    }
    $dir = realpath(xs_hackabout_art_dir());
    $real = $dir === false ? false : realpath($dir . DIRECTORY_SEPARATOR . $file);
    return $real !== false && is_file($real) && strcasecmp(dirname($real), $dir) === 0 ? $real : null;
}

/** What a list shows of a hack, from the kept files only: no database, no download. Null when nothing is known. */
function xs_hackabout_brief(?string $result, string $name): ?array
{
    $key = xs_hackabout_key($result, $name);
    $said = xs_hackabout_all()[$key] ?? null;
    $db = xs_hackabout_cache()[$key] ?? null;
    $f = xs_hackabout_fields(is_array($said) ? $said : [],
        is_array($db) && is_array($said) && (int) ($db['dbId'] ?? 0) === (int) ($said['dbId'] ?? -1) ? (array) ($db['game'] ?? []) : []);
    $pics = xs_hackabout_pics($key);
    if (!$f && !$pics) {
        return null;
    }
    return ['key' => $key, 'title' => $f['title'] ?? null, 'developer' => $f['developer'] ?? null,
            'year' => isset($f['released']) ? substr($f['released'], 0, 4) : null,
            'box' => isset($pics['box']) ? xs_hackabout_pic_url($pics['box']) : null];
}

/** The Games Database game a hack is, by its name: one on the same console whose name ends in the hack's, or null. */
function xs_hackabout_match(string $name, string $platform): ?int
{
    $plain = xs_hackabout_name($name);
    $want = xs_hackabout_words($plain);
    if (strlen($want) < 6) {
        return null;                                   // "Fix", "Hack": too little to know a game by
    }
    $r = xs_gamesdb(['search', $platform, $plain]);
    foreach ((array) ($r['results'] ?? []) as $c) {
        $have = xs_hackabout_words((string) ($c['title'] ?? ''));
        if (($c['platform'] ?? '') === $platform && ($have === $want || str_ends_with($have, ' ' . $want))) {
            return (int) $c['id'];
        }
    }
    return null;
}

/** Keep these bytes as a hack's picture, once they have decoded as an image. */
function xs_hackabout_store(string $key, string $kind, string $bytes, ?string &$why = null): bool
{
    $why = null;
    $dir = xs_hackabout_art_dir();
    if (strlen($bytes) > 40 * 1024 * 1024) {
        $why = 'larger than 40 MB';
        return false;
    }
    if (!is_dir($dir) && !@mkdir($dir, 0777, true) && !is_dir($dir)) {
        $why = 'data\hacks\art could not be made';
        return false;
    }
    $tmp = $dir . DIRECTORY_SEPARATOR . '.fetch-' . $key . '-' . $kind . '.part';
    if (@file_put_contents($tmp, $bytes) !== strlen($bytes)) {
        @unlink($tmp);
        $why = 'could not be written';
        return false;
    }
    $info = @getimagesize($tmp);
    $exts = [IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg', IMAGETYPE_WEBP => 'webp', IMAGETYPE_GIF => 'gif'];
    if ($info === false || !isset($exts[$info[2]]) || $info[0] < 1) {
        @unlink($tmp);
        $why = 'what came back is not an image';
        return false;
    }
    return xs_put_file($tmp, $dir . DIRECTORY_SEPARATOR . $key . '-' . $kind, $exts[$info[2]], XS_HACKABOUT_EXTS, $why) !== null;
}

/** The database's words for one game, and its pictures fetched for each slot that has none yet. Null when it cannot be read now. */
function xs_hackabout_fetch(string $key, int $dbId): ?array
{
    $g = xs_gamesdb(['game', (string) $dbId]);
    if (empty($g['ok']) || !is_array($g['game'] ?? null)) {
        return null;
    }
    $slots = (array) (xs_gamesdb(['images', (string) $dbId])['slots'] ?? []);
    $want = [];
    foreach (['box' => 'box', 'logo' => 'logo'] as $kind => $slot) {
        if (!empty($slots[$slot][0]['file'])) {
            $want[$kind] = (string) $slots[$slot][0]['file'];
        }
    }
    foreach (array_slice((array) ($slots['shot'] ?? []), 0, 3) as $i => $s) {
        $want['shot' . ($i + 1)] = (string) ($s['file'] ?? '');
    }
    $have = xs_hackabout_pics($key);
    $want = array_filter($want, static fn(string $file, string $kind): bool => !isset($have[$kind]) && xs_gamesdb_picture_name($file),
        ARRAY_FILTER_USE_BOTH);
    if ($want) {
        $urls = array_map('xs_gamesdb_picture_url', $want);
        $got = xs_gamesdb_pictures_get(array_values($urls));
        foreach ($want as $kind => $file) {
            $bytes = $got[$urls[$kind]] ?? null;
            if ($bytes === null || !xs_hackabout_store($key, $kind, $bytes, $why)) {
                xs_log('HACK', 'the ' . $kind . ' picture of ' . $key . ' was not kept: ' . ($bytes === null ? 'it could not be fetched' : $why));
            }
        }
    }
    return ['dbId' => $dbId, 'game' => xs_hackabout_fields([], $g['game']), 'at' => time()];
}

/**
 * Everything a hack's page shows. $p: the patch, as the index keeps it. A hack nobody said
 * anything of is looked up once, and what was found (a game, or none) is written to
 * data\hack-about.json as Xsegon's; the database's words and pictures for it are kept.
 */
function xs_hackabout_for(array $p, string $platform): array
{
    $name = (string) $p['name'];
    $key = xs_hackabout_key($p['result'] ?? null, $name);
    $all = xs_hackabout_all();
    $said = is_array($all[$key] ?? null) ? $all[$key] : null;
    if ($said === null && xs_gamesdb_ready()) {
        $said = ['dbId' => xs_hackabout_match($name, $platform) ?? 0, 'auto' => true];
        $all[$key] = $said;
        if (xs_write_json(xs_hackabout_path(), $all, $why)) {
            xs_hackabout_all(true);
            xs_log('HACK', $name . ($said['dbId'] ? ' is Games Database game ' . $said['dbId'] . ', by its name' : ': not in the Games Database by its name'));
        } else {
            xs_log('WARN', 'what was found of ' . $name . ' was not kept: ' . $why);
        }
    }
    $said = $said ?? [];
    $dbId = (int) ($said['dbId'] ?? 0);
    $kept = xs_hackabout_cache()[$key] ?? null;
    if ($dbId > 0 && (!is_array($kept) || (int) ($kept['dbId'] ?? 0) !== $dbId)) {
        $kept = xs_hackabout_fetch($key, $dbId);
        if ($kept !== null) {
            $cache = xs_hackabout_cache();
            $cache[$key] = $kept;
            if (!is_dir(dirname(xs_hackabout_cache_path()))) {
                @mkdir(dirname(xs_hackabout_cache_path()), 0777, true);
            }
            xs_write_json(xs_hackabout_cache_path(), $cache, $why);
            xs_hackabout_cache(true);
        }
    }
    $db = $dbId > 0 && is_array($kept) && (int) ($kept['dbId'] ?? 0) === $dbId ? (array) ($kept['game'] ?? []) : [];
    $own = xs_hackabout_fields($said, []);
    $pics = xs_hackabout_pics($key);
    $shots = [];
    foreach (['shot1', 'shot2', 'shot3'] as $s) {
        if (isset($pics[$s])) {
            $shots[] = xs_hackabout_pic_url($pics[$s]);
        }
    }
    return ['key' => $key, 'name' => $name, 'dbId' => $dbId, 'auto' => !empty($said['auto']),
            'from' => $own && $db ? 'both' : ($own ? 'you' : ($db ? 'gamesdb' : null))]
         + xs_hackabout_fields($said, $db)
         + ['pics' => ['box' => isset($pics['box']) ? xs_hackabout_pic_url($pics['box']) : null,
                       'logo' => isset($pics['logo']) ? xs_hackabout_pic_url($pics['logo']) : null, 'shots' => $shots]];
}
