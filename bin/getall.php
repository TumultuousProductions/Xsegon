<?php
/**
 * Get everything missing's wait (includes\getall.php): started when the ScreenScraper pass fills what
 * the free sources leave. It looks every two seconds until they are through, then reads the library
 * as they left it and starts the pass. Stop ends it with nothing asked of ScreenScraper.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/getall.php';

ignore_user_abort(true);
set_time_limit(0);

$job = xs_read_json(xs_ga_job_path(), null);
if (!is_array($job) || ($job['ss']['state'] ?? '') !== 'waiting') {
    exit(0);
}
$job['pid']    = getmypid();
$job['handed'] = time();
xs_write_json(xs_ga_job_path(), $job);
$wait = (array) ($job['ss']['waitOn'] ?? []);
xs_log('GALL', 'waiting for ' . implode(', ', $wait) . ' to be through, then ScreenScraper');

while (true) {
    if (is_file(xs_ga_stop_path())) {
        exit(0);                       // xs_ga_stop wrote the ending's words
    }
    $left = array_values(array_filter($wait, static fn ($k) => xs_ga_running((string) $k)));
    if (!$left) {
        break;
    }
    @touch(xs_ga_job_path());          // alive, so the corner does not take the wait for dead
    sleep(2);
}

// Read only now: this process has looked at no library yet, so it sees what the free sources added.
$got = xs_ga_ss(xs_settings(), xs_library(), (array) $job['ss']['kinds'], (array) $job['ways']);
$job = xs_read_json(xs_ga_job_path(), $job);
if (!is_array($job) || ($job['ss']['state'] ?? '') !== 'waiting') {
    exit(0);
}
$job['ss'] = $got + $job['ss'];
xs_write_json(xs_ga_job_path(), $job);
xs_log('GALL', 'the free sources are through; ScreenScraper: ' . $got['state'] . ($got['said'] !== '' ? ' (' . $got['said'] . ')' : ', ' . $got['games'] . ' games'));
