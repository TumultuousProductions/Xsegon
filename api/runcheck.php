<?php
/**
 * The runs check (includes\runcheck.php, bin\runcheck.ps1).
 *
 * GET                               where it is, what it found, and per console
 *                                   how many games it can check
 * POST {"action":"start", "platform":"" | name, "skipDone":true, "wait":10}
 *                                   ("auto":true: the one yes asking, js\runsbar.js)
 * POST {"action":"stop"}            after the game it is on
 * POST {"action":"clear"}           forget every result and screenshot
 * POST {"action":"tag"}             tag every game that boots "runs"
 * POST {"action":"mark", "id":..., "ran":true|false}
 *                                   your answer for a game the check could
 *                                   not judge ("look at it")
 * POST {"action":"set", "id":..., "as":"runs"|"needsfix"|"forget"}
 *                                   a result's right-click
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/runcheck.php';
require_once __DIR__ . '/../includes/setup.php';
require_once __DIR__ . '/../includes/tags.php';
require_once __DIR__ . '/../includes/needsfix.php';

$s = xs_settings();

// The answer every call ends with: the state of things now.
/* A result's moment, as seconds. The runner writes .NET's seven fraction
   digits, which PHP's parser does not take, so it is cut to six. */
function xs_runcheck_when(string $at): float
{
    if (trim($at) === '') {
        return 0.0;                     // no moment at all: never "new" (the parser reads '' as now)
    }
    $at = preg_replace('/(\.\d{6})\d+/', '$1', $at) ?? $at;
    try {
        return (float) (new DateTimeImmutable($at))->format('U.u');
    } catch (Throwable $e) {
        return 0.0;
    }
}

function xs_runcheck_answer(array $s, array $extra = []): never
{
    /* ?since=<cursor>: only the results written after that moment, for the
       panel's asks while a check runs: the whole answer is too heavy for
       this one-request-at-a-time server every two seconds. "Written after",
       not "after game N": Rerun the failed rewrites results the panel has.
       Every button answers whole. */
    $since = (float) ($_GET['since'] ?? 0);
    $delta = $since > 0 && $extra === [];
    $cursor = 0.0;
    $games = [];
    $byId = null;
    if (!$delta) {
        $lib = xs_library();
        $games = $lib['games'] ?? [];
        $byId = [];
        foreach ($games as $g) {
            $byId[$g['id']] = true;
        }
    }
    $rows = [];
    $fix = $shown = null;                       // read once, on the first row that needs them
    foreach (xs_runcheck_results() as $id => $r) {
        if (!is_array($r)) {
            continue;
        }
        $when = xs_runcheck_when((string) ($r['at'] ?? ''));
        $cursor = max($cursor, $when);
        if ($delta ? $when <= $since : !isset($byId[$id])) {
            continue;                           // already sent, or a game no longer in the library
        }
        if ($shown === null) {
            $fix = xs_needs_fix();
            $shown = xs_tags_effective(xs_tags_read(), $fix);
        }
        $shot = xs_runcheck_dir('shots') . DIRECTORY_SEPARATOR . xs_runcheck_safe((string) $id) . '.png';
        $rows[] = [
            'id' => (string) $id, 'title' => (string) ($r['title'] ?? ''), 'platform' => (string) ($r['platform'] ?? ''),
            'result' => (string) ($r['result'] ?? ''), 'reason' => (string) ($r['reason'] ?? ''),
            'blank' => !empty($r['blank']), 'at' => (string) ($r['at'] ?? ''),
            'emu' => (string) ($r['emu'] ?? ''), 'byYou' => ($r['by'] ?? '') === 'you',
            // As every tag list shows them, and whether it wears NEEDS FIX, for the right-click.
            'tags' => $shown[$id] ?? [], 'needsFix' => isset($fix[$id]),
            'shot' => is_file($shot) ? 'files/runcheck/' . rawurlencode(basename($shot)) . '?v=' . (int) @filemtime($shot) : null,
        ];
    }
    usort($rows, static fn($a, $b) => strcasecmp($a['platform'], $b['platform']) ?: strcasecmp($a['title'], $b['title']));
    if ($delta) {
        xs_json(['ok' => true, 'delta' => true, 'status' => xs_runcheck_status(), 'results' => $rows, 'cursor' => $cursor]);
    }
    xs_json(['ok' => true, 'status' => xs_runcheck_status(), 'results' => $rows, 'cursor' => $cursor,
             'consoles' => xs_runcheck_consoles($games, $s), 'left' => xs_runcheck_left($games, $s)] + $extra);
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    xs_runcheck_answer($s);
}

