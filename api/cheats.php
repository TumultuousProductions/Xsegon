<?php
/**
 * /api/cheats.php - the cheats a game can run with (includes\cheats.php).
 *
 *   GET  ?id=<game id>                         the cheat files for this game,
 *                                              best first, and what is chosen
 *   GET  ?id=...&file=<db/name.cht>&q=&from=   the cheats inside one file,
 *                                              200 at a time, narrowed by q
 *   POST {"id": "...", "file": "...", "on": [{"i":3,"desc":"..."}]}   remember
 *   POST {"id": "...", "clear": true}                                 forget
 *   GET  ?lists=1                              whether the cheat lists are on this
 *                                              PC, and what fetching them would bring
 *   POST {"lists": "get"}                      fetch them, in the background
 *   POST {"lists": "stop"}                     stop that fetch
 *
 * Paged, and searched on the server, because one cheat file can hold tens of
 * thousands of cheats (Turok - Dinosaur Hunter's is 3 MB).
 *
 * An overlay in data\cheats.json. A game's versions are one game
 * (includes\versions.php): one choice, kept on every version.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/versions.php';
require_once __DIR__ . '/../includes/cheats.php';
require_once __DIR__ . '/../includes/cheatlists.php';
require_once __DIR__ . '/../includes/emucheats.php';

const XS_CHEAT_PAGE = 200;

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    // ---- the cheat lists themselves (includes\cheatlists.php) -----------
    if (isset($_GET['lists'])) {
        // Asked every two seconds while they are on their way: the library is read only where the answer needs it.
        $view  = xs_cl_view();
        $onWay = ($view['job']['state'] ?? '') === 'running';
        xs_json(['ok' => true, 'have' => $view['own'] || (!$onWay && xs_cheat_lists_here(xs_library()))] + $view);
    }
    $id = trim((string) ($_GET['id'] ?? ''));
    if ($id === '') {
        xs_fail('no game id');
    }
    [$game, $ids] = xs_game_versions($id);
    if ($game === null) {
        xs_fail('unknown game', 404);
    }
    $want = trim((string) ($_GET['file'] ?? ''));

    // ---- the cheats inside one file ------------------------------------
    if ($want !== '') {
        // Only a file this game actually matched. A free path here would read
        // any file on the disk that ends in .cht.
        $ok = null;
        foreach (xs_cheat_files($game) as $f) {
            if ($f['file'] === $want) {
                $ok = $f;
                break;
            }
        }
        if ($ok === null) {
            xs_fail('that cheat file is not one of this game\'s', 409);
        }
        $root   = xs_cheat_root($game);
        $chosen = xs_cheats_for_game($ids);
        // On now first, then the ones on before, then the rest.
        $all    = xs_cheats_ordered(xs_cheat_list($root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $want)),
                                    $chosen, xs_cheats_used($id, $want), $want);
        $q      = trim((string) ($_GET['q'] ?? ''));
        if ($q !== '') {
            $all = array_values(array_filter($all, function (array $c) use ($q): bool {
                return stripos($c['desc'], $q) !== false;
            }));
        }
        $from = max(0, (int) ($_GET['from'] ?? 0));
        $page = array_slice($all, $from, XS_CHEAT_PAGE);
        // The codes are never sent: they say nothing a person can use.
        foreach ($page as &$c) {
            unset($c['code']);
        }
        unset($c);
        xs_json(['ok' => true, 'id' => $id, 'file' => $want, 'cheats' => $page,
                 'from' => $from, 'shown' => count($page), 'matching' => count($all),
                 'whole' => $ok['cheats'], 'chosen' => $chosen]);
    }

    // ---- which files this game could use --------------------------------
    if (!empty($game['local'])) {
        xs_json(['ok' => true, 'id' => $id, 'files' => [], 'chosen' => null,
                 'why' => 'a game of your own does not run on RetroArch, so it has no cheat database']);
    }

    $files  = xs_cheat_files($game);
    $chosen = xs_cheats_for_game($ids, $from);
    if ($chosen !== null && $from !== $id) {
        xs_log('CHEAT', xs_versions_said($game, $ids, $id) . ': its cheats are the ones chosen on version ' . $from);
    }
    // A standalone emulator's own cheats, to show and not to change (includes\emucheats.php).
    $emu = $files ? null : xs_emucheats($game);

    /* Four ways to have nothing to offer, each said in its own words: one
       shared sentence reads wrong for some of them. */
    $why   = null;
    $lists = null;
    if (!$files) {
        $kind = (string) ($game['launch']['kind'] ?? '');
        $via  = preg_replace('/\s*\(.*$/', '', (string) ($game['launch']['via'] ?? ''));
        if ($kind !== 'retroarch') {
            $why = $game['platform'] . ' does not run on RetroArch'
                 . ($via !== '' ? ', it runs on ' . $via : '')
                 . ', and cheats here are RetroArch\'s own.'
                 . ($emu !== null ? ' ' . $emu['emulator'] . '\'s own are listed in this game\'s details, under Cheats.' : '');
        } elseif (xs_cheat_root($game) === null) {
            // The one reason with a way out: the page offers to fetch them.
            $why   = 'The cheat lists are not on this PC yet: the RetroArch here came without them.';
            $lists = xs_cl_view();
        } elseif (!xs_cheat_databases($game)) {
            $why = 'the core running ' . $game['platform']
                 . ' does not say which cheat database it uses, so Xsegon will not guess.';
        } else {
            $why = 'RetroArch\'s cheat database has nothing for ' . $game['title']
                 . '. It covers released games, so hacks and homebrew are usually missing.';
        }
    }

    xs_json(['ok' => true, 'id' => $id, 'platform' => $game['platform'],
             'files' => $files, 'chosen' => $chosen, 'why' => $why, 'emu' => $emu, 'lists' => $lists]);
}

