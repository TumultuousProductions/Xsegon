<?php
/**
 * Xsegon - Fill in scanned games: what the endpoint (api\fill.php,
 * includes\fill-libretro.php) and the background worker (bin\fill.php) share.
 *
 * The main server answers one request at a time, so the pass is a job
 * (data\fill-job.json) run by a worker of its own:
 *
 *     prepare   unpack the Games Database, when it has not been yet
 *     look      what each scanned game is (modes "look" and "all")
 *     first     each game's name and details, and its box
 *     rest      the logo, the screenshot and the background
 *
 * The worker stores pictures in data\art itself but never writes overrides.json: it POSTs
 * names and details to the main server, so that file keeps one writer and an edit made
 * during a fill is not lost. It writes the mailbox once, as a pass ends (xs_fill_tell).
 *
 * A guess, or two games matching one entry under different names, is for a person to
 * check (xs_fill_sort) and is never filled by Fill in all or Select all.
 */
declare(strict_types=1);

require_once __DIR__ . '/import.php';
require_once __DIR__ . '/gamesdb.php';

const XS_FILL_SLOTS = ['box', 'logo', 'shot', 'fanart'];

function xs_fill_job_path(): string
{
    return xs_data_path('fill-job.json');
}

/** What the last look found, a row a game: kept beside the job, which stays small. */
function xs_fill_rows_path(): string
{
    return xs_data_path('fill-look.json');
}

/** Touched to stop a run: the worker looks before each game. */
function xs_fill_stop_path(): string
{
    return xs_data_path('fill-stop');
}

/** The games a pass is about. */
function xs_fill_scope(array $games, string $scope = 'scanned'): array
{
    $rows = [];
    foreach ($games as $g) {
        $in = $scope === 'unmatched'
            ? (empty($g['local']) && empty($g['scanned']) && (int) ($g['dbId'] ?? 0) === 0)
            : !empty($g['scanned']);
        if ($in) {
            $rows[] = $g;
        }
    }
    return $rows;
}

/**
 * Each of these games with the Games Database's best guess for it, as the
 * screen reads them. Null with $err when the reader does not answer.
 */
function xs_fill_rows_gamesdb(array $rows, ?string &$err = null): ?array
{
    $err = null;
    $asks = [];
    foreach ($rows as $g) {
        $asks[] = ['id' => $g['id'], 'platform' => $g['platform'], 'title' => $g['title']];
    }
    $m = xs_gamesdb_matchmany($asks);
    if (empty($m['ok'])) {
        $err = (string) ($m['error'] ?? 'the database did not answer');
        return null;
    }
    $out = [];
    foreach ($rows as $g) {
        $match = $m['results'][$g['id']] ?? ['best' => null, 'confidence' => 'none', 'candidates' => []];
        $dbId  = (int) ($g['dbId'] ?? 0);
        // A match chosen by hand outranks the guess; the guess is still sent beside it.
        if ($dbId > 0) {
            $match['confidence'] = 'linked';
        }
        $art = [];
        foreach (array_keys(xs_own_art_kinds()) as $k) {
            $art[$k] = ($g['art'][$k] ?? null) !== null;
        }
        $empty = [];
        foreach (['developer', 'publisher', 'genre', 'released', 'rating', 'notes'] as $f) {
            if ((string) ($g[$f] ?? '') === '' || ($f === 'rating' && (float) $g[$f] === 0.0)) {
                $empty[] = $f;
            }
        }
        $out[] = [
            'id' => $g['id'], 'title' => $g['title'], 'platform' => $g['platform'],
            'dbId' => $dbId, 'edited' => $g['edited'] ?? [], 'art' => $art, 'empty' => $empty,
            'match' => $match, 'was' => xs_fill_first_title($g),
        ];
    }
    return $out;
}

/**
 * The same, asked of libretro's lists (includes\libretro.php). $offline
 * comes back true when a list a game needed could not be fetched.
 */
