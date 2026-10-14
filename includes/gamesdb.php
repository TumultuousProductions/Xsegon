<?php
/**
 * Xsegon - the LaunchBox Games Database, for the parts of the app that ask it.
 *
 * The reader is bin\gamesdb.php, a process of its own (xs_gamesdb_php_cmd says why),
 * reading the copy in data\. This is the server's side, shared by api\gamesdb.php and
 * api\fill.php: run the reader, remember a match, fetch one picture.
 *
 * A match is kept in data\overrides.json
 * under 'dbId'; a picture lands in data\art as the game's replacement.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/settings.php';     // detailsFrom
require_once __DIR__ . '/overrides.php';

/**
 * Whether there is a Games Database to ask: the copy the reader already
 * unpacked, or a packed copy (the one in the download, or one fetched since).
 * The same places bin\gamesdb.php looks.
 */
function xs_gamesdb_ready(): bool
{
    return is_file(xs_data_path('gamesdb.sqlite'))
        || xs_gamesdb_packed_stamp() !== '';
}

/** The folders a packed copy may be in: the download's, and data\'s fetched one. */
function xs_gamesdb_packed_dirs(): array
{
    return [XS_ROOT . DIRECTORY_SEPARATOR . 'gamesdb', xs_data_path('gamesdb-update')];
}

/** A folder's manifest when it describes a packed copy that is there
    (gamesdb.json beside gamesdb.sqlite.bz2), or null. $raw: what the
    manifest file held, false when there is none. */
function xs_gamesdb_packed_in(string $dir, &$raw = null): ?array
{
    $raw = @file_get_contents($dir . DIRECTORY_SEPARATOR . 'gamesdb.json');
    $m = json_decode((string) $raw, true);
    return is_array($m) && !empty($m['built']) && !empty($m['sha256'])
        && is_file($dir . DIRECTORY_SEPARATOR . 'gamesdb.sqlite.bz2') ? $m : null;
}

/** The newest packed copy's stamp, or '': the best source and its stamp as
    bin\gamesdb-shared.php works them out (xs_gdb_read_source), which this
    must match word for word. */
function xs_gamesdb_packed_stamp(): string
{
    $best = null;
    foreach (xs_gamesdb_packed_dirs() as $dir) {
        $m = xs_gamesdb_packed_in($dir, $raw);
        if ($m === null) {
            /* A damaged manifest hides the packed copy and fills fall back to libretro:
               said in the log, so the fallback has a reason. */
            if ($raw !== false && !is_array(json_decode((string) $raw, true))) {
                xs_log('GDB', basename($dir) . '\\gamesdb.json is there but cannot be read as JSON; that copy is being ignored');
            }
            continue;
        }
        if ($best === null || strcmp((string) $m['built'], (string) $best['built']) > 0) {
            $best = $m;
        }
    }
    return $best === null ? '' : 'bz2 ' . $best['built'] . ' ' . substr((string) $best['sha256'], 0, 16);
}

/** Whether the reader will unpack a packed copy on its next run (the first
    time, or after a newer one arrived). */
function xs_gamesdb_build_due(): bool
{
    $stamp = xs_gamesdb_packed_stamp();
    if ($stamp === '') {
        return false;
    }
    $copy = xs_data_path('gamesdb.sqlite');
    if (!is_file($copy)) {
        return true;
    }
    // No note, or another one: not this packed copy, so it is replaced.
    return @file_get_contents($copy . '.from') !== $stamp;
}

/** Settings > Library > Games Database updates: 'auto' or 'manual'; false
    reads as manual. */
function xs_gamesdb_update_mode(): string
{
    $v = xs_settings()['library']['gamesdbUpdates'] ?? 'auto';
    return ($v === 'manual' || $v === false) ? 'manual' : 'auto';
}

/** Whether checking for a newer database means anything here: filling uses
    the database, and this PHP can read it (xs_gamesdb_readable). */
function xs_gamesdb_updates_apply(): bool
{
    return (xs_settings()['library']['detailsFrom'] ?? 'gamesdb') !== 'libretro' && xs_gamesdb_readable();
}

/** Start the updater (bin\gamesdb-update.php) in the background and leave
    it; the page never waits for it. $whenDue: only if a day has gone by (its
    own rule). */
