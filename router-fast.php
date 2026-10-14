<?php
/**
 * The fast lane's router: a second `php -S` on the main port + 1, started by
 * the main server (includes\fastlane.php) and stopped with it (bin\fastlane.ps1).
 * `php -S` answers one request at a time on Windows, so the reads a person
 * waits on come here and never queue behind the main server's work.
 *
 * What keeps it safe, here or in includes\boot.php:
 *   - a fixed list of paths, every other one refused, so no endpoint that
 *     saves can slip in and fight the main server over a file
 *   - XS_FAST_LANE: xs_write_json() refuses under it, so a read that writes
 *     fails loudly instead of racing the main server
 *   - CORS for the main port's page only
 *   - every answer names the folder it serves (X-Xsegon-Lane), so the page
 *     never trusts another program on this port
 * The page (js\log.js) uses the main server whenever this one does not answer.
 */
declare(strict_types=1);

define('XS_FAST_LANE', true);

$root = __DIR__;
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// What may come here, and how. window.php is a POST, but it only asks a
// window to move; it writes no file.
const XS_LANE_PATHS = [
    '/api/lane.php'    => ['GET'],
    '/api/running.php' => ['GET'],
    '/api/step.php'    => ['GET'],
    '/api/library.php' => ['GET'],
    '/api/game.php'    => ['GET'],
    // Small reads that build no library, so they need not wait behind the status check.
    '/api/hide.php'      => ['GET'],
    '/api/changelog.php' => ['GET'],
    '/api/states.php'    => ['GET'],
    '/api/window.php'  => ['POST'],
];

// The main server's page, and nothing else, may read the answers.
$mainPort = (int) ($_SERVER['SERVER_PORT'] ?? 8100) - 1;
$origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
if ($origin !== '' && preg_match('#^http://(127\.0\.0\.1|localhost):' . $mainPort . '$#', $origin)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Expose-Headers: X-Xsegon-Lane');
}
header('X-Xsegon-Lane: ' . md5(strtolower($root)));

if ($method === 'OPTIONS') {                   // the browser asking before a POST
    header('Access-Control-Allow-Methods: GET, POST');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 600');
    http_response_code(204);
    exit;
}

$allowed = XS_LANE_PATHS[$path] ?? null;
if ($allowed === null || !in_array($method, $allowed, true)) {
    require_once $root . '/includes/boot.php';
    xs_log('LANE', 'refused ' . $method . ' ' . $path . ': not one of the fast lane\'s reads');
    http_response_code(404);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'not served by the fast lane']);
    exit;
}

$file = $root . str_replace('/', DIRECTORY_SEPARATOR, $path);
$_SERVER['SCRIPT_NAME'] = $path;
$_SERVER['SCRIPT_FILENAME'] = $file;
chdir(dirname($file));
require $file;
