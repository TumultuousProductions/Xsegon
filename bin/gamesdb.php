<?php
/**
 * Xsegon - read LaunchBox's Games Database.
 *
 *   php bin\gamesdb.php images <databaseId>            every picture on record for that game
 *   php bin\gamesdb.php game   <databaseId>            its metadata
 *   php bin\gamesdb.php search <platform> <title>      games whose name matches, best first
 *   ... and prepare, match, matchmany, fill, platforms, list
 *
 * The LaunchBox Games Database (gamesdb.launchbox-app.com) as an SQLite file;
 * a picture is one HTTPS fetch from images.launchbox-app.com/<FileName>. One
 * JSON answer on stdout for one ask; includes\gamesdb.php runs it and relays it.
 *
 * A process of its own: it needs sqlite3, bz2 and intl, which a shared php.ini
 * may leave off, so includes\gamesdb.php names them on its command line.
 *
 * data\gamesdb.sqlite is unpacked from the packed copy and only read. Unpacking
 * takes seconds, so includes\gamesdb.php runs "prepare" first when one is due.
 * The helpers below keep JavaScript's rules (js_number, js_string, js_trim,
 * either, num, round1): the server and page expect the earlier JS reader's answers.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

// One JSON answer on stdout and nothing else, whatever goes wrong: a warning
// printed in front of it would be read as "the reader did not answer".
ini_set('display_errors', '0');
ini_set('serialize_precision', '-1');       // 4.1 is written 4.1, whatever php.ini says
/* Room for the biggest answer: every Windows game on record comes near PHP's
   default 128 MB, and the database grows. This process answers one ask and ends. */
ini_set('memory_limit', '1024M');
error_reporting(E_ALL);
set_time_limit(0);

function out(array $o): void
{
    echo json_encode($o, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS);
    exit(0);
}
function fail(string $m): void
{
    out(['ok' => false, 'error' => $m]);
}
set_exception_handler(static function (Throwable $e): void {
    fail('the database reader stopped: ' . $e->getMessage());
});
set_error_handler(static function (int $no, string $msg, string $file, int $line): bool {
    if ($no === E_DEPRECATED || $no === E_USER_DEPRECATED) {
        return true;                        // a notice about a later PHP is not a fault
    }
    if (!(error_reporting() & $no)) {
        return false;                       // silenced with @: the code checks the result itself
    }
    throw new ErrorException($msg, 0, $no, $file, $line);
});

foreach (['sqlite3' => 'SQLite3', 'bz2' => 'bzopen', 'intl' => 'Normalizer', 'mbstring' => 'mb_strtoupper'] as $ext => $what) {
    if (!extension_loaded($ext)) {
        fail('this PHP was started without its ' . $ext . ' extension, which the Games Database reader needs');
    }
}

require __DIR__ . '/gamesdb-shared.php';

$cmd  = (string) ($argv[1] ?? '');
$args = array_slice($argv, 2);

/** A number the way JSON.stringify writes it: 4, not 4.0. */
function num($v)
{
    return is_float($v) && is_finite($v) && floor($v) === $v && abs($v) < 9.0e15 ? (int) $v : $v;
}
/** Math.round(x * 10) / 10. */
function round1($v)
{
    return num(floor(((float) $v) * 10 + 0.5) / 10);
}
/** JavaScript's a || b. */
function either($v, $or)
{
    return xs_gdb_truthy($v) ? $v : $or;
}
/** JavaScript's Number(text): a number, or null where it would be NaN. */
function js_number($v)
{
    if (is_int($v) || is_float($v)) {
        return $v;
    }
    if (is_bool($v)) {
        return (int) $v;
    }
    if ($v === null) {
        return 0;
    }
    $t = js_trim(js_string($v));
    if ($t === '') {
        return 0;
    }
    return is_numeric($t) ? num($t + 0) : null;
}
/**
 * JavaScript's String(value), for whatever a JSON file can hold: a file
 * written by hand may put a list where a title should be, and a plain
 * (string) cast stops the whole run on it.
 */