function xs_fill_rows_libretro(array $rows, ?bool &$offline = null): array
{
    require_once __DIR__ . '/libretro.php';
    static $indexes = [], $tables = [];
    $offline = false;
    $all = xs_overrides();
    $out = [];
    foreach ($rows as $g) {
        $linked = (string) ($all[$g['id']]['lrName'] ?? '');
        $sys = xs_lr_system((string) $g['platform']);
        $match = ['best' => null, 'confidence' => 'none', 'candidates' => []];
        if ($sys !== null) {
            if (!array_key_exists($sys, $indexes)) {
                $indexes[$sys] = xs_lr_index($sys, $why);
            }
            $idx = $indexes[$sys];
            if ($idx === null) {
                $offline = true;
            } else {
                $tables[$sys] ??= xs_lr_tables(xs_lr_names($idx));
                $m = $linked !== '' ? ['name' => $linked, 'confidence' => 'linked'] : xs_lr_match($g, $tables[$sys]);
                if ($m['name'] !== null) {
                    $match = ['best' => ['id' => $m['name'], 'title' => xs_lr_display($m['name']), 'platform' => $g['platform']],
                              'confidence' => $m['confidence'], 'candidates' => []];
                }
            }
        }
        $art = [];
        foreach (array_keys(xs_own_art_kinds()) as $k) {
            $art[$k] = ($g['art'][$k] ?? null) !== null;
        }
        $out[] = ['id' => $g['id'], 'title' => $g['title'], 'platform' => $g['platform'],
                  'dbId' => $linked, 'edited' => $g['edited'] ?? [], 'art' => $art, 'empty' => [], 'match' => $match,
                  'was' => xs_fill_first_title($g)];
    }
    return $out;
}

/** A match a pass takes with no person asked: sure, or likely only because the console has several games of that very name. */
function xs_fill_takes_itself(array $match): bool
{
    $conf = (string) ($match['confidence'] ?? '');
    return $conf === 'sure' || ($conf === 'likely' && !empty($match['sameName']));
}

/** How many of these rows a pass fills by itself: those it takes itself, and those linked. */
function xs_fill_sure(array $rows): int
{
    $n = 0;
    foreach ($rows as $r) {
        if (($r['match']['confidence'] ?? '') === 'linked' || xs_fill_takes_itself($r['match'] ?? [])) {
            $n++;
        }
    }
    return $n;
}

/** The title a game had before a fill gave it another: the one its file gave it. */
function xs_fill_first_title(array $g): string
{
    return (string) ($g['source']['title'] ?? ($g['title'] ?? ''));
}

function xs_fill_same_name(string $a, string $b): bool
{
    return strtolower(trim($a)) === strtolower(trim($b));
}

/** A title that is only a console's name ("gb", "nes", "Sega 32X"): it says nothing of the game,
    and its words still find unrelated games ("gb" finds GB Genjin), so no guess is made from it. */
function xs_fill_console_title(string $title): bool
{
    require_once __DIR__ . '/scan.php';
    $t = trim($title);
    return $t !== '' && xs_scan_platform_for($t) !== null;
}

/**
 * Whose decision each row is. Every row gets a 'state':
 *
 *     ready   Xsegon is sure, or the console has several games of that very
 *             name (xs_fill_takes_itself), or the match was chosen before and
 *             its box never arrived: filled by Fill in all, selected on the screen
 *     check   for a person to look at, never filled unless selected by
 *             hand: 'why' is "guess" (the database's word was "maybe", or
 *             "likely" for a name that only starts the same)
 *             or "clash" (another of your games on that console matches the
 *             same entry under a different name; 'with' names them)
 *     none    nothing in the database with these words, or 'why' "console":
 *             the title is only a console's name, so no guess is offered
 *     done    chosen before, and it has its box
 *
 * Two files with the same name matching one entry are one game twice (regions, discs),
 * not a clash. Two different names are: filling both would give them one title.
 */
