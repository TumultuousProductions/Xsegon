<?php
/**
 * /api/extensions.php - the Extensions page (includes\extensions.php, js\extensions.js).
 *
 *   GET                                      every program on the list and where it stands on this PC
 *   GET  ?job=1                              Set up or Get at work, or the last one, as its worker left it
 *   POST {"open": "<id>", "which": "page" | "repo" | "listed" | "helper"}
 *                                            its makers' page opened in the default browser
 *   POST {"folder": "<path>", "id": "flashpoint"}   where it is, when Xsegon did not find it ("" forgets)
 *   POST {"setup": "flashpoint"}             its helper fetched and put beside it, in the background
 *   POST {"get": "flashpoint", "into": "<folder>"}  it fetched from its makers and unpacked there, in the background
 *   POST {"launcher": "flashpoint"}          its own window opened, for what only it does (its first setup)
 *   POST {"bring": "flashpoint", "playlist": "<file>"}   a playlist's games brought into your library
 *   POST {"pictures": "<game id>"}           that game's empty picture slots filled from Flashpoint
 *
 * An address is never taken from the request: it comes out of the shipped list. A test copy
 * opens nothing.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/extensions.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    if (($_GET['job'] ?? '') === '1') {
        xs_json(['ok' => true, 'job' => xs_ext_job()]);
    }
    $t = microtime(true);
    $list = xs_ext_states();
    $ms = (int) round((microtime(true) - $t) * 1000);
    $fp = array_values(array_filter($list, static fn($x) => $x['id'] === 'flashpoint'))[0] ?? null;
    xs_log('EXTN', count($list) . ' on the list in ' . $ms . 'ms' . ($fp === null ? ''
        : '; Flashpoint ' . ($fp['folder'] !== '' ? (string) ($fp['version']['number'] ?? '?') . ' at ' . $fp['folder'] . ', '
            . ($fp['games'] === null ? 'its game list unread' : number_format((int) $fp['games']) . ' games') . ', '
            . (($fp['helperHere']['there'] ?? false) ? 'helper ' . ($fp['helperHere']['tag'] ?? 'of its own') : 'no helper') . ', ' . $fp['mine'] . ' in the library, next ' . $fp['next']
          : 'not found')));
    $job = xs_ext_job();
    xs_json(['ok' => true, 'extensions' => $list, 'ms' => $ms, 'working' => ($job['state'] ?? '') === 'running' ? (string) ($job['id'] ?? '') : null]);
}

xs_local_origin_only();
$body = xs_body();
$dry = xs_test_copy() || !empty($body['dry']);

/** A program of the user's own opened, or a page in the browser: Windows' start, never on a test copy. */
$start = static function (string $what, string $dir = '') use ($dry): bool {
    if ($dry) {
        return true;
    }
    $h = popen('start "" ' . ($dir !== '' ? '/D "' . $dir . '" ' : '') . '"' . $what . '"', 'r');
    if ($h === false) {
        return false;
    }
    pclose($h);
    return true;
};

if (isset($body['open'])) {
    $id = (string) $body['open'];
    $which = (string) ($body['which'] ?? 'page');
    $url = xs_ext_url($id, $which);
    if ($url === null) {
        xs_fail('no such page to open', 404);
    }
    if (!$start($url)) {
        xs_fail('Windows did not open the page', 500);
    }
    xs_log('EXTN', 'opened ' . $which . ' of ' . $id . ': ' . $url . ($dry ? ' (dry)' : ''));
    xs_json(['ok' => true, 'url' => $url, 'dry' => $dry]);
}

