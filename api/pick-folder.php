<?php
/**
 * /api/pick-folder.php - the Windows "choose a folder" (or file) window.
 *
 *   POST {"title": "...", "kind": "file", "types", "start"}
 *                           open it; answers at once, the window stays up
 *   GET                     {state: "waiting" | "done" | "cancelled" | "failed", path}
 *
 * The window runs in bin\pick-folder.ps1, on its own, so Xsegon keeps
 * answering meanwhile. It only says which folder; the page decides the rest.
 *
 * On a test copy no window opens: the answer is XSEGON_PICK_ANSWER (or
 * data\pick-answer.txt), written as if someone had chosen it.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/boot.php';

$out = xs_data_path('pick-folder.json');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $r = xs_read_json($out, null);
    if (!is_array($r)) {
        xs_json(['ok' => true, 'state' => 'none', 'path' => null]);
    }
    // A window left open past ten minutes is taken as forgotten, so the
    // guide's button is not stuck on "waiting" for ever.
    if (($r['state'] ?? '') === 'waiting' && time() - (int) ($r['at'] ?? 0) > 600) {
        $r['state'] = 'cancelled';
    }
    // Failed or forgotten goes in the day log once.
    if (in_array($r['state'] ?? '', ['failed', 'cancelled'], true) && empty($r['logged'])) {
        $r['logged'] = true;
        xs_write_json($out, $r);
        xs_log('SETUP', 'the folder window ' . ($r['state'] === 'failed'
            ? 'failed: ' . (string) ($r['error'] ?? '(no reason written)') : 'was forgotten or cancelled'));
    }
    xs_json(['ok' => true, 'state' => (string) ($r['state'] ?? 'none'), 'path' => $r['path'] ?? null,
             'error' => $r['error'] ?? null]);
}

xs_local_origin_only();
$body  = xs_body();
$title = trim(preg_replace('/["\r\n]+/', ' ', (string) ($body['title'] ?? '')) ?? '');
// A file instead of a folder: an emulator or a program of your own is chosen in a window too.
$kind  = ($body['kind'] ?? '') === 'file' ? 'file' : 'folder';
// What the file window lists: programs, unless a sound, a list of games or a video package is being chosen.
$types = in_array($body['types'] ?? '', ['sounds', 'lists', 'packages'], true) ? (string) $body['types'] : '';
$start = mb_substr(trim(preg_replace('/["\r\n]+/', '', (string) ($body['start'] ?? '')) ?? ''), 0, 400);
$title = $title !== '' ? mb_substr($title, 0, 120) : ($kind === 'file' ? 'Choose the file' : 'Choose the folder your games are in');

// The test server never opens the dialog: a test that set no answer gets
// "cancelled" rather than a window on the person's screen (xs_test_copy).
$test = getenv('XSEGON_PICK_ANSWER');
if (xs_test_copy()) {
    $test = is_string($test) ? $test : '';
    // A test can answer with a path of its own, a file to choose say.
    $one = xs_data_path('pick-answer.txt');
    if (is_file($one)) {
        $test = trim((string) file_get_contents($one));
    }
    xs_write_json($out, $test === '' ? ['state' => 'cancelled', 'path' => null, 'at' => time()]
                                     : ['state' => 'done', 'path' => $test, 'at' => time()]);
    xs_json(['ok' => true, 'started' => true, 'test' => true]);
}

xs_write_json($out, ['state' => 'waiting', 'path' => null, 'at' => time()]);
$script = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'pick-folder.ps1';
if (!xs_spawn_ps(xs_ps_call($script, ['Out' => $out, 'Title' => $title, 'Kind' => $kind, 'Start' => $start !== '' ? $start : null, 'Types' => $types !== '' ? $types : null]), ['sta' => true])) {
    xs_fail('the ' . $kind . ' window could not be opened', 500);
}
xs_log('SETUP', $kind . ' window opened');
xs_json(['ok' => true, 'started' => true]);