function xs_fill_sort(array $rows): array
{
    $bare = [];
    foreach ($rows as $i => &$r) {
        if (($r['match']['confidence'] ?? '') !== 'linked' && xs_fill_console_title((string) ($r['title'] ?? ''))) {
            $r['match'] = ['best' => null, 'confidence' => 'none', 'candidates' => []];
            $bare[$i] = (string) $r['title'];
        }
    }
    unset($r);
    if ($bare) {
        xs_log('FILL', 'no guess for ' . count($bare) . (count($bare) === 1 ? ' game' : ' games') . ' named only after a console: '
            . implode(', ', array_slice($bare, 0, 10)) . (count($bare) > 10 ? ' and ' . (count($bare) - 10) . ' more' : ''));
    }
    $by = [];
    foreach ($rows as $i => $r) {
        $to = (string) ($r['dbId'] ?: ($r['match']['best']['id'] ?? ''));
        if ($to !== '' && $to !== '0') {
            $by[$r['platform'] . "\n" . $to][] = $i;
        }
    }
    $clash = [];
    foreach ($by as $ids) {
        foreach ($ids as $i) {
            $others = [];
            foreach ($ids as $j) {
                if ($j !== $i && !xs_fill_same_name((string) $rows[$i]['was'], (string) $rows[$j]['was'])) {
                    $others[] = (string) $rows[$j]['title'];
                }
            }
            if ($others) {
                $clash[$i] = $others;
            }
        }
    }
    foreach ($rows as $i => &$r) {
        $conf = (string) ($r['match']['confidence'] ?? 'none');
        unset($r['why'], $r['with']);
        if ($conf === 'linked') {
            $r['state'] = !empty($r['art']['box']) ? 'done' : 'ready';
        } elseif (empty($r['match']['best'])) {
            $r['state'] = 'none';
            if (isset($bare[$i])) {
                $r['why'] = 'console';
            }
        } elseif (isset($clash[$i])) {
            $r['state'] = 'check';
            $r['why']   = 'clash';
            $r['with']  = $clash[$i];
        } elseif (xs_fill_takes_itself($r['match'])) {
            $r['state'] = 'ready';
        } else {
            $r['state'] = 'check';
            $r['why']   = 'guess';
        }
    }
    unset($r);
    return $rows;
}

/**
 * Another game on this console already matched to this entry under a different file
 * name, or null; a fill then keeps this title so the two stay apart. $links: [id => entry].
 */
function xs_fill_entry_taken(array $games, array $game, array $links, string $entry): ?string
{
    if ($entry === '' || $entry === '0') {
        return null;
    }
    $mine = xs_fill_first_title($game);
    foreach ($games as $o) {
        if ($o['id'] === $game['id'] || ($o['platform'] ?? '') !== ($game['platform'] ?? '')) {
            continue;
        }
        if ((string) ($links[$o['id']] ?? '') === $entry && !xs_fill_same_name(xs_fill_first_title($o), $mine)) {
            return (string) $o['title'];
        }
    }
    return null;
}

// ---- the job --------------------------------------------------------------

/** The job as the worker left it, or null when there has never been one. */
function xs_fill_job(): ?array
{
    $job = xs_read_json(xs_fill_job_path(), null);
    if (!is_array($job)) {
        return null;
    }
    // A worker that is gone stops the job counting as running. Read only: the fast lane
    // answers with this too, and it never writes.
    $dead = xs_job_dead($job, xs_fill_job_path());
    if ($dead !== null) {
        $job['state'] = 'failed';
        $job['error'] = 'Get Pictures stopped before it finished: ' . $dead . '. What it had filled is kept; start it again for the rest.';
        $job['finished'] = (int) @filemtime(xs_fill_job_path());
        $job['dead'] = true;             // not written down yet: api\fill.php does that
    }
    return $job;
}

/** Whether a pass is at work now. */
function xs_fill_running(): bool
{
    return (xs_fill_job()['state'] ?? '') === 'running';
}

