<?php
/**
 * Xsegon - what the Games Database reader (bin\gamesdb.php), its updater
 * (bin\gamesdb-update.php) and its builder (tools\build-gamesdb.php) must
 * agree on: the picture types Xsegon uses, the search key, and the packed
 * copy of the database that Xsegon ships and keeps up to date.
 *
 * The packed copy is gamesdb.sqlite.bz2: LaunchBox's tables (below) without
 * their indexes. Beside it gamesdb.json says what it is:
 *     {"built": "<ISO time>", "size": <bytes of the .bz2>,
 *      "sha256": "<of the .bz2>", "games": <count>}
 * It is not kept in git, where every refresh would add the whole file to the
 * history. The download carries one in gamesdb\, and a GitHub release (tag
 * "gamesdb") holds the newest, fetched into data\gamesdb-update\ by
 * bin\gamesdb-update.php. Whichever was built last is used.
 *
 * bzip2, because PHP unpacks it with nothing else: PHP cannot open Brotli,
 * and 7-Zip's extractor is a second program.
 *
 * The server and the page expect the answers of the earlier JavaScript reader
 * to the letter, so some helpers in bin\gamesdb.php keep JavaScript's rules
 * and are named for them (js_number, js_string, js_trim, either).
 */
declare(strict_types=1);

// Which of the database's picture types feed which Xsegon slot, best first.
// The packed copy keeps only these types, so a type added here needs a rebuild of it.
const XS_GDB_TYPES = [
    'box'    => ['Box - Front', 'Box - Front - Reconstructed', 'Fanart - Box - Front', 'Box - 3D', 'Cart - Front', 'Cart - 3D'],
    'box3d'  => ['Box - 3D', 'Cart - 3D'],
    'logo'   => ['Clear Logo'],
    'shot'   => ['Screenshot - Gameplay', 'Screenshot - Game Title', 'Screenshot - Game Select'],
    'fanart' => ['Fanart - Background', 'Banner'],
];

const XS_GDB_PACKED   = 'gamesdb.sqlite.bz2';
const XS_GDB_MANIFEST = 'gamesdb.json';

// The tables, as LaunchBox's own file has them, less the columns nothing here
// reads; and the indexes, left out of the packed copy to keep it small and
// built when it is unpacked.
const XS_GDB_SCHEMA = '
  CREATE TABLE Games (DatabaseID INTEGER NOT NULL PRIMARY KEY, Name TEXT NOT NULL, CompareName TEXT NOT NULL,
    ReleaseDate TEXT NULL, ReleaseYear INTEGER NULL, Overview TEXT NULL, MaxPlayers INTEGER NULL,
    ReleaseType TEXT NULL, Cooperative INTEGER NOT NULL, VideoURL TEXT NULL, CommunityRating REAL NULL,
    WikipediaURL TEXT NULL, Platform TEXT NOT NULL, ESRB TEXT NULL, CommunityRatingCount INTEGER NOT NULL,
    Genres TEXT NOT NULL, Developer TEXT NULL, Publisher TEXT NULL);
  CREATE TABLE GameAlternateTitles (AlternateName TEXT NOT NULL, DatabaseID INTEGER NOT NULL,
    Region TEXT NOT NULL, AltNameCompareValue TEXT NOT NULL);
  CREATE TABLE GameImages (FileName TEXT NOT NULL, DatabaseId INTEGER NOT NULL, Type TEXT NOT NULL, Region TEXT NULL);
';
const XS_GDB_INDEXES = '
  CREATE INDEX IF NOT EXISTS IX_Games_Platform_Name ON Games (Platform, Name);
  CREATE INDEX IF NOT EXISTS IX_GameAlternateTitles_DatabaseID ON GameAlternateTitles (DatabaseID);
  CREATE INDEX IF NOT EXISTS IX_GameImages_DatabaseId_Type ON GameImages (DatabaseId, Type);
';

/* What JavaScript calls white space (\s, and what trim() takes off), written
   out: PHP's own \s differs by two characters, and the search key must match. */
const XS_GDB_WS = '\t\n\x0B\f\r \x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}';

/** Where the newest one is published. XSEGON_GAMESDB_URL: the test's stand-in. */
function xs_gdb_release_url(): string
{
    $test = getenv('XSEGON_GAMESDB_URL');
    return is_string($test) && $test !== '' ? $test
         : 'https://github.com/TumultuousProductions/Xsegon/releases/download/gamesdb/';
}

/** JavaScript's truthiness, for the values a database row or a JSON file holds. */
function xs_gdb_truthy($v): bool
{
    return !($v === null || $v === false || $v === '' || $v === 0 || $v === 0.0);
}

/** Now, as YYYY-MM-DDTHH:MM:SS.mmmZ: the manifest and checked.json are read by the page. */
function xs_gdb_iso_now(): string
{
    $t = microtime(true);
    return gmdate('Y-m-d\TH:i:s', (int) $t) . sprintf('.%03dZ', (int) (($t - floor($t)) * 1000));
}

/** A folder's packed copy and what it says it is, or null. The stamp is the
    note written beside the unpacked copy, saying which packed copy it came
    from; includes\gamesdb.php makes the same words (xs_gamesdb_packed_stamp). */
