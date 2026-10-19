<?php
/**
 * GET /api/running.php - the light status poll.
 *
 * The page asks every few seconds whether a game is running, what the last
 * launch said, and whether a file of yours will not read: only what changes
 * moment to moment. The full status (api/status.php) is far heavier, and is
 * asked on load, on focus, after a game and once a minute.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/boot.php';
require_once __DIR__ . '/../includes/fastlane.php';
require_once __DIR__ . '/../includes/jobs.php';      // xs_jobs_any: a look at five small files, nothing else loaded

xs_heartbeat();

/* A Fill in pass at work, or just ended: a few numbers, so a page opened or
   reloaded meanwhile brings its bar up (js\fillbar.js, which then asks
   api\fill.php for itself). One small file, read only when it is there. */
$fill = null;
$fillJob = xs_data_path('fill-job.json');
if (is_file($fillJob)) {
    $fj = xs_read_json($fillJob, null);
    if (is_array($fj) && (($fj['state'] ?? '') === 'running' || time() - (int) ($fj['finished'] ?? 0) < 120)) {
        $fill = ['state' => (string) ($fj['state'] ?? ''), 'mode' => (string) ($fj['mode'] ?? ''), 'started' => (int) ($fj['started'] ?? 0)];
    }
}

/* The Runs check at work, or ended in the last two minutes: the corner bar
   (js\runsbar.js). A status not written for two minutes is a runner that
   died, which api\runcheck.php says in the log; no bar for it. */
$runs = null;
$rcFile = xs_data_path('runcheck') . DIRECTORY_SEPARATOR . 'status.json';
if (is_file($rcFile) && time() - (int) @filemtime($rcFile) < 120) {
    $rc = xs_read_json($rcFile, null);
    if (is_array($rc)) {
        $runs = ['running' => !empty($rc['running']) || !empty($rc['starting']), 'index' => (int) ($rc['index'] ?? 0),
                 'total' => (int) ($rc['total'] ?? 0), 'title' => (string) (($rc['current'] ?? [])['title'] ?? ''),
                 'counts' => $rc['counts'] ?? null, 'stopped' => !empty($rc['stopped']), 'why' => $rc['why'] ?? null,
                 'startedAt' => (string) ($rc['startedAt'] ?? ''), 'endedAt' => $rc['endedAt'] ?? null,
                 // Stepped aside for a game of yours (bin\runcheck.ps1 Wait-Pause).
                 'paused' => !empty($rc['paused']), 'pausedFor' => (string) ($rc['pausedFor'] ?? '')];
    }
}

$running = xs_game_running();

/* The Runs check the one yes owes (includes\setup.php xs_setup_runs_want):
   "ready" once the downloads and the pictures are done and nothing plays;
   the page then asks api\runcheck.php for it. Raw reads: a finished
   download is applied by whoever asks the setup API, not here. */
$autoRuns = null;
$asked = xs_read_json(xs_data_path('setup.json'), []);
/* A setting-up run under way, or just over: the page brings its list up
   (js\setuplist.js, which then asks api\setup.php for itself). */
$run = is_array($asked) && is_array($asked['run'] ?? null) ? $asked['run'] : null;
$runOn = $run !== null && (empty($run['ended']) || time() - (int) $run['ended'] <= 30);
if (is_array($asked) && !empty($asked['auto']) && !empty($asked['runsWanted'])) {
    $sj = xs_read_json(xs_data_path('setup-job.json'), null);
    // A pictures pass that stopped is tried once more before the check
    // (includes\setup.php xs_setup_run_view): the check stays last.
    $again = $run !== null && empty($run['ended']) && empty($run['fillRetried']) && is_array($fj ?? null)
        && ($fj['state'] ?? '') === 'failed' && ($fj['mode'] ?? '') !== 'look'
        && (int) ($fj['started'] ?? 0) >= (int) ($run['started'] ?? 0) - 5;
    // RetroArch just arrived and nobody has asked the setup API yet: its cores
    // are still to be started, so the check is not due.
    $landing = is_array($sj) && ($sj['kind'] ?? '') === 'retroarch' && ($sj['state'] ?? '') === 'done' && empty($sj['applied']);
    // Videos and cheat lists the answer asked for come first too. A fetch not written for two minutes is one that died.
    $atWork = static function (string $file): bool {
        $p = xs_data_path($file);
        if (!is_file($p) || time() - (int) @filemtime($p) >= 120) {
            return false;
        }
        $j = xs_read_json($p, null);
        return is_array($j) && ($j['state'] ?? '') === 'running';
    };
    $busy = (is_array($sj) && ($sj['state'] ?? '') === 'running') || $landing
        || (is_array($fj ?? null) && ($fj['state'] ?? '') === 'running') || $again
        || $running !== null || ($runs !== null && $runs['running'])
        || !empty($asked['videosWanted']) || $atWork('archivevid-job.json') || $atWork('cheatlists-job.json');
    $autoRuns = $busy ? 'waiting' : 'ready';
}

xs_json([
    'ok'      => true,
    'light'   => true,
    'app'     => 'xsegon',      // start.ps1 asks whether the port's holder is Xsegon
    'running' => $running,
    'error'   => xs_read_json(xs_data_path('last-error.json'), null),
    'damaged' => xs_damaged(),
] + ($fill !== null ? ['fill' => $fill] : []) + ($runs !== null ? ['runs' => $runs] : [])
  + ($autoRuns !== null ? ['autoRuns' => $autoRuns] : []) + ($runOn ? ['setupRun' => true] : [])
  + (xs_jobs_any() ? ['jobs' => true] : [])       // another background job at work or just ended: js\jobbars.js asks api\jobs.php for itself
  + (xs_fast_lane() ? ['mainUp' => xs_main_server_up(), 'mainBusy' => xs_main_busy()] : []));
