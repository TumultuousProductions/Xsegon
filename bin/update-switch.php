<?php
/**
 * Xsegon - puts a downloaded, checked and tried new version in place, or takes
 * it out again (roadmap BD4). start.ps1 runs it while no server is running,
 * from the copy bin\update.php left in data\update\updater.php, so no file it
 * moves is the one running. Stands alone: no other file of Xsegon's is loaded,
 * as any of them may be half-moved.
 *
 *   php data\update\updater.php switch    data\update\next\ into place, the old files into previous\
 *   php data\update\updater.php recover   a switch cut off halfway (the power went) undone
 *   php data\update\updater.php back      the switch undone: the version before put back
 *        [--why=nostart]                  said in the mailbox: the new version did not start
 *
 * data\, private\ and custom\ are never touched. A file of Xsegon's the person
 * changed, or one of theirs where a new one arrives, is kept in previous\ and
 * named. A switch that fails says why in the mailbox and in failed.json, which
 * Settings reads. Prints one JSON answer; exit 0 when it did the job.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
ini_set('display_errors', '0');
error_reporting(E_ALL);
set_time_limit(0);

const US_LIST  = 'RELEASE.json';
const US_SIG   = 'RELEASE.sig';
const US_NEVER = ['data', 'private', 'custom', 'runtime', '.git'];
const US_HELP  = 'help@tumultuousproductions.site';   // js\util.js HELP_MAIL: this file loads nothing of Xsegon's
const US_FAILED_MSG = 'msg-update-failed';

$cmd  = $argv[1] ?? '';
$opts = [];
foreach (array_slice($argv, 2) as $a) {
    if (preg_match('/^--([a-z-]+)(?:=(.*))?$/', $a, $m)) {
        $opts[$m[1]] = $m[2] ?? true;
    }
}
$root = isset($opts['root']) ? rtrim((string) $opts['root'], '\\/') : (basename(__DIR__) === 'bin' ? dirname(__DIR__) : dirname(__DIR__, 2));
$data = $root . DIRECTORY_SEPARATOR . 'data';
$up   = $data . DIRECTORY_SEPARATOR . 'update';
$next = $up . DIRECTORY_SEPARATOR . 'next';
$prev = $up . DIRECTORY_SEPARATOR . 'previous';
$jour = $up . DIRECTORY_SEPARATOR . 'switch.json';

// The server's time zone, written down when the update was got ready: this runs with none of its own.
$zone = (string) ((us_json($jour)['zone'] ?? null) ?? (us_json($up . DIRECTORY_SEPARATOR . 'ready.json')['zone'] ?? 'UTC'));
@date_default_timezone_set(in_array($zone, timezone_identifiers_list(), true) ? $zone : 'UTC');

// .git is a folder in a checkout and a file in a git worktree: either is git's to update.
if (file_exists($root . DIRECTORY_SEPARATOR . '.git')) {
    us_answer(['ok' => false, 'why' => 'this copy is a git checkout: it updates with git, never by this'], 2);
}
if (!is_file($root . DIRECTORY_SEPARATOR . 'index.php')) {
    us_answer(['ok' => false, 'why' => 'no Xsegon in ' . $root], 2);
}

switch ($cmd) {
    case 'switch':
        $t0    = microtime(true);
        $ready = us_json($up . DIRECTORY_SEPARATOR . 'ready.json');
        $have  = us_json($root . DIRECTORY_SEPARATOR . US_LIST);
        $go    = us_json($up . DIRECTORY_SEPARATOR . 'go.json') ?? [];
        // Who the failure words name: the version pressed for, and this one.
        $to    = (string) ($ready['version'] ?? ($go['to'] ?? 'the new version'));
        $from  = (string) ($have['version'] ?? ($ready['from'] ?? ($go['from'] ?? 'this version')));
        if ($ready === null || !is_dir($next)) {
            us_switch_failed('nothing is ready to put in place', 'nothing was waiting to be put in place', $to, $from);
        }
        if ((us_json($jour)['state'] ?? '') === 'moving') {
            us_switch_failed('a switch was cut off halfway: recover first', 'an earlier update was cut off halfway and is put back at the next start first', $to, $from);
        }
        $listText = (string) @file_get_contents($next . DIRECTORY_SEPARATOR . US_LIST);
        $list     = json_decode($listText, true);
        if (!is_array($list['files'] ?? null) || ($list['version'] ?? null) !== ($ready['version'] ?? '')) {
            us_switch_failed('the waiting copy has no list of its files for ' . $to, 'the downloaded copy has lost its list of files', $to, $from, true);
        }
        // Checked again by checksum, as it has sat on the disk since it was checked and tried.
        foreach ($list['files'] as $p => $f) {
            $at = us_at($next, (string) $p);
            if (!us_safe((string) $p) || !is_file($at) || hash_file('sha256', $at) !== ($f['sha256'] ?? '')) {
                us_switch_failed("the waiting copy changed since it was checked ($p): it is not put in place",
                    "the downloaded copy changed on the disk after it was checked ($p)", $to, $from, true);
            }
        }

        $old   = is_array($have['files'] ?? null) ? $have['files'] : [];
        $new   = $list['files'];
        $paths = array_keys($old + $new);
        sort($paths, SORT_STRING);
        $paths[] = US_LIST;
        $paths[] = US_SIG;
        $kept = [];
        foreach ($paths as $p) {
            $disk = us_at($root, $p);
            if ($p === US_LIST || $p === US_SIG || !is_file($disk)) {
                continue;
            }
            if (isset($old[$p]) ? hash_file('sha256', $disk) !== ($old[$p]['sha256'] ?? '') : isset($new[$p])) {
                $kept[] = $p;
            }
        }
        us_rmtree($prev);
        @mkdir($prev, 0777, true);
        $j = ['state' => 'moving', 'from' => (string) ($have['version'] ?? ($ready['from'] ?? '?')), 'to' => (string) $list['version'],
              'paths' => $paths, 'newPaths' => array_merge(array_keys($new), [US_LIST, US_SIG]), 'kept' => $kept,
              'zone' => date_default_timezone_get(), 'at' => date('c')];
        us_write($jour, $j);

        $isNew = array_flip($j['newPaths']);
        $stop  = (int) ($opts['stop-after'] ?? 0);   // a test's power cut: ends with no word after this many moves
        $moves = 0;
        foreach ($paths as $p) {
            $cur = us_at($root, $p);
            if (file_exists($cur)) {
                if (!us_move($cur, us_at($prev, $p))) {
                    $left = us_undo($j);
                    us_switch_held("could not move $p aside (in use?): put back as it was" . ($left ? ', but not ' . implode(', ', $left) : ''), $p, $left, $j);
                }
                if ($stop > 0 && ++$moves >= $stop) {
                    exit(3);
                }
            }
            if (isset($isNew[$p])) {
                if (!us_move(us_at($next, $p), $cur)) {
                    $left = us_undo($j);
                    us_switch_held("could not put the new $p in place (in use?): put back as it was" . ($left ? ', but not ' . implode(', ', $left) : ''), $p, $left, $j);
                }
                if ($stop > 0 && ++$moves >= $stop) {
                    exit(3);
                }
            }
        }
        $gone = array_values(array_diff(array_keys($old), array_keys($new)));
        foreach ($gone as $p) {
            us_rmdirs($root, $p);
        }
        us_rmtree($next);
        @unlink($up . DIRECTORY_SEPARATOR . 'ready.json');
        @unlink($up . DIRECTORY_SEPARATOR . 'go.json');
        // An earlier try that failed is over: its record and its message go.
        @unlink($up . DIRECTORY_SEPARATOR . 'failed.json');
        us_message_drop(US_FAILED_MSG);
        $j['state'] = 'done';
        $j['done']  = date('c');
        $j['ms']    = us_ms($t0);
        us_write($jour, $j);
        // start.ps1 asks the new version to answer at its first start, and goes back when it does not.
        us_write($up . DIRECTORY_SEPARATOR . 'first-start.json', ['to' => $j['to'], 'from' => $j['from'], 'at' => date('c')]);
        // "Is ready" is done with: What's new says what came.
        us_message_drop('msg-newversion');
        us_log("put $j[to] in place of $j[from]: " . count($paths) . ' files, ' . count($gone) . ' no longer in it'
            . ($kept ? ', ' . count($kept) . ' changed by you kept in data\\update\\previous (' . implode(', ', array_slice($kept, 0, 5)) . ')' : '')
            . ', in ' . $j['ms'] . 'ms');
        us_answer(['ok' => true, 'from' => $j['from'], 'to' => $j['to'], 'files' => count($paths), 'removed' => $gone, 'kept' => $kept, 'ms' => $j['ms']]);

    case 'recover':
        $j = us_json($jour);
        if (($j['state'] ?? '') !== 'moving') {
            us_answer(['ok' => true, 'recovered' => false]);
        }
        $left = us_undo($j);
        if ($left) {
            us_fail('could not put back ' . implode(', ', $left));
        }
        @unlink($jour);
        @unlink($up . DIRECTORY_SEPARATOR . 'go.json');
        us_log("putting $j[to] in place was cut off halfway; $j[from] is back as it was");
        us_answer(['ok' => true, 'recovered' => true, 'version' => $j['from']]);

    case 'back':
        $j = us_json($jour);
        if (($j['state'] ?? '') !== 'done') {
            us_fail('there is no update to go back from');
        }
        $left = us_undo($j);
        if ($left) {
            us_fail('could not put back ' . implode(', ', $left));
        }
        @unlink($jour);
        @unlink($up . DIRECTORY_SEPARATOR . 'back.json');
        @unlink($up . DIRECTORY_SEPARATOR . 'first-start.json');
        us_rmtree($next);
        us_rmtree($prev);
        // Not offered again by itself: a person can still update to it from its page.
        us_write($up . DIRECTORY_SEPARATOR . 'skipped.json', ['version' => $j['to'], 'at' => date('c')]);
        $nostart = ($opts['why'] ?? '') === 'nostart';
        us_log("$j[to] taken out, $j[from] put back" . ($nostart ? ': the new version did not start' : ', as asked'));
        if ($nostart) {
            us_message('msg-update-back', 'Xsegon ' . $j['to'] . ' did not start on this PC',
                $j['from'] . ' is back, as it was. Nothing was lost: your games, settings and pictures were never touched. '
                . $j['to'] . ' is not offered again by itself; its page has it, and Report a problem in Settings > Debug sends what happened.');
        }
        us_answer(['ok' => true, 'version' => $j['from'], 'skipped' => $j['to']]);
}
us_answer(['ok' => false, 'why' => 'say switch, recover or back'], 2);


function us_answer(array $a, int $code = 0): never
{
    echo json_encode($a, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
    exit($a['ok'] ? $code : ($code ?: 1));
}

function us_fail(string $why): never
{
    us_log('update not done: ' . $why);
    us_answer(['ok' => false, 'why' => $why]);
}

/** A switch that did not start moving files. A waiting copy that cannot be used is thrown away, so Update now downloads it again. */
function us_switch_failed(string $why, string $plain, string $to, string $from, bool $throwAway = false): never
{
    global $up, $next;
    if ($throwAway) {
        us_rmtree($next);
        @unlink($up . DIRECTORY_SEPARATOR . 'ready.json');
        us_message_drop('msg-newversion');   // it said "is ready"; the message below has Update now
    }
    us_said_failed($why, $to, $from, $plain . ($throwAway ? ': Update now downloads it again' : ''),
        ucfirst($plain) . ($throwAway ? ', so it was not used and has been removed. Nothing of ' . $from . ' changed. Update now downloads it again.'
                                      : '. Nothing of ' . $from . ' changed.') . ' ' . us_where_to_write($throwAway),
        $throwAway ? ['updatenow', 'report'] : ['report'], $throwAway);
}