function xs_gdb_read_source(string $dir): ?array
{
    $m = json_decode((string) @file_get_contents($dir . DIRECTORY_SEPARATOR . XS_GDB_MANIFEST), true);
    $file = $dir . DIRECTORY_SEPARATOR . XS_GDB_PACKED;
    if (!is_array($m) || empty($m['built']) || empty($m['sha256']) || !is_file($file)) {
        return null;
    }
    return ['dir' => $dir, 'file' => $file, 'manifest' => $m,
            'stamp' => 'bz2 ' . $m['built'] . ' ' . substr((string) $m['sha256'], 0, 16)];
}

/** The newest of the folders' packed copies, or null when none has one. */
function xs_gdb_best_source(array $dirs): ?array
{
    $best = null;
    foreach ($dirs as $d) {
        $s = xs_gdb_read_source($d);
        if ($s !== null && ($best === null || strcmp((string) $s['manifest']['built'], (string) $best['manifest']['built']) > 0)) {
            $best = $s;
        }
    }
    return $best;
}

/** A packed copy that is not the file its manifest describes. */
final class XsGdbBadSum extends RuntimeException
{
}

/**
 * Unpack a packed copy into $dbFile, with its indexes. The caller unpacks
 * into a .part and renames, so nobody reads half a file. A megabyte at a
 * time, as the whole is hundreds of MB.
 */
function xs_gdb_unpack(array $source, string $dbFile): void
{
    // The checksum names the copy (the stamp quotes it), so a file its manifest
    // does not describe is never unpacked.
    if (hash_file('sha256', $source['file']) !== (string) $source['manifest']['sha256']) {
        throw new XsGdbBadSum('the packed Games Database in ' . $source['dir'] . ' does not match its checksum');
    }
    $in = bzopen($source['file'], 'r');
    $out = $in === false ? false : fopen($dbFile, 'wb');
    if ($in === false || $out === false) {
        throw new RuntimeException('could not open ' . ($in === false ? $source['file'] : $dbFile));
    }
    try {
        while (!feof($in)) {
            $bytes = bzread($in, 1 << 20);
            if ($bytes === false || bzerrno($in) !== 0) {
                throw new RuntimeException('the packed Games Database would not unpack: ' . bzerrstr($in));
            }
            if ($bytes !== '' && fwrite($out, $bytes) !== strlen($bytes)) {
                throw new RuntimeException('could not write ' . $dbFile . ' (is the disk full?)');
            }
        }
    } finally {
        bzclose($in);
        fclose($out);
    }
    $db = new SQLite3($dbFile);
    $db->enableExceptions(true);
    $db->exec(XS_GDB_INDEXES);
    $db->close();
}

/**
 * Pack a built database file into $outDir (the builder), and say what it is:
 * the packed file first, under a .part name until it is whole, the manifest
 * last.
 */
function xs_gdb_pack(string $dbFile, string $outDir, int $games): array
{
    if (!is_dir($outDir) && !mkdir($outDir, 0777, true)) {
        throw new RuntimeException('could not make ' . $outDir);
    }
    $packed = $outDir . DIRECTORY_SEPARATOR . XS_GDB_PACKED;
    $in = fopen($dbFile, 'rb');
    $out = $in === false ? false : bzopen($packed . '.part', 'w');
    if ($in === false || $out === false) {
        throw new RuntimeException('could not open ' . ($in === false ? $dbFile : $packed . '.part'));
    }
    try {
        while (!feof($in)) {
            $bytes = fread($in, 1 << 20);
            if ($bytes === false || ($bytes !== '' && bzwrite($out, $bytes) !== strlen($bytes))) {
                throw new RuntimeException('could not pack ' . $dbFile);
            }
        }
    } finally {
        fclose($in);
        bzclose($out);
    }
    if (!rename($packed . '.part', $packed)) {
        throw new RuntimeException('could not put ' . $packed . ' in place');
    }
    clearstatcache();
    $manifest = ['built' => xs_gdb_iso_now(), 'size' => filesize($packed), 'sha256' => hash_file('sha256', $packed), 'games' => $games];
    file_put_contents($outDir . DIRECTORY_SEPARATOR . XS_GDB_MANIFEST, json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
    return $manifest;
}

/**
 * LaunchBox's CompareName, rebuilt: the column is not the title upper-cased
 * ("Final Fantasy VII" is FINAL FANTASY 7), so a search must build the same key.
 *
 * Each rule was counted against the column, not guessed: a note in brackets
 * goes; upper case; apostrophes and full stops vanish (HAWKS, STALKER); every
 * other mark but ° and % is a gap; II to VIII become digits but IX and above
 * stay roman; THE, A, AN and AND are dropped wherever they stand.
 */
function xs_gdb_compare_key(string $s): string
{
    static $roman = ['II' => '2', 'III' => '3', 'IV' => '4', 'V' => '5', 'VI' => '6', 'VII' => '7', 'VIII' => '8'];
    $s = (string) preg_replace('/[' . XS_GDB_WS . ']*\([^()]*\)/u', '', $s);
    $s = mb_strtoupper($s, 'UTF-8');
    $s = (string) preg_replace('/[\'\x{2019}.]/u', '', $s);
    $s = (string) preg_replace('/[^\p{L}\p{N}\x{00B0}%]+/u', ' ', $s);
    $words = [];
    foreach (explode(' ', $s) as $w) {
        if ($w === '') {
            continue;
        }
        $w = $roman[$w] ?? $w;
        if ($w !== 'THE' && $w !== 'A' && $w !== 'AN' && $w !== 'AND') {
            $words[] = $w;
        }
    }
    return implode(' ', $words);
}