function xs_gamesdb_update_start(bool $whenDue): bool
{
    $cmd = array_merge(xs_gamesdb_php_cmd(true), [XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'gamesdb-update.php']);
    if ($whenDue) {
        $cmd[] = '--if-due';
    }
    // Each word quoted, for paths with spaces; none holds a quote.
    $handle = @popen('start /B "" ' . implode(' ', array_map(static fn ($a) => '"' . $a . '"', $cmd)) . ' > NUL 2>&1', 'r');
    if ($handle === false) {
        // The automatic caller ignores this answer, so the log is the only trace.
        xs_log('GDB', 'the update check could not be started (popen failed)');
        return false;
    }
    pclose($handle);
    xs_log('GDB', 'checking for a newer Games Database' . ($whenDue ? '' : ' (asked for)'));
    return true;
}

/**
 * True pauses the automatic check (it looks on the project's release page); Check now
 * still asks. On since the first release.
 */
const XS_GAMESDB_AUTO_PAUSED = false;

/**
 * Automatic updates: a newer Games Database fetched in the background at most once a day,
 * called as the page loads. Manual updates come only from Check now. A test copy never
 * goes to GitHub by itself.
 */
function xs_gamesdb_update_maybe(): void
{
    if (XS_GAMESDB_AUTO_PAUSED || xs_test_copy() || xs_gamesdb_update_mode() !== 'auto' || !xs_gamesdb_updates_apply()) {
        return;
    }
    $checked = xs_data_path('gamesdb-update') . DIRECTORY_SEPARATOR . 'checked.json';
    // Daily; hourly while there is no copy yet (the first check is how one
    // arrives), so an offline start does not try on every page load.
    $gap = xs_gamesdb_packed_stamp() !== '' ? 86400 : 3600;
    if (is_file($checked) && time() - (int) filemtime($checked) < $gap) {
        return;
    }
    xs_gamesdb_update_start(true);
}

/** What Settings > Library says about the database: which copy is in use,
    when it was built, and what the last check found. */
function xs_gamesdb_status(): array
{
    $best = null;
    $where = '';
    foreach (xs_gamesdb_packed_dirs() as $n => $dir) {
        $m = xs_gamesdb_packed_in($dir);
        if ($m !== null && ($best === null || strcmp((string) $m['built'], (string) $best['built']) > 0)) {
            $best = $m;
            $where = $n === 0 ? 'the copy that came with Xsegon' : 'a newer copy fetched since';
        }
    }
    $dir = xs_data_path('gamesdb-update');
    $last = json_decode((string) @file_get_contents($dir . DIRECTORY_SEPARATOR . 'checked.json'), true);
    $lock = $dir . DIRECTORY_SEPARATOR . '.running';
    $running = is_file($lock) && time() - (int) filemtime($lock) < 1800;
    // A newer copy on its way down: how many bytes of how many (bin\gamesdb-update.php writes it twice a second).
    $fetch = null;
    if ($running) {
        $f = json_decode((string) @file_get_contents($dir . DIRECTORY_SEPARATOR . 'fetching.json'), true);
        if (is_array($f) && (int) ($f['total'] ?? 0) > 0 && time() - (int) ($f['at'] ?? 0) < 60) {
            $fetch = ['bytes' => max(0, min((int) ($f['bytes'] ?? 0), (int) $f['total'])), 'total' => (int) $f['total']];
        }
    }
    return [
        'applies'   => xs_gamesdb_updates_apply(),
        'mode'      => xs_gamesdb_update_mode(),
        'paused'    => XS_GAMESDB_AUTO_PAUSED,
        'built'     => $best['built'] ?? null,
        'games'     => $best['games'] ?? null,
        'where'     => $where,
        'last'      => is_array($last) ? ['at' => $last['at'] ?? null, 'result' => $last['result'] ?? ''] : null,
        'running'   => $running,
        'fetch'     => $fetch,
        'readable'  => xs_gamesdb_readable(),
    ];
}

/** Where Fill in scanned games and Find online look: 'gamesdb' or 'libretro'. */
function xs_details_from(): string
{
    $want = (string) (xs_settings()['library']['detailsFrom'] ?? 'gamesdb');
    return $want !== 'libretro' && xs_gamesdb_ready() && xs_gamesdb_readable() ? 'gamesdb' : 'libretro';
}

/**
 * Whether this PHP can run the reader: it has the extensions below, loaded or as files.
 * Every PHP for Windows has them; when not, libretro fills in instead.
 */
function xs_gamesdb_readable(): bool
{
    return xs_gamesdb_php_exts() !== null;
}

/**
 * The extensions the reader needs that this PHP has not loaded already, or
 * null when one of them is not here at all. sqlite3 reads the database, bz2
 * unpacks the packed copy, intl takes accents off and puts names in order,
 * mbstring upper-cases them; openssl is for the updater's download.
 */
