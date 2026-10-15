<?php
/**
 * /api/scan.php - games found on the disk.
 *
 *   GET                              walk the ROM folders now, change nothing:
 *                                    what is new, what is an archive, which
 *                                    disc sets have holes, which folders were
 *                                    not recognised, what was skipped and why
 *   GET  ?folders=1                  the folders looked in, without a walk
 *   POST {"action":"accept","games":[{id,title,platform,rom},...]}
 *                                    keep these: they join the library on the
 *                                    next read, via data\scanned-games.json
 *   POST {"action":"remove","id"}    take one accepted game back out
 *   POST {"action":"m3u","dir","file"}
 *                                    write the playlist the walk offered for
 *                                    a disc set, beside its discs
 *   POST {"action":"join","rom"}     join a disc to its game's playlist
 *   POST {"action":"addFolder"|"removeFolder","path"}
 *                                    the list of folders that are looked in
 *   POST {"action":"makeFolders","path"}
 *                                    a folder per console, inside one of them
 *   POST {"action":"firstFolder"}    a new copy's own Games folder, made once
 *                                    (start.ps1 asks on every start)
 *
 * The GET is the review. Nothing enters the library that was not on that
 * screen, and nothing found is ever dropped silently: it is either offered,
 * or listed with the reason it was not.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/scan.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method !== 'POST' && ($_GET['folders'] ?? '') === '1') {
    /* The list of places to look, on its own and cheap: it must answer even
       when a scan cannot (every drive unplugged), so a wrong folder can be fixed. */
    $s = xs_settings();
    $rows = [];
    $own  = strtolower(xs_scan_first_folder_made());
    foreach (xs_scan_roots($s) as $i => $p) {
        // A folder added by itself whose name reads as a console is walked
        // as that console (includes\scan.php): the row says so, so a gbc
        // folder finding Game Boy Color games is never a mystery. "made" is
        // the Games folder Xsegon made on a new copy's first start.
        $rows[] = ['path' => $p, 'there' => is_dir($p),
                   'fixed' => $i === 0 && xs_norm_path((string) ($s['paths']['romRoot'] ?? '')) === $p,
                   'console' => xs_scan_platform_for(basename($p)),
                   'made' => $own !== '' && strtolower($p) === $own];
    }
    xs_json(['ok' => true, 'folders' => $rows, 'names' => xs_scan_folder_names_playable()]);
}

if ($method !== 'POST') {
    $found = xs_scan_walk();
    if (isset($found['error'])) {
        xs_fail((string) $found['error'], 400);       // xs_fail logs it as FAIL
    }
    // An archive whose game stands unpacked already is not listed again: counted, with its size (includes\unpack.php).
    require_once __DIR__ . '/../includes/unpack.php';
    [$found['archives'], $found['archivesDone']] = xs_unpack_sort($found['archives']);
    // What the ones still packed take, and the room free where they stand: said over the offer, beside Unpack all.
    $found['archivesRoom'] = xs_unpack_room($found['archives']);
    // Every folder is named, up to four, so the log shows where it looked.
    $where = count($found['roots']) <= 4 ? implode(' + ', $found['roots'])
        : implode(' + ', array_slice($found['roots'], 0, 4)) . ' + ' . (count($found['roots']) - 4) . ' more';
    xs_log('SCAN', 'walk ' . $where . ': ' . count($found['new']) . ' offered, '
        . $found['alreadyHave'] . ' already known, ' . count($found['archives']) . ' archives (and '
        . $found['archivesDone']['count'] . ' unpacked already, not listed), '
        . count($found['gaps']) . ' disc gaps, ' . count($found['unknown']) . ' unknown folders, '
        . count($found['skippedFolders']) . ' skipped, '
        . array_sum(array_column($found['unsure'], 'n')) . ' files no console could be read from, '
        . $found['junk'] . ' junk files, ' . count($found['passed']) . ' other files of known games, '
        . count($found['copies'] ?? []) . ' second copies, in ' . $found['ms'] . 'ms');
    // The screen does not list the folders with no games in them: the log names them.
    if ($found['unknown']) {
        $empty = array_column($found['unknown'], 'folder');
        xs_log('SCAN', 'no games in: ' . implode(', ', array_slice($empty, 0, 12))
            . (count($empty) > 12 ? ' and ' . (count($empty) - 12) . ' more' : ''));
    }
    // The names a folder can have, for the screen to say beside whatever
    // could not be placed (includes\scan.php, WHERE A GAME MAY STAND).
    xs_json(['ok' => true, 'accepted' => count(xs_scan_read()), 'names' => xs_scan_folder_names_playable()] + $found);
}

