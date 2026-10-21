<?php
/**
 * Xsegon - shared bootstrap.
 *
 * Dependency-free: the PHP may lack pdo_sqlite and gd, and its php.ini is not Xsegon's
 * to change, so the library is a JSON file.
 */
declare(strict_types=1);

define('XS_ROOT', dirname(__DIR__));

// A warning printed into an answer breaks its JSON for the page. Each one is in the day's log (PHPE),
// and a fault that ends a request is kept for the mailbox (xs_fault_note).
ini_set('display_errors', '0');

// PHP's default 128 MB fails a large library (about 7 KB a game); 1.5 GB still stops a runaway.
// A php.ini that allows more is left as it is.
(static function (): void {
    $now  = trim((string) ini_get('memory_limit'));
    $unit = ['K' => 1024, 'M' => 1048576, 'G' => 1073741824][strtoupper(substr($now, -1))] ?? 1;
    if ($now !== '-1' && (int) $now * $unit < 1536 * 1048576) {
        @ini_set('memory_limit', '1536M');
    }
})();

function xs_data_dir(): string
{
    // Checked once per request, not for each of the thousands of paths built under it.
    static $d = null;
    if ($d === null) {
        $d = XS_ROOT . DIRECTORY_SEPARATOR . 'data';
        /* XSEGON_DATA: another data folder, set only by the test runner (tests\sandbox.js)
           so a run never reaches the Xsegon someone is playing. */
        $env = getenv('XSEGON_DATA');
        if (is_string($env) && $env !== '') {
            /* Told to use another folder and it is not there: stop. Falling back to the
               real one would write test games into the person's own data. */
            if (!is_dir($env)) {
                http_response_code(503);
                header('Content-Type: application/json');
                echo json_encode(['ok' => false, 'error' => 'this server\'s data folder is gone (' . $env . '); it will not use the real one instead']);
                exit(1);
            }
            $d = rtrim($env, '\\/');
        }
        if (!is_dir($d)) {
            mkdir($d, 0777, true);
        }
    }
    return $d;
}

function xs_data_path(string $name): string
{
    return xs_data_dir() . DIRECTORY_SEPARATOR . $name;
}

/**
 * What a folder holds whose name fits a pattern of * and ?, as full paths.
 * glob() reads [ ] in the folder's own name as a pattern and finds nothing there.
 */
function xs_glob(string $dir, string $pattern, bool $foldersOnly = false): array
{
    $names = is_dir($dir) ? @scandir($dir) : false;
    if ($names === false) {
        return [];
    }
    $fits = '/^' . strtr(preg_quote($pattern, '/'), ['\\*' => '.*', '\\?' => '.']) . '$/is';
    $out  = [];
    foreach ($names as $n) {
        if ($n === '.' || $n === '..' || ($n[0] === '.' && $pattern[0] !== '.') || !preg_match($fits, $n)) {
            continue;
        }
        $path = $dir . DIRECTORY_SEPARATOR . $n;
        if (!$foldersOnly || is_dir($path)) {
            $out[] = $path;
        }
    }
    return $out;
}

/**
 * A finished file into a slot several endings can fill (box.png or box.jpg). The new one
 * goes in first (tried three times: a scanner may hold it), then the others go; one that
 * will not go stays, and xs_slot_file() reads the newer. The file, or null with $why.
 */
function xs_put_file(string $tmp, string $stem, string $ext, array $endings, ?string &$why = null): ?string
{
    $why   = null;
    $final = $stem . '.' . $ext;
    $in    = false;
    for ($try = 0; $try < 3 && !$in; $try++) {
        if ($try > 0) {
            usleep(150000);
        }
        $in = @rename($tmp, $final);
    }
    if (!$in) {
        $why = xs_file_error_reason();
        @unlink($tmp);
        return null;
    }
    @touch($final);                          // the newest of its slot, whatever date the bytes came with
    foreach ($endings as $e) {
        $old = $stem . '.' . $e;
        if (strcasecmp((string) $e, $ext) !== 0 && is_file($old) && !@unlink($old)) {
            xs_log('WRIT', basename($old) . ' could not be removed after ' . basename($final) . ' took its place (' . xs_file_error_reason() . '): the newer one is read');
        }
    }
    return $final;
}

/** The file that fills such a slot, or null. Two endings standing: the newer. */
function xs_slot_file(string $stem, array $endings): ?string
{
    $best = null;
    foreach ($endings as $e) {
        $f = $stem . '.' . $e;
        if (is_file($f) && ($best === null || (int) @filemtime($f) > (int) @filemtime($best))) {
            $best = $f;
        }
    }
    return $best;
}

/**
 * Strip a UTF-8 byte order mark. PowerShell 5.1's `-Encoding UTF8` writes one and
 * json_decode then returns null silently, so every file the workers write comes through here.
 */
function xs_strip_bom(string $s): string
{
    return str_starts_with($s, "\xEF\xBB\xBF") ? substr($s, 3) : $s;
}

function xs_read_json(string $path, $fallback = null)
{
    if (!is_file($path)) {
        return $fallback;
    }
    $yours = xs_is_yours($path);
    error_clear_last();
    $raw = @file_get_contents($path);
    // A file of yours that would not open: a scanner's hold is short, so it is tried again.
    for ($try = 1; $raw === false && $yours && $try <= 3; $try++) {
        usleep(60000);
        error_clear_last();
        $raw = @file_get_contents($path);
    }
    if ($raw === false || $raw === '') {
        if ($yours) {
            xs_unread($path, $raw === false ? 'it could not be opened. ' . xs_file_error_reason()
                                            : 'it is empty, which Xsegon never leaves it');
        }
        return $fallback;
    }
    $val = json_decode(xs_strip_bom($raw), true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        if (xs_is_yours($path)) {
            xs_damaged_note($path, json_last_error_msg());
        }
        return $fallback;
    }
    return $val;
}

/**
 * A file a PowerShell fetcher rewrites as it goes: a read caught as a new copy
 * is swapped in gets nothing, so it is tried again, up to five times 25 ms
 * apart, before it counts as gone. A file not there with no new copy waiting
 * (<file>.part) is not there at all, and answers at once.
 */
function xs_read_json_settled(string $path, $fallback = null)
{
    for ($try = 0; $try < 5; $try++) {
        if (!is_file($path) && !is_file($path . '.part')) {
            return $fallback;
        }
        $val = xs_read_json($path, null);
        if ($val !== null) {
            return $val;
        }
        usleep(25000);
    }
    return xs_read_json($path, $fallback);
}

/* ---- a file of yours that cannot be read ----------------------------------
 * The files a backup keeps. One stray comma makes one unreadable, and read as empty the
 * next save would write a nearly empty file over it. So such a file is never written over
 * (xs_write_json refuses), the log says so once, and the page is told until it reads again.
 */
