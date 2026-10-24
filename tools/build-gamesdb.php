<?php
/**
 * Xsegon - build the packed Games Database from LaunchBox's public download,
 * and publish it.
 *
 *   php tools\build-gamesdb.php                   download Metadata.zip and build
 *   php tools\build-gamesdb.php <Metadata.zip>    build from one already here
 *   php tools\build-gamesdb.php <Metadata.xml>    the same, already unzipped
 *   ... --publish                                 and replace the one on GitHub
 *   php tools\build-gamesdb.php --publish-only    sign and publish the one built already
 *
 * "php" is the PHP Xsegon runs on; give its whole path where it is not on the PATH.
 *
 * LaunchBox publishes its Games Database as Metadata.zip, rebuilt daily; this
 * packs it into gamesdb\gamesdb.sqlite.bz2 and gamesdb.json (see
 * bin\gamesdb-shared.php), and signs gamesdb.json into gamesdb.sig with the
 * update key (private\update-key.pem), which copies check before they take it.
 * --publish replaces the files on the "gamesdb" release of Xsegon-helper-files
 * (gh logged in), and every Xsegon fetches it within a day. The built files
 * are git-ignored. Credit to LaunchBox is in gamesdb\README.md.
 *
 * The same tables and column names as LaunchBox's, so bin\gamesdb.php cannot
 * tell them apart; left out are the indexes (built on unpack), picture types
 * Xsegon never shows and columns nothing reads. CompareName is made here with
 * the reader's own rules.
 *
 * Needs sqlite3, bz2 and mbstring (it restarts itself with them when php.ini
 * leaves them off), Windows' own tar, and for --publish GitHub's gh.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
error_reporting(E_ALL);
ini_set('display_errors', 'stderr');
ini_set('memory_limit', '-1');
ini_set('pcre.backtrack_limit', '100000000');     // a game's description can run to many thousand letters
set_time_limit(0);

function say(string $m): void
{
    fwrite(STDOUT, $m . "\n");
}

/* The extensions php.ini leaves off, loaded for this one run: the same PHP
   started again with them named on its command line, as includes\gamesdb.php
   starts the reader. */
$lacking = array_values(array_filter(['sqlite3', 'bz2', 'mbstring', 'openssl'], static fn ($e) => !extension_loaded($e)));
if ($lacking) {
    if (getenv('XSEGON_BUILD_AGAIN') === '1') {
        say('FAILED: this PHP has no ' . implode(', ', $lacking) . ' extension to load');
        exit(1);
    }
    $extDir = (string) ini_get('extension_dir');
    if ($extDir === '' || !preg_match('#^([A-Za-z]:|[\\\\/])#', $extDir)) {
        $extDir = dirname(PHP_BINARY) . DIRECTORY_SEPARATOR . ($extDir !== '' ? $extDir : 'ext');
    }
    $again = [PHP_BINARY, '-d', 'extension_dir=' . $extDir];
    foreach ($lacking as $e) {
        $again[] = '-d';
        $again[] = 'extension=' . $e;
    }
    putenv('XSEGON_BUILD_AGAIN=1');
    $p = proc_open(array_merge($again, $argv), [0 => STDIN, 1 => STDOUT, 2 => STDERR], $pipes, null, null, ['bypass_shell' => true]);
    exit(is_resource($p) ? proc_close($p) : 1);
}

require __DIR__ . '/../bin/gamesdb-shared.php';

const URL_ZIP = 'https://gamesdb.launchbox-app.com/Metadata.zip';
const REPO = 'TumultuousProductions/Xsegon-helper-files';
const TAG = 'gamesdb';

// XSEGON_GAMESDB_OUT: the test (tests\t-gamesdb.js) builds a small one elsewhere,
// signed only with XSEGON_GAMESDB_SIGN_KEY: a test's database never carries the real key's signature.
$outEnv  = getenv('XSEGON_GAMESDB_OUT');
$outDir  = is_string($outEnv) && $outEnv !== '' ? $outEnv : dirname(__DIR__) . DIRECTORY_SEPARATOR . 'gamesdb';
$keyEnv  = getenv('XSEGON_GAMESDB_SIGN_KEY');
$keyFile = is_string($keyEnv) && $keyEnv !== '' ? $keyEnv
         : (is_string($outEnv) && $outEnv !== '' ? '' : dirname(__DIR__) . DIRECTORY_SEPARATOR . 'private' . DIRECTORY_SEPARATOR . 'update-key.pem');
$publishOnly = in_array('--publish-only', $argv, true);
$publish = $publishOnly || in_array('--publish', $argv, true);
$given   = array_values(array_filter(array_slice($argv, 1), static fn ($a) => !str_starts_with($a, '--publish')))[0] ?? null;
$keep    = array_fill_keys(array_merge(...array_values(XS_GDB_TYPES)), true);