function js_string($v): string
{
    if (is_string($v)) {
        return $v;
    }
    if ($v === null) {
        return 'null';
    }
    if (is_bool($v)) {
        return $v ? 'true' : 'false';
    }
    if (is_int($v)) {
        return (string) $v;
    }
    if (is_float($v)) {
        if ($v == 0) {
            return '0';
        }
        return is_finite($v) && floor($v) === $v && abs($v) < 1.0e21
            ? sprintf('%.0f', $v)
            : (string) preg_replace('/\.0(?=e)/', '', (string) json_encode($v));
    }
    if (is_array($v) && array_is_list($v)) {
        return implode(',', array_map(static fn ($x) => $x === null ? '' : js_string($x), $v));
    }
    return '[object Object]';
}
/** JavaScript's trim(). */
function js_trim(string $s): string
{
    return (string) preg_replace('/^[' . XS_GDB_WS . ']+|[' . XS_GDB_WS . ']+$/u', '', $s);
}

// The test server's own settings and copy when it is one (XSEGON_DATA). The
// sandbox's copy is a hard link to the real one, so every write here replaces
// it by rename and never writes into it.
$env = static function (string $name): string {
    $v = getenv($name);
    return is_string($v) ? $v : '';
};
$dataDir = $env('XSEGON_DATA') !== '' ? $env('XSEGON_DATA') : dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data';
$copy    =$env('XSEGON_GAMESDB_COPY') !== '' ? $env('XSEGON_GAMESDB_COPY') : $dataDir . DIRECTORY_SEPARATOR . 'gamesdb.sqlite';
// The packed copies: the one in the download,
// and a newer one fetched since (bin\gamesdb-update.php); and a note beside
// the unpacked copy of which one it is.
$shipped = $env('XSEGON_GAMESDB_DIR') !== '' ? $env('XSEGON_GAMESDB_DIR') : dirname(__DIR__) . DIRECTORY_SEPARATOR . 'gamesdb';
$fetched = $dataDir . DIRECTORY_SEPARATOR . 'gamesdb-update';
$from    = $copy . '.from';
// The half-written file carries this process's id, so two runs at once never
// interleave into one file that wins the rename looking whole.
$part = $copy . '.part' . getmypid();
// A run that died mid-write leaves its part: any over an hour old is swept,
// by age and not by pid, as the pid may be someone else's by now.
foreach (@scandir(dirname($copy)) ?: [] as $n) {
    $p = dirname($copy) . DIRECTORY_SEPARATOR . $n;
    if (str_starts_with($n, basename($copy) . '.part') && is_file($p) && time() - (int) @filemtime($p) > 3600) {
        @unlink($p);
    }
}

/* One at a time through the making of the copy: asks landing together would
   each unpack it, and the later ones fail to replace a file the first is
   reading. The lock is the system's own, so a run that died lets it go. */
$lock = @fopen($copy . '.lock', 'c');
if ($lock !== false) {
    flock($lock, LOCK_EX);
    clearstatcache();
}

/* The newest packed copy, unpacked again whenever a newer one arrives; a copy
   with no note beside it is replaced too. includes\gamesdb.php works out
   "due" the same way, to give it time. */
{
    $best = xs_gdb_best_source([$shipped, $fetched]);
    $have = is_file($copy);
    $note = is_file($from) ? (string) file_get_contents($from) : null;
    if ($best !== null && (!$have || $note !== $best['stamp'])) {
        try {
            xs_gdb_unpack($best, $part);
            if (!@rename($part, $copy)) {
                throw new RuntimeException('could not put the unpacked copy in place (' . (error_get_last()['message'] ?? 'unknown') . ')');
            }
            file_put_contents($from, $best['stamp']);
        } catch (Throwable $e) {
            @unlink($part);
            // A fetched copy that fails its checksum is thrown away, or every
            // lookup would try it again; the updater fetches it afresh.
            if ($e instanceof XsGdbBadSum && $best['dir'] === $fetched) {
                @unlink($best['file']);
                @unlink($fetched . DIRECTORY_SEPARATOR . XS_GDB_MANIFEST);
            }
            if (!$have) {
                fail('could not set up the Games Database: ' . $e->getMessage());
            }
        }
    }
}
if ($lock !== false) {
    flock($lock, LOCK_UN);
    fclose($lock);
}
clearstatcache();
if (!is_file($copy)) {
    fail('No Games Database yet: it comes with the Xsegon download, and is fetched when missing (needs the internet once).');
}

/* Opened and proven before anything answers, "prepare" included: a damaged
   copy still matches its note, so the check above misses it. It is thrown
   away with its note, and the next ask makes it afresh. */