const XS_YOURS_JSON = ['settings.json', 'emulators.json', 'overrides.json', 'cores.json', 'emu-choice.json', 'hack-choice.json', 'cheats.json', 'cheats-used.json', 'pad-remaps.json',
                       'player-remaps.json', 'game-remaps.json', 'pad-keys.json', 'ra-hotkeys.json', 'game-hotkeys.json',
                       'favourites.json', 'my-ratings.json', 'notes.json', 'hack-of.json', 'accompanied.json', 'tags.json', 'fix-marks.json', 'hidden.json', 'deleted.json', 'art-hidden.json',
                       'local-games.json', 'scanned-games.json', 'history-seeded.json', 'wanted.json'];

function xs_is_yours(string $path): bool
{
    return in_array(strtolower(basename($path)), XS_YOURS_JSON, true)
        && strcasecmp(rtrim(xs_norm_path(dirname($path)), '\\'), rtrim(xs_norm_path(xs_data_dir()), '\\')) === 0;
}

/* ---- a file of yours that did not read THIS time --------------------------
 * A read that failed (a file held for a moment) or a file cut to nothing gives the
 * fallback and passes xs_json_damage, so the same loss follows. Remembered for the
 * request: what it would save was built from the failed read, even if the file opens later.
 */
function xs_unread(?string $path = null, ?string $why = null): ?string
{
    static $seen = [];
    $key = strtolower((string) $path);
    if ($why === null) {
        return $seen[$key] ?? null;
    }
    if (!isset($seen[$key])) {
        $seen[$key] = $why;                 // before the log line: writing it may read settings.json
        xs_log('JSON', basename((string) $path) . ' did not read: ' . $why . ' Xsegon will not save over it in this request');
    }
    return $seen[$key];
}

/** Why a file of yours cannot be trusted as read right now, or null: it will not open, or it is empty. */
function xs_unreadable(string $path): ?string
{
    if (!is_file($path)) {
        return null;                        // not there is fine: deleting it is how to start again
    }
    error_clear_last();
    $raw = @file_get_contents($path);
    if ($raw === false) {
        return 'it could not be opened. ' . xs_file_error_reason();
    }
    return trim(xs_strip_bom($raw)) === '' ? 'it is empty, which Xsegon never leaves it' : null;
}

/** Why a file will not read as JSON, or null when it does (or is missing or empty). */
function xs_json_damage(string $path): ?string
{
    $raw = @file_get_contents($path);
    if ($raw === false || trim(xs_strip_bom($raw)) === '') {
        return null;
    }
    json_decode(xs_strip_bom($raw), true);
    return json_last_error() === JSON_ERROR_NONE ? null : json_last_error_msg();
}

/** What the person is told about one. */
function xs_damage_sentence(string $name, string $why = ''): string
{
    if ($why === 'empty') {
        return $name . ' is empty, which Xsegon never leaves it: something cut it short. '
             . 'Xsegon will not save over it. Restore it from Settings > Backups, '
             . 'or delete the file to start it again.';
    }
    // Likeliest: a folder typed by hand as C:\Games where the file needs C:\\Games.
    return $name . ' cannot be read: something in it is out of place (often a missing comma, '
         . 'or a folder written with single \\ where the file needs \\\\). '
         . 'Xsegon will not save over it, so nothing in it is lost. '
         . 'Fix it by hand, or restore it from Settings > Backups.';
}

/** Written down once in data\damaged.json, which the status poll reads. */
function xs_damaged_note(string $path, string $err): void
{
    $file = xs_data_path('damaged.json');
    $list = xs_read_json($file, []);
    $list = is_array($list) ? $list : [];
    $name = basename($path);
    if (isset($list[$name])) {
        return;
    }
    $list[$name] = ['why' => $err, 'at' => date('c')];
    xs_write_json($file, $list);
    xs_log('JSON', $name . ' cannot be read (' . $err . '); Xsegon will not save over it');
}

/** The damaged files still damaged; any that read again are let go. */
function xs_damaged(): array
{
    $file = xs_data_path('damaged.json');
    if (!is_file($file)) {
        return [];
    }
    $list = xs_read_json($file, []);
    $out  = [];
    $kept = [];
    foreach (is_array($list) ? $list : [] as $name => $info) {
        if (!in_array(strtolower((string) $name), XS_YOURS_JSON, true)) {
            continue;
        }
        $empty = ($info['why'] ?? '') === 'empty';
        if ($empty ? xs_unreadable(xs_data_path((string) $name)) === null
                   : xs_json_damage(xs_data_path((string) $name)) === null) {
            xs_log('JSON', $name . ' reads again');
            continue;
        }
        $kept[$name] = $info;
        $out[] = ['file' => (string) $name, 'at' => (string) ($info['at'] ?? ''),
                  'message' => xs_damage_sentence((string) $name, $empty ? 'empty' : '')];
    }
    if (count($kept) !== count(is_array($list) ? $list : [])) {
        if ($kept) {
            xs_write_json($file, $kept);
        } else {
            @unlink($file);
        }
    }
    return $out;
}

/**
 * Turn PHP's last file error into a sentence naming a cause worth acting on, where
 * Windows says only "Access is denied (code: 5)".
 */
function xs_file_error_reason(): string
{
    $msg = (string) ((error_get_last() ?? [])['message'] ?? '');

    if (stripos($msg, 'code: 5') !== false || stripos($msg, 'Access is denied') !== false
        || stripos($msg, 'Permission denied') !== false || stripos($msg, 'code: 32') !== false
        || stripos($msg, 'used by another process') !== false) {
        return 'Something else is holding it: a virus scanner, OneDrive, another copy of '
             . 'Xsegon, or an editor with the file open.';
    }
    if (stripos($msg, 'No space left') !== false || stripos($msg, 'code: 112') !== false
        || stripos($msg, 'disk is full') !== false) {
        return 'The disk is full.';
    }
    if (stripos($msg, 'File exists') !== false || stripos($msg, 'code: 183') !== false) {
        return 'Something is already standing in its place.';
    }
    if (stripos($msg, 'No such file or directory') !== false || stripos($msg, 'code: 3') !== false
        || stripos($msg, 'cannot find the path') !== false) {
        return 'The folder is not there, which is what an unplugged drive looks like.';
    }
    if (stripos($msg, 'read-only') !== false || stripos($msg, 'write-protected') !== false
        || stripos($msg, 'code: 19') !== false) {
        return 'The disk or the file is read only.';
    }
    // The useful part follows the last colon; before it are the function name and paths.
    $tail = trim((string) (strrchr($msg, ':') ?: $msg), ": \t");
    return $tail !== '' ? 'Windows said: ' . $tail . '.' : 'No reason was given.';
}

/**
 * Record a failed write: a sentence for the person, and a log line cut to 160 characters
 * so the report's trouble lines stay short. The cut tail is the reassurance, not the cause.
 */
function xs_write_failed(?string &$why, string $path, string $sentence): bool
{
    $why   = 'Could not save ' . basename($path) . '. ' . $sentence;
    $short = preg_replace('/\s+/', ' ', $sentence) ?? $sentence;
    if (mb_strlen($short) > 160) {
        $short = mb_substr($short, 0, 157) . '...';
    }
    xs_log('WRIT', basename($path) . ': ' . $short);
    return false;
}

