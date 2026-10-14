<?php
/**
 * /api/screenscraper.php - video snaps from ScreenScraper (includes\screenscraper.php).
 *
 *   GET                         the account (names only), every game with no
 *                               video, and the job if there is one
 *   POST {"account": {...}}     save the logins, then ask ScreenScraper who that is
 *   POST {"check": true}        ask again with what is stored
 *                               (both, and a fetch, first ask the website for Xsegon's
 *                               own developer ID when none of the person's own is typed)
 *   POST {"forget": true}       delete the stored logins
 *   POST {"ids": [...]}         fetch snaps for these games, in the background
 *   POST {..., "dry": true}     the plan, nothing started
 *
 * A game that has a video from anywhere is never in a job, whatever the page
 * sends, and no answer from here ever carries a password.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/screenscraper.php';

$s   = xs_settings();
$lib = xs_library();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $rows = xs_ss_games($s, $lib);
    xs_json([
        'ok'      => true,
        'account' => xs_ss_account_public(),
        'games'   => $rows,
        'missing' => count(array_filter($rows, static fn ($r) => !$r['has'])),
        'dir'     => xs_ss_dir(),
        'job'     => xs_ss_job(),
    ]);
}

xs_local_origin_only();
$body = xs_body();

if (!empty($body['forget'])) {
    if (!xs_ss_account_forget()) {
        xs_fail('the stored logins could not be deleted', 500);
    }
    xs_log('SSCR', 'logins forgotten');
    xs_json(['ok' => true, 'account' => xs_ss_account_public()]);
}

if (is_array($body['account'] ?? null) || !empty($body['check'])) {
    if (is_array($body['account'] ?? null)) {
        if (!xs_ss_account_save($body['account'], $why)) {
            xs_fail((string) $why, 500);
        }
        xs_log('SSCR', 'logins saved');           // never what they are
    }
    $use   = xs_ss_account_in_use(true, $devWhy);
    $check = xs_ss_check($use, $devWhy);
    xs_log('SSCR', $check['ok']
        ? 'login accepted' . ($use['shared'] ? " with Xsegon's own developer ID" : '') . ': ' . $check['today'] . ' of ' . $check['max'] . ' requests used today'
        : 'login check: ' . $check['error']);
    xs_json(['ok' => true, 'account' => xs_ss_account_public(), 'check' => $check]);
}

$job = xs_ss_job();
if (is_array($job) && ($job['state'] ?? '') === 'running' && empty($body['dry'])) {
    xs_fail('snaps are already being fetched; that has to finish first', 409);
}
$use = xs_ss_account_in_use(true, $devWhy);
if ($use['user'] === '' || $use['password'] === '') {
    xs_fail('the ScreenScraper logins are not filled in yet', 409);
}
if (!xs_ss_ready($use)) {
    xs_fail((string) $devWhy, 409);
}
$want = array_flip(array_map('strval', (array) ($body['ids'] ?? [])));
$pick = array_values(array_filter(xs_ss_games($s, $lib),
    static fn ($r) => !$r['has'] && $r['system'] > 0 && isset($want[$r['id']])));
if (!$pick) {
    xs_fail('none of those is a game without a video on a console ScreenScraper knows', 409);
}
$src  = xs_ss_sources();
$plan = [
    'state'   => 'running',
    'started' => time(),
    'dir'     => xs_ss_dir(),
    'search'  => $src['search'],
    'rom'     => $src['rom'],
    'pause'   => $src['pause'],
    'games'   => array_map(static fn ($r) => ['id' => $r['id'], 'title' => $r['title'], 'platform' => $r['platform'],
                                              'system' => $r['system'], 'rom' => $r['rom'], 'state' => 'waiting'], $pick),
];
if (!empty($body['dry'])) {
    xs_json(['ok' => true, 'dry' => true, 'plan' => $plan]);
}
xs_write_or_fail(xs_ss_job_path(), $plan);
$script = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'screenscraper.ps1';
// The fetcher opens the kept copy of Xsegon's own developer ID itself; it is never on a command line.
$args = ['Job' => xs_ss_job_path(), 'Account' => xs_ss_account_path(), 'Shared' => $use['shared'] ? xs_ss_shared_path() : null];
if (!xs_spawn_ps(xs_ps_call($script, $args))) {
    xs_fail('the snap fetcher could not be started', 500);
}
xs_log('SSCR', 'fetch asked for ' . count($pick) . ' snaps');
xs_json(['ok' => true, 'started' => true, 'count' => count($pick)]);
