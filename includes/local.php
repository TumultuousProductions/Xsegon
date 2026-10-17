<?php
/**
 * Xsegon - your own games.
 *
 *     data\local-games.json      [ { id, title, platform, run | url, ... }, ... ]
 *
 * Games added by hand: something you made, a web game, a program. Each is
 * filed under a platform of your choosing and is then a game like any other.
 * The id is Xsegon's own ("xs-" and a random part), so it never collides
 * with an imported game.
 *
 * Two ways to play:
 *     run: "C:\\Games\\Mine\\game.exe"     a program or file, with optional args
 *     url: "http://127.0.0.1:8090/"        a web game, opened in the browser
 *
 * Merged into the library when it is READ (xs_library), never written into
 * library.json, which is rebuilt on import. This file is the record.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/art.php';
require_once __DIR__ . '/overrides.php';    // xs_own_art_kinds: the slots a game has

/**
 * Where a game of your own goes when you did not say. A blank platform stays
 * blank in the file, and everything that reads the entry files it under this.
 */
const XS_LOCAL_UNKNOWN = 'Unknown';

function xs_local_platform(array $entry): string
{
    $p = trim((string) ($entry['platform'] ?? ''));
    return $p === '' ? XS_LOCAL_UNKNOWN : $p;
}

function xs_local_path(): string
{
    return xs_data_path('local-games.json');
}

/** The file as stored: a list of entries, or [] when there is none. */
function xs_local_read(): array
{
    $l = xs_read_json(xs_local_path(), []);
    return is_array($l) ? array_values(array_filter($l, 'is_array')) : [];
}

function xs_local_write(array $entries, ?string &$why = null): bool
{
    if (!xs_write_json(xs_local_path(), array_values($entries), $why)) {
        return false;
    }
    // Every game here is one you put there, so none is for the mailbox to announce.
    require_once __DIR__ . '/news.php';
    xs_news_know($entries);
    return true;
}

function xs_local_new_id(): string
{
    return 'xs-' . bin2hex(random_bytes(6));
}

/** The fields an entry may carry, with their cleaning rule. */
function xs_local_fields(): array
{
    return [
        'title'     => 'text',
        'platform'  => 'text',
        'run'       => 'path',      // a program or file to run
        'args'      => 'text',      // its arguments
        'url'       => 'url',       // or a web address to open
        'developer' => 'text',
        'publisher' => 'text',
        'genre'     => 'text',
        'released'  => 'date',
        'rating'    => 'rating',
        'players'   => 'count',     // how many can play at once; blank is unknown
        'notes'     => 'longtext',
        // A Steam game: its app, its folder (the launcher follows it to know when it
        // has stopped) and its own program, for Play without Steam.
        'steamId'   => 'text',
        'steamDir'  => 'path',
        'steamExe'  => 'path',
        'steamArgs' => 'text',
        // A Flashpoint game: its ID in Flashpoint's list, which its helper starts (includes\flashpoint.php).
        'fpId'      => 'text',
    ];
}

/** The fields the Edit Game form does not send, which a save must not lose. */
function xs_local_kept_fields(): array
{
    return ['steamId', 'steamDir', 'steamArgs', 'fpId'];
}

/**
 * Clean a submitted entry. Returns the entry, or a string saying what is
 * wrong. A game needs a title, a platform and one way to play.
 */
function xs_local_clean(array $in, ?string $id = null)
{
    $out = ['id' => $id ?? xs_local_new_id()];
    foreach (xs_local_fields() as $f => $type) {
        $v = $in[$f] ?? '';
        if ($type === 'rating') {
            if ($v === '' || $v === null) {
                continue;
            }
            if (!is_numeric($v) || $v < 0 || $v > 5) {
                return 'rating is a number from 0 to 5';
            }
            $out[$f] = round((float) $v, 2);
            continue;
        }
        if ($type === 'count') {
            // Blank stays blank: unknown keeps a game out of Two players, where a 0 or a 1 would be a claim.
            if ($v === '' || $v === null) {
                continue;
            }
            if (!is_numeric($v) || (int) $v < 1 || (int) $v > 64) {
                return 'players is a whole number from 1 to 64';
            }
            $out[$f] = (int) $v;
            continue;
        }
        $v = trim((string) $v);
        if ($type !== 'longtext') {
            $v = preg_replace('/\s+/', ' ', $v) ?? $v;
        }
        if ($v === '') {
            continue;
        }
        if (mb_strlen($v) > ($type === 'longtext' ? 20000 : 500)) {
            return $f . ' is too long';
        }
        if ($type === 'date' && !preg_match('/^\d{4}(-\d{2}(-\d{2})?)?$/', $v)) {
            return 'release date is YYYY, YYYY-MM or YYYY-MM-DD, such as 1998-11-21; "' . mb_substr($v, 0, 40) . '" is not';
        }
        if ($type === 'url' && !preg_match('#^https?://#i', $v)) {
            return 'the address must start with http:// or https://';
        }
        if ($type === 'path') {
            $v = xs_norm_path($v);
        }
        $out[$f] = $v;
    }
    if (empty($out['title'])) {
        return 'a game needs a title';
    }
    // No platform is allowed: it is filed under Unknown (XS_LOCAL_UNKNOWN).
    if (!empty($out['platform']) && preg_match('/^@/', $out['platform'])) {
        return 'a platform name cannot start with @';   // @ is a collection
    }
    if (empty($out['run']) && empty($out['url'])) {
        return 'say what to run, or a web address to open';
    }
    return $out;
}