/**
 * Write JSON through a temp file, and say why when it could not. Never unlink before the
 * rename: rename replaces in one step and a failed one leaves the old file, while unlink
 * then a failed rename loses it. Tried three times; every failure is logged here once.
 */
/** True inside the fast lane (router-fast.php), which must never write. */
function xs_fast_lane(): bool
{
    return defined('XS_FAST_LANE');
}

function xs_write_json(string $path, $value, ?string &$why = null): bool
{
    $why = null;

    // A save in the fast lane would race the main server over the same file: refused
    // loudly, so the page takes it to the main server.
    if (xs_fast_lane()) {
        $why = 'the fast lane never writes';
        xs_log('WRIT', basename($path) . ': refused, the fast lane never writes (a read that tried to save; tell the maintainer)');
        return false;
    }

    // Never over a file of yours that will not open, is empty, or did not read in this
    // request: what is about to be written would be missing everything in it.
    if (xs_is_yours($path) && ($held = xs_unread($path) ?? xs_unreadable($path)) !== null) {
        if (str_starts_with($held, 'it is empty')) {
            xs_damaged_note($path, 'empty');
            $why = xs_damage_sentence(basename($path), 'empty');
        } else {
            $why = basename($path) . ' was not saved: ' . $held . ' Nothing in it was changed. Try again in a moment.';
        }
        xs_log('WRIT', basename($path) . ': refused, ' . $held);
        return false;
    }
    if (xs_is_yours($path) && ($err = xs_json_damage($path)) !== null) {
        xs_damaged_note($path, $err);
        $why = xs_damage_sentence(basename($path));
        xs_log('WRIT', basename($path) . ': refused, the file cannot be read');
        return false;
    }

    $json = json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        return xs_write_failed($why, $path, 'The value would not turn into JSON ('
            . json_last_error_msg() . '). That is a bug in Xsegon, not a problem with your disk.');
    }

    $dir = dirname($path);
    if (!is_dir($dir)) {
        error_clear_last();
        if (!@mkdir($dir, 0777, true) && !is_dir($dir)) {
            return xs_write_failed($why, $path, 'The folder it goes in could not be made. '
                . xs_file_error_reason() . ' The folder is ' . $dir);
        }
    }

    // Beside the real file, so the rename stays on one drive and is not a copy.
    $tmp = $path . '.tmp';
    error_clear_last();
    $written = @file_put_contents($tmp, $json, LOCK_EX);
    if ($written === false) {
        return xs_write_failed($why, $path, 'The working copy could not be written. '
            . xs_file_error_reason() . ' Nothing was lost: ' . basename($path) . ' is untouched.');
    }
    if ($written !== strlen($json)) {
        // A short write is a full disk: the half-written copy goes, never mistaken for a good one.
        @unlink($tmp);
        return xs_write_failed($why, $path, 'Only ' . $written . ' of ' . strlen($json)
            . ' bytes reached the disk, which means it is full. Nothing was lost: '
            . basename($path) . ' is untouched.');
    }

    for ($try = 1; $try <= 3; $try++) {
        error_clear_last();
        if (@rename($tmp, $path)) {
            return true;
        }
        if ($try < 3) {
            usleep(60000);           // 60ms: a scanner's hold is shorter than this
        }
    }

    return xs_write_failed($why, $path, xs_file_error_reason() . ' Tried three times. '
        . 'Nothing was lost: ' . basename($path) . ' is untouched and the new version is '
        . 'beside it as ' . basename($tmp) . '.');
}