/** A file Windows would not let go of mid-switch, after the undo; $left is what the undo could not put back. */
function us_switch_held(string $why, string $p, array $left, array $j): never
{
    global $jour;
    if (!$left) {
        @unlink($jour);   // all put back: the next start has nothing to recover
    }
    $n = count($left);
    $body = 'Windows would not let Xsegon move ' . $p . ', so ' . $j['from']
        . ($left ? ' was put back except for ' . $n . ' file' . ($n === 1 ? '' : 's') . ' (' . implode(', ', array_slice($left, 0, 3)) . ($n > 3 ? '...' : '')
                   . '), which Xsegon puts back the next time it starts. Your games, settings and pictures were never touched. If Xsegon does not work as it should after that, its page has '
                   . $j['from'] . ' to download by hand.'
                 : ' was put back as it was. Nothing was lost: your games, settings and pictures were never touched. Another program may have had the file open, such as an antivirus scan: Update now tries again.')
        . ' ' . us_where_to_write(!$left);
    us_said_failed($why, (string) $j['to'], (string) $j['from'],
        'Windows would not let Xsegon move ' . $p . ($left ? ', and ' . $n . ' file' . ($n === 1 ? ' is' : 's are') . ' put back at the next start' : ''),
        $body, $left ? ['report'] : ['updatenow', 'report'], false);
}