function xs_gamesdb_php_exts(): ?array
{
    static $got = false;
    static $missing = null;
    if (!$got) {
        $got = true;
        $missing = [];
        foreach (['sqlite3', 'bz2', 'intl', 'mbstring', 'openssl'] as $ext) {
            if (extension_loaded($ext)) {
                continue;
            }
            if (!is_file(xs_gamesdb_php_ext_dir() . DIRECTORY_SEPARATOR . 'php_' . $ext . '.dll')) {
                return $missing = null;
            }
            $missing[] = $ext;
        }
    }
    return $missing;
}

/** Where this PHP keeps its extensions, as a whole path in UTF-8 like every word of the
    reader's command (xs_utf8_path says why). */
function xs_gamesdb_php_ext_dir(): string
{
    $dir = xs_utf8_path((string) ini_get('extension_dir'));
    if ($dir === '' || !preg_match('#^([A-Za-z]:|[\\\\/])#', $dir)) {
        $dir = dirname(xs_php_exe()) . DIRECTORY_SEPARATOR . ($dir !== '' ? $dir : 'ext');
    }
    return rtrim($dir, '\\/');
}

/**
 * This PHP, started for the reader: missing extensions named on its command line, no
 * display errors, the server's time zone, and for the updater ($net) the certificates.
 *
 * A process of its own, so extensions load without touching php.ini, and a hung reader
 * can be stopped where a query inside the one-at-a-time server would hang it.
 */
function xs_gamesdb_php_cmd(bool $net = false): array
{
    $cmd = [xs_php_exe(), '-d', 'display_errors=0', '-d', 'display_startup_errors=0', '-d', 'extension_dir=' . xs_gamesdb_php_ext_dir()];
    foreach (xs_gamesdb_php_exts() ?? [] as $ext) {
        $cmd[] = '-d';
        $cmd[] = 'extension=' . $ext;
    }
    /* The server's own time zone: a child started from php.ini alone stamps in UTC, out
       of step with the server's lines and sometimes in the next day's log. */
    $cmd[] = '-d';
    $cmd[] = 'date.timezone=' . date_default_timezone_get();
    if ($net) {
        /* cacert.pem beside this PHP, named from the UTF-8 path; the server's own setting
           only when there is none, as it came in the Windows code page. */
        $pem = dirname(xs_php_exe()) . DIRECTORY_SEPARATOR . 'cacert.pem';
        foreach (['openssl.cafile', 'curl.cainfo'] as $ini) {
            $v = is_file($pem) ? $pem : xs_utf8_path(trim((string) ini_get($ini), '"'));
            if ($v !== '' && preg_match('//u', $v) === 1) {
                $cmd[] = '-d';
                $cmd[] = $ini . '=' . $v;
            }
        }
    }
    return $cmd;
}

/**
 * Run the reader and hand back what it says. Stopped after $seconds, as a hung reader
 * would freeze the one-at-a-time server. No cmd.exe, so % and quotes arrive as typed.
 */
function xs_gamesdb(array $args, int $seconds = 20): array
{
    /* Building from the shipped copy can be slow on a slow disk: it gets a run of its
       own with room for that, not the question's seconds. */
    if (($args[0] ?? '') !== 'prepare' && xs_gamesdb_build_due()) {
        xs_log('GDB', 'setting up the Games Database from the copy that ships with Xsegon');
        $p = xs_gamesdb(['prepare'], 300);
        if (empty($p['ok'])) {
            return $p;
        }
    }
    $r = xs_gamesdb_run($args, $seconds);
    /* The reader throws away a damaged copy and says so; asked again it builds a fresh
       one, so it is retried here. */
    if (empty($r['ok']) && str_contains((string) ($r['error'] ?? ''), 'made afresh')) {
        xs_log('GDB', 'the copy was damaged and thrown away; asking again');
        $r = xs_gamesdb_run($args, max($seconds, 300));
    }
    return $r;
}