$body = xs_body();
$action = (string) ($body['action'] ?? '');

if ($action === 'stop') {
    if (xs_runcheck_active()) {
        // Checked: a stop that could not be written means games KEEP starting
        // while the log says they were told to stop.
        if (@file_put_contents(xs_runcheck_dir('stop'), date('c')) === false) {
            xs_fail('the stop could not be written (' . xs_file_error_reason() . '), so the check is still going', 500);
        }
        xs_log('RCHK', 'stop asked for');
    }
    xs_runcheck_answer($s);
}

if (xs_runcheck_active()) {
    xs_fail('the runs check is still going: stop it first', 409);
}

if ($action === 'clear') {
    foreach (xs_glob(xs_runcheck_dir('shots'), '*.png') as $f) {
        @unlink($f);
    }
    @unlink(xs_runcheck_dir('results.json'));
    xs_log('RCHK', 'results cleared');
    xs_runcheck_answer($s);
}

if ($action === 'tag') {
    $tags = xs_tags_read();
    $inLib = [];
    foreach (xs_library()['games'] ?? [] as $g) {
        $inLib[$g['id']] = true;
    }
    $n = 0;
    foreach (xs_runcheck_results() as $id => $r) {
        if (!isset($inLib[$id])) {
            continue;                           // a result for a game no longer in the library
        }
        if (($r['result'] ?? '') !== 'boots' || !empty($r['blank'])) {
            continue;                           // a blank screen is for you to look at first
        }
        $list = $tags[$id] ?? [];
        if (!in_array('runs', $list, true)) {
            $list[] = 'runs';
            $tags[$id] = $list;
            $n++;
        }
    }
    $why = null;
    if ($n > 0 && !xs_tags_write($tags, $why)) {
        xs_fail('could not save the tags: ' . (string) $why, 500);
    }
    xs_log('RCHK', 'tagged ' . $n . ' game(s) runs');
    xs_runcheck_answer($s, ['tagged' => $n]);
}

/* Your answer for a game the check could not judge: "look at it" (xemu,
   and an emulator that stayed open without saying the game started).
   Kept as the result, marked as yours, so tagging and NEEDS FIX follow it. */
if ($action === 'mark') {
    $id = (string) ($body['id'] ?? '');
    $ran = $body['ran'] ?? null;
    $results = xs_runcheck_results();
    if ($id === '' || !is_bool($ran) || !is_array($results[$id] ?? null)) {
        xs_fail('say which checked game, and whether it ran (true or false)');
    }
    $results[$id]['result'] = $ran ? 'boots' : 'nostart';
    $results[$id]['reason'] = $ran ? 'you said it ran' : 'you said it did not start';
    $results[$id]['blank'] = false;
    $results[$id]['by'] = 'you';
    $results[$id]['at'] = date('c');
    xs_write_or_fail(xs_runcheck_dir('results.json'), $results, 'could not save that: ');
    xs_log('RCHK', ($results[$id]['title'] ?? $id) . ': marked by you as ' . ($ran ? 'it ran' : 'it did not start'));
    xs_runcheck_answer($s);
}

/* A result's right-click: your verdict, over the check's. runs: tagged
   "runs", NEEDS FIX off. needsfix: NEEDS FIX on until you take it off,
   "runs" off. forget: the result and its picture go, so it is checked again. */
