<?php
/**
 * Router for php -S.
 *
 * Static files are served as-is; everything else falls through to index.php.
 * data\ is refused outright: the library, the settings and the session log
 * sit under the document root but are not web content.
 *
 * /files/ is the one door into it, for media only: the folders below, picture
 * and video extensions only (and a PDF from the documents folder, a manual).
 * php -S serves a plain file with no cache headers and no Range support, so a
 * video could not loop or seek. Here the browser keeps a file for a year,
 * because the ?v= in the address changes when the file does.
 */
declare(strict_types=1);

// A warning printed into a picture or a video breaks it, and the /files/ door does not load includes\boot.php.
ini_set('display_errors', '0');

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

// Asked for by this machine's name only. A page elsewhere that points its own
// domain at 127.0.0.1 (DNS rebinding) becomes "same origin" and could read
// the answers; it cannot choose what its Host header says.
$host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
if ($host !== '' && !preg_match('#^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$#', $host)) {
    http_response_code(403);
    exit;
}

if (preg_match('#^/files/([a-z\-]+)/(.+)$#i', $path, $m)) {
    $t0 = microtime(true);
    xs_router_file(strtolower($m[1]), rawurldecode($m[2]));
    // A slow serve, or a refused one, goes in the log: it shows how often one request holds the others up.
    $ms = (int) round((microtime(true) - $t0) * 1000);
    $code = http_response_code() ?: 200;
    if ($ms >= 300 || $code >= 400) {
        // boot.php is loaded only on the slow or refused path, so the fast path stays cheap.
        require_once __DIR__ . '/includes/boot.php';
        xs_log('FILE', $path . ' ' . $ms . 'ms ' . $code);
    }
    exit;
}
if (preg_match('#^/files(/|$)#i', $path)) {
    http_response_code(404);             // the door owns the whole prefix: nothing else answers here
    exit;
}

if (preg_match('#^/data(/|$)#i', $path)) {
    http_response_code(404);
    exit;
}

// The manual reader's libraries (js\vendor\<name>-<version>\, js\reader.js): their scripts
// and the picture decoders pdf.js asks for. A folder is named for its version, so a year is safe.
if (preg_match('#^/js/vendor/([a-z][a-z0-9\-]*-\d+(?:\.\d+)*)/([a-z0-9_\-]+(?:\.[a-z0-9]+)*\.(js|wasm))$#i', $path, $m)) {
    $vend = __DIR__ . DIRECTORY_SEPARATOR . 'js' . DIRECTORY_SEPARATOR . 'vendor' . DIRECTORY_SEPARATOR . $m[1] . DIRECTORY_SEPARATOR . $m[2];
    if (!is_file($vend)) {
        http_response_code(404);
        exit;
    }
    require_once __DIR__ . '/includes/stream.php';
    xs_stream_file($vend, strtolower($m[3]) === 'wasm' ? 'application/wasm' : 'text/javascript', 'private, max-age=31536000, immutable');
    exit;
}

$file = __DIR__ . str_replace('/', DIRECTORY_SEPARATOR, $path);

if ($path !== '/' && is_file($file)) {
    /* Only the page's own code is web content. The resolved file is checked:
       Windows drops a trailing dot, so /data./settings.json would slip past the
       block above, and a dot, a ".." or a case trick must change nothing. */
    $real = realpath($file);
    $rel  = $real === false ? '' : str_replace('\\', '/', substr($real, strlen(__DIR__) + 1));
    if ($real !== false && strncasecmp($real, __DIR__ . DIRECTORY_SEPARATOR, strlen(__DIR__) + 1) === 0
        && preg_match('#^(index\.php|play\.php|api/[a-z0-9\-]+\.php|js/[a-z0-9\-]+\.js|css/[a-z0-9\-]+\.css|img/[a-z0-9\-]+\.(png|ico)'
            // the game pictures on Tumultuous Productions' page (includes\tumultuous\page.json)
            . '|img/tumultuous/[a-z0-9\-]+\.jpg'
            // private\, where it exists: its pages and scripts, nothing else in it
            . '|private/api/[a-z0-9\-]+\.php|private/web/[a-z0-9\-]+\.js'
            // custom\, a person's own look (includes\custom.php): stylesheets and the pictures they name, never a script
            . '|custom/[a-z0-9_\-]+\.css|custom/[a-z0-9_\-]+\.(png|jpe?g|webp|gif))$#i', $rel)) {
        // js\ rides inside the page (index.php) and is asked for here only by the
        // ordinary load. TODO: css\ goes out with no cache headers, so every load sends it again.
        return false;   // let the built-in server handle it
    }
    http_response_code(404);
    exit;
}
if ($path === '/favicon.ico') {
    // Xsegon's own mark, so the browser's ask never falls through to the whole index page.
    header('Content-Type: image/x-icon');
    header('Cache-Control: public, max-age=86400');
    readfile(__DIR__ . DIRECTORY_SEPARATOR . 'img' . DIRECTORY_SEPARATOR . 'xsegon.ico');
    exit;
}