/** Where the details go, as Xsegon's other fault windows say it; after a try that may work next time, only if it keeps failing. */
function us_where_to_write(bool $retry): string
{
    return ($retry ? 'If it keeps failing, Help' : 'Help') . ' > Report a problem makes one file with the details. Please email it to ' . US_HELP . '.';
}

/** The failure written where the person looks: failed.json for Settings, a message in the mailbox, a line in the log. */
function us_said_failed(string $why, string $to, string $from, string $plain, string $body, array $opens, bool $thrownAway): never
{
    global $up;
    us_write($up . DIRECTORY_SEPARATOR . 'failed.json', ['to' => $to, 'from' => $from, 'why' => $plain, 'thrownAway' => $thrownAway, 'at' => date('c')]);
    us_message(US_FAILED_MSG, (preg_match('/^\d/', $to) ? 'Xsegon ' . $to : 'The new version of Xsegon') . ' was not put in place', $body, $opens);
    us_log('update not done: ' . $why . '; said in the mailbox');
    us_answer(['ok' => false, 'why' => $why]);
}

function us_ms(float $t0): int
{
    return (int) round((microtime(true) - $t0) * 1000);
}

function us_json(string $file): ?array
{
    $raw = @file_get_contents($file);
    $v = is_string($raw) ? json_decode(str_starts_with($raw, "\xEF\xBB\xBF") ? substr($raw, 3) : $raw, true) : null;
    return is_array($v) ? $v : null;
}

