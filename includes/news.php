<?php
/**
 * Xsegon - what changed in your library while you were not looking.
 *
 *     data\library-seen.json    the library as it stood last time
 *     data\messages.json        the mailbox: what has been said, and whether
 *                               you have read it
 *
 * Games arrive (a restore; the ones you add yourself are not news, see
 * xs_news_know), games leave (an older backup restored, a games file changed
 * by hand), and games stay listed while their FILE is gone from the drive,
 * which shows only when you press play.
 *
 * The file sweep (launch.sweepFiles) takes milliseconds, so it runs. It is
 * skipped when the ROM drive is not plugged in: then every game is "missing",
 * and that is one problem the guardrail already names.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/import.php';
require_once __DIR__ . '/deleted.php';
require_once __DIR__ . '/accompanied.php';

const XS_MESSAGES_KEPT = 60;          // the mailbox is news, not an archive

function xs_seen_path(): string    { return xs_data_path('library-seen.json'); }
function xs_messages_path(): string { return xs_data_path('messages.json'); }

function xs_messages(): array
{
    $m = xs_read_json(xs_messages_path(), []);
    return is_array($m) ? array_values(array_filter($m, 'is_array')) : [];
}

function xs_messages_unread(?array $msgs = null): int
{
    $msgs = $msgs ?? xs_messages();
    $n = 0;
    foreach ($msgs as $m) {
        if (empty($m['read'])) {
            $n++;
        }
    }
    return $n;
}

/** Newest first, capped, written. */
function xs_messages_add(array $msg, ?string &$why = null): bool
{
    $all = xs_messages();
    array_unshift($all, $msg);
    return xs_write_json(xs_messages_path(), array_slice($all, 0, XS_MESSAGES_KEPT), $why);
}

/** One line per game, enough to name it again later without the library. */
function xs_news_line(array $g): string
{
    return (string) ($g['title'] ?? '?') . '  (' . (string) ($g['platform'] ?? '?') . ')';
}

/*  WHAT YOU DID YOURSELF IS NOT NEWS. A game you add (Scan for Games, +,
    Steam) is written into library-seen.json at that moment (xs_news_know),
    and one you take out is taken off it (xs_news_forget). What is left to
    announce arrived or left some other way. With no snapshot yet neither
    does anything: the first look takes the whole library in. */

/** These games are known from now on: [{id, title, platform}, ...]. */
function xs_news_know(array $games): void
{
    $seen = xs_read_json(xs_seen_path(), null);
    if (!is_array($seen) || !isset($seen['games']) || !is_array($seen['games'])) {
        return;
    }
    $changed = false;
    foreach ($games as $g) {
        $id = is_array($g) ? (string) ($g['id'] ?? '') : '';
        if ($id !== '' && !isset($seen['games'][$id])) {
            $seen['games'][$id] = xs_news_line($g);
            $changed = true;
        }
    }
    if ($changed) {
        xs_write_json(xs_seen_path(), $seen);
    }
}

/** And these are forgotten: taken out by you, so not "no longer in the library". */
function xs_news_forget(array $ids): void
{
    $seen = xs_read_json(xs_seen_path(), null);
    if (!is_array($seen) || !isset($seen['games']) || !is_array($seen['games'])) {
        return;
    }
    $changed = false;
    foreach ($ids as $id) {
        if (isset($seen['games'][(string) $id])) {
            unset($seen['games'][(string) $id]);
            $changed = true;
        }
    }
    if ($changed) {
        xs_write_json(xs_seen_path(), $seen);
    }
}

/* Where a game's file really is: xs_rom_real_path() in includes\import.php,
   shared with the library read so the two never disagree on whether it exists. */

/**
 * Compare the library with the one remembered, and sweep the files.
 *
 * $write = false answers without changing anything, for the tests and a
 * second look on the same page.
 */
