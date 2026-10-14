<?php
/**
 * Xsegon - edits to a game's metadata, kept as an overlay.
 *
 * LaunchBox's files are read-only to Xsegon, ALWAYS. An edit goes to
 * data\overrides.json, keyed by game id, and is laid over the imported values
 * every time the library is read: a re-import never loses it, and "reset to
 * LaunchBox" is deleting one entry.
 *
 * Only the fields listed here can be edited. The id, platform, ROM path and
 * emulator are how a game is FOUND and LAUNCHED; changing them could make a
 * game vanish.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/art.php';

/** field => [type, max length]. The order is the order the dialog shows. */
function xs_override_fields(): array
{
    return [
        'title'     => ['text', 200],
        'sortTitle' => ['text', 200],
        'developer' => ['text', 200],
        'publisher' => ['text', 200],
        'genre'     => ['text', 200],
        'released'  => ['date', 10],
        'rating'    => ['rating', 0],
        // How many at once: the 1P / 2P marks and the Two players collection read it.
        'players'   =>['count', 0],
        'playMode'  => ['text', 100],
        'region'    => ['text', 100],
        'notes'     => ['longtext', 20000],
    ];
}

function xs_overrides_path(): string
{
    return xs_data_path('overrides.json');
}

function xs_overrides(): array
{
    $o = xs_read_json(xs_overrides_path(), []);
    return is_array($o) ? $o : [];
}

/**
 * One submitted value, cleaned, or an error string in $err.
 * Null means "valid and empty", which is allowed for everything but title.
 */
function xs_override_clean(string $field, $value, ?string &$err)
{
    $err  = null;
    $spec = xs_override_fields()[$field] ?? null;
    if ($spec === null) {
        $err = "{$field} cannot be edited";
        return null;
    }
    [$type, $max] = $spec;

    if ($type === 'count') {
        if ($value === '' || $value === null) {
            return null;                        // blank is "nobody said", not zero
        }
        if (!is_numeric($value) || (int) $value != $value || $value < 1 || $value > 64) {
            $err = 'players is a whole number from 1 to 64';
            return null;
        }
        return (int) $value;
    }

    if ($type === 'rating') {
        if ($value === '' || $value === null) {
            return null;
        }
        if (!is_numeric($value) || $value < 0 || $value > 5) {
            $err = 'rating is a number from 0 to 5';
            return null;
        }
        return round((float) $value, 2);
    }

    $text = trim((string) $value);
    if ($type !== 'longtext') {
        $text = preg_replace('/\s+/', ' ', $text) ?? $text;
    }
    if (mb_strlen($text) > $max) {
        $err = "{$field} is longer than {$max} characters";
        return null;
    }
    if ($field === 'title' && $text === '') {
        $err = 'a game needs a title';
        return null;
    }
    if ($type === 'date' && $text !== '' && !preg_match('/^\d{4}(-\d{2}(-\d{2})?)?$/', $text)) {
        // What was typed is said back, so the log shows what a person tried.
        $err = 'release date is YYYY, YYYY-MM or YYYY-MM-DD, such as 1998-11-21; "' . mb_substr($text, 0, 40) . '" is not';
        return null;
    }
    return $text === '' ? null : $text;
}

/**
 * The game an overlay sits on top of, with NO overlay applied, and where it
 * came from in $origin.
 *
 * Read from the files, not xs_library(), which hands back the overlaid
 * values: an edit compared against itself always looks unchanged.
 *
 *   - 'launchbox': library.json. Reset puts LaunchBox's value back, and the
 *     dialog shows that value beside yours.
 *   - 'scanned': data\scanned-games.json. The source is only a title cleaned
 *     from the file name, so the dialog must not offer a LaunchBox value.
 *   - 'own': data\local-games.json. Its record IS the source, edited through
 *     its own form, so it answers null with the origin set.
 *
 * In none of the three: null with $origin null.
 */
function xs_override_source(string $id, ?string &$origin = null): ?array
{
    $origin = null;
    require_once __DIR__ . '/import.php';
    foreach (xs_read_json(xs_library_path(), ['games' => []])['games'] ?? [] as $g) {
        if (($g['id'] ?? null) === $id) {
            $origin = 'launchbox';
            return $g;
        }
    }
    require_once __DIR__ . '/scan.php';
    foreach (xs_scanned_games($id) as $g) {
        if ($g['id'] === $id) {
            $origin = 'scanned';
            return $g;
        }
    }
    require_once __DIR__ . '/local.php';
    foreach (xs_local_read() as $g) {
        if ((string) ($g['id'] ?? '') === $id) {
            $origin = 'own';
            return null;
        }
    }
    return null;
}

