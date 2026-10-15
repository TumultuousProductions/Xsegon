<?php
/**
 * Xsegon - the worker that looks for new games and adds the ones it is sure of
 * (includes\newgames.php), run in the background.
 *
 *   php bin\newgames.php
 *
 * The plan is in data\newgames-job.json; what came and what was left goes back
 * into it for the page (js\newgames.js) to say.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/boot.php';
require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/newgames.php';

set_time_limit(0);

$job = xs_ng_job();
if (($job['state'] ?? '') !== 'running' || !empty($job['pid'])) {
    fwrite(STDERR, "nothing waiting in data\\newgames-job.json\n");
    exit(1);
}
$job['pid'] = getmypid();
$job['beat'] = time();
xs_write_json(xs_ng_job_path(), $job);
register_shutdown_function(static function () use (&$job): void {
    if (($job['state'] ?? '') === 'running') {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped on a fault: the log has it';
        $job['ended'] = time();
        xs_write_json(xs_ng_job_path(), $job);
        xs_log('NEWG', 'the look stopped on a fault');
    }
});
$end = static function (string $state, string $line) use (&$job): void {
    $job['state'] = $state;
    $job['ended'] = time();
    xs_write_json(xs_ng_job_path(), $job);
    xs_log('NEWG', $line);
    exit(0);
};

$t0 = microtime(true);
$found = xs_scan_walk();
$job['beat'] = time();
if (isset($found['error'])) {
    $job['error'] = (string) $found['error'];
    $end('failed', 'looked for new games (' . $job['why'] . '): ' . $job['error']);
}
[$add, $left, $fresh] = xs_ng_sort($found);
$many = count($add) > XS_NG_MOST ? count($add) : 0;
if ($many > 0) {
    // So many at once is a choice: a whole collection copied in, or the wrong folder.
    $add = [];
}
$added = 0;
$hacks = ['ask' => 0];
$auto = null;
if ($add) {
    $added = xs_scan_accept($add, $why, $skipped);
    if ($added === false) {
        $job['error'] = 'the games could not be added: ' . $why;
        $end('failed', 'looked for new games (' . $job['why'] . '): ' . $job['error']);
    }
    xs_log('SCAN', 'accepted ' . $added . ' of ' . count($add) . ' offered, by themselves'
        . ($skipped ? ' (' . count($skipped) . ' skipped: ' . $skipped[0]['why'] . ')' : ''));
    [$hacks, $auto] = xs_scan_after_accept($add, $added, true);
}
$unsure = xs_ng_unsure($found, $left);
$told = xs_ng_tell($unsure, $many);
$job['added'] = $added;
$job['titles'] = array_slice(array_column($add, 'title'), 0, 5);
$job['left'] = count($left);
$job['fresh'] = count($fresh);
$job['many'] = $many;
$job['told'] = $told ? count($unsure) : 0;
$job['hacks'] = (int) $hacks['ask'];
$job['fill'] = !empty($auto['fill']);
$end('done', 'looked for new games (' . $job['why'] . '): ' . $added . ' added, ' . count($left) . ' left for Scan for Games, '
    . count($fresh) . ' still arriving' . ($many ? ', ' . $many . ' at once left for Scan for Games' : '')
    . ($told ? ', ' . count($unsure) . ' named in the mailbox' : '') . ', in ' . (int) round((microtime(true) - $t0) * 1000) . 'ms');