xs_local_origin_only();
$body = xs_body();

if (isset($body['lists'])) {
    $why = null;
    if ($body['lists'] === 'stop') {
        $running = (xs_cl_job()['state'] ?? '') === 'running';
        if ($running) {
            @touch(xs_cl_stop_path());
            xs_log('CHTL', 'asked to stop');
        }
        xs_json(['ok' => true, 'stopping' => $running]);
    }
    if ($body['lists'] !== 'get') {
        xs_fail('lists is get or stop');
    }
    if (xs_cheat_lists_here(xs_library())) {
        xs_fail('the cheat lists are on this PC already', 409);
    }
    if (!xs_cl_start($why)) {
        xs_fail((string) $why, 409);
    }
    xs_json(['ok' => true, 'started' => true, 'job' => xs_cl_job()]);
}

$id   = xs_id_or_fail($body['id'] ?? '');
[$game, $ids] = xs_game_versions($id);
if ($game === null) {
    xs_fail('unknown game', 404);
}
// What each version had before, for the log; then the same choice on every one.
$had = xs_cheats_read();
$before = [];
foreach ($ids as $vid) {
    $before[] = $vid . ' ' . count($had[$vid]['on'] ?? []) . ' on';
}
$beforeSaid = count($ids) > 1 ? ' on every version; before: ' . implode(', ', $before) : '';
$setAll = static function (?array $pick) use ($ids): void {
    foreach ($ids as $vid) {
        if (!xs_cheats_set((string) $vid, $pick, $why)) {
            xs_fail((string) $why, 500);
        }
    }
};

if (!empty($body['clear'])) {
    $setAll(null);
    xs_log('CHEAT', 'cleared for ' . xs_versions_said($game, $ids, $id) . $beforeSaid);
    xs_json(['ok' => true, 'id' => $id, 'chosen' => null]);
}

$file = trim((string) ($body['file'] ?? ''));
$on   = (array) ($body['on'] ?? []);
if ($file === '') {
    xs_fail('no cheat file given');
}
$match = null;
foreach (xs_cheat_files($game) as $f) {
    if ($f['file'] === $file) {
        $match = $f;
        break;
    }
}
if ($match === null) {
    xs_fail('that cheat file is not one of ' . $game['title'] . '\'s', 409);
}

$clean = [];
foreach ($on as $c) {
    if (!is_array($c) || !isset($c['i'])) {
        continue;
    }
    $clean[] = ['i' => (int) $c['i'], 'desc' => (string) ($c['desc'] ?? '')];
}
if (!$clean) {
    // Selecting nothing turns cheats off: the same as Clear, no empty entry left.
    $setAll(null);
    xs_log('CHEAT', 'none left on for ' . xs_versions_said($game, $ids, $id) . ', cleared' . $beforeSaid);
    xs_json(['ok' => true, 'id' => $id, 'chosen' => null]);
}
if (count($clean) > 5000) {
    xs_fail('that is more cheats at once than any game can survive', 409);
}

$setAll(['file' => $file, 'on' => $clean]);
xs_log('CHEAT', xs_versions_said($game, $ids, $id) . ' -> ' . count($clean) . ' from ' . $file . $beforeSaid);
xs_json(['ok' => true, 'id' => $id, 'chosen' => xs_cheats_for($id), 'count' => count($clean)]);