if ($action === 'set') {
    $id = (string) ($body['id'] ?? '');
    $as = (string) ($body['as'] ?? '');
    $results = xs_runcheck_results();
    if ($id === '' || !is_array($results[$id] ?? null) || !in_array($as, ['runs', 'needsfix', 'forget'], true)) {
        xs_fail('say which checked game, and runs, needsfix or forget');
    }
    $title = (string) ($results[$id]['title'] ?? $id);
    $why = null;
    if ($as === 'forget') {
        unset($results[$id]);
        @unlink(xs_runcheck_dir('shots') . DIRECTORY_SEPARATOR . xs_runcheck_safe($id) . '.png');
    } else {
        $runs = $as === 'runs';
        $results[$id]['result'] = $runs ? 'boots' : 'nostart';
        $results[$id]['reason'] = $runs ? 'you said it runs' : XS_FIX_MINE;
        $results[$id]['blank'] = false;
        $results[$id]['by'] = 'you';
        $results[$id]['at'] = date('c');
        $tags = xs_tags_read();
        $list = array_values(array_filter($tags[$id] ?? [], static fn($t) => mb_strtolower($t) !== XS_TAG_RUNS));
        if ($runs) {
            $list[] = xs_tag_spelling($tags, XS_TAG_RUNS);
            usort($list, 'strnatcasecmp');
        }
        $tags[$id] = $list;
        if (!xs_tags_write($tags, $why) || !xs_fix_mark($id, !$runs, $why)) {
            xs_fail('could not save that: ' . (string) $why, 500);
        }
    }
    xs_write_or_fail(xs_runcheck_dir('results.json'), $results, 'could not save that: ');
    xs_log('RCHK', $title . ': ' . ['runs' => 'it runs (tagged runs)', 'needsfix' => 'needs fix (marked by you)', 'forget' => 'result forgotten'][$as]);
    xs_runcheck_answer($s);
}

if ($action !== 'start') {
    xs_fail('say start, stop, clear, tag, mark or set');
}

// ---- start ----------------------------------------------------------------
$busy = xs_game_running(true);
if ($busy !== null) {
    xs_fail(($busy['title'] ?? 'a game') . ' is running: quit it first, the check starts games of its own', 409);
}
/* Not while Getting started fetches RetroArch or its cores: a game whose core
   has not arrived would be marked as not starting. Asked before anything is
   read from the request, so a refusal never depends on what was sent. */
if (xs_setup_busy(xs_setup_job())) {
    xs_fail('Getting started is still downloading RetroArch or its cores. Start the check when that is done: '
        . 'a game whose core is still on its way would count as not starting.', 409);
}
/* "auto": asked by the page for the one yes (js\runsbar.js). Its flag is
   cleared once the check is under way or cannot be (no drive, nothing to
   check), never on a refusal that passes (a game, a download, above). */
$auto = !empty($body['auto']);
$platform = trim((string) ($body['platform'] ?? ''));
$skipDone = !array_key_exists('skipDone', $body) || !empty($body['skipDone']);
$only = ($body['only'] ?? '') === 'failed' ? 'failed' : '';
$wait = (int) ($body['wait'] ?? 10);
if ($wait < 3 || $wait > 60) {
    xs_fail('wait must be 3 to 60 seconds');
}

// With the ROM folder away nothing can start, and every game would be
// written down as "did not start". Refused, dry run or not.
$root = xs_norm_path((string) ($s['paths']['romRoot'] ?? ''));
if ($root !== '' && !is_dir($root)) {
    if ($auto) {
        xs_setup_runs_want(false);
        xs_setup_run_set(['runs' => 'nodrive']);
        xs_log('RCHK', 'set it all up could not start the check: ' . $root . ' is not there');
    }
    xs_json(['ok' => false, 'driveOff' => true,
             'error' => $root . ' is not there. Plug the ROM drive in first: with it unplugged no game can start, and the check would mark every one as failing.'], 409);
}