$db = null;
try {
    $db = new SQLite3($copy, SQLITE3_OPEN_READONLY);
    $db->enableExceptions(true);
    /* Mapped into memory: a title search reads the whole Games table, and
       mapped it is about twice as fast. Nothing is written through it. */
    $db->exec('pragma mmap_size = 536870912');
    $db->querySingle('select DatabaseID from Games limit 1');
} catch (Throwable $e) {
    // Closed before it is thrown away: an open handle holds the file and the
    // delete is refused.
    try {
        if ($db !== null) {
            $db->close();
        }
    } catch (Throwable $e2) {
        // was never open
    }
    @unlink($copy);
    @unlink($from);
    clearstatcache();
    if (is_file($copy)) {
        fail('the Games Database copy here is damaged and something still holds it (' . (error_get_last()['message'] ?? 'in use')
            . '): close other copies of Xsegon and ask again');
    }
    fail('the Games Database copy here was damaged and has been thrown away; ask again and it is made afresh (' . $e->getMessage() . ')');
}

if ($cmd === 'prepare') {
    out(['ok' => true]);
}

/** Every row of a question, as name => value. */
function rows(SQLite3 $db, string $sql, array $params = []): array
{
    static $made = [];
    $st = $made[$sql] ?? ($made[$sql] = $db->prepare($sql));
    $st->reset();
    $st->clear();
    foreach ($params as $i => $v) {
        $st->bindValue($i + 1, $v);
    }
    $res = $st->execute();
    $out = [];
    while (($r = $res->fetchArray(SQLITE3_ASSOC)) !== false) {
        $out[] = $r;
    }
    $res->finalize();
    return $out;
}

const IMG = 'https://images.launchbox-app.com/';
// Region preference for "best": North American releases first.
const REGIONS = ['North America', 'United States', 'World', '', 'Europe', 'United Kingdom', 'Japan'];
function region_rank($r): int
{
    $i = array_search(either($r, ''), REGIONS, true);
    return $i === false ? count(REGIONS) : $i;
}

/** Every picture on record for one game, best first in each of Xsegon's slots. */
function image_slots(SQLite3 $db, $id): array
{
    // Only names api\gamesdb.php will accept: a GUID, with or without a
    // revision prefix. Records with typos are left out, not offered and refused.
    $all = array_values(array_filter(
        rows($db, 'select FileName, Type, Region from GameImages where DatabaseId = ?', [$id]),
        static fn ($r) => preg_match('/^(r\d{1,3}_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|gif|webp)$/i', (string) $r['FileName']) === 1));
    $slots = [];
    foreach (XS_GDB_TYPES as $slot => $types) {
        $list = [];
        foreach ($all as $r) {
            $at = array_search($r['Type'], $types, true);
            if ($at === false) {
                continue;
            }
            $list[] = ['file' => $r['FileName'], 'type' => $r['Type'], 'region' => either($r['Region'], ''),
                       'url' => IMG . $r['FileName'], 'rank' => $at * 100 + region_rank($r['Region'])];
        }
        usort($list, static fn ($a, $b) => $a['rank'] <=> $b['rank']);      // stable, as JavaScript's sort is
        $slots[$slot] = array_map(static function ($x) { unset($x['rank']); return $x; }, $list);
    }
    return ['slots' => $slots, 'total' => count($all)];
}

if ($cmd === 'images') {
    $id = js_number($args[0] ?? '');
    if (!xs_gdb_truthy($id)) {
        fail('images needs a database id');
    }
    out(['ok' => true, 'id' => $id] + image_slots($db, $id));
}

/** One game's details, or null when there is no such game. */
function game_info(SQLite3 $db, $id): ?array
{
    $g = rows($db, 'select * from Games where DatabaseID = ?', [$id])[0] ?? null;
    if ($g === null) {
        return null;
    }
    return [
        'id' => $g['DatabaseID'], 'title' => $g['Name'], 'platform' => $g['Platform'],
        'released' => xs_gdb_truthy($g['ReleaseDate']) ? mb_substr((string) $g['ReleaseDate'], 0, 10)
                    : (xs_gdb_truthy($g['ReleaseYear']) ? (string) $g['ReleaseYear'] : ''),
        'developer' => either($g['Developer'], ''), 'publisher' => either($g['Publisher'], ''), 'genre' => either($g['Genres'], ''),
        'rating' => $g['CommunityRating'] !== null ? round1($g['CommunityRating']) : null,
        'ratingCount' => either($g['CommunityRatingCount'], 0), 'players' => either($g['MaxPlayers'], null), 'esrb' => either($g['ESRB'], ''),
        'notes' => either($g['Overview'], ''), 'wikipedia' => either($g['WikipediaURL'], ''), 'video' => either($g['VideoURL'], ''),
    ];
}