$work = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'xs-gamesdb-' . bin2hex(random_bytes(4));
if (!mkdir($work, 0777, true)) {
    say('FAILED: could not make ' . $work);
    exit(1);
}
function tidy(string $dir): void
{
    foreach (@scandir($dir) ?: [] as $n) {
        if ($n !== '.' && $n !== '..') {
            @unlink($dir . DIRECTORY_SEPARATOR . $n);
        }
    }
    @rmdir($dir);
}

/** Run a program with its words as they are (no shell), and say how it ended. */
function run(array $cmd, ?string &$said = null): int
{
    $p = proc_open($cmd, [0 => ['file', 'NUL', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, null, ['bypass_shell' => true]);
    if (!is_resource($p)) {
        $said = 'could not be started';
        return -1;
    }
    $said = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    return proc_close($p);
}

/** The Metadata.xml to read: the one given, or out of the zip given or downloaded. */
function source(?string $given, string $work): string
{
    $zip = $given;
    if ($zip !== null && preg_match('/\.xml$/i', $zip)) {
        return $zip;
    }
    if ($zip === null) {
        $zip = $work . DIRECTORY_SEPARATOR . 'Metadata.zip';
        say('downloading ' . URL_ZIP);
        // The certificates that come with this PHP, when php.ini names none
        // (start.ps1 hands them to the server the same way).
        $ssl = ['verify_peer' => true, 'verify_peer_name' => true];
        $pem = dirname(PHP_BINARY) . DIRECTORY_SEPARATOR . 'cacert.pem';
        if ((string) ini_get('openssl.cafile') === '' && is_file($pem)) {
            $ssl['cafile'] = $pem;
        }
        $in = @fopen(URL_ZIP, 'rb', false, stream_context_create(['http' => ['timeout' => 120, 'user_agent' => 'Xsegon', 'follow_location' => 1], 'ssl' => $ssl]));
        if ($in === false) {
            throw new RuntimeException('download failed: ' . preg_replace('/^fopen\([^)]*\): /', '', (string) (error_get_last()['message'] ?? 'no answer')));
        }
        $out = fopen($zip, 'wb');
        $bytes = stream_copy_to_stream($in, $out);
        fclose($in);
        fclose($out);
        if (!$bytes) {
            throw new RuntimeException('download failed: nothing arrived');
        }
    }
    say('unzipping Metadata.xml');
    // Windows' own tar by its whole path: a shell with another tar first on
    // its PATH (Git's) would be handed a zip it cannot read.
    $tar = (getenv('SystemRoot') ?: 'C:\\Windows') . '\\System32\\tar.exe';
    if (run([$tar, '-xf', $zip, '-C', $work, 'Metadata.xml'], $said) !== 0) {
        throw new RuntimeException('could not unzip ' . $zip . ': ' . trim((string) $said));
    }
    return $work . DIRECTORY_SEPARATOR . 'Metadata.xml';
}

const ENT = ['amp' => '&', 'lt' => '<', 'gt' => '>', 'quot' => '"', 'apos' => "'"];
/** The XML's escapes undone: the five named ones and the numbered ones; any other is left as written. */
function unxml(string $s): string
{
    if (!str_contains($s, '&')) {
        return $s;
    }
    return (string) preg_replace_callback('/&(#x[0-9a-f]+|#\d+|\w+);/i', static function (array $m): string {
        $e = $m[1];
        if ($e[0] !== '#') {
            return ENT[$e] ?? $m[0];
        }
        $cp = ($e[1] === 'x' || $e[1] === 'X') ? hexdec(substr($e, 2)) : (int) substr($e, 1);
        $ch = is_int($cp) ? mb_chr($cp, 'UTF-8') : false;
        return $ch === false ? "\u{FFFD}" : $ch;
    }, $s);
}

/** The child elements of one record, as [Name => text]. Empty ones (<Genres />) are "". */
function fields(string $body): array
{
    $f = [];
    // A record the pattern gives up on (a description too long for its
    // limits) stops the build: skipping it would lose a game and say nothing.
    if (preg_match_all('/<(\w+)>(.*?)<\/\1>|<(\w+)\s*\/>/s', $body, $all, PREG_SET_ORDER) === false) {
        throw new RuntimeException('a record could not be read (' . preg_last_error_msg() . '): ' . substr($body, 0, 120));
    }
    foreach ($all as $m) {
        if (($m[3] ?? '') !== '') {
            $f[$m[3]] = '';
        } else {
            $f[$m[1]] = unxml($m[2]);
        }
    }
    return $f;
}

/**
 * Each top-level record in the file, in order, read a piece at a time: the
 * file is half a gigabyte. A record is found by its opening tag and then its
 * closing one; one whose end has not been read yet waits for the next piece.
 */
function records(string $file): Generator
{
    $in = fopen($file, 'rb');
    if ($in === false) {
        throw new RuntimeException('could not open ' . $file);
    }
    $buf = '';
    while (!feof($in)) {
        $chunk = fread($in, 1 << 22);
        if ($chunk === false) {
            throw new RuntimeException('could not read ' . $file);
        }
        $buf .= $chunk;
        $at = 0;
        $keepFrom = null;
        while (preg_match('/<(Game|GameAlternateName|GameImage)>/', $buf, $m, PREG_OFFSET_CAPTURE, $at) === 1) {
            $kind = $m[1][0];
            $bodyAt = $m[0][1] + strlen($m[0][0]);
            $close = strpos($buf, '</' . $kind . '>', $bodyAt);
            if ($close === false) {
                $keepFrom = $m[0][1];
                break;
            }
            yield [$kind, substr($buf, $bodyAt, $close - $bodyAt)];
            $at = $close + strlen($kind) + 3;
        }
        // What is kept for the next piece: a record still open, or the last
        // few letters, which may be the start of an opening tag.
        $buf = substr($buf, $keepFrom ?? max($at, strlen($buf) - 32));
    }
    fclose($in);
}

/** A number, or null for none: "" and anything that is not a number. */
function num(?string $s)
{
    if ($s === null || $s === '') {
        return null;
    }
    $t = (string) preg_replace('/^[' . XS_GDB_WS . ']+|[' . XS_GDB_WS . ']+$/u', '', $s);
    if ($t === '') {
        return 0;
    }
    return is_numeric($t) ? $t + 0 : null;
}
/** Text, or null for none. */
function text(array $f, string $k): ?string
{
    return ($f[$k] ?? '') === '' ? null : $f[$k];
}
function has(array $f, string $k): bool
{
    return ($f[$k] ?? '') !== '';
}

/** Run gh, and say whether it ended well. */
function gh(string ...$a): bool
{
    return run(array_merge(['gh'], $a), $said) === 0;
}

/** gamesdb.json signed into gamesdb.sig with the key at $keyFile; false, with no .sig left, when there is no key. */
function sign_it(string $outDir, string $keyFile): bool
{
    $sigFile = $outDir . DIRECTORY_SEPARATOR . XS_GDB_SIG;
    @unlink($sigFile);
    $pem  = $keyFile !== '' ? @file_get_contents($keyFile) : false;
    $priv = is_string($pem) ? openssl_pkey_get_private($pem) : false;
    if ($priv === false) {
        say('not signed: no signing key' . ($keyFile !== '' ? ' at ' . $keyFile : ''));
        return false;
    }
    if (!openssl_sign((string) file_get_contents($outDir . DIRECTORY_SEPARATOR . XS_GDB_MANIFEST), $sig, $priv, OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('could not sign ' . XS_GDB_MANIFEST);
    }
    file_put_contents($sigFile, base64_encode($sig) . "\n");
    say('signed ' . XS_GDB_MANIFEST . ' into ' . XS_GDB_SIG);
    return true;
}

/**
 * Replace the published copy: the packed file first, then the manifest, then
 * its signature, so a new manifest always has its file behind it (a manifest
 * and a signature that do not match, read meanwhile, are refused and tried
 * again the next day).
 */
function publish_it(string $outDir): void
{
    if (!is_file($outDir . DIRECTORY_SEPARATOR . XS_GDB_SIG)) {
        throw new RuntimeException('not published: ' . XS_GDB_MANIFEST . ' is not signed, and copies take no unsigned one');
    }
    if (!gh('release', 'view', TAG, '-R', REPO)) {
        say('creating the ' . TAG . ' release on ' . REPO);
        if (!gh('release', 'create', TAG, '-R', REPO, '--title', 'Games Database',
            '--latest=false', '--notes', 'Not the Xsegon program, and nothing here is for you to download: Xsegon fetches it by itself. '
            . 'The LaunchBox Games Database, packed for Xsegon, built from '
            . "LaunchBox's public download (gamesdb.launchbox-app.com); all credit for the data to LaunchBox and its community. "
            . 'Replaced at each refresh; gamesdb.sig is gamesdb.json signed with the key Xsegon checks. '
            . 'To get Xsegon: https://github.com/TumultuousProductions/Xsegon/releases/latest')) {
            throw new RuntimeException('could not create the release (is gh installed and logged in?)');
        }
    }
    foreach ([XS_GDB_PACKED, XS_GDB_MANIFEST, XS_GDB_SIG] as $f) {
        say('uploading ' . $f);
        if (run(['gh', 'release', 'upload', TAG, $outDir . DIRECTORY_SEPARATOR . $f, '--clobber', '-R', REPO], $said) !== 0) {
            throw new RuntimeException('could not upload ' . $f . ': ' . trim((string) $said));
        }
    }
    say('published to https://github.com/' . REPO . '/releases/tag/' . TAG);
}

// --publish-only: the packed copy in $outDir as it is, signed and published, nothing built.
if ($publishOnly) {
    try {
        foreach ([XS_GDB_PACKED, XS_GDB_MANIFEST] as $f) {
            if (!is_file($outDir . DIRECTORY_SEPARATOR . $f)) {
                throw new RuntimeException('nothing built to publish: ' . $outDir . DIRECTORY_SEPARATOR . $f . ' is missing');
            }
        }
        sign_it($outDir, $keyFile);
        publish_it($outDir);
        exit(0);
    } catch (Throwable $e) {
        say('FAILED: ' . $e->getMessage());
        exit(1);
    }
}

try {
    $xml = source($given, $work);
    $dbFile = $work . DIRECTORY_SEPARATOR . 'gamesdb.sqlite';
    $db = new SQLite3($dbFile);
    $db->enableExceptions(true);
    $db->exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA page_size = 4096;' . XS_GDB_SCHEMA);
    $addGame = $db->prepare('insert or replace into Games values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    $addAlt  = $db->prepare('insert into GameAlternateTitles values (?,?,?,?)');
    $addImg  = $db->prepare('insert into GameImages values (?,?,?,?)');
    $add = static function (SQLite3Stmt $st, array $values): void {
        $st->reset();
        foreach ($values as $i => $v) {
            $st->bindValue($i + 1, $v);         // the kind of each is taken from the value: a number, text, or nothing
        }
        $st->execute();
    };
    $n = ['Game' => 0, 'GameAlternateName' => 0, 'GameImage' => 0, 'skipped' => 0];
    say('reading ' . $xml);
    $db->exec('BEGIN');
    foreach (records($xml) as [$kind, $body]) {
        $f = fields($body);
        if ($kind === 'Game') {
            if (!has($f, 'DatabaseID') || !has($f, 'Name') || !has($f, 'Platform')) {
                $n['skipped']++;
                continue;
            }
            $add($addGame, [num($f['DatabaseID']), $f['Name'], xs_gdb_compare_key($f['Name']), text($f, 'ReleaseDate'), num($f['ReleaseYear'] ?? null),
                text($f, 'Overview'), num($f['MaxPlayers'] ?? null), text($f, 'ReleaseType'), ($f['Cooperative'] ?? '') === 'true' ? 1 : 0,
                text($f, 'VideoURL'), num($f['CommunityRating'] ?? null), text($f, 'WikipediaURL'), $f['Platform'], text($f, 'ESRB'),
                num($f['CommunityRatingCount'] ?? null) ?: 0, $f['Genres'] ?? '', text($f, 'Developer'), text($f, 'Publisher')]);
        } elseif ($kind === 'GameAlternateName') {
            if (!has($f, 'DatabaseID') || !has($f, 'AlternateName')) {
                $n['skipped']++;
                continue;
            }
            $add($addAlt, [$f['AlternateName'], num($f['DatabaseID']), $f['Region'] ?? '', xs_gdb_compare_key($f['AlternateName'])]);
        } else {
            if (!isset($keep[$f['Type'] ?? '']) || !has($f, 'FileName') || !has($f, 'DatabaseID')) {
                $n['skipped']++;
                continue;
            }
            $add($addImg, [$f['FileName'], num($f['DatabaseID']), $f['Type'], text($f, 'Region')]);
        }
        if (++$n[$kind] % 100000 === 0) {
            say('  ' . $kind . ' ' . $n[$kind]);
        }
    }
    $db->exec('COMMIT');
    $db->exec('VACUUM');
    $db->close();
    say('packing');
    clearstatcache();
    $unpacked = filesize($dbFile);
    $m = xs_gdb_pack($dbFile, $outDir, $n['Game']);
    $mb = static fn (int $b): string => number_format($b / 1048576, 1, '.', '') . ' MB';
    say("done: {$n['Game']} games, {$n['GameAlternateName']} other names, {$n['GameImage']} pictures ({$n['skipped']} left out)");
    say('      ' . $mb($unpacked) . ' unpacked, ' . $mb((int) $m['size']) . ' packed, in ' . $outDir);
    tidy($work);
    sign_it($outDir, $keyFile);
    if ($publish) {
        publish_it($outDir);
    }
} catch (Throwable $e) {
    say('FAILED: ' . $e->getMessage());
    if (isset($db) && $db instanceof SQLite3) {
        try {
            $db->close();
        } catch (Throwable $e2) {
            // was never open
        }
    }
    tidy($work);
    exit(1);
}
