<?php
/**
 * The phone server's router: a third `php -S` on the home network's address,
 * started by the main server when Connect a phone... is switched on
 * (includes\phone.php) and stopped with the switch or the main server
 * (bin\phonelane.ps1). The main server stays on 127.0.0.1: it lets through
 * any request that names no sender, and one of its jobs runs any program.
 *
 * What keeps this one safe, all of it here:
 *   - a fixed list of paths, so none of the main server's jobs can be asked for
 *   - it only reads (XS_FAST_LANE: a save is refused). Letting a phone in and
 *     starting a game go to the main server over loopback, with only the
 *     fields named here
 *   - every path but the page, the hello and the join wants a phone's key,
 *     kept in a cookie no script can read and no other site can send
 *   - anything that is not a read must come from this server's own page,
 *     with a header only that page sends
 *   - the Host must be this server's own address, so a name aimed at it
 *     from a web page elsewhere is refused
 */
declare(strict_types=1);

define('XS_FAST_LANE', true);
define('XS_PHONE_LANE', true);

$root   = __DIR__;
$path   = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET');
$me     = ($_SERVER['SERVER_NAME'] ?? '') . ':' . ($_SERVER['SERVER_PORT'] ?? '');

const XS_PHONE_PATHS = [
    '/'        => 'GET',
    '/p/hello' => 'GET',
    '/p/join'  => 'POST',
    '/p/me'    => 'GET',
    '/p/list'  => 'GET',
    '/p/art'   => 'GET',
    '/p/now'   => 'GET',
    '/p/play'  => 'POST',
];
// What a phone is told of a game: enough to find it and start it. No file name, no path, no play history, no notes.
const XS_PHONE_ROW = ['id', 'title', 'platform', 'hasArt', 'playable'];

