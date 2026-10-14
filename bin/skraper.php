<?php
/**
 * Xsegon - the Skraper helper's runner (includes\skraper.php): one step of
 * the staging script, run in the background for the ScreenScraper videos
 * window.
 *
 *   php bin\skraper.php --server=http://127.0.0.1:8099
 *
 * The step is in data\skraper-job.json. The script's own words go back into
 * the job for the window to show, and after a finished build Skraper itself
 * is opened for the person to press Start in (never on a test copy).
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/skraper.php';

set_time_limit(0);
$server = '';
foreach ($argv as $a) {
    if (str_starts_with($a, '--server=')) {
        $server = rtrim(substr($a, 9), '/');
    }
}

$job = xs_read_json(xs_skr_job_path(), null);
if (!is_array($job) || ($job['state'] ?? '') !== 'running' || !empty($job['pid'])) {
    fwrite(STDERR, "no step waiting in data\\skraper-job.json\n");
    exit(1);
}
$job['pid'] = getmypid();
$save = static function () use (&$job): void {
    $job['beat'] = time();
    xs_write_json(xs_skr_job_path(), $job);
};
$save();
register_shutdown_function(static function () use (&$job, $save): void {
    if (($job['state'] ?? '') === 'running') {
        $job['state'] = 'failed';
        $job['error'] = 'the step stopped on a fault: the log has it';
        $save();
    }
});

$mode = (string) ($job['mode'] ?? '');
$node = xs_skr_node();
if ($node === '' || xs_skr_script() === '') {
    $job['state'] = 'failed';
    $job['error'] = $node === '' ? 'Node.js was not found on this PC, and the helper is a Node script' : 'the helper script is gone';
    $save();
    exit(0);
}

$out = tempnam(sys_get_temp_dir(), 'xs-skr');
$err = $out . '.err';
$env = getenv();
$env['XSEGON_URL'] = $server;
$t0 = microtime(true);
$p = @proc_open([$node, xs_skr_script(), $mode], [1 => ['file', $out, 'w'], 2 => ['file', $err, 'w']],
    $pipes, xs_skr_dir(), $env, ['bypass_shell' => true]);
if (!is_resource($p)) {
    $job['state'] = 'failed';
    $job['error'] = 'the helper script would not start';
    $save();
    exit(0);
}
$code = null;
for ($tick = 0; ; $tick++) {
    $st = proc_get_status($p);
    if (!$st['running']) {
        $code = (int) $st['exitcode'];
        break;
    }
    if ($tick % 4 === 3) {
        clearstatcache();
        $job['said'] = trim((string) @file_get_contents($out));
        $save();
    }
    usleep(250000);
}
proc_close($p);
$said = trim(trim((string) @file_get_contents($out)) . "\n" . trim((string) @file_get_contents($err)));
@unlink($out);
@unlink($err);

$job['said'] = mb_substr(mb_scrub($said, 'UTF-8'), -20000);
if ($code === 0) {
    $job['state'] = 'done';
    // A go that had nothing left to ask Skraper for staged nothing, and opens nothing.
    $job['staged'] = in_array($mode, ['build', 'retry'], true) && str_contains($job['said'], 'stand-ins for');
    if ($job['staged']) {
        // Skraper itself, for the person to press Start in.
        $job['opened'] = xs_skr_open_ui($why);
        $job['openNote'] = $why;
    }
} else {
    $job['state'] = 'failed';
    $lines = preg_split('/\r?\n/', $job['said']) ?: [];
    $job['error'] = trim((string) end($lines)) !== '' ? trim((string) end($lines)) : 'the step ended with code ' . $code;
}
$job['finished'] = time();
$save();
xs_log('SKRP', $mode . ': ' . $job['state'] . ($code !== 0 ? ' (' . ($job['error'] ?? '') . ')' : '')
    . (isset($job['opened']) ? ($job['opened'] ? ', Skraper opened' : ', Skraper not opened: ' . ($job['openNote'] ?? '')) : '')
    . ', in ' . round(microtime(true) - $t0, 1) . 's');