if ($cmd === 'game') {
    $id = js_number($args[0] ?? '');
    if (!xs_gdb_truthy($id)) {
        fail('game needs a database id');
    }
    $game = game_info($db, $id);
    if ($game === null) {
        fail('no game with database id ' . $id);
    }
    out(['ok' => true, 'game' => $game]);
}

// The search key is LaunchBox's CompareName rules (bin\gamesdb-shared.php).
// The same key with the gaps closed, for saying whether two titles are the
// same title: the column and the key can still disagree about one odd mark.
// And with the accents taken off, because the column sometimes has them and
// sometimes not, and a LIKE cannot be told to shrug.
function flat(string $s): string
{
    return str_replace(' ', '', xs_gdb_compare_key($s));
}
function ascii(string $s): string
{
    $d = Normalizer::normalize($s, Normalizer::FORM_D);
    return (string) preg_replace('/[\x{0300}-\x{036F}]/u', '', is_string($d) ? $d : $s);
}
function year_of(array $r)
{
    return xs_gdb_truthy($r['ReleaseDate']) ? mb_substr((string) $r['ReleaseDate'], 0, 4) : either($r['ReleaseYear'], '');
}

/** Every game whose name or alternate name has all the title's words in it, in order. */
function candidates(SQLite3 $db, string $title): array
{
    $k = xs_gdb_compare_key($title);
    if ($k === '') {
        return [];
    }
    $pattern = '%' . str_replace(' ', '%', $k) . '%';
    $pat2 = ascii($pattern);
    return rows($db,
        'select DatabaseID, Name, Platform, ReleaseDate, ReleaseYear, CommunityRatingCount from Games where CompareName like ? or CompareName like ? '
        . 'union select g.DatabaseID, g.Name, g.Platform, g.ReleaseDate, g.ReleaseYear, g.CommunityRatingCount from Games g join GameAlternateTitles a on a.DatabaseID = g.DatabaseID '
        . 'where a.AltNameCompareValue like ? or a.AltNameCompareValue like ? limit 600',
        [$pattern, $pat2, $pattern, $pat2]);
}

function alt_keys(SQLite3 $db, $id): array
{
    return array_map(static fn ($a) => flat((string) either($a['AlternateName'], '')),
        rows($db, 'select AlternateName from GameAlternateTitles where DatabaseID = ?', [$id]));
}

/** The candidates in order: same platform first; exact name, then a name
    that starts with it, then one that merely contains it; the better-known
    game among equals. Alternate titles count as the game's own. */
function ranked(SQLite3 $db, string $platform, string $title): array
{
    // Names in dictionary order (ICU's, which is also what JavaScript's
    // localeCompare gave). The locale is named rather than taken from the
    // PC, so the same question gets the same order everywhere.
    static $order = null;
    $order ??= new Collator('en_US');
    $k = flat($title);
    $scored = [];
    foreach (candidates($db, $title) as $r) {
        $nk = flat((string) $r['Name']);
        $alts = alt_keys($db, $r['DatabaseID']);
        $starts = false;
        foreach ($alts as $a) {
            if (str_starts_with($a, $k)) {
                $starts = true;
                break;
            }
        }
        $how = ($nk === $k || in_array($k, $alts, true)) ? 0
             : ((str_starts_with($nk, $k) || str_starts_with($k, $nk) || $starts) ? 1 : 2);
        $scored[] = ['id' => $r['DatabaseID'], 'title' => $r['Name'], 'platform' => $r['Platform'], 'year' => year_of($r),
                     'how' => $how, 'same' => $r['Platform'] === $platform, 'known' => either($r['CommunityRatingCount'], 0),
                     'score' => $how * 10 + ($r['Platform'] === $platform ? 0 : 5)];
    }
    usort($scored, static function ($a, $b) use ($order) {
        return ($a['score'] <=> $b['score']) ?: ($b['known'] <=> $a['known']) ?: (int) $order->compare((string) $a['title'], (string) $b['title']);
    });
    $seen = [];
    $out = [];
    foreach ($scored as $r) {
        if (!isset($seen[$r['id']])) {
            $seen[$r['id']] = true;
            $out[] = $r;
        }
    }
    return $out;
}