/**
 * Shape each entry like an imported game, so nothing downstream has to know
 * the difference. The launch is marked 'local' and 'url' or 'run'; api\launch.php
 * reads that instead of the emulator command.
 */
function xs_local_games(): array
{
    $games = [];
    foreach (xs_local_read() as $e) {
        if (empty($e['id']) || empty($e['title'])) {
            continue;                       // an entry with no name is not a game
        }
        $run = (string) ($e['run'] ?? '');
        $url = (string) ($e['url'] ?? '');
        $launch = null;
        $why = null;
        // Its own program, when there, serves Play without Steam and Play when steam.exe is gone.
        $steam = null;
        if (!empty($e['steamId'])) {
            $sx = (string) ($e['steamExe'] ?? '');
            $steam = ['id' => (string) $e['steamId'], 'dir' => (string) ($e['steamDir'] ?? ''),
                      'exe' => $sx !== '' && xs_file_seen($sx) ? $sx : '', 'args' => (string) ($e['steamArgs'] ?? '')];
        }
        if ($url !== '') {
            $launch = ['local' => 'url', 'url' => $url, 'via' => 'browser'];
        } elseif ($run !== '') {
            if (xs_file_seen($run)) {
                $viaSteam = $steam !== null && strcasecmp(basename($run), 'steam.exe') === 0;
                $launch = ['local' => 'run', 'exe' => $run, 'args' => (string) ($e['args'] ?? ''), 'rom' => '',
                           'via' => $viaSteam ? 'Steam' : (!empty($e['fpId']) ? 'Flashpoint' : 'program')];
            } elseif ($steam !== null && $steam['exe'] !== '') {
                $launch = ['local' => 'run', 'exe' => $steam['exe'], 'args' => $steam['args'], 'rom' => '', 'via' => 'its own program'];
            } elseif (!empty($e['fpId'])) {
                require_once __DIR__ . '/flashpoint.php';
                $why = xs_fp_launch_why($e) ?? 'not found: ' . $run;
            } else {
                $why = 'not found: ' . $run;
            }
        } else {
            $why = 'nothing to run';
        }
        if ($launch !== null && $steam !== null) {
            $launch['steam'] = $steam;           // api\launch.php has the launcher follow its folder
        }
        $games[] = [
            'id'          => (string) $e['id'],
            'title'       => (string) $e['title'],
            'sortTitle'   => (string) $e['title'],
            'platform'    => xs_local_platform($e),
            'romPath'     => $run,
            'emulatorId'  => '',
            'developer'   => (string) ($e['developer'] ?? ''),
            'publisher'   => (string) ($e['publisher'] ?? ''),
            'genre'       => (string) ($e['genre'] ?? ''),
            'region'      => '',
            'playMode'    => '',
            'released'    => (string) ($e['released'] ?? ''),
            'notes'       => (string) ($e['notes'] ?? ''),
            'rating'      => (float) ($e['rating'] ?? 0),
            'stars'       => 0.0,
            'favourite'   => false,
            'hidden'      => false,
            'broken'      => false,
            'missingVideo'=> false,
            'playCount'   => 0,
            'playTime'    => 0,
            'wikipedia'   => '',
            'dbId'        => 0,
            'art'         => array_fill_keys(array_keys(xs_own_art_kinds()), null),
            'launch'      => $launch,
            'launchError' => $why,
            'key'         => art_key((string) $e['title']),
            'local'       => true,          // the one flag that says "yours"
            // For the Recently added collection; an entry with none never shows there.
            'added'       => (string) ($e['added'] ?? ''),
            // 0 for unknown, the same field the imported games carry.
            'players'     =>(int) ($e['players'] ?? 0),
            'steam'       => $steam,
        ];
    }
    return $games;
}

/** Merge into a library array: games appended, platform counts topped up. */
function xs_apply_local(array $lib): array
{
    return xs_lib_with($lib, xs_local_games());
}
