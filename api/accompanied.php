<?php
/**
 * /api/accompanied.php - files that go with a game and are not played
 * (includes\accompanied.php). Files on the disk are never touched.
 *
 *   GET  ?id=<game id>                    what that game's Files tab shows
 *   GET  ?id=<game id>&homes=1            the games it could go with, to pick from
 *   GET  ?id=<game id>&files=1            the files of its console that could go with it
 *   GET  ?settle=1                        every file whose name says it goes with a game,
 *                                         nobody having said, each with the game Xsegon names
 *   POST {"id": "...", "with": "<game id>"}   it goes with that game ("" for one not in the library)
 *   POST {"id": "...", "not": true}       it is a game, and is not suggested again
 *   POST {"id": "...", "unsettle": true}  what was said of it is taken back
 *
 * A POST may carry "tab": the game whose tab is open, which the answer is for.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/accompanied.php';

$post = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
$body = [];
if ($post) {
    xs_local_origin_only();
    $body = xs_body();
}
$games = xs_library()['games'] ?? [];

if (!$post && ($_GET['settle'] ?? '') === '1') {
    $list = xs_acc_unsettled($games);
    xs_log('ACC', 'to settle: ' . count($list) . ' file(s), ' . count(array_filter($list, static fn(array $r): bool => $r['suggest'] !== null)) . ' with a game named');
    xs_json(['ok' => true, 'files' => $list, 'count' => count($list)]);
}

$find = static function (string $id) use ($games): ?array {
    foreach ($games as $g) {
        if ((string) $g['id'] === $id) {
            return $g;
        }
    }
    return null;
};
$id = trim((string) ($post ? ($body['id'] ?? '') : ($_GET['id'] ?? '')));
if (!xs_game_id_ok($id)) {
    xs_fail('bad id', 400);
}
$game = $find($id);
$said = xs_acc_all()[$id] ?? null;
// A file in its game's tab is out of the library: only taking it back reaches it.
if ($game === null && !($post && !empty($body['unsettle']) && is_array($said))) {
    xs_fail('unknown game', 404);
}

if (!$post && ($_GET['homes'] ?? '') === '1') {
    xs_json(['ok' => true, 'id' => $id, 'homes' => xs_acc_homes($game, $games)]);
}
if (!$post && ($_GET['files'] ?? '') === '1') {
    $files = array_values(array_filter(xs_acc_homes($game, $games), static function (array $h) use ($find): bool {
        return xs_acc_may((array) $find($h['id']));
    }));
    xs_json(['ok' => true, 'id' => $id, 'files' => $files]);
}

if ($post) {
    $why = null;
    $name = $game !== null ? (string) $game['title'] : (string) ($said['title'] ?? $id);
    if (array_key_exists('with', $body)) {
        $with = trim((string) $body['with']);
        $home = $with === '' ? null : $find($with);
        if (!xs_acc_may($game) && ($said['is'] ?? '') !== 'with') {
            xs_fail(!empty($game['accompanied']) ? 'files go with this game: it cannot go with another' : 'only a file of a console can go with a game', 422);
        }
        if ($with !== '' && ($home === null || $with === $id || (string) $home['platform'] !== (string) $game['platform']
            || !empty($home['local']) || !empty($home['steam']) || ((xs_acc_all()[$with]['is'] ?? '') === 'with'))) {
            xs_fail($with === $id ? 'a file does not go with itself' : 'that is not a game of its console it could go with', 422);
        }
        $kind = xs_acc_kind_from_name((string) ($game['romPath'] ?? '')) ?? 'other';
        if (!xs_acc_set($id, ['is' => 'with', 'with' => $with, 'kind' => $kind, 'title' => $name, 'platform' => (string) $game['platform']], $why)) {
            xs_fail((string) $why, 500);
        }
        xs_log('ACC', 'said: ' . basename(str_replace('\\', '/', (string) ($game['romPath'] ?? ''))) . ' is the ' . strtolower(xs_acc_kind_words($kind))
            . ' of ' . ($home !== null ? $home['title'] : 'a game that is not in the library'));
    } elseif (!empty($body['not'])) {
        if (!xs_acc_set($id, ['is' => 'not', 'title' => $name, 'platform' => (string) $game['platform']], $why)) {
            xs_fail((string) $why, 500);
        }
        xs_log('ACC', 'said: ' . $name . ' is a game of its own');
    } elseif (!empty($body['unsettle'])) {
        if (!xs_acc_set($id, null, $why)) {
            xs_fail((string) $why, 500);
        }
        $back = xs_game($id);
        if ($back !== null && $game === null) {
            // Back in the lists by your own press: not news of a game arriving.
            require_once __DIR__ . '/../includes/news.php';
            xs_news_know([$back]);
        }
        xs_log('ACC', 'taken back: what was said of ' . $name . ($game === null ? ', which is back in its list' : ''));
    } else {
        xs_fail('say what to keep: with, not or unsettle');
    }
    $games = xs_library()['games'] ?? [];
    $tab = trim((string) ($body['tab'] ?? $id));
    $open = null;
    foreach ($games as $g) {
        if ((string) $g['id'] === $tab) {
            $open = $g;
        }
    }
    xs_json(['ok' => true, 'id' => $id, 'said' => xs_acc_all()[$id] ?? null, 'tab' => $tab,
             'state' => $open !== null ? xs_acc_state($open, $games) : null, 'asking' => count(xs_acc_unsettled($games))]);
}

$state = xs_acc_state($game, $games);
xs_log('ACC', 'tab of ' . $game['title'] . ': ' . count($state['files']) . ' file(s) with it'
    . ($state['state'] === 'ask' ? '; itself may be the ' . strtolower($state['words']) . ' of ' . ($state['suggest']['title'] ?? 'a game not named') : '')
    . ($state['state'] === 'with' ? '; itself goes with ' . ($state['with']['title'] ?? 'a game not in the library') : ''));
xs_json(['ok' => true, 'id' => $id, 'title' => $game['title'], 'platform' => $game['platform']] + $state);