/** Written beside, then moved over: a cut-off write never leaves half a file. */
function us_write(string $file, array $v): void
{
    @mkdir(dirname($file), 0777, true);
    $tmp = $file . '.tmp';
    if (@file_put_contents($tmp, json_encode($v, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)) !== false) {
        @rename($tmp, $file);
    }
}

/** One line in data\log\<day>.log, as the server writes them; none with logging off in Settings. */
function us_log(string $msg): void
{
    global $data;
    if ((us_json($data . DIRECTORY_SEPARATOR . 'settings.json')['debug']['logging'] ?? true) === false) {
        return;
    }
    $t = microtime(true);
    $dir = $data . DIRECTORY_SEPARATOR . 'log';
    @mkdir($dir, 0777, true);
    @file_put_contents($dir . DIRECTORY_SEPARATOR . date('Y-m-d') . '.log',
        date('H:i:s', (int) $t) . sprintf('.%03d', (int) (($t - floor($t)) * 1000)) . ' S UPD  ' . $msg . "\n", FILE_APPEND);
}

/** A message in the mailbox, the way includes\news.php keeps them: newest first, one per id. $opens names its buttons (js\news.js MAIL_GOES). */
function us_message(string $id, string $title, string $body, array $opens = []): void
{
    global $data;
    $file = $data . DIRECTORY_SEPARATOR . 'messages.json';
    $all = array_values(array_filter(us_json($file) ?? [], static fn ($m) => is_array($m) && ($m['id'] ?? null) !== $id));
    array_unshift($all, ['id' => $id, 'at' => date('c'), 'kind' => 'info', 'level' => 'error', 'title' => $title, 'body' => $body, 'read' => false]
                        + ($opens ? ['opens' => $opens] : []));
    us_write($file, array_slice($all, 0, 60));
}

function us_message_drop(string $id): void
{
    global $data;
    $file = $data . DIRECTORY_SEPARATOR . 'messages.json';
    $all = us_json($file);
    if ($all !== null) {
        us_write($file, array_values(array_filter($all, static fn ($m) => is_array($m) && ($m['id'] ?? null) !== $id)));
    }
}

/** A path inside Xsegon's folder that an update may write. */
function us_safe(string $p): bool
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
    return !in_array($top, US_NEVER, true) && $top !== strtolower(US_LIST) && $top !== strtolower(US_SIG);
}

function us_at(string $base, string $p): string
{
    return $base . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $p);
}

/** A rename, tried again for two seconds: a virus scanner holds a new file a moment. */
function us_move(string $from, string $to): bool
{
    @mkdir(dirname($to), 0777, true);
    for ($i = 0; $i < 8; $i++) {
        if (@rename($from, $to)) {
            return true;
        }
        usleep(250000);
    }
    return false;
}

/**
 * Undoes a switch from wherever it stopped: each new file back to next\, each
 * old one back from previous\. Safe to run twice. Returns what would not move.
 */
function us_undo(array $j): array
{
    global $root, $next, $prev;
    $isNew = array_flip($j['newPaths'] ?? []);
    $left  = [];
    foreach (array_reverse($j['paths'] ?? []) as $p) {
        $cur = us_at($root, $p);
        $stg = us_at($next, $p);
        $old = us_at($prev, $p);
        if (isset($isNew[$p]) && file_exists($cur) && !file_exists($stg) && !us_move($cur, $stg)) {
            $left[] = $p;
            continue;
        }
        if (file_exists($old) && !file_exists($cur) && !us_move($old, $cur)) {
            $left[] = $p;
        }
    }
    foreach ($j['newPaths'] ?? [] as $p) {
        us_rmdirs($root, $p);
    }
    return $left;
}

/** The folders a file sat in, removed while empty, up to Xsegon's own folder. */
function us_rmdirs(string $root, string $p): void
{
    $d = dirname(us_at($root, $p));
    while (strlen($d) > strlen($root) && @rmdir($d)) {
        $d = dirname($d);
    }
}

function us_rmtree(string $dir): void
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
