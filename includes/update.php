<?php
/**
 * Xsegon - a new version got ready in the background, and put in place when
 * the person says (roadmap BD4). Never by itself: the look (includes\newversion.php)
 * says it is out, once; Update now downloads it, checks it and puts it in place.
 * Where Download new versions by themselves is on, the look gets it ready
 * first and the message says "is ready".
 *
 *     data\update\fetch.json    getting one ready: its version, the step, the bytes so far
 *     data\update\next\         the new version whole, checked against its signed
 *                               list and tried once on its own; nothing of the
 *                               copy in use changes before the switch
 *     data\update\ready.json    what is waiting: its version, this one's, the time zone
 *     data\update\updater.php   bin\update-switch.php, copied: start.ps1 runs it
 *                               with no server running
 *     data\update\go.json       Update now was pressed: put in place at the next start
 *     data\update\back.json     Go back was pressed
 *     data\update\switch.json   the last switch, which Go back undoes
 *     data\update\skipped.json  a version gone back from: not got ready again by itself
 *     data\update\failed.json   the last switch that did not work: its version and why, for Settings
 *
 * The download is Xsegon-update-<v>.zip, .json and .sig (tools\update-release.js),
 * from that version's own release on Xsegon-helper-files, tagged update-<v>: Xsegon's
 * release page carries only what people download. The list must be signed with the
 * key whose public half this copy carries (includes\update-key.pem), and every file
 * must match it.
 */
declare(strict_types=1);

require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/version.php';

const XS_UPDATE_ASK  = 'https://api.github.com/repos/TumultuousProductions/Xsegon-helper-files/releases/tags/update-';
const XS_UPDATE_FROM = 'https://github.com/TumultuousProductions/Xsegon-helper-files/releases/download/update-';
const XS_UPDATE_MAX  = 200 * 1048576;
const XS_UPDATE_MSG  = 'msg-newversion';   // the one message about a new version: "is out", then "is ready"

function xs_update_dir(): string
{
    return xs_data_path('update');
}

function xs_update_file(string $name): string
{
    return xs_update_dir() . DIRECTORY_SEPARATOR . $name;
}

/** Why this copy cannot update itself, or null. A checkout updates with git; a folder Windows will not let it write, by hand. */
function xs_update_cannot(): ?string
{
    // .git is a folder in a checkout and a file in a git worktree (Xsegon-2): either is git's to update.
    if (file_exists(XS_ROOT . DIRECTORY_SEPARATOR . '.git')) {
        return 'a git checkout';
    }
    if (!is_file(XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'update-switch.php') || !is_file(XS_ROOT . DIRECTORY_SEPARATOR . 'includes' . DIRECTORY_SEPARATOR . 'update-key.pem')) {
        return 'this copy has no updater';
    }
    // Its own folder must be Xsegon's to change: under Program Files it is Windows'.
    $probe = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . '.update-probe';
    if (@file_put_contents($probe, 'x') === false) {
        return 'Windows does not let Xsegon change its own folder (' . XS_ROOT . ')';
    }
    @unlink($probe);
    if (!is_file(xs_update_tar())) {
        return "Windows' tar.exe is not here to unpack it";
    }
    return null;
}

/** Windows' own tar, which unpacks a .zip as includes\unpack.php does. */
function xs_update_tar(): string
{
    return (getenv('SystemRoot') ?: 'C:\\Windows') . '\\System32\\tar.exe';
}

/** Where a release's update files may come from: their release on Xsegon-helper-files; on a test copy, its stand-in on this PC. */
function xs_update_allowed(string $url): bool
{
    if (str_starts_with($url, XS_UPDATE_FROM)) {
        return true;
    }
    return xs_test_copy() && preg_match('#^http://127\.0\.0\.1(:\d+)?/#', $url) === 1;
}

/** The three update files of a release's assets ([name => address]), or null when it has none. */
function xs_update_assets(string $version, array $assets): ?array
{
    $out = [];
    foreach (['zip' => '.zip', 'list' => '.json', 'sig' => '.sig'] as $k => $ext) {
        $url = (string) ($assets['Xsegon-update-' . $version . $ext] ?? '');
        if (!xs_update_allowed($url) || (!xs_test_copy() && !str_starts_with($url, XS_UPDATE_FROM . $version . '/'))) {
            return null;
        }
        $out[$k] = $url;
    }
    return $out;
}

