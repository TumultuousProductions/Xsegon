<?php
/**
 * Xsegon - fetch a newer Games Database, when there is one.
 *
 *   php bin\gamesdb-update.php            check now
 *   php bin\gamesdb-update.php --if-due   only if the last check was a day ago
 *
 * When the published gamesdb.json was built later than the copy here (see
 * bin\gamesdb-shared.php), gamesdb.sqlite.bz2 is downloaded into
 * data\gamesdb-update\, checked for size and SHA-256, and put in place, the
 * manifest last. bin\gamesdb.php unpacks it at the next ask.
 *
 * includes\gamesdb.php starts this in the background at most once a day. Any
 * failure changes nothing; the outcome goes to checked.json and stdout.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
ini_set('display_errors', '0');
error_reporting(E_ALL);
set_time_limit(0);

$env = static function (string $name): string {
    $v = getenv($name);
    return is_string($v) ? $v : '';
};
$dataDir = $env('XSEGON_DATA') !== '' ? $env('XSEGON_DATA') : dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data';
$dir     = $dataDir . DIRECTORY_SEPARATOR . 'gamesdb-update';
$shipped = $env('XSEGON_GAMESDB_DIR') !== '' ? $env('XSEGON_GAMESDB_DIR') : dirname(__DIR__) . DIRECTORY_SEPARATOR . 'gamesdb';
$checked = $dir . DIRECTORY_SEPARATOR . 'checked.json';
$lock    = $dir . DIRECTORY_SEPARATOR . '.running';
// How far a download is, for the bar in Settings and in the corner (xs_gamesdb_status reads it): there only while one runs.
$fetching = $dir . DIRECTORY_SEPARATOR . 'fetching.json';
const DAY  = 86400;
// With no copy at all, the first check is how one arrives, so it is tried
// more often than daily; but not on every page load when offline.
const HOUR = 3600;
$locked = false;

/** Now, as YYYY-MM-DDTHH:MM:SS.mmmZ: checked.json is read by the page. Its own
    copy of xs_gdb_iso_now, for the answer written when the shared file will not load. */
function iso_now(): string
{
    $t = microtime(true);
    return gmdate('Y-m-d\TH:i:s', (int) $t) . sprintf('.%03dZ', (int) (($t - floor($t)) * 1000));
}

/* One line in data\log\<day>.log, the shape includes\boot.php writes: this
   runs detached with its output thrown away. Honours the logging switch;
   best effort. The server passes its time zone on the command line
   (includes\gamesdb.php), or these lines would be in UTC. */
function sline(string $msg): void
{
    global $dataDir;
    try {
        $raw = @file_get_contents($dataDir . DIRECTORY_SEPARATOR . 'settings.json');
        $s = is_string($raw) ? json_decode(str_starts_with($raw, "\xEF\xBB\xBF") ? substr($raw, 3) : $raw, true) : null;
        if (is_array($s) && ($s['debug']['logging'] ?? null) === false) {
            return;
        }
        $logDir = $dataDir . DIRECTORY_SEPARATOR . 'log';
        if (!is_dir($logDir)) {
            @mkdir($logDir, 0777, true);
        }
        $msg = mb_substr((string) preg_replace('/[\r\n\t]+/', ' ', $msg), 0, 400);
        @file_put_contents($logDir . DIRECTORY_SEPARATOR . date('Y-m-d') . '.log',
            (new DateTime())->format('H:i:s.v') . ' S GDB  ' . $msg . "\n", FILE_APPEND | LOCK_EX);
    } catch (Throwable $e) {
        // the log never breaks a check
    }
}