/** A candidate as it is answered: without the working that ordered it. */
function strip_row(array $r): array
{
    unset($r['how'], $r['same'], $r['known'], $r['score']);
    return $r;
}

/* One answer for one game, and how sure it is. The pass over scanned games
   fills "sure" and a "likely" with sameName by itself, and leaves the rest for a person:
     sure    the same name on the same console, and only one of them
     likely  several games of the same name on that console (sameName true),
             or one game there whose name starts with this one, or the other
             way round (sameName false; file names drop subtitles: "Star Ocean"
             for "Star Ocean: The Second Story")
     maybe   the same name on another console (a port, with another box),
             or several games this could be, best first
     none    nothing with these words in the whole database */
/* Region and edition words some file names end in with no brackets
   ("Great_Greed_USA"): with them on, no game has all the title's words.
   Taken off only when the whole title found nothing, so a game that really
   ends in one is found by its own name first. */
const TAIL_WORDS = '/(?:[' . XS_GDB_WS . '_]+(?:USA|Europe|Japan|World|Australia|Asia|Korea|China|Brazil|Canada|France|Germany|Spain|Italy|UK|En|Fr|De|Es|It|Ja|SGB|CGB|GBC|CGBSGB|Enhanced|Unl|Proto|Beta|Rev[' . XS_GDB_WS . '_]?[A-Z0-9]+|v\d+(?:\.\d+)*))+$/u';
function match_one(SQLite3 $db, string $platform, string $title): array
{
    $list = ranked($db, $platform, $title);
    if (!$list) {
        $bare = js_trim((string) preg_replace(TAIL_WORDS, '', $title));
        if ($bare !== '' && $bare !== $title) {
            $list = ranked($db, $platform, $bare);
        }
    }
    $exactHere = array_values(array_filter($list, static fn ($r) => $r['how'] === 0 && $r['same']));
    $nearHere  = array_values(array_filter($list, static fn ($r) => $r['how'] === 1 && $r['same']));
    $best = null;
    $confidence = 'none';
    if (count($exactHere) === 1) {
        $best = $exactHere[0];
        $confidence = 'sure';
    } elseif (count($exactHere) > 1) {
        $best = $exactHere[0];
        $confidence = 'likely';
    } elseif (count($nearHere) === 1) {
        $best = $nearHere[0];
        $confidence = 'likely';
    } elseif ($list) {
        $best = $list[0];
        $confidence = 'maybe';
    }
    $answer = ['best' => $best !== null ? strip_row($best) : null, 'confidence' => $confidence,
               'candidates' => array_map('strip_row', array_slice($list, 0, 8))];
    // Only on "likely", so every other answer reads as it always has.
    if ($confidence === 'likely') {
        $answer['sameName'] = count($exactHere) > 1;
    }
    return $answer;
}

// The wanted list (Games > Games you do not have): every console with its
// count, and one console's games marked "have" by database number, name or
// alternate name. The games you have come in a file: a big console's titles
// do not fit a command line.
if ($cmd === 'platforms') {
    out(['ok' => true, 'platforms' => rows($db,
        'select Platform as name, count(*) as games from Games where Platform is not null and Platform <> ? group by Platform order by Platform collate nocase', [''])]);
}