/** One run of the reader; xs_gamesdb() is the door, with the retry. */
function xs_gamesdb_run(array $args, int $seconds): array
{
    if (!xs_gamesdb_readable()) {
        return ['ok' => false, 'error' => 'this PHP has not got the files the database reader needs (sqlite3, bz2, intl)'];
    }
    $cmd = array_merge(xs_gamesdb_php_cmd(), [XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'gamesdb.php']);
    foreach ($args as $a) {
        $cmd[] = str_replace(["\n", "\r"], ' ', (string) $a);
    }
    /* Its answer goes to a temp file, not a pipe: on Windows PHP cannot read a pipe
       without waiting for the end, so a pipe would wait out the very hang this limit is for. */
    $out = tempnam(sys_get_temp_dir(), 'xsgdb');
    $proc = $out === false ? false
          : @proc_open($cmd, [1 => ['file', $out, 'w'], 2 => ['file', $out, 'a']], $pipes, null, null, ['bypass_shell' => true]);
    if (!is_resource($proc)) {
        if ($out !== false) {
            @unlink($out);
        }
        return ['ok' => false, 'error' => 'the database reader could not be started'];
    }
    $deadline = microtime(true) + $seconds;
    /* Only a request has a time limit to push back. A background worker has none, and
       setting one would make PHP stop it 30 seconds after its last look-up. */
    $limited = (int) ini_get('max_execution_time') > 0;
    while (proc_get_status($proc)['running']) {
        /* $deadline governs here, not PHP's own limit, which would kill a long wait with a
           fatal. Refreshed each lap, so a hung reader still dies on time. */
        if ($limited) {
            set_time_limit(30);
        }
        if (microtime(true) > $deadline) {
            proc_terminate($proc);
            proc_close($proc);
            @unlink($out);
            xs_log('GDB', 'the reader did not answer within ' . $seconds . ' s and was stopped (' . (string) ($args[0] ?? '') . ')');
            return ['ok' => false, 'error' => 'the database reader did not answer within ' . $seconds . ' seconds'];
        }
        usleep(10000);
    }
    proc_close($proc);
    $raw = (string) @file_get_contents($out);
    @unlink($out);
    $j = $raw !== '' ? json_decode($raw, true) : null;
    if (!is_array($j)) {
        // No answer at all: logged with what it printed, as nothing else shows it.
        $said = $raw !== '' ? ': ' . substr(trim($raw), 0, 200) : '';
        xs_log('GDB', 'the reader gave no answer (' . (string) ($args[0] ?? '') . ')' . $said);
        return ['ok' => false, 'error' => 'the database reader did not answer' . $said];
    }
    return $j;
}

/**
 * Best match for many games at once: [{id, platform, title}, ...] in, [id => {best,
 * confidence, candidates}] out. One process, asked through a file, not the command line.
 */
function xs_gamesdb_matchmany(array $asks): array
{
    if (!$asks) {
        return ['ok' => true, 'results' => []];
    }
    $ask = xs_data_path('.gamesdb-ask.json');
    if (@file_put_contents($ask, json_encode(array_values($asks), JSON_UNESCAPED_UNICODE)) === false) {
        return ['ok' => false, 'error' => 'could not write the question for the database reader'];
    }
    /* The deadline grows with the question: a quarter second an ask, two minutes at
       least, for a whole library on a slow disk without letting a hung reader sit. */
    $r = xs_gamesdb(['matchmany', $ask], max(120, (int) ceil(count($asks) / 4)));
    @unlink($ask);
    return $r;
}

/** Remember which database game this one is (0 forgets). */
function xs_gamesdb_link(string $id, int $dbId, ?string &$why = null): bool
{
    $all = xs_overrides();
    if ($dbId > 0) {
        $all[$id]['dbId'] = $dbId;
    } else {
        unset($all[$id]['dbId']);
        if (empty($all[$id])) {
            unset($all[$id]);
        }
    }
    return xs_write_json(xs_data_path('overrides.json'), $all ?: new stdClass(), $why);
}

/** A name the image server will have: a GUID with an extension, sometimes "r2_" in front.
    Nothing else, so a name with a path in it can never get through. */
function xs_gamesdb_picture_name(string $file): bool
{
    return preg_match('/^(r\d{1,3}_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|gif|webp)$/i', $file) === 1;
}

/**
 * Where a picture of that name is fetched from. A test's stand-in (XSEGON_GAMESDB_IMAGES,
 * only beside XSEGON_DATA) takes the name at {file}, or answers for every picture.
 */
function xs_gamesdb_picture_url(string $file): string
{
    $test = (string) getenv('XSEGON_GAMESDB_IMAGES');
    if ($test !== '' && (string) getenv('XSEGON_DATA') !== '') {
        return str_contains($test, '{file}') ? str_replace('{file}', rawurlencode($file), $test) : $test;
    }
    return 'https://images.launchbox-app.com/' . $file;
}

/** One picture's bytes the plain way, or null. */
function xs_gamesdb_picture_get(string $url): ?string
{
    $ctx = stream_context_create(['http' => ['timeout' => 30, 'user_agent' => 'Xsegon'], 'ssl' => ['verify_peer' => true]]);
    $bytes = @file_get_contents($url, false, $ctx);
    return is_string($bytes) && $bytes !== '' ? $bytes : null;
}