function xs_append_jsonl(string $path, array $row): void
{
    file_put_contents($path, json_encode($row, JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
}

function xs_read_jsonl(string $path, int $limit = 0): array
{
    if (!is_file($path)) {
        return [];
    }
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
    if ($limit > 0) {
        $lines = array_slice($lines, -$limit);
    }
    $out = [];
    foreach ($lines as $line) {
        // Same BOM problem: PowerShell writes one when it creates the file.
        $row = json_decode(xs_strip_bom($line), true);
        if (is_array($row)) {
            $out[] = $row;
        }
    }
    return $out;
}

// ---- the log ----------------------------------------------------------------
/*
 * One line per thing that happens, page and server alike, in data\log\
 * <YYYY-MM-DD>.log:
 *
 *     14:02:31.418 S REQ  POST /api/launch.php 12ms 200
 *     14:02:31.420 S LNCH Super Mario 64 via RetroArch
 *     14:02:31.902 P KEY  Enter wheel
 *
 * Second column: who wrote it (S server, P page); third: a short code. Abbreviated on
 * purpose, to find the ten lines around a failure. Off with Settings > Debug > Logging.
 */
// With no timezone in php.ini PHP stamps UTC while the page stamps local time, so the
// zone is asked of Windows (php.ini is not Xsegon's to change). UTC when unknown.
(static function (): void {
    // A blank php.ini value reads back as "UTC", so UTC is treated as unset.
    $ini = (string) ini_get('date.timezone');
    if ($ini !== '' && strtoupper($ini) !== 'UTC') {
        return;
    }
    /* Windows' answer is kept a day in the temp folder: asking starts a process,
       and php -S answers one request at a time. */
    $cache = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'xsegon-windows-zone.txt';
    $win = (is_file($cache) && time() - (int) @filemtime($cache) < 86400) ? (string) @file_get_contents($cache) : '';
    if (trim($win) === '') {
        // tzutil is in System32, which is on every Windows PATH; the full path
        // in quotes trips cmd's quote-stripping and returns nothing.
        $out = [];
        @exec('tzutil /g', $out);
        $win = implode('', $out);
        if (trim($win) !== '') {
            @file_put_contents($cache, $win);
        }
    }
    $map = ['Eastern Standard Time' => 'America/New_York', 'Central Standard Time' => 'America/Chicago',
            'Mountain Standard Time' => 'America/Denver', 'Pacific Standard Time' => 'America/Los_Angeles',
            'GMT Standard Time' => 'Europe/London', 'W. Europe Standard Time' => 'Europe/Berlin',
            'Central European Standard Time' => 'Europe/Warsaw', 'AUS Eastern Standard Time' => 'Australia/Sydney'];
    $zone = $map[trim((string) $win)] ?? null;
    if ($zone === null) {
        /* An unknown zone: its current offset, ActiveTimeBias (minutes from local to UTC,
           summer time included), as Etc/GMT+N: whole hours, sign the same way round as
           the bias. A half-hour zone not in the map stays UTC. */
        $biasCache = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'xsegon-windows-bias.txt';
        $bias = (is_file($biasCache) && time() - (int) @filemtime($biasCache) < 86400) ? trim((string) @file_get_contents($biasCache)) : '';
        if ($bias === '') {
            $out = [];
            @exec('reg query "HKLM\SYSTEM\CurrentControlSet\Control\TimeZoneInformation" /v ActiveTimeBias', $out);
            if (preg_match('/ActiveTimeBias\s+REG_DWORD\s+0x([0-9a-f]+)/i', implode(' ', $out), $m)) {
                $n = hexdec($m[1]);
                $bias = (string) ($n >= 0x80000000 ? $n - 0x100000000 : $n);   // a DWORD: east of UTC is negative
                @file_put_contents($biasCache, $bias);
            }
        }
        $zone = 'UTC';
        if (preg_match('/^-?\d+$/', $bias) && (int) $bias % 60 === 0 && (int) $bias !== 0) {
            $h = intdiv((int) $bias, 60);
            $zone = 'Etc/GMT' . ($h > 0 ? '+' : '-') . abs($h);
        }
    }
    date_default_timezone_set($zone);
})();

const XS_LOG_KEEP_DAYS = 30;

function xs_log_path(): string
{
    $dir = xs_data_path('log');
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }
    $path = $dir . DIRECTORY_SEPARATOR . date('Y-m-d') . '.log';
    // A day's log opens with the build that wrote it; written straight to the file,
    // as xs_log() would call this back.
    if (!is_file($path)) {
        require_once __DIR__ . '/version.php';
        @file_put_contents($path, date('H:i:s.v') . ' S VER  ' . xs_version_line() . "\n", FILE_APPEND | LOCK_EX);
        /* Days past the last 30 go, once a day; only files named like a day. */
        foreach (xs_glob($dir, '????-??-??.log') as $old) {
            if (basename($old) < date('Y-m-d', time() - XS_LOG_KEEP_DAYS * 86400) . '.log') {
                @unlink($old);
            }
        }
    }
    return $path;
}

function xs_log_enabled(): bool
{
    static $on = null;
    if ($on === null) {
        $raw = @file_get_contents(xs_data_path('settings.json'));
        $set = $raw === false ? null : json_decode(xs_strip_bom($raw), true);
        $on  = !isset($set['debug']['logging']) || (bool) $set['debug']['logging'];
    }
    return $on;
}

/** $who: S for the server, P for a line the page sent. */
function xs_log(string $code, string $msg = '', string $who = 'S', ?string $stamp = null): void
{
    if (!xs_log_enabled()) {
        return;
    }
    $t    = $stamp ?? (new DateTime())->format('H:i:s.v');
    $msg  = preg_replace('/[\r\n\t]+/', ' ', $msg) ?? $msg;
    $line = $t . ' ' . $who . ' ' . str_pad($code, 4) . ' ' . mb_substr($msg, 0, 400) . "\n";
    @file_put_contents(xs_log_path(), $line, FILE_APPEND | LOCK_EX);
}

// Every request is timed and logged when it ends. Polls and pictures are left out
// unless slow or failed: they run thousands of times a day.
$GLOBALS['xs_t0'] = microtime(true);
/* What the main server is on: it answers one request at a time, so a stuck one freezes
   Xsegon. data\main-busy holds "time|pid|path" while a request runs; the fast lane reads
   it (api\running.php) and bin\fastlane.ps1 ends a server stuck a quarter of an hour. */
if (PHP_SAPI === 'cli-server' && !xs_fast_lane()) {
    @file_put_contents(xs_data_path('main-busy'), time() . '|' . getmypid() . '|'
        . (parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '?'));
}
/* How far the main server is through its request: data\main-step holds
   "time|done|total|words", read by the fast lane (api\step.php) for a bar (js\waitbar.js).
   At most eight writes a second, and gone with the request. */
function xs_step(string $words, int $done = 0, int $total = 0): void
{
    static $last = 0.0;
    if (PHP_SAPI !== 'cli-server' || xs_fast_lane()) {
        return;
    }
    // The start of something (nothing done of it yet) is always said; steps along it at most eight a second.
    $now = microtime(true);
    if ($done > 0 && $now - $last < 0.12) {
        return;
    }
    $last = $now;
    $GLOBALS['xs_stepped'] = true;
    @file_put_contents(xs_data_path('main-step'), time() . '|' . $done . '|' . $total . '|' . str_replace(['|', "\r", "\n"], ' ', $words));
}

/** What xs_step last wrote, for the fast lane to read out; null when the main server is on nothing that says. */
function xs_step_read(): ?array
{
    $raw = @file_get_contents(xs_data_path('main-step'));
    if (!is_string($raw) || $raw === '') {
        return null;
    }
    [$at, $done, $total, $words] = array_pad(explode('|', $raw, 4), 4, '');
    // Half a minute old is a request that died with its note still there.
    if ($words === '' || time() - (int) $at > 30) {
        return null;
    }
    return ['what' => $words, 'done' => (int) $done, 'total' => (int) $total];
}

/* What a request spent its time on, said when it is slow or runs out of time (the shutdown
   below): the part of the work it is on (xs_doing) and its looks at files, drive by drive
   (xs_look). The line the clock stops on says only where it stopped. */
$GLOBALS['xs_parts']    = [];            // words => seconds spent on that part
$GLOBALS['xs_looks']    = [];            // drive => [looks, seconds, slowest, its path]
$GLOBALS['xs_look_now'] = null;          // [path, since] while a look waits

/** The part of the work this request is on, in words ("reading your own games"). Returns the part before, to put back. */
function xs_doing(string $words): string
{
    static $now = '', $since = 0.0;
    $t = microtime(true);
    if ($now !== '') {
        $GLOBALS['xs_parts'][$now] = ($GLOBALS['xs_parts'][$now] ?? 0.0) + $t - $since;
    }
    $was = $now;
    [$now, $since] = [$words, $t];
    return $was;
}

/** The drive a path is on, as its root: "E:\" or "\\host\share"; '' when the path names none. */
function xs_drive_of(string $path): string
{
    if (isset($path[1]) && $path[1] === ':') {
        return strtoupper($path[0]) . ':\\';
    }
    $p = str_replace('/', '\\', $path);
    if (!str_starts_with($p, '\\\\')) {
        return '';
    }
    return preg_match('/^(\\\\\\\\[^\\\\]+\\\\[^\\\\]+)/', $p, $m) ? $m[1] : '';
}

/** is_file, is_dir or scandir of a path, its time counted on its drive. The look under way is known while it waits. */
function xs_look(string $how, string $path): mixed
{
    $t = microtime(true);
    $GLOBALS['xs_look_now'] = [$path, $t];
    $got  = $how === 'scandir' ? @scandir($path) : ($how === 'is_dir' ? @is_dir($path) : is_file($path));
    $took = microtime(true) - $t;
    $GLOBALS['xs_look_now'] = null;
    $d = xs_drive_of($path);
    $l = $GLOBALS['xs_looks'][$d] ?? [0, 0.0, 0.0, ''];
    $GLOBALS['xs_looks'][$d] = [$l[0] + 1, $l[1] + $took, max($l[2], $took), $took > $l[2] ? $path : $l[3]];
    return $got;
}

/** A path cut to its drive and last two parts, for a line that must stay short. */
function xs_path_short(string $p): string
{
    if (mb_strlen($p) <= 60) {
        return $p;
    }
    $parts = preg_split('#[\\\\/]+#', $p) ?: [$p];
    return rtrim(xs_drive_of($p), '\\') . '\\...\\' . implode('\\', array_slice($parts, -2));
}

/**
 * What this request spent its $seconds on: [the line for the log, the reason in plain words].
 * $outOf: the time limit it ran out of, 0 when it ended by itself.
 */
function xs_time_said(float $seconds, int $outOf = 0): array
{
    $at    = xs_doing('');                  // the part it was on at the end, its time added up
    $parts = array_filter($GLOBALS['xs_parts'], static fn($s) => $s >= 0.1);
    arsort($parts);
    $looks = $GLOBALS['xs_looks'];
    uasort($looks, static fn($a, $b) => $b[1] <=> $a[1]);
    $now   = $GLOBALS['xs_look_now'];
    $sec   = static fn(float $s): string => number_format($s, 1) . ' s';
    $place = static fn(string $d): string => $d !== '' ? $d : 'other places';
    $many  = static fn(int $n): string => $n . ($n === 1 ? ' look' : ' looks');

    $line = [];
    foreach (array_slice($parts, 0, 4, true) as $w => $s) {
        $line[] = $w . ' ' . $sec($s);
    }
    $drives = [];
    foreach (array_slice($looks, 0, 3, true) as $d => [$n, $s, $max, $p]) {
        // The slowest named only where it held anything up: the line is cut at 400 characters.
        $drives[] = $place((string) $d) . ' ' . $many($n) . ' in ' . $sec($s) . ($max >= 0.1 ? ' (slowest ' . $sec($max) . ', ' . xs_path_short($p) . ')' : '');
    }
    $log = $sec($seconds) . ($outOf ? ', out of time' : '') . ($at !== '' ? ', on ' . $at . ' at the end' : '')
         . ($now ? ', waiting ' . $sec(microtime(true) - $now[1]) . ' on a look at ' . xs_path_short($now[0]) : '')
         . ($line ? '; parts: ' . implode(', ', $line) : '')
         . ($drives ? '; looks at files: ' . implode(', ', $drives) : '; no looks at files');

    // In words: where it was, and where the time went when looks at files hold most of it.
    $plain = ($outOf ? 'it ran out of its ' . $outOf . ($outOf === 1 ? ' second' : ' seconds') : 'it took ' . $sec($seconds)) . ($at !== '' ? ' while ' . $at : '');
    if ($now) {
        $plain .= ', waiting on a look at ' . xs_path_short($now[0]) . ' (' . $sec(microtime(true) - $now[1]) . ' by then)';
    }
    $top = array_key_first($looks);
    if ($top !== null && $looks[$top][1] >= max(1.0, $seconds / 4)) {
        [$n, $s, $max, $p] = $looks[$top];
        $plain .= '; ' . $many($n) . ' at files on ' . $place((string) $top) . ' took ' . $sec($s) . ' of it, the slowest ' . $sec($max) . ' (' . xs_path_short($p) . ')';
    } elseif ($looks) {
        $plain .= '; looks at files took only ' . $sec(array_sum(array_column($looks, 1))) . ' of it';
    }
    return [$log, $plain];
}

/**
 * A fault that cost a press its answer, left for the mailbox to keep (includes\news.php, xs_trouble_sweep).
 * Only the last one. Not from the fast lane, which writes no file: the page asks the main server again.
 * $text: the file would not read (a syntax error), which a half-made edit leaves for a moment.
 */
function xs_fault_note(string $what, string $file, int $line, bool $text = false): void
{
    if (xs_fast_lane()) {
        return;
    }
    // A script from outside Xsegon (a scratch file, php -r) is someone trying something: the log has it, the mailbox does not.
    if (PHP_SAPI === 'cli') {
        $script = (string) ($_SERVER['SCRIPT_FILENAME'] ?? '') !== '' ? (string) (get_included_files()[0] ?? '') : '';
        if ($script === '' || !str_starts_with(strtolower($script), strtolower(XS_ROOT . DIRECTORY_SEPARATOR))) {
            xs_log('PHPE', 'not for the mailbox: ' . ($script !== '' ? $script : 'a script given on the command line') . ' is not one of Xsegon\'s');
            return;
        }
    }
    $ask  = basename((string) (parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: ($_SERVER['SCRIPT_NAME'] ?? '')));
    $note = json_encode(['at' => date('c'), 'where' => basename($file) . ':' . $line, 'what' => mb_substr($what, 0, 300),
                         'during' => (PHP_SAPI === 'cli' ? 'running ' : 'answering ') . ($ask !== '' ? $ask : 'the page')]
                        + ($text ? ['text' => true, 'file' => $file, 'mtime' => (int) @filemtime($file)] : []),
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    if (is_string($note)) {
        @file_put_contents(xs_data_path('last-fault.json'), $note, LOCK_EX);
    }
}

register_shutdown_function(static function (): void {
    if (PHP_SAPI === 'cli-server' && !xs_fast_lane()) {
        @unlink(xs_data_path('main-busy'));
        if (!empty($GLOBALS['xs_stepped'])) {
            @unlink(xs_data_path('main-step'));
        }
    }
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
    if ($path === '' || str_ends_with($path, '/api/log.php')) {
        /* CLI helpers have no REQ line, but a fatal in one is logged here: a detached
           start throws its stderr away. */
        $err = error_get_last();
        if ($path === '' && $err !== null && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
            xs_log('PHPE', 'fatal in ' . basename((string) ($_SERVER['SCRIPT_NAME'] ?? 'a CLI run')) . ': '
                . $err['message'] . ' at ' . basename($err['file']) . ':' . $err['line']);
            xs_fault_note($err['message'], $err['file'], $err['line'], in_array($err['type'], [E_PARSE, E_COMPILE_ERROR], true));
        }
        return;
    }
    $ms   = (int) round((microtime(true) - $GLOBALS['xs_t0']) * 1000);
    $code = http_response_code() ?: 200;
    $quiet = preg_match('#/api/(status|running|image|video|sound)\.php$#', $path) || str_starts_with($path, '/files/')
          // the runs check's panel asks every two seconds; its own RCHK lines say what happened
          || (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET' && str_ends_with($path, '/api/runcheck.php'))
          // and Settings asks this while Check now runs; GDB lines say what happened
          || (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET' && str_ends_with($path, '/api/gamesdb-update.php'))
          // and the folder window's wait and a fetch's progress, every half second;
          // SETUP lines say what each came to.
          || (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET' && preg_match('#/api/(pick-folder|setup)\.php$#', $path));
    $err  = error_get_last();
    $outOf = 0;
    if ($err !== null && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        xs_log('PHPE', 'fatal: ' . $err['message'] . ' at ' . basename($err['file']) . ':' . $err['line']);
        $code = 500;
        // Out of time: what it was doing and where the time went, in place of PHP's words.
        $what = $err['message'];
        if (preg_match('/^Maximum execution time of (\d+) seconds? exceeded/', $what, $m)) {
            $outOf = (int) $m[1];
            [$line, $what] = xs_time_said($ms / 1000, $outOf);
            xs_log('SLOW', basename($path) . ' ' . $line);
        }
        xs_fault_note($what, $err['file'], $err['line'], in_array($err['type'], [E_PARSE, E_COMPILE_ERROR], true));
        // Said in words where nothing has gone out yet: an empty answer reads "bad response" on the page.
        // PHP has made it a 500 already.
        if (str_contains($path, '/api/') && !headers_sent() && !ob_get_length()) {
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['ok' => false,
                'error' => 'something went wrong in the server: ' . mb_substr($what, 0, 300) . ' (the log has the details)'],
                JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        }
    }
    // A slow answer that came says what took the time too; pictures and videos stream for as long as they are.
    if (!$outOf && $ms >= 3000 && xs_log_enabled() && !preg_match('#/api/(image|video|sound)\.php$#', $path) && !str_starts_with($path, '/files/')) {
        xs_log('SLOW', basename($path) . ' ' . xs_time_said($ms / 1000)[0]);
    }
    if ($quiet && $ms < 300 && $code < 400) {
        return;
    }
    $q = (string) ($_SERVER['QUERY_STRING'] ?? '');
    xs_log('REQ', ($_SERVER['REQUEST_METHOD'] ?? 'GET') . ' ' . $path . ($q !== '' ? '?' . mb_substr($q, 0, 120) : '') . ' ' . $ms . 'ms ' . $code
        . (xs_fast_lane() ? ' fast' : ''));
});
set_error_handler(static function (int $no, string $str, string $file, int $line): bool {
    // A call written with @ expects this and is not logged. PHP 8 leaves only the
    // fatal bits in error_reporting() under @, which is how to tell.
    if (!(error_reporting() & $no)) {
        return false;
    }
    xs_log('PHPE', $str . ' at ' . basename($file) . ':' . $line);
    return false;                        // PHP's own handling continues
});

/* An exception nothing caught: the log gets it and a line per frame, and an API caller
   still gets JSON it can show rather than PHP's own HTML. */
set_exception_handler(static function (Throwable $e): void {
    xs_log('PHPE', 'uncaught ' . get_class($e) . ': ' . $e->getMessage()
        . ' at ' . basename($e->getFile()) . ':' . $e->getLine());
    foreach (array_slice($e->getTrace(), 0, 5) as $i => $f) {
        xs_log('PHPE', '  #' . $i . ' ' . basename((string) ($f['file'] ?? '?')) . ':' . ($f['line'] ?? '?')
            . ' ' . ($f['function'] ?? ''));
    }
    xs_fault_note($e->getMessage(), $e->getFile(), $e->getLine(), $e instanceof CompileError);
    if (PHP_SAPI === 'cli') {
        fwrite(STDERR, 'uncaught ' . get_class($e) . ': ' . $e->getMessage() . "\n");
        exit(1);
    }
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode(['ok' => false,
        'error' => 'something went wrong in the server: ' . $e->getMessage() . ' (the log has the details)'],
        JSON_UNESCAPED_SLASHES);
});

function xs_json($payload, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    // Not compressed, on purpose: page and server share a machine, so it is no faster.
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function xs_fail(string $message, int $code = 400): void
{
    xs_log('FAIL', $code . ' ' . $message . ' (' . basename((string) ($_SERVER['SCRIPT_NAME'] ?? '')) . ')');
    xs_json(['ok' => false, 'error' => $message], $code);
}

/**
 * The request body, or a 400. Malformed JSON must not read as an empty body: a bad
 * settings POST would then save an empty settings file and answer OK.
 */
function xs_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }
    $val = json_decode(xs_strip_bom($raw), true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        xs_fail('body is not valid JSON: ' . json_last_error_msg(), 400);
    }
    return is_array($val) ? $val : [];
}

/**
 * One piece of an upload sent in pieces, added to $tmp. Answers "more" and
 * ends the request until the last piece is in; a piece out of order, or one
 * that takes the file past $max bytes, is refused.
 */
function xs_upload_piece(string $tmp, int $max, string $tooBig, int $maxPieces = 200): void
{
    $part = (int) ($_GET['part'] ?? -1);
    $of   = (int) ($_GET['of'] ?? 0);
    if ($part < 0 || $of < 1 || $part >= $of || $of > $maxPieces) {
        xs_fail('part and of are required', 400);
    }

    $bytes = file_get_contents('php://input');
    if ($bytes === false || $bytes === '') {
        xs_fail('that piece arrived empty (is it over the POST limit?)', 400);
    }
    if ($part === 0) {
        @unlink($tmp);
    } elseif (!is_file($tmp)) {
        xs_fail('piece ' . $part . ' arrived before piece 0', 409);
    }
    if ((int) @filesize($tmp) + strlen($bytes) > $max) {
        @unlink($tmp);
        xs_fail($tooBig, 413);
    }
    if (file_put_contents($tmp, $bytes, FILE_APPEND | LOCK_EX) === false) {
        xs_fail('could not write the upload', 500);
    }
    if ($part < $of - 1) {
        xs_json(['ok' => true, 'part' => $part, 'more' => true]);
    }
}

/**
 * A path PHP handed over in the Windows code page, as UTF-8. PHP_BINARY and settings from
 * PHP's own command line come in the code page; under a folder with an accent they break
 * json_encode and any command joined with a UTF-8 path.
 */
function xs_utf8_path(string $p): string
{
    if (preg_match('//u', $p) === 1) {
        return $p;
    }
    if (function_exists('sapi_windows_cp_conv') && function_exists('sapi_windows_cp_get')) {
        $u = @sapi_windows_cp_conv(sapi_windows_cp_get('ansi'), 65001, $p);
        if (is_string($u) && $u !== '') {
            return $u;
        }
    }
    return $p;
}

/** This PHP's own php.exe, in UTF-8 (xs_utf8_path says why): for answers
    and for starting a child of it. Never PHP_BINARY itself. */
function xs_php_exe(): string
{
    static $exe = null;
    if ($exe === null) {
        $good = static fn (string $p): bool => $p !== '' && preg_match('//u', $p) === 1 && is_file($p);
        $exe = xs_utf8_path(PHP_BINARY);
        if (!$good($exe)) {
            // The download's own PHP, for a path the code page cannot write at all.
            $own = XS_ROOT . DIRECTORY_SEPARATOR . 'runtime' . DIRECTORY_SEPARATOR . 'php' . DIRECTORY_SEPARATOR . 'php.exe';
            $exe = $good($own) ? $own : (preg_match('//u', $exe) === 1 ? $exe : 'php.exe');
        }
    }
    return $exe;
}

/** Whether this is shaped like a game's id: letters, digits and hyphens, 64 at most. */
function xs_game_id_ok(string $id): bool
{
    return preg_match('/^[A-Za-z0-9\-]{1,64}$/', $id) === 1;
}

/** The game id a request names, trimmed; one not shaped like an id ends the request. */
function xs_id_or_fail($raw): string
{
    $id = trim((string) ($raw ?? ''));
    if (!xs_game_id_ok($id)) {
        xs_fail('bad id', 400);
    }
    return $id;
}

/** Ends a request that is not a POST. */
function xs_post_only(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        xs_fail('POST only', 405);
    }
}

/** Writes a data file, or ends the request with why it was not saved. */
function xs_write_or_fail(string $path, $value, string $lead = ''): void
{
    if (!xs_write_json($path, $value, $why)) {
        xs_fail($lead . (string) $why, 500);
    }
}

/** Windows paths out of LaunchBox use backslashes; normalise for comparison. */
function xs_norm_path(string $p): string
{
    return rtrim(str_replace('/', DIRECTORY_SEPARATOR, $p), DIRECTORY_SEPARATOR);
}

/** Resolve a LaunchBox path that may be relative to the LaunchBox root. */
function xs_resolve(string $root, string $path): string
{
    $path = xs_norm_path($path);
    if ($path === '') {
        return '';
    }
    // Absolute already? "C:\..." or "\\server\..."
    if (preg_match('/^[A-Za-z]:\\\\/', $path) || str_starts_with($path, '\\\\')) {
        return $path;
    }
    return xs_norm_path($root) . DIRECTORY_SEPARATOR . $path;
}

/**
 * Refuse a request that another web site sent: any page in the browser can POST to
 * 127.0.0.1. A browser always sends Origin cross-site; none at all is a local script.
 */
function xs_local_origin_only(): void
{
    $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    if ($origin === '') {
        return;
    }
    $host = strtolower((string) parse_url($origin, PHP_URL_HOST));
    if (!in_array($host, ['127.0.0.1', 'localhost', '[::1]', '::1'], true)) {
        xs_fail('only pages on this machine may do that', 403);
    }
}

/**
 * The app window's heartbeat (beat=1 on its status poll): bin\watchdog.ps1 restarts the
 * window when data\heartbeat goes stale. A failed touch is logged, as it means a restart.
 */
function xs_heartbeat(): void
{
    if (($_GET['beat'] ?? '') !== '1') {
        return;
    }
    $file = xs_data_path('heartbeat');
    if (!@touch($file)) {
        xs_log('WDOG', 'could not touch data\\heartbeat; the watchdog will think the window has stopped');
    }
}

/**
 * The game running now, from data\running.json, or null. api\launch.php writes a
 * "pending" one at once so a second press is caught; bin\launch.ps1 adds its PID.
 * A pending one past 30 seconds never started. $askWindows checks the PID (a tasklist).
 */
function xs_game_running(bool $askWindows = false): ?array
{
    $file = xs_data_path('running.json');
    $run  = xs_read_json($file, null);
    if (!is_array($run)) {
        return null;
    }
    $pid = (int) ($run['launcherPid'] ?? 0);
    $since = (int) strtotime((string) ($run['startedAt'] ?? ''));
    $age = time() - (int) @filemtime($file);
    /* The poll asks Windows once a minute too, so a launcher that died does not leave
       "playing X" up; the file is touched after a yes to space the asking. */
    if (!$askWindows && $pid > 0 && $age >= 60) {
        $askWindows = true;
        if (xs_pid_alive($pid, $since)) {
            @touch($file);
            return $run;
        }
    }
    $gone = ($pid === 0 && !empty($run['pending']) && $age > 30)
         || ($askWindows && $pid > 0 && !xs_pid_alive($pid, $since));
    if ($gone) {
        if (xs_fast_lane()) {
            return null;                 // not running; the main server's next look clears the file
        }
        @unlink($file);
        xs_log('LNCH', 'cleared a running game that was not running: ' . ($run['title'] ?? '?')
            . ($pid > 0 ? ' (its launcher, pid ' . $pid . ', has gone)' : ' (the launcher never started)'));
        return null;
    }
    return $run;
}

/**
 * Why a job that says "running" is not, or null. Workers write their PID into the job:
 * none after a minute never started; one Windows no longer has is dead. Windows is
 * asked at most every 30 seconds: the file is touched after a yes.
 */
function xs_job_dead(array $job, string $path): ?string
{
    if (($job['state'] ?? '') !== 'running') {
        return null;
    }
    $quiet = time() - (int) @filemtime($path);
    $pid = (int) ($job['pid'] ?? 0);
    if ($pid <= 0) {
        return $quiet > 60 ? 'its worker never started' : null;
    }
    if ($quiet < 30) {
        return null;
    }
    // 'handed': when a job that waited on another one got its worker, where that was later than its own start.
    if (xs_pid_alive($pid, (int) ($job['handed'] ?? $job['started'] ?? 0))) {
        @touch($path);
        return null;
    }
    return 'its worker (process ' . $pid . ') is gone';
}

/**
 * Whether process $pid is alive and, given $since (unix time its job started), can be
 * that worker: Windows reuses process numbers, so one created later is another program.
 */
function xs_pid_alive(int $pid, int $since = 0): bool
{
    if ($pid <= 0) {
        return false;
    }
    $out = @shell_exec('tasklist /FI "PID eq ' . $pid . '" /NH /FO CSV 2>NUL');
    if (!is_string($out) || !str_contains($out, '"' . $pid . '"')) {
        return false;
    }
    if ($since <= 0) {
        return true;
    }
    $born = xs_pid_born($pid);
    // Half a minute of room: the two times are taken a moment apart.
    if ($born === null || $born <= $since + 30) {
        return true;
    }
    xs_log('JOB', 'process ' . $pid . ' is alive but was started at ' . date('H:i:s', $born) . ', after what it was kept for ('
        . date('H:i:s', $since) . '): another program has that number now');
    return false;
}

/**
 * When process $pid was created (unix time), through FFI; null whenever unsure (no FFI,
 * no access, any error). Null changes nothing for the caller, so it fails safe.
 */
function xs_pid_born(int $pid): ?int
{
    if (PHP_OS_FAMILY !== 'Windows' || !extension_loaded('FFI') || $pid <= 0) {
        return null;
    }
    try {
        $k = FFI::cdef('
            typedef void* HANDLE;
            typedef struct { uint32_t lo; uint32_t hi; } XS_FILETIME;
            HANDLE OpenProcess(uint32_t access, int inherit, uint32_t pid);
            int GetProcessTimes(HANDLE h, XS_FILETIME* made, XS_FILETIME* ended, XS_FILETIME* kernel, XS_FILETIME* user);
            int CloseHandle(HANDLE h);
        ', 'kernel32.dll');
        $h = $k->OpenProcess(0x1000, 0, $pid);            // PROCESS_QUERY_LIMITED_INFORMATION: read only
        if ($h === null || FFI::isNull($h)) {
            return null;
        }
        $made = $k->new('XS_FILETIME');
        $rest = [$k->new('XS_FILETIME'), $k->new('XS_FILETIME'), $k->new('XS_FILETIME')];
        $ok = $k->GetProcessTimes($h, FFI::addr($made), FFI::addr($rest[0]), FFI::addr($rest[1]), FFI::addr($rest[2]));
        $k->CloseHandle($h);
        if (!$ok) {
            return null;
        }
        // 100 ns steps since 1601, to seconds since 1970.
        $born = intdiv(((int) $made->hi << 32) | (int) $made->lo, 10000000) - 11644473600;
        return $born > 946684800 && $born <= time() + 60 ? $born : null;
    } catch (Throwable $e) {
        return null;
    }
}

/**
 * Whether a resolved file sits inside a resolved folder: with the separator, so ...\Images
 * never matches ...\Images2, and without case. Both sides should come from realpath().
 */
function xs_inside(string $real, string $root): bool
{
    $root = rtrim($root, '\\/');
    return $root !== '' && strncasecmp($real, $root . DIRECTORY_SEPARATOR, strlen($root) + 1) === 0;
}

/**
 * A call to one of bin\*.ps1: & 'script' -Name 'value'. true is a switch, false or null
 * is left out. Values are single-quoted, quotes doubled; PowerShell reads curly quotes as
 * single quotes too, so those are doubled as well.
 */
function xs_ps_call(string $script, array $params): string
{
    $lit = static fn(string $v): string => "'" . preg_replace("/['\x{2018}\x{2019}\x{201A}\x{201B}]/u", '$0$0', $v) . "'";
    $call = '& ' . $lit($script);
    foreach ($params as $name => $value) {
        if ($value === true) {
            $call .= ' -' . $name;
        } elseif ($value !== false && $value !== null) {
            $call .= ' -' . $name . ' ' . $lit((string) $value);
        }
    }
    return $call;
}

/**
 * True on the test run's own server (XSEGON_DATA set). Its library still points at real
 * ROMs and emulators, so anything that would open a game, window or dialog, or reach a
 * running program, answers as if it had and does nothing. Windowless jobs still run.
 */
function xs_test_copy(): bool
{
    $env = getenv('XSEGON_DATA');
    return is_string($env) && $env !== '';
}

/**
 * On a test copy: is this path inside a real emulator folder (XSEGON_TEST_KEEP_OUT)?
 * A test writes nothing there. Always false off a test copy.
 */
function xs_test_keep_out(string $path): bool
{
    $list = getenv('XSEGON_TEST_KEEP_OUT');
    if ($path === '' || !is_string($list) || $list === '' || !xs_test_copy()) {
        return false;
    }
    $path = xs_norm_path($path) . DIRECTORY_SEPARATOR;
    foreach (explode('|', $list) as $dir) {
        $dir = xs_norm_path($dir);
        if ($dir !== '' && strncasecmp($path, $dir . DIRECTORY_SEPARATOR, strlen($dir) + 1) === 0) {
            return true;
        }
    }
    return false;
}

/** On a test copy: is this the folder a real emulator's own folder sits in? */
function xs_test_keep_out_beside(string $dir): bool
{
    $list = getenv('XSEGON_TEST_KEEP_OUT');
    if ($dir === '' || !is_string($list) || $list === '' || !xs_test_copy()) {
        return false;
    }
    foreach (explode('|', $list) as $real) {
        if ($real !== '' && strcasecmp(xs_norm_path(dirname($real)), xs_norm_path($dir)) === 0) {
            return true;
        }
    }
    return false;
}

/**
 * Start that call detached, and return at once. Sent as -EncodedCommand so cmd.exe sees
 * only letters and digits: cmd has no \" escape, and a path with & would split the command.
 *
 * $opts: 'hidden' (-WindowStyle Hidden), 'sta' (-STA, for a Windows dialog).
 */
function xs_spawn_ps(string $call, array $opts = []): bool
{
    // Without this, an encoded command prints "Preparing modules" into the server's console.
    $b64 = base64_encode(mb_convert_encoding("\$ProgressPreference = 'SilentlyContinue'; " . $call, 'UTF-16LE', 'UTF-8'));
    $cmd = 'start /B "" powershell.exe -NoProfile -ExecutionPolicy Bypass'
         . (!empty($opts['hidden']) ? ' -WindowStyle Hidden' : '')
         . (!empty($opts['sta']) ? ' -STA' : '')
         . ' -EncodedCommand ' . $b64;
    if (strlen($cmd) > 8000) {                  // cmd.exe's limit is 8191
        xs_log('SPWN', 'too long to start (' . strlen($cmd) . ' characters): ' . mb_substr($call, 0, 200));
        return false;
    }
    $handle = popen($cmd, 'r');
    if ($handle === false) {
        return false;
    }
    pclose($handle);
    return true;
}

/** Starts a worker of Xsegon's own in the background, by its file in bin\. */
function xs_spawn_worker(string $script): bool
{
    $cmd = [xs_php_exe(), '-d', 'display_errors=0', '-d', 'date.timezone=' . date_default_timezone_get(),
            XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . $script];
    $h = @popen('start /B "" ' . implode(' ', array_map(static fn ($a) => '"' . $a . '"', $cmd)) . ' > NUL 2>&1', 'r');
    if ($h === false) {
        return false;
    }
    pclose($h);
    return true;
}

/**
 * How far a 7zr run is, 0 to 100, from the file its -bsp1 output goes into, or
 * null when nothing says yet. 7zr rewrites one line as it goes (" 47% 8200 -
 * <file>"); the last one in the file's tail is the answer. A percent sign inside
 * a file's name is never at the start of a line, so it is not taken for one.
 */
function xs_7zr_percent(string $file): ?int
{
    if ($file === '' || !is_file($file) || ($fh = @fopen($file, 'rb')) === false) {
        return null;
    }
    $size = (int) (fstat($fh)['size'] ?? 0);
    fseek($fh, max(0, $size - 600));
    $tail = (string) fread($fh, 600);
    fclose($fh);
    return preg_match_all('/[\r\n][ \t]*(\d{1,3})%/', $tail, $m) ? min(100, (int) end($m[1])) : null;
}

/** Windows' own curl.exe, which does the fetching for those workers, or '' where there is none. */
function xs_curl_exe(): string
{
    $exe = (string) (getenv('SystemRoot') ?: 'C:\\Windows') . '\\System32\\curl.exe';
    return is_file($exe) ? $exe : '';
}

// Every request that changes something is checked here, so no endpoint can forget to.
// CLI scripts and reads are not requests another site can aim.
if (PHP_SAPI !== 'cli' && !in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD', 'OPTIONS'], true)) {
    xs_local_origin_only();
}

/* A few GETs do work, and an <img> on any page can aim one here: a cross-site request
   (Sec-Fetch-Site) not from this machine is refused whatever its method. A navigation
   from a link stays allowed; a browser that sends no such header is let through. */
if (PHP_SAPI !== 'cli' && ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site'
    && ($_SERVER['HTTP_SEC_FETCH_MODE'] ?? '') !== 'navigate') {
    $from = (string) ($_SERVER['HTTP_ORIGIN'] ?? ($_SERVER['HTTP_REFERER'] ?? ''));
    if (!in_array(strtolower((string) parse_url($from, PHP_URL_HOST)), ['127.0.0.1', 'localhost', '[::1]', '::1'], true)) {
        xs_fail('only pages on this machine may do that', 403);
    }
}