function xs_news_check(bool $write = true): array
{
    $s    = xs_settings();
    $lib  = xs_library();
    $now  = [];
    $byId = [];
    // Taken out by you, hidden or deleted from Xsegon: not news (below). Read
    // from their own files, because xs_library() has already dropped both.
    $yours = xs_deleted_ids();
    foreach (array_keys(xs_hidden_games()) as $hid) {
        $yours[(string) $hid] = true;
    }
    // A file you said goes with a game left the lists for that game's tab: yours too.
    foreach (xs_acc_all() as $aid => $rec) {
        if (is_array($rec) && ($rec['is'] ?? '') === 'with') {
            $yours[(string) $aid] = true;
        }
    }
    foreach ($lib['games'] ?? [] as $g) {
        if (!empty($g['hidden'])) {
            continue;                       // you already said you did not want it
        }
        $id = (string) $g['id'];
        $now[$id] = xs_news_line($g);
        $byId[$id] = $g;
    }

    $seen  = xs_read_json(xs_seen_path(), null);
    $first = !is_array($seen) || !isset($seen['games']) || !is_array($seen['games']);
    $was   = $first ? [] : $seen['games'];

    $added = [];
    $gone  = [];
    if (!$first) {
        foreach ($now as $id => $line) {
            if (!isset($was[$id])) {
                $added[] = ['id' => $id, 'line' => $line];
            }
        }
        foreach ($was as $id => $line) {
            /* Hidden or deleted by you is not "gone". They stay in the
               snapshot too (below), so bringing one back is not announced
               as added either. */
            if (!isset($now[$id]) && !isset($yours[(string) $id])) {
                // The line is all that is left to name it by.
                $gone[] = ['id' => (string) $id, 'line' => (string) $line];
            }
        }
    }

    // ---- the file sweep ----
    $missing  = [];
    $root     = xs_norm_path((string) ($s['paths']['romRoot'] ?? ''));
    $driveOk  = $root === '' || is_dir($root);
    $sweepOn  = !empty($s['launch']['sweepFiles']);
    $swept    = 0;
    if ($sweepOn && $driveOk) {
        $t0 = microtime(true);
        foreach ($byId as $id => $g) {
            $rom = (string) ($g['romPath'] ?? '');
            if ($rom === '' || !empty($g['local'])) {
                continue;                   // a game of your own may be a web address
            }
            $swept++;
            // Not when its own folder is away: a second drive unplugged is not a list of missing games.
            $full = xs_rom_real_path($rom, $s);
            if (!is_file($full) && xs_rom_away($full, $s) === null) {
                $missing[] = ['id' => $id, 'line' => xs_news_line($g), 'rom' => $rom];
            }
        }
        $sweepMs = (int) round((microtime(true) - $t0) * 1000);
    } else {
        $sweepMs = 0;
    }

    $out = [
        'first'    => $first,
        'added'    => $added,
        'gone'     => $gone,
        'missing'  => $missing,
        'swept'    => $swept,
        'sweepMs'  => $sweepMs,
        'sweptOff' => !$sweepOn,
        'driveOff' => !$driveOk,
        'games'    => count($now),
    ];

    if (!$write) {
        return $out;
    }

    /* Missing files are a STANDING CONDITION, not an event: the mailbox gets
       a message only when the set itself changes, keyed by the ids. */
    $missIds = array_map(static fn($m) => (string) $m['id'], $missing);
    sort($missIds);
    $missKey = implode(',', $missIds);
    $wasKey  = is_array($seen) ? (string) ($seen['missingKey'] ?? '') : '';
    $out['missingKey'] = $missKey;
    if ($missing && $missKey !== $wasKey) {
        xs_messages_add([
            'id'    => 'msg-' . bin2hex(random_bytes(6)),
            'at'    => date('c'),
            'kind'  => 'missing',
            'title' => count($missing) === 1 ? 'A game file is missing' : count($missing) . ' game files are missing',
            'body'  => 'These games are in your library, but their files are not on the disk. '
                     . 'They stay where they are and say so when you open them. Nothing has been '
                     . 'deleted from Xsegon, and nothing has been deleted from your disk by Xsegon.',
            'items' => array_slice(array_map(static fn($m) => $m['line'], $missing), 0, 12),
            'n'     => count($missing),
            'show'  => '@missing',        // the page turns this into "show me these"
            'read'  => false,
        ]);
    }

    // The first run says nothing: with no "before", every game would be announced as new.
    if ($added) {
        xs_messages_add([
            'id'    => 'msg-' . bin2hex(random_bytes(6)),
            'at'    => date('c'),
            'kind'  => 'added',
            'title' => count($added) === 1 ? 'A game was added' : count($added) . ' games were added',
            'body'  => 'Found in your library that were not there last time.',
            'items' => array_slice(array_column($added, 'line'), 0, 12),
            'n'     => count($added),
            'read'  => false,
        ]);
    }
    if ($gone) {
        xs_messages_add([
            'id'    => 'msg-' . bin2hex(random_bytes(6)),
            'at'    => date('c'),
            'kind'  => 'gone',
            'title' => count($gone) === 1 ? 'A game is no longer in the library' : count($gone) . ' games are no longer in the library',
            'body'  => 'They were here last time and are not now, without being removed in Xsegon. Restoring an older backup, or a list of games changed outside Xsegon, can do this.',
            'items' => array_slice(array_column($gone, 'line'), 0, 12),
            'n'     => count($gone),
            'read'  => false,
        ]);
    }

    if (($added || $gone || $first || $missKey !== $wasKey)
        && !xs_write_json(xs_seen_path(), ['at' => date('c'), 'games' => $now + array_intersect_key($was, $yours),
                                           'missingKey' => $missKey], $why)) {
        $out['warning'] = 'could not remember the library this time: ' . $why;
    }
    xs_log('NEWS', 'check: ' . count($added) . ' added, ' . count($gone) . ' gone, '
        . count($missing) . ' files missing of ' . $swept . ' swept in ' . $sweepMs . 'ms'
        . ($first ? ' (first look: nothing announced)' : ''));
    return $out;
}

