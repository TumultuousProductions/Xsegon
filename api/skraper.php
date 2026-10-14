<?php
/**
 * /api/skraper.php - the Skraper helper on this PC (includes\skraper.php),
 * driven from the ScreenScraper videos window.
 *
 *   GET   whether the helper and Skraper are here, and the step at work or
 *         how the last one ended. On a PC without the helper: {here:false}.
 *   POST  {"mode":"stage","ids":[..]}   stage the picked games and open
 *         Skraper; {"mode":"check"} read what arrived; {"mode":"restore"}
 *         put Skraper's settings back. One step at a time.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/skraper.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    xs_json(['ok' => true] + xs_skr_status());
}

xs_local_origin_only();
if (!xs_skr_here()) {
    xs_fail('the Skraper helper is not on this PC', 404);
}
$body = xs_body();
$mode = (string) ($body['mode'] ?? '');
$mode = $mode === 'stage' ? 'build' : $mode;
if (!xs_skr_ask($mode, (array) ($body['ids'] ?? []), $why)) {
    xs_fail((string) $why, 409);
}
xs_json(['ok' => true] + xs_skr_status());