function done(string $result, array $extra = []): void
{
    global $checked, $lock, $locked, $fetching;
    @unlink($fetching);
    $o = ['at' => iso_now(), 'result' => $result] + $extra;
    sline('update check: ' . $result . (!empty($extra['built']) ? ' (built ' . $extra['built'] . ')' : ''));
    if (@file_put_contents($checked, json_encode($o, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n") === false) {
        sline('checked.json could not be written: ' . (error_get_last()['message'] ?? 'unknown'));
    }
    // Only our own lock: after a stale one was taken over, the slow first run
    // must not remove the second's on its way out.
    if ($locked && @file_get_contents($lock) === (string) getmypid()) {
        @unlink($lock);
    }
    echo json_encode($o, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit(0);
}

set_exception_handler(static function (Throwable $e): void {
    done('could not check: ' . $e->getMessage());       // a full disk, a folder it cannot write
});
set_error_handler(static function (int $no, string $msg, string $file, int $line): bool {
    if ($no === E_DEPRECATED || $no === E_USER_DEPRECATED) {
        return true;                        // a notice about a later PHP is not a fault
    }
    if (!(error_reporting() & $no)) {
        return false;
    }
    throw new ErrorException($msg, 0, $no, $file, $line);
});

// The one require whose failure (a damaged file beside this one) must not
// die into NUL: checked.json and the log say the check never ran.
try {
    require __DIR__ . '/gamesdb-shared.php';
} catch (Throwable $e) {
    sline('the update check could not start: ' . $e->getMessage());
    @mkdir($dir, 0777, true);
    @file_put_contents($checked, json_encode(['at' => iso_now(), 'result' => 'could not start: ' . $e->getMessage()], JSON_PRETTY_PRINT) . "\n");
    exit(1);
}

// The lock is made, not checked and then written, so two starts in the same
// moment (the daily check and Check now) cannot both pass.
function take_lock(): bool
{
    global $lock, $locked;
    for ($tries = 0; $tries < 2; $tries++) {
        $h = @fopen($lock, 'x');
        if ($h !== false) {
            fwrite($h, (string) getmypid());
            fclose($h);
            $locked = true;
            return true;
        }
        clearstatcache();
        if (!is_file($lock)) {
            throw new RuntimeException('could not write ' . $lock);
        }
        // Half an hour old is a run that died: taken over, and logged.
        if (time() - (int) @filemtime($lock) < 1800) {
            return false;
        }
        sline('took over a stale .running lock (its check died over half an hour ago)');
        @unlink($lock);
    }
    return false;
}

/** The headers of the answer just read, and its status (the last one, after any redirect). */
function last_status(?array $headers): int
{
    $status = 0;
    foreach ($headers ?? [] as $h) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', (string) $h, $m)) {
            $status = (int) $m[1];
        }
    }
    return $status;
}
function http_context(int $seconds)
{
    return stream_context_create([
        'http' => ['timeout' => $seconds, 'ignore_errors' => true, 'follow_location' => 1, 'max_redirects' => 10, 'user_agent' => 'Xsegon'],
        'ssl'  => ['verify_peer' => true, 'verify_peer_name' => true],
    ]);
}

if (!is_dir($dir)) {
    mkdir($dir, 0777, true);
}
// A download that died with its process leaves its part behind: an hour on, it is nobody's.
foreach (@scandir($dir) ?: [] as $f) {
    if (str_starts_with($f, XS_GDB_PACKED . '.part') && time() - (int) @filemtime($dir . DIRECTORY_SEPARATOR . $f) > HOUR) {
        @unlink($dir . DIRECTORY_SEPARATOR . $f);
    }
}
$have = xs_gdb_best_source([$shipped, $dir]);
// An update of Xsegon can ship a newer copy than the fetched one, which then goes.
if ($have !== null && $have['dir'] === $shipped) {
    $old = xs_gdb_read_source($dir);
    if ($old !== null && strcmp((string) $old['manifest']['built'], (string) $have['manifest']['built']) < 0) {
        @unlink($dir . DIRECTORY_SEPARATOR . XS_GDB_PACKED);
        @unlink($dir . DIRECTORY_SEPARATOR . XS_GDB_MANIFEST);
    }
}
if (in_array('--if-due', $argv, true)) {
    clearstatcache();
    if (is_file($checked) && time() - (int) filemtime($checked) < ($have !== null ? DAY : HOUR)) {
        echo json_encode(['result' => 'not due']);
        exit(0);
    }
}
// One at a time: a second start while a download runs leaves it be.
if (!take_lock()) {
    echo json_encode(['result' => 'already running']);
    exit(0);
}

$url = xs_gdb_release_url();
$text = @file_get_contents($url . XS_GDB_MANIFEST, false, http_context(20));
$status = last_status(function_exists('http_get_last_response_headers') ? http_get_last_response_headers() : ($http_response_header ?? null));
if ($text === false) {
    done('could not check: ' . preg_replace('/^file_get_contents\([^)]*\): /', '', (string) (error_get_last()['message'] ?? 'no answer')));
}
if ($status === 404) {
    // The release has no copy on it: not a fault here, and nothing newer to have.
    done('nothing published yet');
}
if ($status !== 0 && ($status < 200 || $status > 299)) {
    done('could not check: HTTP ' . $status);
}
$remote = json_decode($text, true);
if (!is_array($remote) || empty($remote['built']) || preg_match('/^[0-9a-f]{64}$/', (string) ($remote['sha256'] ?? '')) !== 1
    || !((int) ($remote['size'] ?? 0) > 0)) {
    done('the published manifest makes no sense');
}
if ($have !== null && strcmp((string) $remote['built'], (string) $have['manifest']['built']) <= 0) {
    done('up to date', ['built' => $have['manifest']['built']]);
}
$part = $dir . DIRECTORY_SEPARATOR . XS_GDB_PACKED . '.part' . getmypid();
try {
    $in = @fopen($url . XS_GDB_PACKED, 'rb', false, http_context(60));
    $status = last_status(function_exists('http_get_last_response_headers') ? http_get_last_response_headers() : ($http_response_header ?? null));
    if ($in === false) {
        throw new RuntimeException((string) preg_replace('/^fopen\([^)]*\): /', '', (string) (error_get_last()['message'] ?? 'no answer')));
    }
    if ($status !== 0 && ($status < 200 || $status > 299)) {
        fclose($in);
        done('could not download: HTTP ' . $status);
    }
    $out = fopen($part, 'wb');
    $sum = hash_init('sha256');
    $bytes = 0;
    $deadline = time() + 15 * 60;
    $saidAt = 0.0;
    while (!feof($in)) {
        // Twice a second at most: how many bytes of how many, for whoever is watching.
        if (microtime(true) - $saidAt >= 0.5) {
            $saidAt = microtime(true);
            @file_put_contents($fetching, json_encode(['bytes' => $bytes, 'total' => (int) $remote['size'], 'at' => time()]));
        }
        $chunk = fread($in, 1 << 18);
        if ($chunk === false || (stream_get_meta_data($in)['timed_out'] ?? false)) {
            throw new RuntimeException('the download stopped part way');
        }
        if (time() > $deadline) {
            throw new RuntimeException('the download took more than a quarter of an hour');
        }
        if ($chunk !== '') {
            hash_update($sum, $chunk);
            $bytes += strlen($chunk);
            if (fwrite($out, $chunk) !== strlen($chunk)) {
                throw new RuntimeException('could not write ' . $part . ' (is the disk full?)');
            }
        }
    }
    fclose($in);
    fclose($out);
    if ($bytes !== (int) $remote['size']) {
        @unlink($part);
        done('the download is the wrong size (' . $bytes . ', not ' . (int) $remote['size'] . ')');
    }
    if (hash_final($sum) !== (string) $remote['sha256']) {
        @unlink($part);
        done('the download does not match its checksum');
    }
    if (!@rename($part, $dir . DIRECTORY_SEPARATOR . XS_GDB_PACKED)) {
        throw new RuntimeException('could not put the download in place (' . (error_get_last()['message'] ?? 'unknown') . ')');
    }
    file_put_contents($dir . DIRECTORY_SEPARATOR . XS_GDB_MANIFEST, json_encode($remote, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
} catch (Throwable $e) {
    foreach ([$in ?? null, $out ?? null] as $h) {
        if (is_resource($h)) {
            fclose($h);
        }
    }
    @unlink($part);
    done('could not download: ' . $e->getMessage());
}
done('fetched', ['built' => $remote['built'], 'was' => $have !== null ? $have['manifest']['built'] : null]);