// ---- trouble: what went wrong by itself ------------------------------------
/*
 * A launch that failed, a background job that stopped, a file of yours that
 * will not read. The strip at the bottom says each once, when it happens,
 * and never again; this is where it is kept.
 *
 *     data\messages.json       the message: level "error", and a key
 *     data\trouble-said.json   { key: stamp } what has been said already
 *
 * One message per thing (a game, a job, a file), replaced rather than said
 * again. What was said is remembered apart from the mailbox, so a message
 * you delete is not written again by the next look.
 */

function xs_trouble_said_path(): string { return xs_data_path('trouble-said.json'); }

/** The key a failed launch is kept under: its game, or its title when the launcher had no id. */
function xs_trouble_launch_key(array $err): string
{
    $id = (string) ($err['gameId'] ?? '');
    return 'launch:' . ($id !== '' ? $id : (string) ($err['title'] ?? '?'));
}

/** How old trouble may be and still be news: older is noted as said, with no message. */
const XS_TROUBLE_NEWS_DAYS = 3;

/**
 * Keep one piece of trouble. $stamp names the occurrence: the same one is
 * kept once. True when a message was written.
 */
function xs_messages_trouble(string $key, string $stamp, array $msg): bool
{
    $said = xs_read_json(xs_trouble_said_path(), []);
    $said = is_array($said) ? $said : [];
    if ($stamp === '' || (string) ($said[$key] ?? '') === $stamp) {
        return false;
    }
    // Found long after it happened: not news any more, and not looked at again.
    if (($msg['kind'] ?? '') !== 'damaged' && strtotime((string) ($msg['at'] ?? '')) < time() - XS_TROUBLE_NEWS_DAYS * 86400) {
        unset($said[$key]);
        $said[$key] = $stamp;
        xs_write_json(xs_trouble_said_path(), array_slice($said, -300, null, true));
        return false;
    }
    $all = xs_messages();
    $times = 1;
    foreach ($all as $i => $m) {
        if ((string) ($m['key'] ?? '') === $key) {
            $times = (int) ($m['times'] ?? 1) + 1;
            unset($all[$i]);
        }
    }
    $row = $msg + ['id' => 'msg-' . bin2hex(random_bytes(6)), 'at' => date('c')];
    $row['level'] = 'error';
    $row['key']   = $key;
    $row['stamp'] = $stamp;
    $row['times'] = $times;
    $row['read']  = false;
    array_unshift($all, $row);
    if (!xs_write_json(xs_messages_path(), array_slice(array_values($all), 0, XS_MESSAGES_KEPT))) {
        return false;
    }
    unset($said[$key]);
    $said[$key] = $stamp;
    xs_write_json(xs_trouble_said_path(), array_slice($said, -300, null, true));
    xs_log('NEWS', 'kept in the mailbox: ' . (string) ($row['title'] ?? $key) . ($times > 1 ? ' (' . $times . ' times now)' : ''));
    return true;
}

/** Mark the message kept under $key read. True when there was an unread one. */
function xs_messages_read_key(string $key): bool
{
    $all = xs_messages();
    $hit = false;
    foreach ($all as $i => $m) {
        if ((string) ($m['key'] ?? '') === $key && empty($m['read'])) {
            $all[$i]['read'] = true;
            $hit = true;
        }
    }
    return $hit && xs_write_json(xs_messages_path(), $all);
}

/** A time as the launcher or a worker wrote it, as the mailbox keeps times. */
function xs_trouble_when($at): string
{
    $t = is_int($at) ? $at : (is_string($at) ? strtotime($at) : false);
    return date('c', $t !== false && $t > 0 ? $t : time());
}

/**
 * Look for trouble that happened by itself and keep it. Asked on the main
 * server's own poll and whenever the mailbox is read; the fast lane never
 * writes, so it never looks. Answers how many pieces were new.
 */