function xs_phone_say(int $code, array $answer): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($answer, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/** The main server, asked over this PC's own loopback: its answer and its status. */
function xs_phone_ask_main(string $what, array $body): array
{
    $ctx = stream_context_create(['http' => [
        'method' => 'POST', 'header' => "Content-Type: application/json\r\n", 'content' => json_encode($body),
        'timeout' => 20, 'ignore_errors' => true]]);
    $raw = @file_get_contents('http://127.0.0.1:' . (int) getenv('XS_MAIN_PORT') . '/api/' . $what, false, $ctx);
    $a = is_string($raw) ? json_decode($raw, true) : null;
    $code = preg_match('/ (\d{3})/', (string) ($http_response_header[0] ?? ''), $m) ? (int) $m[1] : 502;
    return [is_array($a) ? $a : ['ok' => false, 'error' => 'Xsegon on the PC did not answer'], $code];
}

/** The library's answer cut down to XS_PHONE_ROW: run as the answer leaves, since the read ends the request itself. */
function xs_phone_slim(string $out): string
{
    $a = json_decode($out, true);
    if (!is_array($a) || empty($a['ok'])) {
        return json_encode(['ok' => false, 'error' => is_array($a) ? (string) ($a['error'] ?? 'the list could not be read') : 'the list could not be read']);
    }
    $rows = [];
    foreach ((array) ($a['games'] ?? []) as $g) {
        $rows[] = array_intersect_key($g, array_flip(XS_PHONE_ROW));
    }
    $consoles = [];
    foreach ((array) ($a['platforms'] ?? []) as $name => $n) {       // the library's own: a console's name and how many games
        if (is_string($name) && is_int($n)) {
            $consoles[] = ['name' => $name, 'count' => $n];
        }
    }
    return (string) json_encode(['ok' => true, 'count' => (int) ($a['count'] ?? count($rows)), 'from' => (int) ($a['from'] ?? 0),
                                 'consoles' => $consoles, 'games' => $rows], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: DENY');

$want = XS_PHONE_PATHS[$path] ?? null;
$mine = strcasecmp((string) ($_SERVER['HTTP_HOST'] ?? ''), $me) === 0;
// Anything that changes something: from this server's own page only, with the header only it sends.
$sure = $method !== 'POST'
     || ((string) ($_SERVER['HTTP_ORIGIN'] ?? '') === 'http://' . $me && (string) ($_SERVER['HTTP_X_XSEGON_PHONE'] ?? '') === '1');
$from = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
// The hello, before anything is loaded: the main server asks it at every look, and waits little for it.
// The mark is the one the main server started this with (bin\phonelane.ps1), so it reads nothing.
if ($mine && $path === '/p/hello' && $method === 'GET') {
    xs_phone_say(200, ['ok' => true, 'app' => 'xsegon', 'lane' => 'phone', 'mark' => hash('sha256', (string) getenv('XS_PHONE_MARK') . '|hello')]);
}
unset($_SERVER['HTTP_ORIGIN']);                // judged above, more strictly than "from this PC" would
require_once $root . '/includes/phone.php';

if (!$mine || $want === null || $want !== $method || !$sure) {
    xs_log('PHONE', 'refused ' . $method . ' ' . substr($path, 0, 80) . ' from ' . ($_SERVER['REMOTE_ADDR'] ?? '?') . ': '
        . (!$mine ? 'asked under another name (' . substr((string) ($_SERVER['HTTP_HOST'] ?? ''), 0, 60) . ')'
           : ($want === null || $want !== $method ? 'not one of the phone page\'s' : 'not sent by the phone page itself' . ($from !== '' ? ' (' . substr($from, 0, 60) . ')' : ''))));
    xs_phone_say($want !== null && $want === $method && $mine ? 403 : 404, ['ok' => false, 'error' => 'nothing here']);
}

if ($path === '/') {
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header("Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'");
    readfile($root . '/phone/index.html');
    exit;
}
if ($path === '/p/join') {
    $code = (string) (xs_body()['code'] ?? '');
    if (!preg_match('/^[0-9a-f]{16}$/', $code)) {
        xs_phone_say(403, ['ok' => false, 'error' => 'that is not a square of Xsegon\'s']);
    }
    [$a, $status] = xs_phone_ask_main('phone.php', ['op' => 'join', 'code' => $code, 'ua' => substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 300)]);
    if (empty($a['ok']) || !is_string($a['key'] ?? null)) {
        xs_phone_say($status >= 400 ? $status : 403, ['ok' => false, 'error' => (string) ($a['error'] ?? 'not let in')]);
    }
    setcookie('xsp', $a['key'], ['expires' => time() + 400 * 86400, 'path' => '/', 'httponly' => true, 'samesite' => 'Strict']);
    xs_phone_say(200, ['ok' => true, 'name' => (string) ($a['name'] ?? '')]);
}

// From here on: a phone that was let in, and nobody else.
$phone = xs_phone_by_key((string) ($_COOKIE['xsp'] ?? ''));
if ($phone === null) {
    xs_phone_say(401, ['ok' => false, 'error' => 'this phone has not been let in: on the TV, open Connect a phone... and scan the square']);
}
@touch(xs_data_path('phone-seen'));            // "off by itself" counts from the last of these

if ($path === '/p/me') {
    xs_phone_say(200, ['ok' => true, 'name' => (string) ($phone['name'] ?? '')]);
}
if ($path === '/p/now') {
    $run = xs_game_running();
    xs_phone_say(200, ['ok' => true, 'running' => $run === null ? null
        : ['id' => (string) ($run['id'] ?? ''), 'title' => (string) ($run['title'] ?? ''), 'platform' => (string) ($run['platform'] ?? '')]]);
}
if ($path === '/p/play') {
    $id = (string) (xs_body()['id'] ?? '');
    if (!preg_match('/^[A-Za-z0-9._:-]{1,120}$/', $id)) {
        xs_phone_say(400, ['ok' => false, 'error' => 'no such game']);
    }
    xs_log('PHONE', 'play ' . $id . ' asked by ' . ($phone['name'] ?? '?') . ' (' . ($phone['id'] ?? '?') . ')');
    [$a, $status] = xs_phone_ask_main('launch.php', ['id' => $id]);
    // The reason in Xsegon's own words, with no folder of this PC's in it.
    $error = isset($a['error']) ? (string) preg_replace('/[A-Za-z]:\\\\[^\s"\']*|\\\\\\\\[^\s"\']+/', 'a folder on the PC', (string) $a['error']) : null;
    xs_phone_say($status, ['ok' => !empty($a['ok']), 'error' => $error]);
}

// The two that are the main server's own reads, run here with only these fields handed on, each a plain word or left out.
$asked = array_filter($_GET, 'is_string');
if ($path === '/p/list') {
    // A console by its name only: the lists that begin with @ (recently played, favourites) say what you play.
    $console = substr((string) ($asked['platform'] ?? ''), 0, 120);
    $_GET = ['q' => substr((string) ($asked['q'] ?? ''), 0, 80), 'platform' => str_starts_with($console, '@') ? '' : $console,
             'from' => (string) max(0, (int) ($asked['from'] ?? 0)), 'lot' => '200', 'sort' => 'title'];
    ob_start('xs_phone_slim');
    $file = $root . '/api/library.php';
} else {                                       // /p/art
    $id = (string) ($asked['id'] ?? '');
    if (!preg_match('/^[A-Za-z0-9._:-]{1,120}$/', $id)) {
        xs_phone_say(404, ['ok' => false, 'error' => 'no such picture']);
    }
    $_GET = ['id' => $id, 'kind' => 'box'];
    $file = $root . '/api/image.php';
}
$_SERVER['SCRIPT_NAME'] = '/api/' . basename($file);
$_SERVER['SCRIPT_FILENAME'] = $file;
chdir(dirname($file));
require $file;