/** Where a version's update files are asked for. XSEGON_UPDATE_URL: the tests' stand-in, on a test copy only. */
function xs_update_ask_url(string $version): ?string
{
    if (xs_test_copy()) {
        $test = getenv('XSEGON_UPDATE_URL');
        return is_string($test) && $test !== '' ? $test . rawurlencode($version) : null;
    }
    return XS_UPDATE_ASK . rawurlencode($version);
}

/**
 * A version's update files, asked of their own release on Xsegon-helper-files: the three
 * addresses, and the zip's size in $bytes; null with $why when that version has none.
 */
function xs_update_find(string $version, ?int &$bytes = null, ?string &$why = null): ?array
{
    $bytes = 0;
    $url   = xs_update_ask_url($version);
    if ($url === null) {
        $why = 'a test copy, which never asks GitHub by itself';
        return null;
    }
    require_once __DIR__ . '/newversion.php';
    $rel = xs_newversion_fetch($url, $why);
    if ($rel === null) {
        return null;
    }
    $assets = $sizes = [];
    foreach ((array) ($rel['assets'] ?? []) as $a) {
        if (is_array($a)) {
            $assets[(string) ($a['name'] ?? '')] = (string) ($a['browser_download_url'] ?? '');
            $sizes[(string) ($a['name'] ?? '')]  = (int) ($a['size'] ?? 0);
        }
    }
    $urls = xs_update_assets($version, $assets);
    if ($urls === null) {
        $why = 'its release holds no update files for this copy';
        return null;
    }
    $bytes = $sizes['Xsegon-update-' . $version . '.zip'] ?? 0;
    return $urls;
}

/**
 * Whether a release is marked urgent (a security fix, taken without the three days' wait):
 * read from its signed list, and believed only when the signature is the key this copy carries.
 */
function xs_update_urgent(string $version, array $urls): bool
{
    $list = xs_update_get((string) ($urls['list'] ?? ''), null, 8 * 1048576);
    $sig  = xs_update_get((string) ($urls['sig'] ?? ''), null, 65536);
    if (!is_string($list) || !is_string($sig) || !xs_update_signed($list, $sig)) {
        return false;
    }
    $got = json_decode($list, true);
    return xs_update_list_problem($got, $version) === null && ($got['urgent'] ?? false) === true;
}

/** True while bin\update.php is at work: it beats at each step and as the download comes. */
function xs_update_fetching(mixed $job): bool
{
    return is_array($job) && ($job['state'] ?? '') === 'running' && time() - (int) ($job['beat'] ?? 0) < 120;
}

/**
 * Starts getting a version ready in the background (bin\update.php). $by: "look"
 * (new versions download by themselves) or "press" (Update now). False when one
 * is under way or will not start.
 */
function xs_update_fetch_start(string $version, array $urls, string $by = 'look'): bool
{
    if (xs_update_fetching(xs_read_json(xs_update_file('fetch.json'), []))) {
        return false;
    }
    @mkdir(xs_update_dir(), 0777, true);
    xs_write_json(xs_update_file('fetch.json'), ['state' => 'running', 'version' => $version, 'urls' => $urls, 'by' => $by, 'step' => 'list',
                                                 'beat' => time(), 'at' => date('c')]);
    require_once __DIR__ . '/gamesdb.php';
    $cmd = array_merge(xs_gamesdb_php_cmd(true), [XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'update.php']);
    $h = @popen('start /B "" ' . implode(' ', array_map(static fn ($a) => '"' . $a . '"', $cmd)) . ' > NUL 2>&1', 'r');
    if ($h === false) {
        xs_log('UPD', 'getting ' . $version . ' ready could not be started (popen failed)');
        return false;
    }
    pclose($h);
    xs_log('UPD', 'getting ' . $version . ' ready ' . ($by === 'press' ? 'as Update now was pressed' : 'in the background, as new versions download by themselves'));
    return true;
}

/** The look's own start: once per version, never for one gone back from, one already here, or one that failed (Update now tries again). */
function xs_update_fetch_auto(string $version, array $urls): bool
{
    $ready = xs_read_json(xs_update_file('ready.json'), null);
    $skip  = xs_read_json(xs_update_file('skipped.json'), null);
    $job   = xs_read_json(xs_update_file('fetch.json'), null);
    if ((is_array($ready) && ($ready['version'] ?? '') === $version && is_dir(xs_update_file('next')))
        || (is_array($skip) && ($skip['version'] ?? '') === $version)
        || (is_array($job) && ($job['version'] ?? '') === $version && ($job['state'] ?? '') !== 'running')) {
        return false;
    }
    return xs_update_fetch_start($version, $urls, 'look');
}