if ($cmd === 'list') {
    $platform = (string) ($args[0] ?? '');
    if ($platform === '') {
        fail('list needs a console');
    }
    $have = [];
    if (($args[1] ?? '') !== '') {
        $text = @file_get_contents($args[1]);
        $have = is_string($text) ? json_decode($text, true) : null;
        if (!is_array($have)) {
            fail('could not read the list of games you have: ' . (is_string($text) ? json_last_error_msg() : (error_get_last()['message'] ?? 'not there')));
        }
    }
    $mine = [];
    foreach ((array) either($have['titles'] ?? null, []) as $t) {
        $k = flat(js_string($t));
        if ($k !== '') {
            $mine[$k] = true;
        }
    }
    $ids = [];
    foreach ((array) either($have['dbIds'] ?? null, []) as $x) {
        $n = js_number($x);
        if ($n !== null) {
            $ids[(string) $n] = true;
        }
    }
    $alts = [];
    foreach (rows($db, 'select a.DatabaseID as id, a.AlternateName as n from GameAlternateTitles a join Games g on g.DatabaseID = a.DatabaseID where g.Platform = ?', [$platform]) as $a) {
        $alts[$a['id']][] = flat((string) either($a['n'], ''));
    }
    $games = [];
    foreach (rows($db, 'select DatabaseID, Name, ReleaseDate, ReleaseYear, CommunityRating, CommunityRatingCount, Genres, Developer, Publisher, MaxPlayers, ReleaseType from Games where Platform = ? order by Name collate nocase', [$platform]) as $r) {
        $mineToo = false;
        foreach ($alts[$r['DatabaseID']] ?? [] as $k) {
            if ($k !== '' && isset($mine[$k])) {
                $mineToo = true;
                break;
            }
        }
        $games[] = [
            'id' => $r['DatabaseID'], 'title' => js_trim((string) either($r['Name'], '')), 'year' => (string) either(year_of($r), ''),
            'rating' => xs_gdb_truthy($r['CommunityRating']) ? round1($r['CommunityRating']) : 0, 'votes' => either($r['CommunityRatingCount'], 0),
            'genres' => either($r['Genres'], ''), 'developer' => either($r['Developer'], ''), 'publisher' => either($r['Publisher'], ''),
            'players' => either($r['MaxPlayers'], 0), 'type' => either($r['ReleaseType'], ''),
            'have' => isset($ids[(string) $r['DatabaseID']]) || isset($mine[flat((string) $r['Name'])]) || $mineToo,
        ];
    }
    out(['ok' => true, 'platform' => $platform, 'games' => $games]);
}

if ($cmd === 'search') {
    $platform = (string) ($args[0] ?? '');
    $title = js_trim((string) ($args[1] ?? ''));
    if ($title === '') {
        fail('search needs a title');
    }
    out(['ok' => true, 'results' => array_map('strip_row', array_slice(ranked($db, $platform, $title), 0, 25))]);
}

if ($cmd === 'match') {
    $platform = (string) ($args[0] ?? '');
    $title = js_trim((string) ($args[1] ?? ''));
    if ($title === '') {
        fail('match needs a title');
    }
    out(['ok' => true] + match_one($db, $platform, $title));
}

// Many at once, from a file of [{id, platform, title}], so a pass over thirty
// scanned games is one process rather than thirty.
if ($cmd === 'matchmany') {
    $text = @file_get_contents((string) ($args[0] ?? ''));
    // Objects stay objects here, so a list and an {id, ...} are told apart
    // the way JavaScript tells them, an empty one included.
    $asks = is_string($text) ? json_decode($text) : null;
    if ($asks === null && (!is_string($text) || trim($text) !== 'null')) {
        fail('matchmany needs a JSON file of {id, platform, title}');
    }
    if (!is_array($asks)) {
        fail('matchmany needs a list');
    }
    $results = [];
    foreach ($asks as $a) {
        // Anything that is not an ask with an id is passed over, as
        // "if (!a || !a.id) continue" passes it over: text, a number, a list.
        if (!($a instanceof stdClass) || !xs_gdb_truthy($a->id ?? null)) {
            continue;
        }
        $id = js_string($a->id);
        if ($id === '__proto__') {
            continue;                    // JavaScript sets no name of an object by this one
        }
        $results[$id] = match_one($db, js_string(either($a->platform ?? null, '')), js_string(either($a->title ?? null, '')));
    }
    // JavaScript lists an object's whole-number names first, in order, then
    // the rest as they came; nothing reads the order, and it is kept anyway.
    $whole = array_filter($results, static fn ($k) => is_int($k) && $k >= 0 && $k < 4294967295, ARRAY_FILTER_USE_KEY);
    ksort($whole);
    out(['ok' => true, 'results' => (object) ($whole + $results)]);
}

/* One game's whole answer in one process, for the Steam import: the best
   match and, when sure or likely on that platform, its details and pictures.
   Three processes a game were most of the time a row took. */
if ($cmd === 'fill') {
    $platform = (string) ($args[0] ?? '');
    $title = js_trim((string) ($args[1] ?? ''));
    if ($title === '') {
        fail('fill needs a title');
    }
    $m = match_one($db, $platform, $title);
    $good = $m['best'] !== null && ($m['confidence'] === 'sure' || $m['confidence'] === 'likely') && $m['best']['platform'] === $platform;
    out(['ok' => true] + $m + ['game' => $good ? game_info($db, $m['best']['id']) : null,
                               'slots' => $good ? image_slots($db, $m['best']['id'])['slots'] : null]);
}

fail('unknown command');