/**
 * Lay the overlay over the imported games.
 *
 * Every edited game keeps the imported values under 'source' and what was
 * changed under 'edited'. 'sourceKey' is the key of the ORIGINAL title, which
 * files on disk are named after; 'key' follows the new title, for search.
 */
function xs_apply_overrides(array $games, ?array $overlay = null): array
{
    $overlay = $overlay ?? xs_overrides();
    if (!$overlay) {
        return $games;
    }
    $fields = xs_override_fields();
    foreach ($games as &$g) {
        $mine = $overlay[$g['id']] ?? null;
        if (!is_array($mine) || !$mine) {
            continue;
        }
        $g['sourceKey'] = $g['key'] ?? art_key((string) $g['title']);
        $g['source']    = [];
        $g['edited']    = [];
        foreach ($mine as $field => $value) {
            // A Games Database match chosen by hand: not shown or counted as an edit.
            if ($field === 'dbId') {
                $g['dbId'] = (int) $value;
                continue;
            }
            // The same for a libretro match (includes\libretro.php).
            if ($field === 'lrName') {
                $g['lrName'] = (string) $value;
                continue;
            }
            if (!isset($fields[$field])) {
                continue;                       // a field this version no longer edits
            }
            $g['source'][$field] = $g[$field] ?? null;
            $g[$field]           = $value;
            $g['edited'][]       = $field;
        }
        if (in_array('title', $g['edited'], true)) {
            $g['key'] = art_key((string) $g['title']);
            // An untouched sort title follows the new title.
            if (!in_array('sortTitle', $g['edited'], true)) {
                $g['sortTitle'] = $g['title'];
            }
        }
    }
    unset($g);
    return $games;
}

// ---- images replaced in Xsegon -------------------------------------------
/*
 * The same overlay idea, for art. A replacement image is a FILE in Xsegon's
 * own store; the original picture is never changed:
 *
 *     data\art\<game id>-<kind>.<ext>        kind: box | box3d | logo | shot | fanart
 *
 * Its existence is the whole record, with no index file to fall out of step.
 */

// ---- games Xsegon is told not to show --------------------------------------
/*
 * data\hidden.json:  { "<game id>": "<title, for the list in Settings>" }
 *
 * For things listed that are not games (a readme, a firmware file): off every
 * view and count, as an overlay. Settings > Library lists them, with Show again.
 */
function xs_hidden_games(): array
{
    $h = xs_read_json(xs_data_path('hidden.json'), []);
    return is_array($h) ? $h : [];
}

function xs_apply_hidden(array $lib): array
{
    return xs_lib_without($lib, xs_hidden_games());
}

/** The library with these games added: appended, their consoles' counts topped up. */
function xs_lib_with(array $lib, array $mine): array
{
    if (!$mine) {
        return $lib;
    }
    $lib['games'] = array_merge($lib['games'] ?? [], $mine);
    foreach ($mine as $g) {
        $lib['platforms'][$g['platform']] = ($lib['platforms'][$g['platform']] ?? 0) + 1;
    }
    if (isset($lib['counts']['games'])) {
        $lib['counts']['games'] += count($mine);
    }
    return $lib;
}

/** The library without the games whose ids are keys of $ids, the counts kept honest. */
function xs_lib_without(array $lib, array $ids): array
{
    if (!$ids || empty($lib['games'])) {
        return $lib;
    }
    $kept = [];
    foreach ($lib['games'] as $g) {
        if (isset($ids[(string) $g['id']])) {
            if (isset($lib['platforms'][$g['platform']])) {
                $lib['platforms'][$g['platform']]--;
                if ($lib['platforms'][$g['platform']] <= 0) {
                    unset($lib['platforms'][$g['platform']]);
                }
            }
            if (isset($lib['counts']['games'])) {
                $lib['counts']['games']--;
            }
            continue;
        }
        $kept[] = $g;
    }
    $lib['games'] = $kept;
    return $lib;
}

// ---- pictures Xsegon is told not to use ------------------------------------
/*
 * data\art-hidden.json:  { "<game id>": ["logo", ...] }
 *
 * For a picture on disk that matches the game but is the wrong one to show:
 * the file stays where it is and Xsegon does not use it. An image replaced in
 * Xsegon (data\art) still wins.
 */
function xs_art_hidden(): array
{
    $h = xs_read_json(xs_data_path('art-hidden.json'), []);
    return is_array($h) ? $h : [];
}

function xs_apply_art_hidden(array $games): array
{
    $hidden = xs_art_hidden();
    if (!$hidden) {
        return $games;
    }
    foreach ($games as &$g) {
        foreach ((array) ($hidden[$g['id']] ?? []) as $kind) {
            if (is_string($kind) && array_key_exists($kind, $g['art'] ?? [])) {
                $g['art'][$kind] = null;
            }
        }
    }
    unset($g);
    return $games;
}