/** Start a pass: the job written, the worker started and left. */
function xs_fill_start(array $job, ?string &$why = null): bool
{
    $why = null;
    @unlink(xs_fill_stop_path());
    $job = ['state' => 'running', 'phase' => 'starting', 'started' => time(), 'source' => xs_details_from()] + $job;
    if (!xs_write_json(xs_fill_job_path(), $job, $why)) {
        return false;
    }
    $port = (int) ($_SERVER['SERVER_PORT'] ?? 0);
    $cmd = [xs_php_exe(), '-d', 'display_errors=0', '-d', 'display_startup_errors=0',
            '-d', 'date.timezone=' . date_default_timezone_get()];
    /* The pictures come over https: openssl is loaded for this one process if php.ini
       leaves it off, and the server's certificates are passed, which php.ini alone lacks. */
    if (!extension_loaded('openssl') && is_file(xs_gamesdb_php_ext_dir() . DIRECTORY_SEPARATOR . 'php_openssl.dll')) {
        array_push($cmd, '-d', 'extension_dir=' . xs_gamesdb_php_ext_dir(), '-d', 'extension=openssl');
    }
    $pem = dirname(xs_php_exe()) . DIRECTORY_SEPARATOR . 'cacert.pem';
    foreach (['openssl.cafile', 'curl.cainfo'] as $ini) {
        $v = is_file($pem) ? $pem : xs_utf8_path(trim((string) ini_get($ini), '"'));
        if ($v !== '' && preg_match('//u', $v) === 1) {
            array_push($cmd, '-d', $ini . '=' . $v);
        }
    }
    $cmd[] = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'fill.php';
    $cmd[] = '--server=http://127.0.0.1:' . $port;
    $handle = @popen('start /B "" ' . implode(' ', array_map(static fn ($a) => '"' . $a . '"', $cmd)) . ' > NUL 2>&1', 'r');
    if ($handle === false) {
        $why = 'the Get Pictures worker could not be started';
        $job['state'] = 'failed';
        $job['error'] = $why;
        xs_write_json(xs_fill_job_path(), $job);
        xs_log('FILL', $why . ' (popen failed)');
        return false;
    }
    pclose($handle);
    return true;
}

/** The job in a few numbers for the bottom bar and the status poll: never the rows. */
function xs_fill_job_light(?array $job = null): ?array
{
    $job = $job ?? xs_fill_job();
    if ($job === null) {
        return null;
    }
    $out = [];
    foreach (['state', 'mode', 'phase', 'source', 'error'] as $k) {
        $out[$k] = (string) ($job[$k] ?? '');
    }
    foreach (['started', 'finished', 'looked', 'scanned', 'total', 'done', 'restDone', 'fields', 'pictures',
              'failed', 'left', 'check', 'none', 'picsFailed', 'againAt', 'againAll'] as $k) {
        $out[$k] = (int) ($job[$k] ?? 0);
    }
    // The pictures asked for twice that never came, by game and kind: a few, for the ending to name.
    $out['picsMissing'] = array_slice(array_values(array_filter((array) ($job['picsMissing'] ?? []), 'is_array')), 0, 20);
    $out['firstDone'] = !empty($job['firstDone']);
    $out['told'] = !empty($job['told']);         // the message for the games left to a person is in Messages
    $out['pics'] = !empty($job['pictures_wanted']);
    $out['dry'] = !empty($job['dry']);
    $out['again'] = xs_fill_again($job);
    return $out;
}

// ---- pictures that did not come, and games left to a person ------------------

/** Whether a picture that failed is asked for once more: not one whose name the source itself has wrong. */
function xs_fill_retry_wanted(string $got): bool
{
    return str_starts_with($got, 'failed') && !str_contains($got, 'not a Games Database picture name');
}

/**
 * Pictures that did not come, asked once more, one at a time, when the pass is in (a busy
 * line is often free by then). $asks: [[game, entry, kind]]; $fetch answers like the pass's
 * fetch. Returns came, dropped, missing ([['title', 'kind']]) and stopped.
 */