/**
 * Update now with nothing downloaded yet: the newer version the look found is
 * got ready now, and the page presses Update now when it is. Null when started
 * or under way, else why not.
 */
function xs_update_get_now(): ?string
{
    $st = xs_update_state();
    if ($st['cannot'] !== null) {
        return 'this copy cannot update itself: ' . $st['cannot'];
    }
    if ($st['out'] === null) {
        return $st['ready'] !== null ? null : 'no newer version is known yet';
    }
    if (xs_update_fetching(xs_read_json(xs_update_file('fetch.json'), []))) {
        return null;
    }
    require_once __DIR__ . '/newversion.php';
    $look = xs_read_json(xs_newversion_path(), []);
    return xs_update_fetch_start($st['out']['version'], (array) ($look['urls'] ?? []), 'press') ? null : 'the download could not be started';
}

/** The newer version the last look found that this copy can download, newer than any waiting: [version, mb], or null. */
function xs_update_out(string $have, ?string $ready): ?array
{
    $look = xs_read_json(xs_data_path('newversion.json'), []);
    $v    = is_array($look) ? (string) ($look['newest'] ?? '') : '';
    if ($v === '' || !is_array($look['urls'] ?? null) || version_compare($v, $have, '<=') || ($ready !== null && version_compare($v, $ready, '<='))) {
        return null;
    }
    return ['version' => $v, 'mb' => (float) ($look['mb'] ?? 0)];
}

/** What Settings and the mailbox's button need: this version, one waiting or out, one to go back to, a press waiting for the next start. */
function xs_update_state(): array
{
    $ready = xs_read_json(xs_update_file('ready.json'), null);
    $sw    = xs_read_json(xs_update_file('switch.json'), null);
    $job   = xs_read_json(xs_update_file('fetch.json'), null);
    $have  = xs_version()['version'];
    $wait  = is_array($ready) && is_dir(xs_update_file('next')) ? (string) ($ready['version'] ?? '') : null;
    $out   = xs_update_out($have, $wait);
    // The last switch that failed, while it is about the version on offer. A copy thrown away and got ready again starts afresh.
    $fail  = xs_read_json(xs_update_file('failed.json'), null);
    $fto   = is_array($fail) ? (string) ($fail['to'] ?? '') : '';
    $failed = $fto !== '' && (($fto === $wait && empty($fail['thrownAway'])) || ($wait === null && $fto === ($out['version'] ?? null)))
        ? array_intersect_key($fail, array_flip(['to', 'from', 'why', 'at'])) : null;
    return [
        'have'     => $have,
        'cannot'   => xs_update_cannot(),
        'ready'    => $wait,
        'out'      => $out,
        'failed'   => $failed,
        // Getting one ready: its step and bytes for the corner bar; how it ended, with why.
        'fetch'    => is_array($job) ? array_intersect_key($job, array_flip(['state', 'version', 'by', 'step', 'got', 'size', 'why', 'at', 'ended']))
                                       + ['alive' => xs_update_fetching($job)] : null,
        'back'     => is_array($sw) && ($sw['state'] ?? '') === 'done' && is_dir(xs_update_file('previous')) ? (string) ($sw['from'] ?? '') : null,
        'kept'     => is_array($sw) && ($sw['state'] ?? '') === 'done' ? array_values((array) ($sw['kept'] ?? [])) : [],
        'going'    => is_file(xs_update_file('go.json')) ? 'update' : (is_file(xs_update_file('back.json')) ? 'back' : null),
        // start.ps1 -Hidden waits on the window and opens Xsegon again; any other start puts it in place at the next one.
        'restarts' => getenv('XSEGON_RESTARTS') === '1',
    ];
}

/**
 * Update now, or Go back: a backup of the data first, then the press written
 * down for start.ps1, which acts on it with no server running. Null when done, else why not.
 */