/**
 * Several pictures at once: address => bytes, or null. Side by side through curl where
 * PHP has it, the rest the plain way; when curl brings none and the plain way does, the
 * run stays plain. $how: how many came each way.
 */
function xs_gamesdb_pictures_get(array $urls, ?array &$how = null): array
{
    static $plainOnly = false;
    $urls = array_values(array_unique(array_map('strval', $urls)));
    $out = [];
    $tried = false;
    $curlWhy = '';
    if (!$plainOnly && count($urls) > 1 && function_exists('curl_multi_init')) {
        $tried = true;
        $multi = curl_multi_init();
        $handles = [];
        foreach ($urls as $u) {
            $h = curl_init($u);
            // Given up when nothing comes for 30 s; no cap on the whole download, as a slow
            // line shares it between several.
            curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 5,
                CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_LOW_SPEED_LIMIT => 256, CURLOPT_LOW_SPEED_TIME => 30, CURLOPT_TIMEOUT => 600,
                CURLOPT_USERAGENT => 'Xsegon', CURLOPT_SSL_VERIFYPEER => true]);
            // Windows' own certificates, as the plain way uses: PHP's curl has none of its own.
            if (defined('CURLSSLOPT_NATIVE_CA')) {
                curl_setopt($h, CURLOPT_SSL_OPTIONS, CURLSSLOPT_NATIVE_CA);
            }
            curl_multi_add_handle($multi, $h);
            $handles[$u] = $h;
        }
        do {
            $state = curl_multi_exec($multi, $going);
            if ($going) {
                curl_multi_select($multi, 1.0);
            }
        } while ($going && $state === CURLM_OK);
        foreach ($handles as $u => $h) {
            $body = curl_multi_getcontent($h);
            $code = (int) curl_getinfo($h, CURLINFO_RESPONSE_CODE);        // 0 for a file:// stand-in
            if (curl_errno($h) === 0 && ($code === 0 || ($code >= 200 && $code < 300)) && is_string($body) && $body !== '') {
                $out[$u] = $body;
            } elseif ($curlWhy === '') {
                $curlWhy = curl_errno($h) !== 0 ? curl_error($h) : 'HTTP ' . $code;
            }
            curl_multi_remove_handle($multi, $h);
        }
        curl_multi_close($multi);
    }
    $viaCurl = count($out);
    $plain = 0;
    foreach ($urls as $u) {
        if (!isset($out[$u])) {
            $out[$u] = xs_gamesdb_picture_get($u);
            $plain += $out[$u] !== null ? 1 : 0;
        }
    }
    $how = ['side' => $viaCurl, 'plain' => $plain];
    if ($tried && $viaCurl === 0 && $plain > 0) {
        $plainOnly = true;
        xs_log('FILL', 'pictures are fetched one at a time on this PC: side by side brought none (' . $curlWhy . ')');
    }
    return $out;
}

/**
 * Download one of the database's pictures as the game's replacement for that slot, checked
 * as an upload is. What was stored, or null with $why; $dry only says what it would fetch.
 */
function xs_gamesdb_fetch(string $id, string $kind, string $file, ?string &$why = null, bool $dry = false): ?array
{
    $why = null;
    if (!isset(xs_own_art_kinds()[$kind])) {
        $why = 'kind must be one of: ' . implode(', ', array_keys(xs_own_art_kinds()));
        return null;
    }
    if (!xs_gamesdb_picture_name($file)) {
        $why = 'that is not a Games Database picture name';
        return null;
    }
    $url = xs_gamesdb_picture_url($file);
    if ($dry) {
        return ['id' => $id, 'kind' => $kind, 'url' => $url, 'dry' => true];
    }
    $ctx = stream_context_create(['http' => ['timeout' => 30, 'user_agent' => 'Xsegon'], 'ssl' => ['verify_peer' => true]]);
    $bytes = @file_get_contents($url, false, $ctx);
    if ($bytes === false || $bytes === '') {
        $why = 'could not fetch that picture from images.launchbox-app.com';
        return null;
    }
    // A picture chosen on purpose is one to show: its "use no picture" note goes.
    $stored = xs_own_art_store($id, $kind, $bytes, true, $why);
    if ($stored === null) {
        return null;
    }
    return ['id' => $id, 'kind' => $kind, 'replaced' => true, 'file' => $file] + $stored;
}
