<?php
/**
 * GET  /api/newgames.php                the look for new games: at work or the last
 *                                       one, and whether it is switched on.
 * POST /api/newgames.php {"start": why}  one look, in the background (bin\newgames.php).
 *                                       A refusal is no fault: started false, with why.
 *
 * Asked by js\newgames.js at the page's start and when its window comes back to
 * the front. The guardrails are the server's (includes\newgames.php).
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/newgames.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $why = (string) (xs_body()['start'] ?? '');
    if (!in_array($why, ['start', 'back', 'again', 'test'], true)) {
        xs_fail('start must say why: start, back or again', 400);
    }
    if (!xs_ng_start($why, $no)) {
        // Said once a minute at most: the page asks no more often than that.
        xs_log('NEWG', 'no look (' . $why . '): ' . $no);
        xs_json(['ok' => true, 'started' => false, 'no' => $no]);
    }
    xs_log('NEWG', 'looking for new games (' . $why . ')');
    xs_json(['ok' => true, 'started' => true]);
}

$job = xs_ng_job();
if (($job['state'] ?? '') === 'running' && !xs_ng_busy($job)) {
    $job['state'] = 'failed';
    $job['error'] = 'its worker is gone';
}
xs_json(['ok' => true, 'on' => xs_ng_on(), 'job' => $job]);