xs_local_origin_only();
$body   = xs_body();
$action = (string) ($body['action'] ?? '');

if ($action === 'accept') {
    $games = $body['games'] ?? [];
    if (!is_array($games)) {
        xs_fail('games must be a list', 400);
    }
    $added = xs_scan_accept($games, $why, $skipped);
    if ($added === false) {
        xs_fail((string) $why, 500);
    }
    xs_log('SCAN', 'accepted ' . $added . ' of ' . count($games) . ' offered'
        . ($skipped ? ' (' . count($skipped) . ' skipped: ' . $skipped[0]['why'] . ')' : ''));
    [$hacks, $auto] = xs_scan_after_accept($games, $added, false);
    xs_json(['ok' => true, 'added' => $added, 'skipped' => $skipped, 'accepted' => count(xs_scan_read()), 'auto' => $auto,
             'mayBeHacks' => $hacks['ask']]);
}

if ($action === 'remove') {
    $id  = (string) ($body['id'] ?? '');
    $all = xs_scan_read();
    $kept = array_values(array_filter($all, static fn($e) => (string) ($e['id'] ?? '') !== $id));
    if (count($kept) === count($all)) {
        xs_fail('no scanned game with that id', 404);
    }
    if (!xs_write_json(xs_scan_path(), $kept, $why)) {
        xs_fail((string) $why, 500);
    }
    // You took it out: not "a game is no longer in the library" tomorrow.
    require_once __DIR__ . '/../includes/news.php';
    xs_news_forget([$id]);
    xs_log('SCAN', 'removed ' . $id);
    xs_json(['ok' => true, 'accepted' => count($kept)]);
}

/* ---- one playlist for a disc set ---------------------------------------- */

if ($action === 'm3u') {
    // Which folder and which file, and nothing else: the discs it lists and
    // whether it may be written are read off the disk again, so a request
    // cannot name a file the walk would not have offered.
    $dir  = (string) ($body['dir'] ?? '');
    $file = (string) ($body['file'] ?? '');
    if ($dir === '' || !preg_match('/^[^\/:*?"<>|]+.m3u$/i', $file)) {
        xs_fail('dir and file (a name ending .m3u, no path) are needed', 400);
    }
    $wrote = xs_scan_m3u_write($dir, $file, $why);
    if ($wrote === null) {
        xs_fail((string) $why, 400);
    }
    xs_log('SCAN', 'm3u written ' . $wrote['path'] . ' (' . count($wrote['discs']) . ' discs)');
    xs_json(['ok' => true] + $wrote);
}

if ($action === 'join') {
    // Which file, and nothing else: the game it is a disc of, and the playlist
    // that joins them, are read off the disk and the library again.
    $joined = xs_scan_join((string) ($body['rom'] ?? ''), $why);
    if ($joined === null) {
        xs_fail((string) $why, 400);
    }
    xs_log('SCAN', 'joined disc ' . $joined['disc'] . ' to ' . $joined['title'] . ': ' . $joined['path'] . ' (' . count($joined['discs']) . ' discs)');
    xs_json(['ok' => true] + $joined);
}

/* ---- the folders to look in ------------------------------------------- */