function xs_own_art_kinds(): array
{
    return ['box' => 'Box art', 'box3d' => '3D box', 'logo' => 'Clear logo', 'shot' => 'Screenshot', 'fanart' => 'Fanart / background'];
}

function xs_own_art_dir(): string
{
    return xs_data_path('art');
}

/**
 * Keep these bytes as the game's picture for one slot, in data\art. Nothing
 * gets a name the rest of Xsegon reads until it has decoded as an image; the
 * slot's other files and its thumbnail go. $liftHidden takes the slot's "use
 * no picture" note away. Returns what was stored, or null with $why.
 */
function xs_own_art_store(string $id, string $kind, string $bytes, bool $liftHidden, ?string &$why = null): ?array
{
    $why = null;
    if (strlen($bytes) > 40 * 1024 * 1024) {
        $why = 'that picture is larger than 40 MB';
        return null;
    }
    $dir = xs_own_art_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0777, true)) {
        $why = 'could not create data\art';
        return null;
    }
    $stem = $dir . DIRECTORY_SEPARATOR . $id . '-' . $kind;
    $tmp  = $dir . DIRECTORY_SEPARATOR . '.fetch-' . $id . '-' . $kind . '.part';
    if (file_put_contents($tmp, $bytes) === false) {
        $why = 'could not write the picture';
        return null;
    }
    $info = @getimagesize($tmp);
    $exts = [IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg', IMAGETYPE_WEBP => 'webp', IMAGETYPE_GIF => 'gif'];
    if ($info === false || !isset($exts[$info[2]]) || $info[0] < 1) {
        @unlink($tmp);
        $why = 'what came back is not an image';
        return null;
    }
    $final = xs_put_file($tmp, $stem, $exts[$info[2]], ['png', 'jpg', 'jpeg', 'webp', 'gif'], $held);
    if ($final === null) {
        $why = 'could not store the picture (' . $held . '): the one before it is still there';
        return null;
    }
    foreach (['.jpg', '.png'] as $e) {
        @unlink(xs_data_path('thumbs' . DIRECTORY_SEPARATOR . $kind . DIRECTORY_SEPARATOR . $id . $e));
    }
    if ($liftHidden) {
        $hidden = xs_art_hidden();
        if (isset($hidden[$id])) {
            $hidden[$id] = array_values(array_diff((array) $hidden[$id], [$kind]));
            if (!$hidden[$id]) {
                unset($hidden[$id]);
            }
            xs_write_json(xs_data_path('art-hidden.json'), $hidden ?: new stdClass());
        }
    }
    return ['width' => $info[0], 'height' => $info[1], 'bytes' => strlen($bytes), 'rev' => (int) filemtime($final)];
}

/** [game id => [kind => absolute path]] */
function xs_own_art_index(): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $cache = [];
    $dir   = xs_own_art_dir();
    foreach (@scandir($dir) ?: [] as $f) {
        if (preg_match('/^([A-Za-z0-9\-]{1,64})-(box|box3d|logo|shot|fanart)\.(png|jpe?g|webp|gif)$/i', $f, $m)) {
            // Two endings for one slot (an old one something held as it was replaced): the newer is the picture.
            $had = $cache[$m[1]][strtolower($m[2])] ?? null;
            if ($had !== null && (int) @filemtime($had) >= (int) @filemtime($dir . DIRECTORY_SEPARATOR . $f)) {
                continue;
            }
            $cache[$m[1]][strtolower($m[2])] = $dir . DIRECTORY_SEPARATOR . $f;
        }
    }
    return $cache;
}

/**
 * Point each game's art at its replacement where there is one. What was there
 * is kept under 'artSource'; 'artRev' is the newest replacement's mtime, put in
 * image URLs so a replaced image is never answered from the browser's cache.
 */
function xs_apply_own_art(array $games, ?string $only = null): array
{
    $own = xs_own_art_index();
    if (!$own) {
        return $games;
    }
    foreach ($games as &$g) {
        $mine = $own[$g['id']] ?? null;
        // With $only, that one game's pictures alone are read (xs_game).
        if (!$mine || ($only !== null && (string) $g['id'] !== $only)) {
            continue;
        }
        $g['artSource'] = [];
        $g['artRev']    = 0;
        foreach ($mine as $kind => $path) {
            $g['artSource'][$kind] = $g['art'][$kind] ?? null;
            $g['art'][$kind]       = $path;
            $g['artRev']           = max($g['artRev'], (int) @filemtime($path));
        }
    }
    unset($g);
    return $games;
}