function xs_update_press(string $what): ?string
{
    $st = xs_update_state();
    if ($st['cannot'] !== null) {
        return 'this copy cannot update itself: ' . $st['cannot'];
    }
    if ($what === 'update' && $st['ready'] === null) {
        return 'no new version is waiting';
    }
    if ($what === 'back' && $st['back'] === null) {
        return 'there is no version before this one to go back to';
    }
    require_once __DIR__ . '/backup.php';
    try {
        $bk = xs_backup_make();
    } catch (Throwable $e) {
        return 'the backup before it did not work, so nothing was changed: ' . $e->getMessage();
    }
    @unlink(xs_update_file($what === 'update' ? 'back.json' : 'go.json'));
    xs_write_json(xs_update_file($what === 'update' ? 'go.json' : 'back.json'),
        ['to' => $what === 'update' ? $st['ready'] : $st['back'], 'from' => $st['have'], 'zone' => date_default_timezone_get(),
         'backup' => (string) ($bk['name'] ?? ''), 'at' => date('c')]);
    xs_log('UPD', ($what === 'update' ? 'Update now: ' . $st['ready'] : 'Go back: ' . $st['back']) . ' at the next start'
        . ($st['restarts'] ? ' (Xsegon opens again by itself)' : '') . ', after a backup (' . ($bk['name'] ?? '?') . ')');
    return null;
}

/** True when the list's signature is by the key whose public half this copy carries. */
function xs_update_signed(string $bytes, string $sigText): bool
{
    $pem = @file_get_contents(XS_ROOT . DIRECTORY_SEPARATOR . 'includes' . DIRECTORY_SEPARATOR . 'update-key.pem');
    $key = is_string($pem) ? @openssl_pkey_get_public($pem) : false;
    $sig = base64_decode(trim($sigText), true);
    return $key !== false && is_string($sig) && openssl_verify($bytes, $sig, $key, OPENSSL_ALGO_SHA256) === 1;
}

/** A path inside Xsegon's folder that an update may write: never data, private, custom, runtime or .git. */
function xs_update_safe(string $p): bool
{
    if ($p === '' || str_contains($p, '\\') || str_contains($p, ':') || $p[0] === '/') {
        return false;
    }
    foreach (explode('/', $p) as $part) {
        if ($part === '' || $part === '.' || $part === '..') {
            return false;
        }
    }
    $top = strtolower(explode('/', $p)[0]);
    return !in_array($top, ['data', 'private', 'custom', 'runtime', '.git', 'release.json', 'release.sig'], true);
}

/** What is wrong with a signed list for $version, or null. */
function xs_update_list_problem(mixed $list, string $version): ?string
{
    if (!is_array($list) || ($list['app'] ?? '') !== 'Xsegon' || !is_array($list['files'] ?? null) || !is_array($list['zip'] ?? null)) {
        return "the file list is not one of Xsegon's";
    }
    if (($list['version'] ?? '') !== $version) {
        return 'the file list is for ' . ($list['version'] ?? 'no version') . ', not ' . $version;
    }
    if (!preg_match('/^[0-9a-f]{64}$/', (string) ($list['zip']['sha256'] ?? '')) || (int) ($list['zip']['size'] ?? 0) <= 0) {
        return 'the file list does not say what the zip is';
    }
    foreach ($list['files'] as $p => $f) {
        if (!xs_update_safe((string) $p) || !preg_match('/^[0-9a-f]{64}$/', (string) ($f['sha256'] ?? ''))) {
            return 'the file list names a file an update may not write: ' . $p;
        }
    }
    return null;
}

/** What differs between a folder and a list (a file missing, one extra, one with other bytes), or null. */
function xs_update_tree_problem(string $dir, array $files): ?string
{
    $have = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
        if ($f->isFile()) {
            $have[str_replace('\\', '/', substr($f->getPathname(), strlen($dir) + 1))] = true;
        }
    }
    foreach ($files as $p => $f) {
        $at = $dir . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, (string) $p);
        if (!isset($have[$p])) {
            return $p . ' is missing';
        }
        if (filesize($at) !== (int) $f['size'] || hash_file('sha256', $at) !== $f['sha256']) {
            return $p . ' is not the file on the list';
        }
        unset($have[$p]);
    }
    return $have ? array_key_first($have) . ' is not on the list' : null;
}

