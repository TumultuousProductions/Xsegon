<?php
/**
 * /api/screenscraper.php - video snaps from ScreenScraper (includes\screenscraper.php).
 *
 *   GET                         the account (names only), every game with no
 *                               video and whether a fetch found none for it
 *                               before, and the job if there is one
 *   POST {"account": {...}}     save the logins, then ask ScreenScraper who that is
 *   POST {"check": true}        ask again with what is stored
 *                               (both, and a fetch, first ask the website for Xsegon's
 *                               own developer ID when none of the person's own is typed)
 *   POST {"forget": true}       delete the stored logins
 *   POST {"ids": [...]}         fetch snaps for these games, in the background
 *   POST {..., "manuals": true} and a manual for every game with none that the
 *                               Internet Archive's sets could not fill (xs_ss_manual_games)
 *   POST {..., "dry": true}     the plan, nothing started
 *
 * A game that has a video from anywhere is never in a job, whatever the page
 * sends, and no answer from here ever carries a password.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/screenscraper.php';
require_once __DIR__ . '/../includes/archivedoc.php';

$s   = xs_settings();
$lib = xs_library();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $job  = xs_ss_job();                // first: an ended fetch's games with no video are kept apart before the rows are read
    $rows = xs_ss_games($s, $lib);
    xs_json([
        'ok'      => true,
        'account' => xs_ss_account_public(),
        'games'   => $rows,
        'missing' => count(array_filter($rows, static fn ($r) => !$r['has'])),
        'dir'     => xs_ss_dir(),
        // The games a manual may be fetched for, and whether Manuals too is chosen (video.ssManuals).
        'manuals' => count(xs_ss_manual_games($lib)),
        'manualsOn' => !empty($s['video']['ssManuals']),
        'docs'    => xs_docs_dir(),
        'job'     => $job,
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
    $use   = xs_ss_account_in_use(true, $devWhy, is_array($body['account'] ?? null) ? 'save' : 'check');
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
// Only a real Fetch counts toward the website's daily limit; a dry plan asks as a check.
$use = xs_ss_account_in_use(true, $devWhy, empty($body['dry']) ? 'fetch' : 'check');
if ($use['user'] === '' || $use['password'] === '') {
    xs_fail('the ScreenScraper logins are not filled in yet', 409);
}
if (!xs_ss_ready($use)) {
    xs_fail((string) $devWhy, 409);
}
$games = xs_ss_plan_games($s, $lib, (array) ($body['ids'] ?? []), !empty($body['manuals']));
if (!$games) {
    xs_fail(empty($body['manuals']) ? 'none of those is a game without a video on a console ScreenScraper knows'
        : 'none of those is a game without a video, and no game is waiting for a manual, on a console ScreenScraper knows', 409);
}
$plan = xs_ss_plan($games, !empty($body['manuals']));
if (!empty($body['dry'])) {
    xs_json(['ok' => true, 'dry' => true, 'plan' => $plan]);
}
if (!xs_ss_start($plan, $use, $why)) {
    xs_fail((string) $why, 500);
}
$count = static fn (string $k): int => count(array_filter($games, static fn ($g) => $g[$k]));
xs_json(['ok' => true, 'started' => true, 'count' => $count('video'), 'manuals' => $count('manual')]);