require __DIR__ . '/index.php';

function xs_router_file(string $area, string $rel): void
{
    $types = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
              'webp' => 'image/webp', 'gif' => 'image/gif',
              'mp4' => 'video/mp4', 'm4v' => 'video/mp4', 'webm' => 'video/webm',
              // a manual, and only from the documents folder: see below
              'pdf' => 'application/pdf'];

    // Xsegon's own media folders, by name. Nothing else under data\ has a name
    // here, so nothing else can be asked for.
    $data  = __DIR__ . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR;
    $env   = getenv('XSEGON_DATA');          // the test runner's own copy (includes\boot.php)
    if (is_string($env) && $env !== '') {
        // Gone means refuse, never the real folder (includes\boot.php says why).
        if (!is_dir($env)) {
            http_response_code(503);
            return;
        }
        $data = rtrim($env, '\\/') . DIRECTORY_SEPARATOR;
    }
    $areas = ['thumbs' => $data . 'thumbs', 'art' => $data . 'art', 'media' => $data . 'media',
              'videos' => $data . 'videos', 'video-own' => $data . 'video-own',
              // Steam trailers (includes/steamvid.php), found by game id
              'videos-steam' => $data . 'videos-steam',
              // ScreenScraper's snaps (includes/screenscraper.php), the same way
              'videos-screenscraper' => $data . 'videos-screenscraper',
              // the runs check's screenshots (includes\runcheck.php)
              'runcheck' => $data . 'runcheck' . DIRECTORY_SEPARATOR . 'shots',
              // a game's manual, maps and guides, a folder per game, and the
              // side of its box, its cartridge or its disc (includes\extras.php)
              'documents' => $data . 'documents', 'extras' => $data . 'extras'];

    $ext = strtolower(pathinfo($rel, PATHINFO_EXTENSION));
    if (!isset($areas[$area], $types[$ext]) || str_contains($rel, "\0") || ($ext === 'pdf' && $area !== 'documents')) {
        http_response_code(404);
        return;
    }

    $root = $areas[$area];
    if ($area === 'media') {
        // The copy's folder can be moved out of the project (Settings > Paths).
        // Read straight from settings.json: loading the whole app for every
        // picture is the cost this door exists to avoid.
        $raw = @file_get_contents($data . 'settings.json');
        $set = $raw === false ? null : json_decode(ltrim($raw, "\xEF\xBB\xBF"), true);
        $custom = trim((string) ($set['paths']['mediaDir'] ?? ''));
        if ($custom !== '') {
            $root = rtrim(str_replace('/', DIRECTORY_SEPARATOR, $custom), DIRECTORY_SEPARATOR);
        }
    }

    // The resolved file must sit inside the resolved folder: "..", a junction
    // or an odd encoding can never turn this into "read any file".
    $rootReal = realpath($root);
    $real     = realpath($root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $rel));
    if ($rootReal === false || $real === false || !is_file($real)
        || strncasecmp($real, $rootReal . DIRECTORY_SEPARATOR, strlen($rootReal) + 1) !== 0) {
        http_response_code(404);
        return;
    }

    // A year, and never asked about again: a changed file has a new ?v=.
    require_once __DIR__ . '/includes/stream.php';
    xs_stream_file($real, $types[$ext], isset($_GET['v']) ? 'private, max-age=31536000, immutable' : 'private, max-age=3600');
}