/** One download: the text when $to is null, else true once it is in that file; false with $why. $tick(got, size) as it comes. */
function xs_update_get(string $url, ?string $to, int $max, ?string &$why = null, ?callable $tick = null): string|bool
{
    if (!xs_update_allowed($url)) {
        $why = 'not an address updates come from';
        return false;
    }
    $fh = $to !== null ? @fopen($to, 'wb') : null;
    if ($fh === false) {
        $why = 'cannot write ' . $to;
        return false;
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_FOLLOWLOCATION    => true,      // a release's files answer from another address
        CURLOPT_MAXREDIRS         => 5,
        CURLOPT_CONNECTTIMEOUT    => 15,
        CURLOPT_TIMEOUT           => 900,
        CURLOPT_FAILONERROR       => true,
        CURLOPT_USERAGENT         => 'Xsegon',
        CURLOPT_MAXFILESIZE_LARGE => $max,
    ] + ($fh !== null ? [CURLOPT_FILE => $fh] : [CURLOPT_RETURNTRANSFER => true])
      + ($tick !== null ? [CURLOPT_NOPROGRESS => false,
                           CURLOPT_XFERINFOFUNCTION => static function ($ch, $size, $got) use ($tick): int { $tick((int) $got, (int) $size); return 0; }] : []));
    $body = curl_exec($ch);
    $why  = curl_error($ch);
    if ($fh !== null) {
        fclose($fh);
    }
    if ($body === false || ($fh === null && strlen((string) $body) > $max)) {
        $why = $why !== '' ? $why : 'too big';
        return false;
    }
    return $fh !== null ? true : (string) $body;
}

function xs_update_rmtree(string $dir): void
{
    if (!is_dir($dir)) {
        return;
    }
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($it as $f) {
        $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
    }
    @rmdir($dir);
}

/** A page's text when it answered 200; $code says what it answered (0: nothing). */
function xs_update_page(string $url, ?int &$code = null): ?string
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_CONNECTTIMEOUT => 2, CURLOPT_FOLLOWLOCATION => true]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    return is_string($body) && $code === 200 ? $body : null;
}

/**
 * The new copy started by itself on a free port, with a data folder of its own
 * (a test copy, which never goes online by itself), and asked its version and
 * its page. Null when both answer right, else why not.
 */
function xs_update_trial(string $dir, string $want): ?string
{
    $s = @stream_socket_server('tcp://127.0.0.1:0', $no, $str);
    $port = $s !== false ? (int) substr((string) strrchr((string) stream_socket_get_name($s, false), ':'), 1) : 0;
    if ($s !== false) {
        fclose($s);
    }
    if ($port === 0) {
        return 'no free port to try it on';
    }
    $data = xs_update_file('trial-data');
    xs_update_rmtree($data);
    @mkdir($data, 0777, true);
    $env = getenv();
    $env['XSEGON_DATA'] = $data;
    // Its own code cache, as start.ps1 gives each folder: a second PHP on a shared one stops at once.
    $cmd = [PHP_BINARY, '-d', 'opcache.cache_id=xsegon-try-' . substr(md5($dir . microtime()), 0, 10),
            '-S', '127.0.0.1:' . $port, '-t', $dir, $dir . DIRECTORY_SEPARATOR . 'router.php'];
    $p = @proc_open($cmd, [0 => ['file', 'NUL', 'r'], 1 => ['file', 'NUL', 'w'], 2 => ['file', 'NUL', 'w']], $pipes, $dir, $env, ['bypass_shell' => true]);
    if (!is_resource($p)) {
        return 'PHP would not start';
    }
    $why  = 'it did not answer in 20 seconds';
    $till = microtime(true) + 20;
    while (microtime(true) < $till) {
        $st = xs_update_page("http://127.0.0.1:$port/api/status.php", $code);
        if ($code >= 400) {
            $why = "it answered with an error (HTTP $code)";
            break;
        }
        if ($st !== null) {
            $got = json_decode($st, true)['build']['version'] ?? null;
            if ($got !== $want) {
                $why = 'it says it is ' . var_export($got, true) . ', not ' . $want;
                break;
            }
            $page = xs_update_page("http://127.0.0.1:$port/");
            $why  = $page !== null && str_contains($page, 'id="xs-pack"') ? null : 'its page did not draw';
            break;
        }
        if (!(proc_get_status($p)['running'] ?? false)) {
            $why = 'it stopped as it started';
            break;
        }
        usleep(250000);
    }
    proc_terminate($p);
    proc_close($p);
    xs_update_rmtree($data);
    return $why;
}