function xs_trouble_sweep(): int
{
    if (xs_fast_lane()) {
        return 0;
    }
    $new = 0;

    // A launch that failed: bin\launch.ps1 leaves this until the next launch.
    $err = xs_read_json(xs_data_path('last-error.json'), null);
    if (is_array($err) && (string) ($err['at'] ?? '') !== '') {
        $platform = (string) ($err['platform'] ?? '');
        $new += (int) xs_messages_trouble(xs_trouble_launch_key($err), (string) $err['at'], [
            'kind'   => 'launch',
            'at'     => xs_trouble_when($err['at']),
            'title'  => (string) ($err['title'] ?? 'A game') . ' did not start',
            'body'   => ($platform !== '' ? $platform . ': ' : '') . (string) ($err['error'] ?? 'no reason was given'),
            'gameId' => (string) ($err['gameId'] ?? ''),
        ]);
    }

    // The background jobs, each as its file was left: [file, what it is, kind].
    $jobs = [
        ['fill-job.json',         'Get Pictures',                 'fill'],
        ['setup-job.json',        'A download',                   'setup'],
        ['steamvid-job.json',     'The Steam trailers fetch',     'steamvid'],
        ['screenscraper-job.json', 'The ScreenScraper videos fetch', 'screenscraper'],
    ];
    foreach ($jobs as [$file, $what, $kind]) {
        $path = xs_data_path($file);
        $job = is_file($path) ? xs_read_json($path, null) : null;
        if (!is_array($job) || ($job['state'] ?? '') !== 'failed') {
            continue;
        }
        // Set it all up tries a stopped pass once more by itself: no trouble yet.
        if ($kind === 'fill') {
            require_once __DIR__ . '/fill.php';
            if (xs_fill_again($job)) {
                continue;
            }
        }
        if ($kind === 'setup') {
            $what = ($job['kind'] ?? '') === 'cores' ? 'The cores download' : 'The RetroArch download';
        }
        // One run fails once: its start names it, whatever is written to the file after.
        $ended = (int) ($job['finished'] ?? 0) ?: (int) @filemtime($path);
        $new += (int) xs_messages_trouble('job:' . $kind, (string) ((int) ($job['started'] ?? 0) ?: $ended), [
            'kind'  => 'job',
            'at'    => xs_trouble_when($ended),
            'title' => $what . ' stopped before it finished',
            'body'  => (string) ($job['error'] ?? 'No reason was written down.'),
        ]);
    }

    // A Runs check that stopped itself says why; one you stopped has no why.
    $rcPath = xs_data_path('runcheck') . DIRECTORY_SEPARATOR . 'status.json';
    $rc = is_file($rcPath) ? xs_read_json($rcPath, null) : null;
    if (is_array($rc) && empty($rc['running']) && !empty($rc['stopped']) && (string) ($rc['why'] ?? '') !== '') {
        $new += (int) xs_messages_trouble('job:runcheck', (string) ($rc['endedAt'] ?? $rc['startedAt'] ?? ''), [
            'kind'  => 'job',
            'at'    => xs_trouble_when($rc['endedAt'] ?? null),
            'title' => 'The Runs check stopped before it finished',
            'body'  => (string) $rc['why'],
        ]);
    }

    // A file of yours that will not read (includes\boot.php).
    foreach (xs_damaged() as $d) {
        $new += (int) xs_messages_trouble('damaged:' . $d['file'], (string) ($d['at'] !== '' ? $d['at'] : 'damaged'), [
            'kind'  => 'damaged',
            'at'    => xs_trouble_when($d['at']),
            'title' => $d['file'] . ' will not read',
            'body'  => (string) $d['message'],
        ]);
    }

    // A fault inside Xsegon that cost a press its answer (includes\boot.php leaves the last one), one message
    // a place in the code. Read plainly: a note caught half written is taken at the next look.
    $raw   = @file_get_contents(xs_data_path('last-fault.json'));
    $fault = is_string($raw) ? json_decode($raw, true) : null;
    if (is_array($fault) && (string) ($fault['at'] ?? '') !== '') {
        $where = (string) ($fault['where'] ?? '?');
        $new += (int) xs_messages_trouble('fault:' . $where, (string) $fault['at'], [
            'kind'  => 'fault',
            'at'    => xs_trouble_when($fault['at']),
            'title' => 'Something went wrong inside Xsegon',
            'body'  => 'While ' . (string) ($fault['during'] ?? 'answering a request') . ': ' . (string) ($fault['what'] ?? 'no reason was written down')
                     . ' (' . $where . '). What was asked for got no answer. Help > Report a problem sends the details.',
        ]);
    }

    // A game that has started fine since its failure was kept: that failure is read.
    $waiting = [];
    foreach (xs_messages() as $m) {
        if (($m['kind'] ?? '') === 'launch' && empty($m['read']) && (string) ($m['gameId'] ?? '') !== '') {
            $waiting[(string) $m['gameId']] = (int) strtotime((string) ($m['stamp'] ?? ''));
        }
    }
    if ($waiting) {
        $launches = xs_read_json(xs_data_path('launch-results.json'), []);
        foreach ($waiting as $id => $failedAt) {
            $l = is_array($launches) ? ($launches[$id] ?? null) : null;
            if (is_array($l) && !empty($l['ok']) && (int) strtotime((string) ($l['at'] ?? '')) > $failedAt) {
                xs_messages_read_key('launch:' . $id);
            }
        }
    }
    return $new;
}
