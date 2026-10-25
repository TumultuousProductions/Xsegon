<?php
/**
 * /api/tumultuous.php - Tumultuous Productions' page (includes\tumultuous.php, js\tppage.js).
 *
 *   GET                                         the page's words and the games asked of
 *   POST {"tell": "<game id>", "on": true|false}   say when it is out, or stop
 *   POST {"open": "<what>"}                     one of the page's own addresses, in the default browser
 *                                               or email app: "mail", "watch:<game id>", "site:<game id>",
 *                                               "link:<n>" (xs_tp_url)
 *
 * An address is never taken from the request: it comes out of the shipped page.
 * A test copy opens nothing.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/tumultuous.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $page = xs_tp_page();
    if (!$page) {
        xs_fail('the page could not be read (includes\\tumultuous\\page.json)', 500);
    }
    xs_json(['ok' => true, 'page' => $page, 'tell' => xs_tp_tells()]);
}

xs_local_origin_only();
$body = xs_body();

if (isset($body['tell'])) {
    $why = xs_tp_tell_set((string) $body['tell'], ($body['on'] ?? false) === true);
    if ($why !== null) {
        xs_fail($why, 409);
    }
    xs_json(['ok' => true, 'tell' => xs_tp_tells()]);
}

$what = (string) ($body['open'] ?? '');
$url  = xs_tp_url($what);
if ($url === null) {
    xs_fail('no such address on the page', 404);
}
if (xs_test_copy() || !empty($body['dry'])) {
    xs_json(['ok' => true, 'url' => $url, 'dry' => true]);
}
// Linux has one way to open anything (includes\boot.php xs_open); Windows' is cmd's start.
if (function_exists('xs_open')) {
    $opened = xs_open($url);
} else {
    $handle = popen('start "" "' . str_replace('"', '', $url) . '"', 'r');
    $opened = $handle !== false;
    if ($handle !== false) {
        pclose($handle);
    }
}
if (!$opened) {
    xs_log('TP', 'could not open ' . $what);
    xs_fail('nothing on this PC opened it', 500);
}
xs_log('TP', 'opened ' . ($what === 'mail' ? 'an email to the page\'s address' : $what . ': ' . $url));
xs_json(['ok' => true, 'url' => $url]);
