<?php
/**
 * /api/hacks.php - the patches on this PC that fit a game's file
 * (includes\hacks.php), and which game a hack is a hack of
 * (includes\hackof.php). Games and patches are read and never changed.
 *
 *   GET  ?id=<game id>                      what the Hacks tab of that game shows
 *   GET  ?id=<game id>&bases=1              the games it could be a hack of, to pick from
 *   GET  ?settle=1                          every game still in doubt, each with the game
 *                                           Xsegon would name for it (Games > Hacks to settle)
 *   POST {"id": "...", "copy": true|false}  its hacks start from a patched copy,
 *                                           or patched as the game loads; answers as GET
 *   POST {"id": "...", "hackOf": "<game id>"}   it is a hack of that game ("" for a game
 *                                               that is not in the library); answers as GET
 *   POST {"id": "...", "notHack": true}     it is no hack, and is not asked about again
 *   POST {"id": "...", "unsettle": true}    what was said of it is taken back
 *   GET  ?id=<game id>&about=<patch key>    a hack's own page: who made it, when, its story
 *                                           and pictures (includes\hackabout.php)
 *   GET  ?pic=<file>                        one of those pictures, from data\hacks\art only
 *
 * Playing one is api\launch.php with "hack": the patch's key. A game of your
 * own listed there ("programs"), and a hack that is a game of its own
 * ("hacks"), is started as itself, by its own id.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/hacks.php';
require_once __DIR__ . '/../includes/hackof.php';
require_once __DIR__ . '/../includes/hackabout.php';

$post = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
$body = [];
if ($post) {
    xs_local_origin_only();
    $body = xs_body();
}

// A hack's picture: only a file kept in data\hacks\art, under a name checked before any path is made of it.
if (!$post && isset($_GET['pic'])) {
    $file = xs_hackabout_pic_file((string) $_GET['pic']);
    if ($file === null) {
        xs_fail('no such picture', 404);
    }
    $types = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp', 'gif' => 'image/gif'];
    header('Content-Type: ' . $types[strtolower(pathinfo($file, PATHINFO_EXTENSION))]);
    header('Cache-Control: private, max-age=86400');
    header('X-Content-Type-Options: nosniff');
    header('Content-Length: ' . filesize($file));
    readfile($file);
    exit;
}

if (!$post && ($_GET['settle'] ?? '') === '1') {
    $t0 = microtime(true);
    $list = xs_hackof_unsettled(xs_library()['games'] ?? []);
    xs_log('HACK', 'to settle: ' . count($list) . ' in doubt, '
        . count(array_filter($list, static fn(array $r): bool => $r['suggest'] !== null)) . ' with a game named for them, in ' . round((microtime(true) - $t0) * 1000) . 'ms');
    xs_json(['ok' => true, 'games' => $list, 'count' => count($list)]);
}

$id = trim((string) ($post ? ($body['id'] ?? '') : ($_GET['id'] ?? '')));
if (!xs_game_id_ok($id)) {
    xs_fail('bad id', 400);
}
$games = xs_library()['games'] ?? [];
$game = null;
foreach ($games as $g) {
    if ($g['id'] === $id) {
        $game = $g;
        break;
    }
}
if ($game === null) {
    xs_fail('unknown game', 404);
}

if (!$post && ($_GET['bases'] ?? '') === '1') {
    xs_json(['ok' => true, 'id' => $id, 'bases' => xs_hackof_bases($game, $games, xs_hackof_marks($games))]);
}

if (!$post && isset($_GET['about'])) {
    $key = (string) $_GET['about'];
    if (!preg_match('/^[0-9a-f]{16}$/', $key)) {
        xs_fail('bad patch key', 400);
    }
    $p = null;
    foreach (xs_hack_index((string) $game['platform'], $games)['patches'] as $x) {
        if ($x['key'] === $key) {
            $p = $x;
            break;
        }
    }
    if ($p === null) {
        xs_fail('no such patch for ' . $game['platform'], 404);
    }
    $t0 = microtime(true);
    $about = xs_hackabout_for($p, (string) $game['platform']);
    xs_log('HACK', 'page of ' . $p['name'] . ', a hack of ' . $game['title'] . ': ' . ($about['from'] === null ? 'nothing known of it'
        : 'words from ' . ['you' => 'you', 'gamesdb' => 'the Games Database', 'both' => 'you and the Games Database'][$about['from']])
        . ', ' . (count($about['pics']['shots']) + ($about['pics']['box'] ? 1 : 0) + ($about['pics']['logo'] ? 1 : 0)) . ' picture(s), in '
        . round((microtime(true) - $t0) * 1000) . 'ms');
    xs_json(['ok' => true, 'id' => $id, 'of' => $game['title']] + $about);
}

if ($post) {
    $why = null;
    if (array_key_exists('copy', $body)) {
        if (!xs_hack_copy_set($id, !empty($body['copy']), $why)) {
            xs_fail((string) $why, 500);
        }
        xs_log('HACK', 'hacks of ' . $game['title'] . ' start ' . (!empty($body['copy']) ? 'from a patched copy' : 'patched as the game loads'));
    } elseif (array_key_exists('hackOf', $body)) {
        $of = trim((string) $body['hackOf']);
        $base = null;
        foreach ($of === '' ? [] : $games as $g) {
            if ($g['id'] === $of) {
                $base = $g;
                break;
            }
        }
        if ($of !== '' && ($base === null || $of === $id || !empty($base['local']))) {
            xs_fail($of === $id ? 'a game is not a hack of itself' : 'that is not a game it could be a hack of', 422);
        }
        if (!xs_hackof_set($id, ['is' => 'hack', 'of' => $of], $why)) {
            xs_fail((string) $why, 500);
        }
        xs_log('HACK', 'said: ' . $game['title'] . ' is a hack of ' . ($base !== null ? $base['title'] : 'a game that is not in the library'));
    } elseif (!empty($body['notHack'])) {
        if (!xs_hackof_set($id, ['is' => 'not'], $why)) {
            xs_fail((string) $why, 500);
        }
        xs_log('HACK', 'said: ' . $game['title'] . ' is no hack');
    } elseif (!empty($body['unsettle'])) {
        if (!xs_hackof_set($id, null, $why)) {
            xs_fail((string) $why, 500);
        }
        xs_log('HACK', 'taken back: what was said of ' . $game['title']);
    } else {
        xs_fail('say what to keep: copy, hackOf, notHack or unsettle');
    }
}

$t0 = microtime(true);
$list = xs_hacks_for($game, $games);
// What is known of each hack that fits, for its row: kept files only, so the list reads no database.
foreach ($list['rows'] as &$r) {
    $r['about'] = $r['fits'] ? xs_hackabout_brief($r['result'], $r['name']) : null;
}
unset($r);
$marks = xs_hackof_marks($games);
$is = xs_hackof_state($game, $games, $marks);
$theirs = xs_hackof_games($id, $games);
if (!$post) {
    $fit = count(array_filter($list['rows'], static fn(array $r): bool => $r['fits']));
    xs_log('HACK', 'listed for ' . $game['title'] . ': ' . ($list['can']
        ? $fit . ' fit, ' . (count($list['rows']) - $fit) . ' for another release, ' . $list['more'] . ' that name no game'
          . ($list['own'] ? ', its own file is a patch' : '') . ', ' . count($list['folders']) . ' folder(s), in ' . round((microtime(true) - $t0) * 1000) . 'ms'
        : 'nothing to look for')
        . ($list['programs'] ? ', ' . count($list['programs']) . ' of your own playing from its file' : '')
        . ($theirs ? ', ' . count($theirs) . ' said to be a hack of it' : '')
        . ($is['state'] === 'ask' ? '; itself in doubt' . ($is['suggest'] !== null ? ', named for ' . $is['suggest']['title'] : ', no game named for it')
          : ($is['state'] === 'hack' ? '; itself a hack of ' . ($is['of']['title'] ?? 'a game not in the library') : '')));
}
xs_json(['ok' => true, 'id' => $id, 'title' => $game['title'], 'platform' => $game['platform'],
         'is' => $is, 'hacks' => $theirs, 'mark' => $marks[$id] ?? null, 'asking' => count(array_keys($marks, 'ask', true))] + $list);