if (array_key_exists('folder', $body)) {
    $dir = xs_norm_path(trim((string) $body['folder']));
    if (($body['id'] ?? 'flashpoint') !== 'flashpoint') {
        xs_fail('Xsegon knows no such program', 404);
    }
    if ($dir !== '' && !xs_fp_is($dir)) {
        xs_fail('that folder is not a Flashpoint: Flashpoint\'s own folder holds version.txt, with Launcher, Data and FPSoftware beside it', 422);
    }
    if (!xs_ext_state_set('flashpoint', ['folder' => $dir], $why)) {
        xs_fail((string) $why, 500);
    }
    xs_log('EXTN', $dir === '' ? 'the chosen Flashpoint folder forgotten' : 'Flashpoint\'s folder chosen: ' . $dir);
    xs_json(['ok' => true, 'folder' => $dir]);
}

if (isset($body['setup']) || isset($body['get'])) {
    $id = (string) ($body['setup'] ?? $body['get']);
    if (!xs_ext_start($id, isset($body['setup']) ? 'setup' : 'get', (string) ($body['into'] ?? ''), $why)) {
        xs_fail((string) $why, 409);
    }
    xs_json(['ok' => true, 'job' => xs_ext_job()]);
}

if (isset($body['launcher'])) {
    $root = xs_fp_root();
    $exe = $root . DIRECTORY_SEPARATOR . 'Launcher' . DIRECTORY_SEPARATOR . 'Flashpoint.exe';
    if ($root === '' || !is_file($exe)) {
        xs_fail($root === '' ? 'Flashpoint was not found on this PC' : 'Flashpoint\'s own window is not there: ' . $exe, 404);
    }
    if (!$start($exe, dirname($exe))) {
        xs_fail('Windows did not start Flashpoint', 500);
    }
    xs_log('EXTN', 'Flashpoint\'s own window opened: ' . $exe . ($dry ? ' (dry)' : ''));
    xs_json(['ok' => true, 'exe' => $exe, 'dry' => $dry]);
}

if (isset($body['bring'])) {
    $root = xs_fp_root();
    if ($root === '') {
        xs_fail('Flashpoint was not found on this PC', 404);
    }
    $want = (string) ($body['playlist'] ?? 'Favorites.json');
    $list = null;
    foreach (xs_fp_playlists($root) as $p) {
        if (strcasecmp($p['file'], $want) === 0) {
            $list = $p;
        }
    }
    if ($list === null) {
        xs_fail('Flashpoint has no playlist ' . $want, 404);
    }
    $t = microtime(true);
    $got = xs_fp_bring($root, $list, !empty($body['dry']), $why);
    if ($got === null) {
        xs_fail((string) $why, 500);
    }
    xs_log('FLPT', 'brought in ' . $list['title'] . ' (' . $list['count'] . '): ' . $got['added'] . ' new, ' . $got['kept'] . ' already here'
        . ($got['unknown'] ? ', ' . $got['unknown'] . ' not in Flashpoint\'s list' : '') . ', ' . $got['online'] . ' download at their first play, in '
        . (int) round((microtime(true) - $t) * 1000) . 'ms' . (!empty($body['dry']) ? ' (dry)' : ''));
    xs_json(['ok' => true, 'playlist' => $list['title'], 'platform' => XS_FP_PLATFORM] + $got);
}

if (isset($body['pictures'])) {
    require_once __DIR__ . '/../includes/local.php';
    $id = (string) $body['pictures'];
    $e = null;
    foreach (xs_local_read() as $x) {
        if ((string) ($x['id'] ?? '') === $id && !empty($x['fpId'])) {
            $e = $x;
        }
    }
    $root = xs_fp_root();
    if ($e === null || $root === '') {
        xs_fail($e === null ? 'that is not a game from Flashpoint' : 'Flashpoint was not found on this PC', 404);
    }
    $pics = xs_fp_pictures($root, $id, strtolower((string) $e['fpId']));
    xs_log('FLPT', 'pictures for ' . $e['title'] . ': ' . implode(', ', array_map(static fn($k, $v) => $k . ' ' . $v, array_keys($pics), $pics)));
    xs_json(['ok' => true, 'id' => $id, 'pictures' => $pics]);
}

xs_fail('what should be done? open, folder, setup, get, launcher, bring or pictures', 400);