$games = xs_library()['games'] ?? [];
// The one yes checks RetroArch's games only: it never opens another emulator unasked.
$plan = xs_runcheck_plan($games, $s, $platform, $skipDone, $only, $auto);
$biosOut = [];
if ($auto) {
    // Nor a game a missing BIOS file would stop: a message names those instead.
    require_once __DIR__ . '/../includes/bioshelp.php';
    [$plan, $biosOut] = xs_bios_leave_out($plan);
    xs_bios_tell($biosOut);
    xs_setup_runs_want(false);
    // For the Setting up list: how the check it owed came out when no check ran.
    xs_setup_run_set(['runs' => !$plan ? ($biosOut ? 'bios' : 'none')
        : (!empty($body['dry']) || xs_test_copy() ? 'dry' : 'started'), 'runsGames' => count($plan)]);
    xs_log('RCHK', 'asked for by set it all up: ' . count($plan) . ' game(s)'
        . ($biosOut ? ', ' . array_sum(array_column($biosOut, 'games')) . ' left out for want of a BIOS file' : '')
        . (!empty($body['dry']) || xs_test_copy() ? ', a dry run on this copy: nothing started' : ''));
}
if (!$plan && $biosOut) {
    xs_json(['ok' => false, 'bios' => $biosOut, 'error' => 'every game left to check wants a BIOS file first'], 409);
}
if (!$plan) {
    xs_fail($only === 'failed' ? 'nothing failed there: there is nothing to run again'
        : ($skipDone ? 'nothing left to check there: every game has a result (deselect "skip" to check them again)'
                     : ($auto ? 'no RetroArch games to check there' : 'no games the check can run there')), 409);
}
$label = ($platform !== '' ? $platform : 'every console') . ($only === 'failed' ? ', the failed ones' : '');
$call = xs_ps_call(XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'runcheck.ps1', [
    'Plan' => xs_runcheck_dir('plan.json'), 'DataDir' => xs_data_dir(), 'Wait' => $wait, 'Log' => xs_log_enabled(),
]);
// "dry": the list and the command, and nothing written or started. Always,
// on the test run's own server: its plan is real games on the real emulator.
if (!empty($body['dry']) || xs_test_copy()) {
    xs_json(['ok' => true, 'dry' => true, 'games' => count($plan), 'plan' => $plan, 'command' => $call, 'bios' => $biosOut]);
}
if (xs_write_json(xs_runcheck_dir('plan.json'), ['label' => $label, 'games' => $plan]) === false) {
    xs_fail('could not write the list for the check', 500);
}

/* The play history, as it is now: the runner puts it back if anything in
   it differs at the end. The check itself never writes it; this is the
   promise kept even if something else does. */
$sessions = xs_data_path('sessions.jsonl');
$before = xs_runcheck_dir('sessions.before.jsonl');
$none = xs_runcheck_dir('sessions.none');
@unlink($before);
@unlink($none);
if (is_file($sessions)) {
    if (!@copy($sessions, $before)) {
        xs_fail('could not copy the play history first, so the check did not start', 500);
    }
} else {
    // Checked: without this marker the runner cannot know there was no play
    // history, and history the check itself caused would survive.
    if (@file_put_contents($none, date('c')) === false) {
        xs_fail('could not note the empty play history first (' . xs_file_error_reason() . '), so the check did not start', 500);
    }
}
@unlink(xs_runcheck_dir('stop'));
if (is_file(xs_runcheck_dir('stop'))) {
    // A stale stop that cannot be removed would end the new run after one
    // game with nothing saying why.
    xs_fail('an old stop file is stuck (' . xs_file_error_reason() . '), so a new check would stop at once; nothing was started', 500);
}

// A status written now, so the page sees it start before PowerShell is up.
xs_write_json(xs_runcheck_dir('status.json'), ['running' => false, 'starting' => true, 'total' => count($plan),
    'index' => 0, 'label' => $label, 'startedAt' => date('c')]);
if (!xs_spawn_ps($call, ['hidden' => true])) {
    xs_fail('could not start the check', 500);
}
xs_log('RCHK', 'start ' . count($plan) . ' game(s): ' . $label . ', ' . $wait . 's, ' . ($skipDone ? 'skipping the checked' : 'all again'));
xs_runcheck_answer($s, ['started' => count($plan), 'bios' => $biosOut]);
