<?php
/**
 * POST /api/reveal.php  {"id": "<game id>", "what": "rom" | "images" | "video" | "save", "key"}
 * POST /api/reveal.php  {"what": "data"}            Xsegon's own data folder
 * POST /api/reveal.php  {"what": "games"}           the Games folder it made
 * POST /api/reveal.php  {"what": "videos", "consoles": [...]}   its videos folder
 *
 * Show one of a game's files in Explorer, selected (a browser cannot).
 *
 * The path is never taken from the request: it names a GAME and a KIND, and
 * the path comes out of the library, so only that game's own files show.
 *
 * Same Origin rule as api\open.php: only a page served from this machine.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/video.php';

$origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
if ($origin !== '') {
    $host = strtolower((string) parse_url($origin, PHP_URL_HOST));
    if (!in_array($host, ['127.0.0.1', 'localhost', '[::1]', '::1'], true)) {
        xs_fail('only pages on this machine may do that', 403);
    }
}
xs_post_only();

/** Explorer opened on a folder, and the answer; a test server opens no window. */
function xs_reveal_folder(string $dir, bool $dry): never
{
    if ($dry || xs_test_copy()) {
        xs_json(['ok' => true, 'folder' => $dir, 'dry' => true]);
    }
    $handle = popen('start "" explorer.exe "' . str_replace('"', '', $dir) . '"', 'r');
    if ($handle === false) {
        xs_fail('could not open Explorer', 500);
    }
    pclose($handle);
    xs_json(['ok' => true, 'folder' => $dir]);
}

$body = xs_body();
$id   = (string) ($body['id'] ?? '');
$what = (string) ($body['what'] ?? '');

// The data folder (Help > Open the data folder): no path from the request.
if ($what === 'data') {
    xs_reveal_folder(xs_data_dir(), !empty($body['dry']));
}
// The Games folder a new copy starts with (includes\scan.php), only while it
// is still there. Again no path from the request.
if ($what === 'games') {
    require_once __DIR__ . '/../includes/scan.php';
    $dir = xs_scan_first_folder_made();
    if ($dir === '' || !is_dir($dir)) {
        xs_fail('the Games folder Xsegon made is not there any more', 404);
    }
    xs_reveal_folder($dir, !empty($body['dry']));
}
// Xsegon's own videos folder, with a folder for each console named (the Skraper
// steps, js\skraperhow.js). A console's name is made safe as a folder's, so
// nothing outside the videos folder can be made from here.
if ($what === 'videos') {
    require_once __DIR__ . '/../includes/videopack.php';
    $dir = xs_data_path('videos');
    foreach (array_slice((array) ($body['consoles'] ?? []), 0, 12) as $name) {
        $safe = is_string($name) ? xs_vp_safe($name) : '';
        if ($safe !== '' && $safe !== '.' && $safe !== '..' && !is_dir($dir . DIRECTORY_SEPARATOR . $safe)) {
            @mkdir($dir . DIRECTORY_SEPARATOR . $safe, 0777, true);
        }
    }
    if (!is_dir($dir) && !@mkdir($dir, 0777, true)) {
        xs_fail('the videos folder could not be made: ' . $dir, 500);
    }
    xs_reveal_folder($dir, !empty($body['dry']));
}
if (!xs_game_id_ok($id) || !in_array($what, ['rom', 'images', 'video', 'save', 'texpack'], true)) {
    xs_fail('id and what (rom, images, video, save or texpack) are required', 400);
}

$game = xs_game_or_404($id, 'no such game');

// The game's texture pack, in the folder its emulator loads it from (includes\texpacks.php).
if ($what === 'texpack') {
    require_once __DIR__ . '/../includes/texpacks.php';
    $t = xs_tp_target($game);
    if ($t !== null && !is_dir($t['into'])) {
        foreach (xs_tp_packs($t, xs_tp_record_for($game, $t)) as $p) {
            if (!empty($p['file'])) {
                xs_reveal_folder(dirname($p['paths'][0]), !empty($body['dry']));   // an N64 core's .hts or .htc, in its cache folder
            }
        }
    }
    if ($t === null || !is_dir($t['into'])) {
        xs_fail('this game has no texture pack now', 404);
    }
    xs_reveal_folder($t['into'], !empty($body['dry']));
}

$s = xs_settings();
$path = null;
if ($what === 'rom') {
    $path = $game['romPath'] ?? null;
} elseif ($what === 'images') {
    // The cover if there is one, else whichever art exists.
    foreach (array_keys(xs_own_art_kinds()) as $kind) {
        if (!empty($game['art'][$kind])) {
            $path = $game['art'][$kind];
            break;
        }
    }
} elseif ($what === 'save') {
    // One row of the Saves tab, named by the key the list gave it (includes\saves.php).
    require_once __DIR__ . '/../includes/saves.php';
    $key  = (string) ($body['key'] ?? '');
    $path = preg_match('/^[a-z]{1,12}(:\d{1,4})?$/', $key) ? xs_save_path($game, $key) : null;
} else {
    $path = video_for_game($s, $game);
}

if ($path === null || $path === '') {
    xs_fail('this game has no ' . ($what === 'rom' ? 'ROM path' : ($what === 'save' ? 'such save now' : $what)), 404);
}
$path = xs_norm_path((string) $path);

// A file is shown selected in its folder. A ROM drive that is unplugged has
// no file to select, so say that rather than opening Explorer on nothing.
if (!file_exists($path)) {
    xs_fail('not found on disk: ' . $path, 404);
}

if (xs_test_copy()) {                              // never a window from the test server
    xs_json(['ok' => true, 'revealed' => $path, 'dry' => true]);
}
$command = 'start "" explorer.exe /select,"' . str_replace('"', '', $path) . '"';
$handle  = popen($command, 'r');
if ($handle === false) {
    xs_fail('could not open Explorer', 500);
}
pclose($handle);

xs_json(['ok' => true, 'revealed' => $path]);