if ($action === 'addFolder') {
    $path = xs_norm_path(trim((string) ($body['path'] ?? '')));
    if ($path === '') {
        xs_fail('no folder given', 400);
    }
    // Refused when it is not there: a typo would make a folder that never
    // finds anything and never says why.
    if (!is_dir($path)) {
        xs_fail('there is no folder at ' . $path, 400);
    }
    $s = xs_settings();
    foreach (xs_scan_roots($s) as $have) {
        if (strcasecmp(rtrim($have, '\\/'), rtrim($path, '\\/')) === 0) {
            xs_fail('that folder is already on the list', 409);
        }
    }
    $folders = array_values(array_filter((array) ($s['paths']['scanFolders'] ?? []), 'is_string'));
    $folders[] = $path;
    // xs_settings_save hands back the settings, not a yes or no: a failed
    // write shows up as $why being set.
    xs_settings_save(['paths' => ['scanFolders' => $folders]], $why);
    if ($why !== null) {
        xs_fail((string) $why, 500);
    }
    // A folder inside one already on the list is allowed (it does no harm),
    // and said, since it adds nothing.
    $inside = '';
    foreach (xs_scan_roots($s) as $have) {
        if (stripos($path . DIRECTORY_SEPARATOR, rtrim($have, '\\/') . DIRECTORY_SEPARATOR) === 0) {
            $inside = ' (it is inside ' . $have . ', which was already on the list and already covers it)';
            break;
        }
    }
    xs_log('SCAN', 'folder added ' . $path . $inside);
    xs_json(['ok' => true, 'folders' => xs_scan_roots(), 'inside' => $inside !== '' ? $have : null]);
}

if ($action === 'removeFolder') {
    $path = xs_norm_path(trim((string) ($body['path'] ?? '')));
    $s = xs_settings();
    // The ROM drive is Settings > Paths' to set, not this screen's to drop.
    if (strcasecmp(rtrim($path, '\\/'), rtrim(xs_norm_path((string) ($s['paths']['romRoot'] ?? '')), '\\/')) === 0) {
        xs_fail('that is the ROM drive: change it in Settings > Paths', 409);
    }
    $folders = array_values(array_filter(
        array_filter((array) ($s['paths']['scanFolders'] ?? []), 'is_string'),
        static fn($p) => strcasecmp(rtrim(xs_norm_path($p), '\\/'), rtrim($path, '\\/')) !== 0
    ));
    if (count($folders) === count((array) ($s['paths']['scanFolders'] ?? []))) {
        xs_fail('that folder is not on the list', 404);
    }
    xs_settings_save(['paths' => ['scanFolders' => $folders]], $why);
    if ($why !== null) {
        xs_fail((string) $why, 500);
    }
    xs_log('SCAN', 'folder removed ' . $path);
    xs_json(['ok' => true, 'folders' => xs_scan_roots()]);
}

/* ---- the console folders, made for you ----------------------------------
   Files that cannot say their console (.chd, .7z) need a folder named for
   it, so this makes one empty folder per console with an emulator, inside a
   games folder already on the list. Nothing is ever moved or deleted. */
if ($action === 'makeFolders') {
    $path = xs_norm_path(trim((string) ($body['path'] ?? '')));
    $root = null;
    foreach (xs_scan_roots() as $have) {
        if (strcasecmp(rtrim($have, '\\/'), rtrim($path, '\\/')) === 0) {
            $root = $have;
        }
    }
    if ($root === null) {
        xs_fail('that folder is not on the list of games folders', 404);
    }
    if (!is_dir($root)) {
        xs_fail('there is no folder at ' . $root . ' right now', 409);
    }
    if (xs_scan_platform_for(basename($root)) !== null) {
        xs_fail(basename($root) . ' is a console\'s own folder: console folders are made inside a games folder', 409);
    }
    $base = is_dir($root . DIRECTORY_SEPARATOR . 'systems') ? $root . DIRECTORY_SEPARATOR . 'systems' : $root;
    // Any folder already read as a console counts, whatever it is called.
    ['made' => $made, 'had' => $had, 'failed' => $failed] = xs_scan_make_folders($base);
    xs_log('SCAN', 'console folders in ' . $base . ': ' . count($made) . ' made (' . implode(', ', $made) . '), '
        . count($had) . ' were there' . ($failed ? ', ' . count($failed) . ' could NOT be made (' . xs_file_error_reason() . ')' : ''));
    if ($failed && !$made) {
        xs_fail('the folders could not be made in ' . $base . ': ' . xs_file_error_reason(), 500);
    }
    xs_json(['ok' => true, 'in' => $base, 'made' => $made, 'had' => $had, 'failed' => $failed]);
}

/* ---- the Games folder a new copy starts with -----------------------------
   start.ps1 asks this on every start, before the window opens. Made once,
   for a copy with no games folder at all (includes\scan.php says where and
   why); every other time the answer is made: false and nothing is touched.
   No path is taken from the request. */
if ($action === 'firstFolder') {
    xs_json(['ok' => true] + xs_scan_first_folder());
}

xs_fail('unknown action', 400);
