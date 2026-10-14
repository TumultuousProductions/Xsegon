<?php
/**
 * GET /api/status.php - is anything running, did anything fail, is the world ok.
 *
 * This is the other half of detaching. The launcher writes running.json while a
 * game is alive and last-error.json when one refuses to start; the UI polls
 * here so a dead button press always has an explanation attached.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/retroarch.php';
require_once __DIR__ . '/../includes/version.php';
require_once __DIR__ . '/../includes/extras.php';
require_once __DIR__ . '/../includes/news.php';

xs_heartbeat();
// Trouble that happened by itself goes into the mailbox here, on the main
// server's own poll (includes\news.php); the page lights the dot from 'mail'.
xs_trouble_sweep();
/* The sizes of the spines, cartridges and discs are kept in a file
   (includes\extras.php). The fast lane never writes, so it is made here, on
   the main server's own poll, when pictures have come or gone. */
xs_extras_index();

$s   = xs_settings();
$lib = xs_read_json(xs_library_path(), null);
// The counts as shown: hidden games out, your own in, from the merged read,
// since library.json usually does not exist. "built" below reports the file.
$shown = xs_library();
$noArt = 0;
foreach ($shown['games'] ?? [] as $g) {
    if (empty($g['art']['box'])) {
        $noArt++;
    }
}
$built = $lib !== null;        // the FILE, which "built" and "stale" report on
if ($lib === null) {
    $lib = ['counts' => [], 'platforms' => [], 'generatedAt' => null];
}
$lib['counts']['games'] = count($shown['games'] ?? []);
$lib['counts']['noArt'] = $noArt;
$lib['platforms'] = $shown['platforms'] ?? $lib['platforms'];

$romRoot   = xs_norm_path($s['paths']['romRoot']);
$launchbox = xs_norm_path($s['paths']['launchbox']);

$sessions = xs_read_jsonl(xs_sessions_path());
$played   = 0;
foreach ($sessions as $row) {
    $played += (int) ($row['seconds'] ?? 0);
}

xs_json([
    'ok' => true,
    // Which build is answering. The status poll is the one request every page
    // makes, so this is the cheapest place to put it.
    'build' => xs_version(),
    'checks' => [
        // The guardrail, surfaced before anything is pressed rather than after.
        // No ROM drive chosen (a new person's first run) is not a drive
        // unplugged: nothing to warn about, only a place to say "not set".
        'romRoot'   => ['path' => $romRoot,   'present' => $romRoot === '' || (xs_drive_stuck($romRoot) === null && is_dir($romRoot)), 'set' => $romRoot !== ''],
        'launchbox' => ['path' => $launchbox, 'present' => xs_drive_stuck($launchbox) === null && is_dir($launchbox)],
        'library'   => ['built' => $built, 'at' => $lib['generatedAt'] ?? null],
        'stale'     => $built && xs_library_stale($s),
    ],
    'counts' => [
        'games'     => $lib['counts']['games'] ?? 0,
        'platforms' => count($lib['platforms'] ?? []),
        'noArt'     => $lib['counts']['noArt'] ?? 0,
        'sessions'  => count($sessions),
        'secondsPlayed' => $played,
    ],
    'thumbs'  => xs_read_json(xs_data_path('thumbs-box.json'), null),
    // The grid's Image Group can show other art; each kind has its own cache.
    'thumbsBy' => array_map(static fn($k) => is_file(xs_data_path('thumbs-' . $k . '.json')),
                            array_combine(array_keys(xs_own_art_kinds()), array_keys(xs_own_art_kinds()))),
    // What RetroArch's own config currently permits, so the UI can explain a
    // missing button instead of offering one that does nothing.
    'retroarch' => $lib !== null ? ra_capabilities($lib) : null,
    'running' => xs_game_running(),
    'error'   => xs_read_json(xs_data_path('last-error.json'), null),
    // Files of yours that will not read, and are not being saved over (boot.php)
    'damaged' => xs_damaged(),
    // How many messages are unread, trouble kept just now included (the mailbox's dot)
    'mail'    => ['unread' => xs_messages_unread()],
]);