function xs_fill_retry(array $asks, callable $fetch, callable $stopped, ?callable $each = null): array
{
    $out = ['came' => 0, 'dropped' => 0, 'missing' => [], 'stopped' => false];
    foreach ($asks as $ask) {
        if ($stopped()) {
            $out['stopped'] = true;
            break;
        }
        $got = (string) $fetch($ask);
        if ($got === 'stored') {
            $out['came']++;
        } elseif (str_starts_with($got, 'failed')) {
            $out['missing'][] = ['title' => (string) ($ask[0]['title'] ?? ''), 'kind' => (string) ($ask[2] ?? '')];
        } else {
            $out['dropped']++;               // it has one now, was left empty on purpose, or its game has gone
        }
        if ($each !== null) {
            $each($ask, $got);
        }
    }
    return $out;
}

/**
 * One message for the games left to a person, opening them in Get Specific Pictures. A
 * changed list replaces it; the same list is never said twice; none left removes it.
 */
function xs_fill_tell(array $check): bool
{
    require_once __DIR__ . '/news.php';
    $key   = 'fill:check';
    $names = [];
    foreach ($check as $r) {
        $names[(string) ($r['id'] ?? '')] = (string) ($r['title'] ?? '') . ' (' . (string) ($r['platform'] ?? '') . ')';
    }
    unset($names['']);
    ksort($names);
    $ids   = array_map('strval', array_keys($names));
    $stamp = $ids ? sha1(implode("\n", $ids)) : '';
    $was   = xs_messages();
    $kept  = array_values(array_filter($was, static fn (array $m): bool => (string) ($m['key'] ?? '') !== $key));
    if (!$ids) {
        if (count($kept) !== count($was)) {
            xs_write_json(xs_messages_path(), $kept);
        }
        return false;
    }
    $said = xs_read_json(xs_trouble_said_path(), []);
    $said = is_array($said) ? $said : [];
    if ((string) ($said[$key] ?? '') === $stamp) {
        return false;                        // these very games were said before: once is enough
    }
    $n = count($ids);
    array_unshift($kept, [
        'id'    => 'msg-' . bin2hex(random_bytes(6)),
        'at'    => date('c'),
        'kind'  => 'tip',
        'key'   => $key,
        'stamp' => $stamp,
        'title' => $n === 1 ? '1 game has a likely match waiting for your yes' : $n . ' games have a likely match waiting for your yes',
        'body'  => 'Get Pictures filled in every game it was sure of. For ' . ($n === 1 ? 'this one' : 'these')
                 . ' it found a name that is close, or one name for two of your games, and left the choice to you. Nothing is changed until you say so.',
        'items' => array_slice(array_values($names), 0, 8),
        'n'     => $n,
        'ids'   => $ids,
        'opens' => ['fillcheck'],            // the page turns it into a button (js\news.js)
        'read'  => false,
    ]);
    if (!xs_write_json(xs_messages_path(), array_slice($kept, 0, XS_MESSAGES_KEPT))) {
        return false;
    }
    unset($said[$key]);
    $said[$key] = $stamp;
    xs_write_json(xs_trouble_said_path(), array_slice($said, -300, null, true));
    xs_log('FILL', 'a message names ' . $n . ($n === 1 ? ' game' : ' games') . ' with a likely match left for a person to check');
    return true;
}

/** Whether Messages holds the message for the games left to a person: written now, or still there from a pass before. */
function xs_fill_told(): bool
{
    require_once __DIR__ . '/news.php';
    foreach (xs_messages() as $m) {
        if ((string) ($m['key'] ?? '') === 'fill:check') {
            return true;
        }
    }
    return false;
}

/**
 * A pass that stopped under Set it all up is tried once more after the downloads
 * (xs_setup_run_view). True while that second go is owed, so the stop is not an ending.
 */
function xs_fill_again(?array $job): bool
{
    if (!is_array($job) || ($job['state'] ?? '') !== 'failed' || ($job['mode'] ?? '') === 'look') {
        return false;
    }
    $asked = xs_read_json(xs_data_path('setup.json'), []);
    $run = is_array($asked) && is_array($asked['run'] ?? null) ? $asked['run'] : null;
    return $run !== null && empty($run['ended']) && empty($run['fillRetried'])
        && (int) ($job['started'] ?? 0) >= (int) ($run['started'] ?? 0) - 5;
}
