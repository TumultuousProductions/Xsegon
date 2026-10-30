<?php
/**
 * /api/emusuggest.php - emulators for the consoles RetroArch does not play
 * (includes\emusuggest.php, js\emuhelp.js).
 *
 *   GET ?platform=<console>   what that console has: emulators named for it, none on purpose, RetroArch plays it
 *   GET                       every console with a named emulator, the ones named none, the ones RetroArch plays
 *   POST {"open": "<id>"}     that emulator's makers' page, in the default browser
 *
 * An address is never taken from the request: it comes out of the list.
 * A test copy opens nothing.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/emusuggest.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $platform = trim((string) ($_GET['platform'] ?? ''));
    xs_json(['ok' => true] + ($platform !== '' ? xs_emu_suggest_for($platform) : xs_emu_suggest_all()));
}

xs_local_origin_only();
$body = xs_body();
$id   = (string) ($body['open'] ?? '');
$url  = xs_emu_suggest_url($id);
if ($url === null) {
    xs_fail('no such emulator in the list', 404);
}
if (xs_test_copy() || !empty($body['dry'])) {
    xs_json(['ok' => true, 'url' => $url, 'dry' => true]);
}
// Linux has one way to open anything (includes\boot.php xs_open); Windows' is cmd's start.
if (function_exists('xs_open')) {
    $opened = xs_open($url);
} else {
    $handle = popen('start "" "' . $url . '"', 'r');
    $opened = $handle !== false;
    if ($handle !== false) {
        pclose($handle);
    }
}
if (!$opened) {
    xs_log('EMU', 'could not open the page of ' . $id);
    xs_fail('nothing on this PC opened it', 500);
}
xs_log('EMU', 'opened the makers\' page of ' . $id . ': ' . $url);
xs_json(['ok' => true, 'url' => $url]);
