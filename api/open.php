<?php
/**
 * POST /api/open.php - put the Xsegon window on screen, fullscreen.
 *
 * For OTHER pages: a link can only open a tab, which cannot make itself
 * fullscreen (bin\open.ps1 has the how). An open window is brought to the
 * front rather than opened twice.
 *
 * Any web page can aim a POST at 127.0.0.1, so only a page served from this
 * machine gets a window. No Origin at all is curl or a local script, which
 * could start the browser anyway.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';

$origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
if ($origin !== '') {
    $host = strtolower((string) parse_url($origin, PHP_URL_HOST));
    if (!in_array($host, ['127.0.0.1', 'localhost', '[::1]', '::1'], true)) {
        xs_fail('only pages on this machine may open the app', 403);
    }
    // The caller is another origin (another port), so it needs this to read the answer.
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}

xs_post_only();

$script = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'open.ps1';
$port   = (int) ($_SERVER['SERVER_PORT'] ?? 8099);


// Never a window from the test server (xs_test_copy).
if (xs_test_copy()) {
    xs_json(['ok' => true, 'opening' => true, 'dry' => true]);
}
// Detached, like everything else this server starts: it is single-threaded,
// and waiting on a browser to open would stall every other request.
if (!xs_spawn_ps(xs_ps_call($script, ['Port' => $port]), ['hidden' => true])) {
    xs_fail('could not start the window', 500);
}

xs_json(['ok' => true, 'opening' => true]);
